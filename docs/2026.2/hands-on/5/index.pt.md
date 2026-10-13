## Slides

<div class="slides-embed">
  <iframe src="slides/orchestration.html" title="Slides: hands-on 5 — orquestração" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/orchestration.html){:target="_blank"}

## O que é um orquestrador?
Um orquestrador é um sistema que automatiza o deploy, o gerenciamento, a escala e a operação de aplicações em containers. Os containers empacotam a aplicação com suas dependências, tornando-a portável entre ambientes. Os orquestradores cuidam de tarefas críticas, como:

- **Escalonamento (scheduling)**: posicionar os containers nos servidores adequados.
- **Escala**: adicionar ou remover containers conforme a demanda.
- **Rede**: gerenciar a comunicação entre os containers.
- **Autorrecuperação (self-healing)**: reiniciar containers que falharam ou redistribuir workloads.
- **Descoberta de serviços**: permitir que os containers se encontrem e se comuniquem.

Ao abstrair a complexidade da infraestrutura, os orquestradores garantem que as aplicações rodem de forma confiável e eficiente, especialmente em sistemas distribuídos de grande escala. Eles são essenciais para empresas que gerenciam centenas ou milhares de containers em vários hospedeiros, dando suporte ao desenvolvimento cloud-native e às arquiteturas de microsserviços [Container Orchestration - Red Hat](https://www.redhat.com/en/topics/containers/what-is-container-orchestration){:target="_blank"}.

Orquestradores como Kubernetes, Docker Swarm e Apache Mesos oferecem essas capacidades, cada um com recursos e complexidades próprios. O Kubernetes é o orquestrador mais adotado, conhecido pelo seu ecossistema robusto e pelo apoio da comunidade.

## Diferença entre Docker Compose e Kubernetes
O Docker Compose e o Kubernetes (K8s) gerenciam aplicações em containers, mas atendem a propósitos diferentes, com escopos, complexidades e casos de uso distintos:

### Docker Compose
- **Propósito**: feito para ambientes de um único hospedeiro; ideal para desenvolvimento, testes ou produção em pequena escala.
- **Configuração**: usa um arquivo YAML para definir aplicações com vários containers, especificando serviços, redes e volumes.
- **Recursos**: simplifica a rede entre containers e o gerenciamento de dependências em uma única máquina. Suporta políticas básicas de reinício, mas não tem recursos avançados como escala automática ou gerenciamento de cluster.
- **Facilidade de uso**: simples de configurar, com curva de aprendizado menor, o que o torna acessível aos desenvolvedores.
- **Caso de uso**: melhor para desenvolvimento local (por exemplo, rodar uma aplicação web com um banco de dados) ou para setups simples de produção em que a escalabilidade não é prioridade.

### Kubernetes
- **Propósito**: feito para orquestrar containers em um cluster com vários nós; adequado a sistemas distribuídos de nível de produção.
- **Configuração**: usa arquivos YAML/JSON declarativos para definir o estado desejado, com controllers garantindo que o sistema corresponda à configuração.
- **Recursos**: oferece escala automática, balanceamento de carga, atualizações graduais (rolling updates), autorrecuperação, descoberta de serviços e orquestração de armazenamento.
- **Complexidade**: mais complexo, exige conhecer conceitos como pods, services e deployments.
- **Caso de uso**: ideal para aplicações cloud-native que precisam de alta disponibilidade, escalabilidade e resiliência em vários servidores.

### Principais diferenças
| Aspecto            | Docker Compose                     | Kubernetes                        |
|-------------------|------------------------------------|-----------------------------------|
| **Escopo**         | Um único hospedeiro               | Vários hospedeiros, baseado em cluster |
| **Escalabilidade**   | Sem escala automática             | Escala automática dinâmica        |
| **Complexidade**    | Simples, curva de aprendizado baixa | Complexo, curva de aprendizado mais íngreme |
| **Caso de uso**      | Desenvolvimento local, testes, produção pequena | Sistemas de produção em grande escala |

Ferramentas como o Kompose ajudam a migrar arquivos do Docker Compose para o Kubernetes, facilitando a transição de aplicações em crescimento [Docker Compose vs Kubernetes - Spacelift](https://spacelift.io/blog/docker-compose-vs-kubernetes).

## Alternativas ao Kubernetes
O Kubernetes é a principal plataforma de orquestração de containers, mas sua complexidade e sua demanda por recursos podem não servir a todos os cenários. Existem alternativas para diferentes ambientes — on-premise, nuvem e local —, com soluções mais simples, específicas de uma nuvem ou mais leves. A tabela abaixo resume alternativas populares, com exemplos:

| **Ambiente** | **Alternativa** | **Descrição** | **Exemplos** |
|-----------------|-----------------|-----------------|-----------------|
| **On-premise** | Nomad | Um orquestrador leve da HashiCorp, que suporta containers e workloads fora de containers. Mais fácil de configurar que o Kubernetes, ideal para equipes menores. | Implantar o Nomad em servidores bare-metal de um data center para uma aplicação de microsserviços. |
|                | Apache Mesos | Um kernel open source de sistemas distribuídos para orquestração de containers, adequado a workloads personalizados de grande escala. | Rodar o Mesos em infraestrutura on-premise para gerenciar um pipeline de processamento de big data. |
|                | OpenShift | Uma plataforma da Red Hat baseada em Kubernetes, com ferramentas adicionais para desenvolvedores e empresas, que suporta setups de nuvem híbrida. | Instalar o OpenShift em hardware corporativo para uma plataforma de e-commerce em nuvem híbrida. |
| **Nuvem**      | Amazon ECS | O serviço gerenciado de orquestração de containers da AWS, fortemente integrado a serviços da AWS como EC2 e Fargate. | Usar o ECS na AWS para fazer o deploy de uma aplicação web com escala automática em instâncias EC2. |
|                | Google Cloud Run | Uma plataforma serverless para rodar containers stateless, que abstrai o gerenciamento da infraestrutura. | Fazer o deploy de uma API REST no Google Cloud com escala automática para picos de tráfego. |
|                | AWS Fargate | Computação serverless para containers, compatível com ECS e EKS, que elimina o gerenciamento de servidores. | Rodar um serviço de analytics em container na AWS sem gerenciar servidores. |
|                | Azure Container Instances | O serviço serverless de containers do Microsoft Azure, para deploys de containers simples e isolados. | Fazer o deploy de um job de processamento em lote no Azure sem gerenciar infraestrutura. |
|                | Google Kubernetes Engine (GKE) | Serviço gerenciado de Kubernetes do Google Cloud, que simplifica o gerenciamento de clusters. | Rodar um workload de machine learning no Google Cloud com o control plane gerenciado do GKE. |
|                | Amazon EKS | Serviço gerenciado de Kubernetes da AWS, integrado ao ecossistema da AWS. | Fazer o deploy de uma aplicação web escalável na AWS usando o EKS com control plane gerenciado. |
| **Local**      | Docker Compose | Uma ferramenta para definir e rodar aplicações com vários containers em uma única máquina, ideal para desenvolvimento. | Rodar um ambiente local de desenvolvimento com uma aplicação web, um banco de dados e um cache usando Docker Compose. |
|                | Minikube | Uma ferramenta para rodar localmente um cluster Kubernetes de um único nó, para desenvolvimento e testes. | Testar deploys no Kubernetes no notebook do desenvolvedor com o Minikube. |
|                | Docker Swarm | A ferramenta de orquestração nativa do Docker, mais simples que o Kubernetes, para gerenciar containers em vários hospedeiros. | Montar um pequeno cluster local para testar uma aplicação em container com o Docker Swarm. |
|                | Kind | Uma ferramenta para rodar clusters Kubernetes em containers Docker, útil para testar o próprio Kubernetes. | Rodar um cluster Kubernetes local para testes e desenvolvimento com o Kind. |
|                | Rancher Desktop | Uma aplicação desktop para gerenciar clusters Kubernetes, com uma interface amigável. | Gerenciar clusters Kubernetes locais com o Rancher Desktop durante o desenvolvimento. |
|                | MicroK8s | Uma distribuição leve do Kubernetes, em um único pacote, para desenvolvimento local. | Rodar um cluster Kubernetes local com o MicroK8s para testes e desenvolvimento. |
|                | k3s | Uma distribuição leve do Kubernetes, pensada para ambientes com poucos recursos. | Rodar um cluster Kubernetes pequeno em dispositivos IoT ou em computação de borda (edge). |

### Observações sobre as alternativas
- **Nomad** e **Docker Swarm** priorizam a simplicidade, o que os torna adequados a equipes com poucos recursos ou workloads mais simples [Kubernetes Alternatives - Wiz](https://www.wiz.io/academy/kubernetes-alternatives){:target="_blank"}.
- O **OpenShift** amplia o Kubernetes com recursos corporativos, mas aumenta a complexidade; é melhor para organizações que precisam de ferramentas robustas.
- **Opções cloud-native** como Amazon ECS, Google Cloud Run e AWS Fargate reduzem o esforço de gerenciamento, mas prendem o usuário a provedores de nuvem específicos, limitando a portabilidade.
- **Ferramentas locais** como Minikube e Docker Compose não estão prontas para produção, mas se destacam em ambientes de desenvolvimento e de aprendizado.
- **Serviços gerenciados de Kubernetes** (GKE, EKS) simplificam a operação do Kubernetes, mas ainda exigem conhecimento de Kubernetes; por isso, não são uma alternativa de fato para quem quer evitar a complexidade do K8s.

A escolha da ferramenta certa depende de fatores como a escala do workload, a experiência da equipe, as restrições de infraestrutura e a necessidade de portabilidade entre nuvens. Para projetos pequenos, Docker Compose ou Nomad podem bastar, enquanto sistemas distribuídos grandes costumam se beneficiar do Kubernetes ou de soluções cloud-native como o ECS.

---

## Kubernetes

O Kubernetes é uma plataforma open source de orquestração de containers que automatiza o deploy, a escala e o gerenciamento de aplicações em containers. Ele oferece um framework robusto para rodar sistemas distribuídos de forma resiliente, permitindo gerenciar clusters de hospedeiros que rodam containers Linux. Um `cluster` é um conjunto de máquinas (físicas ou virtuais) que rodam o Kubernetes e podem ser gerenciadas como uma única entidade. Para gerenciar esses clusters, o Kubernetes usa um conjunto de APIs e um control plane que controla o estado do cluster.

``` mermaid-sim
flowchart TD
    Deployment:::orange -->|define| ReplicaSet
    ReplicaSet -->|gerencia| pod((Pod))
    pod:::red -->|executa| Container
    Deployment -->|escala| pod
    Deployment -->|atualiza| pod

    Service:::orange -->|expõe| pod

    subgraph  
        ConfigMap:::orange
        Secret:::orange
    end

    ConfigMap --> Deployment
    Secret --> Deployment
    classDef red fill:#f55
    classDef orange fill:#ffa500
```

- **Deployment**: funciona como o gerente da sua aplicação, decidindo quantas cópias (réplicas) devem rodar e atualizando-as quando necessário.

- **ReplicaSet**: garante que o número certo de Pods (os containers efetivamente em execução) esteja sempre disponível, criando-os ou removendo-os conforme necessário.

- **Pod**: a menor unidade, onde a sua aplicação de fato roda; normalmente contém um ou mais containers.

- **Container**: a aplicação propriamente dita, rodando dentro do Pod, isolada das demais.

- **Service**: funciona como um balanceador de carga, direcionando o tráfego para os Pods certos de acordo com as regras que você define. Um Service permite expor a sua aplicação para o mundo externo ou para outras aplicações dentro do cluster. O serviço exposto pode ser de tipos diferentes:

    | Tipos de Service | Descrição |
    |------------------|-------------|
    | **ClusterIP** | O tipo padrão, que expõe o serviço em um IP interno do cluster. Isso significa que o serviço só pode ser acessado de dentro do cluster. |
    | **NodePort** | Expõe o serviço no IP de cada nó, em uma porta fixa. Isso permite acessar o serviço de fora do cluster usando `<NodeIP>:<NodePort>`. |
    | **LoadBalancer** | Cria um balanceador de carga externo nos provedores de nuvem que oferecem suporte, roteando o tráfego para o seu serviço. |

- **ConfigMap**: uma forma de passar dados de configuração para a sua aplicação sem deixá-los fixos dentro do container.

- **Secret**: parecido com o ConfigMap, mas usado para informações sensíveis, como senhas ou chaves de API, garantindo que elas sejam armazenadas com segurança.

!!! tip "Exemplo com o serviço do Postgres"

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
        --8<-- "docs/2026.2/hands-on/5/k8s/postgres/secrets.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/secrets.yaml
        kubectl get secrets
        ```

    === "configmap.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "docs/2026.2/hands-on/5/k8s/postgres/configmap.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/configmap.yaml
        kubectl get configmap
        ```

    === "deployment.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "docs/2026.2/hands-on/5/k8s/postgres/deployment.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/deployment.yaml
        kubectl get deployments
        kubectl get pods
        ```

    === "service.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "docs/2026.2/hands-on/5/k8s/postgres/service.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/service.yaml
        kubectl get services
        ```

!!! tip "Exemplo com o serviço de Gateway"

    ``` { .tree }
    gateway-service
        k8s
            k8s.yaml
    ```

    === "k8s.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "docs/2026.2/hands-on/5/k8s/gateway/k8s.yaml"
        ```

        ```{ .bash .copy .select }
        kubectl apply -f ./k8s/k8s.yaml
        kubectl get deployments
        kubectl get pods
        kubectl get services
        ```

        ```{ .bash .select }
        NAME         TYPE           CLUSTER-IP     EXTERNAL-IP                                                              PORT(S)        AGE
        gateway      LoadBalancer   10.100.59.61   aac9dbab7421e4ec0a1b19472728b793-834724138.us-east-2.elb.amazonaws.com   8080:31973/TCP 34m
        kubernetes   ClusterIP      10.100.0.1     <none>                                                                   443/TCP        5d5h
        ```

        No navegador, você pode acessar o serviço de gateway usando o IP externo e a porta do Service (`8080`) — por exemplo, o endpoint `/health-check` do gateway, que responde com o `hostname` do pod que atendeu a requisição:

        ``` {.bash .copy .select }
        http://aac9dbab7421e4ec0a1b19472728b793-834724138.us-east-2.elb.amazonaws.com:8080/health-check # (1)!
        ```

        1. Observe que é uma requisição HTTP, e não HTTPS. Para usar HTTPS, você precisa configurar certificados TLS e ajustar o recurso Ingress de acordo.

        Outra forma de expor a API é usar o recurso `Ingress`, que permite definir regras para rotear o tráfego HTTP/S externo para os seus serviços. Isso é especialmente útil para gerenciar vários serviços sob um único domínio ou subdomínio. Veja a [documentação do Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/){target="_blank"} para mais detalhes.



!!! tip "Horizontal Pod Autoscaler"

    O Horizontal Pod Autoscaler (HPA) escala automaticamente o número de pods de um deployment ou replica set com base na utilização de CPU observada ou em outras métricas escolhidas. Ele ajusta o número de réplicas dinamicamente, para que a aplicação suporte cargas variáveis sem intervenção manual.
    Para configurar o HPA, você precisa definir a utilização de CPU alvo e o número mínimo e máximo de réplicas. O controller do HPA monitora as métricas continuamente e ajusta o número de réplicas de acordo.

    Consulte a documentação para mais detalhes sobre como configurar o HPA: [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) e [HorizontalPodAutoscaler Walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/){:target="_blank"}.


---

## Kubectl

O Kubernetes é uma poderosa plataforma de orquestração de containers, e o `kubectl` é a sua ferramenta de linha de comando para gerenciar clusters Kubernetes. Abaixo estão alguns comandos comuns e suas descrições, para ajudar você a começar com o `kubectl`.

Para instalar o `kubectl`, siga as instruções da [documentação do Kubernetes](https://kubernetes.io/docs/tasks/tools/install-kubectl/){:target="_blank"}. Para conferir se o `kubectl` foi instalado corretamente, execute:

``` {.bash .copy .select }
kubectl version --client
```

### Guia rápido do kubectl
| Comando | Descrição |
|---------|-------------|
| `kubectl get all` | Lista todos os recursos do namespace atual. |
| `kubectl get pods` | Lista todos os pods do namespace atual. |
| `kubectl get pod <pod-name> -o wide` | Mostra informações detalhadas de um pod específico. |
| `kubectl get services` | Lista todos os services do namespace atual. |
| `kubectl get deployments` | Lista todos os deployments do namespace atual. |
| `kubectl describe pod <pod-name>` | Mostra informações detalhadas de um pod específico. |
| `kubectl logs <pod-name>` | Mostra os logs de um pod específico. |
| `kubectl exec -it <pod-name> -- bash` | Abre um shell em um pod em execução. |
| `kubectl apply -f <file.yaml>` | Aplica um arquivo de configuração para criar/atualizar recursos. |
| `kubectl delete pod <pod-name>` | Remove um pod específico. |
| `kubectl delete deployment <deployment-name>` | Remove um deployment específico. |
| `kubectl scale deployment <deployment-name> --replicas=<number>` | Escala um deployment para o número de réplicas indicado. |
| `kubectl port-forward <pod-name> <local-port>:<pod-port>` | Encaminha uma porta local para uma porta de um pod. |
| `kubectl get nodes` | Lista todos os nós do cluster. |
| `kubectl get namespaces` | Lista todos os namespaces do cluster. |
| `kubectl get configmaps` | Lista todos os config maps do namespace atual. |
| `kubectl get secrets` | Lista todos os secrets do namespace atual. |
| `kubectl get ingress` | Lista todos os recursos ingress do namespace atual. |
| `kubectl autoscale deployment <deployment-name> --cpu-percent=<target-percentage> --min=<min-replicas> --max=<max-replicas>` | Cria ou atualiza um Horizontal Pod Autoscaler para um deployment. |
| `kubectl get hpa` | Lista todos os Horizontal Pod Autoscalers do namespace atual. |
| `kubectl delete hpa <hpa-name>` | Remove um Horizontal Pod Autoscaler específico. |
| `kubectl delete --all` | Remove todos os recursos do namespace atual. |

## Minikube

O Minikube é uma ferramenta que facilita rodar o Kubernetes localmente. Ele cria um cluster Kubernetes de um único nó na sua máquina, permitindo testar e desenvolver aplicações em um ambiente Kubernetes sem precisar de uma infraestrutura completa na nuvem.

Para instalar o Minikube, siga as instruções da [documentação do Minikube](https://minikube.sigs.k8s.io/docs/start/){:target="_blank"}.

### Guia rápido do Minikube

| Comando | Descrição |
|---------|-------------|
| `minikube start --driver=<driver> --profile=<profile>` | Inicia um cluster Minikube com o driver e o perfil indicados. |
| `minikube profile list` | Lista todos os perfis do Minikube. |
| `minikube stop --all` | Para todos os clusters Minikube. |
| `minikube status` | Mostra o status do cluster Minikube. |
| `minikube dashboard` | Abre o dashboard do Kubernetes no navegador. |
| `minikube ssh` | Abre uma sessão SSH na VM do Minikube. |
| `minikube delete` | Remove o cluster Minikube. |
| `minikube delete --all --purge` | Remove todos os clusters Minikube e apaga suas configurações. |


[^1]: [What is Container Orchestration? - Red Hat](https://www.redhat.com/en/topics/containers/what-is-container-orchestration){:target="_blank"}
[^2]: [Docker Compose vs Kubernetes - Differences Explained - Spacelift](https://spacelift.io/blog/docker-compose-vs-kubernetes){:target="_blank"}
[^3]: [Kubernetes Alternatives for Container Orchestration - Wiz](https://www.wiz.io/academy/kubernetes-alternatives){:target="_blank"}
[^4]: [Kubernetes Cheat Sheet - Kubernetes](https://kubernetes.io/docs/reference/kubectl/cheatsheet/){:target="_blank"}
[^5]: [Minikube Cheat Sheet - Minikube](https://minikube.sigs.k8s.io/docs/commands/){:target="_blank"}
[^6]: [Horizontal Pod Autoscaling - Kubernetes](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/){:target="_blank"}
[^7]: [HorizontalPodAutoscaler Walkthrough - Kubernetes](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/){:target="_blank"}
[^8]: [Kubernetes Architecture - Kubernetes](https://kubernetes.io/docs/concepts/overview/components/){:target="_blank"}
