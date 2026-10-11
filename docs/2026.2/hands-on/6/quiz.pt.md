Clique em **"Resposta"** para ver a resposta correta e a explicação.

---

## Observabilidade

**Q1.** Quais são os **três pilares da observabilidade** abordados neste curso?

- A. Deploy, escalonamento e recuperação
- B. Métricas, dashboards e notificações
- C. Logging, monitoramento (métricas) e rastreamento
- D. Uso de CPU, memória e rede

??? success "Resposta"
    **C — Logging, monitoramento (métricas) e rastreamento.**

    Os logs registram eventos pontuais ("Requisição recebida para a conta 42"). As métricas acompanham valores numéricos agregados ao longo do tempo (requisições/s, latência P99). Os traces seguem uma única requisição por vários serviços. Juntos, eles respondem: *o que aconteceu?* (logs), *quanto / quão rápido?* (métricas), *por onde ela passou?* (traces).

---

**Q2.** O que o **Prometheus** faz nesta stack de observabilidade?

- A. Renderiza dashboards e visualiza as métricas coletadas pelo Grafana
- B. Injeta IDs de trace distribuído em cada requisição dos microsserviços
- C. Coleta (scrape) periodicamente o endpoint `/actuator/prometheus` de cada serviço e armazena as métricas como séries temporais
- D. Agrega as linhas de log estruturado de cada container em um índice pesquisável

??? success "Resposta"
    **C — Coleta os endpoints de métricas e armazena séries temporais.**

    O Prometheus usa um modelo *pull*: a cada intervalo de coleta (por exemplo, a cada 1 segundo), ele envia um HTTP GET para cada alvo configurado (`gateway:8080/gateway/actuator/prometheus`) e armazena as métricas retornadas como séries temporais. É o oposto de um modelo push, em que os serviços enviam as métricas para o coletor.

---

**Q3.** Por que cada microsserviço usa um **`base-path` diferente** para o seu endpoint do actuator?

- A. O Spring Boot exige caminhos de actuator únicos quando vários serviços compartilham a mesma JVM
- B. Todos os serviços são roteados pela mesma porta do gateway; prefixos únicos evitam conflitos de caminho de URL quando o Prometheus coleta cada serviço através do gateway
- C. O Prometheus não consegue coletar dois serviços no mesmo caminho simultaneamente
- D. Caminhos diferentes permitem controle de acesso baseado em papéis para o endpoint do actuator de cada serviço

??? success "Resposta"
    **B — Evitar conflitos de URL ao coletar através do gateway.**

    Sem prefixos únicos, o Prometheus faria GET em `/actuator/prometheus` no `gateway:8080` e receberia as métricas do gateway. Mas o gateway também roteia `/actuator/prometheus` para o account — eles colidem. Com `base-path: /gateway/actuator` e `base-path: /accounts/actuator`, o Prometheus consegue coletar cada serviço em um caminho distinto pela mesma porta 80.

---

**Q4.** O que o **Grafana** acrescenta ao Prometheus?

- A. Substitui o Prometheus como coletor de métricas, com menor latência
- B. Armazena as métricas em um banco de dados relacional para consultas em SQL
- C. Oferece dashboards interativos, uma interface de consultas PromQL e regras de alerta sobre as métricas armazenadas no Prometheus
- D. Gera automaticamente relatórios de conformidade com os SLOs

??? success "Resposta"
    **C — Dashboards, interface PromQL e alertas.**

    O Prometheus armazena e consulta métricas. O Grafana as visualiza: gráficos de séries temporais, medidores (gauges), mapas de calor e tabelas. Ele se conecta ao Prometheus como fonte de dados (datasource) e permite construir dashboards com consultas PromQL. O Grafana também oferece regras de alerta que disparam quando as métricas ultrapassam limites.

---

**Q5.** Quais duas dependências devem ser adicionadas a cada microsserviço Spring Boot para exportar métricas para o Prometheus?

- A. `spring-boot-starter-web` e `grafana-spring-boot-starter`
- B. `spring-boot-starter-actuator` e `micrometer-registry-prometheus`
- C. `spring-boot-starter-data-jpa` e `prometheus-client`
- D. `spring-cloud-starter-sleuth` e `micrometer-tracing`

??? success "Resposta"
    **B — `spring-boot-starter-actuator` + `micrometer-registry-prometheus`.**

    O Actuator habilita endpoints de gerenciamento, incluindo `/actuator/health`, `/actuator/info` e — com a configuração adequada — `/actuator/prometheus`. O Micrometer é a camada de abstração de métricas do Spring Boot; a dependência `micrometer-registry-prometheus` instrui o Micrometer a exportar as métricas no formato de texto do Prometheus.

---
