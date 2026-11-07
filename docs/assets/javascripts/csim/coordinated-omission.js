/*
 * Coordinated omission (2027.1, Performance — load testing):
 *
 *   <div class="csim" data-sim="coordinated-omission" data-stalls="4" data-stall="1.5"></div>
 *
 * The page's experiment, played: a server answers in 1 ms but freezes (a stop-the-world GC pause, a
 * table lock) `stalls` times for `stall` seconds during a 60 s test; the tester intends 100 requests/s.
 * The closed loop (one virtual user paced at 10 ms) waits for each response, skips the slots it missed
 * and measures from the moment it actually sent; the open model sends on schedule whatever happens and
 * measures from the intended send time. Same server, two reports: samples, percentiles, and the verdict
 * of a p99 < 100 ms threshold. The stalls are spread evenly (4 of them start at 10, 25, 40 and 55 s, as
 * on the page).
 */
(function () {
  "use strict";

  var RATE = 100, DURATION = 60, SERVICE = 0.001, SLO = 0.1;   /* req/s, s, s, s */

  function stallsOf(n, len) {
    var out = [];
    for (var i = 0; i < n; i++) out.push([(i + 2 / 3) * DURATION / n, len]);
    return out;
  }

  function serve(stalls, arrival, freeAt) {
    var start = Math.max(arrival, freeAt);
    for (var i = 0; i < stalls.length; i++) {
      var s = stalls[i][0], d = stalls[i][1];
      if (s <= start && start < s + d) start = s + d;           /* frozen: nothing runs until the stall ends */
    }
    return start + SERVICE;
  }

  /* both measurements of one test: [{t, lat}] in seconds */
  function measure(n, len) {
    var stalls = stallsOf(n, len), closed = [], open = [];
    var t = 0, slot = 0, free = 0, done;
    while (slot < DURATION) {                                     /* closed loop: one VU, paced at 10 ms */
      var send = Math.max(t, slot);
      done = serve(stalls, send, free);
      free = done;
      closed.push({ t: send, lat: done - send });                 /* from the ACTUAL send time */
      t = done; slot += 1 / RATE;
      if (slot < t) slot = t;                                     /* the missed slots are silently skipped */
    }
    free = 0;
    for (var k = 0; k < DURATION * RATE; k++) {                   /* open model: on schedule */
      var a = k / RATE;
      done = serve(stalls, a, free);
      free = done;
      open.push({ t: a, lat: done - a });                         /* from the INTENDED send time */
    }
    return { stalls: stalls, closed: closed, open: open };
  }

  function pct(sorted, p) {                                       /* linear interpolation, as numpy */
    if (!sorted.length) return 0;
    var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  /* samples and percentiles (s) of the measurements made up to time `upTo` */
  function report(list, upTo) {
    var v = [];
    for (var i = 0; i < list.length && list[i].t <= upTo; i++) v.push(list[i].lat);
    v.sort(function (a, b) { return a - b; });
    return { n: v.length, p50: pct(v, 0.5), p90: pct(v, 0.9), p99: pct(v, 0.99), p999: pct(v, 0.999), max: v.length ? v[v.length - 1] : 0 };
  }

  var API = { measure: measure, report: report, stallsOf: stallsOf, RATE: RATE, DURATION: DURATION, SERVICE: SERVICE, SLO: SLO };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  function dec(v, d) { return v.toFixed(d).replace(".", C.PT ? "," : "."); }
  function ms(x) { var m = x * 1000; return m >= 1000 ? dec(m / 1000, 2) + " s" : dec(m, m >= 100 ? 0 : 1) + " ms"; }
  function int(n) { return n.toLocaleString(C.PT ? "pt-BR" : "en-US"); }

  C.style("coordinated-omission", [
    ".md-typeset .csim-co-stall { fill: color-mix(in srgb, var(--c-bad) 14%, transparent); }",
    ".md-typeset .csim-co-open { fill: none; stroke: var(--c-warn); stroke-width: 1.6; }",
    ".md-typeset .csim-co-dot { fill: var(--c-ink); }",
    ".md-typeset .csim-co-axis { stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-co-slo { stroke: var(--c-bad); stroke-width: 1; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-co-now { stroke: var(--c-fg3); stroke-width: 1; }",
    ".md-typeset table.csim-co-tab { font-size: .64rem; margin: .4rem 0; }",
    ".md-typeset table.csim-co-tab td, .md-typeset table.csim-co-tab th { padding: .25em .6em; text-align: right; white-space: nowrap; }",
    ".md-typeset table.csim-co-tab td:first-child, .md-typeset table.csim-co-tab th:first-child { text-align: left; white-space: normal; }",
    ".md-typeset table.csim-co-tab .ok { color: var(--c-ok); font-weight: 700; } .md-typeset table.csim-co-tab .bad { color: var(--c-bad); font-weight: 700; }",
    ".md-typeset .csim-co-key { display: inline-block; width: .9em; height: .25em; vertical-align: middle; margin-right: .3em; }"
  ].join("\n"));

  C.register("coordinated-omission", function (root) {
    var o = C.opts(root, { stalls: 4, stall: 1.5 });
    var M, now = 0;
    var W = 380, H = 150, PL = 34, PR = 6, PT = 8, PB = 18, YMAX = Math.log10(1 + 3000);
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": t("latency of each request over the test", "latência de cada requisição ao longo do teste") });
    var tab = el("table", { class: "csim-co-tab" });
    var note = el("p", { class: "csim-note" });

    var nS = C.slider({ label: t("Freezes in 60 s", "Congelamentos em 60 s"), min: 0, max: 8, value: o.stalls, onInput: function () { bar.reset(); } });
    var lS = C.slider({ label: t("Each freeze lasts", "Cada congelamento dura"), min: 0.1, max: 3, step: 0.1, value: o.stall,
      fmt: function (v) { return dec(v, 1) + " s"; }, onInput: function () { bar.reset(); } });

    function x(tt) { return PL + (W - PL - PR) * tt / DURATION; }
    function y(lat) { return PT + (H - PT - PB) * (1 - Math.min(1, Math.log10(1 + lat * 1000) / YMAX)); }

    function reset() { M = measure(nS.get(), lS.get()); now = 0; draw(); }

    function bucketMax(list, upTo) {                             /* the worst latency of each 100 ms */
      var b = [];
      list.forEach(function (r) { if (r.t > upTo) return; var k = Math.floor(r.t * 10); if (!b[k] || r.lat > b[k].lat) b[k] = { t: r.t, lat: r.lat }; });
      return b.filter(Boolean);
    }

    function draw() {
      C.clear(svg);
      M.stalls.forEach(function (st) { svg.appendChild(s("rect", { x: x(st[0]), y: PT, width: Math.max(1, x(st[0] + st[1]) - x(st[0])), height: H - PT - PB, class: "csim-co-stall" })); });
      [0.001, 0.01, 0.1, 1].forEach(function (v) {
        svg.appendChild(s("line", { x1: PL, x2: W - PR, y1: y(v), y2: y(v), class: v === SLO ? "csim-co-slo" : "csim-co-axis", opacity: v === SLO ? 1 : 0.5 }));
        svg.appendChild(s("text", { x: PL - 3, y: y(v) + 3, "text-anchor": "end", class: "c-small" }, v >= 1 ? v + " s" : v * 1000 + " ms"));
      });
      [0, 15, 30, 45, 60].forEach(function (v) { svg.appendChild(s("text", { x: x(v), y: H - 5, "text-anchor": "middle", class: "c-small" }, v + " s")); });
      var op = bucketMax(M.open, now).map(function (r) { return x(r.t).toFixed(1) + "," + y(r.lat).toFixed(1); });
      if (op.length) svg.appendChild(s("polyline", { points: op.join(" "), class: "csim-co-open" }));
      bucketMax(M.closed, now).forEach(function (r) { svg.appendChild(s("circle", { cx: x(r.t), cy: y(r.lat), r: 1.4, class: "csim-co-dot" })); });
      if (now > 0 && now < DURATION) svg.appendChild(s("line", { x1: x(now), x2: x(now), y1: PT, y2: H - PB, class: "csim-co-now" }));

      var rc = report(M.closed, now), ro = report(M.open, now);
      C.clear(tab);
      tab.appendChild(el("thead", {}, el("tr", {}, [t("Measurement", "Medição"), t("samples", "amostras"), "p50", "p90", "p99", "p99.9", "max", "p99 < 100 ms"].map(function (h) { return el("th", { text: h }); }))));
      var body = el("tbody");
      [[t("closed loop (what the tool recorded)", "laço fechado (o que a ferramenta gravou)"), rc, "csim-co-dot"], [t("open model (what users would see)", "modelo aberto (o que os usuários veriam)"), ro, "csim-co-open"]].forEach(function (row) {
        var r = row[1], okv = r.p99 < SLO;
        body.appendChild(el("tr", {}, [el("td", {}, [s("svg", { class: "csim-co-key", viewBox: "0 0 10 3" }, s("rect", { width: 10, height: 3, style: "fill: " + (row[2] === "csim-co-dot" ? "var(--c-ink)" : "var(--c-warn)") })), row[0]]),
          el("td", { text: int(r.n) }), el("td", { text: ms(r.p50) }), el("td", { text: ms(r.p90) }), el("td", { text: ms(r.p99) }), el("td", { text: ms(r.p999) }), el("td", { text: ms(r.max) }),
          el("td", { class: r.n ? (okv ? "ok" : "bad") : "", text: r.n ? (okv ? t("✓ pass", "✓ passa") : t("✗ fail", "✗ falha")) : "–" })]));
      });
      tab.appendChild(body);

      var frozen = M.stalls.reduce(function (a, st) { return a + st[1]; }, 0), share = frozen / DURATION;
      if (now === 0) note.textContent = t("Press play: " + RATE + " requests/s for " + DURATION + " s. The server freezes " + nS.get() + "× for " + dec(lS.get(), 1) + " s — " + dec(100 * share, 1) + "% of the test.",
        "Aperte play: " + RATE + " requisições/s por " + DURATION + " s. O servidor congela " + nS.get() + "× por " + dec(lS.get(), 1) + " s — " + dec(100 * share, 1) + "% do teste.");
      else if (rc.p99 < SLO && ro.p99 >= SLO) note.textContent = t("Same server, opposite verdicts: the closed loop stopped sending during each freeze, so it recorded " + int(ro.n - rc.n) + " fewer samples — exactly the slow ones.",
        "O mesmo servidor, veredictos opostos: o laço fechado parou de enviar durante cada congelamento, então gravou " + int(ro.n - rc.n) + " amostras a menos — justamente as lentas.");
      else if (ro.p99 < SLO && frozen > 0) note.textContent = t("The freezes cover only " + dec(100 * share, 1) + "% of the time: under 1%, even the honest p99 cannot see them. Look at p99.9 and max.",
        "Os congelamentos cobrem só " + dec(100 * share, 1) + "% do tempo: abaixo de 1%, nem o p99 honesto os vê. Olhe o p99.9 e o max.");
      else note.textContent = t("Both measurements agree when the server never freezes for long: coordinated omission hides only the stalls.",
        "As duas medições concordam quando o servidor não congela por muito tempo: a omissão coordenada esconde só as paradas.");
    }

    var bar = C.player({ onTick: function () { now = Math.min(DURATION, now + 1); draw(); return now < DURATION; }, onReset: reset, interval: 200,
      label: function () { return "t = " + now + " s / " + DURATION + " s"; } });
    bar.total(DURATION);

    C.add(root, [
      el("p", { class: "csim-title", text: t("Same server, same minute: two reports", "O mesmo servidor, o mesmo minuto: dois relatórios") }),
      el("p", { class: "csim-sub", text: t("Dots: the worst sample the closed loop recorded in each 100 ms. Line: what an open model measured. Shaded: the server is frozen.",
        "Pontos: a pior amostra que o laço fechado gravou a cada 100 ms. Linha: o que o modelo aberto mediu. Sombreado: o servidor está congelado.") }),
      el("div", { class: "csim-row" }, [nS, lS]),
      el("div", { class: "csim-stage" }, svg),
      tab,
      note,
      bar
    ]);
    reset();
    return {};
  });
})();
