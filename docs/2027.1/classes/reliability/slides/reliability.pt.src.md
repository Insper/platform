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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Confiabilidade e Resiliência

**Falhar de forma controlada, recuperar rápido, limitar o raio de impacto**

<!--
Roteiro: (1) disponibilidade, noves, disponibilidade composta, redundância; (2) modos de falha e
cascatas; (3) padrões de resiliência, com os valores do lab 9; (4) recuperação de desastres;
(5) engenharia do caos e game days. Os SLOs que julgam tudo isso vêm da aula 9.
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
| **MTTF** | tempo médio até a falha (*mean time to failure*) — quanto tempo funciona |
| **MTTR** | tempo médio de reparo (*mean time to repair*) — detectar + diagnosticar + corrigir |

> Disponibilidade = MTTF / (MTTF + MTTR)

<div class="flow">
<div class="box green">servindo<small>em média por MTTF</small></div><div class="arrow">falha →</div>
<div class="box red">falhou</div><div class="arrow">alerta →</div>
<div class="box orange">detectado</div><div class="arrow">traces →</div>
<div class="box orange">diagnosticado</div><div class="arrow">restart →</div>
<div class="box green">servindo</div>
</div>

- `inventory`: MTTF 720 h, MTTR 2 h → **99,72%**. Metade das falhas → 99,86%. Restart automático em 1 min → **99,998%**.

<div class="ok">

Recuperar mais rápido costuma ser a alavanca **mais barata** — e cada seta do MTTR é um número separado a reduzir.

</div>

---

## Os noves

| Disponibilidade | Por mês | Por 28 dias | Postura operacional |
|---|---|---|---|
| 99,9% | 43,8 min | 40,3 min | um humano consegue fazer rollback |
| 99,95% | 21,9 min | 20,2 min | alertas rápidos, runbooks ensaiados |
| 99,99% | 4,38 min | 4,03 min | detecção e failover **automatizados** |
| 99,999% | 26,3 s | 24,2 s | automatizado em segundos; deploys são o risco |

<div class="warn">

Cada nove é **10× menos indisponibilidade** — e sempre diga a **janela** (e se conta tempo ou requisições).

</div>

---

## Disponibilidade composta

<div class="flow">
<div class="box muted" style="flex: .5">fã</div><div class="arrow">→</div>
<div class="box">load balancer<small>99,99%</small></div><div class="arrow">→</div>
<div class="group"><div class="caption">em paralelo: qualquer um</div><div class="box green">gateway × 3<small>1 − 0,005³</small></div></div><div class="arrow">→</div>
<div class="group"><div class="caption">em paralelo</div><div class="box green">order × 3</div><div class="box green">inventory × 3</div></div><div class="arrow">→</div>
<div class="box orange">SQL<small>99,9%: uma cópia</small></div><div class="arrow">→</div>
<div class="box orange">provedor<small>99,9%: um contrato</small></div>
</div>

- **Em série** todo componente é necessário: `A = A₁ × A₂ × … × Aₙ` — toda dependência síncrona **baixa o teto**.
- **Em paralelo** qualquer um basta: `A = 1 − (1 − a)ⁿ` — duas réplicas a 99% → **99,99%**, *se as falhas forem independentes*.

<p class="small">Caminho da compra (ilustrativo): 1 instância de cada ≈ 98,3% (745 min/mês) → 3 réplicas ≈ 99,79% → + failover do banco ≈ 99,84% → + segundo provedor de pagamento ≈ 99,94% (26 min/mês). Cada passo expõe o próximo elo mais fraco.</p>

---

## Simulador: para onde vão os minutos?

<div class="flow">
<div class="box">1 instância de cada<small>98,30% · 745 min/mês</small></div><div class="arrow">2 réplicas →</div>
<div class="box">99,78%<small>95 min · mais fraco: SQL</small></div><div class="arrow">failover + 2º provedor →</div>
<div class="box green">99,94%<small>26 min</small></div><div class="arrow">tudo numa zona →</div>
<div class="box red">99,84%<small>70 min · mais fraco: a zona</small></div>
</div>

- O simulador **availability-path** da página da visão geral: réplicas por serviço, failover do SQL, um segundo provedor, uma zona de disponibilidade (AZ, *availability zone*) para tudo.
- Uma terceira réplica quase não soma (99,79%): replique **o elo mais fraco**, não o mais fácil.

<div class="warn">

Redundância só conta se as suas falhas forem **independentes** — uma zona (uma config, um host) derruba todas.

</div>

---

<!-- _class: tight -->

## Redundância e failover

| Padrão | Tempo de failover | Exemplo no BoxOffice |
|---|---|---|
| **Ativo-ativo** | segundos (health checks) | réplicas stateless de `gateway`, `order`, `catalog` |
| **Ativo-passivo (hot standby)** | segundos a minutos | primário PostgreSQL + standby em outra AZ |
| **Cold standby** | minutos a horas | workers de analytics reconstruídos a partir de imagens |

- **N + 1**: depois de perder uma réplica (ou uma AZ de três), as restantes aguentam o pico.
- **Stateless** faz failover trivialmente; **estado** precisa de replicação, fencing, nada de split brain.
- AZs ficam a ~1 ms uma da outra (proteção barata); regiões, a dezenas de ms (recuperação de desastres).

---

## Como sistemas distribuídos falham

<div class="flow">
<div class="group"><div class="caption">quanto tempo dura?</div><div class="box">transitória · intermitente · permanente</div></div>
<div class="arrow">×</div>
<div class="group"><div class="caption">como se comporta?</div><div class="box">crash-stop · <b>lenta</b> · bizantina</div></div>
</div>

| Classe | Tratamento |
|---|---|
| Crash (fail-stop) | health checks, restart, failover |
| Transitória | retry com backoff e jitter |
| **Lenta / gray failure** | timeouts, breakers que contam chamadas lentas, indicadores de nível de serviço (SLIs, *service level indicators*) de latência |
| Bizantina / incorreta | checksums, validação, reconciliação |

<div class="warn">

O componente mais perigoso não é o morto — é o **lento**. Quem chama não distingue lento de morto e, sem prazo, espera.

</div>

---

## Falha em cascata, em números

<div class="flow">
<div class="box muted">fãs<small>100 compras/s</small></div><div class="arrow">→</div>
<div class="box red">gateway<small>threads esperando o order</small></div><div class="arrow">→</div>
<div class="box red">order<small>200 threads, 400 necessárias</small></div><div class="arrow">→</div>
<div class="box orange">provedor de pagamento<small>4 s em vez de 200 ms</small></div>
</div>

> chamadas em voo = taxa de chegada × tempo por chamada (Lei de Little)

| Latência do pagamento | Em voo a 100/s | Pool de 200 do `order` |
|---|---|---|
| 200 ms | 20 | 10% ocupado |
| 1 s | 100 | 50% ocupado |
| 4 s | **400** | esgotado → toda rota espera |

<p class="small">O timeout limita o tempo por chamada · o circuit breaker para de chamar · o bulkhead limita as threads. Playground: <code>cascading-failure</code>.</p>

---

## Falhas que se alimentam

- **Tempestades de retry**: retries multiplicam a carga quando a dependência está mais fraca.
- **Thundering herd** na recuperação: todos reconectam no mesmo instante.
- **Espiral de health checks**: instâncias sobrecarregadas são removidas e as restantes recebem mais carga.
- **Falha metaestável**: o gatilho sumiu, mas o trabalho que ele criou (retries, timeouts, misses) mantém o sistema fora do ar.

<div class="ok">

A saída é **descartar carga**: load shedding, orçamentos de retry, circuit breakers.

</div>

---

## Timeouts e orçamentos de prazo

<div class="flow">
<div class="box">borda<small>10 s</small></div><div class="arrow">></div>
<div class="box">gateway<small>5 s</small></div><div class="arrow">></div>
<div class="box accent">order → payment<small>1 s × 3 tentativas + backoff ≈ 3,6 s</small></div><div class="arrow">mas</div>
<div class="box red">payment → provedor<small>2 s: mais que quem chama</small></div>
</div>

- Perto do **p99,9** normal da dependência: o lab 9 usa **500 ms** para conectar e **1 s** para ler (`PAYMENT_READ_TIMEOUT`).
- **Por dependência**, encolhendo com a profundidade; propague o prazo (deadlines do gRPC, um cabeçalho em HTTP).
- Um timeout numa cobrança deixa um **resultado desconhecido** → chave de idempotência `order-<id>`.

<p class="small">O adaptador do lab espera 2 s pelo provedor: o `order` desiste primeiro e o `payment` trabalha para ninguém. Em produção, dê ao adaptador menos que ao seu chamador.</p>

---

## Retries: amplificação, jitter, orçamentos

- Faça retry só de falhas **transitórias** (erros de conexão, `503`, `429`); nunca `4xx` ou "cartão recusado".
- **Uma camada**: 3 camadas × até 3 tentativas = **27** chamadas por clique.
- As esperas se somam: 1, 2, 4 s → retries em **1, 3 e 7 s** depois da primeira falha.
- **Full jitter**: `espera = random(0, base · 2ⁿ)` — 1.000 clientes que falham juntos se recuperam em ~1,5 s em vez de ondas por 15 s.
- **Orçamento de retry** (retries ≤ 10% do tráfego): sem ele, os retries podem manter um sistema **metaestavelmente** fora do ar.

<p class="small">Lab 9: 3 tentativas, 200 ms × 2 ± 50%, em erros de E/S, 5xx e resets. Playground: <code>retry-storm</code>.</p>

---

## Circuit breaker e fallback

<div class="flow">
<div class="box green">fechado<small>chamadas passam · últimas 20 contadas (mín. 10)</small></div><div class="arrow">≥ 50% falharam ou > 800 ms →</div>
<div class="box red">aberto<small>falha em µs por 10 s</small></div><div class="arrow">10 s →</div>
<div class="box orange">meio-aberto<small>3 sondas decidem</small></div>
</div>

- Abre com taxa **≥** o limite; chamadas lentas têm **a sua própria** taxa. O meio-aberto julga as **taxas das sondas**.
- Limite de chamada lenta **abaixo do timeout** (800 ms < 1 s): uma chamada além do timeout é falha, nunca "lenta".
- Padrões do Resilience4j: janela 100, mínimo 100, espera 60 s, 10 sondas, lentas em 60 s / 100% — lentos demais para reagir.
- 10 s aberto = até ~10 s de "pagamento temporariamente indisponível" depois que o provedor se recupera. **Nunca sucesso falso**.

---

## Bulkheads e load shedding

<div class="cols">
<div>

### Bulkhead

<div class="flow">
<div class="box">order<small>50 threads</small></div><div class="arrow">→</div>
<div class="group"><div class="box orange">payment<small>10 permissões, sem fila</small></div><div class="box green">todo o resto<small>40 threads</small></div></div>
</div>

- 20 pagamentos/s × 0,2 s = **4** em voo → 10 = 2,5× de folga.
- Provedor a 3 s → **10** threads esperam, não 60.
- Custo: capacidade que **não pode ser compartilhada**.

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

<!-- _class: tight -->

## A pilha em order → payment (lab 9)

<div class="flow">
<div class="box">charge</div><div class="arrow">→</div>
<div class="box accent">Retry<small>3 tentativas</small></div><div class="arrow">→</div>
<div class="box accent">CircuitBreaker<small>aberto? 503</small></div><div class="arrow">→</div>
<div class="box accent">Bulkhead<small>cheio? 503</small></div><div class="arrow">→</div>
<div class="box">HTTP<small>500 ms / 1 s</small></div>
</div>

```yaml
resilience4j:
  retry.instances.payment:
    max-attempts: ${PAYMENT_RETRY_ATTEMPTS:3}   # 200 ms, 400 ms, ± 50%
  circuitbreaker.instances.payment:
    sliding-window-size: 20                      # min 10 calls
    failure-rate-threshold: 50
    slow-call-duration-threshold: 800ms
    wait-duration-in-open-state: 10s
  bulkhead.instances.payment:
    max-concurrent-calls: ${PAYMENT_BULKHEAD:10}
    max-wait-duration: 0
```

<p class="small">Da mais externa para dentro, cada uma por um motivo: o retry fora do breaker (um breaker aberto o para), o fallback no retry (roda uma vez), o timeout por dentro (limita cada tentativa). A mesma ordem do handler de resiliência padrão do .NET, da Microsoft. Medido: mediana do <code>GET /orders/{id}</code> de 9,04 s sem proteção e 6,5 ms com proteção.</p>

---

## Simulador: o que segura um provedor lento?

<div class="flow">
<div class="box red">nada<small>50 threads ocupadas · ~220 pagamentos sem thread</small></div><div class="arrow">→</div>
<div class="box orange">timeout<small>~20 threads · 0% dão certo</small></div><div class="arrow">→</div>
<div class="box orange">+ retries<small>2× a carga · pool cheio de novo</small></div><div class="arrow">→</div>
<div class="box green">+ breaker<small>abre em 1,6 s · ~1 thread</small></div>
</div>

- O simulador **resilience** da página de padrões: provedor a 4 s, as chaves do lab 9, uma de cada vez.
- Arraste a latência de volta para 200 ms: 10 s depois de abrir, meio-aberto, 3 sondas, fechado.

<div class="warn">

Timeout + retries **sem** breaker é pior que nada: 0 pagamentos dão certo a cada 10 s (128 com nada ligado), o pool lota de novo e o provedor recebe 2× a carga.

</div>

---

## Health checks

| Probe | Pergunta | Na falha |
|---|---|---|
| **Startup** | terminou de subir? | continua esperando (até um limite) |
| **Liveness** | o processo travou? | **reinicia** o contêiner |
| **Readiness** | pode servir tráfego agora? | **tira do load balancer** |

<div class="warn">

Nunca ponha dependências no **liveness**: se o liveness do `order` verifica o provedor de pagamento, um soluço do provedor reinicia **todas as réplicas do `order` de uma vez**.

</div>

<p class="small">Spring Boot 4: <code>/actuator/health/liveness</code> e <code>/readiness</code> vêm ligados por padrão (antes, só no Kubernetes).</p>

---

## Recuperação de desastres (DR): quantos dados, quanto tempo?

- **Objetivo de ponto de recuperação (RPO, *recovery point objective*)**: quantos **dados** (em tempo) você aceita perder.
- **Objetivo de tempo de recuperação (RTO, *recovery time objective*)**: quanto tempo até o serviço **voltar**.
- Defina **por classe de dados**: pagamentos ≈ 0 / 15 min · catálogo 1 h / 1 h · analytics 24 h / 2 dias.

<div class="warn">

**Replicação não é backup**: o standby replica `DELETE FROM orders` em milissegundos. Falhas lógicas pedem **backups com recuperação a um ponto no tempo (PITR, *point-in-time recovery*)** — e um tempo de restauração **medido** (2 TB a 200 MB/s ≈ 2,8 h).

</div>

<p class="small">Backups 3-2-1 + uma cópia imutável; conta separada; teste restaurações todo mês (lembre do GitLab, 2017).</p>

---

## As quatro estratégias de recuperação de desastres

<div class="flow">
<div class="box">backup e restore<small>backups + infraestrutura como código<br>RPO horas · RTO horas–dia · $</small></div><div class="arrow">→</div>
<div class="box accent">pilot light<small>dados replicados, serviços desligados<br>RPO minutos · RTO dezenas de min · $$</small></div><div class="arrow">→</div>
<div class="box orange">warm standby<small>cópia completa, reduzida, rodando<br>RPO s–min · RTO minutos · $$$</small></div><div class="arrow">→</div>
<div class="box green">ativo-ativo<small>cópias completas, todas servindo<br>RPO ≈ 0 · RTO ≈ 0 · $$$$</small></div>
</div>

- A replicação entre regiões costuma ser assíncrona: **RPO = atraso da replicação**.
- Tier 0 do BoxOffice (`order`, `payment`, `inventory`): **warm standby** — restaurar é lento demais e ativo-ativo vende o mesmo lugar duas vezes.

<p class="small">Residência de dados (LGPD no Brasil, GDPR na Europa) restringe quais regiões podem guardar a cópia.</p>

---

## Failover regional

> RTO ≈ detectar (2 min) + decidir (5) + promover o banco (1) + escalar (5) + tempo de vida (TTL, *time to live*) do Sistema de Nomes de Domínio (DNS, *Domain Name System*) (1) ≈ 14 min

- Detecte **de fora** da região; decida com um runbook ensaiado.
- **Faça fencing** do primário antigo — dois primários = lugares vendidos duas vezes.
- **Estabilidade estática**: imagens, segredos, cotas já na região B.
- Lugares não podem ser multi-líder: **região dona por evento** + warm standby, ou um banco globalmente consistente.

<p class="small">Playground: <code>multi-region</code> — derrube a região primária e depois mude o TTL do DNS.</p>

---

## Engenharia do caos

<div class="flow">
<div class="box">estado estável<small>SLIs</small></div><div class="arrow">→</div>
<div class="box">hipótese</div><div class="arrow">→</div>
<div class="box orange">injetar<small>uma falha real</small></div><div class="arrow">→</div>
<div class="box">observar</div><div class="arrow">→</div>
<div class="box">analisar</div><div class="arrow">→</div>
<div class="box green">melhorar<small>depois ampliar</small></div>
</div>

- BoxOffice: o Toxiproxy acrescenta **3 s** ao provedor sob a carga k6 do lab 9 → espera-se o breaker aberto em < 10 s e o `browse` estável — as compras **não** entram no estado estável, a hipótese espera que falhem rápido.
- Raio de impacto pequeno: Compose → homologação → um pod canary → mais amplo; **aborte** com burn rate > 10×.
- **Observabilidade primeiro**: dashboards mostram a queda em segundos, alertas em minutos — depois quebrar.

<p class="small">A Netflix escreveu os princípios (principlesofchaos.org, IEEE Software 2016). Ferramentas: Toxiproxy, Chaos Mesh, AWS Fault Injection Service (FIS, chamado Fault Injection Simulator até nov. de 2023).</p>

---

## Game day: a flash sale

| Hora | Injeção | Esperado |
|---|---|---|
| 10:10 | latência de 3 s no provedor | breaker abre em < 10 s; lugares reservados |
| 10:25 | um pod do `order` morto por minuto | o N+1 absorve |
| 10:40 | broker do Kafka parado | o outbox cresce e esvazia; nenhum e-mail perdido |
| 10:55 | failover do banco | ~30 s de erros de escrita |
| 11:10 | Redis esvaziado | a proteção contra stampede segura |

<div class="ok">

Papéis: game master, plantão, observadores, escriba. Resultado: uma lista **blameless** de melhorias.

</div>

---

<!-- _class: tight -->

## O mapa de conceitos de confiabilidade

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `lb`, `app` | perder uma réplica ou uma zona nos para? | noves, série/paralelo, N+1, multi-AZ |
| `thirdparty`, `payment` | e se uma dependência ficar *lenta*? | timeout, retry + jitter, breaker, bulkhead |
| `apigw` | o que recusamos sob sobrecarga? | rate limiting, load shedding, sala de espera |
| `healthcheck` | o tráfego deve chegar a esta instância? | liveness, readiness, startup |
| `metrics`, `alerting` | somos confiáveis o *suficiente*? | SLI, objetivo de nível de serviço (SLO, *service level objective*), orçamento de erros, burn rate (aula 9) |
| `sql`, `objstore`, `dns` | quantos dados e quanto tempo podemos perder? | RPO/RTO, PITR, estratégias de DR, failover |

<p class="small">Redundância mantém instâncias servindo, padrões contêm dependências lentas, DR cobre o que a redundância não cobre, SLOs dizem quanto basta — e o <b>caos</b> prova tudo isso.</p>

---

## Conclusões

1. Disponibilidade = MTTF / (MTTF + MTTR); série **multiplica**, paralelo `1 − (1 − a)ⁿ` — só com falhas independentes.
2. Reduzir o MTTR costuma ser mais barato que aumentar o MTTF.
3. Dependências **lentas** se propagam em cascata por pools esgotados — a Lei de Little diz quão rápido.
4. Timeout · retry com jitter · breaker que conta chamadas lentas · bulkhead · fallback honesto — dimensionados com números.
5. Redundância se compra: o **orçamento de erros** decide quanto; DR parte de **RPO/RTO** e replicação ≠ backup.
6. **Experimentos de caos e game days** provam as defesas — observabilidade primeiro.
