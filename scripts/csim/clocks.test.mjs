import { load, test, eq, ok } from "./lib.mjs";

const K = load("clocks");

/* a seeded random run: local events, sends and receipts */
function randomRun(seed, n) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const st = K.create();
  for (let i = 0; i < n; i++) {
    const p = Math.floor(rnd() * 3), r = rnd();
    if (r < 0.35 && K.pending(st, p).length) K.receive(st, p);
    else if (r < 0.7) K.send(st, p, (p + 1 + Math.floor(rnd() * 2)) % 3);
    else K.local(st, p);
  }
  return st;
}

/* happened-before from the definition: process order + message edges, transitively */
function happenedBefore(st) {
  const idx = Object.fromEntries(st.events.map((e, i) => [e.id, i]));
  const n = st.events.length, hb = Array.from({ length: n }, () => new Array(n).fill(false));
  st.events.forEach((e, i) => st.events.forEach((f, j) => { if (e.p === f.p && e.seq < f.seq) hb[i][j] = true; }));
  st.msgs.forEach(m => { if (m.recvEv) hb[idx[m.sendEv]][idx[m.recvEv]] = true; });
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (hb[i][k]) for (let j = 0; j < n; j++) if (hb[k][j]) hb[i][j] = true;
  return hb;
}

test("Lamport receive rule: max(local, message) + 1, as on the page", () => {
  const st = K.preset();
  const L = id => K.find(st, id).lamport;
  eq([L("o1"), L("o2"), L("i1"), L("i2"), L("p1"), L("p2"), L("i3")], [1, 2, 1, 2, 3, 4, 5], "Lamport numbers of the scenario");
  eq(K.find(st, "i3").vc, [2, 2, 3], "vector of the last receipt");
});

test("if a → b then L(a) < L(b), on random runs", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const st = randomRun(seed, 40), hb = happenedBefore(st);
    st.events.forEach((a, i) => st.events.forEach((b, j) => { if (hb[i][j]) ok(a.lamport < b.lamport, `seed ${seed}: ${a.id} → ${b.id} but L ${a.lamport} >= ${b.lamport}`); }));
  }
});

test("vector clocks tell happened-before and concurrency exactly", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const st = randomRun(seed, 40), hb = happenedBefore(st);
    st.events.forEach((a, i) => st.events.forEach((b, j) => {
      if (i === j) return;
      const r = K.relation(a, b), want = hb[i][j] ? "before" : hb[j][i] ? "after" : "concurrent";
      eq(r, want, `seed ${seed}: ${a.id} vs ${b.id}`);
    }));
  }
});

test("Lamport order cannot detect concurrency: L(a) < L(b) also for concurrent events", () => {
  let conc = 0, concLess = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const st = randomRun(seed, 40);
    st.events.forEach(a => st.events.forEach(b => {
      if (K.relation(a, b) === "concurrent") { conc++; if (a.lamport < b.lamport) concLess++; }
    }));
  }
  ok(concLess > conc / 4, `many concurrent pairs have L(a) < L(b): ${concLess} of ${conc}`);
});

test("the page's starting pair: i2 and p1", () => {
  const st = K.preset(), a = K.find(st, "i2"), b = K.find(st, "p1");
  console.log(`       i2 L=${a.lamport} V=[${a.vc}], p1 L=${b.lamport} V=[${b.vc}] → ${K.relation(a, b)}; o1 vs i3 → ${K.relation(K.find(st, "o1"), K.find(st, "i3"))}; i3 V=[${K.find(st, "i3").vc}]`);
  eq(K.lamportOrder(a, b), "<", "Lamport suggests an order");
  eq(K.relation(a, b), "concurrent", "but they are concurrent");
  eq(K.relation(K.find(st, "o1"), K.find(st, "i3")), "before", "o1 → i3 through two messages");
});

test("two local events on different processes, no messages: concurrent", () => {
  const st = K.create();
  const a = K.local(st, 0), b = K.local(st, 1);
  eq(K.relation(a, b), "concurrent", "relation");
  eq(K.lamportOrder(a, b), "=", "same Lamport number");
});

test("the tip's last step: a new order event o3 is concurrent with i3 until a message carries it", () => {
  const st = K.preset(), o3 = K.local(st, 0);
  K.send(st, 0, 2); const r = K.receive(st, 2);
  console.log(`       ${o3.id} V=[${o3.vc}] vs i3 → ${K.relation(o3, K.find(st, "i3"))}; ${r.id} V=[${r.vc}]`);
  eq([o3.id, o3.vc, K.relation(o3, K.find(st, "i3")), K.relation(o3, r)], ["o3", [3, 0, 0], "concurrent", "before"], "o3");
});
