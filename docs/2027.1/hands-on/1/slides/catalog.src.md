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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper · Lab 1</div>

# Lab 1 — First service: `catalog`

**A web service for events and venues: Spring Boot, PostgreSQL, Flyway, a container — and its unloaded latency**

<!--
Outline: (1) why catalog first; (2) what you will build; (3) the API contract; (4) layers, DTOs and
status codes; (5) JPA, N+1, the pool; (6) Flyway; (7) Dockerfile and Compose; (8) smoke test and
service time.
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

## What you will build

<div class="flow">
<div class="box muted">fan<small>GET /catalog/events?city=Recife</small></div><div class="arrow">→</div>
<div class="box accent">catalog :8082<small>Spring Boot · 1 CPU, 768 MB</small></div><div class="arrow">→</div>
<div class="box green">db :5432<small>PostgreSQL 17, schema catalog</small></div>
</div>
<div class="flow">
<div class="box">query 1<small>events JOIN venues · ORDER BY starts_at · LIMIT 20</small></div>
<div class="box">query 2<small>count(*) for the page links: 20,000</small></div>
<div class="box green">200<small>{items, page: 0, totalItems: 20000}</small></div>
</div>

- **50 venues in 10 cities, 200,000 events**, seeded by a migration: a realistic volume on purpose.
- Event **1**: *BoxOffice Fest — Stadium Night*, at a 60,000-seat stadium — the flash-sale show of the course.

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
- Errors follow Request for Comments (RFC) 9457: **`problem+json`**.
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
- **Repository**: queries (Jakarta Persistence, JPA).

</div>
<div>

<div class="warn">

The application programming interface (API) **never** returns entities: only records, the data transfer objects (`EventOut`, `VenueOut`). A new column must not leak; a lazy association must not explode.

</div>

</div>
</div>

---

## Which status code?

<div class="flow">
<div class="box muted">POST /catalog/events</div><div class="arrow">→</div>
<div class="box">@Valid EventIn, @Min / @Max<small>checked before the method runs</small></div><div class="arrow">→</div>
<div class="box">CatalogService<small>does the venue exist?</small></div><div class="arrow">→</div>
<div class="box green">201 Created<small>+ Location</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: 1.3"></div>
<div class="box red">400 problem+json<small>missing title, price −1, ?size=500</small></div>
<div class="box red">400 / 404<small>unknown venue / unknown id</small></div>
<div class="arrow" style="flex: .6"></div>
</div>

```java
@RequestParam(defaultValue = "20") @Min(1) @Max(50) int size
```

- `?size=500` → `400 problem+json`, not a 500-row query.

---

## JPA: watch the N+1

<div class="q">

Listing 20 events, each with its venue. How many Structured Query Language (SQL) queries?

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

## The container: two stages

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">build · maven:3.9-eclipse-temurin-21</div>
<div class="box">pom.xml + src/</div>
<div class="box">mvn package<small>~/.m2 in a cache mount</small></div>
<div class="box">target/app.jar</div>
</div>
<div class="arrow" style="align-self: center">COPY --from=build →</div>
<div class="group">
<div class="caption">runtime · eclipse-temurin:21-jre</div>
<div class="box green">app.jar<small>run by user app, not root</small></div>
<div class="box muted">no Java Development Kit (JDK), no Maven, no sources</div>
</div>
</div>

- `java -XX:MaxRAMPercentage=75`: the heap follows the **container's** memory limit.
- The image ships only a Java Runtime Environment (JRE) and the jar.

---

## Compose: what `up` waits for

<div class="flow">
<div class="box">db starts</div><div class="arrow">→</div>
<div class="box green">pg_isready<small>every 5 s → healthy</small></div><div class="arrow">→</div>
<div class="box">catalog starts<small>depends_on: service_healthy</small></div><div class="arrow">→</div>
<div class="box accent">Flyway V1, V2<small>then Hibernate validates</small></div><div class="arrow">→</div>
<div class="box green">/actuator/health/readiness<small>UP → healthy</small></div>
</div>

- Volume `db-data`: data survives `down`; `down -v` resets.
- **1 CPU, 768 MB** per `catalog`: a fixed unit of capacity.

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

- Listing ≈ **2–6×** the detail: join + sort + `count(*)` over 20,000 rows; the detail is a primary-key lookup.
- p99 ≫ p50 even with **one** user: just-in-time (JIT) compilation, garbage collection, cold pool, cold pages.
- Always **warm up** before measuring; never compare cold with warm.

<div class="q">

Which endpoint will break first under load? Write the hypothesis for lab 2.

</div>

---

## Takeaways

1. Design the **contract** first: resources, bounded collections, status codes, `problem+json`.
2. Records **decouple** the API from the tables.
3. `join fetch` avoids **N+1**; every query borrows a pooled connection.
4. **Flyway** owns the schema; applied migrations never change.
5. One command to run it all: `docker compose up --build`.
6. Record the **unloaded latency**: it is the reference for every later lab.
