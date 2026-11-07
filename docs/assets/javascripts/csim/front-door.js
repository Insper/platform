/*
 * The front door of hands-on 4 (2027.1), as a lab twin:
 *
 *   <div class="csim" data-sim="front-door" data-script="curl"></div>
 *
 * curl → edge :80 (Nginx: /actuator/ answered 404, limit_req per X-Api-Key) → gateway :8080
 * (UserHeadersFilter strips X-User-*, the JWT is validated against the JWKS of auth, the rules of
 * SecurityConfig in order, the routes /auth/** and lb://catalog with the health check and one retry of
 * a GET) → auth :8081 or catalog-1..3 :8082, as the lab builds them. Every button is a request or a
 * command of the lab and prints what the stack answers, and which hop answered it.
 *
 * Tokens carry the claims of TokenService (iss, aud, sub, email, name, scope, iat, exp) and the kid of
 * the key pair auth generated at startup. The signature is a stand-in (a hash of the kid and the
 * payload): RS256 needs the private key, and what matters here is that a changed payload or an
 * unknown kid fails the check. The gateway downloads the JWKS once and again only for an unknown kid.
 * The clock moves 1 s per request; the load balancer probes the replicas at every multiple of
 * LAB.probe seconds. A script (data-script) replays the lab: "curl" (section 3), "tokens" (the failure
 * cases after it), "edge" (the two front doors, a stopped replica, the rate limit); "free" leaves the
 * buttons.
 */
(function () {
  "use strict";

  /* values read from lab 4 (scripts/csim/lab-values.mjs checks them against the lab's files) */
  var LAB = {
    edgePort: 80, gatewayPort: 8080, authPort: 8081, catalogPort: 8082,
    limit: 20, burst: 40,           /* nginx.conf: limit_req_zone … rate=20r/s, limit_req … burst=40 */
    probe: 5, retries: 1,           /* gateway: health-check interval 5s, Retry retries: 1 (GET) */
    ttl: 3600, shortTtl: 30,        /* auth: JWT_TTL PT1H; the page's JWT_TTL=PT30S */
    skew: 60                        /* the gateway tolerates 60 s past exp */
  };
  var REPLICAS = ["catalog-1", "catalog-2", "catalog-3"];
  var T0 = 1794999999;              /* the first login of the curl script is issued at iat 1795000000 */
  var KIDS = ["9c1f6d2e", "4b7a0e93", "d25c81f4", "70e3b6a1", "e8d4c5b2"];
  var ANA = { id: "0b9d8a6e-4f3c-4c1e-9d52-1b0f3c2a7e11", name: "Ana", email: "ana@example.com", password: "secret-123", role: "USER" };
  var ADMIN = { id: "5f2c7a10-8e4b-4d6f-a3c1-9b8e7d6c5a40", name: "Administrator", email: "admin@boxoffice.dev", password: "boxoffice-admin", role: "ADMIN" };
  var EVENTS = { "1": "BoxOffice Fest — Stadium Night", "2": "Festival #2" };
  var VARS = { ana: "$TOKEN", admin: "$ADMIN", forged: "$FORGED" };

  /* ------------------------------------------------------------------ tokens */

  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function b64url(str) {
    var bytes = unescape(encodeURIComponent(str)).split("").map(function (c) { return c.charCodeAt(0); }), out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "") + (i + 2 < bytes.length ? B64[n & 63] : "");
    }
    return out;
  }
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function payload(tok) {
    return JSON.stringify({ iss: tok.iss, aud: tok.aud, sub: tok.sub, email: tok.email, name: tok.name, scope: tok.scope, iat: tok.iat, exp: tok.exp });
  }
  /* the stand-in signature: only the holder of the kid's private key produces it */
  function sign(kid, p) { return b64url(String(fnv("private-key-" + kid + "|" + p)) + String(fnv(p + "|" + kid))); }
  function serialize(tok) {
    return b64url(JSON.stringify({ kid: tok.kid, alg: "RS256" })) + "." + b64url(payload(tok)) + "." + tok.sig;
  }
  function issue(st, u) {
    var tok = { kid: st.auth.kid, iss: "boxoffice-auth", aud: "boxoffice", sub: u.id, email: u.email, name: u.name,
      scope: u.role === "ADMIN" ? "user admin" : "user", iat: st.t, exp: st.t + st.auth.ttl };
    tok.sig = sign(tok.kid, payload(tok));
    return tok;
  }
  /* what the gateway's decoder checks; downloads the JWKS when it has none or the kid is unknown */
  function verify(st, tok) {
    var fetched = false;
    if (!st.gw.jwks || st.gw.jwks.indexOf(tok.kid) < 0) { st.gw.jwks = [st.auth.kid]; st.gw.fetches++; fetched = true; }
    if (st.gw.jwks.indexOf(tok.kid) < 0) return { ok: false, fetched: fetched, why: "kid" };
    if (sign(tok.kid, payload(tok)) !== tok.sig) return { ok: false, fetched: fetched, why: "sig" };
    if (st.t > tok.exp + LAB.skew) return { ok: false, fetched: fetched, why: "exp" };
    return { ok: true, fetched: fetched, late: st.t > tok.exp };
  }

  /* ------------------------------------------------------------------ the stack */

  function create() {
    return { t: T0, auth: { kid: KIDS[0], gen: 0, ttl: LAB.ttl }, users: { "admin@boxoffice.dev": ADMIN },
      tokens: { ana: null, admin: null, forged: null },
      gw: { jwks: null, fetches: 0 }, events: { "1": EVENTS["1"], "2": EVENTS["2"] },
      up: { "catalog-1": true, "catalog-2": true, "catalog-3": true }, healthy: REPLICAS.slice(), rr: 0,
      limiter: {}, reached: 0, rejected: 0, last: null };
  }
  /* time passes: the load balancer re-probes the replicas at every multiple of LAB.probe */
  function advance(st, dt) {
    for (var i = 0; i < dt; i++) {
      st.t++;
      if ((st.t - T0) % LAB.probe === 0) st.healthy = REPLICAS.filter(function (r) { return st.up[r]; });
    }
  }
  function curl(method, path, cred, o) {
    o = o || {};
    return "$ curl -s " + (o.code ? "-o /dev/null -w \"%{http_code}\\n\" " : "") + (method !== "GET" ? "-X " + method + " " : "") +
      "localhost" + (o.port === LAB.gatewayPort ? ":" + LAB.gatewayPort : "") + path +
      (cred ? " -H \"Authorization: Bearer " + VARS[cred] + "\"" : "") + (o.spoof ? " -H \"X-User-Id: " + ADMIN.id.slice(0, 8) + "…\"" : "") +
      (o.body ? " -d '" + o.body + "'" : "");
  }
  function userJson(u) { return "{\"id\":\"" + u.id.slice(0, 8) + "-…\",\"name\":\"" + u.name + "\",\"email\":\"" + u.email + "\",\"role\":\"" + u.role + "\"}"; }
  function done(st, res) {
    var stop = res.by === "edge" || res.by === "gateway";
    if (res.status >= 400 && stop) st.rejected++;
    if (/^catalog-/.test(res.by)) st.reached++;
    res.tone = res.tone || (res.status < 300 ? "ok" : res.status < 500 ? "warn" : "bad");
    st.last = res;
    advance(st, 1);
    return res;
  }

  /* one HTTP request through the stack: method, path, credential (null | ana | admin | forged), options */
  function request(st, method, path, cred, o) {
    o = o || {};
    var port = o.port || LAB.edgePort;
    var res = { cmd: curl(method, path, cred, { port: port, spoof: o.spoof, code: o.code, body: o.body }), method: method, path: path,
      hops: port === LAB.edgePort ? ["edge"] : [], out: [] };
    function answer(status, by, lines, note) {
      res.status = status; res.by = by; res.out = ["HTTP/1.1 " + status + "  ← " + by].concat(lines || []); res.note = note;
      return done(st, res);
    }
    /* 1. the edge */
    if (port === LAB.edgePort && path.indexOf("/actuator/") === 0)
      return answer(404, "edge", [], ["The edge answers 404 itself: /actuator/ is never forwarded from the internet. The gateway did not see the request.",
        "A borda responde 404 sozinha: /actuator/ nunca é repassado da internet. O gateway nem viu a requisição."]);
    res.hops.push("gateway");
    /* 2. the gateway: strip the client's identity headers, then the token */
    var tok = cred ? st.tokens[cred] : null, auth = null, v = null;
    if (cred && !tok) return answer(401, "gateway", ["WWW-Authenticate: Bearer error=\"invalid_token\""],
      [VARS[cred] + " is empty (log in first): \"Bearer \" with no token is malformed, and the gateway answers 401.",
        VARS[cred] + " está vazio (faça login antes): \"Bearer \" sem token é malformado e o gateway responde 401."]);
    if (tok) {
      v = verify(st, tok);
      res.fetched = v.fetched;
      if (!v.ok) {
        var why = {
          kid: ["no key in the JWKS has kid " + tok.kid + ": auth was restarted and publishes only its new key pair" + (v.fetched ? " (the gateway downloaded the JWKS again, looking for it)" : ""),
            "nenhuma chave do JWKS tem kid " + tok.kid + ": o auth foi reiniciado e publica só o novo par de chaves" + (v.fetched ? " (o gateway baixou o JWKS de novo, procurando-a)" : "")],
          sig: ["the signature does not match the payload: someone changed the claims (scope \"" + tok.scope + "\") without auth's private key",
            "a assinatura não confere com o payload: alguém mudou as claims (scope \"" + tok.scope + "\") sem a chave privada do auth"],
          exp: ["the token expired at " + tok.exp + ", more than " + LAB.skew + " s ago (the clock-skew allowance)",
            "o token expirou em " + tok.exp + ", há mais de " + LAB.skew + " s (a tolerância de relógio)"]
        }[v.why];
        var open = method === "GET" && path.indexOf("/catalog/") === 0;
        return answer(401, "gateway", ["WWW-Authenticate: Bearer error=\"invalid_token\""],
          ["401 from the gateway: " + why[0] + "." + (open ? " The route is open, but a request that carries a token has it validated." : ""),
            "401 do gateway: " + why[1] + "." + (open ? " A rota é aberta, mas uma requisição que carrega um token tem o token validado." : "")]);
      }
      auth = tok;
      res.oldKey = tok.kid !== st.auth.kid;
      res.late = v.late;
    }
    /* SecurityConfig, in order: the first match wins */
    var isAuthOpen = path === "/auth/register" || path === "/auth/login" || path.indexOf("/auth/.well-known/") === 0;
    var isCatalog = path.indexOf("/catalog/") === 0;
    if (isCatalog && method !== "GET" && method !== "HEAD") {
      if (!auth) return answer(401, "gateway", ["WWW-Authenticate: Bearer"],
        ["401: changing the catalog needs a token, and this request has none. The catalog never saw it.", "401: mudar o catálogo exige um token e esta requisição não tem nenhum. O catálogo nem a viu."]);
      if (auth.scope.split(" ").indexOf("admin") < 0) return answer(403, "gateway", ["WWW-Authenticate: Bearer error=\"insufficient_scope\""],
        ["403: the token is valid (Ana is authenticated), but its scope is \"" + auth.scope + "\" and the rule asks for SCOPE_admin. Authenticated is not authorized.",
          "403: o token é válido (Ana está autenticada), mas o scope é \"" + auth.scope + "\" e a regra pede SCOPE_admin. Autenticado não é autorizado."]);
    }
    var isActuator = path.indexOf("/actuator/") === 0;
    if (!isAuthOpen && !isCatalog && !isActuator && !auth)
      return answer(401, "gateway", ["WWW-Authenticate: Bearer"],
        ["401: " + path + " falls into anyExchange().authenticated() and the request has no token. auth never saw it.",
          "401: " + path + " cai em anyExchange().authenticated() e a requisição não tem token. O auth nem a viu."]);
    var spoofNote = o.spoof ? ["UserHeadersFilter removed the X-User-Id the client sent and set its own from the token: ", "O UserHeadersFilter removeu o X-User-Id que o cliente mandou e pôs o seu, tirado do token: "] : null;
    /* 3. routes */
    if (isActuator) return answer(200, "gateway", ["{\"status\":\"UP\"}"],
      ["Port " + LAB.gatewayPort + " is published for experiments: the gateway answers /actuator itself. In production only the edge is exposed.",
        "A porta " + LAB.gatewayPort + " está publicada para experimentos: o gateway responde /actuator sozinho. Em produção só a borda fica exposta."]);
    if (path.indexOf("/auth/") === 0) {
      res.hops.push("auth");
      return authRoute(st, res, method, path, auth, o, answer, spoofNote);
    }
    if (isCatalog) return catalogRoute(st, res, method, path, answer);
    return answer(404, "gateway", [], ["No route matches " + path + ".", "Nenhuma rota casa com " + path + "."]);
  }

  function authRoute(st, res, method, path, auth, o, answer, spoofNote) {
    var body = o.user || null;
    if (path === "/auth/register") {
      if (st.users[body.email]) return answer(409, "auth", ["{\"detail\":\"e-mail already registered\"}"],
        ["409: Ana is already registered. Fine: just log in.", "409: Ana já está cadastrada. Tudo bem: é só fazer login."]);
      st.users[body.email] = body;
      return answer(201, "auth", [userJson(body)],
        ["201: auth stored a BCrypt hash (cost 10), never the password. The route is open (permitAll).", "201: o auth guardou um hash BCrypt (custo 10), nunca a senha. A rota é aberta (permitAll)."]);
    }
    if (path === "/auth/login") {
      var u = st.users[body.email];
      if (!u || u.password !== o.password) return answer(401, "auth", ["{\"detail\":\"invalid credentials\"}"],
        ["401 from auth, not from the gateway: same answer for an unknown e-mail and a wrong password, so nobody learns which e-mails have accounts.",
          "401 do auth, não do gateway: a mesma resposta para e-mail desconhecido e senha errada, para ninguém descobrir quais e-mails têm conta."]);
      var tok = issue(st, u), who = u.role === "ADMIN" ? "admin" : "ana";
      st.tokens[who] = tok;
      if (who === "ana") st.tokens.forged = null;
      return answer(200, "auth", ["{\"accessToken\":\"" + serialize(tok).slice(0, 26) + "…\",\"tokenType\":\"Bearer\",\"expiresIn\":" + st.auth.ttl + "}"],
        ["200: a JWT signed with the private key of kid " + tok.kid + ": scope \"" + tok.scope + "\", iat " + tok.iat + ", exp " + tok.exp + " (" + st.auth.ttl + " s later).",
          "200: um JWT assinado com a chave privada do kid " + tok.kid + ": scope \"" + tok.scope + "\", iat " + tok.iat + ", exp " + tok.exp + " (" + st.auth.ttl + " s depois)."]);
    }
    if (path === "/auth/me") {
      var me = null;
      Object.keys(st.users).forEach(function (k) { if (st.users[k].id === auth.sub) me = st.users[k]; });
      var base = ["/auth/me reads X-User-Id, set by the gateway from the validated token (sub): " + me.name + ".", "/auth/me lê o X-User-Id, posto pelo gateway a partir do token validado (sub): " + me.name + "."];
      if (res.fetched && st.gw.fetches === 1) base = [base[0] + " First token the gateway sees: it downloaded the JWKS of auth once; from now on it validates locally.",
        base[1] + " Primeiro token que o gateway vê: ele baixou o JWKS do auth uma vez; daqui em diante valida localmente."];
      else if (res.fetched) base = [base[0] + " Its kid " + auth.kid + " was unknown, so the gateway downloaded the JWKS again: it now holds only the new key, and tokens with the old kid fail from here on.",
        base[1] + " O kid " + auth.kid + " era desconhecido, então o gateway baixou o JWKS de novo: agora guarda só a chave nova, e tokens com o kid antigo falham daqui em diante."];
      if (res.late) base = [base[0] + " The token is past its exp (" + auth.exp + "), but within the " + LAB.skew + " s of clock skew the gateway tolerates.",
        base[1] + " O token passou do exp (" + auth.exp + "), mas está dentro dos " + LAB.skew + " s de tolerância de relógio do gateway."];
      if (res.oldKey) base = ["200, with a token signed by the previous key pair: the gateway still has that public key cached (it downloads the JWKS again only for an unknown kid), so the old token passes. auth answers for " + me.name + ".",
        "200, com um token assinado pelo par de chaves anterior: o gateway ainda tem essa chave pública em cache (só baixa o JWKS de novo para um kid desconhecido), então o token antigo passa. O auth responde por " + me.name + "."];
      if (spoofNote) base = [spoofNote[0] + me.name + ". The spoofed id never reached auth.", spoofNote[1] + me.name + ". O id forjado nunca chegou ao auth."];
      return answer(200, "auth", [userJson(me)], base);
    }
    return answer(404, "auth", [], ["auth has no " + path + ".", "O auth não tem " + path + "."]);
  }

  function catalogRoute(st, res, method, path, answer) {
    var tries = method === "GET" ? 1 + LAB.retries : 1, tried = [];
    for (var i = 0; i < tries; i++) {
      if (!st.healthy.length) return answer(503, "gateway", ["{\"error\":\"Service Unavailable\"}"],
        ["503: the load balancer knows no healthy catalog instance (\"No servers available for service: catalog\").",
          "503: o balanceador não conhece nenhuma instância saudável do catalog (\"No servers available for service: catalog\")."]);
      var inst = st.healthy[st.rr++ % st.healthy.length];
      tried.push(inst);
      if (st.up[inst]) {
        res.hops.push(inst);
        return serve(st, res, method, path, inst, tried, answer);
      }
    }
    res.hops.push(tried[tried.length - 1]);
    return answer(500, "gateway", ["{\"error\":\"Internal Server Error\"}"],
      method === "GET"
        ? ["500: " + tried.join(" and ") + " refused the connection, and the single retry is spent.", "500: " + tried.join(" e ") + " recusaram a conexão e a única nova tentativa acabou."]
        : ["500: " + tried[0] + " is stopped but still in the balancer's list until the next probe, and a " + method + " is not retried (it may not be idempotent).",
          "500: " + tried[0] + " está parado, mas continua na lista do balanceador até a próxima sondagem, e um " + method + " não é repetido (pode não ser idempotente)."]);
  }

  function serve(st, res, method, path, inst, tried, answer) {
    var id = (path.match(/^\/catalog\/events\/(\d+)$/) || [])[1];
    var hdr = "X-Instance: " + inst, retried = tried.length > 1;
    var rnote = retried ? [" " + tried[0] + " refused the connection (stopped, still listed until the next probe): the gateway retried the GET once, on " + inst + ".",
      " " + tried[0] + " recusou a conexão (parado, ainda na lista até a próxima sondagem): o gateway repetiu o GET uma vez, em " + inst + "."] : ["", ""];
    if (!id || !st.events[id]) return answer(404, inst, [hdr], ["404 from " + inst + ": event " + id + " does not exist.", "404 de " + inst + ": o evento " + id + " não existe."]);
    if (method === "GET") {
      return answer(200, inst, [hdr, "{\"id\":" + id + ",\"title\":\"" + st.events[id] + "\",…}"],
        ["200 from " + inst + ": GET /catalog/** is open (permitAll), and lb://catalog takes the instances in turn." + rnote[0],
          "200 de " + inst + ": GET /catalog/** é aberto (permitAll) e lb://catalog usa as instâncias em rodízio." + rnote[1]]);
    }
    if (method === "PUT") {
      st.events[id] = id === "2" ? "Match #2 (rescheduled)" : st.events[id] + " (edited)";
      return answer(200, inst, [hdr, "\"" + st.events[id] + "\""],
        ["200: the admin token has scope \"user admin\", so SCOPE_admin passes; " + inst + " updated the event.",
          "200: o token do admin tem scope \"user admin\", então SCOPE_admin passa; " + inst + " atualizou o evento."]);
    }
    if (method === "DELETE") {
      delete st.events[id];
      return answer(204, inst, [hdr], ["204: deleted by " + inst + " (the admin token passes SCOPE_admin).", "204: apagado por " + inst + " (o token do admin passa SCOPE_admin)."]);
    }
    return answer(405, inst, [hdr], ["", ""]);
  }

  /* ------------------------------------------------------------------ the lab's commands */

  function register(st) {
    return request(st, "POST", "/auth/register", null, { user: ANA, body: "{\"name\":\"Ana\",\"email\":\"ana@example.com\",\"password\":\"secret-123\"}" });
  }
  function login(st, who, wrong) {
    var u = who === "admin" ? ADMIN : ANA, pw = wrong ? "wrong-password" : u.password;
    var r = request(st, "POST", "/auth/login", null, { user: { email: u.email }, password: pw, body: "{\"email\":\"" + u.email + "\",\"password\":\"" + pw + "\"}" });
    if (r.status === 200) r.cmd = (who === "admin" ? "$ ADMIN" : "$ TOKEN") + "=$(curl -s -X POST localhost/auth/login -d '{\"email\":\"" + u.email + "\",…}' | jq -r .accessToken)";
    return r;
  }
  /* Ana's token with the scope changed to "user admin" by hand: same signature */
  function forge(st) {
    var cmd = "$ FORGED=<Ana's token with \"scope\":\"user admin\" in the payload, signature unchanged>";
    if (!st.tokens.ana) return { cmd: cmd, out: ["($TOKEN is empty: log in as Ana first)"], tone: "warn",
      note: ["There is no token of Ana to edit yet.", "Ainda não há token da Ana para editar."] };
    var f = JSON.parse(JSON.stringify(st.tokens.ana));
    f.scope = "user admin";
    st.tokens.forged = f;
    return { cmd: cmd, out: [serialize(f).slice(0, 40) + "…"], tone: "info",
      note: ["Base64URL is not encryption: anyone can decode the payload and change it. Signing it again needs the private key, which only auth has.",
        "Base64URL não é criptografia: qualquer um decodifica o payload e o altera. Assinar de novo exige a chave privada, que só o auth tem."] };
  }
  /* docker compose restart auth, or up -d auth with a JWT_TTL: a new key pair in memory either way */
  function restartAuth(st, ttl) {
    st.auth.gen++;
    st.auth.kid = KIDS[st.auth.gen % KIDS.length];
    var cmd;
    if (ttl === undefined) cmd = "$ docker compose restart auth";
    else { st.auth.ttl = ttl; cmd = ttl === LAB.ttl ? "$ docker compose up -d auth" : "$ JWT_TTL=PT" + ttl + "S docker compose up -d auth"; }
    advance(st, 1);
    return { cmd: cmd, out: [" ✔ Container boxoffice-auth-1  " + (ttl === undefined ? "Started" : "Recreated")], tone: "warn",
      note: ["auth generated a new RSA key pair (kid " + st.auth.kid + ")" + (ttl !== undefined ? " and now issues tokens for " + st.auth.ttl + " s" : "") + ". Tokens issued before carry the old kid: the gateway rejects them once it downloads the new JWKS, at the first token with the new kid.",
        "O auth gerou um novo par de chaves RSA (kid " + st.auth.kid + ")" + (ttl !== undefined ? " e agora emite tokens de " + st.auth.ttl + " s" : "") + ". Tokens emitidos antes carregam o kid antigo: o gateway os recusa quando baixa o novo JWKS, no primeiro token com o kid novo."] };
  }
  function wait(st, s) {
    advance(st, s);
    return { cmd: "(" + (s >= 60 ? s / 60 + " min" : s + " s") + " later)", out: [], tone: "info",
      note: ["Time passes: tokens get closer to their exp, and the load balancer probed the replicas again.", "O tempo passa: os tokens se aproximam do exp e o balanceador sondou as réplicas de novo."] };
  }
  function stopReplica(st, name, on) {
    st.up[name] = !!on;
    var listed = st.healthy.indexOf(name) >= 0;
    var r = { cmd: "$ docker compose " + (on ? "start " : "stop ") + name, out: [(on ? " ✔ Container boxoffice-" + name + "-1  Started" : " ✔ Container boxoffice-" + name + "-1  Stopped")], tone: on ? "ok" : "warn",
      note: on ? [name + " is back; the load balancer adds it at the next probe (every " + LAB.probe + " s).", name + " voltou; o balanceador a inclui na próxima sondagem (a cada " + LAB.probe + " s)."]
        : [name + " is down" + (listed ? ", but the load balancer still lists it until its next probe (every " + LAB.probe + " s)" : "") + ".", name + " caiu" + (listed ? ", mas o balanceador ainda a lista até a próxima sondagem (a cada " + LAB.probe + " s)" : "") + "."] };
    advance(st, 1);
    return r;
  }
  /* n requests at the same instant, through the edge, with or without an API key */
  function burst(st, n, key) {
    var ok = 0, limited = 0, k = key || "";
    for (var i = 0; i < n; i++) {
      var l = st.limiter[k];
      if (key) {
        var excess = l ? Math.max(0, l.excess - (st.t - l.t) * LAB.limit + 1) : 0;
        if (excess > LAB.burst) { limited++; continue; }
        st.limiter[k] = { excess: excess, t: st.t };
      }
      if (!st.healthy.length) { limited++; continue; }
      st.rr++; ok++; st.reached++;
    }
    st.rejected += limited;
    var cmd = "$ seq " + n + " | xargs -P " + n + " -I{} curl -s -o /dev/null -w \"%{http_code}\\n\" " + (key ? "-H \"X-Api-Key: " + key + "\" " : "") + "localhost/catalog/events/1 | sort | uniq -c";
    var out = ["     " + ok + " 200"].concat(limited ? ["     " + limited + " 429"] : []);
    st.last = { hops: ["edge", "gateway", "catalog-1"], by: limited ? "edge" : "catalog-1", status: limited ? 429 : 200, burst: true };
    advance(st, 1);
    return { cmd: cmd, out: out, ok: ok, limited: limited, tone: limited ? "warn" : "ok",
      note: key ? [ok + " pass (1 + the burst of " + LAB.burst + "), " + limited + " get 429 from the edge: limit_req allows " + LAB.limit + " req/s per key. The gateway and the replicas never see the rejected ones.",
        ok + " passam (1 + o burst de " + LAB.burst + "), " + limited + " recebem 429 da borda: o limit_req permite " + LAB.limit + " req/s por chave. O gateway e as réplicas nunca veem as recusadas."]
        : ["All " + ok + " pass: without X-Api-Key the key is empty and Nginx does not limit it (production would also limit per client IP).",
          "Todas as " + ok + " passam: sem X-Api-Key a chave fica vazia e o Nginx não a limita (em produção haveria também um limite por IP do cliente)."] };
  }

  /* the lab's pages, step by step */
  var SCRIPTS = {
    curl: [
      { ops: [["register"]], en: "Register Ana: an open route, straight to auth.", pt: "Cadastre a Ana: uma rota aberta, direto para o auth." },
      { ops: [["login", "ana"]], en: "Log in: auth checks the BCrypt hash and signs a JWT.", pt: "Faça login: o auth confere o hash BCrypt e assina um JWT." },
      { ops: [["req", "GET", "/auth/me", "ana"]], en: "With the token: the gateway validates it and tells auth who is calling.", pt: "Com o token: o gateway o valida e diz ao auth quem está chamando." },
      { ops: [["req", "GET", "/auth/me", null, { code: true }]], en: "Without a token: 401, and auth never sees the request.", pt: "Sem token: 401, e o auth nem vê a requisição." },
      { ops: [["req", "DELETE", "/catalog/events/2", "ana", { code: true }]], en: "Ana tries to delete an event: a valid token, the wrong scope.", pt: "A Ana tenta apagar um evento: token válido, scope errado." },
      { ops: [["login", "admin"]], en: "Now as the administrator, created at startup.", pt: "Agora como administrador, criado na inicialização." },
      { ops: [["req", "PUT", "/catalog/events/2", "admin", { body: "{\"title\":\"Match #2 (rescheduled)\",…}" }]], en: "The admin token passes SCOPE_admin: the update reaches a catalog replica.", pt: "O token do admin passa SCOPE_admin: a atualização chega a uma réplica do catalog." },
      { ops: [["req", "GET", "/catalog/events/1", null], ["req", "GET", "/catalog/events/1", null], ["req", "GET", "/catalog/events/1", null]], en: "Anonymous reads of the catalog: open, and spread over the three replicas. The JWKS was downloaded once.", pt: "Leituras anônimas do catálogo: abertas e espalhadas pelas três réplicas. O JWKS foi baixado uma vez." }
    ],
    tokens: [
      { ops: [["register"], ["login", "ana"], ["login", "admin"]], en: "Ana and the administrator have tokens.", pt: "A Ana e o administrador têm tokens." },
      { ops: [["req", "GET", "/auth/me", "ana", { spoof: true }]], en: "Think first: Ana sends X-User-Id with the admin's id. The gateway replaces it.", pt: "Pense antes: a Ana manda X-User-Id com o id do admin. O gateway o substitui." },
      { ops: [["req", "GET", "/auth/me", null, { spoof: true, code: true }]], en: "The same header with no token: 401, the forged id goes nowhere.", pt: "O mesmo cabeçalho sem token: 401, o id forjado não vai a lugar nenhum." },
      { ops: [["forge"], ["req", "DELETE", "/catalog/events/2", "forged", { code: true }]], en: "A token with one change in the payload: the signature check fails.", pt: "Um token com uma mudança no payload: a verificação da assinatura falha." },
      { ops: [["req", "GET", "/catalog/events/1", "forged", { code: true }]], en: "Even on an open route: a token that is sent is validated.", pt: "Mesmo numa rota aberta: um token enviado é validado." },
      { ops: [["restartAuth", LAB.shortTtl], ["req", "GET", "/auth/me", "admin", { code: true }]], en: "Recreate auth with 30-second tokens: a new key pair. The admin's old token still passes.", pt: "Recrie o auth com tokens de 30 segundos: um novo par de chaves. O token antigo do admin ainda passa." },
      { ops: [["login", "ana"], ["req", "GET", "/auth/me", "ana", { code: true }]], en: "Ana logs in again: the first token with the new kid makes the gateway download the JWKS.", pt: "A Ana faz login de novo: o primeiro token com o kid novo faz o gateway baixar o JWKS." },
      { ops: [["req", "GET", "/auth/me", "admin", { code: true }]], en: "Now the admin's old token fails: its kid is no longer in the JWKS.", pt: "Agora o token antigo do admin falha: o kid dele não está mais no JWKS." },
      { ops: [["wait", LAB.shortTtl], ["req", "GET", "/auth/me", "ana", { code: true }]], en: "30 s later, Ana's token is past its exp, but within the 60 s of clock skew.", pt: "30 s depois, o token da Ana passou do exp, mas está dentro dos 60 s de tolerância de relógio." },
      { ops: [["wait", 120], ["req", "GET", "/auth/me", "ana", { code: true }]], en: "Two minutes later: expired for good.", pt: "Dois minutos depois: expirado de vez." },
      { ops: [["restartAuth", LAB.ttl]], en: "Back to one-hour tokens (log in again: the key changed once more).", pt: "De volta aos tokens de uma hora (faça login de novo: a chave mudou mais uma vez)." }
    ],
    edge: [
      { ops: [["req", "GET", "/actuator/health", null]], en: "Through the edge, /actuator is a 404 from Nginx.", pt: "Pela borda, /actuator é um 404 do Nginx." },
      { ops: [["req", "GET", "/actuator/health", null, { port: LAB.gatewayPort }]], en: "On port 8080, published only for the measurements, the gateway answers it.", pt: "Na porta 8080, publicada só para as medições, o gateway responde." },
      { ops: [["stop", "catalog-2"]], en: "Stop one replica.", pt: "Pare uma réplica." },
      { ops: [["req", "GET", "/catalog/events/1", null], ["req", "GET", "/catalog/events/1", null], ["req", "GET", "/catalog/events/1", null]], en: "Until the next probe, catalog-2 is still in the list: a GET that lands on it is retried on another instance.", pt: "Até a próxima sondagem, catalog-2 ainda está na lista: um GET que cai nela é repetido em outra instância." },
      { ops: [["wait", LAB.probe], ["req", "GET", "/catalog/events/1", null], ["req", "GET", "/catalog/events/1", null]], en: "After a probe (every 5 s), the balancer skips catalog-2: no retries needed.", pt: "Depois de uma sondagem (a cada 5 s), o balanceador pula catalog-2: sem novas tentativas." },
      { ops: [["stop", "catalog-2", true], ["wait", LAB.probe]], en: "Start it again: back in the list at the next probe.", pt: "Inicie-a de novo: volta à lista na próxima sondagem." },
      { ops: [["burst", 50, "partner-1"]], en: "50 requests at once with an API key: the edge's limit_req answers part of them.", pt: "50 requisições de uma vez com uma API key: o limit_req da borda responde parte delas." },
      { ops: [["wait", 2], ["burst", 50, null]], en: "The same 50 without X-Api-Key: not limited at all.", pt: "As mesmas 50 sem X-Api-Key: nenhum limite." }
    ]
  };
  var OPS = {
    register: register, login: login, forge: forge, restartAuth: restartAuth, wait: wait, burst: burst,
    req: function (st, m, p, cred, o) { return request(st, m, p, cred, o); },
    stop: function (st, name, on) { return stopReplica(st, name, on); }
  };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function play(name, n) {
    var st = create(), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { LAB: LAB, REPLICAS: REPLICAS, T0: T0, ANA: ANA, ADMIN: ADMIN, SCRIPTS: SCRIPTS, create: create, run: run, play: play,
    request: request, register: register, login: login, forge: forge, restartAuth: restartAuth, wait: wait, stopReplica: stopReplica, burst: burst,
    issue: issue, verify: verify, serialize: serialize, advance: advance };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s;
  function L(pair) { return pair ? (C.PT ? pair[1] : pair[0]) : ""; }

  C.style("front-door", [
    ".md-typeset .csim-log.csim-fd-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; word-break: break-all; }",
    ".md-typeset .csim-log.csim-fd-term li b { font-weight: 600; }",
    ".md-typeset .csim-fd-acts .csim-btn { font-family: var(--md-code-font-family, monospace); font-size: .62rem; }"
  ].join("\n"));

  C.register("front-door", function (root) {
    var o = C.opts(root, { script: "curl" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, cred = null;

    var svg = s("svg", { viewBox: "0 0 640 244", role: "img", "aria-label": t("The lab's front door: edge, gateway, auth and catalog", "A porta de entrada do lab: borda, gateway, auth e catalog") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-fd-term";
    var tiles = C.stats([
      { key: "last", label: t("last answer, and who gave it", "última resposta e quem a deu") },
      { key: "reached", label: t("requests that reached catalog", "requisições que chegaram ao catalog") },
      { key: "rejected", label: t("rejected before the services", "recusadas antes dos serviços") },
      { key: "jwks", label: t("JWKS downloads by the gateway", "downloads do JWKS pelo gateway") }
    ]);
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) { term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone); }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "curl", label: t("Try it end to end", "Teste de ponta a ponta") },
      { value: "tokens", label: t("Failure cases", "Casos de falha") },
      { value: "edge", label: t("Edge and replicas", "Borda e réplicas") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });
    var cCred = C.choice({ label: "Authorization", value: "none", options: [
      { value: "none", label: t("none", "nenhum") }, { value: "ana", label: "$TOKEN (Ana)" }, { value: "admin", label: "$ADMIN" }, { value: "forged", label: "$FORGED" }
    ], onChange: function (v) { cred = v === "none" ? null : v; } });

    function act(fn) { return function () { player.pause(); var r = fn(); if (r) { show(r); say(r.note, r.tone); } draw(); }; }
    var acts = [
      C.button("GET /catalog/events/1", act(function () { return request(st, "GET", "/catalog/events/1", cred); }), { tone: "ok" }),
      C.button("PUT /catalog/events/2", act(function () { return request(st, "PUT", "/catalog/events/2", cred, { body: "{\"title\":\"Match #2 (rescheduled)\",…}" }); })),
      C.button("DELETE /catalog/events/2", act(function () { return request(st, "DELETE", "/catalog/events/2", cred, { code: true }); }), { tone: "bad" }),
      C.button("GET /auth/me", act(function () { return request(st, "GET", "/auth/me", cred); })),
      C.button(t("/auth/me + forged X-User-Id", "/auth/me + X-User-Id forjado"), act(function () { return request(st, "GET", "/auth/me", cred, { spoof: true }); })),
      C.button("/actuator/health :80", act(function () { return request(st, "GET", "/actuator/health", null); })),
      C.button("/actuator/health :8080", act(function () { return request(st, "GET", "/actuator/health", null, { port: LAB.gatewayPort }); }))
    ];
    var cmds = [
      C.button(t("register Ana", "cadastrar Ana"), act(function () { return register(st); })),
      C.button(t("login Ana", "login Ana"), act(function () { return login(st, "ana"); }), { tone: "ok" }),
      C.button(t("wrong password", "senha errada"), act(function () { return login(st, "ana", true); })),
      C.button(t("login admin", "login admin"), act(function () { return login(st, "admin"); })),
      C.button(t("forge $FORGED", "forjar $FORGED"), act(function () { return forge(st); }), { tone: "bad" }),
      C.button("restart auth", act(function () { return restartAuth(st); })),
      C.button("JWT_TTL=PT30S", act(function () { return restartAuth(st, LAB.shortTtl); })),
      C.button("+30 s", act(function () { return wait(st, 30); })),
      C.button("+2 min", act(function () { return wait(st, 120); })),
      C.button(t("stop/start catalog-2", "parar/iniciar catalog-2"), act(function () { return stopReplica(st, "catalog-2", !st.up["catalog-2"]); })),
      C.button(t("50 at once + X-Api-Key", "50 de uma vez + X-Api-Key"), act(function () { return burst(st, 50, "partner-1"); }))
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
        ? ["Pick the Authorization header, then send a request; the other buttons are the lab's commands. The highlighted path shows how far each request got.",
           "Escolha o cabeçalho Authorization e mande uma requisição; os outros botões são os comandos do lab. O caminho destacado mostra até onde cada requisição chegou."]
        : ["The stack of lab 4, started: the admin exists, Ana does not yet, the gateway has no JWKS. Press play or → to run the page's commands; the buttons work at any time.",
           "A pilha do lab 4, no ar: o admin existe, a Ana ainda não, o gateway não tem JWKS. Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento."], "");
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
    function line(x, y, txt, cls) { svg.appendChild(s("text", { x: x, y: y, class: "c-small" + (cls ? " " + cls : "") }, txt)); }
    function wire(x1, y1, x2, y2, on, cut) {
      svg.appendChild(s("path", { d: "M" + x1 + "," + y1 + " C" + (x1 + 22) + "," + y1 + " " + (x2 - 22) + "," + y2 + " " + x2 + "," + y2, class: "c-wire" + (cut ? " cut" : on ? " on" : "") }));
    }
    function tone(name) {
      var l = st.last;
      if (!l) return "on";
      if (l.by === name) return l.status < 300 ? "ok" : l.status < 500 ? "warn" : "bad";
      return l.hops.indexOf(name) >= 0 ? "hot" : "on";
    }
    function tokLine(k, label) {
      var tk = st.tokens[k];
      if (!tk) return label + ": –";
      var left = tk.exp - st.t;
      return label + " " + tk.kid.slice(0, 4) + " · " + (left > 0 ? left + " s" : t("expired", "expirado"));
    }

    function draw() {
      C.clear(svg);
      var l = st.last, hops = l ? l.hops : [], direct = l && hops[0] === "gateway";
      /* client */
      box(6, 70, 118, 92, "on", "curl");
      line(14, 104, tokLine("ana", "$TOKEN"));
      line(14, 120, tokLine("admin", "$ADMIN"));
      line(14, 136, st.tokens.forged ? t("$FORGED: scope edited", "$FORGED: scope editado") : "$FORGED: –", st.tokens.forged ? "c-bad" : "");
      line(14, 154, "t = " + st.t, "c-mono");
      /* edge */
      box(146, 84, 96, 64, tone("edge"), "edge", ":" + LAB.edgePort);
      line(154, 118, "Nginx");
      line(154, 134, "limit_req " + LAB.limit + "r/s");
      wire(124, 116, 146, 116, hops.indexOf("edge") >= 0);
      /* the direct path to :8080 */
      svg.appendChild(s("path", { d: "M124,150 C150,190 230,190 270,170", class: "c-wire dashed" + (direct ? " on" : "") }));
      line(160, 196, ":" + LAB.gatewayPort + t(" (published for experiments)", " (publicada para experimentos)"));
      /* gateway */
      box(264, 50, 132, 132, tone("gateway"), "gateway", ":" + LAB.gatewayPort);
      line(272, 84, t("1 strip X-User-*", "1 remove X-User-*"));
      line(272, 100, t("2 JWT: ", "2 JWT: ") + (st.gw.jwks ? "kid " + st.gw.jwks[0].slice(0, 4) : t("no JWKS yet", "sem JWKS ainda")));
      line(272, 116, t("3 rules, in order", "3 regras, em ordem"));
      line(272, 132, t("4 route, lb://catalog", "4 rota, lb://catalog"));
      line(272, 150, t("listed: ", "na lista: ") + st.healthy.map(function (r) { return r.slice(-1); }).join(" ") , "c-mono");
      line(272, 168, t("retry GET ×", "repete GET ×") + LAB.retries + t(" · probe ", " · sonda ") + LAB.probe + " s");
      wire(242, 116, 264, 116, hops.indexOf("gateway") >= 0 && !direct);
      /* auth */
      box(420, 6, 214, 48, tone("auth"), "auth", ":" + LAB.authPort);
      line(428, 40, "kid " + st.auth.kid.slice(0, 4) + " · JWT_TTL " + st.auth.ttl + " s · " + Object.keys(st.users).length + (Object.keys(st.users).length > 1 ? t(" users", " usuários") : t(" user", " usuário")));
      wire(396, 80, 420, 30, hops.indexOf("auth") >= 0);
      /* catalog replicas */
      REPLICAS.forEach(function (r, i) {
        var y = 68 + i * 56, up = st.up[r], listed = st.healthy.indexOf(r) >= 0;
        box(420, y, 214, 46, up ? tone(r) : "down", r, ":" + LAB.catalogPort);
        line(428, y + 34, up ? (listed ? t("up · in the balancer's list", "no ar · na lista do balanceador") : t("up · joins at the next probe", "no ar · entra na próxima sondagem"))
          : (listed ? t("stopped · still listed!", "parada · ainda na lista!") : t("stopped · skipped", "parada · pulada")), up ? "" : listed ? "c-bad" : "c-warn");
        wire(396, 116 + (i - 1) * 14, 420, y + 23, hops.indexOf(r) >= 0, !up && hops.indexOf(r) >= 0);
      });
      line(6, 240, t("highlighted: how far the last request got · green, orange or red: who answered", "destacado: até onde a última requisição chegou · verde, laranja ou vermelho: quem respondeu"));
      tiles.set("last", l ? (l.burst ? (l.status === 429 ? "429" : "200") : l.status) + " · " + l.by : "–", l ? (l.status < 300 ? "ok" : l.status < 500 ? "warn" : "bad") : "");
      tiles.set("reached", String(st.reached), "");
      tiles.set("rejected", String(st.rejected), st.rejected ? "warn" : "");
      tiles.set("jwks", String(st.gw.fetches), st.gw.fetches > 1 ? "warn" : st.gw.fetches ? "ok" : "");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's front door, without Docker: who answers each request",
        "A porta de entrada do lab, sem Docker: quem responde cada requisição") }),
      el("p", { class: "csim-sub", text: t("Each button is a request or a command of lab 4. The highlighted path shows how far the request got; the box that answered turns green (2xx), orange (4xx) or red (5xx).",
        "Cada botão é uma requisição ou um comando do lab 4. O caminho destacado mostra até onde a requisição chegou; a caixa que respondeu fica verde (2xx), laranja (4xx) ou vermelha (5xx).") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, [cCred]),
      el("div", { class: "csim-row csim-fd-acts" }, acts),
      el("div", { class: "csim-row" }, cmds),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
