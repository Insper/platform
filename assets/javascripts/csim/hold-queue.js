/*
 * The knee, played (2027.1, class 2 — queueing):
 *
 *   <div class="csim" data-sim="hold-queue" data-servers="1" data-rho="70" data-arrivals="random"></div>
 *
 * Seat holds arrive at the inventory database and wait in one FIFO queue for one of c servers
 * (connections that do useful work, or cores); each hold keeps a server busy for an exponential time
 * with mean S = 5 ms, the service time of the class's capacity check. The arrival rate follows from the
 * chosen utilization: λ = ρ · c / S. Arrivals are steady (a waiting room admits at a fixed rate,
 * Cₐ = 0), random (Poisson, Cₐ = 1) or bursty (fans clicking in waves: a hyperexponential with Cₐ² = 4).
 * Every change of a control starts a new seeded experiment; the finished one leaves a dot on the
 * curve (measured mean R) next to the M/M/c theory for random arrivals (Erlang C). The stat tiles
 * measure R (mean and p99), the number in the system L and check Little's law L = λ · W.
 */
(function () {
  "use strict";

  var S = 0.005, SEED = 2027, CA2_BURSTY = 4;

  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ theory */

  /* Erlang C: the probability that an arrival waits, M/M/c at utilization rho */
  function erlangC(c, rho) {
    var a = c * rho, term = 1, sum = 0;
    for (var k = 0; k < c; k++) { if (k > 0) term *= a / k; sum += term; }
    var top = term * a / c / (1 - rho);
    return top / (sum + top);
  }
  /* mean response time of M/M/c, in seconds */
  function mmcR(c, rho) { return S + erlangC(c, rho) * S / (c * (1 - rho)); }

  /* ------------------------------------------------------------------ model */

  function create(o) {
    o = o || {};
    var c = o.servers || 1, rho = (o.rho || 70) / 100;
    var st = { c: c, rho: rho, lambda: rho * c / S, arrivals: o.arrivals || "random", rand: rngOf(o.seed || SEED),
      t: 0, queue: [], busy: [], done: 0, lat: [], area: 0, last: 0, maxQ: 0 };
    for (var i = 0; i < c; i++) st.busy.push(null);
    st.nextArr = gap(st);
    return st;
  }
  function expo(st, mean) { return -Math.log(1 - st.rand()) * mean; }
  function gap(st) {
    var m = 1 / st.lambda;
    if (st.arrivals === "steady") return m;
    if (st.arrivals === "bursty") {
      /* balanced two-phase hyperexponential with mean m and squared coefficient of variation CA2_BURSTY */
      var p = 0.5 * (1 + Math.sqrt((CA2_BURSTY - 1) / (CA2_BURSTY + 1)));
      return st.rand() < p ? expo(st, m / (2 * p)) : expo(st, m / (2 * (1 - p)));
    }
    return expo(st, m);
  }
  function inSystem(st) { var n = st.queue.length; st.busy.forEach(function (b) { if (b) n++; }); return n; }
  function startService(st, i, arr) { st.busy[i] = { arr: arr, end: st.t + expo(st, S) }; }
  /* advance to time `until`, event by event */
  function advance(st, until) {
    while (true) {
      var ni = -1, nt = Infinity;
      for (var i = 0; i < st.c; i++) if (st.busy[i] && st.busy[i].end < nt) { nt = st.busy[i].end; ni = i; }
      var next = Math.min(nt, st.nextArr, until);
      st.area += inSystem(st) * (next - st.t);
      st.t = next;
      if (next === until) break;
      if (next === st.nextArr) {
        var free = st.busy.indexOf(null);
        if (free >= 0) startService(st, free, st.t); else st.queue.push(st.t);
        if (st.queue.length > st.maxQ) st.maxQ = st.queue.length;
        st.nextArr = st.t + gap(st);
      } else {
        var b = st.busy[ni];
        st.lat.push(st.t - b.arr); st.done++;
        st.busy[ni] = null;
        if (st.queue.length) startService(st, ni, st.queue.shift());
      }
    }
  }
  function pct(a, q) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; }
  function summary(st) {
    var mean = st.lat.reduce(function (s, x) { return s + x; }, 0) / Math.max(1, st.lat.length);
    var X = st.done / Math.max(1e-9, st.t), L = st.area / Math.max(1e-9, st.t);
    return { n: st.done, X: X, R: mean, p99: pct(st.lat, 0.99), L: L, little: X * mean, theory: st.c && st.rho < 1 ? mmcR(st.c, st.rho) : Infinity, maxQ: st.maxQ };
  }
  /* one experiment: `secs` seconds of model time */
  function experiment(o, secs) { var st = create(o); advance(st, secs); return summary(st); }

  var API = { S: S, create: create, advance: advance, summary: summary, experiment: experiment, erlangC: erlangC, mmcR: mmcR };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function ms(x, d) { var v = (x * 1000).toFixed(d === undefined ? 0 : d); return PT ? v.replace(".", ",") : v; }
  function n0(x) { return Math.round(x).toLocaleString(PT ? "pt-BR" : "en-US"); }

  C.register("hold-queue", function (root) {
    var o = C.opts(root, { servers: 1, rho: 70, arrivals: "random" });
    var cfg = { servers: o.servers, rho: o.rho, arrivals: o.arrivals }, st, dots = [];

    var svgQ = s("svg", { viewBox: "0 0 620 120", role: "img", "aria-label": t("Holds waiting for the database's servers", "Reservas esperando os servidores do banco") });
    var svgK = s("svg", { viewBox: "0 0 620 210", role: "img", "aria-label": t("Mean response time against utilization", "Tempo médio de resposta contra a utilização") });
    var note = el("p", { class: "csim-note" });
    var tiles = C.stats([
      { key: "lambda", label: t("λ (holds/s)", "λ (reservas/s)") },
      { key: "R", label: t("mean R", "R médio") },
      { key: "p99", label: "p99" },
      { key: "theory", label: t("M/M/c predicts R", "M/M/c prevê R") },
      { key: "L", label: t("L in the system", "L no sistema") },
      { key: "little", label: "λ × W" }
    ]);
    var chart = C.chart({ title: t("Holds waiting in the queue (each 0.1 s)", "Reservas esperando na fila (a cada 0,1 s)"), len: 100, series: [{ label: t("queue", "fila"), cls: "tone-warn" }] });

    var sRho = C.slider({ label: t("Utilization ρ", "Utilização ρ"), min: 10, max: 98, step: 1, value: cfg.rho, fmt: function (v) { return v + "%"; },
      onInput: function (v) { cfg.rho = v; restart(); } });
    var cServers = C.choice({ label: t("Servers c", "Servidores c"), value: cfg.servers,
      options: [1, 8, 16].map(function (c) { return { value: c, label: String(c) }; }), onChange: function (v) { cfg.servers = v; restart(); } });
    var cArr = C.choice({ label: t("Arrivals", "Chegadas"), value: cfg.arrivals, options: [
      { value: "steady", label: t("steady (waiting room)", "constantes (sala de espera)") },
      { value: "random", label: t("random", "aleatórias") },
      { value: "bursty", label: t("bursty (on-sale clicks)", "em rajadas (cliques da abertura)") }
    ], onChange: function (v) { cfg.arrivals = v; restart(); } });

    var player = C.player({ interval: 400, onTick: function () { tick(); }, onReset: function () { dots = []; restart(); },
      label: function () { return "t = " + (st ? Math.round(st.t) : 0) + " s"; } });

    function keep() {
      if (st && st.t >= 5 && st.done > 50) {
        var r = summary(st);
        dots.push({ c: st.c, rho: st.rho, R: r.R, arrivals: st.arrivals });
        if (dots.length > 24) dots.shift();
      }
    }
    function restart() {
      keep();
      st = create({ servers: cfg.servers, rho: cfg.rho, arrivals: cfg.arrivals });
      chart.reset();
      draw(); player.refresh();
    }
    function tick() {
      for (var k = 1; k <= 10; k++) {
        advance(st, st.t + 0.1);
        chart.push([st.queue.length]);
      }
      draw();
    }

    var QX = 20, QW = 330, SX = 420;
    function drawQueue() {
      C.clear(svgQ);
      var q = st.queue.length, shown = Math.min(q, 60);
      svgQ.appendChild(s("rect", { x: QX - 6, y: 20, width: QW + 12, height: 80, rx: 8, class: "c-box " + (q > 20 ? "warn" : "on") }));
      svgQ.appendChild(s("text", { x: QX, y: 14, class: "c-small" }, t("queue: ", "fila: ") + q + t(" waiting", " esperando")));
      for (var i = 0; i < shown; i++) {
        svgQ.appendChild(s("circle", { cx: QX + QW - 8 - (i % 20) * 16.2, cy: 38 + Math.floor(i / 20) * 22, r: 6, class: "c-dot" + (q > 20 ? " bad" : "") }));
      }
      if (q > 60) svgQ.appendChild(s("text", { x: QX + 4, y: 96, class: "c-small c-bad" }, "+" + (q - 60)));
      svgQ.appendChild(s("line", { x1: QX + QW + 6, y1: 60, x2: SX - 6, y2: 60, class: "c-wire on" }));
      var cols = st.c <= 8 ? st.c : 8, rows = Math.ceil(st.c / 8), w = 22, h = rows > 1 ? 32 : 60;
      for (var j = 0; j < st.c; j++) {
        var x = SX + (j % cols) * (w + 4), y = 22 + Math.floor(j / 8) * (h + 6);
        svgQ.appendChild(s("rect", { x: x, y: y, width: w, height: h, rx: 4, class: st.busy[j] ? "c-fill-ok" : "c-fill-mute" }));
      }
      svgQ.appendChild(s("text", { x: SX, y: 14, class: "c-small" }, st.c + t(" server", " servidor") + (st.c > 1 ? "s" : "") + " · S = 5 ms"));
      svgQ.appendChild(s("text", { x: 612, y: 112, class: "c-small c-mono", "text-anchor": "end" }, "λ = " + n0(st.lambda) + t(" holds/s", " reservas/s")));
    }
    /* the knee: x = ρ, y = R in ms (0..20 S), theory for this c and the experiments run so far */
    var KX = 50, KY = 12, KW = 540, KH = 170, YMAX = 20 * S;
    function px(rho) { return KX + rho * KW; }
    function py(R) { return KY + KH * (1 - Math.min(1, R / YMAX)); }
    function drawKnee() {
      C.clear(svgK);
      [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
        svgK.appendChild(s("line", { x1: KX, x2: KX + KW, y1: KY + KH * (1 - f), y2: KY + KH * (1 - f), class: "c-wire" }));
        svgK.appendChild(s("text", { x: KX - 6, y: KY + KH * (1 - f) + 4, class: "c-small c-mono", "text-anchor": "end" }, ms(YMAX * f) + " ms"));
      });
      [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (r) {
        svgK.appendChild(s("text", { x: px(r), y: KY + KH + 16, class: "c-small c-mono", "text-anchor": "middle" }, Math.round(r * 100) + "%"));
      });
      svgK.appendChild(s("rect", { x: px(0.7), y: KY, width: px(0.85) - px(0.7), height: KH, class: "c-fill-tint" }));
      svgK.appendChild(s("text", { x: px(0.775), y: KY + 14, class: "c-small c-warn", "text-anchor": "middle" }, t("knee", "joelho")));
      var pts = [];
      for (var r = 0.01; r < 0.985; r += 0.01) pts.push(px(r).toFixed(1) + "," + py(mmcR(st.c, r)).toFixed(1));
      svgK.appendChild(s("polyline", { points: pts.join(" "), class: "csim-line tone-ink" }));
      svgK.appendChild(s("text", { x: KX + 8, y: KY + 14, class: "c-small", "text-anchor": "start" },
        t("line: M/M/" + st.c + " theory (random arrivals) · dots: your experiments with c = " + st.c, "linha: teoria M/M/" + st.c + " (chegadas aleatórias) · pontos: seus experimentos com c = " + st.c)));
      dots.filter(function (d) { return d.c === st.c; }).forEach(function (d) {
        svgK.appendChild(s("circle", { cx: px(d.rho), cy: py(d.R), r: 4.5, class: "c-dot " + (d.arrivals === "steady" ? "ok" : d.arrivals === "bursty" ? "bad" : "ink") }));
      });
      if (st.done > 50) {
        var cur = summary(st);
        svgK.appendChild(s("circle", { cx: px(st.rho), cy: py(cur.R), r: 6, class: "c-dot" }));
      }
    }
    function draw() {
      drawQueue(); drawKnee();
      var r = summary(st), has = st.done > 0;
      tiles.set("lambda", n0(st.lambda), "");
      tiles.set("R", has ? ms(r.R, 1) + " ms" : "–", !has ? "" : r.R > 10 * S ? "bad" : r.R > 3.4 * S ? "warn" : "ok");
      tiles.set("p99", has ? ms(r.p99) + " ms" : "–", !has ? "" : r.p99 > 0.3 ? "bad" : r.p99 > 0.1 ? "warn" : "ok");
      tiles.set("theory", ms(r.theory, 1) + " ms", "");
      tiles.set("L", has ? (PT ? r.L.toFixed(2).replace(".", ",") : r.L.toFixed(2)) : "–", "");
      tiles.set("little", has ? (PT ? r.little.toFixed(2).replace(".", ",") : r.little.toFixed(2)) : "–", "");
      note.className = "csim-note" + (st.rho >= 0.9 ? " csim-bad" : st.rho > 0.75 ? " csim-warn" : "");
      note.textContent = st.rho >= 0.9
        ? t("Past the knee: a little more load, a lot more waiting. Watch the queue swing and the dots climb.", "Depois do joelho: um pouco mais de carga, muito mais espera. Observe a fila oscilar e os pontos subirem.")
        : t("Press play: holds arrive at λ = ρ · c / S. Each change of a control starts a new experiment and leaves the last one as a dot on the curve.",
            "Aperte play: as reservas chegam a λ = ρ · c / S. Cada mudança num controle começa um novo experimento e deixa o anterior como um ponto na curva.");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The knee, played: utilization, servers and variability in front of the inventory database",
        "O joelho, na prática: utilização, servidores e variabilidade na frente do banco de inventário") }),
      el("p", { class: "csim-sub", text: t("Every hold keeps a server busy for 5 ms on average. Raise ρ step by step and watch the mean response time leave the floor.",
        "Cada reserva ocupa um servidor por 5 ms em média. Suba ρ passo a passo e observe o tempo médio de resposta sair do chão.") }),
      el("div", { class: "csim-row" }, [sRho, cServers, cArr]),
      el("div", { class: "csim-stage" }, svgQ),
      player,
      note,
      tiles,
      el("div", { class: "csim-stage" }, svgK),
      chart
    ]);
    restart();
    return {};
  });
})();
