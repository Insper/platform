Medir a confiabilidade exige um vocabulário comum que ligue a telemetria bruta às decisões de engenharia e aos compromissos com os clientes. A prática de Site Reliability Engineering do Google introduziu um modelo de três camadas com esse objetivo[^1], hoje padrão na indústria.

| Termo | Nome completo | Natureza |
|---|---|---|
| **SLI** | Service Level Indicator | Uma métrica mensurável |
| **SLO** | Service Level Objective | Uma meta interna para essa métrica |
| **SLA** | Service Level Agreement | Um compromisso contratual com os clientes |

``` mermaid
flowchart LR
    telemetry["Telemetria\n(logs, métricas, traces)"]
    sli["SLI\nMedição bruta"]
    slo["SLO\nMeta interna"]
    sla["SLA\nContrato externo"]
    budget["Error Budget\nAlavanca de engenharia"]

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

### Categorias canônicas de SLI

| Categoria | O que mede | Exemplo de medição |
|---|---|---|
| **Disponibilidade** | Fração das requisições atendidas com sucesso | `HTTP 2xx or 3xx / total HTTP requests` |
| **Latência** | Tempo para atender uma requisição | `95th percentile request duration < 200 ms` |
| **Taxa de erros** | Fração das requisições que resultam em erro | `HTTP 5xx / total HTTP requests` |
| **Vazão** | Volume de trabalho que o sistema processa | `Requests per second` |
| **Durabilidade** | Fração dos dados que podem ser recuperados | `Successful reads / total attempted reads` |
| **Atualidade** | Idade da escrita bem-sucedida mais recente | `Time since last successful cache refresh` |

!!! warning "Evite métricas de vaidade"
    Utilização de CPU, tamanho do heap da JVM e tempo de pausa do garbage collector **não** são bons SLIs por si sós. Um serviço pode estar com 95% de CPU e ainda assim atender todas as requisições corretamente — e, ao contrário, um serviço pode estar com 10% de CPU e completamente fora do ar. SLIs devem refletir o que o usuário experimenta, não o que a infraestrutura experimenta.

### Como os SLIs são coletados

- **Instrumentação na aplicação**: contadores de requisições e histogramas de latência exportados via Spring Boot Actuator / Micrometer.
- **Monitoramento sintético**: sondas que enviam requisições reais de fora do sistema, em intervalos programados (por exemplo, o Prometheus Blackbox Exporter).
- **Baseado em logs**: análise dos logs de acesso para contar respostas 2xx vs 5xx.
- **No cliente**: medição a partir do navegador ou do app móvel, para a experiência real do usuário final.

---

## SLO — A meta com que você se compromete

Um SLO é uma **meta específica e delimitada no tempo para um SLI**. Ele responde: *"Quão boa esta métrica precisa ser para considerarmos o serviço saudável?"*

**Formato:**

> `SLI ≥ limite` em uma `janela móvel`

**Exemplos:**

| SLO | Significado |
|---|---|
| `Disponibilidade ≥ 99,9%` em 28 dias | No máximo 0,1% das requisições pode falhar em qualquer período de 28 dias |
| `Latência P95 ≤ 200 ms` em 7 dias | 95% das requisições terminam em até 200 ms em qualquer janela de 7 dias |
| `Taxa de erros ≤ 0,5%` em 24 horas | No máximo 5 em cada 1000 requisições retornam 5xx em qualquer dia |

### Escolhendo o SLO certo

SLOs devem ser **ambiciosos, mas alcançáveis**. Um SLO que nunca é violado não está impulsionando trabalho de confiabilidade — está frouxo demais. Um SLO violado o tempo todo é ruído — a equipe deixa de confiar nele.

- Comece medindo o SLI atual por 30–90 dias.
- Defina o SLO inicial no patamar observado menos uma pequena margem.
- Aperte-o com o tempo, à medida que o sistema melhora.
- Torne os SLOs públicos dentro da organização de engenharia, para que todas as equipes entendam as metas que estão perseguindo.

---

## Error Budget

O error budget (orçamento de erros) é a quantidade de não confiabilidade que o SLO permite. É a **licença para assumir riscos** da equipe de engenharia.

$$
\text{Error Budget} = 1 - \text{SLO target}
$$

Para um SLO de disponibilidade de 99,9% em 28 dias:

$$
\text{Error Budget} = 0.1\% \times 28 \text{ days} \times 24 \text{ h} \times 60 \text{ min} \approx 43.8 \text{ minutes}
$$

Se o error budget está **intacto**, a equipe pode:

- Fazer deploys com frequência e aceitar algum risco de deploy
- Executar experimentos em sistemas de produção
- Assumir mais dívida técnica

Se o error budget está **esgotado**, a equipe deve:

- Congelar deploys não essenciais
- Priorizar o trabalho de confiabilidade em vez de novas funcionalidades
- Investigar e corrigir as causas-raiz que estão consumindo o orçamento

!!! tip "O error budget como ferramenta de negociação"
    Quando um gerente de produto quer lançar uma funcionalidade arriscada e a equipe de SRE está relutante, o error budget dá uma resposta objetiva: *"Temos 12 minutos de orçamento restantes neste mês. Se fizermos o deploy e ele causar 30 minutos de degradação, vamos violar nosso SLO. Vamos esperar até o orçamento ser renovado no mês que vem."*

### Burn rate

A burn rate (taxa de consumo) mede a velocidade com que o error budget está sendo consumido em relação à janela do SLO. Uma burn rate de 1 significa que o orçamento se esgota exatamente no fim da janela. Uma burn rate de 2 significa que o orçamento acaba na metade da janela.

| Burn rate | Orçamento esgotado em | Severidade |
|---|---|---|
| 1× | Fim da janela do SLO (28 dias) | Normal |
| 2× | 14 dias | Aviso |
| 6× | ~5 dias | Alta |
| 14,4× | ~48 horas | Crítica — acionar o plantão imediatamente |

Alertas de burn rate alta pegam cedo os incidentes rápidos, enquanto alertas de burn rate baixa pegam degradações lentas que, de outra forma, seriam invisíveis[^2].

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

| Provedor | Serviço | Uptime comprometido | Crédito por violação |
|---|---|---|---|
| AWS | EC2 | 99,99% mensal | 10–30% das cobranças afetadas |
| AWS | S3 | 99,9% mensal | 10–25% das cobranças afetadas |
| AWS | RDS Multi-AZ | 99,95% mensal | 10–100% das cobranças afetadas |
| Google Cloud | GCE | 99,99% mensal | 10–50% das cobranças |
| Google Cloud | Cloud Storage | 99,9% mensal | 10–25% das cobranças |
| Azure | Virtual Machines (2+ instâncias) | 99,99% mensal | 10–25% das cobranças mensais |

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
| **Janelas móveis de 28 dias** | Janelas mensais suavizam a variação entre dias úteis e fins de semana e coincidem com a maioria dos ciclos de faturamento. |
| **Automatize os dashboards de SLO** | O cálculo manual é sujeito a erros e lento demais. Grafana + Prometheus ou o Cloud Monitoring devem mostrar a conformidade atual com o SLO em tempo real. |
| **Revise os SLOs a cada trimestre** | As expectativas dos usuários e as capacidades do sistema evoluem. SLOs corretos no lançamento podem precisar de ajuste após um ano de crescimento. |
| **Nunca defina SLO = 100%** | 100% é inalcançável e não deixa espaço para manutenção planejada nem para deploys seguros. |

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016. Capítulos 4–5.
[^2]: MURPHY, N. et al. [The Site Reliability Workbook](https://sre.google/workbook/table-of-contents/){target="_blank"}. Google / O'Reilly, 2018. Capítulo 5 — Alerting on SLOs.
[^3]: [AWS Service Level Agreements](https://aws.amazon.com/legal/service-level-agreements/){target="_blank"}. Amazon Web Services.
[^4]: [Google Cloud Service Level Agreements](https://cloud.google.com/terms/sla){target="_blank"}. Google LLC.
