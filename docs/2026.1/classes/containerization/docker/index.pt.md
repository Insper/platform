
**Docker** é uma plataforma para construir, distribuir e executar aplicações em containers. Ela padroniza o empacotamento de uma aplicação e de todas as suas dependências — runtime, bibliotecas, variáveis de ambiente, configuração — em uma única unidade portátil, que roda de forma idêntica em qualquer máquina com o Docker Engine instalado.

---

## Conceitos centrais

``` mermaid
flowchart LR
  df[Dockerfile] -->|docker build| img[Imagem]
  img -->|docker run| c1[Container A]
  img -->|docker run| c2[Container B]
  img -->|docker push| reg[(Registry\nDocker Hub)]
  reg -->|docker pull| img2[Imagem em\noutro host]
```

**Dockerfile**
: Um arquivo de texto com instruções passo a passo para construir uma imagem. Cada instrução cria uma nova camada somente leitura.

**Imagem**
: Um snapshot imutável construído a partir de um Dockerfile. As imagens são o artefato que é versionado, enviado (push) para um registry e distribuído.

**Container**
: Uma instância em execução de uma imagem. Containers são processos isolados no SO hospedeiro — compartilham o kernel, mas têm seu próprio sistema de arquivos, rede e namespace de processos.

**Registry**
: Um servidor que armazena e distribui imagens. O [Docker Hub](https://hub.docker.com){:target="_blank"} é o registry público padrão. Registries privados (AWS ECR, GitHub Container Registry, GitLab Registry) são usados para imagens proprietárias.

---

## Dockerfile

Um Dockerfile define o ambiente em que a aplicação roda. Cada instrução acrescenta uma camada à imagem:

``` { .dockerfile title="Dockerfile" }
# Base image — choose the smallest that fits
FROM eclipse-temurin:21-jre-alpine

# Working directory inside the container
WORKDIR /app

# Copy the built artifact from the host
COPY target/app.jar app.jar

# Expose the port the application listens on (documentation only)
EXPOSE 8080

# Command to run when the container starts
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Builds multi-stage

Builds multi-stage separam o ambiente de build do ambiente de execução, produzindo uma imagem final menor:

``` { .dockerfile title="Dockerfile (multi-stage)" }
# Stage 1: build
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline          # cache dependencies separately
COPY src ./src
RUN mvn package -DskipTests

# Stage 2: run — only the JRE, no Maven, no source
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/app.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

A imagem final contém apenas o JRE e o JAR compilado — o Maven e a árvore de código-fonte são descartados.

---

### Cache de camadas

O Docker constrói as imagens camada por camada. Se uma camada não mudou desde o último build, o Docker reaproveita a versão em cache — pulando aquele passo por completo. **A ordem das camadas importa**: coloque as instruções que mudam com pouca frequência (dependências) antes das instruções que mudam com frequência (código-fonte).

``` mermaid
flowchart LR
    subgraph bad [Ordem ruim — cache invalidado a cada mudança no código]
        direction TB
        b1["COPY src ./src\n(muda a cada commit)"]:::changed --> b2["RUN mvn package"]:::changed --> b3["RUN mvn dependency:go-offline"]:::changed
    end
    subgraph good [Ordem boa — dependências em cache separadamente]
        direction TB
        g1["COPY pom.xml ."]:::cached --> g2["RUN mvn dependency:go-offline"]:::cached --> g3["COPY src ./src\n(muda a cada commit)"]:::changed --> g4["RUN mvn package\n(só reconstrói a aplicação)"]:::changed
    end
    classDef cached fill:#6c6,color:#fff
    classDef changed fill:#f66,color:#fff
```

O Dockerfile multi-stage acima já tira proveito disso: `RUN mvn dependency:go-offline` só é executado quando o `pom.xml` muda, e não a cada mudança no código.

---

## Comandos essenciais

### Gerenciando containers

| Comando | Descrição |
|:-|:-|
| `docker run <image>` | Cria e inicia um container a partir de uma imagem |
| `docker run -d <image>` | Executa em modo destacado (em segundo plano) |
| `docker run -p 8080:8080 <image>` | Mapeia a porta 8080 do host → porta 8080 do container |
| `docker run --name myapp <image>` | Atribui um nome ao container |
| `docker ps` | Lista os containers em execução |
| `docker ps -a` | Lista todos os containers (inclusive os parados) |
| `docker stop <container>` | Para um container em execução de forma controlada |
| `docker rm <container>` | Remove um container parado |
| `docker exec -it <container> sh` | Abre um shell interativo em um container em execução |
| `docker logs <container>` | Exibe os logs do container |
| `docker logs -f <container>` | Acompanha os logs em tempo real |
| `docker inspect <container>` | Metadados completos de um container em JSON |

### Gerenciando imagens

| Comando | Descrição |
|:-|:-|
| `docker build -t myapp:1.0 .` | Constrói uma imagem a partir do Dockerfile no diretório atual |
| `docker images` | Lista as imagens locais |
| `docker pull <image>` | Baixa uma imagem do registry |
| `docker push <image>` | Envia uma imagem para o registry |
| `docker rmi <image>` | Remove uma imagem local |
| `docker tag <image> <new-tag>` | Atribui uma nova tag (nome) a uma imagem |

### Limpeza

| Comando | Descrição |
|:-|:-|
| `docker system prune` | Remove containers parados, imagens órfãs (dangling) e redes não utilizadas |
| `docker volume ls` | Lista os volumes |
| `docker network ls` | Lista as redes |

---

## Redes

Cada container recebe seu próprio namespace de rede. O Docker oferece vários drivers de rede:

| Driver | Descrição |
|---|---|
| `bridge` (padrão) | Containers na mesma rede bridge podem se comunicar pelo nome do container |
| `host` | O container compartilha a pilha de rede do host (sem isolamento) |
| `none` | Sem acesso à rede |

Com o Docker Compose, todos os serviços compartilham automaticamente uma rede bridge padrão e podem se alcançar usando o nome do serviço como hostname.

---

## Volumes

Containers são efêmeros — os dados gravados dentro de um container se perdem quando ele é removido. **Volumes** persistem os dados além do ciclo de vida do container:

```bash
# Named volume (managed by Docker)
docker run -v mydata:/var/lib/postgresql/data postgres

# Bind mount (maps a host directory)
docker run -v /host/path:/container/path myapp
```

Volumes nomeados são preferidos em produção porque o Docker gerencia sua localização. Bind mounts são úteis durante o desenvolvimento para refletir as mudanças nos arquivos locais sem reconstruir a imagem.

---

[^1]: [Docker Documentation](https://docs.docker.com/){:target="_blank"}
[^2]: [Dockerfile Reference](https://docs.docker.com/reference/dockerfile/){:target="_blank"}
[^3]: [Docker Hub](https://hub.docker.com){:target="_blank"} — registry público de imagens
