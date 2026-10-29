import { load, test, ok, near } from "./lib.mjs";

const Q = load("queue");
const page = { lambda: 167, service: 0.4 };          // the page's flash-sale example: 167 PDFs/s, 0.4 s each

test("Little's law holds in the measurements: L = λ·W", () => {
  for (const K of [95, 70, 60]) {
    const m = Q.little(Q.run({ ...page, workers: K }, 300).st);
    near(m.L, m.lambda * m.W, 0.05 * m.L, `K=${K}`);
  }
});

test("95 workers: ρ ≈ 0.70, about 67 busy, W ≈ S", () => {
  const m = Q.little(Q.run({ ...page, workers: 95 }, 300).st);
  console.log(`       K=95: ρ=${Q.rho(167, 95, 0.4).toFixed(2)}, L=${m.L.toFixed(1)}, λ=${m.lambda.toFixed(0)}/s, W=${m.W.toFixed(2)} s, theory W=${Q.theoryW(167, 95, 0.4).toFixed(2)} s`);
  near(Q.rho(167, 95, 0.4), 0.70, 0.01, "ρ");
  near(m.L, 67, 4, "L ≈ λ·S");
  near(m.W, 0.4, 0.03, "W ≈ S");
});

test("the wait grows as ρ → 1 and the backlog has no bound above 1", () => {
  const w = [95, 70, 68].map(K => Q.theoryW(167, K, 0.4));
  console.log(`       theory W: K=95 ${w[0].toFixed(2)} s, K=70 (ρ ${Q.rho(167, 70, 0.4).toFixed(2)}) ${w[1].toFixed(2)} s, K=68 (ρ ${Q.rho(167, 68, 0.4).toFixed(2)}) ${w[2].toFixed(2)} s`);
  ok(w[0] < w[1] && w[1] < w[2], "monotonic");
  ok(Q.theoryW(167, 66, 0.4) === Infinity, "ρ ≥ 1 has no steady state");
  const a = Q.run({ ...page, workers: 60 }, 120).st, b = Q.run({ ...page, workers: 60 }, 240).st;
  console.log(`       K=60 (ρ ${Q.rho(167, 60, 0.4).toFixed(2)}): ${Q.waiting(a)} waiting after 120 s, ${Q.waiting(b)} after 240 s`);
  ok(Q.waiting(b) > 1.6 * Q.waiting(a), "backlog keeps growing");
});

test("the on-sale spike builds a backlog that drains at the spare capacity; scaling on backlog drains it sooner", () => {
  const drain = auto => {
    const s = Q.create({ ...page, workers: 95, autoscale: auto });
    let peak = 0, age = 0, done = null;
    for (let i = 0; i < 300; i++) {
      if (s.t === 30) Q.spike(s);
      Q.step(s);
      peak = Math.max(peak, Q.waiting(s)); age = Math.max(age, Q.oldest(s));
      if (s.t > 30 + Q.BURST_S && done === null && Q.waiting(s) === 0) done = s.t - 30;
    }
    return { peak, age, done };
  };
  const fixed = drain(false), auto = drain(true);
  console.log(`       spike at t=30: fixed 95 workers peak ${fixed.peak} waiting, oldest ${fixed.age.toFixed(0)} s, empty ${fixed.done} s after the spike began; autoscaled peak ${auto.peak}, oldest ${auto.age.toFixed(0)} s, empty after ${auto.done} s`);
  ok(fixed.peak > 4000 && fixed.done > 80, "fixed pool: long drain");
  ok(auto.done < fixed.done / 2 && auto.age < fixed.age, "autoscaling drains sooner");
});
