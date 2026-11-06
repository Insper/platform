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
Roteiro: (1) visão geral: disponibilidade, os noves, disponibilidade composta, modos de falha, falhas
em cascata; (2) SLI / SLO / SLA: medição, metas, error budget, burn rate, contratos; (3) padrões de
resiliência: timeout, retry, circuit breaker, fallback, bulkhead, rate limiting, health checks, camadas;
(4) engenharia do caos: provar que os padrões funcionam.
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

<div class="cols">
<div>

### Em série

A requisição precisa de **todos** os componentes: as disponibilidades se **multiplicam**.

gateway → order → product, 99,9% cada:
`0.999³ ≈ 99.7%`

Pior do que qualquer parte: cada dependência síncrona **baixa o teto**.

</div>
<div>

### Em paralelo

**Qualquer uma** das n réplicas basta:
`1 − (1 − a)ⁿ`

Dois gateways com 99% atrás do Nginx:
`1 − 0.01² = 99.99%`

Só se as falhas forem **independentes** — o mesmo bug, host ou zona quebra isso.

</div>
</div>

<div class="ok">

Redundância e padrões de isolamento existem para **quebrar a cadeia de propagação de falhas**.

</div>

---

## Modos de falha

**Falhas parciais** — alguns componentes funcionam, outros não — são a regra e são mais difíceis do que quedas totais.

| Classe de falha | Características | Estratégia |
|---|---|---|
| **Transitória** | some em segundos; retry é seguro | retry com backoff exponencial e jitter |
| **Permanente (crash-stop)** | o nó para e não volta | circuit breaker + failover para réplica saudável |
| **Intermitente** | aparece e some, sem gatilho claro | histogramas de latência P99; alertas de anomalia |
| **Bizantina** | retorna dados errados sem cair | consenso; checksums; validação de entrada |

<p class="small">A falha mais comum não é uma queda, mas uma resposta <b>lenta</b>: quem chama não distingue lento de morto e continua esperando.</p>

---

## Falhas em cascata

Uma dependência lenta esgota **threads, conexões e memória** de quem a chama — e o esgotamento sobe a cadeia.

- **Lei de Little**: requisições em andamento = taxa de chegada × tempo de cada uma.
- 60 pedidos/s × 100 ms por chamada de pagamento → **6** threads esperando o pagamento.
- 60 pedidos/s × 3 s → **180** de 200 threads: `GET /orders/42`, que nem precisa de pagamento, recebe `503`.
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

**telemetria** → agregada num **SLI** → avaliado contra o **SLO** → que embasa o **SLA**; o que sobra do SLO vira o **error budget**.

---

<!-- _class: tight -->

## SLI: a medição bruta

> SLI = eventos bons / eventos válidos × 100% — p. ex. `GET /products` sem 5xx em menos de 300 ms.

| Categoria | Exemplo de medição |
|---|---|
| **Disponibilidade** | `non-5xx responses / total HTTP requests` |
| **Latência** | `requests faster than 200 ms / total` (≈ P95 < 200 ms) |
| **Taxa de erros** | `HTTP 5xx / total` (o complemento da disponibilidade) |
| **Durabilidade** · **Atualidade** | leituras com sucesso / tentadas · tempo desde a última atualização |

- Coletado via Actuator/Micrometer (`http_server_requests_seconds_count`), sondas sintéticas, logs de acesso ou no cliente.

<div class="warn">

CPU, tamanho do heap e pausas de GC são **métricas de vaidade**: 95% de CPU pode atender todos; 10% de CPU pode estar fora do ar.

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

99,9% em 28 dias → **≈ 40,3 minutos**, ou **28.000** requisições com falha em 28 milhões (um deploy ruim com 20.000 erros queima ~70% de uma vez).

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

## Burn rate

`burn rate = observed error rate ÷ (1 − SLO)` — com SLO de 99,9%, 1,44% de erros = 14,4×.

| Burn rate | Orçamento de 28 dias esgota em | Severidade |
|---|---|---|
| 1× | fim da janela (28 dias) | normal |
| 2× | 14 dias | aviso |
| 6× | ~4,7 dias | alta — ticket |
| 14,4× | ~1,9 dia (~47 h) | crítica — acionar o plantão já |

- SRE Workbook: 14,4× por 1 h queima ~2% do orçamento; 6× por 6 h queima ~5%.
- Burn rates **altas** pegam incidentes rápidos; burn rates **baixas** pegam degradações lentas.
- Alerte sobre um **sintoma que o usuário sente** (erros queimando o orçamento), não sobre uma causa como CPU.

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

**Medir a coisa errada**: um SLI do health check nada diz sobre `POST /orders`. **Médias**: 80 ms de média podem esconder 5% esperando 4 s. **Janelas misturadas** (30 vs. 28 dias). **SLO sem política**: só um número no dashboard.

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

Um prazo em toda chamada de saída: limita o estrago de uma chamada lenta.

- **Por percentil**: perto do **P99.9** do downstream em condições normais.
- **Dentro do orçamento** do prazo de quem chama. **Por dependência**: um valor global quase sempre está errado.
- Dois timeouts: **connect** (abrir a conexão TCP) e **read** (esperar a resposta).

```yaml
spring.cloud.openfeign.client.config:
  product:                  # the @FeignClient name
    connect-timeout: 500    # ms
    read-timeout: 1000      # ms
```

<p class="small">Sozinho, o timeout transforma um travamento num erro rápido: combine-o com retry, circuit breaker e fallback.</p>

---

## Retry com backoff exponencial e jitter

Só faça retry de falhas **transitórias**, espaçado, para que um serviço reiniciando não leve uma *thundering herd*:

- **Backoff exponencial**: `wait = min(c · 2ⁿ, max_wait)` → 1 s, 2 s, 4 s, 8 s, 16 s (teto).
- Clientes que falharam juntos ainda repetem juntos → adicione **jitter**.
- **Full jitter** (Marc Brooker, AWS): `wait = random(0, min(c · 2ⁿ, max_wait))` — 1.000 clientes espalhados uniformemente em vez de 1.000 requisições em t = 1 s, 2 s, 4 s.

| Resposta | Retry? |
|---|---|
| conexão recusada / resetada, timeout | sim |
| `503`, `429` | sim, com backoff (respeite o `Retry-After`) |
| `500` | talvez, uma vez — costuma ser bug |
| `400`, `401`, `403`, `404`, `422` | não — a própria requisição está errada |

---

## Retry com segurança

<div class="warn">

**Amplificação de retries**: gateway, order e o cliente de product repetindo 3 vezes cada → um clique = 3 × 3 × 3 = **27** chamadas a um serviço em apuros. Faça retry em **uma** camada, limite as tentativas e pare quando o breaker estiver aberto.

</div>

- Repetir `POST /orders` pode criar **duplicatas**: só faça retry de operações **idempotentes** (`GET`, `PUT`, `DELETE`).
- **Idempotente**: fazer duas vezes tem o mesmo efeito que fazer uma.
- **Chave de idempotência**: o cliente envia um UUID por operação lógica (`Idempotency-Key: k-42`); o servidor guarda as chaves processadas e, numa repetição, devolve o resultado guardado — o mesmo pedido, sem duplicata.

---

## Circuit breaker

**Closed** → (taxa de falhas > limite) → **Open** → (tempo de espera) → **Half-Open** → teste ok → **Closed** · teste falha → **Open**

| Parâmetro | Valor típico | Efeito |
|---|---|---|
| Limite de falhas | 50% das últimas 10–20 chamadas | sensibilidade a falhas |
| Tempo de espera | 30–60 s | tempo para o serviço se recuperar |
| Testes em Half-Open | 3–5 requisições | cautela ao testar a recuperação |
| Limite de chamada lenta | 2× o P99 normal | chamadas lentas contam como falha |

<p class="small">Open = rejeita na hora, sem chamada de rede: libera as threads de quem chama e dá tempo para a dependência se recuperar.</p>

---

<!-- _class: tight -->

## Circuit breaker + retry com Resilience4j

```java
@CircuitBreaker(name = "product", fallbackMethod = "priceFallback")
@Retry(name = "product")
public ProductOut findProduct(String id) { ... }   // Feign call
```

```yaml
resilience4j:
  circuitbreaker.instances.product:
    sliding-window-size: 10                  # last 10 calls
    failure-rate-threshold: 50               # % → Open
    slow-call-duration-threshold: 2s         # slow = failure
    wait-duration-in-open-state: 30s         # Open → Half-Open
    permitted-number-of-calls-in-half-open-state: 3
  retry.instances.product:
    max-attempts: 3                          # 1 call + 2 retries
    wait-duration: 500ms
    enable-exponential-backoff: true         # 500 ms, 1 s, ...
```

<p class="small">O estado é exportado como <code>resilience4j_circuitbreaker_state</code> pelo Actuator — faça o gráfico no Grafana (Hands-on 6).</p>

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

## Bulkhead e rate limiting

<div class="cols">
<div>

### Bulkhead

Compartimentos estanques: **um pool por dependência**.

Pool A (10 threads) → payment, degradado; Pool B (10 threads) → inventory **intacto**.

<p class="small">Resilience4j: <b>semáforo</b> (<code>max-concurrent-calls</code>, o padrão) ou <b>pool de threads</b>. A mesma ideia: pools de BD separados, deployments separados.</p>

</div>
<div>

### Rate limiting

**Token bucket**: reposição = vazão contínua, capacidade = rajada; vazio → `429`.

```nginx
limit_req_zone $binary_remote_addr
    zone=api:10m rate=10r/s;
limit_req zone=api burst=20 nodelay;
```

<p class="small">O Nginx usa um <b>leaky bucket</b>. Por usuário ou chave de API: no gateway.</p>

</div>
</div>

---

## Health checks

| Probe | Pergunta | Quando falha |
|---|---|---|
| **Liveness** | o processo está vivo (sem deadlock)? | o orquestrador **reinicia** o container |
| **Readiness** | consegue atender tráfego agora? | **sai do balanceador**, sem reiniciar |
| **Startup** (K8s) | terminou de iniciar? | liveness e readiness esperam — uma JVM lenta não morre no boot |

<p class="small">Actuator: <code>/actuator/health/liveness</code> e <code>/readiness</code> (automáticos no Kubernetes; fora dele, <code>management.endpoint.health.probes.enabled=true</code>).</p>

<div class="warn">

**Nunca coloque dependências externas na liveness**: uma oscilação de 10 s do banco reiniciaria **todas as réplicas de uma vez**. Cuidado até com a readiness: todas as réplicas fora = o serviço some.

</div>

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

<p class="small"><b>A ordem é uma decisão de projeto</b>: o padrão do Resilience4j é <code>Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call)))))</code> — o retry por fora, então o breaker conta cada tentativa. Confira se timeouts × tentativas cabem no prazo de quem chama.</p>

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

1. **Hipótese sobre o estado estável** — saídas mensuráveis: taxa de requisições, taxa de erros, latência.
2. **Variar eventos do mundo real** — quedas, partições, disco cheio, desvio de relógio, timeouts, picos.
3. **Rodar experimentos em produção** — staging não reproduz carga, dados nem dependências.
4. **Automatizar para rodar continuamente** — novos deploys reintroduzem fraquezas.
5. **Minimizar o raio de impacto** — o mínimo de usuários; amplie só depois que experimentos pequenos passarem.

<p class="small">Formalizados e batizados por engenheiros da Netflix na IEEE Software (2016).</p>

---

<!-- _class: tight -->

## Um experimento na loja

**Hipótese** → **Projeto** → **Injeção** → **Observação** → **Análise** → **Melhoria** e repita com escopo maior.

| Passo | Conteúdo |
|---|---|
| **Estado estável** | `POST /orders`: disponibilidade ≥ 99,9%, P95 < 500 ms (Grafana, Hands-on 6) |
| **Hipótese** | product com 3 s → o breaker abre em até 30 s, pedidos falham rápido com `503`, `GET /orders` mantém a latência |
| **Injeção** | Toxiproxy entre order e product, toxic `latency` de 3 s — primeiro no Compose, depois numa réplica |
| **Raio de impacto** | um ambiente, 10 minutos, abortar se `GET /orders` < 99% |
| **Observação** | estado do breaker, taxa de erros e P95 por rota, threads ocupadas, traces no Jaeger |
| **Descobertas?** | read timeout do Feign nunca configurado (o breaker só conta após 60 s); retries abrem o breaker tarde demais |

<p class="small">Uma hipótese confirmada é evidência; uma <b>refutada</b> é uma descoberta — um bug achado nos seus termos.</p>

---

<!-- _class: tight -->

## Injeção de falhas e raio de impacto

| Categoria | Exemplos | Ferramentas |
|---|---|---|
| **Processo / instância** | matar container, OOM-kill, encerrar VM | Chaos Monkey, LitmusChaos |
| **Rede** | latência, perda de pacotes, partição | Toxiproxy, Gremlin, Chaos Mesh |
| **Recurso** | saturar CPU, encher disco, esgotar memória | stress-ng, Gremlin |
| **Dependência** | HTTP 500, timeouts, respostas malformadas | WireMock, Toxiproxy |
| **Estado** | corromper registros, reverter um deploy, expirar certificados | manual, Gremlin |
| **Infraestrutura** | perder uma Availability Zone ou uma região | Chaos Gorilla, AWS FIS |

**Raio de impacto**: testes → staging/canário → **1% do tráfego** → produção completa. Controles: feature flags, horário comercial, **aborto automático** por SLI, tráfego espelhado.

---

## GameDay e ferramentas

Um **GameDay** é um exercício planejado, com toda a equipe — tanto de processo quanto de tecnologia:

1. **Briefing** do cenário (ou mantido em segredo: um *GameDay surpresa*).
2. **Execução**: injetar; monitorar, seguir os runbooks, comunicar como num incidente real.
3. **Observação** do tempo para detectar e para recuperar e de quais runbooks ajudaram.
4. **Debriefing**: um post-mortem **sem culpados** — uma lista de melhorias, não de culpados.

<p class="small">Ferramentas: Chaos Monkey (Netflix), Gremlin (SaaS), LitmusChaos e Chaos Mesh (CNCF, nativos de Kubernetes), Toxiproxy (Shopify, testes de integração), AWS FIS (IAM, condições de aborto).</p>

---

## Observabilidade primeiro

Antes de qualquer experimento, a equipe precisa **medir** o estado estável (dashboards de SLI), **detectar** desvios (alertas em segundos), **atribuir** causas (tracing) e **abortar** com segurança (kill switch).

<div class="ok">

**Observabilidade primeiro**, depois padrões de resiliência, depois experimentos de caos para provar que os padrões funcionam.

</div>

<div class="warn">

Armadilhas: caos **sem hipótese** é só quebrar coisas; **começar em produção** (é o objetivo, não o primeiro passo); **sem botão de aborto**; **não corrigir nada** — descobertas que nunca viram tickets só consumiram error budget.

</div>

---

## Pontos-chave

1. Disponibilidade = MTTF / (MTTF + MTTR); recuperar mais rápido costuma ser o ganho mais barato. Em série as disponibilidades se **multiplicam**; em paralelo, `1 − (1 − a)ⁿ`.
2. Cada **nove** a mais é 10× menos indisponibilidade — sempre informe a **janela**.
3. Dependências **lentas** esgotam threads e provocam **falhas em cascata**.
4. **SLI** mede, **SLO** define a meta, **SLA** é contrato (mais frouxo que o SLO); o **error budget** (≈ 40,3 min a cada 28 dias com 99,9%) e sua **burn rate** decidem entre funcionalidades e confiabilidade.
5. Timeout, retry + full jitter (só idempotentes), circuit breaker + fallback seguro, bulkhead, rate limit, health checks — **em camadas projetadas**.
6. A **engenharia do caos** prova que os padrões funcionam: uma hipótese, raio de impacto pequeno, observabilidade primeiro.
