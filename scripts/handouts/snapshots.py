#!/usr/bin/env python3
"""Build the cumulative BoxOffice snapshots of the 2027.1 hands-on labs.

    uv run scripts/handouts/snapshots.py            # write boxoffice-after-lab-<n>.zip into each lab
    uv run scripts/handouts/snapshots.py --check    # only validate the overlays

The labs are incremental: one student repository, `boxoffice/`, grows from lab 0 to the last
lab. `docs/2027.1/hands-on/<n>/code/` is an overlay with every file that lab adds or changes,
in full, at its path relative to the repository root; `code/DELETED` lists files the lab
removes. The state at the end of lab N is the overlay of labs 0..N in order, and that is
what `boxoffice-after-lab-<N>.zip` contains (one top-level folder, `boxoffice/`), so a student
who skipped or broke a lab can catch up with the next one.

The zips are generated (CI runs this before the site build) and are not committed.

--check verifies that every `--8<--` include of a lab page that points into a `code/` folder
exists, and that YAML/JSON files of the overlays parse (when PyYAML is available). It also
checks the "In the BoxOffice code" includes of the class pages (`docs/2027.1/classes/`), which
may select lines (`path:start:end`): the file must exist, the range must fit in it and its first
line must not be blank — a range that moved after an edit of the lab code usually breaks one of those.
It also runs the simulators' lab-value check (`node scripts/csim/test.mjs lab-values`, when Node is
installed): the concept simulators copy some lab settings (TTLs, partitions, breaker, HPA…), listed in
`scripts/csim/lab-values.mjs`, and a lab edit that changes one of them must update the simulator and its tip.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LABS = REPO / "docs" / "2027.1" / "hands-on"
CLASSES = REPO / "docs" / "2027.1" / "classes"
INCLUDE = re.compile(r'--8<--\s+"([^"]+)"')
# build artifacts that may appear when a lab is run inside its code/ folder
SKIP = {".venv", "target", "node_modules", "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", ".DS_Store"}


def labs() -> list[Path]:
    return sorted((p for p in LABS.iterdir() if p.is_dir() and p.name.isdigit()), key=lambda p: int(p.name))


def overlay(state: dict[str, Path], lab: Path) -> None:
    code = lab / "code"
    if not code.is_dir():
        return
    deleted = code / "DELETED"
    if deleted.exists():
        for line in deleted.read_text().splitlines():
            state.pop(line.strip(), None)
    for f in sorted(code.rglob("*")):
        if f.is_file() and f != deleted and not SKIP.intersection(f.relative_to(code).parts):
            state[f.relative_to(code).as_posix()] = f


def write_zip(state: dict[str, Path], target: Path) -> None:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, src in sorted(state.items()):
            info = zipfile.ZipInfo(f"boxoffice/{rel}", date_time=(2027, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            # keep shell scripts executable
            mode = 0o755 if src.suffix == ".sh" or src.stat().st_mode & 0o111 else 0o644
            info.external_attr = (0o100000 | mode) << 16
            z.writestr(info, src.read_bytes())


def check_include(page: Path, inc: str) -> list[str]:
    """`path` or `path:start:end[,start:end...]`, relative to the repository root."""
    path, _, ranges = inc.partition(":")
    where = f"{page.relative_to(REPO)}: include {inc}"
    f = REPO / path
    if not f.exists():
        return [f"{where}: file not found"]
    lines = f.read_text().splitlines()
    errors = []
    for r in filter(None, ranges.split(",")):
        start, _, end = r.partition(":")
        start, end = int(start or 1), int(end or len(lines))
        if not 1 <= start <= end <= len(lines):
            errors.append(f"{where}: lines {start}-{end} outside the file ({len(lines)} lines)")
        elif not lines[start - 1].strip():
            errors.append(f"{where}: line {start} is blank (did the code move?)")
    return errors


def check_simulators() -> list[str]:
    """The lab values copied by the concept simulators (scripts/csim/lab-values.mjs) still match the labs."""
    node = shutil.which("node")
    if not node:
        print("note: Node not found, the simulators' lab values were not checked "
              "(node scripts/csim/test.mjs lab-values)", file=sys.stderr)
        return []
    run = subprocess.run([node, str(REPO / "scripts/csim/test.mjs"), "lab-values"], capture_output=True, text=True)
    if run.returncode == 0:
        return []
    lines = run.stdout.splitlines()
    fails = [f"simulator lab value: {l.strip()[5:]} — {lines[i + 1].strip()}"
             for i, l in enumerate(lines) if l.strip().startswith("FAIL") and i + 1 < len(lines)]
    return fails or [f"simulator lab values: node scripts/csim/test.mjs lab-values failed\n{run.stdout}{run.stderr}"]


def check_classes() -> list[str]:
    errors = []
    for page in sorted(CLASSES.rglob("*.md")):
        for inc in INCLUDE.findall(page.read_text()):
            if "/hands-on/" in inc and "/code/" in inc:
                errors += check_include(page, inc)
    return errors


def check(lab: Path) -> list[str]:
    errors = []
    for page in lab.rglob("*.md"):
        for inc in INCLUDE.findall(page.read_text()):
            if "/code/" in inc:
                errors += check_include(page, inc)
    code = lab / "code"
    try:
        import yaml  # optional
    except ImportError:
        yaml = None
    if code.is_dir():
        for f in code.rglob("*"):
            if SKIP.intersection(f.relative_to(code).parts):
                continue
            if f.suffix in (".yaml", ".yml") and yaml is not None:
                try:
                    list(yaml.safe_load_all(f.read_text()))
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{f.relative_to(REPO)}: invalid YAML: {exc}".splitlines()[0])
            elif f.suffix == ".json":
                try:
                    json.loads(f.read_text())
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{f.relative_to(REPO)}: invalid JSON: {exc}")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    args = ap.parse_args()

    state: dict[str, Path] = {}
    errors: list[str] = []
    for lab in labs():
        overlay(state, lab)
        errors += check(lab)
        if not args.check and state:
            target = lab / f"boxoffice-after-lab-{lab.name}.zip"
            write_zip(state, target)
            print(f"{target.relative_to(REPO)}: {len(state)} files")
    errors += check_classes()
    if args.check:
        errors += check_simulators()
    for e in errors:
        print(e, file=sys.stderr)
    if args.check and not errors:
        print("ok")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
