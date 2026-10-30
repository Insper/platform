
> *"Projete o feed inicial de uma rede social como o Instagram ou o X: usuários seguem outros usuários e, ao abrir o app, veem as publicações mais recentes de quem seguem."*

O news feed é o problema clássico de **leitura intensa com fan-out**. Uma escrita (uma publicação) precisa ficar visível nos feeds de todos que seguem o autor — duas pessoas para a maioria dos usuários, cinquenta milhões para um astro pop. A entrevista gira em torno de uma decisão — **fazer o trabalho quando a publicação é escrita, ou quando o feed é lido?** — e do que acontece nos extremos dessa decisão: celebridades, usuários inativos, publicações apagadas e ranqueamento.

O BoxOffice tem o mesmo formato: fãs **seguem** artistas e locais, e a aba "Seguindo" mostra anúncios de turnês, novas datas e códigos de pré-venda. Quando um artista de estádio com milhões de seguidores anuncia uma turnê, o BoxOffice enfrenta exatamente o problema das celebridades desta página — no pior momento, porque todo mundo vai abrir o app ao mesmo tempo.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star::material-star: difícil |
| **Conceitos-chave** | fan-out na escrita (push) vs. na leitura (pull) vs. híbrido, o problema das celebridades, cache de timeline com IDs, hidratação, pipeline de ranqueamento, paginação por cursor, mídia via CDN |
| **Componentes da paleta** | [`lb`](../../../reference/components/edge/index.md#lb), [`app`](../../../reference/components/compute/index.md#app), [`cache`](../../../reference/components/storage/index.md#cache), [`nosql`](../../../reference/components/storage/index.md#nosql), [`kafka`](../../../reference/components/messaging/index.md#kafka), [`worker`](../../../reference/components/compute/index.md#worker), [`objstore`](../../../reference/components/storage/index.md#objstore), [`cdn`](../../../reference/components/edge/index.md#cdn) |
| **Cenário do playground** | `news-feed` |

!!! abstract "O que este caso treina"

    - **Estimar** a amplificação de escrita do fan-out e a memória de um cache de timelines.
    - **Comparar** fan-out na escrita, fan-out na leitura e o modelo híbrido, e **justificar** um limiar para celebridades.
    - **Projetar** o caminho de leitura: IDs da timeline vindos de um cache, hidratação com consultas em lote, mescla e ranqueamento dentro de um orçamento de latência.
    - **Explicar** por que feeds paginam com cursores, e não com offsets.
    - **Tratar** os casos de borda: usuários inativos, exclusões, mudanças de privacidade, usuários novos com feed vazio.

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

([roteiro de entrevista](../../intro/interview-framework/index.md))

### Requisitos funcionais { #functional-requirements }

1. Um usuário **publica** um post (texto, imagens/vídeo opcionais).
2. Um usuário **segue** / deixa de seguir outros usuários (assimétrico: seguir não é amizade).
3. Um usuário abre o **feed inicial**: posts de quem ele segue, os mais novos primeiro (ou ranqueados), paginados com rolagem infinita.
4. Os posts mostram autor, contadores (curtidas, comentários) e mídia.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta |
|---|---|
| **Latência** | Feed com p99 < 300 ms (é a primeira tela do app) |
| **Atualidade** | Um post novo aparece no feed dos seguidores em poucos segundos (consistência eventual serve) |
| **Escala** | 100 M de usuários ativos por dia; número de seguidores com cauda pesada (até dezenas de milhões) |
| **Disponibilidade** | 99,95%; um feed degradado (um pouco desatualizado, menos itens) é melhor que uma página de erro |
| **Durabilidade** | Um post publicado nunca se perde; os feeds em si podem ser reconstruídos |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Comentários e curtidas como funcionalidades (só mostramos os contadores), busca, notificações, ranqueamento de anúncios, mensagens diretas. Cada um é seu próprio problema de design.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Feed cronológico ou ranqueado? | Ranqueamento acrescenta um pipeline candidatos → pontuação → reordenação e muda o que você guarda em cache. |
    | Máximo de seguidores? Máximo de seguidos? | A cauda da distribuição decide entre push e pull. |
    | Quão atualizado o feed precisa ser? | Segundos permitem fan-out assíncrono; "imediatamente" empurra para o pull. |
    | Principalmente texto ou muita mídia? | Mídia vai para object storage + CDN; o feed carrega URLs. |
    | Quantos usuários são ativos por dia vs. cadastrados? | Fan-out para usuários inativos é trabalho e memória desperdiçados. |
    | Posts podem ser editados, apagados, tornados privados? | Cópias empurradas precisam ser filtradas ou invalidadas na leitura. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

```python exec="1" source="tabbed-right"
# News feed: assumptions (illustrative)
dau            = 100_000_000
posts_per_dau  = 0.2          # most users read, few post
reads_per_dau  = 10           # feed opens / refreshes per day
peak_factor    = 3
avg_followers  = 200          # average fan-out per post (the tail is much larger)
timeline_len   = 800          # post IDs kept per cached feed
id_b           = 8            # one post ID (64-bit)
cache_overhead = 2            # data-structure overhead in the cache
post_b         = 1_000        # text + metadata
media_share    = 0.1          # posts with an image
image_b        = 500_000

posts_day      = dau * posts_per_dau
write_qps      = posts_day / 86_400
read_qps       = dau * reads_per_dau / 86_400
peak_read_qps  = read_qps * peak_factor
fanout_qps     = write_qps * avg_followers          # timeline inserts per second (push)
timeline_gb    = dau * timeline_len * id_b * cache_overhead / 1e9
posts_tb_year  = posts_day * post_b * 365 / 1e12
media_tb_day   = posts_day * media_share * image_b / 1e12

rows = [
    ("posts_day", posts_day, "posts"), ("write_qps", write_qps, "posts/s"),
    ("read_qps", read_qps, "req/s"), ("peak_read_qps", peak_read_qps, "req/s"),
    ("fanout_qps", fanout_qps, "inserts/s"), ("timeline_gb", timeline_gb, "GB"),
    ("posts_tb_year", posts_tb_year, "TB"), ("media_tb_day", media_tb_day, "TB/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- As leituras (**~12 mil/s, ~35 mil/s no pico**) superam os posts (**~230/s**) em 50:1. ⇒ torne as leituras baratas, mesmo ao custo de mais trabalho nas escritas.
- Mas o fan-out por push transforma 230 posts/s em **~46 mil inserções de timeline/s** em média — e a média esconde a cauda: um post de uma conta com 50 M de seguidores são **50 M de inserções** sozinho. ⇒ o caminho de escrita precisa ser **assíncrono** (fila + workers), e celebridades precisam de tratamento especial.
- Timelines em cache de 800 IDs para cada usuário diário ocupam **~1,3 TB de RAM** — um cluster de cache grande, mas comum (dezenas de nós). Guardar só **IDs**, não os posts, é o que torna isso viável; guardar só para usuários **ativos** reduz ainda mais.
- Os posts somam **~7 TB/ano** (um armazenamento particionado), a mídia **~1 TB/dia** (object storage + CDN — nunca no banco).

---

## 3. API

```http
POST /v1/posts                               → 201 {postId, createdAt}
     {"text": "Tour announced! Presale Friday 10:00", "mediaIds": ["m_81f…"]}
POST /v1/media                               → 201 {mediaId, uploadUrl}   (pre-signed PUT to object store)

GET  /v1/feed?limit=20&cursor=eyJ0cyI6…      → 200 {items: [Post…], nextCursor}
GET  /v1/users/{id}/posts?cursor=…           → 200 {items: [Post…], nextCursor}   (profile timeline)

PUT    /v1/users/{id}/followers/me           → 204   (follow)
DELETE /v1/users/{id}/followers/me           → 204   (unfollow)
```

- **Cursor**, não número de página: `cursor` codifica `(score ou timestamp, postId)` do último item visto. Posts novos chegando no topo não deslocam as páginas (sem duplicatas, sem buracos) e a consulta é um seek no índice, não um `OFFSET 4000`.
- A mídia é enviada **diretamente** ao object storage com uma URL pré-assinada; o post só referencia o `mediaId`.

---

## 4. Modelo de dados { #4-data-model }

```sql
-- Posts: partitioned by author, newest first (wide-column, e.g. Cassandra)
CREATE TABLE posts_by_author (
    author_id  BIGINT,
    post_id    BIGINT,          -- Snowflake-style: time-ordered, unique
    text       TEXT,
    media      LIST<TEXT>,
    visibility TEXT,
    PRIMARY KEY ((author_id), post_id)
) WITH CLUSTERING ORDER BY (post_id DESC);

-- Social graph, stored in both directions
CREATE TABLE followers (user_id BIGINT, follower_id BIGINT, PRIMARY KEY ((user_id), follower_id));
CREATE TABLE following (user_id BIGINT, followee_id BIGINT, PRIMARY KEY ((user_id), followee_id));
```

```text
# Timeline cache (Redis sorted set, score = post timestamp), trimmed to 800 entries
feed:{user_id}   →  { (1767261600123, 918273645), (1767261598001, 918273511), ... }

# Post cache for hydration (hash per post) and counters
post:{post_id}   →  { author_id, text, media, created_at }
likes:{post_id}  →  1532
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Posts | NoSQL wide-column (`nosql`), partição = autor | Muita escrita, só inserção, leitura "últimos N do autor" — uma varredura de partição |
| Grafo social | Tabelas NoSQL nas duas direções (ou um serviço de grafo, estilo TAO) | "Seguidores de X" para o fan-out, "seguidos por Y" para o pull |
| Timelines iniciais | Cache (`cache`): sorted set de IDs por usuário | Reconstruível, lido a cada abertura do feed, ~1,3 TB |
| Objetos de post | Cache (`cache`) na frente do armazenamento de posts | A hidratação faz multi-gets de 20–50 posts por página do feed |
| Mídia | Object store (`objstore`) + CDN (`cdn`) | Blobs grandes e imutáveis, servidos na borda |
| Jobs de fan-out | Tópico Kafka (`kafka`) `post-created` | Desacopla a publicação do fan-out; absorve rajadas |

---

## 5. Design de alto nível { #5-high-level-design }

``` diagram-sim
flowchart LR
    u([App]) --> lb["Balanceador de carga"]
    lb --> ps["Serviço de posts"]
    ps --> pdb[("Armazenamento de posts<br/>por autor")]
    ps --> k[["Kafka<br/>post-created"]]
    k --> fw["Workers de fan-out"]
    fw --> g[("Grafo social<br/>seguidores")]
    fw --> tl[("Cache de timelines<br/>feed:{user} → IDs")]
    lb --> fs["Serviço de feed"]
    fs --> tl
    fs --> pc[("Cache de posts")]
    pc --> pdb
    fs --> rk["Ranqueamento"]
    u -. imagens .-> cdn["CDN"] --> obj[("Object store")]
```

**Caminho de escrita:** o serviço de posts grava o post e publica `post-created`; ele devolve `201` na hora. Os workers de fan-out leem os seguidores do autor em páginas e empurram o ID do post na timeline de cada seguidor **ativo** (`ZADD` + `ZREMRANGEBYRANK` para aparar).

**Caminho de leitura:**

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as App
    participant F as Serviço de feed
    participant T as Cache de timelines
    participant C as Posts de celebridades
    participant P as Cache de posts
    participant R as Ranqueamento
    A->>F: GET /v1/feed?limit=20
    F->>T: ZREVRANGE feed:42 0 199
    T-->>F: 200 IDs de posts (empurrados)
    F->>C: posts recentes das celebridades seguidas (pull)
    C-->>F: 30 IDs de posts
    F->>F: mescla, descarta apagados / bloqueados
    F->>P: multi-get de 230 posts (em lote)
    P-->>F: objetos de post
    F->>R: pontua os candidatos
    R-->>F: top 20
    F-->>A: 20 posts + nextCursor
```

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

### 6.1 Fan-out na escrita, na leitura ou os dois { #61-fan-out-on-write-on-read-or-both }

=== "Fan-out na escrita (push)"

    Quando um post é criado, insira seu ID na timeline pré-computada de cada seguidor. Ler o feed é uma única leitura de cache — **rápida e previsível**. Custos: amplificação de escrita proporcional aos seguidores, trabalho desperdiçado com seguidores que nunca entram e um atraso de minutos para uma conta com dezenas de milhões de seguidores.

=== "Fan-out na leitura (pull)"

    Guarde os posts só por autor. Quando um usuário abre o feed, busque os posts mais recentes de cada um de seus seguidos e mescle. As escritas são triviais e sempre atuais. Custos: cada abertura do feed faz **centenas de consultas** (uma por seguido, ou um scatter-gather pelas partições) — lento e caro a 35 mil leituras/s.

=== "Híbrido (o que as grandes redes fazem)"

    Push para autores comuns; **pull para celebridades** (autores acima de um limiar de seguidores). Na leitura, mescle a timeline empurrada com os posts mais recentes das poucas celebridades que o usuário segue — normalmente um punhado de consultas baratas e muito cacheadas (os posts recentes de uma celebridade são lidos por milhões, então estão sempre em cache).

| | Push | Pull | Híbrido |
|---|---|---|---|
| Latência de leitura | A menor (uma leitura de cache) | A maior (N consultas + mescla) | Baixa (leitura de cache + poucas leituras de celebridades) |
| Custo de escrita | Seguidores × posts | Uma inserção | Seguidores × posts, limitado pelo limiar |
| Atualidade | Segundos a minutos (fila) | Imediata | Segundos |
| Post de celebridade | Milhões de inserções | De graça | De graça (puxado) |
| Usuários inativos | Inserções desperdiçadas | De graça | Pule-os; reconstrua no login |

Quanto trabalho um limiar economiza? Com uma distribuição de seguidores de cauda pesada, uma fatia minúscula dos autores produz a maior parte do fan-out:

```python exec="1" source="tabbed-right"
# Who pays for push fan-out? Synthetic heavy-tailed follower counts (illustrative)
import random

random.seed(42)
authors = 200_000
followers = [min(50_000_000, int(60 / (1 - random.random()) ** 1.25)) for _ in range(authors)]
total = sum(followers)                  # timeline inserts if every author posts once
followers.sort()

print(f"median followers: {followers[authors // 2]:,}  ·  max: {followers[-1]:,}\n")
print("| threshold | celebrities | celebrities_pct | writes_avoided_pct |\n|---:|---:|---:|---:|")
for threshold in (10_000, 100_000, 1_000_000):
    celeb = [f for f in followers if f >= threshold]
    print(f"| {threshold:,} | {len(celeb):,} | {len(celeb) / authors:.2%} | {sum(celeb) / total:.1%} |")
```

Puxar os posts de uma fração de um por cento dos autores elimina a maior parte das escritas de fan-out. O limiar é um botão de ajuste: abaixe-o e as leituras ficam um pouco mais caras (mais celebridades para mesclar por usuário), suba-o e os posts de celebridades demoram mais para se espalhar.

### 6.2 O cache de timelines e a hidratação { #62-the-timeline-cache-and-hydration }

- **Guarde IDs, não posts.** Um post pode ser editado, apagado ou ter os contadores alterados; copiá-lo em 200 timelines faria de cada mudança um fan-out. Uma timeline é uma lista de `(score, post_id)`; o conteúdo é **hidratado** na leitura com um único multi-get em lote no cache de posts.
- **Apare** cada timeline para algumas centenas de entradas (`ZREMRANGEBYRANK`). Ninguém rola 5 000 posts para trás no feed inicial; o histórico mais antigo vem do caminho de pull.
- **Só usuários ativos.** Os workers de fan-out pulam usuários que não abrem o app há, digamos, 30 dias. Quando um deles volta, o serviço de feed **reconstrói** a timeline com um pull (lento uma vez, depois em cache) — um caminho clássico de falta no cache ([padrões de cache](../../caching/patterns/index.md)).
- **Filtre na leitura.** Posts apagados, autores bloqueados e posts que viraram privados são removidos durante a hidratação (o cache de posts diz `deleted`), então a timeline em si nunca precisa ser limpa de forma síncrona.
- **Particione** o cache de timelines por `user_id` (hash consistente); o feed de um usuário mora num shard, então a leitura é uma única ida e volta.

### 6.3 Ranqueamento { #63-ranking }

Um feed cronológico é "ordenar por tempo". Um feed ranqueado é um pequeno pipeline que precisa caber no orçamento de latência:

``` diagram-sim
flowchart LR
    cand["Candidatos<br/>~500 IDs<br/>(empurrados + puxados)"] --> feat["Features<br/>afinidade com o autor, idade,<br/>engajamento, tipo de mídia"]
    feat --> score["Modelo de pontuação<br/>(leve)"]
    score --> rerank["Reordenação<br/>diversidade, deduplicação,<br/>regras de negócio"]
    rerank --> page["Top 20"]
```

- A **geração de candidatos** é a timeline (push + pull); as features vêm de armazenamentos pré-computados (a afinidade entre usuário e autor é calculada offline), nunca de consultas caras ao vivo.
- Pré-compute quando possível: ranqueie a primeira página **quando é provável que o usuário abra o app** (ou logo após o fan-out) e guarde em cache por alguns minutos.
- Mantenha um **fallback**: se o serviço de ranqueamento estiver lento, devolva a ordem cronológica. Um feed menos esperto mas no prazo é melhor do que um spinner ([padrões de confiabilidade](../../reliability/patterns/index.md)).

### 6.4 Paginação e atualidade { #64-pagination-and-freshness }

- **Paginação por cursor**: o cursor é `(score, post_id)` do último item; a próxima página é `ZREVRANGEBYSCORE feed:42 (score -inf LIMIT 0 20`. Posts novos chegando no topo não deslocam a próxima página, ao contrário do `OFFSET`.
- **Posts novos durante a rolagem** aparecem num aviso "novos posts" que recarrega do topo (uma requisição separada com `since=`), e não são inseridos embaixo do dedo do usuário.
- **Ler as próprias escritas:** depois de publicar, o autor precisa ver o post no próprio feed na hora, mesmo que o fan-out leve segundos — insira-o de forma síncrona na timeline do próprio autor, ou mescle os posts mais recentes do autor na leitura ([modelos de consistência](../../distributed/consistency/index.md)).

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Post de celebridade | Milhões de inserções; seguidores o veem minutos depois | Híbrido: pull acima de um limiar | As leituras mesclam algumas fontes a mais |
| Workers de fan-out | Atraso na fila após uma rajada de posts; feeds desatualizados | Escalar consumidores pelo lag; particionar `post-created` por autor; priorizar usuários ativos | Mais workers, mais custo |
| Perda de um shard do cache de timelines | Usuários desse shard recebem feeds vazios | Réplicas; reconstruir na falta via pull; degradar para "mais recentes dos seguidos" | Primeiro carregamento lento após o failover |
| Fan-out da hidratação | O feed precisa de 200+ consultas de posts | Multi-get em lote; cache de posts; hidratar só os melhores candidatos | O ranqueamento vê menos features |
| Serviço de ranqueamento lento | p99 do feed acima do orçamento | Timeout + fallback para cronológico; primeira página pré-computada | Feed menos relevante |
| Post quente | Post viral lido por milhões; sua chave no cache fica quente | Replicar chaves quentes; cache local em processo por segundos | Contadores um pouco desatualizados |
| Exclusões / privacidade | Post removido continua nas timelines | Filtrar na leitura pelo estado do post; limpeza preguiçosa | Pouco trabalho extra por leitura |
| Tráfego de mídia | A banda domina a conta | CDN, tamanhos de imagem responsivos, lazy loading | Custo de CDN, invalidação de edições |

Os trade-offs para **dizer em voz alta**: **amplificação de escrita vs. latência de leitura** (o push paga na escrita para as leituras serem baratas), **atualidade vs. custo** (fan-out assíncrono significa segundos de atraso), e **relevância vs. latência** (o ranqueamento precisa cair para o cronológico quando está lento).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

O cenário `news-feed` contém o serviço de posts, um caminho de fan-out por uma fila e workers, um cache de timelines e o serviço de feed.

!!! tip "Experimente"

    1. Rode com o perfil **load**; anote o p99 do feed, a taxa de acerto do cache e o backlog do fan-out (profundidade da fila / lag dos consumidores).
    2. Aumente a fração de escritas (ou mude para **spike**) para simular o post de uma celebridade: o backlog cresce? Quanto tempo até escoar — essa é a atualidade que seus usuários veem.
    3. Acrescente workers e veja o backlog escoar mais rápido; depois remova o cache de timelines e veja o caminho de leitura desabar sobre o banco (isso é fan-out na leitura).
    4. Ligue o caos para deixar os workers lentos: as leituras devem continuar funcionando com timelines desatualizadas — o sistema degrada em vez de falhar.

<div class="sdp" data-scenario="news-feed" data-mode="full" data-height="640" data-profile="load"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "Um usuário segue 5 000 contas, 300 delas celebridades. O híbrido ainda funciona?"

    Mesclar 300 timelines de celebridades a cada leitura seria lento. Opções: limitar o número de fontes puxadas por leitura (pegar as 50 celebridades mais recentes/mais relevantes por afinidade), pré-computar um "resumo de celebridades" por usuário a cada poucos minutos, ou abaixar o limiar de push para usuários com muitos seguidos famosos. Casos de borda como este são o motivo de sistemas reais decidirem push vs. pull **por par (autor, seguidor)**, e não só por autor.

??? question "Um usuário volta depois de seis meses. O que faz a primeira abertura do feed?"

    A timeline dele não está no cache (o fan-out pulou usuários inativos). O serviço de feed a constrói com **fan-out na leitura**: busca posts recentes dos seguidos (em paralelo, com limite de tempo), mescla, ranqueia, devolve a primeira página e grava a timeline no cache para as próximas aberturas serem rápidas. A primeira abertura é mais lenta (digamos 500 ms em vez de 100 ms) — mostre uma tela de esqueleto.

??? question "Como você apaga um post que foi empurrado para dez milhões de timelines?"

    Você não mexe nas timelines de forma síncrona. Marque o post como apagado no armazenamento de posts e no cache de posts; a hidratação o descarta, então ele some de todos os feeds na próxima leitura. Um job em segundo plano pode remover o ID das timelines depois, mas é opcional: as timelines são aparadas e a entrada envelhece e sai de qualquer jeito.

??? question "Como você mostraria contadores de curtidas que atualizam em tempo real?"

    Contadores são uma preocupação separada, de muita escrita. Mantenha-os num serviço de contadores com **contadores fragmentados** (ou `INCR` no Redis por post, agregado periodicamente no banco), aceite alguns segundos de desatualização e envie atualizações só para posts visíveis na tela (via WebSocket/SSE), se tanto. Nunca guarde a contagem dentro da timeline.

??? question "O que muda para um usuário novo que não segue ninguém?"

    O feed de **partida a frio** vem de recomendações: posts populares na região, contas parecidas com as que ele escolheu no cadastro, conteúdo em alta. Arquiteturalmente, é uma fonte de candidatos diferente plugada no mesmo pipeline de ranqueamento.

??? question "Como você leva isso para várias regiões?"

    Os usuários são atendidos pela região de origem. Os posts são replicados de forma assíncrona entre regiões; o fan-out roda em cada região para os seguidores que moram lá (um post criado em São Paulo é espalhado em Frankfurt para os seguidores europeus). As timelines são caches por região e podem ser reconstruídas; alguns segundos de atraso entre regiões são aceitáveis para um feed.

??? question "Por que não guardar as timelines no banco em vez de num cache?"

    Dá (alguns sistemas mantêm uma timeline materializada durável num armazenamento wide-column), mas timelines são **dados derivados**: sempre podem ser recalculadas a partir dos posts e do grafo. Mantê-las em memória deixa o caminho quente rápido; torná-las duráveis compra uma recuperação mais rápida após a perda do cache, ao custo de carga de escrita no banco. Os dois são defensáveis se você disser por quê.

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Tabelas de posts e de seguidores; o feed como uma consulta `SELECT … WHERE author IN (seguidos) ORDER BY time LIMIT 20`; um cache na frente. Não percebe o custo em escala. |
| **Pleno** | Fan-out na escrita com fila e workers; cache de timelines com IDs; reconhece o problema das celebridades e propõe o híbrido; paginação por cursor; mídia na CDN. |
| **Sênior** | Quantifica a amplificação de escrita e a memória; escolhe um limiar com argumentos; projeta a hidratação, a filtragem na leitura, o fan-out só para ativos e a reconstrução na falta; pipeline de ranqueamento com orçamento de latência e fallback; ler as próprias escritas para o autor; modos de falha (lag dos workers, perda do cache) e fan-out multirregião. |

**Relacionados:** [Mensageria](../../messaging/kafka/index.md), [Padrões de cache](../../caching/patterns/index.md), [Particionamento](../../databases/partitioning/index.md), [Hands-on 7](../../../hands-on/7/index.md) (processamento assíncrono com Kafka), [Hands-on 5](../../../hands-on/5/index.md) (cache).

!!! success "Boas práticas"

    - **Guarde ids de posts nas timelines, não o conteúdo** — uma timeline de 800 ids tem poucos kilobytes; o conteúdo vem do seu próprio cache e é editado num só lugar.
    - **Limite o tamanho de cada timeline em cache** — algumas centenas de entradas cobrem quase toda sessão e mantêm limitada a memória por usuário.
    - **Passe para fan-out na leitura acima de um limite de seguidores** — um post de celebridade não pode virar milhões de escritas; misture os dois na leitura.
    - **Torne os workers de fan-out idempotentes e retomáveis** — um worker que cai no meio não pode inserir o mesmo post duas vezes numa timeline.
    - **Versione o modelo de ranking e registre o que foi mostrado** — "por que eu vi isto?" precisa da versão do modelo e dos candidatos, não só do resultado.

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["News feed"]) --> EST["Estimation<br/>fan-out write amplification"]:::tech
    CASE --> MSG["Messaging<br/>post events, fan-out workers"]:::tech
    CASE --> CAC["Caching<br/>timeline cache, hydration"]:::tech
    CASE --> DB["Databases<br/>partition posts and timelines"]:::tech
    CASE --> DIS["Distributed<br/>read-your-writes for the author"]:::tech
    CASE --> REL["Reliability<br/>fallback to chronological order"]:::tech
    MSG -.-> k1["kafka · worker"]:::comp
    CAC -.-> k2["cache"]:::comp
    DB -.-> k3["nosql · objstore · cdn"]:::comp
    REL -.-> k4["app · lb"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Mensageria — Kafka](../../messaging/kafka/index.md) · [Caching — padrões](../../caching/patterns/index.md) · [Bancos de dados — particionamento](../../databases/partitioning/index.md) · [Distribuídos — consistência](../../distributed/consistency/index.md) · [Confiabilidade — padrões](../../reliability/patterns/index.md) · [Hands-on 5](../../../hands-on/5/index.md) e [Hands-on 7](../../../hands-on/7/index.md). **Componentes da paleta:** [`lb`](../../../reference/components/edge/index.md#lb) · [`app`](../../../reference/components/compute/index.md#app) · [`cache`](../../../reference/components/storage/index.md#cache) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`worker`](../../../reference/components/compute/index.md#worker) · [`objstore`](../../../reference/components/storage/index.md#objstore) · [`cdn`](../../../reference/components/edge/index.md#cdn). **Cenários:** `news-feed`.

---

## Referências { #references }

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 11 "Design a News Feed System"[^1].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. — o exemplo da timeline inicial (fan-out na escrita vs. na leitura) no capítulo sobre descrever a carga[^2].
- KRIKORIAN, R. *Timelines at Scale* — como o Twitter combinou push e pull[^3].
- BRONSON, N. et al. *TAO: Facebook's Distributed Data Store for the Social Graph*[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly.
[^3]: KRIKORIAN, R. [Timelines at Scale](https://www.infoq.com/presentations/Twitter-Timeline-Scalability/){target="_blank"}. QCon San Francisco, 2012 (InfoQ).
[^4]: BRONSON, N. et al. [TAO: Facebook's Distributed Data Store for the Social Graph](https://www.usenix.org/conference/atc13/technical-sessions/presentation/bronson){target="_blank"}. USENIX ATC, 2013.
