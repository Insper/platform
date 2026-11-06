import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const M = load("k8s-lab");
const LAB = "docs/2026.2/hands-on/5";
const read = f => readFileSync(path.join(ROOT, LAB, f), "utf8");
const PATHS = { "secrets.yaml": "k8s/postgres/secrets.yaml", "configmap.yaml": "k8s/postgres/configmap.yaml",
  "deployment.yaml": "k8s/postgres/deployment.yaml", "service.yaml": "k8s/postgres/service.yaml", "k8s.yaml": "k8s/gateway/k8s.yaml" };

test("the files are the lab's manifests", () => {
  for (const [f, objs] of Object.entries(M.FILES)) {
    const y = read(PATHS[f]);
    for (const o of objs) {
      ok(new RegExp(`kind: ${o.kind}\\s*\\n\\s*metadata:\\s*\\n\\s*name: ${o.name}\\b`).test(y), `${f}: ${o.kind} ${o.name}`);
      if (o.replicas) ok(y.includes(`replicas: ${o.replicas}`), `${f}: replicas ${o.replicas}`);
      if (o.image) ok(y.includes(`image: ${o.image}`), `${f}: image`);
      if (o.port) ok(y.includes(`Port: ${o.port}`) || y.includes(`port: ${o.port}`), `${f}: port ${o.port}`);
      if (o.type) ok(y.includes(`type: ${o.type}`), `${f}: type ${o.type}`);
      if (o.selector) ok(new RegExp(`selector:\\s*\\n\\s*app: ${o.selector}\\b`).test(y), `${f}: selector app: ${o.selector}`);
      (o.keys || []).forEach(k => ok(y.includes(`${k}:`), `${f}: key ${k}`));
      (o.env || []).forEach(([kind, name]) => ok(y.includes(`${kind === "secret" ? "secretKeyRef" : "configMapKeyRef"}:`) && y.includes(`name: ${name}`), `${f}: ${kind} ${name}`));
    }
  }
  const dep = read(PATHS["deployment.yaml"]);
  ok(dep.indexOf("configMapKeyRef") < dep.indexOf("secretKeyRef"), "the env reads the ConfigMap first");
  eq(Buffer.from("c3RvcmU=", "base64").toString(), "store", "base64 of the secret");
});

test("postgres: the page's commands, in its order", () => {
  const page = read("index.md");
  for (const f of ["secrets", "configmap", "deployment", "service"]) ok(page.includes(`kubectl apply -f ./k8s/${f}.yaml`), `${f}.yaml on the page`);
  const r = M.play("postgres");
  eq(r.out.filter(x => x.cmd.includes("apply")).map(x => x.out[0]),
    ["secret/postgres-secrets created", "configmap/postgres-configmap created", "deployment.apps/postgres created", "service/postgres created"], "created");
  eq(r.out.find(x => x.pods).pods.map(p => p.status), ["Running"], "the pod runs");
  eq(r.out.filter(x => x.svcs).pop().svcs.map(s => s.name + " " + s.type), ["postgres ClusterIP"], "the Service");
});

test("gateway: <pending> until minikube tunnel, self-healing, scaling", () => {
  const r = M.play("gateway");
  eq(r.out.filter(x => x.svcs).map(x => x.svcs.find(s => s.name === "gateway").ext), ["<pending>", "127.0.0.1"], "EXTERNAL-IP");
  ok(read("index.md").includes("`<pending>`") && read("index.md").includes("minikube tunnel"), "the page's LoadBalancer box");
  const del = r.out.find(x => x.replaced);
  const gone = del.cmd.split(" ").pop();
  ok(del.replaced !== gone, "a new name");
  eq(del.replaced.split("-").slice(0, 2), gone.split("-").slice(0, 2), "same ReplicaSet hash");
  eq(r.out.filter(x => x.eps).pop().eps.gateway, 3, "3 endpoints after scale 3");
  const six = r.out.filter(x => x.hosts).pop();
  eq([six.hosts.length, six.distinct], [6, 3], "6 answers from 3 pods");
  eq(r.out.find(x => x.hosts).hosts[0], gone, "/health-check answers the pod's name");
});

test("pitfalls: apply order and a selector that matches nothing", () => {
  const r = M.play("pitfalls");
  const pods = r.out.filter(x => x.pods && x.pods.some(p => p.name.startsWith("postgres"))).map(x => x.pods[0].status);
  eq(pods.slice(0, 4), ["CreateContainerConfigError", "CreateContainerConfigError", "ContainerCreating", "Running"], "waits, then converges");
  ok(r.out[1].note[0].includes('configmap "postgres-configmap" not found'), "the ConfigMap first");
  ok(r.out[3].note[0].includes('secret "postgres-secrets" not found'), "then the Secret");
  eq(r.out.filter(x => x.eps).map(x => x.eps.gateway), [0], "no endpoints");
  eq(r.out.filter(x => x.hosts).map(x => x.hosts.length), [0, 1], "refused, then answered");
});

test("every step of every script has a caption in both languages", () => {
  for (const [name, steps] of Object.entries(M.SCRIPTS)) steps.forEach((s, i) => ok(s.en && s.pt, `${name} step ${i + 1}`));
});

test("the tips", () => {
  tipHas("k8s-lab", lang => lang === "en"
    ? ["<pending>", "127.0.0.1", "same ReplicaSet hash", "6 answers from 3 pods", "CreateContainerConfigError"]
    : ["<pending>", "127.0.0.1", "mesmo hash do ReplicaSet", "6 respostas de 3 pods", "CreateContainerConfigError"]);
});
