Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Sinais e instrumentação { #signals-and-instrumentation }

**Q1.** O suporte diz "o checkout está lento". Que sinal responde *qual serviço e qual etapa* deixou lenta uma requisição específica?

- A. Uma métrica: o p99 de `http_server_request_duration_seconds`
- B. Um trace: os spans daquela requisição, com o tempo de cada salto
- C. Uma linha de log com a palavra "lento"
- D. A utilização de CPU de cada contêiner

??? success "Resposta"
    **B — um trace.**

    Métricas agregam: dizem *que* o p99 está alto e em qual serviço, mas não por que uma requisição foi lenta. Um trace registra uma requisição como uma árvore de spans — gateway, order, cada comando SQL, o envio ao Kafka — então o salto lento fica visível. Os logs dão os detalhes (*por quê*) quando você já sabe onde olhar, de preferência chegando a eles pelo trace via `trace_id`.

---

**Q2.** Como o agente Java do OpenTelemetry instrumenta Spring MVC, JDBC e Kafka sem mudanças no código?

- A. Ele substitui os starters do Spring Boot por cópias instrumentadas na hora do build
- B. Ele é conectado com `-javaagent` e reescreve o bytecode das bibliotecas conhecidas à medida que as classes são carregadas
- C. Ele lê os logs da aplicação e os converte em spans
- D. Ele faz proxy de todo o tráfego de rede do contêiner

??? success "Resposta"
    **B — instrumentação de bytecode no carregamento das classes.**

    A JVM chama o agente antes do `main`; o agente registra transformadores que adicionam criação de spans, propagação de contexto e registro de métricas aos métodos das bibliotecas suportadas. Por isso `JAVA_TOOL_OPTIONS=-javaagent:...` basta, e por isso a inicialização fica mais lenta.

---

**Q3.** As três réplicas do `catalog` usam o mesmo `OTEL_SERVICE_NAME: catalog`. Por que não `catalog-1`, `catalog-2`, `catalog-3`?

- A. Porque o agente rejeita nomes com dígitos
- B. Porque elas são um serviço com três instâncias: dashboards e SLOs agregam por serviço, e cada instância ainda ganha o seu próprio `service.instance.id`
- C. Porque o Prometheus só consegue guardar uma série por nome
- D. Não há motivo; os dois são equivalentes

??? success "Resposta"
    **B — serviço vs instância.**

    Os usuários vivem o serviço `catalog`, não uma réplica. Com um só nome de serviço, `sum by (service_name)` soma as três réplicas e o SLO cobre o serviço; quando você precisa da visão por réplica, o label `instance`/`service_instance_id` continua lá. Nomear réplicas como serviços multiplicaria os dashboards e quebraria no momento em que as réplicas escalassem.

---

**Q4.** Você faz um pedido e encontra dois traces sem relação: um para o `POST /orders` e outro começando no relay do outbox. Por que a propagação automática de contexto falha aqui?

- A. O Kafka não suporta headers
- B. O relay lê uma linha do banco depois, em uma thread do agendador; o contexto do trace da requisição nunca foi guardado na linha, então não há o que continuar
- C. O agente não instrumenta métodos `@Scheduled`
- D. A amostragem descartou a ligação

??? success "Resposta"
    **B — o contexto não viajou com o dado.**

    O agente propaga contexto em memória (mesma thread) e através de HTTP e Kafka injetando o header `traceparent`. Uma linha do outbox é outro portador que o agente não conhece. Guardar o `traceparent` da requisição na linha e torná-lo atual antes do `kafka.send` religa o trace — a mesma ideia que o W3C Trace Context usa no HTTP.

---

## Métricas e dashboards { #metrics-and-dashboards }

**Q5.** Três réplicas do `catalog` reportam p95 de 80 ms, 90 ms e 400 ms. Qual é o p95 do serviço?

- A. 190 ms, a média dos três
- B. 400 ms, o máximo
- C. Não dá para calcular a partir dos três números; ele precisa ser calculado a partir da soma dos buckets dos histogramas das réplicas
- D. 90 ms, a mediana

??? success "Resposta"
    **C — percentis não se tiram por média.**

    O p95 do serviço depende de quantas requisições cada réplica atendeu e de como elas se distribuem. Histogramas podem ser somados bucket a bucket, então a consulta correta é `histogram_quantile(0.95, sum by (le) (rate(..._bucket[5m])))`. Tirar a média de percentis é um dos erros de dashboard mais comuns.

---

**Q6.** Por que o agente registra `http_route="/catalog/events/{id}"` em vez da URL real `/catalog/events/1234`?

- A. Para esconder os ids dos eventos de atacantes
- B. Porque cada valor distinto de label cria uma nova série temporal; URLs cruas criariam uma série por id de evento (cardinalidade ilimitada)
- C. Porque o Prometheus não aceita dígitos em valores de label
- D. Para deixar o dashboard mais rápido no navegador

??? success "Resposta"
    **B — cardinalidade.**

    O número de séries ≈ o produto dos valores distintos de cada label. Um template tem poucos valores; URLs cruas têm tantos quantos eventos existirem (e atacantes podem inventar mais). Cardinalidade alta deixa o Prometheus lento e caro; identificadores como `user_id` ou `order_id` pertencem a traces e logs, não a labels de métricas.

---

**Q7.** No dashboard RED, o painel **DB connections** mostra `used` igual a `max` e `waiting` > 0, enquanto a CPU está em 35%. Qual é o gargalo?

- A. A CPU
- B. O pool de conexões: as requisições fazem fila por uma conexão, então a latência cresce mesmo com a CPU ociosa
- C. O coletor de lixo
- D. A rede entre a borda e o gateway

??? success "Resposta"
    **B — saturação do pool (o S do USE).**

    Quando todas as conexões estão em uso, novas requisições esperam. Pela Lei de Little, a concorrência extra vira tempo de espera, então a latência sobe enquanto a CPU fica baixa. A correção pode ser um pool maior, menos consultas ou consultas mais rápidas, ou um *pooler* como o PgBouncer (lab 6) — mas primeiro a evidência: saturação > 0.

---

## SLOs e alertas { #slos-and-alerts }

**Q8.** O SLO do `catalog` é 99,5% em 28 dias. A fração de erros atual é 1%. Qual é a taxa de queima, e quanto tempo o orçamento inteiro duraria nesse ritmo?

- A. 1; 28 dias
- B. 2; 14 dias
- C. 0,5; 60 dias
- D. 14,4; cerca de 2 dias

??? success "Resposta"
    **B — taxa de queima = fração de erros / fração do orçamento = 1% / 0,5% = 2.**

    Uma taxa de queima de 1 gasta o orçamento exatamente na janela do SLO (28 dias); uma taxa de 2 o gasta duas vezes mais rápido, em 14 dias. É esse o número que os alertas de taxa de queima comparam com limiares como 14,4 (cerca de 2% do orçamento em 1 hora) e 6 (cerca de 5% em 6 horas).

---

**Q9.** Por que a regra de queima rápida exige que a taxa de queima passe de 14,4 em **ambas** as janelas, de 1 hora e de 5 minutos?

- A. Para dobrar a chance de disparar
- B. A janela longa prova que o problema é significativo (não um soluço); a janela curta prova que ainda está acontecendo, então o alerta se resolve logo depois da recuperação
- C. Porque o Grafana não consegue avaliar sozinho janelas maiores que 1 hora
- D. Para comparar o serviço com o seu próprio passado

??? success "Resposta"
    **B — relevância e atualidade.**

    Uma janela de 1 hora sozinha continuaria acionando por até uma hora depois da correção (os minutos ruins ainda estão dentro da janela). Uma janela de 5 minutos sozinha acionaria em soluços curtos que quase não custam orçamento. Exigir as duas dá alta precisão e reinício rápido — o núcleo do método de múltiplas janelas e múltiplas taxas de queima do *SRE workbook* do Google.

---

**Q10.** Com tráfego constante e uma hora de histórico saudável, o `db` para e toda requisição ao `catalog` falha. Mais ou menos quando a taxa de queima de 1 hora passa de 14,4 (SLO de 99,5%)?

- A. Depois de cerca de 5 segundos
- B. Depois de cerca de 4,3 minutos, quando a fração de erros da última hora chega a 7,2%
- C. Depois de exatamente 1 hora
- D. Nunca, porque a janela curta a reinicia

??? success "Resposta"
    **B — 14,4 × 0,5% = 7,2% da última hora precisam ser erros: 0,072 × 60 min ≈ 4,3 min.**

    A janela curta passa do limiar em um minuto; a longa é a condição mais lenta. Some o `for: 1m` e o intervalo de avaliação e a página chega cerca de 5–6 minutos depois do início de uma queda total — um compromisso deliberado entre tempo de detecção e alarmes falsos.

---

**Q11.** Por que o `/actuator/health` é excluído do SLI de disponibilidade?

- A. Porque *health checks* não são requisições HTTP
- B. Porque as sondas são frequentes, quase nunca falham e não são feitas por usuários; incluí-las infla a taxa de sucesso e esconde erros que os usuários veem
- C. Porque o Prometheus não consegue guardar métricas do actuator
- D. Porque o endpoint de saúde é mais lento que os outros

??? success "Resposta"
    **B — o SLI precisa medir o que os usuários vivem.**

    Kubernetes, Docker e a borda chamam os endpoints de saúde a cada poucos segundos. Essas requisições bem-sucedidas diluem as falhas reais: com sondas suficientes, um checkout quebrado ainda poderia mostrar 99,9% de "disponibilidade". Filtre por rota (`http_route!~"/actuator.*"`) ou meça na borda.

---

**Q12.** Você define `OTEL_TRACES_SAMPLER=parentbased_traceidratio` com argumento `0.1` em todos os serviços. O que acontece com o dashboard RED?

- A. As taxas caem para 10% dos valores reais
- B. Nada: as métricas são registradas para toda requisição, independentemente da amostragem de traces; só 10% dos traces são guardados
- C. Ele para de funcionar, porque as métricas são derivadas dos traces
- D. Os percentis ficam exatos

??? success "Resposta"
    **B — a amostragem vale para traces, não para as métricas do agente.**

    Os histogramas HTTP são registrados para toda requisição, então taxas, erros e percentis continuam corretos. Os traces viram exemplos: 10% deles, completos (a raiz decide e o `parentbased` faz cada serviço seguinte acompanhar), o que basta para explicar um padrão a uma fração do custo.

[Voltar ao lab](index.md){ .md-button }
