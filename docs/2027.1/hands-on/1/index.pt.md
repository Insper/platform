!!! abstract "Neste lab"

    - Construir o **`catalog`**, o primeiro serviço do BoxOffice: uma API REST de eventos e locais com Spring Boot 4, PostgreSQL, Flyway e um documento OpenAPI.
    - Empacotá-lo como **imagem de container** e rodá-lo com o seu banco usando **Docker Compose**.
    - **Medir** com um smoke test do k6: a latência de cada endpoint quando o serviço *não* está sob carga.

Todo site de ingressos começa pela mesma página: *o que tem, onde e quando?* No BoxOffice esse é o trabalho do `catalog`. Ele é o serviço com **mais leitura** do sistema — durante uma venda relâmpago, milhões de fãs recarregam a página do evento enquanto só um punhado de administradores a altera — e por isso será a cobaia do balanceamento de carga (lab 3), do cache (lab 5) e dos índices (lab 6). Hoje você constrói a versão mais simples que funciona, o passo **monolith-first** da jornada de escala.

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 3–4 horas |
| **Você precisa de** | as ferramentas do [lab 0](../0/index.md); Docker com pelo menos **4 GB** de memória; o primeiro build baixa ~300 MB de dependências Maven |
| **Diretório** | todo comando destas páginas roda na raiz do seu repositório `boxoffice/`, a menos que comece com `cd` (Windows: dentro do WSL 2) |

Confira as ferramentas:

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Estado inicial** — o fim do lab 0:

``` { .tree title="boxoffice/ at the start of lab 1" }
boxoffice/
    .gitignore
    load/
        hello.js
    results/
        lab0.md
    scripts/
        check-env.sh
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 0? Baixe [boxoffice-after-lab-0.zip](../0/boxoffice-after-lab-0.zip), descompacte e `cd boxoffice` (depois `git init -b main`, se quiser controle de versão). Todo arquivo deste lab aparece completo nas próximas páginas, e os mesmos arquivos estão na pasta `code/` deste lab (por exemplo [`code/docker-compose.yaml`](code/docker-compose.yaml)).

## Slides

<div class="slides-embed">
  <iframe src="slides/catalog.html" title="Slides: hands-on 1 — primeiro serviço" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/catalog.html){:target="_blank"}

## O que você vai construir { #what-you-will-build }

``` diagram-sim
sequenceDiagram
    autonumber
    actor Fan as Fã
    participant C as catalog :8082<br/>(Spring Boot)
    participant DB as db :5432<br/>(PostgreSQL, schema catalog)
    Fan->>C: GET /catalog/events?city=Recife
    C->>DB: SELECT events JOIN venues WHERE city = ? ORDER BY starts_at LIMIT 20
    DB-->>C: 20 linhas
    C->>DB: SELECT count(*) ... (total para os links de página)
    DB-->>C: 20001
    C-->>Fan: 200 {items: [...], page: 0, totalItems: 20001}
```

O serviço segue a estrutura clássica de três camadas — **controller** (HTTP, validação, DTOs) → **service** (regras de negócio, transações) → **repository** (SQL via JPA) — com uma regra que importa para tudo que vem depois: a API nunca expõe as entidades do banco, só **records** (`EventOut`, `VenueOut`) que você controla.

| Método | Caminho | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/catalog/events?city=&page=&size=` | — | `200` página de próximos eventos, os mais próximos primeiro |
| `GET` | `/catalog/events/{id}` | — | `200` evento com o seu local, ou `404` |
| `POST` | `/catalog/events` | `EventIn` | `201` + cabeçalho `Location`, ou `400` |
| `PUT` | `/catalog/events/{id}` | `EventIn` | `200`, `400` ou `404` |
| `DELETE` | `/catalog/events/{id}` | — | `204` ou `404` |
| `GET` | `/catalog/venues` · `/catalog/venues/{id}` | — | `200` locais |
| `POST` | `/catalog/venues` | `VenueIn` | `201` |
| `GET` | `/actuator/health` · `/catalog/openapi` · `/swagger-ui.html` | — | saúde, documento OpenAPI, documentação interativa |

O banco começa com **50 locais em 10 cidades e 200.000 eventos** (um por hora a partir de março de 2027), gerados por uma migration do Flyway[^1]. O evento **1** é o show de venda relâmpago da disciplina: *BoxOffice Fest — Stadium Night*, em um estádio de 60.000 lugares. Um volume realista de dados é proposital: uma consulta instantânea com 10 linhas pode levar dezenas de milissegundos com 200.000, e é exatamente isso que você vai medir.

!!! info "Conexão com a teoria"

    - Na [história da disciplina](../../index.md#story), o `catalog` é o "um serviço, um banco" dos capítulos 1 e 2: os estágios 0 e 1 da [jornada de escala](../../classes/intro/scaling-journey/index.md), e o sistema cuja capacidade a [aula 2](../../classes/estimation/index.md) estima e o lab 2 mede. Sua 1 CPU e suas 10 conexões com o banco são os números que o lab 2 transforma num joelho.
    - Aula 5, [Computação e serviços](../../classes/compute/index.md): servidores de aplicação sem estado, [estilos de API](../../classes/compute/api-styles/index.md) (REST, recursos, códigos de status, versionamento).
    - Aula 6, [Bancos de dados](../../classes/databases/index.md): [modelos de dados](../../classes/databases/models/index.md) relacionais, schemas e migrations.

## Passos { #steps }

<div class="grid cards" markdown>

-   :material-api:{ .lg .middle } **[1. API](api/index.md)**

    ---

    Criar o projeto Spring Boot, desenhar os endpoints, os records de requisição/resposta e os controllers.

-   :material-database:{ .lg .middle } **[2. Persistência](persistence/index.md)**

    ---

    Entidades e repositórios JPA, a camada de serviço com transações e as migrations Flyway que criam e populam o schema.

-   :fontawesome-brands-docker:{ .lg .middle } **[3. Container](container/index.md)**

    ---

    Um Dockerfile multi-stage, o primeiro `docker-compose.yaml` e o serviço rodando com o PostgreSQL.

</div>

Ao fim dos três passos, o seu repositório fica assim:

``` { .tree title="boxoffice/" }
boxoffice/
    docker-compose.yaml
    load/
        hello.js
        smoke.js
    results/
        lab0.md
        lab1.md
    services/
        catalog/
            Dockerfile
            .dockerignore
            pom.xml
            src/main/java/boxoffice/catalog/
                CatalogApplication.java
                Category.java
                Event.java              Venue.java
                EventRepository.java    VenueRepository.java
                CatalogService.java
                EventController.java    VenueController.java
                EventIn.java  EventOut.java  VenueIn.java  VenueOut.java  PageOut.java
            src/main/resources/
                application.yaml
                db/migration/
                    V1__create_catalog.sql
                    V2__seed_catalog.sql
```

## Meça: a referência sem carga { #measure-it }

Antes de perguntar "quanta carga ele aguenta?" (lab 2), registre a velocidade de cada endpoint **com um único usuário**. Esse é o *tempo de serviço*: a melhor latência que você verá, e a referência para toda comparação posterior.

Salve o smoke test como `load/smoke.js`:

``` { .javascript title="load/smoke.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/1/code/load/smoke.js"
```

Com a stack rodando ([passo 3](container/index.md)):

<!-- termynal -->
``` shell
> k6 run load/smoke.js
  █ THRESHOLDS

    http_req_duration{name:GET /catalog/events?city}
    ✓ 'p(95)<500' p(95)=42.18ms
    http_req_duration{name:GET /catalog/events/{id}}
    ✓ 'p(95)<200' p(95)=11.15ms
    http_req_failed
    ✓ 'rate==0' rate=0.00%

  █ TOTAL RESULTS

    ✓ detail is 200
    ✓ list is 200
    ✓ list has 20 items
    http_req_duration.....................: avg=19.33ms  med=23.94ms  p(95)=37.74ms  p(99)=72.02ms  max=87.26ms
      { name:GET /catalog/events?city }...: avg=32.04ms  med=30.17ms  p(95)=42.18ms  p(99)=71.38ms  max=87.26ms
      { name:GET /catalog/events/{id} }...: avg=6.62ms   med=4.69ms   p(95)=11.15ms  p(99)=40.19ms  max=73.71ms
    http_reqs.............................: 112    3.678382/s
```

Os números acima vêm de uma execução em um notebook; os seus serão diferentes. Duas coisas devem chamar a atenção mesmo assim: a **listagem é várias vezes mais lenta que o detalhe** (ela junta duas tabelas, ordena e conta milhares de linhas; o detalhe é uma busca por chave primária), e **o p99 fica longe da mediana** mesmo com um único usuário (compilação JIT, coleta de lixo, as primeiras conexões do pool).

Registre os resultados em `results/lab1.md`:

``` { .markdown title="results/lab1.md" .copy }
# Lab 1 — catalog, unloaded (1 VU, 30 s)

| Endpoint                     | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
|------------------------------|---------:|---------:|---------:|---------:|
| GET /catalog/events/{id}     |          |          |          |          |
| GET /catalog/events?city=... |          |          |          |          |

- Startup time ("Started CatalogApplication in ... seconds"): ____ s
- Image size (`docker image ls boxoffice-catalog`): ____ MB
- Seed time (Flyway "Successfully applied 2 migrations ... execution time"): ____ s
- Why is the listing slower than the detail? ____
```

??? question "Pense antes: rode o smoke test duas vezes. Por que a segunda execução é mais rápida?"

    As primeiras requisições depois de uma inicialização encontram uma JVM **fria** (classes carregando, o JIT ainda interpretando bytecode), um pool de conexões vazio e páginas do PostgreSQL que ainda não estão no seu buffer cache. Depois de algumas centenas de requisições, tudo está **aquecido**. Por isso testes de carga sempre têm aquecimento, e você nunca deve comparar uma execução fria com uma aquecida.

!!! note "Se os seus números forem diferentes"

    Os valores absolutos dependem da sua CPU, da memória dada ao Docker e do que mais está rodando (feche abas e IDEs que não estiver usando). O que deve valer em qualquer máquina: todos os checks passam, o detalhe é várias vezes mais rápido que a listagem, e a segunda execução é mais rápida que a primeira. Se o p95 do detalhe passar de ~100 ms com um usuário, provavelmente falta CPU ou memória ao Docker (`docker stats`).

## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | há um PostgreSQL local rodando | pare-o (`brew services stop postgresql`, `sudo systemctl stop postgresql`) ou mapeie `"15432:5432"` no `docker-compose.yaml` |
| o build falha em `mvn … package` com `Could not resolve dependencies` | sem internet, proxy ou download corrompido | confira a conexão e rode `docker compose build --no-cache catalog` |
| `catalog` fica `starting`/`unhealthy` | ainda migrando/iniciando (a primeira inicialização carrega 200.000 eventos), ou quebrou | `docker compose logs catalog`; procure `Started CatalogApplication` ou o primeiro `ERROR` |
| `Connection to localhost:5432 refused` nos logs do catalog | `DB_HOST` não é `db` dentro do Compose | use o `docker-compose.yaml` desta página sem mudanças |
| `Validate failed: Migrations have failed validation` | uma migration aplicada foi editada | restaure o arquivo; só no seu notebook, `docker compose down -v` zera o banco |
| `curl: (7) Failed to connect to localhost port 8082` | o container ainda não subiu, ou a porta não está publicada | `docker compose ps`; espere `healthy` |
| `?city=São Paulo` devolve 400 ou nada | o espaço e o `ã` precisam ser codificados na URL | use `?city=S%C3%A3o%20Paulo` (o k6 faz isso com `encodeURIComponent`) |
| `exec format error` no Apple Silicon | uma imagem gerada para outra arquitetura | todas as imagens usadas aqui são multiarquitetura; remova qualquer linha `platform:` e recompile |

!!! success "Boas práticas neste lab"

    - **Configure por variáveis de ambiente com padrões seguros** — `DB_POOL_SIZE: ${DB_POOL_SIZE:-10}` no `docker-compose.yaml` e no `application.yaml` deixa o lab 2 mudar o pool sem rebuild; a fórmula por trás do número está em [Filas](../../classes/estimation/queueing/index.md).
    - **Fixe os recursos de todo contêiner** — `cpus: "1.0"` e `memory: 768M` fazem da capacidade de uma réplica um número mensurável ([Números — servidores](../../classes/estimation/numbers/index.md)).
    - **Versione o schema como migrations** — `V1__create_catalog.sql` e `V2__seed_catalog.sql` do Flyway reconstroem o mesmo banco em toda máquina; um schema mudado à mão se desencontra.
    - **Exponha um endpoint de prontidão e deixe a plataforma usá-lo** — o `healthcheck` do Compose chama `/actuator/health/readiness`; os balanceadores de carga dependem do mesmo sinal ([Balanceamento — health checks](../../classes/edge/load-balancing/index.md#health-checks)).
    - **Escreva o requisito de latência como threshold de teste** — `load/smoke.js` reprova quando um p95 passa do limite ([Requisitos](../../classes/intro/requirements/index.md)).

## Limpeza { #clean-up }

``` { .bash .copy }
docker compose down          # stop and remove the containers, keep the database volume
# docker compose down -v     # ...and also erase the database (Flyway seeds it again next time)
```

Mantenha o repositório como está: o lab 2 mede este mesmo serviço.

## Entrega { #deliverable }

- [ ] `services/catalog` compila e roda com `docker compose up --build`; o Flyway aplica `V1` e `V2`.
- [ ] Todo endpoint da tabela responde como descrito (teste também os casos `400` e `404` — o corpo deve ser `application/problem+json`[^2]).
- [ ] O documento OpenAPI é servido em `http://localhost:8082/catalog/openapi`.
- [ ] `load/smoke.js` passa em todos os thresholds; `results/lab1.md` está preenchido.
- [ ] Repositório com a tag `lab1`; [quiz](quiz.md) respondido.

## Estado final { #end-state }

``` { .tree title="added in lab 1" }
boxoffice/
    docker-compose.yaml                      # new: db + catalog
    load/smoke.js                            # new
    results/lab1.md                          # your measurements
    services/catalog/                        # new: the whole service
        Dockerfile  .dockerignore  pom.xml
        src/main/java/boxoffice/catalog/*.java   (15 classes)
        src/main/resources/application.yaml
        src/main/resources/db/migration/V1__create_catalog.sql, V2__seed_catalog.sql
```

Rodando: `db` (PostgreSQL 17, schema `catalog` com 50 locais e 200.000 eventos) e `catalog` na porta 8082.

Próximo: [Lab 2 — Meça primeiro](../2/index.md).

[^1]: Referência do Spring Boot, [Data Access — Database Initialization with Flyway](https://docs.spring.io/spring-boot/how-to/data-initialization.html){target="_blank"}.
[^2]: IETF, [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457){target="_blank"}.
