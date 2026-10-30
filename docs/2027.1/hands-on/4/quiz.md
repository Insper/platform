Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** Why does BoxOffice sign tokens with **RS256** (asymmetric) instead of **HS256** (shared secret)?

- A. RS256 tokens are smaller
- B. Only `auth` holds the private key; the gateway (and any service) verifies with the public key and can never mint a token
- C. HS256 is not supported by Spring Security
- D. RS256 encrypts the payload

??? success "Answer"
    **B — Separation of signing and verifying.**

    With HS256 the same secret signs and verifies, so every verifier is also a potential forger, and the secret must be distributed everywhere. With RS256 the public key can be published (JWKS) safely.

---

**Q2.** How often does the gateway call `auth` to validate a token?

- A. On every request
- B. Once per user session
- C. It fetches the JWKS (public keys) once and caches it; each token is verified locally, refetching only for an unknown `kid`
- D. Never: the gateway does not validate tokens

??? success "Answer"
    **C — Local verification.**

    That is the whole point of self-contained tokens: no network call per request, so the auth service is not on the hot path. The flip side is revocation — a token stays valid until `exp`.

---

**Q3.** A client sends a request with `X-User-Id: <admin id>` and no token to `/auth/me`. What happens?

- A. `auth` returns the admin's profile
- B. The gateway answers `401`: `/auth/me` requires a token, and in any case the gateway strips client-supplied `X-User-*` headers
- C. The gateway answers `403`
- D. The edge blocks the header

??? success "Answer"
    **B — 401, and the header would be removed anyway.**

    `anyExchange().authenticated()` rejects the request; and `UserHeadersFilter` always deletes incoming `X-User-*` headers before setting its own from a validated token. Without that removal, header spoofing would be trivial.

---

**Q4.** A fan with a valid token (scope `user`) sends `DELETE /catalog/events/2`. The answer is:

- A. 200
- B. 401 Unauthorized
- C. 403 Forbidden
- D. 404 Not Found

??? success "Answer"
    **C — 403.**

    401 means "I do not know who you are" (missing/invalid token); 403 means "I know who you are, and you may not do this" (the rule requires `SCOPE_admin`).

---

**Q5.** Why is `anyExchange().authenticated()` the last rule?

- A. Spring requires it
- B. It is a secure default: any route added later is protected unless someone explicitly opens it
- C. It makes open routes faster
- D. It disables CSRF

??? success "Answer"
    **B — Deny by default.**

    Rules are evaluated in order. Listing what is open and protecting everything else means forgetting a rule fails closed (a 401) instead of open (a data leak).

---

**Q6.** Your login test shows `auth` saturating at ~15 logins/s on 1 CPU while `/auth/me` handles thousands. Why?

- A. The database is slow for logins
- B. BCrypt with cost 10 deliberately spends tens of milliseconds of CPU per password check
- C. JWT signing takes 1 s
- D. Logins use HTTP/1.0

??? success "Answer"
    **B — Password hashing is slow on purpose.**

    The cost factor makes brute-forcing a leaked hash expensive. Consequences for design: issue tokens and reuse them, protect `/auth/login` with a strict rate limit, and scale `auth` for the login peak (before a flash sale opens).

---

**Q7.** `auth` restarts. What happens to tokens issued before the restart, in this lab's implementation?

- A. They keep working
- B. They are rejected: the key pair is generated in memory at startup, so the old `kid` is no longer in the JWKS
- C. They are refreshed automatically
- D. Only admin tokens are rejected

??? success "Answer"
    **B — Lost key, lost tokens.**

    Production systems keep the private key in a KMS/secrets manager, publish both the current and previous keys during rotation, and rotate on a schedule. Two `auth` replicas with in-memory keys would be even worse: each would sign with a different key.

---

**Q8.** What does the gateway check in a JWT besides the signature?

- A. Nothing else
- B. `exp`/`nbf` (time window), `iss` (the expected issuer) and `aud` (the token is meant for this API)
- C. The user's password
- D. The IP address that requested the token

??? success "Answer"
    **B — Time, issuer, audience.**

    A correctly signed token from another issuer, or one minted for another API (audience), must not be accepted. Skipping `aud` checks is a classic vulnerability when one identity provider serves several APIs.

---

**Q9.** Why is identity propagated to services as headers (`X-User-Id`) instead of each service validating the JWT again?

- A. Headers are encrypted
- B. Simplicity and cost: one validation at the gateway; acceptable only while services are reachable exclusively through the gateway (a trusted network) — zero-trust designs re-validate or use mTLS
- C. Services cannot parse JSON
- D. JWTs cannot be forwarded

??? success "Answer"
    **B — A trust boundary trade-off.**

    The pattern is common and cheap, but it rests on network isolation. If an attacker reaches a service directly, they can set any header. Class 12 discusses mTLS, service meshes and forwarding the token itself.

---

**Q10.** Why are there two load balancers in the lab 4 topology (Nginx and the gateway's `lb://`)?

- A. Redundancy: one is a backup of the other
- B. They balance different tiers: the edge balances across gateway replicas, the gateway across service instances — like a public cloud load balancer in front of a gateway fleet calling services through internal load balancing
- C. Spring Cloud Gateway cannot receive traffic directly
- D. Nginx cannot route by path

??? success "Answer"
    **B — One balancer per tier.**

    Each tier scales independently, so each needs its own distribution and health checking. In Kubernetes (lab 10), the Ingress/Gateway API and Services play these two roles.
