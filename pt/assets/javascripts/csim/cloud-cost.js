/*
 * What the same workload costs on IaaS, CaaS and FaaS as traffic grows (2026.2, class "Service models"):
 *
 *   <div class="csim" data-sim="cloud-cost" data-requests="1000000" data-duration="100" data-memory="512"></div>
 *
 * One HTTP endpoint, R requests per month, each taking `duration` ms. Three ways to run it, compute only:
 *   - IaaS: always-on EC2 t3.medium VMs (2 vCPU, 4 GB), at least 2 for redundancy;
 *   - CaaS: always-on Fargate tasks (0.5 vCPU, 1 GB), at least 2, billed per vCPU-hour and GB-hour;
 *   - FaaS: Lambda, billed per request and per GB-second of `memory` × `duration` (free tier ignored).
 * VMs and tasks are sized for the peak, taken as PEAK × the monthly average rate; each vCPU keeps
 * INFLIGHT_PER_VCPU requests in flight, so a unit serves inflight × 1000 / duration requests per second.
 * The function memory only changes the FaaS price: VM and task sizes are fixed.
 * Not included: load balancer or API Gateway, data transfer, storage, logs, free tiers, t3 CPU credits.
 */
(function () {
  "use strict";

  /*
   * On-demand list prices in USD, us-east-1 (N. Virginia), Linux/x86, checked in November 2026.
   * EC2 and Fargate are the ones of the Cloud Deployment class (deployment/index.md, October 2026);
   * Lambda from https://aws.amazon.com/lambda/pricing/ (first duration tier).
   */
  var PRICES = {
    ec2_t3_medium_h: 0.0416,      /* EC2 t3.medium, per hour */
    fargate_vcpu_h: 0.04048,      /* Fargate, per vCPU-hour */
    fargate_gb_h: 0.004445,       /* Fargate, per GB-hour */
    lambda_per_million: 0.20,     /* Lambda, per 1 million requests */
    lambda_gb_s: 0.0000166667     /* Lambda, per GB-second */
  };
  var HOURS = 730;                          /* hours in a billing month */
  var SECONDS = HOURS * 3600;
  var PEAK = 3;                             /* peak rate ÷ monthly average rate */
  var INFLIGHT_PER_VCPU = 20;               /* requests a vCPU keeps in flight (an I/O-bound service) */
  var VM = { vcpu: 2, gb: 4, min: 2 };
  var TASK = { vcpu: 0.5, gb: 1, min: 2 };
  var RANGE = [1e4, 1e9];                   /* requests per month shown */

  function vmMonthly() { return PRICES.ec2_t3_medium_h * HOURS; }
  function taskMonthly() { return (TASK.vcpu * PRICES.fargate_vcpu_h + TASK.gb * PRICES.fargate_gb_h) * HOURS; }

  /* requests per second one unit (VM or task) keeps up with */
  function capacity(unit, duration) { return unit.vcpu * INFLIGHT_PER_VCPU * 1000 / duration; }
  function peakRps(requests) { return PEAK * requests / SECONDS; }
  function units(unit, requests, duration) { return Math.max(unit.min, Math.ceil(peakRps(requests) / capacity(unit, duration) - 1e-9)); }

  /* o: {requests, duration (ms), memory (MB)} → monthly cost of each model and its sizing */
  function costs(o) {
    var vms = units(VM, o.requests, o.duration), tasks = units(TASK, o.requests, o.duration);
    var gbs = o.requests * (o.duration / 1000) * (o.memory / 1024);
    var faasReq = o.requests / 1e6 * PRICES.lambda_per_million, faasDur = gbs * PRICES.lambda_gb_s;
    return {
      iaas: vms * vmMonthly(), caas: tasks * taskMonthly(), faas: faasReq + faasDur,
      vms: vms, tasks: tasks, gbs: gbs, faasReq: faasReq, faasDur: faasDur,
      avgRps: o.requests / SECONDS, peakRps: peakRps(o.requests)
    };
  }

  function cheapestAlwaysOn(c) { return Math.min(c.iaas, c.caas); }

  /*
   * The break-even: the fewest requests per month at which FaaS costs as much as the cheaper
   * always-on option. FaaS is k × R; the always-on cost A(R) is a non-decreasing step function, so
   * R ← A(R) / k climbs to the first crossing (every R below it has k·R < A(R)).
   */
  function breakEven(o) {
    var k = costs({ requests: 1e6, duration: o.duration, memory: o.memory }).faas / 1e6;
    var r = 0;
    for (var i = 0; i < 200; i++) {
      var a = cheapestAlwaysOn(costs({ requests: r, duration: o.duration, memory: o.memory }));
      var next = a / k;
      if (next <= r * (1 + 1e-12)) break;
      r = next;
      if (r > 1e13) return null;
    }
    var c = costs({ requests: r, duration: o.duration, memory: o.memory });
    return { requests: r, cost: c.faas, vs: c.caas <= c.iaas ? "caas" : "iaas", avgRps: r / SECONDS };
  }

  /* numbers as each language writes them */
  function num(v, d, pt) {
    return v.toLocaleString(pt ? "pt-BR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function money(v, pt) {
    var d = v < 1 ? 3 : v < 100 ? 2 : 0;
    return (pt ? "US$ " : "$") + num(v, d, pt);
  }
  /* 10 k / 10 mil, 34.9 M / 34,9 mi, 1 B / 1 bi */
  function reqs(v, pt) {
    function short(x) { var r = Math.round(x * 10) / 10; return num(r, x < 100 && r % 1 ? 1 : 0, pt); }
    if (v >= 1e9 - 0.5) return short(v / 1e9) + (pt ? " bi" : " B");
    if (v >= 1e6 - 0.5) return short(v / 1e6) + (pt ? " mi" : " M");
    if (v >= 1e3 - 0.5) return short(v / 1e3) + (pt ? " mil" : " k");
    return num(Math.round(v), 0, pt);
  }

  var API = { PRICES: PRICES, HOURS: HOURS, PEAK: PEAK, INFLIGHT_PER_VCPU: INFLIGHT_PER_VCPU, VM: VM, TASK: TASK, RANGE: RANGE,
    vmMonthly: vmMonthly, taskMonthly: taskMonthly, capacity: capacity, costs: costs, breakEven: breakEven, money: money, reqs: reqs, num: num };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var L = 64, R = 628, T = 26, B = 236;
  var SERIES = [
    { key: "iaas", cat: "cat-0", label: t("IaaS: EC2 t3.medium VMs", "IaaS: VMs EC2 t3.medium") },
    { key: "caas", cat: "cat-1", label: t("CaaS: Fargate tasks", "CaaS: tasks Fargate") },
    { key: "faas", cat: "cat-2", label: t("FaaS: Lambda", "FaaS: Lambda") }
  ];

  C.style("cloud-cost", [
    ".md-typeset .csim-cc-line { fill: none; stroke: var(--cat); stroke-width: 2.2; stroke-linejoin: round; }",
    ".md-typeset .csim-cc-dot { fill: var(--cat); stroke: var(--c-bg); stroke-width: 1.5; }",
    ".md-typeset .csim-cc-grid { stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-cc-axis { stroke: var(--c-fg3); stroke-width: 1; }",
    ".md-typeset .csim-cc-cheap { fill: color-mix(in srgb, var(--c-warn) 10%, var(--c-bg)); }",
    ".md-typeset .csim-cc-be { stroke: var(--c-fg2); stroke-width: 1.2; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-cc-now { stroke: var(--c-accent); stroke-width: 1.5; }",
    ".md-typeset .csim-cc-legend span i { background: var(--cat); }",
    ".md-typeset .csim-cc .csim-slider input[type=range] { width: 9rem; }"
  ].join("\n"));

  C.register("cloud-cost", function (root) {
    var o = C.opts(root, { requests: 1e6, duration: 100, memory: 512 });
    var state = { requests: o.requests, duration: o.duration, memory: o.memory };
    root.classList.add("csim-cc");

    var svg = s("svg", { viewBox: "0 0 640 264", role: "img", "aria-label": t("Monthly cost versus requests per month", "Custo mensal versus requisições por mês") });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "iaas", label: t("IaaS per month", "IaaS por mês") },
      { key: "caas", label: t("CaaS per month", "CaaS por mês") },
      { key: "faas", label: t("FaaS per month", "FaaS por mês") },
      { key: "be", label: t("break-even (FaaS stops being cheaper)", "ponto de equilíbrio (FaaS deixa de ser mais barato)") }
    ]);

    var sReq = C.slider({ label: t("Requests / month", "Requisições / mês"), min: 4, max: 9, step: 0.05, value: Math.log10(state.requests),
      fmt: function (x) { return reqs(Math.pow(10, x), PT); },
      onInput: function (x) { state.requests = Math.round(Math.pow(10, x)); draw(); } });
    var sDur = C.slider({ label: t("Duration", "Duração"), min: 10, max: 1000, step: 10, value: state.duration,
      fmt: function (v) { return v + " ms"; }, onInput: function (v) { state.duration = v; draw(); } });
    var sMem = C.slider({ label: t("Function memory", "Memória da função"), min: 128, max: 2048, step: 64, value: state.memory,
      fmt: function (v) { return v + " MB"; }, onInput: function (v) { state.memory = v; draw(); } });

    function X(r) { return L + (R - L) * (Math.log10(r) - 4) / 5; }

    function draw() {
      var c = costs(state), be = breakEven(state);
      /* y range: whole decades around every curve over the x range */
      var pts = [], lo = Infinity, hi = 0, N = 240;
      for (var i = 0; i <= N; i++) {
        var r = Math.pow(10, 4 + 5 * i / N), ci = costs({ requests: r, duration: state.duration, memory: state.memory });
        pts.push({ r: r, c: ci });
        SERIES.forEach(function (se) { lo = Math.min(lo, ci[se.key]); hi = Math.max(hi, ci[se.key]); });
      }
      var y0 = Math.floor(Math.log10(lo)), y1 = Math.ceil(Math.log10(hi));
      if (y1 - y0 < 2) y1 = y0 + 2;
      function Y(v) { return B - (B - T) * (Math.log10(Math.max(v, Math.pow(10, y0))) - y0) / (y1 - y0); }

      C.clear(svg);
      /* where FaaS is the cheapest */
      var beX = be && be.requests > RANGE[0] ? Math.min(R, X(Math.min(be.requests, RANGE[1]))) : L;
      if (beX > L) svg.appendChild(s("rect", { x: L, y: T, width: beX - L, height: B - T, class: "csim-cc-cheap" }));
      for (var d = y0; d <= y1; d++) {
        svg.appendChild(s("line", { x1: L, x2: R, y1: Y(Math.pow(10, d)), y2: Y(Math.pow(10, d)), class: "csim-cc-grid" }));
        svg.appendChild(s("text", { x: L - 5, y: Y(Math.pow(10, d)) + 3, "text-anchor": "end", class: "c-small" }, money(Math.pow(10, d), PT).replace(/[.,]00$/, "")));
      }
      for (var e = 4; e <= 9; e++) {
        svg.appendChild(s("line", { x1: X(Math.pow(10, e)), x2: X(Math.pow(10, e)), y1: B, y2: B + 4, class: "csim-cc-axis" }));
        svg.appendChild(s("text", { x: X(Math.pow(10, e)), y: B + 15, "text-anchor": "middle", class: "c-small" }, reqs(Math.pow(10, e), PT)));
      }
      svg.appendChild(s("line", { x1: L, x2: R, y1: B, y2: B, class: "csim-cc-axis" }));
      svg.appendChild(s("text", { x: R, y: B + 27, "text-anchor": "end", class: "c-small" }, t("requests per month (log scale)", "requisições por mês (escala log)")));
      svg.appendChild(s("text", { x: 4, y: 9, class: "c-small" }, t("cost per month (log scale)", "custo por mês (escala log)")));
      SERIES.forEach(function (se) {
        svg.appendChild(s("polyline", { class: "csim-cc-line " + se.cat, points: pts.map(function (p) { return X(p.r).toFixed(1) + "," + Y(p.c[se.key]).toFixed(1); }).join(" ") }));
      });
      if (be && be.requests >= RANGE[0] && be.requests <= RANGE[1]) {
        var bx = X(be.requests);
        svg.appendChild(s("line", { x1: bx, x2: bx, y1: T, y2: B, class: "csim-cc-be" }));
        svg.appendChild(s("text", { x: bx - 4, y: T + 10, "text-anchor": "end", class: "c-small" }, t("FaaS cheapest", "FaaS mais barato")));
        svg.appendChild(s("text", { x: bx + 4, y: T + 10, class: "c-small" }, t("break-even ", "equilíbrio ") + reqs(be.requests, PT)));
      }
      var nx = X(state.requests);
      svg.appendChild(s("line", { x1: nx, x2: nx, y1: T, y2: B, class: "csim-cc-now" }));
      SERIES.forEach(function (se) {
        var dot = s("circle", { cx: nx, cy: Y(c[se.key]), r: 4, class: "csim-cc-dot " + se.cat });
        dot.appendChild(s("title", {}, se.label + ": " + money(c[se.key], PT)));
        svg.appendChild(dot);
      });

      var best = SERIES.map(function (se) { return se.key; }).sort(function (a, b) { return c[a] - c[b]; })[0];
      st.set("iaas", money(c.iaas, PT), best === "iaas" ? "ok" : "");
      st.set("caas", money(c.caas, PT), best === "caas" ? "ok" : "");
      var labels = st.querySelectorAll(".csim-stat span");
      labels[0].textContent = t("IaaS per month · ", "IaaS por mês · ") + c.vms + " VMs";
      labels[1].textContent = t("CaaS per month · ", "CaaS por mês · ") + c.tasks + " tasks";
      st.set("faas", money(c.faas, PT), best === "faas" ? "ok" : "");
      st.set("be", be ? (be.requests < RANGE[0] ? t("below ", "abaixo de ") + reqs(RANGE[0], PT) : be.requests > RANGE[1] ? t("above ", "acima de ") + reqs(RANGE[1], PT) : reqs(be.requests, PT)) : "–", "info");

      var rate = num(c.avgRps, c.avgRps < 10 ? 1 : 0, PT), peak = num(c.peakRps, c.peakRps < 10 ? 1 : 0, PT);
      var gbs = num(Math.round(c.gbs), 0, PT);
      var name = { iaas: "IaaS", caas: "CaaS", faas: "FaaS" }[best];
      note.textContent = t(
        reqs(state.requests, false) + " requests/month is " + rate + " req/s on average, " + peak + " at the peak (" + PEAK + "×). " +
        "A VM keeps up with " + num(capacity(VM, state.duration), 0, false) + " req/s and a task with " + num(capacity(TASK, state.duration), 0, false) +
        " at " + state.duration + " ms, so you pay for " + c.vms + " VMs or " + c.tasks + " tasks all month, busy or idle. " +
        "Lambda bills " + money(c.faasReq, false) + " for the requests plus " + gbs + " GB-s (" + money(c.faasDur, false) + "). Cheapest here: " + name + "." +
        (be ? " FaaS stops being cheaper at " + reqs(be.requests, false) + " requests/month (" + num(be.avgRps, be.avgRps < 100 ? 1 : 0, false) + " req/s on average)." : ""),
        reqs(state.requests, true) + (state.requests >= 1e6 - 0.5 ? " de" : "") + " requisições/mês dão " + rate + " req/s em média, " + peak + " no pico (" + PEAK + "×). " +
        "Uma VM dá conta de " + num(capacity(VM, state.duration), 0, true) + " req/s e uma task de " + num(capacity(TASK, state.duration), 0, true) +
        " com " + state.duration + " ms, então você paga " + c.vms + " VMs ou " + c.tasks + " tasks o mês inteiro, ocupadas ou ociosas. " +
        "O Lambda cobra " + money(c.faasReq, true) + " pelas requisições mais " + gbs + " GB-s (" + money(c.faasDur, true) + "). Mais barato aqui: " + name + "." +
        (be ? " O FaaS deixa de ser mais barato em " + reqs(be.requests, true) + (be.requests >= 1e6 - 0.5 ? " de" : "") + " requisições/mês (" + num(be.avgRps, be.avgRps < 100 ? 1 : 0, true) + " req/s em média)." : ""));
      note.className = "csim-note" + (best === "faas" ? " csim-ok" : "");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The same endpoint on IaaS, CaaS and FaaS: what does a month cost?", "O mesmo endpoint em IaaS, CaaS e FaaS: quanto custa um mês?") }),
      el("p", { class: "csim-sub", text: t(
        "Compute only, AWS us-east-1 on-demand prices (Nov 2026): EC2 t3.medium $" + PRICES.ec2_t3_medium_h + "/h (2 VMs at least); Fargate $" + PRICES.fargate_vcpu_h + "/vCPU-h + $" + PRICES.fargate_gb_h + "/GB-h, tasks of 0.5 vCPU / 1 GB (2 at least); Lambda $0.20 per million requests + $" + PRICES.lambda_gb_s + "/GB-s, free tier ignored. VMs and tasks are sized for a peak of " + PEAK + "× the average.",
        "Só computação, preços sob demanda da AWS em us-east-1 (nov. 2026): EC2 t3.medium US$ " + num(PRICES.ec2_t3_medium_h, 4, true) + "/h (no mínimo 2 VMs); Fargate US$ " + num(PRICES.fargate_vcpu_h, 5, true) + "/vCPU-h + US$ " + num(PRICES.fargate_gb_h, 6, true) + "/GB-h, tasks de 0,5 vCPU / 1 GB (no mínimo 2); Lambda US$ 0,20 por milhão de requisições + US$ " + num(PRICES.lambda_gb_s, 10, true) + "/GB-s, sem o nível gratuito. VMs e tasks são dimensionadas para um pico de " + PEAK + "× a média.") }),
      el("div", { class: "csim-row" }, [sReq, sDur, sMem]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-legend csim-cc-legend" }, SERIES.map(function (se) { return el("span", { class: se.cat }, [el("i"), se.label]); })),
      st,
      note
    ]);
    draw();
    return {};
  });
})();
