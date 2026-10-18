"""Checks every number of activity 15 (Performance Engineering) and its answers.

Run from the fonte/ folder:  python3 verify/performance.py
Numbers "from the class" are on docs/2027.1/classes/performance/ (index, methodology,
load-testing, bottlenecks, capacity-planning); the CI budget case of exercise 7 was
created for the workbook.
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


def pct(values, p):
    """Percentile with linear interpolation (numpy's default)."""
    v = sorted(values)
    k = (len(v) - 1) * p / 100
    f = math.floor(k)
    c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)


# ---------------------------------------------------------------- ex. 1: the laws
print(f"ex1 (a) Little: 1,800 x 0.12 = {1800 * 0.12:.0f} in flight")
print(f"ex1 (b) utilization: 0.4 ms x 2,000/s = {0.0004 * 2000:.0%}")
print(f"ex1 (c) mean of 99% at 20 ms + 1% at 10 s = {0.99 * 20 + 0.01 * 10_000:.1f} ms")
print(f"ex1 (d) 2,000 holds/s x 0.15 s = {2000 * 0.15:.0f}")
close(1800 * 0.12, 216); close(0.99 * 20 + 0.01 * 10_000, 119.8)

# ---------------------------------------------------------------- ex. 3: open vs closed
N, Z = 200, 1.0
X = {R: N / (R + Z) for R in (0.1, 0.5, 2.0)}
for R, x in X.items():
    print(f"ex3 (a) R = {R} s: closed X = {x:.0f} req/s")
print(f"ex3 (b) closed reduced the load by {(X[0.1] - X[2.0]) / X[0.1]:.0%}")
print(f"ex3 (d) VUs = 1,000 iterations/s x 3.5 s = {1000 * 3.5:.0f}")

# ---------------------------------------------------------------- ex. 4: coordinated omission
RATE, DURATION, SERVICE = 100, 60.0, 0.001
STALLS = [(10.0, 1.5), (25.0, 1.5), (40.0, 1.5), (55.0, 1.5)]


def serve(arrival, free_at):
    start = max(arrival, free_at)
    for s, d in STALLS:
        if s <= start < s + d:
            start = s + d
    return start + SERVICE


closed, t, slot, free = [], 0.0, 0.0, 0.0
while slot < DURATION:
    send = max(t, slot)
    done = serve(send, free)
    free = done
    closed.append(done - send)
    t, slot = done, slot + 1 / RATE
    if slot < t:
        slot = t
opened, free = [], 0.0
for i in range(int(DURATION * RATE)):
    a = i / RATE
    done = serve(a, free)
    free = done
    opened.append(done - a)
for name, lat in (("closed", closed), ("open", opened)):
    ms = [x * 1000 for x in lat]
    print(f"ex4 {name}: {len(ms):,} samples; p50 {pct(ms, 50):.1f}, p90 {pct(ms, 90):.1f}, "
          f"p99 {pct(ms, 99):.1f}, max {max(ms):.0f} ms; slow (> 10 ms) {sum(m > 10 for m in ms)}")
print(f"ex4 (a) intended samples {DURATION * RATE:.0f}; requests not sent per freeze ~ {1.5 * RATE:.0f}; "
      f"in 4 freezes ~ {4 * 1.5 * RATE:.0f}")
print(f"ex4 (b) open: slow share ~ {4 * 150 / 6000:.0%}; top 1% = {6000 * 0.01:.0f} samples = top {6000 * 0.01 / 4:.0f} per freeze,"
      f" waiting >= {1500 - (6000 * 0.01 / 4 - 1) * 10:.0f} ms")
print(f"ex4 (b) closed: slow share = 4 / {len(closed):,} = {4 / len(closed):.2%}")

# ---------------------------------------------------------------- ex. 5: breakpoint and USE
print(f"ex5 (c) knee per pod = 1,100 / 4 = {1100 / 4:.0f}")
print(f"ex5 (e) pool wait (Little) = 180 / 1,500 = {180 / 1500 * 1000:.0f} ms")
print(f"ex5 (f) connections: inside the tx 1,500 x 0.046 = {1500 * 0.046:.0f}; before 1,500 x 0.006 = {1500 * 0.006:.0f}")

# ---------------------------------------------------------------- ex. 6: capacity plan (capacity-planning)
def pods(demand, knee, headroom=0.25, zones=3):
    base = math.ceil(demand / (knee * (1 - headroom)))
    zone = math.ceil(base * zones / (zones - 1))
    return base, zone, math.ceil(zone / zones) * zones


for name, demand, knee in [("inventory", 4500, 275), ("inventory, waiting room", 3000, 275),
                           ("order", 3000, 150), ("order, waiting room", 2000, 150)]:
    b, z, r = pods(demand, knee)
    print(f"ex6 {name}: {demand}/({knee} x 0.75) = {demand / (knee * 0.75):.2f} -> {b}; x 3/2 -> {z}; multiple of 3 -> {r}")
b, z, r = pods(4500, 275)
assert (b, z, r) == (22, 33, 33)
assert pods(3000, 275)[2] == 24 and pods(3000, 150)[2] == 42 and pods(2000, 150)[2] == 27
print(f"ex6 (c) client connections: 33 pods x 10 = {33 * 10}; active = 4,500 x 0.006 = {4500 * 0.006:.0f}")
print(f"ex6 (d) backlog = (4,500 - 1,100) x 120 = {(4500 - 1100) * 120:,}")
close((4500 - 1100) * 120, 408_000)

# ---------------------------------------------------------------- ex. 7: performance budget in CI
base_p95, new_p95 = 120, 141
print(f"ex7 (c) regression = {(new_p95 - base_p95) / base_p95:.1%} (limit 15%) -> fail = {(new_p95 - base_p95) / base_p95 > 0.15}")
print(f"ex7 (c) largest p95 that passes = {base_p95 * 1.15:.0f} ms")
print(f"ex7 (b) test target = expected peak x 1.5 = 30,000 x 1.5 = {30_000 * 1.5:,.0f} req/s")
print("performance OK")
