Com a aplicação containerizada, o próximo passo é configurar um pipeline de CI/CD para automatizar o deploy em um provedor de nuvem. Você pode usar o provedor de sua preferência — AWS, Azure ou Google Cloud Platform. O pipeline deve incluir os seguintes estágios:

1. SCM
1. Dependências
1. Build
1. Push para o Docker Hub
1. Deploy no K8s

!!! warning "TO DO"

    Todos os microsserviços devem ser implantados no mesmo cluster. Cada microsserviço deve ter o seu próprio `Jenkinsfile`. O pipeline deve ser definido na raiz do projeto e deve cobrir todos os microsserviços:
    
    - `account-service`;
    - `auth-service`;
    - `gateway-service`;
    - `product-service`, e;
    - `order-service`.

Uma estrutura básica de diretórios para o projeto é a seguinte:

``` { .bash }
.
├── account-service
│   ├── Jenkinsfile
│   └── ...
```

Exemplo de Jenkinsfile para o `account-service`:

=== "Jenkinsfile"

    ``` { .groovy .copy .select linenums="1" }
    --8<-- "https://raw.githubusercontent.com/hsandmann/insper.store.account-service/refs/heads/main/Jenkinsfile"
    ```

---

!!! danger "Entrega"

    Individualmente, cada aluno deve criar um repositório no GitHub, com a documentação em MkDocs dos exercícios realizados e também com o projeto e entregar o link via Blackboard. Na documentação publicada deve constar:

    - Nome do aluno e grupo;
    - Documentação das atividades realizadas;
    - Código fonte das atividades realizadas;
    - Documentação do projeto;
    - Código fonte do projeto;
    - Link para todos os repositórios utilizados;
    - Destaques para os bottlenecks implementados (ao menos 2 por indivíduo);
    - Apresentação do projeto;
    - Vídeo de apresentação do projeto (2-3 minutos);
    
    Um template de documentação pode ser encontrado em [Template de Documentação](https://hsandmann.github.io/documentation.template/){target="_blank"}.
