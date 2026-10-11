
Quando um servidor não consegue lidar com o tráfego crescente, existem duas estratégias:

**Escalonamento vertical** (scale-up)
: Substituir o servidor por um mais potente — mais CPU, mais RAM, disco mais rápido. É simples, mas limitado: existe um limite físico para o tamanho de uma única máquina, e os upgrades exigem tempo fora do ar.

**Escalonamento horizontal** (scale-out)
: Adicionar mais servidores e distribuir a carga entre eles. Teoricamente ilimitado, mas introduz um problema crítico: a **consistência entre ambientes**.

``` mermaid
flowchart LR
    subgraph vs [Escalonamento vertical]
        s1["Servidor\n4 CPU / 8 GB"]:::small -->|upgrade| s2["Servidor\n32 CPU / 128 GB"]:::big
    end
    subgraph hs [Escalonamento horizontal]
        lb[Balanceador de carga] --> n1[Servidor 1]
        lb --> n2[Servidor 2]
        lb --> n3[Servidor 3]
    end
    classDef small fill:#ddd
    classDef big fill:#6c6,color:#fff
```

Uma aplicação que funciona no notebook de um desenvolvedor pode falhar em produção por causa de versões diferentes do sistema operacional, de bibliotecas ou de variáveis de ambiente — o famoso problema do *"na minha máquina funciona"*. A **containerização** resolve isso empacotando a aplicação com todas as suas dependências em uma unidade portátil e autocontida, que roda de forma idêntica em qualquer lugar.

---

## Containers vs. máquinas virtuais

Tanto os containers quanto as máquinas virtuais (VMs) oferecem isolamento, mas em níveis diferentes da pilha:

``` mermaid
flowchart TB
    subgraph vm [Máquinas virtuais]
        direction TB
        hw_vm[Hardware físico]:::infra
        hvm[Hypervisor]:::infra
        os1[SO convidado 1]:::customer
        os2[SO convidado 2]:::customer
        app1[App A]:::customer
        app2[App B]:::customer
        hw_vm --> hvm --> os1 & os2
        os1 --> app1
        os2 --> app2
    end
    subgraph ct [Containers]
        direction TB
        hw_ct[Hardware físico]:::infra
        os_ct[SO hospedeiro + kernel]:::infra
        engine[Engine de containers]:::infra
        c1[Container A]:::customer
        c2[Container B]:::customer
        hw_ct --> os_ct --> engine --> c1 & c2
    end
    classDef infra fill:#a8e6cf,stroke:#333
    classDef customer fill:#ffd3b6,stroke:#333
```

:material-square:{ style="color:#a8e6cf" } Camada do provedor / compartilhada &nbsp;&nbsp; :material-square:{ style="color:#ffd3b6" } Camada da aplicação

| Aspecto | Containers Docker | Máquinas virtuais |
|---|---|---|
| **Isolamento** | Em nível de processo — compartilham o kernel do hospedeiro | Isolamento completo de SO — cada VM tem seu próprio kernel |
| **Sobrecarga de recursos** | Leve — nenhum SO duplicado por container | Maior — cada VM carrega um SO completo |
| **Tempo de inicialização** | Segundos | Minutos (boot completo do SO) |
| **Portabilidade** | Alta — a imagem empacota a aplicação e todas as dependências | Menor — configuração específica do SO |
| **Fronteira de segurança** | Mais fraca (kernel compartilhado) | Mais forte (kernel separado) |
| **Uso típico** | Microsserviços, CI/CD, escalonamento horizontal | SO convidado diferente, requisitos fortes de isolamento |

A ideia-chave: containers compartilham o kernel do hospedeiro, então iniciam em segundos e consomem muito menos memória. VMs carregam seu próprio kernel — o que dá um isolamento mais forte ao custo de uma sobrecarga maior.

---

## O ciclo de vida de um container

``` mermaid
flowchart LR
    src[Código-fonte\n+ Dockerfile] -->|docker build| img[Imagem\n:tag]
    img -->|docker push| reg[(Registry\nDocker Hub / ECR)]
    reg -->|docker pull| deploy[Qualquer host]
    deploy -->|docker run| c1[Container 1]
    deploy -->|docker run| c2[Container 2]
    deploy -->|docker run| c3[Container 3]
```

Um **Dockerfile** descreve como construir a imagem. Uma **imagem** é o artefato imutável — ela é versionada, armazenada em um registry e baixada (pull) em qualquer máquina. Um **container** é uma instância em execução de uma imagem — isolada, efêmera e descartável.

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :fontawesome-brands-docker:{ .lg .middle } **Docker**

    ---

    Conceitos centrais do Docker: imagens, containers, o Docker Engine, Dockerfiles (incluindo builds multi-stage), comandos essenciais, redes e volumes.

    [:octicons-arrow-right-24: Docker](docker/index.md)

-   :material-file-code:{ .lg .middle } **Docker Compose**

    ---

    Orquestração declarativa de múltiplos containers com `compose.yaml`. Aborda definição de serviços, redes, volumes, variáveis de ambiente, health checks e ordem de dependências.

    [:octicons-arrow-right-24: Docker Compose](compose/index.md)

</div>

---

## Containerização na nuvem

Os provedores de nuvem oferecem serviços gerenciados de containers que acrescentam, sobre o modelo de containers, agendamento automático, escalonamento, balanceamento de carga e integração profunda com outros serviços de nuvem:

| Serviço | Provedor | Modelo |
|---|---|---|
| **ECS / Fargate** | AWS | Containers gerenciados — nenhum cluster para operar |
| **EKS** | AWS | Kubernetes gerenciado |
| **Cloud Run** | Google | Containers serverless — escala até zero |
| **GKE** | Google | Kubernetes gerenciado |
| **AKS** | Azure | Kubernetes gerenciado |

=== ":fontawesome-brands-google: Google"

    :fontawesome-brands-youtube:{ .youtube } [Por dentro de um data center do Google](https://youtu.be/XZmGGAbHqa0){:target='_blank'}

    [![](https://img.youtube.com/vi/XZmGGAbHqa0/0.jpg){ width=100% }](https://youtu.be/XZmGGAbHqa0){:target='_blank'}

=== ":fontawesome-brands-aws: AWS"

    :fontawesome-brands-youtube:{ .youtube } [Por dentro do enorme data center da Amazon](https://youtu.be/q6WlzHLxNKI){:target='_blank'}

    [![](https://img.youtube.com/vi/q6WlzHLxNKI/0.jpg){ width=100% }](https://youtu.be/q6WlzHLxNKI){:target='_blank'}

=== ":simple-tesla: Tesla"

    :fontawesome-brands-youtube:{ .youtube } [Por dentro do supercomputador Colossus de Elon Musk!](https://youtu.be/Tw696JVSxJQ){:target='_blank'}

    [![](https://img.youtube.com/vi/Tw696JVSxJQ/0.jpg){ width=100% }](https://youtu.be/Tw696JVSxJQ){:target='_blank'}

---

[^1]: [Docker Documentation](https://docs.docker.com/){:target="_blank"}
[^2]: [Docker vs. Virtual Machines: Differences You Should Know](https://cloudacademy.com/blog/docker-vs-virtual-machines-differences-you-should-know/){:target="_blank"}
[^3]: BURNS, B. et al. *Kubernetes: Up and Running*, 3rd ed. O'Reilly, 2022.
