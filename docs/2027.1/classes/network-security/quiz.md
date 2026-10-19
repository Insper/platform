
Click **"Answer"** to reveal the correct answer and explanation.

---

## Threat modeling and the OWASP API Top 10

**Q1.** In a STRIDE session on the BoxOffice checkout, the team notes: *"an attacker posts a fake `payment captured` webhook to our endpoint, and we issue tickets that were never paid."* Which STRIDE category is this, and what is the best control?

- A. Repudiation — keep a longer audit log of webhooks
- B. Spoofing — verify the provider's webhook signature (HMAC) and re-query the payment status before issuing tickets
- C. Denial of service — rate limit the webhook endpoint
- D. Information disclosure — encrypt the webhook body

??? success "Answer"
    **B — Spoofing.**

    The attacker pretends to be the payment provider: a violation of authentication. The control is to authenticate the sender (verify the HMAC signature with the shared webhook secret) and, because the webhook is an external input (OWASP API10, unsafe consumption of APIs), confirm the status by calling the provider's API before acting on it. Rate limiting helps against floods but does not stop a single forged call.

---

**Q2.** A logged-in user changes the URL from `/orders/1042` to `/orders/1043` and sees another customer's order, including name and seat numbers. The gateway validated the JWT correctly. Which OWASP API risk is this, and where must it be fixed?

- A. API2 Broken Authentication — fix it at the gateway by validating `aud`
- B. API8 Security Misconfiguration — fix it with a WAF rule
- C. API1 Broken Object Level Authorization — fix it in the `order` service, which must check that the order belongs to the caller
- D. API4 Unrestricted Resource Consumption — add pagination

??? success "Answer"
    **C — BOLA, fixed in the service that owns the data.**

    Authentication worked: the gateway knows the caller is `acc-42`. What failed is the *object-level* check: only `order` knows the owner of order 1043. That check cannot be centralized at the edge. Return `404` (or `403`) when the order is not the caller's, and write a test "user A requests user B's order".

---

**Q3.** Scalper bots open thousands of seat holds at 10:00 and resell the tickets. Which combination best addresses OWASP API6 (Unrestricted Access to Sensitive Business Flows)?

- A. Encrypting the seat-hold request with TLS 1.3
- B. Moving the inventory database to an isolated subnet
- C. Enabling strict mTLS in the service mesh
- D. Bot detection at the WAF, per-account and per-IP limits on holds, a waiting room, and a short hold TTL

??? success "Answer"
    **D — Protect the business flow itself.**

    The bots use the API exactly as designed; nothing is "broken" technically. The fix is to limit how much of the flow any one actor can consume (per-account/IP limits, purchase caps), detect automation (WAF bot rules, device attestation, CAPTCHA), shape the burst (waiting room) and release unused holds quickly (TTL). TLS, subnets and mTLS protect other layers and do nothing against a legitimate-looking client.

---

## Cloud networking

**Q4.** BoxOffice plans private app subnets of `/24` in each AZ, and Kubernetes gives every pod a VPC IP. How many addresses can pods and nodes actually use in one such AWS subnet?

- A. 256
- B. 254
- C. 251
- D. 65 531

??? success "Answer"
    **C — 251.**

    A `/24` has 2⁸ = 256 addresses, and AWS reserves 5 in every subnet (network address, VPC router, DNS, one for future use, broadcast). 251 addresses shared by nodes and pods run out at the first big autoscaling event — which is why the BoxOffice plan uses `/19` app subnets (8 187 usable addresses each).

---

**Q5.** What makes a subnet **public** in AWS?

- A. Its route table has a route `0.0.0.0/0` to an Internet Gateway
- B. A checkbox "public" on the subnet
- C. Its CIDR is outside the RFC 1918 ranges
- D. It contains a NAT gateway

??? success "Answer"
    **A — The route to the Internet Gateway.**

    "Public" is a consequence of routing: resources with public IPs in that subnet can be reached from and reach the Internet (if security groups allow). Private subnets route `0.0.0.0/0` to a NAT gateway (outbound only); isolated subnets have no default route. The NAT gateway itself *lives* in a public subnet, but that is a consequence, not the definition.

---

**Q6.** The payment provider only accepts calls from allow-listed IPs. BoxOffice runs in three AZs with **one** NAT gateway in AZ a for all private subnets. AZ a goes down. What happens?

- A. Nothing: NAT gateways replicate automatically across AZs
- B. Pods in AZ b and c lose outbound Internet access, so `payment` cannot reach the provider and checkout fails, even though the app is healthy in two AZs
- C. Traffic automatically fails over to the Internet Gateway with the pods' private IPs
- D. Only inbound traffic is affected

??? success "Answer"
    **B — A single NAT is a single point of failure for egress.**

    A NAT gateway lives in one AZ. The resilient design is one NAT per AZ, each private subnet routing to the NAT in its own AZ — and registering all three Elastic IPs with the provider. It costs about three times as much in hourly NAT charges: a deliberate availability × cost trade-off, worth it because egress to the provider is on the checkout's critical path.

---

**Q7.** Which statement about **security groups** and **network ACLs** is correct?

- A. Both are stateless and must allow return traffic explicitly
- B. Security groups apply to subnets; NACLs to network interfaces
- C. Security groups are stateful and can reference other security groups; NACLs are stateless, apply to subnets and support deny rules
- D. NACLs can reference security groups as sources

??? success "Answer"
    **C.**

    A security group automatically allows the reply to an allowed request (stateful) and can say "allow 5432 from `sg-app`", which follows workloads as they scale. A NACL evaluates each packet in both directions (stateless, so ephemeral ports must be opened for replies), works at the subnet level, and supports explicit deny — useful as a coarse guard rail.

---

**Q8.** Each of 30 nodes pulls about 2 GB of images per day through the NAT gateway, plus 50 GB/day of logs shipped to object storage. Assume (illustratively) NAT data processing costs US$ 0.045 per GB. Roughly how much per 30-day month could a gateway endpoint for object storage plus an interface endpoint for the registry remove from the NAT bill (data processing only)?

- A. About US$ 15
- B. About US$ 150
- C. About US$ 1 500
- D. About US$ 15 000

??? success "Answer"
    **B — About US$ 150.**

    Daily: 30 × 2 GB + 50 GB = 110 GB. Monthly: 110 × 30 = 3 300 GB. 3 300 × 0.045 ≈ US$ 148. (Interface endpoints have their own hourly and per-GB fees, smaller than NAT's for this traffic; the S3 gateway endpoint is free.) The structure — per hour + per GB — matters more than the exact price, which changes over time: always check your provider's current pricing.

---

## Service mesh

**Q9.** Istio is installed with mTLS in **STRICT** mode, but no `AuthorizationPolicy` exists. The compromised `search` pod calls `POST /charges` on `payment`. What happens?

- A. The call is accepted: `search` has a valid mesh identity, and without an authorization policy every authenticated workload is allowed
- B. The call is rejected, because mTLS only allows known services
- C. The call is rejected, because STRICT mode blocks all east–west traffic
- D. The call is accepted only if `search` has a JWT

??? success "Answer"
    **A — mTLS authenticates; it does not authorize.**

    STRICT mode guarantees the channel is encrypted and that both sides have valid mesh certificates — `search` has one too. Deciding *who may call what* needs an `AuthorizationPolicy` (e.g. only `sa/order` may `POST /charges`). Once a workload has an `ALLOW` policy, anything not matching it is denied.

---

**Q10.** Which statement best compares **sidecar** and **ambient** service-mesh data planes?

- A. Ambient injects two proxies into every pod instead of one
- B. Sidecar runs in the kernel with eBPF; ambient uses Envoy
- C. They are identical except for the name
- D. Sidecar puts a full L7 proxy in every pod; ambient uses a per-node ztunnel for L4 (mTLS, identity) and deploys L7 waypoint proxies only where needed

??? success "Answer"
    **D.**

    Sidecars give full L7 features everywhere at a cost that grows with the number of pods (memory, CPU, upgrade restarts). Ambient splits the mesh: the ztunnel on each node handles mTLS and L4 policy for all its pods; a waypoint (Envoy) is deployed per namespace or service only when L7 features — HTTP routing, retries, path-based policies — are needed.

---

**Q11.** `order` uses Resilience4j with 3 attempts on calls to `payment`, and the mesh `VirtualService` adds `retries.attempts: 2` (i.e. up to 3 tries per call). During a `payment` slowdown, how many requests can one user click generate on `payment`, and what is the lesson?

- A. 3 — the mesh ignores application retries
- B. 5 — retries add up
- C. 9 — retries multiply across layers; retry in one layer only, and only idempotent operations
- D. 1 — retries are disabled during slowdowns

??? success "Answer"
    **C — 3 × 3 = 9.**

    Each of the 3 application attempts goes through the proxy, which can try up to 3 times. Retries in several layers multiply and create retry storms exactly when the dependency is weakest. Pick one layer, add a retry budget and backoff, and retry non-idempotent calls (`POST /charges`) only with an idempotency key.

---

## Identity

**Q12.** Which OAuth 2.1 flow should the BoxOffice **mobile app** use to log users in?

- A. Resource Owner Password Credentials: the app collects e-mail and password and sends them to `/token`
- B. Implicit: the token comes back in the redirect URL
- C. Client Credentials with a client secret embedded in the app
- D. Authorization Code with PKCE, through the system browser

??? success "Answer"
    **D — Authorization Code + PKCE.**

    The mobile app is a **public client**: anything embedded in it can be extracted, so a client secret protects nothing (C). ROPC (A) and Implicit (B) are removed in OAuth 2.1. With Authorization Code + PKCE the user authenticates in the system browser at the authorization server, the app never sees the password, and the intercepted code is useless without the `code_verifier`.

---

**Q13.** Access tokens live 15 minutes and are validated **locally** at the gateway with the JWKS. A refresh token is revoked at 14:05; the last access token was issued at 13:58. Until when can a thief holding that access token call the API, and how could you shorten the window?

- A. Until 14:05 — revoking the refresh token invalidates the access tokens
- B. Until 14:13 — local validation accepts the token until `exp`; shorten access-token lifetime, or use introspection / a `jti` denylist for sensitive calls
- C. Until 13:58 + 24 h
- D. Forever, until the signing key is rotated

??? success "Answer"
    **B — Until 14:13.**

    13:58 + 15 min = 14:13. A self-contained JWT validated locally cannot be "un-issued": the gateway has no way to know it was revoked. The exposure window is up to one access-token lifetime. Options: shorter tokens (more refreshes), introspection (one call per request, immediate revocation), a denylist of token ids, or sender-constrained tokens (DPoP) so a stolen token alone is useless.

---

## Zero Trust, secrets and supply chain

**Q14.** The payment API key is stored in a Kubernetes Secret created from a manifest committed to the Git repository. Which statement is correct?

- A. It is safe, because Kubernetes Secrets are encrypted with AES
- B. It is safe if the repository is private
- C. Base64 is encoding, not encryption: anyone with repository access (and its whole history) has the key; it must be rotated and moved to a secrets manager (synced e.g. by External Secrets), with access limited to the `payment` service
- D. It is safe, as long as the pod reads it from a file rather than an environment variable

??? success "Answer"
    **C.**

    Anyone can `base64 -d` the value. The Git history keeps it forever, in every clone and fork, so the key must be **rotated** — deleting the file does not help. The source of truth should be a secrets manager or Vault, with IAM restricting reads to the `payment` workload and an audit log; rotation uses two active keys to avoid downtime.

---

**Q15.** The CI pipeline signs every image with cosign, but the cluster has no admission policy that verifies signatures. An attacker with registry push access replaces the `order:1.4.2` tag with a malicious image. What happens?

- A. The malicious image runs: signing protects nothing unless something verifies the signature (and the expected signer) at deploy time; also pin images by digest
- B. The pod fails to start, because cosign signatures are checked by the container runtime
- C. Kubernetes rejects the tag change automatically
- D. The SBOM blocks the image

??? success "Answer"
    **A — Sign *and* verify.**

    Signatures are only useful if an admission controller (Kyverno, Sigstore policy-controller) rejects images that are not signed by the expected identity — here, the release workflow of the course repository. Pinning by digest (`image@sha256:…`) also prevents a moved tag from changing what runs. The SBOM describes contents; it does not block anything by itself.
