# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Course documentation site for Insper's Platforms & Microservices course (5th semester, 80 hours), built with MkDocs + Material theme. Content covers distributed systems, containerization, microservices, DevOps, security, and observability. Instructor: Humberto Sandmann.

## Setup

```bash
python3 -m venv env
source ./env/bin/activate      # Required every session
pip3 install -r requirements.txt
```

## Common Commands

```bash
mkdocs serve                   # Local dev server at http://127.0.0.1:8000
mkdocs build                   # Build static site into site/
mkdocs gh-deploy --force       # Deploy to GitHub Pages (CI does this automatically on main)
```

## Architecture

This is a documentation repository — no application code, no tests.

**Content lives in `docs/`**, organized as:
- `docs/classes/` — lecture notes (distributed systems, containerization, microservices, architectures)
- `docs/hands-on/` — 7 numbered lab modules (0–6): prerequisites → CRUD → gateway → security → DevOps → orchestration → observability
- `docs/exercises/` — graded student assignments (product, order, exchange, jenkins, minikube, bottlenecks, team project)
- `docs/versions/` — versioned course editions (2024.1–2026.1) with grading rubrics and schedules
- `docs/appendix/` — supporting topics (git, networking, dev setup, RSA, etc.)

**`mkdocs.yml`** is the central config (271 lines). It defines navigation, plugins, and Markdown extensions. Key capabilities enabled:
- Mermaid diagram rendering (via superfences)
- Swagger/OpenAPI rendering (via `mkdocs-render-swagger-plugin`)
- Embedded Python execution in Markdown (via `markdown-exec`)
- PDF export, image lightbox, terminal animations (termynal)
- Git-based author/revision tracking (requires `MKDOCS_GIT_COMMITTERS_APIKEY` in `.env`)

**`site/`** is generated output — never edit manually; it's rebuilt on deploy.

## CI/CD

GitHub Actions (`.github/workflows/main.yaml`) triggers on every push and PR. Deployment to GitHub Pages runs only on pushes to `main` using `mkdocs gh-deploy --force` with Python 3.12.

## Content Patterns

- Markdown files use pymdownx extensions heavily: `=== "Tab"` for tabbed content, ` ```mermaid ``` ` for diagrams, `///` for admonitions
- Python data viz (matplotlib, seaborn, numpy, pandas) can be embedded in docs via `markdown-exec`
- Navigation structure is explicitly declared in `mkdocs.yml` — adding a new page requires updating the `nav:` section there
