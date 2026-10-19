São 9h59 do dia em que um show de estádio abre as vendas. A BoxOffice tem 60.000 lugares para vender e cerca de 2 milhões de fãs com a página do evento aberta, apertando F5. Às 10h00 o serviço `catalog` recebe dezenas de milhares de requisições `GET /events/42` por segundo, e cada uma executa as mesmas três consultas SQL: o evento, o local, a tabela de preços. Os dados não mudam há uma semana. Mesmo assim, o banco do catálogo chega a 100% de CPU, consultas que levavam 3 ms passam a levar 800 ms e o **checkout** — que compartilha esse banco — começa a dar timeout. Ninguém comprou um ingresso ainda, e o sistema já caiu.

A solução não é um banco maior. É parar de fazer ao banco a mesma pergunta dois milhões de vezes. Isso é **cache**: guardar uma cópia da resposta a uma pergunta cara em um lugar mais rápido e mais barato de ler, e servir a cópia enquanto ela for boa o suficiente.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** por que caches funcionam (localidade e popularidade concentrada) e **identificar** as camadas onde uma requisição pode ser cacheada, do navegador ao buffer pool do banco.
    - **Calcular** a latência efetiva e a carga no banco para uma dada taxa de acerto (*hit ratio*), e **dimensionar** um cache para um conjunto de trabalho (*working set*).
    - **Comparar** cache-aside, read-through, write-through, write-behind, write-around e refresh-ahead, e **escolher** um para cada tipo de dado da BoxOffice.
    - **Projetar** uma estratégia de invalidação (TTL, remoção explícita, chaves versionadas, captura de mudanças) e **selecionar** uma política de despejo (*eviction*).
    - **Diagnosticar** modos de falha de cache — *stampede*, avalanche, penetração, chaves quentes, queda do cache — e **aplicar** a correção adequada.
    - **Usar** as estruturas de dados do Redis e **raciocinar** sobre persistência, replicação e os hash slots do Redis Cluster.

## Roteiro

1. **Esta visão geral** — por que o cache funciona, onde os caches ficam, a matemática da taxa de acerto, dimensionamento e o que nunca cachear.
2. [Padrões de Cache](patterns/index.md) — cache-aside, read-through, write-through, write-behind, write-around, refresh-ahead; desenho de chaves.
3. [Invalidação e Despejo](invalidation/index.md) — TTLs, invalidação explícita, a corrida do cache-aside, CDC, LRU/LFU/W-TinyLFU.
4. [Modos de Falha](failure-modes/index.md) — cache frio, *stampede*, avalanche, penetração, chaves quentes, a queda do cache.
5. [Redis](redis/index.md) — estruturas de dados, atomicidade, persistência, replicação, Redis Cluster, serviços gerenciados.
6. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/caching.html" title="Slides: cache" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/caching.html){:target="_blank"}

---

## Por que o cache funciona

Um cache é uma aposta: *o dado que eu li agora será lido de novo em breve*. Duas propriedades das cargas reais fazem essa aposta valer a pena.

- **Localidade temporal** — o que foi lido recentemente tende a ser lido de novo. Um fã que abriu a página do evento vai recarregá-la uma dúzia de vezes antes das 10h00.
- **Popularidade concentrada** — uma pequena fração dos itens recebe a maior parte das requisições. A BoxOffice lista 100.000 eventos, mas numa sexta à noite algumas centenas deles (os grandes shows, os jogos do fim de semana) levam quase todo o tráfego.

A popularidade na web segue, aproximadamente, uma **distribuição do tipo Zipf**: o item de posição $i$ é pedido com probabilidade proporcional a $1/i^{s}$, onde $s$ (a *concentração*, ou *skew*) costuma ficar entre 0,6 e 1 para objetos web[^1]. Quanto maior o $s$, mais concentrado o tráfego, e mais um cache pequeno ajuda.

??? question "Pense antes: qual o tamanho do cache?"

    A BoxOffice tem 100.000 eventos. Se a popularidade é Zipf com $s = 1$, que fração das requisições um cache com apenas os 1.000 eventos mais populares (1% do catálogo) responderia?

    Cerca de **60%**. Com $s = 1$, a fatia dos $k$ primeiros itens entre $N$ é aproximadamente $\ln k / \ln N = \ln 1000 / \ln 100000 \approx 0{,}6$. Guardar 1% dos dados absorve bem mais da metade das leituras — o gráfico abaixo mostra isso para várias concentrações.

O segundo ingrediente é a **diferença de latência** entre as camadas de armazenamento. Os números abaixo são ordens de grandeza — variam com o hardware e a rede, mas o que importa são as razões entre eles[^2]:

| Operação | Ordem de grandeza | Em relação a uma leitura de RAM |
|---|---|---|
| Leitura da memória principal (RAM) | ~100 ns | 1× |
| Leitura aleatória de 4 KB de um SSD NVMe | ~10–100 µs | ~100–1.000× |
| Ida e volta dentro de um data center | ~0,5 ms | ~5.000× |
| `GET` de uma chave pequena no Redis no mesmo data center (com a rede) | ~0,2–1 ms | ~2.000–10.000× |
| Consulta SQL indexada em um banco aquecido (com a rede) | ~1–5 ms | ~10.000–50.000× |
| Consulta SQL com joins em um banco ocupado | ~10–100+ ms | ~100.000× ou mais |
| Ida e volta São Paulo ↔ costa leste dos EUA | ~110–130 ms | ~1.000.000× |

Um cache não só torna a leitura mais rápida. Ele também **tira trabalho do sistema que está atrás dele**: cada acerto (*hit*) é uma consulta que o banco nunca vê. Na maioria dos sistemas reais, esse segundo efeito — proteger a fonte da verdade — é a razão de o cache existir.

---

## Onde os caches ficam

Uma única requisição da BoxOffice pode ser respondida por seis caches diferentes antes de chegar ao banco. Cada camada está mais perto do usuário (mais rápida, mais barata por acerto), mas guarda menos e é mais difícil de invalidar.

``` mermaid-sim
flowchart LR
    U["Navegador / app<br/>cache HTTP"] -->|"miss"| CDN["Borda da CDN<br/>estáticos + páginas públicas"]
    CDN -->|"miss"| GW["API gateway<br/>cache de respostas"]
    GW -->|"miss"| APP["serviço catalog<br/>cache em processo"]
    APP -->|"miss"| R[("Redis<br/>cache distribuído")]
    R -->|"miss"| DB[("PostgreSQL<br/>buffer pool + page cache do SO")]
    DB -->|"linha"| APP
    APP -->|"SET com TTL"| R
```

| Camada | O que guarda | TTL típico | Quem invalida | Exemplo na BoxOffice |
|---|---|---|---|---|
| **Cliente** (navegador, app) | respostas HTTP, imagens, scripts, via `Cache-Control`, `ETag` e requisições condicionais `If-None-Match`[^3] | segundos a um ano (arquivos versionados) | o servidor, só por cabeçalhos; não dá para apagar uma cópia no celular do usuário | `app.3f9a1c.js` cacheado por um ano; JSON do evento com `max-age=10` |
| **CDN** (Content Delivery Network) | arquivos estáticos, imagens, páginas públicas em pontos de presença perto do usuário | minutos a dias | API de purge, URLs versionadas | pôsteres dos eventos vindos do object store; a página pública do evento |
| **API gateway / proxy reverso** | respostas inteiras de rotas `GET` públicas | segundos | TTL curto; raramente explícito | `GET /events/42` cacheado por 5 s no gateway durante a abertura das vendas |
| **Em processo** (local, ex.: Caffeine na JVM) | objetos quentes no heap do próprio serviço | segundos a minutos | cada réplica separadamente (difícil!) | geometria do local e do mapa de assentos, que quase nunca mudam |
| **Cache distribuído** (Redis, Valkey, Memcached) | objetos e resultados de consultas compartilhados por todas as réplicas | segundos a horas | a aplicação (remove na escrita) ou o TTL | detalhes do evento, tabelas de preço, resultados de busca, sessões |
| **Banco de dados** (buffer pool, page cache do SO) | páginas de dados e de índices em RAM | gerenciado pelo motor (parecido com LRU) | o próprio motor — sempre consistente | páginas do índice de `seats` dos eventos da noite |

Quanto mais profunda a camada, mais consistente ela é: o buffer pool do banco nunca devolve um dado velho, enquanto uma cópia no navegador não pode ser recolhida de jeito nenhum. Escolher *onde* cachear é, portanto, escolher **quanta defasagem cada tipo de dado tolera** — o assunto de [Invalidação e Despejo](invalidation/index.md). CDNs e cache HTTP são tratados em profundidade em [Tráfego e Borda](../edge/dns-cdn/index.md); esta aula se concentra no lado da aplicação: caches em processo e distribuídos.

!!! info "Cache vs. buffer vs. réplica"

    Um **cache** guarda uma cópia *descartável*: perdê-la custa desempenho, nunca dados. Um **buffer** guarda dados em trânsito (por exemplo, escritas esperando para serem gravadas). Uma **réplica de leitura** ([Bancos de dados](../databases/index.md)) é uma cópia completa e continuamente atualizada do banco. Se perder o seu "cache" perde dados, ele não é um cache — é um banco de dados, e precisa ser tratado como tal.

---

## A matemática da taxa de acerto

A **taxa de acerto** (*hit ratio*) $h$ é a fração de leituras respondidas pelo cache. Duas fórmulas sustentam quase todas as decisões de cache.

**Latência efetiva** — o tempo médio de uma leitura:

$$
t_{\text{eff}} = h \cdot t_{\text{hit}} + (1 - h) \cdot t_{\text{miss}}
$$

onde $t_{\text{miss}}$ inclui a consulta frustrada ao cache *mais* a consulta ao banco (e a escrita de volta no cache).

**Carga no banco** — as leituras que passam:

$$
\text{QPS}_{\text{DB}} = (1 - h) \cdot \text{QPS}_{\text{total}}
$$

!!! example "Exemplo resolvido — a página do evento às 10h00"

    A página do evento gera **50.000 leituras por segundo**. Um acerto no Redis custa 0,5 ms; uma falta (*miss*) custa 0,5 ms (consulta frustrada) + 8 ms (banco sob carga) = 8,5 ms.

    | Taxa de acerto | Latência efetiva | Leituras que chegam ao banco |
    |---|---|---|
    | 0% (sem cache) | 8,0 ms (se o banco sobreviver) | 50.000 QPS |
    | 90% | 0,9 × 0,5 + 0,1 × 8,5 = **1,3 ms** | **5.000 QPS** |
    | 99% | 0,99 × 0,5 + 0,01 × 8,5 = **0,58 ms** | **500 QPS** |
    | 99,9% | ≈ 0,51 ms | **50 QPS** |

    Passar de 90% para 99% parece "9 pontos melhor". Para o banco, é **10× menos carga**. Pense na **taxa de falta** $1-h$, não na de acerto: cada nove a mais divide por dez a carga atrás do cache — *os últimos noves da taxa de acerto são os que mais importam*.

O gráfico abaixo mostra os dois efeitos. À esquerda, a taxa de acerto de um cache *ideal* que sempre guarda os $k$ itens mais populares, para um catálogo de 100.000 itens e várias concentrações (um cache real, cuja política de despejo precisa adivinhar, se sai um pouco pior). À direita, a carga no banco em função da taxa de acerto para 50.000 leituras por segundo.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

N = 100_000                      # items in the catalog
ranks = np.arange(1, N + 1)
fracs = np.logspace(-4, 0, 200)  # cache size as a fraction of the catalog

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.2))
fig.patch.set_alpha(0)
colors = ["#4e79a7", "#59a14f", "#f28e2b", "#e15759"]
for s, c in zip([0.6, 0.8, 1.0, 1.2], colors):
    w = ranks ** (-s)
    cum = np.cumsum(w) / w.sum()          # ideal cache: keeps the top-k items
    k = np.maximum(1, (fracs * N).astype(int))
    ax1.plot(fracs * 100, cum[k - 1] * 100, color=c, lw=2, label=f"Zipf s = {s}")
ax1.set_xscale("log")
ax1.set_xlabel("cache size (% of the catalog, log scale)")
ax1.set_ylabel("hit ratio (%)")
ax1.set_title("Hit ratio of an ideal top-k cache")
ax1.axvline(1, color="#888", ls=":", lw=1)
ax1.legend(frameon=False)

qps = 50_000
h = np.linspace(0.80, 0.999, 300)
ax2.plot(h * 100, (1 - h) * qps, color="#e15759", lw=2)
for hv in [0.90, 0.95, 0.99]:
    ax2.plot(hv * 100, (1 - hv) * qps, "o", color="#4e79a7")
    ax2.annotate(f"{(1 - hv) * qps:,.0f} QPS", (hv * 100, (1 - hv) * qps),
                 textcoords="offset points", xytext=(6, 6), color="#888")
ax2.set_xlabel("hit ratio (%)")
ax2.set_ylabel("queries per second reaching the DB")
ax2.set_title("DB load with 50,000 reads/s in front of the cache")

for ax in (ax1, ax2):
    ax.set_facecolor("none")
    ax.grid(True, alpha=0.25)
    ax.title.set_color("#888")
    ax.xaxis.label.set_color("#888")
    ax.yaxis.label.set_color("#888")
    ax.tick_params(colors="#888")
    for sp in ax.spines.values():
        sp.set_color("#888")
for t in ax1.get_legend().get_texts():
    t.set_color("#888")

plt.tight_layout()
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

Duas lições do painel da esquerda:

- Com concentração forte ($s \geq 1$), um cache com **1% do catálogo** (linha pontilhada) já responde 60–85% das leituras. Dobrar o cache a partir daí rende só alguns pontos: os retornos diminuem rápido.
- Com concentração fraca ($s = 0{,}6$, muitos itens com popularidade parecida — por exemplo, uma cauda longa de perfis de usuários), um cache pequeno quase não ajuda. Antes de adicionar um cache, pergunte se o padrão de acesso é concentrado.

!!! warning "A taxa de acerto também depende do TTL"

    O gráfico supõe que os itens ficam no cache até serem despejados. Com um TTL, todo item erra uma vez por período de TTL: uma chave lida $r$ vezes por segundo com TTL $T$ tem, no melhor caso, taxa de acerto $1 - 1/(r \cdot T + 1)$. Um evento quente lido 1.000 vezes por segundo com TTL de 60 s: 1 falta em 60.001 leituras. Um evento frio lido uma vez a cada 10 minutos com TTL de 60 s: toda leitura erra. **TTLs curtos prejudicam a cauda longa, não as chaves quentes.**

---

## Dimensionando um cache

O cache precisa guardar o **conjunto de trabalho** (*working set*) — os itens lidos de novo enquanto ainda estão no cache — e não o conjunto de dados inteiro.

!!! example "Exemplo resolvido — dimensionando o cache do catálogo"

    *Premissas ilustrativas:* 100.000 eventos; o JSON cacheado de um evento (evento + local + preços) tem em média 4 KB; o Redis acrescenta um custo por chave (a string da chave, ponteiros, metadados de expiração) que arredondamos para 100 bytes; queremos cachear os 20.000 eventos mais lidos.

    - Dados: 20.000 × (4 KB + 0,1 KB) ≈ **82 MB**.
    - Resultados de busca (`GET /search?q=...`): 200.000 consultas distintas × 2 KB ≈ **400 MB**.
    - Sessões: 2 M fãs simultâneos × 0,5 KB ≈ **1 GB**.
    - Total ≈ 1,5 GB → com uma réplica para disponibilidade, 3 GB; com 50% de folga para fragmentação, snapshots e crescimento, **~4,5 GB de RAM**.

    É um único nó Redis pequeno com uma réplica. Caches de um produto de porte médio costumam ser medidos em gigabytes, não em terabytes — o recurso caro que eles economizam é o banco.

Regras práticas de dimensionamento:

- **Meça o tamanho do item**, não chute: serialize um objeto real e veja o tamanho (`MEMORY USAGE chave` no Redis).
- **Monitore os despejos**: se `evicted_keys` cresce sem parar enquanto a taxa de acerto cai, o cache é pequeno demais para o conjunto de trabalho.
- **Separe por finalidade**: sessões (não podem ser despejadas) e caches de consultas (podem) não devem disputar a mesma memória — use instâncias ou políticas de despejo diferentes ([Redis](redis/index.md)).

---

## O que não cachear

Um cache responde *"qual era o valor um instante atrás?"*. Algumas perguntas precisam de *"qual é o valor agora?"*.

!!! example "BoxOffice: o mapa de assentos vs. a reserva do assento"

    - O **mapa de assentos** mostrado na página do evento (quais lugares parecem livres) pode ser cacheado por 1–2 segundos. Se estiver um pouco desatualizado, o fã clica num lugar que acabou de ser pego e recebe um educado "este lugar não está mais disponível".
    - A **reserva do assento** (*hold*) — a decisão de que o assento A-12 agora é da Alice por 10 minutos — **nunca** pode ser tomada sobre dado cacheado. Ela vai para o serviço `inventory`, que decide numa transação SQL sobre a fonte da verdade ([Bancos de dados — transações](../databases/transactions/index.md#double-booking)). Um cache pode *filtrar* assentos obviamente vendidos antes de consultar o banco, mas nunca *concede* um assento.

A mesma lógica vale para saldos de conta, status de pagamento, chaves de idempotência e qualquer coisa em que agir sobre um valor antigo cause uma ação errada e irreversível. Uma boa regra: **cacheie o que você exibe, não aquilo sobre o que você decide**.

Outras coisas que não devem ir para um cache compartilhado: dados lidos uma única vez (um cache cheio de itens de uma leitura só despeja os úteis), dados pessoais sem TTL claro e sem controle de acesso (um cache é uma cópia que também precisa ser protegida e apagada) e valores que são mais baratos de calcular do que de buscar pela rede.

---

## Veja no playground

Experimente: o cenário abaixo coloca um Redis em cache-aside na frente do banco do catálogo. Inicie a execução com as configurações padrão e observe a **taxa de acerto**, o **QPS do banco** e a **latência p99**. Depois (1) ajuste o TTL do cache para um valor bem curto e veja a taxa de acerto e a carga no banco se moverem juntas; (2) esvazie o cache no meio da execução (cache frio) e veja quanto tempo o p99 leva para se recuperar; (3) aumente a carga até o banco saturar só com as faltas.

<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="520"></div>

Abra o [playground completo](../../../playground/index.md) para adicionar um cache em processo ou uma CDN na frente do mesmo desenho. O componente `cache` é descrito no [catálogo de componentes](../../reference/components/storage/index.md#cache).

## O mapa de conceitos de caching { #concept-map }

Um cache não é um componente, e sim uma camada em cada salto: cada componente da paleta no caminho de leitura pode responder a partir de uma cópia antes que a requisição chegue à fonte da verdade. O mapa liga cada **componente da paleta** (verde) aos **conceitos de cache** que ele usa (azul):

``` mermaid
flowchart LR
    client["client · mobile"]:::comp -->|"miss"| cdn["cdn"]:::comp
    cdn -->|"miss"| apigw["apigw"]:::comp
    apigw -->|"miss"| app["app"]:::comp
    app -->|"miss"| cache["cache"]:::comp
    cache -->|"miss"| sql["sql"]:::comp
    sql -->|"CDC"| stream["stream · pubsub"]:::comp
    stream -->|"invalida"| cache
    client -.- c1["Cache-Control, ETag,<br/>URLs versionadas"]:::tech
    cdn -.- c2["purge por tag,<br/>TTL curto na borda"]:::tech
    app -.- c3["L1 em processo,<br/>cache em dois níveis"]:::tech
    cache -.- c4["cache-aside, TTL, despejo,<br/>taxa de acerto, dimensionamento"]:::tech
    cache -.- c5["stampede, chaves quentes,<br/>o cache cai"]:::tech
    sql -.- c6["buffer pool,<br/>nunca cachear decisões"]:::tech
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`client`](../../reference/components/client/index.md#client) · [`mobile`](../../reference/components/client/index.md#mobile) | O dispositivo pode pular a requisição inteira? | `Cache-Control`, `ETag`, requisições condicionais, assets versionados | esta visão geral (*Onde os caches ficam*), [Borda — DNS e CDN](../edge/dns-cdn/index.md#cdn) | `cdn-static` |
| [`cdn`](../../reference/components/edge/index.md#cdn) | A borda pode responder pela origem? | páginas públicas e assets, URLs versionadas, purge por URL ou tag | [Borda — DNS e CDN](../edge/dns-cdn/index.md#cdn), [Invalidação — CDC](invalidation/index.md#cdc) | `cdn-static`, `video-streaming` |
| [`apigw`](../../reference/components/edge/index.md#apigw) | Um `GET` público pode ser respondido sem o serviço? | cache da resposta inteira com TTL de segundos durante a abertura de vendas | esta visão geral (*Onde os caches ficam*) | `flash-sale` |
| [`app`](../../reference/components/compute/index.md#app) | Cada réplica pode manter os objetos mais quentes no próprio heap? | L1 em processo (Caffeine), near cache, invalidação por broadcast | [Padrões — cache em dois níveis](patterns/index.md#two-level) | `read-heavy-cache` |
| [`cache`](../../reference/components/storage/index.md#cache) | Uma cópia compartilhada absorve a maioria das leituras? | cache-aside, read/write-through, write-behind, TTL, LRU/LFU/W-TinyLFU, matemática da taxa de acerto, dimensionamento, estruturas do Redis | [Padrões](patterns/index.md), [Invalidação](invalidation/index.md), [Redis](redis/index.md) | `read-heavy-cache`, `search-autocomplete` |
| [`cache`](../../reference/components/storage/index.md#cache) (sob estresse) | O que acontece quando uma chave quente expira, ou o cache cai? | cache frio, stampede, avalanche, penetração, chaves quentes e grandes, fallback protegido | [Modos de Falha](failure-modes/index.md) | `read-heavy-cache`, `flash-sale` |
| [`sql`](../../reference/components/storage/index.md#sql) | O que o cache protege — e o que nunca pode vir dele? | fonte da verdade, buffer pool, "cacheie o que você exibe, não aquilo com que você decide" | esta visão geral (*O que não cachear*), [Bancos de dados — transações](../databases/transactions/index.md#double-booking) | `db-replicas`, `flash-sale` |
| [`stream`](../../reference/components/messaging/index.md#stream) · [`kafka`](../../reference/components/messaging/index.md#kafka) · [`pubsub`](../../reference/components/messaging/index.md#pubsub) | Como uma mudança no banco chega a todas as cópias? | CDC a partir do WAL (Debezium), ordenado por chave, broadcast para os caches L1 | [Invalidação — CDC](invalidation/index.md#cdc) | `event-fanout` |

!!! tip "Na entrevista"

    Não adicione um cache por reflexo. Justifique com a proporção de leituras e escritas e com a concentração ("as leituras superam as escritas 100:1 e o 1% de eventos mais populares leva a maior parte do tráfego"), diga a taxa de acerto esperada e **o que ela faz com a carga do banco** ("com 95%, o banco vê 2.500 QPS em vez de 50.000"), e então diga como mantém o cache atualizado (TTL + remoção na escrita) e o que acontece quando ele falha. Os entrevistadores valorizam as perguntas que você responde antes de eles fazerem.

!!! warning "Armadilhas comuns"

    - **Cachear para esconder uma consulta lenta** que um índice resolveria. Corrija a consulta primeiro; o cache então protege capacidade, não um bug.
    - **Sem TTL**: chaves que vivem para sempre transformam cada invalidação perdida em dado errado permanente.
    - **Contar com o cache para ter capacidade sem planejar a falha dele**: se o banco não aguenta um cache frio, o cache virou uma dependência crítica ([Modos de Falha](failure-modes/index.md)).
    - **Medir só a média**: uma taxa de acerto de 95% ainda manda 5% das requisições pelo caminho lento; esse é o seu p99.

---

## Conexões

- [Bancos de dados](../databases/index.md) — a fonte da verdade que o cache protege; réplicas de leitura são a outra forma de escalar leituras.
- [Tráfego e Borda — DNS e CDN](../edge/dns-cdn/index.md) — cache HTTP e CDNs, as camadas de cache mais externas.
- [Hands-on 5 — Cache](../../hands-on/5/index.md) — Redis em cache-aside no serviço `catalog`; medir a taxa de acerto e o p99; reproduzir e corrigir um *stampede*.
- [Exercício — cache + réplica](../../exercises/cache-db/index.md) — medições antes/depois de um cache e de uma réplica de leitura.
- Estudos de caso: [cache distribuído](../case-studies/distributed-cache/index.md), [encurtador de URLs](../case-studies/url-shortener/index.md), [autocompletar de busca](../case-studies/search-autocomplete/index.md).
- [Playground](../../../playground/index.md) — cenário `read-heavy-cache`.

## Pontos-chave

- Caches funcionam por causa de **localidade e concentração**: um cache com 1% de um catálogo com distribuição Zipf pode absorver a maioria das leituras.
- Uma requisição atravessa várias camadas de cache (cliente, CDN, gateway, em processo, distribuído, banco); mais perto do usuário é mais rápido, porém mais difícil de invalidar.
- $t_{\text{eff}} = h \cdot t_{\text{hit}} + (1-h) \cdot t_{\text{miss}}$ e $\text{QPS}_{\text{DB}} = (1-h) \cdot \text{QPS}$: pense na **taxa de falta** — cada nove a mais é 10× menos carga no banco.
- Dimensione para o **conjunto de trabalho**, meça o tamanho dos itens, acompanhe os despejos e mantenha folga.
- **Cacheie o que você exibe, não aquilo sobre o que você decide**: reservas de assento, pagamentos e saldos vão à fonte da verdade.

---

[^1]: BRESLAU, L. et al. Web Caching and Zipf-like Distributions: Evidence and Implications. *IEEE INFOCOM*, 1999.
[^2]: DEAN, J. *Designs, Lessons and Advice from Building Large Distributed Systems*. Palestra, LADIS, 2009 ("latency numbers every programmer should know"). Valores de rede e de SSD atualizados para o hardware atual como ordens de grandeza.
[^3]: FIELDING, R.; NOTTINGHAM, M.; RESCHKE, J. [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111){target="_blank"}. IETF, 2022.
