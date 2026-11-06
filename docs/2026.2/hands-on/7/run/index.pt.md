Reconstrua todas as imagens e suba a stack completa:

``` { .bash .copy .select }
docker compose up -d --build
```

Verifique se três réplicas do `gateway` e uma instância do `lb` (Nginx) estão rodando junto com os demais serviços:

``` { .bash .copy .select }
docker compose ps -a
```

Saída esperada:

```
NAME                STATUS     PORTS
store-lb-1          running    0.0.0.0:8080->80/tcp
store-gateway-1     running
store-gateway-2     running
store-gateway-3     running
store-auth-1        running
store-account-1     running
store-db-1          running
```

Observe que só o `lb` publica uma porta: os containers do gateway (e os demais serviços) só são acessíveis através do Nginx, na rede Docker interna.

## Verificar a distribuição de carga

Envie uma rajada de requisições pelo Nginx. O `/health-check` do gateway responde com o hostname do container que a atendeu; por isso, a saída alterna entre as três réplicas — e os logs do gateway mostram o mesmo:

``` { .bash .copy .select }
for i in {1..9}; do curl -s http://localhost:8080/health-check; echo; done
```

``` { .bash .copy .select }
docker compose logs gateway --tail 30
```

Cada um dos três containers deve mostrar entradas de requisição. Se todas as requisições caírem em uma única réplica, o Nginx pode ter subido antes de as réplicas do gateway estarem totalmente prontas. Reinicie o Nginx para que ele resolva novamente o registro do sistema de nomes de domínio (DNS, *Domain Name System*) de `gateway`:

``` { .bash .copy .select }
docker compose restart lb
```

## Escalar em tempo de execução

Adicione réplicas sem reconstruir as imagens:

``` { .bash .copy .select }
docker compose up -d --scale gateway=5
```

Depois de escalar, recarregue o Nginx para que ele consulte novamente o DNS do Docker e encontre os IPs das novas réplicas:

``` { .bash .copy .select }
docker compose exec lb nginx -s reload
```

Confirme o novo número de réplicas:

``` { .bash .copy .select }
docker compose ps gateway
```

## Reduzir a escala

``` { .bash .copy .select }
docker compose up -d --scale gateway=1
```

Após o próximo reload, o Nginx deixa automaticamente de rotear para os containers que não estão mais rodando.

## Quando uma réplica para { #replica-stops }

O `nginx.conf` do lab não define `max_fails` nem `fail_timeout`, então o Nginx usa os padrões: **uma** tentativa falha (`max_fails=1`) tira a réplica do pool por **10 s** (`fail_timeout=10s`) e o `proxy_next_upstream error timeout` padrão passa a requisição que falhou para a próxima réplica. O Nginx descobre a falha por requisições reais — uma verificação de saúde **passiva**. Pare uma réplica e rode o loop de novo:

``` { .bash .copy .select }
docker stop store-gateway-2
for i in {1..9}; do curl -s http://localhost:8080/health-check; echo; done
docker compose logs lb --tail 6
```

``` mermaid-sim
sequenceDiagram
    participant C as curl
    participant N as lb, Nginx
    participant G2 as gateway-2, parado
    participant G3 as gateway-3
    C->>N: GET /health-check
    N-xG2: connect, 113 Host is unreachable
    Note over N,G2: 1 falha atinge max_fails=1, gateway-2 fica fora por fail_timeout=10s
    N->>G3: proxy_next_upstream, a mesma requisição
    G3-->>N: 200
    N-->>C: 200, hostname do gateway-3
    Note over C,G3: as próximas requisições pulam o gateway-2 até passarem os 10 s
```

As nove requisições respondem, mas a que encontrou o `gateway-2` espera a conexão falhar e o log do lb mostra `connect() failed (113: Host is unreachable)` e `upstream server temporarily disabled`. Depois dos 10 s, o Nginx tenta o `gateway-2` de novo com uma requisição real; `docker start store-gateway-2` o traz de volta com o mesmo IP e ele volta ao rodízio.

| Situação | O que o cliente vê |
|---|---|
| 3 réplicas, uma parada | ✅ toda requisição respondida; ⚠️ uma requisição lenta a cada 10 s enquanto ela está fora |
| 1 réplica (`replicas: 1`), parada | ❌ `502 Bad Gateway`: não há outra réplica para quem passar a requisição |
| réplicas adicionadas, sem reload | ⚠️ as novas não recebem tráfego |
| réplicas removidas, sem reload | ⚠️ as respostas continuam, mas mais lentas, e o log do lb enche de tentativas falhas |

O Nginx guarda a vez e as contagens de falha por processo worker; com `worker_processes auto` há vários, então a ordem real dos hostnames pode fugir um pouco de um ciclo exato.

<div class="csim" data-sim="nginx-upstream" data-script="failure"></div>

!!! tip "Experimente"

    Antes do Docker, a mesma pilha no navegador: lb (Nginx) na porta 8080 do host, três réplicas do gateway e o `nginx.conf` do lab. Play ou → roda os comandos da página; os botões funcionam a qualquer momento. O loop recebe 3 respostas de cada réplica. Depois de `--scale gateway=5` ele recebe ainda 3 hostnames até o `nginx -s reload` e depois 5. Em **Uma réplica para**, `docker stop store-gateway-2`: o cliente ainda recebe 9 respostas, com 1 tentativa falha no log do lb e um loop de 3,4 s em vez de 0,5 s; depois o Nginx pula essa réplica por 10 s. Em **Uma réplica**, a mesma parada dá 502 Bad Gateway: não há outra réplica para quem passar a requisição.

---

Pronto! O Nginx agora distribui todo o tráfego externo entre várias réplicas do gateway. Se uma réplica parar, o Nginx passa as requisições dela para as instâncias saudáveis e a pula por um tempo — com mais de uma réplica, a falha é transparente para os clientes.
