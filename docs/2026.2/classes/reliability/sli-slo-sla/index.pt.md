"A loja é confiável o suficiente?" é uma pergunta que ninguém consegue responder sem números. A gerente de produto quer lançar um novo checkout esta semana; o engenheiro de plantão diz que o serviço de pedidos teve um mês ruim e quer congelar os deploys. Sem uma definição compartilhada de "bom o suficiente", essa discussão é opinião contra opinião. Medir a confiabilidade exige um vocabulário comum que ligue a telemetria bruta às decisões de engenharia e aos compromissos com os clientes. A prática de engenharia de confiabilidade de sites (SRE, *Site Reliability Engineering*) do Google introduziu um modelo de três camadas com esse objetivo[^1], hoje padrão na indústria.

| Termo | Nome completo | Natureza |
|---|---|---|
| **SLI** | Service Level Indicator | Uma métrica mensurável |
| **SLO** | Service Level Objective | Uma meta interna para essa métrica |
| **SLA** | Service Level Agreement | Um compromisso contratual com os clientes |

``` mermaid-sim
flowchart LR
    telemetry["Telemetria<br/>(logs, métricas, traces)"]
    sli["SLI<br/>Medição bruta"]
    slo["SLO<br/>Meta interna"]
    sla["SLA<br/>Contrato externo"]
    budget["Error Budget<br/>Alavanca de engenharia"]

    telemetry e1@-->|agregada em| sli
    sli e2@-->|avaliado contra| slo
    slo e3@-->|embasa| sla
    slo e4@-->|o restante vira| budget

    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
    e4@{ animate: true }
```

---

## SLI — A medição bruta

Um SLI é uma **métrica quantitativa extraída diretamente da instrumentação** que reflete a qualidade do sistema percebida pelo usuário. Nem toda métrica é um bom SLI; só aquelas que se correlacionam com o usuário estar ou não obtendo valor do serviço.

A forma mais útil de escrever um SLI é como uma razão entre eventos, de modo que ele fique sempre entre 0% e 100%[^2]:

$$
\text{SLI} = \frac{\text{good events}}{\text{valid events}} \times 100\%
$$

Por exemplo: *"a proporção de requisições `GET /products` que retornam um status diferente de 5xx em menos de 300 ms"*. "Válidos" permite excluir eventos que não devem contar, como respostas `4xx` causadas pelo cliente.

### Categorias canônicas de SLI

| Categoria | O que mede | Exemplo de medição |
|---|---|---|
| **Disponibilidade** | Fração das requisições atendidas com sucesso | `non-5xx responses / total HTTP requests` |
| **Latência** | Fração das requisições atendidas rápido o suficiente | `requests faster than 200 ms / total requests` (uma meta de 95% para ele é o mesmo que "percentil 95 (P95) < 200 ms") |
| **Taxa de erros** | Fração das requisições que resultam em erro | `HTTP 5xx / total HTTP requests` (o complemento da disponibilidade) |
| **Vazão** | Volume de trabalho que o sistema processa | `Requests per second` (geralmente uma métrica de capacidade e não um SLI) |
| **Durabilidade** | Fração dos dados que podem ser recuperados | `Successful reads / total attempted reads` |
| **Atualidade** | Idade da escrita bem-sucedida mais recente | `Time since last successful cache refresh` |

!!! warning "Evite métricas de vaidade"
    Utilização de CPU, tamanho do heap da JVM e tempo de pausa do garbage collector **não** são bons SLIs por si sós. Um serviço pode estar com 95% de CPU e ainda assim atender todas as requisições corretamente — e, ao contrário, um serviço pode estar com 10% de CPU e completamente fora do ar. SLIs devem refletir o que o usuário experimenta, não o que a infraestrutura experimenta.

### Como os SLIs são coletados

- **Instrumentação na aplicação**: contadores de requisições e histogramas de latência exportados via Spring Boot Actuator / Micrometer ([Hands-on 6](../../../hands-on/6/index.md)).
- **Monitoramento sintético**: sondas que enviam requisições reais de fora do sistema, em intervalos programados (por exemplo, o Prometheus Blackbox Exporter).
- **Baseado em logs**: análise dos logs de acesso para contar respostas 2xx vs 5xx.
- **No cliente**: medição a partir do navegador ou do app móvel, para a experiência real do usuário final.

!!! example "O SLI de disponibilidade da loja em PromQL"

    O Spring Boot exporta o contador `http_server_requests_seconds_count` com um label `status` e o Prometheus acrescenta o label `job` do job de coleta (nomeado por serviço, como no [Hands-on 6](../../../hands-on/6/index.md); aqui `OrderMetrics`). O SLI de disponibilidade do serviço de pedidos nos últimos 5 minutos é:

    ```promql
    sum(rate(http_server_requests_seconds_count{job="OrderMetrics", status!~"5.."}[5m]))
    /
    sum(rate(http_server_requests_seconds_count{job="OrderMetrics"}[5m]))
    ```

    O numerador conta os eventos bons (tudo que não é `5xx`), o denominador conta todos os eventos. Veja a aula de [Observabilidade](../../observability/index.md) para PromQL.

---

## SLO — A meta com que você se compromete

Um SLO é uma **meta específica e delimitada no tempo para um SLI**. Ele responde: *"Quão boa esta métrica precisa ser para considerarmos o serviço saudável?"*

**Formato:**

> `SLI ≥ threshold` em uma `rolling window`

Uma **janela móvel** (*rolling window*) cobre sempre os últimos N dias (por exemplo, de 28 dias atrás até agora), então avança a cada minuto; uma **janela de calendário** é reiniciada no dia 1º de cada mês.

**Exemplos:**

| SLO | Significado |
|---|---|
| `Availability ≥ 99.9%` em 28 dias | No máximo 0,1% das requisições pode falhar em qualquer período de 28 dias |
| `P95 latency ≤ 200 ms` em 7 dias | 95% das requisições terminam em até 200 ms em qualquer janela de 7 dias |
| `Error rate ≤ 0.5%` em 24 horas | No máximo 5 em cada 1000 requisições retornam 5xx em qualquer dia |

### Escolhendo o SLO certo

SLOs devem ser **ambiciosos, mas alcançáveis**. Um SLO que nunca é violado não está impulsionando trabalho de confiabilidade — está frouxo demais. Um SLO violado o tempo todo é ruído — a equipe deixa de confiar nele.

- Comece medindo o SLI atual por 30–90 dias.
- Defina o SLO inicial no patamar observado menos uma pequena margem.
- Aperte-o com o tempo, à medida que o sistema melhora.
- Torne os SLOs públicos dentro da organização de engenharia, para que todas as equipes entendam as metas que estão perseguindo.
- Lembre-se da disponibilidade composta ([visão geral](../index.md)): um serviço não pode prometer mais do que o produto dos serviços dos quais depende de forma síncrona.

---

## Error Budget

O error budget (orçamento de erros) é a quantidade de não confiabilidade que o SLO permite. É a **licença para assumir riscos** da equipe de engenharia.

$$
\text{Error Budget} = 1 - \text{SLO target}
$$

Para um SLO de disponibilidade de 99,9%, o orçamento é 0,1% — do **tempo** ou das **requisições** na janela, dependendo de como o SLI é definido.

=== "Baseado em tempo"

    Para um SLO de 99,9% em uma janela de 28 dias:

    $$
    \text{Error Budget} = 0.1\% \times 28 \text{ days} \times 24 \text{ h} \times 60 \text{ min} \approx 40.3 \text{ minutes}
    $$

    (Em um mês de calendário de 30,44 dias, os mesmos 99,9% dão ≈ 43,8 minutos — o número geralmente citado nas tabelas de "noves".)

=== "Baseado em requisições"

    O serviço de pedidos recebe cerca de 1.000.000 de requisições por dia. Em 28 dias, são 28.000.000 de requisições, então um SLO de 99,9% permite

    $$
    0.1\% \times 28\,000\,000 = 28\,000 \text{ failed requests}
    $$

    Um deploy ruim que retorna `500` para 20.000 requisições em uma hora consome cerca de 70% do orçamento de 28 dias de uma só vez (20.000 / 28.000 ≈ 71%).

Se o error budget está **intacto**, a equipe pode:

- Fazer deploys com frequência e aceitar algum risco de deploy
- Executar experimentos em sistemas de produção
- Assumir mais dívida técnica

Se o error budget está **esgotado**, a equipe deve:

- Congelar deploys não essenciais
- Priorizar o trabalho de confiabilidade em vez de novas funcionalidades
- Investigar e corrigir as causas-raiz que estão consumindo o orçamento

Essas regras só funcionam se forem acordadas antes: uma **política de error budget** é um documento curto, assinado por produto e engenharia, que diz o que acontece quando o orçamento acaba.

!!! tip "O error budget como ferramenta de negociação"
    Quando uma gerente de produto quer lançar uma funcionalidade arriscada e a equipe de SRE está relutante, o error budget dá uma resposta objetiva: *"Temos 12 minutos de orçamento restantes nesta janela de 28 dias. Se fizermos o deploy e ele causar 30 minutos de degradação, vamos violar nosso SLO. Vamos esperar até recuperar orçamento suficiente."*

### Burn rate

A burn rate (taxa de consumo) mede a velocidade com que o error budget está sendo consumido em relação à janela do SLO[^2]:

$$
\text{burn rate} = \frac{\text{observed error rate}}{1 - \text{SLO}}
$$

Com um SLO de 99,9%, uma taxa de erros de 0,1% é uma burn rate de 1 — o orçamento dura exatamente a janela inteira. Uma taxa de erros de 1,44% é uma burn rate de 14,4. Uma burn rate de $b$ esgota o orçamento em (janela ÷ $b$) e, em um período $t$, gasta a fração $b \cdot t / \text{janela}$ do orçamento.

Para uma janela de 28 dias, com os alertas que o SRE Workbook recomenda[^2]:

| Burn rate | Orçamento esgotado em | Alertar quando durar… | Orçamento gasto até lá | Ação |
|---|---|---|---|---|
| 1× | 28 dias (a janela inteira) | 3 dias | ~10% | 🟡 ticket: olhar em horário comercial |
| 6× | ~4,7 dias | 6 horas | ~5% | 🔴 acionar o plantão |
| 14,4× | ~1,9 dia (~47 horas) | 1 hora | ~2% | 🔴 acionar o plantão imediatamente |
| 1000× (toda requisição falha) | ~40 minutos | — | — | 🔴 o alerta de 1 hora dispara em cerca de um minuto |

O Workbook deriva esses pares para uma janela de 30 dias (14,4 × 1 h / 720 h = 2%; 6 × 6 h / 720 h = 5%; 1 × 72 h / 720 h = 10%); com 28 dias as porcentagens são quase as mesmas (2,1%, 5,4%, 10,7%). Alertas de burn rate alta pegam cedo os incidentes rápidos, enquanto alertas de burn rate baixa pegam degradações lentas que, de outra forma, seriam invisíveis.

### Alertas com várias janelas: rápidos para disparar, rápidos para parar

Um alerta sobre uma única janela longa tem dois problemas. Ele demora a ver uma queima pequena mas constante — por isso as regras mais lentas usam janelas mais longas. E continua disparando muito depois da correção: uma média de 1 hora ainda contém os minutos ruins por até uma hora depois que os erros param. A resposta do Workbook é exigir **duas janelas ao mesmo tempo**: a longa prova que uma parte relevante do orçamento foi gasta; uma curta (1/12 da longa, pela orientação deles) prova que ele *ainda* está queimando agora.

| Notificação | Janela longa | Janela curta | Burn rate acima de | Orçamento gasto (30 dias) |
|---|---|---|---|---|
| 🔴 Page | 1 hora | 5 minutos | 14,4 | 2% |
| 🔴 Page | 6 horas | 30 minutos | 6 | 5% |
| 🟡 Ticket | 3 dias | 6 horas | 1 | 10% |

O diagrama reproduz a decisão que as regras de alerta tomam a cada avaliação:

``` mermaid-sim
flowchart TD
    E["taxa de erro do serviço de pedidos<br/>em várias janelas"] --> Q1{"1 h e 5 min<br/>ambas acima de 14,4×?"}
    Q1 -->|sim| P1["acionar agora<br/>2% do orçamento em 1 h"]
    Q1 -->|não| Q2{"6 h e 30 min<br/>ambas acima de 6×?"}
    Q2 -->|sim| P2["acionar<br/>5% em 6 h"]
    Q2 -->|não| Q3{"3 dias e 6 h<br/>ambas acima de 1×?"}
    Q3 -->|sim| TK["ticket<br/>10% em 3 dias"]
    Q3 -->|não| OK["nenhum alerta<br/>o orçamento absorve"]
```

O Workbook também desaconselha durações `for:` como forma de alongar uma janela: a duração não acompanha a gravidade (uma queda total espera tanto quanto uma pequena) e recomeça sempre que a taxa cai abaixo do limiar.

!!! example "Um alerta de burn rate para o serviço de pedidos"

    ```yaml
    # Prometheus alerting rule (99.9% SLO → budget = 0.001)
    - alert: OrderErrorBudgetFastBurn
      expr: |
        (
          sum(rate(http_server_requests_seconds_count{job="OrderMetrics", status=~"5.."}[1h]))
          /
          sum(rate(http_server_requests_seconds_count{job="OrderMetrics"}[1h]))
        ) > (14.4 * 0.001)
        and
        (
          sum(rate(http_server_requests_seconds_count{job="OrderMetrics", status=~"5.."}[5m]))
          /
          sum(rate(http_server_requests_seconds_count{job="OrderMetrics"}[5m]))
        ) > (14.4 * 0.001)
      labels:
        severity: page
    ```

    O page lento (6 h e 30 min acima de 6) e o ticket (3 dias e 6 h acima de 1) são mais duas regras com a mesma forma. O alerta dispara por um *sintoma que os usuários sentem* (erros consumindo o orçamento), não por uma causa como CPU — veja alertas na aula de [Observabilidade](../../observability/index.md).

O simulador roda os quatro incidentes desta página — o deploy ruim, uma falha parcial, um vazamento lento e um soluço curto — contra as três regras e contra uma primeira tentativa comum com uma única janela (1 hora acima de 14,4, `for: 2m`).

<div class="csim" data-sim="error-budget-burn" data-scenario="deploy"></div>

!!! tip "Experimente"
    O **deploy ruim** (48% de erros por uma hora: as 20.000 requisições com falha da página) queima a **480×** e gasta **71%** do orçamento de 28 dias. A regra de 1 h / 5 min aciona depois de **2 min** e silencia **4 min** depois que o deploy é revertido; a regra de janela única aciona depois de **4 min** e continua acionando por **58 min** depois do fim. Escolha a **falha parcial** (2% por 6 horas, 20×): o page vem depois de **44 min** e a falha gasta **18%** do orçamento. O **vazamento lento** (0,3% por 3 dias, 3×) nunca aciona o plantão, mas gasta **32%**: só o ticket o pega, depois de **22,4 h**. O **soluço curto** (10% por 5 minutos) não dispara nada e custa **1,2%** — absorvê-lo é para isso que o orçamento existe.

---

## SLA — O compromisso contratual

Um SLA é um **acordo formal entre o provedor do serviço e o cliente** que define o nível de serviço esperado e as compensações (normalmente créditos de serviço) caso esse nível não seja atingido. SLAs são documentos jurídicos; descumpri-los tem consequências financeiras.

### Estrutura de um SLA

1. **Serviços cobertos** — quais produtos e regiões estão no escopo
2. **Metas de SLO** — os compromissos de disponibilidade ou de latência
3. **Metodologia de medição** — como o uptime é calculado, quais incidentes contam
4. **Exclusões** — manutenção programada, força maior, indisponibilidades causadas pelo cliente
5. **Compensações** — tabela de créditos de serviço para cada faixa de violação

### Exemplos reais de SLA

Os compromissos abaixo foram retirados das páginas públicas de SLA dos provedores[^3][^4]; as condições exatas (tipo de implantação, região, faixas de crédito) mudam com o tempo, então sempre leia a página atual.

| Provedor | Serviço | Uptime mensal comprometido | Compensação por violação |
|---|---|---|---|
| AWS | EC2 (nível de região) | 99,99% | Créditos de serviço por faixa |
| AWS | S3 Standard | 99,9% | Créditos de serviço por faixa |
| AWS | RDS Multi-AZ | 99,95% | Créditos de serviço por faixa |
| Google Cloud | Compute Engine (instâncias em várias zonas) | 99,99% | Créditos de serviço por faixa |
| Azure | Virtual Machines (em várias Availability Zones) | 99,99% | Créditos de serviço por faixa |

Repare em duas coisas. Primeiro, os números mais altos só valem quando *você* implanta de forma redundante (várias zonas, Multi-AZ) — a redundância é o preço do nove extra. Segundo, a compensação é um crédito na sua fatura, não uma indenização pelas suas vendas perdidas: um SLA transfere parte do risco financeiro, mas não torna o seu sistema disponível.

### SLA vs SLO

SLA e SLO são frequentemente confundidos. A distinção crucial:

| | SLO | SLA |
|---|---|---|
| **Público** | Equipe de engenharia | Cliente / negócio |
| **Natureza** | Meta interna | Contrato jurídico |
| **Rigor** | Maior (mais estrito) | Menor (mais tolerante) |
| **Consequência da violação** | Trabalho de confiabilidade, congelamento de funcionalidades | Créditos de serviço, multas |

> **Boa prática**: defina seu SLO *mais estrito* do que seu SLA. A folga entre SLO e SLA é a margem de segurança que impede que um incidente de confiabilidade dispare penalidades contratuais. Se o SLA é 99,9%, o SLO pode ser 99,95%.

---

## Boas práticas

| Prática | Justificativa |
|---|---|
| **Menos SLIs, mais significativos** | Dois ou três indicadores bem escolhidos superam dez ruidosos. Comece por disponibilidade e latência P99. |
| **Janelas móveis de 28 dias** | Quatro semanas sempre contêm o mesmo número de dias úteis e de fins de semana, então o SLI não é distorcido por meses de calendário de tamanhos diferentes. |
| **Automatize os dashboards de SLO** | O cálculo manual é sujeito a erros e lento demais. Grafana + Prometheus ou o Cloud Monitoring devem mostrar a conformidade atual com o SLO em tempo real. |
| **Revise os SLOs a cada trimestre** | As expectativas dos usuários e as capacidades do sistema evoluem. SLOs corretos no lançamento podem precisar de ajuste após um ano de crescimento. |
| **Nunca defina SLO = 100%** | 100% é inalcançável e não deixa espaço para manutenção planejada nem para deploys seguros. |

!!! warning "Armadilhas comuns"

    - **Medir a coisa errada**: um SLI calculado só a partir do endpoint de health check não diz nada sobre `POST /orders`.
    - **Médias em vez de percentis**: uma latência média de 80 ms pode esconder 5% dos usuários esperando 4 s. Use percentis ou "fração das requisições mais rápidas que X".
    - **Misturar janelas**: um error budget calculado em 30 dias comparado com um SLO em 28 dias leva a decisões erradas.
    - **Uma única janela longa no alerta**: uma regra de 1 hora continua acionando durante boa parte da hora seguinte à correção; combine-a com uma janela curta.
    - **SLO sem política**: se nada muda quando o orçamento acaba, o SLO é só um número em um dashboard.

---

## Pontos-chave

- Um **SLI** é a razão entre eventos bons e eventos válidos que reflete o que os usuários sentem; um **SLO** é uma meta para ele em uma janela; um **SLA** é um contrato com penalidades, mais frouxo que o SLO.
- O **error budget** é 1 − SLO, em tempo ou em requisições: 99,9% em 28 dias ≈ 40,3 minutos (≈ 43,8 minutos em um mês de 30,44 dias).
- **Burn rate** = taxa de erros observada ÷ orçamento; 14,4× esvazia um orçamento de 28 dias em cerca de 2 dias. Acione o plantão quando **ambas** as janelas, uma longa e uma curta, queimam rápido (1 h e 5 min acima de 14,4; 6 h e 30 min acima de 6) e abra um ticket para uma queima lenta (3 dias e 6 h acima de 1).
- O orçamento transforma "lançar ou congelar?" em uma decisão baseada em dados — se houver uma política acordada.
- Sempre informe a **janela** e use **percentis**, nunca médias, para latência.

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016. Capítulos 3–4 (Embracing Risk; Service Level Objectives).
[^2]: BEYER, B. et al. [The Site Reliability Workbook](https://sre.google/workbook/table-of-contents/){target="_blank"}. Google / O'Reilly, 2018. Capítulo 2 — Implementing SLOs; Capítulo 5 — Alerting on SLOs.
[^3]: [AWS Service Level Agreements](https://aws.amazon.com/legal/service-level-agreements/){target="_blank"}. Amazon Web Services.
[^4]: [Google Cloud Service Level Agreements](https://cloud.google.com/terms/sla){target="_blank"}. Google LLC.
