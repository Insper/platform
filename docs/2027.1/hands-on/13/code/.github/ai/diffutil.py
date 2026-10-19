"""Unified-diff helpers: which lines a pull request added, and a numbered view of the diff.

Models are bad at counting lines. Instead of asking the model to work out line numbers
from `@@` headers, we print every new-side line with its number (`L42`), and later accept
only findings that point to a line the pull request actually added.
"""
from __future__ import annotations

import fnmatch
import re
import subprocess

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
SKIP = ["*.lock", "*-lock.json", "*.min.js", "*.svg", "*.png", "*.jpg", "**/generated/**",
        "*/target/*", "*/node_modules/*"]


def git_diff(base: str, head: str) -> str:
    """Diff of the pull request: changes on `head` since it forked from `base`."""
    return subprocess.run(["git", "diff", "--unified=3", "--no-color", f"{base}...{head}"],
                          check=True, capture_output=True, text=True).stdout


def split_files(diff: str) -> dict[str, list[str]]:
    """{path: lines of that file's diff} for files that still exist after the change."""
    files: dict[str, list[str]] = {}
    current, header = None, False
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            current, header = None, True
        elif header and line.startswith("@@"):
            header = False
            if current is not None:
                files[current].append(line)
        elif header and line.startswith("+++ "):
            path = line[4:].strip()
            current = None if path == "/dev/null" else path.removeprefix("b/")
            if current and not any(fnmatch.fnmatch(current, p) for p in SKIP):
                files[current] = []
            else:
                current = None
        elif current is not None and (line.startswith(("@@", "+", "-", " ")) or line == ""):
            files[current].append(line)
    return files


def added_lines(file_lines: list[str]) -> set[int]:
    """New-side line numbers of the lines this diff adds (`+`)."""
    added, new_no = set(), 0
    for line in file_lines:
        m = HUNK.match(line)
        if m:
            new_no = int(m.group(1))
        elif line.startswith("+"):
            added.add(new_no)
            new_no += 1
        elif line.startswith("-"):
            continue
        else:
            new_no += 1
    return added


def numbered(path: str, file_lines: list[str]) -> str:
    """The diff of one file with new-side numbers: `L42 + code`, `L43   context`."""
    out, new_no = [f"### {path}"], 0
    for line in file_lines:
        m = HUNK.match(line)
        if m:
            new_no = int(m.group(1))
            out.append(line)
        elif line.startswith("-"):
            out.append(f"      - {line[1:]}")
        else:
            mark = "+" if line.startswith("+") else " "
            out.append(f"L{new_no:<4} {mark} {line[1:]}")
            new_no += 1
    return "\n".join(out)


def budget(files: dict[str, list[str]], max_lines: int) -> tuple[dict[str, list[str]], list[str]]:
    """Keep whole files, production code first, until `max_lines`; return the skipped paths.

    Truncating in the middle of a file produces nonsense reviews; skipping whole files and
    *saying so* in the summary is honest.
    """
    def priority(path: str) -> tuple[int, str]:
        return (0 if "/src/main/" in path else 1 if "/src/test/" in path else 2, path)

    kept, skipped, used = {}, [], 0
    for path in sorted(files, key=priority):
        size = len(files[path])
        if used + size <= max_lines:
            kept[path], used = files[path], used + size
        else:
            skipped.append(path)
    return kept, skipped
