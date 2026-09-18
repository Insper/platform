With the application containerized, the next step is to set up a CI/CD pipeline to automate deployments to a cloud provider. You may use any provider of your choice — AWS, Azure, or Google Cloud Platform. The pipeline should include the following stages:

1. SCM
1. Dependencies
1. Build
1. Push to Docker Hub
1. Deploy to K8s

!!! warning "TO DO"

    All microservices must be deployed to the same cluster. Each microservice is required to have its own `Jenkinsfile`. The pipeline should be defined at the root of the project and must cover all microservices:
    
    - `account-service`;
    - `auth-service`;
    - `gateway-service`;
    - `product-service`, and;
    - `order-service`.

A basic directory structure for the project is as follows:

``` { .bash }
.
├── account-service
│   ├── Jenkinsfile
│   └── ...
```

Example of a Jenkinsfile for the `account-service`:

=== "Jenkinsfile"

    ``` { .groovy .copy .select linenums="1" }
    --8<-- "https://raw.githubusercontent.com/hsandmann/insper.store.account-service/refs/heads/main/Jenkinsfile"
    ```
