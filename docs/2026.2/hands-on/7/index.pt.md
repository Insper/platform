!!! tip "Objetivo principal"

    O objetivo principal deste hands-on é adicionar um **balanceador de carga** na frente do gateway usando o [Nginx](https://nginx.org){target="_blank"}, permitindo o **escalonamento horizontal** do serviço de gateway em várias réplicas dentro do Docker Compose.

Os hands-on anteriores construíram uma plataforma de microsserviços com uma única instância de gateway atendendo todo o tráfego externo. Sob carga contínua, esse gateway vira um gargalo — um processo, um pool de threads, nenhuma redundância. Um **balanceador de carga** resolve isso distribuindo as requisições recebidas entre várias instâncias idênticas do mesmo serviço.

## Slides

<div class="slides-embed">
  <iframe src="slides/load-balancer.pt.html" title="Slides: balanceador de carga" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/load-balancer.pt.html){:target="_blank"}

## Proxy

Um **proxy** é um intermediário que fica entre clientes e servidores, encaminhando requisições em nome de um dos lados.

=== "Forward proxy"

    Um **forward proxy** fica na frente dos **clientes**. Ele encaminha as requisições de saída para a internet e devolve a resposta ao cliente. O servidor de destino vê o endereço do proxy, não o do cliente original.

    Usos comuns: firewalls corporativos, filtragem de conteúdo, anonimização (VPN, Tor).

    ``` mermaid-sim
    flowchart LR
        client1[Cliente 1] --> fp[Forward proxy]
        client2[Cliente 2] --> fp
        fp -->|IP mascarado| server[Internet / Servidor]
    ```

=== "Proxy reverso"

    Um **proxy reverso** fica na frente dos **servidores**. Ele recebe as requisições vindas da internet e as encaminha para servidores de backend internos. O cliente vê apenas o proxy — nunca os endereços do backend.

    Usos comuns: balanceamento de carga, terminação SSL, cache, rate limiting.

    ``` mermaid-sim
    flowchart LR
        internet[Internet] --> rp[Proxy reverso]
        rp --> s1[Backend 1]
        rp --> s2[Backend 2]
        rp --> s3[Backend 3]
    ```

Neste hands-on, **o Nginx atua como proxy reverso** — o único componente exposto na porta 80, distribuindo o tráfego entre réplicas do gateway que permanecem invisíveis para os clientes externos.

## Tipos de balanceador de carga

Os balanceadores de carga são classificados pela camada OSI em que inspecionam o tráfego:

=== "Camada 4 — Transporte"

    Roteia o tráfego apenas com base no **endereço IP e na porta TCP/UDP**. O balanceador nunca inspeciona o payload HTTP — ele simplesmente encaminha fluxos de bytes.

    - Processamento mínimo — extremamente rápido
    - Independente de protocolo: funciona para qualquer serviço TCP/UDP
    - Não consegue rotear com base no caminho da URL, em cabeçalhos HTTP ou em cookies

    Exemplos: AWS Network Load Balancer (NLB), HAProxy em modo TCP.

    ``` mermaid-sim
    flowchart LR
        client -->|"TCP :443"| lb["Balanceador L4\n(IP + porta)"]
        lb -->|"10.0.0.1:8080"| s1[Servidor 1]
        lb -->|"10.0.0.2:8080"| s2[Servidor 2]
        lb -->|"10.0.0.3:8080"| s3[Servidor 3]
    ```

=== "Camada 7 — Aplicação"

    Roteia o tráfego com base no **conteúdo HTTP**: caminho da URL, cabeçalhos, cookies ou corpo da requisição. Permite decisões de roteamento muito mais inteligentes.

    - Pode inspecionar, modificar e reescrever requisições e respostas
    - Permite sessões fixas (sticky sessions), roteamento A/B e roteamento por caminho para serviços diferentes
    - Pequeno custo adicional em relação ao L4 — desprezível na maioria dos workloads

    Exemplos: Nginx, Traefik, AWS Application Load Balancer (ALB).

    ``` mermaid-sim
    flowchart LR
        client --> lb["Balanceador L7\n(entende HTTP)"]
        lb -->|"/api/auth/*"| auth[Serviço Auth]
        lb -->|"/api/accounts/*"| account[Serviço Account]
        lb -->|"Cookie: region=eu"| eu[Backend EU]
    ```

## Algoritmos de balanceamento de carga

| Algoritmo | Comportamento | Indicado para |
|---|---|---|
| **Round Robin** | Requisições distribuídas sequencialmente, uma por servidor, em ordem | Workloads uniformes, réplicas de mesma capacidade |
| **Least Connections** | A próxima requisição vai para o servidor com menos conexões ativas | Conexões de longa duração, requisições de duração variável |
| **IP Hash** | O IP do cliente determina qual servidor atende todas as suas requisições | Afinidade de sessão (aplicações com estado) |
| **Weighted Round Robin** | Os servidores recebem uma fatia proporcional a um peso atribuído | Servidores de capacidades diferentes |
| **Random** | Servidor escolhido aleatoriamente a cada requisição | Clusters muito grandes, simplicidade em escala |

## Arquitetura

Adicionar o Nginx como balanceador de carga muda o ponto de entrada da plataforma. O gateway deixa de ser exposto diretamente — apenas o Nginx é acessível de fora da rede Docker:

=== "Antes"

    ``` mermaid-sim
    flowchart LR
        subgraph api [Camada confiável]
            gateway:::orange --> auth
            gateway --> account
            account --> db@{ shape: cyl, label: "Banco de dados" }
        end
        internet e1@==>|":8080"| gateway
        e1@{ animate: true }
        classDef orange fill:#FCBE3E
    ```

=== "Depois"

    ``` mermaid-sim
    flowchart LR
        subgraph lb [Camada de balanceamento de carga]
            nginx["Nginx\n:80"]:::highlighted
        end
        subgraph api [Camada confiável]
            gw1["gateway\n(réplica 1)"]
            gw2["gateway\n(réplica 2)"]
            gw3["gateway\n(réplica 3)"]
            auth[auth]
            account[account]
            db@{ shape: cyl, label: "Banco de dados" }
            gw1 & gw2 & gw3 --> auth & account
            account --> db
        end
        internet e0@==>|":80"| nginx
        nginx e1@==> gw1
        nginx e2@==> gw2
        nginx e3@==> gw3
        e0@{ animate: true }
        e1@{ animate: true }
        e2@{ animate: true }
        e3@{ animate: true }
        classDef highlighted fill:#fcc
    ```

Os passos para implementar isso são:

<div class="grid cards" markdown>

-   :material-swap-horizontal-bold:{ .lg .middle } **[Nginx](./nginx/)**

    ---

    Crie o arquivo de configuração do Nginx, definindo o pool upstream e as regras de proxy reverso.

    [Nginx](./nginx/){ .md-button }

-   :material-file-code:{ .lg .middle } **[Docker Compose](./docker/)**

    ---

    Adicione o serviço `nginx` ao `compose.yaml`, remova a porta exposta do gateway e configure as réplicas.

    [Docker Compose](./docker/){ .md-button }

-   :material-play-circle:{ .lg .middle } **[Executar](./run/)**

    ---

    Suba a stack completa e verifique se o Nginx distribui as requisições entre as réplicas do gateway.

    [Executar](./run/){ .md-button }

</div>
