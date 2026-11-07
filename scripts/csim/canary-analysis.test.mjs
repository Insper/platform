import { load, test, eq, ok, near, tipHas, fmt } from "./lib.mjs";

const M = load("canary-analysis");
const L = M.LAB;
const vals = r => r.meas.map(m => (m.err === null ? "[]" : m.err.toFixed(3)));

test("replica counts: with 2 replicas, 25% is 1 canary next to 2 stable (a third), 50% is 1 and 1", () => {
  eq(M.pods(L.weight1), { canary: 1, stable: 2, share: 1 / 3 }, "setWeight 25");
  eq(M.pods(L.weight2), { canary: 1, stable: 1, share: 0.5 }, "setWeight 50");
});

test("the lab's bad release (0.3): [] then two failures, aborted at the third measurement, ~a minute after traffic", () => {
  const r = M.run({ chaos: L.chaos, rate: L.startRate });
  const lived = L.startRate * r.abortAt;
  console.log(`       measurements ${vals(r).join(", ")}; aborted at ${r.abortAt} s; ${r.fan.err.toFixed(0)} failed requests (${(100 * r.fan.err / lived).toFixed(0)}% of ${lived})`);
  eq(r.status, "Degraded", "aborted");
  eq(vals(r)[0], "[]", "the first measurement is empty, as in the test run");
  eq(r.meas.length, L.failureLimit + 2, "failed (2) > failureLimit (1) at the third measurement");
  near(r.meas[2].err, 0.285, 0.01, "the test run's third value");
  tipHas("canary-analysis", lang => [vals(r).slice(1).join(" and ").replace(/^/, "`").replace(/ and /, "` " + (lang === "en" ? "and" : "e") + " `") + "`",
    `${r.abortAt} s`, `${Math.round(r.fan.err)}`, fmt(100 * r.fan.err / lived, 0, lang) + "%"].map(s => s.replace(/`/g, "")));
});

test("a good release: no 500 series, every result [], promoted after the two pauses", () => {
  const r = M.run({ chaos: 0, rate: L.startRate });
  console.log(`       ${vals(r).join(" ")} → ${r.status} at ${r.promotedAt} s`);
  ok(vals(r).every(v => v === "[]"), "all empty");
  eq(r.promotedAt, 2 * L.pause, "after 2 × 2 min");
  tipHas("canary-analysis", () => [`${r.promotedAt} s`]);
});

test("rarer errors fail later; errors under the threshold pass; no traffic passes everything", () => {
  const r2 = M.run({ chaos: 0.02, rate: L.startRate }), r05 = M.run({ chaos: 0.005, rate: L.startRate }), none = M.run({ chaos: L.chaos, rate: 0 });
  console.log(`       0.02: ${vals(r2).join(" ")} → aborted at ${r2.abortAt} s; 0.005: max ${Math.max(...r05.meas.map(m => m.err || 0)).toFixed(4)} → ${r05.status}; 0 req/s: ${none.status}`);
  ok(r2.abortAt > 60, "later than 0.3");
  eq(r05.status, "Healthy", "0.5% < 1%: promoted");
  eq(none.status, "Healthy", "len(result) == 0 promotes a release nobody tested");
  tipHas("canary-analysis", () => [`${r2.abortAt} s`]);
});

test("the 400 ms regression passes the canary's p99 < 0.5 s", () => {
  const r = M.run({ chaos: 0, rate: L.startRate, sleep: true });
  const p99 = r.meas.find(m => m.p99 !== null).p99;
  console.log(`       p99 ${p99} s → ${r.status}`);
  ok(p99 < L.maxP99, "under 0.5 s");
  eq(r.status, "Healthy", "promoted");
  tipHas("canary-analysis", lang => [fmt(p99, 3, lang) + " s"]);
});
