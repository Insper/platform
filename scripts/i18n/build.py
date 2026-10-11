#!/usr/bin/env python3
"""Build the Brazilian Portuguese site (English is the default).

    python scripts/i18n/build.py              # build site/pt (run after `zensical build`)
    python scripts/i18n/build.py --serve      # preview at http://127.0.0.1:8002/platform/pt/
    python scripts/i18n/build.py --status     # list the pages still without a translation

A translated page lives next to its original: `X.md` (English) and `X.pt.md`
(Portuguese). The English build ignores every `*.pt.md` (`exclude` plugin in
zensical.toml). Zensical has no i18n plugin, so this script stages a copy of
`docs/` in `.i18n/pt/`, where each `X.pt.md` replaces its `X.md` (a page without
a translation stays in English), and builds it with a configuration derived
from zensical.toml: menu titles from `scripts/i18n/pt.json`, theme language
`pt-BR` and `site_url` ending in `/pt`. The output goes to `site/pt/`, so both
languages are published together and share the same paths: `/platform/<page>`
and `/platform/pt/<page>`. The language selector (extra.alternate) and
`assets/javascripts/i18n.js` switch between the two keeping the page.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
STAGE = REPO / ".i18n" / "pt"
DICT = json.loads((Path(__file__).parent / "pt.json").read_text())
ZENSICAL = Path(sys.executable).parent / "zensical"


def pt_config(src: str) -> str:
    """zensical.toml → configuration of the Portuguese site."""
    missing = set()

    def title(m: re.Match) -> str:
        t = m.group(1)
        if t not in DICT["nav"] and not re.fullmatch(r"[\d.]+", t):
            missing.add(t)
        return '{ "' + DICT["nav"].get(t, t) + '" ='

    out = re.sub(r'\{ "([^"]+)" =', title, src)
    out = re.sub(r'^site_name = .*$', f'site_name = "{DICT["site_name"]}"', out, count=1, flags=re.M)
    out = re.sub(r'^(site_url = "[^"]*?)/?"', r'\1/pt"', out, count=1, flags=re.M)
    out = out.replace("[project.theme]\n", '[project.theme]\nlanguage = "pt-BR"\n', 1)
    if missing:
        print("menu titles without translation (scripts/i18n/pt.json): " + ", ".join(sorted(missing)))
    return out


def stage() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    docs = STAGE / "docs"
    shutil.copytree(REPO / "docs", docs, ignore=shutil.ignore_patterns("exams"))
    for pt in docs.rglob("*.pt.md"):
        pt.replace(pt.with_name(pt.name[: -len(".pt.md")] + ".md"))
    shutil.copy(REPO / "matplotlibrc", STAGE / "matplotlibrc")
    (STAGE / "zensical.toml").write_text(pt_config((REPO / "zensical.toml").read_text()))


def status() -> int:
    pages = sorted(p for p in (REPO / "docs").rglob("*.md")
                   if not p.name.endswith(".pt.md") and "/slides/" not in str(p)
                   and "/exams/" not in str(p))
    todo = [p for p in pages if not p.with_name(p.stem + ".pt.md").exists()]
    for p in todo:
        print("  missing  " + str(p.relative_to(REPO)))
    print(f"\n{len(pages) - len(todo)} of {len(pages)} pages translated")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--serve", action="store_true", help="preview the Portuguese site")
    ap.add_argument("--status", action="store_true", help="list pages without translation")
    args = ap.parse_args()
    if args.status:
        return status()

    stage()
    if args.serve:
        return subprocess.call([str(ZENSICAL), "serve", "-a", "127.0.0.1:8002"], cwd=STAGE)

    subprocess.run([str(ZENSICAL), "build", "--clean"], cwd=STAGE, check=True)
    out = REPO / "site" / "pt"
    if out.exists():
        shutil.rmtree(out)
    shutil.move(str(STAGE / "site"), str(out))
    print(f"built {out.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
