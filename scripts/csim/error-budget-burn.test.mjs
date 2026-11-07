import { load, test, eq, ok, near, tipHas, fmt } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const M = load("error-budget-burn");
const here = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.join(here, "../../docs/2026.2/classes/reliability/sli-slo-sla/index.md"), "utf8");
const run = name => M.run(M.SCENARIOS[name]);
const dur = (min, lang) => M.dur(min, lang === "pt");

test("the page's numbers: 28,000 failed requests of budget; the bad deploy is 20,000 errors in one hour", () => {
  const r = run("deploy");
  near(r.budget, 28000, 1e-6, "budget");
  near(r.incidentErrors, 20000, 1e-6, "deploy errors");
  near(r.consumed, 100 * 20000 / 28000, 1e-9, "deploy share of the budget");
  ok(page.includes("0.1\\% \\times 28\\,000\\,000 = 28\\,000"), "the page computes the same budget");
});

test("the rules are the SRE Workbook's table, as the page writes them", () => {
  eq(M.RULES.slice(0, 3).map(r => [r.long, r.short, r.burn, r.sev]),
    [[60, 5, 14.4, "page"], [360, 30, 6, "page"], [4320, 360, 1, "ticket"]], "rules");
  ok(/\| 🔴 Page \| 1 hour \| 5 minutes \| 14\.4 \|/.test(page) && /\| 🔴 Page \| 6 hours \| 30 minutes \| 6 \|/.test(page) && /\| 🟡 Ticket \| 3 days \| 6 hours \| 1 \|/.test(page), "the page's table");
  ok(page.includes("[1h]))") && page.includes("[5m]))") && page.includes("(14.4 * 0.001)"), "the page's alert uses 1 h and 5 min at 14.4");
});

test("burn rate: window ÷ b to exhaust; a multiwindow page stops soon after the incident, a single window does not", () => {
  const d = run("deploy");
  near(d.incidentBurn, 480, 1e-9, "480×");
  near(d.exhaustDays * 1440, 40320 / 480, 1e-6, "84 min");
  ok(d.reset.fast <= 5 && d.reset.single >= 55, "reset: multiwindow within the 5-minute window, single window about an hour");
  ok(d.detect.fast < d.detect.single, "the for: 2m rule pages later");
});

test("the tip: four incidents, detection, reset and budget", () => {
  const d = run("deploy"), o = run("outage"), l = run("leak"), b = run("blip");
  console.log(`       deploy ${d.incidentBurn}× ${d.consumed.toFixed(1)}% page ${d.detect.fast} min reset ${d.reset.fast}, single ${d.detect.single}/${d.reset.single}; ` +
    `outage page ${o.detect.fast} min ${o.consumed.toFixed(1)}%; leak ticket ${l.detect.ticket} min ${l.consumed.toFixed(1)}%; blip ${b.consumed.toFixed(2)}%`);
  ok(l.detect.fast === null && l.detect.slow === null && l.detect.ticket !== null, "the leak never pages, only tickets");
  ok(Object.values(b.detect).every(v => v === null), "the blip fires nothing");
  ok(o.detect.fast !== null && o.detect.fast < o.detect.slow, "the outage pages through the 1 h rule first");
  tipHas("error-budget-burn", lang => [
    fmt(d.incidentBurn, 0, lang) + "×", fmt(d.consumed, 0, lang) + "%",
    dur(d.detect.fast, lang), dur(d.reset.fast, lang), dur(d.detect.single, lang), dur(d.reset.single, lang),
    fmt(o.incidentBurn, 0, lang) + "×", dur(o.detect.fast, lang), fmt(o.consumed, 0, lang) + "%",
    fmt(l.incidentBurn, 0, lang) + "×", fmt(l.consumed, 0, lang) + "%", dur(l.detect.ticket, lang),
    fmt(b.consumed, 1, lang) + "%"
  ]);
});
