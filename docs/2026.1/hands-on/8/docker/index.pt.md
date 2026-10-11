Adicione o serviço `redis` ao `compose.yaml` e informe o hostname do Redis a cada microsserviço por meio de variáveis de ambiente.

## Adicionar o Redis

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

A flag `--appendonly yes` habilita o modo de persistência AOF: toda escrita é registrada em disco, de modo que os dados em cache sobrevivem a um reinício do container do Redis.

Adicione o volume nomeado no final do `compose.yaml`:

``` { .yaml .copy .select title="compose.yaml" }
volumes:
  redis_data:
```

## Conectar os microsserviços ao Redis

Cada microsserviço que usa o cache precisa saber onde o Redis está rodando. Passe os dados de conexão como variáveis de ambiente:

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

Aplique as mesmas variáveis `REDIS_HOST` e `REDIS_PORT` a qualquer outro serviço que leia ou escreva no cache (por exemplo, `auth`).

## `compose.yaml` completo

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

!!! info "Exposição da porta do Redis"
    A porta `6379` é publicada no host por conveniência durante o desenvolvimento — ela permite a inspeção direta com `redis-cli` a partir da sua máquina. Em produção, remova esse mapeamento de `ports` para que o Redis seja acessível apenas de dentro da rede Docker.
