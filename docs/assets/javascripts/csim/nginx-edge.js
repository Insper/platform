/*
 * The edge of hands-on 3 (2027.1), as a lab twin:
 *
 *   <div class="csim" data-sim="nginx-edge" data-script="failures"></div>
 *
 * The lab's Nginx (port 80) in front of catalog-1..3, with the lab's nginx.conf: round robin,
 * `max_fails=3 fail_timeout=10s` (passive health check), `proxy_connect_timeout 1s`,
 * `proxy_read_timeout 5s`, `proxy_next_upstream error timeout …` with `proxy_next_upstream_tries 2`,
 * `resolver 127.0.0.11 valid=10s` + `resolve`, and `limit_req_zone $http_x_api_key … rate=20r/s` with
 * `limit_req … burst=40 nodelay`. Every number taken from the lab is in LAB (registered in
 * scripts/csim/lab-values.mjs). A script (data-script) replays a step of the page: spread (step 4),
 * failures (step 5: k6 at 150 req/s while one replica stops and another freezes) or ratelimit
 * (step 6: ratelimit.js); "free" leaves only the buttons.
 *
 * The model is an event simulation of one Nginx (the upstream state is shared by the workers, `zone`):
 *   - k6's open model: requests arrive at a constant rate; 20% are listings (lab 2's load.js), which take
 *     longer than the primary-key details (illustrative service times, below);
 *   - round robin over the peers that resolve and are not disabled; Nginx's accounting: a failed attempt
 *     counts one fail (accessed = checked = now); `max_fails` fails disable the peer for `fail_timeout`;
 *     after it, one request is let through as a trial (checked = now), and a success resets the count;
 *   - a failed attempt is passed to the next peer, at most `proxy_next_upstream_tries` attempts in all;
 *     no peer left: 502;
 *   - as the page's table says: a stopped replica refuses at once (its in-flight requests end with
 *     "upstream prematurely closed connection"); at the next re-resolution its name is gone and Nginx
 *     skips it; while it starts again (~10 s) it refuses; a paused replica answers nothing: a request on
 *     a kept-alive connection waits the read timeout (5 s), on a new connection the connect timeout (1 s);
 *   - limit_req as Nginx computes it (ngx_http_limit_req_module): per key, in milli-requests,
 *     excess = max(0, excess − rate·ms/1000 + 1000), rejected (429) above burst; nodelay serves at once.
 */
(function () {
  "use strict";

  /* the lab's values: nginx.conf, docker-compose.yaml, index.md, load/ratelimit.js, lab 2's load.js */
  var LAB = { replicas: 3, maxFails: 3, failTimeout: 10, connectTimeout: 1, readTimeout: 5, tries: 2, resolverValid: 10,
    rate: 20, burst: 40, loadRate: 150, greedy: 50, polite: 10, rlSeconds: 30, listShare: 0.2, startup: 10 };
  var DETAIL = [0.9, 0.9], LIST = [10, 20];   /* ms, illustrative: detail = 0.9 + exp(mean 0.9); list = 10 + U(0, 20) */
  var IP0 = 3;                                /* catalog-k at 172.18.0.(2 + k); the bridge's gateway is 172.18.0.1 */

  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ state */

  function create(o) {
    o = o || {};
    var st = { t: 0, rand: rngOf(o.seed || 11), rr: 0, heap: [], seq: 0, errlog: [], access: [], buckets: {}, ids: 0,
      nextResolve: LAB.resolverValid, peers: [], done: [], perSec: {}, load: null };
    for (var k = 1; k <= LAB.replicas; k++) {
      st.peers.push({ k: k, name: "catalog-" + k, ip: "172.18.0." + (IP0 + k - 1), state: "up", since: 0, resolved: true,
        fails: 0, checked: 0, accessed: 0, conns: [], inflight: [], served: 0 });
    }
    return st;
  }
  function peer(st, name) { return st.peers.filter(function (p) { return p.name === name; })[0]; }
  function stamp(t) {
    var s = 10 * 3600 + Math.floor(t), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return "2026/11/06 " + [hh, mm, ss].map(function (x) { return (x < 10 ? "0" : "") + x; }).join(":");
  }
  function err(st, level, msg, p) {
    st.errlog.push({ t: st.t, line: stamp(st.t) + " [" + level + "] " + msg + (p ? ", upstream: \"http://" + p.ip + ":8082/catalog/events/1\"" : "") });
  }
  function hex(st, n) { var s = ""; for (var i = 0; i < n; i++) s += "0123456789abcdef"[Math.floor(st.rand() * 16)]; return s; }

  /* a tiny binary heap of {at, a, v} */
  function push(st, at, a) {
    var h = st.heap, e = { at: at, a: a, v: a.v, n: st.seq++ };
    h.push(e);
    for (var i = h.length - 1; i > 0;) {
      var j = (i - 1) >> 1;
      if (less(h[j], h[i])) break;
      var x = h[i]; h[i] = h[j]; h[j] = x; i = j;
    }
  }
  function less(x, y) { return x.at < y.at || (x.at === y.at && x.n < y.n); }
  function pop(st) {
    var h = st.heap, top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last;
      for (var i = 0; ;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < h.length && less(h[l], h[m])) m = l;
        if (r < h.length && less(h[r], h[m])) m = r;
        if (m === i) break;
        var x = h[i]; h[i] = h[m]; h[m] = x; i = m;
      }
    }
    return top;
  }

  /* ------------------------------------------------------------------ Nginx */

  function upNow(p, t) {
    if (p.state === "starting" && t >= p.since + LAB.startup) p.state = "up";
    return p.state;
  }
  function disabled(p, t) { return p.fails >= LAB.maxFails && t - p.checked <= LAB.failTimeout; }

  /* round robin over the eligible peers (ngx_http_upstream_get_round_robin_peer, equal weights) */
  function choose(st, t, tried) {
    var n = st.peers.length;
    for (var k = 0; k < n; k++) {
      var p = st.peers[(st.rr + k) % n];
      if (tried[p.k] || !p.resolved || disabled(p, t)) continue;
      st.rr = p.k % n;
      if (t - p.checked > LAB.failTimeout) p.checked = t;
      return p;
    }
    return null;
  }
  function service(st, req) {
    var u = st.rand();
    return (req.list ? LIST[0] + LIST[1] * u : DETAIL[0] + DETAIL[1] * -Math.log(1 - u)) / 1000;
  }
  function attempt(st, req, p, t) {
    req.tries++; req.tried[p.k] = true;
    var a = { req: req, p: p, start: t, v: 0 }, s = upNow(p, t);
    if (s === "up") {
      a.ok = true; a.end = t + service(st, req);
      var c = p.conns.filter(function (x) { return x.busy <= t; })[0] || (p.conns.push({ busy: 0 }), p.conns[p.conns.length - 1]);
      c.busy = a.end; a.conn = c;
    } else if (s === "starting" || s === "stopped") {
      a.ok = false; a.kind = "refused"; a.end = t + 0.001;
    } else {                                  /* paused: nobody answers */
      var idle = p.conns.filter(function (x) { return x.busy <= t; })[0];
      a.ok = false;
      if (idle) { a.kind = "read"; a.end = t + LAB.readTimeout; idle.busy = a.end; a.conn = idle; }
      else { a.kind = "connect"; a.end = t + LAB.connectTimeout; }
    }
    p.inflight.push(a);
    push(st, a.end, a);
  }
  function arrive(st, req) {
    var p = choose(st, req.t0, req.tried);
    if (!p) { err(st, "error", "no live upstreams while connecting to upstream"); return finish(st, req, req.t0, 502, null); }
    attempt(st, req, p, req.t0);
  }
  function finish(st, req, t, status, p) {
    req.end = t; req.status = status; req.by = p ? p.name : null; req.lat = t - req.t0;
    st.done.push(req);
    var sec = Math.floor(req.t0), b = st.perSec[sec] || (st.perSec[sec] = { by: {}, max: 0, n: 0, s429: {}, s200: {}, bad: 0 });
    b.n++;
    if (p) b.by[p.name] = (b.by[p.name] || 0) + 1;
    if (req.lat > b.max) b.max = req.lat;
    if (status >= 500) b.bad++;
    var key = req.client || "-";
    if (status === 429) b.s429[key] = (b.s429[key] || 0) + 1;
    if (status === 200) b.s200[key] = (b.s200[key] || 0) + 1;
    if (st.access.length > 200) st.access.splice(0, 100);
    st.access.push(req);
  }
  var KIND = {
    refused: "connect() failed (111: Connection refused) while connecting to upstream",
    connect: "upstream timed out (110: Operation timed out) while connecting to upstream",
    read: "upstream timed out (110: Operation timed out) while reading response header from upstream",
    closed: "upstream prematurely closed connection while reading response header from upstream"
  };
  function complete(st, a, t) {
    var p = a.p, req = a.req;
    p.inflight.splice(p.inflight.indexOf(a), 1);
    if (a.ok) {
      p.served++;
      if (p.accessed < p.checked) p.fails = 0;
      return finish(st, req, t, 200, p);
    }
    if (a.conn) p.conns.splice(p.conns.indexOf(a.conn), 1);   /* a timed-out connection is closed */
    p.fails++; p.accessed = t; p.checked = t;
    req.failed.push({ p: p.name, kind: a.kind, wait: t - a.start });
    err(st, "error", KIND[a.kind], p);
    if (p.fails === LAB.maxFails) err(st, "warn", "upstream server temporarily disabled while connecting to upstream", p);
    if (req.tries < LAB.tries) {
      var q = choose(st, t, req.tried);
      if (q) return attempt(st, req, q, t);
      err(st, "error", "no live upstreams while connecting to upstream");
    }
    finish(st, req, t, a.kind === "read" || a.kind === "connect" ? 504 : 502, null);
  }
  /* Docker's DNS, re-asked every resolver valid= seconds: a stopped container's name is gone */
  function resolve(st, t) {
    st.peers.forEach(function (p) {
      var running = p.state !== "stopped";
      if (p.resolved && !running) { p.resolved = false; err(st, "error", p.name + " could not be resolved (3: Host not found)"); }
      else if (!p.resolved && running) { p.resolved = true; p.fails = 0; p.checked = t; p.conns = []; }
    });
  }
  /* ngx_http_limit_req_module: excess in milli-requests, ms clock */
  function limit(st, key, t) {
    if (!key) return true;                    /* an empty key is not limited */
    var ms = Math.floor(t * 1000 + 1e-6), b = st.buckets[key];
    if (!b) { st.buckets[key] = { excess: 0, last: ms }; return true; }
    var excess = Math.max(0, b.excess - LAB.rate * (ms - b.last) + 1000);
    if (excess > LAB.burst * 1000) return false;
    b.excess = excess; if (ms - b.last) b.last = ms;
    return true;
  }

  /* run the clock to `until`, with arrival streams [{rate, key, client}] (or none) */
  function advance(st, until, streams) {
    streams = streams || [];
    var nexts = streams.map(function (s) { return { s: s, i: 0, t0: st.t }; });
    function nextArrival() {
      var best = null;
      nexts.forEach(function (x) { var at = x.t0 + x.i / x.s.rate; if (at < until - 1e-9 && (!best || at < best.at)) best = { at: at, x: x }; });
      return best;
    }
    for (;;) {
      var na = nextArrival(), top = st.heap[0], nr = st.nextResolve <= until ? st.nextResolve : Infinity;
      while (top && top.v !== top.a.v) { pop(st); top = st.heap[0]; }
      var tc = top && top.at <= until ? top.at : Infinity, ta = na ? na.at : Infinity;
      var tn = Math.min(tc, ta, nr);
      if (tn === Infinity) break;
      st.t = tn;
      if (tn === nr && nr <= tc && nr <= ta) { resolve(st, tn); st.nextResolve += LAB.resolverValid; continue; }
      if (tc <= ta) { pop(st); complete(st, top.a, tc); continue; }
      na.x.i++;
      var req = { id: ++st.ids, t0: ta, list: na.x.s.list !== false && st.rand() < LAB.listShare, tries: 0, tried: {}, failed: [], client: na.x.s.client || null };
      if (!limit(st, na.x.s.key, ta)) { finish(st, req, ta + 0.0002, 429, null); continue; }
      arrive(st, req);
    }
    st.t = until;
  }

  /* ------------------------------------------------------------------ the lab's commands */

  function at(st, t) { return Math.round(t * 10) / 10; }
  function stop(st, name) {
    var p = peer(st, name), t = st.t;
    p.state = "stopped"; p.since = t; p.conns = [];
    p.inflight.slice().forEach(function (a) { if (a.ok) { a.ok = false; a.kind = "closed"; a.end = t; a.conn = null; a.v++; push(st, t, a); } });
    return { cmd: "$ docker compose stop " + name, out: [" ✔ Container boxoffice-" + name + "-1  Stopped"], tone: "warn",
      note: [name + " is dead: it refuses connections. Nginx retries each failed request on another replica.", name + " morreu: recusa conexões. O Nginx repete cada requisição que falhou em outra réplica."] };
  }
  function start(st, name) {
    var p = peer(st, name);
    p.state = "starting"; p.since = st.t; p.conns = [];
    return { cmd: "$ docker compose start " + name, out: [" ✔ Container boxoffice-" + name + "-1  Started"], tone: "info",
      note: [name + " starts (~" + LAB.startup + " s of JVM startup): until then it refuses connections.", name + " inicia (~" + LAB.startup + " s de partida da JVM): até lá recusa conexões."] };
  }
  function pause(st, name) {
    var p = peer(st, name), t = st.t;
    p.state = "paused"; p.since = t;
    p.inflight.slice().forEach(function (a) { if (a.ok) { a.ok = false; a.kind = "read"; a.end = a.start + LAB.readTimeout; a.v++; push(st, a.end, a); } });
    return { cmd: "$ docker compose pause " + name, out: [" ✔ Container boxoffice-" + name + "-1  Paused"], tone: "warn",
      note: [name + " is frozen: connections stay open, nothing answers. Only a timeout tells Nginx.", name + " congelou: as conexões ficam abertas, nada responde. Só um timeout avisa o Nginx."] };
  }
  function unpause(st, name) {
    var p = peer(st, name), t = st.t;
    p.state = "up"; p.since = t;
    p.inflight.slice().forEach(function (a) { if (!a.ok && (a.kind === "read" || a.kind === "connect")) { a.ok = true; a.end = t + service(st, a.req); a.v++; push(st, a.end, a); } });
    return { cmd: "$ docker compose unpause " + name, out: [" ✔ Container boxoffice-" + name + "-1  Unpaused"], tone: "ok",
      note: [name + " runs again. Nginx sends it a trial request when its fail_timeout ends.", name + " roda de novo. O Nginx manda uma requisição de teste quando o fail_timeout dele acaba."] };
  }
  /* k6 at RATE req/s for `secs` seconds (load.js, open model) */
  function load(st, secs, rate) {
    rate = rate || LAB.loadRate;
    if (!st.load) st.load = { from: st.done.length, t0: st.t, rate: rate };
    var from = st.done.length, t0 = st.t;
    advance(st, st.t + secs, [{ rate: rate }]);
    var reqs = st.done.slice(from), slow = reqs.filter(function (r) { return r.lat >= 1; }).length, bad = reqs.filter(function (r) { return r.status >= 500; }).length;
    var retried = reqs.filter(function (r) { return r.failed.length; }).length;
    var by = {};
    reqs.forEach(function (r) { if (r.by) by[r.by] = (by[r.by] || 0) + 1; });
    var parts = st.peers.map(function (p) { return p.name + " " + (by[p.name] || 0); }).join(", ");
    return { cmd: "# k6 keeps sending " + rate + " req/s: t = " + at(st, t0) + " → " + at(st, st.t) + " s", out: [], secs: secs, reqs: reqs,
      tone: bad ? "bad" : slow ? "warn" : retried ? "info" : "ok",
      note: [reqs.length + " requests (" + parts + "); " + retried + " retried on another replica, " + slow + " took ≥ 1 s, " + bad + " errors.",
        reqs.length + " requisições (" + parts + "); " + retried + " repetidas em outra réplica, " + slow + " levaram ≥ 1 s, " + bad + " erros."] };
  }
  function pct(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0; }
  function dur(s) {
    var ms = s * 1000;
    if (ms < 1000) return (Math.round(ms * 100) / 100).toFixed(2).replace(/\.?0+$/, "") + "ms";
    return String(Math.round(ms / 10) / 100).replace(/\.?0+$/, "") + "s";
  }
  /* k6's end-of-test summary of the current load */
  function summary(st) {
    var reqs = st.load ? st.done.slice(st.load.from) : [];
    var lat = reqs.map(function (r) { return r.lat; }).sort(function (a, b) { return a - b; });
    var avg = lat.reduce(function (s, x) { return s + x; }, 0) / Math.max(1, lat.length), bad = reqs.filter(function (r) { return r.status >= 500; }).length;
    var res = { n: reqs.length, avg: avg, med: pct(lat, 0.5), p95: pct(lat, 0.95), p99: pct(lat, 0.99), max: lat[lat.length - 1] || 0, bad: bad,
      slow: reqs.filter(function (r) { return r.lat >= 1; }).length, retried: reqs.filter(function (r) { return r.failed.length; }).length };
    var rate = (bad / Math.max(1, reqs.length) * 100).toFixed(2);
    return { cmd: "# k6 ends: the summary", res: res, tone: bad ? "bad" : res.max >= 1 ? "warn" : "ok",
      out: ["http_req_duration..............: avg=" + dur(avg) + " med=" + dur(res.med) + " p(95)=" + dur(res.p95) + " p(99)=" + dur(res.p99) + " max=" + dur(res.max),
        "http_req_failed................: " + rate + "%  " + bad + " out of " + reqs.length],
      note: ["No errors, " + res.retried + " requests retried on another replica — but " + res.slow + " took ≥ 1 s and the slowest " + dur(res.max) + ": the freeze shows up only in the tail.",
        "Nenhum erro, " + res.retried + " requisições repetidas em outra réplica — mas " + res.slow + " levaram ≥ 1 s e a mais lenta " + dur(res.max).replace(".", ",") + ": o congelamento só aparece na cauda."] };
  }
  function logs(st) {
    var lines = st.errlog.filter(function (l) { return l.t > st.t - 60; }).slice(-6).map(function (l) { return "edge-1  | " + l.line; });
    return { cmd: "$ docker compose logs edge --tail 6", out: lines.length ? lines : ["(no errors)"], tone: "info",
      note: ["The error log names each failed attempt, why it failed, and each replica Nginx disables.", "O log de erros mostra cada tentativa que falhou, o motivo, e cada réplica que o Nginx desativa."] };
  }
  function accessLine(st, r) {
    var p = r.by ? peer(st, r.by) : null, ut = p ? (r.lat - r.failed.reduce(function (s, f) { return s + f.wait; }, 0)) : 0;
    var up = r.failed.map(function (f) { return peer(st, f.p).ip + ":8082"; }).concat(p ? [p.ip + ":8082"] : []).join(", ") || "-";
    var uts = r.failed.map(function (f) { return f.wait.toFixed(3); }).concat(p ? [Math.max(0.001, ut).toFixed(3)] : []).join(", ") || "-";
    return "edge-1  | 172.18.0.1 \"GET /catalog/events/1 HTTP/1.1\" " + r.status + " rt=" + Math.max(0.001, r.lat + 0.0005).toFixed(3) + " upstream=" + up + " ut=" + uts + " id=" + r.rid + "...";
  }
  /* curl through the edge, one request every 0.1 s */
  function curls(st, n) {
    var from = st.done.length;
    for (var i = 0; i < n; i++) {
      var req = { id: ++st.ids, t0: st.t, list: false, tries: 0, tried: {}, failed: [], rid: hex(st, 10) };
      arrive(st, req);
      advance(st, st.t + 0.1);
    }
    var reqs = st.done.slice(from), by = {};
    reqs.forEach(function (r) { if (r.by) by[r.by] = (by[r.by] || 0) + 1; });
    var out = Object.keys(by).sort().map(function (k) { return "   " + by[k] + " X-Instance: " + k; });
    return { cmd: "$ for i in $(seq 1 " + n + "); do curl -s -o /dev/null -D - localhost/catalog/events/1 | grep -i x-instance; done | sort | uniq -c",
      out: out, reqs: reqs, by: by, tone: reqs.every(function (r) { return r.status === 200; }) ? "ok" : "bad",
      note: ["Round robin: " + Object.keys(by).sort().map(function (k) { return k + " ×" + by[k]; }).join(", ") + ".", "Round robin: " + Object.keys(by).sort().map(function (k) { return k + " ×" + by[k]; }).join(", ") + "."] };
  }
  function accessLog(st, n) {
    var lines = st.access.filter(function (r) { return r.rid; }).slice(-n).map(function (r) { return accessLine(st, r); });
    return { cmd: "$ docker compose logs edge --tail " + n, out: lines, tone: "info",
      note: ["rt is the time at the edge, ut the time inside the replica: the difference is the extra hop. Each request reached another address (upstream=).",
        "rt é o tempo na borda, ut o tempo dentro da réplica: a diferença é o salto extra. Cada requisição foi a outro endereço (upstream=)."] };
  }
  function healthz() {
    return { cmd: "$ curl -s localhost/healthz", out: ["ok"], tone: "ok", note: ["The edge answers by itself: /healthz touches no replica.", "A borda responde sozinha: /healthz não toca nenhuma réplica."] };
  }
  function actuator() {
    return { cmd: "$ curl -s -o /dev/null -w '%{http_code}\\n' localhost/actuator/health", out: ["404"], tone: "ok",
      note: ["location / { return 404; }: only /catalog/ is public, the replicas' /actuator is not reachable from outside.", "location / { return 404; }: só /catalog/ é público, o /actuator das réplicas não é alcançável de fora."] };
  }
  /* load/ratelimit.js: greedy and polite share the edge for `secs` seconds */
  function ratelimit(st, secs) {
    if (!st.rl) st.rl = { from: st.done.length };
    advance(st, st.t + secs, [{ rate: LAB.greedy, key: "partner-greedy", client: "greedy", list: false }, { rate: LAB.polite, key: "partner-polite", client: "polite", list: false }]);
    var c = rlCounts(st);
    return { cmd: "# ratelimit.js: t = " + at(st, st.t - secs) + " → " + at(st, st.t) + " s", out: [], tone: c.greedy[429] ? "warn" : "ok", counts: c,
      note: ["So far: greedy " + c.greedy[200] + " × 200 and " + c.greedy[429] + " × 429; polite " + c.polite[200] + " × 200 and " + c.polite[429] + " × 429.",
        "Até aqui: greedy " + c.greedy[200] + " × 200 e " + c.greedy[429] + " × 429; polite " + c.polite[200] + " × 200 e " + c.polite[429] + " × 429."] };
  }
  function rlCounts(st) {
    var c = { greedy: { 200: 0, 429: 0 }, polite: { 200: 0, 429: 0 } };
    st.done.slice(st.rl ? st.rl.from : 0).forEach(function (r) { if (r.client && c[r.client][r.status] !== undefined) c[r.client][r.status]++; });
    return c;
  }
  function rlSummary(st) {
    var c = rlCounts(st), out = [];
    ["greedy", "polite"].forEach(function (k) { [200, 429].forEach(function (s) { out.push("http_reqs{scenario:" + k + ",status:" + s + "}", "✓ 'count>=0' count=" + c[k][s]); }); });
    return { cmd: "# k6 ends: one line per scenario and status", out: out, counts: c, tone: "ok",
      note: ["greedy got " + c.greedy[200] + " answers: the burst of " + LAB.burst + " plus " + LAB.rate + "/s for " + LAB.rlSeconds + " s. polite never went above " + LAB.rate + "/s: no 429.",
        "greedy recebeu " + c.greedy[200] + " respostas: o burst de " + LAB.burst + " mais " + LAB.rate + "/s por " + LAB.rlSeconds + " s. polite nunca passou de " + LAB.rate + "/s: nenhum 429."] };
  }

  var SCRIPTS = {
    spread: [
      { ops: [["healthz"]], en: "The edge's own liveness: Nginx answers without touching a replica.", pt: "A vivacidade da própria borda: o Nginx responde sem tocar uma réplica." },
      { ops: [["curls", 9]], en: "Step 4's loop: 9 requests, round robin, 3 per replica.", pt: "O loop do passo 4: 9 requisições, round robin, 3 por réplica." },
      { ops: [["access", 3]], en: "The access log: who served each request (upstream=), rt at the edge and ut in the replica.", pt: "O log de acesso: quem atendeu cada requisição (upstream=), rt na borda e ut na réplica." },
      { ops: [["actuator"]], en: "Everything outside /catalog/ is 404 at the edge.", pt: "Tudo fora de /catalog/ é 404 na borda." }
    ],
    failures: [
      { ops: [["load", 12]], en: "k6 at " + LAB.loadRate + " req/s: each replica gets a third, no retries, a few milliseconds each.", pt: "k6 a " + LAB.loadRate + " req/s: cada réplica recebe um terço, sem repetições, poucos milissegundos cada." },
      { ops: [["stop", "catalog-2"], ["load", 20]], en: "stop catalog-2, sleep 20: a few refused attempts, each retried at once; 3 fails disable it, then its name stops resolving.", pt: "stop catalog-2, sleep 20: poucas tentativas recusadas, cada uma repetida na hora; 3 falhas a desativam, depois o nome some do DNS." },
      { ops: [["logs"]], en: "The edge's error log: refused, temporarily disabled, could not be resolved.", pt: "O log de erros da borda: recusada, desativada temporariamente, nome não resolvido." },
      { ops: [["start", "catalog-2"], ["load", 30]], en: "start catalog-2, sleep 30: while the JVM starts it refuses; a trial after fail_timeout brings it back.", pt: "start catalog-2, sleep 30: enquanto a JVM inicia ela recusa; uma tentativa depois do fail_timeout a traz de volta." },
      { ops: [["pause", "catalog-3"], ["load", 20]], en: "pause catalog-3, sleep 20: no errors, but every request it gets waits for a timeout — 1 s on a new connection, 5 s on a kept-alive one — before the retry.", pt: "pause catalog-3, sleep 20: nenhum erro, mas cada requisição que ela recebe espera um timeout — 1 s numa conexão nova, 5 s numa reaproveitada — antes da repetição." },
      { ops: [["logs"]], en: "upstream timed out (110): the only signal a frozen replica gives.", pt: "upstream timed out (110): o único sinal que uma réplica congelada dá." },
      { ops: [["unpause", "catalog-3"], ["load", 38], ["summary"]], en: "unpause, and k6 ends at 2 minutes: the summary.", pt: "unpause, e o k6 termina aos 2 minutos: o resumo." }
    ],
    ratelimit: [
      { ops: [["ratelimit", 2]], en: "ratelimit.js starts: greedy (50 req/s) spends its burst of 40, then gets 429 for everything above 20/s.", pt: "ratelimit.js começa: greedy (50 req/s) gasta o burst de 40 e depois recebe 429 para tudo acima de 20/s." },
      { ops: [["ratelimit", 28]], en: "28 s more: greedy settles at 20 answers per second; polite (10 req/s) never sees a 429.", pt: "Mais 28 s: greedy se acomoda em 20 respostas por segundo; polite (10 req/s) nunca vê um 429." },
      { ops: [["rlsummary"]], en: "k6's lines, as step 6 prints them.", pt: "As linhas do k6, como o passo 6 as imprime." }
    ]
  };
  var OPS = { load: load, stop: stop, start: start, pause: pause, unpause: unpause, logs: logs, summary: summary, curls: curls, access: accessLog,
    healthz: healthz, actuator: actuator, ratelimit: ratelimit, rlsummary: rlSummary };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function play(name, n, o) {
    var st = create(o), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (step) { step.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { LAB: LAB, SCRIPTS: SCRIPTS, create: create, run: run, play: play, advance: advance, limit: limit, choose: choose, disabled: disabled,
    load: load, stop: stop, start: start, pause: pause, unpause: unpause, summary: summary, logs: logs, curls: curls, ratelimit: ratelimit, rlSummary: rlSummary, dur: dur };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }
  function num(x) { return PT ? String(x).replace(".", ",") : String(x); }
  var CL = { x: 4, y: 82, w: 104, h: 60 }, NG = { x: 152, y: 58, w: 200, h: 108 }, RX = 398, RW = 218, RH = 52;
  var TONES = ["tone-ink", "tone-ok", "tone-warn"];

  C.style("nginx-edge", [
    ".md-typeset .csim .csim-ne-rep { cursor: pointer; }",
    ".md-typeset .csim .csim-ne-rep.sel > rect:first-child { stroke-width: 3; }",
    ".md-typeset .csim-log.csim-ne-term li { font-family: var(--md-code-font-family, monospace); font-size: .6rem; white-space: pre-wrap; }",
    ".md-typeset .csim-log.csim-ne-term li b { font-weight: 600; }",
    ".md-typeset .csim-ne-charts { display: flex; flex-wrap: wrap; gap: .6rem; }",
    ".md-typeset .csim-ne-charts > * { flex: 1 1 14rem; min-width: 0; }"
  ].join("\n"));

  C.register("nginx-edge", function (root) {
    var o = C.opts(root, { script: "failures" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, sel = "catalog-3", lastBy = {}, mode = "load";

    var svg = s("svg", { viewBox: "0 0 620 230", role: "img", "aria-label": t("Nginx in front of three catalog replicas", "Nginx na frente de três réplicas do catalog") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(7); term.className += " csim-ne-term";
    var tiles = C.stats([
      { key: "n", label: t("requests", "requisições") },
      { key: "retried", label: t("retried on another replica", "repetidas em outra réplica") },
      { key: "slow", label: t("took ≥ 1 s", "levaram ≥ 1 s") },
      { key: "max", label: t("slowest", "mais lenta") },
      { key: "bad", label: t("errors (5xx)", "erros (5xx)") },
      { key: "r429", label: "429" }
    ]);
    var chartA, chartB, charts = el("div", { class: "csim-ne-charts" });
    function makeCharts() {
      C.clear(charts);
      if (mode === "rl") {
        chartA = C.chart({ title: t("Answers per second, by client", "Respostas por segundo, por cliente"), len: LAB.rlSeconds, series: [
          { label: "greedy 200", cls: "tone-ok" }, { label: "greedy 429", cls: "tone-bad" }, { label: "polite 200", cls: "tone-ink" }] });
        chartB = null;
        charts.appendChild(chartA);
      } else {
        chartA = C.chart({ title: t("Requests per second served by each replica", "Requisições por segundo atendidas por cada réplica"), len: 120,
          series: st.peers.map(function (p, i) { return { label: p.name, cls: TONES[i] }; }) });
        chartB = C.chart({ title: t("Slowest request of each second (ms)", "Requisição mais lenta de cada segundo (ms)"), len: 120, series: [{ label: t("max latency", "latência máxima"), cls: "tone-bad" }] });
        charts.appendChild(chartA); charts.appendChild(chartB);
      }
    }
    function plot(from, to) {
      for (var sec = Math.floor(from); sec < Math.round(to); sec++) {
        var b = st.perSec[sec] || { by: {}, max: 0, s200: {}, s429: {} };
        if (mode === "rl") chartA.push([b.s200.greedy || 0, b.s429.greedy || 0, b.s200.polite || 0]);
        else { chartA.push(st.peers.map(function (p) { return b.by[p.name] || 0; })); chartB.push([Math.round(b.max * 1000)]); }
      }
    }
    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function show(r) {
      term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone);
      if (r.reqs) { lastBy = {}; r.reqs.forEach(function (q) { if (q.by) lastBy[q.by] = (lastBy[q.by] || 0) + 1; }); }
    }
    function exec(op) {
      var t0 = st.t;
      if ((op[0] === "ratelimit") !== (mode === "rl") && (op[0] === "ratelimit" || op[0] === "load")) { mode = op[0] === "ratelimit" ? "rl" : "load"; makeCharts(); }
      var r = run(st, op);
      if (st.t > t0 && (op[0] === "load" || op[0] === "ratelimit")) plot(t0, st.t);
      show(r);
      return r;
    }

    var cScript = C.choice({ label: t("Lab step", "Passo do lab"), value: script, options: [
      { value: "spread", label: t("4 · spread", "4 · distribuição") },
      { value: "failures", label: t("5 · stop and freeze", "5 · parar e congelar") },
      { value: "ratelimit", label: t("6 · rate limit", "6 · rate limit") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });

    function act(fn) { return function () { player.pause(); var r = fn(); if (r) say(r.note, r.tone); draw(); }; }
    var B = {
      curls: C.button(t("curl ×9", "curl ×9"), act(function () { return exec(["curls", 9]); }), { tone: "ok" }),
      load: C.button(t("k6: 10 s at 150 req/s", "k6: 10 s a 150 req/s"), act(function () { return exec(["load", 10]); })),
      stop: C.button("stop", act(function () { return exec(["stop", sel]); }), { tone: "bad" }),
      start: C.button("start", act(function () { return exec(["start", sel]); })),
      pause: C.button("pause", act(function () { return exec(["pause", sel]); }), { tone: "bad" }),
      unpause: C.button("unpause", act(function () { return exec(["unpause", sel]); })),
      logs: C.button(t("logs edge", "logs edge"), act(function () { return exec(["logs"]); })),
      rl: C.button(t("ratelimit.js: 10 s", "ratelimit.js: 10 s"), act(function () { return exec(["ratelimit", 10]); }))
    };

    var player = C.player({ interval: 2200, onTick: function (k) { return step(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });

    function step(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "", lastNote = null;
      sc[k - 1].ops.forEach(function (op) { var r = exec(op); lastNote = r.note; if (r.tone === "bad" || (r.tone === "warn" && tone !== "bad")) tone = r.tone; });
      var tail = /load|summary|curls|ratelimit|rlsummary/.test(sc[k - 1].ops[sc[k - 1].ops.length - 1][0]) ? " " + L(lastNote) : "";
      note.textContent = L([sc[k - 1].en, sc[k - 1].pt]) + tail;
      note.className = "csim-note" + (tone ? " csim-" + tone : "");
      draw();
    }
    function replay(k) { fresh(); for (var i = 1; i <= k; i++) step(i); if (!k) intro(); draw(); }
    function intro() {
      say(script === "free"
        ? ["Click a replica to select it, then stop, start, pause or unpause it; run k6 for 10 s and read the edge's log. Every button is a command of the lab.",
           "Clique numa réplica para selecioná-la e pare, inicie, pause ou retome; rode o k6 por 10 s e leia o log da borda. Cada botão é um comando do lab."]
        : ["The lab's stack: edge (Nginx) on port 80 and three catalog replicas with no published port. Press play or → to run the page's commands; the buttons work at any time.",
           "A pilha do lab: edge (Nginx) na porta 80 e três réplicas do catalog sem porta publicada. Aperte play ou → para rodar os comandos da página; os botões funcionam a qualquer momento."], "");
    }
    function fresh() { st = create(); term.clear(); lastBy = {}; mode = script === "ratelimit" ? "rl" : "load"; makeCharts(); }
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
      var now = st.t, rl = mode === "rl";
      st.peers.forEach(function (p, i) {
        var y = 14 + i * 72, cy = y + RH / 2, off = disabled(p, now), state = upNow(p, now);
        var cls = "c-wire" + (!p.resolved ? "" : off ? " cut" : lastBy[p.name] ? " on" : "");
        svg.appendChild(s("path", { d: "M" + (NG.x + NG.w) + "," + (NG.y + NG.h / 2) + " C" + (NG.x + NG.w + 30) + "," + (NG.y + NG.h / 2) + " " + (RX - 30) + "," + cy + " " + RX + "," + cy, class: cls }));
        var bc = state === "stopped" ? "down" : state === "paused" ? "bad" : state === "starting" || off ? "warn" : "on";
        var g = s("g", { class: "csim-ne-rep" + (p.name === sel ? " sel" : ""), onclick: function () { sel = p.name; draw(); } });
        g.appendChild(box(RX, y, RW, RH, bc));
        g.appendChild(text(RX + 8, y + 16, p.name, "c-label"));
        g.appendChild(text(RX + RW - 8, y + 16, p.ip + ":8082", "c-small c-mono", "end"));
        var line = state === "stopped" ? (p.resolved ? t("stopped: refuses", "parada: recusa") : t("stopped · name not resolved", "parada · nome não resolve"))
          : state === "starting" ? t("starting (JVM): refuses", "iniciando (JVM): recusa")
          : state === "paused" ? t("paused: answers nothing", "pausada: não responde nada") : t("up", "no ar");
        g.appendChild(text(RX + 8, y + 31, line, "c-small" + (state === "up" ? "" : " c-warn")));
        var acc = (off ? t("disabled until t = ", "desativada até t = ") + num(Math.round((p.checked + LAB.failTimeout) * 10) / 10) + " s · " : "") +
          t("fails ", "falhas ") + Math.min(p.fails, LAB.maxFails) + "/" + LAB.maxFails + " · " + p.served + t(" served", " atendidas");
        g.appendChild(text(RX + 8, y + 45, acc, "c-small" + (off ? " c-bad" : "")));
        svg.appendChild(g);
      });
      svg.appendChild(s("line", { x1: CL.x + CL.w, y1: CL.y + CL.h / 2, x2: NG.x, y2: CL.y + CL.h / 2, class: "c-wire on" }));
      svg.appendChild(text((CL.x + CL.w + NG.x) / 2, CL.y + CL.h / 2 - 5, ":80", "c-small c-mono", "middle"));
      svg.appendChild(box(CL.x, CL.y, CL.w, CL.h, "on"));
      svg.appendChild(text(CL.x + CL.w / 2, CL.y + 22, rl ? "k6" : script === "spread" ? "curl" : "k6", "c-label", "middle"));
      svg.appendChild(text(CL.x + CL.w / 2, CL.y + 38, rl ? "greedy 50/s" : script === "spread" ? "localhost" : LAB.loadRate + " req/s", "c-small c-mono", "middle"));
      if (rl) svg.appendChild(text(CL.x + CL.w / 2, CL.y + 51, "polite 10/s", "c-small c-mono", "middle"));
      svg.appendChild(box(NG.x, NG.y, NG.w, NG.h, "hot"));
      svg.appendChild(text(NG.x + 8, NG.y + 17, t("edge · Nginx", "edge · Nginx"), "c-label"));
      svg.appendChild(text(NG.x + 8, NG.y + 33, "upstream catalog · round robin", "c-small c-mono"));
      svg.appendChild(text(NG.x + 8, NG.y + 48, "max_fails=" + LAB.maxFails + " fail_timeout=" + LAB.failTimeout + "s", "c-small c-mono"));
      svg.appendChild(text(NG.x + 8, NG.y + 63, "connect " + LAB.connectTimeout + "s · read " + LAB.readTimeout + "s · tries " + LAB.tries, "c-small c-mono"));
      svg.appendChild(text(NG.x + 8, NG.y + 78, "limit_req " + LAB.rate + "r/s burst=" + LAB.burst + " nodelay", "c-small c-mono"));
      svg.appendChild(text(NG.x + 8, NG.y + 96, "t = " + num(Math.round(now * 10) / 10) + " s", "c-small c-mono"));
      var p = st.peers.filter(function (x) { return x.name === sel; })[0], ps = upNow(p, now);
      B.stop.textContent = "stop " + sel; B.start.textContent = "start " + sel; B.pause.textContent = "pause " + sel; B.unpause.textContent = "unpause " + sel;
      B.stop.disabled = ps === "stopped"; B.start.disabled = ps !== "stopped"; B.pause.disabled = ps !== "up"; B.unpause.disabled = ps !== "paused";
      var from = rl ? (st.rl ? st.rl.from : st.done.length) : (st.load ? st.load.from : 0), reqs = st.done.slice(from);
      var slow = reqs.filter(function (r) { return r.lat >= 1; }).length, bad = reqs.filter(function (r) { return r.status >= 500; }).length;
      var max = reqs.reduce(function (m, r) { return Math.max(m, r.lat); }, 0), retried = reqs.filter(function (r) { return r.failed.length; }).length;
      tiles.set("n", String(reqs.length), "");
      tiles.set("retried", String(retried), retried ? "warn" : "ok");
      tiles.set("slow", String(slow), slow ? "warn" : "ok");
      tiles.set("max", reqs.length ? num(dur(max)) : "–", max >= 1 ? "bad" : max ? "ok" : "");
      tiles.set("bad", String(bad), bad ? "bad" : "ok");
      var r429 = reqs.filter(function (r) { return r.status === 429; }).length;
      tiles.set("r429", String(r429), r429 ? "warn" : "");
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's edge, without Docker: round robin, a replica that stops, one that freezes, and a rate limit",
        "A borda do lab, sem Docker: round robin, uma réplica que para, outra que congela, e um rate limit") }),
      el("p", { class: "csim-sub", text: t("The lab's nginx.conf, request by request. Click a replica to select it; dashed red wires are disabled replicas.",
        "O nginx.conf do lab, requisição por requisição. Clique numa réplica para selecioná-la; fios vermelhos tracejados são réplicas desativadas.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      el("div", { class: "csim-row" }, [B.curls, B.load, B.stop, B.start, B.pause, B.unpause, B.logs, B.rl]),
      note,
      player,
      tiles,
      charts,
      term
    ]);
    reset();
    return {};
  });
})();
