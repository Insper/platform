"""Checks every number of activity 9 (Reliability & Resilience) and its answers.

Run from the fonte/ folder:  python3 verify/reliability.py
Numbers "from the class" are on docs/2027.1/classes/reliability/ (index, slo,
patterns, disaster-recovery, chaos); the others were created for the workbook.
"""


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 1: MTTF/MTTR (index.md)
for mttf, mttr in [(720, 2), (1440, 2), (720, 1 / 60)]:
    print(f"ex1 MTTF {mttf} h, MTTR {mttr * 60:.0f} min: A = {mttf / (mttf + mttr):.4%}")
month = 365.25 / 12 * 24 * 60
print(f"ex1 (c) 99.99% per month = {0.0001 * month:.2f} min; 99.9% = {0.001 * month:.1f} min; 28 d = {0.001 * 28 * 1440:.1f} min")

# ---------------------------------------------------------------- ex. 2: error budget (slo.md)
budget = 0.001 * 1_000_000 * 28
print(f"ex2 (a) {budget:,.0f} failed requests; {0.001 * 28 * 24 * 60:.1f} min")
bad = 0.05 * 3 * 1_000_000 / 24
print(f"ex2 (b) {bad:,.0f} failures = {bad / budget:.0%} of the budget")

# ---------------------------------------------------------------- ex. 3: burn rate (slo.md, alerting)
for e in (0.001, 0.006, 0.0144):
    b = e / 0.001
    print(f"ex3 (a) error {e:.2%}: burn {b:.1f}; budget gone in {28 / b:.1f} days")
print(f"ex3 (b) 14.4 x 1 h / (28 x 24 h) = {14.4 / (28 * 24):.2%} (about 2%; exactly 2% on 30 days: {14.4 / 720:.0%})")

# ---------------------------------------------------------------- ex. 4: composite availability (index.md chart)
def par(a, n):
    return 1 - (1 - a) ** n


steps = {
    "1 instance each": 0.9999 * 0.995 ** 3 * 0.999 * 0.999,
    "3 replicas": 0.9999 * par(0.995, 3) ** 3 * 0.999 * 0.999,
    "+ Multi-AZ SQL": 0.9999 * par(0.995, 3) ** 3 * 0.9995 * 0.999,
    "+ 2nd provider": 0.9999 * par(0.995, 3) ** 3 * 0.9995 * par(0.999, 2),
}
for k, a in steps.items():
    print(f"ex4 {k}: {a:.3%}; {(1 - a) * month:.0f} min/month")
close(round(steps["1 instance each"] * 100, 2), 98.30)
close(round(steps["+ 2nd provider"] * 100, 2), 99.94)

# ---------------------------------------------------------------- ex. 5: Little's Law, bulkhead (index.md, patterns.md)
for w in (0.2, 1, 4):
    print(f"ex5 (a) {w} s -> {100 * w:.0f} threads (of 200)")
print(f"ex5 (b) timeout 1 s -> at most {100 * 1:.0f}")
print(f"ex5 (c) normal {100 * 0.2:.0f}; bulkhead 50 -> {50 / 20:.1f}x; free threads at 4 s: {200 - 50}")
print(f"ex5 (d) 2 x 2 s + 0.3 s = {2 * 2 + 0.3} s <= 5 s (order) <= 6 s (gateway)")

# ---------------------------------------------------------------- ex. 6: retries (patterns.md)
print(f"ex6 (a) 3 x 3 x 3 = {3 ** 3}")
print(f"ex6 (b) waits {[200 * 2 ** n for n in range(3)]} ms; third with full jitter: uniform(0, 800) ms")

# ---------------------------------------------------------------- ex. 7: disaster recovery (disaster-recovery.md)
t = 2e12 / 200e6
print(f"ex7 (b) restore {t:,.0f} s = {t / 3600:.1f} h")
print(f"ex7 (c) RTO = 2 + 5 + 1 + 5 + 1 = {2 + 5 + 1 + 5 + 1} min")
print("reliability OK")
