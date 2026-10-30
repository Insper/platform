# RSA & Ed25519

This page answers one question: **how can two parties that never met trust each other over a public network?** The answer is public-key cryptography, and you use it every time a service in this course talks to another one: HTTPS at the gateway (TLS[^rfc8446]), the JWT that the auth service signs and every other service checks[^rfc7518], the SSH key that opens a server or a Git repository[^rfc4253], the certificates a Kubernetes cluster uses inside. We build RSA from small numbers, see why its textbook form is unsafe, and then meet Ed25519, the modern alternative.

---

## Why public-key cryptography { #why }

With **symmetric** encryption (AES, ChaCha20), the same key encrypts and decrypts. It is fast, but both sides must already share the key, and sending it over the network is exactly what an eavesdropper hopes for. It also does not scale: with one key per pair, `N` parties need `N(N − 1)/2` keys, so 100 microservices would need 4,950 shared secrets.

In 1976 Diffie and Hellman proposed a way out[^dh_paper]: give each party **two** keys, one public and one private, so that what the public key does only the private key can undo. In 1978 Rivest, Shamir and Adleman published the first practical scheme, **RSA**[^rsa][^rsa_paper]. Each party now publishes one key and keeps one secret: `N` parties need `N` key pairs, and nothing secret ever travels.

---

## The key pair { #key-pair }

| Key | Who holds it | What it does |
|---|---|---|
| Public key `(e, n)` | Anyone | Encrypts data *to* the owner; verifies the owner's signatures |
| Private key `(d, n)` | The owner only | Decrypts data sent to the owner; creates signatures |

The two keys are used in two directions, for two different jobs:

``` diagram
flowchart LR
    subgraph enc ["Encryption: anyone → owner"]
        a([sender]) -->|"encrypt with the<br/>owner's PUBLIC key"| c[ciphertext]:::comp
        c -->|"decrypt with the<br/>owner's PRIVATE key"| o([owner])
    end
    subgraph sig ["Signature: owner → anyone"]
        o2([owner]) -->|"sign with the<br/>owner's PRIVATE key"| s[message + signature]:::comp
        s -->|"verify with the<br/>owner's PUBLIC key"| v([anyone])
    end
```

Encryption gives **confidentiality** (only the owner reads it). A signature gives **authenticity and integrity** (only the owner could have produced it, and the message was not changed); it does not hide the message.

---

## The maths, with small numbers { #maths }

RSA rests on **modular arithmetic** and on one asymmetry: multiplying two large primes is fast, but factoring the product back into those primes is infeasible at real key sizes[^factoring]. Key generation takes five steps; the column on the right follows them with toy numbers.

| Step | Rule | Example |
|---|---|---|
| 1. Pick two primes | `p`, `q`, secret | `p = 61`, `q = 53` |
| 2. Modulus | `n = p × q`, public | `n = 3233` |
| 3. Totient | `φ(n) = (p − 1)(q − 1)`, secret | `φ(n) = 60 × 52 = 3120` |
| 4. Public exponent | `1 < e < φ(n)` with `gcd(e, φ(n)) = 1` | `e = 17` |
| 5. Private exponent | `d = e⁻¹ mod φ(n)`, i.e. `e × d ≡ 1 (mod φ(n))` | `d = 2753`, since `17 × 2753 = 46801 = 15 × 3120 + 1` |

Step 5 is the **extended Euclidean algorithm**: divide `φ(n)` by `e`, then the divisor by the remainder, and so on, writing each remainder as a multiple of `e` modulo `φ(n)`. When the remainder reaches 1, its coefficient is `d`. The same divisions check step 4: the last nonzero remainder is `gcd(e, φ(n))`. The simulator shows each division.

A few facts the toy example hides:

- **Real sizes.** `p` and `q` are random primes of about 1024 bits each (a 2048-bit `n`) or more, and `e` is almost always `65537` (`2¹⁶ + 1`, a prime with only two 1 bits, so encryption is fast).
- **λ instead of φ.** The standard (RFC 8017[^rfc8017]) computes `d` modulo `λ(n) = lcm(p − 1, q − 1)`, which gives a smaller `d` that works the same: here `λ(n) = 780` and `d = 413`.
- **The primes are kept, secretly.** The private key file also stores `p`, `q` and a few values derived from them, so that decryption can use the Chinese remainder theorem and run several times faster. Anyone who learns `p` or `q` can recompute `d`, so they are as secret as `d` itself.
- **Why it works.** `(mᵉ)ᵈ = m^(ed) = m^(1 + k·φ(n)) ≡ m (mod n)`, by Euler's theorem[^euler] when `m` shares no factor with `n` (and by the Chinese remainder theorem for every other `m < n`).

<div class="csim" data-sim="rsa" data-p="61" data-q="53" data-e="17"></div>

!!! tip "Try it"
    Keep p = 61, q = 53, e = 17 and press play: n = 3,233, φ(n) = 3,120, and the extended Euclidean algorithm finds d = 2,753 in 4 divisions. Now pick e = 3: gcd(3, 3,120) = 3, so no d exists. Back on e = 17, use the key: encrypt 65 → 2,790 and watch it decrypt back; type HELLO and see both letters L give the same number (L → 2,726). Sign 123 → 2,746, then tamper with the signature. In *dictionary attack*, the attacker finds grade B in 2 tries with only the public key; with random padding the same grade changes ciphertext every time, though this toy pad still leaves only 60 tries. In *factor n*, trial division splits n into 53 × 61 after 27 divisions and recovers d. A 2048-bit n would need about 10³⁰⁸.

---

## Encrypt and decrypt { #encrypt }

A message is first turned into an integer `m` with `0 ≤ m < n`. Then:

- **Encrypt** with the public key: `c = mᵉ mod n`
- **Decrypt** with the private key: `m = cᵈ mod n`

With the key above, `65¹⁷ mod 3233 = 2790` and `2790²⁷⁵³ mod 3233 = 65`.

Nobody computes `2790²⁷⁵³` by multiplying 2,752 times. **Square-and-multiply** reads the exponent in binary: one squaring per bit, plus one multiplication per 1 bit. `17 = 10001₂` takes 4 squarings and 1 multiplication; a 2048-bit `d` takes about 2,048 squarings, not 2²⁰⁴⁸ multiplications. Reducing `mod n` after each step keeps every number below `n²`.

Applying the formula directly, as above, is called **textbook RSA**, and it is unsafe:

- **Deterministic.** The same `m` always gives the same `c`. An attacker who can guess the possible messages ("yes" or "no", a grade from A to F) encrypts each guess with the public key and compares: a **dictionary attack**. Letter by letter, it is a plain substitution cipher.
- **Malleable.** Multiplying a ciphertext by `2ᵉ mod n` doubles the hidden plaintext: in the example, `2790 × 2¹⁷ mod 3233` decrypts to `130 = 2 × 65`. An attacker can change a message they cannot read.
- **Small messages leak.** With `e = 3` and a short message, `m³` can be smaller than `n`: then no reduction happens, and an ordinary cube root recovers `m`.

The fix is **padding** with randomness before the exponentiation, covered [below](#padding).

---

## Digital signatures { #signatures }

The same maths with the keys swapped gives signatures. In practice what is signed is a **hash** of the message, `h = H(m)`: a hash fits below `n`, and signing it is as good as signing the whole message.

- **Sign** with the private key: `s = hᵈ mod n`
- **Verify** with the public key: check that `sᵉ mod n = h`

With the key above, `h = 123` gives `s = 123²⁷⁵³ mod 3233 = 2746`, and `2746¹⁷ mod 3233 = 123`. Change one bit of the message or of `s` and the check fails; producing a valid `s` for another message requires `d`.

This is how a JWT signed with **`RS256`** or **`PS256`** works[^rfc7518]: the auth service signs `header.payload` with its private key, and any service holding the public key verifies the token without being able to issue new ones. The public keys are usually published as a JWK Set (RFC 7517[^rfc7517]) at the URL the identity provider announces as `jwks_uri`.

``` diagram-sim
sequenceDiagram
    participant U as Client
    participant A as auth service
    participant G as API gateway
    U->>A: POST /login (credentials)
    A->>A: sign header.payload with the PRIVATE key (RS256 / PS256)
    A-->>U: JWT = header.payload.signature
    U->>G: GET /orders, Authorization: Bearer JWT
    G->>A: fetch the public keys (jwks_uri), then cache them
    G->>G: verify the signature with the PUBLIC key
    G-->>U: 200 OK, or 401 if the signature does not match
```

| JWT `alg` | Signature scheme | Hash |
|---|---|---|
| `RS256` | RSASSA-PKCS1-v1_5 | SHA-256 |
| `PS256` | RSASSA-PSS | SHA-256, MGF1 with SHA-256 |
| `EdDSA` / `Ed25519` | Ed25519 | SHA-512 (inside the algorithm) |

!!! warning "The verifier picks the algorithm, not the token"

    A verifier that trusts the token's own `alg` header can be fooled: with `alg: none` it skips the check, and with `alg: HS256` it may use the RSA *public* key as an HMAC secret, which the attacker also knows. Configure the expected algorithm and key on the verifying side.

---

## Hybrid encryption { #hybrid }

RSA is not used to encrypt bulk data. Each operation is a full modular exponentiation on 2048-bit numbers, orders of magnitude slower than AES, which modern CPUs run in hardware. And one operation carries very little: with OAEP and SHA-256, a 2048-bit key encrypts at most `256 − 2 × 32 − 2 = 190` bytes (RFC 8017, §7.1.1[^rfc8017]).

So systems combine both kinds of cryptography, a pattern called **hybrid encryption**: a fresh random symmetric key encrypts the data, and the public-key algorithm protects only that small key.

``` diagram
flowchart LR
    doc([document]) --> aes["AES-256-GCM<br/>with key K"]:::comp
    k([random key K]) --> aes
    k --> oaep["RSA-OAEP with the<br/>recipient's public key"]:::comp
    aes --> ct([encrypted document])
    oaep --> wk([K, wrapped])
    ct --> msg["message = wrapped K + encrypted document"]
    wk --> msg
```

The recipient unwraps `K` with the private key and decrypts the document with `K`. JWE (`alg: RSA-OAEP-256`, `enc: A256GCM`)[^rfc7518], OpenPGP[^rfc9580] and the "envelope encryption" of cloud key-management services all work this way.

### How TLS 1.3 uses it { #tls }

TLS 1.2 could do exactly the above: the client encrypted a random secret with the server's RSA key. That mode has a flaw: whoever records the traffic today and steals the server's private key later decrypts every recorded session, because one key protected them all (no **forward secrecy**). TLS 1.3 removed it[^rfc8446]. The handshake still uses both kinds of cryptography, but each for a different job:

- an **ephemeral Diffie–Hellman** exchange (usually X25519) agrees on a fresh secret per connection, never sent over the wire;
- the server's **certificate key** (RSA-PSS, ECDSA or Ed25519) only **signs** the handshake, proving who is on the other side;
- **symmetric** AEAD ciphers (AES-GCM or ChaCha20-Poly1305) encrypt the data.

``` diagram-sim
sequenceDiagram
    participant C as Client
    participant S as Server
    C->>S: ClientHello + key_share (client's ephemeral X25519 public value)
    S->>C: ServerHello + key_share (server's ephemeral X25519 public value)
    Note over C,S: both derive the same secret (ECDHE), then the handshake keys (HKDF)
    S->>C: Certificate (server's public key, signed by a CA)
    S->>C: CertificateVerify: signature over the handshake with the PRIVATE key
    S->>C: Finished (MAC over the handshake)
    C->>S: Finished
    C->>S: HTTP request, encrypted with AES-GCM
    S-->>C: HTTP response, encrypted with AES-GCM
```

---

## Padding: OAEP and PSS { #padding }

Padding fixes textbook RSA by mixing **randomness and structure** into the number before the exponentiation. There are two standard schemes, both in PKCS #1 v2.2 / RFC 8017[^rfc8017], one for each use.

### OAEP — for encryption { #oaep }

OAEP (Optimal Asymmetric Encryption Padding), proposed by Bellare and Rogaway[^oaep_paper], combines the message with a **random seed** through two masks made by MGF1, a mask generation function built on a hash such as SHA-256 (RFC 8017, §7.1.1):

``` diagram
flowchart TD
    L([label, usually empty]) --> LH["lHash = SHA-256(label)"]
    M([message]) --> DB["DB = lHash ‖ zero bytes ‖ 0x01 ‖ message"]
    LH --> DB
    S([random seed]) --> G1["MGF1(seed)"]
    G1 --> X1["maskedDB = DB ⊕ MGF1(seed)"]
    DB --> X1
    X1 --> G2["MGF1(maskedDB)"]
    G2 --> X2["maskedSeed = seed ⊕ MGF1(maskedDB)"]
    S --> X2
    X1 --> EM["EM = 0x00 ‖ maskedSeed ‖ maskedDB"]
    X2 --> EM
    EM --> E["RSA: c = EMᵉ mod n"]:::comp
    E --> C([ciphertext])
```

- **Randomised:** encrypting the same message twice gives different ciphertexts, so the dictionary attack fails. The seed is as long as the hash (32 bytes with SHA-256), far too many values to try.
- **All-or-nothing:** changing any bit of the ciphertext scrambles the whole padded block, and the decryption check rejects it, so malleability is gone.
- **Proven:** RSA-OAEP is secure against chosen-ciphertext attacks (IND-CCA2) in the random-oracle model.

!!! warning "Never use PKCS#1 v1.5 encryption padding"

    The older `PKCS1v15` encryption padding is vulnerable to Bleichenbacher's attack (1998)[^bleichenbacher][^bleichenbacher_paper]: a server that reveals whether a ciphertext was well padded (by an error message, or just by its timing) lets an attacker decrypt with many queries. The attack keeps coming back: in 2017, ROBOT[^robot] found it in the TLS stacks of major vendors. Use OAEP.

### PSS — for signatures { #pss }

PSS (Probabilistic Signature Scheme), also by Bellare and Rogaway[^pss_paper], adds a **random salt** to the message's hash before the private-key operation (RFC 8017, §9.1.1):

``` diagram
flowchart TD
    M([message]) --> MH["mHash = SHA-256(message)"]
    SA([random salt]) --> MP["M' = 8 zero bytes ‖ mHash ‖ salt"]
    MH --> MP
    MP --> H["H = SHA-256(M')"]
    SA --> DB["DB = zero bytes ‖ 0x01 ‖ salt"]
    H --> G["MGF1(H)"]
    G --> X["maskedDB = DB ⊕ MGF1(H)"]
    DB --> X
    X --> EM["EM = maskedDB ‖ H ‖ 0xbc"]
    H --> EM
    EM --> RS["RSA: s = EMᵈ mod n"]:::comp
    RS --> SIG([signature])
```

- **Randomised:** with the salt, signing the same message twice gives different signatures, unlike the deterministic PKCS#1 v1.5 signatures.
- **Proven:** PSS was designed with a tight security proof that reduces forging a signature to breaking RSA itself.
- **In the protocols:** TLS 1.3 accepts RSA handshake signatures only with PSS (v1.5 survives only inside certificates)[^rfc8446]; in JWT, `PS256` is PSS and `RS256` is v1.5. `RS256` has no known practical attack and is the most widely supported, but prefer `PS256` (or Ed25519) for new systems.

---

## Ed25519 { #ed25519 }

Ed25519[^ed25519][^eddsa_paper] is an **elliptic-curve signature algorithm**, standardised in RFC 8032[^rfc8032]. It is not RSA and it does not encrypt, but for signatures it does the same job with much smaller keys, and it is now the preferred choice in many protocols.

### Why elliptic curves { #why-ecc }

RSA's security comes from the difficulty of factoring. Elliptic-curve cryptography (ECC)[^ecc] uses another hard problem, the **elliptic-curve discrete logarithm**: given the points `B` and `A = a · B` on a curve, find `a`[^elliptic_curves]. The best known attacks on it are much slower than those on factoring, so a far smaller key gives the same security. ECDSA[^ecdsa_video], used by Bitcoin and by many TLS certificates, is the older elliptic-curve signature; Ed25519 is its modern successor.

| Algorithm | Key size (bits) | Security strength (bits) |
|---|---|---|
| RSA | 2048 | 112 |
| RSA | 3072 | 128 |
| RSA | 7680 | 192 |
| RSA | 15360 | 256 |
| Ed25519 (or ECDSA P-256) | 256 | ~128 |
| Ed448 | 448 | ~224 |

The RSA and P-256 rows follow NIST SP 800-57[^sp800_57]; the Ed25519 and Ed448 levels are those stated in RFC 8032[^rfc8032]. A 256-bit Ed25519 key matches a 3072-bit RSA key.

### How Ed25519 works { #how-ed25519 }

Ed25519 works on the twisted Edwards curve **edwards25519**, birationally equivalent to Bernstein's Montgomery curve **Curve25519**[^curve25519][^curve25519_paper] (the same curve in other coordinates):

```
-x² + y² = 1 − (121665/121666)·x²·y²  (mod p),   p = 2²⁵⁵ − 19
```

Key generation (RFC 8032, §5.1.5):

1. The private key `k` is 32 random bytes.
2. Hash it: `SHA-512(k)` gives 64 bytes. The first 32 are "clamped" (a few bits fixed) and read as the secret scalar `a`; the last 32 are a `prefix` kept for signing.
3. The public key is the curve point `A = a · B`, where `B` is the curve's fixed base point, encoded in 32 bytes.

Signing a message `m` (§5.1.6):

1. Derive a deterministic nonce `r = SHA-512(prefix ‖ m)`.
2. Compute `R = r · B`.
3. Compute `S = (r + SHA-512(R ‖ A ‖ m) · a) mod ℓ`, where `ℓ` is the order of the base point.
4. The signature is `(R, S)`: 64 bytes.

Verification checks that `S · B = R + SHA-512(R ‖ A ‖ m) · A`. For a deeper treatment, see the IEEE S&P talk on Ed25519 in theory and practice[^eddsa_video].

### Ed25519 compared with RSA { #compare }

| Property | RSA (2048-bit) | Ed25519 |
|---|---|---|
| Public key | 256 bytes (the modulus) | 32 bytes |
| Signature | 256 bytes | 64 bytes |
| Key generation | Slow (search for two large primes) | Fast (32 random bytes and a hash) |
| Signing | Slower (2048-bit exponentiation with `d`) | Fast |
| Verification | Fast (`e = 65537` is small) | Fast |
| Deterministic signatures | v1.5: yes; PSS: no (random salt) | Yes (nonce derived from the key and the message) |
| Encryption | Yes, with OAEP | No: signatures only (X25519 does key agreement) |
| Ways to get it wrong | Padding mode, key size, timing leaks | Few: no padding, designed for constant-time code |

### Determinism, a trade-off { #determinism }

Ed25519 derives its nonce from the private key and the message instead of asking a random-number generator. That removes a whole class of catastrophic bugs: in 2010, Sony's PlayStation 3 signed its firmware with ECDSA using the **same nonce every time**, and two signatures were enough to compute the private key[^ps3]. The price is that a device whose computation can be physically disturbed (a fault injected while it signs the same message twice) can leak its key[^fault]; that matters for smart cards and embedded hardware, not for servers.

### Where Ed25519 is used { #where }

- **SSH:** `ssh-ed25519` keys (RFC 8709[^rfc8709]); since OpenSSH 9.5 (2023), `ssh-keygen` generates Ed25519 keys by default[^openssh95].
- **TLS 1.3:** `ed25519` is one of the handshake signature schemes[^rfc8446], although most public certificates still use RSA or ECDSA.
- **JWT:** `alg: "EdDSA"` with an `OKP` key and `crv: "Ed25519"` (RFC 8037[^rfc8037]); RFC 9864 deprecates the generic `EdDSA` in favour of the explicit `alg: "Ed25519"`[^rfc9864].
- **Git:** commits and tags can be signed with an Ed25519 SSH key (`git config gpg.format ssh`) or an OpenPGP Ed25519 key.
- **X25519**, Ed25519's sibling on the same curve, does key agreement: the TLS 1.3 handshake above, WireGuard, Signal and age.

---

## Which to use { #which }

!!! tip "Which should you use?"

    - **Signatures in new systems** (SSH keys, JWT between your services, Git signing): **Ed25519**. Smaller keys, faster, no padding to misconfigure.
    - **When you need RSA** (a peer or library without Ed25519, encryption to a recipient's key): at least 2048 bits, 3072 for keys that must last, with **PSS** for signatures and **OAEP** for encryption.
    - **Never** textbook RSA, PKCS#1 v1.5 *encryption* padding, or keys of 1024 bits or fewer.
    - **Encrypting data**: hybrid encryption through a library or protocol (TLS, JWE, age, a cloud KMS), never hand-made.

Generating keys:

```bash
ssh-keygen -t ed25519 -C "you@example.com"                                 # SSH key pair
openssl genpkey -algorithm ED25519 -out ed25519.pem                        # Ed25519 private key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out rsa.pem  # RSA private key
openssl pkey -in rsa.pem -pubout -out rsa.pub.pem                          # its public key
```

!!! info "The quantum horizon"

    A large quantum computer running Shor's algorithm would break **both** RSA and elliptic curves. None exists yet, but traffic recorded today could be decrypted later, so the migration has begun: NIST standardised ML-KEM (key establishment, FIPS 203[^fips203]) and ML-DSA (signatures, FIPS 204[^fips204]) in 2024, and its transition plan deprecates RSA and elliptic-curve algorithms after 2030 and disallows them after 2035[^nistir8547]. TLS 1.3 deployments already negotiate hybrid key exchanges that combine X25519 with ML-KEM.

---

## Videos { #videos }

Eddie Woo works through RSA by hand, the same way as the simulator above:

=== "Part 1: computing an example"

    :fontawesome-brands-youtube:{ .youtube } [The RSA Encryption Algorithm (1 of 2: Computing an Example)](https://youtu.be/4zahvcJ9glg){target="_blank"}

=== "Part 2: generating the keys"

    :fontawesome-brands-youtube:{ .youtube } [The RSA Encryption Algorithm (2 of 2: Generating the Keys)](https://youtu.be/oOcTVTpUsPQ){target="_blank"}

---

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Public-key cryptography solves key distribution: each party publishes one key and keeps one secret, and nothing secret travels.
    - RSA keys come from two secret primes: `n = p × q` is public, `d = e⁻¹ mod φ(n)` is found with the extended Euclidean algorithm, and factoring `n` would reveal `d`.
    - The public key encrypts and verifies; the private key decrypts and signs. A JWT signed with `RS256`/`PS256` is checked by every service with the public key.
    - Textbook RSA is deterministic and malleable: use OAEP for encryption and PSS for signatures, never PKCS#1 v1.5 encryption padding.
    - RSA protects keys, not data: hybrid encryption uses it for a small symmetric key, and TLS 1.3 uses public keys only to agree on keys (Diffie–Hellman) and to sign the handshake.
    - Ed25519 gives 128-bit security with 32-byte keys and 64-byte signatures, deterministic nonces and no padding: prefer it for new signatures, and keep an eye on the post-quantum migration.

[^rsa]: [RSA cryptosystem — Wikipedia](https://en.wikipedia.org/wiki/RSA_(cryptosystem)){target="_blank"}
[^euler]: [Euler's theorem — Wikipedia](https://en.wikipedia.org/wiki/Euler%27s_theorem){target="_blank"}
[^bleichenbacher]: [Bleichenbacher's attack — Wikipedia](https://en.wikipedia.org/wiki/Adaptive_chosen-ciphertext_attack#Bleichenbacher's_attack_on_PKCS1_v1.5){target="_blank"}
[^curve25519]: [Curve25519 — Wikipedia](https://en.wikipedia.org/wiki/Curve25519){target="_blank"}
[^ed25519]: [EdDSA / Ed25519 — Wikipedia](https://en.wikipedia.org/wiki/EdDSA){target="_blank"}
[^ecc]: [Elliptic-curve cryptography — Wikipedia](https://en.wikipedia.org/wiki/Elliptic-curve_cryptography){target="_blank"}
[^factoring]: [Integer factorization — Wikipedia](https://en.wikipedia.org/wiki/Integer_factorization){target="_blank"}

[^rsa_paper]: R.L. Rivest, A. Shamir, L. Adleman. "A Method for Obtaining Digital Signatures and Public-Key Cryptosystems." *Communications of the ACM*, 21(2):120–126, 1978. [ACM DL](https://dl.acm.org/doi/10.1145/359340.359342){target="_blank"}
[^dh_paper]: W. Diffie, M.E. Hellman. "New Directions in Cryptography." *IEEE Transactions on Information Theory*, 22(6):644–654, 1976. [PDF](https://ee.stanford.edu/~hellman/publications/24.pdf){target="_blank"}
[^oaep_paper]: M. Bellare, P. Rogaway. "Optimal Asymmetric Encryption." *EUROCRYPT 1994*, LNCS 950, pp. 92–111. [PDF](https://cseweb.ucsd.edu/~mihir/papers/oae.pdf){target="_blank"}
[^pss_paper]: M. Bellare, P. Rogaway. "The Exact Security of Digital Signatures – How to Sign with RSA and Rabin." *EUROCRYPT 1996*, LNCS 1070, pp. 399–416. [PDF](https://cseweb.ucsd.edu/~mihir/papers/pss.pdf){target="_blank"}
[^bleichenbacher_paper]: D. Bleichenbacher. "Chosen Ciphertext Attacks Against Protocols Based on the RSA Encryption Standard PKCS #1." *CRYPTO 1998*, LNCS 1462, pp. 1–12. [PDF](https://archiv.infsec.ethz.ch/education/fs08/secsem/bleichenbacher98.pdf){target="_blank"}
[^robot]: H. Böck, J. Somorovsky, C. Young. "Return Of Bleichenbacher's Oracle Threat (ROBOT)." *USENIX Security 2018*. [robotattack.org](https://robotattack.org/){target="_blank"}
[^curve25519_paper]: D.J. Bernstein. "Curve25519: New Diffie-Hellman Speed Records." *PKC 2006*, LNCS 3958, pp. 207–228. [PDF](https://cr.yp.to/ecdh/curve25519-20060209.pdf){target="_blank"}
[^eddsa_paper]: D.J. Bernstein, N. Duif, T. Lange, P. Schwabe, B.-Y. Yang. "High-Speed High-Security Signatures." *CHES 2011*, LNCS 6917, pp. 124–142. [PDF](https://ed25519.cr.yp.to/ed25519-20110926.pdf){target="_blank"}
[^ps3]: fail0verflow. "Console Hacking 2010: PS3 Epic Fail." 27th Chaos Communication Congress, 2010. [PDF](https://fahrplan.events.ccc.de/congress/2010/Fahrplan/attachments/1780_27c3_console_hacking_2010.pdf){target="_blank"}
[^fault]: Y. Romailler, S. Pelissier. "Practical Fault Attack against the Ed25519 and EdDSA Signature Schemes." *FDTC 2017*, pp. 17–24. [DOI](https://doi.org/10.1109/FDTC.2017.12){target="_blank"}

[^rfc8017]: [RFC 8017 — PKCS #1: RSA Cryptography Specifications v2.2](https://datatracker.ietf.org/doc/html/rfc8017){target="_blank"}
[^rfc8032]: [RFC 8032 — Edwards-Curve Digital Signature Algorithm (EdDSA)](https://datatracker.ietf.org/doc/html/rfc8032){target="_blank"}
[^rfc8037]: [RFC 8037 — CFRG Elliptic Curves for JOSE (OKP key type, Ed25519)](https://datatracker.ietf.org/doc/html/rfc8037){target="_blank"}
[^rfc9864]: [RFC 9864 — Fully-Specified Algorithms for JOSE and COSE](https://datatracker.ietf.org/doc/html/rfc9864){target="_blank"}
[^rfc7517]: [RFC 7517 — JSON Web Key (JWK)](https://datatracker.ietf.org/doc/html/rfc7517){target="_blank"}
[^rfc7518]: [RFC 7518 — JSON Web Algorithms (JWA)](https://datatracker.ietf.org/doc/html/rfc7518){target="_blank"}
[^rfc8446]: [RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3](https://datatracker.ietf.org/doc/html/rfc8446){target="_blank"}
[^rfc4253]: [RFC 4253 — The Secure Shell (SSH) Transport Layer Protocol](https://datatracker.ietf.org/doc/html/rfc4253){target="_blank"}
[^rfc8709]: [RFC 8709 — Ed25519 and Ed448 Public Key Algorithms for the Secure Shell (SSH) Protocol](https://datatracker.ietf.org/doc/html/rfc8709){target="_blank"}
[^rfc9580]: [RFC 9580 — OpenPGP (obsoletes RFC 4880)](https://datatracker.ietf.org/doc/html/rfc9580){target="_blank"}
[^openssh95]: [OpenSSH 9.5 release notes (2023-10-04)](https://www.openssh.org/txt/release-9.5){target="_blank"}
[^sp800_57]: [NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management (Table 2)](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final){target="_blank"}
[^fips203]: [FIPS 203 — Module-Lattice-Based Key-Encapsulation Mechanism Standard (ML-KEM)](https://csrc.nist.gov/pubs/fips/203/final){target="_blank"}
[^fips204]: [FIPS 204 — Module-Lattice-Based Digital Signature Standard (ML-DSA)](https://csrc.nist.gov/pubs/fips/204/final){target="_blank"}
[^nistir8547]: [NIST IR 8547 — Transition to Post-Quantum Cryptography Standards (2026)](https://csrc.nist.gov/pubs/ir/8547/final){target="_blank"}

[^ecdsa_video]: :simple-youtube: [ECDSA Signatures | How does ECDSA work and what are Elliptic Curves?](https://www.youtube.com/watch?v=e3ugVpBBlhc){target="_blank"}
[^eddsa_video]: :simple-youtube: [Ed25519 Signature Schemes: Theory and Practice](https://www.youtube.com/watch?v=9w7ajCIWg-g){target="_blank"}
[^elliptic_curves]: :simple-youtube: [Elliptic Curves - Computerphile](https://www.youtube.com/watch?v=NF1pwjL9-DE){target="_blank"}
