/*
 * The cache of hands-on 5 (2027.1), as a lab twin:
 *
 *   <div class="csim" data-sim="catalog-cache" data-script="check"></div>
 *
 * curl → edge → gateway (round robin) → catalog-1..3 → redis :6379 and db, as the lab builds them.
 * EventCache does cache-aside: GET the key; on a hit answer X-Cache: HIT; on a miss load from
 * PostgreSQL, SET the exact JSON with the TTL plus up to LAB.jitter % and answer MISS; any Redis
 * error is a miss (the cache is optional); CACHE_ENABLED=false answers BYPASS without touching Redis.
 * EventController evicts catalog:event:{id} after a PUT commits, and never the listing pages, which
 * only expire (CACHE_TTL_LIST). Redis runs with no persistence, so a stop and start empties it.
 *
 * Event 42 and the Brasília listing are the lab's seed data (V2__seed_catalog.sql: "Festival #42",
 * venue 45 = Club Brasília, price 100, 4th on page 0 of Brasília); the PUT is the page's admin update.
 * Every command takes 0.1 s of the clock; the TTL jitter comes from a seeded generator. A script
 * (data-script) replays the lab: "check" (step 5 of Cache-aside), "stale" (question 3: the listing
 * after an update) or "ttl" (expiry and BYPASS); "free" leaves only the buttons.
 */
(function () {
  "use strict";

  /* values read from lab 5 (scripts/csim/lab-values.mjs checks them against the lab's files) */
  var LAB = { eventTtl: 60, listTtl: 10, jitter: 10, redisPort: 6379 };
  var REPLICAS = ["catalog-1", "catalog-2", "catalog-3"];
  var STEP_MS = 100;
  var SEED = 18;
  var CITY = "Brasília";
  var EVENT = { id: 42, title: "Festival #42", category: "FESTIVAL", venue: "Club Brasília", priceFrom: 100 };
  var UPDATE = { title: "Festival #42 (new lineup)", priceFrom: 175 };
  var LISTING = [6, 13, 20, 42, 49, 56];   /* the first ids of page 0 of Brasília (venues 41–45) */

  function eventKey(id) { return "catalog:event:" + id; }
  function listKey(city) { return "catalog:events:city=" + city + ":page=0:size=20"; }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create() {
    return { t: 0, rand: rng(SEED), rr: 1, enabled: true, redisUp: true, redis: {},
      db: { title: EVENT.title, priceFrom: EVENT.priceFrom }, queries: 0, counts: { HIT: 0, MISS: 0, BYPASS: 0 }, stale: 0, last: null };
  }
  function tick(st) { st.t += STEP_MS; }
  /* the entry under a key, or null once its TTL ran out (Redis removes it) */
  function live(st, k) {
    var e = st.redis[k];
    if (e && e.exp <= st.t) { delete st.redis[k]; e = null; }
    return e || null;
  }
  /* EventCache.withJitter: TTL plus up to LAB.jitter % */
  function withJitter(st, ttlS) { return ttlS * 1000 + Math.floor(ttlS * 1000 * LAB.jitter / 100 * st.rand()); }
  function snapshot(st) { return { title: st.db.title, priceFrom: st.db.priceFrom }; }
  function eventJson(v) { return "{\"id\":42,\"title\":\"" + v.title + "\",\"category\":\"FESTIVAL\",\"venue\":\"" + EVENT.venue + "\",\"priceFrom\":" + v.priceFrom + ",…}"; }
  function listJson(v) { return "{\"items\":[… {\"id\":42,\"title\":\"" + v.title + "\",\"priceFrom\":" + v.priceFrom + "} …],\"page\":0,\"size\":20,…}"; }
  function isStale(st, v) { return v.title !== st.db.title || v.priceFrom !== st.db.priceFrom; }
  function secs(ms) { return Math.round(ms / 100) / 10 + " s"; }

  /* GET through the gateway: EventCache.get */
  function fetch(st, kind) {
    var inst = REPLICAS[st.rr++ % REPLICAS.length];
    var k = kind === "list" ? listKey(CITY) : eventKey(42), ttl = kind === "list" ? LAB.listTtl : LAB.eventTtl;
    var path = kind === "list" ? "/catalog/events?city=" + encodeURIComponent(CITY) : "/catalog/events/42";
    var res = { cmd: "$ curl -s -D - \"localhost" + path + "\" | grep -iE \"x-instance|x-cache|title\"", kind: kind, key: k, replica: inst, redis: [] };
    var v = null, outcome, log = null;
    if (!st.enabled) {
      outcome = "BYPASS";
      st.queries++; res.db = true; v = snapshot(st);
    } else {
      var e = null;
      if (st.redisUp) { res.redis.push("GET " + k); e = live(st, k); }
      else log = "WARN cache read failed for " + k + ": Unable to connect to redis:" + LAB.redisPort;
      if (e) { outcome = "HIT"; v = e.v; }
      else {
        outcome = "MISS"; st.queries++; res.db = true; v = snapshot(st);
        if (st.redisUp) {
          var px = withJitter(st, ttl);
          st.redis[k] = { v: v, exp: st.t + px, px: px, kind: kind };
          res.redis.push("SET " + k + " <json> PX " + px);
          res.px = px;
        }
      }
    }
    st.counts[outcome]++;
    res.outcome = outcome;
    res.value = v;
    res.stale = isStale(st, v);
    if (res.stale) st.stale++;
    res.out = ["X-Instance: " + inst, "X-Cache: " + outcome].concat(log ? [] : []).concat([(kind === "list" ? listJson(v) : eventJson(v))]);
    if (log) res.log = log;
    res.tone = res.stale ? "warn" : outcome === "HIT" ? "ok" : "info";
    var shared = inst !== (st.last && st.last.replica) && outcome === "HIT";
    res.note = outcome === "BYPASS"
      ? ["BYPASS: CACHE_ENABLED=false, so " + inst + " goes straight to PostgreSQL and never asks Redis (" + st.queries + " queries so far).",
         "BYPASS: CACHE_ENABLED=false, então " + inst + " vai direto ao PostgreSQL e nem pergunta ao Redis (" + st.queries + " consultas até agora)."]
      : log ? ["MISS, and still a 200: Redis is down, read() logs \"cache read failed\" and returns null, so " + inst + " loads from PostgreSQL. Slower, but working.",
         "MISS e mesmo assim 200: o Redis está fora, read() registra \"cache read failed\" e devolve null, então " + inst + " carrega do PostgreSQL. Mais lento, mas funciona."]
      : outcome === "HIT"
        ? (res.stale ? ["HIT, but stale: Redis still holds " + k + " with \"" + v.title + "\" (R$ " + v.priceFrom + "), while PostgreSQL says \"" + st.db.title + "\". Listing pages are never evicted: this lasts until the key expires.",
              "HIT, mas desatualizado: o Redis ainda guarda " + k + " com \"" + v.title + "\" (R$ " + v.priceFrom + "), enquanto o PostgreSQL diz \"" + st.db.title + "\". Páginas de listagem nunca são removidas: isso dura até a chave expirar."]
          : ["HIT on " + inst + (shared ? ", a different replica from the one that stored it: the cache is shared, not local to each JVM" : "") + ". No database access.",
             "HIT em " + inst + (shared ? ", outra réplica, diferente da que gravou: o cache é compartilhado, não local de cada JVM" : "") + ". Nenhum acesso ao banco."])
        : ["MISS on " + inst + ": PostgreSQL answers, and EventCache stores the exact JSON with PX " + res.px + " (" + ttl + " s plus " + (res.px - ttl * 1000) + " ms of jitter).",
           "MISS em " + inst + ": o PostgreSQL responde e o EventCache grava o JSON exato com PX " + res.px + " (" + ttl + " s mais " + (res.px - ttl * 1000) + " ms de jitter)."];
    st.last = res;
    tick(st);
    return res;
  }

  /* PUT as admin: updateEvent commits, then EventController evicts the event's key (not the listings) */
  function put(st) {
    var inst = REPLICAS[st.rr++ % REPLICAS.length];
    var next = st.db.title === EVENT.title ? UPDATE : { title: EVENT.title, priceFrom: EVENT.priceFrom };
    st.db = { title: next.title, priceFrom: next.priceFrom };
    st.queries++;
    var res = { cmd: "$ curl -s -X PUT localhost/catalog/events/42 -H \"Authorization: Bearer $ADMIN\" -d '{\"title\":\"" + next.title + "\",…,\"priceFrom\":" + next.priceFrom + "}'",
      kind: "put", replica: inst, db: true, redis: [], out: ["{\"id\":42,\"title\":\"" + next.title + "\",…,\"priceFrom\":" + next.priceFrom + "}"] };
    if (st.redisUp) { res.redis.push("DEL " + eventKey(42)); delete st.redis[eventKey(42)]; }
    var listed = !!live(st, listKey(CITY));
    res.tone = listed ? "warn" : "ok";
    res.note = listed
      ? ["Committed, then " + eventKey(42) + " evicted. The listing of " + CITY + " still holds the old title for up to " + secs(st.redis[listKey(CITY)].exp - st.t) + ": listings are not evicted.",
         "Confirmado e depois " + eventKey(42) + " removida. A listagem de " + CITY + " ainda guarda o título antigo por até " + secs(st.redis[listKey(CITY)].exp - st.t) + ": listagens não são removidas."]
      : ["Committed, then " + eventKey(42) + " evicted: write first, then delete. The next read loads the new version.",
         "Confirmado e depois " + eventKey(42) + " removida: primeiro escreve, depois apaga. A próxima leitura carrega a versão nova."];
    st.last = res;
    tick(st);
    return res;
  }

  function cli(c) { return "$ docker compose exec redis redis-cli " + c; }
  function down(st, cmd) {
    return st.redisUp ? null : { cmd: cmd, out: ["Error: service \"redis\" is not running"], tone: "warn", note: ["Redis is stopped.", "O Redis está parado."] };
  }
  function cliGet(st, kind) {
    var k = kind === "list" ? listKey(CITY) : eventKey(42), cmd = cli("GET " + (kind === "list" ? "\"" + k + "\"" : k));
    var d = down(st, cmd); if (d) { tick(st); return d; }
    var e = live(st, k);
    tick(st);
    return { cmd: cmd, out: [e ? (kind === "list" ? listJson(e.v) : eventJson(e.v)) : "(nil)"], tone: "info",
      note: e ? ["The exact JSON the clients get: readable with redis-cli.", "O JSON exato que os clientes recebem: legível com o redis-cli."]
        : ["(nil): the key is not in Redis.", "(nil): a chave não está no Redis."] };
  }
  function ttl(st, kind) {
    var k = kind === "list" ? listKey(CITY) : eventKey(42), cmd = cli("TTL " + (kind === "list" ? "\"" + k + "\"" : k));
    var d = down(st, cmd); if (d) { tick(st); return d; }
    var e = live(st, k), left = e ? Math.floor((e.exp - st.t + 500) / 1000) : -2;
    tick(st);
    return { cmd: cmd, out: ["(integer) " + left], ttl: left, tone: e ? "info" : "warn",
      note: e ? [left + " s left: the " + (kind === "list" ? LAB.listTtl : LAB.eventTtl) + " s TTL plus the jitter, minus the time since the SET.",
        left + " s restantes: o TTL de " + (kind === "list" ? LAB.listTtl : LAB.eventTtl) + " s mais o jitter, menos o tempo desde o SET."]
        : ["-2: the key does not exist (expired, evicted or never cached).", "-2: a chave não existe (expirou, foi removida ou nunca foi para o cache)."] };
  }
  function scan(st) {
    var cmd = cli("--scan --pattern 'catalog:*'");
    var d = down(st, cmd); if (d) { tick(st); return d; }
    var ks = Object.keys(st.redis).filter(function (k) { return live(st, k); }).sort();
    tick(st);
    return { cmd: cmd, out: ks.length ? ks : ["(empty)"], keys: ks, tone: "info",
      note: [ks.length + " key(s) cached.", ks.length + " chave(s) no cache."] };
  }
  function flush(st) {
    var cmd = cli("FLUSHALL");
    var d = down(st, cmd); if (d) { tick(st); return d; }
    st.redis = {};
    tick(st);
    return { cmd: cmd, out: ["OK"], tone: "warn", note: ["A cold cache: every next read is a miss until the keys come back.", "Um cache frio: toda próxima leitura é um miss até as chaves voltarem."] };
  }
  function redis(st, on) {
    var cmd = "$ docker compose " + (on ? "start" : "stop") + " redis", n = Object.keys(st.redis).filter(function (k) { return live(st, k); }).length;
    st.redisUp = !!on;
    if (!on) st.redis = {};
    tick(st);
    return { cmd: cmd, out: [" ✔ Container boxoffice-redis-1  " + (on ? "Started" : "Stopped")], tone: on ? "info" : "warn",
      note: on ? ["Redis is back, and empty: it runs with --save \"\" --appendonly no, so a restart is a cold start.", "O Redis voltou, vazio: ele roda com --save \"\" --appendonly no, então um reinício é uma partida a frio."]
        : ["Redis is down" + (n ? ", and its " + n + " key(s) are gone with it (no persistence)" : "") + ". catalog keeps answering: every Redis error is a miss.",
           "O Redis caiu" + (n ? " e suas " + n + " chave(s) se foram com ele (sem persistência)" : "") + ". O catalog continua respondendo: todo erro do Redis é um miss."] };
  }
  function enabled(st, on) {
    st.enabled = !!on;
    tick(st);
    return { cmd: "$ CACHE_ENABLED=" + (on ? "true" : "false") + " docker compose up -d --wait", out: [" ✔ catalog-1, catalog-2, catalog-3  Recreated"], tone: "info",
      note: on ? ["The cache is on again; the keys still in Redis are used.", "O cache está ligado de novo; as chaves que ainda estão no Redis são usadas."]
        : ["The replicas are recreated with CACHE_ENABLED=false: every request goes to PostgreSQL (X-Cache: BYPASS), with no rebuild.", "As réplicas são recriadas com CACHE_ENABLED=false: toda requisição vai ao PostgreSQL (X-Cache: BYPASS), sem rebuild."] };
  }
  function wait(st, s) {
    st.t += s * 1000;
    return { cmd: "(" + s + " s later)", out: [], tone: "info",
      note: ["Time passes: every key is " + s + " s closer to its TTL.", "O tempo passa: cada chave está " + s + " s mais perto do TTL."] };
  }

  /* the lab's pages, step by step */
  var SCRIPTS = {
    check: [
      { ops: [["get"]], en: "First request: a miss.", pt: "Primeira requisição: um miss." },
      { ops: [["get"]], en: "Again: a hit, served by another replica.", pt: "De novo: um hit, servido por outra réplica." },
      { ops: [["cliGet"], ["ttl"]], en: "In Redis: the JSON, and the TTL with its jitter.", pt: "No Redis: o JSON e o TTL com o jitter." },
      { ops: [["put"]], en: "Update event 42 as admin: commit, then evict.", pt: "Atualize o evento 42 como admin: commit, depois remoção." },
      { ops: [["get"]], en: "The next read is a miss with the new data.", pt: "A próxima leitura é um miss com o dado novo." },
      { ops: [["redis", false], ["get"]], en: "Stop Redis: catalog still answers.", pt: "Pare o Redis: o catalog continua respondendo." },
      { ops: [["redis", true], ["get"], ["get"]], en: "Start it again: empty (no persistence), so one miss, then hits.", pt: "Inicie-o de novo: vazio (sem persistência), então um miss e depois hits." }
    ],
    stale: [
      { ops: [["get"], ["get", "list"]], en: "Warm both keys: the event and the listing of Brasília (event 42 is on page 0).", pt: "Aqueça as duas chaves: o evento e a listagem de Brasília (o evento 42 está na página 0)." },
      { ops: [["wait", 3], ["put"]], en: "3 s later, the admin changes event 42: new title, price 175.", pt: "3 s depois, o admin muda o evento 42: título novo, preço 175." },
      { ops: [["get"]], en: "The event page is fresh at once: its key was evicted.", pt: "A página do evento fica atualizada na hora: a chave dela foi removida." },
      { ops: [["get", "list"], ["ttl", "list"]], en: "The listing is a hit with the old title and price, for the seconds its TTL has left.", pt: "A listagem é um hit com o título e o preço antigos, pelos segundos que restam do TTL." },
      { ops: [["wait", 8], ["get", "list"]], en: "Once the listing key expires, the next read loads the new title: staleness bounded by CACHE_TTL_LIST.", pt: "Quando a chave da listagem expira, a próxima leitura carrega o título novo: desatualização limitada pelo CACHE_TTL_LIST." }
    ],
    ttl: [
      { ops: [["get"], ["ttl"]], en: "A miss stores the event for 60 s plus the jitter.", pt: "Um miss guarda o evento por 60 s mais o jitter." },
      { ops: [["wait", 30], ["get"], ["ttl"]], en: "30 s later: still a hit; the TTL keeps counting down (a hit does not renew it).", pt: "30 s depois: ainda um hit; o TTL continua descendo (um hit não o renova)." },
      { ops: [["wait", 37], ["ttl"], ["get"]], en: "Past the TTL the key is gone: one miss per expiry, then hits again.", pt: "Passado o TTL a chave sumiu: um miss por expiração e depois hits de novo." },
      { ops: [["enabled", false], ["get"], ["get"]], en: "CACHE_ENABLED=false: BYPASS, every request is a query (the no-cache run of Measure it).", pt: "CACHE_ENABLED=false: BYPASS, toda requisição é uma consulta (a rodada sem cache de Meça)." },
      { ops: [["enabled", true], ["get"]], en: "Back on: the key cached before is still valid.", pt: "Ligado de novo: a chave guardada antes ainda vale." }
    ]
  };
  var OPS = { get: function (st, kind) { return fetch(st, kind || "event"); }, put: put, cliGet: cliGet, ttl: ttl, scan: scan, flush: flush, redis: redis, enabled: enabled, wait: wait };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function play(name, n) {
    var st = create(), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { LAB: LAB, REPLICAS: REPLICAS, EVENT: EVENT, UPDATE: UPDATE, CITY: CITY, LISTING: LISTING, SCRIPTS: SCRIPTS,
    eventKey: eventKey, listKey: listKey, create: create, run: run, play: play, fetch: fetch, put: put, cliGet: cliGet, ttl: ttl, scan: scan,
    flush: flush, redis: redis, enabled: enabled, wait: wait };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  function L(pair) { return pair ? (C.PT ? pair[1] : pair[0]) : ""; }

  C.style("catalog-cache", [
    ".md-typeset .csim-log.csim-cc-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; word-break: break-all; }",
    ".md-typeset .csim-log.csim-cc-term li b { font-weight: 600; }",
    ".md-typeset .csim-log.csim-cc-term li i { font-style: normal; color: var(--c-fg3); }",
    ".md-typeset .csim-cc-entry { stroke-width: 1; fill: var(--c-tint2); stroke: var(--c-ink); }",
    ".md-typeset .csim-cc-entry.old { fill: color-mix(in srgb, var(--c-warn) 22%, var(--c-bg)); stroke: var(--c-warn); }",
    ".md-typeset .csim-cc-ttl { fill: var(--c-accent); }",
    ".md-typeset .csim-cc-acts .csim-btn { font-family: var(--md-code-font-family, monospace); font-size: .62rem; }"
  ].join("\n"));

  C.register("catalog-cache", function (root) {
    var o = C.opts(root, { script: "check" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st;

    var svg = s("svg", { viewBox: "0 0 640 232", role: "img", "aria-label": t("The lab's catalog with its Redis cache", "O catalog do lab com o cache Redis") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-cc-term";
    var tiles = C.stats([
      { key: "last", label: t("X-Cache of the last response", "X-Cache da última resposta") },
      { key: "ratio", label: t("hit ratio (HIT / all GETs)", "taxa de acerto (HIT / todos os GETs)") },
      { key: "db", label: t("queries to PostgreSQL", "consultas ao PostgreSQL") },
      { key: "stale", label: t("stale responses", "respostas desatualizadas") }
    ]);
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) {
      var kids = [el("b", { text: r.cmd })];
      if (r.log) kids.push(el("i", { text: "\n  " + r.replica + " | " + r.log }));
      (r.redis || []).forEach(function (c) { kids.push(el("i", { text: "\n  redis ← " + c })); });
      if (r.out.length) kids.push("\n" + r.out.join("\n"));
      term.add(el("span", {}, kids), r.tone === "info" ? "" : r.tone);
    }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "check", label: t("Check it (step 5)", "Confira (passo 5)") },
      { value: "stale", label: t("Listing after an update", "Listagem após uma atualização") },
      { value: "ttl", label: t("TTL and BYPASS", "TTL e BYPASS") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });

    function act(fn) { return function () { player.pause(); var r = fn(); if (r) { show(r); say(r.note, r.tone); } draw(); }; }
    var row1 = [
      C.button("GET /catalog/events/42", act(function () { return fetch(st, "event"); }), { tone: "ok" }),
      C.button("GET /catalog/events?city=Brasília", act(function () { return fetch(st, "list"); }), { tone: "ok" }),
      C.button("PUT /catalog/events/42 (admin)", act(function () { return put(st); }))
    ];
    var row2 = [
      C.button("GET " + t("key", "chave"), act(function () { return cliGet(st, "event"); })),
      C.button("TTL event:42", act(function () { return ttl(st, "event"); })),
      C.button("TTL " + t("listing", "listagem"), act(function () { return ttl(st, "list"); })),
      C.button("--scan", act(function () { return scan(st); })),
      C.button("FLUSHALL", act(function () { return flush(st); }), { tone: "bad" }),
      C.button(t("stop/start redis", "parar/iniciar redis"), act(function () { return redis(st, !st.redisUp); })),
      C.button("CACHE_ENABLED", act(function () { return enabled(st, !st.enabled); })),
      C.button("+5 s", act(function () { return wait(st, 5); })),
      C.button("+30 s", act(function () { return wait(st, 30); }))
    ];

    var player = C.player({
      interval: 1800,
      onTick: function (k) { return step(k); },
      onPrev: function (k) { replay(k); },
      onReset: function () { reset(); }
    });

    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "", last = null;
      sc[k - 1].ops.forEach(function (op) { var r = run(st, op); show(r); last = r; if (r.tone === "bad" || r.tone === "warn") tone = r.tone; });
      say([sc[k - 1].en + " " + (last.note ? last.note[0] : ""), sc[k - 1].pt + " " + (last.note ? last.note[1] : "")], tone);
      draw();
    }
    function replay(k) {
      st = create(); term.clear();
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      draw();
    }
    function intro() {
      say(script === "free"
        ? ["Every button is a command of the lab: curl through the edge, redis-cli, docker compose. Watch the keys and their TTL bars in Redis.",
           "Cada botão é um comando do lab: curl pela borda, redis-cli, docker compose. Acompanhe as chaves e as barras de TTL no Redis."]
        : ["The stack of lab 5, started: Redis empty, event 42 (\"Festival #42\", R$ 100) in PostgreSQL. Press play or → to run the page's commands; the buttons work at any time.",
           "A pilha do lab 5, no ar: Redis vazio, evento 42 (\"Festival #42\", R$ 100) no PostgreSQL. Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento."], "");
    }
    function reset() {
      st = create(); term.clear();
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro();
      draw();
    }

    function box(x, y, w, h, cls, title, sub) {
      svg.appendChild(s("rect", { x: x, y: y, width: w, height: h, rx: 7, class: "c-box " + cls }));
      svg.appendChild(s("text", { x: x + 8, y: y + 16, class: "c-label" }, title));
      if (sub) svg.appendChild(s("text", { x: x + w - 8, y: y + 16, "text-anchor": "end", class: "c-small" }, sub));
    }
    function txt(x, y, str, cls) { svg.appendChild(s("text", { x: x, y: y, class: "c-small" + (cls ? " " + cls : "") }, str)); }
    function wire(x1, y1, x2, y2, on) {
      svg.appendChild(s("path", { d: "M" + x1 + "," + y1 + " C" + (x1 + 25) + "," + y1 + " " + (x2 - 25) + "," + y2 + " " + x2 + "," + y2, class: "c-wire" + (on ? " on" : "") }));
    }
    function entry(x, y, w, k, e) {
      var old = isStale(st, e.v), left = Math.max(0, e.exp - st.t);
      svg.appendChild(s("rect", { x: x, y: y, width: w, height: 30, rx: 3, class: "csim-cc-entry" + (old ? " old" : "") }));
      svg.appendChild(s("text", { x: x + 5, y: y + 12, class: "c-small c-mono" }, e.kind === "list" ? "catalog:events:city=Brasília:page=0…" : k));
      svg.appendChild(s("text", { x: x + 5, y: y + 25, class: "c-small" }, e.v.title + " · R$ " + e.v.priceFrom + " · TTL " + Math.round(left / 1000) + " s"));
      svg.appendChild(s("rect", { x: x, y: y + 31, width: Math.max(1, w * left / e.px), height: 3, class: "csim-cc-ttl" }));
    }

    function draw() {
      C.clear(svg);
      var last = st.last, RX = 410, RW = 224;
      box(6, 92, 60, 40, "on", "curl");
      box(80, 92, 92, 40, "on", "edge → gateway");
      txt(88, 124, t("round robin", "rodízio"));
      wire(66, 112, 80, 112, !!last);
      REPLICAS.forEach(function (r, i) {
        var y = 30 + i * 62, on = last && last.replica === r;
        var cls = on ? (last.outcome === "HIT" ? (last.stale ? "warn" : "ok") : "hot") : "on";
        box(194, y, 186, 48, cls, r, st.enabled ? "EventCache" : "CACHE_ENABLED=false");
        txt(202, y + 36, on && last.outcome ? "X-Cache: " + last.outcome : on ? t("PUT, then evict", "PUT, depois remove") : "", "c-mono");
        wire(172, 112, 194, y + 24, on);
        wire(380, y + 24, RX, 60, on && st.enabled && st.redisUp && last.kind !== "put" || on && last.kind === "put" && st.redisUp);
        wire(380, y + 24, RX, 186, on && last.db);
      });
      var ks = Object.keys(st.redis).filter(function (k) { return live(st, k); }).sort();
      box(RX, 8, RW, 120, !st.redisUp ? "down" : last && last.outcome === "HIT" ? (last.stale ? "warn" : "ok") : "on", "redis", ":" + LAB.redisPort + t(" · no persistence", " · sem persistência"));
      if (!st.redisUp) txt(RX + 8, 44, t("stopped: every read is a miss", "parado: toda leitura é um miss"), "c-bad");
      else if (!ks.length) txt(RX + 8, 44, t("(empty)", "(vazio)"));
      ks.slice(0, 2).forEach(function (k, j) { entry(RX + 6, 26 + j * 40, RW - 12, k, st.redis[k]); });
      txt(RX + 8, 120, "TTL: event " + LAB.eventTtl + " s · " + t("list ", "lista ") + LAB.listTtl + " s · +0–" + LAB.jitter + "%");
      box(RX, 150, RW, 62, last && last.db ? "warn" : "on", "db", "PostgreSQL");
      txt(RX + 8, 184, "42 · " + st.db.title, "c-mono");
      txt(RX + 8, 202, "R$ " + st.db.priceFrom + " · " + st.queries + t(" queries so far", " consultas até agora"));
      txt(6, 226, "t = " + secs(st.t) + t(" · orange entries are stale (they differ from the database)", " · entradas laranja estão desatualizadas (diferem do banco)"));
      var gets = st.counts.HIT + st.counts.MISS + st.counts.BYPASS;
      tiles.set("last", last && last.outcome ? last.outcome : "–", last && last.outcome ? (last.stale ? "warn" : last.outcome === "HIT" ? "ok" : "") : "");
      tiles.set("ratio", gets ? Math.round(st.counts.HIT / gets * 100) + "%" : "–", "");
      tiles.set("db", String(st.queries), "");
      tiles.set("stale", String(st.stale), st.stale ? "bad" : "ok");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's cache, without Docker: MISS, HIT, eviction and a Redis outage",
        "O cache do lab, sem Docker: MISS, HIT, remoção e uma queda do Redis") }),
      el("p", { class: "csim-sub", text: t("Each button runs a command of lab 5. The terminal shows what each request sent to Redis; the bar under a Redis entry is the TTL it has left.",
        "Cada botão roda um comando do lab 5. O terminal mostra o que cada requisição mandou ao Redis; a barra sob uma entrada do Redis é o TTL que resta.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row csim-cc-acts" }, row1),
      el("div", { class: "csim-row csim-cc-acts" }, row2),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
