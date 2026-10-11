São necessárias duas mudanças no `compose.yaml`: adicionar o serviço `nginx` como o novo ponto de entrada e atualizar o serviço `gateway` para rodar com várias réplicas, sem porta exposta.

## Adicionar o Nginx

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

A entrada `volumes` monta o arquivo de configuração criado no passo anterior. A variável `$SETUP` deve ser definida no `.env` na raiz do projeto:

``` { .bash .copy .select title=".env" }
SETUP=./setup
```

## Escalar o gateway

Remova o mapeamento `ports` do serviço `gateway` e adicione um bloco `deploy` para definir o número de réplicas:

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

!!! warning "Remova o campo `hostname` do gateway"

    Se o serviço `gateway` tinha uma entrada `hostname: gateway`, remova-a. O Docker Compose não consegue atribuir o mesmo hostname a vários containers — o campo é ignorado silenciosamente quando `replicas > 1`. O nome de serviço `gateway` no DNS continua funcionando corretamente para a comunicação interna.
