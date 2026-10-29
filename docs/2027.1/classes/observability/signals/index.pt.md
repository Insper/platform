
A primeira pergunta durante um incidente nunca é "por quê?" — é "*há* algo errado, e onde devo olhar?". A segunda é "o que exatamente aconteceu com *esta* requisição?". A terceira é "qual linha de código está queimando o tempo?". Cada pergunta precisa de um tipo diferente de dado, com um custo diferente. Emitir todos os detalhes de todas as requisições responde a todas elas e leva você à falência; emitir só gráficos de CPU é barato e não responde a nenhuma. Esta página trata de escolher o **sinal** certo para cada pergunta.

---

## Quatro sinais, um espectro { #four-signals-one-spectrum }

| Sinal | Unidade de dado | Responde | Volume / custo | Retenção típica | Backends |
|---|---|---|---|---|---|
| **Métricas** | um número por série temporal por intervalo | *há* algo errado? quanto, desde quando? | baixo e **independente do tráfego** | meses (com downsampling: anos) | Prometheus, Mimir, Thanos, CloudWatch |
| **Logs** | um registro por evento | *o que* aconteceu neste evento? | cresce **linearmente com o tráfego** | dias a semanas quente, meses frio | Loki, Elasticsearch/OpenSearch, Cloud Logging |
| **Traces** | uma árvore de spans por requisição | *onde* foram o tempo / o erro entre os serviços? | cresce com tráfego × saltos (amostrado) | dias a semanas | Tempo, Jaeger, X-Ray, Honeycomb |
| **Profiles** | amostras de pilha por processo ao longo do tempo | *qual código* usa CPU / memória / locks? | aproximadamente constante por processo | dias a semanas | Pyroscope, Parca, profilers de nuvem |

Pense nisso como um espectro que vai do **agregado e barato** ao **detalhado e caro**. Métricas comprimem um milhão de requisições em alguns números por intervalo — você pode guardá-las por meses, mas não consegue perguntar sobre uma requisição. Logs e traces guardam cada requisição — você pode perguntar qualquer coisa sobre ela, mas precisa amostrar, filtrar ou expirar esses dados.

``` diagram
flowchart LR
    M["Métricas<br/>agregadas · baratas · retenção longa"] --> T["Traces<br/>por requisição · amostrados"]
    T --> L["Logs<br/>por evento · verbosos"]
    L --> P["Profiles<br/>por caminho de código"]
```

!!! note "Nomes usados nesta aula"

    O BoxOffice é instrumentado com o **agente Java do OpenTelemetry** ([Hands-on 8](../../../hands-on/8/index.md)), que segue as *semantic conventions* do OpenTelemetry[^1]. Sua métrica de servidor HTTP `http.server.request.duration` (um histograma, em segundos) chega ao Prometheus como `http_server_request_duration_seconds_bucket`, `_count` e `_sum`, com os labels `http_route`, `http_request_method` e `http_response_status_code`. O atributo de recurso `service.name` chega como o label `service_name` (o que o dashboard e os alertas do lab 8 filtram), e o Prometheus monta o `job` a partir de `service.namespace` e `service.name` — `boxoffice/order` no lab 8; uma configuração clássica de scrape dá ao `job` o nome do alvo coletado. As consultas desta página usam `job="order"` por brevidade. As métricas do próprio Micrometer do Spring Boot usam outros nomes (`http_server_requests_seconds` com `uri`, `status`, `application`). As consultas seguem a mesma ideia — confira quais nomes a sua stack emite antes de copiar uma consulta.

---

## Métricas { #metrics }

### O modelo de dados { #the-data-model }

Uma métrica é uma **série temporal**: um nome, um conjunto de **labels** chave-valor (também chamados de atributos ou dimensões) e uma sequência de amostras `(timestamp, valor)`.

```text
http_server_request_duration_seconds_count{job="order", http_route="/orders", http_request_method="POST", http_response_status_code="201"}  48213
```

Cada combinação distinta de valores de labels é uma **série temporal separada** que o banco precisa indexar e manter em memória. Esse único fato explica a maior parte dos problemas operacionais com métricas (veja [cardinalidade](#cardinality)).

| Tipo | Comportamento | Use para | Exemplo no BoxOffice |
|---|---|---|---|
| **Counter** | só sobe (volta a 0 num reinício) | eventos: requisições, erros, bytes | ingressos vendidos, respostas `5xx` |
| **Gauge** | sobe e desce | estado atual | assentos restantes num pool de reservas, profundidade de fila, conexões abertas |
| **Histogram** | conta observações em **buckets** (`le` = menor ou igual) mais `_sum` e `_count` | distribuições de latência e tamanho, percentis | duração do checkout |
| **Summary** | quantis calculados **no processo** | legado; percentis de uma única instância | — evite: não pode ser agregado |

Os histogramas são os importantes. Cada bucket é um contador "quantas observações foram ≤ este limite": com limites 0,1, 0,25, 0,5, 1, 2,5 s, um checkout de 0,3 s incrementa os buckets `0.5`, `1`, `2.5` e `+Inf`. Como os buckets são contadores, os histogramas de 20 pods podem ser **somados** e um percentil estimado a partir do total. Formatos mais novos — os *native histograms* do Prometheus e os *exponential histograms* do OpenTelemetry — escolhem os limites dos buckets automaticamente, com erro relativo limitado, o que elimina o erro mais comum: buckets que não cobrem o limiar do seu SLO.

### Pull vs push

| | Pull (scrape) | Push |
|---|---|---|
| Como | o Prometheus chama `GET /metrics` em cada alvo a cada 15–60 s | o processo envia métricas (OTLP, StatsD) para um coletor |
| Descobre alvos mortos | sim — um scrape com falha já é um sinal (`up == 0`) | só pela ausência de dados |
| Jobs de vida curta, serverless | desajeitado (precisa de um push gateway) | natural |
| Atrás de NAT / muitas redes | quem faz o scrape precisa alcançar cada alvo | os alvos só precisam alcançar o coletor |
| Stack típica | Prometheus + service discovery do Kubernetes | SDK OpenTelemetry → Collector → Prometheus/Mimir (OTLP) |

Os dois funcionam; stacks modernas misturam ambos. Com OpenTelemetry, o padrão é **push via OTLP** para um Collector, que também pode fazer **scrape** de endpoints Prometheus existentes ([OpenTelemetry](../opentelemetry/index.md)).

### RED, USE e os quatro golden signals { #red-use-and-the-four-golden-signals }

Você não precisa de centenas de métricas por serviço. Três checklists conhecidos dizem quais poucas importam:

| Método | Aplica-se a | Sinais | Origem |
|---|---|---|---|
| **RED** | serviços orientados a requisições (APIs) | **R**ate (taxa), **E**rrors (erros), **D**uration (duração) | Tom Wilkie (Weaveworks/Grafana)[^2] |
| **USE** | recursos (CPU, disco, pools, filas) | **U**tilization (utilização), **S**aturation (saturação), **E**rrors (erros) | Brendan Gregg[^3] |
| **Quatro golden signals** | qualquer sistema voltado ao usuário | latência, tráfego, erros, saturação | livro de SRE do Google[^4] |

Os golden signals são essencialmente RED + saturação. A **saturação** é o sutil: o quão *cheio* um recurso está, geralmente visível como **espera** — uma fila, um pool com pedidos pendentes, threads bloqueadas. Utilização perto de 100% não é um problema por si só; trabalho esperando na fila é.

!!! example "BoxOffice — RED para serviços, USE para recursos"

    | Componente | Método | O que plotar |
    |---|---|---|
    | `order` (`POST /checkout`) | RED | checkouts/s; fração de `5xx`; duração p50/p95/p99 |
    | `payment` → provedor externo | RED (lado do cliente) | chamadas/s; fração com falha ou timeout; p99 da chamada ao provedor |
    | Pool de conexões PostgreSQL do `inventory` | USE | conexões ativas / máximo; aquisições **pendentes** e tempo de espera; timeouts de aquisição |
    | Tópico Kafka `order-events` | USE | taxa de produção vs consumo; **consumer lag** (mensagens e segundos); entregas com falha / tamanho da DLQ |
    | JVM do `order` | USE | CPU; heap após GC; tempo de pausa de GC; fila do pool de threads |

    Durante a venda relâmpago, as **aquisições pendentes** do pool de pagamentos (saturação) subiram dois minutos antes de o alerta de p99 do checkout disparar. A saturação é o indicador antecedente; RED é o que os usuários sentem.

### RED em PromQL { #red-in-promql }

PromQL é a linguagem de consulta do Prometheus (e do Mimir, do Thanos e da maioria dos backends compatíveis). Duas regras evitam a maioria das consultas erradas: aplique `rate()` a um counter **antes** de somá-lo (ele trata os resets do contador quando um pod reinicia), e mantenha o label `le` ao somar buckets de histograma.

```promql
# Rate: requests per second, per route, of the order service
sum by (http_route) (
  rate(http_server_request_duration_seconds_count{job="order"}[5m])
)

# Errors: fraction (0..1) of 5xx responses
sum(rate(http_server_request_duration_seconds_count{job="order", http_response_status_code=~"5.."}[5m]))
/
sum(rate(http_server_request_duration_seconds_count{job="order"}[5m]))

# Duration: p99 latency per route, aggregated across all pods
histogram_quantile(0.99,
  sum by (le, http_route) (
    rate(http_server_request_duration_seconds_bucket{job="order"}[5m])
  )
)

# SLI style: fraction of checkouts faster than 2 s (needs a bucket at le="2")
sum(rate(http_server_request_duration_seconds_bucket{job="order", http_route="/checkout", le="2"}[5m]))
/
sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout"}[5m]))
```

!!! example "No código do BoxOffice: o dashboard RED (lab 8)"

    O [Hands-on 8 — dashboard RED](../../../hands-on/8/dashboard/index.md) provisiona um dashboard para todos os serviços a partir de um arquivo JSON no repositório, revisado e versionado como qualquer outro código. A linha de cima são as três consultas acima, uma linha por `service_name`: a taxa é a `sum by (service_name)` do `rate()` do contador; os erros são uma **fração** de `5xx`, não uma contagem (50 erros/s é um desastre a 60 req/s e ruído a 60.000); o p95 vem do `histogram_quantile` sobre buckets somados **por `le`** — nunca uma média de percentis por réplica, o que importa porque o `catalog` roda três réplicas como um só serviço. A linha de baixo é USE: JVMs e pools de conexão.

    ``` { .json title="infra/grafana/dashboards/boxoffice-red.json (titles and queries of the RED row)" }
    --8<-- "docs/2027.1/hands-on/8/code/infra/grafana/dashboards/boxoffice-red.json:56:56,81:81,89:89,114:114,122:122,147:147"
    ```

### Percentis, não médias — e nunca a média de percentis { #percentiles-not-averages-and-never-average-percentiles }

Uma latência média esconde a cauda: se 99 checkouts levam 100 ms e um leva 10 s, a média é ~200 ms e parece ótima, mas um fã em cada cem espera dez segundos — e uma página que faz 20 chamadas encontra essa cauda na maioria dos carregamentos (veja [Percentis](../../estimation/percentiles/index.md)).

Um erro mais sutil é calcular o p99 **por pod** e depois tirar a média entre os pods. Percentis não se compõem: o p99 da frota inteira não é a média dos p99 dos pods. A simulação abaixo tem quatro pods do `order`; um deles divide um nó com um vizinho barulhento (*noisy neighbour*) e está lento, e recebe 10% do tráfego.

```python exec="true"
import numpy as np

rng = np.random.default_rng(7)
# three healthy pods (30% of traffic each, ~80 ms) and one slow pod (10%, ~400 ms)
pods = {
    "pod-a": rng.lognormal(np.log(0.08), 0.35, 30_000),
    "pod-b": rng.lognormal(np.log(0.08), 0.35, 30_000),
    "pod-c": rng.lognormal(np.log(0.08), 0.35, 30_000),
    "pod-d (noisy neighbour)": rng.lognormal(np.log(0.40), 0.50, 10_000),
}
print("| Pod | Requests | p99 (ms) |")
print("|---|---:|---:|")
p99s = []
for name, lat in pods.items():
    p = np.percentile(lat, 99) * 1000
    p99s.append(p)
    print(f"| {name} | {len(lat):,} | {p:,.0f} |")
fleet = np.percentile(np.concatenate(list(pods.values())), 99) * 1000
print(f"| **average of the four p99s** | | **{np.mean(p99s):,.0f}** |")
print(f"| **true fleet p99** (from all requests) | 100,000 | **{fleet:,.0f}** |")
```

Tirar a média dos percentis dos pods subestima a cauda que os usuários realmente sentem. Os histogramas evitam o problema porque seus buckets são contadores que podem ser somados *antes* de o percentil ser estimado — que é exatamente o que o `sum by (le)` faz na consulta acima.

---

## Cardinalidade { #cardinality }

**Cardinalidade** é o número de séries temporais distintas que uma métrica produz: o produto do número de valores de cada label. É o principal fator de memória, custo e velocidade de consulta de um backend de métricas — e o jeito mais comum de os times derrubarem, sem querer, o próprio monitoramento.

A tabela abaixo faz crescer o histograma de latência do checkout, label por label. Cada série de histograma são, na verdade, 17 séries (15 buckets, `_sum`, `_count`); a coluna de memória supõe, como ilustração, cerca de 4 KB por série ativa no banco de séries temporais.

```python exec="true"
BYTES_PER_SERIES = 4 * 1024  # illustrative assumption

steps = [
    ("one histogram (15 buckets + _sum + _count)", 17),
    ("http_request_method (4 values)", 4),
    ("http_route (25 route templates)", 25),
    ("http_response_status_code (6 values seen)", 6),
    ("pod (20 replicas)", 20),
    ("customer_id (1,000,000 fans)", 1_000_000),
]

def human(n_bytes):
    for unit in ["B", "KB", "MB", "GB", "TB", "PB"]:
        if n_bytes < 1024:
            return f"{n_bytes:,.1f} {unit}"
        n_bytes /= 1024
    return f"{n_bytes:,.1f} EB"

print("| Label added | × values | Series | Memory |")
print("|---|---:|---:|---:|")
series = 1
for label, values in steps:
    series *= values
    print(f"| {label} | {values:,} | {series:,} | {human(series * BYTES_PER_SERIES)} |")
```

Os cinco primeiros labels são **limitados**: o número de valores é pequeno e conhecido (as rotas são *templates* como `/orders/{id}`, não `/orders/42`). Juntos, produzem no máximo cerca de 200 mil séries (um limite superior: nem toda rota devolve todo status) — uma carga normal para um servidor Prometheus. O último label é **ilimitado**: cresce com o número de usuários e multiplica tudo o que veio antes. Nenhum sistema de métricas sobrevive a isso.

| Label | Limitado? | Onde deve ficar |
|---|---|---|
| `http_route` (template), `method`, `status_code`, `region`, `pod` | sim | labels de métrica |
| `event_id` (≈ milhares de eventos à venda) | no limite — só se for pequeno e você precisar de SLOs por evento | geralmente traces |
| `customer_id`, `order_id`, `email`, URL completa, `trace_id` | **não** | **traces e logs** (dados de alta cardinalidade são o trabalho deles) |
| texto de mensagem de erro | não (texto livre) | logs; use uma *classe* de erro como label |

!!! tip "Alta cardinalidade não é ruim — está no lugar errado"

    "Quais fãs tiveram checkouts lentos?" é uma ótima pergunta. Ela é respondida por **traces e eventos ricos** (*wide events*) com `customer_id` como *atributo*, consultados sob demanda — não por um label de métrica que pré-agrega todos os valores possíveis para sempre. Métricas respondem "quantos / quão rápido"; traces e logs respondem "quais".

---

## Logs { #logs }

Um log é um registro com timestamp de um evento discreto. Logs são o sinal mais familiar e o mais fácil de abusar: escrevê-los é de graça e guardá-los é caro.

### Logs estruturados { #structured-logs }

Escreva logs como registros **estruturados** (JSON, ou o modelo de dados de log do OpenTelemetry) com nomes de campo fixos, não como texto livre.

| | Não estruturado | Estruturado |
|---|---|---|
| Exemplo | `10:04:12 WARN payment slow for order 9912 (8120ms)` | veja abaixo |
| Consulta | grep e expressões regulares | filtros por campo e agregações |
| Correlação | por horário, à mão | pelos campos `trace_id` / `span_id` |
| Parsing | frágil; quebra quando a mensagem muda | estável |

```json
{
  "timestamp": "2027-03-13T10:04:12.481Z",
  "level": "WARN",
  "service.name": "payment",
  "message": "provider call slow",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "order_id": "ord_9912",
  "provider": "acme-pay",
  "duration_ms": 8120,
  "pool_wait_ms": 7900
}
```

Os campos `trace_id` e `span_id` são o que transforma uma linha de log em parte de uma investigação: de um span lento você salta exatamente para as linhas de log dele, e de uma linha de erro você salta para o trace completo. Com o agente Java do OpenTelemetry, eles são adicionados ao contexto de logging automaticamente ([OpenTelemetry](../opentelemetry/index.md)).

### O que (não) registrar { #what-not-to-log }

| Nível | Uso | Em produção? |
|---|---|---|
| `ERROR` | uma falha que exige atenção: exceção, dependência inalcançável | sim |
| `WARN` | inesperado, mas tratado: retry, fallback, chamada lenta | sim |
| `INFO` | eventos significativos de negócio ou de ciclo de vida: pedido confirmado, serviço iniciado | sim, mas não um por passo interno |
| `DEBUG` / `TRACE` | detalhe de diagnóstico | desligado por padrão; ligue por serviço ou por requisição ao investigar |

- **Registre eventos, não passos.** Uma linha "checkout concluído" com dez campos vale mais que dez linhas "entrando no método X".
- **Nunca registre segredos ou dados pessoais**: senhas, tokens, números de cartão, e-mails completos. Mascare na origem e, como segunda barreira, remova no Collector.
- **Registre a decisão, não só o resultado**: "fallback para o provedor B porque o breaker está aberto" explica a próxima hora de gráficos.
- **Erros uma vez só**: registre uma exceção onde ela é tratada, não em cada camada que ela atravessa.

### Consultando logs { #querying-logs }

Com o Loki (o "L" da stack Grafana LGTM), os labels selecionam os *streams* e o resto da linha é interpretado na hora da consulta, o que mantém a indexação barata:

```text
{service_name="payment"} | json | level="WARN" | duration_ms > 5000
```

| | Loki | Elasticsearch / OpenSearch |
|---|---|---|
| Indexa | só os labels (seletores de stream) | o texto completo de todos os campos |
| Armazenamento | chunks comprimidos em object storage — barato | índice invertido em discos — caro |
| Rápido para | "logs do serviço X por volta do horário T", buscas por trace ID | busca textual arbitrária em tudo |
| Fator de custo | volume varrido por consulta | tamanho do índice |

---

## Traces { #traces }

Um **trace** registra o caminho de uma requisição pelo sistema como uma árvore de **spans**. Um span é uma operação cronometrada — uma chamada HTTP recebida ou enviada, uma consulta ao banco, uma mensagem produzida ou consumida — com horário de início, duração, status e atributos.

| Campo | Significado | Exemplo |
|---|---|---|
| `trace_id` | o mesmo para todos os spans da requisição (128 bits) | `4bf92f3577b34da6a3ce929d0e0e4736` |
| `span_id` / `parent_span_id` | constroem a árvore | `00f067aa0ba902b7` / `a2fb4a1d1a96d312` |
| `name` | a operação, com baixa cardinalidade | `POST /checkout`, `SELECT seat_holds` |
| `kind` | `SERVER`, `CLIENT`, `PRODUCER`, `CONSUMER`, `INTERNAL` | `CLIENT` para a chamada ao provedor |
| `status` | `OK`, `ERROR` (vazio por padrão) | `ERROR` |
| `attributes` | detalhes chave-valor — **alta cardinalidade é bem-vinda aqui** | `order.id=ord_9912`, `http.response.status_code=504` |
| `events` | anotações com timestamp dentro do span | `exception` com stack trace, `retry` |
| `links` | referências a spans de *outros* traces | um consumidor em lote ligando ao trace de cada produtor |

### Lendo um waterfall { #reading-a-waterfall }

O trace de um checkout lento durante a venda relâmpago, desenhado como o *waterfall* que o Tempo ou o Jaeger mostram:

```text
trace 4bf92f35…   POST /checkout                       total 9.12 s
                                         0s        3s        6s        9s
gateway    SERVER POST /checkout          |██████████████████████████████|  9.12 s
 order     SERVER POST /orders            | █████████████████████████████|  9.08 s
  inventory CLIENT PUT /holds/{id}        | ▌                            |  0.09 s
   postgres CLIENT UPDATE seat_holds      | ▏                            |  0.02 s
  payment  SERVER POST /charges           |  ████████████████████████████|  8.95 s
   payment INTERNAL pool.acquire          |  ██████████████████████████  |  7.90 s
   payment CLIENT POST provider/charges   |                          ███▌|  1.02 s
  order    PRODUCER order-events publish  |                             ▏|  0.01 s
```

Leia de cima para baixo e procure o **caminho crítico** — a cadeia de spans que determina o tempo total. Aqui não é a chamada ao provedor (1 s, lenta mas não dramática): são **7,9 s esperando por uma conexão** do pool do adaptador de pagamentos. O provedor ficou mais lento, cada chamada segurou sua conexão por mais tempo e, pela lei de Little (concorrência = vazão × tempo), o pool de 20 conexões saturou — então a maior parte do tempo foi gasta *em fila dentro do BoxOffice*. Sem o span `pool.acquire`, você culparia o provedor pelos nove segundos; com ele, você sabe que a correção é um pool com espera limitada mais um timeout ([Padrões de resiliência](../../reliability/patterns/index.md)).

!!! tip "Spans para esperar, não só para fazer"

    A instrumentação automática cria spans para I/O (HTTP, SQL, Kafka). A espera *dentro* de um serviço — um pool de conexões, um semáforo, a fila de um pool de threads, um rate limiter — fica invisível, a menos que você adicione um span ou pelo menos um atributo com o tempo de espera. São exatamente esses os lugares onde a saturação se esconde.

---

## Profiles

Um **profile** amostra, muitas vezes por segundo, o que cada thread de um processo está executando — a pilha de chamadas completa — e agrega as amostras. O **profiling contínuo** faz isso o tempo todo em produção com baixo overhead (as ferramentas costumam mirar em torno de 1–2% de CPU), então você pode comparar "10h00 de hoje" com "10h00 da semana passada".

A visualização usual é o **flame graph**[^5]: cada caixa é uma função, sua **largura** é a fração das amostras em que ela estava na pilha, e as filhas ficam em cima de quem as chamou. Platôs largos no topo são onde a CPU realmente vai.

| Tipo de profile | Mostra | Pergunta do BoxOffice |
|---|---|---|
| CPU | onde o tempo de CPU é gasto | por que o `search` usa 4 núcleos para o autocomplete? |
| Alocação / heap | quem aloca memória | o que dispara as pausas de GC no `order` durante a abertura das vendas? |
| Lock / mutex | onde as threads esperam por locks | o lock do cache do mapa de assentos está disputado? |
| Wall-clock | onde o tempo passa, incluindo espera | onde as threads de checkout ficam dormindo? |

O profiling virou o quarto sinal do OpenTelemetry (ainda amadurecendo em 2026), e profilers baseados em eBPF (Parca, Pyroscope, profilers de nuvem) conseguem perfilar todos os processos de um nó sem alterar a aplicação. Traces dizem *qual serviço e qual operação* está lenta; profiles dizem *qual função dentro dele*.

---

## Dashboards

Um dashboard é um conjunto de consultas salvas, organizadas para responder rapidamente a uma pergunta. A maioria dos dashboards falha porque tenta mostrar *tudo*; os úteis são projetados de cima para baixo, do que os usuários sentem ao que os recursos fazem.

``` diagram
flowchart TB
    L1["1 · Jornadas do usuário e SLOs<br/>busca, reserva de assento, checkout: SLI, budget restante"]
    L2["2 · Serviços — RED<br/>por serviço e rota: taxa, erros, p50/p99"]
    L3["3 · Dependências<br/>latência do provedor, BD, hit ratio do cache, lag do Kafka"]
    L4["4 · Recursos — USE<br/>CPU, memória, pools, filas por pod/nó"]
    L1 --> L2 --> L3 --> L4
```

- **Um dashboard, um propósito.** A visão de on-call "o checkout está saudável?" cabe numa tela; os mergulhos profundos ficam em outro lugar.
- **Mesmo eixo de tempo, mesmas unidades**: segundos para latência, razões (0–1) ou porcentagens para erros, nunca misturados num mesmo painel.
- **Mostre percentis e o limiar do SLO** como uma linha no painel de latência, para o olho comparar de uma vez.
- **Anote deploys e feature flags**: a maioria dos incidentes começa numa mudança.
- **Dashboards como código** (JSON do Grafana no Git, Jsonnet/Grafonnet, Terraform): revisados, versionados e reproduzíveis, em vez de clicados à mão e perdidos.

---

## Trade-offs

| Decisão | Opção A | Opção B | Regra prática |
|---|---|---|---|
| Métrica de latência | summary (quantis no processo) | histograma (buckets) | histograma — ele agrega entre pods |
| Detalhe por usuário | label de métrica | atributo de trace / log | atributo; labels precisam ser limitados |
| Logs | texto livre | estruturados com `trace_id` | estruturados, sempre |
| Cobertura | registrar cada passo | registrar eventos + traces | eventos + traces; ligue o DEBUG quando precisar |
| Coleta | pull (scrape) | push (OTLP) | qualquer uma; OTLP é o padrão portável |
| Retenção | guardar tudo por muito tempo | camadas: quente (dias) → object storage frio | camadas; métricas longas, logs/traces brutos curtos |

!!! tip "Na entrevista"

    Ao adicionar um componente a um design, cite sua **métrica-chave** na mesma frase — isso mostra que você já operou sistemas: cache → **hit ratio**; fila → **consumer lag / idade da mensagem mais antiga**; réplica de banco → **replication lag**; pool de conexões → **aquisições pendentes**; API → **RED**. Se perguntarem "como você depura uma requisição lenta entre serviços?", a resposta é **tracing distribuído com contexto propagado**, depois os logs do span lento. E se você propuser uma métrica com `user_id` como label, espere a pergunta seguinte sobre **cardinalidade**.

!!! success "Boas práticas"

    - **Dê a todo serviço a mesma linha RED, com as mesmas três consultas** — taxa, fração de erros e p95 por `service_name`, para que qualquer pessoa de plantão leia qualquer serviço em dez segundos. No BoxOffice: `boxoffice-red.json` ([Hands-on 8 — dashboard RED](../../../hands-on/8/dashboard/index.md)).
    - **Mostre erros como fração e desenhe o limite do SLO no painel de latência** — 50 erros/s é um desastre a 60 req/s e ruído a 60.000; uma linha no limite transforma "o p99 está ruim?" numa olhada.
    - **Exponha a saturação de todo pool e fila que é seu** — aquisições de conexão pendentes, profundidade de fila, lag de consumidor: na venda relâmpago elas subiram dois minutos antes do alerta do checkout. No BoxOffice: o painel *DB connections* (`db_client_connections_pending_requests`) do dashboard do lab 8.
    - **Defina um orçamento de séries por serviço e confira-o a cada release** — conte as séries que cada serviço cria (`count by (service_name) ({service_namespace="boxoffice"})`); um label novo pode multiplicá-las por 1.000. No BoxOffice: o experimento C do [Hands-on 8 — meça](../../../hands-on/8/measure/index.md).
    - **Emita um evento de log estruturado por resultado, com `trace_id` e a decisão tomada** — "fallback para o provedor B, breaker aberto" explica a próxima hora de gráficos; dez linhas "entrando no método" não explicam nada. No BoxOffice: o `LOGGING_PATTERN_CORRELATION` da âncora `x-otel` põe o trace id em toda linha.

!!! warning "Armadilhas comuns"

    - **Labels ilimitados** (`user_id`, `order_id`, URLs cruas): o backend de métricas fica sem memória ou a fatura explode.
    - **Médias e médias de percentis**: use histogramas, agregue os buckets, depois calcule o percentil.
    - **Buckets de histograma que não batem com o SLO**: se o SLO é "abaixo de 2 s" e nenhum bucket termina em 2 s, o SLI não pode ser calculado com exatidão.
    - **Registrar dados pessoais e segredos**: logs são copiados, indexados e retidos — um multiplicador de vazamentos.
    - **Só spans automáticos**: a espera dentro do serviço (pools, locks, filas) continua invisível.
    - **Dashboards sem dono**: cem painéis desatualizados atrasam toda investigação.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    REQ["one checkout:<br/>gateway → order → payment"] --> MET["metrics: RED per route,<br/>USE per pool and topic"]
    REQ --> TR["trace: spans,<br/>critical path"]
    REQ --> LOG["structured log<br/>with trace_id"]
    MET --> HIST["histograms → p99<br/>→ Estimation: percentiles"]
    MET --> CARD["bounded labels<br/>(cardinality)"]
    CARD -->|"high-cardinality detail"| TR
    TR --> WAIT["pool.acquire wait<br/>→ Little's law"]
    WAIT --> RES["timeout + bulkhead<br/>→ Reliability patterns"]
    TR --> PROF["profiles: which function<br/>→ Performance"]
    MET --> SLI["SLI per journey<br/>→ Alerting, SLOs"]
```

**Componentes da paleta:** [`metrics`](../../../reference/components/observability/index.md#metrics) · [`logs`](../../../reference/components/observability/index.md#logs) · [`tracing`](../../../reference/components/observability/index.md#tracing) · [`app`](../../../reference/components/compute/index.md#app) (RED por serviço) · [`sql`](../../../reference/components/storage/index.md#sql) (USE do pool de conexões) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (consumer lag) · [`payment`](../../../reference/components/external/index.md#payment) (RED do lado do cliente na chamada ao provedor). **Cenários:** `observability-stack`, `event-fanout` (consumer lag), `cascading-failure` (um provedor lento saturando um pool). **Continua em:** [OpenTelemetry](../opentelemetry/index.md), [Alertas](../alerting/index.md), [Estimativas — percentis](../../estimation/percentiles/index.md), [Estimativas — filas](../../estimation/queueing/index.md), [Confiabilidade — padrões](../../reliability/patterns/index.md), [Performance — gargalos](../../performance/bottlenecks/index.md) (flame graphs), [Hands-on 8 — dashboard RED](../../../hands-on/8/dashboard/index.md).

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Quatro sinais num espectro custo–detalhe: **métricas** (baratas, agregadas), **traces** (por requisição, amostrados), **logs** (por evento), **profiles** (por caminho de código).
    - **RED** para serviços, **USE** para recursos, os **golden signals** para tudo que é voltado ao usuário; a **saturação** (espera) é o indicador antecedente.
    - Use **histogramas**, agregue buckets com `sum by (le)` e só então calcule percentis; nunca tire a média de percentis.
    - **Cardinalidade** é o produto dos valores dos labels; mantenha os labels de métrica limitados e coloque o detalhe de alta cardinalidade em traces e logs.
    - Logs precisam ser **estruturados** e carregar o `trace_id`; traces mostram o **caminho crítico**, incluindo o tempo gasto esperando; profiles mostram a **função**.
    - Projete dashboards de cima para baixo: jornadas/SLOs → RED → dependências → USE.

---

[^1]: OPENTELEMETRY. [Semantic conventions for HTTP metrics](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/){target="_blank"}.
[^2]: WILKIE, T. [The RED Method: key metrics for microservices architecture](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/){target="_blank"}. Grafana Labs, 2018.
[^3]: GREGG, B. [The USE Method](https://www.brendangregg.com/usemethod.html){target="_blank"}. Veja também *Systems Performance*, 2. ed. Addison-Wesley, 2020.
[^4]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/monitoring-distributed-systems/){target="_blank"}. O'Reilly, 2016. Capítulo 6 — Monitoring Distributed Systems.
[^5]: GREGG, B. [Flame Graphs](https://www.brendangregg.com/flamegraphs.html){target="_blank"}.
