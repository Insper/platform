# 9. Resiliência e Caos { #9-resilience-chaos }

!!! info "Objetivo"

    Fazer o checkout sobreviver a um dia ruim do provedor de pagamento. Construir o adaptador `payment`
    e um provedor externo falso, colocar o **Toxiproxy** entre os serviços, ver uma dependência lenta
    derrubar o `order` inteiro (uma **falha em cascata**) e corrigir isso com o **Resilience4j** —
    timeout, retry com backoff e jitter, circuit breaker, bulkhead —, medindo depois de cada padrão.
    Terminar com um **game day**: um incidente ensaiado, com falhas escondidas e uma revisão sem culpados.

Às 10:00 a venda relâmpago abre e o provedor de pagamento, sob a carga de todos os sites de ingressos
do país, começa a responder em três segundos em vez de trezentos milissegundos. Nada está "fora do
ar". Mesmo assim, em um minuto o `order` para de responder *qualquer coisa* — até o
`GET /orders/{id}`, que nunca fala com o provedor —, porque todas as suas threads estão esperando o
`payment`. Este lab reproduz essa falha no seu laptop e aplica os padrões da
[aula de confiabilidade](../../classes/reliability/index.md), com um número para cada um.

Este lab constrói no BoxOffice o capítulo 10 da [história do curso](../../index.md#story): a
[falha em cascata](../../classes/reliability/index.md#cascading-failures) e as suas defesas —
[timeout](../../classes/reliability/patterns/index.md#timeout),
[retry com jitter](../../classes/reliability/patterns/index.md#retry-with-backoff-and-jitter),
[circuit breaker](../../classes/reliability/patterns/index.md#circuit-breaker) e
[bulkhead](../../classes/reliability/patterns/index.md#bulkhead) —, depois um
[game day](../../classes/reliability/chaos/index.md#game-days). Ele vem logo depois do lab 8 de
propósito: caos exige observabilidade antes, então todo experimento é acompanhado no dashboard do lab 8
e aciona o alerta de burn rate dele.

## Slides

<div class="slides-embed">
  <iframe src="slides/resilience.html" title="Slides: resiliência e caos" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/resilience.html){:target="_blank"}

## Antes de começar { #before-you-start }

| | |
|---|---|
| Tempo | cerca de 4 horas, mais 1 hora para o game day |
| Ferramentas | as do lab 8: Docker com Compose v2, k6, `curl`, `jq`, um navegador para o Grafana; `watch` (macOS: `brew install watch`) |
| Recursos do Docker | pelo menos 4 CPUs e **8 GB** (mais três contêineres: `payment`, `psp`, `toxiproxy`) |
| Portas | livres na sua máquina: 8085, 8474 (além das do lab 8) |

Todo comando roda na **raiz do seu repositório `boxoffice`**, no estado em que o lab 8 o deixou:

``` text title="Start state (end of lab 8)"
boxoffice/
├── docker-compose.yaml     # labs 1-8: ... kafka, order, notification, otel-lgtm (+ x-otel anchor)
├── infra/                  # nginx/, postgres/, pgbouncer/, grafana/, otel/
├── load/  scripts/
└── services/
    ├── auth/  catalog/  gateway/  inventory/  notification/
    └── order/              # outbox with traceparent (lab 8)
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 8? Baixe [boxoffice-after-lab-8.zip](../8/boxoffice-after-lab-8.zip),
    descompacte, `cd boxoffice`, rode `sh scripts/get-otel-agent.sh` e continue daqui.

Todo arquivo deste lab aparece completo nestas páginas e é publicado em
`https://insper.github.io/platform/2027.1/hands-on/9/code/<caminho>`.

## Arquitetura { #architecture }

``` diagram-sim
flowchart LR
    k6[k6: pay + browse] --> order["order (Resilience4j)"]
    order -->|"timeout · retry · breaker · bulkhead"| tp1["toxiproxy: payment"]
    tp1 --> payment[payment]
    payment -->|"timeouts, Idempotency-Key"| tp2["toxiproxy: psp"]
    tp2 --> psp["psp (WireMock)"]
    gm[mestre do jogo] -.->|"latência, reset, queda"| tp1
    gm -.-> tp2
    order -.->|OTLP| lgtm[otel-lgtm]
    payment -.->|OTLP| lgtm
```

!!! example "Componentes do BoxOffice envolvidos"

    | Componente da paleta | Neste lab |
    |---|---|
    | [Payment](../../reference/components/external/index.md#payment) | `psp`, um WireMock que finge ser um provedor externo |
    | [3rd Party API](../../reference/components/external/index.md#thirdparty) | o provedor atrás de um adaptador, com timeouts e chaves de idempotência |
    | [App Server](../../reference/components/compute/index.md#app) | `order` e `payment`, protegidos pelo Resilience4j |
    | [Alerting](../../reference/components/observability/index.md#alerting) | o alerta de burn rate do lab 8, usado para detectar as falhas do game day |

## O que você vai medir { #what-you-will-measure }

| Pergunta | Métrica | Ferramenta |
|---|---|---|
| Uma dependência lenta prejudica endpoints que não a usam? | p95 e erros do `browse` enquanto o `payment` está lento | k6 |
| Quanto cada padrão ajuda, e quanto custa? | p95 do `pay`, % confirmados, % de falha rápida | k6 |
| Quão rápido o breaker abre e se recupera? | transições de estado ao longo do tempo | `/actuator/circuitbreakers` |
| Quão rápido o time detecta e mitiga? | tempo para detectar, tempo para mitigar | linha do tempo do game day |

## Pré-requisitos { #prerequisites }

- Labs [7](../7/index.md) (o serviço `order`) e [8](../8/index.md) (dashboards e alertas) concluídos.
- Leia a [aula de confiabilidade](../../classes/reliability/index.md):
  [padrões de resiliência](../../classes/reliability/patterns/index.md) e
  [engenharia do caos](../../classes/reliability/chaos/index.md).

## Passos { #steps }

1. [Pagamento, provedor e Toxiproxy](payment/index.md) — o adaptador idempotente `payment`, um provedor WireMock, os proxies do Toxiproxy e o seu primeiro toxic.
2. [Padrões de resiliência](patterns/index.md) — reproduza a cascata, depois adicione timeout, retry, circuit breaker e bulkhead, um de cada vez.
3. [Game day](game-day/index.md) — papéis, hipóteses, falhas escondidas, linha do tempo e uma revisão sem culpados.
4. [Meça](measure/index.md) — o script do k6 com um cenário `pay` e um `browse`, e a tabela de resultados.

## Experimente no playground { #try-it-in-the-playground }

**Experimente:** em `cascading-failure`, rode o perfil `load` e aumente a latência do nó de terceiro
(3rd party): veja a utilização do app server chegar a 100% e os erros dele se espalharem para todas as
requisições. Depois defina um timeout e ative o circuit breaker na aresta para o terceiro, e rode de
novo. Em `retry-storm`, compare `retries: 3` com e sem backoff `exp+jitter` durante uma queda.

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="520"></div>

<div class="sdp" data-scenario="retry-storm" data-mode="compact" data-height="460" data-profile="chaos"></div>

O simulador completo está no [playground](../../../playground/index.md).

## Meça { #measure-it }

O passo [Meça](measure/index.md) tem o script do k6, os comandos e a tabela de resultados para guardar
em `results/lab9.md`; as revisões do game day vão para `results/lab9-gameday.md`.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa provável | Correção |
|---|---|---|
| `curl localhost:8474/proxies` falha | o `toxiproxy` não está rodando, ou falta o `infra/toxiproxy/toxiproxy.json` | `docker compose ps toxiproxy`; `docker compose logs toxiproxy` |
| todo pagamento falha com `I/O error … Connection refused` | um experimento deixou o proxy do `payment` desativado | `curl -s -X POST localhost:8474/reset` (remove os toxics, reativa os proxies) |
| o `pay` devolve `503` mesmo sem toxic | o circuit breaker ainda está `OPEN` desde o último experimento, ou a primeira chamada foi a frio | espere 10 s (`wait-duration-in-open-state`) e tente de novo; confira `/actuator/circuitbreakers` |
| o `psp` responde `404` | o stub do WireMock não foi montado | o arquivo precisa ser `infra/psp/mappings/charge.json`; `docker compose restart psp` |
| as variáveis `PAYMENT_*` parecem ignoradas | elas só chegam ao contêiner pelo `docker-compose.yaml` e por uma recriação | `PAYMENT_BULKHEAD=10 docker compose up -d order` (não `restart`) |
| os resultados variam muito entre execuções | o laptop roda o k6 e 20 contêineres | feche outros aplicativos, rode cada experimento duas vezes, compare **razões** |

!!! success "Boas práticas neste lab"

    - **Um timeout em toda chamada de saída, menor que o de quem chama** — `PaymentClient.java` (500 ms de conexão, 1 s de leitura). Por quê: [Timeout](../../classes/reliability/patterns/index.md#timeout).
    - **Retries só com chave de idempotência, com backoff exponencial e jitter** — o `PaymentClient.java` envia `Idempotency-Key: order-<id>`; o `application.yaml` permite 3 tentativas, 200 ms ± 50%. Por quê: [Retry com backoff e jitter](../../classes/reliability/patterns/index.md#retry-with-backoff-and-jitter).
    - **Um bulkhead menor que o pool de threads, falhando rápido quando está cheio** — `application.yaml`: 10 das 50 threads, `max-wait-duration: 0`. Por quê: [Bulkhead](../../classes/reliability/patterns/index.md#bulkhead).
    - **Nenhuma transação de banco aberta enquanto se espera uma chamada remota** — o `OrderService.java` chama o `payment` primeiro e atualiza o status numa transação curta. Por quê: [Falhas em cascata](../../classes/reliability/index.md#cascading-failures) (senão a espera esgotaria o pool de conexões).
    - **Caos como código, com um aborto de um comando** — `scripts/game-day.sh` e `infra/toxiproxy/toxiproxy.json`; o `reset` remove todo toxic. Por quê: [Game days](../../classes/reliability/chaos/index.md#game-days).

## Limpeza { #clean-up }

``` shell
curl -s -X POST localhost:8474/reset    # no toxic left behind
docker compose stop                     # keep the stack for lab 10's images
docker compose down -v                  # or remove everything
```

## Estado final { #end-state }

``` text title="End state (what this lab added or changed)"
boxoffice/
├── docker-compose.yaml     # + psp, toxiproxy, payment; order -> toxiproxy:18085 + PAYMENT_* knobs
├── infra/
│   ├── grafana/alerting/slo-order.yaml   # the lab 8 burn-rate alerts, for order (game day)
│   ├── psp/mappings/charge.json
│   └── toxiproxy/toxiproxy.json
├── load/pay-under-chaos.js
├── scripts/game-day.sh
├── results/lab9.md, lab9-gameday.md
└── services/
    ├── order/              # pom (+ resilience4j, aspectj), application.yaml, OrderService,
    │                       # OrderController (+ /pay), payment/ package
    └── payment/            # new: idempotent adapter to the provider (+ Dockerfile, .dockerignore)
```

Faça commit e tag: `git add -A && git commit -m "lab 9: resilience" && git tag lab9`.

## Checklist

- [ ] `payment`, `psp` e `toxiproxy` rodam no `docker-compose.yaml`; `order` e `payment` chegam às suas dependências pelo Toxiproxy
- [ ] o `POST /payments` é idempotente pela `Idempotency-Key`, e a chave é repassada ao provedor
- [ ] o `POST /orders/{id}/pay` confirma o pedido (status `CONFIRMED` + `OrderConfirmed` no outbox) e é protegido por timeout, retry, circuit breaker e bulkhead
- [ ] a execução sem proteção mostra a cascata (`browse` degradado); a execução de cada padrão mostra o seu efeito, em números
- [ ] um game day com pelo menos três experimentos escondidos, uma linha do tempo e uma revisão sem culpados por rodada
- [ ] tabela de resultados preenchida em `results/lab9.md` e explicada
- [ ] autoverificação: `curl -s -X POST localhost:8474/reset`, depois `PAYMENT_RESILIENCE=true docker compose up -d order`, e uma chamada `pay` devolve `CONFIRMED`; push com a tag `lab9`

## Relacionados { #related }

- Teoria: [Confiabilidade](../../classes/reliability/index.md) ·
  [SLOs e orçamentos de erro](../../classes/observability/slo/index.md) ·
  [Padrões de resiliência](../../classes/reliability/patterns/index.md) ·
  [Engenharia do caos](../../classes/reliability/chaos/index.md) ·
  [Integrações externas](../../classes/compute/integrations/index.md)
- Estudo de caso: [Sistema de pagamentos](../../classes/case-studies/payment-system/index.md)
- Projeto: [Game day de caos](../../exercises/project/game-day/index.md)
- Próximo lab: [10. Kubernetes](../10/index.md) adiciona autocura e autoscaling.

[Começar: Pagamento, provedor e Toxiproxy](payment/index.md){ .md-button .md-button--primary }
