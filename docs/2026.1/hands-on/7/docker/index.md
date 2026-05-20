Two changes are needed in `compose.yaml`: add the `nginx` service as the new entry point, and update the `gateway` service to run as multiple replicas without an exposed port.

## Add Nginx

``` { .yaml .copy .select title="compose.yaml" }
  nginx:
    image: nginx:alpine
    hostname: nginx
    ports:
      - 8080:80
    volumes:
      - $SETUP/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - gateway
```

The `volumes` entry mounts the configuration file created in the previous step. The `$SETUP` variable must be defined in `.env` at the project root:

``` { .bash .copy .select title=".env" }
SETUP=./setup
```

## Scale the Gateway

Remove the `ports` mapping from the `gateway` service and add a `deploy` block to set the replica count:

``` { .yaml .copy .select title="compose.yaml" hl_lines="5" }
  gateway:
    build:
      context: ./gateway-service
      dockerfile: Dockerfile
    # ports removed — gateway is only reachable through nginx
    deploy:
      replicas: 3
    depends_on:
      - account
      - auth
```

!!! warning "Remove the `hostname` field from gateway"

    If the `gateway` service had a `hostname: gateway` entry, remove it. Docker Compose cannot assign the same hostname to multiple containers — the field is silently ignored when `replicas > 1`. The DNS service name `gateway` continues to work correctly for internal communication.
