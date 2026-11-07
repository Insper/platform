/* hold-queue: the knee of the queueing page (2027.1, class 2) — utilization, servers, variability */
import { load, test, ok, near, tipHas, fmt } from "./lib.mjs";

const M = load("hold-queue");
const run = (servers, rho, arrivals) => M.experiment({ servers, rho, arrivals }, 60);
const a70 = run(1, 70, "random"), a92 = run(1, 92, "random"), s92 = run(1, 92, "steady"), b92 = run(1, 92, "bursty");
const c70 = run(8, 70, "random"), c92 = run(8, 92, "random");

test("Erlang C and M/M/c agree with the page's table and the overview", () => {
  near(M.mmcR(1, 0.7) / M.S, 1 / 0.3, 1e-9, "M/M/1 at 70%: R = S / (1 − ρ)");
  near(M.mmcR(1, 0.9) * 1000, 50, 1e-6, "M/M/1 at 90%: 50 ms (page's table)");
  ok(M.mmcR(8, 0.7) < 1.2 * M.S, "8 servers sharing a queue at 70%: R barely above S");
});

test("one server: the story at the top of the page (75 ms at 70%, almost 300 ms at 92%)", () => {
  near(a70.p99 * 1000, 75, 10, "p99 at 70%");
  near(a92.p99 * 1000, 300, 30, "p99 at 92%");
  ok(a92.p99 > 3 * a70.p99, "22 points more load, more than three times the tail");
  near(a70.R, M.mmcR(1, 0.7), 0.15 * M.mmcR(1, 0.7), "the measured mean follows M/M/1");
});

test("Little's law holds in every experiment", () => {
  [a70, a92, s92, b92, c70, c92].forEach(r => near(r.L, r.little, 0.01 * r.L + 0.02, "L = λ × W"));
});

test("variability: steady arrivals queue less, bursty ones more (Kingman)", () => {
  ok(s92.R < 0.6 * a92.R && b92.R > 1.3 * a92.R, "steady < random < bursty at the same load");
});

test("pooling: 8 servers at 70% give the overview's ~25 ms p99", () => {
  near(c70.p99 * 1000, 25, 4, "p99 with 8 servers at 70%");
  ok(c92.p99 < 0.25 * a92.p99, "with 8 servers even 92% stays far left of the wall");
});

test("the tip quotes the model's numbers", () => {
  tipHas("hold-queue", lang => [
    fmt(a70.R * 1000, 1, lang) + " ms", fmt(Math.round(a70.p99 * 1000), 0, lang) + " ms", fmt(a70.L, 2, lang), fmt(a70.little, 2, lang),
    fmt(a92.R * 1000, 1, lang) + " ms", fmt(Math.round(a92.p99 * 1000), 0, lang) + " ms",
    fmt(s92.R * 1000, 1, lang) + " ms", fmt(b92.R * 1000, 1, lang) + " ms",
    fmt(Math.round(c70.p99 * 1000), 0, lang) + " ms", fmt(Math.round(c92.p99 * 1000), 0, lang) + " ms"
  ]);
});
