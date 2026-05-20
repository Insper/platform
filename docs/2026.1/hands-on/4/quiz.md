Click **"Answer"** to reveal the correct answer and explanation.

---

## DevOps / Jenkins CI-CD

**Q1.** What does **Continuous Integration (CI)** specifically solve in a development workflow?

- A. It automatically deploys every commit directly to production
- B. It manages infrastructure provisioning using declarative configuration files
- C. It catches integration bugs early by automatically building and testing on every commit, before changes are merged to the main branch
- D. It enforces code style and formatting rules by failing builds on violations

??? success "Answer"
    **C — Catches integration bugs early.**

    Without CI, developers integrate their changes infrequently. When they do, they discover conflicts and bugs that have accumulated over days or weeks — the longer the delay, the harder the merge. CI forces frequent small integrations and runs automated tests on each one, catching problems when they are cheap to fix.

---

**Q2.** In the Jenkins pipeline, why is Maven called with the `-B` flag (`mvn -B clean install`)?

- A. It enables batch compilation, compiling all modules simultaneously
- B. It enables batch mode — suppressing interactive prompts that would hang an unattended CI job
- C. It enables binary output, producing native executables instead of JARs
- D. It enables background execution, allowing the build to run as a daemon

??? success "Answer"
    **B — Batch mode disables interactive prompts.**

    CI pipelines run unattended with no terminal. Maven's default output includes progress indicators and may prompt for input in certain situations. `-B` (batch mode) disables these, producing machine-friendly output and preventing the build from hanging waiting for input that will never come.

---

**Q3.** What does `docker buildx build --platform linux/amd64,linux/arm64` achieve in the Jenkins pipeline?

- A. It builds two separate images and pushes them with different tags
- B. It creates a multi-platform manifest — a single image tag that resolves to the correct architecture binary on any host
- C. It builds the image twice for redundancy
- D. It enables cross-compilation in Docker, running the build on both platforms simultaneously

??? success "Answer"
    **B — Multi-platform manifest under one tag.**

    Developers often use Apple Silicon Macs (arm64) while production runs on x86 servers (amd64). A multi-platform build creates both binaries and publishes them under a single tag (e.g., `myapp:latest`). Docker automatically selects the correct binary for the host architecture when pulling.

---

**Q4.** Why are Docker Hub credentials stored in **Jenkins Credential Store** rather than directly in the `Jenkinsfile`?

- A. Jenkins cannot read environment variables in a `Jenkinsfile`
- B. Storing credentials in the credential store means they are never written to disk or visible in logs — and the Jenkinsfile (which is committed to the repository) never contains secrets
- C. Docker Hub requires Jenkins-specific authentication tokens
- D. The Jenkinsfile format does not support string interpolation for credentials

??? success "Answer"
    **B — Secrets never written to disk or visible in logs.**

    Jenkins injects credentials at runtime via `withCredentials([usernamePassword(...)])`. The actual token is masked in console output (`****`), never stored in the workspace, and never appears in the Jenkinsfile. Hardcoding credentials in the Jenkinsfile would commit them to the repository — a critical security vulnerability.

---

**Q5.** The Jenkins pipeline has a `Deploy` stage that runs `kubectl apply`. What must be configured in Jenkins for this to work?

- A. The Jenkins master must run inside the target Kubernetes cluster
- B. A kubeconfig file (with cluster credentials and API server URL) must be available to the pipeline — typically mounted or stored as a Jenkins secret
- C. `kubectl` is built into Jenkins and requires no additional configuration
- D. The Kubernetes cluster must have Jenkins installed as a plugin

??? success "Answer"
    **B — kubeconfig with cluster credentials.**

    `kubectl` uses a kubeconfig file to authenticate to the API server. In Jenkins, this is typically stored as a `Secret file` credential and injected into the pipeline with `withCredentials`. The file contains the cluster's CA certificate, the API server URL, and a service account token with sufficient RBAC permissions for the deploy.

---
