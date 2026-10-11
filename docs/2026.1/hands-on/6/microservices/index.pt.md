
Cada microsserviço precisa de duas mudanças: as dependências Maven necessárias no `pom.xml` e a configuração do endpoint do actuator no `application.yaml`.

## 1 Dependências

Adicione as seguintes dependências ao `pom.xml` de **cada microsserviço** (`gateway-service`, `auth-service` e `account-service`):

``` { .xml .copy .select }
<!-- metrics collection -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>

<!-- export in prometheus format -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
    <scope>runtime</scope>
</dependency>
```

- `spring-boot-starter-actuator` habilita endpoints de gerenciamento prontos para produção, incluindo health checks e métricas.
- `micrometer-registry-prometheus` exporta essas métricas no formato de texto que o Prometheus espera coletar.

## 2 Configuração

Configure o `application.yaml` de cada serviço para expor o endpoint do Prometheus sob o próprio context path do serviço. Isso mantém todos os endpoints acessíveis pela única porta do balanceador de carga, sem conflitos:

=== "gateway-service"

    ``` { .yaml .copy .select }
    management:
      endpoints:
        web:
          base-path: /gateway/actuator
          exposure:
            include: ['prometheus']

    spring:
      cloud:
        gateway:
          metrics:
            enabled: true
    ```

=== "auth-service"

    ``` { .yaml .copy .select }
    management:
      endpoints:
        web:
          base-path: /auth/actuator
          exposure:
            include: ['prometheus']
    ```

=== "account-service"

    ``` { .yaml .copy .select }
    management:
      endpoints:
        web:
          base-path: /accounts/actuator
          exposure:
            include: ['prometheus']
    ```

!!! info "Por que base paths diferentes?"

    Cada microsserviço usa seu próprio prefixo de contexto, de modo que o endpoint do Prometheus fica acessível como `/gateway/actuator/prometheus`, `/auth/actuator/prometheus` e `/accounts/actuator/prometheus` — sem conflitos de porta e sem expor as portas internas diretamente.

