> "There are only two hard things in Computer Science: cache invalidation and naming things." ("Só existem duas coisas difíceis em Ciência da Computação: invalidação de cache e dar nomes às coisas.") — Phil Karlton[^1]

Preencher um cache é fácil. O difícil é saber **quando uma cópia deixou de ser verdade**. O banco muda; a cópia no Redis, em vinte JVMs, numa CDN e em um milhão de navegadores não fica sabendo. Todo desenho de cache é, no fundo, uma resposta a duas perguntas:

1. **Quão defasado cada dado pode estar?** (o *orçamento de defasagem*)
2. **Como uma mudança na fonte chega a todas as cópias dentro desse orçamento?** (o *mecanismo de invalidação*)

E como a memória é finita, vem uma terceira pergunta: **quando o cache enche, o que jogamos fora?** (a *política de despejo*). Esta página trata das três.

---

## O orçamento de defasagem

Antes de escolher um mecanismo, decida — com o time de produto, não sozinho — quão errado cada tipo de dado pode estar, e por quanto tempo. A resposta é diferente para cada entidade.

!!! example "BoxOffice: orçamento de defasagem por tipo de dado"

    | Dado | Muda | Defasagem aceitável | Mecanismo | Por quê |
    |---|---|---|---|---|
    | Descrição, imagens, line-up do evento | raramente (edições do organizador) | ~1 minuto | remoção na escrita + TTL 5 min | a correção de um erro de digitação pode levar um minuto para aparecer |
    | Geometria do local | quase nunca | horas | TTL 1 h + chave versionada na mudança | imutável na prática |
    | Tabela de preços | preço dinâmico, durante as vendas | **segundos** | TTL 30 s + remoção na escrita; preço relido do banco no checkout | exibir um preço antigo é tolerável; *cobrar* não é |
    | Mapa de assentos (exibição) | a cada reserva e venda | 1–2 s | TTL 1 s, ou sem cache | um mapa defasado só causa "lugar não disponível" |
    | Contador de disponibilidade ("restam 1.203") | a cada venda | alguns segundos | TTL 2 s | aproximado basta para exibição |
    | Perfil do usuário | raramente | ~1 minuto, mas **read-your-writes** para o dono | remoção na escrita; leituras do dono ignoram o cache por um instante | o usuário precisa ver a própria edição |
    | Sessão | no login/logout | **nenhuma** (o logout tem que funcionar) | gravada no Redis como fonte da verdade das sessões, não como cache | segurança |
    | Reserva de assento, pedido, pagamento | — | **zero** | não cacheado | correção |

Escrever essa tabela é metade do desenho: quando cada linha tem um orçamento, o mecanismo decorre dele.

---

## TTL: a rede de segurança

Um **TTL** (*time to live*, tempo de vida) faz cada entrada expirar depois de um tempo fixo. É o mecanismo mais simples e o que você deve ter **sempre**, mesmo quando também invalida explicitamente — porque a invalidação explícita, em algum momento, vai deixar algo passar (um bug, uma correção manual em SQL, um processo que caiu entre o commit e a remoção), e o TTL limita quanto tempo o erro vive.

Escolher o TTL é um compromisso entre atualidade e taxa de acerto:

- **Longo demais**: dados velhos vivem muito depois de uma mudança.
- **Curto demais**: a cauda longa de chaves sempre erra (uma chave lida uma vez a cada 10 minutos nunca acerta com TTL de 60 s), e chaves quentes expiram com frequência, o que arrisca um [*stampede*](../failure-modes/index.md#stampede).

Regras práticas:

- Parta do orçamento de defasagem: TTL ≤ orçamento quando não há invalidação explícita; TTL = algumas vezes o orçamento quando há (o TTL então só limita o estrago de uma invalidação perdida).
- **Acrescente jitter** — `TTL = base ± 10%` — para que chaves escritas juntas não expirem juntas ([avalanche de cache](../failure-modes/index.md#avalanche)).
- **Expiração absoluta vs. deslizante**: um TTL absoluto expira um tempo fixo depois da escrita; um *deslizante* é estendido a cada leitura (`GETEX chave EX 300` no Redis). A expiração deslizante mantém chaves quentes para sempre — bom para sessões, perigoso para dados que mudam, já que uma chave quente desatualizada pode nunca ser renovada.

---

## Invalidação explícita

Para ter atualidade melhor que o TTL, o código que escreve no banco também avisa o cache de que o valor mudou. Duas decisões importam: **remover ou atualizar**, e **em que ordem**.

### Remova, não atualize { #delete-vs-update }

Quando o evento muda, o escritor pode **atualizar** o cache com o valor novo ou **remover** a chave e deixar a próxima leitura preenchê-la. Remover é mais seguro. Considere dois organizadores editando o evento 42 ao mesmo tempo:

``` mermaid-sim
sequenceDiagram
    participant W1 as Escritor 1
    participant W2 as Escritor 2
    participant D as PostgreSQL
    participant R as Redis
    W1->>D: UPDATE preço = 100
    W2->>D: UPDATE preço = 120
    W2->>R: SET event:42 preço 120
    W1->>R: SET event:42 preço 100
    Note over D,R: o banco diz 120, o cache diz 100 até o TTL expirar
```

As escritas chegaram ao banco numa ordem e ao cache na outra. Com **remoção**, os dois escritores enviam `DEL event:42`: as operações são idempotentes e a ordem não importa; o próximo leitor carrega 120 do banco. Atualizar o cache também é desperdício quando o valor é escrito mais vezes do que é lido.

### Escreva primeiro, depois remova

| Ordem | O que pode dar errado |
|---|---|
| Remover do cache → escrever no banco | entre as duas, um leitor erra, lê a linha **antiga** e a coloca de volta. O cache fica velho até o TTL. **Evite.** |
| Escrever no banco → remover do cache (depois do commit) | sobra uma corrida estreita (próxima seção), mas esta é a escolha padrão |
| Escrever no banco → atualizar o cache | escritores concorrentes podem se reordenar (acima) |
| Escrever no banco, remover **dentro** da transação | a remoção pode acontecer antes de o commit ficar visível; um leitor recoloca o valor antigo. Remova **depois do commit**. |

### A corrida do cache-aside { #race }

Mesmo "escrever no banco e remover depois do commit" deixa uma corrida. Ela precisa de um leitor lento:

``` mermaid-sim
sequenceDiagram
    participant Rd as Leitor
    participant R as Redis
    participant D as PostgreSQL
    participant W as Escritor
    Rd->>R: GET event:42
    R-->>Rd: falta
    Rd->>D: SELECT evento 42
    D-->>Rd: linha antiga v1
    Note over Rd: o leitor pausa (GC, rede lenta)
    W->>D: UPDATE evento 42 para v2 e COMMIT
    W->>R: DEL event:42
    Rd->>R: SET event:42 v1
    Note over R: o v1 velho fica até o TTL expirar
```

O leitor leu antes da escrita e gravou depois da remoção. É raro — o leitor precisa ser mais lento que uma escrita inteira mais uma remoção — mas a dezenas de milhares de leituras por segundo, coisas raras acontecem todo dia. As correções, da mais simples à mais robusta:

1. **Um TTL como rede de segurança** — limita o estrago. Para a maioria dos dados, basta.
2. **Remoção dupla atrasada** (*delayed double delete*) — o escritor remove e remove de novo pouco depois (por exemplo, 500 ms, mais que uma leitura típica). A segunda remoção apaga o que um leitor lento recolocou. Barato, mas probabilístico.
3. **Valores versionados** — guarde a versão da linha junto com o valor e só escreva no cache se a versão for mais nova que a que está lá. Como as versões vêm do banco (coluna `version`, ou o LSN do commit), um leitor lento com `v1` não consegue sobrescrever `v2`. Com versões, *atualizar* na escrita também passa a ser seguro.
4. **Leases** — numa falta, o cache entrega ao leitor um **token de lease**; uma remoção invalida os tokens pendentes, e um `SET` com token inválido é rejeitado. O memcache do Facebook usa leases tanto para essa corrida quanto para limitar *stampedes* (um só lease por chave a cada poucos segundos)[^2].

```lua title="set_if_newer.lua — versioned set in Redis"
-- KEYS[1] = cache key; ARGV[1] = version; ARGV[2] = value; ARGV[3] = TTL in seconds
local current = redis.call('HGET', KEYS[1], 'version')
if current and tonumber(current) >= tonumber(ARGV[1]) then
  return 0                       -- a newer (or equal) version is already cached
end
redis.call('HSET', KEYS[1], 'version', ARGV[1], 'data', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
```

O script executa de forma atômica dentro do Redis ([Redis — atomicidade](../redis/index.md#atomicity)), então a comparação e a escrita não podem se intercalar com outro escritor.

---

## Invalidação a partir do log do banco (CDC) { #cdc }

A invalidação no código da aplicação tem uma fraqueza estrutural: só cobre as escritas que passam por *aquele* código. Um job em lote, outro serviço, uma migração ou um DBA corrigindo uma linha à mão vão mudar o banco sem remover nada.

A **captura de mudanças de dados** (*change data capture*, CDC) leva a invalidação para a fonte: um conector lê o log de replicação do banco (o *write-ahead log*, WAL, do PostgreSQL) e publica cada mudança confirmada como um evento. Um invalidador consome os eventos e remove as chaves afetadas.

``` mermaid-sim
flowchart LR
    APP["serviço catalog"] -->|"UPDATE events"| DB[("PostgreSQL")]
    ADM["script de admin"] -->|"UPDATE events"| DB
    DB -->|"WAL"| DBZ["Debezium<br/>conector CDC"]
    DBZ -->|"evento de mudança<br/>events id=42"| K[["tópico Kafka<br/>catalog.events"]]
    K --> INV["invalidador de cache"]
    INV -->|"DEL event:42"| R[("Redis")]
    INV -->|"publica invalidar 42"| PS(("pub/sub<br/>caches L1"))
```

- **Completo**: toda mudança confirmada é vista, não importa quem a escreveu; mudanças não confirmadas nunca são.
- **Ordenado por chave**: o log está na ordem dos commits, então as invalidações não podem ser reordenadas (com o Kafka particionado por chave).
- **Desacoplado**: o escritor não sabe quais caches existem.
- **Custos**: um pipeline a mais para operar (Debezium, Kafka); a invalidação fica atrás do commit por milissegundos a segundos; ainda precisa de TTL caso o pipeline pare.

CDC e o padrão outbox são tratados em [Mensageria](../../messaging/patterns/index.md).

### Invalidando muitas cópias

Um valor pode estar cacheado em vários lugares ao mesmo tempo. Cada um precisa do seu mecanismo:

| Cópia | Como invalidar | Observações |
|---|---|---|
| Redis (compartilhado) | `DEL chave` | uma chamada alcança todos os leitores |
| L1 em processo em cada réplica | difusão por pub/sub (`PUBLISH` do Redis, Kafka) ou client-side caching do Redis (`CLIENT TRACKING`); ou um TTL bem curto | uma réplica que perde a mensagem fica desatualizada até o TTL |
| CDN | API de purge (por URL ou por **tag** / *surrogate key*) | purges levam segundos para se propagar pelo mundo e podem ter limite de taxa; prefira URLs versionadas para arquivos estáticos |
| Navegador / app mobile | **impossível** recolher | só `Cache-Control: max-age` (curto para dados) e URLs versionadas (para arquivos estáticos) |

A **invalidação por tag** ajuda quando uma mudança afeta muitas chaves: marque cada resposta cacheada que contém o evento 42 com `event-42` e faça o purge pela tag. Algumas CDNs suportam isso nativamente; no Redis você pode manter um conjunto de chaves por tag (`SADD tag:event-42 key1 key2`) e removê-las juntas.

---

## Políticas de despejo

Um cache tem um limite de memória. Quando está cheio e chega um valor novo, a **política de despejo** (*eviction*) escolhe uma vítima. Uma boa política mantém os itens que serão lidos de novo mais cedo — o que ninguém sabe, então toda política é um palpite baseado no passado.

| Política | Despeja | Ponto forte | Ponto fraco |
|---|---|---|---|
| **LRU** (*least recently used*) | o item sem uso há mais tempo | se adapta rápido a mudanças; simples | uma única **varredura** de itens frios expulsa os quentes |
| **LFU** (*least frequently used*) | o item com menos acessos | mantém itens populares de forma estável; resiste a varreduras | lento para se adaptar: o sucesso de ontem continua (precisa de envelhecimento); itens novos são despejados antes de se provarem |
| **FIFO** (*first in, first out*) | a inserção mais antiga | trivial, barato | ignora a popularidade |
| **Aleatória** | um item ao acaso | nenhum metadado | ignora a popularidade, mas é surpreendentemente razoável com concentração |
| **Por TTL** (`volatile-ttl`) | o item mais perto de expirar | usa a dica do desenvolvedor | só é tão boa quanto os TTLs |
| **W-TinyLFU** | admissão por estimativa de frequência + uma pequena janela LRU | taxa de acerto quase ótima em muitos traces reais; resiste a varreduras e se adapta | mais complexa (embutida no Caffeine) |

O **W-TinyLFU**, usado pelo Caffeine, combina os dois mundos: itens novos entram numa pequena *janela* LRU; para passar ao cache principal, um item precisa ter frequência estimada maior que a da vítima que ele substituiria. As frequências ficam num esboço probabilístico compacto (um Count-Min sketch) e são periodicamente divididas por dois, para que a popularidade antiga desapareça[^3].

A simulação abaixo mostra por que a política importa. Um cache de 1.000 entradas atende leituras com distribuição Zipf sobre 20.000 itens; no meio da execução, um job de relatório **varre** 2.000 itens que ninguém mais lê.

```python exec="1" html="1"
import heapq
import matplotlib.pyplot as plt
import numpy as np
from collections import OrderedDict, deque
from io import StringIO

rng = np.random.default_rng(7)
N, CAP = 20_000, 1_000                     # catalog items, cache entries
w = np.arange(1, N + 1) ** -0.9
reads = rng.choice(N, size=40_000, p=w / w.sum()).tolist()   # Zipf-like reads
scan = list(range(N - 2_000, N))           # a nightly report reads 2,000 cold items
reqs = reads[:15_000] + scan + reads[15_000:]


def lru(reqs):
    cache, hits = OrderedDict(), []
    for k in reqs:
        if k in cache:
            cache.move_to_end(k)
            hits.append(1)
        else:
            hits.append(0)
            cache[k] = True
            if len(cache) > CAP:
                cache.popitem(last=False)   # least recently used
    return hits


def fifo(reqs):
    cache, order, hits = set(), deque(), []
    for k in reqs:
        if k in cache:
            hits.append(1)
        else:
            hits.append(0)
            cache.add(k)
            order.append(k)
            if len(cache) > CAP:
                cache.discard(order.popleft())   # oldest insertion
    return hits


def lfu(reqs):
    freq, heap, hits, seq = {}, [], [], 0
    for k in reqs:
        seq += 1
        if k in freq:
            freq[k] += 1
            hits.append(1)
        else:
            hits.append(0)
            if len(freq) >= CAP:            # evict the least frequently used
                while True:
                    f, _, victim = heapq.heappop(heap)
                    if freq.get(victim) == f:
                        del freq[victim]
                        break
            freq[k] = 1
        heapq.heappush(heap, (freq[k], seq, k))
    return hits


fig, ax = plt.subplots(figsize=(11, 4))
fig.patch.set_alpha(0)
win = 500
x = np.arange(len(reqs))
for name, fn, c in [("LRU", lru, "#e15759"), ("FIFO", fifo, "#f28e2b"), ("LFU", lfu, "#4e79a7")]:
    h = np.array(fn(reqs), dtype=float)
    rolling = np.convolve(h, np.ones(win) / win, mode="same") * 100
    ax.plot(x[win:-win:50], rolling[win:-win:50], color=c, lw=2, label=f"{name} (overall {h.mean():.0%})")
ax.axvspan(15_000, 17_000, color="#888", alpha=0.2)
ax.text(16_000, 75, "sequential\nscan", ha="center", color="#888")
ax.set_ylim(0, 100)
ax.set_xlabel("request number")
ax.set_ylabel(f"hit ratio over the last {win} requests (%)")
ax.set_title("Cache of 1,000 entries, Zipf reads over 20,000 items, one scan of 2,000 cold items")
ax.set_facecolor("none")
ax.grid(True, alpha=0.25)
ax.title.set_color("#888")
ax.xaxis.label.set_color("#888")
ax.yaxis.label.set_color("#888")
ax.tick_params(colors="#888")
for sp in ax.spines.values():
    sp.set_color("#888")
leg = ax.legend(frameon=False, loc="lower right")
for t in leg.get_texts():
    t.set_color("#888")

plt.tight_layout()
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

Como ler o gráfico:

- Durante a varredura, todas as políticas erram — os itens varridos nunca estiveram no cache. O que importa é **como o cache fica depois**.
- **LRU e FIFO** encheram o cache inteiro com os 2.000 itens varridos (mais que a capacidade), despejando todos os itens quentes; a taxa de acerto leva um tempo para voltar.
- O **LFU** despejou os itens varridos entre si (cada um tinha frequência 1) e manteve o conjunto quente: ele se recupera na hora e tem taxa de acerto maior no geral, porque com uma carga Zipf estável a frequência prevê melhor que a recência.
- A fraqueza do LFU puro não aparece aqui: se a popularidade *muda* (o show esgotado de ontem), ele mantém os antigos favoritos por tempo demais. É por isso que implementações reais de LFU **envelhecem** seus contadores — e por isso existe o W-TinyLFU.

### Despejo no Redis

O Redis só aplica uma política quando a memória chega a `maxmemory`. Seus LRU e LFU são **aproximados**: em vez de uma lista ordenada global, o Redis amostra algumas chaves (`maxmemory-samples`, padrão 5) e despeja a melhor candidata entre elas; o LFU usa um pequeno contador logarítmico por chave que decai com o tempo[^4].

| `maxmemory-policy` | Despeja | Use quando |
|---|---|---|
| `noeviction` | nada — escritas falham com erro quando está cheio | o Redis guarda dados que não podem sumir (sessões, filas, locks) |
| `allkeys-lru` | qualquer chave, a usada há mais tempo | um cache puro — o default usual para cache |
| `allkeys-lfu` | qualquer chave, a menos frequente | um cache puro com popularidade estável (catálogos) |
| `volatile-lru` | chaves **com TTL**, LRU | instância mista: chaves sem TTL ficam protegidas |
| `volatile-lfu` | chaves com TTL, LFU | idem, com frequência |
| `allkeys-random` | qualquer chave, ao acaso | acesso uniforme, o mais barato |
| `volatile-random` | chaves com TTL, ao acaso | raramente é a melhor escolha |
| `volatile-ttl` | chaves com TTL, a de menor TTL restante primeiro | os TTLs codificam prioridade |

!!! warning "Instâncias mistas"

    Com uma política `volatile-*` e chaves sem TTL, o Redis pode não encontrar nada que possa despejar e começar a rejeitar escritas, exatamente como no `noeviction`. Prefira instâncias separadas (ou bancos em clusters separados) para dados de "cache" e de "precisa guardar".

---

## Que consistência um cache consegue oferecer?

Um cache-aside na frente de um banco é **eventualmente consistente**: depois de uma escrita, leitores podem ver o valor antigo até a invalidação chegar ou o TTL expirar. Dá para reforçar garantias específicas, com um custo:

| Garantia | Significado | Como obter com um cache |
|---|---|---|
| **Defasagem limitada** | nenhum valor mais velho que T | TTL ≤ T (e nada mais é necessário) |
| **Read-your-writes** | depois que eu escrevo, *eu* vejo minha escrita | write-through para essa chave; ou marcar a sessão como "escreveu agora" e ignorar o cache por alguns segundos; para caches L1, rotear o usuário para a mesma réplica |
| **Leituras monotônicas** | nunca vejo um valor voltar no tempo | evitar misturar caches com atualidades diferentes para o mesmo usuário (ex.: L1 com TTL de 30 s e L2 com 5 s) |
| **Linearizabilidade** | todos veem a última escrita | **não com cache.** Leia a fonte da verdade. |

São os mesmos modelos de consistência vistos em [Sistemas Distribuídos](../../distributed/consistency/index.md) — um cache é só mais uma réplica, com garantias mais fracas e sem protocolo de replicação.

!!! example "BoxOffice: uma mudança de preço durante a abertura de vendas"

    O preço dinâmico sobe o setor B de R$ 300 para R$ 350 às 10h07. O serviço `catalog` confirma a mudança e remove `prices:42:BRL`; o CDC também publica uma invalidação para os caches em processo dos detalhes do evento que embutem o preço. A página do evento pode mostrar R$ 300 por até ~2 s nas réplicas que perderam a mensagem (TTL do L1 = 2 s para os detalhes do evento durante aberturas de vendas; a tabela de preços em si não fica no L1, veja [Padrões](../patterns/index.md#two-level)).

    No checkout, o serviço `order` **não** usa o preço cacheado: ele lê o preço na mesma transação SQL que confirma a reserva. Se for diferente do que o fã viu, o fã é convidado a confirmar o novo preço. O cache deixou a página rápida; o banco manteve o dinheiro correto.

!!! tip "Na entrevista"

    Quando você adiciona um cache, a pergunta seguinte é sempre "como você o mantém consistente?". Uma resposta forte tem três camadas: (1) o orçamento de defasagem para esse dado ("preços: alguns segundos; descrições: um minuto"); (2) o mecanismo — TTL como rede de segurança, remoção depois do commit, CDC se houver muitos escritores; (3) a saída para as decisões — "o checkout lê o preço do banco". Mencione a corrida do cache-aside e como o TTL (ou versões, ou leases) a limita, e você estará à frente da maioria dos candidatos.

!!! warning "Armadilhas comuns"

    - **Sem TTL "porque invalidamos explicitamente"** — a primeira remoção perdida vira permanente.
    - **Remover antes de escrever** no banco, ou dentro da transação antes do commit.
    - **Atualizar** em vez de remover, sem versões — escritores concorrentes se reordenam.
    - **Esquecer chaves derivadas**: o evento mudou, mas os resultados de busca, a lista "eventos deste fim de semana" e a página do local que o embutem não. Use tags, CDC ou TTLs curtos para chaves agregadas.
    - **Fazer purge da CDN a cada mudança** — lento e com limite de taxa; versione as URLs.
    - **Caches LRU ao lado de jobs em lote** — uma varredura noturna despeja o conjunto quente; dê aos jobs em lote um caminho próprio ou faça-os ignorar o cache.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    BUD["orçamento de defasagem<br/>por dado"] --> TTL["TTL: a rede de segurança"]
    BUD --> EXP["invalidação explícita<br/>apague, não atualize"]
    EXP --> RACE["escreva primeiro, depois apague<br/>a corrida do cache-aside"]
    EXP --> CDC["CDC a partir do WAL<br/>Debezium → Kafka"]
    CDC --> MANY["muitas cópias: L1 via pub/sub,<br/>purge na CDN, URLs versionadas"]
    CDC -.-> MSG["streams de mudanças<br/>→ Padrões de mensageria"]
    EV["despejo: LRU, LFU,<br/>W-TinyLFU"] --> MEM["política de maxmemory<br/>→ Redis"]
    TTL --> CONS["que consistência um cache oferece<br/>→ Consistência distribuída"]
    RACE --> CONS
```

**Componentes da paleta:** [`cache`](../../../reference/components/storage/index.md#cache) (TTLs, deleções, política de despejo) · [`app`](../../../reference/components/compute/index.md#app) (apaga depois do commit, mantém cópias L1) · [`sql`](../../../reference/components/storage/index.md#sql) (o write-ahead log é a fonte das invalidações) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (eventos de mudança do Debezium, ordenados por chave) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) (broadcast para os caches em processo) · [`cdn`](../../../reference/components/edge/index.md#cdn) (purge por URL ou tag — ou, melhor, URLs versionadas). **Cenários:** `read-heavy-cache`, `cdn-static`, `event-fanout`. **Continua em:** [Modos de Falha](../failure-modes/index.md), [Distribuídos — consistência](../../distributed/consistency/index.md), [Mensageria — padrões](../../messaging/patterns/index.md) (CDC, outbox), [Borda — DNS e CDN](../../edge/dns-cdn/index.md#cdn), [Hands-on 5](../../../hands-on/5/index.md).

---

[^1]: Citado por FOWLER, M. [TwoHardThings](https://martinfowler.com/bliki/TwoHardThings.html){target="_blank"}. Bliki, 2009.
[^2]: NISHTALA, R. et al. Scaling Memcache at Facebook. *USENIX NSDI*, 2013.
[^3]: EINZIGER, G.; FRIEDMAN, R.; MANES, B. TinyLFU: A Highly Efficient Cache Admission Policy. *ACM Transactions on Storage*, v. 13, n. 4, 2017. Veja também as [notas de eficiência do Caffeine](https://github.com/ben-manes/caffeine/wiki/Efficiency){target="_blank"}.
[^4]: REDIS. [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/){target="_blank"}. Documentação do Redis.
