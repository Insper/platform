import matplotlib.pyplot as plt
from io import StringIO

fig, ax = plt.subplots(1, 1, figsize=(5, 5))

# team
size = .3
ax.pie(
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
ax.pie(
    [
        5, 5, 5, 5, 20,
        5, 10, 10, 15,
        10, 10
    ],
    labels=[
        'Gateway\n5%', 'Auth\n5%', 'Account\n5%', 'Exchange\n5%', 'Bottlenecks\n20%',
        'Cloud Setup\n5%', 'Orchestration\n10%', 'CI/CD\n10%', 'Stress Test\n15%',
        'SLA & Costs\n10%', 'Quality\n10%'
    ],
    colors=[
        "steelblue", "dodgerblue", "deepskyblue", "skyblue", "lightcyan",
        "orchid", "violet", "plum", "pink",
        'orange', 'lemonchiffon',
    ],
    radius=1,
    wedgeprops=dict(width=size, edgecolor='w'),
    startangle=90
)
ax.set(aspect="equal")
ax.text(-.52, .0, "Dev", color='black', ha='center')
ax.text(.28, -.35, "Ops", color='black', ha='center')
ax.text(.28, .3, "Doc", color='black', ha='center')

plt.tight_layout()

# Display the plot
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()