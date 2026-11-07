import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("boxoffice-db");
const LAB = "docs/2027.1/hands-on/6";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const ops = (res, re) => res.out.filter(r => re.test(r.cmd));
const secs = ms => fmt(ms / 1000, 0) + " s";

test("the nodes and the pooler are services of the lab's docker-compose.yaml; db-replica depends on db", () => {
  const compose = read("code/docker-compose.yaml");
  for (const n of [...M.NAMES, "pgbouncer"]) ok(new RegExp(`^  ${n}:`, "m").test(compose), `docker-compose.yaml has no service ${n}`);
  const replica = compose.split(/^  db-replica:/m)[1].split(/^  \S/m)[0];
  ok(/depends_on:[^]*?\bdb\b/.test(replica), "db-replica depends on db (why plain start brings db back)");
  const st = M.create();
  M.stop(st, "db-replica"); M.stop(st, "db", true);
  M.start(st, "db-replica");
  ok(M.node(st, "db").up, "start db-replica starts db too");
  const s2 = M.create();
  M.stop(s2, "db-replica"); M.stop(s2, "db", true);
  M.start(s2, "db-replica", true);
  ok(!M.node(s2, "db").up, "up --no-deps starts only db-replica");
});

test("replica: with REPLICA_DELAY the seat map misses Ana's hold, the primary does not, and it appears after the delay", () => {
  const r = M.play("replica");
  ok(ops(r, /INSERT INTO/)[0].out[0].includes("cannot execute INSERT in a read-only transaction"), "a standby is read-only");
  ok(read("replicas/index.md").includes("ERROR:  cannot execute INSERT in a read-only transaction"), "the page shows the same error");
  const maps = ops(r, /availability/);
  eq(maps.map(m => m.held.join(",")), ["1", "", "1"], "fresh without lag, stale with it, fresh after the delay");
  eq(maps[1].stale, [1], "the stale seat");
  eq(ops(r, /holds\/hold-/)[0].out[0], "{\"status\":\"ACTIVE\"}", "the fan's own hold, read on the primary");
});

test("sync: on is still stale, remote_apply waits for the replay, a stopped standby hangs the hold", () => {
  const r = M.play("sync");
  const holds = ops(r, /inventory\/holds -d/);
  eq(holds.map(h => h.status), [201, 201, 504], "on, remote_apply, standby stopped");
  ok(Math.abs(holds[1].secs - (M.LAB.delay / 1000 + 0.03)) < 1e-9, "remote_apply: the hold waits for the replay");
  ok(holds[2].committed && holds[2].out[2].includes("already committed locally"), "504, yet committed locally");
  ok(read("failover/index.md").includes("The transaction has already committed locally"), "the page shows the same DETAIL");
  eq(ops(r, /availability/).map(m => m.status + ":" + m.held.join(",")), ["200:", "200:1", "504:"], "stale with on, fresh with remote_apply, 504 with the replica down");
  eq(ops(r, /IN \(10\)/)[0].seats, ["HELD"], "seat 10 is HELD although the fan saw 504");
  eq(r.st.hung, 1, "one commit hung");
  ok(read("failover/index.md").includes(`The hold gets \`504\` after ${M.LAB.timeout / 1000} s`), "the page gives the same timeout");
});

test("crash: the replica keeps the seat map, the failover brings writes back, Ana's hold is lost", () => {
  const r = M.play("crash");
  eq(ops(r, /^\$ probe/).map(p => p.codes.join(" ")), ["200 504 504 504", "200 201 200 200"], "probes before and after the failover");
  const page = read("failover/index.md");
  ok(page.includes("504 5.01s  hold (primary)") && page.includes("200 0.58s  seat map (replica)"), "the page shows the same probes");
  eq(ops(r, /holds\/hold-1/)[0].out[0], "{\"status\":404,\"title\":\"Not Found\"}", "Ana's hold is gone");
  ok(page.includes("{\"status\":404,\"title\":\"Not Found\"}"), "the page shows the same 404");
  eq(ops(r, /IN \(20, 21\)/)[0].seats, ["AVAILABLE", "AVAILABLE"], "seats 20 and 21 back on sale");
  eq(M.lost(r.st), [1], "the hold that answered 201");
  eq(M.primary(r.st).name + ":" + M.primary(r.st).tl, "db-replica:2", "db-replica on timeline 2");
  ok(page.includes(`sleep ${M.LAB.reconnect / 1000}; probe "hold"`), "the page waits as long as the model");
});

test("split brain: two primaries disagree, pg_rewind discards the lost hold, the switchback ends on timeline 3", () => {
  const r = M.play("split-brain", 2);
  eq(M.primaries(r.st).length, 2, "two primaries");
  const page = read("failover/index.md");
  for (const ip of ops(r, /getent/)[0].ips) ok(page.includes(ip), `the page shows ${ip}`);
  eq(ops(r, /IN \(20\)/).map(q => q.seats[0]), ["HELD", "AVAILABLE"], "seat 20 on db, then on db-replica");
  ok(page.includes("db: primary=t, seat 20=HELD") && page.includes("db-replica: primary=t, seat 20=AVAILABLE"), "the page shows the same answers");
  const all = M.play("split-brain");
  eq(ops(all, /rejoin-as-replica/)[0].discarded, [1], "pg_rewind discards Ana's hold");
  ok(page.includes("pg_rewind: servers diverged at WAL location"), "the page shows the rewind");
  eq(ops(all, /^\$ probe/).pop().codes.join(" "), "200 201 200 200", "the stack works at the end");
  eq(M.primaries(all.st).map(n => n.name + ":" + n.tl), ["db:3"], "db primary again, on timeline 3");
  ok(page.includes("on timeline 3"), "the page says timeline 3");
  ok(ops(all, /pg_current_wal_lsn/)[0].equal, "equal LSNs before the switchback");
});

test("without wal_log_hints pg_rewind refuses, with the lab's message", () => {
  const st = M.create();
  M.stop(st, "db-replica"); M.hold(st, [20]); M.stop(st, "db", true); M.start(st, "db-replica", true); M.promote(st, "db-replica");
  const msg = M.rejoin(st, "db", "db-replica").out[0];
  ok(msg.includes("target server needs to use either data checksums or \"wal_log_hints = on\""), msg);
  ok(read("failover/index.md").includes("target server needs to use either data checksums or \"wal_log_hints = on\""), "the page quotes it");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const h = M.play("sync").out.filter(r => /inventory\/holds -d/.test(r.cmd))[1];
  const apply = lang => fmt(h.secs, 2, lang) + " s";
  tipHas("boxoffice-db", lang => lang === "en"
    ? ["seat 1 AVAILABLE", `${secs(M.LAB.delay)} later`, apply("en"), `504 after ${secs(M.LAB.timeout)}`, "seat 10 is HELD", `${secs(M.LAB.reconnect)} later`, "404", "timeline 3"]
    : ["assento 1 AVAILABLE", `${secs(M.LAB.delay)} depois`, apply("pt"), `504 depois de ${secs(M.LAB.timeout)}`, "assento 10 está HELD", `${secs(M.LAB.reconnect)} depois`, "404", "timeline 3"]);
});
