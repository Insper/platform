O serviço `inventory` funciona no notebook da Ana com Java 21.0.4 e falha no do Bruno com Java 17; o servidor de staging está em outro fuso horário; a produção tem uma `libc` mais antiga. Cada ambiente é uma máquina ligeiramente diferente, e cada diferença é um bug esperando um deploy. Um **container** empacota a aplicação *junto com tudo de que ela precisa para rodar* — runtime, bibliotecas, configurações padrão — em um único artefato imutável que se comporta da mesma forma em um notebook, na CI e em um cluster Kubernetes.

---

## Containers são processos, não VMs pequenas

Uma **máquina virtual (VM)** emula hardware: cada VM inicializa o próprio kernel sobre um hipervisor. Um **container** é um processo Linux comum que o kernel *isola* e *limita*. Todos os containers de um host compartilham o kernel do host.

``` mermaid
flowchart TB
    subgraph VMs["Máquinas virtuais"]
        direction TB
        hw1["Hardware"] --> hv["Hipervisor"]
        hv --> g1["Kernel do SO convidado"] --> a1["catalog"]
        hv --> g2["Kernel do SO convidado"] --> a2["inventory"]
    end
    subgraph CT["Containers"]
        direction TB
        hw2["Hardware"] --> k["Kernel do SO hospedeiro<br/>namespaces + cgroups"]
        k --> c1["catalog<br/>(processo)"]
        k --> c2["inventory<br/>(processo)"]
    end
```

Dois recursos do kernel fazem o trabalho[^4]:

| Recurso | O que faz | Exemplo |
|---|---|---|
| **Namespaces** | Dão ao processo a própria *visão* do sistema: IDs de processo (`pid`), interfaces de rede (`net`), pontos de montagem (`mnt`), hostname (`uts`), usuários (`user`), IPC | Dentro do container, o `catalog` é o PID 1 e só vê os próprios arquivos e o próprio `eth0` |
| **Control groups (cgroups v2)** | *Limitam e contabilizam* os recursos que o processo pode usar: tempo de CPU, memória, I/O, número de processos | O `inventory` pode usar no máximo 1 CPU e 1 GiB; acima de 1 GiB o kernel o mata (`OOMKilled`) |

| | Máquina virtual | Container |
|---|---|---|
| Fronteira de isolamento | Hardware (hipervisor) — forte | Kernel (namespaces) — mais fraca; um bug no kernel afeta todos |
| Tempo de inicialização | Dezenas de segundos a minutos (boot de um SO) | Milissegundos a segundos (iniciar um processo) |
| Tamanho | Gigabytes (um SO completo) | Megabytes a algumas centenas de MB |
| Densidade por host | Dezenas | Centenas |
| Uso típico | Isolamento multi-inquilino, kernels/SOs diferentes | Empacotar e executar serviços |

Como o isolamento é mais fraco, provedores de nuvem que executam containers de *outros clientes* em hosts compartilhados os envolvem em VMs leves (AWS Firecracker sob o Lambda e o Fargate, gVisor sob o Google Cloud Run). Para os seus serviços nos seus nós, containers comuns são a norma.

!!! warning "A JVM precisa saber que está em um container"

    Uma JVM que dimensiona o heap pela memória do *host* (64 GB) dentro de um container limitado a 1 GiB será morta pelo kernel na primeira vez que crescer. JVMs modernas (Java 10+) leem os limites do cgroup; dimensione o heap como porcentagem do limite do container com `-XX:MaxRAMPercentage=75` e deixe espaço para metaspace, pilhas de threads e buffers diretos.

---

## O que é uma imagem

Uma **imagem** é um modelo somente leitura a partir do qual containers são iniciados. A **Open Container Initiative (OCI)** padroniza seu formato, de modo que uma imagem construída com Docker roda em containerd, CRI-O ou Podman[^1]. Uma imagem OCI é:

- uma lista de **camadas** (*layers*) — arquivos tar comprimidos, cada um com as mudanças no sistema de arquivos de um passo do build;
- uma **config** — variáveis de ambiente, o comando padrão, o usuário, as portas expostas;
- um **manifest** que lista a config e as camadas por seus **digests** (hashes SHA-256 do conteúdo).

``` mermaid
flowchart LR
    m["Manifest<br/>sha256:9f2c…"] --> cfg["Config<br/>ENTRYPOINT, USER, ENV"]
    m --> l1["Camada 1: arquivos do SO base<br/>(distroless / Alpine)"]
    m --> l2["Camada 2: runtime Java"]
    m --> l3["Camada 3: dependências (jars)"]
    m --> l4["Camada 4: classes da aplicação"]
```

As camadas são **endereçadas por conteúdo e compartilhadas**: dez serviços do BoxOffice construídos sobre a mesma imagem base armazenam e baixam as camadas base uma única vez. Quando um container inicia, o runtime empilha as camadas somente leitura com um sistema de arquivos overlay e adiciona por cima uma fina camada gravável — que desaparece com o container. Por isso o estado precisa viver em volumes ou em serviços de apoio.

### Tags se movem, digests não

`boxoffice/inventory:1.8.3` é uma **tag**: um ponteiro amigável que qualquer pessoa com permissão de push pode mover para outra imagem. `boxoffice/inventory@sha256:9f2c…` é um **digest**: identifica exatamente um conteúdo. Deploys de produção devem referenciar digests (ou tags imutáveis garantidas pelo registry), para que "a imagem que testamos" seja comprovadamente "a imagem que executamos".

---

## Um Dockerfile de produção para um serviço do BoxOffice

O serviço `catalog` é uma aplicação Spring Boot 4 em Java 21. Um Dockerfile ingênuo copia o código-fonte e executa o Maven dentro da imagem final — produzindo uma imagem grande que contém o compilador, o cache do Maven e o código-fonte. Um **build multi-stage** compila em um estágio e copia apenas o resultado para um estágio de execução mínimo[^2]:

```dockerfile title="catalog/Dockerfile"
# ---- build stage: JDK + Maven, discarded at the end ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
# 1. dependencies first: this layer is cached until pom.xml changes
COPY pom.xml .
RUN mvn -q dependency:go-offline
# 2. then the source code, which changes on every commit
COPY src ./src
RUN mvn -q package -DskipTests \
 && java -Djarmode=tools -jar target/catalog.jar extract --layers --launcher --destination target/extracted

# ---- runtime stage: only a JRE, no shell, non-root ----
FROM gcr.io/distroless/java21-debian12:nonroot
WORKDIR /app
# Spring Boot layers: rarely-changing first, application classes last
COPY --from=build /src/target/extracted/dependencies/ ./
COPY --from=build /src/target/extracted/spring-boot-loader/ ./
COPY --from=build /src/target/extracted/snapshot-dependencies/ ./
COPY --from=build /src/target/extracted/application/ ./
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
USER nonroot
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Cada linha tem um motivo:

| Escolha | Efeito |
|---|---|
| Copiar o `pom.xml` e resolver as dependências **antes** de copiar `src` | Uma mudança de código reconstrói só as últimas camadas; os builds de CI caem de minutos para segundos |
| Extração do **jar em camadas** do Spring Boot | Os ~60 MB de dependências viram uma camada que muda raramente[^3]; um deploy envia apenas a camada da aplicação, de algumas centenas de KB |
| Imagem base **distroless** | Sem shell, sem gerenciador de pacotes: menor superfície de ataque e menos CVEs para corrigir (Alpine ou `eclipse-temurin:21-jre` são alternativas comuns) |
| `USER nonroot` | Um processo comprometido não é root dentro do container |
| `MaxRAMPercentage=75` | O heap acompanha o limite de memória do container |
| `ExitOnOutOfMemoryError` | Uma JVM em mau estado morre rápido e é substituída, em vez de continuar mancando |
| `ENTRYPOINT` em forma exec (array JSON) | O Java roda como PID 1 e recebe o `SIGTERM` diretamente, então o encerramento gracioso funciona |

Adicione um `.dockerignore` (com `target/`, `.git/`, `*.log`, `.env`) para que o contexto de build enviado ao builder fique pequeno e segredos não vazem para as camadas.

```bash
docker build -t boxoffice/catalog:1.4.0 catalog/
docker image ls boxoffice/catalog            # check the size
docker run --rm -p 8080:8080 --memory=512m --cpus=1 \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/catalog boxoffice/catalog:1.4.0
```

!!! example "BoxOffice: o que o multi-stage nos deu"

    Com a imagem ingênua de um único estágio (JDK + Maven + fontes) o time mediu uma imagem de cerca de 800 MB; a imagem distroless multi-stage ficou abaixo de 250 MB, e uma mudança típica de código enviava uma única camada pequena. Seus números serão diferentes — meça com `docker image ls` e `docker history` —, mas a ordem de grandeza é típica. Imagens menores importam para a **velocidade de escala**: quando o HPA adiciona 20 pods durante a venda, cada nó novo precisa baixar a imagem antes que o pod possa iniciar.

### Encerramento gracioso: a outra metade da descartabilidade

Quando o Kubernetes substitui um pod, ele envia `SIGTERM`, espera `terminationGracePeriodSeconds` (30 s por padrão) e então envia `SIGKILL`. Um serviço que morre instantaneamente derruba todas as requisições em andamento — inclusive o pagamento de alguém. O Spring Boot resolve isso com duas propriedades:

```yaml title="catalog/src/main/resources/application.yaml"
server:
  shutdown: graceful            # stop accepting, finish in-flight requests
spring:
  lifecycle:
    timeout-per-shutdown-phase: 20s
```

---

## Registries e a cadeia de suprimentos { #supply-chain }

As imagens ficam guardadas em um **registry** (Docker Hub, GitHub Container Registry, Amazon ECR, Google Artifact Registry, Harbor). Como uma imagem é tudo o que vai rodar em produção, o caminho do código-fonte até o registry — a **cadeia de suprimentos de software** — é um alvo de ataque. A higiene mínima do pipeline do BoxOffice[^5]:

| Prática | Ferramentas de exemplo | Protege contra |
|---|---|---|
| **Varrer** imagens em busca de vulnerabilidades conhecidas (CVEs) e falhar nas críticas | Trivy, Grype, varredura do registry | Publicar uma imagem base com um exploit conhecido |
| Gerar um **SBOM** (Software Bill of Materials: a lista de todos os pacotes da imagem) | Syft, `docker buildx --sbom`, CycloneDX, SPDX | Não saber se você é afetado pelo próximo Log4Shell |
| **Assinar** imagens e verificar a assinatura no deploy | Sigstore Cosign, Kyverno / políticas de admissão | Uma imagem adulterada enviada ao seu registry |
| Registrar a **proveniência** (quem construiu o quê, a partir de qual commit) | Atestados de proveniência SLSA, GitHub artifact attestations | Uma imagem construída fora do pipeline |
| Fixar imagens base e dependências; reconstruir regularmente | Renovate, Dependabot | Deriva silenciosa e patches desatualizados |

A [aula de Rede e segurança](../../network-security/zero-trust/index.md) discute a segurança da cadeia de suprimentos em profundidade; a página de [Entrega](../delivery/index.md) conecta esses passos ao pipeline de CI.

---

## Docker Compose: o sistema inteiro em uma máquina

O Compose descreve uma aplicação com vários containers em um único arquivo YAML. Para o BoxOffice, ele é o **ambiente local de desenvolvimento e testes**, não a plataforma de produção:

```yaml title="compose.yaml (excerpt)"
services:
  catalog:
    build: ./catalog
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/boxoffice
      SPRING_DATA_REDIS_HOST: redis
    depends_on:
      db: { condition: service_healthy }
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 512M }
  db:
    image: postgres:17
    environment:
      POSTGRES_DB: boxoffice
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
  redis:
    image: redis:8-alpine
volumes:
  pgdata: {}
```

Os serviços se encontram pelo **nome do serviço** (`db`, `redis`) por meio do DNS interno do Compose — nunca por `localhost`, que dentro de um container significa o próprio container. O Compose não tem escalonamento entre vários hosts, nem autorrecuperação entre máquinas, nem rolling updates; quando você precisa disso, precisa de um orquestrador — o assunto da [próxima página](../kubernetes/index.md).

---

## Trade-offs

| Decisão | Opção A | Opção B | Regra prática |
|---|---|---|---|
| Imagem base | Distroless / mínima | Imagem de SO completa (Debian, Ubuntu) | Mínima em produção; completa só quando você precisa de ferramentas de depuração dentro dela (prefira containers efêmeros de debug) |
| Build | Dockerfile | Buildpacks (`spring-boot:build-image`), Jib | Buildpacks/Jib dão boas camadas sem Dockerfile; um Dockerfile dá controle total |
| Inicialização do Java | JVM com JIT | GraalVM native image / CRaC | Imagens nativas iniciam em milissegundos e usam menos memória (bom para FaaS e escala rápida), ao custo de builds mais longos e configuração de reflexão |
| Referência | Tag | Digest | Digests (ou tags imutáveis) em produção |

!!! tip "Na entrevista"

    Containers aparecem quando você fala de **deploy e velocidade de escala**. Dois pontos objetivos bastam: "Os serviços são empacotados como imagens OCI imutáveis, promovidas por digest de staging para produção" e "novas réplicas iniciam em segundos porque as imagens são pequenas e em camadas — o tempo de download importa quando escalamos para o pico". Se insistirem no isolamento, mencione que containers compartilham o kernel e que plataformas multi-inquilino acrescentam micro-VMs (Firecracker, gVisor).

!!! warning "Armadilhas"

    - **`latest` em produção**: você não sabe o que está rodando, e o rollback fica ambíguo.
    - **Segredos gravados nas camadas**: um `COPY .env` ou `ARG PASSWORD` fica no histórico da imagem para sempre — mesmo que uma camada posterior apague o arquivo.
    - **Rodar como root** e com shell completo: uma RCE vira uma porta de entrada.
    - **Sem limite de memória, ou com heap maior que o limite**: reinícios `OOMKilled` aleatórios sob carga.
    - **`ENTRYPOINT` em forma shell** (`ENTRYPOINT java -jar app.jar`): o `sh` vira PID 1, engole o `SIGTERM`, e cada deploy mata requisições no meio.
    - **Gravar estado no sistema de arquivos do container**: ele some no próximo reinício.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    NS["namespaces + cgroups"] --> CT["container =<br/>processo isolado"]
    IMG["imagem OCI: camadas,<br/>config, manifest"] --> CT
    IMG --> DIG["digest, não tag:<br/>build uma vez, promova"]
    DIG --> DEL["CI e GitOps<br/>→ Entrega"]
    IMG --> SC["scan, SBOM, assinatura<br/>→ Redes e segurança"]
    CT --> MEM["limite de memória → OOMKilled<br/>JVM MaxRAMPercentage"]
    CT --> SIG["SIGTERM, desligamento gracioso<br/>→ rolling updates seguros"]
    MEM --> K8S["pods, probes, limits<br/>→ Kubernetes"]
    SIG --> K8S
    CMP["Docker Compose:<br/>ambiente local"] --> CT
    CT --> VM["Firecracker, gVisor<br/>sob FaaS → Compute"]
```

**Componentes da paleta:** [`app`](../../../reference/components/compute/index.md#app) (todo serviço do BoxOffice é uma imagem) · [`worker`](../../../reference/components/compute/index.md#worker) · [`serverless`](../../../reference/components/compute/index.md#serverless) (containers dentro de micro-VMs). **Cenários:** `scale-out` (imagens pequenas sobem réplicas rápido), `serverless-burst` (cold starts). **Continua em:** [Kubernetes](../kubernetes/index.md), [Entrega](../delivery/index.md), [Redes e segurança — segurança da cadeia de suprimentos](../../network-security/zero-trust/index.md#supply-chain-security), [Compute — serverless e autoscaling](../../compute/serverless-autoscaling/index.md), [Hands-on 1 — container](../../../hands-on/1/container/index.md).

---

[^1]: Open Container Initiative. [OCI Image Format Specification](https://github.com/opencontainers/image-spec){target="_blank"}.
[^2]: Docker. [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/){target="_blank"} e [Dockerfile best practices](https://docs.docker.com/build/building/best-practices/){target="_blank"}.
[^3]: Spring Boot reference. [Efficient container images](https://docs.spring.io/spring-boot/reference/packaging/container-images/efficient-images.html){target="_blank"}.
[^4]: KERRISK, M. [Namespaces in operation](https://lwn.net/Articles/531114/){target="_blank"}. LWN.net, 2013.
[^5]: OpenSSF. [SLSA — Supply-chain Levels for Software Artifacts](https://slsa.dev/){target="_blank"}.
