Como vimos no hands-on anterior, os microsserviços são implementados como aplicações Spring Boot. Para executá-los, precisamos preparar o ambiente instalando o banco de dados que vai persistir os dados. Para isso, vamos usar um arquivo Docker Compose para criar um container PostgreSQL, bem como um cluster que isola os microsserviços do acesso externo, criando um ambiente seguro — a camada confiável (trusted layer).

Um arquivo Docker Compose é um arquivo YAML que define como os containers Docker devem se comportar em produção. O arquivo contém a configuração do banco de dados, dos microsserviços e da rede.

O diagrama abaixo ilustra a arquitetura do sistema que será criada com o Docker Compose, na qual os microsserviços ficam isolados do acesso externo, formando uma camada confiável. Os microsserviços só acessam o banco de dados, e o acesso externo é bloqueado.

``` mermaid-sim
flowchart LR
    subgraph api [Camada confiável]
        account e3@==> db@{ shape: cyl, label: "Banco de dados" }
    end
    internet e1@==>|requisição| account:::red
    e1@{ animate: true }
    e3@{ animate: true }
    classDef red fill:#fcc
```

No diagrama, o microsserviço `account` é a camada de lógica de negócio que interage com o banco de dados.

A estrutura de diretórios do projeto fica mais ou menos assim:

``` tree
api/
    account/
    account-service/
        src/
        Dockerfile
    .env
    compose.yaml
```

O arquivo `compose.yaml` contém a configuração do banco de dados e dos microsserviços, bem como a configuração da rede. O arquivo `.env` contém as variáveis de ambiente do banco de dados, como o nome de usuário, a senha e o nome do banco. O arquivo `Dockerfile` contém a configuração do microsserviço, como a imagem base, as dependências e o comando para executar a aplicação.

O conteúdo dos arquivos é o seguinte:

=== "compose.yaml"
    ``` { .yaml .copy .select linenums="1" }
    --8<-- "docs/2026.2/hands-on/1/containerization/code/compose.yaml"
    ```

=== ".env"
    ``` { .yaml .copy .select linenums="1" }
    --8<-- "docs/2026.2/hands-on/1/containerization/code/.env"
    ```

=== "Dockerfile"
    ``` { .dockerfile .download data-filename="Dockerfile" .copy .select linenums="1" }
    --8<-- "docs/2026.2/hands-on/1/containerization/code/Dockerfile"
    ```

Nessa configuração, usamos a imagem `postgres:17` para criar um container PostgreSQL e definimos as variáveis de ambiente do banco de dados por meio do arquivo `.env`.

Para executar a aplicação, precisamos rodar o seguinte comando:

``` { bash }
docker compose up -d --build
```

E, para verificar se a aplicação está rodando, podemos executar o seguinte comando:

``` { bash }
docker compose ps -a
```

____

Pronto! No próximo hands-on, vamos nos conectar ao banco de dados e executar algumas consultas para verificar se os dados estão sendo persistidos corretamente.

[Repositório](../repository/){ .md-button .md-button }
