import { load, test, eq, ok } from "./lib.mjs";

const P = load("cap");
const run = (st, ms, traffic) => { for (let i = 0; i < ms / P.DT; i++) P.tick(st, traffic); };

test("CP without a partition: every write pays the ocean round trip (EC)", () => {
  const st = P.create({ mode: "CP", rtt: 180 });
  P.request(st, "sp", "hold"); run(st, 400);
  P.request(st, "lis", "hold"); run(st, 400);
  eq(st.stats.wOk, 2, "both holds confirmed");
  console.log(`       CP write latency: São Paulo ${st.last.sp.lat} ms, Lisbon ${st.last.lis.lat} ms`);
  ok(st.last.sp.lat >= 180 && st.last.lis.lat >= 180, `latencies ${st.last.sp.lat}, ${st.last.lis.lat}`);
  eq([P.seats(st, "sp"), P.seats(st, "lis")], [98, 98], "both copies agree");
  P.request(st, "lis", "read");
  eq(st.stats.rStale, 0, "no stale read");
});

test("AP without a partition: fast writes, but a read on the other side right after is stale (EL)", () => {
  const st = P.create({ mode: "AP", rtt: 180 });
  P.request(st, "sp", "hold");
  eq(st.last.sp.lat, 4, "answered from the local copy");
  run(st, 45);
  P.request(st, "lis", "read");
  eq(st.stats.rStale, 1, "Lisbon has not heard yet");
  run(st, 90);
  P.request(st, "lis", "read");
  eq(st.stats.rStale, 1, "after one-way delay, fresh");
  eq(P.seats(st, "lis"), 99, "replicated");
});

test("CP with a partition: Lisbon (no leader) refuses, São Paulo serves, nothing to reconcile", () => {
  const st = P.create({ mode: "CP" });
  P.setPartition(st, true);
  P.request(st, "lis", "hold"); P.request(st, "lis", "read");
  P.request(st, "sp", "hold"); P.request(st, "sp", "hold");
  eq(st.stats.wErr + st.stats.rErr, 2, "Lisbon's two requests refused");
  eq(st.stats.wOk, 2, "São Paulo's holds confirmed");
  P.setPartition(st, false); run(st, 300);
  eq([P.seats(st, "sp"), P.seats(st, "lis"), st.lost.length], [98, 98, 0], "Lisbon caught up, no loss");
});

test("AP with a partition: both accept, values diverge, last-write-wins drops confirmed holds", () => {
  const st = P.create({ mode: "AP" });
  P.setPartition(st, true);
  P.request(st, "sp", "hold"); P.request(st, "sp", "hold"); run(st, 300);
  P.request(st, "lis", "hold"); run(st, 300);
  eq([P.seats(st, "sp"), P.seats(st, "lis"), st.stats.wErr], [98, 99, 0], "diverged, no errors");
  P.setPartition(st, false); run(st, 300);
  eq(P.seats(st, "sp"), P.seats(st, "lis"), "converged");
  eq(P.seats(st, "sp"), 99, "Lisbon's later write won");
  eq(st.lost.length, 2, "São Paulo's two confirmed holds lost");
  eq(st.confirmed.length, 3, "three fans were told 'held'");
});

test("the page's numbers: 30 s of random traffic with a 10 s partition", () => {
  const out = {};
  for (const mode of ["CP", "AP"]) {
    const st = P.create({ mode, rtt: 180, seed: 7 });
    run(st, 10000, true); P.setPartition(st, true); run(st, 10000, true); P.setPartition(st, false); run(st, 10000, true);
    out[mode] = { lat: Math.round(P.avgWrite(st)), err: st.stats.wErr + st.stats.rErr, stale: st.stats.rStale, reads: st.stats.rOk, lost: st.lost.length, holds: st.stats.wOk };
    console.log(`       ${mode}: avg write ${out[mode].lat} ms, refused ${out[mode].err}, stale ${out[mode].stale}/${out[mode].reads}, holds ${out[mode].holds}, lost ${out[mode].lost}`);
  }
  ok(out.CP.lat > 100 && out.AP.lat < 10, "EC pays the RTT, EL does not");
  ok(out.CP.err > 0 && out.AP.err === 0, "CP refuses during the partition, AP never");
  ok(out.CP.lost === 0 && out.CP.stale === 0, "CP never stale, never loses");
  ok(out.AP.lost > 0 && out.AP.stale > 0, "AP is stale and loses holds");
});
