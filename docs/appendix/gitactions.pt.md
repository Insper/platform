## GitHub Actions

O GitHub Actions é um recurso do GitHub que permite automatizar, personalizar e executar os fluxos de trabalho de desenvolvimento de software diretamente no seu repositório. Com o GitHub Actions, você pode fazer o build, testar e fazer o deploy do seu código direto do GitHub, com suporte de primeira linha a CI/CD.

Além disso, o GitHub Actions permite automatizar outros aspectos do seu fluxo de desenvolvimento, como atribuir revisões de código, gerenciar branches e fazer a triagem de issues.

### Como funciona

Os workflows do GitHub Actions são **orientados a eventos**: você define *o que* deve acontecer e *quando* deve ser disparado. O arquivo de workflow fica dentro do seu repositório, em `.github/workflows/`, e assim é versionado junto com o seu código.

``` mermaid
flowchart LR
    event(["Evento\nex.: push na main"]):::gray
    workflow(["Workflow\n.github/workflows/*.yml"]):::blue
    jobs(["Jobs\nexecutados em paralelo ou em sequência"]):::blue
    steps(["Steps\ncomandos de shell ou actions"]):::teal
    runner(["Runner\nVM hospedada pelo GitHub\nou self-hosted"]):::green

    event --> workflow --> jobs --> steps
    steps -.->|"executa em"| runner

    classDef gray  fill:#F1EFE8,stroke:#888780,color:#2C2C2A
    classDef blue  fill:#E6F1FB,stroke:#185FA5,color:#042C53
    classDef teal  fill:#E1F5EE,stroke:#0F6E56,color:#04342C
    classDef green fill:#EAF3DE,stroke:#3B6D11,color:#173404
```

### Conceitos principais

| Conceito | Descrição |
|:--------|:------------|
| **Workflow** | Um processo automatizado definido em um arquivo YAML. Um repositório pode ter vários workflows. |
| **Event** | Um gatilho que inicia um workflow (por exemplo, `push`, `pull_request`, `schedule`, `workflow_dispatch`). |
| **Job** | Um conjunto de steps executados no mesmo runner. Por padrão, os jobs rodam em paralelo. |
| **Step** | Uma tarefa individual — um comando de shell (`run`) ou uma action reutilizável (`uses`). |
| **Action** | Uma unidade reutilizável de automação publicada no GitHub Marketplace (por exemplo, `actions/checkout`). |
| **Runner** | A máquina virtual que executa o job (`ubuntu-latest`, `windows-latest`, `macos-latest`). |

---

### Exemplo — pipeline de CI para um microsserviço Spring Boot

O workflow abaixo é disparado a cada push na `main` e em pull requests. Ele faz o checkout do código, configura o Java, executa os testes e faz o build da imagem Docker.

``` { .yaml title=".github/workflows/ci.yml" .copy .select linenums="1" }
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout source
        uses: actions/checkout@v4

      - name: Set up Java 21
        uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
          cache: maven

      - name: Run tests
        run: mvn test --no-transfer-progress

      - name: Build artifact
        run: mvn package -DskipTests --no-transfer-progress

      - name: Build Docker image
        run: docker build -t ${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }} .

      - name: Push to Docker Hub
        run: |
          echo "${{ secrets.DOCKERHUB_TOKEN }}" | docker login -u "${{ secrets.DOCKERHUB_USERNAME }}" --password-stdin
          docker push ${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }}
```

!!! info "Secrets"
    Valores sensíveis como `DOCKERHUB_TOKEN` são armazenados como **secrets criptografados do repositório** (Settings → Secrets and variables → Actions). Eles nunca aparecem nos logs.

---

### Exemplo — CD: deploy no Kubernetes após uma execução bem-sucedida da CI

Este segundo workflow é disparado somente depois que o workflow `CI` passa na `main` e, em seguida, atualiza o deployment do Kubernetes usando o `kubectl`.

``` { .yaml title=".github/workflows/cd.yml" .copy .select linenums="1" }
name: CD

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest

    steps:
      - name: Configure kubectl
        uses: azure/setup-kubectl@v3

      - name: Write kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBECONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Rolling update
        run: |
          kubectl set image deployment/account-service \
            account-service=${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }}
          kubectl rollout status deployment/account-service --timeout=120s
```

### GitHub Actions vs Jenkins

As duas ferramentas implementam os mesmos conceitos de CI/CD, mas com trade-offs diferentes:

| Aspecto | GitHub Actions | Jenkins |
|:-------|:--------------|:--------|
| **Configuração inicial** | Nenhuma — roda na nuvem do GitHub | Exige um servidor (Docker, VM ou bare metal) |
| **Configuração** | YAML em `.github/workflows/` | `Jenkinsfile` em Groovy |
| **Escalabilidade** | Gerenciada pelo GitHub | Você gerencia a frota de runners |
| **Marketplace** | Mais de 20.000 actions prontas | Amplo ecossistema de plugins |
| **Custo** | Gratuito para repositórios públicos; cobrado por minutos para privados | Gratuito e open source; você paga pela infraestrutura |
| **Runners self-hosted** | Suportados | Nativo — o Jenkins É o servidor |
| **Indicado para** | Projetos novos, open source, equipes centradas no GitHub | Ambientes corporativos, pipelines complexos, on-premise |
