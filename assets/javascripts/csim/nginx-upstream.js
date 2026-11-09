/*
 * The load balancer of hands-on 7 (2026.2), as a lab twin:
 *
 *   <div class="csim" data-sim="nginx-upstream" data-script="run"></div>
 *
 * The lab's lb (Nginx, host port 8080 → 80) in front of the gateway replicas store-gateway-1…n, with the
 * lab's nginx.conf: `upstream gateways { server gateway:8080; }`, no algorithm line (Round Robin), no
 * max_fails / fail_timeout (so Nginx's defaults: max_fails=1, fail_timeout=10s) and the default
 * proxy_next_upstream (error timeout). Every button is a command of the lab (the curl loop on
 * /health-check, docker compose ps, up --scale, nginx -s reload, restart lb, docker stop/start of one
 * replica, docker compose logs lb) and prints what the lab prints. A script (data-script) replays a
 * page step by step: run, failure or single; "free" leaves only the buttons.
 *
 * The model follows Nginx's upstream code for one worker process:
 *   - Docker DNS answers `gateway` with the IPs of the running replicas; Nginx resolves it only when it
 *     starts or reloads, and each IP becomes a peer;
 *   - Round Robin is Nginx's smooth weighted round robin (all weights 1); least_conn with one request at
 *     a time ties on 0 connections and falls back to it; ip_hash hashes the first three octets of the
 *     client address; random draws a peer (seeded);
 *   - a failed connection counts one fail and disables the peer for fail_timeout; the request is passed
 *     to the next peer (proxy_next_upstream), at most once per peer; with a single peer there is no
 *     failure accounting and nobody to retry, so the client gets 502;
 *   - connecting to the IP of a stopped container waits for ARP to give up (113: Host is unreachable).
 */
(function () {
  "use strict";

  var CONF = { upstream: "gateways", server: "gateway:8080", listen: 80, host: 8080 };  /* nginx/nginx.conf, docker/index.md */
  var MAX_FAILS = 1, FAIL_TIMEOUT = 10;   /* Nginx's defaults: the lab's nginx.conf sets neither */
  var UNREACHABLE = 3;                    /* seconds lost on the IP of a stopped container (ARP gives up) */
  var REQ = 0.05;                         /* seconds per answered request of the curl loop */
  var LOOP = 9;                           /* for i in {1..9} */
  var CLIENT = [172, 18, 0, 1];           /* what Nginx sees as $remote_addr: the network's gateway */
  var ALGOS = ["rr", "least_conn", "ip_hash", "random"];
  var NAME = "store-gateway-";

  function hex(rng) { var s = ""; for (var i = 0; i < 12; i++) s += "0123456789abcdef"[Math.floor(rng() * 16)]; return s; }
  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(o) {
    o = o || {};
    var st = { t: 0, rng: rngOf(o.seed || 7), containers: [], nextIp: 5, algo: o.algo || "rr", lb: { up: true, peers: [] }, errlog: [],
      count: { ok: 0, failed: 0, bad: 0 } };
    scaleTo(st, o.replicas || 3);
    resolve(st);
    return st;
  }
  function addContainer(st) {
    var k = st.containers.length + 1;
    st.containers.push({ k: k, name: NAME + k, ip: "172.18.0." + st.nextIp++, host: hex(st.rng), up: true, served: 0 });
  }
  function scaleTo(st, n) {
    st.containers.forEach(function (c) { if (c.k <= n) c.up = true; });
    while (st.containers.length < n) addContainer(st);
    st.containers = st.containers.filter(function (c) { return c.k <= n; });
  }
  function container(st, ip) { return st.containers.filter(function (c) { return c.ip === ip; })[0] || null; }
  function byName(st, name) { return st.containers.filter(function (c) { return c.name === name; })[0] || null; }
  function running(st) { return st.containers.filter(function (c) { return c.up; }); }
  /* Docker DNS → the peers of the upstream; false when the name does not resolve */
  function resolve(st) {
    var ips = running(st).map(function (c) { return c.ip; });
    if (!ips.length) return false;
    st.lb.peers = ips.map(function (ip) { return { ip: ip, cw: 0, ew: 1, fails: 0, checked: 0, accessed: 0 }; });
    return true;
  }
  function now(st) { return Math.floor(st.t); }
  function failedPeer(st, p) { return p.fails >= MAX_FAILS && now(st) - p.checked <= FAIL_TIMEOUT; }
  function disabled(st, p) { return st.lb.peers.length > 1 && failedPeer(st, p); }

  /* ngx_http_upstream_get_peer: smooth weighted round robin over the peers not tried and not failed */
  function rrPeer(st, tried) {
    var best = null, total = 0;
    st.lb.peers.forEach(function (p, i) {
      if (tried[i] || failedPeer(st, p)) return;
      p.cw += p.ew; total += p.ew;
      if (p.ew < 1) p.ew++;
      if (!best || p.cw > best.cw) best = p;
    });
    if (!best) return -1;
    best.cw -= total;
    return st.lb.peers.indexOf(best);
  }
  function hashPeer(st, tried, req) {
    var peers = st.lb.peers;
    for (;;) {
      for (var i = 0; i < 3; i++) req.hash = (req.hash * 113 + CLIENT[i]) % 6271;
      var p = req.hash % peers.length;
      if (!tried[p] && !failedPeer(st, peers[p])) { req.tries++; return p; }
      if (++req.tries > 20) return rrPeer(st, tried);
    }
  }
  function randomPeer(st, tried, req) {
    var peers = st.lb.peers;
    for (;;) {
      var p = Math.floor(st.rng() * peers.length);
      if (!tried[p] && !failedPeer(st, peers[p])) return p;
      if (++req.tries > 20) return rrPeer(st, tried);
    }
  }
  function pick(st, tried, req) {
    var peers = st.lb.peers;
    if (peers.length === 1) return tried[0] ? -1 : 0;   /* single: no failure accounting */
    var i = req.tries > 20 ? rrPeer(st, tried) : st.algo === "ip_hash" ? hashPeer(st, tried, req) : st.algo === "random" ? randomPeer(st, tried, req) : rrPeer(st, tried);
    if (i >= 0 && now(st) - peers[i].checked > FAIL_TIMEOUT) peers[i].checked = now(st);
    return i;
  }

  function stamp(st) { var s = Math.floor(st.t), m = Math.floor(s / 60) % 60; return "14:" + (m < 10 ? "0" : "") + m + ":" + ((s % 60) < 10 ? "0" : "") + (s % 60); }
  function err(st, level, text) { st.errlog.push(stamp(st) + " [" + level + "] " + text); }

  /* one GET /health-check through the lb */
  function request(st) {
    var r = { attempts: [], code: 0, host: null };
    if (!st.lb.up) { r.code = 7; r.line = "(nothing: -s hides curl's error, exit code 7: connection refused)"; st.count.bad++; return r; }
    var tried = {}, req = { hash: 89, tries: 0 }, single = st.lb.peers.length === 1;
    for (;;) {
      var i = pick(st, tried, req);
      if (i < 0) {
        if (!r.attempts.length) err(st, "error", "no live upstreams while connecting to upstream");
        r.code = 502; r.line = "<html><head><title>502 Bad Gateway</title></head>…</html>";
        st.count.bad++;
        return r;
      }
      tried[i] = true;
      var p = st.lb.peers[i], c = container(st, p.ip);
      if (c && c.up) {
        st.t += REQ;
        if (p.accessed < p.checked) p.fails = 0;
        c.served++;
        r.attempts.push({ ip: p.ip, name: c.name, ok: true });
        r.code = 200; r.host = c.host; r.name = c.name; r.line = '{"hostname":"' + c.host + '"}';
        st.count.ok++;
        return r;
      }
      st.t += UNREACHABLE;
      r.attempts.push({ ip: p.ip, name: c ? c.name : null, ok: false });
      st.count.failed++;
      err(st, "error", "connect() failed (113: Host is unreachable) while connecting to upstream, upstream: \"http://" + p.ip + ":8080/health-check\"");
      if (!single) {
        p.fails++; p.accessed = now(st); p.checked = now(st);
        p.ew = Math.max(0, p.ew - 1);
        if (p.fails >= MAX_FAILS) err(st, "warn", "upstream server temporarily disabled while connecting to upstream, upstream: \"http://" + p.ip + ":8080/health-check\"");
      }
    }
  }

  var CURL = "curl -s http://localhost:" + CONF.host + "/health-check";
  function curl(st) {
    var r = request(st);
    return { cmd: "$ " + CURL, out: [r.line], reqs: [r], tone: r.code === 200 ? (r.attempts.length > 1 ? "warn" : "ok") : "bad", note: noteOf(st, [r]) };
  }
  function loop(st, n) {
    n = n || LOOP;
    var t0 = st.t, reqs = [];
    for (var i = 0; i < n; i++) reqs.push(request(st));
    var bad = reqs.some(function (r) { return r.code !== 200; }), retried = reqs.some(function (r) { return r.attempts.length > 1; });
    return { cmd: "$ for i in {1.." + n + "}; do " + CURL + "; echo; done", out: reqs.map(function (r) { return r.line; }), reqs: reqs, secs: st.t - t0,
      tone: bad ? "bad" : retried ? "warn" : "ok", note: noteOf(st, reqs, st.t - t0) };
  }
  /* how many answers each replica gave */
  function spread(reqs) {
    var by = {};
    reqs.forEach(function (r) { if (r.name) by[r.name] = (by[r.name] || 0) + 1; });
    return by;
  }
  function noteOf(st, reqs, secs) {
    var ok = reqs.filter(function (r) { return r.code === 200; }).length, failed = 0, bad = reqs.length - ok;
    reqs.forEach(function (r) { r.attempts.forEach(function (a) { if (!a.ok) failed++; }); });
    var by = spread(reqs), names = Object.keys(by).sort();
    var parts = names.map(function (n) { return n.replace(NAME, "gateway-") + " ×" + by[n]; }).join(", ");
    var en = ok + " × 200" + (parts ? " (" + parts + ")" : "") + (bad ? ", " + bad + " × " + (st.lb.up ? "502" : "refused") : "") +
      (failed ? "; " + failed + " failed attempt" + (failed > 1 ? "s" : "") + " in the lb's error log" : "") + (secs !== undefined ? "; " + fmt(secs) + " s" : "") + ".";
    var pt = ok + " × 200" + (parts ? " (" + parts + ")" : "") + (bad ? ", " + bad + " × " + (st.lb.up ? "502" : "recusada") : "") +
      (failed ? "; " + failed + " tentativa" + (failed > 1 ? "s" : "") + " falha" + (failed > 1 ? "s" : "") + " no log de erros do lb" : "") + (secs !== undefined ? "; " + fmt(secs).replace(".", ",") + " s" : "") + ".";
    return [en, pt];
  }
  function fmt(x) { return (Math.round(x * 10) / 10).toFixed(Math.abs(x - Math.round(x)) < 0.05 ? 0 : 1); }

  function ps(st) {
    var out = ["NAME                STATUS     PORTS", "store-lb-1          " + (st.lb.up ? "running    0.0.0.0:" + CONF.host + "->" + CONF.listen + "/tcp" : "exited")];
    st.containers.forEach(function (c) { out.push((c.name + "                    ").slice(0, 20) + (c.up ? "running" : "exited")); });
    ["store-auth-1", "store-account-1", "store-db-1"].forEach(function (n) { out.push((n + "                    ").slice(0, 20) + "running"); });
    return { cmd: "$ docker compose ps -a", out: out, tone: "info", note: ["Only lb publishes a port; the gateways are reachable only through it.", "Só o lb publica uma porta; os gateways só são alcançáveis por ele."] };
  }
  function scale(st, n) {
    var before = st.containers.length;
    scaleTo(st, n);
    var out = st.containers.length > before ? st.containers.slice(before).map(function (c) { return " ✔ Container " + c.name + "  Started"; })
      : n < before ? Array.apply(null, Array(before - n)).map(function (_, i) { return " ✔ Container " + NAME + (before - i) + "  Removed"; }) : [" ✔ Container " + NAME + "1  Running"];
    var stale = st.lb.peers.length !== running(st).length || st.lb.peers.some(function (p) { var c = container(st, p.ip); return !c || !c.up; });
    return { cmd: "$ docker compose up -d --scale gateway=" + n, out: out, tone: stale ? "warn" : "ok",
      note: stale ? ["Now " + n + " replica(s), but Nginx still has the " + st.lb.peers.length + " IP(s) it resolved at startup: reload it.", "Agora há " + n + " réplica(s), mas o Nginx ainda tem os " + st.lb.peers.length + " IP(s) que resolveu ao iniciar: recarregue-o."]
        : [n + " replica(s).", n + " réplica(s)."] };
  }
  function reload(st) {
    var cmd = "$ docker compose exec lb nginx -s reload";
    if (!st.lb.up) return { cmd: cmd, out: ["service \"lb\" is not running"], tone: "bad", note: ["The lb is down.", "O lb está fora do ar."] };
    if (!resolve(st)) {
      err(st, "emerg", "host not found in upstream \"" + CONF.server + "\"");
      return { cmd: cmd, out: ["nginx: [emerg] host not found in upstream \"" + CONF.server + "\""], tone: "bad",
        note: ["No replica is running, so the name gateway does not resolve: Nginx keeps its old configuration.", "Nenhuma réplica está rodando, então o nome gateway não resolve: o Nginx mantém a configuração antiga."] };
    }
    err(st, "notice", "signal process started");
    return { cmd: cmd, out: ["2026/11/06 " + stamp(st) + " [notice] signal process started"], tone: "ok",
      note: ["Nginx re-resolved gateway: " + st.lb.peers.length + " peer(s), " + st.lb.peers.map(function (p) { return p.ip; }).join(", ") + ".",
        "O Nginx resolveu gateway de novo: " + st.lb.peers.length + " peer(s), " + st.lb.peers.map(function (p) { return p.ip; }).join(", ") + "."] };
  }
  function restartLb(st) {
    var ok = resolve(st);
    st.lb.up = ok;
    if (!ok) err(st, "emerg", "host not found in upstream \"" + CONF.server + "\"");
    return { cmd: "$ docker compose restart lb", out: [" ✔ Container store-lb-1  " + (ok ? "Started" : "Exited")], tone: ok ? "ok" : "bad",
      note: ok ? ["A fresh start resolves gateway again: " + st.lb.peers.length + " peer(s).", "Um novo início resolve gateway de novo: " + st.lb.peers.length + " peer(s)."]
        : ["host not found in upstream \"gateway:8080\": with no replica running, Nginx exits.", "host not found in upstream \"gateway:8080\": sem réplica rodando, o Nginx sai."] };
  }
  function stop(st, name) {
    var c = byName(st, name), cmd = "$ docker stop " + name;
    if (!c) return { cmd: cmd, out: ["Error response from daemon: No such container: " + name], tone: "bad", note: null };
    c.up = false;
    return { cmd: cmd, out: [name], tone: "warn", note: [name + " stops; its IP " + c.ip + " is still one of Nginx's peers.", name + " para; o IP " + c.ip + " continua entre os peers do Nginx."] };
  }
  function start(st, name) {
    var c = byName(st, name), cmd = "$ docker start " + name;
    if (!c) return { cmd: cmd, out: ["Error response from daemon: No such container: " + name], tone: "bad", note: null };
    c.up = true;
    var p = st.lb.peers.filter(function (x) { return x.ip === c.ip; })[0];
    return { cmd: cmd, out: [name], tone: "ok", note: p && disabled(st, p)
      ? [name + " is back with the same IP, but Nginx skips it until its fail_timeout ends.", name + " voltou com o mesmo IP, mas o Nginx o pula até acabar o fail_timeout."]
      : [name + " is back with the same IP " + c.ip + ".", name + " voltou com o mesmo IP " + c.ip + "."] };
  }
  function wait(st, s) {
    st.t += s;
    return { cmd: "$ sleep " + s, out: [], tone: "info", note: ["Time passes: " + s + " s.", "O tempo passa: " + s + " s."] };
  }
  function logs(st) {
    var lines = st.errlog.filter(function (l) { return / \[(error|warn|emerg)\] /.test(l); }).slice(-6);
    return { cmd: "$ docker compose logs lb --tail 6", out: lines.length ? lines.map(function (l) { return "lb-1  | " + l; }) : ["(no errors)"], tone: "info",
      note: ["Nginx logs every failed attempt and every peer it disables.", "O Nginx registra cada tentativa que falhou e cada peer que ele desativa."] };
  }
  function setAlgo(st, a) {
    st.algo = a;
    var r = reload(st);
    r.cmd = "# upstream " + CONF.upstream + " { " + (a === "rr" ? "" : a + "; ") + "server " + CONF.server + "; }\n" + r.cmd;
    return r;
  }

  /* the lab's pages, step by step */
  var SCRIPTS = {
    run: [
      { ops: [["ps"]], en: "docker compose ps -a: lb publishes 8080, the three gateways publish nothing.", pt: "docker compose ps -a: o lb publica a 8080, os três gateways não publicam nada." },
      { ops: [["loop"]], en: "The lab's loop: Round Robin answers 3 times from each replica, in turn.", pt: "O loop do lab: o Round Robin responde 3 vezes de cada réplica, em sequência." },
      { ops: [["scale", 5]], en: "Scale to 5 replicas at runtime.", pt: "Escale para 5 réplicas em tempo de execução." },
      { ops: [["loop"]], en: "Still 3 hostnames: Nginx resolved gateway only at startup.", pt: "Ainda 3 hostnames: o Nginx resolveu gateway só ao iniciar." },
      { ops: [["reload"]], en: "nginx -s reload re-queries Docker DNS: 5 peers.", pt: "nginx -s reload consulta o DNS do Docker de novo: 5 peers." },
      { ops: [["loop"]], en: "Now all 5 replicas answer.", pt: "Agora as 5 réplicas respondem." },
      { ops: [["scale", 1]], en: "Scale down to 1, without a reload yet.", pt: "Reduza para 1, ainda sem reload." },
      { ops: [["loop"]], en: "Nginx still tries the 4 removed IPs: every answer comes from gateway-1, but the loop is slow and the error log fills.", pt: "O Nginx ainda tenta os 4 IPs removidos: toda resposta vem do gateway-1, mas o loop fica lento e o log de erros enche." },
      { ops: [["reload"], ["loop"]], en: "After the reload, one peer and a fast loop.", pt: "Depois do reload, um peer e um loop rápido." }
    ],
    failure: [
      { ops: [["loop"]], en: "Three healthy replicas: 3 answers each.", pt: "Três réplicas saudáveis: 3 respostas de cada." },
      { ops: [["stop", NAME + "2"]], en: "Stop one replica, as a crash would.", pt: "Pare uma réplica, como uma queda faria." },
      { ops: [["loop"]], en: "The client still gets 9 answers: the attempt on gateway-2 fails, Nginx passes that request to gateway-3 and disables gateway-2 for 10 s.", pt: "O cliente ainda recebe 9 respostas: a tentativa no gateway-2 falha, o Nginx passa essa requisição ao gateway-3 e desativa o gateway-2 por 10 s." },
      { ops: [["logs"]], en: "The lb's log shows the failed attempt and the disabled peer.", pt: "O log do lb mostra a tentativa falha e o peer desativado." },
      { ops: [["wait", 11], ["loop"]], en: "After fail_timeout Nginx tries gateway-2 again with one real request: it fails again and is disabled for another 10 s.", pt: "Depois do fail_timeout o Nginx tenta o gateway-2 de novo com uma requisição real: ela falha de novo e ele fica desativado por mais 10 s." },
      { ops: [["start", NAME + "2"], ["wait", 11], ["loop"]], en: "gateway-2 is back: the next trial succeeds and Round Robin includes it again.", pt: "O gateway-2 voltou: a próxima tentativa dá certo e o Round Robin o inclui de novo." }
    ],
    single: [
      { ops: [["scale", 1], ["reload"], ["loop"]], en: "The repository's replicas: 1 — every answer from gateway-1.", pt: "O replicas: 1 do repositório — toda resposta vem do gateway-1." },
      { ops: [["stop", NAME + "1"]], en: "Stop the only replica.", pt: "Pare a única réplica." },
      { ops: [["curl"]], en: "One peer: nobody to pass the request to, the client gets 502 Bad Gateway.", pt: "Um peer só: ninguém para quem passar a requisição, o cliente recebe 502 Bad Gateway." },
      { ops: [["start", NAME + "1"], ["curl"]], en: "Back: with a single peer Nginx keeps no failure count, so it answers at once.", pt: "De volta: com um peer só o Nginx não conta falhas, então responde na hora." }
    ]
  };
  var OPS = { loop: loop, curl: curl, ps: ps, scale: scale, reload: reload, restartLb: restartLb, stop: stop, start: start, wait: wait, logs: logs, setAlgo: setAlgo };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function play(name, n, o) {
    var st = create(o), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { CONF: CONF, MAX_FAILS: MAX_FAILS, FAIL_TIMEOUT: FAIL_TIMEOUT, UNREACHABLE: UNREACHABLE, LOOP: LOOP, ALGOS: ALGOS, SCRIPTS: SCRIPTS,
    create: create, run: run, play: play, spread: spread, disabled: disabled, running: running,
    request: request, curl: curl, loop: loop, ps: ps, scale: scale, reload: reload, restartLb: restartLb, stop: stop, start: start, wait: wait, logs: logs, setAlgo: setAlgo };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }
  var CL = { x: 4, y: 96, w: 86, h: 48 }, LB = { x: 142, y: 76, w: 186, h: 88 }, RX = 430, RW = 196, RH = 40;

  C.style("nginx-upstream", [
    ".md-typeset .csim .csim-ng-rep { cursor: pointer; }",
    ".md-typeset .csim .csim-ng-rep.sel > rect:first-child { stroke-width: 3; }",
    ".md-typeset .csim .csim-ng-rep.down text { fill: var(--c-fg3); }",
    ".md-typeset .csim .c-wire.csim-ng-ok { stroke: var(--c-ok); stroke-width: 2.5; }",
    ".md-typeset .csim-log.csim-ng-term li { font-family: var(--md-code-font-family, monospace); font-size: .62rem; white-space: pre-wrap; }",
    ".md-typeset .csim-log.csim-ng-term li b { font-weight: 600; }",
    ".md-typeset .csim-ng-acts .csim-btn[disabled] { opacity: .4; cursor: default; }"
  ].join("\n"));

  C.register("nginx-upstream", function (root) {
    var o = C.opts(root, { script: "run" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, sel = NAME + "2", last = [];

    var svg = s("svg", { viewBox: "0 0 630 240", role: "img", "aria-label": t("Nginx in front of the gateway replicas", "Nginx na frente das réplicas do gateway") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-ng-term";
    var tiles = C.stats([
      { key: "peers", label: t("peers in Nginx", "peers no Nginx") },
      { key: "ok", label: t("answers 200", "respostas 200") },
      { key: "failed", label: t("failed attempts", "tentativas falhas") },
      { key: "bad", label: t("errors to the client", "erros ao cliente") }
    ]);
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) {
      term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone);
      if (r.reqs) last = r.reqs;
    }

    var cScript = C.choice({ label: t("Lab page", "Página do lab"), value: script, options: [
      { value: "run", label: t("Run: verify and scale", "Run: verificar e escalar") },
      { value: "failure", label: t("A replica stops", "Uma réplica para") },
      { value: "single", label: t("One replica", "Uma réplica") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });

    function act(fn) { return function () { player.pause(); var r = fn(); if (r) { show(r); say(r.note, r.tone); } draw(); }; }
    var B = {
      loop: C.button(t("curl loop ×9", "loop de curl ×9"), act(function () { return loop(st); }), { tone: "ok" }),
      curl: C.button("curl", act(function () { return curl(st); })),
      stop: C.button("docker stop", act(function () { return stop(st, sel); }), { tone: "bad" }),
      start: C.button("docker start", act(function () { return start(st, sel); })),
      wait: C.button(t("wait 10 s", "esperar 10 s"), act(function () { return wait(st, FAIL_TIMEOUT); })),
      reload: C.button("nginx -s reload", act(function () { return reload(st); })),
      restart: C.button("restart lb", act(function () { return restartLb(st); })),
      logs: C.button("logs lb", act(function () { return logs(st); })),
      ps: C.button("ps -a", act(function () { return ps(st); }))
    };
    var cScale = C.choice({ label: "--scale gateway=", value: 3, options: [1, 2, 3, 4, 5].map(function (n) { return { value: n, label: String(n) }; }),
      onChange: act(function () { return scale(st, cScale.get()); }) });
    var cAlgo = C.choice({ label: t("upstream algorithm", "algoritmo do upstream"), value: "rr", options: [
      { value: "rr", label: t("(none) Round Robin", "(nenhum) Round Robin") }, { value: "least_conn", label: "least_conn" }, { value: "ip_hash", label: "ip_hash" }, { value: "random", label: "random" }
    ], onChange: act(function () { return setAlgo(st, cAlgo.get()); }) });

    var player = C.player({ interval: 1800, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });

    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "";
      sc[k - 1].ops.forEach(function (op) { var r = run(st, op); show(r); if (r.tone === "bad" || (r.tone === "warn" && tone !== "bad")) tone = r.tone; });
      var lastNote = last.length && /loop|curl/.test(sc[k - 1].ops[sc[k - 1].ops.length - 1][0]) ? " " + L(noteOf(st, last)) : "";
      note.textContent = L([sc[k - 1].en, sc[k - 1].pt]) + lastNote;
      note.className = "csim-note" + (tone ? " csim-" + tone : "");
      sync(); draw();
    }
    function replay(k) { fresh(); for (var i = 1; i <= k; i++) step(i); if (!k) intro(); draw(); }
    function intro() {
      say(script === "free"
        ? ["Click a replica to select it, then stop or start it. Every button is a command of the lab.", "Clique numa réplica para selecioná-la e pare ou inicie. Cada botão é um comando do lab."]
        : ["The lab's stack: lb (Nginx) on host port 8080 and three gateway replicas. Press play or → to run the page's commands; the buttons work at any time.",
           "A pilha do lab: lb (Nginx) na porta 8080 do host e três réplicas do gateway. Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento."], "");
    }
    function fresh() { st = create(); term.clear(); last = []; sync(); }
    function sync() { cScale.set(st.containers.length); cAlgo.set(st.algo); }
    function reset() {
      fresh();
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      intro(); draw();
    }

    function box(x, y, w, h, cls) { return s("rect", { x: x, y: y, width: w, height: h, rx: 7, class: "c-box " + cls }); }
    function text(x, y, str, cls, anchor) { return s("text", { x: x, y: y, class: cls || "c-small", "text-anchor": anchor || "start" }, str); }

    function draw() {
      C.clear(svg);
      /* one row per replica, plus a ghost row for every peer whose container is gone */
      var rows = st.containers.map(function (c) { return { c: c, ip: c.ip }; });
      st.lb.peers.forEach(function (p) { if (!container(st, p.ip)) rows.push({ c: null, ip: p.ip }); });
      var gap = Math.min(46, 232 / Math.max(1, rows.length)), h = Math.min(RH, gap - 4), y0 = 120 - (rows.length * gap) / 2;
      var hit = {};
      last.forEach(function (r) { r.attempts.forEach(function (a) { hit[a.ip] = a.ok ? "ok" : hit[a.ip] || "fail"; }); });
      /* client → lb */
      svg.appendChild(s("line", { x1: CL.x + CL.w, y1: CL.y + CL.h / 2, x2: LB.x, y2: CL.y + CL.h / 2, class: "c-wire" + (st.lb.up ? " on" : " cut") }));
      svg.appendChild(text((CL.x + CL.w + LB.x) / 2, CL.y + CL.h / 2 - 5, ":" + CONF.host, "c-small c-mono", "middle"));
      svg.appendChild(box(CL.x, CL.y, CL.w, CL.h, "on"));
      svg.appendChild(text(CL.x + CL.w / 2, CL.y + 20, "curl", "c-label", "middle"));
      svg.appendChild(text(CL.x + CL.w / 2, CL.y + 35, "/health-check", "c-small c-mono", "middle"));
      /* lb → each row */
      rows.forEach(function (row, i) {
        var y = y0 + i * gap + h / 2, inPool = st.lb.peers.some(function (p) { return p.ip === row.ip; });
        if (!inPool) return;
        var cls = "c-wire" + (hit[row.ip] === "ok" ? " csim-ng-ok" : hit[row.ip] === "fail" ? " cut" : row.c && row.c.up ? " on" : "");
        svg.appendChild(s("path", { d: "M" + (LB.x + LB.w) + "," + (LB.y + LB.h / 2) + " C" + (LB.x + LB.w + 60) + "," + (LB.y + LB.h / 2) + " " + (RX - 60) + "," + y + " " + RX + "," + y, class: cls }));
      });
      svg.appendChild(box(LB.x, LB.y, LB.w, LB.h, st.lb.up ? "hot" : "down"));
      svg.appendChild(text(LB.x + 8, LB.y + 17, t("lb · Nginx", "lb · Nginx"), "c-label"));
      svg.appendChild(text(LB.x + 8, LB.y + 33, "upstream " + CONF.upstream + " · :" + CONF.listen, "c-small c-mono"));
      svg.appendChild(text(LB.x + 8, LB.y + 48, (st.algo === "rr" ? t("Round Robin (default)", "Round Robin (padrão)") : st.algo), "c-small"));
      svg.appendChild(text(LB.x + 8, LB.y + 63, st.lb.up ? st.lb.peers.length + t(" peer(s) resolved", " peer(s) resolvidos") : t("exited", "saiu"), "c-small" + (st.lb.up ? "" : " c-bad")));
      svg.appendChild(text(LB.x + 8, LB.y + 78, "max_fails=" + MAX_FAILS + " fail_timeout=" + FAIL_TIMEOUT + "s", "c-small c-mono"));
      /* the replicas */
      rows.forEach(function (row, i) {
        var y = y0 + i * gap, c = row.c, peer = st.lb.peers.filter(function (p) { return p.ip === row.ip; })[0];
        var off = peer && disabled(st, peer), cls;
        if (!c) cls = "bad"; else if (!c.up) cls = "down"; else if (!peer) cls = "warn"; else if (off) cls = "warn"; else cls = "on";
        var g = s("g", { class: "csim-ng-rep" + (c && !c.up ? " down" : "") + (c && c.name === sel ? " sel" : ""), onclick: c ? function () { sel = c.name; draw(); } : null });
        g.appendChild(box(RX, y, RW, h, cls));
        g.appendChild(text(RX + 7, y + 14, c ? c.name : t("(removed)", "(removido)"), "c-label"));
        g.appendChild(text(RX + RW - 7, y + 14, row.ip, "c-small c-mono", "end"));
        if (h >= 30) {
          var line = !c ? t("gone, but still a peer", "sumiu, mas ainda é peer")
            : !c.up ? t("stopped", "parado") + (off ? t(" · disabled", " · desativado") : "")
            : !peer ? t("not in Nginx's pool: reload", "fora do pool do Nginx: reload")
            : off ? t("disabled until t = " + (peer.checked + FAIL_TIMEOUT) + " s", "desativado até t = " + (peer.checked + FAIL_TIMEOUT) + " s")
            : c.host + " · " + c.served + t(" served", " atendidas");
          g.appendChild(text(RX + 7, y + 29, line, "c-small" + (!c || off || (c && !peer) ? " c-warn" : "")));
        }
        svg.appendChild(g);
      });
      svg.appendChild(text(4, 236, "t = " + fmt(st.t) + " s", "c-small c-mono"));
      var c = byName(st, sel);
      if (!c) { sel = st.containers[0] ? st.containers[0].name : ""; c = byName(st, sel); }
      B.stop.disabled = !c || !c.up; B.start.disabled = !c || c.up;
      B.stop.textContent = "docker stop " + (c ? c.name.replace("store-", "") : ""); B.start.textContent = "docker start " + (c ? c.name.replace("store-", "") : "");
      tiles.set("peers", st.lb.up ? String(st.lb.peers.length) : "–", st.lb.peers.length === running(st).length && st.lb.up ? "ok" : "warn");
      tiles.set("ok", String(st.count.ok), st.count.ok ? "ok" : "");
      tiles.set("failed", String(st.count.failed), st.count.failed ? "warn" : "ok");
      tiles.set("bad", String(st.count.bad), st.count.bad ? "bad" : "ok");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's load balancer, without Docker: Round Robin, DNS at startup and a replica that stops",
        "O balanceador do lab, sem Docker: Round Robin, DNS ao iniciar e uma réplica que para") }),
      el("p", { class: "csim-sub", text: t("The lab's nginx.conf on one worker. Green wires answered the last command, red dashed wires are failed attempts; click a replica to stop or start it.",
        "O nginx.conf do lab num worker. Fios verdes responderam o último comando, vermelhos tracejados são tentativas falhas; clique numa réplica para pará-la ou iniciá-la.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row csim-ng-acts" }, [B.loop, B.curl, B.stop, B.start, B.wait, B.logs, B.ps]),
      el("div", { class: "csim-row" }, [cScale, B.reload, B.restart]),
      el("div", { class: "csim-row" }, [cAlgo]),
      note,
      player,
      el("div", { class: "csim-cols" }, [tiles, term])
    ]);
    reset();
    return {};
  });
})();
