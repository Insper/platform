Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Os três pilares

**Q1.** Um usuário relata que a requisição `7f3d...` retornou um erro 500. Qual(is) pilar(es) você usaria para diagnosticar a causa-raiz?

- A. Métricas — verificar o contador da taxa de erros naquela janela de tempo
- B. Logs — buscar o ID específico da requisição no fluxo de logs
- C. Traces — encontrar o trace específico e inspecionar qual span falhou
- D. B e C — logs para o detalhe da exceção, traces para o caminho da chamada

??? success "Resposta"
    **D — São necessários logs e traces.**

    O trace mostra qual serviço da cadeia de chamadas causou o erro e quanto tempo cada salto levou, reduzindo a investigação a um único span. Os logs dentro daquele serviço revelam então a classe exata da exceção, a mensagem e o stack trace. Nenhum pilar sozinho dá o quadro completo: traces sem logs dizem *onde*, mas não *por quê*; logs sem traces tornam difícil identificar *qual* serviço, entre muitos, produziu a linha de log correspondente.

---

**Q2.** Por que um Histogram é preferível a um Summary para métricas de latência no Prometheus?

- A. Histograms usam menos armazenamento do que summaries com alta cardinalidade
- B. Histograms são calculados no servidor, então os dashboards carregam mais rápido
- C. Histograms permitem calcular quantis considerando várias instâncias e janelas de tempo arbitrárias em PromQL; summaries pré-calculam os quantis no cliente e não podem ser agregados
- D. Summaries estão obsoletos e não são mais suportados pelo Prometheus

??? success "Resposta"
    **C — Histograms são agregáveis; summaries não.**

    Um Summary calcula os quantis dentro do processo da aplicação — depois de exportados, o valor `p99` da instância A e o da instância B não podem ser combinados de forma significativa. Um Histogram exporta as contagens brutas de cada bucket, então `histogram_quantile(0.99, sum by (le) (rate(http_server_requests_seconds_bucket[5m])))` calcula corretamente o p99 considerando todas as instâncias e qualquer janela de tempo escolhida. Em um microsserviço escalado horizontalmente, essa distinção é crucial.

---

## PromQL e métricas

**Q3.** O que `rate(http_errors_total[5m])` retorna?

- A. O número total de erros que ocorreram nos últimos 5 minutos
- B. A taxa média de crescimento por segundo de `http_errors_total` na janela dos últimos 5 minutos
- C. A taxa de erros como porcentagem do total de requisições
- D. O número de erros por minuto, amostrado uma vez a cada 5 minutos

??? success "Resposta"
    **B — Taxa média de crescimento por segundo na janela de 5 minutos.**

    `rate()` divide o crescimento total do contador na janela pela duração da janela em segundos. Um contador que cresceu 300 em 5 minutos retorna `1.0` (um erro por segundo). Como `rate()` opera sobre o contador bruto, ele trata corretamente os zeramentos do contador (reinícios do serviço) — o que `increase()` também faz, mas como contagem absoluta, e não como taxa por segundo.

---

## Logs

**Q4.** Qual é o propósito do MDC (Mapped Diagnostic Context) no logging?

- A. Ele define o nível de log por classe em tempo de execução, sem reiniciar o serviço
- B. Ele anexa pares chave-valor (como o `traceId`) a todas as linhas de log produzidas pela thread corrente, permitindo correlacionar as entradas de log
- C. Ele comprime a saída de log para reduzir os custos de armazenamento
- D. Ele encaminha as linhas de log para arquivos diferentes conforme o nível de severidade

??? success "Resposta"
    **B — Anexa pares chave-valor a todas as linhas de log da thread corrente.**

    O MDC guarda um mapa por thread cujos valores o framework de logging (Logback, Log4j2) pode imprimir em todas as linhas de log com um padrão como `%X{trace_id}`. Com o agente Java do OpenTelemetry, o próprio agente coloca `trace_id` e `span_id` no MDC enquanto um span está ativo, então todas as linhas de log da requisição carregam o mesmo ID sem nenhum código na aplicação — o que torna trivial filtrar todo o histórico de logs de uma requisição com uma única consulta. `MDC.put` continua útil para as suas próprias chaves de negócio (ID do cliente, ID do pedido), que você precisa remover ao final da requisição.

---

## Traces distribuídos

**Q5.** Por que todos os spans de um trace distribuído compartilham o mesmo `traceId`?

- A. Porque todos os spans são criados pelo primeiro serviço, que os distribui
- B. Porque o `traceId` é gerado uma única vez no ponto de entrada e propagado no cabeçalho `traceparent` para cada serviço downstream, que o copia sem alterações para os próprios spans
- C. Porque o backend de rastreamento atribui um ID comum ao montar o trace a partir dos spans individuais
- D. Porque os spans são armazenados na mesma tabela do banco e herdam o ID da linha

??? success "Resposta"
    **B — O `traceId` é gerado uma vez e propagado via `traceparent`.**

    Quando o primeiro serviço (por exemplo, o API gateway) recebe uma requisição sem cabeçalho `traceparent`, ele gera um `traceId` de 128 bits e cria o span raiz. Toda chamada HTTP de saída inclui `traceparent: 00-<traceId>-<currentSpanId>-01`. Cada serviço downstream lê esse cabeçalho, mantém o `traceId` inalterado, gera um novo `spanId` e define `parentSpanId` como o `spanId` recebido. O resultado é uma árvore de spans que compartilham o mesmo `traceId`, que o backend de rastreamento usa para montar a visão completa do trace.

---

**Q6.** Um serviço recebe `traceparent: 00-abc123000000000000000000000000aa-def456000000000000-01` e cria um span filho com ID `999888000000000000`. Como fica o cabeçalho `traceparent` que ele envia ao próximo serviço downstream?

- A. `00-abc123000000000000000000000000aa-def456000000000000-01` (inalterado)
- B. `00-999888000000000000000000000000bb-abc123000000000000-01` (novo traceId)
- C. `00-abc123000000000000000000000000aa-999888000000000000-01` (mesmo traceId, novo spanId)
- D. `00-abc123000000000000000000000000aa-def456000000000000-999888000000000000-01` (concatenado)

??? success "Resposta"
    **C — Mesmo `traceId`, novo `spanId` igual ao ID do span corrente.**

    O `traceId` (`abc123...`) nunca muda ao longo de toda a requisição — essa é a invariante que liga todos os spans. O campo `parentSpanId` do novo cabeçalho recebe o ID do span *corrente* (`999888...`), de modo que o serviço downstream sabe exatamente qual span disparou a chamada. O `def456...` recebido torna-se o `parentSpanId` do span *corrente* (armazenado no registro do span), e não é repassado adiante.

---

## Amostragem

**Q7.** Qual é a diferença fundamental entre head sampling e tail sampling?

- A. O head sampling é feito pela aplicação; o tail sampling é feito pelo backend de rastreamento
- B. O head sampling decide se registra um trace logo no primeiro span, antes de qualquer chamada downstream; o tail sampling decide depois que o trace completo é montado, o que permite favorecer traces com erros ou alta latência
- C. O head sampling mantém 100% dos traces; o tail sampling os descarta
- D. São sinônimos da mesma estratégia aplicada em camadas diferentes da stack

??? success "Resposta"
    **B — O momento da decisão é a diferença central.**

    O head sampling precisa se comprometer a registrar ou descartar um trace no momento em que o span raiz é criado, sem saber o que acontecerá downstream. Isso é rápido e tem custo quase nulo, mas descarta aleatoriamente alguns traces de erro. O tail sampling mantém os spans em buffer até o trace ficar completo e então aplica regras — por exemplo, manter todos os traces em que algum span tenha `status=ERROR`. O trade-off é mais memória e mais latência no collector.

---

## OpenTelemetry

**Q8.** Qual componente do OpenTelemetry pode receber telemetria de vários serviços, aplicar filtragem e envio em lotes e distribuir os dados para vários backends ao mesmo tempo?

- A. A API do OTel — ela abstrai vários backends no código da aplicação
- B. O SDK do OTel — ele agrupa os spans em lotes antes de exportá-los
- C. O OTel Collector — um processo independente que atua como pipeline entre produtores e backends
- D. O exporter OTLP — ele consegue encaminhar para vários endpoints de dentro do SDK

??? success "Resposta"
    **C — O OTel Collector.**

    O Collector é um proxy agnóstico a fornecedores, implantado como sidecar ou como gateway no nível do cluster. Seu pipeline tem três estágios: *receivers* (aceitam OTLP, Jaeger, Zipkin etc.), *processors* (filtram, amostram, agrupam em lotes, adicionam atributos) e *exporters* (enviam para Prometheus, Jaeger, Loki, Datadog etc., simultaneamente). Centralizar o encaminhamento da telemetria no Collector significa que trocar de backend exige apenas uma mudança na configuração do Collector, e não um novo deploy de cada aplicação.

---

## Métricas DORA

**Q9.** Qual métrica DORA mede mais diretamente a rapidez com que uma equipe consegue responder a um incidente em produção?

- A. Deployment Frequency — mais deploys significam resposta mais rápida
- B. Lead Time for Changes — mede o pipeline completo, do commit à produção
- C. Change Failure Rate — acompanha com que frequência os deploys causam incidentes
- D. Failed Deployment Recovery Time (antes MTTR / tempo para restaurar o serviço) — mede o tempo decorrido entre uma falha e a restauração do serviço

??? success "Resposta"
    **D — Failed Deployment Recovery Time (antes MTTR).**

    Essa métrica é o tempo entre o início de uma falha (normalmente quando um alerta dispara) e a restauração do serviço à operação normal. Ela captura diretamente a eficácia da resposta a incidentes — incluindo a velocidade de detecção, o tempo de diagnóstico, o deploy da correção e a verificação. Frequência de deploy e lead time medem vazão; a taxa de falha de mudanças mede com que frequência as mudanças quebram algo, não a rapidez da recuperação. Equipes elite se recuperam em menos de uma hora.

---

## Instrumentação com o agente Java

**Q10.** O agente Java do OpenTelemetry instrumenta o Spring Boot sem alterações de código. Como ele consegue isso?

- A. Ele exige anotar todas as classes com `@OtelInstrumented`
- B. Ele usa instrumentação de bytecode Java (API `java.lang.instrument`) para modificar as classes carregadas em tempo de execução
- C. Ele lê o `application.properties` e gera classes proxy na inicialização
- D. Ele exige recompilar a aplicação com um plugin especial do Maven

??? success "Resposta"
    **B — Instrumentação de bytecode Java via `java.lang.instrument`.**

    A API `java.lang.instrument` da JVM, combinada com um `ClassFileTransformer`, permite que um JAR `-javaagent` intercepte cada classe no momento em que ela é carregada e reescreva seu bytecode antes que chegue à aplicação. O agente Java do OTel usa esse mecanismo para injetar criação de spans, propagação de cabeçalhos HTTP e rastreamento de JDBC no Spring MVC, RestTemplate, WebClient, Hibernate e dezenas de outras bibliotecas — tudo sem tocar no código-fonte da aplicação.

---

## Tópicos adicionais

**Q11.** Um desenvolvedor adiciona o label `userId` à métrica `http_server_requests_seconds` para ver a latência de cada usuário. A loja tem 200.000 usuários. Qual é o problema?

- A. Nenhum — o Prometheus comprime os labels, então labels extras não custam nada
- B. Cada valor distinto de label cria uma nova série temporal; centenas de milhares de séries por endpoint e status fazem explodir o consumo de memória e o custo das consultas do Prometheus (alta cardinalidade)
- C. O Prometheus rejeita labels cujo nome termina em `Id`
- D. A métrica vira um gauge em vez de um histogram

??? success "Resposta"
    **B — Cardinalidade de labels ilimitada.**

    Uma série temporal é identificada pelo nome da métrica mais o conjunto completo de valores de labels, então 200.000 usuários × cada URI × cada status × cada bucket do histogram são milhões de séries. O detalhe por usuário pertence a **logs e traces** (que são projetados para campos de alta cardinalidade); as métricas devem usar labels limitados, como `uri` (o template `/orders/{id}`), `method` e `status`.

---

**Q12.** Os serviços usam head sampling de 10%, e o OTel Collector tem uma regra de tail sampling "manter 100% dos traces com um span ERROR". Que fração dos traces de erro chega ao Jaeger?

- A. 100% — a regra de tail sobrepõe a decisão do head
- B. Cerca de 10% — traces descartados pelo head sampling nunca são enviados ao Collector, então a regra de tail não tem como recuperá-los
- C. 0% — head e tail sampling não podem ser combinados
- D. 110% — as duas regras se somam

??? success "Resposta"
    **B — Cerca de 10%.**

    As decisões de amostragem são aplicadas em sequência: um trace não amostrado no head nunca é registrado nem exportado, então o Collector nunca o vê. Para manter todos os traces de erro, amostre 100% (ou uma proporção alta) no head e deixe a política de tail sampling do Collector manter todos os traces de erro/lentos, mais uma pequena fração dos demais.

---

**Q13.** Por que o `histogram_quantile` deve ser aplicado a `sum by (le) (rate(..._bucket[5m]))` e não a `sum(rate(..._bucket[5m]))`?

- A. `sum` sem `by (le)` junta todos os buckets em um único número, eliminando os limites dos buckets de que o `histogram_quantile` precisa para estimar o percentil
- B. `by (le)` torna a consulta mais rápida, mas dá o mesmo resultado
- C. `le` significa "latency estimate" e é exigido pelo Grafana
- D. Sem `by (le)` o resultado sai em milissegundos em vez de segundos

??? success "Resposta"
    **A — O label `le` carrega os limites dos buckets.**

    Cada bucket do histogram é uma série com um label `le` ("less than or equal", menor ou igual), como `le="0.1"`. A soma entre instâncias precisa manter o `le` para que as contagens de cada bucket de todas as instâncias sejam somadas entre si; somar tudo em um único número destrói a distribuição, e o `histogram_quantile` não devolve nada útil.

---

**Q14.** Qual alerta é o melhor para acordar o engenheiro de plantão às 3 da manhã?

- A. CPU de um pod do order-service acima de 80% por 5 minutos
- B. Uso do heap da JVM acima de 70%
- C. Mais de 5% das requisições `POST /orders` retornando 5xx por 5 minutos (ou o error budget do SLO sendo consumido a 14,4×)
- D. Um novo deploy foi feito

??? success "Resposta"
    **C — Alerte sobre um sintoma que os usuários sentem.**

    Alertas que acionam o plantão devem ser urgentes, acionáveis e ligados ao impacto no usuário: pedidos falhando são exatamente isso. CPU ou uso de heap altos (A, B) podem ser perfeitamente normais enquanto os usuários estão satisfeitos — são causas que merecem um dashboard ou um ticket, não um acionamento. Um deploy (D) é um evento a ser anotado nos dashboards, não um alerta.
