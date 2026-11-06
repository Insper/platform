As práticas de [DevOps](https://en.wikipedia.org/wiki/DevOps){:target="_blank"} buscam encurtar o ciclo de vida do desenvolvimento de software automatizando as etapas de build, teste e deploy. Duas práticas fundamentais sustentam essa automação[^1]:

![](./images/cicd.png)
<small>Visão geral de CI/CD. Fonte: [ByteByteGo - A Crash Course in CI/CD](https://blog.bytebytego.com/p/a-crash-course-in-cicd){:target="_blank"}</small>

- **Integração Contínua (CI)** — os desenvolvedores fazem merge das mudanças com frequência; cada merge dispara um ciclo automatizado de build e testes.
- **Entrega Contínua (CD)** — toda mudança que passa pela CI é empacotada automaticamente e fica pronta para o deploy em qualquer ambiente.

``` mermaid-sim
flowchart LR
    dev([Desenvolvedor]) -->|git push| scm[Controle de versão]
    scm -->|webhook / poll| ci[Servidor de CI\nJenkins]
    subgraph pipeline [Pipeline]
        build[Build] --> test[Teste] --> image[Empacota a\nimagem Docker] --> push[Push para o\nregistry]
    end
    ci --> pipeline
    push -->|deploy| env([Ambiente\nde destino])
```

O [Jenkins](https://www.jenkins.io/){:target="_blank"} é um dos servidores de automação open source mais adotados. Ele orquestra pipelines de CI/CD por meio de um rico ecossistema de plugins e suporta **Pipeline as Code** — definições de pipeline versionadas no repositório, junto ao código da aplicação, em um arquivo chamado `Jenkinsfile`[^2].

## Slides

<div class="slides-embed">
  <iframe src="slides/devops.html" title="Slides: hands-on 4 — devops" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/devops.html){:target="_blank"}

## 1. Preparação — Jenkins em container

Rodar o Jenkins dentro do Docker mantém a máquina hospedeira limpa e torna o ambiente reproduzível em qualquer máquina.

!!! info "Código-fonte"

    ``` { .tree .copy .select }
    api/
    jenkins/
        .gitignore
        compose.yaml
    ```

    ``` { .yaml .copy .select linenums="1" title="compose.yaml" }
    --8<-- "docs/2026.2/hands-on/4/jenkins/code/compose.yaml"
    ```

O `compose.yaml` constrói uma imagem personalizada sobre `jenkins/jenkins:jdk25`, com ferramentas extras pré-instaladas:

| Ferramenta | Finalidade |
|---|---|
| Maven | Fazer o build de projetos Java |
| Docker CE | Construir e enviar imagens de container de dentro dos pipelines |
| kubectl | Fazer o deploy em clusters Kubernetes |
| AWS CLI | Interagir com os serviços da AWS (ECR, ECS, EKS …) |

O processo do Jenkins é adicionado ao grupo `docker` para que os pipelines possam executar comandos `docker` sem precisar de root. Para isso, o socket do Docker do hospedeiro (`/var/run/docker.sock`) é montado (bind mount) dentro do container[^3].

A home do Jenkins (`/var/jenkins_home`: plugins, jobs, credenciais) é montada em `./config/jenkins` (ou em `$CONFIG/jenkins`, quando a variável `CONFIG` está definida), então sobrevive a um `docker compose down`. Essa pasta guarda segredos, por isso o `jenkins/.gitignore` deixa `config/` e `.env` fora do git.

``` mermaid-sim
flowchart LR
    browser["navegador\nlocalhost:9080"]
    subgraph host [sua máquina]
        j["container jenkins\nJenkins :8080\nmaven, docker, kubectl, aws"]
        sock[("/var/run/docker.sock\no daemon Docker do hospedeiro")]
        cfg[("./config/jenkins\n= /var/jenkins_home")]
    end
    hub[("Docker Hub")]
    browser e0@==>|"9080:8080"| j
    j e1@-->|"docker build, docker push"| sock
    j --- cfg
    sock e2@-->|push| hub
    e0@{ animate: true }
    e1@{ animate: true }
```

!!! warning "Segurança do socket do Docker"
    Montar o `/var/run/docker.sock` dá ao container controle total sobre o daemon Docker do hospedeiro. Isso é aceitável em desenvolvimento local, mas deve ser reforçado (por exemplo, com Docker rootless ou um daemon de build dedicado) em ambientes compartilhados ou de produção.

**Suba o servidor:**

``` { .bash .select }
jenkins/# docker compose up -d --build

[+] Running 2/2
 ✔ jenkins Created              0.1s
 ✔ Container jenkins Started    0.2s
```

O Jenkins agora está disponível em [http://localhost:9080/](http://localhost:9080/){target="_blank"}.

## 2. Configuração inicial

### Desbloqueie o Jenkins

Na primeira inicialização, o Jenkins gera uma *senha inicial de administrador* aleatória para impedir acessos não autorizados[^4]. Abra a interface e informe a senha quando ela for pedida:

![Tela de desbloqueio do Jenkins](./jenkins/images/jenkins.unlock.png){width=100%}

Recupere a senha com um dos comandos:

=== "Pelos logs do container"

    ``` { .bash .select }
    docker logs jenkins 2>&1 | grep -A 3 "initialAdminPassword"
    ```

=== "Pelo arquivo de segredos"

    ``` { .bash .select }
    docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
    ```

!!! warning "Windows — execute como Administrador"
    Abra o terminal como **Administrador** para evitar erros de permissão ao ler o diretório de segredos do Jenkins.

    ![Primeira execução como administrador](./jenkins/images/jenkins.first.admin.png){width=100%}

Depois de informar a senha, escolha **Install suggested plugins** e crie um usuário administrador.

### Número de executors

Um *executor* é um slot em que o Jenkins executa uma etapa (stage) ou um job do pipeline. O padrão é 2; aumentar esse número permite rodar vários jobs em paralelo, o que é útil para fazer o build de vários microsserviços na mesma instância.

**Manage Jenkins → Nodes → Built-In Node → Configure → Number of executors → 10**

!!! warning "Executors de menos"
    O pipeline do `account-service` dispara o job `account` (`build job: 'account', wait: true`, na [seção 5](#5-exemplos)) e fica com o próprio executor enquanto espera. Com os 2 executors padrão e vários serviços em build ao mesmo tempo, todos os slots podem acabar presos a jobs que esperam o `account`, que nunca ganha um slot para rodar: os builds ficam parados na fila.

``` mermaid-sim
sequenceDiagram
    participant AS as build do account-service
    participant AU as build do auth-service
    participant Q as Fila de builds
    participant E as 2 executors
    AS->>E: pega o executor 1
    AU->>E: pega o executor 2
    AS->>Q: build job account, wait true
    AU->>Q: build job account (entra no mesmo item da fila)
    Q->>E: account precisa de um executor
    E-->>Q: nenhum livre
    Note over AS,E: os dois builds esperam o account e o account espera um executor que eles seguram
```

O simulador no fim da [seção 5](#5-exemplos) mostra esse caso e a solução.

=== "Nodes"

    ![](./jenkins/images/jenkins.nodes.png)

=== "Configure"

    ![](./jenkins/images/jenkins.nodes.configure.executors.png)

## 3. Credenciais

Antes de criar pipelines que enviam imagens Docker, guarde o segredo do Docker Hub no repositório de credenciais do Jenkins. As credenciais são injetadas nos pipelines em tempo de execução — elas nunca são gravadas em disco nem aparecem nos logs[^5].

**Manage Jenkins → Credentials → System → Global credentials → Add Credentials**

![Adicionar as credenciais do Docker Hub](./jenkins/images/jenkins.credentials.add.png){width=100%}

| Campo | Valor |
|---|---|
| Kind | Username with password |
| Username | Seu usuário do Docker Hub |
| Password | Access token do Docker Hub (veja a dica abaixo) |
| ID | `dockerhub-credential` |

!!! tip "Use access tokens e não a senha da sua conta"
    Crie um token dedicado, com escopo **Read & Write**, em **Docker Hub → Account Settings → Security → Access Tokens**. Se o token for comprometido, você pode revogá-lo sem mexer na senha da sua conta[^6].

## 4. Pipeline as Code

Um `Jenkinsfile` descreve o pipeline em uma DSL declarativa e fica na raiz do repositório. O Jenkins o baixa automaticamente quando um build é disparado, de modo que o pipeline evolui junto com o código[^7].

``` mermaid-sim
flowchart LR
    repo[Repositório Git\nJenkinsfile] -->|checkout do SCM| jenkins[Job do Jenkins]
    jenkins --> s1[Stage: Build]
    s1 --> s2[Stage: Test]
    s2 --> s3[Stage: Build & Push Image]
    s3 --> s4[Stage: Deploy]
```

O Jenkins suporta duas sintaxes de pipeline:

| Sintaxe | Descrição |
|---|---|
| **Declarativa** | DSL estruturada e opinativa — ✅ recomendada para a maioria dos projetos |
| **Scripted** | Groovy completo — máxima flexibilidade, curva de aprendizado mais íngreme |

Os exemplos abaixo usam a sintaxe **declarativa**.


## 5. Exemplos

### `account` — Só o build

O primeiro pipeline compila o módulo `account` e gera o artefato:


!!! info "Código-fonte"

    ``` { .tree .copy .select }
    api/
        account/
            Jenkinsfile
    ```

    ``` { .groovy .copy .select linenums="1" title="Jenkinsfile" }
    --8<-- "docs/2026.2/hands-on/4/jenkins/code/Jenkinsfile.account"
    ```

A única etapa, `Build`, executa `mvn -B -DskipTests clean install`. A flag `-B` ativa o *batch mode* (sem perguntas interativas), necessário em ambientes de CI não interativos.

**Criando um job**

=== "Novo item"

    ![](./jenkins/images/jenkins.new.item.png)

=== "Configurar o pipeline"

    ![](./jenkins/images/jenkins.configure.account.png)

Crie um **New Item**, escolha o tipo **Pipeline** e defina a *Definition* como **Pipeline script from SCM**. O Jenkins vai clonar o repositório e ler o `Jenkinsfile` a cada build.

### `account-service` — Build, empacotamento e push

![Visão geral do job de pipeline](./jenkins/images/jenkins.pipeline.png){width=100%}

Um pipeline completo, que faz o build do serviço, cria uma imagem Docker multiplataforma e a envia ao Docker Hub:

!!! info "Código-fonte"

    ``` { .tree .copy .select }
    api/
        account-service/
            Jenkinsfile
    ```

    ``` { .groovy .copy .select linenums="1" title="Jenkinsfile" }
    --8<-- "docs/2026.2/hands-on/4/jenkins/code/Jenkinsfile.account-service"
    ```

Cada estágio só roda se o anterior teve sucesso; a primeira falha encerra o build:

``` mermaid-sim
flowchart LR
    d["Dependencies\nbuild job account"] -->|SUCCESS| b["Build\nmvn package"]
    b -->|SUCCESS| p["Build and Push Image\nbuildx --push"]
    p -->|SUCCESS| ok["Finished: SUCCESS\ntags latest e BUILD_ID"]
    d -->|"account FAILURE"| f["Finished: FAILURE\nestágios seguintes pulados"]
    b -->|"exit code diferente de 0"| f
    p -->|"sem a credencial\ndockerhub-credential"| f
```

#### Passo a passo

**Bloco `environment`**

```groovy
environment {
    SERVICE = 'account'
    NAME    = "humbertosandmann/${env.SERVICE}"
}
```

Declara duas variáveis válidas em todo o pipeline. `NAME` é o repositório completo no Docker Hub. Referenciar `env.SERVICE` dentro de `NAME` evita duplicar o nome do serviço.

---

**Stage `Dependencies`**

```groovy
stage('Dependencies') {
    steps {
        build job: 'account', wait: true
    }
}
```

Dispara jobs anteriores do Jenkins antes de prosseguir. `wait: true` bloqueia até que cada job termine com sucesso, garantindo que os artefatos das dependências estejam atualizados antes do build do serviço atual.

---

**Stage `Build`**

```groovy
sh 'mvn -B -DskipTests clean package'
```

Compila o projeto e gera o JAR executável. Os testes são pulados de propósito aqui — adicione uma etapa `Test` separada, com `mvn test`, se quiser que o pipeline exija a aprovação nos testes.

---

**Stage `Build & Push Image`**

```groovy
withCredentials([usernamePassword(
    credentialsId: 'dockerhub-credential',
    usernameVariable: 'USERNAME',
    passwordVariable: 'TOKEN')]) {

    sh 'echo $TOKEN | docker login -u $USERNAME --password-stdin'
    sh "docker buildx create --use \
          --platform=linux/arm64,linux/amd64 \
          --node multi-platform-builder-${env.SERVICE} \
          --name multi-platform-builder-${env.SERVICE}"
    sh "docker buildx build \
          --platform=linux/arm64,linux/amd64 \
          --push \
          --tag ${env.NAME}:latest \
          --tag ${env.NAME}:${env.BUILD_ID} \
          -f Dockerfile ."
    sh "docker buildx rm --force multi-platform-builder-${env.SERVICE}"
}
```

- **`withCredentials`** — injeta no ambiente de build o token do Docker Hub guardado no passo 3. Os valores são mascarados em todos os logs do Jenkins[^5].
- **`docker login --password-stdin`** em um `sh` com **aspas simples** — quem expande o `$TOKEN` é o shell, não o Groovy, então o segredo não é interpolado na string Groovy (o Jenkins avisa sobre isso) e não aparece na lista de processos, como aconteceria com `-p $TOKEN`[^5].
- **`docker buildx`** — cria um builder *BuildKit* que gera imagens tanto para `linux/arm64` (Apple Silicon, AWS Graviton) quanto para `linux/amd64` (x86-64 padrão)[^8].
- **Duas tags** — `:latest` oferece uma referência estável; `:<BUILD_ID>` fixa um build específico do Jenkins, de modo que qualquer imagem pode ser rastreada até o commit de origem.
- A instância do builder é removida após o push para liberar recursos do sistema.

Rode os dois pipelines, os executors e as falhas sem o Jenkins:

<div class="csim" data-sim="jenkins-pipeline" data-script="lab"></div>

!!! tip "Experimente"

    Sem Jenkins à mão? O simulador roda os jobs do lab no Built-In Node, 5 s de build por passo (as durações são ilustrativas). Em **os jobs do lab**, o account faz o build e depois o account-service inicia o account #2 no estágio Dependencies e envia `humbertosandmann/account` com as tags :latest e :1 em 140 s. Em **poucos executors**, account-service e auth-service (o mesmo Jenkinsfile para os módulos do hands-on 3) começam juntos nos 2 executors padrão: cada um segura um enquanto espera o account e o account espera na fila — travado desde 5 s, para sempre. Subir os executors para 10 o libera: os dois terminam em 150 s (3 executors já bastariam: 140 s). Em **um estágio que falha**, o account não compila, então Dependencies falha e Build e Build & Push Image são pulados; depois, um ID de credencial errado derruba o Build & Push Image.

!!! warning "Armadilhas comuns"

    - **ID de credencial diferente**: o `credentialsId` precisa ser exatamente o ID salvo no passo 3, `dockerhub-credential`; senão o Build & Push Image falha com `Could not find credentials entry with ID 'dockerhub-credential'`.
    - **Repositório fixo no código**: o `NAME` aponta para `humbertosandmann`; troque pelo **seu** usuário do Docker Hub, senão o push é negado.
    - **Job anterior inexistente**: o `build job: 'account'` falha com `No item named account found` se o job `account` não foi criado antes.
    - **Testes pulados**: os dois pipelines passam `-DskipTests`; adicione um estágio `Test` com `mvn test` para exigi-los.



[^1]: HUMBLE, J.; FARLEY, D. *Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation*. Addison-Wesley, 2010.

[^2]: [Jenkins — Pipeline overview](https://www.jenkins.io/doc/book/pipeline/){:target="_blank"}. Documentação do Jenkins.

[^3]: MERKEL, D. Docker: Lightweight Linux containers for consistent development and deployment. *Linux Journal*, 2014. Veja também a [Docker socket documentation](https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-socket-option){:target="_blank"}.

[^4]: [Jenkins — Initial setup](https://www.jenkins.io/doc/book/installing/docker/#setup-wizard){:target="_blank"}. Documentação do Jenkins.

[^5]: [Jenkins — Using credentials](https://www.jenkins.io/doc/book/using/using-credentials/){:target="_blank"}. Documentação do Jenkins.

[^6]: [Docker Hub — Access tokens](https://docs.docker.com/docker-hub/access-tokens/){:target="_blank"}. Documentação do Docker.

[^7]: [Jenkins — Pipeline as Code](https://www.jenkins.io/doc/book/pipeline/pipeline-as-code/){:target="_blank"}. Documentação do Jenkins.

[^8]: [Docker Buildx — Multi-platform images](https://docs.docker.com/build/building/multi-platform/){:target="_blank"}. Documentação do Docker.
