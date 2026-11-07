import { load, test, eq, ok, tipHas } from "./lib.mjs";

const M = load("seat-race");
const out = (strategy, schedule = "interleaved") => M.outcome(M.race(strategy, schedule).st);
const resumed = strategy => M.race(strategy, "interleaved").lines.filter(l => l.resumed)[0];

test("naive, interleaved: both fans hear 201 and Bob overwrites Alice (the page's double booking)", () => {
  const o = out("naive");
  eq([o.alice, o.bob, o.held, o.double], ["201", "201", "Bob", true], "double booking");
  eq(o.waits, 1, "Bob's UPDATE waited for Alice's row lock");
  eq(resumed("naive").out, "UPDATE 1", "the resumed UPDATE still matches: no status in its WHERE");
});

test("conditional UPDATE: the resumed UPDATE re-checks status and matches 0 rows", () => {
  const o = out("conditional");
  eq([o.alice, o.bob, o.held], ["201", "409", "Alice"], "one hold");
  eq(resumed("conditional").out, "UPDATE 0", "0 rows after the wait");
});

test("FOR UPDATE: Bob waits at the read and then reads HELD", () => {
  eq([out("for-update").bob, resumed("for-update").op, resumed("for-update").out], ["409", "selectfu", "HELD"], "waits at the SELECT");
});

test("optimistic: Bob's version 7 no longer matches version 8", () => {
  const o = out("optimistic");
  eq([o.bob, o.version], ["409", M.VERSION + 1], "0 rows, version bumped by Alice");
  eq(resumed("optimistic").out, "UPDATE 0", "0 rows");
});

test("repeatable read: the naive code fails with 40001 instead of overwriting", () => {
  const o = out("repeatable");
  eq([o.alice, o.bob, o.double], ["201", "40001", false], "serialization failure");
  ok(resumed("repeatable").out.includes("could not serialize access due to concurrent update"), "PostgreSQL's message");
});

test("Alice first: every strategy is safe when the transactions do not overlap", () => {
  for (const k of Object.keys(M.STRATS)) {
    const o = out(k, "serial");
    eq([o.alice, o.bob, o.waits], ["201", "409", 0], k);
  }
});

test("the tips", () => {
  tipHas("seat-race", lang => lang === "en"
    ? ["both fans hear 201", "held_by ends as Bob", "UPDATE 0", "version 8", "40001", "Alice first"]
    : ["os dois fãs ouvem 201", "held_by termina como Bob", "UPDATE 0", "version 8", "40001", "Alice primeiro"]);
});
