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

**Empacote a aplicação com tudo de que ela precisa — e rode de forma idêntica em qualquer lugar**

<!--
Roteiro: (1) escalabilidade e o "na minha máquina funciona"; (2) containers vs VMs e o que um
container realmente é; (3) Docker: Dockerfile, camadas, comandos, redes, volumes; (4) Docker Compose:
serviços, a armadilha do localhost, .env, health checks; (5) armadilhas e além de um único host.
-->

---

## O tráfego está crescendo

<div class="q">

O seu servidor não dá mais conta da carga. Quais são as suas opções — e que novo problema aparece?

</div>

* **Escalabilidade vertical** — uma máquina maior: simples, mas há um limite físico e upgrades exigem parada.
* **Escalabilidade horizontal** — mais máquinas atrás de um balanceador de carga: em teoria, sem limite…
* …mas agora todo servidor precisa ser **idêntico**: SO, versões de bibliotecas, variáveis de ambiente.
* *"Na minha máquina funciona"* — **containers** empacotam a aplicação **com todas as dependências**.

<!--
Deixe a turma responder antes de revelar. O último item é a motivação da aula inteira.
-->

---

<!-- _class: tight -->

## Containers vs. máquinas virtuais

<div class="cols">
<div>

**VM**: hardware → hypervisor → **SO convidado** por VM → app

</div>
<div>

**Container**: hardware → SO hospedeiro + **kernel compartilhado** → container engine → app

</div>
</div>

| Aspecto | Containers | Máquinas virtuais |
|---|---|---|
| Isolamento | por processo, kernel compartilhado | SO completo, kernel próprio |
| Overhead | leve | um SO completo por VM |
| Inicialização | segundos | minutos |
| Fronteira de segurança | mais fraca | mais forte |
| Uso típico | microsserviços, CI/CD, scale-out | outro SO convidado, isolamento forte |

<p class="small">Na nuvem, os dois são combinados: os containers rodam <strong>dentro</strong> das VMs que você aluga.</p>

---

## O que um container realmente é

Não é uma VM pequena — é um **processo Linux** comum, com uma visão restrita da máquina:

| Recurso | Dá ao processo | Você vê |
|---|---|---|
| **Namespaces** | PIDs, rede, montagens e hostname próprios | a app é o PID 1, com IP e portas próprios |
| **cgroups** | limites de CPU e memória | `--memory 512m` → encerrado (OOM) acima disso |
| **OverlayFS** | camadas da imagem (só leitura) + uma gravável | arquivos gravados somem com o container |

- O Docker Desktop no macOS/Windows roda uma **VM Linux** oculta para isso.
- As imagens seguem o padrão **OCI**: também rodam no Podman, containerd e Kubernetes.

---

## Conceitos centrais

`Dockerfile` → **docker build** → `Image` → **docker push** → `Registry` → **docker pull** → **docker run** → `Container`

| Conceito | O que é |
|---|---|
| **Dockerfile** | a receita; cada `RUN`/`COPY` adiciona uma **camada** somente leitura |
| **Imagem** | artefato imutável, `name:tag` — versionado, enviado, distribuído |
| **Container** | instância em execução de uma imagem — isolada, efêmera, descartável |
| **Registry** | armazena imagens: Docker Hub (público), ECR, GHCR, GitLab (privados) |

<p class="small">A CLI <code>docker</code> só conversa com o daemon (<code>dockerd</code>), que inicia os containers por meio do containerd/runc.</p>

---

## Um Dockerfile

```dockerfile
FROM eclipse-temurin:25-jre-alpine      # smallest base that fits
WORKDIR /app
COPY target/*.jar app.jar               # Maven's JAR, renamed
EXPOSE 8080                             # documentation only
ENTRYPOINT ["java", "-jar", "app.jar"]  # exec form: JVM gets SIGTERM
```

- `RUN` executa no **build**; `ENTRYPOINT`/`CMD`, na **inicialização** (`CMD` = argumentos padrão).
- Um `.dockerignore` deixa `.git`, `.env` e arquivos da IDE fora do contexto de build.

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
# Stage 2: run — only the JRE
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

A imagem final tem **apenas o JRE e o JAR** — o Maven e o código-fonte são descartados.

---

## Cache de camadas: a ordem importa

Uma camada inalterada é **reaproveitada** do cache; uma camada alterada **é reconstruída, junto com todas as seguintes**.

<div class="cols">
<div>

### Ordem ruim

`COPY src` primeiro → todo commit invalida o cache → as dependências são baixadas **de novo**.

</div>
<div>

### Ordem boa

`COPY pom.xml` → `RUN mvn dependency:go-offline` → `COPY src` → `RUN mvn package`

</div>
</div>

<div class="ok">

Coloque o que muda **raramente** (dependências) antes do que muda **com frequência** (código-fonte).

</div>

---

## Comandos essenciais

| Comando | O que faz |
|:-|:-|
| `docker build -t myapp:1.0 .` | constrói uma imagem a partir do Dockerfile local |
| `docker run -d -p 8080:8080 <image>` | inicia em segundo plano, publica host 8080 → container 8080 |
| `docker ps -a` | lista os containers, inclusive os parados |
| `docker logs -f <container>` | acompanha os logs |
| `docker exec -it <container> sh` | abre um shell dentro de um container em execução |
| `docker stop` / `docker rm <container>` | SIGTERM (SIGKILL após 10 s) e depois remove |
| `docker push` / `docker pull <image>` | envia para / baixa de um registry |

<p class="small">O container termina na hora? <code>docker ps -a</code> → <code>docker logs</code> → <code>docker inspect</code> (código de saída 137 = encerrado, muitas vezes por memória).</p>

---

## Redes e volumes

<div class="cols">
<div>

### Redes

- `bridge` **definida pelo usuário**: os containers se encontram **pelo nome**
- `bridge` padrão: só endereços IP
- `host`: compartilha a pilha de rede do host
- `EXPOSE` documenta; **`-p`** publica

</div>
<div>

### Volumes

Containers são **efêmeros** — os dados internos se perdem na remoção.

- **Volume nomeado** `mydata:/var/lib/postgresql/data` — gerenciado pelo Docker.
- **Bind mount** `./init.sql:/docker-…/init.sql` — dev, scripts de carga.

</div>
</div>

<p class="small">O <code>postgres:18</code> moveu os dados para <code>/var/lib/postgresql/18/docker</code>: fixe as versões principais.</p>

---

<!-- _class: tight -->

## Docker Compose

A stack inteira em **um único arquivo declarativo**, iniciada com `docker compose up -d --build`.

```yaml
services:
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

<p class="small">O Compose cria uma rede por projeto: o <strong>nome do serviço é o hostname</strong> — repare em <code>db:5432</code>.</p>

---

## Compose: comandos e a armadilha do `localhost`

| Comando | O que faz |
|:-|:-|
| `docker compose up -d --build` | reconstrói as imagens e inicia tudo |
| `docker compose ps` / `logs -f app` | status / logs de um serviço |
| `docker compose config` | mostra o arquivo com as `${VARS}` resolvidas |
| `docker compose down` / `down -v` | remove containers e redes / **e volumes** |

<div class="warn">

Dentro de um container, **`localhost` é o próprio container**. `localhost:5432` funciona pela IDE e falha no Compose — use `db:5432`, passado como variável de ambiente.

</div>

---

## Configuração com `.env`

```yaml
environment:
  POSTGRES_DB: ${POSTGRES_DB:-myapp}             # default if unset
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set it} # required: fail loudly
```

- O `.env` (ao lado do `compose.yaml`) preenche os marcadores `${...}`; as variáveis do shell prevalecem.
- `env_file: account.env` injeta um arquivo inteiro **em um container**.
- Publique só o ponto de entrada; em produção, mantenha a `5432` dentro da rede do Compose.

<div class="warn">

**Nunca faça commit do `.env`** — coloque-o no `.gitignore` e faça commit de um `.env.example`.

</div>

---

## Iniciado não é pronto

O `depends_on` ordena a **inicialização**, mas não espera o banco de dados **terminar de inicializar**.

```yaml
db:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U myapp"]
    interval: 5s
    retries: 5
app:
  depends_on:
    db:
      condition: service_healthy
```

<!--
Pergunte: o que acontece com a aplicação se ela se conectar enquanto o Postgres ainda está inicializando?
-->

---

## Armadilhas — e além de um único host

<div class="warn">

- Publicar **`latest`** — faça o deploy de `myapp:1.4.2` ou de um SHA de commit, para poder fazer rollback.
- **Segredos na imagem** (`COPY .env`, `ENV PASSWORD=…`) — qualquer camada pode ser lida.
- Editar um container em execução — perde-se no próximo deploy; altere o Dockerfile.
- Esquecer o `--build` — o Compose reaproveita a imagem antiga.

</div>

O Compose roda em **um único host**. Vários hosts, autorrecuperação, rolling updates → **Kubernetes** (Hands-on 5) ou serviços gerenciados: ECS/Fargate, Cloud Run, EKS, GKE, AKS.

---

## Pontos-chave

1. A escalabilidade horizontal exige **ambientes idênticos**; containers acabam com o *"na minha máquina funciona"*.
2. Um container é um **processo Linux** (namespaces + cgroups + camadas): rápido e leve, isola menos que uma VM.
3. **Dockerfile → imagem → registry → container**; builds multi-stage e a **ordem das camadas** dão imagens pequenas e rebuilds rápidos.
4. Publique com `-p`; em uma rede definida pelo usuário, os containers se encontram **pelo nome** — nunca `localhost`.
5. Containers são efêmeros: persista dados em **volumes**; fixe as versões das imagens.
6. O **Compose** descreve a stack; o `.env` preenche os marcadores e nunca é commitado.
7. Use **health checks** para que as dependências estejam prontas; além de um host, use um orquestrador.
