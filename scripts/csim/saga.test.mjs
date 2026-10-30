import { load, test, eq, ok } from "./lib.mjs";

const G = load("saga");
const runAll = (st, max = 100) => { let n = 0; while (G.step(st) && n++ < max); return st; };
const logs = st => st.log.map(l => l[0]);

test("saga, payment declined: compensations run in reverse (release seat, then cancel order)", () => {
  const st = runAll(G.create("saga", "declined"));
  const L = logs(st);
  ok(L.indexOf("C2 release A-12 ✓") > L.indexOf("T3 charge ✗ declined"), "C2 after the failure");
  ok(L.indexOf("C1 cancel order ✓") > L.indexOf("C2 release A-12 ✓"), "C1 after C2");
  eq(st.svc, ["981 CANCELLED", "A-12 FREE", "DECLINED", "—"], "final local states");
  eq([st.outcome, st.lockMs], ["compensated", 0], "no lock ever held");
});

test("saga, charge timeout: refund first, then release, then cancel", () => {
  const st = runAll(G.create("saga", "timeout"));
  const L = logs(st);
  ok(L.indexOf("C3 refund ✓") < L.indexOf("C2 release A-12 ✓") && L.indexOf("C2 release A-12 ✓") < L.indexOf("C1 cancel order ✓"), "C3, C2, C1");
  eq(st.svc[2], "REFUNDED R$ 450", "refunded");
});

test("saga, failure after the pivot: retried, never compensated", () => {
  const st = runAll(G.create("saga", "ticket"));
  eq(st.outcome, "committed", "the saga completes");
  ok(!logs(st).some(l => l.startsWith("C")), "no compensation");
  eq(logs(st).filter(l => l.includes("retry")).length, 2, "two failed attempts");
  eq(st.svc, ["981 CONFIRMED", "A-12 SOLD", "CHARGED R$ 450", "T-5521 ISSUED"], "everything done");
});

test("2PC, all YES: atomic commit, locks released at the end", () => {
  const st = runAll(G.create("2pc", "none"));
  eq(st.outcome, "committed", "committed");
  ok(!G.anyLock(st) && st.lockMs > 0, `locks held ${st.lockMs} ms, then released`);
});

test("2PC, coordinator crash after PREPARE: blocked, lock time grows until it recovers", () => {
  const st = G.create("2pc", "crash");
  runAll(st, 30);                     /* stops? no: in doubt it keeps waiting */
  ok(G.anyLock(st) && st.locks.slice(1).every(Boolean), "all participants hold their locks");
  const before = st.lockMs;
  for (let i = 0; i < 10; i++) ok(G.step(st), "still waiting");
  eq(st.lockMs - before, 10000, "ten more seconds holding locks");
  ok(st.waiting >= 10 && !st.outcome, "fans queue, no outcome");
  ok(G.recover(st), "the coordinator restarts");
  runAll(st);
  eq([st.outcome, G.anyLock(st)], ["aborted", false], "presumed abort frees the locks");
});

test("2PC, a NO vote: everyone aborts, nothing to compensate", () => {
  const st = runAll(G.create("2pc", "vote-no"));
  eq([st.outcome, G.anyLock(st)], ["aborted", false], "aborted, unlocked");
});

test("replay rebuilds the same state (previous-step button)", () => {
  const a = G.create("2pc", "crash");
  for (let i = 0; i < 12; i++) G.step(a);
  G.recover(a); G.step(a); G.step(a);
  const b = G.replay("2pc", "crash", 14, 12);
  eq([b.i, b.lockMs, b.svc, b.locks], [a.i, a.lockMs, a.svc, a.locks], "same state");
});

test("the page's numbers", () => {
  const ok2pc = runAll(G.create("2pc", "none"));
  const crash = G.create("2pc", "crash"); runAll(crash, 7 + 8 + 10 - 1);
  const sagaOk = runAll(G.create("saga", "none")), sagaDecl = runAll(G.create("saga", "declined"));
  console.log(`       2PC ok: locks ${ok2pc.lockMs} ms, time ${ok2pc.now} ms; crash: after ${crash.i} steps + ${crash.waiting} s waiting, locks ${crash.lockMs} ms`);
  console.log(`       saga ok: ${sagaOk.now} ms, locks ${sagaOk.lockMs}; saga declined: ${sagaDecl.now} ms`);
  ok(ok2pc.lockMs < 1000, "short lock time when all is well");
});
