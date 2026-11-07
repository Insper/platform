import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("retry-topics");
const L = M.LAB;
const run = (strategy, failure, classify = true) => M.outcome({ strategy, failure, classify });
const page = readFileSync(path.join(ROOT, "docs/2027.1/classes/messaging/semantics/index.md"), "utf8");
const s = (ms, lang) => fmt(ms / 1000, ms % 1000 ? (ms % 100 ? 2 : 1) : 0, lang) + " s";

test("the blocking backoff is lab 7's: 0.5 s, 1 s, 2 s, then the DLT (3.5 s, as the class says)", () => {
  eq([1, 2, 3].map(M.backoff), [500, 1000, 2000], "backoffs");
  eq(L.retries, 3, "retries");
  ok(page.includes("0.5 s, 1 s, 2 s"), "the page quotes the lab's backoff");
  eq(run("blocking", "transient").stall, 3500, "the partition waits 0.5 + 1 + 2 s");
});

test("the retry topics are the page's @RetryableTopic: 1 s, 4 s, 16 s", () => {
  eq(M.TOPIC_DELAYS, [1000, 4000, 16000], "delays");
  ok(page.includes('attempts = "4"') && page.includes("// 1 s, 4 s, 16 s"), "the page's annotation");
});

test("blocking keeps the order of the key and stalls the partition", () => {
  const r = run("blocking", "transient");
  console.log(`       blocking, transient: ${JSON.stringify(r)}`);
  eq([r.route, r.attempts, r.reordered], ["ok", 4, false], "succeeds at the last retry, in order");
  ok(r.maxLag >= 8, "lag builds behind it");
});

test("retry topics never stall the partition, and the later event of the key overtakes", () => {
  const r = run("topics", "transient");
  console.log(`       topics, transient: ${JSON.stringify(r)}`);
  eq([r.stall, r.maxLag, r.reordered], [0, 1, true], "no stall, reordered");
  ok(r.lead > 4000, "cancelled long before confirmed");
});

test("a poison record: bounded retries end in the DLT, forever never ends, classification skips the wait", () => {
  eq(run("blocking", "poison", false).route, "dlt", "blocking → DLT");
  eq(run("topics", "poison", false).badDone, 4050 + 1050 + 4050 + 16050, "topics → DLT after 1 + 4 + 16 s");
  const f = run("forever", "poison", false);
  eq([f.route, f.lagEnd], [null, (M.HORIZON - M.BAD * M.EVERY) / M.EVERY + 1], "stuck, lag grows");
  for (const st of ["blocking", "topics", "forever"]) eq([run(st, "poison").route, run(st, "poison").stall, run(st, "poison").attempts], ["dlt", 0, 1], st + " with classification");
});

test("the tip's numbers come from the model", () => {
  const b = run("blocking", "transient"), t = run("topics", "transient");
  const bp = run("blocking", "poison", false), tp = run("topics", "poison", false), fp = run("forever", "poison", false);
  tipHas("retry-topics", lang => lang === "en"
    ? [`succeeds at attempt ${b.attempts}`, `stops for ${s(b.stall, lang)}`, `peaks at ${b.maxLag} records`, `(max lag ${t.maxLag})`,
       `${s(t.lead, lang)} before OrderConfirmed`, `stops the partition ${s(bp.stall, lang)} before the DLT`,
       `park it ${s(tp.badDone - M.BAD * M.EVERY, lang)}`, `${fp.lagEnd} records wait after 30 s`]
    : [`dá certo na tentativa ${b.attempts}`, `para por ${s(b.stall, lang)}`, `chega a ${b.maxLag} registros`, `(atraso máximo ${t.maxLag})`,
       `${s(t.lead, lang)} antes de OrderConfirmed`, `para a partição ${s(bp.stall, lang)} antes da DLT`,
       `o estacionam ${s(tp.badDone - M.BAD * M.EVERY, lang)}`, `${fp.lagEnd} registros esperam depois de 30 s`]);
});
