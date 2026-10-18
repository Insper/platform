"""Checks every number of activity 16 (Case Studies) and its answers.

Run from the fonte/ folder:  python3 verify/case-studies.py
All the numbers come from the case pages in docs/2027.1/classes/case-studies/
(url-shortener, rate-limiter, distributed-cache, news-feed, payment-system,
ticketing, ride-sharing, video-streaming, ai-assistant): same assumptions, same results.
"""
import math


def close(a, b, tol=1e-3):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


DAY = 86_400

# ---------------------------------------------------------------- ex. 2: Little's Law everywhere
admit = 10_000 / 300
print(f"ex2 (a) admission = 10,000 / 300 s = {admit:.1f} fans/s = {admit * 60:,.0f}/min")
print(f"ex2 (b) payments in flight = 300 x 2 = {300 * 2}")
trips = 20e6 / DAY
print(f"ex2 (c) trips/s = {trips:.0f}; active = {trips:.2f} x 1,200 s = {trips * 1200:,.0f}")
streams = 50e6 * 30 / 1440
print(f"ex2 (d) concurrent video streams = 50 M x 30 / 1,440 = {streams:,.0f}")
turn_s = 0.8 + 300 / 50 + 1.0
peak = 200_000 * 4 * (1 - 0.15) / DAY * 5
print(f"ex2 (e) turn = {turn_s:.1f} s; peak turns/s = {peak:.2f}; streams = {peak * turn_s:.0f}")
close(trips * 1200, 277_778); close(streams, 1_041_667); close(peak * turn_s, 307, 5e-3)

# ---------------------------------------------------------------- ex. 3: URL shortener
writes = 1e8 / (30 * DAY)
reads = writes * 100
records = 1e8 * 12 * 5
print(f"ex3 (a) writes {writes:.2f}/s; reads {reads:,.0f}/s; peak x3 {reads * 3:,.0f}/s")
print(f"ex3 (a) records {records:,.0f}; storage {records * 500 / 1e12:.2f} TB")
print(f"ex3 (b) 62^6 = {62 ** 6:,}; 62^7 = {62 ** 7:,}; used {records / 62 ** 7:.2%}")
cache = reads * DAY * 0.2 * 500
print(f"ex3 (c) hot set = {reads:,.0f} x 86,400 x 0.2 x 500 B = {cache / 1e9:.1f} GB")
close(62 ** 7, 3_521_614_606_208); close(cache / 1e9, 33.33)
print(f"ex3 (d) range leasing: one counter update per 10,000 ids -> {writes / 10_000 * DAY:.0f} updates/day")

# ---------------------------------------------------------------- ex. 4: rate limiter boundary
LIMIT, W = 10, 1.0
reqs = [0.99] * 10 + [1.01] * 10
# fixed window
fw = {}
allowed_fw = 0
for t in reqs:
    w = int(t // W)
    if fw.get(w, 0) < LIMIT:
        fw[w] = fw.get(w, 0) + 1; allowed_fw += 1
# token bucket (capacity 10, 10 tokens/s, full at t = 0)
tokens, last, allowed_tb = 10.0, 0.0, 0
for t in reqs:
    tokens = min(10.0, tokens + (t - last) * 10); last = t
    if tokens >= 1:
        tokens -= 1; allowed_tb += 1
# sliding log
log, allowed_sl = [], 0
for t in reqs:
    if sum(1 for x in log if x > t - W) < LIMIT:
        log.append(t); allowed_sl += 1
# sliding counter
cnt, allowed_sc = {}, 0
for t in reqs:
    w = int(t // W)
    overlap = 1 - (t % W) / W
    est = cnt.get(w - 1, 0) * overlap + cnt.get(w, 0)
    if est < LIMIT:
        cnt[w] = cnt.get(w, 0) + 1; allowed_sc += 1
print(f"ex4 (a) fixed {allowed_fw}, token bucket {allowed_tb}, sliding log {allowed_sl}, sliding counter {allowed_sc}")
assert (allowed_fw, allowed_tb, allowed_sl, allowed_sc) == (20, 10, 10, 11)
print(f"ex4 (b) 20 gateways with local buckets: up to {20 * LIMIT} req/s = 20x; local share = {LIMIT / 20}")
print(f"ex4 (c) memory: counters 1 M x 2 x 100 B = {1e6 * 2 * 100 / 1e6:.0f} MB; "
      f"sliding log 1 M x 600 x 50 B = {1e6 * 600 * 50 / 1e9:.0f} GB")

# ---------------------------------------------------------------- ex. 5: distributed cache
data = 1e9 * (1000 + 50 + 50)
by_mem = data / 64e9
by_ops = 2e6 / 80e3
prim = math.ceil(max(by_mem, by_ops))
print(f"ex5 (a) data {data / 1e12:.2f} TB; nodes by memory {by_mem:.2f}; by ops {by_ops:.0f}; primaries {prim}; total {2 * prim}")
for h in (0.95, 0.90):
    print(f"ex5 (b) DB load at {h:.0%} = {2e6 * (1 - h):,.0f}/s")
print(f"ex5 (b) one hit-ratio point = {2e6 * 0.01:,.0f}/s; losing 1 of 25 nodes = {2e6 / 25:,.0f} misses/s")
print(f"ex5 (c) 4 -> 5 nodes: mod N moves {1 - 1 / 5:.0%} (exactly 1 - 4/5); ring ~1/5 = {1 / 5:.0%}")
# exact count for hash % N: a key stays only if h % 4 == h % 5, i.e. h % 20 in {0,1,2,3}
print(f"ex5 (c) exact mod: keys that stay = 4/20 = {4 / 20:.0%} -> moved {16 / 20:.0%}")

# ---------------------------------------------------------------- ex. 6: news feed
posts = 100e6 * 0.2
rd = 100e6 * 10 / DAY
print(f"ex6 (a) posts {posts / 1e6:.0f} M/day = {posts / DAY:.0f}/s; reads {rd:,.0f}/s, peak {rd * 3:,.0f}/s; "
      f"ratio {rd / (posts / DAY):.0f}:1")
print(f"ex6 (b) fan-out inserts = {posts / DAY:.0f} x 200 = {posts / DAY * 200:,.0f}/s")
print(f"ex6 (c) timelines = 100 M x 800 x 8 B x 2 = {100e6 * 800 * 8 * 2 / 1e9:,.0f} GB")
print(f"ex6 (c) posts = 20 M x 1,000 B x 365 = {posts * 1000 * 365 / 1e12:.1f} TB/year")
print(f"ex6 (d) a 50 M-follower post = 50 M inserts = {50e6 / (posts / DAY * 200):.0f} s of the whole fan-out capacity")

# ---------------------------------------------------------------- ex. 7: payment
print(f"ex7 (a) average {300_000 / DAY:.2f}/s; in flight at peak 300 x 2 = {300 * 2}; "
      f"duplicates without keys 300,000 x 0.001 = {300_000 * 0.001:.0f}/day")
ledger_gb = 300_000 * 4 * 200 * 365 / 1e9
print(f"ex7 (a) ledger {300_000 * 4:,} lines/day; {ledger_gb:.1f} GB/year")
charged = 20_000 + 3_000            # cents
fee = round(charged * 0.025)
T1 = {"psp_receivable": charged - fee, "psp_fees": fee, "promoter_payable": -20_000, "platform_revenue": -3_000}
T2 = {"bank": charged - fee, "psp_receivable": -(charged - fee)}
T3 = {"promoter_payable": 20_000, "bank": -20_000}
for name, t in (("T1", T1), ("T2", T2), ("T3", T3)):
    assert sum(t.values()) == 0, name
    print(f"ex7 (c) {name}: {t} sum 0")
bal = {}
for t in (T1, T2, T3):
    for k, v in t.items():
        bal[k] = bal.get(k, 0) + v
print(f"ex7 (c) fee {fee / 100:.2f}; balances (BRL) {({k: v / 100 for k, v in bal.items()})}")
assert fee == 575 and bal["bank"] == 2_425

# ---------------------------------------------------------------- ex. 8: ticketing
fans, arrival, seats = 2e6, 120, 60_000
orders = seats / 2
join = fans / arrival
no_queue = fans * 5 / 60
poll = fans / 10
admit = 10_000 / 300
admits = orders / 0.6
sellout = admits / admit / 60
order_rate = admit * 0.6
print(f"ex8 (a) orders {orders:,.0f}; joins {join:,.0f}/s; no queue {no_queue:,.0f}/s; polls {poll:,.0f}/s")
print(f"ex8 (a) admit {admit:.2f}/s; admits {admits:,.0f}; sell-out {sellout:.0f} min; orders {order_rate:.0f}/s; "
      f"payments in flight {order_rate * 2:.0f}; seat-map reads {10_000 / 3:,.0f}/s; inventory {seats * 100 / 1e6:.0f} MB")
close(sellout, 25); close(order_rate, 20); close(no_queue, 166_667)
print(f"ex8 (e) queue ETA for position 48,210 at {admit:.1f}/s = {48_210 / admit / 60:.0f} min")
print("case-studies OK")
