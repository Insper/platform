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

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Confiabilidade

**Falhar de forma controlada, recuperar rápido, limitar o raio de impacto**

<!--
Roteiro: (1) disponibilidade, MTTF/MTTR e os noves; (2) modos de falha e falhas em cascata;
(3) SLI, SLO, SLA e o error budget; (4) padrões de resiliência; (5) engenharia do caos.
-->

---

## Três serviços, três noves cada

<div class="q">

O gateway chama order, que chama payment. Cada um fica no ar **99,9%** do tempo.
Que disponibilidade o usuário percebe?

</div>

* Numa cadeia de dependências, as disponibilidades se **multiplicam**: `0.999³ ≈ 99.7%`.
* Ponta a ponta é **pior do que qualquer componente isolado**.
* Em paralelo é o contrário: duas réplicas com 99% → `1 − 0.01² = 99.99%`.
* Por isso existem redundância e padrões de isolamento: para **quebrar a cadeia de propagação de falhas**.

<!--
Deixe a turma calcular antes de revelar. Depois reforce a definição: um sistema confiável não é
aquele que nunca falha, é aquele que falha de forma controlada e se recupera rápido.
-->

---

## Disponibilidade: duas alavancas

| Termo | Nome completo | Significado |
|---|---|---|
| **MTTF** | Mean Time To Failure | tempo médio de operação até uma falha |
| **MTTR** | Mean Time To Repair | tempo para detectar, diagnosticar e restaurar |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — o ciclo completo |

> Disponibilidade = MTTF / (MTTF + MTTR)

- **↑ MTTF** — prevenir falhas: projeto tolerante a falhas, testes, redundância.
- **↓ MTTR** — recuperar mais rápido: resposta a incidentes, automação, runbooks.

<p class="small">Serviço de pedidos: MTTF 720 h, MTTR 2 h → 99,72%. Reinício automático em 1 min → 99,998%. Recuperar mais rápido foi o ganho mais barato.</p>

---

## Os "noves"

| Disponibilidade | Por ano | Por mês (30,44 d) | Por 28 dias |
|---|---|---|---|
| 99% ("dois noves") | 3,65 dias | 7,31 horas | 6,72 horas |
| 99,9% ("três noves") | 8,77 horas | 43,8 minutos | 40,3 minutos |
| 99,95% | 4,38 horas | 21,9 minutos | 20,2 minutos |
| 99,99% ("quatro noves") | 52,6 minutos | 4,38 minutos | 4,03 minutos |
| 99,999% ("cinco noves") | 5,26 minutos | 26,3 segundos | 24,2 segundos |

<div class="ok">

Cada nove é um **corte de 10×** na indisponibilidade permitida. Com cinco noves, humanos são lentos demais: detecção e recuperação precisam ser **totalmente automatizadas**.

</div>

---

<!-- _class: tight -->

## Como sistemas distribuídos falham

| Classe de falha | Características | Estratégia |
|---|---|---|
| **Transitória** | some em segundos; retry é seguro | retry com backoff exponencial e jitter |
| **Permanente (crash-stop)** | o nó para e não volta | circuit breaker + failover para réplica saudável |
| **Intermitente** | aparece e some, sem gatilho claro | histogramas de latência P99; alertas de anomalia |
| **Bizantina** | retorna dados errados sem cair | consenso; checksums; validação de entrada |

<div class="warn">

**Falha em cascata** — o padrão mais perigoso: payment vai de **100 ms para 3 s**; a 60 req/s quem chama precisa de 180 threads em vez de 6, o pool enche e **todas as rotas param**, até as que nada têm a ver com pagamento.

</div>

Resposta: **timeouts, circuit breakers e bulkheads**.

---

## SLI → SLO → SLA

| Termo | Nome completo | Natureza |
|---|---|---|
| **SLI** | Service Level Indicator | uma métrica mensurável |
| **SLO** | Service Level Objective | uma meta interna para essa métrica |
| **SLA** | Service Level Agreement | um compromisso contratual com clientes |

- SLI = **eventos bons / eventos válidos**, refletindo **o que o usuário experimenta**: disponibilidade (`non-5xx / total`), latência (`% faster than 200 ms`), durabilidade, atualidade.
- Coletado via Actuator/Micrometer, sondas sintéticas (Blackbox Exporter), logs de acesso ou no cliente.

<div class="warn">

CPU, tamanho do heap e pausas de GC são **métricas de vaidade**: 95% de CPU pode atender todos; 10% de CPU pode estar fora do ar.

</div>

---

## SLO e o error budget

Um SLO é `SLI ≥ threshold` em uma `rolling window` (janela móvel) — ex.: `Availability ≥ 99.9%` em 28 dias.

> Error budget = 1 − meta do SLO — a **licença para assumir riscos** da equipe.

99,9% em 28 dias → **≈ 40,3 minutos**, ou 28.000 requisições com falha em 28 milhões.

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

<!--
Use o exemplo de negociação da página: "restam 12 minutos de orçamento na janela; um deploy que
cause 30 minutos de degradação viola o SLO — espere." Reforce: sempre informe a janela
(43,8 min é um mês de 30,44 dias, 40,3 min é 28 dias).
-->

---

## Burn rate

`burn rate = observed error rate ÷ (1 − SLO)` — com SLO de 99,9%, 1,44% de erros = 14,4×.

| Burn rate | Orçamento de 28 dias esgota em | Severidade |
|---|---|---|
| 1× | fim da janela (28 dias) | normal |
| 2× | 14 dias | aviso |
| 6× | ~4,7 dias | alta — ticket |
| 14,4× | ~1,9 dia (~47 h) | crítica — acionar o plantão já |

- Alertas de burn rate **alta** pegam cedo os incidentes rápidos.
- Alertas de burn rate **baixa** pegam degradações lentas que, de outro modo, seriam invisíveis.

---

## SLA vs SLO

| | SLO | SLA |
|---|---|---|
| **Público** | equipe de engenharia | cliente / negócio |
| **Natureza** | meta interna | contrato jurídico |
| **Rigor** | maior (mais estrito) | menor (mais tolerante) |
| **Violação** | trabalho de confiabilidade, congelamento | créditos de serviço, multas |

<div class="ok">

Defina o **SLO mais estrito que o SLA**: SLA 99,9% → SLO 99,95%. A diferença é a margem de segurança. E **nunca** defina um SLO de 100%.

</div>

<p class="small">SLAs reais: AWS EC2 99,99% ao mês, S3 99,9%, RDS Multi-AZ 99,95% — uma violação paga créditos de serviço, não as suas vendas perdidas.</p>

---

## Timeout e retry

- **Timeout** (connect + read) em toda chamada de saída, perto do **P99.9** do downstream, dentro do orçamento de quem chama, **por dependência**.
- **Retry** só de falhas **transitórias** (timeouts, `503`, `429`) — nunca `4xx` — com **backoff exponencial**: 1 s, 2 s, 4 s… até um teto.
- Adicione **full jitter** (`random(0, backoff)`) para que clientes que falharam juntos não repitam juntos — a *thundering herd*.
- Retry em **uma camada**: 3 camadas × 3 tentativas = **27 chamadas** a um serviço em apuros.

<div class="warn">

Repetir `POST /orders` pode criar duplicatas. Faça retry de chamadas idempotentes (`GET`, `PUT`, `DELETE`) ou envie uma **chave de idempotência** que o servidor deduplica.

</div>

---

## Circuit breaker

**Closed** → (taxa de falhas > limite) → **Open** → (tempo de espera) → **Half-Open** → teste ok → **Closed** · teste falha → **Open**

| Parâmetro | Valor típico | Efeito |
|---|---|---|
| Limite de falhas | 50% das últimas 10–20 chamadas | sensibilidade a falhas |
| Tempo de espera | 30–60 s | tempo para o serviço se recuperar |
| Testes em Half-Open | 3–5 requisições | cautela ao testar a recuperação |
| Limite de chamada lenta | 2× o P99 normal | chamadas lentas contam como falha |

<p class="small">Open = rejeita na hora, sem chamada de rede → um <b>fallback</b> degrada com elegância (dados em cache, <code>503</code> claro; nunca finja um pagamento). Resilience4j: <code>@CircuitBreaker(name = "product", fallbackMethod = …)</code>, <code>@Retry</code>, <code>@Bulkhead</code>.</p>

<!--
Pergunte: por que falhar rápido é melhor do que esperar? Libera as threads de quem chama e dá ao
serviço downstream tempo para se recuperar.
-->

---

## Bulkhead, rate limiting, health checks

| Padrão | Ideia | Exemplo |
|---|---|---|
| **Bulkhead** | um pool de recursos **por dependência** | Pool A (10 threads) → payment; Pool B → inventory segue saudável |
| **Rate limiting** | **token bucket**: reposição = vazão contínua, capacidade = rajada | 100 req/s, capacidade 200 → senão `429 Too Many Requests` |
| **Liveness** | o processo está vivo? | falha → o orquestrador **reinicia** o container |
| **Readiness** | consegue atender tráfego agora? | falha → **sai do balanceador**, sem reiniciar |

<p class="small">Actuator: <code>/actuator/health/liveness</code> e <code>/readiness</code>. Nunca verifique o banco na <b>liveness</b>: uma oscilação do banco reiniciaria todas as réplicas de uma vez.</p>

---

## Defesa em profundidade

cliente → **rate limiter** → **circuit breaker** → **bulkhead** → **timeout** → **retry + backoff** → downstream

| Camada | O que trata |
|---|---|
| Rate limiter | picos de tráfego, clientes abusivos |
| Circuit breaker | dependências que sabidamente falham |
| Bulkhead | dependências lentas contaminando outras chamadas |
| Timeout | espera sem limite |
| Retry + backoff | erros transitórios |

> Os padrões não evitam falhas; eles **limitam até onde uma falha se espalha**.

---

## Engenharia do caos

Experimentar no sistema para ganhar confiança de que ele **suporta condições turbulentas em produção**.

- **Origem**: ao migrar para a AWS, a Netflix criou o **Chaos Monkey** (2010) — mata instâncias aleatórias em produção, em horário comercial. Valeu a pena na pane de `us-east-1` em abril de 2011.
- Veio o **Simian Army** (2011): Latency Monkey, Chaos Gorilla (uma Availability Zone inteira)… Antes, a Amazon fazia **GameDays** (Jesse Robbins).
- **Princípios**: hipótese sobre o estado estável · variar eventos reais · rodar em produção · automatizar · **minimizar o raio de impacto**.

> "The best way to avoid failure is to fail constantly." — John Ciancutti, Netflix, 2010

---

## Rodando um experimento

**Hipótese** do estado estável → **Projeto** da falha e do raio de impacto → **Injeção** → **Observação** dos SLIs → **Análise** → **Melhoria**, e repita com escopo maior.

- Exemplo da loja: **3 s de latência** (Toxiproxy) entre order e product → espera-se que o breaker abra e `GET /orders` siga rápido.
- Aumente o raio de impacto: testes → staging/canário → **1% do tráfego** → produção completa; **aborto automático** se um SLI cair.
- **GameDay**: exercício em equipe — briefing, execução, observação, debriefing **sem culpados**.
- Ferramentas: Chaos Monkey, Gremlin, LitmusChaos, Chaos Mesh, Toxiproxy, AWS FIS.

<div class="ok">

**Observabilidade primeiro**, depois padrões de resiliência, depois caos para provar que os padrões funcionam.

</div>

<!--
Reforce que uma hipótese refutada é uma descoberta, não um fracasso: a equipe aprende antes que um
incidente real ensine.
-->

---

## Pontos-chave

1. Disponibilidade = MTTF / (MTTF + MTTR); numa cadeia, as disponibilidades se **multiplicam**.
2. Cada **nove** a mais é 10× menos indisponibilidade e outra postura operacional.
3. **Falhas em cascata** se espalham por pools de threads esgotados — o principal risco dos microsserviços.
4. **SLI** mede, **SLO** define a meta, **SLA** é contrato; mantenha o SLO mais estrito que o SLA.
5. O **error budget** (1 − SLO, ≈ 40 min a cada 28 dias com 99,9%) e sua **burn rate** decidem entre funcionalidades e confiabilidade.
6. Timeout, retry + jitter, circuit breaker + fallback, bulkhead, rate limit, health checks — **em camadas**.
7. A **engenharia do caos** prova que os padrões funcionam — com raio de impacto pequeno e observabilidade primeiro.
