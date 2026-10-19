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

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 1</div>

# Lab 1 — Primeiro serviço: `catalog`

**Uma API REST de eventos e locais: Spring Boot, PostgreSQL, Flyway, um container — e a sua latência sem carga**

<!--
Roteiro: (1) por que o catalog primeiro; (2) o contrato da API; (3) camadas e DTOs; (4) JPA, N+1, o pool;
(5) Flyway; (6) Dockerfile e Compose; (7) smoke test e tempo de serviço.
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
- Erros são **`problem+json`** (RFC 9457).
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
- **Repository**: consultas (JPA).

</div>
<div>

<div class="warn">

A API **nunca** devolve entidades: só records (`EventOut`, `VenueOut`). Uma coluna nova não pode vazar; uma associação lazy não pode explodir.

</div>

</div>
</div>

---

## Validação na borda do serviço

```java
@GetMapping
public PageOut<EventOut> list(
        @RequestParam(required = false) String city,
        @RequestParam(defaultValue = "0") @Min(0) int page,
        @RequestParam(defaultValue = "20") @Min(1) @Max(50) int size)
```

- `@Valid @RequestBody EventIn` → `400` antes de o método rodar.
- `?size=500` → `400 problem+json`, não uma consulta de 500 linhas.

---

## JPA: cuidado com o N+1

<div class="q">

Listar 20 eventos, cada um com o seu local. Quantas consultas SQL?

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

## O container

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package -DskipTests
FROM eclipse-temurin:21-jre
COPY --from=build /src/target/app.jar app.jar
USER app
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
```

- As ferramentas de build ficam no primeiro estágio; a imagem leva um JRE + o jar.

---

## Compose: `db` + `catalog`

- `depends_on: condition: service_healthy` — esperar o `pg_isready`, não só "iniciado".
- Volume `db-data`: os dados sobrevivem ao `down`; `down -v` zera.
- **1 CPU, 768 MB** por `catalog`: uma unidade fixa de capacidade.
- Saúde em `/actuator/health/readiness`.

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

- Listagem ≈ **6×** o detalhe: join + ordenação + `count(*)` sobre 20.000 linhas.
- p99 ≫ p50 mesmo com **um** usuário: JIT, GC, pool frio, páginas frias.
- Sempre **aqueça** antes de medir; nunca compare frio com aquecido.

<div class="q">

Qual endpoint vai quebrar primeiro sob carga? Anote a hipótese para o lab 2.

</div>

---

## Pontos-chave

1. Desenhe o **contrato** primeiro: recursos, coleções limitadas, códigos de status, `problem+json`.
2. DTOs (records) **desacoplam** a API das tabelas.
3. `join fetch` evita o **N+1**; toda consulta pega emprestada uma conexão do pool.
4. O **Flyway** é dono do schema; migrations aplicadas nunca mudam.
5. Um comando para rodar tudo: `docker compose up --build`.
6. Registre a **latência sem carga**: é a referência para todos os labs seguintes.
