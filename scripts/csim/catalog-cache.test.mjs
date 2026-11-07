import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("catalog-cache");
const H = "docs/2027.1/hands-on";
const read = f => readFileSync(path.join(ROOT, H, f), "utf8");
const outcomes = r => r.out.filter(x => x.outcome).map(x => x.outcome);

test("the keys are EventController's", () => {
  const ctl = read("5/code/services/catalog/src/main/java/boxoffice/catalog/EventController.java");
  ok(ctl.includes('return "catalog:event:" + id;'), "event key");
  ok(ctl.includes('"catalog:events:city=" + (city == null ? "" : city) + ":page=" + page + ":size=" + size'), "listing key");
  eq(M.listKey("Brasília"), "catalog:events:city=Brasília:page=0:size=20", "listing key of page 0 with the default size");
});

test("event 42 and the Brasília listing are the lab's seed data", () => {
  const seed = read("1/code/services/catalog/src/main/resources/db/migration/V2__seed_catalog.sql");
  ok(seed.includes("(ARRAY['Concert', 'Match', 'Festival', 'Play'])[1 + g % 4] || ' #' || g"), "title formula");
  ok(seed.includes("1 + (g * 7) % 50") && seed.includes("50 + (g % 20) * 25"), "venue and price formulas");
  const g = 42, venue = 1 + (g * 7) % 50;
  eq(["Concert", "Match", "Festival", "Play"][g % 4] + " #" + g, M.EVENT.title, "title");
  eq(50 + (g % 20) * 25, M.EVENT.priceFrom, "price");
  eq(venue, 45, "venue 45");
  eq(["Stadium", "Arena", "Hall", "Theater", "Club"][(venue - 1) % 5], "Club", "kind of venue 45");
  ok(seed.indexOf("(9, 'Brasília')") > 0, "city 9 is Brasília (venues 41–45)");
  const ids = [];
  for (let i = 2; ids.length < M.LISTING.length; i++) { const v = 1 + (i * 7) % 50; if (v >= 41 && v <= 45) ids.push(i); }
  eq(ids, M.LISTING, "the first events of Brasília, by start time");
  const page = read("5/cache-aside/index.md");
  ok(page.includes(`"title":"${M.UPDATE.title}"`) && page.includes(`"priceFrom":${M.UPDATE.priceFrom}`), "the page's admin update");
});

test("Redis is a pure cache: no persistence", () => {
  const compose = read("5/code/docker-compose.yaml");
  ok(compose.includes('"--save", "", "--appendonly", "no"'), "--save \"\" --appendonly no");
  const r = M.play("check");
  const after = r.out.filter(x => x.outcome).slice(-2);
  eq(after.map(x => x.outcome), ["MISS", "HIT"], "after a stop and start, Redis is empty");
});

test("check: the outputs of step 5 of the cache-aside page", () => {
  const r = M.play("check");
  eq(outcomes(r), ["MISS", "HIT", "MISS", "MISS", "MISS", "HIT"], "X-Cache");
  const [a, b] = r.out;
  eq([a.replica, b.replica], ["catalog-2", "catalog-3"], "two replicas");
  const ttl = r.out.find(x => x.ttl !== undefined).ttl;
  const page = read("5/cache-aside/index.md");
  ok(page.includes("X-Instance: catalog-2\nX-Cache: MISS") && page.includes("X-Instance: catalog-3\nX-Cache: HIT"), "the page shows the same two responses");
  ok(page.includes(`TTL catalog:event:42\n(integer) ${ttl}`), `the page shows TTL ${ttl}`);
  ok(ttl >= M.LAB.eventTtl && ttl <= M.LAB.eventTtl * (1 + M.LAB.jitter / 100), "TTL within 60–66 s");
  ok(r.out[4].out[0].includes(M.UPDATE.title) && r.out[5].out.join("").includes(M.UPDATE.title), "the read after the PUT has the new title");
  ok(r.out[7].log && r.out[7].log.includes("cache read failed"), "Redis down: the catalog logs and answers MISS");
  eq(r.st.stale, 0, "no stale response: the event key is evicted");
});

test("stale: the listing keeps the old title until CACHE_TTL_LIST", () => {
  const r = M.play("stale");
  eq(outcomes(r), ["MISS", "MISS", "MISS", "HIT", "MISS"], "X-Cache");
  const hit = r.out.find(x => x.outcome === "HIT");
  ok(hit.stale && hit.kind === "list" && hit.value.title === M.EVENT.title, "a stale HIT on the listing");
  const ttl = r.out.find(x => x.ttl !== undefined).ttl;
  ok(ttl > 0 && ttl <= M.LAB.listTtl, "the listing expires within CACHE_TTL_LIST");
  eq(r.out[r.out.length - 1].value.title, M.UPDATE.title, "fresh after it expires");
  eq(r.st.stale, 1, "one stale response");
});

test("ttl: one miss per expiry, a hit does not renew, BYPASS skips Redis", () => {
  const r = M.play("ttl");
  eq(outcomes(r), ["MISS", "HIT", "MISS", "BYPASS", "BYPASS", "HIT"], "X-Cache");
  eq(r.out.filter(x => x.ttl !== undefined).map(x => x.ttl), [62, 32, -2], "TTLs");
  ok(r.out.filter(x => x.outcome === "BYPASS").every(x => !x.redis.length && x.db), "BYPASS never asks Redis");
  eq(r.st.queries, 4, "queries: two misses, two bypasses");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  const s = M.play("stale"), ttl = s.out.find(x => x.ttl !== undefined).ttl;
  tipHas("catalog-cache", lang => lang === "en"
    ? ["MISS on catalog-2, HIT on catalog-3", "TTL 62", `${ttl} s`, `${M.LAB.listTtl} s`, "BYPASS"]
    : ["MISS em catalog-2, HIT em catalog-3", "TTL 62", `${ttl} s`, `${M.LAB.listTtl} s`, "BYPASS"]);
});
