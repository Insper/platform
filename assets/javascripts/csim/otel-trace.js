/*
 * The trace of hands-on 11 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="otel-trace" data-script="lab"></div>
 *
 * The page's request, curl POST /orders, through gateway-service → order-service → product-service
 * (the OTEL_SERVICE_NAME values of the lab's compose.yaml), drawn as Jaeger draws it: one bar per
 * span, the width is the duration, the dark part is the span's own (self) time. The controls are the
 * lab's knobs: a delay injected in one service or in the query, the manual span validateOrder of
 * "Adding Custom Spans" (with or without span.end()), OTEL_EXPORTER_OTLP_ENDPOINT pointing at
 * localhost in one service, and OTEL_TRACES_SAMPLER. Under the waterfall, the traceparent header of
 * each hop and the log lines with trace_id and span_id, in the format of the lab's logback-spring.xml.
 *
 * The model: fixed self times (45 ms of gateway before and after, the slow query of the page adds
 * 2 160 ms to a 20 ms SELECT), spans nested as the agent nests them; a span reaches Jaeger only if the
 * trace is sampled, its service exports to jaeger:4317 and, for a manual span, end() was called.
 * Jaeger's self time subtracts only the children it has. The ratio sampler is the agent's
 * TraceIdRatioBased (the low 64 bits of the trace id against ratio × Long.MAX_VALUE), decided at the
 * root and carried downstream in the flags of traceparent. Request 1 is the page's trace
 * (4bf92f35…4736, order-service's span 00f067aa0ba902b7); later ids come from a seeded generator.
 */
(function () {
  "use strict";

  var SERVICES = ["gateway-service", "order-service", "product-service", "account-service"];
  var TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
  var ORDER_SPAN = "00f067aa0ba902b7";
  var ENDPOINT = "http://jaeger:4317";
  var RATIO = 0.1;            /* OTEL_TRACES_SAMPLER_ARG on the page */
  var SLOW = 2160;            /* the page's slow query: a 20 ms SELECT becomes 2 180 ms */
  var MS = { gwPre: 45, gwPost: 45, orPre: 15, validate: 5, insert: 25, orPost: 15, prPre: 5, prPost: 5, select: 20 };
  var REQ = { accountId: 1, productId: 7, quantity: 2 };
  var CLOCK = 14 * 3600000 + 23 * 60000 + 1397;   /* 14:23:01.397: request 1 reaches the gateway */

  function defaults() { return { target: "none", delay: SLOW, custom: "off", localhost: "none", sampler: "always_on" }; }

  /* mulberry32, as CSim.rng, so the model runs without a browser */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hex(r, n) { var s = ""; while (s.length < n) s += ("0000000" + Math.floor(r() * 4294967296).toString(16)).slice(-8); return s.slice(0, n); }

  /* the ids of request seq: trace id, then one span id per span, always in the same order */
  function ids(seq) {
    var r = rng(9000 + seq);
    var o = { trace: hex(r, 32), gw: hex(r, 16), or: hex(r, 16), va: hex(r, 16), pr: hex(r, 16), sq: hex(r, 16), ins: hex(r, 16) };
    if (seq === 1) { o.trace = TRACE_ID; o.or = ORDER_SPAN; }
    return o;
  }

  /* the agent's TraceIdRatioBased: |low 64 bits as a signed long| < ratio × Long.MAX_VALUE */
  var MAXL = BigInt("9223372036854775807"), TWO64 = BigInt("18446744073709551616"), HALF = BigInt("9223372036854775808");
  function sampled(traceId, cfg) {
    if (cfg.sampler !== "ratio") return true;
    var v = BigInt("0x" + traceId.slice(16));
    if (v >= HALF) v = TWO64 - v;
    var bound = RATIO >= 1 ? MAXL : BigInt(Math.floor(RATIO * 9223372036854775807));
    return v < bound;
  }

  /* one request: its spans (nested as the agent nests them), headers and log lines */
  function trace(cfg, seq) {
    var id = ids(seq), d = function (t) { return cfg.target === t ? cfg.delay : 0; };
    var sel = MS.select + d("select");
    var prDur = MS.prPre + d("product-service") + sel + MS.prPost;
    var orPre = MS.orPre + d("order-service");
    var orDur = orPre + MS.validate + prDur + MS.insert + MS.orPost;
    var gwPre = MS.gwPre + d("gateway-service");
    var gwDur = gwPre + orDur + MS.gwPost;
    var smp = sampled(id.trace, cfg), flags = smp ? "01" : "00";

    var spans = [];
    function span(o) { o.exported = false; spans.push(o); return o; }
    var gw = span({ key: "gw", id: id.gw, parent: null, service: "gateway-service", op: "POST /orders", start: 0, dur: gwDur,
      tags: { "http.method": "POST", "http.url": "http://localhost:8080/orders", "http.status_code": 200 } });
    var or = span({ key: "or", id: id.or, parent: gw.id, service: "order-service", op: "POST /orders", start: gwPre, dur: orDur,
      tags: { "http.method": "POST", "http.url": "http://order:8080/orders", "http.status_code": 200 } });
    var va = null;
    if (cfg.custom !== "off") va = span({ key: "va", id: id.va, parent: or.id, service: "order-service", op: "validateOrder", manual: true, ended: cfg.custom === "on",
      start: gwPre + orPre, dur: MS.validate + prDur, tags: { "order.account_id": REQ.accountId, "order.product_id": REQ.productId } });
    var caller = va || or;
    var pr = span({ key: "pr", id: id.pr, parent: caller.id, service: "product-service", op: "GET /products/{id}", start: gwPre + orPre + MS.validate, dur: prDur,
      tags: { "http.method": "GET", "http.url": "http://product:8080/products/" + REQ.productId, "http.status_code": 200 } });
    var sq = span({ key: "sq", id: id.sq, parent: pr.id, service: "product-service", op: "SELECT products", start: pr.start + MS.prPre + d("product-service"), dur: sel,
      tags: { "db.system": "postgresql", "db.statement": "SELECT * FROM products WHERE id = ?", "net.peer.name": "db" } });
    var ins = span({ key: "ins", id: id.ins, parent: or.id, service: "order-service", op: "INSERT orders", start: pr.start + prDur, dur: MS.insert,
      tags: { "db.system": "postgresql", "db.statement": "INSERT INTO orders (account_id, product_id, quantity) VALUES (?, ?, ?)", "net.peer.name": "db" } });

    spans.forEach(function (s) {
      s.why = !smp ? "sampled" : cfg.localhost === s.service ? "localhost" : s.manual && !s.ended ? "end" : "";
      s.exported = !s.why;
    });
    var byId = {};
    spans.forEach(function (s) { byId[s.id] = s; });
    spans.forEach(function (s) {
      s.depth = s.parent ? byId[s.parent].depth + 1 : 0;
      s.orphan = s.exported && !!s.parent && !byId[s.parent].exported;
      /* Jaeger's self time: the span minus the children it received */
      var kids = spans.filter(function (k) { return k.parent === s.id && k.exported; });
      s.self = s.dur - kids.reduce(function (a, k) { return a + k.dur; }, 0);
    });
    var order = ["gw", "or", "va", "pr", "sq", "ins"];
    spans.sort(function (a, b) { return order.indexOf(a.key) - order.indexOf(b.key); });

    var headers = [
      { from: "curl", to: "gateway-service", value: null },
      { from: "gateway-service", to: "order-service", value: "00-" + id.trace + "-" + gw.id + "-" + flags },
      { from: caller === va ? "order-service (validateOrder)" : "order-service", to: "product-service", value: "00-" + id.trace + "-" + caller.id + "-" + flags }
    ];
    var t0 = CLOCK + (seq - 1) * 1000;
    function line(t, svc, cls, spanId, msg) {
      return { svc: svc, span: spanId, trace: id.trace, text: clock(t0 + t) + " [http-nio-8080-exec-3] INFO  c.example." + cls + "\n    [trace_id=" + id.trace + " span_id=" + spanId + "] - " + msg };
    }
    var logs = [
      line(or.start, "order-service", "order.OrderService", or.id, "creating order for account " + REQ.accountId),
      line(pr.start, "order-service", "order.OrderService", caller.id, "calling ProductService for product id " + REQ.productId),
      line(sq.start, "product-service", "product.ProductService", pr.id, "loading product " + REQ.productId)
    ];
    var shown = spans.filter(function (s) { return s.exported; });
    var hot = shown.slice().sort(function (a, b) { return b.self - a.self; })[0] || null;
    return { seq: seq, traceId: id.trace, sampled: smp, flags: flags, total: gwDur, spans: spans, headers: headers, logs: logs,
      inJaeger: shown.length, hot: hot, hotShare: hot ? Math.round(100 * hot.self / gwDur) : 0, span: function (k) { return spans.filter(function (s) { return s.key === k; })[0]; } };
  }
  function clock(ms) {
    function p(n, w) { return ("00" + n).slice(-w); }
    return p(Math.floor(ms / 3600000) % 24, 2) + ":" + p(Math.floor(ms / 60000) % 60, 2) + ":" + p(Math.floor(ms / 1000) % 60, 2) + "." + p(ms % 1000, 3);
  }

  /* the state of a run: the knobs, the request on screen, and how many requests Jaeger kept */
  function create() { var st = { cfg: defaults(), seq: 1, sent: 1, kept: 0 }; st.kept = sampled(ids(1).trace, st.cfg) ? 1 : 0; return st; }
  /* a new sampler starts a new count of kept traces */
  function set(st, patch) {
    if (patch.sampler && patch.sampler !== st.cfg.sampler) { st.sent = 0; st.kept = 0; }
    Object.keys(patch).forEach(function (k) { st.cfg[k] = patch[k]; });
    return st;
  }
  function send(st, n) {
    for (var i = 0; i < (n || 1); i++) { st.seq++; st.sent++; if (sampled(ids(st.seq).trace, st.cfg)) st.kept++; }
    return st;
  }
  /* how many of n new requests (after seq) a sampler keeps */
  function batch(cfg, from, n) { var k = 0; for (var i = 1; i <= n; i++) if (sampled(ids(from + i).trace, cfg)) k++; return k; }

  /* the page, step by step */
  var SCRIPTS = {
    lab: [
      { set: { target: "select", delay: SLOW }, en: "The page's slow query: 2 160 ms more in SELECT products. The trace takes 2 340 ms and the SELECT alone 2 180 ms, 93% of it.",
        pt: "A consulta lenta da página: 2 160 ms a mais em SELECT products. O trace leva 2 340 ms e o SELECT sozinho 2 180 ms, 93% dele." },
      { set: { target: "product-service" }, en: "The same delay in product-service's own code: its span grows to 2 190 ms, the SELECT stays at 20 ms. The widest span is always the root: look for the largest self time.",
        pt: "O mesmo atraso no código do próprio product-service: o span dele cresce para 2 190 ms, o SELECT fica em 20 ms. O span mais largo é sempre a raiz: procure o maior tempo próprio." },
      { set: { target: "select" }, en: "Back to the slow query. Every hop carries traceparent: the trace id never changes, the parent id is the caller's span (00f067aa0ba902b7 is order-service's). The log lines carry the same trace_id.",
        pt: "De volta à consulta lenta. Cada salto leva o traceparent: o trace id nunca muda, o parent id é o span de quem chama (00f067aa0ba902b7 é o do order-service). As linhas de log levam o mesmo trace_id." },
      { set: { custom: "on" }, en: "Add the validateOrder span: product-service becomes its child, and the header sent to product-service now carries validateOrder's span id.",
        pt: "Adicione o span validateOrder: o product-service vira filho dele e o cabeçalho enviado ao product-service agora leva o span id do validateOrder." },
      { set: { custom: "noend" }, en: "Forget span.end(): validateOrder is never exported. Jaeger shows product-service under a parent it never received.",
        pt: "Esqueça o span.end(): o validateOrder nunca é exportado. O Jaeger mostra o product-service sob um pai que nunca recebeu." },
      { set: { custom: "off", localhost: "product-service" }, en: "product-service exports to http://localhost:4317: its two spans never reach Jaeger, and order-service seems slow by itself, 2 225 ms of self time.",
        pt: "O product-service exporta para http://localhost:4317: seus dois spans nunca chegam ao Jaeger e o order-service parece lento sozinho, 2 225 ms de tempo próprio." },
      { set: { localhost: "none", sampler: "ratio" }, send: 100, en: "parentbased_traceidratio with 0.1, then 100 requests: Jaeger keeps 6 traces, about 10%. A dropped request still logs its trace_id, with flags 00 in traceparent.",
        pt: "parentbased_traceidratio com 0.1 e depois 100 requisições: o Jaeger guarda 6 traces, cerca de 10%. Uma requisição descartada ainda registra seu trace_id no log, com flags 00 no traceparent." }
    ]
  };
  function step(st, s) { set(st, s.set || {}); if (s.send) send(st, s.send); return st; }
  function play(name, n) {
    var st = create();
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (s) { step(st, s); });
    return st;
  }
  function fmtMs(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ms"; }

  var API = { SERVICES: SERVICES, TRACE_ID: TRACE_ID, ORDER_SPAN: ORDER_SPAN, ENDPOINT: ENDPOINT, RATIO: RATIO, SLOW: SLOW, MS: MS, REQ: REQ, SCRIPTS: SCRIPTS,
    defaults: defaults, ids: ids, sampled: sampled, trace: trace, create: create, set: set, send: send, batch: batch, play: play, fmtMs: fmtMs };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var W = 640, LX = 214, BX = 222, BW = 330, ROW = 24, TOP = 24;
  var CAT = { "gateway-service": 0, "order-service": 5, "product-service": 6 };
  var WHY = {
    sampled: ["not sampled: flags 00", "não amostrado: flags 00"],
    localhost: ["sent to localhost:4317, lost", "enviado a localhost:4317, perdido"],
    end: ["end() never called, not exported", "end() nunca chamado, não exportado"]
  };

  C.style("otel-trace", [
    ".md-typeset .csim .csim-ot-bar { fill: color-mix(in srgb, var(--cat) 22%, var(--c-bg)); stroke: var(--cat); stroke-width: 1; }",
    ".md-typeset .csim .csim-ot-bar.ghost { fill: none; stroke: var(--c-fg3); stroke-dasharray: 4 3; }",
    ".md-typeset .csim .csim-ot-bar.hot { stroke: var(--c-bad); stroke-width: 2.2; }",
    ".md-typeset .csim .csim-ot-self { fill: var(--cat); }",
    ".md-typeset .csim .csim-ot-row { fill: transparent; cursor: pointer; }",
    ".md-typeset .csim .csim-ot-row:hover, .md-typeset .csim .csim-ot-row.sel { fill: var(--c-tint); }",
    ".md-typeset .csim .csim-ot-tick { stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim svg tspan.csim-ot-op { font-weight: 400; }",
    ".md-typeset .csim-log.csim-ot-term { max-height: none; }",
    ".md-typeset .csim-log.csim-ot-term li { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .56rem; }",
    ".md-typeset .csim-log.csim-ot-term li:first-child { background: none; }",
    ".md-typeset .csim-ot-h { font-weight: 600; margin: .4rem 0 0; font-size: .64rem; }"
  ].join("\n"));

  C.register("otel-trace", function (root) {
    var o = C.opts(root, { script: "lab" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, tr, sel = null;
    function L(pair) { return C.PT ? pair[1] : pair[0]; }

    var svg = s("svg", { viewBox: "0 0 " + W + " 178", role: "img", "aria-label": t("Jaeger waterfall of one trace", "Cascata do Jaeger de um trace") });
    var note = el("p", { class: "csim-note" });
    var heads = el("ol", { class: "csim-log csim-ot-term" }), logs = el("ol", { class: "csim-log csim-ot-term" });
    var tiles = C.stats([
      { key: "dur", label: t("trace duration", "duração do trace") },
      { key: "spans", label: t("spans in Jaeger", "spans no Jaeger") },
      { key: "self", label: t("largest self time", "maior tempo próprio") },
      { key: "kept", label: t("traces kept / requests", "traces guardados / requisições") }
    ]);
    function say(text, tone) { note.textContent = text || ""; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function knob(fn) { return function () { player.pause(); fn(); sel = null; draw(); explain(); }; }
    var cTarget = C.choice({ label: t("Delay in", "Atraso em"), value: "none", options: [
      { value: "none", label: t("none", "nenhum") }, { value: "gateway-service", label: "gateway" }, { value: "order-service", label: "order" },
      { value: "product-service", label: "product" }, { value: "select", label: "SELECT" }
    ], onChange: knob(function () { st.cfg.target = cTarget.get(); }) });
    var sDelay = C.slider({ label: "+", min: 0, max: 3000, step: 20, value: SLOW, fmt: function (v) { return v + " ms"; },
      onInput: function (v) { st.cfg.delay = v; draw(); explain(); } });
    var cCustom = C.choice({ label: "validateOrder", value: "off", options: [
      { value: "off", label: t("no span", "sem span") }, { value: "on", label: t("with end()", "com end()") }, { value: "noend", label: t("without end()", "sem end()") }
    ], onChange: knob(function () { st.cfg.custom = cCustom.get(); }) });
    var cLocal = C.choice({ label: t("Endpoint localhost:4317 in", "Endpoint localhost:4317 em"), value: "none", options: [
      { value: "none", label: t("none", "nenhum") }, { value: "gateway-service", label: "gateway" }, { value: "order-service", label: "order" }, { value: "product-service", label: "product" }
    ], onChange: knob(function () { st.cfg.localhost = cLocal.get(); }) });
    var cSampler = C.choice({ label: "OTEL_TRACES_SAMPLER", value: "always_on", options: [
      { value: "always_on", label: t("default (100%)", "padrão (100%)") }, { value: "ratio", label: "parentbased_traceidratio 0.1" }
    ], onChange: knob(function () { set(st, { sampler: cSampler.get() }); }) });
    var bSend = C.button("curl POST /orders", function () { player.pause(); send(st, 1); sel = null; draw(); explain(); }, { tone: "ok" });
    var bMany = C.button(t("100 requests", "100 requisições"), function () { player.pause(); send(st, 100); sel = null; draw(); explain(); });

    var player = C.player({ interval: 2600, onTick: function (k) { return tick(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });

    function sync() {
      cTarget.set(st.cfg.target); sDelay.set(st.cfg.delay); cCustom.set(st.cfg.custom); cLocal.set(st.cfg.localhost); cSampler.set(st.cfg.sampler);
    }
    function tick(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      step(st, sc[k - 1]); sel = null; sync(); draw();
      say(L([sc[k - 1].en, sc[k - 1].pt]), tr.inJaeger < tr.spans.length ? "warn" : "");
    }
    function replay(k) { st = create(); for (var i = 1; i <= k; i++) step(st, SCRIPTS[script][i - 1]); sync(); draw(); if (k) say(L([SCRIPTS[script][k - 1].en, SCRIPTS[script][k - 1].pt])); else intro(); }
    function intro() {
      say(script === "free"
        ? t("The page's curl has run once. Change a knob and watch which span grows; click a span to see its tags.", "O curl da página já rodou uma vez. Mude um controle e veja qual span cresce; clique num span para ver suas tags.")
        : t("The page's curl has run once: 5 spans, 180 ms, all with trace id 4bf92f35…4736. Press play or → to replay the page; the knobs work at any time.",
            "O curl da página já rodou uma vez: 5 spans, 180 ms, todos com o trace id 4bf92f35…4736. Aperte play ou → para repetir a página; os controles funcionam a qualquer momento."), "");
    }
    function reset() {
      st = create(); sel = null; sync();
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      draw(); intro();
    }
    function explain() {
      if (!tr.sampled) return say(t("Request " + tr.seq + " was not sampled: flags 00, no span reaches Jaeger. Its log lines still carry trace_id " + tr.traceId + ".",
        "A requisição " + tr.seq + " não foi amostrada: flags 00, nenhum span chega ao Jaeger. Suas linhas de log ainda levam o trace_id " + tr.traceId + "."), "warn");
      var lost = tr.spans.filter(function (x) { return !x.exported; });
      if (lost.length) return say(t(lost.length + " span(s) missing in Jaeger: " + lost.map(function (x) { return x.op; }).join(", ") + ". The largest self time is now " + tr.hot.service + " " + tr.hot.op + ", " + fmtMs(tr.hot.self) + ".",
        lost.length + " span(s) faltando no Jaeger: " + lost.map(function (x) { return x.op; }).join(", ") + ". O maior tempo próprio agora é " + tr.hot.service + " " + tr.hot.op + ", " + fmtMs(tr.hot.self) + "."), "warn");
      say(t("Total " + fmtMs(tr.total) + "; the largest self time is " + tr.hot.service + " " + tr.hot.op + ", " + fmtMs(tr.hot.self) + " (" + tr.hotShare + "%).",
        "Total " + fmtMs(tr.total) + "; o maior tempo próprio é " + tr.hot.service + " " + tr.hot.op + ", " + fmtMs(tr.hot.self) + " (" + tr.hotShare + "%)."), "");
    }

    function draw() {
      tr = trace(st.cfg, st.seq);
      C.clear(svg);
      var k = BW / tr.total;
      /* axis */
      [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
        var x = BX + f * BW;
        svg.appendChild(s("line", { x1: x, x2: x, y1: TOP - 6, y2: TOP + tr.spans.length * ROW, class: "csim-ot-tick" }));
        svg.appendChild(s("text", { x: x, y: TOP - 10, "text-anchor": "middle", class: "c-small" }, fmtMs(Math.round(f * tr.total))));
      });
      svg.appendChild(s("text", { x: 4, y: TOP - 10, class: "c-small c-mono" }, "trace " + tr.traceId.slice(0, 8) + "…" + tr.traceId.slice(-4) + " · flags " + tr.flags));
      tr.spans.forEach(function (x, i) {
        var y = TOP + i * ROW, cat = "cat-" + CAT[x.service];
        var g = s("g", { class: cat });
        g.appendChild(s("rect", { x: 0, y: y, width: W, height: ROW, class: "csim-ot-row" + (sel === x.key ? " sel" : ""), onclick: function () { sel = x.key; draw(); detail(x); } }));
        var label = s("text", { x: 4 + x.depth * 12, y: y + 15, class: "c-label" + (x.exported ? "" : " c-bad") }, [x.service.replace("-service", ""), s("tspan", { class: "csim-ot-op" }, " " + x.op)]);
        label.style.pointerEvents = "none";
        g.appendChild(label);
        var bx = BX + x.start * k, bw = Math.max(2, x.dur * k);
        g.appendChild(s("rect", { x: bx, y: y + 5, width: bw, height: ROW - 10, rx: 2, class: "csim-ot-bar" + (x.exported ? "" : " ghost") + (tr.hot === x ? " hot" : ""), "pointer-events": "none" }));
        if (x.exported) {
          /* the self time: the bar minus the children Jaeger has */
          var kids = tr.spans.filter(function (c) { return c.parent === x.id && c.exported; }).sort(function (a, b) { return a.start - b.start; });
          var cur = x.start;
          kids.concat([{ start: x.start + x.dur, dur: 0 }]).forEach(function (c) {
            if (c.start > cur) g.appendChild(s("rect", { x: BX + cur * k, y: y + 9, width: Math.max(1, (c.start - cur) * k), height: ROW - 18, class: "csim-ot-self", "pointer-events": "none" }));
            cur = Math.max(cur, c.start + c.dur);
          });
        }
        var txt = x.exported ? fmtMs(x.dur) + (x.orphan ? t(" · parent missing", " · pai ausente") : "") : L(WHY[x.why]);
        /* after the bar if it fits, else before it, else inside it */
        var tx = bx + bw + 4, anchor = "start", wide = txt.length * 5.2;
        if (tx + wide > W) { tx = bx - 4; anchor = "end"; }
        if (anchor === "end" && tx - wide < LX) { tx = bx + 6; anchor = "start"; }
        g.appendChild(s("text", { x: tx, y: y + 15, "text-anchor": anchor, class: "c-small" + (!x.exported ? " c-bad" : x.orphan ? " c-warn" : ""), "pointer-events": "none" }, txt));
        svg.appendChild(g);
      });
      svg.setAttribute("viewBox", "0 0 " + W + " " + (TOP + tr.spans.length * ROW + 4));
      C.clear(heads);
      tr.headers.forEach(function (h) { heads.appendChild(el("li", { class: h.value ? (tr.sampled ? "csim-ok" : "csim-warn") : "" }, h.from + " → " + h.to + "\n  " + (h.value ? "traceparent: " + h.value : t("(no traceparent: the gateway starts the trace)", "(sem traceparent: o gateway começa o trace)")))); });
      C.clear(logs);
      tr.logs.forEach(function (l) { logs.appendChild(el("li", { class: tr.sampled ? "" : "csim-warn" }, l.text)); });
      tiles.set("dur", fmtMs(tr.total), tr.total > 1000 ? "warn" : "");
      tiles.set("spans", tr.inJaeger + " / " + tr.spans.length, tr.inJaeger < tr.spans.length ? "warn" : "ok");
      tiles.set("self", tr.hot ? tr.hot.op + " · " + tr.hotShare + "%" : "–", tr.hot && tr.hotShare > 50 ? "bad" : "");
      tiles.set("kept", st.kept + " / " + st.sent, st.kept < st.sent ? "warn" : "");
    }
    function detail(x) {
      var tags = Object.keys(x.tags).map(function (k2) { return k2 + "=" + x.tags[k2]; }).join(" · ");
      say(x.service + " · " + x.op + " — span " + x.id + (x.parent ? ", parent " + x.parent : t(", root", ", raiz")) + " · " + fmtMs(x.dur) +
        (x.exported ? t(", self ", ", próprio ") + fmtMs(x.self) : " · " + L(WHY[x.why])) + " · " + tags, x.exported ? "" : "warn");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's trace, without Docker: one POST /orders through gateway, order and product",
        "O trace do lab, sem Docker: um POST /orders pelo gateway, order e product") }),
      el("p", { class: "csim-sub", text: t("One bar per span, as in Jaeger: the width is the duration, the dark part is the span's own time. Dashed bars are spans that never reached Jaeger.",
        "Uma barra por span, como no Jaeger: a largura é a duração, a parte escura é o tempo próprio do span. Barras tracejadas são spans que nunca chegaram ao Jaeger.") }),
      el("div", { class: "csim-row" }, [cTarget, sDelay]),
      el("div", { class: "csim-row" }, [cCustom, cLocal]),
      el("div", { class: "csim-row" }, [cSampler, bSend, bMany]),
      el("div", { class: "csim-stage" }, svg),
      note,
      player,
      el("div", { class: "csim-cols" }, [
        el("div", {}, [tiles, el("p", { class: "csim-ot-h", text: t("Headers on the wire", "Cabeçalhos na rede") }), heads]),
        el("div", {}, [el("p", { class: "csim-ot-h", text: t("Log lines (logback-spring.xml)", "Linhas de log (logback-spring.xml)") }), logs])
      ])
    ]);
    reset();
    return {};
  });
})();
