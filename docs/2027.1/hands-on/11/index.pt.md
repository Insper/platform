# 11. Entrega { #11-delivery }

!!! info "Objetivo"

    Transformar o `git push` num deploy seguro e medido. Adicionar um teste de integração com
    **Testcontainers** e um pipeline no **GitHub Actions** (`CI`) que testa todo serviço, impõe um
    **orçamento de desempenho com k6**, constrói a imagem, a **escaneia** (Trivy), produz um **SBOM** e
    uma **proveniência** assinada, e a publica no GHCR. Depois, fazer o deploy por **GitOps**: um workflow
    `Deploy` grava a nova tag da imagem no Git, o **Argo CD** a aplica ao cluster do lab 10 e o **Argo
    Rollouts** a libera como um **canary** que aborta sozinho quando o Prometheus mostra erros.

A venda relâmpago é na semana que vem e o time entrega dez mudanças por dia. Cada uma delas pode quebrar
o checkout: uma query lenta, uma biblioteca vulnerável, uma versão que falha 30% das requisições. Ninguém
consegue revisar toda mudança à mão nesse ritmo — o pipeline precisa responder *"esta mudança é segura
para entregar a 2 milhões de fãs?"* automaticamente, e limitar o estrago quando a resposta estava errada.
Este lab é o lado prático da [página de entrega](../../classes/cloud-native/delivery/index.md) da aula
de cloud native e fecha o capítulo 11 da [história da disciplina](../../index.md#story) — fazer rollback
de uma release ruim sem um humano: ele implementa
[integração contínua](../../classes/cloud-native/delivery/index.md#continuous-integration) com um
[orçamento de desempenho](../../classes/performance/capacity-planning/index.md#performance-budgets),
[GitOps](../../classes/cloud-native/delivery/index.md#gitops) e um
[canary julgado por métricas](../../classes/cloud-native/delivery/index.md#canary-with-automated-metrics-analysis).

## Slides

<div class="slides-embed">
  <iframe src="slides/delivery.html" title="Slides: entrega" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/delivery.html){:target="_blank"}

## Antes de começar { #before-you-start }

| | |
|---|---|
| Tempo | cerca de 6 horas (dois ou três encontros); a maior parte é esperando pipelines |
| Contas | uma conta no **GitHub** com o seu repositório `boxoffice` (lab 0). O GitHub Actions e o GHCR são gratuitos para repositórios públicos e incluem minutos e armazenamento gratuitos para os privados; nada neste lab precisa de plano pago ou de conta em nuvem |
| Ferramentas | Git, Docker, `kubectl`, `kind`, Helm e k6 (labs 0 e 10); **GitHub CLI** `gh` (`gh --version`, `gh auth login`); JDK 21 + Maven só para rodar os testes localmente (opcional) |
| Cluster | o cluster kind do lab 10 com Traefik e metrics-server (recrie-o com o [lab 10, passo 1](../10/cluster/index.md) se preciso); Docker com pelo menos 8 GB |

Todo comando roda na **raiz do seu repositório `boxoffice`**, no estado em que o lab 10 o deixou:

``` text title="Start state (end of lab 10)"
boxoffice/
├── docker-compose.yaml     # the Compose stack of labs 1-9
├── k8s/                    # lab 10: kind.yaml, base/, overlays/local/
├── infra/  load/  scripts/
└── services/               # auth, catalog, gateway, inventory, notification, order, payment
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 10? Baixe [boxoffice-after-lab-10.zip](../10/boxoffice-after-lab-10.zip),
    descompacte, `cd boxoffice`, faça push para o seu repositório no GitHub e continue daqui.

Todo arquivo deste lab aparece completo nestas páginas e é publicado em
`https://insper.github.io/platform/2027.1/hands-on/11/code/<caminho>`.

## Arquitetura { #architecture }

``` diagram-sim
flowchart LR
    dev[git push / PR] --> test["CI: testes (matriz, Testcontainers)"]
    test --> perf["CI: orçamento de desempenho (k6)"]
    perf --> img["CI: imagem -> Trivy -> SBOM -> push -> atestação"]
    img --> ghcr[(ghcr.io)]
    img -->|CI passou na main| dep["Deploy: kustomize edit set image + commit"]
    dep --> repo[(k8s/overlays/gitops no Git)]
    argo[Argo CD] -->|pull| repo
    argo --> ro[Rollout catalog]
    ro -->|"25% -> 50% -> 100%"| pods[pods do catalog]
    prom[Prometheus] -->|scrape| pods
    ro -->|AnalysisTemplate| prom
```

!!! example "Componentes do BoxOffice envolvidos"

    | Componente da paleta | Neste lab |
    |---|---|
    | [App Server](../../reference/components/compute/index.md#app) | `catalog`, construído, escaneado, assinado e liberado como canary |
    | [Metrics](../../reference/components/observability/index.md#metrics) | um Prometheus dentro do cluster alimentando a análise do canary |
    | [Ingress](../../reference/components/edge/index.md#ingress) | o Traefik do lab 10, na frente dos pods estáveis e do canary |

## O que você vai medir { #what-you-will-measure }

| Pergunta | Métrica | Ferramenta |
|---|---|---|
| Onde o pipeline gasta o seu tempo? | duração de cada job | GitHub Actions, `gh run view` |
| Quanto tempo do `git push` até os usuários? | lead time por etapa | timestamps |
| O portão pega uma regressão de desempenho? | p95/p99 do orçamento antes e depois | k6 no CI |
| O canary para uma release ruim, e com que rapidez? | tempo de sync → abort, taxa de erro do canary | Argo Rollouts, Prometheus |

## Pré-requisitos { #prerequisites }

- Labs [8](../8/index.md) (SLOs, métricas) e [10](../10/index.md) (o cluster e o `k8s/`) concluídos.
- Leia a [página de entrega](../../classes/cloud-native/delivery/index.md) e
  [segurança da cadeia de suprimentos](../../classes/network-security/zero-trust/index.md); sobre orçamentos,
  [orçamentos de desempenho](../../classes/performance/capacity-planning/index.md#performance-budgets).

## Passos { #steps }

1. [Testes e CI](ci/index.md) — um teste de integração com Testcontainers e o workflow `CI`.
2. [Imagem e cadeia de suprimentos](supply-chain/index.md) — build, relatório e portão do Trivy, SBOM, push, atestações assinadas, Dependabot.
3. [Portão de desempenho](performance-gate/index.md) — um orçamento k6 que reprova o pull request; quebre-o de propósito.
4. [GitOps com Argo CD](gitops/index.md) — Argo CD, o overlay de GitOps, o workflow `Deploy`, drift e autocorreção.
5. [Canary com Argo Rollouts](canary/index.md) — Rollout + AnalysisTemplate sobre o Prometheus; uma release ruim aborta sozinha.
6. [Meça](measure/index.md) — duração das etapas, lead time, o portão e o canary em números.

## Meça { #measure-it }

O passo [Meça](measure/index.md) tem a tabela de resultados para guardar em `results/lab11.md`.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa provável | Correção |
|---|---|---|
| `test` falha com `Could not find a valid Docker environment` (localmente) | o Docker não está rodando | inicie o Docker; no CI isso nunca acontece no `ubuntu-latest` |
| `image` falha com `denied: permission_denied` no push | falta `packages: write` ao job, ou o pacote pertence a outro repositório | mantenha o bloco `permissions`; nas configurações do pacote, dê acesso *Write* ao seu repositório |
| `image` falha com `repository name must be lowercase` | o dono tem letras maiúsculas | o workflow converte para minúsculas com `${GITHUB_REPOSITORY_OWNER,,}`: não troque isso por um literal |
| o portão do Trivy falha | existe na imagem uma vulnerabilidade CRITICAL com correção | leia a tabela no log; atualize a imagem base (`eclipse-temurin:21-jre` recebe patches com frequência) ou a biblioteca, e faça push |
| `Deploy` falha com `remote rejected … protected branch` | a proteção de branch proíbe o push do bot | permita que o GitHub Actions faça bypass, ou abra um pull request em vez disso (veja o passo 4) |
| o Argo CD mostra `ComparisonError … authentication required` | o segredo do repositório está faltando ou o token expirou | recrie o `boxoffice-repo` (passo 4) |
| pods em `ImagePullBackOff` com `ghcr.io/...` | pacote privado e nenhum pull secret, ou dono errado na imagem | crie o `ghcr-pull` (passo 4) ou torne o pacote público; confira o `newName` |
| o Rollout fica em `Paused`/`Progressing` e a análise dá `Inconclusive` | nenhum tráfego chega ao canary, ou o Prometheus não tem dados | mantenha o k6 rodando; `kubectl -n monitoring port-forward svc/prometheus 9090` e consulte `http_server_requests_seconds_count` |

!!! success "Boas práticas neste lab"

    - **Nenhuma imagem a menos que os testes e o orçamento de desempenho passem** — `needs: [test, performance]` em `.github/workflows/ci.yaml`; por quê: [integração contínua](../../classes/cloud-native/delivery/index.md#continuous-integration).
    - **Cadeia de suprimentos sob controle**: actions fixadas por SHA, um portão do Trivy para CVEs críticas com correção, um SBOM e atestações de proveniência, atualizações semanais do Dependabot — `ci.yaml`, `.github/dependabot.yml`; por quê: [contêineres — cadeia de suprimentos](../../classes/cloud-native/containers/index.md#supply-chain).
    - **Privilégio mínimo**: `contents: read` por padrão, permissões de escrita só nos jobs que precisam delas — `ci.yaml`, `deploy.yaml`; por quê: [GitOps — credenciais](../../classes/cloud-native/delivery/index.md#gitops).
    - **O CI nunca toca no cluster**: o `Deploy` só faz commit de uma tag, o Argo CD a puxa, um deploy de cada vez — `deploy.yaml`, `k8s/argocd/application.yaml`; por quê: [GitOps](../../classes/cloud-native/delivery/index.md#gitops).
    - **Releases julgadas por SLIs que o usuário sente, com abort automático** — taxa de erro e p99 do canary em `k8s/overlays/gitops/catalog-analysis.yaml`; por quê: [canary com análise de métricas](../../classes/cloud-native/delivery/index.md#canary-with-automated-metrics-analysis).

## Limpeza { #clean-up }

``` shell
kubectl delete -f k8s/argocd/application.yaml    # Argo CD stops managing (resources stay)
kind delete cluster --name boxoffice             # frees all the memory of the cluster
```

Mantenha os workflows e o overlay de GitOps: o [lab 13](../13/index.md) adiciona etapas de IA a este
pipeline. Desative os workflows (*Actions → … → Disable workflow*) se não quiser gastar minutos de CI até
lá.

## Estado final { #end-state }

``` text title="End state (what this lab added or changed)"
boxoffice/
├── .github/
│   ├── workflows/ci.yaml           # name: CI  — test matrix, performance budget, image + supply chain
│   ├── workflows/deploy.yaml       # name: Deploy — writes the image tag of the GitOps overlay
│   ├── ci/compose.perf.yaml        # the performance-budget environment
│   └── dependabot.yml
├── k8s/
│   ├── argocd/application.yaml
│   ├── monitoring/prometheus.yaml
│   └── overlays/gitops/            # kustomization, catalog-services, catalog-rollout, catalog-analysis
├── load/budget.js
└── services/catalog/
    ├── pom.xml                     # + micrometer-registry-prometheus, test dependencies
    └── src/
        ├── main/java/boxoffice/catalog/ChaosFilter.java
        └── test/java/boxoffice/catalog/CatalogApiTest.java
```

Faça o commit e a tag: `git add -A && git commit -m "lab 11: delivery" && git tag lab11 && git push --tags`.

## Checklist

- [ ] o `CI` roda em todo push e pull request: matriz de testes verde, orçamento de desempenho verde e, na `main`, o job de imagem faz push de `ghcr.io/<você>/boxoffice-catalog:sha-<commit>` com atestações de proveniência e de SBOM
- [ ] o relatório do Trivy está em **Security → Code scanning**; o portão bloqueia vulnerabilidades CRITICAL com correção
- [ ] um pull request com a regressão proposital foi bloqueado pelo orçamento de desempenho (screenshot)
- [ ] o Argo CD faz o deploy de `k8s/overlays/gitops` a partir do Git; uma mudança manual foi revertida pela autocorreção
- [ ] uma release boa passou pelas etapas do canary; a release ruim foi abortada automaticamente (saída de `kubectl argo rollouts get rollout catalog`)
- [ ] tabela de resultados preenchida em `results/lab11.md`, com a resposta à sua pergunta
- [ ] autoverificação: `gh attestation verify oci://ghcr.io/<você>/boxoffice-catalog:main --owner <você>` passa; push com a tag `lab11`

## Relacionados { #related }

- Teoria: [Plataformas cloud native](../../classes/cloud-native/index.md) ·
  [Entrega: CI/CD, GitOps, estratégias de deploy](../../classes/cloud-native/delivery/index.md) ·
  [Zero trust e cadeia de suprimentos](../../classes/network-security/zero-trust/index.md) ·
  [Orçamentos de desempenho](../../classes/performance/capacity-planning/index.md#performance-budgets)
- Lab anterior: [10. Kubernetes](../10/index.md) — o cluster e os manifestos usados no deploy aqui.
- Projeto: [projeto em equipe](../../exercises/project/index.md) — o seu pipeline faz parte da entrega "K8s + CI/CD".

!!! tip "Próximo: o lab 13 adiciona IA a este pipeline"

    O [lab 13](../13/index.md) se apoia diretamente nestes workflows: um revisor de pull requests com
    IA, geração de testes verificada por testes de mutação, um agente que propõe uma correção quando o
    `CI` falha, release notes por IA e um veredito de canary explicado — com a mesma disciplina de
    permissões, orçamentos e medições.

[Começar: Testes e CI](ci/index.md){ .md-button .md-button--primary }
