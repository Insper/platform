Um cache muda a forma como o sistema falha. Sem ele, o banco se degrada suavemente conforme a carga cresce. Com ele, o banco é dimensionado para as **faltas** — e qualquer coisa que de repente transforme acertos em faltas (um reinício, uma expiração, um novo tipo de requisição, a morte de um nó do cache) manda a carga inteira para um banco que nunca foi dimensionado para ela. A maioria dos incidentes de cache não são bugs no cache; são o momento em que o sistema descobre quanto dependia dele.

Esta página percorre os modos de falha clássicos na ordem em que costumam aparecer numa venda relâmpago, cada um com seu sintoma e sua correção.

| Falha | O que acontece | Principal correção |
|---|---|---|
| [Cache frio](#cold-cache) | cache vazio depois de reinício ou deploy | aquecimento, deslocamento gradual do tráfego |
| [*Stampede*](#stampede) | uma chave quente expira; milhares a recalculam ao mesmo tempo | lock/lease, agrupamento, stale-while-revalidate, XFetch |
| [Avalanche](#avalanche) | muitas chaves expiram no mesmo instante | jitter no TTL |
| [Penetração](#penetration) | requisições para chaves que nunca existem | cache negativo, filtro de Bloom, validação |
| [Chave quente](#hot-keys) | uma chave sobrecarrega um nó do cache | cache L1 local, replicação da chave |
| [Chave grande](#big-keys) | valores enormes bloqueiam o cache | dividir, comprimir, `UNLINK` |
| [Cache fora do ar](#cache-down) | o cluster de cache falha | timeouts, fallback com descarte de carga, réplicas, gutter pool |
| [Pressão de memória](#memory) | despejos e fragmentação | dimensionamento, instâncias separadas, política de despejo |

---

## Cache frio { #cold-cache }

Um **cache frio** é um cache vazio: depois de reiniciar um Redis sem persistência, de um deploy que muda a versão da chave (`:v3` → `:v4`), de uma nova região, ou de um nó substituído pelo autoscaling. A taxa de acerto começa em zero e sobe conforme as chaves são lidas.

O perigo é a distância entre a carga para a qual o banco foi dimensionado (as faltas) e a carga que ele recebe (tudo). Com 50.000 leituras/s e uma taxa de acerto habitual de 98%, o banco está dimensionado para ~1.000 QPS; um início a frio manda 50.000.

??? question "Pense antes: qual o momento mais seguro para publicar uma nova versão de chave do cache?"

    A BoxOffice precisa mudar o formato do evento cacheado (`:v3` → `:v4`). A versão fica pronta às 9h30; a abertura de vendas do estádio começa às 10h00.

    Não às 9h30. Uma nova versão de chave é um cache frio para todos os eventos, e o momento mais quente do mês está a meia hora de distância. Publique depois do pico da abertura (ou antes, com aquecimento e tempo suficiente para verificar a taxa de acerto). De forma geral: **agende deploys que invalidam o cache fora dos picos conhecidos**, e faça-os de forma gradual para que as versões antiga e nova aqueçam em paralelo.

Correções:

- **Aquecimento** (*warm-up*): antes de um pico conhecido, pré-carregue as chaves que você sabe que serão quentes — os eventos que abrem vendas hoje, as listas da home — com um job que as lê pelo caminho normal.
- **Deslocamento gradual do tráfego**: mande 5%, depois 25%, depois 100% do tráfego para um novo nó de cache ou região (canário), para que ele aqueça com uma fração da carga.
- **Persistência para caches grandes**: um Redis que reinicia recarregando um snapshot RDB volta aquecido ([Redis — persistência](../redis/index.md#persistence)).
- **Nunca reinicie todos os nós do cache ao mesmo tempo.**
- **Piso de capacidade**: saiba quantos QPS o banco aguenta com o cache vazio e proteja-o com descarte de carga (veja [cache fora do ar](#cache-down)). O livro de SRE do Google lista caches frios entre os gatilhos clássicos de falhas em cascata[^1].

---

## *Stampede* de cache { #stampede }

Um ***stampede* de cache** (também *thundering herd* ou *dog-piling*) acontece quando uma chave **quente** expira ou é removida. Toda requisição que chega antes de alguém recolocar o valor erra — e cada uma vai ao banco recalcular o *mesmo* valor.

``` mermaid-sim
sequenceDiagram
    participant A as 4.000 requisições
    participant R as Redis
    participant D as PostgreSQL
    Note over R: event:42 expira às 10:00:00.000
    A->>R: GET event:42 (×4.000 em 200 ms)
    R-->>A: falta (×4.000)
    A->>D: o mesmo SELECT (×4.000)
    Note over D: CPU 100%, consulta de 3 ms para 2 s
    D-->>A: linhas, devagar
    A->>R: SET event:42 (×4.000, todos iguais)
```

A conta é a lei de Little. Se o evento 42 é lido **20.000 vezes por segundo** e recalculá-lo leva **200 ms**, cerca de $20{.}000 \times 0{,}2 = 4{.}000$ requisições erram antes de a primeira terminar. Pior: sob essa carga a consulta fica mais lenta, a janela cresce e mais requisições se acumulam. Um *stampede* pode derrubar um banco que servia a mesma página tranquilamente um segundo antes.

Há quatro correções padrão. Elas se complementam.

### 1. Lock (ou lease): só um recalcula

Numa falta, a requisição tenta adquirir um lock curto para a chave. A vencedora recalcula; as outras esperam alguns milissegundos e leem o cache de novo (ou servem uma cópia velha).

```python title="catalog/stampede_lock.py"
import json
import time
import uuid

RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


def get_event(event_id: int, db, r) -> dict:
    key = f"boxoffice:catalog:event:{event_id}:v3"
    lock = f"lock:{key}"
    for _ in range(50):                                   # wait at most ~1 s
        cached = r.get(key)
        if cached is not None:
            return json.loads(cached)
        token = str(uuid.uuid4())
        if r.set(lock, token, nx=True, px=5_000):          # only one winner
            try:
                event = db.fetch_event_with_venue_and_prices(event_id)
                r.set(key, json.dumps(event), ex=300)
                return event
            finally:
                r.eval(RELEASE, 1, lock, token)             # release only our own lock
        time.sleep(0.02)                                    # losers wait and re-read
    return db.fetch_event_with_venue_and_prices(event_id)   # last resort
```

- `SET ... NX PX 5000` é atômico: grava só se não existir, com expiração de 5 s para que uma vencedora que caiu não bloqueie a chave para sempre.
- A liberação confere o token, para que uma vencedora lenta cujo lock já expirou não apague o lock de outra.
- Custo: as perdedoras esperam (latência) e consultam o cache repetidamente. Os **leases** do memcache do Facebook são uma versão refinada disso, embutida no servidor de cache[^2].

### 2. Agrupamento de requisições (single-flight)

Dentro de um processo, faltas concorrentes na mesma chave podem compartilhar **um único** cálculo em andamento: a primeira chamada o inicia, as outras esperam o mesmo *future*. O `LoadingCache` e o `AsyncLoadingCache` do Caffeine fazem isso automaticamente; o Go tem o `singleflight`; em Java você pode usar um `ConcurrentHashMap<Key, CompletableFuture<V>>`.

O agrupamento não precisa do Redis: com 20 réplicas, um *stampede* de 4.000 requisições vira **20** consultas ao banco — em geral inofensivas. É a correção mais barata e deveria ser o padrão nos caminhos quentes.

### 3. Stale-while-revalidate

Mantenha duas expirações: um **TTL suave** guardado dentro do valor (por exemplo, 60 s) e um **TTL rígido** mais longo na chave (por exemplo, 10 min). Depois do TTL suave, o primeiro leitor dispara uma atualização em segundo plano (protegida por um lock) e *todos*, inclusive esse leitor, continuam recebendo o valor velho até o novo chegar. Ninguém espera; o banco vê uma consulta. A mesma ideia existe no HTTP como `Cache-Control: max-age=60, stale-while-revalidate=600`.

### 4. Expiração antecipada probabilística (XFetch) { #xfetch }

Em vez de um lock, deixe cada leitor decidir **ao acaso** atualizar o valor *um pouco antes* de ele expirar, com uma probabilidade que cresce conforme a expiração se aproxima. Vattani, Chierichetti e Lowenstein mostraram que a regra a seguir é ótima num sentido preciso[^3]. Guarde com o valor o tempo $\delta$ que ele levou para ser calculado e o instante de expiração; a cada leitura, recalcule se

$$
t_{\text{now}} - \delta \cdot \beta \cdot \ln(u) \;\geq\; t_{\text{expiry}}, \qquad u \sim \text{Uniform}(0, 1]
$$

Como $-\ln u$ é uma variável aleatória exponencial de média 1, cada leitura "olha à frente" por um tempo aleatório de cerca de $\delta \beta$. O parâmetro $\beta$ (padrão 1) troca atualizações mais cedo por menos *stampedes*. A probabilidade de uma única leitura atualizar, com $r$ segundos até a expiração, é $e^{-r/(\delta \beta)}$.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

delta = 0.2                                   # seconds to recompute the value
remaining = np.linspace(0, 3, 300)            # seconds left before the TTL expires
rates = np.logspace(-1, 3, 300)               # reads per second on the key
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
fig.patch.set_alpha(0)
for beta, c in [(0.5, "#4e79a7"), (1.0, "#59a14f"), (2.0, "#e15759")]:
    # XFetch: a read refreshes early when delta * beta * (-ln U) >= time left, U ~ Uniform(0, 1]
    p = np.exp(-remaining / (delta * beta))
    ax1.plot(remaining, p * 100, color=c, lw=2, label=f"beta = {beta}")
    # with Poisson reads at a given rate, the chance that NO read refreshed early
    p_expire = np.exp(-rates * delta * beta)
    ax2.plot(rates, p_expire * 100, color=c, lw=2, label=f"beta = {beta}")
ax1.invert_xaxis()
ax1.set_xlabel("time left before expiry (s)")
ax1.set_ylabel("P(this read refreshes early) (%)")
ax1.set_title("One read, recompute time = 200 ms")
ax2.set_xscale("log")
ax2.set_xlabel("reads per second on the key (log scale)")
ax2.set_ylabel("P(key reaches expiry unrefreshed) (%)")
ax2.set_title("Hot keys are refreshed early; cold keys just expire")
for ax in (ax1, ax2):
    ax.set_facecolor("none")
    ax.grid(True, alpha=0.25)
    ax.title.set_color("#888")
    ax.xaxis.label.set_color("#888")
    ax.yaxis.label.set_color("#888")
    ax.tick_params(colors="#888")
    for sp in ax.spines.values():
        sp.set_color("#888")
    leg = ax.legend(frameon=False)
    for t in leg.get_texts():
        t.set_color("#888")

plt.tight_layout()
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

O painel da direita é a parte elegante. Se as leituras chegam a uma taxa $\lambda$, a probabilidade de *ninguém* ter atualizado antes da expiração é $e^{-\lambda \delta \beta}$. Uma chave quente (centenas de leituras por segundo) é quase certamente atualizada pouco antes de expirar — por **um** leitor, sem lock e sem coordenação — enquanto uma chave fria, em que um *stampede* não acontece mesmo, simplesmente expira. O algoritmo se adapta sozinho ao tráfego.

```python title="catalog/xfetch.py"
import json
import math
import random
import time


def xfetch(r, key: str, recompute, ttl: int = 300, beta: float = 1.0):
    entry = r.hgetall(key)                     # {"data": ..., "delta": ..., "expiry": ...}
    now = time.time()
    if entry:
        delta, expiry = float(entry["delta"]), float(entry["expiry"])
        u = 1.0 - random.random()              # in (0, 1], so log(u) is defined
        if now - delta * beta * math.log(u) < expiry:
            return json.loads(entry["data"])   # serve the cached value
    start = time.time()
    value = recompute()                        # miss, or chosen to refresh early
    delta = time.time() - start
    r.hset(key, mapping={"data": json.dumps(value), "delta": delta, "expiry": start + ttl})
    r.expire(key, ttl)
    return value
```

| Correção | Leitores esperam? | Consultas ao banco por expiração | Complexidade | Melhor para |
|---|---|---|---|---|
| Lock / lease | sim (as perdedoras) | 1 | média | qualquer chave quente compartilhada |
| Agrupamento | sim, por processo | 1 por réplica | baixa (biblioteca) | sempre, como base |
| Stale-while-revalidate | não | 1 | média | dados que toleram segundos de defasagem |
| XFetch | não | ~1 | baixa | chaves quentes com custo de recálculo conhecido |

---

## Avalanche de cache { #avalanche }

Uma **avalanche de cache** é um *stampede* em muitas chaves ao mesmo tempo: um grande conjunto de chaves expira no mesmo instante, ou o cache é esvaziado, e as faltas de todas elas atingem o banco juntas.

!!! example "BoxOffice: o aquecimento que causou a queda"

    Para preparar a abertura das 10h00, um job aquece o cache às **9h50** com as 5.000 páginas mais quentes, todas com `TTL = 600 s`. Todas expiram às **10:00:00** — o exato instante em que 2 milhões de fãs apertam F5. O aquecimento deixou as coisas piores do que nenhum aquecimento.

A correção é o **jitter**: acrescente um componente aleatório a cada TTL, por exemplo `ttl = 600 + random(0, 120)`, para que as expirações se espalhem por dois minutos. Combine com refresh-ahead ou XFetch para as chaves mais quentes, e com proteção contra *stampede* para cada chave individual.

---

## Penetração de cache { #penetration }

A **penetração de cache** é o tráfego para chaves que **não existem** no banco. Elas nunca são cacheadas (não há o que cachear), então toda requisição passa até o banco. Um bot enumerando `GET /events/1`, `/events/2`, …, `/events/99999999`, ou um cliente com bug pedindo um id que foi apagado, pode gerar uma consulta ao banco por requisição, na taxa do cache.

Correções, em camadas:

1. **Valide a entrada** antes de tocar em qualquer coisa: ids malformados ou fora da faixa são rejeitados no gateway.
2. **Cache negativo**: cacheie "não encontrado" com TTL curto (por exemplo, 30–60 s) — veja [padrões](../patterns/index.md).
3. **Filtro de Bloom** dos ids existentes: um conjunto probabilístico compacto que responde "com certeza não está" ou "provavelmente está". Uma requisição para um id que o filtro diz estar ausente nunca chega ao cache nem ao banco. Dimensionamento: cerca de $-\ln p / (\ln 2)^2 \approx 9{,}6$ bits por elemento para 1% de falsos positivos — **~120 KB** para 100.000 eventos[^4]. O Redis Stack / Redis 8 oferecem filtros de Bloom nativamente (`BF.ADD`, `BF.EXISTS`).
4. **Rate limiting e mitigação de bots** na borda (WAF), já que a penetração costuma ser abuso ([Tráfego e Borda](../../edge/api-gateway/index.md)).

---

## Chaves quentes { #hot-keys }

Um cache distribuído espalha as chaves pelos nós, mas **uma chave vive em um nó**. Quando uma única chave é extremamente popular, esse nó satura enquanto o resto do cluster fica ocioso.

!!! example "BoxOffice: uma chave, um nó"

    *Números ilustrativos:* 2 milhões de fãs recarregam a página do evento mais ou menos a cada 5 segundos → **400.000 leituras/s** de `event:42`. O valor cacheado tem 4 KB. Num único nó Redis isso dá 400.000 × 4 KB ≈ **1,6 GB/s ≈ 13 Gbit/s** de tráfego de saída — mais que uma interface de rede de 10 Gbit/s — além de muito mais comandos do que a thread principal de um nó aguenta com folga. Acrescentar nós ao cluster não adianta nada: a chave continua morando em um deles.

Correções:

- **Cache L1 em processo** com TTL curto (1–2 s) em cada réplica do `catalog` ([cache em dois níveis](../patterns/index.md#two-level)). Com 50 réplicas e TTL de 1 s, o Redis vê ~50 leituras/s dessa chave em vez de 400.000. É de longe a correção mais eficaz.
- **Replicação da chave**: guarde N cópias com chaves diferentes (`event:42#0` … `event:42#7`), que caem em nós diferentes; os leitores escolhem uma ao acaso. Escritas e invalidações precisam tocar as N cópias.
- **Réplicas de leitura** do shard do cache (réplicas do Redis com leituras `READONLY` no Cluster), aceitando leituras um pouco mais defasadas.
- **Diminua o valor**: mande a parte estática (descrição, imagens) pela CDN e cacheie só a pequena parte dinâmica.
- **Cacheie mais acima**: a página pública do evento pode ser cacheada na CDN ou no gateway por alguns segundos, de modo que a chave quente nunca chegue à aplicação.

Detectando chaves quentes: métricas no cliente por prefixo de chave, `redis-cli --hotkeys` (exige uma política de despejo LFU), ou o comando `MONITOR` numa réplica por alguns segundos (nunca num primário ocupado).

---

## Chaves grandes { #big-keys }

Uma **chave grande** é um valor de megabytes, ou uma coleção (hash, lista, set, sorted set) com milhões de membros. O Redis executa os comandos numa única thread principal, então ler, escrever, expirar ou apagar uma chave grande **bloqueia todos os outros clientes** durante a operação; transferi-la satura a rede.

- Encontre-as com `redis-cli --bigkeys` ou `MEMORY USAGE chave`.
- **Divida** objetos grandes (uma chave por setor em vez de uma por local), **pagine** coleções (`HSCAN`, `ZRANGE ... LIMIT`), **comprima** valores acima de alguns KB.
- Apague com `UNLINK` (libera a memória numa thread em segundo plano) em vez de `DEL`.
- Mantenha os valores pequenos — uma orientação comum é ficar bem abaixo de 100 KB por valor e evitar coleções com mais de ~10.000 elementos; trate isso como regra prática, não como limite.

---

## O cache cai { #cache-down }

Mais cedo ou mais tarde, o primário do Redis falha, a rede se particiona ou um failover leva de 10 a 30 segundos. O que acontece depois depende de decisões tomadas muito antes:

``` mermaid-sim
flowchart TD
    F["Redis indisponível"] --> T{"As chamadas ao cache têm<br/>timeout curto?"}
    T -->|"não"| X1["threads bloqueiam no Redis<br/>o serviço inteiro trava"]
    T -->|"sim"| B{"Há fallback no erro?"}
    B -->|"não"| X2["toda leitura falha<br/>indisponibilidade"]
    B -->|"lê o banco"| C{"O banco aguenta<br/>a carga inteira?"}
    C -->|"sim"| OK1["mais lento, mas correto"]
    C -->|"não"| S["descartar carga e servir degradado:<br/>página estática, sala de espera,<br/>faltas com limite de taxa"]
```

A verdade incômoda: **depois que o banco é dimensionado para as faltas, o cache deixa de ser opcional**. Ele é uma dependência que sustenta carga, e precisa da mesma engenharia de confiabilidade que o banco:

- **Timeouts** em toda chamada ao cache (dezenas de milissegundos, não o padrão do cliente) e um **circuit breaker**, para que um cache doente falhe rápido em vez de prender threads ([Confiabilidade](../../reliability/patterns/index.md)).
- **Replicação com failover automático** (Redis Sentinel ou Cluster; serviços gerenciados fazem isso por você) — veja [Redis](../redis/index.md#replication).
- **Fallback protegido**: recorrer ao banco a *cada* falta durante uma queda é um *stampede* autoinfligido. Limite as consultas de fallback concorrentes (um bulkhead), sirva conteúdo degradado para as partes não essenciais e coloque a sala de espera na frente da abertura de vendas.
- **Gutter pool**: o Facebook mantém um pequeno conjunto de servidores de cache ociosos; quando um servidor falha, os clientes mandam as chaves dele para o *gutter pool* (com TTLs curtos) em vez de para o banco[^2].
- **Conheça o número**: teste quanto o banco aguenta com o cache desligado. Esse número é o seu verdadeiro piso de capacidade.

---

## Pressão de memória, despejos e failovers defasados { #memory }

- **Tempestades de despejo**: quando o conjunto de trabalho passa do `maxmemory`, o cache despeja chaves que serão necessárias de novo; a taxa de acerto cai, a carga no banco sobe. Acompanhe `evicted_keys` e a taxa de acerto juntos.
- **Fragmentação**: a memória usada pelo processo pode passar do tamanho dos dados (`mem_fragmentation_ratio` no `INFO memory`); deixe folga.
- **Fork do snapshot**: um snapshot RDB ou uma reescrita do AOF fazem *fork* do processo; com copy-on-write, uma instância com muitas escritas pode precisar de até o dobro da memória durante o snapshot. Dimensione para isso, ou rode a persistência numa réplica.
- **Dados velhos depois do failover**: a replicação do Redis é assíncrona. Se o primário confirmou um `DEL` e falhou antes de replicá-lo, a réplica promovida ainda tem o valor antigo — invalidações podem se perder. Mais um motivo para toda chave ter TTL.

---

## Veja no playground

Experimente: este cenário roda o desenho `read-heavy-cache` sob um **pico** (*spike*). Primeiro observe o estado estável: taxa de acerto, QPS do banco e p99. Depois (1) esvazie o cache no pico e veja a carga do banco saltar para a taxa total de requisições — um cache frio sob carga; (2) encurte o TTL das chaves quentes e procure picos de *stampede* no QPS do banco a cada expiração; (3) ative o caos e veja o que acontece com o p99 enquanto o cache está indisponível.

<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="520" data-profile="spike"></div>

O [playground completo](../../../../playground/index.md) permite acrescentar uma segunda camada de cache ou uma sala de espera e comparar.

!!! example "BoxOffice: uma abertura de vendas, minuto a minuto"

    | Hora | Evento | Modo de falha evitado |
    |---|---|---|
    | 9h30 | nenhum deploy que invalide o cache até as 11h00 | cache frio |
    | 9h45 | job de aquecimento carrega os eventos que abrem vendas hoje, TTL 600 s **+ jitter 0–120 s** | cache frio, avalanche |
    | 9h59 | 2 M fãs na página do evento; o `catalog` a serve de um cache L1 de 1 s em cada réplica | chave quente |
    | 10h00 | a tabela de preços é editada; remoção depois do commit, o CDC difunde para os caches L1 | dado velho |
    | 10h02 | `event:42` atinge o TTL suave; uma réplica o atualiza em segundo plano, as outras servem o valor velho | *stampede* |
    | 10h05 | bots sondam `/events/<id aleatório>`; o WAF limita a taxa, o filtro de Bloom e o cache negativo absorvem o resto | penetração |
    | 10h11 | o primário do Redis falha; failover em 15 s; chamadas ao cache dão timeout em 50 ms; o circuit breaker abre; as faltas ficam limitadas a 2.000 QPS, o restante vê a sala de espera | cache fora do ar |

!!! tip "Na entrevista"

    Depois que você desenha um cache, o entrevistador muitas vezes pergunta "o que acontece quando uma chave quente expira?" ou "e se o Redis cair?". Dê nome à falha (*stampede*, avalanche, chave quente, penetração), o número que a torna perigosa (lei de Little: leituras/s × tempo de recálculo) e a correção (agrupamento ou lock, jitter no TTL, cache L1, cache negativo / filtro de Bloom). Para "o Redis caiu", diga que o banco está dimensionado para as faltas, então você precisa de timeouts, circuit breaker e descarte de carga — não de um fallback ingênuo.

!!! warning "Armadilhas comuns"

    - **Aquecimentos com TTLs idênticos** — eles agendam uma avalanche.
    - **Locks sem expiração** — uma vencedora que caiu bloqueia a chave para sempre. Sempre `PX`.
    - **Fallback para o banco a cada erro do cache** — uma queda do cache vira uma queda do banco.
    - **Timeouts padrão do cliente** (segundos) nas chamadas ao cache — um Redis lento trava todas as threads.
    - **Ignorar chaves que não existem** — os bots vão encontrá-las.
    - **Escalar o cluster para resolver uma chave quente** — a chave continua morando num nó só.
    - **`DEL` de uma coleção enorme, `KEYS *`, `MONITOR` no primário** — bloqueiam a única thread principal.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    COLD["cache frio<br/>aquecer antes do tráfego"] --> DB["o banco recebe os misses"]
    STAMP["stampede: uma chave quente expira<br/>leituras/s × tempo de recálculo"] --> FIX["lock, coalescing,<br/>stale-while-revalidate, XFetch"]
    AVA["avalanche: muitas chaves<br/>expiram juntas"] --> JIT["jitter no TTL"]
    PEN["penetração: chaves<br/>que nunca existem"] --> NEG["cache negativo,<br/>filtro de Bloom"]
    HOT["chave quente: um nó"] --> L1["L1, cópias da chave, CDN<br/>→ Padrões, Borda"]
    DOWN["o cache cai"] --> RES["timeouts, circuit breaker,<br/>bulkhead → Confiabilidade"]
    DOWN --> DB
    DB --> SHED["descartar carga, sala de espera<br/>→ Mensageria"]
```

**Componentes da paleta:** [`cache`](../../../reference/components/storage/index.md#cache) (uma dependência estrutural quando o banco é dimensionado para os misses) · [`sql`](../../../reference/components/storage/index.md#sql) (o que ele aguenta com o cache desligado é o verdadeiro piso de capacidade) · [`app`](../../../reference/components/compute/index.md#app) (single-flight, um L1, timeouts curtos no cache) · [`cdn`](../../../reference/components/edge/index.md#cdn) · [`apigw`](../../../reference/components/edge/index.md#apigw) (cachear a página pública quente mais acima) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sala de espera quando o fallback afogaria o banco) · [`metrics`](../../../reference/components/observability/index.md#metrics) (taxa de acerto, `evicted_keys`). **Cenários:** `read-heavy-cache`, `flash-sale`, `cascading-failure`. **Continua em:** [Redis — replicação](../redis/index.md#replication), [Confiabilidade — circuit breaker](../../reliability/patterns/index.md#circuit-breaker), [Estimativa — filas](../../estimation/queueing/index.md) (lei de Little), [Estudo de caso: cache distribuído](../../case-studies/distributed-cache/index.md), [Hands-on 5](../../../hands-on/5/index.md) (reproduzir e corrigir um stampede).

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/addressing-cascading-failures/){target="_blank"}, capítulo 22, "Addressing Cascading Failures". O'Reilly, 2016.
[^2]: NISHTALA, R. et al. Scaling Memcache at Facebook. *USENIX NSDI*, 2013. Leases (§3.2.1) e gutter pools (§3.3).
[^3]: VATTANI, A.; CHIERICHETTI, F.; LOWENSTEIN, K. Optimal Probabilistic Cache Stampede Prevention. *Proceedings of the VLDB Endowment*, v. 8, n. 8, 2015.
[^4]: BLOOM, B. H. Space/Time Trade-offs in Hash Coding with Allowable Errors. *Communications of the ACM*, v. 13, n. 7, 1970.
