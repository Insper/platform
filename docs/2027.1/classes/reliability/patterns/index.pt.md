Quando uma dependência degrada, o comportamento ingênuo — continuar enviando requisições e esperar a resposta — produz com certeza a cascata da [visão geral](../index.md#cascading-failures): as threads de quem chama bloqueiam, sua fila enche e a falha sobe até usuários que não tinham nada a ver com a dependência quebrada. **Padrões de resiliência** são decisões de projeto que interrompem essa propagação. Eles não evitam falhas; eles **limitam até onde uma falha vai**[^1].

Ao longo desta página seguimos uma chamada do BoxOffice: **o `order` chama o `payment`**, o adaptador na frente do provedor externo de pagamento, para cobrar o cartão de um fã durante a saga de compra (veja [Mensageria — padrões](../../messaging/patterns/index.md#sagas)). É a chamada mais perigosa do sistema: está no caminho da receita, atravessa a internet até um terceiro, e o dia ruim do terceiro vira o nosso.

| Padrão | Pergunta que responde | Protege contra |
|---|---|---|
| [Timeout](#timeout) | Quanto tempo estou disposto a esperar? | Chamadas penduradas segurando recursos |
| [Retry com backoff e jitter](#retry-with-backoff-and-jitter) | Vale tentar de novo — quando? | Falhas transitórias |
| [Circuit breaker](#circuit-breaker) | Devo sequer tentar? | Martelar uma dependência sabidamente fora do ar |
| [Fallback](#fallback-and-graceful-degradation) | O que respondo no lugar? | Perder uma página inteira por causa de uma funcionalidade |
| [Bulkhead](#bulkhead) | Quanto da minha capacidade uma dependência pode tomar? | Esgotamento se espalhando entre funcionalidades |
| [Load shedding](#load-shedding) | Que trabalho recuso quando estou sobrecarregado? | Colapso sob sobrecarga |
| [Rate limiting](#rate-limiting) | Quanto cada cliente recebe? | Clientes abusivos, bots, picos |
| [Health checks](#health-checks) | O tráfego deve chegar a esta instância? | Rotear para instâncias quebradas |

---

## Timeout { #timeout }

Um **timeout** é um prazo em uma chamada de saída: se a resposta não chegou a tempo, quem chama a abandona e trata o erro. Sem timeout, uma dependência pendurada segura uma thread (e uma conexão, e memória) indefinidamente; com ele, o estrago que uma chamada lenta pode fazer é limitado.

``` diagram-sim
sequenceDiagram
    participant O as order
    participant P as adaptador payment
    participant X as provedor de pagamento
    O->>+P: POST /charges (prazo de 2 s)
    P->>+X: cobra o cartão
    Note over X: o provedor está lento hoje
    Note over O: 2 s se passaram: desiste, libera a thread
    O-->>O: trata o erro (retry? fallback?)
    X-->>-P: (a resposta chega em 4 s)
    P-->>-O: (tarde demais: descartada)
```

Como escolher o valor:

- **A partir da distribuição de latência da dependência.** Coloque um pouco acima do p99,9 da operação normal: qualquer coisa mais lenta já é anormal. Para o provedor, com p99,9 ≈ 1,2 s, um timeout de 2 s.
- **Dois timeouts por chamada HTTP**: o **timeout de conexão** (abrir a conexão TCP/TLS — curto, algumas centenas de milissegundos) e o **timeout de leitura** (esperar a resposta).
- **Por dependência.** Uma consulta ao cache, uma query no banco e uma API de terceiros têm latências que diferem em ordens de grandeza. Um timeout global está sempre errado para a maioria delas.
- **Dentro do orçamento de quem chama.** Se a requisição do fã tem 6 s no gateway, tudo abaixo precisa caber nisso, inclusive os retries.

### Propagação de prazo { #deadline-propagation }

Os timeouts precisam encolher à medida que a requisição desce. Um prazo definido na borda e **propagado** com a requisição (o gRPC faz isso nativamente com deadlines; em HTTP, um cabeçalho com o orçamento restante) permite que cada serviço saiba quanto tempo resta e pare de trabalhar numa requisição cujo chamador já desistiu.

| Camada | Orçamento | Gasto em |
|---|---|---|
| Gateway | 6 s | tudo abaixo + o próprio trabalho |
| `order` (handler de compra) | 5 s | verificação da reserva (≤ 300 ms) + pagamento (≤ 4,5 s) |
| `order` → `payment` | 2 s por tentativa × 2 tentativas + backoff ≈ 4,3 s | a chamada ao provedor |
| `payment` → provedor | 1,8 s | deixa margem para o trabalho do próprio adaptador |

!!! warning "Timeouts são só o primeiro passo"
    Um timeout transforma uma espera infinita em um erro rápido. Você ainda precisa decidir o que fazer com o erro: repetir (se for transitório e seguro), parar de chamar por um tempo (circuit breaker) ou responder outra coisa (fallback). E um timeout numa chamada *não idempotente* deixa um resultado desconhecido — a cobrança pode ter sido feita —, e é por isso que as chamadas ao `payment` levam uma chave de idempotência (veja [Integrações](../../compute/integrations/index.md)).

!!! example "No código do BoxOffice: os timeouts de `order` → `payment` (lab 9)"

    O [Hands-on 9 — Padrões de resiliência](../../../hands-on/9/patterns/index.md) dá ao cliente do `payment` seus dois timeouts: 500 ms para conectar e 1 s para ler (`PAYMENT_READ_TIMEOUT`; `0` espera para sempre, o experimento "antes"). A chave de idempotência `order-<id>` é a mesma em toda tentativa, e é isso que torna seguro o retry da próxima seção. A aritmética do lab: 20 pagamentos/s contra um provedor 3 s lento seguram 20 × 3 = 60 threads, mais que o pool de 50; com o timeout de 1 s, 20 × 1 = 20.

    ``` { .java title="services/order/src/main/java/boxoffice/order/payment/PaymentClient.java (timeouts and idempotency key)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentClient.java:15:32"
    ```

---

## Retry com backoff e jitter { #retry-with-backoff-and-jitter }

Um **retry** repete uma chamada que falhou, apostando que a falha foi **transitória**: uma conexão derrubada, um pod reiniciando, uma eleição de líder. Retries tornam invisíveis muitas pequenas oscilações. Feitos sem cuidado, são também o jeito mais rápido de transformar um problema pequeno numa indisponibilidade.

### O que repetir { #what-to-retry }

| Falha | Repetir? | Por quê |
|---|---|---|
| Conexão recusada / resetada, timeout de conexão | Sim | Falha transitória típica; a requisição provavelmente nem rodou |
| Timeout de leitura | Só se a operação for idempotente (ou tiver chave de idempotência) | A requisição pode ter rodado |
| `503 Service Unavailable`, `429 Too Many Requests` | Sim, com backoff; respeite o `Retry-After` | O servidor está pedindo para você voltar depois |
| `500 Internal Server Error` | No máximo uma vez | Muitas vezes é um bug que falha de novo |
| `400`, `401`, `403`, `404`, `409`, `422`; "cartão recusado" | **Nunca** | A requisição em si está errada ou a resposta é definitiva |

### Backoff exponencial e jitter { #exponential-backoff-and-jitter }

Repetir imediatamente atinge de novo uma dependência em dificuldade antes que ela tenha qualquer chance de se recuperar. O **backoff exponencial** espera mais depois de cada falha:

$$
\text{wait}_n = \min\left(\text{base} \cdot 2^{n},\ \text{cap}\right)
$$

Com base de 200 ms: 200 ms, 400 ms, 800 ms, … até o teto. Mas se muitos clientes falharam no mesmo instante (o provedor oscilou para todos), todos repetem nos mesmos instantes também — ondas sincronizadas. O **jitter** torna as esperas aleatórias; a análise de Marc Brooker na AWS recomenda o **full jitter**[^2]:

$$
\text{wait}_n = \text{random}\left(0,\ \min\left(\text{base} \cdot 2^{n},\ \text{cap}\right)\right)
$$

### Retries amplificam a carga { #retries-amplify-load }

A simulação abaixo tem dois experimentos com números ilustrativos. À esquerda, um tráfego de compras estável (1.000 requisições/s) encontra um provedor de pagamento que degrada por 5 segundos; um servidor sobrecarregado desperdiça parte da capacidade em requisições que vão dar timeout de qualquer jeito. À direita, 1.000 clientes falham no mesmo instante (digamos, um reset de conexão durante um failover) e repetem contra um servidor que aguenta 150 requisições a cada 100 ms.

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})
DT = 0.1                                     # 100 ms ticks; all numbers are illustrative

# --- Experiment 1: steady traffic, the provider degrades for 5 s -----------------------
NEW, CAP = 100, 120                          # 1,000 new req/s; capacity 1,200 req/s

def goodput(load, cap):                      # overload wastes work on requests that time out
    return min(load, cap / (1 + 0.5 * max(0.0, load / cap - 1)))

def steady(policy, ticks=600, retries=3):
    pending = [[0.0] * (retries + 1) for _ in range(ticks + 100)]
    ok = []
    for k in range(ticks):
        pending[k][0] += NEW
        cap = 50 if 100 <= k < 150 else CAP          # 10 s-15 s: degraded
        load = sum(pending[k])
        served = goodput(load, cap)
        fail = 1 - served / load
        budget = 0.1 * NEW                            # retry budget: retries <= 10% of requests
        for a in range(retries):
            failed = pending[k][a] * fail
            if policy == "none":
                break
            if policy == "budget":
                failed, budget = min(failed, budget), budget - min(failed, budget)
            delay = int(2 ** a / DT)                  # backoff 1 s, 2 s, 4 s with full jitter
            for d in range(1, delay + 1):
                pending[k + d][a + 1] += failed / delay
        ok.append(served / DT)
    return ok

# --- Experiment 2: 1,000 clients fail at the same instant (e.g. a failover) -----------
def herd(jitter, ticks=160, clients=1000, cap=150, retries=5):
    pending = [[0.0] * retries for _ in range(ticks + 400)]

    def schedule(k, attempt, n):                 # retry #attempt waits 0.5 s, 1 s, 2 s, 4 s, 8 s
        delay = int(0.5 * 2 ** attempt / DT)
        if jitter:                               # full jitter: uniform in (0, delay]
            for d in range(1, delay + 1):
                pending[k + d][attempt] += n / delay
        else:
            pending[k + delay][attempt] += n

    schedule(0, 0, clients)                      # at t = 0 every client's call fails
    arrivals = []
    for k in range(ticks):
        load = sum(pending[k])
        fail = 1 - min(load, cap) / load if load else 0
        for a in range(retries - 1):
            schedule(k, a + 1, pending[k][a] * fail)
        arrivals.append(load)
    return arrivals

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
t1 = [k * DT for k in range(600)]
for policy, label, color in [("none", "no retries", "#888888"),
                             ("retries", "3 retries, backoff + jitter", "#e53935"),
                             ("budget", "same + retry budget (10%)", "#1976d2")]:
    ax1.plot(t1, steady(policy), color=color, lw=1.6, label=label)
ax1.axvspan(10, 15, color="#888", alpha=0.15)
ax1.set_title("Successful requests/s (shaded: provider slow)")
ax1.set_xlabel("seconds")
ax1.set_ylim(0, 1200)
ax1.legend(fontsize=8, loc="lower right")

t2 = [k * DT for k in range(160)]
ax2.bar(t2, herd(False), width=DT, color="#fb8c00", alpha=0.8, label="exponential backoff, no jitter")
ax2.plot(t2, herd(True), color="#1976d2", lw=1.8, label="backoff + full jitter")
ax2.axhline(150, color="#888", ls="--", lw=1)
ax2.text(11.5, 165, "capacity", fontsize=8)
ax2.set_title("Retries per 100 ms after 1,000 clients fail together")
ax2.set_xlabel("seconds")
ax2.legend(fontsize=8)
for ax in (ax1, ax2):
    ax.grid(True, alpha=0.3)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

- **Esquerda — retries podem manter um sistema caído.** Sem retries (cinza), os sucessos caem durante a degradação e voltam no instante em que ela termina. Com 3 retries por requisição (vermelho), cada falha vira até 4 chamadas; a carga extra mantém o provedor sobrecarregado *depois* que o gatilho passou, e o sistema se acomoda num estado degradado — uma **falha metaestável** (veja a [visão geral](../index.md#other-amplifiers)). Backoff e jitter não resolvem isso: eles espalham os retries no tempo, mas não reduzem a quantidade. Um **retry budget** (azul) — os retries podem acrescentar no máximo 10% ao tráfego normal — limita a amplificação e o sistema se recupera na hora.
- **Direita — jitter evita ondas sincronizadas.** Sem jitter (laranja), todos os clientes que falharam juntos repetem juntos: 1.000 chamadas em uma janela de 100 ms, só 150 têm sucesso, as outras 850 repetem juntas de novo… depois de 15 segundos, 250 clientes ainda não conseguiram. Com full jitter (azul), os mesmos retries se espalham abaixo da linha de capacidade e todos conseguem em cerca de 1,5 s.

Daí saem três regras:

1. **Faça retry em uma só camada.** Se o gateway, o `order` e o adaptador `payment` repetem 3 vezes cada, um clique do fã pode virar $3 \times 3 \times 3 = 27$ chamadas ao provedor. Faça retry perto da dependência que falha e deixe as camadas de cima falharem rápido.
2. **Limite as tentativas e o tempo total**: poucas tentativas (1–2 retries), todas dentro do prazo de quem chama.
3. **Use um retry budget** (Envoy, retry throttling do gRPC, Finagle): retries só são permitidos enquanto forem uma pequena fração das requisições. Quando a dependência está realmente fora, os retries param sozinhos.

!!! info "Experimente no playground"

    O cenário `retry-storm` tem clientes repetindo chamadas que falharam, sem backoff, contra um serviço que sofre uma indisponibilidade curta. Aperte **Run** e observe a taxa de requisições ao serviço pular para várias vezes a taxa dos clientes durante a indisponibilidade, e o serviço continuar sobrecarregado depois de quando deveria ter se recuperado. Depois troque a política de retry para **backoff exponencial com jitter**, adicione um **retry budget** e compare o tempo de recuperação.

<div class="sdp" data-scenario="retry-storm" data-mode="compact" data-height="520"></div>

!!! danger "Nunca repita uma chamada não idempotente sem chave de idempotência"
    Repetir `POST /charges` depois de um timeout de leitura pode cobrar o fã duas vezes: a primeira tentativa pode ter dado certo. O serviço `order` envia um `Idempotency-Key` (o id do pedido) em toda cobrança; o adaptador e o provedor devolvem o resultado guardado para uma chave que já viram. Veja [Mensageria — semântica de entrega](../../messaging/semantics/index.md) e [Integrações](../../compute/integrations/index.md).

---

## Circuit breaker { #circuit-breaker }

Um **circuit breaker** observa os resultados das chamadas a uma dependência. Quando a taxa de falhas passa de um limite, ele **abre** e rejeita as chamadas imediatamente, sem tocar na rede, por um tempo; depois deixa passar algumas chamadas de teste para verificar a recuperação[^3].

``` diagram-sim
stateDiagram-v2
    state "Fechado" as Closed
    state "Aberto" as Open
    state "Meio-aberto" as HalfOpen
    [*] --> Closed
    Closed --> Open : taxa de falhas ou de chamadas lentas ≥ 50% (últimas 20)
    Open --> HalfOpen : depois de 30 s
    HalfOpen --> Closed : 3 chamadas de teste com sucesso
    HalfOpen --> Open : uma chamada de teste falha
```

**Fechado** (normal)
: As chamadas passam; o breaker registra sucessos, falhas e chamadas lentas numa janela deslizante.

**Aberto** (falhando rápido)
: As chamadas falham na hora (`CallNotPermittedException` no Resilience4j). As threads de quem chama ficam livres, e a dependência ganha espaço para respirar em vez de uma tempestade de retries.

**Meio-aberto** (testando)
: Depois do tempo de espera, algumas chamadas são permitidas. Se derem certo, o breaker fecha; se não, abre de novo.

| Parâmetro | Valor no BoxOffice para o `payment` | Efeito |
|---|---|---|
| Janela deslizante | últimas 20 chamadas (por contagem) | Quanto histórico decide |
| Mínimo de chamadas | 10 | Evita abrir com 1 falha em 2 |
| Limite de taxa de falhas | 50% | Sensibilidade |
| Limite de chamada lenta | 1,5 s, taxa de chamadas lentas de 50% | Um provedor *lento* também abre o breaker — essencial contra gray failures |
| Espera no estado aberto | 30 s | Tempo que a dependência ganha para se recuperar |
| Chamadas no meio-aberto | 3 | Com quanto cuidado a recuperação é testada |

Importa quais erros contam: um **cartão recusado** é uma resposta correta de um provedor saudável, não uma falha. Configure-o como ignorado, ou uma onda de cartões recusados num ataque com cartões roubados abriria o breaker para todos os fãs honestos.

---

## Fallback e degradação graciosa { #fallback-and-graceful-degradation }

Falhar rápido é melhor que ficar pendurado, mas um erro ainda é um erro. Um **fallback** é o que quem chama faz *no lugar*. O objetivo é a **degradação graciosa**: perder uma funcionalidade, não a página.

| Dependência fora do ar | Fallback no BoxOffice |
|---|---|
| Recomendações ("fãs também compraram") | Esconder o widget, ou mostrar uma lista estática de "populares da semana" do cache |
| Busca | Servir os últimos resultados em cache; mostrar "os resultados podem estar alguns minutos desatualizados" |
| Serviço de renderização do mapa de lugares | Mostrar o seletor de melhores lugares disponíveis ("2 lugares, setor B") em vez do mapa interativo |
| `notification` | Nada a fazer de forma síncrona: o evento já está no Kafka e será entregue depois |
| `payment` | **Nada de sucesso falso.** Manter os lugares reservados, dizer ao fã "pagamento temporariamente indisponível — seus lugares estão reservados por 10 minutos, tente de novo" e deixar a saga repetir ou liberar |

!!! warning "Um fallback precisa ser seguro e simples"
    Um fallback que chama outro serviço remoto também pode falhar e precisa da própria proteção. Algumas operações — cobrar um cartão, confirmar um lugar — nunca podem ser fingidas: falhar com clareza *é* o comportamento gracioso. E teste seus fallbacks; um fallback exercitado pela primeira vez durante uma indisponibilidade costuma falhar.

---

## Bulkhead { #bulkhead }

Um **bulkhead** — nome dos compartimentos estanques do casco de um navio — dá a cada dependência o **próprio pool limitado** de threads, conexões ou chamadas concorrentes, para que uma dependência lenta não consuma a capacidade das outras.

``` diagram-sim
flowchart LR
    req["order: 200 threads de requisição"] --> bp["bulkhead do payment<br/>máx. 50 concorrentes"]
    req --> bi["bulkhead do inventory<br/>máx. 40 concorrentes"]
    req --> bc["bulkhead do catalog<br/>máx. 20 concorrentes"]
    bp --> pay["payment<br/>(lento: 4 s)"]
    bi --> inv["inventory<br/>(saudável)"]
    bc --> cat["catalog<br/>(saudável)"]
```

O dimensionamento vem de novo da Lei de Little. A 100 compras/s e 200 ms por cobrança, cerca de 20 chamadas estão em voo. Um bulkhead de **50** deixa espaço para a latência crescer 2,5× antes de as chamadas serem rejeitadas; quando o provedor vai para 4 s, no máximo 50 threads esperam por ele (em vez de 400), e as outras 150 continuam atendendo reservas, páginas de pedido e todo o resto. Chamadas rejeitadas falham em microssegundos e vão para o fallback.

O Resilience4j oferece um **bulkhead de semáforo** (limita chamadas concorrentes nas threads de quem chama; barato, o padrão) e um **bulkhead de pool de threads** (executa as chamadas num pool dedicado). A ideia é geral: pools de conexão separados por carga de trabalho num banco, consumer groups separados no Kafka, deployments separados para tráfego crítico e não crítico, filas separadas para confirmações e e-mails de marketing.

---

## Load shedding { #load-shedding }

Quando a demanda passa da capacidade, *algumas* requisições vão falhar. O **load shedding** (descarte de carga) decide **quais** e as faz falhar **cedo e barato**, para que o resto tenha sucesso. Sem ele, o servidor aceita tudo, toda requisição fica lenta, a maioria dá timeout depois de consumir recursos, e o goodput (trabalho útil) desaba — todos falham[^4].

- **Descarte na porta.** Rejeite com `503` + `Retry-After` antes de fazer qualquer trabalho: uma rejeição custa microssegundos, uma requisição que dá timeout custa o processamento inteiro.
- **Descarte por prioridade.** Durante a abertura do estádio, o BoxOffice classifica o tráfego: compras e reservas são críticas; navegação no catálogo é importante; recomendações, autocomplete e "eventos relacionados" são descartáveis. Sob sobrecarga, os descartáveis saem primeiro.
- **Descarte trabalho velho.** Uma requisição que já esperou mais que o prazo de quem chamou é inútil; tire-a da fila em vez de processá-la (filas limitadas com prazos, LIFO sob sobrecarga).
- **Adapte o limite.** Em vez de um limite fixo de concorrência, limitadores adaptativos (inspirados no controle de congestionamento do TCP, por exemplo a biblioteca concurrency-limits da Netflix) reduzem o número de requisições concorrentes quando a latência sobe e o aumentam quando a latência está saudável.

!!! example "BoxOffice: a sala de espera é load shedding"

    A [sala de espera da flash sale](../../messaging/queues-pubsub/index.md#the-flash-sale-waiting-room) é load shedding feito com gentileza: em vez de rejeitar fãs, ela os admite na taxa que o sistema consegue atender e informa aos outros a sua posição. Atrás dela, o gateway ainda descarta as rotas descartáveis quando a latência do `order` sobe, como segunda linha de defesa.

---

## Rate limiting { #rate-limiting }

O **rate limiting** limita quantas requisições um **cliente** (um IP, um usuário, uma chave de API, um parceiro) pode enviar numa janela de tempo. O load shedding protege o servidor da sobrecarga *total*; o rate limiting o protege de clientes *individuais* — bots atualizando o mapa de lugares centenas de vezes por segundo, a integração bugada de um parceiro, um scraper.

O algoritmo comum é o **token bucket**: os tokens se recarregam numa taxa constante (o limite sustentado), o tamanho do balde permite rajadas curtas, e cada requisição consome um token; balde vazio significa `429 Too Many Requests`. Limites por usuário ou chave de API ficam no API gateway, apoiados num armazenamento compartilhado como o Redis, onde a identidade autenticada é conhecida. Os algoritmos (token bucket, leaky bucket, janela deslizante) e sua implementação estão em [Borda — API gateway](../../edge/api-gateway/index.md); o cenário `rate-limiter` do playground mostra um gateway protegendo um backend.

---

## Health checks { #health-checks }

Health checks permitem que orquestradores e load balancers parem de enviar tráfego para instâncias quebradas — failover automático na menor escala.

**Liveness**
: *O processo está vivo e não travado?* Se falha, o Kubernetes **reinicia** o container.

**Readiness**
: *Esta instância pode atender tráfego agora?* Se falha, a instância é **removida do load balancer** sem ser reiniciada (aquecendo, sobrecarregada, perdeu a conexão com o próprio banco).

**Startup**
: *A aplicação terminou de iniciar?* Liveness e readiness só são verificados depois que ele passa, então uma JVM que demora para subir não é morta durante o boot.

```yaml
# order Deployment, container spec (Spring Boot Actuator endpoints)
startupProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 5
  failureThreshold: 30        # up to 150 s to start
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  periodSeconds: 5
  failureThreshold: 2
```

!!! danger "Nunca coloque dependências no liveness"
    Se o liveness do `order` verifica o provedor de pagamento e o provedor oscila, o Kubernetes **reinicia todas as réplicas do `order` de uma vez** — transformando um soluço de um terceiro numa indisponibilidade total do BoxOffice enquanto as JVMs sobem. O liveness responde só "este processo está travado?". Cuidado também com o readiness: se toda réplica depende do mesmo banco, todas ficam não prontas juntas e o serviço some em vez de devolver erros claros.

---

## Juntando tudo { #putting-it-together }

Os padrões trabalham em camadas. Para a chamada `order` → `payment`, o BoxOffice usa todos eles, configurados com Resilience4j[^5]. Os valores abaixo são o projeto para a venda do estádio (100 compras/s, 200 threads no `order`); o lab 9 roda a mesma pilha com números menores, para que um laptop mostre cada efeito (quadro abaixo).

=== "application.yaml"

    ```yaml
    resilience4j:
      bulkhead:
        instances:
          payment:
            max-concurrent-calls: 50          # Little's Law: 20 in flight normally
            max-wait-duration: 10ms           # do not queue: reject and fall back
      circuitbreaker:
        instances:
          payment:
            sliding-window-type: COUNT_BASED
            sliding-window-size: 20
            minimum-number-of-calls: 10
            failure-rate-threshold: 50
            slow-call-duration-threshold: 1500ms
            slow-call-rate-threshold: 50      # a slow provider also opens the breaker
            wait-duration-in-open-state: 30s
            permitted-number-of-calls-in-half-open-state: 3
            ignore-exceptions:
              - boxoffice.payment.CardDeclinedException   # a correct answer, not a failure
      retry:
        instances:
          payment:
            max-attempts: 2                   # 1 call + 1 retry, at this layer only
            wait-duration: 200ms
            enable-exponential-backoff: true
            exponential-backoff-multiplier: 2
            enable-randomized-wait: true      # jitter
            randomized-wait-factor: 0.5
            retry-exceptions:
              - org.springframework.web.client.ResourceAccessException   # I/O errors, timeouts
              - org.springframework.web.client.HttpServerErrorException$ServiceUnavailable
            ignore-exceptions:
              - boxoffice.payment.CardDeclinedException
    ```

=== "PaymentClient.java"

    ```java
    @Service
    @RequiredArgsConstructor
    public class PaymentClient {

        private final RestClient payment;

        @Bulkhead(name = "payment")
        @CircuitBreaker(name = "payment")
        @Retry(name = "payment", fallbackMethod = "unavailable")   // fallback on the outermost layer
        public PaymentResult charge(ChargeRequest req) {
            return payment.post().uri("/charges")
                .header("Idempotency-Key", req.orderId())   // a retry never charges twice
                .body(req)
                .retrieve()
                .body(PaymentResult.class);
        }

        // Called after the last retry fails, or when the breaker is open or the bulkhead is full.
        private PaymentResult unavailable(ChargeRequest req, Throwable t) {
            return PaymentResult.temporarilyUnavailable(req.orderId());  // seats stay held
        }
    }
    ```

=== "Timeouts (RestClient)"

    ```java
    @Bean
    RestClient paymentRestClient(RestClient.Builder builder) {
        HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(300))          // connect timeout
            .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofSeconds(2));       // read timeout per attempt
        return builder.baseUrl("http://payment:8080").requestFactory(factory).build();
    }
    ```

!!! example "No código do BoxOffice: a pilha de proteção no `order` (lab 9)"

    O [Hands-on 9 — Padrões de resiliência](../../../hands-on/9/patterns/index.md) configura a pilha com números de laptop: 50 threads do Tomcat em vez de 200, timeout de leitura de 1 s, 3 tentativas com 200 ms de backoff ± 50% de jitter, um breaker que também abre quando metade das últimas 20 chamadas levou mais de 800 ms e fica aberto 10 s, e um bulkhead de **10** chamadas simultâneas que nunca enfileira (`max-wait-duration: 0`). Cada parâmetro lê uma variável de ambiente, então cada experimento desliga um padrão sem rebuild. O `PaymentGateway` empilha as anotações na ordem padrão do Resilience4j — Retry ( CircuitBreaker ( Bulkhead ( call ) ) ) — com o fallback na camada externa, e o retry ignora `CallNotPermittedException` e `BulkheadFullException`: um breaker aberto ou um bulkhead cheio falha rápido em vez de ser repetido. O fallback responde `503` e o pedido fica `PENDING_PAYMENT`, o "tente de novo" honesto do [Fallback](#fallback-and-graceful-degradation). Com o provedor 3 s lento, o lab mediu o `GET /orders/{id}` — que nunca chama o `payment` — com mediana de **9,04 s** sem proteção e **6,5 ms** com os padrões.

    ``` { .yaml title="services/order/src/main/resources/application.yaml (resilience4j)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/resources/application.yaml:47:82"
    ```

    ``` { .java title="services/order/src/main/java/boxoffice/order/payment/PaymentGateway.java (the stack)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentGateway.java:24:29"
    ```

<div class="csim" data-sim="resilience" data-latency="4000" data-errors="0" data-timeout="off" data-retries="off" data-breaker="off"></div>

!!! tip "Experimente"
    São 10:02 e o provedor responde em 4 s em vez de 200 ms. As chaves usam os valores do lab 9 (timeout de leitura de 1 s; 3 tentativas com backoff de 200 ms × 2 ± 50%; um breaker sobre as últimas 20 chamadas que abre com 50% de falhas ou acima de 800 ms e espera 10 s), não o projeto do estádio acima. Ligue uma de cada vez, recomeçando a cada rodada:

    1. **Nada ligado**: 20 pagamentos/s × 4 s pedem 80 threads; as **50** ficam ocupadas em segundos e, em 30 s, cerca de 220 pagamentos não encontram thread nenhuma — nem o `GET /orders` encontraria.
    2. **Timeout**: só cerca de 20 threads ficam ocupadas, mas **0%** dos pagamentos dão certo. O timeout protege o `order`, não o pagamento.
    3. **+ retentativas**: o provedor passa a receber cerca de **2×** os pagamentos (44 chamadas/s) justamente quando está com dificuldade, e as 50 threads lotam de novo — 3 tentativas de 1 s mais o backoff prendem cada thread por cerca de 3,6 s.
    4. **+ circuit breaker**: ele abre 1,6 s depois do início; os pagamentos falham rápido, as threads caem para cerca de 1 e o provedor não recebe chamadas. Arraste a latência de volta para 200 ms: 10 s depois de abrir, o breaker fica semiaberto, 3 sondas dão certo e ele fecha. Pontos vermelhos na janela dele são falhas, laranja são chamadas lentas.

Como as camadas interagem — verifique antes de lançar:

- **Ordem dos decoradores.** O padrão do Resilience4j no Spring Boot é `Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) )`: o retry é o mais externo, então toda tentativa é contada pelo breaker e um breaker aberto faz o retry falhar na hora. Garanta que os retries nunca contornem o breaker. Ponha o **fallback na camada mais externa** (o retry): um fallback no breaker transforma toda falha numa resposta normal, então o retry nunca vê um erro e nunca repete.
- **Orçamento de tempo.** 2 tentativas × 2 s + um backoff de ~200–300 ms ≈ 4,3 s, dentro dos 5 s do `order` e dos 6 s do gateway.
- **Métricas.** O Resilience4j exporta pelo Micrometer o estado do breaker, a saturação do bulkhead e a contagem de retries; coloque-os em gráficos ao lado do dashboard de SLO ([Hands-on 8](../../../hands-on/8/index.md)), porque um breaker que abre é um incidente em andamento.
- **Prova.** Nada disso é confiável até você injetar a falha e ver funcionar — [engenharia do caos](../chaos/index.md) e [Hands-on 9](../../../hands-on/9/index.md).

!!! info "Experimente no playground"

    Abra o cenário `cascading-failure` no modo completo. Rode uma vez como está (sem proteção) e anote a taxa de erros das rotas saudáveis. Depois adicione, uma de cada vez, um **timeout**, um **circuit breaker** e um **bulkhead** na chamada ao terceiro, rodando depois de cada mudança. Qual deles protege mais as rotas saudáveis? Quanto cada um custa às requisições que precisam do terceiro?

<div class="sdp" data-scenario="cascading-failure" data-mode="full" data-height="620"></div>

| Camada | Trata | Configuração no BoxOffice |
|---|---|---|
| Rate limiting (gateway) | Clientes abusivos, bots | token bucket por conta |
| Load shedding (gateway) | Sobrecarga | descartar recomendações/autocomplete primeiro |
| Bulkhead | Uma dependência lenta comendo todas as threads | 50 chamadas concorrentes ao pagamento |
| Circuit breaker | Uma dependência sabidamente falhando ou lenta | 50% de falhas ou chamadas lentas em 20 chamadas, aberto por 30 s |
| Timeout | Espera sem limite | 300 ms de conexão, 2 s de leitura |
| Retry + backoff + jitter | Erros transitórios | 1 retry, 200 ms ± 50%, chave de idempotência |
| Fallback | O que o fã vê | "pagamento temporariamente indisponível, lugares reservados" |

!!! tip "Na entrevista"
    Quando um projeto tem uma chamada a um terceiro ou a uma dependência crítica, ofereça a pilha de proteção de uma vez: "timeout por volta do p99,9, um retry com backoff e jitter e uma chave de idempotência, um circuit breaker que também conta chamadas lentas, um bulkhead dimensionado com a Lei de Little e um fallback que diz a verdade ao usuário". Depois justifique um número (o bulkhead ou o timeout) com aritmética. Se perguntarem sobre sobrecarga, diferencie **rate limiting** (por cliente) de **load shedding** (o sistema todo, por prioridade), e mencione a amplificação de retries entre camadas.

!!! success "Boas práticas"

    - **Derive cada timeout do p99,9 medido da dependência e mantenha-o abaixo do orçamento que resta ao chamador** — o orçamento encolhe a cada salto (gateway 6 s > `order` 5 s > uma tentativa 2 s). No BoxOffice: timeout de leitura de 1 s no `payment` ([quadro acima](#timeout)).
    - **Dimensione cada bulkhead com a Lei de Little e recalcule quando a latência ou o tráfego mudarem** — 100 compras/s × 0,2 s = 20 chamadas em voo, então um bulkhead de 50. No BoxOffice: 10 das 50 threads do `order` ([Hands-on 9](../../../hands-on/9/patterns/index.md)).
    - **Faça de todo parâmetro de resiliência configuração, não código** — durante um incidente você aumenta um timeout ou encolhe um bulkhead mudando configuração, sem build. No BoxOffice: `PAYMENT_READ_TIMEOUT`, `PAYMENT_RETRY_ATTEMPTS`, `PAYMENT_BULKHEAD` no `application.yaml`.
    - **Limite os retries com um orçamento, não só com uma contagem** — retries que somam no máximo 10% ao tráfego normal deixaram o provedor se recuperar na simulação acima, onde 3 retries por chamada o mantinham caído.
    - **Publique o estado do breaker, as permissões do bulkhead e as contagens de retry como métricas e alerte quando o breaker abrir** — um breaker aberto é um incidente em andamento. No BoxOffice: `/actuator/circuitbreakers` e o breaker no `/actuator/health` (lab 9).
    - **Devolva o fallback como um estado explícito sobre o qual o cliente pode agir** — "pagamento indisponível, lugares reservados" deixa o fã tentar de novo; um 500 genérico não. No BoxOffice: `503` com o pedido mantido em `PENDING_PAYMENT`.

!!! warning "Armadilhas comuns"

    - **Timeouts padrão** de minutos (ou nenhum) em clientes HTTP e de banco de dados.
    - **Retries em todas as camadas** — 3 × 3 × 3 = 27 chamadas por clique a um serviço em dificuldade.
    - **Repetir chamadas não idempotentes** sem chave de idempotência: cobranças duplicadas.
    - **Contar erros de negócio como falhas**: cartões recusados abrindo o breaker para todos.
    - **Breakers que só contam erros, não lentidão**: um provedor a 4 s por chamada nunca os dispara.
    - **Dependências nos probes de liveness**: uma oscilação de um terceiro reinicia a frota inteira.
    - **Fallbacks não testados** que falham na primeira vez em que são necessários.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    SLOW["dependência lenta<br/>(provedor de pagamento)"] --> TO["timeout ≈ p99,9<br/>+ propagação de deadline"]
    TO --> RT["retry: backoff, jitter,<br/>retry budget, uma camada"]
    RT --> IK["chave de idempotência<br/>→ Compute — integrações"]
    TO --> CB["circuit breaker<br/>(também conta chamadas lentas)"]
    CB --> FB["fallback: assentos reservados,<br/>diga a verdade"]
    SLOW --> BH["bulkhead dimensionado pela<br/>Lei de Little → Estimativas"]
    OVER["sobrecarga"] --> LS["descarte de carga<br/>→ sala de espera (Mensageria)"]
    OVER --> RL["rate limiting<br/>→ Borda — API gateway"]
    HC["liveness, readiness, startup<br/>→ Cloud-native — Kubernetes"] --> LB["fora do load balancer<br/>→ Borda — balanceamento"]
    CB --> CH["prove sob falha<br/>→ Engenharia do caos"]
```

**Componentes da paleta:** [`thirdparty`](../../../reference/components/external/index.md#thirdparty) · [`payment`](../../../reference/components/external/index.md#payment) (a chamada que todos os padrões desta página protegem) · [`app`](../../../reference/components/compute/index.md#app) (as réplicas de `order` cujas threads o bulkhead protege) · [`apigw`](../../../reference/components/edge/index.md#apigw) (rate limiting e descarte de carga na porta) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sala de espera) · [`healthcheck`](../../../reference/components/observability/index.md#healthcheck) (liveness, readiness, startup) · [`lb`](../../../reference/components/edge/index.md#lb) (retira instâncias não prontas). **Cenários:** `cascading-failure`, `retry-storm`, `rate-limiter`, `payment-system`, `flash-sale`. **Continua em:** [Compute — integrações](../../compute/integrations/index.md#idempotency-keys), [Mensageria — semântica de entrega](../../messaging/semantics/index.md), [Mensageria — a sala de espera](../../messaging/queues-pubsub/index.md#the-flash-sale-waiting-room), [Borda — API gateway](../../edge/api-gateway/index.md#rate-limiting), [Borda — balanceamento de carga](../../edge/load-balancing/index.md#health-checks), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Hands-on 9 — pagamento e Toxiproxy](../../../hands-on/9/payment/index.md).

---

[^1]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2. ed. Pragmatic Bookshelf, 2018. Capítulo "Stability Patterns".
[^2]: BROOKER, M. [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/){target="_blank"}. AWS Architecture Blog, 2015; BROOKER, M. [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/){target="_blank"}. Amazon Builders' Library.
[^3]: FOWLER, M. [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html){target="_blank"}. martinfowler.com, 2014.
[^4]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. O'Reilly, 2016. Capítulo 21, "Handling Overload"; YANACEK, D. [Using load shedding to avoid overload](https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/){target="_blank"}. Amazon Builders' Library.
[^5]: [Documentação do Resilience4j](https://resilience4j.readme.io/docs){target="_blank"}.
