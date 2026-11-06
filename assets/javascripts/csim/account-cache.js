/*
 * The cache of hands-on 8 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="account-cache" data-script="run"></div>
 *
 * The lab's stack: lb (Nginx :8080) → gateway ×3 → account ×2 (deploy.replicas: 2) → redis :6379 and
 * db (PostgreSQL). The account service caches findById with @Cacheable(value = "accounts", key = "#id"),
 * so the key is accounts::42, the TTL is spring.cache.redis.time-to-live (300000 ms) and null is not
 * cached (cache-null-values: false). @CachePut refreshes the entry on a PUT, @CacheEvict removes it on a
 * DELETE. Every button is a command of the lab (curl, redis-cli KEYS/GET/TTL/DEL/INFO stats, psql,
 * docker compose restart redis) and prints what the lab prints; the latencies are the page's (0.058 s
 * miss, 0.004 s hit).
 *
 * With spring.cache.type: simple, Spring uses an in-memory ConcurrentMapCache instead: one per JVM,
 * with no TTL, so each replica warms its own and a write through one replica leaves the other stale.
 * Requests alternate between the replicas (in the lab Docker's DNS spreads them, not always in turn).
 * A script (data-script) replays one page step by step: run, replicas or stale; "free" leaves the buttons.
 */
(function () {
  "use strict";

  var REPLICAS = ["account-1", "account-2"];
  var GATEWAYS = ["gateway-1", "gateway-2", "gateway-3"];
  var CACHE = "accounts";                 /* @Cacheable(value = "accounts", key = "#id") */
  var TTL = 300;                          /* time-to-live: 300000 ms */
  var MISS_MS = 58, HIT_MS = 4;           /* the page's curl timings */
  var ADA = { id: "42", name: "Ada Lovelace", email: "ada@example.com" };
  var NEW_NAME = "Ada King";

  function key(id) { return CACHE + "::" + id; }
  function json(v) { return "{\"id\":\"" + v.id + "\",\"name\":\"" + v.name + "\",\"email\":\"" + v.email + "\"}"; }
  function copy(v) { return v ? { id: v.id, name: v.name, email: v.email } : null; }
  function secs(ms) { return (ms / 1000).toFixed(3) + "s"; }

  function create(mode) {
    return { mode: mode || "redis", t: 0, rr: 0, gw: 0, db: { "42": copy(ADA) }, redis: {}, local: { "account-1": {}, "account-2": {} },
      hits: 0, misses: 0, dbReads: 0, stale: 0, requests: 0, last: null };
  }

  /* the entry of a key in Redis, or null once the TTL has run out (Redis removes it) */
  function live(st, k) {
    var e = st.redis[k];
    if (e && e.exp <= st.t) { delete st.redis[k]; e = null; }
    return e || null;
  }
  /* a read by Redis: counts in INFO stats as keyspace_hits or keyspace_misses */
  function read(st, k) { var e = live(st, k); if (e) st.hits++; else st.misses++; return e; }
  function cacheOf(st, replica) { return st.mode === "redis" ? null : st.local[replica]; }
  function route(st) {
    var r = REPLICAS[st.rr++ % REPLICAS.length], g = GATEWAYS[st.gw++ % GATEWAYS.length];
    st.requests++;
    return { replica: r, gateway: g, path: "lb → " + g + " → " + r };
  }
  function staleNote(st, v, replica) {
    var d = st.db[v.id];
    if (d && d.name === v.name) return null;
    st.stale++;
    return [replica + " answered from its cache, but PostgreSQL says " + (d ? "\"" + d.name + "\"" : "the account no longer exists") + ": a stale read.",
      replica + " respondeu do cache, mas o PostgreSQL diz " + (d ? "\"" + d.name + "\"" : "que a conta não existe mais") + ": uma leitura desatualizada."];
  }

  /* GET /accounts/{id}: @Cacheable */
  function get(st, id, label) {
    id = id || "42";
    var r = route(st), k = key(id), local = cacheOf(st, r.replica);
    var cmd = label ? "$ curl -o /dev/null -s -w \"" + label + "%{time_total}s\\n\" http://localhost:8080/accounts/" + id
      : "$ curl -s http://localhost:8080/accounts/" + id + " | jq";
    var res = { cmd: cmd, path: r.path, replica: r.replica, redis: [] }, v;
    if (local) {
      v = local[k];
      if (v) { res.hit = true; res.ms = HIT_MS; }
    } else {
      res.redis.push("\"GET\" \"" + k + "\"");
      var e = read(st, k);
      if (e) { v = e.v; res.hit = true; res.ms = HIT_MS; }
    }
    if (!res.hit) {
      st.dbReads++;
      res.db = true;
      res.ms = MISS_MS;
      v = copy(st.db[id]);
      if (v) {
        if (local) local[k] = v;
        else { st.redis[k] = { v: v, exp: st.t + TTL }; res.redis.push("\"SET\" \"" + k + "\" \"" + json(v).replace(/"/g, "\\\"") + "\" \"PX\" \"" + TTL * 1000 + "\""); }
      }
    }
    res.status = v ? 200 : 404;
    res.body = v ? json(v) : "{\"status\":404,\"error\":\"Not Found\",\"path\":\"/accounts/" + id + "\"}";
    res.out = [label ? label + secs(res.ms) : res.body];
    st.last = res;
    var where = local ? [r.replica + " (its own cache)", r.replica + " (cache próprio)"] : ["Redis", "Redis"];
    if (res.hit) {
      res.tone = "ok";
      res.note = ["Hit on " + where[0] + ": the method body is skipped, PostgreSQL is not queried (" + secs(res.ms) + ").",
        "Hit em " + where[1] + ": o corpo do método é pulado, o PostgreSQL não é consultado (" + secs(res.ms) + ")."];
      var s = staleNote(st, v, r.replica);
      if (s) { res.tone = "warn"; res.note = s; res.stale = true; }
    } else if (v) {
      res.tone = "info";
      res.note = local
        ? ["Miss on " + r.replica + ": its own cache is empty, so PostgreSQL is queried and the value is kept in that JVM only (no TTL).",
           "Miss em " + r.replica + ": o cache dele está vazio, então o PostgreSQL é consultado e o valor fica só naquela JVM (sem TTL)."]
        : ["Miss: findById runs, queries PostgreSQL and stores " + k + " in Redis for " + TTL + " s (" + secs(res.ms) + ").",
           "Miss: findById roda, consulta o PostgreSQL e grava " + k + " no Redis por " + TTL + " s (" + secs(res.ms) + ")."];
    } else {
      res.tone = "warn";
      res.note = ["404, and nothing is cached (cache-null-values: false): the next request queries PostgreSQL again.",
        "404 e nada vai para o cache (cache-null-values: false): a próxima requisição consulta o PostgreSQL de novo."];
    }
    return res;
  }
  /* PUT /accounts/{id}: @CachePut, the method always runs and its result replaces the entry */
  function put(st, id, name) {
    id = id || "42"; name = name || NEW_NAME;
    var r = route(st), k = key(id), local = cacheOf(st, r.replica);
    var cmd = "$ curl -s -X PUT http://localhost:8080/accounts/" + id + " -H \"Content-Type: application/json\" -d '{\"name\":\"" + name + "\"}' | jq";
    var res = { cmd: cmd, path: r.path, replica: r.replica, redis: [], db: true };
    var d = st.db[id];
    if (!d) {
      res.out = ["{\"status\":404,\"error\":\"Not Found\",\"path\":\"/accounts/" + id + "\"}"]; res.tone = "warn";
      res.note = ["There is no account " + id + " to update.", "Não existe conta " + id + " para atualizar."];
      return res;
    }
    d.name = name;
    var v = copy(d);
    if (local) local[k] = v;
    else { st.redis[k] = { v: v, exp: st.t + TTL }; res.redis.push("\"SET\" \"" + k + "\" \"" + json(v).replace(/"/g, "\\\"") + "\" \"PX\" \"" + TTL * 1000 + "\""); }
    res.out = [json(v)];
    var others = local ? REPLICAS.filter(function (x) { return x !== r.replica && st.local[x][k]; }) : [];
    if (others.length) {
      res.tone = "warn";
      res.note = ["@CachePut updated the cache of " + r.replica + " only: " + others.join(", ") + " still holds the old value.",
        "@CachePut atualizou só o cache de " + r.replica + ": " + others.join(", ") + " ainda guarda o valor antigo."];
    } else {
      res.tone = "ok";
      res.note = local ? ["@CachePut: the database and the cache of " + r.replica + " now say \"" + name + "\".", "@CachePut: o banco e o cache de " + r.replica + " agora dizem \"" + name + "\"."]
        : ["@CachePut: the method ran, and its result replaced " + k + " in Redis, which every replica reads.", "@CachePut: o método rodou e o resultado substituiu " + k + " no Redis, que toda réplica lê."];
    }
    return res;
  }

  /* DELETE /accounts/{id}: @CacheEvict */
  function del(st, id) {
    id = id || "42";
    var r = route(st), k = key(id), local = cacheOf(st, r.replica);
    var res = { cmd: "$ curl -s -X DELETE http://localhost:8080/accounts/" + id, path: r.path, replica: r.replica, redis: [], db: true, out: ["(204 No Content)"] };
    delete st.db[id];
    if (local) delete local[k];
    else { res.redis.push("\"DEL\" \"" + k + "\""); delete st.redis[k]; }
    var others = local ? REPLICAS.filter(function (x) { return x !== r.replica && st.local[x][k]; }) : [];
    res.tone = others.length ? "warn" : "ok";
    res.note = others.length
      ? ["@CacheEvict removed the entry from " + r.replica + " only: " + others.join(", ") + " still serves the deleted account.",
         "@CacheEvict removeu a entrada só de " + r.replica + ": " + others.join(", ") + " ainda serve a conta apagada."]
      : ["@CacheEvict: the row is gone and " + k + " is evicted; the next read goes to the database.",
         "@CacheEvict: a linha sumiu e " + k + " foi removida do cache; a próxima leitura vai ao banco."];
    return res;
  }

  /* an UPDATE straight in PostgreSQL, behind the service's back */
  function psql(st, id, name) {
    id = id || "42"; name = name || NEW_NAME;
    var cmd = "$ docker compose exec db psql -U store -c \"UPDATE accounts.accounts SET name = '" + name + "' WHERE id = '" + id + "';\"";
    var d = st.db[id];
    if (d) d.name = name;
    return { cmd: cmd, out: [d ? "UPDATE 1" : "UPDATE 0"], tone: "warn",
      note: ["The row changed, but no annotation ran: the cache keeps the old value until its TTL runs out.",
        "A linha mudou, mas nenhuma anotação rodou: o cache guarda o valor antigo até o TTL acabar."] };
  }

  function cli(c) { return "127.0.0.1:6379> " + c; }
  function noRedis(st, cmd) {
    return st.mode === "redis" ? null : { cmd: cmd, tone: "warn", out: [], note: ["The cache lives inside each JVM (ConcurrentMapCache): Redis holds nothing.", "O cache vive dentro de cada JVM (ConcurrentMapCache): o Redis não guarda nada."] };
  }

  function keys(st) {
    var ks = Object.keys(st.redis).filter(function (k) { return live(st, k); }).sort();
    var res = { cmd: cli("KEYS " + CACHE + "::*"), tone: "info", keys: ks,
      out: ks.length ? ks.map(function (k, i) { return (i + 1) + ") \"" + k + "\""; }) : ["(empty array)"],
      note: ks.length ? ["One key per cached account: the cache name, two colons and the id.", "Uma chave por conta no cache: o nome do cache, dois-pontos duplos e o id."]
        : ["Nothing cached in Redis.", "Nada no cache do Redis."] };
    var n = noRedis(st, res.cmd); if (n) { n.out = res.out; return n; }
    return res;
  }

  function cliGet(st, id) {
    id = id || "42";
    var e = read(st, key(id));
    var res = { cmd: cli("GET \"" + key(id) + "\""), tone: "info", out: [e ? json(e.v) : "(nil)"],
      note: e ? ["JSON, thanks to GenericJackson2JsonRedisSerializer (RedisConfig). redis-cli reads count in INFO stats too.", "JSON, graças ao GenericJackson2JsonRedisSerializer (RedisConfig). Leituras do redis-cli também contam no INFO stats."]
        : ["(nil): the key is not in Redis.", "(nil): a chave não está no Redis."] };
    var n = noRedis(st, res.cmd); if (n) { n.out = res.out; return n; }
    return res;
  }

  function ttl(st, id) {
    id = id || "42";
    var e = read(st, key(id)), left = e ? e.exp - st.t : -2;
    var res = { cmd: cli("TTL \"" + key(id) + "\""), tone: e ? "info" : "warn", ttl: left, out: ["(integer) " + left],
      note: e ? [left + " s left; at 0 Redis removes the key and the next request is a miss.", left + " s restantes; em 0 o Redis remove a chave e a próxima requisição é um miss."]
        : ["-2: the key does not exist (expired or never cached).", "-2: a chave não existe (expirou ou nunca foi para o cache)."] };
    var n = noRedis(st, res.cmd); if (n) { n.out = res.out; return n; }
    return res;
  }

  function cliDel(st, id) {
    id = id || "42";
    var had = !!live(st, key(id));
    delete st.redis[key(id)];
    return { cmd: cli("DEL \"" + key(id) + "\""), tone: "info", out: ["(integer) " + (had ? 1 : 0)],
      note: ["The key is gone: the next request is a real miss.", "A chave sumiu: a próxima requisição é um miss de verdade."] };
  }

  function info(st) {
    var total = st.hits + st.misses, rate = total ? Math.round(st.hits / total * 100) : 0;
    return { cmd: "$ docker compose exec redis redis-cli INFO stats | grep -E \"keyspace_(hits|misses)\"", tone: "info",
      hits: st.hits, misses: st.misses, rate: rate,
      out: ["keyspace_hits:" + st.hits, "keyspace_misses:" + st.misses],
      note: ["Hit rate " + rate + "% (" + st.hits + " of " + total + " reads). Above 90% is healthy for a read-heavy load.",
        "Taxa de acerto " + rate + "% (" + st.hits + " de " + total + " leituras). Acima de 90% é saudável numa carga de leitura."] };
  }

  function wait(st, s) {
    st.t += s;
    return { cmd: "(" + (s >= 60 ? s / 60 + " min" : s + " s") + " later)", tone: "info", out: [],
      note: ["Time passes: every Redis entry is " + s + " s closer to its TTL.", "O tempo passa: cada entrada do Redis está " + s + " s mais perto do TTL."] };
  }

  function restartRedis(st) {
    var n = Object.keys(st.redis).filter(function (k) { return live(st, k); }).length;
    return { cmd: "$ docker compose restart redis", tone: "ok", out: [" ✔ Container store-redis-1  Started"],
      note: ["--appendonly yes: Redis replays its AOF on start, so the " + n + " cached key(s) survive, with their TTLs.",
        "--appendonly yes: o Redis reaplica o AOF ao iniciar, então a(s) " + n + " chave(s) do cache sobrevive(m), com seus TTLs."] };
  }

  /* spring.cache.type: redis, or simple (a ConcurrentMapCache per JVM); a rebuild empties the JVM caches */
  function mode(st, m) {
    st.mode = m;
    st.local = { "account-1": {}, "account-2": {} };
    return { cmd: m === "redis" ? "application.yaml: spring.cache.type: redis  →  $ docker compose up -d --build"
      : "application.yaml: spring.cache.type: simple  →  $ docker compose up -d --build", tone: m === "redis" ? "ok" : "warn", out: [],
      note: m === "redis" ? ["type: redis: both replicas read and write the same Redis.", "type: redis: as duas réplicas leem e escrevem o mesmo Redis."]
        : ["type: simple: Spring uses an in-memory ConcurrentMapCache, one per JVM, with no TTL.", "type: simple: o Spring usa um ConcurrentMapCache em memória, um por JVM, sem TTL."] };
  }

  /* the lab's pages, step by step */
  var SCRIPTS = {
    run: [
      { ops: [["get"]], en: "First request: a miss. account-1 queries PostgreSQL and stores accounts::42.", pt: "Primeira requisição: um miss. account-1 consulta o PostgreSQL e grava accounts::42." },
      { ops: [["keys"], ["cliGet"]], en: "In redis-cli: the key, and its value as JSON.", pt: "No redis-cli: a chave e o valor em JSON." },
      { ops: [["get"]], en: "Second request: a hit, even though account-2 answered — both replicas share Redis.", pt: "Segunda requisição: um hit, mesmo com account-2 respondendo — as duas réplicas compartilham o Redis." },
      { ops: [["cliDel"]], en: "Delete the key, so that the next request is a real miss.", pt: "Apague a chave, para que a próxima requisição seja um miss de verdade." },
      { ops: [["get", "42", "Cache miss: "], ["get", "42", "Cache hit:  "]], en: "Measure: 0.058 s through PostgreSQL, 0.004 s from Redis.", pt: "Meça: 0,058 s passando pelo PostgreSQL, 0,004 s vindo do Redis." },
      { ops: [["wait", 13], ["ttl"]], en: "TTL: the seconds left before Redis removes the key.", pt: "TTL: os segundos que faltam para o Redis remover a chave." },
      { ops: [["get"], ["get"], ["get"], ["get"]], en: "MONITOR: four more requests, four GETs with a value and no SET.", pt: "MONITOR: mais quatro requisições, quatro GETs com valor e nenhum SET." },
      { ops: [["info"]], en: "INFO stats: every read that found the key is a hit, redis-cli's GET and TTL included.", pt: "INFO stats: toda leitura que achou a chave é um hit, incluindo o GET e o TTL do redis-cli." },
      { ops: [["wait", 300], ["ttl"], ["get"]], en: "Five minutes later the key is gone: the next request is a miss again.", pt: "Cinco minutos depois a chave sumiu: a próxima requisição é um miss de novo." }
    ],
    replicas: [
      { ops: [["mode", "local"]], en: "With type: simple, each replica has its own in-memory cache.", pt: "Com type: simple, cada réplica tem seu próprio cache em memória." },
      { ops: [["get"], ["get"]], en: "Two requests, two misses: account-2 cannot see what account-1 cached.", pt: "Duas requisições, dois misses: account-2 não vê o que account-1 guardou." },
      { ops: [["get"], ["get"]], en: "Now both are warm: hits.", pt: "Agora as duas estão aquecidas: hits." },
      { ops: [["put"]], en: "PUT through account-1: @CachePut updates its cache only.", pt: "PUT por account-1: @CachePut atualiza só o cache dela." },
      { ops: [["get"]], en: "account-2 still answers \"Ada Lovelace\": a stale read, and with no TTL it never ends.", pt: "account-2 ainda responde \"Ada Lovelace\": uma leitura desatualizada e, sem TTL, ela nunca acaba." },
      { ops: [["mode", "redis"]], en: "Back to type: redis (rebuild: the JVM caches are gone).", pt: "De volta a type: redis (rebuild: os caches das JVMs se foram)." },
      { ops: [["get"], ["get"]], en: "One miss, then a hit through the other replica.", pt: "Um miss e depois um hit pela outra réplica." },
      { ops: [["put", "42", "Ada Lovelace"], ["get"]], en: "PUT through one replica, GET through the other: the fresh value, since there is one cache.", pt: "PUT por uma réplica, GET pela outra: o valor novo, pois há um só cache." },
      { ops: [["del"], ["get"], ["get"]], en: "DELETE evicts the key; the 404 is not cached, so each GET reaches PostgreSQL.", pt: "DELETE remove a chave; o 404 não vai para o cache, então cada GET chega ao PostgreSQL." }
    ],
    stale: [
      { ops: [["get"]], en: "A miss caches account 42.", pt: "Um miss guarda a conta 42 no cache." },
      { ops: [["wait", 30], ["psql"]], en: "Someone changes the row straight in PostgreSQL: no annotation runs.", pt: "Alguém muda a linha direto no PostgreSQL: nenhuma anotação roda." },
      { ops: [["get"], ["ttl"]], en: "The cache keeps serving the old name until the TTL runs out.", pt: "O cache continua servindo o nome antigo até o TTL acabar." },
      { ops: [["wait", 300], ["ttl"], ["get"]], en: "After 300 s the key expires: a miss brings the new name. The TTL bounds how stale the cache can be.", pt: "Depois de 300 s a chave expira: um miss traz o nome novo. O TTL limita o quanto o cache pode ficar desatualizado." },
      { ops: [["get", "99"], ["get", "99"]], en: "An account that does not exist: two 404s, two queries (cache-null-values: false).", pt: "Uma conta que não existe: dois 404, duas consultas (cache-null-values: false)." }
    ]
  };
  var OPS = { get: get, put: put, del: del, psql: psql, keys: keys, cliGet: cliGet, ttl: ttl, cliDel: cliDel, info: info, wait: wait, restartRedis: restartRedis, mode: mode };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function play(name, n) {
    var st = create(), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { REPLICAS: REPLICAS, GATEWAYS: GATEWAYS, CACHE: CACHE, TTL: TTL, MISS_MS: MISS_MS, HIT_MS: HIT_MS, ADA: ADA, NEW_NAME: NEW_NAME, SCRIPTS: SCRIPTS,
    key: key, json: json, create: create, run: run, play: play, get: get, put: put, del: del, psql: psql, keys: keys, cliGet: cliGet, ttl: ttl, cliDel: cliDel,
    info: info, wait: wait, restartRedis: restartRedis, mode: mode };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }

  C.style("account-cache", [
    ".md-typeset .csim-log.csim-ac-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; word-break: break-all; }",
    ".md-typeset .csim-log.csim-ac-term li b { font-weight: 600; }",
    ".md-typeset .csim-log.csim-ac-term li i { font-style: normal; color: var(--c-fg3); }",
    ".md-typeset .csim-ac-entry { stroke-width: 1; fill: var(--c-tint2); stroke: var(--c-ink); }",
    ".md-typeset .csim-ac-entry.old { fill: color-mix(in srgb, var(--c-warn) 22%, var(--c-bg)); stroke: var(--c-warn); }",
    ".md-typeset .csim-ac-ttl { fill: var(--c-accent); }"
  ].join("\n"));

  C.register("account-cache", function (root) {
    var o = C.opts(root, { script: "run" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st;

    var svg = s("svg", { viewBox: "0 0 640 236", role: "img", "aria-label": t("The lab's stack with its cache", "A pilha do lab com o cache") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(7); term.className += " csim-ac-term";
    var tiles = C.stats([
      { key: "db", label: t("reads that reached PostgreSQL", "leituras que chegaram ao PostgreSQL") },
      { key: "rate", label: t("Redis hit rate (INFO stats)", "taxa de acerto do Redis (INFO stats)") },
      { key: "ms", label: t("last response (curl)", "última resposta (curl)") },
      { key: "stale", label: t("stale reads", "leituras desatualizadas") }
    ]);
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) {
      var kids = [el("b", { text: r.cmd })];
      if (r.path) kids.push(el("i", { text: "\n  " + r.path }));
      (r.redis || []).forEach(function (c) { kids.push(el("i", { text: "\n  redis ← " + c })); });
      if (r.out.length) kids.push("\n" + r.out.join("\n"));
      term.add(el("span", {}, kids), r.tone === "info" ? "" : r.tone);
    }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "run", label: t("Run", "Execução") },
      { value: "replicas", label: t("local × shared", "local × compartilhado") },
      { value: "stale", label: t("TTL and stale data", "TTL e dado desatualizado") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });
    var cMode = C.choice({ label: "spring.cache.type", value: "redis", options: [
      { value: "redis", label: "redis" }, { value: "local", label: "simple (ConcurrentMapCache)" }
    ], onChange: function (v) { act(function () { return mode(st, v); })(); } });

    function act(fn) { return function () { player.pause(); var r = fn(); if (r) { show(r); say(r.note, r.tone); } draw(); }; }
    var row1 = [
      C.button("GET /accounts/42", act(function () { return get(st, "42"); }), { tone: "ok" }),
      C.button("PUT /accounts/42", act(function () { var d = st.db["42"]; return put(st, "42", d && d.name === NEW_NAME ? ADA.name : NEW_NAME); })),
      C.button("DELETE /accounts/42", act(function () { return del(st, "42"); }), { tone: "bad" }),
      C.button("GET /accounts/99", act(function () { return get(st, "99"); })),
      C.button(t("UPDATE in psql", "UPDATE no psql"), act(function () { var d = st.db["42"]; return psql(st, "42", d && d.name === NEW_NAME ? ADA.name : NEW_NAME); }))
    ];
    var row2 = [
      C.button("KEYS", act(function () { return keys(st); })),
      C.button("GET (redis-cli)", act(function () { return cliGet(st); })),
      C.button("TTL", act(function () { return ttl(st); })),
      C.button("DEL", act(function () { return cliDel(st); })),
      C.button("INFO stats", act(function () { return info(st); })),
      C.button(t("+60 s", "+60 s"), act(function () { return wait(st, 60); })),
      C.button("restart redis", act(function () { return restartRedis(st); }))
    ];

    var player = C.player({
      interval: 1700,
      onTick: function (k) { return step(k); },
      onPrev: function (k) { replay(k); },
      onReset: function () { reset(); }
    });

    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "";
      sc[k - 1].ops.forEach(function (op) { var r = run(st, op); show(r); if (r.tone === "bad" || r.tone === "warn") tone = r.tone; });
      say([sc[k - 1].en, sc[k - 1].pt], tone);
      cMode.set(st.mode);
      draw();
    }
    function replay(k) {
      st = create(); term.clear();
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      cMode.set(st.mode);
      draw();
    }
    function intro() {
      say(script === "free"
        ? ["Every button is a command of the lab: curl through the load balancer, redis-cli, psql. Switch spring.cache.type to compare a shared cache with one per JVM.",
           "Cada botão é um comando do lab: curl pelo balanceador, redis-cli, psql. Troque spring.cache.type para comparar um cache compartilhado com um por JVM."]
        : ["The lab's starting point: account 42 (Ada Lovelace) in PostgreSQL, Redis empty, two account replicas. Press play or → to run the page's commands; the buttons work at any time.",
           "O ponto de partida do lab: conta 42 (Ada Lovelace) no PostgreSQL, Redis vazio, duas réplicas de account. Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento."], "");
    }
    function reset() {
      st = create(); term.clear(); cMode.set("redis");
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
    function wire(x1, y1, x2, y2, on) {
      svg.appendChild(s("path", { d: "M" + x1 + "," + y1 + " C" + (x1 + 25) + "," + y1 + " " + (x2 - 25) + "," + y2 + " " + x2 + "," + y2, class: "c-wire" + (on ? " on" : "") }));
    }
    /* a cache entry: the key, then the value; under a Redis entry, a bar for the TTL left */
    function entry(x, y, w, v, old, ttlLeft) {
      svg.appendChild(s("rect", { x: x, y: y, width: w, height: 30, rx: 3, class: "csim-ac-entry" + (old ? " old" : "") }));
      svg.appendChild(s("text", { x: x + 5, y: y + 12, class: "c-small c-mono" }, key(v.id)));
      svg.appendChild(s("text", { x: x + 5, y: y + 25, class: "c-small" }, v.name + (ttlLeft !== undefined ? " · TTL " + ttlLeft + " s" : "")));
      if (ttlLeft !== undefined) svg.appendChild(s("rect", { x: x, y: y + 31, width: Math.max(1, w * ttlLeft / TTL), height: 3, class: "csim-ac-ttl" }));
    }

    function draw() {
      C.clear(svg);
      var last = st.last, shared = st.mode === "redis";
      var AX = 244, AW = 186, RX = 452, RW = 182;
      /* client, lb, gateways */
      box(6, 96, 60, 40, "on", t("client", "cliente"));
      svg.appendChild(s("text", { x: 36, y: 128, "text-anchor": "middle", class: "c-small" }, "curl"));
      box(80, 96, 64, 40, "on", "lb", ":8080");
      svg.appendChild(s("text", { x: 112, y: 128, "text-anchor": "middle", class: "c-small" }, "Nginx"));
      wire(66, 116, 80, 116, !!last);
      GATEWAYS.forEach(function (g, i) {
        var y = 60 + i * 40, on = last && last.path && last.path.indexOf(g) >= 0;
        box(158, y, 72, 30, on ? "hot" : "on", g);
        wire(144, 116, 158, y + 15, on);
      });
      /* account replicas, each with its local cache */
      var dbRow = st.db["42"];
      REPLICAS.forEach(function (r, i) {
        var y = 26 + i * 104, on = last && last.replica === r;
        box(AX, y, AW, 80, on ? "hot" : "on", r, shared ? "cache: Redis" : "ConcurrentMapCache");
        GATEWAYS.forEach(function (g, j) { wire(230, 75 + j * 40, AX, y + 40, on && last.path.indexOf(g) >= 0); });
        if (!shared) {
          var ks = Object.keys(st.local[r]);
          if (!ks.length) svg.appendChild(s("text", { x: AX + 8, y: y + 42, class: "c-small" }, t("(empty)", "(vazio)")));
          ks.slice(0, 1).forEach(function (k) {
            var v = st.local[r][k], d = st.db[v.id];
            entry(AX + 6, y + 24, AW - 12, v, !d || d.name !== v.name);
          });
        } else svg.appendChild(s("text", { x: AX + 8, y: y + 42, class: "c-small" }, t("no local copy", "sem cópia local")));
        svg.appendChild(s("text", { x: AX + 8, y: y + 72, class: "c-small c-mono" }, "@Cacheable(\"" + CACHE + "\")"));
      });
      /* redis and the database */
      var ks = Object.keys(st.redis).filter(function (k) { return live(st, k); });
      box(RX, 8, RW, 104, shared ? (last && !last.db && last.hit ? "ok" : "on") : "down", "redis", ":6379 · AOF");
      if (!ks.length) svg.appendChild(s("text", { x: RX + 8, y: 44, class: "c-small" }, shared ? t("(empty)", "(vazio)") : t("unused", "sem uso")));
      ks.slice(0, 2).forEach(function (k, j) {
        var e = st.redis[k], d = st.db[e.v.id];
        entry(RX + 6, 30 + j * 38, RW - 12, e.v, !d || d.name !== e.v.name, e.exp - st.t);
      });
      svg.appendChild(s("text", { x: RX + 8, y: 106, class: "c-small" }, "time-to-live " + TTL + " s · t = " + st.t + " s"));
      box(RX, 140, RW, 70, last && last.db ? "warn" : "on", "db", "PostgreSQL");
      svg.appendChild(s("text", { x: RX + 8, y: 178, class: "c-small c-mono" }, dbRow ? "42 · " + dbRow.name : t("42 · (deleted)", "42 · (apagada)")));
      svg.appendChild(s("text", { x: RX + 8, y: 198, class: "c-small" }, st.dbReads + t(" reads so far", " leituras até agora")));
      REPLICAS.forEach(function (r, i) {
        var y = 26 + i * 104 + 40, on = last && last.replica === r;
        if (shared) wire(AX + AW, y, RX, 60, on);
        wire(AX + AW, y, RX, 175, on && last.db);
      });
      svg.appendChild(s("text", { x: 320, y: 228, "text-anchor": "middle", class: "c-small" },
        t("highlighted: the path of the last request · orange entries are stale", "destacado: o caminho da última requisição · entradas laranja estão desatualizadas")));
      /* tiles */
      var total = st.hits + st.misses;
      tiles.set("db", String(st.dbReads), "");
      tiles.set("rate", shared || total ? (total ? Math.round(st.hits / total * 100) + "%" : "–") : t("unused", "sem uso"), total && st.hits / total >= 0.9 ? "ok" : "");
      tiles.set("ms", last ? secs(last.ms) : "–", last ? (last.hit ? "ok" : "warn") : "");
      tiles.set("stale", String(st.stale), st.stale ? "bad" : "ok");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's cache, without Docker: misses, hits, TTL and two replicas",
        "O cache do lab, sem Docker: misses, hits, TTL e duas réplicas") }),
      el("p", { class: "csim-sub", text: t("Each button runs a command of the lab. The terminal shows what each request sent to Redis (as MONITOR would); the bar under a Redis entry is its TTL.",
        "Cada botão roda um comando do lab. O terminal mostra o que cada requisição mandou ao Redis (como o MONITOR mostraria); a barra sob uma entrada do Redis é o TTL dela.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, row1),
      el("div", { class: "csim-row" }, row2),
      el("div", { class: "csim-row" }, [cMode]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
