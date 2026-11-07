import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const M = load("probe-cascade");
const run = (readiness, liveness, failover) => M.run({ readiness, liveness, failover });
const pc = (v, lang) => fmt(100 * v, v === 1 ? 0 : 1, lang) + "%";

test("the page's probes: readiness 5 s × 2 failures, liveness 10 s × 3", () => {
  eq([M.READY.period, M.READY.failures, M.LIVE.period, M.LIVE.failures], [5, 2, 10, 3], "the Deployment excerpt of the page");
});

test("deep readiness, 20 s failover: every pod leaves the Service at once; Redis-only reads fail too", () => {
  const r = run("deep", "shallow", 20);
  const out = r.events.filter(e => e.kind === "unready").map(e => e.t);
  console.log(`       unready at ${out.join(", ")} s; no ready pod for ${r.noReady} s; GET /events ${(100 * r.availEvents).toFixed(1)}%`);
  eq(out.length, M.PODS, "all pods");
  ok(Math.max(...out) - M.AT <= 8, "within 8 s of the failover");
  eq(r.restarts, 0, "no restart");
  tipHas("probe-cascade", lang => [`${r.noReady} s`, pc(r.availEvents, lang), lang === "en" ? "within 8 s" : "em até 8 s"]);
});

test("shallow probes: only the route that needs the database fails", () => {
  const r = run("shallow", "shallow", 20);
  console.log(`       GET /events ${(100 * r.availEvents).toFixed(1)}%, POST /orders ${(100 * r.availOrders).toFixed(1)}%`);
  eq(r.noReady, 0, "no pod leaves");
  eq(r.availEvents, 1, "reads keep working");
  tipHas("probe-cascade", lang => [pc(r.availOrders, lang), pc(r.availEvents, lang)]);
});

test("deep liveness: no restart for 20 s (3 × 10 s > 20 s); a restart storm for 60 s", () => {
  eq(run("shallow", "deep", 20).restarts, 0, "20 s is shorter than three failures");
  const r = run("shallow", "deep", 60);
  const back = r.events.find(e => e.kind === "ready").t, dbBack = M.AT + 60;
  console.log(`       60 s: ${r.restarts} restarts, no ready pod for ${r.noReady} s, first pod ready at ${back} s (${back - dbBack} s after the database)`);
  eq(r.restarts, M.PODS, "every pod restarts");
  ok(r.noReady > 60, "longer than the failover");
  tipHas("probe-cascade", lang => [`**${r.restarts}**`, `${r.noReady} s`, `${back - dbBack} s`].map(s => s.replace(/\*\*/g, "")));
});
