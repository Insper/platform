/*
 * The security layer of hands-on 3 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="jwt-gateway" data-script="test"></div>
 *
 * curl → gateway:8080 (RemoveRequestHeader=id-account, the routes /accounts/** and /auth/**,
 * RouterValidator, AuthorizationFilter) → auth:8080 (AuthService, JwtService) → account:8080 → db, as
 * the lab builds them. Every button is a request of the lab and prints what the stack answers; the
 * tokens are real HS256 JWTs signed with the development default of auth's application.yaml, so the
 * first login issues exactly the example token of the JWT page (same id, 13:00:00 UTC). A script
 * (data-script) replays the lab: "test" (section 5 of Authorization) or "tokens" (wrong password,
 * a forged id-account header, an edited payload, a token forged with the public default key, an
 * expired cookie, logout); "free" leaves only the buttons.
 *
 * The clock moves 1 s per request (and +30 min on demand). curl drops a cookie of cookies.txt once its
 * Max-Age has passed, as the browser does, so an expired token only reaches auth when sent by hand.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ bytes, Base64, SHA-256, HMAC */

  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return Array.prototype.slice.call(new TextEncoder().encode(str));
    return unescape(encodeURIComponent(str)).split("").map(function (c) { return c.charCodeAt(0); });
  }
  function fromUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(new Uint8Array(bytes));
    return decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)));
  }
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64(bytes, url) {
    var out = "", i;
    for (i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
    }
    return url ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
  }
  function unb64(str) {
    var s = str.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, ""), out = [], buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64.indexOf(s[i]);
      if (v < 0) throw new Error("not Base64");
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return out;
  }
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(bytes) {
    var m = bytes.slice(), len = bytes.length * 8, H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    for (var b = 7; b >= 0; b--) m.push(b >= 4 ? 0 : (len >>> (b * 8)) & 255);
    var w = new Array(64);
    for (var off = 0; off < m.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H = [H[0] + a, H[1] + bb, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h].map(function (v) { return v | 0; });
    }
    var out = [];
    H.forEach(function (v) { out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); });
    return out;
  }
  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    var k = key.concat(new Array(64 - key.length).fill(0));
    var ipad = k.map(function (v) { return v ^ 0x36; }), opad = k.map(function (v) { return v ^ 0x5c; });
    return sha256(opad.concat(sha256(ipad.concat(msg))));
  }

  /* ------------------------------------------------------------------ the lab's values */

  var COOKIE = "__store_jwt_token";                   /* AuthController.AUTH_COOKIE_TOKEN */
  var OPEN = ["POST /auth/register", "GET /auth/logout", "POST /auth/login"];  /* RouterValidator */
  var ROUTES = [{ id: "account-service", uri: "http://account:8080", path: "/accounts/**", svc: "account" },
    { id: "auth-service", uri: "http://auth:8080", path: "/auth/**", svc: "auth" }];
  var DURATION = 3600000;                              /* store.jwt.duration, ms */
  var KEYS = {
    "default": "EBwrdOOcAIDRLON9hbJV0+O3PTdfTjgMCQIxwLH7ws8=",   /* the development default of application.yaml */
    own: "PXUUb2e+ajbrLM2ZGH3Zeg+gwiFCfF40WNfuOfzDN7k=",         /* openssl rand -base64 32 */
    attacker: "c29tZWJvZHkgZWxzZSdzIDMyLWJ5dGUga2V5ISEhISE="
  };
  var ISSUER = "Insper::PMA";
  var T0 = 1787576400;                                 /* the example token's nbf: 2026-08-24 13:00:00 UTC */
  var USERS = {
    antonio: { id: "5f3c9a2e-8b1d-4c7a-9e6f-2a4b8c1d3e5f", name: "Antonio do Estudo", email: "acme@insper.edu.br", password: "123@321" },
    ana: { id: "0b7e4d1c-2f6a-4e3b-8c5d-9a1f7e2b6c40", name: "Ana", email: "ana@insper.edu.br", password: "456@654" }
  };
  var HOSTNAME = "3f9c1e2d7a64";
  var URL0 = "http://localhost:8080";

  function calcHash(pw) { return b64(sha256(utf8(pw))); }   /* AccountService.calcHash: SHA-256, Base64 */
  function sign(header, payload, keyName) {
    var input = b64(utf8(JSON.stringify(header)), true) + "." + b64(utf8(JSON.stringify(payload)), true);
    return input + "." + b64(hmac(unb64(KEYS[keyName]), utf8(input)), true);
  }
  /* JwtService.generate: id, issuer, claims(email), subject, notBefore, expiration, in that order */
  function generate(acc, now, keyName) {
    return sign({ alg: "HS256" }, { jti: acc.id, iss: ISSUER, email: acc.email, sub: acc.name, nbf: now, exp: now + DURATION / 1000 }, keyName || "default");
  }
  function decode(jwt) {
    var p = String(jwt || "").split(".");
    if (p.length !== 3) return null;
    try { return { header: JSON.parse(fromUtf8(unb64(p[0]))), payload: JSON.parse(fromUtf8(unb64(p[1]))), sig: p[2] }; } catch (e) { return null; }
  }
  /* JwtService.getId: the parser checks the signature, nbf and exp, and getId turns a JwtException into 401 */
  function getId(jwt, keyName, now) {
    var p = String(jwt).split("."), d = decode(jwt);
    if (!d) return { err: "MalformedJwtException" };
    var good = b64(hmac(unb64(KEYS[keyName]), utf8(p[0] + "." + p[1])), true);
    if (good !== p[2]) return { err: "SignatureException", msg: "JWT signature does not match locally computed signature." };
    if (d.payload.nbf && now < d.payload.nbf) return { err: "PrematureJwtException" };
    if (d.payload.exp && now > d.payload.exp) return { err: "ExpiredJwtException", msg: "JWT expired " + (now - d.payload.exp) * 1000 + " milliseconds ago at " + iso(d.payload.exp) + "." };
    return { id: d.payload.jti };
  }

  /* RouterValidator.isSecured, line by line */
  function isSecured(method, path) {
    return OPEN.every(function (uri) {
      var parts = uri.replace(/[^a-zA-Z0-9/ *]/g, "").split(" ");
      var m = parts[0], p = parts[1], deep = /\/\*\*$/.test(p);
      var match = (m.toUpperCase() === "ANY" || method.toUpperCase() === m.toUpperCase()) &&
        (path === p || (deep && path.indexOf(p.replace("/**", "")) === 0));
      return !match;
    });
  }
  function route(path) {
    return ROUTES.filter(function (r) { var pre = r.path.replace("/**", ""); return path === pre || path.indexOf(pre + "/") === 0; })[0] || null;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clock(t) { var d = new Date(t * 1000); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()); }
  function iso(t) { return new Date(t * 1000).toISOString().replace(".000Z", "Z"); }
  function short(jwt) { return jwt ? jwt.slice(0, 20) + "…" + jwt.slice(-8) : ""; }
  function out(acc) { return { id: acc.id, name: acc.name, email: acc.email }; }

  function create() {
    return { now: T0 - 1, key: "default", accounts: [], jar: null, hand: null, lastId: null };
  }
  function account(st, by, v) { return st.accounts.filter(function (a) { return a[by] === v; })[0] || null; }

  /*
   * One curl through the gateway. o: { body, send: "jar" | "none" | "hand", forge: account id for a
   * hand-written id-account header, save: curl -c cookies.txt }. The result: the command, the status,
   * the response lines, the trace (hop, text, tone), and a note.
   */
  function request(st, method, path, o) {
    o = o || {};
    var send = o.send || "jar", cookie = null;
    if (st.jar && st.now > st.jar.expires) { st.jar.dropped = true; }
    if (send === "jar" && st.jar && !st.jar.dropped) cookie = st.jar.value;
    if (send === "hand") cookie = st.hand;
    if (cookie) st.shown = { jwt: cookie, src: send };
    var cmd = "$ curl" + (o.save ? " -c cookies.txt" : "") + (send === "jar" ? " -b cookies.txt" : send === "hand" ? " -b \"" + COOKIE + "=" + short(st.hand) + "\"" : "") +
      (method !== "GET" ? " -X " + method : "") + (o.body ? " -H \"Content-Type: application/json\"" : "") + (o.forge ? " -H \"id-account: " + o.forge + "\"" : "") + " " + URL0 + path +
      (o.body ? " -d '" + JSON.stringify(o.body) + "'" : "");
    var trace = [], res = { cmd: cmd, at: st.now, trace: trace, wires: ["client>gw"] };
    function hop(id, en, pt, tone) { trace.push({ hop: id, en: en, pt: pt, tone: tone || "" }); }
    function wire(k) { if (res.wires.indexOf(k) < 0) res.wires.push(k); }
    function done(status, lines, note, tone) {
      res.status = status; res.out = lines; res.note = note; res.tone = tone || (status < 300 ? "ok" : "bad");
      st.now += 1;
      return res;
    }
    hop("client", "cookie " + (cookie ? COOKIE + " sent" : "not sent") + (send === "jar" && st.jar && st.jar.dropped ? " (expired in cookies.txt: curl dropped it)" : ""),
      "cookie " + (cookie ? COOKIE + " enviado" : "não enviado") + (send === "jar" && st.jar && st.jar.dropped ? " (expirou em cookies.txt: o curl o descartou)" : ""), cookie ? "" : "warn");
    var headers = {};
    if (o.forge) headers["id-account"] = o.forge;

    /* the gateway's own endpoint: not a route, so no filter runs */
    if (path === "/health-check") {
      hop("gw", "GatewayResource: its own endpoint, not a route — AuthorizationFilter does not run", "GatewayResource: endpoint próprio, não é rota — o AuthorizationFilter não roda", "ok");
      return done(200, ["{\"hostname\":\"" + HOSTNAME + "\"}"], ["The Gateway's own health check answers without a cookie: it is not a route.", "O health check do próprio Gateway responde sem cookie: não é uma rota."]);
    }
    var r = route(path);
    if (!r) {
      hop("gw", "no route matches " + path, "nenhuma rota casa com " + path, "bad");
      return done(404, ["{\"status\":404,\"error\":\"Not Found\",\"path\":\"" + path + "\"}"], ["No route: 404.", "Nenhuma rota: 404."]);
    }
    if (headers["id-account"]) {
      delete headers["id-account"];
      hop("gw", "RemoveRequestHeader=id-account: the client's id-account is dropped", "RemoveRequestHeader=id-account: o id-account do cliente é descartado", "warn");
    } else hop("gw", "default-filters, then route " + r.id + " (Path=" + r.path + ")", "default-filters e depois a rota " + r.id + " (Path=" + r.path + ")");
    var secured = isSecured(method, path);
    wire("gw>rv"); wire("rv>af");
    hop("rv", "isSecured(" + method + " " + path + ") = " + secured, "isSecured(" + method + " " + path + ") = " + secured, secured ? "" : "ok");
    var solved = null;
    if (secured) {
      if (!cookie) {
        hop("af", "no cookie " + COOKIE + ": 401", "sem cookie " + COOKIE + ": 401", "bad");
        return done(401, ["{\"status\":401,\"error\":\"Unauthorized\",\"path\":\"" + path + "\"}"],
          send === "jar" && st.jar && st.jar.dropped
            ? ["401: the cookie's Max-Age (3600 s) has passed, so curl no longer sends it — the Gateway sees no cookie.", "401: o Max-Age do cookie (3600 s) passou, então o curl não o envia mais — o Gateway não vê cookie."]
            : ["401: a secured route and no cookie. The filter stops the request before any service.", "401: rota protegida e sem cookie. O filtro barra a requisição antes de qualquer serviço."]);
      }
      hop("af", "cookie present: POST http://auth:8080/auth/solve", "cookie presente: POST http://auth:8080/auth/solve");
      wire("af>auth");
      var g = getId(cookie, st.key, st.now);
      if (g.err) {
        hop("auth", "JwtService.getId: " + g.err + " → 401", "JwtService.getId: " + g.err + " → 401", "bad");
        hop("af", "onStatus(4xx): 401 Unauthorized", "onStatus(4xx): 401 Unauthorized", "bad");
        return done(401, ["{\"status\":401,\"error\":\"Unauthorized\",\"path\":\"" + path + "\"}"], {
          SignatureException: ["401: the signature does not match the payload under auth's key — the token was altered or signed with another key.", "401: a assinatura não confere com o payload sob a chave do auth — o token foi alterado ou assinado com outra chave."],
          ExpiredJwtException: ["401: " + g.msg, "401: " + g.msg],
          MalformedJwtException: ["401: not a JWT.", "401: não é um JWT."],
          PrematureJwtException: ["401: the token is not valid yet (nbf).", "401: o token ainda não vale (nbf)."]
        }[g.err]);
      }
      var who = account(st, "id", g.id);
      hop("auth", "JwtService.getId: signature, nbf and exp ok → {\"idAccount\":\"" + g.id.slice(0, 8) + "…\"}", "JwtService.getId: assinatura, nbf e exp ok → {\"idAccount\":\"" + g.id.slice(0, 8) + "…\"}", "ok");
      hop("af", "add header id-account: " + g.id.slice(0, 8) + "… (" + (who ? who.name : "?") + ")", "adiciona o header id-account: " + g.id.slice(0, 8) + "… (" + (who ? who.name : "?") + ")", "ok");
      headers["id-account"] = g.id;
      solved = g.id;
      st.lastId = g.id;
    } else hop("af", "open route: chain.filter(exchange), no cookie needed", "rota aberta: chain.filter(exchange), sem precisar de cookie", "ok");

    /* the services */
    wire("fwd>" + r.svc);
    if (r.svc === "account") {
      hop("account", method + " " + path, method + " " + path, "ok");
      if (method === "GET" && path === "/accounts") {
        hop("db", "SELECT … FROM account", "SELECT … FROM account", "ok");
        wire("account>db");
        return done(200, [JSON.stringify(st.accounts.map(out))], ["200: the cookie was valid; account answered with the header id-account set by the Gateway, never by the client.",
          "200: o cookie era válido; o account respondeu com o header id-account posto pelo Gateway, nunca pelo cliente."]);
      }
      var idm = path.match(/^\/accounts\/([^/]+)$/);
      if (method === "GET" && idm) {
        var a1 = account(st, "id", idm[1]);
        return a1 ? done(200, [JSON.stringify(out(a1))], ["200.", "200."]) : done(404, [""], ["404: no such account.", "404: conta inexistente."]);
      }
      return done(404, [""], ["404.", "404."]);
    }
    /* auth */
    if (method === "POST" && path === "/auth/register") {
      var b = o.body;
      hop("auth", "AuthService.create → POST http://account:8080/accounts", "AuthService.create → POST http://account:8080/accounts");
      wire("auth>account");
      if (account(st, "email", b.email)) {
        hop("account", "INSERT fails: email is UNIQUE → 500", "o INSERT falha: email é UNIQUE → 500", "bad");
        return done(500, ["{\"status\":500,\"error\":\"Internal Server Error\",\"path\":\"/auth/register\"}"],
          ["500: " + b.email + " already exists (the column is UNIQUE) and nothing turns the error into a 4xx.", "500: " + b.email + " já existe (a coluna é UNIQUE) e nada transforma o erro num 4xx."]);
      }
      var u = USERS[b.email === USERS.ana.email ? "ana" : "antonio"];
      var acc = { id: u.id, name: b.name, email: b.email, hash: calcHash(b.password) };
      st.accounts.push(acc);
      hop("account", "201 Created · hash_password = " + acc.hash.slice(0, 12) + "…", "201 Created · hash_password = " + acc.hash.slice(0, 12) + "…", "ok");
      hop("db", "INSERT INTO account", "INSERT INTO account", "ok");
      wire("account>db");
      return done(200, ["(empty body)"], ["200: the account exists; account stores only the SHA-256 of the password.", "200: a conta existe; o account guarda só o SHA-256 da senha."]);
    }
    if (method === "POST" && path === "/auth/login") {
      var l = o.body;
      hop("auth", "AuthService.login → POST http://account:8080/accounts/login", "AuthService.login → POST http://account:8080/accounts/login");
      wire("auth>account"); wire("account>db");
      var hit = st.accounts.filter(function (x) { return x.email === l.email && x.hash === calcHash(l.password); })[0];
      if (!hit) {
        hop("account", "findByEmailAndHashPassword: empty → 401", "findByEmailAndHashPassword: vazio → 401", "bad");
        hop("auth", "FeignException.Unauthorized → 401", "FeignException.Unauthorized → 401", "bad");
        return done(401, ["{\"status\":401,\"error\":\"Unauthorized\",\"path\":\"/auth/login\"}"], ["401, not 500: account found no email with that hash, and AuthService.login turns the Feign 401 into its own.",
          "401, não 500: o account não achou email com esse hash e o AuthService.login transforma o 401 do Feign no seu."]);
      }
      hop("account", "findByEmailAndHashPassword: found → AccountOut", "findByEmailAndHashPassword: achou → AccountOut", "ok");
      var jwt = generate(hit, st.now, st.key);
      hop("auth", "JwtService.generate: HS256, exp = nbf + 3600 s", "JwtService.generate: HS256, exp = nbf + 3600 s", "ok");
      if (o.save) { st.jar = { value: jwt, expires: st.now + DURATION / 1000, dropped: false }; st.shown = { jwt: jwt, src: "jar" }; }
      res.token = jwt;
      return done(200, ["Set-Cookie: " + COOKIE + "=" + short(jwt) + "; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=None"],
        ["200: the token is in cookies.txt, valid until " + clock(st.now + DURATION / 1000) + " UTC. Its payload is only Base64Url: anyone can read it, nobody can change it without the key.",
         "200: o token está em cookies.txt, válido até " + clock(st.now + DURATION / 1000) + " UTC. O payload é só Base64Url: qualquer um lê, ninguém altera sem a chave."]);
    }
    if (method === "GET" && path === "/auth/logout") {
      hop("auth", "AuthResource.logout: the same cookie, empty, Max-Age=0", "AuthResource.logout: o mesmo cookie, vazio, Max-Age=0", "ok");
      if (o.save) st.jar = null;
      return done(200, ["Set-Cookie: " + COOKIE + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None"],
        ["200: the cookie is gone from cookies.txt. The token itself stays valid until its exp: a JWT cannot be revoked, only expire.",
         "200: o cookie sumiu de cookies.txt. O token em si vale até o exp: um JWT não pode ser revogado, só expirar."]);
    }
    if (method === "GET" && path === "/auth/me") {
      var me = account(st, "id", headers["id-account"]);
      hop("auth", "AuthService.me(id-account) → GET http://account:8080/accounts/" + solved.slice(0, 8) + "…", "AuthService.me(id-account) → GET http://account:8080/accounts/" + solved.slice(0, 8) + "…", "ok");
      wire("auth>account"); wire("account>db");
      hop("account", me ? "AccountOut of " + me.name : "404", me ? "AccountOut de " + me.name : "404", me ? "ok" : "bad");
      if (send === "hand" && cookie === st.forgedTok) return done(200, [JSON.stringify(me ? out(me) : null)],
        ["200 as " + (me ? me.name : "?") + ": a forged token, accepted. Whoever has the key can be anyone.", "200 como " + (me ? me.name : "?") + ": um token forjado, aceito. Quem tem a chave pode ser qualquer um."], "bad");
      return done(200, [JSON.stringify(me ? out(me) : null)], o.forge
        ? ["The forged id-account header never arrived: the Gateway dropped it and set the token's own — " + (me ? me.name : "?") + ".", "O header id-account forjado nunca chegou: o Gateway o descartou e pôs o do token — " + (me ? me.name : "?") + "."]
        : [(me ? me.name : "?") + ": the account in the token's jti.", (me ? me.name : "?") + ": a conta do jti do token."]);
    }
    return done(404, [""], ["404.", "404."]);
  }

  /* the lab's commands */
  function register(st, who) {
    var u = USERS[who || "antonio"];
    return request(st, "POST", "/auth/register", { body: { name: u.name, email: u.email, password: u.password }, send: "none" });
  }
  function login(st, who, wrong) {
    var u = USERS[who || "antonio"];
    return request(st, "POST", "/auth/login", { body: { email: u.email, password: wrong ? "000@000" : u.password }, send: "none", save: true });
  }
  function logout(st) { return request(st, "GET", "/auth/logout", { save: true }); }
  function get(st, path, send, forge) { return request(st, "GET", path, { send: send || "jar", forge: forge }); }

  /* the token sent by hand (-b "__store_jwt_token=…"): copy it, edit it, forge it */
  function info(cmd, note, tone) { return { cmd: cmd, out: [], note: note, tone: tone || "info", trace: [] }; }
  function copy(st) {
    if (!st.jar) return info("# cookies.txt is empty", ["Log in first.", "Faça login antes."], "warn");
    st.hand = st.jar.value;
    st.shown = { jwt: st.hand, src: "hand" };
    return info("$ TOKEN=$(awk '/" + COOKIE + "/ {print $7}' cookies.txt)", ["The token of cookies.txt, to send by hand — curl will send it even after its Max-Age.", "O token de cookies.txt, para enviar à mão — o curl o envia mesmo depois do Max-Age."]);
  }
  function other(id) { return id === USERS.ana.id ? USERS.antonio : USERS.ana; }
  function editJti(st) {
    var d = decode(st.hand);
    if (!d) return info("# no token to edit", ["Copy a token first.", "Copie um token antes."], "warn");
    var victim = other(d.payload.jti), p = st.hand.split(".");
    d.payload.jti = victim.id; d.payload.sub = victim.name; d.payload.email = victim.email;
    st.hand = p[0] + "." + b64(utf8(JSON.stringify(d.payload)), true) + "." + p[2];
    st.shown = { jwt: st.hand, src: "hand" };
    return info("# payload edited: jti → " + victim.id.slice(0, 8) + "… (" + victim.name + "), signature kept",
      ["The payload now says " + victim.name + ", but the signature was computed over the old one.", "O payload agora diz " + victim.name + ", mas a assinatura foi calculada sobre o antigo."], "warn");
  }
  function forge(st, keyName) {
    var d = decode(st.hand) || decode(st.jar && st.jar.value);
    if (!d) return info("# no payload to sign", ["Copy a token first.", "Copie um token antes."], "warn");
    st.hand = sign(d.header, d.payload, keyName);
    st.forgedTok = st.hand;
    st.shown = { jwt: st.hand, src: "hand" };
    return info("# signed again with " + (keyName === "default" ? "the default key of application.yaml (public: it is in the repository)" : "a key of the attacker's own"),
      keyName === "default" ? ["Anyone who reads the repository has this key: the token is now a perfect forgery — if auth still uses it.", "Qualquer um que leia o repositório tem essa chave: o token agora é uma falsificação perfeita — se o auth ainda a usa."]
        : ["Signed with a key auth does not have.", "Assinado com uma chave que o auth não tem."], "warn");
  }
  function setKey(st, k) {
    st.key = k;
    return info("$ JWT_SECRET_KEY=" + (k === "default" ? "(unset: the default of application.yaml)" : "$(openssl rand -base64 32)") + " docker compose up -d auth",
      k === "default" ? ["auth signs and checks with the public development key.", "O auth assina e confere com a chave pública de desenvolvimento."]
        : ["auth now has a key of its own: every token signed before (and every forgery) stops working.", "O auth agora tem uma chave própria: todo token assinado antes (e toda falsificação) para de funcionar."]);
  }
  function wait(st, s) {
    st.now += s;
    return info("# " + s / 60 + " min later: " + clock(st.now) + " UTC", [clock(st.now) + " UTC.", clock(st.now) + " UTC."]);
  }

  var A = "antonio", N = "ana";
  var SCRIPTS = {
    test: [
      { ops: [["register", A]], en: "Register a new user: an open route, so no cookie is needed.", pt: "Registre um usuário: rota aberta, então nenhum cookie é necessário." },
      { ops: [["login", A]], en: "Log in and capture the cookie in cookies.txt: the token is the example of the JWT page, byte for byte.", pt: "Faça login e guarde o cookie em cookies.txt: o token é o exemplo da página JWT, byte a byte." },
      { ops: [["get", "/accounts", "jar"]], en: "A secured route with the cookie: 200.", pt: "Uma rota protegida com o cookie: 200." },
      { ops: [["get", "/accounts", "none"]], en: "The same route without the cookie: 401.", pt: "A mesma rota sem o cookie: 401." }
    ],
    tokens: [
      { ops: [["register", A], ["register", N]], en: "Two accounts: Antonio (the lab's) and Ana.", pt: "Duas contas: Antonio (a do lab) e Ana." },
      { ops: [["login", A, true]], en: "A wrong password is a 401, not a 500.", pt: "Senha errada é 401, não 500." },
      { ops: [["login", A], ["get", "/auth/me", "jar"]], en: "Log in as Antonio: /auth/me answers Antonio.", pt: "Login como Antonio: /auth/me responde Antonio." },
      { ops: [["get", "/auth/me", "jar", USERS.ana.id]], en: "Send id-account: <Ana's id> by hand: the Gateway drops it and keeps the token's.", pt: "Envie id-account: <id da Ana> à mão: o Gateway o descarta e mantém o do token." },
      { ops: [["copy"], ["editJti"], ["get", "/auth/me", "hand"]], en: "Edit the payload to say Ana: the signature no longer matches, 401.", pt: "Edite o payload para dizer Ana: a assinatura não confere mais, 401." },
      { ops: [["forge", "default"], ["get", "/auth/me", "hand"]], en: "Sign it again with the default key, which is in the repository: 200 as Ana. That is why the key must be your own.", pt: "Assine de novo com a chave padrão, que está no repositório: 200 como Ana. Por isso a chave tem de ser sua." },
      { ops: [["setKey", "own"], ["get", "/auth/me", "hand"]], en: "With JWT_SECRET_KEY of your own, the forgery is a 401.", pt: "Com um JWT_SECRET_KEY próprio, a falsificação é 401." },
      { ops: [["login", A], ["copy"], ["wait", 1800], ["get", "/accounts", "jar"]], en: "A new login under the new key; 30 min later the cookie still works.", pt: "Novo login sob a nova chave; 30 min depois o cookie ainda funciona." },
      { ops: [["wait", 1800], ["get", "/accounts", "jar"]], en: "Another 30 min: past the Max-Age, curl stops sending the cookie, 401.", pt: "Mais 30 min: passado o Max-Age, o curl para de enviar o cookie, 401." },
      { ops: [["get", "/accounts", "hand"]], en: "The same token by hand reaches auth: ExpiredJwtException, 401.", pt: "O mesmo token à mão chega ao auth: ExpiredJwtException, 401." },
      { ops: [["login", A], ["logout"], ["get", "/accounts", "jar"]], en: "Log in, log out: the cookie is cleared, 401.", pt: "Login e logout: o cookie é apagado, 401." }
    ]
  };
  var OPS = { register: register, login: login, logout: logout, get: get, copy: copy, editJti: editJti, forge: forge, setKey: setKey, wait: wait };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function play(name, n) {
    var st = create(), res = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { res.push(run(st, op)); }); });
    return { st: st, out: res };
  }

  var API = { COOKIE: COOKIE, OPEN: OPEN, ROUTES: ROUTES, DURATION: DURATION, KEYS: KEYS, ISSUER: ISSUER, T0: T0, USERS: USERS, SCRIPTS: SCRIPTS,
    sha256: sha256, hmac: hmac, b64: b64, unb64: unb64, utf8: utf8, calcHash: calcHash, generate: generate, decode: decode, getId: getId, isSecured: isSecured, route: route,
    clock: clock, create: create, request: request, register: register, login: login, logout: logout, get: get, copy: copy, editJti: editJti, forge: forge, setKey: setKey, wait: wait, run: run, play: play };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }

  C.style("jwt-gateway", [
    ".md-typeset .csim-jg-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; word-break: break-all; }",
    ".md-typeset .csim-jg-term li b { font-weight: 600; }",
    ".md-typeset .csim-jg-tok { font-family: var(--md-code-font-family, monospace); font-size: .62rem; line-height: 1.45; background: var(--c-panel); border: 1px solid var(--c-line); border-radius: 6px; padding: .4rem .55rem; margin: .4rem 0; word-break: break-all; white-space: pre-wrap; }",
    ".md-typeset .csim-jg-tok .h { color: var(--c-bad); }",
    ".md-typeset .csim-jg-tok .p { color: var(--c-accent); }",
    ".md-typeset .csim-jg-tok .g { color: var(--c-ok); }",
    ".md-typeset .csim-jg-tok .x { color: var(--c-fg3); }",
    ".md-typeset .csim-jg-reqs .csim-btn { font-family: var(--md-code-font-family, monospace); }"
  ].join("\n"));

  /* the boxes of the stack */
  var GROUP = { x: 116, y: 2, w: 236, h: 236 };
  var BOX = {
    client: { x: 4, y: 96, w: 88, h: 50, a: "curl", b: "cookies.txt" },
    gw: { x: 128, y: 24, w: 212, h: 50, a: "default-filters · routes", b: "RemoveRequestHeader=id-account" },
    rv: { x: 128, y: 98, w: 212, h: 50, a: "RouterValidator", b: "isSecured?" },
    af: { x: 128, y: 172, w: 212, h: 50, a: "AuthorizationFilter", b: "cookie → /auth/solve → id-account" },
    auth: { x: 410, y: 14, w: 136, h: 50, a: "auth :8080", b: "AuthService · JwtService" },
    account: { x: 410, y: 150, w: 136, h: 50, a: "account :8080", b: "/accounts · /accounts/login" },
    db: { x: 570, y: 150, w: 62, h: 50, a: "db", b: "postgres" }
  };
  /* the wires, as start and end points */
  function mid(b, side) { return side === "l" ? [b.x, b.y + b.h / 2] : side === "r" ? [b.x + b.w, b.y + b.h / 2] : side === "t" ? [b.x + b.w / 2, b.y] : [b.x + b.w / 2, b.y + b.h]; }
  var OUT = [GROUP.x + GROUP.w, GROUP.y + 122];
  var WIRES = {
    "client>gw": [mid(BOX.client, "r"), [GROUP.x, BOX.client.y + 25]],
    "gw>rv": [mid(BOX.gw, "b"), mid(BOX.rv, "t")],
    "rv>af": [mid(BOX.rv, "b"), mid(BOX.af, "t")],
    "af>auth": [mid(BOX.af, "r"), [BOX.auth.x, BOX.auth.y + BOX.auth.h - 10]],
    "fwd>auth": [OUT, [BOX.auth.x, BOX.auth.y + 14]],
    "fwd>account": [OUT, mid(BOX.account, "l")],
    "auth>account": [mid(BOX.auth, "b"), mid(BOX.account, "t")],
    "account>db": [mid(BOX.account, "r"), mid(BOX.db, "l")]
  };

  C.register("jwt-gateway", function (root) {
    var o = C.opts(root, { script: "test" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, last = null;

    var svg = s("svg", { viewBox: "0 0 636 240", role: "img", "aria-label": t("The security layer of the lab", "A camada de segurança do lab") });
    var note = el("p", { class: "csim-note" });
    var tok = el("div", { class: "csim-jg-tok" });
    var term = C.log(7); term.className += " csim-jg-term";
    var tiles = C.stats([
      { key: "status", label: t("last status", "último status") },
      { key: "jar", label: t("cookie in cookies.txt", "cookie em cookies.txt") },
      { key: "clock", label: t("clock (UTC)", "relógio (UTC)") },
      { key: "key", label: "JWT_SECRET_KEY" }
    ]);
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) {
      var lines = r.out.slice();
      if (r.status) lines.unshift("← " + r.status + " " + ({ 200: "OK", 401: "Unauthorized", 404: "Not Found", 500: "Internal Server Error" }[r.status] || ""));
      r.trace.forEach(function (h) { lines.push("  · " + h.hop + ": " + (PT ? h.pt : h.en)); });
      term.add(el("span", {}, [el("b", { text: r.cmd }), lines.length ? "\n" + lines.join("\n") : ""]), r.tone === "info" ? "" : r.tone);
      if (r.trace.length) last = r;
    }
    function act(fn) { return function () { player.pause(); var r = fn(); if (r) { show(r); say(r.note, r.tone); } draw(); }; }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "test", label: t("Authorization 5 (test)", "Autorização 5 (teste)") },
      { value: "tokens", label: t("bad tokens", "tokens ruins") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });
    var cWho = C.choice({ label: t("user", "usuário"), value: A, options: [{ value: A, label: "Antonio" }, { value: N, label: "Ana" }] });
    var cPw = C.choice({ label: t("password", "senha"), value: "right", options: [{ value: "right", label: t("right", "certa") }, { value: "wrong", label: t("wrong", "errada") }] });
    var cSend = C.choice({ label: "cookie", value: "jar", options: [
      { value: "jar", label: "-b cookies.txt" }, { value: "none", label: t("none", "nenhum") }, { value: "hand", label: t("token by hand", "token à mão") }], onChange: function () { draw(); } });
    var cForge = C.toggle({ label: t("-H \"id-account: <the other user>\"", "-H \"id-account: <o outro usuário>\""), checked: false });
    var cKey = C.choice({ label: "JWT_SECRET_KEY", value: "default", options: [
      { value: "default", label: t("default (public)", "padrão (pública)") }, { value: "own", label: t("your own", "sua própria") }],
      onChange: act(function () { return setKey(st, cKey.get()); }) });
    function forged() {
      if (!cForge.get()) return undefined;
      var mine = st.lastId || USERS[cWho.get()].id;
      return other(mine).id;
    }
    var reqs = el("div", { class: "csim-row csim-jg-reqs" }, [
      C.button("POST /auth/register", act(function () { return register(st, cWho.get()); })),
      C.button("POST /auth/login", act(function () { return login(st, cWho.get(), cPw.get() === "wrong"); }), { tone: "ok" }),
      C.button("GET /accounts", act(function () { return get(st, "/accounts", cSend.get(), forged()); })),
      C.button("GET /auth/me", act(function () { return get(st, "/auth/me", cSend.get(), forged()); })),
      C.button("GET /auth/logout", act(function () { return logout(st); })),
      C.button("GET /health-check", act(function () { return get(st, "/health-check", cSend.get()); }))
    ]);
    var hand = el("div", { class: "csim-row" }, [
      el("span", { class: "csim-lbl", text: t("Token by hand:", "Token à mão:") }),
      C.button(t("copy from cookies.txt", "copiar de cookies.txt"), act(function () { return copy(st); })),
      C.button(t("edit the payload: jti → the other user", "editar o payload: jti → o outro usuário"), act(function () { return editJti(st); }), { tone: "bad" }),
      C.button(t("sign with the default key", "assinar com a chave padrão"), act(function () { return forge(st, "default"); }), { tone: "bad" }),
      C.button(t("sign with another key", "assinar com outra chave"), act(function () { return forge(st, "attacker"); })),
      C.button("+30 min", act(function () { return wait(st, 1800); }))
    ]);

    var player = C.player({ interval: 1700, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });
    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "";
      sc[k - 1].ops.forEach(function (op) {
        var r = run(st, op); show(r);
        if (op[0] === "setKey") cKey.set(op[1]);
        if (r.tone === "bad" || r.tone === "warn") tone = r.tone;
      });
      say([sc[k - 1].en, sc[k - 1].pt], tone);
      draw();
    }
    function replay(k) {
      st = create(); term.clear(); last = null; cKey.set("default");
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      draw();
    }
    function intro() {
      say(script === "free"
        ? ["Every button is a curl of the lab through the Gateway at localhost:8080. Register and log in first.", "Cada botão é um curl do lab pelo Gateway em localhost:8080. Registre-se e faça login antes."]
        : ["The lab's stack, empty database, " + clock(st.now) + " UTC. Press play or → to run the page's commands; the buttons work at any time.",
           "A pilha do lab, banco vazio, " + clock(st.now) + " UTC. Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento."], "");
    }
    function reset() {
      st = create(); term.clear(); last = null;
      cKey.set("default"); cSend.set("jar"); cForge.set(false);
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro();
      draw();
    }

    function tokenView() {
      C.clear(tok);
      var sh = st.shown;
      if (!sh) { tok.appendChild(el("span", { class: "x", text: t("No token yet: log in.", "Nenhum token ainda: faça login.") })); return; }
      var jwt = sh.jwt, p = jwt.split("."), d = decode(jwt), g = getId(jwt, st.key, st.now);
      var src = sh.src === "hand" ? t("the token by hand (-b \"" + COOKIE + "=…\")", "o token à mão (-b \"" + COOKIE + "=…\")") : t("cookie " + COOKIE + " in cookies.txt", "cookie " + COOKIE + " em cookies.txt");
      C.add(tok, [el("span", { class: "x", text: src + "\n" }), el("span", { class: "h", text: p[0] }), ".", el("span", { class: "p", text: p[1] }), ".", el("span", { class: "g", text: p[2] }),
        el("span", { class: "x", text: "\n" }), el("span", { class: "h", text: JSON.stringify(d.header) }), "  ", el("span", { class: "p", text: JSON.stringify(d.payload) }),
        el("span", { class: "x", text: "\nnbf " + clock(d.payload.nbf) + " · exp " + clock(d.payload.exp) + " UTC · " +
          (g.err ? (g.err === "SignatureException" ? t("❌ signature does not match auth's key", "❌ a assinatura não confere com a chave do auth") : "❌ " + g.err)
            : t("✅ signature ok under auth's key, not expired", "✅ assinatura ok com a chave do auth, não expirou")) })]);
    }

    function draw() {
      C.clear(svg);
      var hops = {}, status = last ? last.status : 0, on = last ? last.wires : [];
      if (last) last.trace.forEach(function (h) { hops[h.hop] = h.tone === "bad" || hops[h.hop] === "bad" ? "bad" : "hot"; });
      svg.appendChild(s("rect", { x: GROUP.x, y: GROUP.y, width: GROUP.w, height: GROUP.h, rx: 9, class: "c-box" + (last ? " on" : "") }));
      svg.appendChild(s("text", { x: GROUP.x + 10, y: GROUP.y + 15, class: "c-label" }, "gateway :8080"));
      Object.keys(WIRES).forEach(function (k) {
        var a = WIRES[k][0], b = WIRES[k][1], vertical = Math.abs(a[0] - b[0]) < 1 || k === "af>auth" || k === "auth>account";
        var d = vertical && k !== "af>auth" ? "M" + a[0] + "," + a[1] + " L" + b[0] + "," + b[1]
          : k === "af>auth" ? "M" + a[0] + "," + a[1] + " H" + (GROUP.x + GROUP.w + 22) + " V" + b[1] + " H" + b[0]
          : "M" + a[0] + "," + a[1] + " C" + (a[0] + (b[0] - a[0]) / 2) + "," + a[1] + " " + (a[0] + (b[0] - a[0]) / 2) + "," + b[1] + " " + b[0] + "," + b[1];
        svg.appendChild(s("path", { d: d, class: "c-wire" + (on.indexOf(k) >= 0 ? " on" : "") }));
      });
      svg.appendChild(s("text", { x: 358, y: 216, class: "c-small" }, "/auth/solve"));
      svg.appendChild(s("text", { x: OUT[0] + 4, y: OUT[1] - 6, class: "c-small" }, t("forward", "repassa")));
      Object.keys(BOX).forEach(function (k) {
        var b = BOX[k], tone = hops[k] || "";
        var cls = "c-box " + (tone === "bad" ? "bad" : tone === "hot" ? (k === "client" ? (status >= 400 || last.tone === "bad" ? "bad" : "ok") : "hot") : "on");
        svg.appendChild(s("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 7, class: cls }));
        svg.appendChild(s("text", { x: b.x + b.w / 2, y: b.y + 20, "text-anchor": "middle", class: "c-label" }, b.a));
        svg.appendChild(s("text", { x: b.x + b.w / 2, y: b.y + 36, "text-anchor": "middle", class: "c-small" }, b.b));
      });
      if (last) svg.appendChild(s("text", { x: BOX.client.x + BOX.client.w / 2, y: BOX.client.y + BOX.client.h + 18, "text-anchor": "middle",
        class: "c-label " + (status >= 400 || last.tone === "bad" ? "c-bad" : "c-ok") }, String(status || "")));
      tiles.set("status", last ? String(last.status) : "–", last ? (last.status < 300 && last.tone !== "bad" ? "ok" : "bad") : "");
      var jar = st.jar ? (st.now > st.jar.expires ? t("expired", "expirado") : t("until ", "até ") + clock(st.jar.expires)) : t("none", "nenhum");
      tiles.set("jar", jar, st.jar ? (st.now > st.jar.expires ? "warn" : "ok") : "");
      tiles.set("clock", clock(st.now), "");
      tiles.set("key", st.key === "default" ? t("default", "padrão") : t("own", "própria"), st.key === "default" ? "warn" : "ok");
      tokenView();
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's security layer, without Docker: login, the JWT cookie and the Gateway's filter",
        "A camada de segurança do lab, sem Docker: login, o cookie JWT e o filtro do Gateway") }),
      el("p", { class: "csim-sub", text: t("Each button is a curl of the lab through the Gateway; the boxes light up along the path the request took. The tokens are real HS256 JWTs: paste one into jwt.io with the key of application.yaml.",
        "Cada botão é um curl do lab pelo Gateway; as caixas acendem pelo caminho que a requisição fez. Os tokens são JWTs HS256 de verdade: cole um no jwt.io com a chave do application.yaml.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      tok,
      reqs,
      el("div", { class: "csim-row" }, [cWho, cPw, cSend, cForge]),
      hand,
      el("div", { class: "csim-row" }, [cKey]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
