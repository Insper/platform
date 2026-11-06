import matplotlib.pyplot as plt
from io import StringIO

fig, ax = plt.subplots(1, 2, figsize=(10, 5))

ax[0].pie(
    [15, 15, 10, 15, 15, 20, 10],
    labels=["Product", "Order", "Exchange", "DevOps", "Orchestration", "Bootnecks", "Documentation"],
    colors=["mediumturquoise", "lightseagreen", "turquoise", "aquamarine", "mediumaquamarine", "mediumspringgreen", "springgreen"],
    autopct='%1.0f%%',
    startangle=90)
ax[0].title.set_text("Individual")

ax[1].pie(
    [5, 15, 20, 10, 15, 15, 20],
    labels=["AWS", "EKS", "Tests", "CI/CD", "Costs", "PaaS", "Presentation"],
    colors=["powderblue", "lightblue", "deepskyblue", "skyblue", "lightskyblue", "steelblue", "dodgerblue"],
    autopct='%1.0f%%',
    startangle=90)
ax[1].title.set_text("Team")

plt.tight_layout()

# Display the plot
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()