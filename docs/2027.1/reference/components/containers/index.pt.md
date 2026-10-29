# Contêineres { #containers }

**Contêineres** são a forma de empacotar, implantar e escalar serviços independentes. Um **microsserviço** é uma decisão de design — um bounded context, de um único time, com seu próprio banco de dados, lançado no seu próprio ritmo. Um **contêiner** é o empacotamento que torna isso prático: o processo e todas as suas dependências em uma imagem imutável que sobe em segundos em qualquer lugar. Um **orquestrador** (Kubernetes) decide em quais máquinas esses contêineres rodam, os substitui quando morrem e acrescenta mais quando a carga cresce; e um **service registry** diz a cada chamador quais réplicas existem e estão saudáveis *neste momento*. As perguntas de design são: *onde ficam as fronteiras entre serviços, quão rápido uma nova réplica recebe tráfego, o que acontece quando uma máquina morre, e estamos pagando por nós que não usamos?*

No BoxOffice, `catalog`, `inventory` e `order` são microsserviços, cada um empacotado em uma imagem de contêiner pelo CI; eles rodam como pods em um cluster Kubernetes (Hands-on 10), onde os Services e o CoreDNS fazem o papel do service registry.

No playground, `microservice` e `container` são nós de **chamada** (*call*), `k8s` é um **quadro de grupo** (um retângulo desenhado atrás dos nós que rodam como pods, como uma VPC) e `registry` é um nó **lateral** (*side*) ao qual os serviços se conectam.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [Microservice](#microservice) | Um bounded context, implantado e escalado de forma independente, com seu próprio banco de dados | `microservice` |
| [Container](#container) | Um processo empacotado com suas dependências em uma imagem, limitado por cgroups | `container` |
| [Kubernetes Cluster](#k8s) | Nós de trabalho que rodam serviços como pods; agenda, recupera e escala esses pods automaticamente | `k8s` |
| [Service Registry](#registry) | Quais instâncias saudáveis de cada serviço existem neste momento (service discovery) | `registry` |

``` diagram
flowchart LR
    CL[Cliente] --> GW[API Gateway]
    subgraph K8S["Cluster Kubernetes (nós de trabalho)"]
      CAT[catalog<br/>microsserviço]
      INV[inventory<br/>microsserviço]
      ORD[order<br/>microsserviço]
    end
    GW -->|"GET /events"| CAT
    GW -->|"POST /holds"| INV
    GW -->|"POST /orders"| ORD
    ORD --> INV
    CAT --> DB1[(banco do catalog)]
    INV --> DB2[(banco do inventory)]
    ORD --> DB3[(banco do order)]
    REG[Service Registry] -. réplicas saudáveis .- CAT
    REG -. réplicas saudáveis .- INV
    REG -. réplicas saudáveis .- ORD
```

---

## Microservice { #microservice }

**O que é.** Um serviço pequeno construído em torno de **um bounded context** — `catalog`, `inventory`, `order` — que um único time consegue construir, testar, implantar e escalar **de forma independente** dos outros. Ele é dono dos seus dados (**banco por serviço**, *database-per-service*: nenhum outro serviço lê ou escreve nas suas tabelas; eles perguntam pela sua API ou reagem aos seus eventos) e conversa com outros serviços só pela rede, de forma síncrona (HTTP/gRPC) ou assíncrona (eventos). Tecnicamente é só um [app server](../compute/index.md#app); o que o torna um microsserviço é a **fronteira** e a **independência**.

**Quando usar.**

- Quando vários times precisam entregar no próprio ritmo sem coordenar releases (lei de Conway: a arquitetura segue a organização).
- Quando partes do sistema têm necessidades muito diferentes de escala, disponibilidade ou segurança (BoxOffice: o `inventory` precisa sobreviver ao pico da abertura das vendas; o back office administrativo, não).
- Quando as fronteiras são claras e estáveis — normalmente *depois* que um monólito modular mostrou onde elas estão.

**Quando não usar (ou cuidado).**

- **Não no primeiro dia** com um time pequeno: um monólito modular dá a mesma modularidade sem saltos de rede, transações distribuídas ou N pipelines.
- Cada chamada síncrona é um salto de rede: ao longo da cadeia, as latências se **somam** e as disponibilidades se **multiplicam**. Prefira eventos assíncronos para tudo pelo que o usuário não espera.
- Nada de banco compartilhado: dois serviços escrevendo nas mesmas tabelas são um **monólito distribuído** — todos os custos dos microsserviços, nenhuma independência.
- Dividir por camada técnica (um "serviço de banco de dados", um "serviço de validação") em vez de por capacidade de negócio multiplica as chamadas por requisição.
- Você precisa da plataforma antes: CI/CD por serviço, service discovery, tracing, plantão por time.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Salto de rede dentro de uma região | ≈ 0,5–2 ms por chamada, mais serialização | ≈ ilustrativo; na mesma AZ é mais rápido do que entre AZs |
| Disponibilidade de uma cadeia síncrona | 0,995ᴺ | 5 serviços a 99,5% ⇒ ≈ 97,5% |
| Latência de uma cadeia sequencial | soma dos saltos | Fan-out paralelo ⇒ a chamada mais lenta (e a cauda cresce com N) |
| Tamanho do time por serviço | um "time de duas pizzas" (≈ 5–10 pessoas) | Regra prática da Amazon |
| Vazão de uma réplica | ≈ centenas a alguns milhares de req/s | ≈ ilustrativo; meça a sua com k6 (Hands-on 2) |

**Modos de falha.**

- **Falha em cascata** — um serviço lento segura as threads de todos os chamadores acima dele → timeouts, circuit breakers, bulkheads (cenário `cascading-failure`).
- **Monólito distribuído** — serviços que precisam ser implantados juntos ou compartilham um banco → redesenhe as fronteiras seguindo os bounded contexts.
- **Chamadas tagarelas** — uma requisição do usuário se espalha em dezenas de chamadas síncronas → APIs mais grossas, cache, eventos, um BFF que agrega.
- **Dados inconsistentes entre serviços** — nenhuma transação abrange dois bancos → sagas, o padrão outbox, consumidores idempotentes.
- **Chamadas a uma réplica morta** — os chamadores continuam mandando tráfego a uma instância que caiu → health checks e service discovery ([Service Registry](#registry)).

**No playground.** `microservice` é um nó de **chamada** que se comporta como um [App Server](../compute/index.md#app): cada requisição chama todas as arestas de saída (em sequência por padrão, latências se somam; `parallelCalls` as torna paralelas, latência = máximo). Parâmetros (padrões entre parênteses): `replicas` (2), `capacity` por réplica (400 req/s), `latencyMs` (tempo de serviço mediano, 8 ms, lognormal), `threads` por réplica (200), `queueLimit` (200), `parallelCalls` (desligado), `autoscale` (desligado) com `minReplicas`, `maxReplicas`, `targetUtil` e `warmupS` (1, 20, 0,6, 20 s), `multiAZ` (desligado) e `price` (60 USD/mês por réplica, ilustrativo). Um [API Gateway](../edge/index.md#apigw) trata cada alvo Microservice ou Container como uma **rota** própria, não como uma réplica a balancear: ele não balanceia a carga entre microsserviços *diferentes* (balanceia entre alvos de um mesmo outro tipo, por exemplo dois App Servers). Defina a `ratio` da aresta (fração das requisições do gateway que seguem essa rota) e o `filter` de leitura/escrita para modelar a API: por exemplo, 70% das requisições para `catalog` (leituras), 25% para `inventory`, 5% para `order` (escritas). Dentro de um quadro [Kubernetes Cluster](#k8s) suas réplicas são pods, e o preço delas é substituído pelo preço dos nós. Cenários: [`microservices`](../../../../playground/scenarios/index.md#microservices), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure), [`k8s-node-failure`](../../../../playground/scenarios/index.md#k8s-node-failure).

**Produtos reais.**

=== "AWS"

    - **Amazon EKS** e **Amazon ECS** (em EC2 ou **AWS Fargate**) — rodam cada serviço como um deployment próprio.
    - **AWS App Runner** — uma imagem de contêiner vira um serviço HTTPS com autoescala.
    - **AWS Cloud Map** e **Amazon VPC Lattice** — service discovery e rede entre serviços.

=== "GCP"

    - **Cloud Run** — um serviço por contêiner, escala com as requisições (e até zero).
    - **Google Kubernetes Engine (GKE)** — Kubernetes gerenciado.
    - **Cloud Service Mesh** — mTLS, políticas de tráfego e telemetria entre serviços.

=== "Azure"

    - **Azure Container Apps** — microsserviços serverless com Dapr e KEDA embutidos.
    - **Azure Kubernetes Service (AKS)** — Kubernetes gerenciado.
    - **Azure API Management** — o gateway que roteia para cada serviço.

=== "Open source"

    - **Spring Boot** + **Spring Cloud** (Gateway, Config, OpenFeign) e **FastAPI** — os frameworks usados no curso.
    - **gRPC** / **OpenAPI** — contratos de serviço.
    - **Resilience4j** — timeouts, retries, circuit breakers, bulkheads.
    - **Dapr** — blocos de construção (pub/sub, estado, invocação de serviços) como sidecar.

!!! tip "Na entrevista"
    "Eu começaria com um monólito modular e dividiria seguindo os bounded contexts — catalog, inventory, order — só onde as necessidades de times ou de escala divergissem. Cada serviço é dono do seu banco; tudo pelo que o usuário não espera passa por eventos, e toda chamada síncrona tem um timeout e um circuit breaker, porque em uma cadeia as latências se somam e as disponibilidades se multiplicam."

**Saiba mais:** [Computação › Serviços](../../../classes/compute/services/index.md) · [Computação › Estilos de API](../../../classes/compute/api-styles/index.md) · [Confiabilidade › Padrões](../../../classes/reliability/patterns/index.md) · [Mensageria › Filas e pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Hands-on 4 › Gateway](../../../hands-on/4/gateway/index.md) · [Hands-on 6](../../../hands-on/6/index.md)

---

## Container { #container }

**O que é.** Um **processo** iniciado a partir de uma **imagem** (formato Docker/OCI: uma pilha de camadas de sistema de arquivos somente leitura mais metadados), isolado dos outros processos da máquina por **namespaces** do Linux (seus próprios PIDs, rede, pontos de montagem, hostname) e limitado por **cgroups** (CPU, memória). Não é uma VM pequena: não há kernel convidado, então ele sobe em milissegundos quando a imagem já está na máquina, e dezenas cabem em um nó. Seus dois controles de recursos importam para a capacidade: o **CPU request** é o que o scheduler reserva; o **CPU limit** é uma cota aplicada a cada período de 100 ms — acima dela o processo sofre **throttling** (espera), o que aparece como latência, não como erros. Acima do **limite de memória** ele é morto (`OOMKilled`).

**Quando usar.**

- Para todo serviço que você mesmo constrói e opera: a mesma imagem vai do laptop (Docker Compose) ao CI e à produção, então "funciona na minha máquina" passa a significar "funciona".
- Quando você precisa escalar e substituir rápido (segundos, não os minutos do boot de uma VM).
- Empacotados em nós compartilhados para aumentar a utilização (bin packing) em comparação com uma VM por serviço.

**Quando não usar (ou cuidado).**

- Contêineres compartilham o kernel do host: isolamento mais fraco do que o de VMs para código não confiável → gVisor, Kata Containers, micro-VMs Firecracker (como fazem o Fargate e o Lambda).
- **Descartável significa sem estado**: tudo o que é escrito dentro do contêiner se perde no reinício → bancos de dados precisam de volumes (e normalmente de serviços gerenciados).
- Um **CPU limit abaixo da necessidade real** faz o serviço sofrer throttling: a CPU média parece boa enquanto o p99 cresce. Muitos times definem um CPU request mas nenhum CPU limit para serviços sensíveis à latência, e sempre um limite de memória.
- **A partida não é só o processo**: uma imagem de 1 GB em um nó que nunca a baixou, mais o aquecimento da JVM, leva dezenas de segundos — o tempo que a autoescala precisa esperar.
- Imagens são um risco de supply chain: fixe por digest, escaneie, assine, rode como não root.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Partida de um contêiner cuja imagem está em cache | ≈ 0,1–1 s | ≈ ilustrativo; namespaces + cgroups + exec |
| Pull da imagem | ≈ 1–10 s para 100–500 MB; dezenas de segundos para imagens de vários GB | ≈ ilustrativo; depende do registry, da rede e do cache de camadas |
| Partida de um serviço Spring Boot | ≈ 5–30 s até ficar pronto (o aquecimento do JIT continua depois) | Imagens nativas / CRaC: bem menos de 1 s |
| Período de cota do CFS | 100 ms | Padrão do Linux (`cpu.cfs_period_us`); limite de 1 CPU = 100 ms de CPU a cada 100 ms |
| CPU limit 0,5 em um serviço que precisa de 1 CPU | ≈ ½ da vazão, requisições ≈ 2× mais lentas | Throttling: `container_cpu_cfs_throttled_periods_total` |
| Tamanho da imagem | ≈ 50–300 MB (JRE sobre uma base distroless/alpine) | Builds multi-stage deixam o JDK e o Maven de fora |

**Modos de falha.**

- **CPU throttling** — a latência p99 cresce enquanto o uso de CPU parece abaixo do limite → aumente ou remova o CPU limit, dimensione os requests a partir de testes de carga.
- **OOMKilled / loop de reinício** — limite de memória abaixo da necessidade real (heap da JVM + metaspace + threads) → `-XX:MaxRAMPercentage`, dimensione o limite corretamente; o `CrashLoopBackOff` espaça os reinícios em até 5 min.
- **Escala lenta** — imagens grandes e partida lenta atrasam novas réplicas enquanto o pico já chegou → imagens menores, imagens pré-baixadas, startup probes, pré-escala.
- **ImagePullBackOff** — registry fora do ar, tag errada ou credenciais → espelhe o registry, fixe digests.
- **Escritas perdidas** — o estado escrito no sistema de arquivos do contêiner some no reinício → volumes ou armazenamentos externos.

**No playground.** `container` é um nó de **chamada** como `microservice`, com dois parâmetros específicos de contêiner. Parâmetros (padrões entre parênteses): `replicas` (1), `capacity` por réplica (300 req/s, dada para o CPU request), `cpuLimit` (1 × o CPU request; 0,1–4), `startupS` (20 s), `latencyMs` (10 ms), `threads` (100), `queueLimit` (200), `parallelCalls` (desligado), `autoscale` (desligado) com `minReplicas`, `maxReplicas`, `targetUtil` (1, 20, 0,6), `multiAZ` (desligado) e `price` (40 USD/mês por réplica, ilustrativo). O modelo: **capacidade por réplica = capacity × cpuLimit**, e o **tempo de serviço mediano = latencyMs ÷ min(1, cpuLimit)** — abaixo de 1 o contêiner sofre throttling (limite 0,5 ⇒ metade das req/s e requisições ≈ 2× mais lentas); acima de 1 ele ganha mais vazão, mas nenhuma requisição individual fica mais rápida. `startupS` (pull da imagem + partida do processo + aquecimento) é o tempo até uma réplica **nova** receber tráfego — depois de uma decisão da autoescala ou quando o Kubernetes a reagenda após uma falha de nó. Como um microsserviço, um API Gateway trata cada alvo Container como uma rota própria. Cenários: [`microservices`](../../../../playground/scenarios/index.md#microservices), [`k8s-node-failure`](../../../../playground/scenarios/index.md#k8s-node-failure), [`scale-out`](../../../../playground/scenarios/index.md#scale-out).

**Produtos reais.**

=== "AWS"

    - **Amazon ECR** — registry de contêineres com escaneamento de imagens.
    - **Amazon ECS** no **AWS Fargate** — rode contêineres sem administrar servidores (isolamento por micro-VM Firecracker).
    - **AWS App Runner** — da imagem a um serviço HTTPS.

=== "GCP"

    - **Artifact Registry** — registry de contêineres (e de pacotes).
    - **Cloud Run** — contêineres serverless, cobrados por tempo de requisição ou por instância.
    - **Cloud Build** — constrói imagens no CI.

=== "Azure"

    - **Azure Container Registry (ACR)**.
    - **Azure Container Instances (ACI)** — contêineres avulsos sob demanda.
    - **Azure Container Apps** — contêineres serverless com autoescala.

=== "Open source"

    - **Docker** / **Docker Compose** e **Podman** — constroem e rodam imagens localmente.
    - **containerd** e **CRI-O** — os runtimes que o Kubernetes usa; **runc** por baixo.
    - **BuildKit**, **Jib** (Java sem Dockerfile), **Buildpacks** — builds de imagens.
    - **Harbor** — registry auto-hospedado; **Trivy** e **cosign** — escaneamento e assinatura.

!!! tip "Na entrevista"
    "Cada serviço é entregue como uma imagem de contêiner imutável, fixada por digest. Dimensiono os requests de CPU e de memória a partir de testes de carga; evito CPU limits apertados em serviços sensíveis à latência, porque o throttling aparece como latência p99, não como erros. E conto o tempo de partida — pull da imagem mais aquecimento da JVM — em quão rápido a autoescala consegue reagir."

**Saiba mais:** [Cloud-native › Contêineres](../../../classes/cloud-native/containers/index.md) · [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md) · [Desempenho › Gargalos](../../../classes/performance/bottlenecks/index.md) · [Computação › Serverless e autoescala](../../../classes/compute/serverless-autoscaling/index.md) · [Hands-on 1 › Contêiner](../../../hands-on/1/container/index.md) · [Hands-on 10](../../../hands-on/10/index.md)

---

## Kubernetes Cluster { #k8s }

**O que é.** Um conjunto de **nós de trabalho** (*worker nodes*, máquinas virtuais) gerenciados por um **control plane** (API server, etcd, scheduler, controllers) que roda seus contêineres como **pods**. Você declara o estado desejado — "cinco réplicas de `catalog`, cada uma pedindo 1 CPU" — e loops de controle mantêm a realidade lá: o **scheduler** coloca cada pod em um nó com recursos requisitados livres suficientes; pods que não cabem em lugar nenhum ficam **Pending**; o controller do **ReplicaSet** substitui pods que morrem; o controller de ciclo de vida dos nós marca um nó silencioso como **NotReady**; o **Horizontal Pod Autoscaler (HPA)** acrescenta pods; e só o **Cluster Autoscaler** (ou o Karpenter) acrescenta **nós**. Os **Services** dão um nome estável e um IP virtual na frente de um conjunto mutável de pods prontos.

**Quando usar.**

- Muitos serviços e times que ganham com uma plataforma compartilhada: o mesmo deploy, escala, probes, segredos e observabilidade para tudo.
- Quando você precisa de autorrecuperação, rolling updates e autoescala como comportamento padrão e portável (a mesma API em toda nuvem e on-premises).
- Quando o ecossistema compensa: GitOps (Argo CD), KEDA, operators, service mesh, motores de políticas.

**Quando não usar (ou cuidado).**

- Poucos serviços e um time pequeno: **Cloud Run, ECS/Fargate, App Runner ou Container Apps** dão contêineres com autoescala e nenhuma operação de cluster.
- **A autoescala tem dois atrasos**: o HPA acrescenta pods em segundos, mas se nenhum nó tem espaço eles ficam Pending até um novo nó subir (minutos). Pré-escale ou mantenha capacidade sobrando para picos conhecidos.
- **Você paga por nós, não por pods**: capacidade requisitada ociosa, pods de sistema e o control plane custam dinheiro mesmo com tráfego zero.
- Sistemas com estado (bancos de dados, Kafka) no Kubernetes precisam de StatefulSets, volumes persistentes e operators — muitas vezes um serviço gerenciado é a melhor escolha.
- A falha de um nó leva todos os seus pods de uma vez: espalhe as réplicas por nós e zonas (topology spread constraints, PodDisruptionBudgets).

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Nó marcado NotReady depois de ficar silencioso | 40 s (`node-monitor-grace-period`; 50 s desde a v1.32) | Heartbeats do kubelet (node leases) a cada 10 s; seus pods saem dos endpoints do Service |
| Pods de um nó NotReady despejados após | 300 s | `tolerationSeconds` padrão para os taints `not-ready`/`unreachable`; depois o ReplicaSet os recria em outro lugar |
| Período de sincronização do HPA | 15 s | Janela de estabilização da redução de escala: 5 min por padrão |
| Intervalo de varredura do Cluster Autoscaler | 10 s | Redução depois que um nó fica desnecessário por 10 min (`scale-down-unneeded-time`) |
| Novo nó pronto | ≈ 1–3 min | ≈ ilustrativo; boot da VM + join + pull das imagens; o Karpenter costuma ser mais rápido |
| Novo pod pronto | ≈ 5–30 s | ≈ ilustrativo; pull da imagem + partida + readiness probe |
| Pods por nó | 110 (`max-pods` padrão do kubelet) | EKS com o VPC CNI: limitado pelas ENIs por tipo de instância, a menos que a prefix delegation esteja ligada |
| Limites de clusters grandes | 5.000 nós, 150.000 pods | "Considerations for large clusters" do Kubernetes |
| Taxa do control plane | ≈ 0,10 USD/h por cluster (≈ 73 USD/mês) no EKS e no GKE | AKS Free: sem taxa; AKS Standard: ≈ 0,10 USD/h; o GKE dá crédito de um cluster por conta de faturamento |

**Modos de falha.**

- **Pods presos em Pending** — o HPA pede réplicas que os nós não comportam → cluster autoscaler com um `maxNodes` alto o bastante, requests bem dimensionados, capacidade "balão" sobrando.
- **Falha de nó** — todos os pods do nó desaparecem de uma vez; os chamadores continuam mandando requisições até os endpoints serem atualizados (≈ 40 s) → várias réplicas espalhadas por nós e zonas, readiness e health checks, descoberta do lado do cliente.
- **Reagendamento sem espaço** — os pods de substituição de um nó morto ficam Pending se os nós restantes estão cheios → folga de pelo menos um nó (N+1), cluster autoscaler.
- **Vizinho barulhento** — um pod sem requests/limits sufoca os outros do seu nó → requests e limits em todo contêiner, cotas por namespace.
- **Autoescala de nós lenta demais para um pico** — novos nós chegam minutos depois do pico → pré-escala (cron), superprovisionamento, uma sala de espera na frente.
- **Sobrecarga do control plane / etcd** — objetos ou watchers demais → control plane gerenciado, menos objetos com alta rotatividade.

**No playground.** `k8s` é um **quadro de grupo**, como [VPC](../network/index.md#vpc) e Subnet: um retângulo redimensionável desenhado atrás dos nós. Todo nó cujo centro fica dentro do quadro roda **como pods** (um pod por réplica) — exceto serviços gerenciados (DNS, CDN, Load Balancer, WAF, Serverless, Object Store, Data Warehouse, Message Queue, Pub/Sub, Event Stream, NAT Gateway, VPN, LLM Gateway) e provedores externos, que rodam fora do cluster onde quer que você os desenhe. Parâmetros (padrões entre parênteses): `nodes` (3 nós de trabalho), `podsPerNode` (10), `clusterAutoscaler` (desligado), `maxNodes` (10), `nodeStartupS` (90 s) e `nodePrice` (140 USD/mês por nó de trabalho, ilustrativo).

- **Agendamento.** Pods agendáveis = nós prontos × `podsPerNode`. Réplicas além disso — vindas do parâmetro `replicas` ou acrescentadas pela autoescala (o HPA) — ficam **Pending**: não atendem, e o bloco e o inspetor as mostram ("3 pending"). Quando surge espaço, um pod pendente sobe e recebe tráfego depois do seu aquecimento (`startupS` para um Container, `warmupS` para os outros) mais ≈ 10 s de propagação dos endpoints, a menos que um [Service Registry](#registry) esteja conectado.
- **Cluster autoscaler.** Quando ligado e os pods pendentes não cabem nem contando os nós que já estão subindo, ele acrescenta ⌈pods faltantes ÷ `podsPerNode`⌉ nós (até `maxNodes`), prontos depois de `nodeStartupS`. Um nó desnecessário por **2 minutos** é removido, nunca abaixo de `nodes` (padrão real: 10 minutos; encurtado para caber em uma execução).
- **Falha de nó** (evento aleatório ou injetado). Um nó pronto morre e seus pods (≈ pods ÷ nós, distribuídos igualmente entre os serviços) se perdem. Os chamadores continuam mandando requisições a eles até perceberem: 30 s atrás de um load balancer, 3 s com um [Health Check](../observability/index.md#healthcheck) ou um Service Registry, no máximo 40 s (o Kubernetes marca o nó NotReady e remove seus endpoints). Depois de 40 s os pods perdidos são recriados e agendados se houver espaço; caso contrário, ficam Pending; o próprio nó é substituído quando o evento termina. (O Kubernetes real espera a toleration de despejo de 300 s antes de recriá-los; o playground se comporta como se ela tivesse sido reduzida.)
- **Custo.** (nós prontos + subindo) × `nodePrice`. O `price` próprio das réplicas **não** é contado dentro de um cluster: você paga por nós, não por pods. A taxa do control plane não é modelada — some ≈ 73 USD/mês à mão no EKS ou no GKE.

O painel ao vivo do quadro mostra nós prontos / subindo / com falha, pods agendados / capacidade, pods pendentes e custo. Experimente 3 nós × 10 pods com serviços em autoescala sob o perfil `spike`, com e sem o cluster autoscaler. Cenários: [`k8s-node-failure`](../../../../playground/scenarios/index.md#k8s-node-failure), [`microservices`](../../../../playground/scenarios/index.md#microservices).

**Produtos reais.**

=== "AWS"

    - **Amazon EKS** — control plane gerenciado; nós como managed node groups, **Karpenter**, **EKS Auto Mode** ou **Fargate**.
    - **Amazon ECS** — o orquestrador próprio da AWS, mais simples (não é Kubernetes).

=== "GCP"

    - **GKE Standard** — você gerencia os node pools; cluster autoscaler e node auto-provisioning.
    - **GKE Autopilot** — o Google gerencia os nós; cobrado pelos requests de recursos dos pods.

=== "Azure"

    - **Azure Kubernetes Service (AKS)** — node pools sobre VM scale sets; cluster autoscaler, add-on KEDA, **AKS Automatic**.
    - **Azure Container Apps** — baseado em Kubernetes, sem expor o cluster.

=== "Open source"

    - **Kubernetes** — com **etcd**, **containerd**, **CoreDNS**, um CNI como **Cilium** ou Calico.
    - **Cluster Autoscaler**, **Karpenter**, **KEDA** — autoescala de nós, de provisionamento e orientada a eventos.
    - **kind**, **minikube**, **k3s** — clusters locais e leves (o Hands-on 10 usa kind).
    - **Argo CD** — deploy GitOps no cluster.

!!! tip "Na entrevista"
    "Os serviços rodam como Deployments em um cluster Kubernetes gerenciado, espalhado por três zonas. O HPA escala os pods por CPU ou RPS em segundos, mas pods só rodam se algum nó tiver espaço, então o cluster autoscaler acrescenta nós — isso leva minutos, então para a abertura das vendas às 10:00 eu pré-escalo e mantenho um nó de folga. Uma falha de nó leva os pods dele junto; com réplicas em vários nós e readiness checks, o tráfego migra em segundos."

**Saiba mais:** [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md) · [Kubernetes › Autoescala em três níveis](../../../classes/cloud-native/kubernetes/index.md#autoscaling) · [Computação › Atraso da autoescala](../../../classes/compute/serverless-autoscaling/index.md#autoscaling-lag) · [Cloud-native › FinOps](../../../classes/cloud-native/finops/index.md) · [Ingress](../edge/index.md#ingress) · [Hands-on 10](../../../hands-on/10/index.md) · [Hands-on 10 › Um cluster local](../../../hands-on/10/cluster/index.md) · [Hands-on 10 › Autoescala](../../../hands-on/10/autoscaling/index.md) · [Hands-on 10 › Meça](../../../hands-on/10/measure/index.md)

---

## Service Registry { #registry }

**O que é.** O componente que responde *"quais instâncias de `inventory` existem e estão saudáveis neste momento?"* — **service discovery**. Réplicas vêm e vão (autoescala, deploys, quedas, falhas de nó) e seus endereços mudam a cada vez; as instâncias se **registram** quando sobem (ou a plataforma as registra quando a readiness probe passa), informam sua saúde por **heartbeats** ou checks, e são removidas quando param de responder. Os chamadores ou perguntam ao registry e escolhem uma réplica eles mesmos (**descoberta do lado do cliente**: Eureka + um load balancer no cliente, Consul) ou chamam um nome estável que um proxy da plataforma resolve (**descoberta do lado do servidor**: Services do Kubernetes, target groups da nuvem). O registry em si é um armazenamento pequeno e fortemente consistente (etcd, o Raft do Consul).

**Quando usar.**

- Assim que serviços chamam uns aos outros diretamente e as réplicas mudam: IPs fixos no código quebram no primeiro evento de autoescala.
- Para **detecção rápida de falhas** nas chamadas entre serviços: um registry com health checks remove uma réplica morta em segundos, em todo lugar.
- Entre plataformas (VMs + Kubernetes + vários clusters), onde um único Service do Kubernetes não basta (Consul, Cloud Map).

**Quando não usar (ou cuidado).**

- Dentro de um cluster Kubernetes você já tem um: **Services + EndpointSlices + CoreDNS**. Acrescente outro só se precisar do que eles não têm (multicluster, VMs, health checks mais ricos).
- O registry está no caminho crítico de toda nova conexão: rode-o replicado (3 ou 5 nós) e deixe os clientes **guardarem em cache** a última lista conhecida, para que uma queda do registry não pare o tráfego.
- **Entradas desatualizadas**: TTLs e intervalos de heartbeat trocam velocidade de detecção por carga e flapping. A descoberta baseada em DNS só é tão atual quanto seu TTL e o cache de DNS dos clientes.
- A descoberta diz *onde*, não *se a chamada vai dar certo*: continue usando timeouts, retries e circuit breakers.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Heartbeat / TTL | ≈ 1–10 s | ≈ ilustrativo; os checks do Consul são configurados por serviço |
| Padrões do Eureka | renovação a cada 30 s, expiração após 90 s, atualização do cache do cliente a cada 30 s | Lento por design; normalmente ajustado para baixo |
| TTL do CoreDNS para Services do Kubernetes | 5 s | Padrão do plugin `kubernetes` |
| Propagação dos endpoints no Kubernetes | ≈ 1–10 s da readiness até todos os nós | ≈ ilustrativo; controller de EndpointSlice + sincronização do kube-proxy |
| Tamanho do cluster do registry | 3 ou 5 servidores | Quórum do Raft: tolera 1 ou 2 falhas |
| AWS Cloud Map | ≈ 0,10 USD por instância registrada por mês + ≈ 1 USD por milhão de chamadas de descoberta | Preços de tabela aproximados |

**Modos de falha.**

- **Chamadas a réplicas mortas** — sem descoberta, um cliente continua mandando uma parte das suas requisições a uma instância que caiu → registry com health checks, TTLs curtos, outlier detection.
- **Queda do registry** — nenhuma consulta nova → registry replicado, caches no cliente com a última lista conhecida.
- **Cache desatualizado / cache de DNS** — os clientes guardam endereços antigos por minutos (por exemplo, o cache de DNS de uma JVM) → respeite os TTLs, prefira o proxy da plataforma ou uma biblioteca cliente que observe o registry.
- **Flapping** — limites de saúde agressivos acrescentam e removem instâncias repetidamente → limites com histerese.
- **Split brain** — um registry que não é fortemente consistente mostra instâncias diferentes a chamadores diferentes → armazenamentos baseados em consenso (etcd, Consul).

**No playground.** `registry` é um nó **lateral**, como o [Health Check](../observability/index.md#healthcheck): conecte-o aos serviços em qualquer direção (ele não está no caminho da requisição). Seu único parâmetro é `price` (30 USD/mês, mais 5 USD/mês por serviço conectado). Efeitos em todo serviço **registrado**:

- **Detecção mais rápida de réplicas mortas** — os chamadores param de mandar requisições a uma réplica que caiu em **3 s em vez de 30 s**. Isso vale atrás de load balancers *e* em chamadas diretas entre serviços (descoberta do lado do cliente): sem um registry, um chamador direto continua mandando a uma réplica que caiu a sua parte das requisições até ela voltar — ou por 40 s quando um nó do [Kubernetes](#k8s) se perde.
- **Sem atraso de propagação** — dentro de um quadro Kubernetes Cluster, novos pods recebem tráfego assim que ficam prontos, sem os ≈ 10 s de propagação dos endpoints.

Compare uma falha de nó no cenário `k8s-node-failure` com e sem o registry. Cenários: [`k8s-node-failure`](../../../../playground/scenarios/index.md#k8s-node-failure), [`microservices`](../../../../playground/scenarios/index.md#microservices).

**Produtos reais.**

=== "AWS"

    - **AWS Cloud Map** — service discovery para ECS, EKS e EC2 (DNS ou API), com health checks.
    - **ECS Service Connect** e **Amazon VPC Lattice** — descoberta mais rede entre serviços.
    - **Target groups do Elastic Load Balancing** — descoberta do lado do servidor.

=== "GCP"

    - **Service Directory** — registry gerenciado para serviços no GKE, em VMs e on-premises.
    - **GKE multi-cluster Services** e **Cloud DNS** — descoberta entre clusters.

=== "Azure"

    - Service discovery embutido do **Azure Container Apps** (nomes DNS por app).
    - Services do Kubernetes + CoreDNS no **AKS**; **Azure Private DNS** entre redes.

=== "Open source"

    - **Services do Kubernetes**, **EndpointSlices** e **CoreDNS** — descoberta dentro de um cluster.
    - **HashiCorp Consul** — registry, health checks, API DNS/HTTP, service mesh.
    - **Netflix Eureka** (Spring Cloud Netflix) — descoberta do lado do cliente para serviços Spring.
    - **etcd** e **Apache ZooKeeper** — armazenamentos consistentes usados como registries; **Nacos**.

!!! tip "Na entrevista"
    "Réplicas vêm e vão, então os chamadores nunca guardam endereços IP: dentro do Kubernetes, um Service e o CoreDNS dão a cada serviço um nome estável, e só os pods prontos ficam atrás dele. Entre clusters ou VMs eu usaria um registry como o Consul com health checks, replicado e em cache nos clientes, para que uma réplica morta pare de receber tráfego em segundos e uma queda do registry não interrompa as chamadas."

**Saiba mais:** [Borda › Service discovery](../../../classes/edge/load-balancing/index.md#service-discovery) · [Borda › Balanceamento de carga no Kubernetes](../../../classes/edge/load-balancing/index.md#kubernetes) · [Distribuídos › Consenso](../../../classes/distributed/consensus/index.md) · [Cloud-native › Kubernetes › Probes](../../../classes/cloud-native/kubernetes/index.md#probes) · [Health Check](../observability/index.md#healthcheck) · [Service Mesh](../network/index.md#mesh) · [Hands-on 10 › Implante o BoxOffice](../../../hands-on/10/deploy/index.md)
