
> *"Projete as sugestões da caixa de busca de um site grande: enquanto o usuário digita, mostre as 5–10 complementações mais prováveis do que ele está digitando, rápido o bastante para parecer instantâneo."*

O autocomplete (também chamado de *typeahead* ou *busca enquanto se digita*) parece uma pequena funcionalidade de interface e é um sistema muito instrutivo. Cada **tecla** é uma requisição, então ele é um dos endpoints de maior QPS de qualquer site; a resposta precisa chegar bem abaixo de 100 ms ou não serve para nada (o usuário já digitou a próxima letra); e as sugestões são **dados derivados** — calculados offline a partir de milhões de buscas passadas e depois servidos da memória. A entrevista testa se você separa o **caminho de atendimento** (um índice só de leitura, em memória) do **caminho de dados** (logs → agregação → construção do índice), e se você sabe qual estrutura de dados responde "as top-k complementações de um prefixo" sem varrer nada.

O BoxOffice precisa exatamente disso: fãs digitam `col…` e esperam *Coldplay*, *Coldplay São Paulo*, *Coala Festival*, misturando artistas, locais e cidades. Quando uma turnê é anunciada, as buscas por aquele artista disparam em minutos — e as sugestões de ontem ainda não sabem disso. Esse problema de atualidade é um dos aprofundamentos abaixo.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star: médio |
| **Conceitos-chave** | trie com top-k em cada nó, tabela hash de prefixos, transdutores de estados finitos, agregação offline com decaimento no tempo, snapshots imutáveis do índice e troca atômica, camada de tendências, fragmentação por prefixo e assimetria de carga, cache no navegador/CDN, debounce no cliente, listas de bloqueio |
| **Componentes da paleta** | [`client`](../../../reference/components/client/index.md#client), [`cdn`](../../../reference/components/edge/index.md#cdn), [`apigw`](../../../reference/components/edge/index.md#apigw), [`search`](../../../reference/components/compute/index.md#search), [`cache`](../../../reference/components/storage/index.md#cache), [`analytics`](../../../reference/components/compute/index.md#analytics), [`stream`](../../../reference/components/messaging/index.md#stream), [`dwh`](../../../reference/components/storage/index.md#dwh), [`worker`](../../../reference/components/compute/index.md#worker) |
| **Cenário do playground** | `search-autocomplete` |

!!! abstract "O que este caso treina"

    - **Estimar** o tráfego de teclas e **mostrar** como debounce e cache o reduzem antes de chegar aos servidores.
    - **Explicar** como uma trie com top-k guardado em cada nó responde um prefixo em O(tamanho do prefixo), e **comparar** com uma tabela hash de prefixos.
    - **Projetar** o pipeline de dados que transforma logs de busca num índice: agregação, decaimento no tempo, construção do snapshot, troca atômica.
    - **Decidir** entre replicar o índice inteiro e fragmentá-lo por prefixo, levando em conta a assimetria de carga.
    - **Tratar** a atualidade (buscas em alta), a filtragem de termos ofensivos ou bloqueados e um orçamento de latência de dezenas de milissegundos.

---

## 1. Esclarecer os requisitos

([roteiro de entrevista](../../intro/interview-framework/index.md))

### Requisitos funcionais

1. Enquanto o usuário digita, devolver até **k = 8** sugestões que **começam** com o prefixo digitado, ordenadas por popularidade.
2. As sugestões podem ser entidades **tipadas** (artista, local, cidade, evento) com um ID, para a interface mostrar um ícone e ir direto à página.
3. As sugestões refletem o que as pessoas buscam: buscas **populares** primeiro, com **tendências recentes** aparecendo em minutos.
4. Termos ofensivos, ilegais ou bloqueados **nunca** aparecem.
5. Os resultados podem depender do **idioma** (pt-BR vs. en) e, opcionalmente, da cidade do usuário.

### Requisitos não funcionais

| Qualidade | Meta |
|---|---|
| **Latência** | p99 < 100 ms percebido pelo usuário; < 10–20 ms dentro dos nossos servidores |
| **Vazão** | Dezenas de milhares de requisições/s no pico (cada tecla é uma requisição) |
| **Disponibilidade** | 99,9%; se o autocomplete falhar, a caixa de busca continua funcionando — ele degrada com elegância |
| **Atualidade** | Popularidade atualizada diariamente; buscas em alta visíveis em ~15 minutos |
| **Consistência** | Não exigida: dois usuários podem ver sugestões um pouco diferentes por alguns minutos |

### Fora do escopo (diga explicitamente)

A página completa de resultados de busca (ranqueamento, índice invertido — veja o [componente de busca](../../../reference/components/compute/index.md#search)), correção ortográfica além de uma tolerância simples a erros de digitação, busca por voz, anúncios nas sugestões.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Só casamento de prefixo, ou também no meio das palavras ("paulo" → "Coldplay São Paulo")? | Prefixo → trie/FST; infixo → n-gramas ou índice invertido, mais memória. |
    | Quantas sugestões, ordenadas por quê? | O top-k por prefixo é pré-computado com um k e uma pontuação fixos. |
    | Quão atualizadas precisam ser as sugestões? | Reconstrução diária vs. uma camada de "tendências" em streaming. |
    | Personalizadas por usuário? | Resultados personalizados não podem ficar em cache na CDN. |
    | Vários idiomas e regiões? | Um índice por idioma/região, ou um filtro na hora de atender. |
    | Tolerância a erros de digitação? | Busca aproximada multiplica o trabalho por tecla. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope)

```python exec="1" source="tabbed-right"
# Search autocomplete: assumptions (illustrative)
dau             = 20_000_000
searches_per    = 5           # searches per user per day
chars_per_query = 12          # average characters typed
req_per_search  = 4           # requests actually sent after debouncing (not 12)
peak_factor     = 5           # tour announcement spikes
distinct_q      = 5_000_000   # distinct queries kept after a minimum-count filter
prefixes_per_q  = 6           # new trie nodes per query (prefixes are shared)
node_b          = 200         # node: children map + top-10 ids + overhead
log_b           = 100         # one logged search (query, ts, locale, city)
cdn_hit         = 0.5         # share of prefix requests answered by browser/CDN caches

naive_rps   = dau * searches_per * chars_per_query / 86_400
rps         = dau * searches_per * req_per_search / 86_400
peak_rps    = rps * peak_factor
origin_peak = peak_rps * (1 - cdn_hit)
trie_nodes  = distinct_q * prefixes_per_q
trie_gb     = trie_nodes * node_b / 1e9
logs_gb_day = dau * searches_per * log_b / 1e9

rows = [
    ("naive_rps", naive_rps, "req/s"), ("rps", rps, "req/s"),
    ("peak_rps", peak_rps, "req/s"), ("origin_peak", origin_peak, "req/s"),
    ("trie_nodes", trie_nodes, "nodes"), ("trie_gb", trie_gb, "GB"),
    ("logs_gb_day", logs_gb_day, "GB/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- Uma requisição por caractere daria **~14 mil req/s** em média. O **debounce** no cliente (enviar só depois que o usuário pausa ~100–150 ms) reduz para **~4,6 mil req/s**; um anúncio de turnê multiplica por 5, para **~23 mil req/s**. ⇒ a requisição mais barata é a que nunca é enviada.
- Prefixos curtos (`c`, `co`, `col`) são iguais para todo mundo: se os caches do navegador e da CDN respondem metade das requisições, a origem vê **~12 mil req/s** no pico.
- O índice inteiro — **~30 M de nós da trie, ~6 GB** — cabe na memória de um servidor. ⇒ o padrão é **replicar o índice completo** em cada nó de atendimento, não fragmentá-lo; fragmentar é um passo posterior se o índice crescer (mais idiomas, mais tipos de entidade).
- Os logs somam **~10 GB/dia** — modesto. Agregá-los é um job batch/stream; ele nunca toca o caminho de atendimento.

!!! tip "Na entrevista"

    Divida o problema em voz alta: *"Há dois sistemas aqui. Um sistema de atendimento — só leitura, em memória, respondendo um prefixo em poucos milissegundos — e um pipeline de dados que reconstrói o que ele serve a partir dos logs de busca. Eles só se encontram no snapshot do índice."*

---

## 3. API

```http
GET /v1/autocomplete?q=col&limit=8&locale=pt-BR&city=sao-paulo
    → 200 Cache-Control: public, max-age=60
      {"prefix": "col",
       "suggestions": [
         {"text": "Coldplay", "type": "artist", "id": "a-118"},
         {"text": "Coldplay São Paulo", "type": "event", "id": "e-4410"},
         {"text": "Coldplay Rio", "type": "event", "id": "e-4411"}
       ]}

POST /v1/search/events      (batched, asynchronous; or simply the access logs)
    {"query": "coldplay sao paulo", "selected": "e-4410", "position": 2, "ts": 1767261600123}
```

- A resposta é **cacheável** para prefixos públicos e não personalizados (`Cache-Control: public, max-age=60`): navegadores e a CDN respondem prefixos repetidos sem chegar até nós ([DNS e CDN](../../edge/dns-cdn/index.md)).
- Normalize o prefixo **antes** do cache e da consulta (minúsculas, sem espaços nas pontas, sem acentos: `Colé` → `cole`) para que prefixos iguais compartilhem a chave de cache.
- A personalização (as buscas recentes do próprio usuário) é mesclada **no cliente**, mantendo a resposta do servidor compartilhável.

---

## 4. Modelo de dados

```text
# Serving: an immutable in-memory index per locale, loaded from a snapshot file
trie node "col" → children {d, o, …}, top: [(98000, a-118 "Coldplay"), (41000, e-4410 …), …]

# Snapshot files in object storage, one per build
s3://…/autocomplete/pt-BR/2027-03-14T10:00Z/index.bin     (+ manifest with checksum)

# Trending overlay (cache, refreshed every minute by the stream job)
trending:pt-BR → [("coldplay 2027", 15400), ("metallica rio", 8200)]   TTL 30 min
```

```sql
-- Aggregated counts in the data warehouse, input of the index build
CREATE TABLE query_counts_daily (
    locale     TEXT,
    query      TEXT,          -- normalized
    day        DATE,
    searches   BIGINT,
    selections BIGINT,        -- suggestion clicked / result opened
    PRIMARY KEY (locale, query, day)
);
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Índice de atendimento | Trie/FST em memória no serviço de autocomplete (`search`), carregada de um snapshot | Consultas em microssegundos; só leitura, então sem locks; ~6 GB cabem em RAM |
| Snapshots | Object store | Versionados, imutáveis, fáceis de reverter |
| Eventos de busca | Stream de eventos (`stream`) → data warehouse (`dwh`) | Logs só de inserção, agregados em batch |
| Contagens diárias | Data warehouse (`dwh`) | Grandes varreduras e group-bys para a construção |
| Camada de tendências, prefixos quentes | Cache (`cache`) | Pequena, atualizada com frequência, compartilhada por todos os nós de atendimento |

---

## 5. Design de alto nível

``` mermaid-sim
flowchart LR
    u([Navegador / app]) --> cdn["CDN<br/>prefixos curtos, 60 s"]
    cdn --> gw["API gateway"]
    gw --> ac["Serviço de autocomplete<br/>índice em memória (réplicas)"]
    ac --> tr[("Cache<br/>camada de tendências")]
    u -. eventos de busca .-> st[["Stream de eventos<br/>logs de busca"]]
    st --> agg["Workers de agregação<br/>contagens com decaimento"]
    agg --> dwh[("Data warehouse<br/>contagens de buscas")]
    st --> trend["Job de tendências<br/>últimos 15 min"]
    trend --> tr
    dwh --> build["Construtor do índice<br/>(por hora / por dia)"]
    build --> obj[("Object store<br/>snapshots do índice")]
    obj -. carga + troca atômica .-> ac
```

Uma tecla, da digitação às sugestões:

``` mermaid-sim
sequenceDiagram
    autonumber
    participant U as Navegador
    participant C as CDN
    participant A as Serviço de autocomplete
    participant T as Cache de tendências
    U->>U: usuário digita "col", espera 120 ms (debounce)
    U->>C: GET /autocomplete?q=col
    alt prefixo em cache
        C-->>U: sugestões (da borda)
    else falta
        C->>A: GET /autocomplete?q=col
        A->>A: percorre a trie c → o → l, lê o top-8 (microssegundos)
        A->>T: tendências que começam com "col" (cópia local)
        A->>A: mescla, filtra a lista de bloqueio, deduplica
        A-->>C: 200, max-age=60
        C-->>U: sugestões
    end
    U->>U: descarta a resposta se o prefixo mudou nesse meio-tempo
```

---

## 6. Aprofundamentos (deep dives)

### 6.1 A estrutura de dados: trie com top-k por nó

Uma **trie** guarda strings caractere por caractere; todo caminho a partir da raiz é um prefixo. Achar as melhores complementações de `col` de forma ingênua significa andar até o nó `col` e depois visitar **toda a sua subárvore** para ranquear cada busca abaixo dele — lento demais para `c`, cuja subárvore é uma grande parte do índice.

A solução é **guardar as top-k complementações em cada nó** na hora da construção. Uma consulta vira: andar `len(prefixo)` nós e devolver a lista guardada ali — sem percorrer subárvores ([armazenamentos especializados](../../databases/specialized/index.md)):

```python exec="1" source="tabbed-right"
# A tiny trie that caches the top-k completions in every node
K = 3
counts = {                         # aggregated query counts (illustrative)
    "coldplay": 9_800, "coldplay sao paulo": 4_100, "coldplay rio": 2_900,
    "colombia festival": 600, "coala festival": 1_200, "concert tickets": 3_300,
    "maroon 5": 2_500, "madonna": 3_900, "maracana": 2_200, "marisa monte": 1_700,
    "metallica": 5_200, "metallica 2027": 1_100,
}

class Node:
    def __init__(self):
        self.children = {}
        self.top = []                # [(count, query)], best first, at most K

def insert(root, query, count):
    node = root
    for ch in query:
        node = node.children.setdefault(ch, Node())
        node.top = sorted(node.top + [(count, query)], reverse=True)[:K]

def suggest(root, prefix):
    node = root
    for ch in prefix:
        node = node.children.get(ch)
        if node is None:
            return []
    return [q for _, q in node.top]  # O(len(prefix)): no subtree walk at query time

root = Node()
for q, c in counts.items():
    insert(root, q, c)

print("| prefix | top_3 |\n|---|---|")
for p in ("c", "co", "col", "m", "ma", "mar", "x"):
    print(f"| `{p}` | {', '.join(suggest(root, p)) or '—'} |")
```

O preço é memória (k entradas por nó, a maioria repetida ao longo de um caminho) e **reconstruir em vez de atualizar**: mudar uma contagem pode mudar o top-k de todos os ancestrais. Por isso o índice é construído offline e servido só para leitura.

=== "Trie com top-k por nó"

    Consulta em O(tamanho do prefixo); compacta porque os prefixos são compartilhados; natural para "começa com". Atualizações são caras (as listas dos ancestrais), então ela é reconstruída como snapshot. Guarde IDs ou deslocamentos nas listas, não strings completas, para economizar memória.

=== "Tabela hash de prefixos"

    Pré-compute um mapa `prefixo → lista top-k` para cada prefixo (ex.: um hash no Redis ou um armazenamento chave-valor). Consulta O(1), trivial de fragmentar por chave e de servir a partir de qualquer KV; usa mais memória (sem compartilhamento entre prefixos) e tem o mesmo custo de reconstrução. Uma escolha pragmática quando você prefere não operar um serviço em memória próprio.

=== "FST / completion suggester"

    Um **transdutor de estados finitos** compartilha prefixos e sufixos, então é muito menor que uma trie; o completion suggester do Lucene (usado pelo Elasticsearch e pelo OpenSearch) constrói um por segmento do índice, com pesos e busca aproximada opcional. A resposta pronta para uma equipe que já opera um cluster de busca.

| | Trie + top-k | Tabela hash de prefixos | FST (motor de busca) |
|---|---|---|---|
| Consulta | O(tamanho do prefixo) | O(1) | O(tamanho do prefixo) |
| Memória | Média | A maior | **A menor** |
| Fragmentação | Por faixa de prefixo | Por chave (qualquer KV) | Por índice/shard do motor |
| Construção | Job próprio | Job próprio | Indexação do motor |
| Tolerância a erros | Própria | Difícil | Nativa (fuzzy) |

### 6.2 O pipeline de dados: dos logs aos snapshots

``` mermaid-sim
flowchart LR
    logs[["Eventos de busca<br/>stream"]] --> raw[("Logs brutos<br/>object store")]
    raw --> agg["Agregação diária<br/>contagem por busca normalizada"]
    agg --> decay["Pontuação com decaimento<br/>+ peso das seleções"]
    decay --> filt["Filtro<br/>contagem mínima, bloqueio"]
    filt --> build["Constrói o índice<br/>por idioma"]
    build --> snap[("Snapshot vN<br/>+ checksum")]
    snap --> canary["Nó canário<br/>verificações de sanidade"]
    canary --> fleet["Todos os nós<br/>carga + troca atômica"]
```

- **Normalize** as buscas (minúsculas, acentos, espaços) e **agregue** por dia; mantenha só as buscas acima de uma contagem mínima — isso remove erros de digitação, buscas avulsas e a maior parte dos dados pessoais (um e-mail digitado na caixa de busca nunca deveria virar sugestão).
- **Pontue com decaimento no tempo**: `score = Σ contagem_dia × 0,5^(idade_dias / meia_vida)`, ex.: meia-vida de 7 dias, mais um peso para **seleções** (uma sugestão em que as pessoas clicam é melhor do que uma que elas ignoram).
- **Construa** o índice por idioma num **snapshot** imutável no object storage, com checksum e um manifesto. Os nós de atendimento o baixam, montam a estrutura em memória **ao lado** da atual e trocam um ponteiro — uma **troca atômica**, sem lock no caminho de leitura e com **rollback** instantâneo para a versão anterior se as métricas caírem.
- **Valide antes de publicar**: tamanho dentro de ±10% da última construção, sugestões principais presentes para um conjunto fixo de prefixos, nenhum termo bloqueado — primeiro num nó canário ([trabalho assíncrono](../../compute/async-work/index.md)).

### 6.3 Atendendo em escala: replicar, cachear, fazer debounce

- **Replique primeiro.** Com ~6 GB por idioma, cada nó guarda o índice inteiro; acrescentar nós aumenta a vazão linearmente, e qualquer nó responde qualquer prefixo — sem roteamento, sem shards quentes.
- **Fragmente quando não couber mais**, por **faixa de prefixo** — mas pelo tráfego, não pelo alfabeto: `s` e `c` recebem muito mais tráfego que `x` e `q`, então divida faixas como `ca–ce`, `cf–cz` até cada shard ter carga parecida. Como alternativa, fragmente primeiro por idioma/região, que é uma divisão natural.
- **Caches em todas as camadas**: o navegador (`max-age=60` e um mapa em memória dos prefixos já vistos na sessão), a CDN para prefixos curtos e públicos, um pequeno LRU dentro do serviço para os prefixos mais quentes ([padrões de cache](../../caching/patterns/index.md)).
- **Disciplina no cliente**: debounce (~100–150 ms), começar só depois de 1–2 caracteres, cancelar requisições em andamento quando o prefixo muda e descartar respostas de prefixos velhos (respostas podem chegar fora de ordem).
- **Orçamento de latência**: de um p99 de 100 ms percebido pelo usuário, a ida e volta pela rede leva a maior parte; o serviço precisa responder em poucos milissegundos — o que uma estrutura em memória e só de leitura faz com facilidade, e uma consulta ao banco por tecla não.

### 6.4 Atualidade, filtragem e personalização

- **Camada de tendências.** Um índice diário não sabe de uma turnê anunciada há uma hora. Um **job de stream** conta as buscas numa janela deslizante (digamos 15 minutos) e marca as que crescem muito mais rápido que sua linha de base; os nós de atendimento mesclam essa lista pequena (centenas de entradas) com o top-k estático na hora da requisição ([Kafka e streams](../../messaging/kafka/index.md)).
- **A filtragem** acontece duas vezes: na construção (lista de bloqueio, contagem mínima) e **na hora de atender** (uma pequena lista de bloqueio enviada a todos os nós em minutos), porque remover uma sugestão ofensiva não pode esperar a construção de amanhã.
- **Entidades em vez de strings.** No BoxOffice, sugestões que apontam para um artista, local ou evento (com um ID) são mais úteis do que strings de busca cruas: construa parte do índice a partir do **catálogo** (nomes e apelidos, ponderados pelas vendas de ingressos) e mescle com o índice vindo dos logs.
- **A personalização** (buscas recentes, a cidade do usuário) é mesclada no cliente ou com uma pequena lista por usuário — assim a resposta compartilhada e cacheável continua igual para todo mundo.
- **A tolerância a erros** (`coldpaly`) exige busca aproximada — distância de edição 1 no FST, ou índices de n-gramas. Ela multiplica o trabalho por tecla, então aplique só depois de alguns caracteres ou quando houver poucos casamentos exatos.

---

## 7. Gargalos, modos de falha e trade-offs

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Volume de teclas | Uma requisição por caractere sobrecarrega a origem | Debounce, tamanho mínimo de prefixo, cancelar requisições velhas | Sugestões aparecem ~100 ms depois |
| Prefixos curtos | `a`, `c`, `s` são as chaves mais quentes | Cache no navegador/CDN; respostas pré-computadas num LRU local | Até 60 s de desatualização |
| Índice grande demais para um nó | Mais idiomas e tipos de entidade | Fragmentar por idioma, depois por faixa de prefixo balanceada pelo tráfego | Camada de roteamento, shards desiguais |
| Construção ruim | Índice vazio ou corrompido enviado a todos os nós | Checksums, verificação de tamanho, nó canário, manter o snapshot anterior para rollback | Rollout mais lento |
| Popularidade desatualizada | Turnê anunciada, sugestões não a mostram | Camada de tendências a partir do stream (minutos) | Mais um job para operar |
| Sugestões ofensivas | Buscas manipuladas ou ofensivas sobem para o topo | Lista de bloqueio na construção e no atendimento, contagem mínima, rate limit do registro de buscas por usuário | Alguns termos legítimos bloqueados |
| Respostas fora de ordem | A resposta de `co` chega depois da de `col` | O cliente descarta respostas que não batem com o prefixo atual | — |
| Serviço fora do ar | Caixa de busca sem sugestões | Degradar em silêncio; a busca continua funcionando | Experiência pior, sem indisponibilidade |

Os trade-offs para **dizer em voz alta**: **atualidade vs. simplicidade** (snapshots diários imutáveis mais uma pequena camada de tendências, em vez de um índice mutável), **memória vs. latência** (top-k guardado em cada nó), e **replicação vs. fragmentação** (replique enquanto couber em RAM; fragmente pelo tráfego quando não couber).

---

## 8. Experimente no playground

O cenário `search-autocomplete` coloca um serviço de busca atrás de um cache, com uma carga de teclas de muita leitura e com picos.

!!! tip "Experimente"

    1. Rode com o perfil **load**: anote a taxa de acerto do cache e o p99 do serviço de busca.
    2. Remova o cache (ou baixe sua taxa de acerto) e rode de novo: quanto mais carga chega ao serviço de busca? O p99 ainda cabe num orçamento por tecla de algumas dezenas de milissegundos?
    3. Mude para **spike** (um anúncio de turnê): acrescente réplicas do serviço de busca até o p99 se recuperar — o índice é replicado, então a vazão cresce com os nós.
    4. Ligue o caos para derrubar o serviço de busca: o autocomplete deve degradar (sem sugestões), nunca quebrar a página.

<div class="sdp" data-scenario="search-autocomplete" data-mode="full" data-height="640" data-profile="load"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz

??? question "Por que não rodar `SELECT … WHERE query LIKE 'col%' ORDER BY count DESC LIMIT 8` no banco?"

    Um índice B-tree em `query` acha a faixa `col…` rápido, mas depois precisa ler **todas** as linhas dessa faixa para ordenar pela contagem — para `c` isso é uma grande fração da tabela — a milhares de requisições por segundo. Pré-computar o top-k por prefixo leva essa ordenação para a construção offline, então o caminho online é uma leitura de tempo constante. Uma consulta ao banco por tecla também põe uma carga pesada e cheia de picos num sistema que tem coisas melhores para fazer.

??? question "Um artista novo explode nas redes sociais. Quão rápido as sugestões reagem?"

    O índice diário reage amanhã; a **camada de tendências** reage em minutos: um job de stream compara a contagem de cada busca nos últimos 15 minutos com sua linha de base e publica as que mais sobem num cache que todo nó de atendimento mescla na hora da requisição. Proteja-a contra manipulação (conte usuários distintos, não buscas brutas; volume mínimo; lista de bloqueio).

??? question "Como você mantém dados pessoais fora das sugestões?"

    As sugestões vêm só de buscas digitadas por **muitos usuários distintos** (um limiar no estilo k-anonimato), após a normalização; qualquer coisa que pareça um e-mail, telefone ou número de documento é descartada pelo pipeline; os logs brutos têm retenção curta. O histórico por usuário, se oferecido, fica por usuário e é mesclado no cliente.

??? question "Como você faria 'paulo' sugerir 'Coldplay São Paulo'?"

    Isso é casamento por **infixo**. Indexe cada palavra (ou cada sufixo da frase) como uma entrada adicional apontando para a mesma sugestão, ou use um índice de n-gramas/invertido num motor de busca. A memória cresce (várias entradas por sugestão), então restrinja isso aos nomes de entidades (artistas, locais, cidades) em vez de todas as buscas.

??? question "Como você publica um índice novo sem prejudicar a latência?"

    Construa offline, distribua o snapshot, faça cada nó carregá-lo em memória **ao lado** do atual (exige folga de memória para duas cópias), rode verificações e então troque uma referência atômica. Os leitores nunca travam; a cópia antiga é liberada quando as requisições em andamento terminam. Publique primeiro num nó canário e compare a taxa de cliques antes de ir para a frota toda.

??? question "Como você mediria se as sugestões são boas?"

    Métricas online: fração das buscas que usam uma sugestão, posição da sugestão clicada, teclas economizadas, buscas com zero resultados depois de uma sugestão. Offline: reexecute as buscas da semana passada contra o índice novo e verifique se a busca realmente feita aparece no top-k dos seus prefixos. Faça testes A/B das mudanças de ranqueamento.

---

## 10. Rubrica de autoavaliação

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Um endpoint que consulta o banco com `LIKE 'prefixo%'` e ordena pela contagem; talvez um cache. Ignora o volume de teclas e o orçamento de latência. |
| **Pleno** | Trie (ou tabela de prefixos) em memória com top-k por nó; construção offline a partir dos logs; cache e debounce; replicação do índice. |
| **Sênior** | Separa explicitamente o atendimento e o pipeline de dados; pontuação com decaimento no tempo e seleções; snapshots imutáveis com validação, canário e troca atômica; camada de tendências a partir de um stream; filtragem na construção e no atendimento; fragmentação por faixas de prefixo balanceadas pelo tráfego só quando necessário; cache no navegador/CDN com chaves normalizadas; personalização no cliente; respostas fora de ordem; métricas de qualidade. |

**Relacionados:** [Armazenamentos especializados](../../databases/specialized/index.md), [Padrões de cache](../../caching/patterns/index.md), [DNS e CDN](../../edge/dns-cdn/index.md), [Kafka e streams](../../messaging/kafka/index.md), [Hands-on 5](../../../hands-on/5/index.md) (cache).

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` mermaid
flowchart LR
    CASE(["Search autocomplete"]) --> EST["Estimation<br/>keystrokes, debouncing"]:::tech
    CASE --> EDG["Edge<br/>CDN for short prefixes"]:::tech
    CASE --> CMP["Compute<br/>in-memory service, index builders"]:::tech
    CASE --> DB["Databases<br/>trie with top-k, snapshots"]:::tech
    CASE --> CAC["Caching<br/>trending overlay"]:::tech
    CASE --> MSG["Messaging<br/>search logs as a stream"]:::tech
    EDG -.-> k1["cdn · apigw"]:::comp
    CMP -.-> k2["search · worker"]:::comp
    DB -.-> k3["dwh · objstore"]:::comp
    CAC -.-> k4["cache"]:::comp
    MSG -.-> k5["stream"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Borda — DNS e CDN](../../edge/dns-cdn/index.md) · [Compute — trabalho assíncrono](../../compute/async-work/index.md) · [Bancos de dados — especializados](../../databases/specialized/index.md) · [Caching — padrões](../../caching/patterns/index.md) · [Mensageria — Kafka](../../messaging/kafka/index.md) · [Estimativas — números](../../estimation/numbers/index.md). **Componentes da paleta:** [`cdn`](../../../reference/components/edge/index.md#cdn) · [`apigw`](../../../reference/components/edge/index.md#apigw) · [`search`](../../../reference/components/compute/index.md#search) · [`cache`](../../../reference/components/storage/index.md#cache) · [`stream`](../../../reference/components/messaging/index.md#stream) · [`worker`](../../../reference/components/compute/index.md#worker) · [`dwh`](../../../reference/components/storage/index.md#dwh) · [`objstore`](../../../reference/components/storage/index.md#objstore). **Cenários:** `search-autocomplete`.

---

## Referências

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 13 "Design a Search Autocomplete System"[^1].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed., capítulos sobre processamento em batch e dados derivados[^2].
- O completion suggester do Elasticsearch (baseado em FST)[^3].
- MANNING, C.; RAGHAVAN, P.; SCHÜTZE, H. *Introduction to Information Retrieval* — dicionários, recuperação tolerante e consultas com curingas[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly.
[^3]: [Completion suggester](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-suggesters.html#completion-suggester){target="_blank"}. Elasticsearch Reference.
[^4]: MANNING, C.; RAGHAVAN, P.; SCHÜTZE, H. [Introduction to Information Retrieval](https://nlp.stanford.edu/IR-book/){target="_blank"}, cap. 3. Cambridge University Press, 2008.
