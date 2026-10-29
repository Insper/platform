import { load, test, ok, fmt, tipHas } from "./lib.mjs";

const R = load("resilience");
const L = R.LAB;                        /* lab 9 */
const SLOW = 4000, HEALTHY = 200;       /* the story: 4 s instead of 200 ms */

function after(ms, o) {
  const sim = R.create({ latency: SLOW, errors: 0, seed: 5, ...o });
  R.advance(sim, ms);
  return { sim, m: R.metrics(sim) };
}

/* the four steps of the tip */
const none = after(30000, {});
const tmo = after(30000, { timeout: true });
const rtr = after(30000, { timeout: true, retries: true });
const all = (() => {
  const sim = R.create({ latency: SLOW, errors: 0, timeout: true, retries: true, breaker: true, seed: 5 });
  R.advance(sim, 5000);
  const open = sim.events.find(e => e.text.to === "open"), m = R.metrics(sim);
  const halfEarly = sim.events.some(e => e.text.to === "half" && e.t - open.t < L.openMs);
  sim.latency = HEALTHY;                /* the provider recovers at t = 5 s */
  R.advance(sim, 15000);
  const half = sim.events.find(e => e.text.to === "half"), closed = sim.events.find(e => e.text.to === "closed");
  R.advance(sim, 5000);
  return { open, m, halfEarly, half, closed, end: R.metrics(sim) };
})();

test("a healthy provider: every payment succeeds with a handful of threads", () => {
  const { m } = after(20000, { latency: HEALTHY, timeout: true, retries: true, breaker: true });
  ok(m.success === 1 && m.busy < 10 && m.breaker === "closed", JSON.stringify(m));
});

test("no timeout and a slow provider: the thread pool saturates (Little's Law)", () => {
  ok(L.rate * SLOW / 1000 > L.threads, "the page's premise: rate × latency exceeds the pool");
  ok(none.m.busy >= L.threads - 2 && none.sim.rejected > 100, `busy ${none.m.busy}, no thread ${none.sim.rejected}`);
});

test("a timeout frees the threads, but every call to a provider slower than the timeout fails", () => {
  ok(tmo.m.busy <= L.threads / 2 && tmo.m.success === 0, `busy ${tmo.m.busy}, success ${tmo.m.success}`);
});

test("retries amplify the load on the provider and saturate the pool again", () => {
  ok(rtr.m.amplification > 1.7 && tmo.m.amplification < 1.1, `amplification ${rtr.m.amplification} vs ${tmo.m.amplification}`);
  ok(rtr.m.busy >= L.threads - 2, `busy ${rtr.m.busy}`);
  ok(L.rate * R.holdMs(L) / 1000 > L.threads, "rate × hold time exceeds the pool");
});

test("jittered backoff spreads the retries out", () => {
  const sim = R.create({ latency: HEALTHY, errors: 1, seed: 9 });
  for (const n of [1, 2]) {
    const base = L.backoff * Math.pow(L.mult, n - 1), w = [];
    for (let i = 0; i < 200; i++) w.push(R.backoff(sim, n));
    ok(Math.min(...w) >= base * (1 - L.jitter) && Math.max(...w) <= base * (1 + L.jitter), `attempt ${n}: within ± jitter`);
    ok(Math.max(...w) - Math.min(...w) > base * L.jitter * 1.6, `attempt ${n}: spread over the range`);
  }
});

test("the breaker opens, fails fast, probes after the wait and closes once the provider recovers", () => {
  ok(all.open && all.m.busy <= 3 && all.m.callsPerSec <= 3, `fail fast: busy ${all.m.busy}, calls/s ${all.m.callsPerSec}`);
  ok(!all.halfEarly && all.half && all.half.t - all.open.t >= L.openMs, "half-open only after the wait");
  ok(all.closed && all.end.success === 1 && all.end.breaker === "closed", `after recovery ${JSON.stringify(all.end)}`);
  console.log(`       open at ${all.open.t} ms, half-open at ${all.half.t} ms, closed at ${all.closed.t} ms`);
});

test("the tip quotes lab 9 and the model's numbers", () => {
  ok(L.failRate === L.slowRate, "the tip states one threshold for failed and slow calls: split it");
  const tens = v => Math.round(v / 10) * 10;
  const s = (ms, lang) => fmt(ms / 1000, ms % 1000 ? 1 : 0, lang) + " s";
  tipHas("resilience", lang => {
    const en = lang === "en";
    return [
      en ? `a ${s(L.timeoutMs, lang)} read timeout; ${L.attempts} attempts with ${L.backoff} ms × ${L.mult} backoff ± ${fmt(L.jitter * 100, 0, lang)}%; a breaker over the last ${L.window} calls that opens at ${fmt(L.failRate * 100, 0, lang)}% failed or slower than ${L.slowMs} ms and waits ${s(L.openMs, lang)}`
         : `timeout de leitura de ${s(L.timeoutMs, lang)}; ${L.attempts} tentativas com backoff de ${L.backoff} ms × ${L.mult} ± ${fmt(L.jitter * 100, 0, lang)}%; um breaker sobre as últimas ${L.window} chamadas que abre com ${fmt(L.failRate * 100, 0, lang)}% de falhas ou acima de ${L.slowMs} ms e espera ${s(L.openMs, lang)}`,
      en ? `${L.rate} payments/s × ${s(SLOW, lang)} needs ${L.rate * SLOW / 1000} threads; all ${none.m.busy} are busy` : `${L.rate} pagamentos/s × ${s(SLOW, lang)} pedem ${L.rate * SLOW / 1000} threads; as ${none.m.busy} ficam ocupadas`,
      en ? `in 30 s, about ${tens(none.sim.rejected)} payments find no thread` : `em 30 s, cerca de ${tens(none.sim.rejected)} pagamentos não encontram thread`,
      en ? `only about ${tens(tmo.m.busy)} threads are busy, but ${fmt(100 * tmo.m.success, 0, lang)}% of the payments succeed` : `só cerca de ${tens(tmo.m.busy)} threads ficam ocupadas, mas ${fmt(100 * tmo.m.success, 0, lang)}% dos pagamentos dão certo`,
      en ? `about ${fmt(rtr.m.amplification, 0, lang)}× the payments (${rtr.m.callsPerSec} calls/s)` : `cerca de ${fmt(rtr.m.amplification, 0, lang)}× os pagamentos (${rtr.m.callsPerSec} chamadas/s)`,
      en ? `the ${rtr.m.busy} threads are full again — ${L.attempts} attempts of ${s(L.timeoutMs, lang)} plus backoff hold each thread for about ${fmt(R.holdMs(L) / 1000, 1, lang)} s`
         : `as ${rtr.m.busy} threads lotam de novo — ${L.attempts} tentativas de ${s(L.timeoutMs, lang)} mais o backoff prendem cada thread por cerca de ${fmt(R.holdMs(L) / 1000, 1, lang)} s`,
      en ? `it opens ${fmt(all.open.t / 1000, 1, lang)} s into the run` : `ele abre ${fmt(all.open.t / 1000, 1, lang)} s depois do início`,
      en ? `threads drop to about ${all.m.busy}` : `as threads caem para cerca de ${all.m.busy}`,
      en ? `${s(L.openMs, lang)} after opening, the breaker goes half-open, ${L.probes} probes succeed` : `${s(L.openMs, lang)} depois de abrir, o breaker fica semiaberto, ${L.probes} sondas dão certo`,
    ];
  });
});
