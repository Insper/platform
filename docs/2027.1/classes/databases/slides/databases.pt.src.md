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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Bancos de Dados e Sistemas de Dados

**Escolha — e escale — o armazenamento pelo formato dos dados**

<!--
Roteiro: (1) os dados têm formato: o mapa de dados da BoxOffice, sistema de registro vs dados derivados,
cinco perguntas, a escada de escala; (2) modelos de dados, SQL vs NoSQL, B-tree vs LSM, índices;
(3) transações, isolamento, o bug da venda dupla, reservas, o checkout entre serviços; (4) replicação,
atraso, pooling, failover; (5) particionamento, hashing consistente, partições quentes, índices
secundários, NewSQL; (6) busca, armazenamento de objetos, warehouse, banco vetorial.
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

Não há nada de errado com o PostgreSQL: **dados diferentes têm formatos diferentes** e pediram a um único armazenamento que fosse bom em todos.

</div>

---

## Os dados têm formato

| Propriedade | Pergunta | Por que importa |
|---|---|---|
| **Padrão de acesso** | por chave? faixa? full-text? agregações? | cada armazenamento é rápido para poucos padrões |
| **Razão leitura/escrita, volume** | consultas por segundo (QPS, *queries per second*) no pico? bytes, crescendo a que ritmo? | escalar leituras (réplicas, cache) ou escritas (shards) |
| **Necessidade de consistência** | o que quebra se a leitura tiver segundos de atraso? se escritores competirem? | dinheiro e assentos precisam de garantias fortes |
| **Flexibilidade de consulta** | consultas conhecidas ou ad hoc toda semana? | conhecidas → tabelas NoSQL; ad hoc → linguagem de consulta estruturada (SQL, *Structured Query Language*) + índices |

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
| Pôsteres, PDFs de ingressos | blob inteiro por chave, via rede de entrega de conteúdo (CDN, *content delivery network*) | escrito uma vez | armazenamento de objetos |
| Clickstream, vendas | agregações ao longo de anos | minutos OK | data warehouse |
| Conhecimento do assistente | mais próximo em significado | eventual | banco vetorial |

<p class="small">Os volumes diferem em ordens de grandeza em cada coluna: um armazenamento ajustado para a primeira linha serve mal para a sexta.</p>

---

## Sistema de registro, dados derivados

<div class="flow" style="align-items: stretch">
<div class="box accent" style="flex: .9; display: flex; flex-direction: column; justify-content: center">SQL: assentos, pedidos, eventos<small>o sistema de registro: toda escrita chega aqui</small></div>
<div class="arrow" style="align-self: center">captura de mudanças (CDC, <em>change data capture</em>) →</div>
<div class="group">
<div class="caption">dados derivados · reconstruíveis</div>
<div class="box green">índice de busca<small>CDC → indexador</small></div>
<div class="box green">data warehouse<small>CDC, cargas em lote</small></div>
<div class="box green">banco vetorial<small>worker de embeddings</small></div>
<div class="box green">cache<small>preenchido num miss</small></div>
</div>
</div>

- As escritas vão **só** para o sistema de registro: faça o backup dele com cuidado.
- Um armazenamento derivado pode ser jogado fora e reconstruído depois de um bug.
- **Persistência poliglota**: cada serviço escolhe o armazenamento que combina com seu padrão de acesso.

---

## Cinco perguntas que escolhem um armazenamento

1. Qual é o **sistema de registro** e quais são suas invariantes?
2. Quais são as **3 principais consultas** — conhecidas de antemão?
3. **Quão grande, quão rápido**, crescendo como? Um nó + réplicas por 2–3 anos?
4. **Quão desatualizada** uma leitura pode estar?
5. O que o **time consegue operar** às 3 da manhã?

<div class="ok">

Inventário de assentos: um assento, uma reserva → **transações**; 60 mil linhas é pouco, o problema são os **picos de escrita** → PostgreSQL com locks de linha e um mapa de assentos um pouco desatualizado vindo do cache.

</div>

---

## A escada de escala do banco de dados

<div class="flow">
<div class="box green">1 · corrigir consultas, índices<small>10–100× nas consultas lentas</small></div><div class="arrow">→</div>
<div class="box green">2 · pool de conexões<small>um arquivo de configuração</small></div><div class="arrow">→</div>
<div class="box green">3 · escalar verticalmente<small>2–4×, dinheiro</small></div><div class="arrow">→</div>
<div class="box green">4 · cache de leituras<small>dados desatualizados</small></div><div class="arrow">→</div>
<div class="box green">5 · réplicas de leitura<small>atraso de replicação</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .7">medido: ainda não basta →</div>
<div class="box orange">6 · um banco por serviço<small>sem joins entre serviços</small></div><div class="arrow">→</div>
<div class="box red">7 · particionar (shard)<small>consultas entre shards, resharding</small></div><div class="arrow">→</div>
<div class="box orange">8 · armazenamentos especializados<small>mais sistemas e pipelines</small></div>
</div>

<p class="small">Verde: barato e reversível. Laranja e vermelho: mudam a arquitetura.</p>

<div class="warn">

Suba **em ordem** e meça antes de cada degrau. Fazer sharding primeiro é o erro clássico.

</div>

---

## Um motor, ou um armazenamento por necessidade?

| | "Use só o Postgres" | Um armazenamento especializado por necessidade |
|---|---|---|
| Operação | ✅ uma coisa para rodar e fazer backup | ⚠️ um sistema a mais por necessidade |
| Consistência | ✅ uma transação atualiza tudo | ⚠️ os derivados ficam para trás (CDC) |
| Desempenho máximo | ⚠️ bom o bastante até a média escala | ✅ o melhor para o seu padrão de acesso |
| Funcionalidades | ⚠️ busca textual e vetorial básicas | ✅ relevância, facetas, bilhões de vetores |

- Microsserviços: **um banco por serviço** — ninguém lê as tabelas de outro serviço.
- BoxOffice: PostgreSQL por serviço; acrescente um armazenamento quando surgir uma necessidade **medida**.

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
- Senão, pelo formato: blobs → **armazenamento de objetos** · chave → valor com tempo de vida (TTL, *time to live*) → **chave-valor** · agregados JSON → **documento** · escritas enormes ordenadas no tempo → **wide-column** · relações → **grafo**.
- Precisa de transações SQL **e** de mais de um primário? → **SQL distribuído**.

<div class="warn">

Mitos: "NoSQL não tem esquema" (ele está no seu código) · "SQL não escala" (réplicas, shards, NewSQL) · "NoSQL não tem transações" (a maioria tem, com limites).

</div>

---

## Motores de armazenamento: B-tree vs árvore LSM (*log-structured merge*)

<div class="cols">
<div>

**B-tree** — páginas ordenadas, atualização no lugar

- páginas de 8 KiB, fan-out ~500 → 1 bi de linhas em **4 níveis**
- leitura pontual: 1–2 leituras de disco
- escrita pequena e aleatória reescreve uma página inteira (+ o log de escrita antecipada, WAL, *write-ahead log*)
- PostgreSQL, InnoDB, SQL Server

</div>
<div>

**LSM-tree** — anexa, depois mescla

- WAL + memtable → tabelas ordenadas imutáveis (**SSTables**, *sorted string tables*)
- **compactação** em segundo plano em níveis
- **Bloom filters** pulam arquivos nas leituras
- RocksDB, Cassandra, ScyllaDB, Pebble

</div>
</div>

<div class="ok">

B-tree: otimizada para leitura, previsível. LSM: otimizada para escrita; paga em compactação (**amplificação de escrita**) e em leituras espalhadas.

</div>

---

<!-- _class: tight -->

## Índices e `EXPLAIN`

<div class="flow">
<div class="box red">Seq Scan<small>3.000.000 de linhas lidas, 2.999.713 descartadas · 212 ms</small></div>
<div class="box">Index Scan<small>percorre a B-tree, depois busca cada linha</small></div>
<div class="box green">Index Only Scan<small>responde só com o índice · 0,43 ms</small></div>
</div>

```sql
CREATE INDEX CONCURRENTLY seats_event_section_status_idx
  ON seats (event_id, section, status) INCLUDE (seat_id, price_cents);
```

- **Prefixo mais à esquerda**: ajuda `event_id`, `event_id + section`, as três — não `section` sozinha.
- Cobertura (`INCLUDE`), parcial (`WHERE status = 'HELD'`), único, índice invertido generalizado (GIN, *generalized inverted index*), vetorial (HNSW, *hierarchical navigable small world*).
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
| Isolamento serializável por snapshot (SSI, *serializable snapshot isolation*) | não | não | não | não — erro `40001`, retentar |

**Write skew** — no máximo 6 ingressos por cliente. Alice tem 4; duas abas contam 4 cada uma, cada uma reserva 2 assentos *diferentes*, as duas fazem commit → **8 ingressos**. Nenhuma linha foi escrita duas vezes, então a snapshot isolation não vê nada.

- Correção: **serializable** + retentativa, ou **materializar o conflito**: `SELECT … FROM customer_event_limits … FOR UPDATE`.

<p class="small">Controle de concorrência multiversão (MVCC, <em>multi-version concurrency control</em>): leitores nunca bloqueiam escritores; escritores na mesma linha continuam serializados.</p>

---

<!-- _class: tight -->

## Quatro formas de corrigir a venda dupla

| Correção | Resolução do conflito | Sob disputa | Melhor para |
|---|---|---|---|
| `UPDATE … AND status = 'AVAILABLE'` condicional | `WHERE` reavaliado; o perdedor atualiza 0 linhas | ✅ bom, 1 ida e volta | check-and-set de uma linha |
| `SELECT … FOR UPDATE` | o perdedor espera | ⚠️ filas; `NOWAIT` / `SKIP LOCKED` | lógica entre leitura e escrita |
| Coluna `version` otimista | o perdedor retenta | ❌ muitas retentativas | conflitos raros |
| Constraint única / upsert | a constraint rejeita o perdedor | ✅ bom | "no máximo um"; última linha de defesa |

```sql
UPDATE seats SET status = 'HELD', held_by = :me, hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12' AND status = 'AVAILABLE';   -- 1 row: yours; 0: taken
```

---

## Experimente: dois fãs, um assento

<div class="flow">
<div class="box red">ingênua<small>os dois ouvem 201 · held_by = Bob</small></div>
<div class="box green">UPDATE condicional<small>Bob espera, depois UPDATE 0 → 409</small></div>
<div class="box green">FOR UPDATE<small>Bob espera na leitura, lê HELD</small></div>
<div class="box green">otimista<small>version 8, não 7 → 0 linhas</small></div>
<div class="box orange">repeatable read<small>40001 → repetir</small></div>
</div>

- A página de Transações traz a corrida: escolha uma estratégia, depois quem envia o próximo comando.
- **Alice primeiro** é seguro com qualquer estratégia: o bug precisa que as transações se sobreponham — o que um teste unitário nunca faz.

<!--
O simulador fica depois de "Comparando as correções". Rode a ordem intercalada primeiro com a ingênua, depois
troque de estratégia sem mudar a ordem.
-->

---

## Reservas: um aluguel que expira

<div class="flow">
<div class="box">AVAILABLE</div><div class="arrow">reserva: UPDATE condicional →</div>
<div class="box orange">HELD<small>por 10 minutos</small></div><div class="arrow">pagamento confirmado →</div>
<div class="box green">SOLD</div>
</div>
<div class="flow">
<div class="box orange">HELD</div><div class="arrow">expirou ou foi cancelada →</div><div class="box">AVAILABLE</div>
<div class="box muted">SOLD → AVAILABLE<small>estorno: raro, auditado</small></div>
</div>

- **Expiração preguiçosa**: a consulta de reserva trata uma reserva expirada como livre; um job de limpeza só mantém o mapa correto.
- **Confirme de forma condicional**: `… AND status = 'HELD' AND held_by = :me AND hold_expires_at > now()`; 0 linhas → estorno ou outro assento.

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

## Transações entre serviços: o checkout

<div class="flow">
<div class="box accent">inventory<small>UPDATE condicional → HELD · commit, ~2 ms de lock</small></div><div class="arrow">→</div>
<div class="box accent">order<small>PENDING + evento de outbox · commit</small></div><div class="arrow">→</div>
<div class="box orange">payment<small>chave de idempotência = id do pedido · nenhuma transação aberta</small></div><div class="arrow">→</div>
<div class="box green">inventory<small>confirmação condicional → SOLD + ingresso · commit</small></div>
</div>

- Nenhuma transação ACID abrange três bancos e um provedor de pagamento.
- O **commit em duas fases (2PC, *two-phase commit*)** bloqueia os participantes que se prepararam se o coordenador cair: raro entre serviços, nunca com um provedor.
- **Saga + outbox + chaves de idempotência**: em caso de falha, compensações liberam a reserva e cancelam o pedido.

---

## Replicação: um líder, muitas cópias

- O líder recebe as escritas e envia seu log (WAL) aos seguidores; leituras em qualquer um.
- Ganha **disponibilidade, escala de leitura, latência, durabilidade** — não escala de escrita.

| Modo | "Commit feito" depois de | Na perda do líder | Latência |
|---|---|---|---|
| Assíncrono | disco do líder | ❌ últimas escritas **perdidas** | a menor |
| Um standby síncrono | + uma réplica | ✅ sem perda | + 1 ida e volta |
| Quorum (Aurora 4/6) | quorum de escrita | ✅ sobrevive a uma zona | + ida e volta ao quorum |

<div class="ok">

Dinheiro e assentos → **standby síncrono**. Catálogo → réplicas assíncronas.

</div>

---

## Quando o líder diz "commit feito"?

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Assíncrono</div>
<div class="box">COMMIT da reserva A-12</div><div class="arrow">→</div>
<div class="box accent">WAL no disco do líder</div><div class="arrow">→</div>
<div class="box green">"commit feito"</div><div class="arrow">⋯</div>
<div class="box muted">a réplica recebe o WAL<small>uma queda antes disso perde a reserva</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Síncrono</div>
<div class="box">COMMIT da reserva A-12</div><div class="arrow">→</div>
<div class="box accent">WAL no disco do líder</div><div class="arrow">→</div>
<div class="box orange">um standby confirma<small>+1 ida e volta; espera se ele cair</small></div><div class="arrow">→</div>
<div class="box green">"commit feito"</div>
</div>

- Cerca de 1 ms de ida e volta dentro de uma região, dezenas a centenas de ms entre continentes → réplicas entre regiões são assíncronas.
- `ANY 1 (s1, s2)`: um quorum de standbys tolera um standby lento.

---

## O atraso de replicação atinge os usuários

| Anomalia | O usuário vê | Garantia, e como |
|---|---|---|
| Ler as próprias escritas | paga, *Meus ingressos* vazio | ler do primário após as próprias escritas; esperar o número de sequência do log (LSN, *log sequence number*) |
| Leituras monotônicas | o ingresso aparece e depois some | uma réplica fixa por usuário |
| Prefixo consistente | resposta antes da pergunta | escritas causalmente ligadas pelo mesmo líder ou partição |

- O atraso é de ms num dia calmo e de **segundos na abertura das vendas** — justamente quando todos olham.
- Monitore `replay_lag` e alerte sobre ele. Nunca decida (assento livre?) numa réplica.
- O simulador da página: atraso de 1 s, a leitura do fã numa réplica não vê A-12; **read your writes** a manda ao líder.

---

## Pooling de conexões

<div class="q">

2.000 consultas/s, 5 ms cada. Quantas conexões estão ocupadas?

</div>

* **10** em média (Lei de Little): um pool de 20–30 absorve picos; um pool de 500 só acrescenta disputa.
* 20 pods × um pool de 50 = **1.000 conexões**, cada uma um processo do PostgreSQL.
* O PgBouncer no modo **transaction** empresta uma conexão de servidor por transação: milhares de clientes, poucas dezenas de servidores.
* Lab 6: o PostgreSQL vê no máximo **20** conexões do `inventory`; o Flyway vai direto ao primário.

---

## Failover: quando o líder morre

<div class="flow">
<div class="box">detectar<small>timeout: curto demais faz failover numa pausa de coleta de lixo (GC, <em>garbage collection</em>); longo demais, minutos sem escritas</small></div><div class="arrow">→</div>
<div class="box accent">promover o standby<small>uma nova timeline</small></div><div class="arrow">→</div>
<div class="box accent">mover os clientes<small>sistema de nomes de domínio (DNS, <em>Domain Name System</em>), IP virtual, proxy, driver</small></div><div class="arrow">→</div>
<div class="box red">isolar o líder antigo<small>STONITH ("shoot the other node in the head"), fencing tokens</small></div>
</div>

- **Escritas perdidas**: confirmadas por um líder assíncrono, nunca enviadas (lab 6: uma reserva `201` vira `404`).
- **Split brain**: um líder isolado, não morto, continua escrevendo → o consenso decide (Patroni + etcd).
- A alta disponibilidade gerenciada faz o failover em dezenas de segundos a minutos: decida o que a aplicação faz enquanto isso.

---

## Multi-líder e sem líder

<div class="cols">
<div>

**Multi-líder**: escritas em várias regiões

- conflitos: a última escrita vence (LWW, *last write wins*, perde dados), merge, tipos de dados replicados sem conflito (CRDTs, *conflict-free replicated data types*)
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
| Faixa de chaves (divide quando cresce) | ✅ eficientes | dividir, mover faixas | Bigtable, HBase, CockroachDB |
| `hash(k) mod N` | scatter | ❌ **move quase tudo** | evite |
| Hashing consistente + nós virtuais | scatter | ✅ ~1/N das chaves se move | Dynamo, Cassandra, clientes Memcached |
| Partições fixas (P ≫ nós) | scatter | move partições inteiras | Redis Cluster (16.384 slots), Kafka, Elasticsearch |

<div class="q">

De 9 → 10 nós de cache: `mod N` move **~90%** das chaves (um flush do cache sobre o banco); o hashing consistente move **~10%**.

</div>

---

## Escolhendo a chave e as partições quentes

- Critérios da chave: **cardinalidade · tráfego uniforme · caminho quente em uma partição**.
- `orders` por `customer_id` ✅ — relatórios por evento espalham → warehouse.
- `orders` por `created_at` ❌ — todas as escritas na última faixa.
- `seats` por `event_id` ⚠️ → o show no estádio é **um shard quente**.
- Melhor: `(event_id, section)` + sala de espera + contador fragmentado de "assentos restantes".
- Outras ferramentas: cache das leituras, salting da chave (`event:42#7`), capacidade dedicada.

<div class="warn">

Hashing não espalha carga que mira **uma chave**.

</div>

---

<!-- _class: tight -->

## Índices secundários, scatter/gather, resharding

| | Índice local | Índice global |
|---|---|---|
| Escrita | ✅ mesmo shard, transacional | ⚠️ outra partição, muitas vezes assíncrona |
| Leitura pela coluna indexada | ⚠️ scatter/gather para todo shard | ✅ uma partição do índice, depois só os shards com resultados |

- 20 shards: todos respondem dentro do próprio p99 só 0,99²⁰ ≈ **82%** das vezes → cada shard precisa cumprir a meta no seu **p99,95**.

<div class="flow">
<div class="box">novos shards</div><div class="arrow">→</div>
<div class="box">escrita dupla</div><div class="arrow">→</div>
<div class="box">backfill + CDC</div><div class="arrow">→</div>
<div class="box orange">verificar</div><div class="arrow">→</div>
<div class="box">trocar as leituras</div><div class="arrow">→</div>
<div class="box green">parar as escritas antigas</div>
</div>

<p class="small">Mudar a chave de partição é um projeto de migração; Vitess e Citus automatizam boa parte dele.</p>

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

<!-- _class: tight -->

## Armazenamentos especializados para dados derivados

| Armazenamento | Responde | Alimentado por | Ideias-chave |
|---|---|---|---|
| Mecanismo de busca | palavras → documentos ranqueados | CDC → indexador | índice invertido, analisador, BM25, fuzzy, refresh de ~1 s |
| Armazenamento de objetos | blob por chave | upload pré-assinado | durabilidade projetada de 11 noves, CDN, camadas por ciclo de vida |
| Data warehouse | agregados sobre o histórico | extrair, carregar, transformar (ELT, *extract, load, transform*) / CDC em streaming | armazenamento colunar, esquema estrela, lakehouse Iceberg |
| Banco vetorial | mais próximo em significado | worker de embeddings | cosseno, vizinho mais próximo aproximado (ANN, *approximate nearest neighbour*): HNSW, arquivo invertido (IVF, *inverted file*); recall vs latência |

<div class="warn">

Nada de **escritas duplas** (banco + índice a partir da aplicação): elas se desalinham. Use CDC ou o outbox; reconstrua os derivados por replay.

</div>

---

## Na entrevista

- Dê nome ao armazenamento **por dado**, justificado pelo padrão de acesso: "assentos → SQL, o invariante precisa de transações".
- Estime para mostrar **qual dimensão é difícil**: "60 mil assentos é pouco — o problema é a disputa de escrita".
- Recurso escasso → **corrida check-then-act** → `UPDATE` condicional + constraint única.
- Réplicas → **e** "as próprias escritas são lidas do primário".
- Shards → chave pelos três critérios, **levante você mesmo a partição quente**, hashing consistente com nós virtuais.

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
| `dwh` | onde rodam as consultas dos analistas? | processamento analítico online (OLAP, *online analytical processing*), colunas, esquema estrela, ELT |
| `vectordb` | como achar textos pelo significado? | embeddings, ANN / HNSW, pgvector primeiro |

<p class="small">Um <b>sistema de registro</b>; todo outro armazenamento é dado derivado, alimentado por streams de mudanças e reconstruível.</p>

---

## Pontos-chave

1. Descreva os dados por **padrão de acesso, volume, consistência, flexibilidade de consulta**; separe o sistema de registro dos dados derivados.
2. Relacional é o padrão para **invariantes**; tabelas NoSQL são projetadas a partir das consultas.
3. B-tree lê bem, LSM escreve bem; todo índice custa escritas.
4. Os níveis de isolamento padrão permitem anomalias: corrija a **corrida check-then-act** no `WHERE` ou com uma constraint.
5. Réplicas escalam leituras e trazem **atraso**; standby síncrono para dinheiro e assentos; um failover precisa de fencing.
6. Particione por uma chave que mantenha o caminho quente local; hashing consistente move ~1/N; **chaves quentes** precisam de mais que hashing.
7. Busca, armazenamento de objetos, warehouse e banco vetorial respondem o que o SQL responde mal.
