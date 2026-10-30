import { load, test, eq, ok, fmt, tipHas } from "./lib.mjs";

const R = load("rate-limiter");
const L = R.LAB.limit, BURST = R.LAB.burst;          /* lab 3's Nginx */

const run = (algo, pat, burst = BURST) => {
  const r = R.simulate(algo, R.pattern(pat, L, 11), L, burst);
  return { ...r, sum: R.summary(r, R.T) };
};
const inside = (r, a, b) => r.res.filter(q => q.ok && q.t >= a && q.t <= b).length;

test("the page's trace: 10 at t=0.99 s and 10 at t=1.01 s, limit 10/s", () => {
  const trace = [...Array(10).fill(990), ...Array(10).fill(1010)];
  const allowed = a => { const lim = R.limiter(a, 10, 10); return trace.filter(t => lim.allow(t).ok).length; };
  eq(["fixed", "log", "counter", "token"].map(allowed), [20, 10, 11, 10], "fixed 20, log 10, counter 11, token 10 (same as the Python cell)");
});

test("a burst straddling a window boundary: the fixed window lets 2× the limit through", () => {
  const f = run("fixed", "boundary"), lg = run("log", "boundary");
  ok(f.sum.maxSpan === 2 * L, `fixed window max in 1 s ${f.sum.maxSpan}`);
  ok(lg.sum.maxSpan <= L, `sliding log max ${lg.sum.maxSpan}`);
  console.log(`       boundary pattern: fixed window max ${f.sum.maxSpan} in ${(f.sum.spanTo - f.sum.spanFrom) / 1000} s; ` +
    R.ALGOS.map(a => { const r = run(a, "boundary"); return `${a} ${r.sum.accepted}/${r.sum.rejected} max ${r.sum.maxSpan}`; }).join(", "));
});

test("at each boundary the sliding log rejects the second half of the burst, the fixed window accepts it", () => {
  const lg = run("log", "boundary"), f = run("fixed", "boundary");
  for (const b of [1000, 3000]) {
    eq([inside(lg, b - 100, b - 1), inside(lg, b + 1, b + 100)], [L, 0], `log at ${b}`);
    eq([inside(f, b - 100, b - 1), inside(f, b + 1, b + 100)], [L, L], `fixed at ${b}`);
  }
});

test("the token bucket allows a burst up to its capacity, then the refill rate", () => {
  const lim = R.limiter("token", L, BURST);
  let n = 0;
  for (let i = 0; i < 100; i++) if (lim.allow(1000).ok) n++;
  eq(n, BURST, "a full bucket lets exactly `burst` through at once");
  let later = 0;
  for (let t = 1001; t <= 2000; t++) if (lim.allow(t).ok) later++;
  ok(Math.abs(later - L) <= 1, `then about ${L}/s, got ${later}`);
  ok(run("token", "boundary").sum.maxSpan > run("token", "boundary", L).sum.maxSpan, "a bigger bucket lets a bigger burst through");
});

test("the leaky bucket smooths: the backend never sees more than the rate, requests wait instead", () => {
  for (const p of R.PATTERNS) ok(run("leaky", p).sum.maxSpan <= L + 1, `${p}: backend max ${run("leaky", p).sum.maxSpan}`);
  ok(run("leaky", "bursty").sum.maxWait > 1000, "queued requests wait");
});

test("steady traffic at 1.5× the limit: the windows accept about the limit per second", () => {
  for (const a of ["fixed", "log", "counter"]) {
    const r = run(a, "steady");
    ok(Math.abs(r.sum.accepted - 5 * L) <= 2, `${a} accepted ${r.sum.accepted} in 5 s`);
  }
});

test("the tip quotes the lab's limits and the model's numbers", () => {
  const f = run("fixed", "boundary").sum, lg = run("log", "boundary").sum;
  const tb = run("token", "boundary").sum, tbL = run("token", "boundary", L).sum, lk = run("leaky", "bursty").sum;
  tipHas("rate-limiter", lang => lang === "en" ? [
    `${L} requests/s per API key and a burst of ${BURST}`,
    `${L} requests just before it, ${L} just after`,
    `${f.maxSpan} requests reach the backend in about ${fmt((f.spanTo - f.spanFrom) / 1000, 1, lang)} s, ${fmt(f.maxSpan / L, 0, lang)}× the limit`,
    `never sees more than ${lg.maxSpan} in any second`,
    `${tb.maxSpan} requests in the busiest second`,
    `capacity down to ${L} and the busiest second drops to ${tbL.maxSpan}`,
    `a steady ${lk.maxSpan} per second`,
    `waits up to ${fmt(lk.maxWait / 1000, 2, lang)} s`,
  ] : [
    `${L} requisições/s por chave de API e burst de ${BURST}`,
    `${L} requisições logo antes, ${L} logo depois`,
    `${f.maxSpan} requisições chegam ao backend em cerca de ${fmt((f.spanTo - f.spanFrom) / 1000, 1, lang)} s, ${fmt(f.maxSpan / L, 0, lang)}× o limite`,
    `nunca vê mais que ${lg.maxSpan} em um segundo qualquer`,
    `${tb.maxSpan} requisições no segundo mais movimentado`,
    `capacidade para ${L} e o segundo mais movimentado cai para ${tbL.maxSpan}`,
    `${lk.maxSpan} por segundo constantes`,
    `espera até ${fmt(lk.maxWait / 1000, 2, lang)} s`,
  ]);
});
