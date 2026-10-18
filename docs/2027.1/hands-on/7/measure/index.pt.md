# 5. Meça

Cinco experimentos, uma tabela de resultados. Rode cada experimento pelo menos duas vezes e relate a
segunda execução (a primeira aquece as JVMs e os pools de conexão). Os números das caixas "forma
esperada" são **ilustrativos** — o que importa é você conseguir explicar os *seus* números.

| # | Experimento | Botão | O que registrar |
|---|---|---|---|
| A | síncrono vs outbox | `NOTIFY_MODE` | p50 / p95 / p99 do `POST /orders` |
| B | queda do `notification` | parar o contêiner no meio do teste | taxa de erro, pico de *lag*, tempo de drenagem |
| C | rajada e drenagem | `NOTIFY_CONCURRENCY` 1 vs 6 | *lag* ao longo do tempo, tempo de drenagem, atraso p95 do e-mail |
| D | reprocessamento | `NOTIFY_IDEMPOTENT` | e-mails por pedido depois de um *reset* de offsets |
| E | pico da venda relâmpago | sala de espera aberta, `ADMIT_PER_SECOND=10` | admitidos/s, espera p95, erro do ETA, p95 dos pedidos |

## Os scripts do k6

=== "orders-load.js"

    ``` javascript title="load/orders-load.js"
    --8<-- "docs/2027.1/hands-on/7/code/load/orders-load.js"
    ```

=== "waiting-room-spike.js"

    ``` javascript title="load/waiting-room-spike.js"
    --8<-- "docs/2027.1/hands-on/7/code/load/waiting-room-spike.js"
    ```

=== "kafka-lag.sh"

    ``` shell title="scripts/kafka-lag.sh"
    --8<-- "docs/2027.1/hands-on/7/code/scripts/kafka-lag.sh"
    ```

Rode todo teste do k6 com os percentis no resumo:

``` shell
k6 run --summary-trend-stats="avg,p(50),p(95),p(99),max" load/orders-load.js
```

## A. Síncrono vs outbox

``` shell
NOTIFY_MODE=sync docker compose up -d order        # "before"
k6 run --summary-trend-stats="avg,p(50),p(95),p(99),max" load/orders-load.js
NOTIFY_MODE=outbox docker compose up -d order      # "after"
k6 run --summary-trend-stats="avg,p(50),p(95),p(99),max" load/orders-load.js
```

As variáveis chegam aos contêineres porque o `docker-compose.yaml` as interpola
(`NOTIFY_MODE: ${NOTIFY_MODE:-outbox}`), como escrito nos passos 2 e 3.

!!! example "Forma esperada (ilustrativa)"

    Com `EMAIL_LATENCY=50ms` numa máquina ociosa, o p50 síncrono fica um pouco acima de 50 ms — o fã
    paga pelo e-mail em todo pedido — enquanto a versão com outbox responde em poucos milissegundos (dois
    INSERTs e um commit). Num notebook **ocupado** (toda a stack do lab 7 mais outros contêineres, *load
    average* acima de 10 em 8 núcleos) uma execução de teste deu:

    | 50 pedidos/s por 30 s | p50 | p95 | p99 | vazão |
    |---|---|---|---|---|
    | `NOTIFY_MODE=sync` | 4,12 s | 8,14 s | 11,51 s | 38,7/s (o k6 não conseguiu manter a taxa) |
    | `NOTIFY_MODE=outbox` | 47 ms | 658 ms | 1,29 s | 49,5/s |

    Os números absolutos dependem da sua máquina; a **razão** é a lição: com o e-mail no caminho da
    requisição, todo pedido espera por ele e o serviço satura muito antes. Se até a versão com outbox
    estiver lenta para você, feche outros contêineres (`docker ps`) e rode de novo.

## B. Queda do `notification`

Rode a carga por 60 s e, em outro terminal, derrube o `notification` por 20 s no meio:

``` shell
sleep 20; docker compose stop notification; sleep 20; docker compose start notification
```

Faça isso uma vez em cada modo, com `sh scripts/kafka-lag.sh` rodando em um terceiro terminal. No
modo `sync`, cerca de um terço dos pedidos falha — uma queda do e-mail virou uma queda de pedidos. No
modo `outbox`, nenhum pedido falha; o *lag* sobe enquanto `notification` está fora e drena depois que
ele volta.

## C. Rajada e drenagem

``` shell
NOTIFY_CONCURRENCY=1 docker compose up -d notification
RATE=100 k6 run load/orders-load.js           # kafka-lag.sh in another terminal
NOTIFY_CONCURRENCY=6 docker compose up -d notification
RATE=100 k6 run load/orders-load.js
```

Depois meça quão atrasados chegaram os e-mails:

``` sql
-- docker compose exec db psql -U boxoffice -d boxoffice
SELECT count(*) AS emails,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - occurred_at)) AS p50_s,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - occurred_at)) AS p95_s
FROM notification.notifications
WHERE sent_at > now() - interval '10 minutes';
```

??? question "Preveja antes de rodar: que *lag* a concorrência 1 vai atingir?"

    Cada *thread* consumidora atende no máximo 1 / 50 ms = **20 e-mails/s**. Com uma thread e 100
    pedidos/s, o *backlog* cresce a 100 − 20 = 80 mensagens/s: depois de 60 s, **≈ 4 800** mensagens de
    *lag*, e ele drena a 20/s → **≈ 240 s** para esvaziar. Com seis threads (capacidade 120/s > 100/s)
    o *lag* fica perto de zero. Mais de seis threads não ajudariam: o tópico tem seis partições.

## D. Reprocessamento

``` shell
docker compose stop notification
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group notification --topic order-events --reset-offsets --to-earliest --execute
docker compose start notification
```

Espere o `kafka-lag.sh` mostrar 0 e compare e-mails com pedidos distintos:

``` sql
SELECT count(*) AS emails, count(DISTINCT order_id) AS orders FROM notification.notifications;
```

Faça com `NOTIFY_IDEMPOTENT=true` e com `NOTIFY_IDEMPOTENT=false` (reinicie o `notification` com a
variável definida, como em C).

## E. Pico da venda relâmpago pela sala de espera

``` shell
ADMIT_PER_SECOND=10 docker compose up -d order
k6 run --summary-trend-stats="avg,p(50),p(95),p(99),max" load/waiting-room-spike.js
```

Cerca de 700 fãs chegam em 40 s, a 20 por segundo; a sala deixa entrar 10 por segundo. Confira no
resumo: `wr_admitted` cresce a 10/s, `http_req_duration{name:order}` fica estável, toda requisição de
robô recebe `403`, e `wr_eta_error_seconds` — a espera real menos o ETA prometido na entrada — fica
dentro de um ou dois segundos: a Lei de Little, `espera = posição / taxa`, é uma promessa honesta
quando a taxa é constante.

## Resultados

Copie esta tabela para o seu repositório (`results/lab7.md`) e preencha.

| Métrica | Antes | Depois |
|---|---|---|
| A · Vazão (req/s) | | |
| A · p50 do `POST /orders` (ms) | | |
| A · p95 do `POST /orders` (ms) | | |
| A · p99 do `POST /orders` (ms) | | |
| A · Taxa de erro (%) | | |
| B · Taxa de erro com `notification` fora por 20 s (%) | | |
| B · Pico de *lag* (mensagens) / tempo de drenagem (s) | — | |
| C · Pico de *lag*, concorrência 1 vs 6 (mensagens) | | |
| C · Tempo de drenagem, concorrência 1 vs 6 (s) | | |
| C · Atraso p95 do e-mail, concorrência 1 vs 6 (s) | | |
| D · E-mails / pedidos distintos após reprocessar (idempotência desligada vs ligada) | | |
| E · Pedidos por segundo durante o pico | — | |
| E · Espera p95 (s) / erro p95 do ETA (s) | — | |
| E · p95 dos pedidos (ms) / robôs recusados (%) | — | |

"Antes" é `sync` (A, B), concorrência 1 (C), idempotência desligada (D). Abaixo da tabela, escreva um
parágrafo por experimento: o que mudou, **por quê** (com a fórmula ou o mecanismo) e o que você faria
em seguida em produção.

[Voltar à visão geral](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
