// Validates the data of the 2027.1 support tools (concept map and study cards):
//   node scripts/support/validate.mjs
// - lesson table: every class page exists;
// - map: unique ids and names, valid stages, every [lesson, anchor] exists in
//   the English page, every edge endpoint exists, no self loops or duplicate
//   pairs, no orphan concepts, every trail step exists, every class has concepts;
// - cards: valid lesson/stage/level, unique ids (lesson + name), every anchor
//   exists, every class page has cards, counts by class, level, stage;
// - pages: every relative Markdown link of the two support pages points to a file.
// Exits with 1 when something is wrong.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { headings } from './anchors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const JS = path.join(ROOT, 'docs/assets/javascripts/support');
const CLASSES = path.join(ROOT, 'docs/2027.1/classes');
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['arq-lessons.js', 'mapa-arq-dados.js', 'cartas-arq-dados.js']) vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
const { LESSONS, LESSON, THEMES, STAGES, parent, theme } = ctx.window.ARQ;
const MAP = ctx.window.MAPA_ARQ, CARDS = ctx.window.CARTAS_ARQ;

let errors = 0, warnings = 0;
const err = m => { errors++; console.log('  ✗ ' + m); };
const warn = m => { warnings++; console.log('  ! ' + m); };
const STAGE_KEYS = STAGES.map(s => s[0]);

/* lesson table */
const anchors = {};
for (const [code, p] of LESSONS) {
  const f = path.join(CLASSES, p, 'index.md');
  if (!fs.existsSync(f)) { err(`lesson ${code}: ${path.relative(ROOT, f)} does not exist`); continue; }
  anchors[code] = new Set(headings(f).map(h => h.id));
}
const anchorOk = (code, a) => anchors[code] && anchors[code].has(a);
for (const [, , cls] of THEMES) cls.forEach(c => { if (!LESSON[c]) err('theme lists unknown class ' + c); });

/* concept map */
console.log('Concept map');
const ids = new Set(), names = new Set();
for (const n of MAP.nodes) {
  const w = 'concept ' + n.id;
  if (!/^[a-z0-9-]+$/.test(n.id || '')) err(w + ': bad id');
  if (ids.has(n.id)) err(w + ': duplicate id'); ids.add(n.id);
  const nm = (n.n || '').toLowerCase();
  if (!nm || !n.d) err(w + ': missing name or definition');
  if (names.has(nm)) err(w + ': duplicate name "' + n.n + '"'); names.add(nm);
  if (!STAGE_KEYS.includes(n.e)) err(w + ': bad stage ' + n.e);
  if (!Array.isArray(n.a) || !n.a.length) err(w + ': no [lesson, anchor]');
  for (const [c, a] of n.a || []) {
    if (!LESSON[c]) err(`${w}: unknown lesson ${c}`);
    else if (!anchorOk(c, a)) err(`${w}: #${a} not found in ${LESSON[c].path}`);
  }
  if (n.d && n.d.length > 480) warn(w + ': long definition (' + n.d.length + ' chars)');
}
const pairs = new Set(), degree = {};
for (const [a, b, s] of MAP.edges) {
  if (!ids.has(a)) err(`edge ${a} → ${b}: unknown ${a}`);
  if (!ids.has(b)) err(`edge ${a} → ${b}: unknown ${b}`);
  if (a === b) err(`edge ${a} → ${b}: self loop`);
  if (!s) err(`edge ${a} → ${b}: no sentence`);
  const k = [a, b].sort().join('|');
  if (pairs.has(k)) err(`edge ${a} — ${b}: duplicate pair`); pairs.add(k);
  degree[a] = (degree[a] || 0) + 1; degree[b] = (degree[b] || 0) + 1;
}
for (const n of MAP.nodes) if (!degree[n.id]) err('concept ' + n.id + ': orphan (no connections)');
MAP.trails.forEach((T, i) => {
  if (!T.n || !T.p || T.p.length < 4) err(`trail ${i + 1}: needs a name and at least 4 steps`);
  T.p.forEach(([id, s]) => { if (!ids.has(id)) err(`trail ${i + 1}: unknown concept ${id}`); if (!s) err(`trail ${i + 1}: step ${id} has no sentence`); });
  const seen = new Set(); T.p.forEach(([id]) => { if (seen.has(id)) err(`trail ${i + 1}: ${id} repeated`); seen.add(id); });
});
const byClass = {};
for (const n of MAP.nodes) for (const [c] of n.a) byClass[parent(c)] = (byClass[parent(c)] || 0) + 1;
LESSONS.filter(([c]) => !c.includes('.')).forEach(([c]) => { if (!byClass[c]) err('class ' + c + ' has no concept on the map'); });
const first = n => n.f || n.a.map(x => x[0]).sort((p, q) => LESSON[p].i - LESSON[q].i)[0];
for (const n of MAP.nodes) if (n.f && !n.a.some(x => x[0] === n.f)) err('concept ' + n.id + ': f ' + n.f + ' is not one of its lessons');
const grid = {};
for (const n of MAP.nodes) if (LESSON[first(n)]) { const k = theme(first(n)) + n.e; grid[k] = (grid[k] || 0) + 1; }
console.log(`  ${MAP.nodes.length} concepts, ${MAP.edges.length} connections, ${MAP.trails.length} trails`);
console.log('  grid (rows = themes, columns = ' + STAGE_KEYS.join(' ') + '):');
for (const [k, name] of THEMES) console.log('    ' + k + ' ' + name.padEnd(22) + STAGE_KEYS.map(e => String(grid[k + e] || 0).padStart(4)).join(''));

/* study cards */
console.log('Study cards');
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
const cardIds = new Set(), perLesson = {}, perClass = {}, levels = [0, 0, 0, 0], stages = {};
let scenes = 0;
CARDS.forEach((c, i) => {
  const w = `card ${i + 1} (${c.l} "${c.name}")`;
  if (!LESSON[c.l]) { err(w + ': unknown lesson'); return; }
  if (!STAGE_KEYS.includes(c.e)) err(w + ': bad stage');
  if (![1, 2, 3].includes(c.n)) err(w + ': bad level');
  for (const k of ['name', 'q', 'a', 's']) if (!c[k]) err(w + ': missing ' + k);
  const id = c.l + '-' + slug(c.name || '');
  if (cardIds.has(id)) err(w + ': duplicate id ' + id); cardIds.add(id);
  if (c.s && !anchorOk(c.l, c.s)) err(`${w}: #${c.s} not found in ${LESSON[c.l].path}`);
  if (c.c) scenes++;
  perLesson[c.l] = (perLesson[c.l] || 0) + 1;
  perClass[parent(c.l)] = (perClass[parent(c.l)] || 0) + 1;
  levels[c.n]++; stages[c.e] = (stages[c.e] || 0) + 1;
});
LESSONS.forEach(([c]) => { if (!perLesson[c]) err('lesson ' + c + ' (' + LESSON[c].path + ') has no card'); });
console.log(`  ${CARDS.length} cards, ${scenes} challenge situations`);
console.log(`  levels warm-up/practice/challenge: ${levels[1]}/${levels[2]}/${levels[3]}`);
console.log('  stages: ' + STAGE_KEYS.map(k => k + ' ' + (stages[k] || 0)).join(', '));
console.log('  per class: ' + Object.entries(perClass).map(([k, v]) => k + ' ' + v).join(', '));

/* the two pages */
console.log('Pages');
for (const p of ['concept-map/index.md', 'flashcards/index.md']) {
  const f = path.join(ROOT, 'docs/2027.1/support', p);
  if (!fs.existsSync(f)) { err(p + ' does not exist'); continue; }
  const md = fs.readFileSync(f, 'utf8');
  for (const m of md.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
    const target = path.resolve(path.dirname(f), m[1]);
    if (!fs.existsSync(target)) err(`${p}: link ${m[1]} → missing file`);
  }
  console.log('  ' + p + ' ok');
}

console.log(errors ? `\n${errors} error(s), ${warnings} warning(s)` : `\nOK (${warnings} warning(s))`);
process.exitCode = errors ? 1 : 0;
