"""Rule-based canary verdict, explained by an LLM. The LLM never decides.

    python .github/ai/canary_explain.py                       # query Prometheus
    python .github/ai/canary_explain.py --metrics sample.json  # replay saved numbers

Exit code: 0 = promote, 1 = rollback, 2 = inconclusive (not enough traffic yet).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True                # no __pycache__/ inside the repository
sys.path.insert(0, str(Path(__file__).parent))
from llm import LLMError, complete_json, step_summary  # noqa: E402

PROM = os.environ.get("PROM_URL", "http://localhost:9090")
METRIC = os.environ.get("METRIC", "http_server_requests_seconds")      # Micrometer naming
STATUS = os.environ.get("STATUS_LABEL", "status")                      # OTel: http_response_status_code
CANARY = os.environ.get("CANARY_SELECTOR", 'service="catalog-canary"')
STABLE = os.environ.get("STABLE_SELECTOR", 'service="catalog-stable"')
WINDOW = os.environ.get("WINDOW", "5m")

# The policy, written down and versioned. Change it with a pull request, not a prompt.
MIN_RPS = 2.0              # below this the canary has not seen enough traffic
MAX_ERROR_RATE = 0.01      # absolute ceiling: 1 % of requests fail
MAX_ERROR_DELTA = 0.005    # canary may not be worse than stable by more than 0.5 pp
MAX_P99_RATIO = 1.25       # canary p99 at most 25 % above stable p99

QUERIES = {
    "rps": f"sum(rate({METRIC}_count{{{{sel}}}}[{WINDOW}]))",
    "errors": f'sum(rate({METRIC}_count{{{{sel}},{STATUS}=~"5.."}}[{WINDOW}]))',
    "p99": f"histogram_quantile(0.99, sum by (le) (rate({METRIC}_bucket{{{{sel}}}}[{WINDOW}])))",
}

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["promote", "rollback", "inconclusive"]},
        "headline": {"type": "string"},
        "explanation": {"type": "string"},
        "next_steps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "headline", "explanation", "next_steps"],
    "additionalProperties": False,
}
SYSTEM = """\
You explain canary analyses of BoxOffice services to the on-call engineer. You receive the
metrics of the canary and of the stable version, the policy thresholds, and the verdict
that the policy already computed. Repeat that verdict exactly in `verdict`, then explain in
plain language, with the numbers, why the policy reached it, what the most likely causes
are, and 2-4 concrete next steps (what to look at in traces/logs, whether to roll back).
Do not change the verdict, and do not invent metrics you were not given.
"""


def query(promql: str) -> float:
    url = f"{PROM}/api/v1/query?" + urllib.parse.urlencode({"query": promql})
    with urllib.request.urlopen(url, timeout=10) as r:
        result = json.load(r)["data"]["result"]
    return float(result[0]["value"][1]) if result else 0.0


def collect() -> dict:
    out = {}
    for name, sel in (("canary", CANARY), ("stable", STABLE)):
        values = {k: query(q.replace("{sel}", sel)) for k, q in QUERIES.items()}
        values["error_rate"] = values["errors"] / values["rps"] if values["rps"] else 0.0
        out[name] = values
    return out


def decide(m: dict) -> tuple[str, list[str]]:
    c, s = m["canary"], m["stable"]
    if c["rps"] < MIN_RPS:
        return "inconclusive", [f"canary traffic {c['rps']:.2f} req/s < {MIN_RPS}"]
    reasons = []
    if c["error_rate"] > MAX_ERROR_RATE:
        reasons.append(f"canary error rate {c['error_rate']:.2%} > {MAX_ERROR_RATE:.2%}")
    if c["error_rate"] - s["error_rate"] > MAX_ERROR_DELTA:
        reasons.append(f"canary errors exceed stable by {c['error_rate'] - s['error_rate']:.2%}")
    if s["p99"] > 0 and c["p99"] / s["p99"] > MAX_P99_RATIO:
        reasons.append(f"canary p99 {c['p99'] * 1000:.0f} ms is {c['p99'] / s['p99']:.2f}x stable")
    return ("rollback", reasons) if reasons else ("promote", ["all checks within policy"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--metrics", help="JSON file with saved metrics instead of Prometheus")
    args = ap.parse_args()
    metrics = json.loads(Path(args.metrics).read_text()) if args.metrics else collect()
    verdict, reasons = decide(metrics)

    policy = dict(MIN_RPS=MIN_RPS, MAX_ERROR_RATE=MAX_ERROR_RATE,
                  MAX_ERROR_DELTA=MAX_ERROR_DELTA, MAX_P99_RATIO=MAX_P99_RATIO)
    text = f"**Verdict (policy): {verdict.upper()}** — " + "; ".join(reasons)
    try:
        expl, usage = complete_json(SYSTEM, json.dumps(
            {"metrics": metrics, "policy": policy, "verdict": verdict, "reasons": reasons},
            indent=1), SCHEMA, effort="low")
        if expl["verdict"] != verdict:          # the explanation contradicts the policy: discard it
            text += "\n\n_(LLM explanation discarded: it disagreed with the policy verdict.)_"
        else:
            text += f"\n\n**{expl['headline']}**\n\n{expl['explanation']}\n\n" + \
                    "\n".join(f"- {s}" for s in expl["next_steps"]) + "\n\n" + usage.markdown()
    except LLMError as err:                     # no explanation is fine; no verdict is not
        text += f"\n\n_(no explanation: {err})_"

    rows = "\n".join(f"| {k} | {metrics['stable'][k]:.4f} | {metrics['canary'][k]:.4f} |"
                     for k in ("rps", "error_rate", "p99"))
    step_summary(f"### Canary analysis\n\n| Metric | Stable | Canary |\n|---|---|---|\n{rows}\n\n{text}")
    print(text)
    return {"promote": 0, "rollback": 1, "inconclusive": 2}[verdict]


if __name__ == "__main__":
    sys.exit(main())
