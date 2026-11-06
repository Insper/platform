O Nginx é configurado como um [proxy reverso HTTP](https://nginx.org/en/docs/http/ngx_http_proxy_module.html){target="_blank"} usando um bloco `upstream` que define o pool de servidores de backend. Quando o Docker Compose sobe várias réplicas do serviço `gateway`, o sistema de nomes de domínio (DNS, *Domain Name System*) interno do Docker resolve o nome de serviço `gateway` para os endereços IP de todas as réplicas. O Nginx consulta esse registro DNS na inicialização e monta o seu pool upstream com todos os endereços retornados.

Crie o arquivo `setup/nginx.conf`:

``` { .nginx .copy .select linenums="1" title="nginx.conf" }
--8<-- "docs/2026.2/hands-on/7/nginx/nginx.conf"
```

Diretivas principais:

| Diretiva | Finalidade |
|---|---|
| `upstream gateways` | Dá nome a um pool de servidores de backend. O DNS do Docker expande `gateway:8080` para os IPs de todas as réplicas na inicialização. |
| _(sem linha de algoritmo)_ | Algoritmo de balanceamento de carga: nenhum é declarado, então o Nginx usa o padrão, **Round Robin** — cada nova requisição vai para a próxima réplica, em ordem. |
| `proxy_pass` | Encaminha a requisição correspondente para o pool upstream. |
| `X-Real-IP` | Repassa o endereço IP original do cliente para o serviço de backend. |
| `X-Forwarded-For` | Acrescenta o IP do cliente à cadeia padrão de encaminhamento — usado em logs e trilhas de auditoria. |
| `X-Forwarded-Proto` | Informa ao backend se a requisição original chegou via HTTP ou HTTPS. |

Com três réplicas e sem linha de algoritmo, cada requisição vai para o próximo peer, em ordem:

``` mermaid-sim
sequenceDiagram
    participant C as curl
    participant N as lb, Nginx
    participant G1 as gateway-1
    participant G2 as gateway-2
    participant G3 as gateway-3
    C->>N: GET /health-check, requisição 1
    N->>G1: proxy_pass http://gateways
    G1-->>N: 200, hostname do gateway-1
    N-->>C: 200
    C->>N: requisição 2
    N->>G2: o próximo peer
    G2-->>N: 200, hostname do gateway-2
    N-->>C: 200
    C->>N: requisição 3
    N->>G3: o próximo peer
    G3-->>N: 200, hostname do gateway-3
    N-->>C: 200
    Note over C,G3: a requisição 4 volta ao gateway-1
```

!!! info "Trocando o algoritmo"

    O algoritmo é declarado dentro do bloco `upstream`; o arquivo acima não declara nenhum, então usa Round Robin. Para trocá-lo, adicione uma das linhas a seguir antes da entrada `server`:

    | Diretiva | Algoritmo |
    |---|---|
    | _(nenhuma)_ | Round Robin (padrão) |
    | `least_conn;` | Least Connections |
    | `ip_hash;` | IP Hash (sessões fixas) |
    | `random;` | Random |

    O Weighted Round Robin usa o parâmetro `weight` por servidor: `server gateway:8080 weight=3;`

!!! warning "Resolução de DNS e escalonamento dinâmico"

    O Nginx resolve o hostname `gateway` **uma única vez na inicialização** e guarda em cache a lista de IPs retornada. Subir a stack com um número fixo de réplicas (definido no `compose.yaml`) garante que o Nginx encontre todas as instâncias ao iniciar. Se réplicas forem adicionadas depois, o Nginx precisa ser recarregado para descobri-las:

    ``` { .bash .copy .select }
    docker compose exec lb nginx -s reload
    ```

``` mermaid-sim
sequenceDiagram
    participant N as lb, Nginx
    participant D as DNS do Docker
    participant Co as docker compose
    N->>D: resolve gateway, na inicialização
    D-->>N: 3 IPs, então 3 peers
    Co->>D: up -d --scale gateway=5
    Note over N: ainda 3 peers, as réplicas 4 e 5 não recebem tráfego
    N->>D: nginx -s reload resolve gateway de novo
    D-->>N: 5 IPs, então 5 peers
```

A estrutura resultante do projeto, depois de adicionar o arquivo de configuração:

``` tree
api/
    setup/
        nginx.conf
    account/
    account-service/
    auth/
    auth-service/
    gateway-service/
    compose.yaml
    .env
```
