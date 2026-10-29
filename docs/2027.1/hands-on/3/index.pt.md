!!! abstract "Neste lab"

    - Rodar **três réplicas** do `catalog` e colocar o **Nginx** na frente delas como a **borda** do BoxOffice: proxy reverso, balanceador de carga, rate limiter.
    - Ver a carga se espalhar pelas réplicas, matar e congelar réplicas, e ver o que fazem os **health checks passivos**, os **timeouts** e os **retries**.
    - Limitar um cliente de API guloso com **rate limiting** (HTTP 429).
    - **Medir** o scale-out: throughput e p99 com 1 réplica contra 3. Fica 3× melhor?

No lab 2 você encontrou o joelho de uma única instância do `catalog`. O jeito mais simples de deslocá-lo é a **escala horizontal**: mais cópias idênticas e *stateless* do serviço atrás de um balanceador de carga. A mesma caixa resolve um segundo problema — com uma instância, uma queda ou um deploy derruba o BoxOffice. Com três, uma pode falhar enquanto as outras continuam atendendo. Este lab constrói a **borda** do sistema: a única porta de entrada pública que toda requisição atravessa primeiro.

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 2–3 horas |
| **Você precisa de** | as ferramentas do lab 0; Docker com pelo menos **6 GB** (três JVMs + PostgreSQL + Nginx); **a porta 80 livre** na sua máquina |
| **Diretório** | todo comando roda na raiz do seu repositório `boxoffice/` (Windows: dentro do WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Estado inicial** — o fim do lab 2:

``` { .tree title="boxoffice/ at the start of lab 3" }
boxoffice/
    docker-compose.yaml        # db + catalog
    load/  hello.js smoke.js load.js stress.js
    results/  lab0.md lab1.md lab2.md lab2/ ...
    scripts/  check-env.sh sweep.sh summarize.py watch-metrics.sh
    services/catalog/
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 2? Baixe [boxoffice-after-lab-2.zip](../2/boxoffice-after-lab-2.zip), descompacte e `cd boxoffice`. Este lab **acrescenta** `InstanceHeaderFilter.java` e `infra/nginx/nginx.conf` e **substitui** o `docker-compose.yaml`; os três aparecem completos abaixo e estão em [`code/`](code/docker-compose.yaml).

## Slides

<div class="slides-embed">
  <iframe src="slides/edge.html" title="Slides: hands-on 3 — borda" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/edge.html){:target="_blank"}

!!! info "Conexão com a teoria"

    - Na [história da disciplina](../../index.md#story), este lab constrói o capítulo 4: os primeiros saltos da [jornada da requisição](../../classes/edge/index.md#the-request-journey), com as decisões do [Nginx como balanceador de carga](../../classes/edge/load-balancing/index.md#nginx), dos [health checks](../../classes/edge/load-balancing/index.md#health-checks) e do [rate limiting](../../classes/edge/api-gateway/index.md#rate-limiting).
    - Aula 4, [Tráfego e borda](../../classes/edge/index.md): [balanceamento de carga](../../classes/edge/load-balancing/index.md) (L4 vs L7, algoritmos, health checks) e [API gateway](../../classes/edge/api-gateway/index.md) (algoritmos de rate limiting).
    - Aula 5, [Computação](../../classes/compute/services/index.md): por que só serviços **stateless** escalam horizontalmente com essa facilidade.
    - Catálogo de componentes: [Load Balancer](../../reference/components/edge/index.md#lb).

## Antes de medir: o playground { #before-you-measure-the-playground }

**Experimente:** o cenário `scale-out` tem um balanceador de carga na frente de réplicas da aplicação. Rode-o com as réplicas padrão, depois mude o número de servidores de aplicação (1 → 2 → 4) e compare throughput e p99. Por fim, mate uma réplica enquanto a carga roda: quanto tempo até o balanceador parar de mandar tráfego para ela? Anote as suas previsões para o sistema real — 3× as réplicas dá 3× o throughput?

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="500"></div>

## O que você vai construir { #what-you-will-build }

``` diagram-sim
flowchart LR
    k6([k6 / fãs]) -->|":80"| edge["edge<br/>Nginx 1.30"]
    edge -->|round robin| c1["catalog-1<br/>1 CPU"]
    edge --> c2["catalog-2<br/>1 CPU"]
    edge --> c3["catalog-3<br/>1 CPU"]
    c1 --> db[("db<br/>PostgreSQL")]
    c2 --> db
    c3 --> db
```

Só a borda publica uma porta (80). As réplicas só são alcançáveis dentro da rede do Compose — o mesmo formato de um balanceador de carga público na frente de instâncias privadas numa VPC na nuvem (aula 12).

## 1. Torne as réplicas visíveis { #1-make-the-replicas-visible }

Quando três réplicas respondem, você quer saber **qual** respondeu. Acrescente este filtro ao `catalog`; ele carimba toda resposta com o hostname do container:

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/InstanceHeaderFilter.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/3/code/services/catalog/src/main/java/boxoffice/catalog/InstanceHeaderFilter.java"
```

Essa é a única mudança de código deste lab. Todo o resto é configuração — um bom sinal: um serviço stateless escala horizontalmente sem mexer no código.

## 2. Três réplicas no Compose { #2-three-replicas-in-compose }

Substitua o seu `docker-compose.yaml`. O bloco `x-catalog` é uma **âncora YAML**: uma definição, reaproveitada por `catalog-1`, `catalog-2` e `catalog-3`; cada um só acrescenta o próprio `hostname`.

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/3/code/docker-compose.yaml"
```

| Mudança | Por quê |
|---|---|
| `catalog` → `catalog-1..3` | réplicas explícitas: você pode parar, pausar ou inspecionar **uma** delas pelo nome |
| nenhum `ports:` nas réplicas | elas são privadas; a única porta é a borda |
| a mesma `image: boxoffice-catalog` | construída uma vez, iniciada três vezes |
| `edge` publica `80:80` | daqui em diante, `BASE_URL=http://localhost` |

!!! warning "Três réplicas, um banco"

    As três réplicas compartilham o `db`, e cada uma tem o seu pool de 10 conexões: 30 conexões no total. Escalar a camada stateless multiplica a carga na camada stateful. Deixe o `docker stats` aberto: se o `db` chegar a 100% de CPU, acrescentar réplicas não vai ajudar — esse é o problema do lab 6.

## 3. A borda: `nginx.conf` { #3-the-edge-nginxconf }

O Nginx[^1] lê um arquivo de configuração. Toda diretiva abaixo aparece nele, na mesma ordem.

``` { .nginx title="infra/nginx/nginx.conf" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf"
```

| Diretiva | O que faz |
|---|---|
| `upstream catalog { server ...; }` | o pool de réplicas; o algoritmo padrão é **round robin** |
| `resolve` + `resolver 127.0.0.11` + `zone` | o Nginx resolve os nomes de novo pelo DNS do Docker: ele sobe mesmo com uma réplica fora do ar e a retoma quando ela volta (Nginx open source ≥ 1.27.3) |
| `max_fails=3 fail_timeout=10s` | **health check passivo**: 3 falhas em 10 s tiram a réplica do rodízio por 10 s |
| `keepalive 64` + `proxy_http_version 1.1` + `Connection ""` | reaproveita conexões TCP com as réplicas em vez de abrir uma por requisição |
| `proxy_next_upstream error timeout http_502 http_503 http_504` | se uma réplica falha, **repete a requisição em outra** (só para métodos idempotentes, como GET) |
| `proxy_connect_timeout 1s`, `proxy_read_timeout 5s` | quanto esperar antes de declarar que uma réplica falhou |
| `X-Request-Id $request_id` | um id único por requisição, enviado à réplica e de volta ao cliente: o primeiro passo rumo ao tracing (lab 8) |
| `limit_req_zone $http_x_api_key ... rate=20r/s` | **rate limiting** por chave de API, parecido com um token bucket (passo 6) |
| `location / { return 404; }` | só `/catalog/` é público; `/actuator` não é alcançável de fora |

## 4. Rode e observe a distribuição { #4-run-it-and-watch-the-distribution }

``` { .bash .copy }
docker compose up --build -d --remove-orphans   # removes the old single 'catalog' container of lab 1
docker compose ps                       # catalog-1..3 healthy, edge running
curl -s localhost/healthz               # the edge itself
for i in $(seq 1 9); do curl -s -o /dev/null -D - localhost/catalog/events/1 | grep -i x-instance; done | sort | uniq -c
```

<!-- termynal -->
``` shell
> for i in $(seq 1 9); do curl -s -o /dev/null -D - localhost/catalog/events/1 | grep -i x-instance; done | sort | uniq -c
   3 X-Instance: catalog-1
   3 X-Instance: catalog-2
   3 X-Instance: catalog-3
> docker compose logs edge --tail 3
edge-1  | 172.18.0.1 "GET /catalog/events/1 HTTP/1.1" 200 rt=0.004 upstream=172.18.0.4:8082 ut=0.004 id=6f1c0d8e2b...
edge-1  | 172.18.0.1 "GET /catalog/events/1 HTTP/1.1" 200 rt=0.003 upstream=172.18.0.5:8082 ut=0.003 id=0a77c4f9e1...
edge-1  | 172.18.0.1 "GET /catalog/events/1 HTTP/1.1" 200 rt=0.003 upstream=172.18.0.3:8082 ut=0.003 id=d93b5e2a7c...
```

Round robin: cada réplica recebe uma de cada três requisições. Compare `rt` (o tempo total na borda) com `ut` (o tempo gasto na réplica): a diferença é o custo do salto extra.

!!! tip "Round robin ou least connections?"

    O round robin ignora o quanto cada réplica está ocupada. Descomente `least_conn;` no upstream, rode `docker compose exec edge nginx -s reload` e repita a medição do passo 7: com uma mistura de requisições rápidas (detalhe) e lentas (listagem), o `least_conn` costuma aparar a cauda, porque uma réplica presa a requisições lentas recebe menos requisições novas.

## 5. Falhas: parar, congelar, recuperar { #5-failures-stop-freeze-recover }

Rode uma carga constante num terminal e quebre coisas em outro:

``` { .bash .copy }
# terminal 1: 2 minutes at 150 req/s through the edge
BASE_URL=http://localhost k6 run -e RATE=150 -e DURATION=2m load/load.js

# terminal 2, while it runs:
docker compose stop catalog-2          # a crash: connections are refused immediately
sleep 20
docker compose start catalog-2         # it comes back (startup takes ~10 s)
sleep 30
docker compose pause catalog-3         # a freeze (GC pause, stuck disk): connections hang
sleep 20
docker compose unpause catalog-3
```

O que procurar no resumo do k6 e em `docker compose logs edge`:

| Falha | O que o Nginx vê | O que o cliente vê |
|---|---|---|
| **stop** (processo morto) | `connect() failed (111: Connection refused)` → retry imediato em outra réplica | quase nada: alguns milissegundos a mais |
| **pause** (processo congelado) | a conexão abre mas não há resposta: ele espera `proxy_read_timeout` (5 s) e então faz retry | uma rajada de requisições que levam **~5 s** — o p99 explode, mas sem erros |
| **depois de 3 falhas** | `max_fails` atingido → réplica fora do rodízio por `fail_timeout` (10 s) | a latência volta ao normal |

Você deve ver algo assim no fim da execução do k6 (uma execução deste lab: nenhum erro, mas a pausa aparece na cauda):

``` { .text }
    http_req_duration..............: avg=48.31ms med=1.33ms p(95)=25.56ms p(99)=1s       max=5.05s
    http_req_failed................: 0.00%  0 out of 14990
```

A lição: uma réplica **morta** é fácil; uma **lenta** é perigosa. Os timeouts decidem quanto uma réplica lenta custa. O Nginx open source só tem checks *passivos*[^2] (ele aprende com requisições reais que falharam); checks ativos — sondar `/actuator/health/readiness` a cada poucos segundos — existem no Nginx Plus, no HAProxy, no Envoy, nos balanceadores de carga da nuvem e nas readiness probes do Kubernetes (lab 10).

??? question "Pense antes: por que não colocar `proxy_read_timeout 100ms`, para que réplicas congeladas sejam detectadas na hora?"

    Porque algumas requisições legítimas são lentas: uma listagem sob carga leva centenas de milissegundos. Um timeout menor que o p99 real transforma respostas lentas em falhas e *retries* — que acrescentam carga justamente quando o sistema está sofrendo (uma retry storm, aula 10). Os timeouts precisam ser definidos a partir da latência **medida**: um pouco acima do p99,9 do serviço saudável.

## 6. Rate limiting

Uma integração de parceiro que consulta o `catalog` 50 vezes por segundo pode deixar todo mundo sem atendimento. A borda dá a cada **chave de API** 20 req/s com uma rajada de 40; acima disso, responde `429 Too Many Requests` sem incomodar as réplicas.

``` { .javascript title="load/ratelimit.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/3/code/load/ratelimit.js"
```

``` { .bash .copy }
k6 run load/ratelimit.js
```

Você deve ver (de uma execução deste lab — 30 s a 50 e a 10 req/s):

``` { .text }
    http_reqs{scenario:greedy,status:200}
    ✓ 'count>=0' count=640
    http_reqs{scenario:greedy,status:429}
    ✓ 'count>=0' count=843
    http_reqs{scenario:polite,status:200}
    ✓ 'count>=0' count=299
    http_reqs{scenario:polite,status:429}
    ✓ 'count>=0' count=0
```

Formato esperado (as contagens variam): o cliente `polite` (10 req/s) só recebe `200`; o `greedy` (50 req/s) recebe cerca de 20 `200` por segundo e o resto `429`. O Nginx implementa um **leaky bucket**: as requisições escoam a `rate`; `burst` é o tamanho do balde; `nodelay` atende a rajada imediatamente em vez de espaçá-la.

!!! warning "Quem é o cliente?"

    Aqui a chave é um cabeçalho que o cliente escolhe, então um cliente malicioso poderia simplesmente trocar de chave. Sistemas reais limitam por uma identidade **autenticada** (uma chave de API emitida e verificada, o id do usuário num JWT — lab 4) e também por IP para tráfego anônimo. No lab não limitamos por IP porque toda requisição do k6 vem do mesmo endereço: os testes de carga se estrangulariam.

## 7. Meça: 3× as réplicas dá 3× o throughput? { #measure-it }

Use a varredura do lab 2, agora pela borda, com **duas cargas diferentes** — a resposta depende de qual recurso é o gargalo:

- **Só detalhes** (`LIST_SHARE=0`): buscas por chave primária, baratas para o PostgreSQL. O limite é a **CPU de cada réplica** (1 núcleo).
- **A mistura do lab 2** (`LIST_SHARE=0.2`): 20% de listagens, cada uma varrendo e ordenando milhares de linhas. O limite é o **PostgreSQL**, que todas as réplicas compartilham.

Primeiro com **uma** réplica (pare as outras duas; o Nginx as remove), depois com **três**:

``` { .bash .copy }
# 1 replica behind the edge
docker compose stop catalog-2 catalog-3
LIST_SHARE=0 BASE_URL=http://localhost OUT=results/lab3-1replica-detail bash scripts/sweep.sh 300 600 900 1200 1500
BASE_URL=http://localhost OUT=results/lab3-1replica-mix bash scripts/sweep.sh 100 200 300 400 500

# 3 replicas behind the edge: start them and WARM THEM UP before measuring
docker compose start catalog-2 catalog-3 && sleep 30
BASE_URL=http://localhost k6 run -e RATE=300 -e DURATION=2m load/load.js > /dev/null
LIST_SHARE=0 BASE_URL=http://localhost OUT=results/lab3-3replicas-detail bash scripts/sweep.sh 600 1200 1800 2400 3000
BASE_URL=http://localhost OUT=results/lab3-3replicas-mix bash scripts/sweep.sh 100 200 300 400 500

for d in results/lab3-*; do echo "## $d"; uv run scripts/summarize.py $d/rate-*.json; done
```

Deixe o `docker stats` aberto durante cada execução e anote **qual container está no limite**: `catalog-*` perto de 100% (um núcleo cada) ou o `db` usando vários núcleos.

!!! warning "Réplicas frias e health checks passivos podem entrar em cascata"

    Uma réplica que acabou de subir roda com uma JVM fria e é várias vezes mais lenta que uma aquecida. Sob carga pesada ela estoura o timeout, o Nginx a marca como falha (`max_fails`), a sua parte do tráfego passa para as outras, *elas* também estouram o timeout, e a borda acaba respondendo `502 no live upstreams` — enquanto as réplicas estão perfeitamente saudáveis. Sempre aqueça réplicas novas antes de medir; em produção é para isso que servem o **slow start** (aumentar aos poucos o peso de uma instância nova) e readiness probes que esperam o aquecimento.

Registre em `results/lab3.md`:

``` { .markdown title="results/lab3.md" .copy }
# Lab 3 — scale-out behind the edge

## Sweeps
<the four tables from summarize.py: 1/3 replicas × detail/mix>

## Capacity (highest rate with p99 < 300 ms and no errors)
| Workload | Replicas | Capacity (req/s) | Container at its limit (docker stats) |
|---|---:|---:|---|
| details only | 1 | | |
| details only | 3 | | |
| lab 2 mix | 1 | | |
| lab 2 mix | 3 | | |

Scaling efficiency = capacity(3) / (3 × capacity(1)):
- details only: ____ %
- lab 2 mix: ____ %
- Why are they so different? ____

## Edge overhead
- p50 direct to catalog (lab 2, same rate): ____ ms; p50 through the edge: ____ ms

## Failures (step 5)
- stop catalog-2: errors ____, p99 ____ ms
- pause catalog-3: errors ____, p99 ____ ms; how long until Nginx stopped sending it traffic? ____ s

## Rate limiting (step 6)
| Client | Sent | 200 | 429 |
|---|---:|---:|---:|
| greedy (50 req/s) | | | |
| polite (10 req/s) | | | |
```

??? question "Pense antes: por que a eficiência pode ser boa para os detalhes e perto de zero (ou pior) para a mistura?"

    Só com detalhes, cada requisição custa principalmente **CPU da réplica**, então três réplicas trazem três núcleos do recurso que estava saturado: a eficiência é alta (abaixo de 100% porque a borda, o k6 e o Docker dividem o mesmo notebook). Com a mistura, o recurso saturado é o **PostgreSQL**: numa execução de teste deste lab, o `db` ficou em ~670% de CPU enquanto cada réplica usava ~20%. Três réplicas só mandam *mais* consultas pesadas *simultâneas* para o mesmo banco — 30 conexões no pool em vez de 10 — e a latência pode até piorar. Escalar a camada stateless só ajuda quando a camada stateless é o gargalo; senão, a pressão passa para a camada stateful compartilhada. A [Universal Scalability Law](../../classes/estimation/queueing/index.md) modela isso: a contenção faz o throughput crescer mais devagar que o número de nós, ou até cair. Os labs 5 (cache) e 6 (índices) atacam o gargalo real.

!!! note "Se os seus números forem diferentes"

    A razão importa mais que os valores absolutos. Espere um ganho grande na carga só de detalhes (cada réplica traz o seu núcleo) e pouco ou nenhum na mistura (o PostgreSQL é compartilhado). Se nem a carga só de detalhes melhorar, olhe o `docker stats`: se as réplicas estão longe de 100% de CPU, outra coisa é o limite — o total de CPUs do Docker, o próprio k6 ou outro programa na sua máquina. Um notebook é uma máquina fingindo ser várias; os números de produção seriam outros, o raciocínio não.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| `Bind for 0.0.0.0:80 failed: port is already allocated` (ou `permission denied`) | outro servidor web usa a porta 80, ou o seu sistema restringe portas < 1024 | pare-o, ou publique a borda na 8000 (`"8000:80"`) e use `BASE_URL=http://localhost:8000` em todo lugar |
| `Found orphan containers ([boxoffice-catalog-1])` | o serviço `catalog` único do lab 1 ainda existe | `docker compose up -d --remove-orphans` |
| todas as requisições devolvem `502 Bad Gateway` logo depois do `up` | as réplicas ainda estão subindo (≈20–40 s) | espere até `docker compose ps` mostrar as três réplicas `healthy` |
| `no live upstreams` em `docker compose logs edge`, 502 sob carga | todas as réplicas foram marcadas como falhas (timeouts na sobrecarga, muitas vezes JVMs frias) | baixe a carga, aqueça, confira `max_fails`/`proxy_read_timeout`; veja o aviso do passo 7 |
| `nginx: [emerg] ... in /etc/nginx/nginx.conf:NN` | erro de digitação na configuração | `docker compose exec edge nginx -t` mostra a linha; corrija e rode `docker compose exec edge nginx -s reload` (ou `docker compose restart edge`) |
| falta o `X-Instance` | a imagem do catalog não foi reconstruída com o novo filtro | `docker compose up --build -d` |
| o teste de rate limit não mostra nenhum `429` | o k6 não mandou `X-Api-Key`, ou o `nginx.conf` antigo está montado | confira o conteúdo do arquivo dentro do container: `docker compose exec edge cat /etc/nginx/nginx.conf` |

!!! success "Boas práticas neste lab"

    - **Publique uma única porta e mantenha as réplicas privadas** — nenhum `ports:` em `catalog-1..3` no `docker-compose.yaml`, e `location / { return 404; }` no `nginx.conf` ([Tráfego e borda — proxies reversos](../../classes/edge/index.md#reverse-proxies)).
    - **Detecte falhas e só faça retry do que é seguro** — `max_fails=3 fail_timeout=10s` e `proxy_next_upstream` no `nginx.conf`; o Nginx não repete um `POST` ([Balanceamento de carga — health checks](../../classes/edge/load-balancing/index.md#health-checks)).
    - **Defina timeouts a partir da latência medida** — `proxy_connect_timeout 1s`, `proxy_read_timeout 5s`, acima do p99,9 saudável medido no lab 2 ([Balanceamento de carga — Nginx](../../classes/edge/load-balancing/index.md#nginx)).
    - **Marque toda requisição na borda** — `X-Request-Id $request_id` vai para a réplica e volta para o cliente, e entra no access log ao lado do upstream e do seu tempo ([Tráfego e borda](../../classes/edge/index.md)).
    - **Limite clientes gulosos com um `429` explícito** — `limit_req_zone … rate=20r/s` com `limit_req_status 429` protege as réplicas de um único cliente ([API gateway — rate limiting](../../classes/edge/api-gateway/index.md#rate-limiting)).

## Limpeza { #clean-up }

``` { .bash .copy }
docker compose start catalog-2 catalog-3     # if you left them stopped after the sweep
docker compose unpause catalog-3 2>/dev/null || true
docker compose down                          # when you are done (the database volume is kept)
```

Guarde tudo: o lab 4 coloca o gateway atrás desta borda.

## Entrega { #deliverable }

- [ ] O `InstanceHeaderFilter`, o `docker-compose.yaml` com três réplicas e o `infra/nginx/nginx.conf` no seu repositório.
- [ ] A verificação da distribuição (9 requisições, 3 por réplica) colada em `results/lab3.md`.
- [ ] O experimento de falhas (stop e pause) descrito com números.
- [ ] A tabela do rate limit.
- [ ] Varreduras com 1 e 3 réplicas para as duas cargas, as capacidades, a **eficiência de escala** de cada uma e o container no limite.
- [ ] Repositório com a tag `lab3`; [quiz](quiz.md) respondido.

## Estado final { #end-state }

``` { .tree title="changed in lab 3" }
boxoffice/
    docker-compose.yaml        # replaced: db, catalog-1..3 (no host ports), edge on port 80
    infra/nginx/nginx.conf     # new: reverse proxy, load balancer, rate limiter
    load/ratelimit.js          # new
    services/catalog/src/main/java/boxoffice/catalog/InstanceHeaderFilter.java   # new
    results/lab3.md  results/lab3-*/
```

Daqui em diante os clientes usam `http://localhost` (a borda); as réplicas não são alcançáveis a partir da sua máquina.

Próximo: [Lab 4 — Gateway e identidade](../4/index.md).

[^1]: Documentação do NGINX, [HTTP Load Balancing](https://nginx.org/en/docs/http/load_balancing.html){target="_blank"}, [ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html){target="_blank"} e [ngx_http_limit_req_module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html){target="_blank"}.
[^2]: Betsy Beyer et al., *Site Reliability Engineering*, O'Reilly, 2016 — capítulo 20, "Load Balancing in the Datacenter".
