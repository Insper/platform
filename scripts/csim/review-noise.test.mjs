import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("review-noise");
const page = readFileSync(path.join(ROOT, "docs/2027.1/classes/ai-delivery/code-review/index.md"), "utf8");
const pct = x => Math.round(x * 100) + "%";

test("the sample is the page's: 60/48, 90/45, 150/30 of 150 real problems", () => {
  ok(page.includes('buckets = [("high", 60, 48), ("medium", 90, 45), ("low", 150, 30)]'), "the page's Python sample changed");
  ok(page.includes("REAL_PROBLEMS, PRS = 150, 100"), "the page's totals changed");
  eq(M.SAMPLE.map(b => [b.emitted, b.real]), [[60, 48], [90, 45], [150, 30]], "buckets");
  const prs = M.sample();
  eq(prs.length, 100, "100 PRs");
  eq(prs.reduce((s, p) => s + p.findings.length, 0), 300, "300 findings");
  eq(prs.reduce((s, p) => s + p.missed, 0), 27, "27 never found");
});

test("without a cap the model gives the page's table", () => {
  const rows = ["high", "medium", "low"].map(c => M.run(c, 0)).map(r => [r.perPr.toFixed(1), pct(r.precision), pct(r.recall)]);
  eq(rows, [["0.6", "80%", "32%"], ["1.5", "62%", "62%"], ["3.0", "41%", "82%"]], "comments per PR, precision, recall");
});

test("the cap keeps the most confident findings and never adds comments", () => {
  for (const c of ["high", "medium", "low"]) {
    const free = M.run(c, 0);
    for (const cap of [M.LAB.cap, 3, 1]) {
      const r = M.run(c, cap);
      ok(r.posted <= free.posted, `${c}/${cap}: fewer posts`);
      r.prs.forEach((p, i) => {
        ok(p.posted.length <= cap, `${c}/${cap}: PR ${i} over the cap`);
        const worst = Math.max(...p.posted.map(f => ["high", "medium", "low"].indexOf(f.conf)), -1);
        p.over.forEach(f => ok(["high", "medium", "low"].indexOf(f.conf) >= worst, `${c}/${cap}: PR ${i} cut a more confident finding`));
      });
    }
  }
});

test("the tips", () => {
  const lab = M.run("medium", M.LAB.cap), all = M.run("low", 0), high = M.run("high", 0);
  const org = M.wastedHours(all, M.SCALES.org), team = M.wastedHours(lab, M.SCALES.team), orgLab = M.wastedHours(lab, M.SCALES.org);
  tipHas("review-noise", lang => lang === "en"
    ? [`${fmt(lab.perPr, 1, lang)} comments per PR`, `recall ${pct(lab.recall)}`, `${lab.cut} findings on ${lab.capped} big PRs`,
      `${fmt(all.perPr, 1, lang)} comments per PR, ${pct(all.precision)} precision, ${pct(all.recall)} recall`, `${fmt(org, 0, lang)} hours`,
      `${fmt(orgLab, 0, lang)} hours`, `${fmt(team, 1, lang)} hours`, `${pct(high.precision)} precision and ${pct(high.recall)} recall`, "AI_REVIEW_MAX_COMMENTS"]
    : [`${fmt(lab.perPr, 1, lang)} comentários por PR`, `recall de ${pct(lab.recall)}`, `${lab.cut} achados em ${lab.capped} PRs grandes`,
      `${fmt(all.perPr, 1, lang)} comentários por PR, precisão de ${pct(all.precision)} e recall de ${pct(all.recall)}`, `${fmt(org, 0, lang)} horas`,
      `${fmt(orgLab, 0, lang)} horas`, `${fmt(team, 1, lang)} hora`, `precisão de ${pct(high.precision)} e recall de ${pct(high.recall)}`, "AI_REVIEW_MAX_COMMENTS"]);
});
