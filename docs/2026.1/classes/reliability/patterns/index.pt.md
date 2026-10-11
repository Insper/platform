Quando um serviço a jusante (downstream) degrada ou falha, o comportamento ingênuo padrão — continuar enviando requisições e esperar uma resposta — produz, com toda a certeza, falhas em cascata. As threads do serviço que chama ficam bloqueadas, sua fila enche e a falha se propaga para cima, até clientes que nada tinham a ver com a dependência quebrada.

Padrões de resiliência são decisões de design que interrompem essa propagação. Eles não previnem falhas; eles **limitam o quanto uma falha se espalha** pelo sistema[^1].

``` mermaid
flowchart LR
    client --> gateway
    gateway -->|"Timeout\nCircuit Breaker\nBulkhead"| downstream:::slow
    gateway -->|"falha rápida\nou fallback"| client:::ok

    classDef slow fill:#f90,color:#000
    classDef ok fill:#6c6,color:#fff
```

Os padrões abaixo são complementares — sistemas em produção os usam combinados, e não isoladamente.

---

## Timeout

Um **timeout** é um prazo aplicado a uma chamada de saída. Se o serviço downstream não responder dentro do prazo, a chamada é abandonada e um erro é devolvido imediatamente a quem chamou.

Sem timeout, uma única dependência travada pode prender threads indefinidamente. Com timeout, o dano máximo que uma única chamada lenta pode causar é limitado.

``` mermaid
sequenceDiagram
    participant C as Cliente
    participant G as Gateway
    participant P as Serviço de pagamento

    C->>+G: POST /checkout
    G->>+P: POST /charge
    Note over P: processando...
    Note over G: prazo excedido (500 ms)
    G-->>-C: 503 Service Unavailable
    P-->>-G: (a resposta chega atrasada — descartada)
```

### Escolhendo os valores de timeout

- **Baseado em percentis**: defina o timeout na latência P99.9 do serviço downstream em condições normais. Qualquer coisa mais lenta do que isso já é anormal.
- **Consciente do orçamento**: se a chamada de cima tem seu próprio timeout de 1 s, todas as chamadas downstream dentro daquela requisição precisam terminar, somadas, bem abaixo de 1 s.
- **Diferente por dependência**: uma consulta ao banco de dados, uma API de terceiros e um microsserviço interno têm perfis de latência muito diferentes. Um único valor global de timeout está quase sempre errado.

!!! warning "Timeouts sem retries são incompletos"
    Um timeout que nunca é seguido de retry apenas transforma um travamento em um erro rápido. Combine timeouts com uma política de retry (abaixo) para tratar falhas transitórias de forma transparente.

---

## Retry com backoff exponencial

Um **retry** tenta de novo uma requisição que falhou, após um período de espera. Retries são adequados para **falhas transitórias** — oscilações breves de rede, reinícios momentâneos de serviços ou esgotamento passageiro de recursos —, em que a mesma requisição provavelmente terá sucesso numa tentativa seguinte.

``` mermaid
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

Fazer retry imediatamente após a falha é perigoso: se muitos clientes fazem retry ao mesmo tempo depois do reinício de um serviço, o pico resultante pode sobrecarregar o serviço que está se recuperando — uma *thundering herd* (manada estrondosa). O backoff exponencial espaça os retries:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right)
$$

| Tentativa | Fórmula | Espera (c = 1 s) |
|---|---|---|
| 1 | $1 \cdot 2^0$ | 1 s |
| 2 | $1 \cdot 2^1$ | 2 s |
| 3 | $1 \cdot 2^2$ | 4 s |
| 4 | $1 \cdot 2^3$ | 8 s |
| 5 | limitada ao máximo | 16 s (se máx. = 16 s) |

### Jitter

Mesmo com backoff exponencial, clientes que falharam todos no mesmo instante vão fazer retry nos mesmos instantes — uma onda sincronizada de retries. Adicionar um **jitter** aleatório quebra essa sincronização:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right) + \text{random}(0,\ \text{jitter\_cap})
$$

A AWS recomenda o *full jitter* (sortear a espera inteira, e não apenas uma fração dela)[^2] como a estratégia mais eficaz para grandes populações de clientes.

!!! danger "Não faça retry de operações não idempotentes"
    Fazer retry de um `POST /orders` que cria um novo pedido pode gerar duplicatas. Só faça retry de operações **idempotentes** (`GET`, `PUT`, `DELETE`) ou que tenham sido explicitamente projetadas para serem seguras a retries (chaves de idempotência, tokens de deduplicação).

---

## Circuit Breaker

O circuit breaker[^3] tem esse nome por analogia com o componente elétrico (o disjuntor): quando a corrente excede os limites seguros, o disjuntor desarma e interrompe o circuito. Em software, quando a taxa de falhas de um serviço downstream excede um limite, o circuit breaker *abre* e rejeita imediatamente as chamadas para esse serviço — sem sequer tentar a chamada de rede.

Isso evita que o serviço que chama desperdice threads e conexões com uma dependência que se sabe estar indisponível.

``` mermaid
stateDiagram-v2
    [*] --> Closed

    Closed --> Open : taxa de falhas excede o limite\n(ex. > 50% de erros nas últimas 10 chamadas)
    Open --> HalfOpen : o tempo de espera expira\n(ex. 30 segundos)
    HalfOpen --> Closed : a requisição de teste tem sucesso
    HalfOpen --> Open : a requisição de teste falha
```

**Closed** (fechado — operação normal)
: As requisições passam. O breaker conta sucessos e falhas. Se a taxa de falhas ultrapassa o limite configurado, o breaker desarma e vai para Open.

**Open** (aberto — falhando rápido)
: Todas as requisições são rejeitadas imediatamente com um erro — nenhuma chamada de rede é feita. Isso protege os recursos de quem chama e dá ao serviço downstream tempo para se recuperar. Após um tempo de espera configurado, o breaker passa para Half-Open.

**Half-Open** (semiaberto — testando a recuperação)
: Um número limitado de requisições de teste é liberado. Se elas tiverem sucesso, o serviço downstream se recuperou e o breaker fecha. Se falharem, o breaker volta para Open.

### Parâmetros de configuração

| Parâmetro | Valor típico | Efeito |
|---|---|---|
| **Limite de falhas** | 50% das últimas 10–20 chamadas | Sensibilidade às falhas |
| **Tempo de espera** | 30–60 segundos | Quanto tempo o serviço tem para se recuperar |
| **Requisições de teste em Half-Open** | 3–5 requisições | Com quanta cautela a recuperação é testada |
| **Limite de chamada lenta** | 2× o P99 normal | Tratar chamadas lentas como falhas |

**Spring Boot**: a biblioteca [Resilience4j](https://resilience4j.readme.io/docs/circuitbreaker){target="_blank"} implementa todos esses padrões com as anotações `@CircuitBreaker`, `@Retry` e `@Bulkhead`.

---

## Bulkhead

O padrão bulkhead — cujo nome vem dos compartimentos estanques do casco de um navio — **isola os recursos por dependência**. Em vez de compartilhar um único pool de threads entre todas as chamadas downstream, cada dependência ganha o seu próprio pool.

``` mermaid
flowchart TD
    gateway --> poolA["Pool de threads A\n(máx. 10 threads)"]
    gateway --> poolB["Pool de threads B\n(máx. 10 threads)"]
    poolA --> payment["Serviço de pagamento\n(degradado ⚠️)"]:::slow
    poolB --> inventory["Serviço de estoque\n(saudável ✓)"]:::ok

    classDef slow fill:#f90,color:#000
    classDef ok fill:#6c6,color:#fff
```

Se o serviço de pagamento degrada e ocupa todas as 10 threads do Pool A, o Pool B não é afetado em nada. O serviço de estoque continua atendendo requisições a toda velocidade. Sem bulkheads, uma única dependência lenta satura o pool compartilhado e degrada igualmente todas as outras chamadas.

O custo dos bulkheads é o consumo extra de recursos: dez pools separados de 10 threads cada usam mais memória do que um único pool de 100 threads. O trade-off quase sempre compensa para dependências do caminho crítico.

---

## Rate Limiting

O rate limiting (limitação de taxa) restringe o número de requisições que um cliente (ou o sistema) pode fazer dentro de uma janela de tempo, protegendo os serviços contra picos de tráfego e clientes abusivos.

### Algoritmo token bucket

O **token bucket** (balde de fichas) é o algoritmo de rate limiting mais comum. Ele modela um balde que se enche de fichas a uma taxa constante; cada requisição consome uma ficha; as requisições que chegam quando o balde está vazio são rejeitadas ou enfileiradas.

``` mermaid
flowchart LR
    refill["Fonte de fichas\n(taxa de reposição: 100 req/s)"] -->|adiciona fichas| bucket["Token Bucket\n(capacidade: 200)"]
    request["Requisição\nrecebida"] -->|consome 1 ficha| bucket
    bucket -->|há fichas| allowed["✓ Permitida"]
    bucket -->|balde vazio| rejected["✗ 429 Too Many Requests"]
```

| Propriedade | Efeito |
|---|---|
| **Taxa de reposição** | Vazão máxima em regime estável |
| **Capacidade do balde (burst)** | Quanto tráfego instantâneo acima da taxa é tolerado |

Uma capacidade do balde maior do que a taxa de reposição permite rajadas curtas e, ainda assim, impõe uma média de longo prazo. É assim que funciona a maioria das implementações reais (o `limit_req` do Nginx, o AWS API Gateway, o `RequestRateLimiter` do Spring).

---

## Health Checks

Os endpoints de health check permitem que os orquestradores (Kubernetes, Docker Compose, balanceadores de carga) detectem instâncias com falha e parem de rotear tráfego para elas antes que os clientes percebam.

Dois tipos distintos servem a propósitos diferentes:

**Liveness**
: *O processo está vivo?* Retorna `200 OK` se a aplicação está rodando e não está em deadlock. Se uma verificação de liveness falha, o orquestrador **reinicia** o container.

**Readiness**
: *O serviço está pronto para receber tráfego?* Retorna `200 OK` apenas se todas as dependências (banco de dados, cache, serviços downstream) estão acessíveis e aquecidas. Se uma verificação de readiness falha, o orquestrador **remove a instância do pool do balanceador de carga**, sem reiniciá-la.

``` mermaid
flowchart LR
    lb["Balanceador de carga"] -->|"GET /actuator/health/readiness"| svc["Instância do serviço"]
    svc -->|200 OK| lb
    lb -->|roteia tráfego| svc

    svc2["Instância do serviço\n(conexão com o BD perdida)"]
    lb -->|"GET /actuator/health/readiness"| svc2
    svc2 -->|503 DOWN| lb
    lb -->|removida do pool| svc2:::failed

    classDef failed fill:#f66,color:#fff
```

O Spring Boot Actuator expõe os dois, prontos para uso, em `/actuator/health/liveness` e `/actuator/health/readiness`.

---

## Defesa em profundidade

Esses padrões são combinados em camadas, e não escolhidos isoladamente. Uma cadeia de chamadas de nível de produção combina todos eles:

``` mermaid
flowchart LR
    client --> rl["Rate Limiter\n(protege o serviço)"]
    rl --> cb["Circuit Breaker\n(falha rápido com deps. abertas)"]
    cb --> bh["Bulkhead\n(isola o pool de threads)"]
    bh --> to["Timeout\n(limita o tempo de espera)"]
    to --> retry["Retry + Backoff\n(trata falhas transitórias)"]
    retry --> downstream[Serviço downstream]
```

Cada camada trata um cenário de falha diferente:

| Camada | O que ela trata |
|---|---|
| Rate limiter | Picos de tráfego, clientes abusivos |
| Circuit breaker | Dependências que se sabe estarem falhando |
| Bulkhead | Dependências lentas contaminando outras chamadas |
| Timeout | Espera sem limite |
| Retry + backoff | Erros transitórios |

---

[^1]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^2]: BROOKER, M. [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/){target="_blank"}. AWS Architecture Blog, 2015.
[^3]: FOWLER, M. [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html){target="_blank"}. martinfowler.com, 2014.
[^4]: [Resilience4j Documentation](https://resilience4j.readme.io/docs){target="_blank"}.
