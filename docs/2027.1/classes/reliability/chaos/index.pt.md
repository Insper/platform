O BoxOffice agora tem timeouts, um retry com jitter, um circuit breaker, um bulkhead, um fallback, uma região em warm standby e uma política de backups. Eles funcionam? Os testes unitários passam. Mas ninguém nunca viu o breaker do pagamento abrir com tráfego real, ninguém nunca promoveu o banco standby, e ninguém sabe quanto tempo o failover regional realmente leva. A primeira vez em que algo disso vai importar será durante uma abertura de vendas real no estádio, com dois milhões de fãs assistindo. O único jeito de *saber* é causar as falhas você mesmo, de propósito, enquanto observa e está pronto.

A **engenharia do caos** é a disciplina de fazer experimentos em um sistema para ganhar confiança na sua capacidade de suportar condições turbulentas em produção[^1]. Em vez de esperar as falhas acontecerem, você as injeta deliberadamente, de forma controlada, e usa o que aprende para corrigir fraquezas antes que incidentes reais as encontrem.

> "The best way to avoid failure is to fail constantly." — John Ciancutti, Netflix, 2010[^4]

---

## De onde veio

A ideia é mais antiga que o nome. Na Amazon, no começo dos anos 2000, Jesse Robbins conduzia exercícios de **GameDay** que causavam deliberadamente falhas grandes em produção para expor fraquezas escondidas — no software e nos times que o operavam[^3].

A Netflix deu nome e ferramentas à prática. Depois de sair do próprio data center para a AWS, por volta de 2010 — onde qualquer instância pode sumir a qualquer momento —, ela criou o **Chaos Monkey**, um serviço que encerra instâncias de produção aleatórias **em horário comercial**, para que todo time precisasse construir serviços que sobrevivem à perda de instâncias, e os engenheiros estivessem em suas mesas para ver o que quebrava[^4]. Veio então todo um **Simian Army**: o Latency Monkey injetava atrasos nas chamadas, o Chaos Gorilla simulava a perda de uma zona de disponibilidade inteira. Em 2016, engenheiros da Netflix formalizaram a disciplina em um artigo da IEEE Software[^2], de onde vêm os princípios abaixo.

A percepção central: **falha não é um caso especial a evitar; é o ambiente em que os sistemas de produção vivem**, e o único jeito de saber se um sistema sobrevive a ela é testá-lo ali.

---

## Princípios

Os [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}[^1] definem a disciplina com cinco ideias:

**1. Construa uma hipótese sobre o comportamento em estado estável**
: Descreva o "normal" com saídas mensuráveis que importam para os usuários — os SLIs ([SLOs](../slo/index.md)): taxa de sucesso das compras, p99 das reservas, atualidade dos e-mails. A hipótese: *"o estado estável continua mesmo quando X acontece."*

**2. Varie eventos do mundo real**
: Injete falhas que de fato acontecem: perda de instâncias e de zonas, latência, perda de pacotes, uma dependência devolvendo erros, disco cheio, relógio desajustado, um pico de tráfego, um certificado expirado.

**3. Rode experimentos em produção**
: A homologação raramente tem o formato do tráfego, o volume de dados ou o comportamento das dependências da produção. Produção é o objetivo — alcançado aos poucos, não o primeiro passo.

**4. Automatize os experimentos para rodarem continuamente**
: Sistemas mudam todo dia; uma fraqueza corrigida hoje pode voltar com o deploy da semana que vem. Repita os experimentos automaticamente.

**5. Minimize o raio de impacto**
: Afete o menor número possível de usuários, tenha um botão de abortar e amplie o escopo só depois que experimentos menores passarem.

---

## O ciclo de vida de um experimento

Cada experimento segue o método científico: prever, mudar uma variável, medir, comparar[^5].

``` mermaid-sim
flowchart LR
    H["1. Hipótese<br/>estado estável + comportamento esperado"] --> D["2. Projeto<br/>falha, escopo, condições de aborto"]
    D --> I["3. Injeção<br/>da falha controlada"]
    I --> O["4. Observação<br/>SLIs, traces, estado do breaker"]
    O --> A["5. Análise<br/>esperado vs real"]
    A --> F["6. Melhoria<br/>corrigir, atualizar runbooks"]
    F -->|"repetir com escopo maior"| H
```

Um experimento que **confirma** a hipótese é evidência de que uma defesa funciona. Um que a **refuta** é uma *descoberta*: uma fraqueza encontrada no seu cronograma, com o time pronto, em vez de às 10:00 de um dia de vendas.

!!! example "Experimento: o provedor de pagamento fica lento"

    | Passo | Conteúdo |
    |---|---|
    | **Estado estável** | Sucesso das compras ≥ 99,9% e p99 das reservas < 500 ms; p99 do catálogo < 300 ms (dashboard do gateway do [Hands-on 8](../../../hands-on/8/index.md)). |
    | **Hipótese** | "Se o provedor de pagamento responder em 3 s em vez de 200 ms, o circuit breaker do `payment` abre em até 30 s, as compras falham rápido com 'pagamento temporariamente indisponível, lugares reservados', o bulkhead limita as chamadas ao pagamento a 50, e o catálogo e as reservas mantêm sua latência." |
    | **Injeção** | Toxiproxy entre o `payment` e o stub do provedor: um toxic de `latency` de 3 s ± 0,5 s, sob uma carga k6 de 100 compras/s. |
    | **Escopo e aborto** | Primeiro no ambiente Compose; depois em um pod canary. Abortar se o p99 do catálogo passar de 1 s ou se o error budget de compras queimar mais rápido que 10×. |
    | **Observação** | `resilience4j_circuitbreaker_state`, permissões livres do bulkhead, taxa de erros e p99 por rota, threads ocupadas do `order`, traces das compras lentas. |
    | **Descobertas possíveis** | O timeout de leitura nunca foi configurado, então chamadas lentas só contam depois de 60 s; o retry no gateway multiplica as chamadas; a mensagem do fallback é um 500 cru; o bulkhead é compartilhado com as chamadas ao `inventory`. |

---

## Injeção de falhas

| Categoria | Exemplos | Ferramentas |
|---|---|---|
| **Instância / processo** | Matar um pod, OOM-kill de um processo, encerrar uma VM | `kubectl delete pod`, `PodChaos` do Chaos Mesh, LitmusChaos, AWS FIS |
| **Rede** | Latência, perda de pacotes, limite de banda, partição, falha de DNS | Toxiproxy, `NetworkChaos` do Chaos Mesh, `tc netem` |
| **Dependência** | Erros ou respostas lentas de um serviço ou terceiro | Toxiproxy, WireMock, uma feature flag no cliente |
| **Recurso** | Pressão de CPU ou memória, disco cheio, esgotamento de descritores de arquivo | `stress-ng`, `StressChaos` do Chaos Mesh |
| **Estado e tempo** | Relógio desajustado, certificado expirado, entrada de cache corrompida, failover do banco | `TimeChaos` do Chaos Mesh, "reboot with failover" do banco gerenciado |
| **Infraestrutura** | Perder uma zona de disponibilidade ou uma região | AWS FIS, Azure Chaos Studio, mudanças de roteamento, o exercício de DR |

### Toxiproxy: caos no seu notebook

O [Toxiproxy](https://github.com/Shopify/toxiproxy){target="_blank"} é um proxy TCP com uma API para adicionar "toxics" — latência, timeouts, limites de banda, resets de conexão — a uma conexão. Coloque-o entre o `payment` e o stub do provedor no Docker Compose, e aponte o `payment` para o proxy:

```yaml
# docker-compose.yaml (excerpt)
services:
  toxiproxy:
    image: ghcr.io/shopify/toxiproxy:2.9.0
    ports:
      - "8474:8474"           # Toxiproxy API
  payment:
    environment:
      PROVIDER_URL: http://toxiproxy:8666   # instead of http://provider-stub:8080
```

```bash
# create the proxy: toxiproxy:8666 -> provider-stub:8080
toxiproxy-cli create -l 0.0.0.0:8666 -u provider-stub:8080 provider

# experiment 1: 3 s of latency (+/- 500 ms) on every response
toxiproxy-cli toxic add -t latency -a latency=3000 -a jitter=500 provider

# experiment 2: connections hang forever (a "black hole")
toxiproxy-cli toxic add -t timeout -a timeout=0 provider

# end of the experiment
toxiproxy-cli toxic remove -n latency_downstream provider
toxiproxy-cli toxic remove -n timeout_downstream provider
```

Rode o k6 antes, durante e depois de cada toxic e compare os números — esse é o passo "Meça" do [Hands-on 9](../../../hands-on/9/index.md).

### Chaos Mesh: caos no Kubernetes

No Kubernetes, os experimentos são declarados como recursos, versionados no Git e limitados no tempo:

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: payment-latency
  namespace: boxoffice
spec:
  action: delay
  mode: one                  # affect a single pod: small blast radius
  selector:
    namespaces: [boxoffice]
    labelSelectors:
      app: payment
  delay:
    latency: "3s"
    jitter: "500ms"
  duration: "10m"            # the experiment ends by itself
```

---

## Controlando o raio de impacto

O raio de impacto de um experimento é o conjunto de usuários e sistemas que ele pode afetar. Controlá-lo é o que separa engenharia de imprudência.

``` mermaid-sim
flowchart LR
    S1["1. Local / Compose<br/>nenhum usuário"] -->|"a hipótese se mantém"| S2["2. Homologação sob carga k6<br/>usuários internos"]
    S2 -->|"sem descobertas"| S3["3. Um pod canary em produção<br/>alguns % do tráfego"]
    S3 -->|"os SLIs se mantêm"| S4["4. Produção mais ampla<br/>uma zona, depois uma região"]
```

- **Condições de aborto ligadas aos SLOs**: pare automaticamente se o burn rate do error budget passar de um limite ou se um SLI-chave cair (o AWS FIS e o Chaos Mesh suportam condições de parada; no mínimo, uma pessoa com um botão).
- **Limitado no tempo**: todo experimento tem duração e se limpa sozinho.
- **Horário comercial, nunca durante uma abertura de vendas**: o time precisa estar presente; a política de error budget decide se dá para pagar o custo.
- **Avise**: o plantão e o time de suporte sabem que um experimento está rodando.

---

## Game days

Um **game day** é um exercício planejado, com o time todo, em que falhas são injetadas e as *pessoas* respondem como num incidente real. Experimentos automatizados testam o software; game days testam também os runbooks, os dashboards, os alertas e a comunicação.

!!! example "Game day da flash sale do BoxOffice"

    **Objetivo**: ensaiar uma abertura de vendas do estádio em homologação, em escala de produção (o k6 reproduzindo o pico das 10:00), e verificar que o caminho de compra cumpre seus SLOs sob cinco falhas injetadas uma de cada vez.

    | Horário | Injeção | Comportamento esperado | Medida |
    |---|---|---|---|
    | 10:00 | Começa o pico (sem falha) | A sala de espera admite na taxa configurada; SQL < 70% | SLIs de referência |
    | 10:10 | Latência de 3 s no provedor de pagamento | O breaker abre em < 30 s; lugares reservados; catálogo não afetado | Tempo para detectar (alerta), taxa de erros das compras |
    | 10:25 | Um pod do `order` morto por minuto | O readiness o remove; a capacidade N+1 absorve | Erros durante os reinícios |
    | 10:40 | Um broker Kafka parado | Os produtores fazem retry; o backlog do outbox cresce e escoa; nenhum e-mail perdido | Idade do outbox, consumer lag, SLI de atualidade dos e-mails |
    | 10:55 | Failover do banco para o standby | ~30 s de erros nas escritas, depois recuperação | RTO real vs esperado |
    | 11:10 | Cache Redis esvaziado | A proteção contra stampede se mantém; o pico de carga no SQL fica abaixo do limite | CPU do SQL, p99 do catálogo |

    **Papéis**: um *mestre do jogo* (injeta, controla o tempo, decide abortar), os *responsáveis do plantão* (que não conhecem o roteiro), *observadores* por serviço e um *escriba* (linha do tempo). **Depois**: um debrief sem culpados (o que esperávamos, o que aconteceu, o que nos surpreendeu), com itens de ação com responsável e data.

!!! info "Experimente no playground"

    Carregue o cenário `flash-sale` com o **caos** em *medium*: o simulador injeta picos de latência e falhas de instâncias aleatórios enquanto o tráfego da abertura roda. Aperte **Run** e observe qual componente degrada primeiro e se o painel de SLO continua verde. Depois torne o seu projeto mais resiliente (mais réplicas, um cache, uma taxa de admissão menor) e rode de novo com a mesma seed para comparar.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-profile="chaos" data-chaos="medium" data-seed="42" data-height="560"></div>

!!! tip "Cultura sem culpados é pré-requisito"
    Experimentos de caos e game days só funcionam se as pessoas puderem expor problemas com segurança. Se uma descoberta leva a culpa, os times param de relatar com honestidade e as fraquezas continuam escondidas. O resultado de um game day é uma lista de melhorias, não uma lista de culpados (veja [Resposta a incidentes](../../observability/incident-response/index.md)).

---

## Verificação contínua

Depois que um experimento passa, mantenha-o passando:

- **No CI**: testes de integração com Toxiproxy (o Testcontainers tem um módulo de Toxiproxy) verificam que o cliente desiste depois do timeout e que o breaker abre — barato, em todo build.
- **Agendado em homologação**: workflows do Chaos Mesh ou do LitmusChaos rodam os experimentos padrão toda noite contra o último deploy.
- **Em produção, pequeno**: um pod-kill recorrente num canary, uma restauração mensal de backup, um exercício de failover regional duas vezes por ano ([Recuperação de desastres](../disaster-recovery/index.md)).

---

## Observabilidade primeiro

Caos sem observabilidade é só quebrar coisas. Antes de injetar qualquer coisa, você precisa conseguir:

1. **Ver o estado estável** — dashboards de SLI com valores de referência.
2. **Detectar o desvio** — alertas que disparam em minutos (alertas de burn rate).
3. **Explicá-lo** — traces que mostram qual chamada ficou lenta, métricas de breakers e pools.
4. **Pará-lo** — um botão de abortar que funciona em segundos.

> Observabilidade primeiro, depois padrões de resiliência, depois experimentos de caos para provar que os padrões funcionam.

| Ferramenta | Mantida por | Pontos fortes |
|---|---|---|
| [Toxiproxy](https://github.com/Shopify/toxiproxy){target="_blank"} | Shopify (open source) | Proxy TCP simples; ideal para testes locais e no CI |
| [Chaos Mesh](https://chaos-mesh.org){target="_blank"} | CNCF | Nativo de Kubernetes; falhas de rede, pod, estresse, tempo, I/O; workflows |
| [LitmusChaos](https://litmuschaos.io){target="_blank"} | CNCF | Nativo de Kubernetes; hub de experimentos; amigável a GitOps |
| [AWS Fault Injection Service](https://aws.amazon.com/fis/){target="_blank"} | Amazon | Gerenciado; falhas no nível da AWS (energia de AZ, erros de API); condições de parada |
| [Azure Chaos Studio](https://azure.microsoft.com/products/chaos-studio){target="_blank"} | Microsoft | Caos gerenciado para recursos do Azure |
| [Gremlin](https://www.gremlin.com){target="_blank"} | Gremlin Inc. | Plataforma comercial; biblioteca ampla de falhas; pontuação de confiabilidade |
| [Chaos Monkey](https://github.com/Netflix/chaosmonkey){target="_blank"} | Netflix | Encerramento aleatório de instâncias; o original |

!!! tip "Na entrevista"
    Depois de propor mecanismos de resiliência, diga como você os **verificaria**: "eu rodaria um experimento de caos com uma hipótese de estado estável sobre o SLO de compra — injetar 3 s de latência no provedor de pagamento em um pod canary, esperar que o breaker abra em até 30 s e que a latência do catálogo fique estável, com aborto automático se o burn rate passar de 10×". Isso mostra que você sabe que failover e fallbacks não testados são o motivo mais comum de projetos aparentemente resilientes falharem.

!!! warning "Armadilhas comuns"

    - **Caos sem hipótese**: se você não disse o que deveria acontecer, não aprende com o que aconteceu.
    - **Começar em produção** com um raio de impacto grande — produção é o destino, não o ponto de partida.
    - **Sem botão de abortar**, ou com um aborto que depende do sistema sendo testado.
    - **Rodar durante uma abertura de vendas** ou com o error budget esgotado.
    - **Descobertas que nunca viram tickets**: o experimento consumiu orçamento e não ensinou nada.
    - **Testar só crashes**: latência e falhas parciais são as que causam cascatas.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    SS["estado estável = SLIs<br/>→ SLOs"] --> HYP["hipótese"]
    HYP --> INJ["injetar: Toxiproxy,<br/>Chaos Mesh, AWS FIS"]
    LOAD["carga do k6 durante o teste<br/>→ Performance"] --> INJ
    INJ --> PAT["defesas sob teste:<br/>breaker, bulkhead, fallback"]
    INJ --> DR["failover, restauração<br/>→ Recuperação de desastres"]
    OBS["métricas, traces, alertas de burn rate<br/>→ Observabilidade"] --> OA["observar e abortar"]
    PAT --> OA
    DR --> OA
    OA --> BR["ampliar o raio de impacto:<br/>local → canário → zona"]
    OA --> GD["game day + debrief sem culpados<br/>→ Resposta a incidentes"]
    GD --> HYP
```

**Componentes da paleta:** [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (o stub do provedor atrás do Toxiproxy) · [`app`](../../../reference/components/compute/index.md#app) (pods de `order` derrubados durante o game day) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (um broker parado) · [`sql`](../../../reference/components/storage/index.md#sql) (failover para o standby) · [`cache`](../../../reference/components/storage/index.md#cache) (Redis esvaziado: proteção contra stampede) · [`metrics`](../../../reference/components/observability/index.md#metrics) · [`tracing`](../../../reference/components/observability/index.md#tracing) · [`alerting`](../../../reference/components/observability/index.md#alerting) (sem eles não há caos possível). **Cenários:** `flash-sale` (perfil chaos), `cascading-failure`. **Continua em:** [Observabilidade — resposta a incidentes](../../observability/incident-response/index.md), [Performance — testes de carga](../../performance/load-testing/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Hands-on 9 — pagamento e Toxiproxy](../../../hands-on/9/payment/index.md), [Projeto — game day](../../../exercises/project/game-day/index.md).

---

[^1]: [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}. principlesofchaos.org.
[^2]: BASIRI, A. et al. [Chaos Engineering](https://ieeexplore.ieee.org/document/7436642){target="_blank"}. *IEEE Software*, v. 33, n. 3, p. 35–41, 2016.
[^3]: ROBBINS, J. et al. [Resilience Engineering: Learning to Embrace Failure](https://queue.acm.org/detail.cfm?id=2371297){target="_blank"}. *ACM Queue*, v. 10, n. 9, 2012.
[^4]: CIANCUTTI, J. [5 Lessons We've Learned Using AWS](https://techblog.netflix.com/2010/12/5-lessons-weve-learned-using-aws.html){target="_blank"}. Netflix Tech Blog, dez. 2010.
[^5]: ROSENTHAL, C.; JONES, N. *Chaos Engineering: System Resiliency in Practice*. O'Reilly, 2020.
