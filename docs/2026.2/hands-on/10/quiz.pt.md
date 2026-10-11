Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Rastreamento distribuído

**Q1.** Uma requisição `POST /orders` leva 2 300 ms de ponta a ponta. O Prometheus mostra que o `http_server_requests_seconds_max` do gateway é de 2 300 ms. O que um trace distribuído informa que essa métrica **não consegue** informar?

- A. O número total de requisições por segundo que passam pelo gateway
- B. O intervalo exato de tempo que cada serviço downstream — OrderService, ProductService, o banco de dados — consumiu dentro daquela única requisição, para que você identifique qual salto causou o atraso
- C. Se o gateway tem folga de CPU suficiente para lidar com mais requisições simultâneas
- D. A latência do percentil 99 de todas as requisições nos últimos cinco minutos

??? success "Resposta"
    **B — A latência detalhada por salto de uma única requisição.**

    Uma métrica do Prometheus é um agregado: ela informa o pior tempo de resposta observado entre todas as requisições de uma janela de tempo, mas não consegue decompor esse tempo pelas chamadas downstream. Um trace distribuído registra cada salto como um span, com seu próprio horário de início e sua duração. Você lê imediatamente que o próprio gateway levou 45 ms, o OrderService levou 2 250 ms e a query JDBC do ProductService levou 2 180 ms desse total — a métrica sozinha nunca mostra isso.

---

**Q2.** Depois de adicionar o agente Java do OTel ao Dockerfile e definir `OTEL_EXPORTER_OTLP_ENDPOINT`, uma chamada `RestTemplate` do OrderService para o ProductService aparece como um span filho no Jaeger — **sem nenhuma alteração no código-fonte Java**. Que mecanismo torna isso possível?

- A. O Spring Boot Actuator expõe um endpoint `/actuator/traces` que o Jaeger coleta automaticamente
- B. O agente Java do OTel usa instrumentação de bytecode da JVM para interceptar o `RestTemplate` em tempo de execução, injetando o cabeçalho `traceparent` nas requisições de saída e criando spans de forma transparente
- C. O Spring Cloud Sleuth detecta a variável de ambiente `OTEL_EXPORTER_OTLP_ENDPOINT` e ativa o rastreamento automático
- D. O cabeçalho `traceparent` é injetado pela rede overlay do Docker, compartilhada por todos os containers

??? success "Resposta"
    **B — Instrumentação de bytecode da JVM pela flag `-javaagent`.**

    O agente Java do OTel é um agente de instrumentação padrão da JVM, carregado com `-javaagent:/app/opentelemetry-javaagent.jar`. No carregamento das classes, ele reescreve o bytecode de bibliotecas conhecidas — RestTemplate, WebClient, drivers JDBC, Spring MVC e muitas outras — para adicionar a criação de spans e a injeção de cabeçalhos. Sem alterações no código-fonte, sem anotações do Spring. O JAR da aplicação não é tocado; o agente modifica o bytecode em execução, na memória.

---

**Q3.** Dado o valor de `traceparent`:

```
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Qual parte identifica **toda a jornada da requisição** e é a mesma em todos os serviços da cadeia?

- A. `00` — o byte de versão
- B. `4bf92f3577b34da6a3ce929d0e0e4736` — o trace ID de 32 caracteres
- C. `00f067aa0ba902b7` — o ID do span pai, de 16 caracteres
- D. `01` — o byte de flags

??? success "Resposta"
    **B — O trace ID de 32 caracteres.**

    O formato do cabeçalho W3C `traceparent` é `{version}-{traceId}-{parentSpanId}-{flags}`. O `traceId` é gerado uma única vez pelo primeiro serviço da cadeia (o gateway) e é propagado sem alterações para todos os serviços downstream. Ele é a chave comum que permite ao Jaeger agrupar todos os spans — do gateway, do OrderService, do ProductService e do driver JDBC — em um único trace. O `parentSpanId` muda a cada salto: ele identifica quem fez a chamada imediatamente antes, não a cadeia inteira.

---

**Q4.** No `compose.yaml`, você define `OTEL_METRICS_EXPORTER: none` para todos os serviços. Que problema ocorreria se você **omitisse** essa variável e deixasse o exporter padrão ativo?

- A. O serviço não iniciaria, porque o Jaeger não suporta o protocolo de métricas OTLP
- B. O agente OTel exportaria métricas via OTLP para o Jaeger além do pipeline Micrometer/Prometheus que já está rodando, criando séries de métricas duplicadas e desperdiçando recursos
- C. O Prometheus pararia de coletar `/actuator/prometheus`, porque o agente OTel desativa o Micrometer
- D. Os dashboards do Grafana quebrariam, porque os nomes dos labels das métricas diferem entre o OTLP e o formato de exposição do Prometheus

??? success "Resposta"
    **B — Métricas duplicadas exportadas por dois pipelines separados.**

    Por padrão, o agente Java do OTel ativa um exporter de métricas OTLP junto com o exporter de traces. Como você já tem o Spring Boot Actuator + Micrometer exportando as mesmas métricas para o Prometheus, ativar o exporter de métricas do OTel envia uma segunda cópia de cada métrica para o endpoint OTLP do Jaeger. Isso desperdiça rede e armazenamento, e o backend de métricas do Jaeger não é o que você usa para os dashboards. Definir `OTEL_METRICS_EXPORTER: none` desativa apenas o pipeline de métricas; o pipeline de traces não é afetado.

---

**Q5.** Você abre no flame chart do Jaeger um trace de uma requisição `POST /orders` e vê quatro spans:

```
gateway-service      POST /orders          2 300 ms  ████████████████████
  order-service      POST /orders          2 250 ms  ███████████████████
    product-service  GET /products/7       2 190 ms  ██████████████████
      jdbc           SELECT * FROM ...     2 180 ms  ██████████████████
```

Qual serviço você deve investigar primeiro, e por quê?

- A. `gateway-service`, porque o span dele é a barra mais larga e, portanto, o principal gargalo
- B. `order-service`, porque é o filho direto do gateway e responde pela maior parte do tempo total
- C. O span `jdbc` dentro do `product-service`, porque ele responde por 2 180 ms dos 2 300 ms totais e é o span mais profundo, com o maior tempo próprio
- D. Todos os serviços igualmente, porque as durações dos spans se sobrepõem e não é possível isolar uma única causa

??? success "Resposta"
    **C — O span `jdbc` dentro do `product-service`.**

    O flame chart mostra o *tempo de relógio* (wall-clock), então os spans pais sempre aparecem tão largos quanto os filhos, ou mais. O span do gateway é largo porque fica esperando tudo o que acontece downstream. A informação útil é o **span mais profundo com o maior tempo próprio**: `jdbc SELECT`, com 2 180 ms. Esse span não tem filhos — ele está realizando trabalho de fato, e não esperando outro serviço. Isso significa que uma query SQL lenta dentro do ProductService é a causa raiz. Comece por ali: verifique se falta um índice, se há uma query N+1 ou se falta um pool de conexões com o banco de dados.

---

**Q6.** Qual é a relação correta entre um **trace** e um **span**?

- A. Um span é uma coleção de traces relacionados, agrupados pelo nome do serviço
- B. Um trace representa a jornada completa, de ponta a ponta, de uma única requisição por todos os serviços; um span representa uma unidade de trabalho dentro dessa jornada (por exemplo, uma única chamada HTTP, uma query no banco de dados ou a execução de um método)
- C. Trace e span são sinônimos — os dois se referem a um registro temporizado de uma única operação
- D. Um span é uma amostra de vários traces agregados em um único ponto de uma série temporal

??? success "Resposta"
    **B — Trace = jornada completa; span = uma unidade de trabalho.**

    Cada requisição gera exatamente um trace, identificado por um `traceId` único. Esse trace é composto de um ou mais spans. O span raiz (criado pelo gateway) é o primeiro; cada chamada downstream cria um span filho, cujo pai é o span que fez a chamada. Todos os spans compartilham o mesmo `traceId`, mas cada um tem seu próprio `spanId`, horário de início, horário de fim e atributos. A UI do Jaeger monta todos os spans com o mesmo `traceId` no flame chart que você vê.

---

**Q7.** O seu método `OrderService.create()` chama três métodos auxiliares privados: `validateAccount()`, `checkInventory()` e `calculatePrice()`. O agente OTel já cria um span para a requisição HTTP `POST /orders` recebida. Em que circunstâncias você deve **adicionar um span manual** para um desses métodos auxiliares?

- A. Sempre — toda chamada de método deve ter seu próprio span para garantir cobertura completa
- B. Nunca — o agente Java instrumenta todos os beans do Spring automaticamente, então spans manuais são redundantes
- C. Quando o método auxiliar leva um tempo mensurável (por exemplo, > 50 ms), chama um sistema externo, ou quando você precisa anexar atributos de negócio (como `account.id` ou `inventory.available`) que a instrumentação dos frameworks não captura
- D. Somente quando o método lança uma checked exception — spans manuais servem exclusivamente para rastrear erros

??? success "Resposta"
    **C — Quando o método auxiliar é lento, chama sistemas externos ou precisa de atributos personalizados.**

    O agente instrumenta os *pontos de entrada dos frameworks* — requisições HTTP, chamadas JDBC, operações de cache. Ele não conhece os seus métodos privados de lógica de negócio. Adicione um span manual quando: (1) um método leva dezenas de milissegundos e você quer ver o custo dele separadamente no flame chart, (2) o método chama uma API externa que o agente não consegue detectar, ou (3) você quer registrar atributos de negócio, como `order.account_id` ou `inventory.result`, que só fazem sentido no seu domínio. Evite envolver getters triviais — spans demais escondem o sinal e acrescentam overhead.

---

**Q8.** Um usuário relata que o pedido dele foi criado com o preço de produto errado. Você consegue reproduzir o problema e observa `trace_id=7d3a...b2` na UI do Jaeger. Seus logs são agregados no Loki. Qual é a forma mais rápida de encontrar as linhas de log exatas daquela requisição?

- A. Buscar `level=ERROR` no job `order-service` do Loki na janela de 5 minutos em torno do timestamp da requisição
- B. Copiar o valor de `trace_id` do span no Jaeger e usá-lo como filtro de busca no Loki (`{job="order-service"} |= "7d3a...b2"`) — o campo `trace_id`, injetado pela ponte OTel do logback em cada linha de log via MDC, liga o trace diretamente à sua saída de log
- C. Baixar o trace completo do Jaeger como JSON e procurar mensagens de erro embutidas nos eventos dos spans
- D. Reiniciar o serviço com o log em nível `DEBUG` e reproduzir a requisição para gerar logs novos e mais detalhados

??? success "Resposta"
    **B — Usar o `trace_id` do Jaeger como filtro de busca no Loki.**

    Esse é o valor central da correlação entre traces e logs. Como o `logback-spring.xml` usa `%X{trace_id}` no seu padrão, cada linha de log emitida durante uma requisição rastreada contém o trace ID vindo do MDC. Todas as linhas de log daquela requisição específica — e somente dela — compartilham o mesmo `trace_id=7d3a...b2`, mesmo que milhares de outras requisições tenham sido processadas ao mesmo tempo. Buscar esse ID no Loki devolve exatamente a sequência de logs do pedido com problema: as chamadas de serviço feitas, o preço calculado e a persistência final — restrita a milissegundos de tempo de relógio, sem o ruído das requisições de outros usuários.
