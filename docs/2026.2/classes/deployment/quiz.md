
Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** A 3-person startup with 5 microservices needs to go live this week. Which deployment option has the **shortest time-to-live**?

- A. AWS EKS — production-grade from day one
- B. Railway or Fly.io — connect GitHub, push, done
- C. AWS ECS Fargate — container-native, scales to zero
- D. AWS Lightsail — simplest AWS option

??? success "Answer"
    **B — Railway or Fly.io.**

    Railway and Fly.io can deploy a Dockerized Spring Boot application in minutes with zero infrastructure configuration. EKS requires days of setup (VPC, node groups, IAM roles, add-ons, ingress controllers); ECS Fargate still requires VPC, IAM task roles, ALB, and ECR configuration; Lightsail is simple but manual container service setup still takes hours, not minutes. When time-to-live is the constraint, PaaS wins every time.

---

**Q2.** What is the main **operational difference** between ECS Fargate and EKS for a team of 10 developers?

- A. ECS Fargate requires managing EC2 node groups; EKS does not
- B. ECS Fargate is serverless — no nodes to manage; EKS requires managing node groups, networking add-ons, and the full Kubernetes API surface
- C. EKS is cheaper at 10 services because the control plane is shared across workloads
- D. ECS Fargate supports GitOps via ArgoCD natively; EKS does not

??? success "Answer"
    **B — ECS Fargate is serverless; EKS requires managing node groups and the full K8s API surface.**

    With ECS Fargate, AWS provisions and patches the underlying compute — you define a task (CPU, memory, container image, env vars) and AWS runs it. With EKS, you pay for the control plane ($72/month) and manage node groups yourself: instance types, AMI updates, node draining during upgrades, and all Kubernetes add-ons. At 10 developers, the ECS operational simplicity typically outweighs the loss of the Kubernetes ecosystem.

---

**Q3.** The EKS control plane alone costs $72/month. A student's 3-service project should use EKS. **True or false — and why?**

- A. True — EKS is the industry standard and every project should use it for resume value
- B. True — EKS scales to zero so it is cost-effective for small projects
- C. False — EKS costs $72/month for the control plane alone, plus $50–100+/month for node groups, totalling more than the entire cost of running 3 services on Railway or Fly.io
- D. False — EKS is only available to enterprise AWS accounts

??? success "Answer"
    **C — False. EKS control plane + minimum node group exceeds the total cost of simpler alternatives.**

    The EKS control plane is $0.10/hour — $72/month — before a single container runs. A minimum viable node group (1× `t3.medium`) adds another $30–50/month. For a 3-service student project, you would spend $120–150/month minimum compared to $5–25/month on Railway. Beyond cost, EKS requires significant operational knowledge (IAM roles for service accounts, VPC CNI networking, ingress controller setup) that distracts from learning the application-level concepts the course targets.

---

**Q4.** What is **K3s** and when would you choose it over AWS EKS?

- A. K3s is a Kubernetes dashboard; choose it when you need better visibility into EKS clusters
- B. K3s is a lightweight Kubernetes distribution (< 100 MB binary) that implements the same API as upstream K8s; choose it for on-premises deployments, edge devices, or cost-sensitive environments where cloud-managed control planes are not an option
- C. K3s is a managed Kubernetes service from Rancher, competing directly with EKS on AWS infrastructure
- D. K3s is a Kubernetes version that removes CRD support to reduce complexity

??? success "Answer"
    **B — K3s is a lightweight, full-API-compatible Kubernetes distribution for on-prem, edge, or cost-sensitive deployments.**

    K3s runs the complete Kubernetes API in a binary under 100 MB, replacing etcd with SQLite by default and stripping out cloud-provider integrations. You would choose K3s over EKS when you need Kubernetes on bare-metal servers (a university data center, a factory floor, a Raspberry Pi cluster), when internet connectivity is unreliable, or when the $72/month EKS control plane fee is unjustifiable. The trade-off is that you own all operations — upgrades, backups, and HA setup — with no AWS managed support.

---

**Q5.** AWS App Runner vs AWS ECS Fargate: both run containers without managing EC2. What does ECS Fargate give you that App Runner **does not**?

- A. App Runner only runs Java applications; ECS Fargate runs any container
- B. ECS Fargate supports private VPC networking, fine-grained service-to-service routing via service discovery, stateful workloads, and integration with the full ECS task definition API — App Runner is intentionally constrained to stateless, single-container workloads
- C. ECS Fargate provides a built-in git-to-deployment pipeline; App Runner requires manual image pushes
- D. ECS Fargate auto-scales to zero; App Runner does not

??? success "Answer"
    **B — ECS Fargate provides full VPC integration, service-to-service networking, and support for stateful workload patterns that App Runner abstracts away.**

    App Runner trades control for simplicity: you cannot configure task placement, sidecar containers, ECS service discovery namespaces, or custom networking beyond the VPC Connector add-on. ECS Fargate lets you define multi-container task definitions (application + sidecar log shipper), attach EFS volumes for stateful workloads, use AWS Cloud Map for service discovery, and integrate deeply with ALB target groups and path-based routing. For complex microservice meshes, ECS Fargate is significantly more capable than App Runner.

---

**Q6.** A service deployed on Fly.io in the São Paulo region (`gru`) serves users in Europe. What Fly.io capability can reduce latency for European users?

- A. Fly.io automatically caches all API responses globally — no configuration needed
- B. You can deploy the same container to additional Fly.io regions (e.g., `lhr` for London, `ams` for Amsterdam) with a single flag, and Fly's Anycast routing directs each user to the nearest region
- C. Fly.io uses CloudFront to serve responses from European edge nodes automatically
- D. Fly.io compresses all responses before transmitting, reducing effective latency

??? success "Answer"
    **B — Deploy to additional regions; Fly.io's Anycast routing directs users to the nearest instance.**

    Fly.io assigns each application an Anycast IP address. When a European user connects, their request is routed by BGP to the nearest Fly edge node that runs your container — typically `lhr` (London) or `ams` (Amsterdam). Adding a region is as simple as `fly regions add lhr`. The trade-off: stateless services scale globally with zero effort, but stateful services (databases, sessions) require deliberate replication or global consistency strategies — Fly's own Postgres offering helps but is more operationally complex than RDS.

---

**Q7.** Why does connecting an App Runner service to an RDS database require **extra configuration** (VPC Connector)?

- A. RDS does not support connections from containers — only EC2 instances can connect to RDS
- B. App Runner services run in an AWS-managed VPC that is isolated from customer VPCs; a VPC Connector is required to attach the App Runner service to a subnet in your own VPC so it can reach resources like RDS that are not publicly accessible
- C. AWS charges extra for App Runner-to-RDS connections and the VPC Connector enables billing
- D. App Runner uses IPv6 by default and RDS only supports IPv4, so the VPC Connector performs translation

??? success "Answer"
    **B — App Runner runs in an AWS-managed VPC, isolated from your customer VPC where RDS lives.**

    By default, an App Runner service can reach the public internet but cannot reach private resources in your AWS account's VPC — there is no network path between the AWS-managed App Runner VPC and your VPC. A VPC Connector is an ENI (Elastic Network Interface) configuration that attaches your App Runner service to subnets in your own VPC, giving it a private IP address within your network. Once configured, the service can reach RDS, ElastiCache, or any other resource in your VPC via private IP without any traffic leaving the AWS backbone.

---

**Q8.** A team is growing from 5 to 25 engineers and from 8 to 40 microservices. Currently on Railway. What is the **most important factor** deciding whether to migrate to ECS Fargate or EKS?

- A. The number of microservices — ECS handles up to 30, EKS handles more
- B. Whether the team has (or plans to hire) a dedicated platform or DevOps engineer who can own Kubernetes operations — ECS Fargate is the right answer without one, EKS becomes viable with one
- C. The programming language — EKS is required for Java services, ECS for Node.js
- D. Monthly budget — ECS Fargate is always cheaper than EKS regardless of scale

??? success "Answer"
    **B — The presence of a dedicated platform engineer is the decisive factor.**

    At 40 microservices, both ECS Fargate and EKS are technically capable. The real question is operational ownership. EKS requires someone who understands Kubernetes networking (CNI, services, ingress), manages node group upgrades, configures RBAC, installs and maintains add-ons (Karpenter, ArgoCD, external-secrets-operator), and responds to cluster incidents. Without a dedicated platform engineer, these tasks fall on feature developers, slowing product delivery. ECS Fargate delivers roughly 80% of EKS's capabilities at 40% of the cost and operational burden — and is the right answer for most teams at this scale unless GitOps, multi-tenancy, or cross-cloud portability are hard requirements.
