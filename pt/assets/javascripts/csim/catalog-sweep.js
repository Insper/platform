/*
 * The catalog of hands-on 2 (2027.1) under k6, as a lab twin:
 *
 *   <div class="csim" data-sim="catalog-sweep" data-script="sweep"></div>
 *
 * One `catalog` (1 CPU, Tomcat's 200 threads, a Hikari pool of DB_POOL_SIZE connections) in front of
 * PostgreSQL, loaded by the lab's k6 scripts: load.js (open model, constant-arrival-rate, 80% event
 * details and 20% city listings, preAllocatedVUs = max(20, RATE), maxVUs = max(200, RATE × 10)),
 * sweep.sh (a 30 s warm-up, then one minute per rate with 10 s between steps) and stress.js (the
 * staircase up to PEAK and back, timeout 10 s, maxVUs 2000). Every number taken from the lab is in LAB
 * (registered in scripts/csim/lab-values.mjs). A script (data-script) replays a step of the page:
 * closed (section 1: the same overload seen by a closed and an open model), sweep (step 4), pool30
 * (step 6: DB_POOL_SIZE=30) or stress (step 7); "free" leaves only the buttons.
 *
 * The model (illustrative service demands, calibrated on the page's example run, below):
 *   - a request takes a Tomcat thread (or waits for one), spends a little CPU, takes a connection from
 *     the pool (or waits for one: hikaricp.connections.pending), runs its query in PostgreSQL, maps the
 *     rows on the catalog CPU still holding the connection (@Transactional), returns the connection
 *     and serializes the JSON;
 *   - the catalog CPU (1 core) and PostgreSQL's cores are shared by the jobs on them (processor sharing);
 *     an event detail is a primary-key lookup (0.3 ms of database CPU); a city listing scans and sorts
 *     (DB_LIST core-ms, spread over up to 3 processes, like a parallel query), so the listings, not the
 *     details, fill the database: the lab 3 page measured PostgreSQL at ~670% CPU with this mix;
 *   - k6 starts one iteration every 1/RATE s on a free VU; when none is free the iteration is dropped
 *     (dropped_iterations) and k6 initializes one more VU, up to maxVUs.
 * With these demands the model reproduces the shape of the page's sweep (flat p99 up to 300 req/s, a
 * knee near 400, throughput stuck below 500 with dropped iterations) and its watch-metrics line at
 * 600 req/s (200 busy threads, 10 active connections, 190 waiting); the pool of 30 is a prediction.
 */
(function () {
  "use strict";

  /* the lab's values: lab 1's application.yaml and compose, lab 2's load.js, stress.js, sweep.sh and page */
  var LAB = { pool: 10, bigPool: 30, threads: 200, cpus: 1, listShare: 0.2, rates: "50 100 200 300 400 500 600",
    warmup: 30, duration: 60, pause: 10, preMin: 20, maxMin: 200, maxMult: 10,
    peak: 600, stressVUs: 2000, stressTimeout: 10, stages: "0.25/30 0.25/30 0.5/30 0.5/30 0.75/30 0.75/30 1/30 1/60 0.25/15 0.25/60" };
  /* illustrative demands (ms): catalog CPU before the pool, holding it, after it; database CPU */
  var CPU = { detail: [0.3, 0.3, 0.3], list: [0.5, 1.5, 1.0] };
  var DB_CORES = 7, DB_DETAIL = 0.3, DB_LIST = 74, LIST_SIGMA = 0.3, LIST_PAR = 3, VU_INIT = 0.5, CLOSED_VUS = 50;

  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rates() { return LAB.rates.split(" ").map(Number); }
  function stages() { return LAB.stages.split(" ").map(function (s) { var p = s.split("/"); return { f: +p[0], secs: +p[1] }; }); }

  /* ------------------------------------------------------------------ state */

  function create(o) {
    o = o || {};
    return { t: 0, rand: rngOf(o.seed || 7), pool: o.pool || LAB.pool, active: 0, pending: [], threads: 0, accept: [], cpuRun: [], dbRun: [],
      done: [], perSec: [], sec: null, vus: 0, vuFree: 0, vuPending: false, vuInit: 0, dropped: 0, nextArr: Infinity, ids: 0, timeout: 60,
      rows: [], log: [] };
  }
  function expo(st, m) { return -Math.log(1 - st.rand()) * m; }
  function logn(st, m, s) {
    var u = 1 - st.rand(), v = st.rand();
    return m * Math.exp(s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) - s * s / 2);
  }
  function newReq(st) {
    var list = st.rand() < LAB.listShare, c = list ? CPU.list : CPU.detail;
    return { t0: st.t, list: list, cpu: [expo(st, c[0]) / 1000, expo(st, c[1]) / 1000, expo(st, c[2]) / 1000],
      db: (list ? logn(st, DB_LIST, LIST_SIGMA) : expo(st, DB_DETAIL)) / 1000, par: list ? LIST_PAR : 1, phase: "", work: 0 };
  }
  function begin(st, q) { st.threads++; q.phase = "pre"; q.work = q.cpu[0]; q.par = 1; st.cpuRun.push(q); }
  function grant(st, q) { st.active++; q.phase = "db"; q.work = q.db; q.par = q.list ? LIST_PAR : 1; st.dbRun.push(q); }
  function next(st, q) {
    if (q.phase === "pre") { if (st.active < st.pool) grant(st, q); else { q.phase = "wait"; st.pending.push(q); } }
    else if (q.phase === "db") { q.phase = "tx"; q.work = q.cpu[1]; q.par = 1; st.cpuRun.push(q); }
    else if (q.phase === "tx") {
      st.active--;
      while (st.pending.length && st.active < st.pool) grant(st, st.pending.shift());
      q.phase = "post"; q.work = q.cpu[2]; st.cpuRun.push(q);
    } else if (q.phase === "post") {
      st.threads--; q.t1 = st.t; q.phase = "end"; finish(st, q);
      if (st.accept.length) begin(st, st.accept.shift());
    }
  }
  function finish(st, q) {
    var lat = q.t1 - q.t0;
    q.failed = lat > st.timeout;
    st.done.push(q);
    if (st.sec) { st.sec.n++; st.sec.lat.push(lat); }
    if (q.vu && !q.gone) st.vuFree++;
  }
  /* processor sharing: `cores` shared by the jobs, each one using at most `par` cores */
  function speed(run, cores) { var d = 0; run.forEach(function (q) { d += q.par; }); return d ? Math.min(1, cores / d) : 0; }
  function soonest(run, f) { var m = Infinity; run.forEach(function (q) { var x = q.work / (q.par * f); if (x < m) m = x; }); return m; }
  /* only the first n jobs were there when dt was chosen: jobs that join during this step wait for the next */
  function progress(st, run, f, dt, n) {
    var used = 0, fin = [];
    run.slice(0, n).forEach(function (q) { var r = q.par * f * dt; q.work -= r; used += r; if (q.work <= 1e-12) fin.push(q); });
    if (fin.length) {
      for (var j = n - 1; j >= 0; j--) if (run[j].work <= 1e-12) run.splice(j, 1);
      fin.forEach(function (q) { next(st, q); });
    }
    return used;
  }
  function inject(st, q) { q.vu = true; if (st.threads < LAB.threads) begin(st, q); else st.accept.push(q); }
  /* a VU whose request passed k6's timeout is free again (the server keeps working on the request) */
  function expire(st) {
    if (st.timeout >= 60) return;
    var lim = st.t - st.timeout;
    st.inflight = (st.inflight || []).filter(function (q) {
      if (q.phase === "end") return false;
      if (q.t0 < lim) { q.gone = true; st.vuFree++; st.timeouts = (st.timeouts || 0) + 1; return false; }
      return true;
    });
  }
  function newSec(st) { return { n: 0, arr: 0, drop: 0, lat: [], cpu: 0, db: 0 }; }

  /* run `secs` of model time with k6's load: {rate} or {rateFn} (open model, up to maxVUs), {vus} (closed) */
  function advance(st, secs, load) {
    var end = st.t + secs;
    if (!st.sec) st.sec = newSec(st);
    while (st.t < end - 1e-9) {
      if (load.vus) {
        while (st.vuFree > 0) { st.vuFree--; st.sec.arr++; var c = newReq(st); inject(st, c); track(st, c); }
      } else {
        var rate = load.rateFn ? load.rateFn(st.t) : load.rate;
        if (rate > 0 && (st.nextArr === Infinity || st.nextArr < st.t - 1)) st.nextArr = st.t;
        if (rate <= 0) st.nextArr = Infinity;
        while (st.nextArr <= st.t + 1e-12) {
          st.sec.arr++;
          if (st.vuFree > 0) { st.vuFree--; var q = newReq(st); inject(st, q); track(st, q); }
          else { st.dropped++; st.sec.drop++; if (st.vus < load.maxVUs && !st.vuPending) { st.vuPending = true; st.vuInit = st.t + VU_INIT; } }
          st.nextArr += 1 / rate;
        }
        if (st.vuPending && st.vuInit <= st.t + 1e-12) { st.vuPending = false; st.vus++; st.vuFree++; continue; }
      }
      var fc = speed(st.cpuRun, LAB.cpus), fd = speed(st.dbRun, DB_CORES);
      var sec = Math.floor(st.t + 1e-9) + 1;
      var dt = Math.min(Math.min(end, sec, load.vus ? Infinity : st.nextArr, st.vuPending ? st.vuInit : Infinity) - st.t, soonest(st.cpuRun, fc), soonest(st.dbRun, fd));
      if (!(dt > 0)) dt = 0;
      var nc = st.cpuRun.length, nd = st.dbRun.length;
      st.sec.cpu += progress(st, st.cpuRun, fc, dt, nc);
      st.sec.db += progress(st, st.dbRun, fd, dt, nd);
      st.t += dt;
      if (st.t >= sec - 1e-9) { st.t = Math.max(st.t, sec); tick(st, sec); }
    }
  }
  function track(st, q) { if (st.timeout < 60) (st.inflight = st.inflight || []).push(q); }
  function tick(st, sec) {
    expire(st);
    var s = st.sec, lat = s.lat.sort(function (a, b) { return a - b; });
    st.perSec.push({ t: sec, n: s.n, arr: s.arr, drop: s.drop, p99: pct(lat, 0.99), threads: Math.min(LAB.threads, st.threads + 1),
      active: st.active, pending: st.pending.length, accept: st.accept.length, cpu: s.cpu, db: s.db / DB_CORES, vus: st.vus });
    st.sec = newSec(st);
  }
  function pct(a, q) { return a.length ? a[Math.min(a.length - 1, Math.ceil(q * a.length) - 1)] : 0; }

  /* ------------------------------------------------------------------ k6 runs */

  /* the VUs of a k6 run that ended no longer wait for their requests (the server still finishes them) */
  function release(st) {
    [st.cpuRun, st.dbRun, st.pending, st.accept].forEach(function (a) { a.forEach(function (q) { q.gone = true; }); });
    st.vus = 0; st.vuFree = 0; st.vuPending = false;
  }
  function stats(reqs, secs) {
    var ok = reqs.filter(function (q) { return !q.failed; });
    var lat = ok.map(function (q) { return (q.t1 - q.t0) * 1000; }).sort(function (a, b) { return a - b; });
    var by = function (list) { return ok.filter(function (q) { return q.list === list; }).map(function (q) { return (q.t1 - q.t0) * 1000; }).sort(function (a, b) { return a - b; }); };
    var avg = lat.reduce(function (s, x) { return s + x; }, 0) / Math.max(1, lat.length);
    return { n: reqs.length, thr: ok.length / secs, avg: avg, p50: pct(lat, 0.5), p95: pct(lat, 0.95), p99: pct(lat, 0.99),
      p99d: pct(by(false), 0.99), p99l: pct(by(true), 0.99), failed: reqs.length - ok.length };
  }
  /* k6 run -e RATE=<rate> -e DURATION=<secs>s load/load.js: one row of summarize.py */
  function loadRun(st, rate, secs, record) {
    var pre = Math.max(LAB.preMin, rate), max = Math.max(LAB.maxMin, rate * LAB.maxMult);
    release(st);
    st.vus = pre; st.vuFree = pre;
    var from = st.done.length, t0 = st.t, d0 = st.dropped;
    advance(st, secs, { rate: rate, maxVUs: max });
    var reqs = st.done.slice(from).filter(function (q) { return q.t0 >= t0; });
    var r = stats(reqs, secs);
    r.rate = rate; r.dropped = st.dropped - d0; r.vus = st.vus; r.secs = secs; r.from = t0;
    if (record) st.rows.push(r);
    st.view = last(st);      /* what the gauges showed when k6 stopped (the UI keeps it through the pause) */
    return r;
  }
  /* k6 exits; the server keeps draining what is still queued */
  function idle(st, secs) {
    release(st);
    advance(st, secs, { rate: 0 });
  }
  function fmt(x, d) { return x.toFixed(d === undefined ? 1 : d); }
  function row(r) {
    return "| " + r.rate + " | " + fmt(r.thr, 0) + " | " + fmt(r.p50) + " | " + fmt(r.p95) + " | " + fmt(r.p99) + " | " + fmt(r.p99d) + " | " + fmt(r.p99l) +
      " | " + fmt(r.failed / Math.max(1, r.n) * 100) + "% | " + r.dropped + " | " + r.vus + " |";
  }
  var HEAD = ["| offered | thr | p50 | p95 | p99 | p99 det | p99 list | err | dropped | max VUs |", "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"];
  function last(st) { return st.perSec[st.perSec.length - 1] || {}; }
  function gaugeLine(p) {
    var s = 10 * 3600 + 43 * 60 + p.t, hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    var tm = [hh, mm, ss].map(function (x) { return (x < 10 ? "0" : "") + x; }).join(":");
    function pad(v, n) { v = String(v); while (v.length < n) v = " " + v; return v; }
    return tm + "  " + pad(fmt(p.threads), 12) + "  " + pad(fmt(p.active), 9) + "  " + pad(fmt(p.pending), 10);
  }

  /* the steps of the page */
  function warm(st) {
    var r = loadRun(st, rates()[0], LAB.warmup, false);
    idle(st, LAB.pause);
    return { cmd: ">>> warm-up: " + LAB.warmup + " s at RATE=" + rates()[0] + " (not recorded)", out: [], tone: "info", r: r,
      note: ["A cold JVM would spoil the first point: sweep.sh warms it up first.", "Uma JVM fria estragaria o primeiro ponto: o sweep.sh a aquece antes."] };
  }
  function step(st, rate) {
    var r = loadRun(st, rate, LAB.duration, true), g = last(st);
    var run = st.perSec.slice(-LAB.duration), cpu = 0, db = 0;
    run.forEach(function (p) { cpu += p.cpu / run.length; db += p.db / run.length; });
    r.cpu = cpu; r.db = db;
    var out = [row(r), "watch-metrics: " + gaugeLine(g), "docker stats: catalog CPU " + Math.round(cpu * 100) + "% · db CPU " + Math.round(db * DB_CORES * 100) + "%"];
    idle(st, LAB.pause);
    var knee = r.p99 > 300 || r.dropped > 0;
    return { cmd: ">>> RATE=" + rate + " req/s for 1m", out: out, r: r, g: g, tone: r.dropped ? "bad" : knee ? "warn" : "ok",
      note: [rate + " req/s: throughput " + fmt(r.thr, 0) + ", p99 " + fmt(r.p99, 0) + " ms, " + r.dropped + " dropped; at the end " + g.threads + " busy threads, " + g.active + " connections active, " + g.pending + " waiting for one.",
        rate + " req/s: vazão " + fmt(r.thr, 0) + ", p99 " + fmt(r.p99, 0) + " ms, " + r.dropped + " descartadas; no fim " + g.threads + " threads ocupadas, " + g.active + " conexões ativas, " + g.pending + " esperando uma."] };
  }
  function setPool(st, n) {
    st.pool = n;
    st.rows = []; st.view = null;
    return { cmd: "$ DB_POOL_SIZE=" + n + " docker compose up -d catalog", out: ["Container boxoffice-catalog-1  Recreated"], tone: "info", recreate: true,
      note: ["catalog restarts with a pool of " + n + " connections; nothing else changes.", "O catalog reinicia com um pool de " + n + " conexões; nada mais muda."] };
  }
  /* stress.js: one stage of the staircase per call (ramping-arrival-rate: linear ramps between targets) */
  function stress(st, i) {
    var sg = stages();
    if (i === 0) { release(st); st.timeout = LAB.stressTimeout; st.vus = 50; st.vuFree = 50; st.stressFrom = st.t; st.stressRate = 10; st.stressMax = 0; }
    if (i > 0 && sg[i].f < sg[i - 1].f) st.dropAt = st.t;
    var from = st.stressRate, to = sg[i].f * LAB.peak, t0 = st.t, secs = sg[i].secs, i0 = st.done.length, d0 = st.dropped;
    advance(st, secs, { rateFn: function (t) { return from + (to - from) * Math.min(1, (t - t0) / secs); }, maxVUs: LAB.stressVUs });
    st.view = null;
    st.stressRate = to;
    var reqs = st.done.slice(i0), r = stats(reqs, secs), p = st.perSec.slice(-secs);
    var worst = p.reduce(function (m, x) { return Math.max(m, x.p99); }, 0);
    st.stressMax = Math.max(st.stressMax, st.vus);
    var rec = i === sg.length - 1 && st.dropAt !== undefined ? recovery(st, st.dropAt) : null;
    return { cmd: "# stress.js stage " + (i + 1) + "/" + sg.length + ": " + Math.round(from) + " → " + Math.round(to) + " req/s in " + secs + " s",
      out: ["served " + fmt(r.thr, 0) + " req/s · worst p99 of a second " + fmt(worst * 1000, 0) + " ms · dropped " + (st.dropped - d0) + " · timed out " + (st.timeouts || 0) + " · VUs " + st.vus],
      r: r, rec: rec, tone: st.dropped - d0 ? "bad" : worst > 2 ? "warn" : "ok",
      note: rec !== null
        ? ["Back at " + Math.round(to) + " req/s: the p99 of each second was under 300 ms again " + rec + " s after the drop began — the queues drained by themselves.",
           "De volta a " + Math.round(to) + " req/s: o p99 de cada segundo voltou para baixo de 300 ms " + rec + " s depois do início da queda — as filas esvaziaram sozinhas."]
        : [Math.round(to) + " req/s: " + fmt(r.thr, 0) + " served per second, " + (st.dropped - d0) + " dropped, " + st.vus + " VUs.",
           Math.round(to) + " req/s: " + fmt(r.thr, 0) + " atendidas por segundo, " + (st.dropped - d0) + " descartadas, " + st.vus + " VUs."] };
  }
  /* seconds after the drop until a second's p99 is back under 300 ms */
  function recovery(st, from) {
    var drop = st.perSec.filter(function (p) { return p.t > from; });
    for (var i = 0; i < drop.length; i++) if (drop[i].n && drop[i].p99 < 0.3) return drop[i].t - Math.round(from);
    return drop.length;
  }
  /* section 1: the same service, a closed model (CLOSED_VUS VUs, no think time) and the open model at 500 req/s */
  function closed(st, secs) {
    release(st);
    st.vus = CLOSED_VUS; st.vuFree = CLOSED_VUS;
    var from = st.done.length, t0 = st.t;
    advance(st, secs, { vus: CLOSED_VUS });
    st.view = last(st);
    var r = stats(st.done.slice(from).filter(function (q) { return q.t0 >= t0; }), secs);
    idle(st, LAB.pause);
    return { cmd: "$ k6 run --vus " + CLOSED_VUS + " --duration " + secs + "s load/closed.js   # closed model, no think time", r: r, tone: "ok",
      out: ["http_reqs: " + fmt(r.thr, 0) + "/s · p99 " + fmt(r.p99, 0) + " ms · failed 0 · dropped: (no such thing)"],
      note: ["Closed model: " + CLOSED_VUS + " VUs got " + fmt(r.thr, 0) + " req/s with p99 " + fmt(r.p99, 0) + " ms. Nothing looks wrong: when the service slowed down, k6 slowed down with it.",
        "Modelo fechado: " + CLOSED_VUS + " VUs obtiveram " + fmt(r.thr, 0) + " req/s com p99 " + fmt(r.p99, 0) + " ms. Nada parece errado: quando o serviço ficou lento, o k6 ficou lento junto."] };
  }
  function open500(st) {
    var r = loadRun(st, 500, LAB.duration, false);
    idle(st, LAB.pause);
    return { cmd: "$ k6 run -e RATE=500 load/load.js   # open model", r: r, tone: r.dropped ? "bad" : "warn",
      out: ["http_reqs: " + fmt(r.thr, 0) + "/s · p99 " + fmt(r.p99, 0) + " ms · dropped_iterations " + r.dropped],
      note: ["Open model at 500 req/s: " + fmt(r.thr, 0) + " served, p99 " + fmt(r.p99, 0) + " ms and " + r.dropped + " dropped iterations. The same service, now visibly overloaded.",
        "Modelo aberto a 500 req/s: " + fmt(r.thr, 0) + " atendidas, p99 " + fmt(r.p99, 0) + " ms e " + r.dropped + " iterações descartadas. O mesmo serviço, agora visivelmente sobrecarregado."] };
  }

  var SCRIPTS = {
    closed: [
      { ops: [["closed", LAB.duration]], en: "A closed model, as in lab 0: " + CLOSED_VUS + " VUs that each wait for their answer before sending again.", pt: "Um modelo fechado, como no lab 0: " + CLOSED_VUS + " VUs que esperam a resposta antes de mandar de novo." },
      { ops: [["open500"]], en: "load.js at 500 req/s: fans who do not wait for each other.", pt: "load.js a 500 req/s: fãs que não esperam uns pelos outros." }
    ],
    sweep: [{ ops: [["warm"]], en: "sweep.sh starts with a warm-up.", pt: "O sweep.sh começa com um aquecimento." }].concat(rates().map(function (r) {
      return { ops: [["step", r]], en: "RATE=" + r + ": one minute, then 10 s of pause.", pt: "RATE=" + r + ": um minuto, depois 10 s de pausa." };
    })),
    pool30: [{ ops: [["pool", LAB.bigPool], ["warm"]], en: "Step 6: a bigger pool, the same sweep.", pt: "Passo 6: um pool maior, a mesma varredura." }].concat(rates().map(function (r) {
      return { ops: [["step", r]], en: "pool " + LAB.bigPool + ", RATE=" + r + ".", pt: "pool " + LAB.bigPool + ", RATE=" + r + "." };
    })),
    stress: stages().map(function (s, i) {
      return { ops: [["stress", i]], en: "stress.js, stage " + (i + 1) + ".", pt: "stress.js, estágio " + (i + 1) + "." };
    })
  };
  var OPS = { warm: warm, step: step, pool: setPool, stress: stress, closed: closed, open500: open500 };
  function run(st, op) { return OPS[op[0]].apply(null, [st].concat(op.slice(1))); }
  function play(name, n, o) {
    var st = create(o), out = [];
    SCRIPTS[name].slice(0, n === undefined ? Infinity : n).forEach(function (s) { s.ops.forEach(function (op) { out.push(run(st, op)); }); });
    return { st: st, out: out };
  }

  var API = { LAB: LAB, SCRIPTS: SCRIPTS, create: create, run: run, play: play, advance: advance, loadRun: loadRun, idle: idle, step: step, warm: warm,
    stress: stress, closed: closed, open500: open500, setPool: setPool, rates: rates, stages: stages, row: row, CLOSED_VUS: CLOSED_VUS };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, s = C.s, PT = C.PT;
  function L(pair) { return pair ? (PT ? pair[1] : pair[0]) : ""; }
  function num(x) { return PT ? String(x).replace(".", ",") : String(x); }

  C.style("catalog-sweep", [
    ".md-typeset .csim-log.csim-cs-term li { font-family: var(--md-code-font-family, monospace); font-size: .6rem; white-space: pre-wrap; }",
    ".md-typeset .csim-log.csim-cs-term li b { font-weight: 600; }",
    ".md-typeset .csim .csim-cs-table { font-family: var(--md-code-font-family, monospace); font-size: .6rem; white-space: pre; overflow-x: auto; margin: .4rem 0; padding: .4rem .6rem; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-panel); }",
    ".md-typeset .csim-cs-charts { display: flex; flex-wrap: wrap; gap: .6rem; }",
    ".md-typeset .csim-cs-charts > * { flex: 1 1 12rem; min-width: 0; max-width: 26rem; }"
  ].join("\n"));

  C.register("catalog-sweep", function (root) {
    var o = C.opts(root, { script: "sweep" });
    var script = SCRIPTS[o.script] ? o.script : "free";
    var st, freeRate = 300, freePool = LAB.pool, offered = 0;

    var svg = s("svg", { viewBox: "0 0 620 200", role: "img", "aria-label": t("k6, the catalog's threads and pool, PostgreSQL", "k6, as threads e o pool do catalog, PostgreSQL") });
    var note = el("p", { class: "csim-note" });
    var term = C.log(6); term.className += " csim-cs-term";
    var table = el("div", { class: "csim-cs-table" });
    var tiles = C.stats([
      { key: "offered", label: t("offered (req/s)", "oferecido (req/s)") },
      { key: "thr", label: t("served in the last second", "atendidas no último segundo") },
      { key: "p99", label: t("p99 of the last second", "p99 do último segundo") },
      { key: "drop", label: t("dropped (k6)", "descartadas (k6)"), title: "dropped_iterations" },
      { key: "busy", label: "busy_threads" },
      { key: "active", label: "db_active" },
      { key: "pending", label: "db_pending" }
    ]);
    var charts = el("div", { class: "csim-cs-charts" }), chA, chB, chC;
    function makeCharts() {
      C.clear(charts);
      chA = C.chart({ title: t("Requests per second: offered and served", "Requisições por segundo: oferecidas e atendidas"), len: 120,
        series: [{ label: t("offered", "oferecidas"), cls: "tone-mute" }, { label: t("served", "atendidas"), cls: "tone-ok" }, { label: "dropped", cls: "tone-bad" }] });
      chB = C.chart({ title: t("p99 of each second (ms)", "p99 de cada segundo (ms)"), len: 120, series: [{ label: "p99", cls: "tone-bad" }] });
      chC = C.chart({ title: t("Inside the catalog (watch-metrics.sh)", "Dentro do catalog (watch-metrics.sh)"), len: 120,
        series: [{ label: "busy_threads", cls: "tone-ink" }, { label: "db_active", cls: "tone-ok" }, { label: "db_pending", cls: "tone-warn" }] });
      [chA, chB, chC].forEach(function (c) { charts.appendChild(c); });
    }
    var plotted = 0;
    function plot() {
      for (; plotted < st.perSec.length; plotted++) {
        var p = st.perSec[plotted];
        chA.push([p.arr, p.n, p.drop]); chB.push([Math.round(p.p99 * 1000)]); chC.push([p.threads, p.active, p.pending]);
      }
    }
    function drawTable() {
      var lines = HEAD.concat(st.rows.map(row));
      table.textContent = (PT ? "uv run scripts/summarize.py  (pool " + st.pool + ")\n" : "uv run scripts/summarize.py  (pool " + st.pool + ")\n") + lines.join("\n");
      table.style.display = st.rows.length ? "" : "none";
    }
    function show(r) {
      term.add(el("span", {}, [el("b", { text: r.cmd }), r.out.length ? "\n" + r.out.join("\n") : ""]), r.tone === "info" ? "" : r.tone);
    }
    function exec(op) {
      var r = run(st, op);
      if (r.r && r.r.rate) offered = r.r.rate;
      if (op[0] === "stress") offered = st.stressRate;
      if (op[0] === "closed") offered = 0;
      if (r.recreate) { plotted = st.perSec.length; makeCharts(); }
      plot(); show(r); drawTable();
      return r;
    }

    var cScript = C.choice({ label: t("Lab step", "Passo do lab"), value: script, options: [
      { value: "closed", label: t("1 · closed vs open", "1 · fechado × aberto") },
      { value: "sweep", label: t("4 · sweep", "4 · varredura") },
      { value: "pool30", label: t("6 · pool of 30", "6 · pool de 30") },
      { value: "stress", label: t("7 · stress", "7 · estresse") },
      { value: "free", label: t("free", "livre") }
    ], onChange: function (v) { script = v; reset(); } });
    var cRate = C.choice({ label: "RATE", value: freeRate, options: rates().map(function (r) { return { value: r, label: String(r) }; }),
      onChange: function (v) { freeRate = v; } });
    var cPool = C.choice({ label: "DB_POOL_SIZE", value: freePool, options: [{ value: LAB.pool, label: String(LAB.pool) }, { value: LAB.bigPool, label: String(LAB.bigPool) }],
      onChange: function (v) { freePool = v; player.pause(); var r = exec(["pool", v]); say(r.note, r.tone); draw(); } });
    var bRun = C.button(t("k6: 1 min at RATE", "k6: 1 min a RATE"), function () {
      player.pause(); var r = exec(["step", freeRate]); say(r.note, r.tone); draw();
    }, { tone: "ok" });

    var player = C.player({ interval: 1800, onTick: function (k) { return tickStep(k); }, onPrev: function (k) { replay(k); }, onReset: function () { reset(); } });

    function say(pair, tone) { note.textContent = L(pair); note.className = "csim-note" + (tone && tone !== "info" ? " csim-" + tone : ""); }
    function tickStep(k) {
      var sc = SCRIPTS[script];
      if (!sc || k > sc.length) return false;
      var tone = "", lastNote = null;
      sc[k - 1].ops.forEach(function (op) { var r = exec(op); lastNote = r.note; if (r.tone === "bad" || (r.tone === "warn" && tone !== "bad")) tone = r.tone; });
      note.textContent = L([sc[k - 1].en, sc[k - 1].pt]) + " " + L(lastNote);
      note.className = "csim-note" + (tone ? " csim-" + tone : "");
      draw();
    }
    function replay(k) { fresh(); for (var i = 1; i <= k; i++) tickStep(i); if (!k) intro(); draw(); }
    function intro() {
      say(script === "free"
        ? ["Pick a rate and run load.js for a minute; switch the pool between 10 and 30. Each run adds a row of summarize.py's table.",
           "Escolha uma taxa e rode o load.js por um minuto; troque o pool entre 10 e 30. Cada execução acrescenta uma linha à tabela do summarize.py."]
        : ["The lab's stack: one catalog (1 CPU, 200 Tomcat threads, a pool of " + LAB.pool + " connections) and PostgreSQL. Press play or → to run the page's commands.",
           "A pilha do lab: um catalog (1 CPU, 200 threads do Tomcat, um pool de " + LAB.pool + " conexões) e o PostgreSQL. Aperte play ou → para rodar os comandos da página."], "");
    }
    function fresh() {
      st = create({ pool: script === "free" ? freePool : LAB.pool });
      term.clear(); plotted = 0; offered = 0; makeCharts(); drawTable();
    }
    function reset() {
      fresh();
      player.total(SCRIPTS[script] ? SCRIPTS[script].length : 0);
      player.style.display = SCRIPTS[script] ? "" : "none";
      freeRow.style.display = script === "free" ? "" : "none";
      intro(); draw();
    }

    function box(x, y, w, h, cls) { return s("rect", { x: x, y: y, width: w, height: h, rx: 7, class: "c-box " + cls }); }
    function text(x, y, str, cls, anchor) { return s("text", { x: x, y: y, class: cls || "c-small", "text-anchor": anchor || "start" }, str); }
    function bar(x, y, w, h, f, cls) {
      var g = s("g");
      g.appendChild(s("rect", { x: x, y: y, width: w, height: h, rx: 3, class: "c-fill-mute" }));
      g.appendChild(s("rect", { x: x, y: y, width: Math.max(0, Math.min(1, f)) * w, height: h, rx: 3, class: cls }));
      return g;
    }
    function draw() {
      C.clear(svg);
      var p = st.view || last(st), busy = p.threads || 1, act = p.active || 0, pend = p.pending || 0, cpu = p.cpu || 0, db = p.db || 0;
      /* k6 */
      svg.appendChild(box(6, 64, 100, 72, "on"));
      svg.appendChild(text(56, 86, "k6", "c-label", "middle"));
      svg.appendChild(text(56, 102, script === "closed" && !offered ? CLOSED_VUS + " VUs" : (offered ? Math.round(offered) + " req/s" : "—"), "c-small c-mono", "middle"));
      svg.appendChild(text(56, 118, (p.vus || 0) + " VUs", "c-small c-mono", "middle"));
      svg.appendChild(s("line", { x1: 106, y1: 100, x2: 132, y2: 100, class: "c-wire on" }));
      /* catalog: threads, CPU, pool */
      svg.appendChild(box(132, 10, 300, 180, pend ? "warn" : "hot"));
      svg.appendChild(text(142, 28, t("catalog · 1 CPU", "catalog · 1 CPU"), "c-label"));
      svg.appendChild(text(142, 50, "tomcat.threads.busy " + busy + " / " + LAB.threads, "c-small c-mono"));
      svg.appendChild(bar(142, 56, 280, 9, busy / LAB.threads, busy >= LAB.threads ? "c-fill-bad" : "c-fill-ink"));
      svg.appendChild(text(142, 82, "CPU " + Math.round(cpu * 100) + "%", "c-small c-mono"));
      svg.appendChild(bar(142, 88, 280, 9, cpu, cpu > 0.9 ? "c-fill-bad" : "c-fill-accent"));
      svg.appendChild(text(142, 116, "Hikari pool · " + act + " active / " + st.pool + " · " + pend + " pending", "c-small c-mono" + (pend ? " c-warn" : "")));
      var n = st.pool, w = Math.min(26, (280 - (n - 1) * 3) / n);
      for (var i = 0; i < n; i++) svg.appendChild(s("rect", { x: 142 + i * (w + 3), y: 124, width: w, height: 18, rx: 3, class: i < act ? "c-fill-ok" : "c-fill-mute" }));
      var qn = Math.min(pend, 60);
      for (var j = 0; j < qn; j++) svg.appendChild(s("circle", { cx: 146 + (j % 30) * 9.3, cy: 156 + Math.floor(j / 30) * 9, r: 3, class: "c-dot bad" }));
      if (pend > 60) svg.appendChild(text(422, 182, "+" + (pend - 60), "c-small c-mono c-bad", "end"));
      if (!pend) svg.appendChild(text(142, 162, t("no request waits for a connection", "nenhuma requisição espera conexão"), "c-small"));
      svg.appendChild(s("line", { x1: 432, y1: 133, x2: 470, y2: 133, class: "c-wire" + (act ? " on" : "") }));
      /* PostgreSQL */
      svg.appendChild(box(470, 64, 144, 100, db > 0.9 ? "bad" : "on"));
      svg.appendChild(text(480, 84, "PostgreSQL", "c-label"));
      svg.appendChild(text(480, 104, "CPU " + Math.round(db * DB_CORES * 100) + "% (" + DB_CORES + t(" cores)", " núcleos)"), "c-small c-mono"));
      svg.appendChild(bar(480, 110, 124, 9, db, db > 0.9 ? "c-fill-bad" : "c-fill-accent"));
      svg.appendChild(text(480, 140, act + t(" queries running", " consultas rodando"), "c-small"));
      svg.appendChild(text(480, 154, "t = " + Math.round(p.t || st.t) + " s", "c-small c-mono"));

      var rs = st.rows.length ? st.rows[st.rows.length - 1] : null;
      tiles.set("offered", offered ? String(Math.round(offered)) : "–", "");
      tiles.set("thr", p.t ? String(p.n) : "–", "");
      tiles.set("p99", p.t ? num(Math.round(p.p99 * 1000)) + " ms" : "–", !p.t ? "" : p.p99 > 1 ? "bad" : p.p99 > 0.3 ? "warn" : "ok");
      var dr = rs ? rs.dropped : st.dropped;
      tiles.set("drop", String(dr), dr ? "bad" : "ok");
      tiles.set("busy", String(busy), busy >= LAB.threads ? "bad" : "");
      tiles.set("active", String(act), act >= st.pool ? "warn" : "");
      tiles.set("pending", String(pend), pend ? "bad" : "ok");
    }

    var freeRow = el("div", { class: "csim-row" }, [cRate, cPool, bRun]);
    C.add(root, [
      el("p", { class: "csim-title", text: t("The lab's catalog under k6, without Docker: the sweep, the knee, the pool and the recovery",
        "O catalog do lab sob o k6, sem Docker: a varredura, o joelho, o pool e a recuperação") }),
      el("p", { class: "csim-sub", text: t("A model of the lab's stack, calibrated on the page's example run. Each step runs the page's k6 command and prints what summarize.py and watch-metrics.sh would print.",
        "Um modelo da pilha do lab, calibrado na execução de exemplo da página. Cada passo roda o comando k6 da página e imprime o que o summarize.py e o watch-metrics.sh imprimiriam.") }),
      el("div", { class: "csim-row" }, [cScript]),
      el("div", { class: "csim-stage" }, svg),
      freeRow,
      note,
      player,
      tiles,
      table,
      charts,
      term
    ]);
    reset();
    return {};
  });
})();
