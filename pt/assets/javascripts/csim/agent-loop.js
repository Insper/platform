/*
 * The agent loop and its budgets (2027.1, class 13 — Agents & Tools):
 *
 *   <div class="csim" data-sim="agent-loop" data-steps="8"></div>
 *
 * The fan's task "two seats under R$300 for Saturday, hold them", run by the loop of the page's
 * sketch: call the model, run the tool calls it asks for, append calls and results, call again.
 * Each call re-sends the whole context, so its input grows by one tool call and one tool result per
 * step; a prompt cache bills the repeated part at a discount. The numbers are those of the overview's
 * cost table (a 3,000-token prefix, 80-token tool calls, 700-token tool results, a 250-token answer,
 * US$ 3 / 15 per million input / output tokens, cached input at 10 %, 50 tokens/s).
 *
 * Two model behaviours: one that finds the seats (search events, search seats — two calls in one step
 * when parallel tool calls are on —, hold, answer) and one that gets stuck repeating the same search.
 * The stop conditions are the page's: a reply without tool calls, the step limit (MAX_STEPS), the
 * token budget (MAX_TOKENS = 40,000), and loop detection (the same tool with the same arguments
 * twice). "Last call without tools" is lab 12's choice: the final allowed call offers no tools, so the
 * budget ends with an answer instead of a canned apology.
 */
(function () {
  "use strict";

  /* the overview's cost table (classes/ai-systems/index.md, "The numbers") */
  var PRICE_IN = 3.00, PRICE_OUT = 15.00, CACHED = 0.10;
  var SYSTEM = 3000, USER = 60, STEP_OUT = 80, TOOL_OUT = 700, FINAL_OUT = 250;
  var TTFT0 = 0.30, PREFILL_1K = 0.08, TPOT = 0.02, TOOL_S = 0.15;
  /* the page's loop sketch (agents/index.md, agent_loop.py) */
  var MAX_STEPS = 8, MAX_TOKENS = 40000;

  var C1 = { name: "search_events", args: 'city="São Paulo", date="2027-03-13"' };
  var C2 = { name: "search_seats", args: "evt_8812, 2, 300" };
  var C3 = { name: "search_seats", args: "evt_8820, 2, 300" };
  var C4 = { name: "hold_seats", args: 'evt_8812, ["C12","C13"], key' };

  /* what the model asks for at each call, before any budget stops it */
  function replies(behaviour, parallel, n) {
    var out = [];
    if (behaviour === "stuck") {
      out.push([C1]);
      while (out.length < n) out.push([C2]);
    } else {
      out.push([C1]);
      if (parallel) out.push([C2, C3]); else { out.push([C2]); out.push([C3]); }
      out.push([C4]);
      out.push(null);                          /* null: a text answer, no tool calls */
    }
    return out;
  }

  function key(c) { return c.name + "(" + c.args + ")"; }

  /*
   * Run the loop. o = {behaviour: "finds" | "stuck", maxSteps, loopDetect, lastToolless, parallel, hit}
   * Returns {steps: [...], stop, calls, tokens, used, cost, wait, full}: wait is when the fan sees the
   * first word (the answer's first token, or the hand-off message), full is when the answer is complete.
   */
  function run(o) {
    var maxSteps = o.maxSteps || MAX_STEPS, hit = o.hit || 0;
    var plan = replies(o.behaviour, o.parallel !== false, maxSteps + 2);
    var context = SYSTEM + USER, fresh = USER, tokens = 0, used = 0, cost = 0, t = 0;
    var seen = {}, steps = [], stop = null, done = [];
    for (var i = 0; i < maxSteps; i++) {
      var last = i === maxSteps - 1;
      var forced = last && o.lastToolless;     /* the last call is made without tools */
      var want = plan[i] === undefined ? null : plan[i];
      var answer = want === null || forced;
      var repeat = !answer && o.loopDetect && want.some(function (c) { return seen[key(c)]; });
      var out = answer ? FINAL_OUT : STEP_OUT;
      var cacheable = context - fresh, uncached = fresh + cacheable * (1 - hit);
      var c = (uncached + cacheable * hit * CACHED) * PRICE_IN / 1e6 + out * PRICE_OUT / 1e6;
      var step = { i: i + 1, context: context, cached: Math.round(cacheable * hit), uncached: Math.round(uncached), out: out,
        calls: answer ? [] : want, start: t, cost: c, partial: answer && want !== null };
      tokens += context; used += context + out; cost += c;
      t += TTFT0 + PREFILL_1K * uncached / 1000;
      if (answer) {
        step.kind = "answer"; step.end = t + out * TPOT;
        steps.push(step); stop = "answer";
        return finish();
      }
      if (repeat) {                            /* billed, but the tool is not run */
        t += out * TPOT;
        step.kind = "loop"; step.end = t;
        steps.push(step); stop = "loop";
        return finish();
      }
      t += out * TPOT + TOOL_S;
      want.forEach(function (c) { seen[key(c)] = true; done.push(c.name); });
      fresh = out + TOOL_OUT; context += fresh;
      step.kind = "tools"; step.end = t;
      steps.push(step);
      if (used > MAX_TOKENS && !last) { stop = "tokens"; return finish(); }
    }
    stop = "steps";
    return finish();

    function finish() {
      var lastStep = steps[steps.length - 1];
      var answered = stop === "answer";
      return { steps: steps, stop: stop, calls: steps.length, tokens: tokens, used: used, cost: cost, tools: done,
        held: done.indexOf("hold_seats") >= 0, partial: answered && lastStep.partial,
        wait: answered ? lastStep.start + (lastStep.end - lastStep.start - FINAL_OUT * TPOT) : lastStep.end,
        full: lastStep.end };
    }
  }

  var API = { run: run, replies: replies, PRICE_IN: PRICE_IN, PRICE_OUT: PRICE_OUT, CACHED: CACHED, SYSTEM: SYSTEM, USER: USER,
    STEP_OUT: STEP_OUT, TOOL_OUT: TOOL_OUT, FINAL_OUT: FINAL_OUT, TTFT0: TTFT0, PREFILL_1K: PREFILL_1K, TPOT: TPOT, TOOL_S: TOOL_S,
    MAX_STEPS: MAX_STEPS, MAX_TOKENS: MAX_TOKENS };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var W = 640, H = 230, X0 = 46, BASE = 196, TOP = 26;

  function n0(x) { return Math.round(x).toLocaleString(PT ? "pt-BR" : "en-US"); }
  function n2(x) { return x.toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function n1(x) { return x.toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

  C.style("agent-loop", [
    ".md-typeset .csim-al-bar { transition: height .3s, y .3s; }",
    ".md-typeset .csim-al-step.now .csim-al-bar { stroke: var(--c-fg); stroke-width: 1.2; }",
    ".md-typeset .csim-al-step.later { opacity: .18; }",
    ".md-typeset .csim-al-lim { stroke: var(--c-bad); stroke-width: 1.2; stroke-dasharray: 4 3; }",
    ".md-typeset .csim-log.csim-al-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; }"
  ].join("\n"));

  C.register("agent-loop", function (root) {
    var o = C.opts(root, { steps: MAX_STEPS, behaviour: "finds" });
    var cfg = { behaviour: o.behaviour === "stuck" ? "stuck" : "finds", maxSteps: o.steps, loopDetect: false, lastToolless: false, parallel: true, hit: 0.9 };
    var res, shown = 0;

    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": t("Context sent at each model call", "Contexto enviado em cada chamada ao modelo") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-al-term";
    var tiles = C.stats([
      { key: "calls", label: t("model calls", "chamadas ao modelo") },
      { key: "tokens", label: t("input tokens (all calls)", "tokens de entrada (todas as chamadas)") },
      { key: "cost", label: t("US$ per 1,000 requests", "US$ por 1.000 pedidos") },
      { key: "wait", label: t("until the fan sees a word", "até o fã ver uma palavra") },
      { key: "end", label: t("how it ended", "como terminou") }
    ]);

    var cBeh = C.choice({ label: t("Model", "Modelo"), value: cfg.behaviour, options: [
      { value: "finds", label: t("finds the seats", "acha os assentos") },
      { value: "stuck", label: t("gets stuck", "fica preso") }
    ], onChange: function (v) { cfg.behaviour = v; recompute(); } });
    var sSteps = C.slider({ label: "MAX_STEPS", min: 1, max: 12, value: cfg.maxSteps, onInput: function (v) { cfg.maxSteps = v; recompute(); } });
    var cHit = C.choice({ label: t("Prompt cache hits", "Acertos no cache de prompt"), value: cfg.hit, options: [
      { value: 0, label: "0%" }, { value: 0.5, label: "50%" }, { value: 0.9, label: "90%" }
    ], onChange: function (v) { cfg.hit = v; recompute(); } });
    var tPar = C.toggle({ label: t("parallel tool calls", "chamadas de ferramenta em paralelo"), checked: cfg.parallel, onChange: function (v) { cfg.parallel = v; recompute(); } });
    var tLoop = C.toggle({ label: t("loop detection", "detecção de loop"), checked: cfg.loopDetect, onChange: function (v) { cfg.loopDetect = v; recompute(); } });
    var tLast = C.toggle({ label: t("last call without tools (lab 12)", "última chamada sem ferramentas (lab 12)"), checked: cfg.lastToolless, onChange: function (v) { cfg.lastToolless = v; recompute(); } });

    var player = C.player({
      interval: 1100,
      onTick: function (k) { if (k > res.steps.length) return false; shown = k; draw(); return k < res.steps.length; },
      onPrev: function (k) { shown = k; draw(); },
      onReset: function () { shown = 0; draw(); }
    });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function recompute() {
      res = run(cfg);
      player.total(res.steps.length);
      shown = res.steps.length;
      player.jump(shown);
      draw();
    }

    function stepLine(st) {
      if (st.kind === "answer") return st.partial
        ? t("text: a partial answer (no tools were offered)", "texto: uma resposta parcial (nenhuma ferramenta oferecida)")
        : t("text: \"I held C12–C13 for R$280 each until 10:12. Pay here: …\"", "texto: \"Reservei C12–C13 por R$280 cada até 10:12. Pague aqui: …\"");
      return st.calls.map(function (c) { return c.name + "(" + c.args + ")"; }).join(" + ") + (st.kind === "loop" ? t("  ← repeated: not run", "  ← repetida: não executada") : "");
    }

    function ending(r) {
      return r.stop === "answer" ? (r.partial ? [t("forced answer", "resposta forçada"), "warn"] : [t("answered", "respondeu"), "ok"])
        : r.stop === "loop" ? [t("loop detected", "loop detectado"), "warn"]
        : r.stop === "tokens" ? [t("token budget", "orçamento de tokens"), "bad"]
        : [t("step limit", "limite de passos"), "bad"];
    }

    function draw() {
      C.clear(svg);
      var n = res.steps.length, maxCtx = 12000;
      res.steps.forEach(function (st) { maxCtx = Math.max(maxCtx, st.context); });
      var slot = Math.min(60, (W - X0 - 10) / Math.max(n, cfg.maxSteps, 4)), bw = slot * 0.62;
      var y = function (v) { return BASE - (BASE - TOP) * v / maxCtx; };
      /* axis */
      [0, maxCtx / 2, maxCtx].forEach(function (v) {
        svg.appendChild(s("line", { x1: X0 - 4, x2: W - 6, y1: y(v), y2: y(v), class: "c-wire" }));
        svg.appendChild(s("text", { x: X0 - 8, y: y(v) + 3, "text-anchor": "end", class: "c-small" }, n0(v)));
      });
      svg.appendChild(s("text", { x: X0 - 40, y: 12, class: "c-small" }, t("tokens sent per call (cached part lighter)", "tokens enviados por chamada (parte em cache mais clara)")));
      /* step limit marker */
      var xl = X0 + cfg.maxSteps * slot - (slot - bw) / 2 + 2;
      if (cfg.maxSteps * slot < W - X0) {
        svg.appendChild(s("line", { x1: xl, x2: xl, y1: TOP - 6, y2: BASE + 4, class: "csim-al-lim" }));
        svg.appendChild(s("text", { x: xl - 3, y: TOP - 9, "text-anchor": "end", class: "c-small c-bad" }, "MAX_STEPS = " + cfg.maxSteps));
      }
      res.steps.forEach(function (st, j) {
        var x = X0 + j * slot + (slot - bw) / 2;
        var g = s("g", { class: "csim-al-step" + (j + 1 === shown ? " now" : j + 1 > shown ? " later" : "") });
        var tone = st.kind === "answer" ? (st.partial ? "warn" : "ok") : st.kind === "loop" ? "bad" : "ink";
        g.appendChild(s("rect", { x: x, y: y(st.context), width: bw, height: BASE - y(st.context), rx: 2, class: "csim-al-bar c-fill-tint" }));
        g.appendChild(s("rect", { x: x, y: y(st.uncached), width: bw, height: BASE - y(st.uncached), rx: 2, class: "csim-al-bar c-fill-" + tone }));
        g.appendChild(s("text", { x: x + bw / 2, y: y(st.context) - 4, "text-anchor": "middle", class: "c-small" }, n0(st.context)));
        g.appendChild(s("text", { x: x + bw / 2, y: BASE + 13, "text-anchor": "middle", class: "c-small" }, String(st.i)));
        var lbl = st.kind === "answer" ? t("answer", "resposta") : st.kind === "loop" ? t("repeat", "repete") : st.calls.length > 1 ? "2 tools" : st.calls[0].name.split("_").join(" ");
        if (PT && st.kind === "tools" && st.calls.length > 1) lbl = "2 ferram.";
        g.appendChild(s("text", { x: x + bw / 2, y: BASE + 25, "text-anchor": "middle", class: "c-small" }, lbl.length > 13 ? lbl.slice(0, 13) : lbl));
        g.appendChild(s("title", {}, stepLine(st)));
        svg.appendChild(g);
      });
      /* terminal: the calls so far */
      term.clear();
      res.steps.slice(0, shown).forEach(function (st) {
        term.add(t("call ", "chamada ") + st.i + " · " + n0(st.context) + t(" tokens in", " tokens de entrada") + "\n" + stepLine(st),
          st.kind === "loop" ? "bad" : st.kind === "answer" ? (st.partial ? "warn" : "ok") : "");
      });
      /* tiles and the verdict appear when the run is complete */
      var full = shown >= n, end = ending(res);
      tiles.set("calls", String(full ? res.calls : shown), "");
      tiles.set("tokens", full ? n0(res.tokens) : "…", res.tokens > MAX_TOKENS ? "bad" : "");
      tiles.set("cost", full ? n2(res.cost * 1000) : "…", "");
      tiles.set("wait", full ? n1(res.wait) + " s" : "…", res.wait > 10 ? "warn" : "");
      tiles.set("end", full ? end[0] : "…", full ? end[1] : "");
      if (!shown) say(t("Press play or → to run the loop call by call; change a knob to re-run it.", "Aperte play ou → para rodar o loop chamada a chamada; mude um controle para rodá-lo de novo."), "");
      else if (!full) say(t("Call " + shown + ": the model sees " + n0(res.steps[shown - 1].context) + " tokens — everything so far, again.",
        "Chamada " + shown + ": o modelo recebe " + n0(res.steps[shown - 1].context) + " tokens — tudo até aqui, de novo."), "");
      else say(summary(), end[1]);
    }

    function summary() {
      var r = res, c = n2(r.cost * 1000), w = n1(r.wait);
      if (r.stop === "answer" && !r.partial) return t(
        r.calls + " model calls, " + n0(r.tokens) + " input tokens in total, US$ " + c + " per 1,000 requests; the answer starts after " + w + " s. " +
        (cfg.parallel ? "Turn parallel tool calls off: one more round." : "Parallel tool calls would save one round."),
        r.calls + " chamadas ao modelo, " + n0(r.tokens) + " tokens de entrada no total, US$ " + c + " por 1.000 pedidos; a resposta começa após " + w + " s. " +
        (cfg.parallel ? "Desligue as chamadas em paralelo: uma rodada a mais." : "Chamadas em paralelo economizariam uma rodada."));
      if (r.stop === "answer") return t(
        "The last allowed call offered no tools, so the model had to answer with what it had (" + (r.held ? "seats held" : "nothing held") + "): " + r.calls + " calls, US$ " + c + " per 1,000 requests.",
        "A última chamada permitida não ofereceu ferramentas, então o modelo teve de responder com o que tinha (" + (r.held ? "assentos reservados" : "nada reservado") + "): " + r.calls + " chamadas, US$ " + c + " por 1.000 pedidos.");
      if (r.stop === "loop") return t(
        "Call " + r.calls + " asked for the same search again: the loop stops and hands off after " + n0(r.tokens) + " input tokens, US$ " + c + " per 1,000 requests.",
        "A chamada " + r.calls + " pediu a mesma busca de novo: o loop para e passa adiante após " + n0(r.tokens) + " tokens de entrada, US$ " + c + " por 1.000 pedidos.");
      if (r.stop === "tokens") return t(
        "The token budget (" + n0(MAX_TOKENS) + ") stopped the loop after call " + r.calls + ": " + n0(r.used) + " tokens used, and the fan gets an apology after " + w + " s.",
        "O orçamento de tokens (" + n0(MAX_TOKENS) + ") parou o loop após a chamada " + r.calls + ": " + n0(r.used) + " tokens usados, e o fã recebe um pedido de desculpas após " + w + " s.");
      return t(
        "The step limit stopped the loop after " + r.calls + " calls without an answer: " + n0(r.tokens) + " input tokens, US$ " + c + " per 1,000 requests, " + w + " s to an apology.",
        "O limite de passos parou o loop após " + r.calls + " chamadas sem resposta: " + n0(r.tokens) + " tokens de entrada, US$ " + c + " por 1.000 pedidos, " + w + " s até um pedido de desculpas.");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The agent loop: every step re-sends the whole context", "O loop do agente: cada passo reenvia o contexto inteiro") }),
      el("p", { class: "csim-sub", text: t("\"Two seats under R$300 for Saturday, hold them.\" Each bar is one model call: its height is the context sent (prefix, history, tool results), the darker part what the prompt cache did not serve.",
        "\"Dois assentos abaixo de R$300 no sábado, reserve.\" Cada barra é uma chamada ao modelo: a altura é o contexto enviado (prefixo, histórico, resultados de ferramentas), a parte escura o que o cache de prompt não serviu.") }),
      el("div", { class: "csim-row" }, [cBeh, cHit]),
      el("div", { class: "csim-row" }, [sSteps, tPar, tLoop, tLast]),
      el("div", { class: "csim-stage" }, svg),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    recompute();
    return {};
  });
})();
