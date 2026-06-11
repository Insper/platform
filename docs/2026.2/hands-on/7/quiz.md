Click **"Answer"** to reveal the correct answer and explanation.

---

## Load Balancer

**Q1.** What role does **Nginx** play in this hands-on?

- A. It acts as a service registry, tracking which gateway replicas are alive
- B. It terminates TLS and decrypts HTTPS traffic before forwarding to the gateway
- C. It is a Layer 7 reverse proxy and load balancer that receives all external traffic on port 80 and distributes it across gateway replicas
- D. It replaces the gateway service, routing directly to microservices

??? success "Answer"
    **C — L7 reverse proxy and load balancer.**

    Nginx sits at the edge: all external traffic on port 80 arrives at Nginx. It inspects the HTTP request and forwards it to one of the gateway replicas based on the configured algorithm. The gateway replicas have no exposed ports — they are only reachable from within the Docker network through Nginx.

---

**Q2.** What does `least_conn` in the Nginx `upstream` block configure?

- A. The minimum number of healthy connections required before the upstream is used
- B. The load balancing algorithm — each new request goes to the backend with the fewest active connections
- C. The maximum number of simultaneous connections Nginx accepts from clients
- D. The least-recently-used eviction policy for upstream connection caches

??? success "Answer"
    **B — Fewest active connections algorithm.**

    With `least_conn`, Nginx tracks how many requests are currently being processed by each gateway replica and routes the next request to the one with the smallest count. This is better than round-robin for requests with variable duration — it prevents a slow replica from accumulating a backlog.

---

**Q3.** After scaling the gateway to 5 replicas, why must Nginx be **reloaded**?

- A. Nginx caches HTTP responses and must flush the cache when backends change
- B. Scaling creates new Docker networks that Nginx cannot detect automatically
- C. Nginx resolves `gateway` DNS once at startup and caches all returned IPs; a reload forces re-query of Docker DNS to discover the new replica IPs
- D. The new replicas use different ports that Nginx must be configured to accept

??? success "Answer"
    **C — DNS resolved once at startup; reload forces re-query.**

    Nginx's `upstream` block resolves the `gateway` hostname when the worker processes start and caches the resulting IP addresses. When you scale to 5 replicas, Docker assigns new IPs to the new containers, but Nginx still uses the original 3 IPs from startup. Running `nginx -s reload` causes Nginx to re-resolve `gateway`, discovering all 5 IPs.

---
