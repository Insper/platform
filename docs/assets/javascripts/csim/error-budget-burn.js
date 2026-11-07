/*
 * Error budget and multiwindow burn-rate alerts (2026.2, class "Reliability", SLI / SLO / SLA):
 *
 *   <div class="csim" data-sim="error-budget-burn" data-scenario="deploy"></div>
 *
 * The page's order service: 1,000,000 requests a day, constant, an availability SLO of 99.9% over
 * 28 days, so a budget of 28,000 failed requests. A quiet background of 0.01% errors (burn rate 0.1)
 * and one incident of `rate` errors for `duration` minutes, one of the page's four cases or set by
 * hand: a bad deploy (the page's 20,000 errors in one hour: 48%), a partial outage (2% for 6 h),
 * a slow leak (0.3% for 3 days) and a short blip (10% for 5 min).
 *
 * Four alert rules watch the same minute-by-minute series (burn rate = error ratio ÷ 0.001):
 *   - the SRE Workbook's table 5-8: page when the burn rate over 1 h AND over 5 min is above 14.4;
 *     page when over 6 h AND 30 min it is above 6; ticket when over 3 days AND 6 h it is above 1;
 *   - a single-window rule for comparison: 1 h above 14.4 `for: 2m` (no short window).
 * Rules are evaluated once a minute. The player moves a cursor through the incident.
 */
(function () {
  "use strict";
  var CFG = { slo: 99.9, days: 28, perDay: 1e6, background: 0.0001, start: 60 };
  var SCENARIOS = {
    deploy: { rate: 20000 / (1e6 / 24), duration: 60 },
    outage: { rate: 0.02, duration: 360 },
    leak: { rate: 0.003, duration: 4320 },
    blip: { rate: 0.10, duration: 5 }
  };
  var RULES = [
    { id: "fast", long: 60, short: 5, burn: 14.4, sev: "page" },
    { id: "slow", long: 360, short: 30, burn: 6, sev: "page" },
    { id: "ticket", long: 4320, short: 360, burn: 1, sev: "ticket" },
    { id: "single", long: 60, short: 0, burn: 14.4, sev: "page", forMin: 2 }
  ];
  var HIST = 4320;   /* minutes of history before the view, for the 3-day window */

  function tail(duration) { return Math.max(120, Math.min(1440, duration)); }

  /* o: {rate (fraction), duration (min)} → series, alerts and budget */
  function run(o) {
    var budgetFrac = 1 - CFG.slo / 100;
    var span = CFG.start + o.duration + tail(o.duration), n = HIST + span;
    var err = new Float64Array(n), pre = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) {
      var m = i - HIST;
      err[i] = m >= CFG.start && m < CFG.start + o.duration ? o.rate : CFG.background;
      pre[i + 1] = pre[i] + err[i];
    }
    /* burn rate over the last w minutes, at view minute m (inclusive) */
    function burn(m, w) { var j = m + HIST + 1; return (pre[j] - pre[j - w]) / w / budgetFrac; }
    var fire = {}, first = {}, last = {};
    RULES.forEach(function (r) {
      var f = new Uint8Array(span), run = 0;
      for (var m = 0; m < span; m++) {
        var cond = burn(m, r.long) > r.burn && (!r.short || burn(m, r.short) > r.burn);
        run = cond ? run + 1 : 0;
        f[m] = r.forMin ? (run > r.forMin ? 1 : 0) : (cond ? 1 : 0);
        if (f[m]) { if (first[r.id] === undefined) first[r.id] = m; last[r.id] = m; }
      }
      fire[r.id] = f;
    });
    var perMin = CFG.perDay / 1440;
    var budget = budgetFrac * CFG.perDay * CFG.days;
    var incidentErrors = o.rate * perMin * o.duration;
    var end = CFG.start + o.duration;
    function rel(id, from) { return first[id] === undefined ? null : (from === "end" ? last[id] + 1 - end : first[id] + 1 - CFG.start); }
    return {
      span: span, burn: burn, fire: fire,
      budget: budget, incidentErrors: incidentErrors, consumed: 100 * incidentErrors / budget,
      incidentBurn: o.rate / budgetFrac, exhaustDays: CFG.days * budgetFrac / o.rate,
      detect: { fast: rel("fast"), slow: rel("slow"), ticket: rel("ticket"), single: rel("single") },
      reset: { fast: rel("fast", "end"), slow: rel("slow", "end"), ticket: rel("ticket", "end"), single: rel("single", "end") },
      /* errors of the incident up to view minute m, as % of the budget */
      consumedAt: function (m) { return 100 * o.rate * perMin * Math.max(0, Math.min(m + 1, end) - CFG.start) / budget; }
    };
  }

  function num(v, d, pt) { return v.toLocaleString(pt ? "pt-BR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  /* 45 min, 6 h, 1.5 h, 3 days */
  function dur(min, pt) {
    if (min < 120) return num(min, 0, pt) + " min";
    if (min < 2880) { var h = min / 60; return num(h, h % 1 ? 1 : 0, pt) + " h"; }
    var d = min / 1440; return num(d, d % 1 ? 1 : 0, pt) + (pt ? " dias" : " days");
  }

  var API = { CFG: CFG, SCENARIOS: SCENARIOS, RULES: RULES, run: run, num: num, dur: dur, tail: tail };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, tr = C.t, el = C.el, s = C.s, PT = C.PT;
  var L = 120, R = 630, STEPS = 240;
  var LANES = [
    { id: "fast", label: tr("page · 1 h & 5 min > 14.4", "page · 1 h e 5 min > 14,4") },
    { id: "slow", label: tr("page · 6 h & 30 min > 6", "page · 6 h e 30 min > 6") },
    { id: "ticket", label: tr("ticket · 3 d & 6 h > 1", "ticket · 3 d e 6 h > 1") },
    { id: "single", label: tr("1 h > 14.4, for 2 min", "1 h > 14,4, for 2 min") }
  ];
  var LINES = [
    { w: 5, cls: "cat-2", label: tr("burn rate, 5 min", "burn rate, 5 min") },
    { w: 60, cls: "cat-0", label: tr("burn rate, 1 h", "burn rate, 1 h") },
    { w: 360, cls: "cat-1", label: tr("burn rate, 6 h", "burn rate, 6 h") }
  ];

  C.style("error-budget-burn", [
    ".md-typeset .csim-eb-line { fill: none; stroke: var(--cat); stroke-width: 1.8; stroke-linejoin: round; }",
    ".md-typeset .csim-eb-legend span i { background: var(--cat); }",
    ".md-typeset .csim-eb-inc { fill: color-mix(in srgb, var(--c-warn) 10%, var(--c-bg)); }",
    ".md-typeset .csim-eb-grid { stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-eb-thr { stroke: var(--c-fg3); stroke-width: 1.1; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-eb-lane { fill: var(--c-panel); }",
    ".md-typeset .csim-eb-now { stroke: var(--c-accent); stroke-width: 1.5; }",
    ".md-typeset .csim-eb .csim-slider input[type=range] { width: 7rem; }"
  ].join("\n"));

  C.register("error-budget-burn", function (root) {
    var o = C.opts(root, { scenario: "deploy" });
    var sc = SCENARIOS[o.scenario] || SCENARIOS.deploy;
    var state = { scenario: o.scenario, rate: sc.rate, duration: sc.duration };
    var res = run(state), cursor = 0;
    root.classList.add("csim-eb");

    var svg = s("svg", { viewBox: "0 0 640 300", role: "img", "aria-label": tr("Burn rates and alerts during an incident", "Burn rates e alertas durante um incidente") });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "b5", label: tr("burn rate, 5 min (now)", "burn rate, 5 min (agora)") },
      { key: "b60", label: tr("burn rate, 1 h (now)", "burn rate, 1 h (agora)") },
      { key: "used", label: tr("28-day budget spent by the incident", "orçamento de 28 dias gasto pelo incidente") },
      { key: "alert", label: tr("alerts firing (now)", "alertas disparando (agora)") }
    ]);

    function pctFmt(v) { return v * 100 >= 10 ? num(v * 100, 0, PT) : v * 100 >= 1 ? num(v * 100, 1, PT) : num(v * 100, 2, PT); }
    var sRate = C.slider({ label: tr("Error rate", "Taxa de erro"), min: -2, max: 2, step: 0.01, value: Math.log10(state.rate * 100),
      fmt: function (x) { return pctFmt(Math.pow(10, x) / 100) + "%"; },
      onInput: function (x) { state.rate = Math.pow(10, x) / 100; state.scenario = null; cSc.set(null); recompute(); } });
    var DUR = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320];
    var sDur = C.slider({ label: tr("Duration", "Duração"), min: 0, max: DUR.length - 1, step: 1, value: Math.max(0, DUR.indexOf(state.duration)),
      fmt: function (i) { return dur(DUR[i], PT); },
      onInput: function (i) { state.duration = DUR[i]; state.scenario = null; cSc.set(null); recompute(); } });
    var cSc = C.choice({ label: tr("Incident", "Incidente"), value: state.scenario, options: [
      { value: "deploy", label: tr("bad deploy", "deploy ruim") }, { value: "outage", label: tr("partial outage", "falha parcial") },
      { value: "leak", label: tr("slow leak", "vazamento lento") }, { value: "blip", label: tr("short blip", "soluço curto") }],
      onChange: function (v) { state.scenario = v; state.rate = SCENARIOS[v].rate; state.duration = SCENARIOS[v].duration;
        sRate.set(Math.log10(state.rate * 100)); sDur.set(DUR.indexOf(state.duration)); recompute(); } });

    var bar = C.player({ interval: 120, onTick: function (k) { cursor = k; draw(); },
      onReset: function () { cursor = 0; draw(); }, onPrev: function (k) { cursor = k; draw(); },
      label: function () { var m = minuteAt(cursor); return "t = " + dur(Math.max(0, m), PT) + " / " + dur(res.span, PT); } });
    bar.total(STEPS);

    function recompute() { res = run(state); cursor = Math.min(cursor, STEPS); draw(); }
    function minuteAt(k) { return Math.round(k / STEPS * res.span) - 1; }
    function X(m) { return L + (R - L) * m / res.span; }

    function draw() {
      var m = minuteAt(cursor), span = res.span;
      C.clear(svg);
      /* top: burn rates, log scale 0.1 … 1000 */
      var T = 16, B = 160;
      function Y(v) { var lv = Math.log10(Math.max(0.1, Math.min(1000, v))); return B - (B - T) * (lv + 1) / 4; }
      svg.appendChild(s("rect", { x: X(CFG.start), y: T, width: Math.max(1, X(CFG.start + state.duration) - X(CFG.start)), height: 268, class: "csim-eb-inc" }));
      [0.1, 1, 10, 100, 1000].forEach(function (v) {
        svg.appendChild(s("line", { x1: L, x2: R, y1: Y(v), y2: Y(v), class: "csim-eb-grid" }));
        svg.appendChild(s("text", { x: L - 4, y: Y(v) + 3, "text-anchor": "end", class: "c-small" }, num(v, v < 1 ? 1 : 0, PT) + "×"));
      });
      [14.4, 6, 1].forEach(function (v) {
        svg.appendChild(s("line", { x1: L, x2: R, y1: Y(v), y2: Y(v), class: "csim-eb-thr" }));
        svg.appendChild(s("text", { x: R + 2, y: Y(v) + 3, class: "c-small" }, num(v, v % 1 ? 1 : 0, PT)));
      });
      svg.appendChild(s("text", { x: L, y: 10, class: "c-small" }, tr("burn rate (log scale); dashed: the alert thresholds 14.4, 6 and 1", "burn rate (escala log); tracejado: os limiares 14,4, 6 e 1")));
      var stepM = Math.max(1, Math.round(span / 480));
      if (m >= 0) LINES.forEach(function (ln) {
        var pts = [];
        for (var k = 0; k <= m; k += stepM) pts.push(X(k).toFixed(1) + "," + Y(res.burn(k, ln.w)).toFixed(1));
        pts.push(X(m).toFixed(1) + "," + Y(res.burn(m, ln.w)).toFixed(1));
        svg.appendChild(s("polyline", { class: "csim-eb-line " + ln.cls, points: pts.join(" ") }));
      });
      /* lanes: when each rule fires */
      LANES.forEach(function (ln, i) {
        var y = 176 + i * 22;
        svg.appendChild(s("text", { x: L - 6, y: y + 11, "text-anchor": "end", class: "c-small" }, ln.label));
        svg.appendChild(s("rect", { x: L, y: y, width: R - L, height: 15, class: "csim-eb-lane" }));
        var f = res.fire[ln.id], a = -1, sev = ln.id === "ticket" ? "c-fill-warn" : "c-fill-bad";
        for (var k = 0; k <= Math.min(m, span - 1) + 1; k++) {
          var on = k <= m && f[k];
          if (on && a < 0) a = k;
          if (!on && a >= 0) { svg.appendChild(s("rect", { x: X(a), y: y + 2, width: Math.max(1.5, X(k) - X(a)), height: 11, rx: 2, class: sev })); a = -1; }
        }
      });
      /* time axis */
      var tstep = [15, 30, 60, 120, 180, 360, 720, 1440].filter(function (v) { return span / v <= 7; })[0] || 1440;
      for (var mm = 0; mm <= span; mm += tstep) {
        svg.appendChild(s("text", { x: X(mm), y: 296, "text-anchor": "middle", class: "c-small" }, dur(mm, PT)));
      }
      if (m >= 0) svg.appendChild(s("line", { x1: X(m), x2: X(m), y1: T, y2: 284, class: "csim-eb-now" }));

      /* stats at the cursor */
      var firing = m >= 0 ? LANES.filter(function (ln) { return res.fire[ln.id][m]; }).map(function (ln) { return ln.id === "ticket" ? "ticket" : ln.id === "single" ? tr("single", "simples") : "page " + (ln.id === "fast" ? "1 h" : "6 h"); }) : [];
      var b5 = m >= 0 ? res.burn(m, 5) : 0, b60 = m >= 0 ? res.burn(m, 60) : 0;
      st.set("b5", m >= 0 ? num(b5, b5 < 10 ? 1 : 0, PT) + "×" : "–", b5 > 14.4 ? "bad" : b5 > 1 ? "warn" : "");
      st.set("b60", m >= 0 ? num(b60, b60 < 10 ? 1 : 0, PT) + "×" : "–", b60 > 14.4 ? "bad" : b60 > 1 ? "warn" : "");
      var used = m >= 0 ? res.consumedAt(m) : 0;
      st.set("used", num(used, used < 10 ? 1 : 0, PT) + "%", used >= 100 ? "bad" : used > 10 ? "warn" : "");
      st.set("alert", firing.length ? firing.join(" · ") : tr("none", "nenhum"), firing.length ? "bad" : "ok");

      /* the summary: detection and reset of each rule */
      var d = res.detect, r = res.reset;
      function when(v) { return v === null ? null : dur(v, PT); }
      var parts = [];
      parts.push(tr("Burn rate ", "Burn rate ") + num(res.incidentBurn, res.incidentBurn < 10 ? 1 : 0, PT) + "×: " +
        tr("at this pace the whole budget lasts ", "neste ritmo o orçamento inteiro dura ") + dur(res.exhaustDays * 1440, PT) + ". " +
        tr("The incident spends ", "O incidente gasta ") + num(res.consumed, res.consumed < 10 ? 1 : 0, PT) + tr("% of the 28-day budget.", "% do orçamento de 28 dias."));
      if (d.fast !== null || d.slow !== null) {
        var pg = d.fast !== null && (d.slow === null || d.fast <= d.slow) ? "fast" : "slow";
        parts.push(tr("Page after ", "Page depois de ") + when(d[pg]) + tr(" (rule ", " (regra ") + (pg === "fast" ? "1 h/5 min" : "6 h/30 min") + ")" +
          tr(", silent ", ", silencia ") + when(r[pg]) + tr(" after the incident ends", " depois do fim do incidente") +
          (d.single !== null ? tr("; the single-window rule pages after ", "; a regra de janela única dispara depois de ") + when(d.single) + tr(" and keeps paging ", " e continua disparando ") + when(r.single) + tr(" after the end.", " depois do fim.") : "."));
      } else parts.push(tr("No page.", "Nenhum page."));
      parts.push(d.ticket !== null ? tr("Ticket after ", "Ticket depois de ") + when(d.ticket) + "." : tr("No ticket.", "Nenhum ticket."));
      note.textContent = parts.join(" ");
      note.className = "csim-note " + (res.consumed >= 100 ? "csim-bad" : d.fast !== null || d.slow !== null ? "csim-warn" : "csim-ok");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: tr("An incident against a 99.9% SLO: who gets paged, and when?", "Um incidente contra um SLO de 99,9%: quem é acionado e quando?") }),
      el("p", { class: "csim-sub", text: tr(
        "The order service: 1,000,000 requests a day, SLO 99.9% over 28 days (budget: 28,000 failed requests), background errors 0.01%. Burn rate = error rate ÷ 0.1%. The first three rules are the SRE Workbook's; the last one has no short window.",
        "O serviço de pedidos: 1.000.000 de requisições por dia, SLO de 99,9% em 28 dias (orçamento: 28.000 requisições com falha), erros de fundo de 0,01%. Burn rate = taxa de erro ÷ 0,1%. As três primeiras regras são as do SRE Workbook; a última não tem janela curta.") }),
      el("div", { class: "csim-row" }, [cSc]),
      el("div", { class: "csim-row" }, [sRate, sDur]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-legend csim-eb-legend" }, LINES.map(function (ln) { return el("span", { class: ln.cls }, [el("i"), ln.label]); })),
      st,
      note,
      bar
    ]);
    draw();
    return {};
  });
})();
