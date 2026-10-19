# 2. Image and Supply Chain

Your code is a small part of what runs in production: the image also contains a Linux distribution,
a JRE and around a hundred libraries. **Supply-chain security** asks three questions about every image
before it runs: *what is inside it?* (an SBOM), *does it contain known vulnerabilities?* (a scan),
and *was it really built by our pipeline, from this commit?* (provenance). The `image` job of
`ci.yaml` answers the three, in this order:

``` mermaid-sim
flowchart LR
    build["build (load locally)"] --> sarif["Trivy report -> Security tab"]
    sarif --> gate{"Trivy gate: fixable CRITICAL?"}
    gate -->|yes| fail[job fails, nothing published]
    gate -->|no| sbom["SBOM (Syft, SPDX)"]
    sbom --> push["push to ghcr.io (sha-<commit>, main)"]
    push --> prov["attest provenance (Sigstore)"]
    prov --> attsbom["attest SBOM"]
```

The job is in `.github/workflows/ci.yaml` (shown in full in [step 1](../ci/index.md)); this page
explains its steps.

## Build, then scan, then push

| Step | Action | Notes |
|---|---|---|
| image name | shell | `ghcr.io/<owner>/boxoffice-catalog`, **lowercase** (GHCR rejects uppercase; `${VAR,,}` lowercases in Bash) |
| `docker/setup-buildx-action` (v4.4.1), `docker/login-action` (v4.6.0) | | BuildKit, and a login to GitHub's registry with the job's own `GITHUB_TOKEN` (`packages: write`) |
| `docker/metadata-action` (v6.2.0) | | tags `sha-<full commit sha>` (immutable, what we deploy) and `main` (moving, for humans) |
| build with `load: true` | `docker/build-push-action` (v7.4.0) | the image goes to the runner's Docker, **not** to the registry yet; layers cached in GitHub's cache (`type=gha`) |
| Trivy report | `aquasecurity/trivy-action` | SARIF uploaded to **Security → Code scanning**, never fails |
| Trivy gate | `aquasecurity/trivy-action` | **fails** on a `CRITICAL` vulnerability **that has a fix** (`ignore-unfixed`): something you can act on now |
| SBOM | `anchore/sbom-action` (Syft) | `sbom.spdx.json`: every package and version in the image |
| push | `docker/build-push-action` (v7.4.0) | same layers (cache hit), now pushed with the tags |
| attestations | `actions/attest-build-provenance` (v4.2.2), `actions/attest-sbom` (v4.1.0) | signed statements bound to the image **digest**, stored next to it in GHCR |

Scanning *before* pushing means a vulnerable image is never published. The gate is deliberately
narrow: failing on every `HIGH` without a fix would block all work for problems nobody can solve
today, and teams learn to ignore a gate that is always red. The full report still lists them.

!!! warning "Pin third-party actions to a commit"

    An action is code that runs with your token. A tag like `@v0.36.0` can be moved by whoever
    controls the action's repository — tag hijacking has been used in real supply-chain attacks
    against CI pipelines. Every action in `ci.yaml` and `deploy.yaml` — GitHub's and Docker's
    included — is pinned to a **full commit SHA**, with the version in a comment
    (`actions/checkout@3d3c42e… # v7.0.1`). Dependabot (below) proposes the updates as pull requests,
    and [lab 13](../../13/index.md) checks the pins with `zizmor`.

## Keep dependencies moving

``` yaml title=".github/dependabot.yml"
--8<-- "docs/2027.1/hands-on/11/code/.github/dependabot.yml"
```

Dependabot opens a pull request when a pinned action, a Maven dependency or a base image has a new
version; your CI then tests the upgrade like any other change.

## See it work

After a push to `main`, open **Actions → CI → image (catalog)**. You should see every step green and,
at the end, two attestation links. Then:

- **Packages** (your profile or repository page): `boxoffice-catalog` with the tags `main` and
  `sha-…`. New packages are **private**; for the local cluster of step 4 either make it public
  (package → *Package settings* → *Change visibility*) or create a pull secret (step 4 shows how).
- **Security → Code scanning**: the Trivy findings, one alert per vulnerability.
- Verify the provenance from your machine with the GitHub CLI:

    ``` shell
    gh attestation verify oci://ghcr.io/<your-user>/boxoffice-catalog:main --owner <your-user>
    ```

    You should see `✓ Verification succeeded!` and the workflow, commit and runner that built the
    image. Any change to the image — even one byte — changes its digest and the verification fails.

??? question "What does the SBOM give you on the day a new vulnerability is published?"

    The list of every image that contains the affected library and version — without rebuilding or
    rescanning anything. On the day Log4Shell was disclosed, teams with SBOMs answered "which of our
    services are affected?" in minutes; the others spent days.

[Next: Performance gate](../performance-gate/index.md){ .md-button .md-button--primary }
