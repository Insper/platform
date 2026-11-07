import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const S = load("responsibility-stack");
const PAGES = { en: "docs/2027.1/classes/cloud-native/index.md", pt: "docs/2027.1/classes/cloud-native/index.pt.md" };
const CELL = { en: [["you", "Y"], ["provider", "P"], ["shared", "S"]], pt: [["você", "Y"], ["provedor", "P"], ["compartilhado", "S"]] };

/* the cells of the stack-table row named `name`, as Y/P/S (each cell starts with you/provider/shared) */
function row(text, name, lang) {
  const line = text.split("\n").find(l => l.startsWith(`| ${name} |`));
  if (!line) throw new Error(`no table row "${name}"`);
  return line.split("|").slice(2, -1).map(c => {
    const hit = CELL[lang].find(([w]) => c.trim().startsWith(w));
    return hit ? hit[1] : "?";
  }).join("");
}

test("the stack agrees with the page's table, in both languages", () => {
  for (const [lang, page] of Object.entries(PAGES)) {
    const text = readFileSync(path.join(ROOT, page), "utf8");
    for (const l of S.LAYERS) eq(row(text, l[lang], lang), l.own, `${lang}: layer ${l[lang]}`);
  }
});

test("every event hits a layer, and whoever operates it acts", () => {
  for (const e of S.EVENTS) {
    ok(S.LAYERS.some(l => l.id === e.layer), `${e.id} hits no layer`);
    for (const m of S.MODELS) eq(S.actor(e.id, m), S.owner(e.layer, m), `${e.id} on ${m}`);
  }
});

test("every event has an action text for every model, in both languages", () => {
  for (const e of S.EVENTS) for (const m of S.MODELS) {
    const a = S.action(e.id, m);
    ok(a[0] && a[1], `${e.id} on ${m}`);
  }
});

test("the tip: layers your team operates per model, and who acts", () => {
  const n = Object.fromEntries(S.MODELS.map(m => [m, S.yours(m)]));
  console.log("       layers your team operates: " + S.MODELS.map(m => `${m} ${n[m]}`).join(", "));
  const shared = S.MODELS.flatMap(m => S.LAYERS.filter(l => S.owner(l.id, m) === "shared").map(l => `${m}:${l.id}`));
  eq(shared, ["caas:os"], "the only shared cell is the OS on CaaS");
  eq(S.LAYERS.map(l => l.own[3]).join(""), S.LAYERS.map(l => l.own[4]).join(""), "PaaS and FaaS have the same column");
  const jdkYou = S.MODELS.slice(1).filter(m => S.actor("jdk", m) === "you");
  eq(jdkYou, ["iaas", "caas"], "JDK flaw: your team acts on IaaS and CaaS only");
  eq(S.EVENTS.find(e => e.id === "onsale").layer, "orch", "the on-sale hits the orchestration and scaling layer");
  ok(S.actor("onsale", "iaas") === "you" && S.MODELS.slice(2).every(m => S.actor("onsale", m) === "provider"), "on-sale: your team on IaaS, the platform from CaaS on");
  eq(S.actor("kernel", "caas"), "shared", "kernel flaw on CaaS is shared");
  ok(S.MODELS.every(m => S.actor("bucket", m) === "you"), "a public bucket is always yours");
  tipHas("responsibility-stack", lang => lang === "en"
    ? [`from ${n.onprem} on-premises to ${n.iaas} on IaaS, ${n.caas} on CaaS (plus the operating system of the nodes, shared), ${n.paas} on PaaS and FaaS and ${n.saas} on SaaS`,
       "PaaS and FaaS have the same column",
       "your team acts on IaaS and CaaS", "the provider acts from PaaS on",
       "it hits the orchestration and scaling layer", "On IaaS your team adds the VMs; from CaaS on the platform adds the instances",
       "Kernel flaw on CaaS: the only shared cell",
       "the actor is always your team"]
    : [`de ${n.onprem} no on-premises para ${n.iaas} no IaaS, ${n.caas} no CaaS (mais o sistema operacional dos nós, compartilhado), ${n.paas} no PaaS e no FaaS e ${n.saas} no SaaS`,
       "PaaS e FaaS têm a mesma coluna",
       "seu time age no IaaS e no CaaS", "do PaaS em diante, quem age é o provedor",
       "ela atinge a camada de orquestração e escala", "No IaaS seu time adiciona as VMs; do CaaS em diante a plataforma adiciona as instâncias",
       "Falha no kernel no CaaS: a única célula compartilhada",
       "quem age é sempre seu time"]);
});
