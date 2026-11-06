/*
 * A work queue and its consumers: Little's law and utilization (2027.1, class 9 — queues and pub/sub):
 *
 *   <div class="csim" data-sim="queue" data-lambda="167" data-workers="95" data-service="0.4"></div>
 *
 * Jobs (one PDF per confirmed order) arrive at rate λ (Poisson) and wait in a FIFO queue for one
 * of K workers; each job takes an exponential time with mean S (M/M/K). The stats measure, over
 * the last 60 s, L (jobs in the system), λ and W (time in the system), and check L = λ·W; the
 * curve shows the theoretical W for this K as utilization ρ = λ / (K / S) approaches 1. "On-sale
 * spike" triples λ for 20 s; the autoscaler adds workers from the backlog (KEDA-style), each
 * ready only after a cold start.
 */
(function () {
  "use strict";

  var BURST = 3, BURST_S = 20, COLD = 15, TARGET = 4, MAXK = 300, WIN = 60;

  function rand(st) {
    st.seed = (st.seed + 0x6D2B79F5) >>> 0;
    var x = Math.imul(st.seed ^ (st.seed >>> 15), 1 | st.seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }
  function expo(st, mean) { return -Math.log(1 - rand(st)) * mean; }

  function create(o) {
    var st = { t: 0, lambda: o.lambda, S: o.service, K: o.workers, autoscale: !!o.autoscale, seed: o.seed || 11,
      queue: [], qh: 0, workers: [], burstUntil: -1, buckets: [], cur: null, totals: { arrivals: 0, done: 0 } };
    for (var i = 0; i < st.K; i++) st.workers.push({ busy: false, until: 0, arr: 0, ready: 0, retire: false });
    st.nextArr = expo(st, 1 / rate(st));
    return st;
  }
  function rate(st) { return st.lambda * (st.t < st.burstUntil ? BURST : 1); }
  function waiting(st) { return st.queue.length - st.qh; }
  function busy(st) { var b = 0; st.workers.forEach(function (w) { if (w.busy) b++; }); return b; }
  function ready(st) { var r = 0; st.workers.forEach(function (w) { if (w.ready <= st.t && !w.retire) r++; }); return r; }

  function dispatch(st) {
    for (var i = 0; i < st.workers.length && waiting(st) > 0; i++) {
      var w = st.workers[i];
      if (w.busy || w.retire || w.ready > st.t) continue;
      w.busy = true; w.arr = st.queue[st.qh++]; w.until = st.t + expo(st, st.S);
    }
    if (st.qh > 5000) { st.queue = st.queue.slice(st.qh); st.qh = 0; }
  }

  /* resize the pool: new workers are ready after `cold` seconds; extra ones retire (busy ones finish first) */
  function resize(st, n, cold) {
    var live = st.workers.filter(function (w) { return !w.retire; });
    if (n > live.length) for (var i = live.length; i < n; i++) st.workers.push({ busy: false, until: 0, arr: 0, ready: st.t + (cold || 0), retire: false });
    else {
      var extra = live.length - n;
      live.slice().sort(function (a, b) { return (a.busy - b.busy) || (b.ready - a.ready); }).forEach(function (w) { if (extra > 0) { w.retire = true; extra--; } });
      st.workers = st.workers.filter(function (w) { return !(w.retire && !w.busy); });
    }
    dispatch(st);
  }

  /* advance one second of simulated time (event by event), then run the autoscaler */
  function step(st) {
    var end = st.t + 1, b = { arrivals: 0, done: 0, sumW: 0, area: 0 };
    while (true) {
      var nc = Infinity, wi = -1, nr = Infinity;
      for (var i = 0; i < st.workers.length; i++) {
        var w = st.workers[i];
        if (w.busy && w.until < nc) { nc = w.until; wi = i; }
        if (!w.busy && w.ready > st.t && w.ready < nr) nr = w.ready;
      }
      var next = Math.min(st.nextArr, nc, nr, end);
      b.area += (waiting(st) + busy(st)) * (next - st.t);
      st.t = next;
      if (next === end) break;
      if (next === st.nextArr) {
        st.queue.push(st.t); b.arrivals++;
        st.nextArr = st.t + expo(st, 1 / rate(st));
      } else if (next === nc) {
        var x = st.workers[wi];
        b.done++; b.sumW += st.t - x.arr; x.busy = false;
        if (x.retire) st.workers.splice(wi, 1);
      }
      dispatch(st);
    }
    st.t = Math.round(st.t);
    st.totals.arrivals += b.arrivals; st.totals.done += b.done;
    st.buckets.push(b);
    if (st.buckets.length > WIN) st.buckets.shift();
    if (st.autoscale) {
      var live = st.workers.filter(function (w) { return !w.retire; }).length;
      var want = Math.max(st.K, Math.min(MAXK, Math.ceil((waiting(st) + busy(st)) / TARGET)));
      if (want > live) resize(st, want, COLD);
      else if (want < live && waiting(st) === 0) resize(st, Math.max(want, live - 10), 0);
    }
    return b;
  }

  function spike(st) { st.burstUntil = st.t + BURST_S; st.nextArr = st.t + expo(st, 1 / rate(st)); }

  /* L, λ and W over the last 60 s */
  function little(st) {
    var a = 0, area = 0, d = 0, sw = 0, n = st.buckets.length;
    st.buckets.forEach(function (b) { a += b.arrivals; area += b.area; d += b.done; sw += b.sumW; });
    return { L: n ? area / n : 0, lambda: n ? a / n : 0, W: d ? sw / d : 0 };
  }
  function oldest(st) { return waiting(st) ? st.t - st.queue[st.qh] : 0; }
  function rho(lambda, K, S) { return lambda * S / K; }

  /* M/M/K: probability of waiting (Erlang C) and mean time in the system W = Wq + S */
  function erlangC(K, a) {
    if (a >= K) return 1;
    var B = 1;
    for (var k = 1; k <= K; k++) B = a * B / (k + a * B);
    return K * B / (K - a * (1 - B));
  }
  function theoryW(lambda, K, S) {
    var mu = 1 / S, a = lambda / mu;
    if (a >= K) return Infinity;
    return erlangC(K, a) / (K * mu - lambda) + S;
  }

  function run(o, secs, hook) {
    var st = create(o), peak = 0, peakAge = 0;
    for (var i = 0; i < secs; i++) {
      if (hook) hook(st);
      step(st);
      peak = Math.max(peak, waiting(st)); peakAge = Math.max(peakAge, oldest(st));
    }
    return { st: st, peak: peak, peakAge: peakAge };
  }

  var API = { create: create, step: step, spike: spike, resize: resize, little: little, waiting: waiting, busy: busy,
    oldest: oldest, rho: rho, erlangC: erlangC, theoryW: theoryW, run: run, BURST: BURST, BURST_S: BURST_S, COLD: COLD };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  function dec(v, d) { var x = v.toFixed(d); return C.PT ? x.replace(".", ",") : x; }
  function nf(v) { return Math.round(v).toLocaleString(C.PT ? "pt-BR" : "en"); }

  C.style("queue", [
    ".md-typeset .csim-qu-fill { fill: color-mix(in srgb, var(--c-warn) 45%, var(--c-bg)); transition: width .4s; }",
    ".md-typeset .csim-qu-fill.bad { fill: color-mix(in srgb, var(--c-bad) 50%, var(--c-bg)); }",
    ".md-typeset .csim-qu-w.busy { fill: var(--c-ink); }",
    ".md-typeset .csim-qu-w.idle { fill: var(--c-line); }",
    ".md-typeset .csim-qu-w.cold { fill: none; stroke: var(--c-fg3); stroke-dasharray: 2 1.5; }",
    ".md-typeset .csim-qu-curve { fill: none; stroke: var(--c-ink); stroke-width: 2; }",
    ".md-typeset .csim-qu-little { font-family: var(--md-code-font-family); font-size: .64rem; padding: .3rem .5rem; border-radius: .35rem; background: var(--c-panel); margin: .3rem 0; }",
    ".md-typeset .csim-qu-little b.ok { color: var(--c-ok); } .md-typeset .csim-qu-little b.warn { color: var(--c-warn); }"
  ].join("\n"));

  C.register("queue", function (root) {
    var o = C.opts(root, { lambda: 167, workers: 95, service: 0.4, autoscale: false, seed: 11 });
    var lambda = o.lambda, K = o.workers, auto = o.autoscale, st;
    var svg = s("svg", { viewBox: "0 0 640 190", role: "img", "aria-label": t("Producers, queue and workers", "Produtores, fila e workers") });
    var curve = s("svg", { viewBox: "0 0 320 130", class: "csim-chart", role: "img" });
    var lit = el("div", { class: "csim-qu-little" });
    var note = el("p", { class: "csim-note" });
    var stt = C.stats([
      { key: "rho", label: t("utilization ρ = λ·S / K", "utilização ρ = λ·S / K") },
      { key: "w", label: t("time in system W (60 s)", "tempo no sistema W (60 s)") },
      { key: "q", label: t("jobs waiting", "jobs esperando") },
      { key: "age", label: t("oldest job's age", "idade do job mais antigo") },
      { key: "k", label: t("workers ready (+ starting)", "workers prontos (+ subindo)") }
    ]);
    var ch = C.chart({ title: t("Jobs waiting in the queue", "Jobs esperando na fila"), len: 120, series: [{ label: t("waiting", "esperando"), cls: "tone-warn" }] });
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function reset() {
      st = create({ lambda: lambda, workers: K, service: o.service, autoscale: auto, seed: o.seed });
      ch.reset();
      for (var i = 0; i < 5; i++) step(st);   /* warm up, so W and L are not empty */
      intro();
      draw();
    }
    function intro() {
      var r = rho(lambda, K, o.service), w = theoryW(lambda, K, o.service);
      if (r >= 1) say(t("ρ = " + dec(r, 2) + ": jobs arrive faster than " + K + " workers can finish them. The backlog grows by about " + nf(lambda - K / o.service) + " jobs every second, forever — no amount of waiting fixes it.",
        "ρ = " + dec(r, 2) + ": os jobs chegam mais rápido do que " + K + " workers conseguem terminar. O backlog cresce cerca de " + nf(lambda - K / o.service) + " jobs por segundo, para sempre — esperar não resolve."), "bad");
      else say(t(nf(lambda) + " jobs/s × " + dec(o.service, 1) + " s each = " + dec(lambda * o.service, 0) + " workers busy on average, out of " + K + " (ρ = " + dec(r, 2) + "). Expected time in the system: " + dec(w, 2) + " s. Press play.",
        nf(lambda) + " jobs/s × " + dec(o.service, 1) + " s cada = " + dec(lambda * o.service, 0) + " workers ocupados em média, de " + K + " (ρ = " + dec(r, 2) + "). Tempo esperado no sistema: " + dec(w, 2) + " s. Dê play."), r > 0.95 ? "warn" : "");
    }

    function tick() {
      step(st);
      var q = waiting(st);
      ch.push([q]);
      if (st.t === st.burstUntil) say(t("The spike is over. Arrivals are back to " + nf(lambda) + "/s, and the backlog drains only at the spare capacity: " + nf(K / o.service) + " − " + nf(lambda) + " = " + nf(K / o.service - lambda) + " jobs/s" + (auto ? " — plus the workers the autoscaler added." : "."),
        "O pico acabou. As chegadas voltaram a " + nf(lambda) + "/s, e o backlog só escoa na capacidade de sobra: " + nf(K / o.service) + " − " + nf(lambda) + " = " + nf(K / o.service - lambda) + " jobs/s" + (auto ? " — mais os workers que o autoscaler adicionou." : ".")), "warn");
      draw();
    }

    function drawCurve(r, K) {
      C.clear(curve);
      var P = { l: 30, r: 8, t: 8, b: 20 }, Wd = 320, Hd = 130, xmax = 1.2, ymax = Math.max(4 * o.service, 2);
      function X(v) { return P.l + (Wd - P.l - P.r) * v / xmax; }
      function Y(v) { return P.t + (Hd - P.t - P.b) * (1 - Math.min(1, v / ymax)); }
      var g = s("g", { class: "csim-grid" });
      [0, 0.5, 1].forEach(function (f) {
        g.appendChild(s("line", { x1: P.l, x2: Wd - P.r, y1: Y(ymax * f), y2: Y(ymax * f) }));
        g.appendChild(s("text", { x: P.l - 4, y: Y(ymax * f) + 3, "text-anchor": "end" }, dec(ymax * f, 1) + (f === 1 ? " s" : "")));
      });
      [0, 0.5, 0.8, 1].forEach(function (v) { g.appendChild(s("text", { x: X(v), y: Hd - 6, "text-anchor": "middle" }, "ρ " + dec(v, 1))); });
      g.appendChild(s("line", { x1: X(1), x2: X(1), y1: P.t, y2: Hd - P.b, class: "dashed" }));
      curve.appendChild(g);
      var pts = [];
      for (var v = 0.02; v < 0.9995; v += 0.004) pts.push(X(v).toFixed(1) + "," + Y(theoryW(v * K / o.service, K, o.service)).toFixed(1));
      curve.appendChild(s("polyline", { class: "csim-qu-curve", points: pts.join(" ") }));
      var cy = r < 1 ? Y(theoryW(lambda, K, o.service)) : P.t;
      curve.appendChild(s("circle", { cx: X(Math.min(r, xmax)), cy: cy, r: 4.5, class: "c-dot " + (r >= 1 ? "bad" : r > 0.9 ? "" : "ok") }));
      var m = little(st);
    }

    function draw() {
      C.clear(svg);
      var q = waiting(st), b = busy(st), spiking = st.t < st.burstUntil;
      var ready_ = st.workers.filter(function (w) { return w.ready <= st.t && !w.retire; }).length, Ke = Math.max(1, ready_);
      var r = rho(lambda * (spiking ? BURST : 1), Ke, o.service);
      /* producer */
      svg.appendChild(s("rect", { x: 4, y: 64, width: 100, height: 56, rx: 6, class: spiking ? "c-box hot" : "c-box on" }));
      svg.appendChild(s("text", { x: 54, y: 86, "text-anchor": "middle", class: "c-label" }, "order"));
      svg.appendChild(s("text", { x: 54, y: 103, "text-anchor": "middle", class: "c-mono" + (spiking ? " c-bad" : "") }, "λ = " + nf(lambda * (spiking ? BURST : 1)) + "/s"));
      svg.appendChild(s("path", { d: "M106,92 H128", class: "c-wire on" }));
      /* queue */
      var scale = niceCeil(q);
      svg.appendChild(s("text", { x: 130, y: 56, class: "c-small" }, t("queue pdf-jobs (FIFO) · scale 0 … ", "fila pdf-jobs (FIFO) · escala 0 … ") + nf(scale)));
      svg.appendChild(s("rect", { x: 130, y: 64, width: 260, height: 56, rx: 4, class: "c-box" }));
      var fw = 258 * Math.min(1, q / scale);
      svg.appendChild(s("rect", { x: 389 - fw, y: 65, width: fw, height: 54, class: "csim-qu-fill" + (r >= 1 ? " bad" : "") }));
      for (var d = 0; d < Math.min(q, 24); d++) svg.appendChild(s("circle", { cx: 382 - d * 10.5, cy: 92, r: 3.5, class: "c-dot" }));
      svg.appendChild(s("text", { x: 260, y: 138, "text-anchor": "middle", class: "c-mono" }, nf(q) + t(" waiting · oldest ", " esperando · mais antigo ") + dec(oldest(st), 1) + " s"));
      svg.appendChild(s("path", { d: "M392,92 H414", class: "c-wire on" }));
      /* workers */
      var n = st.workers.length, cols = n > 200 ? 25 : 20, cell = 216 / cols, rows = Math.ceil(n / cols);
      var y0 = Math.max(4, 92 - rows * cell / 2);
      st.workers.forEach(function (w, i) {
        var cls = w.ready > st.t ? "cold" : w.busy ? "busy" : "idle";
        svg.appendChild(s("rect", { x: 418 + (i % cols) * cell, y: y0 + Math.floor(i / cols) * cell, width: cell - 1.5, height: cell - 1.5, rx: 1.5, class: "csim-qu-w " + cls }));
      });
      var top = Math.min(44, y0 - 4), bottom = Math.max(146, y0 + rows * cell + 16);
      svg.setAttribute("viewBox", "0 " + top + " 640 " + (bottom - top));
      svg.appendChild(s("text", { x: 526, y: y0 + rows * cell + 11, "text-anchor": "middle", class: "c-small" },
        b + t(" busy / ", " ocupados / ") + n + t(" workers · S = ", " workers · S = ") + dec(o.service, 1) + " s"));
      /* Little's law, measured over the last 60 s */
      var m = little(st), lw = m.lambda * m.W, okL = m.L > 0 && Math.abs(m.L - lw) / Math.max(m.L, 1) < 0.1;
      C.clear(lit);
      C.add(lit, [t("Little (last 60 s): L = ", "Little (últimos 60 s): L = "), el("b", { text: dec(m.L, 1) }), t(" in system  vs  λ·W = ", " no sistema  vs  λ·W = ") + dec(m.lambda, 0) + "/s × " + dec(m.W, 2) + " s = ",
        el("b", { text: dec(lw, 1) }), " ", el("b", { class: okL ? "ok" : "warn", text: okL ? "✓" : t("≠ (not steady: the backlog is changing)", "≠ (não estacionário: o backlog está mudando)") })]);
      stt.set("rho", dec(r, 2), r >= 1 ? "bad" : r > 0.85 ? "warn" : "ok");
      stt.set("w", dec(m.W, 2) + " s", m.W > 5 * o.service ? "bad" : m.W > 2 * o.service ? "warn" : "ok");
      stt.set("q", nf(q), q > 1000 ? "bad" : q > 50 ? "warn" : "ok");
      stt.set("age", dec(oldest(st), 1) + " s", oldest(st) > 10 ? "bad" : oldest(st) > 2 ? "warn" : "ok");
      stt.set("k", ready_ + (n > ready_ ? " +" + (n - ready_) : ""), auto && n > K ? "info" : "");
      drawCurve(r, Ke);
    }
    function niceCeil(m) {
      if (m <= 100) return 100;
      var p = Math.pow(10, Math.floor(Math.log10(m))), f = m / p;
      return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
    }

    var sL = C.slider({ label: "λ", min: 20, max: 300, value: lambda, fmt: function (v) { return v + "/s"; }, onInput: function (v) {
      lambda = v; st.lambda = v; st.nextArr = st.t + expo(st, 1 / rate(st)); intro(); draw(); } });
    var sK = C.slider({ label: t("Workers K", "Workers K"), min: 10, max: 200, value: K, onInput: function (v) {
      K = v; st.K = v; resize(st, v, 0); intro(); draw(); } });
    var bSpike = C.button(t("⚡ on-sale spike (3× for 20 s)", "⚡ pico de abertura (3× por 20 s)"), function () {
      spike(st);
      say(t("On-sale: " + nf(lambda * BURST) + " jobs/s for " + BURST_S + " s against a capacity of " + nf(K / o.service) + "/s. The queue absorbs the difference — as delay. Watch the oldest job's age.",
        "Abertura de vendas: " + nf(lambda * BURST) + " jobs/s por " + BURST_S + " s contra uma capacidade de " + nf(K / o.service) + "/s. A fila absorve a diferença — como atraso. Observe a idade do job mais antigo."), "warn");
      if (!player.running()) player.play();
      draw();
    }, { tone: "bad" });
    var tAuto = C.toggle({ label: t("scale workers on backlog", "escalar workers pelo backlog"), checked: auto,
      title: t("KEDA-style: one worker per " + TARGET + " jobs in the system, ready after a " + COLD + " s cold start", "Estilo KEDA: um worker a cada " + TARGET + " jobs no sistema, pronto após " + COLD + " s de cold start"),
      onChange: function (v) { auto = v; st.autoscale = v; if (!v) resize(st, K, 0); draw(); } });
    var player = C.player({ interval: 500, onTick: tick, onReset: reset, label: function () { return "t = " + (st ? st.t : 0) + " s"; } });

    C.add(root, [
      el("p", { class: "csim-title", text: t("A queue and its workers: when does waiting explode?", "Uma fila e seus workers: quando a espera explode?") }),
      el("p", { class: "csim-sub", text: t("Each confirmed order queues one ticket PDF; K workers take " + dec(o.service, 1) + " s per PDF on average (exponential). One tick = one second.",
        "Cada pedido confirmado enfileira um PDF de ingressos; K workers levam " + dec(o.service, 1) + " s por PDF em média (exponencial). Um tick = um segundo.") }),
      el("div", { class: "csim-row" }, [sL, sK, bSpike, tAuto]),
      el("div", { class: "csim-stage" }, svg),
      lit,
      stt,
      el("div", { class: "csim-cols" }, [ch, el("figure", { class: "csim-fig" }, [el("figcaption", { text: t("Theory (M/M/K): W versus ρ for the ready workers · ● now", "Teoria (M/M/K): W versus ρ para os workers prontos · ● agora") }), curve])]),
      note,
      player
    ]);
    reset();
    return { destroy: function () { player.pause(); } };
  });
})();
