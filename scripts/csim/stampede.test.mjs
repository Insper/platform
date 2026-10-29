import { load, test, eq, ok, tipHas, fmt } from "./lib.mjs";

const S = load("stampede");
const { ttl: TTL, jitter: JIT } = S.LAB;
const CAP = S.WORKERS / S.DELTA;   // queries/s the database can run
const go = c => S.stats(S.simulate({ ttl: TTL, rate: S.RATE, ...c }), S.DURATION);
const show = (name, s) => console.log(`       ${name.padEnd(22)} peak ${s.peakPerSec}/s, p99 ${Math.round(s.p99)} ms, waited ${s.waited}, DB queries ${s.dbQueries}`);

const none = go({}), coal = go({ coalesce: true }), xf = go({ xfetch: true }), jit = go({ jitter: JIT / 100 });
const cj = go({ coalesce: true, jitter: JIT / 100 }), all = go({ coalesce: true, xfetch: true, jitter: JIT / 100 });

test("no protection: the expiry sends far more queries than the database can run", () => {
  show("none", none);
  ok(none.peakPerSec > 5 * CAP, `peak ${none.peakPerSec} vs capacity ${CAP}`);
  ok(none.p99 > 1000, "p99 above a second");
  eq(none.waited, 0, "nobody waits for another's load");
});

test("coalescing: one load per key, the other misses wait for it", () => {
  show("coalescing", coal);
  ok(coal.dbQueries < none.dbQueries / 5, "far fewer queries");
  ok(coal.waited > 100 && coal.p99 <= 250, "requests wait, but briefly");
  const run = S.simulate({ ttl: TTL, rate: S.RATE, coalesce: true });
  const hot = run.queries.filter(q => q.k === 0);
  for (let i = 1; i < hot.length; i++) ok(hot[i].submit >= hot[i - 1].end, "two loads of the hot key overlapped");
});

test("XFetch: the hot key is refreshed before it expires, nobody waits", () => {
  show("XFetch", xf);
  const run = S.simulate({ ttl: TTL, rate: S.RATE, xfetch: true });
  const hotMisses = run.reqs.filter(r => r.k === 0 && r.kind === "miss").length;
  eq([hotMisses, xf.waited], [0, 0], "hot misses, waits");
  ok(xf.peakPerSec < none.peakPerSec / 3, "a much lower peak");
});

test("TTL jitter spreads keys cached together: lower peak with coalescing", () => {
  show("jitter", jit); show("coalescing + jitter", cj); show("all three", all);
  ok(cj.peakPerSec < coal.peakPerSec / 2, `peak ${cj.peakPerSec} vs ${coal.peakPerSec}`);
  ok(jit.peakPerSec > CAP, "jitter alone does not save the hot key");
  ok(all.peakPerSec <= CAP, "all three keep the peak under capacity");
});

test("the simulation is deterministic (same fans for every switch)", () => {
  const a = S.simulate({ ttl: TTL, rate: S.RATE }), b = S.simulate({ ttl: TTL, rate: S.RATE, coalesce: true });
  eq(a.reqs.length, b.reqs.length, "same arrivals");
  eq(S.stats(a, S.DURATION), none, "replay");
});

test("the tip quotes the model's numbers", () => {
  tipHas("stampede", lang => {
    const en = lang === "en", n = x => fmt(x, 0, lang), ms = x => n(x) + " ms";
    const pages = 1 + S.OTHERS, p99s = n(none.p99 / 1000) + " s";
    return en ? [
      `the hot event page (${n(S.RATE)} reads/s) and ${S.OTHERS} others with the same ${TTL} s TTL`,
      `runs ${S.WORKERS} queries of ${ms(S.DELTA * 1000)} at a time (${n(CAP)}/s)`,
      `at t = ${TTL} s the queries jump to about ${n(none.peakPerSec)}/s`,
      `p99 reaches about ${p99s}, with ${n(none.dbQueries)} queries in ${S.DURATION} s for ${pages} pages`,
      `${n(coal.dbQueries)} queries, p99 ${ms(coal.p99)}, and ${n(coal.waited)} requests wait`,
      `The ${n(coal.peakPerSec)}/s peak that remains is the ${S.OTHERS} pages expiring together`,
      `(lab 5's ${JIT}%) and it falls to ${n(cj.peakPerSec)}/s`,
      `(${n(xf.dbQueries)} queries, peak ${n(xf.peakPerSec)}/s`,
      `the peak stays under capacity, at ${n(all.peakPerSec)}/s`
    ] : [
      `a página do evento quente (${n(S.RATE)} leituras/s) e outras ${S.OTHERS} com o mesmo TTL de ${TTL} s`,
      `executa ${S.WORKERS} consultas de ${ms(S.DELTA * 1000)} por vez (${n(CAP)}/s)`,
      `em t = ${TTL} s as consultas saltam para cerca de ${n(none.peakPerSec)}/s`,
      `o p99 chega a cerca de ${p99s}, com ${n(none.dbQueries)} consultas em ${S.DURATION} s para ${pages} páginas`,
      `${n(coal.dbQueries)} consultas, p99 de ${ms(coal.p99)}, e ${n(coal.waited)} requisições esperam`,
      `O pico de ${n(coal.peakPerSec)}/s que sobra são as ${S.OTHERS} páginas expirando juntas`,
      `(os ${JIT}% do lab 5) e ele cai para ${n(cj.peakPerSec)}/s`,
      `(${n(xf.dbQueries)} consultas, pico de ${n(xf.peakPerSec)}/s`,
      `o pico fica abaixo da capacidade, em ${n(all.peakPerSec)}/s`
    ];
  });
  ok(all.peakPerSec <= CAP && xf.waited === 0, "the tip says all three stay under capacity and XFetch makes nobody wait");
});
