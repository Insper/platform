# 5. Meça { #5-measure-it }

O Kubernetes promete elasticidade, pelo Horizontal Pod Autoscaler (HPA), e autocura. Coloque números nas duas. Como sempre, rode cada
experimento duas vezes e reporte a segunda execução; os números nas caixas de "forma esperada" são
**ilustrativos** (vêm de uma execução num laptop e os seus vão ser outros).

| # | Experimento | Botão | O que registrar |
|---|---|---|---|
| A | réplicas fixas vs HPA | HPA apagado vs aplicado | p95, p99, erros, máximo de réplicas, tempo para escalar |
| B | rolling update sob carga | com vs sem readiness probe + `preStop` | requisições com falha durante o rollout |
| C | autocura | apagar um pod / parar um nó | tempo até a capacidade voltar (MTTR, *mean time to repair*) |

## A. Réplicas fixas vs HPA { #a-fixed-replicas-vs-hpa }

``` shell
# before: two fixed replicas
kubectl -n boxoffice delete hpa catalog
kubectl -n boxoffice scale deployment catalog --replicas=2
k6 run -e PEAK=1000 load/catalog-hpa.js

# after: the HPA
kubectl apply -k k8s/overlays/local
mkdir -p results && sh scripts/watch-hpa.sh > results/lab10-hpa.csv &
k6 run -e PEAK=1000 load/catalog-hpa.js
kubectl -n boxoffice get hpa catalog -w  # until REPLICAS is 2 again (minutes after k6 ends), then Ctrl+C
kill %1                                  # stop the watcher
```

Do `results/lab10-hpa.csv`, leia: o momento em que o uso de unidade central de processamento (CPU, *central processing unit*) passou de 60% pela primeira vez, o momento em
que o `desired` aumentou pela primeira vez (tempo de reação), o momento em que o `ready` chegou ao
máximo (tempo até a capacidade), o número máximo de réplicas e o momento em que o `desired` voltou
a 2 (scale-down). Faça um gráfico de `cpu`, `desired` e
`ready` ao longo do tempo — uma planilha basta — e adicione-o aos seus resultados.

!!! example "Forma esperada (ilustrativa)"

    Uma execução com `PEAK=1000` num laptop (kind, 3 nós dividindo 8 CPUs), começando com pods
    aquecidos, amostrada do arquivo de valores separados por vírgula (CSV, *comma-separated values*):

    | t (min:s) | CPU (% do request) | desired | current | ready |
    |---|---|---|---|---|
    | 0:00 | 3 | 2 | 2 | 2 |
    | 1:48 | 63 | 2 | 2 | 2 |
    | 2:03 | 79 | 3 | 2 | 2 |
    | 2:34 | 123 | 5 | 3 | 3 |
    | 3:33 | 247 | 8 | 6 | 4 |
    | 4:05 | 109 | 8 | 8 | 3 |
    | 5:37 | 131 | 8 | 8 | 5 |
    | 7:31 | 220 | 8 | 8 | 8 |
    | 10:26 | 13 | 7 | 8 | 7 |
    | 13:00 | 4 | 2 | 3 | 2 |

    Os dois pods aquecidos passaram de 60% 1:48 depois do início da rampa (cerca de 600 req/s); o HPA
    pediu um terceiro pod 15 s depois e oito em 3:33, mas o oitavo pod só ficou pronto em 7:31, quando
    o patamar já tinha acabado. Num laptop, as máquinas virtuais Java (JVMs, *Java virtual machines*) novas sobem nas mesmas CPUs que servem a carga e
    rodam o k6: cada uma levou mais de um minuto para iniciar e, ainda fria, falhou a readiness probe de
    vez em quando por um tempo (o `ready` desce além de subir). O k6 reportou p95 de 5–7 s, p99 ≈ 19 s,
    0,3% de erros e descartou mais de 40% das chegadas. A mesma rampa com duas réplicas fixas deu p95 ≈
    34 ms, p99 ≈ 180 ms e nenhum erro: os dois pods aquecidos usaram cerca de 300m cada, muito abaixo do
    limite de 1 CPU, então neste laptop o scale-out custou mais CPU do que acrescentou. Depois que a
    carga caiu (8:00), os pods saíram um de cada vez, após a janela de estabilização de 2 minutos, e
    voltaram a 2 réplicas em 13:00. Num cluster real os nós não são compartilhados com o gerador de
    carga e nós novos trazem as próprias CPUs, mas a forma — um atraso entre a demanda e a capacidade
    pronta — é a mesma; esse atraso é o que o pré-escalonamento elimina.

## B. Rolling update sob carga { #b-rolling-update-under-load }

Mantenha uma carga constante rodando (o script do k6 do [lab 8](../../8/measure/index.md) funciona como
está) e reinicie o Deployment no meio:

``` shell
k6 run -e RATE=100 -e DURATION=2m load/catalog-otel.js &
sleep 30 && kubectl -n boxoffice rollout restart deployment/catalog
wait                                     # until k6 ends; note http_req_failed
```

Agora remova a readiness probe e a pausa do `preStop`, espere essa mudança entrar e repita:

``` shell
kubectl -n boxoffice patch deployment catalog --type=json -p '[
  {"op": "remove", "path": "/spec/template/spec/containers/0/readinessProbe"},
  {"op": "remove", "path": "/spec/template/spec/containers/0/lifecycle"}]'
kubectl -n boxoffice rollout status deployment/catalog
k6 run -e RATE=100 -e DURATION=2m load/catalog-otel.js &
sleep 30 && kubectl -n boxoffice rollout restart deployment/catalog
wait                                     # until k6 ends; note http_req_failed
kubectl apply -k k8s/overlays/local      # restore the probes and the preStop pause
```

A startup probe continua mantendo um pod novo fora do Service até a JVM responder; o que muda é a outra
ponta: sem a pausa do `preStop`, os pods antigos param de aceitar conexões enquanto ainda estão nas
listas de endpoints do Traefik. Conte as requisições com falha (`http_req_failed`) nas duas execuções.
Numa execução de teste: 0 requisições com falha com as probes, cerca de 140 de 11.900 (1,2%, `502` e
`504` do Traefik) sem elas.

| Execução | Readiness probe + `preStop` | Requisições com falha (execução de teste) |
|---|---|---|
| com | ✅ | 0 |
| sem | ❌ | cerca de 140 de 11.900 (1,2%) |

<div class="csim" data-sim="kind-lab" data-script="rollout"></div>

!!! tip "Experimente"

    O experimento B antes do cluster no seu laptop: o mesmo cluster no navegador, aberto neste experimento; play ou → roda os comandos da página e os botões funcionam a qualquer momento. Em **apply -k**, o `catalog` falha duas vezes antes de o `db-0` aceitar conexões (RESTARTS 2, como no [Deploy](../deploy/index.md)) e tudo está 1/1 em 3m31s. Em **autocorreção**, apagar os dois pods deixa o `catalog` sem endpoint: o `curl` recebe 503 até as duas JVMs novas ficarem prontas, 30 s depois — o MTTR da queda de um pod. Em **perder um nó**, o boxoffice-worker2 fica NotReady depois de 50 s; o k6 a 100 req/s perde 2.550 de 12.000 requisições (21,25%) antes de o Traefik parar de mandar para o pod dele e o substituto só fica pronto no boxoffice-worker 379 s depois da parada. Em **rollout (B)**, este experimento: 0 requisições com falha com a readiness probe e a pausa do `preStop`, 200 de 12.000 (1,67%) sem elas. No modo **livre**, ponha o atraso do Traefik em 6 s: mesmo com a pausa de 5 s, 100 requisições falham — a pausa precisa durar mais que a propagação dos endpoints.

## C. Autocura { #c-self-healing }

``` shell
kubectl -n boxoffice delete pod -l app=catalog --wait=false; date +%T
kubectl -n boxoffice get pods -l app=catalog -w        # note the time both are 1/1 again
```

Repita com `docker stop boxoffice-worker2` (uma falha de nó) e compare: o que domina cada tempo de
recuperação — detecção, agendamento ou inicialização da JVM?

## Resultados { #results }

Copie para `results/lab10.md` e preencha.

| Métrica | Antes | Depois |
|---|---|---|
| A · Vazão no pico (req/s) — 2 fixas vs HPA | | |
| A · p50 (ms) | | |
| A · p95 (ms) | | |
| A · p99 (ms) | | |
| A · Taxa de erro (%) | | |
| A · Máximo de réplicas / tempo até o primeiro scale-up (s) / tempo até a capacidade total (s) | — | |
| A · Tempo do fim da carga até voltar a 2 réplicas (s) | — | |
| B · Requisições com falha durante um rollout — sem probes vs probes + `preStop` | | |
| C · Pod apagado → pronto de novo (s) | — | |
| C · Nó parado → pods prontos em outro lugar (s) | — | |

Abaixo da tabela: para a venda relâmpago do BoxOffice às 10:00, você confiaria no HPA, faria
pré-escalonamento ou os dois? Use os seus números de tempo de reação para justificar.

[Voltar à visão geral](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
