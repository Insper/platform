
Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** A 3-person startup with 5 microservices needs to go live this week. Which deployment option has the **shortest time-to-live**?

- A. AWS EKS — production-grade from day one
- B. Railway or Fly.io — connect GitHub, push, done
- C. AWS ECS Fargate — container-native, no nodes to manage
- D. AWS Lightsail — simplest AWS option

??? success "Answer"
    **B — Railway or Fly.io.**

    Railway and Fly.io can deploy a Dockerized Spring Boot application in minutes with zero infrastructure configuration. EKS requires days of setup (VPC, node groups, IAM roles, add-ons, ingress controllers); ECS Fargate still requires VPC, IAM task roles, ALB, and ECR configuration; Lightsail is simple but still needs an image pushed to a registry and a manual container service setup. When time-to-live is the constraint, a PaaS that builds straight from the repository wins.

---

**Q2.** What is the main **operational difference** between ECS Fargate and EKS for a team of 10 developers?

- A. ECS Fargate requires managing EC2 node groups; EKS does not
- B. ECS Fargate is serverless — no nodes to manage; EKS requires managing node groups, networking add-ons, and the full Kubernetes API surface
- C. EKS is cheaper at 10 services because the control plane is shared across workloads
- D. ECS Fargate supports GitOps via ArgoCD natively; EKS does not

??? success "Answer"
    **B — ECS Fargate is serverless; EKS requires managing node groups and the full K8s API surface.**

    With ECS Fargate, AWS provisions and patches the underlying compute — you define a task (CPU, memory, container image, env vars) and AWS runs it. With EKS, you pay for the control plane (~$73/month) and manage node groups yourself: instance types, AMI updates, node draining during upgrades, and all Kubernetes add-ons. At 10 developers, the ECS operational simplicity typically outweighs the loss of the Kubernetes ecosystem.

---

**Q3.** The EKS control plane alone costs about $73/month. A student's 3-service project should use EKS. **True or false — and why?**

- A. True — EKS is the industry standard and every project should use it for resume value
- B. True — EKS scales to zero so it is cost-effective for small projects
- C. False — EKS costs ~$73/month for the control plane alone, plus ~$61/month for a minimal node group (2 × `t3.medium`), totalling far more than the entire cost of running 3 services on Railway, Fly.io or Lightsail
- D. False — EKS is only available to enterprise AWS accounts

??? success "Answer"
    **C — False. EKS control plane + minimum node group exceeds the total cost of simpler alternatives.**

    The EKS control plane is $0.10/hour × 730 hours ≈ $73/month before a single container runs. A minimal node group (2 × `t3.medium`) adds about $61/month, and a load balancer and a small RDS database bring the class's cost model to roughly $180/month — against roughly $15–25/month for the same three services on Fly.io, Railway or a Lightsail VM (October 2026 list prices, `us-east-1`). (The course project uses EKS anyway because its goal is to *learn* Kubernetes.) Beyond cost, EKS requires significant operational knowledge (IAM roles for service accounts, VPC CNI networking, ingress controller setup) that distracts from learning the application-level concepts the course targets.

---

**Q4.** What is **K3s** and when would you choose it over AWS EKS?

- A. K3s is a Kubernetes dashboard; choose it when you need better visibility into EKS clusters
- B. K3s is a lightweight Kubernetes distribution (< 100 MB binary) that implements the same API as upstream K8s; choose it for on-premises deployments, edge devices, or cost-sensitive environments where cloud-managed control planes are not an option
- C. K3s is a managed Kubernetes service from Rancher, competing directly with EKS on AWS infrastructure
- D. K3s is a Kubernetes version that removes CRD support to reduce complexity

??? success "Answer"
    **B — K3s is a lightweight, full-API-compatible Kubernetes distribution for on-prem, edge, or cost-sensitive deployments.**

    K3s runs the complete Kubernetes API in a binary under 100 MB, replacing etcd with SQLite by default and stripping out cloud-provider integrations. You would choose K3s over EKS when you need Kubernetes on bare-metal servers (a university data center, a factory floor, a Raspberry Pi cluster), when internet connectivity is unreliable, or when the ~$73/month EKS control plane fee is unjustifiable. The trade-off is that you own all operations — upgrades, backups, and HA setup — with no AWS managed support.

---

**Q5.** In 2026 a student team wants App Runner-style simplicity — "give a container image, get an HTTPS URL" — for the store's order service on AWS. What should they use?

- A. AWS App Runner — it is still the recommended entry point for new AWS accounts
- B. Amazon ECS Express Mode — one call with an image and two IAM roles creates a Fargate service, an ALB with HTTPS, auto scaling and a URL, all as ordinary ECS resources in their account
- C. Amazon EKS — it is the only AWS service that gives an HTTPS URL for a container
- D. AWS Lambda — package the Spring Boot service as a function

??? success "Answer"
    **B — Amazon ECS Express Mode.**

    AWS closed App Runner to new customers on 30 April 2026 (existing customers keep it, without new features) and recommends ECS Express Mode as the replacement. Express Mode has no extra charge — you pay for the Fargate tasks, the load balancer and the other resources it creates — and because everything it creates is visible and editable in your account, the team can later "graduate" to full ECS Fargate without migrating. Unlike App Runner, it does not build from source: the CI pipeline must build and push the image to ECR first.

---

**Q6.** A service deployed on Fly.io in the São Paulo region (`gru`) serves users in Europe. What Fly.io capability can reduce latency for European users?

- A. Fly.io automatically caches all API responses globally — no configuration needed
- B. You can deploy the same container to additional Fly.io regions (e.g., `lhr` for London, `ams` for Amsterdam) with a single flag, and Fly's Anycast routing directs each user to the nearest region
- C. Fly.io uses CloudFront to serve responses from European edge nodes automatically
- D. Fly.io compresses all responses before transmitting, reducing effective latency

??? success "Answer"
    **B — Deploy to additional regions; Fly.io's Anycast routing directs users to the nearest instance.**

    Fly.io assigns each application an Anycast IP address. When a European user connects, their request is routed by BGP to the nearest Fly edge node that runs your container — typically `lhr` (London) or `ams` (Amsterdam). Adding regions is one command, e.g. `fly scale count 3 --region gru,lhr,ams`. The trade-off: stateless services scale globally with zero effort, but stateful services (databases, sessions) require deliberate replication or global consistency strategies — the classic Fly Postgres is an app you operate yourself, and the newer Managed Postgres removes that work at a higher fixed price.

---

**Q7.** The store is deployed on **Lightsail container services**: the gateway has the public endpoint, and it must call the account service and an RDS Postgres database that lives in a normal AWS VPC. Which statement is correct?

- A. Lightsail containers share the AWS default VPC, so both calls work with no configuration
- B. Every Lightsail container service must be public; the gateway calls account through its public URL, and RDS is unreachable from Lightsail
- C. The gateway can reach account through its private domain (`account.service.local`), but reaching RDS in a VPC requires enabling Lightsail VPC peering with the account's default VPC
- D. Lightsail requires an App Runner VPC Connector to reach both account and RDS

??? success "Answer"
    **C — Private domain for Lightsail-to-Lightsail; VPC peering for RDS.**

    Lightsail does not use standard AWS VPC networking. Each container service gets one public endpoint plus a private domain `<service-name>.service.local`, reachable from other Lightsail resources in the same Region — enough for gateway → account. Resources outside Lightsail, such as an RDS instance in a regular VPC, are reachable only after enabling **Lightsail VPC peering** with the default VPC of the Region, a step many tutorials skip. There are no security groups or network policies to fine-tune either, which is one reason teams outgrow Lightsail.

---

**Q8.** A team is growing from 5 to 25 engineers and from 8 to 40 microservices. Currently on Railway. What is the **most important factor** deciding whether to migrate to ECS Fargate or EKS?

- A. The number of microservices — ECS handles up to 30, EKS handles more
- B. Whether the team has (or plans to hire) a dedicated platform or DevOps engineer who can own Kubernetes operations — ECS Fargate is the right answer without one, EKS becomes viable with one
- C. The programming language — EKS is required for Java services, ECS for Node.js
- D. Monthly budget — ECS Fargate is always cheaper than EKS regardless of scale

??? success "Answer"
    **B — The presence of a dedicated platform engineer is the decisive factor.**

    At 40 microservices, both ECS Fargate and EKS are technically capable. The real question is operational ownership. EKS requires someone who understands Kubernetes networking (CNI, services, ingress), manages node group upgrades, configures RBAC, installs and maintains add-ons (Karpenter, ArgoCD, external-secrets-operator), and responds to cluster incidents. Without a dedicated platform engineer, these tasks fall on feature developers, slowing product delivery. ECS Fargate covers most needs of a typical microservice system with no control-plane fee and no nodes to operate — and is the right answer for most teams at this scale unless GitOps, multi-tenancy, or cross-cloud portability are hard requirements.

---

**Q9.** The class's cost model estimates about **$71/month** for the store's three services on ECS Fargate (low configuration). Roughly $30 of that is the Application Load Balancer and $14 is RDS. What does this tell you?

- A. The estimate is wrong — compute is always the largest line of a cloud bill
- B. At small scale, fixed per-hour resources (load balancer, database, NAT gateway, EKS control plane) dominate the bill, and they are charged even with zero traffic
- C. Load balancers are only charged per request, so the $30 disappears when nobody uses the store
- D. Moving the same services to EKS would remove the load balancer cost

??? success "Answer"
    **B — Fixed costs dominate at small scale.**

    Three small Fargate tasks (0.25 vCPU / 0.5 GB) cost about $27/month; the ALB's hourly fee, capacity units and public IPv4 addresses cost about $30, and the smallest RDS instance about $14 — all billed by the hour whether or not requests arrive. EKS would *add* a $73 control plane and still need a load balancer. This is why fixed-fee platforms lose at three services and win at fifty, and why forgotten NAT gateways, load balancers and clusters are the classic surprise on a student's bill.

---

**Q10.** A 4-person team runs 6 services on Railway. Deploys are smooth, the monthly bill is predictable, and no customer has complained about performance. A developer proposes migrating to EKS "because that's what big companies use". What is the best response?

- A. Migrate now — it is cheaper to move before the system grows
- B. Migrate to EKS but keep Railway as a backup
- C. Stay: there is no concrete pain point. Keep the services portable (containers, configuration in environment variables, Postgres) and define the signals that would justify moving — e.g., need for AWS services, compliance, private networking or many teams
- D. Move to raw EC2 VMs to get maximum control

??? success "Answer"
    **C — Stay, and define the migration triggers.**

    Each migration should be driven by a concrete pain point, not by speculation or résumé value. EKS would add a fixed control-plane fee, node operations and Kubernetes expertise the team does not need yet — hours of platform work that ship no feature. Keeping the application 12-factor makes a later move a deployment exercise rather than a rewrite, so waiting costs little.

---

**Q11.** Running **K3s on a single $24/month VM** gives the store the full Kubernetes API for a fraction of the EKS price. What do you give up compared with EKS?

- A. The Kubernetes API — K3s uses its own manifest format
- B. Nothing — K3s on one VM is equivalent to EKS
- C. A managed, highly available control plane: on one VM the control plane is a single point of failure, and upgrades, datastore backups and certificates become your job
- D. The ability to run Spring Boot containers

??? success "Answer"
    **C — The managed, highly available control plane.**

    K3s is a CNCF-certified distribution, so your Deployments, Services and Ingresses work unchanged. What EKS's $0.10/hour buys is a control plane that AWS runs across several Availability Zones, patches and backs up. With K3s on one VM, losing the VM loses the cluster and every workload on it; self-hosting moves the work to you, not just the cost away.
