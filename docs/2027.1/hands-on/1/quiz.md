Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** Why does `catalog` return `EventOut` records instead of the `Event` JPA entity?

- A. Records serialize faster than classes
- B. The API contract stays independent of the table: new columns do not leak, and lazy associations are never serialized outside a transaction
- C. Spring MVC cannot serialize entities
- D. Entities cannot have an `id` field

??? success "Answer"
    **B — Decouple the contract from the storage.**

    An entity is a mapping of a table; a DTO is a promise to clients. If they are the same object, every schema change is an API change, and a lazy `venue` touched by Jackson after the transaction ends throws `LazyInitializationException`.

---

**Q2.** Listing 20 events without `join fetch e.venue` runs how many SQL queries (ignoring the count)?

- A. 1
- B. 2
- C. 20
- D. 21

??? success "Answer"
    **D — 21: the N+1 problem.**

    One query loads the 20 events; then each `event.getVenue()` triggers one more query. With `join fetch` it becomes one `JOIN`. Under load, 21 round trips per request multiply the time each request holds a pooled connection.

---

**Q3.** A teammate edits `V2__seed_catalog.sql`, which already ran on everyone's machine, to fix a typo. What happens at the next startup?

- A. Flyway applies the new version of V2 automatically
- B. Flyway detects a checksum mismatch and the service fails to start
- C. Nothing: Flyway ignores files that already ran
- D. Hibernate fixes the data with `ddl-auto`

??? success "Answer"
    **B — Checksum mismatch, startup fails.**

    Flyway stores a checksum of every applied migration. Applied migrations are history and must not change; a fix goes into a new migration (`V3__fix_typo.sql`). This is what makes every environment converge to the same schema.

---

**Q4.** What does `spring.jpa.hibernate.ddl-auto: validate` do?

- A. Creates the tables that are missing
- B. Drops and recreates the schema at every start
- C. Checks that the entities match the existing tables and fails if they do not, without changing anything
- D. Validates the JSON of incoming requests

??? success "Answer"
    **C — Check, never change.**

    The schema has a single owner: Flyway. Hibernate only verifies that the mapping is consistent, which catches a missing migration at startup instead of at the first query in production.

---

**Q5.** A client calls `GET /catalog/events?size=5000`. What does the service answer, and why is that a design decision?

- A. 200 with 5,000 events — the client asked for them
- B. 400, because `size` has `@Max(50)`: every collection must be bounded, or one request can load the whole table
- C. 404, because page 5,000 does not exist
- D. 500, because Hibernate cannot load more than 50 rows

??? success "Answer"
    **B — 400: bounded collections.**

    An unbounded page size is a denial-of-service vector you ship yourself. The limit belongs to the contract, enforced at the edge of the service, before any query runs.

---

**Q6.** In the smoke test, the listing (`?city=`) is ~5–10× slower than the detail (`/{id}`). What is the main reason?

- A. JSON serialization of 20 items
- B. The listing joins two tables, filters, sorts and counts thousands of rows without an index; the detail is a primary-key lookup
- C. The listing uses HTTP/1.0
- D. The city name has an accent

??? success "Answer"
    **B — Work done in the database.**

    The detail touches one row through the primary-key index. The listing scans the events of a whole city twice (page + `count(*)`) and sorts them. Lab 6 shows the `EXPLAIN` and fixes it with an index; lab 5 hides it with a cache.

---

**Q7.** Why does the `catalog` container have `deploy.resources.limits.cpus: "1.0"`?

- A. Spring Boot cannot use more than one core
- B. To make each replica a small, fixed-size "server", so measurements are comparable and adding replicas (lab 3) shows a visible effect
- C. Docker requires a CPU limit for Java images
- D. To make the build faster

??? success "Answer"
    **B — A fixed unit of capacity.**

    Without a limit, one container can use every core of your laptop, and scaling out would show no gain. Real servers and pods have fixed sizes too; capacity planning is "how many units of this size?".

---

**Q8.** Why use a multi-stage Dockerfile?

- A. It is the only way to build Java images
- B. The final image has only the JRE and the jar: smaller, faster to pull, and without build tools that enlarge the attack surface
- C. Multi-stage images start faster because they skip the JIT
- D. It makes the image run as root

??? success "Answer"
    **B — Small runtime image, build tools left behind.**

    The build stage (JDK + Maven, hundreds of MB) is discarded. Smaller images mean faster deployments and autoscaling (lab 10), and fewer packages to patch.

---

**Q9.** `catalog` starts before PostgreSQL is ready and crashes in Flyway. Which Compose setting fixes it?

- A. `restart: always` on `db`
- B. `depends_on: db: condition: service_healthy` with a `healthcheck` (`pg_isready`) on `db`
- C. `links: - db`
- D. Increasing the memory limit of `catalog`

??? success "Answer"
    **B — Wait for health, not for start.**

    A plain `depends_on` only waits until the container *starts*; PostgreSQL needs a few more seconds to accept connections. The healthcheck turns "started" into "ready". In Kubernetes (lab 10) the same idea becomes readiness probes.

---

**Q10.** The smoke test shows p50 = 5 ms and p99 = 40 ms for the detail with **one** user. Which explanation is the most plausible?

- A. The network between k6 and the container drops packets
- B. Occasional pauses that do not depend on load: JIT compilation, garbage collection, opening pooled connections, cold database pages
- C. The database is overloaded
- D. k6 measures p99 incorrectly

??? success "Answer"
    **B — Tail latency exists even without load.**

    With one user there is no queueing, so the tail comes from the runtime itself. That is why load tests have a warm-up period and why you always look at percentiles, not only at the median.
