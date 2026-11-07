#!/usr/bin/env python3
"""Check that no slide of a deck overflows its 1280×720 frame.

    uv run scripts/slides/overflow.py docs/.../slides/x.src.md [...]   # these decks
    uv run scripts/slides/overflow.py                                    # every deck

Each deck is rendered bare by the pinned Marp CLI (same as build.py) into a temporary
folder, then `overflow.cjs` opens it in headless Chrome and measures every slide: content
above, below or to the right of the frame, or a code block or table that scrolls sideways.
Prints `slides=N OK` per deck, or the offending slides; exits 1 if any slide overflows.

Needs Node, Chrome (or `CHROME_PATH`) and the puppeteer-core that the Marp CLI brings
(found in the npx cache after the first `build.py` run).
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402

HERE = Path(__file__).resolve().parent
CHROMES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
           "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]


def puppeteer() -> str:
    for p in sorted((Path.home() / ".npm" / "_npx").glob("*/node_modules/puppeteer-core")):
        if (p.parent / "@marp-team" / "marp-cli").exists():
            return str(p)
    sys.exit("puppeteer-core not found: run `uv run scripts/slides/build.py --only <deck>` once")


def chrome() -> str:
    for c in [os.environ.get("CHROME_PATH", ""), *CHROMES]:
        if c and Path(c).exists():
            return c
    sys.exit("Chrome not found: set CHROME_PATH")


def main() -> int:
    srcs = [Path(a).resolve() for a in sys.argv[1:]] or sorted(build.REPO.glob("docs/**/slides/*.src.md"))
    env = {**os.environ, "PUPPETEER_CORE": puppeteer(), "CHROME_PATH": chrome()}
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        for src in srcs:
            md, out = Path(tmp) / (src.name + ".md"), Path(tmp) / (src.name + ".html")
            md.write_text(build.resolve(src))
            subprocess.run([*build.MARP, "--html", "--no-stdin", "--no-config-file", "--template", "bare",
                            "--theme-set", str(build.THEME), "-o", str(out), str(md)], check=True,
                           capture_output=True, cwd=src.parent, stdin=subprocess.DEVNULL)
            r = subprocess.run(["node", str(HERE / "overflow.cjs"), str(out)], capture_output=True, text=True, env=env)
            report = r.stdout.strip() or r.stderr.strip()[-500:]
            bad += r.returncode != 0 or not report.endswith("OK")
            print(src.relative_to(build.REPO), report)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
