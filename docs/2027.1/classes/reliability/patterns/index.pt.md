Quando uma dependência degrada, o comportamento ingênuo — continuar enviando requisições e esperar a resposta — produz com certeza a cascata da [visão geral](../index.md#cascading-failures): as threads de quem chama bloqueiam, sua fila enche e a falha sobe até usuários que não tinham nada a ver com a dependência quebrada. **Padrões de resiliência** são decisões de projeto que interrompem essa propagação. Eles não evitam falhas; eles **limitam até onde uma falha vai**[^1].

Ao longo desta página seguimos uma chamada do BoxOffice: **o `order` chama o `payment`**, o adaptador na frente do provedor externo de pagamento, para cobrar o cartão de um fã durante a saga de compra (veja [Mensageria — padrões](../../messaging/patterns/index.md#sagas)). É a chamada mais perigosa do sistema: está no caminho da receita, atravessa a internet até um terceiro e o dia ruim do terceiro vira o nosso.

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

Um **timeout** é um prazo em uma chamada de saída: se a resposta não chegou a tempo, quem chama a abandona e trata o erro. Sem timeout, uma dependência pendurada segura uma thread (e uma conexão e memória) indefinidamente; com ele, o estrago que uma chamada lenta pode fazer é limitado.

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

- **A partir da distribuição de latência da dependência.** Coloque um pouco acima do p99,9 da operação normal: qualquer coisa mais lenta já é anormal. Para o `payment`, que normalmente responde em cerca de 200 ms com um p99,9 bem abaixo de um segundo, o lab 9 lê com timeout de 1 s.
- **Dois timeouts por chamada HTTP**: o **timeout de conexão** (abrir a conexão TCP/TLS — curto, algumas centenas de milissegundos) e o **timeout de leitura** (esperar a resposta).
- **Por dependência.** Uma consulta ao cache, uma query no banco e uma API de terceiros têm latências que diferem em ordens de grandeza. Um timeout global está sempre errado para a maioria delas.
- **Dentro do orçamento de quem chama.** Se a requisição do fã tem 5 s no gateway, tudo abaixo precisa caber nisso, inclusive os retries.

### Propagação de prazo { #deadline-propagation }

Os timeouts precisam encolher à medida que a requisição desce. Um prazo definido na borda e **propagado** com a requisição (o gRPC faz isso nativamente com deadlines; em HTTP, um cabeçalho com o orçamento restante) permite que cada serviço saiba quanto tempo resta e pare de trabalhar numa requisição cujo chamador já desistiu.

| Camada | Orçamento | Gasto em |
|---|---|---|
| Borda (Nginx) | 10 s | tudo abaixo |
| Gateway | 5 s | tudo abaixo + o próprio trabalho |
| `order` → `payment` | 1 s por tentativa × 3 tentativas + backoff (200 ms, 400 ms ± 50%) ≈ 3,6 s | a cobrança |
| `payment` → provedor | 2 s (`PSP_READ_TIMEOUT`) | a chamada ao provedor |

``` diagram-sim
sequenceDiagram
    participant G as gateway (5 s)
    participant O as order
    participant P as adaptador payment
    participant X as provedor
    G->>O: POST /orders/{id}/pay, restam 5 s
    O->>P: cobrança, tentativa 1 (timeout de leitura 1 s)
    P->>X: cobrar o cartão (timeout de leitura 2 s)
    Note over O,P: 1 s sem resposta: o order desiste
    O->>O: backoff de cerca de 200 ms
    O->>P: cobrança, tentativa 2 (mesma Idempotency-Key)
    P->>X: cobrar o cartão
    X-->>P: aprovado depois de 400 ms
    P-->>O: AUTHORIZED
    O-->>G: CONFIRMED depois de cerca de 1,7 s, dentro de 5 s
```

Cada camada gasta parte do orçamento e passa o resto para baixo: até três tentativas (cerca de 3,6 s) cabem nos 5 s do gateway e uma quarta (cerca de 5,4 s) não caberia. Um valor do lab quebra a regra: o `payment` espera até 2 s pelo provedor, mais que a tentativa de 1 s do `order`, então, quando o provedor está lento, o `payment` continua trabalhando numa cobrança que o `order` já abandonou — inofensivo só por causa da chave de idempotência. Em produção, dê ao adaptador menos tempo que ao seu chamador.

!!! warning "Timeouts são só o primeiro passo"
    Um timeout transforma uma espera infinita em um erro rápido. Você ainda precisa decidir o que fazer com o erro: repetir (se for transitório e seguro), parar de chamar por um tempo (circuit breaker) ou responder outra coisa (fallback). E um timeout numa chamada *não idempotente* deixa um resultado desconhecido — a cobrança pode ter sido feita — e é por isso que as chamadas ao `payment` levam uma chave de idempotência (veja [Integrações](../../compute/integrations/index.md)).

!!! example "No código do BoxOffice: os timeouts de `order` → `payment` (lab 9)"

    O [Hands-on 9 — Padrões de resiliência](../../../hands-on/9/patterns/index.md) dá ao cliente do `payment` seus dois timeouts: 500 ms para conectar e 1 s para ler (`PAYMENT_READ_TIMEOUT`; `0` espera para sempre, o experimento "antes"). A chave de idempotência `order-<id>` é a mesma em toda tentativa e é isso que torna seguro o retry da próxima seção. A aritmética do lab: 20 pagamentos/s contra um provedor 3 s lento seguram 20 × 3 = 60 threads, mais que o pool de 50; com o timeout de 1 s, 20 × 1 = 20.

    ``` { .java title="services/order/src/main/java/boxoffice/order/payment/PaymentClient.java (timeouts and idempotency key)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentClient.java:15:32"
    ```

---

## Retry com backoff e jitter { #retry-with-backoff-and-jitter }

Um **retry** repete uma chamada que falhou, apostando que a falha foi **transitória**: uma conexão derrubada, um pod reiniciando, uma eleição de líder. Retries tornam invisíveis muitas pequenas oscilações. Feitos sem cuidado, são também o jeito mais rápido de transformar um problema pequeno numa indisponibilidade.

### O que repetir { #what-to-retry }

| Falha | Repetir? | Por quê |
|---|---|---|
| Conexão recusada / resetada, timeout de conexão | ✅ Sim | Falha transitória típica; a requisição provavelmente nem rodou |
| Timeout de leitura | ⚠️ Só se a operação for idempotente (ou tiver chave de idempotência) | A requisição pode ter rodado |
| `503 Service Unavailable`, `429 Too Many Requests` | ✅ Sim, com backoff; respeite o `Retry-After` | O servidor está pedindo para você voltar depois |
| `500 Internal Server Error` | ⚠️ No máximo uma vez | Muitas vezes é um bug que falha de novo |
| `400`, `401`, `403`, `404`, `409`, `422`; "cartão recusado" | ❌ **Nunca** | A requisição em si está errada ou a resposta é definitiva |

### Backoff exponencial e jitter { #exponential-backoff-and-jitter }

Repetir imediatamente atinge de novo uma dependência em dificuldade antes que ela tenha qualquer chance de se recuperar. O **backoff exponencial** espera mais depois de cada falha:

$$
\text{wait}_n = \min\left(\text{base} \cdot 2^{n},\ \text{cap}\right)
$$

As esperas se somam: o que importa a quem chama é o tempo desde a primeira falha. Com base de 1 s e teto de 16 s:

| Antes do retry | Espera | Tempo desde a primeira falha |
|---|---|---|
| 1º ($n$ = 0) | 1 s | 1 s |
| 2º ($n$ = 1) | 2 s | 3 s |
| 3º ($n$ = 2) | 4 s | 7 s |
| 4º ($n$ = 3) | 8 s | 15 s |
| 5º em diante | 16 s (o teto) | +16 s cada |

O lab 9 usa base de 200 ms e até 3 tentativas — esperas de 200 ms e depois 400 ms, o último retry 600 ms depois da primeira falha (mais o tempo de cada tentativa). Mas se muitos clientes falharam no mesmo instante (o provedor oscilou para todos), todos repetem nos mesmos instantes também — ondas sincronizadas. O **jitter** torna as esperas aleatórias; a análise de Marc Brooker na AWS recomenda o **full jitter**[^2]:

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

- **Esquerda — retries podem manter um sistema caído.** Sem retries (cinza), os sucessos caem durante a degradação e voltam no instante em que ela termina. Com 3 retries por requisição (vermelho), cada falha vira até 4 chamadas; a carga extra mantém o provedor sobrecarregado *depois* que o gatilho passou e o sistema se acomoda num estado degradado — uma **falha metaestável** (veja a [visão geral](../index.md#other-amplifiers)). Backoff e jitter não resolvem isso: eles espalham os retries no tempo, mas não reduzem a quantidade. Um **retry budget** (azul) — os retries podem acrescentar no máximo 10% ao tráfego normal — limita a amplificação e o sistema se recupera na hora.
- **Direita — jitter evita ondas sincronizadas.** Sem jitter (laranja), todos os clientes que falharam juntos repetem juntos: 1.000 chamadas em uma janela de 100 ms, só 150 têm sucesso, as outras 850 repetem juntas de novo… depois de 15 segundos, 250 clientes ainda não conseguiram. Com full jitter (azul), os mesmos retries se espalham abaixo da linha de capacidade e todos conseguem em cerca de 1,5 s.

Daí saem três regras:

1. **Faça retry em uma só camada.** Se o gateway, o `order` e o adaptador `payment` fazem até 3 tentativas cada, um clique do fã pode virar $3 \times 3 \times 3 = 27$ chamadas ao provedor. Faça retry perto da dependência que falha e deixe as camadas de cima falharem rápido.
2. **Limite as tentativas e o tempo total**: poucas tentativas (1–2 retries), todas dentro do prazo de quem chama.
3. **Use um retry budget** (Envoy, retry throttling do gRPC, Finagle): retries só são permitidos enquanto forem uma pequena fração das requisições. Quando a dependência está realmente fora, os retries param sozinhos.

!!! info "Experimente no playground"

    O cenário `retry-storm` tem clientes repetindo chamadas que falharam, sem backoff, contra um serviço que sofre uma indisponibilidade curta. Aperte **Run** e observe a taxa de requisições ao serviço pular para várias vezes a taxa dos clientes durante a indisponibilidade e o serviço continuar sobrecarregado depois de quando deveria ter se recuperado. Depois troque a política de retry para **backoff exponencial com jitter**, adicione um **retry budget** e compare o tempo de recuperação.

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
    Open --> HalfOpen : depois de 10 s
    HalfOpen --> Closed : taxas das 3 sondas abaixo dos limites
    HalfOpen --> Open : taxa de falhas ou de lentas das sondas ≥ 50%
```

**Fechado** (normal)
: As chamadas passam; o breaker registra sucessos, falhas e chamadas lentas numa janela deslizante.

**Aberto** (falhando rápido)
: As chamadas falham na hora (`CallNotPermittedException` no Resilience4j). As threads de quem chama ficam livres e a dependência ganha espaço para respirar em vez de uma tempestade de retries.

**Meio-aberto** (testando)
: Depois do tempo de espera, algumas chamadas de sonda são permitidas e toda outra chamada continua rejeitada. Quando as sondas terminam, o breaker calcula as taxas de falhas e de chamadas lentas *delas*: abaixo dos limites, ele fecha; senão, abre para mais uma espera.

| Parâmetro (propriedade do Resilience4j) | Padrão do Resilience4j | Valor do lab 9 para o `payment` | Efeito |
|---|---|---|---|
| Janela deslizante (`sliding-window-size`) | 100 chamadas | últimas 20 chamadas (por contagem) | Quanto histórico decide |
| Mínimo de chamadas (`minimum-number-of-calls`) | 100 | 10 | Nenhuma decisão antes desse número — evita abrir com 1 falha em 2 |
| Limite de taxa de falhas (`failure-rate-threshold`) | 50% | 50% | Abre quando a fração de chamadas com falha é **igual ou maior** que ele |
| Chamadas lentas (`slow-call-duration-threshold`, `slow-call-rate-threshold`) | 60 s, 100% | 800 ms, 50% | Um provedor *lento* também abre o breaker — essencial contra gray failures |
| Espera no estado aberto (`wait-duration-in-open-state`) | 60 s | 10 s | Tempo que a dependência ganha para se recuperar — e quanto tempo os fãs veem a falha rápida |
| Chamadas no meio-aberto (`permitted-number-of-calls-in-half-open-state`) | 10 | 3 | Com quanto cuidado a recuperação é testada |

Os padrões são conservadores: com uma janela de 100 chamadas, um breaker que vê 1 chamada por segundo precisa de bem mais de um minuto para decidir. Chamadas lentas têm **o seu próprio limite de taxa**: com o padrão de 100%, elas só abrem o breaker quando *toda* chamada da janela é lenta e, com a duração padrão de 60 s, uma chamada atrás de um timeout de leitura de 1 s nunca conta como lenta. O lab 9 define o limite de chamada lenta em 800 ms, **abaixo** do seu timeout de leitura de 1 s: uma chamada mais lenta que o timeout nunca termina — vira falha —, então um limite acima do timeout jamais veria uma chamada lenta e o breaker esperaria os timeouts em vez de reagir primeiro à lentidão.

Importa quais erros contam: um **cartão recusado** é uma resposta correta de um provedor saudável, não uma falha. Configure-o como ignorado, ou uma onda de cartões recusados num ataque com cartões roubados abriria o breaker para todos os fãs honestos. O lab 9 não tem cartões recusados; o seu retry ignora todo 4xx (`HttpClientErrorException`), porque a mesma requisição falharia de novo, e o seu breaker ignora a `BulkheadFullException`, uma recusa nossa que não diz nada sobre o `payment`.

A espera é um compromisso que dá para calcular. Com 10 s, um provedor que se recupera um segundo depois de o breaker abrir ainda custa aos fãs cerca de 9 s de "pagamento temporariamente indisponível", até as sondas do meio-aberto o verem saudável; um provedor que continua fora mantém o breaker aberto em degraus de 10 s, cada um custando só 3 chamadas de sonda. Uma espera maior protege melhor um provedor em dificuldade e faz mais fãs falharem depois que ele se recupera.

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
    req["order: 50 threads do Tomcat"] --> bp["bulkhead do payment<br/>máx. 10 concorrentes, sem fila"]
    req --> rest["as outras 40 threads<br/>POST /orders, GET /orders/{id}"]
    bp --> pay["payment<br/>(lento: 3 s)"]
    bp -.->|"11ª chamada concorrente: 503 na hora"| fb["fallback"]
    rest --> db[("banco de pedidos<br/>(saudável)")]
```

O dimensionamento vem de novo da Lei de Little. Com os 20 pagamentos/s do lab 9 e 200 ms por cobrança, cerca de 4 chamadas estão em voo. Um bulkhead de **10** deixa espaço para a latência crescer 2,5× (até 0,5 s) antes de as chamadas serem rejeitadas; quando o provedor vai para 3 s, no máximo 10 threads esperam por ele (em vez de 60, mais que o pool) e as outras 40 continuam criando e lendo pedidos. Com `max-wait-duration: 0` a 11ª chamada concorrente não entra em fila: ela falha em microssegundos e vai para o fallback.

O custo de um bulkhead é **capacidade que não pode ser compartilhada**: com o bulkhead do pagamento cheio, um 11º pagamento é recusado na hora mesmo com outras threads ociosas, enquanto um pool compartilhado o teria atendido. Essa recusa é o objetivo — as threads ociosas ficam para as rotas que funcionam.

O Resilience4j oferece um **bulkhead de semáforo** (limita chamadas concorrentes nas threads de quem chama; barato, o padrão) e um **bulkhead de pool de threads** (executa as chamadas num pool dedicado). A ideia é geral: pools de conexão separados por carga de trabalho num banco, consumer groups separados no Kafka, deployments separados para tráfego crítico e não crítico, filas separadas para confirmações e e-mails de marketing.

---

## Load shedding { #load-shedding }

Quando a demanda passa da capacidade, *algumas* requisições vão falhar. O **load shedding** (descarte de carga) decide **quais** e as faz falhar **cedo e barato**, para que o resto tenha sucesso. Sem ele, o servidor aceita tudo, toda requisição fica lenta, a maioria dá timeout depois de consumir recursos e o goodput (trabalho útil) desaba — todos falham[^4].

- **Descarte na porta.** Rejeite com `503` + `Retry-After` antes de fazer qualquer trabalho: uma rejeição custa microssegundos, uma requisição que dá timeout custa o processamento inteiro.
- **Descarte por prioridade.** Durante a abertura do estádio, o BoxOffice classifica o tráfego: compras e reservas são críticas; navegação no catálogo é importante; recomendações, autocomplete e "eventos relacionados" são descartáveis. Sob sobrecarga, os descartáveis saem primeiro.
- **Descarte trabalho velho.** Uma requisição que já esperou mais que o prazo de quem chamou é inútil; tire-a da fila em vez de processá-la (filas limitadas com prazos, último a chegar, primeiro a sair (LIFO, *last in, first out*) sob sobrecarga).
- **Adapte o limite.** Em vez de um limite fixo de concorrência, limitadores adaptativos (inspirados no controle de congestionamento do TCP, por exemplo a biblioteca concurrency-limits da Netflix) reduzem o número de requisições concorrentes quando a latência sobe e o aumentam quando a latência está saudável.

!!! example "BoxOffice: a sala de espera é load shedding"

    A [sala de espera da flash sale](../../messaging/queues-pubsub/index.md#the-flash-sale-waiting-room) é load shedding feito com gentileza: em vez de rejeitar fãs, ela os admite na taxa que o sistema consegue atender e informa aos outros a sua posição. Atrás dela, o gateway ainda descarta as rotas descartáveis quando a latência do `order` sobe, como segunda linha de defesa.

---

## Rate limiting { #rate-limiting }

O **rate limiting** limita quantas requisições um **cliente** (um IP, um usuário, uma chave de API, um parceiro) pode enviar numa janela de tempo. O load shedding protege o servidor da sobrecarga *total*; o rate limiting o protege de clientes *individuais* — bots atualizando o mapa de lugares centenas de vezes por segundo, a integração bugada de um parceiro, um scraper.

O algoritmo comum é o **token bucket**: os tokens se recarregam numa taxa constante (o limite sustentado), o tamanho do balde permite rajadas curtas e cada requisição consome um token; balde vazio significa `429 Too Many Requests`. Limites por usuário ou chave de API ficam no API gateway, apoiados num armazenamento compartilhado como o Redis, onde a identidade autenticada é conhecida. Os algoritmos (token bucket, leaky bucket, janela deslizante) e sua implementação estão em [Borda — API gateway](../../edge/api-gateway/index.md); o cenário `rate-limiter` do playground mostra um gateway protegendo um backend.

---

## Health checks { #health-checks }

Health checks permitem que orquestradores e load balancers parem de enviar tráfego para instâncias quebradas — failover automático na menor escala.

**Liveness**
: *O processo está vivo e não travado?* Se falha, o Kubernetes **reinicia** o container.

**Readiness**
: *Esta instância pode atender tráfego agora?* Se falha, a instância é **removida do load balancer** sem ser reiniciada (aquecendo, sobrecarregada, perdeu a conexão com o próprio banco).

**Startup**
: *A aplicação terminou de iniciar?* Liveness e readiness só são verificados depois que ele passa, então uma JVM que demora para subir não é morta durante o boot.

O Spring Boot Actuator serve as probes em `/actuator/health/liveness` e `/actuator/health/readiness`. No Spring Boot 4 (a versão dos labs) esses grupos de probes vêm **ligados por padrão**, em qualquer ambiente; do Spring Boot 2.3 ao 3.x eram automáticos só no Kubernetes e em outros lugares — no Docker Compose, por exemplo — pediam `management.endpoint.health.probes.enabled=true` (o lab 9 ainda o define, o que não faz mal). Por padrão eles refletem só o estado da própria aplicação: uma dependência só aparece no readiness se você a adicionar.

``` diagram-sim
stateDiagram-v2
    [*] --> Iniciando
    Iniciando --> Pronto : startup passa, depois readiness passa
    Iniciando --> Reiniciado : startup falha 30 vezes (150 s)
    Pronto --> NaoPronto : readiness falha duas vezes
    NaoPronto --> Pronto : readiness volta a passar
    Pronto --> Reiniciado : liveness falha 3 vezes
    NaoPronto --> Reiniciado : liveness falha 3 vezes
    Reiniciado --> Iniciando
    note right of NaoPronto : fora do load balancer, sem reiniciar
```

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

Os padrões trabalham em camadas. Para a chamada `order` → `payment`, o BoxOffice usa todos eles, configurados com Resilience4j[^5] no lab 9. Os números são do tamanho de um laptop — 20 pagamentos/s contra 50 threads do Tomcat — e cada parâmetro lê uma variável de ambiente, então cada experimento desliga um padrão sem rebuild.

!!! example "No código do BoxOffice: a pilha de proteção no `order` (lab 9)"

    O [Hands-on 9 — Padrões de resiliência](../../../hands-on/9/patterns/index.md) configura cada camada e cada valor tem um motivo:

    - **Timeouts**: 500 ms para conectar e 1 s para ler (`PAYMENT_READ_TIMEOUT`; `0` espera para sempre, o experimento "antes") — cerca de cinco vezes os 200 ms normais do provedor.
    - **Retry**: 3 tentativas (1 chamada + 2 retries), 200 ms e depois 400 ms de backoff, cada um ± 50% (jitter), só em erros de E/S, 5xx e conexões resetadas; um 4xx é definitivo e um breaker aberto (`CallNotPermittedException`) ou um bulkhead cheio (`BulkheadFullException`) falha rápido em vez de ser repetido.
    - **Circuit breaker**: por contagem sobre as últimas 20 chamadas (no mínimo 10), abre quando 50% falharam *ou* levaram mais de 800 ms — um provedor lento também o dispara —, fica aberto 10 s e depois deixa 3 sondas decidirem; ele ignora a `BulkheadFullException`.
    - **Bulkhead**: 10 chamadas concorrentes das 50 threads, `max-wait-duration: 0` — cheio significa 503 na hora.

    O `PaymentGateway` empilha as anotações na ordem padrão do Resilience4j — Retry ( CircuitBreaker ( Bulkhead ( call ) ) ) — com o fallback na camada externa. O fallback responde `503` e o pedido fica `PENDING_PAYMENT`, o "tente de novo" honesto do [Fallback](#fallback-and-graceful-degradation). Com o provedor 3 s lento, o lab mediu o `GET /orders/{id}` — que nunca chama o `payment` — com mediana de **9,04 s** sem proteção e **6,5 ms** com os padrões.

    ``` { .yaml title="services/order/src/main/resources/application.yaml (timeouts and resilience4j)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/resources/application.yaml:41:84"
    ```

    ``` { .java title="services/order/src/main/java/boxoffice/order/payment/PaymentGateway.java (the stack)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentGateway.java:24:29"
    ```

<div class="csim" data-sim="resilience" data-latency="4000" data-errors="0" data-timeout="off" data-retries="off" data-breaker="off"></div>

!!! tip "Experimente"
    São 10:02 e o provedor responde em 4 s em vez de 200 ms. As chaves usam os valores do quadro acima (timeout de leitura de 1 s; 3 tentativas com backoff de 200 ms × 2 ± 50%; um breaker sobre as últimas 20 chamadas que abre com 50% de falhas ou acima de 800 ms e espera 10 s). Ligue uma de cada vez, recomeçando a cada rodada:

    1. **Nada ligado**: 20 pagamentos/s × 4 s pedem 80 threads; as **50** ficam ocupadas em segundos e, em 30 s, cerca de 220 pagamentos não encontram thread nenhuma — nem o `GET /orders` encontraria.
    2. **Timeout**: só cerca de 20 threads ficam ocupadas, mas **0%** dos pagamentos dão certo. O timeout protege o `order`, não o pagamento.
    3. **+ retentativas**: o provedor passa a receber cerca de **2×** os pagamentos (44 chamadas/s) justamente quando está com dificuldade e as 50 threads lotam de novo — 3 tentativas de 1 s mais o backoff prendem cada thread por cerca de 3,6 s. Timeout mais retentativas **sem** breaker é pior que nada: depois de 30 s, 0 pagamentos dão certo a cada 10 s (128 deram certo com nada ligado, devagar), cerca de 200 não encontraram thread e o provedor recebe o dobro da carga.
    4. **+ circuit breaker**: ele abre 1,6 s depois do início; os pagamentos falham rápido, as threads caem para cerca de 1 e o provedor não recebe chamadas. Arraste a latência de volta para 200 ms: 10 s depois de abrir, o breaker fica semiaberto, 3 sondas dão certo e ele fecha. Pontos vermelhos na janela dele são falhas, laranja são chamadas lentas.

As anotações decidem o caminho de cada chamada. Leia da esquerda: o retry envolve o breaker, que envolve o bulkhead, que envolve a chamada HTTP — e toda recusa termina no mesmo fallback.

``` diagram-sim
flowchart LR
    call(["charge"]) --> R["Retry<br/>3 tentativas, 200 ms × 2 ± 50%"]
    R --> CB{"circuit breaker<br/>deixa passar?"}
    CB -->|"aberto: CallNotPermitted"| FB["fallback<br/>pagamento indisponível, assentos reservados"]:::problem
    CB -->|"fechado ou uma sonda meio-aberta"| BH{"bulkhead<br/>permissão livre?"}
    BH -->|"cheio: BulkheadFull"| FB
    BH -->|"sim"| HTTP["chamada HTTP<br/>conexão 500 ms, leitura 1 s"]
    HTTP -->|"timeout, 5xx ou reset: contado pelo breaker"| R
    HTTP -->|"2xx"| OK(["cobrado"]):::comp
    R -->|"tentativas esgotadas"| FB
```

Como as camadas interagem — verifique antes de lançar:

- **Ordem dos decoradores.** O padrão do Resilience4j no Spring Boot é `Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) )`: o retry é o mais externo, então toda tentativa é contada pelo breaker e um breaker aberto faz o retry falhar na hora. Garanta que os retries nunca contornem o breaker. Ponha o **fallback na camada mais externa** (o retry): um fallback no breaker transforma toda falha numa resposta normal, então o retry nunca vê um erro e nunca repete.
- **Orçamento de tempo.** 3 tentativas × 1 s + backoffs de cerca de 200 ms e 400 ms ≈ 3,6 s, dentro dos 5 s do gateway.
- **Métricas.** O Resilience4j exporta pelo Micrometer o estado do breaker, a saturação do bulkhead e a contagem de retries; coloque-os em gráficos ao lado do dashboard de objetivos de nível de serviço (SLO, *service level objective*) ([Hands-on 8](../../../hands-on/8/index.md)), porque um breaker que abre é um incidente em andamento.
- **Prova.** Nada disso é confiável até você injetar a falha e ver funcionar — [engenharia do caos](../chaos/index.md) e [Hands-on 9](../../../hands-on/9/index.md).

!!! info "Experimente no playground"

    Abra o cenário `cascading-failure` no modo completo. Rode uma vez como está (sem proteção) e anote a taxa de erros das rotas saudáveis. Depois adicione, uma de cada vez, um **timeout**, um **circuit breaker** e um **bulkhead** na chamada ao terceiro, rodando depois de cada mudança. Qual deles protege mais as rotas saudáveis? Quanto cada um custa às requisições que precisam do terceiro?

<div class="sdp" data-scenario="cascading-failure" data-mode="full" data-height="620"></div>

!!! info "Experimente no playground: os números do lab 9"

    O preset `boxoffice-payment` é o [Hands-on 9](../../../hands-on/9/index.md) no playground: o `pay-under-chaos.js` manda 20 pagamentos/s e 20 requisições de navegação/s ao `order`, que tem 50 threads do Tomcat, e em t = 60 s o Toxiproxy acrescenta 3 s a toda chamada ao `payment`. Rode como está: 20 pagamentos/s × 3 s = 60 chamadas em andamento > 50 threads e a navegação, que nunca toca o provedor, falha junto. Depois proteja a aresta `order → payment` como o lab faz — timeout de 1 000 ms, 3 tentativas com backoff com jitter, o circuit breaker e um bulkhead de 0,2 das threads (10 de 50) — e rode de novo: os pagamentos falham rápido durante o incidente e a navegação mantém as suas threads.

<div class="sdp" data-scenario="boxoffice-payment" data-mode="compact" data-height="460"></div>

As camadas também têm uma ordem, da mais externa para dentro, e cada posição tem um motivo:

| Camada, da mais externa | Trata | Por que nesta posição | Configuração no BoxOffice |
|---|---|---|---|
| Rate limiting, load shedding (gateway) | Clientes abusivos, sobrecarga | Recusa o trabalho excedente antes que ele custe algo | token bucket por conta; recomendações e autocomplete descartados primeiro |
| Retry + backoff + jitter, com o fallback | Erros transitórios | Fora do breaker: um breaker aberto para os retries na hora; o fallback roda uma vez, depois que tudo lá dentro desistiu | 3 tentativas, 200 ms × 2 ± 50%, chave de idempotência; `503`, lugares reservados |
| Circuit breaker | Uma dependência sabidamente falhando ou lenta | Vê cada tentativa, timeouts incluídos, como uma chamada a julgar | 50% de falhas ou de chamadas acima de 800 ms nas últimas 20, aberto por 10 s |
| Bulkhead | Uma dependência lenta comendo todas as threads | Limita as threads que as tentativas podem segurar | 10 chamadas concorrentes ao pagamento das 50 threads, sem fila |
| Timeout | Espera sem limite | A mais interna: limita cada tentativa, não a soma | 500 ms de conexão, 1 s de leitura |

Essa é a ordem padrão dos aspectos do Resilience4j no Spring Boot, `Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) )` — no lab 9 o timeout de leitura do cliente HTTP faz o papel do time limiter, dentro da chamada. O handler de resiliência padrão da Microsoft para o `HttpClient` do .NET empilha do mesmo jeito: rate limiter → timeout total → retry → circuit breaker → timeout por tentativa[^6]. Qualquer que seja a biblioteca, verifique que os retries não contornam o breaker e que o timeout limita cada tentativa.

!!! tip "Na entrevista"
    Quando um projeto tem uma chamada a um terceiro ou a uma dependência crítica, ofereça a pilha de proteção de uma vez: "timeout por volta do p99,9, um ou dois retries com backoff e jitter e uma chave de idempotência, um circuit breaker que também conta chamadas lentas, um bulkhead dimensionado com a Lei de Little e um fallback que diz a verdade ao usuário". Depois justifique um número (o bulkhead ou o timeout) com aritmética. Se perguntarem sobre sobrecarga, diferencie **rate limiting** (por cliente) de **load shedding** (o sistema todo, por prioridade) e mencione a amplificação de retries entre camadas.

!!! success "Boas práticas"

    - **Derive cada timeout do p99,9 medido da dependência e mantenha-o abaixo do orçamento que resta ao chamador** — o orçamento encolhe a cada salto (borda 10 s > gateway 5 s > uma tentativa 1 s). No BoxOffice: timeout de leitura de 1 s no `payment` ([quadro acima](#timeout)).
    - **Dimensione cada bulkhead com a Lei de Little e recalcule quando a latência ou o tráfego mudarem** — 20 pagamentos/s × 0,2 s = 4 chamadas em voo, então um bulkhead de 10 deixa espaço para 2,5× a latência. No BoxOffice: 10 das 50 threads do `order` ([Hands-on 9](../../../hands-on/9/patterns/index.md)).
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
[^6]: MICROSOFT. [Build resilient HTTP apps: key development patterns](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience){target="_blank"}. Microsoft Learn (o handler de resiliência padrão).
