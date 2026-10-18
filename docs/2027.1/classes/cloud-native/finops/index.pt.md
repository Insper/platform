Chega a primeira fatura real do ambiente de produção do BoxOffice, e ela é três vezes a estimativa. Ninguém sabe explicar por quê: os custos estão espalhados em quarenta itens, metade deles com nomes como `USE1-NatGateway-Bytes` e `DataTransfer-Regional-Bytes`, e nenhum recurso tem uma tag com o serviço que o criou. Na nuvem, **toda decisão de arquitetura é também uma decisão de compra** — e a fatura é a única métrica que todo executivo lê.

**FinOps** (operações financeiras de nuvem) é a prática de trazer responsabilidade financeira ao modelo de gastos variáveis da nuvem, para que engenharia, finanças e negócio façam juntos os trade-offs entre velocidade, custo e qualidade[^1]. Para quem projeta sistemas, isso se resume a três habilidades: **estimar** quanto uma arquitetura vai custar, **atribuir** quanto ela de fato custa e **otimizar** sem quebrar os SLOs[^2].

---

## O ciclo de vida de FinOps

A FinOps Foundation organiza a prática em três fases que se repetem continuamente[^1]:

``` mermaid-sim
flowchart LR
    inform["Informar<br/>visibilidade: tags, alocação,<br/>showback, custos unitários"] --> optimize["Otimizar<br/>rightsizing, compromissos,<br/>spot, mudanças de arquitetura"]
    optimize --> operate["Operar<br/>orçamentos, alertas de anomalia,<br/>políticas, revisões"]
    operate --> inform
```

- **Informar** — não dá para otimizar o que não se vê. Todo recurso leva tags (`project`, `env`, `service`, `team`); os custos do Kubernetes são divididos por namespace e label a partir dos **requests de recursos** dos pods (ferramentas como o projeto da CNCF OpenCost[^4], ou o Kubecost). O resultado é o **showback** (os times veem seus custos) ou o **chargeback** (os times são cobrados internamente).
- **Otimizar** — reduzir desperdício (recursos ociosos e superdimensionados) e pagar menos por unidade (compromissos, spot, arquiteturas mais baratas).
- **Operar** — orçamentos com alertas, detecção de anomalias no gasto diário, políticas (nenhum recurso sem tag, nada de instâncias com GPU em dev) e uma revisão mensal de custos ao lado da revisão de SLOs.

---

## Anatomia de uma fatura de nuvem

| Tipo de custo | Cobrado por | Exemplos no BoxOffice | Atenção a |
|---|---|---|---|
| **Computação** | vCPU-hora e GB-hora (VMs, containers), ou requisição + GB-segundo (FaaS) | Nós do Kubernetes, miniaturas no Lambda | Réplicas ociosas, requests superdimensionados |
| **Serviços gerenciados** | Hora de instância + armazenamento + I/O | PostgreSQL, Redis, Kafka | Multi-AZ dobra a instância; réplicas se somam |
| **Armazenamento** | GB-mês, mais requisições | PDFs de ingressos no S3, volumes de banco, snapshots | Snapshots e logs guardados para sempre |
| **Transferência de dados** | GB movido | Saída da CDN para os fãs, tráfego entre AZs entre serviços, processamento no NAT | Saída para a internet e tráfego **entre AZs** são cobrados; a entrada geralmente não |
| **Itens fixos por hora** | Hora, com ou sem uso | Control plane do Kubernetes, load balancers, NAT gateways, endereços IPv4 públicos | Dominam ambientes pequenos e de não produção |
| **Observabilidade** | GB ingerido, retido, consultado; séries ativas | Logs, métricas, traces | Métricas de alta cardinalidade e logs de debug em produção |
| **SaaS de terceiros** | Por transação ou por assento | Taxas de pagamento (uma porcentagem do preço do ingresso), e-mail por milhar | Frequentemente maior que toda a infraestrutura — mas é um custo do negócio |

### Modelos de preço

| Modelo | Desconto vs on-demand | Compromisso | Bom para |
|---|---|---|---|
| **On-demand** | — | Nenhum | Cargas em rajadas e desconhecidas; o preço de referência |
| **Compromissos** (AWS Savings Plans / Reserved Instances, descontos por uso comprometido no GCP, reservas no Azure) | Substancial (frequentemente dezenas de por cento) por 1 ou 3 anos | Pagar por uma base, usando-a ou não | A **base** constante: os 6 nós sempre ligados, os bancos |
| **Spot / preemptível** | Grande, variável | Nenhum, mas o provedor pode retomar a capacidade com pouco aviso (dois minutos na AWS) | Trabalho sem estado e interrompível: workers, batch, runners de CI, parte da frota sem estado |
| **Serverless / por requisição** | — | Nenhum | Tráfego baixo ou com rajadas muito fortes; escala a zero |

O portfólio usual é **compromisso para o piso, on-demand para a onda diária, spot para a parte interrompível** — o que só funciona se você conhece a sua base, ou seja, depois da fase *Informar*.

---

## Um modelo de custo do BoxOffice { #cost-model }

O modelo abaixo estima a fatura mensal da arquitetura de produção projetada neste curso. Cada número é uma **premissa** que você pode mudar — esse é o objetivo de um modelo: tornar explícitos os fatores de custo e permitir perguntar "e se?". Os preços são preços de tabela on-demand aproximados da AWS `us-east-1`; confirme-os na calculadora do provedor antes de citá-los e lembre-se de que outras regiões (incluindo `sa-east-1`, São Paulo) são mais caras.

!!! info "Premissas"

    - Só produção (os ambientes de staging e de teste de carga são extras), rodando 24/7 (730 h por mês).
    - Regime normal: 6 nós de trabalho executam todos os serviços. **Quatro vendas por mês**, cada uma precisando de 24 nós extras por 2 horas.
    - Não incluídos: taxas do provedor de pagamento, impostos, planos de suporte, free tiers e descontos, transferência entre AZs entre serviços.

```python exec="1" html="1"
# BoxOffice monthly cost model. Approximate on-demand list prices in USD,
# AWS us-east-1, used as ILLUSTRATIVE assumptions: re-check them in the
# AWS Pricing Calculator before quoting any number.
import matplotlib.pyplot as plt
from io import StringIO

H = 730                       # hours in a billing month
ONSALES, PEAK_H = 4, 2        # 4 on-sales per month, 2 peak hours each
PEAK_HOURS = ONSALES * PEAK_H

P = {
    "eks_h": 0.10,            # EKS control plane per cluster-hour
    "node_h": 0.192,          # m6i.xlarge (4 vCPU, 16 GiB) on-demand
    "rds_h": 0.225,           # db.r6g.large PostgreSQL, single-AZ
    "rds_gb": 0.115,          # gp3 storage per GB-month (per copy)
    "redis_h": 0.206,         # cache.r6g.large
    "msk_h": 0.21,            # kafka.m5.large broker
    "msk_gb": 0.10,           # broker storage per GB-month
    "alb_h": 0.0225, "lcu_h": 0.008,
    "nat_h": 0.045, "nat_gb": 0.045,
    "s3_gb": 0.023,
    "cdn_gb": 0.085,          # CDN egress, first price tier
    "logs_gb": 0.50,          # log ingestion per GB
    "lambda_req": 0.20 / 1e6, "lambda_gbs": 0.0000166667,
    "email_1k": 0.10,
}

# (component, palette id, sizing, steady $/month, extra $/month for the on-sales)
ROWS = [
    ("Kubernetes control plane", "—", "1 cluster", P["eks_h"] * H, 0),
    ("Worker nodes (services)", "app", "6 × m6i.xlarge, +24 at peak", 6 * P["node_h"] * H,
     24 * P["node_h"] * PEAK_HOURS),
    ("PostgreSQL primary, Multi-AZ", "sql", "db.r6g.large ×2 + 2 × 200 GB",
     2 * P["rds_h"] * H + 2 * 200 * P["rds_gb"], 0),
    ("PostgreSQL read replica", "sql", "db.r6g.large + 200 GB", P["rds_h"] * H + 200 * P["rds_gb"], 0),
    ("Redis (primary + replica)", "cache", "2 × cache.r6g.large", 2 * P["redis_h"] * H, 0),
    ("Kafka (managed)", "kafka", "3 brokers + 3 × 500 GB", 3 * P["msk_h"] * H + 1500 * P["msk_gb"], 0),
    ("Load balancer", "lb", "1 ALB, ~5 LCU (×20 at peak)", (P["alb_h"] + 5 * P["lcu_h"]) * H,
     95 * P["lcu_h"] * PEAK_HOURS),
    ("NAT gateways", "nat", "3 AZs + 2 TB processed", 3 * P["nat_h"] * H + 2000 * P["nat_gb"], 0),
    ("Object storage", "objstore", "500 GB tickets and images", 500 * P["s3_gb"], 0),
    ("CDN egress", "cdn", "20 TB/month", 20000 * P["cdn_gb"], 0),
    ("Logs ingestion", "logs", "1 TB/month", 1000 * P["logs_gb"], 0),
    ("Serverless thumbnails", "serverless", "2 M runs × 0.5 s × 1 GB",
     2e6 * P["lambda_req"] + 2e6 * 0.5 * 1 * P["lambda_gbs"], 0),
    ("Transactional e-mail", "email", "1.5 M e-mails", 1500 * P["email_1k"], 0),
]

total_steady = sum(r[3] for r in ROWS)
total = sum(r[3] + r[4] for r in ROWS)
rows = "".join(
    f"<tr><td>{name}</td><td><code>{pid}</code></td><td>{size}</td>"
    f"<td style='text-align:right'>${s:,.0f}</td><td style='text-align:right'>${p:,.0f}</td>"
    f"<td style='text-align:right'>{(s + p) / total:.0%}</td></tr>"
    for name, pid, size, s, p in ROWS)
print("<table><thead><tr><th>Component</th><th>Palette</th><th>Sizing (assumption)</th>"
      "<th>Steady $/month</th><th>On-sale extra</th><th>Share</th></tr></thead><tbody>"
      f"{rows}<tr><td><strong>Total</strong></td><td></td><td></td>"
      f"<td style='text-align:right'><strong>${total_steady:,.0f}</strong></td>"
      f"<td style='text-align:right'><strong>${total - total_steady:,.0f}</strong></td>"
      "<td style='text-align:right'><strong>100%</strong></td></tr></tbody></table>")

peak_24_7 = 30 * P["node_h"] * H - 6 * P["node_h"] * H
TICKETS = 400_000             # tickets sold per month (assumption)
print(f"<p><strong>Total ≈ ${total:,.0f}/month.</strong> The four on-sales add only "
      f"${total - total_steady:,.0f} because the 24 extra nodes exist for {PEAK_HOURS} hours; "
      f"keeping them 24/7 'just in case' would add ≈ ${peak_24_7:,.0f}/month. "
      f"At {TICKETS:,} tickets per month the platform costs ≈ ${total / TICKETS:.3f} per ticket sold.</p>")

order = sorted(ROWS, key=lambda r: r[3] + r[4])
fig, ax = plt.subplots(figsize=(10, 5))
ax.barh([r[0] for r in order], [r[3] for r in order], color="#4C9BE8", label="steady")
ax.barh([r[0] for r in order], [r[4] for r in order], left=[r[3] for r in order],
        color="#F28E2B", label="on-sale extra")
for i, r in enumerate(order):
    ax.text(r[3] + r[4] + 15, i, f"${r[3] + r[4]:,.0f}", va="center", fontsize=8, color="gray")
ax.set_xlabel("USD per month (approx., us-east-1 list prices)", color="gray")
ax.set_title("BoxOffice: where the money goes", fontweight="bold", color="gray")
ax.tick_params(colors="gray", labelsize=8)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, labelcolor="gray", loc="lower right")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

### Lendo o modelo

- **O pico é barato; a base não.** A capacidade elástica para as vendas custa quase nada, porque existe por oito horas. Provisionar para o pico de forma permanente custaria mais que todo o resto da conta de computação. Esse é o argumento econômico para autoscaling, pré-escala e salas de espera ([Planejamento de capacidade](../../performance/capacity-planning/index.md)).
- **Serviços de dados dominam a computação.** PostgreSQL, Redis e Kafka juntos custam mais que os nós que executam nove serviços. Antes de adicionar um quarto armazenamento de dados, pergunte se um dos existentes não resolve.
- **Bytes custam mais que CPUs.** A saída da CDN e a ingestão de logs estão entre os maiores itens. Compressão de imagens, tempos de cache mais longos, amostragem de logs de debug e retenção menor mudam a conta mais do que otimizar Java.
- **Economia unitária** transforma a fatura em uma métrica de negócio: *custo por ingresso vendido* (ou por 1 000 requisições, por usuário ativo). Uma conta que dobra enquanto os ingressos triplicam é uma boa notícia; uma conta que cresce com os ingressos estáveis é uma regressão — acompanhe-a como uma regressão de desempenho.

### Pagar por requisição ou por hora?

Quando FaaS é mais barato que containers sempre ligados? O gráfico compara uma função (100 ms por requisição com 512 MB, atrás de uma porta de entrada HTTP API) com um mínimo de duas pequenas tarefas de container atrás de um load balancer, cada uma atendendo 50 requisições por segundo:

```python exec="1" html="1"
# Serverless (pay per request) vs always-on containers (pay per hour).
# Approximate us-east-1 list prices; workload numbers are assumptions.
import math
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

SECONDS = 730 * 3600                       # seconds in a billing month
# FaaS: 100 ms per request at 512 MB, plus an HTTP API front door
faas_per_req = 0.20e-6 + 0.100 * 0.5 * 0.0000166667 + 1.00e-6
# Containers: 0.5 vCPU / 1 GB tasks; each one serves 50 req/s at the target utilization
task_month = (0.5 * 0.04048 + 1.0 * 0.004445) * 730
alb_month = (0.0225 + 0.008) * 730
RPS_PER_TASK, MIN_TASKS = 50, 2

rps = np.linspace(0.1, 60, 600)
faas = rps * SECONDS * faas_per_req
containers = np.array([max(MIN_TASKS, math.ceil(r / RPS_PER_TASK)) * task_month + alb_month for r in rps])
cross = rps[np.argmax(faas > containers)]

fig, ax = plt.subplots(figsize=(10, 4.5))
ax.plot(rps, faas, color="#F28E2B", linewidth=2, label="FaaS + HTTP API (per request)")
ax.step(rps, containers, color="#4C9BE8", linewidth=2, where="post",
        label=f"containers: ≥ {MIN_TASKS} tasks + load balancer (per hour)")
ax.axvline(cross, color="gray", linestyle="--", linewidth=0.8)
ax.text(cross + 0.8, faas.max() * 0.85, f"break-even ≈ {cross:.0f} req/s average", color="gray", fontsize=9)
ax.set_xlabel("average requests per second over the month", color="gray")
ax.set_ylabel("USD per month (approx.)", color="gray")
ax.set_title("Pay per request vs pay per hour", fontweight="bold", color="gray")
ax.tick_params(colors="gray")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, labelcolor="gray")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Abaixo de aproximadamente dez requisições por segundo *em média*, pagar por requisição vence — containers ociosos são puro desperdício. Acima disso, o adicional por requisição se acumula e containers sempre ligados vencem, ainda mais com compromissos. Tráfego em rajadas muda o quadro: o que importa é a **média**, enquanto os containers precisam ser dimensionados para o **pico** (ou escalar automaticamente). É por isso que o BoxOffice roda o gerador de miniaturas e os receptores de webhook como funções, e o caminho de compra em containers.

---

## Alavancas de otimização { #optimization-levers }

As alavancas abaixo seguem as práticas de otimização de custo dos frameworks well-architected dos provedores de nuvem[^3]. Cada uma economiza dinheiro e cada uma, exceto a última, pode prejudicar um SLO se aplicada às cegas.

| Alavanca | O que fazer | Efeito típico | Risco para os SLOs |
|---|---|---|---|
| **Rightsizing** | Definir os requests a partir do uso medido (ex.: p95 de CPU e máximo de memória em duas semanas), não de palpites | Menos nós para os mesmos pods | Apertado demais → throttling e `OOMKilled`; rode o teste de carga de novo |
| **Autoscaling e escala a zero** | HPA + autoscaling de nós; escala a zero com KEDA para workers; desligar o staging à noite e nos fins de semana | Horas de não produção: 730 → ~250 por mês | Cold starts; atraso de escala nos picos |
| **Compromissos** | Cobrir a base medida com compromissos de 1 ano | Preço unitário menor no piso | Pagar por compromisso não usado se a arquitetura mudar |
| **Capacidade spot** | Rodar workers, CI e uma parte das réplicas sem estado em spot, espalhadas por tipos de instância | Grande desconto nessa parte | Interrupções: exige encerramento gracioso, PDBs, fallback on-demand |
| **Instâncias ARM** | Nós Graviton/Axion/Ampere para serviços JVM e Python (imagens multi-arquitetura) | Preço menor por vCPU com desempenho semelhante em muitas cargas | Verifique com um benchmark; bibliotecas nativas precisam existir para ARM |
| **Reduzir transferência de dados** | CDN com TTLs longos; manter serviços conversadores na mesma AZ; VPC endpoints para S3/ECR em vez de NAT | Menos saída e menos processamento no NAT | Afinidade de zona reduz o espalhamento |
| **Ciclo de vida do armazenamento** | Mover PDFs antigos de ingressos para camadas de acesso infrequente/arquivo; expirar snapshots | Menos GB-mês | Recuperação mais lenta e cobrada |
| **Higiene de observabilidade** | Amostrar traces, cortar logs de debug em produção, limitar a cardinalidade das métricas, retenção menor | Conta de ingestão menor | Menos detalhe na depuração — mantenha exemplars e traces de erro |
| **Apagar recursos ociosos** | Volumes soltos, load balancers antigos, clusters de teste esquecidos | Economia pura | Nenhum |

!!! warning "Custo e confiabilidade puxam em direções opostas"

    Multi-AZ dobra o custo do banco; uma segunda região praticamente dobra tudo. Isso não é desperdício — compra disponibilidade. FinOps não é "gastar menos", é "**saber o que cada real compra**". Escreva o trade-off no documento de design: "PostgreSQL Multi-AZ custa US$ 187/mês a mais e transforma a falha de uma zona de uma indisponibilidade de várias horas em um failover de um minuto."

---

## Estimando em uma entrevista de system design

Entrevistadores raramente querem dólares, mas consciência de custo é um sinal forte. Um hábito de três passos basta:

1. **Nomeie os fatores de custo**: "O custo é dominado pela saída de imagens (CDN), pela camada de dados e pela computação de pico."
2. **Ordem de grandeza** a partir da sua estimativa de capacidade: "30 nós por 8 horas por mês é barato; 30 nós por 730 horas não é — então fazemos autoscaling e pré-escala."
3. **Uma otimização com seu trade-off**: "Spot para os workers, porque são idempotentes e fazem retry; nunca para o banco primário."

!!! tip "Na entrevista"

    Perguntas de custo costumam vir disfarçadas: "Precisamos mesmo de Kafka aqui?", "Por que três réplicas?", "Isso poderia ser serverless?". Responda com **utilização e razão pico/média**: capacidade sempre ligada é mais barata quando está ocupada; preço por requisição é mais barato quando o tráfego é baixo ou muito em rajadas. Mencione que **transferência de dados** e **armazenamentos de dados gerenciados** costumam dominar antes da computação.

!!! warning "Armadilhas"

    - **Sem tags**: custos que não podem ser atribuídos não podem ter dono nem ser otimizados.
    - **Estimar só a computação**: os itens fixos por hora, a transferência de dados e a observabilidade são de onde vêm as surpresas.
    - **Rightsizing sem teste de carga**: a economia aparece na fatura; o throttling aparece no p99 do próximo pico.
    - **Compromissos antes de medir a base**: travar capacidade para uma arquitetura que você está prestes a mudar.
    - **Ambientes de não produção ligados 24/7**: frequentemente uma grande fatia da conta total.
    - **Otimizar centavos enquanto o NAT gateway processa terabytes**: ordene por custo antes de otimizar.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    BILL["a fatura: compute, serviços gerenciados,<br/>armazenamento, transferência, itens fixos"] --> INF["Informar: tags,<br/>custo por requests dos pods"]
    INF --> OPT["Otimizar: rightsizing,<br/>compromissos, spot, ARM"]
    OPT --> OPS["Operar: orçamentos,<br/>anomalias, revisão mensal"]
    BASE["base vs pico<br/>→ autoscaling, pré-escala"] --> OPT
    FAAS["por requisição vs por hora<br/>→ equilíbrio do serverless"] --> OPT
    UNIT["unit economics:<br/>custo por ingresso vendido"] --> OPS
    OPT --> SLO["toda alavanca pode ferir um SLO<br/>→ Confiabilidade"]
    OPT --> LT["rode o teste de carga de novo<br/>→ Performance"]
    BILL --> MAZ["Multi-AZ, segunda região:<br/>custo que compra disponibilidade"]
    BILL --> OBS["fatura de observabilidade:<br/>cardinalidade, retenção"]
```

**Componentes da paleta:** [`sql`](../../../reference/components/storage/index.md#sql) · [`cache`](../../../reference/components/storage/index.md#cache) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (a camada de dados domina o compute) · [`cdn`](../../../reference/components/edge/index.md#cdn) (egress) · [`nat`](../../../reference/components/network/index.md#nat) (fixo por hora + por GB processado) · [`objstore`](../../../reference/components/storage/index.md#objstore) (camadas de ciclo de vida) · [`logs`](../../../reference/components/observability/index.md#logs) (ingestão) · [`serverless`](../../../reference/components/compute/index.md#serverless) · [`worker`](../../../reference/components/compute/index.md#worker) (candidatos a spot) · [`payment`](../../../reference/components/external/index.md#payment) (taxas, um custo do negócio). **Cenários:** `serverless-burst`, `multi-region` (quanto custa uma segunda região). **Continua em:** [Compute — containers ou serverless](../../compute/serverless-autoscaling/index.md), [Performance — planejamento de capacidade](../../performance/capacity-planning/index.md), [Confiabilidade — recuperação de desastres](../../reliability/disaster-recovery/index.md), [Redes e segurança — a rede na nuvem](../../network-security/cloud-network/index.md) (NAT gateways), [Observabilidade — sinais](../../observability/signals/index.md) (cardinalidade), [Projeto — relatório de custos](../../../exercises/project/cost-report/index.md).

---

[^1]: FinOps Foundation. [FinOps Framework](https://www.finops.org/framework/){target="_blank"}.
[^2]: STORMENT, J. R.; FULLER, M. *Cloud FinOps*. 2nd ed. O'Reilly, 2023.
[^3]: AWS. [Well-Architected Framework — Cost Optimization Pillar](https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html){target="_blank"}.
[^4]: OpenCost. [Open source cost monitoring for cloud-native environments](https://www.opencost.io/){target="_blank"} (projeto da CNCF).
