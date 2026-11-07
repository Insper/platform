import { load, test, ok, fmt, tipHas } from "./lib.mjs";

const M = load("pay-under-chaos");
const L = M.LAB;                         /* lab 9 */

function run(exp, after) {
  const sim = M.make(exp, after);
  const m = M.run(sim);
  return { sim, m, cb: M.transitions(sim) };
}
const R = {};
for (const exp of Object.keys(M.EXPS)) R[exp] = { before: run(exp, false), after: run(exp, true) };
const s1 = ms => ms / 1000;

test("each experiment uses the toxic and the variables of the lab page", () => {
  const c = M.config;
  ok(!c("timeout", false).resilience && c("timeout", false).timeoutMs === 0 && c("timeout", true).timeoutMs === L.timeoutMs, "0. unprotected / 1. timeout");
  ok(c("timeout", false).toxic.latency === L.slowLatency, "latency 3000 ms");
  ok(c("retry", false).attempts === 1 && c("retry", true).attempts === L.attempts && c("retry", true).toxic.toxicity === L.resetToxicity, "2. retry");
  ok(c("breaker", true).toxic.type === "disabled" && c("breaker", true).toxic.reenableAt === L.duration * 500, "3. proxy disabled, re-enabled halfway");
  ok(c("bulkhead", false).bulkhead === L.bulkOff && c("bulkhead", true).bulkhead === L.bulkhead && c("bulkhead", true).payRate === L.bulkRate, "4. bulkhead");
});

test("0. unprotected, payment 3 s slow: GET /orders/{id} degrades with pay (the cascade)", () => {
  const { m } = R.timeout.before;
  ok(L.payRate * L.slowLatency / 1000 > L.threads, "the page's premise: 20/s × 3 s = 60 > 50 threads");
  ok(m.browse.med > 1000 && m.browse.p95 > 5000, `browse med ${m.browse.med}, p95 ${m.browse.p95}`);
  ok(m.pay.med > L.slowLatency, `pay med ${m.pay.med}`);
  /* the lab's test run (45 s on a busy laptop): browse med 9.04 s, p95 13.17 s — the same order of magnitude */
  ok(m.browse.med > 9040 / 4 && m.browse.med < 9040 * 4, "browse med within 4× of the lab's 9.04 s");
});

test("1. timeout 1 s: a thread is held 1 s, browse recovers, no payment is confirmed", () => {
  const { m } = R.timeout.after;
  ok(m.pay.p95 < L.timeoutMs + 20 && m.pay.med > L.timeoutMs, `pay ${m.pay.med} / ${m.pay.p95}`);
  ok(m.browse.p95 < 20 && m.confirmed === 0 && m.fastFail === 0, `browse p95 ${m.browse.p95}, confirmed ${m.confirmed}, 503 ${m.fastFail} (unprotected errors are 500)`);
});

test("2. retry: reset_peer 30% fails far fewer than 30% (connections are reused), 3 attempts fail fewer still", () => {
  const b = 1 - R.retry.before.m.confirmed, a = 1 - R.retry.after.m.confirmed;
  ok(b > 0.001 && b < 0.02, `one attempt: ${b} (the lab measured 0.5%)`);
  ok(a < b / 2, `three attempts: ${a} (the lab measured 0.1%)`);
  ok(Math.abs(Math.pow(L.resetToxicity, 3) - 0.027) < 1e-9, "the page's arithmetic: 30% → 2.7%");
});

test("3. circuit breaker: opens after the minimum calls, probes every wait, closes after the proxy comes back", () => {
  const { sim, m, cb } = R.breaker.after;
  const open = cb[0], half = cb.filter(x => x.to === "half"), closed = cb.find(x => x.to === "closed");
  ok(open.to === "open" && open.t < 1000, `first open at ${open.t}`);
  half.forEach((h, i) => ok(h.t - cb[cb.indexOf(h) - 1].t >= L.openMs - 1, `half-open ${i} only after the wait`));
  const back = L.duration * 500;
  ok(closed && closed.t > back && closed.t - back <= L.openMs + 1000, `closed at ${closed && closed.t}, ${closed && closed.t - back} ms after the re-enable`);
  ok(cb.filter(x => x.to === "closed").length === 1 && cb.every(x => x.to !== "half" || x.t < closed.t), "closes once, stays closed");
  const trickle = sim.calls.filter(t => t > 1000 && t < back).length / (back / 1000 - 1);
  ok(trickle < 1, `calls/s while open: ${trickle}`);
  ok(m.fastFail > 0.4 && m.fastFail < 0.6, `fast fail ${m.fastFail}`);
});

test("4. bulkhead: without it the slow-call rule trips and browse slows; with 10, most payments are rejected and browse is fast", () => {
  const b = R.bulkhead.before, a = R.bulkhead.after;
  ok(L.bulkRate * L.bulkLatency / 1000 > L.threads * 0.95, "the page's arithmetic: 70/s × 0.7 s ≈ 49 of 50 threads");
  ok(b.cb.some(x => x.to === "open"), "the breaker's slow-call rule opens it");
  /* the lab's test run: about half of the payments failed fast, browse p95 about 0.75 s */
  ok(b.m.fastFail > 0.35 && b.m.fastFail < 0.7, `before: fast fail ${b.m.fastFail}`);
  ok(b.m.browse.p95 > 300 && b.m.browse.p95 < 1500, `before: browse p95 ${b.m.browse.p95}`);
  /* with the bulkhead: about 85% rejected, browse p95 about 25 ms */
  ok(a.m.rejected > 0.75 && a.m.rejected < 0.9, `after: rejected ${a.m.rejected}`);
  ok(a.m.browse.p95 < 50 && !a.cb.length, `after: browse p95 ${a.m.browse.p95}, breaker transitions ${a.cb.length}`);
});

test("all patterns vs unprotected, payment 3 s slow (the table of Measure it)", () => {
  const a = R.all.after.m;
  ok(a.browse.med < 20 && a.fastFail > 0.99 && a.pay.med < 20, `browse med ${a.browse.med}, fast fail ${a.fastFail}, pay med ${a.pay.med} (lab: 6.5 ms, 100%, 5 ms)`);
  ok(a.callsPerSec < 1, `a trickle of probes: ${a.callsPerSec} calls/s`);
});

test("the tip quotes lab 9 and the model's numbers", () => {
  const sec = (ms, lang, d = 2) => fmt(ms / 1000, d, lang) + " s";
  const pc = (x, lang, d = 0) => fmt(100 * x, d, lang) + "%";
  const T = R.timeout, B = R.breaker.after, BH = R.bulkhead, A = R.all.after.m;
  const opened = B.cb[0].t, closed = B.cb.find(x => x.to === "closed").t, back = L.duration * 500;
  const opens = BH.before.cb.filter(x => x.to === "open").length;
  tipHas("pay-under-chaos", lang => {
    const en = lang === "en";
    return [
      en ? `${L.threads} Tomcat threads, load/pay-under-chaos.js for ${L.duration} s` : `${L.threads} threads do Tomcat, load/pay-under-chaos.js por ${L.duration} s`,
      `med ${sec(T.before.m.browse.med, lang)}`, `p(95) ${sec(T.before.m.browse.p95, lang, 1)}`,
      en ? `k6 drops ${T.before.m.dropped} iterations` : `o k6 descarta ${T.before.m.dropped} iterações`,
      en ? `every pay takes ${sec(T.after.m.pay.med, lang)} and fails` : `todo pay leva ${sec(T.after.m.pay.med, lang)} e falha`,
      `p(95) ${fmt(T.after.m.browse.p95, 0, lang)} ms`,
      en ? `${pc(1 - R.retry.before.m.confirmed, lang, 1)} of the payments fail` : `${pc(1 - R.retry.before.m.confirmed, lang, 1)} dos pagamentos falham`,
      en ? `with ${L.attempts} attempts, ${pc(1 - R.retry.after.m.confirmed, lang, 1)}` : `com ${L.attempts} tentativas, ${pc(1 - R.retry.after.m.confirmed, lang, 1)}`,
      en ? `it opens ${sec(opened, lang, 1)} into the run` : `ele abre ${sec(opened, lang, 1)} depois do início`,
      en ? `the proxy comes back at ${s1(back)} s and the breaker closes at ${sec(closed, lang, 1)}` : `o proxy volta em ${s1(back)} s e o breaker fecha em ${sec(closed, lang, 1)}`,
      en ? `opens the breaker ${opens} times` : `abre o breaker ${opens} vezes`,
      en ? `${pc(BH.before.m.fastFail, lang)} of the payments fail fast and browse p95 is ${fmt(BH.before.m.browse.p95, 0, lang)} ms` : `${pc(BH.before.m.fastFail, lang)} dos pagamentos falham rápido e o p95 do browse é ${fmt(BH.before.m.browse.p95, 0, lang)} ms`,
      en ? `${pc(BH.after.m.rejected, lang)} of the payments are rejected at once` : `${pc(BH.after.m.rejected, lang)} dos pagamentos são rejeitados na hora`,
      en ? `browse p95 ${fmt(BH.after.m.browse.p95, 0, lang)} ms` : `p95 do browse ${fmt(BH.after.m.browse.p95, 0, lang)} ms`,
      en ? `browse med ${fmt(A.browse.med, 1, lang)} ms` : `mediana do browse ${fmt(A.browse.med, 1, lang)} ms`,
      `pay_fast_fail ${pc(A.fastFail, lang)}`,
    ];
  });
});
