A model can write fifty unit tests in a minute. The hard question is not *can it write tests* but **are these tests worth keeping?** Coverage does not answer it: a test that calls every method and asserts nothing reaches 100 % line coverage and catches zero bugs. This part uses **mutation testing** as the judge: a generated test is kept only if it catches bugs that the existing tests miss.

## 2.1 Mutation testing in one paragraph

A mutation-testing tool makes small changes to the production code — each one a **mutant**: `>` becomes `>=`, `a * b` becomes `a / b`, a `return price` becomes `return 0`, a method call is removed — and runs the tests against each mutant. If some test fails, the mutant is **killed** (the tests noticed the bug); if all tests still pass, it **survived** (a bug the tests cannot see). The **mutation score** is killed ÷ total. [PIT](https://pitest.org){target="_blank"} is the standard tool for the JVM[^1].

``` diagram-sim
flowchart LR
    pr["PR changes<br/>CatalogService.java"] --> base["PIT with existing tests<br/>baseline score"]
    base --> gen["Model writes<br/>CatalogServiceAiTest"]
    gen --> comp{"compiles and<br/>passes twice?"}
    comp -->|"no: errors back"| gen
    comp -->|"yes"| pit["PIT with existing + new tests"]
    pit --> gain{"score ≥ baseline + 5 pp?"}
    gain -->|"no: survivors back"| gen
    gain -->|"yes"| pr2["Draft PR with the test"]
```

The loop gives the model **three kinds of feedback**, in order: compiler errors, failing tests, and the list of **surviving mutants** ("line 42: changed conditional boundary in `isExpired()`"). That last one is the interesting part: it tells the model exactly which behaviour is untested, the same idea behind mutation-guided test generation reported at Meta[^2].

## 2.2 Add unit tests and PIT to `catalog`

The generator needs a service with **test libraries** and **PIT**. [Lab 11](../../11/ci/index.md) already gave `catalog` its test dependencies (the Spring Boot test starters, which bring JUnit Jupiter, Mockito and AssertJ, plus Testcontainers for the integration test). Lab 13 adds one block, marked `lab 13` in the file: the PIT plugin with its JUnit 5 adapter, which also runs the JUnit 6 tests of Spring Boot 4. PIT runs only when you call its goal, never in a plain `mvn verify`. Replace the file — it is lab 11's `pom.xml` plus that block:

``` { .xml title="services/catalog/pom.xml" .copy }
--8<-- "docs/2027.1/hands-on/13/code/services/catalog/pom.xml"
```

And a first, deliberately incomplete, hand-written test of `CatalogService` — plain JUnit + Mockito, no Spring context and no database, so it runs in a second:

``` { .java title="services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java" .copy }
--8<-- "docs/2027.1/hands-on/13/code/services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java"
```

**Checkpoint.** From the repository root:

``` { .bash .copy }
mvn -B -f services/catalog/pom.xml verify
```

`verify` runs **both** test classes of `catalog`: the integration test `CatalogApiTest` of lab 11 (Testcontainers: **Docker must be running**) and the new `CatalogServiceTest`. You should see, near the end (the first run downloads the test libraries and the `postgres:17` and `redis:8-alpine` images; the times vary):

```text
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 10.41 s -- in boxoffice.catalog.CatalogApiTest
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.165 s -- in boxoffice.catalog.CatalogServiceTest
...
[INFO] Tests run: 6, Failures: 0, Errors: 0, Skipped: 0
...
[INFO] BUILD SUCCESS
```

A warning `Mockito is currently self-attaching to enable the inline-mock-maker` is harmless. Docker not running right now? Run only the new unit test, which needs no container: `mvn -B -f services/catalog/pom.xml test -Dtest=CatalogServiceTest` prints `Tests run: 3, Failures: 0, Errors: 0, Skipped: 0`. PIT (below) and the generator also run only unit tests, so they work without Docker.

Now run PIT by hand once on one class to see the report (HTML in `services/catalog/target/pit-reports/index.html`):

``` { .bash .copy }
mvn -B -f services/catalog/pom.xml test-compile org.pitest:pitest-maven:mutationCoverage \
  -DtargetClasses=boxoffice.catalog.CatalogService -DtargetTests='boxoffice.catalog.CatalogService*Test'
```

You should see, near the end (a run on Java 21 while this lab was written; the timings depend on your machine, the counts do not):

```text
================================================================================
- Statistics
================================================================================
>> Line Coverage (for mutated classes only): 10/28 (36%)
>> 1 tests examined
>> Generated 18 mutations Killed 4 (22%)
>> Mutations with no coverage 14. Test strength 100%
>> Ran 4 tests (0.22 tests per mutation)
...
[INFO] BUILD SUCCESS
```

Read it: PIT made **18 mutants** of `CatalogService`; the three tests of `CatalogServiceTest` killed **4** (a mutation score of 22 %). Fourteen mutants are in code that no test even executes (`findEvent`, `upcomingEvents`, `createEvent`, ...). Open the HTML report: each red line is a bug your tests would not notice. That gap is what the generator must close.

!!! tip "Keep PIT targeted"

    Mutation testing is expensive: every mutant runs (part of) the test suite. On a whole service it can take many minutes. Always target the classes the PR changed (`-DtargetClasses`) — that is exactly what the script does.

## 2.3 The generator

``` { .python title=".github/ai/gen_tests.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/gen_tests.py"
```

| Rule in the code | Why |
|---|---|
| New file `<Class>AiTest.java`, never edits `<Class>Test.java` | Generated tests never overwrite human ones; review sees exactly what is new |
| `FORBIDDEN` constructs | No `Thread.sleep` (slow and flaky), no `@SpringBootTest` (slow, needs a DB), no `@Disabled` (a disabled test is a lie) |
| Same-package sources in the prompt | To mock `EventRepository` the model needs its real method signatures, otherwise the test does not compile |
| Runs the test **twice** | A test that passes once and fails once is worse than no test |
| `env` without `KEY`/`TOKEN`/`SECRET` | The code under test, and the generated test, never see the API key |
| `MIN_GAIN` of 5 percentage points | A test that adds nothing measurable is noise to maintain |
| Deletes the file if rejected | Nothing unproven is left in the working tree |
| One line per attempt in the summary | You can see *why* an attempt was rejected: compile error, failing test, or too few mutants killed |

## 2.4 Try it locally

Commit part 2 on `main` first (the workflow of 2.5 is part of it — save it now), so that the generator starts from a clean tree:

``` { .bash .copy }
git switch main
git add services/catalog/pom.xml services/catalog/src/test .github/ai/gen_tests.py .github/workflows/ai-tests.yaml
git commit -m "test(catalog): unit tests, PIT and the AI test generator (lab 13)"
git push
```

Then run the generator on `CatalogService`, from the repository root. It needs `mvn` and JDK 21 on your machine, and calls the model up to three times; with the local model expect **5–15 minutes**:

``` { .bash .copy }
uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
  python .github/ai/gen_tests.py services/catalog/src/main/java/boxoffice/catalog/CatalogService.java
git status --short   # CatalogServiceAiTest.java exists only if it was accepted
```

The summary compares the mutation score with and without the generated class, and says why each attempt was accepted or rejected. A run with the local `qwen2.5-coder-16k` while this lab was written:

```text
### AI tests for `boxoffice.catalog.CatalogService`

| | Mutation score | Killed / total |
|---|---|---|
| Existing tests | 22% | 4 / 18 |
| With `CatalogServiceAiTest` | — (no attempt compiled and passed) | — |

Attempts: 3 · accepted: **False**

- 1. does not compile or fails: [ERROR] services/catalog/src/test/java/boxoffice/catalog/CatalogServiceAiTest.java:[57,91] cannot find symbol / [ERROR] services/catalog/src/test/java/boxoffice/catalog/CatalogServiceAiTest.java:[68,133] cannot find symbol
- 2. does not compile or fails: [ERROR] Tests run: 13, Failures: 0, Errors: 4, Skipped: 0, Time elapsed: 18.49 s <<< FAILURE! -- in boxoffice.catalog.CatalogServiceAiTest / [ERROR] boxoffice.catalog.CatalogServiceAiTest.createVenueCreatesVenue -- Time elapsed: 0.198 s <<< ERROR!
- 3. does not compile or fails: [ERROR] services/catalog/src/test/java/boxoffice/catalog/CatalogServiceAiTest.java:[45,53] cannot find symbol / [ERROR] services/catalog/src/test/java/boxoffice/catalog/CatalogServiceAiTest.java:[45,87] cannot find symbol

| Model | Calls | Input | Cache read | Cache write | Output | Time | Cost |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder-16k` | 3 | 10,604 | 0 | 0 | 5,466 | 454.0 s | n/a (local or unknown model) |
```

**Rejected** — and that is the generator working, not failing. The free 7B model invented methods (`cannot find symbol`) or wrote tests that throw; a second run with `AI_TESTS_MAX_ATTEMPTS=5` failed the same way five times (21,278 input tokens, ~16 minutes). Nothing unproven was left behind: `git status` shows no `CatalogServiceAiTest.java`. A stronger model (Claude, or a larger local model if your machine has the memory) has a better chance to compile — and then still has to beat the 22 % baseline by 5 pp; compare them in part 7. If yours is accepted, the second row shows the new score and `git status` lists the new test file.

Record your numbers — model, attempts, baseline and final score, minutes — for part 7.

## 2.5 The workflow

Generating tests for every PR would be slow and expensive. The workflow runs **on demand**: add the label `ai-tests` to a PR. It has **two jobs**: `generate` runs the model and the build with a read-only token, and `publish` — the only job that can write — applies the patch and opens a draft PR. The job that executes untrusted code (the PR's code and the model's code) never holds a write token.

``` { .yaml title=".github/workflows/ai-tests.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/workflows/ai-tests.yaml"
```

The job picks at most two classes **added or modified** by the PR under `src/main/java`. Open a small PR that touches `CatalogService` — a one-line class comment is enough:

``` { .bash .copy }
git switch main && git pull
git switch -c catalog-docs
```

``` { .diff title="services/catalog/src/main/java/boxoffice/catalog/CatalogService.java" }
-@Service
+/** Use cases of the catalog: events and venues. */
+@Service
 public class CatalogService {
```

``` { .bash .copy }
git commit -am "docs(catalog): describe CatalogService"
git push -u origin catalog-docs
gh pr create --fill --base main
gh pr edit --add-label ai-tests      # the label was created in step 0.4
gh pr checks --watch                # "AI tests / generate" appears a few seconds after the label
```

You should see the `generate` job finish (20–45 minutes with the free model on a CPU runner: the model, two Maven builds per attempt and PIT) and then either:

- a draft PR `AI tests for #N`, label `ai-generated`, based on `catalog-docs`, with one commit carrying the trailer `AI-assisted: gen_tests.py (...)` — check it with `gh pr list --label ai-generated`; or
- `publish` **skipped**, and the job summary of `generate` listing the rejected attempts. That is a valid result: write down why.

Merge an `AI tests` PR into your branch only after reading every test.

!!! warning "The oracle problem"

    A generated test asserts what the code **does**, not what it **should do**. If `HoldService` lets a hold expire two minutes early, the model will happily write `assertThat(hold.expiresAt()).isEqualTo(now.plusMinutes(8))` — and the bug is now protected by a green test. Mutation testing proves the tests are *sensitive*, not that they are *right*. Read each assertion against the requirement ("a hold lasts 10 minutes"), not against the code.

!!! warning "Common pitfalls"

    - **Measuring generated tests by coverage**: coverage rises with assertion-free tests. Use the mutation score.
    - **Letting the generator edit production code "to make the test pass"**: then it is not a test generator, it is an unreviewed refactoring tool.
    - **Running PIT on everything on every PR**: minutes and dollars. Target the changed classes, on demand.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Could not find a valid Docker environment` in `CatalogApiTest` | `mvn verify` also runs the Testcontainers test of lab 11, and Docker is not running | start Docker (lab 0); or run only the unit test: `mvn -B -f services/catalog/pom.xml test -Dtest=CatalogServiceTest` |
| `package org.junit.jupiter.api does not exist` | `spring-boot-starter-test` missing from the `pom.xml` | use the `pom.xml` of step 2.2 |
| PIT: `No test library found` or `0 tests examined` | the `pitest-junit5-plugin` dependency is missing, or `-DtargetTests` does not match the test class name | keep the plugin block of step 2.2; test classes end in `Test` (`CatalogService*Test`) |
| `release version 21 not supported` / `The JAVA_HOME environment variable is not defined correctly` | Maven runs on another JDK, or `JAVA_HOME` is wrong | `java -version` must say 21+; set `JAVA_HOME` (macOS: `export JAVA_HOME=$(/usr/libexec/java_home -v 21)`) |
| `mvn: command not found` during `gen_tests.py` | Maven not on the `PATH` of this shell | install it (lab 0) or open a new terminal |
| Every attempt `does not compile or fails` | the model invents methods, or forgets imports (common with small local models) | read the error in the attempts list; try `AI_TESTS_MAX_ATTEMPTS=5`, or a stronger model; a rejection is a valid, recorded result |
| `passes twice; mutation score ...` but not accepted | the new tests run but kill too few extra mutants (`MIN_GAIN` = 5 pp) | expected: they are not worth keeping. Look at the survivors in the PIT report |
| The `generate` job hits its 60-minute timeout | CPU runner + local model + PIT | target one class (`head -n 1` in the workflow) or use a hosted model for this job |

[Next: part 3 — the fix agent](../fix-agent/index.md){ .md-button .md-button--primary }

[^1]: COLES, H. et al. [PIT: a practical mutation testing tool for Java](https://pitest.org){target="_blank"}. ISSTA 2016 (tool demo).
[^2]: FOSTER, C. et al. *Mutation-Guided LLM-based Test Generation at Meta*. FSE 2025 (industry track).
