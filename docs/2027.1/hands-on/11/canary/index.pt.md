# 5. Canary com Argo Rollouts { #5-canary-with-argo-rollouts }

Um rolling update substitui todo pod pela nova versão assim que ele fica *ready* — mas "ready" só
significa que o processo subiu. Uma versão que responde 20% das requisições com `500` também fica ready.
Um **canary** manda primeiro uma pequena fatia do tráfego para a nova versão, a **mede** contra o objetivo de nível de serviço (SLO, *service level objective*) e
só continua enquanto os números estão bons; caso contrário, aborta e a versão antiga continua atendendo.
Com o **Argo Rollouts** a decisão é automática.

## As peças { #the-pieces }

| Objeto | Arquivo | Papel |
|---|---|---|
| `Rollout` `catalog` | `catalog-rollout.yaml` | substitui o controlador do Deployment; `workloadRef` reaproveita o template de pod de `base/catalog.yaml` |
| `Service` `catalog-stable` / `catalog-canary` | `catalog-services.yaml` | o Argo Rollouts aponta cada um para os pods da sua versão (ele adiciona o hash do template de pod aos seletores) |
| `AnalysisTemplate` `catalog-slo` | `catalog-analysis.yaml` | a cada 30 s, duas consultas PromQL sobre o **canary**: taxa de erro < 1%, p99 < 500 ms |
| Prometheus | `k8s/monitoring/prometheus.yaml` | faz scrape dos Services anotados e rotula toda série com `service="<nome do Service>"` |
| HorizontalPodAutoscaler (HPA) | modificado pelo patch do overlay | agora escala o `Rollout` |

O Prometheus deste lab é mínimo de propósito (um Deployment, um job de scrape):

``` yaml title="k8s/monitoring/prometheus.yaml"
--8<-- "docs/2027.1/hands-on/11/code/k8s/monitoring/prometheus.yaml"
```

A métrica é a do próprio Spring Boot (Micrometer), `http_server_requests_seconds`, exposta em
`/actuator/prometheus` pela dependência adicionada no [passo 1](../ci/index.md) e pelo patch
`MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE` do overlay. Por padrão o Micrometer publica só `_count` e
`_sum`; o patch `MANAGEMENT_METRICS_DISTRIBUTION_PERCENTILESHISTOGRAM_HTTP_SERVER_REQUESTS` do overlay
adiciona as séries `_bucket`, sem as quais a consulta do p99 não retorna nada e essa métrica passaria
sempre. Com o label `service`, a mesma consulta compara `service="catalog-canary"` com
`service="catalog-stable"`.

As etapas do Rollout (veja `catalog-rollout.yaml` no [passo 4](../gitops/index.md)): 25% → espera 2 min
→ 50% → espera 2 min → 100%, com a análise rodando em segundo plano desde a primeira etapa. Sem um
roteador de tráfego, o Argo Rollouts chega a um peso pela **contagem de réplicas** (com 2 réplicas,
"25%" é 1 pod canary ao lado dos estáveis), então a fatia real é aproximada; a
[aula de entrega](../../../classes/cloud-native/delivery/index.md#canary-with-automated-metrics-analysis)
mostra pesos exatos com o plugin da Gateway API.

``` diagram
flowchart LR
    K6["k6 / fãs"] --> ING["Ingress do Traefik"] --> SVC["Service catalog<br/>seleciona todo pod do catalog"]
    SVC --> S1["pod estável"]:::comp
    SVC --> S2["pod estável"]:::comp
    SVC --> C1["pod canary<br/>cerca de um terço das requisições"]
    CS["Service catalog-canary<br/>+ o hash do pod template"] -.-> C1
    PR["Prometheus<br/>scrape a cada 15 s"]:::tech -->|"label service=catalog-canary"| CS
    AN["AnalysisRun<br/>a cada 30 s"]:::tech -->|"PromQL"| PR
```

Execute a vida de uma release — os dois jeitos de ela terminar:

``` diagram-sim
stateDiagram-v2
    [*] --> SetWeight25 : o Argo CD sincroniza uma imagem nova
    SetWeight25 --> Pause1 : o pod canary fica pronto
    Pause1 --> SetWeight50 : 2 min
    SetWeight50 --> Pause2 : o estável cai para 1 pod
    Pause2 --> Healthy : 2 min, o canary vira o estável
    Pause1 --> Degraded : segunda medição reprovada
    Pause2 --> Degraded : segunda medição reprovada
    Degraded --> [*] : canary escalado para 0
    Healthy --> [*]
```

## Acompanhe um rollout { #watch-a-rollout }

Instale o plugin `kubectl` do Argo Rollouts:

=== "macOS"

    ``` shell
    brew install argoproj/tap/kubectl-argo-rollouts
    ```

=== "Linux"

    ``` shell
    curl -fsSLo kubectl-argo-rollouts https://github.com/argoproj/argo-rollouts/releases/download/v1.10.1/kubectl-argo-rollouts-linux-amd64
    chmod +x kubectl-argo-rollouts && sudo mv kubectl-argo-rollouts /usr/local/bin/
    ```

Mantenha carga sobre o serviço enquanto uma nova versão é liberada — a análise precisa de requisições
para medir — usando o script k6 do lab 10 a uma taxa modesta:

``` shell
k6 run -e PEAK=40 load/catalog-hpa.js &          # about 11 minutes of traffic through the Ingress
kubectl argo rollouts -n boxoffice get rollout catalog --watch
```

Qualquer commit em `services/catalog` na `main` produz uma nova imagem e um novo rollout; um rápido é um
comentário em `ChaosFilter.java`. Você deve ver as etapas avançarem (`SetWeight: 25` → `50` → `100`), um
`AnalysisRun` com medições ✔ e, no fim, o novo ReplicaSet marcado como `stable`.

## Uma release ruim { #a-bad-release }

Agora entregue uma release que quebra 30% das requisições, *pelo Git*. Em
`k8s/overlays/gitops/kustomization.yaml`, adicione mais uma operação ao patch do Deployment (depois da
`MANAGEMENT_METRICS_DISTRIBUTION_PERCENTILESHISTOGRAM_HTTP_SERVER_REQUESTS`), com o seu `- op:`
exatamente embaixo das outras linhas `- op:` desse patch. Os commits do `Deploy` reformataram o
arquivo (4 espaços, como abaixo); outra indentação quebra o patch e o Argo CD reporta um
`ComparisonError` em vez de iniciar um canary:

``` yaml
    - op: add                      # lab 11 experiment: a bad release (remove it afterwards)
      path: /spec/template/spec/containers/0/env/-
      value: { name: CHAOS_ERROR_RATE, value: "0.3" }
```

`CHAOS_ERROR_RATE` é lida pelo `ChaosFilter`, que existe só para este experimento:

``` java title="services/catalog/src/main/java/boxoffice/catalog/ChaosFilter.java"
--8<-- "docs/2027.1/hands-on/11/code/services/catalog/src/main/java/boxoffice/catalog/ChaosFilter.java"
```

Faça commit, push e acompanhe (mantenha a carga do k6 rodando):

``` shell
git commit -am "experiment: bad release" && git pull --rebase && git push
kubectl argo rollouts -n boxoffice get rollout catalog --watch
```

Você deve ver, cerca de um minuto depois do sync do Argo CD, o rollout **abortado** e o canary reduzido
a zero. De uma execução de teste:

``` text
Name:            catalog
Namespace:       boxoffice
Status:          ✖ Degraded
Message:         RolloutAborted: Rollout aborted update to revision 2: Background analysis phase error/failed: Metric "error-rate" assessed Failed due to failed (2) > failureLimit (1)
Strategy:        Canary
  Step:          0/4
  SetWeight:     0
  ActualWeight:  0
Images:          boxoffice/catalog:v1 (stable)
```

(Essa execução de teste usou um `boxoffice/catalog:v1` carregado localmente; a sua mostra
`ghcr.io/<você>/boxoffice-catalog:sha-…` como a imagem estável.)

e as medições da métrica `error-rate` foram `[]` (ainda sem tráfego no canary: contado como sucesso por
`len(result) == 0`), `0.068` e `0.285` — duas falhas, acima de `failureLimit: 1`. Os fãs que caíram no
canary viram erros por cerca de um minuto; todos os outros nem perceberam.

<div class="csim" data-sim="canary-analysis" data-chaos="0.3" data-rate="20"></div>

!!! tip "Experimente"

    O simulador repete o rollout a partir do momento em que o pod canary fica pronto, com os arquivos deste lab. Como a consulta real, ele também conta as probes do kubelet e os scrapes do Prometheus no pod canary, e uma série precisa de dois scrapes dentro da janela de 1 minuto.

    - Como abre — `CHAOS_ERROR_RATE` 0.3, k6 a 20 req/s —, as medições são `[]`, `0.258` e `0.284` e o rollout aborta **60 s** depois que o canary recebeu tráfego, na terceira medição, como na execução de teste (`[]`, `0.068`, `0.285`; o modelo deixa de fora os primeiros segundos de um pod novo). Cerca de **120** requisições falharam, **10%** das enviadas naquele minuto.
    - **0**: todo resultado é `[]` — sem erros não existe série 500 — e a v2 vira a estável depois das duas pausas, em **240 s**.
    - **0.02**: os primeiros erros demoram mais para aparecer como série e o rollout aborta em **90 s**. **0.005**: abaixo do limite de 1% toda vez, então a v2 é promovida e falha 0,5% das requisições de todo mundo.
    - **0 req/s** com 0.3: todo resultado é `[]` e o `len(result) == 0` promove a release ruim. **+ Thread.sleep(400)**: um p99 de 0,409 s passa no 0,5 s do canary; só o performance gate do [passo 3](../performance-gate/index.md) barra essa regressão.

`Degraded` é o sinal para corrigir para a frente no Git: reverta o experimento
(`git revert HEAD && git push`), o Argo CD sincroniza e o próximo rollout começa de um estado limpo.

!!! warning "O que um canary não consegue pegar"

    - **Migrações de banco** rodam uma vez, para as duas versões: precisam ser compatíveis com a versão
      anterior (expand/contract), porque a versão antiga continua rodando durante um canary — e depois
      de um canary abortado.
    - **Erros raros** precisam de muitas requisições no canary para aparecer; com pouco tráfego, alongue
      as pausas.
    - **Efeitos colaterais** (pagamentos, e-mails) das requisições do canary são reais.
    - **Sem tráfego, sem evidência**: sem requisições no canary todo resultado é `[]`, que o `len(result) == 0` conta como aprovação — mantenha carga no serviço durante todo o rollout.

[Próximo: Meça](../measure/index.md){ .md-button .md-button--primary }
