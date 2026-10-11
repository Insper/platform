Two changes are needed in `compose.yaml`: add the `lb` service (Nginx) as the new entry point, and update the `gateway` service to run as multiple replicas without an exposed port.

## Add Nginx

``` { .yaml .copy .select title="compose.yaml" }
  lb:
    image: nginx:latest
    ports:
      - "8080:80"
    volumes:
      - ./setup/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - gateway
```

The `volumes` entry mounts the configuration file created in the previous step (`setup/nginx.conf`, relative to `compose.yaml`) read-only over Nginx's default configuration. The host port `8080` now belongs to `lb` (Nginx listens on `80` inside the container), so the clients keep calling `http://localhost:8080`.

`depends_on` makes Compose create the gateway first: Nginx resolves the name `gateway` when it starts, and exits with *host not found in upstream* if that name does not exist yet.

## Scale the Gateway

Remove the `ports` mapping from the `gateway` service and raise the replica count in its `deploy` block (the repository keeps `replicas: 1`; use 3 to watch the balancing):

``` { .yaml .copy .select title="compose.yaml" hl_lines="5-7" }
  gateway:
    build:
      context: ./gateway-service
      dockerfile: Dockerfile
    # ports removed — gateway is only reachable through lb
    deploy:
      replicas: 3
```

!!! warning "Remove the `hostname` field from gateway"

    If the `gateway` service had a `hostname: gateway` entry, remove it. Docker Compose cannot assign the same hostname to multiple containers — the field is silently ignored when `replicas > 1`. The DNS service name `gateway` continues to work correctly for internal communication.
