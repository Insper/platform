#!/usr/bin/env node
/*
 * Tests of the System Design Playground engine (no browser needed):
 *
 *     node scripts/playground/test_engine.mjs
 *
 * They check the properties the simulator teaches: determinism with a seed,
 * Little's Law, cache hit ratio vs database load, queue backlog, timeouts
 * against cascading failures, retry storms, the breaking point, random
 * events, and that every scenario runs, fails as designed and is solvable.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../docs/assets/javascripts/playground/");
const RNG = require(dir + "rng.js");
const CAT = require(dir + "catalog.js");
const E = require(dir + "engine.js");
const SC = require(dir + "scenarios.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (err) { failed++; console.log("  FAIL " + name + "\n       " + (err && err.message || err)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function near(a, b, tol, msg) { assert(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a.toFixed(3)} vs ${b.toFixed(3)} (±${tol * 100}%)`); }
function runFor(sim, seconds) { sim.step(Math.round(seconds / E.DT)); return sim; }
function runAll(sim) { let g = 0; while (!sim.done && g++ < 100000) sim.step(10); return sim; }
function at(sim, sec) { const i = sim.series.t.indexOf(sec); return i; }

const mono = (replicas = 1) => ({
  nodes: [{ id: "c", type: "client", x: 0, y: 0 }, { id: "lb", type: "lb", x: 150, y: 0 },
    { id: "a", type: "app", x: 300, y: 0, params: { replicas } }, { id: "db", type: "sql", x: 450, y: 0 }],
  edges: [{ id: "e0", from: "c", to: "lb" }, { id: "e1", from: "lb", to: "a" }, { id: "e2", from: "a", to: "db" }]
});

console.log("rng");
test("same seed, same numbers; streams are independent", () => {
  const a = RNG.create(5), b = RNG.create(5);
  for (let i = 0; i < 100; i++) assert(a.stream("x").random() === b.stream("x").random(), "streams differ");
  const c = RNG.create(5);
  c.stream("events").random(); c.stream("events").random();
  const d = RNG.create(5);
  assert(c.stream("arrivals").random() === d.stream("arrivals").random(), "drawing from one stream changed another");
});
test("poisson and lognormal have the right means", () => {
  const s = RNG.create(9).stream("t");
  let p = 0, l = 0, n = 20000;
  for (let i = 0; i < n; i++) { p += s.poisson(4); l += s.lognormal(10, 0.5); }
  near(p / n, 4, 0.03, "poisson mean");
  near(l / n, 10 * Math.exp(0.125), 0.03, "lognormal mean");
});

console.log("engine");
test("determinism: same seed + design + profile ⇒ identical run", () => {
  const sc = SC.get("flash-sale");
  const run = (seed) => runAll(E.create(sc.design, { ...sc.settings, seed, chaos: "medium" }, { scenario: sc }));
  const a = run(1), b = run(1), c = run(2);
  assert(JSON.stringify(a.series) === JSON.stringify(b.series), "series differ with the same seed");
  assert(JSON.stringify(a.log) === JSON.stringify(b.log), "event logs differ with the same seed");
  assert(JSON.stringify(a.series.offered) !== JSON.stringify(c.series.offered), "a different seed gave the same arrivals");
});

test("chaos level does not reshuffle arrivals (sub-streams)", () => {
  const d = mono(4);
  const s1 = E.create(d, { profile: "load", targetRps: 800, seed: 3, chaos: "off" });
  const s2 = E.create(d, { profile: "load", targetRps: 800, seed: 3, chaos: "high" });
  runFor(s1, 120); runFor(s2, 120);
  const firstTraffic = s2.log.filter((l) => l.type === "viral" && l.phase === "start").map((l) => l.t)[0] ?? 1e9;
  let compared = 0;
  for (let i = 0; i < s1.series.t.length; i++) {
    if (s1.series.t[i] >= firstTraffic) break;
    assert(s1.series.offered[i] === s2.series.offered[i], "arrivals changed at t=" + s1.series.t[i]);
    compared++;
  }
  assert(compared > 10, "too few seconds compared");
  assert(s2.log.some((l) => l.phase === "start"), "chaos=high produced no random event in 120 s");
});

test("Little's Law: at ρ < 0.5 mean concurrency ≈ λ·W (fluid vs sampled requests, ±10%)", () => {
  const sim = E.create(mono(4), { profile: "load", targetRps: 600, seed: 4, traces: 200, noise: 0 });
  runFor(sim, 60);
  sim.trStats = {};
  let lam = 0, Lfluid = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    sim.step(1);
    const v = sim.nodeView("a");
    lam += v.proc; Lfluid += v.inflight; n++;
  }
  const v = sim.nodeView("a");
  assert(v.rho < 0.5, "utilization too high for this test: " + v.rho);
  const tr = sim.trStats["a"];
  const Wmeasured = tr.hold / tr.n / 1000;          // seconds a request holds a thread (sampled)
  near(Lfluid / n, (lam / n) * Wmeasured, 0.1, "mean concurrency");
});

test("utilization ρ = λ / (replicas × capacity)", () => {
  const sim = runFor(E.create(mono(4), { profile: "load", targetRps: 1000, seed: 8, noise: 0 }), 80);
  const v = sim.nodeView("a");
  near(v.rhoCpu, v.lam / (4 * 500), 0.01, "ρ");
});

test("cache hit ratio reduces database reads proportionally", () => {
  const d = mono(8);
  d.nodes.push({ id: "k", type: "cache", x: 380, y: 0, params: { hitRatio: 0.8, policy: "write-through" } });
  d.edges = d.edges.filter((e) => e.id !== "e2").concat([{ id: "e3", from: "a", to: "k" }, { id: "e4", from: "k", to: "db" }]);
  const sim = E.create(d, { profile: "load", targetRps: 2000, readRatio: 1, seed: 6, noise: 0 });
  runFor(sim, 60);
  let inK = 0, inDb = 0;
  for (let i = 0; i < 200; i++) { sim.step(1); inK += sim.nodeView("k").lam; inDb += sim.nodeView("db").lam; }
  near(inDb, inK * (1 - 0.8), 0.02, "DB load = reads × (1 − hit)");
});

test("queue backlog grows while producers > consumers and drains after", () => {
  const sc = SC.get("async-queue");
  const sim = E.create(sc.solution, sc.settings, { scenario: sc });
  const bl = (s) => s.byId["q"].st.backlog;
  runFor(sim, 59); const before = bl(sim);
  runFor(sim, 30); const peak = bl(sim);
  runFor(sim, 80); const after = bl(sim);
  assert(before < 10, "backlog before the spike: " + before);
  assert(peak > 1000, "backlog did not grow during the spike: " + peak);
  assert(after < peak * 0.05, "backlog did not drain: " + after);
});

test("timeout prevents the cascading failure (cascading-failure scenario)", () => {
  const sc = SC.get("cascading-failure");
  const withTimeout = JSON.parse(JSON.stringify(sc.design));
  withTimeout.edges.forEach((e) => { if (e.id === "app-tp") e.params = { ratio: 0.5, timeoutMs: 300 }; });
  const a = runFor(E.create(sc.design, sc.settings, { scenario: sc }), 100);
  const b = runFor(E.create(withTimeout, sc.settings, { scenario: sc }), 100);
  const va = a.nodeView("app"), vb = b.nodeView("app");
  const ia = a.series.t.length - 1, ib = b.series.t.length - 1;
  assert(va.rhoThr > 1, "no thread exhaustion without timeout (ρ threads = " + va.rhoThr + ")");
  assert(va.pRej > 0.2, "app did not reject requests without timeout");
  assert(vb.rhoThr < 0.8 && vb.pRej < 0.01, "app still exhausted with a timeout");
  /* only the calls to the slow dependency fail now: ≤ its share (0.5) */
  assert(b.series.errRate[ib] < 0.55, "errors spread beyond the slow dependency: " + b.series.errRate[ib]);
  assert(a.series.errRate[ia] > b.series.errRate[ib], "timeout did not reduce errors");
});

test("retry storm is metastable; a circuit breaker recovers it", () => {
  const sc = SC.get("retry-storm");
  const a = runFor(E.create(sc.design, sc.settings, { scenario: sc }), 130);
  const b = runFor(E.create(sc.solution, sc.settings, { scenario: sc }), 130);
  const ea = a.series.errRate[at(a, 120)], eb = b.series.errRate[at(b, 120)];
  assert(ea > 0.2, "no storm 50 s after the 8 s restart (errors " + ea + ")");
  assert(eb < 0.01, "circuit breaker did not recover (errors " + eb + ")");
});

test("breakpoint profile finds the capacity of a single app server", () => {
  const sim = runAll(E.create(mono(1), { profile: "breakpoint", targetRps: 300, seed: 2 }));
  const r = sim.report();
  assert(r.breakpoint, "no breaking point found");
  assert(r.breakpoint.rps > 450 && r.breakpoint.rps < 700, "breaking point " + r.breakpoint.rps + " (capacity 500)");
  assert(r.knee && r.knee.rps < r.breakpoint.rps, "knee missing or after the break");
});

test("availability math: two replicas behind a LB are more available than one", () => {
  const one = E.create(mono(1), {}).theory, two = E.create(mono(2), {}).theory;
  assert(two > one, `${two} ≤ ${one}`);
});

test("cycles are rejected", () => {
  const d = E.normalizeDesign(mono(1));
  assert(E.wouldCycle(d, "db", "c"), "db → client should close a cycle");
  assert(!E.wouldCycle(d, "c", "db"), "client → db is not a cycle");
});

test("Mermaid export lists every node and edge", () => {
  const m = E.toMermaid(E.normalizeDesign(mono(1)));
  assert(m.startsWith("flowchart LR") && m.split("\n").length === 1 + 4 + 3, m);
});

test("the catalog has 49 components in 10 categories", () => {
  assert(CAT.LIST.length === 49 && CAT.CATEGORIES.length === 10, CAT.LIST.length + " / " + CAT.CATEGORIES.length);
  assert(CAT.CATEGORIES[3].id === "containers", "containers is not after compute");
  CAT.LIST.forEach((c) => c.params.forEach((p) => assert(CAT.PARAMS[p], c.id + ": unknown parameter " + p)));
});

test("every catalog component can be simulated alone behind a client", () => {
  CAT.LIST.forEach((c) => {
    if (c.role === "frame") return;
    const d = { nodes: [{ id: "c", type: "client", x: 0, y: 0 }, { id: "x", type: c.id, x: 200, y: 0 }], edges: [{ id: "e", from: "c", to: "x" }] };
    if (c.role === "source") d.edges = [{ id: "e", from: "x", to: "c2" }];
    const sim = runFor(E.create(d, { profile: "load", targetRps: 50, seed: 1 }), 30);
    sim.series.offered.concat(sim.series.served, sim.series.cost).forEach((v) => assert(Number.isFinite(v), c.id + ": non-finite series"));
  });
});

console.log("robustness");
const finiteRun = (d, settings = { profile: "load", targetRps: 500, seed: 1 }, secs = 30) => {
  const sim = runFor(E.create(d, settings), secs);
  ["offered", "served", "errRate", "cost", "backlog", "maxUtil"].forEach((k) =>
    sim.series[k].forEach((v, i) => assert(Number.isFinite(v), `${k}[${i}] = ${v}`)));
  assert(sim.bad === 0, "non-finite values inside the model");
  sim.nodes.forEach((n) => { const v = sim.nodeView(n.id); assert(Number.isFinite(v.lam) && Number.isFinite(v.W) && Number.isFinite(v.cost), n.id + " view"); });
  sim.report();
  return sim;
};

test("normalizeDesign never throws and drops what it cannot use", () => {
  [undefined, null, 5, "x", [], { nodes: "abc", edges: {} }, { nodes: { a: 1 }, edges: 5, frames: "f" }, { nodes: [null, 1, "x", []] }]
    .forEach((d) => { const n = E.normalizeDesign(d); assert(Array.isArray(n.nodes) && !n.nodes.length && !n.edges.length, JSON.stringify(d)); finiteRun(d); });
  const n = E.normalizeDesign({
    nodes: [{ id: "x", type: "__proto__" }, { id: "y", type: "constructor" }, { id: "z", type: "toString" }, { id: "c", type: "client" }, { id: "c", type: "app" }, { id: "a", type: "app" }],
    edges: [{ from: "c", to: "x" }, { from: "c", to: "nope" }, { from: "a", to: "a" }, { id: "e", from: "c", to: "a" }]
  });
  assert(n.nodes.map((x) => x.id).join() === "c,a", "unknown types / duplicate ids kept: " + n.nodes.map((x) => x.id));
  assert(n.edges.length === 1 && n.edges[0].from === "c" && n.edges[0].to === "a", "bad edges kept");
});

test("prototype keys as ids, types and params do not throw or pollute", () => {
  const d = JSON.parse('{"nodes":[{"id":"__proto__","type":"client"},{"id":"constructor","type":"app","params":{"__proto__":{"capacity":1},"constructor":1}},{"id":"toString","type":"sql"}],' +
    '"edges":[{"id":"__proto__","from":"__proto__","to":"constructor","params":{"__proto__":{"retries":5}}},{"id":"hasOwnProperty","from":"constructor","to":"toString"}],' +
    '"frames":[{"id":"valueOf","type":"vpc","x":0,"y":0,"w":900,"h":400,"name":{"a":1},"region":7}]}');
  const n = E.normalizeDesign(d);
  assert(n.nodes.length === 3 && n.edges.length === 2 && n.frames.length === 1, "elements lost");
  n.nodes.concat(n.edges, n.frames).forEach((x) => assert(!(x.id in Object.prototype) && x.id !== "__proto__", "unsafe id " + x.id));
  assert(Object.getPrototypeOf(n.nodes[1].params) === Object.prototype && !Object.keys(n.nodes[1].params).length, "prototype keys in params");
  assert(n.frames[0].name === "" && n.frames[0].region === "7", "frame texts not coerced to strings");
  finiteRun(d);
  assert(({}).q === undefined && ({}).n === undefined && ({}).hold === undefined, "Object.prototype polluted");
  assert(E.normalizeDesign(n).nodes.map((x) => x.id).join() === n.nodes.map((x) => x.id).join(), "not idempotent");
});

test("duplicate edge ids are made unique; labels are strings", () => {
  const n = E.normalizeDesign({ nodes: [{ id: "c", type: "client", label: 5 }, { id: "a", type: "app", label: { x: 1 } }, { id: "b", type: "app", label: "y".repeat(99) }],
    edges: [{ id: "e", from: "c", to: "a" }, { id: "e", from: "c", to: "b" }] });
  assert(n.edges[0].id !== n.edges[1].id, "duplicate edge ids");
  assert(n.nodes[0].label === "5" && n.nodes[1].label === "" && n.nodes[2].label.length === 40, "labels: " + n.nodes.map((x) => x.label));
});

test("malformed parameter values fall back to defaults or are bounded", () => {
  const d = (np, ep, type = "app") => ({ nodes: [{ id: "c", type: "client" }, { id: "lb", type: "lb" }, { id: "a", type, params: np }, { id: "db", type: "sql" }],
    edges: [{ id: "e0", from: "c", to: "lb" }, { id: "e1", from: "lb", to: "a", params: ep }, { id: "e2", from: "a", to: "db", params: ep }] });
  const n = E.normalizeDesign(d({ threads: "abc", capacity: "800", replicas: 1e999, latencyMs: -5, autoscale: "false", policy: "nope" }, { ratio: -1, retries: "x" }));
  const p = n.nodes[2].params;
  assert(p.threads === undefined && p.capacity === 800 && p.replicas === undefined && p.latencyMs === 0 && p.autoscale === false && p.policy === undefined, JSON.stringify(p));
  assert(n.edges[1].params.ratio === 0 && n.edges[1].params.retries === undefined, JSON.stringify(n.edges[1].params));
  [[{ replicas: 1e300 }, {}], [{ sigma: 1e6 }, {}], [{ capacity: 0 }, {}], [{ threads: 0 }, {}], [{ hitRatio: 7 }, {}, "cache"], [{}, { retries: 99, timeoutMs: 1, circuitBreaker: true }],
    [{ autoscale: true, minReplicas: 1e9, maxReplicas: 1e9 }, {}], [{ concurrencyLimit: 0 }, {}, "serverless"]].forEach(([np, ep, type]) => finiteRun(d(np, ep, type), undefined, 20));
  const big = E.create(d({ autoscale: true, maxReplicas: 1e9, minReplicas: 1e9 }, {}), { targetRps: 500 });
  runFor(big, 20);
  assert(big.byId.a.st.ready + big.byId.a.st.pending.length <= 10000, "replicas unbounded");
});

test("settings with prototype keys or junk fall back to defaults", () => {
  const sim = E.create(mono(1), { profile: "__proto__", chaos: "toString", seed: "abc", targetRps: "lots", traces: 1e9, spikeFactor: Infinity });
  assert(sim.settings.profile === "load" && sim.settings.chaos === "off" && sim.settings.seed === 42 && sim.settings.targetRps === 100, JSON.stringify(sim.settings));
  assert(sim.settings.traces <= 2000 && Number.isFinite(sim.settings.spikeFactor), "traces/spikeFactor unbounded");
  sim.setSettings({ chaos: "constructor" });
  assert(sim.settings.chaos === "off", "setSettings accepted a prototype key");
  runFor(E.create(mono(1), { profile: "constructor" }), 5);
});

test("load-balancer weights: a negative or zero ratio never sends negative traffic", () => {
  const d = { nodes: [{ id: "c", type: "client" }, { id: "lb", type: "lb" }, { id: "a", type: "app" }, { id: "b", type: "app" }],
    edges: [{ id: "e0", from: "c", to: "lb" }, { id: "e1", from: "lb", to: "a", params: { ratio: 1 } }, { id: "e2", from: "lb", to: "b", params: { ratio: -0.5 } }] };
  const sim = E.create(d, { profile: "load", targetRps: 300, seed: 1, noise: 0 });
  for (let i = 0; i < 400; i++) { sim.step(1); assert(sim.nodeView("a").lam >= 0 && sim.nodeView("b").lam >= 0, "negative rate at tick " + i); }
  assert(sim.nodeView("b").lam === 0 && sim.nodeView("a").lam > 0, "ratio ≤ 0 should get no traffic");
});

test("messages dropped beyond max backlog count as errors", () => {
  const d = { nodes: [{ id: "c", type: "client" }, { id: "q", type: "queue", params: { maxBacklog: 100 } }, { id: "w", type: "worker", params: { replicas: 1, capacity: 10 } }],
    edges: [{ id: "e0", from: "c", to: "q" }, { id: "e1", from: "q", to: "w" }] };
  const sim = runFor(E.create(d, { profile: "load", targetRps: 200, readRatio: 0, seed: 1, noise: 0 }), 60);
  const v = sim.nodeView("q"), i = sim.series.t.length - 1;
  assert(v.backlog <= 100 && v.drops > 100, `backlog ${v.backlog}, drops ${v.drops}`);
  assert(sim.series.errRate[i] > 0.8, "dropped messages are not errors: " + sim.series.errRate[i]);
});

test("autoscaling decides every 15 s, never at t = 0", () => {
  const d = mono(6); d.nodes[2].params = { replicas: 6, autoscale: true, minReplicas: 1, maxReplicas: 20 };
  const sim = E.create(d, { profile: "load", targetRps: 2000, seed: 1 });
  runFor(sim, 1);
  assert(sim.byId.a.st.ready === 6 && !sim.log.some((l) => l.type === "scale"), "scaled at t = 0");
  runFor(sim, 15);
  assert(sim.log.some((l) => l.type === "scale" && l.t === 15), "no decision at t = 15 s");
});

test("a node with zero capacity recovers once its capacity is fixed", () => {
  const d = mono(1);
  const sim = runFor(E.create(d, { profile: "load", targetRps: 100, seed: 1, noise: 0 }), 30);
  d.nodes.push({ id: "z", type: "app", params: { capacity: 0 } });
  d.edges.push({ id: "ez", from: "lb", to: "z" });
  sim.setDesign(d); runFor(sim, 5);
  d.nodes.find((n) => n.id === "z").params = { capacity: 500 };
  sim.setDesign(d); runFor(sim, 30);
  const v = sim.nodeView("z");
  assert(Number.isFinite(sim.byId.z.st.rhoC) && v.waitMs < 5, `wait ${v.waitMs} ms, ρ avg ${sim.byId.z.st.rhoC}`);
});

test("Mermaid ids are safe identifiers", () => {
  const m = E.toMermaid(E.normalizeDesign({ nodes: [{ id: "my app", type: "app" }, { id: "end", type: "sql" }, { id: "my-app", type: "cache" }], edges: [{ from: "my app", to: "end" }] }));
  m.split("\n").slice(1).forEach((l) => assert(/^  [A-Za-z0-9_]+(\[|\(| -)/.test(l), "unsafe line: " + l));
  assert(!/\bend\b(?!")/.test(m.replace(/"[^"]*"/g, "")), m);
});

console.log("containers, Kubernetes, service registry");
/* client → lb → microservice "a" (and "b") inside a k8s frame */
const kube = (k8s = {}, a = {}, b = null, extra = {}) => ({
  nodes: [{ id: "c", type: "client", x: 0, y: 0 }, { id: "lb", type: "lb", x: 150, y: 0 },
    { id: "a", type: "microservice", x: 400, y: 0, params: a }].concat(b ? [{ id: "b", type: "microservice", x: 600, y: 0, params: b }] : [], extra.nodes || []),
  edges: [{ id: "e0", from: "c", to: "lb" }, { id: "e1", from: "lb", to: "a" }].concat(b ? [{ id: "e2", from: "a", to: "b", params: extra.ab || {} }] : [], extra.edges || []),
  frames: [{ id: "k", type: "k8s", x: 300, y: -100, w: 400, h: 200, name: "prod", params: k8s }]
});

test("labels equal to the component type are dropped; new nodes keep empty labels", () => {
  const n = E.normalizeDesign({ nodes: [{ id: "a", type: "app", label: "App Server" }, { id: "b", type: "app", label: " checkout " }, { id: "c", type: "k8s" }] });
  assert(n.nodes[0].label === "" && n.nodes[1].label === "checkout", JSON.stringify(n.nodes.map((x) => x.label)));
  assert(n.nodes.length === 2, "a frame type was accepted as a node");
  assert(E.toMermaid(n).includes('["App Server"]'), "Mermaid does not fall back to the type");
});

test("container: capacity scales with the CPU limit, throttling slows requests", () => {
  const d = (cpuLimit) => ({ nodes: [{ id: "c", type: "client" }, { id: "x", type: "container", params: { replicas: 2, cpuLimit } }], edges: [{ id: "e", from: "c", to: "x" }] });
  const full = runFor(E.create(d(1), { profile: "load", targetRps: 300, seed: 3, noise: 0 }), 60).nodeView("x");
  const half = runFor(E.create(d(0.5), { profile: "load", targetRps: 300, seed: 3, noise: 0 }), 60).nodeView("x");
  near(full.rhoCpu, full.lam / (2 * 300), 0.01, "ρ at limit 1");
  near(half.rhoCpu, half.lam / (2 * 300 * 0.5), 0.01, "ρ at limit 0.5");
  const s1 = E.create(d(1), {}), s2 = E.create(d(0.5), {});
  s1.step(1); s2.step(1);
  near(s2.byId.x.S, 2 * s1.byId.x.S, 0.01, "service time at limit 0.5");
});

test("container: autoscaled replicas take traffic after startupS", () => {
  const d = (startupS) => ({ nodes: [{ id: "c", type: "client" }, { id: "x", type: "container", params: { replicas: 1, autoscale: true, maxReplicas: 10, startupS } }], edges: [{ id: "e", from: "c", to: "x" }] });
  const s = E.create(d(40), { profile: "load", targetRps: 600, seed: 1 });
  runFor(s, 15.05);
  const up = s.log.find((l) => l.type === "scale" && l.phase === "up");
  assert(up && up.t === 15, "no scale-up at 15 s");
  assert(s.byId.x.st.pending.every((r) => Math.abs(r - 55) < 1e-6), "pending ready times " + s.byId.x.st.pending);
  runFor(s, 39); assert(s.byId.x.st.ready === 1, "replicas ready before startupS");
  runFor(s, 2); assert(s.byId.x.st.ready > 1, "replicas not ready after startupS");
});

test("k8s: replicas beyond nodes × pods per node are Pending and do not serve", () => {
  const sim = E.create(kube({ nodes: 2, podsPerNode: 3 }, { replicas: 4 }, { replicas: 4 }), { profile: "load", targetRps: 200, seed: 1 });
  const a = sim.nodeView("a"), b = sim.nodeView("b"), v = sim.clusterView("k");
  assert(v.capacity === 6 && v.scheduled === 6 && v.pending === 2, JSON.stringify(v));
  assert(a.ready + b.ready === 6 && a.unsched + b.unsched === 2 && a.cluster === "k", `a ${a.ready}/${a.unsched} b ${b.ready}/${b.unsched}`);
  runFor(sim, 30);
  near(sim.nodeView("a").rhoCpu, sim.nodeView("a").lam / (sim.byId.a.st.ready * 400), 0.01, "ρ counts only scheduled pods");
  assert(sim.log.some((l) => l.type === "cluster" && l.phase === "pending"), "no pending event logged");
});

test("k8s: inside a cluster you pay for nodes, not pods", () => {
  const sim = runFor(E.create(kube({ nodes: 3, nodePrice: 100 }, { replicas: 5, price: 999 }), { profile: "load", targetRps: 100, seed: 1 }), 5);
  assert(sim.byId.a.cost === 0, "pod price counted: " + sim.byId.a.cost);
  near(sim.now.cost, 300 + sim.byId.lb.cost, 0.001, "cluster cost");
});

test("k8s: HPA pods wait for room; the cluster autoscaler adds a node after nodeStartupS", () => {
  const mk = (ca) => E.create(kube({ nodes: 1, podsPerNode: 4, clusterAutoscaler: ca, nodeStartupS: 60, maxNodes: 5 }, { replicas: 2, autoscale: true, maxReplicas: 12 }), { profile: "load", targetRps: 2000, seed: 2 });
  const off = runFor(mk(false), 120), on = mk(true);
  assert(off.nodeView("a").ready === 4 && off.nodeView("a").unsched > 0, "without the autoscaler the pods should stay Pending");
  runFor(on, 120);
  const up = on.log.find((l) => l.type === "cluster" && l.phase === "up"), ready = on.log.find((l) => l.type === "cluster" && l.phase === "ready");
  assert(up && ready && Math.abs(ready.t - up.t - 60) < 0.15, `node added at ${up && up.t}, ready at ${ready && ready.t}`);
  runFor(on, 40);
  assert(on.nodeView("a").ready > 4, "pending pods did not start on the new node: " + on.nodeView("a").ready);
  const e1 = off.series.errRate.slice(-10).reduce((x, y) => x + y) / 10, e2 = on.series.errRate.slice(-10).reduce((x, y) => x + y) / 10;
  assert(e2 < e1, `autoscaler did not reduce errors (${e1} → ${e2})`);
});

test("k8s: a node failure loses its pods, which are rescheduled where there is room", () => {
  const ev = (sc) => ({ id: "t", settings: {}, events: [{ t: 30, type: "nodeFail", target: "k", durationS: 600 }], goals: [] });
  const mk = (ppn) => E.create(kube({ nodes: 3, podsPerNode: ppn }, { replicas: 6 }, { replicas: 6 }), { profile: "load", targetRps: 500, seed: 4 }, { scenario: ev() });
  const room = mk(6), full = mk(4);
  runFor(room, 31); runFor(full, 31);
  assert(room.nodeView("a").ready === 4 && room.nodeView("b").ready === 4, "pods on the dead node: " + room.nodeView("a").ready + "/" + room.nodeView("b").ready);
  assert(room.clusterView("k").nodes === 2 && room.clusterView("k").failed === 1, "node count");
  runFor(room, 40 + 20 + 10 + 2); runFor(full, 72);
  assert(room.nodeView("a").ready === 6 && room.nodeView("b").ready === 6, "not rescheduled: " + room.nodeView("a").ready);
  assert(full.nodeView("a").ready === 4 && full.nodeView("a").unsched === 2, "no room: the lost pods should be Pending");
});

test("service registry: dead replicas are dropped in 3 s instead of never (direct calls)", () => {
  const mk = (reg) => {
    const d = { nodes: [{ id: "c", type: "client" }, { id: "a", type: "app", params: { replicas: 4 } }, { id: "b", type: "microservice", params: { replicas: 4 } }].concat(reg ? [{ id: "r", type: "registry" }] : []),
      edges: [{ id: "e0", from: "c", to: "a" }, { id: "e1", from: "a", to: "b", params: { timeoutMs: 200 } }].concat(reg ? [{ id: "e2", from: "r", to: "b" }] : []) };
    return E.create(d, { profile: "load", targetRps: 300, seed: 5 }, { scenario: { id: "t", settings: {}, events: [{ t: 30, type: "crash", target: "b", durationS: 60 }], goals: [] } });
  };
  const without = runFor(mk(false), 40), withReg = runFor(mk(true), 40);
  assert(without.byId.b.dead > 0.2, "without a registry the dead replica keeps its share: " + without.byId.b.dead);
  assert(withReg.byId.b.dead === 0, "with a registry the dead replica is still called: " + withReg.byId.b.dead);
  assert(withReg.byId.b.detectS === 3 && without.byId.b.detectS === Infinity, "detection times");
});

test("service registry: new pods of a cluster join without the 10 s propagation delay", () => {
  const mk = (reg) => E.create(kube({ nodes: 2, podsPerNode: 10 }, { replicas: 2, autoscale: true }, null,
    reg ? { nodes: [{ id: "r", type: "registry", x: 900, y: 300 }], edges: [{ id: "er", from: "r", to: "a" }] } : {}), { profile: "load", targetRps: 1500, seed: 6 });
  const a = runFor(mk(false), 16), b = runFor(mk(true), 16);
  near(a.byId.a.st.pending[0] - b.byId.a.st.pending[0], 10, 0.01, "join delay");
});

test("k8s and container runs are deterministic with a seed", () => {
  const sc = SC.get("k8s-node-failure");
  const run = () => runAll(E.create(sc.design, { ...sc.settings, chaos: "high" }, { scenario: sc }));
  const a = run(), b = run();
  assert(JSON.stringify(a.series) === JSON.stringify(b.series) && JSON.stringify(a.log) === JSON.stringify(b.log), "runs differ");
});

test("designs without clusters or DB clusters keep their random event sequence", () => {
  /* the new event types draw no random numbers when their component is absent */
  const sim = runFor(E.create(mono(4), { profile: "load", targetRps: 800, seed: 3, chaos: "high" }), 120);
  assert(!sim.log.some((l) => l.type === "nodeFail" || l.type === "primaryFail"), "impossible event fired");
});

console.log("DB cluster");
const dbc = (params, extra = {}) => ({
  nodes: [{ id: "c", type: "client", params: { zipfS: extra.zipfS ?? 0 } }, { id: "db", type: "dbcluster", params }],
  edges: [{ id: "e", from: "c", to: "db" }]
});

test("DB cluster: write capacity = shards × capacity ÷ write cost; reads use the followers", () => {
  const w = runFor(E.create(dbc({ shards: 2, replicasPerShard: 2 }), { profile: "load", targetRps: 1200, readRatio: 0, seed: 1, noise: 0 }), 60).nodeView("db");
  near(w.rhoHot, w.lam * 0.5 * 3 / 3000, 0.02, "write ρ of a shard");
  const rf = runFor(E.create(dbc({ replicasPerShard: 2 }), { profile: "load", targetRps: 3000, readRatio: 1, seed: 1, noise: 0 }), 60).nodeView("db");
  const rp = runFor(E.create(dbc({ replicasPerShard: 2, readsFrom: "primary" }), { profile: "load", targetRps: 3000, readRatio: 1, seed: 1, noise: 0 }), 60).nodeView("db");
  near(rf.rhoCpu, rf.lam / (3 * 3000), 0.02, "reads on 3 nodes");
  near(rp.rhoCpu, rp.lam / 3000, 0.02, "reads on the primary");
});

test("DB cluster: a hot key saturates one shard first", () => {
  const even = runFor(E.create(dbc({ shards: 4 }, { zipfS: 0 }), { profile: "load", targetRps: 2000, readRatio: 0, seed: 1, noise: 0 }), 60).nodeView("db");
  const hot = runFor(E.create(dbc({ shards: 4 }, { zipfS: 1.3 }), { profile: "load", targetRps: 2000, readRatio: 0, seed: 1, noise: 0 }), 60).nodeView("db");
  near(even.rhoHot, even.rhoOther, 0.02, "uniform keys: shards equally busy");
  assert(hot.rhoHot > 1.5 * hot.rhoOther, `hot shard ${hot.rhoHot} vs others ${hot.rhoOther}`);
});

test("DB cluster: writes to a shard fail during failover, then the follower is promoted", () => {
  const mk = (fo, R = 1) => E.create(dbc({ shards: 1, replicasPerShard: R, failoverS: fo }), { profile: "load", targetRps: 400, readRatio: 0.5, seed: 2 },
    { scenario: { id: "t", settings: {}, events: [{ t: 60, type: "primaryFail", target: "db", shard: 0 }], goals: [] } });
  const s = runFor(mk(20), 70), i = s.series.t.length - 1;
  near(s.series.errRate[i], 0.5, 0.05, "writes fail during failover (half the requests)");
  runFor(s, 20);
  assert(s.series.errRate[s.series.t.length - 1] < 0.01, "errors after the promotion: " + s.series.errRate[s.series.t.length - 1]);
  const none = runFor(mk(20, 0), 100);
  assert(none.series.errRate[none.series.t.length - 1] > 0.95, "without followers the shard should be down (reads too)");
});

test("DB cluster: async failover loses the writes in the lag; sync and quorum lose none", () => {
  const run = (replication) => runAll(E.create(dbc({ replicasPerShard: 2, replication }), { profile: "load", targetRps: 1000, readRatio: 0.5, seed: 3 },
    { scenario: { id: "t", settings: {}, events: [{ t: 90, type: "primaryFail", target: "db", shard: 0 }], goals: [] } }));
  const a = run("async"), s = run("sync"), q = run("quorum");
  const lag = a.series.repLag[89];
  assert(a.stats().lostWrites > 10, "async lost " + a.stats().lostWrites);
  near(a.stats().lostWrites, 500 * lag, 0.3, "lost ≈ write rate × lag");
  assert(s.stats().lostWrites === 0 && q.stats().lostWrites === 0, "sync/quorum lost writes");
  assert(s.stats().p99Write > a.stats().p99Write && q.stats().p99Write > a.stats().p99Write, "replication should add write latency");
});

test("DB cluster: a slow follower hurts sync more than quorum", () => {
  const run = (replication) => runFor(E.create(dbc({ replicasPerShard: 2, replication }), { profile: "load", targetRps: 500, readRatio: 0.5, seed: 4 },
    { scenario: { id: "t", settings: {}, events: [{ t: 10, type: "slow", target: "db", factor: 20, durationS: 200 }], goals: [] } }), 60);
  const s = run("sync").windowPercentiles(), q = run("quorum").windowPercentiles();
  assert(s.p99 > 2 * q.p99, `sync p99 ${s.p99} vs quorum ${q.p99}`);
});

test("DB cluster: stale reads only with lagging followers serving reads", () => {
  const st = (p) => runAll(E.create(dbc(p), { profile: "load", targetRps: 1500, readRatio: 0.5, seed: 5 })).stats().staleReads;
  assert(st({ replication: "async" }) > 0, "async reads from followers should be stale sometimes");
  assert(st({ replication: "async", readsFrom: "primary" }) === 0, "primary reads are never stale");
  assert(st({ replication: "quorum", replicasPerShard: 1 }) === 0, "a quorum of 1 follower has no lagging follower");
});

test("DB cluster runs are deterministic with a seed", () => {
  const sc = SC.get("db-failover");
  const run = () => runAll(E.create(sc.design, { ...sc.settings, chaos: "high" }, { scenario: sc }));
  const a = run(), b = run();
  assert(JSON.stringify(a.series) === JSON.stringify(b.series) && JSON.stringify(a.log) === JSON.stringify(b.log) && a.stats().lostWrites === b.stats().lostWrites, "runs differ");
});

console.log("scenarios");
const goalsOK = [];
SC.LIST.forEach((sc) => {
  test(`${sc.id}: loads and runs 60 s without exceptions or NaN`, () => {
    [sc.design, sc.solution].filter(Boolean).forEach((d) => {
      const sim = runFor(E.create(d, { ...sc.settings, chaos: "high" }, { scenario: sc }), 60);
      ["offered", "served", "errRate", "cost", "backlog", "maxUtil"].forEach((k) =>
        sim.series[k].forEach((v, i) => assert(Number.isFinite(v), `${k}[${i}] = ${v}`)));
      assert(sim.bad === 0, "non-finite values inside the model");
      sim.nodes.forEach((n) => { const v = sim.nodeView(n.id); assert(Number.isFinite(v.lam) && Number.isFinite(v.W), n.id + " view"); });
      sim.report();
    });
  });
  if (!sc.goals.length) return;
  test(`${sc.id}: the initial design fails, the solution passes`, () => {
    const a = runAll(E.create(sc.design, sc.settings, { scenario: sc })).goals();
    const b = runAll(E.create(sc.solution, sc.settings, { scenario: sc })).goals();
    assert(sc.goals.length >= 2 && sc.goals.length <= 4, "2–4 goals");
    assert(sc.hints.length >= 1 && sc.hints.length <= 3, "1–3 hints");
    assert(a.some((g) => !g.pass), "initial design already passes every goal");
    const bad = b.filter((g) => !g.pass).map((g) => `${g.goal.metric} ${g.goal.op} ${g.goal.value} (got ${g.value})`);
    assert(!bad.length, "solution fails: " + bad.join(", "));
    goalsOK.push(sc.id);
  });
});

test("all scenario ids of the course are implemented", () => {
  const ids = ["blank", "monolith", "scale-out", "read-heavy-cache", "cdn-static", "db-replicas", "sharding", "async-queue", "event-fanout",
    "cascading-failure", "retry-storm", "rate-limiter", "multi-region", "serverless-burst", "flash-sale", "url-shortener", "news-feed", "chat",
    "ride-sharing", "video-streaming", "notification-system", "payment-system", "search-autocomplete", "ai-assistant", "observability-stack",
    "microservices", "k8s-node-failure", "db-failover"];
  ids.forEach((id) => assert(SC.get(id), "missing " + id));
  SC.LIST.forEach((s) => assert(s.title.en && s.title.pt && s.brief.en && s.brief.pt, s.id + " texts"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
