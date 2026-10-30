import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const K = load("cache");
const TTL = K.LAB.ttl;
const f1 = x => (100 * x).toFixed(1);
/* seconds 60–300 of a run: past the cold start (the TTL defaults to LAB.ttl) */
const run = o => K.summary(o, 300, 240);
const pct = (x, lang) => fmt(100 * x, 0, lang) + "%";

const aside = run({ strategy: "aside" }), through = run({ strategy: "through" }), ttlOnly = run({ strategy: "ttl" });
const short = run({ strategy: "ttl", ttl: 10 }), small = run({ size: 100 }), big = run({ size: 1000 });

test("LRU: a full cache evicts the least recently used key", () => {
  const st = K.create({ size: 2 });
  K.put(st, 1, 0, 0); K.put(st, 2, 0, 0);
  st.cache.get(1); st.cache.delete(1); st.cache.set(1, { v: 0, exp: TTL });   // touch key 1
  K.put(st, 3, 0, 0);
  eq([...st.cache.keys()], [1, 3], "key 2 was evicted");
});

test("cache-aside (delete on write) and write-through never serve a stale event; TTL only does", () => {
  console.log(`       TTL ${TTL} s, 500 keys: hit ${f1(aside.hit)}%, DB ${aside.dbPerSec.toFixed(1)} reads/s; stale: aside ${f1(aside.stale)}%, through ${f1(through.stale)}%, TTL only ${f1(ttlOnly.stale)}%`);
  eq([aside.stale, through.stale], [0, 0], "no stale reads");
  ok(ttlOnly.stale > 0.05, "TTL only serves stale reads");
});

test("a shorter TTL lowers the hit ratio and, without invalidation, the stale reads", () => {
  console.log(`       TTL only: TTL 10 s → hit ${f1(short.hit)}%, DB ${short.dbPerSec.toFixed(1)}/s, stale ${f1(short.stale)}%; TTL ${TTL} s → hit ${f1(ttlOnly.hit)}%, stale ${f1(ttlOnly.stale)}%`);
  ok(ttlOnly.hit > short.hit + 0.05, "hit ratio grows with the TTL");
  ok(ttlOnly.stale > 3 * short.stale, "stale reads grow with the TTL");
});

test("a small cache evicts the hot set: lower hit ratio, more DB reads", () => {
  console.log(`       TTL ${TTL} s: 100 keys → hit ${f1(small.hit)}%, DB ${small.dbPerSec.toFixed(1)}/s; 1000 keys → hit ${f1(big.hit)}%, DB ${big.dbPerSec.toFixed(1)}/s`);
  ok(small.hit < big.hit - 0.2 && small.dbPerSec > 4 * big.dbPerSec, "size matters");
});

test("a cold cache starts at a low hit ratio and warms up", () => {
  const st = K.create({});
  const first = K.tick(st);
  for (let i = 0; i < 60; i++) K.tick(st);
  const later = K.recent(st, 10);
  ok(first.hits / first.reads < 0.6 && later.hits / later.reads > 0.8, `first second ${first.hits / first.reads}, later ${later.hits / later.reads}`);
});

test("the tip quotes the model's numbers", () => {
  tipHas("cache", lang => {
    const en = lang === "en", n = x => fmt(x, 0, lang);
    return en ? [
      `The TTL starts at ${TTL} s, the CACHE_TTL_EVENT`,
      `around ${pct(aside.hit, lang)} and the database takes about ${n(aside.dbPerSec)} of the ${K.READS} reads/s, with no stale read`,
      `about ${pct(ttlOnly.stale, lang)} of the reads return an event older`,
      `with a 10 s TTL, about ${pct(short.stale, lang)}, but the hit ratio drops to ${pct(short.hit, lang)}`,
      `falls to about ${pct(small.hit, lang)} (${n(small.dbPerSec)} database reads/s)`
    ] : [
      `O TTL começa em ${TTL} s, o CACHE_TTL_EVENT`,
      `perto de ${pct(aside.hit, lang)} e o banco recebe cerca de ${n(aside.dbPerSec)} das ${K.READS} leituras/s, sem nenhuma leitura desatualizada`,
      `cerca de ${pct(ttlOnly.stale, lang)} das leituras devolvem um evento mais velho`,
      `com TTL de 10 s, cerca de ${pct(short.stale, lang)}, mas a taxa de acerto cai para ${pct(short.hit, lang)}`,
      `cai para cerca de ${pct(small.hit, lang)} (${n(small.dbPerSec)} leituras/s no banco)`
    ];
  });
  eq([aside.stale, through.stale], [0, 0], "the tip says delete-on-write and write-through serve no stale read");
});
