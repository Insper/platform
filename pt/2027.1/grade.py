import matplotlib.pyplot as plt
from io import StringIO

fig, ax = plt.subplots(1, 2, figsize=(10, 5))

# individual
ax[0].pie(
    [50, 10, 15, 25],
    labels=["Exercises", "Quizzes", "Midterm exam", "Final exam"],
    colors=["aquamarine", "paleturquoise", "mediumspringgreen", "mediumturquoise"],
    autopct='%1.0f%%',
    startangle=90)
ax[0].title.set_text("Individual")

# team: the project milestones (exercises/project)
size = .3
ax[1].pie(
    [10, 40, 25, 25],
    radius=1-size,
    colors=['gold', 'cornflowerblue', 'hotpink', 'orange'],
    wedgeprops=dict(width=size, edgecolor='w'),
    startangle=90
)
ax[1].pie(
    [10, 10, 10, 10, 10, 15, 10, 10, 10, 5],
    labels=[
        'M1 Design\n10%', 'M2 Core\n10%', 'M3 Cache\n10%', 'M4 Async\n10%', 'M5 K8s+CI/CD\n10%',
        'M6 Load test\n15%', 'M7 Game day\n10%', 'M8 Cost\n10%', 'M9 Present.\n10%', 'Docs\n5%',
    ],
    colors=[
        'gold', 'steelblue', 'dodgerblue', 'deepskyblue', 'skyblue',
        'hotpink', 'violet', 'orange', 'navajowhite', 'lemonchiffon',
    ],
    radius=1,
    wedgeprops=dict(width=size, edgecolor='w'),
    startangle=90
)
ax[1].title.set_text("Team (project)")
ax[1].set(aspect="equal")

plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
