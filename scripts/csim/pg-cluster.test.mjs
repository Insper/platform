import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("pg-cluster");
const LAB = "docs/2026.2/hands-on/9";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const last = (res, op) => res.out.filter(r => r.cmd.includes(op)).pop();

test("the nodes are the services of the lab's compose.yaml", () => {
  const compose = read("code/compose.yaml");
  for (const n of M.NAMES) ok(new RegExp(`^  ${n}:`, "m").test(compose), `compose.yaml has no service ${n}`);
});

test("replication: the outputs of experiments 1–4", () => {
  const r = M.play("replication");
  const counts = r.out.filter(x => x.cmd.includes("SELECT id")).map(x => x.count);
  eq(counts, [2, 2, 3, 3], "replica1, replica1 paused, replica2, replica1 resumed");
  ok(r.out.some(x => x.out[0].includes("cannot execute INSERT in a read-only transaction")), "a replica refuses the INSERT");
  const st = r.out.find(x => x.rows);
  eq(st.rows.map(x => x.bytes), [M.BYTES, 0], "bytes behind");
  ok(read("replication/index.md").includes(`pg-replica1      |          ${M.BYTES}`), "the page shows the same bytes_behind");
  eq(r.out.filter(x => x.host).map(x => x.host), ["pg-primary", "pg-replica1", "pg-replica2"], "read-write, then two standbys");
});

test("sync: FIRST 1 hangs with its replica down, ANY 1 does not", () => {
  const r = M.play("sync");
  const ins = r.out.filter(x => x.cmd.includes("INSERT"));
  eq(ins.map(x => !!x.blocked), [true, false], "headset hangs, webcam returns");
  eq(r.st.blocked, 1, "one commit hung");
  eq(r.out.filter(x => x.rows).map(x => x.rows.map(y => y.sync).join("/")), ["sync/async", "quorum", "quorum/quorum", "async/async"], "sync_state");
});

test("remote_apply: a paused synchronous replica makes the commit wait", () => {
  const st = M.create();
  M.setSync(st, 'FIRST 1 ("pg-replica1")', "remote_apply");
  M.pause(st, "pg-replica1", true);
  ok(M.insert(st, "pg-primary", "x").blocked, "waits for the replay");
  M.setSync(st, 'FIRST 1 ("pg-replica1")', "on");
  ok(!M.insert(st, "pg-primary", "y").blocked, "on: received is enough");
});

test("failover: the client finds the new primary, no rewind after a clean stop", () => {
  const r = M.play("failover");
  const rw = r.out.filter(x => x.cmd.includes("read-write"));
  eq(rw.map(x => x.host || null), [null, "pg-replica1"], "no primary, then pg-replica1");
  ok(last(r, "rejoin").out.includes("pg_rewind: no rewind required"), "no rewind required");
  eq(M.rows(M.node(r.st, "pg-replica2")).length, 3, "pg-replica2 has after-failover");
  eq(M.primaries(r.st).map(n => n.name), ["pg-replica1"], "one primary at the end");
  eq(r.st.lost, [], "nothing lost");
});

test("lost write: gone after the failover, id 34, discarded by pg_rewind", () => {
  const r = M.play("lost-write");
  const sel = last(r, "SELECT id");
  eq(sel.ids, [1, 2, 34], "ids on every node at the end");
  ok(read("failover/index.md").includes(" 34 | after-failover"), "the page shows id 34");
  eq(last(r, "rejoin").discarded, ["lost-write"], "pg_rewind discards lost-write");
  eq(r.st.lost, ["lost-write"], "the lost write");
});

test("split brain: starting the old primary without pg_rewind gives two primaries", () => {
  const r = M.play("failover", 3);
  const res = M.start(r.st, "pg-primary");
  eq(M.primaries(r.st).length, 2, "two primaries");
  eq(res.tone, "bad", "flagged");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  tipHas("pg-cluster", lang => lang === "en"
    ? ["pg-replica1 shows 2 rows and pg-replica2 3", `${M.BYTES} bytes`, "id 34"]
    : ["pg-replica1 mostra 2 linhas e pg-replica2 3", `${M.BYTES} bytes`, "id 34"]);
});
