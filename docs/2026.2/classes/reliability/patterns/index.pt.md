Quando um serviço downstream degrada ou falha, o comportamento ingênuo padrão — continuar enviando requisições e esperar uma resposta — produz, com toda a certeza, falhas em cascata. As threads do serviço que chama ficam bloqueadas, sua fila enche e a falha se propaga para cima, até clientes que nada tinham a ver com a dependência quebrada.

Padrões de resiliência são decisões de projeto que interrompem essa propagação. Eles não evitam falhas; eles **limitam até onde uma falha se espalha** pelo sistema[^1].

``` mermaid-sim
flowchart LR
    client --> gateway
    gateway -->|"Timeout\nCircuit Breaker\nBulkhead"| downstream:::slow
    gateway -->|"falha rápida\nou fallback"| client:::ok

    classDef slow fill:#f90,color:#000
    classDef ok fill:#6c6,color:#fff
```

Os padrões abaixo são complementares — sistemas em produção os usam em combinação, não isoladamente. Ao longo da página usamos um exemplo contínuo da loja: o **serviço de pedidos** chama o **serviço de produtos** (por meio de um cliente OpenFeign, como no [Hands-on 1](../../../hands-on/1/index.md)) para conferir os preços antes de salvar um pedido.

| Padrão | Pergunta que responde | Protege contra |
|---|---|---|
| [Timeout](#timeout) | Quanto tempo estou disposto a esperar? | Chamadas travadas |
| [Retry](#retry-with-exponential-backoff) | Vale a pena tentar de novo? | Falhas transitórias |
| [Circuit breaker](#circuit-breaker) | Devo sequer tentar? | Uma dependência que sabidamente está fora do ar |
| [Fallback](#fallback-and-graceful-degradation) | O que respondo no lugar? | Perda total de uma funcionalidade |
| [Bulkhead](#bulkhead) | Quanto da minha capacidade uma dependência pode ocupar? | Esgotamento de recursos se espalhando |
| [Rate limiting](#rate-limiting) | Quanto tráfego eu aceito? | Picos e clientes abusivos |
| [Health checks](#health-checks) | O tráfego deve chegar a esta instância? | Roteamento para instâncias quebradas |

---

## Timeout { #timeout }

Um **timeout** é um prazo aplicado a uma chamada de saída. Se o serviço downstream não responder dentro do prazo, a chamada é abandonada e um erro é devolvido imediatamente a quem chamou.

Sem timeout, uma única dependência travada pode prender threads indefinidamente. Com timeout, o dano máximo que uma única chamada lenta pode causar fica limitado.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant G as Gateway
    participant P as Serviço de pagamento

    C->>+G: POST /checkout
    G->>+P: POST /charge
    Note over P: processando...
    Note over G: prazo excedido (500 ms)
    G-->>-C: 503 Service Unavailable
    P-->>-G: (resposta chega atrasada — descartada)
```

### Escolhendo os valores de timeout

- **Baseado em percentis**: defina o timeout na latência P99.9 do serviço downstream em condições normais. Qualquer coisa mais lenta que isso já é anormal.
- **Consciente do orçamento**: se a chamada de cima tem seu próprio timeout de 1 s, todas as chamadas downstream dentro daquela requisição precisam terminar, somadas, bem abaixo de 1 s.
- **Distinto por dependência**: uma consulta ao banco de dados, uma API de terceiros e um microsserviço interno têm perfis de latência muito diferentes. Um único valor global de timeout quase sempre está errado.

Normalmente há dois timeouts em uma chamada HTTP: o **connect timeout** (quanto esperar para abrir a conexão TCP) e o **read timeout** (quanto esperar pela resposta depois de conectado). Configure os dois.

!!! example "Timeouts no cliente Feign da loja"

    ```yaml
    # order-service application.yaml (Spring Cloud OpenFeign)
    spring:
      cloud:
        openfeign:
          client:
            config:
              product:              # the @FeignClient name
                connect-timeout: 500    # ms
                read-timeout: 1000      # ms
    ```

    Se o serviço de produtos levar mais de um segundo, o serviço de pedidos recebe uma exceção em vez de uma thread bloqueada e pode decidir o que fazer em seguida.

!!! warning "Timeouts são só o primeiro passo"
    Sozinho, um timeout apenas converte um travamento em um erro rápido. Combine-o com uma política de retry (abaixo) para falhas transitórias, e com um circuit breaker e um fallback para indisponibilidades mais longas.

---

## Retry com backoff exponencial { #retry-with-exponential-backoff }

Um **retry** tenta novamente uma requisição que falhou, após um período de espera. Retries são adequados para **falhas transitórias** — oscilações breves de rede, reinícios momentâneos de serviço ou esgotamento passageiro de recursos — em que a mesma requisição provavelmente terá sucesso numa tentativa seguinte.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant S as Serviço

    C->>+S: Requisição (tentativa 1)
    S-->>-C: 503 Service Unavailable
    Note over C: espera 1 s
    C->>+S: Requisição (tentativa 2)
    S-->>-C: 503 Service Unavailable
    Note over C: espera 2 s
    C->>+S: Requisição (tentativa 3)
    S-->>-C: 200 OK ✓
```

### Backoff exponencial

Repetir imediatamente após uma falha é perigoso: se muitos clientes fizerem retry ao mesmo tempo depois de um reinício do serviço, o pico resultante pode sobrecarregar o serviço que está se recuperando — uma *manada estrondosa* (*thundering herd*). O backoff exponencial espaça os retries:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right)
$$

| Tentativa | Fórmula | Espera (c = 1 s) |
|---|---|---|
| 1 | $1 \cdot 2^0$ | 1 s |
| 2 | $1 \cdot 2^1$ | 2 s |
| 3 | $1 \cdot 2^2$ | 4 s |
| 4 | $1 \cdot 2^3$ | 8 s |
| 5 | $1 \cdot 2^4$, limitado | 16 s (= `max_wait` de 16 s) |
| 6+ | limitado ao máximo | 16 s |

### Jitter

Mesmo com backoff exponencial, clientes que falharam todos no mesmo instante farão retry nos mesmos instantes — uma onda sincronizada de retries. Adicionar um **jitter** aleatório quebra essa sincronização:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right) + \text{random}(0,\ \text{jitter\_cap})
$$

A análise de Marc Brooker na AWS[^2] comparou diversas variantes e recomenda o **full jitter**, que torna aleatória a espera *inteira*, em vez de somar uma pequena quantidade aleatória:

$$
\text{wait}_n = \text{random}\left(0,\ \min\left(c \cdot 2^n,\ \text{max\_wait}\right)\right)
$$

Com 1.000 clientes falhando no mesmo instante, o full jitter espalha os retries uniformemente pelo intervalo, em vez de enviar 1.000 requisições exatamente em t = 1 s, 2 s, 4 s.

### O que repetir — e o que não repetir

| Resposta | Retry? | Por quê |
|---|---|---|
| Conexão recusada, conexão resetada, timeout | Sim | Falha transitória típica |
| `503 Service Unavailable`, `429 Too Many Requests` | Sim, com backoff (respeite o `Retry-After`, se houver) | O servidor está pedindo que você volte mais tarde |
| `500 Internal Server Error` | Talvez, uma vez | Muitas vezes é um bug que vai falhar de novo |
| `400`, `401`, `403`, `404`, `422` | Não | A própria requisição está errada; repetir não resolve |

!!! warning "Amplificação de retries"
    Retries multiplicam a carga exatamente quando o sistema está mais fraco. Se o gateway, o serviço de pedidos e o cliente de produtos fizerem 3 tentativas cada, um clique do usuário pode virar 3 × 3 × 3 = **27** chamadas a um serviço de produtos que já está com dificuldades. Faça retry em **uma** camada apenas (normalmente a mais próxima da dependência que falha), limite o número de tentativas e pare de repetir quando o circuit breaker estiver aberto.

!!! danger "Não faça retry de operações não idempotentes"
    Repetir um `POST /orders` que cria um novo pedido pode gerar duplicatas. Só faça retry de operações **idempotentes** (`GET`, `PUT`, `DELETE`) ou explicitamente projetadas para serem repetidas com segurança (chaves de idempotência, tokens de deduplicação).

Uma operação é **idempotente** quando executá-la duas vezes tem o mesmo efeito que executá-la uma vez. A forma comum de tornar um `POST` seguro para retry é uma **chave de idempotência** (*idempotency key*): o cliente gera um ID único (por exemplo, um UUID) por operação lógica e o envia em um cabeçalho; o servidor guarda as chaves que já processou e, diante de uma chave repetida, devolve o resultado armazenado em vez de criar um segundo pedido.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant O as Serviço de pedidos
    participant DB as Postgres
    C->>O: POST /orders (Idempotency-Key: k-42)
    O->>DB: chave k-42 já vista? não → insere pedido + chave
    O--xC: 201 Created (resposta perdida)
    C->>O: retry POST /orders (Idempotency-Key: k-42)
    O->>DB: chave k-42 já vista? sim
    O-->>C: 201 Created (mesmo pedido, sem duplicata)
```

---

## Circuit Breaker { #circuit-breaker }

O circuit breaker[^3] recebe esse nome por analogia com o disjuntor elétrico: quando a carga ultrapassa os limites seguros, o disjuntor desarma e interrompe o circuito. Em software, quando a taxa de falhas de um serviço downstream passa de um limite, o circuit breaker *abre* e rejeita imediatamente as chamadas para aquele serviço — sem sequer tentar a chamada de rede.

Isso evita que o serviço que chama desperdice threads e conexões com uma dependência que sabidamente está indisponível.

``` mermaid-sim
stateDiagram-v2
    [*] --> Closed

    Closed --> Open : taxa de falhas passa do limite\n(ex.: > 50% de erros nas últimas 10 chamadas)
    Open --> HalfOpen : tempo de espera expira\n(ex.: 30 segundos)
    HalfOpen --> Closed : requisição de teste tem sucesso
    HalfOpen --> Open : requisição de teste falha
```

**Closed** (fechado — operação normal)
: As requisições passam. O breaker conta sucessos e falhas. Se a taxa de falhas ultrapassar o limite configurado, o breaker desarma para Open.

**Open** (aberto — falhando rápido)
: Todas as requisições são rejeitadas imediatamente com um erro — nenhuma chamada de rede é feita. Isso protege os recursos de quem chama e dá tempo para o serviço downstream se recuperar. Após um tempo de espera configurado, o breaker passa para Half-Open.

**Half-Open** (semiaberto — testando a recuperação)
: Um número limitado de requisições de teste é liberado. Se tiverem sucesso, o serviço downstream se recuperou e o breaker fecha. Se falharem, o breaker volta para Open.

### Parâmetros de configuração

| Parâmetro | Valor típico | Efeito |
|---|---|---|
| **Limite de falhas** | 50% das últimas 10–20 chamadas | Sensibilidade a falhas |
| **Tempo de espera** | 30–60 segundos | Quanto tempo o serviço tem para se recuperar |
| **Nº de testes em Half-Open** | 3–5 requisições | Com que cautela testar a recuperação |
| **Limite de chamada lenta** | 2× o P99 normal | Tratar chamadas lentas como falhas |

**Spring Boot**: a biblioteca [Resilience4j](https://resilience4j.readme.io/docs/circuitbreaker){target="_blank"}[^4] implementa todos esses padrões com as anotações `@CircuitBreaker`, `@Retry`, `@Bulkhead`, `@RateLimiter` e `@TimeLimiter` (dependência `io.github.resilience4j:resilience4j-spring-boot3` mais `spring-boot-starter-aop`).

!!! example "Circuit breaker e retry em torno da chamada ao serviço de produtos"

    === "OrderService.java"

        ```java
        @CircuitBreaker(name = "product", fallbackMethod = "priceFallback")
        @Retry(name = "product")
        public ProductOut findProduct(String id) {
            return productController.findById(id).getBody();   // Feign call
        }

        // Same signature + the exception. Called when the call fails
        // or when the breaker is open (CallNotPermittedException).
        private ProductOut priceFallback(String id, Throwable t) {
            throw new ResponseStatusException(
                HttpStatus.SERVICE_UNAVAILABLE, "catalogue unavailable, try again later");
        }
        ```

    === "application.yaml"

        ```yaml
        resilience4j:
          circuitbreaker:
            instances:
              product:
                sliding-window-size: 10                  # last 10 calls
                failure-rate-threshold: 50               # % → Open
                slow-call-duration-threshold: 2s         # slow = failure
                wait-duration-in-open-state: 30s         # Open → Half-Open
                permitted-number-of-calls-in-half-open-state: 3
          retry:
            instances:
              product:
                max-attempts: 3                          # 1 call + 2 retries
                wait-duration: 500ms
                enable-exponential-backoff: true         # 500 ms, 1 s, ...
                exponential-backoff-multiplier: 2
        ```

    O estado do breaker é exportado como métrica (`resilience4j_circuitbreaker_state`) pelo Actuator, então você pode exibi-lo em um gráfico no Grafana ([Hands-on 6](../../../hands-on/6/index.md)).

A simulação abaixo mostra o circuit breaker percorrendo os três estados à medida que a taxa de falhas muda:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

rng = np.random.default_rng(42)
steps = 60
state = "Closed"
failure_window = []
window_size = 10
threshold = 0.5
wait_steps = 10
half_open_at = None
probe_allowed = False

states, rates = [], []

for t in range(steps):
    # inject failures: high in t=15..29, recover at t=40
    if 15 <= t < 30:
        success = rng.random() > 0.75  # 75% failure
    elif t >= 40:
        success = rng.random() > 0.05  # 5% failure (recovered)
    else:
        success = rng.random() > 0.1   # 10% failure (normal)

    if state == "Closed":
        failure_window.append(0 if success else 1)
        if len(failure_window) > window_size:
            failure_window.pop(0)
        rate = sum(failure_window) / len(failure_window) if failure_window else 0
        if rate > threshold and len(failure_window) >= window_size:
            state = "Open"
            half_open_at = t + wait_steps
    elif state == "Open":
        rate = 1.0
        if t >= half_open_at:
            state = "Half-Open"
            probe_allowed = True
    elif state == "Half-Open":
        rate = sum(failure_window) / len(failure_window) if failure_window else 0
        if probe_allowed:
            probe_allowed = False
            if success:
                state = "Closed"
                failure_window = []
            else:
                state = "Open"
                half_open_at = t + wait_steps

    states.append(state)
    rates.append(rate)

color_map = {"Closed": "steelblue", "Open": "tomato", "Half-Open": "goldenrod"}
colors = [color_map[s] for s in states]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 4), sharex=True)

ax1.bar(range(steps), [1 - r for r in rates], color=colors, alpha=0.85)
ax1.set_ylabel("Success rate")
ax1.set_ylim(0, 1.1)
ax1.set_title("Circuit Breaker Simulation", fontweight="bold")

for i, (s, c) in enumerate(zip(states, colors)):
    ax2.barh(0, 1, left=i, color=c, alpha=0.9, height=0.6)
ax2.set_xlim(0, steps)
ax2.set_yticks([])
ax2.set_xlabel("Time step")
ax2.set_ylabel("State")

legend = [mpatches.Patch(color=v, label=k) for k, v in color_map.items()]
ax2.legend(handles=legend, loc="upper right", fontsize=8)

plt.tight_layout()
from io import StringIO
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

---

## Fallback e degradação graciosa { #fallback-and-graceful-degradation }

Falhar rápido é melhor do que travar, mas um erro continua sendo um erro. Um **fallback** é o que quem chama faz *no lugar* quando uma chamada falha ou o breaker está aberto. O objetivo é a **degradação graciosa**: perder uma funcionalidade, não a página inteira.

| Dependência fora do ar | Fallback possível na loja |
|---|---|
| Serviço de recomendações | Mostrar a lista de "mais vendidos" em cache no Redis ([Hands-on 8](../../../hands-on/8/index.md)) |
| Serviço de produtos, para leituras | Servir os últimos dados de produto em cache, marcados como possivelmente desatualizados |
| Serviço de notificações | Publicar o pedido de e-mail no Kafka e enviá-lo depois ([Arquitetura Orientada a Eventos](../../event_driven/index.md)) |
| Serviço de pagamento | Não há fallback seguro: responder `503` rapidamente com uma mensagem clara — nunca fingir que o pagamento deu certo |

!!! warning "Um fallback precisa ser seguro e simples"
    Um fallback que chama outro serviço remoto também pode falhar (e precisa da própria proteção). E algumas operações — cobrar um cartão, reservar estoque — **não** podem ser simuladas: falhar de forma clara é o comportamento degradado correto.

---

## Bulkhead { #bulkhead }

O padrão bulkhead — nome que vem dos compartimentos estanques do casco de um navio — **isola recursos por dependência**. Em vez de compartilhar um único pool de threads entre todas as chamadas downstream, cada dependência ganha seu próprio pool.

``` mermaid-sim
flowchart TD
    gateway --> poolA["Pool de threads A\n(máx. 10 threads)"]
    gateway --> poolB["Pool de threads B\n(máx. 10 threads)"]
    poolA --> payment["Serviço de pagamento\n(degradado ⚠️)"]:::slow
    poolB --> inventory["Serviço de estoque\n(saudável ✓)"]:::ok

    classDef slow fill:#f90,color:#000
    classDef ok fill:#6c6,color:#fff
```

Se o serviço de pagamento degradar e ocupar as 10 threads do Pool A, o Pool B não é afetado em nada. O serviço de estoque continua atendendo requisições a toda velocidade. Sem bulkheads, uma única dependência lenta satura o pool compartilhado e degrada todas as outras chamadas por igual.

O custo dos bulkheads é o consumo extra de recursos: dez pools separados de 10 threads cada usam mais memória do que um pool de 100 threads. Para dependências do caminho crítico, esse trade-off quase sempre compensa.

O Resilience4j oferece dois tipos de bulkhead: o bulkhead de **semáforo** (`max-concurrent-calls`, limita quantas threads podem estar dentro da chamada ao mesmo tempo — barato, é o padrão) e o bulkhead de **pool de threads** (a chamada roda em um pool dedicado). A mesma ideia vale fora da JVM: pools de conexões de banco separados por workload, ou deployments separados no Kubernetes para tráfego crítico e não crítico.

---

## Rate limiting { #rate-limiting }

O rate limiting (limitação de taxa) restringe o número de requisições que um cliente (ou o sistema) pode fazer dentro de uma janela de tempo, protegendo os serviços de picos de tráfego e de clientes abusivos.

### Algoritmo token bucket

O **token bucket** (balde de fichas) é o algoritmo de rate limiting mais comum. Ele modela um balde que se enche de fichas (tokens) a uma taxa constante; cada requisição consome uma ficha; requisições que chegam com o balde vazio são rejeitadas ou enfileiradas.

``` mermaid-sim
flowchart LR
    refill["Fonte de tokens\n(reposição: 100 req/s)"] -->|adiciona tokens| bucket["Token Bucket\n(capacidade: 200)"]
    request["Requisição\nde entrada"] -->|consome 1 token| bucket
    bucket -->|há tokens| allowed["✓ Permitida"]
    bucket -->|balde vazio| rejected["✗ 429 Too Many Requests"]
```

| Propriedade | Efeito |
|---|---|
| **Taxa de reposição** | Vazão máxima em regime permanente |
| **Capacidade do balde (burst)** | Quanto tráfego instantâneo acima da taxa é tolerado |

Uma capacidade de balde maior que a taxa de reposição permite rajadas curtas e ainda assim impõe uma média de longo prazo. O filtro `RequestRateLimiter` do Spring Cloud Gateway (apoiado no Redis) e o AWS API Gateway usam token bucket. O `limit_req` do Nginx usa o **leaky bucket** (balde furado), muito parecido: as requisições escoam a uma taxa fixa e o parâmetro `burst` define quantas podem esperar na fila.

!!! example "Rate limiting na borda da loja (Nginx)"

    ```nginx
    # 10 requests/s per client IP, bursts of up to 20 queued requests
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    server {
        location / {
            limit_req zone=api burst=20 nodelay;
            limit_req_status 429;
            proxy_pass http://gateway;
        }
    }
    ```

    Isso se encaixa na frente das réplicas do gateway do [Hands-on 7](../../../hands-on/7/index.md). Limites por **usuário** ou por **chave de API** (em vez de por IP) costumam ser aplicados no gateway, onde a identidade autenticada é conhecida.

---

## Health checks { #health-checks }

Endpoints de health check permitem que orquestradores (Kubernetes, Docker Compose, balanceadores de carga) detectem instâncias com falha e parem de rotear tráfego para elas antes que os clientes percebam.

Dois tipos distintos servem a propósitos diferentes:

**Liveness**
: *O processo está vivo?* Retorna `200 OK` se a aplicação está rodando e não está em deadlock. Se uma verificação de liveness falha, o orquestrador **reinicia** o container.

**Readiness**
: *O serviço está pronto para receber tráfego?* Retorna `200 OK` só se a instância terminou de iniciar e consegue fazer trabalho útil (por exemplo, seu próprio banco de dados está acessível). Se uma verificação de readiness falha, o orquestrador **remove a instância do pool do balanceador de carga** sem reiniciá-la.

**Startup** (Kubernetes)
: *A aplicação terminou de iniciar?* As verificações de liveness e readiness só rodam depois que ela tem sucesso, para que uma JVM de inicialização lenta não seja morta durante o boot.

``` mermaid-sim
flowchart LR
    lb["Balanceador de carga"] -->|"GET /actuator/health/readiness"| svc["Instância do serviço"]
    svc -->|200 OK| lb
    lb -->|roteia tráfego| svc

    svc2["Instância do serviço\n(conexão com o banco perdida)"]
    lb -->|"GET /actuator/health/readiness"| svc2
    svc2 -->|503 DOWN| lb
    lb -->|removida do pool| svc2:::failed

    classDef failed fill:#f66,color:#fff
```

O Spring Boot Actuator expõe ambos em `/actuator/health/liveness` e `/actuator/health/readiness`. Eles são habilitados automaticamente quando a aplicação detecta que roda no Kubernetes; em outros ambientes (por exemplo, Docker Compose), defina `management.endpoint.health.probes.enabled=true`. Por padrão, eles refletem apenas o estado interno da aplicação; inclua uma dependência na readiness explicitamente, por exemplo `management.endpoint.health.group.readiness.include=readinessState,db`.

!!! example "Probes do serviço de pedidos no Kubernetes"

    ```yaml
    # inside the container spec of the Deployment
    startupProbe:
      httpGet: { path: /actuator/health/liveness, port: 8080 }
      failureThreshold: 30        # up to 30 × 5 s = 150 s to start
      periodSeconds: 5
    livenessProbe:
      httpGet: { path: /actuator/health/liveness, port: 8080 }
      periodSeconds: 10
    readinessProbe:
      httpGet: { path: /actuator/health/readiness, port: 8080 }
      periodSeconds: 5
    ```

    Veja o [Hands-on 5](../../../hands-on/5/index.md) para os Deployments aos quais essas probes pertencem.

!!! danger "Nunca coloque dependências externas na verificação de liveness"
    Se a liveness verifica o banco de dados e o banco oscila, o Kubernetes **reinicia todas as réplicas ao mesmo tempo** — transformando um soluço de 10 segundos no banco em uma indisponibilidade total enquanto todas as JVMs sobem de novo. A liveness deve responder apenas "este processo está travado?". Tome cuidado até com a readiness: se todas as réplicas dependem do mesmo banco, todas ficam não prontas juntas e o serviço desaparece, em vez de retornar erros claros.

---

## Defesa em profundidade

Esses padrões são combinados em camadas, não escolhidos isoladamente. Uma cadeia de chamadas de nível de produção combina todos eles:

``` mermaid-sim
flowchart LR
    client --> rl["Rate Limiter\n(protege o serviço)"]
    rl --> cb["Circuit Breaker\n(falha rápido em deps abertas)"]
    cb --> bh["Bulkhead\n(isola o pool de threads)"]
    bh --> to["Timeout\n(limita a espera)"]
    to --> retry["Retry + Backoff\n(trata transitórias)"]
    retry --> downstream[Serviço downstream]
```

Cada camada trata um cenário de falha diferente:

| Camada | O que trata |
|---|---|
| Rate limiter | Picos de tráfego, clientes abusivos |
| Circuit breaker | Dependências que sabidamente estão falhando |
| Bulkhead | Dependências lentas contaminando outras chamadas |
| Timeout | Espera sem limite |
| Retry + backoff | Erros transitórios |

!!! info "A ordem é uma decisão de projeto"
    O diagrama mostra uma organização conceitual comum. As bibliotecas fazem suas próprias escolhas: na integração do Resilience4j com o Spring Boot, a ordem padrão dos aspectos é `Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) )` — o retry é a camada **mais externa**, então cada tentativa é contabilizada pelo circuit breaker e um breaker aberto faz as tentativas restantes falharem imediatamente. Qualquer que seja a ordem, verifique que os retries não contornam o breaker e que a soma de timeouts × tentativas cabe no prazo de quem chama.

---

## Conexões

- [Hands-on 1](../../../hands-on/1/index.md) — os clientes Feign que precisam de timeouts e breakers.
- [Hands-on 7](../../../hands-on/7/index.md) — o Nginx na frente do gateway, onde fica o rate limiting de borda.
- [Hands-on 9](../../../hands-on/9/index.md) — retries e dead letter queues para consumidores assíncronos.
- [SLI / SLO / SLA](../sli-slo-sla/index.md) — o orçamento que esses padrões protegem.

## Pontos-chave

- Toda chamada remota precisa de um **timeout** (connect + read), escolhido por dependência e dentro do orçamento de quem chama.
- Faça **retry** só de falhas transitórias e operações idempotentes, com **backoff exponencial e full jitter**, em uma única camada; use **chaves de idempotência** para tornar um `POST` seguro.
- Um **circuit breaker** (Closed → Open → Half-Open) falha rápido diante de uma dependência que sabidamente está fora do ar; combine-o com um **fallback** seguro.
- **Bulkheads** impedem que uma dependência lenta consuma todas as threads ou conexões; o **rate limiting** (token / leaky bucket) protege o serviço do excesso de tráfego.
- **Liveness** reinicia, **readiness** remove do balanceador de carga; nunca verifique dependências externas na liveness.
- Os padrões são combinados em camadas; sua ordem e a soma dos timeouts precisam ser projetadas e depois verificadas com [experimentos de caos](../chaos/index.md).

---

[^1]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^2]: BROOKER, M. [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/){target="_blank"}. AWS Architecture Blog, 2015.
[^3]: FOWLER, M. [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html){target="_blank"}. martinfowler.com, 2014.
[^4]: [Documentação do Resilience4j](https://resilience4j.readme.io/docs){target="_blank"}.
