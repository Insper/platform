"O BoxOffice é confiável o bastante?" Ninguém responde a isso sem números. O gerente de produto quer lançar um novo mapa de lugares na semana anterior a uma abertura de vendas no estádio; a engenheira de plantão diz que o caminho de compra teve um mês ruim e quer congelar os deploys. Sem uma definição compartilhada de "bom o bastante", essa discussão é opinião contra opinião. A prática de Site Reliability Engineering (SRE) do Google introduziu um vocabulário que transforma a discussão em aritmética[^1], e hoje ele é padrão no mercado:

| Termo | Nome completo | Natureza | Exemplo no BoxOffice |
|---|---|---|---|
| **SLI** | Service Level Indicator | Uma medida do que os usuários vivenciam | % das requisições de reserva que têm sucesso em menos de 500 ms |
| **SLO** | Service Level Objective | Uma meta interna para um SLI, em uma janela | ≥ 99,9% em 28 dias |
| **Error budget** | — | A falha que o SLO permite: 1 − SLO | 0,1% das reservas podem falhar ou ser lentas |
| **SLA** | Service Level Agreement | Um contrato com clientes, com penalidades | Prometido às casas de show parceiras: 99,5% ao mês, ou créditos |

``` diagram-sim
flowchart LR
    tel["Telemetria<br/>(métricas, logs, traces)"] -->|"agregada em"| sli["SLI<br/>eventos bons / válidos"]
    sli -->|"comparado com"| slo["SLO<br/>meta interna"]
    slo -->|"a diferença é"| budget["Error budget<br/>licença para correr risco"]
    slo -->|"versão mais folgada"| sla["SLA<br/>contrato externo"]
    budget -->|"orienta"| decisions["Lançar ou congelar?<br/>Acionar ou abrir chamado?"]
```

---

## Comece pelas jornadas do usuário { #start-from-user-journeys }

Um SLO só é útil se mede o que importa para os usuários. Comece listando as **jornadas críticas de usuário** (CUJs, *critical user journeys*) do BoxOffice — as poucas interações que precisam funcionar — e depois decida como medir cada uma.

| Jornada crítica | Por que importa | Tipo de SLI |
|---|---|---|
| Navegar pelo catálogo e pelas páginas de eventos | A maior parte do tráfego; primeira impressão | Disponibilidade + latência |
| Entrar na sala de espera e ser admitido | A flash sale depende disso | Disponibilidade + latência das atualizações de posição |
| Reservar lugares | Receita; fortemente consistente | Disponibilidade + latência |
| Pagar e ter o pedido confirmado | Receita; provedor externo envolvido | Disponibilidade (de ponta a ponta, incluindo a saga) |
| Receber os ingressos por e-mail / no app | Confiança; assíncrono | **Atualidade (freshness)**: tempo da confirmação até a entrega |
| Buscar eventos | Descoberta | Latência + qualidade (resultados não desatualizados) |

Nem toda jornada precisa da mesma meta. A navegação tolera uma página lenta de vez em quando; um pagamento que falha perde uma venda e a confiança de um fã.

---

## SLI — medindo o que os usuários sentem { #sli-measuring-what-users-feel }

Um SLI é melhor escrito como uma **razão de eventos**, para ficar sempre entre 0% e 100%[^2]:

$$
\text{SLI} = \frac{\text{good events}}{\text{valid events}} \times 100\%
$$

As duas palavras importam. **Bom** define sucesso do ponto de vista do usuário — "o status não é 5xx **e** a latência é menor que 500 ms". **Válido** exclui o que não deve contar — respostas `4xx` causadas pelo cliente, requisições de health check, testes de carga sintéticos.

| Categoria de SLI | Evento bom | Exemplo no BoxOffice |
|---|---|---|
| **Disponibilidade** | Requisição respondida sem erro do servidor | `POST /holds` devolveu não-5xx |
| **Latência** | Requisição respondida abaixo de um limite | `GET /events/{id}` em < 300 ms |
| **Atualidade** | Dado ou efeito colateral recente o bastante | E-mail de confirmação enviado < 2 min depois do `OrderConfirmed` |
| **Correção** | A saída está certa | Nenhum lugar vendido duas vezes (verificado por um job de reconciliação) |
| **Durabilidade** | Dados armazenados podem ser lidos de volta | Todo pedido confirmado pode ser lido um dia depois |

!!! warning "Evite métricas de vaidade"
    Uso de CPU, heap da JVM ou número de pods **não** são SLIs. Um serviço pode estar a 95% de CPU e atender todos bem, ou a 5% de CPU e estar completamente fora (em deadlock, mal roteado). Elas são úteis para *diagnosticar*; SLIs precisam refletir o que os usuários vivenciam.

### Onde medir { #where-to-measure }

| Ponto de medição | Vê | Não vê |
|---|---|---|
| **Métricas da aplicação** (OpenTelemetry, Micrometer) | Detalhe por rota, barato | Requisições que nunca chegaram ao app (LB, DNS, rede) |
| **Logs do load balancer / gateway** | Tudo o que chegou à borda | Falhas do lado do cliente, CDN |
| **Probes sintéticos** | Uma jornada roteirizada de fora, mesmo sem tráfego | A diversidade dos usuários reais |
| **Telemetria do cliente (navegador / app)** | O que os usuários realmente vivenciam | Ruidosa; depende da rede dos usuários |

Uma escolha comum é calcular os SLIs no **gateway** (perto do usuário, mas sob seu controle) e complementá-los com probes sintéticos da jornada de compra. Com métricas OpenTelemetry exportadas para o Prometheus (veja [Sinais](../signals/index.md)), o SLI de disponibilidade da rota de reserva em 5 minutos é:

```promql
sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route="/holds", http_response_status_code!~"5.."}[5m]))
/
sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route="/holds"}[5m]))
```

!!! example "Um SLI de atualidade para trabalho assíncrono"

    SLIs de requisição não enxergam falhas assíncronas: `POST /orders` pode estar 100% verde enquanto o consumidor `notification` está duas horas atrasado (veja [Mensageria](../../messaging/index.md)). O BoxOffice mede a jornada "receber os ingressos" com um SLI de atualidade: para cada `OrderConfirmed`, o tempo até o e-mail ser aceito pelo provedor. Evento bom: menos de 2 minutos. O SLO: 99% das confirmações em 28 dias. O consumer lag em segundos é o sinal de alerta antecipado.

---

## SLO — a meta { #slo-the-target }

Um SLO é uma meta para um SLI em uma janela:

> `SLI ≥ meta` em uma `janela`

| SLO do BoxOffice | Significado |
|---|---|
| Reservas: 99,9% com sucesso em < 500 ms, em 28 dias | No máximo 1 em cada 1.000 reservas pode falhar ou ser lenta |
| Páginas do catálogo: 99,5% servidas em < 300 ms, em 28 dias | A navegação tolera mais lentidão |
| Entrega de ingressos: 99% em até 2 min da confirmação, em 28 dias | Atualidade do caminho assíncrono |
| Sala de espera da abertura de vendas: 99,95% das atualizações de posição com sucesso, durante cada abertura | Um SLO *restrito ao evento* para as horas que mais importam |

Use uma **janela móvel** (os últimos 28 dias, avançando a cada minuto) em vez de um mês de calendário: 28 dias sempre contêm quatro de cada dia da semana, e o orçamento não "zera" magicamente no dia 1º.

Como escolher o número:

- **Meça primeiro.** Olhe o SLI dos últimos 30–90 dias e defina o SLO um pouco abaixo do que você já alcança. Uma meta que você já perde toda semana é ruído.
- **Respeite a matemática das dependências.** O `order` não pode prometer mais que o produto do que ele chama de forma síncrona ([Confiabilidade — disponibilidade composta](../../reliability/index.md#composite-availability)). Se o provedor de pagamento oferece 99,9%, um SLO de compra de 99,99% é ficção.
- **Pergunte o que os usuários percebem.** Ir de 99,9% para 99,99% custa muito (veja a tabela de noves); se os fãs não perceberiam, o dinheiro rende mais em funcionalidades.
- **Nunca 100%.** Não deixa espaço para deploys, manutenção ou o inevitável, e todas as suas dependências estão abaixo disso de qualquer forma.

---

## Error budget

O **error budget** é a quantidade de não confiabilidade que o SLO permite — a **licença do time para correr riscos**:

$$
\text{Error budget} = 1 - \text{SLO}
$$

=== "Por requisições"

    O caminho de compra recebe cerca de 1.000.000 de requisições por dia. Em 28 dias são 28.000.000 de requisições, e um SLO de 99,9% permite

    $$
    0.001 \times 28\,000\,000 = 28\,000 \text{ failed requests}
    $$

    Um deploy ruim que devolve erros para 5% das requisições durante 3 horas ($0.05 \times 3 \times 41\,667 \approx 6\,250$ falhas) gasta cerca de 22% do orçamento do mês em uma tarde.

=== "Por tempo"

    Para um SLO de 99,9% em 28 dias:

    $$
    0.001 \times 28 \times 24 \times 60 \approx 40.3 \text{ minutes}
    $$

    Orçamentos por tempo são intuitivos ("temos 40 minutos de indisponibilidade"), mas tratam as 3 da manhã como as 10:00 de um dia de abertura de vendas. Orçamentos por requisições pesam as falhas pelo tráfego que elas atingem.

### Burn rate

O **burn rate** diz com que velocidade o orçamento está sendo gasto em relação à janela[^2]:

$$
\text{burn rate} = \frac{\text{observed error rate}}{1 - \text{SLO}}
$$

Com um SLO de 99,9%, uma taxa de erros de 0,1% é um burn rate de 1 — o orçamento dura exatamente os 28 dias. Uma taxa de erros de 1,44% é um burn rate de 14,4, que esgota o orçamento em $28 / 14.4 \approx 1.9$ dia.

A simulação abaixo acompanha o orçamento do caminho de compra em uma janela de 28 dias com números ilustrativos: um fundo tranquilo de 0,01% de erros, um deploy ruim no dia 9 (5% de erros por 3 horas) e uma degradação lenta a partir do dia 16 (0,2% de erros — um burn rate de apenas 2).

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})

SLO, DAYS = 0.999, 28
REQ_PER_HOUR = 1_000_000 / 24              # ~1 M purchase-path requests per day (illustrative)
budget = (1 - SLO) * REQ_PER_HOUR * 24 * DAYS   # failed requests allowed in the window

def error_rate(h):                          # h = hour since the window started
    day = h / 24
    if 9 * 24 + 10 <= h < 9 * 24 + 13:      # day 9, 10:00-13:00: bad deploy, 5% errors
        return 0.05
    if day >= 16:                           # from day 16: slow degradation, 0.2% errors
        return 0.002
    return 0.0001                           # normal background: 0.01%

hours = range(DAYS * 24)
spent, remaining, burn = 0.0, [], []
for h in hours:
    rate = error_rate(h)
    spent += rate * REQ_PER_HOUR
    remaining.append(100 * (1 - spent / budget))
    burn.append(rate / (1 - SLO))
days = [h / 24 for h in hours]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 5.2), sharex=True)
ax1.plot(days, burn, color="#e53935", lw=1.8)
for level, label in [(14.4, "page: 14.4x"), (6, "page: 6x"), (1, "budget lasts exactly 28 days")]:
    ax1.axhline(level, color="#888", ls="--", lw=1)
    ax1.text(0.2, level * 1.15, label, fontsize=8)
ax1.set_yscale("log")
ax1.set_ylabel("burn rate")
ax1.grid(True, alpha=0.3)
ax2.plot(days, remaining, color="#1976d2", lw=2)
ax2.axhline(0, color="#e53935", lw=1)
ax2.set_ylim(-35, 105)
ax2.set_ylabel("error budget left (%)")
ax2.set_xlabel("day of the 28-day window")
ax2.grid(True, alpha=0.3)
ax2.annotate("bad deploy: 3 h at 5% errors", xy=(9.5, remaining[9 * 24 + 13]),
             xytext=(10.5, 92), arrowprops={"arrowstyle": "->", "color": "#888"}, fontsize=8)
ax2.annotate("slow degradation: 0.2% errors (2x)", xy=(21, remaining[21 * 24]),
             xytext=(9, 20), arrowprops={"arrowstyle": "->", "color": "#888"}, fontsize=8)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Os dois incidentes ensinam lições diferentes:

- O **deploy ruim** tem um burn rate enorme (50×) por pouco tempo. Ele precisa **acionar** alguém em minutos, e o orçamento mostra quanto custou: cerca de um quinto do mês.
- A **degradação lenta** nunca parece dramática — 0,2% de erros não assustaria ninguém num dashboard — mas a 2× ela **esgota o orçamento por volta do dia 26**. Só um alerta de queima lenta, em uma janela longa, a pega.

### Alertando pelo burn rate { #alerting-on-burn-rate }

Alerte pelo orçamento, não por taxas de erro brutas ou CPU. O SRE Workbook recomenda alertas **multijanela e multi-burn-rate**[^2]: uma janela longa para medir a relevância e uma janela curta para encerrar o alerta logo que o problema for corrigido.

| Severidade | Burn rate | Janela longa | Janela curta | Orçamento consumido quando dispara |
|---|---|---|---|---|
| Acionar (page) | 14,4× | 1 h | 5 min | 2% |
| Acionar (page) | 6× | 6 h | 30 min | 5% |
| Chamado (ticket) | 1× | 3 dias | 6 h | 10% |

<div class="csim" data-sim="slo-burn" data-slo="99.9"></div>

!!! tip "Experimente"
    A janela tem os dois incidentes do gráfico acima e alguns soluços curtos. Dê play (acelere com o botão `1×`) e compare as quatro faixas de alerta.

    - **Soluços**: a regra ingênua (*erros > 0,1% em 5 min*) aciona alguém em quase todos — 10 vezes neste mês —, embora os 14 soluços juntos custem só 1,6% do orçamento. As regras de burn rate ficam quietas.
    - **Deploy ruim** (dia 9, 5% por 3 h): a regra de 14,4× aciona 17 minutos depois do início, quando o incidente custou 2,2% do orçamento; a de 6× vem após 42 minutos (5,3%). O incidente inteiro custa 22,3%.
    - **Degradação lenta** (2× a partir do dia 16): nenhum page; o ticket de 3 dias dispara 34 horas depois (dia 17,4), com 39% do orçamento gasto — mais de 8 dias antes de ele acabar (dia 25,9).
    - Aperte **limpar incidentes**, avance até o dia 2, pause e injete *0,7% por 3 dias*: nenhum page rápido, mas a regra de 6× aciona após cerca de 5 horas. Com *20% por 30 min* o page chega após 4 minutos, e mesmo assim o incidente custa cerca de 15%: um alerta só salva o orçamento que ainda não foi queimado.

    O lab 9 provisiona as mesmas regras de 14,4× e 6× (como page e ticket) para o `order`, com um SLO de 99,5%.

```yaml
# Prometheus alerting rule: purchase path, SLO 99.9% (budget = 0.001)
- alert: PurchaseErrorBudgetFastBurn
  expr: |
    (
      sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route=~"/holds|/orders", http_response_status_code=~"5.."}[1h]))
      / sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route=~"/holds|/orders"}[1h]))
    ) > (14.4 * 0.001)
    and
    (
      sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route=~"/holds|/orders", http_response_status_code=~"5.."}[5m]))
      / sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route=~"/holds|/orders"}[5m]))
    ) > (14.4 * 0.001)
  labels:
    severity: page
  annotations:
    summary: "Purchase path burning the 28-day error budget 14.4x faster than allowed"
```

Os detalhes do projeto de alertas, do roteamento e do plantão estão em [Observabilidade — alertas](../alerting/index.md).

!!! example "No código do BoxOffice: o SLO como regra de alerta (labs 8 e 9)"

    O [Hands-on 8 — SLO e alerta de burn rate](../../../hands-on/8/slo/index.md) escreve a promessa do `catalog`: 99,5% das requisições, sem contar os health checks, respondidas sem 5xx em 28 dias — a 100 req/s, um orçamento de cerca de 1,21 milhão de requisições com falha. Ele provisiona a regra de 14,4× como page e a de 6× como ticket, em arquivos que o Grafana carrega na inicialização. O [Hands-on 9 — Game day](../../../hands-on/9/game-day/index.md) copia o arquivo para o `order`, para que uma falha escondida no caminho do pagamento acione os operadores. Leia o trecho buscando as três partes da regra: a consulta A (a razão de erros em 1 h, dividida pelo orçamento 0,005, é o burn rate), a consulta B (a mesma em 5 min; B repete A com `[5m]`, cortada aqui) e a condição C, que exige as duas. `http_route!~"/actuator.*"` deixa as probes fora do SLI.

    ``` { .yaml title="infra/grafana/alerting/slo-order.yaml (the fast-burn rule)" }
    --8<-- "docs/2027.1/hands-on/9/code/infra/grafana/alerting/slo-order.yaml:12:26,38:52"
    ```

### A política de error budget { #the-error-budget-policy }

Um error budget é só um número num dashboard, a menos que produto e engenharia combinem **de antemão** o que acontece à medida que ele é gasto. Esse acordo é a **política de error budget**:

!!! example "Política de error budget do BoxOffice (caminho de compra)"

    - **Orçamento acima de 50%**: operação normal; deploy em qualquer dia útil; experimentos permitidos.
    - **Orçamento entre 0 e 50%**: deploys precisam de plano de rollback e canary; um item de confiabilidade entra em toda sprint.
    - **Orçamento esgotado**: deploys de funcionalidades no caminho de compra ficam congelados até o SLI de 28 dias voltar acima do SLO; só correções e trabalho de confiabilidade são lançados.
    - **Regra de abertura de vendas**: nenhum deploy no caminho de compra nas 24 horas anteriores a uma grande abertura, qualquer que seja o orçamento.
    - **Um único incidente > 20% do orçamento**: postmortem sem culpados obrigatório, com itens de ação (veja [Resposta a incidentes](../incident-response/index.md)).

    Assinada pelo gerente de produto e pela liderança de engenharia do caminho de compra; revisada a cada trimestre.

!!! tip "O orçamento como ferramenta de negociação"
    O gerente de produto quer lançar o novo mapa de lugares; a engenheira está receosa. O orçamento responde de forma objetiva: "temos 70% do orçamento e a mudança sai atrás de uma feature flag para 5% dos fãs — pode lançar." Ou: "temos 8% e a abertura do estádio é na sexta — espera até a semana que vem." Note que funciona também no sentido inverso: um orçamento sem uso é sinal de que o time está cauteloso *demais* e poderia ir mais rápido.

---

## SLA — o contrato { #sla-the-contract }

Um **SLA** é um acordo formal com clientes que define o serviço esperado e as **compensações** (em geral créditos) se ele não for cumprido. É um documento jurídico: descumpri-lo custa dinheiro.

Um SLA tipicamente define: serviços e regiões cobertos; o compromisso (por exemplo, 99,9% de uptime mensal); como ele é medido; exclusões (manutenção programada, problemas causados pelo cliente, força maior); e a tabela de créditos.

Os compromissos abaixo vêm das páginas públicas de SLA dos provedores[^3]; as condições mudam com o tempo, então sempre leia a página atual.

| Provedor | Serviço | Compromisso mensal | Condição |
|---|---|---|---|
| AWS | Amazon EC2 | 99,99% (no nível da região) | Instâncias em várias AZs |
| AWS | Amazon RDS | 99,95% | Implantações Multi-AZ |
| AWS | Amazon S3 Standard | 99,9% | — |
| Google Cloud | Compute Engine | 99,99% | Instâncias em várias zonas |
| Azure | Virtual Machines | 99,99% | Duas ou mais VMs em zonas de disponibilidade |

Duas lições se escondem nessa tabela. Primeiro, os números mais altos só valem se **você** implantar com redundância — a redundância é o preço do nove extra. Segundo, a compensação é um crédito na sua fatura, não uma indenização pelos ingressos que você deixou de vender: **um SLA transfere um pouco de risco financeiro; ele não torna seu sistema disponível**.

| | SLO | SLA |
|---|---|---|
| **Público** | O time de engenharia | Clientes, parceiros, advogados |
| **Natureza** | Meta interna | Contrato jurídico |
| **Rigor** | Mais rígido | Mais folgado |
| **Quando não é cumprido** | Trabalho de confiabilidade, congelamento de deploys | Créditos, multas, reputação |

Mantenha o **SLO mais rígido que o SLA** (por exemplo, SLO de 99,95%, SLA de 99,9%): a diferença é uma margem de segurança que avisa muito antes de o contrato estar em risco.

!!! tip "Na entrevista"
    Na etapa de requisitos, transforme o vago "altamente disponível" em SLOs por jornada: "reservas 99,9% abaixo de 500 ms; navegação 99,5%; e-mail de ingressos em até 2 minutos para 99%". Depois use-os: eles justificam a redundância (matemática das dependências), a assincronia (remover dependências não críticas) e os alertas (burn rate). Diga que 99,99% significa cerca de 4 minutos por mês, então exige failover automatizado. Entrevistadores valorizam mais ouvir *por que* um número foi escolhido do que o número em si.

!!! success "Boas práticas"

    - **Mantenha SLOs e suas regras de alerta como código, no repositório, revisados como qualquer mudança** — uma meta que ninguém consegue comparar ou reproduzir se desvia. No BoxOffice: `slo-catalog.yaml` e `slo-order.yaml`, carregados pelo Grafana na inicialização (labs 8 e 9, [quadro acima](#alerting-on-burn-rate)).
    - **Tire do SLI as probes e o tráfego sintético com um filtro de label explícito** — health checks a cada poucos segundos inflam a taxa de sucesso com requisições que nenhum fã fez. No BoxOffice: `http_route!~"/actuator.*"` nas regras.
    - **Comece cada SLO um pouco abaixo de 30–90 dias de SLI medido e revise-o a cada trimestre** — uma meta que você já perde toda semana é ruído; uma que você sempre supera é um orçamento que ninguém gasta.
    - **Mostre o error budget restante onde as entregas são planejadas** — a decisão de lançar ou congelar vira rotina em vez de debate: 28.000 compras com falha a cada 28 dias a 99,9%.
    - **Acrescente um SLO com escopo de evento para cada grande abertura de vendas** — uma hora ruim quase não mexe num orçamento de 28 dias, mas é a hora que importa; a sala de espera promete 99,95% durante cada abertura.

!!! warning "Armadilhas comuns"

    - **Medir a coisa errada**: um SLI do endpoint de health check não diz nada sobre `POST /holds`.
    - **Médias em vez de limites ou percentis**: uma média de 80 ms pode esconder 5% dos fãs esperando 4 s.
    - **SLOs demais**: dois ou três por jornada, sobre os quais alguém age, valem mais que trinta que ninguém lê.
    - **Ignorar os caminhos assíncronos**: APIs verdes, e-mails com três horas de atraso. Adicione SLIs de atualidade.
    - **SLO sem política**: se nada muda quando o orçamento acaba, o SLO é decoração.
    - **Misturar janelas**: um orçamento calculado em 30 dias comparado com um SLO de 28 dias leva a decisões erradas.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    CUJ["jornadas críticas do usuário"] --> SLI["SLI = eventos bons / válidos"]
    TEL["telemetria no gateway<br/>→ Observabilidade"] --> SLI
    SLI --> SLO["SLO em uma janela<br/>móvel de 28 dias"]
    DEP["matemática das dependências<br/>→ disponibilidade composta"] --> SLO
    SLO --> EB["orçamento de erros = 1 − SLO"]
    SLO --> SLA["SLA: um contrato<br/>externo mais frouxo"]
    EB --> BR["alertas de burn rate multijanela<br/>→ Observabilidade — alertas"]
    EB --> POL["política de orçamento:<br/>entregar ou congelar?"]
    POL --> DEL["canário, congelamento de deploys<br/>→ Cloud-native — entrega"]
    POL --> PM["postmortem acima de 20% do orçamento<br/>→ Resposta a incidentes"]
```

**Componentes da paleta:** [`metrics`](../../../reference/components/observability/index.md#metrics) (o SLI é uma razão de contadores de requisições) · [`alerting`](../../../reference/components/observability/index.md#alerting) (regras de burn rate multijanela) · [`apigw`](../../../reference/components/edge/index.md#apigw) (onde o BoxOffice mede o SLI da compra) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (o consumer lag, alerta antecipado do SLI de frescor da entrega de ingressos) · [`payment`](../../../reference/components/external/index.md#payment) (seus 99,9% limitam o SLO da compra). **Cenários:** `observability-stack`, `flash-sale` (o SLO por evento de abertura de vendas). **Continua em:** [Observabilidade — alertas](../alerting/index.md), [Observabilidade — resposta a incidentes](../incident-response/index.md), [Estimativas — matemática da disponibilidade](../../estimation/availability-math/index.md), [Cloud-native — entrega](../../cloud-native/delivery/index.md), [Hands-on 8 — SLO e alerta de burn rate](../../../hands-on/8/slo/index.md).

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. O'Reilly, 2016. Capítulo 3, "Embracing Risk"; capítulo 4, "Service Level Objectives".
[^2]: BEYER, B. et al. [The Site Reliability Workbook](https://sre.google/workbook/table-of-contents/){target="_blank"}. O'Reilly, 2018. Capítulo 2, "Implementing SLOs"; capítulo 5, "Alerting on SLOs".
[^3]: [AWS Service Level Agreements](https://aws.amazon.com/legal/service-level-agreements/){target="_blank"}; [Google Cloud Service Level Agreements](https://cloud.google.com/terms/sla){target="_blank"}; [Azure Service Level Agreements](https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services){target="_blank"}.
