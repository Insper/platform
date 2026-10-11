
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

**Q3.** Which characteristic **best defines FaaS** compared to the other cloud service models?

- A. The provider manages the OS and runtime
- B. Applications are deployed as Docker containers
- C. Multi-tenancy isolates customer data by tenant ID
- D. The unit of deployment is a single function that scales to zero when idle and is billed per invocation plus execution duration

??? success "Answer"
    **D — A function as the unit of deployment, scale to zero, billed per invocation + duration.**

    PaaS also manages the OS and runtime (A), CaaS deploys containers (B), and multi-tenancy is the SaaS hallmark (C). Scaling to zero is no longer *exclusive* to FaaS — serverless container platforms such as Google Cloud Run and Azure Container Apps also scale to zero — but the combination "deploy a function, pay per invocation and per millisecond" is what defines FaaS. A classic PaaS keeps at least one instance running and bills for it even at idle. The trade-off is cold-start latency and a maximum execution time (15 min on AWS Lambda).

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

    FaaS suffers from *cold starts* — the platform must initialise a new function instance when there is no warm instance available. For sporadic or bursty workloads (webhooks, scheduled jobs) this is acceptable. For a high-traffic API requiring sub-100 ms P99 latency, an always-warm PaaS or CaaS deployment is more appropriate. Lambda's *provisioned concurrency* can keep instances warm, but then you pay for idle capacity and lose the main FaaS cost advantage.

---

**Q9.** A company runs a custom machine learning training pipeline that needs **GPU instances** and a **specific Linux kernel version**. Which cloud model fits best?

- A. SaaS — subscribe to an off-the-shelf ML product
- B. PaaS — the provider will configure the GPU and kernel automatically
- C. FaaS — GPU-accelerated functions are ideal for ML workloads
- D. IaaS — provides raw GPU VMs with full OS control, including kernel selection

??? success "Answer"
    **D — IaaS.**

    When the workload requires a specific OS kernel, custom drivers, or specialised hardware control, only IaaS gives the necessary level of access. PaaS abstracts the OS away; SaaS won't let you bring custom kernels; FaaS doesn't expose GPU hardware at all (in most implementations). Managed ML platforms such as AWS SageMaker can provide GPUs, but they choose the OS and kernel for you.

---

**Q10.** Which model best describes **Google Kubernetes Engine (GKE)** or **Amazon EKS**?

- A. IaaS — raw VMs are provided and the customer manages everything
- B. PaaS — the customer just deploys code, no containers needed
- C. CaaS with Kubernetes — the provider manages the control plane; the customer manages worker nodes and workloads
- D. SaaS — Kubernetes is fully managed with no customer responsibility

??? success "Answer"
    **C — CaaS with managed Kubernetes control plane.**

    GKE and EKS manage the Kubernetes control plane (API server, scheduler, etcd). In the classic mode the customer provisions and manages worker nodes (or uses managed node groups); modes such as GKE Autopilot and EKS Auto Mode hand node management to the provider too. In every mode the customer is responsible for deploying and configuring workloads, network policies, access control, and triggering cluster version upgrades. This is CaaS — a step above IaaS, a step below full PaaS.

---

**Q11.** Which of the following is **not** one of the five essential characteristics of cloud computing in the NIST definition (SP 800-145)?

- A. On-demand self-service
- B. Rapid elasticity
- C. Measured service
- D. A guaranteed 99.99% availability SLA

??? success "Answer"
    **D — An availability SLA is not part of the definition.**

    NIST defines cloud computing by five characteristics: on-demand self-service, broad network access, resource pooling, rapid elasticity, and measured service. SLAs are contractual terms that individual providers offer per service (and they vary widely); a service can be "cloud" without a 99.99% SLA. Conversely, a server rented on a three-year contract with a strong SLA is not cloud if you cannot provision it yourself and pay per use.

---

**Q12.** A company replaces its own datacentre servers (bought every 5 years) with EC2 instances billed per second. How does this change the **cost model**?

- A. From OpEx to CapEx: the company now owns the instances
- B. From CapEx to OpEx: no up-front purchase sized for the expected peak; the company pays monthly for what it uses
- C. Nothing changes: both are capital expenditure
- D. From CapEx to OpEx, which guarantees a lower total cost for every workload

??? success "Answer"
    **B — From CapEx to OpEx.**

    Buying servers is capital expenditure: a large up-front payment for an asset sized for the peak you *expect*. Cloud resources are operational expenditure: you pay for what you use and can stop paying when you stop using it. D is the trap — OpEx removes the up-front bet but is not automatically cheaper; a workload running at full load 24/7 for years can cost more in the cloud than on owned hardware.

---

**Q13.** A team runs the store's order service on EKS and stores invoices in an S3 bucket. Someone sets the bucket to **public**, and the invoices leak. Under the shared responsibility model, whose responsibility was this?

- A. AWS — S3 is a managed service, so its security is the provider's job
- B. AWS — the provider should block every public bucket automatically
- C. The customer — access configuration of the data is "security *in* the cloud", which always stays with the customer
- D. Nobody — public buckets are a known limitation of object storage

??? success "Answer"
    **C — The customer.**

    AWS is responsible for security *of* the cloud: the datacentres, the hardware, the hypervisor and the S3 service itself. The customer is responsible for security *in* the cloud: who can read the data, IAM policies, bucket policies, encryption settings. Managed services move operational layers to the provider, but deciding who may access your data never moves.

---

**Q14.** The store's Postgres currently runs on an EC2 VM that the team installed by hand. They move it to **Amazon RDS**. Which statement describes what changed?

- A. Nothing changes operationally — RDS is just Postgres on a VM with a different name
- B. The team now manages the OS, but no longer the schema
- C. Backups, replication, failover and OS/database patching become provider-managed configuration; the team still owns the schema, queries, access rules and the data
- D. The team can no longer connect with a standard Postgres client or JDBC driver

??? success "Answer"
    **C — The database moved from IaaS to DBaaS.**

    On EC2 the team installs Postgres, patches the OS, writes backup scripts and handles failover. With RDS those become settings (backup retention, Multi-AZ, maintenance window) that AWS executes. The application still connects with the same JDBC URL format and driver, and the team still owns schema design, query tuning, and who may connect (security groups, database users).
