Rebuild all images and start the full stack:

``` { .bash .copy .select }
docker compose up -d --build
```

Verify that three `gateway` replicas and one `nginx` instance are running alongside the rest of the services:

``` { .bash .copy .select }
docker compose ps -a
```

Expected output:

```
NAME                STATUS     PORTS
store-nginx-1       running    0.0.0.0:80->80/tcp
store-gateway-1     running
store-gateway-2     running
store-gateway-3     running
store-auth-1        running
store-account-1     running
store-account-2     running
store-db-1          running    0.0.0.0:5432->5432/tcp
```

Note that the gateway containers have no published ports — they are only reachable through Nginx on the internal Docker network.

## Verify Load Distribution

Send a burst of requests through Nginx and watch the gateway container logs to confirm that traffic is spread across all three replicas:

``` { .bash .copy .select }
for i in {1..9}; do curl -s -o /dev/null http://localhost/gateway/actuator/health; done
```

``` { .bash .copy .select }
docker compose logs gateway --tail 30
```

Each of the three containers should show request entries. If all requests land on a single replica, Nginx may have started before the gateway replicas were fully ready. Reload Nginx to re-resolve the `gateway` DNS record:

``` { .bash .copy .select }
docker compose restart nginx
```

## Scale Up at Runtime

Add replicas without rebuilding images:

``` { .bash .copy .select }
docker compose up -d --scale gateway=5
```

After scaling, reload Nginx so it re-queries Docker DNS and picks up the new replica IPs:

``` { .bash .copy .select }
docker compose exec nginx nginx -s reload
```

Confirm the new replica count:

``` { .bash .copy .select }
docker compose ps gateway
```

## Scale Down

``` { .bash .copy .select }
docker compose up -d --scale gateway=1
```

Nginx automatically stops routing to containers that are no longer running after the next reload.

---

Done! Nginx now distributes all external traffic across multiple gateway replicas. If one replica crashes, Docker restarts it and Nginx continues routing requests to the healthy instances — the failure is transparent to clients.
