# Observabilidade

**Observabilidade** é a capacidade de entender o que um sistema está fazendo — e por quê — a partir de fora, usando os sinais que ele emite. Ela nunca fica no caminho da requisição: estes componentes são **canais laterais** que observam os serviços. Mas sem eles você voa às cegas: não vê qual caixa está saturada, não distingue uma dependência lenta de um banco lento e descobre as quedas pelos usuários irritados. A regra do curso é simples: *não dá para consertar o que você não mede*.

A paleta tem três **sinais** e duas **ações**. Sinais: **métricas** (números ao longo do tempo — algo está errado?), **logs** (eventos detalhados — o que exatamente aconteceu?) e **traces** (uma requisição atravessando serviços — para onde foi o tempo?). Ações: **alertas** (acordar um humano quando os usuários são afetados) e **health checks** (permitir que load balancers e orquestradores desviem automaticamente de instâncias quebradas). No BoxOffice, um dashboard RED por serviço, traces do gateway até o provedor de pagamento e um alerta de burn rate do SLO do checkout são o que dizem ao plantonista, às 10:01 do dia da venda, que o provedor de pagamento está lento — e não o banco.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [Metrics](#metrics) | Séries temporais numéricas (taxas, erros, percentis de latência, utilização) | `metrics` |
| [Logs](#logs) | Registros com data e hora de eventos discretos, de preferência estruturados (JSON) | `logs` |
| [Tracing](#tracing) | O caminho e os tempos de uma requisição através dos serviços (spans) | `tracing` |
| [Alerting](#alerting) | Regras sobre os sinais que notificam um humano quando os usuários são afetados | `alerting` |
| [Health Check](#healthcheck) | Sondas em endpoints que dizem a LBs/orquestradores se uma instância pode atender | `healthcheck` |

``` mermaid
flowchart LR
    S1[gateway] -.->|OTLP| COL[OpenTelemetry Collector]
    S2[order] -.->|OTLP| COL
    S3[payment] -.->|OTLP| COL
    COL -.-> M[Métricas]
    COL -.-> L[Logs]
    COL -.-> T[Tracing]
    M -.->|burn rate do SLO| AL[Alertas]
    AL -.->|aciona| ONCALL((plantão))
    LB[Load Balancer] -.->|GET /health/ready| S2
```

| Pergunta | Sinal | Exemplo |
|---|---|---|
| Algo está errado? Quanto? | Métricas | A taxa de erros do checkout saltou de 0,1% para 4% |
| Para onde vai o tempo nesta requisição lenta? | Tracing | 3,8 s de 4 s dentro de `payment → provedor` |
| O que exatamente aconteceu com o pedido 81234? | Logs | `provider timeout after 2000 ms, retry 2/3` |
| Alguém precisa agir agora? | Alertas | SLO consumindo 14× mais rápido que o sustentável |
| O tráfego deve ir para esta instância? | Health check | `/health/ready` devolve 503 durante o aquecimento |

---

## Metrics { #metrics }

**O que é.** Métricas são **medidas numéricas agregadas ao longo do tempo**: contadores (requisições atendidas, erros), gauges (tamanho da fila, memória em uso) e histogramas (distribuição de latência, da qual se leem p50/p95/p99). Cada **série temporal** é identificada por um nome e um conjunto de **labels** (`http_requests_total{service="order", route="/orders", status="500"}`). São baratas de guardar e consultar porque já vêm agregadas, o que faz delas o sinal certo para dashboards, SLOs e alertas. As receitas padrão: **RED** para serviços (taxa, erros, duração), **USE** para recursos (utilização, saturação, erros) e os **quatro sinais de ouro** do Google (latência, tráfego, erros, saturação).

**Quando usar.**

- Sempre, para todo serviço e todo recurso: o dashboard RED dos serviços `order`, `inventory` e `payment` do BoxOffice.
- SLIs e SLOs: "fração das requisições de checkout abaixo de 500 ms" é calculada a partir de um histograma de latência.
- Planejamento de capacidade e autoscaling: utilização de CPU, tamanho da fila e lag do consumidor movem o autoscaler.
- Métricas de negócio ao lado das técnicas: ingressos vendidos por minuto, tamanho da sala de espera, conversão.

**Quando não usar (ou cuidado).**

- Para investigar uma requisição específica: métricas são agregados — use traces e logs.
- **Cardinalidade**: cada combinação única de valores de labels é uma série separada. Labels como `user_id`, `order_id` ou URLs completas explodem o número de séries e o custo → mantenha os labels limitados (modelos de rota, classe do status).
- Médias escondem a cauda: registre **histogramas** e olhe os percentis; nunca tire a média de percentis entre instâncias.
- Intervalo de amostragem: uma coleta a cada minuto apaga um pico de 10 segundos.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Intervalo de coleta / exportação | 15–60 s | O padrão global do Prometheus é 1 min; 15 s é comum |
| Número de séries | ≈ métricas × combinações de labels × instâncias | 50 métricas × 200 combinações × 20 pods = 200 mil séries (≈ ilustrativo) |
| Custo por amostra | ≈ 1–2 bytes comprimidos em TSDBs modernos | ≈ ilustrativo; o número de séries pesa mais que o de amostras |
| Retenção | ≈ 15 dias brutos localmente; meses a anos com redução de resolução | Armazenamento de longo prazo no Mimir/Thanos ou num serviço gerenciado |
| Percentis a acompanhar | p50, p95, p99 (p99.9 nos caminhos de alto volume) | A partir de histogramas, por rota |

**Modos de falha.**

- **Explosão de cardinalidade** — alguém acrescenta `user_id` como label; memória e custo disparam, o backend de métricas cai → listas de labels permitidos, limites por cliente, revisão das mudanças em métricas.
- **Métrica ausente onde importava** — a dependência lenta não tinha métrica de latência do lado do cliente → instrumente as chamadas de saída (a autoinstrumentação do OpenTelemetry faz isso).
- **Médias enganosas** → histogramas e percentis; detalhamento por rota.
- **Monitoramento que morre junto com o sistema** — a pilha de métricas roda no mesmo cluster que caiu → monitore também de fora (verificações sintéticas, outra região ou um serviço gerenciado).
- **Dashboards que ninguém lê** → poucos dashboards, construídos em torno dos SLOs e de RED/USE, linkados a partir dos alertas.

**No playground.** `metrics` é um **canal lateral**, fora do caminho da requisição. Conecte serviços a ele e a utilização deles fica visível no canvas; um serviço sem nó `metrics` conectado mostra a utilização como **"?"** — não dá para consertar o que você não mede (um botão "god mode" revela tudo, para fins didáticos). Ele acrescenta um custo mensal. Cenários: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack), [`scale-out`](../../../../playground/scenarios/index.md#scale-out).

**Produtos reais.**

=== "AWS"

    - **Amazon CloudWatch** (métricas, dashboards) — métricas nativas dos serviços da AWS e métricas customizadas.
    - **Amazon Managed Service for Prometheus** e **Amazon Managed Grafana**.

=== "GCP"

    - **Cloud Monitoring** — métricas, dashboards e monitoramento de SLOs.
    - **Google Cloud Managed Service for Prometheus**.

=== "Azure"

    - **Azure Monitor** (Metrics) e **Azure Monitor managed service for Prometheus**.
    - **Azure Managed Grafana**.

=== "Código aberto"

    - **Prometheus** — coleta de métricas por pull, PromQL, o padrão de fato no Kubernetes.
    - **Grafana** — dashboards sobre muitas fontes de dados.
    - **Grafana Mimir**, **Thanos**, **VictoriaMetrics** — armazenamento escalável de métricas de longo prazo.
    - **OpenTelemetry** (SDKs e Collector) — instrumentação e exportação neutras em relação a fornecedores (usado no Hands-on 8 com `grafana/otel-lgtm`).

!!! tip "Na entrevista"
    "Todo serviço exporta métricas RED — taxa, erros e um histograma de latência por rota — e todo recurso, métricas USE. Meus SLIs e alertas saem desses histogramas, eu olho o p99, não a média, e mantenho os labels limitados para a cardinalidade não explodir."

**Saiba mais:** [Observabilidade › Sinais](../../../classes/observability/signals/index.md) · [Observabilidade › OpenTelemetry](../../../classes/observability/opentelemetry/index.md) · [Estimativas › Percentis](../../../classes/estimation/percentiles/index.md) · [Desempenho › Metodologia](../../../classes/performance/methodology/index.md) · [Hands-on 8](../../../hands-on/8/index.md)

---

## Logs { #logs }

**O que é.** Logs são **registros com data e hora de eventos discretos**: "pedido 81234 criado", "timeout do provedor de pagamento após 2000 ms", "usuário 77 errou o login". A prática moderna é o **log estruturado** — um objeto JSON por evento, com campos (`level`, `service`, `trace_id`, `order_id`, `duration_ms`) — para que os logs possam ser filtrados e agregados, e não só vasculhados com grep. Os logs são enviados por um agente ou pelo OpenTelemetry Collector a um repositório central, onde são indexados e pesquisados. Incluir o **trace id** em cada linha liga os logs aos traces.

**Quando usar.**

- Investigar uma requisição ou um usuário específico: "o que aconteceu com o pedido 81234?" — busque por `order_id` ou `trace_id`.
- Erros com contexto: stack traces, a entrada que os causou, qual tentativa de retry falhou.
- **Trilhas de auditoria** para segurança e conformidade: quem reembolsou o quê, quem mudou permissões (guardadas à parte, com retenção mais longa e acesso restrito).
- Eventos raros que não valem uma métrica.

**Quando não usar (ou cuidado).**

- Como principal forma de detectar problemas: contar linhas de log para calcular taxas de erro é lento e caro → use métricas e link para os logs.
- Registrar o corpo de toda requisição em alto volume: o custo cresce linearmente com o tráfego → amostre os logs de sucesso, guarde todos os erros.
- **Dados sensíveis**: senhas, tokens, números de cartão e dados pessoais nunca devem ir para o log (LGPD/GDPR, PCI DSS) → mascare na origem.
- Texto não estruturado com formatos inconsistentes torna a busca quase impossível.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Estimativa do volume de logs | requisições/s × linhas por requisição × bytes por linha | 2.000 req/s × 5 linhas × 500 B = 5 MB/s ≈ 430 GB/dia (≈ ilustrativo) |
| Linha típica de log estruturado | ≈ 200 B – 2 KB | Cresce rápido com stack traces e payloads |
| Atraso da ingestão até ficar pesquisável | ≈ segundos | Depende do pipeline |
| Retenção quente | ≈ 7–30 dias | Logs mais antigos vão para object storage barato; logs de auditoria ficam mais tempo |
| O que move o custo | GB ingeridos e indexados | Indexe menos, amostre os logs de sucesso |

**Modos de falha.**

- **Enxurrada de logs** — uma dependência falhando faz cada requisição registrar um stack trace; o pipeline engasga e a fatura explode → limitar logs repetidos, amostrar, desligar o debug em produção.
- **Falta de correlação** — logs de 6 serviços não podem ser cruzados → propagar e registrar o `trace_id`.
- **Vazamento de segredos ou dados pessoais** → campos estruturados com mascaramento, revisões, varreduras.
- **Log bloqueando a aplicação** — escritas síncronas num destino lento somam latência → appenders assíncronos, buffer local, stdout + agente.
- **Logs perdidos** quando um pod morre → escreva no stdout e deixe o agente do nó enviá-los; buffers com backpressure.

**No playground.** `logs` é um **canal lateral**: conectar serviços a ele habilita os **detalhes do log de eventos** (o que aconteceu com as requisições amostradas, quais erros e retries) na aba Events. Ele custa por GB, então aparece no painel de custo. Cenários: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure).

**Produtos reais.**

=== "AWS"

    - **Amazon CloudWatch Logs** — coleta, retenção e consultas com Logs Insights.
    - **Amazon OpenSearch Service** — busca e análise sobre logs.

=== "GCP"

    - **Cloud Logging** — coleta, Log Explorer, métricas baseadas em logs, envio para BigQuery ou Cloud Storage.

=== "Azure"

    - **Azure Monitor Logs** (workspaces do Log Analytics) — armazenamento de logs consultado com KQL.

=== "Código aberto"

    - **Grafana Loki** — agregação de logs indexada só por labels (barata); consultada com LogQL.
    - **OpenSearch** / **Elasticsearch** — busca de logs com indexação de texto completo (a pilha "ELK", com Logstash e Kibana).
    - **Fluent Bit**, **Vector**, **OpenTelemetry Collector** — coletores e processadores de logs.

!!! tip "Na entrevista"
    "Os serviços escrevem logs JSON estruturados no stdout, com o trace id em cada linha; um agente os envia para um repositório central. Uso métricas para detectar, traces para localizar e logs para explicar. Erros são sempre guardados, requisições bem-sucedidas são amostradas e nada sensível vai para o log."

**Saiba mais:** [Observabilidade › Sinais](../../../classes/observability/signals/index.md) · [Observabilidade › OpenTelemetry](../../../classes/observability/opentelemetry/index.md) · [Observabilidade › Resposta a incidentes](../../../classes/observability/incident-response/index.md) · [Rede e segurança › Zero trust](../../../classes/network-security/zero-trust/index.md) · [Hands-on 8](../../../hands-on/8/index.md)

---

## Tracing { #tracing }

**O que é.** O tracing distribuído acompanha **uma requisição** por todos os serviços que ela toca. Cada unidade de trabalho é um **span** (nome, início, duração, atributos, status) e os spans formam uma árvore sob um mesmo **trace id**, propagado entre os serviços em cabeçalhos das requisições (o cabeçalho W3C `traceparent`) e nos metadados das mensagens. O resultado é uma **cascata**: você vê que um checkout de 4 s passou 3,8 s esperando o provedor de pagamento, ou que uma página faz 40 chamadas sequenciais ao banco (N+1). Como registrar todas as requisições é caro, os traces são **amostrados**: amostragem na cabeça (decide no início, por exemplo 5%) ou na cauda (decide no fim, guardando todos os erros e as requisições lentas).

**Quando usar.**

- Qualquer sistema com mais de dois ou três serviços: descobrir *de onde* vêm a latência ou os erros.
- Diagnosticar o caminho crítico: o que é sequencial e poderia ser paralelo, qual dependência domina o p99.
- Entender fan-out e retries: um trace mostra os três retries que triplicaram a carga.
- Aplicações com LLM: um trace por execução de agente mostra cada chamada ao modelo, cada chamada de ferramenta, tokens e latência.

**Quando não usar (ou cuidado).**

- Sem **propagação de contexto** em cada salto (HTTP, gRPC, cabeçalhos do Kafka, jobs assíncronos), os traces se quebram em fragmentos → use instrumentação do OpenTelemetry em todo lugar.
- Amostrar 100% em alto volume é caro; amostrar pouco demais perde as raras requisições lentas → amostragem na cauda para erros e traces lentos.
- Traces mostram uma requisição; para tendências, use métricas (ou métricas derivadas de spans).
- Dados sensíveis em atributos de spans são tão perigosos quanto em logs.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Spans por trace | ≈ dezenas a centenas | Um por chamada de serviço, consulta, acesso ao cache |
| Taxa de amostragem na cabeça | ≈ 1–10% em produção de alto volume | ≈ ilustrativo; 100% em desenvolvimento e em serviços de baixo volume |
| Overhead da instrumentação | pequeno (≈ microssegundos por span) | A exportação é em lotes e assíncrona |
| Cabeçalho de propagação | `traceparent` (W3C Trace Context) | Leva o trace id, o id do span pai e a flag de amostragem |
| Retenção | ≈ dias a poucas semanas | Traces servem a investigações recentes |

**Modos de falha.**

- **Traces quebrados** — um serviço ou o broker de mensagens descarta o contexto → instrumente cada salto, propague pelos cabeçalhos do Kafka e pelos payloads dos jobs.
- **A amostragem esconde o problema** — a rara requisição de 10 segundos não foi amostrada → amostragem na cauda (guardar erros e traces lentos), exemplars ligando métricas a traces.
- **Collector sobrecarregado** no pico → lotes, escalar o Collector horizontalmente, amostrar na borda do pipeline.
- **Diferença de relógio** faz spans filhos parecerem começar antes do pai → confie em durações medidas num mesmo host, NTP em todo lugar.

**No playground.** `tracing` é um **canal lateral**: quando presente, a aba **Trace** mostra a cascata de uma requisição lenta amostrada, com o tempo gasto em fila e em serviço em cada nó — o jeito mais rápido de achar uma dependência lenta ou uma retry storm. Ele acrescenta custo. Cenários: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure), [`retry-storm`](../../../../playground/scenarios/index.md#retry-storm), [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant).

**Produtos reais.**

=== "AWS"

    - **AWS X-Ray** — tracing distribuído para cargas na AWS (aceita dados do OpenTelemetry).
    - **Amazon CloudWatch Application Signals** — monitoramento de desempenho de aplicações construído sobre OpenTelemetry.

=== "GCP"

    - **Cloud Trace** — tracing distribuído, compatível com OpenTelemetry.

=== "Azure"

    - **Azure Monitor Application Insights** — monitoramento de desempenho de aplicações com tracing distribuído (distro do OpenTelemetry).

=== "Código aberto"

    - **OpenTelemetry** — as APIs, SDKs, agentes de autoinstrumentação e o Collector padrão.
    - **Jaeger** — backend e interface de tracing (CNCF).
    - **Grafana Tempo** — armazenamento de traces em object storage, integrado ao Grafana.
    - **Zipkin** — o sistema de tracing de código aberto original.

!!! tip "Na entrevista"
    "Com o OpenTelemetry, o trace id flui do gateway por todos os serviços e pelos cabeçalhos do Kafka, então um checkout lento aparece como uma cascata: 3,8 s de 4 s esperando o provedor de pagamento. Guardo todos os traces de erro e lentos com amostragem na cauda, e alguns por cento do resto."

**Saiba mais:** [Observabilidade › OpenTelemetry](../../../classes/observability/opentelemetry/index.md) · [Observabilidade › Sinais](../../../classes/observability/signals/index.md) · [Desempenho › Gargalos](../../../classes/performance/bottlenecks/index.md) · [Sistemas de IA › Segurança e avaliações](../../../classes/ai-systems/safety-evals/index.md) · [Hands-on 8](../../../hands-on/8/index.md)

---

## Alerting { #alerting }

**O que é.** Os alertas transformam sinais em **notificações para humanos**: regras avaliadas continuamente sobre métricas (ou logs) que, quando verdadeiras por tempo suficiente, encaminham uma mensagem à pessoa certa — um **acionamento** (page) para problemas urgentes, um ticket ou mensagem de chat para o resto. Bons alertas tratam de **sintomas que os usuários sentem** (erros, latência, violações de SLO), são **acionáveis** e vêm com o link de um runbook. O padrão moderno são os **alertas baseados em SLO com burn rate**: alertar quando o orçamento de erros está sendo consumido muito mais rápido que o sustentável, usando duas janelas (por exemplo, 1 h e 5 min) para que o alerta seja rápido e não barulhento.

**Quando usar.**

- Todo SLO voltado ao usuário: "disponibilidade do checkout 99,9% em 28 dias", com alertas de consumo rápido (acionamento) e lento (ticket).
- Indicadores antecipados de quedas iminentes: disco enchendo em poucas horas, certificado expirando em 7 dias, lag do consumidor se aproximando da retenção.
- Escalas de plantão com políticas de escalonamento e reconhecimento.

**Quando não usar (ou cuidado).**

- Alertar sobre causas em vez de sintomas ("CPU > 80%") aciona pessoas por coisas que não afetam os usuários → **fadiga de alertas**, e os acionamentos reais passam a ser ignorados.
- Alertas sem dono ou sem runbook.
- Limiares estáticos sobre métricas ruidosas ficam oscilando → use janelas, burn rates, histerese.
- Os alertas dependem de a pilha de monitoramento estar viva → um "dead man's switch" (um alerta de batimento sempre disparado, que aciona alguém quando para).

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Orçamento de erros de um SLO de 99,9% numa janela móvel de 28 dias | ≈ 40 minutos de queda total | 0,1% × 28 dias × 24 h × 60 min |
| Acionamento de consumo rápido (SRE Workbook) | burn rate de 14,4 em 1 h (com verificação de 5 min) | Consome 2% de um orçamento de 28 dias em uma hora |
| Ticket de consumo lento | burn rate ≈ 1–6 em 6 h – 3 dias | ≈ ilustrativo; pega degradações graduais |
| Acionamentos sustentáveis por turno de plantão | poucos, no máximo | O livro de SRE do Google sugere ≤ 2 incidentes por turno de 12 horas |
| Meta de tempo para reconhecer | ≈ 5–15 min para acionamentos | ≈ ilustrativo; definida pela política do time |

**Modos de falha.**

- **Fadiga de alertas** — alertas ruidosos demais, o verdadeiro passa despercebido → apagar ou rebaixar alertas não acionáveis, acionar só por SLO.
- **Falha silenciosa** — a métrica parou de ser reportada, então o limiar nunca dispara → alertar sobre ausência de dados, dead man's switch.
- **Pilha de alertas cai junto com o sistema** → monitorar o monitor de fora (verificações sintéticas, outro provedor).
- **Sem runbook / dono errado** → cada alerta linka um runbook e vai para o time dono.
- **Oscilação** → janelas de avaliação mais longas, durações `for`, histerese.

**No playground.** `alerting` é um **canal lateral** conectado a `metrics`: quando presente, as falhas aleatórias são detectadas e corrigidas mais rápido — o modelo **reduz o MTTR em 50%**, o que aparece como disponibilidade maior no relatório da execução. Ele custa dinheiro, como os outros nós de observabilidade. Cenários: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack), [`multi-region`](../../../../playground/scenarios/index.md#multi-region).

**Produtos reais.**

=== "AWS"

    - **Alarmes do Amazon CloudWatch** (com alarmes compostos) encaminhados pelo **Amazon SNS**.
    - **AWS Incident Manager** (Systems Manager) — plantão, escalonamento e planos de resposta.

=== "GCP"

    - **Políticas de alerta do Cloud Monitoring** — inclusive alertas de burn rate de SLO, com canais de notificação.

=== "Azure"

    - **Alertas do Azure Monitor** com **action groups** (e-mail, SMS, webhooks, ITSM).

=== "Código aberto"

    - **Prometheus Alertmanager** — agrupamento, silenciamento e roteamento dos alertas do Prometheus.
    - **Grafana Alerting** — regras de alerta sobre qualquer fonte de dados do Grafana.
    - **Sloth** / **Pyrra** — geram alertas de burn rate em múltiplas janelas a partir de definições de SLO.
    - Serviços comerciais de acionamento como o **PagerDuty** são comuns para escalas de plantão.

!!! tip "Na entrevista"
    "Aciono por sintomas, não por causas: alertas de burn rate em múltiplas janelas sobre o SLO do checkout — consumo de 14× em uma hora aciona o plantonista, consumos lentos abrem um ticket. Todo alerta tem um dono e um runbook, e um alerta de batimento avisa se o próprio monitoramento caiu."

**Saiba mais:** [Observabilidade › Alertas](../../../classes/observability/alerting/index.md) · [Confiabilidade › SLOs](../../../classes/reliability/slo/index.md) · [Observabilidade › Resposta a incidentes](../../../classes/observability/incident-response/index.md) · [Estimativas › Matemática da disponibilidade](../../../classes/estimation/availability-math/index.md) · [Hands-on 8](../../../hands-on/8/index.md)

---

## Health Check { #healthcheck }

**O que é.** Um health check é uma **sonda** que algo fora da instância — um load balancer, o Kubernetes, um serviço de failover por DNS — envia periodicamente para decidir se aquela instância deve receber tráfego ou ser reiniciada. O Kubernetes distingue três: **liveness** ("o processo travou? se falhar, reinicie"), **readiness** ("pode atender tráfego agora? se falhar, tire do load balancer, não reinicie") e **startup** ("ainda está subindo? segure as outras sondas até terminar"). Load balancers usam verificações ativas parecidas (uma requisição HTTP para `/health` a cada poucos segundos) e às vezes **passivas** (detecção de outliers pelos erros do tráfego real).

**Quando usar.**

- Toda réplica atrás de um load balancer ou de um Service do Kubernetes: sem isso, o LB continua mandando tráfego para instâncias mortas ou ainda aquecendo.
- Readiness durante a inicialização e o aquecimento (JIT, caches, pools de conexão) e durante o desligamento gracioso (falhe a readiness primeiro, depois drene).
- Failover regional: health checks de DNS decidem quando mandar os usuários para a outra região.
- Descarte de carga: uma instância sobrecarregada pode falhar a readiness temporariamente.

**Quando não usar (ou cuidado).**

- **Não verifique dependências na liveness**: se o banco fica lento e a liveness de todos os pods o verifica, o Kubernetes reinicia todos os pods de uma vez — uma tempestade de restarts que piora a queda.
- Uma readiness que verifica uma dependência compartilhada pode tirar **todas** as réplicas de uma vez → verifique só o que a própria instância precisa, e degrade com elegância.
- Endpoints de saúde devem ser baratos, rápidos e sem autenticação, mas não públicos (sem detalhes sensíveis).
- Limiares agressivos demais oscilam; frouxos demais deixam instâncias mortas em rotação.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Padrões das sondas do Kubernetes | `periodSeconds` 10, `timeoutSeconds` 1, `failureThreshold` 3 | Padrões documentados |
| Tempo de detecção | ≈ intervalo × limiar de falhas | Padrões do K8s: ≈ 30 s; 2 s × 2 ≈ 4 s se ajustado |
| Padrões do health check de alvos do AWS ALB | intervalo de 30 s, limiar de não saudável 2, de saudável 5 | Padrões documentados; ≈ 60 s para marcar como não saudável |
| Latência do endpoint da sonda | ≈ milissegundos | Não deve fazer trabalho pesado |
| Efeito na disponibilidade | detecção mais rápida ⇒ menos requisições falhas por incidente | Requisições falhas ≈ fração do tráfego × tempo de detecção |

**Modos de falha.**

- **Tempestade de restarts** — a liveness depende do banco; o banco fica lento; todos os pods reiniciam → a liveness verifica só o próprio processo.
- **Remoção da frota inteira** — a readiness falha em todo lugar por causa de uma dependência compartilhada; o LB fica sem alvos saudáveis → degradar em vez de falhar a readiness; LBs que "falham aberto" quando todos os alvos estão não saudáveis.
- **Instância zumbi** — o endpoint de saúde devolve 200, mas as requisições reais falham (por exemplo, um pool de threads quebrado) → health checks passivos / detecção de outliers no tráfego real, verificações de readiness mais profundas.
- **Detecção lenta** → intervalos mais curtos nos caminhos críticos, mais verificações passivas.
- **Oscilação** → limiares de saudável/não saudável com histerese.

**No playground.** `healthcheck` é um **canal lateral**: conectá-lo a um serviço atrás de um load balancer reduz o **tempo de detecção de falhas do LB de 30 s para 3 s**, então, depois da queda de uma réplica, muito menos requisições vão para a instância morta. Compare o pico de erros após uma queda com e sem ele. Cenários: [`scale-out`](../../../../playground/scenarios/index.md#scale-out), [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Produtos reais.**

=== "AWS"

    - **Health checks de alvos do Elastic Load Balancing** (ALB/NLB).
    - **Health checks do Amazon Route 53** — para failover por DNS.

=== "GCP"

    - **Health checks do Cloud Load Balancing**.
    - **Uptime checks do Cloud Monitoring** — sondas sintéticas externas.

=== "Azure"

    - **Health probes do Azure Load Balancer** e **do Application Gateway**.
    - **Testes de disponibilidade do Application Insights** — sondas sintéticas externas.

=== "Código aberto"

    - **Sondas de liveness, readiness e startup do Kubernetes** (usadas no Hands-on 10).
    - Grupos de saúde do **Spring Boot Actuator** (`/actuator/health/liveness`, `/actuator/health/readiness`).
    - **Prometheus Blackbox Exporter** — sondas HTTP/TCP/ICMP de fora.
    - Detecção de outliers do **Envoy** — health check passivo em proxies e service meshes.

!!! tip "Na entrevista"
    "Cada réplica expõe liveness e readiness separadamente: a liveness só diz que o processo não travou, a readiness diz que ele pode atender agora — ela falha durante o aquecimento e o desligamento. O load balancer para de rotear para uma réplica com falha em segundos, e eu nunca coloco verificação do banco na liveness, senão um banco lento reinicia a frota inteira."

**Saiba mais:** [Observabilidade › Sinais](../../../classes/observability/signals/index.md) · [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md) · [Confiabilidade › Padrões](../../../classes/reliability/patterns/index.md) · [Borda › Balanceamento de carga](../../../classes/edge/load-balancing/index.md) · [Load Balancer](../edge/index.md#lb) · [Hands-on 3](../../../hands-on/3/index.md) · [Hands-on 10](../../../hands-on/10/index.md)
