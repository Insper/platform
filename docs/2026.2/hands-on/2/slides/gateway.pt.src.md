---
marp: true
lang: pt-BR
title: Hands-on 2 — Gateway
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 2</div>

# Hands-on 2 — Gateway

**Um único ponto de entrada na frente de todos os microsserviços**

<!--
Roteiro: (1) por que um gateway; (2) o projeto gateway-service; (3) pom.xml, rotas e CORS no
application.yaml; (4) Dockerfile e compose.yaml; (5) executar, verificar, armadilhas.
-->

---

## Por que um gateway?

<div class="q">

Cada microsserviço expõe **a sua própria porta e os seus endpoints** para a internet. O que há de errado nisso?

</div>

* Muitas portas para **proteger** e acompanhar.
* Os clientes precisam saber **onde cada serviço vive**.
* Autenticação, CORS, log… **repetidos** em cada serviço.

<!--
Deixe a turma responder. O gateway é um proxy reverso: uma porta aberta, todo o resto na camada confiável.
-->

---

## A arquitetura

`internet` → **gateway** → `account`, outros → `database`

- O **gateway** é um proxy reverso: o único ponto de entrada de todas as requisições.
- O `account` e os outros serviços vivem na **camada confiável**, inacessíveis de fora.
- **Só uma porta** fica exposta para a internet.

<div class="ok">

Funcionalidades principais: **roteamento** para o microsserviço certo e **autenticação / autorização** (próximo hands-on).

</div>

---

## O que mais ele pode fazer

| Preocupação | Benefício |
|---|---|
| Autenticação / autorização | proteger a aplicação em um só lugar |
| Balanceamento de carga | escalar a aplicação |
| Cache | melhorar o desempenho |
| Log e monitoramento | depurar e investigar problemas |
| Rate limiting | proteger contra ataques DDoS |

<p class="small">Todos são recursos do Spring Cloud Gateway, a biblioteca usada neste hands-on.</p>

---

## O projeto gateway-service

```text
api/
    gateway-service/
        src/main/java/store/gateway/
            GatewayApplication.java
            GatewayResource.java
        src/main/resources/application.yaml
        pom.xml
        Dockerfile
    .env
    compose.yaml
```

---

## pom.xml: as dependências

Spring Boot `4.0.3`, Java `25`, Spring Cloud `2025.1.0` (importado via `spring-cloud-dependencies`).

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway-server-webflux</artifactId>
</dependency>
```

<p class="small"><strong>WebFlux</strong> é reativo: muitas requisições concorrentes com poucas threads.</p>

---

## application.yaml: rotas

Em `spring.cloud.gateway.server.webflux`:

```yaml
routes:
  - id: insper
    uri: https://www.insper.edu.br
    predicates:
      - Path=/insper/**

  - id: accounts
    uri: http://account:8080   # hostname of the container
    predicates:
      - Path=/accounts/**
```

Uma requisição que casa com o **predicado** `Path` é encaminhada para a `uri` da rota.

---

## application.yaml: CORS

```yaml
globalcors:
  corsConfigurations:
    '[/**]':
      allowedOrigins: ${CORS_ALLOWED_ORIGINS:*}
      allowedHeaders: "*"
      allowedMethods: "*"
```

- O CORS é configurado **uma vez, no gateway**, para todos os caminhos.
- `CORS_ALLOWED_ORIGINS` vem do ambiente; o padrão é `*` (qualquer origem).

<div class="warn">

`*` serve para desenvolvimento; revise a configuração de CORS antes de expor o gateway.

</div>

---

## Os endpoints do próprio gateway

```java
@RestController
public class GatewayResource {

    @GetMapping("/")
    public ResponseEntity<String> hello() {
        return ResponseEntity.ok("Store API");
    }

    @GetMapping("/health-check")
    public ResponseEntity<Void> healthCheck() {
        return ResponseEntity.ok().build();
    }
}
```

<p class="small"><code>GatewayApplication</code> é um <code>@SpringBootApplication</code> simples.</p>

---

## Dockerfile e compose.yaml

<div class="cols">
<div>

```dockerfile
FROM eclipse-temurin:25
VOLUME /tmp
COPY target/*.jar /app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

</div>
<div>

```yaml
account:
  build:
    context: ./account-service
  hostname: account
  deploy:
    replicas: 2

gateway:
  build:
    context: ./gateway-service
  hostname: gateway
  ports:
    - 8080:8080
```

</div>
</div>

<div class="ok">

Só o gateway publica uma porta. O `account` (2 réplicas) só é alcançável **por meio do gateway**.

</div>

---

## Executar e verificar

```bash
docker compose up -d --build
curl http://localhost:8080/               # Store API
curl http://localhost:8080/health-check   # 200 OK
curl http://localhost:8080/accounts/...   # routed to account:8080
```

- Envie requisições para a **porta do gateway** e confira se chegam ao microsserviço certo.
- Chamar o `account` diretamente do host deve **falhar**: ele não tem porta publicada.

<p class="small">O Dockerfile copia <code>target/*.jar</code>: empacote o serviço com o Maven antes de gerar a imagem.</p>

---

## Armadilhas comuns

- **Serviços parados**: a rota `http://account:8080` precisa do container `account` no ar e na mesma rede do Compose.
- **Hostname errado**: a rota usa o `hostname` do Compose (`account`), não `localhost`.
- **Sem jar**: `COPY target/*.jar` falha se o projeto não foi empacotado.
- **CORS**: uma chamada do navegador falha se a origem não estiver em `allowedOrigins`.
- **Portas vazando**: publicar a porta do `account` contorna o gateway.

---

## Pontos-chave

1. O gateway é o **ponto único de entrada**: uma porta exposta, todo o resto na camada confiável.
2. Funções centrais: **roteamento** e **autenticação / autorização**.
3. Construído com **Spring Cloud Gateway** sobre **WebFlux** (reativo, poucas threads).
4. Rotas = `id` + `uri` + **predicado** `Path` no `application.yaml`.
5. O **CORS** é configurado uma vez, no gateway.
6. No `compose.yaml`, **só o gateway** publica uma porta (`8080:8080`).
