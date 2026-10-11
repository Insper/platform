Com a aplicação containerizada, o próximo passo é configurar um pipeline de CI/CD para automatizar o deploy em um provedor de nuvem. Você pode usar o provedor que preferir — AWS, Azure ou Google Cloud Platform. O pipeline deve incluir as seguintes etapas:

1. SCM
1. Dependências
1. Build
1. Push para o Docker Hub
1. Deploy no K8s

!!! warning "A FAZER"

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
