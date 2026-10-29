#!/usr/bin/env python3
"""Check that each Portuguese page has the same structure as its English original.

    python scripts/i18n/check.py                  # every X.md / X.pt.md pair
    python scripts/i18n/check.py docs/2026.2/hands-on   # pairs under a folder

A translation changes the prose, not the page: the same code blocks (with the
same code — only Mermaid labels may be translated), snippet includes, images,
admonitions, content tabs, footnotes and headings, in the same numbers. The
check also covers the decks: `slides/<slug>.src.md` vs `slides/<slug>.pt.src.md`
must have the same number of slides.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FENCE = re.compile(r"^(\s*)(```|~~~)(.*)$")


def blocks(text: str) -> list[tuple[str, str]]:
    """(info string, code) of every fenced block; Mermaid code is not compared."""
    out, lines, i = [], text.split("\n"), 0
    while i < len(lines):
        m = FENCE.match(lines[i])
        if m:
            indent, mark, info = m.groups()
            body, i = [], i + 1
            while i < len(lines) and not re.match(rf"^{re.escape(indent)}{mark}\s*$", lines[i]):
                body.append(lines[i].strip())
                i += 1
            info = info.strip()
            out.append((info, "" if "mermaid" in info or "diagram" in info else "\n".join(body)))
        i += 1
    return out


def outside_code(text: str) -> str:
    keep, inside = [], None
    for line in text.split("\n"):
        m = FENCE.match(line)
        if m and inside is None:
            inside = m.group(1) + m.group(2)
        elif inside is not None and re.match(rf"^{re.escape(inside)}\s*$", line):
            inside = None
        elif inside is None:
            keep.append(line)
    return "\n".join(keep)


def features(text: str) -> dict[str, int]:
    prose = outside_code(text)
    return {
        "headings": len(re.findall(r"^#{1,6} ", prose, re.M)),
        "admonitions": len(re.findall(r"^\s*(!!!|\?\?\?)", prose, re.M)),
        "tabs": len(re.findall(r'^\s*=== "', prose, re.M)),
        "images": len(re.findall(r"!\[[^\]]*\]\(", prose)),
        "footnotes": len(re.findall(r"^\[\^[^\]]+\]:", prose, re.M)),
        "snippets": len(re.findall(r"--8<--", text)),
        "iframes": len(re.findall(r"<iframe", prose)),
    }


def check_page(en: Path, pt: Path) -> list[str]:
    a, b = en.read_text(), pt.read_text()
    errs = []
    fa, fb = features(a), features(b)
    for k in fa:
        if fa[k] != fb[k]:
            errs.append(f"{k}: {fa[k]} in English, {fb[k]} in Portuguese")
    ba, bb = blocks(a), blocks(b)
    if len(ba) != len(bb):
        errs.append(f"code blocks: {len(ba)} in English, {len(bb)} in Portuguese")
    else:
        for n, ((ia, ca), (ib, cb)) in enumerate(zip(ba, bb), 1):
            if ia != ib:
                errs.append(f"code block {n}: info `{ia}` vs `{ib}`")
            elif ca != cb:
                errs.append(f"code block {n} ({ia or 'no language'}): code differs")
    return errs


def check_deck(en: Path, pt: Path) -> list[str]:
    count = lambda p: len(re.findall(r"^---\s*$", p.read_text(), re.M))
    a, b = count(en), count(pt)
    return [] if a == b else [f"slides: {a - 1} in English, {b - 1} in Portuguese"]


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "docs"
    root = root if root.is_absolute() else REPO / root
    bad = 0
    for pt in sorted(root.rglob("*.pt.md")):
        en = pt.with_name(pt.name[: -len(".pt.md")] + ".md")
        errs = check_page(en, pt) if en.exists() else ["no English original"]
        if errs:
            bad += 1
            print(f"{pt.relative_to(REPO)}\n  " + "\n  ".join(errs))
    for pt in sorted(root.rglob("slides/*.pt.src.md")):
        en = pt.with_name(pt.name.replace(".pt.src.md", ".src.md"))
        errs = check_deck(en, pt) if en.exists() else ["no English deck"]
        if errs:
            bad += 1
            print(f"{pt.relative_to(REPO)}\n  " + "\n  ".join(errs))
    print("ok" if not bad else f"\n{bad} file(s) with differences")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
