Add the `redis` service to `compose.yaml` and expose the Redis hostname to each microservice through environment variables.

## Add Redis

``` { .yaml .copy .select title="compose.yaml" }
  redis:
    image: redis:7-alpine
    hostname: redis
    ports:
      - 6379:6379
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
```

The `--appendonly yes` flag enables the AOF persistence mode: every write is logged to disk, so cached data survives a Redis container restart.

Add the named volume at the bottom of `compose.yaml`:

``` { .yaml .copy .select title="compose.yaml" }
volumes:
  redis_data:
```

## Connect microservices to Redis

Each microservice that uses the cache must know where Redis is running. Pass the connection details as environment variables:

``` { .yaml .copy .select title="compose.yaml" hl_lines="6 7" }
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
      REDIS_HOST: redis
      REDIS_PORT: 6379
    deploy:
      replicas: 2
    depends_on:
      - db
      - redis
```

Apply the same `REDIS_HOST` and `REDIS_PORT` variables to any other service that reads or writes the cache (e.g. `auth`).

## Full `compose.yaml`

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

  redis:
    image: redis:7-alpine
    hostname: redis
    ports:
      - 6379:6379
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

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
      REDIS_HOST: redis
      REDIS_PORT: 6379
    deploy:
      replicas: 2
    depends_on:
      - db
      - redis

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
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - db
      - redis

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

volumes:
  redis_data:
```

!!! info "Redis port exposure"
    Port `6379` is published to the host for development convenience — it allows direct inspection with `redis-cli` from your machine. In production, remove this `ports` mapping so Redis is only reachable from within the Docker network.
