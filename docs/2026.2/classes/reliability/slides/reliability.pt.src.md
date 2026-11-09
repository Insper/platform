---
marp: true
lang: pt-BR
title: Confiabilidade
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Confiabilidade

**Falhar de forma controlada, recuperar rápido, limitar o raio de impacto**

<!--
Roteiro: (1) visão geral: disponibilidade, os noves, disponibilidade composta, modos de falha, falhas
em cascata; (2) SLI / SLO / SLA: medição, metas, error budget, burn rate e alertas com várias janelas,
contratos; (3) padrões de resiliência: timeout e seu orçamento, retry, circuit breaker, fallback,
bulkhead, rate limiting, health checks, camadas; (4) engenharia do caos: provar que os padrões funcionam.
Três simuladores: slo-month e error-budget-burn (SLI / SLO / SLA), slow-dependency (Padrões de Resiliência).
-->

---

## Black Friday, uma dependência lenta

<div class="q">

Produtos saudáveis, banco saudável — mas o **provedor de pagamentos** responde em **3 s em vez de 100 ms**.
Em menos de um minuto o gateway para de responder **tudo**: login, catálogo, carrinho. Por quê?

</div>

- Ninguém escreveu um bug: o sistema **não tinha defesa contra uma dependência lenta**.
- Um sistema confiável não é aquele que nunca falha: ele **falha de forma controlada, se recupera rápido** e **limita o raio de impacto** (os usuários e componentes afetados por uma falha).
- Esta aula: decidir **com números** quanta falha é aceitável e construir as defesas.

<!--
Confiabilidade: a probabilidade de um sistema executar sua função sem falhar, sob condições
definidas, por um período. Roteiro: visão geral → SLI/SLO/SLA → padrões de resiliência → engenharia do caos.
-->

---

## Disponibilidade: duas alavancas

Confiabilidade é quão raramente o sistema falha; **disponibilidade** é a fração do tempo em que ele funciona — cair 1 s a cada minuto: pouco confiável, mas ~98% disponível.

| Termo | Nome completo | Significado |
|---|---|---|
| **MTTF** | Mean Time To Failure | tempo médio de operação até uma falha |
| **MTTR** | Mean Time To Repair | tempo para detectar, diagnosticar e restaurar |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — o ciclo completo |

> Disponibilidade = MTTF / (MTTF + MTTR)

- **↑ MTTF** — prevenir falhas: projeto tolerante a falhas, testes, redundância.
- **↓ MTTR** — recuperar mais rápido: resposta a incidentes, automação, runbooks.

<p class="small">Serviço de pedidos: MTTF 720 h, MTTR 2 h → 99,72%. Falhas pela metade → 99,86%. Reinício automático em 1 min → 99,998%: recuperar mais rápido foi o ganho maior e mais barato.</p>

---

## Os "noves"

| Disponibilidade | Por ano | Por mês (30,44 d) | Por 28 dias |
|---|---|---|---|
| 99% ("dois noves") | 3,65 dias | 7,31 horas | 6,72 horas |
| 99,9% ("três noves") | 8,77 horas | 43,8 minutos | 40,3 minutos |
| 99,95% | 4,38 horas | 21,9 minutos | 20,2 minutos |
| 99,99% ("quatro noves") | 52,6 minutos | 4,38 minutos | 4,03 minutos |
| 99,999% ("cinco noves") | 5,26 minutos | 26,3 segundos | 24,2 segundos |

- Cada nove é um **corte de 10×** na indisponibilidade permitida; com cinco noves, detecção e recuperação precisam ser **totalmente automatizadas**.

<div class="warn">

**Sempre informe a janela**: 99,9% permite 43,8 min num mês de calendário, mas 40,3 min em 28 dias.

</div>

---

## Disponibilidade composta

- **Em série** (todos os componentes necessários): as disponibilidades se **multiplicam** — gateway → order → product com 99,9% cada: `0.999³ ≈ 99.7%`.
- **Em paralelo** (qualquer uma de n réplicas): `1 − (1 − a)ⁿ` — dois gateways com 99%: `1 − 0.01² = 99.99%`, só se as falhas forem **independentes**.

<div class="flow" style="align-items: stretch">
<div class="box" style="display: flex; flex-direction: column; justify-content: center">Nginx<small>99,99% (premissa)</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">em paralelo · 99,99%</div>
<div class="box green">gateway 1<small>99%</small></div>
<div class="box green">gateway 2<small>99%</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">order<small>99,9% · uma réplica</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">product<small>99,9% · uma réplica</small></div>
</div>

<div class="ok">

Caminho inteiro ≈ **99,78%** ≈ **19 h de indisponibilidade por ano** — quase tudo de order e product. Um terceiro gateway economiza menos de uma hora; replicar os **elos mais fracos** elimina a maior parte.

</div>

<!--
O exemplo resolvido da página: reduza primeiro a parte em paralelo e depois multiplique a série. O
Hands-on 7 roda todas as réplicas num notebook só: um host, então não são independentes.
-->

---

<!-- _class: tight -->

## Modos de falha

Duas propriedades: **quanto dura** (transitória, intermitente, permanente) e **como se comporta** (queda, lentidão, bizantina). **Falhas parciais** são a regra.

| Classe de falha | Características | Estratégia |
|---|---|---|
| **Transitória** | some em segundos; retry é seguro | retry com backoff exponencial e jitter |
| **Intermitente** | aparece e some, sem gatilho claro | histogramas de latência no percentil 99 (P99); alertas de anomalia |
| **Permanente (crash-stop)** | o nó para e não volta sozinho | health checks + failover; circuit breaker enquanto isso |
| **Lenta** | responde, mas tarde; continua parecendo vivo | timeout + circuit breaker (chamadas lentas) + bulkhead |
| **Bizantina** | retorna dados errados sem cair | consenso; checksums; validação de entrada |

<p class="small">A falha mais comum não é uma queda, mas uma resposta <b>lenta</b>: quem chama não distingue lento de morto e continua esperando — e um nó lento prende os recursos de quem chama.</p>

---

## Falhas em cascata

Uma dependência lenta esgota **threads, conexões e memória** de quem a chama — e o esgotamento sobe a cadeia.

- **Lei de Little**: requisições em andamento = taxa de chegada × tempo de cada uma.
- 60 pedidos/s × 100 ms por chamada de pagamento → **6** threads esperando o pagamento.
- 60 pedidos/s × 3 s → **180** das **200** threads do Tomcat: as chegadas vêm em rajadas, o pool enche de vez em quando e `GET /orders/42`, que nem precisa de pagamento, recebe `503`.
- Se o gateway espera pelo order, o esgotamento sobe mais um nível.

<div class="warn">

Armadilhas: **sem timeout**; **retry às cegas**; **um pool compartilhado** por todas as dependências; **supor independência** (duas réplicas no mesmo nó caem juntas). A resposta: **timeouts, circuit breakers, bulkheads**.

</div>

---

## SLI → SLO → SLA

"A loja é confiável o bastante?" — lançar o novo checkout ou congelar os deploys? Sem números, é opinião contra opinião.

| Termo | Nome completo | Natureza |
|---|---|---|
| **SLI** | Service Level Indicator | uma métrica mensurável |
| **SLO** | Service Level Objective | uma meta interna para essa métrica |
| **SLA** | Service Level Agreement | um compromisso contratual com clientes |

<div class="flow">
<div class="box">telemetria<small>37.800 de 28 mi falharam</small></div><div class="arrow">→</div>
<div class="box accent">SLI<small>99,87%</small></div><div class="arrow">→</div>
<div class="box orange">SLO ≥ 99,9%<small>violado · 135% do orçamento</small></div><div class="arrow">→</div>
<div class="box green">SLA ≥ 99,5%<small>respeitado · sem créditos</small></div><div class="arrow">→</div>
<div class="box orange">congelar deploys</div>
</div>

<p class="small">Uma janela de 28 dias do serviço de pedidos: deploy ruim + failover do banco (simulador <code>slo-month</code>). A prática de engenharia de confiabilidade de sites (SRE, <em>site reliability engineering</em>) do Google.</p>

---

## Simulador: um mês contra o SLO e o SLA

<div class="q">

O serviço de pedidos ao longo de 28 dias: **28 mi** de requisições, SLO 99,9% (orçamento de **28.000** falhas), SLA 99,5%.

</div>

- **Deploy ruim** (dia 9, 20.000 falhas): SLI **99,92%** — SLO mantido, mas **81%** do orçamento já se foi e restam só **5.200** falhas.
- **+ failover** (dia 19, 3% por 12 h): orçamento esgotado no **dia 19 · 11h**, janela em **99,87%** — congelar deploys; o SLA ainda tem **102.200** falhas de margem.
- **Queda da região** (4 h, todas as requisições falham): **99,39%**, abaixo do SLA — os clientes têm direito a créditos.
- **SLO = SLA** (99,5%): orçamento e contrato quebram juntos, **dia 14 · 13h** — sem aviso. **SLO 99,95%**: só o deploy ruim já é **163%** do orçamento.

<p class="small">Página SLI / SLO / SLA → início, simulador <code>slo-month</code>.</p>

---

<!-- _class: tight -->

## SLI: a medição bruta

> SLI = eventos bons / eventos válidos × 100% — p. ex. `GET /products` sem 5xx em menos de 300 ms.

| Categoria | Exemplo de medição |
|---|---|
| **Disponibilidade** | `non-5xx responses / total HTTP requests` |
| **Latência** | `requests faster than 200 ms / total` (meta de 95% = percentil 95, P95, < 200 ms) |
| **Taxa de erros** | `HTTP 5xx / total` (o complemento da disponibilidade) |
| **Durabilidade** · **Atualidade** | leituras com sucesso / tentadas · tempo desde a última atualização |

- Coletado via Actuator/Micrometer (`http_server_requests_seconds_count`), sondas sintéticas, logs de acesso ou no cliente.

<div class="warn">

CPU, tamanho do heap e pausas de coleta de lixo (GC, *garbage collection*) são **métricas de vaidade**: 95% de CPU pode atender todos; 10% de CPU pode estar fora do ar.

</div>

---

## SLO: a meta com que você se compromete

`SLI ≥ threshold` numa **janela móvel** (os últimos N dias, que avança a cada minuto) — não numa janela de calendário que zera no dia 1º.

| SLO | Significado |
|---|---|
| `Availability ≥ 99.9%` em 28 dias | no máximo 0,1% das requisições falha em quaisquer 28 dias |
| `P95 latency ≤ 200 ms` em 7 dias | 95% das requisições em até 200 ms |
| `Error rate ≤ 0.5%` em 24 horas | no máximo 5 em 1000 requisições retornam 5xx |

- **Ambicioso, mas alcançável**: nunca violado = frouxo demais; sempre violado = ruído.
- Meça 30–90 dias, comece na linha de base menos uma pequena folga e aperte com o tempo.
- Um serviço não promete mais do que o **produto** das suas dependências síncronas.

---

## Error budget

> Error budget = 1 − meta do SLO — a **licença para assumir riscos** da equipe.

99,9% em 28 dias → **≈ 40,3 minutos**, ou **28.000** requisições com falha em 28 milhões (um deploy ruim com 20.000 erros queima ~71% de uma vez).

<div class="cols">
<div>

### Orçamento intacto

- fazer deploys com frequência
- rodar experimentos em produção
- assumir alguma dívida técnica

</div>
<div>

### Orçamento esgotado

- congelar deploys não essenciais
- confiabilidade antes de funcionalidades
- corrigir as causas-raiz

</div>
</div>

<p class="small">Só funciona com uma <b>política de error budget</b> combinada antes entre produto e engenharia.</p>

<!--
Exemplo de negociação da página: "restam 12 minutos de orçamento na janela; um deploy que cause 30
minutos de degradação viola o SLO — espere."
-->

---

<!-- _class: tight -->

## Burn rate

`burn rate = observed error rate ÷ (1 − SLO)` — com SLO de 99,9%, 1,44% de erros = 14,4×. Num período *t*, gasta *b · t / janela* do orçamento.

| Burn rate | Orçamento de 28 dias acaba em | Alertar quando durar | Gasto até lá | Ação |
|---|---|---|---|---|
| 1× | 28 dias | 3 dias | ~10% | 🟡 ticket |
| 6× | ~4,7 dias | 6 horas | ~5% | 🔴 page |
| 14,4× | ~1,9 dia (~47 h) | 1 hora | ~2% | 🔴 page imediato |
| 1000× (tudo falha) | ~40 minutos | — | — | 🔴 o page de 1 h dispara em ~1 min |

- Os pares do SRE Workbook, derivados para 30 dias (14,4 × 1 h / 720 h = 2%); com 28 dias: 2,1%, 5,4%, 10,7%.
- Alerte sobre um **sintoma que o usuário sente** (erros queimando o orçamento), não sobre uma causa como CPU.

---

## Alertas com várias janelas: rápidos para disparar e para parar

<div class="flow">
<div class="box">taxa de erro<small>em várias janelas</small></div><div class="arrow">→</div>
<div class="box red">1 h <b>e</b> 5 min &gt; 14,4×<small>page · 2% em 1 h</small></div><div class="arrow">senão →</div>
<div class="box red">6 h <b>e</b> 30 min &gt; 6×<small>page · 5% em 6 h</small></div><div class="arrow">senão →</div>
<div class="box orange">3 d <b>e</b> 6 h &gt; 1×<small>ticket · 10% em 3 dias</small></div><div class="arrow">senão →</div>
<div class="box green">nenhum alerta<small>o orçamento absorve</small></div>
</div>

- A janela **longa** prova que uma parte real do orçamento foi gasta; a **curta** (1/12 dela) prova que ele **ainda** está queimando.
- Uma única janela de 1 hora continua acionando durante boa parte da hora seguinte à correção.
- Nada de durações `for:`: não acompanham a gravidade e recomeçam quando a taxa cai.

<p class="small">PromQL: a taxa de 1 h <code>&gt; (14.4 * 0.001)</code> <b>and</b> a taxa de 5 min <code>&gt; (14.4 * 0.001)</code> sobre <code>http_server_requests_seconds_count{job="OrderMetrics"}</code>.</p>

---

## Simulador: quem é acionado e quando?

<div class="q">

O serviço de pedidos (1 mi de requisições/dia, SLO 99,9%, orçamento de 28.000 erros) contra quatro incidentes e as três regras.

</div>

- **Deploy ruim** (48% por 1 h): **480×**, **71%** do orçamento; page depois de **2 min**, silêncio **4 min** depois do rollback — uma regra de janela única segue acionando por **58 min**.
- **Falha parcial** (2% por 6 h, 20×): page depois de **44 min**; **18%** do orçamento.
- **Vazamento lento** (0,3% por 3 dias, 3×): nunca aciona o plantão, gasta **32%** — só o ticket, depois de **22,4 h**.
- **Soluço curto** (10% por 5 min): nada dispara, **1,2%** — é para isso que o orçamento existe.

<p class="small">Página SLI / SLO / SLA → "Alertas com várias janelas", simulador <code>error-budget-burn</code>.</p>

---

## SLA: o compromisso contratual

Um acordo jurídico: serviços cobertos · metas de SLO · medição · exclusões · **remédios** (créditos de serviço).

| Provedor | Serviço | Uptime mensal |
|---|---|---|
| AWS | EC2 (nível de região) | 99,99% |
| AWS | S3 Standard | 99,9% |
| AWS | RDS Multi-AZ | 99,95% |
| Google Cloud / Azure | VMs em várias zonas | 99,99% |

<div class="ok">

Os números maiores exigem que **você** faça deploy redundante. O remédio é um crédito na fatura, não as suas vendas perdidas.

</div>

---

## SLA vs SLO

| | SLO | SLA |
|---|---|---|
| **Público** | equipe de engenharia | cliente / negócio |
| **Natureza** | meta interna | contrato jurídico |
| **Rigor** | maior (mais estrito) | menor (mais tolerante) |
| **Violação** | trabalho de confiabilidade, congelamento | créditos de serviço, multas |

<div class="ok">

Defina o **SLO mais estrito que o SLA**: SLA 99,9% → SLO 99,95%. A diferença é a margem de segurança.

</div>

---

## Boas práticas e armadilhas

- **Poucos SLIs, significativos**: comece por disponibilidade e latência P99.
- **Janelas móveis de 28 dias**: sempre o mesmo número de dias úteis e de fins de semana.
- **Dashboards de SLO automatizados** (Grafana + Prometheus); **revise os SLOs a cada trimestre**.
- **Nunca defina um SLO de 100%**: não sobra espaço para manutenção nem deploys seguros.

<div class="warn">

**Medir a coisa errada**: um SLI do health check nada diz sobre `POST /orders`. **Médias**: 80 ms de média podem esconder 5% esperando 4 s. **Janelas misturadas** (30 vs. 28 dias). **Uma única janela longa no alerta**. **SLO sem política**: só um número no dashboard.

</div>

---

<!-- _class: tight -->

## Padrões de resiliência

Eles não evitam falhas; eles **limitam até onde uma falha se espalha**. Exemplo contínuo: **order** chama **product** (OpenFeign) para conferir preços.

| Padrão | Pergunta que responde | Protege contra |
|---|---|---|
| **Timeout** | quanto tempo aceito esperar? | chamadas penduradas |
| **Retry** | vale a pena tentar de novo? | falhas transitórias |
| **Circuit breaker** | devo sequer tentar? | uma dependência sabidamente fora |
| **Fallback** | o que respondo no lugar? | perda total de uma funcionalidade |
| **Bulkhead** | quanto da minha capacidade uma dependência pode tomar? | esgotamento de recursos se espalhando |
| **Rate limiting** | quanto tráfego eu aceito? | picos, clientes abusivos |
| **Health checks** | o tráfego deve chegar a esta instância? | rotear para instâncias quebradas |

---

## Timeout

Um prazo em toda chamada de saída: limita o estrago de uma chamada lenta (um gateway que desiste responde `504`).

- **Por percentil**: perto do **P99.9** do downstream em condições normais.
- **Dentro do orçamento** do prazo de quem chama, retries incluídos. **Por dependência**: um valor global quase sempre está errado.
- Dois timeouts: **connect** (abrir a conexão TCP) e **read** (esperar a resposta).

```yaml
spring.cloud.openfeign.client.config:
  product:                  # the @FeignClient name
    connect-timeout: 500    # ms
    read-timeout: 1000      # ms
```

<p class="small">Sozinho, o timeout transforma um travamento num erro rápido: combine-o com retry, circuit breaker e fallback.</p>

---

## O orçamento de timeout entre saltos

<div class="flow">
<div class="box">gateway<small>espera 3 s</small></div><div class="arrow">→</div>
<div class="box">tentativa 1<small>timeout em 1 s</small></div><div class="arrow">0,5 s →</div>
<div class="box">tentativa 2<small>timeout em 2,5 s</small></div><div class="arrow">1 s →</div>
<div class="box red">gateway desiste<small>3 s · 504 para o cliente</small></div><div class="arrow">→</div>
<div class="box muted">tentativa 3<small>falha em 4,5 s · para ninguém</small></div>
</div>

- Order → product com as configurações da página: 1 + 0,5 + 1 + 1 + 1 = **4,5 s** no pior caso, mas o gateway espera **3 s**.
- A terceira tentativa é trabalho desperdiçado e carga extra sobre um serviço com dificuldades.
- Ajuste: **2 tentativas** (2,5 s), um read timeout menor ou um **prazo** enviado com a requisição (gRPC).

<div class="ok">

Regra: **tentativas × timeout + esperas** precisam caber no prazo de quem chama.

</div>

---

## Retry com backoff exponencial e jitter

Só faça retry de falhas **transitórias**, espaçado, para que um serviço reiniciando não leve uma *thundering herd*:

- **Backoff exponencial**: `wait = min(c · 2ⁿ, max_wait)` → 1 s, 2 s, 4 s, 8 s, 16 s (teto): retries em t = 1, 3, 7, 15, 31 s.
- Clientes que falharam juntos ainda repetem juntos → adicione **jitter**.
- **Full jitter** (Marc Brooker, AWS): `wait = random(0, min(c · 2ⁿ, max_wait))` — 1.000 clientes espalhados uniformemente em vez de 1.000 requisições em t = 1 s, 3 s e 7 s.

| Resposta | Retry? |
|---|---|
| conexão recusada / resetada, timeout | sim |
| `503`, `429` | sim, com backoff (respeite o `Retry-After`) |
| `500` | talvez, uma vez — costuma ser bug |
| `400`, `401`, `403`, `404`, `422` | não — a própria requisição está errada |

---

## Retry com segurança

<div class="flow">
<div class="box">1 clique</div><div class="arrow">→</div>
<div class="box">gateway<small>3 tentativas</small></div><div class="arrow">3 chamadas →</div>
<div class="box">order<small>3 tentativas cada</small></div><div class="arrow">9 chamadas →</div>
<div class="box">cliente Feign<small>3 tentativas cada</small></div><div class="arrow">27 chamadas →</div>
<div class="box red">product<small>já com dificuldades</small></div>
</div>

- **Amplificação de retries**: faça retry em **uma** camada, limite as tentativas e pare quando o breaker estiver aberto.
- Repetir `POST /orders` pode criar **duplicatas**: só faça retry de operações **idempotentes** (`GET`, `PUT`, `DELETE`) — fazer duas vezes tem o mesmo efeito que uma.
- **Chave de idempotência**: o cliente envia um UUID por operação lógica (`Idempotency-Key: k-42`); o servidor guarda as chaves processadas e, numa repetição, devolve o resultado guardado — o mesmo pedido, sem duplicata.

---

<!-- _class: tight -->

## Circuit breaker

<div class="flow">
<div class="box green">Closed<small>chamadas passam · últimas 10 registradas</small></div><div class="arrow">≥ 50% com falha ou lentas →</div>
<div class="box red">Open<small>rejeita em &lt; 1 ms · sem chamada de rede</small></div><div class="arrow">30 s, próxima chamada →</div>
<div class="box orange">Half-Open<small>3 chamadas de teste</small></div><div class="arrow">testes OK → Closed<br>testes ruins → Open</div>
</div>

| Propriedade do Resilience4j | Padrão | Típico |
|---|---|---|
| `failure-rate-threshold` | 50% | 50% |
| `sliding-window-size` · `minimum-number-of-calls` | 100 · 100 | 10–20 |
| `slow-call-duration-threshold` · `slow-call-rate-threshold` | 60 s · 100% | **abaixo do timeout** · 50% |
| `wait-duration-in-open-state` | 60 s | 10–60 s |
| `permitted-number-of-calls-in-half-open-state` | 10 | 3–5 |

<p class="small">Chamadas lentas têm a própria taxa: com o padrão de 100% elas só abrem o breaker quando todas as chamadas da janela são lentas.</p>

---

<!-- _class: tight -->

## Circuit breaker + retry com Resilience4j

<div class="cols">
<div>

```java
// default order: Retry ( CircuitBreaker ( call ) )
@Retry(name = "product", fallbackMethod = "priceFallback")
@CircuitBreaker(name = "product")
public ProductOut findProduct(String id) { ... }
```

- Fallback no `@Retry`, o **externo**: roda uma vez, depois dos retries ou na hora quando está Open.
- Limite de chamada lenta **abaixo** do timeout de 1 s.
- `CallNotPermittedException` **sem retry**.
- Spring Boot 4: `resilience4j-spring-boot4` + `spring-boot-starter-aspectj`.

</div>
<div>

```yaml
circuitbreaker.instances.product:
  sliding-window-size: 10
  minimum-number-of-calls: 10
  failure-rate-threshold: 50
  slow-call-duration-threshold: 500ms
  slow-call-rate-threshold: 50
  wait-duration-in-open-state: 30s
  permitted-number-of-calls-in-half-open-state: 3
retry.instances.product:
  max-attempts: 3            # waits 500 ms, 1 s
  enable-exponential-backoff: true
  enable-randomized-wait: true   # ± 50%
  retry-exceptions: [feign.RetryableException]
  ignore-exceptions: [...CallNotPermittedException]
```

</div>
</div>

---

## Simulador: um serviço de produtos lento

<div class="q">

Order (200 threads, 60 POST /orders/s + 40 GET /orders/s) chama product, que responde em **3 s** de 10 s a 70 s.

</div>

- **Sem padrão**: ~**176** threads ocupadas (60 × 3 s), pool cheio em **8** s → só **98,4%** dos `GET /orders` OK.
- **Timeout**: ~**60** threads, `GET /orders` **100%** — todo pedido falha depois de 1 s.
- **+ Retry**: pool cheio por **51** s, `GET /orders` **71,2%**, product recebe **128** chamadas/s em vez de 60 — **pior do que nada**.
- **+ Breaker**: abre **1,1 s** depois da falha, pedidos falham em < 1 ms, ~**2** threads ocupadas; fecha em t = **72,2 s**, 2,2 s depois da recuperação.

<p class="small">Página Padrões de Resiliência → "Experimente", simulador <code>slow-dependency</code>. Teste também "product fora": timeout + retry manda 3,0 chamadas por pedido.</p>

---

## Fallback e degradação graciosa

O que quem chama faz **no lugar** quando a chamada falha ou o breaker está aberto: **perder uma funcionalidade, não a página inteira**.

| Dependência fora | Fallback possível na loja |
|---|---|
| Serviço de recomendações | "mais vendidos" em cache no Redis |
| Serviço de produtos, leituras | últimos dados em cache, marcados como possivelmente desatualizados |
| Serviço de notificações | publicar o pedido de e-mail no Kafka e enviar depois |
| Serviço de pagamentos | sem fallback seguro: um `503` rápido e claro |

<div class="warn">

Um fallback precisa ser **seguro e simples**: um fallback remoto também pode falhar; cobrar um cartão ou reservar estoque **nunca** pode ser fingido.

</div>

---

<!-- _class: tight -->

## Bulkhead e rate limiting

<div class="cols">
<div>

### Bulkhead

Compartimentos estanques: **um teto por dependência**.

<div class="flow">
<div class="box red">pagamento<small>10 vagas cheias · chamada 11 rejeitada na hora</small></div>
<div class="box green">estoque<small>10 vagas próprias · 200 OK em 30 ms</small></div>
</div>

<p class="small">Custo: capacidade que não se compartilha — uma rajada num pool é recusada enquanto outros ficam ociosos. Dimensione com a lei de Little. Resilience4j: <b>semáforo</b> (<code>max-concurrent-calls</code>, padrão 25) ou <b>pool de threads</b>.</p>

</div>
<div>

### Rate limiting

**Token bucket**: reposição = vazão contínua, capacidade = rajada; vazio → `429`.

```nginx
limit_req_zone $binary_remote_addr
    zone=api:10m rate=10r/s;
limit_req zone=api burst=20 nodelay;
```

<p class="small">O Nginx usa um <b>leaky bucket</b>; com <code>nodelay</code>, 20 requisições extras passam na hora e depois 10/s. Por usuário ou chave de API: no gateway.</p>

</div>
</div>

---

## Health checks

| Probe | Pergunta | Quando falha |
|---|---|---|
| **Liveness** | o processo está vivo (não travado)? | o orquestrador **reinicia** o container |
| **Readiness** | consegue atender tráfego agora? | **sai do balanceador**, sem reiniciar |
| **Startup** (K8s) | terminou de iniciar? | liveness e readiness esperam — uma JVM lenta não morre no boot |

<p class="small">Actuator: <code>/actuator/health/liveness</code> e <code>/readiness</code>, habilitados por padrão no Spring Boot 4 (do 2.3 ao 3.x só no Kubernetes; fora dele, <code>management.endpoint.health.probes.enabled=true</code>).</p>

<div class="warn">

**Nunca coloque dependências externas na liveness**: uma oscilação de 10 s do banco reiniciaria **todas as réplicas de uma vez**. Cuidado até com a readiness: todas as réplicas fora = o serviço some.

</div>

---

## Defesa em profundidade

<div class="flow">
<div class="box">rate limiter<small>borda: Nginx, gateway</small></div><div class="arrow">→</div>
<div class="box accent">retry<small>mais externo</small></div><div class="arrow">→</div>
<div class="box accent">circuit breaker<small>conta cada tentativa</small></div><div class="arrow">→</div>
<div class="box accent">bulkhead<small>limita threads</small></div><div class="arrow">→</div>
<div class="box accent">timeout<small>limita cada tentativa</small></div><div class="arrow">→</div>
<div class="box">product</div>
</div>

- **Retry fora do breaker**: um breaker aberto interrompe os retries na hora.
- **Breaker fora do timeout**: timeouts contam como falhas. **Timeout mais interno**: limita cada tentativa, não a soma.
- Padrão do Resilience4j: `Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call)))))`; handler padrão do .NET: rate limiter → timeout total → retry → breaker → timeout por tentativa.

<p class="small">Depois confira se tentativas × timeout + esperas cabem no prazo de quem chama — e verifique tudo com experimentos de caos.</p>

---

## Engenharia do caos

<div class="q">

Timeouts, um breaker e um fallback em order → product. **Eles funcionam?** Ninguém nunca viu o breaker abrir em produção.

</div>

- **Experimentar** num sistema para ganhar confiança de que ele suporta condições turbulentas em produção.
- Amazon, início dos anos 2000: os **GameDays** de Jesse Robbins. Netflix, migrando para a AWS: o **Chaos Monkey** (~2010) mata instâncias aleatórias em produção, **em horário comercial**.
- Abril de 2011: uma grande falha em `us-east-1` — a Netflix seguiu no ar. Depois, o **Simian Army**: Latency Monkey, Chaos Gorilla (uma Availability Zone inteira)…

> "The best way to avoid failure is to fail constantly." — John Ciancutti, Netflix, 2010

---

## Princípios da engenharia do caos

1. **Hipótese sobre o estado estável** — saídas mensuráveis (SLIs): taxa de requisições, taxa de erros, latência.
2. **Variar eventos do mundo real** — quedas, partições, disco cheio, desvio de relógio, timeouts, picos.
3. **Rodar experimentos em produção** — staging não reproduz carga, dados nem dependências.
4. **Automatizar para rodar continuamente** — novos deploys reintroduzem fraquezas.
5. **Minimizar o raio de impacto** — o mínimo de usuários; amplie só depois que experimentos pequenos passarem.

<p class="small">Registrados por engenheiros da Netflix: principlesofchaos.org e um artigo da IEEE Software (2016).</p>

---

<!-- _class: tight -->

## Um experimento na loja

**Hipótese** → **Projeto** → **Injeção** → **Observação** → **Análise** → **Melhoria** e repita com escopo maior.

| Passo | Conteúdo |
|---|---|
| **Estado estável** | `GET /orders` ≥ 99,9%, P95 < 300 ms; `POST /orders` P95 < 500 ms (Grafana, Hands-on 6) |
| **Hipótese** | product com 3 s → o breaker abre em até 10 s, `POST /orders` falha rápido com `503`, `GET /orders` mantém o estado estável |
| **Injeção** | Toxiproxy entre order e product, toxic `latency` de 3 s — primeiro no Compose, depois numa réplica |
| **Raio de impacto** | um ambiente, 10 minutos, abortar se `GET /orders` < 99% |
| **Observação** | estado do breaker, taxa de erros e P95 por rota, threads ocupadas, traces no Jaeger |
| **Descobertas?** | sem read timeout no Feign (padrão 60 s): as chamadas levam 3 s e *dão certo*, o breaker nunca abre sem taxa de chamada lenta; retries multiplicam as chamadas |

<p class="small">Uma hipótese confirmada é evidência; uma <b>refutada</b> é uma descoberta — um bug achado nos seus termos.</p>

---

<!-- _class: tight -->

## Injeção de falhas e raio de impacto

| Categoria | Exemplos | Ferramentas |
|---|---|---|
| **Processo / instância** | matar container, matar por falta de memória (OOM), encerrar VM | Chaos Monkey, LitmusChaos |
| **Rede** | latência, perda de pacotes, partição | Toxiproxy, Gremlin, Chaos Mesh |
| **Recurso** | saturar CPU, encher disco, esgotar memória | stress-ng, Gremlin |
| **Dependência** | HTTP 500, timeouts, respostas malformadas | WireMock, Toxiproxy |
| **Estado** | corromper registros, reverter um deploy, expirar certificados | manual, Gremlin |
| **Infraestrutura** | perder uma Availability Zone ou uma região | Chaos Gorilla, AWS Fault Injection Service (FIS) |

**Raio de impacto**: testes → staging/canário → **1% do tráfego** → produção completa. Controles: feature flags, horário comercial, **aborto automático** por SLI, tráfego espelhado.

---

## GameDay e ferramentas

Um **GameDay** é um exercício planejado, com toda a equipe — tanto de processo quanto de tecnologia:

1. **Briefing** do cenário (ou mantido em segredo: um *GameDay surpresa*).
2. **Execução**: injetar; monitorar, seguir os runbooks, comunicar como num incidente real.
3. **Observação** do tempo para detectar e para recuperar e de quais runbooks ajudaram.
4. **Debriefing**: um post-mortem **sem culpados** — uma lista de melhorias, não de culpados.

<p class="small">Ferramentas: Chaos Monkey (Netflix), Gremlin (SaaS), LitmusChaos e Chaos Mesh (Cloud Native Computing Foundation, nativos de Kubernetes), Toxiproxy (Shopify, testes de integração), AWS FIS (IAM, condições de aborto).</p>

---

## Observabilidade primeiro

Antes de qualquer experimento, a equipe precisa **medir** o estado estável (dashboards de SLI), **detectar** desvios (dashboards em segundos, alertas de burn rate em minutos), **atribuir** causas (tracing) e **abortar** com segurança (kill switch).

<div class="ok">

**Observabilidade primeiro**, depois padrões de resiliência, depois experimentos de caos para provar que os padrões funcionam.

</div>

<div class="warn">

Armadilhas: caos **sem hipótese** é só quebrar coisas; **começar em produção** (é o objetivo, não o primeiro passo); **sem botão de aborto**; **não corrigir nada** — descobertas que nunca viram tickets só consumiram error budget.

</div>

---

## Pontos-chave

1. Disponibilidade = MTTF / (MTTF + MTTR); recuperar mais rápido costuma ser o ganho mais barato. Em série as disponibilidades se **multiplicam**; em paralelo, `1 − (1 − a)ⁿ`; os **elos mais fracos** decidem.
2. Cada **nove** a mais é 10× menos indisponibilidade — sempre informe a **janela**.
3. Dependências **lentas** esgotam threads e provocam **falhas em cascata**.
4. **SLI** mede, **SLO** define a meta, **SLA** é contrato (mais frouxo que o SLO); o **error budget** (≈ 40,3 min a cada 28 dias com 99,9%) e os **alertas de burn rate com várias janelas** decidem entre funcionalidades e confiabilidade.
5. Timeout (dentro do orçamento de quem chama), retry + full jitter (só idempotentes), circuit breaker (limite de chamada lenta abaixo do timeout) + fallback seguro, bulkhead, rate limit, health checks — **em camadas projetadas**; um retry sem breaker pode ser pior do que nada.
6. A **engenharia do caos** prova que os padrões funcionam: uma hipótese, raio de impacto pequeno, observabilidade primeiro — e uma cultura sem culpados.
