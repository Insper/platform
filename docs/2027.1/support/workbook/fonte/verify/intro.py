"""Checks every number of activity 1 (What is System Design) and its answers.

Run from the fonte/ folder:  python3 verify/intro.py
Numbers "from the class" are on docs/2027.1/classes/intro/ (index, requirements,
scaling-journey, interview-framework); the others were created for the workbook.
"""


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 2: downtime allowed
MIN28 = 28 * 24 * 60
for slo in (0.9995, 0.999):
    print(f"ex2 (d) {slo:.2%} per 28 days -> {(1 - slo) * MIN28:.1f} min down")
close((1 - 0.9995) * MIN28, 20.16)
close((1 - 0.999) * MIN28, 40.32)

# ---------------------------------------------------------------- ex. 3: numbers that decide
print(f"ex3 (a) 200 x 0.5 ms = {200 * 0.5:.0f} ms")
for h in (0.90, 0.95, 0.99):
    print(f"ex3 (b) hit {h:.0%} -> DB gets {1 - h:.0%} of the reads = {1 / (1 - h):.0f}x fewer")
close(1 / (1 - 0.95), 20)
print(f"ex3 (c) 1,000 reads/s x 5% = {1000 * 0.05:.0f} reads/s at the DB")
gbs = 1000 * 1e6 / 1e9
print(f"ex3 (d) 1,000 x 1 MB = {gbs} GB/s = {gbs * 8} Gbit/s")

# ---------------------------------------------------------------- ex. 5: estimates
reads_day = 2e6 * 20
avg = reads_day / 1e5
print(f"ex5 (a) reads/day {reads_day:.0e}; avg {avg:.0f}/s (exact {reads_day / 86_400:.0f}/s); peak x3 {3 * avg:.0f}/s")
assert avg == 400 and 3 * avg == 1200
print(f"ex5 (b) 100,000 orders/day / 1e5 = {1e5 / 1e5:.0f}/s (exact {1e5 / 86_400:.2f}/s)")
mb_day = 1e5 * 1e3 / 1e6
print(f"ex5 (c) {mb_day:.0f} MB/day; {mb_day * 365 / 1e3:.1f} GB/year (~40 GB)")
print(f"ex5 (c) seat rows <= 100,000 x 100 B = {1e5 * 100 / 1e6:.0f} MB per event")
print(f"ex5 (d) 2 M / 60 s = {2e6 / 60:,.0f} fans/s")

# ---------------------------------------------------------------- ex. 6: one seat, two fans
cap = 8 / 0.005
print(f"ex6 (d) 8 / 0.005 s = {cap:.0f} holds/s at 100%; at 70% {0.7 * cap:.0f}/s")
fans = 60_000 / 2
print(f"ex6 (d) 60,000 seats / 2 per fan = {fans:,.0f} fans -> {fans / 1000:.0f} s at 1,000/s")
close(cap, 1600)

# ---------------------------------------------------------------- ex. 7: trade-off numbers quoted in the answer
print("ex7 cache: catalog p99 80 ms -> 5 ms, price up to 60 s stale (class index)")
print("intro OK")
