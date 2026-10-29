#!/usr/bin/env node
/*
 * Tests of the concept simulators (docs/assets/javascripts/csim/*.js), no browser needed:
 *
 *     node scripts/csim/test.mjs            # every <name>.test.mjs in this folder
 *     node scripts/csim/test.mjs raft lb    # only these
 *
 * Each module exports its pure model with module.exports; its tests check that the model shows
 * what the class page says it shows.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { results } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = readdirSync(here).filter(f => f.endsWith(".test.mjs")).sort()
  .filter(f => !only.length || only.includes(f.replace(".test.mjs", "")));

for (const f of files) {
  console.log(f.replace(".test.mjs", ""));
  await import(pathToFileURL(path.join(here, f)).href);
}
console.log(`\n${results.passed} passed, ${results.failed} failed`);
process.exit(results.failed ? 1 : 0);
