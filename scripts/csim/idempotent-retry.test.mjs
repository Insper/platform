import { load, test, ok, eq, fmt, tipHas } from "./lib.mjs";

const M = load("idempotent-retry");
const L = M.LAB;
const run = o => M.simulate(o);
const none = run({ key: "none" }), perAttempt = run({ key: "attempt" }), perOrder = run({ key: "order" });
const slowNone = run({ key: "none", provider: "slow" }), slowOrder = run({ key: "order", provider: "slow" });
const once = run({ key: "none", attempts: 1 });
const LONG = 5000;                                   /* the tip's "a 5 s timeout" */
const longNormal = run({ key: "none", timeout: LONG }), longSlow = run({ key: "none", timeout: LONG, provider: "slow" });

test("every call reaches the provider: each fan is charged at least once", () => {
  for (const r of [none, perOrder, slowNone, slowOrder, once]) ok(r.fans.every(f => f.charges >= 1), "a fan with no charge");
});

test("without a key, every timed-out attempt that is retried is a second charge", () => {
  ok(none.duplicates > 0 && none.extra === none.charges - none.n, "duplicates");
  for (const f of none.fans) eq(f.charges, f.attempts.length, `fan ${f.id}: charges = calls`);
});

test("a new key per attempt is the same as no key", () => {
  eq([perAttempt.charges, perAttempt.duplicates, perAttempt.unknown], [none.charges, none.duplicates, none.unknown], "same numbers");
});

test("one key per order: never more than one charge, whatever the provider", () => {
  for (const r of [perOrder, slowOrder, run({ key: "order", attempts: 5, timeout: 250, provider: "slow" })]) {
    eq(r.duplicates, 0, "duplicates");
    eq(r.charges, r.n, "one charge per fan");
  }
});

test("one attempt: no duplicate, and the fans whose call was slow end UNKNOWN", () => {
  eq(once.duplicates, 0, "duplicates");
  eq(once.unknown, once.fans.filter(f => !f.attempts[0].ok).length, "UNKNOWN = slow calls");
});

test("retries follow lab 9's backoff (200 ms, doubling, ±50%)", () => {
  for (const f of slowNone.fans) for (let k = 1; k < f.attempts.length; k++) {
    const gap = f.attempts[k].start - f.attempts[k - 1].end, base = L.backoff * Math.pow(L.mult, k - 1);
    ok(gap >= base * (1 - L.jitter) - 1e-9 && gap <= base * (1 + L.jitter) + 1e-9, `fan ${f.id}, attempt ${k + 1}: ${gap} ms`);
  }
});

test("the sampled latencies follow the distribution (share over the timeout)", () => {
  ok(Math.abs(none.slowShare - M.tail("normal", L.timeoutMs)) < 0.01, `normal: ${none.slowShare}`);
  ok(Math.abs(slowNone.slowShare - M.tail("slow", L.timeoutMs)) < 0.02, `slow: ${slowNone.slowShare}`);
});

test("the tip quotes lab 9's settings and the model's numbers", () => {
  const P = M.MODEL.price, pct = (v, lang) => fmt(100 * v, 1, lang) + "%";
  const s1 = (ms, lang) => fmt(ms / 1000, 1, lang) + " s";
  tipHas("idempotent-retry", lang => lang === "en" ? [
    `a ${L.timeoutMs / 1000} s read timeout, ${L.attempts} attempts, a ${L.backoff} ms backoff that doubles, ±${L.jitter * 100}% jitter`,
    `${pct(M.tail("normal", L.timeoutMs), lang)} of the calls are slower than ${L.timeoutMs / 1000} s`,
    `${none.duplicates} fans pay twice or more (${none.extra} extra charges, R$ ${fmt(none.extra * P, 0, lang)} to refund)`,
    `0 duplicates. The repeats still cost calls: ${fmt(perOrder.calls, 0, lang)} for ${fmt(perOrder.n, 0, lang)} checkouts`,
    `${pct(M.tail("slow", L.timeoutMs), lang)} of the calls time out. Without a key ${slowNone.duplicates} fans pay twice or more`,
    `but ${slowOrder.unknown} checkouts end UNKNOWN, each charged once`,
    `set attempts to 1: no duplicates, but ${once.unknown} fans are left UNKNOWN`,
    `At ${L.attempts} attempts a ${LONG / 1000} s timeout also removes the duplicates on a normal day, but on the slow day ${longSlow.duplicates} fans still pay twice and the slowest checkout takes ${s1(longSlow.maxWait, lang)}`,
  ] : [
    `timeout de leitura de ${L.timeoutMs / 1000} s, ${L.attempts} tentativas, backoff de ${L.backoff} ms que dobra, jitter de ±${L.jitter * 100}%`,
    `${pct(M.tail("normal", L.timeoutMs), lang)} das chamadas passam de ${L.timeoutMs / 1000} s`,
    `${none.duplicates} fãs pagam duas vezes ou mais (${none.extra} cobranças a mais, R$ ${fmt(none.extra * P, 0, lang)} a estornar)`,
    `0 duplicadas. As repetições ainda custam chamadas: ${fmt(perOrder.calls, 0, lang)} para ${fmt(perOrder.n, 0, lang)} checkouts`,
    `${pct(M.tail("slow", L.timeoutMs), lang)} das chamadas estouram o timeout. Sem chave ${slowNone.duplicates} fãs pagam duas vezes ou mais`,
    `mas ${slowOrder.unknown} checkouts terminam em UNKNOWN, cada um cobrado uma vez`,
    `ponha tentativas em 1: nenhuma duplicada, mas ${once.unknown} fãs ficam em UNKNOWN`,
    `Com ${L.attempts} tentativas um timeout de ${LONG / 1000} s também acaba com as duplicadas num dia normal, mas no dia lento ${longSlow.duplicates} fãs ainda pagam duas vezes e o checkout mais lento leva ${s1(longSlow.maxWait, lang)}`,
  ]);
  eq(longNormal.duplicates, 0, "the tip says a 5 s timeout removes the duplicates on a normal day");
});
