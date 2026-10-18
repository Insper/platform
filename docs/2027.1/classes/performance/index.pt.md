No ano passado, a maior venda do BoxOffice caiu às 10:02. O time *tinha* feito teste de carga: 200 usuários virtuais contra o staging, p95 de 180 ms, "tudo verde". No post-mortem, encontraram cinco problemas nesse teste. O staging tinha um décimo dos dados da produção, então toda consulta acertava um cache quente. Os usuários virtuais esperavam cada resposta antes de enviar a próxima requisição, então, quando o sistema ficou lento, o teste educadamente ficou lento junto e nunca viu a fila que os fãs reais formaram. O teste durou dez minutos e nunca chegou ao ponto em que o pool de conexões do banco se esgotava. Ninguém tinha escrito o que significava "bom o suficiente" antes de rodá-lo. E o relatório mostrava médias.

Engenharia de desempenho é a disciplina que evita esse post-mortem. Não é "rodar uma ferramenta e olhar um gráfico": é um **método** — declarar o objetivo, modelar a carga de trabalho, gerar carga que se comporte como usuários reais, medir o que os usuários sentem, encontrar o único recurso que limita o sistema, corrigi-lo e medir de novo. Esta aula ensina o método e as ferramentas, usando a venda relâmpago do BoxOffice como caso de teste.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula você deverá ser capaz de:

    - **Definir** latência, tempo de serviço, vazão, concorrência, utilização e saturação, e **relacioná-los** com a Lei de Little.
    - **Ler** uma curva vazão–latência, **localizar** o joelho e o ponto de saturação e **explicar** por que a latência explode quando a utilização se aproxima de 100 %.
    - **Aplicar** uma metodologia de desempenho — caracterização da carga, o método USE, métricas RED — para encontrar o gargalo de um sistema em vez de adivinhar.
    - **Projetar e escrever** testes smoke, load, stress, spike, soak e breakpoint em k6, escolhendo entre os modelos de carga aberto (taxa de chegada) e fechado (usuários virtuais), com thresholds que codificam os SLOs.
    - **Detectar** a omissão coordenada e outros erros de medição (dados irreais, caches frios, gerador de carga saturado) que fazem um teste mentir.
    - **Diagnosticar** um gargalo com profiling (flame graphs do async-profiler e do py-spy), ferramentas de banco de dados (`EXPLAIN ANALYZE`, `pg_stat_statements`) e dimensionamento de pools.
    - **Planejar** capacidade com a Lei de Little e folga, e **impor** orçamentos de desempenho na CI.

## Roteiro

1. **Esta visão geral** — o vocabulário, a curva vazão–latência e seu joelho, e o ciclo de engenharia de desempenho.
2. [Metodologia](methodology/index.md) — anti-métodos, caracterização da carga, os métodos USE e RED, ambientes de teste, dados de teste e aquecimento.
3. [Testes de carga](load-testing/index.md) — os seis tipos de teste em k6, modelos aberto vs fechado, thresholds como SLOs, omissão coordenada, caos sob carga e os perfis do playground.
4. [Encontrando gargalos](bottlenecks/index.md) — leitura dos resultados, profiling e flame graphs, gargalos de banco de dados, dimensionamento de pools.
5. [Planejamento de capacidade](capacity-planning/index.md) — Lei de Little e folga, atraso do autoscaling, um modelo de capacidade para a venda e orçamentos de desempenho na CI.
6. [Quiz](quiz.md) — teste seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/performance.html" title="Slides: engenharia de desempenho e testes de carga" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/performance.html){:target="_blank"}

---

## O vocabulário de desempenho

Palavras precisas evitam a maioria das discussões sobre desempenho. A [aula de Estimativas](../estimation/index.md) as apresentou; aqui elas viram alvos de medição.

| Termo | Definição | Exemplo no BoxOffice |
|---|---|---|
| **Tempo de serviço** (S) | Tempo que um recurso passa de fato trabalhando em uma requisição | 4 ms de CPU e 6 ms de banco para fazer uma reserva de assento |
| **Tempo de espera (fila)** | Tempo que uma requisição passa esperando um recurso ocupado | Esperar uma conexão livre no pool |
| **Latência / tempo de resposta** (R) | O que o cliente mede: espera + serviço + rede | `POST /holds` levou 230 ms de ponta a ponta |
| **Vazão** (X) | Requisições concluídas por unidade de tempo | 1 800 reservas por segundo |
| **Concorrência** (N) | Requisições no sistema no mesmo instante (em serviço ou esperando) | 120 reservas em andamento |
| **Utilização** (U) | Fração do tempo em que um recurso está ocupado | CPU do banco ocupada 82 % do tempo |
| **Saturação** | Trabalho que o recurso ainda não consegue atender — o tamanho da fila | 40 requisições esperando uma conexão |
| **Percentil** (p50, p99, p99.9) | O valor abaixo do qual fica aquela fração das observações | p99 = 300 ms: 1 reserva em 100 é mais lenta que 300 ms |
| **Taxa de erros** | Fração de requisições com falha — incluindo timeouts | 0,3 % das reservas retornaram 503 |

Três relações valem para qualquer sistema estável e merecem ser memorizadas:

- **Lei de Little**: $N = X \times R$ — a concorrência é igual à vazão vezes o tempo de resposta[^1]. A 1 800 reservas/s e 0,12 s cada, há em média 216 reservas em andamento: é de quantas threads, conexões ou slots assíncronos o caminho precisa.
- **Lei da utilização**: $U = X \times S$ — um banco que gasta 0,4 ms de CPU por consulta (por núcleo) a 2 000 consultas/s em um núcleo está 80 % ocupado.
- **Tempo de resposta = tempo de serviço + tempo de espera**: otimizar código encurta o tempo de serviço; adicionar capacidade ou reduzir a carga encurta a espera. Perto da saturação, a espera domina.

!!! warning "Médias mentem"

    Uma média de 120 ms é compatível com "todos esperam 120 ms" e com "99 % esperam 20 ms e 1 % espera 10 s". Usuários — e SLOs — vivem na cauda. Reporte percentis a partir de **histogramas** (HDR ou histogramas nativos), nunca a média de percentis de máquinas ou intervalos diferentes: percentis não podem ser somados e divididos. Veja [Percentis e latência de cauda](../estimation/percentiles/index.md).

---

## A curva vazão–latência e seu joelho

Todo sistema, de uma thread a um data center, mostra a mesma forma quando você aumenta a carga. O gráfico da esquerda modela um pod de `inventory` com 8 threads de trabalho e 20 ms de tempo médio de serviço — capacidade de 400 requisições por segundo — como uma fila M/M/8. O da direita usa a **Lei Universal de Escalabilidade** (USL, *Universal Scalability Law*), que adiciona *contenção* (σ, esperar por recursos compartilhados) e *coerência* (κ, o custo de manter o estado compartilhado consistente) à escala linear ideal[^2]:

$$
X(N) = \frac{\lambda N}{1 + \sigma (N-1) + \kappa N (N-1)}
$$

```python exec="1" html="1"
# Two views of the same truth. Left: an M/M/c model of one inventory pod
# (8 worker threads, 20 ms mean service time -> capacity 400 req/s).
# Right: the Universal Scalability Law (illustrative coefficients).
import math
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

C, S = 8, 0.020                      # servers (threads) and mean service time (s)
MU = 1 / S

def erlang_c(lam):
    a = lam / MU                     # offered load in Erlangs
    rho = a / C
    top = a ** C / math.factorial(C) / (1 - rho)
    return top / (sum(a ** k / math.factorial(k) for k in range(C)) + top)

def p_resp_gt(t, lam):               # P(response time > t) for M/M/c, FIFO
    pw, th = erlang_c(lam), C * MU - lam
    both = (th * math.exp(-MU * t) - MU * math.exp(-th * t)) / (th - MU)
    return (1 - pw) * math.exp(-MU * t) + pw * both

def quantile(q, lam):
    lo, hi = 0.0, 10.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if p_resp_gt(mid, lam) > 1 - q else (lo, mid)
    return hi

lams = np.linspace(10, 396, 200)
mean = [1000 * (S + erlang_c(l) / (C * MU - l)) for l in lams]
p99 = [1000 * quantile(0.99, l) for l in lams]

# USL: X(N) = lambda*N / (1 + sigma*(N-1) + kappa*N*(N-1))
N = np.arange(1, 121)
LAM1, SIGMA, KAPPA = 40.0, 0.04, 0.0006
X = LAM1 * N / (1 + SIGMA * (N - 1) + KAPPA * N * (N - 1))
n_star = int(round(math.sqrt((1 - SIGMA) / KAPPA)))

fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))
a1.plot(lams, mean, color="#4C9BE8", linewidth=2, label="mean")
a1.plot(lams, p99, color="#F28E2B", linewidth=2, label="p99")
a1.axvspan(0.75 * C * MU, C * MU, color="gray", alpha=0.12)
a1.text(0.755 * C * MU, 330, "the knee:\n> 75 % busy", color="gray", fontsize=8)
a1.set_xlim(0, C * MU)
a1.set_ylim(0, 400)
a1.set_xlabel("offered load (req/s); capacity = 400", color="gray")
a1.set_ylabel("response time (ms)", color="gray")
a1.set_title("Latency vs load (M/M/8, 20 ms)", fontweight="bold", color="gray")
a1.legend(frameon=False, labelcolor="gray")

a2.plot(N, X, color="#59A14F", linewidth=2, label="USL throughput")
a2.plot(N, LAM1 * N, color="gray", linestyle=":", linewidth=1, label="linear (ideal)")
a2.axvline(n_star, color="gray", linestyle="--", linewidth=0.8)
a2.text(n_star + 2, X.max() * 0.25, f"peak at N ≈ {n_star}\nthen retrograde", color="gray", fontsize=8)
a2.set_ylim(0, X.max() * 1.6)
a2.set_xlabel("concurrent requests N", color="gray")
a2.set_ylabel("throughput (req/s)", color="gray")
a2.set_title("Throughput vs concurrency (USL)", fontweight="bold", color="gray")
a2.legend(frameon=False, labelcolor="gray", loc="upper left")
for ax in (a1, a2):
    ax.tick_params(colors="gray")
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Leia os dois gráficos juntos:

1. **A região plana.** Com carga baixa, a latência é só o tempo de serviço. Dobrar a carga quase não a muda. A maioria dos sistemas passa a maior parte da vida aqui, e é por isso que *parecem* rápidos.
2. **O joelho.** Acima de cerca de 70–80 % de utilização, as requisições começam a encontrar todos os servidores ocupados e entram na fila. A latência — e o p99 primeiro — se curva para cima. O joelho é a **capacidade útil** do sistema: a maior vazão em que o SLO de latência ainda é cumprido.
3. **Saturação.** Quando a carga oferecida se aproxima da capacidade, as filas crescem sem limite; a latência fica vertical e os timeouts viram erros. A vazão para de crescer.
4. **Escala retrógrada.** Com custos de contenção e coerência, adicionar *mais concorrência* depois do pico **reduz** a vazão — threads brigam por locks, caches se invalidam, conexões expiram e são refeitas. Um sistema empurrado além do pico pode vender *menos* ingressos por segundo do que um mantido logo abaixo dele, que é o argumento central para controle de admissão e salas de espera.

!!! example "BoxOffice: o joelho é o número com que você planeja"

    Se um pod de `inventory` mantém o p99 abaixo de 300 ms até 275 req/s e colapsa em 360, o número de capacidade para o planejamento é **275**, não 360. Para uma venda que espera 4 500 requisições de reserva por segundo no pico, isso significa ⌈4 500 / 275⌉ = 17 pods *antes* da folga — 22 a 75 % do joelho, 33 para sobreviver à perda de uma de três zonas — e um banco que aguente as conexões de 33 pods. A página de [Planejamento de capacidade](capacity-planning/index.md) constrói esse modelo de ponta a ponta.

Experimente: este cenário do playground é o sistema mais simples possível — cliente → servidor de aplicação → banco SQL — rodando o perfil **breakpoint**, que aumenta a taxa de chegada passo a passo até algo quebrar. Pressione **Run** e observe três números juntos: vazão, latência p99 e a utilização de cada componente. Anote a taxa em que o p99 começa a se curvar (o joelho) e qual componente chega a 100 % primeiro (o gargalo). Depois dê mais capacidade a esse componente e rode de novo: o joelho se move, e qual componente vira o novo gargalo?

<div class="sdp" data-scenario="monolith" data-mode="compact" data-profile="breakpoint" data-height="520"></div>

[Abra o playground completo](../../../playground/index.md) para adicionar um cache ou réplicas de leitura e ver como a curva muda.

---

## O ciclo de engenharia de desempenho

Trabalho de desempenho é um ciclo científico, não um evento único antes do lançamento[^3]:

``` mermaid-sim
flowchart LR
    slo["1. Objetivos<br/>SLOs por endpoint,<br/>pico esperado"] --> model["2. Modelo de carga<br/>mix, padrão de chegada,<br/>dados"]
    model --> test["3. Teste<br/>cenário k6 em um<br/>ambiente parecido com produção"]
    test --> analyze["4. Análise<br/>curva, USE, RED,<br/>perfis"]
    analyze --> fix["5. Mude UMA coisa<br/>(código, config,<br/>capacidade)"]
    fix --> test
    analyze --> ship["6. Publique + orçamento na CI<br/>monitore em produção"]
    ship --> slo
```

- **Objetivos primeiro.** "Rápido" não é um requisito. "`POST /holds`: p99 < 300 ms e erros < 0,1 % a 4 500 req/s" é. Sem isso, nenhum teste pode passar ou falhar.
- **Mude uma coisa de cada vez** e rode o mesmo teste de novo — senão você não consegue atribuir a melhoria.
- **A produção fecha o ciclo.** O tráfego real é o melhor modelo de carga: métricas e traces de produção alimentam o próximo teste, e o orçamento de desempenho na CI impede que regressões voltem.

| Nível | Pergunta | Ferramentas |
|---|---|---|
| **Micro-benchmark** | Esta função/estrutura de dados é mais rápida? | JMH (Java), `pytest-benchmark` |
| **Teste de componente** | Quantas req/s um pod de `inventory` sustenta dentro do SLO? | k6 contra um pod, com profiler acoplado |
| **Teste de sistema** | O caminho de compra inteiro aguenta o pico da venda? | Cenários k6 contra um ambiente parecido com produção[^4] |
| **Produção** | Está aguentando agora? De onde vem a cauda? | Dashboards RED, traces, profiling contínuo, alertas de SLO |

!!! tip "Na entrevista"

    Quando um entrevistador perguntar "como você saberia que este design aguenta o pico?", não diga "faríamos um teste de carga". Diga **o que** você testaria e **como leria**: "Um teste k6 de modelo aberto na taxa de chegada de pico esperada, com o mix realista de endpoints, thresholds de p99 e taxa de erros por endpoint, longo o suficiente para atingir o regime permanente com caches aquecidos; depois um teste breakpoint para achar o joelho e calcular a folga; o método USE no banco e no pool de conexões para descobrir o que satura primeiro."

!!! warning "Armadilhas comuns"

    - **Sem objetivo**: um teste sem critério de aprovação produz gráficos, não decisões.
    - **Testar o sistema errado**: dados minúsculos, caches quentes, tamanho de instância diferente, sem TLS, sem gateway.
    - **Testes de modelo fechado para tráfego de mundo aberto**: o gerador de carga desacelera junto com o sistema e esconde a fila (omissão coordenada).
    - **Médias e execuções únicas**: reporte percentis a partir de histogramas; repita as execuções e olhe a variância.
    - **Otimizar sem gargalo**: otimizar um componente a 20 % de utilização não muda nada.
    - **Um gerador de carga saturado**: se a máquina do k6 está a 100 % de CPU, você mediu o k6.

---

## O mapa de conceitos de desempenho { #concept-map }

A engenharia de desempenho não acrescenta caixas novas à paleta: ela **mede** as que você já tem. O mapa liga cada **componente da paleta** (verde) aos **conceitos** usados para carregá-lo, observá-lo e dimensioná-lo (azul):

``` mermaid
flowchart LR
    client["client · mobile<br/>(k6 generates them)"]:::comp --> edge["apigw · lb"]:::comp
    edge --> app["app"]:::comp
    app --> sql["sql"]:::comp
    app --> cache["cache"]:::comp
    queue["queue<br/>(waiting room)"]:::comp --> app
    obs["metrics · tracing"]:::comp -.- app
    client -.- c1["open vs closed model,<br/>6 test types, thresholds"]:::tech
    app -.- c2["Little's Law, the knee,<br/>USL"]:::tech
    sql -.- c3["EXPLAIN ANALYZE, hot rows,<br/>pool sizing"]:::tech
    cache -.- c4["warm-up, cold cache,<br/>hit ratio"]:::tech
    obs -.- c5["USE, RED,<br/>flame graphs"]:::tech
    queue -.- c6["headroom, autoscaling lag,<br/>admission control"]:::tech
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`client`](../../reference/components/client/index.md#client) · [`mobile`](../../reference/components/client/index.md#mobile) | Como a carga real *chega*? | modelo de carga, aberto (taxa de chegada) vs fechado (usuários virtuais), think time, omissão coordenada | [Metodologia](methodology/index.md#workload-model) · [Testes de carga](load-testing/index.md) | `flash-sale`, `monolith` |
| [`app`](../../reference/components/compute/index.md#app) | Quanto *uma réplica* aguenta dentro do SLO? | tempo de serviço, Lei de Little, lei da utilização, o joelho, USL, profiling | esta visão geral · [Encontrando gargalos](bottlenecks/index.md) | `monolith` (perfil breakpoint), `scale-out` |
| [`sql`](../../reference/components/storage/index.md#sql) | Qual *consulta ou lock* limita o caminho? | `pg_stat_statements`, `EXPLAIN ANALYZE`, linhas quentes, `SKIP LOCKED`, dimensionamento do pool de conexões | [Encontrando gargalos](bottlenecks/index.md) | `flash-sale` |
| [`cache`](../../reference/components/storage/index.md#cache) | O teste está medindo um *cache quente* que a produção não terá? | aquecimento, teste com cache frio, taxa de acerto, stampede | [Metodologia](methodology/index.md#warm-up) | `read-heavy-cache` |
| [`metrics`](../../reference/components/observability/index.md#metrics) · [`tracing`](../../reference/components/observability/index.md#tracing) | Qual recurso *satura primeiro*? | USE, RED e sinais de ouro, flame graphs, profiling contínuo | [Metodologia](methodology/index.md) · [Encontrando gargalos](bottlenecks/index.md) | `observability-stack` |
| [`queue`](../../reference/components/messaging/index.md#queue) · [`serverless`](../../reference/components/compute/index.md#serverless) | Quantas réplicas, e *quanto admitimos*? | folga, atraso do autoscaling, cold starts, pré-escalonamento, taxa de admissão da sala de espera | [Planejamento de capacidade](capacity-planning/index.md) | `flash-sale`, `serverless-burst` |
| [`thirdparty`](../../reference/components/external/index.md#thirdparty) | O que acontece quando uma dependência *fica lenta sob carga*? | carga e caos juntos, Toxiproxy, timeouts, circuit breakers | [Testes de carga](load-testing/index.md) | `cascading-failure` |
| *(o pipeline)* | A *próxima mudança* vai regredir? | orçamentos de desempenho na CI, thresholds como SLOs | [Planejamento de capacidade](capacity-planning/index.md#performance-budgets) | — |

---

## Relacionados

- Hands-on: [2. Medir primeiro](../../hands-on/2/index.md) (k6 smoke/load/stress no `catalog`, encontrar o joelho, verificação da Lei de Little), [9. Resiliência e caos](../../hands-on/9/index.md) (Toxiproxy sob carga) e [11. Entrega](../../hands-on/11/index.md) (gate de orçamento de desempenho com k6 na CI).
- Exercício: [Relatório de teste de carga](../../exercises/load-test-report/index.md); projeto: [Campanha de testes de carga](../../exercises/project/load-test-campaign/index.md) e [Game day](../../exercises/project/game-day/index.md).
- Aulas: [Estimativas — filas](../estimation/queueing/index.md) e [percentis](../estimation/percentiles/index.md), [Observabilidade](../observability/index.md), [Confiabilidade — engenharia do caos](../reliability/chaos/index.md).
- Estudo de caso: [Ticketing (venda relâmpago do BoxOffice)](../case-studies/ticketing/index.md); ferramentas: [Referência — ferramentas](../../reference/tools/index.md).

## Pontos-chave

- Tempo de resposta = tempo de serviço + **espera**; perto da saturação, a espera domina. $N = X \times R$ e $U = X \times S$ conectam os números.
- Todo sistema tem um **joelho**: planeje com a vazão em que o SLO de latência ainda vale, não com o máximo.
- Depois do pico, mais concorrência pode significar **menos** vazão (USL) — controle de admissão é melhor que sobrecarga.
- Engenharia de desempenho é um **ciclo**: objetivos → modelo de carga → teste → análise → mudar uma coisa → testar de novo → orçamento na CI.

---

[^1]: LITTLE, J. D. C. A Proof for the Queuing Formula: L = λW. *Operations Research*, v. 9, n. 3, p. 383–387, 1961.
[^2]: GUNTHER, N. J. *Guerrilla Capacity Planning*. Springer, 2007.
[^3]: GREGG, B. *Systems Performance: Enterprise and the Cloud*. 2nd ed. Addison-Wesley, 2020.
[^4]: Grafana Labs. [k6 documentation — Test types](https://grafana.com/docs/k6/latest/testing-guides/test-types/){target="_blank"}.
