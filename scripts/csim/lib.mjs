/* Helpers for the concept-simulator tests (see test.mjs). */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const results = { passed: 0, failed: 0 };

/* the pure engine of docs/assets/javascripts/csim/<name>.js */
export function load(name) {
  return require(path.join(here, "../../docs/assets/javascripts/csim", name + ".js"));
}

export function test(name, fn) {
  try { fn(); results.passed++; console.log("  ok   " + name); }
  catch (err) { results.failed++; console.log("  FAIL " + name + "\n       " + (err && err.message || err)); }
}

export function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

export function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg}: ${a} not within ${tol} of ${b}`);
}

/* ------------------------------------------------------------------ tips */


export const ROOT = path.join(here, "../..");

/* every page (en and pt) that embeds <div class="csim" data-sim="<sim>"> */
export function pagesOf(sim) {
  const out = [];
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "slides") walk(p); }
      else if (f.endsWith(".md") && readFileSync(p, "utf8").includes(`data-sim="${sim}"`)) out.push(p);
    }
  })(path.join(ROOT, "docs/2027.1"));
  return out.sort();
}

/* the "Try it" / "Experimente" box right after the simulator in a page, as plain text */
export function tipText(sim, page) {
  const lines = readFileSync(page, "utf8").split("\n");
  const at = lines.findIndex(l => l.includes(`data-sim="${sim}"`));
  if (at < 0) return "";
  let i = at + 1;
  while (i < lines.length && !lines[i].trim()) i++;
  if (!/^!!! tip/.test(lines[i] || "")) return "";
  const body = [];
  for (i++; i < lines.length && (!lines[i].trim() || /^ {4}/.test(lines[i])); i++) body.push(lines[i].trim());
  return body.join(" ").replace(/\*\*|`/g, "").replace(/\s+/g, " ");
}

/* a number as each language writes it: 1,060.5 / 1.060,5 */
export function fmt(x, decimals = 0, lang = "en") {
  return x.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/*
 * Asserts that the simulator's tip on every page quotes these texts. `texts` is a function of the
 * language ("en" | "pt") returning strings, so numbers can be formatted per language:
 *   tipHas("cache", lang => [fmt(hit * 100, 0, lang) + "%", "60 s"]);
 */
export function tipHas(sim, texts) {
  const pages = pagesOf(sim);
  if (!pages.length) throw new Error(`no page embeds data-sim="${sim}"`);
  for (const page of pages) {
    const lang = page.endsWith(".pt.md") ? "pt" : "en";
    const tip = tipText(sim, page);
    if (!tip) throw new Error(`${path.relative(ROOT, page)}: no tip box after the simulator`);
    for (const s of texts(lang)) {
      if (!tip.includes(s)) throw new Error(`${path.relative(ROOT, page)}: the tip does not say "${s}" (the model now gives it) — rewrite the tip`);
    }
  }
}
