---
marp: true
lang: pt-BR
title: Computação e serviços
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

# Computação e serviços

**Onde o código roda, como é dividido, como escala — e como depender de provedores que você não controla**

<!--
Roteiro: (1) app servers stateless e dimensionamento de réplicas; (2) monolito, monolito modular,
microsserviços, DDD e Conway; (3) estilos de API e contratos; (4) workers e schedulers; (5) serverless
e autoscaling; (6) integrações externas: idempotência, webhooks, reconciliação, indisponibilidades.
-->

---

## 09:59, dia de abertura de vendas

<div class="q">

**2 milhões** de fãs, **60 mil** assentos, venda abre às **10:00**. Às 03:00 a mesma plataforma atende algumas centenas de requisições por segundo.
O que a camada de computação precisa fazer nos próximos dez minutos?

</div>

- Servir o catálogo para milhões de visualizações — **escalar horizontalmente**.
- Reservar e vender assentos sem venda dupla — **estado no lugar certo**.
- Cobrar cartões por um **provedor externo** que pode dar timeout.
- Emitir 60 mil ingressos e e-mails — **trabalho em segundo plano**.
- Liberar holds expirados, abrir a venda na hora — **schedulers**.
- Ir de centenas a dezenas de milhares de req/s — **autoscaling**.

---

## A paleta de computação

| Componente | Roda | Exemplo na BoxOffice |
|---|---|---|
| **App Server** | handlers de requisição atrás de um load balancer | `catalog`, `inventory`, `order` |
| **Worker** | jobs retirados de uma fila | PDFs de ingressos, envio de e-mail |
| **Serverless** | funções curtas iniciadas por evento | receptor de webhooks, redimensionar imagens |
| **Auth Service** | login, tokens | `auth` emite JWTs |
| **Search** | busca textual sobre um índice | "coldplay são paulo" |
| **Scheduler** | trabalho disparado pelo tempo | liberar holds a cada 30 s |
| **Notifications** | fan-out para e-mail / push / SMS | "seus ingressos chegaram" |
| **Analytics** | ingestão e agregação de eventos | vendas por minuto |

---

## App servers stateless

Qualquer réplica atende qualquer requisição: **o estado vive fora do processo**.

| Estado que gruda no servidor | Novo endereço |
|---|---|
| sessão HTTP em memória | JWT no cliente, ou Redis |
| arquivos enviados no disco local | object store (S3, GCS, MinIO) |
| cache dentro do processo | Redis — ou TTLs curtos por réplica |
| job `@Scheduled` dentro da aplicação | CronJob, lock ou líder |
| contadores, rate limits em memória | Redis `INCR`, API gateway |

<div class="warn">

**Holds de assento num `HashMap`**: o próximo clique cai em outra réplica, um reinício esquece todos os holds, duas réplicas vendem o mesmo assento.

</div>

---

## Quantas réplicas?

> N = ⌈ RPS de pico / (RPS por réplica × utilização-alvo) ⌉ + folga

- `catalog`: 10 vCPUs × (1 / 20 ms) = **500 req/s** por réplica; pico de **4.000 req/s**.
- Com 100%: 8 réplicas — margem zero.
- Com alvo de **65%**: 4.000 / 325 ≈ 12,3 → **13**, + 1 de folga = **14**.

| Réplicas | 9 | 10 | 12 | 14 |
|---|---|---|---|---|
| Utilização | 89% | 80% | 67% | 57% |
| Latência média (M/M/10) | 31 ms | 24 ms | 21 ms | 20,4 ms |

<p class="small">A latência explode perto de 100% ocupado (o joelho) — e o p99 piora antes da média.</p>

<!--
Pergunte: por que não 100 réplicas? Custo, e 100 × 20 conexões = 2.000 conexões no PostgreSQL:
o gargalo muda para o banco. Mostre o cenário scale-out no playground.
-->

---

## Réplicas são descartáveis

- **Subir rápido**; a readiness só passa depois de pools e caches aquecidos.
- **Graceful shutdown** no `SIGTERM`: parar de aceitar, terminar o que está em voo, sair.
- Escalar **horizontalmente** a camada stateless; **verticalmente** (depois replicar, particionar) a stateful.

| Forma | Escala em | Paga por | Uso típico |
|---|---|---|---|
| VM | minutos | horas provisionadas | legado, bancos de dados |
| Containers no Kubernetes | segundos (pod) a minutos (nó) | nós | o padrão para serviços |
| Containers serverless | segundos, até zero | uso | APIs com períodos ociosos |
| Funções (FaaS) | sub-segundo, até zero | invocações + GB-s | cola de eventos, webhooks |

---

## Monolito → monolito modular → microsserviços

| | Monolito | Monolito modular | Microsserviços |
|---|---|---|---|
| Unidades de deploy | 1 | 1 | muitas |
| Fronteiras garantidas por | disciplina | o build (módulos, ArchUnit) | a rede |
| Chamadas entre partes | no processo | no processo | rede: podem falhar, ms |
| Transações | ACID em tudo | ACID, tabelas com dono por módulo | sagas, consistência eventual |
| Escala | app inteira | app inteira | por serviço |
| Autonomia dos times | baixa | média | alta |
| Custo operacional | o menor | baixo | alto |

<div class="ok">

**Monolito primeiro**: mover uma fronteira dentro de uma base de código é refatoração; entre serviços, é migração.

</div>

---

## Quando dividir compensa

| Força | Exemplo na BoxOffice |
|---|---|
| Perfil de escala diferente | `catalog` de leitura intensa vs `inventory` com escrita quente |
| Autonomia do time | busca publica duas vezes por dia; pagamentos, uma vez por mês |
| Isolamento de falhas | `assistant` fora do ar não pode parar a venda de ingressos |
| Escopo de compliance | só o `payment` toca o provedor (PCI) |
| Tecnologia diferente | `assistant` em Python, núcleo em Java |

<div class="warn">

**Monolito distribuído**: serviços com deploy conjunto, tabelas compartilhadas, longas cadeias síncronas, biblioteca de domínio compartilhada.

</div>

---

## Fronteiras com DDD

- **Subdomínios**: core (inventory, sala de espera) → construir; de suporte (catálogo, notificações); genéricos (auth, pagamentos, e-mail) → **comprar**.
- **Bounded context**: onde valem um modelo — e um significado para cada palavra.

<div class="cols">
<div>

**"Event" em três contextos**

- Catálogo: artista, data, local, imagens
- Inventário: mapa de assentos, setores, holds
- Pedido: id do evento, assento, **preço pago**

</div>
<div>

**Regras de agregados**

- referenciar outros agregados **por id**
- uma transação altera **um** agregado
- a raiz garante os invariantes

</div>
</div>

---

## Context maps e a lei de Conway

- **Open Host Service**: `catalog` publica REST + OpenAPI para qualquer consumidor.
- **Customer / Supplier**: `inventory` planeja sua API de holds com o `order`.
- **Anti-Corruption Layer**: `payment` traduz o modelo do provedor na fronteira.

> "Organizações produzem designs que copiam sua estrutura de comunicação." — Conway, 1968

- Se fronteiras e times discordam, **os times vencem**.
- **Manobra inversa de Conway**: times alinhados a fluxo por capacidade, mais um time de plataforma.
- **Banco por serviço**: os outros usam a API ou os eventos — nunca as tabelas.

---

## Dentro de um serviço: portas e adapters

```java
// core: a port in business terms
public interface PaymentGateway {
    ChargeResult charge(PaymentId id, Money amount,
                        PaymentMethodToken method, IdempotencyKey key);
}
// adapter: the only class that knows the provider's API
class ProviderPaymentGateway implements PaymentGateway { /* translate THEIR states */ }
```

- **SOLID**, principalmente a inversão de **D**ependência: o código de negócio depende de abstrações que ele possui.
- Ganho: testes em milissegundos com um fake; um segundo provedor é um novo adapter.
- **Não** exagere na arquitetura de um serviço CRUD: em camadas está ótimo.

---

## Um recurso, quatro estilos

<div class="cols">
<div>

**REST + OpenAPI**
`GET /v1/events/evt_42?include=availability`
cacheável, universal

**GraphQL**
`event(id: "evt_42") { title availability { section seatsLeft } }`
o cliente escolhe os campos

</div>
<div>

**gRPC + protobuf**
`rpc GetAvailability (Req) returns (Availability)`
tipado, binário, streaming, deadlines

**Assíncrono + AsyncAPI**
tópico `inventory.availability.v1`
`AvailabilityChanged {eventId, section, seatsLeft}`

</div>
</div>

<p class="small">Mesmo recurso, contratos diferentes: documento OpenAPI, <code>.proto</code>, schema GraphQL, AsyncAPI.</p>

---

## Escolhendo um estilo

| | REST | gRPC | GraphQL | Assíncrono |
|---|---|---|---|---|
| Payload | JSON | protobuf | JSON | JSON / Avro / protobuf |
| Nativo no navegador | sim | não (gRPC-Web) | sim | push via WS/SSE |
| Cache HTTP | excelente | nenhum | difícil | n/a |
| Acoplamento temporal | sim | sim | sim | **nenhum** |
| Melhor para | público, parceiros, leituras cacheáveis | interno de alto QPS, streaming | BFF compondo serviços | efeitos colaterais, fan-out |

- BoxOffice: **REST** na borda, **BFF GraphQL** para os apps, **gRPC** order → inventory, **eventos** após a confirmação, **webhooks** vindos do provedor.
- Cuidado no gRPC: conexões HTTP/2 longas anulam o balanceamento **L4**. No GraphQL: **N+1** → DataLoader.

---

## Projetando e evoluindo um contrato

- REST: métodos e códigos corretos (`201`, `202`, `409`, `422`, `429`), erros em **Problem Details**, paginação por **cursor**, `ETag` + `Cache-Control`.
- Escritas não seguras (`POST /holds`, `POST /orders`) exigem um **`Idempotency-Key`**.

| Compatível | Incompatível |
|---|---|
| novo endpoint / campo opcional / campo na resposta | remover ou renomear um campo |
| novo valor de enum na entrada | mudar tipo ou significado (reais → centavos) |
| protobuf: nova tag | protobuf: reusar uma tag (`reserved`!) |

**Expand and contract**: v2 ao lado da v1 → migrar → header `Sunset` → remover a v1. Pegue quebras com **testes de contrato** (Pact).

---

## Trabalho assíncrono: fora do caminho da requisição

A resposta ao usuário depende deste passo? **Não → job numa fila → worker.**

- Confirmar o pedido: na requisição. PDF do ingresso, e-mail, push, dashboard, busca: **workers**.
- Ganhos: latência, disponibilidade (e-mail fora ≠ vendas fora), nivelamento de carga, escala independente.

<div class="q">

100 pedidos/s, 0,8 s por job de ingresso, 40 workers. Backlog depois de 10 min de pico?

</div>

* Capacidade 40 / 0,8 = 50 jobs/s → cresce 50/s → **30.000 jobs**; o último fã espera ~10 min.
* Acompanhar exige 100 × 0,8 = **80 workers** — se o rate limit do provedor de e-mail permitir.

---

## Jobs que sobrevivem ao mundo real

A entrega é **pelo menos uma vez** — então:

- **Jobs idempotentes** (verificar antes de agir, chaves de deduplicação); **ack depois** do trabalho.
- **Ids nas mensagens**, não dados; um **timeout** por job.
- **Retry com backoff**, depois a **DLQ** (mensagens venenosas); alerta se a DLQ crescer.
- **Filas separadas** por prioridade: ingressos ≠ e-mails de marketing.
- **Respeitar os limites do downstream**: mais workers do que o provedor permite = `429`s.
- Escalar workers pela **profundidade da fila / lag**, não por CPU.

<p class="small"><code>@Async</code> não é fila: o trabalho some no deploy. Spring Kafka: <code>@RetryableTopic</code> + <code>@DltHandler</code>.</p>

---

## Schedulers

<div class="warn">

`@Scheduled` em 10 réplicas = o job roda **10 vezes**.

</div>

| Correção | Como |
|---|---|
| **CronJob** do Kubernetes | pod próprio; `concurrencyPolicy: Forbid` |
| **Lock distribuído** (ShedLock) | todos tentam, quem tem o lock roda |
| **Eleição de líder** | `Lease`, etcd, ZooKeeper |
| **Scheduler gerenciado** | EventBridge Scheduler, Cloud Scheduler |

- Locks **expiram** (pausa de GC!) → **fencing tokens**, ou escritas condicionais idempotentes.
- Tire o scheduler do **caminho crítico**: expiração preguiçosa do hold + sweeper; `onSaleAt` verificado nos dados.

---

## Serverless

- A plataforma roda sua função **por evento**, escala até zero, cobra por invocação + **GB-segundo**.
- **Cold start**: criar sandbox + subir runtime + init (JVM: segundos) → provisioned concurrency, SnapStart, native image.
- **Concorrência = taxa × duração**: 1.500 req/s × 0,2 s = **300** ambientes.
- Limites: cota da conta (Lambda: 1.000 por Region por padrão), 15 min no máximo, sem conexões longas.

<div class="warn">

Serverless escala; **seu banco não**: 300 ambientes = 300 conexões → RDS Proxy / PgBouncer, concorrência reservada.

</div>

<p class="small">Mais barato para trabalho esporádico e quase sempre ocioso (~US$ 1 por milhão de invocações curtas, ilustrativo); serviços estáveis e movimentados favorecem containers.</p>

---

## Autoscaling

> desiredReplicas = ⌈ currentReplicas × currentMetric / target ⌉ — a cada 15 s (HPA)

- 6 réplicas com 90% de CPU, alvo de 60% → **9**. A redução espera 5 min (estabilização).
- Níveis: **HPA/KEDA** (réplicas), **VPA** (tamanho), **Cluster Autoscaler / Karpenter** (nós).
- Métrica: CPU (limitado por CPU), RPS ou concorrência (limitado por I/O), **lag do consumidor** (workers, KEDA).
- Políticas: target tracking, step, **agendada**, preditiva, baseada em fila.

<div class="warn">

`maxReplicas` a partir do **orçamento do banco**: 500 conexões / pool de 20 = no máximo 25 réplicas.

</div>

---

## O atraso do autoscaling

| Passo | Típico (ilustrativo) |
|---|---|
| métricas coletadas | 15–60 s |
| ciclo do HPA | ≤ 15 s |
| nó novo, se necessário | 30–120 s |
| download da imagem | 5–60 s |
| início da JVM + aquecimento | 10–60 s |
| **total** | **~1–4 min** |

<div class="ok">

Um flash sale vai de 1× a 20× em segundos. Para picos **conhecidos**: **escale por agendamento** às 09:45 e pré-aqueça. Para os desconhecidos: folga, **sala de espera**, rate limiting, load shedding.

</div>

---

## Integrações externas: o que você não controla

- Latência com cauda pesada, a disponibilidade **deles**, **rate limits**, o calendário da API deles, custo por chamada.
- Resultados **decididos depois**: `processing`, 3-D Secure, webhook.

**Estados do pagamento**: CREATED → PENDING → SUCCEEDED / FAILED · timeout → **UNKNOWN** → consulta / webhook

<div class="warn">

Timeout **não** é falha: liberar os assentos de um fã que *foi* cobrado é um bug real. Também não é sucesso.

</div>

- Um **adapter** por provedor, com timeout, circuit breaker e bulkhead.

---

## Chaves de idempotência

- **Na entrada**: o app envia `Idempotency-Key` por ação lógica (o clique em *Pagar*), reusada em todo retry.
- **Na saída**: a BoxOffice envia ao provedor uma chave derivada do seu próprio id (`ord_9`).

| Caso | Comportamento |
|---|---|
| mesma chave, mesma requisição, concluída | reenviar a resposta guardada |
| mesma chave, em andamento | `409` |
| mesma chave, requisição diferente | `422` |
| falhou antes do commit | apagar a chave, permitir retry |

<p class="small">Implementação: tabela com chave primária <code>(client_id, key)</code>, <code>INSERT … ON CONFLICT DO NOTHING</code>, resposta gravada na mesma transação, expurgo após 24 h.</p>

---

## Webhooks

| Propriedade da entrega | O receptor precisa… |
|---|---|
| qualquer um pode chamar sua URL | **verificar o HMAC** sobre o corpo bruto |
| requisições capturadas podem ser reenviadas | checar o **timestamp** |
| pelo menos uma vez, retries por dias | **deduplicar** pelo id do evento |
| sem ordem garantida | aplicar transições **monotônicas** |
| handler lento → retries do provedor | **confirmar rápido**, processar num worker |
| entregas podem se perder | **reconciliar** |

<p class="small">Standard Webhooks: <code>webhook-id</code>, <code>webhook-timestamp</code>, <code>webhook-signature</code> sobre <code>id.timestamp.body</code>; compare com <code>hmac.compare_digest</code>.</p>

---

## Reconciliação e indisponibilidade de provedores

- **Reconcilie** em duas velocidades: um sweeper para pagamentos `UNKNOWN`/`PENDING` (minutos) e uma conferência diária com o relatório do provedor.
- Divergência "provedor aprovou, nosso pendente" → confirmar, ou **estornar** se o hold expirou.

| Provedor fora | A BoxOffice… |
|---|---|
| Pagamento | breaker abre, falha rápido, **estende os holds**, sweeper resolve o que estava em voo |
| E-mail | enfileira, limita ao rate limit, failover para um segundo provedor |
| Mapas do local | degrada: imagem estática |

---

<!-- _class: tight -->

## O mapa de conceitos de compute

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `app` | onde roda a lógica da requisição, como escala? | stateless, meta de 50–70%, REST / gRPC / GraphQL |
| `worker` `queue` | o que roda fora da requisição? | workers = taxa × tempo, pelo menos uma vez, DLQ |
| `scheduler` | o que roda num horário — uma vez? | CronJob, locks, eleição de líder, fencing |
| `serverless` | o que escala por requisição, até zero? | cold start, concorrência = taxa × duração |
| `auth` `search` `notifications` `analytics` | quais capacidades são compartilhadas? | bounded contexts, alimentadas por eventos, muitas vezes compradas |
| `payment` `email` `thirdparty` | como depender do que não controlamos? | idempotency keys, webhooks, reconciliação |
| *(a camada inteira)* | quantas réplicas, e quando? | HPA, KEDA, atraso do autoscaling, escala agendada |

<p class="small">Compute escala com facilidade <b>porque</b> é stateless — o estado mora nos armazenamentos das duas próximas aulas.</p>

---

## Conclusões

1. App servers stateless escalam **horizontalmente**; dimensione-os com **50–70%** de utilização + folga.
2. Comece **modular**; divida por uma força real; fronteiras = **bounded contexts**, moldadas pelos **times**.
3. REST na borda, gRPC por dentro, GraphQL nos BFFs, eventos para efeitos colaterais — evolua de forma **compatível**.
4. Fora do caminho da requisição: **jobs idempotentes**, retries, **DLQ**; schedulers que rodam **uma vez**.
5. Serverless: **cold starts, concorrência = taxa × duração**; o autoscaling **atrasa** — pré-escale picos conhecidos.
6. Integrações: **chaves de idempotência**, **webhooks verificados**, estado **UNKNOWN**, **reconciliação**, um plano de indisponibilidade por provedor.
