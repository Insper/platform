O Kubernetes deve estar instalado e em execução na sua máquina local. Você pode usar Minikube ou Kind para isso. Se estiver usando o Docker Desktop, verifique se o Kubernetes está habilitado nas configurações.

Os conceitos e os manifestos do Postgres e do Gateway são abordados no [Hands-on 5 — Orquestração](../../hands-on/5/index.md).

!!! warning "A FAZER"

    Todos os microsserviços devem ser publicados no mesmo cluster Kubernetes. Crie um arquivo de configuração para cada microsserviço, na sua própria pasta `k8s`, por exemplo:

    ``` { .tree }
    api/
        account-service/
            k8s/
                k8s.yaml
    ```

    Onde `k8s.yaml` é o arquivo de configuração do microsserviço. O arquivo de configuração deve incluir os seguintes recursos:

    - `Secrets`;
    - `ConfigMap`;
    - `Deployment`, e;
    - `Service`.

    Cada microsserviço deve ter o seu próprio arquivo de configuração:

    - `account-service`;
    - `auth-service`;
    - `gateway-service`;
    - `product-service`, e;
    - `order-service`.

    **Execute** todos os serviços no mesmo cluster e verifique se estão saudáveis. Você pode usar um Kubernetes local ou um provedor de nuvem como AWS, Azure ou Google Cloud Platform. **Demonstre** que todos os serviços estão rodando no mesmo cluster gravando um vídeo curto.

!!! example "Exemplo: `account-service`"

    Um único `k8s.yaml` pode conter vários recursos, separados por `---`. O serviço de contas lê a conexão com o banco de dados do ConfigMap (host, porta, banco) e do Secret (usuário, senha), e se conecta ao Service `postgres` do [Hands-on 5](../../hands-on/5/index.md).

    === "k8s.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "docs/2026.2/exercises/minikube/k8s/account-service/k8s.yaml"
        ```

    === "Comandos"

        ``` { .bash .copy .select }
        kubectl apply -f ./k8s/k8s.yaml
        kubectl get secrets,configmaps
        kubectl get deployments,pods,services
        kubectl logs deployment/account
        ```

    Somente o gateway é exposto para fora do cluster (`type: LoadBalancer`); os outros serviços usam `type: ClusterIP` e são acessados pelo gateway por meio do nome do seu Service (ex.: `http://account:8080`).

!!! tip "Minikube"

    - **Imagens**: o cluster precisa conseguir baixar as suas imagens. Publique-as no Docker Hub, ou carregue uma imagem local com `minikube image load <image>` e mantenha `imagePullPolicy: IfNotPresent` (com `Always`, o Kubernetes tenta o registry e falha).
    - **Acesso ao gateway**: um Service `LoadBalancer` fica em `<pending>` no Minikube. Rode `minikube tunnel` em outro terminal, ou abra-o com `minikube service gateway`.
