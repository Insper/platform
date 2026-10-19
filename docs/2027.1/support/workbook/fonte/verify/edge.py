"""Checks every number of activity 4 (Traffic & Edge) and its answers.

Run from the fonte/ folder:  python3 verify/edge.py
Numbers "from the class" are on docs/2027.1/classes/edge/ (index, dns-cdn,
load-balancing, api-gateway, protocols); the others were created for the workbook.
"""
import hashlib
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 1: round trips
cold = [30, 20, 5, 5, 40, 30]
warm = [0, 0, 5, 5, 40, 30]
print(f"ex1 (a) cold {sum(cold)} ms, warm {sum(warm)} ms; saved {sum(cold) - sum(warm)} ms = {(sum(cold) - sum(warm)) / sum(cold):.0%}")
assert sum(cold) == 130 and sum(warm) == 80
for name, rtts in [("TCP+TLS1.2", 4), ("TCP+TLS1.3", 3), ("QUIC", 2), ("QUIC 0-RTT", 1)]:
    print(f"ex1 (b) {name}: {rtts} RTT -> {rtts * 10} ms at 10 ms, {rtts * 150} ms at 150 ms")

# ---------------------------------------------------------------- ex. 2: DNS
print(f"ex2 (a) 5,000 resolvers / 60 s = {5000 / 60:.0f} queries/s")
fail = 30 * 3 + 60
print(f"ex2 (b) 30 s x 3 + 60 s = {fail} s = {fail / 60} min")
assert fail == 150

# ---------------------------------------------------------------- ex. 3: CDN
for h in (0.90, 0.99, 0.999):
    print(f"ex3 (a) hit {h:.1%}: origin {200_000 * (1 - h):,.0f} req/s")
print(f"ex3 (b) 95% -> 99%: {200_000 * 0.05:,.0f} -> {200_000 * 0.01:,.0f} req/s = {0.05 / 0.01:.0f}x fewer")
poll = 2e6 / 5
print(f"ex3 (c) 2 M / 5 s = {poll:,.0f} req/s at the edge; s-maxage=1, 50 PoPs -> ~50 req/s; shield -> ~1 req/s")
assert poll == 400_000

# ---------------------------------------------------------------- ex. 4: balancing and rings
print(f"ex4 (a) 5,000 / 800 = {5000 / 800:.2f} -> {math.ceil(5000 / 800)} replicas at 100%; run 8-9")
ring = {10: "A", 40: "B", 75: "C"}


def owner(pos, ring):
    for p in sorted(ring):
        if pos <= p:
            return ring[p]
    return ring[min(ring)]


before = {k: owner(k, ring) for k in (30, 50, 90)}
ring2 = dict(ring)
ring2[55] = "D"
after = {k: owner(k, ring2) for k in (30, 50, 90)}
print(f"ex4 (b) before {before}; after D joins {after}")
assert before == {30: "B", 50: "C", 90: "A"} and after == {30: "B", 50: "D", 90: "A"}
keys = [f"hold:{i}" for i in range(40_000)]
h = [int(hashlib.md5(k.encode()).hexdigest(), 16) for k in keys]
moved_mod = sum(1 for x in h if x % 5 != x % 6) / len(h)
print(f"ex4 (c) mod N 5 -> 6: {moved_mod:.1%} moved (theory 5/6 = {5 / 6:.1%}); ring: 1/6 = {1 / 6:.1%}")
print(f"ex4 (c) keys: mod ~{40_000 * 5 / 6:,.0f}; ring ~{40_000 / 6:,.0f}")
print(f"ex4 (e) 5 s x 2 = {5 * 2} s")

# ---------------------------------------------------------------- ex. 5: token bucket (simulation in 1 ms steps)


def bucket(cap, rate, arrivals, t_end, start=None):
    tokens = cap if start is None else start
    accepted = rejected = 0
    t_prev = 0.0
    for t in arrivals:
        tokens = min(cap, tokens + (t - t_prev) * rate)
        t_prev = t
        if tokens >= 1:
            tokens -= 1
            accepted += 1
        else:
            rejected += 1
    return accepted, rejected


a, r = bucket(20, 10, [0.0] * 50, 0)
print(f"ex5 (a) burst of 50: accepted {a}, rejected {r}")
assert (a, r) == (20, 30)
arr = [i / 14 for i in range(14 * 20)]
tokens, t_prev, first_reject = 20.0, 0.0, None
for t in arr:
    tokens = min(20, tokens + (t - t_prev) * 10)
    t_prev = t
    if tokens >= 1:
        tokens -= 1
    elif first_reject is None:
        first_reject = t
print(f"ex5 (b) 14 req/s: first rejection at t = {first_reject:.2f} s (theory 20 / (14 - 10) = {20 / 4:.0f} s); then 10/s accepted")
assert abs(first_reject - 5) < 0.3  # discrete arrivals: about 5 s
print(f"ex5 (c) refill 20 / 10 = {20 / 10:.0f} s")
a, r = bucket(50, 5, [0.0] * 100, 0)
print(f"ex5 (d) cap 50, 5/s, 100 at once: accepted {a}, rejected {r}; refill {50 / 5:.0f} s; long run <= 5 req/s")
assert (a, r) == (50, 50)

# ---------------------------------------------------------------- ex. 6: windows and replicas
print("ex6 (a) 100 at 10:00:59 + 100 at 10:01:00 = 200 in ~2 s")
est = 30 + 80 * (1 - 15 / 60)
print(f"ex6 (b) estimate = 30 + 80 x (1 - 15/60) = {est:.0f} -> allowed (< 100)")
assert est == 90
print(f"ex6 (c) 6 replicas x 10 req/s = {6 * 10} req/s")
bot = 50_000 * 100
print(f"ex6 (d) 50,000 x 100/min = {bot:,} req/min = {bot / 60:,.0f} req/s")

# ---------------------------------------------------------------- ex. 7: the edge for 10:00
print(f"ex7 (a) 2 M fans x 1 req / 2 s = {2e6 / 2:,.0f} req/s")
print(f"ex7 (b) waiting room 2,000 per minute = {2000 / 60:.0f} fans/s")
print("edge OK")
