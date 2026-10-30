O GitHub Actions[^actions] é a automação embutida no GitHub: um arquivo YAML no seu repositório diz *quando* algo deve rodar (um push, um pull request, um agendamento) e *o que* roda (build, testes, publicar uma imagem, deploy). Nesta disciplina, ele é o caminho mais curto entre um commit e um microsserviço no ar: cada push faz o build do projeto Maven, roda os testes, constrói a imagem Docker e, na `main`, faz o rollout no Kubernetes.

Esta página responde a três perguntas: como um workflow é montado, **o que decide quanto tempo uma pipeline leva** e **o que roda quando um job falha**. Ela termina com o básico de segurança (secrets, `GITHUB_TOKEN`, pinning) e uma comparação com o Jenkins.

## Como funciona { #how-it-works }

Os workflows são **orientados a eventos**. O arquivo de workflow fica em `.github/workflows/`, então é versionado com o seu código e revisado nos mesmos pull requests.

``` diagram
flowchart LR
    event(["Evento<br/>ex.: push na main"]) --> workflow["Workflow<br/>.github/workflows/*.yml"]:::comp
    workflow --> jobs["Jobs<br/>em paralelo por padrão,<br/>ordenados por needs"]:::comp
    jobs --> steps["Steps<br/>run: um comando de shell<br/>uses: uma action"]:::tech
    steps -.->|"cada job executa em"| runner["Runner<br/>uma VM nova do GitHub<br/>ou uma máquina sua"]
```

| Conceito | Descrição |
|:--------|:------------|
| **Workflow** | Um processo automatizado definido em um arquivo YAML. Um repositório pode ter vários workflows. |
| **Event** | O que inicia um workflow: `push`, `pull_request`, `schedule`, `workflow_dispatch` (um botão), `workflow_run` (outro workflow terminou)… |
| **Job** | Um conjunto de steps que rodam no **mesmo runner**. Os jobs rodam **em paralelo**, a menos que `needs` os ordene. |
| **Step** | Uma tarefa: um comando de shell (`run`) ou uma action reutilizável (`uses`). Os steps de um job compartilham o sistema de arquivos do runner. |
| **Action** | Uma unidade reutilizável de automação, em geral do GitHub Marketplace (ex.: `actions/checkout`). |
| **Runner** | A máquina que executa um job (`ubuntu-latest`, `windows-latest`, `macos-latest` ou uma sua). Um runner hospedado pelo GitHub é uma VM nova para cada job. |

## Um primeiro workflow: CI para um microsserviço Spring Boot { #first-workflow }

O workflow abaixo roda a cada push na `main` e em todo pull request. Um único job faz o checkout do código, configura o Java, roda os testes, empacota o jar e constrói e publica a imagem Docker.

``` { .yaml title=".github/workflows/ci.yml" .copy .select linenums="1" }
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout source
        uses: actions/checkout@v7

      - name: Set up Java 25
        uses: actions/setup-java@v6
        with:
          java-version: '25'
          distribution: 'temurin'
          cache: maven

      - name: Run tests
        run: mvn test --no-transfer-progress

      - name: Build artifact
        run: mvn package -DskipTests --no-transfer-progress

      - name: Build Docker image
        run: docker build -t ${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }} .

      - name: Push to Docker Hub
        if: github.event_name == 'push'
        run: |
          echo "${{ secrets.DOCKERHUB_TOKEN }}" | docker login -u "${{ secrets.DOCKERHUB_USERNAME }}" --password-stdin
          docker push ${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }}
```

- `permissions: contents: read` dá ao `GITHUB_TOKEN` do job só o que ele precisa (veja [Secrets e `GITHUB_TOKEN`](#secrets-and-github-token)).
- `cache: maven` restaura o `~/.m2/repository` de execuções anteriores (veja [Cache](#caching)).
- A imagem recebe como tag o SHA do commit (`github.sha`), então cada imagem aponta de volta para o código exato que a construiu.
- O step de push só roda em eventos `push`: um pull request faz o build e os testes, mas não publica nada.

## Jobs, `needs` e o caminho crítico { #needs }

Um único job é fácil de ler, mas lento: cada step espera o anterior. Dividir o trabalho em **jobs** permite que trabalhos independentes rodem em runners separados ao mesmo tempo, e `needs` declara a ordem onde ela importa. Os jobs formam um **DAG** (grafo acíclico dirigido):

``` { .yaml title=".github/workflows/ci.yml (jobs only)" .copy .select linenums="1" }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: mvn -B compile

  unit-tests:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: mvn -B test

  lint:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: mvn -B checkstyle:check

  integration-tests:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: mvn -B verify -P integration-tests   # a profile that runs the *IT classes

  image:
    needs: [unit-tests, lint, integration-tests]
    runs-on: ubuntu-latest
    steps:
      - run: docker build -t account-service:${{ github.sha }} .

  deploy:
    needs: image
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploy account-service:${{ github.sha }}"
```

Os steps de checkout e de configuração ficaram de fora para mostrar a forma. Duas regras decidem tudo o que vem a seguir[^syntax]:

- Um job **começa quando todos os jobs do seu `needs` terminaram com sucesso**. Jobs sem `needs` começam na hora, cada um no seu runner.
- Quando um job necessário **falha ou é pulado**, todo job que precisa dele, direta ou indiretamente, é **pulado** (skipped), a menos que tenha uma condição como `if: always()` ou `if: failure()`. Os jobs que não precisam do que falhou continuam rodando.

<div class="csim" data-sim="pipeline" data-cache="off" data-matrix="1" data-fail="none"></div>

!!! tip "Experimente"
    Aperte o play com os valores iniciais: a execução leva **14 min** de tempo de relógio, mas **18 minutos de runner**, porque os três jobs do meio rodam lado a lado. As barras contornadas são o caminho crítico, build → testes de integração → imagem → deploy. Agora rode os testes unitários em **3** versões do Java: continua em 14 min, mas com **24 minutos de runner** — uma matriz custa minutos, não tempo, enquanto houver runners livres. Ligue o **cache de dependências**: o build está no caminho crítico, então a execução cai para **11 min** (e **21 minutos de runner**). Por fim, faça os **testes unitários** falharem: lint e testes de integração rodam até o fim, imagem e deploy são pulados, e a execução para em **8 min**, depois de **18 minutos de runner**.

O que o simulador mostra:

- **O tempo de relógio é o caminho mais longo do DAG** (o caminho crítico), não a soma dos jobs. Para acelerar uma pipeline, encurte um job *nesse* caminho, ou divida-o: acelerar o lint aqui não muda nada.
- **Os minutos de runner são a soma de todos os jobs.** É isso que um repositório privado paga: o GitHub cobra cada job arredondado para cima ao minuto inteiro[^billing]. Jobs em paralelo trocam minutos por tempo.
- Execuções reais também gastam tempo **na fila por um runner** e **preparando** cada job (uma VM nova, checkout, Java). Muitos jobs pequenos pagam esse custo muitas vezes.
- Cada job começa numa **máquina limpa**: arquivos não passam de um job para outro. Passe os resultados do build com as actions de artefatos (`actions/upload-artifact` / `actions/download-artifact`), ou construa-os de novo.

## Matriz { #matrix }

Uma **matriz** (matrix) roda o mesmo job uma vez para cada combinação de valores, em paralelo. Um uso típico é testar em várias versões do Java ou sistemas operacionais:

``` { .yaml title="unit tests on three Java versions" .copy .select linenums="1" }
  unit-tests:
    needs: build
    runs-on: ubuntu-latest
    strategy:
      fail-fast: true
      matrix:
        java: ['17', '21', '25']
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          java-version: ${{ matrix.java }}
          distribution: 'temurin'
          cache: maven
      - run: mvn -B test
```

- Cada combinação é um job separado, com o seu runner e os seus minutos; um job com `needs: unit-tests` espera **todas** elas.
- `fail-fast` vale `true` por padrão: quando uma combinação falha, o GitHub cancela as que ainda estão rodando ou na fila. Use `false` para ver todas as falhas.
- `max-parallel` limita quantas combinações rodam ao mesmo tempo; uma matriz gera no máximo 256 jobs por execução[^syntax].

## Cache { #caching }

Cada job começa numa VM nova, então, sem cache, o Maven baixa todas as dependências a cada execução. Um cache salva um diretório sob uma **chave** (key) e o restaura nas execuções seguintes:

- `actions/setup-java` com `cache: maven` guarda o `~/.m2/repository`, com a chave calculada a partir de um hash dos seus arquivos `pom.xml`: mude uma dependência e a chave muda.
- Para o resto, `actions/cache` recebe um `path` e uma `key` que você monta, por exemplo com `${{ hashFiles('**/package-lock.json') }}`.
- Um cache acelera, mas nunca é a fonte da verdade: o build precisa funcionar também quando o cache falta.

## Secrets e `GITHUB_TOKEN` { #secrets-and-github-token }

Duas credenciais diferentes chegam a um workflow:

| | **Secrets** | **`GITHUB_TOKEN`** |
|:--|:--|:--|
| O quê | Valores que você guarda: `DOCKERHUB_TOKEN`, `KUBECONFIG`, chaves de API | Um token que o GitHub cria automaticamente para cada job |
| Onde | Settings → Secrets and variables → Actions (repositório, environment ou organização) | Nada a configurar: `${{ secrets.GITHUB_TOKEN }}` ou `${{ github.token }}` |
| Alcança | Outros sistemas (Docker Hub, o cluster, uma nuvem) | Só este repositório: checkout, comentários no PR, releases, GitHub Packages |
| Validade | Até você trocá-lo | Expira quando o job termina |
| Escopo | Quem pode mudar um workflow pode usá-lo | A chave `permissions:`, por workflow ou por job |

- Os secrets são **ocultados** nos logs e **não são passados** a workflows disparados a partir de um fork (o `GITHUB_TOKEN` é a exceção)[^secrets]. Mesmo assim, qualquer pessoa com acesso de escrita pode escrever um workflow que os use: trate acesso de escrita como acesso aos secrets.
- Declare `permissions:` explicitamente e conceda o **mínimo** necessário: ao listar uma permissão, todas as que você não listar passam a `none`[^syntax]. Aumente-as só no job que precisa:

``` { .yaml title="least privilege" .copy .select linenums="1" }
permissions:
  contents: read        # default for every job of the workflow

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # only this job can create a release
      packages: write   # and push to GitHub Packages
```

## Fixando actions por SHA { #pinning }

`uses: actions/checkout@v7` aponta para uma **tag**, e uma tag pode ser movida: se o repositório da action for comprometido, a próxima execução roda o que quer que `v7` aponte agora, com os seus secrets ao alcance. O guia de segurança do GitHub recomenda fixar (pin) as actions num **SHA de commit completo**, que não muda[^secure]:

``` { .yaml title="pinned to a commit" .copy .select linenums="1" }
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

- Mantenha a versão num comentário, para que uma pessoa (ou o Dependabot, com o ecossistema `github-actions`) saiba o que é e possa atualizá-la.
- Confira que o SHA vem do repositório da própria action, e não de um fork: `git ls-remote --tags https://github.com/actions/checkout`.
- O mesmo guia também descreve os **lockfiles de dependências de workflow**, que registram o commit exato de cada action (inclusive as actions que uma action usa) e substituem o pinning por SHA nos repositórios que os adotam[^secure].

## CD: deploy no Kubernetes após uma execução bem-sucedida da CI { #cd }

Este segundo workflow começa quando o workflow `CI` termina na `main`, e só faz o deploy se a CI passou.

``` { .yaml title=".github/workflows/cd.yml" .copy .select linenums="1" }
name: CD

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

permissions:
  contents: read

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest

    steps:
      - name: Configure kubectl
        uses: azure/setup-kubectl@v5

      - name: Write kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBECONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Rolling update
        run: |
          kubectl set image deployment/account-service \
            account-service=${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.event.workflow_run.head_sha }}
          kubectl rollout status deployment/account-service --timeout=120s
```

!!! warning "Qual commit?"
    Num workflow iniciado por `workflow_run`, `github.sha` é o **último commit da branch padrão**, não necessariamente o commit que a CI construiu[^events]. Quando dois pushes chegam muito próximos, ele pode nomear uma imagem que ainda não existe. Use `github.event.workflow_run.head_sha`, o commit da execução de CI que disparou esta.

## GitHub Actions vs Jenkins { #vs-jenkins }

As duas ferramentas implementam os mesmos conceitos de CI/CD, com trade-offs diferentes:

| Aspecto | GitHub Actions | Jenkins |
|:-------|:--------------|:--------|
| **Configuração inicial** | Nenhuma — roda na nuvem do GitHub | Exige um servidor (Docker, VM ou bare metal) |
| **Configuração** | YAML em `.github/workflows/` | `Jenkinsfile` em Groovy |
| **Escalabilidade** | Gerenciada pelo GitHub | Você gerencia a frota de agentes |
| **Reúso** | Actions do GitHub Marketplace | Plugins do update center do Jenkins |
| **Custo** | Gratuito para runners padrão em repositórios públicos; privados têm uma franquia mensal e depois pagam por minuto[^billing] | Gratuito e open source; você paga pela infraestrutura |
| **Runners self-hosted** | Suportados | Nativo — o Jenkins *é* o servidor |
| **Indicado para** | Projetos novos, open source, equipes centradas no GitHub | Ambientes on-premise, pipelines complexas, código em vários hosts |

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Um workflow é **evento → jobs → steps**, versionado em `.github/workflows/`; cada job roda num **runner novo**.
    - Os jobs rodam **em paralelo**, a menos que `needs` os ordene. O **tempo de relógio é o caminho crítico** desse DAG e os **minutos de runner são a soma** de todos os jobs: acelere o caminho, não os jobs laterais.
    - Quando um job falha, os jobs que **precisam** dele são **pulados**, enquanto os independentes continuam rodando; `if: always()` ou `if: failure()` muda isso de propósito.
    - Uma **matriz** multiplica jobs (e minutos), não tempo; um **cache** elimina downloads repetidos, e rende mais no caminho crítico.
    - **Secrets** alcançam outros sistemas; o **`GITHUB_TOKEN`** alcança este repositório e é limitado por `permissions:` — conceda o mínimo. **Fixe** as actions num SHA de commit.

[^actions]: [Documentação do GitHub Actions](https://docs.github.com/en/actions){:target="_blank"}.
[^syntax]: [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax){:target="_blank"}: `needs`, `strategy.fail-fast`, `max-parallel`, `permissions`.
[^billing]: [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing){:target="_blank"} e [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions){:target="_blank"}.
[^secrets]: [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets){:target="_blank"}.
[^secure]: [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use){:target="_blank"}.
[^events]: [Events that trigger workflows: `workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run){:target="_blank"}.
