# 1. Tests and CI

A pipeline is only as good as the tests it runs. This step adds the first **integration test** of
BoxOffice — the real `catalog` against a real PostgreSQL and a real Redis, started by
**Testcontainers** — and the GitHub Actions workflow that runs it on every push and pull request.
All commands run from the **root of your `boxoffice` repository**.

## An integration test with Testcontainers

Mocks test what you *think* the database does. Testcontainers starts the real thing in Docker for the
duration of the test: Flyway migrations, JPA mappings, SQL, the Redis cache and the JSON error format
are all exercised exactly as in production. Spring Boot's `@ServiceConnection` points the datasource
and the Redis client at the containers — no URLs to configure.

``` java title="services/catalog/src/test/java/boxoffice/catalog/CatalogApiTest.java"
--8<-- "docs/2027.1/hands-on/11/code/services/catalog/src/test/java/boxoffice/catalog/CatalogApiTest.java"
```

The `pom.xml` of `catalog` gains the test dependencies (and, for [step 5](../canary/index.md), the
Prometheus registry). The complete file:

``` xml title="services/catalog/pom.xml"
--8<-- "docs/2027.1/hands-on/11/code/services/catalog/pom.xml"
```

| Dependency | Why |
|---|---|
| `spring-boot-starter-webmvc-test` | JUnit 5, AssertJ, Spring's test support for MVC applications |
| `spring-boot-starter-restclient-test` | `TestRestTemplate`, a real HTTP client against the random port |
| `spring-boot-testcontainers` | `@ServiceConnection`: Boot reads host/port/credentials from the containers |
| `testcontainers-postgresql`, `testcontainers-junit-jupiter` | the PostgreSQL module and the `@Testcontainers`/`@Container` lifecycle (Testcontainers 2) |
| `micrometer-registry-prometheus` | `/actuator/prometheus`, used by the canary analysis of step 5 |

The `tomcat.version` property replaces the Tomcat that Spring Boot 4.1.1 brings (11.0.24): the Trivy
gate of [step 2](../supply-chain/index.md) rejects it for fixable CRITICAL vulnerabilities. Remove the
property when Dependabot updates the parent to a version with a newer Tomcat.

Run it locally (needs Docker running, and JDK 21 + Maven from [lab 0](../../0/index.md)):

<!-- termynal -->

``` shell
> cd services/catalog && mvn -B verify
...
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 9.575 s -- in boxoffice.catalog.CatalogApiTest
[INFO] BUILD SUCCESS
> cd ../..
```

You should see `Tests run: 3, Failures: 0` and `BUILD SUCCESS`; the first run also downloads the
`postgres:17` and `redis:8-alpine` images. If you do not have JDK 21 locally, skip this command: the
CI runner executes exactly the same one.

!!! warning "Tests must not depend on order or on shared data"

    The test reads event 1 (created by the seed migration) and only *fails* to create an event, so it
    leaves no state behind. Tests that create data should use unique values (a UUID in the title) or
    run each in a transaction that rolls back.

## The workflow

GitHub Actions runs **workflows** (`.github/workflows/*.yaml`) made of **jobs** (each on a fresh
virtual machine, a *runner*) made of **steps** (shell commands or reusable *actions*). This lab's CI
has three jobs; this step explains the first, the next steps the others.

``` yaml title=".github/workflows/ci.yaml"
--8<-- "docs/2027.1/hands-on/11/code/.github/workflows/ci.yaml"
```

| Part | What it does |
|---|---|
| `name: CI` | the name other workflows refer to (`deploy.yaml` runs after "CI"; [lab 13](../../13/index.md) too). Do not rename it |
| `on: push` (main) / `pull_request` | every change is tested before and after it is merged; changes only to `k8s/**`, `results/**` or Markdown do not rebuild |
| `permissions: contents: read` | the default token can only read the repository; the `image` job asks for exactly what it needs |
| `concurrency` | a new push to the same branch cancels the run that is now obsolete |
| `test` job, `matrix.service` | one parallel job per Java service; `fail-fast: false` reports every broken service, not only the first |
| `actions/setup-java` with `cache: maven` | downloads JDK 21 and caches `~/.m2` between runs (minutes → seconds) |
| `mvn -B verify` | compiles, runs the unit and Testcontainers tests (Docker is available on GitHub's Ubuntu runners) |
| `upload-artifact` on failure | the surefire reports of a failed run, downloadable from the run page |

Services without tests still run `mvn verify`: it proves they compile and package. Add tests to them
as you go — the matrix already includes them.

## Push and watch

The `performance` job of this workflow runs two files that [step 3](../performance-gate/index.md)
explains: `.github/ci/compose.perf.yaml` and `load/budget.js`. Create them now, otherwise that job
fails with `open .github/ci/compose.perf.yaml: no such file`. Copy `.github/ci/compose.perf.yaml` from
step 3 into a new `.github/ci/` folder (the site does not publish folders whose name starts with a dot,
so it cannot be downloaded), and download `load/budget.js` (or copy it from step 3 too):

``` shell
mkdir -p .github/ci          # then paste compose.perf.yaml from step 3 into it
curl -fsSL -o load/budget.js https://insper.github.io/platform/2027.1/hands-on/11/code/load/budget.js
```

Then commit and push:

``` shell
git add .github services/catalog load/budget.js
git commit -m "lab 11: CI with tests"
git push
```

On GitHub, open your repository → **Actions** → **CI**. You should see the run start within seconds,
seven `test (…)` jobs in parallel, then `performance budget` (step 3) and, on `main`, `image
(catalog)` (step 2). A green check on the commit means every job passed; click a job to read its log.

??? question "Why test on pull requests *and* on main?"

    The pull-request run tests the branch as it was written; the run on `main` tests the result of the
    merge, which can differ (another pull request merged in between). Only the run on `main` publishes
    images — the artifact that will be deployed comes from the tested merge result.

[Next: Image and supply chain](../supply-chain/index.md){ .md-button .md-button--primary }
