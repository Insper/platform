/*
 * Cache stampede (2027.1, class 5 — caching, failure modes):
 *
 *   <div class="csim" data-sim="stampede" data-rate="500"></div>
 *
 * At t = 0 a warm-up job caches the hot event page (`rate` reads/s) and 40 other event pages
 * (10 reads/s each), all with the same TTL. The database runs 20 queries at a time, 200 ms each;
 * the rest wait in line. When a key expires, every request that misses sends its own query, and
 * while those queue the key stays empty, so more requests miss. Switches: request coalescing
 * (one load per key, the others wait for it: lab 5's lock), XFetch (a reader refreshes early, at
 * random, before expiry) and TTL jitter (lab 5's random extra TTL, so keys cached together do not
 * expire together). Defaults (LAB): lab 5's stampede test.
 */
(function () {
  "use strict";

  /* copied from the labs (registered in scripts/csim/lab-values.mjs) */
  var LAB = { ttl: 3, jitter: 10 };  /* s: lab 5's stampede test (CACHE_TTL_LIST); %: EventCache.withJitter */

  var RATE = 500;
  var DURATION = 10, BUCKET = 0.1, OTHERS = 40, OTHER_RATE = 10, WORKERS = 20, DELTA = 0.2, BETA = 1, HIT_MS = 1;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * The whole run, event by event. o: {ttl, rate, coalesce, xfetch, jitter (fraction), seed}.
   * Returns the requests [{at, k, ms, kind}] (kind: hit, miss, wait, early), the database
   * queries [{k, submit, start, end}], each key's expiry changes and per-bucket series.
   */
  function simulate(o) {
    o = o || {};
    var ttl = o.ttl || LAB.ttl, rate = o.rate || RATE, jitter = o.jitter || 0, D = o.duration || DURATION;
    var rand = mulberry32(o.seed || 11), nk = 1 + OTHERS;
    function life() { return ttl * (1 + jitter * rand()); }
    /* arrivals: a Poisson process per key */
    var arr = [];
    for (var k = 0; k < nk; k++) {
      var lam = k === 0 ? rate : OTHER_RATE, tt = 0;
      for (;;) { tt += -Math.log(1 - rand()) / lam; if (tt >= D) break; arr.push({ at: tt, k: k }); }
    }
    arr.sort(function (a, b) { return a.at - b.at; });
    var exp = [], expiries = [], inflight = [], free = [], pending = [], queries = [], reqs = [];
    for (k = 0; k < nk; k++) { exp[k] = life(); expiries.push([{ at: 0, exp: exp[k] }]); inflight[k] = -1; }
    for (var w = 0; w < WORKERS; w++) free.push(0);

    function query(k, t) {
      var i = 0;
      for (var j = 1; j < WORKERS; j++) if (free[j] < free[i]) i = j;
      var start = Math.max(t, free[i]), end = start + DELTA;
      free[i] = end;
      var q = { k: k, submit: t, start: start, end: end };
      queries.push(q);
      pending.push(q);
      if (o.coalesce) inflight[k] = end;
      return end;
    }
    function complete(upTo) {
      pending.sort(function (a, b) { return a.end - b.end; });
      while (pending.length && pending[0].end <= upTo) {
        var q = pending.shift(), e = q.end + life();
        if (e > exp[q.k]) { exp[q.k] = e; expiries[q.k].push({ at: q.end, exp: e }); }
        if (inflight[q.k] === q.end) inflight[q.k] = -1;
      }
    }

    arr.forEach(function (a) {
      var t = a.at, k = a.k, r = { at: t, k: k };
      complete(t);
      var busy = o.coalesce && inflight[k] > t;
      if (exp[k] > t) {
        /* XFetch: refresh early if t − δ·β·ln(u) ≥ expiry */
        if (o.xfetch && !busy && t - DELTA * BETA * Math.log(1 - rand()) >= exp[k]) { r.kind = "early"; r.ms = 1000 * (query(k, t) - t); }
        else { r.kind = "hit"; r.ms = HIT_MS; }
      } else if (busy) { r.kind = "wait"; r.ms = 1000 * (inflight[k] - t); }
      else { r.kind = "miss"; r.ms = 1000 * (query(k, t) - t); }
      reqs.push(r);
    });

    var n = Math.round(D / BUCKET), series = [];
    for (var b = 0; b < n; b++) series.push({ t: (b + 1) * BUCKET, db: 0, req: 0, inDb: 0 });
    queries.forEach(function (q) {
      var b = Math.floor(q.submit / BUCKET);
      if (b < n) series[b].db++;
      for (var i = b; i < n; i++) { var tEnd = (i + 1) * BUCKET; if (q.end > tEnd) series[i].inDb++; else break; }
    });
    reqs.forEach(function (r) { var b = Math.floor(r.at / BUCKET); if (b < n) series[b].req++; });
    return { reqs: reqs, queries: queries, expiries: expiries, series: series, ttl: ttl, keys: nk };
  }

  /* stats of the requests that arrived before time T */
  function stats(run, T) {
    var lat = [], waited = 0, misses = 0, n = 0;
    run.reqs.forEach(function (r) {
      if (r.at >= T) return;
      n++; lat.push(r.ms);
      if (r.kind === "wait") waited++;
      if (r.kind === "miss") misses++;
    });
    lat.sort(function (a, b) { return a - b; });
    var peak = 0, db = 0;
    run.series.forEach(function (s) { if (s.t <= T + 1e-9) { peak = Math.max(peak, s.db / BUCKET); } });
    run.queries.forEach(function (q) { if (q.submit < T) db++; });
    return {
      requests: n, waited: waited, misses: misses, dbQueries: db, peakPerSec: peak,
      p99: lat.length ? lat[Math.min(lat.length - 1, Math.floor(0.99 * lat.length))] : 0
    };
  }

  /* what the cache and the database look like at time T */
  function snapshot(run, T) {
    var keys = run.expiries.map(function (list, k) {
      var e = 0;
      list.forEach(function (x) { if (x.at <= T) e = Math.max(e, x.exp); });
      var loading = run.queries.some(function (q) { return q.k === k && q.submit <= T && q.end > T; });
      return { fresh: e > T, left: e - T, loading: loading };
    });
    var running = 0, queued = 0;
    run.queries.forEach(function (q) {
      if (q.start <= T && q.end > T) running++;
      else if (q.submit <= T && q.start > T) queued++;
    });
    return { keys: keys, running: running, queued: queued };
  }

  var API = { simulate: simulate, stats: stats, snapshot: snapshot, WORKERS: WORKERS, DELTA: DELTA, BUCKET: BUCKET, DURATION: DURATION,
    OTHERS: OTHERS, OTHER_RATE: OTHER_RATE, RATE: RATE, LAB: LAB };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var STEPS = Math.round(DURATION / BUCKET);

  function sec(v) { var x = v.toFixed(1); return (C.PT ? x.replace(".", ",") : x) + " s"; }
  function ms(v) { return v >= 1000 ? sec(v / 1000) : Math.round(v) + " ms"; }
  function n(v) { return Math.round(v).toLocaleString(C.PT ? "pt-BR" : "en"); }

  C.style("stampede", [
    ".md-typeset .csim-st-track { fill: var(--c-panel); stroke: var(--c-line); }",
    ".md-typeset .csim-st-ttl { fill: var(--c-ok); transition: width .15s linear; }",
    ".md-typeset .csim-st-ttl.low { fill: var(--c-warn); }",
    ".md-typeset .csim-st-key { stroke: var(--c-line); stroke-width: 1; fill: var(--c-bg); }",
    ".md-typeset .csim-st-key.fresh { fill: color-mix(in srgb, var(--c-ok) 55%, var(--c-bg)); stroke: var(--c-ok); }",
    ".md-typeset .csim-st-key.loading { fill: color-mix(in srgb, var(--c-bad) 45%, var(--c-bg)); stroke: var(--c-bad); }",
    ".md-typeset .csim-st-worker { fill: var(--c-bg); stroke: var(--c-fg3); }",
    ".md-typeset .csim-st-worker.busy { fill: var(--c-ink); stroke: var(--c-ink); }",
    ".md-typeset .csim-st-queue { fill: var(--c-bad); }",
    ".md-typeset .csim .csim-st-wire { stroke-width: 1.5; }",
    ".md-typeset .csim .csim-st-wire.hot { stroke: var(--c-bad); stroke-width: 3; }"
  ].join("\n"));

  C.register("stampede", function (root) {
    var o = C.opts(root, { ttl: LAB.ttl, rate: RATE, jitter: LAB.jitter });
    var run, step = 0;

    var svg = s("svg", { viewBox: "0 0 540 172", role: "img", "aria-label": t("Fans, cache and database", "Fãs, cache e banco") });
    var note = el("p", { class: "csim-note" });
    var tiles = C.stats([
      { key: "peak", label: t("peak DB queries/s", "pico de consultas/s no banco"), title: t("the database does 100/s at most (20 at a time, 200 ms each)", "o banco faz no máximo 100/s (20 por vez, 200 ms cada)") },
      { key: "p99", label: t("p99 latency", "latência p99") },
      { key: "wait", label: t("requests that waited", "requisições que esperaram") },
      { key: "db", label: t("DB queries", "consultas ao banco") }
    ]);
    var chart = C.chart({ title: t("Database, per second", "Banco, por segundo"), len: STEPS,
      series: [{ label: t("queries sent", "consultas enviadas"), cls: "tone-bad" }, { label: t("capacity (100/s)", "capacidade (100/s)"), cls: "tone-mute dashed" }] });
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function sw(label, title) { return C.toggle({ label: label, title: title, onChange: function () { rerun(); } }); }
    var coal = sw(t("request coalescing (lock)", "agrupamento de requisições (lock)"), t("one load per key; other misses wait for it", "uma carga por chave; as outras falhas esperam por ela"));
    var xf = sw("XFetch", t("a reader refreshes the value early, at random, before it expires", "um leitor renova o valor antes, ao acaso, antes de expirar"));
    var jit = sw(t("TTL jitter (+" + o.jitter + "%)", "jitter no TTL (+" + o.jitter + "%)"), t("each TTL gets up to " + o.jitter + "% random extra", "cada TTL ganha até " + o.jitter + "% extra ao acaso"));

    var player = C.player({
      interval: 160,
      label: function (k) { return "t = " + sec(k * BUCKET) + " / " + sec(DURATION); },
      onTick: function (k) { step = k; chart.push(point(k - 1)); draw(); },
      onReset: function () { step = 0; chart.reset(); draw(); }
    });
    player.total(STEPS);

    function point(i) { return [run.series[i].db / BUCKET, WORKERS / DELTA]; }

    function rerun() {
      run = simulate({ ttl: o.ttl, rate: o.rate, coalesce: coal.get(), xfetch: xf.get(), jitter: jit.get() ? o.jitter / 100 : 0 });
      chart.reset();
      for (var i = 0; i < step; i++) chart.push(point(i));
      draw();
    }

    function narrate(T, st, snap) {
      var hot = snap.keys[0];
      if (!step) return say(t("t = 0: the warm-up job cached the hot event page (" + o.rate + " reads/s) and 40 others, all with TTL " + o.ttl + " s. Press play and watch t = " + o.ttl + " s.",
        "t = 0: o job de aquecimento pôs no cache a página do evento quente (" + o.rate + " leituras/s) e outras 40, todas com TTL " + o.ttl + " s. Aperte play e observe t = " + o.ttl + " s."), "");
      if (snap.queued >= 10) return say(t("Stampede: " + snap.queued + " queries wait in line behind the 20 the database is running. Each fan who missed waits for their own copy of the same page.",
        "Stampede: " + snap.queued + " consultas esperam na fila atrás das 20 que o banco está executando. Cada fã que errou espera a sua própria cópia da mesma página."), "bad");
      if (hot.loading && !hot.fresh) return say(t("The hot key expired: it is being reloaded, and every request in the meantime misses" + (coal.get() ? " — but with coalescing they wait for that one load." : "."),
        "A chave quente expirou: está sendo recarregada, e toda requisição nesse meio-tempo erra" + (coal.get() ? " — mas com agrupamento elas esperam essa única carga." : ".")), coal.get() ? "warn" : "bad");
      if (step >= STEPS) return say(t("Run over: peak " + n(st.peakPerSec) + " DB queries/s against a capacity of 100/s, p99 " + ms(st.p99) + ". Change a switch: the run is replayed with the same fans.",
        "Fim: pico de " + n(st.peakPerSec) + " consultas/s contra uma capacidade de 100/s, p99 " + ms(st.p99) + ". Mude uma chave: a mesma execução é refeita com os mesmos fãs."), st.peakPerSec > WORKERS / DELTA ? "bad" : "ok");
      say(t("Hits: " + (hot.fresh ? "the hot page has " + sec(Math.max(0, hot.left)) + " of TTL left." : "serving from the cache."),
        "Acertos: " + (hot.fresh ? "a página quente tem " + sec(Math.max(0, hot.left)) + " de TTL." : "servindo do cache.")), "");
    }

    function draw() {
      var T = step * BUCKET, st = stats(run, T), snap = snapshot(run, T);
      C.clear(svg);
      var lastDb = step ? run.series[step - 1].db : 0;
      /* fans → cache → database */
      svg.appendChild(s("rect", { x: 6, y: 60, width: 82, height: 56, rx: 8, class: "c-box on" }));
      svg.appendChild(s("text", { x: 47, y: 83, "text-anchor": "middle", class: "c-label" }, t("fans", "fãs")));
      svg.appendChild(s("text", { x: 47, y: 99, "text-anchor": "middle", class: "c-small" }, n(o.rate + OTHERS * OTHER_RATE) + t(" req/s", " req/s")));
      svg.appendChild(s("line", { x1: 88, y1: 88, x2: 120, y2: 88, class: "c-wire on" }));
      svg.appendChild(s("line", { x1: 330, y1: 88, x2: 372, y2: 88, class: "c-wire csim-st-wire" + (lastDb > 3 ? " hot" : lastDb ? " on" : "") }));
      svg.appendChild(s("text", { x: 351, y: 80, "text-anchor": "middle", class: "c-small" + (lastDb > 5 ? " c-bad" : "") }, n(lastDb / BUCKET) + "/s"));
      /* the cache: the hot key's TTL bar and the 40 other keys */
      svg.appendChild(s("rect", { x: 120, y: 8, width: 210, height: 160, rx: 8, class: "c-box" }));
      svg.appendChild(s("text", { x: 130, y: 26, class: "c-label" }, "Redis"));
      var hot = snap.keys[0];
      svg.appendChild(s("text", { x: 130, y: 46, class: "c-small" }, "event:42 (" + t("hot", "quente") + ")"));
      svg.appendChild(s("rect", { x: 130, y: 52, width: 190, height: 14, rx: 3, class: "csim-st-track" }));
      if (hot.fresh) svg.appendChild(s("rect", { x: 130, y: 52, width: Math.max(2, 190 * Math.min(1, hot.left / o.ttl)), height: 14, rx: 3, class: "csim-st-ttl" + (hot.left < 0.5 ? " low" : "") }));
      svg.appendChild(s("text", { x: 320, y: 46, "text-anchor": "end", class: "c-small" + (hot.fresh ? "" : " c-bad") },
        hot.fresh ? "TTL " + sec(hot.left) : hot.loading ? t("expired · loading", "expirou · carregando") : t("expired", "expirou")));
      svg.appendChild(s("text", { x: 130, y: 88, class: "c-small" }, t("40 other event pages", "40 outras páginas de evento")));
      for (var i = 1; i < snap.keys.length; i++) {
        var kx = 130 + ((i - 1) % 10) * 19, ky = 92 + Math.floor((i - 1) / 10) * 18, key = snap.keys[i];
        svg.appendChild(s("rect", { x: kx, y: ky, width: 16, height: 15, rx: 3, class: "csim-st-key" + (key.fresh ? " fresh" : key.loading ? " loading" : "") }));
      }
      /* the database: its workers and the queue */
      svg.appendChild(s("rect", { x: 372, y: 8, width: 162, height: 160, rx: 8, class: "c-box" + (snap.queued ? " bad" : snap.running ? " on" : "") }));
      svg.appendChild(s("text", { x: 382, y: 26, class: "c-label" }, "PostgreSQL"));
      svg.appendChild(s("text", { x: 382, y: 44, class: "c-small" }, t("20 at a time, 200 ms each", "20 por vez, 200 ms cada")));
      for (var w = 0; w < WORKERS; w++) {
        svg.appendChild(s("rect", { x: 382 + (w % 10) * 14.4, y: 54 + Math.floor(w / 10) * 20, width: 11.5, height: 15, rx: 2, class: "csim-st-worker" + (w < snap.running ? " busy" : "") }));
      }
      svg.appendChild(s("text", { x: 382, y: 112, class: "c-small" + (snap.queued ? " c-bad" : "") }, t("waiting in line: ", "esperando na fila: ") + snap.queued));
      var qw = Math.min(142, snap.queued * 0.3);
      svg.appendChild(s("rect", { x: 382, y: 120, width: 142, height: 12, rx: 3, class: "csim-st-track" }));
      if (qw) svg.appendChild(s("rect", { x: 382, y: 120, width: qw, height: 12, rx: 3, class: "csim-st-queue" }));
      svg.appendChild(s("text", { x: 382, y: 152, class: "c-small" }, t("queries so far: ", "consultas até agora: ") + n(st.dbQueries)));
      /* stats */
      tiles.set("peak", step ? n(st.peakPerSec) : "–", !step ? "" : st.peakPerSec > WORKERS / DELTA ? "bad" : st.peakPerSec > WORKERS / DELTA / 2 ? "warn" : "ok");
      tiles.set("p99", step ? ms(st.p99) : "–", !step ? "" : st.p99 > 1000 ? "bad" : st.p99 > 250 ? "warn" : "ok");
      tiles.set("wait", step ? n(st.waited) : "–", st.waited ? "warn" : "");
      tiles.set("db", step ? n(st.dbQueries) : "–", "");
      narrate(T, st, snap);
      player.refresh();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Cache stampede: what happens to the database when the hot key expires?", "Stampede de cache: o que acontece com o banco quando a chave quente expira?") }),
      el("p", { class: "csim-sub", text: t("10 seconds of an on-sale, replayed with the same fans for each choice of switches. The chart shows queries sent to the database against what it can run.",
        "10 segundos de uma abertura de vendas, refeitos com os mesmos fãs para cada combinação de chaves. O gráfico mostra as consultas enviadas ao banco contra o que ele consegue executar.") }),
      el("div", { class: "csim-row" }, [coal, xf, jit]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-cols" }, [tiles, chart]),
      note,
      player
    ]);
    rerun();
    return {};
  });
})();
