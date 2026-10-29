---
marp: true
lang: pt-BR
title: Hands-on 9 — Resiliência e Caos
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Hands-on 9 — Resiliência e Caos

**Um provedor de pagamento lento não pode derrubar o checkout**

<!--
Roteiro: (1) a cascata; (2) payment, psp, Toxiproxy; (3) timeout; (4) retry + idempotência;
(5) circuit breaker; (6) bulkhead; (7) game day; (8) medir.
-->

---

## Nada está fora do ar. Tudo está quebrado.

<div class="q">

10:00, venda relâmpago. O provedor de pagamento responde em 3 s em vez de 300 ms. Em um minuto o `order` para de responder **qualquer coisa** — até o `GET /orders/{id}`. Por quê?

</div>

* 20 pagamentos/s × 3 s = **60 threads** só esperando o `payment`.
* O `order` tem 50 → toda requisição vai para a fila: uma **falha em cascata**.
* Lei de Little: concorrência = taxa × tempo retido.

---

## O ambiente do lab

| Contêiner | Papel |
|---|---|
| `payment` (8085) | adaptador: `POST /payments` idempotente, timeouts para o provedor |
| `psp` (WireMock) | provedor externo falso: `POST /v1/charges` → `approved` |
| `toxiproxy` (8474) | proxies TCP `payment` (18085) e `psp` (18095): latência, resets, quedas |

- `order` → `toxiproxy:18085` → `payment` → `toxiproxy:18095` → `psp`.
- Novo endpoint: `POST /orders/{id}/pay` → `CONFIRMED` + `OrderConfirmed` no outbox.

---

## Toxics

| Toxic | Simula |
|---|---|
| `latency` (+ `jitter`) | dependência lenta |
| `timeout` (0) | buraco negro |
| `reset_peer` | conexão resetada |
| `bandwidth` | cano estreito |
| proxy `enabled: false` | dependência fora do ar |

```shell
curl -X POST localhost:8474/proxies/payment/toxics \
  -d '{"name":"slow","type":"latency","attributes":{"latency":3000}}'
```

<p class="small"><code>toxicity</code> 0–1: a probabilidade por conexão. <code>POST /reset</code> é o botão de abortar.</p>

---

## 1 · Timeout

```java
factory.setConnectTimeout(Duration.ofMillis(500));
factory.setReadTimeout(Duration.ofSeconds(1)); // 0 = forever (the default!)
```

- Uma thread fica presa **no máximo 1 s**: 20/s × 1 s = 20 threads → o pool sobrevive.
- Falha lenta → **falha rápida**; falhas rápidas não se propagam em cascata.

<div class="warn">

Os orçamentos encolhem a cada salto: borda 10 s > gateway 5 s > order→payment 1 s × tentativas.

</div>

---

## 2 · Retry, backoff, jitter

```yaml
max-attempts: 3
wait-duration: 200ms
enable-exponential-backoff: true      # 200 ms, 400 ms
enable-randomized-wait: true
randomized-wait-factor: 0.5           # ± 50% jitter
retry-exceptions: [ResourceAccessException, HttpServerErrorException]
```

- Erro transitório com *p* = 0,3 → três tentativas falham com *p*³ = 2,7%.
- Custos: até 3× a carga, mais latência. **Só em chamadas idempotentes.**

---

## Idempotência de ponta a ponta

- O `order` envia `Idempotency-Key: order-<id>` em toda tentativa.
- O `payment` a guarda como `UNIQUE`; uma chave conhecida devolve o primeiro resultado (`200`).
- O `payment` a repassa ao provedor.

<div class="ok">

Um timeout não significa que a chamada falhou — a resposta pode ter se perdido. A chave torna o retry inofensivo.

</div>

---

## 3 · Circuit breaker

- **Fechado**: as chamadas passam; falhas e chamadas lentas são contadas (janela de 20, mín. 10).
- **Aberto** (≥ 50% com falha ou lentas): falha **na hora** por 10 s — sem rede, sem retry.
- **Half-open**: 3 chamadas de teste decidem → fechado ou aberto de novo.
- Protege as threads de quem chama **e** dá espaço para a dependência se recuperar.

<p class="small">Acompanhe: <code>/actuator/circuitbreakers</code>, <code>/actuator/circuitbreakerevents</code>.</p>

---

## 4 · Bulkhead

<div class="q">

As chamadas dão certo em 700 ms — abaixo do timeout e do limite de chamada lenta. A 70/s, o `GET /orders/{id}` fica lento mesmo assim. Por quê, e o que resolve?

</div>

* 70/s × 0,7 s ≈ **49** de 50 threads esperam o `payment`.
* Bulkhead `max-concurrent-calls: 10`, `max-wait-duration: 0` → a 11ª chamada recebe `503` na hora.
* As outras 40 threads continuam servindo todo o resto.

---

## Como as anotações se empilham

```java
@Retry(name = "payment", fallbackMethod = "unavailable")
@CircuitBreaker(name = "payment")
@Bulkhead(name = "payment")
public PaymentResponse charge(UUID orderId, BigDecimal amount) { ... }
```

- Ordem padrão: **Retry ( CircuitBreaker ( Bulkhead ( call ) ) )**.
- Fallback na camada **mais externa** → roda depois dos retries, com o breaker aberto, com o bulkhead cheio.
- O retry **ignora** `CallNotPermittedException` e `BulkheadFullException`: falha rápida.
- O breaker ignora `BulkheadFullException`: a nossa recusa não é culpa da dependência.

---

## Nunca espere dentro de uma transação

- O `pay()` chama o `payment` **sem** transação aberta.
- Depois, uma transação curta: `UPDATE … WHERE status = 'PENDING_PAYMENT'` + evento no outbox.
- Esperar 3 s dentro de uma transação leva o esgotamento para o **pool de conexões** (≈ 10).

---

<!-- _class: tight -->

## Meça

| Experimento | Toxic | Antes → depois |
|---|---|---|
| Timeout | latência 3 s | p95 do `pay`, **p95 do `browse`** |
| Retry | reset_peer 30% | % confirmados |
| Circuit breaker | proxy desativado | p95 do `pay`, `pay_fast_fail` |
| Bulkhead | latência 700 ms, 70 pay/s | p95 do `browse`, % rejeitados |

<p class="small">k6 <code>load/pay-under-chaos.js</code>: <code>pay</code> (usa o payment) e <code>browse</code> (não usa) ao mesmo tempo — o segundo revela a cascata.</p>

---

## 5 · Game day

- **Papéis**: mestre do jogo (injeta, escondido), operadores (detectam, mitigam), escriba (linha do tempo).
- **Antes**: estado estável, hipóteses, raio de impacto, abortar = `POST /reset`.
- **Durante**: alerta → dashboard → trace → logs; mitigue primeiro.
- **Depois**: revisão sem culpados — tempo para detectar, tempo para mitigar, itens de ação.

<div class="warn">

Sem hipótese, não há experimento. Uma hipótese refutada é o resultado valioso.

</div>

---

## Experimente no playground

- `cascading-failure`: aumente a latência do terceiro, veja a utilização chegar a 100%; adicione timeout + breaker.
- `retry-storm`: retries sem backoff amplificam uma queda; adicione `exp+jitter`.

<div class="ok">

O simulador mostra a forma; k6 + Toxiproxy dão os seus próprios números.

</div>

---

## Pontos-chave

1. Uma dependência lenta é pior que uma morta: ela **esgota as threads** (Lei de Little).
2. **Timeouts** em todo lugar, menores a cada salto mais interno.
3. **Retries** com backoff + jitter, só em erros transitórios, só com **chaves de idempotência**.
4. **Circuit breakers** falham rápido e deixam as dependências se recuperarem; **bulkheads** limitam a concorrência por dependência.
5. Nunca segure uma transação de banco durante uma chamada remota.
6. Pratique a falha: **game days** com hipóteses e revisões sem culpados.
