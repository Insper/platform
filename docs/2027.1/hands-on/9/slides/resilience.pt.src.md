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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Hands-on 9 — Resiliência e Caos

**Um provedor de pagamento lento não pode derrubar o checkout**

<!--
Roteiro: (1) a cascata; (2) payment, psp, Toxiproxy; (3) timeout; (4) retry + idempotência;
(5) circuit breaker; (6) bulkhead; (7) as cinco execuções no simulador; (8) game day; (9) medir.
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

<div class="flow">
<div class="box muted">k6<small>pay 20/s + browse 20/s</small></div><div class="arrow">→</div>
<div class="box accent">order<small>50 threads · Resilience4j</small></div><div class="arrow">:18085 →</div>
<div class="box orange">toxiproxy<small>proxy payment</small></div><div class="arrow">→</div>
<div class="box">payment<small>8085 · idempotente</small></div><div class="arrow">:18095 →</div>
<div class="box orange">toxiproxy<small>proxy psp</small></div><div class="arrow">→</div>
<div class="box">psp<small>WireMock</small></div>
</div>

- `payment`: adaptador para o provedor de serviços de pagamento (PSP, *payment service provider*), `POST /payments` idempotente pela `Idempotency-Key`.
- `toxiproxy` (API na 8474): proxies do Transmission Control Protocol (TCP, *protocolo de controle de transmissão*) — latência, resets, quedas, **dois lugares para quebrar**.
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
max-attempts: ${PAYMENT_RETRY_ATTEMPTS:3}
wait-duration: 200ms
enable-exponential-backoff: true      # 200 ms, 400 ms
enable-randomized-wait: true
randomized-wait-factor: 0.5           # ± 50% jitter
retry-exceptions: [ResourceAccessException, HttpServerErrorException, RestClientException]
ignore-exceptions: [HttpClientErrorException, CallNotPermittedException, BulkheadFullException]
```

- Por tentativa *p* = 0,3 → três tentativas falham com *p*³ = 2,7%. Medido: **0,5% → 0,1%** — o toxic só atinge conexões **novas**.
- Custos: até 3× a carga, mais latência. **Só em chamadas idempotentes.**

---

## Idempotência de ponta a ponta

<div class="flow">
<div class="box accent">order<small>Idempotency-Key: order-&lt;id&gt;, a mesma em toda tentativa</small></div><div class="arrow">→</div>
<div class="box green">payment<small>chave UNIQUE · chave conhecida = primeiro resultado (200)</small></div><div class="arrow">→</div>
<div class="box">provedor<small>recebe a mesma chave</small></div>
</div>

<div class="ok">

Um timeout não significa que a chamada falhou — a resposta pode ter se perdido. A chave torna o retry inofensivo.

</div>

---

## 3 · Circuit breaker

<div class="flow">
<div class="box green">CLOSED<small>janela de 20, mín. 10</small></div><div class="arrow">proxy desativado · 10 chamadas falham →</div>
<div class="box red">OPEN<small>CallNotPermitted · 503 em µs</small></div><div class="arrow">10 s →</div>
<div class="box orange">HALF_OPEN<small>3 sondas</small></div><div class="arrow">proxy volta →</div>
<div class="box green">CLOSED</div>
</div>

- Abre com ≥ 50% de falhas **ou** ≥ 50% acima de 800 ms — sem rede, sem retry, sem espera.
- Protege as threads de quem chama **e** dá espaço para a dependência se recuperar.
- Tempo da reativação até `CLOSED`: até 10 s mais as sondas — depende de onde estava a espera.

<p class="small">Acompanhe: <code>/actuator/circuitbreakers</code>, <code>/actuator/circuitbreakerevents</code>.</p>

---

## 4 · Bulkhead

<div class="q">

As chamadas dão certo em 700 ms — abaixo do timeout e do limite de chamada lenta. A 70/s, o `GET /orders/{id}` fica lento mesmo assim. Por quê e o que resolve?

</div>

* 70/s × 0,7 s ≈ **49** de 50 threads esperam o `payment`.
* Bulkhead `max-concurrent-calls: 10`, `max-wait-duration: 0` → a 11ª chamada recebe `503` na hora.

<div class="flow">
<div class="box">order<small>50 threads</small></div><div class="arrow">→</div>
<div class="box orange">bulkhead: 10<small>esperam 700 ms o payment</small></div><div class="arrow">+</div>
<div class="box green">as outras 40<small>GET /orders/{id} em ms</small></div><div class="arrow">+</div>
<div class="box red">o resto<small>503 na hora (~85%)</small></div>
</div>

---

## Como as anotações se empilham

```java
@Retry(name = "payment", fallbackMethod = "unavailable")
@CircuitBreaker(name = "payment")
@Bulkhead(name = "payment")
public PaymentResponse charge(UUID orderId, BigDecimal amount) { ... }
```

<div class="flow">
<div class="box accent">Retry<small>3 tentativas</small></div><div class="arrow">→</div>
<div class="box accent">CircuitBreaker<small>aberto: falha rápido</small></div><div class="arrow">→</div>
<div class="box accent">Bulkhead<small>cheio: falha rápido</small></div><div class="arrow">→</div>
<div class="box">chamada</div><div class="arrow">qualquer recusa →</div>
<div class="box red">fallback: 503</div>
</div>

- O retry **ignora** `CallNotPermittedException` e `BulkheadFullException`; o breaker ignora `BulkheadFullException`.

---

## Nunca espere dentro de uma transação

- O `pay()` chama o `payment` **sem** transação aberta.
- Depois, uma transação curta: `UPDATE … WHERE status = 'PENDING_PAYMENT'` + evento no outbox.
- Esperar 3 s dentro de uma transação leva o esgotamento para o **pool de conexões** (≈ 10).

---

## Simulador: as cinco execuções, sem a stack

<div class="flow">
<div class="box red">timeout, antes<small>mediana do browse 4,75 s · 65 iterações descartadas</small></div><div class="arrow">→</div>
<div class="box green">depois (1 s)<small>o pay falha em 1,01 s · p95 do browse 8 ms</small></div>
</div>
<div class="flow">
<div class="box">retry<small>0,3% → 0,0% falharam</small></div>
<div class="box">breaker<small>abre em 0,3 s · fecha em 61,1 s</small></div>
<div class="box">bulkhead<small>58% falham rápido, p95 do browse 759 ms → 81% rejeitados, 8 ms</small></div>
</div>

- O simulador **pay-under-chaos** da página de padrões: escolha um passo, antes ou depois do seu padrão, e leia o resumo do k6.
- Os números do modelo não são os seus — compare a **forma** com as suas execuções.

---

<!-- _class: tight -->

## Meça

| Experimento | Toxic | Antes → depois |
|---|---|---|
| Timeout | latência 3 s | p95 do `pay`, **p95 do `browse`** |
| Retry | reset_peer 30% | % confirmados |
| Circuit breaker | proxy desativado | p95 do `pay`, `pay_fast_fail` |
| Bulkhead | latência 700 ms, 70 pay/s | p95 do `browse`, % rejeitados |

<div class="ok">

Uma execução de teste (45 s, payment + 3 s): p50 do `browse` de **9,04 s** sem proteção e **6,5 ms** com todos os padrões — reproduza o contraste, não os números.

</div>

<p class="small">k6 <code>load/pay-under-chaos.js</code>: <code>pay</code> (usa o payment) e <code>browse</code> (não usa) ao mesmo tempo — o segundo revela a cascata.</p>

---

## 5 · Game day

<div class="flow">
<div class="box orange">mestre do jogo<small>injeta, escondido</small></div><div class="arrow">→</div>
<div class="box red">alerta dispara</div><div class="arrow">→</div>
<div class="box accent">operadores<small>dashboard → trace → logs</small></div><div class="arrow">→</div>
<div class="box green">mitigar primeiro</div><div class="arrow">→</div>
<div class="box">escriba<small>tempos de detectar e mitigar</small></div>
</div>

- **Antes**: estado estável, hipóteses, raio de impacto, abortar = `POST /reset`; as regras de burn rate para o `order`.
- **Depois**: revisão sem culpados — tempo para detectar, tempo para mitigar, itens de ação. Rodízio de papéis.

<div class="warn">

Sem hipótese, não há experimento. Uma hipótese refutada é o resultado valioso.

</div>

---

## Experimente no playground

- `boxoffice-payment`: este lab — em t = 60 s o payment ganha +3 s; adicione timeout, retries, breaker e um bulkhead de 0,2.
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
