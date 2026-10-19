# Catálogo de componentes

Toda caixa que você pode colocar no canvas do [System Design Playground](../../../playground/index.md) tem uma entrada neste catálogo: **o que é**, **quando usar e quando não usar**, **números-chave**, **modos de falha**, **como se comporta no playground**, **produtos reais** na AWS, no GCP, no Azure e em código aberto, e uma frase que você pode dizer **na entrevista**. Os links "saiba mais" do simulador apontam para essas entradas.

A paleta tem 49 componentes em 10 categorias. Elas seguem uma requisição da esquerda para a direita: um **cliente** chega à **borda**, a borda encaminha para a **computação**, a computação é empacotada e escalada em **contêineres** (num cluster Kubernetes), a computação lê e escreve no **armazenamento** e publica na **mensageria**, tudo é acompanhado pela **observabilidade**, disposto dentro de uma **rede**, e algumas requisições vão para componentes de **IA** ou para provedores **externos**.

``` mermaid
flowchart LR
    CL[Cliente] --> ED[Tráfego e borda]
    ED --> CO[Computação]
    CO --> ST[Armazenamento]
    CO --> MS[Mensageria]
    CT[Contêineres: microsserviços, Kubernetes] -.executa.-> CO
    MS --> CO
    CO --> AI[IA e agentes]
    CO --> EX[Externos]
    OB[Observabilidade] -.observa.-> ED
    OB -.observa.-> CO
    OB -.observa.-> ST
    NW[Rede: VPC, sub-redes, NAT, VPN, mesh] -.contém.-> CO
```

## Categorias

| Categoria | O que responde | Componentes | Aulas principais |
|---|---|---|---|
| [Cliente](client/index.md) | Quem envia o tráfego, e como? | 2 | [Introdução](../../classes/intro/index.md), [Borda › Protocolos](../../classes/edge/protocols/index.md) |
| [Tráfego e borda](edge/index.md) | Como uma requisição nos encontra e entra com segurança? | 6 | [Borda](../../classes/edge/index.md) |
| [Computação](compute/index.md) | Onde o código roda, e como escala? | 8 | [Computação](../../classes/compute/index.md) |
| [Contêineres](containers/index.md) | Como empacotar, implantar e escalar serviços independentes? | 4 | [Cloud-native](../../classes/cloud-native/index.md), [Computação › Serviços](../../classes/compute/services/index.md) |
| [Armazenamento](storage/index.md) | Onde os dados vivem, e com que rapidez os lemos? | 7 | [Bancos de dados](../../classes/databases/index.md), [Cache](../../classes/caching/index.md) |
| [Mensageria](messaging/index.md) | Como os serviços conversam sem esperar uns pelos outros? | 4 | [Mensageria](../../classes/messaging/index.md) |
| [Observabilidade](observability/index.md) | Como sabemos o que está acontecendo? | 5 | [Observabilidade](../../classes/observability/index.md) |
| [Rede](network/index.md) | Quem pode falar com quem? | 5 | [Rede e segurança](../../classes/network-security/index.md) |
| [IA e agentes](ai/index.md) | Como colocar um LLM em produção com segurança? | 5 | [Sistemas de IA](../../classes/ai-systems/index.md) |
| [Externos](external/index.md) | Como depender de serviços que não operamos? | 3 | [Computação › Integrações](../../classes/compute/integrations/index.md) |

## Todos os componentes

| Id | Componente | Categoria | Em uma linha |
|---|---|---|---|
| `client` | [Client](client/index.md#client) | Cliente | Um navegador ou programa que envia requisições; gera a carga |
| `mobile` | [Mobile](client/index.md#mobile) | Cliente | Um app de celular: redes instáveis, uso offline, atualizações lentas |
| `dns` | [DNS](edge/index.md#dns) | Tráfego e borda | Nomes para endereços IP; roteamento geográfico, ponderado e de failover |
| `cdn` | [CDN](edge/index.md#cdn) | Tráfego e borda | Cacheia conteúdo perto dos usuários; alivia a origem |
| `lb` | [Load Balancer](edge/index.md#lb) | Tráfego e borda | Distribui requisições entre réplicas saudáveis (L4/L7) |
| `waf` | [WAF](edge/index.md#waf) | Tráfego e borda | Filtra tráfego HTTP malicioso e bots |
| `apigw` | [API Gateway](edge/index.md#apigw) | Tráfego e borda | Porta de entrada da API: autenticação, rate limiting, roteamento |
| `ingress` | [Ingress](edge/index.md#ingress) | Tráfego e borda | Encaminha tráfego HTTP externo para dentro de um cluster Kubernetes |
| `app` | [App Server](compute/index.md#app) | Computação | Réplicas de serviço sem estado que executam a lógica de negócio |
| `worker` | [Worker](compute/index.md#worker) | Computação | Processos em segundo plano que drenam filas |
| `serverless` | [Serverless](compute/index.md#serverless) | Computação | Funções que escalam por requisição, com cold starts e limites |
| `auth` | [Auth Service](compute/index.md#auth) | Computação | Autentica usuários e emite tokens (OIDC/JWT) |
| `search` | [Search](compute/index.md#search) | Computação | Busca textual e por facetas sobre um índice invertido |
| `scheduler` | [Scheduler](compute/index.md#scheduler) | Computação | Roda jobs agendados (cron) exatamente quando devem rodar |
| `notifications` | [Notifications](compute/index.md#notifications) | Computação | Envia e-mail, push e SMS por provedores, de forma assíncrona |
| `analytics` | [Analytics](compute/index.md#analytics) | Computação | Coleta e agrega eventos para relatórios e dashboards |
| `microservice` | [Microservice](containers/index.md#microservice) | Contêineres | Um contexto delimitado, implantado e escalado de forma independente, com seu próprio banco |
| `container` | [Container](containers/index.md#container) | Contêineres | Um processo empacotado numa imagem; limite de CPU e tempo de partida definem sua capacidade |
| `k8s` | [Kubernetes Cluster](containers/index.md#k8s) | Contêineres | Nós de trabalho que rodam serviços como pods; pods Pending, falhas de nó, cluster autoscaler |
| `registry` | [Service Registry](containers/index.md#registry) | Contêineres | Descoberta de serviços: quem chama encontra réplicas saudáveis e descarta as mortas em segundos |
| `sql` | [SQL Database](storage/index.md#sql) | Armazenamento | Dados relacionais com transações; a fonte da verdade |
| `dbcluster` | [DB Cluster](storage/index.md#dbcluster) | Armazenamento | Banco replicado, opcionalmente particionado, com failover automático |
| `nosql` | [NoSQL DB](storage/index.md#nosql) | Armazenamento | Bancos chave-valor, de documentos ou de colunas largas que particionam horizontalmente |
| `cache` | [Cache](storage/index.md#cache) | Armazenamento | Cópias em memória dos dados quentes (Redis); corta latência e carga no banco |
| `objstore` | [Object Store](storage/index.md#objstore) | Armazenamento | Armazenamento barato e durável para arquivos e mídia (tipo S3) |
| `dwh` | [Data Warehouse](storage/index.md#dwh) | Armazenamento | Banco colunar para consultas analíticas sobre o histórico |
| `vectordb` | [Vector DB](storage/index.md#vectordb) | Armazenamento | Busca de vizinhos mais próximos sobre embeddings (RAG) |
| `queue` | [Message Queue](messaging/index.md#queue) | Mensageria | Cada mensagem para um consumidor; absorve picos |
| `pubsub` | [Pub/Sub](messaging/index.md#pubsub) | Mensageria | Cada mensagem para todos os assinantes; fan-out |
| `stream` | [Event Stream](messaging/index.md#stream) | Mensageria | Log de eventos ordenado, retido e particionado |
| `kafka` | [Kafka](messaging/index.md#kafka) | Mensageria | A plataforma de referência de streaming de eventos: tópicos, partições, consumer groups |
| `metrics` | [Metrics](observability/index.md#metrics) | Observabilidade | Séries temporais numéricas: RED, USE, SLIs |
| `logs` | [Logs](observability/index.md#logs) | Observabilidade | Registros estruturados de eventos, ligados pelo trace id |
| `tracing` | [Tracing](observability/index.md#tracing) | Observabilidade | Uma requisição atravessando serviços, como uma cascata de spans |
| `alerting` | [Alerting](observability/index.md#alerting) | Observabilidade | Aciona humanos pelo consumo do SLO, não pela CPU |
| `healthcheck` | [Health Check](observability/index.md#healthcheck) | Observabilidade | Sondas de liveness e readiness para LBs e orquestradores |
| `vpc` | [VPC](network/index.md#vpc) | Rede | Sua rede privada e isolada numa região |
| `subnet` | [Subnet](network/index.md#subnet) | Rede | Fatia pública ou privada de uma VPC numa zona |
| `nat` | [NAT Gateway](network/index.md#nat) | Rede | Saída para a internet para serviços privados |
| `vpn` | [VPN](network/index.md#vpn) | Rede | Túnel criptografado entre redes |
| `mesh` | [Service Mesh](network/index.md#mesh) | Rede | mTLS, retries, timeouts e telemetria entre serviços |
| `llmgw` | [LLM Gateway](ai/index.md#llmgw) | IA e agentes | Porta de entrada única para provedores de modelos: roteamento, fallbacks, orçamentos, cache |
| `orchestrator` | [Orchestrator](ai/index.md#orchestrator) | IA e agentes | Roda o loop do agente com chamadas ao modelo e às ferramentas |
| `toolreg` | [Tool Registry](ai/index.md#toolreg) | IA e agentes | Catálogo das ferramentas que o modelo pode chamar (MCP), com permissões |
| `memory` | [Memory Fabric](ai/index.md#memory) | IA e agentes | Recuperação (RAG) e memória da conversa |
| `safety` | [Safety Mesh](ai/index.md#safety) | IA e agentes | Guardrails nas entradas, nas saídas e nas chamadas de ferramentas |
| `thirdparty` | [3rd Party API](external/index.md#thirdparty) | Externos | A API de outra empresa: lenta, com limite de taxa, às vezes fora do ar |
| `payment` | [Payment](external/index.md#payment) | Externos | Provedor de pagamento: idempotência, webhooks, conciliação |
| `email` | [Email](external/index.md#email) | Externos | Provedor de entrega de e-mail, sempre atrás de uma fila |

## Como ler uma entrada

!!! tip "Use o catálogo de três jeitos"
    - **Enquanto projeta no playground**: clique num nó e depois em "saiba mais" para ver seus parâmetros e modos de falha.
    - **Antes de uma entrevista**: leia só o quadro *Na entrevista* de cada componente, em voz alta; depois, a [referência rápida](../../support/interview/quick-reference/index.md).
    - **Enquanto estuda uma aula**: cada entrada aponta de volta para as páginas das aulas e para os cenários em que o componente importa.

Os números do catálogo são valores publicados e conhecidos (com a fonte indicada) ou estão claramente marcados como **≈ ilustrativos** — ordens de grandeza para raciocinar, não benchmarks. Os preços são preços de tabela aproximados de 2026: confira sempre nas calculadoras dos provedores. Para o conjunto completo de números, veja a [folha de números](../numbers/index.md); para definições, o [glossário](../glossary/index.md).
