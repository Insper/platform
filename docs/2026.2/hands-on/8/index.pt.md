!!! tip "Objetivo principal"

    O objetivo principal deste hands-on é adicionar o **Redis** como cache em memória compartilhado à plataforma de microsserviços, reduzindo a carga sobre o banco de dados e melhorando os tempos de resposta — algo especialmente relevante agora que o gateway roda em várias réplicas atrás do Nginx.

Quando o gateway escala horizontalmente, cada instância da JVM tem o seu próprio cache local. Uma requisição roteada para a réplica 1 guarda uma conta em cache; a mesma conta buscada pela réplica 2 dispara outra consulta ao banco. Um **cache externo compartilhado** (Redis) resolve isso: todas as réplicas leem e escrevem no mesmo armazenamento.

## Slides

<div class="slides-embed">
  <iframe src="slides/cache.html" title="Slides: cache em memória" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/cache.html){:target="_blank"}

## Bancos de dados em memória

Um **banco de dados em memória** (IMDB, *in-memory database*) mantém o seu conjunto de dados de trabalho principal na RAM e não em disco. Como a latência de acesso à RAM é medida em nanossegundos, enquanto o acesso a disco é medido em milissegundos, os IMDBs são ordens de grandeza mais rápidos em workloads com muitas leituras.

| | Tradicional (em disco) | Em memória |
|---|---|---|
| **Armazenamento** | Disco (HDD / SSD) | RAM |
| **Latência de leitura** | 1–10 ms | < 1 ms |
| **Latência de escrita** | 5–20 ms | < 1 ms |
| **Durabilidade** | Persistente por padrão | Configurável |
| **Capacidade** | Terabytes | Gigabytes (limitada pela RAM) |
| **Caso de uso** | Fonte da verdade | Cache, sessões, contadores |

O padrão típico em produção é o **cache-aside**: a aplicação consulta primeiro o armazenamento em memória; só em caso de **cache miss** ela consulta o banco de dados e, em seguida, preenche o cache com o resultado.

``` mermaid-sim
flowchart LR
    app[Serviço] -->|"1. GET accounts::42"| redis[(Redis)]
    redis -->|"2a. cache hit → retorna"| app
    redis -->|"2b. cache miss (nil)"| app
    app -->|"3. SELECT * FROM accounts\nWHERE id = 42"| db[(PostgreSQL)]
    db -->|"4. retorna a linha"| app
    app -->|"5. SET accounts::42 ... EX 300"| redis
```

## Redis

O [Redis](https://redis.io){target="_blank"} (Remote Dictionary Server) é o armazenamento de estruturas de dados em memória mais implantado do mundo. Ele é usado ao mesmo tempo como **cache, armazenamento de sessões, message broker e motor de estruturas de dados em tempo real** — e é o padrão de fato para cache distribuído em arquiteturas de microsserviços.

### Estruturas de dados

Diferentemente do Memcached (apenas strings), o Redis oferece estruturas de dados nativas, cada uma com operações O(1) ou O(log n):

| Tipo | Comandos principais | Caso de uso típico |
|---|---|---|
| **String** | `SET` `GET` `INCR` `EXPIRE` | Valores JSON em cache, contadores, tokens de rate limit |
| **Hash** | `HSET` `HGET` `HGETALL` | Objetos de sessão de usuário, mapas de configuração |
| **List** | `LPUSH` `RPOP` `LRANGE` | Filas de tarefas, feeds de atividade (cronológicos) |
| **Set** | `SADD` `SMEMBERS` `SISMEMBER` | Visitantes únicos, tags, grafos de amizade |
| **Sorted Set** | `ZADD` `ZRANGE` `ZRANK` | Rankings, filas de prioridade, índices de séries temporais |
| **Stream** | `XADD` `XREAD` `XACK` | Logs de eventos duráveis, mensageria fan-out |

### Opções de persistência

O Redis não é puramente volátil. Dois mecanismos de persistência permitem uma durabilidade controlada:

| Modo | Como funciona | Trade-off |
|---|---|---|
| **RDB (snapshot)** | Faz um fork do processo e grava em disco um snapshot pontual, em intervalos configurados | ⚠️ Reinícios rápidos; pode perder segundos de dados |
| **AOF (append-only file)** | Registra cada comando de escrita; é reexecutado no reinício | ✅ Perda de dados quase nula; arquivos maiores, reinício mais lento |
| **RDB + AOF** | Ambos ativos ao mesmo tempo | ✅ Recomendado para produção |
| **Sem persistência** | Puramente em memória; dados perdidos no reinício | ⚠️ Aceitável para um cache puro |

Neste hands-on, habilitamos o AOF (`--appendonly yes`), que oferece durabilidade sem sacrificar o desempenho de escrita.

## Arquitetura

Adicionar o Redis à plataforma introduz uma camada de cache compartilhada entre todas as réplicas dos microsserviços e o banco de dados:

``` mermaid-sim
flowchart LR
    subgraph lb [Balanceador de carga]
        nginx["lb (Nginx)\n:8080"]
    end
    subgraph api [Camada confiável]
        nginx e1@==> gw1["gateway\n(réplica 1)"]
        nginx e2@==> gw2["gateway\n(réplica 2)"]
        nginx e3@==> gw3["gateway\n(réplica 3)"]
        gw1 & gw2 & gw3 --> auth
        gw1 & gw2 & gw3 --> account
        auth & account e4@-->|"leitura/escrita no cache"| redis["Redis\n:6379"]
        redis -->|"só em cache miss"| db@{ shape: cyl, label: "PostgreSQL" }
    end
    internet e0@==>|":8080"| nginx
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
    e4@{ animate: true }
```

As três réplicas do gateway compartilham a mesma instância do Redis. Uma entrada de cache gravada pela réplica 1 pode ser lida imediatamente pelas réplicas 2 e 3, eliminando consultas redundantes ao banco, não importa qual instância atenda a próxima requisição.

O cache em si vive nos serviços atrás do gateway: o `account` roda duas réplicas (`deploy.replicas: 2`) e guarda o `findById` em cache. Compare um cache por JVM com um cache compartilhado:

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant A1 as account-1
    participant A2 as account-2
    participant R as Redis
    participant DB as PostgreSQL
    alt um cache local por JVM
        C->>A1: GET /accounts/42
        A1->>DB: SELECT (miss no próprio cache)
        C->>A2: GET /accounts/42
        A2->>DB: SELECT de novo (o cache dela está vazio)
        C->>A1: PUT /accounts/42
        Note over A1,A2: account-1 atualiza a própria cópia, account-2 fica com a antiga
    else um Redis compartilhado
        C->>A1: GET /accounts/42
        A1->>R: GET accounts::42 (nil)
        A1->>DB: SELECT
        A1->>R: SET accounts::42
        C->>A2: GET /accounts/42
        A2->>R: GET accounts::42 (hit)
        Note over A2,DB: uma consulta para as duas réplicas e uma escrita atualiza a única cópia
    end
```

<div class="csim" data-sim="account-cache" data-script="replicas"></div>

!!! tip "Experimente"

    Sem Docker à mão? O simulador roda a pilha do lab: lb, três gateways, account-1 e account-2, Redis e PostgreSQL, com a chave (`accounts::42`), o TTL e as anotações do lab; play ou → roda uma página e os botões funcionam a qualquer momento. Em **Execução**, a segunda requisição é um hit mesmo com account-2 respondendo, a medição dá 0,058 s e 0,004 s, o `TTL` responde 287 e o `INFO stats` termina em `keyspace_hits:8` e `keyspace_misses:2` (80%). Em **local × compartilhado**, com `type: simple` as duas réplicas dão miss duas vezes e um `PUT` por account-1 deixa account-2 servindo "Ada Lovelace"; com o Redis, um miss serve as duas. Em **TTL e dado desatualizado**, um `UPDATE` no psql fica invisível até o TTL de 300 s acabar e um 404 nunca vai para o cache.

<div class="grid cards" markdown>

-   :material-file-code:{ .lg .middle } **[Docker Compose](./docker/)**

    ---

    Adicione o serviço `redis` ao `compose.yaml` e configure cada microsserviço para se conectar a ele.

    [Docker Compose](./docker/){ .md-button }

-   :material-leaf:{ .lg .middle } **[Spring Boot](./spring/)**

    ---

    Adicione as dependências do Spring Data Redis e configure `@Cacheable`, `@CachePut` e `@CacheEvict` nos métodos de serviço.

    [Spring Boot](./spring/){ .md-button }

-   :material-play-circle:{ .lg .middle } **[Executar](./run/)**

    ---

    Suba a stack completa, verifique os cache hits e misses pelo Redis CLI e meça a melhora de latência.

    [Executar](./run/){ .md-button }

</div>
