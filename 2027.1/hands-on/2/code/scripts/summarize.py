# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Turn k6 --summary-export files into one Markdown table (one row per file).

    uv run scripts/summarize.py results/lab2/rate-*.json

The block above is inline script metadata (PEP 723): uv reads it and runs the
script with a suitable Python, no virtual environment to manage.
"""
import json
import re
import sys


def ms(metric, stat):
    value = metric.get(stat) if metric else None
    return f"{value:.1f}" if isinstance(value, (int, float)) else "–"


def row(path):
    m = json.load(open(path))["metrics"]
    offered = re.search(r"rate-(\d+)", path)
    dur = m.get("http_req_duration", {})
    failed = m.get("http_req_failed", {}).get("value", 0)
    dropped = m.get("dropped_iterations", {}).get("count", 0)
    return [
        offered.group(1) if offered else path,
        f"{m['http_reqs']['rate']:.0f}",
        ms(dur, "med"), ms(dur, "p(95)"), ms(dur, "p(99)"),
        ms(m.get("http_req_duration{name:detail}"), "p(99)"),
        ms(m.get("http_req_duration{name:list}"), "p(99)"),
        f"{failed * 100:.1f}%",
        str(dropped),
        str(m.get("vus_max", {}).get("value", "–")),
    ]


def sort_key(path):
    n = re.search(r"rate-(\d+)", path)
    return int(n.group(1)) if n else 0


header = ["offered (req/s)", "throughput (req/s)", "p50 (ms)", "p95 (ms)", "p99 (ms)",
          "p99 detail", "p99 list", "errors", "dropped", "max VUs"]
print("| " + " | ".join(header) + " |")
print("|" + "|".join("---:" for _ in header) + "|")
for path in sorted(sys.argv[1:], key=sort_key):
    print("| " + " | ".join(row(path)) + " |")
