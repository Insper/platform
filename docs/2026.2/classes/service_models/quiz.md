
Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** In the shared responsibility model, what does the **customer** manage in IaaS that the **provider** manages in PaaS?

- A. Physical hardware, power, and cooling
- B. Hypervisor and host operating system
- C. The guest OS, runtime environment, and middleware — in IaaS the customer installs and patches these; in PaaS the provider handles them
- D. User accounts and the data entered into the application

??? success "Answer"
    **C — Guest OS, runtime, and middleware.**

    IaaS hands you a virtual machine with a fresh OS. You install Java, configure nginx, patch the OS, and manage everything above the hypervisor. PaaS abstracts all of that — you push code, the platform installs and manages the runtime.

---

**Q2.** A team wants to deploy Docker images to the cloud **without managing Kubernetes themselves**. Which service model fits best?

- A. IaaS — they need a VM to run the Docker daemon
- B. PaaS — platforms detect Docker images automatically via buildpacks
- C. CaaS (Container as a Service) — e.g., AWS ECS Fargate or Google Cloud Run
- D. SaaS — the cloud provider manages the entire application

??? success "Answer"
    **C — CaaS.**

    CaaS sits between IaaS and PaaS. The customer provides a Docker image; the platform handles scheduling, networking, scaling, and node health. AWS Fargate and Google Cloud Run are canonical examples — no cluster to manage, but full control over what runs inside the container.

---

**Q3.** Which characteristic is **unique to FaaS** compared to all other cloud service models?

- A. The provider manages the OS and runtime
- B. Applications are deployed as Docker containers
- C. Multi-tenancy isolates customer data by tenant ID
- D. The platform scales to zero when idle and bills per invocation plus execution duration in milliseconds

??? success "Answer"
    **D — Scales to zero; billed per invocation + milliseconds.**

    No other model scales to zero automatically. PaaS runs continuously (even at idle, you pay for the minimum instance). FaaS only incurs cost when the function actually executes. The trade-off is cold-start latency and a maximum execution time (e.g., 15 min on AWS Lambda).

---

**Q4.** Which of the following are examples of **SaaS**? Select the most accurate group.

- A. AWS EC2, Google Compute Engine, Azure VMs
- B. Heroku, AWS Elastic Beanstalk, Google App Engine
- C. GitHub, Slack, Datadog, Salesforce
- D. AWS ECS Fargate, Google Cloud Run, Azure Container Instances

??? success "Answer"
    **C — GitHub, Slack, Datadog, Salesforce.**

    SaaS provides fully managed software — the customer manages only users, permissions, and data. GitHub (source control), Slack (messaging), Datadog (monitoring), and Salesforce (CRM) are all SaaS. The other options are IaaS (A), PaaS (B), and CaaS (D).

---

**Q5.** A startup wants to ship a REST API backend quickly, with **no infrastructure expertise** on the team. Which model minimises time-to-market while retaining full application control?

- A. IaaS — full control over the entire stack
- B. PaaS — the provider manages hardware through runtime; the team deploys code and manages only application and data
- C. SaaS — the fastest option, zero setup
- D. On-premises — avoid cloud costs entirely

??? success "Answer"
    **B — PaaS.**

    PaaS is the sweet spot for teams that want to ship fast without becoming infrastructure engineers. Push code, configure environment variables, scale with a slider. The team retains full control over the application and data but never touches OS patches, runtime upgrades, or load balancer configuration.

---

**Q6.** How does **DBaaS** (Database as a Service) differ from self-managed databases on IaaS?

- A. DBaaS only supports NoSQL; IaaS supports any database engine
- B. DBaaS databases cannot be queried with standard SQL clients
- C. The provider manages replication, backups, failover, and OS patching; the customer manages only schema design, query tuning, and access control
- D. DBaaS databases are always shared between tenants with no isolation

??? success "Answer"
    **C — Provider manages replication, backups, failover, OS; customer manages schema and access.**

    Running PostgreSQL on EC2 means you install it, configure streaming replication, schedule backups, patch the OS, and respond to hardware failures. With AWS RDS or Cloud SQL, all of that is automated — you connect with a standard client and focus on queries and schema design.

---

**Q7.** Which statement best describes the **trade-off** between IaaS and SaaS in terms of control vs time-to-value?

- A. IaaS gives maximum control but requires the most time to provision and manage; SaaS is instant but the customer controls only users and data
- B. IaaS and SaaS have similar operational overhead — the only difference is price
- C. SaaS gives more control than IaaS because the provider has experts managing the system
- D. IaaS is always more cost-effective than SaaS for any workload

??? success "Answer"
    **A — IaaS = maximum control, maximum overhead; SaaS = instant, minimal control.**

    This is the fundamental shared responsibility trade-off. Moving from IaaS to PaaS to SaaS progressively shifts operational burden to the provider at the cost of control and portability. The right model depends on whether building and operating the thing is core competency for the team.

---

**Q8.** In the **decision framework**, when is **FaaS** the wrong choice?

- A. When the workload is event-driven
- B. When the function runs for less than 15 minutes
- C. When the application requires consistently low latency on every request and runs at high sustained traffic
- D. When the team wants to avoid managing servers

??? success "Answer"
    **C — Consistently low latency at high sustained traffic.**

    FaaS suffers from *cold starts* — the platform must initialise a new function instance when there is no warm instance available. For sporadic or bursty workloads (webhooks, scheduled jobs) this is acceptable. For a high-traffic API requiring sub-100 ms P99 latency, a always-warm PaaS or CaaS deployment is more appropriate.

---

**Q9.** A company runs a custom machine learning training pipeline that needs **GPU instances** and a **specific Linux kernel version**. Which cloud model fits best?

- A. SaaS — use an existing ML platform like AWS SageMaker
- B. PaaS — the provider will configure the GPU and kernel automatically
- C. FaaS — GPU-accelerated functions are ideal for ML workloads
- D. IaaS — provides raw GPU VMs with full OS control, including kernel selection

??? success "Answer"
    **D — IaaS.**

    When the workload requires a specific OS kernel, custom drivers, or specialised hardware control, only IaaS gives the necessary level of access. PaaS abstracts the OS away; SaaS won't let you bring custom kernels; FaaS doesn't expose GPU hardware at all (in most implementations).

---

**Q10.** Which model best describes **Google Kubernetes Engine (GKE)** or **Amazon EKS**?

- A. IaaS — raw VMs are provided and the customer manages everything
- B. PaaS — the customer just deploys code, no containers needed
- C. CaaS with Kubernetes — the provider manages the control plane; the customer manages worker nodes and workloads
- D. SaaS — Kubernetes is fully managed with no customer responsibility

??? success "Answer"
    **C — CaaS with managed Kubernetes control plane.**

    GKE and EKS manage the Kubernetes control plane (API server, scheduler, etcd) but the customer provisions and manages worker nodes (or uses managed node groups). The customer is responsible for deploying and configuring workloads, networking policies, and cluster upgrades. This is CaaS — a step above IaaS, a step below full PaaS.
