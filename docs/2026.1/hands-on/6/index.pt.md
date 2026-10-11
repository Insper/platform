!!! tip "Objetivo principal"

    O objetivo principal deste hands-on é adicionar **observabilidade** à stack de microsserviços usando o [Prometheus](https://prometheus.io){target="_blank"} para coleta de métricas e o [Grafana](https://grafana.com){target="_blank"} para visualização, permitindo o monitoramento em tempo real de toda a plataforma.

A observabilidade é uma propriedade crítica de sistemas distribuídos. Sem ela, entender o comportamento do sistema, diagnosticar falhas e medir o desempenho entre vários serviços torna-se praticamente impossível. Os três pilares da observabilidade são:

- **Logging**: registros estruturados dos eventos que ocorrem em cada serviço.
- **Monitoramento**: coleta e visualização contínuas de métricas do sistema e da aplicação ao longo do tempo.
- **Rastreamento**: acompanhamento do ciclo de vida completo de uma única requisição enquanto ela passa por vários serviços.

Neste hands-on, vamos focar no **monitoramento**, integrando o [Spring Boot Actuator](https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html){target="_blank"}, o Prometheus e o Grafana.

A arquitetura resultante adiciona uma camada dedicada de observabilidade ao lado dos microsserviços existentes:

``` mermaid
flowchart LR
    subgraph obs [Camada de Observabilidade]
        prometheus@{ shape: cyl, label: "Prometheus\n:9090" }
        grafana[Grafana\n:3000]
        prometheus --> grafana
    end
    subgraph api [Camada Confiável]
        loadbalancer --> gateway
        gateway --> auth
        gateway --> account
    end
    prometheus e1@-.->|scrape /actuator/prometheus| gateway
    prometheus e2@-.->|scrape /actuator/prometheus| auth
    prometheus e3@-.->|scrape /actuator/prometheus| account
    internet e0@==>|:80| loadbalancer
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
```

A configuração exige mudanças em três frentes:

<div class="grid cards" markdown>

-   :material-server-network:{ .lg .middle } **[Microsserviços](./microservices/)**

    ---

    Adicione as dependências do Actuator e do registry do Prometheus a cada serviço Spring Boot e exponha o endpoint de métricas.

    [Microsserviços](./microservices/){ .md-button }

-   :material-file-code:{ .lg .middle } **[Docker Compose](./docker/)**

    ---

    Adicione os serviços do Prometheus e do Grafana ao arquivo `docker compose.yaml`, garantindo que estejam na mesma rede que os microsserviços.

    [Docker Compose](./docker/){ .md-button }

-   :material-chart-timeline-variant:{ .lg .middle } **[Prometheus](./prometheus/)**

    ---

    Implante o Prometheus via Docker Compose e configure-o para coletar (scrape) as métricas de cada microsserviço.

    [Prometheus](./prometheus/){ .md-button }

-   :material-chart-areaspline:{ .lg .middle } **[Grafana](./grafana/)**

    ---

    Implante o Grafana via Docker Compose, conecte-o ao Prometheus e explore dashboards prontos.

    [Grafana](./grafana/){ .md-button }

-   :material-play-circle:{ .lg .middle } **[Execução](./run/)**

    ---

    Reconstrua e suba a stack completa com o Docker Compose; depois, verifique se todos os serviços estão em execução e se as métricas estão sendo coletadas.

    [Execução](./run/){ .md-button }

</div>
