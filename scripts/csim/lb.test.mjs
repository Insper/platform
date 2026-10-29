import { load, test, eq, ok, fmt, tipHas } from "./lib.mjs";

const L = load("lb");

/* the page's default: 100 req/s, 4 replicas of ~40 req/s; 10 s healthy, then catalog-3 ×5 slower */
function run(healthy, slowFor, o = {}) {
  const sim = L.create({ rate: 100, seed: 7, ...o });
  for (let i = 0; i < healthy / 200; i++) L.advance(sim, 200);
  const before = Object.fromEntries(L.ALGOS.map(a => [a, L.metrics(sim, a)]));
  sim.slow = true;
  for (let i = 0; i < slowFor / 200; i++) L.advance(sim, 200);
  const after = Object.fromEntries(L.ALGOS.map(a => [a, L.metrics(sim, a)]));
  return { before, after };
}

test("round robin cycles through the replicas in order", () => {
  const sim = L.create({ rate: 100, seed: 1 });
  L.advance(sim, 2000);
  const recs = sim.runs.rr.recs.slice(0, 8).map(r => r.r);
  eq(recs, [0, 1, 2, 3, 0, 1, 2, 3], "order");
});

test("all algorithms see the same requests", () => {
  const sim = L.create({ rate: 100, seed: 3 });
  L.advance(sim, 3000);
  const n = L.ALGOS.map(a => sim.runs[a].routed.reduce((x, y) => x + y, 0));
  ok(n.every(x => x === n[0]) && n[0] > 250, `routed counts ${n}`);
});

test("healthy replicas: every algorithm keeps p99 low", () => {
  const { before } = run(10000, 0);
  for (const a of L.ALGOS) ok(before[a].p99 < 300, `${a} p99 ${before[a].p99}`);
  ok(before.lc.p99 <= before.random.p99, "least connections beats random");
});

test("a slow replica: round robin keeps feeding it, least connections and P2C route around it", () => {
  const { before, after } = run(10000, 10000);
  ok(Math.abs(after.rr.share[L.SLOW] - 0.25) < 0.01, `rr share ${after.rr.share[L.SLOW]}`);
  ok(after.lc.share[L.SLOW] < 0.12 && after.p2c.share[L.SLOW] < 0.15, "lc and p2c send little to the slow replica");
  ok(after.rr.p99 > 10 * after.lc.p99 && after.rr.p99 > 10 * after.p2c.p99, "rr p99 explodes");
  ok(after.rr.maxQueue > 100 && after.lc.maxQueue < 10, "rr's queue on catalog-3 keeps growing");
  const f = v => (v / 1000).toFixed(1);
  console.log(`       healthy p99: ${L.ALGOS.map(a => `${a} ${Math.round(before[a].p99)} ms`).join(", ")}`);
  console.log(`       10 s after the slowdown: ${L.ALGOS.map(a => `${a} p99 ${f(after[a].p99)} s, p50 ${Math.round(after[a].p50)} ms, queue ${after[a].maxQueue - 1}, share ${Math.round(100 * after[a].share[L.SLOW])}%`).join("; ")}`);
});

test("round robin's p50 hides the problem: only the slow quarter waits", () => {
  const { after } = run(10000, 10000);
  ok(after.rr.p50 < 100 && after.rr.p99 > 5000, `p50 ${after.rr.p50}, p99 ${after.rr.p99}`);
});

test("the tip quotes the model's numbers and lab 3's least_conn", () => {
  const RATE = 100, FACTOR = 5;                     /* the page's data-rate and data-factor */
  const { before, after } = run(10000, 10000, { rate: RATE, factor: FACTOR });
  const each = 1000 / L.create({}).service;
  const r = (v, step) => Math.round(v / step) * step;
  const pc = f => Math.round(100 * f) + "%";
  const n = (v, d, lang) => fmt(v, d, lang);
  tipHas("lb", lang => lang === "en" ? [
    `same ${RATE} requests/s to four catalog replicas of about ${n(each, 0, lang)} requests/s each`,
    `all p99s stay low (about ${r(before.rr.p99, 100)} ms; random about ${r(before.random.p99, 100)} ms`,
    `keeps sending it ${pc(after.rr.share[L.SLOW])} of the requests, more than its ${n(each / FACTOR, 0, lang)}/s`,
    `its queue holds about ${r(after.rr.maxQueue - 1, 10)} requests and the p99 reaches about ${n(after.rr.p99 / 1000, 0, lang)} s`,
    `the p50 stays near ${r(after.rr.p50, 10)} ms`,
    `only about ${pc(after.lc.share[L.SLOW])} and ${pc(after.p2c.share[L.SLOW])} of the traffic and the p99 stays around ${n(after.lc.p99 / 1000, 1, lang)} s and ${n(after.p2c.p99 / 1000, 1, lang)} s`,
    "least_conn",
  ] : [
    `mesmas ${RATE} requisições/s para quatro réplicas de catalog de cerca de ${n(each, 0, lang)} requisições/s cada`,
    `todos os p99 ficam baixos (cerca de ${r(before.rr.p99, 100)} ms; o aleatório, cerca de ${r(before.random.p99, 100)} ms`,
    `continua mandando para ele ${pc(after.rr.share[L.SLOW])} das requisições, mais do que as suas ${n(each / FACTOR, 0, lang)}/s`,
    `a fila dele tem cerca de ${r(after.rr.maxQueue - 1, 10)} requisições e o p99 chega a cerca de ${n(after.rr.p99 / 1000, 0, lang)} s`,
    `o p50 fica perto de ${r(after.rr.p50, 10)} ms`,
    `só cerca de ${pc(after.lc.share[L.SLOW])} e ${pc(after.p2c.share[L.SLOW])} do tráfego e o p99 fica em torno de ${n(after.lc.p99 / 1000, 1, lang)} s e ${n(after.p2c.p99 / 1000, 1, lang)} s`,
    "least_conn",
  ]);
});
