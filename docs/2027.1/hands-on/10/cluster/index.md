# 1. A Local Cluster

Kubernetes is the same API on a laptop and in a cloud region. This step creates a three-node cluster
inside Docker with **kind** (Kubernetes IN Docker), installs the two add-ons the lab needs — an
**Ingress controller** and **metrics-server** — and loads your BoxOffice images into it.

## Tools

On top of lab 0's `kubectl` and `kind` (or `minikube`), install **Helm**, the package manager most
add-ons are distributed with:

=== "macOS"

    ``` shell
    brew install helm kind kubectl
    ```

=== "Linux / WSL"

    ``` shell
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 | bash
    ```

!!! warning "Free the ports first"

    The cluster publishes the Ingress on port **80** of your machine, the same port as the `edge` of
    [lab 3](../../3/index.md). Stop Compose before creating the cluster (`docker compose down`), and
    give Docker at least 4 CPUs and 8 GB of memory.

## The cluster

One control-plane node and two workers, so that you can see pods spread across nodes and survive the
loss of one. `extraPortMappings` publishes port 30080 of the control-plane container — where the
Ingress controller will listen — as port 80 of your machine.

``` yaml title="k8s/kind.yaml"
--8<-- "docs/2027.1/hands-on/10/code/k8s/kind.yaml"
```

=== "kind"

    <!-- termynal -->

    ``` shell
    > kind create cluster --config k8s/kind.yaml
    Creating cluster "boxoffice" ...
     ✓ Ensuring node image (kindest/node:v1.37.0) 🖼
     ✓ Preparing nodes 📦 📦 📦
     ✓ Starting control-plane 🕹️
     ✓ Joining worker nodes 🚜
    Set kubectl context to "kind-boxoffice"
    > kubectl get nodes
    NAME                      STATUS   ROLES           AGE   VERSION
    boxoffice-control-plane   Ready    control-plane   60s   v1.37.0
    boxoffice-worker          Ready    <none>          40s   v1.37.0
    boxoffice-worker2         Ready    <none>          40s   v1.37.0
    ```

=== "minikube"

    ``` shell
    minikube start --nodes 3 --cpus 2 --memory 4g
    kubectl get nodes
    ```

    With minikube, skip `k8s/kind.yaml`: after installing Traefik below, reach it with
    `minikube service -n traefik traefik --url` (or `minikube tunnel` with `service.type=LoadBalancer`),
    and use that URL wherever this lab says `http://localhost`.

## The Ingress controller: Traefik

An **Ingress** is only a routing rule ("`/catalog` → service `catalog`"); a **controller** reads those
rules and actually proxies the traffic. For years the default choice was ingress-nginx; the Kubernetes
project **retired it in March 2026** (its repository is archived and receives no more fixes), so
this lab uses **Traefik**, a maintained controller that implements both the `Ingress` API and its
successor, the **Gateway API**.

``` shell
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm install traefik traefik/traefik --version 42.0.0 \
  --namespace traefik --create-namespace \
  --set service.type=NodePort \
  --set ports.web.nodePort=30080
```

`ports.web.nodePort=30080` pins the HTTP entry point to the port that `kind.yaml` maps to your
machine's port 80.

## metrics-server

The Horizontal Pod Autoscaler reads CPU usage from the **metrics API**, served by metrics-server. In
kind the kubelets use self-signed certificates, so metrics-server must skip their verification — a
lab-only shortcut:

``` shell
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.9.0/components.yaml
kubectl patch -n kube-system deployment metrics-server --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl top nodes        # works after ~1 minute
```

## Images

The cluster cannot see the images in your Docker; it has its own container runtime. Build with
Compose, tag with a **fixed** tag (never `latest`: Kubernetes would always try to pull it from a
registry) and load the image into every node:

``` shell
docker compose build catalog-1                     # builds the image "boxoffice-catalog" (lab 3 anchor)
docker tag boxoffice-catalog boxoffice/catalog:dev
kind load docker-image boxoffice/catalog:dev --name boxoffice
# minikube: minikube image load boxoffice/catalog:dev
```

You should see `Image: "boxoffice/catalog:dev" with ID "sha256:…" not yet present on node
"boxoffice-worker", loading...` once per node.

Repeat for every service you deploy. In [lab 11](../../11/index.md) a CI pipeline will push images
to a registry instead, tagged with the commit they were built from.

[Next: Deploy BoxOffice](../deploy/index.md){ .md-button .md-button--primary }
