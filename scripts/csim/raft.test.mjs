import { load, test, eq, ok } from "./lib.mjs";

const R = load("raft");
const run = (st, n, check) => { for (let i = 0; i < n; i++) { R.tick(st); if (check) check(st); } };
const commits = st => st.nodes.map(n => n.commit);

/* Raft's safety properties, checked after every tick */
function safety() {
  const leaderOf = {}, committed = {};
  return st => {
    st.nodes.forEach(n => {
      if (n.role === "leader") {
        ok(leaderOf[n.term] === undefined || leaderOf[n.term] === n.id, `two leaders in term ${n.term}`);
        leaderOf[n.term] = n.id;
      }
      for (let i = 1; i <= n.commit; i++) {
        const e = n.log[i - 1], key = e.term + ":" + e.cmd;
        ok(committed[i] === undefined || committed[i] === key, `index ${i} committed as ${committed[i]} and as ${key}`);
        committed[i] = key;
      }
    });
  };
}

test("the starting state: one leader, two holds committed on every log", () => {
  const st = R.preset(3);
  eq(R.leaders(st).length, 1, "one leader");
  eq(commits(st), [2, 2, 2, 2, 2], "commit index everywhere");
});

test("crash the leader: a new leader with a higher term, holding every committed entry", () => {
  const st = R.preset(3), old = R.leader(st);
  R.setUp(st, old.id, false);
  let t = 0;
  while (!R.leader(st) && t < 500) { R.tick(st); t++; }
  const L = R.leader(st);
  console.log(`       ${R.name(old.id)} crashed (term ${old.term}); ${R.name(L.id)} leads term ${L.term} after ${t * 10} ms`);
  ok(L && L.id !== old.id && L.term > old.term, "new leader, higher term");
  ok(L.log.length >= 2, "has the committed entries");
  ok(t * 10 >= R.EMIN * 10 - 50 && t * 10 <= 700, `about one election timeout plus a vote round: ${t * 10} ms`);
});

test("a leader needs a majority: with 3 of 5 down, no leader and no commit", () => {
  const st = R.preset(3), L = R.leader(st);
  [0, 1, 2, 3, 4].filter(i => i !== L.id).slice(0, 3).forEach(i => R.setUp(st, i, false));
  R.setUp(st, L.id, false);
  R.setUp(st, L.id, true);
  run(st, 600);
  eq(R.leaders(st).length, 0, "nobody wins an election with 2 of 5");
  ok(R.write(st) === null, "writes rejected");
});

test("partition 2 | 3: the small side cannot commit, the big side elects and commits", () => {
  const st = R.preset(3), old = R.leader(st), check = safety();
  R.partition(st, true);
  R.write(st, 0);
  run(st, 400, check);
  const big = R.leaders(st).filter(n => st.groups[n.id] === 1)[0];
  ok(big && big.term > old.term, "the big side elected a leader with a higher term");
  ok(old.role === "leader" && old.commit === 2 && old.log.length === 3, "the old leader still thinks it leads, its write stuck at index 3");
  R.write(st, 1);
  run(st, 60, check);
  ok(big.commit === 3 && big.log[2].term === big.term, "the big side's write committed at index 3");
  console.log(`       old ${R.name(old.id)} T${old.term} log ${old.log.map(e => e.term)} commit ${old.commit}; new ${R.name(big.id)} T${big.term} log ${big.log.map(e => e.term)} commit ${big.commit}`);
});

test("heal: the stale leader steps down and its uncommitted entry is overwritten", () => {
  const st = R.preset(3), old = R.leader(st), check = safety();
  R.partition(st, true);
  R.write(st, 0);
  run(st, 400, check);
  R.write(st, 1);
  run(st, 60, check);
  const lost = old.log[2].cmd;
  R.partition(st, false);
  run(st, 100, check);
  ok(old.role === "follower", "stepped down");
  ok(!st.nodes.some(n => n.log.some(e => e.cmd === lost)), `'${lost}' is gone everywhere`);
  const L = R.leader(st);
  st.nodes.forEach(n => eq(n.log.map(e => e.cmd), L.log.map(e => e.cmd), "logs identical"));
  ok(st.events.some(e => e.en.includes("steps down")) && st.events.some(e => e.en.includes("drops")), "both narrated");
});

test("chaos: random crashes, restarts, partitions and writes never break safety", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const st = R.create(seed), check = safety();
    let a = seed * 7919;
    const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
    for (let i = 0; i < 3000; i++) {
      const r = rnd();
      if (r < 0.01) R.write(st, st.groups ? (rnd() < 0.5 ? 0 : 1) : undefined);
      else if (r < 0.013) R.setUp(st, Math.floor(rnd() * 5), rnd() < 0.5);
      else if (r < 0.015) R.partition(st, !st.groups);
      R.tick(st); check(st);
    }
  }
});
