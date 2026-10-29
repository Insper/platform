# 8. Observabilidade { #8-observability }

!!! info "Objetivo"

    Fazer o BoxOffice se explicar. Conectar o **agente Java do OpenTelemetry** a todos os serviços e
    enviar traces, métricas e logs para o **`grafana/otel-lgtm`**; construir um **dashboard RED** como
    código; seguir um pedido da borda até o e-mail, passando pelo Kafka, em um único **trace**; e
    transformar uma promessa aos usuários em um **SLO** com um **alerta de *burn rate* com múltiplas
    janelas** — depois derrubar o banco de dados e cronometrar quanto tempo o alerta leva para disparar.

A venda relâmpago entrou no ar e o canal de suporte enche: *"o checkout está lento"*, *"a página
mostra um erro"*. É com todos os fãs ou com alguns? Qual dos sete serviços? O banco, o pool, o Kafka,
o provedor de e-mail? Até agora o único instrumento era o k6, que mede de fora. Este lab adiciona a
visão de dentro — os três sinais da [aula de observabilidade](../../classes/observability/index.md):
**métricas** dizem *que* algo está errado e quanto, **traces** dizem *onde* na requisição o tempo foi
gasto, **logs** dizem *por quê*.

Este lab constrói no BoxOffice o capítulo 9 da [história do curso](../../index.md#story): o
dashboard RED de [sinais](../../classes/observability/signals/index.md), o contexto de trace
carregado pelo outbox e pelo Kafka de [OpenTelemetry](../../classes/observability/opentelemetry/index.md),
e o [SLO](../../classes/observability/slo/index.md) com o alerta de burn rate multijanela de
[alertas](../../classes/observability/alerting/index.md). Ele vem logo antes do [lab 9](../9/index.md)
por um motivo: você instrumenta o BoxOffice antes de quebrá-lo de propósito, senão os experimentos de
caos do lab 9 não têm nada para mostrar.

## Slides

<div class="slides-embed">
  <iframe src="slides/observability.html" title="Slides: observabilidade" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/observability.html){:target="_blank"}

## Antes de começar { #before-you-start }

| | |
|---|---|
| Tempo | cerca de 4 horas |
| Ferramentas | as do lab 7: Docker com Compose v2 (`docker compose version`), k6 (`k6 version`), `curl`, `jq`; um navegador para o Grafana |
| Recursos do Docker | pelo menos 4 CPUs e **8 GB** (o `otel-lgtm` precisa de cerca de 1,5 GB; cada JVM cresce um pouco com o agente) |
| Portas | livres na sua máquina: 3000, 4317, 4318 (além das do lab 7) |

Todo comando roda na **raiz do seu repositório `boxoffice`**, que precisa estar no estado em que o lab 7
o deixou:

``` text title="Start state (end of lab 7)"
boxoffice/
├── docker-compose.yaml     # lab 6 stack + kafka, kafka-init, kafka-ui, mailpit, order, notification
├── infra/                  # nginx/, postgres/, pgbouncer/
├── load/                   # ... orders-load.js, waiting-room-spike.js
├── scripts/                # ... kafka-lag.sh
└── services/
    ├── auth/  catalog/  gateway/  inventory/
    ├── notification/
    └── order/
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 7? Baixe [boxoffice-after-lab-7.zip](../7/boxoffice-after-lab-7.zip),
    descompacte, `cd boxoffice` e continue daqui.

Todo arquivo deste lab aparece completo nestas páginas e é publicado em
`https://insper.github.io/platform/2027.1/hands-on/8/code/<caminho>`.

## Arquitetura { #architecture }

``` diagram-sim
flowchart LR
    k6[k6 / fãs] --> edge[edge]
    edge --> gw[gateway]
    gw --> catalog[catalog x3]
    gw --> order[order]
    order -.->|outbox + Kafka| notification[notification]
    catalog -->|OTLP 4318| col
    gw -->|OTLP| col
    order -->|OTLP| col
    notification -->|OTLP| col
    subgraph lgtm [otel-lgtm]
        col[OTel Collector] --> prom[(Prometheus)]
        col --> tempo[(Tempo)]
        col --> loki[(Loki)]
        prom --> grafana[Grafana :3000]
        tempo --> grafana
        loki --> grafana
    end
    grafana -->|burn rate > 14,4| alert[alerta: página]
```

Cada serviço roda o agente e envia **OTLP** (*OpenTelemetry Protocol*) ao coletor dentro do
`otel-lgtm`, que guarda cada sinal no seu próprio banco. O Grafana os liga: um ponto em um gráfico de
latência abre o seu trace, um span abre os logs que ele escreveu.

!!! example "Componentes do BoxOffice envolvidos"

    | Componente da paleta | Neste lab |
    |---|---|
    | [Metrics](../../reference/components/observability/index.md#metrics) | Prometheus dentro do `otel-lgtm`; painéis RED e USE |
    | [Tracing](../../reference/components/observability/index.md#tracing) | Tempo; um trace atravessando HTTP, JDBC, o outbox e o Kafka |
    | [Logs](../../reference/components/observability/index.md#logs) | Loki; toda linha carrega o `trace_id` |
    | [Alerting](../../reference/components/observability/index.md#alerting) | regras de alerta do Grafana: *burn rate* com múltiplas janelas no SLO do `catalog` |
    | [Health Check](../../reference/components/observability/index.md#healthcheck) | as *probes* do actuator, excluídas do SLI |

## O que você vai medir { #what-you-will-measure }

| Pergunta | Métrica | Ferramenta |
|---|---|---|
| Quanto custa o agente? | p50 / p95 / p99, CPU, memória, tempo de inicialização com e sem ele | k6, `docker stats` |
| Quanto a amostragem economiza? | traces por minuto, p95 | Tempo, k6 |
| Quantas séries temporais um serviço cria? | séries por serviço e por métrica | PromQL |
| Quanto tempo até um banco quebrado acionar alguém? | parada → *Pending* → *Firing* | alertas do Grafana |

## Pré-requisitos { #prerequisites }

- Labs [1](../1/index.md) a [7](../7/index.md) concluídos: o BoxOffice roda com a borda, o gateway,
  as réplicas do `catalog`, `inventory`, `order`, `notification` e o Kafka.
- Cerca de 1,5 GB de memória livre para o `otel-lgtm`.
- Leia a [aula de observabilidade](../../classes/observability/index.md), em especial
  [sinais](../../classes/observability/signals/index.md),
  [OpenTelemetry](../../classes/observability/opentelemetry/index.md) e
  [alertas](../../classes/observability/alerting/index.md).

## Passos { #steps }

1. [Instrumente tudo](instrument/index.md) — o `otel-lgtm`, o agente Java em todos os serviços, logs com trace id e o contexto do trace levado através do outbox.
2. [Dashboard RED](dashboard/index.md) — um dashboard provisionado: Rate, Errors, Duration por serviço, mais USE para as JVMs e os pools de conexão.
3. [SLO e alerta de *burn rate*](slo/index.md) — SLI, SLO e orçamento de erros do `catalog`; regras de queima rápida e lenta como código; dispare uma.
4. [Meça](measure/index.md) — custo do agente, amostragem, cardinalidade e tempo de detecção.

## Experimente no playground { #try-it-in-the-playground }

**Experimente:** rode o cenário `observability-stack` com o perfil `chaos`. Primeiro deixe o nó de
métricas desconectado de um serviço: a utilização dele aparece como "?" — você não conserta o que não
mede. Conecte-o e observe qual sinal reage primeiro quando uma falha aleatória acontece: a taxa de
erros, os percentis de latência ou o *health check*.

<div class="sdp" data-scenario="observability-stack" data-mode="compact" data-height="520" data-profile="chaos"></div>

O simulador completo está no [playground](../../../playground/index.md).

## Meça { #measure-it }

O passo [Meça](measure/index.md) tem o script do k6 e a tabela de resultados para preencher e guardar
em `results/lab8.md`.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa provável | Correção |
|---|---|---|
| um serviço termina com `Error opening zip file or JAR manifest missing : /otel/opentelemetry-javaagent.jar` | o agente não foi baixado, ou o caminho do volume está errado | `sh scripts/get-otel-agent.sh` na raiz do repositório; `ls infra/otel` |
| os serviços ficam `starting` por minutos | JVMs com o agente sobem mais devagar; falta CPU/memória ao Docker | espere; dê 8 GB ao Docker; pare outras stacks (`docker ps`) |
| o Grafana mostra **No data** | as métricas são exportadas a cada 10 s e os painéis usam janelas de taxa | gere tráfego, espere um minuto, confira o intervalo (últimos 15 min) |
| nenhum `service_name` no Prometheus | o serviço não tem `OTEL_SERVICE_NAME` / `<<: *otel` | compare o `environment` dele com o do serviço `order` |
| faltam o dashboard ou as regras de alerta | arquivos de provisionamento não montados ou inválidos | `docker compose logs otel-lgtm | grep -i provision`; confira os caminhos dos três volumes |
| ainda dois traces por pedido | o `order` não foi reconstruído, ou o `V2__outbox_traceparent.sql` não rodou | `docker compose up -d --build order`; `docker compose logs order | grep -i flyway` |
| porta 3000 ocupada | outro Grafana ou um servidor de desenvolvimento | pare-o, ou mapeie `"3001:3000"` e use `http://localhost:3001` |

## Boas práticas { #best-practices }

!!! success "Boas práticas neste lab"

    - **Telemetria configurada uma vez, para todo serviço** — a âncora `x-otel` no `docker-compose.yaml`, com um `OTEL_SERVICE_NAME` por serviço ([OpenTelemetry](../../classes/observability/opentelemetry/index.md)).
    - **Contexto de trace carregado pelo salto assíncrono** — `Outbox.java`, `OutboxRelay.java` e `V2__outbox_traceparent.sql` guardam e restauram o `traceparent` ([OpenTelemetry — propagação de contexto](../../classes/observability/opentelemetry/index.md)).
    - **Dashboards e alertas como código** — `infra/grafana/dashboards/boxoffice-red.json` e `infra/grafana/alerting/slo-catalog.yaml`, provisionados na inicialização ([Sinais — dashboards](../../classes/observability/signals/index.md)).
    - **Um SLI que conta só fãs** — `http_route!~"/actuator.*"` em toda consulta de `slo-catalog.yaml` ([SLOs](../../classes/observability/slo/index.md)).
    - **Um page só para queima rápida multijanela, testado quebrando o `db`** — 14,4× em 1 h e 5 min no `slo-catalog.yaml`; a regra de 6× é um ticket ([Alertas](../../classes/observability/alerting/index.md)).

## Limpeza { #clean-up }

``` shell
docker compose stop                 # keep everything for lab 9
docker compose down -v              # or remove containers and volumes (all data, including metrics)
```

O lab 9 usa este dashboard no seu *game day*: mantenha `infra/grafana/` e `infra/otel/`.

## Estado final { #end-state }

``` text title="End state (what this lab added or changed)"
boxoffice/
├── .gitignore              # + infra/otel/*.jar
├── docker-compose.yaml     # + x-otel anchor, agent volume in every Java service, otel-lgtm
├── infra/
│   ├── grafana/
│   │   ├── dashboards.yaml
│   │   ├── dashboards/boxoffice-red.json
│   │   └── alerting/slo-catalog.yaml
│   └── otel/opentelemetry-javaagent.jar   # downloaded, not committed
├── load/catalog-otel.js
├── scripts/get-otel-agent.sh
└── services/order/
    ├── pom.xml             # + opentelemetry-api
    └── src/main/
        ├── java/boxoffice/order/outbox/Outbox.java, OutboxRelay.java   # traceparent
        └── resources/db/migration/V2__outbox_traceparent.sql
```

Faça commit e tag: `git add -A && git commit -m "lab 8: observability" && git tag lab8`.

## Checklist

- [ ] `scripts/get-otel-agent.sh` baixa o agente, e o `docker-compose.yaml` o conecta a cada serviço Java pela âncora `x-otel` e pelo volume `infra/otel`, cada um com o seu `OTEL_SERVICE_NAME`
- [ ] o Explore do Grafana mostra `http_server_request_duration_seconds_*` de todos os serviços, traces no Tempo e logs com `trace_id` no Loki
- [ ] um único trace vai do `POST /orders` no `order`, passando pelo relay do outbox e pelo Kafka, até o `notification`
- [ ] `infra/grafana/` contém o provedor de dashboards, o `boxoffice-red.json` e o `slo-catalog.yaml`, carregados na inicialização
- [ ] o alerta de queima rápida disparou quando o `db` foi parado, e parou depois que ele voltou
- [ ] tabela de resultados do passo [Meça](measure/index.md) preenchida em `results/lab8.md` e explicada
- [ ] autoverificação: depois de `docker compose down -v && sh scripts/get-otel-agent.sh && docker compose up -d`, o dashboard e as duas regras de alerta aparecem sem passos manuais; push com a tag `lab8`

## Relacionados { #related }

- Teoria: [Observabilidade](../../classes/observability/index.md) ·
  [Sinais: RED, USE, golden signals](../../classes/observability/signals/index.md) ·
  [OpenTelemetry](../../classes/observability/opentelemetry/index.md) ·
  [Alertas e *burn rate*](../../classes/observability/alerting/index.md) ·
  [Resposta a incidentes](../../classes/observability/incident-response/index.md) ·
  [SLOs e orçamentos de erro](../../classes/observability/slo/index.md)
- Lab anterior: [7. Mensageria assíncrona](../7/index.md) — o fluxo rastreado aqui.
- Próximo lab: [9. Resiliência e caos](../9/index.md) usa este dashboard durante um *game day*.

[Começar: Instrumente tudo](instrument/index.md){ .md-button .md-button--primary }
