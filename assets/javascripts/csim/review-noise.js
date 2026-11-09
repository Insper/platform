/*
 * Noise control of an AI reviewer (2027.1, class 14 — code review):
 *
 *   <div class="csim" data-sim="review-noise" data-confidence="medium" data-scale="team"></div>
 *
 * The page's illustrative labelled sample: on 100 PRs the model emitted 60 high-, 90 medium- and
 * 150 low-confidence findings, of which 48, 45 and 30 were real problems, out of 150 real problems
 * (27 were never found). The findings are spread over the 100 PRs with a seeded, skewed weight (a
 * few big PRs get many), so the cap per PR has something to cut. The filter is the reviewer's of
 * lab 13 without severities (the sample has none): keep findings at or above the minimum
 * confidence, then keep at most LAB.cap per PR, the most confident first. The stats: comments per
 * PR, precision (useful ÷ posted), recall (useful ÷ 150), and the minutes a week people spend
 * reading useless comments (one minute each, as on the overview page).
 */
(function () {
  "use strict";

  var LAB = { cap: 6 };   /* AI_REVIEW_MAX_COMMENTS of lab 13's review.py */
  var SAMPLE = [
    { conf: "high", emitted: 60, real: 48 },
    { conf: "medium", emitted: 90, real: 45 },
    { conf: "low", emitted: 150, real: 30 }
  ];
  var REAL = 150, PRS = 100, SEED = 1414, MIN_PER_COMMENT = 1;
  var RANK = { high: 0, medium: 1, low: 2 };
  var SCALES = { team: 60, org: 5000 };   /* reviews per week: BoxOffice's ~60 PRs, a 500-engineer organization */

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* the sample spread over the PRs: prs[i] = {findings: [{conf, real, order}], missed: n} */
  function sample(seed) {
    var r = rng(seed === undefined ? SEED : seed);
    var w = [], total = 0, i;
    for (i = 0; i < PRS; i++) {
      var z = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
      w.push(Math.exp(0.9 * z)); total += w[i];
    }
    function pick() {
      var x = r() * total;
      for (var j = 0; j < PRS; j++) { x -= w[j]; if (x <= 0) return j; }
      return PRS - 1;
    }
    var prs = [];
    for (i = 0; i < PRS; i++) prs.push({ findings: [], missed: 0 });
    SAMPLE.forEach(function (b) {
      for (var k = 0; k < b.emitted; k++) prs[pick()].findings.push({ conf: b.conf, real: k < b.real, order: r() });
    });
    var found = SAMPLE.reduce(function (s, b) { return s + b.real; }, 0);
    for (i = 0; i < REAL - found; i++) prs[pick()].missed++;
    return prs;
  }

  /* the filter: minimum confidence, then at most cap per PR (0 = no cap), the most confident first */
  function filter(prs, minConf, cap) {
    var posted = 0, useful = 0, cut = 0, capped = 0, silent = 0;
    var out = prs.map(function (p) {
      var kept = p.findings.filter(function (f) { return RANK[f.conf] <= RANK[minConf]; })
        .sort(function (a, b) { return RANK[a.conf] - RANK[b.conf] || a.order - b.order; });
      var over = cap > 0 ? kept.slice(cap) : [];
      if (cap > 0) kept = kept.slice(0, cap);
      if (over.length) capped++;
      cut += over.length;
      if (!kept.length) silent++;
      var u = kept.filter(function (f) { return f.real; }).length;
      posted += kept.length; useful += u;
      return { posted: kept, over: over, dropped: p.findings.length - kept.length - over.length, missed: p.missed, total: p.findings.length };
    });
    return { prs: out, posted: posted, useful: useful, noise: posted - useful, cut: cut, capped: capped, silent: silent,
      perPr: posted / PRS, precision: posted ? useful / posted : 0, recall: useful / REAL };
  }

  /* hours a week spent reading useless comments */
  function wastedHours(res, reviewsPerWeek) {
    return res.noise / PRS * reviewsPerWeek * MIN_PER_COMMENT / 60;
  }

  function run(minConf, cap, seed) { return filter(sample(seed), minConf, cap); }

  var API = { LAB: LAB, SAMPLE: SAMPLE, REAL: REAL, PRS: PRS, SCALES: SCALES, sample: sample, filter: filter, run: run, wastedHours: wastedHours };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var W = 640, H = 170, BASE = 150, COL = 6, DOT = 5;
  function pct(x) { return Math.round(x * 100) + "%"; }
  function num(x, d) { return x.toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }

  C.style("review-noise", [
    ".md-typeset .csim-rn-ok { fill: var(--c-ok); }",
    ".md-typeset .csim-rn-bad { fill: var(--c-bad); }",
    ".md-typeset .csim-rn-cut { fill: var(--c-warn); opacity: .7; }",
    ".md-typeset .csim-rn-drop { fill: var(--c-fg3); opacity: .35; }",
    ".md-typeset .csim-rn-miss { fill: none; stroke: var(--c-ok); stroke-width: 1; stroke-dasharray: 2 1; }",
    ".md-typeset .csim-rn-cap { stroke: var(--c-warn); stroke-width: 1; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-legend .csim-rn-k i { background: var(--k); }"
  ].join("\n"));

  C.register("review-noise", function (root) {
    var o = C.opts(root, { confidence: "medium", cap: LAB.cap, scale: "team" });
    var prs = sample();
    var minConf = RANK[o.confidence] === undefined ? "medium" : o.confidence;
    var cap = o.cap, scale = SCALES[o.scale] ? o.scale : "team";

    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": t("Findings per pull request", "Achados por pull request") });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "per", label: t("comments per PR", "comentários por PR") },
      { key: "prec", label: t("precision (useful ÷ posted)", "precisão (úteis ÷ publicados)") },
      { key: "rec", label: t("recall (found ÷ 150 real)", "recall (achados ÷ 150 reais)") },
      { key: "waste", label: t("hours/week reading useless comments", "horas/semana lendo comentários inúteis") }
    ]);
    var cConf = C.choice({ label: t("Post findings with confidence ≥", "Publicar achados com confiança ≥"), value: minConf, options: [
      { value: "high", label: t("high", "alta") }, { value: "medium", label: t("medium", "média") }, { value: "low", label: t("low (all)", "baixa (todos)") }
    ], onChange: function (v) { minConf = v; draw(); } });
    var cCap = C.choice({ label: t("Cap per PR", "Teto por PR"), value: cap, options: [
      { value: 0, label: t("none", "nenhum") }, { value: LAB.cap, label: LAB.cap + t(" (lab 13)", " (lab 13)") }, { value: 3, label: "3" }, { value: 1, label: "1" }
    ], onChange: function (v) { cap = v; draw(); } });
    var cScale = C.choice({ label: t("Reviews per week", "Revisões por semana"), value: scale, options: [
      { value: "team", label: t("60 (BoxOffice)", "60 (BoxOffice)") }, { value: "org", label: t("5,000 (500 engineers)", "5.000 (500 engenheiros)") }
    ], onChange: function (v) { scale = v; draw(); } });

    function legend(cls, label) { return el("span", { class: "csim-rn-k", style: "--k: var(" + cls + ")" }, [el("i"), label]); }

    function draw() {
      var res = filter(prs, minConf, cap);
      var view = res.prs.map(function (p, i) { return { p: p, i: i }; })
        .sort(function (a, b) { return (b.p.total + b.p.missed) - (a.p.total + a.p.missed) || a.i - b.i; });
      C.clear(svg);
      var step = DOT + 1;
      view.forEach(function (v, x) {
        var cx = 8 + x * COL, y = BASE;
        function dot(cls) { y -= step; svg.appendChild(s("rect", { x: cx, y: y, width: DOT, height: DOT, rx: 1, class: cls })); }
        v.p.posted.forEach(function (f) { dot(f.real ? "csim-rn-ok" : "csim-rn-bad"); });
        v.p.over.forEach(function () { dot("csim-rn-cut"); });
        for (var k = 0; k < v.p.dropped; k++) dot("csim-rn-drop");
        for (k = 0; k < v.p.missed; k++) dot("csim-rn-miss");
      });
      svg.appendChild(s("line", { x1: 4, x2: W - 30, y1: BASE + 1, y2: BASE + 1, class: "c-wire" }));
      if (cap > 0) {
        svg.appendChild(s("line", { x1: 4, x2: W - 30, y1: BASE - cap * step, y2: BASE - cap * step, class: "csim-rn-cap" }));
        svg.appendChild(s("text", { x: W - 28, y: BASE - cap * step + 3, class: "c-small c-warn" }, t("cap ", "teto ") + cap));
      }
      svg.appendChild(s("text", { x: 8, y: H - 4, class: "c-small" }, t("100 pull requests, biggest first — one square per finding", "100 pull requests, os maiores primeiro — um quadrado por achado")));

      var hours = wastedHours(res, SCALES[scale]);
      st.set("per", num(res.perPr, 1), res.perPr > 2 ? "warn" : "");
      st.set("prec", pct(res.precision), res.precision >= 0.7 ? "ok" : res.precision >= 0.55 ? "warn" : "bad");
      st.set("rec", pct(res.recall), res.recall >= 0.6 ? "ok" : res.recall >= 0.4 ? "warn" : "bad");
      st.set("waste", num(hours, hours < 10 ? 1 : 0), hours >= 40 ? "bad" : hours >= 5 ? "warn" : "");

      var msg = t(res.posted + " comments posted on 100 PRs: " + res.useful + " useful, " + res.noise + " noise. " + res.silent + " PRs get no comment at all.",
        res.posted + " comentários publicados em 100 PRs: " + res.useful + " úteis, " + res.noise + " ruído. " + res.silent + " PRs não recebem nenhum comentário.");
      if (res.cut) msg += t(" The cap cut " + res.cut + " findings on " + res.capped + " big PRs, keeping the most confident.",
        " O teto cortou " + res.cut + " achados em " + res.capped + " PRs grandes, mantendo os mais confiantes.");
      msg += t(" At " + num(SCALES[scale]) + " reviews a week, reading the noise costs " + num(hours, hours < 10 ? 1 : 0) + " hours.",
        " Com " + num(SCALES[scale]) + " revisões por semana, ler o ruído custa " + num(hours, hours < 10 ? 1 : 0) + " horas.");
      note.textContent = msg;
      note.className = "csim-note" + (res.precision < 0.55 ? " csim-bad" : res.recall < 0.4 ? " csim-warn" : " csim-ok");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Noise control: what the thresholds post, and what they miss", "Controle de ruído: o que os limiares publicam e o que deixam passar") }),
      el("p", { class: "csim-sub", text: t("The page's labelled sample (illustrative): 300 findings on 100 PRs, 123 of them real; 27 real problems the model never found. The filter keeps findings at or above the confidence, then the cap keeps the most confident per PR.",
        "A amostra rotulada da página (ilustrativa): 300 achados em 100 PRs, 123 reais; 27 problemas reais que o modelo nunca achou. O filtro mantém os achados com confiança no mínimo igual à escolhida e o teto mantém os mais confiantes de cada PR.") }),
      el("div", { class: "csim-row" }, [cConf, cCap]),
      el("div", { class: "csim-row" }, [cScale]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-legend" }, [
        legend("--c-ok", t("posted, real problem", "publicado, problema real")), legend("--c-bad", t("posted, noise", "publicado, ruído")),
        legend("--c-warn", t("cut by the cap", "cortado pelo teto")), legend("--c-fg3", t("below the confidence", "abaixo da confiança")),
        el("span", {}, [el("i", { style: "background: none; border: 1px dashed var(--c-ok); height: .4rem" }), t("real, never found", "real, nunca achado")])
      ]),
      st,
      note
    ]);
    draw();
    return {};
  });
})();
