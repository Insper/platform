/*
 * News-feed fan-out (2027.1, class 16 — case study "news feed", section 6.1):
 *
 *   <div class="csim" data-sim="feed-fanout" data-strategy="push" data-workers="20" data-threshold="100000"></div>
 *
 * Twenty minutes of the fan-out queue, 10 s per step. Posts arrive at the page's average rate
 * (230 posts/s × 200 followers = 46,000 timeline inserts/s) and, at t = 60 s, an account with
 * 50 M followers posts. With push, that post is 50 M inserts in the same FIFO queue as everybody
 * else's: ordinary posts wait behind it. With the hybrid, authors above the threshold are not
 * pushed (the share of inserts they cause is the page's table) and readers pull them; with pull,
 * nothing is pushed and every feed open reads all 200 followees.
 */
(function () {
  "use strict";

  /* the page's estimates (section 2) */
  var POSTS_S = 230, AVG_FOLLOWERS = 200, PEAK_OPENS = 35000, FOLLOWS = 200;
  /* share of push inserts caused by authors at or above each threshold (the table of section 6.1) */
  var AVOIDED = { 10000: 0.916, 100000: 0.839, 1000000: 0.712 };
  /* an illustrative reader: of the 200 accounts followed, how many are at or above each threshold */
  var CELEBS = { 10000: 12, 100000: 9, 1000000: 7 };
  var PER_WORKER = 5000;          /* timeline inserts/s one fan-out worker writes */
  var DT = 10, DURATION = 1200;   /* seconds per step, seconds shown */
  var BIG = 50000000, BIG_AT = 60; /* the celebrity post of the script */
  var STRATEGIES = ["push", "hybrid", "pull"];

  function capacity(workers) { return workers * PER_WORKER; }

  /* inserts/s from the steady stream of posts */
  function baseRate(strategy, threshold) {
    if (strategy === "pull") return 0;
    var r = POSTS_S * AVG_FOLLOWERS;
    return strategy === "hybrid" ? r * (1 - AVOIDED[threshold]) : r;
  }

  /* inserts added by one post of an author with `followers` */
  function burst(strategy, threshold, followers) {
    if (strategy === "pull") return 0;
    if (strategy === "hybrid" && followers >= threshold) return 0;
    return followers;
  }

  /* reads per feed open: the timeline, plus each followed celebrity (hybrid), or every followee (pull) */
  function readsPerOpen(strategy, threshold) {
    if (strategy === "push") return 1;
    if (strategy === "hybrid") return 1 + CELEBS[threshold];
    return FOLLOWS;
  }

  /*
   * One step of the FIFO queue. `extra` inserts arrive at the start of the step; `delay` is how long
   * a post enqueued right then waits for its fan-out to finish (everything ahead of it, at capacity).
   */
  function step(backlog, p, extra) {
    var cap = capacity(p.workers), rate = baseRate(p.strategy, p.threshold);
    var b = backlog + (extra || 0);
    var delay = cap ? b / cap : Infinity;
    return { before: b, delay: delay, backlog: Math.max(0, b + (rate - cap) * DT) };
  }

  /* how long the queue takes to drain a burst once it lands (Infinity if it never does) */
  function clearTime(p, inserts) {
    var net = capacity(p.workers) - baseRate(p.strategy, p.threshold);
    if (!inserts) return 0;
    return net > 0 ? inserts / net : Infinity;
  }

  /* the scripted run: steps of DT seconds, the big post at BIG_AT */
  function simulate(p) {
    var backlog = 0, out = [], peak = 0, worst = 0;
    for (var t = 0; t < DURATION; t += DT) {
      var extra = t === BIG_AT ? burst(p.strategy, p.threshold, BIG) : 0;
      var r = step(backlog, p, extra);
      peak = Math.max(peak, r.before); worst = Math.max(worst, r.delay);
      out.push({ t: t, backlog: r.before, delay: r.delay });
      backlog = r.backlog;
    }
    var b = burst(p.strategy, p.threshold, BIG);
    return { series: out, peak: peak, worstDelay: worst, clear: clearTime(p, b), inserts: b,
      rate: baseRate(p.strategy, p.threshold), reads: readsPerOpen(p.strategy, p.threshold) };
  }

  var API = { POSTS_S: POSTS_S, AVG_FOLLOWERS: AVG_FOLLOWERS, PEAK_OPENS: PEAK_OPENS, FOLLOWS: FOLLOWS, AVOIDED: AVOIDED,
    CELEBS: CELEBS, PER_WORKER: PER_WORKER, DT: DT, DURATION: DURATION, BIG: BIG, BIG_AT: BIG_AT, STRATEGIES: STRATEGIES,
    capacity: capacity, baseRate: baseRate, burst: burst, readsPerOpen: readsPerOpen, step: step, clearTime: clearTime, simulate: simulate };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var STEPS = DURATION / DT;

  function n(v) { return Math.round(v).toLocaleString(C.PT ? "pt-BR" : "en"); }
  function big(v) {
    if (v >= 1e6) { var x = (v / 1e6).toFixed(v >= 1e7 ? 0 : 1); return (C.PT ? x.replace(".", ",") : x) + " M"; }
    if (v >= 1e4) return Math.round(v / 1e3) + (C.PT ? " mil" : " k");
    return n(v);
  }
  function dur(sec) {
    if (!isFinite(sec)) return t("never", "nunca");
    if (sec < 1) return "< 1 s";
    if (sec < 120) return Math.round(sec) + " s";
    if (sec < 7200) return Math.round(sec / 60) + " min";
    var h = (sec / 3600).toFixed(1);
    return (C.PT ? h.replace(".", ",") : h) + " h";
  }
  function tag(v) { return v >= 1e6 ? (v / 1e6) + " M" : (v / 1e3) + (C.PT ? " mil" : " k"); }

  C.style("feed-fanout", [
    ".md-typeset .csim-ff-track { fill: var(--c-panel); stroke: var(--c-line); }",
    ".md-typeset .csim-ff-fill { fill: var(--c-ink); transition: width .15s linear; }",
    ".md-typeset .csim-ff-fill.warn { fill: var(--c-warn); }",
    ".md-typeset .csim-ff-fill.bad { fill: var(--c-bad); }",
    ".md-typeset .csim-ff-worker { fill: var(--c-bg); stroke: var(--c-fg3); }",
    ".md-typeset .csim-ff-worker.busy { fill: var(--c-ink); stroke: var(--c-ink); }",
    ".md-typeset .csim .csim-ff-wire.hot { stroke: var(--c-bad); stroke-width: 3; }",
    ".md-typeset .csim .csim-ff-wire.off { stroke-dasharray: 4 4; opacity: .5; }"
  ].join("\n"));

  C.register("feed-fanout", function (root) {
    var o = C.opts(root, { strategy: "push", workers: 20, threshold: 100000 });
    var p = { strategy: STRATEGIES.indexOf(o.strategy) >= 0 ? o.strategy : "push", workers: o.workers,
      threshold: AVOIDED[o.threshold] ? o.threshold : 100000 };
    var backlog = 0, stepNo = 0, last = null, peakDelay = 0, extraNext = 0, lastBurst = null;

    var svg = s("svg", { viewBox: "0 0 540 178", role: "img", "aria-label": t("Fan-out queue, workers and timelines", "Fila de fan-out, workers e timelines") });
    var note = el("p", { class: "csim-note" });
    var tiles = C.stats([
      { key: "rate", label: t("inserts/s from posts (average)", "inserções/s dos posts (média)") },
      { key: "backlog", label: t("inserts waiting in the queue", "inserções esperando na fila") },
      { key: "delay", label: t("an ordinary post reaches its followers after", "um post comum chega aos seguidores após") },
      { key: "reads", label: t("reads per feed open (at the peak)", "leituras por abertura do feed (no pico)"),
        title: t("× 35,000 feed opens/s at the peak", "× 35.000 aberturas do feed/s no pico") }
    ]);
    var chart = C.chart({ title: t("How late an ordinary post is (seconds)", "Atraso de um post comum (segundos)"), len: STEPS,
      series: [{ label: t("fan-out delay", "atraso do fan-out"), cls: "tone-bad" }] });
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var strat = C.choice({
      label: t("Strategy", "Estratégia"), value: p.strategy,
      options: [{ value: "push", label: t("push (on write)", "push (na escrita)") }, { value: "hybrid", label: t("hybrid", "híbrido") },
        { value: "pull", label: t("pull (on read)", "pull (na leitura)") }],
      onChange: function (v) { p.strategy = v; restart(); }
    });
    var thr = C.choice({
      label: t("Hybrid: pull authors with at least", "Híbrido: puxar autores com pelo menos"), value: p.threshold,
      options: [10000, 100000, 1000000].map(function (v) { return { value: v, label: tag(v) }; }),
      onChange: function (v) { p.threshold = v; restart(); }
    });
    var wk = C.slider({ label: t("Fan-out workers (5,000 inserts/s each)", "Workers de fan-out (5.000 inserções/s cada)"), min: 5, max: 40, value: p.workers,
      fmt: function (v) { return v + " = " + big(capacity(v)) + "/s"; }, onInput: function (v) { p.workers = v; restart(); } });
    var bPost = C.button(t("+ a 50 M account posts now", "+ uma conta de 50 M posta agora"), function () {
      extraNext += burst(p.strategy, p.threshold, BIG); lastBurst = { at: stepNo * DT, inserts: burst(p.strategy, p.threshold, BIG) };
      if (!player.running()) player.step();
    }, { tone: "bad" });

    var player = C.player({
      interval: 120,
      label: function (k) { return "t = " + dur(k * DT).replace("< 1 s", "0 s") + " / 20 min"; },
      onTick: function (k) {
        stepNo = k;
        var tt = (k - 1) * DT, extra = extraNext;
        extraNext = 0;
        if (tt === BIG_AT) { extra += burst(p.strategy, p.threshold, BIG); lastBurst = { at: tt, inserts: burst(p.strategy, p.threshold, BIG) }; }
        last = step(backlog, p, extra);
        backlog = last.backlog;
        if (isFinite(last.delay)) peakDelay = Math.max(peakDelay, last.delay);
        chart.push([isFinite(last.delay) ? last.delay : 0]);
        draw();
      },
      onReset: function () { backlog = 0; stepNo = 0; last = null; peakDelay = 0; extraNext = 0; lastBurst = null; chart.reset(); draw(); }
    });
    player.total(STEPS);

    function restart() { player.reset(); }

    function narrate() {
      var cap = capacity(p.workers), rate = baseRate(p.strategy, p.threshold), reads = readsPerOpen(p.strategy, p.threshold);
      if (rate > cap) return say(t("Even without a celebrity, " + big(rate) + " inserts/s arrive and " + p.workers + " workers write " + big(cap) + "/s: the queue grows forever. Add workers or pull more authors.",
        "Mesmo sem celebridade chegam " + big(rate) + " inserções/s e " + p.workers + " workers escrevem " + big(cap) + "/s: a fila cresce sem parar. Acrescente workers ou puxe mais autores."), "bad");
      if (!stepNo) {
        if (p.strategy === "pull") return say(t("Pull: posts are written once, by author. Nothing to fan out — but every feed open reads all " + FOLLOWS + " followees: " + big(FOLLOWS * PEAK_OPENS) + " reads/s at the peak.",
          "Pull: o post é gravado uma vez, por autor. Nada para espalhar — mas cada abertura do feed lê os " + FOLLOWS + " seguidos: " + big(FOLLOWS * PEAK_OPENS) + " leituras/s no pico."), "warn");
        return say(t("Press play: ordinary posts flow at " + big(rate) + " inserts/s into " + p.workers + " workers (" + big(cap) + "/s). At t = 60 s an account with 50 M followers posts.",
          "Aperte play: posts comuns entram a " + big(rate) + " inserções/s em " + p.workers + " workers (" + big(cap) + "/s). Em t = 60 s uma conta com 50 M de seguidores posta."), "");
      }
      if (lastBurst && !lastBurst.inserts && stepNo * DT - lastBurst.at < 300) return say(t("The 50 M post added no inserts: it stays in the author's recent posts and each follower's feed pulls it at read time — " + reads + " reads per feed open instead of 1, from a list that is always cached.",
        "O post de 50 M não acrescentou inserções: ele fica nos posts recentes do autor e o feed de cada seguidor o puxa na leitura — " + reads + " leituras por abertura em vez de 1, de uma lista sempre em cache."), "ok");
      if (backlog > 0 && last && last.delay > 60) return say(t("The queue is FIFO: every ordinary post written now waits behind " + big(last.before) + " inserts, " + dur(last.delay) + " before its followers see it. At this rate the backlog clears " + dur(clearTime(p, last.before)) + " from now.",
        "A fila é FIFO: todo post comum escrito agora espera atrás de " + big(last.before) + " inserções, " + dur(last.delay) + " até os seguidores o verem. Nesse ritmo o acúmulo zera daqui a " + dur(clearTime(p, last.before)) + "."), "bad");
      if (stepNo >= STEPS) return say(t("Run over: worst delay " + dur(peakDelay) + " for ordinary posts, " + reads + " read(s) per feed open. Change the strategy or the workers and play again.",
        "Fim: pior atraso de " + dur(peakDelay) + " para posts comuns, " + reads + " leitura(s) por abertura do feed. Mude a estratégia ou os workers e rode de novo."), peakDelay > 60 ? "bad" : "ok");
      say(t("Steady: " + big(rate) + " inserts/s against " + big(cap) + "/s of workers — a post reaches its followers in about a second.",
        "Estável: " + big(rate) + " inserções/s contra " + big(cap) + "/s dos workers — um post chega aos seguidores em cerca de um segundo."), "");
    }

    function draw() {
      var cap = capacity(p.workers), rate = baseRate(p.strategy, p.threshold), reads = readsPerOpen(p.strategy, p.threshold);
      var shown = last ? last.before : 0, busy = Math.min(p.workers, Math.ceil(Math.min(cap, rate + shown / DT) / PER_WORKER));
      var hot = last && last.delay > 60;
      C.clear(svg);
      /* posts → queue → workers → timelines */
      svg.appendChild(s("rect", { x: 6, y: 18, width: 84, height: 52, rx: 8, class: "c-box on" }));
      svg.appendChild(s("text", { x: 48, y: 40, "text-anchor": "middle", class: "c-label" }, t("posts", "posts")));
      svg.appendChild(s("text", { x: 48, y: 56, "text-anchor": "middle", class: "c-small" }, POSTS_S + t(" posts/s", " posts/s")));
      svg.appendChild(s("line", { x1: 90, y1: 44, x2: 118, y2: 44, class: "c-wire csim-ff-wire" + (p.strategy === "pull" ? " off" : hot ? " hot" : " on") }));
      svg.appendChild(s("rect", { x: 118, y: 8, width: 170, height: 72, rx: 8, class: "c-box" + (hot ? " bad" : "") }));
      svg.appendChild(s("text", { x: 128, y: 26, class: "c-label" }, t("fan-out queue (FIFO)", "fila de fan-out (FIFO)")));
      svg.appendChild(s("rect", { x: 128, y: 36, width: 150, height: 14, rx: 3, class: "csim-ff-track" }));
      var frac = Math.min(1, shown / BIG);
      if (frac > 0) svg.appendChild(s("rect", { x: 128, y: 36, width: Math.max(2, 150 * frac), height: 14, rx: 3, class: "csim-ff-fill" + (hot ? " bad" : shown > cap * DT ? " warn" : "") }));
      svg.appendChild(s("text", { x: 128, y: 68, class: "c-small" + (hot ? " c-bad" : "") }, t("waiting: ", "esperando: ") + big(shown) + t(" inserts", " inserções")));
      svg.appendChild(s("line", { x1: 288, y1: 44, x2: 312, y2: 44, class: "c-wire" + (p.strategy === "pull" ? " csim-ff-wire off" : " on") }));
      svg.appendChild(s("rect", { x: 312, y: 8, width: 120, height: 72, rx: 8, class: "c-box" }));
      svg.appendChild(s("text", { x: 322, y: 26, class: "c-label" }, p.workers + " workers"));
      for (var w = 0; w < Math.min(40, p.workers); w++) {
        svg.appendChild(s("rect", { x: 322 + (w % 10) * 10.4, y: 34 + Math.floor(w / 10) * 11, width: 8, height: 8, rx: 1.5, class: "csim-ff-worker" + (w < busy && p.strategy !== "pull" ? " busy" : "") }));
      }
      svg.appendChild(s("line", { x1: 432, y1: 44, x2: 456, y2: 44, class: "c-wire" + (p.strategy === "pull" ? " csim-ff-wire off" : " on") }));
      svg.appendChild(s("rect", { x: 456, y: 8, width: 78, height: 72, rx: 8, class: "c-box" + (p.strategy === "pull" ? " down" : "") }));
      svg.appendChild(s("text", { x: 495, y: 36, "text-anchor": "middle", class: "c-label" }, "timelines"));
      svg.appendChild(s("text", { x: 495, y: 52, "text-anchor": "middle", class: "c-small" }, t("1 list/follower", "1 lista/seguidor")));
      /* the read side */
      var pulls = p.strategy !== "push";
      svg.appendChild(s("rect", { x: 118, y: 104, width: 170, height: 66, rx: 8, class: "c-box" + (p.strategy === "hybrid" ? " ok" : p.strategy === "pull" ? " warn" : "") }));
      svg.appendChild(s("text", { x: 128, y: 122, class: "c-label" }, p.strategy === "pull" ? t("posts by author", "posts por autor") : t("celebrity posts", "posts de celebridades")));
      svg.appendChild(s("text", { x: 128, y: 138, class: "c-small" }, p.strategy === "push" ? t("not used: everything is pushed", "não usado: tudo é empurrado")
        : p.strategy === "hybrid" ? t("authors with ≥ ", "autores com ≥ ") + tag(p.threshold) + t(" followers", " seguidores") : t("every author", "todos os autores")));
      svg.appendChild(s("text", { x: 128, y: 154, class: "c-small" }, pulls ? t("pulled at read time", "puxados na leitura") : ""));
      svg.appendChild(s("rect", { x: 312, y: 104, width: 222, height: 66, rx: 8, class: "c-box" + (reads > 50 ? " bad" : reads > 1 ? " warn" : " on") }));
      svg.appendChild(s("text", { x: 322, y: 122, class: "c-label" }, t("feed service (one open)", "serviço de feed (uma abertura)")));
      svg.appendChild(s("text", { x: 322, y: 138, class: "c-small" }, reads === 1 ? t("1 timeline read", "1 leitura da timeline")
        : p.strategy === "hybrid" ? t("1 timeline + " + CELEBS[p.threshold] + " celebrities = " + reads + " reads", "1 timeline + " + CELEBS[p.threshold] + " celebridades = " + reads + " leituras")
        : FOLLOWS + t(" followees = " + reads + " reads", " seguidos = " + reads + " leituras")));
      svg.appendChild(s("text", { x: 322, y: 154, class: "c-small" + (reads > 50 ? " c-bad" : "") }, "× 35k/s = " + big(reads * PEAK_OPENS) + t(" reads/s", " leituras/s")));
      svg.appendChild(s("line", { x1: 495, y1: 80, x2: 495, y2: 104, class: "c-wire" + (p.strategy === "pull" ? " csim-ff-wire off" : " on") }));
      if (pulls) svg.appendChild(s("line", { x1: 288, y1: 137, x2: 312, y2: 137, class: "c-wire on" }));
      /* stats */
      tiles.set("rate", big(rate), rate > cap ? "bad" : rate > cap * 0.6 ? "warn" : "ok");
      tiles.set("backlog", stepNo ? big(shown) : "–", !stepNo ? "" : hot ? "bad" : shown > cap * DT ? "warn" : "ok");
      tiles.set("delay", stepNo ? dur(last.delay) : "–", !stepNo ? "" : last.delay > 60 ? "bad" : last.delay > 5 ? "warn" : "ok");
      tiles.set("reads", reads + " → " + big(reads * PEAK_OPENS) + "/s", reads > 50 ? "bad" : reads > 1 ? "warn" : "ok");
      narrate();
      player.refresh();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Fan-out: who pays for a celebrity's post?", "Fan-out: quem paga pelo post de uma celebridade?") }),
      el("p", { class: "csim-sub", text: t("Twenty minutes of the fan-out queue, 10 s per step: 230 posts/s × 200 followers, and at t = 60 s an account with 50 M followers posts. The reader follows 200 accounts: 12 with ≥ 10 k followers, 9 with ≥ 100 k, 7 with ≥ 1 M.",
        "Vinte minutos da fila de fan-out, 10 s por passo: 230 posts/s × 200 seguidores e, em t = 60 s, uma conta com 50 M de seguidores posta. O leitor segue 200 contas: 12 com ≥ 10 mil seguidores, 9 com ≥ 100 mil, 7 com ≥ 1 M.") }),
      el("div", { class: "csim-row" }, [strat, thr]),
      el("div", { class: "csim-row" }, [wk, bPost]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-cols" }, [tiles, chart]),
      note,
      player
    ]);
    draw();
    return {};
  });
})();
