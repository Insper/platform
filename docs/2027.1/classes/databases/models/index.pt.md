"Devemos usar SQL ou NoSQL?" é a pergunta sobre armazenamento mais comum em revisões de design e entrevistas — e também a mais mal formulada. "NoSQL" não é uma coisa só: um armazenamento chave-valor, um banco de documentos, um armazenamento wide-column e um banco de grafos são tão diferentes entre si quanto cada um deles é do PostgreSQL. E, por baixo do modelo de dados, há uma segunda escolha que importa tanto quanto para o desempenho — o **motor de armazenamento** (*storage engine*) que dispõe os bytes no disco.

Esta página pega uma parte do BoxOffice — eventos, locais, assentos e pedidos —, guarda-a em cada modelo e depois abre a casa de máquinas: B-trees, LSM-trees e índices.

---

## O modelo relacional { #relational }

O modelo relacional guarda os dados como **tabelas** (relações) de **linhas** com um conjunto fixo de **colunas** tipadas. Os relacionamentos são expressos por **chaves estrangeiras**, e as consultas combinam tabelas com **joins**. O esquema é declarado de antemão e validado em toda escrita (**schema-on-write**)[^1].

```sql title="BoxOffice core schema (PostgreSQL)"
CREATE TABLE venues (
    id        BIGSERIAL PRIMARY KEY,
    name      TEXT NOT NULL,
    city      TEXT NOT NULL,
    capacity  INT  NOT NULL CHECK (capacity > 0)
);

CREATE TABLE events (
    id        BIGSERIAL PRIMARY KEY,
    venue_id  BIGINT NOT NULL REFERENCES venues(id),
    title     TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    on_sale_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE seats (
    event_id  BIGINT NOT NULL REFERENCES events(id),
    seat_id   TEXT   NOT NULL,              -- 'A-12'
    section   TEXT   NOT NULL,
    price_cents INT  NOT NULL,
    status    TEXT   NOT NULL DEFAULT 'AVAILABLE'
              CHECK (status IN ('AVAILABLE', 'HELD', 'SOLD')),
    held_by   BIGINT,
    hold_expires_at TIMESTAMPTZ,
    version   INT    NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, seat_id)
);

CREATE TABLE orders (
    id          BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    event_id    BIGINT NOT NULL REFERENCES events(id),
    total_cents INT    NOT NULL,
    status      TEXT   NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
    order_id  BIGINT NOT NULL REFERENCES orders(id),
    event_id  BIGINT NOT NULL,
    seat_id   TEXT   NOT NULL,
    PRIMARY KEY (event_id, seat_id),        -- one ticket per seat, enforced by the database
    FOREIGN KEY (event_id, seat_id) REFERENCES seats(event_id, seat_id)
);
```

Três propriedades fazem do modelo relacional o padrão para um sistema de registro:

- **Normalização** — cada fato é guardado uma única vez (a cidade do local fica em `venues`, não copiada em cada evento), então uma atualização não pode deixar duas cópias discordando.
- **Constraints** — `PRIMARY KEY (event_id, seat_id)` em `tickets` torna *impossível* vender um assento duas vezes, por mais bugado que seja o código da aplicação.
- **Consultas declarativas** — você diz *o que* quer; o planejador de consultas decide *como*, usando os índices que existirem. Perguntas novas não exigem tabelas novas.

```sql title="An ad hoc question, answered with joins"
-- Revenue per city for shows in December, best first
SELECT v.city, SUM(o.total_cents) / 100.0 AS revenue
FROM orders o
JOIN events e ON e.id = o.event_id
JOIN venues v ON v.id = e.venue_id
WHERE o.status = 'PAID'
  AND e.starts_at >= '2026-12-01' AND e.starts_at < '2027-01-01'
GROUP BY v.city
ORDER BY revenue DESC;
```

Os custos: linhas que andam juntas (um evento, suas atrações e seus preços) ficam espalhadas por várias tabelas e são remontadas por joins; o esquema precisa ser migrado (com Flyway no [Hands-on 1](../../../hands-on/1/index.md)) antes de novos campos aparecerem; e escalar escritas além de um nó exige particionamento, o que quebra joins e transações entre partições (veja [Particionamento](../partitioning/index.md)).

---

## Bancos de documentos

Um **banco de documentos** guarda documentos autocontidos e aninhados — normalmente JSON ou uma forma binária dele — endereçados por uma chave. Tudo o que é preciso para renderizar a página de um evento pode morar num único documento:

```json title="events/42 as a document"
{
  "_id": 42,
  "title": "Stadium Tour 2027",
  "venue": { "id": 7, "name": "Allianz Parque", "city": "São Paulo" },
  "startsAt": "2027-03-14T21:00:00-03:00",
  "lineup": ["Main act", "Opening act"],
  "priceTiers": [
    { "section": "Pista", "priceCents": 49000 },
    { "section": "Cadeira Superior", "priceCents": 29000 }
  ],
  "tags": ["pop", "stadium"]
}
```

- **Localidade**: uma leitura devolve a página inteira; sem joins. Ótimo para "carregar o agregado por id".
- **Esquema flexível** (**schema-on-read**): um festival pode ter um array `stages` que um jogo de futebol não tem.
- **Ponto fraco — relacionamentos muitos-para-muitos**: o local é *copiado* em cada evento. Renomear o local significa atualizar milhares de documentos, ou aceitar cópias desatualizadas. Consultas que atravessam documentos ("todos os eventos no local 7") exigem índices secundários ou outra coleção.

Produtos: MongoDB, Couchbase, Google Firestore, Azure Cosmos DB, Amazon DocumentDB — e o próprio PostgreSQL com colunas `JSONB` e índices GIN, o que muitas vezes basta.

---

## Armazenamentos chave-valor

O modelo mais simples: um **valor** opaco buscado por uma **chave** — `GET`, `PUT`, `DELETE`, às vezes com TTL. Sem consultas por valor, sem joins; por isso o armazenamento pode ser extremamente rápido e fácil de particionar por chave.

| Armazenamento | Uso típico no BoxOffice |
|---|---|
| Redis / Valkey (em memória) | sessões, contadores de rate limit, páginas de evento em cache, posição na sala de espera (veja [Cache](../../caching/index.md)) |
| Amazon DynamoDB, Azure Cosmos DB (APIs chave-valor / documento) | buscas enormes e previsíveis em qualquer escala, por exemplo "ingressos do cliente X" |
| etcd, ZooKeeper, Consul | configuração pequena e fortemente consistente, eleição de líder |

O DynamoDB merece uma nota porque é uma resposta comum em entrevistas. Ele é um armazenamento chave-valor e de documentos gerenciado e particionado: cada item tem uma **partition key** (passada por hash para escolher a partição) e uma **sort key** opcional (itens com a mesma partition key ficam ordenados, então consultas por faixa dentro de uma partição são baratas). Você projeta a tabela em torno das consultas — o oposto da normalização.

| Padrão de acesso | Partition key | Sort key |
|---|---|---|
| Ingressos de um cliente, mais recentes primeiro | `CUSTOMER#7` | `ORDER#2027-03-01T10:02#9001` |
| Assentos de um setor do evento | `EVENT#42#SEC#B` | `SEAT#A-12` |

O projeto começa pela lista de consultas; uma consulta nova que não se encaixa nas chaves precisa de um **índice secundário global** — ou de uma tabela nova.

---

## Armazenamentos wide-column

Armazenamentos **wide-column** (Apache Cassandra, ScyllaDB, Google Bigtable, Apache HBase) organizam as linhas em **partições** por uma partition key e ordenam as linhas *dentro* de uma partição por **clustering columns**. Foram feitos para vazão de escrita altíssima em muitos nós, com consistência ajustável (veja [Replicação](../replication/index.md#leaderless)).

```sql title="Cassandra (CQL): one table per query"
-- Query: "the last 50 scans at gate 3 of event 42" (anti-fraud at the stadium)
CREATE TABLE gate_scans_by_event (
    event_id   bigint,
    gate       int,
    scanned_at timestamp,
    ticket_id  uuid,
    result     text,
    PRIMARY KEY ((event_id, gate), scanned_at, ticket_id)
) WITH CLUSTERING ORDER BY (scanned_at DESC, ticket_id ASC);

SELECT * FROM gate_scans_by_event
WHERE event_id = 42 AND gate = 3
LIMIT 50;
```

A sintaxe parece SQL, mas as regras são outras: só se pode filtrar pela partition key (e depois pelas clustering columns, em ordem); não há joins; cada consulta ganha sua própria tabela desnormalizada. Em troca, as escritas são inserções no fim de uma LSM-tree (veja [abaixo](#lsm-trees)) espalhadas por todos os nós — ideal para séries temporais, logs de eventos, IoT e mensageria em grande escala.

---

## Bancos de grafos

Quando as perguntas são sobre **relacionamentos** — caminhos, vizinhos, comunidades —, um **banco de grafos** guarda nós e arestas como cidadãos de primeira classe. Neo4j (linguagem de consulta Cypher), Amazon Neptune e a linguagem de consulta padrão ISO GQL (2024) são exemplos.

```cypher title="Fans who bought this show also bought…"
MATCH (e:Event {id: 42})<-[:BOUGHT]-(f:Fan)-[:BOUGHT]->(other:Event)
WHERE other.startsAt > datetime()
RETURN other.title, count(f) AS fans
ORDER BY fans DESC
LIMIT 5;
```

Em SQL, a mesma consulta é um self-join de `orders` com ela mesma; funciona para um salto, mas fica penoso para "amigos de amigos de amigos" ou para quadrilhas de fraude (cartões, dispositivos e contas ligados por muitos saltos). A maioria dos sistemas nunca precisa de um banco de grafos; times de recomendação e de fraude às vezes precisam.

---

## Comparando os modelos

| Modelo | Unidade de dado | Melhor em | Fraco em | Exemplos |
|---|---|---|---|---|
| Relacional | linhas em tabelas, joins | invariantes, transações, consultas ad hoc | escalar escritas horizontalmente (sem NewSQL) | PostgreSQL, MySQL, SQL Server, Oracle |
| Chave-valor | valor opaco por chave | as buscas mais rápidas, particionamento fácil | qualquer consulta que não seja por chave | Redis, Valkey, DynamoDB, etcd |
| Documento | JSON aninhado por chave | agregados lidos juntos, esquemas que evoluem | muitos-para-muitos, invariantes entre documentos | MongoDB, Firestore, Cosmos DB, Postgres JSONB |
| Wide-column | linhas ordenadas dentro de partições | vazão de escrita massiva, dados ordenados no tempo | joins, consultas ad hoc, consistência forte por padrão | Cassandra, ScyllaDB, Bigtable, HBase |
| Grafo | nós e arestas | consultas de relacionamento com vários saltos | varreduras e agregações em massa | Neo4j, Neptune |
| Séries temporais | (série, timestamp, valor) | métricas, downsampling, retenção | consultas de uso geral | Prometheus, InfluxDB, TimescaleDB |

---

## SQL ou NoSQL? Um guia de decisão { #decision-guide }

O guia abaixo codifica as perguntas da [visão geral](../index.md#five-questions). Leia-o como "o padrão é relacional; cada seta que sai dele precisa de um motivo".

``` mermaid
flowchart TD
    A["Novo dado a guardar"] --> B{"Invariantes entre linhas?<br/>dinheiro, estoque, unicidade"}
    B -->|sim| SQL["Banco relacional<br/>PostgreSQL / MySQL"]
    B -->|não| C{"Consultas conhecidas de antemão<br/>e majoritariamente por chave?"}
    C -->|"não, ad hoc"| SQL
    C -->|sim| D{"Escalar além de um nó<br/>em escrita ou armazenamento?"}
    D -->|não| SQL
    D -->|sim| E{"Forma dos dados?"}
    E -->|"blob: imagens, PDFs"| OBJ["Object storage"]
    E -->|"chave → valor, TTL"| KV["Chave-valor<br/>Redis, DynamoDB"]
    E -->|"agregado como JSON"| DOC["Documento<br/>MongoDB, Firestore"]
    E -->|"ordenado no tempo, muitas escritas"| WC["Wide-column<br/>Cassandra, Bigtable"]
    E -->|"relacionamentos com vários saltos"| GR["Grafo<br/>Neo4j"]
    SQL --> F{"Supera um único primário?"}
    F -->|"sim, precisa de SQL + escala"| NEW["SQL distribuído<br/>Spanner, CockroachDB"]
```

E, para os dados *derivados*, a questão é a consulta, não a escala: texto livre → [motor de busca](../specialized/index.md#search-engines), agregações sobre o histórico → [data warehouse](../specialized/index.md#data-warehouses), similaridade por significado → [banco vetorial](../specialized/index.md#vector-databases).

Alguns mitos para aposentar antes de uma entrevista:

| Mito | Realidade |
|---|---|
| "NoSQL não tem esquema." | Tem um esquema *implícito* no código da aplicação — e todo leitor precisa lidar com todas as versões antigas dele. |
| "SQL não escala." | Réplicas de leitura, particionamento e SQL distribuído escalam bancos relacionais para cargas muito grandes; a maioria das empresas nunca supera um único primário. |
| "NoSQL não tem transações." | DynamoDB, MongoDB e Cosmos DB oferecem transações com vários itens, com limites de tamanho e de escopo. |
| "NoSQL é mais rápido." | Uma busca por chave é rápida em qualquer motor. NoSQL é mais rápido nos padrões para os quais foi projetado e mais lento (ou incapaz) no resto. |
| "Escolha um para a empresa inteira." | Persistência poliglota: escolha por serviço e por padrão de acesso. |

??? question "Pense antes: onde você guardaria o estoque de assentos do BoxOffice se ele tivesse de atender um festival de 200 mil lugares com 50 portões de entrada?"

    Ainda num banco relacional — o invariante (um assento, um ingresso) é o fator decisivo, e 200 mil linhas é pouco. Já as **leituras de ingresso nos portões** são só de inserção, ordenadas no tempo, escritas por 50 portões ao mesmo tempo e consultadas por `(evento, portão)` → um armazenamento wide-column (ou uma tabela SQL particionada) serve para elas. Mesmo evento, dois armazenamentos diferentes, decididos pelo padrão de acesso.

---

## Motores de armazenamento: como os bytes chegam ao disco

Um banco de dados, no fundo, são duas operações: *guarde esta chave e este valor* e *me dê o valor desta chave* (ou desta faixa de chaves). A forma como ele dispõe os dados no disco determina o custo de cada uma. Duas famílias dominam: **B-trees** (atualizam páginas no lugar) e **LSM-trees** (acrescentam no fim e depois mesclam)[^2].

### B-trees

Uma **B-tree** mantém as chaves ordenadas em **páginas** de tamanho fixo (8 KiB no PostgreSQL, 16 KiB no MySQL InnoDB). Cada página interna guarda centenas de chaves e ponteiros para páginas filhas; as folhas guardam as linhas ou ponteiros para elas. Uma busca desce da raiz até uma folha[^3].

``` mermaid-sim
flowchart TD
    R["página raiz<br/>… | 30 | 60 | …"] -->|"chave 42"| I["página interna<br/>31 … 40 | 41 … 50 | …"]
    I -->|"chave 42"| L["página folha<br/>41, 42, 43 … → linhas"]
    L -->|"atualiza no lugar:<br/>reescreve a página de 8 KiB"| D[("disco")]
    W["write-ahead log (WAL)<br/>registra a mudança antes"] --> D
```

Os números explicam por que as B-trees estão em toda parte. Com páginas de 8 KiB e ~16 bytes por chave + ponteiro, uma página tem um **fan-out** de ~500:

| Níveis | Chaves alcançáveis (500^níveis) |
|---|---|
| 2 | 250 mil |
| 3 | 125 milhões |
| 4 | 62,5 bilhões |

Uma tabela de um bilhão de linhas tem **4 níveis de profundidade**, e os níveis superiores ficam em cache na memória, então uma busca pontual custa uma ou duas leituras de disco. As escritas, porém, modificam uma página **no lugar**: mudar uma linha de 100 bytes suja uma página inteira de 8 KiB, que depois é gravada de volta, e a mudança também é acrescentada ao **write-ahead log** (WAL) para recuperação após falhas. Usada por PostgreSQL, MySQL InnoDB, SQL Server, Oracle, SQLite.

### LSM-trees { #lsm-trees }

Uma **log-structured merge-tree** (LSM-tree) nunca atualiza no lugar[^4]. As escritas vão para o WAL e para uma tabela ordenada em memória (a **memtable**); quando ela enche, é descarregada no disco como um arquivo ordenado e imutável (uma **SSTable**). A **compactação** (*compaction*) em segundo plano mescla SSTables em níveis maiores e ordenados e descarta valores sobrescritos e apagados.

``` mermaid-sim
flowchart LR
    W["escrita chave=42"] --> WAL["WAL<br/>acrescenta no fim"]
    W --> M["memtable<br/>em memória, ordenada"]
    M -->|"cheia → flush"| L0["SSTables L0"]
    L0 -->|"compactação"| L1["L1 (10× maior)"]
    L1 -->|"compactação"| L2["L2 (10× maior)"]
    R["leitura chave=42"] --> M
    R -->|"o bloom filter diz<br/>'talvez aqui'"| L1
```

As escritas são acréscimos sequenciais — muito rápidos, mesmo em discos lentos. As leituras podem ter de consultar a memtable e vários níveis; **Bloom filters** (um conjunto probabilístico compacto por SSTable que responde "com certeza não está aqui" ou "talvez esteja aqui") pulam a maioria deles. Usada por RocksDB (dentro de muitos sistemas), Cassandra, ScyllaDB, HBase, Bigtable, LevelDB e o Pebble do CockroachDB.

### Amplificação de escrita

A **amplificação de escrita** (*write amplification*) é o número de bytes que o motor grava no disco para cada byte que a aplicação escreve. Ela determina o desgaste do SSD, o custo de I/O e a vazão máxima de escrita. O modelo abaixo é uma intuição de guardanapo, não um benchmark: uma B-tree que reescreve uma página inteira de 8 KiB a cada pequena atualização aleatória (mais o WAL), e uma LSM-tree com compactação por níveis e razão de tamanho 10, em que cada registro é reescrito cerca de 5 vezes por nível durante a compactação (mais o WAL e o flush).

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

# Back-of-the-envelope model (assumptions, not a benchmark):
# B-tree: every random update dirties one 8 KiB page that is later written back
#         whole, plus the record in the write-ahead log (WAL).
# LSM (leveled): WAL + memtable flush + each record rewritten ~T/2 times per level.
page = 8 * 1024
row = np.logspace(np.log10(32), np.log10(8192), 200)
btree = 1 + np.maximum(page / row, 1)
T = 10

fig, ax = plt.subplots(figsize=(9, 4.2))
fig.patch.set_alpha(0)
ax.plot(row, btree, color="#4C78A8", lw=2.5, label="B-tree (8 KiB pages, random updates)")
for levels, style in [(3, ":"), (4, "--"), (5, "-.")]:
    lsm = 2 + levels * T / 2
    ax.plot(row, np.full_like(row, lsm), color="#E45756", lw=2, ls=style,
            label=f"LSM, leveled, {levels} levels (~{lsm:.0f}x)")
ax.set_xscale("log", base=2)
ax.set_yscale("log")
ax.set_xticks([32, 128, 512, 2048, 8192])
ax.set_xticklabels(["32 B", "128 B", "512 B", "2 KiB", "8 KiB"])
ax.set_xlabel("record size")
ax.set_ylabel("bytes written to disk per byte written by the app")
ax.set_title("Write amplification: a back-of-the-envelope model")
ax.grid(True, which="both", alpha=0.25)
for item in [ax.title, ax.xaxis.label, ax.yaxis.label] + ax.get_xticklabels() + ax.get_yticklabels():
    item.set_color("#888")
for s in ax.spines.values():
    s.set_color("#888")
ax.tick_params(colors="#888", which="both")
leg = ax.legend(frameon=False, fontsize=9)
for t in leg.get_texts():
    t.set_color("#888")
ax.set_facecolor("none")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

Leia o gráfico como intuição:

- Para **registros pequenos atualizados aleatoriamente** (contadores, status, eventos), a B-tree paga uma página inteira por uma mudança minúscula, e as escritas sequenciais e em lote da LSM-tree vencem. É por isso que armazenamentos com muita escrita (Cassandra, RocksDB) são baseados em LSM.
- Para **registros grandes**, o custo da página se dilui e a compactação repetida da LSM-tree domina. Motores B-tree reais também acumulam muitas atualizações na mesma página antes de gravá-la, o que baixa bastante a sua curva em cargas com localidade.
- Mais dados significam mais níveis na LSM, então sua amplificação de escrita cresce devagar com o tamanho do conjunto de dados.

| | B-tree | LSM-tree |
|---|---|---|
| Leitura pontual | 1–2 leituras de página (níveis superiores em cache) | memtable + uma SSTable por nível, a maioria pulada pelos Bloom filters |
| Varredura por faixa | excelente: as folhas são ordenadas e encadeadas | boa, mas mescla vários níveis |
| Pequenas escritas aleatórias | escritas de página no lugar; a amplificação depende do tamanho do registro | acréscimos sequenciais; amplificação ≈ níveis × razão de tamanho |
| Espaço | algum espaço livre dentro das páginas (fragmentação) | versões obsoletas até a compactação; arquivos comprimidos |
| Previsibilidade de latência | estável | a compactação pode causar picos de I/O em segundo plano |
| Motores típicos | PostgreSQL, InnoDB, SQL Server, SQLite | RocksDB, Cassandra, ScyllaDB, HBase, Pebble |

---

## Índices

Um **índice** é uma estrutura de dados adicional — normalmente uma B-tree — que mapeia valores de colunas para as linhas que os contêm, para que o banco encontre as linhas sem varrer a tabela inteira. A chave primária é sempre indexada; todos os outros índices são decisão sua, e cada um **acelera as leituras e desacelera as escritas** (todo `INSERT`/`UPDATE` precisa atualizar todos os índices da tabela).

| Tipo de índice | O que é | Exemplo no BoxOffice |
|---|---|---|
| De uma coluna | B-tree sobre uma coluna | `orders(customer_id)` para "meus pedidos" |
| Composto | B-tree sobre várias colunas, ordenada pela primeira, depois pela segunda… | `seats(event_id, section, status)` |
| De cobertura | índice composto que também guarda as colunas que a consulta devolve (`INCLUDE`), de modo que a tabela não é tocada | `seats(event_id, section) INCLUDE (seat_id, price_cents)` |
| Parcial | indexa só as linhas que satisfazem uma condição | `seats(event_id, hold_expires_at) WHERE status = 'HELD'` — só as reservas, minúsculo |
| Único | rejeita duplicatas | `tickets(event_id, seat_id)` — a garantia contra venda duplicada |
| GIN / texto livre | índice invertido sobre palavras ou chaves JSON | `events USING GIN (to_tsvector('portuguese', title))` |
| Vetorial (HNSW, IVF) | vizinhos mais próximos aproximados | índice `pgvector` para o assistente ([Especializados](../specialized/index.md#vector-databases)) |

Um índice composto segue a **regra do prefixo mais à esquerda** (*leftmost prefix*): um índice em `(event_id, section, status)` ajuda consultas que filtram por `event_id`, por `event_id AND section` ou pelas três — mas não por `section` sozinha, assim como uma lista telefônica ordenada por sobrenome e depois por nome não ajuda a achar todo mundo chamado "Ana".

### Lendo o `EXPLAIN`

O `EXPLAIN` mostra o plano escolhido pelo banco; o `EXPLAIN ANALYZE` também executa a consulta e reporta os tempos reais. A saída abaixo é ilustrativa, para uma tabela `seats` com 3 milhões de linhas (50 eventos de 60 mil assentos):

```sql title="Before: no index on section/status"
EXPLAIN ANALYZE
SELECT seat_id, price_cents FROM seats
WHERE event_id = 42 AND section = 'B' AND status = 'AVAILABLE';

-- Seq Scan on seats  (cost=0.00..71842.00 rows=310 width=12)
--                    (actual time=0.031..212.448 rows=287 loops=1)
--   Filter: ((event_id = 42) AND (section = 'B') AND (status = 'AVAILABLE'))
--   Rows Removed by Filter: 2999713
-- Execution Time: 212.502 ms
```

```sql title="After: a composite index that matches the filter"
CREATE INDEX CONCURRENTLY seats_event_section_status_idx
    ON seats (event_id, section, status) INCLUDE (seat_id, price_cents);

-- Index Only Scan using seats_event_section_status_idx on seats
--                    (cost=0.43..18.10 rows=310 width=12)
--                    (actual time=0.025..0.391 rows=287 loops=1)
--   Index Cond: ((event_id = 42) AND (section = 'B') AND (status = 'AVAILABLE'))
-- Execution Time: 0.430 ms
```

Guia de leitura: **Seq Scan** com um "Rows Removed by Filter" grande indica um índice faltando; **Index Scan** percorre o índice e busca as linhas na tabela; **Index Only Scan** responde só com o índice; `cost` é a estimativa do planejador em unidades arbitrárias, `actual time` é o que aconteceu de fato. `CONCURRENTLY` cria o índice sem bloquear as escritas — essencial numa tabela em produção. Você vai fazer isso no [Hands-on 6](../../../hands-on/6/index.md).

!!! example "BoxOffice: o orçamento de índices da tabela `seats`"

    A carga da abertura das vendas é de escrita intensa sobre `seats` (milhares de reservas por segundo num só evento), então cada índice extra custa vazão exatamente quando mais dói. O time mantém três:

    1. a chave primária `(event_id, seat_id)` — toda reserva é uma atualização pontual por ela;
    2. `(event_id, section, status) INCLUDE (seat_id, price_cents)` — a consulta "assentos disponíveis neste setor";
    3. um índice parcial em `(hold_expires_at) WHERE status = 'HELD'` — o job que libera reservas expiradas varre só os poucos milhares de linhas reservadas.

    Um índice em `held_by` foi proposto para "minhas reservas atuais" e rejeitado: essa consulta é rara e pode ser atendida pelo serviço `order`.

---

!!! tip "Na entrevista"

    - Não diga "NoSQL porque escala". Diga qual **padrão de acesso** o tira do banco relacional e nomeie o modelo que o atende: "as leituras nos portões são inserções ordenadas no tempo, em alta taxa, consultadas por `(evento, portão)` — uma tabela wide-column particionada por esse par".
    - Ao acrescentar um armazenamento NoSQL, **liste as consultas primeiro** e derive delas a partition key e a sort key.
    - Mencione os índices com o seu custo: "um índice composto em `(event_id, section, status)`; mantenho poucos índices em `seats` porque ela é quente em escrita".
    - Se perguntarem sobre motores de armazenamento: B-tree = otimizada para leitura, no lugar; LSM = otimizada para escrita, acréscimo + compactação, Bloom filters para as leituras.

!!! warning "Armadilhas comuns"

    - **Um índice por coluna** "por via das dúvidas": escritas mais lentas, mais memória, e o planejador ainda não consegue combiná-los tão bem quanto um bom índice composto.
    - **Ordem errada das colunas** num índice composto (`(status, event_id)` quando toda consulta filtra por `event_id`): a regra do prefixo mais à esquerda o torna inútil para a maioria das consultas.
    - **Funções sobre colunas indexadas** (`WHERE lower(email) = …`) ignoram um índice comum; crie um índice de expressão.
    - **Documentos que crescem para sempre** (um documento de evento com todos os ingressos embutidos): leituras e escritas ficam mais lentas à medida que o array cresce, e muitos bancos limitam o tamanho do documento (16 MB no MongoDB).
    - **Modelar NoSQL como SQL** (tabelas normalizadas, joins na aplicação): você paga as idas e voltas pela rede e perde os pontos fortes dos dois modelos.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    REL["modelo relacional<br/>tabelas, joins, restrições"] --> GUIDE["SQL ou NoSQL?<br/>padrão de acesso primeiro"]
    DOC["documento"] --> GUIDE
    KV["chave-valor"] --> GUIDE
    WC["wide-column"] --> GUIDE
    GR["grafo"] --> GUIDE
    IDX["índices: ordem do composto,<br/>EXPLAIN"] --> BT["B-tree<br/>otimizada para leitura, in place"]
    BT -.-> REL
    LSM["LSM-tree<br/>otimizada para escrita, compactação"] -.-> WC
    GUIDE --> TX["invariantes<br/>→ Transações"]
    GUIDE --> PART["chaves conhecidas em escala<br/>→ Particionamento"]
    KV --> CACHE["em memória<br/>→ Caching, Redis"]
```

**Componentes da paleta:** [`sql`](../../../reference/components/storage/index.md#sql) (o padrão para dados com invariantes e consultas ad hoc) · [`nosql`](../../../reference/components/storage/index.md#nosql) (chave-valor, documento, wide-column ou grafo — escolhidos pelo padrão de acesso, chaves derivadas das consultas) · [`cache`](../../../reference/components/storage/index.md#cache) (um armazenamento chave-valor em memória) · [`vectordb`](../../../reference/components/storage/index.md#vectordb) (um índice ANN é só mais um tipo de índice). **Cenários:** `monolith`, `sharding`. **Continua em:** [Transações](../transactions/index.md), [Particionamento](../partitioning/index.md), [Caching — Redis](../../caching/redis/index.md), [Estimativa — números](../../estimation/numbers/index.md), [Hands-on 6](../../../hands-on/6/index.md) (índices e `EXPLAIN`).

---

[^1]: CODD, E. F. A Relational Model of Data for Large Shared Data Banks. *Communications of the ACM*, 13(6), 1970.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*. 2ª ed. O'Reilly. Capítulo "Storage and Retrieval".
[^3]: BAYER, R.; McCREIGHT, E. Organization and Maintenance of Large Ordered Indexes. *Acta Informatica*, 1(3), 1972.
[^4]: O'NEIL, P. et al. The Log-Structured Merge-Tree (LSM-Tree). *Acta Informatica*, 33(4), 1996.
