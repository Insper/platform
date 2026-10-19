# 2. Dashboard RED

Dados que você não consegue ler em dez segundos durante um incidente não são observabilidade, são
armazenamento. Este passo constrói **um** dashboard para todos os serviços do BoxOffice, provisionado
como código, organizado em torno de dois métodos da
[aula de sinais](../../../classes/observability/signals/index.md):

| Método | Para | Sinais | Pergunta que responde |
|---|---|---|---|
| **RED** (Tom Wilkie) | serviços movidos a requisições | **R**ate (taxa), **E**rrors (erros), **D**uration (duração) | "Meus usuários estão sendo bem atendidos?" |
| **USE** (Brendan Gregg) | recursos | **U**tilization (utilização), **S**aturation (saturação), **E**rrors (erros) | "Algum recurso é o gargalo?" |

O RED diz *que* algo está errado para os usuários; o USE diz *onde* a capacidade acabou. A linha de
cima do dashboard é RED por serviço; a de baixo é USE para as JVMs e seus pools de conexão.

## Dashboards como código

O Grafana carrega dashboards de arquivos listados por um **provedor**. Os dois arquivos ficam no seu
repositório, então o dashboard é revisado, versionado e idêntico em todos os notebooks:

``` yaml title="infra/grafana/dashboards.yaml"
--8<-- "docs/2027.1/hands-on/8/code/infra/grafana/dashboards.yaml"
```

Os volumes do [passo 1](../instrument/index.md) montam esse provedor na pasta de provisionamento do
Grafana e `infra/grafana/dashboards/` no caminho para o qual ele aponta. Salve o dashboard abaixo como
`infra/grafana/dashboards/boxoffice-red.json` e reinicie: `docker compose restart otel-lgtm`. Ele
aparece em **Dashboards → BoxOffice → BoxOffice — RED**.

??? example "infra/grafana/dashboards/boxoffice-red.json (clique para expandir)"

    ``` json title="infra/grafana/dashboards/boxoffice-red.json"
    --8<-- "docs/2027.1/hands-on/8/code/infra/grafana/dashboards/boxoffice-red.json"
    ```

## Lendo os painéis

Cada painel é uma consulta PromQL sobre o histograma que o agente exporta. Aprenda as quatro formas;
todo dashboard RED que você vai ver na vida é uma variação delas.

| Painel | Forma da consulta | Leia como |
|---|---|---|
| Rate | `sum by (service_name) (rate(…_count[$__rate_interval]))` | requisições por segundo, por serviço |
| Errors | `rate(…_count{status=~"5.."}) / rate(…_count)` | a **fração** de requisições que falham (não a contagem) |
| Duration p95 | `histogram_quantile(0.95, sum by (service_name, le) (rate(…_bucket[…])))` | 95% das requisições foram mais rápidas que isto |
| Rotas mais lentas | `topk(10, histogram_quantile(0.95, sum by (…, http_route, le) …))` | onde olhar primeiro |
| Conexões do banco | `db_client_connections_usage{state="used"}` vs `_max`, `_pending_requests` | o pool está saturado quando *waiting* > 0 |

Três hábitos fazem a diferença:

- **Agregue antes do quantil.** O `histogram_quantile` precisa receber a `sum by (le)` das *taxas*
  dos buckets: dá para somar buckets entre instâncias, **não** dá para tirar a média de percentis (a
  média de três p95 não é o p95 de nada).
- **Erros como fração.** 50 erros por segundo é um desastre a 60 req/s e ruído a 60 000 req/s.
- **Percentis vindos de buckets são estimativas.** O `histogram_quantile` interpola dentro de um
  bucket; com os limites padrão do agente (…, 0,25, 0,5, 0,75, 1, 2,5 s…), um p99 de "0,6 s" quer
  dizer "algo entre 0,5 e 0,75 s".

!!! tip "Exemplars: do pico ao trace que o causou"

    O Prometheus do `otel-lgtm` guarda **exemplars**: alguns trace ids de amostra presos aos buckets
    do histograma. No painel Duration, ative *Exemplars* nas opções da consulta; os losangos no gráfico
    são requisições reais, e clicar em um abre o seu trace no Tempo. É o caminho mais curto de "o p99
    subiu" para "este comando SQL está lento".

## Exercício: veja um gargalo aparecer

1. Rode o teste de estresse em escada do [lab 2](../../2/index.md) contra a borda — ele sobe a taxa de
   chegada em degraus até `PEAK` e depois desce:
   `k6 run -e BASE_URL=http://localhost -e PEAK=600 load/stress.js`.
2. Observe **Duration p95** e **DB connections** lado a lado. Quando `waiting` sai do zero, a curva de
   latência dobra: as requisições agora fazem fila por uma conexão (Lei de Little: com o pool cheio,
   concorrência extra vira tempo de espera).
3. Abra um exemplar no topo da curva: o trace mostra um grande intervalo *antes* do span SQL — tempo
   esperando uma conexão, não executando SQL.

Escreva nos seus resultados qual recurso saturou primeiro e a taxa de requisições em que isso
aconteceu.

[Próximo: SLO e alerta de *burn rate*](../slo/index.md){ .md-button .md-button--primary }
