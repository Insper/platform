!!! abstract "Neste lab"

    - Adicione o **Redis** ao BoxOffice e implemente **cache-aside** no `catalog`: leia primeiro o cache, carregue do PostgreSQL em um miss, guarde com um **TTL**.
    - Invalide nas escritas, sobreviva a uma queda do Redis e exponha o resultado de cada requisição em um header `X-Cache`.
    - **Meça** o hit ratio e o seu efeito no p99 e na capacidade, com uma popularidade realista e *concentrada*.
    - Reproduza um **cache stampede** em uma chave quente e corrija-o com um lock distribuído e jitter no TTL — e meça a correção.

O catálogo é o exemplo clássico de serviço com muita leitura: na semana do show no estádio, alguns milhares de eventos populares recebem quase todo o tráfego, e a listagem de "próximos eventos em São Paulo" é pedida milhares de vezes por minuto, enquanto muda poucas vezes por dia. O lab 2 mostrou que o banco (por meio do seu pool de conexões) é o que limita o `catalog`. Um **cache**[^1] responde da memória às perguntas repetidas, então o banco só vê a primeira.

Caches também são, como todo guia de entrevista avisa[^2], a fonte mais comum de bugs sutis em system design: dados desatualizados, partidas a frio, chaves quentes e stampedes. Neste lab você vai ver cada um deles com as suas próprias medições.

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 2–3 horas |
| **Você precisa de** | as ferramentas do lab 0; Docker com pelo menos **6 GB**; portas 80, 8080 e **6379** livres |
| **Diretório** | todo comando roda na raiz do seu repositório `boxoffice/` (Windows: dentro do WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Estado inicial** — o fim do lab 4:

``` { .tree title="boxoffice/ at the start of lab 5" }
boxoffice/
    docker-compose.yaml        # db, catalog-1..3, auth, gateway, edge
    infra/nginx/nginx.conf     # edge -> gateway
    load/  ... gateway.js login.js
    services/auth/  services/catalog/  services/gateway/
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 4? Baixe [boxoffice-after-lab-4.zip](../4/boxoffice-after-lab-4.zip), descompacte e `cd boxoffice`. Este lab **adiciona** o `EventCache.java` e dois scripts do k6, e **substitui** o `docker-compose.yaml`, o `pom.xml` do catalog, o `application.yaml` e o `EventController.java`; todos aparecem completos nas próximas páginas e estão em [`code/`](code/docker-compose.yaml).

## Slides

<div class="slides-embed">
  <iframe src="slides/caching.html" title="Slides: hands-on 5 — cache" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/caching.html){:target="_blank"}

!!! info "Conexão com a teoria"

    - Aula 7, [Cache](../../classes/caching/index.md): [padrões](../../classes/caching/patterns/index.md) (cache-aside, read-through, write-through), [invalidação e TTL](../../classes/caching/invalidation/index.md), [modos de falha](../../classes/caching/failure-modes/index.md) (stampede, chaves quentes, cache frio), [Redis](../../classes/caching/redis/index.md).
    - Catálogo de componentes: [Cache](../../reference/components/storage/index.md#cache).

## Antes de medir: o playground { #before-you-measure-the-playground }

**Experimente:** o cenário `read-heavy-cache` põe um cache na frente de um banco SQL. Rode-o e anote o hit ratio e a carga no banco. Depois (1) diminua o TTL ou o tamanho do cache e veja o hit ratio cair e o p99 subir; (2) reinicie com o cache **frio** e observe os primeiros segundos; (3) mude para o perfil *spike* e procure o momento em que muitos misses atingem o banco ao mesmo tempo. Anote: *"com um hit ratio de 90%, o banco recebe ___% das leituras"*.

<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="500"></div>

## O que você vai construir { #what-you-will-build }

``` diagram-sim
sequenceDiagram
    autonumber
    actor Fan as Fã
    participant C as catalog
    participant R as redis
    participant DB as db
    Fan->>C: GET /catalog/events/42
    C->>R: GET catalog:event:42
    R-->>C: (nil) — miss
    C->>DB: SELECT do evento 42 JOIN venue
    DB-->>C: linha
    C->>R: SET catalog:event:42 <json> PX 60000..66000
    C-->>Fan: 200 + X-Cache: MISS
    Fan->>C: GET /catalog/events/42 (de novo)
    C->>R: GET catalog:event:42
    R-->>C: <json> — hit
    C-->>Fan: 200 + X-Cache: HIT (sem acesso ao banco)
```

| Chave | Valor | TTL | Invalidada quando |
|---|---|---|---|
| `catalog:event:{id}` | JSON de `GET /catalog/events/{id}` | `CACHE_TTL_EVENT` (60 s) | o evento é atualizado ou apagado |
| `catalog:events:city=…:page=…:size=…` | JSON de uma página da listagem | `CACHE_TTL_LIST` (10 s) | nunca: ela simplesmente expira |
| `…:lock` | um token aleatório | 2 s | liberado pelo dono (proteção contra stampede) |

## Passos { #steps }

<div class="grid cards" markdown>

-   :material-database-arrow-right:{ .lg .middle } **[1. Cache-aside com Redis](cache-aside/index.md)**

    ---

    Redis no Compose, o componente `EventCache`, chaves, TTLs, invalidação, comportamento quando o Redis cai.

-   :material-flash-alert:{ .lg .middle } **[2. Stampede](stampede/index.md)**

    ---

    Uma chave quente expira e 200 requisições dão miss ao mesmo tempo: reproduza, meça, corrija.

</div>

## Meça: hit ratio, p99 e capacidade { #measure-it }

O script de carga imita a popularidade real: **80% das requisições de detalhe vão para os 2.000 eventos mais quentes** (1% do catálogo); as listagens se espalham por 10 cidades e pelas 3 primeiras páginas. Ele lê o header `X-Cache` de toda resposta, então o k6 relata o hit ratio e latências separadas para hits e misses.

``` { .javascript title="load/cache.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/load/cache.js"
```

Rode a mesma carga **sem** e **com** o cache — a chave é uma variável de ambiente, sem precisar reconstruir:

``` { .bash .copy }
# 1. no cache (every request goes to PostgreSQL)
CACHE_ENABLED=false docker compose up -d --wait     # --wait: until the recreated replicas are healthy
k6 run -q -e RATE=300 -e DURATION=30s load/cache.js > /dev/null   # warm-up: new replicas are cold JVMs
k6 run -e RATE=300 load/cache.js

# 2. cache on, cold: warm up the new replicas, then flush Redis right before the test
CACHE_ENABLED=true docker compose up -d --wait
k6 run -q -e RATE=300 -e DURATION=30s load/cache.js > /dev/null
docker compose exec redis redis-cli FLUSHALL
k6 run -e RATE=300 load/cache.js

# 3. cache on, warm: run it again immediately
k6 run -e RATE=300 load/cache.js

# 4. capacity: repeat the lab 2 sweep, now with the cache, through the edge
BASE_URL=http://localhost OUT=results/lab5-cache bash scripts/sweep.sh 300 600 900 1200 1500
```

Olhe também o cache do lado do Redis:

``` { .bash .copy }
docker compose exec redis redis-cli INFO stats | grep -E "keyspace_(hits|misses)"
docker compose exec redis redis-cli INFO memory | grep used_memory_human
docker compose exec redis redis-cli --scan --pattern 'catalog:event:*' | wc -l
docker compose exec redis redis-cli TTL catalog:event:1
```

Registre em `results/lab5.md`:

``` { .markdown title="results/lab5.md" .copy }
# Lab 5 — caching

## Same load (300 req/s, 80% of details on 1% of events)
| Run | cache_hit | p50 (ms) | p99 (ms) | p99 detail | p99 list | latency_hit p99 | latency_miss p99 |
|---|---:|---:|---:|---:|---:|---:|---:|
| no cache |  |  |  |  |  |  |  |
| cold cache |  |  |  |  |  |  |  |
| warm cache |  |  |  |  |  |  |  |

## Capacity (sweep through the edge, 3 replicas)
| Setup | Capacity with p99 < 300 ms (req/s) |
|---|---:|
| lab 3, no cache | |
| lab 5, cache | |

## Redis
- keyspace_hits / keyspace_misses: ____ / ____ → hit ratio ____ %
- keys cached: ____ ; memory used: ____

## Stampede (see step 2)
| CACHE_STAMPEDE_PROTECTION | cache_misses in 1 min | p99 (ms) | max (ms) |
|---|---:|---:|---:|
| false | | | |
| true  | | | |

## Questions
1. With hit ratio h, the database receives (1 − h) of the reads. Which hit ratio did you need to double the capacity?
2. Change HOT_SHARE to 0.2 (popularity almost uniform). What happens to the hit ratio, and why?
3. An admin changes the price of event 42. For how long can a fan see the old price on the listing page? On the event page?
```

??? question "Pense primeiro: por que uma execução com cache quente pode ser muito melhor do que uma com cache frio, se as duas usam o mesmo código?"

    Na execução fria, a primeira requisição de cada chave é um miss — e com 2.000 eventos quentes mais milhares de frios, os primeiros segundos parecem exatamente a execução sem cache. Um cache só é tão bom quanto o seu **hit ratio**, e o hit ratio depende do **espaço de chaves**, da **distribuição de popularidade** e do **TTL**, não da velocidade do Redis. É por isso que deploys que esvaziam caches, ou nós novos com caches vazios, causam picos de latência em produção — e por isso alguns sistemas *aquecem* os caches antes de receber tráfego. (Neste lab a diferença só aparece quando o TTL dura mais que o teste: veja a nota abaixo.)

!!! note "Se os seus números forem diferentes"

    O hit ratio depois de um minuto depende dos TTLs e de quantas chaves distintas o k6 tocou: a 300 req/s, uma execução de um minuto com cache frio chega a cerca de 70% (72% numa execução deste lab). Com o `CACHE_TTL_EVENT` padrão de 60 s, uma segunda execução logo em seguida **não** fica muito mais alta (72% de novo naquela execução): as chaves gravadas nos primeiros segundos da execução fria expiram nos primeiros segundos da seguinte, então cada chave quente dá miss cerca de uma vez por minuto nas duas. Suba a pilha com `CACHE_TTL_EVENT=5m` (mais longo que uma execução) para ver o cache quente vencer: 83% quente contra 71% frio numa execução deste lab. Os hits devem ser mais rápidos que os misses (cerca de duas vezes no p50 naquela execução: com a maior parte das leituras absorvida pelo cache, o PostgreSQL também responde rápido aos misses restantes); se não forem, o Redis ou a rede é o gargalo (`docker stats`). O seu ganho de capacidade depende de quanto da carga original era a listagem.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| sem header `X-Cache` | a imagem do catalog não foi reconstruída | `docker compose up --build -d` |
| `X-Cache: MISS` em toda requisição | Redis inalcançável (veja os logs do catalog: `cache read failed`), ou `CACHE_TTL_*` curto demais | `docker compose ps redis`; `docker compose logs catalog-1 \| grep cache` |
| `X-Cache: BYPASS` | `CACHE_ENABLED=false` ainda está definido no seu shell | `unset CACHE_ENABLED && docker compose up -d` |
| mudar variáveis de ambiente não tem efeito | os contêineres não foram recriados | sempre `VAR=value docker compose up -d` (não `restart`) |
| `Bind for 0.0.0.0:6379 failed` | há um Redis local rodando | pare-o ou mapeie `"16379:6379"` |
| a execução de stampede mostra os mesmos misses com e sem proteção | o TTL não está curto, ou a variável não chegou às réplicas | `docker compose exec catalog-1 env \| grep CACHE_` |
| dados antigos na página de listagem depois de uma atualização do admin | as chaves de listagem não são removidas, por design | espere `CACHE_TTL_LIST` (10 s) — é a defasagem limitada do design |

!!! success "Boas práticas neste lab"

    - **O cache é opcional**: timeouts de cliente de 200 ms e todo erro do Redis tratado como miss (`application.yaml`, `read()` no `EventCache.java`); a entrega verifica que parar o Redis não quebra o `catalog`. Por quê: [modos de falha — o cache cai](../../classes/caching/failure-modes/index.md#cache-down).
    - **Commit, depois delete**: o `EventController.java` remove a chave depois que `updateEvent` retorna. Por quê: [invalidação — apague, não atualize](../../classes/caching/invalidation/index.md#delete-vs-update).
    - **TTL com jitter em toda chave** (`withJitter` no `EventCache.java`), para que um aquecimento não agende uma avalanche. Por quê: [avalanche](../../classes/caching/failure-modes/index.md#avalanche).
    - **Uma reconstrução por chave** sob carga (lock `SET … NX PX 2000`): os misses caíram de 2.238 para 19 numa execução de teste (200 VUs, 60 s). Por quê: [stampede](../../classes/caching/failure-modes/index.md#stampede).
    - **Meça, não suponha**: `X-Cache` mais um contador por resultado, e a mesma carga antes e depois. Por quê: [a conta do hit ratio](../../classes/caching/index.md#hit-ratio-math).

## Limpeza { #clean-up }

``` { .bash .copy }
CACHE_TTL_LIST=10s CACHE_STAMPEDE_PROTECTION=false docker compose up -d   # back to the defaults
docker compose exec redis redis-cli FLUSHALL                               # optional: empty the cache
docker compose down
```

Guarde tudo: o lab 6 adiciona o `inventory`, uma réplica de leitura e o PgBouncer a esta stack.

## Entrega { #deliverable }

- [ ] Redis no `docker-compose.yaml`; `EventCache` e o novo `EventController` no `catalog`.
- [ ] `X-Cache` visível: `curl -sI localhost/catalog/events/1` duas vezes mostra `MISS` e depois `HIT`.
- [ ] Uma atualização pelo gateway (token de admin) remove o evento do cache: a próxima leitura é um `MISS` com os dados novos.
- [ ] Parar o Redis (`docker compose stop redis`) **não** quebra o catálogo: as requisições respondem com `X-Cache: MISS`.
- [ ] `results/lab5.md` completo: três execuções, capacidade, estatísticas do Redis, tabela do stampede e as três respostas.
- [ ] Repositório com a tag `lab5`; [quiz](quiz.md) respondido.

## Estado final { #end-state }

``` { .tree title="changed in lab 5" }
boxoffice/
    docker-compose.yaml        # replaced: + redis (6379), catalog gets REDIS_* and CACHE_* variables
    load/cache.js  load/stampede.js                       # new
    services/catalog/pom.xml                              # replaced: + spring-boot-starter-data-redis
    services/catalog/src/main/resources/application.yaml  # replaced: Redis + cache settings
    services/catalog/src/main/java/boxoffice/catalog/EventCache.java        # new
    services/catalog/src/main/java/boxoffice/catalog/EventController.java   # replaced
    results/lab5.md
```

Próximo: [Lab 6 — Dados em escala](../6/index.md).

[^1]: Documentação do Redis, [Client-side caching and cache-aside](https://redis.io/docs/latest/develop/clients/client-side-caching/){target="_blank"} e [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/){target="_blank"}.
[^2]: Alex Xu, *System Design Interview — An Insider's Guide*, vol. 1, 2020 — capítulo 1, "Cache".
