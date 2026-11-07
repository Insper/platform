import { load, test, ok, fmt, tipHas } from "./lib.mjs";

const M = load("coordinated-omission");
const rep = (n, len) => { const r = M.measure(n, len); return { c: M.report(r.closed, M.DURATION), o: M.report(r.open, M.DURATION) }; };
const page = rep(4, 1.5), small = rep(1, 0.5), many = rep(8, 1.5), none = rep(0, 1);

test("the page's experiment: four freezes of 1.5 s start at 10, 25, 40 and 55 s", () => {
  ok(JSON.stringify(M.stallsOf(4, 1.5).map(s => +s[0].toFixed(6))) === "[10,25,40,55]", "stall positions");
});

test("no freeze: both measurements agree on 1 ms", () => {
  ok(Math.abs(none.c.p99 - M.SERVICE) < 1e-9 && Math.abs(none.o.p99 - M.SERVICE) < 1e-9, JSON.stringify(none));
});

test("the closed loop omits the slow samples and reports a perfect p99 (the page: ~600 fewer, p99 1 ms)", () => {
  const missing = page.o.n - page.c.n;
  ok(missing > 550 && missing < 650, `missing ${missing}`);
  ok(page.c.p99 < 0.0011 && page.c.max > 1.49, `closed p99 ${page.c.p99}, max ${page.c.max}`);
});

test("the open model sees the freezes (the page: p90 ~150 ms, p99 over a second)", () => {
  ok(page.o.p90 > 0.12 && page.o.p90 < 0.18 && page.o.p99 > 1, `open p90 ${page.o.p90}, p99 ${page.o.p99}`);
});

test("freezes covering under 1% of the time escape even an honest p99", () => {
  ok(0.5 / M.DURATION < 0.01 && small.o.p99 < 0.0011 && small.o.p999 > 0.3, JSON.stringify(small.o));
});

test("the tip quotes the model's numbers", () => {
  const ms = (x, lang, d = 0) => fmt(x * 1000, d, lang) + " ms";
  tipHas("coordinated-omission", lang => {
    const en = lang === "en";
    return [
      en ? `${fmt(page.c.n, 0, lang)} samples and a p99 of ${ms(page.c.p99, lang, 1)}` : `${fmt(page.c.n, 0, lang)} amostras e um p99 de ${ms(page.c.p99, lang, 1)}`,
      en ? `${fmt(page.o.n - page.c.n, 0, lang)} fewer` : `${fmt(page.o.n - page.c.n, 0, lang)} a menos`,
      `p90 ${ms(page.o.p90, lang)}`, `p99 ${fmt(page.o.p99, 2, lang)} s`,
      en ? `one freeze of 0.5 s (${fmt(50 / M.DURATION, 1, lang)}% of the test)` : `um congelamento de 0,5 s (${fmt(50 / M.DURATION, 1, lang)}% do teste)`,
      `p99 ${ms(small.o.p99, lang, 1)}`, `p99.9 ${ms(small.o.p999, lang)}`,
      en ? `8 freezes` : `8 congelamentos`, `p99.9 ${fmt(many.c.p999, 1, lang)} s`, `p99 ${ms(many.c.p99, lang, 1)}`,
    ];
  });
});
