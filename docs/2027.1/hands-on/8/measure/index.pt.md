# 4. Meça { #4-measure-it }

Observabilidade não é de graça: cada span é alocado, cada ponto de métrica agregado, cada lote enviado
pela rede. Este passo põe um número nesse custo e no benefício — quanto tempo leva para saber que os
usuários estão sofrendo. Como sempre, rode cada experimento duas vezes e relate a segunda execução; os
números das caixas "forma esperada" são **ilustrativos**.

| # | Experimento | Botão | O que registrar |
|---|---|---|---|
| A | custo do agente | `OTEL_ON=true` vs `false` | p50 / p95 / p99, vazão, CPU %, memória, tempo de inicialização |
| B | amostragem de traces | `OTEL_TRACES_SAMPLER` | p95, traces guardados por minuto |
| C | cardinalidade | — | número de séries por serviço |
| D | tempo de detecção | parar o `db` | horários de parada → *Pending* → *Firing* |

## O script do k6 { #the-k6-script }

``` javascript title="load/catalog-otel.js"
--8<-- "docs/2027.1/hands-on/8/code/load/catalog-otel.js"
```

## A. Custo do agente { #a-agent-overhead }

Mesma imagem, mesma carga, agente ligado e desligado:

<!-- termynal -->

``` shell
> OTEL_ON=false docker compose up -d --wait catalog-1 catalog-2 catalog-3
> k6 run load/catalog-otel.js
> docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | grep catalog
> docker compose logs catalog-1 | grep "Started CatalogApplication"
> OTEL_ON=true docker compose up -d --wait catalog-1 catalog-2 catalog-3
> k6 run load/catalog-otel.js
> docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | grep catalog
> docker compose logs catalog-1 | grep "Started CatalogApplication"
```

Rode o `docker stats` em um segundo terminal *enquanto* o k6 roda (os números depois do teste são de
ociosidade). As linhas de `docker compose logs` mostram o tempo de inicialização com o agente
desligado e ligado (os logs de um contêiner somem quando ele é recriado, então leia-os antes de trocar).

!!! example "Forma esperada (ilustrativa)"

    O agente adiciona trabalho por requisição (criar spans, registrar histogramas) e por processo
    (instrumentação de bytecode na inicialização). Espere um pequeno aumento no p50, alguns por cento
    a mais de CPU na mesma vazão, dezenas de MB a mais de memória e uma inicialização visivelmente mais
    lenta. Se o seu p99 crescer muito mais que o p50, olhe a coleta de lixo: mais alocação significa
    pausas mais frequentes.

## B. Amostragem { #b-sampling }

Guardar 100% dos traces é certo para um lab e errado para 2 milhões de fãs. Amostre 10% **na raiz** e
deixe cada serviço seguinte seguir a decisão da raiz (`parentbased_…`), para que um trace esteja
completo ou ausente:

A âncora `x-otel` já lê as duas configurações do ambiente
(`${OTEL_TRACES_SAMPLER:-parentbased_always_on}`), então nenhum arquivo muda: recrie os serviços com as
duas variáveis definidas e rode a mesma carga.

``` shell
OTEL_TRACES_SAMPLER=parentbased_traceidratio OTEL_TRACES_SAMPLER_ARG=0.1 docker compose up -d --wait
k6 run load/catalog-otel.js
docker compose up -d --wait # afterwards: back to 100% (the defaults of the anchor)
```

Conte os traces guardados por minuto no Tempo (Explore → Tempo → Search, serviço
`gateway`, últimos 5 minutos) e compare o p95 com o experimento A. Note que **métricas não são
amostradas**: o dashboard RED continua contando todas as requisições — por isso taxas e percentis vêm
das métricas, e os exemplos (o *porquê*) dos traces.

## C. Cardinalidade { #c-cardinality }

Cada combinação distinta de valores de labels é uma série temporal separada, guardada e consultada
separadamente. No Explore do Grafana (Prometheus), rode:

``` text
count by (service_name) ({service_namespace="boxoffice"})
count by (__name__) ({service_name="catalog"})
```

A primeira dá as séries por serviço; a segunda mostra quais métricas são as mais caras. Agora imagine
adicionar um label `user_id` ao histograma HTTP: com 2 milhões de fãs e 14 buckets, quantas séries o
`catalog` criaria? (Responda nos seus resultados: é por isso que o agente registra `http_route`, o
template, e nunca a URL crua.)

## D. Tempo de detecção { #d-time-to-detect }

Siga o "Dispare-o" do [passo 3](../slo/index.md) e registre os três horários.

## Resultados { #results }

Copie esta tabela para `results/lab8.md` e preencha.

| Métrica | Agente desligado | Agente ligado |
|---|---|---|
| A · Vazão (req/s) | | |
| A · p50 (ms) | | |
| A · p95 (ms) | | |
| A · p99 (ms) | | |
| A · Taxa de erro (%) | | |
| A · CPU por réplica do `catalog` sob carga (%) | | |
| A · Memória por réplica do `catalog` (MB) | | |
| A · Tempo de inicialização (s) | | |
| B · p95 com 100% vs 10% de amostragem (ms) | | |
| B · Traces guardados por minuto, 100% vs 10% | | |
| C · Séries do `catalog` / de todo o BoxOffice | — | |
| C · Séries se `user_id` fosse um label (estimativa) | — | |
| D · Parada do `db` → Pending → Firing (mm:ss) | — | |

Abaixo da tabela, responda em um parágrafo cada: o custo do agente vale a pena para o BoxOffice? Que
taxa de amostragem você escolheria para a venda relâmpago, e por quê? O tempo de detecção medido bate
com a previsão do passo 3?

[Voltar à visão geral](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
