Click **"Answer"** to reveal the correct answer and explanation.

---

## Orchestration / Kubernetes

**Q1.** What fundamental problem does Kubernetes solve that Docker Compose cannot?

- A. Running containers on a single machine with less memory overhead
- B. Defining multi-container applications in a single YAML file
- C. Orchestrating containers across a cluster of multiple hosts with automatic scheduling, self-healing, auto-scaling, and rolling updates
- D. Building Docker images faster using distributed build caches

??? success "Answer"
    **C — Multi-host orchestration with self-healing and auto-scaling.**

    Docker Compose manages a single machine. Kubernetes spans a cluster of nodes, automatically places containers on healthy nodes, restarts failed containers, scales replicas up and down based on CPU/memory metrics, and performs rolling deployments with zero downtime — none of which Compose supports natively.

---

**Q2.** What is a Kubernetes **Pod**, and how does it differ from a container?

- A. A Pod is a virtual machine; a container is a process within it
- B. A Pod is the smallest deployable unit — one or more containers that share the same network namespace and storage volumes
- C. A Pod is a named group of services sharing the same network; a container is a single service
- D. A Pod is a configuration file; a container is the running instance

??? success "Answer"
    **B — Smallest deployable unit; shared network + storage.**

    Kubernetes never manages containers directly — it manages Pods. A Pod typically contains one container (the application), but may include sidecar containers (log forwarder, service mesh proxy) that share the same `localhost` network and mounted volumes. All containers in a Pod start and stop together.

---

**Q3.** What does a Kubernetes **Service** resource do?

- A. It defines the Docker image and replica count for a deployment
- B. It monitors Pod health and restarts failing containers
- C. It exposes a set of Pods with a stable DNS name and virtual IP, providing load balancing across all matching replicas
- D. It stores secrets and configuration values for the application

??? success "Answer"
    **C — Stable DNS + load balancing across Pod replicas.**

    Pods are ephemeral — they get new IP addresses on every restart. A Service provides a stable `ClusterIP` and DNS name that always routes to healthy Pods matching its label selector. Other services call `account-service:8080` without knowing which Pod (or how many) are behind it.

---

**Q4.** What does `kubectl apply -f k8s.yaml` do, and how is it different from `kubectl create`?

- A. `apply` creates resources; `create` updates them
- B. `apply` is declarative — it creates or updates resources to match the desired state in the file; `create` only creates new resources and fails if they already exist
- C. `apply` validates syntax without applying changes; `create` applies immediately
- D. They are identical — the names are historical aliases

??? success "Answer"
    **B — `apply` is declarative (create or update); `create` only creates.**

    `kubectl apply` is idempotent: run it 10 times with the same file and the cluster state is the same. It creates the resource if it doesn't exist, or patches it if it does. `kubectl create` fails if the resource already exists — suitable for one-time creation, not for continuous delivery.

---

**Q5.** When would you choose **Minikube** over a cloud-managed Kubernetes cluster?

- A. When you need to run workloads across multiple availability zones
- B. When your application requires more than 100 GB of RAM
- C. For local development and testing — Minikube runs a single-node cluster on your laptop with no cloud cost, ideal for learning and validating manifests before production
- D. When regulatory requirements prohibit using cloud providers

??? success "Answer"
    **C — Local development and testing.**

    Minikube creates a fully functional Kubernetes cluster running locally (in a VM or container). You can iterate on Kubernetes manifests, test RBAC policies, and validate deployments without spending cloud money or waiting for CI pipelines. Once manifests work locally, they can be applied to the real cluster.

---
