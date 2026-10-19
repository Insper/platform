// Heading ids of a Markdown page, computed the way Zensical (Python-Markdown's
// toc extension, default slugify) computes them: inline markup stripped, NFKD,
// non-ASCII dropped, [^\w\s-] removed, lowercased, runs of [-\s] -> "-",
// duplicates suffixed _1, _2...; an attr_list `{ #id }` wins.
// Used by validate.mjs; `node scripts/support/anchors.mjs <file.md>` prints them.
import fs from 'node:fs';

export function slugify(text) {
  let v = text.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  v = v.replace(/[^\w\s-]/g, '').trim().toLowerCase();
  return v.replace(/[-\s]+/g, '-');
}

// Markdown inline -> plain text (what the rendered heading's text content would be)
function plain(s) {
  return s
    .replace(/\[\^[^\]]+\]/g, '')                     // footnote refs
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')             // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // links
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')                    // code spans
    .replace(/<[^>]+>/g, '')                          // inline html
    .replace(/:[a-z0-9_+-]+(?:-[a-z0-9_+-]+)+:/g, '') // emoji / icon shortcodes
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

export function headings(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [], used = new Set();
  let fence = null, front = false;
  lines.forEach((line, i) => {
    if (i === 0 && line.trim() === '---') { front = true; return; }
    if (front) { if (line.trim() === '---') front = false; return; }
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      if (!fence) { fence = m[1]; return; }
      if (line.trim().startsWith(fence[0].repeat(fence.length)) && line.trim().replace(/[`~]/g, '') === '') { fence = null; return; }
    }
    if (fence) return;
    const h = line.match(/^\s{0,12}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!h) return;
    let text = h[2], id = null;
    const attr = text.match(/\s*\{:?\s*([^}]*)\}\s*$/);
    if (attr && /(^|\s)#[\w-]+/.test(attr[1])) { id = attr[1].match(/#([\w-]+)/)[1]; text = text.slice(0, attr.index); }
    else if (attr && /^\s*\.[\w-]/.test(attr[1])) text = text.slice(0, attr.index);
    const t = plain(text);
    if (!id) {
      const base = slugify(t);
      id = base; let k = 1;
      while (used.has(id)) id = base + '_' + k++;
    }
    used.add(id);
    out.push({ level: h[1].length, text: t.trim(), id, line: i + 1 });
  });
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('anchors.mjs') && process.argv[2]) {
  for (const h of headings(process.argv[2])) console.log('  '.repeat(h.level - 1) + '#' + h.id + '   ' + h.text);
}
