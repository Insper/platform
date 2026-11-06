!!! tip "Main Goal"

    The main goal of this hands-on is to add a **load balancer** in front of the gateway using [Nginx](https://nginx.org){target="_blank"}, enabling **horizontal scaling** of the gateway service across multiple replicas inside Docker Compose.

Previous hands-on modules built a microservice platform with a single gateway instance handling all external traffic. Under sustained load, that gateway becomes a bottleneck — one process, one thread pool, no redundancy. A **load balancer** solves this by distributing incoming requests across multiple identical instances of the same service.

## Slides

<div class="slides-embed">
  <iframe src="slides/load-balancer.html" title="Slides: load balancer" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/load-balancer.html){:target="_blank"}

## Proxy

A **proxy** is an intermediary that sits between clients and servers, forwarding requests on behalf of one side or the other.

=== "Forward Proxy"

    A **forward proxy** sits in front of **clients**. It forwards outbound requests to the internet and returns the response to the client. The destination server sees the proxy's address, not the original client's.

    Common uses: corporate firewalls, content filtering, anonymization (VPN, Tor).

    ``` mermaid-sim
    flowchart LR
        client1[Client 1] --> fp[Forward Proxy]
        client2[Client 2] --> fp
        fp -->|masked IP| server[Internet / Server]
    ```

=== "Reverse Proxy"

    A **reverse proxy** sits in front of **servers**. It receives requests from the internet and forwards them to internal backend servers. The client sees only the proxy — never the backend addresses.

    Common uses: load balancing, SSL termination, caching, rate limiting.

    ``` mermaid-sim
    flowchart LR
        internet[Internet] --> rp[Reverse Proxy]
        rp --> s1[Backend 1]
        rp --> s2[Backend 2]
        rp --> s3[Backend 3]
    ```

In this hands-on, **Nginx acts as a reverse proxy** — the only component exposed (host port 8080, port 80 inside its container), distributing traffic to gateway replicas that remain invisible to external clients.

## Load Balancer Types

Load balancers are classified by the OSI layer at which they inspect traffic:

=== "Layer 4 — Transport"

    Routes traffic based on **IP address and TCP/UDP port** only. The balancer never inspects the HTTP payload — it simply forwards byte streams.

    - Minimal processing overhead — extremely fast
    - Protocol-agnostic: works for any TCP/UDP service
    - Cannot route based on URL path, HTTP headers, or cookies

    Examples: AWS Network Load Balancer (NLB), HAProxy TCP mode.

    ``` mermaid-sim
    flowchart LR
        client -->|"TCP :443"| lb["L4 Load Balancer\n(IP + Port)"]
        lb -->|"10.0.0.1:8080"| s1[Server 1]
        lb -->|"10.0.0.2:8080"| s2[Server 2]
        lb -->|"10.0.0.3:8080"| s3[Server 3]
    ```

=== "Layer 7 — Application"

    Routes traffic based on **HTTP content**: URL path, headers, cookies, or request body. Enables far smarter routing decisions.

    - Can inspect, modify, and rewrite requests and responses
    - Enables sticky sessions, A/B routing, and path-based routing to different services
    - Slight overhead compared to L4 — negligible in most workloads

    Examples: Nginx, Traefik, AWS Application Load Balancer (ALB).

    ``` mermaid-sim
    flowchart LR
        client --> lb["L7 Load Balancer\n(HTTP-aware)"]
        lb -->|"/api/auth/*"| auth[Auth Service]
        lb -->|"/api/accounts/*"| account[Account Service]
        lb -->|"Cookie: region=eu"| eu[EU Backend]
    ```

## Load Balancing Algorithms

| Algorithm | Behaviour | Best for |
|---|---|---|
| **Round Robin** | Requests distributed sequentially, one per server in order | Uniform workloads, equal-capacity replicas |
| **Least Connections** | Next request goes to the server with fewest active connections | Long-lived connections, variable request duration |
| **IP Hash** | Client IP determines which server handles all its requests | Session affinity (stateful applications) |
| **Weighted Round Robin** | Servers receive proportional share based on an assigned weight | Mixed-capacity servers |
| **Random** | Server chosen at random on each request | Very large clusters, simplicity at scale |

## Architecture

Adding Nginx as a load balancer changes the entry point of the platform. The gateway is no longer exposed directly — only Nginx is reachable from outside the Docker network:

=== "Before"

    ``` mermaid-sim
    flowchart LR
        subgraph api [Trusted Layer]
            gateway --> auth
            gateway --> account
            account --> db@{ shape: cyl, label: "Database" }
        end
        internet e1@==>|":8080"| gateway
        e1@{ animate: true }
    ```

=== "After"

    ``` mermaid-sim
    flowchart LR
        subgraph lb [Load Balancer Layer]
            nginx["lb · Nginx\n:80"]
        end
        subgraph api [Trusted Layer]
            gw1["gateway\n(replica 1)"]
            gw2["gateway\n(replica 2)"]
            gw3["gateway\n(replica 3)"]
            auth[auth]
            account[account]
            db@{ shape: cyl, label: "Database" }
            gw1 & gw2 & gw3 --> auth & account
            account --> db
        end
        internet e0@==>|":8080"| nginx
        nginx e1@==> gw1
        nginx e2@==> gw2
        nginx e3@==> gw3
        e0@{ animate: true }
        e1@{ animate: true }
        e2@{ animate: true }
        e3@{ animate: true }
    ```

The steps to implement this are:

<div class="grid cards" markdown>

-   :material-swap-horizontal-bold:{ .lg .middle } **[Nginx](./nginx/)**

    ---

    Create the Nginx configuration file defining the upstream pool and reverse proxy rules.

    [Nginx](./nginx/){ .md-button }

-   :material-file-code:{ .lg .middle } **[Docker Compose](./docker/)**

    ---

    Add the `lb` (Nginx) service to `compose.yaml`, remove the gateway's exposed port, and configure replicas.

    [Docker Compose](./docker/){ .md-button }

-   :material-play-circle:{ .lg .middle } **[Run](./run/)**

    ---

    Start the full stack and verify that Nginx distributes requests across the gateway replicas.

    [Run](./run/){ .md-button }

</div>

## The lab in the browser { #simulator }

<div class="csim" data-sim="nginx-upstream" data-script="run"></div>

!!! tip "Try it"

    Before Docker, the same stack in the browser: lb (Nginx) on host port 8080, three gateway replicas and the lab's `nginx.conf`. Play or → runs the page's commands; the buttons work at any time. The loop gets 3 answers from each replica. After `--scale gateway=5` it gets still 3 hostnames until `nginx -s reload`, then 5. In **A replica stops**, `docker stop store-gateway-2`: the client still gets 9 answers, with 1 failed attempt in the lb's log and a loop of 3.4 s instead of 0.5 s; Nginx then skips that replica for 10 s. In **One replica**, the same stop gives 502 Bad Gateway: there is no other replica to pass the request to.
