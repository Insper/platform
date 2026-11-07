/* catalog-sweep: the lab twin of hands-on 2 (2027.1) — the sweep, the pool of 30, closed vs open, stress */
import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const M = load("catalog-sweep");
const at = (out, rate) => out.find(r => r.r && r.r.rate === rate && r.g);
const sweep = M.play("sweep").out, big = M.play("pool30").out;
const closed = M.play("closed").out, stress = M.play("stress").out;
const ms = x => Math.round(x);

test("the scripts replay the page's commands: sweep.sh's rates, one minute each, after a warm-up", () => {
  eq(M.rates(), [50, 100, 200, 300, 400, 500, 600], "rates of the page's sweep");
  eq(M.SCRIPTS.sweep.length, 1 + 7, "warm-up + 7 steps");
  ok(/warm-up: 30 s at RATE=50/.test(sweep[0].cmd), "the warm-up of sweep.sh");
  eq(M.stages().reduce((s, x) => s + x.secs, 0), 5 * 60 + 45, "stress.js lasts 5 min 45 s");
});

test("pool 10 has the shape of the page's example run: flat, a knee near 400, a wall at 500", () => {
  [50, 100, 200, 300].forEach(r => ok(at(sweep, r).r.p99 < 100, `p99 < 100 ms at ${r} req/s (page: 33–41 ms)`));
  [50, 100, 200, 300].forEach(r => ok(at(sweep, r).r.p99d < 10, `details' p99 < 10 ms at ${r} req/s (page: 3.9–8.5 ms)`));
  const k = at(sweep, 400).r;
  ok(k.p99 > 100 && k.p99 < 300 && k.dropped === 0, "at 400 req/s the p99 leaves the floor, nothing dropped (page: 224 ms)");
  const w = at(sweep, 500).r;
  ok(w.thr < 490 && w.p99 > 1000 && w.dropped > 0, "at 500 req/s: throughput below the offered rate, p99 in seconds, dropped iterations (page: 490, 2,056 ms, 410)");
  ok(w.p50 > 100 * at(sweep, 300).r.p50, "past the knee even the median waits");
});

test("at 600 req/s watch-metrics prints the page's line: 200 busy threads, 10 active, 190 waiting", () => {
  const g = at(sweep, 600).g;
  eq([g.threads, g.active, g.pending], [200, 10, 190], "busy_threads, db_active, db_pending");
});

test("the database, not the catalog's CPU, is the full resource (lab 3 saw db at ~670% CPU with this mix)", () => {
  const r = at(sweep, 500).r;
  ok(r.db > 0.95 && r.cpu < 0.8, `db ${Math.round(r.db * 700)}% of 700%, catalog ${Math.round(r.cpu * 100)}%`);
});

test("pool 30: the knee does not move; details stop queueing behind listings, listings get slower", () => {
  const a = at(sweep, 400).r, b = at(big, 400).r, w = at(big, 500).r;
  ok(w.thr < 490 && w.p99 > 1000, "still a wall at 500 req/s");
  ok(Math.abs(w.thr - at(sweep, 500).r.thr) < 10, "the same throughput as with 10 connections");
  ok(b.p99d < a.p99d / 4, "details' p99 at 400 falls");
  ok(b.p99l > a.p99l, "listings' p99 at 400 rises");
  const g = at(big, 600).g;
  eq([g.threads, g.active, g.pending], [200, 30, 170], "busy_threads, db_active, db_pending at 600 with 30 connections");
});

test("closed vs open: the closed model hides the overload the open one shows", () => {
  const c = closed[0].r, o = closed[1].r;
  ok(c.p99 < 300 && o.p99 > 1000 && closed[1].r.dropped > 0, "closed p99 inside the target, open p99 in seconds");
  ok(Math.abs(c.thr - o.thr) < 15, "both serve about the same throughput: the capacity");
});

test("stress: past the knee and back — the catalog recovers by itself", () => {
  const lastStep = stress[stress.length - 1];
  ok(lastStep.rec !== null && lastStep.rec < 30, "p99 back under 300 ms within 30 s of the drop");
  ok(stress.some(r => r.out[0].includes("dropped") && /dropped [1-9]/.test(r.out[0])), "k6 drops iterations at the peak");
});

const s4 = k => at(sweep, k).r, s6 = k => at(big, k).r;
test("the tip quotes the model's numbers", () => {
  tipHas("catalog-sweep", lang => [
    fmt(ms(s4(300).p99), 0, lang) + " ms", fmt(ms(s4(400).p99), 0, lang) + " ms", fmt(ms(s4(500).p99), 0, lang) + " ms",
    fmt(Math.round(s4(500).thr), 0, lang) + " req/s", fmt(s4(500).dropped, 0, lang),
    fmt(ms(s4(400).p99d), 0, lang) + " ms", fmt(ms(s6(400).p99d), 0, lang) + " ms",
    fmt(ms(s4(400).p99l), 0, lang) + " ms", fmt(ms(s6(400).p99l), 0, lang) + " ms",
    fmt(Math.round(s6(500).thr), 0, lang) + " req/s",
    fmt(ms(closed[0].r.p99), 0, lang) + " ms", fmt(ms(closed[1].r.p99), 0, lang) + " ms", fmt(closed[1].r.dropped, 0, lang),
    String(stress[stress.length - 1].rec) + " s", String(M.CLOSED_VUS) + " VUs",
    Math.round(s4(600).db * 700) + "%", Math.round(s4(600).cpu * 100) + "%"
  ]);
});

if (process.env.SHOW) {
  console.log({ p300: ms(s4(300).p99), p400: ms(s4(400).p99), p500: ms(s4(500).p99), thr500: Math.round(s4(500).thr), drop500: s4(500).dropped,
    det400: ms(s4(400).p99d), det400b: ms(s6(400).p99d), list400: ms(s4(400).p99l), list400b: ms(s6(400).p99l), thr500b: Math.round(s6(500).thr), p500b: ms(s6(500).p99),
    db500: Math.round(s4(500).db * 700), cpu500: Math.round(s4(500).cpu * 100), closedThr: Math.round(closed[0].r.thr), closedP99: ms(closed[0].r.p99),
    openP99: ms(closed[1].r.p99), openDrop: closed[1].r.dropped, rec: stress[stress.length - 1].rec });
}
