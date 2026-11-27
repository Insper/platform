/*
 * The Account service of hands-on 1 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="account-crud" data-script="endpoints"></div>
 *
 * A curl console in front of the lab's code: the endpoints of AccountController (POST, GET, DELETE
 * on /accounts, /accounts/{id} and /accounts/health-check), the checks of AccountService (password
 * present and at least 6 characters after trim, email not empty), the SHA-256 hash in Base64 that goes
 * to hash_password, and the table accounts.accounts of the Flyway migration (name NOT NULL, email
 * UNIQUE). Every request walks AccountResource → AccountService → AccountRepository → PostgreSQL and
 * shows the object of each layer (AccountIn → Account → AccountModel → row) and where it stopped.
 * A script (data-script="endpoints") replays the lab's endpoints step by step; "free" leaves the console.
 *
 * Spring's rules, as the lab runs them: the literal /accounts/health-check wins over /accounts/{id};
 * a path that exists for another method answers 405 (there is no PUT); a missing body is 400 before
 * AccountResource runs; an exception the code does not map (a constraint of the table) is 500;
 * deleteById of an unknown id does nothing (Spring Data 3+), so DELETE always answers 204.
 */
(function () {
  "use strict";

  var PORT = 8080;
  var TABLE = "accounts.accounts";
  var COLUMNS = ["id", "name", "email", "hash_password"];
  var MIN_PASSWORD = 6;
  /* the mappings of AccountController.java, in its order */
  var ENDPOINTS = [
    { method: "POST", path: "/accounts", fn: "create" },
    { method: "GET", path: "/accounts", fn: "findAll" },
    { method: "DELETE", path: "/accounts/{id}", fn: "delete" },
    { method: "GET", path: "/accounts/health-check", fn: "healthCheck" },
    { method: "GET", path: "/accounts/{id}", fn: "findById" }
  ];
  /* the reasons of AccountService.create */
  var REASONS = { nopass: "Password is empty", short: "Password must have at least 6 characters", noemail: "Email is empty" };
  var UNKNOWN = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  var PEOPLE = [
    { name: "Antonio do Estudo", email: "acme@insper.edu.br", password: "123@321" },
    { name: "Maria da Silva", email: "maria@insper.edu.br", password: "segredo42" },
    { name: "Joao Santos", email: "joao@insper.edu.br", password: "abc123" }
  ];
  var STATUS = { 200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 500: "Internal Server Error" };
  var LAYERS = ["curl", "AccountResource", "AccountService", "AccountRepository", "PostgreSQL"];

  /* ------------------------------------------------------------------ SHA-256 → Base64 (AccountService.calcHash) */

  var K = [], H0 = [];
  (function () {
    var n = 2, c = 0;
    function frac(x) { return ((x - Math.floor(x)) * 4294967296) >>> 0; }
    while (c < 64) {
      var prime = true;
      for (var d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (prime) { if (c < 8) H0[c] = frac(Math.sqrt(n)); K[c] = frac(Math.cbrt(n)); c++; }
      n++;
    }
  })();
  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }
  function sha256(str) {
    var b = utf8(str), len = b.length * 8;
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    for (var s = 7; s >= 0; s--) b.push(s > 3 ? 0 : (len >>> (s * 8)) & 255);
    var h = H0.slice(), w = new Array(64);
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < b.length; off += 64) {
      for (var i = 0; i < 64; i++) {
        if (i < 16) w[i] = (b[off + 4 * i] << 24 | b[off + 4 * i + 1] << 16 | b[off + 4 * i + 2] << 8 | b[off + 4 * i + 3]) >>> 0;
        else {
          var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
      }
      var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        var t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      h = [h[0] + a, h[1] + bb, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(function (x) { return x >>> 0; });
    }
    var bytes = [];
    h.forEach(function (x) { bytes.push(x >>> 24, x >>> 16 & 255, x >>> 8 & 255, x & 255); });
    return bytes;
  }
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function base64(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var n = bytes[i] << 16 | (bytes[i + 1] || 0) << 8 | (bytes[i + 2] || 0);
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
    }
    return out;
  }
  function calcHash(text) { return base64(sha256(text)); }

  /* ------------------------------------------------------------------ model */

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* GenerationType.UUID: Hibernate makes a random (version 4) UUID */
  function uuid(st) {
    var hex = "";
    for (var i = 0; i < 32; i++) {
      var v = Math.floor(st.rand() * 16);
      if (i === 12) v = 4;
      if (i === 16) v = 8 + (v & 3);
      hex += v.toString(16);
    }
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function create(seed) {
    return { rows: [], rand: rng(seed || 2026), next: 0, lastId: null, lastBody: null, sent: 0 };
  }

  /* DispatcherServlet: the handler for this method and path, or why there is none */
  function route(method, path) {
    var segs = path.split("?")[0].split("/").slice(1);
    var matches = ENDPOINTS.filter(function (e) {
      var p = e.path.split("/").slice(1);
      return p.length === segs.length && p.every(function (x, i) { return x === "{id}" ? segs[i] !== "" : x === segs[i]; });
    });
    if (!matches.length) return { status: 404 };
    var same = matches.filter(function (e) { return e.method === method; });
    if (!same.length) return { status: 405, allow: matches.map(function (e) { return e.method; }) };
    /* a literal pattern is more specific than {id} */
    same.sort(function (a, b) { return (a.path.indexOf("{") >= 0) - (b.path.indexOf("{") >= 0); });
    var e = same[0];
    return { endpoint: e, id: e.path.indexOf("{id}") >= 0 ? segs[1] : null };
  }

  function json(o) { return o === null || o === undefined ? "" : JSON.stringify(o); }
  function out(a) { return { id: a.id, name: a.name, email: a.email }; }
  function errBody(status, path) { return '{"timestamp":"…","status":' + status + ',"error":"' + STATUS[status] + '","path":"' + path + '"}'; }

  /*
   * One HTTP request. body: an object (sent as JSON) or null (no body).
   * The result: status, headers, the response body, the deepest layer reached (reach, 0–4),
   * the layer that produced an error (fail), what each layer held (objs), the SQL and a note.
   */
  function request(st, method, path, body) {
    st.sent++;
    var r = { method: method, path: path, body: body === undefined ? null : body, headers: {}, res: "", reach: 1, fail: null, objs: [], sql: null, log: null };
    r.objs[0] = method + " " + path;
    function done(status, note) { r.status = status; r.text = STATUS[status]; r.note = note; r.tone = status < 300 ? "ok" : status === 500 ? "bad" : "warn"; return r; }
    function fail(layer, status, note, log) { r.fail = layer; r.res = errBody(status, path.split("?")[0]); if (log) r.log = log; return done(status, note); }

    var h = route(method, path);
    if (h.status === 404) return fail(1, 404, ["No mapping of AccountController matches this path: 404, before AccountResource.", "Nenhum mapeamento de AccountController casa com este caminho: 404, antes de AccountResource."]);
    if (h.status === 405) return fail(1, 405, ["The path exists for " + h.allow.join(" and ") + ", not for " + method + ": the service has no update endpoint.",
      "O caminho existe para " + h.allow.join(" e ") + ", não para " + method + ": o serviço não tem endpoint de atualização."]);
    var fn = h.endpoint.fn, id = h.id;
    r.fn = fn;

    if (fn === "healthCheck") { r.objs[1] = "healthCheck()"; return done(200, ["health-check answers in AccountResource itself: the literal path wins over /accounts/{id}.", "health-check responde no próprio AccountResource: o caminho literal vence /accounts/{id}."]); }

    if (fn === "create") {
      if (r.body === null) return fail(1, 400, ["No body: Spring cannot build AccountIn, so create() never runs.", "Sem corpo: o Spring não consegue montar AccountIn e create() nem roda."],
        "WARN Resolved [HttpMessageNotReadableException: Required request body is missing]");
      var b = r.body;
      r.objs[1] = "AccountIn(" + [b.name, b.email, b.password].map(function (x) { return x === undefined ? "null" : x; }).join(", ") + ")";
      var acc = { name: b.name === undefined ? null : b.name, email: b.email === undefined ? null : b.email, password: b.password === undefined ? null : b.password };
      r.reach = 2;
      r.objs[2] = "Account(" + acc.name + ", " + acc.email + ")";
      var reason = acc.password === null ? REASONS.nopass : acc.password.trim().length < MIN_PASSWORD ? REASONS.short
        : acc.email === null || !acc.email.trim() ? REASONS.noemail : null;
      if (reason) return fail(2, 400, ["AccountService refuses it: \"" + reason + "\". Nothing reaches the database.", "AccountService recusa: \"" + reason + "\". Nada chega ao banco."],
        "WARN Resolved [ResponseStatusException: 400 BAD_REQUEST \"" + reason + "\"]");
      acc.hash = calcHash(acc.password.trim());
      r.objs[2] = "Account(hash " + acc.hash.slice(0, 8) + "…)";
      r.reach = 3;
      var newId = uuid(st);
      r.objs[3] = "AccountModel(" + newId.slice(0, 8) + "…)";
      r.reach = 4;
      r.sql = "INSERT INTO " + TABLE + " (id, name, email, hash_password) VALUES ('" + newId.slice(0, 8) + "…', " + (acc.name === null ? "NULL" : "'" + acc.name + "'") + ", '" + acc.email + "', '" + acc.hash.slice(0, 8) + "…')";
      r.objs[4] = "INSERT";
      if (acc.name === null) return fail(4, 500, ["AccountService does not check the name; the table does (NOT NULL): an exception nobody maps, so 500.", "AccountService não confere o nome; a tabela confere (NOT NULL): uma exceção que ninguém trata, logo 500."],
        "ERROR: null value in column \"name\" of relation \"accounts\" violates not-null constraint");
      if (st.rows.some(function (x) { return x.email === acc.email; })) return fail(4, 500, ["The email is already in the table (UNIQUE): the database refuses and the service answers 500, not 400.", "O email já está na tabela (UNIQUE): o banco recusa e o serviço responde 500, não 400."],
        "ERROR: duplicate key value violates unique constraint \"accounts_email_key\"");
      st.rows.push({ id: newId, name: acc.name, email: acc.email, hash_password: acc.hash });
      st.lastId = newId;
      r.id = newId;
      r.headers.Location = "http://localhost:" + PORT + "/accounts/" + newId;
      return done(201, ["Created: an empty body and a Location header with the new id. The table keeps only the hash of the password.", "Criado: corpo vazio e um cabeçalho Location com o novo id. A tabela guarda só o hash da senha."]);
    }

    r.objs[1] = fn + "(" + (id ? id.slice(0, 8) + (id.length > 8 ? "…" : "") : "") + ")";
    r.objs[2] = fn + "(…)";
    r.objs[3] = fn === "findAll" ? "findAll()" : fn === "delete" ? "deleteById(…)" : "findById(…)";
    r.reach = 4;
    if (fn === "findAll") {
      r.sql = "SELECT id, name, email, hash_password FROM " + TABLE;
      r.objs[4] = st.rows.length + " row(s)";
      r.res = json(st.rows.map(out));
      return done(200, ["A list of AccountOut: id, name and email. Neither the password nor its hash leaves the service.", "Uma lista de AccountOut: id, nome e email. Nem a senha nem o hash saem do serviço."]);
    }
    var row = st.rows.filter(function (x) { return x.id === id; })[0];
    r.sql = "SELECT … FROM " + TABLE + " WHERE id = '" + id.slice(0, 8) + (id.length > 8 ? "…" : "") + "'";
    r.objs[4] = row ? "1 row" : "0 rows";
    if (fn === "findById") {
      if (!row) return fail(1, 404, ["findById returns null and AccountResource throws ResponseStatusException(NOT_FOUND).", "findById devolve null e AccountResource lança ResponseStatusException(NOT_FOUND)."]);
      r.res = json(out(row));
      return done(200, ["One AccountOut.", "Um AccountOut."]);
    }
    /* delete */
    if (row) { st.rows = st.rows.filter(function (x) { return x !== row; }); r.sql += "; DELETE FROM " + TABLE + " WHERE id = …"; }
    return done(204, row ? ["Deleted: 204, no body.", "Removido: 204, sem corpo."]
      : ["Nothing to delete, still 204: deleteById ignores an unknown id, so DELETE is idempotent.", "Nada a remover e mesmo assim 204: deleteById ignora um id desconhecido, então DELETE é idempotente."]);
  }

  /* the bodies of the console: a new person, the last email again, or one of the lab's mistakes */
  function bodyOf(st, kind) {
    var p;
    if (kind === "none") return null;
    if (kind === "new") { p = PEOPLE[st.next % PEOPLE.length]; st.next++; st.lastBody = p; return { name: p.name, email: p.email, password: p.password }; }
    if (kind === "same") { p = st.lastBody || PEOPLE[0]; return { name: p.name, email: p.email, password: p.password }; }
    p = PEOPLE[st.next % PEOPLE.length];
    if (kind === "short") return { name: p.name, email: p.email, password: "123" };
    if (kind === "noemail") return { name: p.name, password: p.password };
    if (kind === "noname") return { email: p.email, password: p.password };
    return null;
  }
  /* "/accounts/{id}" is the last account created (or the selected one), "{unknown}" an id nobody has */
  function pathOf(st, spec, sel) {
    if (spec === "{id}") return "/accounts/" + (sel || st.lastId || UNKNOWN);
    if (spec === "{unknown}") return "/accounts/" + UNKNOWN;
    return spec;
  }
  function send(st, method, spec, kind, sel) {
    var body = method === "POST" || method === "PUT" ? bodyOf(st, kind || "new") : null;
    return request(st, method, pathOf(st, spec, sel), body);
  }

  /* the lab's endpoints, step by step: [method, path, body] and a caption */
  var SCRIPTS = {
    endpoints: [
      { req: ["GET", "/accounts/health-check"], en: "Service page: the first endpoint that works.", pt: "Página Service: o primeiro endpoint que funciona." },
      { req: ["POST", "/accounts", "new"], en: "Create an account.", pt: "Crie uma conta." },
      { req: ["GET", "/accounts"], en: "List the accounts.", pt: "Liste as contas." },
      { req: ["GET", "{id}"], en: "Find it by the id of the Location header.", pt: "Busque pelo id do cabeçalho Location." },
      { req: ["POST", "/accounts", "short"], en: "A password of 3 characters.", pt: "Uma senha de 3 caracteres." },
      { req: ["POST", "/accounts", "same"], en: "The same email again.", pt: "O mesmo email de novo." },
      { req: ["PUT", "{id}", "same"], en: "Update it?", pt: "Atualizar?" },
      { req: ["DELETE", "{id}"], en: "Delete it.", pt: "Remova." },
      { req: ["GET", "{id}"], en: "Gone: 404.", pt: "Sumiu: 404." },
      { req: ["DELETE", "{id}"], en: "Delete it again.", pt: "Remova de novo." }
    ]
  };
  function play(name, n) {
    var st = create(), res = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (s) { res.push(send(st, s.req[0], s.req[1], s.req[2])); });
    return { st: st, out: res };
  }
  /* the curl command of a request, as the lab types it */
  function curl(r) {
    return "$ curl -i -X " + r.method + " http://localhost:" + PORT + r.path + (r.body ? " -H 'Content-Type: application/json' -d '" + json(r.body) + "'" : "");
  }

  var API = { PORT: PORT, TABLE: TABLE, COLUMNS: COLUMNS, MIN_PASSWORD: MIN_PASSWORD, ENDPOINTS: ENDPOINTS, REASONS: REASONS, PEOPLE: PEOPLE, UNKNOWN: UNKNOWN,
    SCRIPTS: SCRIPTS, calcHash: calcHash, create: create, route: route, request: request, send: send, play: play, curl: curl };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return PT ? pair[1] : pair[0]; }
  var BW = 116, GAP = 15, BY = 26, BH = 46;
  function bx(i) { return 4 + i * (BW + GAP); }
  function cut(x, n) { x = String(x); return x.length > n ? x.slice(0, n - 1) + "…" : x; }

  C.style("account-crud", [
    ".md-typeset .csim-ac-tbl { width: 100%; border-collapse: collapse; font-family: var(--md-code-font-family); font-size: .58rem; margin: .2rem 0; }",
    ".md-typeset .csim-ac-tbl th, .md-typeset .csim-ac-tbl td { padding: .12rem .3rem; border-bottom: .05rem solid var(--c-line); text-align: left; white-space: nowrap; }",
    ".md-typeset .csim-ac-tbl th { font-family: var(--md-text-font-family); color: var(--c-fg2); font-weight: 600; }",
    ".md-typeset .csim-ac-tbl tbody tr { cursor: pointer; }",
    ".md-typeset .csim-ac-tbl tr.sel td { background: var(--c-tint); }",
    ".md-typeset .csim-ac-tbl td.empty { color: var(--c-fg3); font-style: italic; cursor: default; }",
    ".md-typeset .csim-ac-cap { font-size: .6rem; color: var(--c-fg2); margin: .3rem 0 0; }",
    ".md-typeset .csim-log.csim-ac-term li { font-family: var(--md-code-font-family); font-size: .6rem; white-space: pre-wrap; word-break: break-all; }",
    ".md-typeset .csim-log.csim-ac-term li b { font-weight: 600; }"
  ].join("\n"));

  C.register("account-crud", function (root) {
    var o = C.opts(root, { script: "endpoints" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, sel = null, last = null;

    var svg = s("svg", { viewBox: "0 0 640 190", role: "img", "aria-label": t("The request through the layers of the Account service", "A requisição pelas camadas do serviço Account") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-ac-term";
    var tbody = el("tbody");
    var table = el("table", { class: "csim-ac-tbl" }, [el("thead", {}, el("tr", {}, COLUMNS.map(function (c) { return el("th", { text: c }); }))), tbody]);
    var tiles = C.stats([
      { key: "status", label: t("last status", "último status") },
      { key: "rows", label: t("rows in " + TABLE, "linhas em " + TABLE) },
      { key: "sent", label: t("requests", "requisições") }
    ]);
    function say(pair, tone) { note.textContent = pair ? L(pair) : ""; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "endpoints", label: t("the endpoints", "os endpoints") }, { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });
    var cMethod = C.choice({ label: t("Method", "Método"), value: "GET", options: ["GET", "POST", "PUT", "DELETE"].map(function (m) { return { value: m, label: m }; }),
      onChange: function () { drawControls(); } });
    var cPath = C.choice({ label: t("Path", "Caminho"), value: "/accounts", options: [
      { value: "/accounts", label: "/accounts" }, { value: "/accounts/health-check", label: "/accounts/health-check" },
      { value: "{id}", label: "/accounts/{id}", title: t("the selected row, or the last account created", "a linha selecionada, ou a última conta criada") },
      { value: "{unknown}", label: t("/accounts/{unknown id}", "/accounts/{id desconhecido}") }
    ] });
    var cBody = C.choice({ label: t("Body", "Corpo"), value: "new", options: [
      { value: "new", label: t("new account", "conta nova") }, { value: "same", label: t("same email", "mesmo email") },
      { value: "short", label: t("password \"123\"", "senha \"123\"") }, { value: "noemail", label: t("no email", "sem email") },
      { value: "noname", label: t("no name", "sem nome") }, { value: "none", label: t("no body", "sem corpo") }
    ] });
    var bSend = C.button(t("send", "enviar"), function () {
      player.pause();
      show(send(st, cMethod.get(), cPath.get(), cBody.get(), cPath.get() === "{id}" ? sel : null));
    }, { tone: "ok" });

    function show(r) {
      last = r;
      var lines = ["HTTP/1.1 " + r.status + " " + r.text];
      if (r.headers.Location) lines.push("Location: " + r.headers.Location);
      if (r.res) lines.push(r.res);
      if (r.log) lines.push("[account] " + r.log);
      term.add(el("span", {}, [el("b", { text: curl(r) }), "\n" + lines.join("\n")]), r.tone);
      if (r.id) sel = null;
      say(r.note, r.tone === "ok" ? "" : r.tone);
      draw();
    }

    var player = C.player({ interval: 1800, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });
    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var q = sc[k - 1].req;
      var r = send(st, q[0], q[1], q[2]);
      show(r);
      say([sc[k - 1].en + " " + r.note[0], sc[k - 1].pt + " " + r.note[1]], r.tone === "ok" ? "" : r.tone);
    }
    function replay(k) {
      st = create(); term.clear(); last = null; sel = null;
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      draw();
    }
    function intro() {
      say(script === "free"
        ? ["Choose a method, a path and a body, then send. Click a row to use its id as {id}.", "Escolha método, caminho e corpo e envie. Clique numa linha para usar o id dela como {id}."]
        : ["The lab's starting point: Flyway created accounts.accounts, empty. Press play or → to send the lab's requests; the console works at any time.",
           "O ponto de partida do lab: o Flyway criou accounts.accounts, vazia. Aperte play ou → para enviar as requisições do lab; o console funciona a qualquer momento."], "");
    }
    function reset() {
      st = create(); term.clear(); last = null; sel = null;
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro();
      draw();
    }
    function drawControls() {
      var m = cMethod.get();
      cBody.style.opacity = m === "POST" || m === "PUT" ? "" : ".4";
    }

    function draw() {
      C.clear(svg);
      var r = last;
      var SUB = [t("client", "cliente"), "controller", "service", "repository", TABLE];
      LAYERS.forEach(function (name, i) {
        var x = bx(i);
        if (i < LAYERS.length - 1) {
          var on = r && r.reach > i;
          svg.appendChild(s("line", { x1: x + BW, y1: BY + 16, x2: x + BW + GAP, y2: BY + 16, class: "c-wire" + (on ? " on" : "") }));
          svg.appendChild(s("line", { x1: x + BW, y1: BY + 32, x2: x + BW + GAP, y2: BY + 32, class: "c-wire dashed" + (on ? " on" : "") }));
        }
        var cls = !r ? "" : r.fail === i ? (r.status === 500 ? "bad" : "warn") : i === 0 ? "on" : i <= r.reach ? (r.status < 300 ? "ok" : "on") : "down";
        svg.appendChild(s("rect", { x: x, y: BY, width: BW, height: BH, rx: 7, class: "c-box " + cls }));
        svg.appendChild(s("text", { x: x + BW / 2, y: BY + 19, "text-anchor": "middle", class: "c-label" }, name));
        svg.appendChild(s("text", { x: x + BW / 2, y: BY + 34, "text-anchor": "middle", class: "c-small" }, SUB[i]));
        var obj = r && r.objs[i];
        if (obj) {
          var words = obj.length > 19 ? [obj.slice(0, obj.indexOf("(") > 0 ? obj.indexOf("(") : 19), obj.slice(obj.indexOf("(") > 0 ? obj.indexOf("(") : 19)] : [obj];
          words.forEach(function (w, j) { svg.appendChild(s("text", { x: x + BW / 2, y: BY + BH + 16 + j * 12, "text-anchor": "middle", class: "c-small c-mono" }, cut(w, 20))); });
        }
      });
      svg.appendChild(s("text", { x: 4, y: 14, class: "c-small" }, t("request →   ·   ← response (dashed)", "requisição →   ·   ← resposta (tracejada)")));
      if (r) {
        var tone = r.status < 300 ? "c-ok" : r.status === 500 ? "c-bad" : "c-warn";
        svg.appendChild(s("text", { x: 4, y: 132, class: "c-label " + tone }, r.status + " " + r.text + (r.headers.Location ? "  ·  Location: /accounts/" + r.id.slice(0, 8) + "…" : "")));
        if (r.sql) svg.appendChild(s("text", { x: 4, y: 150, class: "c-small c-mono" }, cut(r.sql, 104)));
        if (r.log) svg.appendChild(s("text", { x: 4, y: 166, class: "c-small c-mono c-bad" }, cut(r.log, 104)));
      } else {
        svg.appendChild(s("text", { x: 4, y: 132, class: "c-small" }, t("No request yet.", "Nenhuma requisição ainda.")));
      }
      /* the table */
      C.clear(tbody);
      if (!st.rows.length) tbody.appendChild(el("tr", {}, el("td", { class: "empty", colspan: 4, text: t("(0 rows)", "(0 linhas)") })));
      st.rows.forEach(function (row) {
        var mine = sel ? sel === row.id : st.lastId === row.id;
        tbody.appendChild(el("tr", { class: mine ? "sel" : "", title: row.id, onclick: function () { sel = row.id; cPath.set("{id}"); draw(); } }, [
          el("td", { text: row.id.slice(0, 8) + "…" }), el("td", { text: row.name }), el("td", { text: row.email }), el("td", { text: row.hash_password.slice(0, 12) + "…" })
        ]));
      });
      tiles.set("status", r ? String(r.status) : "–", r ? (r.status < 300 ? "ok" : r.status === 500 ? "bad" : "warn") : "");
      tiles.set("rows", String(st.rows.length), "");
      tiles.set("sent", String(st.sent), "");
      drawControls();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's Account service, without Docker: every request through the four layers",
        "O serviço Account do lab, sem Docker: cada requisição pelas quatro camadas") }),
      el("p", { class: "csim-sub", text: t("Each request runs the lab's code: the mappings of AccountController, the checks of AccountService, the table of the Flyway migration. Under each layer, the object it holds; a coloured box is where the request stopped.",
        "Cada requisição roda o código do lab: os mapeamentos de AccountController, as validações de AccountService, a tabela da migração do Flyway. Embaixo de cada camada, o objeto que ela segura; uma caixa colorida é onde a requisição parou.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, [cMethod, cPath]),
      el("div", { class: "csim-row" }, [cBody, bSend]),
      note,
      player,
      el("div", { class: "csim-cols" }, [el("div", {}, [tiles, el("p", { class: "csim-ac-cap", text: TABLE }), table]), term])
    ]);
    reset();
    return {};
  });
})();
