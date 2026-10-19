/*
 * System Design Playground: simulation engine (no DOM).
 *
 * A design is a directed acyclic graph of component instances (nodes) and
 * calls (edges). Time advances in ticks of DT = 0.1 s of simulated time.
 * Each tick has two parts:
 *
 *   1. A FLUID MODEL (rates, not individual requests). In topological order,
 *      every node receives an offered rate λ (req/s) from its callers,
 *      admits what its capacity, threads (Little's Law) and queue allow,
 *      and forwards the admitted flow to its targets (splits, ratios,
 *      cache misses, retries, broker backlogs). Then, in reverse order,
 *      every node computes its mean latency W and success probability s
 *      from those of its targets (timeouts, retries, circuit breakers,
 *      fallbacks). Throughput, errors, utilization, queues, backlogs and
 *      cost come from here.
 *
 *   2. SAMPLED TRACES. K synthetic requests walk the graph using the state
 *      of the fluid model (queue waits, lognormal service times, coin flips
 *      for hits, errors, timeouts and retries). Their latencies feed the
 *      percentile histograms (p50/p95/p99/p999) and the Trace waterfall.
 *
 * Randomness comes from seeded streams (rng.js): same seed + same design +
 * same profile ⇒ the same run.
 *
 * Works in the browser (window.SDP.engine) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rng.js"), require("./catalog.js"));
  else { root.SDP = root.SDP || {}; root.SDP.engine = factory(root.SDP.rng, root.SDP.catalog); }
})(typeof self !== "undefined" ? self : this, function (RNG, CAT) {
  "use strict";

  var DT = 0.1;                 // seconds of simulated time per tick
  var HANG_MS = 10000;          // a call to a dead host hangs until this (or the edge timeout)
  var CROSS_REGION_MS = 70;     // extra latency of a call between regions
  var MESH_HOP_MS = 1;          // sidecar overhead per hop
  var DETECT_S = 30, DETECT_HC_S = 3;   // failure detection without / with a Health Check
  var MONTH_S = 2592000;        // seconds in a 30-day month (cost extrapolation)
  var ATTACK_SHARE = 0.02;      // share of AI requests that are prompt-injection attempts
  var EDGE_SIGMA = 0.6;         // lognormal shape assumed for "latency of a call" in the fluid model
  var WINDOW_TICKS = 50;        // sliding window for live percentiles (5 s)
  var LINE = 128;               // ring buffer (ticks) for delayed retries

  /* ─── Latency histogram: log buckets, ~4% resolution (HDR-like) ─── */
  var HB = 0.05, HF = Math.log(1.04), NB = 420;
  function bucket(ms) { return ms <= HB ? 0 : Math.min(NB - 1, Math.floor(Math.log(ms / HB) / HF)); }
  function bucketMs(i) { return HB * Math.exp((i + 0.5) * HF); }
  function quantile(hist, total, q) {
    if (!(total > 0)) return NaN;
    var target = q * total, acc = 0;
    for (var i = 0; i < NB; i++) { acc += hist[i]; if (acc >= target) return bucketMs(i); }
    return bucketMs(NB - 1);
  }

  /* ─── Load profiles (k6 vocabulary). rate(t, T, s) → req/s ─── */
  var PROFILES = {
    smoke: { dur: 30, win: [5, 30], rate: function (t, T) { return Math.min(T, 5); } },
    load: { dur: 180, win: [20, 170], rate: function (t, T) { return t < 20 ? T * t / 20 : t < 170 ? T : T * Math.max(0, (180 - t) / 10); } },
    stress: { dur: 300, win: [0, 300], rate: function (t, T) { return T * 0.2 * (1 + Math.floor(t / 20)); } },
    spike: { dur: 180, win: [10, 180], rate: function (t, T, s) { return t >= 60 && t < 90 ? T * (s.spikeFactor || 5) : T; } },
    soak: { dur: 900, win: [60, 900], rate: function (t, T) { return t < 30 ? T * t / 30 : T; } },
    breakpoint: { dur: 300, win: [0, 300], rate: function (t, T) { return T * 4 * t / 300; } },
    chaos: { dur: 300, win: [20, 300], rate: function (t, T) { return t < 20 ? T * t / 20 : T; } }
  };
  var CHAOS = { off: 0, low: 1, medium: 3, high: 8 };

  /* ─── Random event types. rate = events per hour at chaos "low" ─── */
  function isCompute(n) { return n.def.cat === "compute" || n.def.cat === "ai" || n.type === "apigw"; }
  function isService(n) { return n.role !== "source" && n.role !== "side" && n.role !== "frame"; }
  var EVENTS = {
    crash: { rate: 0.3, scope: "node", ok: function (n) { return isService(n) && !n.def.d.ext && n.type !== "dns" && n.type !== "cdn"; } },
    slow: { rate: 0.25, scope: "node", ok: function (n) { return isService(n) && n.role !== "split"; } },
    viral: { rate: 0.6, scope: "global" },
    hotkey: { rate: 0.4, scope: "global", ok: function (sim) { return sim.hasPartitioned; } },
    flush: { rate: 0.3, scope: "node", ok: function (n) { return n.role === "cache"; } },
    az: { rate: 0.15, scope: "global" },
    region: { rate: 0.05, scope: "global" },
    partition: { rate: 0.3, scope: "global", ok: function (sim) { return sim.flowEdges.length > 0; } },
    extOutage: { rate: 0.5, scope: "node", ok: function (n) { return !!n.def.d.ext; } },
    badDeploy: { rate: 0.3, scope: "global", ok: function (sim) { return sim.nodes.some(isCompute); } },
    noisy: { rate: 0.25, scope: "node", ok: function (n) { return isService(n) && !n.def.d.ext && n.role !== "split"; } },
    gcStorm: { rate: 0.2, scope: "node", ok: function (n) { return n.type === "app"; } }
  };
  var EVENT_ORDER = ["crash", "slow", "viral", "hotkey", "flush", "az", "region", "partition", "extOutage", "badDeploy", "noisy", "gcStorm"];

  /* ─── Small math helpers ─── */
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  /* number or default; Infinity is a valid value ("unlimited") */
  function num(x, d) { if (x === null || x === undefined || x === "") return d; x = +x; return isNaN(x) ? d : x; }
  function fin(x) { return isFinite(x) ? x : 0; }
  function lnMean(median, s) { s = clamp(s, 0, 3); return median * Math.exp(s * s / 2); }
  function sigma(p, d) { return clamp(num(p.sigma, d), 0, 3); }
  /* replica counts drive loops (autoscaling) and must stay bounded */
  var MAX_REPLICAS = 10000;
  function reps(x, d) { return clamp(Math.round(num(x, d)), 1, MAX_REPLICAS); }

  /* Zipf: share of requests that go to the hottest of N keys, H(N,s)⁻¹. */
  function zipfTop(s, N) {
    N = N || 1e6;
    var H;
    if (s <= 0) return 1 / N;
    if (Math.abs(s - 1) < 1e-6) H = Math.log(N) + 0.5772;
    else H = 1 + (Math.pow(N, 1 - s) - 1) / (1 - s) + 0.5 * (1 + Math.pow(N, -s)) - 0.5;
    return clamp(1 / H, 1 / N, 1);
  }

  /* Sakasegawa's approximation of the queueing delay of an M/M/c queue:
       Wq ≈ S · ρ^(√(2(c+1)) − 1) / (c · (1 − ρ))
     S = mean service time, c = number of parallel servers, ρ < 1. */
  function sakasegawa(S, rho, c) {
    if (!(rho > 0)) return 0;
    rho = Math.min(rho, 0.98);
    c = Math.max(1, c);
    return S * Math.pow(rho, Math.sqrt(2 * (c + 1)) - 1) / (c * (1 - rho));
  }

  /* For a lognormal call latency X with mean m (shape EDGE_SIGMA) and a
     timeout T: P(X > T) and E[min(X, T)]. */
  function timeoutStats(m, T) {
    if (!(T > 0) || !(m > 0)) return { p: 0, mean: m };
    var s = EDGE_SIGMA, mu = Math.log(m) - s * s / 2, z = (Math.log(T) - mu) / s;
    var p = 1 - RNG.phi(z);
    var mean = m * RNG.phi(z - s) + T * p;
    return { p: p, mean: Math.min(mean, T) };
  }

  /* ─── Design helpers ─── */
  function emptyDesign() { return { version: 1, nodes: [], edges: [], frames: [] }; }

  /* Lookups by user-supplied keys must not see Object.prototype
     ("__proto__", "constructor", "toString", ...). */
  function own(obj, k) { return obj != null && typeof k === "string" && Object.prototype.hasOwnProperty.call(obj, k); }
  function defOf(type) { return own(CAT.BY_ID, type) ? CAT.BY_ID[type] : null; }
  var BAD_KEY = /^(__proto__|constructor|prototype)$/;

  /* Parameters of an imported design: keep primitive values only, coerce
     them to the type the catalog declares (numbers finite and ≥ 0, booleans,
     enum options); anything else is dropped and falls back to the default. */
  function cleanParams(raw, defs) {
    var out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(function (k) {
      if (BAD_KEY.test(k)) return;
      var v = raw[k], def = own(defs, k) ? defs[k] : null, t = def ? def.type : null;
      if (t === "num" || t === "int") {
        v = typeof v === "string" && v.trim() !== "" ? +v : v;
        if (typeof v === "number" && isFinite(v)) out[k] = Math.max(0, v);
      } else if (t === "bool") {
        if (typeof v === "boolean") out[k] = v;
        else if (v === "true" || v === "false") out[k] = v === "true";
      } else if (t === "enum") {
        if (def.options.indexOf(v) >= 0) out[k] = v;
      } else if (typeof v === "boolean" || (typeof v === "number" && isFinite(v))) out[k] = v;
      else if (typeof v === "string") out[k] = v.slice(0, 100);
    });
    return out;
  }
  function str(x, max) { return typeof x === "string" ? x.slice(0, max) : typeof x === "number" && isFinite(x) ? String(x) : ""; }

  /* Validate and sanitize a design (scenario, autosave, import, share link):
     never throws; drops unknown types, edges to missing nodes and self-loops;
     makes ids unique strings that are not Object.prototype keys. */
  function normalizeDesign(d) {
    d = d && typeof d === "object" ? d : {};
    var out = { version: 1, nodes: [], edges: [], frames: [] };
    var used = Object.create(null), map = Object.create(null);
    function freshId(raw, prefix) {
      var id = str(raw, 60);
      if (!id || BAD_KEY.test(id) || id in Object.prototype) id = id ? prefix + "_" + id : prefix;
      var base = id, i = 2;
      while (used[id]) id = base + "_" + i++;
      used[id] = 1;
      return id;
    }
    (Array.isArray(d.nodes) ? d.nodes : []).forEach(function (n) {
      if (!n || typeof n !== "object") return;
      var def = defOf(n.type), key = str(n.id, 60);
      if (!def || def.role === "frame" || (key && map[key])) return;
      var id = freshId(n.id, "n");
      if (key) map[key] = id;
      out.nodes.push({ id: id, type: n.type, x: fin(num(n.x, 0)), y: fin(num(n.y, 0)), label: str(n.label, 40), params: cleanParams(n.params, CAT.PARAMS) });
    });
    (Array.isArray(d.edges) ? d.edges : []).forEach(function (e) {
      if (!e || typeof e !== "object") return;
      var a = map[str(e.from, 60)], b = map[str(e.to, 60)];
      if (!a || !b || a === b) return;
      out.edges.push({ id: freshId(e.id || ("e" + a + "_" + b), "e"), from: a, to: b, params: cleanParams(e.params, CAT.EDGE_PARAMS) });
    });
    (Array.isArray(d.frames) ? d.frames : []).forEach(function (f) {
      if (!f || (f.type !== "vpc" && f.type !== "subnet")) return;
      out.frames.push({ id: freshId(f.id, "f"), type: f.type, x: fin(num(f.x, 0)), y: fin(num(f.y, 0)), w: clamp(fin(num(f.w, 300)), 80, 1e5), h: clamp(fin(num(f.h, 200)), 60, 1e5), name: str(f.name, 30), region: str(f.region, 30), zone: str(f.zone, 30) });
    });
    return out;
  }

  function roleOf(type) { var c = defOf(type); return c ? c.role : "call"; }
  function isSide(type) { return roleOf(type) === "side"; }

  /* Would adding from → to create a cycle in the request graph? */
  function wouldCycle(design, from, to) {
    if (from === to) return true;
    if (isSideById(design, from) || isSideById(design, to)) return false;
    var adj = {};
    design.edges.forEach(function (e) {
      if (isSideById(design, e.from) || isSideById(design, e.to)) return;
      (adj[e.from] = adj[e.from] || []).push(e.to);
    });
    var stack = [to], seen = {};
    while (stack.length) {
      var x = stack.pop();
      if (x === from) return true;
      if (seen[x]) continue;
      seen[x] = 1;
      (adj[x] || []).forEach(function (y) { stack.push(y); });
    }
    return false;
  }
  function isSideById(design, id) {
    for (var i = 0; i < design.nodes.length; i++) if (design.nodes[i].id === id) return isSide(design.nodes[i].type);
    return false;
  }

  /* Mermaid flowchart of a design (the "export Mermaid" button). */
  function toMermaid(design) {
    var lines = ["flowchart LR"], mid = Object.create(null), taken = Object.create(null);
    function safe(s) { return String(s).replace(/"/g, "'"); }
    /* Mermaid ids: letters, digits and _ only (and not the keyword "end") */
    design.nodes.forEach(function (n, i) {
      var m = String(n.id).replace(/[^A-Za-z0-9_]/g, "_");
      if (!m || m === "end" || taken[m]) m = "n" + i + "_" + m;
      taken[m] = 1; mid[n.id] = m;
    });
    design.nodes.forEach(function (n) {
      var c = defOf(n.type) || { label: n.type, cat: "" }, label = n.label || c.label;
      var shape = c.cat === "storage" ? ['[("', '")]'] : c.cat === "messaging" ? ['[/"', '"/]'] : c.cat === "client" ? ['(["', '"])'] : ['["', '"]'];
      lines.push("  " + mid[n.id] + shape[0] + safe(label) + shape[1]);
    });
    design.edges.forEach(function (e) {
      var to = design.nodes.filter(function (n) { return n.id === e.to; })[0];
      var from = design.nodes.filter(function (n) { return n.id === e.from; })[0];
      if (!to || !from) return;
      var dotted = isSide(to.type) || roleOf(to.type) === "msg" || isSide(from.type) || (e.params && e.params.async);
      lines.push("  " + mid[e.from] + (dotted ? " -.-> " : " --> ") + mid[e.to]);
    });
    return lines.join("\n");
  }

  /* ════════════════════════════════════════════════════════════════════ */

  function Sim(design, settings, opts) {
    opts = opts || {};
    this.scenario = opts.scenario || null;
    var s = settings || {};
    this.settings = {
      profile: own(PROFILES, s.profile) ? s.profile : "load",
      targetRps: clamp(fin(num(s.targetRps, 100)), 0, 1e8),
      readRatio: clamp(num(s.readRatio, 0.9), 0, 1),
      seed: Math.floor(fin(num(s.seed, 42))),
      chaos: own(CHAOS, s.chaos) ? s.chaos : "off",
      spikeFactor: clamp(fin(num(s.spikeFactor, 5)), 0, 1000),
      traces: clamp(Math.floor(fin(num(s.traces, 40))), 0, 2000),
      noise: s.noise === undefined ? 0.05 : num(s.noise, 0.05),
      sloMs: fin(num(s.sloMs, 0)) || this.goalSlo() || 500,
      duration: Math.max(0, fin(num(s.duration, 0)))
    };
    var prof = PROFILES[this.settings.profile];
    this.duration = this.settings.duration || (this.scenario && this.scenario.duration && this.settings.profile === (this.scenario.settings || {}).profile ? this.scenario.duration : prof.dur);
    this.window = (this.scenario && this.scenario.window && this.settings.profile === (this.scenario.settings || {}).profile) ? this.scenario.window : [prof.win[0], Math.min(prof.win[1], this.duration)];
    if (this.settings.profile === "chaos" && CHAOS[this.settings.chaos] < CHAOS.medium) this.settings.chaos = "medium";

    this.rng = RNG.create(this.settings.seed);
    this.R = {
      arrivals: this.rng.stream("arrivals"), noise: this.rng.stream("noise"),
      events: this.rng.stream("events"), traces: this.rng.stream("traces"), manual: this.rng.stream("manual")
    };
    this.t = 0; this.tick = 0; this.done = false;
    this.noiseX = 0;
    this.state = {};       // node runtime state by id (survives live design edits)
    this.estate = {};      // edge runtime state by id
    this.active = [];      // active events
    this.downs = [];       // replica-down records {node, k, t0, detectAt, until, cause}
    this.log = [];
    this.firedScripted = {};
    this.trafficF = 1; this.zipfBoost = 0;
    this.series = { t: [], offered: [], served: [], errors: [], errRate: [], p50: [], p99: [], cost: [], backlog: [], maxUtil: [], lag: [], repLag: [] };
    this.sec = { offered: 0, served: 0, cost: 0, n: 0 };
    this.winHist = new Float64Array(NB); this.winTotal = 0;
    this.tickHists = []; for (var i = 0; i < WINDOW_TICKS; i++) this.tickHists.push({ h: new Uint16Array(NB), n: 0, list: [] });
    this.runHist = new Float64Array(NB); this.runN = 0;
    this.acc = { offered: 0, served: 0, runOffered: 0, runServed: 0, costSum: 0, costN: 0, trOk: 0, trErr: 0, trDeg: 0, dups: 0, maxLag: 0, maxRepLag: 0, servedWinSum: 0, winTicks: 0 };
    this.trStats = {};
    this.slowTrace = null;
    this.breakpoint = null; this.knee = null; this.baseP99 = [];
    this.bad = 0;
    this.setDesign(design);
  }

  Sim.prototype.goalSlo = function () {
    var g = (this.scenario && this.scenario.goals) || [];
    for (var i = 0; i < g.length; i++) if (g[i].metric === "p99") return g[i].value;
    return 0;
  };

  /* ─── Topology (re)build: keeps the runtime state of nodes that stay ─── */
  Sim.prototype.setDesign = function (design) {
    var self = this;
    design = normalizeDesign(design);
    this.design = design;
    var nodes = [], byId = {};
    design.nodes.forEach(function (dn) {
      var def = defOf(dn.type);
      var p = CAT.params(dn);
      var n = {
        id: dn.id, type: dn.type, def: def, role: def.role, p: p, label: dn.label || def.label,
        x: dn.x, y: dn.y, out: [], inn: [], groups: [], attached: [], zone: "a", region: "default"
      };
      nodes.push(n); byId[n.id] = n;
      var st = self.state[n.id];
      if (!st) {
        st = self.state[n.id] = {
          q: 0, h: 1, holdPrev: lnMean(num(p.latencyMs, 1), num(p.sigma, 0.3)), muPrev: 0, ready: reps(p.replicas, 1),
          pending: [], paramReplicas: reps(p.replicas, 1), leakT0: 0, warm: num(p.provisioned, 0),
          repLag: 0, rhoAcc: 0, rhoN: 0, firstHot: null, maxRho: 0, backlog: 0, sPrev: [1, 1], schedLast: -1
        };
      }
      var want = reps(p.replicas, 1);
      if (want !== st.paramReplicas) { st.ready = want; st.pending = []; st.paramReplicas = want; }
      n.st = st;
    });

    /* zones and regions from frames (node centre inside the rectangle) */
    design.frames.forEach(function (f) {
      nodes.forEach(function (n) {
        if (n.x >= f.x && n.x <= f.x + f.w && n.y >= f.y && n.y <= f.y + f.h) {
          if (f.type === "vpc") { n.region = f.region || f.name || "region-1"; n.inVpc = true; }
          else n.zone = f.zone || f.name || "a";
        }
      });
    });
    this.zones = {}; this.regions = {};
    nodes.forEach(function (n) { if (isService(n)) { self.zones[n.region + "/" + n.zone] = 1; self.regions[n.region] = 1; } });

    /* edges: side-channel attachments vs request flow */
    var flowEdges = [], estates = {};
    design.edges.forEach(function (de) {
      var a = byId[de.from], b = byId[de.to];
      if (!a || !b) return;
      if (a.role === "side" || b.role === "side") {
        var side = a.role === "side" ? a : b, other = side === a ? b : a;
        side.attached.push(other);
        other.attached.push(side);
        return;
      }
      var e = { id: de.id, from: a, to: b, raw: de.params || {} };
      e.st = self.estate[e.id] || (self.estate[e.id] = { pFail: 0, cb: "closed", cbUntil: 0, cbErr: 0, cbVol: 0, line: new Float64Array(LINE), backlog: 0 });
      estates[e.id] = 1;
      flowEdges.push(e);
    });

    /* topological order (Kahn); edges closing a cycle are dropped */
    var indeg = {}, adj = {};
    nodes.forEach(function (n) { indeg[n.id] = 0; adj[n.id] = []; });
    flowEdges.forEach(function (e) { adj[e.from.id].push(e); indeg[e.to.id]++; });
    var order = [], queue = nodes.filter(function (n) { return indeg[n.id] === 0; });
    while (queue.length) {
      var n = queue.shift();
      order.push(n);
      adj[n.id].forEach(function (e) { if (--indeg[e.to.id] === 0) queue.push(e.to); });
    }
    if (order.length < nodes.length) {
      var placed = {};
      order.forEach(function (n) { placed[n.id] = 1; });
      nodes.forEach(function (n) { if (!placed[n.id]) order.push(n); });
      var pos = {};
      order.forEach(function (n, i) { pos[n.id] = i; });
      flowEdges = flowEdges.filter(function (e) { return pos[e.from.id] < pos[e.to.id]; });
    }
    var pos2 = {};
    order.forEach(function (n, i) { pos2[n.id] = i; });

    /* side-channel effects */
    function attachedTo(n, type) { return n.attached.some(function (s) { return s.type === type; }); }
    var meshes = nodes.filter(function (n) { return n.type === "mesh"; });
    var meshMetrics = meshes.some(function (m) { return attachedTo(m, "metrics"); });
    nodes.forEach(function (n) {
      n.mesh = n.role !== "side" && n.attached.filter(function (s) { return s.type === "mesh"; })[0] || null;
      n.observed = attachedTo(n, "metrics") || (!!n.mesh && meshMetrics) || n.role === "source";
      n.hc = attachedTo(n, "healthcheck");
    });
    this.hasLogs = nodes.some(function (n) { return n.type === "logs" && n.attached.length > 0; });
    this.hasTracing = nodes.some(function (n) { return n.type === "tracing" && n.attached.length > 0; });
    this.hasAlerting = nodes.some(function (n) { return n.type === "alerting" && attachedTo(n, "metrics"); });

    /* effective edge parameters (defaults ← mesh defaults ← edge's own) */
    flowEdges.forEach(function (e) {
      var p = CAT.merge(CAT.EDGE_DEFAULTS, {});
      if (e.from.mesh) {
        p.timeoutMs = num(e.from.mesh.p.meshTimeoutMs, 1000);
        p.retries = num(e.from.mesh.p.meshRetries, 2);
        p.backoff = "exp+jitter";
        p.circuitBreaker = true;
      }
      for (var k in e.raw) p[k] = e.raw[k];
      e.p = p;
      e.msg = e.to.role === "msg";
      e.async = e.msg || !!p.async;
      e.ratio = clamp(num(p.ratio, 1), 0, 1);
      e.mask = p.filter === "read" ? [1, 0, 1] : p.filter === "write" ? [0, 1, 0] : [1, 1, 1];
      e.retries = clamp(Math.round(num(p.retries, 0)), 0, 5);
      e.timeout = Math.max(0, num(p.timeoutMs, 0));
      /* clients, DNS and CDN outside any VPC are global: no cross-region penalty */
      e.hop = (e.from.inVpc && e.to.inVpc && e.from.region !== e.to.region ? CROSS_REGION_MS : 0) + (e.from.mesh ? MESH_HOP_MS : 0);
      e.k = (e.from.type === "orchestrator" && (e.to.type === "llmgw" || e.to.type === "toolreg")) ? clamp(Math.round(num(e.from.p.steps, 1)), 1, 100) : 1;
      e.from.out.push(e);
      e.to.inn.push(e);
    });
    /* order edges like the design (stable), then group them */
    nodes.forEach(function (n) {
      n.groups = [];
      if (n.role === "split") {
        if (n.out.length) n.groups.push({ split: true, edges: n.out.slice() });
      } else if (n.type === "apigw") {
        var byType = {};
        n.out.forEach(function (e) { (byType[e.to.type] = byType[e.to.type] || []).push(e); });
        Object.keys(byType).forEach(function (t) {
          var list = byType[t];
          if (list.length >= 2) n.groups.push({ split: true, edges: list });
          else n.groups.push({ split: false, edges: list });
        });
      } else {
        n.out.forEach(function (e) { n.groups.push({ split: false, edges: [e] }); });
      }
      n.groups.forEach(function (g) { g.shares = g.edges.map(function () { return g.split ? 1 / g.edges.length : 1; }); });
    });

    /* failure detection time: by whoever routes around the node */
    flowEdges.forEach(function (e) {
      var splitter = e.from.role === "split" || (e.from.type === "apigw" && e.from.groups.some(function (g) { return g.split && g.edges.indexOf(e) >= 0; }));
      e.detectS = splitter ? ((e.from.hc || e.to.hc) ? DETECT_HC_S : DETECT_S) + (e.from.type === "dns" ? num(e.from.p.ttlS, 60) : 0) : Infinity;
    });
    nodes.forEach(function (n) {
      n.detectS = Infinity;
      n.inn.forEach(function (e) { n.detectS = Math.min(n.detectS, e.detectS); });
    });

    /* AI guardrails: is every path to an LLM gateway behind a Safety Mesh? */
    var guarded = {};
    order.forEach(function (n) {
      var ins = n.inn;
      guarded[n.id] = n.type === "safety" || (ins.length > 0 && ins.every(function (e) { return guarded[e.from.id]; }));
    });
    nodes.forEach(function (n) {
      if (n.type !== "llmgw") return;
      var direct = n.out.some(function (e) { return e.to.type === "safety"; }) ||
        n.inn.some(function (e) { return e.from.out.some(function (x) { return x.to.type === "safety"; }); });
      n.guarded = guarded[n.id] || direct;
    });

    /* drop runtime state of removed nodes/edges */
    Object.keys(this.state).forEach(function (id) { if (!byId[id]) delete self.state[id]; });
    Object.keys(this.estate).forEach(function (id) { if (!estates[id]) delete self.estate[id]; });

    this.nodes = nodes; this.byId = byId; this.order = order; this.flowEdges = flowEdges;
    this.sources = nodes.filter(function (n) { return n.role === "source"; });
    this.clients = nodes.filter(function (n) { return n.type === "client" || n.type === "mobile"; });
    this.hasPartitioned = nodes.some(function (n) { return n.def.d.partitioned && n.role !== "msg"; });
    this.theory = this.theoreticalAvailability();
    nodes.forEach(function (n) { if (!n.st.muPrev) n.st.muPrev = self.nominalMu(n); });
  };

  Sim.prototype.nominalMu = function (n) {
    var p = n.p;
    if (n.type === "serverless") return num(p.concurrencyLimit, 1000) * 1000 / lnMean(num(p.latencyMs, 30), num(p.sigma, 0.5));
    return n.st.ready * num(p.capacity, 1000);
  };

  /* ─── Theoretical availability (series / parallel), for the report ─── */
  Sim.prototype.theoreticalAvailability = function () {
    var memo = {}, self = this;
    function nodeA(n) {
      var a = num(n.p.avail, 0.999);
      var r = n.type === "sql" ? 1 : n.st.ready;
      if (n.type === "sql" && n.p.standby) return 1 - (1 - a) * (1 - a);
      return r >= 2 && n.detectS < Infinity ? 1 - Math.pow(1 - a, r) : a;
    }
    function A(n) {
      if (memo[n.id] !== undefined) return memo[n.id];
      memo[n.id] = 1;
      var own = n.role === "source" ? 1 : nodeA(n);
      if (n.role === "msg") return (memo[n.id] = own);
      var total = own;
      n.groups.forEach(function (g) {
        if (g.split) {
          var fail = 1;
          g.edges.forEach(function (e) { fail *= 1 - edgeA(e); });
          total *= 1 - fail;
        } else {
          g.edges.forEach(function (e) { total *= 1 - e.ratio * (1 - edgeA(e)); });
        }
      });
      return (memo[n.id] = total);
    }
    function edgeA(e) {
      if (e.async && !e.msg) return 1;
      if (e.p.fallback) return 1;
      return A(e.to);
    }
    if (!this.clients.length) return null;
    var w = 0, sum = 0;
    this.clients.forEach(function (c) { var k = num(c.p.weight, 1); w += k; sum += k * A(c); });
    return w > 0 ? sum / w : null;
  };

  /* ─── Live settings (target, read %, chaos) ─── */
  Sim.prototype.setSettings = function (s) {
    if (s.targetRps !== undefined) this.settings.targetRps = clamp(fin(num(s.targetRps, this.settings.targetRps)), 0, 1e8);
    if (s.readRatio !== undefined) this.settings.readRatio = clamp(num(s.readRatio, 0.9), 0, 1);
    if (own(CHAOS, s.chaos)) this.settings.chaos = s.chaos;
    if (s.spikeFactor !== undefined) this.settings.spikeFactor = clamp(fin(num(s.spikeFactor, 5)), 0, 1000);
  };

  /* ════════════════ Events ════════════════ */

  Sim.prototype.logEvent = function (type, phase, target, info) {
    this.log.push({ t: Math.round(this.t * 10) / 10, type: type, phase: phase, target: target || null, info: info || {} });
    if (this.log.length > 500) this.log.shift();
  };

  Sim.prototype.nodeName = function (id) { var n = this.byId[id]; return n ? n.label : id; };

  /* Start an event. ev: {type, target?, durationS?, factor?, scripted?, label?} */
  Sim.prototype.fire = function (ev, R) {
    R = R || this.R.events;
    var self = this, t = this.t, n = ev.target ? this.byId[ev.target] : null;
    var type = ev.type, dur = ev.durationS, info = { scripted: !!ev.scripted, label: ev.label || null };
    var mttrF = this.hasAlerting ? 0.5 : 1;
    function down(node, k, until, cause) {
      if (node.type === "sql" && node.p.standby && cause !== "region") until = Math.min(until, t + 60);
      self.downs.push({ node: node.id, k: k, t0: t, detectAt: t + node.detectS, until: until, cause: cause });
    }
    switch (type) {
      case "crash":
        if (!n) return null;
        dur = (dur || R.uniform(20, 90)) * mttrF;
        down(n, num(ev.k, 1), t + dur, "crash");
        info.k = num(ev.k, 1);
        break;
      case "az":
      case "region": {
        var keys = type === "az" ? Object.keys(this.zones) : Object.keys(this.regions);
        var key = ev.target || R.pick(keys);
        if (!key) return null;
        dur = dur || (type === "az" ? R.uniform(60, 180) : R.uniform(120, 300));
        this.nodes.forEach(function (x) {
          if (!isService(x)) return;
          var hit = type === "az" ? (x.region + "/" + x.zone === key || (key.indexOf("/") < 0 && x.zone === key)) : x.region === key;
          if (!hit) return;
          var r = x.st.ready, k = type === "az" && x.p.multiAZ ? Math.ceil(r / 3) : r;
          if (x.type === "sql" || x.type === "cdn" || x.type === "dns") k = x.type === "sql" ? 1 : 0;
          if (x.type === "lb" && type === "az") k = 0;   // managed load balancers span AZs
          if (x.def.d.ext) k = 0;
          if (k > 0) down(x, k, t + dur, type);
        });
        ev = { type: type, target: key };
        break;
      }
      case "partition": {
        var e = ev.target ? this.flowEdges.filter(function (x) { return x.id === ev.target; })[0] : R.pick(this.flowEdges.filter(function (x) { return x.from.role !== "source"; }));
        if (!e) return null;
        ev = { type: type, target: e.id };
        dur = dur || R.uniform(10, 60);
        info.from = e.from.id; info.to = e.to.id;
        break;
      }
      case "viral":
        ev.factor = num(ev.factor, R.uniform(3, 10));
        dur = dur || R.uniform(30, 90);
        info.factor = ev.factor;
        break;
      case "hotkey":
        ev.factor = num(ev.factor, 0.6);
        dur = dur || R.uniform(30, 120);
        break;
      case "flush":
        if (!n) return null;
        n.st.h = 0;
        dur = dur || num(n.p.cacheWarmS, 60);
        break;
      case "slow":
        if (!n) return null;
        ev.factor = num(ev.factor, R.uniform(5, 20));
        dur = dur || R.uniform(20, 120);
        info.factor = ev.factor;
        break;
      case "extOutage":
        if (!n) return null;
        ev.mode = ev.mode || (R.chance(0.5) ? "down" : "throttle");
        dur = dur || R.uniform(30, 120);
        info.mode = ev.mode;
        break;
      case "badDeploy":
        if (!n) { n = R.pick(this.nodes.filter(isCompute)); if (!n) return null; ev.target = n.id; }
        ev.factor = num(ev.factor, 0.3);
        dur = dur || R.uniform(30, 120);
        break;
      case "noisy":
        if (!n) return null;
        dur = dur || R.uniform(60, 300);
        break;
      case "gcStorm":
        if (!n) return null;
        dur = dur || R.uniform(30, 60);
        break;
      default:
        return null;
    }
    var a = { type: type, target: ev.target || null, t0: t, until: t + dur, factor: ev.factor, mode: ev.mode, scripted: !!ev.scripted, label: ev.label || null };
    this.active.push(a);
    info.durationS = Math.round(dur);
    this.logEvent(type, "start", a.target, info);
    return a;
  };

  Sim.prototype.inject = function (type, target, extra) {
    var ev = { type: type, target: target };
    if (extra) for (var k in extra) ev[k] = extra[k];
    return this.fire(ev, this.R.manual);
  };

  Sim.prototype.runEvents = function () {
    var self = this, t = this.t;
    /* scripted events of the scenario */
    var scripted = (this.scenario && this.scenario.events) || [];
    scripted.forEach(function (ev, i) {
      if (!self.firedScripted[i] && t >= ev.t) {
        self.firedScripted[i] = 1;
        var targets = ev.targetType ? self.nodes.filter(function (n) { return n.type === ev.targetType; }).map(function (n) { return n.id; }) : [ev.target];
        targets.forEach(function (id) {
          var copy = {}; for (var k in ev) copy[k] = ev[k];
          copy.scripted = true; copy.target = id;
          self.fire(copy);
        });
      }
    });
    /* random events (Poisson processes scaled by the chaos level) */
    var level = CHAOS[this.settings.chaos] || 0;
    if (level > 0) {
      var R = this.R.events;
      EVENT_ORDER.forEach(function (type) {
        var spec = EVENTS[type], base = spec.rate * level / 3600 * DT;
        if (spec.scope === "node") {
          self.nodes.forEach(function (n) {
            var p = base * (type === "crash" || type === "slow" || type === "extOutage" ? num(n.p.mtbf, 1) : 1);
            if (R.random() < p && spec.ok(n) && !self.isActive(type, n.id)) self.fire({ type: type, target: n.id });
          });
        } else if (R.random() < base && (!spec.ok || spec.ok(self)) && !self.isActive(type, null)) {
          self.fire({ type: type });
        }
      });
    }
    /* expire */
    var still = [];
    this.active.forEach(function (a) {
      if (t >= a.until) self.logEvent(a.type, "end", a.target, {});
      else still.push(a);
    });
    this.active = still;
    this.downs = this.downs.filter(function (d) {
      if (t >= d.until) {
        var n = self.byId[d.node];
        if (n) { n.st.leakT0 = t; }
        return false;
      }
      return true;
    });
  };

  Sim.prototype.isActive = function (type, target) {
    for (var i = 0; i < this.active.length; i++) {
      var a = this.active[i];
      if (a.type === type && (target === null || a.target === target)) return true;
    }
    return false;
  };

  /* Recompute every modifier from the active events. */
  Sim.prototype.applyModifiers = function () {
    var self = this, t = this.t;
    this.trafficF = 1; this.zipfBoost = 0;
    this.nodes.forEach(function (n) {
      n.latF = 1; n.capF = 1; n.errBoost = 0; n.gcF = 1; n.extDown = false; n.quotaF = 1;
      n.down = 0; n.downUndet = 0; n.allDownSince = null;
    });
    this.flowEdges.forEach(function (e) { e.part = false; e.partSince = 0; });
    this.active.forEach(function (a) {
      var n = a.target ? self.byId[a.target] : null;
      switch (a.type) {
        case "viral": self.trafficF *= a.factor; break;
        case "hotkey": self.zipfBoost += a.factor; break;
        case "slow": if (n) n.latF *= a.factor; break;
        case "noisy": if (n) n.capF *= 0.7; break;
        case "gcStorm": if (n) { n.gcF *= 20; n.capF *= 0.85; } break;
        case "badDeploy": if (n) n.errBoost = 1 - (1 - n.errBoost) * (1 - a.factor); break;
        case "extOutage": if (n) { if (a.mode === "down") n.extDown = true; else n.quotaF *= 0.2; } break;
        case "partition":
          self.flowEdges.forEach(function (e) { if (e.id === a.target) { e.part = true; e.partSince = a.t0; } });
          break;
      }
    });
    this.downs.forEach(function (d) {
      var n = self.byId[d.node];
      if (!n) return;
      n.down += d.k;
      if (t < d.detectAt) n.downUndet += d.k;
    });
    this.nodes.forEach(function (n) {
      var r = n.st.ready;
      if (n.down >= r) {
        n.down = r;
        var since = Infinity;
        self.downs.forEach(function (d) { if (d.node === n.id) since = Math.min(since, d.t0); });
        n.allDownSince = since;
      }
      n.downUndet = Math.min(n.downUndet, r);
    });
  };

  /* ════════════════ Fluid model ════════════════ */

  /* Hot-partition factor: share of load on the busiest partition. */
  Sim.prototype.hotShare = function (P) {
    var s = 0;
    this.clients.forEach(function (c) { s = Math.max(s, num(c.p.zipfS, 0.8)); });
    var top = zipfTop(s + this.zipfBoost, 1e6);
    return P <= 1 ? 1 : top + (1 - top) / P;
  };

  Sim.prototype.serviceMean = function (n) {
    var p = n.p, S = lnMean(num(p.latencyMs, 1) * n.latF, num(p.sigma, 0.4));
    if (n.type === "app") S += num(p.gc, 0.002) * n.gcF * 175;
    return S;
  };

  Sim.prototype.forwardNode = function (n) {
    var p = n.p, st = n.st, F = n.inF, self = this;
    var lam = F[0] + F[1] + F[2];
    n.lam = lam;
    if (lam > 0) n.mix = [F[0] / lam, F[1] / lam, F[2] / lam];
    else n.mix = n.mix || [1, 0, 0];

    if (n.role === "source") {
      n.out_ = F.slice(); n.rho = 0; n.rhoCpu = 0; n.rhoThr = 0; n.proc = lam;
      n.rl = 0; n.dead = 0; n.pRej = 0; n.waitMs = 0; n.eb = 0; n.S = 0;
      this.distribute(n, n.out_);
      return;
    }
    if (n.role === "msg") { this.forwardMsg(n); return; }

    var ready = st.ready, alive = Math.max(0, ready - n.down);
    var S = this.serviceMean(n);
    n.S = S;
    n.dead = n.down >= ready ? 1 : n.downUndet / Math.max(1, ready);

    /* rate limit / provider quota (LLM: only model calls count) */
    var semHit = n.type === "llmgw" ? clamp(num(p.semanticCacheHit, 0), 0, 0.95) : 0;
    var limit = n.type === "apigw" ? num(p.rateLimit, 0) : (n.def.d.ext ? num(p.quota, 0) * n.quotaF : 0);
    var limited = lam * (1 - semHit);
    /* token bucket: refills at `limit` per second, holds 2 s of burst */
    n.rl = 0;
    if (limit > 0) {
      var burst = 2 * limit;
      st.tokens = Math.min(burst, (st.tokens === undefined ? burst : st.tokens) + limit * DT);
      var want = limited * DT, allowed = Math.min(want, st.tokens);
      st.tokens -= allowed;
      n.rl = want > 0 ? 1 - allowed / want : 0;
    }
    n.rlBot = n.rl;
    if (n.type === "apigw" && n.rl > 0) {
      /* per-client token buckets: the heaviest clients (bots) are cut first */
      var excess = lam * n.rl, cutB = Math.min(F[2], excess), legit = F[0] + F[1];
      n.rlBot = F[2] > 0 ? cutB / F[2] : 0;
      n.rl = legit > 0 ? clamp((excess - cutB) / legit, 0, 1) : 0;
    }
    n.fallbackShare = 0;
    if (n.type === "llmgw" && p.fallbackModel) {
      n.fallbackShare = n.extDown ? 1 : n.rl;
      n.rl = 0;
    }
    if (n.type === "llmgw") n.rl *= (1 - semHit);   // cache hits never hit the quota

    var through = (1 - n.rl) * (1 - n.dead);
    var Fa = [F[0] * through, F[1] * through, F[2] * (1 - n.rlBot) * (1 - n.dead)];
    var wc = num(p.writeCost, 1);
    var work = Fa[0] + Fa[2] + wc * Fa[1];
    var lamA = Fa[0] + Fa[1] + Fa[2];

    /* CPU capacity (work units / s) */
    var cap = num(p.capacity, 1000) * n.capF, muCpu;
    if (n.down >= ready) muCpu = 0;
    else if (n.type === "serverless") {
      muCpu = Infinity;   // the limit is concurrency (below), not CPU
    } else if (n.type === "sql") {
      var rr = Math.max(0, Math.round(num(p.readReplicas, 0)));
      var rhoAll = work / (cap * (1 + rr)), rhoW = wc * Fa[1] / cap;
      n.rhoW = rhoW;
      var rhoS = Math.max(rhoAll, rhoW);
      muCpu = rhoS > 0 ? work / rhoS : cap * (1 + rr);
    } else if (n.def.d.partitioned) {
      n.hot = this.hotShare(alive);
      muCpu = cap / n.hot;
    } else {
      muCpu = alive * cap * this.leakFactor(n);
    }
    if (!isFinite(muCpu)) muCpu = Infinity;

    /* thread / connection limit (Little's Law: L = λ·W ≤ threads) */
    var threads = num(p.threads, Infinity), muThr = Infinity, kWork = lamA > 0 ? work / lamA : 1;
    if (isFinite(threads) && n.type !== "serverless") {
      var conc = threads * (n.type === "sql" ? 1 + Math.max(0, Math.round(num(p.readReplicas, 0))) : alive);
      muThr = st.holdPrev > 0 ? conc / (st.holdPrev / 1000) * kWork : Infinity;
      n.threadsTotal = conc;
    } else n.threadsTotal = Infinity;
    var mu = Math.min(muCpu, muThr);

    /* bounded queue */
    var q = st.q, proc = Math.min(mu, work + q / DT);
    if (!isFinite(proc)) proc = work + q / DT;
    var qn = q + (work - proc) * DT, lim = num(p.queueLimit, 0) * Math.max(1, alive), rej = 0;
    if (qn > lim) { rej = (qn - lim) / DT; qn = lim; }
    if (qn < 1e-9) qn = 0;
    st.q = qn;
    n.pRej = work > 0 ? clamp(rej / work, 0, 1) : (mu === 0 ? 1 : 0);
    if (n.down >= ready) n.pRej = 1;
    n.rhoCpu = muCpu > 0 ? work / muCpu : (work > 0 ? Infinity : 0);
    n.rhoThr = isFinite(muThr) && muThr > 0 ? work / muThr : 0;
    n.rho = mu > 0 ? work / mu : (work > 0 ? Infinity : 0);
    /* an external API's capacity, from your side, is its quota */
    if (n.def.d.ext && limit > 0 && !isFinite(muCpu)) n.rho = n.rhoCpu = limited / limit;
    n.mu = mu; n.muCpu = muCpu; n.work = work;
    st.muPrev = isFinite(mu) ? mu / kWork : 1e9;

    /* queueing delay: Sakasegawa on a 1 s average of ρ (the per-tick Poisson
       bursts already show up in the fluid queue q) */
    var a = DT / 1;
    st.rhoC = (st.rhoC === undefined ? Math.min(n.rhoCpu, 2) : (1 - a) * st.rhoC + a * Math.min(n.rhoCpu, 2)) || 0;
    st.rhoT = (st.rhoT === undefined ? Math.min(n.rhoThr, 2) : (1 - a) * st.rhoT + a * Math.min(n.rhoThr, 2)) || 0;
    var wait;
    if (st.rhoT > st.rhoC) wait = sakasegawa(st.holdPrev, st.rhoT, n.threadsTotal);
    else wait = sakasegawa(S, st.rhoC, isFinite(muCpu) ? muCpu * S / 1000 : 1e6);
    if (qn > 0 && mu > 0) wait += qn / mu * 1000;
    n.waitMs = fin(wait);

    /* serverless: instances = λ·W (Little's Law). Requests beyond what the
       warm pool absorbs land on new instances and pay the cold start, which
       makes W (and so the instances needed) grow; above the concurrency
       limit calls are throttled (429). New instances are warm after the
       cold start; idle ones are reclaimed after a few minutes. */
    if (n.type === "serverless") {
      var cold = num(p.coldStartMs, 600), prov = num(p.provisioned, 0), limitC = num(p.concurrencyLimit, 1000);
      var H = Math.max(S, st.holdPrev);   // an instance is busy for its own work + downstream calls
      var warmPool = Math.max(st.warm, prov), need = lamA * H / 1000;
      var cs = need > warmPool && lamA > 0 ? clamp(1 - warmPool * 1000 / (H * lamA), 0, 1) : 0;
      var inst = lamA * (H + cs * cold) / 1000;
      var thr = inst > limitC ? 1 - limitC / inst : 0;
      st.warm = need > st.warm ? st.warm + (Math.min(need, limitC) - st.warm) * Math.min(1, DT * 1000 / Math.max(cold, 1)) : Math.max(need, st.warm * Math.exp(-DT / 180));
      n.coldShare = cs;
      n.instances = Math.min(inst, limitC);
      n.threadsTotal = limitC;
      n.inflight = n.instances;
      n.rhoCpu = n.rho = limitC > 0 ? inst / limitC : 0;
      n.pRej = 1 - (1 - n.pRej) * (1 - thr);
      proc *= 1 - thr;
    }

    /* cache warm-up after a flush */
    if (n.role === "cache") {
      var warmS = num(p.cacheWarmS, 60);
      st.h = Math.min(1, st.h + DT / warmS);
    }

    var k = work > 0 ? proc / work : 0;
    var eb = 1 - (1 - n.errBoost) * (1 - (n.extDown && !n.fallbackShare ? 1 : 0));
    n.eb = eb;
    var out = [Fa[0] * k * (1 - eb), Fa[1] * k * (1 - eb), Fa[2] * k * (1 - eb)];
    if (work === 0 && proc > 0) { var m = n.mix; out = [proc * m[0], proc * m[1], proc * m[2]]; }
    n.proc = (out[0] + out[1] + out[2]);

    /* type-specific transformations before calling the targets */
    if (n.type === "waf") out[2] *= 1 - clamp(num(p.blockRate, 0.95), 0, 1);
    n.miss = 1;
    if (n.role === "cache") {
      var hT = clamp(num(p.hitRatio, 0.9), 0, 0.999);
      var wshare = lam > 0 ? F[1] / lam : 0;
      if (p.policy !== "write-through" && n.type === "cache") hT *= 1 - 0.5 * wshare;
      var hEff = hT * st.h, deficit = hT - hEff;
      n.hit = hEff;
      n.miss = 1 - hT + deficit * (p.coalescing ? 0.1 : 1);
      n.missTrace = 1 - hEff;
      out[0] *= n.miss; out[2] *= n.miss;
    }
    if (n.type === "llmgw") { out[0] *= 1 - semHit; out[1] *= 1 - semHit; out[2] *= 1 - semHit; n.semHit = semHit; }
    n.out_ = out;

    /* SQL replication lag (display + goal): grows with the write load */
    if (n.type === "sql" && num(p.readReplicas, 0) > 0) {
      var rw = n.rhoW || 0;
      if (rw >= 1) st.repLag += (rw - 1) * DT * 5;
      else st.repLag = Math.max(0.02 + 0.5 * Math.pow(rw, 3) / (1 - Math.min(rw, 0.97)), st.repLag - DT);
      n.repLag = st.repLag;
    } else n.repLag = 0;

    /* thread occupancy for the inspector: L = λ·hold */
    if (n.type !== "serverless") n.inflight = proc / kWork * st.holdPrev / 1000;

    this.distribute(n, out);
  };

  Sim.prototype.leakFactor = function (n) {
    var leak = num(n.p.leakPerMin, 0);
    if (!(leak > 0)) return 1;
    return Math.max(0.1, 1 - leak / 100 * (this.t - n.st.leakT0) / 60);
  };

  /* Messaging node: accept publishes, keep backlogs, let consumers drain. */
  Sim.prototype.forwardMsg = function (n) {
    var p = n.p, st = n.st, F = n.inF, lam = n.lam;
    var alive = Math.max(0, st.ready - n.down);
    var mu = n.down >= st.ready ? 0 : num(p.capacity, 30000) * n.capF * (n.def.d.partitioned ? alive : 1);
    var acc = Math.min(lam, mu);
    n.pRej = lam > 0 ? 1 - acc / lam : (mu === 0 ? 1 : 0);
    n.rho = mu > 0 ? lam / mu : (lam > 0 ? Infinity : 0);
    n.rhoCpu = n.rho; n.rhoThr = 0; n.S = this.serviceMean(n); n.waitMs = 0; n.dead = 0; n.rl = 0; n.eb = 0;
    n.proc = acc; n.mu = mu;
    var mix = n.mix, maxB = num(p.maxBacklog, 1e7), P = num(p.partitions, Infinity);
    var self = this, drops = 0, dropShare = 0, totalBacklog = 0, maxLag = 0;
    function avail(e) {
      var c = e.to, cs = c.st;
      if (c.down >= cs.ready) return 0;
      var par = isFinite(P) ? Math.min(1, P / Math.max(1, cs.ready - c.down)) : 1;
      return cs.muPrev * 0.97 * par;
    }
    function deliver(e, rate) {
      var s = e.to.st.sPrev[1];
      e.to.inF[0] += rate * mix[0]; e.to.inF[1] += rate * mix[1]; e.to.inF[2] += rate * mix[2];
      e.rate = rate; e.errRate = rate * (1 - s);
      return rate * (1 - s);   // failed deliveries come back (at-least-once)
    }
    if (p.fanout || n.def.d.fanout) {
      n.out.forEach(function (e) {
        var es = e.st, inRate = acc * e.ratio * (e.mask[0] * mix[0] + e.mask[1] * mix[1] + e.mask[2] * mix[2]);
        es.backlog += inRate * DT;
        var a = avail(e), d = Math.min(es.backlog / DT, a);
        es.backlog -= d * DT;
        es.backlog += deliver(e, d) * DT;
        if (es.backlog > maxB) {
          var dr = (es.backlog - maxB) / DT;
          drops += dr; es.backlog = maxB;
          if (inRate > 0) dropShare = Math.max(dropShare, clamp(dr / inRate, 0, 1));
        }
        e.lag = es.backlog > 1 ? es.backlog / Math.max(a * e.to.st.sPrev[1], 1e-6) : 0;
        e.backlog = es.backlog;
        totalBacklog += es.backlog; maxLag = Math.max(maxLag, e.lag);
      });
    } else {
      st.backlog += acc * DT;
      var av = n.out.map(avail), total = av.reduce(function (s, x) { return s + x; }, 0);
      var d = Math.min(st.backlog / DT, total), back = 0;
      st.backlog -= d * DT;
      n.out.forEach(function (e, i) { back += deliver(e, total > 0 ? d * av[i] / total : 0); });
      st.backlog += back * DT;
      if (st.backlog > maxB) { drops += (st.backlog - maxB) / DT; st.backlog = maxB; if (acc > 0) dropShare = clamp(drops / acc, 0, 1); }
      totalBacklog = st.backlog;
      var good = 0;
      n.out.forEach(function (e, i) { good += av[i] * e.to.st.sPrev[1]; });
      maxLag = st.backlog > 1 ? st.backlog / Math.max(good, 1e-6) : 0;
      n.out.forEach(function (e) { e.lag = maxLag; e.backlog = st.backlog; });
    }
    n.backlog = totalBacklog; n.lag = Math.min(maxLag, 86400); n.drops = drops;
    /* beyond the retention limit messages are lost: those publishes count as errors */
    if (dropShare > 0) n.pRej = 1 - (1 - n.pRej) * (1 - dropShare);
    if (!n.out.length) { n.backlog = 0; n.lag = 0; }
    n.inflight = 0; n.threadsTotal = Infinity;
    void self;
  };

  /* Split the processed flow of n over its outgoing edges. */
  Sim.prototype.distribute = function (n, out) {
    var self = this, t = this.t;
    n.groups.forEach(function (g) {
      if (g.split) {
        var w = g.edges.map(function (e) {
          var c = e.to;
          var deadKnown = (c.allDownSince !== null && t >= c.allDownSince + e.detectS) || (e.part && t >= e.partSince + e.detectS);
          if (deadKnown) return 0;
          var capPer = num(c.p.capacity, 1), known = Math.max(0, (c.down || 0) - (c.downUndet || 0));
          var capT = c.role === "msg" || !isFinite(capPer) ? 1 : Math.max(0.01, (c.st.ready - known) * capPer);
          return capT * e.ratio;
        });
        if (n.type === "dns" && n.p.mode === "failover") {
          var best = -1;
          g.edges.forEach(function (e, i) { if (w[i] > 0 && (best < 0 || e.ratio > g.edges[best].ratio)) best = i; });
          w = w.map(function (_, i) { return i === best ? 1 : 0; });
        }
        var tot = w.reduce(function (s, x) { return s + x; }, 0);
        g.shares = w.map(function (x) { return tot > 0 ? x / tot : 0; });
        if (!(tot > 0)) g.shares = w.map(function () { return 1 / w.length; });
        g.edges.forEach(function (e, i) { self.send(e, [out[0] * g.shares[i], out[1] * g.shares[i], out[2] * g.shares[i]]); });
      } else {
        g.edges.forEach(function (e) {
          var f = e.ratio * e.k;
          self.send(e, [out[0] * f * e.mask[0], out[1] * f * e.mask[1], out[2] * f * e.mask[2]]);
        });
      }
    });
  };

  /* Send a flow on an edge: circuit breaker, retries (immediate or delayed). */
  Sim.prototype.send = function (e, base) {
    var es = e.st, tot = base[0] + base[1] + base[2];
    e.base = tot; e.baseV = base;
    var pass = es.cb === "open" ? 0 : es.cb === "half" ? 0.1 : 1;
    if (e.part) pass = 0;   // packets are lost: the target never sees them
    var p = clamp(es.pFail, 0, 1), r = e.async ? 0 : e.retries, sent = tot * pass, extra = 0;
    var slot = this.tick % LINE;
    if (r > 0 && pass > 0) {
      if (e.p.backoff === "none") {
        var A = 0;
        for (var i = 1; i <= r; i++) A += Math.pow(p, i);
        extra = sent * A;
      } else {
        for (var j = 1; j <= r; j++) {
          var amt = sent * Math.pow(p, j), d = Math.max(1, Math.round(Math.pow(2, j - 1)));   // 100 ms · 2^(j−1)
          if (e.p.backoff === "exp+jitter") {
            for (var s = 1; s <= d; s++) es.line[(this.tick + s) % LINE] += amt / d;
          } else es.line[(this.tick + d) % LINE] += amt;
        }
      }
    }
    extra += es.line[slot] * (pass > 0 ? 1 : 0);
    es.line[slot] = 0;
    var total = sent + extra, k = tot > 0 ? total / tot : 0;
    e.rate = total; e.retryRate = extra;
    var c = e.to.inF;
    if (tot > 0) { c[0] += base[0] * k; c[1] += base[1] * k; c[2] += base[2] * k; }
    else if (extra > 0) { c[0] += extra; }
  };

  /* ─── Backward pass: latency W and success s per class (0 read, 1 write) ─── */
  Sim.prototype.edgeStats = function (e, c) {
    var es = e.st, ch = e.to, t = this.t;
    if (e.async && !e.msg) return { T: 0.1, s: 1, p: 0 };
    if (e.msg) return this.fallback(e, { T: ch.W[c] + e.hop, s: ch.s[c], p: 1 - ch.s[c], pto: 0 });
    /* an attempt either hangs (dead target, partition), fails fast (429/503)
       or is processed; only processed attempts can be slow or time out */
    var hangT = e.timeout > 0 ? Math.min(e.timeout, HANG_MS) : HANG_MS;
    var pHang = e.part ? 1 : (ch.dead || 0), pFast = (1 - pHang) * (ch.fast ? ch.fast[c] : 0), pProc = 1 - pHang - pFast;
    var Wok = (ch.Wok ? ch.Wok[c] : ch.W[c]) + e.hop, sok = ch.sok ? ch.sok[c] : ch.s[c];
    var to = timeoutStats(Wok, e.timeout);
    var tau = pHang * hangT + pFast * 1 + pProc * (e.timeout > 0 ? to.mean : Wok);
    var pAtt = clamp(1 - pProc * (1 - to.p) * sok, 0, 1);
    var pto = pProc * to.p;
    if (es.cb === "open") return this.fallback(e, { T: 0.05, s: 0, p: pAtt, open: true, pto: pto });
    var r = e.retries, A = 0, back = 0;
    for (var i = 0; i <= r; i++) {
      var pi = Math.pow(pAtt, i);
      A += pi;
      if (i > 0) back += pi * (e.p.backoff === "exp" ? 100 * Math.pow(2, i - 1) : e.p.backoff === "exp+jitter" ? 50 * Math.pow(2, i - 1) : 0);
    }
    var T = tau * A + back, s = 1 - Math.pow(pAtt, r + 1);
    if (es.cb === "half") { T = 0.1 * T + 0.9 * 0.05; s = 0.1 * s; }
    void t;
    return this.fallback(e, { T: T, s: s, p: pAtt, pto: pto });
  };

  /* A fallback (stale/default answer) turns a failed call into a degraded success. */
  Sim.prototype.fallback = function (e, x) {
    x.deg = 0;
    if (e.p.fallback && !e.msg) { x.deg = 1 - x.s; x.s = 1; }
    return x;
  };

  Sim.prototype.backwardNode = function (n) {
    var self = this, p = n.p, st = n.st;
    n.W = n.W || [0, 0]; n.s = n.s || [1, 1]; n.fast = n.fast || [0, 0]; n.Wok = n.Wok || [0, 0]; n.sok = n.sok || [1, 1];
    if (n.role === "msg") {
      var dead = n.down >= st.ready;
      n.W[0] = n.W[1] = dead ? HANG_MS : n.S;
      n.s[0] = n.s[1] = dead ? 0 : 1 - n.pRej;
      st.sPrev = n.s.slice();
      return;
    }
    var Tdown = [0, 0], sdown = [1, 1], par = n.role === "source" ? p.parallelCalls !== false : !!p.parallelCalls;
    var holdDown = 0, deg = 0;
    n.groups.forEach(function (g) {
      for (var c = 0; c < 2; c++) {
        if (g.split) {
          var T = 0, s = 0;
          g.edges.forEach(function (e, i) {
            var x = self.edgeStatsCached(e, c);
            T += g.shares[i] * x.T; s += g.shares[i] * x.s;
          });
          if (par) Tdown[c] = Math.max(Tdown[c], T); else Tdown[c] += T;
          sdown[c] *= s;
        } else {
          g.edges.forEach(function (e) {
            var x = self.edgeStatsCached(e, c), f = Math.min(1, e.ratio * e.mask[c]), k = e.k;
            if (par) Tdown[c] = Math.max(Tdown[c], f * k * x.T); else Tdown[c] += f * k * x.T;
            sdown[c] *= (1 - f) + f * Math.pow(x.s, k);
          });
        }
      }
    });
    /* bulkheads: a call may hold at most a share of the caller's threads */
    n.out.forEach(function (e) {
      e.bhAdm = 1;
      if (!(num(e.p.bulkhead, 0) > 0) || !isFinite(n.threadsTotal)) return;
      var x = self.edgeStatsCached(e, 0), B = e.p.bulkhead * n.threadsTotal, L = (e.rate || 0) * x.T / 1000;
      if (L > B) {
        var adm = B / L;
        e.bhAdm = adm;
        for (var c = 0; c < 2; c++) {
          var f = Math.min(1, e.ratio * e.mask[c]);
          Tdown[c] -= f * x.T * (1 - adm);
          if (!e.p.fallback) sdown[c] *= (1 - f) + f * adm;
        }
      }
    });
    /* cache hits and semantic-cache hits skip the targets */
    var m = n.role === "cache" ? n.miss : n.type === "llmgw" ? 1 - (n.semHit || 0) : 1;
    var S = n.S || 0;
    if (n.type === "llmgw") {
      var fb = n.fallbackShare || 0;
      S = (n.semHit || 0) * 20 + (1 - (n.semHit || 0)) * S * (1 + 0.5 * fb);
    }
    if (n.type === "serverless") S += (n.coldShare || 0) * num(p.coldStartMs, 600);
    if (n.role === "source") {
      for (var c0 = 0; c0 < 2; c0++) {
        var to = timeoutStats(Tdown[c0], num(p.timeoutMs, 30000));
        n.W[c0] = Math.min(Tdown[c0], num(p.timeoutMs, 30000));
        n.s[c0] = sdown[c0] * (1 - to.p);
      }
      return;
    }
    var mixW = n.mix ? n.mix[1] : 0;
    for (var c = 0; c < 2; c++) {
      var mc = c === 0 ? m : (n.role === "cache" ? 1 : m);
      var Td = mc * Tdown[c], sd = (1 - mc) + mc * sdown[c];
      var okT = n.waitMs + S + (1 - n.eb) * Td;
      var alive = n.pRej * 1 + (1 - n.pRej) * okT;
      n.W[c] = n.rl * 1 + (1 - n.rl) * (n.dead * HANG_MS + (1 - n.dead) * alive);
      n.s[c] = (1 - n.rl) * (1 - n.dead) * (1 - n.pRej) * (1 - n.eb) * sd;
      n.fast[c] = 1 - (1 - n.rl) * (1 - n.pRej);
      n.Wok[c] = okT;
      n.sok[c] = (1 - n.eb) * sd;
      if (n.type === "cache" && c === 1 && p.policy === "write-through") n.W[c] += S;
      holdDown += (c === 0 ? 1 - mixW : mixW) * Td;
    }
    var hold = S + (1 - n.eb) * holdDown;
    st.holdPrev = 0.7 * st.holdPrev + 0.3 * hold;
    n.hold = hold;
    st.sPrev = n.s.slice();
    void deg;
  };

  Sim.prototype.edgeStatsCached = function (e, c) {
    if (!e._x || e._xt !== this.tick) { e._x = [this.edgeStats(e, 0), this.edgeStats(e, 1)]; e._xt = this.tick; }
    return e._x[c];
  };

  /* Circuit breaker state machine, once per tick per edge. */
  Sim.prototype.updateBreakers = function () {
    var t = this.t;
    this.flowEdges.forEach(function (e) {
      var es = e.st, x = e._x ? e._x[0] : null;
      var p = x ? x.p : 0;
      if (e._x) es.pFail = x.p;
      /* duplicate charges: a retry after a TIMEOUT may repeat an operation the
         provider already performed, unless it carries an idempotency key */
      e.dupRate = 0;
      if (e.to.type === "payment" && !e.p.idempotencyKey && x && x.p > 0) e.dupRate = (e.retryRate || 0) * clamp((x.pto || 0) / x.p, 0, 1);
      if (e.from.role === "msg") return;   // set by the broker (redeliveries)
      e.errRate = e.async && !e.msg ? 0 : (e.rate || 0) * p;
      e.cbState = es.cb;
      if (!e.p.circuitBreaker || e.async) { es.cb = "closed"; return; }
      var a = DT / 5;
      es.cbErr = (1 - a) * es.cbErr + a * p;
      es.cbVol = (1 - a) * es.cbVol + a * (e.base || 0);
      if (es.cb === "closed" && es.cbErr > 0.5 && es.cbVol > 1) { es.cb = "open"; es.cbUntil = t + 10; }
      else if (es.cb === "open" && t >= es.cbUntil) { es.cb = "half"; es.cbUntil = t + 2; }
      else if (es.cb === "half" && t >= es.cbUntil) {
        if (p > 0.5) { es.cb = "open"; es.cbUntil = t + 10; }
        else { es.cb = "closed"; es.cbErr = 0; }
      }
      e.cbState = es.cb;
    });
  };

  /* ─── Autoscaling (every 15 s) ─── */
  Sim.prototype.autoscale = function () {
    var self = this, t = this.t;
    this.nodes.forEach(function (n) {
      var st = n.st, p = n.p;
      st.pending = st.pending.filter(function (r) {
        if (t >= r) { st.ready++; self.logEvent("scale", "ready", n.id, { replicas: st.ready }); return false; }
        return true;
      });
      if (!p.autoscale || n.role === "source" || n.role === "side") return;
      if (isFinite(n.rhoCpu)) { st.rhoAcc += n.rhoCpu; st.rhoN++; }
      /* the first decision comes after 15 s of samples, not at t = 0 */
      if (!(t > 0) || (Math.abs(t % 15) > 1e-6 && Math.abs(t % 15 - 15) > 1e-6)) return;
      if (!st.rhoN) return;
      var util = st.rhoAcc / st.rhoN;
      st.rhoAcc = 0; st.rhoN = 0;
      var target = clamp(num(p.targetUtil, 0.6), 0.1, 0.95), cur = st.ready + st.pending.length;
      var desired = clamp(Math.ceil(st.ready * util / target), reps(p.minReplicas, 1), reps(p.maxReplicas, 20));
      if (desired > cur) {
        for (var i = cur; i < desired; i++) st.pending.push(t + num(p.warmupS, 60));
        self.logEvent("scale", "up", n.id, { from: cur, to: desired });
      } else if (desired < st.ready && st.pending.length === 0) {
        var to = Math.max(desired, Math.ceil(st.ready / 2));
        if (to < st.ready) { self.logEvent("scale", "down", n.id, { from: st.ready, to: to }); st.ready = to; }
      }
    });
  };

  /* ─── Cost (USD / month, extrapolated from current rates) ─── */
  Sim.prototype.cost = function () {
    var total = 0, self = this;
    this.nodes.forEach(function (n) {
      var p = n.p, c = 0, st = n.st, price = num(p.price, 0), lam = n.proc || 0;
      if (n.role === "frame") return;
      if (n.role === "side") {
        var load = 0;
        n.attached.forEach(function (x) { load += x.proc || 0; });
        c = price + num(n.def.d.perNode, 0) * n.attached.length + num(n.def.d.perMillion, 0) * load / 1e6 * MONTH_S;
      } else if (n.type === "serverless") {
        var S = n.S || 30;
        c = lam * num(p.perMillion, 0.2) / 1e6 * MONTH_S + Math.max(n.instances || 0, num(p.provisioned, 0)) * num(p.memGB, 0.5) * num(p.gbSecond, 0.0000166667) * MONTH_S;
        void S;
      } else {
        var reps = st.ready + st.pending.length;
        if (n.type === "sql") reps = (p.standby ? 2 : 1) + Math.max(0, Math.round(num(p.readReplicas, 0)));
        c = price * reps + num(p.perMillion, 0) * (n.lam || 0) / 1e6 * MONTH_S;
        if (p.perGB) c += (n.lam || 0) * num(p.respKB || p.payloadKB, 20) / 1e6 * num(p.perGB, 0) * MONTH_S;
        if (n.type === "llmgw") c += (n.proc || 0) * (1 - (n.semHit || 0)) * num(p.tokensPerReq, 2000) / 1000 * num(p.pricePer1k, 0.005) * MONTH_S;
      }
      n.cost = fin(c);
      total += n.cost;
    });
    void self;
    return total;
  };

  /* ════════════════ Traces ════════════════ */

  Sim.prototype.walk = function (n, c, ctx, at, depth) {
    var R = this.R.traces, p = n.p;
    if (++ctx.visits > 300 || depth > 40) return { ms: 0, ok: true };
    if (n.role === "msg") {
      if (n.down >= n.st.ready) return { ms: HANG_MS, ok: false };
      var ms0 = R.lognormal(num(p.latencyMs, 3) * n.latF, sigma(p, 0.4));
      if (ctx.spans) ctx.spans.push({ id: n.id, at: at, wait: 0, ms: ms0, own: ms0, ok: R.random() >= n.pRej, depth: depth });
      return { ms: ms0, ok: R.random() >= n.pRej };
    }
    if (R.random() < n.rl) return this.span(ctx, n, at, 0, 1, 1, false, depth, "429");
    if (R.random() < n.dead) return this.span(ctx, n, at, 0, HANG_MS, HANG_MS, false, depth, "dead");
    if (R.random() < n.pRej) return this.span(ctx, n, at, 0, 1, 1, false, depth, "503");
    var wait = n.waitMs > 0 ? R.exponential(n.waitMs) : 0;
    var svc = n.role === "source" ? 0 : R.lognormal(num(p.latencyMs, 1) * n.latF, sigma(p, 0.4));
    if (n.type === "app" && R.random() < num(p.gc, 0.002) * n.gcF) svc += R.uniform(50, 300);
    if (n.type === "serverless" && R.random() < (n.coldShare || 0)) svc += num(p.coldStartMs, 600);
    var semantic = n.type === "llmgw" && R.random() < (n.semHit || 0);
    if (semantic) svc = R.lognormal(20, 0.3);
    else if (n.type === "llmgw" && R.random() < (n.fallbackShare || 0)) svc *= 1.5;
    var t = wait + svc, spanIdx = -1;
    if (ctx.spans) { spanIdx = ctx.spans.length; ctx.spans.push({ id: n.id, at: at, wait: wait, ms: 0, own: svc, ok: true, depth: depth }); }
    var ok = true, deg = false;
    if (R.random() < n.eb) ok = false;
    var hit = semantic || (n.role === "cache" && c === 0 && R.random() >= (n.missTrace === undefined ? n.miss : n.missTrace));
    if (ok && !hit) {
      var par = n.role === "source" ? p.parallelCalls !== false : !!p.parallelCalls, maxT = 0;
      for (var gi = 0; gi < n.groups.length && ok; gi++) {
        var g = n.groups[gi], calls = [];
        if (g.split) {
          var i = R.weighted(g.shares);
          if (i >= 0) calls.push(g.edges[i]);
        } else {
          for (var j = 0; j < g.edges.length; j++) {
            var e = g.edges[j];
            if (e.mask[c] && R.random() < e.ratio) for (var k = 0; k < e.k; k++) calls.push(e);
          }
        }
        for (var ci = 0; ci < calls.length; ci++) {
          var r = this.callEdge(calls[ci], c, ctx, at + (par ? wait + svc : t), depth + 1);
          if (par) maxT = Math.max(maxT, r.ms); else t += r.ms;
          if (r.deg) deg = true;
          if (!r.ok) { ok = false; break; }
        }
      }
      if (par) t += maxT;
    }
    if (ctx.spans && spanIdx >= 0) { ctx.spans[spanIdx].ms = t; ctx.spans[spanIdx].ok = ok; }
    var hold = t - wait;
    var tr = this.trStats[n.id] || (this.trStats[n.id] = { n: 0, hold: 0 });
    tr.n++; tr.hold += hold;
    return { ms: t, ok: ok, deg: deg };
  };

  Sim.prototype.span = function (ctx, n, at, wait, own, ms, ok, depth, why) {
    if (ctx.spans) ctx.spans.push({ id: n.id, at: at, wait: wait, ms: ms, own: own, ok: ok, depth: depth, why: why });
    return { ms: ms, ok: ok };
  };

  Sim.prototype.callEdge = function (e, c, ctx, at, depth) {
    var R = this.R.traces, es = e.st;
    if (e.async && !e.msg) return { ms: 0.1, ok: true };
    var fb = !!e.p.fallback;
    if (es.cb === "open" || (es.cb === "half" && R.random() < 0.9)) return { ms: 0.05, ok: fb, deg: fb };
    if (e.bhAdm !== undefined && e.bhAdm < 1 && R.random() > e.bhAdm) return { ms: 0.05, ok: fb, deg: fb };
    var total = 0, r = e.async ? 0 : e.retries;
    for (var i = 0; i <= r; i++) {
      var d, ok, deg = false;
      if (e.part) { d = HANG_MS; ok = false; }
      else {
        var res = this.walk(e.to, c, ctx, at + total + e.hop, depth);
        d = res.ms + e.hop; ok = res.ok; deg = res.deg;
      }
      if (e.timeout > 0 && d > e.timeout) { d = e.timeout; ok = false; }
      total += d;
      if (ok) return { ms: total, ok: true, deg: deg };
      if (i < r) {
        var b = e.p.backoff === "exp" ? 100 * Math.pow(2, i) : e.p.backoff === "exp+jitter" ? R.uniform(0, 100 * Math.pow(2, i)) : 0;
        total += b;
      }
    }
    return fb ? { ms: total, ok: true, deg: true } : { ms: total, ok: false };
  };

  Sim.prototype.sampleTraces = function () {
    var K = this.settings.traces, R = this.R.traces, self = this;
    var ring = this.tickHists[this.tick % WINDOW_TICKS];
    for (var b = 0; b < NB; b++) if (ring.h[b]) { this.winHist[b] -= ring.h[b]; this.winTotal -= ring.h[b]; ring.h[b] = 0; }
    ring.n = 0;
    var weights = this.clients.map(function (cl) { return cl.inF[0] + cl.inF[1]; });
    var total = weights.reduce(function (s, x) { return s + x; }, 0);
    if (!(total > 0) || !K) return;
    var inWin = this.t >= this.window[0] && this.t <= this.window[1];
    var record = this.hasTracing && this.tick % 10 === 0, slow = null;
    for (var i = 0; i < K; i++) {
      var ci = R.weighted(weights), cl = this.clients[ci];
      var c = R.random() < cl.inF[1] / Math.max(1e-9, cl.inF[0] + cl.inF[1]) ? 1 : 0;
      var ctx = { visits: 0, spans: record ? [] : null };
      var res = this.walk(cl, c, ctx, 0, 0);
      var tmo = num(cl.p.timeoutMs, 30000);
      if (res.ms > tmo) { res.ms = tmo; res.ok = false; }
      if (res.ok) {
        var bk = bucket(res.ms);
        ring.h[bk]++; ring.n++;
        this.winHist[bk]++; this.winTotal++;
        if (inWin) { this.runHist[bk]++; this.runN++; }
        if (res.deg) this.acc.trDeg += inWin ? 1 : 0;
        if (inWin) this.acc.trOk++;
      } else if (inWin) this.acc.trErr++;
      if (record && (!slow || res.ms > slow.ms)) slow = { t: this.t, ms: res.ms, ok: res.ok, deg: !!res.deg, cls: c, spans: ctx.spans };
    }
    if (slow) {
      slow.spans.forEach(function (s) { var n = self.byId[s.id]; s.label = n ? n.label : s.id; s.type = n ? n.type : ""; });
      this.slowTrace = slow;
    }
  };

  /* ════════════════ Tick ════════════════ */

  Sim.prototype.clientRate = function () {
    var prof = PROFILES[this.settings.profile], s = this.settings;
    var base = prof.rate(this.t, s.targetRps, s);
    var x = this.noiseX, R = this.R.noise;
    /* Ornstein–Uhlenbeck noise: slow random wander of ±noise around 1 */
    this.noiseX = x - x * DT / 10 + s.noise * Math.sqrt(2 * DT / 10) * R.normal();
    return Math.max(0, base * this.trafficF * (1 + clamp(this.noiseX, -0.5, 0.5)));
  };

  Sim.prototype.step = function (nTicks) {
    nTicks = nTicks || 1;
    for (var i = 0; i < nTicks && !this.done; i++) this.stepOnce();
  };

  Sim.prototype.stepOnce = function () {
    var self = this, s = this.settings;
    this.t = Math.round((this.tick * DT) * 1000) / 1000;
    this.runEvents();
    this.applyModifiers();
    this.nodes.forEach(function (n) { n.inF = [0, 0, 0]; });
    this.flowEdges.forEach(function (e) { e.rate = 0; e.retryRate = 0; e.base = 0; e.lag = 0; e.backlog = 0; });

    /* arrivals */
    var lam = this.clientRate(), wsum = 0, R = this.R.arrivals;
    this.clients.forEach(function (c) { wsum += Math.max(0, num(c.p.weight, 1)); });
    var offered = 0;
    this.clients.forEach(function (c) {
      var lc = wsum > 0 ? lam * Math.max(0, num(c.p.weight, 1)) / wsum : 0;
      var count = R.poisson(lc * DT), rate = count / DT;
      var rr = c.p.readRatio !== undefined && c.p.readRatio !== null && c.p.readRatio !== "" ? clamp(num(c.p.readRatio, s.readRatio), 0, 1) : s.readRatio;
      c.inF = [rate * rr, rate * (1 - rr), lc * Math.max(0, num(c.p.botShare, 0))];
      offered += rate;
    });
    /* scheduler: N jobs every T s, all at once or spread */
    this.sources.forEach(function (n) {
      if (n.type !== "scheduler") return;
      var every = Math.max(1, num(n.p.everyS, 60)), jobs = num(n.p.jobs, 1000), spread = num(n.p.spreadS, 0);
      var phase = self.t % every, rate = 0;
      if (spread > 0) rate = phase < spread ? jobs / spread : 0;
      else rate = phase < DT - 1e-9 ? jobs / DT : 0;
      n.inF = [0, rate, 0];
    });

    /* forward then backward */
    this.order.forEach(function (n) { self.forwardNode(n); });
    for (var k = this.order.length - 1; k >= 0; k--) this.backwardNode(this.order[k]);
    this.updateBreakers();
    this.autoscale();

    /* client-side results (fluid) */
    var served = 0;
    this.clients.forEach(function (c) {
      served += c.inF[0] * (c.s ? c.s[0] : 1) + c.inF[1] * (c.s ? c.s[1] : 1);
    });
    if (!isFinite(served)) { served = 0; this.bad++; }
    this.now = { offered: offered, served: served, errors: Math.max(0, offered - served), errRate: offered > 0 ? Math.max(0, 1 - served / offered) : 0 };
    var cost = this.cost();
    this.now.cost = cost;

    /* traces */
    this.sampleTraces();

    /* bookkeeping */
    var inWin = this.t >= this.window[0] && this.t <= this.window[1];
    this.acc.runOffered += offered * DT; this.acc.runServed += served * DT;
    var lagMax = 0, repLag = 0, backlog = 0, maxUtil = 0;
    this.nodes.forEach(function (n) {
      if (n.role === "msg") { lagMax = Math.max(lagMax, n.lag || 0); backlog += n.backlog || 0; }
      if (n.repLag) repLag = Math.max(repLag, n.repLag);
      if (n.role === "source" || n.role === "side" || n.down >= n.st.ready) return;
      var rho = isFinite(n.rho) ? n.rho : 10;
      if (n.role !== "msg" || n.out.length) maxUtil = Math.max(maxUtil, Math.min(rho, 10));
      n.st.maxRho = Math.max(n.st.maxRho, Math.min(rho, 10));
      if (!n.st.firstHot && n.role !== "msg" && (rho >= 0.85 || n.pRej > 0.001 || n.rl > 0.001)) {
        var reason = n.rl > 0.001 || n.def.d.ext ? (n.type === "apigw" ? "ratelimit" : "quota") :
          (n.rhoThr >= 0.85 && n.rhoThr >= n.rhoCpu) ? (n.type === "sql" ? "connections" : "threads") :
          (n.type === "sql" && n.rhoW >= 0.85) ? "writes" : (n.def.d.partitioned && n.hot > 1.5 / Math.max(1, n.st.ready) && n.st.ready > 1) ? "hotkey" :
          n.type === "serverless" ? "concurrency" : "cpu";
        var slowest = null, worst = -1;
        n.out.forEach(function (e) { var x = e._x ? e._x[0].T : 0; if (x > worst && !e.async) { worst = x; slowest = e.to.id; } });
        n.st.firstHot = { t: self.t, rho: rho, rhoCpu: n.rhoCpu, rhoThr: n.rhoThr, reason: reason, hold: n.hold, lam: n.lam, threads: n.threadsTotal, slowest: slowest, slowestMs: worst };
      }
    });
    if (inWin) {
      this.acc.offered += offered * DT; this.acc.served += served * DT;
      this.acc.costSum += cost; this.acc.costN++;
      this.acc.maxLag = Math.max(this.acc.maxLag, lagMax);
      this.acc.maxRepLag = Math.max(this.acc.maxRepLag, repLag);
      this.acc.servedWinSum += served; this.acc.winTicks++;
      var dup = 0;
      this.flowEdges.forEach(function (e) { dup += e.dupRate || 0; });
      this.acc.dups += dup * DT;
    }
    this.sec.offered += offered; this.sec.served += served; this.sec.cost += cost; this.sec.n++;
    this.tick++;
    if (this.tick % 10 === 0) {
      var S = this.series, n = this.sec.n || 1, sec = Math.round(this.tick * DT);
      var off = this.sec.offered / n, srv = this.sec.served / n;
      S.t.push(sec); S.offered.push(off); S.served.push(srv); S.errors.push(Math.max(0, off - srv));
      S.errRate.push(off > 0 ? Math.max(0, 1 - srv / off) : 0);
      S.p50.push(quantile(this.winHist, this.winTotal, 0.5)); S.p99.push(quantile(this.winHist, this.winTotal, 0.99));
      S.cost.push(this.sec.cost / n); S.backlog.push(backlog); S.maxUtil.push(maxUtil); S.lag.push(lagMax); S.repLag.push(repLag);
      this.sec = { offered: 0, served: 0, cost: 0, n: 0 };
      this.checkBreakpoint();
    }
    if (this.tick * DT >= this.duration - 1e-9) this.done = true;
  };

  /* Breakpoint profile: stop when errors > 5% or p99 > 10 × SLO for 3 s. */
  Sim.prototype.checkBreakpoint = function () {
    var S = this.series, i = S.t.length - 1, slo = this.settings.sloMs;
    if (S.t[i] >= 5 && S.t[i] <= 30 && isFinite(S.p99[i])) this.baseP99.push(S.p99[i]);
    var base = this.baseP99.length ? this.baseP99.slice().sort(function (a, b) { return a - b; })[Math.floor(this.baseP99.length / 2)] : NaN;
    function bad(j) { return S.errRate[j] > 0.05 || S.p99[j] > 10 * slo; }
    function kneeAt(j) { return isFinite(base) && S.p99[j] > 2 * base && S.t[j] > 30; }
    if (!this.knee && i >= 2 && kneeAt(i) && kneeAt(i - 1) && kneeAt(i - 2)) this.knee = { t: S.t[i - 2], rps: S.offered[i - 2], p99: S.p99[i - 2], base: base };
    if (this.settings.profile !== "breakpoint") return;
    if (!this.breakpoint && i >= 2 && bad(i) && bad(i - 1) && bad(i - 2)) {
      this.breakpoint = { t: S.t[i - 2], rps: S.offered[i - 2] };
      this.done = true;
    }
  };

  /* ─── Live views for the UI ─── */
  Sim.prototype.windowPercentiles = function () {
    return { p50: quantile(this.winHist, this.winTotal, 0.5), p95: quantile(this.winHist, this.winTotal, 0.95), p99: quantile(this.winHist, this.winTotal, 0.99), p999: quantile(this.winHist, this.winTotal, 0.999), n: this.winTotal };
  };

  Sim.prototype.nodeView = function (id) {
    var n = this.byId[id];
    if (!n) return null;
    var st = n.st;
    if (n.rho === undefined) return { lam: 0, proc: 0, rho: 0, rhoCpu: 0, rhoThr: 0, inflight: 0, threads: n.threadsTotal, q: 0, waitMs: 0, W: 0, Ww: 0, s: 1, err: 0, pRej: 0, rl: 0, ready: st.ready, pending: st.pending.length, down: 0, dead: 0, h: st.h, backlog: 0, lag: 0, cost: 0, repLag: 0, observed: !!n.observed, attached: n.attached.length, status: "ok" };
    return {
      lam: fin(n.lam), proc: fin(n.proc), rho: n.rho, rhoCpu: n.rhoCpu, rhoThr: n.rhoThr, inflight: fin(n.inflight), threads: n.threadsTotal,
      q: st.q, waitMs: fin(n.waitMs), W: n.W ? fin(n.W[0]) : 0, Ww: n.W ? fin(n.W[1]) : 0, s: n.s ? n.s[0] : 1, err: n.s ? 1 - n.s[0] : 0,
      pRej: n.pRej || 0, rl: n.rl || 0, ready: st.ready, pending: st.pending.length, down: n.down || 0, dead: n.dead || 0,
      hit: n.hit, h: st.h, backlog: n.backlog || 0, lag: n.lag || 0, drops: fin(n.drops || 0), cost: n.cost || 0, repLag: n.repLag || 0,
      observed: !!n.observed, instances: n.instances, coldShare: n.coldShare, hot: n.hot, attached: n.attached.length,
      latF: n.latF, capF: n.capF, errBoost: n.errBoost, extDown: n.extDown,
      status: n.role === "source" || n.role === "side" ? "ok" : n.down >= st.ready ? "down" : !isFinite(n.rho) || n.rho >= 0.9 || n.pRej > 0.01 ? "hot" : n.rho >= 0.7 ? "warm" : "ok"
    };
  };

  Sim.prototype.edgeView = function (id) {
    var e = null;
    for (var i = 0; i < this.flowEdges.length; i++) if (this.flowEdges[i].id === id) { e = this.flowEdges[i]; break; }
    if (!e) return null;
    var x = e._x ? e._x[0] : { T: 0, s: 1, p: 0 };
    return { rate: fin(e.rate), base: fin(e.base), retryRate: fin(e.retryRate), errRate: fin(e.errRate), pFail: x.p, T: fin(x.T), cb: e.st.cb, part: !!e.part, lag: e.lag || 0, backlog: e.backlog || 0, async: e.async, hop: e.hop, timeout: e.timeout, retries: e.retries, k: e.k, mesh: !!e.from.mesh };
  };

  /* ─── Report and goals ─── */
  Sim.prototype.stats = function () {
    var A = this.acc, self = this;
    var unsafe = 0, llms = this.nodes.filter(function (n) { return n.type === "llmgw"; });
    if (llms.length) {
      var share = 0;
      llms.forEach(function (n) {
        var safety = self.nodes.filter(function (x) { return x.type === "safety"; })[0];
        share += n.guarded ? ATTACK_SHARE * (1 - clamp(num(safety ? safety.p.catchRate : 0.98, 0.98), 0, 1)) : ATTACK_SHARE;
      });
      unsafe = share / llms.length;
    }
    var tr = A.trOk + A.trErr;
    var services = this.nodes.filter(function (n) { return isService(n) && !n.def.d.ext; });
    return {
      p50: quantile(this.runHist, this.runN, 0.5), p95: quantile(this.runHist, this.runN, 0.95),
      p99: quantile(this.runHist, this.runN, 0.99), p999: quantile(this.runHist, this.runN, 0.999),
      errorRate: A.offered > 0 ? Math.max(0, 1 - A.served / A.offered) * 100 : 0,
      availability: A.runOffered > 0 ? Math.min(100, A.runServed / A.runOffered * 100) : 100,
      throughput: A.winTicks ? A.servedWinSum / A.winTicks : 0,
      costPerMonth: A.costN ? A.costSum / A.costN : (this.now ? this.now.cost : 0),
      consumerLag: A.maxLag, replicationLag: A.maxRepLag,
      unsafeRate: unsafe * 100,
      degraded: tr > 0 ? A.trDeg / tr * 100 : 0,
      duplicates: A.dups,
      breakingPoint: this.breakpoint ? this.breakpoint.rps : (this.settings.profile === "breakpoint" && this.series.offered.length ? Math.max.apply(null, this.series.offered) : NaN),
      observed: services.length ? services.filter(function (n) { return n.observed; }).length / services.length * 100 : 100,
      tracing: this.hasTracing ? 1 : 0, logs: this.hasLogs ? 1 : 0, alerting: this.hasAlerting ? 1 : 0
    };
  };

  function checkGoal(g, st) {
    var v = st[g.metric];
    if (v === undefined || (typeof v === "number" && isNaN(v))) return { goal: g, value: v, pass: false };
    var pass = g.op === "<" ? v < g.value : g.op === "<=" ? v <= g.value : g.op === ">" ? v > g.value : g.op === ">=" ? v >= g.value : false;
    return { goal: g, value: v, pass: pass };
  }

  Sim.prototype.goals = function () {
    var st = this.stats();
    return ((this.scenario && this.scenario.goals) || []).map(function (g) { return checkGoal(g, st); });
  };

  Sim.prototype.bottleneck = function () {
    var best = null, self = this;
    this.nodes.forEach(function (n) {
      var h = n.st.firstHot;
      if (!h) return;
      if (!best || h.t < best.t || (h.t === best.t && n.st.maxRho > self.byId[best.id].st.maxRho)) best = { id: n.id, label: n.label, type: n.type, t: h.t, rho: h.rho, rhoCpu: h.rhoCpu, rhoThr: h.rhoThr, reason: h.reason, hold: h.hold, lam: h.lam, threads: h.threads, slowest: h.slowest ? self.nodeName(h.slowest) : null, slowestMs: h.slowestMs, maxRho: n.st.maxRho };
    });
    return best;
  };

  Sim.prototype.report = function () {
    var S = this.series, slo = this.settings.sloMs, best = 0, st = this.stats();
    for (var i = 0; i < S.t.length; i++) if (S.p99[i] <= slo && S.errRate[i] <= 0.01) best = Math.max(best, S.served[i]);
    var hot = this.nodes.filter(function (n) { return n.role !== "source" && n.role !== "side"; })
      .map(function (n) { return { id: n.id, label: n.label, maxRho: n.st.maxRho }; })
      .sort(function (a, b) { return b.maxRho - a.maxRho; }).slice(0, 5);
    return {
      profile: this.settings.profile, seed: this.settings.seed, chaos: this.settings.chaos, targetRps: this.settings.targetRps,
      duration: Math.round(this.t * 10) / 10, complete: this.done, window: this.window.slice(), sloMs: slo,
      stats: st, maxSustained: best, goals: this.goals(), bottleneck: this.bottleneck(), hottest: hot,
      events: this.log.filter(function (l) { return l.phase === "start" && l.type !== "scale"; }),
      theory: this.theory, breakpoint: this.breakpoint, knee: this.knee, nodes: this.nodes.length
    };
  };

  /* ─── Public API ─── */
  return {
    DT: DT, PROFILES: PROFILES, CHAOS: CHAOS, EVENTS: EVENTS, EVENT_ORDER: EVENT_ORDER, HANG_MS: HANG_MS,
    create: function (design, settings, opts) { return new Sim(design, settings, opts); },
    Sim: Sim, normalizeDesign: normalizeDesign, emptyDesign: emptyDesign, wouldCycle: wouldCycle,
    toMermaid: toMermaid, checkGoal: checkGoal, zipfTop: zipfTop, sakasegawa: sakasegawa,
    timeoutStats: timeoutStats, quantile: quantile, bucket: bucket, NB: NB
  };
});
