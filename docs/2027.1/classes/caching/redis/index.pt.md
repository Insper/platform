O **Redis** (*REmote DIctionary Server*) é a resposta padrão para "qual cache distribuído?" — e muito mais que um cache. É um servidor em memória de **estruturas de dados**: strings, hashes, listas, sets, sorted sets, streams e outras, cada uma com operações atômicas. A BoxOffice o usa como cache do catálogo, mas também como armazenamento de sessões, rate limiter, fila da sala de espera e contador de "pessoas vendo agora". Saber quanto custa cada estrutura, como o Redis persiste e replica, e como o Redis Cluster distribui as chaves é o que permite usá-lo bem — e reconhecer quando ele é a ferramenta errada.

---

## O que torna o Redis rápido

- **Tudo está em RAM.** Uma leitura é uma consulta a uma tabela hash mais uma cópia de memória; o disco só é usado para persistência, em segundo plano.
- **Uma thread executa os comandos.** Os comandos rodam um de cada vez numa única thread principal (desde o Redis 6, threads de I/O separadas podem cuidar da leitura e escrita na rede). Não há locks dentro do servidor, e **todo comando é atômico**: nenhum outro comando roda no meio de um `INCR`.
- **Protocolo simples, valores pequenos.** A maioria dos comandos é O(1) ou O(log n). No mesmo data center, a ida e volta de um `GET` pequeno custa uma fração de milissegundo, dominada pela rede.

A thread única também é a principal limitação do Redis: um comando lento (uma varredura O(n) de uma chave grande, um script Lua demorado) **bloqueia todos os clientes**. A vazão por nó é alta — da ordem de 100.000 comandos simples por segundo ou mais em hardware típico, um número ilustrativo que você deve verificar com o `redis-benchmark` no seu ambiente — e escalar além de um nó significa usar o [Redis Cluster](#cluster).

### Redis, Valkey e as alternativas (2026)

Em 2024 o Redis trocou a licença open source BSD por licenças *source-available* (RSALv2/SSPLv1). Em resposta, a Linux Foundation iniciou o **Valkey**, um fork do Redis 7.2 apoiado por vários provedores de nuvem, que continua com licença BSD e compatível no protocolo. Em 2025, o Redis 8 acrescentou a AGPLv3, open source, como opção de licença. Neste curso — e na maioria das entrevistas — "Redis" significa o protocolo e o modelo de dados, que Redis e Valkey compartilham[^1][^2].

| | Redis / Valkey | Memcached | Dragonfly |
|---|---|---|---|
| Modelo de dados | estruturas de dados ricas | só strings | compatível com Redis |
| Threads | uma thread de comandos (+ threads de I/O) | multithread | multithread, *shared-nothing* |
| Persistência | RDB, AOF | nenhuma | snapshots |
| Replicação / cluster | embutidos (Sentinel, Cluster) | nenhum (os clientes particionam) | replicação embutida |
| Quando | escolha padrão | um cache puro, simples e muito grande de blobs | quando um nó grande precisa substituir um cluster |

---

## Estruturas de dados e o que a BoxOffice faz com elas

| Tipo | Comandos principais | Complexidade | Uso na BoxOffice |
|---|---|---|---|
| **String** | `GET` `SET` `INCR` `EXPIRE` `MGET` | O(1) | JSON do evento cacheado; contadores; marcadores de idempotência |
| **Hash** | `HSET` `HGET` `HGETALL` `HINCRBY` | O(1) por campo | sessão (`session:9f1c` → usuário, papéis, carrinho); campos do evento atualizados separadamente |
| **List** | `LPUSH` `RPOP` `LRANGE` | O(1) nas pontas | filas de trabalho simples; "últimos 10 eventos vistos" |
| **Set** | `SADD` `SISMEMBER` `SMEMBERS` | O(1) por membro | tags de um evento; ids já notificados |
| **Sorted set** | `ZADD` `ZRANK` `ZRANGE` `ZPOPMIN` | O(log n) | **sala de espera**: fãs ordenados pela hora de chegada; eventos mais vendidos |
| **HyperLogLog** | `PFADD` `PFCOUNT` | O(1), ~12 KB por contador | visitantes únicos por evento (~0,81% de erro padrão) |
| **Bitmap** | `SETBIT` `BITCOUNT` | O(1) por bit | usuários ativos por dia, por id de usuário |
| **Geo** | `GEOADD` `GEOSEARCH` | O(log n) | "eventos perto de mim" |
| **Stream** | `XADD` `XREADGROUP` `XACK` | O(1) para anexar | log de eventos leve com grupos de consumidores (o Kafka é tratado em [Mensageria](../../messaging/index.md)) |

```text title="redis-cli — a tour with BoxOffice data"
> SET boxoffice:catalog:event:42:v3 '{"id":42,"name":"Stadium Show"}' EX 300
OK
> TTL boxoffice:catalog:event:42:v3
(integer) 300
> HSET session:9f1c user 1017 roles fan cart 3
(integer) 3
> INCR views:event:42
(integer) 1
> ZADD waitingroom:42 1760695200123 fan:1017 1760695200456 fan:2203
(integer) 2
> ZRANK waitingroom:42 fan:2203
(integer) 1
> ZPOPMIN waitingroom:42 1
1) "fan:1017"
2) "1760695200123"
> PFADD visitors:event:42 fan:1017 fan:2203 fan:1017
(integer) 1
> PFCOUNT visitors:event:42
(integer) 2
```

A sala de espera é um bom exemplo de escolha de estrutura: um sorted set com a hora de chegada (em milissegundos) como *score* dá a cada fã sua posição em O(log n) (`ZRANK`), e permite ao job de admissão pegar os próximos 500 fãs num só comando (`ZPOPMIN waitingroom:42 500`).

### Idas e voltas: pipelining e comandos multichave

A 0,5 ms por ida e volta, ler 100 chaves uma a uma custa 50 ms. O `MGET` (ou o **pipelining** — enviar muitos comandos sem esperar cada resposta) faz isso em cerca de uma ida e volta. Uma página que precisa de muitos objetos cacheados deve buscá-los juntos.

---

## Atomicidade { #atomicity }

Como os comandos rodam um de cada vez, um comando isolado é atômico. Para mais de um comando, o Redis oferece três ferramentas:

| Ferramenta | O que oferece | Limites |
|---|---|---|
| **Comando único** (`INCR`, `SET ... NX`, `ZPOPMIN`) | leitura-modificação-escrita atômica | uma chave, uma operação |
| **`MULTI` / `EXEC`** (+ `WATCH`) | enfileira comandos e os executa juntos, sem intercalação; o `WATCH` aborta se uma chave observada mudou (lock otimista) | **sem rollback**: se um comando falha, os outros executam mesmo assim; não dá para usar o resultado de uma leitura dentro da transação |
| **Scripts Lua** (`EVAL`) / **functions** (`FCALL`, Redis 7+) | lógica arbitrária executada atomicamente no servidor | bloqueia o servidor enquanto roda — mantenha os scripts curtos |

Um **rate limiter** de janela fixa para o API gateway em dois comandos:

```text title="redis-cli — 100 requests per minute per client"
> INCR rl:client:abc:202610171000
(integer) 1
> EXPIRE rl:client:abc:202610171000 60 NX
(integer) 1
```

Se o contador devolvido pelo `INCR` passar de 100, a requisição é rejeitada. (`EXPIRE ... NX` define a expiração só na primeira vez. Algoritmos mais refinados — token bucket, janela deslizante — estão em [Tráfego e Borda](../../edge/api-gateway/index.md).)

### Uma pré-reserva de assento no Redis — e por que o SQL ainda decide

Durante a venda relâmpago, milhares de fãs clicam nos mesmos bons lugares. Uma **pré-reserva** no Redis consegue rejeitar a maioria dos perdedores em microssegundos, antes de chegarem ao banco:

```text title="redis-cli — pre-hold seat A-12 of event 42 for 10 minutes"
> SET hold:42:A-12 fan:1017 NX PX 600000
OK
> SET hold:42:A-12 fan:2203 NX PX 600000
(nil)
```

O `NX` faz a gravação dar certo só se ninguém tiver a chave; o `PX 600000` a libera automaticamente depois de 10 minutos. O segundo fã recebe `nil` na hora: "lugar ocupado".

É tentador parar aí. Não pare. O fã que recebeu `OK` ainda passa pelo serviço `inventory`, que faz a reserva **numa transação PostgreSQL** com uma restrição que torna a venda dupla impossível ([Bancos de dados — o bug da venda dupla](../../databases/transactions/index.md#double-booking)). O Redis é um **filtro rápido**; o banco **decide**. Por quê:

- A replicação do Redis é assíncrona: depois de um failover, o novo primário pode não ter a reserva que acabou de ser concedida — dois fãs poderiam receber `OK` ([replicação](#replication)).
- Pressão de memória, um `FLUSHALL` por engano ou um reinício do cache sem persistência apagam reservas silenciosamente.
- O pedido, o pagamento e o ingresso vivem no SQL; o estado do assento precisa estar na mesma transação que eles.

Se o Redis perder uma pré-reserva, o pior caso é que dois fãs cheguem ao banco e um deles perca lá. A correção nunca dependeu do Redis.

---

## Persistência { #persistence }

O Redis mantém os dados em memória, mas pode gravá-los em disco, para que um reinício não comece frio.

| Modo | Como funciona | Perda de dados numa queda | Reinício | Uso |
|---|---|---|---|---|
| **Nenhum** | só memória | tudo | frio, rápido | cache puro que pode ser reconstruído |
| **RDB** (snapshot) | faz *fork* e grava um snapshot de um instante a cada N minutos / M escritas | desde o último snapshot (minutos) | carga rápida de um arquivo compacto | caches que devem reiniciar aquecidos; backups |
| **AOF** (*append-only file*) | registra cada escrita; `appendfsync everysec` (padrão) ou `always` | ~1 s com `everysec`; quase nada com `always` (lento) | reexecuta o log (mais lento) | Redis como armazenamento principal de dados não críticos (sessões) |
| **RDB + AOF** | os dois | como o AOF | o AOF é usado na recuperação | a configuração recomendada quando os dados importam |

Para um cache, **RDB ou nada** costuma bastar. Se você se pegar ajustando `appendfsync always`, pergunte-se se esse dado não deveria estar num banco de dados.

---

## Replicação e failover { #replication }

Um primário Redis pode ter várias **réplicas** que recebem um fluxo das suas escritas. As réplicas servem leituras (um pouco defasadas) e são candidatas à promoção se o primário falhar.

``` mermaid-sim
flowchart LR
    APP["serviço catalog"] -->|"escritas e leituras"| P[("Redis primário")]
    P -->|"replicação assíncrona"| R1[("réplica 1")]
    P -->|"replicação assíncrona"| R2[("réplica 2")]
    S1["Sentinel 1"] -.->|"monitora"| P
    S2["Sentinel 2"] -.->|"monitora"| P
    S3["Sentinel 3"] -.->|"monitora"| P
    S1 -.->|"quórum concorda: promover"| R1
```

- A replicação é **assíncrona**: o primário confirma uma escrita antes de as réplicas a terem. Se o primário morre, as últimas escritas confirmadas podem se perder. `WAIT numreplicas timeout` faz o cliente esperar até N réplicas terem suas escritas — reduz a janela, mas não torna o Redis fortemente consistente.
- O **Redis Sentinel** é um grupo de processos (pelo menos 3) que monitoram o primário; quando um quórum concorda que ele caiu, promovem uma réplica e informam o novo endereço aos clientes. O failover leva segundos — enquanto isso o cache fica indisponível ou só de leitura.
- `min-replicas-to-write` faz o primário recusar escritas quando não alcança réplicas suficientes, limitando a perda durante uma partição.

Para um cache isso é aceitável: uma escrita perdida é uma falta no futuro. Para dados que não podem ser perdidos, é o motivo para manter a fonte da verdade num banco de dados.

---

## Redis Cluster { #cluster }

Quando um nó não basta — em memória ou em vazão — o **Redis Cluster** particiona o espaço de chaves entre vários primários, cada um com suas réplicas[^3].

- O espaço de chaves é dividido em **16.384 hash slots**. O slot de uma chave é `CRC16(key) mod 16384`.
- Cada primário é dono de um conjunto de slots (por exemplo, três primários: 0–5460, 5461–10922, 10923–16383).
- Os clientes são **cluster-aware**: guardam o mapa slot → nó e mandam cada comando direto ao nó certo. Se o mapa estiver desatualizado, o nó responde `MOVED <slot> <endereço>` e o cliente atualiza o mapa; durante a migração de um slot, o `ASK` redireciona uma única requisição.
- Acrescentar um nó = **mover alguns slots** para ele, com o sistema no ar, sem refazer o hash de todas as chaves.

``` mermaid-sim
flowchart LR
    C["cliente cluster-aware<br/>mapa de slots em cache"] -->|"event:42 → slot 16271"| N3
    C -->|"prices:42 → slot 9049"| N2
    N1[("primário A<br/>slots 0–5460")] --- R1[("réplica A")]
    N2[("primário B<br/>slots 5461–10922")] --- R2[("réplica B")]
    N3[("primário C<br/>slots 10923–16383")] --- R3[("réplica C")]
```

```text title="redis-cli — which slot does a key go to?"
> CLUSTER KEYSLOT event:42
(integer) 16271
> CLUSTER KEYSLOT prices:42
(integer) 9049
> CLUSTER KEYSLOT {event:42}:seats
(integer) 16271
> CLUSTER KEYSLOT {event:42}:prices
(integer) 16271
```

**Operações multichave** (`MGET`, `MULTI`/`EXEC`, scripts Lua que tocam várias chaves) só funcionam quando **todas as chaves estão no mesmo slot** — caso contrário o Redis responde `CROSSSLOT`. As **hash tags** resolvem isso: se uma chave contém `{...}`, só a parte entre as chaves é usada no hash. `{event:42}:seats` e `{event:42}:prices` caem no mesmo slot, então um script pode atualizar as duas atomicamente.

!!! warning "Hash tags concentram carga"

    Tudo com a mesma tag mora num nó só. Use como tag algo com muitos valores (um evento, um usuário), nunca algo com poucos (`{boxoffice}` colocaria a aplicação inteira num nó — uma [chave quente](../failure-modes/index.md#hot-keys) feita por você mesmo).

### Hash slots vs. hashing consistente

O Memcached segue outro caminho: os servidores não se conhecem, e **o cliente** decide qual servidor guarda uma chave, normalmente com **hashing consistente** (o algoritmo *ketama*), de modo que acrescentar um servidor remapeie só ~1/N das chaves ([Bancos de dados — hashing consistente](../../databases/partitioning/index.md#consistent-hashing)). O Redis Cluster usa um número fixo de slots: o mapeamento chave → slot nunca muda, só o slot → nó, e os próprios nós coordenam o failover e os redirecionamentos.

| | Redis Cluster (hash slots) | Hashing consistente no cliente (Memcached) |
|---|---|---|
| Quem conhece o mapeamento | servidores + clientes cluster-aware | só os clientes |
| Acrescentar um nó | mover alguns slots, no ar | ~1/N das chaves são remapeadas (viram faltas) |
| Replicação / failover | embutidos | nenhum (um nó morto = faltas) |
| Operações multichave | dentro de um slot (hash tags) | nenhuma |

---

## Redis gerenciado

=== "AWS"

    - **Amazon ElastiCache** (Redis OSS, Valkey, Memcached): cache gerenciado com replicação, failover automático, modo Cluster e uma opção serverless.
    - **Amazon MemoryDB**: compatível com Redis/Valkey, com um log de transações durável e multi-AZ — pensado para ser um banco de dados principal, não só um cache.

=== "GCP"

    - **Memorystore for Redis**, **Memorystore for Redis Cluster** e **Memorystore for Valkey**: instâncias gerenciadas com réplicas e failover automático.
    - **Memorystore for Memcached**.

=== "Azure"

    - **Azure Managed Redis** (baseado no Redis Enterprise) e os níveis mais antigos do **Azure Cache for Redis**, com opções de replicação, cluster e geo-replicação.

=== "Open source"

    - **Redis** ou **Valkey** auto-hospedados: um único nó com Docker para desenvolvimento ([Hands-on 5](../../../hands-on/5/index.md)); Sentinel ou Cluster em VMs; no Kubernetes com um operator ou um Helm chart (StatefulSet + volumes persistentes).
    - **Memcached** e **Dragonfly** como alternativas.

Serviços gerenciados cuidam de failover, atualizações e backups; continuam sendo seus o **dimensionamento, a política de despejo, o desenho das chaves, os timeouts e o que acontece quando ele falha**.

---

## Dimensionando uma implantação Redis

!!! example "Exemplo resolvido — o cluster de cache da BoxOffice"

    *Premissas ilustrativas:* 2 milhões de chaves cacheadas (eventos, preços, resultados de busca, fragmentos); chave média de 50 bytes; valor médio de 2 KB; custo por chave (entrada do dicionário, cabeçalhos de objeto, expiração) ~100 bytes.

    - Dados: 2.000.000 × (50 + 2.048 + 100) B ≈ **4,4 GB**.
    - Folga para fragmentação e crescimento (+30%): ≈ 5,7 GB.
    - Folga para o *fork* dos snapshots RDB num primário com muitas escritas: manter o uso de memória ≤ ~70% da RAM → ≈ **8 GB por cópia**.
    - Vazão: 300.000 leituras/s no pico depois dos caches L1; supondo (a medir em benchmark) ~100.000 ops/s por primário → **3 primários**, cada um com **1 réplica**.
    - Resultado: Redis Cluster com 3 primários × ~1,5 GB de dados cada (≈ 2,7 GB de RAM com a folga acima) + 3 réplicas — **6 nós com 4–8 GB de RAM**. A restrição é a vazão, não a memória.

    As sessões (2 M fãs × 0,5 KB ≈ 1 GB) vão para uma instância pequena **separada**, com `noeviction` e AOF, para que despejos do cache nunca desconectem um fã.

---

## Conectando a partir do Spring Boot

A configuração usada no [Hands-on 5](../../../hands-on/5/index.md):

```yaml title="catalog/src/main/resources/application.yaml"
spring:
  data:
    redis:
      host: ${REDIS_HOST:redis}
      port: 6379
      timeout: 50ms            # command timeout: fail fast if Redis is slow
      connect-timeout: 200ms
      # cluster:
      #   nodes: redis-0:6379,redis-1:6379,redis-2:6379
  cache:
    type: redis
    redis:
      time-to-live: 5m         # default TTL for @Cacheable caches
      cache-null-values: false
      key-prefix: "boxoffice:catalog:"
```

```yaml title="compose.yaml (excerpt)"
services:
  redis:
    image: redis:8-alpine
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports:
      - "6379:6379"
```

!!! tip "Na entrevista"

    Quando você disser "Redis", prepare-se para três perguntas seguintes. **Modelo de dados**: escolha a estrutura que combina com o padrão de acesso ("um sorted set para a sala de espera, um hash para as sessões"). **Escala**: Redis Cluster com 16.384 hash slots, hash tags para operações multichave e réplicas para failover — e por que uma chave quente não se resolve acrescentando nós. **Durabilidade**: a replicação é assíncrona, então o Redis é um cache ou um armazenamento para dados que você pode perder; a reserva do assento e o pagamento vivem no banco.

!!! warning "Armadilhas comuns"

    - **`KEYS *` em produção** — O(n) sobre todo o espaço de chaves, bloqueia o servidor. Use `SCAN`.
    - **Chaves sem TTL** num cache — a memória cresce até começarem os despejos ou os erros de `OOM`.
    - **Valores grandes e coleções enormes** — veja [chaves grandes](../failure-modes/index.md#big-keys).
    - **Redis como única cópia de dados de dinheiro** — pedidos, pagamentos e reservas de assento pertencem ao banco.
    - **Timeouts padrão** — um Redis lento ou falhando não pode travar o serviço.
    - **Uma instância para cache e sessões** — a política de despejo do cache vai despejar sessões.
    - **Hash tags com baixa cardinalidade** — a aplicação inteira num nó só.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    FAST["em memória,<br/>um comando por vez"] --> DS["estruturas de dados: strings,<br/>hashes, sorted sets, streams"]
    DS --> WR["sorted set =<br/>sala de espera → Mensageria"]
    DS --> SESS["hashes = sessões,<br/>strings = JSON cacheado"]
    FAST --> ATOM["atomicidade: comandos únicos,<br/>MULTI, Lua"]
    ATOM --> RL["contadores de rate limit<br/>→ API gateway da borda"]
    ATOM --> PRE["pré-reserva no Redis,<br/>o SQL ainda decide → Bancos de dados"]
    FAST --> PERS["persistência: RDB, AOF"]
    FAST --> REP["replicação assíncrona,<br/>failover"]
    REP --> CL["Redis Cluster<br/>16.384 hash slots"]
    CL -.-> CH["vs hashing consistente<br/>→ Particionamento"]
```

**Componentes da paleta:** [`cache`](../../../reference/components/storage/index.md#cache) (Redis ou Valkey, gerenciado ou próprio) · [`queue`](../../../reference/components/messaging/index.md#queue) (uma sala de espera em sorted set; listas como filas de jobs simples) · [`stream`](../../../reference/components/messaging/index.md#stream) (Redis Streams, um log de eventos leve) · [`apigw`](../../../reference/components/edge/index.md#apigw) (contadores de rate limit com `INCR` + `EXPIRE`) · [`sql`](../../../reference/components/storage/index.md#sql) (ainda decide a reserva do assento) · [`app`](../../../reference/components/compute/index.md#app) (clientes Spring Boot com pools e timeouts). **Cenários:** `read-heavy-cache`, `flash-sale`, `rate-limiter`. **Continua em:** [Bancos de dados — hashing consistente](../../databases/partitioning/index.md#consistent-hashing), [Bancos de dados — replicação](../../databases/replication/index.md), [Borda — token bucket](../../edge/api-gateway/index.md#token-bucket), [Estudo de caso: cache distribuído](../../case-studies/distributed-cache/index.md), [Hands-on 5](../../../hands-on/5/index.md).

---

[^1]: REDIS. [Documentação do Redis](https://redis.io/docs/latest/){target="_blank"}.
[^2]: LINUX FOUNDATION. [Valkey](https://valkey.io){target="_blank"}.
[^3]: REDIS. [Redis cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/){target="_blank"}.
