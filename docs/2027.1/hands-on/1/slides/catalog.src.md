---
marp: true
lang: en
title: Lab 1 — First service
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper · Lab 1</div>

# Lab 1 — First service: `catalog`

**A REST API for events and venues: Spring Boot, PostgreSQL, Flyway, a container — and its unloaded latency**

<!--
Outline: (1) why catalog first; (2) the API contract; (3) layers and DTOs; (4) JPA, N+1, the pool;
(5) Flyway; (6) Dockerfile and Compose; (7) smoke test and service time.
-->

---

## Why `catalog` first?

<div class="q">

During the flash sale, how many reads of the event page happen for each change an admin makes?

</div>

- Millions of fans refresh; a handful of admins edit → **read-heavy**.
- It will be the guinea pig for **load balancing** (lab 3), **caching** (lab 5), **indexing** (lab 6).
- Today: the **simplest version that works** — monolith-first.

---

## The contract

| Method | Path | Answer |
|---|---|---|
| `GET` | `/catalog/events?city=&page=&size=` | page of upcoming events |
| `GET` | `/catalog/events/{id}` | event + venue, or `404` |
| `POST` | `/catalog/events` | `201` + `Location` |
| `PUT` · `DELETE` | `/catalog/events/{id}` | `200` · `204` |
| `GET` · `POST` | `/catalog/venues` | venues |

<p class="small">Everything under <code>/catalog</code>: the edge and the gateway route without rewriting paths.</p>

---

## Design decisions

- Collections are **paginated**, `size ≤ 50` — every list is bounded.
- Money is `BigDecimal` / `NUMERIC(10,2)`; time is `TIMESTAMPTZ`, ISO-8601.
- Errors are RFC 9457 **`problem+json`**.
- `201 Created` + `Location` for new resources.

<div class="ok">

In the interview: resources + verbs, **pagination strategy**, error model.

</div>

---

## Three layers, one rule

<div class="cols">
<div>

- **Controller**: HTTP, validation, status codes.
- **Service**: business rules, `@Transactional`.
- **Repository**: queries (JPA).

</div>
<div>

<div class="warn">

The API **never** returns entities: only records (`EventOut`, `VenueOut`). A new column must not leak; a lazy association must not explode.

</div>

</div>
</div>

---

## Validation at the edge of the service

```java
@GetMapping
public PageOut<EventOut> list(
        @RequestParam(required = false) String city,
        @RequestParam(defaultValue = "0") @Min(0) int page,
        @RequestParam(defaultValue = "20") @Min(1) @Max(50) int size)
```

- `@Valid @RequestBody EventIn` → `400` before the method runs.
- `?size=500` → `400 problem+json`, not a 500-row query.

---

## JPA: watch the N+1

<div class="q">

Listing 20 events, each with its venue. How many SQL queries?

</div>

*   Without `join fetch`: **1 + 20 = 21** round trips.
*   With `select e from Event e join fetch e.venue`: **1**.
*   Each round trip holds one of the **10 pooled connections** longer.

---

## Flyway: the schema is code

- `V1__create_catalog.sql`, `V2__seed_catalog.sql` — applied **once, in order**.
- **Never edit** an applied migration: add `V3__...`.
- `ddl-auto: validate`: Hibernate checks, Flyway owns.
- Seed with `generate_series`: **200,000 events**, identical on every laptop.

<p class="small">Realistic data volume on purpose: a query instant on 10 rows can take tens of ms on 200,000.</p>

---

## The container

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package -DskipTests
FROM eclipse-temurin:21-jre
COPY --from=build /src/target/app.jar app.jar
USER app
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
```

- Build tools stay in the first stage; the image ships a JRE + jar.

---

## Compose: `db` + `catalog`

- `depends_on: condition: service_healthy` — wait for `pg_isready`, not just "started".
- Volume `db-data`: data survives `down`; `down -v` resets.
- **1 CPU, 768 MB** per `catalog`: a fixed unit of capacity.
- Health at `/actuator/health/readiness`.

<div class="warn">

Inside a container, the database is `db`, not `localhost`.

</div>

---

## Measure it: service time

```bash
k6 run load/smoke.js        # 1 VU, 30 s, think time 0.5 s
```

| Endpoint | p50 | p95 | p99 |
|---|---|---|---|
| `GET /catalog/events/{id}` | ~5 ms | ~11 ms | ~40 ms |
| `GET /catalog/events?city=` | ~30 ms | ~42 ms | ~71 ms |

<p class="small">One laptop's numbers — record yours in <code>results/lab1.md</code>.</p>

---

## Reading the baseline

- Listing ≈ **6×** the detail: join + sort + `count(*)` over 20,000 rows.
- p99 ≫ p50 even with **one** user: JIT, GC, cold pool, cold pages.
- Always **warm up** before measuring; never compare cold with warm.

<div class="q">

Which endpoint will break first under load? Write the hypothesis for lab 2.

</div>

---

## Takeaways

1. Design the **contract** first: resources, bounded collections, status codes, `problem+json`.
2. DTOs (records) **decouple** the API from the tables.
3. `join fetch` avoids **N+1**; every query borrows a pooled connection.
4. **Flyway** owns the schema; applied migrations never change.
5. One command to run it all: `docker compose up --build`.
6. Record the **unloaded latency**: it is the reference for every later lab.
