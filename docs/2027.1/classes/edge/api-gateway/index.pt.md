O BoxOffice tem nove serviços. Sem um gateway, o app mobile precisaria conhecer nove endereços, cada serviço validaria JWTs por conta própria (com nove bugs ligeiramente diferentes), cada serviço implementaria o seu próprio rate limit, e o script de um fã martelando `POST /api/holds` 500 vezes por segundo iria direto para `inventory`. O **API gateway** é a porta de entrada única que resolve tudo isso num só lugar — e é também o lugar onde muitas arquiteturas, sem alarde, criam um gargalo ou um segundo monólito.

Um **API gateway** é um reverse proxy L7 especializado em APIs: é o ponto de entrada único dos clientes, roteia cada requisição para o serviço certo e aplica **políticas transversais** — autenticação, rate limits, cotas, transformações, observabilidade — antes que a requisição chegue a qualquer código de negócio[^1]. Ele é o componente `apigw` da paleta.

---

## O que um gateway faz { #responsibilities }

``` diagram-sim
flowchart LR
    app([App mobile]) --> gw
    web([App web]) --> gw
    partner([Cliente da API de parceiros]) --> gw
    subgraph gw [API gateway]
        direction TB
        a["Autenticar: JWT / API key"] --> r["Rate limit e cota"]
        r --> t["Rotear + transformar"]
        t --> o["Log, métricas, trace"]
    end
    gw --> catalog[catalog]
    gw --> inventory[inventory]
    gw --> order[order]
    gw --> assistant[assistant]
```

| Responsabilidade | O que significa | Exemplo no BoxOffice |
|---|---|---|
| **Roteamento** | mapear host/path/método para um serviço e uma versão | `/api/holds/**` → `inventory`, `/api/v2/orders/**` → `order` v2 |
| **Offload de autenticação (authN)** | validar a assinatura e a expiração do JWT, ou a API key, uma única vez | rejeitar tokens expirados antes que cheguem a qualquer serviço; repassar `X-User-Id` adiante |
| **Autorização grossa (authZ)** | regras por rota: escopos, papéis | `/api/admin/**` exige o papel `admin`; regras finas ("este usuário pode cancelar *este* pedido?") ficam no serviço |
| **Rate limiting e cotas** | requisições por segundo por usuário/IP/key; cotas mensais por plano | 10 req/s por fã, rajadas de 20; planos de parceiros de 1 M chamadas/mês |
| **Transformação de requisição/resposta** | renomear headers, remover campos internos, converter protocolos (REST ↔ gRPC) | expor a API gRPC de `inventory` como REST para o app web |
| **Agregação** | uma chamada do cliente se espalha por vários serviços e junta as respostas | `GET /api/events/42/page` devolve evento + local + disponibilidade |
| **Cache** | guardar respostas de GET por pouco tempo | detalhes do evento por 30 s |
| **Observabilidade** | access logs, métricas RED por rota, início do trace distribuído | p99 por rota, header `traceparent` injetado |
| **Resiliência** | timeouts, retries, circuit breakers por rota | timeout de 2 s para `inventory`; sem retries em `POST` |
| **Produtos de API** | API keys, portal do desenvolvedor, planos, cobrança por uso | parceiros de revenda de ingressos |

A palavra-chave é **transversal**: preocupações que são as mesmas para todos os serviços. Tudo o que depende do negócio — preços, alocação de assentos, regras de reembolso — pertence a um serviço, não à configuração do gateway.

!!! example "No código do BoxOffice: as rotas, os timeouts e o retry do gateway (lab 4)"

    O [Hands-on 4 — Gateway](../../../hands-on/4/gateway/index.md) coloca um Spring Cloud Gateway atrás da borda do lab 3. A configuração dele é quase a tabela acima inteira em poucas linhas: **roteamento** por path (`/auth/**`, `/catalog/**`); `lb://catalog`, que balanceia entre as três réplicas e pula qualquer uma cujo health check não esteja `UP` (verificado a cada 5 s); um **timeout** de conexão de 1 s e de resposta de 5 s para todos os serviços; e um filtro `Retry` limitado a `GET`, para que um retry nunca repita uma compra. A autenticação — validar o JWT que `auth` assina — está em `SecurityConfig.java`, na mesma página.

    ``` { .yaml title="services/gateway/src/main/resources/application.yaml (routes and resilience)" }
    --8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/resources/application.yaml:7:30,40:43"
    ```

---

## Gateway, load balancer, ingress ou service mesh? { #comparison }

Esses quatro componentes se sobrepõem, e os produtos borram as fronteiras (o Envoy é o motor de muitos deles). O que os distingue é **qual tráfego** tratam e **o que sabem**:

| | Load balancer (`lb`) | Ingress / Gateway API (`ingress`) | API gateway (`apigw`) | Service mesh (`mesh`) |
|---|---|---|---|---|
| Tráfego | norte-sul (entrando no sistema) | norte-sul entrando num cluster Kubernetes | norte-sul, tráfego de API | **leste-oeste** (serviço a serviço) |
| Papel principal | distribuir a carga entre réplicas saudáveis | rotear HTTP por host/path para Services | políticas de API: auth, limites, keys, transformações | mTLS, retries, timeouts, telemetria entre serviços |
| Conhece | backends, saúde | Services, hosts, paths | consumidores, API keys, planos, rotas | a identidade de cada serviço |
| Produtos típicos | ALB/NLB, Nginx, HAProxy | Envoy Gateway, Traefik, controllers de nuvem | Kong, Apigee, AWS API Gateway, Azure APIM, Spring Cloud Gateway | Istio, Linkerd, Cilium |

Uma requisição típica do BoxOffice atravessa um **load balancer** (gerenciado, na entrada da região), o **API gateway** (políticas) e, entre os serviços, o **mesh**. No Kubernetes, o gateway costuma ser implantado *como* a implementação da Gateway API, fundindo os papéis de ingress e de gateway. O mesh é estudado em [Rede & Segurança](../../network-security/service-mesh/index.md).

---

## Backend for Frontend (BFF) { #bff }

O app mobile e o app web precisam de coisas diferentes: o app mostra um card compacto do evento e funciona em redes lentas; a página web mostra o mapa completo de assentos e os detalhes do local. Uma API única e genérica ou traz dados demais para o mobile, ou obriga o app web a fazer muitas chamadas.

O padrão **Backend for Frontend** dá a cada tipo de cliente a **sua própria** camada fina de gateway, mantida pelo time que constrói aquele frontend[^2]:

``` diagram
flowchart LR
    m([App mobile]) --> bm[BFF mobile]
    w([App web]) --> bw[BFF web]
    p([Parceiros]) --> pg[API gateway público]
    bm --> catalog[catalog]
    bm --> inventory[inventory]
    bw --> catalog
    bw --> inventory
    bw --> order[order]
    pg --> catalog
```

Cada BFF agrega e molda as respostas de que o seu cliente precisa (uma chamada para a "tela do evento" no mobile, com imagens menores e menos campos) e evolui no ritmo daquele frontend. Servidores GraphQL são usados com frequência como BFFs, porque o cliente descreve exatamente o formato de que precisa (veja [Estilos de API](../../compute/api-styles/index.md)).

| | Um gateway de uso geral | Um BFF por cliente |
|---|---|---|
| Respostas | genéricas; os clientes trazem dados demais ou fazem muitas chamadas | sob medida para cada tela |
| Responsável | time de plataforma; um gargalo compartilhado para mudanças | o time de frontend é dono do seu BFF |
| Duplicação | nenhuma | alguma lógica comum duplicada entre BFFs |
| Número de componentes | um | um por tipo de cliente |

Use um BFF quando os clientes forem bem diferentes e mantidos por times diferentes; deixe as políticas transversais (auth, rate limits) no gateway compartilhado na frente dos BFFs.

---

## Rate limiting { #rate-limiting }

O **rate limiting** limita quantas requisições um cliente pode fazer num período de tempo. Ele protege o backend de sobrecarga e abuso, impede que um cliente barulhento prejudique os outros (justiça) e faz valer os planos comerciais. Ele responde com **`429 Too Many Requests`** — "você, especificamente, está mandando demais" —, diferente de `503 Service Unavailable`, que significa "o servidor está sobrecarregado para todo mundo".

Todo rate limiter precisa decidir três coisas:

1. **Quem** está sendo limitado — a **chave**: o id do usuário (do JWT), a API key, o IP do cliente, ou uma combinação como usuário + rota.
2. **Quanto** — a **política**: 10 requisições por segundo com rajadas de 20; 1.000 por hora; 4 holds por evento por usuário.
3. **Como** contar — o **algoritmo**, abaixo.

### Token bucket { #token-bucket }

O algoritmo mais usado[^3]. Cada chave tem um balde que guarda no máximo **capacity** tokens (o tamanho da rajada) e é reabastecido a uma **taxa** constante (o limite sustentado). Cada requisição consome um token; se o balde está vazio, a requisição é rejeitada.

``` diagram-sim
flowchart LR
    req([Requisição do fã 7]) --> chk{"Há token no<br/>balde do fã 7?"}
    refill(["Reabastece: +10 tokens/s<br/>até a capacidade 20"]) -.-> chk
    chk -->|"sim: consome 1 token"| fwd[Encaminha para inventory]
    chk -->|"não: balde vazio"| rej["429 Too Many Requests<br/>Retry-After: 1"]
```

A implementação não precisa de timer: guarde a contagem de tokens e o instante da última atualização e, a cada requisição, some `elapsed × rate` tokens (limitado à capacidade) antes de verificar. Dois números por chave, trabalho O(1) por requisição.

A simulação abaixo mostra o balde de um fã (capacidade 20, reabastecimento de 10/s) sob um padrão de tráfego ilustrativo: navegação normal a 4 req/s, uma rajada de 2 segundos a 40 req/s (o fã aperta "atualizar" sem parar às 10:00) e depois 8 segundos a 14 req/s.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO
plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

capacity, refill = 20, 10          # bucket: 20 tokens, 10 tokens/s (one user's limit)
dt, T = 0.1, 30                     # simulate 30 s in steps of 100 ms
t = np.arange(0, T, dt)

def rate(s):                        # requests/s sent by the client (illustrative)
    if 5 <= s < 7:   return 40      # a 2 s burst (the fan mashes "refresh")
    if 15 <= s < 23: return 14      # sustained load above the limit
    return 4                        # normal browsing

tokens, level, ok, ko = capacity, [], np.zeros(T), np.zeros(T)
for s in t:
    tokens = min(capacity, tokens + refill * dt)    # refill
    arrivals = round(rate(s) * dt * 10) / 10        # fractional requests per step
    accepted = min(arrivals, tokens)
    tokens -= accepted
    ok[int(s)] += accepted
    ko[int(s)] += arrivals - accepted
    level.append(tokens)

fig, (a, b) = plt.subplots(2, 1, figsize=(9, 5.5), sharex=True)
a.plot(t, level, color="#2f6fed", linewidth=2)
a.axhline(capacity, color="#888", linestyle="--", linewidth=1)
a.set_ylabel("tokens in bucket")
a.set_title("Token bucket: capacity 20, refill 10/s")
sec = np.arange(T)
b.bar(sec + 0.5, ok, width=0.9, color="#1e9e5a", label="accepted")
b.bar(sec + 0.5, ko, width=0.9, bottom=ok, color="#e5484d", label="rejected (429)")
b.axhline(refill, color="#888", linestyle="--", linewidth=1)
b.set_ylabel("requests per second")
b.set_xlabel("time (s)")
b.legend(frameon=False, loc="upper right")

plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Leia os dois painéis juntos:

- Durante a **rajada**, o primeiro segundo aceita cerca de 29 requisições — os 20 tokens guardados mais o reabastecimento — e depois o limitador se acomoda na taxa de reabastecimento de 10/s; o excesso é rejeitado.
- Durante a fase **sustentada** a 14 req/s, o balde se esvazia devagar (perde 4 tokens por segundo) e aceita tudo por cerca de cinco segundos; depois disso, aceita exatamente 10/s.
- Quando o tráfego se acalma (4 req/s, portanto um reabastecimento líquido de 6 tokens/s), o balde volta a encher em cerca de três segundos, e a próxima rajada será absorvida de novo.

É o comportamento que você normalmente quer: **rajadas curtas são toleradas, excesso sustentado não**. Os dois parâmetros se traduzem diretamente em linguagem de produto — "10 requisições por segundo, rajadas de até 20".

??? question "Pense antes: um balde tem capacidade 50 e reabastece a 5 tokens/s. Um cliente que ficou ocioso por muito tempo manda 100 requisições de uma vez. Quantas são aceitas imediatamente? E quanto tempo até ele poder mandar outras 50 de uma vez?"
    **50** são aceitas (o balde cheio); as outras 50 são rejeitadas. O balde fica vazio, então precisa de **10 s** (50 tokens ÷ 5 tokens/s) para encher de novo. Num período longo, o cliente nunca consegue passar de uma média de 5 req/s, qualquer que seja o seu padrão.

### Leaky bucket { #leaky-bucket }

As requisições entram numa **fila** de tamanho fixo e saem dela a uma taxa constante, como água vazando de um balde furado. Se a fila está cheia, as requisições novas são descartadas. A saída é perfeitamente suave — o backend vê exatamente a taxa de vazamento —, ao custo de **latência adicional** para as requisições enfileiradas e de nenhuma rajada chegar ao backend. O `limit_req` do Nginx é um leaky bucket; com `burst=… nodelay`, ele se comporta de modo muito parecido com um token bucket.

### Contador de janela fixa { #fixed-window }

Conte as requisições por chave em janelas fixas — "minuto 10:00", "minuto 10:01" — com um contador que zera a cada fronteira: `INCR ratelimit:fan7:202610171000` com expiração de 60 s. Simples e barato, mas tem um **problema de fronteira**: com um limite de 100 por minuto, um cliente pode mandar 100 às 10:00:59 e outras 100 às 10:01:00 — **200 requisições em dois segundos**, o dobro da taxa pretendida, todas aceitas.

### Log de janela deslizante { #sliding-log }

Guarde o **timestamp de cada requisição** (por exemplo, num sorted set do Redis); a cada requisição, descarte os timestamps mais antigos que a janela e conte o resto. Exato — não há problema de fronteira —, mas a memória cresce com o limite: um limite de 1.000 por hora guarda até 1.000 timestamps por chave.

### Contador de janela deslizante { #sliding-counter }

Uma aproximação barata que resolve o problema de fronteira: mantenha os contadores da janela fixa **atual** e da **anterior** e pondere a anterior por quanto dela ainda se sobrepõe à janela deslizante:

$$
\text{estimativa} = \text{atual} + \text{anterior} \times \left(1 - \frac{\text{tempo decorrido na janela atual}}{\text{tamanho da janela}}\right)
$$

Exemplo: limite de 100/min. O minuto anterior teve 80 requisições; 15 s depois do início do minuto atual, houve 30. Estimativa = 30 + 80 × (1 − 15/60) = 30 + 60 = **90** → a requisição é permitida. Ele supõe que as requisições da janela anterior estavam distribuídas por igual, o que é próximo o bastante na prática; a Cloudflare relatou que essa aproximação errou numa fração ínfima das requisições em tráfego real[^4].

### Comparando os algoritmos { #algorithm-comparison }

| Algoritmo | Memória por chave | Rajadas | Precisão | Uso típico |
|---|---|---|---|---|
| **Token bucket** | 2 números | permitidas, até a capacidade | boa | API gateways (AWS API Gateway, Spring Cloud Gateway, Envoy) |
| **Leaky bucket** | uma fila | suavizadas | boa | proteger um backend que precisa de taxa constante; `limit_req` do Nginx |
| **Janela fixa** | 1 contador | até 2× nas fronteiras | fraca nas fronteiras | cotas simples (por dia / por mês) |
| **Log de janela deslizante** | 1 timestamp por requisição | nenhuma além do limite | exata | limites baixos em que a exatidão importa (tentativas de login) |
| **Contador de janela deslizante** | 2 contadores | aproximadamente limitadas | muito boa | APIs de alto volume (Cloudflare) |

---

## Rate limiting distribuído { #distributed }

O BoxOffice roda **seis réplicas do gateway**. Se cada uma mantiver os contadores em memória, um fã cujas requisições se espalham entre elas recebe **seis vezes** o limite. Um rate limit que precisa valer entre réplicas exige um **store de contadores compartilhado**, quase sempre o **Redis**: rápido (menos de um milissegundo na mesma zona), com operações atômicas e expiração.

O read-modify-write de um token bucket precisa ser **atômico** — duas réplicas do gateway lendo "resta 1 token" ao mesmo tempo aceitariam as duas. Um script Lua roda atomicamente dentro do Redis:

```lua title="token_bucket.lua"
-- KEYS[1] = bucket key (e.g. "rl:user:7:holds")
-- ARGV[1] = capacity, ARGV[2] = refill rate (tokens/s), ARGV[3] = cost of this request
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

local t   = redis.call("TIME")                        -- Redis clock: no skew between gateways
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local b      = redis.call("HMGET", KEYS[1], "tokens", "ts")
local tokens = tonumber(b[1]) or capacity
local ts     = tonumber(b[2]) or now

tokens = math.min(capacity, tokens + (now - ts) / 1000 * rate)   -- refill since last call
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call("HSET", KEYS[1], "tokens", tokens, "ts", now)
redis.call("PEXPIRE", KEYS[1], math.ceil(capacity / rate * 1000) * 2)  -- idle keys disappear
return { allowed, tostring(tokens) }
```

Pontos de projeto que vale a pena dizer em voz alta:

- **Uma ida e volta** por requisição (de algumas centenas de microssegundos a um milissegundo) — aceitável no gateway, mas está no caminho crítico de *toda* requisição.
- **O tempo vem do Redis** (`TIME`), não de cada gateway: os relógios dos gateways derivam (veja [Tempo & relógios](../../distributed/time-clocks/index.md)).
- **Fail open ou fail closed?** Se o Redis estiver inacessível, o gateway deve aceitar tudo (protegendo a disponibilidade) ou rejeitar tudo (protegendo o backend)? A maioria das APIs faz **fail open** com um limite local, por réplica, como fallback.
- **Hot keys e escala**: um Redis Cluster distribui as chaves em shards por hash; uma única chave muito quente (um limite global) cai num único shard. Chaves por usuário se espalham naturalmente.
- **Alternativas aproximadas**: cada réplica aplica `limit / replicas` localmente, ou sincroniza os contadores de forma assíncrona a cada 100 ms. Menos exato, sem ida e volta extra.

### Onde limitar { #where }

| Camada | Chave | Protege contra | Exemplo |
|---|---|---|---|
| **Borda / CDN / WAF** | IP, fingerprint, ASN | inundações, scrapers, credential stuffing — antes de qualquer custo | 100 req/10 s por IP em `/login` |
| **API gateway** | id do usuário, API key, rota | usuários abusivos, cotas de plano, justiça | 10 req/s por fã, rajadas de 20 |
| **Serviço** | entidade de negócio | abuso de negócio que o gateway não enxerga | no máximo 6 assentos por hold, 1 hold ativo por evento por usuário |
| **Saída (lado do cliente)** | a cota do provedor | estourar o limite de um terceiro (pagamento, e-mail) | 100 req/s para o provedor de pagamento |

Use várias camadas: grossa e barata na borda, ciente da identidade no gateway, regras de negócio nos serviços. O rate limiting também é um dos padrões de resiliência da [aula 10](../../reliability/patterns/index.md) — lá, o ponto de vista é proteger um serviço de sobrecarga (load shedding).

### Avisando o cliente { #headers }

Um bom limitador diz aos clientes bem-comportados como se comportar:

```http title="429 response"
HTTP/1.1 429 Too Many Requests
Retry-After: 2
RateLimit-Policy: "per-user";q=20;w=1
RateLimit: "per-user";r=0;t=2
Content-Type: application/problem+json

{"type": "https://boxoffice.example/problems/rate-limited", "title": "Too many requests", "status": 429}
```

`Retry-After` (em segundos, ou uma data) é HTTP padrão. Muitas APIs também enviam `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`; o IETF está padronizando os campos `RateLimit` e `RateLimit-Policy` para o mesmo fim[^5]. Os clientes devem respeitar o `Retry-After` e recuar com jitter — senão todo cliente rejeitado tenta de novo no mesmo instante.

### Exemplos de configuração { #config }

=== "Spring Cloud Gateway"

    O Spring Cloud Gateway traz um token bucket apoiado no Redis (`RequestRateLimiter`). O gateway do [hands-on 4](../../../hands-on/4/gateway/index.md) não o liga — o BoxOffice limita na borda Nginx (quadro abaixo) —, mas é assim que você o adicionaria:

    ```yaml title="application.yaml"
    spring:
      cloud:
        gateway:
          server:
            webflux:      # the property prefix since Spring Cloud 2025 (as in hands-on 4)
              routes:
                - id: inventory-holds
                  uri: http://inventory:8080
                  predicates:
                    - Path=/api/holds/**
                  filters:
                    - name: RequestRateLimiter
                      args:
                        redis-rate-limiter.replenishRate: 10   # tokens per second
                        redis-rate-limiter.burstCapacity: 20   # bucket capacity
                        redis-rate-limiter.requestedTokens: 1  # cost of one request
                        key-resolver: "#{@userKeyResolver}"
    ```

    ```java title="RateLimitConfig.java"
    @Configuration
    public class RateLimitConfig {

        @Bean
        KeyResolver userKeyResolver() {   // the key: the authenticated user, or the IP
            return exchange -> exchange.getPrincipal()
                .map(Principal::getName)
                .switchIfEmpty(Mono.fromSupplier(() ->
                    exchange.getRequest().getRemoteAddress().getAddress().getHostAddress()));
        }
    }
    ```

=== "Nginx"

    O Nginx limita por chave com um leaky bucket. Com o IP do cliente como chave, fica assim; o [hands-on 3](../../../hands-on/3/index.md) usa a API key como chave (quadro abaixo):

    ```nginx title="nginx.conf"
    # 10 MB of shared memory holds about 160 000 IP states
    limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;

    server {
        location /api/ {
            limit_req zone=per_ip burst=20 nodelay;   # absorb bursts of 20, no queueing delay
            limit_req_status 429;
            proxy_pass http://gateway;
        }
    }
    ```

=== "Gerenciado"

    - **AWS API Gateway**: usage plans com throttling (taxa + rajada, um token bucket) e cotas por API key; regras rate-based do AWS WAF por IP.
    - **GCP**: cotas e spike arrest do Apigee; regras de rate limiting do Cloud Armor.
    - **Azure API Management**: políticas `rate-limit-by-key` e `quota-by-key`.
    - **Cloudflare**: regras de rate limiting na borda (janela deslizante).

!!! example "No código do BoxOffice: um rate limit na borda (lab 3)"

    A borda Nginx do [Hands-on 3](../../../hands-on/3/index.md) dá a cada **API key** 20 req/s com rajada de 40 e responde `429` acima disso, sem tocar nas réplicas. O script k6 do lab manda um cliente guloso (50 req/s) e um educado (10 req/s) por 30 s: na execução do lab, o guloso recebeu 640 `200`s e 843 `429`s — mais ou menos os 20/s a que tem direito — e o educado 299 `200`s e **nenhum** `429`. Note o comentário na configuração: uma requisição sem o header tem chave vazia e não é limitada, e a chave é escolhida pelo cliente. Em produção, a chave é uma identidade autenticada (o JWT do lab 4), mais um limite generoso por IP para o tráfego anônimo.

    ``` { .nginx title="infra/nginx/nginx.conf (the limit)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:28:32,43:44"
    ```

**Experimente.** Carregue o cenário rate-limiter e rode o perfil **spike** sem limites: o backend satura e o p99 explode para *todo mundo*. Ligue o rate limit do gateway e ajuste a taxa e a rajada: veja os 429 absorverem o excesso enquanto o p99 das requisições aceitas fica estável. O que acontece se o limite ficar acima da capacidade do backend?

<div class="sdp" data-scenario="rate-limiter" data-mode="compact" data-height="520" data-profile="spike"></div>

[:material-open-in-new: Abrir o playground completo](../../../../playground/index.md)

O projeto completo de um rate limiter distribuído, como problema de entrevista, está no [estudo de caso do rate limiter](../../case-studies/rate-limiter/index.md).

---

## Trade-offs num relance { #trade-offs }

| Decisão | Opção A | Opção B | Escolha A quando… |
|---|---|---|---|
| Ponto de entrada | um API gateway | um BFF por cliente | os clientes têm necessidades parecidas, ou um único time cuida de todos |
| Algoritmo | token bucket | contador de janela deslizante | rajadas são aceitáveis e você quer parâmetros simples e claros |
| Store de contadores | compartilhado (Redis) | local por réplica | o limite precisa ser preciso entre réplicas |
| Redis fora do ar | fail open | fail closed | a disponibilidade importa mais que a proteção estrita |
| Produto de gateway | gerenciado (AWS API GW, Apigee, APIM) | auto-hospedado (Kong, Spring Cloud Gateway, Envoy) | você quer planos, keys e portais sem operá-los |
| Lógica no gateway | só políticas transversais | regras de negócio | sempre A |

!!! example "BoxOffice: o gateway no dia da venda"
    - **Roteamento**: `/api/events/**` → `catalog`, `/api/holds/**` → `inventory`, `/api/orders/**` → `order`, `/api/assistant/**` → `assistant`.
    - **Autenticação**: o gateway valida o JWT emitido por `auth` (assinatura com as chaves públicas em cache, expiração, audience) e repassa `X-User-Id`; os GETs de `catalog` são públicos.
    - **Rate limits** (várias camadas):
        - borda/WAF: 100 requisições por 10 s por IP em `/login`; token da sala de espera obrigatório em `/api/holds`;
        - gateway: token bucket por usuário, 10 req/s com rajadas de 20 em `/api/**`, e 1 req/s com rajadas de 3 em `POST /api/holds`;
        - `inventory`: no máximo 6 assentos por hold e um hold ativo por usuário por evento (uma regra de negócio, garantida com o banco de dados).
    - **Store**: Redis (com uma réplica) para os baldes; se ele falhar, os gateways fazem **fail open** com um limite local de 1/6 do global.
    - **Respostas**: `429` com `Retry-After`; o app recua com jitter e mostra "muitas tentativas, tente de novo em alguns segundos".
    - **Assistente**: um limite separado e mais baixo e uma cota baseada no custo em tokens, porque uma chamada de LLM é muito mais cara que uma leitura do catálogo (veja [Sistemas de IA](../../ai-systems/index.md)).

!!! tip "Na entrevista"
    - Coloque o API gateway no desenho de alto nível e liste o que ele centraliza: **roteamento, autenticação, rate limiting, observabilidade**. Depois siga em frente — a menos que a pergunta seja um rate limiter.
    - Se pedirem para projetar um rate limiter: esclareça **chave, limite e escopo** (por usuário? por IP? global?), escolha **token bucket** (rajadas) ou **contador de janela deslizante** (precisão), guarde os contadores no **Redis com um script Lua atômico** e discuta **fail open vs closed**, **multi-região** (limites locais por região ou sincronização assíncrona) e a resposta **429 + Retry-After**.
    - Conheça o **problema de fronteira da janela fixa** (rajada de 2×) — é uma pergunta de follow-up clássica.
    - Mencione o **BFF** quando a pergunta tiver clientes muito diferentes (mobile, web, TV, parceiros).

!!! success "Boas práticas"

    - **Responda `429` com `Retry-After` (e os headers `RateLimit`)** — clientes bem-comportados recuam exatamente o tempo necessário, em vez de adivinhar.
    - **Rode um limite novo em modo de contagem (só log) antes de aplicá-lo** — meça quem teria sido limitado e só então ligue.
    - **Dê a cada rota a sua própria política de timeout e retry, com retries só em métodos idempotentes** — No BoxOffice: os timeouts de 1 s de conexão / 5 s de resposta do gateway e um filtro `Retry` limitado a `GET` no [lab 4](../../../hands-on/4/gateway/index.md) (quadro acima).
    - **Valide os JWTs localmente com chaves públicas em cache** — um JWKS buscado e guardado em cache pelo gateway não custa nenhuma chamada a `auth` por requisição. No BoxOffice: `jwk-set-uri` no `application.yaml` do lab 4.
    - **Meça o overhead e a capacidade do próprio gateway** — p50 passando pelo gateway versus direto, e o seu ponto de ruptura, para dimensioná-lo como qualquer outra camada.

!!! warning "Armadilhas"
    - **Gateway como ponto único de falha ou gargalo**: ele está no caminho de toda requisição. Rode várias réplicas em zonas diferentes, dimensione-o em testes de carga e mantenha pequeno o trabalho dele por requisição.
    - **Lógica de negócio no gateway**: scripts e plugins que calculam preços ou alocam assentos criam um segundo monólito, escondido, que ninguém testa. Mantenha o gateway burro e os serviços espertos.
    - **Confiar só no gateway**: os serviços ainda precisam verificar identidade e autorização (zero trust); um atacante dentro da rede contorna o gateway.
    - **Contadores por réplica** que multiplicam silenciosamente o limite pelo número de réplicas.
    - **Rate limiting só por IP**: milhares de fãs atrás do NAT de uma operadora móvel compartilham um IP; botnets têm milhares de IPs. Prefira chaves por usuário/API key, com limites por IP só na borda, e generosos.
    - **Refazer um `429` imediatamente**: clientes sem backoff transformam um limite numa tempestade de retries.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    GW["API gateway"] --> AUTH["validação de JWT<br/>→ Rede & Segurança"]
    GW --> RL["rate limiting"]
    RL --> TB["token bucket no Redis<br/>→ Cache (Redis)"]
    RL --> SHED["load shedding, 429<br/>→ Confiabilidade"]
    RL --> RETRY["retries do cliente com backoff<br/>→ tempestades de retries"]
    GW --> BFF["BFF por cliente"]
    BFF --> STYLES["REST, GraphQL, gRPC<br/>→ Computação: estilos de API"]
    GW --> OBS["access logs, métricas RED<br/>→ Observabilidade"]
    GW --> WR["sala de espera<br/>→ Mensageria (fila)"]
```

**Componentes da paleta:** [`apigw`](../../../reference/components/edge/index.md#apigw) · [`auth`](../../../reference/components/compute/index.md#auth) (emite os tokens que o gateway valida) · [`cache`](../../../reference/components/storage/index.md#cache) (contadores de rate limit compartilhados) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sala de espera) · [`waf`](../../../reference/components/edge/index.md#waf) (limites grossos por IP, antes do gateway). **Cenários:** `rate-limiter`, `retry-storm`, `flash-sale`. **Continua em:** [Estudo de caso: rate limiter](../../case-studies/rate-limiter/index.md), [Confiabilidade — padrões](../../reliability/patterns/index.md), [Rede & Segurança — identidade](../identity/index.md), [Hands-on 4](../../../hands-on/4/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Um API gateway é o **ponto de entrada único** das APIs: roteamento, offload de autenticação, rate limits, transformações, agregação e observabilidade — **só preocupações transversais**.
    - O padrão **BFF** dá a cada tipo de cliente a sua própria camada sob medida.
    - O **token bucket** (capacidade = rajada, reabastecimento = taxa sustentada) é o algoritmo padrão de rate limiting; o **leaky bucket** suaviza a saída; a **janela fixa** permite rajadas de 2× nas fronteiras; o **log de janela deslizante** é exato, mas pesado em memória; o **contador de janela deslizante** é uma aproximação barata e precisa.
    - Entre réplicas, mantenha os contadores no **Redis** e atualize-os **atomicamente** (Lua); decida entre **fail open ou closed**.
    - Limite em **camadas** (borda, gateway, serviço), responda **429 com Retry-After** e faça os clientes recuarem com jitter.

---

[^1]: RICHARDSON, C. [Pattern: API Gateway / Backends for Frontends](https://microservices.io/patterns/apigateway.html){target="_blank"}. microservices.io.
[^2]: NEWMAN, S. [Backends For Frontends](https://samnewman.io/patterns/architectural/bff/){target="_blank"}, 2015. Veja também NEWMAN, S. *Building Microservices*, 2ª ed. O'Reilly, 2021.
[^3]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 4 "Design a rate limiter". Byte Code LLC, 2020.
[^4]: CLOUDFLARE. [How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/){target="_blank"}. Cloudflare Blog, 2017.
[^5]: IETF HTTPAPI WG. [RateLimit header fields for HTTP](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/){target="_blank"}. Internet-Draft.
