BoxOffice's test suite has grown to about 4,000 tests. A full CI run takes 25 minutes, roughly one run in thirty fails for reasons nobody understands and passes on retry, and the `inventory` service — the one where a bug means double-booked seats — has the fewest tests, because its logic is the hardest to test. AI can write tests, triage failures and choose which tests to run. Each of those is useful, and each has a trap: a generated test can **protect a bug**, a triage bot can **hide a real failure** behind the word "flaky", and a test selector can **skip the one test that mattered**. This page is about getting the benefit without falling into the traps.

---

## Where AI helps in testing

| Task | What AI does | How you know it worked | Trap |
|---|---|---|---|
| **Unit tests** | Writes tests for a class or a diff | Mutation score rises; tests pass repeatedly; human review | Tests assert current behaviour, including bugs |
| **Contract tests** | Drafts consumer contracts from code and OpenAPI | Provider verification passes; breaking change detected | Contract copies the implementation, not the agreement |
| **Property-based tests** | Proposes invariants and generators | Properties find a planted bug | Vacuous properties (`true` for all inputs) |
| **Load test scripts** | Generates k6 scripts from OpenAPI and traffic samples | Smoke run passes; workload model reviewed | Unrealistic mix, no think time, closed model by accident |
| **Flaky-test triage** | Classifies a failure from logs and history | Classification agrees with reruns and with humans | Real bugs labelled "flaky" and quarantined |
| **Test selection** | Picks the tests relevant to a change | Few escaped failures vs full runs | The skipped test was the relevant one |
| **Synthetic data** | Generates realistic fake events, venues, users | Covers edge cases; contains no real personal data | Leaking production data into prompts; non-reproducible data |

---

## Generated unit tests and the oracle problem

A test has two parts: the **inputs** (arrange, act) and the **oracle** — the expected result that decides pass or fail. Models are excellent at the first part: they enumerate edge cases (empty list, null, boundary dates, the 61st minute) faster than people. The second part is the problem. To know that a seat hold must last **10** minutes, the model needs the *requirement*; given only the code, it reads `plusMinutes(8)` and writes `isEqualTo(now.plusMinutes(8))`. The test passes and now protects the bug. This is the **test oracle problem**, a long-standing topic of software-testing research[^1], and generated tests make it acute.

What generated tests are reliably good for:

- **Characterization tests** before a refactoring: pin down current behaviour, refactor, confirm nothing changed. Here "asserts current behaviour" is exactly the goal.
- **Regression tests for a bug fix**, when the prompt includes the bug report and the expected behaviour.
- **Edge cases** a human then checks against the specification.

What they cannot do is decide what is *correct*. Requirements, examples in the issue, or an ADR must be in the context — and a human must read the assertions.

### Coverage lies; mutation testing does not (as much)

Line coverage measures which lines **ran** during the tests. A test that calls every method and asserts nothing has full coverage and catches no bug. **Mutation testing** measures whether the tests **notice** a change: the tool creates *mutants* — small modifications such as `<` → `<=`, `+` → `-`, a removed method call, a constant return — and runs the tests against each one. A mutant is **killed** if some test fails; the **mutation score** is killed ÷ total. Surviving mutants point at behaviour no test checks. The idea is old (DeMillo, Lipton and Sayward, 1978); tools like [PIT](https://pitest.org){target="_blank"} make it practical on the JVM[^2].

``` mermaid-sim
flowchart LR
    cls["Changed class<br/>HoldService"] --> base["PIT, existing tests<br/>baseline 41 %"]
    base --> gen["Model writes tests<br/>(class + requirements + neighbours)"]
    gen --> run{"compile, pass twice?"}
    run -->|"no: errors"| gen
    run -->|"yes"| pit["PIT, existing + new tests"]
    pit --> better{"score ≥ baseline + 5 pp?"}
    better -->|"no: surviving mutants"| gen
    better -->|"yes"| review["Draft PR → human reads assertions"]
```

The loop above feeds the **surviving mutants** back to the model ("line 42: changed conditional boundary in `isExpired()` survived") — the approach Meta reported for generating tests that target specific classes of faults[^3]. It turns a vague request ("write more tests") into a precise one ("write a test that fails if this `<` becomes `<=`").

!!! warning "Mutation testing is expensive"

    Each mutant re-runs (part of) the test suite. On a whole service, a mutation run can take far longer than the normal build. Target the **changed classes** of a PR, run it **on demand** or nightly, and use incremental analysis where the tool supports it.

---

## Contract tests

In a microservice system the most expensive test failures happen **between** services: `order` expects `inventory` to return `409 Conflict` for an expired hold; `inventory` changes it to `410 Gone`. **Consumer-driven contract tests** (Pact, Spring Cloud Contract) capture what each consumer actually uses, and the provider's build verifies it still satisfies every contract.

AI helps draft them: given the consumer's client code and the provider's OpenAPI document, a model can write the interactions (`POST /inventory/holds/{id}/confirm` → `200` or `409`) much faster than a person. The trap: if the model derives the contract from the **provider's implementation**, the contract describes what the provider does today — not what the consumer needs — and verifies nothing. Generate from the **consumer** side, and let the provider verification (deterministic) be the judge.

---

## Property-based tests

Example-based tests check a few inputs; **property-based tests** state an invariant and let a generator try hundreds of inputs, shrinking any failure to a minimal example. They are a natural fit for the parts of BoxOffice where bugs are expensive:

```java title="services/inventory/src/test/java/boxoffice/inventory/SeatMapProperties.java"
class SeatMapProperties {

    @Property
    void seatsAreNeverDoubleBooked(@ForAll("operations") List<SeatOperation> ops) {
        SeatMap map = new SeatMap(Venue.small());           // 100 seats
        ops.forEach(op -> op.applyTo(map));                  // holds, confirms, expiries, releases
        assertThat(map.sold() + map.held() + map.available()).isEqualTo(100);
        assertThat(map.soldSeats()).doesNotHaveDuplicates();
    }

    @Provide
    Arbitrary<List<SeatOperation>> operations() {
        return SeatOperation.arbitrary().list().ofMaxSize(200);
    }
}
```

The example uses [jqwik](https://jqwik.net){target="_blank"} for JUnit 5. Models are good at **proposing invariants** from a domain description ("sold + held + available = capacity", "a confirmed seat is never released by expiry") and at writing generators. Two checks keep them honest: plant a bug and confirm the property fails (a property that never fails may be vacuous), and read every invariant against the domain rules.

---

## Load-test scripts from OpenAPI

Every BoxOffice service publishes an OpenAPI document. A model can turn it — plus a sample of real access logs — into a k6 script with realistic endpoints, payloads and checks in seconds. What it cannot know is the **workload model**: the mix of requests (95 % reads of the catalog during an on-sale), the arrival process (open model with a ramp, not a fixed number of looping users), think time, and data distribution (everyone wants the same 500 front-row seats). Those decisions come from the [performance class](../../performance/index.md) and from your measurements, and a generated script that silently uses a closed model with no think time measures the wrong system.

A safe workflow: generate the script, **review the scenario block** (executor, rates, thresholds) by hand, run a smoke test, and keep the script in `load/` like any other code.

---

## Flaky-test triage

A **flaky test** passes and fails on the same code. Flakiness is a large, well-documented problem in industry CI: Google reported that a significant fraction of its tests had shown flaky behaviour, and that flakiness was a major cost of its CI system[^4]. When a build goes red, someone must decide: real regression, broken test, infrastructure problem, or flake?

A model reading the failure log plus history can classify quickly — but the **deterministic signals** should come first, because they are cheap and reliable:

| Signal | Source | Suggests |
|---|---|---|
| Passes on rerun of the same commit | CI rerun | Flaky (or infrastructure) |
| Failure rate of this test over the last 30 days on `main` | Test history store | Flaky if intermittent; regression if it started with a commit |
| Failure only on one runner type / time of day | CI metadata | Infrastructure, resource contention, time-zone bugs |
| Failure in code touched by the PR | Diff vs stack trace | Real regression |
| `Connection refused`, `OOMKilled`, registry timeouts | Log patterns | Infrastructure |

The LLM's job is the part that is hard to do with rules: reading a 2,000-line log, finding the first meaningful error, matching it to the diff, and writing a short explanation with a proposed category. Its output is a **label with evidence**, not an action:

```json
{
  "category": "test-bug",
  "confidence": "medium",
  "evidence": "HoldExpiryTest.expiresAfterTenMinutes uses Instant.now() twice; fails when the clock crosses a second boundary (3 of 412 runs on main in 30 days, no code change).",
  "suggested_action": "Inject a fixed Clock; until then, quarantine with an owner and a ticket."
}
```

!!! warning "Quarantine is a decision with an owner"

    Moving a test to quarantine (still running, not blocking) hides it from everyone. The policy — not the model — decides when a test may be quarantined (for example: failed and passed on the same commit at least twice in a week), every quarantined test gets an owner and a ticket, and quarantine expires. A model that labels a real race condition in seat holds as "flaky" must not be able to silence it.

---

## Test selection

Running all 4,000 tests on every push costs 25 minutes; most of them cannot be affected by a one-line change in `notification`. **Test impact analysis** selects the tests that can be affected:

- **Static**: the build graph (changed module → modules that depend on it → their tests). Exact for module boundaries; coarse inside a module.
- **Coverage-based**: tests whose recorded coverage includes the changed lines. Precise, but needs coverage maps kept up to date.
- **Predictive**: a model trained on history predicts which tests are likely to fail for this change; Meta reported catching the vast majority of failures while running a fraction of the tests[^5]. LLMs can contribute features (what the change is about), but the decision is statistical.

The safety net is non-negotiable: the **full suite** still runs — on `main` after merge, nightly, or before release — so a missed test is caught hours later, not in production. The numbers make the trade-off concrete (illustrative assumptions in the code):

```python exec="1"
# Test selection: CI minutes saved vs regressions that slip to the nightly full run.
FULL_MIN, SELECTED_MIN = 25.0, 4.0       # minutes per run
RUNS_PER_DAY = 60 * 3 / 5                # 60 PRs/week, ~3 pushes each, 5 working days
BREAKING_RATE = 0.04                     # 4 % of pushes break some test (assumption)

print("| Selection recall | CI minutes/day (selected) | Minutes saved/day | Breaks slipping to nightly per week |")
print("|---|---|---|---|")
for recall in (1.00, 0.99, 0.95, 0.90):
    minutes = RUNS_PER_DAY * SELECTED_MIN
    saved = RUNS_PER_DAY * (FULL_MIN - SELECTED_MIN)
    slipped = RUNS_PER_DAY * 5 * BREAKING_RATE * (1 - recall)
    print(f"| {recall:.0%} | {minutes:.0f} | {saved:.0f} | {slipped:.2f} |")
```

At 95 % recall the team saves about twelve runner-hours of CI per day and lets roughly one breaking change every three weeks slip to the nightly run — where it is caught and attributed to a commit. Whether that is acceptable depends on how expensive a red `main` is for the team; for `inventory`, many teams always run the service's full suite.

---

## Synthetic test data

Tests need data: venues with odd seat maps, events across time zones, names with accents, e-mail addresses at the length limit. Models generate rich, realistic **fake** data quickly. Three rules:

1. **Never** send production data (customer names, e-mails, payment details) to a model to "make it realistic". Under Brazil's LGPD and similar laws, that is processing personal data by a third party, with legal obligations — and it is unnecessary.
2. **Freeze the output.** Generate once, review, commit the fixture (or a seeded generator). Tests that call a model at run time are slow, cost money and are non-deterministic.
3. **Ask for the edge cases explicitly**: an event at 23:30 on the day daylight-saving time changes, a venue with 0 seats in a section, a name with 300 characters. Realistic data is less valuable than *adversarial* data.

---

## Trade-offs

| Decision | Choose A when… | Choose B when… |
|---|---|---|
| Generated tests: on every PR vs on demand | Small, fast services; cheap mutation runs | Large services; mutation testing is slow; reviewers are busy |
| Accept generated tests by coverage vs mutation score | Never coverage alone | Always mutation score + human review of assertions |
| Flaky triage: AI labels vs rules only | Many failures, long logs, humans overwhelmed | Small suite; rules already explain most failures |
| Test selection: static vs predictive | Clear module boundaries; correctness first | Huge monorepo; strong history data; nightly safety net |
| Synthetic data: generate at run time vs frozen fixtures | Never at run time in CI | Always frozen and reviewed |

!!! example "BoxOffice: tests where they matter"

    The team runs the test generator on demand for `inventory` and `order`, accepts tests only with a mutation-score gain, and asks reviewers to check every assertion against the hold rules ("10 minutes", "one active hold per seat"). It adds a jqwik property for the seat map (no double booking under any sequence of operations), uses static test selection on PRs with the full suite on `main`, and lets an LLM label red builds with evidence — while quarantine stays a rule with an owner. See [hands-on 13, part 2](../../../hands-on/13/tests/index.md).

!!! tip "In the interview"

    If asked how AI changes testing, separate **generating inputs** (AI is strong) from **deciding correctness** (the oracle — needs requirements and humans). Name mutation testing as the way to judge generated tests, mention flaky-test triage with deterministic signals first and quarantine as a policy decision, and present test selection as a recall-vs-minutes trade-off with a full-suite safety net.

!!! warning "Common pitfalls"

    - **Celebrating coverage** of generated tests: assertion-free tests inflate it.
    - **Letting the generator change production code** to make its tests pass.
    - **Quarantining by model verdict**: real races disappear from view.
    - **Selecting tests with no safety net**: the skipped test was the one that mattered.
    - **Calling a model inside a test**: slow, costly, flaky by construction.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    GEN["AI generates inputs:<br/>unit, property, contract tests"] --> ORA{"the oracle:<br/>who decides correct?"}
    ORA --> REQ["requirements<br/>and humans"]
    GEN --> MUT["mutation testing<br/>judges the tests"]
    GEN --> K6["k6 scripts from OpenAPI<br/>→ Performance"]
    FL["flaky-test triage:<br/>deterministic signals first"] --> QU["quarantine is<br/>a policy decision"]
    SEL["test selection:<br/>recall vs minutes"] --> NET["full-suite<br/>safety net"]
    DATA["synthetic test data"] --> LGPD["no production<br/>personal data"]
```

**Palette components:** [`llmgw`](../../../reference/components/ai/index.md#llmgw) (every generation and triage call) · [`app`](../../../reference/components/compute/index.md#app) (the services under test, with `inventory` as the riskiest) · [`sql`](../../../reference/components/storage/index.md#sql) (the seat-hold rules that properties and contract tests protect) · [`logs`](../../../reference/components/observability/index.md#logs) and [`metrics`](../../../reference/components/observability/index.md#metrics) (failure history and flaky rates that feed the triage). **Scenarios:** `flash-sale` (the load the generated k6 scripts must reproduce). **Continues in:** [Performance](../../performance/index.md) (load tests and budgets), [Performance — load testing](../../performance/load-testing/index.md), [Databases — transactions](../../databases/transactions/index.md) (what "no double booking" means), [Code review](../code-review/index.md), [Hands-on 13 — tests](../../../hands-on/13/tests/index.md).

---

[^1]: BARR, E. T. et al. *The Oracle Problem in Software Testing: A Survey*. IEEE Transactions on Software Engineering, 2015.
[^2]: DEMILLO, R. A.; LIPTON, R. J.; SAYWARD, F. G. *Hints on Test Data Selection: Help for the Practicing Programmer*. IEEE Computer, 1978. See also [PIT](https://pitest.org){target="_blank"}.
[^3]: FOSTER, C. et al. *Mutation-Guided LLM-based Test Generation at Meta*. FSE 2025 (industry track).
[^4]: MICCO, J. [Flaky Tests at Google and How We Mitigate Them](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html){target="_blank"}. Google Testing Blog, 2016.
[^5]: MACHALICA, M. et al. *Predictive Test Selection*. ICSE-SEIP 2019.
