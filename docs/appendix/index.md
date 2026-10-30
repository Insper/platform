# Appendix

Reference material that every edition of the course relies on. The appendix holds the background that the classes and
labs take for granted: how a request finds a server, how keys protect it, how an API is shaped and versioned, and the
tools that build and ship the code. Read a page when a class or lab assumes it. Each page stands on its own, has
interactive simulators where a concept is easier to see than to read, and ends with its key takeaways.

## One request, end to end

Most of the appendix fits on the path of a single request from a browser to a microservice, and of the code that
serves it. Press play and follow it:

``` diagram-sim
sequenceDiagram
    participant B as Browser
    participant D as DNS resolver
    participant N as Router / NAT
    participant S as Microservice
    B->>D: 1 · api.example.com?
    D-->>B: 203.0.113.10 (cached for the TTL)
    B->>N: 2 · TCP handshake to 203.0.113.10:443
    N->>S: forwarded to a private address, 10.0.1.5:8080
    S-->>B: 3 · TLS: a certificate signed with RSA or Ed25519
    B->>S: 4 · GET /v2/orders (REST) or POST /graphql
    S-->>B: 200 OK + JSON
```

1. **DNS** turns the name into an IP address, cached for a TTL: [DNS](network/dns/index.md).
2. **TCP** opens a connection to a port. The packets cross public routers and reach a private network through NAT:
   [ports, TCP & UDP](network/transport/index.md) and [addressing & NAT](network/addressing/index.md).
3. **TLS** proves the server's identity with public-key signatures and agrees on a symmetric key:
   [RSA & Ed25519](rsa.md).
4. **The API** answers in the style and version that the client asked for:
   [REST vs GraphQL](rest-vs-graphql.md) and [versioning REST APIs](versioning-rest-apis.md).

The code behind the service was built on a [development setup](development-setup.md), versioned with Git (sometimes
across [submodules](git-submodules.md)), and shipped by a [GitHub Actions](gitactions.md) pipeline.

## Sections

<div class="grid cards" markdown>

-   :material-lan:{ .lg .middle } **Networking**

    ---

    How packets travel and how a name becomes a connection. Explore CIDR blocks and a NAT table, see what a lost TCP
    segment costs, and tune a DNS TTL.

    [:octicons-arrow-right-24: Overview](network/index.md) ·
    [Addressing & NAT](network/addressing/index.md) ·
    [Ports, TCP & UDP](network/transport/index.md) ·
    [DNS](network/dns/index.md) ·
    [Quiz](network/quiz.md)

-   :material-key-variant:{ .lg .middle } **Security**

    ---

    Public-key cryptography: build a toy RSA key pair step by step, sign and verify, see why textbook RSA is unsafe,
    and when Ed25519 is the better choice.

    [:octicons-arrow-right-24: RSA & Ed25519](rsa.md)

-   :material-api:{ .lg .middle } **APIs**

    ---

    Count the round trips and bytes that one screen costs with REST and with GraphQL, and evolve an API without
    breaking its clients.

    [:octicons-arrow-right-24: REST vs GraphQL](rest-vs-graphql.md) ·
    [Versioning REST APIs](versioning-rest-apis.md)

-   :material-tools:{ .lg .middle } **Tooling**

    ---

    Prepare your machine, organize repositories, and see what decides how long a CI pipeline takes and what runs
    when a job fails.

    [:octicons-arrow-right-24: Development setup](development-setup.md) ·
    [Oh My Zsh](ohmyzsh.md) ·
    [Git submodules](git-submodules.md) ·
    [GitHub Actions](gitactions.md)

</div>

Beyond the course: [further reading](others.md), a short list of articles, RFCs and projects worth knowing.

!!! tip "How to use the simulators"

    Every simulator has the same controls. **Play** runs it, **→** advances one step, **restart** starts over and
    **1×** changes the speed; with the simulator focused, the space bar plays and the arrow keys step. The
    **Try it** box below each simulator gives a short experiment to run, with the numbers you should see.
