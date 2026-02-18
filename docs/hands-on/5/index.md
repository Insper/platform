
## What is an Orchestrator?
An orchestrator is a system that automates the deployment, management, scaling, and operation of containerized applications. Containers package an application with its dependencies, making it portable across environments. Orchestrators handle critical tasks such as:

- **Scheduling**: Placing containers on appropriate servers.
- **Scaling**: Adding or removing containers based on demand.
- **Networking**: Managing communication between containers.
- **Self-healing**: Restarting failed containers or redistributing workloads.
- **Service discovery**: Enabling containers to find and communicate with each other.

By abstracting infrastructure complexities, orchestrators ensure applications run reliably and efficiently, especially in large-scale, distributed systems. They are essential for enterprises managing hundreds or thousands of containers across multiple hosts, supporting cloud-native development and microservices architectures [Container Orchestration - Red Hat](https://www.redhat.com/en/topics/containers/what-is-container-orchestration){:target="_blank"}.

Orchestrators like Kubernetes, Docker Swarm, and Apache Mesos provide these capabilities, each with unique features and complexities. Kubernetes is the most widely adopted orchestrator, known for its robust ecosystem and community support.

## Difference Between Docker Compose and Kubernetes
Docker Compose and Kubernetes (K8s) both manage containerized applications but serve different purposes, with distinct scopes, complexities, and use cases:

### Docker Compose
- **Purpose**: Designed for single-host environments, ideal for development, testing, or small-scale production.
- **Configuration**: Uses a YAML file to define multi-container applications, specifying services, networks, and volumes.
- **Features**: Simplifies container networking and dependency management on one machine. Supports basic restart policies but lacks advanced features like auto-scaling or cluster management.
- **Ease of Use**: Simple to set up with a lower learning curve, making it accessible for developers.
- **Use Case**: Best for local development (e.g., running a web app with a database) or simple production setups where scalability isn’t a priority.

### Kubernetes
- **Purpose**: Built for orchestrating containers across a cluster of multiple nodes, suited for production-grade, distributed systems.
- **Configuration**: Uses declarative YAML/JSON files to define desired states, with controllers ensuring the system matches the configuration.
- **Features**: Offers auto-scaling, load balancing, rolling updates, self-healing, service discovery, and storage orchestration.
- **Complexity**: More complex, requiring knowledge of concepts like pods, services, and deployments.
- **Use Case**: Ideal for cloud-native applications needing high availability, scalability, and resilience across multiple servers.

### Key Differences
| Aspect            | Docker Compose                     | Kubernetes                        |
|-------------------|------------------------------------|-----------------------------------|
| **Scope**         | Single-host                       | Multi-host, cluster-based         |
| **Scalability**   | No auto-scaling                   | Dynamic auto-scaling              |
| **Complexity**    | Simple, low learning curve        | Complex, steeper learning curve   |
| **Use Case**      | Local dev, testing, small prod    | Large-scale, production systems   |

Tools like Kompose can help migrate Docker Compose files to Kubernetes, easing the transition for growing applications [Docker Compose vs Kubernetes - Spacelift](https://spacelift.io/blog/docker-compose-vs-kubernetes).

## Alternatives to Kubernetes
Kubernetes is the leading container orchestration platform, but its complexity and resource demands may not suit every scenario. Alternatives exist for different environments—on-premise, cloud, and local—offering simpler, cloud-specific, or lightweight solutions. Below is a table summarizing popular alternatives with examples:

| **Environment** | **Alternative** | **Description** | **Examples** |
|-----------------|-----------------|-----------------|-----------------|
| **On-Premise** | Nomad | A lightweight orchestrator by HashiCorp, supporting containers and non-containerized workloads. Easier to set up than Kubernetes, ideal for smaller teams. | Deploying Nomad on bare-metal servers in a data center for a microservices application. |
|                | Apache Mesos | An open-source distributed systems kernel for container orchestration, suitable for large-scale, custom workloads. | Running Mesos on on-premise infrastructure to manage a big data processing pipeline. |
|                | OpenShift | A Kubernetes-based platform by Red Hat with added developer and enterprise tools, supporting hybrid cloud setups. | Installing OpenShift on enterprise hardware for a hybrid cloud e-commerce platform. |
| **Cloud**      | Amazon ECS | AWS’s managed container orchestration service, tightly integrated with AWS services like EC2 and Fargate. | Using ECS on AWS to deploy a web application with auto-scaling on EC2 instances. |
|                | Google Cloud Run | A serverless platform for running stateless containers, abstracting infrastructure management. | Deploying a REST API on Google Cloud with automatic scaling for traffic spikes. |
|                | AWS Fargate | Serverless compute for containers, compatible with ECS and EKS, eliminating server management. | Running a containerized analytics service on AWS without managing servers. |
|                | Azure Container Instances | Microsoft Azure’s serverless container service for simple, isolated container deployments. | Deploying a batch processing job on Azure without managing infrastructure. |
|                | Google Kubernetes Engine (GKE) | Managed Kubernetes service by Google Cloud, simplifying cluster management. | Running a machine learning workload on Google Cloud with GKE’s managed control plane. |
|                | Amazon EKS | Managed Kubernetes service by AWS, integrating with AWS ecosystem. | Deploying a scalable web app on AWS using EKS with managed control plane. |
| **Local**      | Docker Compose | A tool for defining and running multi-container applications on a single machine, ideal for development. | Running a local dev environment with a web app, database, and cache using Docker Compose. |
|                | Minikube | A tool to run a single-node Kubernetes cluster locally for development and testing. | Testing Kubernetes deployments on a developer’s laptop with Minikube. |
|                | Docker Swarm | Docker’s native orchestration tool, simpler than Kubernetes, for managing containers across multiple hosts. | Setting up a small local cluster for testing a containerized app with Docker Swarm. |
|                | Kind | A tool for running Kubernetes clusters in Docker containers, useful for testing Kubernetes itself. | Running a local Kubernetes cluster for testing and development with Kind. |
|                | Rancher Desktop | A desktop application for managing Kubernetes clusters, providing a user-friendly interface. | Managing local Kubernetes clusters with Rancher Desktop for development. |
|                | MicroK8s | A lightweight, single-package Kubernetes distribution for local development. | Running a local Kubernetes cluster with MicroK8s for testing and development. |
|                | k3s | A lightweight Kubernetes distribution designed for resource-constrained environments. | Running a small-scale Kubernetes cluster on IoT devices or edge computing. |

### Notes on Alternatives
- **Nomad** and **Docker Swarm** prioritize simplicity, making them suitable for teams with limited resources or simpler workloads [Kubernetes Alternatives - Wiz](https://www.wiz.io/academy/kubernetes-alternatives){:target="_blank"}.
- **OpenShift** enhances Kubernetes with enterprise features but increases complexity, best for organizations needing robust tooling.
- **Cloud-native options** like Amazon ECS, Google Cloud Run, and AWS Fargate reduce management overhead but tie users to specific cloud providers, limiting portability.
- **Local tools** like Minikube and Docker Compose are not production-ready but excel in development and learning environments.
- **Managed Kubernetes services** (GKE, EKS) simplify Kubernetes operations but still require Kubernetes expertise, making them less of a true alternative for those avoiding K8s complexity.

Choosing the right tool depends on factors like workload scale, team expertise, infrastructure constraints, and whether portability across clouds is needed. For small projects, Docker Compose or Nomad may suffice, while large, distributed systems often benefit from Kubernetes or cloud-native solutions like ECS.

---

## Kubernetes

Kubernetes is an open-source container orchestration platform that automates the deployment, scaling, and management of containerized applications. It provides a robust framework for running distributed systems resiliently, allowing you to manage clusters of hosts running Linux containers. A `cluster` is a set of machines (physical or virtual) that run Kubernetes and can be managed as a single entity. To manage these clusters, Kubernetes uses a set of APIs and a control plane to manage the state of the cluster.

``` mermaid
flowchart TD
    Deployment:::orange -->|defines| ReplicaSet
    ReplicaSet -->|manages| pod((Pod))
    pod:::red -->|runs| Container
    Deployment -->|scales| pod
    Deployment -->|updates| pod

    Service:::orange -->|exposes| pod

    subgraph  
        ConfigMap:::orange
        Secret:::orange
    end

    ConfigMap --> Deployment
    Secret --> Deployment
    classDef red fill:#f55
    classDef orange fill:#ffa500
```

- **Deployment**: This is like the manager for your application, deciding how many copies (replicas) should run and updating them when needed.

- **ReplicaSet**: It ensures the right number of Pods (the actual running containers) are always available, creating or deleting them as necessary.

- **Pod**: The smallest unit, where your application actually runs, often containing one or more containers.

- **Container**: The actual application running inside the Pod, isolated from others.

- **Service**: This is like a load balancer, directing traffic to the right Pods based on rules you set. A Service allows you to expose your application to the outside world or to other applications within the cluster. The exposed service can be of different types:

    | Types of Services | Description |
    |------------------|-------------|
    | **ClusterIP** | The default type, which exposes the service on a cluster-internal IP. This means that the service is only reachable from within the cluster. |
    | **NodePort** | Exposes the service on each node's IP at a static port. This allows you to access the service from outside the cluster using `<NodeIP>:<NodePort>`. |
    | **LoadBalancer** | Creates an external load balancer in supported cloud providers, routing traffic to your service. |

- **ConfigMap**: A way to pass configuration data to your application without hardcoding it into the container.

- **Secret**: Similar to ConfigMap, but used for sensitive information like passwords or API keys, ensuring they are stored securely.

!!! tip "Example on the Postgres Service"

    ``` { .tree }
    postgres-service
        k8s
            secrets.yaml
            configmap.yaml
            deployment.yaml
            service.yaml
    ```

    === "secrets.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/Insper/platform/refs/heads/main/docs/checkpoints/5/k8s/secrets.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/secrets.yaml
        kubectl get secrets
        ```

    === "configmap.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/Insper/platform/refs/heads/main/docs/checkpoints/5/k8s/configmap.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/configmap.yaml
        kubectl get configmap
        ```

    === "deployment.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/Insper/platform/refs/heads/main/docs/checkpoints/5/k8s/deployment.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/deployment.yaml
        kubectl get deployments
        kubectl get pods
        ```

    === "service.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/Insper/platform/refs/heads/main/docs/checkpoints/5/k8s/service.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/service.yaml
        kubectl get services
        ```

!!! tip "Example on the Gateway Service"

    ``` { .tree }
    gateway-service
        k8s
            k8s.yaml
    ```

    === "k8s.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/hsandmann/insper.store.gateway-service/refs/heads/main/k8s/k8s.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/k8s.yaml
        kubectl get deployments
        kubectl get pods
        kubectl get services
        ```

        ```{ .bash .select }
        NAME         TYPE           CLUSTER-IP     EXTERNAL-IP                                                              PORT(S)        AGE
        gateway      LoadBalancer   10.100.59.61   aac9dbab7421e4ec0a1b19472728b793-834724138.us-east-2.elb.amazonaws.com   80:31973/TCP   34m
        kubernetes   ClusterIP      10.100.0.1     <none>                                                                   443/TCP        5d5h
        ```

        In a browser, you can access the gateway service using the external IP address:

        ``` {.bash .copy .select }
        http://aac9dbab7421e4ec0a1b19472728b793-834724138.us-east-2.elb.amazonaws.com/info # (1)!
        ```

        1. Note that it is a HTTP request, not HTTPS. If you want to use HTTPS, you need to set up TLS certificates and configure the Ingress resource accordingly.

        Another way to expose the API is to use the `Ingress` resource, which allows you to define rules for routing external HTTP/S traffic to your services. This is particularly useful for managing multiple services under a single domain or subdomain. See the [Ingress documentation](https://kubernetes.io/docs/concepts/services-networking/ingress/){target="_blank"} for more details.



!!! tip "Horizontal Pod Autoscaler"

    The Horizontal Pod Autoscaler (HPA) automatically scales the number of pods in a deployment or replica set based on observed CPU utilization or other select metrics. It adjusts the number of replicas dynamically to ensure that the application can handle varying loads without manual intervention.
    To set up HPA, you need to define the target CPU utilization and the minimum and maximum number of replicas. The HPA controller continuously monitors the metrics and adjusts the number of replicas accordingly.

    Check the documentation for more details on how to set up HPA: [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) and [HorizontalPodAutoscaler Walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/){:target="_blank"}.


---

## Kubeclt

Kubernetes is a powerful container orchestration platform, and `kubectl` is its command-line tool for managing Kubernetes clusters. Below are some common commands and their descriptions to help you get started with `kubectl`.

To install `kubectl`, follow the instructions in the [Kubernetes documentation](https://kubernetes.io/docs/tasks/tools/install-kubectl/){:target="_blank"}. To check if `kubectl` is installed correctly, run:

``` {.bash .copy .select }
kubectl version --client
```

### Kubectl Cheat Sheet
| Command | Description |
|---------|-------------|
| `kubectl get all` | List all resources in the current namespace. |
| `kubectl get pods` | List all pods in the current namespace. |
| `kubectl get pod <pod-name> -o wide` | Get detailed information about a specific pod. |
| `kubectl get services` | List all services in the current namespace. |
| `kubectl get deployments` | List all deployments in the current namespace. |
| `kubectl describe pod <pod-name>` | Show detailed information about a specific pod. |
| `kubectl logs <pod-name>` | View logs for a specific pod. |
| `kubectl exec -it <pod-name> -- bash` | Open a shell in a running pod. |
| `kubectl apply -f <file.yaml>` | Apply a configuration file to create/update resources. |
| `kubectl delete pod <pod-name>` | Delete a specific pod. |
| `kubectl delete deployment <deployment-name>` | Delete a specific deployment. |
| `kubectl scale deployment <deployment-name> --replicas=<number>` | Scale a deployment to a specified number of replicas. |
| `kubectl port-forward <pod-name> <local-port>:<pod-port>` | Forward a local port to a port on a pod. |
| `kubectl get nodes` | List all nodes in the cluster. |
| `kubectl get namespaces` | List all namespaces in the cluster. |
| `kubectl get configmaps` | List all config maps in the current namespace. |
| `kubectl get secrets` | List all secrets in the current namespace. |
| `kubectl get ingress` | List all ingress resources in the current namespace. |
| `kubectl autoscale deployment <deployment-name> --cpu-percent=<target-percentage> --min=<min-replicas> --max=<max-replicas>` | Create or update a Horizontal Pod Autoscaler for a deployment. |
| `kubectl get hpa` | List all Horizontal Pod Autoscalers in the current namespace. |
| `kubectl delete hpa <hpa-name>` | Delete a specific Horizontal Pod Autoscaler. |
| `kubectl delete --all` | Delete all resources in the current namespace. |

## Minikube

Minikube is a tool that makes it easy to run Kubernetes locally. It creates a single-node Kubernetes cluster on your machine, allowing you to test and develop applications in a Kubernetes environment without needing a full cloud setup.

To install Minikube, follow the instructions in the [Minikube documentation](https://minikube.sigs.k8s.io/docs/start/){:target="_blank"}.

### Minikube Cheat Sheet

| Command | Description |
|---------|-------------|
| `minikube start --driver=<driver> --profile=<profile>` | Start a Minikube cluster with a specified driver and profile. |
| `minikube profile list` | List all Minikube profiles. |
| `minikube stop --all` | Stop all Minikube clusters. |
| `minikube status` | Check the status of the Minikube cluster. |
| `minikube dashboard` | Open the Kubernetes dashboard in your web browser. |
| `minikube ssh` | SSH into the Minikube VM. |
| `minikube delete` | Delete the Minikube cluster. |
| `minikube delete --all --purge` | Delete all Minikube clusters and remove their configurations. |


[^1]: [What is Container Orchestration? - Red Hat](https://www.redhat.com/en/topics/containers/what-is-container-orchestration){:target="_blank"}
[^2]: [Docker Compose vs Kubernetes - Differences Explained - Spacelift](https://spacelift.io/blog/docker-compose-vs-kubernetes){:target="_blank"}
[^3]: [Kubernetes Alternatives for Container Orchestration - Wiz](https://www.wiz.io/academy/kubernetes-alternatives){:target="_blank"}
[^4]: [Kubernetes Cheat Sheet - Kubernetes](https://kubernetes.io/docs/reference/kubectl/cheatsheet/){:target="_blank"}
[^5]: [Minikube Cheat Sheet - Minikube](https://minikube.sigs.k8s.io/docs/commands/){:target="_blank"}
[^6]: [Horizontal Pod Autoscaling - Kubernetes](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/){:target="_blank"}
[^7]: [HorizontalPodAutoscaler Walkthrough - Kubernetes](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/){:target="_blank"}
[^8]: [Kubernetes Architecture - Kubernetes](https://kubernetes.io/docs/concepts/overview/components/){:target="_blank"}
