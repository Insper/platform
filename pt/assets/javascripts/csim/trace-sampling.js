/*
 * Head and tail sampling, and where the Collector runs (2027.1, class Observability — OpenTelemetry):
 *
 *   <div class="csim" data-sim="trace-sampling" data-head="1" data-tail="on" data-collectors="one"></div>
 *
 * The page's busy day: 2,000 requests/s, 8 spans of 500 bytes per request, 1% of the requests fail and
 * 2% are slower than the 2 s threshold. Each request is a trace with the spans of the page's waterfall
 * (gateway, order, inventory, postgres, payment, pool.acquire, provider call, Kafka publish). On a
 * failed request the error path (gateway, order, payment) has status ERROR; on a slow one the time is
 * in payment's pool.acquire.
 *
 *   head      the SDK's parent-based ratio: decided once at the root, from the trace id; a trace dropped
 *             here sends no span at all, so the tail can never rescue it.
 *   tail      the Collector's tail_sampling of the page: keep-errors (any ERROR span), keep-slow
 *             (latency ≥ 2 000 ms, measured from the spans it holds), 5% of the rest (a hash of the
 *             trace id, so every Collector agrees).
 *   collectors one gateway Collector; three behind a round-robin load balancer (each span goes to any
 *             of them); three behind the loadbalancing exporter (every span of a trace to the same one).
 *             Each Collector decides on the spans it holds: with round robin, a decision on a fragment.
 *
 * A trace is stored whole, in fragments (some of its spans dropped) or not at all. The statistics run
 * over 100,000 traces, deterministic (low-discrepancy sequences for the decisions, a seeded generator
 * for the round robin), so the tip's numbers are reproducible.
 */
(function () {
  "use strict";

  var RPS = 2000, SPANS = 8, SPAN_BYTES = 500, DAY = 86400, ERR = 0.01, SLOW = 0.02, REST = 0.05, SLOW_MS = 2000;
  var N = 100000;
  var NAMES = ["gateway", "order", "inventory", "postgres", "payment", "pool.acquire", "provider", "kafka"];
  /* span start/end as fractions of the trace duration (the page's waterfall) */
  var SHAPE = [[0, 1], [0.005, 0.995], [0.01, 0.02], [0.012, 0.015], [0.02, 0.98], [0.025, 0.89], [0.89, 0.975], [0.985, 0.99]];
  var ERROR_PATH = [0, 1, 4];

  function defaults() { return { head: 1, tail: "on", collectors: "one" }; }

  function frac(x) { return x - Math.floor(x); }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* trace k: kind, duration (ms), the two hashes of its id */
  function trace(k) {
    var m = k % 100, kind = m === 37 ? "error" : (m === 11 || m === 73) ? "slow" : "ok";
    var d = kind === "slow" ? 2500 + 6620 * frac(k * 0.4142135623) : 60 + 340 * frac(k * 0.7320508075);
    if (kind === "error") d = 300 + 900 * frac(k * 0.4142135623);
    return { k: k, kind: kind, ms: d, uHead: frac(k * 0.6180339887 + 0.5), uRest: frac(k * 0.7548776662 + 0.25) };
  }

  /* decide one trace: returns per-span "stored" | "head" | "tail" and the collector of each span */
  function decide(tr, cfg, r) {
    var spans = [], coll = [];
    if (tr.uHead >= cfg.head) {
      for (var j = 0; j < SPANS; j++) { spans.push("head"); coll.push(-1); }
      return { spans: spans, coll: coll, outcome: "dropped" };
    }
    var target = cfg.collectors === "rr3" ? null : cfg.collectors === "lb3" ? tr.k % 3 : 0;
    for (var i = 0; i < SPANS; i++) coll.push(target === null ? Math.floor(r() * 3) : target);
    if (cfg.tail !== "on") {
      for (var a = 0; a < SPANS; a++) spans.push("stored");
      return { spans: spans, coll: coll, outcome: "whole" };
    }
    var keep = {};
    [0, 1, 2].forEach(function (c) {
      var held = [];
      for (var j = 0; j < SPANS; j++) if (coll[j] === c) held.push(j);
      if (!held.length) return;
      var err = tr.kind === "error" && held.some(function (j) { return ERROR_PATH.indexOf(j) >= 0; });
      var lo = 1, hi = 0;
      held.forEach(function (j) { lo = Math.min(lo, SHAPE[j][0]); hi = Math.max(hi, SHAPE[j][1]); });
      var slow = (hi - lo) * tr.ms >= SLOW_MS;
      keep[c] = err || slow || tr.uRest < REST;
    });
    var n = 0;
    for (var s = 0; s < SPANS; s++) { var kept = !!keep[coll[s]]; spans.push(kept ? "stored" : "tail"); if (kept) n++; }
    return { spans: spans, coll: coll, outcome: n === SPANS ? "whole" : n ? "fragments" : "dropped" };
  }

  /* statistics over N traces */
  function stats(cfg) {
    cfg = Object.assign(defaults(), cfg || {});
    var r = rng(4317), stored = 0, by = { error: z(), slow: z(), ok: z() }, whole = 0, frag = 0;
    function z() { return { n: 0, whole: 0, fragments: 0, dropped: 0 }; }
    for (var k = 0; k < N; k++) {
      var tr = trace(k), d = decide(tr, cfg, r);
      d.spans.forEach(function (x) { if (x === "stored") stored++; });
      by[tr.kind].n++; by[tr.kind][d.outcome]++;
      if (d.outcome === "whole") whole++; else if (d.outcome === "fragments") frag++;
    }
    var all = RPS * SPANS * SPAN_BYTES * DAY / 1e9;
    return { cfg: cfg, gbDay: all * stored / (N * SPANS), allGb: all, kept: (whole + frag) / N, whole: whole / N, fragments: frag / N, fragStored: whole + frag ? frag / (whole + frag) : 0,
      errors: share(by.error), slow: share(by.slow), errorsPerDay: RPS * ERR * DAY };
    function share(b) { return { whole: b.whole / b.n, fragments: b.fragments / b.n, dropped: b.dropped / b.n, n: b.n }; }
  }

  var API = { stats: stats, trace: trace, decide: decide, defaults: defaults, rng: rng, N: N, RPS: RPS, SPANS: SPANS, ERR: ERR, SLOW: SLOW, REST: REST, NAMES: NAMES };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el;
  var SHOW = 12;

  function dec(v, d) { var x = v.toFixed(d); return C.PT ? x.replace(".", ",") : x; }
  function pct(v) { return dec(100 * v, v > 0 && v < 0.1 ? 1 : 0) + "%"; }
  function gb(v) { return (v >= 100 ? Math.round(v).toLocaleString(C.PT ? "pt-BR" : "en") : dec(v, 1)) + " GB"; }

  C.style("trace-sampling", [
    ".md-typeset .csim-ts { display: grid; grid-template-columns: 5.2em 3.6em repeat(" + SPANS + ", 1fr) 6.4em; gap: 3px; align-items: center; font-size: .68rem; }",
    ".md-typeset .csim-ts .h { color: var(--c-fg3); font-size: .6rem; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".md-typeset .csim-ts .id { font-family: var(--md-code-font-family); color: var(--c-fg2); }",
    ".md-typeset .csim-ts .kind { text-align: center; border-radius: 3px; padding: 0 .2em; }",
    ".md-typeset .csim-ts .kind.error { color: var(--c-bad); border: 1px solid var(--c-bad); }",
    ".md-typeset .csim-ts .kind.slow { color: var(--c-warn); border: 1px solid var(--c-warn); }",
    ".md-typeset .csim-ts .kind.ok { color: var(--c-fg3); border: 1px solid var(--c-line); }",
    ".md-typeset .csim-ts .sp { height: 16px; border-radius: 3px; font-size: .58rem; line-height: 16px; text-align: center; color: var(--c-fg2); }",
    ".md-typeset .csim-ts .sp.stored { background: color-mix(in srgb, var(--c-ok) 45%, var(--c-bg)); color: var(--c-fg); }",
    ".md-typeset .csim-ts .sp.tail { background: color-mix(in srgb, var(--c-bad) 18%, var(--c-bg)); border: 1px dashed var(--c-bad); }",
    ".md-typeset .csim-ts .sp.head { background: var(--c-panel); border: 1px dashed var(--c-line); }",
    ".md-typeset .csim-ts .sp.err { box-shadow: inset 0 -3px 0 var(--c-bad); }",
    ".md-typeset .csim-ts .out { font-size: .64rem; white-space: nowrap; }",
    ".md-typeset .csim-ts .out.whole { color: var(--c-ok); } .md-typeset .csim-ts .out.fragments { color: var(--c-warn); } .md-typeset .csim-ts .out.dropped { color: var(--c-fg3); }"
  ].join("\n"));

  C.register("trace-sampling", function (root) {
    var o = C.opts(root, defaults());
    var cfg = { head: o.head, tail: o.tail, collectors: o.collectors }, k0 = 0, rr = rng(99), shown = [], res;
    var grid = el("div", { class: "csim-ts" });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "gb", label: t("spans stored per day", "spans guardados por dia") },
      { key: "err", label: t("error traces kept whole", "traces de erro inteiros") },
      { key: "slow", label: t("slow traces kept whole", "traces lentos inteiros") },
      { key: "frag", label: t("stored traces with holes", "traces guardados com buracos") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function draw() {
      C.clear(grid);
      grid.appendChild(el("span", { class: "h", text: "trace" }));
      grid.appendChild(el("span", { class: "h" }));
      NAMES.forEach(function (n) { grid.appendChild(el("span", { class: "h", text: n, title: n })); });
      grid.appendChild(el("span", { class: "h", text: t("stored", "guardado") }));
      shown.forEach(function (x) {
        grid.appendChild(el("span", { class: "id", text: ("0000" + (x.tr.k * 2654435761 >>> 0).toString(16)).slice(-6) + "…" }));
        grid.appendChild(el("span", { class: "kind " + x.tr.kind, text: x.tr.kind === "error" ? t("error", "erro") : x.tr.kind === "slow" ? t("slow", "lento") : "ok" }));
        x.d.spans.forEach(function (sp, j) {
          var err = x.tr.kind === "error" && [0, 1, 4].indexOf(j) >= 0;
          grid.appendChild(el("span", { class: "sp " + sp + (err ? " err" : ""), text: cfg.collectors !== "one" && x.d.coll[j] >= 0 ? "C" + (x.d.coll[j] + 1) : "",
            title: NAMES[j] + ": " + (sp === "stored" ? t("stored", "guardado") : sp === "head" ? t("not sampled at the head", "não amostrado na cabeça") : t("dropped by the tail sampler", "descartado pela amostragem de cauda")) }));
        });
        var out = x.d.outcome;
        grid.appendChild(el("span", { class: "out " + out, text: out === "whole" ? t("✔ whole", "✔ inteiro") : out === "fragments" ? t("⚠ fragments", "⚠ em pedaços") : t("— dropped", "— descartado") }));
      });
    }
    function showStats() {
      res = stats(cfg);
      st.set("gb", gb(res.gbDay), res.gbDay > 300 ? "bad" : res.gbDay > 60 ? "warn" : "ok");
      st.set("err", pct(res.errors.whole), res.errors.whole > 0.99 ? "ok" : res.errors.whole > 0.5 ? "warn" : "bad");
      st.set("slow", pct(res.slow.whole), res.slow.whole > 0.99 ? "ok" : res.slow.whole > 0.5 ? "warn" : "bad");
      st.set("frag", pct(res.fragStored), res.fragStored > 0.001 ? "bad" : "ok");
      var errDay = Math.round(res.errorsPerDay * res.errors.whole).toLocaleString(C.PT ? "pt-BR" : "en");
      if (cfg.tail === "on" && cfg.collectors === "rr3") say(t("Three Collectors behind round robin: each one sees only some spans of a trace and decides on its fragment. Only " + pct(res.errors.whole) + " of the error traces arrive whole; " + pct(res.fragStored) + " of the stored traces have holes, exactly where the investigation needs them.",
        "Três Collectors atrás de round robin: cada um vê só alguns spans de um trace e decide sobre o seu pedaço. Só " + pct(res.errors.whole) + " dos traces de erro chegam inteiros; " + pct(res.fragStored) + " dos traces guardados têm buracos, justamente onde a investigação precisa deles."), "bad");
      else if (cfg.tail === "on" && cfg.head < 1) say(t("Head " + pct(cfg.head) + " first, tail second: the tail keeps every error it receives, but the head already dropped " + pct(1 - cfg.head) + " of them before any span left the services. " + errDay + " error traces a day survive, out of " + Math.round(res.errorsPerDay).toLocaleString(C.PT ? "pt-BR" : "en") + ".",
        "Cabeça " + pct(cfg.head) + " primeiro, cauda depois: a cauda guarda todo erro que recebe, mas a cabeça já descartou " + pct(1 - cfg.head) + " deles antes de qualquer span sair dos serviços. Sobrevivem " + errDay + " traces de erro por dia, de " + Math.round(res.errorsPerDay).toLocaleString(C.PT ? "pt-BR" : "en") + "."), "warn");
      else if (cfg.tail === "on") say(t("Tail sampling" + (cfg.collectors === "lb3" ? " with the trace id routing every span of a trace to the same Collector" : " in one gateway Collector") + ": " + gb(res.gbDay) + " a day instead of " + gb(res.allGb) + ", and every error and slow trace is kept whole. The price: 100% of the spans cross the network and wait " + "10 s in memory for the decision.",
        "Amostragem de cauda" + (cfg.collectors === "lb3" ? " com o trace id levando todos os spans de um trace ao mesmo Collector" : " num Collector gateway") + ": " + gb(res.gbDay) + " por dia em vez de " + gb(res.allGb) + ", e todo trace de erro ou lento fica inteiro. O preço: 100% dos spans cruzam a rede e esperam 10 s na memória pela decisão."), "ok");
      else if (cfg.head < 1) say(t("Head sampling alone at " + pct(cfg.head) + ": " + gb(res.gbDay) + " a day, but it is blind — it keeps " + pct(res.errors.whole) + " of the error traces, the same share as the boring ones.",
        "Só amostragem de cabeça a " + pct(cfg.head) + ": " + gb(res.gbDay) + " por dia, mas ela é cega — guarda " + pct(res.errors.whole) + " dos traces de erro, a mesma fração dos traces sem graça."), "warn");
      else say(t("Keep everything: every trace, " + gb(res.gbDay) + " a day — over 20 TB a month for one busy service.",
        "Guardar tudo: todos os traces, " + gb(res.gbDay) + " por dia — mais de 20 TB por mês para um serviço movimentado."), "");
    }
    function next() {
      var k = k0;
      /* show the interesting ones often enough: jump ahead to the next error or slow trace now and then */
      if (shown.length % 3 === 2) { while (trace(k).kind === "ok") k++; }
      var tr = trace(k), d = decide(tr, cfg, rr);
      k0 = k + 1 + Math.floor(rr() * 7);
      shown.unshift({ tr: tr, d: d });
      if (shown.length > SHOW) shown.pop();
    }
    function reset() { k0 = 0; rr = rng(99); shown = []; for (var i = 0; i < 6; i++) next(); showStats(); draw(); }
    function tick() { next(); draw(); }
    var player = C.player({ interval: 700, speeds: [1, 2, 4], onTick: tick, onReset: reset, label: function () { return t("traces arriving", "traces chegando"); } });
    function change(key) { return function (v) { cfg[key] = v; reset(); }; }
    var cH = C.choice({ label: t("head (SDK)", "cabeça (SDK)"), value: cfg.head, options: [1, 0.1, 0.01].map(function (v) { return { value: v, label: Math.round(100 * v) + "%" }; }), onChange: change("head") });
    var cT = C.choice({ label: t("tail (Collector)", "cauda (Collector)"), value: cfg.tail, options: [{ value: "off", label: t("off", "desligada") }, { value: "on", label: t("errors + slow + 5%", "erros + lentos + 5%") }], onChange: change("tail") });
    var cC = C.choice({ label: "Collectors", value: cfg.collectors, options: [
      { value: "one", label: t("1 gateway", "1 gateway") },
      { value: "rr3", label: t("3, round robin", "3, round robin") },
      { value: "lb3", label: t("3, by trace id", "3, por trace id") }], onChange: change("collectors") });

    C.add(root, [
      el("p", { class: "csim-title", text: t("Which traces survive sampling — and do they survive whole?", "Quais traces sobrevivem à amostragem — e sobrevivem inteiros?") }),
      el("p", { class: "csim-sub", text: t("2,000 req/s, 8 spans of 500 bytes, 1% errors, 2% slower than 2 s. Each row is one trace; green spans are stored, dashed ones were dropped. Numbers over 100,000 traces.",
        "2.000 req/s, 8 spans de 500 bytes, 1% de erros, 2% mais lentos que 2 s. Cada linha é um trace; spans verdes foram guardados, os tracejados foram descartados. Números sobre 100.000 traces.") }),
      el("div", { class: "csim-row" }, [cH, cT, cC]),
      st,
      el("div", { class: "csim-stage" }, grid),
      note, player
    ]);
    reset();
    return { destroy: function () { player.pause(); } };
  });
})();
