import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("account-cache");
const LAB = "docs/2026.2/hands-on/8";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const gets = res => res.out.filter(r => r.cmd.includes("curl -") && !r.cmd.includes("-X "));

test("the stack is the lab's compose.yaml: 2 account replicas, 3 gateways, redis with AOF", () => {
  const compose = read("docker/index.md");
  const block = (svc) => compose.split(`\n  ${svc}:\n`).pop().split(/\n  [a-z]+:\n/)[0];
  ok(/replicas: 2/.test(block("account")), "account has 2 replicas");
  eq(M.REPLICAS.length, 2, "account replicas");
  ok(/replicas: 3/.test(block("gateway")), "gateway has 3 replicas");
  eq(M.GATEWAYS.length, 3, "gateways");
  ok(compose.includes("command: redis-server --appendonly yes"), "AOF on");
});

test("the cache settings are the Spring page's", () => {
  const spring = read("spring/index.md");
  ok(spring.includes(`@Cacheable(value = "${M.CACHE}", key = "#id")`), "cache name");
  ok(spring.includes(`time-to-live: ${M.TTL * 1000}`), "TTL in ms");
  ok(spring.includes("cache-null-values: false"), "null not cached");
});

test("run: the outputs the page shows", () => {
  const page = read("run/index.md");
  const r = M.play("run");
  ok(page.includes(M.json(M.ADA)), "the cached JSON");
  ok(page.includes(`1) "${M.key("42")}"`), "the key");
  const g = gets(r);
  eq(g.slice(0, 2).map(x => !!x.hit), [false, true], "first a miss, then a hit");
  eq(g.slice(0, 2).map(x => x.replica), ["account-1", "account-2"], "the hit comes through the other replica");
  const timing = r.out.filter(x => x.cmd.includes("time_total")).map(x => x.out[0]);
  eq(timing, ["Cache miss: 0.058s", "Cache hit:  0.004s"], "measure");
  for (const line of timing) ok(page.includes(line), `the page shows "${line}"`);
  ok(page.includes('redis-cli DEL "accounts::42"'), "the page deletes the key before measuring");
  const ttl = r.out.find(x => x.ttl > 0);
  eq(ttl.ttl, 287, "TTL after 13 s");
  const info = r.out.find(x => x.hits !== undefined);
  eq([info.hits, info.misses, info.rate], [8, 2, 80], "INFO stats");
  ok(page.includes(`keyspace_hits:${info.hits}\nkeyspace_misses:${info.misses}`), "the page shows the same INFO stats");
  const end = r.out.slice(-2);
  eq([end[0].ttl, !!end[1].hit], [-2, false], "after 300 s: gone, a miss");
});

test("replicas: one cache per JVM misses twice and serves a stale value; Redis does not", () => {
  const r = M.play("replicas");
  const g = gets(r);
  eq(g.slice(0, 4).map(x => !!x.hit), [false, false, true, true], "local: miss, miss, hit, hit");
  ok(g[4].stale && g[4].body.includes("Ada Lovelace") && g[4].replica === "account-2", "account-2 serves the old name");
  eq(g.slice(5, 7).map(x => !!x.hit), [false, true], "redis: one miss serves both");
  ok(!g[7].stale && g[7].replica !== r.out.filter(x => x.cmd.includes("-X PUT"))[1].replica, "fresh after a PUT through the other replica");
  eq(g.slice(8).map(x => x.status), [404, 404], "after DELETE");
  eq(r.st.stale, 1, "one stale read");
});

test("stale: a write behind the service's back lasts until the TTL", () => {
  const r = M.play("stale");
  const g = gets(r);
  ok(g[1].stale, "stale right after the psql UPDATE");
  ok(!g[2].hit && g[2].body.includes(M.NEW_NAME), "after the TTL: a miss with the new name");
  eq(g.slice(3).map(x => [x.status, !!x.db]), [[404, true], [404, true]], "a 404 is never cached");
});

test("restarting redis keeps the keys (AOF); simple mode leaves Redis empty", () => {
  const st = M.create();
  M.get(st, "42");
  M.restartRedis(st);
  ok(M.get(st, "42").hit, "still a hit after the restart");
  const s2 = M.create("local");
  M.get(s2, "42");
  eq(M.keys(s2).out, ["(empty array)"], "Redis untouched");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const info = M.play("run", 8).out.pop();
  tipHas("account-cache", lang => [
    fmt(M.MISS_MS / 1000, 3, lang) + " s", fmt(M.HIT_MS / 1000, 3, lang) + " s", "287",
    `keyspace_hits:${info.hits}`, `keyspace_misses:${info.misses}`, `(${info.rate}%)`, `${M.TTL} s`, "Ada Lovelace"
  ]);
});
