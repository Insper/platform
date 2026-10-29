
Um alerta é um pedido de atenção de um humano, muitas vezes às 3 da manhã. Isso o torna o sinal mais caro do sistema: custa sono, foco e, com o tempo, confiança. Dois modos de falha matam o alerting. **Alertas demais** — "CPU acima de 80%" em cada pod, cada oscilação de cada dependência — e o engenheiro de on-call aprende a ignorar o pager; o incidente real se afoga no ruído. **Alertas de menos, ou os errados** — e a primeira pessoa a notar o checkout quebrado é um fã nas redes sociais. Esta página trata de alertas que disparam quando, e somente quando, os usuários estão sendo prejudicados o bastante para que alguém precise agir.

---

## O que merece um page { #what-deserves-a-page }

Um bom *page* (o acionamento do on-call) é **urgente**, **acionável** e sobre um problema **visível para o usuário**[^1]. Se faltar qualquer um dos três, ele deveria ser outra coisa:

| Situação | Urgente? | Acionável? | Usuários afetados? | Destino |
|---|---|---|---|---|
| Checkout falhando para 5% dos fãs durante uma abertura de vendas | sim | sim | sim | **page** para o on-call |
| Error budget queimando devagar: vai acabar em 10 dias | não | sim | um pouco | **ticket** para o time, nesta semana |
| O disco do broker Kafka vai encher em 4 dias neste ritmo | não | sim | ainda não | **ticket** |
| Um de 30 pods do `catalog` reiniciou e se recuperou | não | não | não | só **dashboard / log** |
| CPU em 85% enquanto todos os SLIs estão bem | não | não | não | nada — ou uma revisão de capacidade |
| O próprio pipeline de alertas está quebrado | sim | sim | indiretamente | page (via um *dead man's switch*, abaixo) |

### Sintomas, não causas { #symptoms-not-causes }

Alerte sobre **sintomas** — o que os usuários vivenciam: erros, latência, atualidade dos dados, corretude. Use **causas** — CPU, memória, um reinício de pod, uma fila cheia — para dashboards e diagnóstico, não para pages.

| | Alerta baseado em sintoma | Alerta baseado em causa |
|---|---|---|
| Exemplo | "razão de sucesso do checkout abaixo do SLO" | "CPU do PostgreSQL > 90%" |
| Dispara quando os usuários estão bem? | não | com frequência (CPU alta, usuários felizes) |
| Perde problemas reais? | raramente — seja qual for a causa, os usuários sentem | com frequência — a falha que você não previu não tem alerta |
| Número de regras | poucas, por jornada do usuário | muitas, por componente e recurso |
| Diz onde olhar? | não — para isso existem dashboards e traces | sim, mas só para modos de falha conhecidos |

A exceção é um **indicador antecedente** que certamente vai virar sintoma e dá tempo para agir — um disco enchendo, um certificado expirando em 7 dias. Esses são tickets, não pages, a menos que o prazo seja de horas.

---

## Do SLO ao alerta { #from-the-slo-to-the-alert }

O [SLO](../slo/index.md) já diz quanta falha é aceitável: com **99,9% dos checkouts com sucesso numa janela móvel de 28 dias** (a janela usada em toda a aula de [Confiabilidade](../slo/index.md)), o error budget é 0,1% dos checkouts. A pergunta que um alerta precisa responder, portanto, não é "há erros?" — sempre há — mas "**estamos gastando o budget rápido o bastante para ter problemas?**".

A medida natural é o **burn rate**:

$$
\text{burn rate} = \frac{\text{razão de erros observada numa janela}}{1 - \text{SLO}}
$$

Um burn rate de 1 gasta exatamente o budget inteiro na janela inteira; um burn rate de 14,4 o gasta 14,4 vezes mais rápido. Se um burn rate $b$ se mantém por um tempo $t$, a fração do budget consumida é

$$
\text{budget consumido} = \frac{b \cdot t}{\text{janela do SLO}}
$$

```python exec="true"
WINDOW_H = 28 * 24          # 28-day SLO window, in hours
SLO = 0.999
print("| Burn rate | Error ratio (SLO 99.9%) | Budget exhausted in | Budget spent in 1 h | in 6 h |")
print("|---:|---:|---:|---:|---:|")
for b in [1, 2, 3, 6, 14.4, 36, 1000]:
    err = b * (1 - SLO)
    hours = WINDOW_H / b
    when = f"{hours / 24:,.1f} days" if hours >= 48 else (f"{hours:,.1f} h" if hours >= 1 else f"{hours * 60:,.0f} min")
    print(f"| {b:g}× | {min(err, 1):.2%} | {when} | {min(b / WINDOW_H, 1):.1%} | {min(6 * b / WINDOW_H, 1):.1%} |")
```

Um burn rate de 1000× é uma indisponibilidade total (100% de erros contra um budget de 0,1%): o budget inteiro de 28 dias acaba em cerca de 40 minutos. É por isso que os alertas rápidos precisam disparar em minutos — e por isso que queimas lentas podem esperar o horário comercial.

### Seis jeitos de escrever o alerta { #six-ways-to-write-the-alert }

O SRE Workbook[^2] compara seis desenhos progressivamente melhores para um alerta de SLO. Sua qualidade é medida por quatro propriedades: **precisão** (fração dos alertas que eram problemas reais), **recall** (fração dos problemas reais que geraram alerta), **tempo de detecção** e **tempo de reset** (quanto tempo o alerta continua disparando depois que o problema acaba).

| # | Regra | Precisão | Recall | Detecção | Reset | Problema |
|---|---|---|---|---|---|---|
| 1 | razão de erros > 0,1% em 10 min | baixa | alto | rápida | rápido | aciona por oscilações que mal tocam o budget |
| 2 | razão de erros > 0,1% em 36 h | alta | alto | **muito lenta** | **muito lento** | uma indisponibilidade total leva ~2 min para alertar, e o alerta dura 36 h |
| 3 | regra 1 + `for: 1h` | média | **baixo** | lenta | rápido | uma indisponibilidade de 100% ainda espera uma hora |
| 4 | burn rate de 14,4× em 1 h | alta | médio | boa | lento | queimas lentas (3×) nunca alertam; o reset leva até uma hora |
| 5 | vários burn rates (14,4× / 6× / 1×) | alta | alto | boa | lento | complexo; ainda lento para resetar |
| 6 | **multiwindow, multi-burn-rate** | alta | alto | boa | **rápido** | o maior número de regras — gere-as com uma ferramenta |

### Multiwindow, multi-burn-rate

O desenho recomendado combina, para cada severidade, uma **janela longa** que prova que a queima é significativa e uma **janela curta** (1/12 da longa) que prova que ela *ainda está acontecendo* — assim o alerta para rápido quando o problema é corrigido:

| Severidade | Janela longa | Janela curta | Burn rate | Budget gasto quando dispara |
|---|---|---|---|---|
| **page** | 1 h | 5 min | 14,4× | 2% |
| **page** | 6 h | 30 min | 6× | 5% |
| **ticket** | 3 dias | 6 h | 1× | 10% |

O gráfico mostra o tempo de detecção para uma falha súbita com uma dada razão de erros, para as duas regras de page. Note o trade-off que ele codifica: quanto pior o incidente, mais rápido o alerta — e, para uma dada regra, o budget gasto no momento em que ela dispara é sempre o mesmo (2% e 5%).

```python exec="1" html="1"
import io
import numpy as np
import matplotlib.pyplot as plt

BUDGET = 0.001
err = np.logspace(np.log10(0.002), 0, 300)          # error ratio from 0.2% to 100%

def detection_minutes(long_window_min, burn):
    threshold = burn * BUDGET
    t = long_window_min * threshold / err           # average over the window reaches the threshold
    return np.where(err >= threshold, np.maximum(t, 0.0), np.nan)

fig, ax = plt.subplots(figsize=(8, 4))
ax.plot(err * 100, detection_minutes(60, 14.4), label="page: 14.4× over 1 h (+5 min)", color="tomato", lw=2)
ax.plot(err * 100, detection_minutes(360, 6), label="page: 6× over 6 h (+30 min)", color="steelblue", lw=2)
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("error ratio of the incident (%)")
ax.set_ylabel("time to fire (minutes)")
ax.set_title("SLO 99.9% — how fast the burn-rate alerts fire")
ax.grid(True, which="both", alpha=0.25)
ax.legend()
fig.patch.set_alpha(0)
ax.set_facecolor("none")
plt.tight_layout()
buf = io.StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close(fig)
```

Uma indisponibilidade total (100% de erros) dispara a regra rápida em menos de um minuto; um incidente que faz falhar 2% dos checkouts leva cerca de 43 minutos para disparar a regra rápida, e um que faz falhar 0,7% nunca a dispara, mas dispara a regra de 6 horas depois de cerca de 5 horas. Abaixo de 0,6% — um burn rate menor que 6× — só a regra de ticket o pega.

### As regras em PromQL { #the-rules-in-promql }

Regras de gravação (*recording rules*) pré-calculam a razão de erros da jornada de checkout em cada janela; as regras de alerta as comparam com os limiares. (Ferramentas como Sloth, Pyrra ou a especificação OpenSLO geram essas regras a partir de uma definição curta de SLO, o que evita erros de copiar e colar.)

```yaml
# prometheus-rules.yaml — checkout availability SLO: 99.9% over 28 days
groups:
  - name: slo-checkout-recordings
    rules:
      - record: slo:checkout_errors:ratio_rate5m
        expr: |
          sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout", http_response_status_code=~"5.."}[5m]))
          /
          sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout"}[5m]))
      - record: slo:checkout_errors:ratio_rate1h
        expr: |
          sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout", http_response_status_code=~"5.."}[1h]))
          /
          sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout"}[1h]))
      # ... the same expression for 30m, 6h and 3d

  - name: slo-checkout-alerts
    rules:
      - alert: CheckoutErrorBudgetFastBurn
        expr: |
          slo:checkout_errors:ratio_rate1h > (14.4 * 0.001)
          and
          slo:checkout_errors:ratio_rate5m > (14.4 * 0.001)
        labels:
          severity: page
          team: checkout
        annotations:
          summary: "Checkout is burning its 28-day error budget at more than 14.4x"
          runbook_url: "runbooks/checkout-slo.md"
      - alert: CheckoutErrorBudgetSlowBurn
        expr: |
          slo:checkout_errors:ratio_rate6h > (6 * 0.001)
          and
          slo:checkout_errors:ratio_rate30m > (6 * 0.001)
        labels:
          severity: page
          team: checkout
      - alert: CheckoutErrorBudgetTicket
        expr: |
          slo:checkout_errors:ratio_rate3d > (1 * 0.001)
          and
          slo:checkout_errors:ratio_rate6h > (1 * 0.001)
        labels:
          severity: ticket
          team: checkout
```

Um **SLO de latência** funciona do mesmo jeito: os "eventos ruins" são as requisições mais lentas que o limiar, calculadas a partir do bucket do histograma que termina no limiar:

```promql
# fraction of checkouts slower than 2 s over 1 h (the "error ratio" of a latency SLO)
1 - (
  sum(rate(http_server_request_duration_seconds_bucket{job="order", http_route="/checkout", le="2"}[1h]))
  /
  sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout"}[1h]))
)
```

!!! example "No código do BoxOffice: os alertas de burn rate do `catalog` (lab 8)"

    O [Hands-on 8 — SLO e alerta de burn rate](../../../hands-on/8/slo/index.md) escreve as duas primeiras regras da tabela acima como regras de alerta do Grafana, provisionadas a partir de um arquivo: um SLO de 99,5% em 28 dias para o `catalog` (um orçamento de 0,5%), com os health checks fora do SLI porque nenhum fã fez essas requisições. A consulta A é o burn rate em 1 h, a consulta B (não mostrada) a mesma expressão em 5 min, e C dispara só quando as duas passam de 14,4. Duas escolhas diferem da tabela: a regra de 6× é um **ticket**, não um page (um sinal mais barato para um time pequeno), e o `for: 1m` acrescenta um minuto de confirmação. Na execução de teste do lab, parar o banco disparou o page após **288 s**, com burn rates de 18,2 (1 h) e 74,4 (5 min).

    ``` { .yaml title="infra/grafana/alerting/slo-catalog.yaml (the fast-burn page)" }
    --8<-- "docs/2027.1/hands-on/8/code/infra/grafana/alerting/slo-catalog.yaml:11:25,37:48"
    ```

!!! example "BoxOffice — a abertura das 10h00, pelos olhos do alerta"

    Às 10h02 o provedor de pagamentos fica lento; às 10h03 a razão de erros do checkout (timeouts devolvidos como `504`) chega a 4%. Isso é um burn rate de 40×: a média de 1 hora da regra rápida cruza 1,44% depois de cerca de 60 × 1,44 / 4 ≈ 22 minutos com 4% constantes… lento demais para uma abertura de vendas que acaba em 30 minutos. Por isso o time adiciona um **SLO dedicado à abertura de vendas** com uma janela mais curta (por exemplo, 99% dos checkouts abaixo de 2 s durante a hora da abertura, alertando sobre janelas de 5 minutos e de 1 minuto) — as regras gerais são calibradas para um budget de 28 dias e não conseguem reagir a um evento que dura meia hora. Jornadas diferentes, SLOs diferentes.

---

## Roteamento: de uma regra disparada até uma pessoa { #routing-from-a-firing-rule-to-a-person }

Uma regra de alerta só produz um *alerta disparado*. Algo precisa decidir **quem** fica sabendo, **como** e **com que frequência**. No ecossistema Prometheus, isso é o **Alertmanager**[^3] (o Grafana Alerting tem os mesmos conceitos): ele **agrupa** alertas relacionados numa só notificação, **deduplica**, aplica **inibições** e **silêncios**, e **roteia** pelos labels até os receivers.

``` diagram-sim
flowchart LR
    R["Avaliação da regra<br/>Prometheus / ruler do Mimir"] --> F["Alerta disparado<br/>severity=page, team=checkout"]
    F --> G["Alertmanager<br/>agrupa · deduplica"]
    G --> S{"Silenciado ou<br/>inibido?"}
    S -->|sim| X["Descartado<br/>(ainda visível na UI)"]
    S -->|não| RT{"Roteia pelos labels"}
    RT -->|severity=page| PD["Pager<br/>celular do on-call"]
    RT -->|severity=page| SL["Slack #incidents"]
    RT -->|severity=ticket| TK["Fila de tickets"]
    PD --> ACK["On-call confirma<br/>ou escala após 5 min"]
```

```yaml
# alertmanager.yaml (sketch)
route:
  receiver: slack-observability          # default for anything unmatched
  group_by: [alertname, team]
  group_wait: 30s                        # wait to batch related alerts into one notification
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [severity="page"]
      receiver: pager-checkout
      continue: true                     # also evaluate the next route
    - matchers: [severity="page"]
      receiver: slack-incidents
    - matchers: [severity="ticket"]
      receiver: ticket-queue

inhibit_rules:
  - source_matchers: [alertname="RegionDown"]
    target_matchers: [severity=~"page|ticket"]
    equal: [region]                      # one page for the region, not fifty for its services

receivers:
  - name: pager-checkout
    pagerduty_configs:
      - routing_key_file: /etc/alertmanager/secrets/pager-checkout
  - name: slack-incidents
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-incidents
        channel: "#incidents"
  - name: slack-observability
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-observability
        channel: "#observability"
  - name: ticket-queue
    webhook_configs:
      - url: http://ticket-bridge:8080/alerts
```

| Mecanismo | O que faz | Uso no BoxOffice |
|---|---|---|
| **Agrupamento** | muitos alertas com os mesmos labels → uma notificação | 40 pods do `order` falhando → um page, não 40 |
| **Inibição** | um alerta suprime outros enquanto dispara | `RegionDown` silencia os alertas por serviço daquela região |
| **Silêncio** | cala alertas correspondentes por um período, com autor e motivo | manutenção planejada do banco na terça, 02h00–03h00 |
| **Escalonamento** (na ferramenta de paging) | se ninguém confirmar em N minutos, aciona o secundário, depois o gestor | primário dormindo ou sem sinal |

### Quem vigia o vigia? { #who-watches-the-watcher }

Se o Prometheus ou o Alertmanager cair, nada alerta — e o silêncio se parece exatamente com saúde. Duas proteções padrão:

- Um **dead man's switch**: uma regra que *sempre* dispara (`expr: vector(1)`, muitas vezes chamada `Watchdog`), enviada a um serviço externo que aciona o page se o sinal de vida **parar** de chegar.
- Alertas de **ausência de dados**: `absent(up{job="order"})` ou `absent_over_time(...)` disparam quando uma métrica some — um exporter caído, uma métrica renomeada, um job que deixou de ser coletado.

Para jornadas com pouco tráfego à noite, uma razão sobre zero requisições é indefinida; **probes sintéticas** (um check do k6 ou do Blackbox Exporter que compra um ingresso de teste num evento falso a cada minuto) mantêm o SLI significativo a qualquer hora.

---

## Runbooks

Todo page precisa apontar para um **runbook**: um documento curto que diz a um engenheiro cansado o que o alerta significa e o que tentar primeiro. Runbooks reduzem o MTTR porque os primeiros 10 minutos deixam de ser improviso.

```markdown
# CheckoutErrorBudgetFastBurn

**Meaning**: checkout is failing at more than 14.4x the rate the 99.9% SLO allows;
at this pace the 28-day budget is gone in about 2 days.

**Impact**: fans cannot buy tickets. During an on-sale, declare an incident immediately (SEV1).

**First checks (5 minutes)**
1. Checkout dashboard: which status codes? which route? since when? any deploy or flag change?
2. Payment provider panel: latency and error ratio of the provider call.
3. Open an exemplar trace of a failed checkout: which span fails or waits?

**Mitigations**
- Recent deploy → roll back (`argocd app rollback order`).
- Provider slow or failing → switch to the secondary provider (flag `payment.provider=secondary`).
- Database saturated → enable the waiting room (flag `waiting-room.enabled=true`).

**Escalate to**: payments team (secondary on-call), then the incident commander rotation.
```

### Máquinas detectam, pessoas reparam { #machines-detect-people-repair }

Um alerta não tira uma réplica quebrada do balanceador: um health check faz isso em segundos, e não acorda ninguém. O page é para o que uma máquina não consegue fazer sozinha — restaurar o que foi perdido antes que a próxima falha encontre o BoxOffice com menos redundância do que foi projetado para ter. É por isso que o runbook acima reduz o MTTR, e por isso que uma réplica que reinicia e se recupera sozinha não vale um page.

**Experimente.** No `observability-stack`, uma das três réplicas do `catalog` morre em t = 50 s e fica morta por 80 s. Adicione **Metrics** (conectado ao balanceador, à aplicação e ao banco) e um **Health Check** conectado ao balanceador, e rode: os erros duram 3 s, e a disponibilidade é de 99,4%. Agora adicione **Alerting** conectado ao Metrics e rode de novo.

<div class="sdp" data-scenario="observability-stack" data-mode="compact" data-height="520"></div>

??? question "O que você deveria ter observado?"

    A curva de erros não muda: a disponibilidade continua em 99,4%, porque o health check já tinha tirado a réplica morta da rotação após 3 s. O que muda é o reparo: com alguém acionado, a réplica volta em t = 90 s em vez de t = 130 s, e o BoxOffice roda com duas de suas três réplicas por 40 s em vez de 80 s. Sem o health check, o Alerting sozinho também não ajuda os fãs — o balanceador continua mandando um terço das requisições para a réplica morta por 30 s (93,8% de disponibilidade). Máquinas contornam uma falha em segundos; pessoas a reparam em minutos, e o alerta é o que dá início aos minutos.

---

## Trade-offs

| Decisão | Opção A | Opção B | Orientação |
|---|---|---|---|
| Sobre o que alertar | causas (CPU, reinícios) | sintomas (queima do SLO) | sintomas acionam pages; causas vão para dashboards e tickets |
| Limiares | razão de erros estática | burn rate em relação ao SLO | burn rate — o limiar acompanha a meta de negócio |
| Janelas | uma janela | janela longa + curta | multiwindow: preciso *e* reseta rápido |
| Sensibilidade | acionar cedo (mais alarmes falsos) | acionar tarde (mais budget perdido) | calibre pelo budget: queimas rápidas acionam page, lentas viram ticket |
| Notificação | tudo no Slack | page / ticket / dashboard por severidade | um canal que todo mundo silencia não é alerting |

!!! tip "Na entrevista"

    Quando o entrevistador perguntar "como você saberia se isso quebrou?", responda com um **SLO e o alerta de burn rate dele**, não com uma lista de métricas: *"SLO de checkout de 99,9% em 28 dias; page quando o burn rate de 1 hora passar de 14,4×, confirmado pela janela de 5 minutos, ticket para queimas lentas; todo alerta aponta para um runbook."* Mencione que você alerta sobre **sintomas** e usa dashboards e traces para as causas, e que um dead man's switch protege o próprio pipeline de alertas. É uma resposta de nível sênior em quatro frases.

!!! success "Boas práticas"

    - **Derive todo page de um SLO, e mantenha as regras como código** — o limite passa a seguir uma meta de negócio, e toda mudança é revisada. No BoxOffice: `infra/grafana/alerting/slo-catalog.yaml`, provisionado na inicialização (caixa acima).
    - **Tire do SLI os health checks e a sua própria carga sintética** — os orquestradores chamam `/actuator/health` a cada poucos segundos e ele quase nunca falha, inflando a taxa de sucesso com requisições que nenhum fã fez. No BoxOffice: `http_route!~"/actuator.*"` em toda consulta das regras do lab 8.
    - **Ponha o burn rate, as janelas e o link do runbook na notificação** — quem está de plantão julga a gravidade antes de abrir o notebook. No BoxOffice: a descrição *"Burn rate 18.2 (1 h) and 74.4 (5 min)"* do alerta do lab 8.
    - **Teste todo alerta causando a sua falha** — um alerta nunca visto disparando é uma hipótese; cronometre da falha ao page. No BoxOffice: o lab 8 para o `db` e registra *Pending* e *Firing* (288 s numa execução de teste).
    - **Combine cada alerta de SLO baseado em razão com uma verificação de "sem tráfego"** — com zero requisições a razão fica indefinida, então `noDataState: OK` mantém as noites silenciosas mas também esconde uma borda que não envia nada; acrescente um probe sintético ou um alerta de tráfego caindo a zero.

!!! warning "Armadilhas comuns"

    - **Acionar pages por causas**: CPU, memória e reinícios acordam pessoas à toa e as treinam a ignorar o pager.
    - **`for: 1h` para reduzir ruído**: também atrasa em uma hora o page de uma indisponibilidade total; use burn rates.
    - **Uma única janela de SLO para toda situação**: um budget de 28 dias não protege uma abertura de vendas de 30 minutos; dê aos eventos críticos o próprio SLO.
    - **Alertas sem runbook ou sem dono**: o alerta dispara, ninguém sabe o que fazer, o incidente dura mais.
    - **Sem dead man's switch**: a stack de monitoramento morre em silêncio, e o silêncio parece saúde.
    - **Nunca apagar alertas**: revise cada page depois do turno — se não era acionável, corrija ou apague.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    SLO["SLO 99.9% over 28 days<br/>→ SLIs, SLOs e error budgets"] --> BUD["error budget 0.1%"]
    SLI["SLI from metrics<br/>(RED, histograms)"] --> BR["burn rate =<br/>error ratio ÷ budget"]
    BUD --> BR
    BR --> MW["multiwindow rules:<br/>14.4× and 6× page, 1× ticket"]
    MW --> AM["Alertmanager: group,<br/>inhibit, silence, route"]
    AM --> PAGE["page + runbook"]
    AM --> TK["ticket"]
    PAGE --> IR["Incident Response"]
    DMS["dead man's switch,<br/>absent(), synthetic probes"] --> AM
    MW -.-> ONS["on-sale SLO,<br/>short windows"]
```

**Componentes da paleta:** [`alerting`](../../../reference/components/observability/index.md#alerting) · [`metrics`](../../../reference/components/observability/index.md#metrics) (o SLI e as recording rules) · [`payment`](../../../reference/components/external/index.md#payment) (o provedor lento que queima o budget da abertura de vendas) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (um disco de broker enchendo: ticket, não page). **Cenários:** `observability-stack`, `flash-sale` (uma abertura de vendas de 30 minutos precisa do próprio SLO). **Continua em:** [SLIs, SLOs e error budgets](../slo/index.md) (SLI, SLO, política de error budget), [Resposta a Incidentes](../incident-response/index.md), [Cloud-native — entrega](../../cloud-native/delivery/index.md) (rollbacks citados no runbook), [Hands-on 8 — SLO e alerta de burn rate](../../../hands-on/8/slo/index.md).

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Um page precisa ser **urgente, acionável e visível para o usuário**; todo o resto é ticket, dashboard ou nada.
    - Alerte sobre **sintomas** derivados do **SLO**; as causas servem ao diagnóstico.
    - **Burn rate** = razão de erros observada ÷ error budget; com uma janela de 28 dias, 14,4× gasta cerca de 2% do budget numa hora (14,4 ÷ 672 h).
    - Use regras **multiwindow, multi-burn-rate**: 14,4× (1 h + 5 min) e 6× (6 h + 30 min) acionam page, 1× (3 d + 6 h) abre um ticket.
    - O **Alertmanager** agrupa, deduplica, inibe, silencia e roteia; um **dead man's switch** e alertas de **absent()** vigiam o vigia.
    - Todo alerta tem um **dono** e um **runbook**.

---

[^1]: EWASCHUK, R. *My Philosophy on Alerting*. Google, 2013. Suas regras estão resumidas em BEYER, B. et al. [Site Reliability Engineering — Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/){target="_blank"}. O'Reilly, 2016. Capítulo 6.
[^2]: BEYER, B. et al. [The Site Reliability Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/){target="_blank"}. O'Reilly, 2018. Capítulo 5.
[^3]: PROMETHEUS. [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/){target="_blank"} e [Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/){target="_blank"}.
