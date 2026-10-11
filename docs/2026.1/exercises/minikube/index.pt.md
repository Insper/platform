O Kubernetes deve estar instalado e em execução na sua máquina local. Você pode usar o Minikube ou o Kind para isso. Se estiver usando o Docker Desktop, verifique se o Kubernetes está habilitado nas configurações.

!!! warning "TO DO"

    Todos os microsserviços devem ser publicados no mesmo cluster Kubernetes. Crie os arquivos de configuração de cada microsserviço na raiz do projeto, por exemplo:

    ``` { .tree }
    api/
        account-service/
            k8s/
                k8s.yaml
    ```

    Onde `k8s.yaml` é o arquivo de configuração do microsserviço. O arquivo de configuração deve incluir os seguintes recursos:

    - `Secrets`;
    - `ConfigMap`;
    - `Deployment`, e;
    - `Service`.

    O arquivo de configuração deve ser criado na raiz do projeto e deve incluir todos os microsserviços:

    - `account-service`;
    - `auth-service`;
    - `gateway-service`;
    - `product-service`, e;
    - `order-service`.

    **Execute** todos os serviços no mesmo cluster e verifique se estão saudáveis. Você pode usar um Kubernetes local ou um provedor de nuvem como AWS, Azure ou Google Cloud Platform. **Demonstre** que todos os serviços estão rodando no mesmo cluster gravando um vídeo curto.

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
