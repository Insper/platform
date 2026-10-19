"""Checks every number of activity 10 (Observability) and its answers.

Run from the fonte/ folder:  python3 verify/observability.py
Numbers "from the class" are on docs/2027.1/classes/observability/ (index, signals,
opentelemetry, alerting, incident-response); the others were created for the workbook.
"""
import math
import random


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 2: cardinality (signals page)
rows = [("histogram", 17), ("method", 4), ("route", 25), ("status", 6), ("pod", 20), ("customer_id", 1_000_000)]
series = 1
for name, values in rows:
    series *= values
    mem = series * 4096
    if mem < 2 ** 20:
        txt = f"{mem / 2 ** 10:.1f} KiB"
    elif mem < 2 ** 30:
        txt = f"{mem / 2 ** 20:.1f} MiB"
    else:
        txt = f"{mem / 2 ** 40:.1f} TiB"
    print(f"ex2 {name:12s} x{values:>9,}: {series:>16,} series, {txt}")
assert 17 * 4 * 25 * 6 * 20 == 204_000
close(204_000 * 4096 / 2 ** 20, 796.875)
close(204_000 * 1_000_000 * 4096 / 2 ** 40, 760.0, 1e-3)

# ---------------------------------------------------------------- ex. 3: averaging p99s
print(f"ex3 (a) average of p99s = {(180 * 3 + 1260) / 4:.0f} ms")
print(f"ex3 (b) slowest 1% = {100_000 // 100} requests; pod d has 10,000 -> its slowest 10% -> fleet p99 ~ pod d p90 = 760 ms")
# simulation with the class's own parameters (signals page): lognormal, seed 7
rng = random.Random(7)
lat = [rng.lognormvariate(math.log(80), 0.35) for _ in range(90_000)]
lat += [rng.lognormvariate(math.log(400), 0.5) for _ in range(10_000)]
lat.sort()
print(f"ex3 simulated fleet p99 = {lat[int(0.99 * len(lat)) - 1]:.0f} ms (class page: 756 ms)")
print(f"ex3 pod d p90 (lognormal 400 ms, sigma 0.5) = {400 * math.exp(1.2816 * 0.5):.0f} ms")
print("ex3 (c) 0.3 s -> buckets le=0.5, 1, 2.5, +Inf; no le=2 bucket")

# ---------------------------------------------------------------- ex. 4: telemetry cost
traces = 500 * 8 * 500
logs = 500 * 5 * 300
print(f"ex4 (a) traces {traces / 1e6} MB/s = {traces * 86_400 / 1e9:.1f} GB/day; 30 days = {traces * 86_400 * 30 / 1e12:.2f} TB")
print(f"ex4 (a) logs {logs / 1e6} MB/s = {logs * 86_400 / 1e9:.1f} GB/day")
day = 2000 * 8 * 500 * 86_400 / 1e9
errors_day = 2000 * 0.01 * 86_400
tail = 0.01 + 0.02 + 0.05 * 0.97
for name, frac, err in [("all", 1, 1), ("head 10%", 0.10, 0.10), ("head 1%", 0.01, 0.01), ("tail", tail, 1)]:
    print(f"ex4 (b) {name}: {frac:.2%} kept, {day * frac:.1f} GB/day, error traces {errors_day * err:,.0f}/day")
close(day, 691.2); close(tail, 0.0785); close(day * tail, 54.2592)

# ---------------------------------------------------------------- ex. 5: burn rates (alerting page, 28 days)
WINDOW_H = 672
print(f"ex5 (a) budget = {0.001 * WINDOW_H * 60:.1f} min")
for e, hours in [(0.0144, 1), (0.006, 6)]:
    b = e / 0.001
    print(f"ex5 (b) error {e:.2%}: burn {b:.1f}; spent in {hours} h = {b * hours / WINDOW_H:.1%}; "
          f"gone in {WINDOW_H / b:.0f} h = {WINDOW_H / b / 24:.1f} days")
for e in (1.0, 0.02):
    print(f"ex5 (c) e={e:.0%}: fast rule fires after {60 * 0.0144 / e:.2f} min")
print(f"ex5 (c) e=0.7%: fast never (0.7% < 1.44%); 6 h rule after {360 * 0.006 / 0.007:.0f} min = {360 * 0.006 / 0.007 / 60:.1f} h")
print(f"ex5 (d) e=4%: burn {0.04 / 0.001:.0f}; fast rule after {60 * 0.0144 / 0.04:.1f} min -> ~10:25")

# ---------------------------------------------------------------- ex. 6: waterfall
print(f"ex6 (a) pool wait share = {7.90 / 9.12:.0%}")
print(f"ex6 (b) pool of 20 / 1.02 s = {20 / 1.02:.1f} charges/s")

# ---------------------------------------------------------------- ex. 7: incident (incident-response page)
print("ex7 (a) MTTD 1 min (10:03-10:02), MTTA 1 min (10:04-10:03), MTTM 12 min (10:14-10:02), MTTR 38 min (10:40-10:02)")
failed = 200 * 720 * 0.12
allowed = 2_000_000 * 0.001
print(f"ex7 (b) failed = {failed:,.0f}; allowed = {allowed:,.0f}; = {failed / allowed:.1f} windows of budget")
close(failed, 17_280); close(failed / allowed, 8.64)
print("observability OK")
