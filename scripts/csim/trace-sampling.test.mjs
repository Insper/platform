import { load, test, eq, ok, near, tipHas, fmt } from "./lib.mjs";

const M = load("trace-sampling");
const S = cfg => M.stats(cfg);
const pc = (v, lang) => fmt(100 * v, v > 0 && v < 0.1 ? 1 : 0, lang) + "%";
const gb = (v, lang) => (v >= 100 ? fmt(Math.round(v), 0, lang) : fmt(v, 1, lang)) + " GB";

test("storage matches the page's table: 691.2, 69.1 and 6.9 GB/day, tail 54.3 GB/day", () => {
  const all = S({ head: 1, tail: "off" }), h10 = S({ head: 0.1, tail: "off" }), h1 = S({ head: 0.01, tail: "off" }), tail = S({ head: 1, tail: "on" });
  console.log(`       all ${all.gbDay.toFixed(1)}, head 10% ${h10.gbDay.toFixed(1)}, head 1% ${h1.gbDay.toFixed(1)}, tail ${tail.gbDay.toFixed(1)} GB/day`);
  near(all.gbDay, 691.2, 0.05, "keep everything");
  near(h10.gbDay, 69.1, 0.2, "head 10%");
  near(h1.gbDay, 6.9, 0.1, "head 1%");
  near(tail.gbDay, 54.3, 0.2, "tail: errors + slow + 5% of the rest");
  eq(tail.errors.whole, 1, "tail keeps every error trace");
  eq(tail.slow.whole, 1, "and every slow one");
  tipHas("trace-sampling", lang => [gb(tail.gbDay, lang), gb(all.gbDay, lang), pc(1, lang)]);
});

test("head first, tail second: the tail cannot rescue what the head dropped", () => {
  const h10 = S({ head: 0.1, tail: "off" }), both = S({ head: 0.1, tail: "on" });
  console.log(`       head 10%: ${h10.gbDay.toFixed(1)} GB, errors kept ${(100 * h10.errors.whole).toFixed(1)}%; + tail: ${both.gbDay.toFixed(1)} GB, errors ${(100 * both.errors.whole).toFixed(1)}%`);
  near(h10.errors.whole, 0.1, 0.005, "blind: the same share as any trace");
  eq(both.errors.whole, h10.errors.whole, "the tail keeps what reached it, no more");
  tipHas("trace-sampling", lang => [gb(h10.gbDay, lang), pc(h10.errors.whole, lang), gb(both.gbDay, lang)]);
});

test("tail sampling behind round robin decides on fragments; routing by trace id fixes it", () => {
  const rr = S({ head: 1, tail: "on", collectors: "rr3" }), lb = S({ head: 1, tail: "on", collectors: "lb3" });
  console.log(`       round robin: errors whole ${(100 * rr.errors.whole).toFixed(1)}%, slow whole ${(100 * rr.slow.whole).toFixed(1)}%, stored traces with holes ${(100 * rr.fragStored).toFixed(1)}%; by trace id: ${(100 * lb.errors.whole).toFixed(0)}%`);
  ok(rr.errors.whole < 0.5, "most error traces lose spans");
  eq(lb.errors.whole, 1, "one Collector per trace");
  eq(lb.fragStored, 0, "no holes");
  tipHas("trace-sampling", lang => [pc(rr.errors.whole, lang), pc(rr.fragStored, lang)]);
});
