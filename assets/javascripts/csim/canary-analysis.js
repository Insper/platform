/*
 * Lab twin of hands-on 11, step 5 (2027.1): the canary of catalog with Argo Rollouts.
 *
 *   <div class="csim" data-sim="canary-analysis" data-chaos="0.3" data-rate="20"></div>
 *
 * catalog-rollout.yaml: setWeight 25 → pause 2 min → setWeight 50 → pause 2 min → the canary becomes
 * stable. With no traffic router the weight is reached by replica counts: with the HPA's 2 replicas,
 * 25% is 1 canary pod next to 2 stable ones (a third of the traffic), 50% is 1 and 1. The Ingress sends
 * k6's requests (load/catalog-hpa.js: 20 req/s at the start, PEAK = 40 on the page) to every ready pod.
 * catalog-analysis.yaml runs in the background from the first step: every 30 s, the canary's error
 * ratio over [1m] must be < 1% and its p99 < 0.5 s; `len(result) == 0 || isNaN(...)` passes an empty
 * result; failureLimit 1 → the second failed measurement of a metric aborts the rollout.
 *
 * How the model measures (Prometheus semantics, simplified):
 *   - prometheus.yaml scrapes the canary Service every 15 s (here at t = 7, 22, 37 … s after the canary
 *     pod becomes ready; the phase is an assumption);
 *   - each series (API 200, API 500, actuator) exists from its first request; rate() over [1m] needs two
 *     samples of a series inside the window and counts only what happened between them;
 *   - the query has no uri filter, so the kubelet's probes (readiness every 5 s, liveness every 10 s,
 *     lab 10's catalog.yaml) and the scrapes themselves are in the denominator; ChaosFilter never
 *     fails /actuator requests;
 *   - with no 500 series in the window the division is empty: [] (passes);
 *   - requests are counted with their expected values (rate × share × error rate), no noise; the
 *     latency of a request is 9 ms (the performance gate's laptop p99), plus Thread.sleep(400) of
 *     step 3 when that regression is on.
 */
(function () {
  "use strict";

  var LAB = { weight1: 25, weight2: 50, pause: 120, interval: 30, failureLimit: 1, maxError: 0.01, maxP99: 0.5, window: 60, scrape: 15,
    replicas: 2, chaos: 0.3, readinessPeriod: 5, livenessPeriod: 10, startRate: 20, peak: 40, sleepMs: 400 };
  var PHASE = 7, RUN = 300, BASE_MS = 9;

  function defaults() { return { chaos: LAB.chaos, rate: LAB.startRate, sleep: false }; }

  /* pods of each version at a weight (Argo's basic canary rounds both up) */
  function pods(weight) {
    var c = Math.ceil(LAB.replicas * weight / 100), s = Math.ceil(LAB.replicas * (100 - weight) / 100);
    return { canary: c, stable: s, share: c / (c + s) };
  }

  /* o: {chaos, rate, sleep} → the whole rollout, second by second, and the analysis measurements */
  function run(o) {
    o = Object.assign(defaults(), o || {});
    var act = 1 / LAB.readinessPeriod + 1 / LAB.livenessPeriod + 1 / LAB.scrape;
    var cum = { ok: [0], err: [0], act: [0] }, born = { ok: null, err: null, act: -1e9 };
    var phase = "25", abortAt = null, promotedAt = null, fails = { err: 0, p99: 0 }, meas = [], timeline = [];
    var fan = { req: 0, err: 0, canaryReq: 0 };
    var stepEnds = [LAB.pause, 2 * LAB.pause];
    function sample(series, at) { return born[series] !== null && born[series] <= at ? cum[series][Math.min(at, cum[series].length - 1)] : null; }
    /* the samples of a series inside the window (tm − 1m, tm]: the scrapes at which it already existed */
    function samples(series, tm) {
      var out = [];
      for (var k = Math.ceil((tm - LAB.window - PHASE) / LAB.scrape); PHASE + k * LAB.scrape <= tm; k++) {
        var at = PHASE + k * LAB.scrape;
        if (at <= tm - LAB.window) continue;
        if (at < 0) { if (series === "act") out.push(act * at); continue; }   /* probes ran before the pod was ready */
        var v = sample(series, at);
        if (v !== null) out.push(v);
      }
      return out;
    }
    function measure(tm) {
      var inc = {};
      ["ok", "err", "act"].forEach(function (x) { var v = samples(x, tm); inc[x] = v.length >= 2 ? v[v.length - 1] - v[0] : null; });
      var den = (inc.ok || 0) + (inc.err || 0) + (inc.act || 0);
      var err = inc.err === null ? null : inc.err / den;
      var api = inc.ok !== null || inc.err !== null;
      var p99 = api ? (BASE_MS + (o.sleep ? LAB.sleepMs : 0)) / 1000 : null;
      var errOk = err === null || isNaN(err) || err < LAB.maxError, p99Ok = p99 === null || p99 < LAB.maxP99;
      if (!errOk) fails.err++;
      if (!p99Ok) fails.p99++;
      return { t: tm, err: err, errOk: errOk, p99: p99, p99Ok: p99Ok, fails: { err: fails.err, p99: fails.p99 } };
    }
    for (var t = 0; t < RUN; t++) {
      if (phase !== "aborted" && phase !== "promoted" && t % LAB.interval === 0) {
        var m = measure(t);
        meas.push(m);
        if (m.fails.err > LAB.failureLimit || m.fails.p99 > LAB.failureLimit) { phase = "aborted"; abortAt = t; }
      }
      if (phase === "25" && t >= stepEnds[0]) phase = "50";
      if (phase === "50" && t >= stepEnds[1]) { phase = "promoted"; promotedAt = t; }
      var share = phase === "25" ? pods(LAB.weight1).share : phase === "50" ? pods(LAB.weight2).share : phase === "promoted" ? 1 : 0;
      var lc = o.rate * share, live = phase === "25" || phase === "50";
      var okInc = live ? lc * (1 - o.chaos) : 0, errInc = live ? lc * o.chaos : 0;
      cum.ok.push(cum.ok[t] + okInc); cum.err.push(cum.err[t] + errInc); cum.act.push(cum.act[t] + (live ? act : 0));
      if (born.ok === null && cum.ok[t + 1] >= 1) born.ok = t + 1;
      if (born.err === null && cum.err[t + 1] >= 1) born.err = t + 1;
      fan.req += o.rate; fan.err += lc * o.chaos; if (live) fan.canaryReq += lc;
      timeline.push({ t: t, phase: phase, share: share });
    }
    return { o: o, meas: meas, timeline: timeline, abortAt: abortAt, promotedAt: promotedAt, fan: fan,
      status: abortAt !== null ? "Degraded" : promotedAt !== null ? "Healthy" : "Progressing" };
  }

  var API = { LAB: LAB, run: run, pods: pods, defaults: defaults, RUN: RUN, PHASE: PHASE };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el;

  function dec(v, d) { var x = v.toFixed(d); return C.PT ? x.replace(".", ",") : x; }
  function val(v) { return v === null ? "[]" : v.toFixed(3); }   /* as Argo prints it, in both languages */
  function pct(v, d) { return dec(100 * v, d === undefined ? 1 : d) + "%"; }

  C.style("canary-analysis", [
    ".md-typeset .csim-ca-steps { display: flex; gap: 4px; margin: .2rem 0 .5rem; }",
    ".md-typeset .csim-ca-steps span { flex: 1; text-align: center; font-size: .68rem; padding: .25em .2em; border-radius: 4px; border: 1px solid var(--c-line); color: var(--c-fg2); }",
    ".md-typeset .csim-ca-steps span.on { border-color: var(--c-ink); background: var(--c-tint); color: var(--c-fg); font-weight: 600; }",
    ".md-typeset .csim-ca-steps span.done { background: var(--c-panel); }",
    ".md-typeset .csim-ca-steps span.bad { border-color: var(--c-bad); color: var(--c-bad); }",
    ".md-typeset .csim-ca-steps span.ok { border-color: var(--c-ok); color: var(--c-ok); }",
    ".md-typeset .csim-ca-pods { display: flex; gap: 6px; align-items: center; font-size: .7rem; margin-bottom: .4rem; flex-wrap: wrap; }",
    ".md-typeset .csim-ca-pod { padding: .2em .6em; border-radius: 4px; border: 1px solid var(--c-line); }",
    ".md-typeset .csim-ca-pod.stable { background: color-mix(in srgb, var(--c-ok) 22%, var(--c-bg)); border-color: var(--c-ok); }",
    ".md-typeset .csim-ca-pod.canary { background: color-mix(in srgb, var(--c-warn) 25%, var(--c-bg)); border-color: var(--c-warn); }",
    ".md-typeset .csim-ca-tab { width: 100%; font-size: .68rem; border-collapse: collapse; }",
    ".md-typeset .csim-ca-tab td, .md-typeset .csim-ca-tab th { padding: .15em .5em; border-bottom: 1px solid var(--c-line); text-align: left; }",
    ".md-typeset .csim-ca-tab td.ok { color: var(--c-ok); } .md-typeset .csim-ca-tab td.bad { color: var(--c-bad); font-weight: 600; }",
    ".md-typeset .csim-ca-tab code { font-size: .95em; }"
  ].join("\n"));

  C.register("canary-analysis", function (root) {
    var o = C.opts(root, { chaos: LAB.chaos, rate: LAB.startRate, sleep: "off" });
    var cfg = { chaos: o.chaos, rate: o.rate, sleep: o.sleep === "on" }, res, cursor = 0;
    var steps = el("div", { class: "csim-ca-steps" });
    var podsBox = el("div", { class: "csim-ca-pods" });
    var tab = el("table", { class: "csim-ca-tab" });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "status", label: "Rollout" },
      { key: "share", label: t("traffic on the new version", "tráfego na versão nova") },
      { key: "fail", label: t("error-rate failures / limit", "falhas de error-rate / limite") },
      { key: "fans", label: t("requests that failed (all fans)", "requisições que falharam (todos os fãs)") }
    ]);
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function now() { return res.timeline[Math.min(cursor, RUN - 1)]; }
    function draw() {
      var x = now(), ph = cursor === 0 ? "25" : x.phase;
      C.clear(steps);
      [["25", "setWeight 25"], ["p1", "pause 2m"], ["50", "setWeight 50"], ["p2", "pause 2m"], ["promoted", t("stable", "stable")]].forEach(function (s, i) {
        var active = (ph === "25" && i <= 1 && (i === 0 ? cursor === 0 : cursor > 0)) || (ph === "50" && (i === 3 || (i === 2 && cursor === LAB.pause)));
        var done = (ph === "50" && i < 2) || (ph === "promoted" && i < 4);
        var cls = ph === "aborted" ? (i === 4 ? "" : "bad") : ph === "promoted" && i === 4 ? "ok" : active ? "on" : done ? "done" : "";
        steps.appendChild(el("span", { class: cls, text: s[1] }));
      });
      C.clear(podsBox);
      var w = ph === "25" ? pods(LAB.weight1) : ph === "50" ? pods(LAB.weight2) : ph === "promoted" ? { canary: LAB.replicas, stable: 0 } : { canary: 0, stable: LAB.replicas };
      for (var i = 0; i < w.stable; i++) podsBox.appendChild(el("span", { class: "csim-ca-pod stable", text: "catalog v1" }));
      for (var j = 0; j < w.canary; j++) podsBox.appendChild(el("span", { class: "csim-ca-pod canary", text: ph === "promoted" ? "catalog v2 (stable)" : "catalog v2 (canary)" }));
      podsBox.appendChild(el("span", { class: "csim-lbl", text: "k6: " + cfg.rate + " req/s" }));
      C.clear(tab);
      tab.appendChild(el("tr", {}, [el("th", { text: "t" }), el("th", { text: "error-rate" }), el("th", { text: "p99-latency" })]));
      res.meas.forEach(function (m) {
        if (m.t > cursor) return;
        tab.appendChild(el("tr", {}, [
          el("td", { text: m.t + " s" }),
          el("td", { class: m.errOk ? "ok" : "bad", text: (m.errOk ? "✔ " : "✖ ") + val(m.err) + (m.errOk ? "" : " (" + m.fails.err + ")") }),
          el("td", { class: m.p99Ok ? "ok" : "bad", text: (m.p99Ok ? "✔ " : "✖ ") + (m.p99 === null ? "[]" : dec(m.p99, 3) + " s") })
        ]));
      });
      var status = ph === "aborted" ? "✖ Degraded" : ph === "promoted" ? "✔ Healthy" : "◌ Progressing";
      st.set("status", status, ph === "aborted" ? "bad" : ph === "promoted" ? (cfg.chaos > 0 ? "warn" : "ok") : "info");
      st.set("share", pct(cursor ? x.share : pods(LAB.weight1).share, 0), "");
      var f = 0;
      res.meas.forEach(function (m) { if (m.t <= cursor) f = m.fails.err; });
      st.set("fail", f + " / " + LAB.failureLimit, f > LAB.failureLimit ? "bad" : f ? "warn" : "ok");
      var fe = 0, fr = 0;
      res.timeline.forEach(function (y) { if (y.t < cursor) { fr += cfg.rate; fe += cfg.rate * y.share * cfg.chaos; } });
      st.set("fans", fr ? pct(fe / fr, 2) : "–", fe ? "warn" : "ok");
    }
    function verdict() {
      var r = res, list = r.meas.map(function (m) { return val(m.err); }).join(", ");
      var allEmpty = r.meas.every(function (m) { return m.err === null; });
      if (r.abortAt !== null) {
        var lived = cfg.rate * r.abortAt, n = Math.round(r.fan.err);
        return [t("RolloutAborted " + r.abortAt + " s after the canary got traffic: Metric \"error-rate\" assessed Failed due to failed (" + (LAB.failureLimit + 1) + ") > failureLimit (" + LAB.failureLimit + "). Measurements: " + list + ". About " + n + " requests failed, " + pct(r.fan.err / lived, 0) + " of those sent in that time; the stable pods served everyone else, and serve all of them now.",
          "RolloutAborted " + r.abortAt + " s depois que o canary recebeu tráfego: Metric \"error-rate\" assessed Failed due to failed (" + (LAB.failureLimit + 1) + ") > failureLimit (" + LAB.failureLimit + "). Medições: " + list + ". Cerca de " + n + " requisições falharam, " + pct(r.fan.err / lived, 0) + " das enviadas nesse tempo; os pods estáveis atenderam todos os outros, e agora atendem todos."), "bad"];
      }
      if (cfg.chaos > 0) {
        var why = cfg.rate === 0 ? t("With no traffic every result is [] — and len(result) == 0 counts as a pass.", "Sem tráfego todo resultado é [] — e len(result) == 0 conta como aprovação.")
          : allEmpty ? t("So few canary requests that no 500 series had two samples in any window: every result was [], a pass. Rare errors need traffic, or longer pauses.", "Tão poucas requisições no canary que nenhuma série 500 teve duas amostras numa janela: todo resultado foi [], uma aprovação. Erros raros precisam de tráfego, ou de pausas mais longas.")
          : t("Every value stayed under the 1% threshold: a bug below it passes by design. The threshold is the decision — tie it to the SLO's budget (lab 8: 0.5%).", "Todo valor ficou abaixo do limite de 1%: um bug abaixo dele passa por projeto. O limite é a decisão — amarre-o ao budget do SLO (lab 8: 0,5%).");
        return [t("Promoted with a bug (" + list + "): v2 now serves 100% of the fans and fails " + pct(cfg.chaos, 1) + " of their requests. ", "Promovida com um bug (" + list + "): a v2 agora atende 100% dos fãs e falha " + pct(cfg.chaos, 1) + " das requisições deles. ") + why, "warn"];
      }
      return [t("Healthy: every step passed and v2 is the new stable. " + (cfg.sleep ? "Note the p99 of " + dec((BASE_MS + LAB.sleepMs) / 1000, 3) + " s: under the canary's 0.5 s, so the 400 ms regression of step 3 rolls out — only the performance gate in CI catches it." : "With no errors there is no 500 series: every error-rate result is [], a pass."),
        "Healthy: todos os passos passaram e a v2 é a nova stable. " + (cfg.sleep ? "Repare no p99 de " + dec((BASE_MS + LAB.sleepMs) / 1000, 3) + " s: abaixo do 0,5 s do canary, então a regressão de 400 ms do passo 3 é publicada — só o performance gate da CI a pega." : "Sem erros não existe série 500: todo resultado de error-rate é [], uma aprovação.")), "ok"];
    }
    function reset() {
      res = run(cfg); cursor = 0;
      say(t("t = 0: the canary pod is ready, setWeight 25 is done and the background analysis takes its first measurement. Press play: one tick = 5 s.",
        "t = 0: o pod canary está pronto, o setWeight 25 terminou e a análise em segundo plano faz a primeira medição. Dê play: um tick = 5 s."), "");
      draw();
    }
    function tick() {
      var end = res.abortAt !== null ? res.abortAt : res.promotedAt !== null ? res.promotedAt : RUN;
      if (cursor >= end) return false;
      cursor = Math.min(end, cursor + 5);
      if (cursor >= end) { var v = verdict(); say(v[0], v[1]); draw(); return false; }
      draw();
    }
    var player = C.player({ interval: 260, speeds: [1, 2, 4], onTick: tick, onReset: reset, label: function () { return "t = " + cursor + " s"; } });
    function change(k) { return function (v) { cfg[k] = v; player.reset(); }; }
    var cC = C.choice({ label: "CHAOS_ERROR_RATE", value: cfg.chaos, options: [0, 0.005, 0.02, 0.3].map(function (v) { return { value: v, label: String(v) }; }), onChange: change("chaos") });
    var cR = C.choice({ label: t("k6 load", "carga do k6"), value: cfg.rate, options: [0, 1, LAB.startRate, LAB.peak].map(function (v) { return { value: v, label: v + " req/s" }; }), onChange: change("rate") });
    var tS = C.toggle({ label: t("+ Thread.sleep(400) (step 3)", "+ Thread.sleep(400) (passo 3)"), checked: cfg.sleep, onChange: change("sleep") });

    C.add(root, [
      el("p", { class: "csim-title", text: t("Lab 11, step 5: does the analysis stop this release — and how fast?", "Lab 11, passo 5: a análise barra esta versão — e em quanto tempo?") }),
      el("p", { class: "csim-sub", text: t("catalog-rollout.yaml and catalog-analysis.yaml: 2 replicas, no traffic router, error ratio < 1% and p99 < 0.5 s every 30 s, failureLimit 1.",
        "catalog-rollout.yaml e catalog-analysis.yaml: 2 réplicas, sem traffic router, taxa de erro < 1% e p99 < 0,5 s a cada 30 s, failureLimit 1.") }),
      el("div", { class: "csim-row" }, [cC, cR, tS]),
      el("div", { class: "csim-stage" }, [steps, podsBox, tab]),
      st, note, player
    ]);
    reset();
    return { destroy: function () { player.pause(); } };
  });
})();
