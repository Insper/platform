import { load, test, eq, ok, tipHas } from "./lib.mjs";

const D = load("delivery");
const plan = (commit, crash, idem = false) => ({ commit, crash, at: 2, idem });

test("without a crash both orders of steps charge every order once", () => {
  eq(D.outcome(plan("before", "none")), { lost: 0, twice: 0, charges: 6 }, "commit first");
  eq(D.outcome(plan("after", "none")), { lost: 0, twice: 0, charges: 6 }, "charge first");
});

test("at-most-once: commit, crash before the charge → the order is lost", () => {
  const r = D.outcome(plan("before", "commit"));
  console.log(`       commit → charge, crash after the commit of o-1003: ${JSON.stringify(r)}`);
  eq(r, { lost: 1, twice: 0, charges: 5 }, "one lost");
  const steps = D.run(plan("before", "commit"));
  const restart = steps.find(s => s.kind === "restart");
  eq([restart.offset, restart.charges[2]], [3, 0], "resumes after the uncharged record");
});

test("at-least-once: charge, crash before the commit → the customer is charged twice", () => {
  const r = D.outcome(plan("after", "charge"));
  console.log(`       charge → commit, crash after the charge of o-1003: ${JSON.stringify(r)}`);
  eq(r, { lost: 0, twice: 1, charges: 7 }, "one double charge");
});

test("the idempotency key removes the duplicate but not the loss", () => {
  const eff = D.outcome(plan("after", "charge", true)), lossy = D.outcome(plan("before", "commit", true));
  console.log(`       with processed_events: charge → commit ${JSON.stringify(eff)}, commit → charge ${JSON.stringify(lossy)}`);
  eq(eff, { lost: 0, twice: 0, charges: 6 }, "effectively once");
  eq(lossy.lost, 1, "still lost");
  ok(D.run(plan("after", "charge", true)).some(s => s.kind === "skip"), "the redelivery is skipped");
});

test("a crash at the other point is harmless for each strategy", () => {
  eq(D.outcome(plan("before", "charge")), { lost: 0, twice: 0, charges: 6 }, "commit first, crash after charge");
  eq(D.outcome(plan("after", "commit")), { lost: 0, twice: 0, charges: 6 }, "charge first, crash after commit");
});

test("the tip's numbers come from the model", () => {
  const n = D.AMOUNTS.length, order = "o-" + (1001 + 2);
  const dup = D.outcome(plan("after", "charge")), lost = D.outcome(plan("before", "commit")), eff = D.outcome(plan("after", "charge", true));
  tipHas("delivery", lang => lang === "en"
    ? [`right after charging ${order}`, `${dup.charges} charges for ${n} orders`, `the order is lost (${lost.charges} charges)`, `(${eff.charges} charges, nobody twice)`]
    : [`logo depois de cobrar o ${order}`, `${dup.charges} cobranças para ${n} pedidos`, `o pedido é perdido (${lost.charges} cobranças)`, `(${eff.charges} cobranças, ninguém duas vezes)`]);
});
