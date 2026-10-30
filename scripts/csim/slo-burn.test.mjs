import { load, test, eq, ok, near, tipHas, fmt } from "./lib.mjs";

const S = load("slo-burn");
const { days: DAYS, fastBurn: FAST, slowBurn: SLOW } = S.LAB;      // lab 9's slo-order.yaml
const DAY = S.DAY, SLO = 0.999;                                    // the SLO target is the class page's
const model = incidents => S.compute({ slo: SLO, days: DAYS, incidents, seed: 5 });
const page = model(S.pageIncidents(DAYS));
const deploy = 9 * DAY + 600, degrade = 16 * DAY;
const cost = (m, at, from) => m.used(at) - m.used(from - 1);
const pc = (v, d, lang) => fmt(100 * v, d, lang) + "%";
const x = (v, lang) => fmt(v, String(v).includes(".") ? 1 : 0, lang) + "×";

test("the budget: 5% errors for 3 h cost about a fifth; 2× from day 16 exhausts it around day 26", () => {
  const deployCost = cost(page, deploy + 179, deploy);
  let out = null;
  for (let m = 0; m < page.N; m++) if (page.used(m) >= 1) { out = m; break; }
  console.log(`       deploy costs ${(100 * deployCost).toFixed(1)}% of the budget; exhausted on day ${(out / DAY).toFixed(1)}; ${(100 * (page.used(page.N - 1) - 1)).toFixed(0)}% over at the end`);
  near(deployCost, 0.22, 0.01, "a fifth (the page's text)");
  near(out / DAY, 26, 0.3, "around day 26 (the page's text)");
  tipHas("slo-burn", lang => lang === "en"
    ? [`The whole incident costs ${pc(deployCost, 1, lang)}`, `before it runs out (day ${fmt(out / DAY, 1, lang)})`]
    : [`O incidente inteiro custa ${pc(deployCost, 1, lang)}`, `antes de ele acabar (dia ${fmt(out / DAY, 1, lang)})`]);
});

test("fast burn: the fast rule pages within minutes, when the incident has cost about 2%", () => {
  const f = S.firstFiring(page, "fast", deploy), s6 = S.firstFiring(page, "slow", deploy);
  console.log(`       ${FAST}× pages ${f.delay} min after the deploy (incident cost ${(100 * cost(page, f.at, deploy)).toFixed(1)}%); ${SLOW}× after ${s6.delay} min (${(100 * cost(page, s6.at, deploy)).toFixed(1)}%)`);
  ok(f.delay > 10 && f.delay < 25, "minutes, not hours");
  near(cost(page, f.at, deploy), FAST * 60 / (DAYS * DAY), 0.006, "about fast × 1 h / window");
  tipHas("slo-burn", lang => lang === "en"
    ? [`the ${x(FAST, lang)} rule pages ${f.delay} minutes in, when the incident has cost ${pc(cost(page, f.at, deploy), 1, lang)} of the budget`,
       `the ${x(SLOW, lang)} rule follows after ${s6.delay} minutes (${pc(cost(page, s6.at, deploy), 1, lang)})`,
       `Lab 9 provisions the same ${x(FAST, lang)} and ${x(SLOW, lang)} rules`]
    : [`a regra de ${x(FAST, lang)} aciona ${f.delay} minutos depois do início, quando o incidente custou ${pc(cost(page, f.at, deploy), 1, lang)} do orçamento`,
       `a de ${x(SLOW, lang)} vem após ${s6.delay} minutos (${pc(cost(page, s6.at, deploy), 1, lang)})`,
       `as mesmas regras de ${x(FAST, lang)} e ${x(SLOW, lang)}`]);
});

test("slow burn: no page at 2×, only the 3-day ticket, days before the budget runs out", () => {
  const pages = ["fast", "slow"].flatMap(id => page.alerts[id]).filter(a => a.start >= degrade);
  const tk = S.firstFiring(page, "ticket", degrade);
  let out = null;
  for (let m = 0; m < page.N; m++) if (page.used(m) >= 1) { out = m; break; }
  const hours = Math.round(tk.delay / 60), ahead = Math.floor((out - tk.at) / DAY);
  console.log(`       2× degradation: ${pages.length} pages; ticket after ${hours} h (day ${(tk.at / DAY).toFixed(1)}), incident cost ${(100 * cost(page, tk.at, degrade)).toFixed(1)}%, total spent ${(100 * tk.used).toFixed(0)}%, ${ahead}+ days before exhaustion`);
  eq(pages.length, 0, "no page");
  ok(tk.at < 20 * DAY && tk.used < 0.5, "ticket long before exhaustion");
  tipHas("slo-burn", lang => lang === "en"
    ? [`the 3-day ticket fires ${hours} hours in (day ${fmt(tk.at / DAY, 1, lang)}) with ${pc(tk.used, 0, lang)} of the budget spent — more than ${ahead} days`]
    : [`o ticket de 3 dias dispara ${hours} horas depois (dia ${fmt(tk.at / DAY, 1, lang)}), com ${pc(tk.used, 0, lang)} do orçamento gasto — mais de ${ahead} dias`]);
});

test("the naive threshold fires on harmless blips; the burn-rate rules do not", () => {
  const quiet = model([]);
  const blips = S.blips(DAYS, 5);
  const blipCost = quiet.used(quiet.N - 1) - quiet.N * 0.0001 / ((1 - SLO) * quiet.N);
  console.log(`       no incidents: naive fired ${quiet.alerts.naive.length}× on ${blips.length} blips (cost ${(100 * blipCost).toFixed(1)}% of the budget in all); burn-rate alerts: ${quiet.alerts.fast.length + quiet.alerts.slow.length + quiet.alerts.ticket.length}; with the page's incidents naive fires ${page.alerts.naive.length}×`);
  ok(quiet.alerts.naive.length >= 5, "naive is noisy");
  eq(quiet.alerts.fast.length + quiet.alerts.slow.length + quiet.alerts.ticket.length, 0, "burn-rate rules stay quiet");
  tipHas("slo-burn", lang => lang === "en"
    ? [`${page.alerts.naive.length} times this month`, `all ${blips.length} blips together cost only ${pc(blipCost, 1, lang)} of the budget`]
    : [`${page.alerts.naive.length} vezes neste mês`, `os ${blips.length} soluços juntos custem só ${pc(blipCost, 1, lang)} do orçamento`]);
});

test("an injected 0.7% incident for 3 days pages through the slow rule, not the fast one", () => {
  const m = model([{ start: 2 * DAY, dur: 3 * DAY, rate: 0.007 }]);
  const s6 = S.firstFiring(m, "slow", 2 * DAY), tk = S.firstFiring(m, "ticket", 2 * DAY);
  console.log(`       ${Math.round(0.007 / (1 - SLO))}× for 3 days: ${SLOW}× pages after ${(s6.delay / 60).toFixed(1)} h (incident cost ${(100 * cost(m, s6.at, 2 * DAY)).toFixed(1)}%), ticket after ${(tk.delay / 60).toFixed(1)} h, ${FAST}× fires ${m.alerts.fast.length}×`);
  eq(m.alerts.fast.length, 0, "no fast page");
  ok(s6, "the slow rule pages");
  tipHas("slo-burn", lang => lang === "en"
    ? [`no fast page, but the ${x(SLOW, lang)} rule pages after about ${Math.round(s6.delay / 60)} hours`]
    : [`nenhum page rápido, mas a regra de ${x(SLOW, lang)} aciona após cerca de ${Math.round(s6.delay / 60)} horas`]);
});

test("a very fast burn pages in minutes but the incident is mostly spent by then", () => {
  const m = model([{ start: 2 * DAY, dur: 30, rate: 0.2 }]);
  const f = S.firstFiring(m, "fast", 2 * DAY), whole = cost(m, 2 * DAY + 29, 2 * DAY);
  console.log(`       20% for 30 min: ${FAST}× pages after ${f.delay} min (cost so far ${(100 * cost(m, f.at, 2 * DAY)).toFixed(1)}%), whole incident ${(100 * whole).toFixed(1)}%`);
  ok(f.delay <= 5, "pages in minutes");
  tipHas("slo-burn", lang => lang === "en"
    ? [`the page comes after ${f.delay} minutes, yet the incident still costs about ${pc(whole, 0, lang)}`]
    : [`o page chega após ${f.delay} minutos, e mesmo assim o incidente custa cerca de ${pc(whole, 0, lang)}`]);
});
