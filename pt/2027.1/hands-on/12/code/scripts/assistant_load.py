# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx>=0.28"]
# ///
"""Load test of the assistant's STREAMING endpoint: time to first token (TTFT), total time, tokens/s.

k6 measures the time to the first *byte*, and a streaming server sends its headers before the first
token, so k6's numbers are not TTFT. This script reads the Server-Sent Events and stops the TTFT
clock at the first "token" event.

    uv run scripts/assistant_load.py --concurrency 1 2 4 --requests 8
"""
import argparse
import asyncio
import json
import statistics
import time

import httpx

QUESTIONS = [
    "Is there a festival at Stadium São Paulo? When, and how much are the tickets?",
    "Which plays are there in Curitiba?",
    "I want to see a match in Recife. What do you have?",
    "How much is the cheapest concert in Salvador?",
    "Tem algum festival em Porto Alegre?",
]


async def one(http: httpx.AsyncClient, url: str, question: str) -> dict:
    start = time.monotonic()
    ttft, done, event = None, None, None
    async with http.stream("POST", f"{url}/assistant/chat/stream", json={"message": question}) as r:
        r.raise_for_status()
        async for line in r.aiter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                if event == "token" and ttft is None:
                    ttft = time.monotonic() - start
                elif event == "done":
                    done = json.loads(line[6:])
    total = time.monotonic() - start
    out_tokens = done["usage"]["completion_tokens"] if done else 0
    stream_time = total - (ttft or total)
    return {"ttft": ttft, "total": total, "tokens": out_tokens,
            "tps": out_tokens / stream_time if stream_time > 0 else 0.0,
            "cost": done["usage"]["cost_usd"] if done else 0.0}


def pct(values: list[float], p: float) -> float:
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))] if values else float("nan")


async def run(url: str, concurrency: int, requests: int) -> None:
    queue = asyncio.Queue()
    for i in range(requests):
        queue.put_nowait(QUESTIONS[i % len(QUESTIONS)])
    results, errors = [], 0

    async def worker(http):
        nonlocal errors
        while not queue.empty():
            q = queue.get_nowait()
            try:
                results.append(await one(http, url, q))
            except (httpx.HTTPError, KeyError, json.JSONDecodeError):
                errors += 1

    started = time.monotonic()
    async with httpx.AsyncClient(timeout=600) as http:
        await asyncio.gather(*(worker(http) for _ in range(concurrency)))
    wall = time.monotonic() - started
    ttfts = [r["ttft"] for r in results if r["ttft"] is not None]
    totals = [r["total"] for r in results]
    print(f"| {concurrency:>11} | {len(results):>8} | {errors:>6} | {pct(ttfts, 50):8.2f} | {pct(ttfts, 95):8.2f} "
          f"| {pct(totals, 50):9.2f} | {pct(totals, 95):9.2f} | {statistics.fmean(r['tps'] for r in results) if results else 0:9.1f} "
          f"| {60 * len(results) / wall:7.2f} | {sum(r['cost'] for r in results) / max(1, len(results)):10.6f} |")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8088")
    ap.add_argument("--concurrency", type=int, nargs="+", default=[1, 2, 4])
    ap.add_argument("--requests", type=int, default=8, help="requests per concurrency level")
    args = ap.parse_args()
    print("| concurrency | requests | errors | TTFT p50 | TTFT p95 | total p50 | total p95 | tokens/s | req/min | USD/request |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for c in args.concurrency:
        await run(args.url, c, args.requests)


if __name__ == "__main__":
    asyncio.run(main())
