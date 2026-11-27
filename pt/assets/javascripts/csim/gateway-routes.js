/*
 * The gateway of hands-on 2 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="gateway-routes" data-script="verify"></div>
 *
 * A request to localhost:8080 meets what the lab's gateway-service holds: its own endpoint
 * (GatewayResource, GET /health-check), then the routes of application.yaml in order (insper-service,
 * Path=/insper/**; account-service, Path=/accounts/**), the default filter RemoveRequestHeader=id-account
 * and the globalcors origins. The first route whose Path predicate matches forwards the whole path to its
 * uri; no match is 404. Behind account-service sits the account container of compose.yaml (no published
 * port): stopped, the route answers 500; from the host, account cannot even be resolved.
 * A script (data-script="verify") replays the page's checks step by step; "free" leaves the console.
 *
 * Path patterns as Spring's PathPattern reads them: /accounts/** matches /accounts and /accounts/…,
 * not /account nor /accountsX. The account behind the route answers as the code of hands-on 1 does,
 * with an empty table: GET /accounts is [], an id is 404, DELETE is 204.
 */
(function () {
  "use strict";

  var PORT = 8080;
  var HOSTNAME = "3f2a9c1d7b4e";            /* Docker sets HOSTNAME to the short container id */
  /* spring.cloud.gateway.server.webflux in application.yaml */
  var ROUTES = [
    { id: "insper-service", uri: "https://www.insper.edu.br", path: "/insper/**" },
    { id: "account-service", uri: "http://account:8080", path: "/accounts/**" }
  ];
  var OWN = { method: "GET", path: "/health-check", handler: "GatewayResource" };
  var ORIGINS = ["http://localhost", "http://localhost:3000", "http://localhost:8080"];
  var REMOVED = "id-account";
  var STATUS = { 200: "OK", 204: "No Content", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 500: "Internal Server Error" };

  function create() { return { accountUp: true, sent: 0 }; }

  /* a Path predicate: "/x/**" is /x itself or anything under /x/ */
  function matches(pattern, path) {
    var p = path.split("?")[0];
    if (pattern.slice(-3) === "/**") { var base = pattern.slice(0, -3); return p === base || p.indexOf(base + "/") === 0; }
    return p === pattern;
  }

  function errBody(status, path) { return '{"timestamp":"…","path":"' + path + '","status":' + status + ',"error":"' + STATUS[status] + '"}'; }

  /* what the account container answers (hands-on 1, empty table) */
  function account(method, path) {
    var p = path.split("?")[0], segs = p.split("/").slice(1);
    if (segs.length === 1) return method === "GET" ? { status: 200, body: "[]" } : { status: 405, body: errBody(405, p) };
    if (segs.length === 2 && segs[1]) {
      if (method === "DELETE") return { status: 204, body: "" };
      if (segs[1] === "health-check") return { status: 200, body: "" };
      return { status: 404, body: errBody(404, p) };
    }
    return { status: 404, body: errBody(404, p) };
  }

  /*
   * One request. q: {method, path, origin, idAccount, direct}. The result: the checks in order (each
   * { kind: "own" | "route", id, hit }), the route that matched, the URL it forwarded to, the headers
   * that went on, the status and body, a note and a tone.
   */
  function request(st, q) {
    st.sent++;
    var method = q.method || "GET", path = q.path || "/", p = path.split("?")[0];
    var r = { method: method, path: path, origin: q.origin || null, idAccount: !!q.idAccount, direct: !!q.direct, checks: [], headers: {}, sent: [], body: "" };
    function done(status, tone, note) { r.status = status; r.text = STATUS[status] || ""; r.tone = tone; r.note = note; return r; }
    if (r.direct) {
      r.status = null; r.text = ""; r.tone = "bad"; r.err = "curl: (6) Could not resolve host: account";
      r.note = ["From the host, account does not exist: it is a name inside the Compose network, and it publishes no port. Only the gateway is reachable.",
        "Do host, account não existe: é um nome dentro da rede do Compose e não publica porta. Só o gateway é alcançável."];
      return r;
    }
    /* 1. the gateway's own controller */
    var own = p === OWN.path;
    r.checks.push({ kind: "own", id: OWN.handler, hit: own && method === OWN.method });
    if (own) {
      if (method !== OWN.method) return done(405, "warn", ["/health-check exists only for GET in GatewayResource: 405.", "/health-check só existe para GET em GatewayResource: 405."]);
      r.handler = OWN.handler;
      r.body = '{"hostname":"' + HOSTNAME + '"}';
      return done(200, "ok", ["GatewayResource answers itself, with the container's hostname: no route is involved.", "O GatewayResource responde ele mesmo, com o hostname do container: nenhuma rota entra em jogo."]);
    }
    /* 2. the routes, in order: the first match wins */
    var route = null;
    ROUTES.forEach(function (rt) {
      if (route) { r.checks.push({ kind: "route", id: rt.id, hit: false, skipped: true }); return; }
      var hit = matches(rt.path, path);
      r.checks.push({ kind: "route", id: rt.id, hit: hit });
      if (hit) route = rt;
    });
    if (!route) r.body = errBody(404, p);
    if (!route) return done(404, "warn", ["No route's Path predicate matches " + p + ": the gateway itself answers 404. A predicate is a pattern, not a prefix: /accounts/** does not match /account.",
      "Nenhum predicado Path casa com " + p + ": o próprio gateway responde 404. Um predicado é um padrão, não um prefixo: /accounts/** não casa com /account."]);
    r.route = route;
    /* 3. globalcors, for the routes */
    if (r.origin) {
      if (ORIGINS.indexOf(r.origin) < 0) {
        r.body = "Invalid CORS request";
        return done(403, "bad", ["Origin " + r.origin + " is not in allowedOrigins: the gateway refuses before forwarding (403). Set CORS_ALLOWED_ORIGINS for your front end.",
          "A origem " + r.origin + " não está em allowedOrigins: o gateway recusa antes de encaminhar (403). Ajuste CORS_ALLOWED_ORIGINS para o seu front end."]);
      }
      r.headers["Access-Control-Allow-Origin"] = r.origin;
      r.headers["Access-Control-Allow-Credentials"] = "true";
    }
    /* 4. default filters, then forward the whole path */
    r.forward = route.uri + path;
    r.sent = ["Host: " + route.uri.replace(/^https?:\/\//, "")];
    if (r.idAccount) r.removed = REMOVED;
    if (route.id === "insper-service") {
      r.upstream = "www.insper.edu.br";
      r.status = null; r.text = ""; r.tone = "info";
      r.note = ["Forwarded to " + r.forward + ": the whole path goes on, /insper included (a StripPrefix=1 filter would drop it). What comes back is Insper's answer.",
        "Encaminhado para " + r.forward + ": o caminho inteiro segue, /insper incluído (um filtro StripPrefix=1 o removeria). O que volta é a resposta do Insper."];
      return r;
    }
    r.upstream = "account";
    if (!st.accountUp) {
      r.body = errBody(500, p);
      r.err = "Failed to resolve 'account'";
      return done(500, "bad", ["The route matched, but the account container is not running: the gateway cannot reach http://account:8080 and answers 500.",
        "A rota casou, mas o container account não está rodando: o gateway não alcança http://account:8080 e responde 500."]);
    }
    var a = account(method, path);
    r.body = a.body;
    return done(a.status, a.status < 300 ? "ok" : "warn", r.removed
      ? ["account-service forwarded to " + r.forward + " without the id-account header the client sent: only the gateway may set it (hands-on 3).",
         "account-service encaminhou para " + r.forward + " sem o cabeçalho id-account que o cliente mandou: só o gateway pode defini-lo (hands-on 3)."]
      : r.origin
        ? ["Origin " + r.origin + " is allowed: the answer carries Access-Control-Allow-Origin and Allow-Credentials.", "A origem " + r.origin + " é permitida: a resposta leva Access-Control-Allow-Origin e Allow-Credentials."]
        : ["account-service matched: forwarded to " + r.forward + "; the answer is account's (hands-on 1).", "account-service casou: encaminhado para " + r.forward + "; a resposta é do account (hands-on 1)."]);
  }

  /* the page's checks, step by step */
  var SCRIPTS = {
    verify: [
      { req: { path: "/health-check" }, en: "The gateway's own endpoint.", pt: "O endpoint do próprio gateway." },
      { req: { path: "/accounts" }, en: "Routed to account.", pt: "Roteado para o account." },
      { req: { path: "/accounts/health-check" }, en: "The account's health-check, through the gateway.", pt: "O health-check do account, pelo gateway." },
      { req: { path: "/insper" }, en: "The other route of application.yaml.", pt: "A outra rota do application.yaml." },
      { req: { path: "/account" }, en: "One letter short.", pt: "Uma letra a menos." },
      { req: { path: "/accounts", idAccount: true }, en: "A client tries to forge id-account.", pt: "Um cliente tenta forjar id-account." },
      { req: { path: "/accounts", origin: "http://localhost:3000" }, en: "A front end on localhost:3000.", pt: "Um front end em localhost:3000." },
      { req: { path: "/accounts", origin: "https://evil.example" }, en: "A page from another origin.", pt: "Uma página de outra origem." },
      { set: { accountUp: false }, req: { path: "/accounts" }, en: "docker compose stop account.", pt: "docker compose stop account." },
      { req: { direct: true }, en: "Skip the gateway: call account from the host.", pt: "Pule o gateway: chame o account do host." }
    ]
  };
  function run(st, s) { if (s.set) Object.keys(s.set).forEach(function (k) { st[k] = s.set[k]; }); return request(st, s.req); }
  function play(name, n) {
    var st = create(), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (s) { out.push(run(st, s)); });
    return { st: st, out: out };
  }
  function curl(r) {
    if (r.direct) return "$ curl http://account:8080/accounts";
    return "$ curl -i" + (r.method !== "GET" ? " -X " + r.method : "") + (r.origin ? " -H 'Origin: " + r.origin + "'" : "") + (r.idAccount ? " -H '" + REMOVED + ": 1'" : "") + " http://localhost:" + PORT + r.path;
  }

  var API = { PORT: PORT, HOSTNAME: HOSTNAME, ROUTES: ROUTES, OWN: OWN, ORIGINS: ORIGINS, REMOVED: REMOVED, SCRIPTS: SCRIPTS,
    create: create, matches: matches, request: request, run: run, play: play, curl: curl };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return PT ? pair[1] : pair[0]; }

  C.style("gateway-routes", [
    ".md-typeset .csim-gw-path { font-family: var(--md-code-font-family); font-size: .62rem; padding: .15rem .35rem; border: .05rem solid var(--c-line); border-radius: .2rem; background: var(--c-bg); color: var(--c-fg); width: 11rem; }",
    ".md-typeset .csim-log.csim-gw-term li { font-family: var(--md-code-font-family); font-size: .6rem; white-space: pre-wrap; word-break: break-all; }",
    ".md-typeset .csim-log.csim-gw-term li b { font-weight: 600; }"
  ].join("\n"));

  C.register("gateway-routes", function (root) {
    var o = C.opts(root, { script: "verify" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, last = null;

    var svg = s("svg", { viewBox: "0 0 640 214", role: "img", "aria-label": t("The gateway's route table", "A tabela de rotas do gateway") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-gw-term";
    var tiles = C.stats([
      { key: "status", label: t("last status", "último status") },
      { key: "route", label: t("route", "rota") },
      { key: "sent", label: t("requests", "requisições") }
    ]);
    function say(pair, tone) { note.textContent = pair ? L(pair) : ""; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "verify", label: t("run and verify", "rodar e verificar") }, { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });
    var cMethod = C.choice({ label: t("Method", "Método"), value: "GET", options: [{ value: "GET", label: "GET" }, { value: "DELETE", label: "DELETE" }] });
    var input = el("input", { type: "text", class: "csim-gw-path", value: "/accounts", "aria-label": t("path", "caminho"), spellcheck: "false" });
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); bSend.click(); } ev.stopPropagation(); });
    var cPreset = C.choice({ label: t("Path", "Caminho"), value: "/accounts", options: ["/health-check", "/accounts", "/accounts/42", "/insper", "/account", "/products"].map(function (x) { return { value: x, label: x }; }),
      onChange: function (v) { input.value = v; } });
    var cOrigin = C.choice({ label: "Origin", value: "", options: [{ value: "", label: t("none (curl)", "nenhuma (curl)") }, { value: "http://localhost:3000", label: "localhost:3000" }, { value: "https://evil.example", label: "evil.example" }] });
    var tForge = C.toggle({ label: t("send id-account: 1", "enviar id-account: 1") });
    var tUp = C.toggle({ label: t("account container running", "container account rodando"), checked: true, onChange: function (v) { st.accountUp = v; draw(); } });
    var bSend = C.button(t("send", "enviar"), function () {
      player.pause();
      var path = input.value.trim() || "/";
      if (path[0] !== "/") path = "/" + path;
      show(request(st, { method: cMethod.get(), path: path, origin: cOrigin.get(), idAccount: tForge.get() }));
    }, { tone: "ok" });
    var bDirect = C.button(t("curl account directly", "curl direto no account"), function () { player.pause(); show(request(st, { direct: true })); });

    function show(r) {
      last = r;
      var lines = [];
      if (r.err && r.status === null) lines.push(r.err);
      else if (r.status === null) lines.push("→ " + r.forward + t("  (Insper's answer)", "  (resposta do Insper)"));
      else {
        lines.push("HTTP/1.1 " + r.status + " " + r.text);
        Object.keys(r.headers).forEach(function (h) { lines.push(h + ": " + r.headers[h]); });
        if (r.body) lines.push(r.body);
        if (r.err) lines.push("[gateway] " + r.err);
      }
      term.add(el("span", {}, [el("b", { text: curl(r) }), "\n" + lines.join("\n")]), r.tone === "info" ? "" : r.tone);
      say(r.note, r.tone === "ok" || r.tone === "info" ? "" : r.tone);
      draw();
    }

    var player = C.player({ interval: 1800, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });
    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var sx = sc[k - 1], r = run(st, sx);
      tUp.set(st.accountUp);
      if (!sx.req.direct) { input.value = sx.req.path; cOrigin.set(sx.req.origin || ""); tForge.set(!!sx.req.idAccount); cMethod.set("GET"); }
      show(r);
      say([sx.en + " " + r.note[0], sx.pt + " " + r.note[1]], r.tone === "ok" || r.tone === "info" ? "" : r.tone);
    }
    function replay(k) {
      st = create(); term.clear(); last = null; tUp.set(true);
      for (var i = 1; i <= k; i++) step(i);
      if (!k) intro();
      draw();
    }
    function intro() {
      say(script === "free"
        ? ["Type a path (or pick one), choose the headers and send. Stop the account container to see what a route does without its service.", "Digite um caminho (ou escolha um), escolha os cabeçalhos e envie. Pare o container account para ver o que uma rota faz sem o seu serviço."]
        : ["The stack of the lab: gateway on :8080, account behind it with no published port. Press play or → to send the page's requests; the console works at any time.",
           "A pilha do lab: gateway em :8080, account atrás dele sem porta publicada. Aperte play ou → para enviar as requisições da página; o console funciona a qualquer momento."], "");
    }
    function reset() {
      st = create(); term.clear(); last = null; tUp.set(true);
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro();
      draw();
    }

    /* the route table: the own endpoint, the routes, the fallback */
    var ROWS = [{ kind: "own", id: OWN.handler, left: "GET " + OWN.path, right: "GatewayResource" }]
      .concat(ROUTES.map(function (rt) { return { kind: "route", id: rt.id, left: "Path=" + rt.path, right: rt.uri, name: rt.id }; }))
      .concat([{ kind: "none", id: "404", left: t("(no match)", "(nenhum casou)"), right: "404 Not Found" }]);
    var RX = 112, RW = 318, RY0 = 64, RH = 30, RG = 6;

    function draw() {
      C.clear(svg);
      var r = last, direct = r && r.direct;
      /* the client */
      svg.appendChild(s("rect", { x: 4, y: 92, width: 88, height: 44, rx: 6, class: "c-box on" }));
      svg.appendChild(s("text", { x: 48, y: 110, "text-anchor": "middle", class: "c-label" }, t("client", "cliente")));
      svg.appendChild(s("text", { x: 48, y: 125, "text-anchor": "middle", class: "c-small" }, "curl / browser"));
      /* the gateway */
      svg.appendChild(s("rect", { x: 102, y: 4, width: 338, height: 206, rx: 10, class: "c-box" + (r && !direct ? " on" : "") }));
      svg.appendChild(s("text", { x: 112, y: 22, class: "c-label" }, "gateway  :8080"));
      svg.appendChild(s("text", { x: 112, y: 38, class: "c-small c-mono" + (r && r.removed ? " c-warn" : "") }, "RemoveRequestHeader=id-account" + (r && r.removed ? t("  ✂ removed", "  ✂ removido") : "")));
      svg.appendChild(s("text", { x: 112, y: 52, class: "c-small c-mono" + (r && r.status === 403 ? " c-bad" : "") }, "globalcors: " + ORIGINS.map(function (x) { return x.replace("http://", ""); }).join(", ")));
      svg.appendChild(s("line", { x1: 92, y1: 114, x2: 102, y2: 114, class: "c-wire" + (r && !direct ? " on" : "") }));
      /* the rows */
      ROWS.forEach(function (row, i) {
        var y = RY0 + i * (RH + RG), chk = r && !direct ? r.checks.filter(function (c) { return c.id === row.id; })[0] : null;
        var hit = chk ? chk.hit : row.kind === "none" && r && !direct && r.status === 404 && !r.route && !r.handler;
        if (row.kind === "own" && r && !direct && r.path.split("?")[0] === OWN.path && r.status === 405) hit = true;
        var cls = !hit ? (chk && !chk.skipped ? "down" : "") : row.kind === "none" || r.status === 405 ? "warn" : r.status === 403 || r.status === 500 ? "bad" : "ok";
        svg.appendChild(s("rect", { x: RX, y: y, width: RW, height: RH, rx: 5, class: "c-box " + cls }));
        svg.appendChild(s("text", { x: RX + 8, y: y + 13, class: "c-small" }, (row.name ? row.name : row.kind === "own" ? t("own endpoint", "endpoint próprio") : t("fallback", "nenhuma rota")) + (chk && !hit && !chk.skipped ? t("  · no match", "  · não casou") : chk && chk.skipped ? t("  · not checked", "  · não avaliada") : "")));
        svg.appendChild(s("text", { x: RX + 8, y: y + 25, class: "c-small c-mono" }, row.left));
        svg.appendChild(s("text", { x: RX + RW - 8, y: y + 25, "text-anchor": "end", class: "c-small c-mono" }, "→ " + row.right));
      });
      /* the upstreams */
      var up = [{ id: "insper-service", y: RY0 + (RH + RG), label: "www.insper.edu.br", sub: t("internet", "internet"), cls: r && r.upstream === "www.insper.edu.br" ? "on" : "" },
        { id: "account-service", y: RY0 + 2 * (RH + RG), label: "account :8080", sub: st.accountUp ? t("no published port", "sem porta publicada") : t("stopped", "parado"),
          cls: !st.accountUp ? "down" : r && r.upstream === "account" ? (r.status < 300 ? "ok" : "warn") : direct ? "bad" : "" }];
      up.forEach(function (u) {
        var on = r && !direct && r.route && r.route.id === u.id;
        svg.appendChild(s("line", { x1: RX + RW, y1: u.y + RH / 2, x2: 470, y2: u.y + RH / 2, class: "c-wire" + (on ? (u.id === "account-service" && !st.accountUp ? " cut" : " on") : "") }));
        svg.appendChild(s("rect", { x: 470, y: u.y - 4, width: 166, height: RH + 8, rx: 6, class: "c-box " + u.cls }));
        svg.appendChild(s("text", { x: 478, y: u.y + 11, class: "c-label" }, u.label));
        svg.appendChild(s("text", { x: 478, y: u.y + 25, class: "c-small" }, u.sub));
      });
      if (direct) {
        svg.appendChild(s("path", { d: "M48,136 C48,206 360,214 470," + (RY0 + 2 * (RH + RG) + 22), class: "c-wire cut" }));
        svg.appendChild(s("text", { x: 470, y: 206, class: "c-small c-bad" }, "Could not resolve host"));
      }
      /* the status */
      var status = !r ? "–" : r.status === null ? (direct ? "curl (6)" : "→ Insper") : String(r.status);
      tiles.set("status", status, !r ? "" : r.tone === "info" ? "" : r.tone);
      tiles.set("route", !r || direct ? "–" : r.route ? r.route.id : r.handler ? "GatewayResource" : t("none", "nenhuma"), "");
      tiles.set("sent", String(st.sent), "");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's gateway, without Docker: which route answers a path",
        "O gateway do lab, sem Docker: qual rota atende um caminho") }),
      el("p", { class: "csim-sub", text: t("The gateway checks its own endpoint, then the routes of application.yaml in order; the first Path predicate that matches forwards the whole path to its uri. Green is the row that answered, grey the rows that did not match.",
        "O gateway confere o próprio endpoint e depois as rotas do application.yaml em ordem; o primeiro predicado Path que casa encaminha o caminho inteiro para a uri. Verde é a linha que respondeu, cinza as que não casaram.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, [cMethod, input, bSend]),
      el("div", { class: "csim-row" }, [cPreset]),
      el("div", { class: "csim-row" }, [cOrigin, tForge]),
      el("div", { class: "csim-row" }, [tUp, bDirect]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
