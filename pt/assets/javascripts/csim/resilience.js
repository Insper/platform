/*
 * Timeout, retry and circuit breaker on order → payment (2027.1, Reliability — patterns):
 *
 *   <div class="csim" data-sim="resilience" data-latency="4000" data-errors="0"
 *        data-timeout="off" data-retries="off" data-breaker="off"></div>
 *
 * `order` (lab 9's Tomcat pool) receives lab 9's payment rate and calls the payment provider, which
 * degrades: its latency (200 ms → 4 s, the story's 10:02) and error rate are sliders that act on
 * the running simulation. Each pattern is a switch with lab 9's values (LAB below): the read
 * timeout; Resilience4j's retry with exponential backoff and jitter; a count-based circuit breaker
 * (sliding window, minimum calls, failure and slow-call thresholds, wait in open, half-open probes).
 * The thread pool, the breaker's state machine and the load the provider receives are drawn live.
 */
(function () {
  "use strict";

  var DT = 50, KEEP = 10000;   /* simulation step; history kept for the metrics (ms) */
  /* lab 9: services/order/…/application.yaml (Tomcat threads, read timeout, resilience4j) and load/pay-under-chaos.js (rate) */
  var LAB = { rate: 20, threads: 50, timeoutMs: 1000, attempts: 3, backoff: 200, mult: 2, jitter: 0.5,
    window: 20, minCalls: 10, failRate: 0.5, slowMs: 800, slowRate: 0.5, openMs: 10000, probes: 3 };

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* o: {latency ms, errors 0..1, timeout, retries, breaker (booleans), seed} + any LAB override */
  function create(o) {
    var sim = { now: 0, r: rng(o.seed || 5), reqs: [], provider: [], events: [], done: [], starts: [], arrivals: [],
      latency: o.latency, errors: o.errors || 0, timeout: !!o.timeout, retries: !!o.retries, breaker: !!o.breaker,
      cb: { state: "closed", win: [], since: 0, permits: 0, probes: [] }, rejected: 0 };
    Object.keys(LAB).forEach(function (k) { sim[k] = o[k] !== undefined ? o[k] : LAB[k]; });
    sim.next = gap(sim);
    return sim;
  }
  function gap(sim) { return (0.5 + sim.r()) * 1000 / sim.rate; }   /* steady arrivals with a little jitter */

  function emit(sim, kind, text) { sim.events.push({ t: sim.now, kind: kind, text: text }); }

  function setState(sim, state, why) {
    var cb = sim.cb, from = cb.state;
    cb.state = state; cb.since = sim.now; cb.win = []; cb.probes = [];
    cb.permits = state === "half" ? sim.probes : 0;
    emit(sim, state, { from: from, to: state, why: why });
  }

  /* the breaker allows a call? (also moves open → half-open when the wait is over) */
  function permit(sim) {
    if (!sim.breaker) return true;
    var cb = sim.cb;
    if (cb.state === "open" && sim.now - cb.since >= sim.openMs) setState(sim, "half", null);
    if (cb.state === "closed") return true;
    if (cb.state === "half" && cb.permits > 0) { cb.permits--; return true; }
    return false;
  }

  function record(sim, fail, slow) {
    if (!sim.breaker) return;
    var cb = sim.cb, rec = { fail: fail, slow: slow };
    if (cb.state === "closed") {
      cb.win.push(rec);
      if (cb.win.length > sim.window) cb.win.shift();
      if (cb.win.length >= sim.minCalls) {
        var f = cb.win.filter(function (x) { return x.fail; }).length / cb.win.length;
        var s = cb.win.filter(function (x) { return x.slow; }).length / cb.win.length;
        if (f >= sim.failRate || s >= sim.slowRate) setState(sim, "open", { fail: f, slow: s, n: cb.win.length });
      }
    } else if (cb.state === "half") {
      cb.probes.push(rec);
      if (cb.probes.length >= sim.probes) {
        var bad = cb.probes.filter(function (x) { return x.fail || x.slow; }).length;
        var pf = cb.probes.filter(function (x) { return x.fail; }).length / cb.probes.length;
        var ps = cb.probes.filter(function (x) { return x.slow; }).length / cb.probes.length;
        setState(sim, pf >= sim.failRate || ps >= sim.slowRate ? "open" : "closed", { probes: cb.probes.length, bad: bad });
      }
    }
  }

  /* start an attempt of request q (or fail it fast if the breaker refuses) */
  function attempt(sim, q) {
    if (!permit(sim)) { finish(sim, q, "fast"); return; }
    q.attempt++;
    var dur = sim.latency * (0.7 + 0.6 * sim.r());
    var err = sim.r() < sim.errors;
    if (err) dur = Math.min(dur, 300);              /* a 5xx comes back quickly */
    sim.provider.push(sim.now + dur);               /* the provider works until then, even if we gave up */
    sim.starts.push(sim.now);
    var cut = sim.timeout && dur > sim.timeoutMs;
    q.phase = "call";
    q.until = sim.now + (cut ? sim.timeoutMs : dur);
    q.result = cut ? "timeout" : err ? "error" : "ok";
    q.dur = cut ? sim.timeoutMs : dur;
  }

  function finish(sim, q, outcome) {
    q.phase = "done";
    sim.done.push({ t: sim.now, outcome: outcome, took: sim.now - q.arr });
  }

  function backoff(sim, n) {
    return sim.backoff * Math.pow(sim.mult, n - 1) * (1 + sim.jitter * (2 * sim.r() - 1));
  }

  function substep(sim) {
    sim.now += DT;
    var t = sim.now;
    /* attempts that end now */
    sim.reqs.forEach(function (q) {
      if (q.phase === "call" && q.until <= t) {
        var fail = q.result !== "ok", slow = q.dur > sim.slowMs;
        record(sim, fail, slow);
        if (!fail) finish(sim, q, "ok");
        else if (sim.retries && q.attempt < sim.attempts) { q.phase = "wait"; q.until = t + backoff(sim, q.attempt); q.retried = true; }
        else finish(sim, q, q.result);
      } else if (q.phase === "wait" && q.until <= t) attempt(sim, q);
    });
    sim.reqs = sim.reqs.filter(function (q) { return q.phase !== "done"; });
    if (sim.breaker && sim.cb.state === "open" && t - sim.cb.since >= sim.openMs) setState(sim, "half", null);
    /* new payments: each needs a free thread */
    while (sim.next <= t) {
      sim.arrivals.push(sim.next);
      if (sim.reqs.length >= sim.threads) { sim.rejected++; sim.done.push({ t: t, outcome: "nothread", took: 0 }); }
      else { var q = { arr: sim.next, attempt: 0 }; sim.reqs.push(q); attempt(sim, q); }
      sim.next += gap(sim);
    }
    sim.provider = sim.provider.filter(function (x) { return x > t; });
    var old = t - KEEP;
    ["done", "starts", "arrivals"].forEach(function (k) { while (sim[k].length && (sim[k][0].t !== undefined ? sim[k][0].t : sim[k][0]) < old) sim[k].shift(); });
  }

  /* how long one payment holds its thread when every attempt times out: attempts × timeout + the backoffs */
  function holdMs(sim) {
    var h = sim.attempts * sim.timeoutMs;
    for (var n = 1; n < sim.attempts; n++) h += sim.backoff * Math.pow(sim.mult, n - 1);
    return h;
  }

  function advance(sim, ms) { for (var i = 0; i < ms / DT; i++) substep(sim); }

  function metrics(sim, span) {
    span = span || 5000;
    var from = sim.now - span, c = { ok: 0, timeout: 0, error: 0, fast: 0, nothread: 0 }, n = 0;
    sim.done.forEach(function (d) { if (d.t > from) { c[d.outcome]++; n++; } });
    var calls = sim.starts.filter(function (x) { return x > sim.now - 1000; }).length;
    var callsSpan = sim.starts.filter(function (x) { return x > from; }).length;
    var arr = sim.arrivals.filter(function (x) { return x > from; }).length;
    return { success: n ? c.ok / n : 1, counts: c, finished: n, busy: sim.reqs.length,
      calling: sim.reqs.filter(function (q) { return q.phase === "call"; }).length,
      waiting: sim.reqs.filter(function (q) { return q.phase === "wait"; }).length,
      callsPerSec: calls, amplification: arr ? callsSpan / arr : 0, providerInFlight: sim.provider.length, breaker: sim.cb.state };
  }

  var API = { create: create, advance: advance, metrics: metrics, backoff: backoff, holdMs: holdMs, LAB: LAB };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var TICK = 250, STEPS = 240;
  var SNAME = { closed: t("closed", "fechado"), open: t("open", "aberto"), half: t("half-open", "semiaberto") };
  function dec(v, d) { return v.toFixed(d).replace(".", C.PT ? "," : "."); }
  function secs(ms) { return dec(ms / 1000, 1) + " s"; }

  C.style("resilience", [
    ".md-typeset .csim-rs-th { fill: var(--c-line); }",
    ".md-typeset .csim-rs-th.call { fill: var(--c-warn); }",
    ".md-typeset .csim-rs-th.wait { fill: color-mix(in srgb, var(--c-warn) 40%, var(--c-bg)); }",
    ".md-typeset .csim-rs-th.full { fill: var(--c-bad); }",
    ".md-typeset .csim-rs-st { fill: var(--c-bg); stroke: var(--c-fg3); stroke-width: 1.2; }",
    ".md-typeset .csim-rs-st.closed { fill: color-mix(in srgb, var(--c-ok) 22%, var(--c-bg)); stroke: var(--c-ok); stroke-width: 2.4; }",
    ".md-typeset .csim-rs-st.open { fill: color-mix(in srgb, var(--c-bad) 22%, var(--c-bg)); stroke: var(--c-bad); stroke-width: 2.4; }",
    ".md-typeset .csim-rs-st.half { fill: color-mix(in srgb, var(--c-warn) 22%, var(--c-bg)); stroke: var(--c-warn); stroke-width: 2.4; }",
    ".md-typeset .csim-rs-off { opacity: .35; }",
    ".md-typeset .csim .c-dot.csim-rs-slow { fill: var(--c-warn); }",
    ".md-typeset .csim-rs-arrow { stroke: var(--c-fg3); stroke-width: 1; fill: none; marker-end: url(#csim-rs-head); }",
    ".md-typeset .csim-rs-head { fill: var(--c-fg3); }"
  ].join("\n"));

  C.register("resilience", function (root) {
    var o = C.opts(root, { latency: 4000, errors: 0, timeout: false, retries: false, breaker: false });
    var sim, prevState;

    var svg = s("svg", { viewBox: "0 0 380 202", role: "img", "aria-label": t("order calling the payment provider", "order chamando o provedor de pagamento") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(6);
    var st = C.stats([
      { key: "ok", label: t("payments OK (last 5 s)", "pagamentos OK (últimos 5 s)") },
      { key: "busy", label: t("threads busy (of " + LAB.threads + ")", "threads ocupadas (de " + LAB.threads + ")") },
      { key: "load", label: t("calls/s to the provider", "chamadas/s ao provedor") },
      { key: "cb", label: t("breaker", "disjuntor") }
    ]);
    var chart = C.chart({ series: [
      { label: t("payments OK %", "pagamentos OK %"), cls: "tone-ok" },
      { label: t("threads busy", "threads ocupadas"), cls: "tone-warn" },
      { label: t("calls/s to the provider", "chamadas/s ao provedor"), cls: "tone-ink" }], max: 100, len: STEPS });

    var lat = C.slider({ label: t("Provider latency", "Latência do provedor"), min: 200, max: 5000, step: 100, value: o.latency,
      fmt: secs, onInput: function (v) { sim.latency = v; draw(); } });
    var err = C.slider({ label: t("Provider errors", "Erros do provedor"), min: 0, max: 100, step: 5, value: Math.round(o.errors),
      fmt: function (v) { return v + "%"; }, onInput: function (v) { sim.errors = v / 100; draw(); } });
    var swT = C.toggle({ label: "timeout " + dec(LAB.timeoutMs / 1000, LAB.timeoutMs % 1000 ? 1 : 0) + " s", checked: o.timeout, onChange: function (v) { sim.timeout = v; draw(); } });
    var swR = C.toggle({ label: t(LAB.attempts + " attempts, backoff + jitter", LAB.attempts + " tentativas, backoff + jitter"), checked: o.retries, onChange: function (v) { sim.retries = v; draw(); } });
    var swB = C.toggle({ label: t("circuit breaker", "circuit breaker"), checked: o.breaker,
      onChange: function (v) { sim.breaker = v; sim.cb = { state: "closed", win: [], since: sim.now, permits: 0, probes: [] }; draw(); } });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function reset() {
      sim = create({ latency: lat.get(), errors: err.get() / 100, timeout: swT.get(), retries: swR.get(), breaker: swB.get(), seed: 5 });
      prevState = "closed";
      chart.reset(); lg.clear();
      draw();
    }

    function tick() {
      var nEv = sim.events.length;
      advance(sim, TICK);
      sim.events.slice(nEv).forEach(function (e) {
        var w = e.text.why, txt = "t=" + secs(e.t) + "  " + SNAME[e.text.from] + " → " + SNAME[e.text.to];
        if (w && w.n) txt += t(" (" + Math.round(100 * w.fail) + "% failed, " + Math.round(100 * w.slow) + "% slow)", " (" + Math.round(100 * w.fail) + "% falharam, " + Math.round(100 * w.slow) + "% lentas)");
        if (w && w.probes) txt += t(" (" + w.bad + " of " + w.probes + " probes bad)", " (" + w.bad + " de " + w.probes + " sondas ruins)");
        lg.add(txt, e.text.to === "open" ? "bad" : e.text.to === "half" ? "warn" : "ok");
      });
      var m = metrics(sim);
      chart.push([100 * m.success, m.busy, m.callsPerSec]);
      draw();
    }

    function narrate(m) {
      var L = sim.latency;
      if (sim.now === 0) return say(t("At 10:02 the provider answers in " + secs(L) + " instead of 200 ms. Press play: " + sim.rate + " payments/s arrive at order.",
        "Às 10:02 o provedor responde em " + secs(L) + " em vez de 200 ms. Aperte play: chegam " + sim.rate + " pagamentos/s ao order."), "");
      if (sim.breaker && m.breaker === "open") return say(t("The breaker is open: payments fail fast (503, seats stay held) without touching the network. Threads are free and the provider gets " +
        m.callsPerSec + " calls/s — room to recover. In " + secs(Math.max(0, sim.openMs - (sim.now - sim.cb.since))) + " it lets " + sim.probes + " probes through.",
        "O disjuntor está aberto: os pagamentos falham rápido (503, assentos seguem reservados) sem tocar a rede. As threads estão livres e o provedor recebe " +
        m.callsPerSec + " chamadas/s — espaço para se recuperar. Em " + secs(Math.max(0, sim.openMs - (sim.now - sim.cb.since))) + " ele deixa passar " + sim.probes + " sondas."), "warn");
      if (m.busy >= sim.threads - 3 || m.counts.nothread > 0) return say(t("All " + sim.threads + " threads are busy waiting on the provider: new payments get no thread — and neither does GET /orders, which never calls payment. " +
        (sim.timeout ? "The timeout bounds each attempt, but the retries keep every thread busy for " + secs(holdMs(sim)) + "." : "Little's Law: " + sim.rate + "/s × " + secs(L) + " = " + Math.round(sim.rate * L / 1000) + " threads needed."),
        "As " + sim.threads + " threads estão ocupadas esperando o provedor: novos pagamentos não ganham thread — nem o GET /orders, que nunca chama o payment. " +
        (sim.timeout ? "O timeout limita cada tentativa, mas as retentativas prendem cada thread por " + secs(holdMs(sim)) + "." : "Lei de Little: " + sim.rate + "/s × " + secs(L) + " = " + Math.round(sim.rate * L / 1000) + " threads necessárias.")), "bad");
      if (m.amplification > 1.5) return say(t("Retries multiply the load: the provider receives " + dec(m.amplification, 1) + "× the payments it would get, exactly while it is struggling.",
        "As retentativas multiplicam a carga: o provedor recebe " + dec(m.amplification, 1) + "× os pagamentos que receberia, justamente quando está com dificuldade."), "warn");
      if (m.success < 0.5) return say(t("Threads are safe (" + m.busy + " busy), but " + Math.round(100 * (1 - m.success)) + "% of payments fail: a timeout does not make the provider faster, it only stops order from dying with it.",
        "As threads estão a salvo (" + m.busy + " ocupadas), mas " + Math.round(100 * (1 - m.success)) + "% dos pagamentos falham: o timeout não deixa o provedor mais rápido, só impede que o order morra junto."), "warn");
      return say(t(Math.round(100 * m.success) + "% of payments succeed with " + m.busy + " threads busy and " + m.callsPerSec + " calls/s to the provider.",
        Math.round(100 * m.success) + "% dos pagamentos dão certo com " + m.busy + " threads ocupadas e " + m.callsPerSec + " chamadas/s ao provedor."), m.success > 0.9 ? "ok" : "warn");
    }

    function draw() {
      var m = metrics(sim);
      C.clear(svg);
      svg.appendChild(s("defs", {}, s("marker", { id: "csim-rs-head", viewBox: "0 0 6 6", refX: 5, refY: 3, markerWidth: 5, markerHeight: 5, orient: "auto" },
        s("path", { d: "M0,0 L6,3 L0,6 z", class: "csim-rs-head" }))));
      /* order and its thread pool */
      var full = m.busy >= sim.threads;
      svg.appendChild(s("rect", { x: 4, y: 8, width: 132, height: 150, rx: 6, class: "c-box " + (full ? "bad" : "on") }));
      svg.appendChild(s("text", { x: 70, y: 26, "text-anchor": "middle", class: "c-label" }, "order"));
      svg.appendChild(s("text", { x: 70, y: 40, "text-anchor": "middle", class: "c-small" }, sim.threads + t(" threads", " threads")));
      var calling = m.calling, waiting = m.waiting;
      for (var i = 0; i < sim.threads; i++) {
        var cls = i < calling ? (full ? "full" : "call") : i < calling + waiting ? "wait" : "";
        svg.appendChild(s("rect", { x: 14 + (i % 10) * 11.4, y: 50 + Math.floor(i / 10) * 11.4, width: 9.4, height: 9.4, rx: 1.5, class: "csim-rs-th " + cls }));
      }
      svg.appendChild(s("rect", { x: 14, y: 118, width: 8, height: 8, class: "csim-rs-th call" }));
      svg.appendChild(s("text", { x: 25, y: 125, class: "c-small" }, t("waiting on the provider", "esperando o provedor")));
      svg.appendChild(s("rect", { x: 14, y: 132, width: 8, height: 8, class: "csim-rs-th wait" }));
      svg.appendChild(s("text", { x: 25, y: 139, class: "c-small" }, t("backoff before a retry", "backoff antes de retentar")));
      svg.appendChild(s("text", { x: 70, y: 172, "text-anchor": "middle", class: "c-small" + (sim.rejected ? " c-bad" : "") }, t("no thread: ", "sem thread: ") + sim.rejected));
      /* provider */
      var slow = sim.latency > sim.slowMs || sim.errors > 0.2;
      svg.appendChild(s("rect", { x: 290, y: 50, width: 86, height: 70, rx: 6, class: "c-box " + (slow ? "warn" : "ok") }));
      svg.appendChild(s("text", { x: 333, y: 68, "text-anchor": "middle", class: "c-label" }, t("provider", "provedor")));
      svg.appendChild(s("text", { x: 333, y: 84, "text-anchor": "middle", class: "c-small" }, secs(sim.latency) + " · " + Math.round(100 * sim.errors) + "% err"));
      svg.appendChild(s("text", { x: 333, y: 100, "text-anchor": "middle", class: "c-small" }, m.providerInFlight + t(" in progress", " em curso")));
      var open = sim.breaker && m.breaker === "open";
      svg.appendChild(s("line", { x1: 136, x2: 290, y1: 85, y2: 85, class: "c-wire " + (open ? "cut" : "on"), "stroke-width": open ? 1.5 : (1 + Math.min(6, m.callsPerSec / 10)).toFixed(1) }));
      svg.appendChild(s("text", { x: 213, y: 80, "text-anchor": "middle", class: "c-small" }, m.callsPerSec + t(" calls/s", " chamadas/s")));
      /* breaker: three states */
      var g = s("g", { class: sim.breaker ? "" : "csim-rs-off" });
      var P = { closed: [172, 134], open: [254, 134], half: [213, 180] };
      [["closed", "open", -8], ["open", "half", 0], ["half", "closed", 0], ["half", "open", 8]].forEach(function (e) {
        var a = P[e[0]], b = P[e[1]], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.sqrt(dx * dx + dy * dy);
        var ux = dx / d, uy = dy / d, off = e[2];
        g.appendChild(s("line", { x1: a[0] + ux * 19 - uy * off * 0.5, y1: a[1] + uy * 19 + ux * off * 0.5 + (e[2] < 0 ? off : 0),
          x2: b[0] - ux * 21 - uy * off * 0.5, y2: b[1] - uy * 21 + ux * off * 0.5 + (e[2] < 0 ? off : 0), class: "csim-rs-arrow" }));
      });
      Object.keys(P).forEach(function (k) {
        var on = sim.breaker && m.breaker === k;
        g.appendChild(s("circle", { cx: P[k][0], cy: P[k][1], r: 17, class: "csim-rs-st " + (on ? k : "") }));
        g.appendChild(s("text", { x: P[k][0], y: P[k][1] + 3, "text-anchor": "middle", class: "c-small" }, SNAME[k]));
      });
      /* the breaker's sliding window: the last outcomes */
      var win = sim.cb.state === "half" ? sim.cb.probes : sim.cb.win;
      for (var k = 0; k < sim.window; k++) {
        var r = win[k];
        g.appendChild(s("circle", { cx: 150 + k * 6.8, cy: 100, r: 2.4, class: "c-dot " + (r ? (r.fail ? "bad" : r.slow ? "csim-rs-slow" : "ok") : "mute") }));
      }
      g.appendChild(s("text", { x: 213, y: 112, "text-anchor": "middle", class: "c-small" }, sim.breaker ? t("last " + sim.window + " calls", "últimas " + sim.window + " chamadas") : t("no circuit breaker", "sem circuit breaker")));
      svg.appendChild(g);

      st.set("ok", sim.now ? Math.round(100 * m.success) + "%" : "–", m.success > 0.9 ? "ok" : m.success > 0.5 ? "warn" : "bad");
      st.set("busy", String(m.busy), m.busy >= sim.threads ? "bad" : m.busy > 30 ? "warn" : "ok");
      st.set("load", m.callsPerSec + (m.amplification > 1.05 ? " (" + dec(m.amplification, 1) + "×)" : ""), m.amplification > 1.5 ? "bad" : m.amplification > 1.05 ? "warn" : "");
      st.set("cb", sim.breaker ? SNAME[m.breaker] : t("off", "desligado"), !sim.breaker ? "" : m.breaker === "closed" ? "ok" : m.breaker === "open" ? "bad" : "warn");
      prevState = m.breaker;
      narrate(m);
    }

    var bar = C.player({ onTick: tick, onReset: reset, interval: 250,
      label: function (n) { return "t = " + secs(n * TICK); } });
    bar.total(STEPS);

    C.add(root, [
      el("p", { class: "csim-title", text: t("What stops a slow provider from taking order down with it?", "O que impede um provedor lento de derrubar o order junto?") }),
      el("p", { class: "csim-sub", text: t("Each square is one of order's threads. The patterns use lab 9's values; change the provider while it runs.",
        "Cada quadrado é uma thread do order. Os padrões usam os valores do lab 9; mude o provedor com a simulação rodando.") }),
      el("div", { class: "csim-row" }, [lat, err]),
      el("div", { class: "csim-row" }, [swT, swR, swB]),
      el("div", { class: "csim-cols" }, [el("div", { class: "csim-stage" }, svg), el("div", {}, [st, chart, lg])]),
      note,
      bar
    ]);
    reset();
    return {};
  });
})();
