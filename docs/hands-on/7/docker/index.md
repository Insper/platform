Two changes are needed in `compose.yaml`: add the `nginx` service as the new entry point, and update the `gateway` service to run as multiple replicas without an exposed port.

## Add Nginx

``` { .yaml .copy .select title="compose.yaml" }
  nginx:
    image: nginx:alpine
    hostname: nginx
    ports:
      - 80:80
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

``` { .yaml .copy .select title="compose.yaml" hl_lines="5 6 7" }
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

## Full `compose.yaml`

The complete file after all changes:

``` { .yaml .copy .select linenums="1" title="compose.yaml" }
name: store

services:

  db:
    image: postgres:17
    hostname: db
    ports:
      - 5432:5432
    volumes:
      - ${VOLUME_DB}:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${DB_USER:-store}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-devpass}
      POSTGRES_DB: ${DB_NAME:-store}

  account:
    build:
      context: ./account-service
      dockerfile: Dockerfile
    hostname: account
    environment:
      DATABASE_HOST: db
      DATABASE_PORT: 5432
      DATABASE_DB: ${DB_NAME:-store}
      DATABASE_USERNAME: ${DB_USER:-store}
      DATABASE_PASSWORD: ${DB_PASSWORD:-devpass}
    deploy:
      replicas: 2
    depends_on:
      - db

  auth:
    build:
      context: ./auth-service
      dockerfile: Dockerfile
    hostname: auth
    environment:
      DATABASE_HOST: db
      DATABASE_PORT: 5432
      DATABASE_DB: ${DB_NAME:-store}
      DATABASE_USERNAME: ${DB_USER:-store}
      DATABASE_PASSWORD: ${DB_PASSWORD:-devpass}
    depends_on:
      - db

  gateway:
    build:
      context: ./gateway-service
      dockerfile: Dockerfile
    deploy:
      replicas: 3
    depends_on:
      - account
      - auth

  nginx:
    image: nginx:alpine
    hostname: nginx
    ports:
      - 80:80
    volumes:
      - $SETUP/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - gateway
```

!!! info "Port mapping change"

    The platform now listens on **port 80** instead of 8080. All API calls, Prometheus scrape targets, and test scripts must be updated accordingly: `http://localhost/gateway/...` instead of `http://localhost:8080/gateway/...`.
