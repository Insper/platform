import { readFileSync } from "node:fs";
import path from "node:path";
import { load, test, eq, ok, tipHas, ROOT } from "./lib.mjs";

const S = load("service-stack");
const PAGES = { en: "docs/2026.2/classes/service_models/index.md", pt: "docs/2026.2/classes/service_models/index.pt.md" };

/* the 🟧/🟦 cells of the table row that starts with `name`, as Y/P */
function row(text, name) {
  const line = text.split("\n").find(l => l.startsWith(`| ${name} |`) && /🟧|🟦/.test(l));
  if (!line) throw new Error(`no table row "${name}"`);
  return line.split("|").slice(2, -1).map(c => c.includes("🟧") ? "Y" : c.includes("🟦") ? "P" : "?").join("");
}

test("the stack agrees with the page's table, in both languages", () => {
  for (const [lang, page] of Object.entries(PAGES)) {
    const text = readFileSync(path.join(ROOT, page), "utf8");
    for (const l of S.LAYERS) eq(row(text, `**${l[lang]}**`), l.own, `${lang}: layer ${l[lang]}`);
  }
});

test("the layers' examples are the page's \"In the store\" column, in both languages", () => {
  for (const [lang, page] of Object.entries(PAGES)) {
    const lines = readFileSync(path.join(ROOT, page), "utf8").split("\n");
    for (const l of S.LAYERS) {
      const line = lines.find(x => x.startsWith(`| **${l[lang]}** |`) && !/🟧|🟦/.test(x));
      ok(line, `${lang}: no row for ${l[lang]} in the layer table`);
      eq(line.split("|").slice(-2, -1)[0].trim(), lang === "pt" ? l.exPt : l.exEn, `${lang}: example of ${l[lang]}`);
    }
  }
});

test("the events agree with the page's table \"Who acts when something happens?\", in both languages", () => {
  for (const [lang, page] of Object.entries(PAGES)) {
    const text = readFileSync(path.join(ROOT, page), "utf8");
    for (const e of S.EVENTS) eq(row(text, e[lang]), e.acts, `${lang}: event ${e[lang]}`);
  }
});

test("whoever operates the layer an event hits is the one who acts", () => {
  for (const e of S.EVENTS.filter(e => e.layer)) for (const m of S.MODELS) eq(S.actor(e.id, m), S.owner(e.layer, m), `${e.id} on ${m}`);
});

test("every event has an action text for every model, in both languages", () => {
  for (const e of S.EVENTS) for (const m of S.MODELS) {
    const a = S.action(e.id, m);
    ok(a[0] && a[1], `${e.id} on ${m}`);
  }
});

test("the tip: layers you maintain per model, and who acts", () => {
  const n = Object.fromEntries(S.MODELS.map(m => [m, S.yours(m)]));
  console.log("       layers you maintain: " + S.MODELS.map(m => `${m} ${n[m]}`).join(", "));
  eq(n.paas, n.faas, "PaaS and FaaS have the same colours (the page)");
  const jdkYou = ["iaas", "caas", "paas", "faas", "saas"].filter(m => S.actor("jdk", m) === "you");
  eq(jdkYou, ["iaas", "caas"], "JDK flaw: you act on IaaS and CaaS only");
  ok(S.actor("peak", "iaas") === "you" && S.actor("peak", "caas") === "provider", "Black Friday: you on IaaS, provider on CaaS");
  ok(S.EVENTS.find(e => e.id === "peak").layer === null, "Black Friday is capacity, not a layer");
  ok(S.MODELS.every(m => S.actor("key", m) === "you"), "a leaked key is always yours");
  tipHas("service-stack", lang => lang === "en"
    ? [`from ${n.onprem} on-premises to ${n.iaas} on IaaS, ${n.caas} on CaaS, ${n.paas} on PaaS and FaaS and ${n.saas} on SaaS`,
       "you act on IaaS and CaaS", "the provider acts from PaaS on",
       "it hits no single layer: it is capacity", "On IaaS you start more VMs, on CaaS the provider adds instances",
       "the actor is always you"]
    : [`de ${n.onprem} no on-premises para ${n.iaas} no IaaS, ${n.caas} no CaaS, ${n.paas} no PaaS e no FaaS e ${n.saas} no SaaS`,
       "você age no IaaS e no CaaS", "do PaaS em diante, quem age é o provedor",
       "ela não atinge uma camada só: é capacidade", "No IaaS você sobe mais VMs; no CaaS o provedor adiciona instâncias",
       "quem age é sempre você"]);
});
