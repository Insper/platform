---
marp: true
lang: en
title: Lab 0 — Environment
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

<div class="kicker">System Architecture · Insper · Lab 0</div>

# Lab 0 — Environment

**One toolchain, one repository, one set of names — and a first measurement**

<!--
Outline: (1) what BoxOffice becomes over 13 labs; (2) the toolchain; (3) the services/ports table;
(4) the repository; (5) the baseline measurement with k6; (6) first look at the playground.
-->

---

## BoxOffice, one lab at a time

<div class="q">

A stadium show goes on sale at 10:00: **2 M fans, 60 k seats**. What has to exist for that morning not to be a disaster?

</div>

<div class="flow">
<div class="box muted">fan / k6</div><div class="arrow">→</div>
<div class="box accent">edge<small>Nginx · lab 3</small></div><div class="arrow">→</div>
<div class="box orange">gateway + auth<small>lab 4</small></div><div class="arrow">→</div>
<div class="box">catalog ×3<small>lab 1 · cache lab 5</small></div>
<div class="box">inventory<small>lab 6 · replica, PgBouncer</small></div>
<div class="box">order → payment<small>labs 7, 9</small></div>
</div>
<div class="flow">
<div class="box green">PostgreSQL<small>one schema per service</small></div>
<div class="box green">Redis · Kafka<small>labs 5, 7</small></div>
<div class="box">observability<small>lab 8</small></div>
<div class="box accent">Kubernetes · delivery<small>labs 10, 11</small></div>
<div class="box red">artificial intelligence (AI)<small>assistant lab 12 · review lab 13</small></div>
</div>

<p class="small">Lab 2 <b>measures</b> where one <code>catalog</code> breaks. Every lab adds a box — and ends with a measurement.</p>

<!--
Every lab adds one palette component and ends with a measurement. The flash sale is the thread
that ties them together.
-->

---

## The toolchain

| Tool | For |
|---|---|
| **Docker + Compose v2** | every service and database runs in a container |
| **Java Development Kit (JDK) 21 + Maven** | Spring Boot services |
| **uv + Python 3.12** | result scripts, AI assistant (no pip) |
| **k6** | load tests, written in JavaScript |
| **kubectl + kind/minikube** | local Kubernetes (lab 10) |
| **Git, jq, curl** | delivery and poking at APIs |

<div class="ok">

`bash scripts/check-env.sh` must end with **All set.**

</div>

---

## Give Docker room

- macOS and Windows: Docker Desktop → *Settings → Resources*.
- Linux: Docker Engine uses the whole machine, no virtual machine (VM) in between.

<div class="warn">

Docker Desktop's default resources are small: give it **≥ 4 central processing units (CPUs) and 8 GB**, or every later measurement is distorted.

</div>

---

## Names are a contract

| Service | Port | Prefix |
|---|---|---|
| `edge` (Nginx) | 80 | public entry |
| `gateway` | 8080 | all routes |
| `auth` | 8081 | `/auth/**` |
| `catalog` | 8082 | `/catalog/**` |
| `inventory` | 8083 | `/inventory/**` |
| `order` · `payment` · `notification` | 8084 · 8085 · 8086 | `/orders` · `/payments` · `/notifications` |
| `db` · `redis` | 5432 · 6379 | — |

<p class="small">Same port inside the container and on your machine: <code>http://catalog:8082</code> from a container, <code>http://localhost:8082</code> from the terminal.</p>

---

## Shared conventions

- Packages `boxoffice.<service>`, Java 21, Spring Boot 4.1, no Lombok.
- Each service serves **only under its prefix** → routing without rewrites.
- One PostgreSQL, **one schema per service**, owned by its Flyway migrations.
- Same env var names everywhere: `DB_HOST`, `DB_USER`, `REDIS_HOST`, `BASE_URL`…
- Errors as Request for Comments (RFC) 9457 `problem+json`; health at `/actuator/health`.

<div class="q">

Why is "one schema per service, no cross-schema joins" enough isolation for now?

</div>

---

## One repository for the semester

```text
boxoffice/
  compose.yaml            grows every lab
  services/               catalog, auth, gateway, inventory, ...
  infra/                  nginx, postgres, pgbouncer
  load/                   k6 scripts
  results/                lab0.md, lab1.md, ...  ← your measurements
  scripts/check-env.sh
```

- Commit and **tag** every lab: `git tag lab0`.
- `.env` and secrets **never** go to Git.

---

## Measure it: your machine's ceiling

```bash
docker run -d --rm --name hello -p 8888:80 nginx:1.30-alpine
k6 run -e VUS=1  load/hello.js
k6 run -e VUS=10 load/hello.js
k6 run -e VUS=50 load/hello.js
```

- Target does almost nothing → the **best case** for your laptop.
- Every BoxOffice number later is lower; the gap is the cost of code, database and hops.

---

## Reading a k6 summary

| Line | Meaning |
|---|---|
| `http_reqs … /s` | **throughput** (requests per second, RPS) |
| `http_req_duration med` | median latency (p50) |
| `p(95)`, `p(99)` | tail, the 95th and 99th percentiles (p95, p99): 1 in 20 / 1 in 100 is slower |
| `http_req_failed` | error rate |
| `vus` | **concurrency**: virtual users (VUs), a closed model |

---

## A closed model: each VU waits for its answer

<div class="flow">
<div class="box accent">VU sends <code>GET /</code></div><div class="arrow">→</div>
<div class="box">Nginx answers<small>after W, the latency</small></div><div class="arrow">→</div>
<div class="box accent">VU sends again<small>at once, no think time</small></div><div class="arrow">→</div>
<div class="box muted">…<small>1 / W requests per second per VU</small></div>
</div>

- 10 VUs → throughput λ = 10 / W → **L = λ × W = 10** requests inside, whatever the server.
- The load generator fixes L; the server's latency fixes the throughput.
- When the server slows down, a closed model sends **less** — lab 2 shows why that hides overload.

<div class="ok">

Little's Law: **VUs ≈ throughput × latency**. Check it on your own numbers.

</div>

---

## What to expect from 1 → 10 → 50 VUs

<div class="cols">
<div>

<div class="flow">
<div class="box green">1 VU<small>latency = service time · RPS = 1 / latency</small></div><div class="arrow">→</div>
<div class="box accent">10 VUs<small>RPS grows <b>while cores are idle</b></small></div><div class="arrow">→</div>
<div class="box red">50 VUs<small>past saturation: RPS <b>flat</b>, latency <b>grows</b> with VUs</small></div>
</div>

</div>
<div>

<div class="warn">

k6 runs on the same cores: at tens of thousands of RPS you are measuring k6 too.

</div>

</div>
</div>

---

## First look at the playground

- The **System Design Playground** simulates the same components under load.
- Open the `monolith` scenario: client → app → Structured Query Language (SQL) database.
- Raise the load until p99 jumps. **Which component saturates first?**
- Write the hypothesis down — lab 2 checks it against your real `catalog`.

---

## Deliverable

- `check-env.sh` → **All set.**
- Repository `boxoffice` on GitHub, tagged `lab0`.
- `results/lab0.md`: baseline table (1, 10, 50 VUs) + Little's Law check.
- Playground hypothesis written down.
- Quiz.

---

## Takeaways

1. A broken environment costs hours later: run `check-env.sh` **now**.
2. Names, ports and env vars are a **contract** shared by all labs.
3. One schema per service, one prefix per service: **independence** from day one.
4. Every lab ends with a **measurement**, recorded in `results/`.
5. Throughput, percentiles, concurrency: **Little's Law** ties them together.
