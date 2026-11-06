---
marp: true
lang: pt-BR
title: Hands-on 6 — Observabilidade
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 6</div>

# Hands-on 6 — Observabilidade

**Cada serviço expõe suas métricas, o Prometheus as coleta e o Grafana as mostra**

<!--
Roteiro: (1) por que observabilidade; (2) Actuator + Micrometer em cada serviço; (3) Prometheus e Grafana
no Docker Compose; (4) configuração de scrape e da fonte de dados; (5) dashboards; (6) executar, verificar, armadilhas.
-->

---

## Uma requisição está lenta. Onde?

<div class="q">

A plataforma tem um balanceador de carga, um gateway, `auth` e `account`, cada um em seu container.
Um usuário relata que as requisições estão lentas. **Como descobrir qual serviço é o problema?**

</div>

* Sem dados de dentro de cada serviço, você só pode **chutar**.
* Você precisa de **métricas ao longo do tempo**: taxa de requisições, latências, taxa de erros, memória da JVM.
* E elas precisam ser coletadas **de todos os serviços, em um só lugar**.

<!--
Deixe a turma responder primeiro. A ideia: em um sistema distribuído, "olhar os logs do servidor"
não funciona mais — há muitos servidores.
-->

---

## Os três pilares

| Pilar | O que é |
|---|---|
| **Logging** | registros estruturados dos eventos de cada serviço |
| **Monitoramento** | coleta e visualização contínuas de métricas ao longo do tempo |
| **Rastreamento** | o ciclo de vida completo de uma requisição entre serviços |

<div class="ok">

Este hands-on foca no **monitoramento**: Spring Boot **Actuator** → **Prometheus** → **Grafana**.

</div>

---

## Arquitetura

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">camada confiável · Actuator + Micrometer</div>
<div class="box">gateway<small>/gateway/actuator/prometheus</small></div>
<div class="box">auth<small>/auth/actuator/prometheus</small></div>
<div class="box">account<small>/accounts/actuator/prometheus</small></div>
</div>
<div class="arrow" style="align-self: center">← coleta<br>a cada 1s</div>
<div class="box accent" style="flex: .7; display: flex; flex-direction: column; justify-content: center">Prometheus :9090<small>puxa as métricas, guarda séries temporais</small></div>
<div class="arrow" style="align-self: center">← consulta</div>
<div class="box green" style="flex: .6; display: flex; flex-direction: column; justify-content: center">Grafana :3000<small>desenha dashboards</small></div>
</div>

<p class="small">A camada de observabilidade fica ao lado da camada confiável; os clientes continuam entrando pelo balanceador de carga na porta 80.</p>

---

## Os passos

1. **Microsserviços** — adicionar as dependências do Actuator e do registry do Prometheus, expor o endpoint.
2. **Docker Compose** — adicionar os serviços `prometheus` e `grafana`.
3. **Prometheus** — `prometheus.yml` com um job de scrape por serviço.
4. **Grafana** — provisionar o Prometheus como fonte de dados, importar um dashboard.
5. **Executar** — reconstruir a stack e conferir se todos os alvos estão `UP`.

---

## 1 · Dependências (em cada serviço)

No `pom.xml` de `gateway-service`, `auth-service` e `account-service`:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
    <scope>runtime</scope>
</dependency>
```

<p class="small">Actuator: endpoints prontos para produção (health, métricas). Registry do Micrometer: exporta-os no formato de texto do Prometheus.</p>

---

## 1 · Expor o endpoint

<div class="cols">
<div>

```yaml
# gateway-service application.yaml
management:
  endpoints:
    web:
      base-path: /gateway/actuator
      exposure:
        include: ['prometheus']
```

</div>
<div>

| Serviço | Endpoint |
|---|---|
| gateway | `/gateway/actuator/prometheus` |
| auth | `/auth/actuator/prometheus` |
| account | `/accounts/actuator/prometheus` |

</div>
</div>

- Cada serviço usa **o seu próprio prefixo**: sem conflitos e sem expor portas internas.
- O gateway também define `spring.cloud.gateway.metrics.enabled: true`.

---

<!-- _class: tight -->

## 2 · Docker Compose

```yaml
  prometheus:
    image: prom/prometheus:latest
    ports:
      - 9090:9090
    volumes:
      - $SETUP/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
  grafana:
    image: grafana/grafana-enterprise
    ports:
      - 3000:3000
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - $SETUP/grafana:/var/lib/grafana
      - $SETUP/grafana/provisioning/datasources:/etc/grafana/provisioning/datasources
```

- `.env`: `SETUP=./setup` — a pasta com toda a configuração externa (`setup/prometheus/`, `setup/grafana/`).
- Ambos estão na **mesma rede Docker** dos microsserviços: o Prometheus os alcança **pelo hostname**.

---

## 3 · O Prometheus coleta (pull)

`setup/prometheus/prometheus.yml` — um job por serviço:

```yaml
scrape_configs:
  - job_name: 'GatewayMetrics'
    metrics_path: '/gateway/actuator/prometheus'
    scrape_interval: 1s
    static_configs:
      - targets:
        - gateway:8080
        labels:
          application: 'Gateway Application'
```

<p class="small">O mesmo para <code>AuthMetrics</code> (<code>auth:8080</code>) e <code>AccountMetrics</code> (<code>account:8080</code>).</p>

---

## Os campos que importam

| Campo | Significado |
|---|---|
| `job_name` | nome lógico; vira um label em todas as métricas |
| `metrics_path` | **deve coincidir** com o `base-path` do `application.yaml` do serviço |
| `targets` | hostnames Docker (`gateway`, `auth`, `account`) e porta interna `8080` |
| `scrape_interval` | com que frequência o Prometheus busca métricas novas |

<div class="ok">

O Prometheus **puxa**: os serviços nem sabem que ele existe — apenas expõem um endpoint.

</div>

---

## De um contador a requisições por segundo

<div class="flow">
<div class="box">serviço<small>conta cada requisição: http_server_requests_seconds_count</small></div><div class="arrow">coleta →</div>
<div class="box accent">amostras<small>a 1s uma da outra: 1180, 1191, 1202…</small></div><div class="arrow">rate([1m]) →</div>
<div class="box green">11 req/s<small>o aumento do contador ÷ os segundos da janela</small></div>
</div>

- `up` = 1 quando a última coleta respondeu, 0 se não: o mesmo que **Status → Targets**.
- O `rate()` precisa de **duas amostras** na janela: mantenha-a ≥ 4 × `scrape_interval`.
- As coletas também contam: um serviço sem tráfego mostra **1 req/s**, o próprio Prometheus.

<!--
A página do Prometheus tem as consultas (up, o contador, rate, sum by job) e o simulador.
-->

---

## 4 · Fonte de dados do Grafana

`setup/grafana/provisioning/datasources/datasources.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

Carregada **automaticamente na inicialização** — sem configuração manual. Abra `http://localhost:3000`, login `admin` / `admin`.

---

## 4 · Dashboards

- Importe um pronto: **Dashboards → Import**, ID `4701` (**JVM (Micrometer)**) ou `12900` (**SpringBoot APM**).
- Selecione a fonte de dados do Prometheus provisionada.
- Painéis vazios? **Dashboard → Edit → Settings → Variables**: crie `DS_PROMETHEUS`, tipo `Constant`, valor `prometheus` (o `uid` em `datasources.yml`).
- Depois, acompanhe taxa de requisições, memória da JVM, latências e taxa de erros.

<p class="small">Mais dashboards em grafana.com/grafana/dashboards.</p>

---

## 5 · Executar e verificar

```bash
docker compose up -d --build
docker compose ps -a
```

- Todos os containers, inclusive `prometheus` e `grafana`, devem estar `running`.
- Interface do Prometheus `http://localhost:9090` → **Status → Targets**: `gateway`, `auth` e `account` todos `UP`.
- Grafana: importe um dashboard e veja os painéis se preencherem.

<!--
Mostre a página Targets ao vivo: é o jeito mais rápido de ver se a configuração de scrape está certa.
-->

---

## Armadilhas comuns

<div class="flow">
<div class="box">metrics_path<small>/actuator/prometheus</small></div><div class="arrow">≠</div>
<div class="box">base-path + /prometheus<small>/accounts/actuator/prometheus</small></div><div class="arrow">→</div>
<div class="box red">404 Not Found<small>o alvo aparece DOWN</small></div>
</div>

- `prometheus` não sobe → confira se `setup/prometheus/prometheus.yml` existe e é um YAML válido.
- Os alvos devem usar os **hostnames Docker**, não `localhost` (dentro de um container, é o próprio container).
- Dashboard vazio → a variável `DS_PROMETHEUS` não aponta para a fonte de dados `prometheus`.
- Só `prometheus` está em `exposure.include`: os demais endpoints do Actuator continuam fechados.

---

## Sem Docker: o simulador

<div class="flow">
<div class="box accent">0 req/s → rate 1<small>as coletas são requisições</small></div>
<div class="box green">10 req/s → 11<small>gateway, auth e account</small></div>
<div class="box orange">15s e [5s]<small>menos de duas amostras: vazio</small></div>
<div class="box red">pare o account<small>up = 0; um caminho errado: 404</small></div>
</div>

- A página do Prometheus embute os três jobs do lab: mesmos caminhos, mesmo intervalo de 1s.
- Mude o tráfego, o intervalo e a janela; pare um serviço ou quebre o `metrics_path` dele.

<!--
O simulador fica em "Consulte as métricas", na página do Prometheus.
-->

---

## Pontos-chave

1. A observabilidade tem três pilares: **logging**, **monitoramento**, **rastreamento** — aqui, monitoramento.
2. **Actuator + Micrometer** transformam cada serviço Spring Boot em um endpoint de métricas.
3. Cada serviço expõe `/<context>/actuator/prometheus` sob **o seu próprio prefixo**.
4. O **Prometheus puxa** as métricas periodicamente (`scrape_interval`), um job por serviço.
5. O **Grafana** lê o Prometheus por uma **fonte de dados provisionada** e dashboards prontos.
6. Verifique em **Status → Targets**: todos os serviços devem estar `UP`.
