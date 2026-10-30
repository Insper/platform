import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const D = load("dns");
const SECS = 600;
const s300 = D.summary({ ttl: 300 }, SECS), s30 = D.summary({ ttl: 30 }, SECS), s10 = D.summary({ ttl: 10 }, SECS);
const ch = D.changeRun({ ttl: 300 }, 120);
const pct = (x, lang) => fmt(100 * x, 1, lang) + "%";

test("a resolver asks the authoritative servers once per TTL, at most", () => {
  const st = D.create({ ttl: 60 });
  for (let i = 0; i < 600; i++) D.tick(st);
  st.res.forEach((r, i) => ok(r.auth <= Math.ceil(600 / 60) + 1, `resolver ${i}: ${r.auth} authoritative queries`));
  eq(st.total.queries, st.total.hits + st.total.auth, "every query is a hit or a miss");
});

test("a shorter TTL means more authoritative queries and a lower hit ratio", () => {
  console.log(`       ${SECS} s, ${s300.queries} queries: TTL 300 → ${s300.auth} auth (${(100 * s300.hit).toFixed(1)}%), 30 → ${s30.auth} (${(100 * s30.hit).toFixed(1)}%), 10 → ${s10.auth} (${(100 * s10.hit).toFixed(1)}%)`);
  eq([s300.queries, s30.queries, s10.queries].every(q => q === s300.queries), true, "same clients, same queries");
  ok(s300.auth < s30.auth && s30.auth < s10.auth, "load grows as the TTL shrinks");
  ok(s300.hit > s30.hit && s30.hit > s10.hit, "hit ratio falls as the TTL shrinks");
});

test("after a change, stale answers stop within one TTL", () => {
  console.log(`       TTL 300, change at t = 120 s: ${ch.stale} stale answers, last ${ch.lastStale.toFixed(1)} s after the change (bound ${ch.bound.toFixed(1)} s), by resolver ${ch.st.lastStaleBy}`);
  ok(ch.stale > 0, "some clients got the old address");
  ok(ch.lastStale <= ch.bound && ch.bound <= 300, "within the TTL");
  eq(ch.st.lastStaleBy, 0, "the busiest resolver served the last stale answer");
  const short = D.changeRun({ ttl: 30 }, 120);
  ok(short.lastStale <= 30 && short.stale < ch.stale, "a short TTL spreads the change quickly");
});

test("the tip quotes the model's numbers", () => {
  tipHas("dns", lang => {
    const n = x => fmt(x, 0, lang);
    return lang === "en" ? [
      `of ${n(s300.queries)} client queries, ${pct(s300.hit, lang)} are answered from a cache and only ${s300.auth} reach the authoritative servers`,
      `the authoritative servers get ${s30.auth} queries and the hit ratio is ${pct(s30.hit, lang)}; at 10 s, ${s10.auth} queries (${pct(s10.hit, lang)})`,
      `pause at t = 120 s`,
      `the last old answer goes out ${Math.round(ch.lastStale)} s after the change — ${n(ch.stale)} answers with the old IP`
    ] : [
      `das ${n(s300.queries)} consultas dos clientes, ${pct(s300.hit, lang)} são respondidas por um cache e só ${s300.auth} chegam aos servidores autoritativos`,
      `os servidores autoritativos recebem ${s30.auth} consultas e a taxa de acerto é ${pct(s30.hit, lang)}; com 10 s, ${s10.auth} consultas (${pct(s10.hit, lang)})`,
      `pause em t = 120 s`,
      `a última resposta antiga sai ${Math.round(ch.lastStale)} s após a mudança — ${n(ch.stale)} respostas com o IP antigo`
    ];
  });
});
