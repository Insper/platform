import { load, test, eq, ok, near } from "./lib.mjs";

const Q = load("quorum");

/* run `ops` operations (write, read, read, …) and return the stats */
function run(o, ops = 3000) {
  const st = Q.create(o);
  for (let k = 1; k <= ops; k++) Q.step(st, k);
  return st.stats;
}

test("R + W > N: no read is ever stale, for every such (N, W, R)", () => {
  for (let n = 3; n <= 7; n++)
    for (let w = 1; w <= n; w++)
      for (let r = 1; r <= n; r++) {
        if (r + w <= n) continue;
        const s = run({ n, w, r, seed: n * 100 + w * 10 + r }, 600);
        eq(s.stale, 0, `N=${n} W=${w} R=${r}`);
      }
});

test("R + W ≤ N: some reads are stale, about C(N−W, R) / C(N, R) of them", () => {
  const s = run({ n: 3, w: 1, r: 1 }), reads = s.reads - s.readFail;
  const f = s.stale / reads, p = Q.pStale(3, 1, 1);
  console.log(`       N=3 W=1 R=1: ${(100 * f).toFixed(1)}% stale (formula ${(100 * p).toFixed(1)}%); with C down: formula ${(100 * Q.pStale(2, 1, 1)).toFixed(0)}%`);
  near(f, p, 0.04, "stale fraction");
  const s5 = run({ n: 5, w: 2, r: 2 });
  ok(s5.stale > 0, "N=5 W=2 R=2 has stale reads");
});

test("the page's start (N=3, W=2, R=2, C down): writes and reads succeed, nothing stale", () => {
  const s = run({ n: 3, w: 2, r: 2, down: [2] }, 300);
  eq([s.stale, s.writeFail, s.readFail], [0, 0, 0], "stale, failed writes, failed reads");
});

test("fewer than W live replicas: the write fails; fewer than R: the read fails", () => {
  const st = Q.create({ n: 3, w: 2, r: 2, down: [1, 2] });
  ok(!Q.write(st).ok && !Q.read(st).ok, "both fail with 1 of 3 alive");
  const st2 = Q.create({ n: 3, w: 3, r: 1, down: [2] });
  ok(!Q.write(st2).ok && Q.read(st2).ok, "W = 3 blocks writes with one node down, R = 1 still reads");
});

test("a replica that comes back is stale, but a quorum read still overlaps; read repair fixes it", () => {
  const st = Q.create({ n: 3, w: 2, r: 2, down: [2], repair: true });
  Q.write(st); Q.write(st);
  Q.setUp(st, 2, true);
  eq(st.versions[2], 0, "C missed the writes");
  for (let i = 0; i < 20; i++) ok(!Q.read(st).stale, "quorum read stays fresh");
  eq(st.versions[2], st.latest, "read repair brought C up to date");
});
