# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Course documentation site for Insper's Platforms & Microservices course (5th semester, 80 hours), built with [Zensical](https://zensical.org) (`modern` variant, light/dark/system palette toggle) configured in `zensical.toml`. Content covers distributed systems, containerization, microservices, DevOps, security, and observability. Instructor: Humberto Sandmann.

## Setup

```bash
python3.12 -m venv env         # Zensical needs Python >= 3.10 (CI uses 3.12)
source ./env/bin/activate      # Required every session
pip3 install -r requirements.txt
```

## Common Commands

```bash
zensical serve                        # Local dev server at http://127.0.0.1:8000/platform/
zensical build --clean                # Build static site into site/
```

Zensical has no `gh-deploy`: CI builds `site/` and publishes it to the `gh-pages` branch. Unsupported MkDocs plugins are ignored silently, so check the generated HTML when adding a plugin.

`matplotlibrc` (project root) forces the `Agg` backend: Zensical renders pages on worker threads, where `markdown-exec` plots fail with GUI backends.

## Architecture

This is a documentation repository — no application code, no tests.

**Content lives in `docs/`**, organized as:
- `docs/classes/` — lecture notes (distributed systems, containerization, microservices, architectures)
- `docs/hands-on/` — 7 numbered lab modules (0–6): prerequisites → CRUD → gateway → security → DevOps → orchestration → observability
- `docs/exercises/` — graded student assignments (product, order, exchange, jenkins, minikube, bottlenecks, team project)
- `docs/versions/` — versioned course editions (2024.1–2026.1) with grading rubrics and schedules
- `docs/appendix/` — supporting topics (git, networking, dev setup, RSA, etc.)

**`zensical.toml`** is the central config (everything under `[project]`). TOML has no `!!python/name` tags: functions are referenced as strings (e.g. `"zensical.extensions.emoji.twemoji"`). It defines navigation, plugins, and Markdown extensions. Key capabilities enabled:
- Mermaid diagram rendering (via superfences)
- Embedded Python execution in Markdown (via `markdown-exec`)
- Image lightbox (`glightbox`), search, HTML minification
- Terminal animations: the `termynal` Markdown extension converts code blocks preceded by `<!-- termynal -->`; its assets are vendored in `docs/assets/` and initialized by `termynal-init.js`
- `exclude` plugin keeps `2026.2/exams/` out of the build (Zensical does not support `exclude_docs`)

No git-based revision dates/authors: Zensical does not support the `git-*` plugins.

### Two languages: English (default) and Brazilian Portuguese

Every page `X.md` (English) may have a translation `X.pt.md` next to it. The English build ignores
`*.pt.md` (`exclude` plugin). Zensical has no i18n plugin, so `python scripts/i18n/build.py` stages a
copy of `docs/` in `.i18n/pt/` (gitignored) where each `X.pt.md` replaces `X.md` — an untranslated page
stays in English — and builds it into `site/pt/` with a config derived from `zensical.toml`: menu titles
from `scripts/i18n/pt.json`, theme language `pt-BR`, `site_url` + `/pt`. Run it **after**
`zensical build` (CI does both). Both sites share paths (`/platform/<page>` ↔ `/platform/pt/<page>`);
the language selector (`extra.alternate`) plus `assets/javascripts/i18n.js` switch keeping the page.

```bash
python scripts/i18n/build.py --serve     # preview Portuguese at http://127.0.0.1:8002/platform/pt/
python scripts/i18n/build.py --status    # pages still without a .pt.md
python scripts/i18n/check.py [folder]    # each .pt.md has the English structure and identical code
```

When translating: links keep the English file names (`cap/index.md`, not `.pt`); snippet includes,
images and code blocks stay identical (only Mermaid labels are translated); a page that embeds a deck
points to `slides/<slug>.pt.html`, built from `slides/<slug>.pt.src.md`. **When you change an English
page, update its `.pt.md` too.** A new menu title needs an entry in `scripts/i18n/pt.json` (the build
lists the missing ones). Scripts with interface text (`mermaid-sim.js`, `interview.js`) pick the
language from `<html lang>`.

### Slides (Marp), 2026.2

Every 2026.2 class and hands-on has a summary deck at `<topic>/slides/<slug>.src.md`, in Marp Markdown,
embedded in the topic's overview page under `## Slides`:

```html
<div class="slides-embed">
  <iframe src="slides/<slug>.html" title="Slides: ..." loading="lazy" allowfullscreen></iframe>
</div>
```

`python scripts/slides/build.py` (or `--only <src.md>`) runs the Marp CLI (`npx`, version pinned, needs
Node) into `<slug>.html` next to the source; the built `.html` is committed, so CI needs no Node.
**Edit the `.src.md`, never the built `.html`**; `--check` fails when a deck is stale. The `exclude`
plugin keeps `*/slides/*.src.md` out of the site. `{{INCLUDE:path}}` (relative to the repo root)
inlines a file before Marp runs.

Every deck uses the theme `scripts/slides/theme.css` (`theme: platform`), which mirrors the site's
fonts and light/dark palettes, and includes `scripts/slides/theme.js` in its first slide so it follows
the palette of the page that embeds it. Writing rules: each slide is a fixed 1280×720 (≤ ~7 bullets,
one table, or a short code block — split otherwise; `<!-- _class: tight -->` for dense slides);
`-` lists, `*` only to reveal an answer one item at a time; boxes `.q` (question), `.ok`
(takeaway), `.warn` (pitfall); `.cols` for two columns; no Mermaid (Marp does not render it);
speaker notes as HTML comments; last slide `## Takeaways`.

**`site/`** is generated output — never edit manually; it's rebuilt on deploy.

## CI/CD

GitHub Actions (`.github/workflows/main.yaml`) triggers on every push and PR. Deployment to GitHub Pages runs only on pushes to `main`: `zensical build --clean` with Python 3.12, then `peaceiris/actions-gh-pages` publishes `site/` to the `gh-pages` branch.

## Content Patterns

Markdown files use pymdownx extensions heavily:

- **Tabs**: `=== "Tab Name"` blocks
- **Admonitions**: `!!! tip "Title"` / `??? note "Collapsible"` (types: note, tip, info, warning, danger, example, etc.)
- **Diagrams**: ` ```mermaid ``` ` fenced blocks (Mermaid v11). In 2026.2 use ` ``` mermaid-sim ` instead: same Mermaid source, rendered by `assets/javascripts/mermaid-sim.js` as a step-by-step simulator (flowchart edges, sequence messages and state transitions play in source order; class diagrams stay static)
- **Card grids**: `<div class="grid cards" markdown>` with `-   __Title__` list items

Embed Python and produce output (matplotlib, seaborn, numpy, pandas) directly in Markdown via `markdown-exec`:

````markdown
```python exec="true"
import matplotlib.pyplot as plt
# code here
```
````

Include another Markdown file verbatim with `markdown-include`:

```markdown
{!path/to/file.md!}
```

Navigation structure is explicitly declared in `zensical.toml` — adding a new page requires updating the `nav` array there. Quote numeric titles (`"2026.2"`): an unquoted `2026.2` is a dotted key in TOML.
