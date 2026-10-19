Toda decisão de design tem uma etiqueta de preço. Um cache que economiza 90% das leituras no banco, uma CDN que absorve a venda, três zonas de disponibilidade em vez de uma, um agente que chama o LLM cinco vezes por pergunta — cada um aparece na fatura do mês. No mundo real, "escala" é só metade da resposta; a outra metade é **"e custa US$ X por mês, ou US$ Y por ingresso vendido"**. O Marco 8 pede que o seu time precifique o design com honestidade, ligue o custo às medições da campanha de testes de carga e diga onde o dinheiro seria mais bem gasto.

!!! abstract "Metas"

    Com este marco o seu time vai:

    - **Estimar** o custo mensal do design na **meta de design** em uma nuvem, com uma calculadora de preços oficial.
    - **Calcular** a economia unitária (custo por 1.000 requisições e por unidade de negócio: ingresso, mensagem, corrida, visualização, conversa).
    - **Informar** o custo do ambiente realmente usado.
    - **Analisar** a sensibilidade (×10 de tráfego, pico vs média, compromissos e spot) e comparar **modelos de serviço** (IaaS, PaaS, SaaS, serverless) para pelo menos um componente.
    - **Propor** alavancas de economia apoiadas nas suas próprias medições.

Este marco se apoia na parte de FinOps da [Aula 12 — Cloud-native](../../../classes/cloud-native/index.md), nas suas estimativas do M1 e na [campanha de testes de carga](../load-test-campaign/index.md). Entrega na **semana 18**, peso de **10%** do projeto.

## O que entregar

- Uma página de **relatório de custos** na documentação, seguindo o [template](#templates).
- A **exportação da calculadora** (link compartilhável, PDF ou CSV) com a **data** e a **região** usadas — preços mudam, então a exportação é a evidência.
- Um pequeno script ou planilha com as fórmulas (versionado), para que os números possam ser recalculados.
- A **atualização final do design doc** (com um registro de mudanças do que mudou desde o M1).
- A tag `m8`.

## Critérios de aceitação

- [ ] **(obrigatório)** Uma **lista de materiais** cobrindo todos os componentes do seu design doc (computação, bancos, cache, broker, balanceador, NAT, tráfego de saída/CDN, armazenamento, observabilidade e tokens de LLM na opção de IA), cada um com quantidade, tamanho, horas e o preço usado.
- [ ] **(obrigatório)** Todo preço vem de uma **calculadora ou página de preços oficial**, com data e região; nenhum preço é inventado. As premissas (horas por mês, GB transferidos, utilização, retenção) estão listadas.
- [ ] Economia unitária: **custo por 1.000 requisições** e **custo por unidade de negócio** da sua opção.
- [ ] Custo do **ambiente realmente usado** (notebook, minutos de CI, eventual conta na nuvem — com a fatura, se uma nuvem foi usada).
- [ ] Sensibilidade: custo com **×10 de tráfego**, provisionado para o pico vs com autoscaling, e com **compromissos/spot** (instâncias reservadas, savings plans, descontos por uso comprometido).
- [ ] Uma **comparação de modelos de serviço** para pelo menos um componente (por exemplo, Kafka autogerenciado no Kubernetes vs um serviço Kafka gerenciado vs uma fila serverless): custo, esforço operacional, limites.
- [ ] **≥ 3 alavancas de economia**, cada uma ligada a uma **medição** do M6 (por exemplo, "taxa de acerto de 95% → o banco pode ser um tamanho menor") com a economia estimada.
- [ ] Seção *Uso de IA* (veja a [política](../../index.md#use-of-ai-tools)).

## Passo a passo

### 1. Escolha uma nuvem e a sua calculadora

Use **um** provedor para toda a estimativa (você pode comparar um único componente entre provedores como extra). Mapeie cada componente da paleta do seu design para um serviço concreto:

=== "AWS"

    Calculadora: [AWS Pricing Calculator](https://calculator.aws/){target="_blank"}

    | Paleta | Serviço típico |
    |-|-|
    | `app`, `worker` no Kubernetes | Amazon EKS (plano de controle) + nós EC2 (ou Fargate) |
    | `sql` | Amazon RDS / Aurora PostgreSQL |
    | `cache` | Amazon ElastiCache (Redis/Valkey) |
    | `kafka` / `queue` | Amazon MSK / Amazon SQS |
    | `lb`, `ingress` | Application Load Balancer |
    | `nat` | NAT Gateway |
    | `cdn` | Amazon CloudFront |
    | `objstore` | Amazon S3 |
    | `metrics`, `logs`, `tracing` | Amazon CloudWatch / Managed Prometheus / X-Ray |
    | modelo do `llmgw` | Amazon Bedrock |

=== "Google Cloud"

    Calculadora: [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator){target="_blank"}

    | Paleta | Serviço típico |
    |-|-|
    | `app`, `worker` no Kubernetes | Google Kubernetes Engine (Standard ou Autopilot) |
    | `sql` | Cloud SQL for PostgreSQL / AlloyDB |
    | `cache` | Memorystore for Redis |
    | `kafka` / `queue` | Managed Service for Apache Kafka / Pub/Sub |
    | `lb`, `ingress` | Cloud Load Balancing |
    | `nat` | Cloud NAT |
    | `cdn` | Cloud CDN |
    | `objstore` | Cloud Storage |
    | `metrics`, `logs`, `tracing` | Cloud Monitoring / Logging / Trace |
    | modelo do `llmgw` | Vertex AI |

=== "Azure"

    Calculadora: [Azure Pricing Calculator](https://azure.microsoft.com/en-us/pricing/calculator/){target="_blank"}

    | Paleta | Serviço típico |
    |-|-|
    | `app`, `worker` no Kubernetes | Azure Kubernetes Service + node pools de VMs |
    | `sql` | Azure Database for PostgreSQL (Flexible Server) |
    | `cache` | Azure Cache for Redis |
    | `kafka` / `queue` | Event Hubs (endpoint Kafka) / Service Bus |
    | `lb`, `ingress` | Application Gateway / Load Balancer |
    | `nat` | NAT Gateway |
    | `cdn` | Azure Front Door |
    | `objstore` | Blob Storage |
    | `metrics`, `logs`, `tracing` | Azure Monitor / Application Insights |
    | modelo do `llmgw` | Azure OpenAI |

### 2. Dimensione cada componente a partir dos seus números

Parta das estimativas do M1 e das medições do M6, não de chutes: a **capacidade por réplica** que você mediu, o **pico** da meta de design, uma **utilização-alvo** (≈ 0,6–0,7), a **taxa de acerto** do cache, os **GB** que saem da nuvem (o tráfego de saída costuma ser a surpresa), a retenção de logs e métricas e — na opção de IA — tokens por requisição × requisições.

| Item | Fórmula |
|-|-|
| Horas de instância por mês | instâncias × 730 h (ou a média com autoscaling × 730 h) |
| Réplicas no pico | ⌈ req/s de pico ÷ (capacidade por réplica × utilização-alvo) ⌉ |
| Leituras no banco depois do cache | (1 − taxa de acerto) × req/s de leitura |
| Tráfego de saída (GB/mês) | req/s × tamanho da resposta × 2,6 M s/mês (menos o que a CDN serve) |
| Custo de LLM por mês | requisições × (tokens de entrada × preço de entrada + tokens de saída × preço de saída) ÷ 10⁶ |
| Custo por 1.000 requisições | custo mensal ÷ (requisições no mês ÷ 1.000) |
| Custo por unidade de negócio | custo mensal ÷ unidades por mês (ingressos, mensagens, corridas, visualizações, conversas) |

### 3. Visualize para onde vai o dinheiro

Um gráfico empilhado da fatura por categoria deixa os custos dominantes evidentes. O gráfico abaixo usa **preços fictícios ilustrativos** — não cotações reais — apenas para mostrar a forma da análise; o seu relatório precisa usar os preços da exportação da sua calculadora.

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

# ILLUSTRATIVE placeholder numbers (US$/month), NOT real prices.
# Two variants of the same design: everything on demand and provisioned for the peak,
# versus autoscaling + commitments + a cache that allows a smaller database.
categories = ["Compute", "Database", "Cache", "Broker", "Edge/CDN + egress", "Observability", "LLM tokens"]
on_demand = [6000, 3000, 600, 1200, 2500, 900, 1800]
optimized = [2800, 1500, 600, 900, 1600, 700, 900]

plt.rcParams.update({  # gray reads well in light and dark mode
    "text.color": "gray", "axes.labelcolor": "gray", "axes.edgecolor": "gray",
    "xtick.color": "gray", "ytick.color": "gray",
})
colors = ["tab:blue", "tab:orange", "tab:red", "tab:olive", "tab:purple", "tab:cyan", "tab:pink"]
fig, ax = plt.subplots(figsize=(8, 3))
variants = ["provisioned for peak,\non demand", "autoscaled + commitments\n+ cache"]
left = [0, 0]
for cat, a, b, c in zip(categories, on_demand, optimized, colors):
    ax.barh(variants, [a, b], left=left, color=c, label=cat, edgecolor="white")
    left = [left[0] + a, left[1] + b]
for i, total in enumerate(left):
    ax.text(total + 200, i, f"US$ {total:,}/month", va="center", fontsize=9)
ax.set_xlim(0, max(left) * 1.3)
ax.set_xlabel("US$ per month (illustrative placeholders, not real prices)")
ax.legend(ncol=4, fontsize=7, loc="upper center", bbox_to_anchor=(0.5, -0.35), frameon=False)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

### 4. Economia unitária

Divida pela unidade que importa para o negócio. Na BoxOffice, **custo por ingresso vendido** é o número que um gerente de produto entende; no chat, custo por 1.000 mensagens; no vídeo, custo por hora assistida; no assistente, custo por conversa (com os tokens como principal fator). Compare com o quanto a unidade vale (uma taxa de conveniência, uma impressão de anúncio) — uma arquitetura que custa mais por ingresso do que a taxa cobrada não é um negócio.

!!! example "BoxOffice — pico versus mês"

    Uma venda relâmpago dura minutos, mas a capacidade provisionada para ela é paga o mês inteiro. Compare: (a) provisionado para o pico da venda 730 h/mês; (b) uma base mais autoscaling durante as vendas; (c) (b) mais uma sala de espera que limita o caminho do inventário. A sala de espera não é só um recurso de justiça — é um recurso de **custo**: ela permite dimensionar o caminho caro e fortemente consistente pela taxa de admissão, e não pela multidão.

### 5. Modelos de serviço

Escolha pelo menos um componente e compare como você o operaria:

| Modelo | Exemplo para o broker | Você gerencia | Trade-off típico |
|-|-|-|-|
| IaaS | Kafka em VMs | SO, Kafka, atualizações, escala, backups | Menor preço unitário, maior esforço |
| Contêineres no seu cluster | Kafka no Kubernetes (operator) | Kafka, armazenamento, atualizações | Reaproveita o cluster; o plantão é seu |
| PaaS / gerenciado | Um serviço Kafka gerenciado | Tópicos, clientes, dimensionamento | Preço unitário maior, muito menos operação |
| Serverless / SaaS | Uma fila ou serviço de eventos serverless | Só o uso | Paga por requisição; limites de vazão, retenção ou semântica |

Coloque o esforço em horas por mês ao lado da fatura: o tempo de um engenheiro é o maior custo escondido de componentes autogerenciados.

### 6. Alavancas de economia apoiadas em medições

Toda alavanca precisa apontar para uma medição: *"o M6 mostra o cache do catálogo com 95% de acerto, então o banco pode cair um tamanho de instância (−US$ …)"*, *"a CPU do `notification` fica em 8% em média — leve-o para serverless ou para um node pool menor"*, *"o cache semântico respondeu 30% das perguntas — tokens de LLM −30%"*, *"logs são 60% do custo de observabilidade — amostre os logs de debug e reduza a retenção"*. Considere também compromissos (capacidade reservada de 1 ano ou savings plans), nós spot/preemptíveis para workers sem estado e o tráfego de saída economizado pela CDN.

## Templates

=== "English"

    ~~~markdown
    # Cost report — <team / system>

    ## 1. Scope and assumptions
    Cloud and region: ... · Calculator export: <link/file>, date ...
    Design target: ... req/s peak, ... average; 730 h/month; egress ... GB/month; retention ...

    ## 2. Bill of materials (design target)
    | Component (palette id) | Service | Size | Qty | Hours/month | Unit price (source) | US$/month |
    |-|-|-|-|-|-|-|
    | app (catalog) | ... | 2 vCPU / 4 GB | ... | 730 | ... | |
    | sql | ... | | | | | |
    | **Total** | | | | | | |

    ## 3. Unit economics
    | Unit | Monthly volume | Cost per unit |
    |-|-|-|
    | 1,000 requests | | |
    | ticket / message / ride / view / conversation | | |

    ## 4. Environment actually used
    Laptop / CI minutes / cloud account (bill attached): ...

    ## 5. Sensitivity
    | Scenario | US$/month | Notes |
    |-|-|-|
    | Baseline (design target) | | |
    | ×10 traffic | | which items grow linearly, stepwise, stay fixed |
    | Provisioned for peak vs autoscaled | | |
    | With commitments / spot | | |

    ## 6. Service-model comparison: <component>
    | Option | US$/month | Effort (h/month) | Limits | Choice |
    |-|-|-|-|-|

    ## 7. Saving levers
    | Lever | Evidence (M6 measurement) | Estimated saving | Risk |
    |-|-|-|-|

    ## 8. AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Relatório de custos — <time / sistema>

    ## 1. Escopo e premissas
    Nuvem e região: ... · Exportação da calculadora: <link/arquivo>, data ...
    Meta de design: ... req/s no pico, ... na média; 730 h/mês; tráfego de saída ... GB/mês; retenção ...

    ## 2. Lista de materiais (meta de design)
    | Componente (id da paleta) | Serviço | Tamanho | Qtd | Horas/mês | Preço unitário (fonte) | US$/mês |
    |-|-|-|-|-|-|-|
    | app (catalog) | ... | 2 vCPU / 4 GB | ... | 730 | ... | |
    | sql | ... | | | | | |
    | **Total** | | | | | | |

    ## 3. Economia unitária
    | Unidade | Volume mensal | Custo por unidade |
    |-|-|-|
    | 1.000 requisições | | |
    | ingresso / mensagem / corrida / visualização / conversa | | |

    ## 4. Ambiente realmente usado
    Notebook / minutos de CI / conta na nuvem (fatura anexada): ...

    ## 5. Sensibilidade
    | Cenário | US$/mês | Observações |
    |-|-|-|
    | Base (meta de design) | | |
    | ×10 de tráfego | | o que cresce linearmente, em degraus, fica fixo |
    | Provisionado para o pico vs autoscaling | | |
    | Com compromissos / spot | | |

    ## 6. Comparação de modelos de serviço: <componente>
    | Opção | US$/mês | Esforço (h/mês) | Limites | Escolha |
    |-|-|-|-|-|

    ## 7. Alavancas de economia
    | Alavanca | Evidência (medição do M6) | Economia estimada | Risco |
    |-|-|-|-|

    ## 8. Uso de IA
    ~~~

## Rubrica

Níveis conforme definidos em [Como os exercícios são avaliados](../../index.md#how-the-exercises-are-graded).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Lista de materiais **(obrigatório)** | Não entregue | Componentes faltando ou sem quantidades | Todo componente com tamanho, quantidade, horas, preço | Tamanhos derivados dos números do M1/M6 | Custos escondidos encontrados (tráfego de saída, NAT por GB, ingestão de logs, tráfego entre AZs) |
| Fontes **(obrigatório)** | Preços inventados | Preços sem data/região | Exportação da calculadora com data e região; premissas listadas | Fórmulas versionadas; números recalculáveis | Conferido em uma segunda calculadora para o maior item |
| Economia unitária | — | Ausente | Custo por 1.000 requisições e por unidade de negócio | Comparado com o quanto a unidade vale | Custo unitário com ×10 de tráfego (economias ou deseconomias de escala) explicado |
| Sensibilidade e modelos de serviço | — | Só um cenário | ×10, pico vs autoscaling, compromissos; uma comparação de modelos de serviço | Esforço (h/mês) incluído na comparação | Ponto de equilíbrio entre dois modelos calculado |
| Alavancas de economia | — | Conselhos genéricos | 3 alavancas com economia estimada | Cada uma ligada a uma medição do M6 | Uma alavanca implementada e seu efeito medido |
| Ambiente real e atualização do design doc | — | Ausente | Custo real informado; design doc atualizado | Registro de mudanças desde o M1 ligado às ADRs | Proteções de custo propostas (orçamentos, alertas, tags) |

## FAQ

??? question "Nunca fizemos deploy em nuvem. Ainda precisamos de uma estimativa de nuvem?"

    Sim. A estimativa é da **meta de design** em uma nuvem; ela não exige um deploy. A seção "ambiente realmente usado" diz então: notebook e minutos de CI (e se vocês ficaram dentro dos níveis gratuitos).

??? question "A calculadora não tem exatamente o nosso componente."

    Escolha o serviço gerenciado mais próximo ou precifique como computação (por exemplo, um motor de busca autogerenciado em VMs) e diga isso. O que importa é que a premissa esteja explícita.

??? question "Como precificamos o autoscaling?"

    Use o número médio de réplicas no mês (a partir da sua curva de tráfego: horas na base × réplicas da base + horas no pico × réplicas do pico) × o preço da instância. Mostre as contas.

??? question "Incluímos o salário dos engenheiros?"

    Não na fatura, mas incluam o **esforço em horas por mês** na comparação de modelos de serviço. Muitas vezes é ele que decide entre autogerenciado e gerenciado.

??? question "Os preços mudaram depois que exportamos a estimativa."

    É por isso que a data e a região são obrigatórias. Guardem a exportação; o relatório é avaliado em relação a ela.

??? question "Na opção de IA, de onde vêm os preços dos tokens?"

    Da página oficial de preços do provedor do modelo (ou do serviço de modelos da nuvem na calculadora), com a data. Informem os tokens por requisição **medidos** no M6 (entrada e saída separadas) e o efeito do cache semântico e do roteamento de modelos.
