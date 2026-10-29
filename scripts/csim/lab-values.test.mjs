/*
 * The simulators' values copied from labs (lab-values.mjs) still match the labs, the modules and the
 * pages. See lab-values.mjs for what to update when this fails.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { load, test, ROOT, pagesOf, tipText } from "./lib.mjs";
import VALUES from "./lab-values.mjs";

const FIX = e => `update lab-values.mjs (${e.sim}.${e.key})` + (e.module === false ? "" : `, LAB.${e.key} in docs/assets/javascripts/csim/${e.sim}.js`) +
  `, any data-${e.attr || e.key} on the pages, then run "node scripts/csim/test.mjs ${e.sim}" and rewrite the tip numbers it reports`;

for (const e of VALUES) {
  test(`${e.sim}.${e.key} = ${e.value}${e.unit ? " " + e.unit : ""} (${path.relative("docs/2027.1/hands-on", e.lab)})`, () => {
    let text;
    try { text = readFileSync(path.join(ROOT, e.lab), "utf8"); }
    catch { throw new Error(`${e.lab} is gone: point the entry at the lab file that now holds the value, or ${FIX(e)}`); }
    const got = e.read(text);
    if (got !== e.value) throw new Error(`the lab changed: ${e.lab} gives ${got}, the simulator uses ${e.value} — ${FIX(e)}`);

    if (e.module !== false) {
      const M = load(e.sim);
      if (!M.LAB) throw new Error(`csim/${e.sim}.js does not export LAB`);
      if (M.LAB[e.key] !== e.value) throw new Error(`csim/${e.sim}.js has LAB.${e.key} = ${M.LAB[e.key]}, the lab gives ${e.value}`);
    }
    for (const page of pagesOf(e.sim)) {
      const rel = path.relative(ROOT, page);
      const div = (readFileSync(page, "utf8").match(new RegExp(`<div class="csim" data-sim="${e.sim}"[^>]*>`)) || [""])[0];
      const m = div.match(new RegExp(`data-${e.attr || e.key}="([^"]*)"`));
      if (m && String(e.value) !== m[1]) throw new Error(`${rel} sets data-${e.attr || e.key}="${m[1]}", the lab gives ${e.value}`);
      if (e.quote && !tipText(e.sim, page).includes(e.quote)) throw new Error(`${rel}: the tip no longer quotes "${e.quote}" from the lab`);
    }
  });
}

test("every LAB key of a module is registered in lab-values.mjs", () => {
  const dir = path.join(ROOT, "docs/assets/javascripts/csim");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".js") && f !== "core.js")) {
    const sim = f.replace(/\.js$/, ""), M = load(sim);
    for (const k of Object.keys(M.LAB || {})) {
      if (!VALUES.some(e => e.sim === sim && e.key === k)) throw new Error(`csim/${f}: LAB.${k} is not in lab-values.mjs (LAB holds only values read from a lab)`);
    }
    if (VALUES.some(e => e.sim === sim && e.module !== false) && !M.LAB) throw new Error(`csim/${f} must export LAB`);
  }
});
