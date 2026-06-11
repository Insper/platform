Kubernetes must be installed and running on your local machine. You can use Minikube or Kind for this purpose. If you are using Docker Desktop, make sure Kubernetes is enabled in the settings.

!!! warning "TO DO"

    All microservices should be published in the same kubernetes cluster. Create the setup files for each microservice in the root of the project, eg.:

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

    The setup file should be created in the root of the project, and it should include all microservices:

    - `account-service`;
    - `auth-service`;
    - `gateway-service`;
    - `product-service`, and;
    - `order-service`.

    **Run** all services in the same cluster and verify they are healthy. You may use a local Kubernetes setup or a cloud provider such as AWS, Azure, or Google Cloud Platform. **Demonstrate** that all services are running in the same cluster by recording a short video.

---

!!! danger "Entrega"

    Individualmente, cada aluno deve criar um repositório no GitHub, com a documentação em MkDocs dos exercícios realizados e também com o projeto e entrega o link via BlabkBoard. Na documentação publicada deve constar:

    - Nome do aluno e grupo;
    - Documentação das atividades realizadas;
    - Código fonte das atividades realizadas;
    - Documentação do projeto;
    - Código fonte do projeto;
    - Link para todos os repositórios utilizados;
    - Destaques para os bottlenecks implementados (ao menos 2 por indivíduo);
    - Apresentação do projeto;
    - Vídeo de apresentação do projeto (2-3 minutos);
    
    Um template de documentação pode ser encontrado em [Template de Documentação](https://hsandmann.github.io/documentation.template/){target="_blank"}.
