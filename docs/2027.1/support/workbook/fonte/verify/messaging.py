"""Checks every number of activity 8 (Messaging & Event-Driven) and its answers.

Run from the fonte/ folder:  python3 verify/messaging.py
Numbers "from the class" are on docs/2027.1/classes/messaging/ (index,
queues-pubsub, kafka, semantics, patterns); the others were created for the workbook.
"""
import math


def close(a, b, tol=1e-6):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


# ---------------------------------------------------------------- ex. 1
print(f"ex1 (b) e-mail adds {800 - 80} ms per purchase")

# ---------------------------------------------------------------- ex. 2: availability (index.md)
sync = 0.9995 * 0.999 ** 3
asyn = 0.9995 * 0.9995
print(f"ex2 sync {sync:.4%} ({(1 - sync) * 730:.2f} h/month); async {asyn:.4%} ({(1 - asyn) * 730:.2f} h/month)")
close(round(sync * 100, 2), 99.65); close(round(asyn * 100, 2), 99.90)

# ---------------------------------------------------------------- ex. 3: load levelling (index.md, quiz Q2)
grow = 6000 - 2000
backlog = grow * 180
print(f"ex3 (a) grows {grow}/s; backlog {backlog:,} at 10:03; (b) wait {backlog / 2000:.0f} s")
close(backlog, 720_000)
b4 = (6000 - 4000) * 180
print(f"ex3 (c) 4,000/s: backlog {b4:,}; wait {b4 / 4000:.0f} s")
bq = (5000 - 3000) * 120
print(f"ex3 (d) backlog {bq:,}; wait {bq / 3000:.0f} s (total arrived {5000 * 120:,}; /arrival rate {bq / 5000:.0f} s)")

# ---------------------------------------------------------------- ex. 4: PDF workers (queues-pubsub.md)
lam = 30_000 / 180
busy = lam * 0.4
print(f"ex4 (a) lambda {lam:.0f}/s; busy {busy:.0f}; for 70%: {busy / 0.7:.0f} workers")
rate20 = 20 / 0.4
bl = (lam - rate20) * 180
print(f"ex4 (b) 20 workers: {rate20:.0f}/s; backlog {bl:,.0f}; drain {bl / rate20:.0f} s = {bl / rate20 / 60:.0f} min")

# ---------------------------------------------------------------- ex. 5: Kafka (kafka.md, quiz Q7)
print(f"ex5 (a) active = min(8, 12) = {min(8, 12)}; idle {12 - 8}")
T = 30_000 / 180
print(f"ex5 (c) T = {T:.0f}/s; N >= T/c = {T / 20:.1f} -> {math.ceil(T / 20)}; class chose 24")

# ---------------------------------------------------------------- ex. 6: retries (semantics.md)
print(f"ex6 (d) waits 1 + 4 + 16 = {1 + 4 + 16} s (plus processing time) before the DLQ")

# ---------------------------------------------------------------- ex. 7: waiting room (queues-pubsub.md)
adm = 2000 * 0.5
print(f"ex7 (b) admission {adm:.0f}/s; position 512,384 -> {512_384 / adm:.0f} s = {512_384 / adm / 60:.1f} min")
print("messaging OK")
