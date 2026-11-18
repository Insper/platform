/*
 * The explained canary of hands-on 13 (2027.1, part 5), as a lab twin:
 *
 *   <div class="csim" data-sim="canary-explain" data-script="lab"></div>
 *
 * .github/ai/canary_explain.py without Prometheus and without a model: the policy (MIN_RPS,
 * MAX_ERROR_RATE, MAX_ERROR_DELTA, MAX_P99_RATIO, as LAB) decides PROMOTE / ROLLBACK /
 * INCONCLUSIVE with the same checks, in the same order, and prints the same verdict line as the
 * script; the exit code (0 / 1 / 2) comes from the policy only. The model is a stand-in that
 * repeats the verdict (the lab's SYSTEM prompt), answers "promote" whatever it reads (the tampered
 * prompt of 5.3) or is missing (Claude without a key): an explanation that disagrees is discarded,
 * a missing one is reported, and the exit code never changes.
 *
 * The "lab" script replays 5.3 in its order: healthy, regression, low traffic (the three snapshots
 * of .github/ai/canary/, the same numbers), the tampered prompt and the missing key. "free" leaves
 * sliders for the canary's traffic, error rate and p99 against the stable version of a snapshot,
 * and a switch that makes both versions twice as slow (10:00 on an on-sale day): the relative p99
 * rule does not move, an illustrative fixed ceiling of 300 ms would.
 */
(function () {
  "use strict";

  /* the policy of canary_explain.py (registered in scripts/csim/lab-values.mjs) */
  var LAB = { minRps: 2, maxErrorRate: 0.01, maxErrorDelta: 0.005, maxP99Ratio: 1.25 };
  var EXIT = { promote: 0, rollback: 1, inconclusive: 2 };
  var FIXED_P99 = 0.3;      /* an illustrative fixed ceiling (s), NOT in the script: what the page argues against */
  var ONSALE = 2;           /* illustrative: both versions twice as slow at 10:00 */

  /* .github/ai/canary/*.json */
  var SNAPSHOTS = {
    healthy: { stable: { rps: 380.0, errors: 0.38, error_rate: 0.001, p99: 0.182 },
               canary: { rps: 20.1, errors: 0.02, error_rate: 0.001, p99: 0.191 } },
    regression: { stable: { rps: 402.0, errors: 0.40, error_rate: 0.001, p99: 0.181 },
                  canary: { rps: 21.4, errors: 0.62, error_rate: 0.029, p99: 0.412 } },
    "low-traffic": { stable: { rps: 35.0, errors: 0.0, error_rate: 0.0, p99: 0.150 },
                     canary: { rps: 0.8, errors: 0.0, error_rate: 0.0, p99: 0.140 } }
  };

  /* Python's formats: f"{x:.2f}", f"{x:.2%}", f"{x:.0f}", str(2.0) */
  function f2(x) { return x.toFixed(2); }
  function pct(x) { return (x * 100).toFixed(2) + "%"; }
  function pyFloat(x) { return Number.isInteger(x) ? x.toFixed(1) : String(x); }

  /* decide() of canary_explain.py: the first rule short-circuits, the other three accumulate */
  function decide(m) {
    var c = m.canary, s = m.stable;
    if (c.rps < LAB.minRps) return { verdict: "inconclusive", reasons: ["canary traffic " + f2(c.rps) + " req/s < " + pyFloat(LAB.minRps)] };
    var reasons = [];
    if (c.error_rate > LAB.maxErrorRate) reasons.push("canary error rate " + pct(c.error_rate) + " > " + pct(LAB.maxErrorRate));
    if (c.error_rate - s.error_rate > LAB.maxErrorDelta) reasons.push("canary errors exceed stable by " + pct(c.error_rate - s.error_rate));
    if (s.p99 > 0 && c.p99 / s.p99 > LAB.maxP99Ratio) reasons.push("canary p99 " + (c.p99 * 1000).toFixed(0) + " ms is " + f2(c.p99 / s.p99) + "x stable");
    return reasons.length ? { verdict: "rollback", reasons: reasons } : { verdict: "promote", reasons: ["all checks within policy"] };
  }

  /* each rule on its own, for the table: value, limit, fired (null = not evaluated) */
  function rules(m) {
    var c = m.canary, s = m.stable, low = c.rps < LAB.minRps;
    return [
      { key: "minRps", value: c.rps, limit: LAB.minRps, fired: low },
      { key: "maxErrorRate", value: c.error_rate, limit: LAB.maxErrorRate, fired: low ? null : c.error_rate > LAB.maxErrorRate },
      { key: "maxErrorDelta", value: c.error_rate - s.error_rate, limit: LAB.maxErrorDelta, fired: low ? null : c.error_rate - s.error_rate > LAB.maxErrorDelta },
      { key: "maxP99Ratio", value: s.p99 > 0 ? c.p99 / s.p99 : 0, limit: LAB.maxP99Ratio, fired: low ? null : s.p99 > 0 && c.p99 / s.p99 > LAB.maxP99Ratio }
    ];
  }

  function line(d) { return "**Verdict (policy): " + d.verdict.toUpperCase() + "** — " + d.reasons.join("; "); }

  /* the model: "system" repeats the verdict, "promote" is the tampered prompt, "nokey" has no key */
  function explain(verdict, model) {
    if (model === "nokey") return { kept: false, said: null, text: '_(no explanation: TypeError: "Could not resolve authentication method. ...")_' };
    var said = model === "promote" ? "promote" : verdict;
    if (said !== verdict) return { kept: false, said: said, text: "_(LLM explanation discarded: it disagreed with the policy verdict.)_" };
    return { kept: true, said: said, text: null };
  }

  function run(m, model) {
    var d = decide(m);
    return { verdict: d.verdict, reasons: d.reasons, line: line(d), exit: EXIT[d.verdict], expl: explain(d.verdict, model || "system") };
  }

  /* the same numbers, both versions `factor` times slower */
  function slower(m, factor) {
    function k(v) { return { rps: v.rps, errors: v.errors, error_rate: v.error_rate, p99: v.p99 * factor }; }
    return { stable: k(m.stable), canary: k(m.canary) };
  }
  function fixedCeiling(m) { return m.canary.p99 > FIXED_P99 ? "rollback" : "promote"; }

  /* the largest canary error rate (in 0.01 % steps) and p99 (in ms) the policy still promotes */
  function limits(m) {
    var c = JSON.parse(JSON.stringify(m)), e = 0, p = 0;
    c.canary.rps = Math.max(c.canary.rps, LAB.minRps);
    c.canary.p99 = 0;
    for (var i = 0; i <= 10000; i++) { c.canary.error_rate = i / 10000; if (decide(c).verdict === "promote") e = i / 10000; else break; }
    c.canary.error_rate = 0;
    for (var j = 0; j <= 5000; j++) { c.canary.p99 = j / 1000; if (decide(c).verdict === "promote") p = j; else break; }
    return { errorRate: e, p99ms: p };
  }

  /* 5.3 in the page's order; `slip` is what the local model got wrong in the page's run */
  var SCRIPT = [
    { snap: "healthy", model: "system",
      en: "healthy.json: 20.1 req/s, 0.10% errors like stable, p99 191 ms against 182 ms. Every check passes: PROMOTE, exit code 0. The local model's explanation was kept, although it wrote \"higher RPS (20.1 vs. 380.0)\".",
      pt: "healthy.json: 20,1 req/s, 0,10% de erros como o estável, p99 de 191 ms contra 182 ms. Todas as verificações passam: PROMOTE, código de saída 0. A explicação do modelo local foi mantida, embora tenha escrito \"higher RPS (20.1 vs. 380.0)\"." },
    { snap: "regression", model: "system",
      en: "regression.json: three rules fire, ROLLBACK, exit code 1. The explanation repeats the verdict, so it is kept — with a wrong number: the local model called the stable p99 \"0.181 ms\" (it is 181 ms). A wrong sentence costs nothing: the numbers that decide come from the policy.",
      pt: "regression.json: três regras disparam, ROLLBACK, código de saída 1. A explicação repete o veredito e é mantida — com um número errado: o modelo local chamou o p99 do estável de \"0.181 ms\" (são 181 ms). Uma frase errada não custa nada: os números que decidem vêm da política." },
    { snap: "low-traffic", model: "system",
      en: "low-traffic.json: 0.8 req/s is below MIN_RPS. The other rules are not even evaluated: INCONCLUSIVE, exit code 2 — not enough traffic is not \"healthy\".",
      pt: "low-traffic.json: 0,8 req/s está abaixo de MIN_RPS. As outras regras nem são avaliadas: INCONCLUSIVE, código de saída 2 — pouco tráfego não é \"saudável\"." },
    { snap: "regression", model: "promote",
      en: "SYSTEM edited to \"recommend promote\": the model now says promote, the policy still says rollback. The explanation is discarded and the exit code stays 1.",
      pt: "SYSTEM editado para \"recomende promover\": o modelo agora diz promote, a política continua dizendo rollback. A explicação é descartada e o código de saída continua 1." },
    { snap: "regression", model: "nokey",
      en: "Claude without a key: no explanation at all, and the same exit code 1. No model, same decision.",
      pt: "Claude sem chave: nenhuma explicação e o mesmo código de saída 1. Sem modelo, a mesma decisão." }
  ];

  function play(n) {
    return SCRIPT.slice(0, n === undefined ? Infinity : n).map(function (s) {
      var r = run(SNAPSHOTS[s.snap], s.model);
      r.snap = s.snap; r.model = s.model;
      return r;
    });
  }

  var API = { LAB: LAB, EXIT: EXIT, FIXED_P99: FIXED_P99, ONSALE: ONSALE, SNAPSHOTS: SNAPSHOTS, SCRIPT: SCRIPT,
    decide: decide, rules: rules, line: line, explain: explain, run: run, slower: slower, fixedCeiling: fixedCeiling, limits: limits, play: play };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return PT ? pair[1] : pair[0]; }
  function num(x, d) { return x.toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pc(x, d) { return num(x * 100, d === undefined ? 2 : d) + "%"; }

  C.style("canary-explain", [
    ".md-typeset .csim-ce-rules { width: 100%; border-collapse: collapse; font-size: .66rem; margin: .3rem 0; display: table; }",
    ".md-typeset .csim-ce-rules th, .md-typeset .csim-ce-rules td { padding: .15rem .4rem; border-bottom: 1px solid var(--c-line); text-align: left; }",
    ".md-typeset .csim-ce-rules td.n { text-align: right; font-variant-numeric: tabular-nums; }",
    ".md-typeset .csim-ce-rules tr.fired td { background: color-mix(in srgb, var(--c-bad) 10%, var(--c-bg)); }",
    ".md-typeset .csim-ce-rules tr.fired.warn td { background: color-mix(in srgb, var(--c-warn) 12%, var(--c-bg)); }",
    ".md-typeset .csim-ce-rules tr.skip td { color: var(--c-fg3); }",
    ".md-typeset .csim-ce-rules td.r { font-weight: 700; }",
    ".md-typeset .csim-ce-rules tr.fired td.r { color: var(--c-bad); }",
    ".md-typeset .csim-ce-rules tr.fired.warn td.r { color: var(--c-warn); }",
    ".md-typeset .csim-ce-rules tr.pass td.r { color: var(--c-ok); }",
    ".md-typeset .csim-log.csim-ce-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; }",
    ".md-typeset .csim-ce-free.off { display: none; }"
  ].join("\n"));

  C.register("canary-explain", function (root) {
    var o = C.opts(root, { script: "lab" });
    var mode = o.script === "free" ? "free" : "lab";
    var cur = { snap: "regression", model: "system", m: null, onsale: false };

    var svg = s("svg", { viewBox: "0 0 640 150", role: "img", "aria-label": t("Canary analysis: the policy decides, the model explains", "Análise do canary: a política decide, o modelo explica") });
    var table = el("table", { class: "csim-ce-rules" });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-ce-term";
    var tiles = C.stats([
      { key: "verdict", label: t("policy verdict", "veredito da política") },
      { key: "exit", label: t("exit code (what Argo sees)", "código de saída (o que o Argo vê)") },
      { key: "expl", label: t("model's explanation", "explicação do modelo") },
      { key: "fixed", label: t("a fixed p99 ceiling of 300 ms would say (illustrative)", "um teto fixo de p99 de 300 ms diria (ilustrativo)") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var cMode = C.choice({ label: t("Mode", "Modo"), value: mode, options: [
      { value: "lab", label: t("Lab page 5.3 (replay)", "Página 5.3 do lab (replay)") },
      { value: "free", label: t("free: change the canary", "livre: mude o canary") }
    ], onChange: function (v) { mode = v; reset(); } });

    var cSnap = C.choice({ label: t("Snapshot", "Snapshot"), value: cur.snap, options: [
      { value: "healthy", label: "healthy" }, { value: "regression", label: "regression" }, { value: "low-traffic", label: "low-traffic" }
    ], onChange: function (v) { load(v); update(true); } });
    var sRps = C.slider({ label: t("canary req/s", "req/s do canary"), min: 0, max: 40, step: 0.1, value: 21.4,
      fmt: function (v) { return num(v, 1); }, onInput: function () { update(true); } });
    var sErr = C.slider({ label: t("canary errors", "erros do canary"), min: 0, max: 400, step: 1, value: 290,
      fmt: function (v) { return pc(v / 10000); }, onInput: function () { update(true); } });
    var sP99 = C.slider({ label: t("canary p99", "p99 do canary"), min: 50, max: 600, step: 1, value: 412,
      fmt: function (v) { return v + " ms"; }, onInput: function () { update(true); } });
    var tSale = C.toggle({ label: t("10:00 on an on-sale day: both versions 2× slower", "10:00 de um dia de venda: as duas versões 2× mais lentas"),
      onChange: function (v) { cur.onsale = v; update(true); } });
    var cModel = C.choice({ label: t("Model", "Modelo"), value: "system", options: [
      { value: "system", label: t("lab's SYSTEM (repeat the verdict)", "SYSTEM do lab (repita o veredito)") },
      { value: "promote", label: t("SYSTEM tampered: \"recommend promote\"", "SYSTEM alterado: \"recomende promover\"") },
      { value: "nokey", label: t("Claude without a key", "Claude sem chave") }
    ], onChange: function (v) { cur.model = v; update(true); } });
    var free = el("div", { class: "csim-ce-free" }, [
      el("div", { class: "csim-row" }, [cSnap, tSale]),
      el("div", { class: "csim-row" }, [sRps, sErr, sP99]),
      el("div", { class: "csim-row" }, [cModel])
    ]);

    function load(name) {
      cur.snap = name;
      var c = SNAPSHOTS[name].canary;
      sRps.set(c.rps); sErr.set(Math.round(c.error_rate * 10000)); sP99.set(Math.round(c.p99 * 1000));
    }
    function freeMetrics() {
      var st = SNAPSHOTS[cur.snap].stable;
      var m = { stable: { rps: st.rps, errors: st.errors, error_rate: st.error_rate, p99: st.p99 },
        canary: { rps: sRps.get(), errors: 0, error_rate: sErr.get() / 10000, p99: sP99.get() / 1000 } };
      m.canary.errors = m.canary.rps * m.canary.error_rate;
      return cur.onsale ? slower(m, ONSALE) : m;
    }

    var player = C.player({ interval: 2600, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });

    function out(r, title) {
      var lines = [r.line];
      if (r.expl.text) lines.push(r.expl.text);
      else lines.push(t("(explanation kept: it repeats the verdict)", "(explicação mantida: ela repete o veredito)"));
      lines.push("exit code: " + r.exit);
      term.add(el("span", {}, [el("b", { text: "$ " + title }), "\n" + lines.join("\n")]), r.verdict === "promote" ? "ok" : r.verdict === "rollback" ? "bad" : "warn");
    }

    function step(k) {
      if (k > SCRIPT.length) return false;
      var sc = SCRIPT[k - 1];
      cur.snap = sc.snap; cur.model = sc.model; cur.m = SNAPSHOTS[sc.snap];
      var r = run(cur.m, sc.model);
      out(r, (sc.model === "nokey" ? "env -u ANTHROPIC_API_KEY LLM_PROVIDER=anthropic " : "") + "canary_explain.py --metrics canary/" + sc.snap + ".json" +
        (sc.model === "promote" ? t("   # SYSTEM edited", "   # SYSTEM editado") : ""));
      draw(r);
      say(L([sc.en, sc.pt]), r.verdict === "promote" ? "ok" : r.verdict === "rollback" ? (r.expl.kept ? "bad" : "warn") : "warn");
    }
    function replay(k) {
      term.clear(); cur.m = null;
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
    }
    function intro() {
      cur.m = null; draw(null);
      say(t("The three snapshots of 5.3, then the two attacks on the explanation: press play or →. Each step prints what the script prints.",
        "Os três snapshots da 5.3 e depois os dois ataques à explicação: aperte play ou →. Cada passo imprime o que o script imprime."), "");
    }
    function update(fromUser) {
      cur.m = freeMetrics();
      var r = run(cur.m, cur.model);
      draw(r);
      if (fromUser) {
        var lim = limits(cur.m);
        var tone = r.verdict === "promote" ? "ok" : r.verdict === "rollback" ? "bad" : "warn";
        say(r.line.replace(/\*\*/g, "") + "  " + t("With this stable version, the policy promotes up to " + pc(lim.errorRate) + " errors and a p99 of " + lim.p99ms + " ms.",
          "Com esta versão estável, a política promove até " + pc(lim.errorRate) + " de erros e um p99 de " + lim.p99ms + " ms."), tone);
      }
    }
    function reset() {
      cMode.set(mode); term.clear();
      free.className = "csim-ce-free" + (mode === "free" ? "" : " off");
      player.style.display = mode === "lab" ? "" : "none";
      player.total(SCRIPT.length);
      player.jump(0);
      if (mode === "lab") intro();
      else { cur.model = "system"; cModel.set("system"); cur.onsale = false; tSale.set(false); cSnap.set("regression"); load("regression"); update(true); }
    }

    var NODES = [
      { id: "m", x: 6, y: 52, w: 92, en: "metrics", pt: "métricas", sub: "snapshot / Prometheus" },
      { id: "p", x: 122, y: 52, w: 104, en: "policy in code", pt: "política em código", sub: "4 rules" },
      { id: "v", x: 250, y: 52, w: 92, en: "verdict", pt: "veredito", sub: "" },
      { id: "l", x: 366, y: 8, w: 104, en: "model explains", pt: "modelo explica", sub: "" },
      { id: "q", x: 494, y: 8, w: 140, en: "same verdict?", pt: "mesmo veredito?", sub: "" },
      { id: "x", x: 366, y: 100, w: 268, en: "exit code → Argo Rollouts / CI step", pt: "código de saída → Argo Rollouts / passo de CI", sub: "" }
    ];
    function draw(r) {
      C.clear(svg);
      function box(n, cls, sub) {
        svg.appendChild(s("rect", { x: n.x, y: n.y, width: n.w, height: 42, rx: 7, class: "c-box " + cls }));
        svg.appendChild(s("text", { x: n.x + n.w / 2, y: n.y + 17, "text-anchor": "middle", class: "c-label" }, L([n.en, n.pt])));
        if (sub) svg.appendChild(s("text", { x: n.x + n.w / 2, y: n.y + 32, "text-anchor": "middle", class: "c-small" }, sub));
      }
      function wire(x1, y1, x2, y2, on, cut) {
        svg.appendChild(s("path", { d: "M" + x1 + "," + y1 + " C" + (x1 + 14) + "," + y1 + " " + (x2 - 14) + "," + y2 + " " + x2 + "," + y2,
          class: "c-wire" + (cut ? " cut" : on ? " on" : "") }));
      }
      var N = {}; NODES.forEach(function (n) { N[n.id] = n; });
      var vt = r ? (r.verdict === "promote" ? "ok" : r.verdict === "rollback" ? "bad" : "warn") : "";
      wire(98, 73, 122, 73, !!r); wire(226, 73, 250, 73, !!r);
      wire(342, 73, 366, 29, r && r.expl.said !== null, r && r.expl.said === null);
      wire(470, 29, 494, 29, r && r.expl.said !== null);
      wire(342, 73, 366, 121, !!r);
      box(N.m, r ? "on" : "", r ? (cur.onsale ? t("2× slower", "2× mais lento") : (mode === "lab" ? cur.snap + ".json" : t("your canary", "seu canary"))) : N.m.sub);
      var fired = r ? rules(cur.m).filter(function (x) { return x.fired; }).length : 0;
      box(N.p, r ? "on" : "", r ? (fired ? fired + t(" rule(s) fired", " regra(s) disparou(aram)") : t("all pass", "todas passam")) : t("4 rules", "4 regras"));
      box(N.v, r ? vt : "", r ? r.verdict.toUpperCase() : "");
      box(N.l, r ? (r.expl.said === null ? "down" : r.expl.kept ? "on" : "warn") : "", r ? (r.expl.said === null ? t("no key: no model", "sem chave: sem modelo") : t("says ", "diz ") + r.expl.said) : "");
      box(N.q, r ? (r.expl.said === null ? "down" : r.expl.kept ? "ok" : "bad") : "", r ? (r.expl.said === null ? t("nothing to compare", "nada a comparar") : r.expl.kept ? t("yes → kept", "sim → mantida") : t("no → discarded", "não → descartada")) : "");
      box(N.x, r ? vt : "", r ? "exit code " + r.exit + " · " + (r.verdict === "promote" ? "promote" : r.verdict === "rollback" ? "rollback" : t("wait (a Job counts it as failure)", "esperar (um Job conta como falha)")) : "");

      /* the rules */
      C.clear(table);
      table.appendChild(el("tr", {}, [el("th", { text: t("rule (canary_explain.py)", "regra (canary_explain.py)") }), el("th", { text: t("stable", "estável") }),
        el("th", { text: "canary" }), el("th", { text: t("limit", "limite") }), el("th", { text: t("result", "resultado") })]));
      var m = cur.m, rs = m ? rules(m) : null;
      var rows = [
        ["MIN_RPS", m ? num(m.stable.rps, 1) + " req/s" : "–", m ? num(m.canary.rps, 2) + " req/s" : "–", "≥ " + num(LAB.minRps, 1) + " req/s"],
        ["MAX_ERROR_RATE", m ? pc(m.stable.error_rate) : "–", m ? pc(m.canary.error_rate) : "–", "≤ " + pc(LAB.maxErrorRate)],
        ["MAX_ERROR_DELTA", "", m ? (m.canary.error_rate >= m.stable.error_rate ? "+" : "") + num((m.canary.error_rate - m.stable.error_rate) * 100, 2) + " pp" : "–", "≤ " + num(LAB.maxErrorDelta * 100, 1) + " pp"],
        ["MAX_P99_RATIO", m ? Math.round(m.stable.p99 * 1000) + " ms" : "–", m ? Math.round(m.canary.p99 * 1000) + " ms (" + num(rs[3].value, 2) + "×)" : "–", "≤ " + num(LAB.maxP99Ratio, 2) + "×"]
      ];
      rows.forEach(function (row, i) {
        var f = rs ? rs[i].fired : undefined;
        var res = f === undefined ? "" : f === null ? t("not evaluated", "não avaliada") : f ? (i === 0 ? "→ INCONCLUSIVE" : t("fires", "dispara")) : t("passes", "passa");
        table.appendChild(el("tr", { class: f === null ? "skip" : f ? "fired" + (i === 0 ? " warn" : "") : f === false ? "pass" : "" }, [
          el("td", {}, [el("code", { text: row[0] })]), el("td", { class: "n", text: row[1] }), el("td", { class: "n", text: row[2] }),
          el("td", { class: "n", text: row[3] }), el("td", { class: "r", text: res })]));
      });

      tiles.set("verdict", r ? r.verdict.toUpperCase() : "–", vt);
      tiles.set("exit", r ? String(r.exit) : "–", vt);
      tiles.set("expl", r ? (r.expl.said === null ? t("none", "nenhuma") : r.expl.kept ? t("kept", "mantida") : t("discarded", "descartada")) : "–",
        r ? (r.expl.kept ? "ok" : r.expl.said === null ? "" : "warn") : "");
      var fc = m ? fixedCeiling(m) : null;
      tiles.set("fixed", fc ? fc.toUpperCase() + " (p99 " + Math.round(m.canary.p99 * 1000) + " ms)" : "–",
        fc && r && r.verdict !== "inconclusive" && fc !== r.verdict ? "warn" : "");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("canary_explain.py without a cluster: the policy decides, the model explains",
        "canary_explain.py sem cluster: a política decide, o modelo explica") }),
      el("p", { class: "csim-sub", text: t("The four rules of the script against the stable version at the same time; the exit code comes from them alone. The model only adds an explanation, kept if it repeats the verdict.",
        "As quatro regras do script contra a versão estável no mesmo período; o código de saída vem só delas. O modelo só acrescenta uma explicação, mantida se repetir o veredito.") }),
      el("div", { class: "csim-row" }, [cMode]),
      free,
      el("div", { class: "csim-stage" }, svg),
      table,
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
