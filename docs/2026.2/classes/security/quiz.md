Click **"Answer"** to reveal the correct answer and explanation.

---

## Fundamentals

**Q1.** A logged-in customer calls `GET /orders/123` and receives an order that belongs to another customer. The gateway validated the token correctly. What is missing?

- A. Authentication — the gateway should have returned `401 Unauthorized`
- B. Authorization at the object level — `order-service` must check that order `123` belongs to the caller's `id-account`
- C. TLS — the response was read by someone in the middle
- D. A longer token expiry

??? success "Answer"
    **B — Object-level authorization in `order-service`.**

    The caller *is* authenticated: the token is valid, so `401` would be wrong. The failure is authorization: only `order-service` knows who owns order `123`, so it must compare the owner with the identity the gateway forwarded and answer `403 Forbidden` (or `404`) otherwise. This is Broken Object Level Authorization, the first item of the OWASP API Security Top 10 (2023).

---

## OAuth 2.0 & OIDC

**Q2.** In OAuth 2.0, which role issues access tokens?

- A. Resource Owner
- B. Client
- C. Authorization Server
- D. Resource Server

??? success "Answer"
    **C — Authorization Server.**

    The Authorization Server authenticates the user, obtains their consent, and issues tokens. The Resource Server validates tokens but never creates them. The Client requests tokens on behalf of the Resource Owner.

---

**Q3.** Why is PKCE (Proof Key for Code Exchange) required for public clients (mobile/SPA apps)?

- A. It encrypts the access token in transit
- B. It prevents authorization code interception attacks — the code alone is useless without the code_verifier that only the legitimate client possesses
- C. It replaces the client_secret for confidential clients
- D. It extends the access token lifetime

??? success "Answer"
    **B — It prevents authorization code interception attacks.**

    Public clients cannot securely store a client_secret. PKCE generates a random `code_verifier`, hashes it to a `code_challenge` (SHA-256, base64url), and sends the challenge with the authorization request. Only the original client can complete the token exchange because only it knows the verifier. PKCE does not replace the secret of a confidential client — current best practice (RFC 9700) recommends PKCE for confidential clients *as well*.

---

**Q4.** What claim in an OIDC ID Token proves which application the token was issued for?

??? success "Answer"
    **`aud` (audience)** — must contain the `client_id` of the receiving application. If a token's `aud` does not match, the client must reject it to prevent token substitution attacks where a token issued for one app is replayed against another. Resource servers apply the same rule to access tokens: reject any token whose `aud` is not their own API.

---

**Q5.** The store's mobile app holds an access token with `exp` 5 minutes from now. What should the **app** do when it expires?

??? success "Answer"
    **Use the refresh_token to request a new access_token from the Authorization Server.** The app should not ask the user to log in again just because an access token expired — that is what refresh tokens are for. The refresh token is long-lived, stored securely by the client, and sent only to the Authorization Server. Only when the refresh token itself is expired or revoked must the user log in again. (A resource server that receives the expired token simply answers `401`; it does not refresh anything.)

---

**Q6.** What is the JWKS endpoint used for?

??? success "Answer"
    **It publishes the Authorization Server's public signing keys** so Resource Servers and the Gateway can validate JWT signatures locally, without calling the auth server on every request. Each key has a `kid`, and each JWT header names the `kid` that signed it. Key rotation is handled by updating the JWKS — services re-fetch on an unknown `kid`, so they always use current keys without redeployment.

---

**Q7.** What is the key difference between an ID Token and an Access Token?

??? success "Answer"
    **ID Token = who the user is (identity). Access Token = what the client is allowed to do (authorization).** The ID Token is consumed by the Client to learn about the user and establish a session; its audience is the client. The Access Token is sent to Resource Servers to authorize API calls; the client should treat it as opaque and never parse it. APIs must not accept ID tokens.

---

**Q8.** A microservice needs to call another microservice with no user involved (background job). Which OAuth 2.0 grant type should it use?

??? success "Answer"
    **Client Credentials grant.** The calling service authenticates with its own credentials (`client_id` and `client_secret`, or a signed assertion) to obtain an access token scoped to what it needs, such as `stock:read`. No user context is involved, making it the correct choice for machine-to-machine communication such as background jobs, scheduled tasks, or inter-service data pipelines.

---

**Q9.** In Hands-on 3, the gateway calls `POST /auth/solve` on every request. A colleague proposes switching to RS256 tokens validated locally at the gateway with a JWKS. Which statement about this change is correct?

- A. Local validation is always strictly better — there is no tradeoff
- B. Local validation removes a network hop and keeps working if `auth-service` is down, but a token can no longer be rejected before its `exp`
- C. Local validation requires copying the HMAC secret to the gateway
- D. Local validation makes logout immediate

??? success "Answer"
    **B — Faster and more available, but revocation waits for `exp`.**

    With asymmetric keys the gateway only needs the **public** key from the JWKS, so no secret is copied (C is wrong) and no call is made per request. The price is revocation: a self-contained JWT stays valid until it expires, so logout is not immediate (D is wrong). That is why locally validated access tokens are kept short-lived and paired with refresh tokens; `/auth/solve` is a form of token introspection, which gives immediate revocation at the cost of a hop per request.

---

## Zero Trust & Secrets

**Q10.** In mTLS, what does the client present that it does NOT present in standard TLS?

??? success "Answer"
    **Its own X.509 certificate** (and a proof that it holds the matching private key). In standard TLS only the server is authenticated to the client. In mTLS both server and client present certificates, so each side knows the other's identity — for example the SPIFFE ID `spiffe://cluster.local/ns/store/sa/order-service`. mTLS only proves *who* is calling; an authorization policy still decides *whether* that caller may call.

---

**Q11.** What does "never trust, always verify" mean in the context of Zero Trust, specifically for internal service calls?

??? success "Answer"
    **Even a call from service A to service B within the same Kubernetes cluster must present a valid identity credential and be authorised against a policy.** Internal network location does not grant trust — every request is treated as potentially hostile. This prevents lateral movement after a breach, where an attacker who has compromised one service cannot freely reach others.

---

**Q12.** You apply a NetworkPolicy that allows only `gateway-service` to reach `order-service`, on a default minikube cluster. From another pod, `curl order-service:8080` still works. What is the most likely cause?

- A. NetworkPolicies only apply to egress traffic
- B. The cluster's network (CNI) plugin does not enforce NetworkPolicy, so the object is accepted but ignored
- C. NetworkPolicies take 24 hours to propagate
- D. Port 8080 is always open in Kubernetes

??? success "Answer"
    **B — The CNI plugin does not enforce NetworkPolicy.**

    The Kubernetes API stores NetworkPolicy objects on any cluster, but enforcement is done by the network plugin. Calico and Cilium enforce policies; the default minikube network does not. Start minikube with `--cni=calico` to see the policy take effect.

---

**Q13.** Why are Kubernetes Secrets NOT considered secure by default?

??? success "Answer"
    **Secrets are stored as base64-encoded strings in etcd, and base64 is not encryption — it can be trivially decoded** (`echo c3RvcmU= | base64 -d` prints `store`). Without etcd encryption at rest and strict RBAC on Secrets, any principal allowed to read Secrets — or to create a pod that mounts them — can read them in plain text. Production systems enable encryption at rest, keep secret manifests out of Git, and often use an external secrets manager such as HashiCorp Vault or AWS Secrets Manager.

---

**Q14.** What is the main security benefit of Vault **dynamic secrets** for `order-service`'s database access?

- A. The database password is longer
- B. Each requester gets a unique, short-lived credential that Vault revokes when its lease expires, so a stolen credential stops working by itself and every use is attributable
- C. The password is stored in a ConfigMap instead of a Secret
- D. The database no longer needs authentication

??? success "Answer"
    **B — Unique, short-lived, automatically revoked credentials.**

    With a static password shared by every replica, a leak is valid until someone notices and rotates it — and rotating breaks everyone. With dynamic secrets, Vault creates a database user per lease (for example, one hour) and drops it at expiry; the audit log shows which workload used which credential.
