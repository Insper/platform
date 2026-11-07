import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, near, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("agent-loop");
const CLASS = "docs/2027.1/classes/ai-systems/";
const read = f => readFileSync(path.join(ROOT, CLASS, f), "utf8");
const run = o => M.run(Object.assign({ maxSteps: 8, hit: 0.9, parallel: true }, o));

test("the cost constants are the overview's python table", () => {
  const py = read("index.md");
  const grab = re => { const m = py.match(re); ok(m, "not found: " + re); return m.slice(1).map(Number); };
  eq(grab(/PRICE_IN, PRICE_OUT = ([\d.]+), ([\d.]+)/), [M.PRICE_IN, M.PRICE_OUT], "prices");
  eq(grab(/CACHED = ([\d.]+)/), [M.CACHED], "cached share");
  ok(/SYSTEM, USER = 3_000, 60/.test(py) && M.SYSTEM === 3000 && M.USER === 60, "prefix and user message");
  ok(/STEP_OUT, TOOL_OUT, FINAL_OUT = 80, 700, 250/.test(py) && M.STEP_OUT === 80 && M.TOOL_OUT === 700 && M.FINAL_OUT === 250, "tokens per step");
  ok(/TTFT0, PREFILL_1K, TPOT, TOOL_S = 0\.30, 0\.08, 0\.02, 0\.15/.test(py) && M.TTFT0 === 0.3 && M.PREFILL_1K === 0.08 && M.TPOT === 0.02 && M.TOOL_S === 0.15, "timings");
});

test("the step and token limits are the agents page's sketch", () => {
  const page = read("agents/index.md");
  ok(page.includes(`MAX_STEPS, MAX_TOKENS = ${M.MAX_STEPS}, 40_000`) && M.MAX_TOKENS === 40000, "MAX_STEPS, MAX_TOKENS = 8, 40_000");
});

test("the model that finds the seats reproduces the overview's table (4 calls, 5 without parallel calls)", () => {
  const p = run({ behaviour: "finds" });
  eq([p.stop, p.calls, p.tokens], ["answer", 4, 16920], "4 calls");
  eq([0, 0.5, 0.9].map(hit => (run({ behaviour: "finds", hit }).cost * 1000).toFixed(2)), ["58.11", "38.51", "22.83"], "US$ / 1k at 0/50/90 %");
  near(p.wait, 6.8, 0.05, "first answer token (90 %)");
  near(p.full, 11.8, 0.05, "full answer (90 %)");
  const s = run({ behaviour: "finds", parallel: false });
  eq([s.calls, s.tokens, (s.cost * 1000).toFixed(2)], [5, 23100, "29.44"], "sequential: one more round");
  near(s.wait - p.wait, 2, 0.2, "parallel calls save ≈ 2 s (the page's trace)");
  ok(p.held && p.tools.join() === "search_events,search_seats,search_seats,hold_seats", "the hold happened");
});

test("the stuck model: step limit, token budget, loop detection, a tool-less last call", () => {
  const st = run({ behaviour: "stuck" });
  eq([st.stop, st.calls, st.tokens], ["steps", 8, 46320], "MAX_STEPS = 8");
  const big = run({ behaviour: "stuck", maxSteps: 12 });
  eq([big.stop, big.calls], ["tokens", 8], "MAX_STEPS = 12: the token budget stops it at the same call");
  ok(big.used > M.MAX_TOKENS && run({ behaviour: "stuck", maxSteps: 7 }).used < M.MAX_TOKENS, "40,000 is crossed at call 8");
  const lp = run({ behaviour: "stuck", loopDetect: true });
  eq([lp.stop, lp.calls, lp.tokens], ["loop", 3, 11520], "the repeated search is caught at call 3");
  eq(lp.tools, ["search_events", "search_seats"], "the repeated call is not run");
  const last = run({ behaviour: "stuck", lastToolless: true });
  eq([last.stop, last.partial, last.held], ["answer", true, false], "a forced, partial answer");
});

test("the tips", () => {
  const p = run({ behaviour: "finds" }), s = run({ behaviour: "finds", parallel: false });
  const st = run({ behaviour: "stuck" }), lp = run({ behaviour: "stuck", loopDetect: true });
  tipHas("agent-loop", lang => [
    `${p.calls} `, fmt(p.tokens, 0, lang), fmt(p.cost * 1000, 2, lang), fmt(p.wait, 1, lang) + " s",
    `${s.calls} `, fmt(s.cost * 1000, 2, lang), fmt(s.wait, 1, lang) + " s",
    fmt(st.tokens, 0, lang), fmt(lp.tokens, 0, lang), lang === "en" ? `call ${lp.calls}` : `chamada ${lp.calls}`
  ]);
});
