---
marp: true
lang: pt-BR
title: Lab 1 — Primeiro serviço
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 1</div>

# Lab 1 — Primeiro serviço: `catalog`

**Um serviço web de eventos e locais: Spring Boot, PostgreSQL, Flyway, um container — e a sua latência sem carga**

<!--
Roteiro: (1) por que o catalog primeiro; (2) o que você vai construir; (3) o contrato da API; (4) camadas,
DTOs e códigos de status; (5) JPA, N+1, o pool; (6) Flyway; (7) Dockerfile e Compose; (8) smoke test e
tempo de serviço.
-->

---

## Por que o `catalog` primeiro?

<div class="q">

Durante a venda relâmpago, quantas leituras da página do evento acontecem para cada alteração de um administrador?

</div>

- Milhões de fãs recarregam; um punhado de administradores edita → **muita leitura**.
- Ele será a cobaia do **balanceamento de carga** (lab 3), do **cache** (lab 5), dos **índices** (lab 6).
- Hoje: a **versão mais simples que funciona** — monolith-first.

---

## O que você vai construir

<div class="flow">
<div class="box muted">fã<small>GET /catalog/events?city=Recife</small></div><div class="arrow">→</div>
<div class="box accent">catalog :8082<small>Spring Boot · 1 CPU, 768 MB</small></div><div class="arrow">→</div>
<div class="box green">db :5432<small>PostgreSQL 17, schema catalog</small></div>
</div>
<div class="flow">
<div class="box">consulta 1<small>events JOIN venues · ORDER BY starts_at · LIMIT 20</small></div>
<div class="box">consulta 2<small>count(*) para os links de página: 20.000</small></div>
<div class="box green">200<small>{items, page: 0, totalItems: 20000}</small></div>
</div>

- **50 locais em 10 cidades, 200.000 eventos**, criados por uma migration: um volume realista de propósito.
- Evento **1**: *BoxOffice Fest — Stadium Night*, num estádio de 60.000 lugares — o show da venda relâmpago do curso.

---

## O contrato

| Método | Caminho | Resposta |
|---|---|---|
| `GET` | `/catalog/events?city=&page=&size=` | página de próximos eventos |
| `GET` | `/catalog/events/{id}` | evento + local, ou `404` |
| `POST` | `/catalog/events` | `201` + `Location` |
| `PUT` · `DELETE` | `/catalog/events/{id}` | `200` · `204` |
| `GET` · `POST` | `/catalog/venues` | locais |

<p class="small">Tudo sob <code>/catalog</code>: o edge e o gateway roteiam sem reescrever caminhos.</p>

---

## Decisões de projeto

- Coleções são **paginadas**, `size ≤ 50` — toda lista é limitada.
- Dinheiro é `BigDecimal` / `NUMERIC(10,2)`; tempo é `TIMESTAMPTZ`, ISO-8601.
- Erros seguem o pedido de comentários (RFC, *Request for Comments*) 9457: **`problem+json`**.
- `201 Created` + `Location` para recursos novos.

<div class="ok">

Na entrevista: recursos + verbos, **estratégia de paginação**, modelo de erros.

</div>

---

## Três camadas, uma regra

<div class="cols">
<div>

- **Controller**: HTTP, validação, códigos de status.
- **Service**: regras de negócio, `@Transactional`.
- **Repository**: consultas (JPA, *Jakarta Persistence*).

</div>
<div>

<div class="warn">

A interface de programação (API, *application programming interface*) **nunca** devolve entidades: só records, os objetos de transferência de dados (`EventOut`, `VenueOut`). Uma coluna nova não pode vazar; uma associação lazy não pode explodir.

</div>

</div>
</div>

---

## Qual código de status?

<div class="flow">
<div class="box muted">POST /catalog/events</div><div class="arrow">→</div>
<div class="box">@Valid EventIn, @Min / @Max<small>conferidos antes de o método rodar</small></div><div class="arrow">→</div>
<div class="box">CatalogService<small>o local existe?</small></div><div class="arrow">→</div>
<div class="box green">201 Created<small>+ Location</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: 1.3"></div>
<div class="box red">400 problem+json<small>sem título, preço −1, ?size=500</small></div>
<div class="box red">400 / 404<small>local desconhecido / id desconhecido</small></div>
<div class="arrow" style="flex: .6"></div>
</div>

```java
@RequestParam(defaultValue = "20") @Min(1) @Max(50) int size
```

- `?size=500` → `400 problem+json`, não uma consulta de 500 linhas.

---

## JPA: cuidado com o N+1

<div class="q">

Listar 20 eventos, cada um com o seu local. Quantas consultas na linguagem de consulta estruturada (SQL, *Structured Query Language*)?

</div>

*   Sem `join fetch`: **1 + 20 = 21** idas e voltas.
*   Com `select e from Event e join fetch e.venue`: **1**.
*   Cada ida e volta segura uma das **10 conexões do pool** por mais tempo.

---

## Flyway: o schema é código

- `V1__create_catalog.sql`, `V2__seed_catalog.sql` — aplicadas **uma vez, em ordem**.
- **Nunca edite** uma migration aplicada: acrescente `V3__...`.
- `ddl-auto: validate`: o Hibernate confere, o Flyway é o dono.
- Carga com `generate_series`: **200.000 eventos**, idênticos em todo notebook.

<p class="small">Volume realista de propósito: uma consulta instantânea com 10 linhas pode levar dezenas de ms com 200.000.</p>

---

## O container: dois estágios

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">build · maven:3.9-eclipse-temurin-21</div>
<div class="box">pom.xml + src/</div>
<div class="box">mvn package<small>~/.m2 num cache mount</small></div>
<div class="box">target/app.jar</div>
</div>
<div class="arrow" style="align-self: center">COPY --from=build →</div>
<div class="group">
<div class="caption">runtime · eclipse-temurin:21-jre</div>
<div class="box green">app.jar<small>rodado pelo usuário app, não root</small></div>
<div class="box muted">sem kit de desenvolvimento Java (JDK, <em>Java Development Kit</em>), sem Maven, sem código-fonte</div>
</div>
</div>

- `java -XX:MaxRAMPercentage=75`: o heap segue o limite de memória **do container**.
- A imagem leva só um ambiente de execução Java (JRE, *Java Runtime Environment*) e o jar.

---

## Compose: o que o `up` espera

<div class="flow">
<div class="box">db inicia</div><div class="arrow">→</div>
<div class="box green">pg_isready<small>a cada 5 s → healthy</small></div><div class="arrow">→</div>
<div class="box">catalog inicia<small>depends_on: service_healthy</small></div><div class="arrow">→</div>
<div class="box accent">Flyway V1, V2<small>depois o Hibernate valida</small></div><div class="arrow">→</div>
<div class="box green">/actuator/health/readiness<small>UP → healthy</small></div>
</div>

- Volume `db-data`: os dados sobrevivem ao `down`; `down -v` zera.
- **1 CPU, 768 MB** por `catalog`: uma unidade fixa de capacidade.

<div class="warn">

Dentro de um container, o banco é `db`, não `localhost`.

</div>

---

## Meça: o tempo de serviço

```bash
k6 run load/smoke.js        # 1 VU, 30 s, think time 0.5 s
```

| Endpoint | p50 | p95 | p99 |
|---|---|---|---|
| `GET /catalog/events/{id}` | ~5 ms | ~11 ms | ~40 ms |
| `GET /catalog/events?city=` | ~30 ms | ~42 ms | ~71 ms |

<p class="small">Números de um notebook — registre os seus em <code>results/lab1.md</code>.</p>

---

## Lendo a referência

- Listagem ≈ **2–6×** o detalhe: join + ordenação + `count(*)` sobre 20.000 linhas; o detalhe é uma busca pela chave primária.
- p99 ≫ p50 mesmo com **um** usuário: compilação just-in-time (JIT), coleta de lixo, pool frio, páginas frias.
- Sempre **aqueça** antes de medir; nunca compare frio com aquecido.

<div class="q">

Qual endpoint vai quebrar primeiro sob carga? Anote a hipótese para o lab 2.

</div>

---

## Pontos-chave

1. Desenhe o **contrato** primeiro: recursos, coleções limitadas, códigos de status, `problem+json`.
2. Records **desacoplam** a API das tabelas.
3. `join fetch` evita o **N+1**; toda consulta pega emprestada uma conexão do pool.
4. O **Flyway** é dono do schema; migrations aplicadas nunca mudam.
5. Um comando para rodar tudo: `docker compose up --build`.
6. Registre a **latência sem carga**: é a referência para todos os labs seguintes.
