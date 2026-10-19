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
    "ride-sharing", "video-streaming", "notification-system", "payment-system", "search-autocomplete", "ai-assistant", "observability-stack"];
  ids.forEach((id) => assert(SC.get(id), "missing " + id));
  SC.LIST.forEach((s) => assert(s.title.en && s.title.pt && s.brief.en && s.brief.pt, s.id + " texts"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
