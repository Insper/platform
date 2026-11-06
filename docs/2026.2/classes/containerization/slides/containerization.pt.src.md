---
marp: true
lang: pt-BR
title: Containerização
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Containerização

**Empacote a aplicação com tudo de que ela precisa — e rode igual em qualquer lugar**

<!--
Objetivos: explicar o que é um container (namespaces, cgroups, sistema de arquivos em camadas) e como ele difere
de uma VM; escrever um Dockerfile multi-stage e amigável ao cache para um serviço Spring Boot; rodar, inspecionar e
depurar containers; compor um serviço + PostgreSQL com compose.yaml, .env e health checks; diagnosticar localhost,
dados perdidos, segredos commitados e latest.
Roteiro: (1) visão geral: escala, containers vs. VMs, o que um container realmente é, o ciclo de vida; (2) Docker;
(3) Docker Compose; (4) containerização na nuvem.
-->

---

## O tráfego está crescendo

<div class="q">

Seu servidor já não aguenta a carga. Quais são as opções — e que problema novo aparece?

</div>

* **Escala vertical** (scale-up) — uma máquina maior: simples, mas limitada; cada upgrade exige parada.
* **Escala horizontal** (scale-out) — mais servidores atrás de um load balancer: em teoria, sem limite…
* …mas, com dez servidores, todos precisam ser **idênticos**: SO, versão do Java, bibliotecas, configuração.
* *"Na minha máquina funciona"* — uma **imagem de container** empacota a aplicação **com todas as dependências** e roda igual no notebook, no servidor de CI e em cada nó de produção.

---

<!-- _class: tight -->

## Containers vs. máquinas virtuais

<div class="cols">
<div>

**VM**: hardware → hypervisor → **SO convidado** por VM → aplicação

</div>
<div>

**Container**: hardware → SO hospedeiro + **kernel compartilhado** → container engine → aplicação

</div>
</div>

| Aspecto | Containers Docker | Máquinas virtuais |
|---|---|---|
| **Isolamento** | de processo, compartilham o kernel do hospedeiro | SO completo, cada VM tem o próprio kernel |
| **Overhead** | leve, sem SO por container | um SO completo por VM |
| **Inicialização** | segundos | minutos (boot do SO) |
| **Portabilidade** | alta: a imagem leva aplicação + dependências | menor: configuração específica do SO |
| **Fronteira de segurança** | mais fraca (kernel compartilhado) | mais forte (kernel separado) |
| **Uso típico** | microsserviços, CI/CD, escala horizontal | outro SO convidado, isolamento forte |

<div class="ok">

Combinados, não opostos: a nuvem aluga uma VM (isolamento entre clientes) e você roda vários containers nela.

</div>

---

<!-- _class: tight -->

## O que um container realmente é

Não é uma VM pequena — é um **processo Linux** comum, ao qual o kernel mostra uma visão restrita da máquina:

| Recurso | O que faz | O que você observa |
|---|---|---|
| **Namespaces** | visão própria de PIDs, rede, montagens, hostname, usuários | sua aplicação é o PID 1, com IP próprio e porta 8080 |
| **cgroups** | limitam e contabilizam CPU, memória, I/O | `--memory 512m` → a JVM é morta (OOM) acima disso |
| **Sistema de arquivos em camadas** (OverlayFS) | camadas da imagem somente leitura + uma fina camada gravável | arquivos gravados dentro somem quando o container é removido |

```bash
docker run --rm alpine ps          # inside: ps is PID 1, nothing else is visible
docker run -d --name pg -e POSTGRES_PASSWORD=secret postgres:17
docker top pg                      # from the host: the postgres processes, with host PIDs
```

<p class="small">macOS/Windows: o Docker Desktop roda uma VM Linux escondida. As imagens seguem o padrão <strong>OCI</strong>: também rodam no Podman, no containerd e no Kubernetes (que não fala mais com o Docker desde a 1.24).</p>

---

## O ciclo de vida do container

Código + `Dockerfile` → **docker build** → `Imagem:tag` → **docker push** → `Registry` → **docker pull** → **docker run** → containers 1, 2, 3

- **Dockerfile**: como construir a imagem.
- **Imagem**: o artefato imutável — versionado, guardado num registry, baixado em qualquer máquina.
- **Container**: uma instância em execução — isolada, efêmera, descartável.

<div class="ok">

**Na loja**: o Hands-on 1 empacota o serviço account (`mvn package` → Dockerfile → `docker compose up --build` ao lado do PostgreSQL); no Hands-on 4, o Jenkins constrói e envia a imagem; no Hands-on 5, o Kubernetes a baixa e roda vários containers.

</div>

---

## Armadilhas do modelo de containers

- **Tratar um container como um servidor**: `docker exec` para instalar pacotes ou editar arquivos se perde no próximo deploy — mude o Dockerfile e reconstrua.
- **Guardar dados no container**: a camada gravável some com ele — persista bancos num **volume**.
- **Publicar `latest`**: aponta para o que foi enviado por último — faça deploy de `myapp:1.4.2` ou do SHA de um commit, para poder voltar atrás.
- **Supor que o container é uma fronteira de segurança**: todos compartilham o kernel do hospedeiro; código não confiável precisa de isolamento mais forte (VMs).

---

<div class="kicker">Docker</div>

## Do setup do notebook a um artefato

`mvn spring-boot:run` funciona porque o **seu** notebook tem o JDK, o Maven e as variáveis certas. O Docker transforma o setup num **arquivo** (o Dockerfile) e o resultado num **artefato** (a imagem).

| Conceito | O que é |
|---|---|
| **Dockerfile** | a receita; cada `RUN` / `COPY` / `ADD` cria uma **camada** somente leitura |
| **Imagem** | snapshot imutável, `nome:tag` (`store/account:1.0`); sem tag = `latest` |
| **Container** | instância em execução: compartilha o kernel, tem sistema de arquivos, rede e PIDs próprios |
| **Registry** | guarda imagens: Docker Hub (público); ECR, GHCR, GitLab (privados) |

<p class="small">A CLI <code>docker</code> é só um cliente: chama o daemon (<code>dockerd</code>), que baixa imagens e inicia containers por meio do containerd + runc. "Cannot connect to the Docker daemon" = ninguém escutando do outro lado.</p>

---

## Um Dockerfile

```dockerfile
# Base image — choose the smallest that fits
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
# Copy the built artifact from the host (run `mvn package` first)
COPY target/*.jar app.jar
# Documentation only
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

- O padrão dos serviços da loja no Hands-on 1: imagem base Java 25, o JAR do Maven, `java -jar`.
- `*.jar` casa com `account-service-0.0.1-SNAPSHOT.jar` (não com o `*.jar.original`); o `COPY` o renomeia.

---

<!-- _class: tight -->

## As instruções mais usadas

| Instrução | Para que serve | Exemplo |
|---|---|---|
| `FROM` | imagem base (sempre a primeira) | `FROM eclipse-temurin:25-jre-alpine` |
| `WORKDIR` | define e cria o diretório de trabalho | `WORKDIR /app` |
| `COPY` | arquivos do contexto de build para a imagem | `COPY target/*.jar app.jar` |
| `RUN` | comando **no build**, salvo como camada | `RUN apk add --no-cache curl` |
| `ENV` | variável para o build e a execução | `ENV SPRING_PROFILES_ACTIVE=prod` |
| `ARG` | variável só do build | `ARG VERSION=1.0` |
| `EXPOSE` | documenta a porta (**não** a publica) | `EXPOSE 8080` |
| `USER` | roda como esse usuário | `USER app` |
| `ENTRYPOINT` / `CMD` | o que roda **quando o container inicia** | `ENTRYPOINT ["java", "-jar", "app.jar"]` |

<p class="small">O <code>CMD</code> dá argumentos padrão ao <code>ENTRYPOINT</code> e é substituído pelo que você digita depois do nome da imagem. Forma exec (colchetes): a JVM é o PID 1 e recebe o <code>SIGTERM</code> do <code>docker stop</code> — encerramento gracioso.</p>

---

## Builds multi-stage

```dockerfile
# Stage 1: build
FROM maven:3.9-eclipse-temurin-25 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package -DskipTests

# Stage 2: run — only the JRE, no Maven, no source
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

<p class="small">A imagem final tem só o JRE e o JAR — e a máquina que a constrói não precisa de Maven nem de JDK. Um <code>.dockerignore</code> (<code>.git</code>, <code>.env</code>, arquivos da IDE) mantém o contexto de build pequeno e os segredos fora das camadas.</p>

---

## Cache de camadas: a ordem importa

Uma camada sem mudança é **reaproveitada** do cache; uma camada que mudou **é reconstruída junto com todas as seguintes**.

<div class="cols">
<div>

### Ordem ruim

`COPY src ./src` primeiro → todo commit invalida o cache → todas as dependências do Maven são baixadas **de novo**.

</div>
<div>

### Ordem boa

`COPY pom.xml .` → `RUN mvn dependency:go-offline` → `COPY src ./src` → `RUN mvn package` (só reconstrói a aplicação)

</div>
</div>

<div class="ok">

Coloque o que muda **raramente** (dependências) antes do que muda **sempre** (código-fonte). O Dockerfile multi-stage já faz isso.

</div>

---

<!-- _class: tight -->

## Comandos essenciais

| Comando | O que faz |
|:-|:-|
| `docker build -t myapp:1.0 .` | constrói uma imagem a partir do Dockerfile daqui |
| `docker run -d -p 8080:8080 --name myapp -e KEY=value <image>` | em segundo plano, porta `host:container`, nome, variável |
| `docker run --rm <image>` | remove o container quando ele termina |
| `docker ps -a` | lista os containers, inclusive os parados |
| `docker logs -f <container>` | acompanha o stdout e o stderr |
| `docker exec -it <container> sh` | shell dentro de um container em execução |
| `docker stop` / `docker rm <container>` | `SIGTERM` (`SIGKILL` depois de 10 s) e depois remove |
| `docker images` / `pull` / `push` / `tag` / `rmi` | gerencia imagens e registries |
| `docker system prune` | remove containers parados, imagens órfãs, redes sem uso |

---

## Depurando um container que não inicia

O primeiro problema mais comum: ele termina logo depois do `docker run`. Siga as evidências:

```bash
docker ps -a                    # STATUS shows "Exited (1) 3 seconds ago"
docker logs account             # the application's own error message
docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' account   # 137 + true = killed for memory
docker run -it --rm --entrypoint sh store/account:1.0                 # open a shell in the image
```

---

## Redes

Cada container tem o próprio namespace de rede — o próprio IP e o próprio `localhost`.

- **`bridge` definida pelo usuário** (`docker network create`): os containers se encontram **pelo nome** (DNS embutido).
- **`bridge` padrão** (sem `--network`): só endereços IP · `host`: compartilha a pilha do hospedeiro · `none`.

```bash
docker network create store-net
docker run -d --name db --network store-net -e POSTGRES_PASSWORD=secret postgres:17
docker run --rm --network store-net postgres:17 pg_isready -h db
```

<div class="warn">

`EXPOSE 8080` é documentação: **publique** com `-p 8080:8080`. Dentro de um container, `localhost` é o próprio container: use `jdbc:postgresql://db:5432/store`, não `localhost:5432`.

</div>

---

## Volumes

Containers são efêmeros: os dados gravados dentro se perdem quando o container é removido.

```bash
# Named volume (managed by Docker)
docker run -v mydata:/var/lib/postgresql/data postgres:17

# Bind mount (maps a host directory)
docker run -v /host/path:/container/path myapp
```

- **Volumes nomeados** em produção: o Docker gerencia o local.
- **Bind mounts** no desenvolvimento: mudanças locais sem reconstruir a imagem.

<div class="warn">

O `postgres:18` levou os dados para `/var/lib/postgresql/18/docker` (monte `/var/lib/postgresql`): o `postgres:latest` mudou em silêncio — **fixe a versão major**.

</div>

---

## Boas práticas e erros comuns

<div class="cols">
<div>

### Boas práticas

- **Fixe versões**: `eclipse-temurin:25-jre-alpine`, `postgres:17`
- **Imagens base pequenas**: `-alpine`, `-jre`, distroless
- **Um processo** por container
- **Usuário não root** (`USER`)
- **Configuração em variáveis de ambiente**: uma imagem para todos os ambientes

</div>
<div>

### Erros comuns

- **Segredos na imagem** (`COPY .env`, `ENV DB_PASSWORD=…`): toda camada pode ser lida
- **JAR desatualizado**: o `docker build` de estágio único copia o que estiver em `target/`
- **Código antes das dependências**: todo commit baixa o Maven de novo

</div>
</div>

---

<div class="kicker">Docker Compose</div>

## De um script para um arquivo

O serviço account e o banco com `docker` puro, na ordem certa:

```bash
docker network create store
docker volume create db-data
docker run -d --name db --network store \
  -e POSTGRES_DB=store -e POSTGRES_USER=store -e POSTGRES_PASSWORD=secret \
  -v db-data:/var/lib/postgresql/data postgres:17
docker build -t store/account ./account-service
docker run -d --name account --network store -p 8080:8080 \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/store store/account
```

Acrescente gateway, auth, Redis e Kafka: um script frágil que ninguém consegue revisar num pull request. O **Docker Compose** o substitui por um único `compose.yaml` **declarativo** e um único comando.

---

<!-- _class: tight -->

## Estrutura básica

```yaml
name: myapp

services:
  web:
    build: ./web
    ports:
      - "80:80"
    depends_on:
      - app
  app:
    build: ./app
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/myapp
    depends_on:
      - db
  db:
    image: postgres:17
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

<p class="small">Uma rede por projeto: cada serviço é alcançado pelo <strong>nome do serviço como hostname</strong> (<code>db</code>, <code>app</code>, <code>web</code>).</p>

---

## O vocabulário de um arquivo Compose

| Chave | Significado |
|---|---|
| `name` | nome do projeto; prefixa containers, redes, volumes (`myapp-db-1`) |
| `services` | uma entrada por container; um modelo que pode ter réplicas |
| `image` / `build` | uma imagem existente / build a partir de um Dockerfile local |
| `ports` | publica `host:container` — só o que precisa ser alcançado de fora |
| `environment` | variáveis passadas ao container |
| `depends_on` | ordem de inicialização entre serviços |
| `volumes` | volumes nomeados ou bind mounts; o `volumes:` de nível superior declara os nomeados |

<p class="small">O Compose v2 é <code>docker compose</code> (com espaço); o <code>docker-compose</code> v1 não tem suporte desde 2023 e o <code>version:</code> é obsoleto. Nome preferido: <code>compose.yaml</code>.</p>

---

## Comandos principais

| Comando | O que faz |
|:-|:-|
| `docker compose up -d --build` | reconstrói as imagens e sobe tudo em segundo plano |
| `docker compose ps` | lista os serviços em execução |
| `docker compose logs -f app` | acompanha os logs de um serviço |
| `docker compose exec app sh` | shell num serviço em execução |
| `docker compose restart app` | reinicia um serviço |
| `docker compose down` / `down -v` | remove containers e redes / **e os volumes nomeados** |
| `docker compose config` | o arquivo final com as `${VARIÁVEIS}` resolvidas — confira primeiro |

---

## Nomes de serviço e não `localhost`

Dentro da rede do projeto, os serviços conversam na **porta do container** pelo **nome do serviço**; o `ports:` só importa para o tráfego vindo da sua máquina.

| De onde | URL |
|---|---|
| o container `app` | `jdbc:postgresql://db:5432/myapp` |
| seu notebook (IDE, `psql`, DBeaver) | `jdbc:postgresql://localhost:5432/myapp` (só com `ports: - 5432:5432`) |

<div class="warn">

O bug mais comum do Compose: `localhost:5432` funciona na IDE e falha dentro do Compose com *Connection refused*. Use `db` e passe a URL por variável de ambiente, para que a mesma imagem funcione nos dois lugares.

</div>

<p class="small">No Hands-on 2, só o gateway publica uma porta; os outros serviços só são alcançáveis dentro da rede.</p>

---

## Variáveis de ambiente e `.env`

```yaml
environment:
  POSTGRES_DB: ${POSTGRES_DB:-myapp}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set it in .env}
```

- `:-myapp` = valor **padrão**; `:?` = **falha com estardalhaço** se faltar (um `${VAR}` simples só avisa e coloca uma string vazia).
- O `.env` (ao lado do `compose.yaml`) é lido automaticamente para a **interpolação**; as variáveis do shell têm precedência. Ele **não** é passado aos containers.
- `env_file: account.env` injeta cada `KEY=value` de um arquivo **num container**.

<div class="warn">

**Nunca faça commit do `.env`**: coloque-o no `.gitignore`, um por ambiente, e faça commit de um `.env.example` com valores fictícios.

</div>

---

<!-- _class: tight -->

## Iniciado não é pronto

O `depends_on` ordena a **inicialização**, mas não espera o banco **terminar de inicializar**.

```yaml
services:
  db:
    image: postgres:17
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapp"]
      interval: 5s
      timeout: 5s
      retries: 5
  app:
    build: ./app
    depends_on:
      db:
        condition: service_healthy
```

O `compose up` inicia o db → `pg_isready` unhealthy, nova tentativa em 5 s → healthy → inicia o app → o app conecta em `db:5432`.

<p class="small">Sem isso, o app pode cair enquanto o PostgreSQL ainda cria seus arquivos. O <code>restart: on-failure</code> é uma rede de segurança complementar.</p>

---

## Volumes nomeados vs. bind mounts

```yaml
services:
  db:
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
```

| | Volume nomeado | Bind mount |
|---|---|---|
| **Local dos dados** | gerenciado pelo Docker | um caminho do hospedeiro que você escolhe |
| **Removido pelo `down -v`** | sim — os dados são apagados | não — a pasta do hospedeiro fica |
| **Uso** | dados de produção, bancos | desenvolvimento: hot reload, scripts de carga |

<div class="warn">

Os scripts de inicialização só rodam **quando o diretório de dados está vazio**: depois de mudar o `init.sql`, `docker compose down -v` para reinicializar.

</div>

---

## Limites do Compose

O Compose roda tudo em **um host**: não espalha containers entre máquinas, não os reagenda quando um host morre e não faz rolling updates. É ideal para desenvolvimento, CI e pequenos deploys num único servidor.

<div class="warn">

- **`depends_on` sem health check** → falhas "aleatórias" na inicialização.
- **`down -v` num banco que importa** → o volume e seus dados se vão.
- **Publicar todas as portas** "por via das dúvidas" → cada uma é uma porta de entrada; publique só o gateway.
- **Esquecer o `--build`** → o Compose reaproveita a imagem antiga e sua mudança não aparece.

</div>

---

## Containerização na nuvem

Muitos hosts — reiniciar containers que caíram, espalhar réplicas, implantar versões novas — é o trabalho de um **orquestrador** como o Kubernetes (Hands-on 5). Os serviços gerenciados acrescentam agendamento, escala e balanceamento de carga:

| Serviço | Provedor | Modelo |
|---|---|---|
| **ECS / Fargate** | AWS | containers gerenciados — nenhum cluster para operar |
| **EKS** | AWS | Kubernetes gerenciado |
| **Cloud Run** | Google | containers serverless — escala até zero |
| **GKE** | Google | Kubernetes gerenciado |
| **AKS** | Azure | Kubernetes gerenciado |

---

<!-- _class: tight -->

## Pontos-chave

1. A escala horizontal exige **ambientes idênticos**; uma imagem de container empacota a aplicação com suas dependências e acaba com o *"na minha máquina funciona"*.
2. Um container é um **processo Linux** isolado (namespaces + cgroups + sistema de arquivos em camadas): compartilha o kernel, inicia em segundos e isola menos do que uma VM.
3. **Dockerfile → imagem → registry → container**; builds **multi-stage** e dependências **antes** do código dão imagens pequenas e rebuilds rápidos.
4. Publique com `-p host:container`; numa rede definida pelo usuário, os containers se encontram **pelo nome** — `localhost` é o próprio container.
5. Containers são descartáveis: dados em **volumes**, configuração em variáveis de ambiente, versões explícitas das imagens — nunca `latest`.
6. O `compose.yaml` declara a stack; o `.env` preenche os marcadores e nunca vai para o repositório; `healthcheck` + `service_healthy` espera a dependência ficar **pronta**.
7. Docker e Compose rodam num host; orquestradores e serviços gerenciados de nuvem rodam containers em muitos.
