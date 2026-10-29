import { load, test, eq, ok, near } from "./lib.mjs";

const H = load("hash-ring");
const keys = H.keyHashes(10000);
const nodes = n => H.NAMES.slice(0, n);

test("a key belongs to the first node clockwise, wrapping around", () => {
  const pts = [{ pos: 100, node: "A" }, { pos: 200, node: "B" }];
  eq([H.owner(pts, 50), H.owner(pts, 150), H.owner(pts, 200), H.owner(pts, 250)], ["A", "B", "B", "A"], "owners");
});

test("adding a node moves only the keys it takes; mod N moves most of them", () => {
  const before = H.assignRing(keys, nodes(4), 64), after = H.assignRing(keys, nodes(5), 64);
  for (let i = 0; i < keys.length; i++) if (before[i] !== after[i]) ok(after[i] === "E", "a key moved between old nodes");
  const f = H.movedFraction(before, after);
  near(f, 0.2, 0.06, "consistent hashing moves about 1/N");
  ok(H.movedFraction(H.assignMod(keys, nodes(4)), H.assignMod(keys, nodes(5))) > 0.75, "mod N moves most keys");
});

test("removing a node moves only its own keys", () => {
  const before = H.assignRing(keys, nodes(5), 16), after = H.assignRing(keys, nodes(4), 16);
  for (let i = 0; i < keys.length; i++) if (before[i] !== after[i]) ok(before[i] === "E", "a key of a surviving node moved");
});

test("virtual nodes even out the load", () => {
  const one = H.imbalance(H.assignRing(keys, nodes(4), 1), nodes(4));
  const many = H.imbalance(H.assignRing(keys, nodes(4), 64), nodes(4));
  ok(one > many, `1 vnode ${one} should be worse than 64 vnodes ${many}`);
  ok(many < 1.25, `64 vnodes should be near 1, got ${many}`);
});

test("the page's starting point: 4 → 5 nodes with 1 vnode", () => {
  const f = H.movedFraction(H.assignRing(keys, nodes(4), 1), H.assignRing(keys, nodes(5), 1));
  const fm = H.movedFraction(H.assignMod(keys, nodes(4)), H.assignMod(keys, nodes(5)));
  console.log(`       consistent ${(100 * f).toFixed(1)}%, mod N ${(100 * fm).toFixed(1)}%, imbalance(4,1) ${H.imbalance(H.assignRing(keys, nodes(4), 1), nodes(4)).toFixed(2)}`);
  ok(f < 0.5 && fm > 0.75, "consistent moves far less than mod N");
});
