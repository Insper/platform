---
marp: true
lang: pt-BR
title: Confiabilidade e Resiliência
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Confiabilidade e Resiliência

**Falhar de forma controlada, recuperar rápido, limitar o raio de impacto**

<!--
Roteiro: (1) disponibilidade, noves, disponibilidade composta, redundância; (2) modos de falha e
cascatas; (3) SLIs, SLOs, error budgets; (4) padrões de resiliência; (5) recuperação de desastres;
(6) engenharia do caos e game days.
-->

---

## 10:02 na abertura de vendas do estádio

<div class="q">

O provedor de pagamento vai de **200 ms para 4 s**. Nada no BoxOffice está quebrado.
Por que fãs que só querem **navegar no catálogo** recebem erros um minuto depois?

</div>

* O `order` espera o pagamento sem prazo → suas threads enchem.
* O gateway espera o `order` → suas threads também enchem.
* Toda rota compartilha essas threads → **a lentidão se espalha** para funcionalidades saudáveis.

<!--
Deixe a turma raciocinar. O resto da aula: medir quanta falha é aceitável, construir defesas,
recuperar de desastres e provar que as defesas funcionam.
-->

---

## Disponibilidade: duas alavancas

| Termo | Significado |
|---|---|
| **MTTF** | tempo médio até a falha — quanto tempo funciona |
| **MTTR** | tempo médio de reparo — detectar + diagnosticar + corrigir |

> Disponibilidade = MTTF / (MTTF + MTTR)

- `inventory`: MTTF 720 h, MTTR 2 h → **99,72%**.
- Metade das falhas → 99,86%. Reinício automático em 1 min → **99,998%**.

<div class="ok">

Recuperar mais rápido costuma ser a alavanca **mais barata**.

</div>

---

## Os noves

| Disponibilidade | Por mês | Por 28 dias | Postura operacional |
|---|---|---|---|
| 99,9% | 43,8 min | 40,3 min | uma pessoa consegue fazer rollback |
| 99,95% | 21,9 min | 20,2 min | alertas rápidos, runbooks ensaiados |
| 99,99% | 4,38 min | 4,03 min | detecção e failover **automatizados** |
| 99,999% | 26,3 s | 24,2 s | automação em segundos; o risco são os deploys |

<div class="warn">

Cada nove é **10× menos indisponibilidade** — e sempre diga a **janela** (e se é tempo ou requisições).

</div>

---

## Disponibilidade composta

<div class="cols">
<div>

### Em série

`A = A₁ × A₂ × … × Aₙ`

Três serviços com 99,9% → **99,7%**. Cada dependência síncrona **baixa o teto**.

</div>
<div>

### Em paralelo

`A = 1 − (1 − a)ⁿ`

Duas réplicas com 99% → **99,99%** — se as falhas forem **independentes**.

</div>
</div>

<p class="small">Caminho de compra do BoxOffice (ilustrativo): 1 instância de cada ≈ 98,3% (745 min/mês) → 3 réplicas ≈ 99,79% → + failover do banco ≈ 99,84% → + segundo provedor de pagamento ≈ 99,94% (26 min/mês). Cada passo expõe o próximo elo mais fraco.</p>

---

<!-- _class: tight -->

## Redundância e failover

| Padrão | Tempo de failover | Exemplo no BoxOffice |
|---|---|---|
| **Ativo-ativo** | segundos (health checks) | réplicas sem estado de `gateway`, `order`, `catalog` |
| **Ativo-passivo (hot standby)** | segundos a minutos | PostgreSQL primário + standby em outra AZ |
| **Cold standby** | minutos a horas | workers de analytics recriados a partir de imagens |

- **N + 1**: depois de perder uma réplica (ou uma AZ de três), o resto aguenta o pico.
- **Sem estado** faz failover de forma trivial; **estado** exige replicação, fencing, nada de split brain.
- AZs ficam a ~1 ms (proteção barata); regiões ficam a dezenas de ms (DR).

---

## Como sistemas distribuídos falham

| Classe | Tratamento |
|---|---|
| Crash (fail-stop) | health checks, reinício, failover |
| Transitória | retry com backoff e jitter |
| **Lenta / gray failure** | timeouts, breakers que contam chamadas lentas, SLIs de latência |
| Bizantina / incorreta | checksums, validação, reconciliação |
| Correlacionada | rollouts graduais, multi-zona, testes de caos |

<div class="warn">

O componente mais perigoso não é o morto — é o **lento**. Quem chama não distingue lento de morto, então, sem prazo, espera.

</div>

---

## Falha em cascata, em números

> chamadas em voo = taxa de chegada × tempo por chamada (Lei de Little)

| Latência do pagamento | Em voo a 100/s | Pool de 200 do `order` |
|---|---|---|
| 200 ms | 20 | 10% ocupado |
| 1 s | 100 | 50% ocupado |
| 4 s | **400** | esgotado → toda rota espera |

- **Timeout** limita o tempo por chamada · **circuit breaker** para de chamar · **bulkhead** limita as threads.

<p class="small">Playground: <code>cascading-failure</code> — adicione um timeout, depois um breaker, e observe as rotas saudáveis.</p>

---

## Falhas que se alimentam

- **Tempestades de retry**: retries multiplicam a carga quando a dependência está mais fraca.
- **Manada na recuperação**: todo mundo reconecta no mesmo instante.
- **Espiral dos health checks**: instâncias sobrecarregadas são removidas, as restantes recebem mais carga.
- **Falha metaestável**: o gatilho passou, mas o trabalho que ele criou (retries, timeouts, misses) mantém o sistema caído.

<div class="ok">

A saída é **descartar carga**: load shedding, retry budgets, circuit breakers.

</div>

---

## SLI → SLO → error budget → SLA

| Termo | Exemplo no BoxOffice |
|---|---|
| **SLI** — o que o usuário sente | % de `POST /holds` não-5xx em < 500 ms |
| **SLO** — meta interna | ≥ 99,9% em 28 dias |
| **Error budget** — 1 − SLO | 0,1% das reservas podem falhar ou ser lentas |
| **SLA** — contrato, multas | casas parceiras: 99,5% ao mês, ou créditos |

- SLI = **eventos bons / eventos válidos**, medido perto do usuário (gateway, probes sintéticos).
- CPU, heap, número de pods **não** são SLIs. Mantenha o SLO **mais rígido** que o SLA.

---

## Comece pelas jornadas do usuário

| Jornada | SLO (28 dias) |
|---|---|
| Reservar lugares | 99,9% com sucesso em < 500 ms |
| Navegar no catálogo | 99,5% em < 300 ms |
| Receber ingressos por e-mail | 99% em até **2 min** da confirmação (**atualidade**) |
| Sala de espera durante uma abertura | 99,95% das atualizações de posição |

- Meça primeiro, depois defina o SLO um pouco abaixo do que você alcança.
- Respeite a matemática das dependências: um provedor com 99,9% limita o SLO de compra. **Nunca 100%.**

<!--
O SLI de atualidade é o que pega falhas assíncronas: APIs verdes, e-mails atrasados.
-->

---

<!-- _class: tight -->

## Error budget e burn rate

1 M de requisições/dia × 28 dias × 0,1% = **28.000** requisições com falha permitidas.

> burn rate = taxa de erros ÷ (1 − SLO) — 1,44% de erros a 99,9% = 14,4× → orçamento acaba em ~1,9 dia

| Severidade | Burn rate | Janela longa | Janela curta | Orçamento gasto |
|---|---|---|---|---|
| acionar | 14,4× | 1 h | 5 min | 2% |
| acionar | 6× | 6 h | 30 min | 5% |
| chamado | 1× | 3 dias | 6 h | 10% |

<div class="warn">

Um deploy ruim (5% de erros por 3 h) custa ~22% do orçamento; uma degradação discreta de 0,2% (2×) **o esvazia até o dia 26**. Alerte pelo orçamento, não pela CPU.

</div>

---

## A política de error budget

- **> 50% restante**: deploy em qualquer dia útil; experimentos permitidos.
- **0–50%**: canary + plano de rollback; um item de confiabilidade em toda sprint.
- **Esgotado**: congelar deploys de funcionalidades no caminho de compra até o SLI se recuperar.
- **Regra de abertura de vendas**: nenhum deploy nas 24 h antes de uma grande abertura.
- **Um incidente > 20%**: postmortem sem culpados com ações com responsável.

<div class="ok">

Assinada por produto **e** engenharia, de antemão. Sem política, um SLO é decoração.

</div>

---

## Timeouts e orçamentos de prazo

| Camada | Orçamento |
|---|---|
| Gateway | 6 s |
| Handler de compra do `order` | 5 s |
| `order` → `payment` | 2 s × 2 tentativas + backoff ≈ 4,3 s |
| `payment` → provedor | 1,8 s |

- Perto do **p99,9** normal da dependência; timeouts de **conexão** (300 ms) e de **leitura** (2 s).
- **Por dependência**, encolhendo com a profundidade; propague o prazo (deadlines do gRPC).
- Um timeout numa cobrança deixa um **resultado desconhecido** → chave de idempotência.

---

## Retries: amplificação, jitter, orçamentos

- Repita só falhas **transitórias** (erros de conexão, `503`, `429`); nunca `4xx` ou "cartão recusado".
- **Uma camada**: 3 camadas × 3 tentativas = **27** chamadas por clique.
- **Full jitter**: `wait = random(0, base · 2ⁿ)` — 1.000 clientes que falham juntos se recuperam em ~1,5 s em vez de ondas por 15 s.
- **Retry budget** (retries ≤ 10% do tráfego): sem ele, os retries podem manter um sistema caído de forma **metaestável**.

<p class="small">Playground: <code>retry-storm</code> — troque para backoff + jitter e adicione um retry budget.</p>

---

## Circuit breaker e fallback

**Fechado** → (≥ 50% de falhas **ou chamadas lentas** em 20) → **Aberto** (30 s) → **Meio-aberto** (3 testes) → Fechado / Aberto

- Aberto = falhar em microssegundos: threads livres, a dependência ganha espaço para respirar.
- **Ignore erros de negócio**: um cartão recusado é uma resposta correta.
- **Fallback** = degradação graciosa: esconder recomendações, resultados de busca desatualizados…
- Para o pagamento: **nunca finja sucesso** — "pagamento temporariamente indisponível, lugares reservados por 10 min".

---

## Bulkheads e load shedding

<div class="cols">
<div>

### Bulkhead

- Um pool **por dependência**.
- 100 chamadas/s × 0,2 s = **20** em voo → bulkhead de **50**.
- Pagamento a 4 s → no máximo 50 threads esperam, não 400.

</div>
<div>

### Load shedding

- Rejeite **cedo e barato** (`503` + `Retry-After`).
- Por **prioridade**: compra > navegação > recomendações.
- Descarte trabalho velho; limites de concorrência adaptativos.

</div>
</div>

<p class="small">Rate limiting é por cliente (token bucket no gateway); load shedding protege o sistema todo. A sala de espera é load shedding feito com gentileza.</p>

---

## Resilience4j em order → payment

```yaml
resilience4j:
  bulkhead.instances.payment:
    max-concurrent-calls: 50
  circuitbreaker.instances.payment:
    sliding-window-size: 20
    failure-rate-threshold: 50
    slow-call-duration-threshold: 1500ms
    wait-duration-in-open-state: 30s
  retry.instances.payment:
    max-attempts: 2
    wait-duration: 200ms
    enable-randomized-wait: true
```

<p class="small">Ordem padrão: Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call))))) — toda tentativa é contada pelo breaker. Mais um <code>Idempotency-Key</code> em toda cobrança.</p>

---

## Health checks

| Probe | Pergunta | Na falha |
|---|---|---|
| **Startup** | terminou de subir? | continua esperando (até um limite) |
| **Liveness** | o processo travou? | **reinicia** o container |
| **Readiness** | pode atender tráfego agora? | **remove do load balancer** |

<div class="warn">

Nunca coloque dependências no **liveness**: uma oscilação de 20 segundos no banco reinicia **todas as réplicas de uma vez**.

</div>

---

## Recuperação de desastres: RPO e RTO

- **RPO**: quantos **dados** (em tempo) você aceita perder.
- **RTO**: quanto tempo até o serviço **voltar**.
- Defina **por classe de dados**: pagamentos ≈ 0 / 15 min · catálogo 1 h / 1 h · analytics 24 h / 2 dias.

<div class="warn">

**Replicação não é backup**: o standby replica `DELETE FROM orders` em milissegundos. Falhas lógicas exigem **backups com recuperação para um ponto no tempo** — e um tempo de restauração **medido** (2 TB a 200 MB/s ≈ 2,8 h).

</div>

<p class="small">Backups 3-2-1 + uma cópia imutável; conta separada; teste restaurações todo mês (lembre do GitLab, 2017).</p>

---

## As quatro estratégias de DR

| Estratégia | Na região de recuperação antes do desastre | RPO | RTO | Custo |
|---|---|---|---|---|
| Backup e restore | backups + infraestrutura como código | horas | horas–dia | $ |
| Pilot light | dados replicados; serviços desligados | minutos | dezenas de min–horas | $$ |
| Warm standby | cópia completa, reduzida, rodando | segundos–min | minutos | $$$ |
| Ativo-ativo | cópias completas, todas atendendo | ≈ 0 | ≈ 0 | $$$$ |

<p class="small">A replicação entre regiões costuma ser assíncrona: RPO = atraso da replicação. Residência de dados (LGPD/GDPR) restringe as regiões.</p>

---

## Failover regional

> RTO ≈ detectar (2 min) + decidir (5) + promover o banco (1) + escalar (5) + TTL do DNS (1) ≈ 14 min

- Detecte **de fora** da região; decida com um runbook ensaiado.
- Faça **fencing** do primário antigo — dois primários = lugares vendidos em dobro.
- **Estabilidade estática**: imagens, segredos, cotas já na região B.
- Lugares não podem ser multi-líder: **região de origem por evento** + warm standby, ou um banco globalmente consistente.

<p class="small">Playground: <code>multi-region</code> — derrube a região primária e depois mude o TTL do DNS.</p>

---

## Engenharia do caos

Experimentos que dão confiança de que o sistema **suporta condições turbulentas em produção**.

1. **Estado estável** como SLIs → 2. **hipótese** → 3. **injetar** uma falha real → 4. **observar** → 5. **analisar** → 6. **melhorar**.

- BoxOffice: o Toxiproxy adiciona **3 s** ao provedor sob carga k6 → espera-se o breaker aberto em < 30 s, catálogo estável.
- Raio de impacto pequeno: Compose → homologação → um pod canary → mais amplo; **aborte** com burn rate > 10×.
- Ferramentas: Toxiproxy, Chaos Mesh, LitmusChaos, AWS FIS, Azure Chaos Studio, Gremlin.

---

## Game day: a flash sale

| Horário | Injeção | Esperado |
|---|---|---|
| 10:10 | latência de 3 s no provedor | breaker abre; lugares reservados |
| 10:25 | um pod do `order` morto por minuto | N+1 absorve |
| 10:40 | broker Kafka parado | outbox cresce e escoa; nenhum e-mail perdido |
| 10:55 | failover do banco | ~30 s de erros de escrita |
| 11:10 | Redis esvaziado | a proteção contra stampede se mantém |

<div class="ok">

Papéis: mestre do jogo, plantão, observadores, escriba. Resultado: uma lista de melhorias **sem culpados**.

</div>

---

<!-- _class: tight -->

## O mapa de conceitos de confiabilidade

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `lb`, `app` | perder uma réplica ou zona nos para? | noves, série/paralelo, N+1, multi-AZ |
| `thirdparty`, `payment` | e se uma dependência ficar *lenta*? | timeout, retry + jitter, breaker, bulkhead |
| `apigw` | o que recusamos em sobrecarga? | rate limiting, descarte de carga, sala de espera |
| `healthcheck` | o tráfego deve chegar a esta instância? | liveness, readiness, startup |
| `metrics`, `alerting` | somos confiáveis o *suficiente*? | SLI, SLO, orçamento de erros, burn rate |
| `sql`, `objstore`, `dns` | quantos dados e quanto tempo podemos perder? | RPO/RTO, PITR, estratégias de DR, failover |

<p class="small">A redundância mantém as instâncias servindo, os padrões contêm dependências lentas, o DR cobre o que a redundância não cobre, os SLOs dizem quanto basta — e o <b>caos</b> prova tudo isso.</p>

---

## Conclusões

1. Disponibilidade = MTTF / (MTTF + MTTR); em série **multiplica**, em paralelo `1 − (1 − a)ⁿ`.
2. Dependências **lentas** causam cascatas por pools esgotados — a Lei de Little diz quão rápido.
3. SLOs por jornada do usuário; o **error budget** e seu **burn rate** guiam deploys e alertas.
4. Timeout · um retry com jitter + orçamento · breaker que conta chamadas lentas · bulkhead · shedding · fallback honesto.
5. DR a partir de **RPO/RTO**: replicação ≠ backup; escolha a estratégia mais barata que os atende.
6. **Experimentos de caos e game days** provam as defesas — observabilidade primeiro.
