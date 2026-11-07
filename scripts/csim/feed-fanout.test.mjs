import { load, test, eq, ok, near, tipHas, fmt } from "./lib.mjs";

const F = load("feed-fanout");
const run = (strategy, workers, threshold = 100000) => F.simulate({ strategy, workers, threshold });

test("the steady load is the page's estimate: 230 posts/s × 200 followers", () => {
  eq(F.baseRate("push"), 46000, "push inserts/s");
  eq(F.baseRate("pull"), 0, "pull inserts/s");
  near(F.baseRate("hybrid", 100000), 46000 * (1 - 0.839), 1e-6, "hybrid removes the table's share");
});

test("push: the celebrity post delays every ordinary post behind it (FIFO)", () => {
  const r = run("push", 20);
  console.log(`       push/20: peak ${r.peak}, worst delay ${r.worstDelay} s, clears in ${r.clear.toFixed(0)} s`);
  eq([r.peak, r.worstDelay, Math.round(r.clear)], [50e6, 500, 926], "peak, delay, clear");
  const after = r.series.find(x => x.t === F.BIG_AT + 10 * 60);
  ok(after.backlog > 0, "still a backlog ten minutes later");
  eq(r.series[r.series.length - 1].backlog, 0, "cleared by the end");
});

test("fewer workers: longer delay, hours to clear; below the average it never keeps up", () => {
  const r = run("push", 10);
  eq([r.worstDelay, Math.round(r.clear)], [1000, 12500], "10 workers");
  const r9 = run("push", 9);
  ok(!isFinite(r9.clear) && F.capacity(9) < F.baseRate("push"), "9 workers cannot keep up");
});

test("hybrid and pull move the cost to the read", () => {
  const h = run("hybrid", 20), p = run("pull", 20);
  eq([h.peak, h.worstDelay, h.reads, h.reads * F.PEAK_OPENS], [0, 0, 10, 350000], "hybrid");
  eq([p.peak, p.reads, p.reads * F.PEAK_OPENS], [0, 200, 7000000], "pull");
  ok(F.readsPerOpen("hybrid", 10000) > F.readsPerOpen("hybrid", 1000000), "a lower threshold means more pulled sources");
});

test("the tip quotes the model's numbers", () => {
  const push = run("push", 20), p10 = run("push", 10), h = run("hybrid", 20), pl = run("pull", 20);
  tipHas("feed-fanout", lang => [
    fmt(push.worstDelay, 0, lang) + " s", fmt(Math.round(push.clear), 0, lang) + " s",
    fmt(p10.worstDelay, 0, lang) + " s", fmt(Math.round(p10.clear), 0, lang) + " s",
    fmt(Math.round(h.rate), 0, lang), fmt(h.reads, 0, lang), fmt(h.reads * F.PEAK_OPENS, 0, lang),
    fmt(pl.reads, 0, lang), fmt(pl.reads * F.PEAK_OPENS, 0, lang), "84%"
  ]);
});
