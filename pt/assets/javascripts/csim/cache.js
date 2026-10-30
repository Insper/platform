/*
 * Cache patterns over time (2027.1, class 5 — caching, patterns):
 *
 *   <div class="csim" data-sim="cache" data-size="500" data-strategy="aside"></div>
 *
 * The catalog serves GET /events/{id} for 1,000 events whose popularity is skewed (Zipf: a few
 * hot events take most reads) at 200 reads/s, while organizers edit one event every 5 s (also
 * mostly the hot ones). Each read checks an LRU cache of `size` entries; a miss reads the
 * database and stores the value with the TTL. The write strategy decides what a write does to
 * the cache: delete the key (cache-aside), nothing (TTL only: readers get the old value until
 * it expires) or store the new value (write-through). Default TTL: LAB.ttl, lab 5's CACHE_TTL_EVENT.
 */
(function () {
  "use strict";

  /* copied from the labs (registered in scripts/csim/lab-values.mjs) */
  var LAB = { ttl: 60 };            /* s: lab 5, catalog.cache.event-ttl */

  var KEYS = 1000, READS = 200, WRITES = 0.2, ZIPF = 1.0;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* cumulative Zipf weights: key k (0 = hottest) has weight 1 / (k + 1)^s */
  function zipfCdf(n, s) {
    var c = new Array(n), sum = 0;
    for (var k = 0; k < n; k++) { sum += 1 / Math.pow(k + 1, s); c[k] = sum; }
    for (k = 0; k < n; k++) c[k] /= sum;
    return c;
  }
  function sample(cdf, u) {
    var lo = 0, hi = cdf.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function create(o) {
    o = o || {};
    return {
      t: 0, ttl: o.ttl || LAB.ttl, size: o.size || 500, strategy: o.strategy || "aside",
      reads: o.reads || READS, writes: o.writes === undefined ? WRITES : o.writes,
      cdf: zipfCdf(o.keys || KEYS, o.zipf || ZIPF), rand: mulberry32(o.seed || 7),
      db: new Array(o.keys || KEYS).fill(0),   /* version of each event in the database */
      cache: new Map(),                         /* key → {v, exp}; Map order = LRU order */
      wacc: 0, total: { reads: 0, hits: 0, dbReads: 0, stale: 0 }, history: []
    };
  }

  function put(st, k, v, now) {
    st.cache.delete(k);
    st.cache.set(k, { v: v, exp: now + st.ttl });
    while (st.cache.size > st.size) st.cache.delete(st.cache.keys().next().value);
  }

  function setSize(st, size) {
    st.size = size;
    while (st.cache.size > st.size) st.cache.delete(st.cache.keys().next().value);
  }

  /* one simulated second: reads and writes in random order, at random instants */
  function tick(st) {
    var ops = [], i;
    for (i = 0; i < st.reads; i++) ops.push({ w: false, at: st.t + st.rand(), k: sample(st.cdf, st.rand()) });
    st.wacc += st.writes;                       /* writes/s may be fractional */
    for (; st.wacc >= 1; st.wacc--) ops.push({ w: true, at: st.t + st.rand(), k: sample(st.cdf, st.rand()) });
    ops.sort(function (a, b) { return a.at - b.at; });
    var sec = { t: st.t + 1, reads: 0, hits: 0, dbReads: 0, stale: 0, touched: {} };
    ops.forEach(function (op) {
      var k = op.k, e = st.cache.get(k);
      if (op.w) {
        st.db[k]++;
        if (st.strategy === "aside") st.cache.delete(k);
        else if (st.strategy === "through") put(st, k, st.db[k], op.at);
        return;
      }
      sec.reads++;
      if (e && e.exp > op.at) {
        sec.hits++;
        if (e.v < st.db[k]) sec.stale++;
        st.cache.delete(k); st.cache.set(k, e);   /* LRU: most recently used last */
      } else {
        sec.dbReads++;
        sec.touched[k] = true;
        put(st, k, st.db[k], op.at);
      }
    });
    st.t++;
    ["reads", "hits", "dbReads", "stale"].forEach(function (f) { st.total[f] += sec[f]; });
    st.history.push(sec);
    return sec;
  }

  /* sums over the last n seconds */
  function recent(st, n) {
    var out = { reads: 0, hits: 0, dbReads: 0, stale: 0, secs: 0 };
    st.history.slice(-n).forEach(function (h) {
      out.reads += h.reads; out.hits += h.hits; out.dbReads += h.dbReads; out.stale += h.stale; out.secs++;
    });
    return out;
  }

  /* run a configuration for `secs` seconds and summarize the last `last` seconds */
  function summary(o, secs, last) {
    var st = create(o);
    for (var i = 0; i < secs; i++) tick(st);
    var r = recent(st, last || 60);
    return { hit: r.hits / r.reads, dbPerSec: r.dbReads / r.secs, stale: r.stale / r.reads, st: st };
  }

  var API = { create: create, tick: tick, put: put, setSize: setSize, recent: recent, summary: summary, zipfCdf: zipfCdf, sample: sample, READS: READS, LAB: LAB };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  var GRID = 10, CELL = 22, SHOW = GRID * GRID;

  function pct(f) { var v = (100 * f).toFixed(1); return (C.PT ? v.replace(".", ",") : v) + "%"; }
  function num(v) { var x = (Math.round(v * 10) / 10).toString(); return C.PT ? x.replace(".", ",") : x; }

  C.style("cache", [
    ".md-typeset .csim-ca-cell { fill: var(--c-bg); stroke: var(--c-line); stroke-width: 1; }",
    ".md-typeset .csim-ca-cell.fresh { fill: color-mix(in srgb, var(--c-ok) 55%, var(--c-bg)); stroke: var(--c-ok); }",
    ".md-typeset .csim-ca-cell.stale { fill: color-mix(in srgb, var(--c-warn) 60%, var(--c-bg)); stroke: var(--c-warn); }",
    ".md-typeset .csim-ca-cell.miss { stroke: var(--c-bad); stroke-width: 2; }",
    ".md-typeset .csim-ca-key { display: flex; flex-wrap: wrap; gap: .2rem .8rem; color: var(--c-fg2); font-size: .6rem; margin-top: .2rem; }",
    ".md-typeset .csim-ca-key i { display: inline-block; width: .6rem; height: .6rem; margin-right: .25rem; vertical-align: middle; border: .05rem solid var(--c-line); }",
    ".md-typeset .csim-ca-key i.fresh { background: color-mix(in srgb, var(--c-ok) 55%, var(--c-bg)); border-color: var(--c-ok); }",
    ".md-typeset .csim-ca-key i.stale { background: color-mix(in srgb, var(--c-warn) 60%, var(--c-bg)); border-color: var(--c-warn); }",
    ".md-typeset .csim-ca-key i.miss { border: .1rem solid var(--c-bad); }"
  ].join("\n"));

  C.register("cache", function (root) {
    var o = C.opts(root, { ttl: LAB.ttl, size: 500, strategy: "aside" });
    var st, last = null;

    var svg = s("svg", { viewBox: "0 0 " + (GRID * CELL + 4) + " " + (GRID * CELL + 4), role: "img",
      "aria-label": t("The 100 hottest events in the cache", "Os 100 eventos mais quentes no cache") });
    var note = el("p", { class: "csim-note" });
    var caption = el("div", { class: "csim-ca-key" });
    var tiles = C.stats([
      { key: "hit", label: t("hit ratio (last 10 s)", "taxa de acerto (últimos 10 s)") },
      { key: "db", label: t("DB reads/s (last 10 s)", "leituras no banco/s (últimos 10 s)") },
      { key: "stale", label: t("stale reads served", "leituras desatualizadas servidas") },
      { key: "used", label: t("cache entries", "entradas no cache") }
    ]);
    var hitChart = C.chart({ title: t("Hit ratio", "Taxa de acerto"), max: 100, unit: "%", len: 90,
      series: [{ label: t("hit ratio", "taxa de acerto"), cls: "tone-ok" }] });
    var dbChart = C.chart({ title: t("Per second", "Por segundo"), len: 90,
      series: [{ label: t("DB reads", "leituras no banco"), cls: "tone-ink" }, { label: t("stale reads", "leituras desatualizadas"), cls: "tone-warn" }] });
    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var ttl = C.slider({ label: "TTL", min: 5, max: 300, step: 5, value: o.ttl, fmt: function (v) { return v + " s"; },
      onInput: function (v) { st.ttl = v; } });
    var size = C.slider({ label: t("Cache size", "Tamanho do cache"), min: 10, max: 1000, step: 10, value: o.size,
      fmt: function (v) { return v + t(" keys", " chaves"); }, onInput: function (v) { setSize(st, v); draw(); } });
    var strat = C.choice({
      label: t("On write", "Na escrita"), value: o.strategy,
      options: [
        { value: "aside", label: t("delete key", "apagar chave"), title: t("cache-aside: update the DB, then DEL the key", "cache-aside: atualiza o banco e faz DEL da chave") },
        { value: "ttl", label: t("TTL only", "só TTL"), title: t("do nothing; the old value lives until it expires", "não faz nada; o valor antigo vive até expirar") },
        { value: "through", label: "write-through", title: t("write the new value into the cache too", "grava o valor novo também no cache") }
      ],
      onChange: function (v) {
        st.strategy = v;
        say(v === "aside" ? t("Cache-aside: each edit deletes the key; the next read misses and loads the new version.", "Cache-aside: cada edição apaga a chave; a próxima leitura erra e carrega a versão nova.")
          : v === "ttl" ? t("TTL only: edits do not touch the cache. Readers get the old event until its TTL runs out — watch the orange cells.", "Só TTL: edições não tocam o cache. Os leitores recebem o evento antigo até o TTL acabar — veja as células laranja.")
          : t("Write-through: each edit stores the new value, so the next read hits and is fresh.", "Write-through: cada edição grava o valor novo, então a próxima leitura acerta e vem atualizada."), "");
        draw();
      }
    });

    var player = C.player({
      interval: 400,
      label: function () { return "t = " + (st ? st.t : 0) + " s"; },
      onTick: function () {
        last = tick(st);
        hitChart.push([last.reads ? 100 * last.hits / last.reads : 0]);
        dbChart.push([last.dbReads, last.stale]);
        narrate();
        draw();
      },
      onReset: function () { reset(); }
    });

    function narrate() {
      var r = recent(st, 10), hit = r.reads ? r.hits / r.reads : 0;
      if (st.t <= 3) say(t("Cold cache: every first read of an event goes to the database.", "Cache frio: toda primeira leitura de um evento vai ao banco."), "warn");
      else if (r.stale) say(t(pct(r.stale / r.reads) + " of the reads in the last 10 s returned an event older than the database: an organizer changed it and the cache never heard about it.",
        pct(r.stale / r.reads) + " das leituras nos últimos 10 s devolveram um evento mais velho que o banco: um organizador mudou e o cache não ficou sabendo."), "bad");
      else if (st.t < 20) say(t("Warming up: the hot events stay cached (green); the long tail keeps missing.", "Aquecendo: os eventos quentes ficam no cache (verde); a cauda longa continua errando."), "");
      else say(t("Hit ratio " + pct(hit) + ": the database takes " + num(r.dbReads / r.secs) + " of " + st.reads + " reads/s. Misses come from the tail (cold events), expirations and evictions.",
        "Taxa de acerto " + pct(hit) + ": o banco recebe " + num(r.dbReads / r.secs) + " de " + st.reads + " leituras/s. As falhas vêm da cauda (eventos frios), das expirações e dos despejos."), hit > 0.9 ? "ok" : "");
    }

    function draw() {
      C.clear(svg);
      for (var k = 0; k < SHOW; k++) {
        var e = st.cache.get(k), x = 2 + (k % GRID) * CELL, y = 2 + Math.floor(k / GRID) * CELL;
        var cls = "csim-ca-cell";
        if (e && e.exp > st.t) cls += e.v < st.db[k] ? " stale" : " fresh";
        if (last && last.touched[k]) cls += " miss";
        var r = s("rect", { x: x + 1, y: y + 1, width: CELL - 3, height: CELL - 3, rx: 3, class: cls });
        r.appendChild(s("title", {}, "event:" + (k + 1) + (e ? t(" cached, version ", " no cache, versão ") + e.v + " / DB " + st.db[k] : t(" not cached", " fora do cache"))));
        svg.appendChild(r);
      }
      var others = 0;
      st.cache.forEach(function (e, k) { if (k >= SHOW && e.exp > st.t) others++; });
      caption.textContent = t("Hottest → coldest. Also cached: " + others + " of the other 900 events.", "Mais quente → mais frio. Também no cache: " + others + " dos outros 900 eventos.");
      var r10 = recent(st, 10);
      if (r10.reads) {
        var hit = r10.hits / r10.reads;
        tiles.set("hit", pct(hit), hit > 0.9 ? "ok" : hit > 0.7 ? "warn" : "bad");
        var db = r10.dbReads / r10.secs;
        tiles.set("db", num(db), db > 40 ? "bad" : db > 20 ? "warn" : "ok");
        tiles.set("stale", st.total.stale + " (" + pct(st.total.stale / st.total.reads) + ")", st.total.stale ? "bad" : "ok");
      } else ["hit", "db", "stale"].forEach(function (k) { tiles.set(k, "–", ""); });
      var live = 0;
      st.cache.forEach(function (e) { if (e.exp > st.t) live++; });
      tiles.set("used", live + " / " + st.size, "");
      player.refresh();
    }

    function reset() {
      st = create({ ttl: ttl.get(), size: size.get(), strategy: strat.get() });
      last = null;
      hitChart.reset(); dbChart.reset();
      say(t("200 reads/s over 1,000 events (a few are hot) and one edit every 5 s. Press play: the cache starts cold.",
        "200 leituras/s sobre 1.000 eventos (poucos são quentes) e uma edição a cada 5 s. Aperte play: o cache começa frio."), "");
      draw();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Cache patterns: how many reads reach the database, and how many are stale?", "Padrões de cache: quantas leituras chegam ao banco, e quantas vêm desatualizadas?") }),
      el("p", { class: "csim-sub", text: t("GET /events/{id} on the catalog. Each cell is one of the 100 hottest events (the hottest top-left).",
        "GET /events/{id} no catalog. Cada célula é um dos 100 eventos mais quentes (o mais quente no canto superior esquerdo).") }),
      el("div", { class: "csim-row" }, [ttl, size, strat]),
      el("div", { class: "csim-cols" }, [
        el("div", { class: "csim-stage", style: "flex: 1 1 12rem; max-width: 18rem" }, [svg, caption, el("div", { class: "csim-ca-key" }, [
          el("span", {}, [el("i", { class: "fresh" }), t("cached, fresh", "no cache, atual")]),
          el("span", {}, [el("i", { class: "stale" }), t("cached, stale", "no cache, desatualizado")]),
          el("span", {}, [el("i", { class: "miss" }), t("missed this second", "erro neste segundo")])
        ])]),
        el("div", {}, [tiles, hitChart, dbChart])
      ]),
      note,
      player
    ]);
    reset();
    return {};
  });
})();
