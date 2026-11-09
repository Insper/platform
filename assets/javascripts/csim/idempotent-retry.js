/*
 * Timeouts, retries and idempotency keys against a payment provider (2027.1, Compute — external
 * integrations, "Retries and unknown outcomes"):
 *
 *   <div class="csim" data-sim="idempotent-retry" data-key="none" data-provider="normal"></div>
 *
 * 1,000 fans press Pay once. The caller sends "create payment" to the provider with lab 9's client
 * settings (LAB: the read timeout, the number of attempts and the exponential backoff with jitter of
 * order's application.yaml) and retries only when an attempt times out. The provider's latency per
 * call is log-normal (a heavy tail; data-provider normal or slow). A call that reaches the provider is
 * processed even when the caller has already given up: the charge happens, only the answer is lost.
 *
 * Keys: "none" and "attempt" (a new key on every attempt) create one charge per call the provider
 * processes; "order" (one key per order, as lab 9's "order-<orderId>") creates at most one charge per
 * order: a repeat returns the original payment, as soon as the original call is done. A checkout whose
 * attempts all time out ends UNKNOWN (the webhook or the reconciliation resolves it).
 */
(function () {
  "use strict";

  /* lab 9: services/order/src/main/resources/application.yaml (payment client and its Resilience4j retry) */
  var LAB = { timeoutMs: 1000, attempts: 3, backoff: 200, mult: 2, jitter: 0.5 };
  /* not from a lab: the provider's latency (median in ms, log-normal sigma), the fans, the ticket price */
  var PROVIDERS = { normal: { median: 250, sigma: 0.9 }, slow: { median: 800, sigma: 0.9 } };
  var MODEL = { fans: 1000, price: 450, seed: 7 };
  var KEYS = ["none", "attempt", "order"];

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* a standard normal draw (Box-Muller) */
  function gauss(r) {
    var u = 1 - r(), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* the share of calls slower than the timeout, from the distribution itself */
  function tail(provider, timeout) {
    var p = PROVIDERS[provider], z = Math.log(timeout / p.median) / p.sigma;
    /* 1 - Φ(z), Abramowitz-Stegun 7.1.26 */
    var x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    var erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    var phi = 0.5 * (1 + (z < 0 ? -erf : erf));
    return 1 - phi;
  }

  /*
   * One run: o = {timeout, attempts, key, provider, fans, seed} (missing fields from LAB and MODEL).
   * Every fan draws the same latencies whatever the key, so the keys can be compared fan by fan.
   */
  function simulate(o) {
    o = o || {};
    var timeout = o.timeout || LAB.timeoutMs, attempts = o.attempts || LAB.attempts;
    var key = KEYS.indexOf(o.key) >= 0 ? o.key : "none";
    var p = PROVIDERS[o.provider] || PROVIDERS.normal;
    var n = o.fans || MODEL.fans, r = rng(o.seed || MODEL.seed);
    var fans = [], calls = 0, slow = 0, charges = 0, dup = 0, unknown = 0, unknownCharged = 0, wait = [];
    for (var i = 0; i < n; i++) {
      var tNow = 0, done = null, list = [], charged = [], result = "unknown";
      for (var k = 0; k < attempts; k++) {
        var d = p.median * Math.exp(p.sigma * gauss(r));
        var jit = 1 + LAB.jitter * (2 * r() - 1);
        calls++;
        if (d > timeout) slow++;
        var answer, charge = null;
        if (key === "order" && done !== null) answer = Math.max(tNow + d, done);   /* the stored payment */
        else {
          answer = tNow + d; charge = answer;
          if (key === "order") done = answer;
        }
        if (charge !== null) charged.push(charge);
        var ok = answer - tNow <= timeout;
        list.push({ start: tNow, answer: answer, charge: charge, ok: ok, end: ok ? answer : tNow + timeout });
        if (ok) { result = "ok"; tNow = answer; break; }
        tNow += timeout;
        if (k < attempts - 1) tNow += LAB.backoff * Math.pow(LAB.mult, k) * jit;
      }
      charges += charged.length;
      if (charged.length > 1) dup++;
      if (result === "unknown") { unknown++; if (charged.length) unknownCharged++; }
      wait.push(tNow);
      fans.push({ id: i + 1, attempts: list, charges: charged.length, result: result, wait: tNow });
    }
    wait.sort(function (a, b) { return a - b; });
    return {
      fans: fans, n: n, calls: calls, slowShare: slow / calls, charges: charges, duplicates: dup,
      extra: charges - n, unknown: unknown, unknownCharged: unknownCharged,
      p99: wait[Math.min(n - 1, Math.floor(0.99 * n))], maxWait: wait[n - 1]
    };
  }

  var API = { LAB: LAB, PROVIDERS: PROVIDERS, MODEL: MODEL, KEYS: KEYS, simulate: simulate, tail: tail };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  var LANES = 8, X0 = 64, X1 = 552, TOP = 22, ROW = 30;
  function n0(v) { return Math.round(v).toLocaleString(PT ? "pt-BR" : "en-US"); }
  function pct(v, d) { return (100 * v).toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) + "%"; }
  function sec(ms) { return (ms / 1000).toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " s"; }

  C.style("idempotent-retry", [
    ".md-typeset .csim-ir-try { stroke: var(--c-ink); stroke-width: 7; stroke-linecap: round; }",
    ".md-typeset .csim-ir-try.lost { stroke: var(--c-warn); }",
    ".md-typeset .csim-ir-wait { stroke: var(--c-warn); stroke-width: 1.4; stroke-dasharray: 3 3; }",
    ".md-typeset .csim-ir-to { stroke: var(--c-fg3); stroke-width: 1; stroke-dasharray: 2 3; }",
    ".md-typeset .csim-ir-charge { fill: var(--c-ok); stroke: var(--c-bg); stroke-width: 1.5; }",
    ".md-typeset .csim-ir-charge.dup { fill: var(--c-bad); }",
    ".md-typeset .csim-ir-row.dup text.c-label { fill: var(--c-bad); }",
    ".md-typeset .csim-ir-key { display: flex; flex-wrap: wrap; gap: .3rem 1rem; color: var(--c-fg2); margin: .2rem 0; }",
    ".md-typeset .csim-ir-key i { display: inline-block; width: .9rem; height: .45rem; border-radius: .2rem; margin-right: .3rem; vertical-align: .05rem; }",
    ".md-typeset .csim-ir-key .ok i { background: var(--c-ink); } .md-typeset .csim-ir-key .lost i { background: var(--c-warn); }",
    ".md-typeset .csim-ir-key .ch i, .md-typeset .csim-ir-key .dup i { width: .6rem; height: .6rem; border-radius: 50%; background: var(--c-ok); }",
    ".md-typeset .csim-ir-key .dup i { background: var(--c-bad); }"
  ].join("\n"));

  C.register("idempotent-retry", function (root) {
    var o = C.opts(root, { key: "none", provider: "normal" });
    var state = { key: KEYS.indexOf(o.key) >= 0 ? o.key : "none", provider: PROVIDERS[o.provider] ? o.provider : "normal",
      timeout: LAB.timeoutMs, attempts: LAB.attempts };

    var svg = s("svg", { viewBox: "0 0 600 " + (TOP + LANES * ROW + 24), role: "img",
      "aria-label": t("Attempts of eight fans over time", "Tentativas de oito fãs ao longo do tempo") });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "slow", label: t("calls slower than the timeout", "chamadas mais lentas que o timeout") },
      { key: "calls", label: t("calls to the provider", "chamadas ao provedor") },
      { key: "dup", label: t("fans charged twice or more", "fãs cobrados duas vezes ou mais") },
      { key: "extra", label: t("extra charges", "cobranças a mais") },
      { key: "unk", label: t("checkouts left UNKNOWN", "checkouts em UNKNOWN") }
    ]);

    var cKey = C.choice({ label: t("Idempotency key", "Chave de idempotência"), value: state.key,
      options: [
        { value: "none", label: t("none", "nenhuma") },
        { value: "attempt", label: t("new per attempt", "nova por tentativa") },
        { value: "order", label: t("one per order", "uma por pedido"), title: "order-<orderId>" }
      ], onChange: function (v) { state.key = v; draw(); } });
    var cProv = C.choice({ label: t("Provider", "Provedor"), value: state.provider,
      options: [
        { value: "normal", label: t("normal", "normal"), title: t("median 250 ms", "mediana 250 ms") },
        { value: "slow", label: t("slow day", "dia lento"), title: t("median 800 ms", "mediana 800 ms") }
      ], onChange: function (v) { state.provider = v; draw(); } });
    var sTo = C.slider({ label: t("Timeout", "Timeout"), min: 250, max: 6000, step: 250, value: state.timeout, fmt: sec,
      onInput: function (v) { state.timeout = v; draw(); } });
    var sAt = C.slider({ label: t("Attempts", "Tentativas"), min: 1, max: 5, value: state.attempts,
      onInput: function (v) { state.attempts = v; draw(); } });
    var bLab = C.button(t("lab 9's settings", "valores do lab 9"), function () {
      state.timeout = LAB.timeoutMs; state.attempts = LAB.attempts; sTo.set(state.timeout); sAt.set(state.attempts); draw();
    });

    /* the lanes: first the fans whose first call timed out, so the interesting cases are visible */
    function sample(run) {
      var hit = run.fans.filter(function (f) { return !f.attempts[0].ok; });
      var calm = run.fans.filter(function (f) { return f.attempts[0].ok; });
      return calm.slice(0, 2).concat(hit.slice(0, LANES - 2)).slice(0, LANES).sort(function (a, b) { return a.id - b.id; });
    }

    function draw() {
      var run = simulate(state);
      var fans = sample(run);
      var span = 0;
      fans.forEach(function (f) { f.attempts.forEach(function (a) { span = Math.max(span, a.end, a.answer); }); });
      span = Math.max(span, state.timeout * 1.2);
      var X = function (ms) { return X0 + (X1 - X0) * Math.min(1, ms / span); };
      C.clear(svg);
      /* time axis */
      var step = span > 8000 ? 2000 : span > 3000 ? 1000 : 500;
      for (var g = 0; g <= span; g += step) {
        svg.appendChild(s("line", { x1: X(g), x2: X(g), y1: TOP - 6, y2: TOP + LANES * ROW, class: "c-wire" }));
        svg.appendChild(s("text", { x: X(g), y: TOP + LANES * ROW + 14, "text-anchor": "middle", class: "c-small" }, sec(g)));
      }
      svg.appendChild(s("text", { x: X1, y: TOP - 10, "text-anchor": "end", class: "c-small" }, t("time since Pay →", "tempo desde o Pagar →")));
      fans.forEach(function (f, i) {
        var y = TOP + i * ROW + ROW / 2;
        var g = s("g", { class: "csim-ir-row" + (f.charges > 1 ? " dup" : "") });
        g.appendChild(s("text", { x: 4, y: y + 4, class: "c-label" }, t("fan ", "fã ") + f.id));
        var first = true;
        f.attempts.forEach(function (a) {
          /* the timeout of this attempt, a dotted tick */
          if (!a.ok) g.appendChild(s("line", { x1: X(a.end), x2: X(a.end), y1: y - 10, y2: y + 10, class: "csim-ir-to" }));
          g.appendChild(s("line", { x1: X(a.start), x2: Math.max(X(a.start) + 1, X(a.end)), y1: y, y2: y, class: "csim-ir-try" + (a.ok ? "" : " lost") }));
          if (!a.ok && a.answer > a.end) g.appendChild(s("line", { x1: X(a.end), x2: X(a.answer), y1: y + 7, y2: y + 7, class: "csim-ir-wait" }));
          if (a.charge !== null) {
            var c = s("circle", { cx: X(a.charge), cy: y + 7, r: 4.5, class: "csim-ir-charge" + (first ? "" : " dup") });
            c.appendChild(s("title", {}, (first ? t("charge", "cobrança") : t("second charge", "segunda cobrança")) + " @ " + sec(a.charge)));
            g.appendChild(c);
            first = false;
          }
          if (a.ok) g.appendChild(s("text", { x: X(a.end) + 6, y: y + 4, class: "c-small" }, "✓"));
        });
        if (f.result === "unknown") {
          var last = f.attempts[f.attempts.length - 1];
          g.appendChild(s("text", { x: X(last.end) + 6, y: y + 4, class: "c-small" }, "UNKNOWN"));
        }
        svg.appendChild(g);
      });

      var share = tail(state.provider, state.timeout);
      st.set("slow", pct(share, 1), share > 0.1 ? "bad" : share > 0.02 ? "warn" : "ok");
      st.set("calls", n0(run.calls) + t(" for ", " para ") + n0(run.n), run.calls > 1.2 * run.n ? "warn" : "");
      st.set("dup", n0(run.duplicates), run.duplicates ? "bad" : "ok");
      st.set("extra", "R$ " + n0(run.extra * MODEL.price), run.extra ? "bad" : "ok");
      st.set("unk", n0(run.unknown), run.unknown ? "warn" : "ok");

      var msg, tone;
      if (state.key === "order") {
        msg = t("One key per order: every repeat returns the original payment, so nobody pays twice. " +
          (run.unknown ? n0(run.unknown) + " checkout(s) still end UNKNOWN, each charged once: the fan sees \"confirming your payment\" and the webhook or the reconciliation settles it." : "No checkout is left UNKNOWN."),
          "Uma chave por pedido: cada repetição devolve o pagamento original, então ninguém paga duas vezes. " +
          (run.unknown ? n0(run.unknown) + " checkout(s) ainda terminam em UNKNOWN, cada um cobrado uma vez: o fã vê \"confirmando seu pagamento\" e o webhook ou a reconciliação resolve." : "Nenhum checkout fica em UNKNOWN."));
        tone = "ok";
      } else if (state.attempts === 1) {
        msg = t("No retries: no duplicate charge, but every call slower than the timeout leaves the fan UNKNOWN (" + n0(run.unknown) + " fans), although the provider charged each of them.",
          "Sem novas tentativas: nenhuma cobrança dupla, mas cada chamada mais lenta que o timeout deixa o fã em UNKNOWN (" + n0(run.unknown) + " fãs), embora o provedor tenha cobrado cada um deles.");
        tone = run.unknown ? "warn" : "ok";
      } else {
        msg = t((state.key === "attempt" ? "A new key on every attempt deduplicates nothing: the numbers are those of no key. " : "") +
          "Each timeout is followed by a retry, but the slow call was still processed: " + n0(run.duplicates) + " fans paid twice or more (R$ " + n0(run.extra * MODEL.price) + " to refund).",
          (state.key === "attempt" ? "Uma chave nova a cada tentativa não deduplica nada: os números são os de sem chave. " : "") +
          "Cada timeout é seguido de uma nova tentativa, mas a chamada lenta foi processada mesmo assim: " + n0(run.duplicates) + " fãs pagaram duas vezes ou mais (R$ " + n0(run.extra * MODEL.price) + " a estornar).");
        tone = run.duplicates ? "bad" : "ok";
      }
      note.textContent = msg;
      note.className = "csim-note csim-" + tone;
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("A timeout is not a failure: retries and idempotency keys", "Timeout não é falha: novas tentativas e chaves de idempotência") }),
      el("p", { class: "csim-sub", text: t("1,000 fans press Pay once. Each lane is one fan's calls to the provider; dots are charges the provider made.",
        "1.000 fãs apertam Pagar uma vez. Cada faixa são as chamadas de um fã ao provedor; os pontos são as cobranças que o provedor fez.") }),
      el("div", { class: "csim-row" }, [cKey, cProv]),
      el("div", { class: "csim-row" }, [sTo, sAt, bLab]),
      el("div", { class: "csim-cols" }, [
        el("div", { class: "csim-stage" }, [svg, el("div", { class: "csim-ir-key" }, [
          el("span", { class: "ok" }, [el("i"), t("answered in time", "respondida a tempo")]),
          el("span", { class: "lost" }, [el("i"), t("timed out (the provider keeps going: dashed)", "timeout (o provedor continua: tracejado)")]),
          el("span", { class: "ch" }, [el("i"), t("charge", "cobrança")]),
          el("span", { class: "dup" }, [el("i"), t("duplicate charge", "cobrança duplicada")])
        ])]),
        el("div", {}, [st])
      ]),
      note
    ]);
    draw();
    return {};
  });
})();
