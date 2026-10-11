Agora, com o controller implementado, podemos passar para a camada de serviço do microsserviço Account. A camada de serviço é responsável pela lógica de negócio do microsserviço e interage com a camada de repositório para tratar a persistência dos dados da entidade Account. Ela é implementada na classe `AccountService`, que contém os métodos para criar, excluir, buscar e atualizar contas. A classe `AccountService` usa o `AccountRepository` para tratar a persistência dos dados da entidade Account e o `AccountParser` para tratar a conversão da entrada e da saída dos endpoints da API.

Nos hands-on anteriores, já vimos que este microsserviço usa a Clean Architecture, o que significa que a camada de serviço é independente da camada de controller e da camada de repositório. Isso nos permite testar facilmente a lógica de negócio da camada de serviço sem nos preocuparmos com os detalhes das camadas de controller ou de repositório. O diagrama a seguir ilustra a arquitetura do microsserviço Account, mostrando as relações entre as diferentes camadas e classes:

``` mermaid
sequenceDiagram
    title Abordagem da Clean Architecture
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

As relações entre as diferentes camadas são feitas por meio de diferentes DTOs (Data Transfer Objects). Para traduzir entre as camadas, usamos parsers, responsáveis por converter os DTOs em entidades e vice-versa.

- A classe `AccountParser` é responsável por essa tradução e contém os métodos para converter o DTO `AccountIn` na entidade `Account`, e a entidade `Account` no DTO `AccountOut`.

- Já o `AccountModel` é a classe que representa o modelo de banco de dados da entidade Account, usado pelo `AccountRepository` para tratar a persistência dos dados da entidade. A classe `AccountModel` contém os atributos da entidade Account e é anotada com anotações JPA, que definem o mapeamento entre a classe e a tabela do banco de dados.


## 1. O mapeamento objeto-relacional (ORM)

Este projeto usa um banco de dados relacional (PostgreSQL) para armazenar os dados da entidade Account. Mas Java é uma linguagem de programação orientada a objetos, o que significa que precisamos de uma forma de mapear os dados relacionais para dados orientados a objetos.

O **mapeamento objeto-relacional (Object-Relational Mapping, ORM)** é uma técnica de programação que permite aos desenvolvedores interagir com um banco de dados relacional usando uma linguagem orientada a objetos. Ele oferece uma forma de mapear tabelas do banco para classes e registros do banco para objetos, permitindo trabalhar com os dados de um jeito mais intuitivo e natural. No contexto do microsserviço Account, vamos usar um framework de ORM, o [JPA](https://jakarta.ee/specifications/persistence/){:target="_blank"}, para tratar a persistência dos dados da entidade Account, o que vai nos permitir criar, ler, atualizar e excluir contas no banco de dados com facilidade.

Aqui, podemos ver o código que resolve as questões de persistência de dados do microsserviço Account, incluindo a classe `AccountModel`, que representa o modelo de banco de dados da entidade Account, e a interface `AccountRepository`, responsável pela persistência dos dados da entidade Account usando JPA.


## 2. Migrações de banco de dados

Com o ORM configurado, precisamos gerenciar as mudanças no esquema do banco de dados. À medida que a aplicação evolui, pode ser necessário adicionar novas tabelas, modificar tabelas existentes ou mudar os tipos de dados das colunas. Para gerenciar essas mudanças, vamos usar uma ferramenta de migração de banco de dados chamada [Flyway](https://flywaydb.org/){:target="_blank"}[^1].

O Flyway é uma ferramenta de migração de banco de dados que permite gerenciar e versionar as mudanças no esquema do banco. Ele oferece uma forma de definir e executar migrações, que são scripts que modificam o esquema do banco, como criar tabelas, adicionar colunas ou mudar tipos de dados. No contexto do microsserviço Account, vamos usar o Flyway para gerenciar as nossas migrações, garantindo que o esquema do banco esteja sempre atualizado e consistente entre os diferentes ambientes.

No código, temos um diretório `db/migration`, que contém os scripts de migração do microsserviço Account. Cada script de migração é nomeado em um formato específico, começando com um número de versão (por exemplo, `V2026.02.27.001`) seguido de uma descrição da migração (por exemplo, `create_schema`). Esses scripts de migração são executados em ordem pelo Flyway, para garantir que o esquema do banco esteja sempre atualizado.

## 3. Código

Vamos codificar a implementação do microsserviço Account, que é composta de várias classes. A estrutura de diretórios resultante ficará assim:

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
                            AccountApplication.java
                            AccountModel.java
                            AccountParser.java
                            AccountRepository.java
                            AccountResource.java
                            AccountService.java
                resources/
                    db/
                        migration/
                            V2026.03.27.001__create_schema.sql
                            V2026.03.27.002__create_table.sql
                            V2026.03.06.001__create_field_pass_sha256.sql
                    application.yaml
        pom.xml
    compose.yaml
```

Respeitando a Clean Architecture, temos as seguintes classes:


| Classe | Descrição |
| --- | --- |
| `Account` | Esta classe representa a entidade Account, a entidade principal do microsserviço Account. Ela contém os atributos da entidade, como `id`, `name`, `email`, `password` e `sha256`. |
| `AccountModel` | Esta classe representa o modelo Account, responsável pela lógica de persistência do microsserviço Account. Ela contém os métodos para criar, excluir, buscar e atualizar contas. |
| `AccountParser` | Esta classe é responsável pela conversão da entrada e da saída dos endpoints da API, convertendo os DTOs `AccountIn` e `AccountOut` na entidade `Account` e vice-versa. |
| `AccountRepository` | Esta interface é responsável pela persistência dos dados da entidade Account, usando um framework de mapeamento objeto-relacional (ORM) para interagir com o banco de dados. |
| `AccountResource` | Esta classe é responsável pelos endpoints da API do microsserviço Account: ela implementa a interface `AccountController`, definida no módulo `account`, e usa o `AccountService` para tratar a lógica de negócio dos endpoints. |
| `AccountService` | Esta classe é responsável pela lógica de negócio do microsserviço Account, usando o `AccountRepository` para tratar a persistência dos dados da entidade Account e o `AccountParser` para tratar a conversão da entrada e da saída dos endpoints da API. |




!!! example "Código-fonte"

    === "compose.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="7 21 24-29" }
        --8<-- "docs/2026.1/hands-on/1/repository/code/compose.yaml"
        ```

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" hl_lines="33-36 50-54 56-64" }
        --8<-- "docs/2026.1/hands-on/1/repository/code/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="8-12 14-16 18-21" }
        --8<-- "docs/2026.1/hands-on/1/repository/code/application.yaml"
        ```

    === "Account.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.1/hands-on/1/repository/code/Account.java"
        ```

    === "AccountModel.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.1/hands-on/1/repository/code/AccountModel.java"
        ```

    === "AccountParser.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.1/hands-on/1/repository/code/AccountParser.java"
        ```

    === "AccountRepository.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.1/hands-on/1/repository/code/AccountRepository.java"
        ```

    === "AccountResource.java"

        ``` { .java .copy .select linenums='1' hl_lines="14-15 19-29 34-35 45-49 54-59" }
        --8<-- "docs/2026.1/hands-on/1/repository/code/AccountResource.java"
        ```

    === "AccountService.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.1/hands-on/1/repository/code/AccountService.java"
        ```

    === "V2026.03.04.001__create_schema.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "docs/2026.1/hands-on/1/repository/code/V2026.03.04.001__create_schema.sql"
        ```

    === "V2026.03.04.002__create_table.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "docs/2026.1/hands-on/1/repository/code/V2026.03.04.002__create_table.sql"
        ```

    === "V2026.03.06.001__create_field_pass_sha256.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "docs/2026.1/hands-on/1/repository/code/V2026.03.06.001__create_field_pass_sha256.sql"
        ```

## 4. Execução

Para executar o microsserviço Account, podemos usar o comando `docker-compose` para iniciar o microsserviço e as suas dependências (por exemplo, o banco de dados PostgreSQL). Certifique-se de estar no diretório raiz do projeto, onde fica o arquivo `compose.yaml`, e execute o seguinte comando:

``` { bash }
docker compose up --build
```

Observe que a flag `--build` é usada para fazer o build das imagens Docker antes de iniciar os containers, o que é necessário se você alterou o código ou o Dockerfile.

Também podemos acompanhar os logs do microsserviço para ver se ele está rodando corretamente. Observe que as migrações do Flyway estão sendo executadas e que o microsserviço está subindo sem erros. Você deve ver logs indicando que o microsserviço está no ar e conectado ao banco de dados. Além disso, você também pode verificar o banco de dados para conferir se as migrações foram executadas corretamente e se as tabelas foram criadas como esperado.

1. Entrando no container:

    ``` { bash title="Entering the container" }
    docker exec -it account-service bash
    ```

2. Entrando no banco de dados PostgreSQL:

    ``` { bash title="Entering the PostgreSQL database" }
    psql -U store -d store
    ```

3. Verificando as migrações:

    ``` { bash title="List the schemas" }
    \dn
    ```

    ``` { bash title="List the tables" }
    \dt *.*
    ```


E, se você quiser acompanhar os logs do microsserviço sem entrar no container, pode usar o comando `docker logs` para ver os logs do container. Isso permite ver os logs em tempo real e acompanhar o processo de inicialização do microsserviço, bem como quaisquer erros ou problemas que possam surgir.

``` { bash title="Monitoring the logs" }
docker logs -f account-service
```

---

Pronto!


[^1]: [Criando Migrations com Flyway no seu projeto Java Spring & PostgreSQL](https://www.youtube.com/watch?v=LX5jaieOIAk){target="_blank"}
