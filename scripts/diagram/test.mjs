#!/usr/bin/env node
/*
 * Checks the diagram parsers (docs/assets/javascripts/diagram.js) against every 2027.1 and appendix diagram:
 *
 *     node scripts/diagram/test.mjs          # all ``` diagram / diagram-sim (and mermaid) blocks of docs/2027.1 and docs/appendix
 *     node scripts/diagram/test.mjs -v       # also list each diagram's size
 *
 * Fails when a line is not understood, an edge points to nothing, or a playable diagram has no steps.
 * Layout and drawing need a browser (ELK and the page font); this covers the syntax.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../..");
const D = require(path.join(root, "docs/assets/javascripts/diagram.js"));
const verbose = process.argv.includes("-v");

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "slides") yield* walk(p); }
    else if (f.endsWith(".md")) yield p;
  }
}

let blocks = 0, failed = 0;
const kinds = {};
for (const file of ["docs/2027.1", "docs/appendix"].flatMap(d => [...walk(path.join(root, d))])) {
  const text = readFileSync(file, "utf8");
  const re = /^``` *(diagram-sim|diagram|mermaid-sim|mermaid)\s*\n([\s\S]*?)\n```/gm;
  let m;
  while ((m = re.exec(text))) {
    const fence = m[1], src = m[2];
    const first = src.trim().split(/\s+/)[0];
    if (!/^(flowchart|graph|sequenceDiagram|stateDiagram)/.test(first)) continue;   // left to Mermaid
    blocks++;
    const line = text.slice(0, m.index).split("\n").length;
    const where = `${path.relative(root, file)}:${line}`;
    const g = D.parse(src);
    const problems = [...(g.errors || [])];
    if (g.type === "flow") {
      const known = id => g.nodes[id] || g.groups[id];
      for (const e of g.edges) if (!known(e.from) || !known(e.to)) problems.push(`edge ${e.from} → ${e.to} to an unknown node`);
      for (const id of g.order) if (g.nodes[id].parent && !g.groups[g.nodes[id].parent]) problems.push(`node ${id} in an unknown group`);
      if (!g.order.length) problems.push("no nodes");
      if (/sim/.test(fence) && g.edges.filter(e => !e.note && e.style !== "invisible").length < 2) problems.push("playable, but fewer than 2 steps");
    } else if (g.type === "seq") {
      if (!g.parts.length) problems.push("no participants");
      const opens = g.items.filter(i => i.t === "open").length, closes = g.items.filter(i => i.t === "close").length;
      if (opens !== closes) problems.push(`${opens} blocks opened, ${closes} closed`);
    }
    kinds[g.type + (g.state ? "/state" : "")] = (kinds[g.type + (g.state ? "/state" : "")] || 0) + 1;
    if (problems.length) {
      failed++;
      console.log(`FAIL ${where} (${fence})\n  ` + problems.join("\n  "));
    } else if (verbose) {
      console.log(`ok   ${where} ${g.type === "seq" ? g.parts.length + " participants, " + g.items.length + " items" : g.order.length + " nodes, " + g.edges.length + " edges"}`);
    }
  }
}
console.log(`\n${blocks} diagrams (${Object.entries(kinds).map(([k, v]) => v + " " + k).join(", ")}), ${failed} with problems`);
process.exit(failed ? 1 : 0);
