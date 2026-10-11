
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

Com a stack em execução, acesse a interface do Prometheus para consultar as métricas diretamente:

[http://localhost:9090/](http://localhost:9090/){target="_blank" .md-button}
