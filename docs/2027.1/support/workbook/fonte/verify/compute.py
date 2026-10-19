"""Checks every number of activity 5 (Compute & Services) and its answers.

Run from the fonte/ folder:  python3 verify/compute.py
Numbers "from the class" are on docs/2027.1/classes/compute/ (index, services, async-work,
serverless-autoscaling, integrations); the others were created for the workbook.
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 2: replicas
cap = 10 / 0.020
print(f"ex2 (a) 10 vCPU / 0.020 s = {cap:.0f} req/s per replica")
at100 = 4000 / cap
at65 = 4000 / (cap * 0.65)
print(f"ex2 (b) 100%: {at100:.0f}; 65%: {at65:.2f} -> {math.ceil(at65)}; +1 spare = {math.ceil(at65) + 1}")
assert math.ceil(at65) + 1 == 14
print(f"ex2 (c) 500 connections / 20 per pool = {500 // 20} replicas max; 100 x 20 = {100 * 20} connections")
q2 = math.ceil(6000 / (500 * 0.6)) + 1
print(f"ex2 (d) ceil(6,000 / (500 x 0.6)) + 1 = {q2}")
assert q2 == 21

# ---------------------------------------------------------------- ex. 3: workers and backlog
lam_peak, lam_off, S, T = 100, 10, 0.8, 600
print(f"ex3 (a) workers = {lam_peak} x {S} = {lam_peak * S:.0f}")
for w in (40, 60):
    mu = w / S
    backlog = max(0, lam_peak - mu) * T
    last_wait = backlog / mu
    drain = backlog / (mu - lam_off)
    print(f"ex3 {w} workers: mu {mu:.0f}/s; backlog {backlog:,.0f}; last fan waits {last_wait:.0f} s = {last_wait / 60:.1f} min; "
          f"drain {drain:.0f} s = {drain / 60:.1f} min; SLO 5 min {'met' if last_wait <= 300 else 'missed'}")
assert (40 / S) == 50 and (lam_peak - 50) * T == 30_000
close(30_000 / 50, 600); close(30_000 / 40, 750)
close(15_000 / 75, 200); assert round(15_000 / 65) == 231

# ---------------------------------------------------------------- ex. 4: serverless and HPA
for rps in (2000, 1500):
    print(f"ex4 (a) {rps} x 0.2 s = {rps * 0.2:.0f} environments")
cost = 0.20 + 0.5 * 0.1 * 0.0000166667 * 1e6
print(f"ex4 (b) per million = 0.20 + 0.5 GB x 0.1 s x 0.0000166667 x 1e6 = US$ {cost:.3f}")
close(round(cost, 2), 1.03)
hpa = math.ceil(6 * 90 / 60)
print(f"ex4 (c) ceil(6 x 90/60) = {hpa}")
assert hpa == 9
pre = 20_000 / (500 * 0.6)
print(f"ex4 (d) 20,000 / (500 x 0.6) = {pre:.1f} -> {math.ceil(pre)} replicas at 09:45; before: 1,000/(500x0.6) = {1000 / 300:.1f}")
assert math.ceil(pre) == 67

# ---------------------------------------------------------------- ex. 5: schedulers
print("ex5 (a) 10 replicas -> 10 e-mails per fan")
print("ex5 (b) token 33 < 34 -> write rejected")

# ---------------------------------------------------------------- ex. 7: availability of a chain
chain = 0.999 ** 3
print(f"ex7 (b) 0.999^3 = {chain:.4%}")
close(round(chain, 3), 0.997)
print("compute OK")
