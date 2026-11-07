import { load, test, eq, ok, near, tipHas, fmt } from "./lib.mjs";

const M = load("catalog-slo-alert");
const L = M.LAB;
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const desc = e => `Burn rate ${e.A.toFixed(1)} (1 h) and ${e.B.toFixed(1)} (5 min)`;

test("the page's prediction: an hour of 50 req/s, the 1 h ratio passes 7.2% after ~4.3 min, the page fires in 5–6 min", () => {
  const cross = M.crossing("hour"), r = M.experiment("hour", "stop"), fire = r.find("firing", "page"), pend = r.find("pending", "page");
  console.log(`       1 h burn > ${L.fastBurn} after ${cross} s; Pending ${mmss(pend.t)}, Firing ${mmss(fire.t)}, "${desc(fire)}"`);
  near(cross / 60, L.fastBurn * L.budget * 60, 0.2, "0.072 × 60 min ≈ 4.3 min (the page's box)");
  ok(fire.t >= 300 && fire.t <= 360, "≈ 5–6 minutes (the page's box)");
  eq(fire.t - pend.t, L.fastFor, "for: 1m");
  tipHas("catalog-slo-alert", lang => [`${cross} s (${fmt(cross / 60, 1, lang)} minut`, `**${mmss(fire.t)}**`, desc(fire)].map(s => s.replace(/\*\*/g, "")));
});

test("with step 2's stress test in the window the model lands on the test run (about 440 s, 17.0 and 200.0)", () => {
  const extra = M.stressTotal(), r = M.experiment("stress", "stop"), fire = r.find("firing", "page");
  console.log(`       stress test: ${Math.round(extra)} healthy requests; Firing at ${fire.t} s, "${desc(fire)}"`);
  near(fire.t, 440, 15, "the test run: about 440 s");
  eq(desc(fire), "Burn rate 17.0 (1 h) and 200.0 (5 min)", "the test run's description");
  tipHas("catalog-slo-alert", lang => [lang === "en" ? `about ${Math.round(extra / 1000)} thousand` : `cerca de ${Math.round(extra / 1000)} mil`, mmss(fire.t), desc(fire)]);
});

test("recovery: the page resolves ~5 min after db is back (short window); the ticket waits for the 30 min window", () => {
  const r = M.experiment("stress", "stop"), fire = r.find("firing", "page");
  const pageOk = r.events.find(e => e.kind === "normal" && e.rule === "page"), tkOk = r.events.find(e => e.kind === "normal" && e.rule === "ticket");
  console.log(`       db back at ${fire.t} s; page Normal after ${pageOk.t - fire.t} s; ticket Normal after ${tkOk.t - fire.t} s`);
  ok(pageOk.t - fire.t >= 240, "not 'a minute or two': the outage must leave the 5-minute window");
  tipHas("catalog-slo-alert", lang => [mmss(pageOk.t - fire.t), `${fmt((tkOk.t - fire.t) / 60, 1, lang)} minut`]);
});

test("less history fires sooner; a 4% error rate never pages and opens a ticket after hours", () => {
  const short = M.experiment("short", "stop").find("firing", "page");
  const p = M.run({ history: "hour", fault: "partial", startAt: null });
  const page = p.find("firing", "page"), tk = p.find("firing", "ticket");
  console.log(`       10 min of history: Firing at ${mmss(short.t)}; 4% errors: page ${page ? page.t : "never"}, ticket after ${(tk.t / 3600).toFixed(2)} h`);
  eq(page, null, "burn rate 8 < 14.4");
  tipHas("catalog-slo-alert", lang => [mmss(short.t), `${fmt(tk.t / 3600, 1, lang)} ${lang === "en" ? "hours" : "horas"}`]);
});
