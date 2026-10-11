
No [Hands-on 1](../../../hands-on/1/index.md), você roda o serviço de contas com `mvn spring-boot:run`. Isso funciona porque o seu notebook tem o JDK, o Maven e as variáveis de ambiente certos. Para rodar o mesmo serviço na máquina de um colega, em um servidor de CI ou em uma VM na nuvem, você teria de reproduzir toda essa configuração à mão — e mantê-la sincronizada para sempre. O Docker transforma a configuração em um arquivo (o Dockerfile) e o resultado em um artefato (a imagem) que roda do mesmo jeito em qualquer lugar.

O **Docker** é uma plataforma para construir, distribuir e executar aplicações em containers[^1]. Ele padroniza o empacotamento de uma aplicação e de todas as suas dependências — runtime, bibliotecas, variáveis de ambiente, configuração — em uma única unidade portátil que roda de forma idêntica em qualquer máquina com o Docker Engine instalado.

---

## Conceitos centrais

``` mermaid-sim
flowchart LR
  df[Dockerfile] -->|docker build| img[Imagem]
  img -->|docker run| c1[Container A]
  img -->|docker run| c2[Container B]
  img -->|docker push| reg[(Registry\nDocker Hub)]
  reg -->|docker pull| img2[Imagem em\noutro host]
```

**Dockerfile**
: Um arquivo de texto com instruções passo a passo para construir uma imagem. Cada instrução que altera o sistema de arquivos (`RUN`, `COPY`, `ADD`) cria uma nova camada somente leitura.

**Imagem**
: Um snapshot imutável construído a partir de um Dockerfile. As imagens são o artefato que é versionado, enviado para um registry e distribuído. Uma imagem é identificada por um nome e uma **tag** (`eclipse-temurin:25-jre-alpine`, `store/account:1.0`); quando você omite a tag, o Docker assume `latest`.

**Container**
: Uma instância em execução de uma imagem. Containers são processos isolados no SO hospedeiro — compartilham o kernel, mas têm o próprio sistema de arquivos, a própria rede e o próprio namespace de processos (veja [O que um container realmente é](../index.md#what-a-container-really-is)).

**Registry**
: Um servidor que armazena e distribui imagens. O [Docker Hub](https://hub.docker.com){:target="_blank"}[^3] é o registry público padrão. Registries privados (AWS ECR, GitHub Container Registry, GitLab Registry) são usados para imagens proprietárias.

---

## Como o Docker funciona: cliente, daemon, registry

O comando `docker` que você digita é apenas um **cliente**. Ele envia cada requisição para o **daemon do Docker** (`dockerd`), um serviço em segundo plano que constrói imagens, baixa imagens dos registries e pede ao runtime de containers (`containerd`, que usa o `runc`) que inicie os processos de fato.

``` mermaid-sim
flowchart LR
    cli["CLI docker"] -->|API REST| daemon["daemon dockerd"]
    daemon -->|baixa a imagem| reg[(Registry)]
    daemon -->|cria o container| rt["containerd + runc"]
    rt -->|inicia o processo| proc["processo do container"]
```

É por isso que `docker ps` falha com *"Cannot connect to the Docker daemon"* quando o Docker Desktop não está rodando: o cliente está bem, mas não há ninguém escutando do outro lado.

---

## Dockerfile

Um Dockerfile define o ambiente em que a aplicação roda. Cada instrução adiciona uma camada à imagem[^2]:

``` { .dockerfile title="Dockerfile" }
# Base image — choose the smallest that fits
FROM eclipse-temurin:25-jre-alpine

# Working directory inside the container
WORKDIR /app

# Copy the built artifact from the host (run `mvn package` first)
COPY target/*.jar app.jar

# Expose the port the application listens on (documentation only)
EXPOSE 8080

# Command to run when the container starts
ENTRYPOINT ["java", "-jar", "app.jar"]
```

O Dockerfile usado nos serviços da loja no [Hands-on 1](../../../hands-on/1/containerization/index.md) segue o mesmo padrão: uma imagem base com Java 25, o JAR gerado pelo Maven e `java -jar` como ponto de entrada.

As instruções que você vai usar com mais frequência:

| Instrução | Finalidade | Exemplo |
|---|---|---|
| `FROM` | Imagem base de partida (sempre a primeira) | `FROM eclipse-temurin:25-jre-alpine` |
| `WORKDIR` | Define (e cria) o diretório de trabalho | `WORKDIR /app` |
| `COPY` | Copia arquivos do contexto de build para a imagem | `COPY target/*.jar app.jar` |
| `RUN` | Executa um comando **durante o build** e salva o resultado como uma camada | `RUN apk add --no-cache curl` |
| `ENV` | Define uma variável de ambiente para o build e a execução | `ENV SPRING_PROFILES_ACTIVE=prod` |
| `ARG` | Variável de build (não disponível quando o container roda) | `ARG VERSION=1.0` |
| `EXPOSE` | Documenta a porta em que a aplicação escuta (**não** a publica) | `EXPOSE 8080` |
| `USER` | Executa as instruções seguintes e o container com esse usuário | `USER app` |
| `ENTRYPOINT` / `CMD` | O que roda **quando o container inicia** | `ENTRYPOINT ["java", "-jar", "app.jar"]` |

!!! info "`RUN` vs `CMD` vs `ENTRYPOINT`"
    `RUN` executa enquanto a imagem é **construída** (instalando pacotes, compilando). `ENTRYPOINT` e `CMD` definem o que executa quando um container **inicia**. Quando os dois estão presentes, o `CMD` fornece os *argumentos* padrão para o `ENTRYPOINT`, e qualquer coisa que você digitar depois do nome da imagem em `docker run <image> …` substitui o `CMD`. Prefira a forma exec, com colchetes (`["java", "-jar", "app.jar"]`): a JVM se torna o PID 1 e recebe o `SIGTERM` enviado por `docker stop`, de modo que o Spring Boot consegue encerrar de forma graciosa.

### `.dockerignore`

`docker build .` envia o diretório inteiro (o **contexto de build**) para o daemon. Um arquivo `.dockerignore` deixa de fora o que a imagem não precisa — deixando os builds mais rápidos e evitando que segredos acabem em uma camada:

``` { .text title=".dockerignore" }
.git
.idea
*.iml
.env
target/*
!target/*.jar
```

### Builds multi-stage

Builds multi-stage separam o ambiente de build do ambiente de execução, produzindo uma imagem final menor. Eles também eliminam a necessidade de ter Maven e um JDK instalados na máquina que constrói a imagem:

``` { .dockerfile title="Dockerfile (multi-stage)" }
# Stage 1: build
FROM maven:3.9-eclipse-temurin-25 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline          # cache dependencies separately
COPY src ./src
RUN mvn package -DskipTests

# Stage 2: run — only the JRE, no Maven, no source
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

A imagem final contém apenas o JRE e o JAR compilado — o Maven e o código-fonte são descartados.

!!! note "Por que `*.jar` e não `app.jar`?"
    O Maven nomeia o artefato como `<artifactId>-<version>.jar` (por exemplo, `account-service-0.0.1-SNAPSHOT.jar`), não `app.jar`. O curinga o encontra — o Spring Boot guarda o JAR enxuto original como `*.jar.original`, que o padrão não pega — e o `COPY` o renomeia para `app.jar` dentro da imagem.

---

### Cache de camadas { #layer-caching }

O Docker constrói imagens camada por camada. Se uma camada não mudou desde o último build, o Docker reaproveita a versão em cache — pulando aquela etapa por completo. Quando uma camada muda, **essa camada e todas as que vêm depois dela** são reconstruídas. **A ordem das camadas importa**: coloque as instruções que mudam pouco (dependências) antes das que mudam com frequência (código-fonte).

``` mermaid-sim
flowchart LR
    subgraph bad [Ordem ruim — cache invalidado a cada mudança no código]
        direction TB
        b1["COPY src ./src\n(muda a cada commit)"]:::changed --> b2["RUN mvn package"]:::changed --> b3["RUN mvn dependency:go-offline"]:::changed
    end
    subgraph good [Ordem boa — dependências em cache separado]
        direction TB
        g1["COPY pom.xml ."]:::cached --> g2["RUN mvn dependency:go-offline"]:::cached --> g3["COPY src ./src\n(muda a cada commit)"]:::changed --> g4["RUN mvn package\n(só reconstrói a aplicação)"]:::changed
    end
    classDef cached fill:#6c6,color:#fff
    classDef changed fill:#f66,color:#fff
```

O Dockerfile multi-stage acima já aproveita isso: `RUN mvn dependency:go-offline` só roda quando o `pom.xml` muda, e não a cada mudança no código.

---

## Comandos essenciais

### Gerenciando containers

| Comando | Descrição |
|:-|:-|
| `docker run <image>` | Cria e inicia um container a partir de uma imagem |
| `docker run -d <image>` | Executa em modo destacado (em segundo plano) |
| `docker run -p 8080:8080 <image>` | Publica uma porta: porta 8080 do host → porta 8080 do container (`host:container`) |
| `docker run --name myapp <image>` | Atribui um nome ao container |
| `docker run -e KEY=value <image>` | Define uma variável de ambiente |
| `docker run --rm <image>` | Remove o container automaticamente quando ele termina |
| `docker ps` | Lista os containers em execução |
| `docker ps -a` | Lista todos os containers (inclusive os parados) |
| `docker stop <container>` | Para um container em execução de forma graciosa (`SIGTERM` e, após 10 s, `SIGKILL`) |
| `docker rm <container>` | Remove um container parado |
| `docker exec -it <container> sh` | Abre um shell interativo em um container em execução |
| `docker logs <container>` | Mostra os logs do container (o stdout e o stderr dele) |
| `docker logs -f <container>` | Acompanha os logs em tempo real |
| `docker inspect <container>` | Metadados completos do container, em JSON |

### Gerenciando imagens

| Comando | Descrição |
|:-|:-|
| `docker build -t myapp:1.0 .` | Constrói uma imagem a partir do Dockerfile do diretório atual |
| `docker images` | Lista as imagens locais |
| `docker pull <image>` | Baixa uma imagem do registry |
| `docker push <image>` | Envia uma imagem para o registry |
| `docker rmi <image>` | Remove uma imagem local |
| `docker tag <image> <new-tag>` | Atribui um novo nome (tag) a uma imagem |

### Limpeza

| Comando | Descrição |
|:-|:-|
| `docker system prune` | Remove containers parados, imagens órfãs (dangling) e redes não usadas |
| `docker volume ls` | Lista os volumes |
| `docker network ls` | Lista as redes |

!!! example "Depurando um container que não inicia"
    Um container que termina logo depois do `docker run` é o primeiro problema mais comum. Siga as evidências:

    ``` bash
    docker ps -a                    # STATUS shows "Exited (1) 3 seconds ago"
    docker logs account             # the application's own error message (e.g. cannot reach the database)
    docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' account   # 137 + true = killed for memory
    docker run -it --rm --entrypoint sh store/account:1.0                 # open a shell in the image to look around
    ```

---

## Redes

Cada container recebe o próprio namespace de rede — o próprio endereço IP e o próprio `localhost`. O Docker oferece vários drivers de rede[^4]:

| Driver | Descrição |
|---|---|
| `bridge` | Uma rede virtual privada no host. Em uma rede bridge **definida pelo usuário** (`docker network create …`), os containers se encontram **pelo nome** por meio do DNS embutido do Docker. Na bridge **padrão** (usada quando você não passa `--network`), eles só podem usar endereços IP |
| `host` | O container compartilha a pilha de rede do host (sem isolamento) |
| `none` | Sem acesso à rede |

``` bash
docker network create store-net
docker run -d --name db --network store-net -e POSTGRES_PASSWORD=secret postgres:17
docker run --rm --network store-net postgres:17 pg_isready -h db   # "db" resolves to the database container
```

Com o Docker Compose, todos os serviços são ligados a uma rede definida pelo usuário que o Compose cria automaticamente, então eles se encontram usando o nome do serviço como hostname ([Docker Compose](../compose/index.md)).

!!! warning "`EXPOSE` não publica uma porta, e `localhost` não é o host"
    - `EXPOSE 8080` é documentação. Para acessar o container pelo navegador, você precisa **publicar** a porta com `-p 8080:8080`.
    - Dentro de um container, `localhost` é o próprio container. Uma aplicação Spring Boot configurada com `jdbc:postgresql://localhost:5432/store` não vai encontrar um banco de dados rodando em outro container — use o nome do container (ou do serviço): `jdbc:postgresql://db:5432/store`.

---

## Volumes

Containers são efêmeros — os dados gravados dentro de um container se perdem quando o container é removido. **Volumes** persistem dados além do ciclo de vida do container:

```bash
# Named volume (managed by Docker)
docker run -v mydata:/var/lib/postgresql/data postgres:17

# Bind mount (maps a host directory)
docker run -v /host/path:/container/path myapp
```

Volumes nomeados são preferidos em produção porque o Docker gerencia a localização deles. Bind mounts são úteis durante o desenvolvimento para refletir mudanças em arquivos locais sem reconstruir a imagem.

!!! warning "O PostgreSQL 18 mudou o caminho dos dados"
    Até o `postgres:17`, a imagem oficial guarda os dados em `/var/lib/postgresql/data`. A partir do `postgres:18`, os dados ficam em um diretório específico da versão (`/var/lib/postgresql/18/docker`), e o volume deve ser montado em `/var/lib/postgresql`. Uma imagem com a tag `postgres` ou `postgres:latest` mudou de comportamento silenciosamente quando a 18 virou `latest` — mais um motivo para **fixar a versão principal** das imagens das quais você depende.

---

## Boas práticas e armadilhas

!!! tip "Boas práticas"
    - **Fixe as versões**: `eclipse-temurin:25-jre-alpine`, `postgres:17` — nunca um `latest` implícito para algo de que você faz deploy.
    - **Imagens base pequenas** (`-alpine`, `-jre`, distroless): downloads mais rápidos e menor superfície de ataque.
    - **Um processo por container**: o serviço, e não o serviço *e* o banco de dados dele.
    - **Rode como usuário não root** (`USER`), para que uma aplicação comprometida não rode como root dentro do container.
    - **Configuração por variáveis de ambiente**, para que a mesma imagem rode em todos os ambientes.

!!! warning "Erros comuns"
    - **Segredos na imagem** (`COPY .env`, `ENV DB_PASSWORD=…`): qualquer pessoa que baixar a imagem consegue ler todas as camadas. Passe os segredos em tempo de execução.
    - **Gerar o JAR fora e esquecer de gerá-lo de novo**: com um Dockerfile de estágio único, o `docker build` copia o que estiver em `target/` — rode `mvn package` antes, ou use um build multi-stage.
    - **Código-fonte copiado antes das dependências**: cada commit baixa todas as dependências do Maven de novo (veja [Cache de camadas](#layer-caching)).

---

## Conexões

- [Hands-on 1 — Containerização](../../../hands-on/1/containerization/index.md) — o Dockerfile do serviço de contas e o arquivo do Compose.
- [Docker Compose](../compose/index.md) — executando vários containers juntos.
- [Hands-on 4](../../../hands-on/4/index.md) — o Jenkins constrói e envia imagens em um pipeline.
- [Hands-on 5](../../../hands-on/5/index.md) — o Kubernetes executa essas imagens em um cluster.

## Pontos-chave

- A CLI `docker` conversa com um daemon que constrói imagens, baixa imagens dos registries e inicia containers por meio do containerd/runc.
- Um Dockerfile é uma receita; cada instrução que altera o sistema de arquivos é uma camada em cache — coloque as dependências **antes** do código-fonte.
- **Builds multi-stage** mantêm o Maven e o código-fonte fora da imagem final; o `ENTRYPOINT` na forma exec permite que a JVM encerre de forma graciosa.
- Publique portas com `-p host:container`; containers em uma rede **definida pelo usuário** se encontram pelo nome, e `localhost` significa o próprio container.
- Containers são descartáveis: mantenha os dados em **volumes**, a configuração em variáveis de ambiente e fixe as versões das imagens.

---

[^1]: [Docker Documentation](https://docs.docker.com/){:target="_blank"}
[^2]: [Dockerfile Reference](https://docs.docker.com/reference/dockerfile/){:target="_blank"}
[^3]: [Docker Hub](https://hub.docker.com){:target="_blank"} — registry público de imagens
[^4]: [Docker Networking — Bridge network driver](https://docs.docker.com/engine/network/drivers/bridge/){:target="_blank"}
