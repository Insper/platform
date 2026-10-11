#!/usr/bin/env python3
"""Build the class slides (Marp) from their sources.

    python scripts/slides/build.py                 # build every deck
    python scripts/slides/build.py --check         # fail if a deck is out of date
    python scripts/slides/build.py --only docs/.../slides/x.src.md   # just this deck

A deck lives next to the page it summarizes, in `<page folder>/slides/<name>.src.md`,
written in Marp Markdown. The source can include other files with a marker that
this script resolves before calling the Marp CLI:

    {{INCLUDE:path}}   any file, relative to the repository root

Every deck uses the `platform` theme (`theme: platform` in the front matter),
defined in `scripts/slides/theme.css`, and includes `scripts/slides/theme.js` in
its first slide so it follows the light/dark palette of the page that embeds it.

The result is a single `<name>.html` next to the source, committed: CI does not
need Node. The `.src.md` stays out of the site (`exclude` plugin in
zensical.toml); otherwise Zensical would render it as a page.

The Marp CLI comes from npm (`npx @marp-team/marp-cli`), so Node is required.
The version is pinned so that rebuilding produces no diff.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MARP = ["npx", "-y", "@marp-team/marp-cli@4.5.1"]
THEME = Path(__file__).resolve().parent / "theme.css"
MARK = re.compile(r"\{\{INCLUDE:([^}]+)\}\}")


def resolve(src: Path) -> str:
    built = MARK.sub(lambda m: (REPO / m.group(1).strip()).read_text().strip(), src.read_text())
    leftover = re.search(r"\{\{[A-Z_]+[^\n]{0,80}", built)
    if leftover:
        raise SystemExit(f"unresolved marker in {src.name}: {leftover.group(0)[:90]}")
    return built


def check_scripts(src: Path, built: str) -> None:
    """Fail if Markdown touched the JS of a <script>: operators become entities
    (`=>` turns into `=&gt;`) and the script breaks silently inside the deck."""
    for body in re.findall(r"<script>(.*?)</script>", built, flags=re.S):
        hit = re.search(r"=&gt;|&amp;&amp;|&lt;=|&gt;=", body)
        if hit:
            line = body[max(0, hit.start() - 60):hit.end() + 20].strip().splitlines()[-1]
            raise SystemExit(f"{src.name}: script escaped by Markdown: {line[:100]}")


def render(src: Path) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        md, out = Path(tmp) / "deck.md", Path(tmp) / "deck.html"
        md.write_text(resolve(src))
        # Without a terminal on stdin (CI, editors) Marp waits for Markdown on it
        # and never finishes; --no-stdin and DEVNULL close that door.
        subprocess.run([*MARP, "--html", "--no-stdin", "--no-config-file",
                        "--theme-set", str(THEME), "-o", str(out), str(md)],
                       check=True, capture_output=True, cwd=src.parent, stdin=subprocess.DEVNULL)
        built = out.read_text()
    check_scripts(src, built)
    return built


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="do not write; fail if a deck is out of date")
    ap.add_argument("--only", nargs="+", metavar="SRC",
                    help="build only these .src.md (relative to the repository root or absolute)")
    args = ap.parse_args()

    if args.only:
        sources = [Path(p) if Path(p).is_absolute() else REPO / p for p in args.only]
        missing = [str(p) for p in sources if not p.is_file()]
        if missing:
            raise SystemExit("not found: " + ", ".join(missing))
    else:
        sources = sorted((REPO / "docs").rglob("slides/*.src.md"))

    stale = []
    for src in sources:
        out = src.with_name(src.name.replace(".src.md", ".html"))
        built = render(src)
        current = out.read_text() if out.exists() else None
        rel = out.relative_to(REPO)
        if built == current:
            print(f"  ok       {rel}")
            continue
        if args.check:
            stale.append(rel)
            print(f"  STALE    {rel}")
        else:
            out.write_text(built)
            print(f"  built    {rel}  ({len(built) // 1024} KB)")

    if stale:
        print("\nRun: python scripts/slides/build.py", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
