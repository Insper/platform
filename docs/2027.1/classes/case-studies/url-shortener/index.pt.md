
> *"Projete um encurtador de URLs como o bit.ly ou o TinyURL: o usuário envia uma URL longa e recebe uma curta; quem abrir a URL curta é redirecionado para a original."*

O encurtador de URLs é o "hello world" das entrevistas de system design, e costuma ser o **primeiro** problema de um júnior ou o **aquecimento** numa rodada sênior. Parece trivial — uma consulta chave-valor — e essa é justamente a armadilha: o entrevistador quer ver se você **conduz** a conversa (requisitos, números, API, dados, design, aprofundamentos) em vez de pular direto para "usa um hash". Ele exercita três ideias que você vai reutilizar em quase todos os outros casos: **geração de IDs únicos**, **cache para leitura intensa** e **tirar o trabalho secundário (analytics) do caminho crítico**.

O BoxOffice também usa um: o SMS "seus ingressos para sábado" traz um link curto como `https://bx.example/aB3x9Kq`, porque um SMS tem 160 caracteres e uma URL de ingresso assinada tem 300.

| | |
|---|---|
| **Dificuldade** | :material-star: fácil (aquecimento, favorito para júnior) |
| **Conceitos-chave** | codificação base62, geração de IDs únicos (faixas de contador, Snowflake, serviço gerador de chaves) vs. hash, colisões, 301 vs. 302, cache-aside para links quentes, analytics de cliques assíncrono |
| **Componentes da paleta** | [`dns`](../../../reference/components/edge/index.md#dns), [`lb`](../../../reference/components/edge/index.md#lb), [`app`](../../../reference/components/compute/index.md#app), [`cache`](../../../reference/components/storage/index.md#cache), [`nosql`](../../../reference/components/storage/index.md#nosql), [`kafka`](../../../reference/components/messaging/index.md#kafka), [`analytics`](../../../reference/components/compute/index.md#analytics) |
| **Cenário do playground** | `url-shortener` |

!!! abstract "O que este caso treina"

    - **Executar** o roteiro completo de entrevista num problema pequeno, em 35–45 minutos.
    - **Estimar** taxas de leitura/escrita, armazenamento em cinco anos e o tamanho do conjunto quente.
    - **Comparar** estratégias de geração de IDs (hash, contador + base62, serviço gerador de chaves, Snowflake) quanto a colisões, coordenação e previsibilidade.
    - **Projetar** um caminho de redirecionamento que atende a maioria das requisições pelo cache e **justificar** 301 vs. 302.
    - **Tirar** o analytics de cliques do caminho crítico com um stream de eventos.

---

## 1. Esclarecer os requisitos

Mesmo num problema "simples", gaste 3–5 minutos aqui ([roteiro de entrevista](../../intro/interview-framework/index.md)). Os requisitos decidem se os códigos podem ser previsíveis, se o analytics precisa ser exato e se a mesma URL longa sempre recebe o mesmo código.

### Requisitos funcionais

1. **Encurtar**: dada uma URL longa, devolver uma URL curta com um código único (ex.: 7 caracteres).
2. **Redirecionar**: `GET /{code}` manda o navegador para a URL longa.
3. **Alias personalizado** (opcional): o usuário escolhe o código (`/boxoffice-rock-in-rio`).
4. **Expiração** (opcional): links podem expirar numa data.
5. **Estatísticas de cliques**: número de cliques por link, por dia, por país.

### Requisitos não funcionais

| Qualidade | Meta |
|---|---|
| **Latência** | Redirecionamento com p99 < 100 ms (ele fica na frente de cada clique) |
| **Disponibilidade** | 99,99% para redirecionamentos — um link curto quebrado quebra a campanha, o SMS, o QR code impresso |
| **Escala** | 100 M de links novos por mês; leitura intensa (100:1) |
| **Durabilidade** | Um link criado funciona por anos (até expirar) |
| **Segurança** | Códigos não devem ser fáceis de adivinhar (sem enumeração de links privados); bloquear destinos maliciosos |
| **Analytics** | Eventualmente consistente; minutos de atraso são aceitáveis; pequenas perdas também |

### Fora do escopo (diga explicitamente)

Contas de usuário e interface de edição de links, cobrança, geração de QR code, testes A/B de destinos. São funcionalidades em cima do mesmo núcleo.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Quantos links novos por mês? Qual a razão leitura:escrita? | Dimensiona tudo: QPS, armazenamento, cache. |
    | Quão curto precisa ser o código? Quais caracteres? | 7 caracteres em base62 dão 3,5 trilhões de códigos; base64 acrescenta `+` e `/` (inseguros em URLs). |
    | A mesma URL longa duas vezes → mesmo código ou um novo? | Determinístico (hash) vs. único por requisição (contador). Estatísticas por usuário normalmente exigem códigos distintos. |
    | Os códigos precisam ser imprevisíveis? | Contadores sequenciais vazam volume e permitem enumeração. |
    | O analytics precisa ser exato? Em tempo real? | Exato + tempo real é caro; aproximado + com atraso é barato. |
    | Links expiram? Podem ser apagados? | Jobs de limpeza, invalidação de cache, reuso de códigos (em geral: nunca reutilize). |

---

## 2. Estimativas de guardanapo (back-of-the-envelope)

Declare as premissas e depois calcule. Todos os números são ilustrativos — abra a aba *Source*, mude um e recalcule.

```python exec="1" source="tabbed-right"
# URL shortener: assumptions (illustrative)
new_per_month = 100_000_000   # new short links per month
read_write    = 100           # redirects per created link
peak_factor   = 3             # peak / average traffic
years         = 5             # retention
record_b      = 500           # code + long URL + metadata, bytes
hot_fraction  = 0.2           # share of a day's redirects worth caching (80/20 rule)
click_b       = 200           # one click event (code, time, country, referrer)

write_qps  = new_per_month / (30 * 86_400)
read_qps   = write_qps * read_write
peak_read  = read_qps * peak_factor
records    = new_per_month * 12 * years
storage_tb = records * record_b / 1e12
codes_7    = 62 ** 7
used_pct   = records / codes_7 * 100
cache_gb   = read_qps * 86_400 * hot_fraction * record_b / 1e9
clicks_gb  = read_qps * 86_400 * click_b / 1e9

rows = [
    ("write_qps", write_qps, "req/s"), ("read_qps", read_qps, "req/s"),
    ("peak_read", peak_read, "req/s"), ("records", records, "links"),
    ("storage_tb", storage_tb, "TB"), ("codes_7", codes_7, "codes"),
    ("used_pct", used_pct, "%"), ("cache_gb", cache_gb, "GB"),
    ("clicks_gb", clicks_gb, "GB/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- **~40 escritas/s** e **~4 mil redirecionamentos/s** (pico ~12 mil/s): um único banco aguentaria as escritas; é para as leituras que projetamos. ⇒ **cache** na frente do armazenamento, servidores de aplicação **sem estado** atrás de um balanceador de carga.
- **6 bilhões de links, ~3 TB em 5 anos**: é demais para ficar confortável num nó só com réplicas e índices, e trivial para um armazenamento chave-valor particionado. O padrão de acesso é uma **consulta por chave única**, então um banco KV (DynamoDB, Cassandra) ou uma tabela SQL fragmentada funcionam.
- **7 caracteres base62 = 3,5 trilhões de códigos**; usamos 0,17% deles em 5 anos. Códigos curtos não são o recurso escasso — **unicidade sem coordenação** é o problema de design.
- O conjunto quente tem **~33 GB**: cabe na RAM de um ou dois nós de cache. Com popularidade do tipo Zipf (poucos links recebem a maioria dos cliques), a taxa de acerto será alta.
- Os eventos de clique somam **~67 GB/dia** — mais do que os próprios links. ⇒ eles vão para um stream e um armazenamento de analytics, nunca para a tabela principal.

!!! tip "Na entrevista"

    Diga a conclusão, não só o número: *"4 mil leituras por segundo contra 40 escritas, e o conjunto quente cabe em memória — então é um problema de cache com um problema de geração de IDs acoplado."*

---

## 3. API

```http
POST /v1/urls                          → 201 {code, shortUrl, expiresAt}
     {"longUrl": "https://boxoffice.example/events/42?utm_source=sms",
      "customAlias": null, "expiresAt": "2027-12-31T23:59:59Z"}
     (409 ALIAS_TAKEN, 422 INVALID_URL, 429 TOO_MANY_REQUESTS)

GET  /{code}                           → 302 Found, Location: <longUrl>
                                         (404 not found, 410 Gone when expired)

GET  /v1/urls/{code}/stats?from=…&to=… → 200 {clicks, byDay[], byCountry[]}
DELETE /v1/urls/{code}                 → 204   (owner only)
```

- A criação é autenticada (chave de API ou token de usuário) e tem **rate limit** por cliente — encurtadores são uma ferramenta favorita de spammers.
- O redirecionamento é público e faz **uma coisa só**: consultar e responder. Todo o resto (contagem, geolocalização, detecção de bots) acontece de forma assíncrona.

---

## 4. Modelo de dados

O padrão de acesso central é `code → longUrl`, uma consulta pontual pela chave primária, milhares de vezes por segundo, sobre bilhões de linhas. Sem joins, sem varreduras por faixa.

```sql
-- Logical model (a KV/wide-column table, or a sharded SQL table)
CREATE TABLE short_url (
    code        VARCHAR(16) PRIMARY KEY,   -- partition key
    long_url    TEXT        NOT NULL,
    owner_id    BIGINT,
    created_at  TIMESTAMP   NOT NULL,
    expires_at  TIMESTAMP
);

-- Only for the counter-based generator: one row per range allocation
CREATE TABLE id_range (
    name        VARCHAR(32) PRIMARY KEY,   -- 'short_url'
    next_start  BIGINT      NOT NULL
);
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| `code → long_url` | NoSQL chave-valor / wide-column (`nosql`), particionado por `code` | Consultas pontuais, escala horizontal, sem joins; 3 TB espalhados pelos nós |
| Códigos quentes | Cache (`cache`), cache-aside, TTL de horas | Conjunto quente de ~33 GB; a maioria dos redirecionamentos nunca toca o banco |
| Faixas de IDs | Pequena tabela SQL ou um serviço de coordenação (etcd, ZooKeeper) | Poucas escritas por minuto; precisa de incrementos atômicos |
| Eventos de clique | Kafka (`kafka`) → armazenamento de analytics / data warehouse | Alto volume, só inserção, lidos de forma agregada |

!!! example "Por que não um PostgreSQL só?"

    Para os links de SMS do próprio BoxOffice (milhares por dia), uma tabela PostgreSQL com uma B-tree em `code` é perfeita. Para 100 M de links por mês a resposta continua "SQL funciona", desde que você fragmente por `code` — o objetivo da entrevista é mostrar que você sabe **quando** um único nó deixa de bastar e **pelo quê** você particionaria.

---

## 5. Design de alto nível

``` mermaid-sim
flowchart LR
    u([Navegador / app]) --> dns["DNS"]
    dns --> lb["Balanceador de carga"]
    lb --> app["App encurtador<br/>(sem estado, N réplicas)"]
    app --> cache[("Cache<br/>códigos quentes")]
    app --> db[("NoSQL<br/>code → long_url")]
    app --> ids["Alocador de IDs<br/>(faixas)"]
    app -. evento de clique .-> k[["Kafka<br/>cliques"]]
    k --> agg["Workers de analytics<br/>agregam"]
    agg --> dwh[("Armazenamento de analytics")]
```

O **caminho de escrita** pede um código ao alocador de IDs (de uma faixa já reservada em memória — na maioria das vezes sem chamada de rede), grava a linha e devolve a URL curta. O **caminho de leitura** está abaixo; repare que o evento de clique é disparado depois da resposta e nunca espera.

``` mermaid-sim
sequenceDiagram
    autonumber
    participant B as Navegador
    participant A as App encurtador
    participant C as Cache
    participant D as NoSQL
    participant K as Kafka
    B->>A: GET /aB3x9Kq
    A->>C: GET url:aB3x9Kq
    alt acerto no cache (a maioria)
        C-->>A: long_url
    else falta no cache
        C-->>A: nil
        A->>D: get(code = aB3x9Kq)
        D-->>A: long_url, expires_at
        A->>C: SET url:aB3x9Kq long_url EX 86400
    end
    A-->>B: 302 Location: long_url
    A-)K: clique {code, ts, ip, user-agent}
```

---

## 6. Aprofundamentos (deep dives)

### 6.1 Gerando o código

Este é o aprofundamento que todo entrevistador espera. Quatro famílias, cada uma com um trade-off diferente:

=== "Hash + truncamento"

    `base62(sha256(longUrl))[:7]`. Determinístico: a mesma URL dá o mesmo código, então duplicatas saem de graça. Mas 7 caracteres guardam só ~42 bits do hash, então **colisões** acontecem e precisam ser detectadas: insira com uma escrita condicional (`IF NOT EXISTS`); em caso de conflito, calcule o hash de `longUrl + salt` e tente de novo. Dois usuários que encurtam a mesma URL compartilham o código — e as estatísticas.

=== "Contador + base62"

    Um inteiro único, codificado em base62. Sem colisões por construção. O problema é o **contador**: uma sequência única é gargalo e ponto único de falha. Resolva com **alocação por faixas**: cada servidor de aplicação reserva um bloco (ex.: 10 000 ids) com uma atualização atômica e os distribui a partir da memória. Uma queda desperdiça no máximo um bloco — inofensivo com 3,5 trilhões de códigos.

    ```sql
    UPDATE id_range SET next_start = next_start + 10000
     WHERE name = 'short_url'
    RETURNING next_start - 10000 AS block_start;
    ```

=== "Serviço gerador de chaves (KGS)"

    Um serviço separado pré-gera códigos aleatórios não usados numa tabela e entrega lotes aos servidores de aplicação, marcando-os como usados. Códigos imprevisíveis, sem colisões no caminho da requisição. Custos: mais um serviço com estado para replicar, e cuidado para dois servidores nunca receberem o mesmo lote (mover as chaves de `unused` para `used` de forma atômica).

=== "IDs estilo Snowflake"

    IDs de 64 bits formados por `timestamp | id da máquina | sequência` ([Twitter Snowflake](https://github.com/twitter-archive/snowflake){target="_blank"}): gerados localmente, aproximadamente ordenados no tempo, sem coordenação além de atribuir IDs às máquinas. Em base62, um ID de 64 bits precisa de até **11 caracteres** — mais que 7. Bom para IDs internos, menos bom quando ser curto é o produto.

| Estratégia | Colisões | Coordenação | Previsível? | Tamanho do código | Mesma URL → mesmo código |
|---|---|---|---|---|---|
| Hash + truncamento | Sim, precisa repetir | Nenhuma (mas uma escrita condicional) | Não | 7 | Sim |
| Contador + base62 (faixas) | Não | Uma atualização atômica por bloco | **Sim** (sequencial) | 7 | Não |
| KGS | Não | Serviço KGS | Não | 7 | Não |
| Snowflake | Não | Só IDs de máquina | Em parte (ordenado no tempo) | ~11 | Não |

A codificação base62 em si são poucas linhas:

```python
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

def base62(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n, 62)
        s = ALPHABET[r] + s
    return s or "0"

# 62**7 = 3_521_614_606_208 codes; base62(3_521_614_606_207) == "ZZZZZZZ"
```

!!! warning "Códigos sequenciais vazam informação"

    Com um contador simples, `aB3x9Kq` é seguido de `aB3x9Kr`: qualquer um enumera links (inclusive privados) e estima seu volume. Mantenha o contador, mas **embaralhe-o** com uma bijeção antes de codificar — ex.: multiplique por uma constante grande coprima com 62 (ímpar e não múltipla de 31) módulo 62^7, ou use uma pequena cifra de Feistel — para que ids consecutivos gerem códigos sem relação, ainda sem colisões.

**Recomendação para a entrevista:** contador com alocação por faixas + embaralhamento para códigos gerados; uma inserção condicional (`IF NOT EXISTS`) para aliases personalizados. Cite o hash e por que você não o escolheu (colisões, estatísticas compartilhadas).

### 6.2 O redirecionamento: 301 ou 302, e o cache

| | 301 Moved Permanently | 302 Found (ou 307) |
|---|---|---|
| O navegador guarda em cache? | Sim, potencialmente para sempre | Não (a menos que o `Cache-Control` diga) |
| Carga nos nossos servidores | Menor: cliques repetidos nunca chegam até nós | Todo clique chega até nós |
| Analytics | Subconta visitas repetidas | Completo |
| Mudar/expirar o link depois | Difícil: navegadores guardam a resposta antiga | Fácil |

A maioria dos encurtadores comerciais responde **302** (ou 301 com um `Cache-Control: max-age` curto) porque o analytics e a capacidade de desativar um link malicioso fazem parte do produto. Seja qual for a escolha, **diga por quê** ([semântica HTTP](../../edge/protocols/index.md)).

Cache da consulta ([cache-aside](../../caching/patterns/index.md)):

- **Cache-aside** com TTL de horas: o mapeamento quase nunca muda, então dados desatualizados não são problema; ao apagar ou expirar, remova a chave explicitamente.
- **Cache negativo**: guarde "não encontrado" por pouco tempo (`url:zzzzzzz → ∅`, 60 s); senão um bot varrendo códigos aleatórios vai direto ao banco.
- **Popularidade Zipf**: um link viral pode receber milhares de cliques por segundo — uma **chave quente** num shard do cache. Mitigue com um pequeno cache em processo (L1, alguns segundos) em cada servidor de aplicação, na frente do cache compartilhado.
- **Expiração**: verifique `expires_at` em toda leitura (guardado no cache junto com a URL) e responda `410 Gone`; um job em segundo plano apaga as linhas expiradas depois.

### 6.3 Analytics de cliques fora do caminho crítico

Contar cliques de forma síncrona (`UPDATE stats SET clicks = clicks + 1`) transformaria cada leitura numa escrita sobre uma linha quente. Em vez disso:

``` mermaid-sim
flowchart LR
    app["App encurtador"] -->|"dispara e esquece<br/>evento de clique"| k[["Tópico Kafka clicks<br/>particionado por code"]]
    k --> s["Agregação em stream<br/>janelas de 1 min"]
    s --> olap[("Armazenamento de analytics<br/>cliques por código/dia/país")]
    k --> lake[("Object store<br/>eventos brutos")]
    olap --> api["GET /stats"]
```

- O app produz o evento **depois** de responder (ou acumula em memória e envia em lotes): o redirecionamento não depende do Kafka estar saudável. Se o Kafka cair, descarte ou acumule — o analytics pode perder alguns eventos; os redirecionamentos não podem falhar ([semântica de mensageria](../../messaging/semantics/index.md)).
- Um job de stream agrega por código por minuto e grava contadores num armazenamento de analytics; os eventos brutos vão para o object storage para análises posteriores.
- **Visitantes únicos** exigem uma contagem distinta: use HyperLogLog (≈1–2% de erro, alguns kB por contador) em vez de guardar cada ID de visitante.

---

## 7. Gargalos, modos de falha e trade-offs

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Leituras no banco | Todo redirecionamento bate no armazenamento; o p99 cresce com a carga | Cache-aside + cache L1 em processo; réplicas de leitura | Dado desatualizado após apagar (limitado pelo TTL) |
| Link viral | Uma chave quente satura um shard do cache | Cache L1 com segundos de TTL; replicar a chave quente | Mais memória, dados um pouco mais velhos |
| Alocador de IDs | Contador único = gargalo e ponto único de falha | Reserva por faixas; alocador replicado (SQL com failover) | Buracos na sequência após quedas (inofensivos) |
| Varredura de códigos | Bots testam códigos aleatórios → faltas batem no banco | Cache negativo; rate limit por IP; códigos não sequenciais | Pouca memória para as entradas negativas |
| Destinos maliciosos | Encurtador usado para esconder phishing | Checar URLs contra listas de reputação na criação e depois, de forma assíncrona; desativar o link (o 302 torna isso eficaz) | Latência na criação; falsos positivos |
| Pipeline de analytics | Kafka lento ou fora do ar | Disparar e esquecer com buffer limitado; descartar no estouro | Alguns cliques perdidos (aceitável pelo requisito) |
| Queda de região | Redirecionamentos falham em todo lugar | Caminho de leitura multirregião: KV replicado, GeoDNS, cache por região | Escritas precisam de uma região "dona" ou de IDs sem conflito (faixas por região) |

Os trade-offs para **dizer em voz alta**: **disponibilidade e latência acima de consistência estrita** no caminho de redirecionamento (um link apagado há poucos segundos ainda pode redirecionar pelo cache), **302 em vez de 301** porque analytics e controle importam, e **faixas de contador em vez de hash** porque unicidade sem repetição por colisão é mais simples de raciocinar.

---

## 8. Experimente no playground

O cenário `url-shortener` tem o caminho de leitura desta página: balanceador de carga, réplicas do app, um cache na frente do armazenamento e um stream de eventos para os cliques.

!!! tip "Experimente"

    1. Rode com o perfil **load** e anote a taxa de acerto do cache, a utilização do banco e o p99 do redirecionamento.
    2. Remova o cache (ou deixe a taxa de acerto baixa) e rode de novo: quantas vezes maior fica a carga no banco? O p99 ainda cumpre a meta de 100 ms?
    3. Mude para o perfil **stress** e acrescente réplicas do app até o gargalo mudar de lugar: é a camada de aplicação, o cache ou o armazenamento?
    4. Ligue o caos e derrube o consumidor do stream/analytics: os redirecionamentos continuam funcionando? (Deveriam — esse é o ponto da seção 6.3.)

<div class="sdp" data-scenario="url-shortener" data-mode="full" data-height="640" data-profile="load"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz

??? question "Como você suporta aliases personalizados sem conflitar com os códigos gerados?"

    Use uma **inserção condicional** (`INSERT … IF NOT EXISTS` ou uma restrição de unicidade) e responda `409` quando o alias estiver ocupado. Para um código gerado nunca colidir com um alias, coloque-os em espaços diferentes: códigos gerados têm exatamente 7 caracteres base62, aliases precisam ser mais longos ou conter um `-`; ou reserve os aliases na mesma tabela, de modo que a inserção condicional do gerador falhe e ele pegue o próximo id.

??? question "O mesmo usuário encurta a mesma URL duas vezes. Mesmo código?"

    Depende do requisito que você esclareceu. Com um contador, saem dois códigos (e dois conjuntos de estatísticas), que é o que ferramentas de campanha querem. Se a deduplicação for exigida, mantenha um índice secundário `hash(longUrl, owner) → code` e consulte-o antes de alocar — uma consulta a mais no caminho (raro) de escrita.

??? question "Como você levaria isso para várias regiões?"

    Redirecionamentos são leituras: replique o armazenamento KV para cada região (replicação assíncrona serve), mantenha um cache por região e direcione os usuários com GeoDNS/anycast para a mais próxima. Para as escritas, dê a cada região suas **próprias faixas de id** (ou um bit de região no id), para que os códigos nunca colidam sem coordenação entre regiões. Um link criado em São Paulo pode levar um segundo para funcionar em Frankfurt — aceitável se você disser.

??? question "Como você conta cliques únicos por link?"

    Contagens exatas de únicos exigem o conjunto de IDs de visitantes — enorme para links populares. Use **HyperLogLog** por link por dia (`PFADD`/`PFCOUNT` no Redis, ou a função de distintos aproximados do armazenamento de analytics): ~1% de erro com alguns kilobytes por contador, e HLLs podem ser combinados entre dias.

??? question "Como você limpa links expirados? Códigos podem ser reutilizados?"

    A verificação na leitura (responder `410` se `expires_at < now`) torna a expiração exata; um job em segundo plano apaga as linhas expiradas em lotes (ou o TTL nativo do armazenamento faz isso). **Não reutilize códigos**: cópias antigas da URL curta estão impressas, em cache nos navegadores (301) e nas mensagens de outras pessoas — reutilizá-las mandaria usuários para uma página sem relação. Com 3,5 trilhões de códigos não há necessidade.

??? question "E se alguém usar seu encurtador para phishing?"

    Cheque o destino contra listas de reputação na criação, aplique rate limit e exija autenticação para criar, reanalise links populares de forma assíncrona e mantenha uma flag "desativado" que o redirecionamento respeita. É mais um motivo para preferir o 302: você ainda consegue parar de mandar pessoas para um link depois que ele vira malicioso.

??? question "Por que não usar simplesmente a coluna auto-increment do banco?"

    Funciona em escala pequena e é uma resposta perfeitamente boa para os links internos do BoxOffice. Com 100 M de links por mês num armazenamento fragmentado não existe um auto-increment único, e o primário vira gargalo de escrita e ponto único de falha. A reserva por faixas mantém a mesma ideia (um contador) tocando o contador compartilhado uma vez a cada 10 000 ids.

---

## 10. Rubrica de autoavaliação

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | API com criação e redirecionamento; uma tabela `code → url`; alguma forma de gerar códigos (frequentemente um hash) sem tratar colisões; "coloca um cache". |
| **Pleno** | Requisitos e estimativas guiando o design (leitura intensa, conjunto quente cabe em memória); base62 com um gerador sem colisões (faixas de contador ou KGS); cache-aside com TTL; 301 vs. 302 discutido; analytics assíncrono. |
| **Sênior** | Compara os quatro geradores quanto a colisões, coordenação e previsibilidade, e embaralha ids sequenciais; cache negativo e mitigação de chave quente; particionamento dos dados por código; multirregião com faixas de id por região; tratamento de abuso; escolha explícita de consistência para o caminho de redirecionamento; sabe quando um único PostgreSQL ainda é a resposta certa. |

**Relacionados:** [Caching](../../caching/index.md), [Hands-on 5](../../../hands-on/5/index.md) (cache-aside e taxa de acerto), [Mensageria](../../messaging/index.md), [problemas de prática para entrevista](../../../support/interview/problems/index.md).

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` mermaid
flowchart LR
    CASE(["URL shortener"]) --> EST["Estimation<br/>reads ≫ writes, hot set"]:::tech
    CASE --> DIS["Distributed<br/>unique IDs: ranges, Snowflake"]:::tech
    CASE --> EDG["Edge<br/>DNS, LB, 301 vs 302"]:::tech
    CASE --> DB["Databases<br/>key-value: code → long URL"]:::tech
    CASE --> CAC["Caching<br/>cache-aside for hot codes"]:::tech
    CASE --> MSG["Messaging<br/>clicks as events"]:::tech
    EDG -.-> k1["dns · lb · app"]:::comp
    DB -.-> k2["nosql"]:::comp
    CAC -.-> k3["cache"]:::comp
    MSG -.-> k4["kafka · analytics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Estimativas — números](../../estimation/numbers/index.md) · [Distribuídos — tempo e relógios](../../distributed/time-clocks/index.md) (IDs únicos) · [Borda — protocolos](../../edge/protocols/index.md) (redirecionamentos) · [Bancos de dados — modelos](../../databases/models/index.md) · [Caching — padrões](../../caching/patterns/index.md) · [Mensageria — semântica](../../messaging/semantics/index.md). **Componentes da paleta:** [`dns`](../../../reference/components/edge/index.md#dns) · [`lb`](../../../reference/components/edge/index.md#lb) · [`app`](../../../reference/components/compute/index.md#app) · [`cache`](../../../reference/components/storage/index.md#cache) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`analytics`](../../../reference/components/compute/index.md#analytics) · [`dwh`](../../../reference/components/storage/index.md#dwh). **Cenários:** `url-shortener`, `read-heavy-cache`.

---

## Referências

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 7 "Design a Unique ID Generator in Distributed Systems" e cap. 8 "Design a URL Shortener"[^1].
- O anúncio e o código do Snowflake do Twitter[^2].
- Semântica dos redirecionamentos HTTP (301, 302, 307, 308)[^3].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed., capítulos sobre particionamento e processamento de streams[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: KING, R. [Announcing Snowflake](https://blog.x.com/engineering/en_us/a/2010/announcing-snowflake){target="_blank"}. Twitter Engineering Blog, 2010.
[^3]: FIELDING, R.; NOTTINGHAM, M.; RESCHKE, J. [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){target="_blank"}, seção 15.4. IETF, 2022.
[^4]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly.
