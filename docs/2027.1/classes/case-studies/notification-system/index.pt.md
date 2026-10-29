
> *"Projete um sistema de notificações que envia push, e-mails e SMS para muitos times de produto: confirmações de pedido, lembretes e campanhas de marketing. Os usuários precisam poder escolher o que recebem."*

O sistema de notificações é o problema clássico de **fan-out assíncrono para terceiros não confiáveis**. Nada aqui é computacionalmente difícil; o que o torna interessante é que todas as partes interessantes ficam **fora** do seu controle: os gateways de push da Apple e do Google, provedores de e-mail e SMS com seus próprios rate limits, celulares que desinstalam o app, caixas de entrada que devolvem mensagens. A entrevista verifica se você consegue construir um pipeline que absorve rajadas, **nunca envia a mesma mensagem duas vezes** (ou explica quando pode enviar), mantém as mensagens urgentes rápidas enquanto um disparo de marketing está escoando, e respeita o que o usuário pediu.

O BoxOffice envia três tipos bem diferentes de notificação, e eles tornam os requisitos concretos:

- **Transacional** — "seus ingressos para sábado" segundos depois do webhook de pagamento ([caso de ingressos](../ticketing/index.md)). Pouco volume, precisa chegar rápido, não pode se perder.
- **Agendada** — "os portões abrem em 2 horas" para os 60 000 portadores de ingresso do show de hoje. Conhecida com antecedência, todas no mesmo momento.
- **Campanha** — "a pré-venda da turnê de estádios começa sexta às 10:00" para os **5 milhões de seguidores** de um artista. Enorme, nada urgente e perigosa: se todo mundo tocar ao mesmo tempo, a notificação faz um DDoS no seu próprio app.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star: médio |
| **Conceitos-chave** | fila por canal e por prioridade, workers, registro de tokens de dispositivo, templates e preferências (opt-out, horário de silêncio, limites de frequência), idempotência e deduplicação, retentativas com backoff + jitter, DLQ, failover de provedor e circuit breakers, rate limits por provedor, scheduler e campanhas em lotes, rastreamento de entrega via webhooks |
| **Componentes da paleta** | [`scheduler`](../../../reference/components/compute/index.md#scheduler), [`queue`](../../../reference/components/messaging/index.md#queue), [`worker`](../../../reference/components/compute/index.md#worker), [`notifications`](../../../reference/components/compute/index.md#notifications), [`email`](../../../reference/components/external/index.md#email), [`thirdparty`](../../../reference/components/external/index.md#thirdparty), [`nosql`](../../../reference/components/storage/index.md#nosql), [`sql`](../../../reference/components/storage/index.md#sql), [`analytics`](../../../reference/components/compute/index.md#analytics) |
| **Cenário do playground** | `notification-system` |

!!! abstract "O que este caso treina"

    - **Estimar** a rajada de uma campanha em massa e **mostrar** que o rate limit de um terceiro, e não seus servidores, define quanto tempo ela leva.
    - **Projetar** um pipeline de filas e workers por canal e prioridade, para que o marketing nunca atrase uma redefinição de senha.
    - **Garantir** *efeito* de no máximo uma vez para o usuário quando possível, com IDs de notificação, consumidores idempotentes e recursos dos provedores — e **explicar** onde duplicatas ainda podem acontecer.
    - **Aplicar** retentativas com backoff e jitter, filas de mensagens mortas (DLQ), circuit breakers e failover de provedor a integrações externas.
    - **Espalhar** envios agendados e em massa no tempo para proteger os provedores e o seu próprio backend.

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

([roteiro de entrevista](../../intro/interview-framework/index.md))

### Requisitos funcionais { #functional-requirements }

1. Serviços internos **disparam** notificações por uma única API (`order`, `inventory`, `auth`…), por usuário e tipo, com os dados para o template.
2. Canais: **push** (iOS via APNs, Android via FCM), **e-mail** e **SMS**.
3. Notificações **agendadas** (enviar num horário) e **campanhas** (enviar para um público, ex.: todos os seguidores de um artista).
4. **Templates** por tipo, canal e idioma.
5. **Preferências do usuário**: opt-out por categoria e canal, horário de silêncio, link de descadastro em todo e-mail de marketing.
6. **Rastreamento**: enviada, entregue, aberta, devolvida, por notificação e por campanha.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta |
|---|---|
| **Latência** | Transacional: entregue ao provedor com p99 < 5 s. Campanhas: de minutos a uma hora está bom. |
| **Confiabilidade** | Nenhuma notificação aceita se perde em silêncio (retenta, depois DLQ com alerta) |
| **Duplicatas** | Um usuário não deve receber a mesma notificação duas vezes; duplicatas raras são toleradas, sistemáticas são bugs |
| **Escala** | ~12 M de notificações/dia, rajadas de milhões numa campanha |
| **Isolamento** | Uma campanha nunca pode atrasar mensagens transacionais |
| **Conformidade** | Respeitar opt-outs e descadastros na hora; regras de transacional e de marketing diferem |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Construir nossa própria infraestrutura de push ou e-mail (usamos provedores), o editor de conteúdo do marketing, testes A/B de texto, a interface da caixa de entrada no app (citada como follow-up).

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Quais canais, e quais são obrigatórios por tipo? | Fan-out por canal e provedores, custos e limites diferentes. |
    | Qual o tamanho da maior campanha? Quão rápido ela precisa sair? | Dimensiona filas e workers; o limite de um provedor pode tornar "rápido" impossível. |
    | Transacional e marketing no mesmo sistema? | Prioridades ou filas separadas para o marketing nunca bloquear o transacional. |
    | Uma duplicata é pior que uma perda? | Confirmação de pedido: duplicata tudo bem, perda não. Marketing: o contrário. |
    | Precisamos rastrear aberturas/cliques? | Webhooks, pixels de rastreamento, redirecionamento de links, armazenamento de analytics. |
    | Fusos horários e horário de silêncio? | O scheduler precisa adiar mensagens por usuário. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

```python exec="1" source="tabbed-right"
# Notification system: assumptions (illustrative)
transactional_day = 2_000_000   # order confirmations, receipts, password resets
scheduled_day     = 3_000_000   # reminders ("doors open in 2 h")
campaign_users    = 5_000_000   # followers of one big artist: presale alert
channels_per_user = 1.5         # push for everyone, e-mail for half of them
email_share       = 0.5         # share of campaign users who also get an e-mail
window_min        = 30          # how long we spread the campaign over
tap_share         = 0.1         # users who open the app right after the notification
email_limit_s     = 1_000       # e-mail provider sending limit per second (illustrative)
record_b          = 500         # one notification log record
dedup_days        = 7           # how long we remember notification ids
dedup_b           = 60          # one dedup key in the cache

campaign_msgs   = campaign_users * channels_per_user
daily_msgs      = transactional_day + scheduled_day + campaign_msgs
avg_rate        = daily_msgs / 86_400
blast_rate_1m   = campaign_msgs / 60                        # if sent within one minute
spread_rate     = campaign_msgs / (window_min * 60)
taps_blast      = campaign_users * tap_share / 60           # app requests caused by the blast
taps_spread     = campaign_users * tap_share / (window_min * 60)
email_drain_min = campaign_users * email_share / email_limit_s / 60
log_gb_day      = daily_msgs * record_b / 1e9
dedup_gb        = daily_msgs * dedup_days * dedup_b / 1e9

rows = [
    ("campaign_msgs", campaign_msgs, "msgs"), ("daily_msgs", daily_msgs, "msgs/day"),
    ("avg_rate", avg_rate, "msgs/s"), ("blast_rate_1m", blast_rate_1m, "msgs/s"),
    ("spread_rate", spread_rate, "msgs/s"), ("taps_blast", taps_blast, "req/s"),
    ("taps_spread", taps_spread, "req/s"), ("email_drain_min", email_drain_min, "min"),
    ("log_gb_day", log_gb_day, "GB/day"), ("dedup_gb", dedup_gb, "GB"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- A **média é minúscula** (~145 mensagens/s) e o **pico é enorme**: uma campanha de pré-venda são 7,5 M de mensagens, **125 mil/s** se disparada em um minuto. ⇒ uma **fila** entre o disparo e os remetentes, e workers que escoam a uma taxa controlada. É um problema de absorver rajadas, não de vazão.
- Disparar em um minuto também gera ~**8 mil requisições/s** no app de fãs que tocam na notificação — no mesmo backend que está preparando a pré-venda. Espalhar por 30 minutos reduz isso a **~280 req/s**. ⇒ **espalhe as campanhas numa janela**: o sistema de notificações precisa proteger o resto do BoxOffice, não só a si mesmo.
- Com um provedor de e-mail que aceita 1 000 mensagens/s, os 2,5 M de e-mails levam **~42 minutos**, não importa quantos workers rodemos. ⇒ o **limite do provedor** decide a duração; precisamos de rate limit por provedor, e e-mails transacionais precisam de **capacidade reservada** (uma prioridade separada), senão esperam 40 minutos atrás da campanha.
- O log de notificações tem **~6 GB/dia** e as chaves de deduplicação de uma semana **~5 GB** — pouco. Armazenamento não é o problema; ordenar o trabalho é.

---

## 3. API

```http
POST /v1/notifications                                   → 202 {notificationId, status: ACCEPTED}
     Idempotency-Key: order-81f3-confirmed
     {"userId": 42, "type": "order.confirmed", "priority": "transactional",
      "data": {"orderId": "81f3", "event": "Rock in Rio — Day 2", "seats": ["A-12-07", "A-12-08"]}}

POST /v1/campaigns                                       → 202 {campaignId, status: SCHEDULED}
     {"audience": {"followersOf": "artist:77"}, "type": "presale.alert",
      "sendAt": "2027-03-10T15:00:00Z", "spreadOver": "30m", "channels": ["push", "email"]}
POST /v1/campaigns/{campaignId}/cancel                   → 200 {sent, cancelled}

PUT  /v1/users/{userId}/preferences                      → 204
     {"marketing": {"push": true, "email": false}, "quietHours": {"from": "22:00", "to": "08:00"},
      "timezone": "America/Sao_Paulo", "locale": "pt-BR"}
POST   /v1/devices  {"userId": 42, "platform": "ios", "token": "…"}    → 201
DELETE /v1/devices/{token}                                              → 204

POST /v1/webhooks/{provider}                             ← delivered / bounced / complaint / opened (signed)
GET  /v1/notifications/{notificationId}                  → 200 {channel statuses, attempts}
```

- O disparo é **assíncrono**: `202 Accepted` significa "enfileirada de forma durável", não "entregue". Os produtores nunca esperam pela Apple ou pelo provedor de e-mail.
- A **`Idempotency-Key`** vem do evento de negócio (`order-81f3-confirmed`), então um produtor que repete — ou um evento consumido duas vezes do Kafka — cria **uma** notificação.
- A `priority` é definida pelo tipo (configurada centralmente), e não escolhida livremente por cada time — senão tudo vira "transacional".

---

## 4. Modelo de dados { #4-data-model }

```sql
-- Preferences, templates, campaigns: small, relational, read-mostly (SQL)
CREATE TABLE preference (
    user_id     BIGINT, category TEXT, channel TEXT,       -- 'marketing' | 'reminders' | 'transactional'
    enabled     BOOLEAN NOT NULL,
    PRIMARY KEY (user_id, category, channel)
);
CREATE TABLE user_settings (
    user_id BIGINT PRIMARY KEY, timezone TEXT, locale TEXT,
    quiet_from TIME, quiet_to TIME, email TEXT, phone TEXT, email_suppressed BOOLEAN DEFAULT false
);
CREATE TABLE device (
    token TEXT PRIMARY KEY, user_id BIGINT NOT NULL, platform TEXT NOT NULL,   -- ios | android | web
    active BOOLEAN NOT NULL DEFAULT true, last_seen TIMESTAMPTZ
);
CREATE TABLE template (
    type TEXT, channel TEXT, locale TEXT, version INT,
    subject TEXT, body TEXT,                                -- e.g. Mustache/Handlebars source
    PRIMARY KEY (type, channel, locale, version)
);
CREATE TABLE campaign (
    campaign_id UUID PRIMARY KEY, audience JSONB, type TEXT, send_at TIMESTAMPTZ,
    spread_over INTERVAL, status TEXT, cursor TEXT          -- where the audience expansion stopped
);
```

```text
# Notification log (NoSQL, partition = user_id, clustering = created_at DESC): write-heavy, append-only
notification {notification_id, user_id, type, channel, status: ACCEPTED|SENT|DELIVERED|FAILED|SKIPPED,
              provider, provider_msg_id, attempts, created_at, sent_at, reason}

# Dedup keys (cache) — one per notification and channel
SET notif:order-81f3-confirmed:push 1 NX EX 604800     → OK (first time) | nil (already sent)

# Per-user frequency cap (cache)
INCR cap:42:marketing:2027-03-10  → 2      EXPIRE … 86400
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Preferências, configurações, dispositivos, templates, campanhas | SQL (`sql`) + cache nos workers | Pequenos, relacionais, alterados por usuários e administradores; lidos a cada envio |
| Log / status das notificações | NoSQL (`nosql`), particionado por usuário | Milhões de inserções por dia, lido por usuário ("o que enviamos ao 42?") e por id |
| Chaves de dedupe, limites de frequência, rate limits de provedor | KV em memória com TTL (cache) | `SET NX` / `INCR` atômicos, expiram sozinhos |
| Trabalho em andamento | Filas (`queue`) por canal × prioridade, mais filas de retentativa e de mensagens mortas | Absorvem rajadas, isolam canais e prioridades |
| Eventos de entrega | Analytics (`analytics`) / data warehouse | Relatórios de campanha, taxas de devolução, comparação de provedores |

---

## 5. Design de alto nível { #5-high-level-design }

``` diagram-sim
flowchart LR
    ord["serviços order / inventory /<br/>auth"] --> api["API de notificações<br/>valida, idempotência"]
    camp["Serviço de campanhas"] --> sch["Scheduler<br/>sendAt, espalhamento, silêncio"]
    sch --> api
    api --> route["Roteador<br/>preferências, templates,<br/>dispositivos, limites"]
    route --> qt[["Filas: transacional<br/>push · email · sms"]]
    route --> qm[["Filas: em massa<br/>push · email · sms"]]
    qt --> wp["Workers de push"]
    qm --> wp
    qt --> we["Workers de e-mail"]
    qm --> we
    qt --> ws["Workers de SMS"]
    wp --> apns[["APNs / FCM"]]
    we --> esp[["Provedor de e-mail A / B"]]
    ws --> sms[["Provedor de SMS"]]
    wp -. falhou após retentativas .-> dlq[["DLQ"]]
    esp -. webhooks .-> trk["Rastreamento"]
    trk --> an[("Analytics")]
    route --> log[("Log de notificações")]
```

Uma confirmação de pedido, de ponta a ponta:

``` diagram-sim
sequenceDiagram
    autonumber
    participant O as order (consumidor Kafka)
    participant A as API de notificações
    participant R as Roteador
    participant Q as Fila (e-mail transacional)
    participant W as Worker de e-mail
    participant P as Provedor de e-mail
    participant T as Rastreamento
    O->>A: POST /notifications (Idempotency-Key order-81f3-confirmed)
    A->>A: primeira vez? grava ACCEPTED
    A-->>O: 202
    A->>R: route(usuário 42, order.confirmed)
    R->>R: preferências ok, renderiza o template pt-BR
    R->>Q: enfileira job de e-mail
    Q->>W: job (tentativa 1)
    W->>P: envia (timeout 3 s)
    P--xW: 503 Service Unavailable
    W->>Q: reenfileira com backoff 2 s ± jitter
    Q->>W: job (tentativa 2)
    W->>P: envia
    P-->>W: 202 aceito, id do provedor
    W->>W: status SENT
    P-->>T: webhook entregue
```

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

### 6.1 Canais, filas e prioridades { #61-channels-queues-and-priorities }

Cada canal tem seu próprio provedor, modos de falha e limites, então cada um ganha sua **própria fila e pool de workers** — um provedor de SMS lento não pode parar as notificações push (um [bulkhead](../../reliability/patterns/index.md)). Cada canal também tem (pelo menos) duas **prioridades**: transacional e em massa.

=== "Push (APNs / FCM)"

    O dispositivo registra seu **token** na nossa API depois do login. Os workers enviam para o Apple Push Notification service (iOS) ou o Firebase Cloud Messaging (Android, web). Os payloads são pequenos (alguns kB). Os provedores avisam quando um token morreu (o APNs responde `410 Unregistered`, o FCM `UNREGISTERED`): **desative o token**, ou você continua pagando por envios para apps desinstalados. Push é melhor esforço: a entrega a um celular desligado é adiada ou descartada pela plataforma.

=== "E-mail"

    Enviado por um provedor de e-mail (Amazon SES, SendGrid, Mailgun…). A entregabilidade depende da **reputação do seu domínio**: registros SPF, DKIM e DMARC, uma **lista de supressão** para devoluções permanentes e reclamações de spam (nunca mais envie para eles) e um cabeçalho de **descadastro** em um clique nos e-mails de marketing (RFC 8058). A vazão é limitada pela taxa de envio do provedor.

=== "SMS"

    O canal mais caro por mensagem e o mais regulado (IDs de remetente, regras de opt-in por país). Use-o só para o que realmente precisa (códigos de uso único, mudanças críticas como "seu evento foi cancelado"). Os provedores têm limites por segundo e os recibos de entrega chegam por webhook.

| Canal | Latência típica | Custo por mensagem | Sinal de confiabilidade | Limite principal |
|---|---|---|---|---|
| Push | Segundos | ~De graça | Provedor aceitou; entrega no aparelho não garantida | Validade do token, tamanho do payload |
| E-mail | Segundos a minutos | Baixo | Webhooks de entregue / devolvido / reclamação | Taxa do provedor, reputação do domínio |
| SMS | Segundos | Alto | Recibos de entrega (DLR) | Custo, regras das operadoras, taxa do provedor |

**Prioridades.** Duas filas separadas por canal (ou um sistema de filas com prioridade estrita) e **pools de workers separados ou capacidade reservada** para o transacional. Uma campanha de 2,5 M de e-mails escoa então no limite do provedor *menos* a fatia reservada ao transacional, e a confirmação do pedido continua saindo em segundos.

### 6.2 Entregar uma vez: idempotência, retentativas, DLQ e failover { #62-delivering-once-idempotency-retries-dlq-and-failover }

O pipeline é **pelo menos uma vez** de ponta a ponta — filas reentregam quando um worker cai, workers repetem quando um provedor dá timeout ([semântica de entrega](../../messaging/semantics/index.md)). Para o **efeito** ser "uma vez" para o usuário:

1. **ID da notificação vindo do evento de negócio.** A API guarda `Idempotency-Key → notificationId`; um segundo disparo para `order-81f3-confirmed` devolve a notificação existente.
2. **Workers idempotentes.** Antes de chamar o provedor, o worker reivindica `notif:{id}:{channel}` com `SET NX`; um job reentregue encontra a chave e só verifica o status.
3. **Guardas do lado do provedor, quando existem.** O `apns-collapse-id` do APNs faz o aparelho mostrar só a notificação mais recente com aquele ID; várias APIs de e-mail e SMS aceitam uma chave de idempotência ou uma referência do cliente.

```python
def handle(job):
    key = f"notif:{job.notification_id}:{job.channel}"
    if not cache.set(key, "sending", nx=True, ex=7 * 86_400):
        return ack(job)                                   # already handled: duplicate delivery
    try:
        provider_id = provider.send(job.payload, timeout=3, idempotency_key=job.notification_id)
        log.update(job.notification_id, job.channel, status="SENT", provider_id=provider_id)
        return ack(job)
    except (Timeout, ProviderUnavailable, RateLimited) as err:
        cache.delete(key)                                 # allow the retry to claim it again
        if job.attempt >= MAX_ATTEMPTS:
            return dead_letter(job, reason=str(err))      # alert + manual or automatic replay
        delay = min(300, 2 ** job.attempt) * random.uniform(0.5, 1.5)   # backoff + jitter
        return retry_later(job, delay)
    except InvalidRecipient:
        devices.deactivate(job.token)                     # permanent: do not retry
        log.update(job.notification_id, job.channel, status="FAILED", reason="invalid recipient")
        return ack(job)
```

!!! warning "Onde duplicatas ainda podem acontecer"

    Se o provedor **aceitou** a mensagem mas a resposta se perdeu (timeout), o worker não tem como saber se ela foi enviada. Repetir arrisca uma duplicata; não repetir arrisca uma perda. Para mensagens transacionais escolha **repetir** (um e-mail duplicado de "seus ingressos" é inofensivo) e apoie-se em chaves de idempotência e collapse IDs dos provedores. Diga isso explicitamente na entrevista: "entrega exatamente uma vez" para um terceiro não existe; o *efeito* de exatamente uma vez é construído com idempotência onde o outro lado a suporta.

**Falhas por tipo.** Distinga erros **transitórios** (timeouts, `429`, `5xx`: repita com backoff exponencial e jitter), erros **permanentes** (token inválido, devolução permanente: não repita, corrija os dados) e **mensagens venenosas** (um template que falha ao renderizar: direto para a DLQ). A **fila de mensagens mortas** é monitorada; uma DLQ não vazia alerta alguém e tem uma ferramenta de reprocessamento.

**Queda de provedor.** Um circuit breaker por provedor abre quando os erros se acumulam ([integrações](../../compute/integrations/index.md)). Para e-mail e SMS, mantenha um **segundo provedor** e faça failover do tráfego transacional para ele (o em massa pode simplesmente esperar). Para push não há alternativa ao APNs/FCM: enfileire e espere, e descarte pushes de marketing que ficaram velhos (um alerta de pré-venda depois que a pré-venda começou é ruído).

!!! example "No código do BoxOffice: o consumidor idempotente e sua DLT (lab 7)"

    O [Hands-on 7 — Consumidor idempotente e DLT](../../../hands-on/7/consumer/index.md) constrói o passo 2 e os tipos de falha desta seção para o e-mail do pedido. A deduplicação é uma linha no PostgreSQL em vez de um `SET NX` no Redis: `INSERT ... ON CONFLICT DO NOTHING` no id do evento, na **mesma transação** do registro de envio, então se o e-mail falha a linha de deduplicação também é desfeita e a retentativa pode reivindicá-la de novo — o `cache.delete(key)` do esboço acima, de graça. Erros transitórios recebem 3 retentativas (0,5 s, 1 s, 2 s); eventos malformados vão direto para `order-events-dlt`. No lab, rebobinar o grupo de consumidores reprocessa todos os eventos e a caixa de correio continua com **2** e-mails; com a deduplicação desligada, cada reprocessamento envia todos de novo.

    ``` { .java title="services/notification/src/main/java/boxoffice/notification/NotificationService.java (dedupe and send)" }
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationService.java:26:47"
    ```

    ``` { .java title="services/notification/src/main/java/boxoffice/notification/KafkaConfig.java (retries and DLT)" }
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/KafkaConfig.java:16:28"
    ```

### 6.3 Preferências, templates e limites { #63-preferences-templates-and-limits }

O roteador aplica uma sequência fixa de verificações antes de enfileirar qualquer coisa — filtros baratos primeiro:

``` diagram-sim
flowchart LR
    t["Disparo<br/>usuário 42, presale.alert"] --> p{"Aceitou push<br/>de marketing?"}
    p -->|não| skip1["SKIPPED (log)"]
    p -->|sim| c{"Limite de frequência<br/>≤ 3 de marketing/dia?"}
    c -->|excedido| skip2["SKIPPED (log)"]
    c -->|ok| qh{"Horário de silêncio<br/>no fuso do usuário?"}
    qh -->|sim| def["Adia para o scheduler<br/>(08:00 local)"]
    qh -->|não| r["Renderiza o template<br/>(locale pt-BR)"]
    r --> d["Busca os dispositivos"]
    d --> q[["Fila push (em massa)"]]
```

- **As preferências ficam em cache** no roteador (são lidas a cada envio e mudam raramente); mesmo assim um opt-out precisa valer em segundos, então invalide na mudança.
- **O transacional ignora** limites de frequência e horário de silêncio (uma confirmação de ingresso às 23:00 é esperada); o marketing nunca ignora. A categoria é fixa por tipo, de forma central.
- **Templates** são versionados por tipo, canal e idioma; renderize no roteador (ou no worker) com os dados do disparo, e caia para um idioma padrão. Um erro de renderização é uma mensagem venenosa.
- **Limites de frequência** (`INCR` com TTL diário por usuário e categoria) protegem os usuários de cinco times enviando cada um "só um" push por dia.
- **Rate limits dos provedores** são aplicados pelos workers com um **token bucket** compartilhado por provedor e conta ([caso do rate limiter](../rate-limiter/index.md)), então desaceleramos **antes** de o provedor começar a responder `429`.

### 6.4 Envios agendados e campanhas { #64-scheduled-sends-and-campaigns }

**Notificações agendadas** ("os portões abrem em 2 h") são guardadas com um `send_at`; o [scheduler](../../compute/async-work/index.md) consulta um índice por faixa de tempo (`WHERE send_at <= now() AND status = 'PENDING'`, reivindicado com `FOR UPDATE SKIP LOCKED` para que várias instâncias do scheduler não enviem em dobro) ou usa uma fila com atraso. 60 000 lembretes exatamente às 18:00 já são uma mini-campanha: espalhe-os por alguns minutos.

**Campanhas** são expandidas em lotes, nunca como um único job gigante:

``` diagram-sim
sequenceDiagram
    autonumber
    participant C as Serviço de campanhas
    participant G as Seguidores (grafo social)
    participant S as Scheduler
    participant R as Roteador
    C->>G: página de seguidores de artist:77 (cursor, 10 000)
    G-->>C: ids de usuários + próximo cursor
    C->>C: salva o cursor (retomável)
    C->>S: lote com horários de envio espalhados por 30 min (com jitter)
    S->>R: lotes vencidos, a uma taxa controlada
    R->>R: preferências, limites, silêncio, renderização
    Note over C,R: repete até o cursor acabar (ou a campanha ser cancelada)
```

- **Retomável**: o cursor é salvo depois de cada página; se o serviço de campanhas reiniciar, ele continua em vez de recomeçar (e as duplicatas são barradas pelas chaves de dedupe de qualquer forma).
- **Espalhe com jitter**: cada lote recebe horários de envio distribuídos pela janela, então os provedores veem uma taxa plana e o BoxOffice vê ~280 toques/s em vez de 8 000 (seção 2). O mesmo raciocínio da sala de espera: transformar um pico num fluxo.
- **Botão de emergência**: `cancel` para a expansão e faz os workers descartarem os jobs daquela campanha — essencial quando o texto tem uma data errada.
- **Fusos horários**: "às 10:00 no horário local" significa um agendamento de lotes por fuso horário.

**Rastreamento.** Os provedores informam `delivered`, `bounced`, `complaint` (e no e-mail, aberturas por um pixel de rastreamento e cliques por links redirecionados) por webhooks assinados. O serviço de rastreamento atualiza o log de notificações e envia os eventos para o armazenamento de analytics para os relatórios de campanha. Aberturas são aproximadas: alguns clientes de e-mail pré-carregam as imagens (o Apple Mail Privacy Protection, por exemplo), inflando as taxas de abertura.

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Rajada de campanha | Milhões de jobs inundam filas e provedores | Expansão em lotes; espalhar numa janela; token bucket por provedor | A campanha leva dezenas de minutos |
| Inversão de prioridade | Confirmação de pedido espera atrás de uma campanha | Filas/pools de workers separados por prioridade; capacidade reservada no provedor | Capacidade reservada ociosa |
| Provedor lento / fora do ar | Workers bloqueiam; a fila cresce | Timeouts, circuit breaker, segundo provedor para e-mail/SMS, descartar marketing velho | Dois provedores para integrar e pagar |
| Duplicatas | Reentrega ou retentativa após resultado desconhecido | Chave de idempotência do evento, reivindicação com `SET NX`, idempotência/collapse IDs do provedor | Estado de dedupe; duplicatas raras continuam |
| Mensagens venenosas | Um template quebrado é repetido para sempre | Classificar erros; DLQ para não repetíveis; alerta na profundidade da DLQ | Trabalho manual de reprocessamento |
| Tokens mortos / devoluções | Pagar por envios impossíveis; a reputação cai | Desativar tokens em `410`/`UNREGISTERED`; lista de supressão | Precisa tratar novos registros |
| DDoS autoinfligido | Todo mundo toca no push ao mesmo tempo | Espalhar os envios; pré-aquecer o cache da página de destino | Os últimos destinatários sabem depois |
| Cache de preferências desatualizado | Usuário que saiu ainda é notificado | Invalidar na mudança; checar no envio para marketing | Uma consulta a mais |

Os trade-offs para **dizer em voz alta**: **duplicatas vs. perdas** (no transacional, repita e aceite duplicatas raras), **velocidade vs. proteção** (uma campanha espalhada por 30 minutos é mais lenta, mas segura para os provedores e para o BoxOffice), e **isolamento vs. utilização** (pools separados por canal e prioridade desperdiçam alguma capacidade, mas tornam as falhas locais).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

O cenário `notification-system` tem um scheduler e produtores alimentando uma fila, workers por canal e provedores externos de e-mail/push.

!!! tip "Experimente"

    1. Rode com o perfil **spike** (uma campanha) e observe a profundidade da fila e o lag dos consumidores: quanto tempo o backlog leva para escoar?
    2. Acrescente workers: o tempo de escoamento melhora, ou o provedor externo vira o limite? (Esse é o número `email_drain_min` da seção 2.)
    3. Coloque o caos em **medium** para deixar lento ou derrubar o provedor de e-mail: as retentativas se acumulam? Onde um circuit breaker e uma DLQ ajudariam?
    4. Compare a latência da primeira e da última notificação da rajada — essa diferença é o que uma mensagem transacional sofreria sem uma fila de prioridade separada.

<div class="sdp" data-scenario="notification-system" data-mode="full" data-height="640" data-profile="spike"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "Como você garante que um usuário não receba a mesma notificação duas vezes?"

    Em camadas: uma chave de idempotência derivada do evento de negócio na API (uma notificação por evento); uma reivindicação `SET NX` por notificação e canal no worker (um envio por job reentregue); recursos dos provedores (collapse IDs, chaves de idempotência) para o caso em que o provedor aceitou mas não recebemos a resposta. E seja honesto: quando o resultado de um envio é desconhecido, você escolhe entre uma possível duplicata e uma possível perda — para mensagens transacionais, prefira a duplicata.

??? question "O provedor de e-mail fica fora do ar por uma hora. O que acontece?"

    O circuit breaker abre depois de uma rajada de falhas, então os workers param de martelá-lo. O e-mail transacional faz failover para o provedor secundário (pré-configurado, com sua própria autenticação de domínio). O e-mail em massa fica na fila e volta quando o breaker entra em meio-aberto e as sondagens dão certo; mensagens de marketing cujo conteúdo venceu (uma pré-venda que já começou) são descartadas. Push e SMS não são afetados porque têm suas próprias filas e workers.

??? question "Um usuário tem um celular, um tablet e o app web. Quem recebe o push?"

    Todos os dispositivos ativos do usuário, por padrão — o registro de dispositivos tem uma linha por token. Use um **collapse ID** para a mesma notificação se substituir em vez de se empilhar, e quando o usuário a abre num dispositivo, envie uma atualização silenciosa para limpá-la dos outros (a mesma ideia de confirmação do [caso do chat](../chat/index.md)). Tokens que o provedor informa como mortos são desativados.

??? question "Como você envia 'os portões abrem em 2 horas' exatamente na hora para 60 000 pessoas?"

    O horário do evento é absoluto, então `send_at = abertura_dos_portões - 2 h` é o mesmo instante para todos; o scheduler começa o lote alguns minutos antes e o espalha (ninguém percebe 18:00 vs. 17:57). Use `FOR UPDATE SKIP LOCKED` (ou uma fila com atraso particionada) para que várias instâncias do scheduler dividam o trabalho sem enviar em dobro, e marque cada linha como `ENQUEUED` na mesma transação que a reivindica.

??? question "O marketing enviou uma campanha com a data errada. Dá para parar?"

    Sim, se o sistema foi construído para isso: campanhas são expandidas em lotes com um cursor salvo, então `cancel` para a expansão; os workers verificam o status da campanha (em cache por segundos) antes de enviar cada job e descartam os jobs de campanhas canceladas. Mensagens já entregues aos provedores não podem ser recolhidas — mais um motivo para espalhar campanhas no tempo em vez de dispará-las de uma vez.

??? question "As notificações precisam ser ordenadas?"

    Normalmente não de forma global, mas alguns pares importam: "pagamento recebido" não deveria chegar depois de "pedido cancelado". Evite depender da ordem: torne cada notificação autocontida (ela informa o estado atual, renderizado na hora do envio), use uma chave de ordenação por usuário na fila quando realmente importar, e aglutine notificações superadas (um status mais novo substitui o mais antigo).

??? question "Como você acrescentaria uma caixa de entrada de notificações no app?"

    Guarde toda notificação do canal in-app no log de notificações (particionado por usuário, mais novas primeiro) com uma flag `read`, exponha `GET /v1/users/{id}/inbox?cursor=…` e envie "você tem um item novo" pela conexão em tempo real do app quando ele estiver aberto. A caixa de entrada vira só mais um canal com seu próprio worker, que grava no armazenamento em vez de chamar um provedor.

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Uma API que chama o provedor de push ou e-mail diretamente quando um serviço pede; uma tabela de notificações. Sem fila, sem retentativas; o produtor espera pelo provedor. |
| **Pleno** | Pipeline assíncrono com filas e workers por canal; templates e preferências; retentativas com backoff; DLQ; registro de tokens de dispositivo; cita idempotência e os rate limits dos provedores. |
| **Sênior** | Estima a rajada da campanha e identifica o limite do provedor como gargalo; separa prioridades para o transacional nunca atrasar; idempotência de ponta a ponta com discussão honesta dos resultados desconhecidos; classificação de erros (transitório, permanente, veneno); circuit breakers e failover de provedor; limites de frequência e horário de silêncio; campanhas em lotes, retomáveis e espalhadas no tempo para proteger o backend; rastreamento via webhooks e listas de supressão. |

**Relacionados:** [Filas e pub/sub](../../messaging/queues-pubsub/index.md), [Semântica de entrega](../../messaging/semantics/index.md), [Trabalho assíncrono e schedulers](../../compute/async-work/index.md), [Integrações externas](../../compute/integrations/index.md), [Hands-on 7](../../../hands-on/7/index.md) (consumidor `notification` idempotente e DLQ), [Caso de ingressos](../ticketing/index.md).

!!! success "Boas práticas"

    - **Derive o id da notificação do evento de negócio** — `order-81f3-confirmed`, para que toda camada consiga deduplicar. No BoxOffice: o lab 7 deduplica pelo id do evento ([lab 7](../../../hands-on/7/consumer/index.md)).
    - **Dê a cada canal e prioridade a sua própria fila** — uma confirmação de pedido nunca espera atrás de uma campanha de marketing.
    - **Crie alerta para uma fila de mensagens mortas não vazia e tenha uma ferramenta de reprocessamento** — a `order-events-dlt` do lab 7 guarda o tópico original e a exceção nos cabeçalhos, pronta para reprocessar.
    - **Aplique horários de silêncio e limites de frequência no pipeline, antes da chamada ao provedor** — uma preferência que o código não aplica é uma reclamação esperando para acontecer.
    - **Acompanhe enviados, entregues e devolvidos por provedor** — um provedor que aceita e não entrega parece saudável em todas as outras métricas.

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["Notification system"]) --> EST["Estimation<br/>a provider limit sets campaign time"]:::tech
    CASE --> CMP["Compute<br/>scheduler, workers, provider adapters"]:::tech
    CASE --> MSG["Messaging<br/>queue per channel and priority, DLQ"]:::tech
    CASE --> DIS["Distributed<br/>dedup, at-most-once effect"]:::tech
    CASE --> REL["Reliability<br/>retries + jitter, bulkheads, failover"]:::tech
    CMP -.-> k1["scheduler · worker<br/>notifications"]:::comp
    MSG -.-> k2["queue"]:::comp
    REL -.-> k3["email · thirdparty"]:::comp
    DIS -.-> k4["nosql<br/>(notification log)"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Compute — trabalho assíncrono](../../compute/async-work/index.md) · [Compute — integrações](../../compute/integrations/index.md) · [Mensageria — filas e pub/sub](../../messaging/queues-pubsub/index.md) · [Mensageria — semântica](../../messaging/semantics/index.md) · [Confiabilidade — padrões](../../reliability/patterns/index.md) · [Hands-on 7](../../../hands-on/7/index.md). **Componentes da paleta:** [`scheduler`](../../../reference/components/compute/index.md#scheduler) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`worker`](../../../reference/components/compute/index.md#worker) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`email`](../../../reference/components/external/index.md#email) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`analytics`](../../../reference/components/compute/index.md#analytics). **Cenários:** `notification-system`, `async-queue`.

---

## Referências { #references }

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 10 "Design a Notification System"[^1].
- Documentação do Apple Push Notification service (tokens, `apns-collapse-id`, respostas de erro)[^2].
- Documentação do Firebase Cloud Messaging (tipos de mensagem, códigos de erro)[^3].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed., capítulos sobre processamento de streams e semântica de exatamente uma vez[^4].
- Descadastro em um clique para e-mails de marketing[^5].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: APPLE. [Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns){target="_blank"}. Apple Developer Documentation.
[^3]: GOOGLE. [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging){target="_blank"}. Firebase Documentation.
[^4]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly.
[^5]: LEVINE, J.; HERKULA, T. [RFC 8058 — Signaling One-Click Functionality for List Email Headers](https://www.rfc-editor.org/rfc/rfc8058){target="_blank"}. IETF, 2017.
