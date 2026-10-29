# 6. Meça { #6-measure-it }

Entrega se mede por quão rápido uma mudança chega aos usuários e com que segurança. As quatro **métricas
DORA** — frequência de deploy, **lead time de mudanças**, taxa de falha de mudanças e tempo de
restauração — são o vocabulário da indústria; este passo mede as duas que dá para observar num lab, mais
o custo de cada etapa do seu pipeline.

| # | Experimento | O que você registra |
|---|---|---|
| A | etapas do pipeline | duração de cada job do `CI` e do `Deploy` |
| B | lead time | commit enviado → nova versão atendendo no cluster |
| C | portão de desempenho | números do orçamento antes e depois da regressão proposital |
| D | canary | tempo do sync ao abort; taxa de erro medida no canary; requisições que falharam |

## A. Etapas do pipeline { #a-pipeline-stages }

Abra a última execução verde do `CI` na `main` (**Actions → CI**): o resumo mostra a duração de cada
job. Faça o mesmo para o `Deploy`. Ou, com a GitHub CLI:

``` shell
gh run list --workflow CI --limit 5
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name)\t\(.startedAt)\t\(.completedAt)"'
```

## B. Lead time

Faça uma mudança visível (por exemplo, uma nova linha de comentário em `ChaosFilter.java`), anote a hora,
faça push e registre quando cada etapa termina:

``` shell
date +%T && git commit -am "lead time probe" && git pull --rebase && git push
kubectl argo rollouts -n boxoffice get rollout catalog --watch    # note the time it is Healthy again
```

| Etapa | Hora | Desde o push |
|---|---|---|
| push | | 0 |
| `CI` verde | | |
| commit do `Deploy` enviado | | |
| Argo CD sincronizado (interface ou `kubectl -n argocd get application boxoffice`) | | |
| Rollout `Healthy`, nova versão estável | | |

As maiores fatias costumam ser os testes (imagens do Testcontainers, Maven), o build da imagem e as
pausas do canary — as pausas são um preço deliberado pela segurança.

## C. Portão de desempenho { #c-performance-gate }

Registre as linhas do orçamento (p95, p99, falhas) da última execução verde e da execução com o
`Thread.sleep(400)` proposital do [passo 3](../performance-gate/index.md).

## D. Canary

Da release ruim do [passo 5](../canary/index.md): a hora em que o Argo CD sincronizou, a hora em que o
rollout ficou `Degraded`, as medições de `error-rate` (`kubectl -n boxoffice get analysisrun -o yaml`) e
a fatia de requisições que falharam que o k6 viu nesse intervalo.

!!! example "Forma esperada (ilustrativa)"

    Nos runners gratuitos do GitHub, a matriz de testes e o job de imagem levam alguns minutos cada; o
    orçamento de desempenho, uns dois; o `Deploy`, bem menos de um minuto. O lead time é dominado pelo
    CI, mais a consulta do Argo CD de até 3 minutos, mais as pausas do canary (4 minutos aqui): algo
    como 10–20 minutos do push até a liberação completa. O canary ruim aborta cerca de um a dois
    intervalos de análise depois que o pod canary começa a receber tráfego.

## Resultados { #results }

Copie para `results/lab11.md` e preencha.

| Métrica | Valor |
|---|---|
| A · matriz `test` (job mais lento) / `performance budget` / `image (catalog)` / `Deploy` (min:s) | |
| B · Lead time: push → `CI` verde → commit de deploy → sincronizado → estável (min:s cada) | |
| C · p95 / p99 / falhas do orçamento — execução normal | |
| C · p95 / p99 / falhas do orçamento — com a regressão (o PR ficou vermelho?) | |
| D · Sync → `Degraded` (s); medições de `error-rate` | |
| D · Requisições que falharam durante o canary ruim (% das requisições do k6) | |

Abaixo da tabela: qual etapa você otimizaria primeiro para encurtar o lead time, e quanto isso custaria
em segurança?

[Voltar à visão geral](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
