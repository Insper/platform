/*
 * The experiments of hands-on 9 (2027.1), as a lab twin:
 *
 *   <div class="csim" data-sim="pay-under-chaos" data-exp="timeout" data-after="off"></div>
 *
 * k6 runs load/pay-under-chaos.js against order: the `pay` scenario (PAY_RATE iterations/s, each a
 * POST /orders then a POST /orders/{id}/pay) and the `browse` scenario (20 GET /orders/{id}/s, never
 * calls payment), open model, with their maxVUs. order has a pool of Tomcat threads; a request that
 * finds none waits in the connection queue (Tomcat accepts up to 8,192 connections), so a slow payment
 * delays GET /orders/{id} too. POST /orders/{id}/pay calls payment through Toxiproxy, either
 * unprotected (PAYMENT_RESILIENCE=false, read timeout PAYMENT_READ_TIMEOUT, 0 = forever, error = 500)
 * or through Resilience4j as PaymentGateway stacks it: Retry ( CircuitBreaker ( Bulkhead ( call ) ) ),
 * the retry ignoring CallNotPermittedException and BulkheadFullException, the breaker ignoring
 * BulkheadFullException, the fallback answering 503.
 *
 * An experiment (data-exp) replays a step of the lab page "Resilience patterns" with its toxic and its
 * environment variables, "before" or "after" (data-after) the pattern: timeout (latency 3 s), retry
 * (reset_peer 30%), breaker (proxy disabled, re-enabled halfway through the run), bulkhead (latency
 * 700 ms at 70 payments/s) and all (latency 3 s, every pattern on: the table of "Measure it").
 * The player runs the k6 test; the summary is k6's, cumulative.
 *
 * Assumptions (not lab values): place and browse take a few ms of database work; payment's own time
 * grows with its call rate, calibrated to the lab's test run (700 ms of latency at 70 payments/s gave
 * calls of 750–1000 ms); a reset_peer hits every attempt with the toxicity (as if each attempt opened a
 * new connection; reused connections make the lab's measured rates lower). Every value taken from the
 * lab is in LAB (registered in scripts/csim/lab-values.mjs).
 */
(function () {
  "use strict";

  var LAB = { threads: 50, payRate: 20, browseRate: 20, payMaxVUs: 600, browseMaxVUs: 300, duration: 120,
    timeoutMs: 1000, attempts: 3, backoff: 200, mult: 2, jitter: 0.5,
    window: 20, minCalls: 10, failRate: 0.5, slowMs: 800, slowRate: 0.5, openMs: 10000, probes: 3, bulkhead: 10,
    slowLatency: 3000, resetToxicity: 0.3, bulkLatency: 700, bulkRate: 70, bulkOff: 1000 };

  /* each experiment: the toxic and the order configuration, before and after the pattern */
  var EXPS = {
    timeout: { toxic: { type: "latency", latency: LAB.slowLatency },
      before: { resilience: false, timeoutMs: 0 }, after: { resilience: false, timeoutMs: LAB.timeoutMs } },
    retry: { toxic: { type: "reset_peer", toxicity: LAB.resetToxicity },
      before: { attempts: 1 }, after: { attempts: LAB.attempts } },
    breaker: { toxic: { type: "disabled", reenableAt: LAB.duration * 1000 / 2 },
      before: { resilience: false }, after: {} },
    bulkhead: { toxic: { type: "latency", latency: LAB.bulkLatency }, payRate: LAB.bulkRate,
      before: { bulkhead: LAB.bulkOff }, after: { bulkhead: LAB.bulkhead } },
    all: { toxic: { type: "latency", latency: LAB.slowLatency },
      before: { resilience: false, timeoutMs: 0 }, after: {} }
  };

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* the configuration of one run: defaults of application.yaml and the k6 script, then the experiment */
  function config(exp, after) {
    var e = EXPS[exp], c = { exp: exp, after: !!after, resilience: true, timeoutMs: LAB.timeoutMs, attempts: LAB.attempts,
      bulkhead: LAB.bulkhead, payRate: e.payRate || LAB.payRate, toxic: e.toxic };
    var o = after ? e.after : e.before;
    Object.keys(o).forEach(function (k) { c[k] = o[k]; });
    return c;
  }

  /* o: {exp, after, seed} or a full config in o.cfg */
  function create(o) {
    var cfg = o.cfg || config(o.exp || "timeout", o.after);
    var sim = { t: 0, ev: [], r: rng(o.seed || 9), cfg: cfg, busy: 0, queue: [], active: [], done: [], calls: [],
      vus: { pay: 0, browse: 0 }, dropped: 0, idle: [], bulk: 0, log: [], proxyUp: cfg.toxic.type !== "disabled",
      cb: { state: "closed", win: [], since: 0, permits: 0, probes: [] }, full: false, iters: 0, confirmed: 0 };
    at(sim, 0, function () { arrival(sim, "pay"); });
    at(sim, 0, function () { arrival(sim, "browse"); });
    if (cfg.toxic.reenableAt) at(sim, cfg.toxic.reenableAt, function () { sim.proxyUp = true; note(sim, "proxy", null); });
    return sim;
  }

  /* the event list, kept sorted by time (insertion after equal times keeps the order of scheduling) */
  function at(sim, t, fn) {
    var ev = sim.ev, lo = 0, hi = ev.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (ev[mid].t <= t) lo = mid + 1; else hi = mid; }
    ev.splice(lo, 0, { t: t, fn: fn });
  }
  function note(sim, kind, data) { sim.log.push({ t: sim.t, kind: kind, data: data }); }

  /* k6: constant-arrival-rate; an iteration needs a free VU of its scenario, or it is dropped */
  function arrival(sim, scen) {
    var rate = scen === "pay" ? sim.cfg.payRate : LAB.browseRate, end = LAB.duration * 1000;
    var next = sim.t + 1000 / rate;
    if (next < end) at(sim, next, function () { arrival(sim, scen); });
    var max = scen === "pay" ? LAB.payMaxVUs : LAB.browseMaxVUs;
    if (sim.vus[scen] >= max) { sim.dropped++; if (sim.dropped === 1) note(sim, "dropped", scen); return; }
    sim.vus[scen]++;
    request(sim, scen === "pay" ? "place" : "browse", { scen: scen });
  }

  function request(sim, name, it) {
    var q = { name: name, it: it, start: sim.t, phase: "queued" };
    if (sim.busy < LAB.threads) start(sim, q); else { sim.queue.push(q); if (!sim.full) { sim.full = true; note(sim, "full", null); } }
  }

  /* every request: 1–3 ms of HTTP and Spring work; place writes the order, browse reads it, pay reads it first */
  function start(sim, q) {
    sim.busy++;
    sim.active.push(q);
    q.phase = "local";
    var ovh = 1 + 2 * sim.r();
    if (q.name === "pay") return at(sim, sim.t + ovh + 2 + 3 * sim.r(), function () { payStart(sim, q); });
    var work = q.name === "place" ? 5 + 5 * sim.r() : 2 + 4 * sim.r();
    at(sim, sim.t + ovh + work, function () { finish(sim, q, q.name === "place" ? 201 : 200); });
  }
  /* AUTHORIZED: the short transaction (UPDATE ... WHERE status = 'PENDING_PAYMENT' + the outbox row) */
  function confirm(sim, q) {
    q.phase = "local";
    at(sim, sim.t + 3 + 3 * sim.r(), function () { finish(sim, q, 200, "ok"); });
  }

  function finish(sim, q, status, how) {
    sim.busy--;
    sim.active.splice(sim.active.indexOf(q), 1);
    sim.done.push({ t: sim.t, name: q.name, dur: sim.t - q.start, status: status, how: how });
    if (sim.queue.length) start(sim, sim.queue.shift());
    else if (sim.full && sim.busy < LAB.threads - 5) sim.full = false;
    if (q.name === "place") return request(sim, "pay", q.it);          /* the same VU sends the payment */
    sim.vus[q.it.scen]--;
    if (q.name === "pay") { sim.iters++; if (status === 200) sim.confirmed++; }
  }

  /*
   * One call to payment through Toxiproxy: how long until order gets an answer, and whether it fails.
   * order's HTTP client keeps idle keep-alive connections (the JDK keeps up to 5 per host) and payment's
   * Tomcat closes a connection after 100 requests (its default): a toxic with a toxicity is decided per
   * connection, so a reset_peer only hits the first request of a new connection.
   */
  var IDLE_MAX = 5, KEEPALIVE_REQUESTS = 100;
  function callPayment(sim) {
    sim.calls.push(sim.t);
    var tx = sim.cfg.toxic;
    if (!sim.proxyUp) return { fail: true, dur: 1 };                                  /* connection refused */
    var conn = sim.idle.pop() || { uses: 0, poisoned: tx.type === "reset_peer" && sim.r() < tx.toxicity };
    conn.uses++;
    if (conn.poisoned) return { fail: true, dur: 1 + sim.r() };                       /* connection reset by peer */
    var recent = 0;
    for (var i = sim.calls.length - 1; i >= 0 && sim.calls[i] > sim.t - 1000; i--) recent++;
    var r = sim.r(), own = 15 + r * r * r * r * Math.min(300, 4.3 * recent);                   /* payment's own work */
    return { fail: false, dur: (tx.type === "latency" ? tx.latency : 0) + own, conn: conn };
  }
  /* back to the idle connections, unless the read timed out (the client closes it) or Tomcat closes it */
  function release(sim, c, cut) {
    if (c.conn && !cut && c.conn.uses < KEEPALIVE_REQUESTS && sim.idle.length < IDLE_MAX) sim.idle.push(c.conn);
  }

  function payStart(sim, q) {
    if (!sim.cfg.resilience) {
      var c = callPayment(sim), to = sim.cfg.timeoutMs, cut = to > 0 && c.dur > to;
      q.phase = "call";
      at(sim, sim.t + (cut ? to : c.dur), function () {
        release(sim, c, cut);
        if (c.fail || cut) return finish(sim, q, 500, cut ? "timeout" : "error");
        confirm(sim, q);
      });
      return;
    }
    q.n = 0;
    attempt(sim, q);
  }

  /* Retry ( CircuitBreaker ( Bulkhead ( call ) ) ) */
  function attempt(sim, q) {
    q.n++;
    if (!permit(sim)) return finish(sim, q, 503, "open");                 /* CallNotPermitted: not retried */
    if (sim.bulk >= sim.cfg.bulkhead) {                                    /* BulkheadFull: not retried, not counted */
      if (sim.cb.state === "half") sim.cb.permits++;
      return finish(sim, q, 503, "full");
    }
    sim.bulk++;
    q.phase = "call";
    var c = callPayment(sim), cut = c.dur > sim.cfg.timeoutMs, took = cut ? sim.cfg.timeoutMs : c.dur;
    at(sim, sim.t + took, function () {
      sim.bulk--;
      release(sim, c, cut);
      var fail = c.fail || cut;
      record(sim, fail, took > LAB.slowMs);
      if (!fail) return confirm(sim, q);
      if (q.n < sim.cfg.attempts) {
        q.phase = "wait";
        var wait = LAB.backoff * Math.pow(LAB.mult, q.n - 1) * (1 + LAB.jitter * (2 * sim.r() - 1));
        return at(sim, sim.t + wait, function () { attempt(sim, q); });
      }
      finish(sim, q, 503, cut ? "timeout" : "error");
    });
  }

  /* the count-based circuit breaker, with the automatic transition from open to half-open */
  function setState(sim, state, why) {
    var cb = sim.cb, from = cb.state;
    cb.state = state; cb.since = sim.t; cb.win = []; cb.probes = [];
    cb.permits = state === "half" ? LAB.probes : 0;
    note(sim, "cb", { from: from, to: state, why: why });
    if (state === "open") { var since = sim.t; at(sim, sim.t + LAB.openMs, function () { if (cb.state === "open" && cb.since === since) setState(sim, "half", null); }); }
  }
  function permit(sim) {
    var cb = sim.cb;
    if (cb.state === "closed") return true;
    if (cb.state === "half" && cb.permits > 0) { cb.permits--; return true; }
    return false;
  }
  function rates(list) {
    var f = 0, s = 0;
    list.forEach(function (x) { if (x.fail) f++; if (x.slow) s++; });
    return { fail: f / list.length, slow: s / list.length, n: list.length };
  }
  function record(sim, fail, slow) {
    var cb = sim.cb, rec = { fail: fail, slow: slow };
    if (cb.state === "closed") {
      cb.win.push(rec);
      if (cb.win.length > LAB.window) cb.win.shift();
      if (cb.win.length >= LAB.minCalls) {
        var w = rates(cb.win);
        if (w.fail >= LAB.failRate || w.slow >= LAB.slowRate) setState(sim, "open", w);
      }
    } else if (cb.state === "half") {
      cb.probes.push(rec);
      if (cb.probes.length >= LAB.probes) {
        var p = rates(cb.probes);
        setState(sim, p.fail >= LAB.failRate || p.slow >= LAB.slowRate ? "open" : "closed", { probes: p.n, bad: Math.round(p.n * Math.max(p.fail, p.slow)) });
      }
    }
  }

  function advance(sim, ms) {
    var end = sim.t + ms;
    while (sim.ev.length && sim.ev[0].t <= end) { var e = sim.ev.shift(); sim.t = e.t; e.fn(); }
    sim.t = end;
  }
  /* until the k6 test ends and every request in flight is answered */
  function run(sim) { advance(sim, LAB.duration * 1000); while (sim.ev.length) advance(sim, 1000); return summary(sim); }

  function pct(sorted, p) {
    if (!sorted.length) return 0;
    var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);      /* k6 interpolates between ranks */
  }
  function stats(list) {
    var d = list.map(function (x) { return x.dur; }).sort(function (a, b) { return a - b; });
    return { n: d.length, med: pct(d, 0.5), p95: pct(d, 0.95) };
  }

  /* k6's end-of-test numbers (or the last `span` ms, for the live chart) */
  function summary(sim, span) {
    var from = span ? sim.t - span : -1;
    var pays = sim.done.filter(function (x) { return x.name === "pay" && x.t > from; });
    var browse = sim.done.filter(function (x) { return x.name === "browse" && x.t > from; });
    var callsFrom = span ? from : 0, calls = sim.calls.filter(function (x) { return x > callsFrom; }).length;
    var secs = Math.max(1, ((span ? Math.min(span, sim.t) : Math.min(sim.t, LAB.duration * 1000)) / 1000));
    return { pay: stats(pays), browse: stats(browse),
      confirmed: pays.length ? pays.filter(function (x) { return x.status === 200; }).length / pays.length : 0,
      fastFail: pays.length ? pays.filter(function (x) { return x.status === 503; }).length / pays.length : 0,
      rejected: pays.length ? pays.filter(function (x) { return x.how === "full"; }).length / pays.length : 0,
      browseFailed: browse.length ? browse.filter(function (x) { return x.status !== 200; }).length / browse.length : 0,
      dropped: sim.dropped, callsPerSec: calls / secs, busy: sim.busy, queued: sim.queue.length, breaker: sim.cb.state };
  }

  function phases(sim) {
    var c = { call: 0, wait: 0, local: 0 };
    sim.active.forEach(function (q) { c[q.phase]++; });
    return c;
  }

  /* the times of the breaker's transitions (for the breaker experiment) */
  function transitions(sim) { return sim.log.filter(function (e) { return e.kind === "cb"; }).map(function (e) { return { t: e.t, to: e.data.to }; }); }

  var SEED = 1;   /* the run the page's tip quotes */
  function make(exp, after, seed) { return create({ exp: exp, after: after, seed: seed === undefined ? SEED : seed }); }

  var API = { SEED: SEED, make: make, config: config, advance: advance, run: run, summary: summary, phases: phases, transitions: transitions, EXPS: EXPS, LAB: LAB };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var TICK = 1000, STEPS = LAB.duration;
  var SNAME = { closed: t("closed", "fechado"), open: t("open", "aberto"), half: t("half-open", "semiaberto") };
  function dec(v, d) { return v.toFixed(d).replace(".", C.PT ? "," : "."); }
  /* k6's way of printing a duration */
  function k6d(ms) {
    if (ms >= 1000) return dec(ms / 1000, ms >= 10000 ? 1 : 2) + "s";
    if (ms >= 1) return dec(ms, ms >= 100 ? 0 : 1) + "ms";
    return dec(ms * 1000, 0) + "µs";
  }
  function pc(x) { return dec(100 * x, 2) + "%"; }

  var LABELS = {
    timeout: t("1 · Timeout", "1 · Timeout"), retry: t("2 · Retry", "2 · Retry"), breaker: t("3 · Circuit breaker", "3 · Circuit breaker"),
    bulkhead: t("4 · Bulkhead", "4 · Bulkhead"), all: t("All patterns", "Todos os padrões")
  };
  function toxicCmd(c) {
    var tx = c.toxic;
    if (tx.type === "latency") return "curl -s -X POST localhost:8474/proxies/payment/toxics \\\n  -d '{\"name\":\"slow\",\"type\":\"latency\",\"stream\":\"downstream\",\"attributes\":{\"latency\":" + tx.latency + "}}'";
    if (tx.type === "reset_peer") return "curl -s -X POST localhost:8474/proxies/payment/toxics \\\n  -d '{\"name\":\"flaky\",\"type\":\"reset_peer\",\"toxicity\":" + tx.toxicity + ",\"attributes\":{\"timeout\":0}}'";
    return "curl -s -X POST localhost:8474/proxies/payment -d '{\"enabled\": false}'";
  }
  function envCmd(c) {
    var env;
    if (c.exp === "retry") env = "PAYMENT_RETRY_ATTEMPTS=" + c.attempts;
    else if (c.exp === "bulkhead") env = "PAYMENT_BULKHEAD=" + c.bulkhead;
    else if (!c.resilience) env = "PAYMENT_RESILIENCE=false" + (c.exp === "breaker" ? "" : " PAYMENT_READ_TIMEOUT=" + (c.timeoutMs ? c.timeoutMs / 1000 + "s" : "0"));
    else env = "PAYMENT_RESILIENCE=true";
    return env + " docker compose up -d --wait order";
  }
  function k6Cmd(c) { return "k6 run " + (c.payRate !== LAB.payRate ? "-e PAY_RATE=" + c.payRate + " " : "") + "load/pay-under-chaos.js"; }

  C.style("pay-under-chaos", [
    ".md-typeset .csim-pc-th { fill: var(--c-line); }",
    ".md-typeset .csim-pc-th.call { fill: var(--c-warn); }",
    ".md-typeset .csim-pc-th.wait { fill: color-mix(in srgb, var(--c-warn) 40%, var(--c-bg)); }",
    ".md-typeset .csim-pc-th.local { fill: var(--c-ok); }",
    ".md-typeset .csim-pc-cmd, .md-typeset .csim-pc-k6 { font-family: var(--md-code-font-family, monospace); font-size: .6rem; line-height: 1.45;",
    "  white-space: pre-wrap; margin: .3rem 0; padding: .4rem .6rem; border-radius: 4px; background: var(--c-panel); color: var(--c-fg); }",
    ".md-typeset .csim-pc-k6 .bad { color: var(--c-bad); } .md-typeset .csim-pc-k6 .ok { color: var(--c-ok); }",
    ".md-typeset .csim-pc-st { fill: var(--c-bg); stroke: var(--c-fg3); stroke-width: 1.2; }",
    ".md-typeset .csim-pc-st.closed { fill: color-mix(in srgb, var(--c-ok) 22%, var(--c-bg)); stroke: var(--c-ok); stroke-width: 2.2; }",
    ".md-typeset .csim-pc-st.open { fill: color-mix(in srgb, var(--c-bad) 22%, var(--c-bg)); stroke: var(--c-bad); stroke-width: 2.2; }",
    ".md-typeset .csim-pc-st.half { fill: color-mix(in srgb, var(--c-warn) 22%, var(--c-bg)); stroke: var(--c-warn); stroke-width: 2.2; }",
    ".md-typeset .csim-pc-off { opacity: .35; }"
  ].join("\n"));

  C.register("pay-under-chaos", function (root) {
    var o = C.opts(root, { exp: "timeout", after: false });
    if (!EXPS[o.exp]) o.exp = "timeout";
    var sim, cfg;

    var cmd = el("pre", { class: "csim-pc-cmd" });
    var k6 = el("pre", { class: "csim-pc-k6", "aria-live": "polite" });
    var svg = s("svg", { viewBox: "0 0 380 170", role: "img", "aria-label": t("order's threads and the call to payment", "as threads do order e a chamada ao payment") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(6);
    var chart = C.chart({ series: [
      { label: t("browse p95 (ms, last 5 s)", "browse p95 (ms, últimos 5 s)"), cls: "tone-bad" },
      { label: t("pay p95 (ms, last 5 s)", "pay p95 (ms, últimos 5 s)"), cls: "tone-warn" }], len: STEPS });

    var exp = C.choice({ label: t("Experiment", "Experimento"), value: o.exp,
      options: Object.keys(EXPS).map(function (k) { return { value: k, label: LABELS[k] }; }),
      onChange: function () { bar.reset(); } });
    var after = C.toggle({ label: t("pattern on (after)", "padrão ligado (depois)"), checked: o.after, onChange: function () { bar.reset(); } });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function reset() {
      sim = make(exp.get(), after.get(), SEED);
      cfg = sim.cfg;
      cmd.textContent = "$ " + envCmd(cfg) + "\n$ " + toxicCmd(cfg) + "\n$ " + k6Cmd(cfg) +
        (cfg.toxic.reenableAt ? t("\n# halfway through the run: ", "\n# no meio da execução: ") + "curl -s -X POST localhost:8474/proxies/payment -d '{\"enabled\": true}'" : "");
      chart.reset(); lg.clear();
      draw();
    }

    function tick() {
      var n = sim.log.length;
      advance(sim, TICK);
      if (sim.t >= LAB.duration * 1000) while (sim.ev.length) advance(sim, 1000);
      sim.log.slice(n).forEach(function (e) {
        var ts = "t=" + dec(e.t / 1000, 1) + " s  ";
        if (e.kind === "cb") {
          var w = e.data.why, txt = ts + t("breaker ", "breaker ") + SNAME[e.data.from] + " → " + SNAME[e.data.to];
          if (w && w.n && !w.probes) txt += t(" (" + Math.round(100 * w.fail) + "% failed, " + Math.round(100 * w.slow) + "% slow)", " (" + Math.round(100 * w.fail) + "% falharam, " + Math.round(100 * w.slow) + "% lentas)");
          if (w && w.probes) txt += t(" (" + w.bad + " of " + w.probes + " probes bad)", " (" + w.bad + " de " + w.probes + " sondas ruins)");
          lg.add(txt, e.data.to === "open" ? "bad" : e.data.to === "half" ? "warn" : "ok");
        } else if (e.kind === "full") lg.add(ts + t("all " + LAB.threads + " threads busy: requests wait in line", "as " + LAB.threads + " threads ocupadas: as requisições esperam na fila"), "bad");
        else if (e.kind === "proxy") lg.add(ts + t("proxy payment re-enabled", "proxy payment reabilitado"), "ok");
        else if (e.kind === "dropped") lg.add(ts + t("k6: no free VU in " + e.data + ", iterations dropped", "k6: sem VU livre em " + e.data + ", iterações descartadas"), "warn");
      });
      var m = summary(sim, 5000);
      chart.push([m.browse.p95, m.pay.p95]);
      draw();
      return sim.t < LAB.duration * 1000;
    }

    function narrate(m, live) {
      if (sim.t === 0) return say(t("Press play: k6 runs for " + LAB.duration + " s, " + cfg.payRate + " payments/s and " + LAB.browseRate + " GET /orders/{id}/s against order's " + LAB.threads + " threads.",
        "Aperte play: o k6 roda por " + LAB.duration + " s, " + cfg.payRate + " pagamentos/s e " + LAB.browseRate + " GET /orders/{id}/s contra as " + LAB.threads + " threads do order."), "");
      if (live.queued > 0) return say(t(live.queued + " requests wait for a thread — GET /orders/{id} among them, though it never calls payment: the cascade.",
        live.queued + " requisições esperam uma thread — GET /orders/{id} entre elas, embora nunca chame o payment: a cascata."), "bad");
      if (cfg.resilience && sim.cb.state === "open") return say(t("The breaker is open: pay answers 503 in microseconds, no call reaches payment, and browse keeps its milliseconds.",
        "O breaker está aberto: o pay responde 503 em microssegundos, nenhuma chamada chega ao payment e o browse mantém seus milissegundos."), "warn");
      if (m.rejected > 0.3) return say(t("The bulkhead lets only " + cfg.bulkhead + " calls wait on payment: " + Math.round(100 * m.rejected) + "% of the payments get 503 at once, and the other threads serve browse.",
        "O bulkhead deixa só " + cfg.bulkhead + " chamadas esperando o payment: " + Math.round(100 * m.rejected) + "% dos pagamentos recebem 503 na hora e as outras threads atendem o browse."), "warn");
      if (m.browse.p95 >= 200) return say(t("browse p95 " + k6d(m.browse.p95) + " breaks its threshold (p(95)<200) although GET /orders/{id} never calls payment: the cascade.",
        "browse p95 " + k6d(m.browse.p95) + " quebra o seu threshold (p(95)<200) embora o GET /orders/{id} nunca chame o payment: a cascata."), "bad");
      if (m.confirmed < 0.5) return say(t("order is safe (" + live.busy + " threads busy), but only " + Math.round(100 * m.confirmed) + "% of the payments are confirmed: the pattern protects order, not the payment.",
        "O order está a salvo (" + live.busy + " threads ocupadas), mas só " + Math.round(100 * m.confirmed) + "% dos pagamentos são confirmados: o padrão protege o order, não o pagamento."), "warn");
      return say(t(Math.round(100 * m.confirmed) + "% of the payments confirmed, browse p95 " + k6d(m.browse.p95) + ".",
        Math.round(100 * m.confirmed) + "% dos pagamentos confirmados, browse p95 " + k6d(m.browse.p95) + "."), m.confirmed > 0.95 ? "ok" : "warn");
    }

    function line(label, value, tone) {
      var dots = new Array(Math.max(2, 34 - label.length)).join(".");
      return [label + dots + ": ", tone ? el("span", { class: tone, text: value }) : value, "\n"];
    }

    function draw() {
      var m = summary(sim), ph = phases(sim);
      /* k6's summary, as it would print at the end */
      C.clear(k6);
      var thrP = m.pay.p95 < 1500, thrB = m.browse.p95 < 200, thrF = m.browseFailed < 0.01, any = m.pay.n || m.browse.n;
      C.add(k6, [].concat(
        line((any ? (thrP ? "✓ " : "✗ ") : "  ") + "http_req_duration{name:pay}", "med=" + k6d(m.pay.med) + " p(95)=" + k6d(m.pay.p95), any ? (thrP ? "ok" : "bad") : ""),
        line((any ? (thrB ? "✓ " : "✗ ") : "  ") + "http_req_duration{name:browse}", "med=" + k6d(m.browse.med) + " p(95)=" + k6d(m.browse.p95), any ? (thrB ? "ok" : "bad") : ""),
        line((any ? (thrF ? "✓ " : "✗ ") : "  ") + "http_req_failed{name:browse}", pc(m.browseFailed), any ? (thrF ? "ok" : "bad") : ""),
        line("  " + t("paid and confirmed", "paid and confirmed"), pc(m.confirmed)),
        line("  pay_fast_fail", pc(m.fastFail)),
        line("  dropped_iterations", String(m.dropped), m.dropped ? "bad" : ""),
        line("  " + t("calls to payment/s", "chamadas ao payment/s"), dec(m.callsPerSec, 1))));

      C.clear(svg);
      var full = sim.busy >= LAB.threads;
      svg.appendChild(s("rect", { x: 4, y: 6, width: 150, height: 158, rx: 6, class: "c-box " + (full ? "bad" : "on") }));
      svg.appendChild(s("text", { x: 79, y: 22, "text-anchor": "middle", class: "c-label" }, "order"));
      svg.appendChild(s("text", { x: 79, y: 35, "text-anchor": "middle", class: "c-small" }, LAB.threads + t(" Tomcat threads", " threads do Tomcat")));
      var order = [];
      for (var i = 0; i < ph.call; i++) order.push("call");
      for (i = 0; i < ph.wait; i++) order.push("wait");
      for (i = 0; i < ph.local; i++) order.push("local");
      for (i = 0; i < LAB.threads; i++) {
        svg.appendChild(s("rect", { x: 14 + (i % 10) * 13, y: 42 + Math.floor(i / 10) * 13, width: 10.5, height: 10.5, rx: 1.5, class: "csim-pc-th " + (order[i] || "") }));
      }
      [["call", t("waiting on payment", "esperando o payment")], ["wait", t("backoff before a retry", "backoff antes de retentar")], ["local", t("serving browse / place", "atendendo browse / place")]].forEach(function (k, j) {
        svg.appendChild(s("rect", { x: 14, y: 112 + j * 12, width: 8, height: 8, class: "csim-pc-th " + k[0] }));
        svg.appendChild(s("text", { x: 26, y: 119 + j * 12, class: "c-small" }, k[1]));
      });
      svg.appendChild(s("text", { x: 79, y: 158, "text-anchor": "middle", class: "c-small" + (sim.queue.length ? " c-bad" : "") }, t("in line for a thread: ", "na fila por uma thread: ") + sim.queue.length));
      /* bulkhead and breaker */
      var res = cfg.resilience;
      var g = s("g", { class: res ? "" : "csim-pc-off" });
      g.appendChild(s("text", { x: 214, y: 22, "text-anchor": "middle", class: "c-small" }, res ? "Resilience4j" : "PAYMENT_RESILIENCE=false"));
      g.appendChild(s("text", { x: 214, y: 38, "text-anchor": "middle", class: "c-small" }, "bulkhead " + (res ? sim.bulk + "/" + (cfg.bulkhead >= 1000 ? "∞" : cfg.bulkhead) : "–")));
      var P = { closed: [180, 70], open: [248, 70], half: [214, 108] };
      Object.keys(P).forEach(function (k) {
        var on = res && sim.cb.state === k;
        g.appendChild(s("circle", { cx: P[k][0], cy: P[k][1], r: 17, class: "csim-pc-st " + (on ? k : "") }));
        g.appendChild(s("text", { x: P[k][0], y: P[k][1] + 3, "text-anchor": "middle", class: "c-small" }, SNAME[k]));
      });
      g.appendChild(s("text", { x: 214, y: 140, "text-anchor": "middle", class: "c-small" }, t("circuit breaker", "circuit breaker")));
      svg.appendChild(g);
      /* toxiproxy and payment */
      var tx = cfg.toxic, down = !sim.proxyUp;
      svg.appendChild(s("line", { x1: 154, x2: 290, y1: 152, y2: 152, class: "c-wire " + (down ? "cut" : "on") }));
      svg.appendChild(s("rect", { x: 290, y: 40, width: 86, height: 50, rx: 6, class: "c-box " + (down ? "bad" : "warn") }));
      svg.appendChild(s("text", { x: 333, y: 56, "text-anchor": "middle", class: "c-label" }, "toxiproxy"));
      svg.appendChild(s("text", { x: 333, y: 72, "text-anchor": "middle", class: "c-small" },
        down ? t("proxy disabled", "proxy desabilitado") : tx.type === "latency" ? "latency " + tx.latency + " ms" : tx.type === "reset_peer" ? "reset_peer " + Math.round(tx.toxicity * 100) + "%" : t("no toxic", "sem toxic")));
      svg.appendChild(s("line", { x1: 333, x2: 333, y1: 90, y2: 112, class: "c-wire on" }));
      svg.appendChild(s("rect", { x: 290, y: 112, width: 86, height: 50, rx: 6, class: "c-box ok" }));
      svg.appendChild(s("text", { x: 333, y: 132, "text-anchor": "middle", class: "c-label" }, "payment"));
      svg.appendChild(s("text", { x: 333, y: 148, "text-anchor": "middle", class: "c-small" }, dec(summary(sim, 1000).callsPerSec, 0) + t(" calls/s", " chamadas/s")));
      svg.appendChild(s("line", { x1: 290, x2: 290, y1: 65, y2: 152, class: "c-wire " + (down ? "cut" : "on") }));

      narrate(m, { queued: sim.queue.length, busy: sim.busy });
    }

    var bar = C.player({ onTick: tick, onReset: reset, interval: 250,
      label: function (n) { return "t = " + n + " s / " + LAB.duration + " s"; } });
    bar.total(STEPS);

    C.add(root, [
      el("p", { class: "csim-title", text: t("Lab 9's experiments, without the stack", "Os experimentos do lab 9, sem a stack") }),
      el("p", { class: "csim-sub", text: t("Pick a step of the lab, before or after its pattern; the player runs the k6 test and prints k6's summary.",
        "Escolha um passo do lab, antes ou depois do seu padrão; o player roda o teste do k6 e imprime o resumo do k6.") }),
      el("div", { class: "csim-row" }, [exp, after]),
      cmd,
      el("div", { class: "csim-cols" }, [el("div", { class: "csim-stage" }, svg), el("div", {}, [k6, chart])]),
      lg,
      note,
      bar
    ]);
    reset();
    return {};
  });
})();
