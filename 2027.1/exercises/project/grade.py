import matplotlib.pyplot as plt
from io import StringIO

# Project weights (%): inner ring = phases, outer ring = deliverables.
phases = [
    ("Design", 10, "cornflowerblue"),
    ("Build", 40, "mediumseagreen"),
    ("Prove", 25, "hotpink"),
    ("Communicate", 25, "gold"),
]
deliverables = [
    ("M1 Design doc", 10, "lightsteelblue"),
    ("M2 Core path", 10, "darkseagreen"),
    ("M3 Scale & cache", 10, "mediumaquamarine"),
    ("M4 Async & resilience", 10, "palegreen"),
    ("M5 K8s + CI/CD", 10, "lightgreen"),
    ("M6 Load-test campaign", 15, "orchid"),
    ("M7 Game day", 10, "pink"),
    ("M8 Cost report", 10, "orange"),
    ("M9 Presentation", 10, "khaki"),
    ("Docs quality", 5, "lemonchiffon"),
]
assert sum(w for _, w, _ in phases) == 100
assert sum(w for _, w, _ in deliverables) == 100

fig, ax = plt.subplots(1, 1, figsize=(6, 6))
size = .3
ax.pie(
    [w for _, w, _ in phases],
    radius=1 - size,
    labels=[f"{n}\n{w}%" for n, w, _ in phases],
    colors=[c for _, _, c in phases],
    wedgeprops=dict(width=size, edgecolor="w"),
    labeldistance=.78,
    textprops=dict(ha="center", va="center", fontsize=8),
    startangle=90,
    counterclock=False,
)
ax.pie(
    [w for _, w, _ in deliverables],
    radius=1,
    labels=[f"{n}\n{w}%" for n, w, _ in deliverables],
    colors=[c for _, _, c in deliverables],
    wedgeprops=dict(width=size, edgecolor="w"),
    textprops=dict(fontsize=8, color="gray"),  # readable in light and dark mode
    startangle=90,
    counterclock=False,
)
ax.set(aspect="equal")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
