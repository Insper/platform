---
marp: true
lang: pt-BR
title: Bancos de Dados e Sistemas de Dados
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

# Bancos de Dados e Sistemas de Dados

**Escolha — e escale — o armazenamento pelo formato dos dados**

<!--
Roteiro: (1) os dados têm formato: o mapa de dados da BoxOffice, sistema de registro vs dados derivados,
a escada de escala; (2) modelos de dados, SQL vs NoSQL, B-tree vs LSM, índices; (3) transações,
isolamento e o bug da venda dupla; (4) replicação e atraso; (5) particionamento, hashing consistente,
partições quentes, NewSQL; (6) busca, armazenamento de objetos, warehouse, vector DB.
-->

---

## 10:02 no dia da abertura das vendas

<div class="q">

Um único PostgreSQL guarda tudo. O show no estádio abre as vendas. O que quebra primeiro?

</div>

- **CPU em 100%** — dois milhões de fãs lendo a página do evento.
- Um **relatório de "vendas por minuto"** varre milhões de linhas e segura locks por 40 s.
- **Pôsteres em colunas `bytea`** incham o buffer pool e os backups.
- A caixa de busca roda `ILIKE '%taylor%'` — varreduras completas da tabela.
- Dois fãs recebem o **assento A-12**.

<div class="ok">

Não há nada de errado com o PostgreSQL: **dados diferentes têm formatos diferentes**, e pediram a um único armazenamento que fosse bom em todos.

</div>

---

## Os dados têm formato

| Propriedade | Pergunta | Por que importa |
|---|---|---|
| **Padrão de acesso** | por chave? faixa? full-text? agregações? | cada armazenamento é rápido para poucos padrões |
| **Razão leitura/escrita, volume** | QPS no pico? bytes, crescendo a que ritmo? | escalar leituras (réplicas, cache) ou escritas (shards) |
| **Necessidade de consistência** | o que quebra se a leitura tiver segundos de atraso? se escritores competirem? | dinheiro e assentos precisam de garantias fortes |
| **Flexibilidade de consulta** | consultas conhecidas ou ad hoc toda semana? | conhecidas → tabelas NoSQL; ad hoc → SQL + índices |

<div class="ok">

Descreva os dados **antes** de dar nome a um banco.

</div>

---

<!-- _class: tight -->

## O mapa de dados da BoxOffice

| Dado | Padrão de acesso | Consistência | Componente |
|---|---|---|---|
| Assentos e reservas | atualização pontual por `(evento, assento)`; picos na abertura | **forte** | SQL |
| Pedidos, pagamentos | por id, por cliente, joins | **forte** | SQL |
| Catálogo de eventos | muita leitura, por id | segundos de atraso OK | SQL + cache |
| Busca | full-text, erros de digitação, ranking | eventual | mecanismo de busca |
| Pôsteres, PDFs de ingressos | blob inteiro por chave, via CDN | escrito uma vez | armazenamento de objetos |
| Clickstream, vendas | agregações ao longo de anos | minutos OK | data warehouse |
| Conhecimento do assistente | mais próximo em significado | eventual | vector DB |

<p class="small">Sistema de registro = as linhas SQL. Cache, índice, warehouse e vetores são <b>dados derivados</b>: reconstruíveis a partir dele, alimentados por CDC.</p>

---

<!-- _class: tight -->

## A escada de escala do banco de dados

| Degrau | Ganha | Custa |
|---|---|---|
| 1. Corrigir consultas, criar índices | 10–100× nas consultas lentas | quase nada |
| 2. Pool de conexões | acaba com tempestades de conexões | um arquivo de configuração |
| 3. Escalar verticalmente | 2–4×, sem mudar código | dinheiro; existe uma máquina máxima |
| 4. Cache de leituras | remove a maior parte das leituras | dados desatualizados, invalidação |
| 5. Réplicas de leitura | leituras × réplicas | atraso de replicação |
| 6. Um banco por serviço | cargas isoladas | sem joins entre serviços |
| 7. Particionar (sharding) | escritas e armazenamento × shards | consultas entre shards, resharding |
| 8. Armazenamentos especializados | o motor certo para cada consulta | mais sistemas e pipelines |

<div class="warn">

Suba **em ordem** e meça antes de cada degrau. Fazer sharding primeiro é o erro clássico.

</div>

---

## Modelos de dados comparados

| Modelo | Melhor em | Fraco em | Exemplos |
|---|---|---|---|
| Relacional | invariantes, transações, SQL ad hoc | escalar escritas (sem NewSQL) | PostgreSQL, MySQL |
| Chave-valor | buscas mais rápidas, fácil de particionar | tudo que não é por chave | Redis, DynamoDB, etcd |
| Documento | agregados lidos juntos, esquema que evolui | muitos-para-muitos, invariantes entre documentos | MongoDB, Firestore, JSONB |
| Wide-column | taxas de escrita enormes, linhas ordenadas no tempo | joins, consultas ad hoc | Cassandra, Bigtable |
| Grafo | relações de vários saltos | varreduras em massa | Neo4j, Neptune |

<p class="small">Tabelas NoSQL são projetadas a partir da <b>lista de consultas</b> (chave de partição + chave de ordenação), o oposto da normalização.</p>

---

## SQL ou NoSQL? Um guia de decisão

- **Invariantes entre linhas** (dinheiro, estoque, unicidade)? → relacional.
- **Consultas ad hoc**? → relacional.
- Cabe em **um primário + réplicas** por 2–3 anos? → relacional.
- Senão, pelo formato: blobs → **armazenamento de objetos** · chave → valor com TTL → **chave-valor** · agregados JSON → **documento** · escritas enormes ordenadas no tempo → **wide-column** · relações → **grafo**.
- Precisa de transações SQL **e** de mais de um primário? → **SQL distribuído**.

<div class="warn">

Mitos: "NoSQL não tem esquema" (ele está no seu código) · "SQL não escala" (réplicas, shards, NewSQL) · "NoSQL não tem transações" (a maioria tem, com limites).

</div>

---

## Motores de armazenamento: B-tree vs LSM-tree

<div class="cols">
<div>

**B-tree** — páginas ordenadas, atualização no lugar

- páginas de 8 KiB, fan-out ~500 → 1 bi de linhas em **4 níveis**
- leitura pontual: 1–2 leituras de disco
- escrita pequena e aleatória reescreve uma página inteira (+ WAL)
- PostgreSQL, InnoDB, SQL Server

</div>
<div>

**LSM-tree** — anexa, depois mescla

- WAL + memtable → **SSTables** imutáveis
- **compactação** em segundo plano em níveis
- **Bloom filters** pulam arquivos nas leituras
- RocksDB, Cassandra, ScyllaDB, Pebble

</div>
</div>

<div class="ok">

B-tree: otimizada para leitura, previsível. LSM: otimizada para escrita; paga em compactação (**amplificação de escrita**) e em leituras espalhadas.

</div>

---

## Índices e `EXPLAIN`

```sql
CREATE INDEX CONCURRENTLY seats_event_section_status_idx
  ON seats (event_id, section, status) INCLUDE (seat_id, price_cents);
-- before: Seq Scan, Rows Removed by Filter: 2999713, 212 ms
-- after:  Index Only Scan, 0.43 ms
```

- **Prefixo mais à esquerda**: ajuda `event_id`, `event_id + section`, as três — não `section` sozinha.
- Cobertura (`INCLUDE`), parcial (`WHERE status = 'HELD'`), único, GIN, HNSW.
- Todo índice **acelera leituras e desacelera escritas** — mantenha poucos em tabelas quentes de escrita.

---

## ACID, na prática

| | Garantia | Para uma reserva de assento |
|---|---|---|
| **A**tomicidade | tudo ou nada | assento `HELD` *e* linha da reserva, ou nenhum |
| **C**onsistência | constraints valem após o commit | `UNIQUE (event_id, seat_id)` em tickets |
| **I**solamento | interferência limitada *pelo nível* | não é "um de cada vez", a menos que seja serializable |
| **D**urabilidade | o que teve commit sobrevive a uma queda | não à perda de um disco ou região → replicação |

<div class="warn">

Padrões: PostgreSQL **read committed**, MySQL InnoDB **repeatable read**. Ambos permitem anomalias.

</div>

---

## O bug da venda dupla

| t | Alice (T1) | Bob (T2) |
|---|---|---|
| 1 | `SELECT status` → AVAILABLE | |
| 2 | | `SELECT status` → AVAILABLE |
| 3 | `UPDATE … SET HELD` (trava a linha) | |
| 4 | | `UPDATE … SET HELD` → espera |
| 5 | `COMMIT` → "assento reservado" | |
| 6 | | o update roda e sobrescreve → "assento reservado" |

<div class="warn">

**Corrida check-then-act → lost update.** O lock de linha serializou as escritas, não a decisão.

</div>

<!--
Pergunte à turma antes de revelar o passo 6: o UPDATE do Bob vai falhar? Em read committed ele roda de novo
sobre a nova versão da linha e ainda casa, porque o WHERE não tem condição sobre status.
-->

---

<!-- _class: tight -->

## Níveis de isolamento (PostgreSQL)

| Nível | Leitura não repetível | Fantasma | Lost update | Write skew |
|---|---|---|---|---|
| Read committed (padrão) | possível | possível | possível | possível |
| Repeatable read (snapshot) | não | não | erro → retentar | **possível** |
| Serializable (SSI) | não | não | não | não — erro `40001`, retentar |

**Write skew** — no máximo 6 ingressos por cliente. Alice tem 4; duas abas contam 4 cada uma, cada uma reserva 2 assentos *diferentes*, as duas fazem commit → **8 ingressos**. Nenhuma linha foi escrita duas vezes, então a snapshot isolation não vê nada.

- Correção: **serializable** + retentativa, ou **materializar o conflito**: `SELECT … FROM customer_event_limits … FOR UPDATE`.

<p class="small">MVCC: leitores nunca bloqueiam escritores; escritores na mesma linha continuam serializados.</p>

---

<!-- _class: tight -->

## Quatro formas de corrigir a venda dupla

| Correção | Resolução do conflito | Sob disputa | Melhor para |
|---|---|---|---|
| `UPDATE … AND status = 'AVAILABLE'` condicional | `WHERE` reavaliado; o perdedor atualiza 0 linhas | bom, 1 ida e volta | check-and-set de uma linha |
| `SELECT … FOR UPDATE` | o perdedor espera | filas; `NOWAIT` / `SKIP LOCKED` | lógica entre leitura e escrita |
| Coluna `version` otimista | o perdedor retenta | muitas retentativas | conflitos raros |
| Constraint única / upsert | a constraint rejeita o perdedor | bom | "no máximo um"; última linha de defesa |

```sql
UPDATE seats SET status = 'HELD', held_by = :me, hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12' AND status = 'AVAILABLE';   -- 1 row: yours; 0: taken
```

---

## Linhas quentes limitam a vazão

<div class="q">

Toda reserva decrementa `events.seats_left`, segurando o lock por **5 ms**. Quantas reservas por segundo, no máximo?

</div>

* `1 / 0.005 s` = **200 reservas/s** — para dois milhões de fãs, em qualquer hardware.
* Um lock de linha é um servidor de capacidade 1 (Lei de Little).
* Linhas por assento: os fãs só colidem no **mesmo assento**.
* Nunca chame o provedor de pagamento **dentro** de uma transação: reserva → commit → paga → confirma.
* "Melhor disponível": `FOR UPDATE SKIP LOCKED`; trave várias linhas **sempre na mesma ordem**.

---

## Replicação: um líder, muitas cópias

- O líder recebe as escritas e envia seu log (WAL) aos seguidores; leituras em qualquer um.
- Ganha **disponibilidade, escala de leitura, latência, durabilidade** — não escala de escrita.

| Modo | "Commit feito" depois de | Na perda do líder | Latência |
|---|---|---|---|
| Assíncrono | disco do líder | últimas escritas **perdidas** | a menor |
| Um standby síncrono | + uma réplica | sem perda | + 1 ida e volta |
| Quorum (Aurora 4/6) | quorum de escrita | sobrevive a uma zona | + ida e volta ao quorum |

<div class="ok">

Dinheiro e assentos → **standby síncrono**. Catálogo → réplicas assíncronas.

</div>

---

## O atraso de replicação atinge os usuários

| Anomalia | O usuário vê | Correção |
|---|---|---|
| Ler as próprias escritas | paga, *Meus ingressos* vazio | ler do primário após as próprias escritas; esperar o LSN |
| Leituras monotônicas | o ingresso aparece e depois some | réplica fixa por usuário |
| Prefixo consistente | resposta antes da pergunta | escritas em ordem causal |

- O atraso é de ms num dia calmo e de **segundos na abertura das vendas** — justamente quando todos olham.
- Monitore `replay_lag` e alerte sobre ele. Nunca decida (assento livre?) numa réplica.
- Failover: detectar por timeout, promover, **isolar (fencing)** o líder antigo (split brain).

---

## Multi-líder e sem líder

<div class="cols">
<div>

**Multi-líder**: escritas em várias regiões

- conflitos: LWW (perde dados), merge, CRDTs
- OK: descrições de eventos
- **Não** para assentos: um conflito é uma venda dupla

</div>
<div>

**Sem líder** (Dynamo, Cassandra)

| N=3 | W | R | |
|---|---|---|---|
| rápido | 1 | 1 | leituras desatualizadas |
| quorum | 2 | 2 | R+W>N ✓ |
| leitura rápida | 3 | 1 | R+W>N ✓ |

</div>
</div>

<p class="small">Reparo: read repair, hinted handoff, anti-entropia (árvores de Merkle). Quorum não é transação.</p>

---

<!-- _class: tight -->

## Particionamento (sharding)

| Estratégia | Consultas por faixa | Adicionar um nó | Usado por |
|---|---|---|---|
| Faixa de chaves (divide quando cresce) | eficientes | dividir, mover faixas | Bigtable, HBase, CockroachDB |
| `hash(k) mod N` | scatter | **move quase tudo** | evite |
| Hashing consistente + vnodes | scatter | ~1/N das chaves se move | Dynamo, Cassandra, clientes Memcached |
| Partições fixas (P ≫ nós) | scatter | move partições inteiras | Redis Cluster (16.384 slots), Kafka, Elasticsearch |

<div class="q">

De 9 → 10 nós de cache: `mod N` move **~90%** das chaves (um flush do cache sobre o banco); o hashing consistente move **~10%**.

</div>

---

## Escolhendo a chave, e as partições quentes

- Critérios da chave: **cardinalidade · tráfego uniforme · caminho quente em uma partição**.
- `orders` por `customer_id` ✓ — relatórios por evento espalham → warehouse.
- `orders` por `created_at` ✗ — todas as escritas na última faixa.
- `seats` por `event_id` → o show no estádio é **um shard quente**.
- Melhor: `(event_id, section)` + sala de espera + contador fragmentado de "assentos restantes".
- Outras ferramentas: cache das leituras, salting da chave (`event:42#7`), capacidade dedicada.

<div class="warn">

Hashing não espalha carga que mira **uma chave**. p99 do scatter/gather = shard mais lento.

</div>

---

## NewSQL: SQL distribuído

- **Spanner**: faixas replicadas por **Paxos**, 2PC entre grupos, **TrueTime** + commit wait → consistência externa.
- **CockroachDB**: faixas replicadas por **Raft**, relógios lógicos híbridos, serializable por padrão.
- YugabyteDB (compatível com Postgres), TiDB (compatível com MySQL); Citus e Vitess fazem sharding de motores existentes.
- Paga-se em **latência**: toda escrita é uma rodada de consenso, mais ainda entre regiões.

<div class="ok">

Use quando você precisa de **transações SQL e** de mais capacidade de escrita ou resiliência geográfica do que um primário oferece — não como padrão.

</div>

---

## Armazenamentos especializados para dados derivados

| Armazenamento | Responde | Alimentado por | Ideias-chave |
|---|---|---|---|
| Mecanismo de busca | palavras → documentos ranqueados | CDC → indexador | índice invertido, analisador, BM25, fuzzy, refresh de ~1 s |
| Armazenamento de objetos | blob por chave | upload pré-assinado | durabilidade projetada de 11 noves, CDN, camadas por ciclo de vida |
| Data warehouse | agregados sobre o histórico | ELT / CDC em streaming | armazenamento colunar, esquema estrela, lakehouse Iceberg |
| Vector DB | mais próximo em significado | worker de embeddings | cosseno, ANN (HNSW, IVF), recall vs latência |

<div class="warn">

Nada de **escritas duplas** (banco + índice a partir da aplicação): elas se desalinham. Use CDC ou o outbox; reconstrua os derivados por replay.

</div>

---

## Na entrevista

- Dê nome ao armazenamento **por dado**, justificado pelo padrão de acesso: "assentos → SQL, o invariante precisa de transações".
- Estime para mostrar **qual dimensão é difícil**: "60 mil assentos é pouco — o problema é a disputa de escrita".
- Recurso escasso → **corrida check-then-act** → `UPDATE` condicional + constraint única.
- Réplicas → **e** "as próprias escritas são lidas do primário".
- Shards → chave pelos três critérios, **levante você mesmo a partição quente**, hashing consistente com vnodes.

---

<!-- _class: tight -->

## O mapa de conceitos de bancos de dados

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `sql` | onde moram os dados com invariantes? | ACID, isolamento, `UPDATE` condicional, índices |
| `sql` (réplicas) | como escalar leituras, sobreviver a um líder morto? | atraso, ler as próprias escritas, pooling, failover |
| `nosql` | que padrão de acesso sai do SQL — e cresce além de um nó? | chave-valor / documento / wide-column, LSM, chaves de partição, partições quentes |
| `search` | como os fãs acham eventos por texto? | índice invertido, ranqueamento, CDC |
| `objstore` | onde moram pôsteres e PDFs? | chaves no banco, URLs pré-assinadas, CDN |
| `dwh` | onde rodam as consultas dos analistas? | OLAP, colunas, esquema estrela, ELT |
| `vectordb` | como achar textos pelo significado? | embeddings, ANN / HNSW, pgvector primeiro |

<p class="small">Um <b>sistema de registro</b>; todo outro armazenamento é dado derivado, alimentado por streams de mudanças e reconstruível.</p>

---

## Pontos-chave

1. Descreva os dados por **padrão de acesso, volume, consistência, flexibilidade de consulta**; separe o sistema de registro dos dados derivados.
2. Relacional é o padrão para **invariantes**; tabelas NoSQL são projetadas a partir das consultas.
3. B-tree lê bem, LSM escreve bem; todo índice custa escritas.
4. Os níveis de isolamento padrão permitem anomalias: corrija a **corrida check-then-act** no `WHERE` ou com uma constraint.
5. Réplicas escalam leituras e trazem **atraso**; standby síncrono para dinheiro e assentos.
6. Particione por uma chave que mantenha o caminho quente local; hashing consistente move ~1/N; **chaves quentes** precisam de mais que hashing.
7. Busca, armazenamento de objetos, warehouse e vector DB respondem o que o SQL responde mal.
