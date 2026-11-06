import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("jenkins-pipeline");
const LAB = "docs/2026.2/hands-on/4";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const stages = f => [...read(f).matchAll(/stage\('([^']+)'\)/g)].map(m => m[1]);
const shs = f => [...read(f).matchAll(/sh '(mvn[^']+)'/g)].map(m => m[1]);

test("the stages and commands are the lab's Jenkinsfiles", () => {
  eq(M.JOBS.account.stages.map(s => s.name), stages("jenkins/code/Jenkinsfile.account"), "account");
  eq(M.JOBS["account-service"].stages.map(s => s.name), stages("jenkins/code/Jenkinsfile.account-service"), "account-service");
  eq(M.JOBS.account.stages.map(s => s.sh), shs("jenkins/code/Jenkinsfile.account"), "account sh");
  eq(M.JOBS["account-service"].stages.filter(s => s.sh).map(s => s.sh), shs("jenkins/code/Jenkinsfile.account-service"), "account-service sh");
  const svc = read("jenkins/code/Jenkinsfile.account-service");
  ok(svc.includes("build job: 'account', wait: true"), "Dependencies waits for account");
  eq(M.JOBS["account-service"].stages[0].jobs, ["account"], "the dependency");
  ok(svc.includes(`credentialsId: '${M.CRED}'`), "credentialsId");
  ok(svc.includes(`NAME = "${M.REPO}/\${env.SERVICE}"`) && svc.includes("SERVICE = 'account'"), "NAME and SERVICE");
  ok(svc.includes(`--platform=${M.PLATFORMS}`) && svc.includes("--tag ${env.NAME}:latest --tag ${env.NAME}:${env.BUILD_ID}"), "platforms and tags");
});

test("executors: the default and the lab's setting", () => {
  const page = read("index.md");
  ok(page.includes(`The default is ${M.DEFAULT_EXECUTORS}`), "the default");
  ok(page.includes(`Number of executors → ${M.LAB_EXECUTORS}`), "the lab's value");
});

test("the lab's jobs: account, then account-service pushes :latest and :1", () => {
  const st = M.plan("lab").st;
  eq(st.builds.map(b => `${b.job} #${b.num} ${b.status}`), ["account #1 SUCCESS", "account-service #1 SUCCESS", "account #2 SUCCESS"], "builds");
  const svc = M.build(st, "account-service", 1);
  eq(svc.tags, ["humbertosandmann/account:latest", "humbertosandmann/account:1"], "tags");
  eq(svc.end, 140, "account-service ends at 140 s");
  eq(M.build(st, "account", 2).by, "account-service #1", "account #2 was started by account-service");
});

test("too few executors: two services hang on 2, finish on 3 and 10", () => {
  const r2 = M.race(2, ["account-service", "auth-service"]);
  eq([r2.end, r2.stuckAt], [null, 5], "2 executors: stuck at 5 s");
  eq(r2.st.queue.map(b => b.job + " #" + b.num), ["account #1"], "account waits in the queue, once");
  eq(M.busy(r2.st), 2, "both executors held");
  eq(M.race(3, ["account-service", "auth-service"]).end, 140, "3 executors");
  eq(M.race(10, ["account-service", "auth-service"]).end, 140, "10 executors");
  eq(M.race(2, ["account-service"]).end, 120, "one service alone fits in 2");
  const st = M.plan("executors").st;
  eq([st.stuck, st.t], [false, 150], "the script: raising to 10 unblocks it, done at 150 s");
  ok(M.play("executors", 3).stuck, "stuck before the change");
});

test("a failing stage: account fails Dependencies, later stages skipped; a wrong credential fails Build & Push Image", () => {
  const st = M.plan("failure").st;
  eq(M.build(st, "account-service", 1).stages, ["failed", "skipped", "skipped"], "account does not compile");
  eq(M.build(st, "account-service", 2).stages, ["ok", "ok", "failed"], "wrong credentials ID");
  ok(st.log.some(l => l.line === `ERROR: Could not find credentials entry with ID '${M.CRED}'`), "the credentials error");
  ok(st.log.some(l => /Stage "Build" skipped due to earlier failure/.test(l.line)), "skipped");
  const nj = M.race(10, ["account-service"], "nojob");
  ok(nj.st.log.some(l => l.line === "ERROR: No item named account found"), "no job named account");
});

test("every phase of every script has a caption in both languages", () => {
  for (const [name, ph] of Object.entries(M.SCRIPTS)) ph.forEach((s, i) => ok(s.en && s.pt, `${name} phase ${i + 1}`));
});

test("the tips", () => {
  const lab = M.build(M.plan("lab").st, "account-service", 1).end;
  const r2 = M.race(2, ["account-service", "auth-service"]), r3 = M.race(3, ["account-service", "auth-service"]);
  const st = M.plan("executors").st;
  tipHas("jenkins-pipeline", lang => lang === "en"
    ? [`at ${lab} s`, ":latest and :1", `stuck from ${r2.stuckAt} s`, `at ${st.t} s`, `3 executors would already do: ${r3.end} s`]
    : [`em ${lab} s`, ":latest e :1", `travado desde ${r2.stuckAt} s`, `em ${st.t} s`, `3 executors já bastariam: ${r3.end} s`]);
});
