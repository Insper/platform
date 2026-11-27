/*
 * SLI → SLO → SLA over one 28-day window (2026.2 "Reliability — SLI / SLO / SLA", 2027.1
 * "Observability — SLOs"):
 *
 *   <div class="csim" data-sim="slo-month" data-who="order" data-scenario="deploy"></div>
 *
 * The pages' service (`data-who`: the order service of 2026.2, the purchase path of 2027.1): 1,000,000
 * requests a day, constant, so 28,000,000 in the window, with a quiet background of 0.01% errors. The SLO is
 * 99.9% (or 99.95%, or 99.5%, the SLA itself), the SLA 99.5%. The window is the 28 days that end today and the
 * 28 days before this month were quiet, so it always holds 28,000,000 requests: the background's 2,800 failed
 * requests plus the incidents seen so far. The incidents are the pages' cases: the bad deploy (20,000
 * failed requests in one hour), a database failover (3% for 12 h), a region outage (every request for 4 h).
 *
 * Each moment, the ladder reads the window: telemetry (requests, failed) → SLI = good ÷ valid →
 * compared with the SLO (the budget = 1 − SLO, in failed requests) → the SLA, looser → the decision of
 * the error budget policy: ship while there is budget, freeze when it is gone, credits when the SLA is broken.
 */
(function () {
  "use strict";
  var CFG = { days: 28, perDay: 1e6, background: 0.0001, sla: 99.5, slo: 99.9, step: 3 / 24 };
  var INCIDENTS = {
    deploy: { start: 8.6, hours: 1, rate: 20000 / (1e6 / 24) },
    failover: { start: 18.3, hours: 12, rate: 0.03 },
    outage: { start: 13.4, hours: 4, rate: 1 }
  };
  var SCENARIOS = {
    quiet: [],
    deploy: ["deploy"],
    two: ["deploy", "failover"],
    outage: ["outage"]
  };
  var SLOS = [99.95, 99.9, 99.5];

  /* o: {scenario, slo, sla} → the window at any time t (days elapsed, 0 … 28) */
  function run(o) {
    var slo = o.slo || CFG.slo, sla = o.sla || CFG.sla;
    var total = CFG.perDay * CFG.days;
    var base = CFG.background * total;
    var incs = (SCENARIOS[o.scenario] || []).map(function (id) {
      var x = INCIDENTS[id];
      return { id: id, start: x.start, end: x.start + x.hours / 24, rate: x.rate, failed: x.rate * CFG.perDay * x.hours / 24 };
    });
    var budget = (1 - slo / 100) * total;
    var slaBudget = (1 - sla / 100) * total;
    function failedAt(t) {
      return base + incs.reduce(function (a, x) {
        return a + x.rate * CFG.perDay * Math.max(0, Math.min(t, x.end) - x.start);
      }, 0);
    }
    function at(t) {
      var f = failedAt(t), sli = 100 * (1 - f / total);
      var state = sli >= slo ? "ok" : sli >= sla ? "warn" : "bad";
      return { t: t, failed: f, good: total - f, sli: sli, used: 100 * f / budget, left: budget - f,
        toSla: slaBudget - f, state: state };
    }
    /* the first time (to the minute) the window crosses a line */
    function cross(limit) {
      if (failedAt(CFG.days) <= limit) return null;
      var lo = 0, hi = CFG.days;
      while (hi - lo > 1 / 1440) { var mid = (lo + hi) / 2; if (failedAt(mid) > limit) hi = mid; else lo = mid; }
      return hi;
    }
    return { slo: slo, sla: sla, total: total, base: base, budget: budget, slaBudget: slaBudget, incidents: incs,
      at: at, end: at(CFG.days), sloBreach: cross(budget), slaBreach: cross(slaBudget) };
  }

  function num(v, d, pt) { return v.toLocaleString(pt ? "pt-BR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  /* 99.92%, 99.9%, 99%: at most two decimals */
  function pct(v, pt) { return v.toLocaleString(pt ? "pt-BR" : "en-US", { maximumFractionDigits: 2 }) + "%"; }
  /* day 9 · 15h: the day in progress (1 … 28) and the hour */
  function clock(t, pt) {
    var d = Math.max(1, Math.ceil(t - 1e-9)), h = Math.round((t - (d - 1)) * 24);
    return (pt ? "dia " : "day ") + d + " · " + h + "h";
  }

  var API = { CFG: CFG, INCIDENTS: INCIDENTS, SCENARIOS: SCENARIOS, SLOS: SLOS, run: run, num: num, pct: pct, clock: clock };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, tr = C.t, el = C.el, s = C.s, PT = C.PT;
  var WHO = {
    order: { name: tr("the order service", "o serviço de pedidos"), sub: tr("order service", "serviço de pedidos") },
    purchase: { name: tr("the purchase path", "o caminho de compra"), sub: tr("purchase path", "caminho de compra") }
  };
  var INC_LABEL = {
    deploy: tr("bad deploy", "deploy ruim"),
    failover: tr("DB failover", "failover do BD"),
    outage: tr("region outage", "queda da região")
  };
  /* the chart: x = days, y = the SLI on a "nines" scale (−log10 of the failed fraction) */
  var L = 84, R = 412, T = 18, B = 262, TOP = 99.995, BOT = 99;
  function X(t) { return L + (R - L) * t / CFG.days; }
  function Y(sli) {
    var u = Math.max(1 - TOP / 100, Math.min(1 - BOT / 100, 1 - sli / 100));
    var a = Math.log10(1 - TOP / 100), b = Math.log10(1 - BOT / 100);
    return T + (B - T) * (Math.log10(u) - a) / (b - a);
  }

  C.style("slo-month", [
    ".md-typeset .csim-sm-band.ok { fill: color-mix(in srgb, var(--c-ok) 9%, var(--c-bg)); }",
    ".md-typeset .csim-sm-band.warn { fill: color-mix(in srgb, var(--c-warn) 11%, var(--c-bg)); }",
    ".md-typeset .csim-sm-band.bad { fill: color-mix(in srgb, var(--c-bad) 10%, var(--c-bg)); }",
    ".md-typeset .csim-sm-grid { stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-sm-lim { stroke-width: 1.4; stroke-dasharray: 5 3; }",
    ".md-typeset .csim-sm-lim.ok { stroke: var(--c-ok); } .md-typeset .csim-sm-lim.warn { stroke: var(--c-warn); }",
    ".md-typeset .csim-sm-sli { fill: none; stroke: var(--c-ink); stroke-width: 2.2; stroke-linejoin: round; }",
    ".md-typeset .csim-sm-inc { fill: color-mix(in srgb, var(--c-bad) 22%, transparent); }",
    ".md-typeset .csim-sm-mark { stroke: var(--c-fg3); stroke-width: 1; stroke-dasharray: 2 2; }",
    ".md-typeset .csim-sm-now { stroke: var(--c-accent); stroke-width: 1.5; }",
    ".md-typeset .csim-sm-card { fill: var(--c-bg); stroke: var(--c-line); stroke-width: 1.2; }",
    ".md-typeset .csim-sm-card.ok { stroke: var(--c-ok); fill: color-mix(in srgb, var(--c-ok) 8%, var(--c-bg)); }",
    ".md-typeset .csim-sm-card.warn { stroke: var(--c-warn); fill: color-mix(in srgb, var(--c-warn) 9%, var(--c-bg)); }",
    ".md-typeset .csim-sm-card.bad { stroke: var(--c-bad); fill: color-mix(in srgb, var(--c-bad) 9%, var(--c-bg)); }",
    ".md-typeset .csim-sm-card.ink { stroke: var(--c-ink); fill: var(--c-tint); }",
    ".md-typeset .csim-sm-tag { font-size: 10px; font-weight: 800; letter-spacing: .06em; fill: var(--c-ink); }",
    ".md-typeset .csim-sm-big { font-size: 15px; font-weight: 800; fill: var(--c-fg); font-variant-numeric: tabular-nums; }",
    ".md-typeset .csim-sm-arrow { stroke: var(--c-fg3); stroke-width: 1.2; fill: none; marker-end: url(#csim-sm-ah); }",
    ".md-typeset .csim-sm-ah { fill: var(--c-fg3); }",
    ".md-typeset .csim-sm-track { fill: var(--c-panel); stroke: var(--c-line); }",
    ".md-typeset .csim-sm-verdict { font-size: 11.5px; font-weight: 800; }",
    ".md-typeset .csim .csim-sm-axis { font-size: 9.5px; font-weight: 700; }",
    ".md-typeset .csim-sm-cols > .csim-stage { flex: 2 1 20rem; }",
    ".md-typeset .csim-sm-cols > .csim-sm-side { flex: 1 1 10rem; max-width: 17rem; margin: 0 auto; }",
    ".md-typeset .csim-sm-side svg { display: block; width: 100%; height: auto; }"
  ].join("\n"));

  C.register("slo-month", function (root) {
    var o = C.opts(root, { who: "order", scenario: "deploy", slo: CFG.slo });
    var who = WHO[o.who] || WHO.order;
    var state = { scenario: SCENARIOS[o.scenario] ? o.scenario : "deploy", slo: o.slo, sla: CFG.sla };
    var res = run(state), STEPS = Math.round(CFG.days / CFG.step), cursor = STEPS;
    root.classList.add("csim-sm");

    var cs = s("svg", { viewBox: "0 0 420 284", role: "img", "aria-label": tr("The SLI of one 28-day window against the SLO and the SLA", "O SLI de uma janela de 28 dias contra o SLO e o SLA") });
    var ls = s("svg", { viewBox: "0 0 210 300", class: "csim-sm-ladder", role: "img", "aria-label": tr("Telemetry, SLI, SLO, SLA and the decision at that moment", "Telemetria, SLI, SLO, SLA e a decisão naquele momento") });
    var note = el("p", { class: "csim-note" });

    var cSc = C.choice({ label: tr("Month", "Mês"), value: state.scenario, options: [
      { value: "quiet", label: tr("quiet", "tranquilo") },
      { value: "deploy", label: tr("bad deploy", "deploy ruim") },
      { value: "two", label: tr("deploy + failover", "deploy + failover") },
      { value: "outage", label: tr("region outage", "queda da região") }],
      onChange: function (v) { state.scenario = v; recompute(); } });
    var cSlo = C.choice({ label: "SLO", value: state.slo, options: SLOS.map(function (v) {
      return { value: v, label: pct(v, PT) + (v === CFG.sla ? tr(" (= SLA)", " (= SLA)") : "") };
    }), onChange: function (v) { state.slo = v; recompute(); } });

    var bar = C.player({ interval: 70, onTick: function (k) { cursor = k; draw(); },
      onReset: function () { cursor = 0; draw(); }, onPrev: function (k) { cursor = k; draw(); },
      label: function () { return clock(cursor * CFG.step, PT) + tr(" of 28", " de 28"); } });
    bar.total(STEPS);
    bar.jump(STEPS);

    function recompute() { res = run(state); draw(); }

    function txt(x, y, cls, content, anchor) {
      return s("text", { x: x, y: y, class: cls, "text-anchor": anchor || "start" }, content);
    }

    function drawChart(now) {
      var slo = res.slo, sla = res.sla;
      cs.appendChild(s("rect", { x: L, y: T, width: R - L, height: Y(slo) - T, class: "csim-sm-band ok" }));
      if (sla < slo) cs.appendChild(s("rect", { x: L, y: Y(slo), width: R - L, height: Y(sla) - Y(slo), class: "csim-sm-band warn" }));
      cs.appendChild(s("rect", { x: L, y: Y(sla), width: R - L, height: B - Y(sla), class: "csim-sm-band bad" }));
      [99.99, 99.95, 99.9, 99.5, 99].forEach(function (v) {
        cs.appendChild(s("line", { x1: L, x2: R, y1: Y(v), y2: Y(v), class: "csim-sm-grid" }));
        if (v !== slo && v !== sla) cs.appendChild(txt(L - 4, Y(v) + 3, "c-small", pct(v, PT), "end"));
      });
      cs.appendChild(s("line", { x1: L, x2: R, y1: Y(slo), y2: Y(slo), class: "csim-sm-lim ok" }));
      cs.appendChild(s("line", { x1: L, x2: R, y1: Y(sla), y2: Y(sla), class: "csim-sm-lim warn" }));
      /* the two lines name themselves on the axis */
      if (sla < slo) cs.appendChild(txt(L - 4, Y(slo) + 3, "csim-sm-axis c-ok", "SLO " + pct(slo, PT), "end"));
      cs.appendChild(txt(L - 4, Y(sla) + 3, "csim-sm-axis c-warn", (sla === slo ? "SLO = SLA " : "SLA ") + pct(sla, PT), "end"));
      cs.appendChild(txt(L, 11, "c-small", tr("SLI of the 28-day window that ends at that moment (nines scale)", "SLI da janela de 28 dias que termina naquele momento (escala de noves)")));
      /* the incidents */
      res.incidents.forEach(function (x, i) {
        cs.appendChild(s("rect", { x: X(x.start), y: T, width: Math.max(2, X(x.end) - X(x.start)), height: B - T, class: "csim-sm-inc" }));
        cs.appendChild(txt(X(x.start) + (x.start > 20 ? -3 : 3), B - 6 - 11 * i, "c-small c-bad", INC_LABEL[x.id], x.start > 20 ? "end" : "start"));
      });
      /* the SLI so far */
      var pts = [];
      for (var k = 0; k <= cursor; k++) { var t = k * CFG.step; pts.push(X(t).toFixed(1) + "," + Y(res.at(t).sli).toFixed(1)); }
      res.incidents.forEach(function (x) {
        [x.start, x.end].forEach(function (t) { if (t <= now.t) pts.push(X(t).toFixed(1) + "," + Y(res.at(t).sli).toFixed(1)); });
      });
      pts.sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
      cs.appendChild(s("polyline", { points: pts.join(" "), class: "csim-sm-sli" }));
      cs.appendChild(s("circle", { cx: X(now.t), cy: Y(now.sli), r: 4, class: "c-dot " + (now.state === "ok" ? "ok" : now.state === "bad" ? "bad" : "") }));
      /* the moments the lines are crossed */
      [[res.sloBreach, tr("budget gone", "orçamento esgotado")], [res.slaBreach, tr("SLA broken", "SLA violado")]].forEach(function (m, i) {
        if (m[0] === null || m[0] > now.t || (i === 1 && res.sloBreach !== null && Math.abs(res.slaBreach - res.sloBreach) < 1e-6)) return;
        cs.appendChild(s("line", { x1: X(m[0]), x2: X(m[0]), y1: T, y2: B, class: "csim-sm-mark" }));
        cs.appendChild(txt(X(m[0]) + (m[0] > 20 ? -3 : 3), T + 10 + 11 * i, "c-small", m[1], m[0] > 20 ? "end" : "start"));
      });
      for (var d = 0; d <= CFG.days; d += 7) cs.appendChild(txt(X(d), B + 13, "c-small", d ? tr("day ", "dia ") + d : "0", "middle"));
      cs.appendChild(s("line", { x1: X(now.t), x2: X(now.t), y1: T, y2: B, class: "csim-sm-now" }));
    }

    /* the ladder: telemetry → SLI → SLO (+ budget) → SLA → decision */
    function drawLadder(now) {
      var x0 = 4, w = 202, slo = res.slo, sla = res.sla;
      function card(y, h, tone, tag) {
        ls.appendChild(s("rect", { x: x0, y: y, width: w, height: h, rx: 6, class: "csim-sm-card " + (tone || "") }));
        ls.appendChild(txt(x0 + 8, y + 13, "csim-sm-tag", tag));
      }
      function arrow(y1, y2, label) {
        ls.appendChild(s("line", { x1: x0 + 18, x2: x0 + 18, y1: y1, y2: y2 - 1, class: "csim-sm-arrow" }));
        ls.appendChild(txt(x0 + 25, (y1 + y2) / 2 + 3, "c-small", label));
      }
      var defs = s("defs");
      var mk = s("marker", { id: "csim-sm-ah", viewBox: "0 0 6 6", refX: 5, refY: 3, markerWidth: 6, markerHeight: 6, orient: "auto" });
      mk.appendChild(s("path", { d: "M0,0 L6,3 L0,6 z", class: "csim-sm-ah" }));
      defs.appendChild(mk);
      ls.appendChild(defs);

      card(4, 34, "", tr("TELEMETRY", "TELEMETRIA"));
      ls.appendChild(txt(x0 + 8, 30, "c-small", num(res.total, 0, PT) + tr(" requests · ", " requisições · ") + num(Math.round(now.failed), 0, PT) + tr(" failed", " com falha")));
      arrow(38, 52, tr("good ÷ valid", "boas ÷ válidas"));
      card(52, 44, "ink", "SLI");
      ls.appendChild(txt(x0 + 8, 87, "csim-sm-big", pct(now.sli, PT)));
      ls.appendChild(txt(x0 + w - 8, 87, "c-small", tr("measured", "medido"), "end"));
      arrow(96, 110, tr("compared with", "comparado com"));
      var used = Math.min(100, Math.max(0, now.used));
      card(110, 62, now.sli >= slo ? "ok" : "warn", "SLO ≥ " + pct(slo, PT));
      ls.appendChild(txt(x0 + w - 8, 123, "c-small " + (now.sli >= slo ? "c-ok" : "c-warn"), now.sli >= slo ? tr("met ✓", "cumprido ✓") : tr("missed ✗", "não cumprido ✗"), "end"));
      ls.appendChild(txt(x0 + 8, 140, "c-small", tr("error budget: ", "orçamento de erro: ") + num(res.budget, 0, PT) + tr(" failed requests", " falhas")));
      ls.appendChild(s("rect", { x: x0 + 8, y: 147, width: w - 16, height: 9, rx: 3, class: "csim-sm-track" }));
      ls.appendChild(s("rect", { x: x0 + 8, y: 147, width: (w - 16) * used / 100, height: 9, rx: 3, class: now.used >= 100 ? "c-fill-bad" : now.used >= 75 ? "c-fill-warn" : "c-fill-ok" }));
      ls.appendChild(txt(x0 + 8, 166, "c-small", num(now.used, now.used < 10 ? 1 : 0, PT) + tr("% spent · ", "% gasto · ") +
        (now.left > 0 ? num(Math.round(now.left), 0, PT) + tr(" left", " restantes") : tr("nothing left", "nada restante"))));
      arrow(172, 186, tr("looser:", "mais folgado:"));
      card(186, 44, now.sli >= sla ? "ok" : "bad", "SLA ≥ " + pct(sla, PT));
      ls.appendChild(txt(x0 + w - 8, 199, "c-small " + (now.sli >= sla ? "c-ok" : "c-bad"), now.sli >= sla ? tr("kept ✓", "respeitado ✓") : tr("broken ✗", "violado ✗"), "end"));
      ls.appendChild(txt(x0 + 8, 218, "c-small", now.sli >= sla ? tr("margin: ", "margem: ") + num(Math.round(now.toSla), 0, PT) + tr(" more failures", " falhas a mais") : tr("service credits owed to customers", "créditos devidos aos clientes")));
      arrow(230, 244, tr("so the policy says", "então a política diz"));
      card(244, 52, now.state === "ok" ? "ok" : now.state === "warn" ? "warn" : "bad", tr("DECISION", "DECISÃO"));
      var v = now.state === "ok" ? [tr("Ship features", "Entregar features"), tr("the budget pays for the risk", "o orçamento paga o risco")]
        : now.state === "warn" ? [tr("Freeze deploys", "Congelar deploys"), tr("reliability work first; no penalty", "confiabilidade primeiro; sem multa")]
        : [tr("Freeze + pay credits", "Congelar + pagar créditos"), sla === slo ? tr("no warning: SLO = SLA", "sem aviso: SLO = SLA") : tr("the contract was broken", "o contrato foi violado")];
      ls.appendChild(txt(x0 + 8, 274, "csim-sm-verdict " + (now.state === "ok" ? "c-ok" : now.state === "warn" ? "c-warn" : "c-bad"), v[0]));
      ls.appendChild(txt(x0 + 8, 288, "c-small", v[1]));
    }

    function draw() {
      var now = res.at(cursor * CFG.step);
      C.clear(cs);
      C.clear(ls);
      drawChart(now);
      drawLadder(now);
      bar.refresh();
      /* the summary: the whole window */
      var e = res.end, parts = [];
      parts.push(tr("At the end of the 28 days ", "Ao fim dos 28 dias ") + who.name + tr(" has ", " tem ") + num(Math.round(e.failed), 0, PT) +
        tr(" failed requests out of ", " requisições com falha em ") + num(res.total, 0, PT) + ": SLI " + pct(e.sli, PT) + tr(", ", ", ") +
        num(e.used, e.used < 10 ? 1 : 0, PT) + tr("% of the error budget.", "% do orçamento de erro."));
      if (res.sloBreach === null) parts.push(tr("The SLO holds: keep shipping", "O SLO se mantém: continue entregando") +
        (e.left < res.budget * 0.25 ? tr(", carefully — only ", ", com cuidado — restam só ") + num(Math.round(e.left), 0, PT) + tr(" failed requests are left.", " requisições com falha.") : "."));
      else if (res.slaBreach === null) parts.push(tr("The budget runs out on ", "O orçamento acaba no ") + clock(res.sloBreach, PT) +
        tr(": freeze deploys. The SLA still holds, with ", ": congele os deploys. O SLA ainda vale, com ") + num(Math.round(e.toSla), 0, PT) + tr(" failed requests of margin — no credits.", " requisições com falha de margem — sem créditos."));
      else parts.push((Math.abs(res.slaBreach - res.sloBreach) < 1e-6
        ? tr("The SLO and the SLA break together, on ", "O SLO e o SLA quebram juntos, no ") + clock(res.slaBreach, PT) + tr(": with no gap between them there is no warning.", ": sem folga entre eles não há aviso.")
        : tr("The budget runs out on ", "O orçamento acaba no ") + clock(res.sloBreach, PT) + tr(" and the SLA breaks on ", " e o SLA quebra no ") + clock(res.slaBreach, PT) + ".") +
        tr(" Customers are owed service credits.", " Os clientes têm direito a créditos."));
      note.textContent = parts.join(" ");
      note.className = "csim-note csim-" + e.state;
    }

    C.add(root, [
      el("p", { class: "csim-title", text: tr("One month of SLI, SLO and SLA: ship or freeze?", "Um mês de SLI, SLO e SLA: entregar ou congelar?") }),
      el("p", { class: "csim-sub", text: tr(
        "The " + who.sub + ": 1,000,000 requests a day, 0.01% background errors. The SLI is measured over the 28-day window; the SLO decides the error budget, the SLA (99.5%) is the contract. Pick a month and play it.",
        "O " + who.sub + ": 1.000.000 de requisições por dia, 0,01% de erros de fundo. O SLI é medido na janela de 28 dias; o SLO define o orçamento de erro e o SLA (99,5%) é o contrato. Escolha um mês e reproduza.") }),
      el("div", { class: "csim-row" }, [cSc, cSlo]),
      el("div", { class: "csim-cols csim-sm-cols" }, [el("div", { class: "csim-stage" }, cs), el("div", { class: "csim-sm-side" }, ls)]),
      note,
      bar
    ]);
    draw();
    return {};
  });
})();
