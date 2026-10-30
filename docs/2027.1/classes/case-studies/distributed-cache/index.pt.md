
> *"Projete um cache distribuído em memória como o Memcached ou o Redis Cluster: um armazenamento chave-valor que muitos servidores de aplicação usam para não bater no banco, guardando mais dados do que cabem numa máquina, com latência abaixo de um milissegundo."*

Quase todo caso desta disciplina termina com "e coloca um cache na frente". Este caso abre essa caixa. Um cache distribuído é um pequeno **banco de dados distribuído** com regras relaxadas: ele pode perder dados (a fonte da verdade está em outro lugar), mas precisa ser rápido, espalhar as chaves de forma equilibrada por muitos nós, sobreviver a nós entrando e saindo sem um estouro de manada no banco e lidar com chaves muito mais quentes que as outras. É a entrevista em que **hash consistente**, **políticas de despejo**, **atraso de replicação** e **chaves quentes** aparecem num só design — as mesmas ideias por trás do Dynamo, do Cassandra e do Redis Cluster.

No BoxOffice, o cache guarda páginas de eventos, retratos da disponibilidade de lugares e sessões. Às 10:00 de um dia de abertura de vendas ele absorve milhões de leituras por minuto; se um nó de cache morrer às 10:01, a questão é se sua fatia do tráfego passa suavemente para os outros ou cai inteira sobre o PostgreSQL de uma vez.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star: médio |
| **Conceitos-chave** | particionamento com hash consistente e nós virtuais, hash slots, despejo (LRU, LFU, W-TinyLFU) e TTL, dimensionamento de memória, replicação primário/réplica e failover, split brain, chaves quentes e chaves grandes, roteamento no cliente vs. proxy, cache-aside, proteção contra estouro de manada (leases, coalescência de requisições, expiração antecipada) |
| **Componentes da paleta** | [`cache`](../../../reference/components/storage/index.md#cache), [`app`](../../../reference/components/compute/index.md#app), [`nosql`](../../../reference/components/storage/index.md#nosql), [`metrics`](../../../reference/components/observability/index.md#metrics) |
| **Cenários do playground** | `read-heavy-cache`, `sharding` |

!!! abstract "O que este caso treina"

    - **Dimensionar** um cluster de cache pela memória **e** pelas operações por segundo, e **relacionar** a taxa de acerto com a carga no banco.
    - **Explicar** por que `hash(chave) % N` falha quando os nós mudam e como o hash consistente com nós virtuais resolve.
    - **Escolher** uma política de despejo e TTLs para uma carga, e **explicar** o que o W-TinyLFU acrescenta ao LRU.
    - **Projetar** replicação e failover, e **declarar** o que se perde com replicação assíncrona.
    - **Mitigar** chaves quentes, chaves grandes e estouros de manada no cache.

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

([roteiro de entrevista](../../intro/interview-framework/index.md))

### Requisitos funcionais { #functional-requirements }

1. `get(key)`, `set(key, value, ttl)`, `delete(key)`; operações atômicas opcionais (`incr`, compare-and-set).
2. As chaves expiram depois do **TTL**; quando a memória enche, o cache **despeja** algumas chaves.
3. O conjunto de dados é maior que uma máquina: as chaves são **particionadas** entre muitos nós.
4. Nós podem ser **acrescentados ou removidos** (escalonamento, falhas) sem reiniciar os clientes.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta |
|---|---|
| **Latência** | p99 < 1 ms dentro do data center |
| **Vazão** | ~2 M de operações/s no pico, crescendo |
| **Capacidade** | ~1 TB de dados quentes |
| **Disponibilidade** | A falha de um nó não pode causar indisponibilidade nem estouro de manada no banco |
| **Consistência** | Eventual; algumas leituras desatualizadas após uma escrita são aceitáveis (a fonte da verdade é o banco) |
| **Durabilidade** | Não exigida — perder os dados de um nó custa faltas no cache, não corretude |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Persistência em disco (snapshots/AOF), replicação entre regiões, estruturas de dados complexas além de strings e contadores, autenticação — cite que o Redis oferece várias delas.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | É um cache (dados podem se perder) ou um armazenamento primário? | Um cache pode usar replicação assíncrona e despejar à vontade; um armazenamento não. |
    | Tamanho total dos dados e tamanho dos valores? | Dimensionamento de memória; valores grandes (MBs) exigem cuidado especial. |
    | Razão leitura/escrita e pico de ops/s? | Muitas vezes são as ops/s, e não a memória, que decidem o número de nós. |
    | Dados desatualizados são aceitáveis? Por quanto tempo? | TTLs, estratégia de invalidação, leitura em réplicas. |
    | Algumas chaves são muito mais quentes que outras? | Chaves quentes quebram o particionamento equilibrado. |
    | Quem roteia: a biblioteca cliente, um proxy ou os servidores? | Afeta latência, complexidade do cliente e operação. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

```python exec="1" source="tabbed-right"
# Distributed cache: assumptions (illustrative)
items         = 1_000_000_000   # cached objects (working set)
value_b       = 1_000           # average value size
key_b         = 50
overhead_b    = 50              # per-item metadata, pointers, allocator slack
node_mem_gb   = 64              # RAM per node usable for data (leave headroom)
ops_s         = 2_000_000       # total cache operations per second at peak
ops_per_node  = 80_000          # comfortable ops/s per node (single-threaded engine)
replicas      = 1               # replicas per primary
hit_ratio     = 0.95

data_tb       = items * (value_b + key_b + overhead_b) / 1e12
nodes_memory  = data_tb * 1e3 / node_mem_gb
nodes_ops     = ops_s / ops_per_node
primaries     = max(nodes_memory, nodes_ops)
total_nodes   = primaries * (1 + replicas)
net_gb_s      = ops_s * value_b / 1e9
db_rps        = ops_s * (1 - hit_ratio)
db_rps_90     = ops_s * (1 - 0.90)

rows = [
    ("data_tb", data_tb, "TB"), ("nodes_memory", nodes_memory, "nodes"),
    ("nodes_ops", nodes_ops, "nodes"), ("primaries", primaries, "nodes"),
    ("total_nodes", total_nodes, "nodes"), ("net_gb_s", net_gb_s, "GB/s"),
    ("db_rps", db_rps, "req/s"), ("db_rps_90", db_rps_90, "req/s"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- **~1,1 TB** de dados precisam de **~17 nós** pela memória, mas **2 M de ops/s** precisam de **25 nós** pela vazão. ⇒ dimensione pelos **dois** e fique com o maior: aqui a vazão decide (25 primários, 50 nós com uma réplica cada).
- **2 GB/s** de valores atravessam a rede no pico — divididos por 25 nós são ~80 MB/s cada, tranquilo para placas de rede modernas, mas uma única **chave grande** lida milhares de vezes por segundo pode saturar o link de um nó.
- Com 95% de acerto o banco recebe **100 mil req/s**; com 90% recebe **200 mil req/s**. ⇒ cada ponto de taxa de acerto vale 20 mil requisições por segundo no banco. Perder um nó de 25 (4% das chaves) frio é um súbito +80 mil faltas/s para o banco — o motivo de failover e réplicas aquecidas importarem ([cache](../../caching/index.md)).

---

## 3. API

```text
GET    key                         → value | nil
SET    key value EX 300            → OK                 (TTL in seconds)
SET    key value NX EX 30          → OK | nil           (only if absent: locks, leases)
DEL    key                         → 1 | 0
INCRBY key 5                       → 42                 (atomic counter)
MGET   k1 k2 k3                    → [v1, v2, v3]       (batched: one round trip)

# Cluster-aware client: the key decides the node
slot = CRC16(key) mod 16384        → node owning that slot (Redis Cluster)
-MOVED 3999 10.0.1.17:6379         → slot moved: update the client's map and retry there
```

- A biblioteca cliente faz parte da API: ela calcula o hash da chave, mantém o **mapa de partições → nós**, faz pool de conexões e pipelining das requisições.
- Um `MGET` com chaves em nós diferentes vira um **scatter-gather**; use hash tags (`{event:42}:seats`, `{event:42}:page`) para manter no mesmo nó as chaves relacionadas que são lidas juntas.

---

## 4. Modelo de dados { #4-data-model }

```text
# On each node: a hash table of entries + an eviction structure
entry  = { key, value, expires_at, flags, lru_clock | lfu_counter }
index  = hash table key → entry                   (O(1) get/set)
policy = LRU list / sampled LRU / LFU counters   (who to evict when memory is full)

# Cluster metadata (gossiped between nodes or stored in a coordination service)
slots 0–5460      → node-a (primary), node-d (replica)
slots 5461–10922  → node-b (primary), node-e (replica)
slots 10923–16383 → node-c (primary), node-f (replica)
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Valores em cache | Tabela hash em memória por nó (`cache`) | Acesso O(1), sem disco no caminho |
| Mapa de partições (slots/anel → nós) | Gossip entre os nós, ou um serviço de coordenação (etcd/ZooKeeper); em cache em cada cliente | Pequeno, lido em toda requisição, muda raramente |
| Fonte da verdade | Banco de dados (`nosql`/SQL) atrás do cache | O cache sempre pode ser reconstruído a partir dele |
| Taxa de acerto, despejos, memória, latência por nó | Métricas (`metrics`) | Nós quentes, tempestades de despejo e pressão de memória só aparecem aqui |

---

## 5. Design de alto nível { #5-high-level-design }

``` diagram-sim
flowchart LR
    app1["Servidor de app #1<br/>cliente que conhece o cluster"] --> a["node-a<br/>slots 0–5460"]
    app1 --> b["node-b<br/>slots 5461–10922"]
    app2["Servidor de app #2<br/>cliente que conhece o cluster"] --> b
    app2 --> c["node-c<br/>slots 10923–16383"]
    a -. replicação assíncrona .-> ra["réplica a'"]
    b -. replicação assíncrona .-> rb["réplica b'"]
    c -. replicação assíncrona .-> rc["réplica c'"]
    app1 -- falta --> db[("Banco de dados<br/>fonte da verdade")]
    app2 -- falta --> db
    a -. métricas .-> m["Métricas"]
```

Uma leitura com cache-aside, incluindo um slot que mudou de nó:

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as App (biblioteca cliente)
    participant B as node-b
    participant C as node-c
    participant D as Banco de dados
    A->>A: slot = CRC16("event:42") mod 16384 → node-b (mapa em cache)
    A->>B: GET event:42
    B-->>A: -MOVED 9001 node-c (o slot foi migrado)
    A->>A: atualiza o mapa de slots
    A->>C: GET event:42
    C-->>A: nil (falta)
    A->>D: SELECT evento 42
    D-->>A: linha
    A->>C: SET event:42 … EX 300
```

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

### 6.1 Particionamento: por que `hash % N` quebra, e o hash consistente { #61-partitioning-why-hash-n-breaks-and-consistent-hashing }

Com `nó = hash(chave) % N`, passar de 4 para 5 nós muda o dono de quase todas as chaves — um cache com 80% das chaves de repente no lugar errado é, para o banco, o mesmo que um cache vazio. O **hash consistente** coloca nós e chaves no mesmo anel de valores de hash; uma chave pertence ao primeiro nó no sentido horário. Acrescentar um nó só toma chaves dos vizinhos — cerca de `1/N` delas. Cada nó físico recebe muitos **nós virtuais** (pontos no anel) para a carga ficar equilibrada e as chaves de um nó que falhou se espalharem por todos os outros, não só por um vizinho ([particionamento](../../databases/partitioning/index.md)).

```python exec="1" source="tabbed-right"
import bisect
import hashlib

def h(s: str) -> int:
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

keys = [f"event:{i}" for i in range(50_000)]
kh = {k: h(k) for k in keys}

def mod_n(n):
    return {k: kh[k] % n for k in keys}

def ring(nodes, vnodes):
    points = sorted((h(f"node{n}#{v}"), n) for n in range(nodes) for v in range(vnodes))
    hashes = [p for p, _ in points]
    owner = {}
    for k in keys:
        i = bisect.bisect(hashes, kh[k]) % len(points)
        owner[k] = points[i][1]
    return owner

def moved(a, b):
    return sum(a[k] != b[k] for k in keys) / len(keys)

def max_over_avg(owner, nodes):
    counts = [0] * nodes
    for n in owner.values():
        counts[n] += 1
    return max(counts) / (len(keys) / nodes)

print("| scheme | keys_moved_pct | max_load_vs_avg |\n|---|---:|---:|")
a, b = mod_n(4), mod_n(5)
print(f"| `hash % N` | {moved(a, b):.1%} | {max_over_avg(b, 5):.2f} |")
for v in (1, 10, 100, 1000):
    a, b = ring(4, v), ring(5, v)
    print(f"| `ring, {v} vnodes/node` | {moved(a, b):.1%} | {max_over_avg(b, 5):.2f} |")
```

Leia a tabela em duas colunas. **Chaves movidas** ao passar de 4 para 5 nós: `hash % N` move ~80%; o anel move ~20% — o mínimo teórico, `1/5`. **Equilíbrio de carga** (o nó mais ocupado em relação à média): com um ponto por nó o anel fica muito desigual (o nó mais ocupado guarda quase o dobro da sua parte); com centenas de nós virtuais ele se aproxima de 1,0.

=== "Anel com nós virtuais"

    Usado pelo Dynamo, pelo Cassandra e por muitas bibliotecas cliente (ex.: ketama para o Memcached). Cada nó é dono de muitos arcos; acrescentar/remover um nó move ~`1/N` das chaves, tiradas de ou entregues a todos os outros nós.

=== "Hash slots fixos (Redis Cluster)"

    O espaço de chaves é dividido num número fixo de slots (16 384); cada nó é dono de um conjunto de slots. O rebalanceamento **move slots**, não faixas de hash individuais, e o cluster avisa os clientes com redirecionamentos `MOVED`/`ASK`. O mesmo benefício do anel (só os slots movidos mudam de dono), mais simples de raciocinar e de migrar aos poucos.

=== "Rendezvous hashing"

    Para cada chave, calcule `hash(chave, nó)` para todos os nós e escolha o maior. Sem anel, movimento perfeito de `1/N`, mas O(N) por consulta — bom para dezenas de nós.

### 6.2 Despejo, TTL e memória { #62-eviction-ttl-and-memory }

Quando a memória enche, algo precisa sair. A política decide a taxa de acerto que você obtém com a mesma RAM ([modos de falha de cache](../../caching/failure-modes/index.md)):

| Política | Mantém | Boa para | Ponto fraco |
|---|---|---|---|
| **LRU** (menos usada recentemente) | Chaves usadas recentemente | Cargas guiadas por recência | Uma varredura avulsa de muitas chaves expulsa o conjunto quente |
| **LFU** (menos usada com frequência) | Chaves usadas com frequência | Popularidade estável | Demora a esquecer os sucessos de ontem; precisa de decaimento |
| **W-TinyLFU** (Caffeine) | Uma pequena "janela" LRU + um filtro de admissão por frequência aproximada | Cargas mistas; resiste a varreduras | Mais complexa; principalmente em caches em processo |
| **Só TTL** | Tudo até expirar | Conjuntos de dados pequenos e limitados | A memória cresce com o tráfego |
| **Aleatória** | Chaves aleatórias | Muito barata | Taxa de acerto menor |

- Motores reais **aproximam**: o Redis amostra algumas chaves e despeja a melhor candidata entre elas (LRU ou LFU aproximados, com contadores que decaem) em vez de manter uma ordem global perfeita.
- **TTL é ferramenta de consistência, despejo é ferramenta de memória.** Sempre defina um TTL (para o dado desatualizado ter um limite) e acrescente **jitter** aos TTLs gravados em massa (ex.: 300 s ± 10%) para não expirarem no mesmo segundo.
- **Deixe folga**: planeje ~70–80% da RAM para dados. Fragmentação, buffers de replicação e o fork para snapshots precisam do resto; um nó que faz swap para o disco é mais lento do que nenhum cache.

### 6.3 Replicação e failover { #63-replication-and-failover }

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as App
    participant P as Primário (node-b)
    participant R as Réplica (node-e)
    participant S as Detector de falhas
    A->>P: SET seats:42 v7
    P-->>A: OK
    P--)R: replica v7 (assíncrono)
    Note over P: o primário cai antes de v7 chegar à réplica
    S->>S: node-b perdeu heartbeats → a maioria concorda
    S->>R: promove node-e a primário
    A->>R: GET seats:42
    R-->>A: v6 (a escrita confirmada v7 se perdeu)
```

- A replicação costuma ser **assíncrona**: escritas rápidas, mas um failover pode perder as últimas escritas confirmadas. Para um cache isso é aceitável — a próxima falta recarrega do banco. Se um valor desatualizado for perigoso (disponibilidade de lugares), mantenha TTLs curtos ou apague as chaves na escrita ([invalidação](../../caching/patterns/index.md)).
- A **detecção de falhas** precisa de **maioria** (Redis Sentinel, ou os nós do cluster votando) para que um observador isolado não promova uma réplica sozinho.
- **Split brain**: depois de uma partição, o primário antigo ainda pode aceitar escritas de clientes do lado dele. Mitigue fazendo o primário parar de aceitar escritas quando não enxerga réplicas/pares suficientes (`min-replicas-to-write`), e com épocas/termos para clientes e nós rejeitarem o primário velho.
- **Réplicas aquecidas** também atendem leituras (se leituras desatualizadas forem aceitáveis) e evitam o estouro de manada do nó frio depois do failover.

### 6.4 Chaves quentes, chaves grandes e estouros de manada { #64-hot-keys-big-keys-and-stampedes }

- **Chave quente** — uma chave (a página do evento durante uma abertura de vendas, o perfil de uma celebridade) recebe tantas requisições que seu nó satura enquanto os outros ficam ociosos. O hash consistente não ajuda: uma chave mora num nó só. Soluções: um pequeno **cache L1 em processo** com TTL de segundos em cada servidor de aplicação; **replicar a chave** com vários nomes (`event:42#1 … #8`) e ler uma cópia aleatória; atendê-la pelas réplicas.
- **Chave grande** — um valor de 5 MB lido 1 000 vezes por segundo são 5 GB/s num nó. Divida-o (pagine, comprima), ou guarde em cache os fragmentos renderizados em vez do objeto inteiro.
- **Estouro de manada** (*thundering herd*) — uma chave quente expira e milhares de requisições falham ao mesmo tempo e vão todas ao banco. Soluções ([modos de falha de cache](../../caching/failure-modes/index.md)):
    - **Coalescência de requisições / leases**: a primeira falta ganha uma lease (`SET lock:key NX EX 5`) e recarrega; as outras esperam um pouco ou recebem o valor velho. O Memcache do Facebook usou leases exatamente para isso.
    - **Expiração antecipada probabilística**: cada leitor pode renovar *antes* do TTL com uma probabilidade que cresce conforme a expiração se aproxima, então uma requisição renova antes em vez de todas ao mesmo tempo.
    - **Servir o velho enquanto revalida** para dados em que alguns segundos de desatualização tudo bem.

```python
import math, random, time

def should_refresh_early(expires_at: float, recompute_s: float, beta: float = 1.0) -> bool:
    """XFetch: refresh before expiry with a probability that grows near the deadline."""
    return time.time() - recompute_s * beta * math.log(random.random()) >= expires_at
```

!!! example "No código do BoxOffice: um lease contra o stampede (lab 5)"

    O BoxOffice roda um Redis só, não um cluster, então os labs não constroem o particionamento deste caso — mas o [Hands-on 5 — Stampede](../../../hands-on/5/stampede/index.md) constrói o seu lease: a primeira falta pega o `lock` com `SET NX` e recarrega, relê depois de vencer, e as outras consultam a chave por no máximo 20 × 25 ms. No teste do lab (200 usuários virtuais por 60 s, TTL de 3 s), as faltas caíram de **2.238 para 19** — uma consulta ao banco por expiração. O passo a passo completo está em [Cache — modos de falha](../../caching/failure-modes/index.md).

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventCache.java (the lease)" }
    --8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java:62:85"
    ```

### 6.5 Roteamento: quem sabe onde mora uma chave? { #65-routing-who-knows-where-a-key-lives }

| | Roteamento no cliente (cliente esperto) | Proxy (twemproxy, mcrouter, Envoy) | Redirecionamentos do servidor (Redis Cluster) |
|---|---|---|---|
| Saltos | 1 (cliente → nó) | 2 (cliente → proxy → nó) | 1, mais um redirecionamento após rebalancear |
| Complexidade do cliente | Alta (mapa, retentativas, pool em cada linguagem) | Baixa (parece um servidor só) | Média (cliente que conhece o cluster) |
| Mudanças de configuração | Enviadas a cada cliente | Só aos proxies | Aprendidas pelo `MOVED` |
| Recursos extras | — | Pool, replicação, tráfego espelhado | Migração de slots embutida |

A implantação de memcache do Facebook, por exemplo, colocou o roteamento num proxy (mcrouter) para que milhares de servidores web não precisassem cada um gerenciar conexões com todos os nós de cache.

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Acrescentar/remover nós | `hash % N` remapeia quase todas as chaves → faltas em massa | Hash consistente ou hash slots; migrar aos poucos | Tráfego de rebalanceamento por um tempo |
| Falha de um nó | Suas chaves esfriam; pico no banco | Réplicas com failover automático; espalhar chaves com nós virtuais; o cache L1 absorve parte das leituras | Réplicas dobram o custo de memória |
| Replicação assíncrona | Escritas confirmadas perdidas no failover | Aceitar num cache; TTLs curtos ou apagar na escrita para chaves sensíveis | Valores velhos ou ausentes por pouco tempo |
| Partição de rede | Dois primários (split brain) | Failover por maioria; primário para de escrever sem quórum; épocas | Escritas rejeitadas no lado minoritário |
| Chave quente | Um nó saturado | Cache L1, replicação da chave com sufixos, leitura nas réplicas | Desatualização, mais memória |
| Chave grande | Link de rede saturado; comandos lentos bloqueiam o nó | Dividir/comprimir; evitar comandos O(N) em estruturas grandes | Mais chaves para gerenciar |
| Estouro de manada na expiração | Milhares de faltas para uma chave | Leases/coalescência, renovação antecipada, jitter no TTL, servir o velho | Leve desatualização |
| Pressão de memória | Tempestades de despejo, fragmentação, swap | Folga (~70–80%), política certa, alertas de despejos e memória | Menos bytes usados por nó |

Os trade-offs para **dizer em voz alta**: **disponibilidade e velocidade acima de consistência** (um cache pode estar desatualizado ou perder escritas; o banco é a verdade), **memória vs. vazão** (dimensione pelos dois), e **distribuição equilibrada vs. chaves quentes** (o hash espalha chaves, não popularidade).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

Dois cenários cobrem as duas metades deste caso: o cache na frente de um banco, e o particionamento dos dados entre nós.

!!! tip "Experimente — cache na frente do banco"

    1. Rode o `read-heavy-cache` com o perfil **load** e anote a taxa de acerto, a utilização do banco e o p99.
    2. Baixe a taxa de acerto (ou diminua o cache) em 5 pontos e rode de novo: compare a mudança na carga do banco com a estimativa da seção 2.
    3. Ligue o caos para derrubar o cache (ou esvaziá-lo): veja o estouro de manada do cache frio no banco e quanto tempo o p99 leva para se recuperar.

<div class="sdp" data-scenario="read-heavy-cache" data-mode="full" data-height="640" data-profile="load"></div>

!!! tip "Experimente — partições e chaves quentes"

    1. Rode o `sharding` com o perfil **load** e compare a utilização entre as partições.
    2. Concentre o tráfego numa chave/partição (uma chave quente): um nó satura enquanto os outros ficam ociosos — mais partições não ajudam.
    3. Acrescente partições/nós com uma carga equilibrada e observe como a vazão escala; depois derrube um nó e veja para onde vai o seu tráfego.

<div class="sdp" data-scenario="sharding" data-mode="full" data-height="640" data-profile="load"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "Por que não usar simplesmente `hash(chave) % N`? É mais simples."

    Ele distribui bem as chaves enquanto N é fixo. No momento em que N muda — um nó falha, você escala para uma abertura de vendas — cerca de `1 - 1/N` das chaves mudam de dono (80% ao passar de 4 para 5 nós), o que equivale a esvaziar o cache no meio do pico. Hash consistente ou slots fixos movem só as chaves que precisam mudar (~`1/N`).

??? question "Um nó falha durante a abertura de vendas do BoxOffice. Descreva o que acontece."

    Os clientes recebem timeouts/erros de conexão para os slots daquele nó. O detector de falhas (a maioria dos nós ou dos Sentinels) o marca como falho depois de alguns segundos e promove sua réplica; os clientes descobrem o novo dono (redirecionamento ou configuração enviada) e seguem. Escritas confirmadas pelo primário antigo mas ainda não replicadas se perdem — inofensivo para um cache. Sem réplica, as chaves daquele nó seriam faltas até serem recarregadas; caches L1, coalescência de requisições e um banco com folga tornam esse pico suportável.

??? question "Como você mantém o cache consistente com o banco?"

    Você não o torna fortemente consistente — você **limita** a inconsistência. Cache-aside com: escreva no banco e depois **apague** a chave (não a atualize, para evitar que escritores concorrentes recoloquem um valor velho); um TTL como rede de segurança; e, para dados críticos, invalidação guiada por captura de mudanças (CDC) do log do banco. TTLs curtos para dados que mudam com frequência (disponibilidade de lugares), longos para os que raramente mudam (descrição dos locais).

??? question "LRU ou LFU?"

    LRU quando o uso recente prevê o uso futuro e a carga não tem grandes varreduras; LFU (com decaimento) quando a popularidade é estável e você precisa proteger o conjunto quente de tráfego avulso, como um crawler lendo cada página de evento uma vez. Caches modernos em processo usam W-TinyLFU, que combina uma pequena janela de recência com um filtro de admissão por frequência e é robusto aos dois casos. No Redis, `allkeys-lfu` ou `allkeys-lru` são as escolhas usuais para um cache puro.

??? question "Como você faria o cache sobreviver a um reinício do cluster inteiro sem martelar o banco?"

    Evite que ele fique frio: persista snapshots e recarregue-os ao iniciar (RDB do Redis), reinicie os nós um a um com as réplicas atendendo nesse meio-tempo, ou **aqueça** o cache a partir do banco com um job em segundo plano (as N chaves mais acessadas segundo os logs) antes de mandar tráfego. Limite a taxa das faltas que chegam ao banco durante o aquecimento.

??? question "Quando você não deveria acrescentar um cache?"

    Quando a taxa de acerto seria baixa (acesso aleatório uniforme num espaço de chaves enorme), quando os dados precisam ser fortemente consistentes em toda leitura, quando o banco já atende a carga com folga, ou quando a complexidade operacional acrescentada (bugs de invalidação, estouros de manada, um novo modo de falha) custa mais do que a latência que economiza. Meça primeiro ([engenharia de desempenho](../../performance/index.md)).

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Um mapa chave-valor em memória com get/set e TTL; vários nós com `hash % N`; despejo LRU. Não percebe o que acontece quando N muda. |
| **Pleno** | Hash consistente com nós virtuais (ou hash slots); escolhas de despejo e TTL; primário/réplica com failover; cache-aside e proteção contra estouro de manada; dimensionamento pela memória. |
| **Sênior** | Dimensiona por memória e ops/s e liga a taxa de acerto à carga no banco; explica quantitativamente o movimento de chaves e o equilíbrio de carga; perda na replicação assíncrona e split brain com failover por quórum; chaves quentes (L1, replicação da chave) e chaves grandes; opções de roteamento com trade-offs; leases/expiração antecipada; aquecimento e métricas operacionais; sabe quando um cache é a ferramenta errada. |

**Relacionados:** [Cache](../../caching/index.md), [Redis](../../caching/redis/index.md), [Modos de falha de cache](../../caching/failure-modes/index.md), [Particionamento](../../databases/partitioning/index.md), [Hands-on 5](../../../hands-on/5/index.md) (cache-aside com Redis, taxa de acerto e estouro de manada).

!!! success "Boas práticas"

    - **Defina `maxmemory` e a política de despejo explicitamente** — `allkeys-lru` para um cache; com `noeviction`, um cache cheio vira erros de escrita.
    - **Acrescente jitter a todo TTL** — chaves gravadas juntas não podem expirar juntas; o lab 5 acrescenta até 10% ([Cache — modos de falha](../../caching/failure-modes/index.md)).
    - **Acompanhe juntos a taxa de acerto, os despejos e a memória por nó** — despejos subindo com a taxa de acerto estável significam que o conjunto de trabalho está crescendo até o limite.
    - **Mantenha o cache opcional no caminho do código** — num erro do cache, leia da fonte; o lab 5 registra e conta um `BYPASS` ([lab 5](../../../hands-on/5/cache-aside/index.md)).
    - **Aqueça as chaves quentes antes de um pico conhecido** — a página do evento é carregada às 9h55, não pelo primeiro de 2 M de fãs às 10:00.

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["Distributed cache"]) --> EST["Estimation<br/>size by memory and ops/s"]:::tech
    CASE --> PART["Databases<br/>consistent hashing, virtual nodes"]:::tech
    CASE --> EVI["Caching<br/>eviction LRU, LFU, W-TinyLFU, TTL"]:::tech
    CASE --> REP["Databases<br/>async replication, failover"]:::tech
    CASE --> HOT["Caching<br/>hot keys, big keys, stampedes"]:::tech
    CASE --> ROUTE["routing<br/>cluster-aware client"]:::tech
    PART -.-> k1["cache (cluster)"]:::comp
    REP -.-> k2["sql · nosql<br/>(source of truth)"]:::comp
    ROUTE -.-> k3["app"]:::comp
    HOT -.-> k4["metrics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Caching — padrões](../../caching/patterns/index.md) · [Caching — Redis](../../caching/redis/index.md) · [Cache — modos de falha](../../caching/failure-modes/index.md) · [Bancos de dados — particionamento](../../databases/partitioning/index.md) · [Bancos de dados — replicação](../../databases/replication/index.md) · [Estimativas — números](../../estimation/numbers/index.md) · [Hands-on 5](../../../hands-on/5/index.md). **Componentes da paleta:** [`cache`](../../../reference/components/storage/index.md#cache) · [`app`](../../../reference/components/compute/index.md#app) · [`sql`](../../../reference/components/storage/index.md#sql) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`metrics`](../../../reference/components/observability/index.md#metrics). **Cenários:** `read-heavy-cache`, `sharding`.

---

## Referências { #references }

- KARGER, D. et al. *Consistent Hashing and Random Trees*[^1].
- DECANDIA, G. et al. *Dynamo: Amazon's Highly Available Key-value Store*[^2].
- NISHTALA, R. et al. *Scaling Memcache at Facebook* — leases, pools regionais, mcrouter[^3].
- EINZIGER, G.; FRIEDMAN, R.; MANES, B. *TinyLFU: A Highly Efficient Cache Admission Policy*[^4].
- XU, A. *System Design Interview*, vol. 1, cap. 5 "Design Consistent Hashing" e cap. 6 "Design a Key-Value Store"[^5]; especificação do Redis Cluster[^6].

[^1]: KARGER, D. et al. Consistent Hashing and Random Trees: Distributed Caching Protocols for Relieving Hot Spots on the World Wide Web. *Proceedings of the 29th ACM STOC*, 1997.
[^2]: DECANDIA, G. et al. [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf){target="_blank"}. *SOSP*, 2007.
[^3]: NISHTALA, R. et al. [Scaling Memcache at Facebook](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala){target="_blank"}. *USENIX NSDI*, 2013.
[^4]: EINZIGER, G.; FRIEDMAN, R.; MANES, B. TinyLFU: A Highly Efficient Cache Admission Policy. *ACM Transactions on Storage*, 13(4), 2017.
[^5]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^6]: [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/){target="_blank"}. Documentação do Redis.
