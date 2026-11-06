import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("nginx-upstream");
const LAB = "docs/2026.2/hands-on/7";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const loops = r => r.out.filter(x => x.cmd.includes("for i in"));
const hosts = x => Object.keys(M.spread(x.reqs)).length;
const failed = x => x.reqs.reduce((n, r) => n + r.attempts.filter(a => !a.ok).length, 0);

test("the upstream is the lab's nginx.conf, with Nginx's defaults", () => {
  const conf = read("nginx/nginx.conf");
  ok(conf.includes(`upstream ${M.CONF.upstream} {`), "upstream gateways");
  ok(conf.includes(`server ${M.CONF.server};`), "server gateway:8080");
  ok(conf.includes(`listen ${M.CONF.listen};`), "listen 80");
  ok(!/max_fails|fail_timeout|least_conn|ip_hash|random|proxy_next_upstream/.test(conf), "the conf sets no algorithm and no failure parameter: the defaults apply");
  eq([M.MAX_FAILS, M.FAIL_TIMEOUT], [1, 10], "Nginx's defaults");
});

test("compose: lb on host port 8080, three gateway replicas", () => {
  const dock = read("docker/index.md");
  ok(dock.includes(`"${M.CONF.host}:${M.CONF.listen}"`), "ports 8080:80");
  ok(dock.includes("replicas: 3"), "replicas: 3");
  eq(M.create().containers.map(c => c.name), ["store-gateway-1", "store-gateway-2", "store-gateway-3"], "the replicas");
});

test("docker compose ps -a prints the page's expected output", () => {
  const page = read("run/index.md");
  for (const line of M.ps(M.create()).out) ok(page.includes(line.trimEnd()), `run/index.md lacks "${line.trimEnd()}"`);
  ok(read("run/index.md").includes(`for i in {1..${M.LOOP}}; do curl -s http://localhost:8080/health-check; echo; done`), "the page's loop");
});

test("run: 3 answers per replica, DNS only at startup, reload", () => {
  const r = M.play("run"), l = loops(r);
  eq(M.spread(l[0].reqs), { "store-gateway-1": 3, "store-gateway-2": 3, "store-gateway-3": 3 }, "Round Robin");
  eq(l.map(hosts), [3, 3, 5, 1, 1], "hostnames per loop");
  eq(l.map(failed), [0, 0, 0, 4, 0], "failed attempts: the 4 removed IPs before the reload");
  ok(l.every(x => x.reqs.every(q => q.code === 200)), "the client never sees an error");
});

test("failure: a stopped replica costs one failed attempt, then 10 s off the pool", () => {
  const r = M.play("failure"), l = loops(r);
  eq(l.map(failed), [0, 1, 1, 0], "failed attempts per loop");
  eq(l.map(x => x.reqs.filter(q => q.code === 200).length), [9, 9, 9, 9], "every request answered");
  eq(Object.keys(M.spread(l[1].reqs)), ["store-gateway-1", "store-gateway-3"], "gateway-2 never answers while stopped");
  ok(l[1].reqs.some(q => q.attempts.length === 2 && !q.attempts[0].ok && q.attempts[1].name === "store-gateway-3"), "the request passed to gateway-3");
  ok(r.out.find(x => x.cmd.includes("logs lb")).out.some(s => s.includes("upstream server temporarily disabled")), "the warn line");
  ok(r.out.find(x => x.cmd.includes("logs lb")).out.some(s => s.includes("113: Host is unreachable")), "the error line");
  ok(M.spread(l[3].reqs)["store-gateway-2"] > 0, "gateway-2 back in the rotation");
  eq(M.FAIL_TIMEOUT, 10, "fail_timeout");
  eq(Math.round(l[1].secs * 10) / 10, 3.4, "the loop with the failed attempt");
  eq(Math.round(l[0].secs * 10) / 10, 0.5, "the loop without");
});

test("single replica: nobody to pass the request to → 502", () => {
  const r = M.play("single");
  const c = r.out.filter(x => x.cmd.startsWith("$ curl"));
  eq(c.map(x => x.reqs[0].code), [502, 200], "502, then 200 at once");
});

test("algorithms: least_conn ties like Round Robin, ip_hash sticks to one replica", () => {
  const per = a => { const st = M.create({ algo: a }); return M.spread(M.loop(st).reqs); };
  eq(per("least_conn"), per("rr"), "least_conn = rr with one request at a time");
  eq(Object.keys(per("ip_hash")).length, 1, "one client IP, one replica");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  tipHas("nginx-upstream", lang => lang === "en"
    ? ["3 answers from each replica", "still 3 hostnames", "1 failed attempt", "3.4 s", "10 s", "502"]
    : ["3 respostas de cada réplica", "ainda 3 hostnames", "1 tentativa falha", "3,4 s", "10 s", "502"]);
});
