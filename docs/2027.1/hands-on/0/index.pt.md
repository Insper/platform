!!! abstract "Neste lab"

    - Instalar e verificar as ferramentas usadas em **todos** os labs: Docker + Compose, JDK 21, Maven, uv + Python 3.12, k6, kubectl, kind ou minikube, Git.
    - Criar **o seu repositório BoxOffice** com a estrutura que os próximos doze labs vão preencher.
    - Conhecer os **nomes de serviços, portas, variáveis de ambiente e convenções** que todos os labs compartilham.
    - **Medir** a sua máquina pela primeira vez: quantas requisições por segundo ela atende, e com que latência?

Durante o semestre você vai construir o **BoxOffice**, uma plataforma de venda de ingressos para shows, jogos e festivais. Ele começa como um pequeno serviço no seu notebook e cresce, lab após lab, até virar um sistema com proxy de borda, API gateway, cache, banco replicado, stream de eventos, observabilidade, Kubernetes e um assistente de IA. Cada lab acrescenta um componente da paleta do [System Design Playground](../../../playground/index.md), e **cada lab termina com uma medição**: projeto de sistemas é feito de trade-offs, e um trade-off só é real quando você consegue colocar um número nele.

Este primeiro lab é curto, mas importante: um ambiente quebrado custa horas depois, no meio de um teste de carga.

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 1–2 horas (a maior parte são downloads) |
| **Você precisa de** | um computador com **8 GB de RAM ou mais** (16 GB é confortável a partir do lab 4), ~20 GB livres em disco, direitos de administrador, acesso à internet |
| **Sistema operacional** | macOS, Linux ou Windows 10/11 com **WSL 2** (todo comando da disciplina roda em um shell Linux) |
| **Estado inicial** | nenhum: este lab cria o repositório `boxoffice/` a partir de uma pasta vazia |

!!! info "Primeiro lab"

    Não há nada para recuperar: todo lab seguinte começa do estado ao fim do anterior, e cada página de lab oferece um `boxoffice-after-lab-<n>.zip` pronto se você pular ou quebrar um lab.

## Slides

<div class="slides-embed">
  <iframe src="slides/environment.html" title="Slides: hands-on 0 — ambiente" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/environment.html){:target="_blank"}

## Aonde vamos chegar { #where-we-are-going }

O diagrama mostra o BoxOffice no fim do semestre. Não se preocupe com os detalhes: cada caixa tem o seu lab, e o número em cada rótulo diz qual.

``` diagram
flowchart LR
    user([Fã / k6]) --> edge["edge<br/>Nginx · lab 3"]
    edge --> gw["gateway<br/>lab 4"]
    gw --> auth["auth<br/>lab 4"]
    gw --> catalog["catalog ×3<br/>lab 1"]
    gw --> inventory["inventory<br/>lab 6"]
    gw --> order["order<br/>lab 7"]
    gw --> assistant["assistant<br/>lab 12"]
    catalog --> redis[("redis<br/>lab 5")]
    catalog --> db[("db<br/>PostgreSQL")]
    inventory --> pgb["pgbouncer<br/>lab 6"] --> db
    inventory --> replica[("db-replica<br/>lab 6")]
    order --> kafka[["kafka<br/>lab 7"]]
    kafka --> notification["notification<br/>lab 7"]
    order --> payment["payment<br/>lab 9"]
```

!!! info "Conexão com a teoria"

    Na [história da disciplina](../../index.md#story), este lab abre o capítulo 1: antes de qualquer design, um número — quantas requisições por segundo a *sua* máquina atende, o primeiro dos [requisitos mensuráveis](../../classes/intro/requirements/index.md) que todo lab seguinte confere.

    Este lab acompanha a aula 1, [O que é projeto de sistemas](../../classes/intro/index.md): a jornada de escala do BoxOffice, de um servidor a milhões de usuários, é exatamente o caminho que os labs seguem. A etapa "Meça" no fim se conecta com a aula 2, [Estimativas](../../classes/estimation/index.md).

## Serviços e portas do BoxOffice { #boxoffice-services-and-ports }

Todos os labs — e todos os projetos em equipe — usam os nomes abaixo. **Não os renomeie**: os arquivos de configuração, os scripts k6 e os próximos labs dependem deles. Um serviço escuta na **mesma porta dentro do container e na sua máquina**, então `http://catalog:8082` (a partir de outro container) e `http://localhost:8082` (a partir do seu terminal) chegam ao mesmo serviço.

**Serviços de aplicação** (uma pasta cada em `services/`):

| Serviço no Compose | Lab | Stack | Porta | Prefixo público de rota | Schema no BD | Papel |
|---|---|---|---|---|---|---|
| `edge` | 3 | Nginx 1.30 | **80** | — | — | proxy reverso, balanceador de carga, rate limiting: a única entrada pública a partir do lab 3 |
| `gateway` | 4 | Spring Cloud Gateway | **8080** | todos | — | roteamento, validação de JWT, cabeçalhos de identidade |
| `auth` | 4 | Spring Boot | **8081** | `/auth/**` | `auth` | usuários, login, emite JWTs (RS256) e publica o JWKS |
| `catalog` | 1 | Spring Boot | **8082** | `/catalog/**` | `catalog` | eventos e locais (muita leitura). Roda como `catalog-1`, `catalog-2`, `catalog-3` a partir do lab 3 |
| `inventory` | 6 | Spring Boot | **8083** | `/inventory/**` | `inventory` | assentos e reservas (fortemente consistente) |
| `order` | 7 | Spring Boot | **8084** | `/orders/**` | `orders` | pedidos, transactional outbox |
| `payment` | 9 | Spring Boot | **8085** | `/payments/**` | `payment` | adaptador para o provedor externo de pagamento |
| `notification` | 7 | Spring Boot | **8086** | `/notifications/**` | `notification` | e-mail/push, consumidor idempotente |
| `search` | — | (opcional) | **8087** | `/search/**` | — | reservado para o projeto |
| `assistant` | 12 | Python 3.12 + FastAPI | **8088** | `/assistant/**` | `assistant` | assistente de suporte com IA (RAG + ferramentas) |

**Infraestrutura** (imagens oficiais, configuração em `infra/`):

| Serviço no Compose | Lab | Imagem | Porta(s) na sua máquina | Observações |
|---|---|---|---|---|
| `db` | 1 | `postgres:17` | **5432** | banco `boxoffice`, usuário `boxoffice`, senha `boxoffice`; **um schema por serviço** |
| `db-replica` | 6 | `postgres:17` | **5433** | réplica por streaming do `db`, somente leitura |
| `pgbouncer` | 6 | `edoburu/pgbouncer:v1.26.0-p0` | **6432** | pool de conexões na frente do `db` |
| `redis` | 5 | `redis:8-alpine` | **6379** | cache (`maxmemory` + LRU) |
| `kafka` | 7 | Apache Kafka (KRaft) | **9092** | stream de eventos |
| `otel-lgtm` | 8 | `grafana/otel-lgtm` | **3000** (Grafana), **4317**/**4318** (OTLP gRPC/HTTP) | métricas, logs, traces |
| `toxiproxy` | 9 | `ghcr.io/shopify/toxiproxy` | **8474** (API) | injeção de latência e falhas |
| `ollama` | 12 | `ollama/ollama` | **11434** | LLM local |
| painel web do k6 | 2 | — | **5665** | `K6_WEB_DASHBOARD=true k6 run …` |
| hello (só no lab 0) | 0 | `nginx:1.30-alpine` | **8888** | alvo da medição de referência |

**Convenções** compartilhadas por todos os serviços:

| Tema | Convenção |
|---|---|
| Java | JDK **21**, Spring Boot **4.1.x** (Spring Framework 7, Jackson 3), Spring Cloud **2025.1.x**, Maven, sem Lombok (`record`s do Java para os DTOs) |
| Python | Python 3.12 gerenciado pelo **uv** (`uv init`, `uv add <pacote>`, `uv run <cmd>`, `uvx <ferramenta>`); nunca `pip`/`venv`. Dockerfiles copiam o uv com `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/` e rodam `uv sync --frozen` |
| Pacotes | `boxoffice.<serviço>` (ex.: `boxoffice.catalog`); `groupId` Maven `boxoffice`, `artifactId` = nome do serviço |
| Caminhos HTTP | cada serviço atende **apenas** sob o seu prefixo (`catalog` → `/catalog/...`), então o edge e o gateway roteiam sem reescrever caminhos |
| Banco de dados | uma instância PostgreSQL (`db`), um **schema por serviço**, de propriedade das migrations Flyway daquele serviço (`src/main/resources/db/migration`); nada de joins entre schemas |
| Saúde | Spring Boot Actuator: `/actuator/health`, `/actuator/health/liveness`, `/actuator/health/readiness`, `/actuator/metrics` |
| Erros | RFC 9457 `application/problem+json` (`spring.mvc.problemdetails.enabled: true`) |
| Arquivo Compose | `docker-compose.yaml` na raiz do repositório, nome de projeto `boxoffice` |
| Scripts de carga | `load/*.js` (k6), URL base em `BASE_URL`; resultados salvos em `results/` |

**Variáveis de ambiente** (o mesmo nome em todo lugar; padrões entre parênteses):

| Variável | Usada por | Significado |
|---|---|---|
| `DB_HOST` (`db`), `DB_PORT` (`5432`), `DB_NAME` (`boxoffice`), `DB_USER` (`boxoffice`), `DB_PASSWORD` (`boxoffice`) | todo serviço com banco | conexão com o PostgreSQL |
| `DB_REPLICA_HOST` (`db-replica`), `DB_REPLICA_PORT` (`5432`) | `inventory` (lab 6) | réplica de leitura |
| `REDIS_HOST` (`redis`), `REDIS_PORT` (`6379`) | `catalog` (lab 5) | cache |
| `AUTH_JWKS_URI` (`http://auth:8081/auth/.well-known/jwks.json`) | `gateway` | chaves públicas usadas para validar JWTs |
| `JWT_ISSUER` (`boxoffice-auth`), `JWT_TTL` (`PT1H`) | `auth`, `gateway` | emissor e validade do token |
| `ADMIN_EMAIL` (`admin@boxoffice.dev`), `ADMIN_PASSWORD` (`boxoffice-admin`) | `auth` | administrador criado na inicialização |
| `CATALOG_URL`, `INVENTORY_URL`, `ORDER_URL`, `PAYMENT_URL` (`http://<serviço>:<porta>`) | chamadas entre serviços | URL base de outro serviço |
| `KAFKA_BOOTSTRAP_SERVERS` (`kafka:9092`) | labs 7+ | brokers Kafka |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (`http://otel-lgtm:4318`) | labs 8+ | exportação de telemetria |
| `BASE_URL` | scripts k6 | `http://localhost:8082` nos labs 1–2, `http://localhost` (o edge) a partir do lab 3 |

**Cabeçalhos** que atravessam fronteiras entre serviços:

| Cabeçalho | Quem define | Significado |
|---|---|---|
| `Authorization: Bearer <jwt>` | cliente | identidade, validada pelo `gateway` |
| `X-User-Id`, `X-User-Email`, `X-User-Scope` | `gateway` (removidos se um cliente os enviar) | usuário autenticado, em quem os serviços confiam |
| `X-Request-Id` | `edge` | id de correlação, registrado em log por cada salto |
| `X-Instance` | `catalog` | qual réplica respondeu (lab 3) |
| `X-Cache: HIT` / `MISS` | `catalog` | resultado do cache (lab 5) |

!!! warning "Portas já em uso?"

    Se algo na sua máquina já usa a porta 80, 5432 ou 6379 (um PostgreSQL local, por exemplo), pare-o, ou mude **apenas o lado do host** do mapeamento no `docker-compose.yaml` (`"15432:5432"`). Nunca mude a porta dentro do container: os outros serviços dependem dela.

## 1. Instale as ferramentas { #1-install-the-tools }

A tabela lista para que serve cada ferramenta; as abas abaixo mostram como instalá-las em cada sistema. O k6 é um único binário[^1]; o Docker Compose vem com o Docker Desktop ou como plugin do Docker Engine[^2].

| Ferramenta | Versão | Usada em | Por quê |
|---|---|---|---|
| **Git** | qualquer recente | todos os labs | controle de versão, entrega de cada lab |
| **Docker** + **Compose v2** | Docker 27+ | todos os labs | todo serviço e banco roda em um container |
| **JDK** | **21** (LTS) | labs 1–11 | serviços Spring Boot |
| **Maven** | 3.9+ | labs 1–11 | build e dependências |
| **uv** | recente | labs 2, 12 | instala o Python 3.12 e roda todo script e projeto Python (sem `pip`, sem `venv`) |
| **Python** | **3.12** (via uv) | labs 2, 12 | scripts de resultados, o assistente de IA |
| **k6** | 1.0+ | labs 0–12 | testes de carga (scripts em JavaScript) |
| **kubectl** + **kind** *ou* **minikube** | recente | labs 10–11 | Kubernetes local |
| **jq**, **curl** | qualquer | todos os labs | chamar e ler as APIs pelo terminal |

=== ":simple-apple: macOS"

    Instale o [Homebrew](https://brew.sh){target="_blank"} primeiro, depois:

    ``` { .bash .copy }
    brew install --cask docker          # Docker Desktop (or OrbStack: brew install --cask orbstack)
    brew install --cask temurin@21      # Eclipse Temurin JDK 21
    brew install maven uv k6 kubectl kind jq git
    uv python install 3.12              # Python is managed by uv, not by Homebrew or pip
    ```

    Abra o Docker Desktop uma vez para ele iniciar o engine, e dê a ele **pelo menos 4 CPUs e 8 GB de memória** (*Settings → Resources*).

=== ":simple-linux: Linux (Ubuntu 24.04)"

    ``` { .bash .copy }
    # Docker Engine + Compose plugin (official convenience script) and run docker without sudo
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER" && newgrp docker

    # JDK 21, Maven, tools
    sudo apt-get update
    sudo apt-get install -y openjdk-21-jdk maven git jq curl

    # uv (Python package and project manager) and Python 3.12
    curl -LsSf https://astral.sh/uv/install.sh | sh
    uv python install 3.12

    # k6 (official APT repository)
    sudo gpg -k
    sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
      --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
      | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update && sudo apt-get install -y k6

    # kubectl and minikube
    sudo snap install kubectl --classic
    curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
    sudo install minikube-linux-amd64 /usr/local/bin/minikube && rm minikube-linux-amd64
    ```

=== ":material-microsoft-windows: Windows"

    Use o **WSL 2** com Ubuntu: os labs usam scripts Bash, e o compartilhamento de arquivos entre Windows e containers é lento e frágil.

    ``` { .powershell .copy }
    wsl --install -d Ubuntu-24.04
    ```

    1. Instale o [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/){target="_blank"} e habilite *Settings → Resources → WSL integration* para o Ubuntu.
    2. Abra o terminal do **Ubuntu** e siga a aba **Linux** (pule as linhas do Docker Engine: o Docker Desktop já o fornece).
    3. Mantenha o seu repositório **dentro do sistema de arquivos do WSL** (`~/boxoffice`), não em `/mnt/c/...`.

!!! tip "Sem o k6 instalado? Rode em um container"

    O k6 é um único binário, mas, se você não conseguir instalá-lo, a imagem oficial funciona com os mesmos scripts. A partir da raiz do repositório:

    ``` { .bash .copy }
    docker run --rm -i -v "$PWD":/w -w /w -e BASE_URL=http://host.docker.internal:8888 grafana/k6 run load/hello.js
    ```

    Dentro de um container, `localhost` é o próprio container; `host.docker.internal` chega à sua máquina (no Linux, acrescente `--add-host=host.docker.internal:host-gateway`).

## 2. Verifique o seu ambiente { #2-check-your-environment }

Salve o script abaixo como `scripts/check-env.sh` no seu repositório (próximo passo) e execute-o. Toda linha deve dizer `ok`.

``` { .bash title="scripts/check-env.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/0/code/scripts/check-env.sh"
```

<!-- termynal -->
``` shell
> bash scripts/check-env.sh
Tools
  ok    git       git version 2.47.1
  ok    docker    Docker version 28.4.0, build d8eb465
  ok    compose   Docker Compose version v2.39.2
  ok    java      openjdk version "21.0.8" 2025-07-15 LTS
  ok    maven     Apache Maven 3.9.11
  ok    uv        uv 0.9.2
  ok    k6        k6 v1.3.0 (go1.25.1, linux/amd64)
  ok    kubectl   Client Version: v1.34.1
  ok    jq        jq-1.7.1
  ok    curl      curl 8.5.0 (x86_64-pc-linux-gnu)
Kubernetes (lab 10): kind OR minikube is enough
  ok    minikube  v1.37.0
Checks
  ok    JDK 21 (21 or newer)
  ok    Python 3.12.12 (via uv)
  ok    Docker daemon: 8 CPUs, 16651931648 bytes of memory

All set.
```

As suas versões serão diferentes; o que importa é que nada diga `MISS` ou `FAIL`.

!!! warning "Falhas comuns"

    - `FAIL maven … JAVA_HOME environment variable is not defined correctly`: aponte o `JAVA_HOME` para a pasta do JDK 21 (`export JAVA_HOME=$(/usr/libexec/java_home -v 21)` no macOS; `/usr/lib/jvm/java-21-openjdk-amd64` no Ubuntu) e acrescente a linha ao seu `~/.zshrc` ou `~/.bashrc`.
    - `MISS Docker daemon is not running`: inicie o Docker Desktop (macOS/Windows) ou `sudo systemctl start docker` (Linux).
    - `permission denied … docker.sock` no Linux: você pulou o `usermod -aG docker`; saia da sessão e entre de novo.
    - `MISS Python 3.12 or newer`: rode `uv python install 3.12`. Nunca use `pip install` no Python do sistema: todo passo Python da disciplina passa pelo `uv` (`uv run`, `uv add`, `uvx`).

## 3. Crie o seu repositório { #3-create-your-repository }

Todo o seu trabalho dos labs fica em **um repositório**, chamado `boxoffice`, criado por você no GitHub (privado; você adicionará os colegas de projeto depois). O repositório da disciplina tem o esqueleto de referência e é onde as atualizações do código dos labs são publicadas; o seu repositório é onde vivem o *seu* código e as *suas* medições.

``` { .bash .copy }
mkdir boxoffice && cd boxoffice
git init -b main
mkdir -p services infra load results scripts
```

No fim do semestre ele terá esta cara — cada pasta aparece no lab indicado no comentário:

``` { .tree title="boxoffice/" }
boxoffice/
    docker-compose.yaml        # lab 1, grows in every lab
    .gitignore
    README.md                  # how to run your BoxOffice
    services/
        catalog/               # lab 1  (Spring Boot, port 8082)
        auth/                  # lab 4  (Spring Boot, port 8081)
        gateway/               # lab 4  (Spring Cloud Gateway, port 8080)
        inventory/             # lab 6  (Spring Boot, port 8083)
        order/                 # lab 7
        notification/          # lab 7
        payment/               # lab 9
        assistant/             # lab 12 (FastAPI)
    infra/
        nginx/nginx.conf       # lab 3  (edge)
        postgres/              # lab 6  (replication)
        pgbouncer/             # lab 6
    load/                      # k6 scripts, from lab 0
        hello.js
    results/                   # your measurements: lab0.md, lab1.md, ...
    scripts/
        check-env.sh
    k8s/                       # lab 10
    .github/workflows/         # lab 11
```

Acrescente um `.gitignore` na raiz:

``` { .bash title=".gitignore" .copy }
--8<-- "docs/2027.1/hands-on/0/code/.gitignore"
```

Depois crie o repositório no GitHub, faça o push e continue fazendo commits ao fim de cada lab:

``` { .bash .copy }
git add . && git commit -m "lab 0: environment"
git remote add origin git@github.com:<your-user>/boxoffice.git
git push -u origin main
```

!!! tip "Um commit (ou tag) por lab"

    Crie uma tag ao fim de cada lab (`git tag lab0 && git push --tags`). Quando um lab posterior quebrar algo, `git diff lab4 lab5` mostra exatamente o que mudou — a mesma disciplina que você usará nos deploys do lab 11.

## 4. Meça: a referência da sua máquina { #measure-it }

Todo lab termina com uma medição, e esta define a referência: **quanto o seu notebook consegue atender quando o servidor quase não faz nada?** O alvo é um Nginx padrão devolvendo uma pequena página estática; qualquer número que você obtiver depois para o BoxOffice será *menor*, e a diferença é o custo do seu código, do seu banco e dos seus saltos de rede.

Salve o script como `load/hello.js`:

``` { .javascript title="load/hello.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/0/code/load/hello.js"
```

Suba o alvo, rode o k6 com 1, 10 e 50 usuários virtuais (VUs) e depois pare o alvo:

``` { .bash .copy }
docker run -d --rm --name hello -p 8888:80 nginx:1.30-alpine
k6 run -e VUS=1  load/hello.js
k6 run -e VUS=10 load/hello.js
k6 run -e VUS=50 load/hello.js
docker stop hello
```

<!-- termynal -->
``` shell
> k6 run -e VUS=10 load/hello.js
  █ THRESHOLDS

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS

    checks_succeeded...: 100.00% 249184 out of 249184
    HTTP
    http_req_duration..............: avg=163.61µs med=119.66µs p(95)=405.54µs p(99)=824.01µs max=13.26ms
    http_req_failed................: 0.00%  0 out of 249184
    http_reqs......................: 249184 49808.803836/s
    EXECUTION
    vus............................: 10     min=10          max=10
```

Seus números dependem da máquina. Com o Docker Desktop (macOS, Windows) cada requisição também atravessa o encaminhamento de portas da VM, então espere algumas vezes menos do que no Linux nativo — cerca de 15.000 req/s com 10 VUs em um notebook Apple Silicon de 8 núcleos.

Leia o resumo assim:

- `http_reqs … /s` é a **vazão** (throughput, em requisições por segundo, RPS).
- `http_req_duration` dá a distribuição de **latência**: `med` é a mediana (p50), `p(95)`/`p(99)` são os percentis 95 e 99 — 1 requisição em 100 é mais lenta que o p99.
- `vus` é a **concorrência**: cada usuário virtual envia uma requisição, espera a resposta e envia a próxima (um modelo de carga *fechado*).

Registre os resultados em `results/lab0.md`:

``` { .markdown title="results/lab0.md" .copy }
# Lab 0 — baseline

Machine: <CPU model>, <cores> cores, <RAM> GB; Docker resources: <CPUs> CPUs, <GB> GB

| VUs | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | Errors |
|----:|-------------------:|---------:|---------:|---------:|-------:|
|   1 |                    |          |          |          |        |
|  10 |                    |          |          |          |        |
|  50 |                    |          |          |          |        |

Little's Law check (VUs ≈ throughput × average latency):
- 10 VUs: ____ req/s × ____ s = ____
```

??? question "Pense antes: o que acontece entre 10 e 50 VUs?"

    Com 1 VU, a latência é puro tempo de serviço e a vazão é `1 / latência`. Acrescentar VUs aumenta a vazão **enquanto** houver núcleos de CPU ociosos. Quando os núcleos estão ocupados, mais VUs só acrescentam **espera**: a vazão fica estável e a latência cresce na mesma proporção — a Lei de Little, `L = λ × W`, com `L` = VUs, `λ` = vazão e `W` = latência. Você verá esse joelho de novo, com serviços reais, no [lab 2](../2/index.md).

!!! warning "O k6 compete com o servidor"

    O k6 e o servidor dividem os mesmos núcleos de CPU, então, acima de algumas dezenas de milhares de requisições por segundo, você mede o k6 tanto quanto o Nginx. Para uma referência, tudo bem; no lab 2 o alvo será muito mais lento que o k6, e o problema desaparece.

## 5. Primeiro contato com o playground { #5-first-look-at-the-playground }

O [System Design Playground](../../../playground/index.md) simula, sob carga e em segundos, os mesmos componentes que você vai construir. Cada lab incorpora o cenário que está prestes a medir de verdade, para você formar uma hipótese *antes* de rodar o k6.

**Experimente:** aperte **Run** no cenário `monolith` abaixo (um servidor de aplicação, um banco SQL). Aumente a carga até o p99 saltar. Qual componente satura primeiro? Anote a resposta — você vai confrontá-la com o seu próprio serviço `catalog` no lab 2.

<div class="sdp" data-scenario="monolith" data-mode="compact" data-height="460"></div>

## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| `Bind for 0.0.0.0:8888 failed: port is already allocated` | outro programa (ou um `hello` antigo) usa a porta 8888 | `docker rm -f hello`, ou use outra porta: `-p 8899:80` e `k6 run -e BASE_URL=http://localhost:8899 load/hello.js` |
| `k6: command not found` | k6 não instalado ou fora do `PATH` | instale (passo 1) ou use o comando com container da dica "Sem o k6 instalado?" |
| `permission denied while trying to connect to the Docker daemon socket` | usuário Linux fora do grupo `docker` | `sudo usermod -aG docker "$USER"`, depois saia e entre de novo |
| `Cannot connect to the Docker daemon` | Docker Desktop não iniciado | inicie o Docker Desktop e espere "Engine running" |
| `FAIL maven … JAVA_HOME` | `JAVA_HOME` aponta para nada ou para um JDK antigo | aponte o `JAVA_HOME` para a pasta do JDK 21 (veja "Falhas comuns") |
| tudo muito lento no Windows | o repositório está em `/mnt/c/...` | mova para `~/boxoffice` dentro do WSL |
| `check-env.sh: line 1: #!/usr/bin/env: No such file` no WSL | o arquivo foi salvo com finais de linha do Windows | `sed -i 's/\r$//' scripts/check-env.sh` (e configure o editor para LF) |

!!! success "Boas práticas neste lab"

    - **Confira o ferramental com um script, não de memória** — `scripts/check-env.sh` mostra cada ferramenta e versão, então um ambiente quebrado aparece em segundos, não no meio de um teste de carga. Por que importa: toda medição da disciplina supõe o mesmo ambiente ([Como estudar projeto de sistemas](../../classes/intro/index.md)).
    - **Mantenha segredos e saídas volumosas fora do Git** — o `.gitignore` exclui `.env` e os relatórios HTML do k6, e mantém os resumos JSON e as tabelas em `results/*.md`. Segurança é um atributo de qualidade desde o primeiro dia ([Requisitos](../../classes/intro/requirements/index.md)).
    - **Meça uma referência antes de mudar qualquer coisa** — `load/hello.js` diz o que a *sua* máquina atende, a referência de todo número seguinte ([Estimativas](../../classes/estimation/index.md)).
    - **Anote cada medição com o seu ambiente** — `results/lab0.md` registra máquina, taxa e latência; um número sem o ambiente não pode ser comparado ([Tornando requisitos mensuráveis](../../classes/intro/requirements/index.md)).

## Limpeza { #clean-up }

``` { .bash .copy }
docker rm -f hello 2>/dev/null || true     # the baseline target, if still running
docker image prune -f                      # optional: remove dangling images
```

Mantenha tudo em `boxoffice/`: o lab 1 começa dele.

## Entrega { #deliverable }

- [ ] `bash scripts/check-env.sh` imprime `All set.` (cole a saída em `results/lab0.md`).
- [ ] O seu repositório `boxoffice` existe no GitHub com a estrutura de pastas, o `.gitignore`, o `scripts/check-env.sh` e o `load/hello.js`, com a tag `lab0`.
- [ ] `results/lab0.md` tem a tabela de referência preenchida (1, 10 e 50 VUs) e a verificação da Lei de Little.
- [ ] Você rodou o cenário `monolith` no playground e anotou qual componente satura primeiro.
- [ ] [Quiz](quiz.md) respondido.

## Estado final { #end-state }

Ao fim deste lab o seu repositório contém (o overlay [`code/`](code/scripts/check-env.sh) do lab mais os seus resultados):

``` { .tree title="boxoffice/ after lab 0" }
boxoffice/
    .gitignore
    load/
        hello.js
    results/
        lab0.md
    scripts/
        check-env.sh
```

Próximo: [Lab 1 — Primeiro serviço](../1/index.md).

[^1]: Documentação do Grafana k6, [Running k6](https://grafana.com/docs/k6/latest/get-started/running-k6/){target="_blank"} e [Install k6](https://grafana.com/docs/k6/latest/set-up/install-k6/){target="_blank"}.
[^2]: Documentação do Docker, [Docker Compose](https://docs.docker.com/compose/){target="_blank"}.
