"""Checks every number of activity 12 (Cloud-Native Platforms) and its answers.

Run from the fonte/ folder:  python3 verify/cloud-native.py
Numbers "from the class" are on docs/2027.1/classes/cloud-native/ (index, containers,
kubernetes, delivery, finops, quiz); the others were created for the workbook.
"""
import math
from statistics import NormalDist


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 1
print(f"ex1 (b) heap = 0.75 x 1 GiB = {0.75 * 1024:.0f} MiB")
print(f"ex1 (c) 20 x 800 MB = {20 * 0.8:.0f} GB; 20 x 250 MB = {20 * 0.25:.0f} GB")

# ---------------------------------------------------------------- ex. 2 (kubernetes page)
print(f"ex2 (a) startup {5 * 12} s; readiness {5 * 3} s; liveness {10 * 3} s")
print(f"ex2 (b) maxSurge 25% of 4 = {math.ceil(0.25 * 4)} -> at most {4 + math.ceil(0.25 * 4)} pods, 4 ready")
print(f"ex2 (d) class: the 100 ms quota is used in the first 25 ms of each period, then a stall of {100 - 25} ms")

# ---------------------------------------------------------------- ex. 3 HPA
hpa = lambda cur, m, t: math.ceil(cur * m / t)
print(f"ex3 (a) {hpa(4, 90, 60)} and {hpa(5, 96, 60)}")
assert hpa(4, 90, 60) == 6 and hpa(5, 96, 60) == 8
r, steps = 4, 0
while r < 40:
    r, steps = min(40, r * 2), steps + 1
print(f"ex3 (b) {steps} steps of 15 s = {steps * 15} s (4-8-16-32-40)")
print(f"ex3 (d) 300 x 20 = {300 * 20} req/s / 150 = {300 * 20 / 150:.0f} replicas = max 40, no headroom")
assert 300 * 20 / 150 == 40

# ---------------------------------------------------------------- ex. 4 canary (delivery page)
za, zb = 1.645, 0.842
def n_req(p0, p1):
    pbar = (p0 + p1) / 2
    num = za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))
    return math.ceil((num / (p1 - p0)) ** 2)
for p1, expected in [(0.01, 835), (0.005, 2312), (0.002, 18527)]:
    n = n_req(0.001, p1)
    assert n == expected, (n, expected)
    print(f"ex4 (a) 0.1% -> {p1:.1%}: {n:,} requests; at 5% (20 req/s) {n / 20 / 60:.1f} min; at 25% (100 req/s) {n / 100 / 60:.1f} min")
print(f"ex4 (b) 30 s x 20 req/s = {30 * 20} requests")
print(f"ex4 (c) 5 min x 20 req/s = {5 * 60 * 20:,} requests (>= 835 and 2,312; < 18,527); freeze from 09:30")

# ---------------------------------------------------------------- ex. 6 FinOps (finops page)
H = 730
lines = {
    "control plane": 0.10 * H,
    "6 nodes": 6 * 0.192 * H,
    "PostgreSQL Multi-AZ": 2 * 0.225 * H + 400 * 0.115,
    "NAT x3 + 2 TB": 3 * 0.045 * H + 2000 * 0.045,
    "CDN 20 TB": 20_000 * 0.085,
    "logs 1 TB": 1000 * 0.50,
}
for k, v in lines.items():
    print(f"ex6 (a) {k}: {v:,.2f}")
close(lines["6 nodes"], 840.96); close(lines["PostgreSQL Multi-AZ"], 374.50); close(lines["NAT x3 + 2 TB"], 188.55)
extra = 24 * 0.192 * 4 * 2
always = (30 - 6) * 0.192 * H
print(f"ex6 (b) on-sale extra = {extra:.2f}; always-on 24 extra nodes = {always:,.2f}")
close(extra, 36.864); close(always, 3363.84)
print(f"ex6 (c) per ticket = {(4999 + 43) / 400_000:.4f} USD; CDN share = {1700 / 4999:.0%}")

# ---------------------------------------------------------------- ex. 7 FaaS vs containers (finops page)
faas = 0.20e-6 + 0.100 * 0.5 * 0.0000166667 + 1.00e-6
floor = 2 * 18.02 + 22.27
sec = 730 * 3600
print(f"ex7 (a) per request = {faas:.4e} USD; containers floor = {floor:.2f} USD/month")
close(faas, 2.0333e-6, 1e-4); assert sec == 2_628_000
be = floor / (faas * sec)
print(f"ex7 (b) break-even = {be:.1f} req/s (class: ~10, plot label 11)")
tasks = math.ceil(120 / 50)
print(f"ex7 (b) 120 req/s -> {tasks} tasks = {tasks * 18.02 + 22.27:.2f} USD; FaaS = {120 * sec * faas:.0f} USD")
thumbs = 2e6 * 0.20e-6 + 2e6 * 0.5 * 1 * 0.0000166667
print(f"ex7 (c) thumbnails = {thumbs:.2f} USD/month")
close(thumbs, 17.07, 1e-3)
print("cloud-native OK")
