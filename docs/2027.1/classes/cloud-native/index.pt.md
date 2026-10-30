O BoxOffice roda em um notebook: nove serviços, PostgreSQL, Redis e Kafka, tudo iniciado com um único `docker compose up`. Então a realidade chega. Em uma terça-feira comum, a plataforma atende algumas centenas de requisições por segundo; na manhã em que um show de estádio abre as vendas, ela precisa absorver **vinte vezes isso por trinta minutos** e depois encolher de volta, para que ninguém pague por máquinas ociosas. O time quer publicar uma correção no `inventory` às 09:55 sem derrubar o site às 10:00, e saber, *antes* de a fatura chegar, quanto tudo isso custa.

Nenhum desses é um problema da aplicação. São problemas de **plataforma**: onde o código roda, como ele chega lá, como escala e quem paga por isso. Esta aula trata do conjunto de práticas e ferramentas — containers, Kubernetes, infraestrutura como código, entrega contínua, GitOps, entrega progressiva e FinOps — que a indústria chama de **cloud-native**.

!!! quote "A história até aqui"

    Capítulo 11 da [história do curso](../../index.md#story). O BoxOffice tem todos os seus blocos: uma borda, serviços sem estado, um banco que vende cada assento uma única vez, caches, uma fila justa, telemetria e padrões de resiliência ([aula 4](../edge/index.md) a [aula 10](../reliability/index.md)). Os padrões funcionam, mas tudo isso ainda roda num único notebook com `docker compose up`, e o Compose não reinicia uma réplica morta em outro nó, não acrescenta réplicas de `catalog` às 09:45 nem desfaz uma versão ruim. **Esta aula** responde: onde o código roda, como ele chega lá, como escala — e quanto custa?

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula você deverá ser capaz de:

    - **Explicar** o que significa "cloud-native" e quais propriedades de uma aplicação (processos sem estado, configuração no ambiente, descartabilidade) a tornam portável entre plataformas.
    - **Mapear** cada componente do BoxOffice para um modelo de serviço (IaaS, CaaS, PaaS, FaaS, DBaaS, SaaS) e **justificar** o trade-off entre controle e esforço operacional.
    - **Construir** uma imagem de container pequena e segura para um serviço Java e **descrever** do que uma imagem OCI é feita.
    - **Escrever** os manifests Kubernetes (Deployment, Service, probes, recursos, HPA, PodDisruptionBudget, Ingress) que executam um serviço do BoxOffice e **prever** o que o control plane faz quando um pod morre.
    - **Projetar** um pipeline de entrega — infraestrutura como código, CI, GitOps e um rollout canary controlado por métricas — e **escolher** uma estratégia de deploy para um dado risco.
    - **Estimar** o custo mensal da arquitetura do BoxOffice, **identificar** seus custos fixos e variáveis e **propor** otimizações apoiadas em números.

## Roteiro { #roadmap }

1. **Esta visão geral** — o que significa cloud-native, as propriedades twelve-factor, modelos de serviço e engenharia de plataforma.
2. [Containers](containers/index.md) — namespaces e cgroups, imagens OCI e camadas, um Dockerfile de produção para um serviço Spring Boot, higiene da cadeia de suprimentos.
3. [Kubernetes](kubernetes/index.md) — o laço de controle, os objetos centrais, probes, recursos, autoscaling (HPA, autoscaling de cluster, KEDA) e os manifests do BoxOffice.
4. [Entrega](delivery/index.md) — Terraform/OpenTofu, GitHub Actions, GitOps com Argo CD, estratégias de deploy e um canary com análise automática de métricas.
5. [FinOps](finops/index.md) — modelos de preço da nuvem, um modelo de custo do BoxOffice, economia unitária e como reduzir a conta.
6. [Quiz](quiz.md) — teste seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/cloud-native.html" title="Slides: plataformas cloud-native e entrega" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/cloud-native.html){:target="_blank"}

---

## O que "cloud-native" significa { #what-cloud-native-means }

A Cloud Native Computing Foundation (CNCF) define tecnologias cloud-native como aquelas que "capacitam organizações a construir e executar aplicações escaláveis em ambientes modernos e dinâmicos, como nuvens públicas, privadas e híbridas", citando containers, service meshes, microsserviços, infraestrutura imutável e APIs declarativas como os blocos típicos[^1]. Sem o marketing, a definição se apoia em quatro ideias:

| Ideia | O que significa | Exemplo no BoxOffice |
|---|---|---|
| **Artefatos imutáveis** | Você nunca corrige um servidor em execução; constrói uma nova imagem e substitui as instâncias antigas | `inventory:1.8.3` é construída uma vez e promovida sem alterações de staging para produção |
| **Estado desejado declarativo** | Você descreve *o que* quer (5 réplicas de `catalog`), e um controlador faz continuamente a realidade corresponder | O Kubernetes reinicia um pod de `order` que caiu sem que ninguém seja acionado |
| **Elasticidade** | A capacidade acompanha a demanda, automaticamente, em minutos ou segundos | `catalog` vai de 4 para 40 réplicas durante a venda e volta a 4 na hora do almoço |
| **Automação de ponta a ponta** | Infraestrutura, builds, testes, deploys e rollbacks são código, versionado no Git | Um pull request aceito chega à produção por um pipeline, não por um checklist |

O oposto é um **servidor de estimação** (*pet*): uma máquina com nome, configurada à mão ao longo de anos, que ninguém tem coragem de reiniciar. Sistemas cloud-native tratam instâncias como **gado** (*cattle*) — numeradas, idênticas e substituíveis. A expressão é uma velha piada de operações, mas captura a mudança: a falha de uma instância vira um evento rotineiro tratado por software, não um incidente tratado por pessoas.

### A aplicação precisa cooperar { #the-application-has-to-cooperate }

Uma plataforma só consegue reiniciar, mover e multiplicar um processo que permita isso. A metodologia **Twelve-Factor App**, escrita por engenheiros do Heroku em 2011, lista as propriedades que tornam uma aplicação portável entre plataformas[^2]. Seis dos doze fatores são os que mais importam para esta aula:

| Fator | Regra | O que quebra se você ignorar |
|---|---|---|
| **III. Config** | A configuração (URLs, credenciais, chaves de funcionalidades) vem do ambiente, não do código | Uma imagem por ambiente; segredos acabam no Git |
| **IV. Backing services** | PostgreSQL, Redis, Kafka e o provedor de pagamento são recursos anexados, endereçados por URL | Mudar do Compose para um banco gerenciado exige mudanças no código |
| **VI. Processos** | Processos não têm estado; o estado vive em serviços de apoio | Um usuário perde o carrinho quando o pod que o guardava em memória é substituído |
| **IX. Descartabilidade** | Iniciar rápido, encerrar graciosamente ao receber `SIGTERM` | Rolling updates derrubam requisições em andamento; o autoscaling reage devagar demais |
| **X. Paridade dev/prod** | Manter desenvolvimento, staging e produção o mais parecidos possível | "Funciona na minha máquina"; testes de carga que medem o sistema errado |
| **XI. Logs** | Escrever logs em `stdout` como um fluxo de eventos; a plataforma os coleta | Logs somem junto com o container; discos enchem |

!!! example "BoxOffice: a reserva de assento que vivia em memória"

    Uma versão antiga do `inventory` guardava as reservas (*holds*) de assentos em um `ConcurrentHashMap` dentro da JVM. Funcionava com uma instância. Com três réplicas atrás de um load balancer, um fã que reservou o assento A-12 na réplica 1 podia vê-lo livre na réplica 2 — e, durante um rolling update, todas as reservas do pod substituído desapareciam. Levar as reservas para o PostgreSQL (com uma coluna de expiração) ou para o Redis (com TTL) tornou o serviço **sem estado** (fator VI) e, portanto, seguro para escalar e substituir. Veja [Bancos de dados — transações](../databases/transactions/index.md) para como a própria reserva se torna consistente.

---

## Modelos de serviço: quem opera o quê { #service-models }

Cada componente do BoxOffice precisa rodar *em algum lugar*, e para cada um o time escolhe quanto da pilha ele mesmo opera. A definição de computação em nuvem do NIST introduziu três modelos de serviço[^3]; a prática acrescentou vários outros. Todos podem ser lidos na mesma pilha de camadas:

| Camada | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| Dados e regras de acesso | você | você | você | você | você | você |
| Código da aplicação | você | você | você | você | você | provedor |
| Runtime (JVM, Python) | você | você | você (na imagem) | provedor | provedor | provedor |
| Orquestração de containers e escala | você | você | provedor (control plane) | provedor | provedor | provedor |
| Sistema operacional | você | você | compartilhado (nós) ou provedor (Fargate, Autopilot) | provedor | provedor | provedor |
| Virtualização, hardware, data center | você | provedor | provedor | provedor | provedor | provedor |

- **IaaS — Infrastructure as a Service.** Máquinas virtuais, discos e redes (Amazon EC2, Google Compute Engine, Azure VMs). Controle máximo, trabalho braçal máximo: você aplica patches no SO, instala o JDK, configura o firewall.
- **CaaS — Containers as a Service.** Você entrega imagens de container; o provedor executa o escalonador (Amazon EKS/ECS, Google GKE, Azure AKS). Com variantes serverless (AWS Fargate, GKE Autopilot) você nem enxerga os nós.
- **PaaS — Platform as a Service.** Você entrega código ou uma imagem mais um pouco de configuração; a plataforma faz o build, executa, escala e roteia (Heroku, Google App Engine, Azure App Service, Railway, Fly.io).
- **FaaS — Functions as a Service.** Você entrega uma função; a plataforma a executa a cada evento e cobra por invocação e por milissegundo (AWS Lambda, Google Cloud Run functions, Azure Functions). Escala até zero, mas tem **cold starts** e **limites de concorrência** (veja [Computação — serverless e autoscaling](../compute/serverless-autoscaling/index.md)).
- **DBaaS — Database as a Service.** Bancos gerenciados (Amazon RDS/Aurora, Cloud SQL, Azure Database for PostgreSQL): backups, failover, patches e réplicas viram botões, não projetos.
- **SaaS — Software as a Service.** Um produto pronto, usado por uma API ou pelo navegador: o provedor de pagamento, o provedor de e-mail, o fornecedor de observabilidade.

A regra que nunca muda, em qualquer coluna: **seus dados, suas identidades e regras de acesso e sua configuração continuam sendo responsabilidade sua**[^4]. Um bucket S3 público é um erro do cliente, não uma falha do provedor.

### BoxOffice, componente por componente { #boxoffice-component-by-component }

Não existe um único modelo "certo" para um sistema inteiro. Cada componente recebe o modelo que minimiza o esforço total para o controle de que precisa:

| Componente | Paleta | Modelo escolhido | Por quê | Alternativa |
|---|---|---|---|---|
| Serviços `gateway`, `catalog`, `inventory`, `order`, `search` | [App Server](../../reference/components/compute/index.md#app) | **CaaS** (Kubernetes gerenciado) | Muitos serviços, ferramentas compartilhadas, controle fino de escala e rollout | PaaS enquanto o time é pequeno |
| Inventário de assentos e pedidos | [SQL Database](../../reference/components/storage/index.md#sql) | **DBaaS** (PostgreSQL gerenciado, Multi-AZ) | Backups e failover são difíceis de acertar; os dados são o negócio | Autogerenciado no Kubernetes com um operator — só com um time forte de DBA |
| Reservas, sessões, páginas quentes do catálogo | [Cache](../../reference/components/storage/index.md#cache) | **DBaaS** (compatível com Redis, gerenciado) | Mesmos motivos; o cache está no caminho crítico | Redis em um pod (só em dev) |
| Eventos (pedidos, notificações) | [Kafka](../../reference/components/messaging/index.md#kafka) | **Kafka gerenciado** (Amazon MSK, Confluent Cloud) | Operar Kafka bem é uma especialidade | Operator Strimzi no Kubernetes |
| PDFs de ingressos, imagens de eventos | [Object Store](../../reference/components/storage/index.md#objstore) | **Serviço de armazenamento nível IaaS** (S3, GCS, Blob) | Praticamente ilimitado, barato, durável | — |
| Miniaturas de imagens, receptores de webhook | [Serverless](../../reference/components/compute/index.md#serverless) | **FaaS** | Em rajadas, orientado a eventos, ocioso na maior parte do tempo | Um deployment de workers |
| Pagamentos com cartão | [Payment](../../reference/components/external/index.md#payment) | **SaaS** (provedor de pagamento) | Conformidade com dados de cartão (PCI DSS) não é o negócio central do BoxOffice | — |
| E-mail transacional | [Email](../../reference/components/external/index.md#email) | **SaaS** | Entregabilidade e reputação são um negócio à parte | — |

??? question "Pense primeiro: por que não rodar *tudo* em FaaS e nunca mais pensar em servidores?"

    Três motivos. (1) **Conexões de longa duração e pools**: o `inventory` mantém um pool de conexões aquecido com o PostgreSQL; milhares de instâncias de função de vida curta abririam cada uma suas próprias conexões e esgotariam o banco (um proxy como o RDS Proxy atenua isso). (2) **Cold starts e limites de concorrência** prejudicam justamente no pico da venda relâmpago, quando a plataforma precisa escalar de quase nada para milhares de execuções concorrentes em segundos. (3) **Custo com carga constante**: cobrança por requisição é barata para trabalho em rajadas e quase sempre ocioso, mas um serviço ocupado 24/7 costuma sair mais barato em containers sempre ligados. A página de [FinOps](finops/index.md) calcula o ponto de equilíbrio.

Experimente: abra o cenário abaixo e pressione **Run** com o perfil `spike`. Observe o número de instâncias serverless, a latência de cold start no início do pico e o que acontece com a taxa de erros quando o **limite de concorrência** é atingido. Depois aumente o limite (ou ative a concorrência provisionada) e rode de novo.

<div class="sdp" data-scenario="serverless-burst" data-mode="compact" data-profile="spike" data-height="520"></div>

[Abra o playground completo](../../../playground/index.md) para trocar os componentes você mesmo.

---

## Engenharia de plataforma { #platform-engineering }

Com quinze serviços, três ambientes e cinco times, cada time redescobrir como escrever um Dockerfile, um chart Helm, um pipeline e um alerta é desperdício. A **engenharia de plataforma** responde com uma **plataforma interna de desenvolvimento (IDP, *internal developer platform*)**: um produto, construído por um time de plataforma para os demais times de engenharia, que oferece **caminhos dourados** (*golden paths*) — formas pavimentadas e suportadas de fazer as coisas comuns[^5].

``` diagram
flowchart LR
    dev["Time de produto<br/>(order, inventory…)"] -->|"usa"| portal["Portal do desenvolvedor<br/>(ex.: Backstage)"]
    portal --> tmpl["Template de serviço<br/>Dockerfile · manifests · pipeline"]
    portal --> env["Ambientes self-service<br/>(namespace, banco, fila)"]
    portal --> obs["Observabilidade embutida<br/>dashboards · alertas de SLO"]
    tmpl --> plat["Plataforma: Kubernetes · Argo CD · módulos Terraform · políticas"]
    env --> plat
    obs --> plat
```

Um bom caminho dourado é **opcional, mas atraente**: um novo serviço do BoxOffice criado a partir do template ganha uma imagem endurecida, manifests Kubernetes com probes e limites de recursos, um pipeline de CI com testes e varredura de imagem, um rollout canary, um dashboard RED e um alerta de SLO — no primeiro dia. O time pode sair do caminho quando tiver um motivo; a maioria nunca precisa.

| Abordagem | Ponto forte | Risco |
|---|---|---|
| Cada time faz a própria operação ("you build it, you run it") | Autonomia, senso de dono | Esforço duplicado, qualidade desigual, alta carga cognitiva |
| Time central de operações recebe tickets | Consistência | Vira gargalo; lead time lento |
| **Time de plataforma oferece caminhos dourados self-service** | Autonomia *e* consistência | A plataforma precisa ser tratada como um produto com usuários — senão vira de novo a fila de tickets |

## O mapa de conceitos de cloud-native { #concept-map }

Cloud-native não é um componente da paleta: é *como* cada componente é empacotado, executado, entregue e pago. O mapa liga os **componentes da paleta** (verde) aos **conceitos de plataforma** desta aula (azul):

``` diagram
flowchart LR
    app["app · worker"]:::comp --> c1["imagens OCI, camadas, digests,<br/>desligamento gracioso"]:::tech
    app --> c2["Deployment, Service, probes,<br/>requests e limits, HPA, KEDA"]:::tech
    edge["ingress · healthcheck"]:::comp -.- c2
    sls["serverless"]:::comp --> c3["FaaS: cold starts,<br/>limites de concorrência"]:::tech
    data["sql · cache · kafka"]:::comp --> c4["DBaaS, serviços gerenciados,<br/>Terraform / OpenTofu"]:::tech
    metrics["metrics"]:::comp --> c5["GitOps, canary decidido<br/>por métricas de SLO"]:::tech
    c1 --> c5
    bytes["cdn · nat · logs"]:::comp --> c6["FinOps: custo fixo vs variável,<br/>unit economics"]:::tech
    data --> c6
    c3 --> c6
    c5 -.- d1["SLIs, SLOs, error budgets<br/>(aulas 9 e 10)"]
    c2 -.- d2["serviços stateless,<br/>autoscaling (aula 5)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`app`](../../reference/components/compute/index.md#app) · [`worker`](../../reference/components/compute/index.md#worker) | Como empacotar um serviço para que rode igual em todo lugar? | twelve-factor (stateless, descartável), imagens OCI e camadas, digests, builds multi-stage, desligamento gracioso, SBOM e assinatura | [Containers](containers/index.md) | `scale-out` |
| [`app`](../../reference/components/compute/index.md#app) · [`ingress`](../../reference/components/edge/index.md#ingress) · [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | Quem mantém N réplicas saudáveis rodando e roteia para elas? | laço de controle, Deployment, Service, Gateway API, probes de startup/readiness/liveness, requests e limits, PodDisruptionBudget | [Kubernetes](kubernetes/index.md), [probes](kubernetes/index.md#probes) | `scale-out` |
| [`app`](../../reference/components/compute/index.md#app) · [`worker`](../../reference/components/compute/index.md#worker) · [`scheduler`](../../reference/components/compute/index.md#scheduler) | Como a capacidade acompanha a abertura de vendas, e volta? | fórmula do HPA, autoscaling de nós, KEDA por lag, pré-escala com cron | [Kubernetes — autoscaling](kubernetes/index.md#autoscaling) | `scale-out`, `flash-sale` |
| [`serverless`](../../reference/components/compute/index.md#serverless) | Pagar por requisição ou por hora? | FaaS, cold starts, limites de concorrência, ponto de equilíbrio | [esta visão geral](#service-models), [FinOps](finops/index.md) | `serverless-burst` |
| [`sql`](../../reference/components/storage/index.md#sql) · [`cache`](../../reference/components/storage/index.md#cache) · [`kafka`](../../reference/components/messaging/index.md#kafka) · [`objstore`](../../reference/components/storage/index.md#objstore) · [`payment`](../../reference/components/external/index.md#payment) · [`email`](../../reference/components/external/index.md#email) | Quem opera cada componente? | IaaS, CaaS, PaaS, FaaS, DBaaS, SaaS, responsabilidade compartilhada, engenharia de plataforma | [esta visão geral](#service-models) | `flash-sale` |
| [`vpc`](../../reference/components/network/index.md#vpc) · [`metrics`](../../reference/components/observability/index.md#metrics) · [`ingress`](../../reference/components/edge/index.md#ingress) | Como uma mudança chega à produção com segurança? | IaC, CI, GitOps com Argo CD, rolling / blue-green / canary, feature flags, expand/contract, DORA | [Entrega](delivery/index.md) | — (a entrega acontece fora do simulador) |
| [`cdn`](../../reference/components/edge/index.md#cdn) · [`nat`](../../reference/components/network/index.md#nat) · [`logs`](../../reference/components/observability/index.md#logs) | Para onde vai o dinheiro? | modelos de preço, itens fixos por hora, transferência de dados, unit economics, rightsizing, spot | [FinOps](finops/index.md) | `serverless-burst` |

!!! tip "Na entrevista"

    Detalhes de cloud-native raramente conduzem uma entrevista de system design, mas mostram maturidade no fechamento. Gaste uma ou duas frases com eles: "Os serviços são containers sem estado em Kubernetes gerenciado, com HPA por CPU e requisições por segundo; o banco é PostgreSQL gerenciado Multi-AZ; fazemos deploy via GitOps com canaries controlados pelos SLOs de p99 e de taxa de erros; no pico, o custo é dominado por X." Se perguntarem "por que não serverless?", responda com **pools de conexão, cold starts no pico e custo com carga constante**, não com gosto pessoal.

!!! success "Boas práticas"

    - **Escolha o modelo de serviço por componente e escreva o motivo no documento de projeto** — a camada de dados e o caminho de compra têm necessidades diferentes (failover vs controle fino de escala), então um modelo único está errado para algum deles. No BoxOffice: [componente por componente](#service-models).
    - **Prove a descartabilidade antes da produção: mate um pod sob carga constante e conte as requisições que falharam** — com readiness e uma pausa de `preStop`, a meta é zero. No BoxOffice: [lab 10 — Measure it](../../hands-on/10/measure/index.md), rolling update e autocura.
    - **Mude a produção só por um commit revisado** — imagens, manifests e infraestrutura; assim o `git log` é a trilha de auditoria e o `git revert` é o rollback. No BoxOffice: [lab 11 — GitOps](../../hands-on/11/gitops/index.md).
    - **Pré-escale para picos conhecidos; deixe o autoscaling para os desconhecidos** — no lab 10, o oitavo pod ficou pronto mais de 5 minutos depois de o HPA pedi-lo, então o `minReplicas` sobe às 09:45, não às 10:00. No BoxOffice: [lab 10 — Autoscaling](../../hands-on/10/autoscaling/index.md).
    - **Revise um custo unitário ao lado dos SLOs todo mês** — o custo por ingresso vendido transforma a fatura num número que o negócio consegue julgar. No BoxOffice: [FinOps — um modelo de custos](finops/index.md#cost-model).

!!! warning "Armadilhas comuns"

    - **Lift-and-shift e chamar de cloud-native**: colocar uma imagem de VM com estado dentro de um container não muda nada em descartabilidade ou elasticidade.
    - **Kubernetes para um time de duas pessoas**: um PaaS dá os mesmos benefícios com muito menos carga operacional até que o número de serviços e a escala justifiquem o cluster.
    - **Ignorar os custos fixos**: control planes, load balancers e NAT gateways cobram por hora mesmo com tráfego zero.
    - **Ambientes "floco de neve"**: um staging montado à mão difere da produção, e todo resultado de teste fica duvidoso.
    - **Esquecer que os dados são seus**: serviços gerenciados não decidem quem pode ler suas tabelas ou buckets.

---

## Relacionados { #related }

- Hands-on: [10. Kubernetes](../../hands-on/10/index.md) (BoxOffice em kind/minikube, probes, HPA sob carga do k6) e [11. Entrega](../../hands-on/11/index.md) (GitHub Actions, Argo CD, canary, gate de orçamento de desempenho).
- Exercício: [Autoscaling no Kubernetes](../../exercises/kubernetes-autoscaling/index.md); marcos do projeto [K8s + CI/CD e relatório de custos](../../exercises/project/milestones/index.md).
- Aulas: [Computação — serverless e autoscaling](../compute/serverless-autoscaling/index.md), [Rede e segurança](../network-security/index.md), [Entrega assistida por IA](../ai-delivery/index.md) (IA no pipeline de CI/CD), [Engenharia de desempenho](../performance/index.md).
- Estudo de caso: [Ticketing (venda relâmpago do BoxOffice)](../case-studies/ticketing/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Cloud-native = **artefatos imutáveis + estado desejado declarativo + elasticidade + automação**; a aplicação precisa ser **sem estado e descartável** para a plataforma ajudar.
    - Modelos de serviço trocam **controle por esforço operacional**; escolha por componente, não por sistema.
    - Seja qual for o modelo, **dados, identidade e configuração continuam sendo seus**.
    - A engenharia de plataforma transforma trabalho operacional repetido em **caminhos dourados self-service**.

## O que quebra em seguida { #what-breaks-next }

A plataforma agora reinicia, escala e publica o BoxOffice sem ninguém tocar num servidor: no lab 10 o HPA pediu mais pods de `catalog` cerca de dois minutos depois do início de uma rampa de carga, e no lab 11 um canary que falhava 30% das requisições foi desfeito sozinho em cerca de um minuto. Mas uma plataforma compartilhada é também uma superfície de ataque compartilhada. Todo pod pode abrir uma conexão com qualquer outro pod e com o banco; um token roubado de um serviço é aceito por todos; bots compram os melhores lugares tão rápido quanto o HPA acrescenta capacidade; e cada imagem que o pipeline publica carrega centenas de bibliotecas de terceiros. Decidir quem pode falar com quem, verificar a identidade em cada chamada e confiar só no que o pipeline construiu é a [aula 12 — Rede e Segurança](../network-security/index.md).

---

[^1]: CNCF. [CNCF Cloud Native Definition v1.1](https://github.com/cncf/toc/blob/main/DEFINITION.md){target="_blank"}. Cloud Native Computing Foundation.
[^2]: WIGGINS, A. [The Twelve-Factor App](https://12factor.net/){target="_blank"}. 2011.
[^3]: MELL, P.; GRANCE, T. [The NIST Definition of Cloud Computing](https://csrc.nist.gov/pubs/sp/800/145/final){target="_blank"}. NIST SP 800-145, 2011.
[^4]: AWS. [Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/){target="_blank"}.
[^5]: CNCF TAG App Delivery. [Platforms White Paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/){target="_blank"}. 2023.
