Click **"Answer"** to reveal the correct answer and explanation.

---

## Objects and controllers

**Q1.** You run `kubectl delete pod catalog-8685666c5-5bv8t`. A few seconds later a new `catalog` pod exists. Who created it?

- A. `kubectl`, which recreates deleted pods automatically
- B. The ReplicaSet owned by the `catalog` Deployment: its controller saw 1 of 2 desired pods and created another
- C. The HPA
- D. The kubelet of the node where the pod ran

??? success "Answer"
    **B — a controller reconciling desired and actual state.**

    A Deployment manages ReplicaSets, and a ReplicaSet keeps the number of pods matching its selector equal to `replicas`. Deleting a pod changes the actual state; the controller's loop notices and acts. This is the core idea of Kubernetes: declare the desired state, let control loops converge to it.

---

**Q2.** Why is PostgreSQL a **StatefulSet** with a `volumeClaimTemplates` section, while `catalog` is a Deployment?

- A. StatefulSets are faster
- B. The database needs a stable identity (`db-0`) and its own persistent volume that survives pod restarts and rescheduling; `catalog` pods are interchangeable and keep no state
- C. Deployments cannot use environment variables from Secrets
- D. Only StatefulSets can have readiness probes

??? success "Answer"
    **B — stable identity and per-replica storage.**

    Stateless pods can be killed and recreated anywhere: any replica can serve any request. A database's data must outlive its pod, and each replica (primary, replicas) has its own data and name. For production databases, managed services or operators (CloudNativePG, for instance) add backups, failover and upgrades on top.

---

**Q3.** The `secretGenerator` creates `db-credentials-c677754gbf` instead of `db-credentials`. What is the benefit of the hash suffix?

- A. It encrypts the Secret
- B. Changing the content produces a new name, and every reference is rewritten: the pods that use it are rolled out with the new values instead of keeping stale ones
- C. It prevents other namespaces from reading the Secret
- D. It is required by the Kubernetes API

??? success "Answer"
    **B — configuration changes trigger rollouts.**

    Environment variables from a Secret are read only when a container starts. If the Secret changed in place, running pods would keep the old password until some unrelated restart. A new name changes the pod template, which the Deployment rolls out. (Note: a base64-encoded Secret in Git is not secret; real projects use a secrets manager or sealed/encrypted secrets.)

---

## Probes and graceful shutdown

**Q4.** A team puts a database check in `catalog`'s **liveness** probe. During a 20-second database blip, what happens?

- A. Nothing; liveness only matters at startup
- B. Every `catalog` pod fails liveness and Kubernetes restarts all of them, turning a 20-second blip into minutes of outage while JVMs restart
- C. The pods are removed from the Service until the database returns, then added back
- D. The HPA adds pods

??? success "Answer"
    **B — a dependency in liveness causes mass restarts.**

    Liveness means "this process is broken beyond repair, restart it". A database blip is not fixed by restarting `catalog`, and restarting all replicas at once makes things worse. Readiness ("do not send me traffic now") is the right place for conditions that should temporarily remove a pod — and even there, a shared dependency would remove *all* pods; often it is better to stay ready and fail individual requests fast.

---

**Q5.** What does the `startupProbe` (failure threshold 60, period 5 s) protect against?

- A. Slow requests
- B. The liveness probe killing a JVM that is still starting — here the first start also runs Flyway migrations — by disabling the other probes for up to 5 minutes until the app reports it has started
- C. Pods starting on the wrong node
- D. Images that are too large

??? success "Answer"
    **B — slow starts are not failures.**

    Without a startup probe, the liveness probe would start checking immediately and restart the container before it finished starting — a crash loop caused by the probe itself. In this lab the first version (30 × 5 s) was too short on a busy laptop: the pod was killed in the middle of the migrations.

---

**Q6.** During a rolling update, why do `readinessProbe` and a `preStop` sleep of 5 s reduce failed requests?

- A. They make the JVM start faster
- B. Readiness keeps a new pod out of the Service until it can serve; the `preStop` pause keeps an old pod serving while endpoint removal propagates to Traefik and the node proxies, before `SIGTERM` makes it stop accepting connections
- C. They disable the HPA during the rollout
- D. They increase `maxSurge`

??? success "Answer"
    **B — both ends of the pod's life need coordination.**

    Endpoint removal and the termination signal happen in parallel. Without the pause, the JVM can close its listener while routers still send it requests (connection refused). Without readiness, traffic reaches a container that is not listening yet. With `maxUnavailable: 0` as well, capacity never drops during the rollout.

---

## Autoscaling

**Q7.** `catalog` requests `cpu: 250m`. The HPA target is 60%. Two pods use 375m each. How many replicas does the HPA want?

- A. 2
- B. 3
- C. 5
- D. 8

??? success "Answer"
    **C — utilization = 375 / 250 = 150%; desired = ⌈2 × 150 / 60⌉ = 5.**

    Utilization is relative to the **request**, not to the limit or the node. The `scaleUp` policy may cap how fast the HPA gets there (here: at most double, or +2 pods, every 15 s), so 2 → 4 → 5.

---

**Q8.** What does `scaleDown.stabilizationWindowSeconds: 120` do?

- A. Waits 120 s before the first scale-up
- B. Makes the HPA use the highest replica recommendation of the last 120 s when scaling down, so a short dip in load does not remove pods that will be needed again seconds later
- C. Deletes pods 120 s after they become ready
- D. Limits the deployment to 120 pods

??? success "Answer"
    **B — damping to avoid flapping.**

    Load oscillates; without a window, the HPA would scale down at every dip and up again at every peak, paying JVM startup each time. Scale-up has no window here (0 s) because missing capacity costs failed requests, while extra capacity only costs money for two minutes.

---

**Q9.** The flash sale starts at 10:00 sharp. Each new `catalog` pod takes ~40 s to become ready, and the HPA reacts within ~15–30 s. What is the best strategy?

- A. Rely only on the HPA; it is designed for this
- B. Pre-scale before 10:00 (raise `minReplicas` with a scheduled job or by hand), and keep the HPA for the unexpected
- C. Set `maxReplicas` to 1 000
- D. Remove the readiness probe so pods receive traffic sooner

??? success "Answer"
    **B — predictable load is scheduled; unpredictable load is reactive.**

    Reactive autoscaling always lags: detection + decision + startup ≈ a minute or more, during which the existing pods absorb a step change in traffic. For a known event, capacity should be in place before it starts (and the database, which does not autoscale, must be sized for it too).

---

**Q10.** The HPA scaled `catalog` to 8 pods, and now PostgreSQL rejects connections. Why?

- A. The HPA also scales PostgreSQL down
- B. Each pod has its own connection pool (e.g. 10 connections): 8 pods open up to 80 connections, exceeding what one database instance allows or handles well — scaling the stateless tier moved the bottleneck to the stateful one
- C. Traefik limits connections
- D. The PVC is full

??? success "Answer"
    **B — connection fan-in.**

    Horizontal scaling multiplies connections to shared dependencies. Size `max_connections`, reduce per-pod pool sizes, or put a pooler (PgBouncer, lab 6) in between. Always ask "what does each new replica cost the dependencies?"

---

## Ingress

**Q11.** Why did this lab install Traefik instead of ingress-nginx?

- A. ingress-nginx does not support kind
- B. The Kubernetes project retired ingress-nginx in March 2026 (archived, no more fixes); Traefik is a maintained controller that supports both the Ingress API and the Gateway API
- C. Traefik is the only controller that supports `pathType: Prefix`
- D. Ingress resources only work with Traefik

??? success "Answer"
    **B — choose maintained components.**

    An Ingress controller is internet-facing: running one that no longer receives security fixes is a liability. Because `Ingress` is a standard API, switching controllers mostly means changing `ingressClassName`. The Gateway API is the long-term successor, with role separation (Gateway vs routes) and richer routing.

---

**Q12.** `curl localhost/catalog/events/1` returns 200. Which chain carried the request?

- A. localhost:80 → kind node port 30080 (extraPortMappings) → Traefik (NodePort Service) → Ingress rule `/catalog` → Service `catalog` → a ready `catalog` pod
- B. localhost:80 → the `catalog` pod directly
- C. localhost:80 → kube-apiserver → `catalog`
- D. localhost:80 → PostgreSQL → `catalog`

??? success "Answer"
    **A — every hop is a component you configured.**

    `kind.yaml` maps host port 80 to the node's 30080; the Traefik chart exposes its web entry point on that NodePort; Traefik matches the Ingress rule and sends the request to one of the Service's ready endpoints. The API server is never in the data path — it only stores the desired state the controllers read.

[Back to the lab](index.md){ .md-button }
