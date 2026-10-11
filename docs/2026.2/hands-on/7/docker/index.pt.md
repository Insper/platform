São necessárias duas mudanças no `compose.yaml`: adicionar o serviço `lb` (Nginx) como o novo ponto de entrada e atualizar o serviço `gateway` para rodar com várias réplicas, sem porta exposta.

## Adicionar o Nginx

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

A entrada `volumes` monta o arquivo de configuração criado no passo anterior (`setup/nginx.conf`, relativo ao `compose.yaml`), somente leitura, sobre a configuração padrão do Nginx. A porta `8080` do host agora pertence ao `lb` (o Nginx escuta na `80` dentro do container); assim, os clientes continuam chamando `http://localhost:8080`.

O `depends_on` faz o Compose criar o gateway primeiro: o Nginx resolve o nome `gateway` ao iniciar e termina com *host not found in upstream* se esse nome ainda não existir.

## Escalar o gateway

Remova o mapeamento `ports` do serviço `gateway` e aumente o número de réplicas no seu bloco `deploy` (o repositório mantém `replicas: 1`; use 3 para ver o balanceamento):

``` { .yaml .copy .select title="compose.yaml" hl_lines="5-7" }
  gateway:
    build:
      context: ./gateway-service
      dockerfile: Dockerfile
    # ports removed — gateway is only reachable through lb
    deploy:
      replicas: 3
```

!!! warning "Remova o campo `hostname` do gateway"

    Se o serviço `gateway` tinha uma entrada `hostname: gateway`, remova-a. O Docker Compose não consegue atribuir o mesmo hostname a vários containers — o campo é ignorado silenciosamente quando `replicas > 1`. O nome de serviço `gateway` no DNS continua funcionando corretamente para a comunicação interna.
