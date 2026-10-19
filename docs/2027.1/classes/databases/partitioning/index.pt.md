Três anos depois do lançamento, a BoxOffice vende em 30 países. As tabelas `orders` e `tickets` crescem centenas de milhões de linhas por ano, o disco do primário é medido em terabytes e a taxa de escrita durante as grandes aberturas de vendas chega perto do que uma máquina consegue absorver. As réplicas não ajudam mais: elas escalam leituras, e toda réplica continua tendo de aplicar **todas** as escritas. O próximo degrau da [escada de escalabilidade](../index.md#scaling-ladder) é dividir os próprios dados entre máquinas.

O **particionamento** — também chamado de **sharding** — divide um conjunto de dados de forma que cada registro pertença a exatamente uma **partição** (shard), e partições diferentes vivam em nós diferentes. Cada nó cuida apenas da sua parte das leituras, das escritas e do armazenamento. Os nomes variam conforme o produto — *shard* no MongoDB e no Elasticsearch, *region* no HBase, *tablet* no Bigtable, *range* no CockroachDB, *vnode* no Cassandra —, mas as perguntas são sempre as mesmas: **por qual chave, como distribuir por igual, como encontrar e como mover quando os nós mudam**[^1].

``` mermaid-sim
flowchart LR
    R["roteador<br/>partição = f(chave)"] -->|"cliente 7"| S1[("shard 1<br/>+ réplicas")]
    R -->|"cliente 1042"| S2[("shard 2<br/>+ réplicas")]
    R -->|"cliente 98311"| S3[("shard 3<br/>+ réplicas")]
```

O particionamento normalmente é **combinado** com replicação: cada partição tem seu próprio líder e seus seguidores, então um nó pode ser líder de algumas partições e seguidor de outras.

---

## Particionamento por intervalo de chaves

Atribua a cada partição um **intervalo contínuo** de chaves, como os volumes de uma enciclopédia: `A–F`, `G–M`, `N–S`, `T–Z`. Dentro de uma partição, as chaves ficam ordenadas.

- **Consultas por intervalo são baratas**: "pedidos de 2027-03-01 a 2027-03-07" lê uma ou duas partições.
- **Os limites se adaptam** aos dados: quando um intervalo fica grande demais, ele é **dividido** em dois (tablets do Bigtable, regions do HBase e ranges do CockroachDB e do TiDB fazem isso automaticamente).
- **Perigo — chaves sequenciais.** Se a chave é um timestamp ou um id autoincremental, *todas as novas escritas vão para o último intervalo*. O clickstream de hoje cai num único nó enquanto os outros ficam ociosos. Corrija prefixando a chave com outra coisa: `(event_id, timestamp)` em vez de `timestamp`.

## Particionamento por hash

Aplique uma função de hash à chave e use o hash para escolher a partição. Um bom hash espalha uniformemente até chaves sequenciais.

- **Carga equilibrada** para escritas e leituras pontuais.
- **Consultas por intervalo se espalham**: chaves vizinhas caem em partições sem relação entre si, então "pedidos desta semana" precisa consultar todas as partições.
- **Chaves compostas** recuperam alguma localidade: o Cassandra faz hash apenas da *partition key* e mantém as linhas ordenadas pelas *clustering columns* dentro dela — `PRIMARY KEY ((event_id), scanned_at)` dá uma distribuição equilibrada entre eventos e intervalos de tempo baratos dentro de um evento.

A implementação ingênua, `partition = hash(key) mod N`, tem uma falha fatal: quando **N muda**, quase todas as chaves mudam de partição.

---

## Hashing consistente { #consistent-hashing }

O **hashing consistente** (*consistent hashing*)[^2] coloca nós e chaves no mesmo espaço circular de hash (um **anel**, por exemplo de 0 a 2^64 − 1). Cada chave pertence ao primeiro nó encontrado andando no sentido horário a partir da posição da chave.

``` mermaid-sim
flowchart LR
    K1["chave seat:A-12<br/>hash = 0x1F…"] -->|"anda no sentido horário"| N1["nó B<br/>em 0x40…"]
    K2["chave seat:C-07<br/>hash = 0x9A…"] -->|"anda no sentido horário"| N2["nó C<br/>em 0xB0…"]
    K3["chave seat:Z-99<br/>hash = 0xF3…"] -->|"dá a volta no anel"| N0["nó A<br/>em 0x10…"]
    NEW["novo nó D em 0x80…"] -.->|"assume só as chaves<br/>entre 0x40 e 0x80"| N2
```

Quando um nó entra, ele assume apenas as chaves entre ele e seu antecessor; quando um nó sai, só as chaves dele vão para o sucessor. Em média, **1/N das chaves se move**, o mínimo possível — contra quase todas com `mod N`.

Com uma única posição por nó, os arcos ficam desiguais e um nó pode ficar com muito mais do que sua parte. Os **nós virtuais** (*vnodes*) resolvem isso: cada nó físico ocupa muitas posições no anel (100–256 é comum), então sua fatia total se equilibra na média, e um nó com o dobro da capacidade pode simplesmente ficar com o dobro de vnodes.

A simulação abaixo faz hash de 20.000 chaves com MD5. À esquerda, a porcentagem de chaves que mudam de nó quando o cluster cresce de N − 1 para N nós; à direita, quão desbalanceados ficam 10 nós (nó mais carregado ÷ média) conforme cresce o número de nós virtuais:

```python exec="1" html="1"
import hashlib
import bisect
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

def h(s):
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

keys = [h(f"seat:{i}") for i in range(20000)]

def ring(n, vnodes):
    pts = sorted((h(f"node{n_}#{v}"), n_) for n_ in range(n) for v in range(vnodes))
    return [p for p, _ in pts], [o for _, o in pts]

def owners(n, vnodes):
    pos, own = ring(n, vnodes)
    return np.array([own[bisect.bisect(pos, k) % len(pos)] for k in keys])

ns = list(range(2, 17))
mod_moved, ch_moved, ideal = [], [], []
prev = owners(1, 100)
for n in ns:
    before = np.array([k % (n - 1) for k in keys])
    after = np.array([k % n for k in keys])
    mod_moved.append(100 * np.mean(before != after))
    cur = owners(n, 100)
    ch_moved.append(100 * np.mean(prev != cur))
    prev = cur
    ideal.append(100 / n)

vn = [1, 4, 16, 64, 256]
imbalance = []
for v in vn:
    counts = np.bincount(owners(10, v), minlength=10)
    imbalance.append(counts.max() / counts.mean())

fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))
fig.patch.set_alpha(0)
a1.plot(ns, mod_moved, "o-", color="#E45756", lw=2, label="hash(key) mod N")
a1.plot(ns, ch_moved, "s-", color="#4C78A8", lw=2, label="consistent hashing (100 vnodes)")
a1.plot(ns, ideal, ":", color="#888", lw=2, label="minimum possible: 1/N")
a1.set_xlabel("nodes after adding one (N)")
a1.set_ylabel("% of keys that change node")
a1.set_title("Adding a node: how much data moves?")
a1.set_ylim(0, 100)
a2.bar([str(v) for v in vn], imbalance, color="#54A24B")
a2.axhline(1, color="#888", ls=":")
a2.set_xlabel("virtual nodes per physical node (10 nodes)")
a2.set_ylabel("busiest node / average load")
a2.set_title("Virtual nodes even out the load")
for ax in (a1, a2):
    ax.set_facecolor("none")
    ax.grid(True, alpha=0.25)
    for item in [ax.title, ax.xaxis.label, ax.yaxis.label] + ax.get_xticklabels() + ax.get_yticklabels():
        item.set_color("#888")
    for s in ax.spines.values():
        s.set_color("#888")
    ax.tick_params(colors="#888")
leg = a1.legend(frameon=False, fontsize=9)
for t in leg.get_texts():
    t.set_color("#888")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

Ir de 9 para 10 nós com `mod N` move cerca de 90% das chaves — num cache distribuído, é o mesmo que despejar o cache inteiro sobre o banco de uma vez. Com hashing consistente, cerca de 10% se move. E com uma única posição por nó, o nó mais carregado leva várias vezes a sua parte justa; algumas centenas de vnodes o aproximam de 1.

O hashing consistente é usado pelo Dynamo e pelo DynamoDB, Cassandra e ScyllaDB, Riak, sharding do Memcached no lado do cliente (o algoritmo *ketama*), upstreams `hash … consistent` do Nginx e muitos balanceadores de carga. Vale reconhecer dois parentes: o **rendezvous hashing** (*highest random weight*: cada chave escolhe o nó com o maior `hash(key, node)`)[^3] e o **jump consistent hash** (sem anel, balanceamento quase perfeito, mas nós só podem ser adicionados ou removidos no final)[^4].

### Número fixo de partições

Uma alternativa mais simples que muitos sistemas usam: crie de antemão **muito mais partições do que nós** e atribua partições inteiras aos nós. Adicionar um nó significa mover para ele algumas *partições inteiras*; o mapeamento chave → partição nunca muda.

- **Redis Cluster**: 16.384 hash slots, `slot = CRC16(key) mod 16384`; os slots são movidos entre os nós (veja [Redis](../../caching/redis/index.md)).
- **Elasticsearch / OpenSearch**: o número de shards primários é fixado na criação do índice.
- **Kafka**: as partições de um tópico (veja [Kafka](../../messaging/kafka/index.md)).

O porém: escolha bem a quantidade. Partições de menos limitam até onde você consegue escalar; partições demais acrescentam overhead por partição.

| Estratégia | Chave → partição | Consultas por intervalo | Adicionar um nó | Usada por |
|---|---|---|---|---|
| Intervalo de chaves | limites ordenados, divididos quando crescem | eficientes | dividir e mover intervalos | Bigtable, HBase, CockroachDB, TiDB, MongoDB (ranged) |
| Hash mod N | `hash(k) mod N` | espalham para todas | **move quase tudo** | nada sério — evite |
| Hashing consistente | primeiro nó no sentido horário do anel | espalham para todas | ~1/N das chaves se move | Dynamo, Cassandra, Riak, clientes Memcached |
| Partições fixas | `hash(k) mod P`, P fixo e grande | espalham para todas | mover partições inteiras | Redis Cluster, Elasticsearch, Kafka, Couchbase |
| Diretório | tabela de consulta chave → shard | depende | atualizar a tabela | sharding sob medida, Vitess (vindexes) |

---

## Escolhendo a chave de partição

A chave de partição é a decisão de maior consequência e a menos reversível de um design com sharding. Uma boa chave tem:

1. **Alta cardinalidade** — muitos valores distintos, para que os dados possam ser cortados em muitos pedaços.
2. **Distribuição equilibrada** tanto dos dados *quanto do tráfego* entre os valores.
3. **Localidade das consultas** — as consultas mais frequentes e todas as transações tocam **uma** partição.

| Dado da BoxOffice | Chave candidata | Localidade | Distribuição | Veredito |
|---|---|---|---|---|
| `orders`, `tickets` | `customer_id` | "meus pedidos" e o checkout tocam um shard | milhões de clientes, equilibrada | **boa**; relatórios por evento se espalham → rode-os no [data warehouse](../specialized/index.md#data-warehouses) |
| `orders` | `created_at` | intervalos de tempo são locais | todas as escritas de hoje num shard | ruim (chave sequencial) |
| `seats` (inventário) | `event_id` | uma transação de reserva fica num shard | **um show no estádio = um shard quente** | boa localidade, desequilíbrio perigoso — veja abaixo |
| `seats` | `(event_id, section)` | uma reserva de assentos de um setor fica local | o show no estádio se espalha por ~40 setores | **melhor** para grandes eventos |
| `gate_scans` | `(event_id, gate)` | as leituras recentes do portão são locais | 50 portões espalham a carga | boa |

??? question "Pense antes: por que não particionar `seats` apenas por `seat_id`?"

    A distribuição seria perfeita, mas a consulta principal — "assentos disponíveis do evento 42, setor B" — se espalharia por todos os shards, e uma reserva em grupo de 4 assentos vizinhos viraria uma transação entre shards. A localidade da consulta dominante e das transações vale mais do que uma distribuição perfeita.

---

## Partições quentes { #hot-partitions }

Mesmo com um hash perfeito, o **tráfego** raramente é uniforme. Uma **partição quente** (*hot partition*, ou chave quente) recebe muito mais carga do que as outras: a celebridade cujos posts todo mundo lê, o produto em promoção na Black Friday, o show no estádio às 10:00. O hash não consegue espalhar uma carga que mira *uma única chave*.

**Experimente.** O cenário `sharding` espalha uma tabela NoSQL por várias partições. Execute-o com tráfego uniforme e anote a carga por partição; depois deixe a distribuição de chaves desequilibrada (uma chave quente) e veja uma única partição saturar e sua latência subir enquanto as outras ficam ociosas — adicionar partições não ajuda.

<div class="sdp" data-scenario="sharding" data-mode="compact" data-height="520"></div>

Mitigações, da menos à mais invasiva:

| Técnica | Como | Custo |
|---|---|---|
| **Cachear as leituras** | a página do evento quente é servida pelo cache ou pela CDN, não pelo shard ([Cache](../../caching/index.md)) | dados desatualizados |
| **Limitar e enfileirar as escritas** | uma sala de espera admite fãs no ritmo que o shard consegue atender ([cenário flash-sale](../transactions/index.md#contention)) | os usuários esperam |
| **Chave mais fina** | `(event_id, section)` em vez de `event_id` | consultas sobre o evento inteiro se espalham por ~40 partições |
| **Salting de chave / write sharding** | acrescente um sufixo `0–9` a uma chave quente (`event:42#7`); as escritas escolhem um sufixo aleatório, as leituras juntam os dez | as leituras fazem 10× o trabalho |
| **Contadores fragmentados** (*sharded counters*) | "assentos restantes" mantido como 10 subcontadores, somados na leitura | leituras aproximadas durante as atualizações |
| **Capacidade dedicada** | mova a partição quente para um nó só dela; bancos gerenciados podem dividi-la automaticamente (adaptive capacity do DynamoDB) | operação, custo |

!!! example "BoxOffice: o plano de particionamento do inventário"

    - Chave de partição `(event_id, section)`. Um show normal tem 5–10 setores; o show no estádio tem ~40, espalhados por muitos nós.
    - Reservas e confirmações são transações de uma única partição (todos os assentos de uma reserva em grupo ficam no mesmo setor, por design da interface).
    - Os "assentos restantes" da página do evento são um **contador fragmentado** por setor, agregado a cada segundo no cache — nunca uma linha quente.
    - A **sala de espera** limita as tentativas concorrentes de reserva ao que a partição mais carregada consegue atender.

---

## Índices secundários em dados particionados

Particionar por `customer_id` deixa "pedidos do cliente 7" rápido. E "pedidos do evento 42"? É preciso um **índice secundário**, e em dados particionados ele vem em dois sabores:

``` mermaid
flowchart TB
    subgraph local ["Índice local (particionado por documento)"]
        Q1["consulta: event_id = 42"] --> P1["shard 1<br/>+ seu próprio índice"]
        Q1 --> P2["shard 2<br/>+ seu próprio índice"]
        Q1 --> P3["shard 3<br/>+ seu próprio índice"]
    end
    subgraph global ["Índice global (particionado por termo)"]
        Q2["consulta: event_id = 42"] --> IX["partição do índice<br/>para event_id 42"]
        IX --> D1["shard 1"]
        IX --> D3["shard 3"]
    end
```

| | Índice local | Índice global |
|---|---|---|
| Escrita | atualiza o índice no mesmo shard — barata, transacional | atualiza uma partição de índice em outro lugar — muitas vezes **assíncrona** |
| Leitura pela coluna indexada | **scatter/gather** em todos os shards; latência de cauda do mais lento | uma partição de índice e depois só os shards que têm resultados |
| Exemplos | MongoDB, índices secundários do Cassandra, Elasticsearch | índices secundários globais do DynamoDB (eventualmente consistentes), índices do Spanner/CockroachDB (transacionais) |

O scatter/gather é mais perigoso do que parece: uma consulta a 20 shards é tão lenta quanto o **mais lento** dos 20. A chance de os 20 responderem dentro do próprio p99 é 0,99²⁰ ≈ 82 %, então o p99 de um shard é só cerca do **p82** da consulta — 18 % das consultas são mais lentas. Para o p99 da *consulta* ficar abaixo de uma meta, cada shard precisa cumpri-la no seu **p99,95** (0,99^(1/20) ≈ 0,9995) (veja [Percentis](../../estimation/percentiles/index.md)).

---

## Rebalanceamento e resharding

Nós são adicionados, removidos e falham; os dados crescem de forma desigual. O **rebalanceamento** move partições para manter a carga equilibrada, de preferência enquanto o banco continua atendendo tráfego e movendo apenas os dados que precisam se mover.

- Prefira esquemas em que o mapeamento chave → partição é estável (partições fixas, hashing consistente, divisão de intervalos), para que o rebalanceamento mova partições, não chaves individuais.
- O rebalanceamento disputa rede e disco com o tráfego real; limite sua velocidade e evite rebalanceamento totalmente automático disparado por um nó que está apenas lento (isso pode virar uma cascata).
- **Trocar a chave de partição** (resharding) é um projeto de migração. A receita comum é online:

``` mermaid-sim
flowchart LR
    A["1. crie os novos shards<br/>com a nova chave"] --> B["2. escrita dupla:<br/>antigo + novo"]
    B --> C["3. backfill do histórico<br/>(cópia + CDC para alcançar)"]
    C --> D["4. verifique:<br/>compare as leituras"]
    D --> E["5. mude as leituras<br/>para os novos shards"]
    E --> F["6. pare as escritas antigas,<br/>apague os shards antigos"]
```

Camadas de sharding automatizam boa parte disso para bancos relacionais existentes: o **Vitess** para MySQL (criado no YouTube) e o **Citus** para PostgreSQL cuidam de roteamento, resharding e consultas distribuídas.

### Roteamento de requisições

Algum componente precisa saber qual nó guarda qual partição:

| Abordagem | Como | Exemplos |
|---|---|---|
| Qualquer nó encaminha | o cliente fala com qualquer nó; ele encaminha ou redireciona | Cassandra, Redis Cluster (redirecionamentos `MOVED`) |
| Camada de roteamento | um proxy sem estado conhece o mapa | `mongos` do MongoDB, `vtgate` do Vitess, coordenador do Citus |
| Cliente que conhece as partições | a biblioteca cliente mantém o mapa em cache | clientes Kafka, SDK do DynamoDB via endpoints, clientes Redis "inteligentes" |

O próprio mapa é um metadado pequeno e crítico — guardado num armazenamento de consenso como etcd ou ZooKeeper, ou propagado por gossip entre os nós (veja [Consenso](../../distributed/consensus/index.md)).

---

## Consultas e transações entre partições

O particionamento funciona lindamente até uma operação precisar de **várias partições ao mesmo tempo**:

- **Joins e agregações** entre shards viram scatter/gather, feitos por um coordenador — mais lentos e limitados pelo shard mais lento.
- **Transações** entre shards precisam de um protocolo de coordenação — commit em duas fases ou commit baseado em consenso — com idas e voltas extras e novos modos de falha (veja [Transações](../transactions/index.md#across-services)).
- **Constraints de unicidade** em colunas que não são a chave (e-mail único quando o sharding é por `customer_id`) precisam de um índice global ou de uma tabela de consulta separada.

Então o objetivo do design é: **escolher as chaves para que o caminho quente seja de uma única partição** e mandar o resto para sistemas feitos para isso (um data warehouse para analytics, um índice de busca para consultas transversais).

---

## NewSQL: bancos SQL distribuídos { #newsql }

E se você quiser particionamento *e* transações SQL entre partições, sem escrever uma camada de sharding? Os bancos **NewSQL**, ou **SQL distribuído**, fazem isso[^5]:

- O **Google Spanner**[^6] divide as tabelas em intervalos, replica cada intervalo com **Paxos** entre zonas ou regiões e executa transações distribuídas com commit em duas fases sobre esses grupos. Sua API **TrueTime** expõe a incerteza do relógio (alguns milissegundos, limitada por GPS e relógios atômicos); um commit espera essa incerteza passar, o que dá **consistência externa** (transações linearizáveis) no mundo todo.
- O **CockroachDB**[^7] (protocolo de rede do PostgreSQL) divide os dados em intervalos de algumas centenas de megabytes, replica cada um com **Raft** e usa relógios lógicos híbridos em vez de hardware especial; o isolamento serializable é o padrão.
- O **YugabyteDB** (compatível com PostgreSQL) e o **TiDB** (compatível com MySQL) seguem designs parecidos; os provedores de nuvem também oferecem SQL distribuído gerenciado e serverless.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant G as Nó gateway
    participant R1 as Líder do intervalo 1 (orders)
    participant R2 as Líder do intervalo 2 (tickets)
    C->>G: BEGIN, INSERT order, INSERT tickets, COMMIT
    G->>R1: intenção de escrita (replicada por Raft)
    G->>R2: intenção de escrita (replicada por Raft)
    R1-->>G: ok (maioria confirmou)
    R2-->>G: ok (maioria confirmou)
    G->>G: registro de commit (atômico)
    G-->>C: COMMIT ok
```

| | SQL em um nó + réplicas | SQL com sharding (Citus, Vitess) | SQL distribuído (Spanner, CockroachDB…) | NoSQL (Cassandra, DynamoDB) |
|---|---|---|---|---|
| Escala de escrita | um primário | por shard | automática, por intervalo | automática, por partição |
| Transações entre partições | n/a (um nó) | limitadas / 2PC | **sim**, serializable | limitadas ou nenhuma |
| Latência de escrita | a menor | baixa | + ida e volta do consenso (mais se for multirregião) | baixa, ajustável |
| SQL e joins | completos | a maior parte, com ressalvas | a maior parte | nenhum / limitado |
| Operação | simples | camada de sharding para operar | gerenciada ou complexa | gerenciada ou complexa |

SQL distribuído não sai de graça: toda escrita é replicada por consenso, então a latência é maior do que num único nó, e uma transação que abrange regiões paga idas e voltas entre regiões. É a resposta certa quando você **precisa** ao mesmo tempo de transações SQL e de mais capacidade de escrita ou resiliência geográfica do que um primário consegue dar — não como padrão.

!!! tip "Na entrevista"

    - Introduza o sharding só depois de estimar: "~1 bilhão de pedidos × 1 KB ≈ 1 TB, ~5 mil escritas/s no pico — além de um primário confortável, então eu particiono `orders` por `customer_id`".
    - Justifique a chave com os **três critérios** (cardinalidade, distribuição, localidade do caminho quente) e diga o que se espalha ("relatórios por evento vão para o data warehouse").
    - Diga "hashing consistente **com nós virtuais**" e por quê: adicionar um nó move ~1/N das chaves, não todas.
    - Levante sempre a **partição quente** antes que o entrevistador o faça — a celebridade, a flash sale — e dê uma mitigação concreta (cache, chave mais fina, salting, fila).
    - Se as transações precisam abranger partições, mencione SQL distribuído (Spanner, CockroachDB) e seu custo: idas e voltas de consenso.

!!! warning "Armadilhas comuns"

    - **`hash mod N`** para qualquer coisa que um dia vá mudar de tamanho.
    - **Chaves de partição sequenciais** (timestamps, autoincremento) com particionamento por intervalo: um shard quente recebe todas as escritas.
    - **Uma chave que ignora o caminho quente**: transações que viram entre shards desde o primeiro dia.
    - **Poucas partições fixas**: depois você não consegue escalar além de um nó por partição.
    - **Scatter/gather no caminho quente**: o p99 da consulta vira o p99 do shard mais lento.
    - **Sharding cedo demais**: você paga a complexidade por anos antes de precisar da capacidade.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    RANGE["por faixa de chave"] --> KEY["escolher a chave de partição<br/>cardinalidade, distribuição, localidade"]
    HASH["por hash"] --> KEY
    CH["hashing consistente<br/>nós virtuais"] --> HASH
    KEY --> HOT["partições quentes<br/>o evento em venda"]
    HOT --> MIT["cache, chave mais fina, salting,<br/>fila → Caching, Mensageria"]
    KEY --> SEC["índices secundários<br/>locais vs globais"]
    KEY --> RESH["rebalanceamento,<br/>roteamento de requisições"]
    KEY --> XP["consultas entre partições<br/>relatórios → warehouse"]
    XP --> NEW["NewSQL: Spanner, CockroachDB<br/>consenso por faixa → Distribuídos"]
    CH -.-> LB["o mesmo anel nos balanceadores<br/>→ Borda"]
```

**Componentes da paleta:** [`nosql`](../../../reference/components/storage/index.md#nosql) (Cassandra, DynamoDB, MongoDB particionam por chave) · [`sql`](../../../reference/components/storage/index.md#sql) (PostgreSQL fragmentado, ou SQL distribuído) · [`cache`](../../../reference/components/storage/index.md#cache) (hash slots do Redis Cluster; serve a página do evento quente no lugar do shard) · [`search`](../../../reference/components/compute/index.md#search) (shards do Elasticsearch) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (partições por chave) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sala de espera na frente de uma partição quente) · [`lb`](../../../reference/components/edge/index.md#lb) (hashing consistente para afinidade) · [`dwh`](../../../reference/components/storage/index.md#dwh) (onde ficam os relatórios scatter-gather). **Cenários:** `sharding`, `flash-sale`. **Continua em:** [Armazenamentos Especializados](../specialized/index.md), [Distribuídos — consenso](../../distributed/consensus/index.md), [Borda — balanceamento de carga](../../edge/load-balancing/index.md), [Caching — Redis Cluster](../../caching/redis/index.md#cluster), [Estudo de caso: cache distribuído](../../case-studies/distributed-cache/index.md).

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*. 2. ed. O'Reilly. Capítulo "Sharding" (chamado "Partitioning" na 1ª edição).
[^2]: KARGER, D. et al. Consistent Hashing and Random Trees: Distributed Caching Protocols for Relieving Hot Spots on the World Wide Web. *ACM STOC*, 1997.
[^3]: THALER, D. G.; RAVISHANKAR, C. V. Using Name-Based Mappings to Increase Hit Rates. *IEEE/ACM Transactions on Networking*, 6(1), 1998.
[^4]: LAMPING, J.; VEACH, E. A Fast, Minimal Memory, Consistent Hash Algorithm. arXiv:1406.2294, 2014.
[^5]: PAVLO, A.; ASLETT, M. What's Really New with NewSQL? *ACM SIGMOD Record*, 45(2), 2016.
[^6]: CORBETT, J. C. et al. Spanner: Google's Globally-Distributed Database. *USENIX OSDI*, 2012.
[^7]: TAFT, R. et al. CockroachDB: The Resilient Geo-Distributed SQL Database. *ACM SIGMOD*, 2020.
