import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, fmt, tipHas, ROOT } from "./lib.mjs";

const M = load("kind-lab");
const L = M.LAB, MO = M.MODEL;
const LAB = "docs/2027.1/hands-on/10";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const deployPage = read("deploy/index.md"), measurePage = read("measure/index.md");
const lastPods = (r, i = -1) => r.out.filter(x => x.rows).at(i).rows.filter(p => p.app === "catalog");

const dep = M.play("deploy"), heal = M.play("heal"), nodeR = M.play("node"), roll = M.play("rollout");
const healAfter = heal.out.find(x => x.after !== undefined).after;
const nodeAfter = nodeR.out.find(x => x.after !== undefined).after;
const nodeK6 = nodeR.out.find(x => x.k6).k6;
const rollK6 = roll.out.filter(x => x.k6).map(x => x.k6);
const B = M.experimentB(), Bno = M.experimentB({ readiness: false, preStop: 0 });
const Brdy = M.experimentB({ readiness: false }), Blag = M.experimentB({ lag: 6 });
const LAG6 = 6;

test("apply -k prints the page's output and converges: catalog restarts twice while db-0 is not ready", () => {
  for (const line of M.APPLY) ok(deployPage.includes(line), `the page prints ${line}`);
  eq(dep.out[0].out, M.APPLY, "apply output");
  const end = lastPods(dep);
  eq(end.map(p => [p.ready, p.restarts]), [[true, 2], [true, 2]], "both 1/1 with RESTARTS 2");
  ok(deployPage.includes("Running   2 (") && deployPage.includes("3m31s"), "the page shows RESTARTS 2 at 3m31s");
  ok(dep.out.filter(x => x.rows).at(-1).out.slice(1).every(l => l.includes(" 3m31s ")), "the last get pods is at AGE 3m31s");
  const crashing = dep.out.filter(x => x.rows).some(x => x.rows.some(p => /Error|CrashLoop/.test(p.status)));
  ok(crashing, "a crash is shown on the way");
  eq(dep.out.at(-1).code, 200, "the Ingress answers 200");
  const where = Object.fromEntries(dep.out.filter(x => x.rows).at(-1).rows.map(p => [p.app === "catalog" ? p.name : p.app, p.node]));
  eq([where.db, where.redis], ["boxoffice-worker", "boxoffice-worker"], "db-0 and redis on boxoffice-worker, as on the page");
  eq(new Set(end.map(p => p.node)).size, L.workers, "catalog spread over the workers");
});

test("self-healing: deleting both pods leaves no endpoint until the new JVMs are ready", () => {
  ok(deployPage.includes("kubectl -n boxoffice delete pod -l app=catalog --wait=false"), "the page's command");
  eq(heal.out.filter(x => x.code).map(x => x.code), [503, 200], "503 during, 200 after");
  ok(healAfter >= MO.jvm && healAfter <= MO.create + MO.jvm + 3 + L.readinessPeriod + MO.lag, `MTTR ${healAfter} s is JVM start + probe + propagation`);
});

test("losing a node: NotReady after the grace period, eviction after the toleration, no move back", () => {
  ok(deployPage.includes("docker stop boxoffice-worker2") && deployPage.includes("docker start boxoffice-worker2"), "the page's commands");
  const nodes = nodeR.out.filter(x => x.nodes).map(x => x.nodes[2]);
  eq(nodes, ["boxoffice-worker2 Ready", "boxoffice-worker2 NotReady", "boxoffice-worker2 Ready"], "worker2 Ready → NotReady → Ready");
  ok(nodeK6.failed > 0 && nodeK6.c503 === 0, "requests to the dead pod fail until the endpoint update");
  eq(nodeK6.failed, (L.rate / L.workers) * (MO.nodeGrace + MO.lag - 1), "half the traffic until Traefik drops the pod");
  ok(nodeAfter > MO.nodeGrace + MO.toleration && nodeAfter < MO.nodeGrace + MO.toleration + 45, `replacement ready ${nodeAfter} s after the stop`);
  eq(lastPods(nodeR).map(p => p.node), ["boxoffice-worker", "boxoffice-worker"], "after docker start, nothing moves back to worker2");
});

test("experiment B: the page's commands, 0 failed with readiness + preStop, failures without", () => {
  ok(measurePage.includes('{"op": "remove", "path": "/spec/template/spec/containers/0/readinessProbe"}') &&
    measurePage.includes('{"op": "remove", "path": "/spec/template/spec/containers/0/lifecycle"}'), "the page's patch");
  eq(rollK6.map(k => k.total), [L.rate * L.duration, L.rate * L.duration], "100 req/s for 2 min");
  eq(rollK6.map(k => k.failed), [B.failed, Bno.failed], "the script is experiment B");
  eq(B.failed, 0, "no failure with the probes");
  ok(Bno.failed > 0 && Bno.c503 === 0, "502s without the preStop pause");
  eq(Brdy.failed, 0, "the readiness probe alone changes nothing: the startup probe gates the new pod");
  ok(LAG6 > L.preStop && Blag.failed > 0 && Blag.failed < Bno.failed, "a propagation longer than the pause loses requests again");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips quote the model", () => {
  const pct = (k, lang) => fmt(100 * k.failed / k.total, 2, lang) + "%";
  tipHas("kind-lab", lang => lang === "en" ? [
    "RESTARTS 2", "1/1 at 3m31s",
    `gets 503 until the two new JVMs are ready, ${healAfter} s later`,
    `NotReady after ${MO.nodeGrace} s`,
    `k6 at ${L.rate} req/s loses ${fmt(nodeK6.failed, 0, lang)} of ${fmt(nodeK6.total, 0, lang)} requests (${pct(nodeK6, lang)})`,
    `ready on boxoffice-worker only ${nodeAfter} s after the stop`,
    `${B.failed} failed requests with the readiness probe and the \`preStop\` pause, ${fmt(Bno.failed, 0, lang)} of ${fmt(Bno.total, 0, lang)} (${pct(Bno, lang)}) without them`,
    `set Traefik's delay to ${LAG6} s: even with the ${L.preStop} s pause, ${Blag.failed} requests fail`,
  ].map(s => s.replace(/`/g, "")) : [
    "RESTARTS 2", "1/1 em 3m31s",
    `recebe 503 até as duas JVMs novas ficarem prontas, ${healAfter} s depois`,
    `NotReady depois de ${MO.nodeGrace} s`,
    `o k6 a ${L.rate} req/s perde ${fmt(nodeK6.failed, 0, lang)} de ${fmt(nodeK6.total, 0, lang)} requisições (${pct(nodeK6, lang)})`,
    `só fica pronto no boxoffice-worker ${nodeAfter} s depois da parada`,
    `${B.failed} requisições com falha com a readiness probe e a pausa do preStop, ${fmt(Bno.failed, 0, lang)} de ${fmt(Bno.total, 0, lang)} (${pct(Bno, lang)}) sem elas`,
    `ponha o atraso do Traefik em ${LAG6} s: mesmo com a pausa de ${L.preStop} s, ${Blag.failed} requisições falham`,
  ]);
});
