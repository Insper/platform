
Sábado, 9h59. Um show de estádio abre as vendas às 10h00 no BoxOffice: 2 milhões de fãs para 60 mil lugares. Às 10h04 o canal de suporte se enche de "o checkout fica girando para sempre". O time abre os dashboards: todos os pods estão verdes, a CPU está em 45%, a taxa de erros é de 0,3%, os health checks passam. E mesmo assim o fã mediano espera nove segundos para pagar. É o gateway? As reservas de assento no `inventory`? O provedor de pagamentos externo? O banco de dados? Quatro times entram numa call e cada um mostra um dashboard provando que o *seu* serviço está bem.

É para esse momento que a observabilidade existe. O sistema não está *fora do ar* — está *lento de um jeito que ninguém previu*, e a única saída é fazer perguntas novas ao sistema em execução e obter respostas em minutos, não em dias. Esta aula trata de projetar um sistema para que essas perguntas possam ser respondidas: quais sinais emitir, como carregar o contexto entre serviços, quando acordar um humano e como conduzir o incidente depois que alguém acordou.

!!! quote "A história até aqui"

    Capítulo 9 da [história do curso](../../index.md#story). A [aula 8](../messaging/index.md) tirou o trabalho lento da requisição: o pedido vai para um outbox, passa pelo Kafka e chega ao `notification`, e uma sala de espera deixa a multidão entrar no ritmo que o `inventory` consegue atender. A assincronia tem um preço: as falhas deixam de aparecer nas requisições. Um pedido confirmado às 10h01 cujo e-mail nunca chega não gerou nenhum `5xx` nem endpoint lento — sumiu em algum ponto entre o outbox, o Kafka e o consumidor —, e dashboards de causas (pods, CPU, médias) continuam verdes enquanto os fãs falham, como na manhã acima. **Esta aula** responde: o que o BoxOffice precisa emitir para seguir um pedido entre serviços e pelo Kafka, contra qual promessa o medimos (o [SLO](slo/index.md)) e quem é acordado quando a promessa quebra?

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Distinguir** monitoramento de observabilidade e **mapear** os cinco componentes de observabilidade da paleta (métricas, logs, tracing, alertas, health checks) para as perguntas que eles respondem.
    - **Instrumentar** um serviço com o sinal certo para cada pergunta, aplicando **RED**, **USE** e os **golden signals**, e **estimar** o custo e a cardinalidade da telemetria que ele produz.
    - **Explicar** como o OpenTelemetry propaga o contexto de trace por HTTP e Kafka, e **configurar** um pipeline do Collector com amostragem.
    - **Definir** SLIs e SLOs para as jornadas de usuário do BoxOffice e **calcular** error budgets e burn rates.
    - **Projetar** alertas baseados em SLO com regras *multiwindow, multi-burn-rate* e **roteá-los** para as pessoas certas.
    - **Configurar** probes de liveness, readiness e startup sem causar reinícios em cascata.
    - **Conduzir** um incidente com papéis claros e **escrever** um postmortem *blameless* com ações concretas.

## Roteiro { #roadmap }

1. **Esta visão geral** — monitoramento vs observabilidade, a paleta de observabilidade, o ciclo de investigação, health checks e quanto custa a telemetria.
2. [Sinais](signals/index.md) — métricas, logs, traces e profiles; RED, USE e golden signals; cardinalidade; dashboards.
3. [SLIs, SLOs e error budgets](slo/index.md) — a confiabilidade do ponto de vista do usuário: o que medir, que meta prometer e como gastar o orçamento.
4. [OpenTelemetry](opentelemetry/index.md) — o padrão neutro de fornecedor: propagação de contexto, instrumentação, o Collector, amostragem e backends.
5. [Alertas](alerting/index.md) — alertas baseados em sintomas, burn rate do SLO, regras multiwindow, roteamento e runbooks.
6. [Resposta a Incidentes](incident-response/index.md) — on-call, severidades, papéis no incidente, mitigar primeiro, postmortems.
7. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/observability.html" title="Slides: observabilidade" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/observability.html){:target="_blank"}

---

## Monitoramento vs observabilidade { #monitoring-vs-observability }

As duas palavras costumam ser usadas como sinônimos, mas descrevem capacidades diferentes.

**Monitoramento** (*monitoring*) acompanha um conjunto de indicadores **pré-definidos** e avisa quando um deles cruza um limiar: "taxa de erros acima de 1%", "disco acima de 90%". Ele responde a perguntas que você sabia que deveria fazer quando montou o dashboard — os *known unknowns*.

**Observabilidade** é uma propriedade do sistema: o quão bem você consegue inferir seu **estado interno a partir de suas saídas externas**[^1]. O termo vem da teoria de controle (Kalman, 1960); em software, significa que, sem publicar código novo, você consegue fazer uma pergunta em que nunca tinha pensado — "por que só os checkouts com mais de quatro ingressos, pagos com uma bandeira de cartão, estão lentos desde 10h02?" — e respondê-la a partir da telemetria que o sistema já emite[^2]. Esses são os *unknown unknowns*, e sistemas distribuídos estão cheios deles.

| | Monitoramento | Observabilidade |
|---|---|---|
| Tipo de pergunta | conhecida de antemão ("X está acima de Y?") | descoberta durante a investigação ("o que as requisições lentas têm em comum?") |
| Saída típica | dashboard, alerta por limiar | consulta ad hoc, trace, quebra por muitas dimensões |
| Dados necessários | métricas agregadas | métricas **mais** eventos ricos: logs, traces, profiles com muitos atributos |
| Funciona bem para | falhas que você já viu antes | falhas novas, comportamento emergente de muitos serviços |
| Modo de falha | dashboards verdes enquanto os usuários sofrem | custo alto se todo detalhe for guardado para sempre |

O monitoramento não está obsoleto — ele é um *subconjunto*. Você ainda precisa de dashboards e alertas sobre sintomas conhecidos; a observabilidade é o que permite ir de "o alerta disparou" a "esta é a causa" quando a causa é nova.

??? question "Pense antes: por que os dashboards do BoxOffice estavam verdes?"

    Os dashboards acompanhavam **causas** escolhidas de antemão — CPU, memória, status dos pods, a taxa de erros — em média sobre todos os endpoints. O problema do checkout era de **latência**, em **uma rota**, concentrado na **cauda** (p99), causado por uma dependência fora do BoxOffice. Uma média sobre todas as rotas o esconde duas vezes: as outras rotas diluem a rota de checkout, e a requisição mediana esconde as lentas. A solução não é "mais dashboards": é medir o que os usuários sentem por jornada (percentis de latência do `POST /checkout`) e ter traces para ver *onde*, dentro da requisição, o tempo foi gasto.

---

## A paleta de observabilidade { #the-observability-palette }

No [System Design Playground](../../../playground/index.md), a categoria OBSERVABILITY tem cinco componentes. Cada um responde a uma pergunta diferente, e cada um é consumido por alguém diferente — um humano investigando, um humano sendo acordado, ou uma máquina tomando uma decisão de roteamento.

| Componente | Pergunta que responde | Consumidor | Custo relativo | Detalhes |
|---|---|---|---|---|
| [**Metrics**](../../reference/components/observability/index.md#metrics) | *Há* algo errado? Quanto, desde quando, com que tendência? | dashboards, regras de alerta | baixo (números agregados) | [Sinais](signals/index.md#metrics) |
| [**Logs**](../../reference/components/observability/index.md#logs) | O que *exatamente* aconteceu neste evento? | humanos investigando, auditorias | alto (um registro por evento) | [Sinais](signals/index.md#logs) |
| [**Tracing**](../../reference/components/observability/index.md#tracing) | *Onde*, no caminho da requisição, foram o tempo ou o erro? | humanos investigando | médio–alto (amostrado) | [Sinais](signals/index.md#traces), [OpenTelemetry](opentelemetry/index.md) |
| [**Alerting**](../../reference/components/observability/index.md#alerting) | Um *humano* precisa agir *agora*? | engenheiro de on-call | baixo | [Alertas](alerting/index.md) |
| [**Health Check**](../../reference/components/observability/index.md#healthcheck) | Esta *instância* deve receber tráfego ou ser reiniciada? | load balancer, Kubernetes | muito baixo | [abaixo](#health-checks) |

Todos descrevem os mesmos eventos de ângulos diferentes. Um único `POST /checkout` lento às 10h04 produz:

- uma amostra no **histograma** de latência do `order` (métrica) — barata, agregada, sem ideia de *qual* checkout;
- uma linha de **log** estruturada `{"level":"WARN","msg":"payment call slow","trace_id":"4bf9…","duration_ms":8120}` — precisa, cara em volume;
- um **trace** com spans para gateway → order → inventory → payment, com o span de pagamento levando 8,1 s — mostra *onde*;
- possivelmente uma amostra de **profile** mostrando threads paradas no cliente HTTP — mostra *qual código*;
- e, se checkouts suficientes ficarem lentos por tempo suficiente, um **alerta** que aciona o engenheiro de on-call.

A cola entre eles é o **contexto**: o mesmo `trace_id` na linha de log, no trace e anexado à amostra da métrica (um *exemplar*). Sem contexto compartilhado, você tem três ferramentas desconectadas; com ele, tem uma única investigação.

---

## O ciclo de investigação { #the-investigation-loop }

A observabilidade se paga como um ciclo repetível que vai de sinais baratos e agregados para sinais caros e detalhados — estreitando a busca a cada passo. Execute o diagrama:

``` diagram-sim
flowchart LR
    A["Alerta<br/>SLO do checkout queimando 14×"] --> D["Dashboard RED<br/>qual serviço? qual rota?"]
    D --> E["Exemplar<br/>trace_id de uma requisição lenta"]
    E --> T["Trace<br/>qual span está lento?"]
    T --> L["Logs daquele span<br/>por quê? (erro, retry, timeout)"]
    L --> P["Profile<br/>qual caminho de código?"]
    P --> M["Mitigar<br/>rollback, breaker, failover"]
    M --> PM["Postmortem<br/>evitar a classe de falha"]
```

1. **Detectar** com um alerta baseado em SLO sobre um sintoma que os usuários sentem ([Alertas](alerting/index.md)).
2. **Localizar** com métricas: o dashboard RED mostra que o p99 do `POST /checkout` foi de 400 ms para 9 s; as outras rotas estão normais.
3. **Escolher um exemplo**: um painel de latência com exemplars liga uma amostra lenta ao seu `trace_id`.
4. **Encontrar o salto**: o *waterfall* do trace mostra 8 dos 9 segundos dentro do span `payment`, na chamada ao provedor externo.
5. **Explicar**: os logs daquele span mostram `connection pool exhausted, waited 7.9 s` — o provedor está lento, e o `payment` tem um pool de 20 conexões.
6. **Mitigar primeiro**, entender depois ([Resposta a Incidentes](incident-response/index.md)): abrir o circuit breaker, colocar os checkouts numa fila ou trocar de provedor.
7. **Aprender**: o postmortem pergunta por que um provedor lento conseguiu fazer o checkout inteiro de refém — e adiciona um timeout, um bulkhead e um alerta sobre a latência do provedor.

!!! example "BoxOffice — o caminho crítico de um checkout"

    O checkout da venda relâmpago atravessa cinco serviços do BoxOffice e uma dependência externa: `gateway` → `order` → `inventory` (confirma a reserva do assento, PostgreSQL) → `payment` (adaptador) → **provedor de pagamentos externo**, e então o `order` publica `OrderConfirmed` no Kafka, consumido pelo `notification` (e-mail/push). Cada seta é um lugar onde o tempo pode sumir, e o provedor externo é o único lugar onde o BoxOffice não consegue adicionar instrumentação — só medir as chamadas que faz.

### Veja no simulador { #see-it-in-the-simulator }

**Experimente.** Em t = 50 s uma das três réplicas do `catalog` morre. Aperte *Run* sem mudar nada: todo serviço mostra a utilização como "?" (nada é medido), e por 30 s o balanceador continua mandando um terço das requisições para a réplica morta — cerca de 33% de erros de t = 51 s a 80 s, 93,8% de disponibilidade na execução. Adicione **Metrics** e conecte ao balanceador, à aplicação e ao banco: os números aparecem, mas os fãs veem exatamente os mesmos erros — medir não conserta nada sozinho. Depois adicione um **Health Check** conectado ao balanceador: a réplica morta sai da rotação em 3 s em vez de 30 s, e a disponibilidade sobe para 99,4%. O que o último componente, **Alerting**, muda está em [Alertas](alerting/index.md#machines-detect-people-repair).

<div class="sdp" data-scenario="observability-stack" data-mode="compact" data-height="520"></div>

O simulador completo está no [System Design Playground](../../../playground/index.md).

---

## Health checks { #health-checks }

Um health check é o sinal mais simples e o único consumido por **máquinas**: um load balancer, um orquestrador ou um sistema de service discovery chama um endpoint e decide se uma instância deve **receber tráfego** ou ser **reiniciada**. Como as máquinas agem sobre ele automaticamente e em escala, um health check mal projetado é uma das causas clássicas de indisponibilidade total.

O Kubernetes distingue três probes[^3], e a distinção é o ponto principal:

| Probe | Pergunta | Em caso de falha | Deve verificar |
|---|---|---|---|
| **Startup** | O processo terminou de iniciar? | continua esperando (as outras probes ficam pausadas); mata após o limite | a aplicação foi inicializada (aquecimento da JVM, migrations concluídas) |
| **Liveness** | O processo travou sem conserto? | **reinicia** o container | só o próprio processo: o event loop / pool de threads responde |
| **Readiness** | Esta instância consegue atender requisições *agora*? | **remove do load balancer** (sem reiniciar) | consegue fazer trabalho útil: caches aquecidos, recursos locais necessários |

``` diagram-sim
stateDiagram-v2
    [*] --> Iniciando : container criado
    Iniciando --> Pronto : startup ok, readiness ok
    Iniciando --> Reiniciando : limite de startup excedido
    Pronto --> NaoPronto : readiness falha (sobrecarga, drenando)
    NaoPronto --> Pronto : readiness ok de novo
    Pronto --> Reiniciando : liveness falha (deadlock)
    NaoPronto --> Reiniciando : liveness falha
    Reiniciando --> Iniciando : novo container
```

Com o Spring Boot Actuator, as probes são grupos de health separados, expostos em `/actuator/health/liveness` e `/actuator/health/readiness`[^4]:

```yaml
# application.yaml (order service)
management:
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: readinessState
        liveness:
          include: livenessState
```

```yaml
# Deployment (excerpt) — the order container
startupProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 5
  failureThreshold: 24        # up to 2 minutes to start
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3         # 30 s of failures before a restart
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  periodSeconds: 5
  failureThreshold: 2
```

### Checks rasos vs profundos { #shallow-vs-deep-checks }

Um check **raso** (*shallow*) responde "meu processo está vivo?". Um check **profundo** (*deep*) também chama as dependências — o banco de dados, o Redis, o provedor de pagamentos. Checks profundos parecem mais honestos, e essa é justamente a armadilha.

!!! warning "A cascata do check profundo"

    Suponha que a probe de readiness do `order` inclua a conexão com o PostgreSQL. O banco faz um failover de 20 segundos. Todos os pods do `order` falham a readiness no mesmo instante, o Kubernetes remove **todos** eles do Service, e o gateway passa a devolver `503` para todas as rotas — inclusive as que só leem do Redis. Pior: se a probe de *liveness* incluir o banco, o Kubernetes **reinicia** todos os pods ao mesmo tempo; todos sobem frios, martelam juntos o banco enquanto ele volta, e a indisponibilidade se prolonga sozinha.

    Regras práticas: **a liveness nunca verifica dependências**; a readiness verifica só o que *esta* instância precisa localmente e o que *outra* instância não resolveria; a saúde das dependências pertence a **métricas e alertas**, e dependências degradadas são tratadas com timeouts, circuit breakers e fallbacks ([Padrões de resiliência](../reliability/patterns/index.md)).

| | Raso (só o processo) | Profundo (processo + dependências) |
|---|---|---|
| Detecta | processo caído ou travado | dependência quebrada também |
| Risco | instância "saudável" mas inútil se uma dependência cair | **falha correlacionada**: todas as instâncias falham juntas → indisponibilidade total, tempestades de reinício |
| Custo | trivial | cada probe chama a dependência (N pods × a cada 5 s) |
| Use para | liveness, checks do load balancer | readiness *apenas* para dependências que uma instância possui; caso contrário, um endpoint de status separado para humanos |

Os load balancers na borda usam a mesma ideia (veja [Balanceamento de carga](../edge/load-balancing/index.md)): removem um backend após N checks com falha e o recolocam após M sucessos — a histerese evita oscilação.

---

## Quanto custa a telemetria { #what-telemetry-costs }

Observabilidade não é de graça e, numa entrevista — ou na fatura da nuvem —, você precisa raciocinar sobre seu volume como sobre qualquer outra carga de trabalho. Uma estimativa de guardanapo para o BoxOffice num dia normal, com premissas ilustrativas:

| Premissa | Valor |
|---|---|
| Tráfego médio | 500 requisições/s |
| Spans por requisição (gateway, order, inventory, BD, payment, Kafka…) | 8 |
| Tamanho médio de um span (com atributos) | 500 bytes |
| Linhas de log por requisição (todos os serviços) | 5, de 300 bytes cada |

$$
\text{traces} = 500 \times 8 \times 500\ \text{B} = 2\ \text{MB/s} \approx 173\ \text{GB/dia}
\qquad
\text{logs} = 500 \times 5 \times 300\ \text{B} = 0{,}75\ \text{MB/s} \approx 65\ \text{GB/dia}
$$

Com 100% de amostragem de traces, são mais de 5 TB de traces por mês — antes de a venda relâmpago multiplicar o tráfego por 50. Daí as três alavancas de custo que você verá nesta aula:

- **Amostrar** traces (guardar os interessantes — erros e requisições lentas — e uma pequena parte do resto), veja [OpenTelemetry](opentelemetry/index.md#sampling).
- **Cardinalidade limitada** nas métricas (nada de IDs de usuário em labels), veja [Sinais](signals/index.md#cardinality).
- **Níveis, amostragem e camadas de retenção** para logs (DEBUG desligado em produção, 7–30 dias em armazenamento quente, depois object storage barato).

## O mapa de conceitos da observabilidade { #concept-map }

Os cinco componentes de observabilidade descrevem as mesmas requisições por ângulos diferentes, e o contexto compartilhado (exemplars, `trace_id`) os transforma numa única investigação. O mapa liga cada **componente da paleta** (verde) aos **conceitos** de que ele depende (azul) e às aulas que os continuam:

``` diagram
flowchart LR
    svc["app · worker<br/>(BoxOffice services)"]:::comp --> metrics["metrics"]:::comp
    svc --> tracing["tracing"]:::comp
    svc --> logs["logs"]:::comp
    metrics -->|"exemplar"| tracing
    tracing -->|"trace_id"| logs
    metrics --> alerting["alerting"]:::comp
    hc["healthcheck"]:::comp -->|"probes"| svc
    metrics -.- c1["RED, USE, golden signals,<br/>histograms, cardinality"]:::tech
    logs -.- c2["structured logs,<br/>levels, redaction"]:::tech
    tracing -.- c3["traceparent, Collector,<br/>tail sampling"]:::tech
    alerting -.- c4["SLO burn rate, multiwindow,<br/>routing, runbooks"]:::tech
    hc -.- c5["liveness, readiness, startup,<br/>shallow vs deep"]:::tech
    c4 --> c6["incident roles, mitigate first,<br/>postmortems"]:::tech
    c4 -.- d1["SLI, SLO, error budget<br/>(class 9)"]
    c5 -.- d2["Kubernetes probes, LB checks<br/>(classes 4 and 11)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`metrics`](../../reference/components/observability/index.md#metrics) | *Há* algo errado? Quanto, desde quando? | counters, gauges, histogramas, RED, USE, golden signals, cardinalidade, PromQL | [Sinais — métricas](signals/index.md#metrics), [cardinalidade](signals/index.md#cardinality) | `observability-stack`, `event-fanout` (consumer lag) |
| [`logs`](../../reference/components/observability/index.md#logs) | *O que exatamente* aconteceu neste evento? | logs estruturados, níveis, `trace_id` / `span_id`, Loki vs Elasticsearch, camadas de retenção | [Sinais — logs](signals/index.md#logs) | `observability-stack` |
| [`tracing`](../../reference/components/observability/index.md#tracing) | *Onde* foi parar o tempo ou o erro? | spans, caminho crítico, `traceparent`, Collector, amostragem head vs tail, exemplars | [Sinais — traces](signals/index.md#traces), [OpenTelemetry](opentelemetry/index.md) | `observability-stack`, `cascading-failure` (o span lento do provedor) |
| [`alerting`](../../reference/components/observability/index.md#alerting) | Um *humano* precisa agir *agora*? | sintomas vs causas, burn rate, regras multijanela, roteamento, dead man's switch, runbooks | [Alertas](alerting/index.md), [Resposta a Incidentes](incident-response/index.md) | `observability-stack`, `flash-sale` |
| [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | Esta *instância* deve receber tráfego ou ser reiniciada? | startup, liveness, readiness, checks rasos vs profundos, histerese | [esta visão geral](#health-checks) | `scale-out`, `observability-stack` |

!!! tip "Na entrevista"

    Observabilidade é a resposta padrão para "como você saberia que funciona?" e pertence ao **fechamento** de todo design. Diga de forma concreta, num fôlego só: *"Eu definiria um SLO para o checkout — 99,9% dos checkouts com sucesso em menos de 2 s em 28 dias — e alertaria sobre o burn rate dele; dashboards RED por serviço; traces OpenTelemetry com tail sampling que guarda todo erro e todo trace lento; logs estruturados com o trace ID; e probes de readiness que não dependem do banco."* Depois mencione uma coisa específica do problema que você acompanharia: consumer lag para uma fila, hit ratio para um cache, replication lag para réplicas.

!!! success "Boas práticas"

    - **Escreva o SLO antes do primeiro dashboard** — o SLI e sua meta decidem quais métricas, buckets de histograma e alertas você precisa; todo o resto é apoio ao diagnóstico. No BoxOffice: [Hands-on 8 — SLO e alerta de burn rate](../../hands-on/8/slo/index.md) (99,5% das requisições do `catalog` em 28 dias).
    - **Marque todo sinal com `service.name`, versão e ambiente** — é o que permite comparar um canary com a versão estável, ou os erros de um serviço com os de outro, em métricas, traces e logs. No BoxOffice: a âncora `x-otel` de [OpenTelemetry](opentelemetry/index.md).
    - **Mantenha dashboards e regras de alerta no repositório, provisionados na inicialização** — revisados como código, idênticos em todo ambiente e recriados depois de um `down -v` sem cliques. No BoxOffice: `infra/grafana/` no [Hands-on 8](../../hands-on/8/index.md).
    - **Orce a telemetria como qualquer outra carga de trabalho** — estime-a antes de ligá-la (2 MB/s de spans a 500 req/s, [acima](#what-telemetry-costs)) e defina amostragem e retenção por sinal.
    - **Rode o monitoramento fora do domínio de falha que ele observa** — uma stack de monitoramento no mesmo cluster ou zona morre junto com o incidente que deveria relatar; pelo menos a entrega de alertas e um heartbeat precisam viver em outro lugar ([Alertas](alerting/index.md)).

!!! warning "Armadilhas comuns"

    - **Dashboards de causas, alertas sobre causas**: CPU, memória e contagem de pods verdes enquanto os usuários sofrem. Meça o que os usuários sentem.
    - **Médias**: uma latência média esconde a cauda; use percentis ou "fração de requisições mais rápidas que X".
    - **Sem contexto compartilhado**: logs sem `trace_id` e métricas sem exemplars obrigam você a correlacionar por horário — à mão, às 3 da manhã.
    - **Probes de liveness profundas**: uma indisponibilidade de dependência vira uma tempestade de reinícios.
    - **Instrumentar depois do incidente**: a telemetria precisa ser projetada desde o início, como qualquer outro requisito; não dá para consultar dados que você não emitiu.

---

## Relacionados { #related }

- [Hands-on 8 — Observabilidade](../../hands-on/8/index.md): auto-instrumentação com OpenTelemetry e `grafana/otel-lgtm` no BoxOffice; dashboard RED, traces e um alerta de burn rate.
- [Hands-on 9 — Resiliência e caos](../../hands-on/9/index.md) e [Hands-on 10 — Kubernetes](../../hands-on/10/index.md): probes, falhas com Toxiproxy, e como observá-las na telemetria.
- [Confiabilidade](../reliability/index.md) e [SLOs](slo/index.md): SLIs, SLOs e error budgets — o que os alertas desta aula fazem cumprir.
- [Engenharia de desempenho](../performance/index.md): testes de carga só são úteis se você conseguir ver *por que* o sistema entorta.
- [Exercício: relatório de teste de carga](../../exercises/load-test-report/index.md) e o [game day](../../exercises/project/game-day/index.md) do projeto.
- Estudo de caso: [Ticketing (venda relâmpago do BoxOffice)](../case-studies/ticketing/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - **Monitoramento** responde perguntas conhecidas; **observabilidade** permite investigar perguntas novas a partir da telemetria que o sistema já emite.
    - Os cinco componentes da paleta respondem perguntas diferentes: **métricas** (há algo errado?), **logs** (o que aconteceu?), **traces** (onde?), **alertas** (um humano precisa agir agora?), **health checks** (esta instância deve receber tráfego?).
    - O **ciclo de investigação** vai de agregados baratos a detalhes caros: alerta → dashboard → exemplar → trace → logs → profile → mitigar → postmortem. O **contexto** compartilhado (`trace_id`) faz disso uma só investigação.
    - **A liveness nunca verifica dependências**; checks profundos transformam uma oscilação de dependência numa indisponibilidade total ou numa tempestade de reinícios.
    - Telemetria é uma carga de trabalho: estime seu volume e controle-o com **amostragem**, **cardinalidade limitada** e **camadas de retenção**.

## O que quebra em seguida { #what-breaks-next }

O BoxOffice agora se enxerga: um SLO com alerta de burn rate, um dashboard RED e um trace por pedido, da borda ao e-mail passando pelo Kafka — no lab 8, parar o banco aciona alguém em cerca de cinco minutos (288 s numa execução de teste). Enxergar não é sobreviver. Às 10h02 o provedor de pagamentos responde em 4 s em vez de 200 ms: o dashboard mostra o p95 do `order` subindo, o trace põe o tempo na chamada de pagamento, o alerta dispara — e o checkout morre mesmo assim, porque toda thread do `order` está esperando o provedor e não sobra nenhuma nem para as requisições que nunca o tocam. A observabilidade encurta o tempo para *entender* uma falha; impedir que uma dependência lenta derrube tudo — timeouts, circuit breakers, bulkheads e experimentos de caos que os comprovem — é a [aula 10 — Confiabilidade](../reliability/index.md).

---

[^1]: KALMAN, R. E. On the general theory of control systems. *Proceedings of the First IFAC Congress*, 1960. O termo chegou às operações de software pelas mãos de engenheiros do Twitter e da Honeycomb na década de 2010.
[^2]: MAJORS, C.; FONG-JONES, L.; MIRANDA, G. *Observability Engineering*. O'Reilly, 2022. Capítulos 1–3.
[^3]: KUBERNETES. [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/){target="_blank"}.
[^4]: SPRING. [Spring Boot Actuator — Kubernetes Probes](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html#actuator.endpoints.kubernetes-probes){target="_blank"}.
