---
marp: true
lang: pt-BR
title: Hands-on 10 — Mensageria com Kafka
description: Plataformas, Microsserviços, DevOps e APIs · Insper
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

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 10</div>

# Hands-on 10 — Mensageria com Kafka

**Um produtor acrescenta a um log e responde; um consumidor o lê no seu próprio tempo — primeiro o par de referência, depois a loja**

<!--
Roteiro: (1) por que não mais uma chamada REST; (2) o Kafka em modo KRaft no compose; (3) o producer-service e a
rota no gateway; (4) o consumer-service; (5) rodar, olhar dentro do Kafka, parar o consumidor; (6) a loja:
order-events e o notification-service; (7) partições, grupos, chaves; (8) duplicatas, mensagens ruins, o
dead-letter topic; o simulador.
-->

---

## O e-mail deve bloquear o cliente?

<div class="q">

Toda chamada do order-service acontece **antes** de ele responder. Agora ele precisa enviar um **e-mail de confirmação**. Mais uma chamada REST?

</div>

<div style="font-size: 1.15em">
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">REST</div>
<div class="box">POST /orders</div><div class="arrow">→</div>
<div class="box">account, product</div><div class="arrow">→</div>
<div class="box red">serviço de e-mail<small>lento ou fora do ar: o pedido espera ou falha</small></div><div class="arrow">→</div>
<div class="box muted">201</div>
</div>
<div class="flow" style="margin-top: .6em">
<div class="arrow" style="flex: .55; text-align: left">Kafka</div>
<div class="box">POST /orders</div><div class="arrow">→</div>
<div class="box">account, product</div><div class="arrow">→</div>
<div class="box accent">acrescenta a um tópico<small>um log durável</small></div><div class="arrow">→</div>
<div class="box green">201 na hora</div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left"></div>
<div class="box muted" style="flex: 3.2">depois, no tempo dele: o notification-service lê o tópico e envia o e-mail</div>
</div>
</div>

---

## Dois passos: a referência, depois a loja

<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .55; text-align: left">Referência</div>
<div class="box">GET /producer/{msg}</div><div class="arrow">→</div>
<div class="box accent">producer-service</div><div class="arrow">send →</div>
<div class="box orange">store-producer-example<small>sem chave</small></div><div class="arrow">→</div>
<div class="box green">consumer-service<small>grupo store</small></div>
</div>
<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .55; text-align: left">Loja</div>
<div class="box">POST /orders</div><div class="arrow">→</div>
<div class="box accent">order-service<small>depois de salvar</small></div><div class="arrow">send →</div>
<div class="box orange">order-events<small>chave = id do pedido</small></div><div class="arrow">→</div>
<div class="box green">notification-service<small>grupo notification-group</small></div>
</div>

- O mesmo padrão duas vezes: dois serviços Spring Boot que **nunca chamam um ao outro**.
- O produtor não sabe quem lê; um novo leitor (analytics) é um novo **grupo**, não uma mudança de código.

<!--
A tabela "Referência / Na loja" da página lista as mesmas peças: produtor, tópico, chave, consumidor, mensagem.
-->

---

## Um tópico é um log

<div class="flow" style="font-size: 1.2em; align-items: stretch">
<div class="arrow" style="flex: .5; align-self: center; text-align: left">partição 0</div>
<div class="box green">0<small>hello</small></div>
<div class="box green">1<small>world</small></div>
<div class="box orange">2<small>a</small></div>
<div class="box orange">3<small>b</small></div>
<div class="box orange">4<small>c</small></div>
<div class="box muted">5<small>próxima escrita</small></div>
</div>
<div class="flow" style="font-size: 1.05em">
<div class="arrow" style="flex: .5"></div>
<div class="box green" style="flex: 2">lidos e confirmados pelo grupo store</div>
<div class="box orange" style="flex: 3">esperando: atraso = 5 − 2 = 3</div>
<div class="box muted">offset final 5</div>
</div>

- O produtor **acrescenta**; um registro ganha o próximo **offset** e fica — ler não o apaga.
- O Kafka guarda, por **grupo** e partição, o **offset confirmado**: o próximo registro que esse grupo vai ler.
- **Atraso** (*lag*) = offset final do log − offset confirmado. Outro grupo lê o mesmo log a partir do seu próprio offset.

---

## 2 · Kafka no Docker Compose

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="group">
<div class="caption">rede do Docker</div>
<div class="box">producer · consumer<small>bootstrap-servers: kafka:9092</small></div>
</div>
<div class="arrow" style="align-self: center">PLAINTEXT →</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">kafka · um nó, KRaft<small>broker + controlador · :9092 clientes · :9093 quórum de controladores</small></div>
<div class="arrow" style="align-self: center">sem portas →</div>
<div class="box muted" style="flex: .7; display: flex; flex-direction: column; justify-content: center">sua máquina<small>as ferramentas rodam dentro do container</small></div>
</div>

- **KRaft**: o Kafka guarda os metadados no seu próprio quórum Raft; o Kafka 4.0 removeu o ZooKeeper.
- `ADVERTISED_LISTENERS: kafka:9092` — o nome do serviço; num container, `localhost` é o próprio container.
- Um tópico é **criado no primeiro uso** com `KAFKA_NUM_PARTITIONS: 1`; um broker → fator de replicação 1.

<p class="small">A referência usa <code>apache/kafka:latest</code> (4.3.1 quando escrito); fixe a versão para builds reprodutíveis.</p>

---

## 3 · O producer-service

<div class="flow" style="font-size: 1.1em">
<div class="box">GET /producer/hello</div><div class="arrow">→</div>
<div class="box">ProducerResource</div><div class="arrow">→</div>
<div class="box accent">ProducerService<small>Map → JSON (ObjectMapper)</small></div><div class="arrow">→</div>
<div class="box orange">kafkaTemplate.send<small>(topic, json) · sem chave</small></div><div class="arrow">→</div>
<div class="box green">200<small>entregue ao buffer do cliente</small></div>
</div>

```java
Map<String, String> map = Map.of("id", id, "message", msg);
kafkaTemplate.send("store-producer-example", objectMapper.writeValueAsString(map));
```

- `KafkaProducerConfig`: o endereço do broker + `StringSerializer` para chave e valor — nada mais.
- `send` é **assíncrono**: `200` = "entregue ao cliente do Kafka", não "gravado".
- Desde o Kafka 3.0 os padrões são seguros: `acks=all` e **idempotência** ligada.

---

## 3.1 · Pelo gateway

<div class="flow" style="font-size: 1.15em">
<div class="box muted">curl</div><div class="arrow">→</div>
<div class="box">lb :8080</div><div class="arrow">→</div>
<div class="box accent">gateway<small>rota Path=/producer/**</small></div><div class="arrow">→</div>
<div class="box green">RouterValidator<small>"GET /producer/**" está aberta: sem cookie</small></div><div class="arrow">→</div>
<div class="box">producer:8080</div>
</div>

- Sem a rota: `404`. Sem a entrada aberta: `401` (a rota exige login).

<div class="warn">

Um `GET` aberto que **publica** é só uma demonstração: qualquer um escreve no tópico e um crawler ou um prefetch publicariam também. Na loja, o evento sai de `POST /orders`, uma rota protegida.

</div>

---

## 4 · O consumer-service

<div class="flow" style="font-size: 1.15em">
<div class="box accent">listener container<small>faz poll em store-producer-example</small></div><div class="arrow">→</div>
<div class="box">@KafkaListener<small>chamado uma vez por registro</small></div><div class="arrow">→</div>
<div class="box green">todos os registros do poll prontos</div><div class="arrow">→</div>
<div class="box orange">confirma os offsets<small>AckMode.BATCH</small></div><div class="arrow">↺</div>
</div>

```java
@KafkaListener(topics = "store-producer-example", groupId = "store")
public void consumerMsg(String message) { … logger.debug("enqueue {}", map); }
```

- O método nunca chama `poll()` nem `commit()`: o container chama, com `enable.auto.commit=false`.
- Uma queda antes do commit → esses registros voltam: at-least-once (seção 8).

<p class="small">O <code>pom.xml</code> é o do produtor com <code>artifactId</code> <code>consumer-service</code> — mantenha o antigo e o jar ganha o nome do produtor.</p>

---

<!-- _class: tight -->

## 5 · Rode a referência

```bash
cd api/producer-service && mvn clean package -DskipTests && cd ../..
cd api/consumer-service && mvn clean package -DskipTests && cd ../..
cd api && docker compose up -d --build
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/producer/hello     # 200
```

<div class="flow" style="font-size: 1.05em">
<div class="box accent">producer-1<small>queue {id=e295…, message=hello}</small></div><div class="arrow">→</div>
<div class="box orange">store-producer-example<small>partição 0 · offset 0</small></div><div class="arrow">→</div>
<div class="box green">consumer-1<small>enqueue {id=e295…, message=hello}</small></div>
</div>

| Ferramenta (dentro do container `kafka`) | Mostra |
|---|---|
| `kafka-topics.sh --describe --topic …` | partições, líder, réplicas |
| `kafka-console-consumer.sh --from-beginning` | os registros, ainda lá depois de lidos |
| `kafka-consumer-groups.sh --describe --group store` | offset confirmado, offset final, **atraso** |

---

## 5.2 · O consumidor estava fora do ar

<div class="flow" style="font-size: 1.15em">
<div class="box red">docker compose stop consumer</div><div class="arrow">→</div>
<div class="box orange">3 × curl /producer/…<small>200, 200, 200</small></div><div class="arrow">→</div>
<div class="box orange">--describe<small>nenhum membro ativo · atraso 3</small></div><div class="arrow">→</div>
<div class="box green">start consumer<small>retoma no offset 2: a, b, c · atraso 0</small></div>
</div>

- O produtor **não percebeu**: respondeu `200` três vezes.
- Com REST, essas três chamadas teriam **falhado**; com um log no meio, o consumidor alcança o atraso.

<div class="ok">

A mensageria assíncrona transforma "o outro serviço está fora do ar" de um erro em um **atraso**.

</div>

---

## 6 · Na loja: order-events

<div class="flow" style="font-size: 1.1em">
<div class="box">POST /orders</div><div class="arrow">→</div>
<div class="box">account, product<small>REST, síncrono</small></div><div class="arrow">→</div>
<div class="box">salva o pedido</div><div class="arrow">→</div>
<div class="box accent">send(order-events, chave = id do pedido)</div><div class="arrow">→</div>
<div class="box green">201</div>
</div>
<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: 2.6"></div>
<div class="box orange">próximo poll</div><div class="arrow">→</div>
<div class="box green">notification-service<small>sending confirmation email: order …</small></div>
</div>

- Publique **depois** de salvar: nunca anuncie um pedido que não existe.
- O order-service nunca chama o notification-service e não espera o e-mail.

---

## 6 · O mesmo padrão, três mudanças

<div class="matrix" style="--n: 2; font-size: 1.15em">
<div></div><div class="head">referência</div><div class="head">loja</div>
<div class="row">produtor</div><div class="box" style="flex-direction: column">ProducerService<small>send(topic, json)</small></div><div class="box accent" style="flex-direction: column">OrderEventPublisher<small>send("order-events", id, json): com chave</small></div>
<div class="row">config</div><div class="box">KafkaProducerConfig</div><div class="box">a mesma classe, no pacote store.order</div>
<div class="row">consumidor</div><div class="box">consumer-service</div><div class="box green" style="flex-direction: column">notification-service<small>novo pacote, grupo notification-group, tópico order-events</small></div>
<div class="row">mensagem</div><div class="box">{id, message}</div><div class="box">{id, idAccount, total}</div>
</div>

- Teste: faça login, `POST /orders` → `201` na hora → a linha do e-mail em `docker compose logs notification`.

---

## 7 · Partições: a chave escolhe uma

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="box accent" style="flex: .8; display: flex; flex-direction: column; justify-content: center">order-service<small>chave = id do pedido</small></div>
<div class="arrow" style="align-self: center">murmur2(chave) % 3 →</div>
<div class="group">
<div class="caption">order-events · 3 partições</div>
<div class="box">P0<small>eventos de alguns pedidos, em ordem</small></div>
<div class="box">P1<small>…</small></div>
<div class="box">P2<small>…</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">notification-group</div>
<div class="box green">notification-1<small>lê P0, P1</small></div>
<div class="box green">notification-2<small>lê P2</small></div>
</div>
</div>

- Mesma chave → mesma partição → os eventos de um pedido ficam **em ordem**.
- Num grupo, cada partição tem **um** leitor; entrar ou sair → **rebalanceamento**, retomando no offset confirmado.
- O Kafka consegue **acrescentar** partições (`--alter --partitions 3`), nunca removê-las.

---

## 7 · Quantas instâncias ajudam?

<div class="matrix" style="--n: 4; font-size: 1.2em">
<div></div><div class="head">1 instância</div><div class="head">2</div><div class="head">3</div><div class="head">4</div>
<div class="row">1 partição (o lab)</div><div class="box green">lê P0</div><div class="box orange">1 ociosa</div><div class="box orange">2 ociosas</div><div class="box orange">3 ociosas</div>
<div class="row">3 partições</div><div class="box green">lê as 3</div><div class="box green">P0, P1 · P2</div><div class="box green">uma cada</div><div class="box orange">1 ociosa</div>
</div>

- O número de partições **limita** o paralelismo de um grupo.
- `docker compose up -d --scale notification=2` + `kafka-consumer-groups --describe --members`: `#PARTITIONS 1` e `0`.
- Outro grupo (analytics) lê **todas** as mensagens, nos seus próprios offsets.

---

## 7 · Sem chave, as partições não espalham

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="box accent" style="flex: .8; display: flex; flex-direction: column; justify-content: center">9 × curl /producer/…<small>sem chave</small></div>
<div class="arrow" style="align-self: center">particionador sticky →</div>
<div class="group">
<div class="caption">store-producer-example · 3 partições</div>
<div class="box muted">P0<small>nada novo</small></div>
<div class="box orange">P1<small>as nove: offsets 0 a 8</small></div>
<div class="box muted">P2<small>nada</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">grupo store</div>
<div class="box green">consumer-1<small>lê P0, P1: faz todo o trabalho</small></div>
<div class="box orange">consumer-2<small>lê P2: ocioso</small></div>
</div>
</div>

- Sem chave → o produtor **enche uma partição** antes de passar à próxima (KIP-794, uma *Kafka Improvement Proposal*): lotes grandes, nada espalhado.
- Uma chave espalha a carga **e** mantém cada chave em ordem: é por isso que `order-events` usa o id do pedido.

<!--
Medido na stack do lab: depois de --partitions 3 e de um restart, nove mensagens via curl foram todas para a partição 1.
-->

---

## Simulador: partições e grupos

<div class="q">

A parte da loja no lab, sem Docker: `order-events` com 1 partição, um notification-service. O play roda uma página; os botões funcionam a qualquer momento.

</div>

<div class="flow" style="font-size: 1.15em">
<div class="box orange">6 pedidos, 1 partição<small>todos em P0 · notification-2 não recebe nada</small></div><div class="arrow">→</div>
<div class="box accent">--partitions 3<small>notification-1 ← P0, P1 · notification-2 ← P2</small></div><div class="arrow">→</div>
<div class="box green">mais 6 pedidos<small>divididos em 2, 2 e 2 pela chave</small></div>
</div>

- Pare uma instância: a partição dela passa para a outra, que esvazia o atraso uma mensagem por poll.
- Modo **livre**: 4 instâncias em 3 partições — uma fica ociosa.

<p class="small">Seção 7 da página · simulador <code>order-events</code>, roteiro "7 · Partições e grupos".</p>

---

## 8.1 · At-least-once

<div class="flow" style="font-size: 1.1em">
<div class="box">registro no offset 0</div><div class="arrow">→</div>
<div class="box green">e-mail enviado</div><div class="arrow">→</div>
<div class="box red">morto antes do commit</div><div class="arrow">→</div>
<div class="box orange">reinício / rebalanceamento<small>offset 0 de novo</small></div><div class="arrow">→</div>
<div class="box red">o mesmo e-mail duas vezes</div>
</div>

- O container confirma **depois** que o listener retorna: uma queda no meio significa reentrega.
- O Kafka entrega **pelo menos uma vez** — o consumidor precisa ser **idempotente**.

<div class="ok">

Registre os ids de pedido notificados num armazenamento **durável** (`INSERT … ON CONFLICT DO NOTHING`) e envie o e-mail só quando o insert acrescentou uma linha. Um conjunto em memória morre justamente na queda que causa a reentrega.

</div>

---

## 8.2 · Uma mensagem que não pode ser processada

<div class="flow" style="font-size: 1.15em">
<div class="box orange">echo 'oops' | console producer<small>não é JSON</small></div><div class="arrow">→</div>
<div class="box">readValue lança exceção<small>10 tentativas, sem pausa</small></div><div class="arrow">→</div>
<div class="box red">ERROR · Backoff … exhausted<small>for order-events-0@1</small></div><div class="arrow">→</div>
<div class="box red">confirma depois dela<small>a mensagem sumiu</small></div>
</div>

- Sem error handler próprio → o `DefaultErrorHandler` do Spring Kafka: `FixedBackOff(0, 9)`, registra, pula.
- Nada trava — os próximos pedidos passam, atraso de volta a `0` — mas **uma linha de log** é tudo o que sobra.

<div class="warn">

Para um pedido cujo evento tinha um bug, é um cliente que nunca recebe o e-mail — e ninguém percebe.

</div>

---

## 8.3 · Um dead-letter topic (DLT)

<div class="flow" style="font-size: 1.15em">
<div class="box orange">registro ruim</div><div class="arrow">→</div>
<div class="box">3 tentativas, a 1 s<small>Record in retry and not yet recovered</small></div><div class="arrow">→</div>
<div class="box accent">DeadLetterPublishingRecoverer</div><div class="arrow">→</div>
<div class="box green">order-events-dlt<small>offset 0 · oops · inspecionar, corrigir, reprocessar</small></div>
</div>

```java
new DefaultErrorHandler(new DeadLetterPublishingRecoverer(kafkaTemplate(),
    (record, ex) -> new TopicPartition(record.topic() + "-dlt", -1)), new FixedBackOff(1000L, 2L))
```

- Destino padrão: `<tópico>-dlt`, **mesma partição** → o DLT precisaria de tantas partições quanto o original; `-1` deixa o Kafka escolher.
- O registro no DLT leva headers: tópico, partição e offset originais e a exceção.

---

## Simulador: falhas

<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .5; text-align: left">duplicatas</div>
<div class="box red">kill antes do commit<small>1 e-mail duplicado</small></div><div class="arrow">→</div>
<div class="box green">consumidor idempotente<small>a repetição é pulada</small></div>
</div>
<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .5; text-align: left">mensagem ruim</div>
<div class="box red">handler padrão<small>10 tentativas, pulada · 1 perdida · atraso 0</small></div><div class="arrow">→</div>
<div class="box green">dead-letter topic<small>3 tentativas → order-events-dlt · 0 perdidas</small></div>
</div>

- Os contadores mostram: e-mails enviados, e-mails duplicados, atraso do grupo, **mensagens perdidas**, `order-events-dlt`.
- Um registro por poll: cada passo da página é um clique.

<p class="small">Seção 8 da página · simulador <code>order-events</code>, roteiro "8 · Falhas".</p>

---

## Armadilhas

| Sintoma | Causa |
|---|---|
| `401` / `404` em `/producer/hello` | rota não aberta no `RouterValidator` / ausente no gateway |
| `COPY target/*.jar` falha | `mvn clean package` não rodou nesse serviço |
| jar do consumidor chamado `producer-service-1.0.0.jar` | o `pom.xml` copiado ainda tem o `artifactId` do produtor |
| uma segunda instância nunca trabalha | 1 partição — ou sem chave: tudo numa partição |
| um e-mail enviado duas vezes | queda antes do commit: torne o consumidor idempotente |
| um evento ruim sumiu | o error handler padrão o pulou: acrescente um dead-letter topic |

---

## Pontos-chave

1. Um **tópico é um log**: o produtor acrescenta e responde; os consumidores leem nos seus próprios offsets.
2. Spring Kafka: `KafkaTemplate.send` para publicar, `@KafkaListener` + um **grupo** para consumir; o container confirma.
3. Um consumidor fora do ar significa **atraso**, não erros: ele alcança.
4. **Partições** limitam o paralelismo de um grupo; uma **chave** espalha a carga e mantém cada chave em ordem.
5. A entrega é **at-least-once**: consumidores idempotentes, com um registro durável.
6. Sem um **dead-letter topic**, uma mensagem ruim é tentada 10 vezes e **se perde**.
