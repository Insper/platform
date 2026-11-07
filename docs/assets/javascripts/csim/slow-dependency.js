/*
 * A slow dependency, with and without timeout, retry and circuit breaker (2026.2, class "Reliability",
 * Resilience Patterns):
 *
 *   <div class="csim" data-sim="slow-dependency" data-fault="slow" data-latency="3000"
 *        data-timeout="off" data-retry="off" data-breaker="off"></div>
 *
 * The page's running example: the order service (Tomcat's default pool of 200 threads) receives
 * 60 POST /orders per second, each calling the product service (normally 50 ms), and 40 GET /orders
 * per second that never call product (20 ms). From t = 10 s to t = 70 s product degrades, as in the
 * chaos experiment of the class: it answers in `latency` ms ("slow", a Toxiproxy latency toxic) or
 * refuses the connection ("down", the proxy disabled). Each pattern is a switch with the values of
 * the page's application.yaml (CFG, checked against the page by the tests):
 *   - timeout: Feign read timeout 1 s (off: Feign's default of 60 s);
 *   - retry: 3 attempts, waits of 500 ms then 1 s, each ±50% (randomized wait), only for timeouts and
 *     connection errors; an open breaker is not retried; the thread waits during the backoff;
 *   - breaker: count-based window of the last 10 calls (10 at least), Open when ≥ 50% failed or
 *     ≥ 50% were slower than 500 ms, 30 s in Open, then Half-Open with 3 probe calls (the next call
 *     after the wait moves it, as Resilience4j does without the automatic transition).
 * Resilience4j's default order: Retry ( CircuitBreaker ( call ) ), so the breaker counts every attempt.
 *
 * Simplifications (not of the page): arrivals are Poisson; product's latency varies around its value
 * (log-normal, σ 0.3 normally, 0.15 while slow); a request that finds no free thread gets 503 at
 * once (the overview's sequence diagram; real Tomcat queues a few first); order's own work is
 * ignored. Every request draws its luck from its own seeded stream, so a switch changes only the
 * decisions, not the luck: the run is recomputed at once and the cursor stays.
 */
(function () {
  "use strict";
  var CFG = {
    threads: 200, postRate: 60, getRate: 40, getMs: 20, normalMs: 50,
    faultFrom: 10000, faultTo: 70000, run: 100000,
    readTimeout: 1000, defaultReadTimeout: 60000,
    attempts: 3, waitMs: 500, mult: 2, jitter: 0.5,
    window: 10, minCalls: 10, failRate: 50, slowMs: 500, slowRate: 50, openMs: 30000, probes: 3
  };
  var DEFAULTS = { fault: "slow", latency: 3000, timeout: false, retry: false, breaker: false, seed: 7 };

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /* the whole run, ms by ms: per-second series, breaker transitions and the fault-window summary */
  function run(o) {
    o = Object.assign({}, DEFAULTS, o || {});
    var SECS = CFG.run / 1000, END = CFG.run + 20000;
    var buckets = new Array(END + 1);
    function at(t, ev) { t = Math.max(0, Math.round(t)); if (t > END) return; (buckets[t] || (buckets[t] = [])).push(ev); }
    var S = { busy: [], busyAvg: [], calls: [], postOk: [], postFail: [], postOpen: [], postFull: [], getOk: [], getFull: [], state: [] };
    for (var k = 0; k < SECS; k++) { Object.keys(S).forEach(function (key) { S[key].push(0); }); }
    var events = [];

    /* arrivals: two Poisson streams */
    var ra = rng(o.seed * 7919 + 1), id = 0, t, reqs = [];
    for (t = 0; ; ) { t += -Math.log(1 - ra()) * 1000 / CFG.postRate; if (t >= CFG.run) break; reqs.push({ id: id++, kind: "post", t0: t }); }
    for (t = 0; ; ) { t += -Math.log(1 - ra()) * 1000 / CFG.getRate; if (t >= CFG.run) break; reqs.push({ id: id++, kind: "get", t0: t }); }
    reqs.forEach(function (q) { at(q.t0, { type: "arrive", q: q }); });

    var busy = 0, busyMs = 0;
    var br = { state: "closed", win: [], openUntil: 0, probesOut: 0, probeRes: [] };
    function setState(s, tm) { if (br.state === s) return; br.state = s; events.push({ t: tm, state: s }); }
    function permit(tm) {
      if (!o.breaker) return "ok";
      if (br.state === "open") { if (tm < br.openUntil) return "no"; setState("half", tm); br.probesOut = 0; br.probeRes = []; }
      if (br.state === "half") { if (br.probesOut >= CFG.probes) return "no"; br.probesOut++; return "probe"; }
      return "ok";
    }
    function rate(list, key) { return 100 * list.filter(function (x) { return x[key]; }).length / list.length; }
    function record(tm, res, probe) {
      if (!o.breaker) return;
      if (br.state === "closed" && !probe) {
        br.win.push(res); if (br.win.length > CFG.window) br.win.shift();
        if (br.win.length >= Math.min(CFG.minCalls, CFG.window) && (rate(br.win, "fail") >= CFG.failRate || rate(br.win, "slow") >= CFG.slowRate)) {
          setState("open", tm); br.openUntil = tm + CFG.openMs; br.win = [];
        }
      } else if (br.state === "half" && probe) {
        br.probeRes.push(res);
        if (br.probeRes.length >= CFG.probes) {
          if (rate(br.probeRes, "fail") >= CFG.failRate || rate(br.probeRes, "slow") >= CFG.slowRate) { setState("open", tm); br.openUntil = tm + CFG.openMs; }
          else { setState("closed", tm); br.win = []; }
        }
      }
    }
    function sec(tm) { return Math.min(SECS - 1, Math.floor(tm / 1000)); }
    function faulty(tm) { return tm >= CFG.faultFrom && tm < CFG.faultTo; }
    var post = [];   /* finished POST requests */
    var gets = [];

    function finish(q, tm, outcome) {
      busy--; q.t1 = tm; q.outcome = outcome;
      if (q.kind === "get") { S.getOk[sec(q.t0)]++; gets.push(q); return; }
      post.push(q);
      var s = sec(q.t0);
      if (outcome === "ok") S.postOk[s]++; else if (outcome === "open") S.postOpen[s]++; else S.postFail[s]++;
    }
    function attempt(q, tm) {
      var p = permit(tm);
      if (p === "no") { finish(q, tm, "open"); return; }
      q.n++;
      if (tm < CFG.run) S.calls[sec(tm)]++;
      var r = q.r, z = gauss(r), d, fail = false;
      if (faulty(tm)) {
        if (o.fault === "down") { d = 2; fail = true; }
        else d = o.latency * Math.exp(0.15 * z);
      } else d = CFG.normalMs * Math.exp(0.3 * z);
      var limit = o.timeout ? CFG.readTimeout : CFG.defaultReadTimeout;
      if (d > limit) { d = limit; fail = true; }
      at(tm + d, { type: "end", q: q, fail: fail, dur: d, probe: p === "probe" });
    }

    for (var now = 0; now <= END; now++) {
      busyMs += busy;
      if (now < CFG.run) {
        var s0 = sec(now);
        if (busy > S.busy[s0]) S.busy[s0] = busy;
        S.busyAvg[s0] += busy / 1000;
        if (now % 1000 === 999) S.state[s0] = br.state;
      }
      var list = buckets[now];
      if (!list) continue;
      for (var i = 0; i < list.length; i++) {
        var ev = list[i], q = ev.q;
        if (ev.type === "arrive") {
          if (busy >= CFG.threads) {
            q.t1 = now; q.outcome = "full";
            if (q.kind === "get") { S.getFull[sec(q.t0)]++; gets.push(q); } else { S.postFull[sec(q.t0)]++; post.push(q); }
            continue;
          }
          busy++;
          if (q.kind === "get") { at(now + CFG.getMs, { type: "done", q: q }); continue; }
          q.n = 0; q.r = rng(o.seed * 104729 + q.id * 31 + 3);
          attempt(q, now);
        } else if (ev.type === "done") {
          finish(q, now, "ok");
        } else if (ev.type === "end") {
          record(now, { fail: ev.fail, slow: !ev.fail && ev.dur >= CFG.slowMs }, ev.probe);
          if (!ev.fail) { finish(q, now, "ok"); continue; }
          if (o.retry && q.n < CFG.attempts) {
            var w = CFG.waitMs * Math.pow(CFG.mult, q.n - 1);
            w *= 1 - CFG.jitter + 2 * CFG.jitter * q.r();
            at(now + w, { type: "retry", q: q });
          } else finish(q, now, "fail");
        } else if (ev.type === "retry") {
          attempt(q, now);
        }
      }
      buckets[now] = null;
    }

    /* the fault window: requests that arrived in it */
    function inFault(q) { return faulty(q.t0); }
    var fp = post.filter(inFault), fg = gets.filter(inFault);
    var fs = CFG.faultFrom / 1000, fe = CFG.faultTo / 1000;
    var busyF = S.busyAvg.slice(fs, fe), callsF = S.calls.slice(fs, fe);
    var lat = fp.filter(function (q) { return q.outcome !== "full"; }).map(function (q) { return q.t1 - q.t0; }).sort(function (a, b) { return a - b; });
    var opened = events.filter(function (e) { return e.state === "open"; });
    var closedAfter = events.filter(function (e) { return e.state === "closed" && e.t >= CFG.faultTo; })[0];
    var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
    var summary = {
      busyAvg: sum(busyF) / busyF.length,
      busyPeak: Math.max.apply(null, S.busy.slice(fs, fe)),
      fullSeconds: S.busy.slice(fs, fe).filter(function (b) { return b >= CFG.threads; }).length,
      postOk: 100 * fp.filter(function (q) { return q.outcome === "ok"; }).length / fp.length,
      postFull: 100 * fp.filter(function (q) { return q.outcome === "full"; }).length / fp.length,
      getOk: 100 * fg.filter(function (q) { return q.outcome === "ok"; }).length / fg.length,
      callsPerSec: sum(callsF) / callsF.length,
      amplification: sum(callsF) / Math.max(1, fp.length),
      p95: lat.length ? lat[Math.min(lat.length - 1, Math.floor(0.95 * lat.length))] : 0,
      median: lat.length ? lat[Math.floor(0.5 * lat.length)] : 0,
      openAt: opened.length ? (opened[0].t - CFG.faultFrom) / 1000 : null,
      opens: opened.length,
      closedAt: closedAfter ? closedAfter.t / 1000 : null,
      steadyBusy: sum(S.busyAvg.slice(1, fs)) / (fs - 1)
    };
    return { opts: o, series: S, events: events, summary: summary };
  }

  /* numbers as each language writes them */
  function num(v, d, pt) { return v.toLocaleString(pt ? "pt-BR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  var API = { CFG: CFG, DEFAULTS: DEFAULTS, run: run, num: num };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, tr = C.t, el = C.el, s = C.s, PT = C.PT;
  var SECS = CFG.run / 1000;
  var L = 44, R = 630;

  C.style("slow-dependency", [
    ".md-typeset .csim-sd-fault { fill: color-mix(in srgb, var(--c-warn) 10%, var(--c-bg)); }",
    ".md-typeset .csim-sd-grid { stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-sd-cap { stroke: var(--c-bad); stroke-width: 1.2; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-sd-ref { stroke: var(--c-fg3); stroke-width: 1.2; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-sd-now { stroke: var(--c-accent); stroke-width: 1.5; }",
    ".md-typeset .csim-sd-poolbg { fill: var(--c-panel); stroke: var(--c-fg3); stroke-width: 1; }",
    ".md-typeset .csim-sd .csim-slider input[type=range] { width: 7rem; }"
  ].join("\n"));

  C.register("slow-dependency", function (root) {
    var o = C.opts(root, { fault: DEFAULTS.fault, latency: DEFAULTS.latency, timeout: false, retry: false, breaker: false, seed: DEFAULTS.seed });
    var state = { fault: o.fault, latency: o.latency, timeout: o.timeout, retry: o.retry, breaker: o.breaker, seed: o.seed };
    var res = run(state), cursor = 0;
    root.classList.add("csim-sd");

    var svg = s("svg", { viewBox: "0 0 640 330", role: "img", "aria-label": tr("Order threads, calls to product and breaker state over time", "Threads do order, chamadas ao product e estado do breaker ao longo do tempo") });
    var note = el("p", { class: "csim-note" });
    var logList = C.log(6);
    var st = C.stats([
      { key: "busy", label: tr("order threads busy (now)", "threads do order ocupadas (agora)") },
      { key: "calls", label: tr("calls to product per second (now)", "chamadas ao product por segundo (agora)") },
      { key: "post", label: tr("POST /orders OK during the fault", "POST /orders OK durante a falha") },
      { key: "get", label: tr("GET /orders OK during the fault", "GET /orders OK durante a falha") },
      { key: "state", label: tr("circuit breaker (now)", "circuit breaker (agora)") }
    ]);

    function recompute() { res = run(state); draw(); }
    var cFault = C.choice({ label: tr("Fault", "Falha"), value: state.fault, options: [
      { value: "slow", label: tr("product slow", "product lento") }, { value: "down", label: tr("product down", "product fora") }],
      onChange: function (v) { state.fault = v; sLat.style.display = v === "slow" ? "" : "none"; recompute(); } });
    var sLat = C.slider({ label: tr("Latency while slow", "Latência quando lento"), min: 500, max: 5000, step: 250, value: state.latency,
      fmt: function (v) { return num(v / 1000, v % 1000 ? 2 : 0, PT).replace(/0$/, "") + " s"; }, onInput: function (v) { state.latency = v; recompute(); } });
    if (state.fault !== "slow") sLat.style.display = "none";
    var tTo = C.toggle({ label: tr("timeout 1 s", "timeout 1 s"), checked: state.timeout, onChange: function (v) { state.timeout = v; recompute(); } });
    var tRe = C.toggle({ label: tr("retry ×3", "retry ×3"), checked: state.retry, onChange: function (v) { state.retry = v; recompute(); } });
    var tBr = C.toggle({ label: tr("circuit breaker", "circuit breaker"), checked: state.breaker, onChange: function (v) { state.breaker = v; recompute(); } });

    var bar = C.player({ interval: 300, onTick: function (n) { cursor = n; draw(); },
      onReset: function () { cursor = 0; draw(); }, onPrev: function (n) { cursor = n; draw(); },
      label: function (n) { return "t = " + n + " s / " + SECS + " s"; } });
    bar.total(SECS);

    function X(sec) { return L + (R - L) * sec / SECS; }
    var STATE_TXT = { closed: tr("Closed", "Fechado"), open: tr("Open", "Aberto"), half: tr("Half-Open", "Meio-aberto") };
    var STATE_TONE = { closed: "ok", open: "bad", half: "warn" };

    function chartPanel(top, h, values, max, cls, label, ref, refLabel) {
      var y = function (v) { return top + h - h * Math.min(1, v / max); };
      svg.appendChild(s("rect", { x: X(CFG.faultFrom / 1000), y: top, width: X(CFG.faultTo / 1000) - X(CFG.faultFrom / 1000), height: h, class: "csim-sd-fault" }));
      [0, 0.5, 1].forEach(function (f) {
        svg.appendChild(s("line", { x1: L, x2: R, y1: y(max * f), y2: y(max * f), class: "csim-sd-grid" }));
        svg.appendChild(s("text", { x: L - 4, y: y(max * f) + 3, "text-anchor": "end", class: "c-small" }, num(max * f, 0, PT)));
      });
      if (ref) {
        svg.appendChild(s("line", { x1: L, x2: R, y1: y(ref), y2: y(ref), class: ref === CFG.threads ? "csim-sd-cap" : "csim-sd-ref" }));
        svg.appendChild(s("text", { x: R - 2, y: y(ref) - 3, "text-anchor": "end", class: "c-small" }, refLabel));
      }
      svg.appendChild(s("text", { x: L + 2, y: top - 4, class: "c-small" }, label));
      var pts = [];
      for (var k = 0; k < Math.max(1, cursor); k++) pts.push(X(k + 0.5).toFixed(1) + "," + y(values[k]).toFixed(1));
      if (cursor > 0) svg.appendChild(s("polyline", { points: pts.join(" "), class: "csim-line " + cls }));
    }

    function draw() {
      var S = res.series, sm = res.summary, k = Math.max(0, cursor - 1);
      C.clear(svg);
      /* top: the call path */
      var stNow = cursor ? S.state[k] : "closed";
      var faultNow = cursor > CFG.faultFrom / 1000 && cursor <= CFG.faultTo / 1000;
      svg.appendChild(s("rect", { x: 8, y: 8, width: 120, height: 44, rx: 6, class: "c-box" }));
      svg.appendChild(s("text", { x: 68, y: 26, "text-anchor": "middle", class: "c-label" }, tr("users", "usuários")));
      svg.appendChild(s("text", { x: 68, y: 41, "text-anchor": "middle", class: "c-small" }, CFG.postRate + " POST/s · " + CFG.getRate + " GET/s"));
      svg.appendChild(s("line", { x1: 128, x2: 162, y1: 30, y2: 30, class: "c-wire on" }));
      var busyNow = cursor ? S.busy[k] : 0;
      svg.appendChild(s("rect", { x: 162, y: 8, width: 220, height: 44, rx: 6, class: "c-box " + (busyNow >= CFG.threads ? "bad" : busyNow > CFG.threads / 2 ? "warn" : "on") }));
      svg.appendChild(s("text", { x: 172, y: 24, class: "c-label" }, "order · " + CFG.threads + " threads"));
      svg.appendChild(s("rect", { x: 172, y: 32, width: 200, height: 10, rx: 2, class: "csim-sd-poolbg" }));
      svg.appendChild(s("rect", { x: 172, y: 32, width: 200 * Math.min(1, busyNow / CFG.threads), height: 10, rx: 2, class: busyNow >= CFG.threads ? "c-fill-bad" : busyNow > CFG.threads / 2 ? "c-fill-warn" : "c-fill-ink" }));
      svg.appendChild(s("line", { x1: 382, x2: 418, y1: 30, y2: 30, class: "c-wire " + (state.breaker && stNow === "open" ? "cut" : "on") }));
      if (state.breaker) {
        svg.appendChild(s("rect", { x: 384, y: 52, width: 120, height: 18, rx: 4, class: "c-box " + STATE_TONE[stNow] }));
        svg.appendChild(s("text", { x: 444, y: 65, "text-anchor": "middle", class: "c-small" }, tr("breaker: ", "breaker: ") + STATE_TXT[stNow]));
      }
      svg.appendChild(s("rect", { x: 418, y: 8, width: 212, height: 44, rx: 6, class: "c-box " + (faultNow ? (state.fault === "down" ? "down" : "warn") : "ok") }));
      svg.appendChild(s("text", { x: 428, y: 24, class: "c-label" }, "product"));
      svg.appendChild(s("text", { x: 428, y: 41, class: "c-small" }, faultNow
        ? (state.fault === "down" ? tr("down: connection refused", "fora: conexão recusada") : tr("slow: ", "lento: ") + num(state.latency / 1000, state.latency % 1000 ? 2 : 0, PT).replace(/0$/, "") + " s")
        : tr("healthy: ", "saudável: ") + CFG.normalMs + " ms"));

      /* charts */
      chartPanel(96, 90, S.busy, CFG.threads, "tone-ink", tr("order threads busy (peak per second)", "threads do order ocupadas (pico por segundo)"), CFG.threads, tr("pool full", "pool cheio"));
      var cmax = Math.max(100, Math.ceil(Math.max.apply(null, S.calls) / 50) * 50);
      chartPanel(212, 70, S.calls, cmax, "tone-accent", tr("calls per second reaching product", "chamadas por segundo que chegam ao product"), CFG.postRate, tr("60 POST/s", "60 POST/s"));
      /* breaker strip and time axis */
      var yS = 294;
      if (state.breaker) {
        for (var j = 0; j < cursor; j++) {
          svg.appendChild(s("rect", { x: X(j), y: yS, width: X(j + 1) - X(j) + 0.3, height: 8, class: "c-fill-" + STATE_TONE[S.state[j]] }));
        }
        svg.appendChild(s("text", { x: L - 4, y: yS + 7, "text-anchor": "end", class: "c-small" }, "breaker"));
      }
      for (var tk = 0; tk <= SECS; tk += 10) {
        svg.appendChild(s("text", { x: X(tk), y: 318, "text-anchor": "middle", class: "c-small" }, tk + " s"));
      }
      svg.appendChild(s("text", { x: X(40), y: 92, "text-anchor": "middle", class: "c-small" }, state.fault === "down" ? tr("product down", "product fora") : tr("product slow", "product lento")));
      if (cursor) svg.appendChild(s("line", { x1: X(cursor), x2: X(cursor), y1: 96, y2: 304, class: "csim-sd-now" }));

      /* stats */
      st.set("busy", cursor ? num(S.busy[k], 0, PT) + " / " + CFG.threads : "–", busyNow >= CFG.threads ? "bad" : busyNow > CFG.threads / 2 ? "warn" : "");
      st.set("calls", cursor ? num(S.calls[k], 0, PT) : "–", cursor && S.calls[k] > CFG.postRate * 1.5 ? "warn" : "");
      st.set("post", num(sm.postOk, 0, PT) + "%", sm.postOk > 99 ? "ok" : "bad");
      st.set("get", num(sm.getOk, 1, PT) + "%", sm.getOk > 99.9 ? "ok" : "bad");
      st.set("state", state.breaker ? STATE_TXT[stNow] : tr("off", "desligado"), state.breaker ? STATE_TONE[stNow] : "");

      /* log: breaker transitions and the fault, up to the cursor */
      logList.clear();
      var items = [{ t: CFG.faultFrom, txt: state.fault === "down" ? tr("product goes down", "product cai") : tr("product becomes slow", "product fica lento"), tone: "warn" },
        { t: CFG.faultTo, txt: tr("product is healthy again", "product volta a ficar saudável"), tone: "ok" }]
        .concat(res.events.map(function (e) { return { t: e.t, txt: tr("breaker → ", "breaker → ") + STATE_TXT[e.state], tone: STATE_TONE[e.state] }; }))
        .filter(function (e) { return e.t <= cursor * 1000; })
        .sort(function (a, b) { return a.t - b.t; });
      items.forEach(function (e) { logList.add("t = " + num(e.t / 1000, 1, PT) + " s · " + e.txt, e.tone); });

      /* the summary of the run (whole fault window) */
      var amp = num(sm.amplification, 1, PT), p95 = sm.p95 >= 1000 ? num(sm.p95 / 1000, 1, PT) + " s" : num(sm.p95, 0, PT) + " ms";
      note.textContent = tr(
        "During the fault (10–70 s): about " + num(sm.busyAvg, 0, false) + " threads busy on average (peak " + sm.busyPeak + "), " +
        num(sm.postOk, 0, false) + "% of POST /orders OK (p95 " + p95 + "), " + num(sm.getOk, 1, false) + "% of GET /orders OK although they never call product, " +
        amp + " calls to product per order." + (state.breaker && sm.openAt !== null ? " The breaker opened " + num(sm.openAt, 1, false) + " s after the fault began" +
        (sm.closedAt !== null ? " and closed again at t = " + num(sm.closedAt, 1, false) + " s." : ".") : ""),
        "Durante a falha (10–70 s): cerca de " + num(sm.busyAvg, 0, true) + " threads ocupadas em média (pico " + sm.busyPeak + "), " +
        num(sm.postOk, 0, true) + "% dos POST /orders OK (p95 " + p95 + "), " + num(sm.getOk, 1, true) + "% dos GET /orders OK embora nunca chamem o product, " +
        amp + " chamadas ao product por pedido." + (state.breaker && sm.openAt !== null ? " O breaker abriu " + num(sm.openAt, 1, true) + " s depois do início da falha" +
        (sm.closedAt !== null ? " e fechou de novo em t = " + num(sm.closedAt, 1, true) + " s." : ".") : ""));
      note.className = "csim-note " + (sm.getOk < 99.9 ? "csim-bad" : sm.postOk > 99 ? "csim-ok" : "csim-warn");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: tr("order → product: what a slow dependency does to the caller", "order → product: o que uma dependência lenta faz com quem chama") }),
      el("p", { class: "csim-sub", text: tr(
        "The page's numbers: 200 threads, 60 POST /orders per second calling product (normally 50 ms) and 40 GET /orders per second that do not. Product degrades from 10 s to 70 s. The switches use the page's application.yaml: read timeout 1 s, 3 attempts with backoff 500 ms → 1 s, breaker on the last 10 calls (50% failed or slower than 500 ms), 30 s open, 3 probes.",
        "Os números da página: 200 threads, 60 POST /orders por segundo que chamam o product (normalmente 50 ms) e 40 GET /orders por segundo que não chamam. O product degrada de 10 s a 70 s. As chaves usam o application.yaml da página: read timeout de 1 s, 3 tentativas com backoff de 500 ms → 1 s, breaker nas últimas 10 chamadas (50% com falha ou acima de 500 ms), 30 s aberto, 3 sondas.") }),
      el("div", { class: "csim-row" }, [cFault, sLat]),
      el("div", { class: "csim-row" }, [tTo, tRe, tBr]),
      el("div", { class: "csim-stage" }, svg),
      st,
      el("div", { class: "csim-cols" }, [logList, note]),
      bar
    ]);
    draw();
    return {};
  });
})();
