
> *"Projete um rate limiter para uma API pública. Ele precisa funcionar entre muitas réplicas do API gateway, acrescentar quase nenhuma latência e permitir limites diferentes por usuário, por IP e por parceiro."*

Toda API pública precisa de um, e todo sistema grande tem vários: na borda contra inundações, no gateway por cliente, dentro dos serviços para proteger uma dependência frágil. O problema é pequeno o bastante para ser projetado de ponta a ponta em 45 minutos e profundo o bastante para separar níveis: um candidato júnior diz "token bucket"; um sênior explica **por que** um contador de janela deslizante é preciso o suficiente, como tornar a verificação **atômica** entre 20 réplicas do gateway, o que acontece quando o armazenamento dos contadores **cai**, e por que só rate limiting não impede uma sobrecarga.

No BoxOffice, o rate limiter é a segunda linha de defesa da venda relâmpago: o [WAF](../../../reference/components/edge/index.md#waf) barra inundações óbvias, a sala de espera dosa as admissões e o gateway aplica "5 tentativas de reserva por minuto por conta" e as cotas dos parceiros revendedores.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star: médio |
| **Conceitos-chave** | token bucket, leaky bucket, janela fixa, janela deslizante (log e contador), GCRA, contadores atômicos no Redis com Lua, 429 + `Retry-After`, fail-open vs. fail-closed, limites locais vs. globais |
| **Componentes da paleta** | [`apigw`](../../../reference/components/edge/index.md#apigw), [`lb`](../../../reference/components/edge/index.md#lb), [`waf`](../../../reference/components/edge/index.md#waf), [`app`](../../../reference/components/compute/index.md#app), [`cache`](../../../reference/components/storage/index.md#cache), [`metrics`](../../../reference/components/observability/index.md#metrics) |
| **Cenário do playground** | `rate-limiter` |

!!! abstract "O que este caso treina"

    - **Comparar** os cinco algoritmos clássicos de rate limiting quanto a precisão, memória e comportamento em rajadas.
    - **Implementar** uma verificação atômica e distribuída com Redis e um script Lua, e **explicar** a condição de corrida que ela evita.
    - **Decidir** onde os limites ficam (borda, gateway, serviço, cliente) e como são configurados por usuário, IP e plano.
    - **Projetar** o comportamento em falha (fail-open vs. fail-closed) e o contrato com o cliente (429, `Retry-After`, backoff com jitter).
    - **Distinguir** rate limiting de descarte de carga (*load shedding*) e de limite de concorrência.

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

A expressão "rate limiter" esconde vários produtos diferentes. Pergunte antes de desenhar ([roteiro de entrevista](../../intro/interview-framework/index.md)).

### Requisitos funcionais { #functional-requirements }

1. Limitar o número de requisições que um **cliente** pode fazer numa janela de tempo; o cliente pode ser um ID de usuário, uma chave de API, um endereço IP ou uma combinação.
2. Várias **regras** por requisição, ex.: `10 req/s por usuário` **e** `1 000 req/min por chave de API` **e** `100 req/s por IP` em `/login`.
3. Requisições rejeitadas recebem **HTTP 429 Too Many Requests** com uma indicação de quando tentar de novo.
4. Regras **configuráveis** sem novo deploy (por endpoint, por plano: gratuito, parceiro, interno).
5. Expor métricas: permitidas vs. rejeitadas por regra e cliente.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta |
|---|---|
| **Latência** | Acrescenta < 1 ms no p99 de cada requisição (ele está em todas) |
| **Vazão** | 50 mil req/s no pico (dia de abertura de vendas do BoxOffice), em ~20 réplicas do gateway |
| **Precisão** | Um cliente pode passar do limite por uma pequena margem (digamos ≤ 10%) em corridas ou rajadas; nunca 2× |
| **Disponibilidade** | Uma falha do limitador não pode derrubar a API |
| **Memória** | O estado de ~1 M de clientes ativos precisa caber com folga em RAM |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Proteção contra DDoS na camada de rede (é trabalho do WAF/CDN), cobrança por uso, detecção de abuso com aprendizado de máquina. Mencione que existem nas camadas em volta do limitador.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | No cliente, no servidor ou no gateway? | Um limitador no cliente é cortesia, não proteção: o lado do servidor é obrigatório. |
    | O que identifica o cliente: usuário, chave de API, IP? | IPs são compartilhados (NAT, operadoras móveis) e falsificáveis via proxies; usuário/chave é mais justo. |
    | Limite rígido ou flexível (permite rajada)? | Token bucket permite rajadas; leaky bucket as suaviza. |
    | Quantas réplicas do gateway, quantas regiões? | Um limite por réplica erra por um fator N; um limite global precisa de estado compartilhado. |
    | O que deve acontecer se o armazenamento do limitador cair? | Fail-open (disponibilidade) vs. fail-closed (proteção). |
    | O limite é sobre **taxa**, **concorrência** ou **custo**? | "10 requisições/s" vs. "5 em andamento" vs. "100 mil tokens de LLM/min" são mecanismos diferentes. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

```python exec="1" source="tabbed-right"
# Rate limiter: assumptions (illustrative)
peak_rps       = 50_000      # API requests per second at peak
gateways       = 20          # gateway replicas
active_clients = 1_000_000   # distinct keys active in a window
rules_per_req  = 2           # e.g. per-user + per-IP
bucket_b       = 100         # one counter in Redis: key + 2 numbers + overhead, bytes
user_limit_min = 600         # per-user limit: 600 requests per minute
log_entry_b    = 50          # one timestamp in a sorted set, with overhead
redis_ops_node = 100_000     # simple ops/s one Redis node sustains (order of magnitude)
rtt_ms         = 0.5         # gateway → Redis round trip in the same zone

counter_ops    = peak_rps * rules_per_req           # one atomic op per rule (or 1 script)
script_calls   = peak_rps                            # all rules in one Lua call
counters_mb    = active_clients * rules_per_req * bucket_b / 1e6
log_gb         = active_clients * user_limit_min * log_entry_b / 1e9
redis_nodes    = script_calls * 3 / redis_ops_node   # a script costs ~3 simple ops
local_error    = gateways                             # per-replica limits: worst-case factor
added_ms       = rtt_ms

rows = [
    ("counter_ops", counter_ops, "ops/s"), ("script_calls", script_calls, "calls/s"),
    ("counters_mb", counters_mb, "MB"), ("log_gb", log_gb, "GB"),
    ("redis_nodes", redis_nodes, "nodes"), ("local_error", local_error, "x limit"),
    ("added_ms", added_ms, "ms"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- Contadores para um milhão de clientes ocupam **~200 MB** — um nó Redis guarda com folga. Um **log de janela deslizante** (um timestamp por requisição) precisaria de **~30 GB** para os mesmos clientes: por isso o log raramente é usado em escala.
- **50 mil chamadas de script/s** com ~3 operações cada dão ~1,5 nó Redis de trabalho ⇒ um pequeno **Redis Cluster** (3 primários + réplicas), fragmentado pela chave do cliente, com folga.
- Uma ida e volta na mesma zona acrescenta **~0,5 ms** — dentro do orçamento, desde que o gateway fale com o Redis por conexões persistentes com pipelining e que **todas as regras vão numa única chamada de script**.
- Aplicar `limit` de forma independente em cada uma das 20 réplicas deixa um cliente obter até **20× o limite** quando o balanceador espalha suas requisições. ⇒ ou um contador **compartilhado**, ou um limite local de `limit / N` com roteamento fixo, ou um híbrido (veja 6.3).

---

## 3. API

O limitador normalmente não é uma API pública, e sim um **filtro** dentro do gateway; mesmo assim, defina seu contrato — interno e externo.

```http
# Internal (gateway → limiter library or sidecar)
check(rules=[("user:42", 10, 1s), ("ip:203.0.113.7", 100, 1s)], cost=1)
    → {allowed: true|false, remaining: 7, resetMs: 380, retryAfterMs: 0}

# External: what the API client sees
HTTP/1.1 429 Too Many Requests
Retry-After: 2
RateLimit-Policy: "per-user";q=10;w=1
RateLimit: "per-user";r=0;t=2
Content-Type: application/problem+json

{"type": "https://bx.example/problems/rate-limited", "title": "Too many requests",
 "detail": "Limit of 10 requests per second per user exceeded", "retryAfterSeconds": 2}
```

- **`429`** (RFC 6585) mais **`Retry-After`** (segundos ou uma data) é o contrato. Clientes bem-comportados tentam de novo **depois** desse tempo, com backoff exponencial e jitter.
- Os campos de cabeçalho `RateLimit` / `RateLimit-Policy` estão sendo padronizados pelo grupo de trabalho HTTPAPI do IETF; muitas APIs ainda usam os antigos `X-RateLimit-Limit/Remaining/Reset`. De qualquer forma: informe aos clientes o orçamento deles **antes** de baterem na parede.
- Regras são dados, não código, ex.: guardadas num serviço de configuração e em cache em todo gateway:

```yaml
rules:
  - match: { path: "/v1/events/*/holds", method: POST }
    key: user
    limit: { requests: 5, per: 60s }          # 5 hold attempts per minute per account
  - match: { path: "/v1/*" }
    key: api_key
    limit: { requests: 1000, per: 60s, burst: 200 }
    plans: { partner: 10000, internal: unlimited }
  - match: { path: "/v1/auth/login" }
    key: ip
    limit: { requests: 10, per: 60s }
    on_store_failure: closed                   # security-sensitive: fail closed
```

---

## 4. Modelo de dados { #4-data-model }

O estado é minúsculo e de vida curta: por (regra, cliente) um contador ou uma quantidade de tokens com um timestamp, expirando automaticamente.

```text
# Token bucket (Redis hash)              key TTL = time to refill completely × 2
rl:tb:user:42          → { tokens: 7.4, ts: 1767261600123 }

# Fixed window counter (Redis string)    key TTL = window
rl:fw:user:42:29454360 → 9            (window id = floor(now / 60 s))

# Sliding window counter: two fixed windows, current and previous
rl:sw:user:42:29454360 → 4
rl:sw:user:42:29454359 → 9

# Sliding window log (Redis sorted set)  score = timestamp
rl:log:user:42         → { 1767261600123, 1767261600201, ... }
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Contadores / buckets | KV em memória com TTL e scripts atômicos: Redis (`cache`) | Submilissegundo, atômico, expira sozinho; perdê-lo custa só algumas requisições a mais |
| Regras | Serviço de configuração ou SQL, em cache em todo gateway (atualiza a cada poucos segundos) | Lidas em toda requisição: precisam ser locais |
| Eventos de permitido / rejeitado | Métricas (`metrics`), logs amostrados | Dashboards, alertas sobre taxas de rejeição incomuns, ajuste dos limites |

---

## 5. Design de alto nível { #5-high-level-design }

``` diagram-sim
flowchart LR
    c([Clientes]) --> waf["WAF / CDN<br/>limites grossos por IP"]
    waf --> lb["Balanceador de carga"]
    lb --> gw1["API gateway #1<br/>filtro de rate limit"]
    lb --> gw2["API gateway #N<br/>filtro de rate limit"]
    gw1 --> r[("Redis Cluster<br/>contadores, Lua")]
    gw2 --> r
    cfg["Serviço de configuração<br/>das regras"] -. enviado / em cache .-> gw1
    cfg -. enviado / em cache .-> gw2
    gw1 --> svc["Serviços de backend"]
    gw2 --> svc
    gw1 -. permitido / 429 .-> m["Métricas"]
```

Uma requisição passando pelo filtro:

``` diagram-sim
sequenceDiagram
    autonumber
    participant C as Cliente
    participant G as API gateway
    participant R as Redis
    participant S as Serviço
    C->>G: POST /v1/events/42/holds (usuário 42)
    G->>G: casa as regras (cache local)
    G->>R: EVALSHA token_bucket {user:42, ip:…} now cost=1
    R-->>G: allowed=1, remaining=4
    G->>S: encaminha a requisição
    S-->>G: 201 Created
    G-->>C: 201 + RateLimit: r=4
    C->>G: 6ª tentativa no mesmo minuto
    G->>R: EVALSHA token_bucket …
    R-->>G: allowed=0, tentar de novo em 9 s
    G-->>C: 429 Too Many Requests, Retry-After: 9
```

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

### 6.1 Os algoritmos { #61-the-algorithms }

| Algoritmo | Como funciona | Rajadas | Memória por cliente | Precisão | Uso típico |
|---|---|---|---|---|---|
| **Token bucket** | Balde de capacidade `b` reabastecido a `r` tokens/s; cada requisição consome um token | Permite rajadas de até `b` | 2 números | Exato | Limites de API (estilo AWS, Stripe) |
| **Leaky bucket** | Requisições entram numa FIFO esvaziada a taxa constante | Suaviza (enfileira ou descarta) | Uma fila ou 2 números | Exato | Moldar o tráfego para um backend frágil |
| **Janela fixa** | Contador por janela `floor(now / w)` | Até **2×** nas fronteiras das janelas | 1 número | Fraco nas bordas | Cotas grossas (por dia) |
| **Log de janela deslizante** | Guarda todo timestamp; conta os dos últimos `w` | Nenhuma | Uma entrada por requisição | Exato | Limites de baixo volume e alto valor |
| **Contador de janela deslizante** | Contagem atual + contagem anterior × fração de sobreposição | Pequenas | 2 números | Aproximado (supõe a janela anterior uniforme) | Limites de API em larga escala (estilo Cloudflare) |
| **GCRA** | Acompanha um "tempo teórico de chegada"; equivale a um token bucket | Configuráveis | 1 timestamp | Exato | O mesmo que token bucket, com menos estado |

O problema de fronteira das janelas fixas é mais fácil de ver com um traço. Limite: 10 requisições por segundo; um cliente envia 10 requisições em t = 0,99 s e mais 10 em t = 1,01 s:

```python exec="1" source="tabbed-right"
# How many of 20 requests (10 at t=0.99 s, 10 at t=1.01 s) does each algorithm allow?
limit, window = 10, 1.0
trace = [0.99] * 10 + [1.01] * 10

def fixed_window(ts):
    counts, ok = {}, 0
    for t in ts:
        w = int(t // window)
        if counts.get(w, 0) < limit:
            counts[w] = counts.get(w, 0) + 1
            ok += 1
    return ok

def sliding_log(ts):
    log, ok = [], 0
    for t in ts:
        log = [x for x in log if x > t - window]
        if len(log) < limit:
            log.append(t)
            ok += 1
    return ok

def sliding_counter(ts):
    counts, ok = {}, 0
    for t in ts:
        w = int(t // window)
        overlap = 1 - (t % window) / window
        estimate = counts.get(w - 1, 0) * overlap + counts.get(w, 0)
        if estimate < limit:
            counts[w] = counts.get(w, 0) + 1
            ok += 1
    return ok

def token_bucket(ts, capacity=limit, rate=limit / window):
    tokens, last, ok = capacity, 0.0, 0
    for t in ts:
        tokens = min(capacity, tokens + (t - last) * rate)
        last = t
        if tokens >= 1:
            tokens -= 1
            ok += 1
    return ok

print("| algorithm | allowed of 20 |\n|---|---:|")
for f in (fixed_window, sliding_log, sliding_counter, token_bucket):
    print(f"| `{f.__name__}` | {f(trace)} |")
```

A janela fixa deixa passar **20 requisições em 20 ms** — o dobro do limite — porque elas caem em duas janelas diferentes. O log e o token bucket permitem exatamente 10. O contador de janela deslizante permite 11: ele supõe que as requisições da janela anterior foram distribuídas de forma uniforme, enquanto aqui todas chegaram bem no final dela — um erro pequeno e limitado em troca de dois números de estado. Por isso limitadores de produção usam **token bucket** ou **contador de janela deslizante**.

<div class="csim" data-sim="rate-limiter" data-limit="20" data-burst="40" data-pattern="boundary" data-algo="fixed"></div>

!!! tip "Experimente"
    Os valores iniciais são os limites do Nginx do lab 3: **20 requisições/s** por chave de API e **burst de 40**. O tráfego começa com uma rajada sobre a fronteira de 1 s (20 requisições logo antes, 20 logo depois) e a repete em 3 s.

    1. Rode com a **janela fixa**: 40 requisições chegam ao backend em cerca de 0,2 s, **2× o limite**, e isso se repete em 3 s.
    2. Mude para o **log deslizante**: o backend nunca vê mais que 20 em um segundo qualquer; a segunda metade de cada rajada recebe `429`.
    3. Mude para o **token bucket**: ele começa cheio, então deixa passar a rajada inteira — 46 requisições no segundo mais movimentado. Arraste a capacidade para 20 e o segundo mais movimentado cai para 29: a capacidade *é* a rajada que você permite.
    4. Escolha **rajadas** e o **leaky bucket**: o backend recebe 20 por segundo constantes, mas uma requisição na fila espera até 1,95 s — suavizar custa latência.


### 6.2 Tornando atômico entre réplicas { #62-making-it-atomic-across-replicas }

A implementação ingênua tem uma condição de corrida:

```text
gateway A: GET rl:user:42      → 9          gateway B: GET rl:user:42 → 9
gateway A: 9 < 10 → allow, SET 10           gateway B: 9 < 10 → allow, SET 10
                       → 11 requests allowed, counter says 10
```

Ler-verificar-escrever precisa ser **uma operação atômica** no armazenamento. No Redis, use `INCR` (atômico) para contadores, ou um **script Lua**, que roda atomicamente no shard dono da chave:

```lua
-- token_bucket.lua   KEYS[1] = bucket key   ARGV: capacity, refill per second, cost
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])
local t        = redis.call('TIME')                       -- server clock: no skew between gateways
local now      = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local b      = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or capacity
local ts     = tonumber(b[2]) or now
tokens = math.min(capacity, tokens + (now - ts) / 1000 * rate)

local allowed = 0
if tokens >= cost then
  tokens  = tokens - cost
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) * 2)
local retry_ms = 0
if allowed == 0 then retry_ms = math.ceil((cost - tokens) / rate * 1000) end
return { allowed, tostring(tokens), retry_ms }               -- floats → string (Redis truncates numbers)
```

Detalhes que mostram senioridade:

- **Uma chamada por requisição** para todas as regras (passe várias chaves) — mas no Redis Cluster todas as chaves de um script precisam cair no mesmo slot: use uma **hash tag**, ex.: `rl:{user:42}:tb` e `rl:{user:42}:fw`; regras com chaves de entidades diferentes (usuário e IP) precisam de chamadas separadas, em pipeline.
- **Use o relógio do servidor** (`TIME`) em vez do de cada gateway: 20 gateways com relógios 50 ms fora de sincronia reabasteceriam o balde de forma inconsistente.
- **TTL em toda chave**: clientes ociosos somem sozinhos; a memória fica proporcional aos clientes *ativos*.
- Carregue o script uma vez (`SCRIPT LOAD`) e chame-o com `EVALSHA` para não enviar o código-fonte a cada requisição.

### 6.3 Onde aplicar, e local vs. global { #63-where-to-enforce-and-local-vs-global }

``` diagram-sim
flowchart LR
    cl["SDK do cliente<br/>limite de cortesia"] --> edge["Borda / WAF<br/>por IP, grosso"]
    edge --> gw["API gateway<br/>por usuário / chave / plano"]
    gw --> mesh["Service mesh<br/>por serviço chamador"]
    mesh --> svc["Serviço<br/>limite de concorrência<br/>para seu banco / provedor"]
```

| Posição | Protege | Ponto forte | Ponto fraco |
|---|---|---|---|
| SDK do cliente | Nosso serviço de clientes bem-comportados | Barato, suaviza o tráfego | Não é obrigatório |
| Borda / WAF | Tudo o que está atrás de inundações | Absorve ataques longe da origem | Só conhece o IP, não o usuário |
| API gateway | Os serviços de qualquer cliente isolado | Conhece identidade e plano | Precisa de estado compartilhado entre réplicas |
| Dentro do serviço | Uma dependência frágil (banco, provedor de pagamento) | Conhece o custo real | Tarde: a requisição já consumiu recursos |

**Global vs. local.** Um Redis compartilhado dá um limite global exato ao custo de um salto de rede. Alternativas quando esse salto é caro demais (multirregião, taxas muito altas):

- **Buckets locais com `limit / N`**: sem rede, mas errado quando o tráfego está mal distribuído; aceitável com roteamento por hash consistente de cada cliente para um gateway.
- **Local + sincronização periódica**: cada gateway conta localmente e envia os deltas ao armazenamento compartilhado a cada 100 ms, lendo de volta o total global — aproximado (passa do limite em no máximo um intervalo de sincronização de tráfego), muito rápido. É mais ou menos assim que grandes CDNs fazem.
- **Limites por região**: limite por região e aceite que um cliente usando duas regiões obtenha até 2× — normalmente tudo bem.

!!! example "No código do BoxOffice: um limitador local na borda (lab 3)"

    O [Hands-on 3](../../../hands-on/3/index.md) coloca a versão mais simples deste projeto na borda: o Nginx dá a cada chave de API 20 req/s com rajada de 40 e responde `429` acima disso, sem tocar as réplicas. É um limitador **local** — os contadores vivem num só Nginx —, exato enquanto há uma borda só; com N bordas cada uma permitiria 20 req/s, o problema do `limite / N` acima. No teste do lab, o cliente educado (10 req/s) recebe só `200` e o guloso (50 req/s) cerca de 20 `200` por segundo e `429` no resto. O Nginx implementa um leaky bucket: `rate` é o escoamento, `burst` o tamanho do balde.

    ``` { .nginx title="infra/nginx/nginx.conf (the limit)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:28:32,43:44"
    ```

### 6.4 Quando o próprio limitador falha { #64-when-the-limiter-itself-fails }

- **Fail-open** (permitir quando o Redis está inacessível) mantém a API disponível — o padrão certo para limites comuns, porque o limitador existe para proteger o backend, e um curto período sem limites raramente é pior do que uma queda total. Combine com um **bucket local de reserva** para a proteção degradar em vez de sumir.
- **Fail-closed** (rejeitar) para limites que guardam segurança: tentativas de login, redefinição de senha, verificação de OTP — senão um atacante capaz de sobrecarregar o Redis também desliga a proteção contra força bruta.
- Coloque um **timeout apertado** (poucos ms) na chamada ao Redis e um circuit breaker em volta: um limitador lento é pior que nenhum, porque acrescenta latência a toda requisição ([padrões de confiabilidade](../../reliability/patterns/index.md)).

!!! warning "Rate limiting não é proteção contra sobrecarga"

    Um limite de 10 req/s por cliente não faz nada quando **um milhão de clientes legítimos** enviam 1 req/s cada — a abertura de vendas das 10:00. Proteger o backend da carga total exige **descarte de carga** (rejeitar quando a fila ou a latência do próprio serviço está alta demais), **limites de concorrência** (no máximo N chamadas em andamento para o provedor de pagamento) e, no BoxOffice, a sala de espera. Diga isso na entrevista: mostra que você sabe o que o rate limiter **não** faz.

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Ida e volta ao Redis | Acrescenta latência a toda requisição | Redis na mesma zona, pipelining, um script por requisição, cache local de "bloqueado até" | Pequena desatualização nos bloqueios |
| Redis fora do ar ou lento | Toda requisição bloqueada ou lenta | Timeout + breaker; fail-open com bucket local de reserva; fail-closed para regras de segurança | Admissão excessiva por um breve período |
| Chave de cliente quente | Um parceiro enorme satura um shard do Redis | Pré-agregação local dessa chave; dividir a chave em sub-buckets | Limite aproximado para esse cliente |
| Fronteiras da janela fixa | Rajadas de 2× nas bordas das janelas | Token bucket ou contador de janela deslizante | Um pouco mais de estado |
| IPs compartilhados (NAT, operadoras) | Muitos usuários bloqueados juntos | Preferir limites por usuário/chave; limites por IP generosos só em rotas não autenticadas | Atacantes podem alternar contas |
| Tempestade de retentativas | Clientes rejeitados repetem na hora, multiplicando a carga | `Retry-After`, backoff + jitter no cliente, SDKs que o respeitam | Clientes esperam mais |
| Mudanças de regras | Uma regra ruim bloqueia todo mundo | Regras como configuração versionada, modo de simulação ("shadow"), rollout gradual | Reação mais lenta |
| Multirregião | Limite global exige coordenação entre regiões | Limites por região ou sincronização assíncrona | Até N× o limite em N regiões |

Os trade-offs para **dizer em voz alta**: **precisão vs. latência** (contadores globais exatos custam um salto de rede; locais aproximados são de graça), **disponibilidade vs. proteção** (fail-open vs. fail-closed, escolhido por regra), e **justiça vs. simplicidade** (limites por IP são fáceis, mas punem usuários atrás de um NAT compartilhado).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

O cenário `rate-limiter` coloca um API gateway com rate limiting na frente de um backend de capacidade fixa.

!!! tip "Experimente"

    1. Rode com o perfil **spike** e o limitador **desligado** (ou contornado): veja a utilização do backend chegar a 100% e o p99 e os erros explodirem para todo mundo.
    2. Ligue o limitador e rode de novo: rejeições (429) aparecem no gateway, enquanto o backend fica abaixo da saturação e o p99 das requisições *aceitas* fica estável.
    3. Aumente o limite passo a passo e encontre o valor em que o backend começa a saturar — essa é a capacidade abaixo da qual seu limite precisa ficar.
    4. Ligue o caos para derrubar o armazenamento dos contadores (cache): o gateway faz fail-open ou fail-closed no simulador, e o que isso causa no backend?

<div class="sdp" data-scenario="rate-limiter" data-mode="full" data-height="640" data-profile="spike"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "Token bucket ou janela deslizante — qual você escolheria e por quê?"

    Para um limite de API, **token bucket**: dois números por cliente, exato, e permite rajadas curtas (um carregamento de página disparando 8 requisições de uma vez), que é o que os usuários de fato fazem. Configure capacidade (rajada) e taxa de reabastecimento separadamente. Escolha o **contador de janela deslizante** quando o produto diz "N requisições por minuto" e você quer a semântica de uma janela quase sem rajada, ao custo de uma pequena aproximação. Evite janelas fixas, exceto para cotas diárias grossas.

??? question "Como limitar por custo em vez de por número de requisições?"

    Torne o custo em tokens um parâmetro: um `GET` barato custa 1, uma exportação custa 50, uma chamada de LLM custa seu **número de tokens**. O token bucket lida com isso sem mudanças (argumento `cost` no script). Em chamadas de LLM o custo só é conhecido depois da resposta, então reserve uma estimativa antes e acerte a diferença depois (debitando ou creditando o balde).

??? question "O limite precisa valer em duas regiões. O que você faz?"

    Opções em custo crescente: (1) dividir o limite por região (`limit / 2` cada, ou proporcional ao tráfego) — sem coordenação, um pouco injusto; (2) contar localmente e replicar as contagens de forma assíncrona entre regiões a cada poucas centenas de ms — limite global aproximado; (3) um único armazenamento global — exato, mas acrescenta uma ida e volta entre regiões (dezenas de ms) a toda requisição, o que normalmente viola o requisito de latência. A maioria dos sistemas escolhe (1) ou (2) e declara o limite do erro.

??? question "Um cliente reclama que recebeu 429 enquanto estava abaixo do limite. Como isso pode acontecer?"

    Causas comuns: o relógio do cliente ou a contagem dele diferem da nossa (alinhamento das janelas); as requisições foram para duas regiões com limites separados; uma chave compartilhada (IP atrás de NAT, uma chave de API usada por vários serviços); retentativas contadas como requisições; ou o limite usa token bucket e o cliente mandou uma rajada maior que a capacidade. Os cabeçalhos `RateLimit` em toda resposta deixam o cliente ver seu orçamento real — a melhor forma de evitar essa conversa.

??? question "Como você testa o rate limiter?"

    Testes unitários do algoritmo com um relógio falso (fronteiras, rajadas, reabastecimento); testes de concorrência com muitas threads contra um Redis real para provar a atomicidade (conte as requisições permitidas: precisam ser ≤ limite); um teste de carga (k6) com taxa de chegada conhecida por cliente e a verificação de que as rejeições começam no limite configurado; e um teste de caos que derruba o Redis para verificar o comportamento fail-open/closed ([engenharia de desempenho](../../performance/index.md)).

??? question "Qual a diferença entre rate limiting, throttling e backpressure?"

    **Rate limiting** rejeita requisições acima de uma taxa configurada para um cliente. **Throttling** as desacelera em vez disso (atrasos, filas, leaky bucket). **Backpressure** é um sinal de um consumidor saturado para seu produtor diminuir o ritmo (janelas TCP, reactive streams, uma fila cheia bloqueando o produtor). Rate limiting é política sobre clientes; backpressure é uma propriedade da capacidade do sistema. Uma API robusta usa os dois.

??? question "Por que não deixar o backend escalar automaticamente em vez de rejeitar requisições?"

    O autoscaling leva minutos e custa dinheiro; um cliente abusivo cresce tão rápido quanto você escala. Alguns recursos nem escalam (um primário de banco, o limite da API de um parceiro). Rate limiting trata de **justiça entre clientes** e de **proteger recursos fixos**; autoscaling trata de **capacidade para a demanda legítima**. Você quer os dois.

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Um contador por usuário com janela fixa no Redis ou em memória; devolve 429. Pode manter o contador na memória de cada servidor sem perceber o problema de N×. |
| **Pleno** | Compara token bucket, janela fixa e janela deslizante; usa um Redis compartilhado com operações atômicas; configuração por regra; 429 com `Retry-After`; cita fail-open. |
| **Sênior** | Explica a condição de corrida e a resolve com um script Lua (hash tags no Cluster, relógio do servidor, TTLs); escolhe a posição por camada; discute limites locais vs. globais e os limites de erro em multirregião; fail-open vs. fail-closed por regra; limites por custo; distingue rate limiting de descarte de carga e de limite de concorrência; contrato com o cliente com backoff e jitter; observabilidade das rejeições. |

**Relacionados:** [API gateway](../../edge/api-gateway/index.md), [Hands-on 3](../../../hands-on/3/index.md) (rate limiting no Nginx), [Hands-on 4](../../../hands-on/4/index.md) (gateway e identidade), [Redis](../../caching/redis/index.md), [Padrões de confiabilidade](../../reliability/patterns/index.md).

!!! success "Boas práticas"

    - **Responda `429` com `Retry-After`** — clientes bem-comportados desaceleram sozinhos, e a tempestade de retentativas nem começa.
    - **Faça verificar-e-contar uma operação atômica** — um script Lua no Redis; duas idas e voltas deixam duas réplicas aceitarem a mesma requisição.
    - **Decida fail-open ou fail-closed por rota, e crie alertas para erros do limitador** — navegação falha aberta, login falha fechado; nos dois casos alguém precisa saber que o limitador caiu.
    - **Lance um limite novo primeiro em modo de simulação** — registre por um dia o que teria sido bloqueado antes de aplicá-lo; um limite errado é uma indisponibilidade causada por você.
    - **Use a identidade como chave onde a tiver, e o IP só na borda** — o lab 3 usa a chave de API, e o seu `nginx.conf` observa que requisições sem chave também deveriam ser limitadas por IP em produção ([lab 3](../../../hands-on/3/index.md)).

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["Rate limiter"]) --> EDG["Edge<br/>where limits live: WAF, gateway"]:::tech
    CASE --> CAC["Caching<br/>Redis counters, Lua atomicity"]:::tech
    CASE --> REL["Reliability<br/>fail-open vs fail-closed, load shedding"]:::tech
    CASE --> CLI["client contract<br/>429, Retry-After, jitter"]:::tech
    CASE --> PERF["Performance<br/>k6 at a known arrival rate"]:::tech
    EDG -.-> k1["waf · cdn · lb · apigw"]:::comp
    CAC -.-> k2["cache"]:::comp
    REL -.-> k3["metrics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Borda — API gateway](../../edge/api-gateway/index.md) · [Caching — Redis](../../caching/redis/index.md) · [Confiabilidade — padrões](../../reliability/patterns/index.md) (load shedding, backoff com jitter) · [Desempenho](../../performance/index.md) · [Hands-on 3](../../../hands-on/3/index.md) e [Hands-on 4](../../../hands-on/4/index.md). **Componentes da paleta:** [`waf`](../../../reference/components/edge/index.md#waf) · [`cdn`](../../../reference/components/edge/index.md#cdn) · [`lb`](../../../reference/components/edge/index.md#lb) · [`apigw`](../../../reference/components/edge/index.md#apigw) · [`cache`](../../../reference/components/storage/index.md#cache) · [`metrics`](../../../reference/components/observability/index.md#metrics). **Cenários:** `rate-limiter`.

---

## Referências { #references }

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 4 "Design a Rate Limiter"[^1].
- Os quatro tipos de limitadores da Stripe (taxa de requisições, concorrência, descarte de carga da frota, utilização de workers)[^2].
- O contador de janela deslizante da Cloudflare na borda[^3].
- O status HTTP 429[^4] e o tratamento de sobrecarga no Google[^5].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: TARJAN, P. [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters){target="_blank"}. Stripe Blog, 2017.
[^3]: DESGATS, J. [How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/){target="_blank"}. Cloudflare Blog, 2017.
[^4]: NOTTINGHAM, M.; FIELDING, R. [RFC 6585 — Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585){target="_blank"}. IETF, 2012.
[^5]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}, cap. 21 "Handling Overload". O'Reilly, 2016.
