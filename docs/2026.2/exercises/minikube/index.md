Kubernetes must be installed and running on your local machine. You can use Minikube or Kind for this purpose. If you are using Docker Desktop, make sure Kubernetes is enabled in the settings.

The concepts and the Postgres and Gateway manifests are covered in [Hands-on 5 — Orchestration](../../hands-on/5/index.md).

!!! warning "TO DO"

    All microservices should be published in the same kubernetes cluster. Create a setup file for each microservice, in its own `k8s` folder, eg.:

    ``` { .tree }
    api/
        account-service/
            k8s/
                k8s.yaml
    ```

    Where `k8s.yaml` is the setup file for the microservice. The setup file should include the following resources:

    - `Secrets`;
    - `ConfigMap`;
    - `Deployment`, and;
    - `Service`.

    Every microservice must have its own setup file:

    - `account-service`;
    - `auth-service`;
    - `gateway-service`;
    - `product-service`, and;
    - `order-service`.

    **Run** all services in the same cluster and verify they are healthy. You may use a local Kubernetes setup or a cloud provider such as AWS, Azure, or Google Cloud Platform. **Demonstrate** that all services are running in the same cluster by recording a short video.

!!! example "Example: `account-service`"

    A single `k8s.yaml` can hold several resources, separated by `---`. The account service reads its database connection from the ConfigMap (host, port, database) and the Secret (username, password), and connects to the `postgres` Service from [Hands-on 5](../../hands-on/5/index.md).

    === "k8s.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "docs/2026.2/exercises/minikube/k8s/account-service/k8s.yaml"
        ```

    === "Commands"

        ``` { .bash .copy .select }
        kubectl apply -f ./k8s/k8s.yaml
        kubectl get secrets,configmaps
        kubectl get deployments,pods,services
        kubectl logs deployment/account
        ```

    Only the gateway is exposed outside the cluster (`type: LoadBalancer`); the other services use `type: ClusterIP` and are reached by the gateway through their Service name (e.g. `http://account:8080`).

!!! tip "Minikube"

    - **Images**: the cluster must be able to pull your images. Push them to Docker Hub, or load a local image with `minikube image load <image>` and keep `imagePullPolicy: IfNotPresent` (with `Always`, Kubernetes tries the registry and fails).
    - **Gateway access**: a `LoadBalancer` Service stays `<pending>` on Minikube. Run `minikube tunnel` in another terminal, or open it with `minikube service gateway`.
