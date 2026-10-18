"""Checks every number of activity 3 (Distributed Systems) and its answers.

Run from the fonte/ folder:  python3 verify/distributed.py
Numbers "from the class" are on docs/2027.1/classes/distributed/ (index, consistency,
cap-pacelc, consensus, transactions, time-clocks); the others were created for the workbook.
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 1: failure is normal
p = 0.001
for n in (3, 1000, 3000):
    print(f"ex1 (a) N={n}: P(some failure) = {1 - (1 - p) ** n:.2%}  (e^-pN approx {1 - math.exp(-p * n):.2%})")
close(1 - (1 - p) ** 3, 0.002997, 1e-3)
assert round(1 - (1 - p) ** 1000, 2) == 0.63
assert round(1 - (1 - p) ** 3000, 2) == 0.95

# ---------------------------------------------------------------- ex. 4: stale reads
for mean in (20, 200, 800):
    print(f"ex4 (a) mean lag {mean} ms: P(stale at 300 ms) = {math.exp(-300 / mean):.3g}")
assert round(math.exp(-300 / 800), 2) == 0.69
assert round(math.exp(-300 / 200), 2) == 0.22

# ---------------------------------------------------------------- ex. 5: majorities and quorums
for n in (3, 4, 5, 7):
    print(f"ex5 (a) N={n}: majority {n // 2 + 1}, tolerates {(n - 1) // 2}")
for layout in ((2, 2, 1), (3, 1, 1)):
    left = sum(layout) - max(layout)
    print(f"ex5 (b) {layout}: lose a {max(layout)}-node zone -> {left} left, majority 3 -> writes {'continue' if left >= 3 else 'stop'}")
a = 0.99
a23 = a ** 3 + 3 * a ** 2 * (1 - a)
print(f"ex5 (c) 2-of-3 at 99%: {a23:.6f} = {a23:.2%}")
close(a23, 0.999702)
for w, r in ((1, 1), (2, 2), (3, 1), (1, 3), (2, 1)):
    print(f"ex5 (d) W={w} R={r}: R+W={w + r} > 3? {w + r > 3}")
print("ex5 (e) token 33 < highest seen 34 -> rejected")

# ---------------------------------------------------------------- ex. 6: clocks
release_stamp = 0.040 + 0.050
hold_stamp = 0.060
print(f"ex6 (a) release stamped .{release_stamp * 1000:.0f}, hold stamped .{hold_stamp * 1000:.0f} -> release wins")
assert release_stamp > hold_stamp
print(f"ex6 (b) 20 ppm x 86,400 s = {20e-6 * 86_400:.3f} s; 40 ppm x 600 s = {40e-6 * 600 * 1000:.0f} ms")
consumer = max(0, 2) + 1
ticket = consumer + 1
notif = max(1, ticket) + 1
print(f"ex6 (c) consumer {consumer}; TicketIssued {ticket}; notification {notif}")
assert (consumer, ticket, notif) == (3, 4, 5)
v1, v2 = (1, 1, 0), (1, 0, 1)
le = lambda x, y: all(i <= j for i, j in zip(x, y))
print(f"ex6 (d) {v1} <= {v2}? {le(v1, v2)}; {v2} <= {v1}? {le(v2, v1)} -> concurrent")
assert not le(v1, v2) and not le(v2, v1)

# ---------------------------------------------------------------- ex. 7: PACELC
print(f"ex7 (b) 5 writes x 1..2 ms = {5 * 1}..{5 * 2} ms; 5 x 200 ms = {5 * 200} ms")
print("distributed OK")
