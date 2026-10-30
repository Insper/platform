# 1. Testes e CI { #1-tests-and-ci }

Um pipeline só é tão bom quanto os testes que ele roda. Este passo adiciona o primeiro **teste de
integração** do BoxOffice — o `catalog` real contra um PostgreSQL real e um Redis real, iniciados pelo
**Testcontainers** — e o workflow do GitHub Actions que o roda em todo push e pull request.
Todos os comandos rodam na **raiz do seu repositório `boxoffice`**.

## Um teste de integração com Testcontainers { #an-integration-test-with-testcontainers }

Mocks testam o que você *acha* que o banco faz. O Testcontainers sobe a coisa real no Docker durante o
teste: migrações do Flyway, mapeamentos JPA, SQL, o cache Redis e o formato JSON de erro são todos
exercitados exatamente como em produção. O `@ServiceConnection` do Spring Boot aponta o datasource e o
cliente Redis para os contêineres — nenhuma URL para configurar.

``` java title="services/catalog/src/test/java/boxoffice/catalog/CatalogApiTest.java"
--8<-- "docs/2027.1/hands-on/11/code/services/catalog/src/test/java/boxoffice/catalog/CatalogApiTest.java"
```

O `pom.xml` do `catalog` ganha as dependências de teste (e, para o [passo 5](../canary/index.md), o
registry do Prometheus). O arquivo completo:

``` xml title="services/catalog/pom.xml"
--8<-- "docs/2027.1/hands-on/11/code/services/catalog/pom.xml"
```

| Dependência | Por quê |
|---|---|
| `spring-boot-starter-webmvc-test` | JUnit 5, AssertJ, o suporte de testes do Spring para aplicações MVC |
| `spring-boot-starter-restclient-test` | `TestRestTemplate`, um cliente HTTP real contra a porta aleatória |
| `spring-boot-testcontainers` | `@ServiceConnection`: o Boot lê host/porta/credenciais dos contêineres |
| `testcontainers-postgresql`, `testcontainers-junit-jupiter` | o módulo PostgreSQL e o ciclo de vida `@Testcontainers`/`@Container` (Testcontainers 2) |
| `micrometer-registry-prometheus` | `/actuator/prometheus`, usado pela análise do canary do passo 5 |

A propriedade `tomcat.version` substitui o Tomcat que o Spring Boot 4.1.1 traz (11.0.24): o gate do
Trivy do [passo 2](../supply-chain/index.md) o rejeita por vulnerabilidades CRITICAL com correção.
Remova a propriedade quando o Dependabot atualizar o parent para uma versão com um Tomcat mais novo.

Rode-o localmente (precisa do Docker rodando, e de JDK 21 + Maven do [lab 0](../../0/index.md)):

<!-- termynal -->

``` shell
> cd services/catalog && mvn -B verify
...
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 9.575 s -- in boxoffice.catalog.CatalogApiTest
[INFO] BUILD SUCCESS
> cd ../..
```

Você deve ver `Tests run: 3, Failures: 0` e `BUILD SUCCESS`; a primeira execução também baixa as imagens
`postgres:17` e `redis:8-alpine`. Se você não tem JDK 21 localmente, pule este comando: o runner do CI
executa exatamente o mesmo.

!!! warning "Testes não podem depender da ordem nem de dados compartilhados"

    O teste lê o evento 1 (criado pela migração de seed) e só *falha* ao criar um evento, então não
    deixa estado para trás. Testes que criam dados devem usar valores únicos (um UUID no título) ou
    rodar cada um numa transação que é desfeita.

## O workflow { #the-workflow }

O GitHub Actions roda **workflows** (`.github/workflows/*.yaml`) feitos de **jobs** (cada um numa
máquina virtual nova, um *runner*) feitos de **steps** (comandos de shell ou *actions* reutilizáveis).
O CI deste lab tem três jobs; este passo explica o primeiro, os próximos passos explicam os outros.

``` yaml title=".github/workflows/ci.yaml"
--8<-- "docs/2027.1/hands-on/11/code/.github/workflows/ci.yaml"
```

| Parte | O que faz |
|---|---|
| `name: CI` | o nome a que outros workflows se referem (`deploy.yaml` roda depois do "CI"; o [lab 13](../../13/index.md) também). Não o renomeie |
| `on: push` (main) / `pull_request` | toda mudança é testada antes e depois do merge; mudanças só em `k8s/**`, `results/**` ou Markdown não refazem o build |
| `permissions: contents: read` | o token padrão só pode ler o repositório; o job `image` pede exatamente o que precisa |
| `concurrency` | um novo push para a mesma branch cancela a execução que ficou obsoleta |
| job `test`, `matrix.service` | um job paralelo por serviço Java; `fail-fast: false` reporta todo serviço quebrado, não só o primeiro |
| `actions/setup-java` com `cache: maven` | baixa o JDK 21 e guarda o `~/.m2` em cache entre execuções (minutos → segundos) |
| `mvn -B verify` | compila, roda os testes unitários e os do Testcontainers (o Docker está disponível nos runners Ubuntu do GitHub) |
| `upload-artifact` em caso de falha | os relatórios do surefire de uma execução que falhou, para baixar na página da execução |

Serviços sem testes também rodam `mvn verify`: isso prova que compilam e empacotam. Adicione testes a
eles conforme avança — a matriz já os inclui.

## Push e acompanhe { #push-and-watch }

O job `performance` deste workflow roda dois arquivos que o [passo 3](../performance-gate/index.md)
explica: `.github/ci/compose.perf.yaml` e `load/budget.js`. Crie-os agora; caso contrário, esse job
falha com `open .github/ci/compose.perf.yaml: no such file`. Copie o `.github/ci/compose.perf.yaml` do
passo 3 para uma nova pasta `.github/ci/` (o site não publica pastas cujo nome começa com ponto, então
ele não pode ser baixado) e baixe o `load/budget.js` (ou copie-o também do passo 3):

``` shell
mkdir -p .github/ci          # then paste compose.perf.yaml from step 3 into it
curl -fsSL -o load/budget.js https://insper.github.io/platform/2027.1/hands-on/11/code/load/budget.js
```

Depois faça o commit e o push:

``` shell
git add .github services/catalog load/budget.js
git commit -m "lab 11: CI with tests"
git push
```

No GitHub, abra o seu repositório → **Actions** → **CI**. Você deve ver a execução começar em segundos,
sete jobs `test (…)` em paralelo, depois `performance budget` (passo 3) e, na `main`, `image
(catalog)` (passo 2). Um check verde no commit significa que todos os jobs passaram; clique num job para
ler o log dele.

??? question "Por que testar nos pull requests *e* na main?"

    A execução do pull request testa a branch como ela foi escrita; a execução na `main` testa o
    resultado do merge, que pode ser diferente (outro pull request entrou no meio). Só a execução na
    `main` publica imagens — o artefato que vai para o deploy vem do resultado do merge testado.

[Próximo: Imagem e cadeia de suprimentos](../supply-chain/index.md){ .md-button .md-button--primary }
