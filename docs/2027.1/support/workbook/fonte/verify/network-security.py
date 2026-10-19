"""Checks every number of activity 11 (Network & Security) and its answers.

Run from the fonte/ folder:  python3 verify/network-security.py
Numbers "from the class" are on docs/2027.1/classes/network-security/ (index,
cloud-network, service-mesh, identity, zero-trust, quiz); the NAT hourly price is the
one used in class 12 (finops); the others were created for the workbook.
"""
from datetime import datetime, timedelta


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 2: CIDR (cloud-network page)
for p in (16, 19, 22, 24, 28):
    total = 2 ** (32 - p)
    print(f"ex2 (a) /{p}: total {total:,}, usable {total - 5:,}")
assert 2 ** 13 - 5 == 8187 and 2 ** 8 - 5 == 251
used = 3 * 2 ** 8 + 3 * 2 ** 13 + 3 * 2 ** 10
print(f"ex2 (b) allocated {used:,} of 65,536 = {used / 65536:.0%}; free {65536 - used:,} = {1 - used / 65536:.0%}")
assert used == 28_416

# ---------------------------------------------------------------- ex. 4: NAT
h = 730
print(f"ex4 (b) one NAT {0.045 * h:.2f} USD/month; three {3 * 0.045 * h:.2f} USD/month")
gb_day = 30 * 2 + 50
print(f"ex4 (c) {gb_day} GB/day x 30 = {gb_day * 30:,} GB; x 0.045 = {gb_day * 30 * 0.045:.1f} USD/month")
close(gb_day * 30 * 0.045, 148.5)

# ---------------------------------------------------------------- ex. 5: tokens (identity page)
iat, exp = 1_792_310_400, 1_792_311_300
print(f"ex5 (b) lifetime = {exp - iat} s = {(exp - iat) / 60:.0f} min")
assert exp - iat == 900
last = datetime(2026, 1, 1, 13, 58)
print(f"ex5 (c) valid until {(last + timedelta(minutes=15)).strftime('%H:%M')}")

# ---------------------------------------------------------------- ex. 6: mesh (service-mesh page)
print(f"ex6 (b) client 3 attempts x mesh (1 + 2 retries) = {3 * 3} calls")
print(f"ex6 (c) 9 x 6 = {9 * 6} pods x 50 MB = {9 * 6 * 50 / 1000:.1f} GB")
pods = 7 * 6 + 2 * 40
print(f"ex6 (c) flash sale: 7 x 6 + 2 x 40 = {pods} pods x 50 MB = {pods * 50 / 1000:.1f} GB")
assert pods == 122
print("network-security OK")
