"""Checks every number of activity 7 (Caching) and its answers.

Run from the fonte/ folder:  python3 verify/caching.py
Numbers "from the class" are on docs/2027.1/classes/caching/ (index, patterns,
invalidation, failure-modes, redis); the others were created for the workbook.
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 1: Zipf share (index.md think-first)
share = math.log(1000) / math.log(100_000)
exact = sum(1 / i for i in range(1, 1001)) / sum(1 / i for i in range(1, 100_001))
print(f"ex1 (a) ln k / ln N = {share:.2f}; exact harmonic ratio = {exact:.2f}")
close(share, 0.6)

# ---------------------------------------------------------------- ex. 2: hit-ratio table (index.md worked example)
qps, hit, miss = 50_000, 0.5, 8.5
for h in (0.9, 0.99, 0.999):
    t = h * hit + (1 - h) * miss
    print(f"ex2 h={h:.1%}: t_eff = {t:.3f} ms; DB QPS = {(1 - h) * qps:,.0f}")
close(0.9 * hit + 0.1 * miss, 1.3); close(0.99 * hit + 0.01 * miss, 0.58)
print(f"ex2 (b) 40,000 reads/s: 95% -> {0.05 * 40_000:,.0f}; 99% -> {0.01 * 40_000:,.0f} ({0.05 / 0.01:.0f}x less)")

# ---------------------------------------------------------------- ex. 3: sizing (index.md, redis.md)
events_mb = 20_000 * (4_000 + 100) / 1e6
search_mb = 200_000 * 2_000 / 1e6
sessions_mb = 2e6 * 500 / 1e6
total_gb = (events_mb + search_mb + sessions_mb) / 1000
print(f"ex3 events {events_mb:.0f} MB; search {search_mb:.0f} MB; sessions {sessions_mb:.0f} MB; total {total_gb:.2f} GB")
print(f"ex3 with replica {2 * total_gb:.1f} GB; +50% headroom {3 * total_gb:.1f} GB")
print(f"ex3 (c) primaries = {300_000 / 100_000:.0f}")

# ---------------------------------------------------------------- ex. 4: TTL bound (index.md)
r, T = 1000, 60
h = 1 - 1 / (r * T + 1)
print(f"ex4 (a) h <= {h:.6f}: 1 miss in {r * T + 1:,} reads")

# ---------------------------------------------------------------- ex. 5: stampede, avalanche, Bloom (failure-modes.md)
print(f"ex5 (a) stampede = {20_000 * 0.2:,.0f} queries; with coalescing on 20 replicas = 20")
bits = -math.log(0.01) / math.log(2) ** 2
print(f"ex5 (c) Bloom {bits:.2f} bits/element; 100,000 -> {bits * 100_000 / 8 / 1000:.0f} KB")

# ---------------------------------------------------------------- ex. 6: hot key (failure-modes.md)
reads = 2e6 / 5
gbps = reads * 4_000 * 8 / 1e9
print(f"ex6 (a) {reads:,.0f} reads/s; {reads * 4_000 / 1e9:.1f} GB/s = {gbps:.1f} Gbit/s")
print(f"ex6 (c) L1: 50 replicas x 1 read/s = 50 reads/s; 8 copies -> {reads / 8:,.0f} reads/s each")
print("caching OK")
