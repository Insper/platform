"""Checks every number of activity 6 (Databases & Data Systems) and its answers.

Run from the fonte/ folder:  python3 verify/databases.py
Numbers "from the class" are on docs/2027.1/classes/databases/ (index, models,
transactions, replication, partitioning, specialized); the others were created
for the workbook.
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 1: data map (index.md data map)
orders_gb_year = 20e6 * 1e3 / 1e9
click_gb_day = 100e6 * 200 / 1e9
vectors_mb = 100_000 * 1024 * 4 / 1e6
print(f"ex1 orders {orders_gb_year:.0f} GB/yr; clickstream {click_gb_day:.0f} GB/day; vectors {vectors_mb:.0f} MB")
close(orders_gb_year, 20); close(click_gb_day, 20); close(vectors_mb, 409.6)

# ---------------------------------------------------------------- ex. 2: B-tree and LSM (models.md)
fan = 8192 / 16
print(f"ex2 (a) fan-out {fan:.0f} (~500); 500^2={500**2:,}; 500^3={500**3:,}; 500^4={500**4:,}")
for rows in (3e6, 1e9):
    levels = math.ceil(math.log(rows, 500))
    print(f"ex2 (b) {rows:,.0f} rows -> {levels} levels")
assert 500 ** 2 < 3e6 <= 500 ** 3 and 500 ** 3 < 1e9 <= 500 ** 4
btree = 1 + 8192 / 100
lsm = 2 + 3 * 10 / 2
print(f"ex2 (c) B-tree WA at 100 B = {btree:.1f}x; LSM 3 levels = {lsm:.0f}x")
close(lsm, 17)

# ---------------------------------------------------------------- ex. 3: write skew
print(f"ex3 (c) Alice ends with {4 + 2 + 2} tickets (limit 6)")

# ---------------------------------------------------------------- ex. 4: contention (transactions.md)
cap = 10_000
for rows, t in [(1, 0.005), (40, 0.005), (60_000, 0.005), (1, 0.5)]:
    print(f"ex4 {rows} rows, lock {t * 1000:.0f} ms -> {min(rows / t, cap):,.0f} tx/s")
close(1 / 0.005, 200); close(40 / 0.005, 8000)
print(f"ex4 (a) 2 M fans at 200/s = {2e6 / 200:,.0f} s = {2e6 / 200 / 3600:.1f} h")

# ---------------------------------------------------------------- ex. 5: replicas
for m in (20, 200, 1000):
    print(f"ex5 (a) mean lag {m} ms -> P(stale at 300 ms) = {math.exp(-300 / m):.1%}")
print(f"ex5 (c) busy = {2000 * 0.005:.0f}; 20 pods x 50 = {20 * 50}")
pairs = [(w, r) for w in range(1, 4) for r in range(1, 4) if r + w > 3]
print("ex5 (d) overlapping (W, R):", pairs)
tolerant = [(w, r) for (w, r) in pairs if w <= 2 and r <= 2]
print("ex5 (d) tolerate one node down for both:", tolerant)
assert tolerant == [(2, 2)]

# ---------------------------------------------------------------- ex. 6: ring and mod N (partitioning.md)
nodes = {"A": 0x10, "B": 0x40, "C": 0xB0}


def owner(h, nodes):
    after = sorted((p, n) for n, p in nodes.items() if p >= h)
    return after[0][1] if after else min((p, n) for n, p in nodes.items())[1]


for key, h in [("seat:A-12", 0x1F), ("seat:C-07", 0x9A), ("seat:Z-99", 0xF3)]:
    print(f"ex6 (a) {key} (0x{h:02X}) -> {owner(h, nodes)}")
assert owner(0x1F, nodes) == "B" and owner(0x9A, nodes) == "C" and owner(0xF3, nodes) == "A"
nodes2 = dict(nodes, D=0x80)
moved = [h for h in range(256) if owner(h, nodes) != owner(h, nodes2)]
print(f"ex6 (b) keys that move: 0x{min(moved):02X}..0x{max(moved):02X}, from {owner(moved[0], nodes)} to D")
stay = sum(1 for h in range(90_000) if h % 9 == h % 10) / 90_000
print(f"ex6 (c) mod N 9->10: {stay:.1%} stay, {1 - stay:.0%} move; consistent hashing ~1/10 = 10%")
close(stay, 0.1)

# ---------------------------------------------------------------- ex. 7: five years (partitioning.md, specialized.md)
print(f"ex7 (a) 1e9 x 1 KB = {1e9 * 1e3 / 1e12:.0f} TB")
raw_tb = 20 * 365 * 2 / 1000
cols_tb = raw_tb * 3 / 30
print(f"ex7 (b) raw {raw_tb:.1f} TB; 3 of 30 columns {cols_tb:.2f} TB; compressed {cols_tb * 1000 / 10:.0f}..{cols_tb * 1000 / 5:.0f} GB")
print("databases OK")
