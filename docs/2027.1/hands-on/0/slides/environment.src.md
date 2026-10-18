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

<div class="kicker">System Architecture · Insper · Lab 0</div>

# Lab 0 — Environment

**One toolchain, one repository, one set of names — and a first measurement**

<!--
Outline: (1) what BoxOffice becomes over 12 labs; (2) the toolchain; (3) the services/ports table;
(4) the repository; (5) the baseline measurement with k6; (6) first look at the playground.
-->

---

## BoxOffice, one lab at a time

<div class="q">

A stadium show goes on sale at 10:00: **2 M fans, 60 k seats**. What has to exist for that morning not to be a disaster?

</div>

- Lab 1: one service (`catalog`) + PostgreSQL.
- Lab 2: **measure** it — find where it breaks.
- Labs 3–6: edge, gateway, cache, data at scale.
- Labs 7–9: async, observability, resilience.
- Labs 10–12: Kubernetes, delivery, AI assistant.

<!--
Every lab adds one palette component and ends with a measurement. The flash sale is the thread
that ties them together.
-->

---

## The toolchain

| Tool | For |
|---|---|
| **Docker + Compose v2** | every service and database runs in a container |
| **JDK 21 + Maven** | Spring Boot services |
| **uv + Python 3.12** | result scripts, AI assistant (no pip) |
| **k6** | load tests, written in JavaScript |
| **kubectl + kind/minikube** | local Kubernetes (lab 10) |
| **Git, jq, curl** | delivery and poking at APIs |

<div class="ok">

`bash scripts/check-env.sh` must end with **All set.**

</div>

---

## Windows? Use WSL 2

- `wsl --install -d Ubuntu-24.04`
- Docker Desktop with **WSL integration** on.
- Follow the **Linux** instructions inside Ubuntu.
- Keep the repository in `~/boxoffice`, **not** in `/mnt/c/...`.

<div class="warn">

Docker Desktop's default resources are small: give it **≥ 4 CPUs and 8 GB**, or every later measurement is distorted.

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
- Errors as RFC 9457 `problem+json`; health at `/actuator/health`.

<div class="q">

Why is "one schema per service, no cross-schema joins" enough isolation for now?

</div>

---

## One repository for the semester

```text
boxoffice/
  docker-compose.yaml     grows every lab
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
- Every BoxOffice number later is lower; the gap is the cost of code, DB and hops.

---

## Reading a k6 summary

| Line | Meaning |
|---|---|
| `http_reqs … /s` | **throughput** (RPS) |
| `http_req_duration med` | median latency (p50) |
| `p(95)`, `p(99)` | tail: 1 in 20 / 1 in 100 is slower |
| `http_req_failed` | error rate |
| `vus` | **concurrency** (closed model) |

<div class="ok">

Little's Law: **VUs ≈ throughput × latency**. Check it on your own numbers.

</div>

---

## What to expect from 1 → 10 → 50 VUs

<div class="cols">
<div>

- 1 VU: latency = service time; RPS = 1 / latency.
- More VUs: RPS grows **while cores are idle**.
- Past saturation: RPS **flat**, latency **grows** with VUs.

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
- Open the `monolith` scenario: client → app → SQL.
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
