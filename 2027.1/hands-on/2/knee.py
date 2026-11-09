import matplotlib.pyplot as plt
from io import StringIO

# example sweep: catalog with 1 CPU and a pool of 10 connections (one laptop, one run)
offered = [50, 100, 200, 300, 400, 500]
throughput = [50, 100, 200, 300, 400, 490]
p50 = [1.3, 0.6, 0.5, 0.6, 1.5, 15.0]
p99 = [41.3, 32.9, 33.5, 38.6, 223.7, 2056.2]

fig, ax = plt.subplots(1, 2, figsize=(10, 4))

ax[0].plot(offered, offered, "--", color="gray", label="offered = served")
ax[0].plot(offered, throughput, "o-", color="tab:blue", label="served")
ax[0].set_xlabel("offered load (req/s)")
ax[0].set_ylabel("throughput (req/s)")
ax[0].set_title("Throughput follows the load... until it cannot")
ax[0].legend()

ax[1].plot(offered, p99, "o-", color="tab:red", label="p99")
ax[1].plot(offered, p50, "o-", color="tab:green", label="p50")
ax[1].axvspan(300, 400, color="orange", alpha=0.2, label="knee")
ax[1].set_yscale("log")
ax[1].set_xlabel("offered load (req/s)")
ax[1].set_ylabel("latency (ms, log scale)")
ax[1].set_title("Latency is flat, then explodes")
ax[1].legend()

for a in ax:
    a.grid(alpha=0.3)

plt.tight_layout()
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
