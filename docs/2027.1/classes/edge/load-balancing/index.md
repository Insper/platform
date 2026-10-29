One `inventory` replica handles, say, 800 holds per second before its latency climbs (an illustrative number — in [hands-on 2](../../../hands-on/2/index.md) you measure the real one for `catalog`). The stadium sale needs 5 000. The answer is obvious — run seven or eight replicas — but it immediately raises the questions this page answers: **who decides which replica gets each request? What happens when one replica dies, or is slow, or is being redeployed? And what if the request needs to land on a specific replica?**

A **load balancer** (LB) is the component that spreads work across a pool of interchangeable servers — the **backends**, **targets** or **upstreams** — so that the pool behaves like a single, larger and more reliable server[^1]. It is the `lb` component of the palette, and, in Kubernetes, the `ingress` component plays the same role for HTTP traffic entering the cluster.

---

## Why load balance? { #why }

A load balancer gives you three things at once:

- **Scalability**: add replicas to handle more traffic (*horizontal scaling*, or *scale-out*), instead of buying a bigger machine (*vertical scaling*, or *scale-up*).
- **Availability**: when a replica fails its health checks, the LB stops sending it traffic; users do not notice.
- **Operability**: you can drain, replace and upgrade replicas one at a time (rolling deploys), with no downtime.

This only works if the replicas are **interchangeable** — any one of them can serve any request. That is why application servers should be **stateless**: session data, carts and seat holds live in a shared store (Redis, PostgreSQL), not in the memory of one replica. Statelessness is the precondition for everything on this page.

``` diagram-sim
flowchart LR
    f([Fans]) --> lb{{Load balancer}}
    lb --> a1[inventory-1]
    lb --> a2[inventory-2]
    lb --> a3[inventory-3]
    lb -.->|"health check fails: skipped"| a4["inventory-4 ✗"]
    a1 --> db[(PostgreSQL)]
    a2 --> db
    a3 --> db
```

---

## L4 versus L7 { #l4-l7 }

Load balancers differ in **how much of the traffic they understand**.

A **layer-4 (L4)** load balancer works with TCP connections or UDP datagrams. It sees IP addresses and ports, picks a backend when a connection opens, and forwards the bytes of that connection to it. It does not read HTTP: it cannot route by path, it cannot see that one connection carries 1 000 requests, and it does not need to decrypt TLS.

A **layer-7 (L7)** load balancer speaks HTTP. It terminates the client's connection, reads each **request** (method, path, headers, cookies), picks a backend per request, and opens (or reuses) its own connection to it. It is a full reverse proxy.

| | L4 (transport) | L7 (application) |
|---|---|---|
| Unit of balancing | connection (or packet flow) | request |
| Sees | IPs, ports, TCP/UDP | method, path, host, headers, cookies, body |
| TLS | usually passes through encrypted | usually terminates (decrypts) |
| Routing by path or host | no | yes: `/api/holds → inventory`, `/api/orders → order` |
| Retries, header rewrites, caching, compression | no | yes |
| Performance | very high (millions of connections, microseconds) | high, but more CPU per request |
| Long-lived connections (gRPC, HTTP/2, WebSockets) | balanced once, at connect time | can balance each request/stream |
| Examples | AWS NLB, GCP passthrough Network LB, Azure Load Balancer, Linux IPVS, HAProxy in TCP mode | AWS ALB, GCP Application LB, Azure Application Gateway, Nginx, HAProxy, Envoy, Traefik |

A common production layout uses **both**: an L4 load balancer (or anycast) at the front for raw capacity and DDoS resilience, spreading connections over a fleet of L7 proxies (Envoy, Nginx) that do TLS, routing and per-request balancing. This is how Google's and Cloudflare's front ends are built.

??? question "Think first: the `order` service calls `inventory` over gRPC through an L4 load balancer. There are 4 `inventory` replicas, but one of them receives almost all the traffic. Why?"
    gRPC runs over HTTP/2, which multiplexes many requests over **one long-lived TCP connection**. An L4 load balancer chooses a backend once per connection, so if `order` opened one connection (or a few) and keeps it for hours, all its requests go to the same replica. Fixes: an L7 load balancer that balances per request (Envoy, a service mesh), client-side load balancing in the gRPC library, or limiting connection age (`max_connection_age`) so clients reconnect periodically. More in [Protocols](../protocols/index.md).

---

## Balancing algorithms { #algorithms }

Once the LB has a list of healthy backends, it needs a rule to pick one. The rule matters most when requests have **different costs** or backends have **different speeds**.

| Algorithm | How it picks | Strength | Weakness |
|---|---|---|---|
| **Round robin** | next backend in a fixed cycle | simple, fair when requests and servers are uniform | ignores load: a slow server gets as many requests as a fast one |
| **Weighted round robin** | cycle proportional to weights (e.g. 2:1) | mixes machine sizes; canaries (5% weight) | weights are static |
| **Random** | uniform random choice | stateless, works across many LB instances | short-term imbalance |
| **Least connections** | backend with the fewest active connections/requests | adapts to slow requests and slow servers | needs shared state; misleading with long-lived idle connections |
| **Least response time / EWMA** | lowest recent latency (exponentially weighted moving average) × load | routes around degraded servers | can herd onto a server that just became fast |
| **Power of two choices (P2C)** | pick **two** backends at random, send to the less loaded | near-optimal balance with almost no coordination | needs a load signal (in-flight requests) |
| **IP hash / source hash** | `hash(client IP) mod N` | same client → same backend, no cookie | uneven with NATs and proxies; reshuffles when N changes |
| **Consistent hashing** | `hash(key)` placed on a ring of backends | same key → same backend; adding a node moves only ~1/N keys | needs virtual nodes for balance; hot keys stay hot |

Two of these deserve more attention.

### Power of two choices { #p2c }

Choosing the least-loaded backend among *all* of them sounds ideal, but with many load balancer instances (each with a slightly stale view) they all pick the same "least loaded" server at once and overload it — a **herd**. Picking a backend at random avoids the herd but leaves some servers much busier than others by chance. Mitzenmacher showed that a tiny compromise gets almost the best of both: **sample two backends at random and pick the less loaded one**[^2]. The maximum load drops exponentially compared with pure random choice, and there is no herd, because different LB instances sample different pairs. Envoy, Nginx (`random two least_conn`), HAProxy and the gRPC libraries implement it; it is the default choice of many modern proxies.

<div class="csim" data-sim="lb" data-algo="rr" data-rate="100" data-factor="5"></div>

!!! tip "Try it"
    The four algorithms route the **same** 100 requests/s to four `catalog` replicas of about 40 requests/s each; the chart draws the p99 of each one.

    1. Play for 10 s with healthy replicas: all p99s stay low (about 100 ms; random about 200 ms, its short-term imbalance).
    2. Switch on **catalog-3 slows down**. Round robin keeps sending it **25%** of the requests, more than its 8/s: after 10 s its queue holds about 180 requests and the p99 reaches about **23 s** — while the p50 stays near 30 ms, because only one request in four waits.
    3. Pick **least connections** and then **P2C**: catalog-3's open requests pile up, so it gets only about 7% and 10% of the traffic and the p99 stays around 0.5 s and 0.6 s. That is the "adapts to slow servers" column of the table.
    4. Nginx's default in [lab 3](../../../hands-on/3/index.md) is round robin; `least_conn` is the commented line in `nginx.conf`.


### Consistent hashing { #consistent-hashing }

Sometimes you *want* the same key to go to the same backend: a cache server that holds a user's data, a WebSocket server that holds a chat room, a shard of a key-value store. The naive way is `server = hash(key) mod N`. It works until N changes: going from 5 to 6 servers changes the result of `mod` for **most** keys, so almost every key moves — every cache misses at once.

**Consistent hashing** (Karger et al., 1997)[^3] places both servers and keys on a circle of hash values (the **ring**). A key belongs to the first server found walking clockwise from its position.

``` diagram-sim
flowchart LR
    A["node A<br/>position 10"] -->|clockwise| B["node B<br/>position 40"]
    B -->|clockwise| D["new node D<br/>position 55"]
    D -->|clockwise| C["node C<br/>position 75"]
    C -->|"clockwise (wraps to 0)"| A
    k1(["hold:42 → 30"]) -.->|owner| B
    k2(["hold:77 → 50"]) -.->|"owner: was C, now D"| D
    k3(["hold:91 → 90"]) -.->|"owner (wraps)"| A
```

In the diagram, positions go from 0 to 99: `hold:42` hashes to 30 and belongs to B (the first node at or after 30); `hold:91` hashes to 90 and wraps around to A. When node D joins at position 55, only the keys between 40 and 55 — such as `hold:77` — move from C to D; nothing else changes. In general, when a server is added, it only takes over the keys between itself and its predecessor — about **1/(N+1)** of them; when one is removed, only its keys move, to its successor.

With one point per server, the arcs of the ring have very different lengths, so some servers own much more than their share. The fix is **virtual nodes**[^5]: each physical server is placed on the ring many times (100–200 points, for example), so the arcs average out. Virtual nodes also make it easy to give a bigger machine more points (weights) and, when a server leaves, spread its keys over *all* the others instead of dumping them on one neighbour.

The simulation below hashes 40 000 seat-hold keys onto 5 nodes. On the left, one point per node versus 200 virtual nodes per node; on the right, the fraction of keys that change owner when a 6th node joins:

```python exec="1" html="1"
import hashlib
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO
plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

def h(s):  # stable 64-bit hash (Python's hash() changes between runs)
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

keys = np.array([h(f"seat-hold:{i}") for i in range(40_000)], dtype=np.uint64)

def ring(nodes, vnodes):
    points = sorted((h(f"{n}#{v}"), n) for n in nodes for v in range(vnodes))
    return np.array([p for p, _ in points], dtype=np.uint64), [n for _, n in points]

def owners(nodes, vnodes):
    pos, names = ring(nodes, vnodes)
    idx = np.searchsorted(pos, keys) % len(pos)  # first point clockwise from the key
    return np.array(names)[idx]

nodes5 = [f"node{i}" for i in range(1, 6)]
nodes6 = nodes5 + ["node6"]

fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4))

# left: share of keys per node with 1 point per node vs 200 virtual nodes
x = np.arange(len(nodes5))
for off, v, c in [(-0.2, 1, "#e5484d"), (0.2, 200, "#1e9e5a")]:
    own = owners(nodes5, v)
    share = [np.mean(own == n) * 100 for n in nodes5]
    a.bar(x + off, share, width=0.4, color=c, label=f"{v} point(s) per node (max {max(share):.0f}%)")
a.axhline(20, color="#888", linestyle="--", linewidth=1)
a.set_xticks(x, nodes5)
a.set_ylabel("share of keys (%)")
a.set_title("5 nodes: ideal share is 20%")
a.legend(frameon=False, fontsize=8)

# right: keys that change node when a 6th node is added
mod5 = keys % np.uint64(5)
mod6 = keys % np.uint64(6)
moved = {
    "hash mod N": np.mean(mod5 != mod6) * 100,
    "consistent\nhashing": np.mean(owners(nodes5, 200) != owners(nodes6, 200)) * 100,
    "ideal\n1/(N+1)": 100 / 6,
}
b.bar(list(moved), list(moved.values()), color=["#e5484d", "#2f6fed", "#888"])
for i, val in enumerate(moved.values()):
    b.text(i, val + 1.5, f"{val:.0f}%", ha="center")
b.set_ylabel("keys remapped (%)")
b.set_title("Adding a 6th node")
b.set_ylim(0, 100)

plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Two lessons from the figure. With a single point per node, one node owns about **half** of all keys and another almost none — the ring is badly unbalanced. With 200 virtual nodes, every node is close to the ideal 20%. And when the 6th node arrives, `hash mod N` remaps about **83%** of the keys (5/6 of them, as theory predicts), while the ring remaps about **17%** — the 1/6 that the new node must own anyway.

Consistent hashing appears all over system design: Nginx `hash $key consistent`, Envoy's ring hash and Maglev balancers, memcached clients, Amazon's Dynamo and Cassandra for data partitioning (studied in [Databases — partitioning](../../databases/partitioning/index.md)), and Discord-style chat servers that pin a channel to a node.

!!! warning "Consistent hashing does not fix hot keys"
    It balances *many* keys. If one key is very popular — the stadium show's seat map — all its requests still go to one node. Hot keys need other tools: caching, replicating the hot key, or splitting it.

---

## Service discovery: how the LB knows the replicas { #service-discovery }

Replicas come and go — autoscaling adds them at 09:58, a deploy replaces them, a crash removes one — and their IP addresses change every time. Before a load balancer can pick a healthy replica, something must tell it **which replicas exist right now**. That is **service discovery**, and it has two shapes:

``` diagram-sim
flowchart LR
    subgraph server ["Server-side discovery"]
        C1([gateway]) -->|"inventory.svc"| LB1["load balancer / kube-proxy"]
        LB1 --> R1[inventory-1]
        LB1 --> R2[inventory-2]
        REG1[("registry<br/>(K8s endpoints)")] -.->|"watch"| LB1
    end
    subgraph client ["Client-side discovery"]
        C2([gateway]) -->|"1 · who serves inventory?"| REG2[("registry<br/>(Consul, Eureka)")]
        REG2 -->|"2 · [10.0.1.7, 10.0.2.9]"| C2
        C2 -->|"3 · picks one itself"| R3[inventory-3]
    end
```

| | Server-side discovery | Client-side discovery |
|---|---|---|
| **Who chooses the replica** | a load balancer or proxy in the path | the calling service, with a client library |
| **Registry** | the platform (Kubernetes endpoints, cloud target groups) | Consul, Eureka, etcd, DNS SRV records |
| **Extra hop** | yes (the proxy) | no |
| **Language coupling** | none: any client just calls a name | every language needs the library (or a sidecar does it — the service mesh) |
| **Typical today** | Kubernetes `Service` + DNS, cloud LBs | gRPC clients with xDS, service meshes, older Spring Cloud Netflix stacks |

Registration happens either by the platform (Kubernetes adds a pod's IP to the Service's endpoints when its **readiness** probe passes) or by the instance itself (it registers on start and sends heartbeats; a missed heartbeat removes it). Either way, discovery and **health checks** are two halves of the same question — *which replicas can serve now?* — and the registry is a small, strongly consistent store (etcd, Consul's Raft) for the reasons in [Distributed Systems — consensus](../../distributed/consensus/index.md).

---

## Health checks { #health-checks }

A load balancer is only as good as its knowledge of which backends are healthy. There are two complementary ways to find out:

| Type | How | Reacts to | Example |
|---|---|---|---|
| **Active** | the LB probes each backend periodically (`GET /actuator/health/readiness` every 5 s; 2 failures → unhealthy; 3 successes → healthy again) | crashed, hung or not-ready backends, even with no traffic | AWS target groups, Nginx Plus `health_check`, HAProxy `check`, Kubernetes readiness probes |
| **Passive** (outlier detection) | the LB watches real responses; a backend that returns many 5xx or timeouts is ejected for a while | backends that pass the probe but fail real requests | Envoy outlier detection, Nginx `max_fails` / `fail_timeout` |

Design the health endpoint carefully. **Readiness** ("can I serve traffic now?") should check what the instance needs to answer requests — but if it checks a *shared* dependency such as the database, a database blip marks **every** replica unhealthy at once and the LB has nothing left to route to. The usual compromise: readiness reflects the instance's own state (started, warmed up, not overloaded, not shutting down); dependency failures are handled by timeouts and circuit breakers ([Reliability — patterns](../../reliability/patterns/index.md)).

### Connection draining { #draining }

When a replica is removed — scaled in, or replaced by a deploy — cutting it off abruptly fails every request in flight. **Connection draining** (deregistration delay) fixes this: the LB stops sending *new* requests to the replica, waits for the in-flight ones to finish (up to, say, 30 s), and only then removes it. In Kubernetes, the pod becomes *not ready*, is removed from the Service endpoints, and receives `SIGTERM`; the application should finish its current requests before exiting (Spring Boot: `server.shutdown=graceful`).

---

## Sticky sessions { #sticky-sessions }

**Session affinity** ("sticky sessions") makes the LB send every request from the same client to the same backend, using a cookie set by the LB or a hash of the client IP. It exists for applications that keep state in memory — a server-side session, an in-process cache, a WebSocket.

| | Sticky sessions | Stateless replicas + shared store |
|---|---|---|
| Where state lives | in one replica's memory | Redis / database / client token (JWT) |
| A replica dies | its users lose their session | nothing is lost |
| Balance | uneven: heavy users stick to one replica | any replica takes any request |
| Scaling in / deploys | must wait for sessions to end or lose them | drain in seconds |
| Extra cost | none | one network call to the shared store |

Prefer **stateless replicas**. Use affinity only where the state is inherently local and cheap to rebuild — a WebSocket connection, a local cache that only improves hit ratio — and prefer **consistent hashing** on a meaningful key (user id, room id) to cookie stickiness, because it survives LB restarts and scales smoothly.

---

## The load balancer must not be the weak point { #lb-ha }

A single load balancer in front of ten replicas is a **single point of failure**. How the LB itself stays up depends on who runs it:

- **Managed cloud load balancers** (ALB/NLB, Google Cloud Load Balancing, Azure Load Balancer) are distributed systems run by the provider across several availability zones; you get a DNS name or an IP, and the provider scales and replaces the underlying machines.
- **Self-hosted** (Nginx, HAProxy, Envoy on VMs): run at least two, in an **active-passive pair** sharing a **virtual IP** (VIP) moved by VRRP (keepalived) when the active one fails, or **active-active** behind DNS or an L4 tier.
- **Anycast** at the edge: the same IP announced from many locations ([DNS & CDN](../dns-cdn/index.md#anycast)).

There is also a hierarchy of scopes: a **global** load balancer (anycast or DNS-based) chooses the **region**; a **regional** load balancer chooses the **zone and instance**; inside Kubernetes, the Service and ingress choose the **pod**.

``` diagram
flowchart TB
    u([Fans worldwide]) --> g["Global LB / DNS<br/>chooses the region"]
    g --> r1["Regional LB São Paulo<br/>across 3 zones"]
    g --> r2["Regional LB Virginia"]
    r1 --> i1["Ingress / Gateway<br/>in the cluster"]
    i1 --> p1[inventory pods]
    i1 --> p2[order pods]
```

**Try it.** Load the scale-out scenario and run the **load** profile with 2 replicas; note p99 latency and errors. Increase the replica count until p99 stabilises. Then kill one replica while the test runs (chaos **medium**, or stop it in the panel): watch the health checks remove it, the error spike that lasts until they do, and the remaining replicas absorb the load. Try a different balancing algorithm and compare p99.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520" data-profile="load"></div>

[:material-open-in-new: Open the full playground](../../../../playground/index.md)

---

## A load balancer in practice: Nginx { #nginx }

[Hands-on 3](../../../hands-on/3/index.md) puts Nginx in front of three replicas of `catalog`. The core of the configuration is an `upstream` block — the pool of replicas and the algorithm: round robin by default, or one line such as `least_conn;`, `random two least_conn;` (power of two choices) or `hash $arg_event consistent;` — and a `location` that proxies to it.

!!! example "In the BoxOffice code: the edge's load balancer (lab 3)"

    This is the configuration of [Hands-on 3](../../../hands-on/3/index.md), unchanged. Besides the pool, look at what protects the fans from a bad replica: `max_fails=3 fail_timeout=10s` is a **passive** health check (3 failed requests take a replica out for 10 s); `proxy_connect_timeout 1s` and `proxy_read_timeout 5s` bound how long a dead or frozen replica can hold a request; `proxy_next_upstream` retries a failed request **once more** (`tries 2`) on another replica; `keepalive 64` reuses connections to the replicas. `least_conn` is commented out on purpose: the lab asks you to switch it on and compare the tail. In the lab's failure experiment at 150 req/s, a stopped replica cost almost nothing, while a frozen one produced no errors but a p99 of 1 s and a max of 5.05 s — the read timeout.

    ``` { .nginx title="infra/nginx/nginx.conf (pool, timeouts, retry)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:19:26,43:61"
    ```

Note what is configured besides the algorithm: **timeouts** toward the backends, **keep-alive** connections to them, and **`proxy_next_upstream`**, which retries a failed request on another replica. Nginx does not retry non-idempotent requests (such as `POST`) by default — retrying a `POST /holds` on another replica could create two holds. The timeouts come from measurement, not taste: a read timeout shorter than the healthy p99 turns slow answers into retries, and the lab sets 5 s for a service whose listings take hundreds of milliseconds under load.

---

## Load balancing in Kubernetes { #kubernetes }

In Kubernetes, three objects share the load-balancing work.

**Service** — a stable virtual IP and DNS name (`inventory.boxoffice.svc.cluster.local`) in front of the pods that match a label selector. Only **ready** pods are listed as endpoints. Traffic to the Service IP is spread across them at L4, by `kube-proxy` (iptables/IPVS rules) or by an eBPF data plane such as Cilium. A Service of type `LoadBalancer` also asks the cloud provider for an external L4 load balancer.

```yaml title="inventory-service.yaml"
apiVersion: v1
kind: Service
metadata:
  name: inventory
spec:
  selector:
    app: inventory
  ports:
    - port: 80
      targetPort: 8080
```

**Ingress** — the original API for **L7 HTTP routing** into the cluster: rules by host and path, TLS termination, all implemented by an **ingress controller** (Traefik, HAProxy, cloud controllers; the community `ingress-nginx` controller was very popular but has been retired by the Kubernetes project). The Ingress API is simple but limited: anything beyond host/path routing (header matching, traffic splitting, timeouts) requires controller-specific annotations, which are not portable.

```yaml title="ingress.yaml"
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: boxoffice
spec:
  ingressClassName: traefik
  tls:
    - hosts: [api.boxoffice.com]
      secretName: boxoffice-tls
  rules:
    - host: api.boxoffice.com
      http:
        paths:
          - path: /api/holds
            pathType: Prefix
            backend:
              service:
                name: inventory
                port:
                  number: 80
```

**Gateway API** — the successor of Ingress, generally available since 2023[^4]. It splits the configuration by **role**, so that each team owns its part:

| Resource | Owned by | Defines |
|---|---|---|
| `GatewayClass` | infrastructure provider | which implementation (Envoy Gateway, Istio, Cilium, NGINX Gateway Fabric, cloud gateways) |
| `Gateway` | platform / cluster operators | listeners: ports, protocols, hostnames, TLS certificates |
| `HTTPRoute` (and `GRPCRoute`, `TLSRoute`, …) | application teams | routing rules: path, header and method matching, weights, filters, timeouts |

Features that needed annotations in Ingress are part of the standard: **weighted traffic splitting** (canaries), header-based routing, request mirroring, timeouts and gRPC routing.

```yaml title="gateway.yaml"
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public
spec:
  gatewayClassName: envoy
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: api.boxoffice.com
      tls:
        certificateRefs:
          - name: boxoffice-tls
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: inventory
spec:
  parentRefs:
    - name: public
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/holds
      timeouts:
        request: 2s
      backendRefs:
        - name: inventory        # stable version: 95% of requests
          port: 80
          weight: 95
        - name: inventory-canary # new version: 5% of requests
          port: 80
          weight: 5
```

In [hands-on 10](../../../hands-on/10/index.md) you deploy BoxOffice on a local cluster and expose it through an ingress; canary releases come back in the [cloud-native class](../../cloud-native/index.md).

---

## Trade-offs at a glance { #trade-offs }

| Decision | Option A | Option B | Choose A when… |
|---|---|---|---|
| Layer | L4 | L7 | you need raw throughput, non-HTTP protocols or TLS pass-through |
| Algorithm | round robin | least connections / P2C | requests and servers are uniform |
| Affinity | consistent hashing on a key | none (stateless) | a backend holds useful per-key state (cache, room, shard) |
| Health checks | active only | active + passive (outlier detection) | traffic is low and failures are clean crashes |
| Operation | managed cloud LB | self-hosted Nginx / HAProxy / Envoy | you are on a cloud and want HA and scaling solved for you |
| Kubernetes | Ingress | Gateway API | a simple, existing setup; new designs should prefer Gateway API |

!!! example "BoxOffice: load balancing the core"
    - A **regional managed L7 load balancer** terminates TLS for `api.boxoffice.com`, spreads requests across three availability zones and forwards them to the Kubernetes **Gateway** (Envoy Gateway), which routes by path: `/api/events/**` → `catalog`, `/api/holds/**` → `inventory`, `/api/orders/**` → `order`.
    - Algorithm: **P2C on in-flight requests** (least-request, the Envoy Gateway default), because hold requests vary in cost when there is lock contention on popular sections.
    - Health: readiness probes on `/actuator/health/readiness` (instance state only) plus **outlier detection** that ejects a pod returning 5 consecutive 5xx for 30 s.
    - Stateless services: holds live in PostgreSQL, sessions are JWTs; **no sticky sessions**. The one exception is the waiting-room WebSocket/SSE service, where connections are long-lived and balanced at connection time.
    - Deploys: graceful shutdown (30 s) and a 5% weighted **canary** route before the sale day.

!!! tip "In the interview"
    - Draw the load balancer **in front of every stateless tier**, and say "the app servers are stateless, so the LB can send any request anywhere" — this justifies horizontal scaling.
    - Name the **algorithm** only when it matters: least connections / P2C for uneven request costs; **consistent hashing** when requests should reach the server that holds their data (cache nodes, chat rooms, shards). Know the 1/(N+1) property and why virtual nodes exist.
    - Mention **health checks** and **draining** when asked about failures or deploys.
    - If asked "isn't the LB a single point of failure?": managed LBs are replicated across zones; self-hosted ones run as an active-passive pair with a floating IP, or behind anycast/DNS.

!!! success "Best practices"

    - **Set backend timeouts from measured latency, slightly above the healthy p99.9** — shorter turns slow answers into retries, longer lets a frozen replica hold requests. In BoxOffice: `proxy_read_timeout 5s` in [lab 3](../../../hands-on/3/index.md) (box above).
    - **Warm up a new replica before it gets its full share** — slow start or a readiness check that waits for warm-up; a cold JVM marked failed under load can cascade into `502 no live upstreams` (lab 3, step 7).
    - **Use least connections or power of two choices when request costs vary** — round robin ignores a replica stuck with slow requests. In BoxOffice: try `least_conn;` in lab 3's upstream.
    - **Reuse connections to the backends** — keep-alive avoids a TCP (and TLS) handshake per request. In BoxOffice: `keepalive 64` with `proxy_http_version 1.1` in lab 3.
    - **Log the chosen backend and its time for every request** — `upstream=$upstream_addr ut=$upstream_response_time` in lab 3's log format shows which replica is slow, and how much the hop costs.

!!! warning "Pitfalls"
    - **Stateful replicas behind a round-robin LB**: logins "randomly" disappear because the session lives in another replica. Externalise state.
    - **Readiness that checks shared dependencies**: a database blip ejects every replica at once.
    - **L4 balancing of long-lived HTTP/2 or gRPC connections**: all traffic sticks to the first replicas; new replicas receive nothing after a scale-out.
    - **Retrying non-idempotent requests at the LB**: duplicated holds or orders.
    - **No draining**: every deploy causes a burst of 502s.
    - **Forgetting the LB's own limits**: connection tables, TLS handshakes per second and bandwidth are finite; managed LBs may also need pre-warming before a known spike — ask the provider before the sale.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    SD["service discovery"] --> LB["load balancer"]
    HC["health checks<br/>(readiness)"] --> LB
    LB --> ALG["algorithm: RR, least conn,<br/>P2C, consistent hashing"]
    ALG --> STATELESS["stateless replicas<br/>→ Compute"]
    ALG --> CH["consistent hashing<br/>→ sharding (class 6)"]
    LB --> HA["LB redundancy, anycast<br/>→ Reliability"]
    LB --> K8S["Service, Ingress, Gateway API<br/>→ Cloud-native"]
    STATELESS --> AS["autoscaling<br/>→ Compute"]
    HC --> OBS["health endpoints<br/>→ Observability"]
```

**Palette components:** [`lb`](../../../reference/components/edge/index.md#lb) · [`ingress`](../../../reference/components/edge/index.md#ingress) · [`app`](../../../reference/components/compute/index.md#app) (the replicas behind it) · [`healthcheck`](../../../reference/components/observability/index.md#healthcheck) · [`mesh`](../../../reference/components/network/index.md#mesh) (client-side balancing in a sidecar). **Scenarios:** `scale-out`, `chat` (long-lived connections). **Continues in:** [Compute — services](../../compute/services/index.md), [Databases — partitioning](../../databases/partitioning/index.md) (consistent hashing for data), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Hands-on 3](../../../hands-on/3/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - A load balancer turns a pool of **stateless**, interchangeable replicas into one scalable, highly available service.
    - **L4** balances connections (fast, protocol-agnostic); **L7** balances requests (routing, TLS, retries, per-request decisions).
    - Round robin for uniform work; **least connections / power of two choices** for uneven work; **consistent hashing with virtual nodes** when a key must stick to a server — adding a node moves only about **1/(N+1)** of the keys.
    - **Active and passive health checks** remove failed replicas; **draining** makes deploys invisible.
    - Avoid sticky sessions; keep state in a shared store.
    - In Kubernetes: **Service** (L4, ready pods), **Ingress** (basic L7) and **Gateway API** (role-based, portable L7 routing with weights and timeouts).

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/load-balancing-frontend/){target="_blank"}, ch. 19 "Load Balancing at the Frontend" and ch. 20 "Load Balancing in the Datacenter". O'Reilly, 2016.
[^2]: MITZENMACHER, M. [The Power of Two Choices in Randomized Load Balancing](https://www.eecs.harvard.edu/~michaelm/postscripts/tpds2001.pdf){target="_blank"}. IEEE Transactions on Parallel and Distributed Systems, 2001.
[^3]: KARGER, D. et al. [Consistent Hashing and Random Trees](https://dl.acm.org/doi/10.1145/258533.258660){target="_blank"}. ACM STOC, 1997.
[^4]: KUBERNETES SIG NETWORK. [Gateway API](https://gateway-api.sigs.k8s.io/){target="_blank"}. Kubernetes documentation.
[^5]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 5 "Design consistent hashing". Byte Code LLC, 2020.
