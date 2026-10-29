# 5. Meça { #5-measure-it }

O Kubernetes promete elasticidade e autocura. Coloque números nas duas. Como sempre, rode cada
experimento duas vezes e reporte a segunda execução; os números nas caixas de "forma esperada" são
**ilustrativos** (vêm de uma execução num laptop, e os seus vão ser outros).

| # | Experimento | Botão | O que registrar |
|---|---|---|---|
| A | réplicas fixas vs HPA | HPA apagado vs aplicado | p95, p99, erros, máximo de réplicas, tempo para escalar |
| B | rolling update sob carga | com vs sem readiness probe + `preStop` | requisições com falha durante o rollout |
| C | autocura | apagar um pod / parar um nó | tempo até a capacidade voltar (MTTR) |

## A. Réplicas fixas vs HPA { #a-fixed-replicas-vs-hpa }

``` shell
# before: two fixed replicas
kubectl -n boxoffice delete hpa catalog
kubectl -n boxoffice scale deployment catalog --replicas=2
k6 run -e PEAK=250 load/catalog-hpa.js

# after: the HPA
kubectl apply -k k8s/overlays/local
mkdir -p results && sh scripts/watch-hpa.sh > results/lab10-hpa.csv &
k6 run -e PEAK=250 load/catalog-hpa.js
kill %1                                  # stop the watcher
```

Do `results/lab10-hpa.csv`, leia: o momento em que a CPU passou de 60% pela primeira vez, o momento em
que o `desired` aumentou pela primeira vez (tempo de reação), o momento em que o `ready` chegou ao
máximo (tempo até a capacidade) e o número máximo de réplicas. Faça um gráfico de `cpu`, `desired` e
`ready` ao longo do tempo — uma planilha basta — e adicione-o aos seus resultados.

!!! example "Forma esperada (ilustrativa)"

    Uma execução com `PEAK=250` num laptop (kind, 3 nós dividindo 8 CPUs), amostrada do CSV:

    | t (min:s) | CPU (% do request) | desired | current | ready |
    |---|---|---|---|---|
    | 0:00 | 8 | 2 | 2 | 2 |
    | 0:35 | 105 | 4 | 2 | 2 |
    | 0:54 | 153 | 6 | 4 | 2 |
    | 1:30 | 137 | 6 | 6 | 4 |
    | 3:40 | 197 | 8 | 6 | 4 |
    | 5:21 | 115 | 8 | 8 | 8 |
    | 8:43 | 6 | 7 | 8 | 7 |
    | 11:01 | 5 | 4 | 4 | 4 |

    O HPA pediu mais pods 35 s depois do início da rampa, mas o oitavo pod só ficou pronto depois de
    mais de cinco minutos: num laptop, as JVMs novas disputam as mesmas CPUs que os pods já
    sobrecarregados, então subir capacidade é lento justamente quando ela é necessária. O k6 reportou
    p95 ≈ 7,8 s e iterações descartadas nessa janela; depois a latência se recuperou com 8 réplicas.
    Depois da descida da rampa, os pods saíram um de cada vez, após a janela de estabilização de 2
    minutos. Num cluster real os nós não são compartilhados com o gerador de carga, mas a forma — um
    atraso entre a demanda e a capacidade pronta — é a mesma; esse atraso é o que o pré-escalonamento
    elimina.

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

Sem readiness, um pod novo recebe tráfego assim que o seu contêiner sobe — segundos antes de o Spring
Boot escutar —, e os pods antigos são mortos ainda nas listas de endpoints. Conte as requisições com
falha (`http_req_failed`) nas duas execuções.

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
