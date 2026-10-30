São 09:40 do dia da venda. Um bug no `inventory` faz uma reserva de assento expirar dois minutos antes da hora, e a correção é uma mudança de uma linha. Em um time sem pipeline de entrega, a correção espera: alguém precisa fazer o build, alguém precisa copiar o jar, alguém precisa reiniciar servidores um a um, e ninguém quer fazer isso vinte minutos antes do maior pico de tráfego do ano. Em um time com um bom pipeline, a correção é aceita, construída, varrida, publicada para 5 % do tráfego, **verificada automaticamente contra os SLOs** e promovida — ou revertida — sem que ninguém toque em um servidor.

Esta página constrói esse pipeline em quatro camadas: a infraestrutura é **código**, cada mudança é **integrada e testada continuamente**, o cluster **puxa** seu estado desejado do Git, e cada release é **exposta gradualmente** e julgada por métricas.

``` diagram-sim
flowchart LR
    pr["Pull request<br/>correção do inventory"] --> ci["CI: build · teste · varredura<br/>SBOM · assinatura · push da imagem"]
    ci --> cfg["Repo de config:<br/>digest da imagem atualizado"]
    cfg --> argo["Argo CD:<br/>sincroniza o cluster com o Git"]
    argo --> canary["Canary 5 % → 25 % → 50 %"]
    canary --> an{"Análise de métricas<br/>taxa de erros, p99"}
    an -->|"saudável"| full["100 % — promovido"]
    an -->|"degradado"| rb["Rollback automático"]
```

---

## Infraestrutura como código { #iac }

O ambiente de produção do BoxOffice tem uma VPC, sub-redes, um cluster Kubernetes, um PostgreSQL gerenciado, um Redis gerenciado, um cluster Kafka, buckets, registros DNS e papéis IAM — algumas centenas de recursos. Criados com cliques em um console, eles não podem ser revisados, reproduzidos ou reconstruídos após um desastre, e o staging se afasta silenciosamente da produção. **Infraestrutura como código (IaC)** descreve esses recursos em arquivos versionados que uma ferramenta aplica.

| Propriedade | Por que importa para o BoxOffice |
|---|---|
| **Declarativa** | Você escreve *o que* deve existir; a ferramenta calcula o plano de criar/atualizar/apagar |
| **Revisável** | Uma mudança no tamanho da instância do banco é um pull request com diff e aprovador |
| **Reproduzível** | Staging e um ambiente de teste de carga são os mesmos módulos com variáveis diferentes — paridade para [testes de desempenho](../../performance/methodology/index.md) |
| **Recuperável** | Depois da perda de uma região, o ambiente é recriado a partir do código (os dados vêm dos backups — veja [Recuperação de desastres](../../reliability/disaster-recovery/index.md)) |

O **Terraform** (HashiCorp) é a ferramenta de IaC mais usada. Em 2023 a HashiCorp mudou sua licença para a Business Source License; o fork comunitário **OpenTofu**, hospedado pela Linux Foundation, mantém a licença de código aberto MPL 2.0 e a mesma linguagem (HCL) e o mesmo fluxo de CLI[^1]. O trecho abaixo funciona em ambos:

```hcl title="infra/modules/data/main.tf"
variable "env"            { type = string }                 # "staging" | "prod"
variable "db_instance"    { type = string }                 # e.g. "db.r6g.large"
variable "private_subnets" { type = list(string) }

resource "aws_db_subnet_group" "boxoffice" {
  name       = "boxoffice-${var.env}"
  subnet_ids = var.private_subnets
}

resource "aws_db_instance" "inventory" {
  identifier                  = "boxoffice-inventory-${var.env}"
  engine                      = "postgres"
  engine_version              = "17"
  instance_class              = var.db_instance
  allocated_storage           = 100
  multi_az                    = var.env == "prod"           # standby in another AZ
  db_subnet_group_name        = aws_db_subnet_group.boxoffice.name
  username                    = "boxoffice"
  manage_master_user_password = true                        # password kept in Secrets Manager
  backup_retention_period     = 7
  deletion_protection         = var.env == "prod"
  tags = { project = "boxoffice", env = var.env, service = "inventory" }
}

resource "aws_s3_bucket" "tickets" {
  bucket = "boxoffice-tickets-${var.env}"
  tags   = { project = "boxoffice", env = var.env }
}

output "inventory_endpoint" { value = aws_db_instance.inventory.endpoint }
```

```hcl title="infra/envs/prod/main.tf"
terraform {
  backend "s3" {                                  # shared, locked state
    bucket       = "boxoffice-tfstate"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}

module "data" {
  source          = "../../modules/data"
  env             = "prod"
  db_instance     = "db.r6g.large"
  private_subnets = module.network.private_subnet_ids
}
```

```bash
tofu init          # download providers, configure the state backend
tofu plan          # show what would change — reviewed in the pull request
tofu apply         # apply exactly the reviewed plan
```

A ferramenta mantém um **arquivo de estado** que mapeia cada recurso do código para um ID de recurso real. Ele precisa ser **remoto e com lock** (dois engenheiros aplicando ao mesmo tempo o corrompem) e é sensível (pode conter segredos). Quando alguém muda um recurso à mão, o próximo `plan` mostra a **deriva** (*drift*) — um `plan` agendado na CI que alerta sobre deriva mantém o console honesto.

| Ferramenta | Estilo | Observações |
|---|---|---|
| **Terraform / OpenTofu** | HCL declarativa, qualquer provedor | O padrão comum; enorme ecossistema de providers |
| **Pulumi** | Linguagens de uso geral (TypeScript, Python, Go, Java) | Laços e abstrações em uma linguagem de verdade; mesmo modelo plan/apply |
| **AWS CloudFormation / CDK, Azure Bicep, GCP Infrastructure Manager** | Nativas do provedor | Sem arquivo de estado para gerenciar; uma nuvem só |
| **Crossplane** | Recursos customizados do Kubernetes reconciliados por controladores | Infraestrutura gerenciada pelo mesmo laço GitOps das aplicações |

---

## Integração contínua { #continuous-integration }

**Integração contínua (CI)** significa que toda mudança é integrada à branch principal com frequência e verificada automaticamente por build e testes. **Entrega contínua (CD)** significa que toda mudança verificada pode ser *liberada* a qualquer momento; **deploy contínuo** vai um passo além e libera cada mudança automaticamente[^2].

A CI do BoxOffice roda no GitHub Actions. Em um pull request ela faz build e testa; na `main` ela também publica uma imagem assinada e propõe a nova versão ao repositório de configuração:

```yaml title=".github/workflows/inventory.yaml"
name: inventory
on:
  pull_request: { paths: [ "inventory/**" ] }
  push:         { branches: [ main ], paths: [ "inventory/**" ] }

permissions:
  contents: read
  packages: write        # push to GitHub Container Registry
  id-token: write        # keyless signing with Sigstore
  attestations: write

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      digest: ${{ steps.push.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "21", cache: maven }
      - name: Unit and integration tests (Testcontainers)
        run: mvn -B -f inventory/pom.xml verify
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
      - name: Build and push image
        id: push
        uses: docker/build-push-action@v6
        with:
          context: inventory
          push: ${{ github.ref == 'refs/heads/main' }}
          tags: ghcr.io/boxoffice/inventory:${{ github.sha }}
          sbom: true                      # SBOM attached to the image
          provenance: mode=max            # SLSA provenance
      - name: Scan for critical vulnerabilities
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: ghcr.io/boxoffice/inventory:${{ github.sha }}
          severity: CRITICAL
          exit-code: "1"
      - name: Sign image (keyless)
        if: github.ref == 'refs/heads/main'
        run: cosign sign --yes ghcr.io/boxoffice/inventory@${{ steps.push.outputs.digest }}

  propose-release:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Bump the image digest in the config repo (staging overlay)
        run: |
          git clone https://x-access-token:${{ secrets.CONFIG_REPO_TOKEN }}@github.com/<your-org>/boxoffice-config.git
          cd boxoffice-config/apps/inventory/overlays/staging
          kustomize edit set image inventory=ghcr.io/boxoffice/inventory@${{ needs.build.outputs.digest }}
          git commit -am "inventory: ${{ github.sha }}" && git push
```

Repare no que o pipeline **não** faz: ele nunca executa `kubectl apply` contra a produção e não guarda credenciais do cluster. Ele só escreve no Git. O cluster puxa.

!!! example "No código do BoxOffice: `CI` e `Deploy` (lab 11)"

    O [Hands-on 11 — CI](../../../hands-on/11/ci/index.md) constrói uma versão menor desse pipeline para um único repositório: um workflow `CI` testa todos os serviços numa matriz, roda um **orçamento de desempenho com k6** contra o `catalog` (veja [Planejamento de capacidade — orçamentos de desempenho](../../performance/capacity-planning/index.md#performance-budgets)) e só então — na `main` — constrói, escaneia, atesta e publica a imagem. Leia a linha `needs:`: nenhuma imagem existe se os testes *e* o orçamento não passaram. O scan bloqueia só **vulnerabilidades críticas que têm correção** (um gate que falha por tudo acaba desligado), e a assinatura usa as atestações de build do GitHub em vez do `cosign`. Um workflow separado, `Deploy`, escreve a nova tag (`sha-…`, não um digest) em `k8s/overlays/gitops` no mesmo repositório — o "repositório de configuração" é uma pasta.

    ``` { .yaml title=".github/workflows/ci.yaml (image job: order of the jobs, the vulnerability gate, provenance)" }
    --8<-- "docs/2027.1/hands-on/11/code/.github/workflows/ci.yaml:67:70,119:126,142:147"
    ```

    ``` { .yaml title=".github/workflows/deploy.yaml (the only thing CD does: a commit)" }
    --8<-- "docs/2027.1/hands-on/11/code/.github/workflows/deploy.yaml:28:45"
    ```


!!! tip "Mantenha a CI rápida"

    Um pipeline que leva 40 minutos é um pipeline que as pessoas contornam. Faça cache das dependências (`cache: maven`), rode os testes unitários antes dos testes de integração lentos, construa imagens com cache de camadas e execute jobs independentes em paralelo. A pesquisa DORA associa lead times curtos a *mais* estabilidade, não menos[^3].

---

## GitOps com Argo CD { #gitops }

O **GitOps** aplica o laço de controle do Kubernetes à própria entrega. Os princípios OpenGitOps são: o estado desejado é **declarativo**, **versionado e imutável** (no Git), **puxado automaticamente** por um agente no cluster e **continuamente reconciliado**[^4].

``` diagram-sim
sequenceDiagram
    participant Dev as Engenheira
    participant Git as Repo de config (Git)
    participant Argo as Argo CD (no cluster)
    participant K8s as API do Kubernetes
    Dev->>Git: PR "inventory → sha256:ab12…" (revisado, aceito)
    Argo->>Git: polling / webhook: novo commit
    Argo->>K8s: diff desejado vs real → aplica
    K8s-->>Argo: recursos saudáveis
    Note over Argo,K8s: alguém roda kubectl edit à mão…
    Argo->>K8s: deriva detectada → revertida para o Git (self-heal)
```

```yaml title="config/argocd/inventory-prod.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: inventory-prod
  namespace: argocd
spec:
  project: boxoffice
  source:
    repoURL: https://github.com/<your-org>/boxoffice-config.git
    targetRevision: main
    path: apps/inventory/overlays/prod
  destination:
    server: https://kubernetes.default.svc
    namespace: boxoffice
  syncPolicy:
    automated:
      prune: true        # delete resources removed from Git
      selfHeal: true     # revert manual changes
    syncOptions: [ CreateNamespace=true ]
```

| | CD por push (a CI roda `kubectl apply`) | **GitOps por pull** (Argo CD, Flux) |
|---|---|---|
| Credenciais | A CI tem credenciais de cluster-admin — um alvo valioso | Só o agente dentro do cluster pode mudar o cluster |
| Deriva | Não detectada até o próximo deploy | Detectada e, opcionalmente, revertida continuamente |
| Trilha de auditoria | Espalhada pelos logs da CI | `git log` do repo de configuração |
| Rollback | Rodar de novo um pipeline antigo | `git revert` |
| Vários clusters | Um passo de pipeline por cluster | Cada cluster puxa o próprio caminho |

A **promoção** entre ambientes vira um pull request que copia o digest de `overlays/staging` para `overlays/prod` — revisado, auditável e trivialmente reversível.

!!! example "No código do BoxOffice: uma Application do Argo CD (lab 11)"

    O [Hands-on 11 — GitOps](../../../hands-on/11/gitops/index.md) tem um só ambiente, portanto uma só `Application`, que segue `k8s/overlays/gitops` na `main`, com `prune` e `selfHeal` ligados. O lab testa o segundo de propósito: escale o `redis` para 0 com `kubectl` e, em segundos, o Argo CD acusa `OutOfSync` e restaura 1 réplica. O preço de puxar é latência: o Argo CD consulta o Git a cada 3 minutos, o que o lab conta no seu lead time (cerca de 10–20 minutos do push até o rollout completo).

    ``` { .yaml title="k8s/argocd/application.yaml (lab 11)" }
    --8<-- "docs/2027.1/hands-on/11/code/k8s/argocd/application.yaml"
    ```


---

## Estratégias de deploy { #deployment-strategies }

Fazer o deploy (colocar código novo nos servidores) e **liberar** (expô-lo aos usuários) são passos diferentes. As estratégias abaixo diferem em como os separam:

| Estratégia | Como | Indisponibilidade | Capacidade extra | Rollback | Raio de impacto |
|---|---|---|---|---|---|
| **Recreate** | Para todas as antigas, inicia todas as novas | Sim | Nenhuma | Novo deploy da antiga (lento) | 100 % |
| **Rolling update** | Substitui alguns pods por vez (`maxSurge`, `maxUnavailable`) | Não | Pequena (surge) | Avançar/voltar gradualmente | Cresce com o rollout |
| **Blue/green** | Roda a nova versão completa ao lado da antiga; troca o roteador de uma vez | Não | 2× durante a troca | Trocar de volta — segundos | 100 % na troca, mas desfazer é instantâneo |
| **Canary** | Envia uma pequena % do tráfego à nova versão e aumenta enquanto as métricas estão saudáveis | Não | Pequena | Peso em 0 — segundos | 1–5 % no início |
| **Shadow (espelhamento)** | Copia o tráfego real para a nova versão; descarta suas respostas | Não | Até 2× | Nada a reverter | 0 % (cuidado com efeitos colaterais: pagamentos!) |
| **Feature flags** | Faz deploy do código desligado; ativa por usuário/segmento em tempo de execução | Não | Nenhuma | Desligar a flag | O segmento escolhido |

Rolling updates são o padrão do Kubernetes e bastam para a maioria das mudanças. Para mudanças arriscadas no caminho de compra — `inventory`, `order`, `payment` — o BoxOffice usa **canaries** e, para funcionalidades de produto, **feature flags** (com uma API neutra de fornecedor como a OpenFeature), que desacoplam totalmente *deploy* de *release*: o código vai para produção na terça, e a funcionalidade é ativada para 1 % dos fãs na quinta.

!!! warning "O banco de dados não faz rollback"

    Duas versões de `order` rodam lado a lado durante qualquer rolling update ou canary, então toda mudança de esquema precisa ser **compatível com versões anteriores**. Use **expand/contract** (mudança paralela): (1) *expand* — adicione a nova coluna, anulável; (2) faça deploy de código que escreve nas duas e lê a nova com fallback; (3) faça o backfill; (4) *contract* — remova a coluna antiga em uma release posterior. Nunca renomeie nem apague uma coluna na mesma release que deixa de usá-la.

---

## Canary com análise automática de métricas { #canary-with-automated-metrics-analysis }

Um canary é tão bom quanto a decisão de promovê-lo. Olhar um dashboard e "achar que está tudo bem" não é uma decisão. O **Argo Rollouts** substitui um Deployment por um `Rollout` que desloca o tráfego em etapas e executa uma **análise** em cada etapa, consultando o backend de métricas e abortando automaticamente quando o canary está pior que seus limiares[^5].

```yaml title="config/apps/inventory/base/rollout.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: inventory }
spec:
  replicas: 10
  selector: { matchLabels: { app: inventory } }
  template:
    metadata: { labels: { app: inventory } }
    spec:
      containers:
        - name: inventory
          image: ghcr.io/boxoffice/inventory@sha256:ab12c3d4e5f6
  strategy:
    canary:
      canaryService: inventory-canary
      stableService: inventory-stable
      trafficRouting:
        plugins:
          argoproj-labs/gatewayAPI: { httpRoute: inventory, namespace: boxoffice }
      analysis:                                  # runs in the background from step 1
        templates: [ { templateName: inventory-slo } ]
        startingStep: 1
      steps:
        - setWeight: 5
        - pause: { duration: 10m }
        - setWeight: 25
        - pause: { duration: 10m }
        - setWeight: 50
        - pause: { duration: 10m }
```

```yaml title="config/apps/inventory/base/analysis.yaml"
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: inventory-slo }
spec:
  metrics:
    - name: error-rate
      interval: 1m
      failureLimit: 2                       # two bad minutes → abort and roll back
      successCondition: result[0] < 0.005   # < 0.5 % of requests fail
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_server_requests_seconds_count{service="inventory-canary",status=~"5.."}[2m]))
            /
            sum(rate(http_server_requests_seconds_count{service="inventory-canary"}[2m]))
    - name: p99-latency
      interval: 1m
      failureLimit: 2
      successCondition: result[0] < 0.300   # p99 below 300 ms (the hold SLO)
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            histogram_quantile(0.99, sum by (le) (
              rate(http_server_requests_seconds_bucket{service="inventory-canary"}[2m])))
```

!!! example "No código do BoxOffice: o canary do `catalog` (lab 11)"

    O [Hands-on 11 — Canary](../../../hands-on/11/canary/index.md) usa os mesmos dois objetos com números menores: 25% → 2 min → 50% → 2 min e, a cada 30 s, uma taxa de erro abaixo de 1% e um p99 abaixo de 500 ms; `failureLimit: 1` significa que a segunda medição ruim aborta. Sem um roteador de tráfego, os pesos são obtidos por **número de réplicas**, então são aproximados. A guarda `len(result) == 0 || isNaN(...)` conta "ainda sem tráfego no canary" como aprovação. Na versão ruim do lab (30% das requisições falham), as medições foram `[]`, `0.068` e `0.285`, e o rollout foi abortado: os fãs que caíram no canary viram erros por cerca de um minuto; ninguém mais percebeu.

    ``` { .yaml title="k8s/overlays/gitops/catalog-rollout.yaml (the steps)" }
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/catalog-rollout.yaml:16:29"
    ```

    ``` { .yaml title="k8s/overlays/gitops/catalog-analysis.yaml (the error-rate check)" }
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/catalog-analysis.yaml:6:17"
    ```

### Quanto tempo um canary precisa rodar? { #how-long-must-a-canary-run }

Um canary a 5 % vê poucas requisições, e erros raros precisam de muitas requisições para aparecer. Antes de escolher a duração das pausas, estime quantas requisições do canary você precisa para distinguir uma regressão real de ruído. A tabela usa o tamanho de amostra padrão por aproximação normal para comparar duas proporções (α unilateral = 5 %, poder de 80 %), com uma taxa de erros de base ilustrativa de 0,1 % e 400 requisições por segundo chegando ao `inventory`:

```python exec="1"
from math import sqrt, ceil

Z_ALPHA, Z_BETA = 1.645, 0.842     # one-sided 5 % significance, 80 % power
BASELINE = 0.001                   # 0.1 % of requests fail today (assumption)
TOTAL_RPS = 400                    # requests/s reaching inventory (assumption)

def needed(p0, p1):
    pbar = (p0 + p1) / 2
    num = Z_ALPHA * sqrt(2 * pbar * (1 - pbar)) + Z_BETA * sqrt(p0 * (1 - p0) + p1 * (1 - p1))
    return ceil((num / (p1 - p0)) ** 2)

print("| Regression to detect | Canary requests needed | Time at 5 % weight | Time at 25 % weight |")
print("|---|---|---|---|")
for p1 in (0.010, 0.005, 0.002):
    n = needed(BASELINE, p1)
    t5 = n / (TOTAL_RPS * 0.05) / 60
    t25 = n / (TOTAL_RPS * 0.25) / 60
    print(f"| {BASELINE:.1%} → {p1:.1%} errors | {n:,} | {t5:.1f} min | {t25:.1f} min |")
```

Regressões grandes aparecem em um ou dois minutos; dobrar uma taxa de erros pequena exige um quarto de hora a 5 %. É por isso que as etapas de um canary são medidas em **minutos, não segundos**, por que a análise compara o canary com a **linha de base estável** rodando ao mesmo tempo (mesmo tráfego, mesmo horário), e por que serviços com pouco tráfego se beneficiam de pausas mais longas ou de tráfego sintético. O SRE workbook do Google discute esses trade-offs no capítulo sobre canarying de releases[^6].

!!! example "BoxOffice: nada de canary durante a venda"

    Mesmo com análise automática, o BoxOffice declara um **congelamento de mudanças** no caminho de compra de 30 minutos antes de uma venda até o fim dela: o tráfego é incomum demais para a linha de base significar algo, e o custo de um rollout ruim é máximo. A correção das 09:40 da introdução, portanto, espera — a menos que o responsável pela venda autorize uma exceção, por um caminho também escrito com antecedência: um canary *expresso* (5 % → 100 % com 5 minutos de análise) às 09:42. Escrever essa regra com antecedência faz parte da engenharia de entrega.

---

## Medindo a entrega: as métricas DORA { #measuring-delivery-the-dora-metrics }

O programa de pesquisa DORA (DevOps Research and Assessment) encontrou quatro métricas que predizem o desempenho de entrega de software e que se movem juntas em times de alto desempenho[^3]:

| Métrica | Pergunta | Vazão ou estabilidade |
|---|---|---|
| **Frequência de deploy** | Com que frequência fazemos deploy em produção? | Vazão |
| **Lead time de mudanças** | Quanto tempo do commit até rodar em produção? | Vazão |
| **Taxa de falha de mudanças** | Que fração dos deploys causa uma falha que exige correção? | Estabilidade |
| **Tempo para restaurar o serviço** | Quanto tempo para se recuperar de tal falha? | Estabilidade |

A descoberta principal — velocidade e estabilidade **não** são um trade-off — é o argumento para tudo nesta página: mudanças pequenas, frequentes e verificadas automaticamente são mais rápidas e mais seguras do que mudanças grandes, raras e manuais.

---

## IA no pipeline { #ai-in-the-pipeline }

Os pipelines cada vez mais incluem etapas de IA: revisão automática de pull requests, testes gerados, agentes que propõem correções para builds quebrados, análise de canary assistida por IA, notas de release e resumos de incidentes — e as questões de segurança e governança que elas levantam. Esses temas têm aula própria: **[Entrega assistida por IA](../../ai-delivery/index.md)**. As bases desta página — builds reproduzíveis, GitOps, rollouts controlados por métricas — são o que torna seguro adotar essas etapas de IA.

---

## Trade-offs

| Decisão | Escolha A quando… | Escolha B quando… |
|---|---|---|
| Rolling vs canary | Mudança de baixo risco, bons testes, rollback rápido | Caminho crítico, comportamento difícil de testar sob tráfego real |
| Blue/green vs canary | Você precisa de uma troca instantânea tudo-ou-nada (ex.: mudança de protocolo) e pode pagar 2× de capacidade por pouco tempo | Você quer limitar o raio de impacto e julgar por métricas |
| Feature flag vs canary | Expor comportamento de *produto* a usuários escolhidos | Validar um *build novo* como um todo |
| Pipeline de monorepo vs por serviço | Ferramentas compartilhadas, mudanças atômicas entre serviços | Times independentes e cadências de release próprias |

!!! tip "Na entrevista"

    Quando o entrevistador perguntar "como você publica isso com segurança?", responda em camadas: **imagens imutáveis construídas uma vez**, **GitOps** para que a produção seja igual ao Git, **canary** no caminho crítico com **rollback automático por métricas de SLO** (taxa de erros e p99 comparados com a linha de base), **feature flags** para mudanças de produto e migrações **expand/contract** para que duas versões rodem lado a lado. Mencione que a duração do canary depende do volume de tráfego — isso mostra que você entende a estatística, não só a ferramenta.

!!! success "Boas práticas"

    - **Faça o job da imagem depender dos testes e do orçamento de desempenho** — um artefato que falhou numa verificação nunca existe, então não pode ser implantado por engano. No BoxOffice: `needs: [test, performance]` em `ci.yaml` ([lab 11 — CI](../../../hands-on/11/ci/index.md)).
    - **Fixe as actions de terceiros por SHA do commit, com a versão num comentário** — uma tag pode ser movida para código malicioso; um SHA não. No BoxOffice: todo `uses:` de `ci.yaml` e `deploy.yaml`, mantido atualizado pelo Dependabot ([lab 11 — cadeia de suprimentos](../../../hands-on/11/supply-chain/index.md)).
    - **Dê a cada job as menores permissões de que ele precisa** — `contents: read` por padrão; só o job da imagem pode escrever pacotes e atestações. No BoxOffice: os blocos `permissions:` de `ci.yaml`.
    - **Rode os deploys um de cada vez** — dois deploys simultâneos podem gravar as tags na ordem errada. No BoxOffice: `concurrency: deploy` com `cancel-in-progress: false` em `deploy.yaml` ([lab 11 — GitOps](../../../hands-on/11/gitops/index.md)).
    - **Decida o que "sem dados" significa numa análise de canary** — no início, o canary ainda não tem tráfego; uma análise que falha com resultado vazio aborta todo rollout, uma que o ignora para sempre promove às cegas. No BoxOffice: a guarda `len(result) == 0` de `catalog-analysis.yaml` ([lab 11 — Canary](../../../hands-on/11/canary/index.md)).

!!! warning "Armadilhas"

    - **Construir um artefato diferente por ambiente**: o que você testou não é o que você publica. Construa uma vez, promova por digest.
    - **Canary sem análise automática**: uma pessoa olhando gráficos promove tudo.
    - **Canary julgado por CPU**: julgue por SLIs voltados ao usuário (erros, latência), comparados com a linha de base estável.
    - **Espelhar um serviço com efeitos colaterais**: `POST /payments` espelhados cobram cartões reais duas vezes.
    - **Estado do IaC em um notebook**: perdido, sem lock ou cheio de segredos.
    - **Feature flags de vida longa**: cada flag é um desvio no código; remova as flags depois do rollout.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    IAC["IaC: Terraform / OpenTofu<br/>plan, apply, state remoto"] --> INFRA["VPC, cluster,<br/>serviços de dados gerenciados"]
    INFRA --> DR["recriar após perder uma região<br/>→ Recuperação de desastres"]
    CI["CI: build, teste, scan,<br/>SBOM, assinatura"] --> IMG["imagem por digest"]
    IMG --> GIT["repo de configuração:<br/>estado desejado no Git"]
    GIT --> ARGO["Argo CD puxa,<br/>reconcilia o drift"]
    ARGO --> STRAT["rolling, blue/green,<br/>canary, feature flags"]
    STRAT --> EXP["expand/contract:<br/>schema retrocompatível"]
    STRAT --> AN["análise do canary: taxa de erro,<br/>p99 vs baseline estável"]
    AN --> SLO["SLIs e SLOs<br/>→ Confiabilidade, Observabilidade"]
    AN --> N["tamanho da amostra:<br/>minutos, não segundos"]
    STRAT --> DORA["métricas DORA"]
    CI --> AI["passos de IA no pipeline<br/>→ Entrega assistida por IA"]
```

**Componentes da paleta:** [`vpc`](../../../reference/components/network/index.md#vpc) (criada por IaC) · [`sql`](../../../reference/components/storage/index.md#sql) · [`cache`](../../../reference/components/storage/index.md#cache) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (gerenciados, declarados em Terraform) · [`ingress`](../../../reference/components/edge/index.md#ingress) (o Gateway API divide o tráfego do canary) · [`metrics`](../../../reference/components/observability/index.md#metrics) (consultadas pela análise do canary) · [`app`](../../../reference/components/compute/index.md#app) (`inventory`, `order`, `payment` com canary). **Cenários:** — a entrega acontece fora do simulador; as métricas que julgam um canary são as do `observability-stack`. **Continua em:** [Observabilidade — SLOs](../../observability/slo/index.md), [Confiabilidade — recuperação de desastres](../../reliability/disaster-recovery/index.md), [Performance — budgets no CI](../../performance/capacity-planning/index.md#performance-budgets), [Entrega assistida por IA](../../ai-delivery/index.md), [Hands-on 13 — canary](../../../hands-on/13/canary/index.md), [Marcos do projeto](../../../exercises/project/milestones/index.md).

---

[^1]: OpenTofu. [OpenTofu documentation](https://opentofu.org/docs/){target="_blank"}; HashiCorp. [Terraform language documentation](https://developer.hashicorp.com/terraform/language){target="_blank"}.
[^2]: HUMBLE, J.; FARLEY, D. *Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation*. Addison-Wesley, 2010.
[^3]: FORSGREN, N.; HUMBLE, J.; KIM, G. *Accelerate: The Science of Lean Software and DevOps*. IT Revolution, 2018; [DORA research](https://dora.dev/){target="_blank"}.
[^4]: OpenGitOps. [GitOps Principles v1.0](https://opengitops.dev/){target="_blank"}; Argo CD. [Documentation](https://argo-cd.readthedocs.io/){target="_blank"}.
[^5]: Argo Rollouts. [Canary strategy and analysis](https://argo-rollouts.readthedocs.io/){target="_blank"}.
[^6]: BEYER, B. et al. (eds.). [The Site Reliability Workbook](https://sre.google/workbook/canarying-releases/){target="_blank"}, cap. 16 "Canarying Releases". O'Reilly, 2018.
