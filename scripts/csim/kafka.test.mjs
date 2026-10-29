import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const K = load("kafka");
const P = K.LAB.partitions, N = K.LAB.consumers;          // lab 7: order-events and NOTIFY_CONCURRENCY
const lab = { partitions: P, consumers: N, seed: 7 };
const TICKS = 200, MAXC = 8;                               // the tip's run length and the slider's maximum
const worst = st => Math.max(...st.parts.map((_, p) => K.lag(st, p)));
const hotP = K.partitionOf("ev-1", P);

test("the partitioner is Kafka's murmur2 (same values as the page's Python)", () => {
  eq([K.murmur2("o-7731"), K.murmur2("ev-1"), K.murmur2("abc")], [3414578871, 992573819, 479470107], "murmur2");
  eq([K.partitionOf("o-7731", 12), K.partitionOf("ev-1", 12)], [7, 11], "partition of 12");
});

test("range assignor: one consumer per partition, extra consumers idle", () => {
  eq(K.assign(7, [1, 2, 3]), { 1: [0, 1, 2], 2: [3, 4], 3: [5, 6] }, "7 over 3");
  const r = K.run({ ...lab, consumers: MAXC, key: "order" }, 50);
  eq(K.idle(r.st), Math.max(0, MAXC - P), `${MAXC} consumers on ${P} partitions`);
  ok(MAXC > P, "the tip's 'raise to 8' leaves consumers idle only if 8 > partitions");
  tipHas("kafka", lang => [lang === "en" ? `to ${MAXC}: ${MAXC - P} of them` : `para ${MAXC}: ${MAXC - P} deles`]);
});

test("keyed by orderId every order is read in order; without a key some are not", () => {
  const keyed = K.run({ ...lab, key: "order" }, TICKS).st, none = K.run({ ...lab, key: "none" }, TICKS).st;
  const fewer = K.run({ ...lab, consumers: N - 1, key: "none" }, TICKS).st;
  console.log(`       ${TICKS} ticks, ${keyed.produced} records: out of order keyed=${keyed.ooo}, no key (${N} consumers)=${none.ooo}, no key (${N - 1} consumers)=${fewer.ooo}`);
  eq(keyed.ooo, 0, "keyed by order");
  ok(none.ooo > 0 && fewer.ooo > none.ooo, "no key breaks per-order ordering, more so with lag");
  tipHas("kafka", lang => lang === "en"
    ? [`has ${P} partitions`, `runs ${N} consumers`, `(${fmt(none.ooo, 0, lang)} in ${TICKS} ticks with ${N} consumers, ${fmt(fewer.ooo, 0, lang)} with ${N - 1})`]
    : [`tem ${P} partições`, `roda ${N} consumidores`, `(${fmt(none.ooo, 0, lang)} em ${TICKS} ticks com ${N} consumidores, ${fmt(fewer.ooo, 0, lang)} com ${N - 1})`]);
});

test("lag: the lab's consumers keep up, 1 does not; a hot key is not fixed by more consumers", () => {
  const all = K.run({ ...lab, key: "order" }, TICKS).st, one = K.run({ ...lab, consumers: 1, key: "order" }, TICKS).st;
  const hot = K.run({ ...lab, key: "show" }, TICKS).st, hotMax = K.run({ ...lab, consumers: P, key: "show" }, TICKS).st;
  console.log(`       total lag after ${TICKS} ticks: ${N} consumers ${K.totalLag(all)}, 1 consumer ${K.totalLag(one)}; key=show worst partition: ${N} consumers ${worst(hot)}, ${P} consumers ${worst(hotMax)} (P${hotP})`);
  ok(K.totalLag(all) < 10 && K.totalLag(one) > 200, "capacity");
  ok(worst(hotMax) > 100 && worst(hotMax) === K.lag(hotMax, hotP), "the hot partition stays behind with one consumer per partition");
  tipHas("kafka", lang => lang === "en"
    ? [`hashes to P${hotP}`, `(${fmt(worst(hot), 0, lang)} records after ${TICKS} ticks)`, `with ${P} consumers it is still ${fmt(worst(hotMax), 0, lang)} behind`]
    : [`cai em P${hotP}`, `(${fmt(worst(hot), 0, lang)} registros depois de ${TICKS} ticks)`, `com ${P} consumidores ainda são ${fmt(worst(hotMax), 0, lang)} atrás`]);
});

test("killing a consumer pauses the whole group, then its partitions move to the survivors", () => {
  let lagBefore = 0, lagPaused = 0;
  const r = K.run({ ...lab, key: "order" }, 60, st => {
    if (st.t === 30) { lagBefore = K.totalLag(st); K.kill(st, 1); }
    if (st.t === 30 + K.REBALANCE - 1) lagPaused = K.totalLag(st);
  });
  const counts = Object.values(r.st.assignment).map(a => a.length);
  console.log(`       lag before the kill ${lagBefore}, at the end of the pause ${lagPaused}, assignment after: ${JSON.stringify(r.st.assignment)}`);
  ok(lagPaused > lagBefore + 6, "lag grows on every partition during the pause");
  eq(counts.length, N - 1, "survivors");
  eq(counts.reduce((a, b) => a + b, 0), P, "survivors share every partition");
  ok(counts.every(c => c === counts[0]), "the tip says 'each': the survivors get the same number of partitions");
  eq(r.st.ooo, 0, "resume from the committed offset: still in order");
  eq(r.st.parts.reduce((a, p) => a + p.committed, 0), r.st.processed, "no record read twice or skipped");
  tipHas("kafka", lang => [lang === "en" ? `the ${N - 1} survivors take ${counts[0]} partitions each` : `os ${N - 1} sobreviventes assumem ${counts[0]} partições cada`]);
});
