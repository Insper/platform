Colocar um cache na frente de um banco levanta duas perguntas que não têm nada a ver com o Redis em si: **quem preenche o cache** quando um valor está faltando, e **o que acontece com o cache quando o dado é escrito**. As respostas formam um pequeno conjunto de padrões com nome. Vale a pena conhecê-los pelo nome: numa revisão de arquitetura ou numa entrevista, "cache-aside com remoção na escrita e TTL de 5 minutos" diz numa frase o que de outro jeito levaria um parágrafo[^2].

| Padrão | Quem lê o banco numa falta | O que acontece numa escrita |
|---|---|---|
| [Cache-aside](#cache-aside) | a aplicação | a aplicação escreve no banco e depois **remove** a chave |
| [Read-through](#read-through) | o cache (por meio de um *loader*) | combinado com um dos padrões de escrita |
| [Write-through](#write-through) | — | cache e banco escritos **de forma síncrona**, juntos |
| [Write-behind](#write-behind) | — | cache escrito agora, banco escrito **depois**, em lotes |
| [Write-around](#write-around) | — | banco escrito, cache **não é tocado** (preenchido na próxima leitura) |
| [Refresh-ahead](#refresh-ahead) | o cache, **antes** de expirar | — |

Ao longo da página o exemplo é o serviço `catalog` da BoxOffice: `GET /events/{id}` devolve um evento com o local e a tabela de preços, e os organizadores ocasionalmente editam um evento com `PUT /events/{id}`.

---

## Cache-aside { #cache-aside }

**Cache-aside** (também chamado de *lazy loading*, carregamento preguiçoso) é o padrão default e o que você deve supor, a não ser que haja um motivo para outro. A aplicação conversa com o cache e com o banco; o cache é um armazenamento chave-valor passivo que não sabe nada sobre o banco[^1].

``` diagram-sim
sequenceDiagram
    participant A as serviço catalog
    participant R as Redis
    participant D as PostgreSQL
    A->>R: GET event:42
    R-->>A: nil (falta)
    A->>D: SELECT evento, local, preços WHERE id = 42
    D-->>A: linha
    A->>R: SET event:42 json EX 300
    A->>R: GET event:42 (próxima requisição)
    R-->>A: json (acerto)
```

**Caminho de leitura**: procure no cache; num acerto, devolva; numa falta, leia o banco, guarde o resultado com um TTL e devolva.
**Caminho de escrita**: atualize o banco e então **remova** a chave (não a atualize — veja [Invalidação](../invalidation/index.md#delete-vs-update)). A próxima leitura a preenche de novo.

Por que ele é o default:

- **Só o que é lido vai para o cache** — nada de memória desperdiçada com dados que ninguém pede.
- **O cache é opcional**: se o Redis cair, as leituras vão ao banco (mais lento, mas correto). A aplicação continua funcionando, desde que o banco aguente a carga.
- **Simples de entender**: o banco é sempre a fonte da verdade — o cache guarda *dados derivados*, que podem ser reconstruídos a qualquer momento[^3].

Seus custos:

- **A primeira leitura de cada chave é lenta** (falta + banco + SET): três idas e voltas em vez de uma.
- **Janela de defasagem**: entre a escrita no banco e a remoção, e em algumas condições de corrida ([Invalidação](../invalidation/index.md#race)), leitores podem ver um valor antigo — limitado pelo TTL.
- **A lógica de cache fica espalhada pelo código da aplicação** — a não ser que um framework a esconda.

### Cache-aside no Spring Boot { #cache-aside-in-spring-boot }

A abstração de cache do Spring implementa cache-aside com anotações: `@Cacheable` envolve o caminho de leitura, `@CacheEvict` a remoção na escrita. É o jeito mais curto de escrever o padrão num serviço Spring; o [Hands-on 5](../../../hands-on/5/index.md) o escreve à mão, para que cada passo possa ser visto e medido (quadro abaixo).

```java title="catalog/src/main/java/boxoffice/catalog/EventService.java"
@Service
public class EventService {

    private final EventRepository repository;

    public EventService(EventRepository repository) {
        this.repository = repository;
    }

    // Read path: key "events::42"; runs the method only on a miss
    @Cacheable(cacheNames = "events", key = "#id", unless = "#result == null")
    public EventDto findById(long id) {
        return repository.findWithVenueAndPrices(id)
                .map(EventDto::from)
                .orElse(null);
    }

    // Write path: update the database first, then delete the key
    @Transactional
    @CacheEvict(cacheNames = "events", key = "#id")
    public EventDto update(long id, EventUpdate change) {
        Event event = repository.findById(id).orElseThrow();
        event.apply(change);
        return EventDto.from(repository.save(event));
    }
}
```

```java title="catalog/src/main/java/boxoffice/catalog/CacheConfig.java"
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(5))
                .disableCachingNullValues()
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(RedisSerializer.json()));

        return RedisCacheManager.builder(factory)
                .cacheDefaults(defaults)
                .withCacheConfiguration("events", defaults.entryTtl(Duration.ofMinutes(5)))
                .withCacheConfiguration("prices", defaults.entryTtl(Duration.ofSeconds(30)))
                .build();
    }
}
```

!!! warning "Quando o `@CacheEvict` executa?"

    Por padrão o `@CacheEvict` executa **depois** que o método retorna — mas o `@Transactional` pode fazer o commit ainda mais tarde, quando a cadeia de proxies se desfaz. Se a remoção acontecer *antes* do commit, um leitor concorrente pode errar, ler a linha **antiga** (a mudança ainda não foi confirmada) e colocá-la de volta no cache. Garanta que a remoção aconteça depois do commit: ordene os proxies para que a transação confirme primeiro, use `TransactionAwareCacheManagerProxy` (ou `RedisCacheManager.builder(...).transactionAware()`), ou remova num `@TransactionalEventListener(phase = AFTER_COMMIT)`.

!!! example "No código do BoxOffice: cache-aside no `catalog` (lab 5)"

    O [Hands-on 5 — Cache-aside](../../../hands-on/5/cache-aside/index.md) implementa o padrão sem anotações, para que as decisões fiquem explícitas: lê o Redis primeiro; num miss, carrega do PostgreSQL e guarda o JSON exato devolvido ao cliente, com o TTL mais até 10% de jitter; se o Redis falha, registra no log e trata como miss — **o cache é uma otimização, não uma dependência**. Toda resposta traz o resultado (`HIT`, `MISS`, `BYPASS`) num cabeçalho `X-Cache` e num contador, que é como o lab mede a taxa de acerto.

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventCache.java (get and load)" }
    --8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java:54:61,86:87,99:117"
    ```

    O caminho de escrita está no `EventController.java`: `service.updateEvent(...)` faz o commit, e só então `cache.evict(eventKey(id))` remove a chave — *escreva primeiro, depois remova*, a ordem explicada em [Invalidação](../invalidation/index.md#delete-vs-update).

### Cache-aside à mão (Python) { #cache-aside-by-hand-python }

Sem framework, o padrão cabe numa dúzia de linhas. É o que o `@Cacheable` faz por trás:

```python title="assistant/catalog_cache.py"
import json
import redis

r = redis.Redis(host="redis", port=6379, decode_responses=True)
TTL_SECONDS = 300


def get_event(event_id: int, db) -> dict | None:
    key = f"boxoffice:catalog:event:{event_id}:v3"
    cached = r.get(key)
    if cached is not None:                       # hit
        return json.loads(cached)
    event = db.fetch_event_with_venue_and_prices(event_id)   # miss → source of truth
    if event is not None:
        r.set(key, json.dumps(event), ex=TTL_SECONDS)
    return event


def update_event(event_id: int, change: dict, db) -> None:
    db.update_event(event_id, change)            # 1. commit to the database
    r.delete(f"boxoffice:catalog:event:{event_id}:v3")   # 2. then invalidate
```

---

## Read-through { #read-through }

No **read-through**, a aplicação só conversa com o cache. Numa falta, *o próprio cache* carrega o valor do banco, usando uma função *loader* que você registra. A lógica sai da aplicação e vai para a camada de cache.

``` diagram-sim
sequenceDiagram
    participant A as serviço catalog
    participant C as Cache com loader
    participant D as PostgreSQL
    A->>C: get(42)
    C->>D: loader(42): SELECT ...
    D-->>C: linha
    C-->>A: valor (agora no cache)
    A->>C: get(42)
    C-->>A: valor (acerto)
```

Caches em processo implementam isso nativamente — o `LoadingCache` do Caffeine, o Guava, o `MemoryCache` do .NET com uma factory. Caches distribuídos raramente implementam (o Redis não faz ideia de como consultar o PostgreSQL), então "Redis read-through" na prática é uma biblioteca na aplicação que se comporta como se fosse o cache.

```java title="Read-through with Caffeine (in-process)"
LoadingCache<Long, Venue> venues = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(10))
        .build(id -> venueRepository.findById(id).orElse(null));   // the loader

Venue v = venues.get(7L);   // miss → loader runs once, even with 100 concurrent callers
```

Uma propriedade útil: um bom cache read-through **agrupa** (*coalesce*) faltas concorrentes na mesma chave — 100 threads pedindo o local 7 disparam uma única chamada ao loader. É a cura para o *stampede* descrito em [Modos de Falha](../failure-modes/index.md#stampede).

---

## Write-through { #write-through }

No **write-through**, toda escrita vai para o cache *e* para o banco como parte da mesma operação, antes de o cliente receber a resposta. O cache fica sempre aquecido com o último valor de cada chave escrita.

``` diagram-sim
sequenceDiagram
    participant A as serviço catalog
    participant C as Cache
    participant D as PostgreSQL
    A->>C: put(42, evento novo)
    C->>D: UPDATE events SET ... WHERE id = 42
    D-->>C: ok
    C-->>A: ok (cache e banco atualizados)
```

- **Bom**: leituras logo após uma escrita acertam o cache com o valor novo (*read-your-writes* através do cache); sem penalidade de falta depois de atualizações.
- **Ruim**: toda escrita paga duas latências; valores escritos e nunca lidos ainda ocupam memória (combine com um TTL); as duas escritas **não são atômicas** — se a escrita no banco falha depois da escrita no cache, o cache guarda um valor que nunca existiu. Escreva primeiro no banco e remova a chave se algo falhar.

Write-through serve para dados lidos logo depois de escritos: o perfil do usuário depois da edição, o painel do organizador.

---

## Write-behind { #write-behind }

O **write-behind** (ou *write-back*) confirma a escrita assim que o cache a recebe e persiste no banco **depois**, de forma assíncrona, muitas vezes em lotes.

``` diagram-sim
sequenceDiagram
    participant A as serviço
    participant C as Cache
    participant W as Descarregador
    participant D as PostgreSQL
    A->>C: INCR views:event:42
    C-->>A: ok (rápido, em memória)
    A->>C: INCR views:event:42
    C-->>A: ok
    W->>C: a cada 10 s: lê e zera os contadores
    W->>D: UPDATE event_stats SET views = views + 1834
```

- **Bom**: escritas tão rápidas quanto a memória; muitas escritas na mesma chave são **agrupadas** numa única escrita no banco; o banco fica protegido de rajadas de escrita.
- **Ruim**: **escritas confirmadas podem ser perdidas** se o nó do cache morrer antes de descarregar; o banco está sempre atrasado; a ordem e as falhas do descarregador exigem engenharia cuidadosa.

Use só para dados em que perder alguns segundos de escritas é aceitável: contadores de visualização, "pessoas olhando este evento agora", eventos de analytics, contadores de rate limit. **Nunca** para pedidos, pagamentos ou reservas de assento.

??? question "Pense antes: write-behind para reservas de assento?"

    Durante a venda relâmpago, gravar cada reserva de assento no SQL é o gargalo. Um colega propõe: "grave as reservas no Redis, confirme para o fã e descarregue no PostgreSQL a cada segundo". O que pode dar errado?

    Se o primário do Redis falhar antes do descarregamento, reservas que os fãs já viram como confirmadas desaparecem — e os assentos podem ser vendidos de novo: venda dupla, o único bug que a BoxOffice nunca pode ter. Mesmo com replicação no Redis, a replicação é assíncrona ([Redis](../redis/index.md#replication)) e as últimas escritas confirmadas podem se perder num failover. As ferramentas certas para o gargalo das reservas estão em outro lugar: uma sala de espera para limitar a taxa de chegada, locks finos por linha e particionamento do inventário ([Bancos de dados](../../databases/transactions/index.md#double-booking)).

---

## Write-around { #write-around }

No **write-around**, as escritas vão direto para o banco e o cache não é tocado (ou a chave é simplesmente removida). O valor só entra no cache quando alguém o lê.

É o que o cache-aside faz no caminho de escrita, e é a escolha certa quando **o dado escrito raramente é lido logo em seguida**: o ingresso que um fã acabou de comprar (lido poucas vezes, por uma só pessoa), logs de auditoria, histórico de pedidos. Escrever isso no cache só despejaria entradas úteis.

---

## Refresh-ahead { #refresh-ahead }

O **refresh-ahead** recarrega uma entrada quente **antes** de ela expirar, para que os leitores nunca vejam a falta. Uma tarefa em segundo plano (ou o primeiro leitor depois de um limiar, por exemplo quando 80% do TTL já passou) busca o valor novo enquanto o atual continua sendo servido.

``` diagram-sim
sequenceDiagram
    participant A as Leitor
    participant C as Cache
    participant D as PostgreSQL
    A->>C: get(event:42), TTL 300 s, idade 250 s
    C-->>A: valor atual (servido na hora)
    C->>D: recarga assíncrona (idade > 80% do TTL)
    D-->>C: valor novo, TTL volta a 300 s
```

- **Bom**: chaves quentes nunca expiram sob carga — sem pico de latência, sem *stampede*.
- **Ruim**: se a previsão estiver errada, o cache atualiza chaves que ninguém vai ler (carga desperdiçada no banco). Funciona melhor para um **conjunto pequeno e conhecido de chaves quentes** — como os eventos que abrem vendas hoje.

O Caffeine implementa isso com `refreshAfterWrite`; a versão probabilística, que dispensa tarefa em segundo plano, é o **XFetch** ([Modos de Falha](../failure-modes/index.md#xfetch)). Uma ideia parecida no HTTP é o `Cache-Control: stale-while-revalidate`, que permite à CDN servir a cópia antiga enquanto busca uma nova.

---

## Comparando os padrões { #comparing-the-patterns }

| | Cache-aside | Read-through | Write-through | Write-behind | Write-around | Refresh-ahead |
|---|---|---|---|---|---|---|
| **Consistência com o banco** | eventual (limitada pelo TTL) | eventual | quase forte (duas escritas, não atômicas) | o banco fica atrás do cache | eventual | eventual |
| **Latência de leitura na falta** | alta (3 idas e voltas) | alta (escondida no cache) | faltas raras após escritas | faltas raras | alta na primeira leitura | quase nunca erra |
| **Latência de escrita** | banco + remoção | — | banco + cache | só memória | só banco | — |
| **Risco de perder dados** | nenhum | nenhum | nenhum | **sim** (escritas não descarregadas) | nenhum | nenhum |
| **Complexidade** | baixa | baixa (em processo) / média | média | alta | baixa | média |
| **Sobrevive à queda do cache?** | a aplicação recorre ao banco | depende da biblioteca | escritas falham ou degradam | **escritas são perdidas** | sim | volta a ter faltas |
| **Uso na BoxOffice** | detalhes do evento, resultados de busca | geometria do local (Caffeine) | painel do próprio organizador | contadores de visualização, "N pessoas vendo" | ingressos, histórico de pedidos | eventos que abrem vendas hoje |

Na prática, os sistemas **combinam** os padrões: cache-aside + write-around (remoção na escrita) é a base comum; refresh-ahead é acrescentado para as poucas chaves mais quentes; write-behind fica reservado para contadores.

<div class="csim" data-sim="cache" data-size="500" data-strategy="aside"></div>

!!! tip "Experimente"
    O TTL começa em 60 s, o `CACHE_TTL_EVENT` do [Hands-on 5](../../../hands-on/5/cache-aside/index.md). Dê play e deixe o cache aquecer: depois de um minuto a taxa de acerto se estabiliza perto de 86% e o banco recebe cerca de 29 das 200 leituras/s, sem nenhuma leitura desatualizada, porque cada edição apaga sua chave. Mude para **só TTL**: células laranja aparecem nos eventos quentes, e cerca de 11% das leituras devolvem um evento mais velho que o banco (com TTL de 10 s, cerca de 2%, mas a taxa de acerto cai para 79%: o TTL troca frescor por carga). **Write-through** é tão atualizado quanto apagar a chave e evita a falta depois de cada edição. Reduza o cache para 100 chaves: o LRU despeja parte do conjunto quente, e a taxa de acerto cai para cerca de 58% (85 leituras/s no banco).

---

## Desenhando chaves e valores do cache { #designing-cache-keys-and-values }

Os padrões dizem *quando* ler e escrever no cache; o desenho de chaves e valores decide se ele funciona em escala.

**Chaves estruturadas, com namespace.** Use um prefixo por serviço e entidade, e inclua tudo que muda a resposta:

```text
boxoffice:catalog:event:42:v3                 # one event, schema version 3
boxoffice:catalog:prices:42:BRL               # price table in a given currency
boxoffice:search:q=rock+sp:page=1:lang=pt     # a search result page
boxoffice:session:9f1c2e...                   # a session
```

- **Versão na chave** (`:v3`): quando o formato do objeto muda num deploy, incremente a versão — réplicas antigas e novas deixam de ler os valores incompatíveis umas das outras, e as chaves antigas simplesmente expiram.
- **Tudo que muda o resultado** precisa estar na chave: idioma, moeda, página, permissões do usuário. Esquecer um item é como uma página em português acaba servida a um usuário de inglês — ou os dados de um usuário a outro.
- **Chaves curtas, mas legíveis**; evite entrada de usuário sem limite nas chaves (normalize e aplique hash em consultas de busca longas).

**O que cachear.**

| Granularidade | Exemplo | Prós | Contras |
|---|---|---|---|
| **Linha do banco / objeto** | `event:42` | reaproveitável por muitas páginas; fácil de invalidar | a página precisa de várias buscas |
| **Resultado de consulta** | `search:q=rock` | economiza o trabalho mais caro | difícil de invalidar (quais consultas contêm o evento 42?) — dependa do TTL |
| **Fragmento renderizado / resposta** | HTML do card do evento, resposta JSON inteira | o mais rápido | o mais duplicado; a invalidação é grosseira |

**Valores.** JSON é legível e fácil de depurar; formatos binários (Protocol Buffers, MessagePack, Kryo) são menores e mais rápidos de interpretar. Comprima valores acima de alguns kilobytes (por exemplo, com LZ4 ou Zstandard). Valores grandes atrapalham mais do que parece: um valor de 1 MB leva ~1 ms de transferência de rede por leitura num link de 10 Gbit/s e bloqueia o Redis enquanto é copiado ([Modos de Falha — chaves grandes](../failure-modes/index.md#big-keys)).

**Cache negativo.** Se `GET /events/999999` não existe, cacheie também a *ausência* (um sentinela como `"∅"` com TTL curto, por exemplo 30 s). Caso contrário, toda requisição a um id inexistente — vinda de um bug ou de um bot — vai direto ao banco. Essa é a primeira defesa contra a [penetração de cache](../failure-modes/index.md#penetration).

---

## Cache em dois níveis (near cache) { #two-level }

Cada réplica do serviço `catalog` pode manter um pequeno **cache em processo (L1)** na frente do **Redis compartilhado (L2)**:

``` diagram-sim
flowchart LR
    REQ["requisição"] --> L1["L1: Caffeine<br/>na JVM, ~1 µs"]
    L1 -->|"falta"| L2[("L2: Redis<br/>compartilhado, ~0,5 ms")]
    L2 -->|"falta"| DB[("PostgreSQL<br/>~5 ms")]
    DB --> L2
    L2 --> L1
```

- **Por quê**: um acerto no L1 custa uma consulta a um hash map (microssegundos, sem rede), e ele absorve **chaves quentes** que de outro modo martelariam um único shard do Redis ([Modos de Falha — chaves quentes](../failure-modes/index.md#hot-keys)).
- **O problema — invalidação**: com 20 réplicas, uma escrita precisa invalidar 20 caches L1 privados mais o Redis. Opções: um TTL bem curto no L1 (1–5 s), aceitando essa defasagem; ou difundir as invalidações pelo pub/sub do Redis (ou pelo client-side caching do Redis com rastreamento, `CLIENT TRACKING`) para que cada réplica descarte sua cópia local.

!!! example "BoxOffice: o que vai onde"

    | Dado | L1 (Caffeine) | L2 (Redis) | Por quê |
    |---|---|---|---|
    | Geometria do local (setores, fileiras, layout dos assentos) | sim, 10 min | sim, 1 h | praticamente imutável; lida a cada renderização do mapa de assentos |
    | Detalhes do evento | sim, **2 s** | sim, 5 min, remoção na escrita | quente na abertura de vendas; edições precisam aparecer rápido |
    | Tabela de preços | não | sim, 30 s | muda com o preço dinâmico; um preço velho no checkout é um problema de negócio |
    | Resultados de busca | não | sim, 60 s | muitas chaves distintas, pouco reuso por réplica |
    | Sessão | não | sim (instância separada, `noeviction`) | precisa ser compartilhada por todas as réplicas; não pode ser despejada |
    | Reserva de assento | **nunca** | **nunca** (decidida no SQL) | exige consistência forte |

!!! tip "Na entrevista"

    Diga o padrão e a invalidação de uma vez só: "cache-aside no Redis para os detalhes do evento, TTL de 5 minutos, remoção na escrita depois do commit, e um L1 em processo de 2 segundos para os eventos mais quentes durante a abertura de vendas". Depois mostre que conhece os custos: a penalidade da falta, a janela de defasagem e a corrida que o TTL limita. Se o entrevistador apertar na consistência, diga o que você **não** cacheia e por quê.

!!! success "Boas práticas"

    - **Comece com cache-aside**; troque de padrão só quando um requisito pedir (read-through para compartilhar o carregador, write-through quando as leituras precisam ver a última escrita, write-behind só para dados que você pode perder).
    - **Cacheie o DTO ou a resposta exata**, não a entidade: um acerto então não custa consulta nem serialização. No BoxOffice: o `catalog` guarda o JSON que devolve ([quadro acima](#cache-aside)).
    - **Projete as chaves de propósito**: um namespace, toda dimensão de que a resposta depende (idioma, moeda, página) e um sufixo de versão que você pode subir quando o formato muda (`boxoffice:catalog:event:42:v3`).
    - **Faça o commit, depois remova a chave** — depois da transação, nunca dentro dela.
    - **Cacheie respostas negativas por pouco tempo** (um id inexistente por alguns segundos), para que misses repetidos não cheguem ao banco.

!!! warning "Armadilhas comuns"

    - **Atualizar o cache na escrita** em vez de remover: dois escritores concorrentes podem deixar o valor mais antigo no cache para sempre (veja [Invalidação](../invalidation/index.md#delete-vs-update)).
    - **Remover antes do commit da transação** (`@CacheEvict` + `@Transactional` na ordem errada).
    - **Cachear `null` sem querer** — ou nunca cachear, e deixar ids inexistentes baterem no banco.
    - **Write-behind para dados que você não pode perder.**
    - **Chaves que esquecem uma dimensão** (idioma, moeda, usuário) — o cache serve a resposta errada, rapidamente.
    - **Serialização Java de entidades com relações lazy** — serializar uma entidade JPA pode disparar consultas ou falhar; cacheie DTOs, não entidades.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    CA["cache-aside<br/>a app preenche no miss"] --> INV["apagar após o commit<br/>→ Invalidação"]
    RT["read-through<br/>a biblioteca do cache carrega"] --> INV
    WA["write-around<br/>escreve no banco, pula o cache"] --> CA
    WT["write-through<br/>cache e banco juntos"] --> FRESH["leituras frescas,<br/>escritas mais lentas"]
    WB["write-behind<br/>grava depois, em lotes"] --> LOSS["pode perder escritas confirmadas:<br/>contadores sim, assentos nunca"]
    LOSS -.-> TX["reservas ficam no SQL<br/>→ Bancos de dados"]
    RA["refresh-ahead"] --> STAMP["sem picos na expiração<br/>→ Modos de falha"]
    KEYS["chaves: namespace,<br/>versão, valores pequenos"] --> CA
    L1["cache em dois níveis<br/>L1 Caffeine + Redis"] --> HOT["chaves quentes<br/>→ Modos de falha"]
```

**Componentes da paleta:** [`cache`](../../../reference/components/storage/index.md#cache) (Redis, a cópia compartilhada) · [`app`](../../../reference/components/compute/index.md#app) (o `catalog` roda cache-aside e mantém um L1 Caffeine por réplica) · [`sql`](../../../reference/components/storage/index.md#sql) (a fonte da verdade por trás de todo padrão) · [`worker`](../../../reference/components/compute/index.md#worker) (o processo que grava os contadores do write-behind) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) (avisa cada cópia L1 para descartar uma chave). **Cenários:** `read-heavy-cache`, `search-autocomplete`. **Continua em:** [Invalidação e Despejo](../invalidation/index.md), [Modos de Falha](../failure-modes/index.md), [Bancos de dados — o bug da venda duplicada](../../databases/transactions/index.md#double-booking), [Hands-on 5](../../../hands-on/5/index.md), [Exercício: cache + banco](../../../exercises/cache-db/index.md).

---

[^1]: AMAZON WEB SERVICES. [Database Caching Strategies Using Redis](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/welcome.html){target="_blank"}. AWS Whitepaper.
[^2]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Capítulo 1 (camada de cache) e capítulo 6 (armazenamento chave-valor).
[^3]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2. ed. O'Reilly. Capítulos sobre armazenamento e dados derivados.
