"""Checks every number of activity 14 (AI-Assisted Delivery) and its answers.

Run from the fonte/ folder:  python3 verify/ai-delivery.py
Numbers "from the class" are on docs/2027.1/classes/ai-delivery/ (index: review cost table;
code-review: precision/recall sample; testing: selection table; agents-in-ci: cost model);
the mutation-score case of exercise 5 was created for the workbook.
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 3: cost of one review (index.md)
PREFIX, DIFF, OUT, WRITE = 8_000, 6_000, 1_500, 1.25
P_IN, P_OUT, P_READ = 2.00, 10.00, 0.20        # mid model, US$ per 1M tokens


def review(hit):
    return (PREFIX * hit * P_READ + PREFIX * (1 - hit) * P_IN * WRITE + DIFF * P_IN + OUT * P_OUT) / 1e6


cold, warm = review(0.0), review(0.8)
print(f"ex3 (a) cold = {cold:.4f}; parts: prefix write {PREFIX * P_IN * WRITE / 1e6:.4f}, "
      f"diff {DIFF * P_IN / 1e6:.4f}, output {OUT * P_OUT / 1e6:.4f}")
print(f"ex3 (b) 80% hits = {warm:.4f}; cached part {PREFIX * 0.8 * P_READ / 1e6:.5f}, "
      f"written part {PREFIX * 0.2 * P_IN * WRITE / 1e6:.4f}")
close(cold, 0.047); close(round(warm, 4), 0.0323)
print(f"ex3 (c) month: 250 reviews = {warm * 250:.2f}; 20,000 reviews = {warm * 20_000:.0f}")
close(round(warm * 250, 2), 8.07); close(round(warm * 20_000), 646)
print(f"ex3 (d) output share: cold {OUT * P_OUT / 1e6 / cold:.0%}, warm {OUT * P_OUT / 1e6 / warm:.0%}")
useless = (1 - 0.40) * 4 * 5_000
print(f"ex3 (e) useless comments/week = {useless:,.0f}; hours = {useless / 60:.0f}; 40-h weeks = {useless / 60 / 40:.0f}")
close(useless, 12_000)

# ---------------------------------------------------------------- ex. 4: precision and recall (code-review)
REAL = 150
levels = [("high", 60, 48), ("medium", 90, 45), ("low", 150, 30)]
posted = real = 0
for name, n, r in levels:
    posted += n; real += r
    print(f"ex4 >= {name}: {posted / 100:.1f} comments/PR, precision {real / posted:.0%}, recall {real / REAL:.0%}")
print(f"ex4 per level precision: {[f'{r / n:.0%}' for _, n, r in levels]}")

# ---------------------------------------------------------------- ex. 5: mutation score and test selection
mutants, base_killed = 200, 82
print(f"ex5 (a) baseline score = {base_killed / mutants:.0%}")
for name, killed in [("A", 84), ("B", 96)]:
    s = killed / mutants
    print(f"ex5 (b) PR {name}: {s:.0%}, gain {100 * (s - base_killed / mutants):+.0f} pp, accept = {s >= base_killed / mutants + 0.05}")
runs = 60 * 3 / 5
print(f"ex5 (d) runs/day = {runs:.0f}; selected minutes = {runs * 4:.0f}; full = {runs * 25:.0f}; saved = {runs * 21:.0f} min = {runs * 21 / 60:.1f} h")
for recall in (1.0, 0.95, 0.90):
    slip = runs * 5 * 0.04 * (1 - recall)
    print(f"ex5 (e) recall {recall:.0%}: breaks slipping to nightly per week = {slip:.2f}"
          + (f" (one every {1 / slip:.1f} weeks)" if slip else ""))

# ---------------------------------------------------------------- ex. 6: agent cost (agents-in-ci)
A_IN, A_OUT, A_READ = 4.00, 20.00, 0.20
START, GROWTH, AOUT = 20_000, 2_500, 400


def run_cost(steps, cached):
    total, context = 0.0, START
    for i in range(steps):
        new = START if i == 0 else GROWTH
        old = context - new
        total += (old * A_READ + new * A_IN * WRITE) / 1e6 if cached else context * A_IN / 1e6
        total += AOUT * A_OUT / 1e6
        context += GROWTH
    return total


for n in (1, 10, 25, 40):
    tokens = sum(START + GROWTH * i for i in range(n))
    print(f"ex6 n={n}: input tokens {tokens:,} (= 20000n + 1250n(n-1) = {20_000 * n + 1_250 * n * (n - 1):,}); "
          f"no cache {run_cost(n, False):.2f}, cached {run_cost(n, True):.2f}")
    assert tokens == 20_000 * n + 1_250 * n * (n - 1)
close(round(run_cost(10, False), 2), 1.33); close(round(run_cost(40, False), 2), 11.32)
close(round(run_cost(10, True), 2), 0.35); close(round(run_cost(40, True), 2), 1.43)
print(f"ex6 (b) 40 vs 10 turns, no cache: x{run_cost(40, False) / run_cost(10, False):.1f}; "
      f"cache saves x{run_cost(40, False) / run_cost(40, True):.1f} at 40 turns")
print(f"ex6 (c) per merged fix: {0.80 / 0.25:.2f}")
close(0.80 / 0.25, 3.20)

# ---------------------------------------------------------------- ex. 7: canary (release-operate)
print(f"ex7 (d) canary error ratio vs stable: {2.9 / 0.1:.0f}x")
print("ai-delivery OK")
