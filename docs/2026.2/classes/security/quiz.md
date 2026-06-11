Click **"Answer"** to reveal the correct answer and explanation.

---

## OAuth 2.0 & OIDC

**Q1.** In OAuth 2.0, which role issues access tokens?

- A. Resource Owner
- B. Client
- C. Authorization Server
- D. Resource Server

??? success "Answer"
    **C — Authorization Server.**

    The Authorization Server authenticates the user, obtains their consent, and issues tokens. The Resource Server validates tokens but never creates them. The Client requests tokens on behalf of the Resource Owner.

---

**Q2.** Why is PKCE (Proof Key for Code Exchange) required for public clients (mobile/SPA apps)?

- A. It encrypts the access token in transit
- B. It prevents authorization code interception attacks — the code alone is useless without the code_verifier that only the legitimate client possesses
- C. It replaces the client_secret for confidential clients
- D. It extends the access token lifetime

??? success "Answer"
    **B — It prevents authorization code interception attacks.**

    Public clients cannot securely store a client_secret. PKCE generates a random code_verifier, hashes it to a code_challenge, and sends the challenge with the authorization request. Only the original client can complete the token exchange because only it knows the verifier.

---

**Q3.** What claim in an OIDC ID Token proves which application the token was issued for?

??? success "Answer"
    **`aud` (audience)** — must match the client_id of the receiving application. If a token's `aud` does not match, the client must reject it to prevent token substitution attacks where a token issued for one app is replayed against another.

---

**Q4.** You receive an access token with `exp` 5 minutes from now. What should your service do when it expires?

??? success "Answer"
    **Use the refresh_token to request a new access_token from the Authorization Server.** The client should never ask the user to log in again just because an access token expired — that is what refresh tokens are for. The refresh token is long-lived and stored securely by the client, used solely for this silent renewal.

---

**Q5.** What is the JWKS endpoint used for?

??? success "Answer"
    **It publishes the Authorization Server's public signing keys** so Resource Servers and the Gateway can validate JWT signatures without calling the auth server on every request. Key rotation is handled by updating the JWKS — services re-fetch on a cache miss, ensuring they always use current keys without requiring redeployment.

---

**Q6.** What is the key difference between an ID Token and an Access Token?

??? success "Answer"
    **ID Token = who the user is (identity). Access Token = what the client is allowed to do (authorization).** The ID Token is consumed by the Client to display user information and establish a session. The Access Token is sent to Resource Servers to authorize API calls and is opaque to the end user.

---

**Q7.** In mTLS, what does the client present that it does NOT present in standard TLS?

??? success "Answer"
    **Its own X.509 certificate.** In standard TLS only the server is authenticated to the client. In mTLS both server and client present certificates, creating mutual identity verification and ensuring that even if a valid access token is stolen, it cannot be replayed from an unknown workload.

---

**Q8.** What does "never trust, always verify" mean in the context of Zero Trust, specifically for internal service calls?

??? success "Answer"
    **Even a call from service A to service B within the same Kubernetes cluster must present a valid identity credential and be authorised against a policy.** Internal network location does not grant trust — every request is treated as potentially hostile. This prevents lateral movement after a breach, where an attacker who has compromised one service cannot freely reach others.

---

**Q9.** Why are Kubernetes Secrets NOT considered secure by default?

??? success "Answer"
    **Secrets are stored as base64-encoded strings in etcd, and base64 is not encryption — it can be trivially decoded.** Without etcd encryption at rest and strict RBAC on the Secret resource, any principal with `kubectl get secret` access can read all secrets in plain text. Production systems should use envelope encryption or an external secrets manager such as HashiCorp Vault or AWS Secrets Manager.

---

**Q10.** A microservice needs to call another microservice with no user involved (background job). Which OAuth 2.0 grant type should it use?

??? success "Answer"
    **Client Credentials grant.** The calling service authenticates with its own `client_id` and `client_secret` to obtain an access_token scoped to the specific downstream service. No user context is involved, making it the correct choice for machine-to-machine communication such as background jobs, scheduled tasks, or inter-service data pipelines.
