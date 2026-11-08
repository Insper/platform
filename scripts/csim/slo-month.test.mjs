import { load, test, eq, ok, near, tipHas, fmt } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const M = load("slo-month");
const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(path.join(here, "../../docs", p), "utf8");
const run = (scenario, slo) => M.run({ scenario, slo });
const pct = (v, lang) => M.pct(v, lang === "pt");
const clock = (t, lang) => M.clock(t, lang === "pt");

test("the pages' numbers: 28,000,000 requests in 28 days, a 99.9% budget of 28,000, the bad deploy is 20,000 errors", () => {
  const r = run("deploy", 99.9);
  near(r.total, 28e6, 1e-6, "requests");
  near(r.budget, 28000, 1e-6, "budget");
  near(r.incidents[0].failed, 20000, 1e-6, "deploy");
  eq(M.CFG.sla, 99.5, "SLA");
  ok(read("2026.2/classes/reliability/sli-slo-sla/index.md").includes("0.1\\% \\times 28\\,000\\,000 = 28\\,000"), "2026.2 page: the same budget");
  ok(read("2027.1/classes/observability/slo/index.md").includes("99.5% monthly"), "2027.1 page: the partner venues' SLA is 99.5%");
});

test("the ladder: SLI ≥ SLO ships, between SLO and SLA freezes, below the SLA owes credits", () => {
  eq(run("quiet", 99.9).end.state, "ok", "quiet");
  eq(run("deploy", 99.9).end.state, "ok", "deploy");
  eq(run("two", 99.9).end.state, "warn", "deploy + failover");
  eq(run("outage", 99.9).end.state, "bad", "outage");
  const r = run("outage", 99.9);
  ok(r.sloBreach < r.slaBreach, "the budget goes before the contract");
  const same = run("outage", 99.5);
  near(same.sloBreach, same.slaBreach, 1e-9, "SLO = SLA: they break together");
  ok(run("quiet", 99.9).end.used > 9 && run("quiet", 99.9).end.used < 11, "the background spends 10%");
});

test("the tip: deploy, deploy + failover, outage, SLO = SLA and 99.95%", () => {
  const d = run("deploy", 99.9).end, two = run("two", 99.9), o = run("outage", 99.9).end, same = run("outage", 99.5), strict = run("deploy", 99.95).end;
  console.log(`       deploy ${pct(d.sli)} ${d.used.toFixed(1)}% left ${Math.round(d.left)}; two ${pct(two.end.sli)} gone ${clock(two.sloBreach)} margin ${Math.round(two.end.toSla)}; ` +
    `outage ${pct(o.sli)}; SLO = SLA ${clock(same.slaBreach)}; 99.95% ${strict.used.toFixed(0)}%`);
  tipHas("slo-month", lang => [
    pct(d.sli, lang), fmt(d.used, 0, lang) + "%", fmt(Math.round(d.left), 0, lang),
    clock(two.sloBreach, lang), pct(two.end.sli, lang), fmt(Math.round(two.end.toSla), 0, lang),
    pct(o.sli, lang), clock(same.slaBreach, lang), fmt(strict.used, 0, lang) + "%"
  ]);
});
