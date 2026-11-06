import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("ai-pr-review");
const LAB = "docs/2026.2/hands-on/12";
const page = readFileSync(path.join(ROOT, LAB, "index.md"), "utf8");
const n = v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

test("the workflow of the page: name, triggers, steps, paths filter", () => {
  ok(page.includes("Create `" + M.WORKFLOW + "`"), "the workflow file");
  ok(page.includes(`types: [${M.TYPES.join(", ")}]`), "the event types");
  const steps = [...page.matchAll(/- name: (.+)/g)].map(m => m[1]);
  eq(steps, M.STEPS, "the four steps of the job");
  ok(page.includes(`run: python ${M.SCRIPT}`), "the script");
  const paths = page.match(/paths:\n((?:\s+- ".*"\n)+)/)[1].match(/"(.*)"/g).map(x => x.slice(1, -1));
  eq(paths, M.PATHS, "the paths filter of 5.1");
});

test("the script of the page: truncation, model, max_tokens, output", () => {
  ok(page.includes(`if total_lines > ${M.MAX_LINES}:`) && page.includes("total_lines += f.patch.count('\\n')"), "get_pr_diff's rule");
  ok(page.includes(`model="${M.MODEL}"`) && page.includes(`max_tokens=${M.MAX_TOKENS}`), "model and max_tokens");
  ok(page.includes('print(f"Review posted to PR #{pr_number}")'), "what the script prints");
  ok(page.includes("Use severity labels: " + [M.SEV.critical, M.SEV.warning, M.SEV.suggestion].join(" | ")), "the severity labels");
  ok(page.includes('"... (diff truncated — too large for single review)"'), "the truncation marker");
  ok(page.includes("*Powered by Claude · Non-blocking · For guidance only*"), "the footer");
});

test("paths globs as GitHub matches them", () => {
  for (const [f, want] of [["README.md", false], ["docs/index.md", false], ["Foo.java", true], ["a/b/Foo.java", true], ["pom.xml", true],
    ["order-service/pom.xml", true], ["order-service/Dockerfile", true], ["x/application.yml", true], ["x/DockerfileX", false]])
    eq(M.matches(f), want, f);
});

test("get_pr_diff: stops before the next file once past 3 000 lines", () => {
  const d = M.diff(M.PRS.large.files);
  eq([d.sent.length, d.cut.length, d.total, d.all, d.truncated], [2, 1, 3198, 3203, true], "the large PR");
  ok(d.total > M.MAX_LINES, "the cut comes after the limit is passed, as in the script");
  eq(M.diff(M.PRS.endpoint.files).truncated, false, "the test PR is small");
});

test("the page's test PR: the review of 4.2, non-blocking, a second comment after the fix", () => {
  const r = M.play("lab");
  const [opened, edited, fix, docs] = r.out;
  const c = M.comment(opened, false);
  ok(page.includes("🔴 Critical — `application.yaml` contains a hardcoded JWT secret") && c.includes("🔴 Critical — `application.yaml` contains a hardcoded JWT secret"), "the critical finding");
  ok(page.includes("(`jwt.secret: mysecretkey123`)") && c.includes("(`jwt.secret: mysecretkey123`)"), "the secret of the page");
  ok(c.includes("🟡 Suggestion — `POST /orders` returns `200 OK`"), "the suggestion");
  ok(page.includes("git checkout -b " + M.PRS.endpoint.branch), "the branch of 4.1");
  eq([opened.ran, opened.merge, opened.verdict], [true, true, "risk"], "runs, does not block");
  eq(edited.ran, false, "edited is not a trigger");
  eq([fix.ran, fix.review.critical, fix.review.issues.length, fix.comments], [true, 0, 1, 2], "after the fix");
  eq([docs.ran, docs.pathOk, docs.merge], [false, false, true], "README with the paths filter");
});

test("5.4: what a required check changes", () => {
  const [bad, fixed, fixture, large, docs] = M.play("gate").out;
  eq([bad.check, bad.merge], ["failure", false], "blocked by the 🔴");
  eq([fixed.check, fixed.merge], ["success", true], "allowed after the fix");
  eq([fixture.merge, fixture.verdict], [false, "false-block"], "a false positive blocks a safe PR");
  eq([large.merge, large.verdict, large.diff.total, large.diff.all], [true, "risk", 3198, 3203], "a false negative passes");
  eq([docs.check, docs.merge], ["expected", false], "a skipped workflow leaves the required check waiting");
  ok(page.includes(`"${docs.status}"`), "the page quotes GitHub's waiting status");
});

test("failures: a missing secret, a 529 retried, a 529 that persists", () => {
  const [nokey, flaky, down, back, gated] = M.play("failures").out;
  eq([nokey.job, nokey.merge], ["failure", true], "comment mode: a red ✗, merge allowed");
  ok(nokey.log.includes("Error: Process completed with exit code 1.") && page.includes("`Error: Process completed with exit code 1.`"), "the error line on the page");
  eq([flaky.job, flaky.retried], ["success", 1], "one 529, retried");
  eq([down.job, down.retried], ["failure", M.RETRIES + 1], "529 on every attempt");
  ok(page.includes("retried twice"), "the page says how many retries");
  eq(back.job, "success", "re-run");
  eq([gated.job, gated.merge], ["failure", false], "a required check: nobody merges");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
  const d = M.diff(M.PRS.large.files);
  ok(M.SCRIPTS.gate[3].en.includes(n(d.all)) && M.SCRIPTS.gate[3].en.includes(n(d.total)) && M.SCRIPTS.gate[3].pt.includes(n(d.all)), "the large PR's caption");
});

test("the tips", () => {
  const d = M.diff(M.PRS.large.files), first = M.play("lab", 1).last.review;
  const crit = first.issues.filter(x => x.sev === "critical").length, sug = first.issues.filter(x => x.sev === "suggestion").length;
  tipHas("ai-pr-review", lang => lang === "en"
    ? [`${crit} 🔴 and ${sug} 🟡`, `${n(d.total)} of its ${n(d.all)} diff lines`]
    : [`${crit} 🔴 e ${sug} 🟡`, `${n(d.total)} das suas ${n(d.all)} linhas de diff`]);
});
