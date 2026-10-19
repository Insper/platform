# 4. GitOps with Argo CD

Until now you deployed with `kubectl apply` from your laptop: whoever has the credentials changes the
cluster, and nothing records what is running. **GitOps** inverts the direction: the desired state
lives in Git, and an agent **inside** the cluster — **Argo CD** — pulls it and keeps the cluster equal
to it, forever. CI never touches the cluster; it only writes to Git. The theory is in the
[delivery class](../../../classes/cloud-native/delivery/index.md).

``` mermaid-sim
flowchart LR
    dev[git push] --> ci[CI: test, scan, image]
    ci -->|image sha-…| ghcr[(ghcr.io)]
    ci -->|success| deploy[Deploy workflow]
    deploy -->|"commit: new tag in k8s/overlays/gitops"| git[(GitHub repo)]
    argo[Argo CD in the cluster] -->|polls every 3 min| git
    argo -->|apply, prune, self-heal| k8s[boxoffice namespace]
    k8s -->|pull image| ghcr
```

## The platform components

Use the kind cluster of [lab 10](../../10/cluster/index.md) (recreate it with step 1 of lab 10 if you
deleted it; Traefik and metrics-server are needed). First remove what lab 10 deployed by hand — from
now on Argo CD owns the namespace:

``` shell
kubectl config use-context kind-boxoffice
kubectl delete namespace boxoffice --wait=true
```

Install Argo CD, Argo Rollouts (step 5 uses it, and the GitOps overlay already contains a `Rollout`)
and the small Prometheus of step 5. The large CRDs need server-side apply:

``` shell
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.5/manifests/install.yaml
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts --server-side \
  -f https://github.com/argoproj/argo-rollouts/releases/download/v1.10.1/install.yaml
kubectl apply -f k8s/monitoring/prometheus.yaml
kubectl -n argocd rollout status deployment/argocd-server --timeout=300s
```

You should see `deployment "argocd-server" successfully rolled out`, and `kubectl get pods -n
argo-rollouts` and `kubectl get pods -n monitoring` should show one running pod each.

Open the Argo CD UI in a second terminal and log in as `admin`:

``` shell
kubectl -n argocd port-forward svc/argocd-server 8443:443          # keep it running
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
```

Browse to `https://localhost:8443` (accept the self-signed certificate) and use that password.

## Access to your repository and images

Your repository and your packages are private, so the cluster needs read-only credentials. Create a
**fine-grained personal access token** on GitHub (*Settings → Developer settings → Fine-grained
tokens*) for your `boxoffice` repository with *Contents: read*, and a **classic token** with
`read:packages` for the images (or make the `boxoffice-catalog` package public and skip the second
secret). Never commit them:

``` shell
export GH_USER=<your GitHub user, lowercase>
export REPO_TOKEN=<the fine-grained token>
export PKG_TOKEN=<the read:packages token>

kubectl -n argocd create secret generic boxoffice-repo \
  --from-literal=type=git \
  --from-literal=url=https://github.com/$GH_USER/boxoffice.git \
  --from-literal=username=$GH_USER --from-literal=password=$REPO_TOKEN
kubectl -n argocd label secret boxoffice-repo argocd.argoproj.io/secret-type=repository

kubectl create namespace boxoffice
kubectl -n boxoffice create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=$GH_USER --docker-password=$PKG_TOKEN
```

## The GitOps overlay

A new overlay, next to lab 10's `local` one: the same base, the image from GHCR, the `Rollout` of
step 5, and a patch that exposes `/actuator/prometheus`.

=== "kustomization.yaml"

    ``` yaml title="k8s/overlays/gitops/kustomization.yaml"
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/kustomization.yaml"
    ```

=== "catalog-services.yaml"

    ``` yaml title="k8s/overlays/gitops/catalog-services.yaml"
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/catalog-services.yaml"
    ```

=== "catalog-rollout.yaml"

    ``` yaml title="k8s/overlays/gitops/catalog-rollout.yaml"
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/catalog-rollout.yaml"
    ```

=== "catalog-analysis.yaml"

    ``` yaml title="k8s/overlays/gitops/catalog-analysis.yaml"
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/catalog-analysis.yaml"
    ```

Replace `your-user` in `newName` with your GitHub user (lowercase) and leave `newTag` as it is: the
`Deploy` workflow writes it after the next successful CI run. `kubectl kustomize k8s/overlays/gitops`
must print the manifests without errors.

## The Deploy workflow

``` yaml title=".github/workflows/deploy.yaml"
--8<-- "docs/2027.1/hands-on/11/code/.github/workflows/deploy.yaml"
```

It runs when `CI` completes on `main`, edits the `images` entry of the overlay with
`kustomize edit set image` (Kustomize is preinstalled on GitHub's Ubuntu runners) and pushes the
commit. A commit pushed with the workflow's `GITHUB_TOKEN` does not start new workflow runs, and `CI`
ignores changes to `k8s/**` anyway, so there is no loop. Because `Deploy` commits to `main`, your local
`main` falls behind after every deploy: from now on run `git pull --rebase` before each `git push`.

!!! info "Branch protection"

    If `main` requires pull requests, the bot cannot push to it. Either allow the GitHub Actions bot
    to bypass the rule, or change the workflow to open a pull request with the new tag (a human — or
    a policy — approves each deployment).

## The Application

``` yaml title="k8s/argocd/application.yaml"
--8<-- "docs/2027.1/hands-on/11/code/k8s/argocd/application.yaml"
```

Replace `your-user` in `repoURL`, commit and push everything, then register the Application (the only
`kubectl apply` of the flow — from now on Argo CD applies):

``` shell
git add .github k8s && git commit -m "lab 11: gitops" && git push
kubectl apply -f k8s/argocd/application.yaml
kubectl -n argocd get applications -w
```

Until the first `Deploy` commit lands, `catalog` cannot start (`newTag` is still the placeholder) and
the Application shows `Degraded` — expected. When the push triggers `CI` and then `Deploy`, Argo CD
picks up the new commit (it polls every 3
minutes; **Refresh** in the UI forces it). You should see the Application go to `Synced` and
`Healthy`, the tree of resources in the UI (Namespace, StatefulSet `db`, Deployment `redis`, Rollout
`catalog` with its pods…), and `curl localhost/catalog/events/1` answering `200` through Traefik.

## Drift and self-healing

Change the cluster by hand and watch Argo CD undo it:

``` shell
kubectl -n boxoffice scale deployment redis --replicas=0
kubectl -n boxoffice get deployment redis -w
```

Within seconds Argo CD reports `OutOfSync` and, with `selfHeal: true`, restores 1 replica: the cluster
can only be changed through Git. To roll back a release, you `git revert` the deploy commit.

[Next: Canary with Argo Rollouts](../canary/index.md){ .md-button .md-button--primary }
