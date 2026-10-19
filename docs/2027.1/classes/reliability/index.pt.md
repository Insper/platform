São 10:02, dois minutos depois da abertura de vendas do estádio. O BoxOffice está aguentando: a sala de espera admite fãs em ritmo constante, o `inventory` está a 60% da sua capacidade. Então o provedor externo de pagamento começa a responder em **4 segundos em vez de 200 ms**. Em um minuto, o `order` fica sem threads livres; o gateway, esperando pelo `order`, também; e fãs que só queriam *navegar* pelo catálogo recebem erros. Nada no BoxOffice está quebrado — nenhum bug, nenhum crash, nenhum disco cheio. O sistema simplesmente não tinha defesa contra uma dependência lenta, e a lentidão se espalhou até derrubar tudo.

Esta aula é sobre construir essas defesas e sobre decidir **com números** quanta falha é aceitável. **Confiabilidade** é a probabilidade de um sistema executar a função exigida sem falhar, em condições definidas, por um período definido[^1]. Em sistemas distribuídos essa definição cobre muito mais que hardware: bugs de software, dependências sobrecarregadas, partições de rede, deploys ruins, data centers perdidos e erros de operação.

Um sistema confiável não é aquele que nunca falha. É aquele que **falha de forma controlada, se recupera rápido e limita o raio de impacto (blast radius)** de qualquer falha isolada — sendo o **raio de impacto** o conjunto de usuários e componentes afetados por uma falha.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula você deve ser capaz de:

    - **Calcular** a disponibilidade a partir de MTTF e MTTR, a indisponibilidade permitida por um número de "noves" e a disponibilidade de ponta a ponta de componentes em série e em paralelo.
    - **Explicar** como uma dependência lenta causa uma falha em cascata e **estimar** com a Lei de Little os recursos que ela esgota.
    - **Definir** SLIs e SLOs para as jornadas de usuário do BoxOffice e **calcular** error budgets e burn rates.
    - **Escolher e configurar** padrões de resiliência — timeouts, retries com backoff e jitter, circuit breakers, bulkheads, load shedding e rate limiting — para uma chamada entre dois serviços, e **prever** o que cada um faz sob falha.
    - **Projetar** uma estratégia de recuperação de desastres a partir de metas de RPO e RTO, escolhendo entre backup e restore, pilot light, warm standby e ativo-ativo.
    - **Planejar** um experimento de caos e um game day com uma hipótese de estado estável e um raio de impacto controlado.

## Roteiro

1. **Esta visão geral** — disponibilidade, MTTF/MTTR, os "noves", disponibilidade composta, redundância e failover, modos de falha e falhas em cascata.
2. [SLIs, SLOs e error budgets](slo/index.md) — como medir a confiabilidade do ponto de vista do usuário, definir metas e gastar o orçamento.
3. [Padrões de resiliência](patterns/index.md) — timeout, retry com backoff e jitter, circuit breaker, bulkhead, load shedding, rate limiting, health checks, com Resilience4j.
4. [Recuperação de desastres](disaster-recovery/index.md) — RPO e RTO, backups, multi-AZ e multi-região, e as quatro estratégias de DR.
5. [Engenharia do caos](chaos/index.md) — injetar falhas de propósito para provar que as defesas funcionam; game days.
6. [Quiz](quiz.md) — teste seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/reliability.html" title="Slides: confiabilidade e resiliência" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/reliability.html){:target="_blank"}

---

## Disponibilidade

A face mais visível da confiabilidade é a **disponibilidade**: a fração do tempo (ou das requisições) em que o sistema funciona. Confiabilidade e disponibilidade são relacionadas, mas não são a mesma coisa. Um serviço que cai por um segundo a cada minuto falha *com frequência* (confiabilidade ruim), mas ainda tem cerca de 98% de disponibilidade; um serviço que falha uma vez por ano mas leva uma semana para ser reparado é muito confiável e pouco disponível. A disponibilidade vem de duas grandezas mensuráveis:

| Termo | Nome completo | Significado |
|---|---|---|
| **MTTF** | Mean Time To Failure | Tempo médio de funcionamento antes de uma falha |
| **MTTR** | Mean Time To Repair (ou Recover) | Tempo médio para detectar, diagnosticar e restaurar o serviço depois de uma falha |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — o ciclo completo de falha e recuperação |

$$
\text{Availability} = \frac{MTTF}{MTTF + MTTR}
$$

!!! example "BoxOffice: duas formas de melhorar o `inventory`"

    O `inventory` cai em média uma vez a cada 30 dias (MTTF = 720 h). A cada vez, leva 2 horas até alguém ser acionado, achar o problema e reiniciá-lo (MTTR = 2 h).

    Disponibilidade = 720 / (720 + 2) ≈ **99,72%**.

    - Reduzir as falhas pela metade (MTTF = 1440 h): 1440 / 1442 ≈ 99,86%.
    - Deixar o Kubernetes detectar o crash e reiniciar o pod em 1 minuto (MTTR ≈ 0,017 h): 720 / 720,017 ≈ **99,998%**.

    Recuperar mais rápido foi o ganho maior — e muito mais barato que nunca falhar.

O trabalho de confiabilidade puxa uma de duas alavancas. **Aumentar o MTTF** (menos falhas): testes, revisão de código, redundância, projeto tolerante a falhas, deploys cuidadosos. **Reduzir o MTTR** (recuperação mais rápida): bons alertas, dashboards e traces, runbooks, reinícios e failover automáticos, rollbacks rápidos. Em sistemas modernos o MTTR costuma ser a alavanca mais barata, e o próprio MTTR é uma soma — **tempo para detectar + tempo para diagnosticar + tempo para corrigir** — cada parcela atacada por uma prática diferente (veja [Observabilidade](../observability/index.md)).

### Os "noves"

Metas de disponibilidade são expressas em número de "noves". A tabela mostra a indisponibilidade que cada meta permite (ano = 365,25 dias, mês = 1/12 de ano ≈ 30,44 dias):

| Disponibilidade | Por ano | Por mês | Por 28 dias | Por semana |
|---|---|---|---|---|
| 99% ("dois noves") | 3,65 dias | 7,31 horas | 6,72 horas | 1,68 hora |
| 99,9% ("três noves") | 8,77 horas | 43,8 minutos | 40,3 minutos | 10,1 minutos |
| 99,95% | 4,38 horas | 21,9 minutos | 20,2 minutos | 5,04 minutos |
| 99,99% ("quatro noves") | 52,6 minutos | 4,38 minutos | 4,03 minutos | 1,01 minuto |
| 99,999% ("cinco noves") | 5,26 minutos | 26,3 segundos | 24,2 segundos | 6,05 segundos |

Cada nove a mais é **10× menos indisponibilidade**, e não é uma melhoria incremental: muda a forma de operar. Com três noves, uma pessoa pode ser acionada, abrir o notebook e fazer rollback. Com quatro noves, o orçamento do mês inteiro é menor que o tempo de acordar; detecção e recuperação precisam ser automáticas. Com cinco noves, até o failover automático precisa terminar em segundos, e um único deploy ruim pode gastar o orçamento do ano.

!!! warning "Sempre diga a janela"
    "99,9%" sozinho é ambíguo: 43,8 minutos em um mês de calendário, 40,3 minutos em uma janela de 28 dias. Sempre que citar disponibilidade, diga em qual janela — e se ela conta tempo ou requisições (veja [SLOs](slo/index.md)).

---

## Disponibilidade composta { #composite-availability }

Uma requisição atravessa muitos componentes, e a disponibilidade que o usuário vê depende de como eles se combinam[^2]. Duas regras cobrem quase todos os casos (veja também [Matemática da disponibilidade](../estimation/availability-math/index.md)).

=== "Em série (todos são necessários)"

    Quando uma requisição precisa de **todos** os componentes, as disponibilidades se **multiplicam**:

    $$
    A_{\text{series}} = A_1 \times A_2 \times \cdots \times A_n
    $$

    Três serviços com 99,9% cada dão $0.999^3 \approx 99.7\%$. A cadeia é pior que seu elo mais fraco, e **cada dependência síncrona adicionada baixa o teto**. Um serviço nunca pode prometer mais disponibilidade que o produto das dependências que ele chama de forma síncrona.

=== "Em paralelo (qualquer um basta)"

    Quando **qualquer uma** de $n$ réplicas independentes basta, o sistema só falha se todas falharem juntas:

    $$
    A_{\text{parallel}} = 1 - (1 - a)^n
    $$

    Duas réplicas com 99% dão $1 - 0.01^2 = 99.99\%$; três dão 99,9999%. A redundância transforma componentes medíocres em componentes muito disponíveis — **desde que suas falhas sejam independentes**. O mesmo bug, a mesma configuração ruim, o mesmo host ou a mesma zona quebram essa hipótese.

Aplique as duas regras ao caminho de compra do BoxOffice. Os números são suposições ilustrativas, mas a forma do resultado é geral:

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})

def parallel(a, n):                 # n independent replicas, any one is enough
    return 1 - (1 - a) ** n

MONTH_MIN = 365.25 / 12 * 24 * 60  # minutes in an average month

# Illustrative availabilities of the BoxOffice purchase path
designs = {
    "1 instance each": {
        "lb": 0.9999, "gateway": 0.995, "order": 0.995, "inventory": 0.995,
        "sql": 0.999, "payment provider": 0.999},
    "3 replicas of the\nstateless services": {
        "lb": 0.9999, "gateway": parallel(0.995, 3), "order": parallel(0.995, 3),
        "inventory": parallel(0.995, 3), "sql": 0.999, "payment provider": 0.999},
    "+ SQL with automatic\nfailover (Multi-AZ)": {
        "lb": 0.9999, "gateway": parallel(0.995, 3), "order": parallel(0.995, 3),
        "inventory": parallel(0.995, 3), "sql": 0.9995, "payment provider": 0.999},
    "+ second payment\nprovider as fallback": {
        "lb": 0.9999, "gateway": parallel(0.995, 3), "order": parallel(0.995, 3),
        "inventory": parallel(0.995, 3), "sql": 0.9995, "payment provider": parallel(0.999, 2)},
}

names, downtime = [], []
for name, parts in designs.items():
    a = 1.0
    for v in parts.values():
        a *= v                      # in series: every component is needed
    names.append(f"{name}\n{100 * a:.3f}%")
    downtime.append((1 - a) * MONTH_MIN)

fig, ax = plt.subplots(figsize=(10, 3.8))
bars = ax.barh(names[::-1], downtime[::-1], color=["#388e3c", "#7cb342", "#fb8c00", "#e53935"])
for b, d in zip(bars, downtime[::-1]):
    ax.text(b.get_width() + 3, b.get_y() + b.get_height() / 2, f"{d:.0f} min/month", va="center")
ax.set_xlabel("expected minutes per month in which a purchase cannot complete")
ax.set_xlim(0, max(downtime) * 1.25)
ax.grid(True, axis="x", alpha=0.3)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Lendo o gráfico de cima para baixo:

- Com **uma instância de tudo**, os três serviços com 99,5% dominam: cerca de 98,3%, mais de 12 horas por mês sem compras.
- **Três réplicas** dos serviços sem estado os tornam praticamente perfeitos, e o gargalo passa para os componentes que *não* são replicados: o banco de dados e o provedor externo de pagamento.
- **Failover automático do banco** (um standby em outra zona) e um **segundo provedor de pagamento** atacam esses dois. Cada passo remove o elo mais fraco do momento — e o próximo mais fraco fica visível.

``` mermaid-sim
flowchart LR
    fan(["fã"]) --> lb["load balancer<br/>99,99%"]
    lb --> g1["gateway #1"]
    lb --> g2["gateway #2"]
    lb --> g3["gateway #3"]
    g1 --> o["order × 3"]
    g2 --> o
    g3 --> o
    o --> i["inventory × 3"]
    i --> db[("SQL primário<br/>+ standby na AZ-b")]
    o --> p1["provedor de pagamento A<br/>99,9%"]
    o -.->|"fallback"| p2["provedor de pagamento B<br/>99,9%"]
```

!!! tip "Redundância tem preço"
    Cada passo do gráfico custa dinheiro (três vezes mais instâncias, um banco em standby, o contrato com um segundo provedor) e complexidade (lógica de failover, testar o fallback). Confiabilidade se compra, não é de graça: o [error budget](slo/index.md) é como você decide quanto comprar.

---

## Redundância e failover

Redundância só ajuda se o tráfego realmente sair do componente que falhou — isso é o **failover** — e se a cópia redundante estiver pronta para recebê-lo.

| Padrão | Como funciona | Tempo de failover | Custo | Exemplo no BoxOffice |
|---|---|---|---|---|
| **Ativo-ativo** | Todas as cópias atendem tráfego; o load balancer para de enviar para a que falhou | Segundos (intervalo do health check) | Cada cópia precisa absorver a carga extra | Réplicas sem estado de `gateway`, `order`, `catalog` |
| **Ativo-passivo (hot standby)** | Um standby recebe o estado replicado e é promovido na falha | Segundos a poucos minutos | O standby é pago mas fica ocioso | PostgreSQL primário + standby síncrono em outra zona |
| **Cold standby** | A cópia só é iniciada (ou restaurada) depois de uma falha | Minutos a horas | O mais barato | Workers de analytics, recriados a partir de imagens |

Duas regras fazem a redundância funcionar:

- **Capacidade N + 1 (ou N + 2).** Se a flash sale precisa de 6 réplicas do `order`, rode 7 ou 8: depois de perder uma (ou durante um deploy rolling), as restantes ainda precisam aguentar o pico. Com réplicas espalhadas em **3 zonas de disponibilidade**, perder uma zona inteira remove um terço da capacidade — planeje para isso.
- **Sem estado sempre que possível.** Serviços sem estado fazem failover de forma trivial. O estado (bancos, caches, filas) precisa de replicação, e a replicação traz as perguntas difíceis: síncrona ou assíncrona, quantos dados podem se perder, e como evitar dois primários ao mesmo tempo (**split brain**; veja [Consenso](../distributed/consensus/index.md)). A página de [recuperação de desastres](disaster-recovery/index.md) trata do failover entre regiões.

!!! info "Zonas de disponibilidade e regiões"
    Uma **zona de disponibilidade** (AZ) é um ou mais data centers com energia, refrigeração e rede independentes, a alguns quilômetros das outras zonas da mesma **região**; a latência entre zonas é de cerca de um milissegundo. Espalhar réplicas entre zonas protege contra a falha de um data center a um custo de latência quase nulo. Espalhar entre **regiões** (a centenas ou milhares de quilômetros) protege contra um desastre regional, mas toda chamada síncrona entre regiões custa dezenas de milissegundos.

---

## Modos de falha

Sistemas distribuídos falham de formas que uma máquina sozinha não falha. **Falhas parciais** — alguns componentes funcionam e outros não — são muito mais comuns que indisponibilidades totais, e mais difíceis de tratar.

| Classe de falha | Características | Estratégia de tratamento |
|---|---|---|
| **Crash (fail-stop)** | O processo morre e continua morto | Health checks, reinício, failover para uma réplica |
| **Transitória** | Se resolve sozinha em segundos (oscilação de rede, eleição de líder) | Retry com backoff e jitter |
| **Lenta / gray failure** | Ainda responde, mas devagar ou com alguns erros; os health checks podem continuar passando | Timeouts, circuit breakers, detecção de outliers, SLIs de latência |
| **Intermitente** | Aparece e some (pausas de GC, um recurso vazando) | Latência em percentis, detecção de anomalias, profiling |
| **Bizantina / incorreta** | Devolve dados errados sem cair (bit flips, cache corrompido, bug) | Checksums, validação, reconciliação |
| **Correlacionada** | Muitos componentes falham juntos (deploy ruim, certificado expirado, queda de zona) | Rollouts graduais, diversidade, multi-zona, testes de caos |

A mais perigosa delas não é o crash, e sim o componente **lento**. Uma dependência que caiu responde na hora — com um erro de conexão — e quem chamou segue em frente. Uma dependência lenta segura os recursos de quem chamou enquanto pensa. Quem chama não consegue distinguir lento de morto (veja [Sistemas distribuídos](../distributed/index.md)), então, sem um prazo, espera.

### Falhas em cascata { #cascading-failures }

Uma dependência lenta esgota um recurso de quem a chama — threads, conexões, memória — e quem chama, esgotado, fica lento para os *seus* chamadores. O esgotamento sobe pelo grafo de chamadas até funcionalidades sem relação falharem. Esse é o jeito mais comum de sistemas de microsserviços caírem[^3].

``` mermaid-sim
sequenceDiagram
    participant F as Fãs
    participant G as gateway
    participant O as order (200 threads)
    participant P as provedor de pagamento
    F->>G: POST /orders (100 por segundo)
    G->>O: cria pedido
    O->>P: cobra (normalmente 200 ms)
    Note over P: degrada: 4 s por chamada
    Note over O: 100/s × 4 s = 400 chamadas em voo > 200 threads
    F->>G: GET /events/ev-88 (catálogo)
    G->>O: (threads do gateway também esperando o order)
    G-->>F: 503 — nenhuma thread livre
    Note over F,G: a navegação também falha, embora o catálogo esteja saudável
```

A aritmética é a Lei de Little (veja [Filas](../estimation/queueing/index.md)): **chamadas em voo = taxa de chegada × tempo de cada chamada.**

| Latência do pagamento | Chamadas em voo a 100 compras/s | Pool de threads do `order` (200) |
|---|---|---|
| 200 ms (normal) | 100 × 0,2 = **20** | 10% ocupado |
| 1 s | 100 × 1 = **100** | 50% ocupado |
| 4 s | 100 × 4 = **400** | esgotado: requisições enfileiram e depois dão timeout |

Nada na taxa de compras mudou. Um aumento de 20× na latência de uma dependência virou um aumento de 20× nas threads ocupadas. Quando o pool enche, todas as rotas do `order` esperam — inclusive as que nunca chamam o pagamento — e o gateway, esperando pelo `order`, enche o próprio pool.

Três coisas param a cascata, cada uma tratada em [Padrões de resiliência](patterns/index.md):

- Um **timeout** limita quanto tempo uma chamada pode segurar uma thread (timeout de 1 s → no máximo 100 threads, não 400).
- Um **circuit breaker** para de chamar uma dependência que está falhando, então as chamadas falham em microssegundos em vez de segundos.
- Um **bulkhead** dá às chamadas de pagamento um pool próprio e limitado, para que elas não tomem as threads de outras rotas.

!!! info "Experimente no playground"

    O cenário `cascading-failure` tem um app chamando uma API de terceiros lenta, sem timeouts. Aperte **Run** e observe as threads ocupadas do app subirem, depois a latência e os erros, depois os erros de rotas que nem usam o terceiro. Agora adicione um **timeout** à chamada ao terceiro e rode de novo; depois habilite o **circuit breaker** e compare a taxa de erros e o p99 das rotas saudáveis. Abra o [playground completo](../../../playground/index.md) para testar um bulkhead.

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="540"></div>

### Outros amplificadores { #other-amplifiers }

Cascatas são um exemplo de uma família maior: falhas que **se alimentam**.

- **Tempestades de retry.** Todo chamador repete chamadas que falharam, multiplicando a carga sobre uma dependência justamente quando ela está mais fraca ([padrões](patterns/index.md#retry-with-backoff-and-jitter)).
- **Manada (thundering herd) na recuperação.** Um serviço volta e todos os clientes, caches e consumidores de fila o atingem no mesmo instante; ele cai de novo.
- **Espiral da morte de autoscaling ou health checks.** Instâncias sobrecarregadas falham nos health checks e são removidas, então as restantes recebem *mais* carga e falham também.
- **Falhas metaestáveis.** O sistema continua quebrado *depois* que o gatilho passou, porque o trabalho gerado pela falha (retries, timeouts, cache misses) o mantém sobrecarregado[^4]. A solução é descartar carga até ele se recuperar — load shedding, retry budgets, circuit breakers.

---

## O mapa de conceitos de confiabilidade { #concept-map }

Confiabilidade não é um componente: é uma propriedade que se compra, peça por peça, em toda a paleta. O mapa liga cada **componente da paleta** (verde) aos **conceitos de confiabilidade** que ele carrega (azul); as setas mostram como a aula se constrói — redundância e probes mantêm as instâncias servindo, os padrões contêm dependências lentas, o DR cobre o que a redundância não cobre, os SLOs dizem quanto basta e o caos prova que tudo funciona:

``` mermaid
flowchart LR
    lbapp["lb · app"]:::comp -.- red["MTTF/MTTR, noves, série vs paralelo,<br/>redundância, N+1, multi-AZ"]:::tech
    tp["thirdparty · payment"]:::comp -.- casc["falhas em cascata<br/>(Lei de Little)"]:::tech
    casc --> pat["timeout, retry + jitter,<br/>circuit breaker, bulkhead, fallback"]:::tech
    apigw["apigw"]:::comp -.- shed["rate limiting,<br/>descarte de carga"]:::tech
    hc["healthcheck"]:::comp -.- probes["liveness, readiness,<br/>startup"]:::tech
    data["sql · objstore"]:::comp -.- dr["RPO / RTO, backups PITR,<br/>estratégias de DR"]:::tech
    dns["dns"]:::comp -.- dr
    obs["metrics · alerting"]:::comp -.- slo["SLI, SLO, orçamento de erros,<br/>burn rate"]:::tech
    probes --> red
    pat --> shed
    pat --> chaos["experimentos de caos,<br/>game days"]:::tech
    dr --> chaos
    slo --> chaos
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`lb`](../../reference/components/edge/index.md#lb), [`app`](../../reference/components/compute/index.md#app) | Perder uma réplica ou uma zona para a compra? | MTTF/MTTR, noves, série vs paralelo, ativo-ativo, N+1, multi-AZ | [esta visão geral](#composite-availability) | `scale-out` |
| [`thirdparty`](../../reference/components/external/index.md#thirdparty), [`payment`](../../reference/components/external/index.md#payment) | E se uma dependência ficar *lenta*? | falhas em cascata, timeout, retry + backoff + jitter, circuit breaker, bulkhead, fallback | [esta visão geral](#cascading-failures), [Padrões de resiliência](patterns/index.md) | `cascading-failure`, `retry-storm`, `payment-system` |
| [`apigw`](../../reference/components/edge/index.md#apigw) | Que trabalho recusamos em sobrecarga? | rate limiting por cliente, descarte de carga por prioridade, sala de espera | [Padrões de resiliência](patterns/index.md#load-shedding) | `rate-limiter`, `flash-sale` |
| [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | O tráfego deve chegar a esta instância? | liveness, readiness, startup; nenhuma dependência no liveness | [Padrões de resiliência](patterns/index.md#health-checks) | `scale-out` |
| [`metrics`](../../reference/components/observability/index.md#metrics), [`alerting`](../../reference/components/observability/index.md#alerting) | Somos confiáveis o *suficiente*? | SLI, SLO, orçamento de erros, burn rate, política de orçamento | [SLIs, SLOs e orçamento de erros](slo/index.md) | `observability-stack` |
| [`sql`](../../reference/components/storage/index.md#sql), [`objstore`](../../reference/components/storage/index.md#objstore) | Quantos dados e quanto tempo podemos perder? | RPO/RTO, PITR, backups 3-2-1, réplica atrasada | [Recuperação de desastres](disaster-recovery/index.md#rpo-rto) | `db-replicas` |
| [`dns`](../../reference/components/edge/index.md#dns) | Como os fãs chegam à região sobrevivente? | multirregião, as quatro estratégias de DR, fencing, TTL do DNS | [Recuperação de desastres](disaster-recovery/index.md#dr-strategies) | `multi-region` |
| *(todos eles)* | As defesas funcionam de verdade? | hipótese de estado estável, injeção de falhas, raio de impacto, game days | [Engenharia do caos](chaos/index.md) | `flash-sale` (caos) |

!!! tip "Na entrevista"
    Quando você termina um projeto, entrevistadores costumam perguntar "e se X falhar?" ou "e se X ficar lento?". Responda com uma cadeia: *quem chama X*, *que recurso segura enquanto espera*, *qual é o timeout*, *qual é o fallback* e *o que o usuário vê*. Para o BoxOffice: "o pagamento é chamado pelo `order` com timeout de 2 s, um circuit breaker e um bulkhead próprio de 50 chamadas concorrentes; quando o breaker abre, o fã vê 'pagamento temporariamente indisponível, seus lugares continuam reservados por 10 minutos' — e o catálogo não é afetado." Cite também a matemática da disponibilidade: "duas dependências com três noves em série nos limitam a 99,8%".

!!! warning "Armadilhas comuns"

    - **Nenhum timeout** em um cliente HTTP, ou um padrão de minutos: uma dependência lenta segura threads indefinidamente.
    - **Supor independência**: três réplicas no mesmo nó, ou com a mesma configuração ruim, falham juntas.
    - **Redundância sem testar o failover**: um standby que ninguém nunca promoveu é uma esperança, não um plano.
    - **Pools compartilhados**: um único pool de threads ou conexões para todas as dependências deixa a pior decidir por todas.
    - **Medir só crashes**: uma gray failure (lenta, parcialmente errada) passa nos health checks e prejudica os usuários.

---

## Relacionados

- **Hands-on:** [Hands-on 9 — Resiliência e caos](../../hands-on/9/index.md): Resilience4j entre `order` e `payment`, latência e falhas com Toxiproxy, um game day. [Hands-on 8 — Observabilidade](../../hands-on/8/index.md): alertas de burn rate de SLO. [Hands-on 10 — Kubernetes](../../hands-on/10/index.md): probes e autorrecuperação.
- **Projeto:** [Game day de caos](../../exercises/project/game-day/index.md).
- **Estudos de caso:** [Sistema de pagamentos](../case-studies/payment-system/index.md), [Venda de ingressos (flash sale do BoxOffice)](../case-studies/ticketing/index.md).
- **Aulas:** [Estimativas — matemática da disponibilidade](../estimation/availability-math/index.md), [Mensageria](../messaging/index.md) (a assincronia tira dependências do caminho crítico), [Observabilidade](../observability/index.md) (SLIs, alertas, resposta a incidentes).

---

[^1]: IEEE. *IEEE Standard Glossary of Software Engineering Terminology*, IEEE Std 610.12-1990.
[^2]: BEYER, B. et al. [Site Reliability Engineering: How Google Runs Production Systems](https://sre.google/books/){target="_blank"}. O'Reilly, 2016. Capítulo 3, "Embracing Risk"; capítulo 22, "Addressing Cascading Failures".
[^3]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2. ed. Pragmatic Bookshelf, 2018. Capítulo "Stability Antipatterns".
[^4]: BRONSON, N. et al. [Metastable Failures in Distributed Systems](https://sigops.org/s/conferences/hotos/2021/papers/hotos21-s11-bronson.pdf){target="_blank"}. In: *Workshop on Hot Topics in Operating Systems (HotOS)*, 2021.
