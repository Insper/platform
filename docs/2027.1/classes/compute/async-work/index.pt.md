Quando o pagamento de um pedido é aprovado, a BoxOffice tem muito a fazer: marcar o pedido como confirmado, transformar o hold em assentos vendidos, **gerar o PDF do ingresso** com um QR code (cerca de 800 ms de CPU), **enviá-lo por e-mail** pelo provedor (300 ms, às vezes 5 s), mandar uma **notificação push**, atualizar o **painel de vendas** e reindexar a disponibilidade para a **busca**. Se a requisição de checkout fizer tudo isso antes de responder, o fã espera segundos, cada provedor lento deixa o checkout lento, e uma queda do e-mail *derruba a venda de ingressos*.

Nada desse trabalho muda a resposta que o fã está esperando — "seu pedido está confirmado". Ele pode acontecer um instante depois, em outro lugar. Esta página trata desse "outro lugar": **workers** que processam jobs de uma fila e **schedulers** que iniciam trabalho num horário definido — e de como deixar ambos corretos quando jobs são reexecutados e réplicas rodam em paralelo.

---

## O que pertence ao caminho da requisição?

Faça uma pergunta sobre cada etapa: **a resposta ao usuário depende dela?**

| Etapa depois de "pagar" | A resposta depende dela? | Onde roda |
|---|---|---|
| Verificar que o pagamento foi aprovado, confirmar o hold → pedido `CONFIRMED` | sim — ela *é* a resposta | na requisição (ou no handler do webhook de pagamento) |
| Gerar o PDF do ingresso | não | worker |
| Enviar o e-mail com o ingresso | não | worker (notification) |
| Notificação push | não | worker (notification) |
| Atualizar o painel de vendas | não | consumidor de analytics |
| Atualizar a disponibilidade na busca | não | consumidor de search |

Tudo abaixo da primeira linha vira um **job** (uma unidade de trabalho descrita por uma mensagem pequena) colocado numa **fila** e executado por **workers** (processos que puxam jobs e os executam).

``` mermaid-sim
sequenceDiagram
    participant F as Fã
    participant O as order
    participant Q as Fila / Kafka
    participant W as worker de ingressos
    participant N as worker de notificação
    participant E as Provedor de e-mail
    F->>O: POST /orders/ord_9/confirm
    O->>O: pedido CONFIRMED (uma transação no BD)
    O->>Q: OrderConfirmed {orderId: ord_9}
    O-->>F: 200 Seu pedido está confirmado
    Q->>W: gerar ingressos de ord_9
    W->>W: PDF + QR → object store
    W->>Q: TicketsIssued {orderId: ord_9}
    Q->>N: TicketsIssued
    N->>E: enviar e-mail com o link
    E-->>N: 202 na fila
```

O que você ganha:

- **Latência**: o checkout responde em dezenas de milissegundos em vez de segundos.
- **Disponibilidade**: o provedor de e-mail pode ficar fora do ar por 20 minutos; os jobs esperam na fila e o checkout continua vendendo.
- **Nivelamento de carga**: a fila absorve o pico da abertura de vendas; os workers a esvaziam no próprio ritmo, constante.
- **Escala independente**: gerar ingressos consome CPU, enviar e-mail é limitado por I/O — cada pool de workers escala por conta própria.

O que você paga: o resultado chega **eventualmente**, não imediatamente; é preciso mostrar o status ("seus ingressos estão sendo emitidos"), tratar falhas sem um usuário a quem mostrar um erro e tornar cada job seguro para rodar mais de uma vez.

!!! info "Publicando com confiabilidade"
    "Fazer commit do pedido e *depois* publicar o evento" tem uma brecha: se o processo morrer entre os dois, o pedido existe e nenhum ingresso é emitido. O **transactional outbox** fecha essa brecha — grave o evento numa tabela `outbox` na *mesma* transação do pedido e deixe um relay publicá-lo. A aula 8 ([mensageria](../../messaging/index.md)) trata disso; o [hands-on 7](../../../hands-on/7/index.md) o implementa.

---

## Quantos workers?

Workers são dimensionados como qualquer servidor, com a **Lei de Little**: o número de jobs em andamento é igual à taxa de chegada vezes o tempo que cada job leva.

$$
\text{workers needed} = \text{job arrival rate} \times \text{time per job}
$$

Quando as chegadas superam a capacidade, o excesso se acumula como **backlog**, e o backlog só é drenado à *diferença* entre capacidade e chegadas:

$$
\text{backlog growth} = \lambda_{\text{in}} - \mu_{\text{workers}}, \qquad
\text{drain time} = \frac{\text{backlog}}{\mu_{\text{workers}} - \lambda_{\text{in}}}
$$

!!! example "Exemplo resolvido — geração de ingressos na abertura de vendas"

    Suponha (valores ilustrativos) que 60.000 assentos sejam vendidos em cerca de 10 minutos → **100 pedidos/s**; fora do pico, 10 pedidos/s. Gerar os ingressos de um pedido ocupa um worker por **0,8 s**.

    - Para acompanhar o pico: 100 × 0,8 = **80 workers** ocupados o tempo todo.
    - Com apenas 40 workers (capacidade de 50/s), o backlog cresce 50 jobs/s: depois de 10 minutos, há **30.000 jobs** esperando. O último fã espera cerca de 30.000 / 50 = 600 s = **10 minutos** pelos ingressos e, depois do pico, o backlog é drenado a 50 − 10 = 40 jobs/s, levando mais **12,5 minutos**.
    - Isso é aceitável? Só o SLO pode dizer. Se a promessa é "ingressos na sua caixa de entrada em até 5 minutos", 40 workers não bastam.

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt

SECONDS = 50 * 60
JOB_TIME = 0.8                      # seconds of work per job


def arrivals(t):
    return 100.0 if 10 * 60 <= t < 20 * 60 else 10.0


fig, ax = plt.subplots(figsize=(8, 3.6))
for workers, color in [(40, "#d62728"), (60, "#ff7f0e"), (100, "#2ca02c")]:
    capacity = workers / JOB_TIME
    backlog, xs, ys = 0.0, [], []
    for t in range(SECONDS):
        backlog = max(0.0, backlog + arrivals(t) - capacity)
        xs.append(t / 60)
        ys.append(backlog / 1000)
    ax.plot(xs, ys, color=color, label=f"{workers} workers ({capacity:.0f} jobs/s)")
ax.axvspan(10, 20, color="gray", alpha=0.12)
ax.text(15, ax.get_ylim()[1] * 0.92, "on-sale peak\n100 jobs/s", ha="center", va="top", fontsize=8)
ax.set_xlabel("minutes")
ax.set_ylabel("backlog (thousand jobs)")
ax.set_title("Queue backlog during the on-sale spike")
ax.legend(fontsize=8, loc="upper right")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

O gráfico traz duas lições. Primeiro, uma fila **converte um problema de capacidade em atraso**: nada falhou com 40 workers, os fãs só esperaram. Segundo, **quem está a jusante define o limite real**: se o provedor de e-mail aceita no máximo, digamos, 100 mensagens por segundo no seu plano, 500 workers de notificação não enviam mais rápido — só colecionam `429 Too Many Requests`. Dimensione o pool de workers pela dependência mais lenta e deixe a fila guardar o resto.

Escale workers pela **profundidade da fila ou pelo consumer lag**, não pela CPU: um worker esperando um provedor lento não usa CPU, mas também não está livre. [Serverless e autoscaling](../serverless-autoscaling/index.md#scaling-workers-on-queue-depth) mostra como (KEDA).

### Experimente no playground

Abra o cenário `async-queue`: produtores escrevem numa fila esvaziada por um pool de workers.

1. Rode o perfil **spike** e observe o **backlog** e o **consumer lag** subirem durante a rajada e depois caírem.
2. Dobre as réplicas de workers: o pico do backlog cai e é drenado mais cedo — confira com a fórmula acima.
3. Reduza o rate limit do serviço a jusante: mais workers deixam de ajudar, e aparecem erros no lugar.

<div class="sdp" data-scenario="async-queue" data-mode="compact" data-height="520" data-profile="spike"></div>

---

## Projetando jobs que sobrevivem ao mundo real

Uma fila não é mágica: workers caem no meio de jobs, brokers reentregam, provedores estouram o timeout. A maioria dos brokers oferece entrega **at-least-once** (pelo menos uma vez): um job só é removido (confirmado, *ack*) depois que o worker avisa que terminou, então uma queda antes do ack significa que o job será entregue *de novo*. Todas as regras abaixo decorrem disso.

| Regra | Por quê | Exemplo na BoxOffice |
|---|---|---|
| **Torne os jobs idempotentes** | o mesmo job *vai* rodar duas vezes | antes de gerar, verifique se `ord_9` já tem ingressos; envie o e-mail com uma chave de deduplicação `ord_9:tickets` |
| **Dê o ack depois do trabalho, não antes** | dar o ack primeiro transforma uma queda num job perdido | fazer commit do offset do Kafka depois que o PDF foi armazenado |
| **Coloque ids na mensagem, não dados** | as mensagens ficam pequenas; o worker lê o estado atual | `{"orderId": "ord_9"}`, não o pedido inteiro |
| **Faça retry com backoff e depois estacione** | erros transitórios se resolvem; os permanentes não podem travar a fila | 4 tentativas com 1 s, 2 s, 4 s, depois a **dead letter queue** (DLQ) |
| **Defina um timeout por job** | um job travado prende um worker para sempre | a geração do PDF é abortada após 10 s |
| **Separe filas por prioridade** | um job em massa não pode atrasar os urgentes | `tickets` (urgente) e `marketing-emails` (em massa) em filas e pools diferentes |
| **Registre o status do job** | usuários e suporte precisam ver o progresso | `ticket_status = PENDING / ISSUED / FAILED` no pedido |
| **Respeite os limites a jusante** | mais paralelismo do que o provedor permite = erros | um rate limiter no worker de notificação |

Uma **mensagem envenenada** (*poison message*) é aquela que falha sempre (um payload malformado, um bug). Sem limite de retries, ela é reprocessada para sempre e, em partições ordenadas, bloqueia todas as mensagens atrás dela. A DLQ a estaciona para um humano (ou para uma versão corrigida do código) e deixa a fila seguir. Monitore o tamanho da DLQ: uma DLQ crescendo é um incidente.

Com o Spring for Apache Kafka, retries com backoff e um tópico de dead letter são poucas anotações[^3]:

```java title="ticket-worker: TicketJobListener.java"
@Component
class TicketJobListener {

    private final TicketService tickets;

    TicketJobListener(TicketService tickets) { this.tickets = tickets; }

    @RetryableTopic(
        attempts = "4",                                    // 1 try + 3 retries
        backOff = @BackOff(delay = 1000, multiplier = 2.0), // 1 s, 2 s, 4 s (Spring Kafka 4)
        dltTopicSuffix = ".dlt")
    @KafkaListener(topics = "order.confirmed.v1", groupId = "ticket-worker")
    void onOrderConfirmed(OrderConfirmed event) {
        if (tickets.alreadyIssued(event.orderId())) {
            return;                                        // idempotent: duplicate delivery
        }
        tickets.renderAndStore(event.orderId());           // PDF + QR → object store
    }

    @DltHandler
    void onDeadLetter(OrderConfirmed event) {
        tickets.markFailed(event.orderId());               // visible to support; alert on rate
    }
}
```

### Onde os jobs vivem

| Opção | Durável? | Bom para | Cuidado com |
|---|---|---|---|
| No próprio processo (`@Async`, um pool de threads) | **não** — perdido numa queda ou num deploy | trabalho fire-and-forget que você pode se dar ao luxo de perder | não é uma fila; sem retries, sem visibilidade |
| Filas baseadas em Redis (Sidekiq, Celery, BullMQ) | em geral (depende da configuração de persistência) | filas de jobs simples, com retries e agendamentos | memória do Redis e configuração de persistência |
| Filas de broker (SQS, RabbitMQ, Cloud Tasks) | sim | um job → um worker, ack por mensagem, atrasos, DLQ | ordenação fraca ou só por grupo |
| Log de eventos (Kafka, Pub/Sub, Kinesis) | sim, com replay | muitos consumidores dos mesmos fatos, alto throughput, ordenação por chave | paralelismo limitado pelas partições; acks por offset |
| Motores de workflow (Temporal, AWS Step Functions) | sim, com estado | processos de várias etapas que duram de minutos a dias, com compensações | uma nova plataforma para aprender e operar |

Os motores de **execução durável** (*durable execution*) merecem menção: quando um processo tem muitas etapas e esperas — "evento cancelado → reembolsar 60.000 pedidos → enviar e-mail a cada fã → esperar 7 dias → fechar a contabilidade" — escrevê-lo como um workflow, cujo progresso o motor persiste após cada etapa, é mais simples e mais seguro do que encadear filas à mão[^4].

---

## Schedulers { #schedulers }

Parte do trabalho é disparada pelo **tempo**, não por uma requisição ou um evento:

- a cada 30 s, **liberar os holds expirados** para que seus assentos possam ser vendidos de novo;
- às 10:00:00, **abrir as vendas** de um evento;
- 24 h antes de cada show, **enviar um lembrete** a cada portador de ingresso;
- toda noite, **conciliar** os pagamentos com o relatório do provedor ([integrações](../integrations/index.md#reconciliation)).

### O problema do cron duplicado

A implementação óbvia é um método `@Scheduled` no serviço. Funciona com uma réplica. Com 10 réplicas, **o job roda 10 vezes**: 10 e-mails de lembrete por fã, 10 varreduras concorrentes brigando pelas mesmas linhas. O mesmo acontece com uma entrada de cron copiada em cada VM. Há quatro soluções padrão:

=== "CronJob do Kubernetes"

    Rode o job como um pod próprio, de vida curta, criado pelo cluster segundo um agendamento, de modo que as réplicas do serviço nunca o executem.

    ```yaml title="release-holds-cronjob.yaml"
    apiVersion: batch/v1
    kind: CronJob
    metadata:
      name: release-expired-holds
    spec:
      schedule: "* * * * *"              # every minute (cron's finest granularity)
      concurrencyPolicy: Forbid          # never two runs at the same time
      startingDeadlineSeconds: 30        # skip a run that could not start in time
      successfulJobsHistoryLimit: 3
      jobTemplate:
        spec:
          backoffLimit: 2
          activeDeadlineSeconds: 50      # kill a run that hangs
          template:
            spec:
              restartPolicy: Never
              containers:
                - name: sweeper
                  image: ghcr.io/boxoffice/inventory:1.8.2
                  args: ["--job=release-expired-holds"]
    ```

    Simples e visível (`kubectl get jobs`). A granularidade é de um minuto e iniciar um pod custa segundos, então serve para jobs que rodam a cada minuto ou com menos frequência.

=== "Lock distribuído (ShedLock)"

    Toda réplica *tenta* rodar o job, mas só aquela que obtém um lock num armazenamento compartilhado (PostgreSQL, Redis) de fato o executa.

    ```java title="inventory: HoldSweeper.java"
    @Component
    class HoldSweeper {

        private static final Logger log = LoggerFactory.getLogger(HoldSweeper.class);
        private final HoldRepository holds;

        HoldSweeper(HoldRepository holds) { this.holds = holds; }

        @Scheduled(fixedRate = 30_000)
        @SchedulerLock(name = "releaseExpiredHolds",
                       lockAtMostFor = "PT25S",   // lock expires even if this replica dies
                       lockAtLeastFor = "PT5S")   // absorb small clock differences
        void releaseExpiredHolds() {
            int released = holds.releaseExpired(Instant.now(), 5_000);   // batch of 5,000
            log.info("released {} expired holds", released);
        }
    }
    ```

    O ShedLock guarda o lock como uma linha (`name`, `lock_until`, `locked_by`) e o obtém com um `UPDATE` condicional, então não precisa de infraestrutura além do próprio banco de dados do serviço[^2].

=== "Eleição de líder"

    As réplicas elegem **um líder** que executa todo o trabalho agendado; se ele morrer, outro assume depois que o lease expira. O Kubernetes oferece objetos `Lease` para isso (o mesmo mecanismo que seus próprios controllers usam), e Spring Integration, etcd e ZooKeeper fornecem receitas de eleição.

    Serve para serviços com *muitas* tarefas periódicas, ou tarefas que precisam manter estado em execução (um líder que mantém uma conexão com o stream de um provedor).

=== "Scheduler gerenciado"

    A nuvem chama você segundo um agendamento: AWS EventBridge Scheduler, Google Cloud Scheduler, timers do Azure Logic Apps / Functions. Ele invoca um endpoint HTTP, uma fila ou uma função — no máximo uma vez por agendamento *do ponto de vista do scheduler*, mas ainda pelo menos uma vez do ponto de vista do seu endpoint, se ele fizer retries.

    Zero infraestrutura; aceita agendamentos únicos ("em 2027-03-14T10:00:00-03:00"), que o cron não consegue expressar.

### Locks expiram: fencing tokens

Um lock distribuído com expiração tem uma brecha sutil, descrita por Martin Kleppmann[^1]: uma réplica obtém o lock e então **pausa** (uma coleta de lixo longa, uma migração de VM) além da expiração do lock. Outra réplica obtém o lock e inicia o job. A primeira acorda, ainda acreditando que detém o lock, e as duas escrevem.

``` mermaid-sim
sequenceDiagram
    participant A as Réplica A
    participant L as Armazenamento de locks
    participant B as Réplica B
    participant DB as Banco de dados
    A->>L: obtém (token 33), expira em 25 s
    Note over A: pausa de GC: 40 s
    B->>L: lock expirado → obtém (token 34)
    B->>DB: libera holds (token 34)
    A->>DB: libera holds (token 33) — ainda acha que tem o lock
    DB-->>A: rejeitado: token 33 < 34 já visto
```

A correção é um **fencing token**: o armazenamento de locks entrega um número crescente a cada aquisição, e o recurso protegido rejeita escritas com um token mais antigo. Quando o recurso não consegue verificar tokens, o próprio job precisa ser **idempotente** — o que você precisa de qualquer forma. Um lock é uma otimização que evita esforço duplicado; a correção tem de vir da idempotência ou do banco de dados (um `UPDATE ... WHERE status = 'ACTIVE' AND expires_at < now()` condicional libera cada hold no máximo uma vez, não importa quantas varreduras rodem).

### Trabalho atrasado: três formas de expirar um hold

Liberar um hold 10 minutos depois de criado é um **job atrasado** (*delayed job*). Três designs, muitas vezes combinados:

| Design | Como | Prós | Contras |
|---|---|---|---|
| **Varredura** (*sweeper*) | um job agendado libera `WHERE expires_at < now()` em lotes | simples, pega tudo | os assentos voltam com até um período de atraso; carga em lote no BD |
| **Mensagem atrasada** | ao criar o hold, enfileira "liberar H-7" com atraso de 10 min (delay do SQS, sorted set do Redis por horário de vencimento, delayed exchange do RabbitMQ) | horário preciso, sem varredura | uma mensagem por hold; ainda precisa ser idempotente (o hold pode ter sido confirmado) |
| **Expiração preguiçosa** (*lazy expiry*) | trata um hold como livre quando `expires_at < now()` no momento da leitura | **correta imediatamente**, nenhum job necessário para a correção | linhas expiradas permanecem até a limpeza |

A BoxOffice usa **expiração preguiçosa para a correção** (a disponibilidade e os novos holds ignoram holds expirados) e uma **varredura para a limpeza**. Assim o scheduler não fica no caminho crítico: se ele ficar fora do ar por 5 minutos, nenhum assento é perdido.

!!! example "Abrindo as vendas às 10:00"
    Não faça "as vendas abrem" depender de um cron disparando exatamente às 10:00:00 — schedulers atrasam segundos, e uma execução perdida significaria nenhuma venda. Guarde `onSaleAt = 10:00:00` junto com o evento; o `inventory` simplesmente rejeita holds antes desse instante (uma verificação contra o relógio, com relógios sincronizados por NTP — [sistemas distribuídos](../../distributed/index.md)). O scheduler faz apenas a *preparação*: às 09:45 ele escala a frota e aquece os caches ([serverless e autoscaling](../serverless-autoscaling/index.md#scheduled-and-predictive-scaling)).

O cenário `notification-system` combina um scheduler, uma fila e os provedores de e-mail/push. Experimente aumentar o número de jobs do scheduler para simular a rajada de lembretes de 24 horas e observe onde o backlog se acumula.

<div class="sdp" data-scenario="notification-system" data-mode="compact" data-height="520"></div>

[:material-open-in-new: Abrir o simulador completo](../../../../playground/index.md)

---

## Trade-offs em resumo

| | Fazer na requisição | Fazer num worker |
|---|---|---|
| Latência para o usuário | soma de todas as etapas | só as etapas essenciais |
| Falha de uma etapa não essencial | falha a requisição | retry mais tarde; usuário não é afetado |
| Consistência | imediata | eventual — mostre o status |
| Picos de carga | atingem todas as dependências ao mesmo tempo | absorvidos pela fila |
| Depuração | um stack trace | seguir um job pelas filas (tracing) |
| Peças operacionais | nenhuma | broker, workers, DLQ, monitoramento do lag |

!!! tip "Na entrevista"

    Sempre que um design tiver uma etapa lenta, sujeita a falhas ou em rajadas que não muda a resposta ao usuário, diga: *"Eu tiraria isso do caminho da requisição: a API grava o pedido e um evento numa única transação (outbox), e um pool de workers o consome — idempotente, com retries, backoff exponencial e uma DLQ. Eu escalaria os workers pelo consumer lag."* Para trabalho agendado, mencione que um cron em cada réplica roda N vezes e escolha **CronJob, um lock ou eleição de líder** — mais idempotência, porque locks expiram. Depois dê um número: "100 jobs/s × 0,8 s = 80 workers no pico".

!!! warning "Armadilhas comuns"

    - **`@Async` tratado como fila**: o trabalho desaparece a cada deploy ou queda.
    - **Jobs não idempotentes**: a entrega at-least-once transforma um retry num segundo e-mail ou numa segunda cobrança.
    - **Sem limite de retries e sem DLQ**: uma mensagem envenenada bloqueia uma partição para sempre.
    - **Escalar workers pela CPU**: workers limitados por I/O parecem ociosos enquanto o backlog cresce.
    - **Mais workers do que o provedor permite**: só produz `429`s.
    - **`@Scheduled` em toda réplica**: o job roda N vezes.
    - **Confiar num lock para a correção**: locks expiram; use fencing tokens ou escritas idempotentes e condicionais.
    - **O scheduler no caminho crítico**: se "as vendas abrem" ou "o hold expira" exige que um job dispare na hora, um job atrasado vira uma indisponibilidade.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    RP["caminho da requisição: só o que<br/>a resposta precisa"] --> Q["jobs numa fila<br/>→ Mensageria"]
    Q --> W["workers<br/>taxa × tempo por job"]
    W --> JOB["jobs idempotentes, ack após o trabalho,<br/>retries com backoff"]
    JOB --> DLQ["DLQ para mensagens venenosas"]
    W --> SCALE["escalar pelo atraso da fila<br/>→ Autoscaling"]
    CRON["trabalho agendado<br/>em N réplicas"] --> LOCK["CronJob, lock distribuído,<br/>eleição de líder"]
    LOCK --> FENCE["locks expiram: fencing tokens<br/>→ Consenso distribuído"]
    CRON --> LAZY["expiração preguiçosa + varredor<br/>reservas → Bancos de dados"]
```

**Componentes da paleta:** [`queue`](../../../reference/components/messaging/index.md#queue) (jobs e mensagens atrasadas) · [`worker`](../../../reference/components/compute/index.md#worker) (consumidores dimensionados pela lei de Little) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (cron e trabalho atrasado, uma vez por cluster) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (commit do offset após o trabalho) · [`sql`](../../../reference/components/storage/index.md#sql) (a linha do ShedLock, reservas que expiram preguiçosamente) · [`objstore`](../../../reference/components/storage/index.md#objstore) (PDFs dos ingressos) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`email`](../../../reference/components/external/index.md#email) (o e-mail do ingresso, fora do caminho da requisição). **Cenários:** `async-queue`, `notification-system`. **Continua em:** [Serverless e autoscaling — escalar pela profundidade da fila](../serverless-autoscaling/index.md#scaling-workers-on-queue-depth), [Mensageria — filas e pub/sub](../../messaging/queues-pubsub/index.md), [Mensageria — semântica de entrega](../../messaging/semantics/index.md), [Distribuídos — consenso](../../distributed/consensus/index.md) (fencing), [Hands-on 7](../../../hands-on/7/index.md).

## Principais conclusões

- Mantenha na requisição só aquilo de que a resposta ao usuário depende; mova o resto para **jobs numa fila** processados por **workers**.
- Dimensione workers com a Lei de Little (`taxa × tempo por job`); uma fila transforma sobrecarga em **atraso**, e a dependência a jusante mais lenta define o limite real.
- A entrega é **at-least-once**: jobs idempotentes, ack depois do trabalho, retries com backoff, uma **DLQ** para mensagens envenenadas, prioridades por fila.
- Trabalho agendado em N réplicas roda N vezes: use um **CronJob**, um **lock distribuído** (ShedLock) ou **eleição de líder** — e mantenha a idempotência, porque locks expiram (**fencing tokens**).
- Projete regras baseadas em tempo de modo que a correção não dependa de um job disparar na hora (**expiração preguiçosa** + varredura).

---

[^1]: KLEPPMANN, M. [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html){target="_blank"}. 2016. Veja também KLEPPMANN, M. *Designing Data-Intensive Applications*, capítulo 8 (fencing tokens).
[^2]: [Kubernetes — CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/){target="_blank"}; [ShedLock](https://github.com/lukas-krecan/ShedLock){target="_blank"}.
[^3]: [Spring for Apache Kafka — Non-blocking retries](https://docs.spring.io/spring-kafka/reference/retrytopic.html){target="_blank"}.
[^4]: [Temporal documentation — Durable execution](https://docs.temporal.io/){target="_blank"}.
