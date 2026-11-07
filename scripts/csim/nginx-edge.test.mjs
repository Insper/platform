import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, near, tipHas, fmt, ROOT } from "./lib.mjs";

const M = load("nginx-edge");
const LAB = "docs/2027.1/hands-on/3";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const page = read("index.md");

test("the replicas are the lab's: catalog-1..3 in compose and in the upstream, private, behind the edge", () => {
  const compose = read("code/docker-compose.yaml"), conf = read("code/infra/nginx/nginx.conf");
  eq(M.create().peers.map(p => p.name), ["catalog-1", "catalog-2", "catalog-3"], "peers");
  for (const p of M.create().peers) {
    ok(compose.includes(`hostname: ${p.name}`), `compose has ${p.name}`);
    ok(conf.includes(`server ${p.name}:8082 resolve max_fails=${M.LAB.maxFails} fail_timeout=${M.LAB.failTimeout}s;`), `upstream has ${p.name}`);
  }
  ok(compose.includes('"80:80"'), "only the edge publishes 80");
  ok(/proxy_next_upstream\s+error timeout http_502 http_503 http_504;/.test(conf), "proxy_next_upstream on error and timeout");
  ok(/limit_req\s+zone=per_key\s+burst=\d+\s+nodelay;/.test(conf) && /limit_req_status\s+429;/.test(conf), "limit_req … nodelay, status 429");
  ok(/location \/ \{\s*return\s+404;/.test(conf) && /location = \/healthz/.test(conf), "only /catalog/ and /healthz");
});

test("step 4: 9 requests, 3 per replica, the page's output", () => {
  const r = M.play("spread"), loop = r.out[1];
  eq(loop.by, { "catalog-1": 3, "catalog-2": 3, "catalog-3": 3 }, "round robin");
  for (const line of loop.out) ok(page.includes(line), `the page prints "${line.trim()}"`);
  ok(page.includes(loop.cmd.slice(2)), "the page's loop");
  ok(r.out[2].out.every(l => /rt=\d\.\d{3} upstream=172\.18\.0\.\d:8082 ut=\d\.\d{3} id=/.test(l)), "the access-log format of nginx.conf");
  ok(read("code/infra/nginx/nginx.conf").includes("rt=$request_time '") && read("code/infra/nginx/nginx.conf").includes("'upstream=$upstream_addr ut=$upstream_response_time id=$request_id'"), "log_format edge");
});

test("step 5: the page's commands, in order, with its sleeps, for k6's 2 minutes", () => {
  const cmds = ["docker compose stop catalog-2", "sleep 20", "docker compose start catalog-2", "sleep 30", "docker compose pause catalog-3", "sleep 20", "docker compose unpause catalog-3"];
  let at = 0;
  for (const c of cmds) { const i = page.indexOf(c, at); ok(i > 0, `the page runs "${c}" (in order)`); at = i; }
  const loads = M.SCRIPTS.failures.flatMap(s => s.ops).filter(o => o[0] === "load").map(o => o[1]);
  eq(loads.slice(1, 4), [20, 30, 20], "the twin waits the page's sleeps");
  eq(loads.reduce((a, b) => a + b, 0), 120, "k6's DURATION=2m");
  const ops = M.SCRIPTS.failures.flatMap(s => s.ops).filter(o => o.length === 2 && typeof o[1] === "string").map(o => `docker compose ${o[0]} ${o[1]}`);
  eq(ops, cmds.filter(c => !c.startsWith("sleep")), "the same commands");
});

const fail = M.play("failures");
const loads = fail.out.filter(x => x.cmd.startsWith("# k6 keeps"));
const sum = fail.out[fail.out.length - 1].res;

test("step 5: a dead replica costs almost nothing, a frozen one costs the tail, never an error", () => {
  eq(loads.map(x => x.reqs.filter(r => r.status >= 500).length), [0, 0, 0, 0, 0], "no errors in any phase (the page: 0.00%)");
  eq(sum.bad, 0, "http_req_failed 0");
  eq(sum.n, M.LAB.loadRate * 120, "150 req/s for 2 minutes");
  eq(loads[1].reqs.filter(r => r.lat >= 0.1).length, 0, "stop: not one request above 100 ms");
  ok(loads[1].reqs.some(r => r.failed.some(f => f.kind === "refused")), "stop: refused attempts, retried");
  const logs = fail.out.filter(x => x.cmd.includes("logs edge"));
  ok(logs[0].out.some(l => /temporarily disabled/.test(l)) && logs[0].out.some(l => /catalog-2 could not be resolved/.test(l)), "the log: disabled, then not resolved");
  ok(loads[2].reqs.some(r => r.failed.some(f => f.kind === "refused")), "start: refused while the JVM starts");
  ok(loads[2].reqs.filter(r => r.by === "catalog-2").length > 0, "start: back in rotation");
  const hung = loads[3].reqs.filter(r => r.lat >= 1);
  ok(hung.length > 0 && hung.every(r => r.status === 200 && r.failed.length === 1 && r.failed[0].p === "catalog-3"), "pause: every slow request waited on catalog-3 and was retried");
  ok(hung.some(r => r.failed[0].kind === "connect") && hung.some(r => r.failed[0].kind === "read"), "both timeouts of the page's table");
  ok(hung.every(r => Math.abs(r.failed[0].wait - (r.failed[0].kind === "read" ? M.LAB.readTimeout : M.LAB.connectTimeout)) < 1e-9), "1 s on a new connection, 5 s on a kept-alive one");
  ok(sum.max >= M.LAB.readTimeout && sum.max < M.LAB.readTimeout + 0.1, "max just above the read timeout (the page: 5.05s)");
  ok(page.includes("max=5.05s") && page.includes("0.00%  0 out of"), "the page's run");
  ok(logs[1].out.some(l => /while connecting to upstream/.test(l)) && logs[1].out.some(l => /while reading response header/.test(l)), "the log: both timeouts");
  ok(loads[4].reqs.filter(r => r.by === "catalog-3").length > 0, "unpause: back in rotation after a trial");
});

test("limit_req, as Nginx computes it: burst, then the rate", () => {
  const st = M.create(), acc = [];
  for (let i = 0; i < 100; i++) acc.push(M.limit(st, "k", 0));
  eq(acc.filter(Boolean).length, M.LAB.burst + 1, "100 requests in the same millisecond: the first + a burst of 40");
  ok(M.limit(st, "", 0) && M.limit(st, undefined, 0), "an empty key is never limited");
  ok(!M.limit(st, "k", 0.025) && M.limit(st, "k", 0.05), "then one request per 50 ms (20/s)");
});

test("step 6: greedy gets the burst plus 20/s, polite never sees a 429 (the page's run)", () => {
  const c = M.play("ratelimit").out.at(-1).counts;
  eq(c.greedy[200], M.LAB.burst + M.LAB.rate * M.LAB.rlSeconds, "greedy 200 = 40 + 20 × 30");
  ok(page.includes(`'count>=0' count=${c.greedy[200]}`), "the page's greedy 200 count");
  eq(c.polite[429], 0, "polite 429");
  ok(/polite,status:429}\n\s+✓ 'count>=0' count=0/.test(page), "the page: polite got no 429");
  near(c.polite[200], 299, 1, "polite 200 (the page: 299)");
  eq(c.greedy[200] + c.greedy[429], M.LAB.greedy * M.LAB.rlSeconds, "greedy sent 50 × 30");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tip", () => {
  const rl = M.play("ratelimit").out.at(-1).counts;
  tipHas("nginx-edge", lang => {
    const max = M.dur(sum.max), maxS = lang === "pt" ? max.replace(".", ",") : max;
    return lang === "en"
      ? ["3 per replica", `${sum.slow} requests`, maxS, `${sum.retried} retried`, "0 errors", `p99 of ${M.dur(sum.p99)}`, `${rl.greedy[200]} × 200`, `${rl.greedy[429]} × 429`, `polite ${rl.polite[200]} × 200`]
      : ["3 por réplica", `${sum.slow} requisições`, maxS, `${sum.retried} repetidas`, "0 erros", `p99 de ${M.dur(sum.p99).replace(".", ",")}`, `${rl.greedy[200]} × 200`, `${rl.greedy[429]} × 429`, `polite ${rl.polite[200]} × 200`];
  });
});
