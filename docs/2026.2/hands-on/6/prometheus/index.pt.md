
O [Prometheus](https://prometheus.io){target="_blank"} funciona **puxando** (`scraping`) as métricas do endpoint de cada serviço em um intervalo configurado e armazenando localmente os dados de séries temporais.

Crie o arquivo `setup/prometheus/prometheus.yml`:

``` { .yaml .copy .select linenums="1" title="prometheus.yml" }
scrape_configs:

  - job_name: 'GatewayMetrics'
    metrics_path: '/gateway/actuator/prometheus'
    scrape_interval: 1s
    static_configs:
      - targets:
        - gateway:8080
        labels:
          application: 'Gateway Application'

  - job_name: 'AuthMetrics'
    metrics_path: '/auth/actuator/prometheus'
    scrape_interval: 1s
    static_configs:
      - targets:
        - auth:8080
        labels:
          application: 'Auth Application'

  - job_name: 'AccountMetrics'
    metrics_path: '/accounts/actuator/prometheus'
    scrape_interval: 1s
    static_configs:
      - targets:
        - account:8080
        labels:
          application: 'Account Application'
```

Pontos-chave:

| Campo | Descrição |
|---|---|
| `job_name` | Nome lógico do job de coleta; aparece como label em todas as métricas coletadas. |
| `metrics_path` | Deve corresponder ao `base-path` definido no `application.yaml` de cada serviço. |
| `targets` | Usa os hostnames dos serviços Docker (`gateway`, `auth`, `account`) e a porta interna `8080`. |
| `scrape_interval` | Com que frequência o Prometheus busca métricas atualizadas em cada alvo. |

O Prometheus **puxa**: os serviços não sabem que o Prometheus existe, só expõem um endpoint. A cada `scrape_interval`, o Prometheus manda um `GET` para cada alvo, lê o valor atual de cada métrica e o guarda como uma amostra com horário; depois o Grafana pergunta ao Prometheus, nunca aos serviços:

``` mermaid-sim
sequenceDiagram
    participant P as Prometheus
    participant G as gateway:8080
    participant A as auth:8080
    participant C as account:8080
    participant Gr as Grafana
    loop a cada scrape_interval, 1s aqui
        P->>G: GET /gateway/actuator/prometheus
        G-->>P: http_server_requests_seconds_count 1234
        P->>A: GET /auth/actuator/prometheus
        A-->>P: http_server_requests_seconds_count 987
        P->>C: GET /accounts/actuator/prometheus
        C-->>P: http_server_requests_seconds_count 1010
    end
    Gr->>P: consulta, taxa no último minuto
    P-->>Gr: requisições por segundo, uma série por job
```

Com a stack em execução, acesse a interface do Prometheus para consultar as métricas diretamente:

[http://localhost:9090/](http://localhost:9090/){target="_blank" .md-button}

## Consulte as métricas { #promql }

Digite estas consultas na aba **Query**, escritas na linguagem de consulta do Prometheus (PromQL, *Prometheus Query Language*):

| Consulta | O que mostra |
|---|---|
| `up` | `1` para cada alvo que a última coleta alcançou, `0` para os outros — o mesmo que **Status → Targets** |
| `http_server_requests_seconds_count` | o **contador** de requisições que cada serviço atendeu desde que subiu (uma série por `uri`, `method` e `status`) |
| `rate(http_server_requests_seconds_count[1m])` | quão rápido o contador cresceu no último minuto: **requisições por segundo** |
| `sum by (job) (rate(http_server_requests_seconds_count[1m]))` | o mesmo, somado por job: uma linha por serviço, como um painel do Grafana desenha |

Um contador só sobe (e volta a `0` quando o serviço reinicia); o `rate()` o transforma em algo legível. Ele precisa de **pelo menos duas amostras** dentro da janela, então a janela deve ser várias vezes o `scrape_interval` — uma regra comum é 4 ×: com o `1s` do lab, `[5s]` já funciona; com o padrão do Prometheus de `1m`, `[1m]` fica vazio. As coletas também são requisições: cada uma soma 1 ao contador do serviço que ela lê.

<div class="csim" data-sim="prom-scrape"></div>

!!! tip "Experimente"

    Aperte play. A 0 req/s o rate é 1, não 0: cada coleta é uma requisição a `/…/actuator/prometheus`, uma por segundo. A 10 req/s de requisições protegidas, cada job mostra 11; um login (`POST /auth/login`) nunca chega ao account, que fica em 1. Mude o `scrape_interval` para 15s e a janela para `[5s]`: menos de duas amostras, então o `rate()` fica vazio; `[1m]` volta a funcionar. Pare o account: na coleta seguinte ele fica com `up = 0` e sua linha some da janela de 1 minuto; um `metrics_path` errado faz o alvo responder 404.
