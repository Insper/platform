
O banco de inventário da BoxOffice está a 70% de CPU durante uma abertura de vendas normal, e as reservas levam cerca de 75 ms no p99. A equipe conclui que tem "30% de sobra". Na abertura de vendas seguinte, maior, a CPU chega a 92% — só 22 pontos a mais — e o p99 salta para quase 300 ms, quatro vezes pior e bem na meta de 300 ms da reserva. Timeouts disparam, os clientes tentam de novo e a carga extra leva o banco a 100%. Nada estava "quebrado"; a equipe simplesmente não conhecia a forma da curva que relaciona **carga** e **latência**. Esta página deduz essa curva de algumas leis simples e depois usa as mesmas leis para responder às perguntas que toda decisão de capacidade faz: *quantas requisições estão em andamento? que tamanho este pool precisa ter? quão cheio este componente pode rodar? acrescentar nós vai ajudar?*

---

## O vocabulário de uma fila { #the-vocabulary-of-a-queue }

Todo componente que atende requisições — um núcleo de CPU, um pool de threads, uma conexão de banco, uma API de pagamentos — pode ser visto como uma **fila** diante de um ou mais **servidores** (em teoria de filas, "servidor" é qualquer coisa que atende uma requisição):

``` diagram-sim
flowchart LR
    arrivals(["Chegadas<br/>λ requisições/s"]) --> queue["Fila<br/>(espera: Wq)"]
    queue --> s1["Servidor 1<br/>(serviço: S)"]
    queue --> s2["Servidor 2"]
    queue --> s3["Servidor c"]
    s1 --> out(["Conclusões<br/>X requisições/s"])
    s2 --> out
    s3 --> out
```

| Símbolo | Nome | Significado | Exemplo da BoxOffice |
|---|---|---|---|
| **λ** | taxa de chegada | requisições que chegam por segundo | 1.000 reservas/s |
| **S** | tempo de serviço | tempo que um servidor gasta com uma requisição (sem espera) | 5 ms de trabalho do banco por reserva |
| **μ** | taxa de serviço | requisições que um servidor conclui por segundo: μ = 1/S | 200 reservas/s por conexão |
| **c** | servidores | servidores paralelos (núcleos, threads, conexões) | 8 conexões produtivas |
| **ρ** | utilização | fração do tempo em que os servidores estão ocupados: ρ = λ / (c·μ) = λ·S / c | 1.000 × 0,005 / 8 = 62,5% |
| **Wq** | tempo de espera | tempo na fila antes de o serviço começar | — |
| **R** (ou W) | tempo de resposta | espera + serviço: R = Wq + S | o que o cliente mede |
| **L** | número no sistema | requisições esperando ou em serviço ("em andamento", concorrência) | — |
| **X** | throughput | conclusões por segundo (= λ em regime estacionário, se nada for descartado) | — |

---

## A Lei de Little { #littles-law }

A fórmula mais útil do planejamento de capacidade é também a mais simples[^1]:

$$
L = \lambda \times W
$$

**O número médio de requisições num sistema é igual à taxa média de chegada vezes o tempo médio que cada requisição passa no sistema.** Ela vale para qualquer sistema estável (as chegadas não excedem a capacidade no longo prazo), independentemente da distribuição das chegadas ou dos tempos de serviço, do número de servidores ou da ordem de atendimento. Você pode aplicá-la a um pool de threads, a um serviço inteiro, a uma fila, a um banco — ou a uma cafeteria: se chegam 2 clientes por minuto e cada um fica 15 minutos, há em média 30 clientes lá dentro.

Suas três formas respondem a três perguntas diferentes:

| Forma | Pergunta | Exemplo da BoxOffice |
|---|---|---|
| L = λ × W | Quantas requisições estão em andamento? Que tamanho o pool precisa ter? | 1.000 reservas/s × 20 ms dentro do serviço = **20 reservas em andamento** → no mínimo 20 threads de trabalho |
| W = L / λ | Quanto tempo cada requisição (ou pessoa) espera? | 2 M de fãs na sala de espera, admitidos a 1.000/s → o último espera 2 M / 1.000 = **2.000 s ≈ 33 min** |
| λ = L / W | Que throughput esta concorrência sustenta? | 8 conexões, cada reserva ocupa uma por 5 ms → no máximo 8 / 0,005 = **1.600 reservas/s** |

!!! example "BoxOffice — dimensionando o serviço de inventário"

    O serviço de inventário recebe **λ = 1.000 reservas/s**. Cada reserva passa **W = 40 ms** dentro do serviço (validação, a chamada ao banco, serialização da resposta), dos quais **10 ms** ocupam uma conexão de banco (a transação mais as idas e voltas).

    - Requisições em andamento no serviço: 1.000 × 0,040 = **40** → com uma thread por requisição, o serviço precisa de pelo menos 40 threads de trabalho; com 4 réplicas, ~10 em cada, mais folga.
    - Conexões em uso: 1.000 × 0,010 = **10** → um pool de ~15 conexões somando todas as réplicas basta. Um pool de 200 não deixaria nada mais rápido — só permitiria que mais transações disputassem as mesmas linhas.

    Agora o provedor de pagamentos fica lento, de 300 ms para 3 s, e o serviço de pedidos o chama de forma síncrona a 100 pedidos/s: as chamadas de pagamento em andamento vão de 100 × 0,3 = **30** para 100 × 3 = **300**. Se o serviço de pedidos tem 200 threads, ele se esgota — e todas as outras rotas do serviço de pedidos falham junto. Essa é a aritmética de uma **falha em cascata** ([aula 10](../../reliability/index.md)), e é por isso que timeouts e bulkheads existem.

### A Lei de Little como detector de mentiras para testes de carga { #littles-law-as-a-lie-detector-for-load-tests }

Uma ferramenta de teste de carga com um número fixo de usuários virtuais (VUs), em que cada um envia uma requisição, espera a resposta, "pensa" por Z segundos e repete, é um **sistema fechado**. A Lei de Little aplicada a ela diz:

$$
N_{users} = X \times (R + Z)
$$

Com 100 VUs, sem tempo de pensar (Z = 0) e R = 50 ms, o teste **não consegue** produzir mais que 100 / 0,05 = 2.000 req/s, seja lá o que o servidor aguentasse. Se o servidor ficar lento, R = 500 ms, o teste gera só 200 req/s — a carga *cai* exatamente quando o sistema sofre, escondendo o problema. Confira todo resultado de teste de carga com essa fórmula; o laboratório 2 faz isso, e a [aula 15](../../performance/index.md) discute modelos de carga aberto e fechado.

---

## A lei da utilização { #the-utilization-law }

Uma segunda lei, igualmente simples, liga throughput e utilização:

$$
U = X \times S
$$

**A utilização de um recurso é igual ao seu throughput vezes o tempo de serviço por requisição.** Um banco que atende 1.000 reservas/s a 5 ms de CPU cada precisa de 5 segundos de CPU por segundo: **5 núcleos a 100%**, ou 62,5% de 8 núcleos. Invertida, ela dá a **capacidade** de um recurso: a utilização não pode passar de 100% por servidor, então

$$
X_{max} = \frac{c}{S}
$$

Essa é a regra "vagas paralelas divididas pelo tempo de serviço" usada na [visão geral](../index.md). O recurso com a maior utilização (a maior razão entre demanda e capacidade) é o **gargalo**: ele satura primeiro e limita o throughput do sistema inteiro.

---

## Por que a latência explode antes de 100%: o joelho { #why-latency-explodes-before-100-the-knee }

Se as requisições chegassem em intervalos perfeitamente regulares e cada uma levasse exatamente S, um servidor poderia rodar a 99% de utilização sem nenhuma espera. O tráfego real é **aleatório**: as requisições chegam em rajadas, e algumas demoram mais que outras. Durante uma rajada, as requisições fazem fila; a fila esvazia nos momentos tranquilos. Quanto mais ocupado o servidor, menos momentos tranquilos ele tem para se recuperar — e mais as filas crescem.

O modelo mais simples disso é a fila **M/M/1**: chegadas aleatórias (Poisson), tempos de serviço aleatórios (exponenciais), um servidor. Seu tempo médio de resposta é[^2]:

$$
R = \frac{S}{1 - \rho}
$$

| Utilização ρ | Tempo médio de resposta R | Tempo de resposta p99 (≈ 4,6 R) | Com S = 5 ms |
|---|---|---|---|
| 10% | 1,1 S | 5 S | R ≈ 6 ms |
| 50% | 2 S | 9 S | R = 10 ms |
| 70% | 3,3 S | 15 S | R ≈ 17 ms |
| 80% | 5 S | 23 S | R = 25 ms |
| 90% | 10 S | 46 S | R = 50 ms, p99 ≈ 230 ms |
| 95% | 20 S | 92 S | R = 100 ms, p99 ≈ 460 ms |
| 99% | 100 S | 460 S | R = 500 ms, p99 ≈ 2,3 s |

(Na M/M/1 o tempo de resposta tem distribuição exponencial, então seu p99 é ln(100) ≈ 4,6 vezes a média.) Ir de 50% para 90% de utilização — menos que o dobro da carga — deixa o tempo de resposta **5× pior**; de 90% para 99% — 10% a mais de carga — mais **10× pior**. É exatamente a história do inventário da BoxOffice no início desta página.

O gráfico mostra R / S em função da utilização para um servidor (M/M/1, média e p99), e para 4 e 16 servidores compartilhando **uma única fila** (M/M/c, calculado com a fórmula Erlang C):

```python exec="1" html="1"
import math
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})


def erlang_c(c, rho):
    """Probability that an arrival waits in an M/M/c queue."""
    a = c * rho
    top = a**c / math.factorial(c) / (1 - rho)
    return top / (sum(a**k / math.factorial(k) for k in range(c)) + top)


rho = np.linspace(0.01, 0.97, 300)
fig, ax = plt.subplots(figsize=(8, 4.2))
ax.plot(rho, 1 / (1 - rho), color="#ef4444", lw=2.5, label="M/M/1 mean")
ax.plot(rho, np.log(100) / (1 - rho), color="#ef4444", lw=1.5, ls="--", label="M/M/1 p99")
for c, color in [(4, "#3b82f6"), (16, "#10b981")]:
    r = [1 + erlang_c(c, x) / (c * (1 - x)) for x in rho]
    ax.plot(rho, r, color=color, lw=2.5, label=f"M/M/{c} mean")
ax.axvspan(0.7, 0.85, color="#f59e0b", alpha=0.15)
ax.text(0.775, 0.4, "knee", ha="center", color="#f59e0b", fontweight="bold")
ax.set_xlim(0, 1)
ax.set_ylim(0, 20)
ax.set_xlabel("ρ = λ / (c·μ)")
ax.set_ylabel("R / S")
ax.grid(alpha=0.2)
ax.legend(frameon=False, loc="upper left")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Três lições das curvas:

1. **O joelho (*knee*).** A latência é quase plana em baixa utilização e depois se curva bruscamente. Para um único servidor, a curva fica em torno de 70–80%; depois dela, pequenos aumentos de carga causam enormes aumentos de latência, e a **cauda (p99) explode primeiro**.
2. **Compartilhar a fila ajuda.** Com 16 servidores compartilhando uma fila, o joelho se desloca bem para a direita: uma requisição só espera se *todos* os servidores estiverem ocupados. Esse é um dos motivos pelos quais um grande pool atrás de um load balancer se comporta melhor que muitas filas pequenas e separadas (por exemplo, roteamento fixo de usuários para servidores específicos).
3. **A variabilidade é a inimiga.** O modelo M/M/1 supõe chegadas e tempos de serviço muito aleatórios. Tráfego mais regular forma menos fila; tráfego em rajadas (uma abertura de vendas!) forma mais. A aproximação de Kingman para um único servidor deixa isso explícito[^3]:

$$
W_q \approx \frac{\rho}{1 - \rho} \times \frac{C_a^2 + C_s^2}{2} \times S
$$

em que $C_a$ e $C_s$ são os coeficientes de variação (desvio padrão / média) dos intervalos entre chegadas e dos tempos de serviço. O primeiro fator é o efeito da utilização; o segundo, o efeito da **variabilidade**. Uma sala de espera que admite fãs a uma taxa constante reduz $C_a$; cortar os casos lentos (uma consulta pesada que leva 50× o tempo normal) reduz $C_s$. Os dois reduzem as filas sem acrescentar um único servidor.

### Com que utilização você deve rodar? { #what-utilization-should-you-run-at }

| Componente | Meta sustentada típica | Por quê |
|---|---|---|
| Serviço sensível à latência (API, primário do banco) | **~50–70%** no pico | ficar à esquerda do joelho; absorver rajadas e a perda de uma réplica |
| Workers em lote / assíncronos | 80–90%+ | a latência de cada job importa pouco; throughput e custo importam |
| Links de rede | < 70–80% | filas nos roteadores acrescentam latência e descartam pacotes perto da saturação |

A redundância empurra na mesma direção: com **4 réplicas a 60%**, perder uma leva as outras três a 80% — ainda atendendo. Com 4 réplicas a 80%, perder uma exige 107%: as réplicas restantes colapsam. **A folga é o que faz o failover funcionar.**

!!! example "BoxOffice — lendo o joelho no playground"

    Na [visão geral](../index.md), o cenário `monolith` com o perfil `breakpoint` aumenta a carga até quebrar. Suponha que o banco tenha 8 vagas e S = 5 ms: capacidade = 8 / 0,005 = 1.600 req/s. O joelho (p99 subindo bruscamente) deve aparecer em torno de 70–85% disso, ~1.100–1.350 req/s, e os erros só perto de 1.600 req/s. Se você vir o joelho muito antes, o gargalo está em outro lugar (no pool de threads do servidor de aplicação, talvez) — encontre o componente com a maior utilização.

<div class="sdp" data-scenario="monolith" data-mode="compact" data-profile="breakpoint" data-seed="7" data-height="500"></div>

**Experimente:** rode o perfil breakpoint, depois dobre a capacidade do banco (ou acrescente réplicas da aplicação) e rode de novo. O joelho se move? Quanto? Se acrescentar réplicas da aplicação não o move, qual componente é o gargalo?

!!! example "No código do BoxOffice: o joelho do `catalog`, medido (lab 2)"

    O [Hands-on 2](../../../hands-on/2/index.md) desenha esta curva para o serviço real. A varredura roda o teste de carga de modelo aberto uma vez por taxa de chegada, um minuto cada, depois de um aquecimento (uma JVM fria estragaria o primeiro ponto) e com uma pausa entre os passos para as filas esvaziarem. Na execução de exemplo do laboratório (1 CPU, um pool de 10 conexões), o p99 foi 39 ms em 300 req/s, 224 ms em 400 e 2.056 ms em 500 req/s, onde o k6 ainda teve de descartar 410 iterações: plano, depois um muro. A Lei de Little dá nome à fila: em 600 req/s o laboratório viu as 200 threads do Tomcat ocupadas, 10 conexões com o banco ativas e **190 requisições esperando por uma conexão** — o pool de 10 são os *c* servidores desta página, e o joelho é onde ele satura. O passo 6 do laboratório aumenta o pool para 30 e observa o gargalo se mover.

    ``` { .bash title="scripts/sweep.sh" }
    --8<-- "docs/2027.1/hands-on/2/code/scripts/sweep.sh"
    ```

---

## Quando mais servidores deixam de ajudar { #when-more-servers-stop-helping }

A Lei de Little e a lei da utilização sugerem que a capacidade cresce linearmente com o número de servidores: X_max = c / S. Na prática não cresce, porque os servidores **se coordenam**. Dois modelos clássicos descrevem como a escala se curva.

### A lei de Amdahl { #amdahls-law }

Se uma fração **σ** do trabalho é inerentemente **serial** (não pode ser paralelizada — um lock global, um único primário, uma etapa sequencial), então com N workers paralelos o ganho de velocidade (*speedup*) é limitado[^4]:

$$
\text{Speedup}(N) = \frac{N}{1 + \sigma (N - 1)} \;\le\; \frac{1}{\sigma}
$$

Com 5% de trabalho serial, nenhum número de nós dá mais que 20× de ganho; com 1%, 100×. Na BoxOffice: se toda reserva precisa passar pelo mesmo lock na mesma linha de "contador do setor" durante apenas 5% do seu tempo, acrescentar réplicas do inventário deixa de compensar muito antes de 20 réplicas.

### A Universal Scalability Law { #the-universal-scalability-law }

A **Universal Scalability Law** (USL) de Neil Gunther acrescenta um segundo termo, **κ** (*coerência*), para o custo de manter os nós consistentes entre si — mensagens de invalidação de cache, locks distribuídos, conversa de pertencimento ao cluster, replicação —, que cresce com o número de **pares** de nós, aproximadamente N²[^5]:

$$
C(N) = \frac{N}{1 + \sigma (N - 1) + \kappa N (N - 1)}
$$

Com κ > 0, o throughput não apenas se achata — ele atinge um **pico** em $N^* = \sqrt{(1 - \sigma)/\kappa}$ e depois **diminui**: acrescentar nós deixa o sistema mais lento.

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})

n = np.arange(1, 65)
sigma, kappa = 0.05, 0.001          # contention and coherency (illustrative values)
amdahl = n / (1 + sigma * (n - 1))
usl = n / (1 + sigma * (n - 1) + kappa * n * (n - 1))
peak = int(round(np.sqrt((1 - sigma) / kappa)))

fig, ax = plt.subplots(figsize=(8, 4.2))
ax.plot(n, n, color="#888", lw=1.5, ls=":", label="linear: N")
ax.plot(n, amdahl, color="#3b82f6", lw=2.5, label="Amdahl (σ = 0.05)")
ax.plot(n, usl, color="#ef4444", lw=2.5, label="USL (σ = 0.05, κ = 0.001)")
ax.axvline(peak, color="#f59e0b", ls="--", lw=1.2)
ax.annotate(f"N* ≈ {peak}", xy=(peak, usl[peak - 1]), xytext=(peak + 4, usl[peak - 1] + 6),
            color="#f59e0b", arrowprops=dict(arrowstyle="->", color="#f59e0b"))
ax.set_xlim(1, 64)
ax.set_ylim(0, 25)
ax.set_xlabel("N (nodes, threads, replicas)")
ax.set_ylabel("C(N) = X(N) / X(1)")
ax.grid(alpha=0.2)
ax.legend(frameon=False, loc="upper left")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

| Modelo | Parâmetros | Forma | Causas no mundo real |
|---|---|---|---|
| Linear | — | dobra com N | trabalho shared-nothing, perfeitamente particionado (raro) |
| Amdahl | σ (contenção) | achata em 1/σ | um único primário, um lock global, uma etapa sequencial |
| USL | σ, κ (coerência) | atinge pico em N*, depois cai | contenção de locks entre nós, tráfego de coerência de cache, conversa de todos com todos |

O uso prático da USL é **ajustar** σ e κ a algumas medições de teste de carga (throughput com N = 1, 2, 4, 8…) e prever onde a escala para *antes* de comprar o hardware ([aula 15](../../performance/index.md)). A lição de design é mais ampla: **designs shared-nothing escalam**. Particione o trabalho para que os nós não precisem conversar entre si — a BoxOffice particiona o inventário por evento, de modo que reservas de eventos diferentes nunca disputam recursos — e tanto σ quanto κ diminuem.

??? question "Pense antes: um segundo banco de inventário vai ajudar?"

    A abertura de vendas de um show de estádio está limitada pela contenção de locks de linha nos lugares daquele evento no banco de inventário. A equipe propõe acrescentar um segundo nó de banco com replicação multi-primário. Use Amdahl e a USL para argumentar.

    **Resposta**: o gargalo é a **contenção nas mesmas linhas** (σ), não a CPU. Um segundo primário não divide essa contenção — os dois nós ainda precisam concordar sobre os mesmos lugares, o que **acrescenta custo de coerência** (κ: detecção de conflitos entre nós ou locks distribuídos). O throughput daquele evento provavelmente *cairia*. O que ajuda é reduzir σ: transações mais curtas, reservar lugares com um único `UPDATE` condicional, admitir fãs a uma taxa constante (sala de espera) ou dividir o *evento* em setores alocados de forma independente. Um segundo nó ajuda, sim, com eventos **diferentes** (particionamento por evento), onde não há estado compartilhado.

!!! tip "Na entrevista"

    Use a Lei de Little sempre que dimensionar um pool, uma fila ou uma frota: "1.000 req/s × 40 ms = 40 requisições concorrentes, então 4 instâncias com 16 threads cada deixam folga". Ao propor capacidade, diga a **utilização-alvo** e o porquê: "eu dimensionaria para 60% no pico, para ficarmos à esquerda do joelho e sobrevivermos à perda de um nó." Se perguntarem "e se acrescentarmos mais servidores?", mencione o gargalo e Amdahl: "os servidores de aplicação escalam linearmente até o primário único saturar; depois disso, precisamos de cache, particionamento ou fila."

!!! success "Boas práticas"

    - **Dimensione todo pool com a Lei de Little e deixe a fórmula num comentário** — threads = λ × W, conexões = λ × tempo segurando uma; um pool dimensionado "por segurança" só move a fila para dentro do banco.
    - **Observe a fila na frente do gargalo, não só a sua utilização** — conexões pendentes e threads ocupadas sobem antes de o gráfico de CPU parecer alarmante. Na BoxOffice: `hikaricp.connections.pending` no `scripts/watch-metrics.sh` do lab 2 ([Hands-on 2](../../../hands-on/2/index.md)).
    - **Varra a taxa de chegada com modelo aberto, aquecimento e uma pausa entre os passos** — um ponto não é uma curva, uma JVM fria não é o seu serviço, e filas que sobraram estragam o passo seguinte. Na BoxOffice: `scripts/sweep.sh` (quadro acima).
    - **Ponha as metas de autoscaling bem à esquerda do joelho** — escalar leva minutos, e o pico chega nesse meio-tempo. Na BoxOffice: o HPA do lab 10 mira 60% de CPU.
    - **Reduza a variabilidade antes de acrescentar servidores** — admita num ritmo constante e elimine os lentos fora da curva; a fórmula de Kingman mostra que os dois encolhem a fila de graça. Na BoxOffice: a sala de espera (lab 7) e os índices do lab 6.

!!! warning "Armadilhas comuns"

    - **Planejar 90–100% de utilização** para componentes sensíveis à latência: o p99 desaba muito antes de o gráfico de CPU parecer alarmante.
    - **Pools superdimensionados**: um pool de 500 conexões de banco não acrescenta capacidade; ele leva a fila para dentro do banco, onde a contenção deixa tudo mais lento.
    - **Ignorar a Lei de Little nos testes de carga**: ferramentas de laço fechado com poucos VUs não conseguem gerar a carga pretendida contra um sistema lento.
    - **Supor escala linear**: seções seriais e custos de coordenação curvam a curva; meça com vários N.
    - **Filas sem limite**: uma fila que cresce sem limite transforma sobrecarga em latência sempre crescente; limite-a e descarte carga cedo ([aula 10](../../reliability/index.md)).

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    LL["Lei de Little<br/>L = λ × W"] --> POOL["pools de threads e conexões<br/>→ Compute, Bancos de dados"]
    LL --> WR["espera na sala de espera<br/>W = L / λ → Mensageria"]
    LL --> LT["detector de mentiras do teste de carga<br/>→ Performance"]
    UL["lei da utilização<br/>U = X × S"] --> CAP["capacidade ≈ c / S"]
    CAP --> KNEE["o joelho<br/>R = S / (1 − ρ)"]
    KNEE --> TARGET["operar a 50–70%<br/>metas de autoscaling → Compute"]
    KNEE --> SHED["descarte de carga, backpressure<br/>→ Confiabilidade"]
    AMD["Amdahl σ<br/>linhas quentes, locks globais"] --> PART["particionamento shared-nothing<br/>→ Bancos de dados"]
    USL["USL κ<br/>custo de coerência"] --> PART
```

**Componentes da paleta:** [`app`](../../../reference/components/compute/index.md#app) (threads de trabalho = λ × W por réplica) · [`sql`](../../../reference/components/storage/index.md#sql) (o pool de conexões, o primário que está "só" a 70%, contenção por locks de linha) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sala de espera: quanto o último fã espera) · [`worker`](../../../reference/components/compute/index.md#worker) (workers de lote podem operar a 80–90%) · [`payment`](../../../reference/components/external/index.md#payment) (um provedor lento multiplica as chamadas em andamento) · [`nosql`](../../../reference/components/storage/index.md#nosql) (partições shared-nothing escalam onde a USL diz que um primário compartilhado não escala). **Cenários:** `monolith` (com o perfil `breakpoint`), `flash-sale`, `async-queue`. **Continua em:** [Percentis](../percentiles/index.md), [Compute — atraso do autoscaling](../../compute/serverless-autoscaling/index.md#autoscaling-lag), [Confiabilidade — descarte de carga](../../reliability/patterns/index.md#load-shedding), [Bancos de dados — contenção](../../databases/transactions/index.md#contention), [Performance — planejamento de capacidade](../../performance/capacity-planning/index.md), [Hands-on 2](../../../hands-on/2/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - A **Lei de Little** L = λ × W dá a concorrência, o tempo de espera ou o throughput a partir dos outros dois — para pools, serviços, filas e testes de carga.
    - **Lei da utilização** U = X × S; capacidade ≈ c / S; o recurso mais carregado é o gargalo.
    - O tempo de resposta cresce como **S / (1 − ρ)**: plano em carga baixa, explosivo depois do **joelho** (≈ 70–80% para um servidor); a cauda explode primeiro.
    - Rode componentes sensíveis à latência a **~50–70%** no pico; compartilhar a fila e reduzir a variabilidade empurram o joelho para a direita.
    - **Amdahl** (fração serial σ) limita o ganho a 1/σ; a **USL** (coerência κ) faz o throughput *cair* depois de N*; particionamento shared-nothing é como se escala.

---

[^1]: LITTLE, J. D. C. A Proof for the Queuing Formula: L = λW. *Operations Research*, 9(3), 1961, pp. 383–387.
[^2]: HARCHOL-BALTER, M. *Performance Modeling and Design of Computer Systems: Queueing Theory in Action*. Cambridge University Press, 2013.
[^3]: KINGMAN, J. F. C. The single server queue in heavy traffic. *Mathematical Proceedings of the Cambridge Philosophical Society*, 57(4), 1961, pp. 902–904.
[^4]: AMDAHL, G. M. Validity of the single processor approach to achieving large scale computing capabilities. *AFIPS Spring Joint Computer Conference*, 1967.
[^5]: GUNTHER, N. J. *Guerrilla Capacity Planning*. Springer, 2007.
