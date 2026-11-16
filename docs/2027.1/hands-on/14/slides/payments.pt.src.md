---
marp: true
lang: pt-BR
title: Hands-on 14 — Pagamentos em Sandbox
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

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 14</div>

# Lab 14 — Pagamentos em Sandbox

**Um provedor de pagamento real, sem dinheiro real: o modo de teste da Stripe atrás do adaptador do lab 9 — chaves, webhooks, reconciliação**

<!--
Capítulo 10, segundo lab: amarra as aulas 3 (um "comprar" repetido pode cobrar duas vezes), 10 (o provedor de pagamento) e 12
(provar quem chama). Roteiro: (1) um sandbox e uma chave de teste; (2) o adaptador Psp; (3) cobrar, repetir, recusar;
(4) webhooks assinados, uma vez por evento; (5) a resposta perdida; (6) reconciliação; (7) Pix com o Mercado Pago.
-->

---

## A história até aqui

<div class="flow" style="font-size: 1.1em">
<div class="box muted">aula 3 · lab 9<small>uma chave por pedido, contra um provedor falso</small></div><div class="arrow">→</div>
<div class="box accent">capítulo 10 · lab 14<small>o sandbox de um provedor real: modo de teste da Stripe</small></div><div class="arrow">→</div>
<div class="box">depois · aula 15<small>isso se sustenta às 10:00?</small></div>
</div>

<div class="q">

O cliente do lab 9 desiste depois de **1 s e 3 tentativas**. Num dia de provedor lento, **133 de 1.000** checkouts terminam UNKNOWN: cobrados, mas ninguém sabe. Quem nos conta o que aconteceu?

</div>

- O provedor conta — depois, talvez duas vezes — se a gente verificar e escutar.

<!--
A história da disciplina (visão geral de 2027.1); os 133 vêm do simulador idempotent-retry com o cliente do lab 9 e o provedor lento.
-->

---

## O que um provedor real acrescenta

<div class="matrix" style="--n: 2; font-size: 1.15em">
<div></div><div class="head">o falso do lab 9 (WireMock)</div><div class="head">sandbox da Stripe</div>
<div class="row">acesso</div><div class="box muted">nenhum</div><div class="box accent" style="flex-direction: column">uma secret key<small>sk_test_…, no .env, nunca no Git</small></div>
<div class="row">dinheiro</div><div class="box muted">um decimal</div><div class="box accent" style="flex-direction: column">centavos<small>R$ 350,00 → amount=35000</small></div>
<div class="row">"não"</div><div class="box muted">nunca</div><div class="box orange" style="flex-direction: column">HTTP 402 card_error<small>uma recusa é uma resposta</small></div>
<div class="row">depois</div><div class="box muted">nada</div><div class="box green" style="flex-direction: column">webhooks<small>assinados, pelo menos uma vez, em qualquer ordem</small></div>
</div>

- Nenhum dinheiro se move: `livemode: false`. O serviço se recusa a subir com uma chave de produção.

---

## 2 · Uma interface, dois provedores

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="box" style="flex: .7; display: flex; flex-direction: column; justify-content: center">order<small>vê AUTHORIZED / DECLINED</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">payment · Psp<small>boxoffice.psp.provider</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">implementações</div>
<div class="box muted">PspClient · fake<small>o padrão: os labs de caos e o CI não precisam de chave</small></div>
<div class="box green">StripePsp · stripe<small>POST /v1/payment_intents, confirm=true</small></div>
</div>
</div>

- O `order` nunca sabe qual provedor cobrou: o adaptador do lab 9, agora com uma junta.
- Números de cartão nunca tocam o BoxOffice: um meio de pagamento de teste (`pm_card_visa`) faz o papel do que o Stripe.js entrega num navegador.

---

## 3 · Cobrar, repetir, recusar

<div style="font-size: 1.1em">
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">chave sandbox-1</div>
<div class="box">POST /payments</div><div class="arrow">→</div>
<div class="box accent">PaymentIntent<small>Idempotency-Key: sandbox-1</small></div><div class="arrow">→</div>
<div class="box green">201 AUTHORIZED<small>pi_…</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">sandbox-1 de novo</div>
<div class="box">POST /payments</div><div class="arrow">→</div>
<div class="box muted">achado em payments<small>a Stripe não é chamada</small></div><div class="arrow">→</div>
<div class="box green">200 · o mesmo pi_…<small>um pagamento no Dashboard</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">chave sandbox-2</div>
<div class="box">pm_card_visa_chargeDeclined</div><div class="arrow">→</div>
<div class="box orange">HTTP 402 card_error</div><div class="arrow">→</div>
<div class="box orange">201 DECLINED<small>não é exceção: sem retry, sem breaker</small></div>
</div>
</div>

- De ponta a ponta pelo `order`: `CONFIRMED` — ou um `503` quando a Stripe passa do timeout de 1 s; pague de novo.

---

## 4 · Webhooks: o provedor conta depois

<div class="flow" style="font-size: 1.1em">
<div class="box accent">Stripe<small>payment_intent.succeeded</small></div><div class="arrow">→</div>
<div class="box">stripe-cli listen<small>sem endereço público</small></div><div class="arrow">→</div>
<div class="box orange">assinatura?<small>HMAC de t.corpo · ≤ 5 min</small></div><div class="arrow">→</div>
<div class="box orange">já visto?<small>stripe_events, id evt_…</small></div><div class="arrow">→</div>
<div class="box green">aplica · 200<small>atualiza ou cria o pagamento</small></div>
</div>

<div class="matrix" style="--n: 3; font-size: 1.1em">
<div></div><div class="head">assinado, novo</div><div class="head">assinado, de novo</div><div class="head">falsificado</div>
<div class="row">send-webhook.sh</div><div class="box green">applied 200</div><div class="box muted">duplicate 200</div><div class="box red">bad signature 400</div>
</div>

- HMAC: código de autenticação de mensagem baseado em hash (*hash-based message authentication code*), com a chave `whsec_…`. Um evento do sandbox é reenviado três vezes em poucas horas, pode chegar duas vezes e fora de ordem.

---

## 5 · A resposta perdida

<div class="flow" style="font-size: 1.1em">
<div class="box">pedido criado</div><div class="arrow">→</div>
<div class="box orange">a Stripe cobra<small>chave order-&lt;id&gt; · metadados</small></div><div class="arrow">→</div>
<div class="box red">o payment morre<small>sem linha: UNKNOWN</small></div><div class="arrow">→</div>
<div class="box green">webhook<small>cria a linha a partir dos metadados</small></div><div class="arrow">→</div>
<div class="box green">paga de novo<small>CONFIRMED · uma cobrança</small></div>
</div>

- A linha curada leva a mesma chave de idempotência que o `order` envia: exatamente o que o retry procura.
- Se o `payment` tivesse chamado a Stripe de novo, a chave repetiria o mesmo PaymentIntent.

<div class="ok">

Uma chave por pedido, de ponta a ponta: o `order`, a tabela `payments` e a `Idempotency-Key` da Stripe são o mesmo valor.

</div>

---

## Simulador: os checkouts UNKNOWN

<div class="matrix" style="--n: 2; font-size: 1.2em">
<div></div><div class="head">sem chave</div><div class="head">uma chave por pedido</div>
<div class="row">cobranças para 1.000 fãs</div><div class="box red">392 fãs pagam duas vezes ou mais</div><div class="box green">1.000 · 0 duplicadas</div>
<div class="row">checkouts UNKNOWN</div><div class="box muted">—</div><div class="box orange">133 · cada um cobrado uma vez</div>
</div>

- O cliente do lab 9 (1 s, 3 tentativas) contra um provedor lento: 40,2% das chamadas estouram o timeout.
- A chave remove as duplicadas; o webhook e a reconciliação resolvem os UNKNOWN.

<p class="small">Seção 5 da página · simulador <code>idempotent-retry</code>, chave "order", provedor lento.</p>

---

## 6 · Reconciliar: o provedor é a fonte da verdade

<div class="flow" style="font-size: 1.1em">
<div class="box">os nossos pagamentos<small>últimas 2 horas, só pi_…</small></div><div class="arrow">→</div>
<div class="box accent">consulta cada PaymentIntent</div><div class="arrow">→</div>
<div class="box orange">compara<small>succeeded ↔ AUTHORIZED</small></div><div class="arrow">→</div>
<div class="box green">divergências</div>
</div>

<div class="matrix" style="--n: 3; font-size: 1.05em">
<div></div><div class="head">a repetição assinada (passo 4)</div><div class="head">depois de removê-la</div><div class="head">uma linha virou DECLINED</div>
<div class="row">relatório</div><div class="box red" style="flex-direction: column">nosso AUTHORIZED<small>stripe: missing</small></div><div class="box green">[]</div><div class="box orange" style="flex-direction: column">nosso DECLINED<small>stripe: succeeded</small></div>
</div>

- Webhooks podem se perder; dinheiro precisa de uma segunda conferência. Em produção: um agendamento, um alerta, uma correção.

---

## 7 · Pix com o Mercado Pago

<div class="flow" style="font-size: 1.1em">
<div class="box">MercadoPagoPsp</div><div class="arrow">→</div>
<div class="box accent">POST /v1/orders<small>X-Idempotency-Key (obrigatório)</small></div><div class="arrow">→</div>
<div class="box orange">pendente + QR code<small>qr_code, qr_code_base64</small></div><div class="arrow">→</div>
<div class="box muted">o fã paga<small>no app do banco</small></div><div class="arrow">→</div>
<div class="box green">webhook · x-signature<small>o único "pago"</small></div>
</div>

- Com cartões, o webhook é uma rede de segurança; com Pix, é o **caminho principal**.
- O `order` precisa de um terceiro estado, "aguardando pagamento". Resultados de teste: nome do titular `APRO`, `OTHE`, `CONT`, `FUND`.

<p class="small">Confira a documentação atual do Mercado Pago: os nomes da Orders API diferem dos da Payments API, mais antiga.</p>

---

## Armadilhas

| Sintoma | Causa |
|---|---|
| o `payment` sai: precisa ser chave de teste | chave vazia ou de produção com `PSP_PROVIDER=stripe` |
| `Stripe answered 401` | chave copiada errada ou trocada |
| `400` sobre a moeda | o país da conta não aceita BRL: `STRIPE_CURRENCY=usd` |
| `400` sobre idempotência | uma chave reusada com outros parâmetros |
| webhooks `400 bad signature` | `STRIPE_WEBHOOK_SECRET` ≠ `listen --print-secret` ou o `payment` não foi reiniciado |
| primeiro `pay` → `503` | a Stripe passou do timeout de 1 s do `order`: pague de novo |

---

## O que quebra em seguida

<div class="flow" style="font-size: 1.15em">
<div class="box green">lab 14<small>cada checkout cobrado uma vez, toda cobrança conhecida</small></div><div class="arrow">→</div>
<div class="box orange">saber não é consertar<small>estornos, 3-D Secure, Pix pendente, chaves de produção e PCI DSS</small></div><div class="arrow">→</div>
<div class="box accent">aula 15 · projeto<small>tudo isso se sustenta às 10:00, com 2 M de fãs?</small></div>
</div>

- O PCI DSS (*Payment Card Industry Data Security Standard*) fica pequeno porque números de cartão nunca tocam o BoxOffice.

---

## Pontos-chave

1. Um **sandbox** é um provedor real sem dinheiro real; uma chave de produção é um bug.
2. Mantenha o provedor atrás de uma **interface**; o `order` vê só `AUTHORIZED` / `DECLINED`.
3. **Uma chave de idempotência por pedido**, de ponta a ponta: nenhum retry, em lugar nenhum, cobra duas vezes.
4. Uma **recusa é uma resposta**, não uma falha para o retry e o breaker.
5. **Webhooks**: verifique a assinatura no corpo bruto, processe cada evento uma vez, responda rápido.
6. **Reconcilie** com o provedor: o que os webhooks perdem, uma segunda conferência encontra.
