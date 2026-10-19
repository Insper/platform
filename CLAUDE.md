# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Course documentation site for Insper's Platforms & Microservices course (5th semester, 80 hours), built with [Zensical](https://zensical.org) (`modern` variant, light/dark/system palette toggle) configured in `zensical.toml`. Content covers distributed systems, containerization, microservices, DevOps, security, and observability. Instructor: Humberto Sandmann.

## Setup

Dependencies are managed with [uv](https://docs.astral.sh/uv/): `pyproject.toml` + `uv.lock`, Python 3.12
from `.python-version`. Never use pip or `requirements.txt`.

```bash
uv sync                        # create .venv/ and install exactly what uv.lock pins
uv add <package>               # add a dependency (updates pyproject.toml and uv.lock)
```

No activation needed: prefix commands with `uv run`.

## Common Commands

```bash
uv run zensical-i18n build            # Build both languages into site/ (English) and site/pt/
uv run zensical-i18n serve            # Preview English at http://127.0.0.1:8000/platform/ (live reload)
uv run zensical-i18n serve --lang pt  # Preview Portuguese
```

`zensical-i18n` wraps `zensical` (same options); plain `zensical build` still works but builds only one language.

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

Built by [zensical-i18n](https://github.com/hsandmann/zensical-i18n) (`[project.plugins.i18n]` in
`zensical.toml`, suffix structure, as mkdocs-static-i18n). Every page `X.md` (English) may have a
translation `X.pt.md` next to it — any file works the same way: `slides/x.pt.html` is the Portuguese
version of `slides/x.html`. English is built to the site root and Portuguese to `/pt/`, sharing paths
(`/platform/<page>` ↔ `/platform/pt/<page>`); the plugin adds the language selector (it keeps the page),
hreflang sitemaps, translated default admonition titles, and a notice on pages that fall back to English.

When translating: links, snippet includes and image paths keep the English file names, with no suffix
(`cap/index.md`, `slides/x.html`) — the plugin resolves them per language; code blocks stay identical
(only Mermaid labels are translated). A snippet is read from the repository, not resolved per language,
so a translated included file needs its own path (e.g. `cap-venn.pt.svg`). Decks: `slides/<slug>.pt.src.md`
builds `slides/<slug>.pt.html`. **When you change an English page, update its `.pt.md` too.** A new menu
title needs an entry in `[project.plugins.i18n.languages.nav_translations]`. Scripts with interface text
(`mermaid-sim.js`, `interview.js`) pick the language from `<html lang>`.

```bash
uv run scripts/i18n/check.py [folder]    # each .pt.md has the English structure and identical code
```

### Slides (Marp), 2026.2

Every 2026.2 class and hands-on has a summary deck at `<topic>/slides/<slug>.src.md`, in Marp Markdown,
embedded in the topic's overview page under `## Slides`:

```html
<div class="slides-embed">
  <iframe src="slides/<slug>.html" title="Slides: ..." loading="lazy" allowfullscreen></iframe>
</div>
```

`uv run scripts/slides/build.py` (or `--only <src.md>`) runs the Marp CLI (`npx`, version pinned, needs
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

### Unlisted sections: 2027.1 and the Playground

`docs/2027.1/` (the System Design edition) and `docs/playground/` (the System Design Playground
simulator, edition-independent, at `/platform/playground/`) are **published but not in the nav**
yet: their nav blocks in `zensical.toml` are commented out with `#~ ` (search for `#~`). To list
them, remove that prefix. The simulator code is `docs/assets/javascripts/playground/*.js` +
`assets/stylesheets/playground.css`; engine tests: `node scripts/playground/test_engine.mjs`.
`SDP.catalogBase` in `catalog.js` sets where "Learn more" points (the edition's component catalog).

### Hands-on labs (2027.1): incremental and autonomous

One student repository, `boxoffice/`, grows from lab 0 to lab 13. `docs/2027.1/hands-on/<n>/code/` is
an overlay: every file the lab adds or changes, in full, at its repo-relative path (`code/DELETED`
lists removals); pages include them with `--8<--`. The state after lab N is the overlay of labs 0..N.
Each lab has "Start state", "Catch up" (link to `../<N-1>/boxoffice-after-lab-<N-1>.zip`) and "End
state", and must be followable by a student alone: full files, commands with their directory,
"You should see…" checkpoints, troubleshooting, clean-up, deliverable checklist.

```bash
uv run scripts/handouts/snapshots.py           # build boxoffice-after-lab-<n>.zip (CI does it; gitignored)
uv run scripts/handouts/snapshots.py --check   # includes exist, YAML/JSON of the overlays parse
```

**`site/`** is generated output — never edit manually; it's rebuilt on deploy.

## CI/CD

GitHub Actions (`.github/workflows/main.yaml`) triggers on every push and PR. Deployment to GitHub Pages runs only on pushes to `main`: `uv sync --frozen` then `uv run zensical-i18n build --clean` (both languages), then `peaceiris/actions-gh-pages` publishes `site/` to the `gh-pages` branch.

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
