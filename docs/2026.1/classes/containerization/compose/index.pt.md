
O **Docker Compose** é uma ferramenta para definir e executar aplicações com múltiplos containers usando um **arquivo YAML declarativo**. Em vez de executar vários comandos `docker run` cheios de flags, você descreve toda a pilha da aplicação — serviços, redes, volumes, variáveis de ambiente — em um único `compose.yaml` e sobe tudo com um só comando.

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
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

Todos os serviços compartilham uma rede bridge padrão. Cada serviço é alcançável pelos demais usando o seu **nome de serviço como hostname** (`db`, `app`, `web`).

``` mermaid
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

---

## Variáveis de ambiente

Colocar credenciais fixas dentro do `compose.yaml` é um risco de segurança e impede configurações específicas por ambiente. Use arquivos `.env` em vez disso:

``` { .yaml title="compose.yaml" }
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-myapp}       # (1)!
      POSTGRES_USER: ${POSTGRES_USER:-myapp}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}   # (2)!
    volumes:
      - ${VOLUME:-./data}/db:/var/lib/postgresql/data
    ports:
      - "5432:5432"                             # (3)!
```

1. `:-myapp` é o **valor padrão** caso `POSTGRES_DB` não esteja definida no ambiente nem no arquivo `.env`. Veja a [documentação de interpolação do Compose](https://docs.docker.com/reference/compose-file/interpolation/){target='_blank'}.
2. Sem valor padrão — o Compose falha de forma explícita se essa variável estiver ausente, evitando uma configuração errada silenciosa.
3. Em produção, remova esse mapeamento de porta para que o banco de dados só seja alcançável dentro da rede do Compose.

``` { .env title=".env" }
POSTGRES_DB=myapp_prod
POSTGRES_USER=myapp
POSTGRES_PASSWORD=S3cr3t!
VOLUME=/data/myapp
```

Quando você executa `docker compose up`, o Compose lê automaticamente o `.env` do mesmo diretório do `compose.yaml`.

!!! warning "Nunca faça commit do `.env` no controle de versão"
    Adicione `.env` ao `.gitignore`. Cada ambiente (desenvolvimento, homologação, produção) deve ter seu próprio arquivo `.env`, mantido fora do repositório. Fazer commit de credenciais — mesmo em um repositório privado — é um incidente de segurança esperando para acontecer.

---

## Health checks e ordem de dependências

O `depends_on` garante que um serviço inicie depois das suas dependências, mas não espera que a dependência esteja *pronta* (por exemplo, que o banco de dados termine de inicializar). Use `healthcheck` para isso:

``` { .yaml title="compose.yaml" }
services:
  db:
    image: postgres:16-alpine
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
| **Caso de uso** | Dados de produção, bancos de dados | Desenvolvimento: hot-reload do código-fonte, scripts de carga inicial |

---

## Exemplo completo

``` { .yaml title="compose.yaml" }
--8<-- "docs/2026.1/classes/containerization/compose-example.yaml"
```

Experimente:

``` shell
docker compose up -d --build  # (1)!
```

1. `-d` executa os containers em modo destacado.<br>`--build` força a reconstrução das imagens antes de iniciar.

Acesse o serviço web em [http://localhost:80](http://localhost:80){:target="_blank"} e verifique se todos os containers estão em execução com `docker compose ps`.

---

[^1]: [Docker Compose Documentation](https://docs.docker.com/compose/){:target="_blank"}
[^2]: [Compose File Reference](https://docs.docker.com/reference/compose-file/){:target="_blank"}
[^3]: [Docker Networking](https://docs.docker.com/engine/network/){:target="_blank"}
