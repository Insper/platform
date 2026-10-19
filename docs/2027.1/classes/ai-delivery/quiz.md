Click **"Answer"** to reveal the correct answer and explanation.

---

## Overview

**Q1.** A team wants an agent to rewrite the `SELECT … FOR UPDATE` logic that prevents double booking in `inventory`, and another to bump a patch version of a logging library in all services. Which autonomy levels are appropriate?

- A. Both autonomous (level 4): CI will catch any problem
- B. Seat locking at most level 2–3 (draft for careful human review); the patch bump can be level 4 if CI and canary are trustworthy
- C. Both level 0: AI must never change code
- D. Seat locking level 4 because it is critical and needs speed; the library bump level 2

??? success "Answer"
    **B.**

    Autonomy should follow the **blast radius** of a mistake and how **verifiable** the change is. Concurrency bugs are hard to test and catastrophic at an on-sale; a patch-level dependency bump is low-risk and well covered by automated checks (Renovate/Dependabot already auto-merge such updates without AI).

---

**Q2.** According to the 2024 DORA report, a 25 % increase in AI adoption was associated with which effect on software delivery?

- A. Higher throughput and higher stability
- B. An estimated 1.5 % decrease in delivery throughput and 7.2 % decrease in delivery stability, despite reported individual productivity gains
- C. No measurable effect on any metric
- D. A 25 % reduction in lead time

??? success "Answer"
    **B.**

    Individuals reported benefits (code quality, documentation, review speed), but delivery throughput and stability went slightly down. The report's authors suggest causes such as larger batches and weaker fundamentals. The lesson: measure outcomes with baselines, not adoption or perception.

---

**Q3.** A review uses an 8,000-token stable prefix, 6,000 tokens of diff and 1,500 output tokens. With the page's illustrative mid-model prices — US$ 2 per million input tokens, US$ 10 per million output tokens, and a 1.25× premium to write the prefix to the prompt cache — what does one review cost with a cold cache?

- A. About US$ 0.005
- B. About US$ 0.047
- C. About US$ 0.47
- D. About US$ 4.70

??? success "Answer"
    **B.**

    Prefix written to the cache: 8,000 × 2 × 1.25 / 10⁶ = US$ 0.020. Diff: 6,000 × 2 / 10⁶ = US$ 0.012. Output: 1,500 × 10 / 10⁶ = US$ 0.015. Total ≈ **US$ 0.047** (0.043 without the cache-write premium; ~0.032 once 80 % of prefixes hit the cache). At 20,000 cold reviews a month that is ~US$ 940 — small next to engineers' time, which is why the attention cost of noisy comments matters more than the token bill.

---

**Q4.** Which part of the "contract of an AI step" determines the **worst case** of a successful prompt injection?

- A. The trigger
- B. The context
- C. The action and the permission it runs with
- D. The output schema

??? success "Answer"
    **C.**

    Whatever the model is persuaded to say, the step can never do more than its credentials and tools allow. A reviewer with `pull-requests: write` that only posts `COMMENT` reviews can, at worst, post a wrong comment. The schema helps, but the permission is the hard limit.

---

## Code review

**Q5.** Your AI reviewer posts 3 comments per PR, and only 4 in 10 are rated useful. What is the most likely consequence, and the best first fix?

- A. Developers read every comment carefully; no fix needed
- B. Developers start ignoring all bot comments, including the useful ones; raise the confidence/severity thresholds, cap comments, and measure precision again
- C. The bot finds too few bugs; lower the thresholds
- D. Make it a required check so developers must address the comments

??? success "Answer"
    **B.**

    A reviewer is judged by its worst comments. With 40 % precision, the rational behaviour is to skip it. Trade some recall for precision (high + medium confidence, minimum severity, a cap, dedup), measure, and only gate narrow categories with proven precision.

---

**Q6.** Why should architecture rules such as "`order` must not access the `inventory` schema" be enforced primarily by deterministic checks, with AI as a complement?

- A. Because models cannot read SQL
- B. Deterministic checks (database grants, ArchUnit, lint) are exact, reproducible and cannot be talked out of a verdict; AI adds explanation and catches fuzzy cases rules cannot express
- C. Because ArchUnit is faster than any model call
- D. Because architecture rules change too often for AI

??? success "Answer"
    **B.**

    Defense in depth: the database role of `order` without grants on `inventory.*` fails the mistake even if every reviewer misses it. The AI reviewer explains *why* and suggests the right fix, and its recurring findings are candidates for new deterministic rules.

---

**Q7.** A 5,000-line PR exceeds the reviewer's diff budget. What should the reviewer do?

- A. Truncate the diff at the budget and review what fits, without saying so
- B. Keep whole files by priority (production code first), review per file or per service and merge the results, and list the files not reviewed
- C. Refuse to review and fail the build
- D. Send the whole repository instead

??? success "Answer"
    **B.**

    Truncating mid-file produces confident comments about code the model never saw. Budgeting whole files, splitting into map/reduce calls, and being explicit about what was not reviewed keeps the review honest — and a 5,000-line PR is itself a finding worth discussing.

---

## Testing

**Q8.** A generated test suite raises line coverage of `HoldService` from 45 % to 95 %, but the mutation score stays at 41 %. What does this tell you?

- A. The tests are excellent; mutation testing is unreliable
- B. The new tests execute the code but do not check its results well enough to notice injected bugs
- C. PIT was misconfigured, because coverage and mutation score always move together
- D. The class has no bugs

??? success "Answer"
    **B.**

    Coverage counts executed lines; mutation score counts changes the tests **detect**. Assertion-weak tests raise coverage and kill no mutants. Feed the surviving mutants back to the generator and review the assertions.

---

**Q9.** A model labels a failing test in seat-hold logic as "flaky" with medium confidence. What should happen?

- A. Quarantine it automatically; the model knows best
- B. Check deterministic signals (rerun on the same commit, failure history, correlation with the diff); quarantine only by policy, with an owner and a ticket
- C. Delete the test
- D. Rerun the full suite until it passes and merge

??? success "Answer"
    **B.**

    Quarantine hides a test from everyone. A real race condition in holds labelled "flaky" could reach production. The model's label is evidence for a human or a rule, not a decision.

---

**Q10.** Predictive test selection runs 15 % of the suite with 95 % recall of failures. What makes this acceptable?

- A. Nothing: any missed failure is unacceptable
- B. A safety net that runs the full suite after merge or nightly, so missed failures are caught and attributed to a commit within hours
- C. The model's confidence score
- D. Running the selected tests twice

??? success "Answer"
    **B.**

    Selection trades CI minutes for a small delay in detecting some failures. The full suite on `main` or nightly bounds that delay. Without it, the skipped test might be the one that mattered.

---

## Agents in CI

**Q11.** A fix-the-build agent with no prompt caching starts with 20,000 tokens of context and adds 2,500 tokens per turn. Roughly how does its **total input tokens** grow with the number of turns *n*?

- A. Constant
- B. Linearly with *n*
- C. Roughly quadratically with *n*, because every turn re-sends the whole growing context
- D. Logarithmically

??? success "Answer"
    **C.**

    Turn *i* sends ≈ 20,000 + 2,500·(*i*−1) tokens; the sum over *n* turns is ≈ 20,000·*n* + 1,250·*n*². Caching the repeated prefix makes it much cheaper per token, but budgets on turns and dollars must still be enforced by the harness.

---

**Q12.** Which design keeps a CI agent safe even if a log line successfully injects instructions into it?

- A. A strong system prompt telling the agent never to follow instructions in logs
- B. The agent job has only a spend-limited model key and a read-only token, tools limited to reading/editing `src/` and running the build; a separate job applies a verified patch as a draft PR that a human must approve
- C. Running the agent on a bigger model
- D. Giving the agent `contents: write` so it can fix things faster

??? success "Answer"
    **B.**

    Prompt instructions are a mitigation; capabilities are the control. With no write token, no secrets, an allow-listed tool surface, independent verification and human approval, a successful injection can at most produce a bad patch that a person rejects.

---

## Release & operate

**Q13.** Why should an LLM not be the judge that promotes or aborts a canary?

- A. LLMs cannot read numbers
- B. The verdict must be reproducible, auditable, statistically sound and immune to manipulation by text in logs or labels; thresholds and statistical tests in Git provide that, and the model explains the verdict
- C. Because Argo Rollouts does not support HTTP calls
- D. Because LLM calls are too expensive for canaries

??? success "Answer"
    **B.**

    Same data must give the same verdict, and a log line saying "promote" must have no effect. The model is valuable after the verdict: explaining it, correlating it with the change, and proposing where to look.

---

## Security & governance

**Q14.** What is the "lethal trifecta" for AI agents?

- A. Cost, latency and accuracy
- B. Access to private data, exposure to untrusted content, and the ability to communicate externally — together they let one injected instruction exfiltrate data
- C. Prompt injection, jailbreaks and hallucinations
- D. SBOM, signing and provenance

??? success "Answer"
    **B.**

    Any one of the three is manageable. Design AI steps so that none has all three: for example, the reviewer reads untrusted PR text but holds no secrets beyond a spend-limited key and can only post comments.

---

**Q15.** An agent adds the dependency `spring-boot-starter-seatlock` to `inventory`. It does not exist on Maven Central today. What is the risk and the control?

- A. No risk: the build will just fail
- B. Slopsquatting: an attacker can publish a malicious package under a hallucinated name; control with dependency review, a registry proxy that quarantines new packages, and a policy that agents may not add dependencies without justification
- C. A licensing risk only
- D. Typosquatting of the model name

??? success "Answer"
    **B.**

    Models repeatedly hallucinate the same plausible package names; once an attacker registers one, the build *succeeds* — with their code. Deterministic controls on new dependencies stop it regardless of how the name got there.

[Back to the class](index.md){ .md-button }
