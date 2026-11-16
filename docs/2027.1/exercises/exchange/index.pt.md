O próximo *on-sale* do BoxOffice é uma turnê internacional e os fãs do exterior querem ver o preço do assento na própria moeda. A taxa vem de um provedor que não é do BoxOffice, igual ao provedor de pagamento do capítulo 10: ele publica poucas vezes por dia, pode ficar lento ou fora do ar e alguns provedores gratuitos recusam requisições vindas de um endereço de nuvem. Neste exercício **opcional** você pega um serviço de câmbio pronto, coloca-o num contêiner, atrás do gateway, e depois prova com números quanto o cache dele poupa o provedor e o que os fãs veem quando o provedor some.

!!! objectives "Objetivos de aprendizagem"

    Ao final deste exercício você será capaz de:

    - **Conteinerizar** um serviço Python gerenciado pelo uv, com um arquivo de *lock* e uma ordem de camadas que mantém os *rebuilds* rápidos.
    - **Integrar** um novo serviço à pilha do Compose do BoxOffice e atrás da autenticação do gateway.
    - **Isolar** o tráfego de saída de um serviço com redes do Docker e cortá-lo para simular uma queda do provedor.
    - **Medir** quantas chamadas um cache poupa a um provedor externo e o que um *fallback* com taxa vencida entrega aos fãs durante uma queda.

## Contexto { #context }

A [aula 7](../../classes/caching/index.md) mostrou o *cache-aside* e o *stampede* de uma chave vencida; a [aula 10](../../classes/reliability/index.md) mostrou o que uma dependência lenta faz com quem a chama e como *timeouts* e *fallbacks* contêm isso. O [lab 4](../../hands-on/4/index.md) construiu o gateway, o [lab 5](../../hands-on/5/index.md) o cache e o [lab 9](../../hands-on/9/index.md) quebrou de propósito o provedor de pagamento. Aqui o provedor é real: a **PTAX** do Banco Central do Brasil (BCB), encapsulada pelo [serviço de câmbio](service/index.md), que é dado pronto. **A sua parte é o contêiner, a integração e as medições.**

``` diagram-sim
flowchart LR
    k6([k6]) -->|"GET /exchange/USD/EUR + token"| edge[edge]:::tech
    edge --> gateway[gateway]:::comp
    gateway -->|"exchange-net (interna)"| exchange[exchange]:::comp
    exchange -->|"egress · só num miss"| ptax[(PTAX · BCB)]:::problem
```

O serviço responde toda taxa com o header `X-Cache`: `miss` quando chamou a PTAX, `hit` quando a taxa veio da memória e `stale` quando a PTAX falhou e uma taxa vencida foi servida. É esse header que você conta.

## Tarefa { #task }

1. Copie o [serviço de câmbio](service/index.md) para `services/exchange/` e escreva o seu **Dockerfile**.
1. Adicione `exchange` ao `compose.yaml` em duas redes: uma **interna** compartilhada com o gateway e uma de **egress** para a internet.
1. Adicione a rota do gateway `/exchange/**`, atrás da autenticação.
1. **E1, cache:** rode o script do k6 a 100 requisições/s e conte as chamadas que chegaram à PTAX, com `CACHE_SECONDS` em 300 e em 30.
1. **E2, queda:** durante uma execução do k6, corte a rede de egress do serviço por 2 minutos e meça o que os fãs receberam.
1. **E3, partida a frio numa queda:** reinicie o serviço com o egress cortado e explique o resultado.

## Requisitos { #requirements }

- [ ] **(obrigatório)** `services/exchange/Dockerfile` gera uma imagem que sobe com `docker compose up` e responde `GET /health`; dependências instaladas por `uv sync --frozen` a partir do `uv.lock` versionado.
- [ ] **(obrigatório)** `exchange` **não publica porta** e só é alcançável pelo gateway; `GET /exchange/USD/EUR` sem token responde `401` e com token responde `200`.
- [ ] **(obrigatório)** Os resultados de E1 e E2 vêm das suas execuções: resumo do k6 com as contagens de `exchange_cache` por resultado, `http_req_failed` e os percentis de latência.
- [ ] Camadas da imagem ordenadas para que uma mudança no `main.py` não reinstale as dependências (mostre a saída do segundo build).
- [ ] *Health check* do contêiner em `/health` e a imagem roda com um usuário não root.
- [ ] E1: o número de `miss` previsto antes da execução (moedas × janelas de `CACHE_SECONDS`) e comparado com o medido, para as duas configurações.
- [ ] E2: erros e a contagem de `stale` durante o corte, latência p95/p99 antes, durante e depois, e o momento em que a PTAX voltou a ser chamada depois da reconexão.
- [ ] E3: o que os fãs recebem depois do *restart*, por quê, e uma mudança que resolveria (com o seu custo).
- [ ] Seção *Uso de IA* (veja a [política](../index.md#use-of-ai-tools)).

## Entregáveis { #deliverables }

No seu repositório (tag `ex8`): `services/exchange/` com o Dockerfile e o `uv.lock`, as mudanças no `compose.yaml` e no gateway, `load/exchange.js`, as saídas do k6; uma página `exchange` no seu site de documentação seguindo o [template](#templates).

## Passo a passo { #step-by-step }

### 1. O serviço { #1-the-service }

Crie `services/exchange/` com `pyproject.toml` e `main.py` da [página do serviço](service/index.md) e então, nessa pasta:

``` { .bash .copy }
uv lock
uv run uvicorn main:app --port 8000
```

Você deve ver `x-cache: miss` e depois `x-cache: hit` com `curl -i localhost:8000/exchange/USD/EUR` duas vezes. Pare-o (++ctrl+c++).

### 2. O Dockerfile { #2-the-dockerfile }

Escreva `services/exchange/Dockerfile`. O que ele deve fazer:

- partir de `python:3.12-slim` e copiar o binário `uv` de `ghcr.io/astral-sh/uv`[^1];
- copiar `pyproject.toml` e `uv.lock` **antes** do `main.py` e rodar `uv sync --frozen --no-dev`, para que uma mudança no código reaproveite a camada de dependências;
- rodar com um usuário não root e iniciar `uvicorn main:app` em `0.0.0.0:8000`.

Na raiz do repositório:

``` { .bash .copy }
docker build -t boxoffice-exchange services/exchange
docker run --rm -p 8000:8000 boxoffice-exchange
```

Você deve ver `Uvicorn running on http://0.0.0.0:8000` e o mesmo par `miss`/`hit` do passo 1. Mude um comentário no `main.py` e construa de novo: o passo `uv sync` deve dizer `CACHED`.

### 3. Compose: duas redes { #3-compose-two-networks }

A saída para a internet fica numa rede própria para que você possa cortá-la sem cortar o gateway. Uma rede do Compose com `internal: true` não tem rota para fora do host: o gateway chega ao `exchange` por ela e a PTAX só é alcançável pela `egress`.

```yaml title="compose.yaml (excerpt)"
services:
  gateway:
    # ...everything the gateway already has, plus:
    networks: [default, exchange-net]
    environment:
      EXCHANGE_URL: http://exchange:8000

  exchange:
    build: ./services/exchange
    networks: [exchange-net, egress]
    environment:
      CACHE_SECONDS: ${EXCHANGE_CACHE_SECONDS:-300}
      RETRY_SECONDS: 30
      PTAX_TIMEOUT: 3
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

networks:
  exchange-net:
    internal: true
  egress: {}
```

``` { .bash .copy }
docker compose up -d --build exchange gateway
docker compose ps exchange
```

Você deve ver `exchange` como `running` (e `healthy` quando o seu *health check* passar), sem porta na coluna `PORTS`.

### 4. A rota do gateway { #4-the-gateway-route }

Adicione a rota em `services/gateway/src/main/resources/application.yaml`, ao lado das outras:

```yaml title="application.yaml (excerpt)"
            - id: exchange
              uri: ${EXCHANGE_URL:http://exchange:8000}
              predicates:
                - Path=/exchange/**
```

O `SecurityConfig` não precisa mudar: um caminho que nenhuma regra libera cai em `anyExchange().authenticated()`. Reconstrua o gateway e verifique os dois lados:

``` { .bash .copy }
docker compose up -d --build gateway
curl -s -o /dev/null -w "%{http_code}\n" localhost/exchange/USD/EUR        # no token
TOKEN=$(curl -s localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<your fan>","password":"<password>"}' | jq -r .accessToken)
curl -i localhost/exchange/USD/EUR -H "Authorization: Bearer $TOKEN"
```

Você deve ver `401` na primeira requisição e `200` com `x-cache` na segunda.

### 5. E1: o que o cache poupa o provedor { #5-e1-what-the-cache-saves-the-provider }

Salve o script como `load/exchange.js`. Ele faz login uma vez, pede cinco pares de moedas ao acaso e conta as respostas pelo `X-Cache`:

``` { .javascript .copy .select linenums="1" title="load/exchange.js" }
--8<-- "docs/2027.1/exercises/exchange/code/load/exchange.js"
```

Os pares usam quatro moedas além do BRL (USD, EUR, GBP, JPY), então uma execução de $T$ segundos deve chamar a PTAX cerca de $4 \times \lceil T / \text{CACHE\_SECONDS} \rceil$ vezes (a contagem de `miss` pode ser um pouco menor: uma requisição pode atualizar as suas duas moedas). Anote a previsão e então meça, na raiz do repositório:

``` { .bash .copy }
docker compose restart exchange                     # start from an empty cache
docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w \
  grafana/k6 run -e RATE=100 -e DURATION=2m load/exchange.js
EXCHANGE_CACHE_SECONDS=30 docker compose up -d exchange
docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w \
  grafana/k6 run -e RATE=100 -e DURATION=2m load/exchange.js
```

Você deve ver, na parte de *thresholds* do resumo, uma linha por resultado (`exchange_cache{result:hit}`, `…miss`, `…stale`, `…none`) com a sua contagem: cerca de 12.000 respostas e só alguns `miss`. Relate as duas execuções e os percentis de latência; explique as requisições mais lentas (veja pelo que um `miss` espera).

!!! danger "Não desligue o cache"

    `CACHE_SECONDS=0` mandaria duas chamadas à PTAX por requisição: 200 chamadas por segundo do seu endereço para um serviço público que a turma inteira compartilha. Estime esse número no relatório em vez de medi-lo.

### 6. E2: o provedor some { #6-e2-the-provider-goes-away }

Rode o k6 por 4 minutos com `CACHE_SECONDS=30` (para que as taxas vençam durante a queda) e, em outro terminal, corte o egress por volta de 1 minuto e restaure-o por volta de 3:

``` { .bash .copy }
EXCHANGE_CACHE_SECONDS=30 docker compose up -d exchange
docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w \
  grafana/k6 run -e RATE=100 -e DURATION=4m load/exchange.js
```

``` { .bash .copy }
sleep 60;  docker network disconnect boxoffice_egress "$(docker compose ps -q exchange)"; date
sleep 120; docker network connect boxoffice_egress "$(docker compose ps -q exchange)"; date
```

Você deve ver respostas `stale` durante o corte e nenhuma alta de `http_req_failed`. Para situar cada fase no tempo, acrescente `--out csv=results/e2.csv` ao k6 e faça o gráfico dos pontos de `exchange_cache` por resultado e da latência por janela de 10 s. Marque as duas linhas do `date` no gráfico.

### 7. E3: partida a frio durante a queda { #7-e3-a-cold-start-during-the-outage }

Com o egress cortado, reinicie o serviço e peça uma taxa:

``` { .bash .copy }
docker network disconnect boxoffice_egress "$(docker compose ps -q exchange)"
docker compose restart exchange
curl -i localhost/exchange/USD/EUR -H "Authorization: Bearer $TOKEN"
docker network connect boxoffice_egress "$(docker compose ps -q exchange)"
```

Você deve ver um `502`: o cache vivia na memória do processo que acabou de morrer. Veja também os logs do gateway: o filtro `Retry` dele repete uma vez um `GET` que falhou. Explique o que os fãs veriam numa queda real que coincidisse com um *deploy* e proponha uma correção (o Redis do lab 5, a última taxa gravada em disco, um segundo provedor…) com o que ela custa.

### 8. Na nuvem (opcional, conta para A) { #8-in-the-cloud-optional-counts-for-a }

De um pod do seu cluster (lab 10) ou de uma instância EC2, rode `curl` uma vez na URL da PTAX e num dos provedores gratuitos que quiser e relate se cada um responde a partir de um endereço de nuvem.

## Templates

=== "English"

    ~~~markdown
    # Exercise 8 — Exchange service

    **Student:** <name> (<github-user>) · **Tag:** ex8 · **Date:** <yyyy-mm-dd>

    ## Summary
    ## Requirements checklist
    ## Setup
    Machine, Docker and k6 versions, how to reproduce.

    ## The container
    Dockerfile (with the reason of each layer), second build output, image size.

    ## Wiring
    compose.yaml excerpt, gateway route, the 401/200 check.

    ## E1 — calls saved
    | CACHE_SECONDS | requests | miss predicted | miss measured | p50 | p95 | p99 |

    ## E2 — outage
    Chart of answers by result and latency over time; errors during the cut.

    ## E3 — cold start
    What happened, why, the fix and its trade-off.

    ## AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Exercício 8 — Serviço de câmbio

    **Aluno(a):** <nome> (<usuário-github>) · **Tag:** ex8 · **Data:** <aaaa-mm-dd>

    ## Resumo
    ## Checklist de requisitos
    ## Ambiente
    Máquina, versões do Docker e do k6, como reproduzir.

    ## O contêiner
    Dockerfile (com o motivo de cada camada), saída do segundo build, tamanho da imagem.

    ## Integração
    Trecho do compose.yaml, rota do gateway, o teste 401/200.

    ## E1 — chamadas economizadas
    | CACHE_SECONDS | requisições | miss previstos | miss medidos | p50 | p95 | p99 |

    ## E2 — queda
    Gráfico das respostas por resultado e da latência no tempo; erros durante o corte.

    ## E3 — partida a frio
    O que aconteceu, por quê, a correção e o seu custo.

    ## Uso de IA
    ~~~

## Rubrica { #rubric }

Níveis conforme definidos em [Como os exercícios são avaliados](../index.md#how-the-exercises-are-graded).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Contêiner **(obrigatório)** | Não constrói | Constrói, mas sem *lock* ou com `pip install` | `uv sync --frozen`, camadas em ordem, *health check*, não root | Cada linha justificada; o segundo build mostra a camada em cache | Tamanho da imagem reduzido e medido (ex.: *multi-stage*, `--no-cache`, `.dockerignore`) |
| Integração **(obrigatório)** | Não alcançável | Porta publicada ou rota aberta sem token | Sem porta, duas redes, 401 sem token e 200 com | Explica por que a rede interna não tem saída | O mesmo isolamento mostrado no Kubernetes (NetworkPolicy) |
| E1 **(obrigatório)** | Sem dados | Só capturas de tela | As duas configurações medidas, contagens relatadas | Previsão bate com o medido ou a diferença é explicada | Requisições mais lentas ligadas aos *misses* com evidência |
| E2 | — | Não feito | Corte e restauração feitos, erros e *stale* contados | Gráfico no tempo com as fases marcadas | Compara com outro valor de `RETRY_SECONDS` ou com um provedor lento (não morto) |
| E3 e comunicação | — | Ausente | Resultado explicado | Correção proposta com o seu custo | Correção implementada e E3 repetido sem o `502` |

## FAQ

??? question "A primeira chamada responde `502`."

    A PTAX não respondeu dentro de `PTAX_TIMEOUT`: verifique a rede de egress (`docker network inspect boxoffice_egress`) e rode `curl` na URL da PTAX a partir da sua máquina. O BCB tem janelas curtas de manutenção; tente de novo em alguns minutos.

??? question "`docker network disconnect` diz que a rede não existe."

    O Compose prefixa as redes com o nome do projeto, que é o nome da pasta. Rode `docker network ls | grep egress` e use o nome que ele mostrar.

??? question "As taxas não mudaram a tarde toda."

    A PTAX publica os boletins entre cerca de 10h e 13h (Brasília) em dias úteis. Depois do último boletim a taxa é a mesma até a manhã seguinte; o campo `date` diz qual boletim você recebeu.

??? question "Toda resposta no k6 é `none`."

    As requisições estão falhando antes de chegar ao serviço: veja os códigos de status (`401`: o login no `setup` falhou; `404`: falta a rota no gateway).

??? question "Posso usar outro provedor em vez da PTAX?"

    Pode: troque a chamada à PTAX em `_refresh` e mantenha o cache, o *lock*, o *timeout* e o header. Diga qual provedor usou e confira os termos de uso dele para requisições automatizadas.

[^1]: [Usando o uv no Docker](https://docs.astral.sh/uv/guides/integration/docker/){target="_blank"}.
