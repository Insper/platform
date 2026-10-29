import { load, test, ok, fmt, tipHas } from "./lib.mjs";

const A = load("autoscale");
const L = A.LAB, M = A.MODEL;            /* lab 10's HPA and resources; the page's JVM start-up */
const flash = A.traffic("flash", 3), daily = A.traffic("daily", 3);
const SPIKE = 300, DIP = 990, BACK = 1080;   /* 10:00, 10:11:30 and 10:13 in the traffic patterns */
const SLOW_START = 120;                  /* the tip's "raise the start-up to 120 s" */

const def = A.simulate(flash, {}), slow = A.simulate(flash, { startup: SLOW_START });
const pre = (() => { for (let m = L.min; m <= L.max; m++) { const r = A.simulate(flash, { min: m }); if (r.dropped === 0) return { min: m, r }; } })();
const full = A.simulate(flash, { min: L.max });
const keep = A.simulate(daily, {}), flap = A.simulate(daily, { stabilization: 0 });
const at = (r, s) => r.series.find(q => q.t === s);
const cpuPeak = r => Math.round(Math.max(...r.series.filter(q => q.t > BACK && q.t < BACK + 120).map(q => q.cpu)));
const changes = r => r.series.filter((q, i) => i && q.pods !== r.series[i - 1].pods).length;
const wantMax = def.series.find(q => q.pods === L.max).t - SPIKE;
const readyMax = def.series.find(q => q.ready === L.max).t - SPIKE - wantMax;

test("scale-up follows the lab's policies and never passes max", () => {
  const per = L.upPeriod / A.DT;
  for (let i = per; i < def.series.length; i++) {
    const a = def.series[i - per].pods, b = def.series[i].pods;
    ok(b <= Math.max(Math.ceil(a * (1 + L.upPercent / 100)), a + L.upPods), `${a} → ${b} in ${L.upPeriod} s at ${def.series[i].t} s`);
    ok(b <= L.max, "max");
  }
});

test("scale-down removes at most downPods per downPeriod", () => {
  const per = L.downPeriod / A.DT;
  for (const r of [keep, flap]) for (let i = per; i < r.series.length; i++) {
    ok(r.series[i - per].pods - r.series[i].pods <= L.downPods, `too fast at ${r.series[i].t} s`);
  }
});

test("the on-sale spike: requests are lost while new pods start, and longer start-up loses more", () => {
  const fast = A.simulate(flash, { startup: 10 });
  ok(def.dropped > 0 && def.firstOver > SPIKE, `lost ${def.dropped}, from ${def.firstOver} s`);
  ok(fast.dropped < def.dropped && def.dropped < slow.dropped, "start-up time drives the loss");
  ok(readyMax === M.startup, `the last pod is ready start-up seconds after it is wanted: ${readyMax}`);
});

test("pre-scaling (a higher minReplicas) removes the loss and costs replica-minutes", () => {
  ok(pre && pre.min > L.min, "some min removes the loss");
  ok(pre.r.replicaMinutes > def.replicaMinutes && full.replicaMinutes > pre.r.replicaMinutes, "costs more");
});

test("a gradual daily ramp: the HPA keeps up, CPU stays near the target", () => {
  ok(keep.dropped === 0, `dropped ${keep.dropped}`);
  ok(keep.series.filter(q => q.t > 120 && q.t < 900).every(q => q.cpu < 2.5 * L.target), "CPU near the target");
});

test("the scale-down window keeps pods through a short dip; without it the HPA removes them and re-adds them", () => {
  ok(at(keep, DIP).pods > at(flap, DIP).pods && at(keep, BACK).ready > at(flap, BACK).ready, "fewer pods without the window");
  ok(cpuPeak(flap) > cpuPeak(keep) && changes(flap) > changes(keep), "a higher CPU peak and more changes");
});

test("the tip quotes lab 10 and the model's numbers", () => {
  if (L.upPercent !== 100) throw new Error(`the tip says "double" (upPercent 100), the lab now has ${L.upPercent}%: rewrite it`);
  const near = (v, step) => Math.round(v / step) * step;
  const pct = (r, lang) => fmt(100 * r.dropped / r.total, 1, lang) + "%";
  const cpu = (L.limit % 1000 ? L.limit + "m" : L.limit / 1000);
  const absorb = L.min * L.limit / M.cpuPerReq;
  tipHas("autoscale", lang => lang === "en" ? [
    `target ${L.target}% CPU, ${L.min} to ${L.max} pods, scale up by double or +${L.upPods} pods every ${L.upPeriod} s, scale down ${L.downPods} pod per ${L.downPeriod} s after a ${L.stabilization} s window`,
    `Each pod requests ${L.request}m and may burst to its ${cpu}-CPU limit, so ${L.min} pods absorb up to ${fmt(absorb, 0, lang)} requests/s`,
    `The start-up time (${M.startup} s)`,
    `the HPA wants ${L.max} pods within ${wantMax} s, but they are ready only ${readyMax} s later`,
    `about ${fmt(near(def.dropped, 100), 0, lang)} requests (${pct(def, lang)}) dropped or slow in ${def.overSec} s over capacity`,
    `Raise the start-up to ${SLOW_START} s: about ${fmt(near(slow.dropped, 1000), 0, lang)} (${pct(slow, lang)})`,
    `to ${pre.min} and nothing is lost, for ${fmt(pre.r.replicaMinutes, 0, lang)} replica-minutes instead of ${fmt(def.replicaMinutes, 0, lang)}; min ${L.max} costs ${fmt(full.replicaMinutes, 0, lang)}`,
    `with the ${L.stabilization} s window the HPA still has ${at(keep, DIP).pods} pods at 10:11:30 and ${at(keep, BACK).ready} when the traffic returns at 10:13 (CPU peaks at ${cpuPeak(keep)}%)`,
    `it is down to ${at(flap, BACK).ready}, and CPU peaks at ${cpuPeak(flap)}% — ${fmt(flap.replicaMinutes, 0, lang)} replica-minutes instead of ${fmt(keep.replicaMinutes, 0, lang)}`,
  ] : [
    `alvo de ${L.target}% de CPU, de ${L.min} a ${L.max} pods, sobe dobrando ou +${L.upPods} pods a cada ${L.upPeriod} s, desce ${L.downPods} pod a cada ${L.downPeriod} s depois de uma janela de ${L.stabilization} s`,
    `Cada pod pede ${L.request}m e pode ir até o limite de ${cpu} CPU, então ${L.min} pods absorvem até ${fmt(absorb, 0, lang)} requisições/s`,
    `O tempo de início (${M.startup} s)`,
    `o HPA quer ${L.max} pods em ${wantMax} s, mas eles só ficam prontos ${readyMax} s depois`,
    `cerca de ${fmt(near(def.dropped, 100), 0, lang)} requisições (${pct(def, lang)}) perdidas ou lentas em ${def.overSec} s acima da capacidade`,
    `Suba o início do pod para ${SLOW_START} s: cerca de ${fmt(near(slow.dropped, 1000), 0, lang)} (${pct(slow, lang)})`,
    `em ${pre.min} e nada se perde, por ${fmt(pre.r.replicaMinutes, 0, lang)} réplica-minutos em vez de ${fmt(def.replicaMinutes, 0, lang)}; mínimo ${L.max} custa ${fmt(full.replicaMinutes, 0, lang)}`,
    `com a janela de ${L.stabilization} s o HPA ainda tem ${at(keep, DIP).pods} pods às 10:11:30 e ${at(keep, BACK).ready} quando o tráfego volta, às 10:13 (a CPU chega a ${cpuPeak(keep)}%)`,
    `ele está com ${at(flap, BACK).ready}, e a CPU chega a ${cpuPeak(flap)}% — ${fmt(flap.replicaMinutes, 0, lang)} réplica-minutos em vez de ${fmt(keep.replicaMinutes, 0, lang)}`,
  ]);
});
