/*
 * The availability of the BoxOffice purchase path (2027.1, Reliability — overview):
 *
 *   <div class="csim" data-sim="availability-path" data-replicas="1" data-onezone="off"></div>
 *
 * A purchase needs every component of the path (in series: availabilities multiply); a replicated
 * stateless service needs any one of its replicas (in parallel: 1 − (1 − a)^n). The numbers are the
 * page's illustrative ones: load balancer 99.99%, gateway, order and inventory 99.5% per instance, SQL
 * 99.9% (99.95% with automatic failover to a standby in another zone), payment provider 99.9% (two
 * providers in parallel with the fallback). Those numbers assume independent failures, as the page's chart
 * does; the one-zone switch breaks the assumption: with every replica in one availability zone, a zone
 * outage (ZONE, an assumption: 99.9%) stops the whole path at once, whatever the replicas. The weakest
 * link — the component that adds the most downtime — is highlighted.
 */
(function () {
  "use strict";

  var MONTH_MIN = 365.25 / 12 * 24 * 60, ZONE = 0.999;
  var BASE = { lb: 0.9999, gateway: 0.995, order: 0.995, inventory: 0.995, sql: 0.999, sqlFailover: 0.9995, provider: 0.999 };
  var PARTS = ["lb", "gateway", "order", "inventory", "sql", "provider"];
  var STATELESS = { gateway: 1, order: 1, inventory: 1 };

  function parallel(a, n) { return 1 - Math.pow(1 - a, n); }

  /* o: {replicas: {gateway, order, inventory}, failover, providers, oneZone} */
  function evaluate(o) {
    var parts = {};
    PARTS.forEach(function (p) {
      var a = p === "sql" ? (o.failover ? BASE.sqlFailover : BASE.sql) : BASE[p];
      var n = STATELESS[p] ? o.replicas[p] : p === "provider" ? o.providers : 1;
      parts[p] = { a: parallel(a, n), n: n };
    });
    var total = 1;
    PARTS.forEach(function (p) { total *= parts[p].a; });
    if (o.oneZone) { parts.zone = { a: ZONE, n: 1 }; total *= ZONE; }   /* one zone holds every replica: it fails them all */
    var weakest = null;
    Object.keys(parts).forEach(function (p) { if (!weakest || parts[p].a < parts[weakest].a) weakest = p; });
    return { a: total, minutes: (1 - total) * MONTH_MIN, parts: parts, weakest: weakest };
  }

  var API = { evaluate: evaluate, parallel: parallel, BASE: BASE, ZONE: ZONE, MONTH_MIN: MONTH_MIN };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  function dec(v, d) { return v.toFixed(d).replace(".", C.PT ? "," : "."); }
  function pc(a) { return a > 0.99999 ? "≈ 100%" : dec(100 * a, a > 0.9999 ? 4 : a > 0.999 ? 3 : 2) + "%"; }
  var NAME = { lb: "LB", gateway: "gateway", order: "order", inventory: "inventory", sql: "SQL",
    provider: t("provider", "provedor"), zone: t("one zone", "zona única") };

  C.style("availability-path", [
    ".md-typeset .csim-ap-bar { fill: var(--c-bad); }",
    ".md-typeset .csim-ap-bar.weak { fill: var(--c-bad); }",
    ".md-typeset .csim-ap-bar.fine { fill: color-mix(in srgb, var(--c-warn) 70%, var(--c-bg)); }"
  ].join("\n"));

  C.register("availability-path", function (root) {
    var o = C.opts(root, { replicas: 1, onezone: false, failover: false, providers: 1 });
    var svg = s("svg", { viewBox: "0 0 560 150", role: "img", "aria-label": t("the purchase path, component by component", "o caminho da compra, componente a componente") });
    var st = C.stats([
      { key: "a", label: t("purchase path availability", "disponibilidade do caminho da compra") },
      { key: "min", label: t("minutes per month without purchases", "minutos por mês sem compras") },
      { key: "weak", label: t("weakest link", "elo mais fraco") }
    ]);
    var note = el("p", { class: "csim-note" });
    function rep(label, key) {
      return C.slider({ label: label, min: 1, max: 4, value: o.replicas, fmt: function (v) { return "× " + v; }, onInput: draw });
    }
    var rg = rep("gateway"), ro = rep("order"), ri = rep("inventory");
    var fo = C.toggle({ label: t("SQL with automatic failover (Multi-AZ)", "SQL com failover automático (Multi-AZ)"), checked: o.failover, onChange: draw });
    var pv = C.toggle({ label: t("second payment provider as fallback", "segundo provedor de pagamento como fallback"), checked: o.providers > 1, onChange: draw });
    var zn = C.toggle({ label: t("every replica in one zone", "todas as réplicas numa zona"), checked: o.onezone, onChange: draw });

    function state() {
      return { replicas: { gateway: rg.get(), order: ro.get(), inventory: ri.get() }, failover: fo.get(), providers: pv.get() ? 2 : 1, oneZone: zn.get() };
    }

    function draw() {
      var r = evaluate(state()), keys = Object.keys(r.parts);
      C.clear(svg);
      var w = 552 / keys.length, maxDown = 0;
      keys.forEach(function (k) { maxDown = Math.max(maxDown, (1 - r.parts[k].a) * MONTH_MIN); });
      keys.forEach(function (k, i) {
        var p = r.parts[k], x = 4 + i * w, down = (1 - p.a) * MONTH_MIN, weak = k === r.weakest;
        svg.appendChild(s("rect", { x: x + 2, y: 6, width: w - 4, height: 44, rx: 5, class: "c-box " + (weak ? "bad" : p.a > 0.9999 ? "ok" : "on") }));
        svg.appendChild(s("text", { x: x + w / 2, y: 22, "text-anchor": "middle", class: "c-label" }, NAME[k]));
        svg.appendChild(s("text", { x: x + w / 2, y: 38, "text-anchor": "middle", class: "c-small" }, (p.n > 1 ? "× " + p.n + "  " : "") + pc(p.a)));
        if (i < keys.length - 1) svg.appendChild(s("line", { x1: x + w - 2, x2: x + w + 2, y1: 28, y2: 28, class: "c-wire on" }));
        var h = maxDown ? 52 * down / maxDown : 0;
        svg.appendChild(s("rect", { x: x + w / 2 - 12, y: 128 - h, width: 24, height: Math.max(0.5, h), class: "csim-ap-bar " + (weak ? "weak" : "fine") }));
        svg.appendChild(s("text", { x: x + w / 2, y: 142, "text-anchor": "middle", class: "c-small" }, dec(down, down < 10 ? 1 : 0) + " min"));
      });
      svg.appendChild(s("text", { x: 6, y: 66, class: "c-small" }, t("downtime each one adds per month", "indisponibilidade que cada um soma por mês")));
      st.set("a", pc(r.a), r.a >= 0.999 ? "ok" : r.a >= 0.995 ? "warn" : "bad");
      st.set("min", dec(r.minutes, 0), r.minutes < 45 ? "ok" : r.minutes < 220 ? "warn" : "bad");
      st.set("weak", NAME[r.weakest], "bad");
      var sv = state();
      if (sv.oneZone && r.weakest === "zone") note.textContent = t("Every replica sits in one zone: the replicas are not independent. One zone outage stops the whole path — redundancy inside the zone cannot help.",
        "Toda réplica está numa zona só: as réplicas não são independentes. Uma queda da zona para o caminho inteiro — redundância dentro da zona não ajuda.");
      else if (STATELESS[r.weakest]) note.textContent = t("One instance of " + r.weakest + " at 99.5% caps the whole path: add replicas — in parallel, any one of them is enough.",
        "Uma instância do " + r.weakest + " a 99,5% limita o caminho inteiro: adicione réplicas — em paralelo, basta uma delas.");
      else note.textContent = t("The replicated services are now almost perfect; the weakest link moved to " + NAME[r.weakest] + ", which replicas of the services cannot fix.",
        "Os serviços replicados estão quase perfeitos; o elo mais fraco passou a ser " + (r.weakest === "sql" ? "o SQL" : r.weakest === "provider" ? "o provedor de pagamento" : "a " + NAME[r.weakest]) + ", que réplicas dos serviços não resolvem.");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Where does the purchase path lose its minutes?", "Onde o caminho da compra perde os seus minutos?") }),
      el("p", { class: "csim-sub", text: t("Components in series multiply; replicas in parallel need only one alive. Numbers as in the chart above (illustrative).",
        "Componentes em série se multiplicam; réplicas em paralelo precisam de só uma viva. Números como no gráfico acima (ilustrativos).") }),
      el("div", { class: "csim-row" }, [rg, ro, ri]),
      el("div", { class: "csim-row" }, [fo, pv, zn]),
      el("div", { class: "csim-stage" }, svg),
      st,
      note
    ]);
    draw();
    return {};
  });
})();
