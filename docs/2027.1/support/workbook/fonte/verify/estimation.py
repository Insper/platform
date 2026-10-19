"""Checks every number of activity 2 (Estimation & Performance Math) and its answers.

Run from the fonte/ folder:  python3 verify/estimation.py
Numbers "from the class" are on docs/2027.1/classes/estimation/ (index, numbers,
queueing, percentiles, availability-math); the others were created for the workbook.
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


DAY = 86_400

# ---------------------------------------------------------------- ex. 1: powers of ten
for per_day in (1e6, 1e8, 1e9):
    print(f"ex1 (a) {per_day:.0e}/day = {per_day / DAY:,.1f}/s (rule of thumb {per_day / 1e5:,.0f}/s)")
reads = 2e6 * 20
print(f"ex1 (b) reads/day {reads:.0e}; /1e5 = {reads / 1e5:.0f}/s; exact {reads / DAY:.0f}/s; peak x3 = {3 * reads / 1e5:.0f}/s")
assert reads / 1e5 == 400
print(f"ex1 (c) 10 Gbit/s = {10 / 8} GB/s")
gbps = 1200 * 1e6 * 8 / 1e9
print(f"ex1 (d) 1,200 x 1 MB = {1200 * 1e6 / 1e9} GB/s = {gbps} Gbit/s; CDN 95% -> origin {gbps * 0.05:.2f} Gbit/s")
close(gbps, 9.6)

# ---------------------------------------------------------------- ex. 2: seat map three ways
print(f"ex2 (a) 60,000 x 0.5 ms = {60_000 * 0.5 / 1000} s")
mb = 60_000 * 50 / 1e6
transfer_ms = 60_000 * 50 * 8 / 10e9 * 1000
print(f"ex2 (b) {mb} MB; transfer on 10 Gbit/s = {transfer_ms:.1f} ms; total ~ 0.5 + 10..30 + {transfer_ms:.1f} = "
      f"{0.5 + 10 + transfer_ms:.0f}..{0.5 + 30 + transfer_ms:.0f} ms")
print(f"ex2 (c) 300 KB on 10 Gbit/s = {300e3 * 8 / 10e9 * 1000:.2f} ms + RTT -> ~1-2 ms")
print(f"ex2 (d) 50 x 0.2..0.5 ms = {50 * 0.2:.0f}..{50 * 0.5:.0f} ms")

# ---------------------------------------------------------------- ex. 3: Little's Law
lam, W, Wdb, S, c = 1000, 0.040, 0.010, 0.005, 8
print(f"ex3 (a) L = {lam * W:.0f} in flight; per replica (4) = {lam * W / 4:.0f}")
print(f"ex3 (b) connections busy = {lam * Wdb:.0f}")
rho = lam * S / c
print(f"ex3 (c) rho = {rho:.3f}; X_max = c/S = {c / S:.0f} holds/s")
close(rho, 0.625); close(c / S, 1600)
print(f"ex3 (d) payment in flight: {100 * 0.3:.0f} -> {100 * 3:.0f} (pool of 200)")

# ---------------------------------------------------------------- ex. 4: M/M/1 knee
S_ms = 5
for r in (0.5, 0.7, 0.9, 0.92, 0.95):
    R = S_ms / (1 - r)
    print(f"ex4 rho={r:.2f}: R = {R:.1f} ms, p99 = {math.log(100) * R:.0f} ms")
print(f"ex4 ln(100) = {math.log(100):.3f}")
print(f"ex4 (c) 4 x 60% -> 3 x {4 * 0.6 / 3:.0%}; 4 x 80% -> 3 x {4 * 0.8 / 3:.0%}")
# scaling the observed 70% case (p99 ~77 ms, the model) to 92%: ratio of (1 - rho)
p99_70 = math.log(100) * S_ms / (1 - 0.7)
p99_92 = math.log(100) * S_ms / (1 - 0.92)
print(f"ex4 (b) p99 at 70% = {p99_70:.0f} ms; x {(1 - 0.7) / (1 - 0.92):.2f} -> {p99_92:.0f} ms at 92%")
close(round(p99_70), 77); close(round(p99_92, -1), 290)

# ---------------------------------------------------------------- ex. 5: fan-out
for n in (5, 20, 100):
    print(f"ex5 (a) N={n}: P(slow) = {1 - 0.99 ** n:.1%}")
print(f"ex5 (b) 20 shards: {1 - 0.99 ** 20:.1%}; 10 shards: {1 - 0.99 ** 10:.1%}")

# ---------------------------------------------------------------- ex. 6: availability
MIN30 = 30 * 24 * 60
naive = 0.9999 * 0.9995 ** 4 * 0.999 * 0.995
async_mail = 0.9999 * 0.9995 ** 4 * 0.999
two_psp = 0.9999 * 0.9995 ** 4 * (1 - 0.001 ** 2)
all_9999 = 0.9999 ** 5 * (1 - 0.001 ** 2)
for name, a in [("naive", naive), ("async e-mail", async_mail), ("2 providers", two_psp), ("all 99.99%", all_9999)]:
    print(f"ex6 {name}: A = {a:.4%}; down {(1 - a) * MIN30:.0f} min = {(1 - a) * MIN30 / 60:.1f} h per 30 days")
close(round(naive * 100, 2), 99.19); close(round(async_mail * 100, 2), 99.69)
close(round(two_psp * 100, 2), 99.79); close(round(all_9999 * 100, 2), 99.95)
for mttf, mttr in [(720, 2), (1440, 2), (720, 2 / 60)]:
    print(f"ex6 (e) MTTF {mttf} h, MTTR {mttr:.3f} h: A = {mttf / (mttf + mttr):.4%}")

# ---------------------------------------------------------------- ex. 7: the on-sale
demand = 2e6 / 60
cap100 = c / S
cap70 = 0.7 * cap100
print(f"ex7 (a) demand = {demand:,.0f} holds/s")
print(f"ex7 (b) capacity {cap100:.0f}/s at 100%, {cap70:.0f}/s at 70%; demand/capacity = {demand / cap100:.0f}x .. {demand / cap70:.0f}x")
fans_needed = 60_000 / 2
print(f"ex7 (c) {fans_needed:,.0f} fans at 1,000/s -> {fans_needed / 1000:.0f} s; last of 2 M waits {2e6 / 1000:.0f} s = {2e6 / 1000 / 60:.0f} min")
orders_gb_year = 1e5 * 1e3 * 365 / 1e9
print(f"ex7 (d) orders {orders_gb_year:.1f} GB/yr; 5 yr x 3 = {orders_gb_year * 5 * 3:.0f} GB")
pdf_tb_year = 2e5 * 100e3 * 365 / 1e12
print(f"ex7 (d) PDFs {2e5 * 100e3 / 1e9:.0f} GB/day = {pdf_tb_year:.1f} TB/yr; 5 yr = {pdf_tb_year * 5:.1f} TB")
print("estimation OK")
