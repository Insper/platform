/*
 * Rate-limiting algorithms (2027.1, case study — rate limiter):
 *
 *   <div class="csim" data-sim="rate-limiter" data-pattern="boundary" data-algo="fixed"></div>
 *
 * One API key sends a traffic pattern for 5 s (steady, bursty, or a burst straddling a window
 * boundary); the chosen algorithm (token bucket, leaky bucket, fixed window, sliding window log,
 * sliding window counter) accepts or rejects each request with 429. The time axis shows every
 * request, when it reaches the backend, and the limiter's state (tokens, queue, window count)
 * drawn live; the stats count accepted/rejected and the busiest 1-second span the backend saw.
 * The limit and the burst default to lab 3's Nginx (LAB below; data-limit / data-burst override them).
 */
(function () {
  "use strict";

  var T = 5000, W = 1000, STEP = 10;
  /* lab 3, infra/nginx/nginx.conf: limit_req_zone … rate (req/s per API key) and limit_req … burst */
  var LAB = { limit: 20, burst: 40 };
  var ALGOS = ["token", "leaky", "fixed", "log", "counter"];
  var PATTERNS = ["steady", "bursty", "boundary"];

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function poisson(r, perSec, from, to, out) {
    var t = from;
    for (;;) {
      t += -Math.log(1 - r()) * 1000 / perSec;
      if (t >= to) return out;
      out.push(Math.round(t));
    }
  }
  function evenly(n, from, to, out) {
    for (var i = 0; i < n; i++) out.push(Math.round(from + (to - from) * i / Math.max(1, n - 1)));
    return out;
  }

  /* request times (ms) for 5 s; L = the limit in req/s */
  function pattern(name, L, seed) {
    var r = rng(seed || 11), out = [];
    if (name === "steady") {                       /* 1.5× the limit, evenly spread */
      var gap = 1000 / (1.5 * L);
      for (var t = gap / 2; t < T; t += gap) out.push(Math.round(t + (r() - 0.5) * gap * 0.4));
    } else if (name === "bursty") {                /* quiet, then 1.5 L requests in 200 ms, three times */
      poisson(r, 0.4 * L, 0, T, out);
      [500, 2000, 3500].forEach(function (s) { evenly(Math.round(1.5 * L), s, s + 200, out); });
    } else {                                       /* quiet, then L requests just before and L just after the 1 s and 3 s boundaries */
      poisson(r, 0.3 * L, 1200, 2000, out);
      poisson(r, 0.3 * L, 3200, T, out);
      [1000, 3000].forEach(function (b) { evenly(L, b - 100, b - 10, out); evenly(L, b + 10, b + 100, out); });
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /* a limiter: allow(t) → {ok, out} (out = when the request reaches the backend), level(t), cap */
  function limiter(algo, L, burst) {
    var rate = L / 1000;
    if (algo === "token") {
      var tokens = burst, tl = 0;
      var fill = function (t) { tokens = Math.min(burst, tokens + (t - tl) * rate); tl = t; };
      return { cap: burst, level: function (t) { return Math.min(burst, tokens + (t - tl) * rate); },
        allow: function (t) { fill(t); if (tokens >= 1) { tokens -= 1; return { ok: true, out: t }; } return { ok: false }; } };
    }
    if (algo === "leaky") {                         /* a FIFO of size burst, drained at the rate */
      var water = 0, wl = 0;
      var drain = function (t) { water = Math.max(0, water - (t - wl) * rate); wl = t; };
      return { cap: burst, level: function (t) { return Math.max(0, water - (t - wl) * rate); },
        allow: function (t) {
          drain(t);
          if (water + 1 > burst + 1e-9) return { ok: false };
          var out = t + water / rate;
          water += 1;
          return { ok: true, out: Math.round(out) };
        } };
    }
    if (algo === "fixed") {
      var counts = {};
      return { cap: L, level: function (t) { return counts[Math.floor(t / W)] || 0; },
        allow: function (t) {
          var w = Math.floor(t / W);
          if ((counts[w] || 0) < L) { counts[w] = (counts[w] || 0) + 1; return { ok: true, out: t }; }
          return { ok: false };
        } };
    }
    if (algo === "log") {
      var logged = [];
      var inWin = function (t) { var n = 0; for (var i = logged.length - 1; i >= 0 && logged[i] > t - W; i--) n++; return n; };
      return { cap: L, level: inWin,
        allow: function (t) { if (inWin(t) < L) { logged.push(t); return { ok: true, out: t }; } return { ok: false }; } };
    }
    var cnt = {};                                   /* sliding window counter */
    var est = function (t) {
      var w = Math.floor(t / W);
      return (cnt[w - 1] || 0) * (1 - (t % W) / W) + (cnt[w] || 0);
    };
    return { cap: L, level: est,
      allow: function (t) {
        if (est(t) < L) { var w = Math.floor(t / W); cnt[w] = (cnt[w] || 0) + 1; return { ok: true, out: t }; }
        return { ok: false };
      } };
  }

  /* run the whole pattern: per request {t, ok, out}, and the limiter's level every 10 ms */
  function simulate(algo, times, L, burst) {
    var lim = limiter(algo, L, burst), res = [], samples = [], i = 0;
    for (var g = 0; g <= T; g += STEP) {
      while (i < times.length && times[i] <= g) {
        var a = lim.allow(times[i]);
        res.push({ t: times[i], ok: a.ok, out: a.ok ? a.out : null });
        i++;
      }
      samples.push(lim.level(g));
    }
    return { res: res, samples: samples, cap: lim.cap };
  }

  /* busiest 1-second span of the times ≤ until: {n, from, to}; among equals, the tightest */
  function maxSpan(times, until) {
    var ts = times.filter(function (x) { return x <= until; }).sort(function (a, b) { return a - b; });
    var best = { n: 0, from: 0, to: 0 }, j = 0;
    for (var i = 0; i < ts.length; i++) {
      while (ts[i] - ts[j] >= W) j++;
      var n = i - j + 1;
      if (n > best.n || (n === best.n && ts[i] - ts[j] < best.to - best.from)) best = { n: n, from: ts[j], to: ts[i] };
    }
    return best;
  }

  /* totals up to time `until` */
  function summary(run, until) {
    var acc = 0, rej = 0, outs = [], wait = 0;
    run.res.forEach(function (q) {
      if (q.t > until) return;
      if (q.ok) { acc++; if (q.out <= until) outs.push(q.out); wait = Math.max(wait, q.out - q.t); } else rej++;
    });
    var span = maxSpan(outs, until);
    return { accepted: acc, rejected: rej, maxSpan: span.n, spanFrom: span.from, spanTo: span.to, maxWait: wait };
  }

  var API = { LAB: LAB, pattern: pattern, limiter: limiter, simulate: simulate, maxSpan: maxSpan, summary: summary, ALGOS: ALGOS, PATTERNS: PATTERNS, T: T };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var X0 = 34, X1 = 392, TICK = 50;
  var NAMES = { token: t("token bucket", "token bucket"), leaky: t("leaky bucket", "leaky bucket"), fixed: t("fixed window", "janela fixa"),
    log: t("sliding log", "log deslizante"), counter: t("sliding counter", "contador deslizante") };
  var PNAMES = { steady: t("steady 1.5×", "constante 1,5×"), bursty: t("bursts", "rajadas"), boundary: t("burst at a boundary", "rajada na fronteira") };
  var LEVEL = { token: t("tokens", "tokens"), leaky: t("in the queue", "na fila"), fixed: t("in this window", "nesta janela"),
    log: t("in the last 1 s", "no último 1 s"), counter: t("estimate", "estimativa") };

  function x(tm) { return X0 + (X1 - X0) * tm / T; }
  function sec(ms) { return (ms / 1000).toFixed(2).replace(".", C.PT ? "," : ".") + " s"; }

  C.style("rate-limiter", [
    ".md-typeset .csim-rl-ok { stroke: var(--c-ok); stroke-width: 1.4; }",
    ".md-typeset .csim-rl-bad { stroke: var(--c-bad); stroke-width: 1.4; }",
    ".md-typeset .csim-rl-out { stroke: var(--c-ink); stroke-width: 1.4; }",
    ".md-typeset .csim-rl-area { fill: color-mix(in srgb, var(--c-ink) 22%, var(--c-bg)); stroke: var(--c-ink); stroke-width: 1.5; }",
    ".md-typeset .csim-rl-span { fill: color-mix(in srgb, var(--c-warn) 18%, var(--c-bg)); stroke: var(--c-warn); stroke-width: 1; }",
    ".md-typeset .csim-rl-cur { stroke: var(--c-accent); stroke-width: 1.5; }",
    ".md-typeset .csim-rl-win { stroke: var(--c-line); stroke-width: 1; stroke-dasharray: 3 3; }",
    ".md-typeset .csim-rl-win.on { stroke: var(--c-fg3); }",
    ".md-typeset .csim-rl-cap { stroke: var(--c-bad); stroke-width: 1; stroke-dasharray: 4 3; }"
  ].join("\n"));

  C.register("rate-limiter", function (root) {
    var o = C.opts(root, { limit: LAB.limit, burst: LAB.burst, pattern: "boundary", algo: "fixed" });
    var L = o.limit, burst = o.burst, pat = o.pattern, algo = o.algo, now = 0, run;
    var times;

    var svg = s("svg", { viewBox: "0 0 400 222", role: "img", "aria-label": t("Requests over time", "Requisições no tempo") });
    var note = el("p", { class: "csim-note" });
    var st = C.stats([
      { key: "acc", label: t("accepted", "aceitas") },
      { key: "rej", label: t("rejected (429)", "rejeitadas (429)") },
      { key: "span", label: t("max in any 1 s (backend)", "máx. em 1 s qualquer (backend)") },
      { key: "lvl", label: LEVEL[algo] }
    ]);
    var pChoice = C.choice({ label: t("Traffic", "Tráfego"), value: pat,
      options: PATTERNS.map(function (p) { return { value: p, label: PNAMES[p] }; }),
      onChange: function (v) { pat = v; rebuild(); } });
    var aChoice = C.choice({ label: t("Algorithm", "Algoritmo"), value: algo,
      options: ALGOS.map(function (a) { return { value: a, label: NAMES[a] }; }),
      onChange: function (v) { algo = v; rebuild(); } });
    var cap = C.slider({ label: t("Bucket capacity", "Capacidade do balde"), min: 1, max: 60, value: burst,
      fmt: function (v) { return v + (v === LAB.burst ? t(" (lab)", " (lab)") : ""); },
      onInput: function (v) { burst = v; rebuild(); } });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function rebuild() {
      times = pattern(pat, L, 11);
      run = simulate(algo, times, L, burst);
      cap.style.opacity = algo === "token" || algo === "leaky" ? 1 : 0.45;
      draw();
    }

    function narrate(sm) {
      if (now === 0) return say(t("Limit: " + L + " requests/s per API key. Press play to send the " + PNAMES[pat] + " traffic through the " + NAMES[algo] + ".",
        "Limite: " + L + " requisições/s por chave de API. Aperte play para mandar o tráfego “" + PNAMES[pat] + "” pelo " + NAMES[algo] + "."), "");
      var end = now >= T, k = sm.maxSpan;
      if (!end) return say(t(sm.accepted + " accepted and " + sm.rejected + " rejected so far; the busiest 1 s the backend has seen had " + k + " requests (limit " + L + ").",
        sm.accepted + " aceitas e " + sm.rejected + " rejeitadas até agora; o 1 s mais movimentado que o backend viu teve " + k + " requisições (limite " + L + ")."), k > L * 1.05 ? "warn" : "");
      if (algo === "fixed" && k >= 1.5 * L) return say(t("The fixed window let " + k + " requests through in " + sec(sm.spanTo - sm.spanFrom) + " — " + (k / L).toFixed(1) + "× the limit: those at the end of one window and those at the start of the next count against different windows.",
        "A janela fixa deixou passar " + k + " requisições em " + sec(sm.spanTo - sm.spanFrom) + " — " + (k / L).toFixed(1).replace(".", ",") + "× o limite: as do fim de uma janela e as do começo da seguinte contam em janelas diferentes."), "bad");
      if (algo === "token") return say(t("The token bucket started full: it let a burst of up to " + burst + " through at once, then only the refill of " + L + "/s. Busiest second: " + k + ". The burst is a setting (Nginx's burst), not an accident.",
        "O token bucket começou cheio: deixou passar de uma vez uma rajada de até " + burst + ", depois só a recarga de " + L + "/s. Segundo mais movimentado: " + k + ". A rajada é uma configuração (o burst do Nginx), não um acidente."), k > L * 1.05 ? "warn" : "ok");
      if (algo === "leaky") return say(t("The leaky bucket queued up to " + burst + " requests and released them at a steady " + L + "/s: the backend never saw more than " + k + " in a second, but some requests waited " + sec(sm.maxWait) + ".",
        "O leaky bucket enfileirou até " + burst + " requisições e as liberou a " + L + "/s constantes: o backend nunca viu mais que " + k + " em um segundo, mas algumas requisições esperaram " + sec(sm.maxWait) + "."), "ok");
      return say(t(NAMES[algo][0].toUpperCase() + NAMES[algo].slice(1) + ": the busiest 1-second span had " + k + " requests for a limit of " + L + (algo === "counter" ? " — the estimate assumes the previous window was evenly spread, a small error." : " — exact, at the price of one entry per request."),
        NAMES[algo][0].toUpperCase() + NAMES[algo].slice(1) + ": o trecho de 1 s mais movimentado teve " + k + " requisições para um limite de " + L + (algo === "counter" ? " — a estimativa supõe a janela anterior uniforme, um erro pequeno." : " — exato, ao custo de uma entrada por requisição.")),
        k > L * 1.05 ? "warn" : "ok");
    }

    function draw() {
      C.clear(svg);
      var sm = summary(run, now), windowed = algo === "fixed" || algo === "counter" || algo === "log";
      /* seconds grid (window boundaries) */
      for (var w = 0; w <= T; w += W) {
        svg.appendChild(s("line", { x1: x(w), x2: x(w), y1: 8, y2: 196, class: "csim-rl-win" + (algo === "fixed" || algo === "counter" ? " on" : "") }));
        svg.appendChild(s("text", { x: x(w), y: 208, "text-anchor": "middle", class: "c-small" }, (w / 1000) + " s"));
      }
      [[26, t("✓ ok", "✓ ok")], [52, "429"], [82, "backend"]].forEach(function (r) {
        svg.appendChild(s("text", { x: X0 - 4, y: r[0] + 3, "text-anchor": "end", class: "c-small" }, r[1]));
      });
      /* busiest second seen by the backend */
      if (sm.maxSpan) {
        svg.appendChild(s("rect", { x: x(sm.spanFrom) - 3, y: 71, width: x(sm.spanTo) - x(sm.spanFrom) + 6, height: 22, rx: 3, class: "csim-rl-span" }));
        svg.appendChild(s("text", { x: x(sm.spanFrom) - 3, y: 102, class: "c-small c-warn" }, sm.maxSpan + t(" in ", " em ") + sec(sm.spanTo - sm.spanFrom)));
      }
      run.res.forEach(function (q) {
        if (q.t > now) return;
        var px = x(q.t);
        if (q.ok) svg.appendChild(s("line", { x1: px, x2: px, y1: 18, y2: 34, class: "csim-rl-ok" }));
        else svg.appendChild(s("line", { x1: px, x2: px, y1: 44, y2: 60, class: "csim-rl-bad" }));
        if (q.ok && q.out <= now) svg.appendChild(s("line", { x1: x(q.out), x2: x(q.out), y1: 76, y2: 88, class: "csim-rl-out" }));
      });
      /* limiter state */
      var top = 116, bot = 190, capY = top + 9, n = Math.floor(now / 10);
      var scale = function (v) { return bot - (bot - capY) * Math.min(1.2, v / run.cap); };
      var pts = [X0 + "," + bot];
      for (var i = 0; i <= n && i < run.samples.length; i++) pts.push(x(i * 10).toFixed(1) + "," + scale(run.samples[i]).toFixed(1));
      pts.push(x(Math.min(now, T)).toFixed(1) + "," + bot);
      svg.appendChild(s("polygon", { points: pts.join(" "), class: "csim-rl-area" }));
      svg.appendChild(s("line", { x1: X0, x2: X1, y1: bot, y2: bot, class: "c-wire" }));
      svg.appendChild(s("line", { x1: X0, x2: X1, y1: capY, y2: capY, class: "csim-rl-cap" }));
      svg.appendChild(s("text", { x: X0 - 4, y: capY + 3, "text-anchor": "end", class: "c-small c-bad" }, String(run.cap)));
      svg.appendChild(s("text", { x: X0 - 4, y: bot + 3, "text-anchor": "end", class: "c-small" }, "0"));
      svg.appendChild(s("text", { x: X0 + 3, y: top, class: "c-small" }, NAMES[algo] + ": " + LEVEL[algo] +
        (windowed ? t(" (limit ", " (limite ") + L + ")" : t(" (capacity ", " (capacidade ") + run.cap + ")")));
      svg.appendChild(s("line", { x1: x(now), x2: x(now), y1: 8, y2: 196, class: "csim-rl-cur" }));

      var lvl = run.samples[Math.min(run.samples.length - 1, n)];
      st.set("acc", String(sm.accepted), sm.accepted ? "ok" : "");
      st.set("rej", String(sm.rejected), sm.rejected ? "bad" : "");
      st.set("span", String(sm.maxSpan), sm.maxSpan > 1.5 * L ? "bad" : sm.maxSpan > 1.05 * L ? "warn" : sm.maxSpan ? "ok" : "");
      st.set("lvl", (Math.round(lvl * 10) / 10).toString().replace(".", C.PT ? "," : ".") + " / " + run.cap, "");
      st.querySelectorAll(".csim-stat span")[3].textContent = LEVEL[algo];
      narrate(sm);
    }

    var bar = C.player({ interval: 120,
      onTick: function (k) { now = k * TICK; draw(); },
      onReset: function () { now = 0; draw(); },
      label: function (k) { return "t = " + sec(k * TICK); } });
    bar.total(T / TICK);

    C.add(root, [
      el("p", { class: "csim-title", text: t("How many requests does each algorithm really let through?", "Quantas requisições cada algoritmo deixa passar de verdade?") }),
      el("p", { class: "csim-sub", text: t("One API key, limit " + L + " requests/s. Top: each request, accepted or rejected, and when it reaches the backend. Bottom: the limiter's state.",
        "Uma chave de API, limite de " + L + " requisições/s. Em cima: cada requisição, aceita ou rejeitada, e quando chega ao backend. Embaixo: o estado do limitador.") }),
      el("div", { class: "csim-row" }, [pChoice]),
      el("div", { class: "csim-row" }, [aChoice]),
      el("div", { class: "csim-row" }, [cap]),
      el("div", { class: "csim-stage" }, svg),
      st,
      note,
      bar
    ]);
    rebuild();
    return {};
  });
})();
