Agora, com o controller implementado, podemos passar para a camada de serviço do microsserviço Account. A camada de serviço é responsável pela lógica de negócio do microsserviço e interage com a camada de repositório para tratar a persistência dos dados da entidade Account. A camada de serviço é implementada na classe `AccountService`, que contém os métodos para criar, buscar (todas, ou uma pelo id) e excluir contas. A classe `AccountService` usa o `AccountRepository` para tratar a persistência dos dados da entidade Account e o `AccountParser` para tratar a conversão da entrada e da saída dos endpoints da API.

No hands-on anterior, já vimos que este microsserviço usa arquitetura limpa (clean architecture), o que significa que a camada de serviço é independente da camada de controller e da camada de repositório. Isso nos permite testar facilmente a lógica de negócio da camada de serviço sem nos preocuparmos com os detalhes da camada de controller ou da camada de repositório. O diagrama a seguir ilustra a arquitetura do microsserviço Account, mostrando as relações entre as diferentes camadas e classes:

``` mermaid-sim
sequenceDiagram
    title Abordagem da arquitetura limpa 
    Actor Request
    participant Controller as Controller<br>Resource
    participant Service@{ "type": "control" }
    participant Repository@{ "type" : "entity" }
    participant Database@{ "type" : "database" }
    Request ->>+ Controller: Rest API (JSON)
    Controller ->>+ Service: parser (AccountIn -> Account)
    Service ->>+ Repository: parser (Account -> AccountModel)
    Repository ->>+ Database: 
    Database ->>- Repository: 
    Repository ->>- Service: parser (Account <- AccountModel)
    Service ->>- Controller: parser (AccountOut <- Account)
    Controller ->>- Request: Rest API (JSON)
```

A relação entre as diferentes camadas é feita por meio de diferentes DTOs (Data Transfer Objects — objetos de transferência de dados). Para traduzir entre as camadas, usamos parsers, responsáveis por converter os DTOs em entidades e vice-versa.

- A classe `AccountParser` é responsável por essa tradução e contém os métodos que convertem o DTO `AccountIn` na entidade `Account` e a entidade `Account` no DTO `AccountOut`.

- Além disso, `AccountModel` é a classe que representa o modelo de banco de dados da entidade Account, usado pelo `AccountRepository` para tratar a persistência dos dados da entidade Account. A classe `AccountModel` contém os atributos da entidade Account e é anotada com anotações JPA, que definem o mapeamento entre a classe e a tabela do banco de dados.


## 1. O mapeamento objeto-relacional (ORM)

Este projeto usa um banco de dados relacional (PostgreSQL) para armazenar os dados da entidade Account. Porém, Java é uma linguagem de programação orientada a objetos, o que significa que precisamos de uma forma de mapear os dados relacionais para dados orientados a objetos.

O **mapeamento objeto-relacional (ORM, Object-Relational Mapping)** é uma técnica de programação que permite interagir com um banco de dados relacional usando uma linguagem de programação orientada a objetos. Ele mapeia tabelas do banco de dados para classes e registros para objetos, permitindo trabalhar com os dados de forma mais intuitiva e natural. No contexto do microsserviço Account, vamos usar um framework ORM, o [JPA](https://jakarta.ee/specifications/persistence/){:target="_blank"}, para tratar a persistência dos dados da entidade Account, o que nos permitirá criar, ler, atualizar e excluir contas no banco de dados com facilidade.

Aqui podemos ver o código que resolve as questões de persistência de dados do microsserviço Account, incluindo a classe `AccountModel`, que representa o modelo de banco de dados da entidade Account, e a interface `AccountRepository`, responsável pela persistência dos dados da entidade Account usando JPA.


## 2. Migrações de banco de dados

Com o ORM configurado, precisamos gerenciar as mudanças no esquema do banco de dados. À medida que a aplicação evolui, podemos precisar adicionar novas tabelas, modificar tabelas existentes ou mudar os tipos de dados das colunas. Para gerenciar essas mudanças, vamos usar uma ferramenta de migração de banco de dados chamada [Flyway](https://flywaydb.org/){:target="_blank"}[^1].

O Flyway é uma ferramenta de migração de banco de dados que permite gerenciar e versionar as mudanças no esquema do banco. Ele oferece uma forma de definir e executar migrações, que são scripts que modificam o esquema do banco de dados, como criar tabelas, adicionar colunas ou mudar tipos de dados. No contexto do microsserviço Account, vamos usar o Flyway para gerenciar as migrações, garantindo que o esquema do banco de dados esteja sempre atualizado e consistente entre os diferentes ambientes.

No código, temos um diretório `db/migration`, que contém os scripts de migração do microsserviço Account. Cada script de migração segue um formato específico de nome, começando por um número de versão (p. ex., `V2026.08.24.001`) seguido de uma descrição da migração (p. ex., `create_schema`). Esses scripts são executados em ordem pelo Flyway, garantindo que o esquema do banco de dados esteja sempre atualizado.

A cada partida, o Flyway compara os scripts com o que o banco já executou e aplica só os novos, antes de o JPA subir:

``` mermaid-sim
sequenceDiagram
    participant A as account (subindo)
    participant F as Flyway
    participant D as db (PostgreSQL)
    A->>F: migrate
    F->>D: lê accounts.flyway_schema_history
    D-->>F: versões já aplicadas
    F->>D: V2026.08.24.001 create_schema
    F->>D: V2026.08.24.002 create_table
    F->>D: registra as duas versões
    F-->>A: esquema atualizado
    A->>A: JPA, depois o Tomcat em :8080
```

!!! warning "Uma migração aplicada é história"

    O Flyway guarda um checksum de cada script que executou: editar um script já aplicado faz a próxima partida falhar na validação. Mude o esquema com um script **novo** `V…__….sql`.

## 3. Código

Vamos codificar a implementação do microsserviço Account, que é composta por várias classes. A estrutura de diretórios resultante ficará assim:

``` tree
api/
    account/
    account-service/
        src/
            main/
                java/
                    store/
                        account/
                            Account.java
                            AccountServiceApplication.java
                            AccountModel.java
                            AccountParser.java
                            AccountRepository.java
                            AccountResource.java
                            AccountService.java
                resources/
                    db/
                        migration/
                            V2026.08.24.001__create_schema.sql
                            V2026.08.24.002__create_table.sql
                    application.yaml
        pom.xml
    compose.yaml
```

Respeitando a arquitetura limpa, temos as seguintes classes:


| Classe | Descrição |
| --- | --- |
| `Account` | Esta classe representa a entidade Account, a entidade principal do microsserviço Account. Ela contém os atributos da entidade, como `id`, `name`, `email`, `password` (o valor original, só na entrada) e `hashPassword`. |
| `AccountModel` | Esta classe é a entidade JPA mapeada para a tabela `accounts.accounts` (`id`, `name`, `email`, `hash_password`). Seu construtor `AccountModel(Account)` e seu método `to()` fazem a conversão entre a entidade e o modelo. |
| `AccountParser` | Esta classe é responsável por converter a entrada e a saída dos endpoints da API, transformando os DTOs `AccountIn` e `AccountOut` na entidade `Account` e vice-versa. |
| `AccountRepository` | Esta interface é responsável pela persistência dos dados da entidade Account, usando um framework de mapeamento objeto-relacional (ORM) para interagir com o banco de dados. Ela estende `CrudRepository` e redeclara `findAll()` para devolver uma `List` em vez de um `Iterable`. |
| `AccountResource` | Esta classe é responsável pelos endpoints da API do microsserviço Account: ela implementa a interface `AccountController` definida no módulo `account` e usa o `AccountService` para tratar a lógica de negócio dos endpoints. |
| `AccountService` | Esta classe é responsável pela lógica de negócio do microsserviço Account, usando o `AccountRepository` para tratar a persistência dos dados da entidade Account e o `AccountParser` para tratar a conversão da entrada e da saída dos endpoints da API. |




!!! example "Código-fonte"

    === "compose.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="20-25" }
        --8<-- "docs/2026.2/hands-on/1/repository/code/compose.yaml"
        ```

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" hl_lines="36-56" }
        --8<-- "docs/2026.2/hands-on/1/repository/code/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="5-9 11-13 15-18" }
        --8<-- "docs/2026.2/hands-on/1/repository/code/application.yaml"
        ```

    === "Account.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/1/repository/code/Account.java"
        ```

    === "AccountModel.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/1/repository/code/AccountModel.java"
        ```

    === "AccountParser.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/1/repository/code/AccountParser.java"
        ```

    === "AccountRepository.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/1/repository/code/AccountRepository.java"
        ```

    === "AccountResource.java"

        ``` { .java .copy .select linenums='1' hl_lines="15-16 20-29 34-35 40 53-55" }
        --8<-- "docs/2026.2/hands-on/1/repository/code/AccountResource.java"
        ```

    === "AccountService.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/1/repository/code/AccountService.java"
        ```

    === "V2026.08.24.001__create_schema.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "docs/2026.2/hands-on/1/repository/code/V2026.08.24.001__create_schema.sql"
        ```

    === "V2026.08.24.002__create_table.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "docs/2026.2/hands-on/1/repository/code/V2026.08.24.002__create_table.sql"
        ```

As regras de negócio ficam no `AccountService`:

- `create` responde `400 Bad Request` quando a senha está ausente ou tem menos de 6 caracteres, ou quando o email está vazio; caso contrário, guarda apenas o hash SHA-256 (em Base64) da senha, em `hash_password` — nunca a própria senha.
- `findById` devolve `null` para um id inexistente e o `AccountResource` transforma isso em `404 Not Found`.

``` mermaid-sim
flowchart TB
    req["POST /accounts\n(corpo: AccountIn)"] e1@--> p1{"senha presente?"}
    p1 -->|"não"| r400a["400 Password is empty"]
    p1 e2@-->|"sim"| p2{"6+ caracteres\napós o trim?"}
    p2 -->|"não"| r400b["400 at least 6 characters"]
    p2 e3@-->|"sim"| p3{"email não vazio?"}
    p3 -->|"não"| r400c["400 Email is empty"]
    p3 e4@-->|"sim"| hash["hash = SHA-256 em Base64"]
    hash e5@--> ins["INSERT INTO accounts.accounts"]
    ins -->|"email já existe\nou nome ausente"| r500["500: a tabela recusa"]
    ins e6@-->|"ok"| r201["201 Created\nLocation: /accounts/(novo id)"]
```

Repare no último ramo: o `AccountService` confere a senha e o email, mas não o nome, e não procura um email já existente. A tabela confere (`name … NOT NULL`, `email … UNIQUE`) e ninguém trata a exceção que ela lança, então o cliente recebe `500` em vez de `400`.

Os endpoints prontos:

| Método | Caminho | Sucesso | Erros |
|---|---|---|---|
| `POST` | `/accounts` | `201 Created` + `Location: /accounts/{id}`, sem corpo | `400 Bad Request` (senha ausente ou curta, email vazio, sem corpo); ⚠️ `500 Internal Server Error` (email já na tabela, nome ausente) |
| `GET` | `/accounts` | `200 OK` + lista de `AccountOut` | — |
| `GET` | `/accounts/{id}` | `200 OK` + `AccountOut` | `404 Not Found` |
| `DELETE` | `/accounts/{id}` | `204 No Content`, mesmo para um id desconhecido | — |
| `GET` | `/accounts/health-check` | `200 OK` | — |
| `PUT` | `/accounts`, `/accounts/{id}` | — | `405 Method Not Allowed`: não há endpoint de atualização |

O `create` monta o cabeçalho `Location` com `ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}")`. O literal `/accounts/health-check` vence `/accounts/{id}`, então um `GET` de `health-check` nunca é tomado por um id. O `AccountOut` não tem campo de senha: o hash nunca sai do serviço.

<div class="csim" data-sim="account-crud" data-script="endpoints"></div>

!!! tip "Experimente"

    Antes de rodar o Docker, o mesmo serviço no navegador: o simulador roda o código do lab sobre uma `accounts.accounts` vazia. Play ou → envia as requisições do lab uma a uma: POST devolve 201 com o cabeçalho `Location` e sem corpo, `GET /accounts` lista a conta sem a senha nem o hash, uma senha de 3 caracteres recebe 400 (AccountService), o mesmo email de novo recebe 500 (o `UNIQUE` da tabela, não uma regra do serviço), PUT recebe 405 (não há endpoint de atualização) e DELETE responde 204 mesmo na segunda vez. No modo **livre**, envie um corpo sem nome: o AccountService deixa passar e o banco recusa (500).

## 4. Execução

Para executar o microsserviço Account, podemos usar o comando `docker-compose` para iniciar o microsserviço e as suas dependências (p. ex., o banco de dados PostgreSQL). Certifique-se de estar no diretório raiz do projeto, onde fica o arquivo `compose.yaml`, e execute o seguinte comando:

``` { bash }
docker compose up --build
```

Observe que a flag `--build` é usada para gerar as imagens Docker antes de iniciar os containers, o que é necessário se você fez mudanças no código ou no Dockerfile.

Também podemos monitorar os logs do microsserviço para ver se ele está rodando corretamente. Observe que as migrações do Flyway estão sendo executadas e que o microsserviço está subindo sem erros. Você deve ver logs indicando que o microsserviço está no ar e conectado ao banco de dados. Além disso, você também pode verificar o banco de dados para conferir se as migrações foram executadas corretamente e se as tabelas foram criadas como esperado.

1. Entrando no banco de dados PostgreSQL. O `psql` fica no container **`db`** (a imagem `postgres`), não no do account; por isso, abra-o lá, com o nome do serviço do `compose.yaml` e o usuário/banco definidos por `DB_USER` e `DB_NAME` (ambos `store`):

    ``` { bash title="Entering the PostgreSQL database" }
    docker compose exec db psql -U store -d store
    ```

2. Verificando as migrações:

    ``` { bash title="List the schemas" }
    \dn
    ```

    ``` { bash title="List the tables" }
    \dt *.*
    ```


E, se você quiser monitorar os logs do microsserviço sem entrar no container, pode usar o comando `docker compose logs` com o nome do serviço (`account`) para ver os logs do container. Assim você acompanha os logs em tempo real e pode monitorar a inicialização do microsserviço, bem como quaisquer erros ou problemas que surjam.

``` { bash title="Monitoring the logs" }
docker compose logs -f account
```

---

Pronto!


[^1]: [Criando Migrations com Flyway no seu projeto Java Spring & PostgreSQL](https://www.youtube.com/watch?v=LX5jaieOIAk){target="_blank"}
