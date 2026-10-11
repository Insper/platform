O Nginx é configurado como um [proxy reverso HTTP](https://nginx.org/en/docs/http/ngx_http_proxy_module.html){target="_blank"} usando um bloco `upstream` que define o pool de servidores de backend. Quando o Docker Compose sobe várias réplicas do serviço `gateway`, o DNS interno do Docker resolve o nome de serviço `gateway` para os endereços IP de todas as réplicas. O Nginx consulta esse registro DNS na inicialização e monta o seu pool upstream com todos os endereços retornados.

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
