"""Checks every number of activity 13 (AI Systems & Agents) and its answers.

Run from the fonte/ folder:  python3 verify/ai-systems.py
Numbers "from the class" are on docs/2027.1/classes/ai-systems/ (index #numbers,
llm-gateway, agents, rag-memory, safety-evals, quiz); the cost function below is the
one of the class page (index.md, "The numbers").
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 2 latency
for ttft, tpot, n in [(0.6, 0.020, 250), (0.6, 0.020, 1000), (0.5, 0.025, 400)]:
    print(f"ex2 TTFT {ttft} s, TPOT {tpot * 1000:.0f} ms, {n} tokens -> {ttft + tpot * (n - 1):.2f} s; {1 / tpot:.0f} tok/s")

# ---------------------------------------------------------------- ex. 3 cost (class model)
PRICE_IN, PRICE_OUT, CACHED = 3.00, 15.00, 0.10
SYSTEM, USER, STEP_OUT, TOOL_OUT, FINAL_OUT = 3_000, 60, 80, 700, 250


def request(steps, hit):
    context, new = SYSTEM + USER, USER
    tokens = cost = 0.0
    contexts = []
    for i in range(steps):
        last = i == steps - 1
        out = FINAL_OUT if last else STEP_OUT
        cacheable = context - new
        uncached = new + cacheable * (1 - hit)
        tokens += context
        contexts.append(context)
        cost += (uncached + cacheable * hit * CACHED) * PRICE_IN / 1e6 + out * PRICE_OUT / 1e6
        if not last:
            new = out + TOOL_OUT
            context += new
    return int(tokens), cost, contexts


for steps in (1, 2, 4):
    tok, c0, ctx = request(steps, 0.0)
    _, c9, _ = request(steps, 0.9)
    print(f"ex3 {steps} calls: contexts {ctx}, input {tok:,}, US$/1k: no cache {c0 * 1000:.2f}, 90% cache {c9 * 1000:.2f}")
close(request(1, 0)[1] * 1000, 12.93); close(request(2, 0)[1] * 1000, 25.65)
assert request(4, 0)[0] == 16_920
close(round(request(4, 0.9)[1] * 1000, 2), 22.83)
print(f"ex3 (c) 4 calls / 1 call at 90% = {22.83 / 5.64:.1f}x")
rps = 0.01 * 2e6 / 600
print(f"ex3 (d) {rps:.1f} req/s; input {rps * 17_000:,.0f} tok/s = {rps * 17_000 * 60 / 1e6:.0f} M/min; "
      f"output {rps * 500:,.0f} tok/s; cost {20 * 22.83:.0f} USD")

# ---------------------------------------------------------------- ex. 4 p^n
for p, n in [(0.95, 10), (0.99, 20), (0.90, 5)]:
    print(f"ex4 (a) {p}^{n} = {p ** n:.0%}")

# ---------------------------------------------------------------- ex. 5 RAG sizes (rag-memory page)
def index_gb(n, d):
    return (n * d * 4 + n * 2 * 16 * 8) / 1e9
for n in (60_000, 10_000_000):
    print(f"ex5 {n:,} chunks x 1024 f32: raw {n * 1024 * 4 / 1e9:.2f} GB, HNSW {n * 256 / 1e9:.2f} GB, total {index_gb(n, 1024):.2f} GB")
close(index_gb(10_000_000, 1024), 43.52, 1e-3)
r1 = 1 / 61 + 1 / 63
r2 = 1 / 61
print(f"ex5 (c) RRF {r1:.4f} vs {r2:.4f}")
print(f"ex5 (d) 5 x 400 = {5 * 400} tokens")

# ---------------------------------------------------------------- ex. 6 KV cache (llm-gateway page)
kv = 2 * 32 * 8 * 128 * 2
print(f"ex6 (a) {kv} B = {kv / 1024:.0f} KiB/token; 8k conv = {8000 * kv / 2 ** 30:.2f} GiB; "
      f"64 GB / 1 GiB ~ {64e9 / (8000 * kv):.0f}; 1k conv ~ {64e9 / (1000 * kv):.0f}")
print(f"ex6 (b) 33 x 12 = {33 * 12} open connections")
print(f"ex6 (c) cost ratio 10% vs 100% = {(1 / 0.1) / (1 / 1.0):.0f}x")

# ---------------------------------------------------------------- ex. 7 pass@k, pass^k (safety-evals page)
p = 0.9
print(f"ex7 (b) pass@4 = {1 - (1 - p) ** 4:.2%}; pass^4 = {p ** 4:.1%}")
close(p ** 4, 0.6561)
print("ai-systems OK")
