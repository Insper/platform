# 4. Meça { #4-measure-it }

Um script conduz todos os experimentos do [passo 2](../patterns/index.md) e o
[game day](../game-day/index.md). Ele roda dois cenários ao mesmo tempo, porque uma falha em cascata só
fica visível quando você também mede o que **não deveria** ser afetado:

| Cenário | Taxa | Requisição | Toca o `payment`? |
|---|---|---|---|
| `pay` | `PAY_RATE` (padrão 20/s) | faz um pedido, depois `POST /orders/{id}/pay` | sim |
| `browse` | 20/s | `GET /orders/{id}` dos pedidos criados no `setup()` | **não** |

``` javascript title="load/pay-under-chaos.js"
--8<-- "docs/2027.1/hands-on/9/code/load/pay-under-chaos.js"
```

Leia quatro linhas do resumo depois de cada execução: `http_req_duration{name:pay}` e
`{name:browse}` (p95, p99), o check `paid and confirmed` (fração de pagamentos confirmados; o total de
`checks` também conta o check `order read` do `browse`), `pay_fast_fail` e
`http_req_failed{name:browse}`. Acompanhe o circuit breaker durante a execução:

``` shell
watch -n 1 "curl -s localhost:8084/actuator/circuitbreakers | jq '.circuitBreakers.payment'"
```

!!! example "Forma esperada (ilustrativa)"

    Sem proteção, com +3 s: o p95 do `pay` cresce para muitos segundos e **o p95 do `browse` cresce
    junto** — a cascata. Com um timeout: o `pay` falha em cerca de um segundo, o `browse` volta aos
    milissegundos. Com o circuit breaker durante uma queda: o `pay` responde `503` em milissegundos na
    maior parte do tempo (`pay_fast_fail` perto de 1) e as chamadas ao `payment` caem para um fio de
    sondas half-open. Com o bulkhead sob chamadas lentas, mas bem-sucedidas: a maioria dos pagamentos
    recebe `503` (só 10 cabem por vez), mas o `browse` continua rápido.

    Uma execução de teste num laptop ocupado (a stack inteira do lab 9, 45 s por execução, `payment` +
    3 s de latência):

    | Configuração | `pay` p50 / p95 | `browse` p50 / p95 | `pay_fast_fail` |
    |---|---|---|---|
    | sem proteção (`PAYMENT_RESILIENCE=false`, `PAYMENT_READ_TIMEOUT=0`) | 13,8 s / 17,1 s | **9,04 s / 13,17 s** | 0% |
    | todos os padrões (padrões de configuração) | 5 ms / 1,38 s | **6,5 ms / 805 ms** | 100% |

    Sem proteção, o `GET /orders/{id}` — que nunca chama o `payment` — esperou 9 s na mediana: a
    cascata. Com os padrões, o breaker abriu em segundos e todo pagamento falhou rápido com `503`,
    então o `browse` voltou aos milissegundos (o p95 dele ainda mostra os primeiros segundos, antes de
    o breaker abrir). Os seus números absolutos vão ser outros; o contraste entre as duas colunas do
    `browse` é o que você precisa reproduzir.

## Resultados { #results }

Copie para `results/lab9.md`. "Antes" é a configuração sem proteção ou desativada de cada linha;
"Depois" é a com o padrão.

| Experimento (toxic) | Métrica | Antes | Depois |
|---|---|---|---|
| Linha de base (sem toxic) | p95 do pay (ms) / p95 do browse (ms) | | — |
| Timeout (latência 3 s) | p95 do pay (ms) | | |
| Timeout (latência 3 s) | p95 do browse (ms) / erros do browse (%) | | |
| Retry (reset_peer 30%) | pagamentos confirmados (%) | | |
| Retry (reset_peer 30%) | p95 do pay (ms) | | |
| Circuit breaker (proxy desativado) | p95 do pay (ms) / `pay_fast_fail` (%) | | |
| Circuit breaker (proxy desativado) | tempo da reativação até `CLOSED` (s) | — | |
| Bulkhead (latência 700 ms, 70 pay/s) | p95 do browse (ms) | | |
| Bulkhead (latência 700 ms, 70 pay/s) | pagamentos rejeitados (%) | | |
| Game day | tempo para detectar / tempo para mitigar (min) | — | |

Abaixo da tabela, um parágrafo por padrão: o mecanismo (com a Lei de Little onde se aplica), o número
que o comprova e o preço que você pagou por ele.

[Voltar à visão geral](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
