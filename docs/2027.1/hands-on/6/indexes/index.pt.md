Desde o lab 1, a listagem do catálogo — *próximos eventos numa cidade, os mais próximos primeiro* — é o endpoint lento. O lab 5 a escondeu atrás de um cache. Antes de recorrer a mais infraestrutura, pergunte ao banco **como** ele executa a consulta. Muitas vezes, a decisão de escala mais barata de todas é um índice.

## 1. Leia o plano { #1-read-the-plan }

A consulta gerada por `findUpcomingInCity` (página + contagem) equivale a:

``` { .sql .copy }
EXPLAIN (ANALYZE, BUFFERS)
SELECT e.*, v.*
FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id
WHERE v.city = 'Recife' AND e.starts_at >= now()
ORDER BY e.starts_at, e.id
LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id
WHERE v.city = 'Recife' AND e.starts_at >= now();
```

``` { .bash .copy }
docker compose exec db psql -U boxoffice
```

Antes de qualquer índice, o plano fica assim (de uma execução de teste deste lab, resumido; os seus números vão diferir):

``` { .text title="EXPLAIN ANALYZE — before" }
Limit  (actual time=35.620..36.762 rows=20)
  ->  Gather Merge
        ->  Sort  (Sort Key: e.starts_at, e.id; Sort Method: top-N heapsort)
              ->  Hash Join  (Hash Cond: (e.venue_id = v.id))
                    ->  Parallel Seq Scan on events e  (rows=100000 loops=2)
                    ->  Hash  ->  Seq Scan on venues v  (Filter: city = 'Recife'; rows=5)
Execution Time: 36.802 ms          -- and 13.9 ms more for the count(*)
```

Como ler um plano:

| Nó | Significado |
|---|---|
| `Seq Scan` | lê **todas** as linhas da tabela |
| `Index Scan` / `Index Only Scan` | percorre uma B-tree; *Only* significa que nunca toca a tabela |
| `Hash Join`, `Nested Loop`, `Merge Join` | três formas de fazer join; o nested loop é ótimo quando o lado externo é pequeno e o lado interno tem um índice |
| `Sort` | ordena em memória (ou em disco: `external merge`) — evitável quando um índice já entrega a ordem |
| `actual time=a..b rows=n` | tempo até a primeira e até a última linha, e a contagem real de linhas; compare com o `rows` estimado para detectar estatísticas ruins |

O problema está à vista: 200.000 linhas são lidas e ordenadas para devolver 20.

## 2. Acrescente os índices { #2-add-the-indexes }

Adicione uma nova migração ao `catalog` — nunca edite `V1`/`V2`:

``` { .sql title="services/catalog/src/main/resources/db/migration/V3__index_events.sql" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/catalog/src/main/resources/db/migration/V3__index_events.sql"
```

``` { .bash .copy }
docker compose up --build -d catalog-1 catalog-2 catalog-3      # Flyway applies V3 on startup
docker compose logs catalog-1 | grep "V3\|version \"3"
```

Rode os dois `EXPLAIN ANALYZE` de novo:

``` { .text title="EXPLAIN ANALYZE — after" }
Limit  (actual time=0.064..0.442 rows=20)
  ->  Nested Loop
        ->  Index Scan using events_starts_at_idx on events e  (rows=189)
        ->  Index Scan using venues_pkey on venues v  (loops=189)
Execution Time: 0.620 ms

Aggregate  (actual time=4.006..4.006 rows=1)
  ->  Nested Loop
        ->  Seq Scan on venues v  (rows=5)
        ->  Index Only Scan using events_venue_starts_at_idx on events e  (rows=4000 loops=5)
Execution Time: 4.028 ms
```

Com o `events_starts_at_idx`, o PostgreSQL percorre os eventos **já em ordem de data** e para assim que tem 20 de Recife (leu 189 entradas do índice em vez de 200.000 linhas): a consulta da página cai de ~37 ms para bem menos de 1 ms. A contagem ainda visita todos os eventos da cidade, mas pelo índice menor `(venue_id, starts_at)`, sem tocar a tabela (*Index Only Scan*): ~14 ms → ~4 ms.

!!! warning "Índices não são de graça"

    Todo índice é atualizado em **todo** insert e update da tabela, ocupa disco e memória, e pode fazer o planejador escolher mal quando as estatísticas estão desatualizadas. Numa tabela com muitas escritas (os assentos durante a venda!), cada índice extra deixa o caminho crítico mais lento. Crie índices para as consultas que você **mediu**, não para toda coluna. Numa tabela grande em produção, use `CREATE INDEX CONCURRENTLY` (fora de uma transação) para não bloquear as escritas enquanto ele é construído.

## 3. Meça { #3-measure-it }

Desligue o cache para que toda requisição chegue ao PostgreSQL e repita o sweep dos labs 2/3 pelo edge:

``` { .bash .copy }
CACHE_ENABLED=false docker compose up -d catalog-1 catalog-2 catalog-3 && sleep 30
BASE_URL=http://localhost OUT=results/lab6-index bash scripts/sweep.sh 300 600 900 1200 1500
uv run scripts/summarize.py results/lab6-index/rate-*.json
```

Compare com os números sem cache do lab 3. Depois religue o cache e decida, com números, do que a listagem realmente precisava.

??? question "Pense primeiro: a consulta de contagem ainda lê 20.000 entradas do índice por requisição. O que você faria a respeito?"

    Opções, da mais barata: fazer cache da contagem separadamente com um TTL maior (ela muda devagar); devolver uma estimativa ("20.000+"); abandoná-la e devolver só `hasNext` (um `Slice` em vez de uma `Page`); ou manter um contador por cidade atualizado nas escritas. Cada uma troca exatidão por custo — uma decisão de produto tanto quanto técnica.

!!! tip "Na entrevista"

    Quando uma consulta está lenta, a ordem é: **medir** (qual consulta, com que frequência), **explicar** (qual plano), **corrigir o caminho de acesso** (índice, reescrita, desnormalização) e só então **acrescentar infraestrutura** (cache, réplica, shard). Os entrevistadores gostam de ouvir que você não faria cache de uma consulta que não explicou.

Volte à [visão geral do lab](../index.md#measure-it) para registrar os resultados.
