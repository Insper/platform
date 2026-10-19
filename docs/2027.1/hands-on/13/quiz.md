Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** Why does `diffutil.py` print each new-side line with its number (`L21 + ...`) before sending the diff to the model?

- A. To reduce the number of tokens in the prompt
- B. Because models are unreliable at computing line numbers from `@@` hunk headers, and GitHub rejects review comments on lines that are not in the diff
- C. Because the Claude API requires line numbers in code blocks
- D. To hide the removed lines from the model

??? success "Answer"
    **B.**

    Counting lines from `@@ -16,4 +16,9 @@` is exactly the kind of bookkeeping a language model gets wrong. Printing the number on each line turns the task into *copying* a number, and the code then accepts only findings that point to a line the PR **added** — which also avoids a `422` from the GitHub API for a comment outside the diff.

---

**Q2.** The reviewer posts its review with `event: COMMENT`. What is the main reason it never sends `APPROVE`?

- A. The `GITHUB_TOKEN` cannot approve pull requests under any setting
- B. Approval is a decision; the bot is advisory, and a prompt injection that convinces the model must not be able to turn into an approval
- C. `APPROVE` reviews cannot carry inline comments
- D. Approvals cost more API calls

??? success "Answer"
    **B.**

    The code decides which review event is sent, not the model. Even if an injected PR description persuades the model that "this PR is pre-approved", there is no path from its JSON to an approval. Humans approve, as required by branch protection.

---

**Q3.** A reviewer run produced 9 findings. Which one is **dropped** by `review.py` with the default settings?

- A. `blocker`, confidence `high`, on an added line
- B. `minor`, confidence `medium`, on an added line
- C. `major`, confidence `high`, on an unchanged context line of the hunk
- D. `major`, confidence `medium`, on an added line

??? success "Answer"
    **C.**

    Only findings on **added** lines are kept: commenting on code the author did not touch is noise (and often not what the PR is about). The defaults also drop `nit` severity, `low` confidence, findings already posted (same fingerprint), and anything beyond `AI_REVIEW_MAX_COMMENTS`.

---

**Q4.** Why is the system prompt (instructions + `CONVENTIONS.md` + ADRs) kept identical across runs and the diff sent in the user message?

- A. The API rejects system prompts longer than the user message
- B. So the stable prefix can be served from the **prompt cache**, billed at a fraction of the input price, while only the per-run data is paid in full
- C. So that the model forgets the conventions after each run
- D. Because the diff must never be shown to the model as a system instruction for formatting reasons only

??? success "Answer"
    **B.**

    Prompt caching is a prefix match: any byte that changes invalidates what follows. Stable content first (instructions, conventions), volatile content last (the diff). In the golden-set run of part 6, most of the system prompt came from the cache after the first call. Putting untrusted text in the user turn also keeps it out of the operator's instructions.

---

**Q5.** The test generator produced a test that compiles and passes twice, with 100 % line coverage of the class. PIT reports the mutation score unchanged (40 % → 40 %). What does the script do, and why?

- A. Accepts it, because 100 % coverage proves the test is useful
- B. Rejects it (and feeds the surviving mutants back to the model), because the test catches no bug the existing tests miss
- C. Accepts it but marks it `@Disabled`
- D. Rejects it because the coverage is too high

??? success "Answer"
    **B.**

    Coverage says which lines **ran**; the mutation score says whether the tests **noticed** when the code was changed. A test with no meaningful assertions reaches full coverage and kills no mutant. The script requires a gain of `MIN_GAIN` (5 percentage points) and sends the list of survivors back so the next attempt targets the untested behaviour.

---

**Q6.** A generated test for `HoldService` passes and kills many mutants. It asserts that a hold expires 8 minutes after creation. The requirement says 10 minutes. What does this illustrate?

- A. Flaky tests
- B. The **oracle problem**: generated tests encode what the code does, including its bugs; mutation testing proves sensitivity, not correctness
- C. A mutation-testing false positive
- D. That PIT is configured with the wrong `targetClasses`

??? success "Answer"
    **B.**

    The model derives the expected value from the implementation. If the implementation is wrong, the test now *protects* the bug. Human review of each assertion against the requirement remains necessary — that is why the generator opens a **draft** PR.

---

**Q7.** In `ai-fix.yaml`, the agent runs in job `fix` (`contents: read`, `actions: read`) and the PR is opened by job `open-pr` (`contents: write`, `pull-requests: write`). Why split them?

- A. GitHub limits each job to one permission
- B. To run them on different operating systems
- C. So the job that executes untrusted code (the PR's build and the model's edits) never holds a write token; the job with write access only applies a verified patch
- D. To make the workflow faster through parallelism

??? success "Answer"
    **C.**

    Least privilege per job. If the agent is confused or injected, or a test exfiltrates the environment, there is no token able to push or approve in that job. `open-pr` runs no model and no build — just `git apply`, commit and `gh pr create`.

---

**Q8.** Which Claude Code flag makes a headless run in CI **deny** any tool call not explicitly allowed, instead of waiting for a human to answer a prompt?

- A. `--bare`
- B. `--permission-mode dontAsk`
- C. `--max-turns 25`
- D. `--output-format stream-json`

??? success "Answer"
    **B.**

    In `dontAsk` mode, anything that would prompt is denied; only `--allowedTools` entries (here `Read,Edit,Write,Bash(mvn -B *)`) and actions that need no approval run. `--bare` skips loading hooks, plugins, MCP servers and `CLAUDE.md` from the repository; `--max-turns` and `--max-budget-usd` bound the loop; `stream-json` produces the audit transcript.

---

**Q9.** The draft PR opened by the fix agent with the `GITHUB_TOKEN` shows no CI run. Why?

- A. Draft PRs never run workflows
- B. Events triggered by the `GITHUB_TOKEN` do not start new workflow runs, a GitHub safeguard against recursive workflows
- C. The `ai-generated` label disables CI
- D. `workflow_run` workflows cannot create branches

??? success "Answer"
    **B.**

    Pushes and PRs created with the repository's `GITHUB_TOKEN` do not trigger `push`/`pull_request` workflows (with few exceptions such as `workflow_dispatch`). A human push (even an empty commit) or a GitHub App token is needed to run CI on the proposal — a useful speed bump: a person looks at it first.

---

**Q10.** The release-notes job drops an item that reads *"order: new refund endpoint (#99)"*. Why?

- A. Refunds are not allowed in release notes
- B. No commit in the tag range references `#99`, so the item is **ungrounded** — likely invented
- C. The `order` service is not part of BoxOffice
- D. The item exceeded the token budget

??? success "Answer"
    **B.**

    Every item must cite at least one SHA or PR number that really appears in `git log previous..tag`. The check is cheap and catches the most dangerous failure — a plausible feature that does not exist. It cannot catch a *wrong summary* of a real commit; that is what the human review of the draft release is for.

---

**Q11.** In part 5, the canary has error rate 2.9 % (stable 0.1 %) and p99 2.28× stable. The model's explanation says `"verdict": "promote"`. What happens?

- A. The rollout is promoted, because the model has more context than the thresholds
- B. The script asks the model again until it says rollback
- C. The policy verdict (rollback, exit code 1) stands, and the explanation is discarded because it contradicts the policy
- D. The analysis becomes inconclusive

??? success "Answer"
    **C.**

    The decision comes from versioned thresholds in code; the model only explains. An explanation that disagrees with the verdict is discarded rather than shown, because a confident wrong explanation next to a correct decision misleads the on-call engineer.

---

**Q12.** Why does `canary_explain.py` return *inconclusive* when the canary serves 0.8 req/s, even though its error rate and p99 look fine?

- A. Because Prometheus cannot compute p99 below 1 req/s
- B. Because with so few requests, a real regression may not have shown up yet: "no errors seen" is not evidence of "no errors"
- C. Because the model needs more tokens
- D. Because Argo Rollouts requires at least 1 req/s

??? success "Answer"
    **B.**

    Rare failures need many requests to become visible (the delivery page computes how many). Declaring a low-traffic canary healthy is a classic false negative; the policy requires a minimum traffic (`MIN_RPS`) before judging.

---

**Q13.** A teammate proposes switching `ai-review.yaml` from `pull_request` to `pull_request_target` "so the reviewer also works on PRs from forks", keeping the checkout of the PR head. What is the risk?

- A. None: `pull_request_target` is the recommended trigger for forks
- B. Higher token cost only
- C. A **pwn request**: the fork's code (including a modified `review.py` or build plugin) runs with the repository's secrets and a write token
- D. The reviewer would review the base branch instead of the PR

??? success "Answer"
    **C.**

    `pull_request_target` runs in the context of the base repository, with secrets and (by default) a write token. Checking out and executing the PR head there hands both to whoever opened the PR. Safe alternatives: keep `pull_request` (no secrets for forks), or split into an unprivileged job that produces the diff as an artifact and a privileged job that only reads that data.

---

**Q14.** Which step is a **script injection**?

- A. `env: { TITLE: ${{ github.event.pull_request.title }} }` and then `python review.py --title "$TITLE"`
- B. Reading the title from `$GITHUB_EVENT_PATH` inside Python
- C. `run: python review.py --title "${{ github.event.pull_request.title }}"`
- D. `gh pr view "$PR" --json title`

??? success "Answer"
    **C.**

    `${{ }}` is substituted into the script text before the shell runs it, so a title containing `"; curl ... $ANTHROPIC_API_KEY ...` becomes code. Passing the value through an environment variable (A) or reading it from the event file (B) keeps it as data.

---

**Q15.** After a week, the reviewer posted 40 comments: 12 👍, 18 👎, 10 unrated. Cost was US$ 0.60 for 25 PRs. What is the best decision?

- A. Turn on gate mode: 40 comments show it is thorough
- B. Precision is 12 / 30 = 40 %: keep it advisory, cut the noise (higher minimum severity, fewer comments, add the false positives to `CONVENTIONS.md` and the golden set), and measure again
- C. Remove it because it costs US$ 0.60
- D. Switch to the cheapest model to lower the cost

??? success "Answer"
    **B.**

    Precision = 👍 / (👍 + 👎) = 12 / 30 = 40 %: most rated comments were not useful, so people will learn to ignore the bot. Gating on it would block good PRs. The token cost (US$ 0.024 per PR) is not the problem — the attention cost of 18 bad comments is. Tune, add the misses to the eval, and measure another week.

[Back to the lab](index.md){ .md-button }
