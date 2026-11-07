Quando um serviço downstream degrada ou falha, o comportamento ingênuo padrão — continuar enviando requisições e esperar uma resposta — produz, com toda a certeza, falhas em cascata. As threads do serviço que chama ficam bloqueadas, sua fila enche e a falha se propaga para cima, até clientes que nada tinham a ver com a dependência quebrada.

Padrões de resiliência são decisões de projeto que interrompem essa propagação. Eles não evitam falhas; eles **limitam até onde uma falha se espalha** pelo sistema[^1].

``` mermaid-sim
flowchart LR
    client --> gateway
    gateway -->|"timeout<br/>circuit breaker<br/>bulkhead"| downstream["downstream<br/>(lento)"]
    gateway -->|"falha rápida<br/>ou fallback"| client
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
    G-->>-C: 504 Gateway Timeout
    P-->>-G: (resposta chega atrasada — descartada)
```

### Escolhendo os valores de timeout

- **Baseado em percentis**: defina o timeout na latência P99.9 do serviço downstream em condições normais. Qualquer coisa mais lenta que isso já é anormal.
- **Consciente do orçamento**: se a chamada de cima tem seu próprio timeout de 1 s, todas as chamadas downstream dentro daquela requisição — retries e suas esperas incluídos — precisam terminar, somadas, bem abaixo de 1 s.
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

### O orçamento de timeout entre saltos { #the-timeout-budget-across-hops }

Timeouts se aninham: cada salto precisa terminar dentro do prazo do salto que o chamou. Suponha que o gateway espere no máximo **3 s** pelo serviço de pedidos e que o serviço de pedidos chame o de produtos com as configurações desta página: read timeout de 1 s, 3 tentativas, esperas de 0,5 s e 1 s. No pior caso o serviço de pedidos precisa de 1 + 0,5 + 1 + 1 + 1 = **4,5 s** — mais do que alguém espera por ele.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant G as Gateway (espera 3 s)
    participant O as Serviço de pedidos
    participant P as Serviço de produtos (lento)
    C->>G: POST /orders
    G->>O: POST /orders
    O->>P: tentativa 1
    Note over O: read timeout em 1 s, depois espera 0,5 s
    O->>P: tentativa 2
    Note over O: read timeout em 2,5 s, depois espera 1 s
    Note over G: 3 s se passaram: desiste
    G-->>C: 504 Gateway Timeout
    O->>P: tentativa 3 (ninguém espera por ela)
    Note over O: falha em 4,5 s: trabalho e carga desperdiçados
```

Faça o orçamento de dentro caber no de fora: 2 tentativas (1 + 0,5 + 1 = 2,5 s), um read timeout menor ou um prazo enviado junto com a requisição, para que cada salto saiba quanto tempo resta (o gRPC faz isso com *deadlines*).

!!! warning "Timeouts são só o primeiro passo"
    Sozinho, um timeout apenas converte um travamento em um erro rápido. Combine-o com uma política de retry (abaixo) para falhas transitórias e com um circuit breaker e um fallback para indisponibilidades mais longas.

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

em que $n$ conta os retries a partir de 0 (a espera antes do primeiro retry é $c$):

| Antes do retry | Fórmula | Espera (c = 1 s, max_wait = 16 s) | Tempo desde a primeira falha |
|---|---|---|---|
| 1º ($n$ = 0) | $1 \cdot 2^0$ | 1 s | 1 s |
| 2º ($n$ = 1) | $1 \cdot 2^1$ | 2 s | 3 s |
| 3º ($n$ = 2) | $1 \cdot 2^2$ | 4 s | 7 s |
| 4º ($n$ = 3) | $1 \cdot 2^3$ | 8 s | 15 s |
| 5º ($n$ = 4) | $1 \cdot 2^4$ | 16 s (atinge o `max_wait`) | 31 s |
| 6º em diante | limitado | 16 s | +16 s cada |

### Jitter

Mesmo com backoff exponencial, clientes que falharam todos no mesmo instante farão retry nos mesmos instantes — uma onda sincronizada de retries. Adicionar um **jitter** aleatório quebra essa sincronização:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right) + \text{random}(0,\ \text{jitter\_cap})
$$

A análise de Marc Brooker na AWS[^2] comparou diversas variantes e recomenda o **full jitter**, que torna aleatória a espera *inteira*, em vez de somar uma pequena quantidade aleatória:

$$
\text{wait}_n = \text{random}\left(0,\ \min\left(c \cdot 2^n,\ \text{max\_wait}\right)\right)
$$

Com 1.000 clientes falhando no mesmo instante, o full jitter espalha os retries uniformemente pelo intervalo, em vez de enviar 1.000 requisições exatamente em t = 1 s, 3 s e 7 s. (Brooker achou o full jitter e o jitter "decorrelacionado" muito melhores do que nenhum; o full jitter é o mais simples.)

``` mermaid-sim
sequenceDiagram
    participant C as 1.000 clientes
    participant S as Serviço de produtos (recém-reiniciado)
    Note over C,S: backoff sem jitter
    C->>S: t = 0 s: 1.000 requisições falham juntas
    C->>S: t = 1 s: 1.000 retries no mesmo milissegundo
    S-->>C: sobrecarregado de novo: 503 para a maioria
    C->>S: t = 3 s: a mesma onda, de novo
    Note over C,S: backoff com full jitter
    C->>S: retries espalhados entre 0 e 1 s: cerca de 1 por milissegundo
    S-->>C: uma carga constante que ele absorve: 200 OK
```

### O que repetir — e o que não repetir

| Resposta | Retry? | Por quê |
|---|---|---|
| Conexão recusada, conexão resetada, timeout | Sim | Falha transitória típica |
| `503 Service Unavailable`, `429 Too Many Requests` | Sim, com backoff (respeite o `Retry-After`, se houver) | O servidor está pedindo que você volte mais tarde |
| `500 Internal Server Error` | Talvez, uma vez | Muitas vezes é um bug que vai falhar de novo |
| `400`, `401`, `403`, `404`, `422` | Não | A própria requisição está errada; repetir não resolve |

!!! warning "Amplificação de retries"
    Retries multiplicam a carga exatamente quando o sistema está mais fraco. Se o gateway, o serviço de pedidos e o cliente de produtos fizerem até 3 tentativas cada, um clique do usuário pode virar 3 × 3 × 3 = **27** chamadas a um serviço de produtos que já está com dificuldades. Faça retry em **uma** camada apenas (normalmente a mais próxima da dependência que falha), limite o número de tentativas e pare de repetir quando o circuit breaker estiver aberto.

``` mermaid-sim
flowchart LR
    U["1 clique"] --> G["gateway<br/>3 tentativas"]
    G -->|"3 chamadas"| O["serviço de pedidos<br/>3 tentativas cada"]
    O -->|"9 chamadas"| F["cliente Feign<br/>3 tentativas cada"]
    F -->|"27 chamadas"| P["serviço de produtos<br/>(já com dificuldades)"]
```

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

O circuit breaker[^3] recebe esse nome por analogia com o disjuntor elétrico: quando a carga ultrapassa os limites seguros, o disjuntor desarma e interrompe o circuito. Em software, quando a taxa de falhas das chamadas a um serviço downstream atinge um limite, o circuit breaker *abre* e rejeita imediatamente as chamadas para aquele serviço — sem sequer tentar a chamada de rede.

Isso evita que o serviço que chama desperdice threads e conexões com uma dependência que sabidamente está indisponível.

``` mermaid-sim
stateDiagram-v2
    [*] --> Closed
    Closed --> Open : 50% ou mais das últimas 10 chamadas falharam ou foram lentas
    Open --> HalfOpen : 30 s em Open, depois a próxima chamada
    HalfOpen --> Closed : as 3 chamadas de teste ficam abaixo dos limites
    HalfOpen --> Open : os testes falham ou são lentos de novo
```

**Closed** (fechado — operação normal)
: As requisições passam. O breaker registra o resultado das últimas chamadas (uma janela deslizante). Quando há chamadas suficientes registradas, se a fração que falhou — ou que foi mais lenta que um limite — atingir a taxa configurada, o breaker desarma para Open.

**Open** (aberto — falhando rápido)
: Todas as requisições são rejeitadas imediatamente com um erro (`CallNotPermittedException` no Resilience4j) — nenhuma chamada de rede é feita. Isso protege os recursos de quem chama e dá tempo para o serviço downstream se recuperar. Após o tempo de espera configurado, o breaker passa para Half-Open.

**Half-Open** (semiaberto — testando a recuperação)
: Um número limitado de chamadas de teste é liberado; qualquer outra chamada continua rejeitada. Quando os testes terminam, o breaker calcula as taxas de falha e de chamadas lentas deles: abaixo dos limites, a dependência se recuperou e o breaker fecha; caso contrário, volta para Open por mais uma espera.

A sequência abaixo reproduz um ciclo com a configuração do exemplo mais adiante:

``` mermaid-sim
sequenceDiagram
    participant O as Serviço de pedidos
    participant B as Breaker (product)
    participant P as Serviço de produtos
    Note over B: Closed
    O->>B: findProduct
    B->>P: GET /products/42
    P--xB: sem resposta: read timeout depois de 1 s
    Note over B: 5 das últimas 10 chamadas falharam: Open
    O->>B: findProduct
    B-->>O: CallNotPermittedException em menos de 1 ms
    Note over B: 30 s depois, a próxima chamada: Half-Open
    O->>B: findProduct (teste 1 de 3)
    B->>P: GET /products/42
    P-->>B: 200 OK em 50 ms
    Note over B: 3 testes rápidos e OK: Closed
```

### Parâmetros de configuração

| Parâmetro (propriedade do Resilience4j) | Padrão | Valor típico | Efeito |
|---|---|---|---|
| **Limite de falhas** (`failure-rate-threshold`) | 50% | 50% | Fração de chamadas com falha na janela que abre o breaker |
| **Janela** (`sliding-window-size`, `minimum-number-of-calls`) | 100 chamadas, 100 | 10–20 chamadas | Quantas chamadas recentes são julgadas; nenhuma decisão antes do mínimo |
| **Chamadas lentas** (`slow-call-duration-threshold`, `slow-call-rate-threshold`) | 60 s, 100% | abaixo do timeout, 50% | Chamadas lentas também abrem o breaker, antes de estourarem o timeout |
| **Espera em Open** (`wait-duration-in-open-state`) | 60 s | 10–60 s | Quanto tempo a dependência tem para se recuperar |
| **Testes em Half-Open** (`permitted-number-of-calls-in-half-open-state`) | 10 | 3–5 | Com que cautela testar a recuperação |

Os padrões são conservadores: com uma janela de 100 chamadas, o breaker de um serviço que recebe 1 chamada por segundo precisa de bem mais de um minuto para decidir. Chamadas lentas são julgadas pela própria taxa — com o padrão de 100%, elas só abrem o breaker quando *todas* as chamadas da janela são lentas.

**Spring Boot**: a biblioteca [Resilience4j](https://resilience4j.readme.io/docs/circuitbreaker){target="_blank"}[^4] implementa todos esses padrões com as anotações `@CircuitBreaker`, `@Retry`, `@Bulkhead`, `@RateLimiter` e `@TimeLimiter`. Com o Spring Boot 4 (a versão dos hands-on), as dependências são `io.github.resilience4j:resilience4j-spring-boot4` e `spring-boot-starter-aspectj`; com o Spring Boot 3 eram `resilience4j-spring-boot3` e `spring-boot-starter-aop`.

!!! example "Circuit breaker e retry em torno da chamada ao serviço de produtos"

    === "OrderService.java"

        ```java
        // Resilience4j's default order: Retry ( CircuitBreaker ( call ) ).
        // The fallback sits on the OUTERMOST layer, so it runs once: after
        // the retries are exhausted, or at once when the breaker is open.
        @Retry(name = "product", fallbackMethod = "priceFallback")
        @CircuitBreaker(name = "product")
        public ProductOut findProduct(String id) {
            return productController.findById(id).getBody();   // Feign call
        }

        // Same signature + the exception.
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
                sliding-window-size: 10                  # the last 10 calls
                minimum-number-of-calls: 10              # judge only after 10 calls
                failure-rate-threshold: 50               # >= 50% failed → Open
                slow-call-duration-threshold: 500ms      # slower than this = slow (below the 1 s timeout)
                slow-call-rate-threshold: 50             # >= 50% slow → Open
                wait-duration-in-open-state: 30s         # Open → Half-Open
                permitted-number-of-calls-in-half-open-state: 3
          retry:
            instances:
              product:
                max-attempts: 3                          # 1 call + 2 retries
                wait-duration: 500ms
                enable-exponential-backoff: true
                exponential-backoff-multiplier: 2        # 500 ms, then 1 s
                enable-randomized-wait: true
                randomized-wait-factor: 0.5              # each wait ± 50% (jitter)
                retry-exceptions:
                  - feign.RetryableException             # timeouts and connection errors
                  - feign.FeignException$ServiceUnavailable   # 503
                ignore-exceptions:
                  - io.github.resilience4j.circuitbreaker.CallNotPermittedException  # breaker open: fail fast
        ```

    O estado do breaker é exportado como métrica (`resilience4j_circuitbreaker_state`) pelo Actuator, então você pode exibi-lo em um gráfico no Grafana ([Hands-on 6](../../../hands-on/6/index.md)).

Três detalhes dessa configuração importam. O limite de chamada lenta (500 ms) fica **abaixo** do read timeout (1 s): uma chamada mais lenta que o timeout nunca termina, então um limite acima dele nunca veria uma chamada lenta. O retry lista as exceções que vale a pena repetir e **ignora** a `CallNotPermittedException`: com o breaker aberto não há o que esperar. E o fallback fica no `@Retry`, a anotação externa: colocado no `@CircuitBreaker`, ele rodaria *dentro* do retry e transformaria cada falha na exceção do fallback antes que o retry a visse — então o retry repetiria o fallback (se repetisse tudo) ou nunca repetiria nada.

### Experimente: um serviço de produtos lento { #play-it-a-slow-product-service }

O simulador coloca o serviço de pedidos da [visão geral](../index.md#falhas-em-cascata) — 200 threads, 60 pedidos por segundo — diante de um serviço de produtos que degrada por um minuto e deixa você ligar o timeout, o retry e o breaker da configuração acima.

<div class="csim" data-sim="slow-dependency" data-fault="slow" data-latency="3000"></div>

!!! tip "Experimente"
    Sem nenhum padrão, as chamadas de 3 segundos mantêm cerca de **176** threads ocupadas (lei de Little: 60 × 3 s = 180) e o pool chega às 200 threads em **8** dos 60 segundos: só **98,4%** dos `GET /orders` dão certo, embora nunca chamem o product. Ligue o **timeout**: cerca de **60** threads (60 × 1 s) e os `GET /orders` voltam a **100%** — mas agora todo pedido falha depois de 1 s. Acrescente o **retry**: cada pedido prende sua thread por até 4,5 s, o pool fica cheio durante **51** segundos, só **71,2%** dos `GET /orders` dão certo e o product recebe **128** chamadas por segundo em vez de 60 — pior do que nenhum padrão. Acrescente o **breaker**: ele abre **1,1 s** depois do início da falha, os pedidos falham em menos de um milissegundo, cerca de **2** threads ficam ocupadas, os testes de 41 s falham e o breaker fecha em t = **72,2 s**, 2,2 s depois que o product se recupera. Depois escolha **product fora**: com timeout e retry mas sem breaker, o product recebe **3,0** chamadas por pedido enquanto recusa todas.

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
    gateway --> poolA["Bulkhead A<br/>(máx. 10 chamadas simultâneas)"]
    gateway --> poolB["Bulkhead B<br/>(máx. 10 chamadas simultâneas)"]
    poolA --> payment["Serviço de pagamento<br/>(degradado ⚠️)"]
    poolB --> inventory["Serviço de estoque<br/>(saudável ✅)"]
```

Se o serviço de pagamento degradar e ocupar as 10 vagas do Bulkhead A, o Bulkhead B não é afetado em nada. O serviço de estoque continua atendendo requisições a toda velocidade. Sem bulkheads, uma única dependência lenta satura o pool compartilhado e degrada todas as outras chamadas por igual. Passo a passo, com as 200 threads do serviço de pedidos:

``` mermaid-sim
sequenceDiagram
    participant O as Serviço de pedidos (200 threads)
    participant A as Bulkhead pagamento (10)
    participant P as Pagamento (lento)
    participant I as Estoque
    O->>A: cobrança (chamadas 1 a 10)
    A->>P: 10 chamadas esperando 3 s cada
    O->>A: cobrança (chamada 11)
    A-->>O: BulkheadFullException na hora, fallback 503
    O->>I: reserva de estoque (o bulkhead dele tem vaga)
    I-->>O: 200 OK em 30 ms
    Note over O,I: o pagamento prende no máximo 10 threads, as outras 190 seguem trabalhando
```

O custo dos bulkheads é a **capacidade que não pode ser compartilhada**: com dez pools de 10, uma rajada em uma dependência é recusada em 10 chamadas simultâneas mesmo com as outras 90 vagas ociosas, enquanto um pool único de 100 a teria absorvido. Dimensionar cada bulkhead é o trabalho (lei de Little de novo: chamadas por segundo × latência normal, mais uma folga). Para dependências do caminho crítico, esse trade-off quase sempre compensa.

O Resilience4j oferece dois tipos de bulkhead: o bulkhead de **semáforo** (`max-concurrent-calls`, padrão 25, limita quantas threads podem estar dentro da chamada ao mesmo tempo — barato, é o padrão; `max-wait-duration: 0` rejeita na hora quando está cheio) e o bulkhead de **pool de threads** (a chamada roda em um pool dedicado). A mesma ideia vale fora da JVM: pools de conexões de banco separados por workload, ou deployments separados no Kubernetes para tráfego crítico e não crítico.

---

## Rate limiting { #rate-limiting }

O rate limiting (limitação de taxa) restringe o número de requisições que um cliente (ou o sistema) pode fazer dentro de uma janela de tempo, protegendo os serviços de picos de tráfego e de clientes abusivos.

### Algoritmo token bucket

O **token bucket** (balde de fichas) é o algoritmo de rate limiting mais comum. Ele modela um balde que se enche de fichas (tokens) a uma taxa constante; cada requisição consome uma ficha; requisições que chegam com o balde vazio são rejeitadas ou enfileiradas.

``` mermaid-sim
flowchart LR
    refill["Fonte de tokens<br/>(reposição: 100 req/s)"] -->|adiciona tokens| bucket["Token Bucket<br/>(capacidade: 200)"]
    request["Requisição<br/>de entrada"] -->|consome 1 token| bucket
    bucket -->|há tokens| allowed["✅ Permitida"]
    bucket -->|balde vazio| rejected["❌ 429 Too Many Requests"]
```

| Propriedade | Efeito |
|---|---|
| **Taxa de reposição** | Vazão máxima em regime permanente |
| **Capacidade do balde (burst)** | Quanto tráfego instantâneo acima da taxa é tolerado |

Uma capacidade de balde maior que a taxa de reposição permite rajadas curtas e ainda assim impõe uma média de longo prazo. O filtro `RequestRateLimiter` do Spring Cloud Gateway (apoiado no Redis) e o AWS API Gateway usam token bucket. O `limit_req` do Nginx usa o **leaky bucket** (balde furado), muito parecido: as requisições escoam a uma taxa fixa e o parâmetro `burst` define quantas podem esperar na fila.

!!! example "Rate limiting na borda da loja (Nginx)"

    ```nginx
    # 10 requests/s per client IP; up to 20 extra requests of a burst are
    # served at once (nodelay) and their slots free up at 10/s; beyond that, 429
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

A sequência reproduz uma oscilação de 10 segundos no banco em um pod cuja readiness inclui o banco e cuja liveness não inclui:

``` mermaid-sim
sequenceDiagram
    participant K as Kubernetes
    participant P as pod do order
    participant D as Postgres
    Note over D: oscilação: inacessível por 10 s
    K->>P: GET /actuator/health/readiness
    P-->>K: 503 DOWN (db)
    Note over K: tira o pod do Service, sem reiniciar
    K->>P: GET /actuator/health/liveness
    P-->>K: 200 UP (o processo está bem)
    Note over D: acessível de novo
    K->>P: GET /actuator/health/readiness
    P-->>K: 200 UP
    Note over K: o pod volta a receber tráfego
```

O Spring Boot Actuator expõe ambos em `/actuator/health/liveness` e `/actuator/health/readiness`. No Spring Boot 4 (a versão dos hands-on) esses grupos de probes vêm habilitados por padrão, em qualquer ambiente; do Spring Boot 2.3 ao 3.x eram automáticos só no Kubernetes e, em outros ambientes (por exemplo, Docker Compose), era preciso definir `management.endpoint.health.probes.enabled=true`. Por padrão, eles refletem apenas o estado interno da aplicação; inclua uma dependência na readiness explicitamente, por exemplo `management.endpoint.health.group.readiness.include=readinessState,db`.

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
    client --> rl["Rate limiter<br/>na borda (Nginx, gateway)"]
    rl --> retry
    subgraph order["serviço de pedidos, em volta de cada chamada ao product"]
        retry["Retry + backoff<br/>(mais externo)"] --> cb["Circuit breaker<br/>(conta cada tentativa)"]
        cb --> bh["Bulkhead<br/>(limita as threads no product)"]
        bh --> to["Timeout<br/>(limita cada tentativa)"]
    end
    to --> downstream["serviço de produtos"]
```

Cada camada trata um cenário de falha diferente:

| Camada, da mais externa | O que trata | Por que nesta posição |
|---|---|---|
| Rate limiter (de entrada) | Picos de tráfego, clientes abusivos | Recusa o trabalho em excesso antes que ele custe algo |
| Retry + backoff | Erros transitórios | Fora do breaker: um breaker aberto interrompe os retries na hora |
| Circuit breaker | Dependências que sabidamente estão falhando | Vê cada tentativa, timeouts incluídos, como uma chamada a julgar |
| Bulkhead | Dependências lentas contaminando outras chamadas | Limita as threads que as tentativas podem prender |
| Timeout | Espera sem limite | Mais interno: limita cada tentativa, não a soma |

!!! info "A ordem é uma decisão de projeto"
    Essa é a ordem da integração do Resilience4j com o Spring Boot, cuja ordem padrão dos aspectos é `Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) )` (aqui o read timeout do Feign faz o papel do time limiter, dentro da chamada). O handler de resiliência padrão da Microsoft para o `HttpClient` do .NET empilha do mesmo jeito: rate limiter → timeout total → retry → circuit breaker → timeout por tentativa[^5]. Qualquer que seja a biblioteca, verifique que os retries não contornam o breaker e que tentativas × timeout + esperas cabem no prazo de quem chama ([o orçamento de timeout](#the-timeout-budget-across-hops)).

---

## Conexões

- [Hands-on 1](../../../hands-on/1/index.md) — os clientes Feign que precisam de timeouts e breakers.
- [Hands-on 7](../../../hands-on/7/index.md) — o Nginx na frente do gateway, onde fica o rate limiting de borda.
- [Hands-on 10](../../../hands-on/10/index.md) — retries e dead letter queues para consumidores assíncronos.
- [SLI / SLO / SLA](../sli-slo-sla/index.md) — o orçamento que esses padrões protegem.

## Pontos-chave

- Toda chamada remota precisa de um **timeout** (connect + read), escolhido por dependência e dentro do orçamento de quem chama — tentativas × timeout + esperas incluídos.
- Faça **retry** só de falhas transitórias e operações idempotentes, com **backoff exponencial e full jitter**, em uma única camada; use **chaves de idempotência** para tornar um `POST` seguro.
- Um **circuit breaker** (Closed → Open → Half-Open) falha rápido diante de uma dependência que sabidamente está fora do ar ou lenta — defina o limite de chamada lenta abaixo do timeout; combine-o com um **fallback** seguro na camada mais externa.
- Um timeout com retry **sem** breaker pode ser pior do que nada: cada chamada prende sua thread em todas as tentativas e esperas e a dependência recebe várias vezes a carga.
- **Bulkheads** impedem que uma dependência lenta consuma todas as threads ou conexões; o **rate limiting** (token / leaky bucket) protege o serviço do excesso de tráfego.
- **Liveness** reinicia, **readiness** remove do balanceador de carga; nunca verifique dependências externas na liveness.
- Os padrões são combinados em camadas; sua ordem e a soma dos timeouts precisam ser projetadas e depois verificadas com [experimentos de caos](../chaos/index.md).

---

[^1]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^2]: BROOKER, M. [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/){target="_blank"}. AWS Architecture Blog, 2015.
[^3]: FOWLER, M. [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html){target="_blank"}. martinfowler.com, 2014.
[^4]: [Documentação do Resilience4j](https://resilience4j.readme.io/docs){target="_blank"}.
[^5]: MICROSOFT. [Build resilient HTTP apps: key development patterns](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience){target="_blank"}. Microsoft Learn (padrões do handler de resiliência padrão).
