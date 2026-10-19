# Computação

**Computação** é onde o seu código roda: os serviços que recebem uma requisição, aplicam as regras de negócio e chamam armazenamento, mensageria e provedores externos. As perguntas de projeto são sempre as mesmas — *quanto estado ele guarda, como ele escala, quanto tempo uma requisição pode levar e o que acontece quando uma dependência fica lenta?* Tratadores de requisição sem estado escalam adicionando réplicas; trabalho longo ou pesado vai para workers em segundo plano; trabalho curto e com picos pode ir para serverless; e algumas capacidades (identidade, busca, notificações, analytics) são tão comuns que viram serviços dedicados.

No BoxOffice, `catalog`, `inventory` e `order` são app servers; e-mails e ingressos em PDF são gerados por workers; os lembretes de "os portões abrem em 1 hora" são disparados por um scheduler; o login é o serviço `auth`; a busca de eventos é o serviço `search`; e toda visualização de página e compra alimenta o `analytics`.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [App Server](#app) | Serviço sem estado que trata requisições síncronas; escala horizontalmente | `app` |
| [Worker](#worker) | Processo em segundo plano que consome tarefas de uma fila | `worker` |
| [Serverless](#serverless) | Funções executadas sob demanda, cobradas por invocação, escalam até zero | `serverless` |
| [Auth Service](#auth) | Autentica usuários e emite tokens (OAuth 2.1 / OIDC) | `auth` |
| [Search](#search) | Busca textual sobre um índice invertido | `search` |
| [Scheduler](#scheduler) | Dispara tarefas em horários ou intervalos fixos (cron) | `scheduler` |
| [Notifications](#notifications) | Envia push, e-mail e SMS com preferências, templates e retries | `notifications` |
| [Analytics](#analytics) | Coleta eventos e os transforma em métricas e relatórios | `analytics` |

``` mermaid
flowchart LR
    GW[API Gateway] --> AUTH[Auth Service]
    GW --> APP[App Server<br/>catalog / order]
    GW --> SR[Search]
    APP --> Q[(Fila)]
    SCH[Scheduler] --> Q
    Q --> W[Worker]
    W --> N[Notifications]
    APP -. eventos .-> AN[Analytics]
```

---

## App Server { #app }

**O que é.** O processo que executa o código do seu serviço — um serviço `catalog` em Spring Boot, um `assistant` em FastAPI — tratando requisições síncronas: interpretar, autorizar, rodar as regras de negócio, chamar o banco ou outros serviços, responder. A propriedade-chave de projeto é ser **sem estado** (*stateless*): nenhuma sessão ou dado do usuário guardado na memória local entre requisições, de modo que qualquer réplica possa atender qualquer requisição e réplicas possam ser adicionadas, removidas ou substituídas à vontade.

**Quando usar.**

- Para toda API síncrona pela qual o usuário espera: navegar por eventos, reservar assentos, fazer um pedido.
- Comece com um único artefato implantável (um **monólito modular**) e divida em serviços só ao longo de fronteiras claras (bounded contexts) ou quando as necessidades de times e de escala divergirem.
- Escale **horizontalmente** atrás de um load balancer; faça autoescala por CPU, taxa de requisições ou latência.

**Quando não usar (ou cuidado).**

- Não faça trabalho lento dentro da requisição (enviar e-mails, gerar PDFs, chamar um provedor lento sem timeout): leve-o para um [worker](#worker).
- Não guarde em memória estado que precise sobreviver à réplica (sessões, carrinhos, contadores de rate limit): use um [cache](../storage/index.md#cache) ou um banco de dados.
- Cada chamada síncrona a outro serviço adiciona latência e um ponto de falha; cadeias longas de serviços multiplicam os dois.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Vazão de uma réplica (CRUD simples sobre um banco) | ≈ centenas a alguns milhares de req/s | ≈ ilustrativo; meça o seu com k6 (Hands-on 2) |
| Limite de concorrência (Lei de Little) | threads ÷ tempo por requisição | 200 threads ÷ 0,1 s ⇒ ≤ 2.000 req/s por réplica |
| Meta saudável de uso de CPU para autoescala | ≈ 50–70% | Folga para picos e para o "joelho" das filas |
| Tempo de inicialização | contêiner: segundos; app JVM: ≈ 5–30 s | Imagens nativas GraalVM e CRaC encurtam |
| Pausas de coleta de lixo | ms (coletores modernos) a centenas de ms | Aparecem como picos na latência de cauda |

**Modos de falha.**

- **Esgotamento do pool de threads** — uma dependência lenta segura todas as threads enquanto a CPU está ociosa; o serviço para de responder → timeouts, circuit breakers, bulkheads (cenário `cascading-failure`).
- **Sobrecarga depois do joelho** — com ρ → 1 o atraso de fila explode → autoescala com folga, descarte de carga, rate limiting.
- **Vazamento de memória** — a capacidade cai devagar ao longo de horas → testes soak, reinícios, profiling.
- **Deploy ruim** — a taxa de erro salta → releases canário, rollback automático quando o SLO queima.
- **Réplica com estado morre** — usuários perdem a sessão → mantenha as réplicas sem estado.

**No playground.** `app` é um nó de **chamada** (*call*): cada requisição chama todas as arestas de saída (em sequência por padrão, latências se somam; `parallelCalls` as torna paralelas, latência = máximo). Parâmetros principais (padrões entre parênteses): `replicas` (1), `capacity` por réplica (500 req/s), `latencyMs` (tempo de serviço mediano, 10 ms, lognormal), `threads` por réplica (200, o limite de concorrência da Lei de Little), `queueLimit` (200), `autoscale` com `minReplicas`, `maxReplicas`, `targetUtil` e `warmupS` (1, 20, 0,6, 60 s) e `leakPerMin` para testes soak. Os parâmetros das arestas (`timeoutMs`, `retries`, `backoff`, `circuitBreaker`, `fallback`) protegem as chamadas dele. Cenários: [`monolith`](../../../../playground/scenarios/index.md#monolith), [`scale-out`](../../../../playground/scenarios/index.md#scale-out), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure).

**Produtos reais.**

=== "AWS"

    - **Amazon EC2** — máquinas virtuais.
    - **Amazon ECS** (com **AWS Fargate**) — contêineres gerenciados sem administrar servidores.
    - **Amazon EKS** — Kubernetes gerenciado.
    - **AWS Elastic Beanstalk** — plataforma como serviço para aplicações web.

=== "GCP"

    - **Compute Engine** — máquinas virtuais.
    - **Cloud Run** — contêineres serverless que escalam com as requisições.
    - **Google Kubernetes Engine (GKE)** — Kubernetes gerenciado.

=== "Azure"

    - **Azure Virtual Machines**.
    - **Azure App Service** — PaaS para aplicações web e APIs.
    - **Azure Container Apps** — contêineres serverless.
    - **Azure Kubernetes Service (AKS)** — Kubernetes gerenciado.

=== "Código aberto"

    - **Spring Boot** (Java) e **FastAPI** (Python) — os frameworks usados no curso.
    - **Docker** e **Kubernetes** — empacotamento e orquestração.
    - **Resilience4j** — timeouts, retries, circuit breakers e bulkheads para serviços na JVM.

!!! tip "Na entrevista"
    "Os app servers não têm estado, então escalo horizontalmente atrás do load balancer e faço autoescala em torno de 60% de CPU. O limite real de cada réplica é o pool de threads — threads divididas pelo tempo por requisição —, então toda chamada de saída tem timeout e circuit breaker; senão uma dependência lenta derruba o serviço inteiro."

**Saiba mais:** [Computação › Serviços](../../../classes/compute/services/index.md) · [Computação › Serverless e autoescala](../../../classes/compute/serverless-autoscaling/index.md) · [Estimativas › Filas](../../../classes/estimation/queueing/index.md) · [Confiabilidade › Padrões](../../../classes/reliability/patterns/index.md) · [Hands-on 1](../../../hands-on/1/index.md) · [Hands-on 2](../../../hands-on/2/index.md)

---

## Worker { #worker }

**O que é.** Um processo em segundo plano que puxa tarefas de uma [fila](../messaging/index.md#queue) ou de um stream e as processa fora da requisição do usuário: enviar e-mails, gerar ingressos em PDF, transcodificar vídeo, chamar a API lenta de um parceiro, recalcular um feed. Workers são os consumidores do mundo assíncrono: o produtor responde na hora ("seu pedido foi recebido") e o trabalho acontece alguns segundos depois, no ritmo que os workers conseguem sustentar.

**Quando usar.**

- Trabalho lento, pesado ou pouco confiável pelo qual o usuário não precisa esperar (BoxOffice: confirmação por e-mail, ingresso em PDF, nota fiscal).
- Para **absorver picos**: a fila guarda o acúmulo enquanto os workers o drenam em ritmo constante (cenário `async-queue`).
- Para repetir com segurança o trabalho que falhou, com backoff e uma fila de mensagens mortas (DLQ, dead-letter queue) para as tarefas que continuam falhando.
- Tarefas em lote: conciliação noturna de pagamentos, reindexação do catálogo de busca.

**Quando não usar (ou cuidado).**

- Quando o usuário precisa do resultado agora (meu assento está reservado?) — isso é uma chamada síncrona.
- A entrega normalmente é **pelo menos uma vez** (*at least once*): a mesma tarefa pode rodar duas vezes → torne o worker **idempotente** (deduplique pelo id da tarefa/evento).
- Uma fila esconde sobrecarga: se os produtores superam os consumidores por muito tempo, o acúmulo e o atraso ponta a ponta crescem sem limite → alerte sobre o atraso do consumidor e faça autoescala dos workers pela profundidade da fila.
- A maioria das filas não garante ordem; quando a ordem importa por chave, use um log particionado (Kafka) com um consumidor por partição.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Tempo para drenar um acúmulo | acúmulo ÷ (taxa de consumo − taxa de produção) | 600 mil tarefas ÷ (2.000 − 1.000)/s = 10 min |
| Workers necessários | taxa de chegada × tempo por tarefa (Lei de Little) | 500 tarefas/s × 0,2 s ⇒ 100 workers concorrentes |
| Visibility timeout / prazo de ack | segundos a minutos | Precisa ser maior que o tempo de processamento da tarefa |
| Máximo de retries antes da DLQ | ≈ 3–10 | ≈ ilustrativo; com backoff exponencial |

**Modos de falha.**

- **Mensagem envenenada** — uma tarefa sempre derruba o worker e é reentregue para sempre → contagem máxima de recebimentos + DLQ.
- **Processamento duplicado** — o worker cai depois de produzir o efeito, mas antes do ack → consumidores idempotentes, tabela de deduplicação.
- **Atraso crescente** — consumidores mais lentos que os produtores → autoescala pela profundidade da fila (KEDA), mais partições, código mais rápido.
- **Sobrecarga a jusante** — 100 workers martelam um provedor com cota → limite a concorrência dos workers ao rate limit do provedor.

**No playground.** `worker` é um nó de **chamada** que fica *atrás* de um nó de mensageria: a fila guarda um **acúmulo** (*backlog*) e os workers o drenam a `replicas × capacity` (padrões 2 × 100 mensagens/s). Observe o acúmulo, o atraso do consumidor e a latência ponta a ponta (assíncrona) no painel de métricas; com Kafka/streams, o paralelismo é limitado por `min(partitions, réplicas de workers)`. Parâmetros: `replicas`, `capacity`, `latencyMs` (50 ms), `autoscale`. Cenários: [`async-queue`](../../../../playground/scenarios/index.md#async-queue), [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming), [`notification-system`](../../../../playground/scenarios/index.md#notification-system).

**Produtos reais.**

=== "AWS"

    - **AWS Lambda** com gatilho do **Amazon SQS** — workers serverless.
    - Serviços **Amazon ECS** / **AWS Batch** — workers em contêiner, de longa duração ou em lote.

=== "GCP"

    - **Cloud Run jobs** e serviços Cloud Run alimentados por assinaturas push do **Pub/Sub**.
    - **Cloud Tasks** — fila de tarefas gerenciada que despacha tarefas HTTP para os seus workers com retries e limites de taxa.

=== "Azure"

    - **Azure Functions** com gatilhos do Service Bus ou do Storage Queue.
    - **Azure Container Apps jobs** — tarefas em contêiner orientadas a eventos.

=== "Código aberto"

    - **Celery** (Python), **Sidekiq** (Ruby), **Spring Batch** / listeners do Spring Kafka (Java).
    - **KEDA** — autoescalador do Kubernetes que escala workers pelo tamanho da fila ou pelo atraso do consumidor.
    - **Temporal** — motor de workflows duráveis para tarefas longas e com várias etapas.

!!! tip "Na entrevista"
    "Tudo o que é lento e pelo qual o usuário não espera vai para uma fila e um pool de workers idempotentes: a API de pedidos responde em milissegundos, o e-mail e o PDF vêm segundos depois. Dimensiono os workers com a Lei de Little, faço autoescala pela profundidade da fila e mando falhas repetidas para uma DLQ."

**Saiba mais:** [Computação › Trabalho assíncrono](../../../classes/compute/async-work/index.md) · [Mensageria › Filas e pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Mensageria › Semântica](../../../classes/messaging/semantics/index.md) · [Hands-on 7](../../../hands-on/7/index.md)

---

## Serverless { #serverless }

**O que é.** Functions as a Service (FaaS): você envia uma função e a plataforma a executa **por evento** (uma requisição HTTP, uma mensagem, um upload de arquivo, um timer), escalando de zero a milhares de instâncias concorrentes e cobrando por invocação e por milissegundo de execução. Você não administra servidores, mas aceita os limites da plataforma: duração máxima, memória, cotas de concorrência e **cold starts** (o atraso quando uma instância nova precisa ser criada).

**Quando usar.**

- Cargas curtas, com picos ou imprevisíveis: miniaturas de imagem depois de um upload, webhooks do provedor de pagamentos, um relatório noturno.
- Código de cola entre serviços gerenciados (um objeto novo no armazenamento → processá-lo → escrever em uma fila).
- APIs de pouco tráfego, em que pagar por servidores ociosos dominaria o custo.

**Quando não usar (ou cuidado).**

- Caminhos críticos de latência que não toleram cold starts (centenas de ms a segundos), a menos que você pague por instâncias provisionadas/mínimas.
- Trabalho longo ou com estado (a duração máxima do Lambda é de 15 minutos).
- Vazão alta e constante: com carga alta e estável, contêineres ou VMs costumam ser mais baratos por requisição.
- **Escalar rápido pode matar o seu banco**: 1.000 funções concorrentes abrindo uma conexão cada esgotam o PostgreSQL → pooler/proxy de conexões, limites de concorrência.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Cold start | ≈ 100 ms–1 s (Node/Python); pode passar de segundos na JVM sem snapshots | Lambda SnapStart e provisioned concurrency reduzem |
| Duração máxima do AWS Lambda | 15 min | Limite publicado |
| Memória do AWS Lambda | 128 MB – 10.240 MB | A CPU é alocada em proporção à memória |
| Concorrência padrão do AWS Lambda | 1.000 execuções concorrentes por região | Cota padrão, pode ser aumentada |
| Granularidade de cobrança | por invocação + por ms de duração × memória | Grátis quando ocioso (escala até zero) |

**Modos de falha.**

- **Throttling** — o limite de concorrência é atingido e as invocações falham (429) → concorrência reservada, fila na frente, aumento de cotas.
- **Latência de cauda por cold start** — p99 dominado por instâncias novas → instâncias provisionadas/mínimas, runtimes mais leves, snapshots.
- **Tempestade de conexões** no banco → RDS Proxy / PgBouncer, limitar a concorrência.
- **Retries de invocações assíncronas** causam duplicatas → handlers idempotentes.
- **Custo descontrolado** — um laço (a função escreve no bucket que a dispara) → proteções, orçamentos e alertas.

**No playground.** `serverless` é um nó de **chamada** com autoescala embutida: as requisições que precisam de uma instância nova pagam um **cold start** (`coldStartMs`, padrão 600 ms), a menos que instâncias `provisioned` fiquem sempre quentes, e acima do `concurrencyLimit` (padrão 1.000) as requisições são limitadas (429). O custo é por invocação mais GB-segundo (`memGB`). Compare-o com um nó `app` no perfil `spike`. Cenários: [`serverless-burst`](../../../../playground/scenarios/index.md#serverless-burst), [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming).

**Produtos reais.**

=== "AWS"

    - **AWS Lambda** — o FaaS de referência; SnapStart e provisioned concurrency para cold starts.
    - **AWS Step Functions** — orquestra workflows serverless com várias etapas.

=== "GCP"

    - **Cloud Run functions** (antigo Cloud Functions) — funções orientadas a eventos sobre o Cloud Run.
    - **Cloud Run** — contêineres serverless, escalam até zero.

=== "Azure"

    - **Azure Functions** — FaaS com planos de consumo e premium.
    - **Azure Container Apps** — contêineres serverless com escala até zero.

=== "Código aberto"

    - **Knative** — serverless (escala até zero, orientado a eventos) sobre Kubernetes.
    - **OpenFaaS** — funções sobre Kubernetes.
    - **KEDA** — autoescala orientada a eventos, inclusive até zero.

!!! tip "Na entrevista"
    "Serverless é ótimo para trabalho curto, com picos e orientado a eventos — o webhook de pagamento, miniaturas, tarefas noturnas — porque escala a partir de zero e pago por chamada. No caminho de compra, crítico em latência, prefiro contêineres aquecidos: cold starts pioram o p99, e uma rajada de funções pode esgotar as conexões do banco."

**Saiba mais:** [Computação › Serverless e autoescala](../../../classes/compute/serverless-autoscaling/index.md) · [Cloud-native › FinOps](../../../classes/cloud-native/finops/index.md) · [Estudo de caso: streaming de vídeo](../../../classes/case-studies/video-streaming/index.md)

---

## Auth Service { #auth }

**O que é.** O serviço que responde *quem é você?* (autenticação) e emite credenciais que o resto do sistema consegue verificar de forma barata: normalmente **OAuth 2.1 / OpenID Connect (OIDC)** com **access tokens** de vida curta (muitas vezes JWTs, assinados para que qualquer serviço os valide localmente) e **refresh tokens** de vida mais longa. Ele gerencia usuários, senhas (com hash Argon2 ou bcrypt), autenticação multifator, login social e sessões. *O que você pode fazer?* (autorização) é verificado depois pelo gateway e pelos serviços usando as claims do token.

**Quando usar.**

- Sempre, em qualquer sistema com contas. No BoxOffice, comprar exige login; navegar, não.
- Como serviço separado (ou um provedor de identidade gerenciado), para que picos de login e correções de segurança não toquem os serviços de negócio.
- Centralize a validação de tokens no API gateway; os serviços ainda verificam permissões finas (este usuário pode cancelar *este* pedido?).

**Quando não usar (ou cuidado).**

- **Não crie a sua própria criptografia ou armazenamento de senhas**; use um provedor de identidade ou uma biblioteca comprovados.
- Não chame o serviço de autenticação a cada requisição para validar um token — verifique a assinatura do JWT localmente com as chaves públicas em cache (JWKS).
- JWTs de vida longa não são fáceis de revogar → expiração curta (minutos) + refresh tokens + uma lista de revogação para emergências.
- O login é um alvo favorito de ataques → limites de taxa, proteção contra credential stuffing, MFA.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Verificação local da assinatura do JWT | ≈ microssegundos a dezenas de µs | Sem chamada de rede |
| Hash de senha (Argon2/bcrypt) | ≈ 100 ms+ de propósito | Lento por projeto para resistir à força bruta; dimensione a capacidade de login para isso |
| Vida de um access token | ≈ 5–15 min | Refresh tokens: horas a dias |
| Pico de login (venda relâmpago do BoxOffice) | muitos usuários fazem login minutos antes das 10:00 | ≈ ilustrativo; lembretes para logar antes espalham a carga |

**Modos de falha.**

- **Pane da autenticação = pane total** das funções que exigem login → redundância; a validação local de tokens mantém as sessões existentes funcionando.
- **Tempestade de logins** em um horário marcado, amplificada pelo hash lento de senhas → autoescala, incentivar o login antes de as vendas abrirem.
- **Rotação de chaves quebra a validação** → publicar as novas chaves no JWKS antes de assinar com elas, cache com renovação.
- **Vazamento de tokens** → vidas curtas, só HTTPS, flags seguras nos cookies, PKCE para clientes públicos.

**No playground.** `auth` é um nó de **chamada** como `app` (parâmetros `replicas`, `capacity` (3.000 req/s), `latencyMs` (4 ms), `threads`, `autoscale`). Coloque-o atrás do gateway com `ratio` < 1 na aresta para modelar que só algumas requisições (logins, renovação de tokens) chegam até ele, enquanto o resto é validado localmente. Monte-o em um projeto [`blank`](../../../../playground/index.md) ou estenda o [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale).

**Produtos reais.**

=== "AWS"

    - **Amazon Cognito** — user pools (cadastro, login, MFA, login social) que emitem tokens OIDC.
    - **AWS IAM Identity Center** — single sign-on para funcionários.

=== "GCP"

    - **Identity Platform** — identidade de clientes (OIDC, SAML, MFA).
    - **Firebase Authentication** — autenticação de usuários para apps web e mobile.

=== "Azure"

    - **Microsoft Entra ID** — identidade de funcionários.
    - **Microsoft Entra External ID** — identidade de clientes para aplicações.

=== "Código aberto"

    - **Keycloak** — servidor completo de gestão de identidade e acesso (OIDC, SAML), usado no Hands-on 4.
    - **Ory** (Kratos, Hydra), **ZITADEL**, **Authentik** — outros servidores de identidade de código aberto.
    - **Spring Security** — suporte a resource server e cliente OAuth 2.0 para serviços Java.

!!! tip "Na entrevista"
    "Um serviço de autenticação dedicado (OIDC) emite JWTs assinados de vida curta; o gateway e os serviços os validam localmente com chaves públicas em cache, então a autenticação não fica no caminho quente de toda requisição. O login em si tem rate limit e proteção contra credential stuffing."

**Saiba mais:** [Rede e segurança › Identidade](../../../classes/network-security/identity/index.md) · [Rede e segurança › Zero trust](../../../classes/network-security/zero-trust/index.md) · [Computação › Serviços](../../../classes/compute/services/index.md) · [Hands-on 4](../../../hands-on/4/index.md)

---

## Search { #search }

**O que é.** Um serviço de busca responde a consultas de texto ("coldplay são paulo", com erros de digitação) ordenadas por relevância, com filtros e facetas (data, cidade, preço). Ele é construído sobre um **índice invertido**: para cada termo, a lista de documentos que o contêm. O índice normalmente é uma **cópia secundária** de dados cuja fonte da verdade é o banco, mantida atualizada por eventos ou por captura de mudanças (CDC, change data capture); atualizações ficam visíveis depois de um **refresh** curto (quase em tempo real).

**Quando usar.**

- Busca textual, correspondência aproximada, ordenação por relevância, autocompletar, navegação por facetas — coisas que um `LIKE '%...%'` em SQL faz mal e devagar.
- No BoxOffice: buscar eventos por artista, local, cidade e data.
- Busca em logs e análise de documentos semiestruturados.
- Busca híbrida (palavras-chave + similaridade vetorial) para assistentes de IA.

**Quando não usar (ou cuidado).**

- Não é fonte da verdade: sem consistência forte, sem transações entre documentos. A disponibilidade de assentos precisa vir do `inventory`, não do índice.
- Manter o índice sincronizado é uma tarefa de projeto à parte (escritas duplas são inseguras → outbox/CDC).
- Buscas exatas por id ou filtros simples são mais baratos no banco principal.
- No Elasticsearch/OpenSearch, os shards são fixados na criação do índice; redimensionar significa reindexar.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência de consulta | ≈ 10–100 ms | Depende do tamanho do índice, da complexidade da consulta e do cache |
| Intervalo de refresh (visibilidade de docs novos) | 1 s por padrão no Elasticsearch/OpenSearch | "Quase em tempo real" |
| Orçamento do autocompletar | ≈ < 100 ms ponta a ponta por tecla | Normalmente servido por um índice de prefixos + cache |
| Tamanho do índice | ≈ comparável ao texto bruto, varia muito | ≈ ilustrativo; depende dos campos e dos analisadores |

**Modos de falha.**

- **Índice dessincronizado** — um evento cancelado no banco ainda aparece → pipeline de CDC/outbox, reconciliação periódica, mostrar a disponibilidade a partir da fonte da verdade.
- **Consultas caras** (curingas no início, agregações enormes) saturam o cluster → limites de consulta, timeouts, cache das consultas populares.
- **Shards quentes** → roteamento/sharding melhores, réplicas para leitura.
- **Reindexação sob carga** → construir um índice novo em segundo plano e trocar um alias.

**No playground.** `search` é um nó de **chamada** (parâmetros `replicas`, `capacity` (800 consultas/s), `latencyMs` (25 ms), `threads`, `autoscale`). Coloque um [cache](../storage/index.md#cache) na frente dele para os prefixos populares e veja a taxa de acerto cortar a carga. Cenário: [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete).

**Produtos reais.**

=== "AWS"

    - **Amazon OpenSearch Service** — clusters OpenSearch gerenciados, com opção serverless.

=== "GCP"

    - **Vertex AI Search** — busca gerenciada (por palavras-chave + semântica) sobre sites e dados.
    - Elastic Cloud e Elasticsearch/OpenSearch autogerenciados no GKE são escolhas comuns.

=== "Azure"

    - **Azure AI Search** — busca gerenciada textual, vetorial e híbrida.

=== "Código aberto"

    - **OpenSearch** e **Elasticsearch** — motores de busca distribuídos construídos sobre o Apache Lucene.
    - **Apache Solr** — plataforma de busca baseada em Lucene.
    - **Meilisearch**, **Typesense** — motores leves com tolerância a erros de digitação, bons para busca instantânea.
    - **Busca textual do PostgreSQL** — suficiente para catálogos pequenos.

!!! tip "Na entrevista"
    "A busca é um índice secundário: o banco continua sendo a fonte da verdade, as mudanças chegam ao OpenSearch por CDC ou outbox, e os resultados são quase em tempo real (cerca de um segundo de atraso). A disponibilidade mostrada no checkout vem sempre do serviço de inventário, nunca do índice de busca."

**Saiba mais:** [Bancos de dados › Especializados](../../../classes/databases/specialized/index.md) · [Mensageria › Padrões](../../../classes/messaging/patterns/index.md) · [Estudo de caso: autocompletar de busca](../../../classes/case-studies/search-autocomplete/index.md)

---

## Scheduler { #scheduler }

**O que é.** Um componente que dispara trabalho **pelo tempo**, não por uma requisição: "todo dia às 03:00 concilie os pagamentos", "a cada minuto libere as reservas de assento expiradas", "envie um lembrete 24 h antes de cada show". Schedulers simples executam expressões cron; os distribuídos garantem que cada tarefa rode **uma vez** mesmo com várias réplicas (eleição de líder ou um lock), guardam histórico, repetem falhas e lidam com muitas tarefas adiadas (uma por pedido ou por show).

**Quando usar.**

- Manutenção periódica: liberar reservas expiradas no `inventory`, limpar dados, rotacionar chaves, atualizar views materializadas.
- Temporizadores de negócio: lembretes antes de um evento, avisos de carrinho abandonado, abrir as vendas às 10:00 em ponto.
- Pipelines em lote: exportações noturnas para o data warehouse, relatórios.

**Quando não usar (ou cuidado).**

- **Manada em horários redondos**: milhares de tarefas marcadas para 00:00 disparam juntas → espalhe os horários de início (jitter).
- Rodar cron em todas as réplicas da aplicação executa a tarefa N vezes → um scheduler, um lock distribuído ou eleição de líder.
- Uma tarefa que dura mais que o seu intervalo se sobrepõe a si mesma → proíba execuções concorrentes.
- Para "faça X quando Y acontecer", um evento é melhor que consultar periodicamente.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Granularidade do cron | 1 minuto | Cron padrão; o CronJob do Kubernetes também |
| Tarefas adiadas por dia (lembretes do BoxOffice) | uma por pedido por show | ≈ ilustrativo: 60 mil assentos ⇒ 60 mil lembretes por show esgotado |
| Lease de um lock distribuído | algumas vezes a duração esperada da tarefa | Curto demais ⇒ dois executores; longo demais ⇒ retomada lenta |
| Política para execução perdida | pular ou recuperar | Decida explicitamente |

**Modos de falha.**

- **Execução dupla** — duas réplicas disparam → eleição de líder, locks com fencing tokens, tarefas idempotentes.
- **Execução perdida** — o scheduler estava fora do ar às 03:00 → política de recuperação, monitoração de "tarefa não rodou" (alerta dead-man's switch).
- **Rajada na hora cheia** sobrecarrega filas e provedores → jitter, despacho com limite de taxa por uma fila.
- **Bugs de relógio e fuso horário** (horário de verão, UTC vs local) → agendar em UTC, testar as transições de horário de verão.

**No playground.** `scheduler` **gera a sua própria carga periódica**: `jobs` tarefas a cada `everyS` segundos (padrões 1.000 a cada 60 s, todas de uma vez, a menos que `spreadS` as espalhe) para os seus alvos (normalmente uma fila que alimenta workers), independentemente do tráfego dos clientes. Aumente N para ver a rajada a cada disparo e como uma fila a suaviza. Cenário: [`notification-system`](../../../../playground/scenarios/index.md#notification-system).

**Produtos reais.**

=== "AWS"

    - **Amazon EventBridge Scheduler** — cron, taxas e agendamentos únicos gerenciados em grande escala, com alvos como Lambda, SQS, Step Functions e outros.

=== "GCP"

    - **Cloud Scheduler** — cron gerenciado que chama endpoints HTTP ou publica no Pub/Sub.
    - **Cloud Tasks** — tarefas individuais agendadas (adiadas).

=== "Azure"

    - **Gatilho de timer do Azure Functions** — funções baseadas em cron.
    - **Azure Logic Apps** — workflows com gatilhos de recorrência.

=== "Código aberto"

    - **Kubernetes CronJob** — cron para contêineres.
    - **Quartz** (Java) e o `@Scheduled` do Spring com **ShedLock** para execução única entre réplicas.
    - **Apache Airflow** — scheduler para pipelines de dados (DAGs).
    - **Temporal** — timers e agendamentos duráveis para workflows.

!!! tip "Na entrevista"
    "Trabalho baseado em tempo passa por um único scheduler que enfileira tarefas, não por cron em cada réplica: um lock ou eleição de líder garante uma execução, as tarefas são idempotentes caso rodem duas vezes, e os horários de início recebem jitter para que a meia-noite não vire uma manada."

**Saiba mais:** [Computação › Trabalho assíncrono](../../../classes/compute/async-work/index.md) · [Distribuídos › Consenso](../../../classes/distributed/consensus/index.md) · [Estudo de caso: sistema de notificações](../../../classes/case-studies/notification-system/index.md)

---

## Notifications { #notifications }

**O que é.** Um serviço que transforma "avise este usuário de X" em mensagens reais no **canal** certo — push (APNs, FCM), e-mail, SMS, no app — respeitando as **preferências** e os opt-outs do usuário, renderizando **templates**, deduplicando, limitando a taxa por usuário e repetindo quando os provedores falham. Ele fica atrás de uma fila: os produtores publicam eventos de "pedido confirmado" e o serviço de notificações os distribui pelos canais no ritmo que os provedores externos aceitam.

**Quando usar.**

- Sempre que várias partes do sistema precisarem falar com os usuários: `order` (confirmação), `inventory` (reserva prestes a expirar), scheduler (lembretes de show), marketing.
- Para isolar os serviços de negócio das manias dos provedores (cotas, panes, APIs diferentes).
- Para ter um lugar único para preferências, horários de silêncio, localização e auditoria ("este usuário foi avisado?").

**Quando não usar (ou cuidado).**

- Nunca envie notificações de forma síncrona dentro da requisição de compra; publique um evento e responda.
- Push e SMS são **melhor esforço**: informação importante precisa estar também no app ou no e-mail.
- Não avise duas vezes: a entrega pelo menos uma vez exige uma chave de deduplicação por (usuário, notificação).
- Respeite a lei e o consentimento do usuário (opt-in para marketing, links de descadastro).

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Distribuição depois de um show esgotado | 60 mil confirmações em minutos | ≈ número ilustrativo do BoxOffice |
| Cota de envio do provedor de e-mail | limites por segundo e por dia | ex.: contas do Amazon SES começam em um sandbox com limites baixos |
| Latência de entrega | push: segundos; e-mail: segundos a minutos | Não garantida |
| Retries | backoff exponencial, depois DLQ | Mantenha limitado o atraso visível ao usuário |

**Modos de falha.**

- **Pane ou limitação do provedor (429)** → fila + retries com backoff, um segundo provedor para canais críticos.
- **Notificações duplicadas** → chave de idempotência por mensagem, armazenamento de deduplicação.
- **Tempestade de notificações** — um bug ou um grande evento envia milhões de uma vez → limites por usuário, taxa global de envio, chave de desligamento (*kill switch*).
- **Template quebrado** estraga todas as mensagens → testes de template, implantação gradual.

**No playground.** `notifications` é um nó de **chamada** normalmente posto depois de uma fila: ele consome o acúmulo e chama o provedor externo [`email`](../external/index.md#email), cuja cota (`quota`, padrão 100 envios/s) e panes aleatórias tornam retries e DLQs necessários. Parâmetros: `replicas`, `capacity` (1.000 req/s), `latencyMs` (15 ms), `autoscale`; na aresta até o provedor, `timeoutMs`, `retries`, `backoff`. Cenários: [`notification-system`](../../../../playground/scenarios/index.md#notification-system), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale).

**Produtos reais.**

=== "AWS"

    - **Amazon SNS** — pub/sub mais entrega de push e SMS.
    - **Amazon SES** — envio de e-mail.

=== "GCP"

    - **Firebase Cloud Messaging (FCM)** — push para Android, iOS e web.
    - Pub/Sub + Cloud Run para montar o pipeline de notificações.

=== "Azure"

    - **Azure Notification Hubs** — push em escala.
    - **Azure Communication Services** — APIs de e-mail, SMS e chat.

=== "Código aberto"

    - **Novu** — infraestrutura de notificações de código aberto (templates, preferências, multicanal).
    - **ntfy** — push simples e auto-hospedado.
    - Filas (RabbitMQ, Kafka) + workers para montar o seu próprio pipeline.

!!! tip "Na entrevista"
    "Os serviços publicam eventos; um serviço de notificações os consome, verifica as preferências, renderiza os templates e envia por filas por canal, de modo que um provedor de e-mail lento nunca bloqueia uma compra. Toda mensagem tem chave de deduplicação porque a entrega é pelo menos uma vez, e os envios respeitam a cota do provedor."

**Saiba mais:** [Computação › Integrações](../../../classes/compute/integrations/index.md) · [Mensageria › Filas e pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Estudo de caso: sistema de notificações](../../../classes/case-studies/notification-system/index.md) · [Hands-on 7](../../../hands-on/7/index.md)

---

## Analytics { #analytics }

**O que é.** O pipeline que transforma eventos brutos (visualizações de página, buscas, reservas, compras, cliques) em números que as pessoas conseguem usar: dashboards ("ingressos vendidos por minuto"), funis (quantos que reservaram um assento de fato pagaram?), sinais de fraude, recomendações. Os eventos são coletados de forma assíncrona, normalmente por um stream, e depois processados em **tempo real** (processamento de streams) e/ou em **lote** em um [data warehouse](../storage/index.md#dwh). É o lado de leitura do negócio, mantido longe dos bancos transacionais.

**Quando usar.**

- Métricas de produto e de negócio, testes A/B, funis, dashboards de vendas para os organizadores de eventos.
- Contadores em tempo real durante a venda relâmpago (vendidos, reservados, tamanho da sala de espera).
- Analytics de cliques de um encurtador de URL, contagem de visualizações de uma plataforma de vídeo.

**Quando não usar (ou cuidado).**

- Não rode consultas analíticas no banco OLTP de produção: um `GROUP BY` grande pode deixar as compras lentas → replique para um warehouse (CDC/ELT).
- Não faça a requisição do usuário esperar pela escrita de analytics: dispare e esqueça em um stream.
- Números de analytics costumam ser aproximados e um pouco atrasados; não os use para garantir invariantes (contagem de assentos).
- Dados pessoais: anonimize/agregue e respeite as regras de retenção (LGPD/GDPR).

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Volume de eventos | vários eventos por ação do usuário | ≈ ilustrativo: 2 M fãs × 20 eventos ≈ 40 M eventos na hora da venda |
| Tamanho de um evento | ≈ 0,5–1 KB (JSON) | ≈ ilustrativo |
| Atualidade | streaming: segundos; lote: minutos a horas | Escolha por caso de uso |
| Contagem aproximada | HyperLogLog ≈ 1–2% de erro com poucos KB | Visitantes únicos sem guardar todos os ids |

**Modos de falha.**

- **Acúmulo no analytics** atrasa os dashboards → é assíncrono; escale os consumidores, aceite o atraso, nunca bloqueie o caminho de compra.
- **Contagem dupla** com entrega pelo menos uma vez → ids de evento e deduplicação, ou tolerar pequenos erros.
- **Deriva de schema** — um produtor muda o formato do evento e quebra os pipelines → schema registry, eventos versionados.
- **Partições quentes** — um evento enorme inunda uma partição → particione por uma chave bem distribuída.

**No playground.** `analytics` é um nó de **chamada** normalmente ligado de forma **assíncrona** (por um nó `stream`, `kafka` ou `pubsub`), fora do caminho da requisição: observe o atraso do consumidor crescer durante picos sem afetar a latência do usuário. Parâmetros: `replicas`, `capacity` (2.000 eventos/s), `latencyMs` (20 ms). Cenários: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout), [`url-shortener`](../../../../playground/scenarios/index.md#url-shortener).

**Produtos reais.**

=== "AWS"

    - **Amazon Data Firehose** — carrega eventos de streaming no S3, Redshift ou OpenSearch.
    - **Amazon Redshift** e **Amazon Athena** — warehouse e SQL sobre arquivos no S3.
    - **Amazon Managed Service for Apache Flink** — processamento de streams.

=== "GCP"

    - **BigQuery** — data warehouse serverless com ingestão por streaming.
    - **Dataflow** — Apache Beam gerenciado para processamento em stream e em lote.

=== "Azure"

    - **Azure Event Hubs** + **Azure Stream Analytics** — ingestão e processamento em tempo real.
    - **Microsoft Fabric** / **Azure Data Explorer** — plataforma de analytics e análise rápida de logs/telemetria.

=== "Código aberto"

    - **Apache Kafka** + **Apache Flink** ou **Spark Structured Streaming** — pipelines de streaming.
    - **ClickHouse**, **Apache Druid**, **Apache Pinot** — bancos OLAP em tempo real.
    - **Apache Superset**, **Grafana** — dashboards.

!!! tip "Na entrevista"
    "Analytics fica fora do caminho crítico: os serviços emitem eventos para o Kafka, um processador de streams mantém contadores em tempo real e tudo vai parar em um warehouse para relatórios. Os números podem chegar alguns segundos atrasados e ser um pouco aproximados — e tudo bem, porque invariantes como a contagem de assentos nunca vêm do analytics."

**Saiba mais:** [Bancos de dados › Especializados](../../../classes/databases/specialized/index.md) · [Mensageria › Kafka](../../../classes/messaging/kafka/index.md) · [Estudo de caso: encurtador de URL](../../../classes/case-studies/url-shortener/index.md) · [Estudo de caso: news feed](../../../classes/case-studies/news-feed/index.md)
