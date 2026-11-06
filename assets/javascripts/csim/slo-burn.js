/*
 * Error budget and burn-rate alerts (2027.1, class 13 — SLOs):
 *
 *   <div class="csim" data-sim="slo-burn" data-slo="99.9"></div>
 *
 * data-days and the two paging burn rates default to LAB: lab 9's slo-order.yaml (registered in
 * scripts/csim/lab-values.mjs). The SLO target (data-slo) is the class page's.
 *
 * One SLO window (minute by minute) of the purchase path's error rate: a quiet background
 * with a few short blips, plus the incidents the student injects (error rate × duration). The
 * budget is the SLO's allowed error fraction times the window (constant traffic). Four alerts
 * watch the same series: a naive "error rate > 1 − SLO over 5 min", and the SRE Workbook's
 * multi-window, multi-burn-rate rules (fast page over 1 h and 5 min, slow page over 6 h and 30 min,
 * ticket 1× over 3 days and 6 h). The player moves a cursor through the window.
 */
(function () {
  "use strict";

  /* values read from lab 9's alert rules (scripts/csim/lab-values.mjs checks them) */
  var LAB = { days: 28, fastBurn: 14.4, slowBurn: 6 };
  var DAY = 1440, BACKGROUND = 0.0001;
  var RULES = [
    { id: "naive", long: 5, short: 5, burn: 1, sev: "page" },
    { id: "fast", long: 60, short: 5, burn: LAB.fastBurn, sev: "page" },
    { id: "slow", long: 360, short: 30, burn: LAB.slowBurn, sev: "page" },
    { id: "ticket", long: 3 * DAY, short: 360, burn: 1, sev: "ticket" }
  ];

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* short harmless blips: 5–15 min at 0.2–0.8% errors, about one every two days */
  function blips(days, seed) {
    var r = rng(seed || 5), out = [];
    for (var d = 0; d < days; d += 2) {
      out.push({ start: Math.floor((d + r() * 2) * DAY), dur: 5 + Math.floor(r() * 11), rate: 0.002 + r() * 0.006, blip: true });
    }
    return out;
  }

  /* the page's two incidents: a bad deploy (day 9, 10:00, 5% for 3 h), a slow degradation from day 16 (0.2%) */
  function pageIncidents(days) {
    return [{ start: 9 * DAY + 600, dur: 180, rate: 0.05 }, { start: 16 * DAY, dur: (days - 16) * DAY, rate: 0.002 }];
  }

  /*
   * o: {slo: 0.999, days: LAB.days, incidents: [{start, dur, rate}], blips: bool, seed}
   * returns per-minute error rate, prefix sums, budget used, and each alert's firing intervals
   */
  function compute(o) {
    var days = o.days || LAB.days, N = days * DAY, allowed = 1 - (o.slo || 0.999);
    var err = new Float64Array(N).fill(BACKGROUND);
    var all = (o.incidents || []).concat(o.blips === false ? [] : blips(days, o.seed));
    all.forEach(function (inc) {
      for (var m = Math.max(0, inc.start); m < Math.min(N, inc.start + inc.dur); m++) err[m] = Math.max(err[m], inc.rate);
    });
    var P = new Float64Array(N + 1);
    for (var i = 0; i < N; i++) P[i + 1] = P[i] + err[i];
    function avg(m, w) { var a = Math.max(0, m + 1 - w); return (P[m + 1] - P[a]) / (m + 1 - a); }
    function burn(m, w) { return avg(m, w) / allowed; }
    function used(m) { return P[Math.min(N, m + 1)] / (allowed * N); }
    var alerts = {};
    RULES.forEach(function (rule) {
      var list = [], on = null;
      for (var m = 0; m < N; m++) {
        var fire = burn(m, rule.long) > rule.burn && burn(m, rule.short) > rule.burn;
        if (fire && !on) { on = { start: m, end: N, used: used(m) }; list.push(on); }
        if (!fire && on) { on.end = m; on = null; }
      }
      alerts[rule.id] = list;
    });
    return { N: N, days: days, allowed: allowed, err: err, P: P, avg: avg, burn: burn, used: used, alerts: alerts, incidents: o.incidents || [] };
  }

  /* first firing of an alert at or after minute `from` (e.g. an incident's start), or null */
  function firstFiring(model, id, from) {
    var list = model.alerts[id];
    for (var i = 0; i < list.length; i++) if (list[i].end > from) return { at: Math.max(list[i].start, from), used: model.used(Math.max(list[i].start, from)), delay: Math.max(0, list[i].start - from) };
    return null;
  }

  var API = { LAB: LAB, compute: compute, firstFiring: firstFiring, blips: blips, pageIncidents: pageIncidents, RULES: RULES, DAY: DAY };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var L = 132, R = 632, STEP = 120;              /* plot x range; one tick = 2 hours */

  function dec(v, d) { var x = d === undefined ? String(v) : v.toFixed(d); return C.PT ? x.replace(".", ",") : x; }
  function pct(v, d) { return dec(100 * v, d === undefined ? 1 : d) + "%"; }
  function when(m) { var h = Math.floor((m % DAY) / 60), mi = m % 60; return t("day ", "dia ") + Math.floor(m / DAY) + " " + (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi; }
  function span(min) { return min < 60 ? min + " min" : min < DAY ? dec(min / 60, min % 60 ? 1 : 0) + " h" : dec(min / DAY, min % DAY ? 1 : 0) + t(" days", " dias"); }

  C.style("slo-burn", [
    ".md-typeset .csim-sb-inc { fill: color-mix(in srgb, var(--c-bad) 12%, var(--c-bg)); }",
    ".md-typeset .csim-sb-blip { fill: color-mix(in srgb, var(--c-warn) 18%, var(--c-bg)); }",
    ".md-typeset .csim-sb-burn { fill: none; stroke: var(--c-bad); stroke-width: 1.4; }",
    ".md-typeset .csim-sb-budget { fill: none; stroke: var(--c-ink); stroke-width: 2; }",
    ".md-typeset .csim-sb-th { stroke: var(--c-fg3); stroke-dasharray: 4 3; }",
    ".md-typeset .csim-sb-zero { stroke: var(--c-bad); }",
    ".md-typeset .csim-sb-lane { fill: var(--c-panel); }",
    ".md-typeset .csim-sb-fire.page { fill: var(--c-bad); } .md-typeset .csim-sb-fire.ticket { fill: var(--c-warn); }",
    ".md-typeset .csim-sb-fire.naive { fill: var(--c-fg2); }",
    ".md-typeset .csim-sb-cursor { stroke: var(--c-accent); stroke-width: 1.5; }"
  ].join("\n"));

  C.register("slo-burn", function (root) {
    var o = C.opts(root, { slo: 99.9, days: LAB.days, seed: 5 });
    var slo = o.slo / 100, days = o.days, N = days * DAY;
    var incidents = pageIncidents(days), model, cursor = 0, logged = {};
    var rate = 0.05, dur = 180;
    var LABELS = {
      naive: t("naive: errors > " + dec(100 * (1 - slo), 1) + "% (5 min)", "ingênuo: erros > " + dec(100 * (1 - slo), 1) + "% (5 min)"),
      fast: t("page " + dec(LAB.fastBurn) + "× (1 h & 5 min)", "page " + dec(LAB.fastBurn) + "× (1 h e 5 min)"),
      slow: t("page " + dec(LAB.slowBurn) + "× (6 h & 30 min)", "page " + dec(LAB.slowBurn) + "× (6 h e 30 min)"),
      ticket: t("ticket 1× (3 d & 6 h)", "ticket 1× (3 d e 6 h)")
    };
    var svg = s("svg", { viewBox: "0 0 640 300", role: "img", "aria-label": t("Burn rate, error budget and alerts over the SLO window", "Burn rate, error budget e alertas na janela do SLO") });
    var note = el("p", { class: "csim-note" });
    var lg = C.log(8);
    var st = C.stats([
      { key: "budget", label: t("error budget left", "error budget restante") },
      { key: "burn", label: t("burn rate now (1 h)", "burn rate agora (1 h)") },
      { key: "naive", label: t("naive alerts fired", "alertas ingênuos disparados") },
      { key: "smart", label: t("burn-rate pages · tickets", "pages · tickets por burn rate") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }
    function X(m) { return L + (R - L) * m / N; }

    function recompute() { model = compute({ slo: slo, days: days, incidents: incidents, seed: o.seed }); }

    function reset() {
      cursor = 0; logged = {}; lg.clear();
      say(t("A " + dec(100 * slo, 1) + "% SLO over " + days + " days allows " + dec(100 * (1 - slo), 1) + "% errors: " + dec((1 - slo) * N, 1) + " minutes of full outage. Two incidents are scheduled (from the text above), plus a few harmless blips. Press play and watch which alerts fire, and when.",
        "Um SLO de " + dec(100 * slo, 1) + "% em " + days + " dias permite " + dec(100 * (1 - slo), 1) + "% de erros: " + dec((1 - slo) * N, 1) + " minutos de indisponibilidade total. Há dois incidentes programados (os do texto acima), mais alguns soluços inofensivos. Dê play e veja quais alertas disparam, e quando."), "");
      draw();
    }

    function incidentAt(m) {
      var best = null;
      incidents.forEach(function (inc) { if (inc.start <= m && (!best || inc.start > best.start)) best = inc; });
      return best && m < best.start + best.dur + 360 ? best : null;
    }

    function tick() {
      var from = cursor;
      cursor = Math.min(N, cursor + STEP);
      RULES.forEach(function (rule) {
        model.alerts[rule.id].forEach(function (a, k) {
          var key = rule.id + k;
          if (a.start >= from && a.start < cursor && !logged[key]) {
            logged[key] = true;
            var inc = incidentAt(a.start), lbl = LABELS[rule.id];
            var cost = inc ? a.used - (inc.start > 0 ? model.used(inc.start - 1) : 0) : 0;
            var after = inc ? t(", " + span(a.start - inc.start) + " into the incident, which has cost " + pct(cost) + " of the budget", ", " + span(a.start - inc.start) + " após o início do incidente, que já custou " + pct(cost) + " do budget") : t(" (a blip)", " (um soluço)");
            lg.add(when(a.start) + " · " + lbl + after + t(" · total spent ", " · total gasto ") + pct(a.used), rule.id === "naive" ? "" : rule.sev === "page" ? "bad" : "warn");
            if (rule.id === "naive" && !inc) say(t("The naive alert paged someone at " + when(a.start) + " for a " + span(model.alerts.naive[k].end - a.start) + " blip that cost almost nothing. Do this every other night and people stop answering pages.",
              "O alerta ingênuo acordou alguém às " + when(a.start) + " por um soluço de " + span(model.alerts.naive[k].end - a.start) + " que quase não custou nada. Faça isso noite sim, noite não, e ninguém mais atende o pager."), "warn");
            else if (rule.id === "fast") say(t("Fast burn: the 1-hour error rate crossed " + dec(LAB.fastBurn) + "× the allowed one (and the 5-minute rate confirms it is still happening). It pages " + span(a.start - (inc ? inc.start : a.start)) + " after the start, when the incident has cost " + pct(cost) + " of the budget — the page arrives while there is still budget to save.",
              "Queima rápida: a taxa de erros de 1 hora passou de " + dec(LAB.fastBurn) + "× a permitida (e a de 5 minutos confirma que ainda está acontecendo). Ela acorda alguém " + span(a.start - (inc ? inc.start : a.start)) + " após o início, quando o incidente custou " + pct(cost) + " do budget — o page chega enquanto ainda há budget a salvar."), "bad");
            else if (rule.id === "slow") say(t("The " + dec(LAB.slowBurn) + "× rule fires: 6 hours at this rate burn about " + pct(LAB.slowBurn * 360 / N, 0) + " of the budget. Slower than the fast burn, but still worth a page.",
              "A regra de " + dec(LAB.slowBurn) + "× dispara: 6 horas nesse ritmo queimam cerca de " + pct(LAB.slowBurn * 360 / N, 0) + " do budget. Mais lenta que a queima rápida, mas ainda vale um page."), "bad");
            else if (rule.id === "ticket") say(t("Slow burn: nothing pages — the error rate is too low to look alarming — but over 3 days it is above the budget's pace. The ticket fires " + span(a.start - (inc ? inc.start : a.start)) + " in, with " + pct(a.used) + " of the budget spent in total, days before it runs out.",
              "Queima lenta: nada acorda ninguém — a taxa de erros é baixa demais para assustar —, mas em 3 dias ela está acima do ritmo do budget. O ticket dispara após " + span(a.start - (inc ? inc.start : a.start)) + ", com " + pct(a.used) + " do budget gasto no total, dias antes de ele acabar."), "warn");
          }
        });
      });
      if (cursor >= N) {
        var left = 1 - model.used(N - 1);
        say(t("End of the window: " + pct(Math.max(left, 0)) + " of the budget left" + (left < 0 ? " — exhausted, " + pct(-left) + " over" : "") + ". The naive alert fired " + model.alerts.naive.length + " times; the burn-rate rules fired " + (model.alerts.fast.length + model.alerts.slow.length) + " page(s) and " + model.alerts.ticket.length + " ticket(s), each for something that threatened the budget.",
          "Fim da janela: " + pct(Math.max(left, 0)) + " do budget restante" + (left < 0 ? " — esgotado, " + pct(-left) + " acima" : "") + ". O alerta ingênuo disparou " + model.alerts.naive.length + " vezes; as regras de burn rate dispararam " + (model.alerts.fast.length + model.alerts.slow.length) + " page(s) e " + model.alerts.ticket.length + " ticket(s), cada um por algo que ameaçava o budget."), left < 0 ? "bad" : "ok");
      }
      draw();
      if (cursor >= N) return false;
    }

    function line(cls, f, y0, y1, lo, hi, log) {
      var pts = [];
      for (var m = 0; m <= Math.min(cursor, N - 1); m += 20) {
        var v = Math.max(lo, Math.min(hi, f(m)));
        var u = log ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo);
        pts.push(X(m).toFixed(1) + "," + (y1 - (y1 - y0) * u).toFixed(1));
      }
      return s("polyline", { class: cls, points: pts.join(" ") });
    }

    function draw() {
      C.clear(svg);
      /* incidents shaded */
      incidents.concat(blips(days, o.seed)).forEach(function (inc) {
        svg.appendChild(s("rect", { x: X(inc.start), y: 8, width: Math.max(1.5, X(inc.start + inc.dur) - X(inc.start)), height: 112, class: inc.blip ? "csim-sb-blip" : "csim-sb-inc" }));
      });
      /* burn rate (1 h), log scale 0.05 … 100 */
      var y0 = 8, y1 = 120, lo = 0.05, hi = 100;
      function Y(v) { return y1 - (y1 - y0) * (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)); }
      [[LAB.fastBurn, dec(LAB.fastBurn) + "×"], [LAB.slowBurn, dec(LAB.slowBurn) + "×"], [1, "1×"]].forEach(function (th) {
        svg.appendChild(s("line", { x1: L, x2: R, y1: Y(th[0]), y2: Y(th[0]), class: "csim-sb-th" }));
        svg.appendChild(s("text", { x: L - 4, y: Y(th[0]) + 3, "text-anchor": "end", class: "c-small" }, th[1]));
      });
      svg.appendChild(s("text", { x: 4, y: 20, class: "c-label" }, t("burn rate (1 h)", "burn rate (1 h)")));
      svg.appendChild(line("csim-sb-burn", function (m) { return model.burn(m, 60); }, y0, y1, lo, hi, true));
      /* budget remaining, 100% … −50% */
      var b0 = 134, b1 = 206;
      function YB(v) { return b1 - (b1 - b0) * (v + 0.5) / 1.5; }
      svg.appendChild(s("text", { x: 4, y: b0 + 12, class: "c-label" }, t("budget left", "budget restante")));
      [[1, "100%"], [0.5, "50%"], [0, "0%"]].forEach(function (g) {
        svg.appendChild(s("line", { x1: L, x2: R, y1: YB(g[0]), y2: YB(g[0]), class: g[0] === 0 ? "csim-sb-zero" : "csim-sb-th" }));
        svg.appendChild(s("text", { x: L - 4, y: YB(g[0]) + 3, "text-anchor": "end", class: "c-small" }, g[1]));
      });
      svg.appendChild(line("csim-sb-budget", function (m) { return 1 - model.used(m); }, b0, b1, -0.5, 1, false));
      /* alert lanes */
      RULES.forEach(function (rule, i) {
        var y = 216 + i * 18;
        svg.appendChild(s("rect", { x: L, y: y, width: R - L, height: 13, class: "csim-sb-lane" }));
        svg.appendChild(s("text", { x: L - 4, y: y + 10, "text-anchor": "end", class: "c-small" }, LABELS[rule.id]));
        model.alerts[rule.id].forEach(function (a) {
          if (a.start > cursor) return;
          svg.appendChild(s("rect", { x: X(a.start), y: y + 1, width: Math.max(1.5, X(Math.min(a.end, cursor)) - X(a.start)), height: 11, class: "csim-sb-fire " + (rule.id === "naive" ? "naive" : rule.sev) }));
        });
      });
      for (var d = 0; d <= days; d += 7) svg.appendChild(s("text", { x: X(d * DAY), y: 296, "text-anchor": "middle", class: "c-small" }, t("day ", "dia ") + d));
      svg.appendChild(s("line", { x1: X(cursor), x2: X(cursor), y1: 4, y2: 286, class: "csim-sb-cursor" }));
      /* stats at the cursor */
      var m = Math.max(0, Math.min(N - 1, cursor - 1)), left = 1 - model.used(m), br = model.burn(m, 60);
      function count(id) { return model.alerts[id].filter(function (a) { return a.start < cursor; }).length; }
      st.set("budget", pct(left, 0), left > 0.5 ? "ok" : left > 0 ? "warn" : "bad");
      st.set("burn", dec(br, br < 10 ? 1 : 0) + "×", br >= LAB.fastBurn ? "bad" : br >= 1 ? "warn" : "ok");
      st.set("naive", String(count("naive")), count("naive") > 3 ? "warn" : "");
      st.set("smart", (count("fast") + count("slow")) + " · " + count("ticket"), "info");
    }

    var cRate = C.choice({ label: t("Incident errors", "Erros do incidente"), value: rate, options: [0.002, 0.007, 0.02, 0.05, 0.2].map(function (v) {
      return { value: v, label: dec(100 * v, v < 0.01 ? 1 : 0) + "%", title: dec(v / (1 - slo), 0) + "× burn" };
    }), onChange: function (v) { rate = v; } });
    var cDur = C.choice({ label: t("for", "por"), value: dur, options: [30, 180, 720, 3 * DAY].map(function (v) { return { value: v, label: span(v) }; }),
      onChange: function (v) { dur = v; } });
    var bInject = C.button(t("⚡ inject at the cursor", "⚡ injetar no cursor"), function () {
      var start = Math.min(cursor, N - 30);
      incidents.push({ start: start, dur: dur, rate: rate });
      recompute();
      lg.add(when(start) + t(" · incident injected: ", " · incidente injetado: ") + pct(rate) + " (" + dec(rate / (1 - slo), 1) + "×) " + t("for ", "por ") + span(dur), "info");
      say(t("Incident injected at " + when(start) + ": " + pct(rate) + " errors is a burn rate of " + dec(rate / (1 - slo), 1) + "×; over " + span(dur) + " it costs about " + pct(rate * Math.min(dur, N - start) / ((1 - slo) * N), 0) + " of the budget. Play on.",
        "Incidente injetado em " + when(start) + ": " + pct(rate) + " de erros é um burn rate de " + dec(rate / (1 - slo), 1) + "×; em " + span(dur) + " ele custa cerca de " + pct(rate * Math.min(dur, N - start) / ((1 - slo) * N), 0) + " do budget. Continue."), "warn");
      draw();
    }, { tone: "bad" });
    var bClear = C.button(t("clear incidents", "limpar incidentes"), function () { incidents = []; recompute(); player.reset(); });

    var player = C.player({ interval: 110, speeds: [1, 2, 4], onTick: tick, onReset: reset,
      label: function () { return when(Math.min(cursor, N - 1)); } });

    C.add(root, [
      el("p", { class: "csim-title", text: t("Burn-rate alerts: who pages, how soon, and at what cost?", "Alertas de burn rate: quem acorda alguém, quando, e a que custo?") }),
      el("p", { class: "csim-sub", text: t("Purchase path, SLO " + dec(100 * slo, 1) + "% over " + days + " days, constant traffic. Red bands are incidents, orange slivers are short blips. One tick = 2 hours.",
        "Caminho de compra, SLO " + dec(100 * slo, 1) + "% em " + days + " dias, tráfego constante. Faixas vermelhas são incidentes, as laranjas finas são soluços curtos. Um tick = 2 horas.") }),
      el("div", { class: "csim-row" }, [cRate, cDur, bInject, bClear]),
      el("div", { class: "csim-stage" }, svg),
      st,
      lg,
      note,
      player
    ]);
    recompute();
    player.total(N / STEP);
    reset();
    return { destroy: function () { player.pause(); } };
  });
})();
