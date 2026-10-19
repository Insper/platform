O último passo empacota o `catalog` como uma **imagem** e o roda ao lado do PostgreSQL com o **Docker Compose**. De agora em diante, "rodar o BoxOffice" sempre significa um comando: `docker compose up`.

``` mermaid
flowchart LR
    term(["seu terminal<br/>curl · k6"]) -->|localhost:8082| catalog
    subgraph compose["projeto docker compose: boxoffice"]
        catalog["catalog<br/>eclipse-temurin:21-jre<br/>1 CPU · 768 MB"] -->|db:5432| db[("db<br/>postgres:17")]
        db --- vol[("volume db-data")]
    end
```

## 1. Dockerfile

Um build **multi-stage**: o primeiro estágio tem o JDK e o Maven e compila o jar; o segundo tem só um JRE e o jar. A imagem final é menor, não tem compilador e não exige Maven na máquina que faz o build.

``` { .dockerfile title="services/catalog/Dockerfile" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/1/code/services/catalog/Dockerfile"
```

``` { .text title="services/catalog/.dockerignore" .copy }
--8<-- "docs/2027.1/hands-on/1/code/services/catalog/.dockerignore"
```

| Linha | Por quê |
|---|---|
| `--mount=type=cache,target=/root/.m2` | o BuildKit guarda o repositório Maven entre builds: o primeiro baixa as dependências (alguns minutos), os seguintes levam segundos |
| `useradd` + `USER app` | o processo não roda como root dentro do container |
| `-XX:MaxRAMPercentage=75` | a JVM dimensiona o heap pelo limite de memória do **container**, não pela RAM do seu notebook |
| `.dockerignore` | uma pasta `target/` local nunca é enviada ao build |

## 2. docker-compose.yaml

Crie-o na **raiz** do repositório:

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/1/code/docker-compose.yaml"
```

| Configuração | Por quê |
|---|---|
| `name: boxoffice` | nome de projeto fixo: os containers são `boxoffice-db-1`, `boxoffice-catalog-1`, … em toda máquina |
| `db.healthcheck` + `depends_on: condition: service_healthy` | o `catalog` só inicia quando o PostgreSQL aceita conexões; senão o Flyway falha na inicialização |
| `volumes: db-data` | os dados sobrevivem a `docker compose down`; `down -v` os apaga |
| `deploy.resources.limits` | **1 CPU e 768 MB** por `catalog`: um "servidor" fixo e pequeno, para que as medições sejam comparáveis e a escala horizontal do lab 3 seja visível |
| `catalog.healthcheck` | o Compose marca o container como `healthy` só quando `/actuator/health/readiness` responde (a imagem JRE tem `wget`, não `curl`) |

## 3. Rode

``` { .bash .copy }
docker compose up --build -d
docker compose ps
docker compose logs -f catalog
```

<!-- termynal -->
``` shell
> docker compose up --build -d
 Image boxoffice-catalog Built
 Container boxoffice-db-1 Healthy
 Container boxoffice-catalog-1 Started
> docker compose logs catalog | grep -E "Migrating|Successfully|Started"
Migrating schema "catalog" to version "1 - create catalog"
Migrating schema "catalog" to version "2 - seed catalog"
Successfully applied 2 migrations to schema "catalog", now at version v2 (execution time 00:01.204s)
Started CatalogApplication in 10.4 seconds (process running for 11.178)
```

Agora chame a API:

<!-- termynal -->
``` shell
> curl -s localhost:8082/catalog/events/1 | jq
{
  "id": 1,
  "title": "BoxOffice Fest — Stadium Night",
  "category": "FESTIVAL",
  "startsAt": "2027-06-12T23:00:00Z",
  "priceFrom": 250.00,
  "venue": { "id": 1, "name": "Stadium São Paulo", "city": "São Paulo", "capacity": 60000 }
}
> curl -s "localhost:8082/catalog/events?city=Recife&size=2" | jq -c '{page, totalItems, first: .items[0].title}'
{"page":0,"totalItems":20000,"first":"Concert #12"}
> curl -s localhost:8082/catalog/events/999999
{"detail":"event 999999 not found","instance":"/catalog/events/999999","status":404,"title":"Not Found"}
```

Crie um local e um evento, e depois quebre as regras de propósito:

``` { .bash .copy }
# 201 Created + Location header
curl -i -X POST localhost:8082/catalog/venues -H 'Content-Type: application/json' \
  -d '{"name":"Arena Insper","city":"São Paulo","capacity":800}'

curl -i -X POST localhost:8082/catalog/events -H 'Content-Type: application/json' \
  -d '{"title":"Systems Rock","category":"CONCERT","venueId":51,"startsAt":"2027-09-01T21:00:00-03:00","priceFrom":120}'

# 400: missing title and negative price
curl -s -X POST localhost:8082/catalog/events -H 'Content-Type: application/json' \
  -d '{"category":"CONCERT","venueId":1,"startsAt":"2027-09-01T21:00:00-03:00","priceFrom":-1}' | jq

# 400: page size above the maximum
curl -s "localhost:8082/catalog/events?size=500" | jq
```

## 4. Olhe por dentro

``` { .bash .copy }
# the tables and the Flyway history, from inside the db container
docker compose exec db psql -U boxoffice -c '\dt catalog.*'
docker compose exec db psql -U boxoffice -c 'SELECT version, description, success FROM catalog.flyway_schema_history'

# how the listing query runs (lab 6 comes back to this)
docker compose exec db psql -U boxoffice -c "EXPLAIN ANALYZE SELECT e.* FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id WHERE v.city = 'Recife' AND e.starts_at >= now() ORDER BY e.starts_at LIMIT 20"

# health, metrics and the OpenAPI document
curl -s localhost:8082/actuator/health | jq
curl -s localhost:8082/actuator/metrics/hikaricp.connections.max | jq '.measurements[0].value'
curl -s localhost:8082/catalog/openapi | jq '.paths | keys'
```

Abra [http://localhost:8082/swagger-ui.html](http://localhost:8082/swagger-ui.html){target="_blank"} para ver a documentação interativa gerada a partir dos seus controllers — o mesmo documento OpenAPI pode gerar clientes em outras linguagens.

## 5. Comandos do dia a dia

| Comando | Efeito |
|---|---|
| `docker compose up --build -d` | recompila o que mudou e sobe tudo em segundo plano |
| `docker compose logs -f catalog` | acompanha os logs de um serviço |
| `docker compose restart catalog` | reinicia sem recompilar |
| `docker compose down` | para e remove os containers (dados mantidos em `db-data`) |
| `docker compose down -v` | …e apaga o volume do banco (o Flyway popula de novo na próxima inicialização) |
| `docker stats` | CPU e memória ao vivo por container — deixe aberto durante os testes de carga |

!!! warning "Armadilhas"

    - **Port 5432 already allocated**: há um PostgreSQL local rodando; pare-o ou mapeie `"15432:5432"`.
    - **`Connection refused` do catalog para `localhost:5432`**: dentro de um container, o banco é `db`, não `localhost` — confira o `DB_HOST`.
    - **Alterou uma migration que já rodou** → `Validate failed: Migrations have failed validation`. Restaure o arquivo e acrescente uma nova versão, ou (só no seu notebook) `docker compose down -v`.
    - **Apple Silicon / ARM**: todas as imagens usadas nos labs são multiarquitetura; não acrescente `platform: linux/amd64`.

Volte à [visão geral do lab](../index.md#measure-it) para medir.
