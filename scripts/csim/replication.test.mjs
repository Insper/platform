import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const R = load("replication");
const LAG = R.LAB.lag;
const secs = (ms, lang) => fmt(ms / 1000, ms % 1000 ? 1 : 0, lang) + " s";

test("async: a follower read right after a write is stale while lag > 0, fresh after the lag", () => {
  const st = R.scenario({ mode: "async" });
  const r = R.read(st);
  ok(r.stale, `read ${R.AGO} ms after the write should be stale`);
  eq(r.missing, ["A-12"], "missing");
  R.advance(st, LAG * R.FACTOR[2]);               // both followers have it after the slower one's lag
  ok(!R.read(st).stale && !R.read(st).stale, "after the lag both followers are fresh");
});

test("with lag 0 a read right after a write is fresh", () => {
  const st = R.create({ mode: "async", lag: 0 });
  R.write(st);
  ok(!R.read(st).stale && !R.read(st).stale, "no lag, no stale read");
});

test("read-your-writes routes the reads after a write to the leader", () => {
  const st = R.scenario({ mode: "async", ryw: true });
  const r = R.read(st);
  ok(!r.stale && r.node === st.leader && r.why === "ryw", "read went to the leader, fresh");
  R.advance(st, R.RYW_WINDOW);
  eq(R.read(st).why, "replica", "after the window, reads go back to the replicas");
});

const lat = mode => R.write(R.create({ mode })).latency;
const [A, M, S] = ["async", "semi", "sync"].map(lat);

test("write latency: async = flush, semi-sync waits for one follower, sync for the slowest", () => {
  console.log(`       lag ${LAG} ms: async ${A} ms, semi-sync ${M} ms, sync ${S} ms`);
  ok(A < 10 && M > LAG * R.FACTOR[1] && S > LAG * R.FACTOR[2], "sync waits for the slowest follower");
});

test("semi-sync: the sync follower is always fresh, the async one can be stale", () => {
  const st = R.create({ mode: "semi" });
  R.write(st);
  const first = R.read(st), second = R.read(st);   // round robin: db-2 (sync), then db-3
  ok(!first.stale && second.stale, `db-2 fresh (${first.stale}), db-3 stale (${second.stale})`);
});

const lost = mode => R.crash(R.scenario({ mode })).lost;

test("crashing the leader: async loses the writes in flight, semi-sync and sync lose none", () => {
  console.log(`       crash at the starting point: async lost ${lost("async").join(", ")}`);
  eq(lost("async"), ["A-12"], "async loses the hold not yet replicated");
  eq(lost("semi"), [], "semi-sync loses nothing");
  eq(lost("sync"), [], "sync loses nothing");
});

test("failover promotes the most up-to-date follower and keeps a consistent log", () => {
  const st = R.create({ mode: "async" });
  R.write(st); R.advance(st, LAG * R.FACTOR[1] + 100); R.write(st); R.advance(st, 100);
  // db-2 has A-10; db-3 (slower) has nothing
  const r = R.crash(st);
  eq([r.to, r.lost], [1, ["A-11"]], "db-2 promoted, A-11 lost");
  R.advance(st, 2 * LAG);
  eq(R.read(st).seen, ["A-10"], "db-3 now follows db-2");
  ok(R.crash(st) && R.crash(st) === null, "no follower left to promote");
});

test("the tip quotes the model's numbers", () => {
  tipHas("replication", lang => {
    const en = lang === "en", f = x => fmt(x, 0, lang) + " ms";
    return [
      (en ? "held A-12 " : "segurou A-12 há ") + R.AGO + " ms",
      (en ? "the lag is " : "o atraso é de ") + secs(LAG, lang),
      "REPLICA_DELAY=" + LAG / 1000 + "s",
      en ? `${secs(LAG * R.FACTOR[1], lang)} for db-2, ${secs(LAG * R.FACTOR[2], lang)} for db-3`
         : `${secs(LAG * R.FACTOR[1], lang)} para db-2, ${secs(LAG * R.FACTOR[2], lang)} para db-3`,
      en ? `*async* commits in ${f(A)}, *semi-sync* in ${f(M)}, *sync* in ${f(S)}`
         : `*async* confirma em ${f(A)}, *semi-sync* em ${f(M)}, *sync* em ${f(S)}`,
      (en ? "db-2 is promoted without it" : "db-2 é promovido sem ela")
    ];
  });
  eq(lost("async").length, 1, "the tip says the hold (one) is lost");
});
