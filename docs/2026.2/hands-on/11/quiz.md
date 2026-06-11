Click **"Answer"** to reveal the correct answer and explanation.

---

## AI in CI/CD

**Q1.** Why does the AI review workflow use `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` without the developer having to create this secret manually?

- A. It is fetched from the developer's personal GitHub settings at runtime
- B. GitHub Actions automatically injects `GITHUB_TOKEN` for every workflow run, scoped to the repository and the workflow's declared permissions
- C. It is a global Anthropic-provided token for all GitHub integrations
- D. It must be set manually in the organization's secrets vault before the workflow can run

??? success "Answer"
    **B — `GITHUB_TOKEN` is injected automatically by GitHub Actions for every workflow run.**

    GitHub generates an ephemeral `GITHUB_TOKEN` at the start of each workflow run. Its allowed operations are controlled by the `permissions:` block in the workflow file — in this case `pull-requests: write` and `contents: read`. The token expires when the workflow completes and is never visible outside the run. You only need to create secrets manually for external services, such as `ANTHROPIC_API_KEY`.

---

**Q2.** What does `fetch-depth: 0` in the `actions/checkout` step achieve, and why does the review script need it?

- A. It downloads all repository branches so the script can compare any two refs
- B. It fetches the full git history rather than just the latest commit (the default `fetch-depth: 1`), which is required to compute the diff between the PR branch and its base branch
- C. It enables shallow clones that are faster to download for large repositories
- D. It has no effect on the diff computation — the PyGithub library fetches the diff directly from the GitHub API regardless of local git history

??? success "Answer"
    **B — Full history is needed to resolve the merge base and compute the diff.**

    By default `actions/checkout` clones with `--depth 1`, which gives only the latest commit. Comparing a PR branch against its base requires knowing the common ancestor commit. With `fetch-depth: 0` git has the full history and can identify that ancestor. The `get_pr_diff` function in this hands-on actually uses the GitHub API (via PyGithub) to fetch file patches, so `fetch-depth: 0` matters most if you switch to computing diffs locally with `git diff`.

---

**Q3.** The diff for a large PR has 5 000 changed lines. The `get_pr_diff` function truncates after 3 000 lines. What are two better approaches for handling large diffs without losing coverage?

- A. Increase `max_tokens` to 8 192 and remove the truncation limit — the model will handle everything in one call
- B. Chunk the diff into multiple API calls (one per file or per service boundary), or prioritise the most critical file types (e.g., Java controllers and services) and skip test files and generated code
- C. Split the PR into smaller PRs before opening it — the workflow should reject diffs larger than 3 000 lines
- D. Use a cheaper, faster model for large diffs and reserve `claude-sonnet-4-6` for small focused PRs only

??? success "Answer"
    **B — Chunk into multiple calls, or prioritise critical file types.**

    The 200k token context of Claude Sonnet can technically fit a large diff in one call, but cost scales with token count and latency increases with context length. A smarter approach is to review files in groups (e.g., one API call per microservice) and post separate comments, or to rank files by criticality and skip low-value changes such as auto-generated sources, lock files, and test fixtures. Chunking also lets you provide file-specific context in the system prompt.

---

**Q4.** Why should AI review be non-blocking (comment-only) rather than blocking merges by default?

- A. GitHub does not support required status checks from third-party API calls
- B. AI models produce both false positives (flagging correct code) and false negatives (missing real issues); a false positive that blocks a merge disrupts developer workflow and erodes trust before the team has validated the model's accuracy on their codebase
- C. Blocking requires a paid GitHub plan that is not available to student repositories
- D. Comments are processed faster than status checks, so they appear before the human reviewer arrives

??? success "Answer"
    **B — False positives block merges and erode trust before accuracy is established.**

    LLMs are probabilistic. On codebases they have not been tuned for, they will flag things that are intentional or irrelevant to the project. A blocked merge with a false positive creates friction and trains developers to dismiss AI review output. The safe pattern is: start with comments-only, measure precision and recall on your codebase over several weeks, then selectively apply blocking only to high-confidence checks — typically secrets detection, which has near-zero false positive rate.

---

**Q5.** What GitHub permission must the workflow declare to allow the script to post a PR comment, and where is it declared?

- A. `issues: write` — declared inside the job's `env:` block
- B. `pull-requests: write` — declared in the top-level `permissions:` block of the workflow file, which restricts the `GITHUB_TOKEN`'s allowed operations
- C. `repository: admin` — declared in the organisation's Actions settings page
- D. `contents: write` — declared in the step that calls `ai_review.py`

??? success "Answer"
    **B — `pull-requests: write` in the top-level `permissions:` block.**

    The `permissions:` block in a workflow file scopes the automatically injected `GITHUB_TOKEN`. Without `pull-requests: write`, any call to `pr.create_issue_comment()` fails with HTTP 403. The `contents: read` permission is also required so the checkout step can clone the repository. Declaring only the permissions you need follows the principle of least privilege — the token cannot perform operations beyond what the workflow requires.

---

**Q6.** You want the review to also catch missing OpenAPI annotations (`@Operation`, `@ApiResponse`) on REST controllers. What single change achieves this most effectively?

- A. Add a separate workflow job that uses a static analysis tool such as Spotbugs to scan for missing annotations
- B. Add a line to the `SYSTEM_PROMPT`'s "Focus on:" list: "6. Missing OpenAPI annotations (`@Operation`, `@ApiResponse`) on REST controller methods." The prompt is the primary control surface for what the model notices
- C. Switch to a larger model (`claude-opus-4`) — it has more training data on OpenAPI standards and will detect this automatically
- D. Post-process the model's output with a regex that searches for `@RestController` in the diff and flags any method without `@Operation`

??? success "Answer"
    **B — Add the check to the `SYSTEM_PROMPT`'s "Focus on:" list.**

    The system prompt is the cheapest and most direct way to change review focus. The model has broad knowledge of Spring Boot and OpenAPI; it simply needs explicit instruction to apply that knowledge. A regex post-processor (option D) would be brittle and miss context. A separate static analysis job (option A) is valid but adds infrastructure for something the model can handle in the same call. Switching models (option C) adds cost without addressing the root cause — the missing instruction.

---

**Q7.** What is the cost and latency tradeoff of increasing `max_tokens` from 1 024 to 4 096 in the API call?

- A. `max_tokens` is a hard limit on input size, not output size — increasing it has no effect on cost or latency
- B. Higher `max_tokens` reserves more output budget, which increases the maximum billed output tokens and can increase latency; for PR reviews 1 024 tokens (~750 words) is usually sufficient, and higher limits are only justified for structured JSON output with many fields or very large diffs
- C. Claude charges per request, not per token, so `max_tokens` has no effect on cost
- D. Increasing `max_tokens` reduces latency because the model front-loads more content in a single streaming chunk

??? success "Answer"
    **B — Higher `max_tokens` allows longer output but increases maximum cost and latency.**

    Anthropic bills for output tokens actually generated, up to the `max_tokens` limit. Setting a high `max_tokens` does not guarantee the model uses all of them, but it allows the model to produce longer responses when it chooses. For a PR comment, reviews longer than ~750 words are rarely read carefully — conciseness is a feature. Use higher limits when you need verbose structured output (e.g., generating full JUnit test stubs or a detailed JSON object with many fields).

---

**Q8.** A team wants to auto-generate JUnit 5 test stubs for every new public method added in a PR. How would you modify the existing workflow to achieve this?

- A. Replace the `SYSTEM_PROMPT` with a test-generation prompt and post the tests as a comment — no other changes needed
- B. Parse the diff to extract new public method signatures from Java files, send those signatures to the API with a test-generation system prompt, then either post the generated stubs as a PR comment or open a follow-up branch and PR with the new test files committed
- C. Add a `pytest` step after the AI review step that generates tests using coverage analysis
- D. Use `@SpringBootTest` annotations in the PR description to trigger automatic test scaffolding in the CI runner

??? success "Answer"
    **B — Extract method signatures from the diff, call the API with a test-generation prompt, then commit or comment the stubs.**

    The key change from this hands-on is the system prompt and the post-processing logic. Instead of asking for a review, you ask for JUnit 5 test stubs. The diff parsing step needs to identify new `public` method signatures specifically (not all changed lines). The output can be posted as a comment (fastest to implement) or committed to a branch and opened as a companion PR (more useful, requires `contents: write` and git push steps). Either way, the same GitHub Actions + Claude API skeleton from this hands-on applies directly.
