
Rodar o serviço de contas e o banco de dados dele com comandos `docker` puros já exige um punhado de linhas de comando longas, e a ordem importa:

``` bash
docker network create store
docker volume create db-data
docker run -d --name db --network store \
  -e POSTGRES_DB=store -e POSTGRES_USER=store -e POSTGRES_PASSWORD=secret \
  -v db-data:/var/lib/postgresql/data postgres:17
docker build -t store/account ./account-service
docker run -d --name account --network store -p 8080:8080 \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/store store/account
```

Acrescente um gateway, um serviço de autenticação, Redis e Kafka, e isso vira um script propenso a erros que cada desenvolvedor precisa guardar na cabeça — e que ninguém consegue revisar em um pull request. O Docker Compose substitui tudo isso por um arquivo.

O **Docker Compose** é uma ferramenta para definir e executar aplicações com vários containers usando um **arquivo YAML declarativo**[^1]. Em vez de rodar vários comandos `docker run` cheios de flags, você descreve a stack inteira da aplicação — serviços, redes, volumes, variáveis de ambiente — em um único `compose.yaml` e inicia tudo com um só comando.

---

## Estrutura básica

``` { .yaml title="compose.yaml" }
name: myapp

services:
  web:
    build: ./web          # build from a local Dockerfile
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
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

Todos os serviços compartilham uma rede bridge padrão. Cada serviço pode ser acessado pelos outros usando o **nome do serviço como hostname** (`db`, `app`, `web`).

``` mermaid-sim
flowchart LR
    user[Usuário] -->|HTTP :80| web[Web]
    subgraph myapp [172.18.0.0/16]
        web
        app[App]
        db[(Banco de dados :5432)]
    end
    web -->|API| app
    app -->|JDBC| db
```

O vocabulário de um arquivo Compose[^2]:

| Chave | Significado |
|---|---|
| `name` | O nome do **projeto**; vira prefixo de containers, redes e volumes (`myapp-db-1`, `myapp_db-data`) |
| `services` | Uma entrada por container a executar. Cada serviço é um modelo: você pode rodar várias réplicas dele |
| `image` | Usa uma imagem existente de um registry (`postgres:17`) |
| `build` | Constrói a imagem a partir de um Dockerfile local (caminho do contexto de build) |
| `ports` | Publica portas `host:container` na sua máquina — apenas o que você precisa acessar de fora |
| `environment` | Variáveis de ambiente passadas ao container |
| `depends_on` | Ordem de inicialização entre os serviços |
| `volumes` | Volumes nomeados ou bind mounts; o `volumes:` de nível superior declara os nomeados |

!!! info "`docker compose`, e não `docker-compose`; e sem `version:`"
    O Compose v2 é um plugin da CLI do Docker: o comando é `docker compose` (com espaço). O antigo `docker-compose` (v1), escrito em Python, não é mais suportado desde 2023. A chave de nível superior `version: "3.8"` que você vê em tutoriais antigos está obsoleta — o Compose a ignora e mostra um aviso. O nome de arquivo preferido é `compose.yaml`; `docker-compose.yml` ainda é aceito.

---

## Comandos principais

| Comando | Descrição |
|:-|:-|
| `docker compose up` | Cria e inicia todos os serviços |
| `docker compose up -d` | Inicia em modo destacado (em segundo plano) |
| `docker compose up --build` | Reconstrói as imagens antes de iniciar |
| `docker compose down` | Para e remove containers e redes |
| `docker compose down -v` | Remove também os volumes nomeados |
| `docker compose logs -f` | Acompanha os logs de todos os serviços |
| `docker compose logs -f app` | Acompanha os logs de um serviço específico |
| `docker compose ps` | Lista os serviços em execução |
| `docker compose exec app sh` | Abre um shell em um serviço em execução |
| `docker compose restart app` | Reinicia um único serviço |
| `docker compose config` | Mostra o arquivo final, com todas as `${VARIABLES}` resolvidas — a primeira coisa a verificar quando um valor parece errado |

---

## Redes: nomes de serviço, e não `localhost`

O Compose cria uma rede por projeto e registra cada serviço no DNS embutido do Docker[^3]. Dentro dessa rede, os serviços conversam entre si na **porta do container** usando o **nome do serviço**; o mapeamento de `ports:` só importa para o tráfego que vem da sua máquina.

| De | Para o banco de dados | URL |
|---|---|---|
| O container `app` | serviço `db` | `jdbc:postgresql://db:5432/myapp` |
| O seu notebook (IDE, `psql`, DBeaver) | porta publicada | `jdbc:postgresql://localhost:5432/myapp` (apenas se houver `ports: - 5432:5432`) |

!!! warning "O bug mais comum do Compose: `localhost`"
    Um serviço configurado com `localhost:5432` funciona quando você o roda pela IDE e falha assim que roda dentro do Compose, com *Connection refused*: dentro de um container, `localhost` é o próprio container. Use o nome do serviço (`db`) e passe a URL por uma variável de ambiente, para que a mesma imagem funcione nos dois lugares.

É também assim que a loja mantém os serviços privados: no [Hands-on 2](../../../hands-on/2/index.md), apenas o gateway publica uma porta; os demais serviços só são acessíveis de dentro da rede do Compose.

---

## Variáveis de ambiente

Deixar credenciais fixas dentro do `compose.yaml` é um risco de segurança e impede configurações específicas por ambiente. Use arquivos `.env` em vez disso:

``` { .yaml title="compose.yaml" }
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-myapp}       # (1)!
      POSTGRES_USER: ${POSTGRES_USER:-myapp}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set it in .env}   # (2)!
    volumes:
      - ${VOLUME:-./data}/db:/var/lib/postgresql/data
    ports:
      - "5432:5432"                             # (3)!
```

1. `:-myapp` é o **valor padrão** caso `POSTGRES_DB` não esteja definida no ambiente nem no arquivo `.env`. Veja a [documentação de interpolação do Compose](https://docs.docker.com/reference/compose-file/interpolation/){target='_blank'}.
2. `:?` faz o Compose **falhar de forma explícita** com essa mensagem se a variável estiver ausente ou vazia. Um `${POSTGRES_PASSWORD}` simples, sem valor padrão, só mostraria um aviso e substituiria por uma string vazia.
3. Em produção, remova esse mapeamento de porta para que o banco de dados só seja acessível dentro da rede do Compose.

``` { .env title=".env" }
POSTGRES_DB=myapp_prod
POSTGRES_USER=myapp
POSTGRES_PASSWORD=S3cr3t!
VOLUME=/data/myapp
```

Quando você roda `docker compose up`, o Compose lê automaticamente o `.env` do diretório do projeto (a pasta do `compose.yaml`). Variáveis já definidas no seu shell têm precedência sobre os valores do `.env`.

!!! info "`.env` versus `env_file:`"
    O arquivo `.env` é usado para **interpolação**: ele preenche os marcadores `${...}` do `compose.yaml` e **não** é repassado aos containers por si só. Para injetar todas as variáveis de um arquivo em um container, use `env_file:` no serviço:

    ``` yaml
    services:
      account:
        env_file: account.env   # every KEY=value becomes an environment variable of the container
    ```

!!! warning "Nunca faça commit do `.env` no controle de versão"
    Adicione `.env` ao `.gitignore`. Cada ambiente (desenvolvimento, homologação, produção) deve ter o próprio arquivo `.env`, mantido fora do repositório. Fazer commit de credenciais — mesmo em um repositório privado — é um incidente de segurança esperando para acontecer. Em vez disso, faça commit de um `.env.example` com valores fictícios, para que os outros saibam quais variáveis definir.

---

## Health checks e ordem de dependências

O `depends_on` garante que um serviço inicie depois das suas dependências, mas não espera a dependência ficar *pronta* (por exemplo, o banco de dados terminar de inicializar). Use `healthcheck` para isso:

``` { .yaml title="compose.yaml" }
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
        condition: service_healthy    # wait until db passes healthcheck
```

``` mermaid-sim
sequenceDiagram
    participant C as docker compose up
    participant DB as db
    participant A as app
    C->>DB: inicia o container
    DB-->>C: em execução (ainda inicializando)
    C->>DB: healthcheck: pg_isready
    DB-->>C: unhealthy, nova tentativa em 5 s
    C->>DB: healthcheck: pg_isready
    DB-->>C: healthy
    C->>A: inicia o container
    A->>DB: conecta em db:5432
```

Sem `condition: service_healthy`, o `app` iniciaria logo depois que o `db` estivesse *em execução* e poderia cair com um erro de conexão enquanto o PostgreSQL ainda está criando os arquivos dele. Adicionar `restart: on-failure` (ou `unless-stopped`) a um serviço é uma rede de segurança complementar: se ele cair mesmo assim, o Docker o inicia de novo.

---

## Volumes nomeados vs. bind mounts

``` { .yaml title="compose.yaml" }
volumes:
  db-data:        # Docker-managed named volume — data persists across `down`

services:
  db:
    volumes:
      - db-data:/var/lib/postgresql/data     # named volume (production)
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql  # bind mount (seed data)
```

| | Volume nomeado | Bind mount |
|---|---|---|
| **Local dos dados** | Gerenciado pelo Docker | Caminho no host que você especifica |
| **Persistência** | Sobrevive ao `docker compose down` | Sobrevive (é um caminho do seu host) |
| **Removido por `down -v`** | Sim — os dados são apagados | Não — a pasta do host permanece |
| **Caso de uso** | Dados de produção, bancos de dados | Desenvolvimento: hot-reload do código, scripts de carga inicial |

!!! note "Scripts de inicialização rodam só uma vez"
    A imagem do PostgreSQL executa os scripts de `/docker-entrypoint-initdb.d/` **apenas quando o diretório de dados está vazio**. Se você alterar o `init.sql` mas o volume já tiver dados, nada acontece — remova o volume (`docker compose down -v`) para reinicializar.

---

## Exemplo completo

``` { .yaml title="compose.yaml" }
--8<-- "docs/2026.2/classes/containerization/compose-example.yaml"
```

Experimente:

``` shell
docker compose up -d --build  # (1)!
```

1. `-d` executa os containers em modo destacado.<br>`--build` força a reconstrução das imagens antes de iniciar.

Acesse o serviço web em [http://localhost:80](http://localhost:80){:target="_blank"} e verifique se todos os containers estão rodando com `docker compose ps`.

---

## Limites do Compose

O Compose roda tudo em **um único host**. Ele não distribui containers entre máquinas, não os reagenda quando um host cai e não faz rolling updates. É ideal para desenvolvimento, CI e pequenos deploys em um único servidor; em um cluster, as mesmas imagens são executadas por um orquestrador, como o Kubernetes ([Hands-on 5](../../../hands-on/5/index.md)).

!!! warning "Erros comuns"
    - **`depends_on` sem health check**, e depois depurar falhas de inicialização "aleatórias".
    - **`docker compose down -v` em um banco de dados que importa** — o volume nomeado, com todos os dados, some.
    - **Publicar todas as portas** (`5432:5432`, `6379:6379`) "por via das dúvidas": cada porta publicada é uma porta de entrada para a stack. Publique apenas o ponto de entrada (o gateway).
    - **Esquecer o `--build`**: `docker compose up` reaproveita a imagem construída da última vez, então a sua mudança no código não aparece.

---

## Conexões

- [Hands-on 1 — Containerização](../../../hands-on/1/containerization/index.md) — o primeiro arquivo Compose da loja: serviço de contas e PostgreSQL.
- [Hands-on 2](../../../hands-on/2/index.md) — o gateway como único ponto de entrada publicado.
- [Hands-on 7](../../../hands-on/7/index.md), [Hands-on 8](../../../hands-on/8/index.md), [Hands-on 9](../../../hands-on/9/index.md) — adicionando Nginx, Redis e Kafka à mesma stack do Compose.
- [Hands-on 5](../../../hands-on/5/index.md) — do Compose ao Kubernetes.

## Pontos-chave

- O `compose.yaml` declara a stack inteira — serviços, redes, volumes, variáveis — e `docker compose up -d --build` a inicia.
- Os serviços se encontram pelo **nome do serviço**, na porta do container; `localhost` dentro de um container é o próprio container.
- O `.env` preenche os marcadores `${...}` (use `:-` para valores padrão e `:?` para valores obrigatórios) e nunca deve ser commitado; `env_file:` injeta variáveis em um container.
- O `depends_on` ordena a inicialização; adicione um `healthcheck` e `condition: service_healthy` para esperar até que uma dependência esteja **pronta**.
- Volumes nomeados sobrevivem ao `down`, mas não ao `down -v`; o Compose é de host único — clusters precisam de um orquestrador.

---

[^1]: [Docker Compose Documentation](https://docs.docker.com/compose/){:target="_blank"}
[^2]: [Compose File Reference](https://docs.docker.com/reference/compose-file/){:target="_blank"}
[^3]: [Docker Networking](https://docs.docker.com/engine/network/){:target="_blank"}
