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

**`site/`** is generated output — never edit manually; it's rebuilt on deploy.

## CI/CD

GitHub Actions (`.github/workflows/main.yaml`) triggers on every push and PR. Deployment to GitHub Pages runs only on pushes to `main`: `zensical build --clean` with Python 3.12, then `peaceiris/actions-gh-pages` publishes `site/` to the `gh-pages` branch.

## Content Patterns

Markdown files use pymdownx extensions heavily:

- **Tabs**: `=== "Tab Name"` blocks
- **Admonitions**: `!!! tip "Title"` / `??? note "Collapsible"` (types: note, tip, info, warning, danger, example, etc.)
- **Diagrams**: ` ```mermaid ``` ` fenced blocks (Mermaid v10+)
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
