!!! tip "Objetivo principal"

    O objetivo principal deste hands-on é adicionar o **Redis** como cache em memória compartilhado à plataforma de microsserviços, reduzindo a carga sobre o banco de dados e melhorando os tempos de resposta — algo especialmente relevante agora que o gateway roda com várias réplicas atrás do Nginx.

Quando o gateway escala horizontalmente, cada instância da JVM tem seu próprio cache local. Uma requisição roteada para a réplica 1 coloca uma conta em cache; a mesma conta buscada pela réplica 2 dispara outra consulta ao banco. Um **cache externo compartilhado** (Redis) resolve isso: todas as réplicas leem e escrevem no mesmo armazenamento.

## Bancos de dados em memória

Um **banco de dados em memória** (IMDB, *in-memory database*) mantém seu conjunto de dados de trabalho principal na RAM, e não em disco. Como a latência de acesso à RAM é medida em nanossegundos, enquanto a de acesso ao disco é medida em milissegundos, os IMDBs são ordens de grandeza mais rápidos para workloads com muitas leituras.

| | Tradicional (em disco) | Em memória |
|---|---|---|
| **Armazenamento** | Disco (HDD / SSD) | RAM |
| **Latência de leitura** | 1–10 ms | < 1 ms |
| **Latência de escrita** | 5–20 ms | < 1 ms |
| **Durabilidade** | Persistente por padrão | Configurável |
| **Capacidade** | Terabytes | Gigabytes (limitado pela RAM) |
| **Caso de uso** | Fonte da verdade | Cache, sessões, contadores |

O padrão típico em produção é o **cache-aside**: a aplicação consulta primeiro o armazenamento em memória; somente em um **cache miss** ela consulta o banco de dados e então preenche o cache com o resultado.

``` mermaid
flowchart LR
    app[Serviço] -->|"1. GET account:42"| redis[(Redis)]
    redis -->|"2a. cache hit → retorna"| app
    redis -->|"2b. cache miss (nil)"| app
    app -->|"3. SELECT * FROM accounts\nWHERE id = 42"| db[(PostgreSQL)]
    db -->|"4. retorna a linha"| app
    app -->|"5. SET account:42 ...EX 300"| redis
```

## Redis

O [Redis](https://redis.io){target="_blank"} (Remote Dictionary Server) é o armazenamento de estruturas de dados em memória mais utilizado. Ele é usado ao mesmo tempo como **cache, armazenamento de sessões, message broker e motor de estruturas de dados em tempo real** — e é o padrão de fato para cache distribuído em arquiteturas de microsserviços.

### Estruturas de dados

Diferentemente do Memcached (apenas strings), o Redis oferece estruturas de dados nativas, cada uma com operações O(1) ou O(log n):

| Tipo | Comandos principais | Caso de uso típico |
|---|---|---|
| **String** | `SET` `GET` `INCR` `EXPIRE` | Valores JSON em cache, contadores, tokens de rate limit |
| **Hash** | `HSET` `HGET` `HGETALL` | Objetos de sessão de usuário, mapas de configuração |
| **List** | `LPUSH` `RPOP` `LRANGE` | Filas de tarefas, feeds de atividades (cronológicos) |
| **Set** | `SADD` `SMEMBERS` `SISMEMBER` | Visitantes únicos, tags, grafos de amizade |
| **Sorted Set** | `ZADD` `ZRANGE` `ZRANK` | Rankings (leaderboards), filas de prioridade, índices de séries temporais |
| **Stream** | `XADD` `XREAD` `XACK` | Logs de eventos duráveis, mensageria fan-out |

### Opções de persistência

O Redis não é puramente volátil. Dois mecanismos de persistência permitem uma durabilidade controlada:

| Modo | Como funciona | Trade-off |
|---|---|---|
| **RDB (snapshot)** | Faz um fork do processo e grava em disco um snapshot de um instante, em intervalos configurados | Reinícios rápidos; pode perder segundos de dados |
| **AOF (append-only file)** | Registra todo comando de escrita; reexecutado no reinício | Perda de dados quase nula; arquivos maiores, reinício mais lento |
| **RDB + AOF** | Ambos ativos simultaneamente | Recomendado para produção |
| **Sem persistência** | Puramente em memória; dados perdidos no reinício | Aceitável para um cache puro |

Neste hands-on, habilitamos o AOF (`--appendonly yes`), o que garante durabilidade sem sacrificar o desempenho de escrita.

## Arquitetura

Adicionar o Redis à plataforma introduz uma camada de cache compartilhada entre todas as réplicas dos microsserviços e o banco de dados:

``` mermaid
flowchart LR
    subgraph lb [Balanceador de Carga]
        nginx["Nginx\n:80"]
    end
    subgraph api [Camada Confiável]
        nginx e1@==> gw1["gateway\n(réplica 1)"]
        nginx e2@==> gw2["gateway\n(réplica 2)"]
        nginx e3@==> gw3["gateway\n(réplica 3)"]
        gw1 & gw2 & gw3 --> auth
        gw1 & gw2 & gw3 --> account
        auth & account e4@-->|"leitura/escrita no cache"| redis["Redis\n:6379"]:::highlighted
        redis -->|"apenas em cache miss"| db@{ shape: cyl, label: "PostgreSQL" }
    end
    internet e0@==>|":80"| nginx
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
    e4@{ animate: true }
    classDef highlighted fill:#fcc
```

As três réplicas do gateway compartilham a mesma instância do Redis. Uma entrada de cache gravada pela réplica 1 pode ser lida imediatamente pelas réplicas 2 e 3, eliminando consultas redundantes ao banco, independentemente de qual instância atenda a próxima requisição.

<div class="grid cards" markdown>

-   :material-file-code:{ .lg .middle } **[Docker Compose](./docker/)**

    ---

    Adicione o serviço `redis` ao `compose.yaml` e configure cada microsserviço para se conectar a ele.

    [Docker Compose](./docker/){ .md-button }

-   :material-leaf:{ .lg .middle } **[Spring Boot](./spring/)**

    ---

    Adicione as dependências do Spring Data Redis e configure `@Cacheable`, `@CachePut` e `@CacheEvict` nos métodos de serviço.

    [Spring Boot](./spring/){ .md-button }

-   :material-play-circle:{ .lg .middle } **[Execução](./run/)**

    ---

    Suba a stack completa, verifique cache hits e misses pelo Redis CLI e meça a melhora na latência.

    [Execução](./run/){ .md-button }

</div>
