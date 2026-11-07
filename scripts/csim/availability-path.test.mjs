import { load, test, ok, fmt, tipHas } from "./lib.mjs";

const M = load("availability-path");
const ev = (n, failover = false, providers = 1, oneZone = false) =>
  M.evaluate({ replicas: { gateway: n, order: n, inventory: n }, failover, providers, oneZone });
const one = ev(1), two = ev(2), three = ev(3), fo = ev(3, true), both = ev(3, true, 2), zone = ev(3, true, 2, true);

test("the page's four designs (the chart): 98.3%, then 3 replicas, + failover, + second provider", () => {
  ok(Math.abs(one.a - 0.98301) < 1e-4 && one.minutes > 720, `one instance each: ${one.a}, ${one.minutes} min (over 12 hours)`);
  ok(three.a > 0.9978 && fo.a > three.a && both.a > fo.a && both.a < 0.9995, `${three.a} < ${fo.a} < ${both.a}`);
});

test("each step removes the weakest link and exposes the next one", () => {
  ok(["gateway", "order", "inventory"].includes(one.weakest), one.weakest);
  ok(three.weakest === "sql" && fo.weakest === "provider" && both.weakest === "sql", `${three.weakest}, ${fo.weakest}, ${both.weakest}`);
});

test("replicas in parallel: diminishing returns past two", () => {
  ok(two.a - one.a > 0.01 && three.a - two.a < 0.0002, `${one.a} → ${two.a} → ${three.a}`);
});

test("one zone for every replica: the correlated failure becomes the weakest link", () => {
  ok(zone.weakest === "zone" && Math.abs(zone.a - both.a * M.ZONE) < 1e-12, `${zone.a}`);
});

test("the tip quotes the model's numbers", () => {
  const p = (a, d, lang) => fmt(100 * a, d, lang) + "%", m = (r, lang) => fmt(r.minutes, 0, lang) + " min";
  tipHas("availability-path", lang => {
    const en = lang === "en";
    return [
      `${p(one.a, 2, lang)}, ${m(one, lang)}`, `${p(two.a, 2, lang)} (${m(two, lang)})`, p(three.a, 2, lang),
      `${p(fo.a, 2, lang)} (${m(fo, lang)})`, `${p(both.a, 2, lang)}, ${m(both, lang)}`,
      en ? `${p(zone.a, 2, lang)} and ${m(zone, lang)}` : `${p(zone.a, 2, lang)} e ${m(zone, lang)}`,
      en ? `a zone at ${p(M.ZONE, 1, lang)}` : `uma zona a ${p(M.ZONE, 1, lang)}`,
    ];
  });
});
