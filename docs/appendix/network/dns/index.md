
Humans remember names; computers route packets using IP addresses. **DNS** (Domain Name System) is the distributed database that translates one into the other[^1], and nearly every request starts with a DNS lookup. It matters in this course well beyond the browser: Docker Compose services find each other by name through DNS, Kubernetes gives every Service a DNS name, and cloud failover often works by changing a DNS record — which only helps as fast as the caches let it. This page shows how a name is resolved, the record types you will meet, how to inspect them with `dig`, and what the TTL trades off.

---

## How a name is resolved { #resolution }

Nobody holds the whole database. The namespace is a tree — the root, then top-level domains (`.com`, `.br`), then each domain — and each level **delegates** the level below to other servers. Your machine does not walk that tree itself: it asks a **recursive resolver** (your ISP's, your company's, or a public one like `8.8.8.8` or `1.1.1.1`), which walks it on your behalf and caches what it learns.

``` diagram-sim
sequenceDiagram
    participant B as Browser / OS
    participant R as Recursive resolver<br/>(ISP or 8.8.8.8)
    participant Rt as Root server
    participant T as TLD server<br/>(.com)
    participant A as Authoritative server<br/>(example.com)
    Note over B: own cache first: nothing for api.example.com
    B->>R: What is the IP of api.example.com?
    R->>Rt: Who handles .com?
    Rt-->>R: the .com servers (a.gtld-servers.net, …)
    R->>T: Who handles example.com?
    T-->>R: the example.com servers (ns1.example.com, …)
    R->>A: What is the IP of api.example.com?
    A-->>R: A 203.0.113.10, TTL 300 s
    R-->>B: 203.0.113.10 (cached for 300 s)
```

- The **root servers** know only who runs each top-level domain. There are 13 root server identities (`a.root-servers.net` to `m.root-servers.net`), run by 12 organisations and replicated by anycast in more than 2,000 instances around the world[^2].
- The **TLD servers** know who is authoritative for each domain under them.
- The **authoritative servers** of a domain hold its actual records, set by whoever owns the domain.

Every answer comes with a **TTL** (time to live, in seconds), and every resolver along the way caches it for that long — the browser, the operating system, the recursive resolver. The resolver also caches the referrals: the next lookup under `.com` skips the root, and the next one for `example.com` goes straight to its authoritative servers. That is why a typical lookup takes a few milliseconds from cache, and a cold one tens to hundreds. Failed lookups are cached too (*negative caching*), so a name queried before it existed may keep failing for a while[^3].

DNS queries usually travel over UDP port 53 — a single small question and answer, where TCP's handshake would double the cost — and fall back to TCP for large answers ([Ports, TCP & UDP](../transport/index.md)).

---

## Record types { #records }

A domain's zone is a list of records, each with a name, a type, a TTL and a value[^4]:

| Record | Purpose | Example |
|---|---|---|
| **A** | Maps a name to an IPv4 address | `api.example.com → 203.0.113.10` |
| **AAAA** | Maps a name to an IPv6 address | `api.example.com → 2001:db8::10` |
| **CNAME** | Alias pointing to another name | `www.example.com → example.com` |
| **MX** | Mail server for a domain, with a priority | `example.com → 10 mail.example.com` |
| **TXT** | Arbitrary text (SPF, DKIM, ownership verification) | `"v=spf1 include:_spf.google.com ~all"` |
| **NS** | The authoritative servers of a zone (the delegation) | `example.com → ns1.example.com` |
| **PTR** | Reverse lookup: an address back to a name | `10.113.0.203.in-addr.arpa → api.example.com` |

A CNAME cannot sit at the zone apex (`example.com` itself) next to other records, which is why cloud DNS services offer "alias" records for pointing a bare domain at a load balancer.

---

## Looking it up: `dig` { #dig }

`dig` asks a DNS server a question and prints the whole answer. It ships with macOS and most Linux distributions (package `dnsutils` or `bind-utils`):

```bash
dig example.com A                # ask the configured resolver for the A records
dig +short example.com           # only the addresses
dig @1.1.1.1 example.com         # ask a specific resolver
dig +trace example.com           # walk root → .com → example.com yourself
```

The output of the first command has this shape (your addresses, TTL and resolver will differ — the TTL counts down while the answer sits in the resolver's cache):

```text
; <<>> DiG 9.10.6 <<>> example.com A
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 63389
;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1

;; QUESTION SECTION:
;example.com.			IN	A

;; ANSWER SECTION:
example.com.		170	IN	A	104.20.23.154
example.com.		170	IN	A	172.66.147.243

;; Query time: 15 msec
;; SERVER: 172.20.129.131#53(172.20.129.131)
;; WHEN: Fri Oct 30 08:56:42 -03 2026
;; MSG SIZE  rcvd: 72
```

Read it from the top: `status: NOERROR` means the name exists (`NXDOMAIN` would mean it does not); the flags say it is a response (`qr`) and that the server did the recursion for you (`ra`); each line of the **answer section** is one record — name, remaining TTL in seconds, class, type, value. Here the name has two A records, and the client may use either. `SERVER` is the resolver that answered, and `Query time` shows whether it came from cache (a few ms) or not.

---

## The TTL: freshness versus load { #ttl }

The TTL is a promise by the domain owner: "this answer is good for this many seconds". It is also a trade-off with two sides:

- **A long TTL** means resolvers rarely ask again: lookups are fast and the authoritative servers see little traffic. But when the address changes, every resolver that cached the old one keeps handing it out until its copy expires — for up to one TTL.
- **A short TTL** spreads a change quickly, at the cost of more queries to the authoritative servers and more cache misses (slower lookups) for clients.

Each resolver expires its copy on its own clock, so after a change some clients get the new address at once and others only when their resolver's copy runs out.

<div class="csim" data-sim="dns" data-ttl="300"></div>

!!! tip "Try it"
    With a TTL of 300 s, let it run to t = 600 s: of 2,741 client queries, 99.7% are answered from a cache and only 8 reach the authoritative servers. Set the TTL to 30 s and restart: by t = 600 s the authoritative servers get 76 queries and the hit ratio is 97.2%; at 10 s, 204 queries (92.6%). Back at 300 s, restart, pause at t = 120 s and press **change the IP**: the busiest resolver keeps serving the old address, and the last old answer goes out 180 s after the change — 814 answers with the old IP in all, never later than one TTL after the change.

That is why teams **lower the TTL before a planned migration** (a day ahead, so the old long TTL has expired everywhere), switch the address, and raise it again afterwards. And it is why DNS alone makes a slow failover: the TTL is a floor, and some clients cache longer than they should — runtimes such as the JVM keep their own cache.

---

## DNS inside Docker and Kubernetes { #docker-kubernetes }

The same mechanism does service discovery inside the platforms of this course:

- **Docker**: containers on a user-defined network (every Compose project has one) use Docker's embedded DNS server at `127.0.0.11`, which resolves service and container names to their private addresses and forwards everything else to the host's resolvers[^5]. That is why `gateway` reaches the database at `db:5432`. Containers on the default `bridge` network do not get name resolution.
- **Kubernetes**: every Service gets a name of the form `<service>.<namespace>.svc.cluster.local` that resolves to its cluster IP; a pod in the same namespace can use just `<service>`, because its `/etc/resolv.conf` lists the namespace's search domains[^6].

---

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - DNS is a delegated tree: root servers point to TLD servers, which point to each domain's authoritative servers.
    - A recursive resolver walks the tree for you and caches every answer and referral for its TTL.
    - The common records are A/AAAA (addresses), CNAME (alias), MX (mail), TXT (text), NS (delegation) and PTR (reverse).
    - `dig` shows the full answer: status, records, remaining TTL and which resolver answered.
    - The TTL trades load for freshness: a long TTL means few authoritative queries but stale answers for up to one TTL after a change; lower it before a migration.
    - Docker (embedded DNS at `127.0.0.11`) and Kubernetes (`<service>.<namespace>.svc.cluster.local`) use DNS for service discovery.

---

[^1]: [RFC 1034 — Domain Names: Concepts and Facilities](https://datatracker.ietf.org/doc/html/rfc1034){target="_blank"}
[^2]: [Root Servers — root-servers.org](https://root-servers.org/){target="_blank"} (instance count as of October 2026)
[^3]: [RFC 2308 — Negative Caching of DNS Queries](https://datatracker.ietf.org/doc/html/rfc2308){target="_blank"}
[^4]: [RFC 1035 — Domain Names: Implementation and Specification](https://datatracker.ietf.org/doc/html/rfc1035){target="_blank"}
[^5]: [Networking overview — Docker Docs](https://docs.docker.com/engine/network/){target="_blank"}
[^6]: [DNS for Services and Pods — Kubernetes](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/){target="_blank"}
