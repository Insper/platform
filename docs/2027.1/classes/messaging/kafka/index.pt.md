Seis meses depois de o BoxOffice adotar pub/sub, chegam três pedidos na mesma semana. O time de dados quer carregar *todos* os eventos de pedido dos últimos sete dias no data warehouse — inclusive eventos publicados antes de o carregador existir. O time de busca lançou um bug que indexou preços errados por duas horas e quer **reler** essas duas horas depois da correção. E o time de fraude quer todos os eventos do mesmo pedido, em ordem, para detectar padrões de "reserva, libera, reserva, libera" feitos por bots. Uma fila não consegue fazer nada disso: depois que uma mensagem é confirmada, ela some, e consumidores concorrentes embaralham a ordem.

Os três pedidos pedem a mesma coisa: guardar as mensagens, em ordem, e deixar cada leitor decidir de onde ler. Isso é um **log**, e o Apache Kafka é o sistema que transformou o log na espinha dorsal das arquiteturas de dados modernas[^1][^2].

---

## O log { #the-log }

Um **log** aqui não é um arquivo de texto com mensagens de depuração. É a abstração de armazenamento mais simples que existe: uma **sequência de registros só de acréscimo (append-only) e totalmente ordenada**. Quem escreve só pode adicionar no fim; cada registro recebe o próximo número sequencial, o seu **offset**. Quem lê nunca remove nada — cada leitor só lembra o offset até onde chegou.

``` diagram
flowchart LR
    subgraph log ["order-events (uma partição)"]
        direction LR
        r0["0<br/>OrderPlaced<br/>o-1"] --- r1["1<br/>OrderPlaced<br/>o-2"] --- r2["2<br/>OrderConfirmed<br/>o-1"] --- r3["3<br/>OrderCancelled<br/>o-2"] --- r4["4<br/>OrderPlaced<br/>o-3"] --- r5["5<br/>(próxima escrita)"]
    end
    n["notification<br/>offset confirmado 4"] -.-> r4
    a["analytics<br/>offset confirmado 2"] -.-> r2
    w["carregador do warehouse<br/>relendo desde 0"] -.-> r0
```

Essa mudança minúscula — ler não apaga — tem consequências grandes:

- **Qualquer número de leitores independentes.** `notification`, `analytics` e o carregador do warehouse leem os mesmos dados no seu próprio ritmo. Um leitor lento só fica para trás; não atrasa ninguém.
- **Replay.** Um leitor pode mover seu offset para trás e reler o histórico (a correção do time de busca), e um leitor novo pode começar do início (o carregador do time de dados).
- **Ordem.** Os registros são lidos na ordem em que foram escritos — dentro de um log.
- **O log é a fonte da verdade sobre "o que aconteceu".** Bancos de dados, caches e índices de busca podem ser reconstruídos a partir dele — a ideia por trás de change data capture e event sourcing ([Padrões](../patterns/index.md)).

---

## Tópicos, partições e offsets { #topics-partitions-and-offsets }

Um único log em uma única máquina limitaria o throughput a um disco e a uma máquina. O Kafka divide cada **tópico** em **partições**: cada partição é um log independente, guardado em um broker diferente, com seus próprios offsets. O tópico é apenas o nome de um conjunto de partições.

``` diagram-sim
flowchart LR
    p1["order (réplica 1)"] -->|"chave o-7731"| P1
    p2["order (réplica 2)"] -->|"chave o-1002"| P0
    p2 -->|"chave o-5120"| P2
    subgraph topic ["tópico order-events"]
        P0["partição 0 · broker 1<br/>0 1 2 3 4 5 →"]
        P1["partição 1 · broker 2<br/>0 1 2 3 →"]
        P2["partição 2 · broker 3<br/>0 1 2 3 4 →"]
    end
```

- Um registro é identificado por **(tópico, partição, offset)**. Os offsets são por partição: o offset 3 na partição 0 e o offset 3 na partição 1 são registros sem relação.
- **A ordem só é garantida dentro de uma partição.** Dois registros em partições diferentes não têm ordem definida.
- As partições são a **unidade de paralelismo**: partições diferentes são escritas por brokers diferentes e lidas por consumidores diferentes ao mesmo tempo.
- Em disco, uma partição é uma sequência de arquivos de **segmento** (por exemplo, 1 GB cada). O Kafka só acrescenta no segmento ativo e apaga ou compacta segmentos antigos inteiros — é isso que torna as escritas sequenciais e baratas.

### A chave decide a partição { #keys-decide-the-partition }

Cada registro pode ter uma **chave**. O particionador padrão calcula o hash da chave (murmur2) e toma o resultado módulo o número de partições:

$$
\text{partition} = \text{murmur2}(\text{key}) \bmod N_{\text{partitions}}
$$

Mesma chave → mesma partição → **em ordem**. Então a chave é como você diz *o que precisa ficar em ordem*. Para os eventos de pedido do BoxOffice, a chave é o `orderId`: `OrderPlaced`, `OrderConfirmed` e `OrderCancelled` do mesmo pedido são sempre lidos em sequência, enquanto pedidos diferentes se espalham pelas partições e são processados em paralelo. Registros **sem chave** são espalhados pelas partições pelo particionador *sticky* (ele enche um lote para uma partição e depois passa para outra), sem ordem entre eles.

A chave também decide o **balanceamento de carga**. A simulação abaixo distribui um minuto de tráfego ilustrativo de abertura de vendas em 12 partições com a própria função de hash do Kafka, usando duas chaves diferentes. No minuto da abertura, 60% das compras são para o show no estádio.

```python exec="1" html="1"
import random
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})

def murmur2(data: bytes) -> int:
    """Kafka's default partitioner hash (Java murmur2, 32 bits)."""
    m, h = 0x5BD1E995, (0x9747B28C ^ len(data)) & 0xFFFFFFFF
    for i in range(len(data) // 4):
        k = int.from_bytes(data[4 * i:4 * i + 4], "little")
        k = (k * m) & 0xFFFFFFFF
        k ^= k >> 24
        k = (k * m) & 0xFFFFFFFF
        h = ((h * m) & 0xFFFFFFFF) ^ k
    tail, rem = data[len(data) & ~3:], len(data) % 4
    if rem == 3:
        h ^= tail[2] << 16
    if rem >= 2:
        h ^= tail[1] << 8
    if rem >= 1:
        h = ((h ^ tail[0]) * m) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * m) & 0xFFFFFFFF
    return h ^ (h >> 15)

def partition(key: str, n: int) -> int:
    return (murmur2(key.encode()) & 0x7FFFFFFF) % n

P, N = 12, 60_000
rng = random.Random(7)
# Illustrative on-sale minute: 60% of the purchases are for the stadium show ev-1,
# the rest spread over 200 smaller events
shows = ["ev-1"] * 60 + [f"ev-{rng.randint(2, 201)}" for _ in range(40)]
by_order, by_show = [0] * P, [0] * P
for i in range(N):
    by_order[partition(f"o-{i}", P)] += 1
    by_show[partition(rng.choice(shows), P)] += 1

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 3.6), sharey=True)
for ax, counts, title, color in [(ax1, by_order, "key = orderId", "#1976d2"),
                                 (ax2, by_show, "key = eventId (the show)", "#e53935")]:
    share = [100 * c / N for c in counts]
    ax.bar(range(P), share, color=color)
    ax.axhline(100 / P, color="#888", ls="--", lw=1)
    ax.set_title(f"{title}: busiest partition {max(share):.0f}%")
    ax.set_xlabel("partition")
    ax.set_xticks(range(P))
    ax.grid(True, axis="y", alpha=0.3)
ax1.set_ylabel("% of the messages")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Com chave `orderId` (à esquerda), cada partição recebe cerca de 1/12 do tráfego. Com chave pelo show (à direita), toda compra do show no estádio cai em **uma partição quente**: um broker e um consumidor fazem a maior parte do trabalho enquanto os outros ficam ociosos, e adicionar consumidores não ajuda. A lição: **escolha a chave com a granularidade mais fina que ainda preserve a ordenação de que o negócio precisa.** Eventos de pedido precisam de ordem por pedido, não de ordem por show.

!!! warning "Mudar o número de partições move as chaves"
    `hash(key) mod N` muda quando $N$ muda. Se você aumentar `order-events` de 12 para 24 partições, cerca de metade das chaves vai para outra partição, e por um tempo eventos novos de um pedido podem ser lidos antes de eventos antigos que ainda esperam na partição antiga. Dimensione as partições com folga desde o início; se precisar aumentar, faça isso com pouco tráfego, ou crie um tópico novo e migre os consumidores.

---

## Consumer groups { #consumer-groups }

Um **consumer group** é um conjunto de instâncias consumidoras que dividem o trabalho de ler um tópico. O Kafka atribui cada partição a **exatamente um** consumidor do grupo, então cada registro é processado por um membro — consumidores concorrentes, mas com a ordem preservada por partição. Grupos diferentes são totalmente independentes: cada um tem seus próprios offsets confirmados, então cada grupo recebe **todos** os registros — esse é o fan-out.

``` diagram-sim
flowchart LR
    subgraph topic ["order-events · 6 partições"]
        P0["P0"]
        P1["P1"]
        P2["P2"]
        P3["P3"]
        P4["P4"]
        P5["P5"]
    end
    subgraph gn ["grupo notification · 3 consumidores"]
        N1["notification #1"]
        N2["notification #2"]
        N3["notification #3"]
    end
    subgraph ga ["grupo analytics · 1 consumidor"]
        A1["analytics #1"]
    end
    P0 --> N1
    P1 --> N1
    P2 --> N2
    P3 --> N2
    P4 --> N3
    P5 --> N3
    P0 --> A1
    P1 --> A1
    P2 --> A1
    P3 --> A1
    P4 --> A1
    P5 --> A1
```

Regras que decorrem de "uma partição, um consumidor por grupo":

- **Paralelismo máximo de um grupo = número de partições.** Com 6 partições, uma 7ª instância de `notification` não recebe nada e fica ociosa.
- **A ordem por chave se mantém** enquanto o consumidor processa os registros de uma partição em sequência. Se ele entrega os registros a um pool de threads, quebra a ordem de novo (a não ser que paralelize *por chave*).
- Quando um consumidor entra, sai ou fica tempo demais sem fazer poll (`max.poll.interval.ms`), o grupo faz um **rebalance**: as partições são redistribuídas. Rebalances clássicos pausavam o grupo inteiro; o protocolo novo (KIP-848, disponível de forma geral no Kafka 4.0) e a atribuição cooperativa movem só as partições que precisam mudar.

<div class="csim" data-sim="kafka" data-key="order"></div>

!!! tip "Experimente"
    Os valores iniciais são os do lab 7: `order-events` tem 6 partições e `notification` roda 3 consumidores (`NOTIFY_CONCURRENCY`). Dê play e o lag fica perto de zero. Depois:

    - Suba **Consumidores** para 8: 2 deles não recebem partição e ficam ociosos.
    - Troque a **Chave** para *nenhuma*: OrderPlaced e OrderConfirmed do mesmo pedido caem em partições diferentes, e alguns pedidos são lidos confirmados antes de criados (22 em 200 ticks com 3 consumidores, 107 com 2). De volta a *orderId*: nunca.
    - Troque a **Chave** para *show*: o show do estádio `ev-1` cai em P5, que fica para trás (183 registros depois de 200 ticks) enquanto as outras partições ficam perto de zero — e com 6 consumidores ainda são 142 atrás.
    - **Derrube um consumidor**: o grupo inteiro para durante o rebalance, o lag cresce em *todas* as partições, e então os 2 sobreviventes assumem 3 partições cada e retomam dos offsets confirmados.

### Offsets e consumer lag { #offsets-and-consumer-lag }

Um consumidor **confirma (commit)** o offset do próximo registro que vai ler, por partição; o Kafka guarda os commits em um tópico interno compactado (`__consumer_offsets`). Depois de um restart ou de um rebalance, o novo dono da partição continua a partir do último offset confirmado. *Quando* você confirma — antes ou depois de processar — decide se um crash perde ou duplica registros ([Semântica de entrega](../semantics/index.md)).

O **consumer lag** é a distância entre o fim da partição e o offset confirmado — quantos registros foram escritos e ainda não processados. É *a* métrica de saúde de um consumidor:

```text
$ kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group notification

GROUP         TOPIC         PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG    CONSUMER-ID
notification  order-events  0          182340          182355          15     notification-1-...
notification  order-events  1          181902          181910          8      notification-1-...
notification  order-events  2          120004          184771          64767  notification-2-...
```

A partição 2 está 64.767 registros atrás enquanto as outras estão perto de zero: uma chave quente, um consumidor travado ou uma mensagem venenosa naquela partição — não um problema geral de capacidade. O lag em **registros** é fácil de ler do Kafka; o lag em **segundos** (agora menos o timestamp do último registro processado) é o que vai em um SLO de atualidade.

!!! info "Experimente no playground"

    O cenário `event-fanout` publica eventos de pedido no Kafka com vários serviços consumidores. Rode com o perfil **load** e observe o lag de cada consumidor. Depois deixe um consumidor mais lento (aumente o tempo de processamento dele) e confirme que só o lag *dele* cresce — o produtor e os outros consumidores não são afetados. Por fim, adicione instâncias ao serviço lento e observe que ele para de melhorar quando o número de instâncias iguala o de partições.

<div class="sdp" data-scenario="event-fanout" data-mode="compact" data-profile="load" data-height="540"></div>

---

## Replicação e durabilidade { #replication-and-durability }

Cada partição é **replicada** em vários brokers — o **fator de replicação** (RF), tipicamente 3, com as réplicas em zonas de disponibilidade diferentes. Uma réplica é a **líder**: ela recebe todas as escritas (e, por padrão, atende as leituras). As **seguidoras** buscam continuamente da líder. As seguidoras em dia formam o **conjunto de réplicas sincronizadas** (ISR, *in-sync replicas*). Se o broker da líder falha, o controller elege uma nova líder dentro do ISR.

``` diagram-sim
sequenceDiagram
    participant P as produtor (order)
    participant L as líder P1 (broker 2, AZ-b)
    participant F1 as seguidora (broker 1, AZ-a)
    participant F2 as seguidora (broker 3, AZ-c)
    P->>L: produce OrderConfirmed (acks=all)
    L->>L: acrescenta no offset 4211
    F1->>L: fetch a partir de 4211
    L-->>F1: registro 4211
    F2->>L: fetch a partir de 4211
    L-->>F2: registro 4211
    Note over L: todas as réplicas sincronizadas têm o registro: high watermark = 4212
    L-->>P: ack (offset 4211)
    Note over L,F2: consumidores só veem registros abaixo do high watermark
```

A configuração `acks` do produtor escolhe quanto disso o produtor espera:

| `acks` | O produtor recebe a confirmação quando… | Uma falha de broker pode… | Latência |
|---|---|---|---|
| `0` | o registro é enviado (sem confirmação) | perder registros em silêncio | a menor |
| `1` | a líder o escreveu | perder registros confirmados se a líder morrer antes de as seguidoras copiarem | baixa |
| `all` | toda réplica sincronizada o tem | não perder registros confirmados, se `min.insync.replicas` ≥ 2 | a maior (uma ida e volta extra dentro do cluster) |

`acks=all` sozinho não basta: se o ISR encolhe até só a líder, "todas as réplicas sincronizadas" é uma réplica. **`min.insync.replicas=2`** faz o broker recusar escritas quando há menos de 2 réplicas sincronizadas. Com RF = 3 e min ISR = 2, o tópico continua aceitando escritas com um broker fora do ar e nunca confirma uma escrita que existe em uma só máquina. Mantenha `unclean.leader.election.enable=false` (o padrão) para que uma réplica desatualizada nunca seja eleita líder. Desde o Kafka 3.0, os produtores usam por padrão `acks=all` com idempotência habilitada.

!!! info "KRaft: o consenso do próprio Kafka"
    Os metadados do cluster — quais tópicos existem, qual broker lidera cada partição, o ISR — são mantidos por um pequeno quórum de **controllers** usando o KRaft, um protocolo baseado em Raft (veja [Consenso](../../distributed/consensus/index.md)). Clusters antigos usavam ZooKeeper; o Kafka 4.0 (2025) removeu o ZooKeeper por completo. Os labs do curso rodam o Kafka em modo KRaft: no [lab 7](../../../hands-on/7/kafka/index.md), um único nó é broker e controller ao mesmo tempo.

---

## Retenção, compactação e armazenamento em camadas { #retention-compaction-and-tiered-storage }

Um log não pode crescer para sempre. Cada tópico tem uma **política de limpeza**:

| Política | Configuração | Mantém | Uso no BoxOffice |
|---|---|---|---|
| **Apagar por tempo** | `retention.ms` (padrão 7 dias) | tudo mais novo que o limite | `order-events`: 7 dias para replay e para o carregador do warehouse |
| **Apagar por tamanho** | `retention.bytes` (por partição; padrão ilimitado) | os N bytes mais novos de cada partição | Click-stream de alto volume com orçamento de disco |
| **Compactar** | `cleanup.policy=compact` | pelo menos o **registro mais recente de cada chave** | `event-catalog`: o estado atual de cada evento (nome, local, data) |
| **Ambos** | `cleanup.policy=compact,delete` | o mais recente por chave, mas não mais antigo que a retenção | Último snapshot do mapa de lugares por show, por 30 dias |

Um tópico **compactado** se comporta como uma tabela que também é um stream: um consumidor novo o lê desde o início e termina com o valor mais recente de cada chave. Apagar uma chave é feito escrevendo um **tombstone** (a chave com valor `null`). O próprio `__consumer_offsets` do Kafka é um tópico compactado.

O **armazenamento em camadas** (*tiered storage*, pronto para produção desde o Kafka 3.9) mantém só os segmentos recentes nos discos dos brokers e move os segmentos antigos para object storage (S3, GCS, Azure Blob). Retenção longa — meses de eventos para replay — fica barata, e os brokers ficam mais leves de substituir.

---

## Por que o Kafka é rápido { #why-kafka-is-fast }

Um broker Kafka movimenta com frequência centenas de megabytes por segundo em hardware comum. Vale conhecer os motivos, porque eles reaparecem em muitos sistemas[^3]:

- **I/O sequencial.** As escritas vão para o fim de um arquivo de segmento; as leituras de consumidores em dia vêm da mesma região recente. Acesso sequencial a disco é ordens de grandeza mais rápido que acesso aleatório (veja [Números](../../estimation/numbers/index.md)).
- **O page cache do sistema operacional.** O Kafka não mantém um cache próprio; ele deixa o sistema operacional guardar em memória os segmentos recentes, então consumidores em dia leem da RAM.
- **Zero-copy.** Para servir um consumidor, o broker pede ao kernel que envie os bytes do arquivo direto para o socket (`sendfile`), sem copiá-los pela aplicação.
- **Lotes e compressão.** Os produtores agrupam registros em lotes por partição (`linger.ms`, `batch.size`) e comprimem lotes inteiros (`zstd`, `lz4`). Menos requisições, e maiores; menos bytes em disco e na rede.
- **Particionamento.** A carga se espalha por muitos brokers e muitos consumidores.

O custo é latência: os lotes adicionam alguns milissegundos (`linger.ms`), e `acks=all` adiciona uma ida e volta de replicação. A latência típica de ponta a ponta fica entre alguns e dezenas de milissegundos — ótimo para eventos, mas não substitui uma chamada RPC em memória.

---

## Dimensionando partições { #sizing-partitions }

Partições são baratas, mas não de graça (mais arquivos, mais eleições de líder, rebalances mais longos, mais memória nos clientes). Uma regra inicial comum[^4]: com um throughput-alvo $T$, um throughput de produtor medido por partição $p$ e um throughput de consumidor por partição $c$,

$$
N_{\text{partitions}} \ge \max\left(\frac{T}{p},\ \frac{T}{c}\right)
$$

e depois arredonde para cima com folga para crescimento, porque aumentar partições depois move as chaves.

!!! example "BoxOffice: partições para order-events"

    Pico ilustrativo: 30.000 pedidos nos primeiros 3 minutos de uma grande abertura de vendas, cada um produzindo cerca de 10 eventos (criado, reservado, pagamento autorizado, confirmado, ingresso emitido…): $T \approx 30\,000 \times 10 / 180 \approx 1{,}700$ eventos/s. Os registros são pequenos (~1 KB), então o lado do produtor é trivial: uma única partição aguenta muito mais que 1,7 MB/s.

    Quem decide é o lado do consumidor. O `notification` chama o provedor de e-mail para cada `OrderConfirmed`, ~50 ms por chamada, processando um registro de cada vez por partição: $c = 1 / 0.05 = 20$ registros/s por partição. Para a sua parte do tráfego (os 30.000 `OrderConfirmed` em 180 s ≈ 167/s):

    $$
    N \ge \frac{167}{20} \approx 9 \text{ partitions}
    $$

    Com folga para shows maiores e crescimento, o BoxOffice cria `order-events` com **24 partições**. Se um dia isso não bastar, o `notification` pode enviar e-mails em lote ou processar registros em paralelo *por chave* dentro de cada partição, em vez de adicionar partições.

O tópico é criado explicitamente (nunca dependa de criação automática em produção):

```bash
kafka-topics.sh --bootstrap-server kafka:9092 --create --topic order-events \
  --partitions 24 --replication-factor 3 \
  --config min.insync.replicas=2 \
  --config retention.ms=604800000 \
  --config compression.type=zstd
```

E os serviços Spring Boot configuram seus clientes de acordo:

=== "order (produtor)"

    ```yaml
    spring:
      kafka:
        bootstrap-servers: kafka:9092
        producer:
          key-serializer: org.apache.kafka.common.serialization.StringSerializer
          value-serializer: org.springframework.kafka.support.serializer.JacksonJsonSerializer
          acks: all                    # wait for every in-sync replica
          properties:
            enable.idempotence: true   # producer retries do not duplicate records
            linger.ms: 5               # wait up to 5 ms to fill a batch
            compression.type: zstd
    ```

=== "notification (consumidor)"

    ```yaml
    spring:
      kafka:
        bootstrap-servers: kafka:9092
        consumer:
          group-id: notification
          auto-offset-reset: earliest  # a brand-new group starts from the oldest record
          enable-auto-commit: false    # the container commits after processing
          max-poll-records: 100
          key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
          value-deserializer: org.springframework.kafka.support.serializer.JacksonJsonDeserializer
          properties:
            spring.json.trusted.packages: "boxoffice.events"
        listener:
          ack-mode: record             # commit the offset after each record
          concurrency: 3               # 3 consumer threads in this instance
    ```

!!! example "No código do BoxOffice: o Kafka no Compose (lab 7)"

    O [Hands-on 7 — Kafka no Compose](../../../hands-on/7/kafka/index.md) roda **um** nó que é broker e controller KRaft ao mesmo tempo, com a criação automática desligada e os dois tópicos criados por um contêiner de execução única: `order-events` e `order-events-dlt` com **6 partições** e **fator de replicação 1**. Um laptop não comporta três brokers em três zonas, então este é o ponto em que o lab *não* é produção: `acks: all` no `order` espera "todas as réplicas em sincronia", e com RF = 1 isso é uma réplica — exatamente a armadilha descrita em [Replicação e durabilidade](#replication-and-durability). As 6 partições limitam o lado do consumidor: o `notification` roda 3 threads (`NOTIFY_CONCURRENCY`), e mais de 6 ficariam ociosas. O [experimento de pico e escoamento](../../../hands-on/7/measure/index.md) do lab aplica a aritmética desta página: uma thread a 50 ms por e-mail trata 20/s, então 100 pedidos/s por 60 s deixam cerca de 4.800 mensagens de lag, que levam cerca de 240 s para escoar; seis threads mantêm o lag perto de zero.

    ``` { .yaml title="docker-compose.yaml (one KRaft node, topics created explicitly)" }
    --8<-- "docs/2027.1/hands-on/7/code/docker-compose.yaml:216:234,242:254"
    ```

---

## O Kafka e suas alternativas { #kafka-and-its-alternatives }

| | Apache Kafka | Amazon Kinesis Data Streams | Google Cloud Pub/Sub | Apache Pulsar |
|---|---|---|---|---|
| **Modelo** | log particionado e replicado | log particionado (shards) | pub/sub com ack por mensagem | pub/sub + log (segmentos no BookKeeper) |
| **Ordenação** | por partição | por shard | por chave de ordenação (opcional) | por partição / chave |
| **Replay** | sim, qualquer offset dentro da retenção | sim, dentro da retenção (até 365 dias) | seek para um instante ou snapshot | sim |
| **Operação** | autogerenciado ou gerenciado (MSK, Confluent Cloud, Aiven) | totalmente gerenciado | totalmente gerenciado, global | autogerenciado ou gerenciado |
| **Bom para** | espinha dorsal de eventos, CDC, stream processing, throughput muito alto | streaming nativo da AWS | fan-out nativo do GCP, push para serverless | mensageria e streaming multi-tenant |

O Redpanda e o Azure Event Hubs expõem o **protocolo do Kafka**, então clientes Kafka funcionam com eles sem mudanças. O próprio Kafka também está ganhando semântica de fila: os **share groups** ("Queues for Kafka", KIP-932, introduzidos no Kafka 4.0) deixam vários consumidores dividirem uma partição com confirmação por registro, como uma fila clássica.

!!! tip "Na entrevista"
    Quando você coloca Kafka no quadro, o entrevistador espera quatro decisões, ditas em voz alta: **(1) o tópico e a chave** ("`order-events`, com chave `orderId`, porque precisamos de ordem por pedido e de distribuição uniforme"); **(2) as partições**, a partir de uma estimativa de throughput, com o consumidor como gargalo mais comum; **(3) a durabilidade** (RF 3 entre zonas, `acks=all`, `min.insync.replicas=2`); **(4) a retenção** (7 dias para permitir replay, ou compactação para estado). Cite o consumer lag como a métrica sobre a qual você alerta. Esteja pronto para "o que acontece se um broker morrer?" (eleição de líder no ISR, produtores fazem retry, nenhum dado confirmado se perde) e "como você escala os consumidores?" (até o número de partições).

!!! success "Boas práticas"

    - **Crie todo tópico explicitamente, com partições, replicação e retenção revisadas como código** — a criação automática cria tópicos com padrões do broker que ninguém escolheu. No BoxOffice: `KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"` e um contêiner `kafka-init` ([quadro do Compose](#sizing-partitions)).
    - **Ponha as três réplicas de cada partição em três zonas de disponibilidade** (`broker.rack`) — perder uma zona deixa 2 réplicas em sincronia, então `min.insync.replicas=2` continua aceitando escritas.
    - **Defina a retenção pelo replay de que você precisa e então dimensione o disco** — no mínimo a maior indisponibilidade de consumidor da qual você planeja se recuperar, mais uma margem (7 dias para `order-events`); disco ≈ volume diário × dias de retenção × fator de replicação.
    - **Acompanhe o lag por partição, não só por grupo** — uma chave quente (60% das compras são para `ev-1`) se esconde num total saudável do grupo. No BoxOffice: o `kafka-lag.sh` do lab 7 imprime o total do grupo; `kafka-consumer-groups.sh --describe` mostra cada partição ([lab 7 — meça](../../../hands-on/7/measure/index.md)).
    - **Agrupe e comprima no produtor** — `linger.ms` de poucos milissegundos e `compression.type=zstd` cortam requisições e bytes; 5 ms são invisíveis perto de um SLO de 300 ms. No BoxOffice: o `order` define `linger.ms: 5`, `acks: all` e `enable.idempotence: true`.
    - **Use rebalanceamento incremental (cooperativo) nos grupos de consumidores** — com rebalanceamento *eager*, um deploy gradual de 6 consumidores para o grupo inteiro a cada reinício.

!!! warning "Armadilhas comuns"

    - **Uma chave de baixa cardinalidade** (país, show, `true`/`false`) cria partições quentes que nenhuma quantidade de consumidores resolve.
    - **Poucas partições**: o grupo não escala além delas, e adicionar partições depois remapeia as chaves.
    - **`acks=1` ou `min.insync.replicas=1`** para eventos de negócio: "confirmado" não significa "seguro".
    - **Processar uma partição com um pool de threads** sem separar o trabalho por chave: a ordem se perde em silêncio.
    - **Processamento lento dentro do loop de poll** além de `max.poll.interval.ms`: o consumidor é expulso, o grupo faz rebalance, outro consumidor recebe os mesmos registros — uma tempestade de rebalances com duplicatas.
    - **Usar o Kafka como banco de dados** para consultas por campos arbitrários. O Kafka é lido sequencialmente por offset; construa modelos de consulta em um banco a partir dele ([CQRS](../patterns/index.md#cqrs)).

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    LOG["log só de append<br/>offsets"] --> PART["partições<br/>unidade de paralelismo"]
    KEY["chave = orderId<br/>murmur2 mod N"] --> PART
    PART --> ORD["ordem por chave<br/>→ Semântica de entrega"]
    PART --> CG["consumer groups<br/>um consumidor por partição"]
    CG --> LAG["consumer lag<br/>→ Observabilidade"]
    PART --> REP["RF 3, acks=all,<br/>min.insync.replicas=2"]
    REP --> KRAFT["controllers KRaft<br/>→ Consenso (aula 3)"]
    LOG --> RET["retenção, compactação,<br/>armazenamento em camadas"]
    LOG --> REPLAY["replay: CDC, event sourcing<br/>→ Padrões"]
    PART --> SIZE["N ≥ max(T/p, T/c)<br/>→ Estimativas"]
    KEY --> HOT["chave quente, hash mod N move chaves<br/>→ Particionamento"]
```

**Componentes da paleta:** [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`stream`](../../../reference/components/messaging/index.md#stream) (o equivalente gerenciado: Kinesis, Event Hubs) · [`objstore`](../../../reference/components/storage/index.md#objstore) (armazenamento em camadas) · [`dwh`](../../../reference/components/storage/index.md#dwh) (o loader do warehouse faz replay do log) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`analytics`](../../../reference/components/compute/index.md#analytics) · [`search`](../../../reference/components/compute/index.md#search) (consumer groups lendo cada um no seu ritmo). **Cenários:** `event-fanout`. **Continua em:** [Semântica de entrega](../semantics/index.md), [Padrões](../patterns/index.md), [Distribuídos — consenso](../../distributed/consensus/index.md) (KRaft é Raft), [Bancos de dados — particionamento](../../databases/partitioning/index.md) (chaves quentes, resharding), [Observabilidade — sinais](../../observability/signals/index.md) (lag como métrica), [Hands-on 7 — Kafka](../../../hands-on/7/kafka/index.md).

---

[^1]: KREPS, J.; NARKHEDE, N.; RAO, J. Kafka: a Distributed Messaging System for Log Processing. In: *NetDB Workshop*, 2011.
[^2]: KREPS, J. [The Log: What every software engineer should know about real-time data's unifying abstraction](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying){target="_blank"}. LinkedIn Engineering, 2013.
[^3]: [Apache Kafka Documentation — Design](https://kafka.apache.org/documentation/#design){target="_blank"}. Apache Software Foundation.
[^4]: SHAPIRA, G.; PALINO, T.; SIVARAM, R.; PETTY, K. *Kafka: The Definitive Guide*, 2. ed. O'Reilly, 2021. Capítulos sobre produtores, consumidores e entrega confiável.
