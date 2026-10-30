
> *"Projete uma plataforma de ingressos como a Ticketmaster. Um show de estádio abre as vendas às 10:00: dois milhões de fãs, sessenta mil lugares. Ninguém pode ficar com o mesmo lugar duas vezes."*

Este é o caso principal da disciplina porque é o próprio **BoxOffice**, e porque reúne num só problema as ideias mais difíceis do semestre: um **pico** 100× maior que a carga normal que chega em segundos, um recurso **quente e fortemente consistente** (os lugares) que não dá para esconder atrás de um cache, uma **dependência externa** (o provedor de pagamento) lenta e às vezes fora do ar, e **tráfego adversário** (bots e cambistas). A maior parte do sistema é um catálogo chato e de muita leitura; a entrevista se decide nos dez minutos depois das 10:00.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star::material-star: difícil (favorito para sênior) |
| **Conceitos-chave** | sala de espera / fila virtual, controle de admissão com a Lei de Little, reservas de lugar com TTL, controle de concorrência (pessimista, otimista, update condicional), idempotência, máquina de estados do pedido, webhooks de pagamento |
| **Componentes da paleta** | [`cdn`](../../../reference/components/edge/index.md#cdn), [`waf`](../../../reference/components/edge/index.md#waf), [`apigw`](../../../reference/components/edge/index.md#apigw), [`queue`](../../../reference/components/messaging/index.md#queue), [`app`](../../../reference/components/compute/index.md#app), [`sql`](../../../reference/components/storage/index.md#sql), [`cache`](../../../reference/components/storage/index.md#cache), [`scheduler`](../../../reference/components/compute/index.md#scheduler), [`kafka`](../../../reference/components/messaging/index.md#kafka), [`payment`](../../../reference/components/external/index.md#payment), [`notifications`](../../../reference/components/compute/index.md#notifications), [`email`](../../../reference/components/external/index.md#email) |
| **Cenário do playground** | `flash-sale` |

!!! abstract "O que este caso treina"

    - **Estimar** a taxa de chegada de uma abertura de vendas e **derivar** a taxa de admissão de uma sala de espera com a Lei de Little.
    - **Projetar** reservas de lugar (*holds*) que nunca vendem o mesmo lugar duas vezes, e **comparar** lock pessimista, lock otimista e update condicional.
    - **Modelar** o checkout como uma máquina de estados que sobrevive a timeouts de pagamento, retentativas e webhooks atrasados.
    - **Identificar** os gargalos de uma venda relâmpago (linhas quentes, pools de conexão, o provedor de pagamento, bots) e **defender** os trade-offs (justiça vs. vazão, experiência do usuário vs. consistência).

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

Gaste os primeiros cinco minutos aqui (veja o [roteiro de entrevista](../../intro/interview-framework/index.md)). Um sistema de ingressos pode ser "a bilheteria de um teatro de 300 lugares" ou "a abertura de vendas da Eras Tour": as respostas abaixo mudam o design por completo.

### Requisitos funcionais { #functional-requirements }

1. Fãs navegam por eventos e locais (catálogo) e veem o **mapa de lugares** com disponibilidade ao vivo.
2. O fã escolhe lugares e recebe uma **reserva** (*hold*): os lugares ficam guardados para ele por alguns minutos (ex.: 10 min) enquanto paga.
3. O fã **paga** por um provedor de pagamento externo; com sucesso, o pedido é confirmado e os ingressos são emitidos (e-mail + app).
4. Reservas não pagas **expiram** e os lugares voltam à venda.
5. Em aberturas de alta demanda, os fãs aguardam numa **sala de espera** e são admitidos em ordem.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta (declare; o entrevistador vai pressionar) |
|---|---|
| **Corretude** | **Zero venda duplicada.** Um lugar é vendido no máximo uma vez — consistência forte no estoque. |
| **Escalabilidade** | Absorver 2 M de fãs chegando em ~2 minutos sem colapsar; os dias normais são ~100× mais calmos. |
| **Latência** | Reservar um lugar com p99 < 300 ms para fãs admitidos; páginas do catálogo com p99 < 200 ms. |
| **Disponibilidade** | 99,95% para navegação e checkout; a sala de espera precisa ficar de pé mesmo com o backend saturado (ela é o amortecedor). |
| **Justiça** | Ordem de chegada (ou um sorteio declarado), com limites por conta; bots não podem ganhar. |
| **Durabilidade** | Um pedido confirmado nunca se perde (pagamento cobrado ⇒ ingresso existe). |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Cadastro de eventos pelos produtores, preço dinâmico, marketplace de revenda, leitura física dos ingressos no portão, reembolsos. Cite-os numa frase e siga em frente.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Lugares marcados ou pista (*general admission*, GA)? | Lugares marcados = muitas linhas com pouca disputa cada; pista = **um contador quente**. Designs de concorrência diferentes. |
    | Qual o tamanho da maior abertura? Acontecem várias ao mesmo tempo? | Dimensiona a sala de espera e diz se vale particionar por evento. |
    | O fã escolhe o lugar exato, ou atribuímos o "melhor disponível"? | "Melhor disponível" permite ao servidor agrupar pedidos e evitar conflitos. |
    | Quanto dura uma reserva? Máximo de ingressos por conta? | O TTL da reserva e os limites alimentam a Lei de Little e a justiça. |
    | Processamos pagamentos ou usamos um provedor (Stripe, Adyen, Mercado Pago…)? | Provedor externo ⇒ webhooks, idempotência, conciliação. |
    | A sala de espera é FIFO ou um sorteio entre quem chegou cedo? | Política de justiça; FIFO premia bots com rede rápida. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

Os números é que tornam este problema interessante: o trabalho **total** é minúsculo (60 mil lugares cabem em poucos megabytes), mas o **pico** é brutal. Declare as premissas e depois calcule. O bloco abaixo é a estimativa em código — abra a aba *Source*, mude uma premissa e refaça no papel.

```python exec="1" source="tabbed-right"
# BoxOffice flash sale: assumptions (illustrative, change them freely)
fans        = 2_000_000   # fans who show up for the on-sale
arrival_s   = 120         # most of them arrive within ~2 min of 10:00
seats       = 60_000
per_order   = 2           # tickets per order (average)
checkout_s  = 300         # time an admitted fan spends choosing + paying
active_cap  = 10_000      # shoppers the inventory + payment path can serve at once
conversion  = 0.6         # admitted fans who end up buying
poll_s      = 10          # waiting-room status refresh interval
page_kb     = 100         # waiting-room page + assets
psp_s       = 2.0         # payment provider latency

orders       = seats / per_order
join_rate    = fans / arrival_s                 # joins per second at the door
no_queue_rps = fans * 5 / 60                    # 5 requests/fan in the 1st minute, no queue
naive_poll   = fans / poll_s                    # status polls if all hit the origin
admit_rate   = active_cap / checkout_s          # Little's Law: L = λ·W  →  λ = L / W
admits       = orders / conversion
sellout_min  = admits / admit_rate / 60
order_rate   = admit_rate * conversion
pay_inflight = order_rate * psp_s               # Little's Law again
seat_map_rps = active_cap / 3                   # each shopper refreshes the map every 3 s
edge_gb      = fans * page_kb / 1e6
inventory_mb = seats * 100 / 1e6                # ~100 B per seat row

rows = [
    ("orders", orders, ""), ("join_rate", join_rate, "req/s"),
    ("no_queue_rps", no_queue_rps, "req/s"), ("naive_poll", naive_poll, "req/s"),
    ("admit_rate", admit_rate, "fans/s"), ("admits", admits, "fans"),
    ("sellout_min", sellout_min, "min"), ("order_rate", order_rate, "orders/s"),
    ("pay_inflight", pay_inflight, "calls"), ("seat_map_rps", seat_map_rps, "req/s"),
    ("edge_gb", edge_gb, "GB"), ("inventory_mb", inventory_mb, "MB"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem — este parágrafo é o que o entrevistador quer ouvir:

- **Sem sala de espera**, o estoque veria ~170 mil requisições/s durante um minuto. Um único primário PostgreSQL faz alguns milhares de pequenas transações de escrita por segundo; nenhuma quantidade de servidores de aplicação resolve, porque o gargalo é um punhado de **linhas quentes**. ⇒ precisamos de **controle de admissão**.
- Com 10 mil compradores simultâneos e 5 minutos cada, a Lei de Little dá uma taxa de admissão de **~33 fãs/s (2 000/min)**, esgotamento em **~25 minutos** e apenas **~20 pedidos/s** — tranquilo para um banco bem indexado.
- A própria sala de espera precisa aguentar **~17 mil entradas/s** e, se todo mundo consultar a origem, **200 mil consultas/s**. ⇒ sirva a página pela **CDN** e torne o endpoint de status barato (um token assinado + a leitura de um único contador, cacheável por um segundo).
- Cerca de **40 chamadas de pagamento estão em andamento** a qualquer momento (20/s × 2 s). ⇒ dimensione o pool de conexões e o bulkhead do adaptador de pagamento para isso, não para os 2 M de fãs.
- O estoque inteiro tem **~6 MB**: armazenamento não é problema; **disputa** (*contention*) é.

---

## 3. API

Mantenha curta e orientada a recursos; os campos interessantes são os **tokens** e a **chave de idempotência**.

```http
POST /v1/events/{eventId}/queue                      → 201 {queueToken, position, etaSeconds}
GET  /v1/queue/{queueToken}                          → 200 {status: WAITING|ADMITTED, position, accessToken?}

GET  /v1/events/{eventId}                            → 200 event, venue, price levels   (CDN, minutes)
GET  /v1/events/{eventId}/availability?section=A     → 200 {seatsBitmap, version}      (cache, 1 s)

POST /v1/events/{eventId}/holds                      → 201 {holdId, seats, expiresAt} | 409 SEAT_TAKEN
     Authorization: Bearer <accessToken>
     Idempotency-Key: 7f3c…
     {"seatIds": ["A-12-07", "A-12-08"]}
DELETE /v1/holds/{holdId}                            → 204

POST /v1/orders                                      → 202 {orderId, status: PENDING_PAYMENT, paymentUrl}
     Idempotency-Key: 9a41…
     {"holdId": "…"}
GET  /v1/orders/{orderId}                            → 200 {status: CONFIRMED|PENDING_PAYMENT|EXPIRED|FAILED}

POST /v1/webhooks/payments                           ← provider callback, signed (HMAC)
```

- O **`accessToken`** é o que a sala de espera entrega: um token assinado de vida curta (ex.: um JWT com `eventId`, `userId`, `exp` = 15 min). O gateway recusa chamadas de reserva/pedido sem um token válido, então ninguém fura a fila chamando a API diretamente.
- **`Idempotency-Key`** em reservas e pedidos: redes móveis repetem requisições, usuários dão clique duplo; o servidor guarda a chave com a resposta e a devolve de novo em vez de criar uma segunda reserva ou pedido.
- `POST /v1/orders` devolve **202 Accepted**: o pagamento é assíncrono; o cliente consulta o pedido (ou recebe um push) até ficar `CONFIRMED`.

---

## 4. Modelo de dados { #4-data-model }

O estoque é pequeno, relacional e precisa de transações ⇒ **SQL** ([PostgreSQL](../../databases/transactions/index.md)), particionado por `event_id` se houver muitos eventos. O catálogo é quase só leitura e pode morar no mesmo banco atrás de um cache, ou num banco de documentos.

```sql
CREATE TABLE seat (
    event_id     BIGINT      NOT NULL,
    seat_id      TEXT        NOT NULL,             -- 'A-12-07' (section-row-number)
    section      TEXT        NOT NULL,
    price_cents  INT         NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'AVAILABLE',  -- AVAILABLE | HELD | SOLD
    hold_id      UUID,
    held_until   TIMESTAMPTZ,
    version      INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, seat_id)
);

CREATE TABLE hold (
    hold_id      UUID PRIMARY KEY,
    event_id     BIGINT      NOT NULL,
    user_id      BIGINT      NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    status       TEXT        NOT NULL               -- ACTIVE | CONVERTED | EXPIRED | RELEASED
);

CREATE TABLE ticket_order (
    order_id        UUID PRIMARY KEY,
    hold_id         UUID UNIQUE NOT NULL,           -- one order per hold
    user_id         BIGINT NOT NULL,
    total_cents     INT    NOT NULL,
    status          TEXT   NOT NULL,                -- PENDING_PAYMENT | CONFIRMED | FAILED | EXPIRED
    payment_ref     TEXT,                           -- provider's id
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox (                               -- transactional outbox → Kafka
    id BIGSERIAL PRIMARY KEY, topic TEXT, payload JSONB, created_at TIMESTAMPTZ DEFAULT now()
);
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Lugares, reservas, pedidos | SQL (`sql`) | Transações, restrições de unicidade, updates condicionais. Volume minúsculo, disputa alta. |
| Fila da sala de espera | Sorted set no Redis ou uma fila gerenciada (`queue`) | Milhões de entradas, consulta de posição em O(log n), descartável depois da venda. |
| Retrato da disponibilidade | Cache (`cache`), TTL de 1 s | 3 mil leituras/s por evento quente; um pouco desatualizado tudo bem — a reserva é a verificação real. |
| Páginas de evento, imagens | CDN (`cdn`) + object store | Estáticas, iguais para todos. |
| Eventos de pedido | Kafka (`kafka`) via outbox | Fan-out para notificação, analytics, antifraude — fora do caminho crítico. |

---

## 5. Design de alto nível { #5-high-level-design }

Leia o diagrama como dois caminhos. O **caminho barato** (catálogo, página de espera, disponibilidade) é servido pela CDN e pelos caches e nunca toca as linhas quentes. O **caminho caro** (reserva → pedido → pagamento) é protegido pela sala de espera, que deixa entrar só o que o banco e o provedor de pagamento aguentam.

``` diagram-sim
flowchart LR
    fan([Fã / mobile]) --> cdn["CDN<br/>páginas de evento, página de espera"]
    cdn --> waf["WAF<br/>bots, DDoS"]
    waf --> gw["API Gateway<br/>auth, rate limit,<br/>checagem do access token"]
    gw --> wr["Sala de espera"]
    wr --> q[("Fila<br/>sorted set no Redis")]
    gw --> cat["catalog"]
    cat --> cache[("Cache<br/>disponibilidade 1 s")]
    gw --> inv["inventory<br/>reservas"]
    inv --> sql[("PostgreSQL<br/>seat, hold, order")]
    gw --> ord["order"]
    ord --> sql
    ord --> pay["adaptador de pagamento"]
    pay --> psp[["Provedor de pagamento"]]
    psp -. webhook .-> pay
    sql -. outbox .-> kafka[["Kafka<br/>eventos de pedido"]]
    kafka --> notif["notification"] --> email[["E-mail / push"]]
    kafka --> an["analytics"]
    sched["scheduler<br/>expira reservas"] --> sql
```

O caminho feliz de um fã, passo a passo:

``` diagram-sim
sequenceDiagram
    autonumber
    participant F as Fã
    participant W as Sala de espera
    participant I as inventory
    participant O as order
    participant P as Provedor de pagamento
    participant N as notification
    F->>W: entra (10:00:03)
    W-->>F: queueToken, posição 48 210
    F->>W: consulta status (a cada 10 s, em cache)
    W-->>F: ADMITTED + accessToken (15 min)
    F->>I: POST /holds {A-12-07, A-12-08} + accessToken
    I->>I: UPDATE condicional (os dois lugares ou nenhum)
    I-->>F: 201 holdId, expiresAt = agora + 10 min
    F->>O: POST /orders {holdId} + Idempotency-Key
    O->>P: cria pagamento (chave de idempotência = orderId)
    O-->>F: 202 PENDING_PAYMENT, paymentUrl
    P-->>O: webhook: pagamento aprovado
    O->>O: lugares SOLD, pedido CONFIRMED, linha no outbox (uma transação)
    O-)N: OrderConfirmed (Kafka)
    N-->>F: e-mail + push com os ingressos
```

!!! example "No código do BoxOffice: onde mora cada caixa deste projeto"

    Este caso é o BoxOffice, e os labs construíram a maior parte das suas caixas. Os labs constroem um checkout mais simples que o da seção 6.3 — o pagamento é uma chamada síncrona com timeout e circuit breaker, não uma máquina de estados com webhooks —, mas todas as outras linhas são o mecanismo real. Leia os arquivos nesta ordem e você terá lido o projeto:

    | Componente | Lab | Arquivo para ler primeiro |
    |---|---|---|
    | Borda: balanceamento de carga, limite de taxa por chave | [Lab 3](../../../hands-on/3/index.md) | `infra/nginx/nginx.conf` |
    | API gateway: o token é verificado uma vez | [Lab 4](../../../hands-on/4/gateway/index.md) | `SecurityConfig.java` (gateway) |
    | Caminho de leitura do catálogo: cache-aside, lock contra stampede | [Lab 5](../../../hands-on/5/cache-aside/index.md) | `EventCache.java` |
    | Reservas de assento sem venda dupla | [Lab 6](../../../hands-on/6/holds/index.md) | `HoldService.java` |
    | Evento do pedido na mesma transação (outbox) | [Lab 7](../../../hands-on/7/outbox/index.md) | `Outbox.java`, `OutboxRelay.java` |
    | Sala de espera | [Lab 7](../../../hands-on/7/waiting-room/index.md) | `WaitingRoom.java` |
    | Consumidor de notificações idempotente, DLT | [Lab 7](../../../hands-on/7/consumer/index.md) | `NotificationService.java`, `KafkaConfig.java` |
    | SLOs e alertas de burn rate | [Lab 8](../../../hands-on/8/slo/index.md) | `slo-catalog.yaml` |
    | Pagamento: timeout, retry, circuit breaker, idempotência | [Lab 9](../../../hands-on/9/patterns/index.md) | `PaymentClient.java`, `PaymentService.java` |
    | Escalar antes das 10:00 | [Lab 10](../../../hands-on/10/autoscaling/index.md) | `catalog-hpa.yaml` |
    | Canary e o portão de desempenho | [Lab 11](../../../hands-on/11/canary/index.md) | `catalog-rollout.yaml`, `load/budget.js` |
    | Assistente de atendimento | [Lab 12](../../../hands-on/12/tools/index.md) | `agent.py`, `tools.py` |

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

O entrevistador vai escolher um ou dois destes. Comece pelo que protege a **corretude** (reservas), depois o que protege a **disponibilidade** (a sala de espera).

### 6.1 Reservas de lugar sem venda duplicada { #61-seat-holds-without-double-booking }

Dois fãs clicam no lugar A-12-07 no mesmo milissegundo. Exatamente um deve ganhar. Há quatro formas clássicas de garantir isso ([transações e isolamento](../../databases/transactions/index.md)):

=== "Update condicional (recomendado)"

    Um único comando, atômico por linha, sem lock explícito mantido durante uma ida e volta à aplicação. Reservas expiradas são recuperadas no mesmo comando (**expiração preguiçosa**).

    ```sql
    BEGIN;
    UPDATE seat
       SET status = 'HELD', hold_id = $1, held_until = now() + interval '10 minutes',
           version = version + 1
     WHERE event_id = $2
       AND seat_id = ANY($3)
       AND (status = 'AVAILABLE' OR (status = 'HELD' AND held_until < now()));
    -- the app checks: rows updated == number of seats requested, otherwise ROLLBACK → 409
    INSERT INTO hold (hold_id, event_id, user_id, expires_at, status)
         VALUES ($1, $2, $4, now() + interval '10 minutes', 'ACTIVE');
    COMMIT;
    ```

=== "Lock pessimista"

    Trava as linhas, verifica e depois atualiza. Simples de raciocinar; o lock dura a transação inteira, então mantenha-a curta e **trave sempre na mesma ordem** (ordene `seat_id`) para evitar deadlocks.

    ```sql
    BEGIN;
    SELECT seat_id, status, held_until FROM seat
     WHERE event_id = $1 AND seat_id = ANY($2)
     ORDER BY seat_id
       FOR UPDATE;            -- NOWAIT or SKIP LOCKED for "best available"
    -- app checks every row is free, then UPDATE ... ; COMMIT
    ```

=== "Lock otimista"

    Lê sem travar e escreve só se a `version` não mudou. Não há espera por lock, mas sob muita disputa a maioria das tentativas falha e repete — ruim para os lugares mais disputados.

    ```sql
    UPDATE seat SET status = 'HELD', hold_id = $1, version = version + 1
     WHERE event_id = $2 AND seat_id = $3 AND version = $4;   -- 0 rows → somebody won, retry
    ```

=== "Redis primeiro, SQL como verdade"

    `SET hold:{event}:{seat} <holdId> NX EX 600` no Redis dá uma reserva em menos de um milissegundo e que expira sozinha; o pedido continua gravado no SQL com um `UNIQUE (event_id, seat_id)` nos ingressos vendidos como guarda final. Mais rápido, mas dois armazenamentos precisam concordar (e se o Redis fizer failover e perder a chave?). Use quando medir que o caminho SQL é o gargalo — não por padrão.

    ```text
    SET hold:42:A-12-07 3f9a... NX EX 600   →  OK  (you got it)  |  nil (taken)
    ```

| Abordagem | Comportamento sob disputa | Armadilhas | Use quando |
|---|---|---|---|
| `UPDATE … WHERE status='AVAILABLE'` condicional | Os perdedores falham rápido (0 linhas) | É preciso checar o número de linhas | Padrão para lugares marcados |
| `SELECT … FOR UPDATE` | Os perdedores **esperam** o lock | Deadlocks, locks longos, pool esgotado | Verificações em várias etapas numa transação |
| Otimista (`version`) | Os perdedores repetem | Tempestade de retentativas em linhas quentes | Pouca disputa (dias normais) |
| Redis `SET NX EX` | O mais rápido, TTL embutido | Duas fontes de verdade | Taxas extremas, necessidade medida |

**Expiração.** Uma reserva precisa acabar mesmo que o fã feche o navegador. Combine (a) **expiração preguiçosa** no comando de reserva (um lugar `HELD` expirado conta como disponível), (b) um job do **scheduler** que varre as linhas de `hold` com `expires_at < now()` a cada poucos segundos e devolve os lugares para `AVAILABLE`, para o mapa ficar correto, e (c) **estender** a reserva enquanto um pagamento está em andamento, para que um fã que está pagando não perca o lugar no segundo 601.

!!! warning "Pista (GA): a única linha quente"

    Com ingressos de pista não há linhas por lugar, só `remaining = 60 000`. `UPDATE pool SET remaining = remaining - 2 WHERE remaining >= 2` é correto, mas **serializa todos os compradores numa linha só**. Soluções: dividir o estoque em N **subcontadores** (shards) e escolher um ao acaso; ou manter o contador no Redis (`DECRBY` num script Lua) e gravar os pedidos no SQL de forma assíncrona; ou **pré-alocar** o estoque nos tokens da sala de espera (cada fã admitido carrega o direito de comprar até 4).

### 6.2 A sala de espera (fila virtual) { #62-the-waiting-room-virtual-queue }

A sala de espera é **descarte de carga com boas maneiras**: em vez de deixar 2 M de requisições baterem no estoque e falharem ao acaso, ela transforma a rajada num **fluxo constante e medido** e diz a cada fã onde ele está.

``` diagram-sim
flowchart LR
    j["Fãs entram<br/>~17 mil/s"] --> rq[("Fila<br/>por sorteio<br/>ou chegada")]
    rq --> d{"Admissor<br/>a cada segundo"}
    d -->|"admite λ = L / W<br/>≈ 33 fãs/s"| tok["accessToken<br/>(assinado, 15 min)"]
    tok --> shop["Comprando<br/>≤ 10 mil ao mesmo tempo"]
    shop -->|"compra ou expira"| out([sai])
    out -. libera uma vaga .-> d
```

Pontos de design:

1. **Página estática na CDN.** A página de espera é HTML + JS em cache na borda; a única chamada dinâmica é a consulta de status, respondida pelo Redis (`ZRANK` para a posição) ou por um número "atendendo agora" em cache — o cliente compara com o próprio número, então a origem responde um valor só para todo mundo.
2. **Taxa de admissão pela Lei de Little.** O admissor deixa entrar `λ = L / W` fãs por segundo, onde `L` é o número de compradores que o caminho de checkout consegue atender (medido no teste de carga, ex.: 10 mil) e `W` o tempo que cada um passa (5 min). É um **laço fechado**: admite mais quando compradores saem cedo, admite menos quando o p99 de `POST /holds` sobe ou o provedor de pagamento fica lento.
3. **Justiça.** FIFO puro premia quem tem a conexão mais rápida — normalmente os bots. Uma política comum: todos que chegam **antes** das 10:00 recebem uma posição **aleatória** às 10:00 (um sorteio), e quem chega depois vai para o fim da fila em ordem de chegada.
4. **Tokens, não sessões.** A admissão gera um `accessToken` assinado (evento, usuário, validade). O gateway verifica a assinatura localmente — sem armazenamento de sessão compartilhado no caminho quente — e aplica o "máximo de 6 ingressos por conta".
5. **Bots.** O [WAF](../../edge/index.md) faz pontuação de bots, rate limit por IP/ASN e desafios; exigir uma conta logada e verificada para entrar na fila é o filtro mais forte. Queue-it, Cloudflare Waiting Room e a solução AWS Virtual Waiting Room são produtos reais construídos sobre essas ideias.

!!! example "Por que não só escalar automaticamente?"

    Servidores de aplicação escalam em um ou dois minutos; as **linhas de lugar** não escalam nada — há uma linha por lugar e todo mundo quer os melhores lugares. O primário do banco, o pool de conexões e o rate limit do provedor de pagamento estão fixos pelos próximos 30 minutos. O autoscaling ajuda o caminho barato (catálogo, sala de espera); o caminho caro precisa de **controle de admissão**.

### 6.3 Checkout e pagamento: uma máquina de estados, não uma chamada de função { #63-checkout-and-payment-a-state-machine-not-a-function-call }

Um provedor de pagamento responde em segundos, dá timeout e às vezes chama você de volta **antes** de sua requisição HTTP retornar. Modele o pedido como uma máquina de estados cujas transições são idempotentes ([integrações](../../compute/integrations/index.md), [caso do sistema de pagamentos](../payment-system/index.md)).

``` diagram-sim
stateDiagram-v2
    [*] --> HELD: POST /holds
    HELD --> PENDING_PAYMENT: POST /orders (estende a reserva)
    HELD --> EXPIRED: TTL (10 min) acaba
    PENDING_PAYMENT --> CONFIRMED: webhook aprovado
    PENDING_PAYMENT --> FAILED: webhook falhou / recusado
    PENDING_PAYMENT --> CONFIRMED: conciliação encontra o pagamento
    FAILED --> HELD: tenta outro cartão (reserva ainda válida)
    EXPIRED --> [*]
    CONFIRMED --> [*]
```

- **Chave de idempotência para o provedor** = `orderId`. Se o adaptador der timeout e repetir, o provedor devolve o mesmo pagamento em vez de cobrar duas vezes.
- **Os webhooks são a fonte da verdade** do resultado; são assinados (HMAC), podem chegar duas vezes ou fora de ordem, então o handler é `UPDATE ticket_order SET status='CONFIRMED' WHERE order_id=$1 AND status='PENDING_PAYMENT'` — uma segunda entrega não muda nada.
- **Confirme numa só transação**: lugares `HELD → SOLD`, pedido `CONFIRMED`, uma linha no `outbox`. Um relay publica o outbox no Kafka; o `notification` consome de forma **idempotente** (deduplica por `orderId`) e envia o e-mail ([padrões de mensageria](../../messaging/patterns/index.md)).
- **Conciliação.** Um job do scheduler lista pedidos `PENDING_PAYMENT` com mais de N minutos e pergunta o status ao provedor. Isso resolve webhooks perdidos — e o caso traiçoeiro "o pagamento foi aprovado **depois** que a reserva expirou": ou os lugares ainda estão livres (confirma) ou foram revendidos (estorna automaticamente e pede desculpas).
- **Resiliência.** Timeout + circuit breaker + bulkhead em volta do provedor ([padrões de confiabilidade](../../reliability/patterns/index.md)); se o breaker estiver aberto, **pare de admitir** novos fãs em vez de deixá-los reservar lugares que não vão conseguir pagar.

### 6.4 O caminho de leitura: mapa de lugares e catálogo { #64-the-read-path-seat-map-and-catalog }

Os fãs martelam o mapa de lugares. Servi-lo a partir da tabela `seat` colocaria as leituras nas mesmas linhas quentes das reservas.

- Mantenha um **bitmap de disponibilidade** por setor (um bit por lugar — 60 mil lugares = 7,5 kB) no cache, reconstruído a cada segundo a partir do banco ou atualizado pelos eventos de reserva/venda. Os clientes consultam (ou recebem via SSE) com um número de `version`.
- Aceite **desatualização**: o mapa pode mostrar como livre um lugar ocupado há 800 ms. O pedido de reserva é a verificação real; devolva `409 SEAT_TAKEN` com o bitmap atualizado para a interface se ajustar.
- **Pré-aqueça** a CDN e o cache antes das 10:00 (página do evento, imagens, bitmaps): um cache frio no momento do pico é um estouro de manada autoinfligido ([modos de falha de cache](../../caching/failure-modes/index.md)).
- Ofereça o **"melhor disponível"**: o servidor escolhe os lugares com `FOR UPDATE SKIP LOCKED`, então compradores concorrentes nunca esperam pelas linhas uns dos outros.

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado às 10:00 | Mitigação | Trade-off |
|---|---|---|---|
| Linhas quentes do estoque | Espera por lock nos melhores setores; o p99 explode | Controle de admissão; updates condicionais; "melhor disponível" com `SKIP LOCKED`; shards do contador de pista | Fãs esperam mais na fila |
| Pool de conexões do banco | Requisições esperam conexão, threads se acumulam | PgBouncer; pool pequeno e fixo dimensionado pela Lei de Little; timeouts | Rejeitar cedo (503) vs. esperar |
| Status da sala de espera | 200 mil consultas/s na origem | Página estática na CDN; número "atendendo agora" em cache; intervalo de consulta com jitter | Posição atualizada a cada 10 s, não em tempo real |
| Provedor de pagamento | Lento (5 s) ou fora do ar; o rate limit dele | Bulkhead + timeout + breaker; desacelerar o admissor; estender reservas durante o pagamento | A venda demora mais; alguns fãs perdem reservas |
| Webhooks | Perdidos, duplicados, fora de ordem | Handler idempotente; job de conciliação | Mais uma peça móvel (scheduler) |
| Expiração em massa | 5 mil reservas expiram juntas às 10:10; lugares piscam | TTLs com jitter; liberação em lotes; avisar "lugares podem voltar" | Um pouco injusto com os fãs tardios |
| Bots | Bots enchem a fila e reservam lugares para revender | Pontuação de bots no WAF, contas verificadas, limites por conta, sorteio na abertura | Atrito para os fãs reais |
| Caches frios | Estouro de manada na página do evento às 10:00:00 | Pré-aquecimento, coalescência de requisições, TTL longo no conteúdo estático | É preciso invalidar se o evento mudar |
| Região única | Queda da região durante a venda | Primário multi-AZ com standby síncrono; pausar a venda (a fila segura todo mundo) | Estoque ativo-ativo entre regiões é muito mais difícil (consenso) |

Os dois trade-offs para **dizer em voz alta**: **consistência acima de disponibilidade para o estoque** (se o banco estiver inacessível, pare de vender; nunca venda a partir de uma réplica desatualizada), e **justiça e estabilidade acima de velocidade bruta** (uma venda que leva 25 minutos organizados é melhor do que uma que cai no minuto 2).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

O cenário `flash-sale` reproduz o pico da abertura da venda (as nossas 10:00) num desenho que começa **sem** sala de espera: `users → lb → app → inventory-db`, com os compradores chamando o `payment provider` (cota de 500 req/s). O perfil `load` dele já contém o pico — um evento roteirizado multiplica o tráfego por 20 em t = 60 s, por 90 s.

!!! tip "Experimente"

    1. Rode o desenho inicial e observe a utilização do `app` e do `inventory-db` e a taxa de erros. Aumente as réplicas do `app`: o banco e a cota do pagamento saturam em seguida — é o caso "sem sala de espera" da seção 2: nenhuma quantidade de servidores de aplicação resolve.
    2. Siga as dicas (ou **Mostrar uma solução possível**): uma CDN, um cache para as leituras do catálogo e um API Gateway que manda as escritas para uma Message Queue — a sala de espera — drenada por workers `order`. Rode de novo e compare o p99, os erros e o atraso do consumidor (quanto o comprador espera na fila).
    3. Mude o número de workers `order`: encontre a taxa de admissão em que o atraso do consumidor fica abaixo da meta de 300 s sem passar da cota do provedor de pagamento.
    4. Injete uma degradação de latência no provedor de pagamento (⚡) ou coloque o caos em **medium**: o que acontece com as requisições em andamento dos workers (Lei de Little) e com a fila, e o que o admissor deveria fazer?

<div class="sdp" data-scenario="flash-sale" data-mode="full" data-height="640"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "O provedor de pagamento cai às 10:05. O que acontece?"

    O circuit breaker em volta do adaptador de pagamento abre depois de algumas falhas; `POST /orders` responde rápido com "pagamentos temporariamente indisponíveis" em vez de ficar pendurado. O **admissor pausa** (não adianta admitir fãs que não podem pagar), e as reservas de quem já está no checkout são **estendidas** pela duração da queda, para ninguém perder um lugar sem ter culpa. Quando o breaker entra em meio-aberto e as sondagens dão certo, a admissão volta devagar. Se a queda for longa, um segundo provedor (failover) é a decisão de negócio a discutir.

??? question "Como você barra os bots dos cambistas?"

    Em camadas: (1) exigir uma conta logada e verificada (telefone/cartão) **antes** de entrar na fila; (2) pontuação de bots no WAF, fingerprint de dispositivo e desafios na borda; (3) um **sorteio** entre todos que entram antes da abertura, o que elimina a vantagem de scripts rápidos em milissegundos; (4) limites por conta e por meio de pagamento aplicados na reserva e no pedido; (5) análise pós-venda para cancelar pedidos suspeitos. Nenhuma camada sozinha basta; o objetivo é tornar os bots caros, não impossíveis.

??? question "Por que não manter todo o estoque no Redis?"

    Dá — 60 mil lugares são minúsculos — e algumas plataformas guardam as reservas em memória. O custo é uma segunda fonte de verdade: um failover do Redis pode perder as últimas escritas (replicação assíncrona), então um lugar poderia ser reservado duas vezes. Se fizer isso, mantenha uma **guarda durável** no SQL (uma restrição de unicidade em `(event_id, seat_id)` nos ingressos vendidos), de modo que o pior caso seja um checkout que falha, nunca uma venda duplicada. Comece com SQL e updates condicionais; eles dão conta dos ~20 pedidos/s que o controle de admissão deixa passar.

??? question "O banco primário falha no meio da venda."

    Com um standby síncrono em outra zona de disponibilidade, o failover leva de segundos a um minuto e não perde transações confirmadas (RPO = 0). Durante o failover, reservas e pedidos falham; a sala de espera mantém todos no lugar (ela não depende do banco do estoque) e o admissor pausa. Os clientes repetem com as mesmas chaves de idempotência, então não surgem reservas duplicadas. Nunca faça failover do estoque para uma réplica **assíncrona** sem aceitar que reservas recentes podem se perder.

??? question "Dez grandes aberturas de vendas começam às 10:00 no mesmo dia. O design muda?"

    Particione por `event_id`: cada evento tem sua própria fila e admissor, e o estoque pode ser **fragmentado por evento** (eventos nunca compartilham lugares, então não há transações entre shards). As partes compartilhadas são a borda (CDN, WAF), o rate limit global do provedor de pagamento e a capacidade de notificação — reparta-as por evento (bulkheads) para que uma venda quente não deixe as outras sem recursos.

??? question "Como você testa isso antes da abertura real?"

    Um teste de carga que reproduza o **pico** (k6 com um executor de taxa de chegada subindo até a taxa de entrada esperada em segundos), com dados realistas (setores quentes, 2 ingressos por pedido) e o provedor de pagamento trocado por um stub com latência configurável ([engenharia de desempenho](../../performance/index.md)). Encontre o ponto de ruptura do caminho de checkout e ajuste a taxa de admissão abaixo dele, com margem. Acrescente um teste de caos — provedor lento, failover do banco, cache esvaziado — durante o teste de carga.

??? question "Como você mostraria aos fãs uma previsão de espera precisa?"

    Previsão ≈ posição / taxa de admissão. Como a taxa de admissão é ajustada dinamicamente, suavize-a (média móvel) e mostre uma faixa ("cerca de 20–30 minutos"). Mostre também quando os ingressos devem acabar: se `lugares restantes / ingressos por pedido` for menor que o número de fãs na sua frente, conte a verdade ao fã cedo.

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Catálogo + estoque + pedidos num servidor de aplicação e um banco SQL; um lock ou transação para duas pessoas não comprarem o mesmo lugar; cita cache para o catálogo. Ignora o pico ou tenta resolvê-lo com "mais servidores". |
| **Pleno** | Tudo acima mais reservas com TTL e expiração, criação de pedido idempotente, pagamento assíncrono com webhooks, outbox para notificações; estima o pico e reconhece o problema da linha quente; propõe uma sala de espera. |
| **Sênior** | Deriva a taxa de admissão com a Lei de Little e fecha o laço com o p99 e a saúde do provedor; compara as opções de controle de concorrência pelo comportamento sob disputa; projeta a máquina de estados do pedido com conciliação e o caso "pago depois de expirar"; discute justiça (sorteio vs. FIFO), bots, shards do contador de pista, semântica de failover (RPO = 0 para o estoque), isolamento entre eventos e como testar com carga. Declara explicitamente a escolha CP para o estoque. |

**Relacionados:** [Hands-on 6](../../../hands-on/6/index.md) (reservas de lugar e transações), [Hands-on 7](../../../hands-on/7/index.md) (outbox e fila da sala de espera), [Hands-on 9](../../../hands-on/9/index.md) (resiliência em volta do pagamento), [projeto em equipe](../../../exercises/project/index.md).

!!! success "Boas práticas"

    - **Faça de "um assento, um comprador" um fato do banco** — um `UPDATE ... WHERE status = 'AVAILABLE'` condicional ou um lock, nunca uma verificação no código seguida de uma escrita. No BoxOffice: o [`HoldService.java`](../../../hands-on/6/holds/index.md) compara três estratégias.
    - **Expire as reservas com um job, não quando alguém as lê** — os assentos precisam voltar à venda mesmo que ninguém olhe; o lab 6 libera as reservas expiradas a cada 5 s com `FOR UPDATE SKIP LOCKED`, para que várias réplicas possam rodá-lo.
    - **Defina a taxa de admissão a partir do joelho medido, com margem** — admita abaixo da vazão em que o p99 começa a subir, e reduza-a quando o provedor ficar lento.
    - **Ensaie a abertura de vendas antes da abertura de vendas** — um teste de carga de pico com o provedor substituído por um stub e um game day com falhas ([lab 9](../../../hands-on/9/index.md), [lab 11](../../../hands-on/11/performance-gate/index.md)).
    - **Guarde o mapa de assentos em cache por cerca de um segundo, nunca a decisão da reserva** — as leituras continuam baratas; toda decisão vai à fonte da verdade.

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["Ticketing (BoxOffice)"]) --> PERF["Performance<br/>Little's Law admission, spike test"]:::tech
    CASE --> EDG["Edge<br/>CDN, WAF, waiting room"]:::tech
    CASE --> DB["Databases<br/>seat holds: locks, conditional updates"]:::tech
    CASE --> CAC["Caching<br/>availability cached for 1 s"]:::tech
    CASE --> CMP["Compute<br/>checkout state machine, payment adapter"]:::tech
    CASE --> MSG["Messaging<br/>outbox, order events"]:::tech
    CASE --> REL["Reliability<br/>timeouts, retries, admission control"]:::tech
    EDG -.-> k1["cdn · waf · apigw · queue"]:::comp
    DB -.-> k2["sql · scheduler"]:::comp
    CAC -.-> k3["cache"]:::comp
    CMP -.-> k4["payment"]:::comp
    MSG -.-> k5["kafka · notifications · analytics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Borda](../../edge/index.md) (WAF, bots, sala de espera) · [Bancos de dados — transações](../../databases/transactions/index.md) · [Cache — modos de falha](../../caching/failure-modes/index.md) · [Compute — integrações](../../compute/integrations/index.md) · [Mensageria — padrões](../../messaging/patterns/index.md) · [Confiabilidade — padrões](../../reliability/patterns/index.md) · [Desempenho — planejamento de capacidade](../../performance/capacity-planning/index.md) · [Hands-on 6](../../../hands-on/6/index.md), [7](../../../hands-on/7/index.md) e [9](../../../hands-on/9/index.md). **Componentes da paleta:** [`cdn`](../../../reference/components/edge/index.md#cdn) · [`waf`](../../../reference/components/edge/index.md#waf) · [`apigw`](../../../reference/components/edge/index.md#apigw) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`sql`](../../../reference/components/storage/index.md#sql) · [`cache`](../../../reference/components/storage/index.md#cache) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) · [`payment`](../../../reference/components/external/index.md#payment) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`analytics`](../../../reference/components/compute/index.md#analytics). **Cenários:** `flash-sale`.

---

## Referências { #references }

- XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2, cap. 7 "Hotel Reservation System" (reservas, concorrência, idempotência)[^1].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed., capítulo sobre transações (atualizações perdidas, *write skew*, `SELECT … FOR UPDATE`)[^2].
- APIs idempotentes e chaves como usadas por provedores de pagamento[^3].
- Descarte de carga e tratamento de sobrecarga[^4].

[^1]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2. Byte Code LLC, 2022.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly.
[^3]: LEACH, B. [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency){target="_blank"}. Stripe Blog, 2017.
[^4]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}, cap. 21 "Handling Overload" e cap. 22 "Addressing Cascading Failures". O'Reilly, 2016.
