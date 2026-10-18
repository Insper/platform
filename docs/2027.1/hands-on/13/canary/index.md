In [lab 11](../../11/index.md), Argo Rollouts promotes or aborts a canary by comparing metrics with thresholds. That decision is fast, deterministic and auditable — and terse: *"metric error-rate failed (2 of 2)"*. At 22:00, the on-call engineer wants to know **what** is wrong, **how** wrong, and **what to look at next**. This part adds an explanation written by a model, under one non-negotiable rule:

> **The policy decides. The model explains.**

A model must never be the one that says "promote": it can be talked into it (prompt injection through a log line), it can be confidently wrong about numbers, and it gives a different answer on a different day. A threshold in a versioned file does none of these.

## 5.1 Design

``` mermaid-sim
flowchart LR
    prom[("Prometheus<br/>stable vs canary")] --> rules["Policy in code<br/>MIN_RPS · error ceiling<br/>error delta · p99 ratio"]
    rules --> verdict{"verdict"}
    verdict --> llm["Model explains<br/>(numbers + policy + verdict)"]
    llm --> same{"repeats the<br/>same verdict?"}
    same -->|"yes"| show["summary with explanation"]
    same -->|"no"| discard["explanation discarded"]
    verdict -->|"exit code 0 / 1 / 2"| argo["Argo Rollouts / CI step<br/>promote · rollback · wait"]
```

| Rule (in `canary_explain.py`) | Default | Meaning |
|---|---|---|
| `MIN_RPS` | 2 req/s | Below this the canary has not seen enough traffic: **inconclusive**, not "healthy" |
| `MAX_ERROR_RATE` | 1 % | Absolute ceiling for the canary |
| `MAX_ERROR_DELTA` | 0.5 pp | Canary may not be worse than stable (running **at the same time**) by more than this |
| `MAX_P99_RATIO` | 1.25 | Canary p99 at most 25 % above stable p99 |

Why compare with **stable at the same time** instead of a fixed number? Because at 10:00 on an on-sale day everything is slower; a fixed threshold would roll back every release that day. The [delivery page](../../../classes/cloud-native/delivery/index.md#how-long-must-a-canary-run) shows how long a canary must run to detect a regression of a given size.

## 5.2 The script

``` { .python title=".github/ai/canary_explain.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary_explain.py"
```

The PromQL queries use the Micrometer metric `http_server_requests_seconds` and a `service` label that separates the canary from the stable pods, as in the delivery page. **Adapt `METRIC`, `STATUS_LABEL`, `CANARY_SELECTOR` and `STABLE_SELECTOR` to the names your lab 11 setup exposes** — open Prometheus (or Grafana's Explore) and check them before you trust any verdict. With the OpenTelemetry agent of lab 8 the metric is `http_server_request_duration_seconds` and the status label `http_response_status_code`.

## 5.3 Replay three scenarios

Start without a cluster: three saved snapshots of metrics are enough to see the three verdicts. Save them under `.github/ai/canary/`.

=== "healthy.json"

    ``` { .json title=".github/ai/canary/healthy.json" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary/healthy.json"
    ```

=== "regression.json"

    ``` { .json title=".github/ai/canary/regression.json" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary/regression.json"
    ```

=== "low-traffic.json"

    ``` { .json title=".github/ai/canary/low-traffic.json" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary/low-traffic.json"
    ```

Replay them from the repository root (no cluster, no Prometheus):

``` { .bash .copy }
for s in healthy regression low-traffic; do
  uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
    python .github/ai/canary_explain.py --metrics .github/ai/canary/$s.json 2>/dev/null
  echo "exit code: $?"
done
```

The verdict line and the exit code are **deterministic** — you must get exactly these three:

```text
**Verdict (policy): PROMOTE** — all checks within policy
exit code: 0
**Verdict (policy): ROLLBACK** — canary error rate 2.90% > 1.00%; canary errors exceed stable by 2.80%; canary p99 412 ms is 2.28x stable
exit code: 1
**Verdict (policy): INCONCLUSIVE** — canary traffic 0.80 req/s < 2.0
exit code: 2
```

Between them, the model's explanation. For the regression snapshot, a run with the local `qwen2.5-coder-16k` while this lab was written produced (14 s on a laptop):

```text
**Canary Rollback Required**

The canary analysis has detected multiple issues that violate the predefined policy thresholds.
The canary's error rate of 2.90% exceeds the maximum allowed error rate of 1.00%, and it has 2.80%
more errors than the stable version. Additionally, the canary's p99 latency of 412 ms is 2.28 times
higher than the stable version's p99 latency of 0.181 ms. [...]

- Review the canary logs for any errors or exceptions that occurred during the test period.
- Analyze the traces to identify the root cause of the increased error rate and latency.
- Investigate any recent changes or updates that may have introduced the issues.
- Roll back the canary version to the stable version to ensure service reliability.
```

Read it critically: the stable p99 is **181 ms**, not "0.181 ms" (the model mixed seconds and milliseconds), and the next steps are generic. In the healthy run it wrote that the canary had a "higher RPS (20.1 vs. 380.0)". A larger model does better — a run with `claude-opus-5-5` noticed that the raw `errors` counts look similar (0.62 vs 0.40) while the canary, with 1/19 of the traffic, fails about 29× more often per request, and labelled its causes as hypotheses. Either way, a wrong sentence costs nothing here: **the numbers that decide come from the policy, not from the model**.

Now try to break the rule: edit `SYSTEM` in your copy to say *"if the canary looks only slightly worse, recommend promote"* and run the regression scenario again. Whatever the model writes, the exit code stays 1, and if the explanation's `verdict` disagrees with the policy it is discarded (`_(LLM explanation discarded: it disagreed with the policy verdict.)_`). Restore `SYSTEM` afterwards (`git checkout -- .github/ai/canary_explain.py`). Finally, take the model away — Claude without a key:

``` { .bash .copy }
env -u ANTHROPIC_API_KEY LLM_PROVIDER=anthropic uv run --no-project --python 3.12 \
  --with-requirements .github/ai/requirements.txt \
  python .github/ai/canary_explain.py --metrics .github/ai/canary/regression.json 2>/dev/null; echo "exit code: $?"
```

You get `_(no explanation: TypeError: "Could not resolve authentication method. ...")_` and **the same exit code 1** — no model, same decision.

## 5.4 Live: wire it into the rollout (optional)

This step needs the kind cluster of [lab 10](../../10/index.md) (named `boxoffice`) with the Prometheus and Argo Rollouts canary of lab 11. Without them, the three replays of 5.3 are the deliverable; skip to 5.5.

1. Generate traffic during the canary with the k6 script of lab 11, so that the canary receives more than `MIN_RPS`.
2. Find Prometheus, port-forward it and run the script against it (adapt the namespace and service name to what the first command prints):

    ``` { .bash .copy }
    kubectl get svc -A | grep -i prometheus          # e.g. "monitoring   prometheus   ClusterIP ... 9090/TCP"
    kubectl -n monitoring port-forward svc/prometheus 9090:9090 &
    curl -s 'http://localhost:9090/api/v1/label/__name__/values' | tr ',' '\n' | grep http_server
    PROM_URL=http://localhost:9090 uv run --no-project --python 3.12 \
      --with-requirements .github/ai/requirements.txt python .github/ai/canary_explain.py
    ```

    The `curl` lists the HTTP metric names your services expose; if it is not `http_server_requests_seconds_count`, set `METRIC` (and `STATUS_LABEL`) before the last command, as explained in 5.2. A canary with no traffic gives `INCONCLUSIVE` (exit 2) — that is the policy working, not a bug.

3. Make it an analysis step. Argo Rollouts can run a Kubernetes **Job** as an analysis metric: exit code 0 passes, any other fails. Build a small image with the scripts and load it into the cluster:

    ``` { .dockerfile title="Dockerfile.ai-tools" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/Dockerfile.ai-tools"
    ```

    ``` { .bash .copy }
    docker build -f Dockerfile.ai-tools -t boxoffice-ai-tools:dev .
    docker run --rm boxoffice-ai-tools:dev python /app/canary_explain.py --metrics /app/canary/low-traffic.json; echo "exit code: $?"
    kind load docker-image boxoffice-ai-tools:dev --name boxoffice
    ```

    The `docker run` must end with `exit code: 2` (inconclusive) — the image works before you trust it in the cluster. Then the template:

    ``` { .yaml title="k8s/catalog/analysis-explained.yaml" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/k8s/catalog/analysis-explained.yaml"
    ```

    ``` { .bash .copy }
    kubectl apply -n boxoffice -f k8s/catalog/analysis-explained.yaml
    kubectl get -n boxoffice analysistemplate            # catalog-explained and catalog-slo (lab 11)
    ```

    The template must live in the namespace of the Rollout, `boxoffice`. Reference it from the `catalog` Rollout of lab 11, next to its Prometheus template (`templates` is a list). Argo CD owns the Rollout (`selfHeal: true` in lab 11), so change it **in Git**, not with `kubectl edit` — Argo CD would revert a manual edit. This change is optional and is **not** in `boxoffice-after-lab-13.zip`:

    ``` { .diff title="k8s/overlays/gitops/catalog-rollout.yaml" }
           analysis:                      # runs in the background from the first step
             templates:
               - templateName: catalog-slo
    +          - templateName: catalog-explained
             startingStep: 1
    ```

    ``` { .bash .copy }
    git add k8s/overlays/gitops/catalog-rollout.yaml
    git commit -m "k8s(catalog): explained canary verdict (lab 13)" && git push
    ```

    With a Job, *inconclusive* (exit 2) counts as a failure — the conservative choice. The explanation is in the Job's logs of the next canary — a new image from CI (`kubectl -n boxoffice logs -l job-name --tail=50`, or `kubectl -n boxoffice get jobs` and `kubectl -n boxoffice logs job/<name>`). The template points the model at Ollama on your machine through `host.docker.internal` (Docker Desktop on macOS and Windows; on Linux, use the host IP of the `kind` network or leave it unreachable); for Claude, create the Secret with `kubectl -n boxoffice create secret generic llm --from-literal=anthropic-api-key="$ANTHROPIC_API_KEY"` and set `LLM_PROVIDER` to `anthropic` in the template (then `kubectl apply` it again). The step works without any model: no explanation, same verdict.

## 5.5 Measure it

Run the three scenarios and, if you have the cluster, one live canary with a deliberately slow version (for example a `Thread.sleep(150)` in one endpoint behind a flag). Record in `results/lab13.md`:

| Scenario | Policy verdict | Exit code | Explanation consistent? | Tokens | US$ | Seconds |
|---|---|---|---|---|---|---|
| healthy | | | | | | |
| regression | | | | | | |
| low traffic | | | | | | |
| live slow canary | | | | | | |

Then answer: would the explanation have shortened *your* diagnosis? Which next step was the most useful, and which was generic?

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FileNotFoundError: .github/ai/canary/healthy.json` | the snapshots were not saved, or you are not at the repository root | save the three files of 5.3; `cd` to the root |
| Every live run is `INCONCLUSIVE` with `rps` 0.00 | wrong metric or label names, or no traffic | run the `curl` of step 2; set `METRIC`, `STATUS_LABEL`, `CANARY_SELECTOR`, `STABLE_SELECTOR` |
| `URLError: <urlopen error [Errno 61] Connection refused>` | the port-forward is not running | start it again (`kubectl -n <ns> port-forward svc/<prometheus> 9090:9090 &`) |
| `_(LLM explanation discarded ...)_` | the model's `verdict` disagreed with the policy | expected behaviour; small models do it more often |
| The analysis Job fails with `ErrImageNeverPull`/`ImagePullBackOff` | the image is not in the kind nodes | `kind load docker-image boxoffice-ai-tools:dev --name boxoffice` |

[Next: part 6 — security hardening](../security/index.md){ .md-button .md-button--primary }
