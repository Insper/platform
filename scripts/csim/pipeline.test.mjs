import { load, test, eq, ok, tipHas } from "./lib.mjs";

const P = load("pipeline");
const byJob = (p, id) => p.runs.filter(r => r.job === id);

test("a job starts when the last job it needs finishes", () => {
  const p = P.plan({});
  eq(byJob(p, "integ")[0].start, byJob(p, "build")[0].end, "integration tests wait for the build");
  const needs = ["unit", "lint", "integ"].map(id => Math.max(...byJob(p, id).map(r => r.end)));
  eq(byJob(p, "image")[0].start, Math.max(...needs), "image waits for the slowest of its needs");
});

test("wall-clock time is the critical path, runner minutes are the sum", () => {
  const p = P.plan({});
  const sum = p.runs.reduce((a, r) => a + (r.end - r.start), 0);
  eq(p.minutes, sum, "runner minutes");
  eq(p.critical, ["build", "integ", "image", "deploy"], "critical path");
  const path = p.critical.reduce((a, id) => a + byJob(p, id)[0].end - byJob(p, id)[0].start, 0);
  eq(p.wall, path, "wall-clock = length of the critical path");
  ok(p.wall < p.minutes, "parallel jobs make the clock shorter than the minutes");
});

test("the matrix adds runner minutes, not wall-clock time", () => {
  const one = P.plan({ matrix: 1 }), three = P.plan({ matrix: 3 });
  eq(byJob(three, "unit").map(r => r.java), [17, 21, 25], "Java versions");
  eq(three.wall, one.wall, "same wall-clock");
  eq(three.minutes - one.minutes, 2 * P.JOBS.find(j => j.id === "unit").dur, "two more unit-test runs");
});

test("the cache shortens the build and the whole run", () => {
  const off = P.plan({}), on = P.plan({ cache: true });
  const saved = byJob(off, "build")[0].end - byJob(on, "build")[0].end;
  ok(saved > 0, "the build is shorter");
  eq(off.wall - on.wall, saved, "the build is on the critical path: every minute saved counts");
});

test("a failed job skips the jobs that need it; independent jobs still run", () => {
  const p = P.plan({ fail: "unit" });
  eq(byJob(p, "unit")[0].status, "failure", "unit tests fail");
  eq(byJob(p, "lint")[0].status, "success", "lint does not need unit tests");
  eq(byJob(p, "integ")[0].status, "success", "integration tests do not need unit tests");
  eq(byJob(p, "image")[0].status, "skipped", "image needs unit tests");
  eq(byJob(p, "deploy")[0].status, "skipped", "deploy needs image (indirectly unit tests)");
  eq(byJob(p, "image")[0].decided, byJob(p, "integ")[0].end, "image is decided when its last need finishes");
  const b = P.plan({ fail: "build" });
  ok(b.runs.filter(r => r.job !== "build").every(r => r.status === "skipped"), "a failed build skips everything");
});

test("the state over time: runners busy and minutes used", () => {
  const p = P.plan({ matrix: 3 });
  const a = P.at(p, 7);
  eq(a.busy, 4, "three unit-test legs and the integration tests run at minute 7");
  eq(P.at(p, p.wall).used, p.minutes, "at the end the used minutes are the total");
  eq(P.at(p, 0).used, 0, "nothing used at t = 0");
  const ev = P.events(P.plan({ fail: "unit" }));
  ok(ev.findIndex(e => e.kind === "failure") < ev.findIndex(e => e.kind === "skipped"), "skips come after the failure");
});

test("the tip's guided experiment", () => {
  const steps = [P.plan({}), P.plan({ matrix: 3 }), P.plan({ matrix: 3, cache: true }), P.plan({ matrix: 3, cache: true, fail: "unit" })];
  console.log("       " + steps.map(p => `${p.wall} min / ${p.minutes} runner min`).join(" → "));
  tipHas("pipeline", lang => {
    const m = lang === "pt" ? " minutos de runner" : " runner minutes";
    return [
      steps[0].wall + " min", steps[0].minutes + m,
      steps[1].minutes + m,
      steps[2].wall + " min", steps[2].minutes + m,
      steps[3].wall + " min", steps[3].minutes + m
    ];
  });
});
