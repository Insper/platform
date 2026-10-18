"""Measure the AI reviewer over the pull requests of the last N days.

    python .github/ai/metrics.py --days 7 > ai-metrics.md

Per PR: AI comments posted, rated useful (👍) / not useful (👎) / outdated (the line changed
afterwards, a weak signal that the comment was addressed), review cost (from the sticky
comment), time to merge and CI minutes. Totals: precision = 👍 / (👍 + 👎).
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
from datetime import datetime, timedelta, timezone


def gh_json(*args: str):
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def ts(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()
    repo = subprocess.run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
                          check=True, capture_output=True, text=True).stdout.strip()
    since = (datetime.now(timezone.utc) - timedelta(days=args.days)).date().isoformat()
    prs = json.loads(subprocess.run(
        ["gh", "pr", "list", "--state", "all", "--search", f"created:>={since}", "--limit", "200",
         "--json", "number,title,createdAt,mergedAt,headRefName"],
        check=True, capture_output=True, text=True).stdout)

    rows, tot = [], {"ai": 0, "up": 0, "down": 0, "outdated": 0, "usd": 0.0, "min": 0.0}
    merge_hours = []
    for pr in sorted(prs, key=lambda p: p["number"]):
        n = pr["number"]
        comments = gh_json("api", "--paginate", f"repos/{repo}/pulls/{n}/comments",
                           "--jq", ".[] | {body, line, reactions}")
        ai = [c for c in comments if "ai-review:fp=" in c["body"]]
        up = sum(c["reactions"]["+1"] > 0 for c in ai)
        down = sum(c["reactions"]["-1"] > 0 for c in ai)
        outdated = sum(c["line"] is None for c in ai)     # GitHub clears `line` when outdated
        sticky = gh_json("api", "--paginate", f"repos/{repo}/issues/{n}/comments",
                         "--jq", '.[] | select(.body | contains("ai-review:summary")) | {body}')
        usd = sum(json.loads(r)["usd"] for s in sticky
                  for r in re.findall(r"<!-- ai-cost (.*?) -->", s["body"]))
        runs = gh_json("api", f"repos/{repo}/actions/runs?branch={pr['headRefName']}&per_page=100",
                       "--jq", ".workflow_runs[] | {id}")
        minutes = 0.0
        for run in runs:
            for job in gh_json("api", f"repos/{repo}/actions/runs/{run['id']}/jobs",
                               "--jq", ".jobs[] | {started_at, completed_at, conclusion}"):
                # skipped jobs have no real duration (GitHub may even report end < start)
                if job["conclusion"] != "skipped" and job["started_at"] and job["completed_at"]:
                    seconds = (ts(job["completed_at"]) - ts(job["started_at"])).total_seconds()
                    minutes += max(seconds, 0.0) / 60
        hours = None
        if pr["mergedAt"]:
            hours = (ts(pr["mergedAt"]) - ts(pr["createdAt"])).total_seconds() / 3600
            merge_hours.append(hours)
        for k, v in (("ai", len(ai)), ("up", up), ("down", down), ("outdated", outdated),
                     ("usd", usd), ("min", minutes)):
            tot[k] += v
        rows.append(f"| #{n} | {pr['title'][:40]} | {len(ai)} | {up} | {down} | {outdated} | "
                    f"{usd:.4f} | {minutes:.1f} | {'' if hours is None else f'{hours:.1f}'} |")

    rated = tot["up"] + tot["down"]
    print(f"## AI reviewer, last {args.days} days ({len(prs)} PRs)\n")
    print("| PR | Title | AI comments | 👍 | 👎 | Outdated | US$ | CI min | Hours to merge |")
    print("|---|---|---|---|---|---|---|---|---|")
    print("\n".join(rows))
    print(f"\n- Precision (👍 / rated): **{tot['up'] / rated:.0%}** ({tot['up']}/{rated})"
          if rated else "\n- Precision: no rated comments yet")
    print(f"- Comments per PR: {tot['ai'] / max(len(prs), 1):.1f} · rated: {rated}/{tot['ai']}")
    print(f"- AI cost: US$ {tot['usd']:.2f} total, US$ {tot['usd'] / max(len(prs), 1):.3f} per PR")
    print(f"- CI minutes: {tot['min']:.0f} total, {tot['min'] / max(len(prs), 1):.1f} per PR")
    if merge_hours:
        print(f"- Median time to merge: {statistics.median(merge_hours):.1f} h "
              f"({len(merge_hours)} merged)")


if __name__ == "__main__":
    main()
