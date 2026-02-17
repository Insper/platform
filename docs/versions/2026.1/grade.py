import matplotlib.pyplot as plt
from io import StringIO

fig, ax = plt.subplots(1, 2, figsize=(10, 5))

# individual
ax[0].pie(
    [10, 10, 30, 50],
    labels=["Quizzes", "Microservice", "Midterm exam", "Final exam"],
    colors=["aquamarine", "mediumaquamarine", "mediumspringgreen", "mediumturquoise"],
    autopct='%1.0f%%',
    startangle=90)
ax[0].title.set_text("Individual")

# team
size = .3
ax[1].pie(
    [40, 40, 20],
    radius=1-size,
    # labels=["Architecture", "Deployment", "Report"],
    colors=['cornflowerblue', 'hotpink', 'gold'],
    wedgeprops=dict(width=size, edgecolor='w'),
    labeldistance=.2,
    autopct='%1.0f%%',
    pctdistance=0.75,
    startangle=90
)
ax[1].pie(
    [
        10, 5, 5, 20,
        5, 10, 10, 15,
        10, 10
    ],
    labels=[
        'Gateway\n10%', 'Auth\n5%', 'Account\n5%', 'Bottlenecks\n20%',
        'Cloud Setup\n5%', 'K8s\n10%', 'CI/CD\n10%', 'Stress Test\n15%',
        'SLA & Costs\n10%', 'Quality\n10%'
    ],
    colors=[
        "steelblue", "dodgerblue", "deepskyblue", "skyblue",
        "orchid", "violet", "plum", "pink",
        'orange', 'lemonchiffon',
    ],
    radius=1,
    wedgeprops=dict(width=size, edgecolor='w'),
    startangle=90
)
ax[1].title.set_text("Team")
ax[1].set(aspect="equal")
ax[1].text(-.32, .0, "Architecture", color='black', ha='center')
ax[1].text(.25, -.35, "Deployment", color='black', ha='center')
ax[1].text(.25, .3, "Report", color='black', ha='center')

plt.tight_layout()

# Display the plot
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()