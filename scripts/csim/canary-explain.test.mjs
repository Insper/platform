import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("canary-explain");
const LAB = "docs/2027.1/hands-on/13";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");

test("the snapshots are the lab's .github/ai/canary/*.json", () => {
  for (const name of Object.keys(M.SNAPSHOTS)) eq(M.SNAPSHOTS[name], JSON.parse(read(`code/.github/ai/canary/${name}.json`)), name);
});

test("the exit codes are the script's", () => {
  const py = read("code/.github/ai/canary_explain.py");
  ok(py.includes('return {"promote": 0, "rollback": 1, "inconclusive": 2}[verdict]'), "canary_explain.py maps the verdicts to 0/1/2");
  eq(M.EXIT, { promote: 0, rollback: 1, inconclusive: 2 }, "EXIT");
});

test("5.3: the three verdict lines and exit codes are the ones the page prints", () => {
  const page = read("canary/index.md");
  const [h, r, l] = M.play(3);
  for (const x of [h, r, l]) {
    ok(page.includes(x.line + "\nexit code: " + x.exit), `the page prints "${x.line}" then "exit code: ${x.exit}"`);
  }
  eq([h.exit, r.exit, l.exit], [0, 1, 2], "promote, rollback, inconclusive");
});

test("the low-traffic rule short-circuits the others", () => {
  const rs = M.rules(M.SNAPSHOTS["low-traffic"]);
  eq(rs.map(x => x.fired), [true, null, null, null], "MIN_RPS fires, the rest are not evaluated");
});

test("the model never changes the exit code; a disagreeing or missing explanation is not shown", () => {
  const page = read("canary/index.md");
  const [, , , promote, nokey] = M.play();
  eq([promote.exit, nokey.exit], [1, 1], "exit code stays 1");
  eq(promote.expl.kept, false, "tampered prompt: discarded");
  ok(page.includes(promote.expl.text), "the page quotes the discard message");
  eq(nokey.expl.said, null, "no key: no model");
  ok(page.includes('_(no explanation: TypeError: "Could not resolve authentication method. ...")_'), "the page quotes the no-key message");
  for (const snap of Object.keys(M.SNAPSHOTS)) {
    const d = M.decide(M.SNAPSHOTS[snap]);
    for (const model of ["system", "promote", "nokey"]) eq(M.run(M.SNAPSHOTS[snap], model).exit, M.EXIT[d.verdict], `${snap} / ${model}`);
  }
});

test("the relative p99 rule ignores a day when everything is slower; a fixed ceiling does not", () => {
  const slow = M.slower(M.SNAPSHOTS.healthy, M.ONSALE);
  eq(M.decide(slow).verdict, "promote", "policy");
  eq(M.fixedCeiling(M.SNAPSHOTS.healthy), "promote", "fixed ceiling on a normal day");
  eq(M.fixedCeiling(slow), "rollback", "fixed ceiling at 10:00");
});

test("every step of the script has a caption in both languages", () => {
  M.SCRIPT.forEach((s, i) => ok(s.en && s.pt, `step ${i + 1}`));
});

test("the tips", () => {
  const [h, r, l] = M.play(3);
  const lim = M.limits(M.SNAPSHOTS.regression), slow = M.slower(M.SNAPSHOTS.healthy, M.ONSALE);
  const ms = x => String(Math.round(x * 1000)) + " ms";
  tipHas("canary-explain", lang => [
    r.reasons[0].replace(/^canary /, ""),
    ...[h, r, l].map(x => (lang === "en" ? "exit code " : "código de saída ") + x.exit),
    fmt(lim.errorRate * 100, 2, lang) + "%", lim.p99ms + " ms",
    fmt(M.SNAPSHOTS.regression.stable.error_rate * 100, 2, lang) + "%",
    ms(slow.canary.p99), ms(slow.stable.p99), String(M.FIXED_P99 * 1000) + " ms",
    "2.28x", "0.80 req/s"
  ]);
});
