import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, near, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("rag-hybrid");
const page = readFileSync(path.join(ROOT, "docs/2027.1/classes/ai-systems/rag-memory/index.md"), "utf8");
const S = o => M.search(Object.assign({ k: 5, min: 0, ctx: false }, o));

test("RRF with k = 60, as the page computes it", () => {
  ok(/k = 60/.test(page), "the page uses k = 60");
  eq(M.RRF_K, 60, "RRF_K");
  near(M.rrf([1, 3]), 0.0323, 0.00005, "1st by keywords and 3rd by vectors");
  near(M.rrf([1]), 0.0164, 0.00005, "1st by vectors only");
  ok(page.includes("1/61 + 1/63 ≈ 0.0323") && page.includes("1/61 ≈ 0.0164"), "the page's worked example");
});

test("chunks cost ~400 tokens each: 5 chunks = +2,000 tokens, the page's latency table", () => {
  ok(page.includes("5 chunks × ~400 tokens") && page.includes("+2,000 input tokens"), "the latency table");
  eq(S({ question: "sector", mode: "vector" }).tokens, 2000, "k = 5");
});

test("sector C: vector search ranks another venue's rule first, hybrid puts the right chunk first", () => {
  const v = S({ question: "sector", mode: "vector" });
  eq(v.vector.slice(0, 3).map(h => h.id + h.sim), ["B0.84", "D0.83", "A0.79"], "lifts, Estádio Sul, sector C");
  eq([v.goldRank, v.verdict], [3, "misled"], "the right chunk is 3rd, behind Estádio Sul's ramps");
  const h = S({ question: "sector", mode: "hybrid", k: 1 });
  eq([h.context, h.verdict, h.tokens], [["A"], "grounded", 400], "k = 1 is enough");
  const a = h.fused.find(d => d.id === "A"), b = h.fused.find(d => d.id === "B");
  eq([a.vr, a.kr, b.vr, b.kr], [3, 1, 1, undefined], "the ranks of the page's example");
  near(a.score, 0.0323, 0.00005, "A"); near(b.score, 0.0164, 0.00005, "B");
});

test("camera: without contextual chunks Estádio Sul wins in every mode; with them, §4 does", () => {
  for (const mode of ["vector", "keyword", "hybrid"]) {
    eq(S({ question: "camera", mode }).verdict, "misled", mode + " without context");
    eq(S({ question: "camera", mode, ctx: true }).context[0], "H", mode + " with context");
  }
  const h = S({ question: "camera", mode: "hybrid" });
  near(h.fused[0].score, 0.0328, 0.00005, "J"); near(h.fused[1].score, 0.0323, 0.00005, "H");
});

test("pool: a similarity threshold turns unrelated chunks into \"I don't know\", but not the keyword half", () => {
  eq(S({ question: "pool", mode: "vector" }).verdict, "unrelated", "5 unrelated chunks");
  eq(S({ question: "pool", mode: "vector", min: 0.6 }).verdict, "nothing-ok", "nothing passes 0.60");
  const h = S({ question: "pool", mode: "hybrid", min: 0.6, ctx: true });
  eq([h.verdict, h.context.length], ["unrelated", 5], "keywords match the venue name");
  ok(Object.values(M.QUESTIONS.pool.sim.ctx).every(x => x < 0.6), "no chunk reaches 0.60");
});

test("the tips", () => {
  const v = S({ question: "sector", mode: "vector" }), h = S({ question: "sector", mode: "hybrid", k: 1 });
  const c = S({ question: "camera", mode: "vector" });
  tipHas("rag-hybrid", lang => [
    fmt(v.vector[0].sim, 2, lang), fmt(v.vector[1].sim, 2, lang), fmt(v.vector[2].sim, 2, lang),
    fmt(0.0323, 4, lang), fmt(0.0164, 4, lang), "k = 1", fmt(h.tokens, 0, lang), fmt(2000, 0, lang),
    fmt(c.vector[0].sim, 2, lang), fmt(c.vector[1].sim, 2, lang), fmt(0.6, 2, lang)
  ]);
});
