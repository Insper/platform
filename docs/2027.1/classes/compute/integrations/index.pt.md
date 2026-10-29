Às 10:03 do dia da abertura de vendas, um fã clica em **Pagar**. O serviço `payment` da BoxOffice chama o provedor de pagamentos, e a chamada dá timeout depois de 5 segundos. O cartão foi cobrado? O fã, vendo o indicador de carregamento girar, clica em **Pagar** de novo. Trinta segundos depois, o provedor envia uma notificação de que a *primeira* cobrança foi aprovada — e depois outra, da segunda. Enquanto isso, o provedor de e-mail está aplicando rate limit na BoxOffice porque 40 mil e-mails de confirmação foram enviados em 5 minutos, e uma API de mapas de locais usada na página do evento está fora do ar.

A BoxOffice compra de propósito seus **subdomínios genéricos** ([serviços](../services/index.md#subdomains-where-to-invest)) — processamento de cartões, entrega de e-mails, mapas. É a decisão certa, e ela transforma cada um deles numa dependência que você **não controla**: a latência, a disponibilidade, os limites, as mudanças de API e, principalmente, o fato de que **ela decide alguns resultados de forma assíncrona**. Esta página trata das técnicas que tornam essas integrações seguras: **chaves de idempotência, webhooks verificados, retries que não duplicam, reconciliação e um plano para a indisponibilidade de provedores**. A categoria EXTERNAL da paleta — [3rd Party API, Payment, Email](../../../reference/components/external/index.md) — é o assunto desta página.

---

## O que você não controla { #what-you-do-not-control }

| Propriedade | Serviço interno | Provedor externo |
|---|---|---|
| Latência | baixa, previsível, medida por você | maior, com cauda pesada, pela internet pública |
| Disponibilidade | o seu SLO, o seu on-call | o SLA deles (créditos, não as suas vendas perdidas) |
| Limites | você define | **rate limits e cotas** por chave de API |
| Mudanças | coordenadas, com testes de contrato | versionadas por eles, descontinuadas no calendário deles |
| Resultado de uma chamada | conhecido quando a chamada retorna | pode ser **decidido depois** (3-D Secure, análise do banco) |
| Visibilidade das falhas | seus logs e traces | a página de status deles, os códigos de erro deles |
| Custo | infraestrutura | muitas vezes **por chamada** ou por mensagem |

Cada linha corresponde a uma regra de design:

- **Isole o provedor atrás de um adapter** (uma camada anticorrupção, [serviços](../services/index.md#layered-clean-and-hexagonal)): o modelo do provedor, seus nomes de status e seu SDK param numa única classe.
- **Toda chamada tem timeout, e os retries são seguros** (chaves de idempotência) — seções abaixo.
- **Proteja-se do provedor** com um circuit breaker e um bulkhead por provedor ([confiabilidade](../../reliability/index.md)), para que um provedor lento não esgote suas threads (o cenário `cascading-failure`).
- **Respeite os limites deles**: limite a vazão do seu lado, respeite `429` e `Retry-After`.
- **Assuma que os resultados chegam de forma assíncrona**: modele os estados explicitamente, aceite webhooks, reconcilie.
- **Observe cada provedor separadamente**: latência, taxa de erros por código de erro, ocorrências de rate limit, custo.

---

## Anatomia de um pagamento { #anatomy-of-a-payment }

Pagamentos com cartão são a integração mais difícil da BoxOffice, então os usamos como guia. O número do cartão nunca toca a BoxOffice: o app o coleta com os campos hospedados (hosted fields) do provedor e recebe um **token**, o que mantém a BoxOffice fora da maior parte do escopo do PCI DSS[^7]. O serviço `payment` então cria um pagamento com esse token.

``` diagram-sim
sequenceDiagram
    participant F as Fã (app)
    participant O as order
    participant P as payment
    participant X as Provedor de pagamentos
    F->>X: dados do cartão nos hosted fields → token tok_abc
    F->>O: POST /v1/orders {holdId, token} + Idempotency-Key k-1
    O->>P: cobrar pedido ord_9 (chave ord_9)
    P->>X: criar pagamento 450.00 BRL, token, Idempotency-Key ord_9
    X-->>P: status processing
    P-->>O: PENDING
    O-->>F: 202 Accepted — pedido ord_9 PENDING
    Note over X: banco autoriza (talvez após 3-D Secure)
    X->>P: webhook payment.succeeded (assinado)
    P->>O: PaymentSucceeded ord_9
    O->>O: confirma o hold → pedido CONFIRMED
    O-->>F: push: seus ingressos estão sendo emitidos
```

Repare no que *não* está na figura: uma resposta síncrona "cobrança aprovada" da qual o checkout dependa. O provedor pode responder `processing`, pode pedir que o fã se autentique no banco (`requires_action`, 3-D Secure) ou pode simplesmente dar timeout. O resultado definitivo muitas vezes chega depois, por webhook. Por isso a BoxOffice modela o pagamento como uma **máquina de estados** explícita:

``` diagram-sim
stateDiagram-v2
    [*] --> CREATED
    CREATED --> PENDING : provedor aceitou a requisição
    CREATED --> UNKNOWN : timeout — resultado desconhecido
    UNKNOWN --> PENDING : consulta de status / webhook
    PENDING --> REQUIRES_ACTION : 3-D Secure necessário
    REQUIRES_ACTION --> PENDING : fã se autenticou
    PENDING --> SUCCEEDED : webhook payment.succeeded
    PENDING --> FAILED : webhook payment.failed
    SUCCEEDED --> REFUNDED : hold expirou / evento cancelado
```

O estado **UNKNOWN** é a resposta honesta para "a chamada deu timeout": a requisição pode ou não ter chegado ao provedor. Nunca trate um timeout como falha (você liberaria os assentos de um fã que *foi* cobrado) nem como sucesso. Resolva consultando o provedor ou esperando o webhook — e garanta que um retry não possa cobrar duas vezes.

---

## Chaves de idempotência { #idempotency-keys }

Uma operação é **idempotente** se fazê-la duas vezes tem o mesmo efeito que fazê-la uma vez. `POST /payments` não é — a menos que os dois lados combinem uma **chave de idempotência (idempotency key)**: um identificador único de uma operação *lógica*, enviado em toda tentativa dessa operação. O servidor lembra as chaves que já processou e, numa repetição, devolve o resultado guardado em vez de executar de novo[^1][^2].

A BoxOffice precisa de chaves nas **duas direções**:

- **Na entrada** — fãs e apps repetem requisições: um clique duplo, um app móvel repetindo numa conexão instável, o gateway repetindo um `503`. O `POST /v1/orders` e o `POST /v1/events/{id}/holds` da BoxOffice exigem um header `Idempotency-Key`, gerado pelo cliente uma vez por ação lógica (um UUID criado quando o fã aperta *Pagar*, reusado em todo retry desse clique).
- **Na saída** — a BoxOffice repete chamadas ao provedor. Toda chamada que cria uma cobrança ou um estorno leva uma chave **derivada do id da própria BoxOffice** (`ord_9`, ou `ord_9:refund:1`), então um retry após um timeout a reusa e o provedor devolve o pagamento original em vez de criar um segundo.

``` diagram-sim
sequenceDiagram
    participant P as payment
    participant X as Provedor de pagamentos
    P->>X: criar pagamento, Idempotency-Key ord_9
    Note over X: cobrança criada (pay_77)
    X--xP: resposta perdida (timeout)
    Note over P: estado UNKNOWN → retry com a MESMA chave
    P->>X: criar pagamento, Idempotency-Key ord_9
    X-->>P: pay_77 succeeded (resultado guardado, sem nova cobrança)
```

### Implementando na sua própria API { #implementing-it-on-your-own-api }

O provedor faz isso por você do lado dele; do lado da BoxOffice, você implementa. O núcleo é uma tabela cuja chave primária torna "o primeiro vence" uma garantia do banco de dados:

```sql title="V7__idempotency_keys.sql"
CREATE TABLE idempotency_keys (
    client_id     text        NOT NULL,              -- keys are scoped per caller
    key           text        NOT NULL,
    request_hash  text        NOT NULL,              -- SHA-256 of method + path + body
    status        text        NOT NULL,              -- IN_PROGRESS | COMPLETED
    response_code int,
    response_body jsonb,
    locked_at     timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, key)
);
CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);  -- purge after 24 h
```

```java title="order: IdempotentExecutor.java"
@Component
class IdempotentExecutor {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    IdempotentExecutor(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    StoredResponse execute(String clientId, String key, String requestHash,
                           Supplier<StoredResponse> operation) {
        // 1. Claim the key. The primary key guarantees that only one request wins.
        int claimed = jdbc.update("""
                INSERT INTO idempotency_keys (client_id, key, request_hash, status)
                VALUES (?, ?, ?, 'IN_PROGRESS')
                ON CONFLICT (client_id, key) DO NOTHING
                """, clientId, key, requestHash);

        if (claimed == 0) {                                   // 2. Seen before.
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT request_hash, status, response_code, response_body::text AS body
                      FROM idempotency_keys WHERE client_id = ? AND key = ?
                    """, clientId, key);
            if (!requestHash.equals(row.get("request_hash")))
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                        "Idempotency-Key reused with a different request");
            if ("IN_PROGRESS".equals(row.get("status")))
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "a request with this Idempotency-Key is still being processed");
            return new StoredResponse((Integer) row.get("response_code"), (String) row.get("body"));
        }

        // 3. First time: run the operation and store its response in ONE transaction.
        try {
            return tx.execute(status -> {
                StoredResponse response = operation.get();
                jdbc.update("""
                        UPDATE idempotency_keys
                           SET status = 'COMPLETED', response_code = ?, response_body = ?::jsonb
                         WHERE client_id = ? AND key = ?
                        """, response.code(), response.body(), clientId, key);
                return response;
            });
        } catch (RuntimeException e) {                        // nothing was committed:
            jdbc.update("DELETE FROM idempotency_keys WHERE client_id = ? AND key = ?",
                        clientId, key);                       // let the client retry
            throw e;
        }
    }
}
```

As decisões escondidas nessas linhas são as que um entrevistador vai explorar:

| Caso | Comportamento | Por quê |
|---|---|---|
| Mesma chave, mesma requisição, concluída | devolver a resposta **guardada** (mesmo status e corpo) | o cliente não consegue distinguir a repetição do original |
| Mesma chave, ainda em andamento | `409 Conflict` — "tente de novo em instantes" | duas tentativas concorrentes não podem rodar ambas |
| Mesma chave, requisição **diferente** | `422` | um bug do cliente; executá-la seria surpreendente |
| Operação falhou antes do commit | apagar a chave | nada aconteceu; um retry deve rodar de novo |
| Processo caiu em `IN_PROGRESS` | após um tempo limite (`locked_at` mais antigo que, por exemplo, 1 min), permitir que uma nova tentativa assuma | senão a chave fica presa para sempre |
| Chaves antigas | expurgar após 24 h (ou a janela de retry que você documentar) | armazenamento; o draft da IETF e os provedores usam janelas parecidas |

Quando a operação **também chama o provedor**, o passo 3 não é puramente local: a chamada ao provedor não é desfeita com a transação. Por isso a chamada de saída leva sua própria chave de idempotência derivada do id do pedido — se a transação da BoxOffice falhar depois de o provedor cobrar, o retry pergunta de novo ao provedor com a mesma chave e recebe o mesmo pagamento. Para operações mais longas, com vários passos, o desenho de "fases atômicas e pontos de recuperação" de Brandur Leach generaliza essa ideia[^3].

!!! warning "As chaves precisam identificar a operação *lógica*"
    Uma chave gerada a cada tentativa HTTP (um UUID novo a cada retry) não protege nada. Uma chave derivada do *conteúdo* ("fã 42 compra o assento C-14") bloqueia um fã que legitimamente compra duas vezes. Gere a chave quando o usuário **decide** agir, e reuse-a em todo retry dessa decisão.

!!! example "No código do BoxOffice: uma chave do `order` até o provedor (lab 9)"

    No [Hands-on 9 — Payment](../../../hands-on/9/payment/index.md) a chave é derivada do próprio id da BoxOffice, `order-<orderId>`, então todo retry do mesmo pedido (o Resilience4j no `order`, o gateway, um clique duplo) leva a mesma chave. O `payment` é o adaptador: responde a uma chave conhecida a partir da sua tabela, chama o provedor **fora** de qualquer transação de banco (nenhuma conexão fica presa enquanto o provedor pensa), repassa a mesma chave e grava o resultado sob uma constraint `UNIQUE`. É mais simples que o executor acima: não há o estado `IN_PROGRESS`, então duas tentativas concorrentes com a mesma chave podem chegar ambas ao provedor, e é a deduplicação do próprio provedor por essa chave que garante uma única cobrança. Isso só é aceitável porque provedores reais deduplicam; na sua própria API, use o passo de reivindicação (*claim*).

    ``` { .java title="services/order/src/main/java/boxoffice/order/payment/PaymentClient.java (the key)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentClient.java:25:32"
    ```

    ``` { .java title="services/payment/src/main/java/boxoffice/payment/PaymentService.java (one charge per key)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/PaymentService.java:22:38"
    ```

---

## Retries e resultados desconhecidos { #retries-and-unknown-outcomes }

Nem toda falha é igual. O que você pode fazer em seguida depende de **a requisição poder ou não ter tido efeito**:

| O que aconteceu | Pode ter tido efeito? | O que fazer |
|---|---|---|
| Conexão recusada, falha de DNS, falha no handshake TLS | não — nada foi enviado | retry (com backoff) |
| Timeout **depois** de enviar a requisição | **desconhecido** | retry com a **mesma chave de idempotência**, ou consultar o status antes |
| `5xx` do provedor | desconhecido (possivelmente parcial) | retry com a mesma chave, com backoff e jitter |
| `429 Too Many Requests` | não | esperar o `Retry-After` e repetir; limitar a própria vazão |
| `400`, `401`, `402` cartão recusado, `422` | não, e não vai dar certo | não repetir; mostrar o erro |

Os retries seguem as regras de [confiabilidade](../../reliability/index.md): backoff exponencial com full jitter, um número máximo pequeno de tentativas, em **uma** camada só, e dentro do orçamento de tempo de quem chama. Para um checkout diante do usuário esse orçamento é curto — alguns segundos; depois disso, o pagamento vira `UNKNOWN`/`PENDING` e o fã vê "estamos confirmando seu pagamento", enquanto um job em segundo plano resolve a situação.

---

## Webhooks { #webhooks }

Um **webhook** é uma requisição HTTP que o provedor envia para a *sua* URL quando algo acontece do lado dele — `payment.succeeded`, `payment.failed`, `charge.refunded`, `email.bounced`. É assim que resultados assíncronos chegam até você sem polling. Trate cada entrega como uma mensagem não confiável, possivelmente duplicada e possivelmente atrasada:

| Propriedade da entrega de webhooks | Consequência para o receptor |
|---|---|
| Qualquer um na internet pode chamar sua URL | **verificar a assinatura** antes de confiar em qualquer coisa |
| Uma requisição capturada pode ser reenviada depois | checar o **timestamp** (rejeitar os antigos) |
| **Pelo menos uma vez**: reenviado até você responder `2xx`, por horas ou dias | **deduplicar** pelo id do evento |
| Sem garantia de ordem | aplicar **transições de estado monotônicas**; ignorar eventos obsoletos |
| Um handler lento causa timeouts e retries do provedor | **confirmar rápido**, processar de forma assíncrona |
| Entregas podem se perder depois que o provedor desiste | **reconciliar** (próxima seção) |

``` diagram-sim
sequenceDiagram
    participant X as Provedor de pagamentos
    participant H as Receptor de webhooks
    participant DB as tabela inbox
    participant Q as Fila
    participant W as worker de payment
    X->>H: POST /webhooks/payments (assinado)
    H->>H: verifica assinatura + timestamp
    H->>DB: INSERT do evento (id de evento único)
    H->>Q: enfileira o id do evento
    H-->>X: 200 OK (em milissegundos)
    X->>H: o mesmo evento de novo (retry)
    H->>DB: INSERT → duplicado, ignorado
    H-->>X: 200 OK
    Q->>W: processa o evento
    W->>W: PENDING → SUCCEEDED (update condicional)
```

### Verificando assinaturas { #verifying-signatures }

Os provedores assinam cada entrega com um segredo compartilhado só com você, normalmente um **HMAC-SHA256** sobre o corpo bruto mais um timestamp e um id de mensagem. A especificação *Standard Webhooks*, adotada por vários provedores, define os headers `webhook-id`, `webhook-timestamp` e `webhook-signature`, e assina a string `id.timestamp.body`[^4]; outros provedores usam a mesma ideia com seus próprios nomes de header (o `Stripe-Signature` da Stripe, por exemplo[^5]). Um receptor em Python com FastAPI:

```python title="payment-webhooks/main.py"
import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import FastAPI, Header, HTTPException, Request

from adapters import inbox, queue        # the service's own persistence and queue adapters

app = FastAPI()
SECRET = base64.b64decode(os.environ["WEBHOOK_SECRET"].removeprefix("whsec_"))
TOLERANCE_S = 300                        # reject deliveries older than 5 minutes


def verify(body: bytes, msg_id: str, timestamp: str, signatures: str) -> None:
    if abs(time.time() - int(timestamp)) > TOLERANCE_S:
        raise HTTPException(status_code=400, detail="timestamp outside tolerance")   # replay
    signed = f"{msg_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(SECRET, signed, hashlib.sha256).digest()).decode()
    for candidate in signatures.split():                  # several during secret rotation
        version, _, value = candidate.partition(",")
        if version == "v1" and hmac.compare_digest(value, expected):                # constant time
            return
    raise HTTPException(status_code=401, detail="invalid signature")


@app.post("/webhooks/payments")
async def payment_webhook(
    request: Request,
    webhook_id: str = Header(...),
    webhook_timestamp: str = Header(...),
    webhook_signature: str = Header(...),
):
    body = await request.body()          # the RAW bytes: re-serialized JSON would not match
    verify(body, webhook_id, webhook_timestamp, webhook_signature)
    event = json.loads(body)
    if await inbox.insert_if_absent(event_id=webhook_id, payload=event):   # unique event id
        await queue.publish("payment.provider-events", {"eventId": webhook_id})
    return {"received": True}            # 2xx fast; a worker does the real processing
```

Detalhes que importam: verifique sobre os **bytes brutos** (fazer o parse e serializar o JSON de novo muda espaços e a ordem das chaves); compare com uma função de **tempo constante** (`hmac.compare_digest`) para que o tempo da comparação não vaze a assinatura; aceite **várias assinaturas** durante a rotação do segredo; mantenha o handler mínimo para que ele sempre responda dentro do timeout do provedor.

### Eventos fora de ordem e obsoletos { #out-of-order-and-stale-events }

O worker aplica cada evento como uma **transição de estado condicional**, para que um evento atrasado ou duplicado não faça um pagamento andar para trás:

```sql title="apply payment.succeeded"
UPDATE payments
   SET status = 'SUCCEEDED',
       provider_updated_at = :occurred_at
 WHERE provider_payment_id = :provider_payment_id
   AND status IN ('CREATED', 'UNKNOWN', 'PENDING', 'REQUIRES_ACTION');
-- 0 rows updated = already final (duplicate or stale event): acknowledge and ignore
```

Muitos times também tratam o webhook **apenas como notificação** ("algo mudou em `pay_77`") e buscam o objeto atual na API do provedor antes de agir. Custa uma chamada, mas o estado sobre o qual você age é sempre o mais recente e o oficial.

### Webhooks ou polling? { #webhooks-or-polling }

| | Webhooks (push) | Polling (pull) |
|---|---|---|
| Latência do resultado | segundos | o intervalo de polling |
| Carga | uma requisição por evento | requisições mesmo quando nada mudou |
| Exige um endpoint público | sim (assinatura, TLS, disponibilidade) | não |
| Atualizações perdidas | possíveis — exige reconciliação | nenhuma, se a consulta for completa |
| Uso típico | canal principal para resultados | fallback para itens travados, reconciliação |

Use os dois: webhooks como caminho rápido, e um **sweeper** que consulta o provedor sobre pagamentos ainda `UNKNOWN` ou `PENDING` depois de, digamos, 10 minutos.

!!! info "Quando a BoxOffice envia webhooks"
    Revendedores assinam eventos da BoxOffice (`order.confirmed`, `event.cancelled`). Agora a BoxOffice é o provedor e precisa oferecer o que espera dos outros: entregas assinadas com id único e timestamp, retries com backoff exponencial por um período documentado, um armazenamento de mensagens mortas (dead letters), um painel para reenviar entregas e a promessa de que a entrega é pelo menos uma vez e sem ordem. Uma fila com um pool de workers por assinante evita que um revendedor lento atrase os demais.

---

## Reconciliação { #reconciliation }

Idempotência e webhooks tornam cada interação segura. Eles não garantem que, no fim do dia, os registros da BoxOffice **batam** com os do provedor: um webhook pode se perder depois que os retries do provedor acabam, um atendente pode estornar um pagamento no painel do provedor, um bug pode pular uma atualização de estado, e o provedor desconta tarifas e chargebacks que você só conhece pelos relatórios.

A **reconciliação** é o job periódico que compara os dois lados e resolve as diferenças — prática padrão em qualquer sistema que movimenta dinheiro[^6].

``` diagram-sim
flowchart LR
    report["Relatório do provedor<br/>ou API de listagem desde T"] --> load["Carregar em<br/>provider_payments"]
    ours[("payments<br/>(BoxOffice)")] --> match{"Casar pelo<br/>id do provedor"}
    load --> match
    match -->|"iguais"| ok["Conciliado ✓"]
    match -->|"deles SUCCEEDED,<br/>nosso PENDING"| fix["Correção automática:<br/>confirmar ou estornar"]
    match -->|"só de um lado,<br/>valor diferente"| human["Fila de exceções<br/>(on-call do financeiro)"]
```

```sql title="find mismatches for one day"
SELECT coalesce(p.id, r.reference)  AS payment,
       p.status                      AS ours,
       r.status                      AS theirs,
       p.amount_cents                AS our_amount,
       r.amount_cents                AS their_amount
  FROM payments p
  FULL OUTER JOIN provider_payments r
         ON r.provider_payment_id = p.provider_payment_id
 WHERE (p.created_at >= :day AND p.created_at < :day + interval '1 day'
        OR r.created_at >= :day AND r.created_at < :day + interval '1 day')
   AND (p.id IS NULL
        OR r.provider_payment_id IS NULL
        OR p.status <> r.status
        OR p.amount_cents <> r.amount_cents);
```

| Divergência | Causa provável | Resolução |
|---|---|---|
| Provedor `succeeded`, BoxOffice `PENDING` | webhook perdido | confirmar o pedido se o hold ainda vale; senão, **estornar** automaticamente |
| Provedor `refunded`, BoxOffice `SUCCEEDED` | estorno feito no painel do provedor | cancelar os ingressos, atualizar o pedido |
| BoxOffice `SUCCEEDED`, provedor não tem nada | bug ou dados de teste em produção | fila de exceções — investigar |
| Valores diferentes | moeda, tarifas, captura parcial | fila de exceções; conferir o modelo de tarifas |

Rode em duas velocidades: um **sweeper quase em tempo real** (a cada poucos minutos, para pagamentos travados em `UNKNOWN`/`PENDING`, consultando a API do provedor) e uma **reconciliação diária** contra o relatório de liquidação do provedor, que também confere tarifas e repasses contra o banco. Sistemas maiores registram cada movimentação de dinheiro num **livro-razão de partidas dobradas** (double-entry ledger), para que as contas sempre fechem e toda diferença tenha uma explicação.

---

## Indisponibilidade de provedores { #provider-outages }

Provedores falham como tudo o mais — e a indisponibilidade deles chega no seu dia mais movimentado, porque o seu dia mais movimentado é o deles também. Decida com antecedência, por provedor, o que a BoxOffice faz:

| Estratégia | Como | Serve para | Custo |
|---|---|---|---|
| **Falhar rápido, com clareza** | o circuit breaker abre; o checkout responde "pagamentos temporariamente indisponíveis" em milissegundos | pagamentos, quando nada mais é possível | vendas perdidas durante a falha — mas sem threads presas, sem falha em cascata |
| **Enfileirar e tentar depois** | aceitar o trabalho, entregar quando o provedor voltar | e-mail, push, exportações para analytics | entrega atrasada; backlog para drenar (rate limits!) |
| **Failover para um segundo provedor** | rotear pela saúde do provedor; mesma porta, dois adapters | e-mail (envios sem estado); pagamentos em empresas grandes | duas integrações, duas reconciliações, tokens de cartão muitas vezes específicos do provedor |
| **Degradar a funcionalidade** | esconder a parte opcional | mapas do local, recomendações, score de fraude (cair para regras) | experiência reduzida |
| **Proteger o estado do usuário** | estender os holds enquanto o provedor de pagamentos está fora | checkout da BoxOffice | assentos indisponíveis para outros por mais tempo |

``` diagram-sim
flowchart LR
    n["worker de notification"] --> cb{"circuit breaker<br/>ESP primário"}
    cb -->|"fechado"| p["Provedor de e-mail primário"]
    cb -->|"aberto"| s["Provedor de e-mail secundário"]
    p -.->|"429 / 5xx"| retry["fila de retry<br/>(backoff)"]
    s -.->|"429 / 5xx"| retry
    retry --> n
```

As decisões da BoxOffice:

- **Provedor de pagamentos fora** → o breaker abre depois de uma rajada de falhas; novos checkouts falham rápido com uma mensagem clara, e os **holds ativos são estendidos** pela duração da falha, para que os fãs não percam seus assentos enquanto esperam. Pagamentos que já estavam em voo continuam `UNKNOWN` e são resolvidos pelo sweeper quando o provedor volta. (Um segundo provedor de pagamentos está no roadmap, atrás da mesma porta `PaymentGateway`.)
- **Provedor de e-mail fora ou aplicando rate limit** → as mensagens esperam na fila; o worker de notificação limita a vazão ao limite do provedor; depois de uma falha prolongada, o tráfego faz failover para um provedor secundário. Os links dos ingressos continuam disponíveis no app, então um e-mail atrasado é um incômodo, não uma venda perdida.
- **API de mapas do local fora** → a página do evento é renderizada sem o mapa interativo (fallback para uma imagem em cache).

!!! example "E-mail é uma integração com regras próprias"
    Enviar e-mail de forma confiável é mais do que uma chamada de API. Os provedores impõem **rate limits** por conta; eles informam **bounces** (endereço inexistente) e **reclamações** (marcado como spam) por webhook, e a BoxOffice precisa parar de enviar para esses endereços (uma **lista de supressão**), ou o provedor suspende a conta. A autenticação do domínio com **SPF, DKIM e DMARC** decide se as mensagens chegam à caixa de entrada. E o e-mail **transacional** (ingressos, redefinição de senha) deve usar um fluxo ou subdomínio separado do e-mail de **marketing**, para que uma campanha ruim não prejudique a entrega de ingressos.

### Experimente no playground { #try-it-in-the-playground }

Abra o cenário `payment-system`: o checkout chama um serviço de pagamento que chama um provedor externo, com retries e idempotência.

1. Suba o nível de caos para **high**, para que o provedor tenha quedas e períodos lentos; observe o p99 do checkout e a taxa de erros.
2. Configure retries **sem** backoff na aresta de pagamento: o provedor recebe uma tempestade de retries e fica fora por mais tempo. Troque para **backoff exponencial com jitter**.
3. Adicione um **timeout** e um **circuit breaker** na aresta para o provedor: o checkout falha rápido em vez de acumular threads, e se recupera quando o provedor volta.

<div class="sdp" data-scenario="payment-system" data-mode="compact" data-height="520" data-chaos="medium"></div>

[:material-open-in-new: Abrir o simulador completo](../../../../playground/index.md)

---

## Segurança das integrações { #security-of-integrations }

- **Segredos** (chaves de API, segredos de webhook) ficam num gerenciador de segredos, nunca no repositório; faça rotação, e use **chaves restritas** só com as permissões de que cada serviço precisa ([redes e segurança](../../network-security/index.md)).
- **Minimize o escopo do PCI DSS**: tokenize com os campos hospedados ou a página de pagamento do provedor, para que números de cartão nunca atravessem a rede da BoxOffice.
- **Controle de saída**: as chamadas aos provedores saem por um NAT gateway com IPs fixos (alguns provedores os colocam em allowlist); negue o restante do tráfego de saída.
- **Trate as respostas do provedor como entrada**: valide-as; um provedor comprometido ou com bug não pode injetar dados no seu sistema sem verificação.

---

## Trade-offs em resumo { #trade-offs-at-a-glance }

| Decisão | Opção A | Opção B |
|---|---|---|
| Confirmar um pagamento | resposta síncrona: UX simples, mas o checkout depende da latência do provedor e falha em timeouts | `202` + webhook: robusto e honesto sobre a incerteza, mas exige estados, push/polling na interface e reconciliação |
| Saber dos resultados | webhooks: rápidos, eficientes, podem se perder | polling: simples, completo, lento e desperdiçador |
| Redundância de provedor | um provedor: mais simples, mais barato | dois provedores: sobrevive a falhas, dobra o trabalho de integração e reconciliação |
| Processamento de webhooks | na hora: mais simples | inbox + fila: confirmação rápida, retries sob seu controle |

!!! tip "Na entrevista"

    As perguntas de aprofundamento sobre sistemas de pagamento são previsíveis — tenha as respostas prontas:

    - *"A chamada ao provedor deu timeout. O cliente foi cobrado?"* → **Não sabemos**: estado `UNKNOWN`; retry com a **mesma chave de idempotência** ou consulta de status; nunca cobrar duas vezes, nunca assumir falha.
    - *"O usuário clicou duas vezes em Pagar."* → **Idempotency-Key** gerada pelo cliente por ação lógica; a segunda requisição devolve o primeiro resultado.
    - *"Como você sabe que o pagamento foi aprovado?"* → **webhook assinado**, verificado, deduplicado pelo id do evento, aplicado como transição de estado monotônica; mais um sweeper que consulta pagamentos travados.
    - *"E se o webhook nunca chegar?"* → **reconciliação** contra a API e os relatórios de liquidação do provedor, em duas velocidades.
    - *"O provedor está fora do ar."* → circuit breaker, falhar rápido, estender os holds, enfileirar o que pode esperar; um segundo provedor se o negócio justificar.

!!! success "Boas práticas"

    - **Dê a cada camada um timeout menor que o de quem a chama** — quem chama precisa desistir por último, ou espera por um trabalho que ninguém vai entregar. Na BoxOffice: o gateway espera 5 s ([lab 4](../../../hands-on/4/gateway/index.md)), o `order` espera 1 s pelo `payment` ([lab 9](../../../hands-on/9/payment/index.md)).
    - **Guarde o id do provedor em todo estado de pagamento** — suporte, estornos e conciliação começam todos por ele. Na BoxOffice: a coluna `provider_ref` de `payments` (lab 9).
    - **Teste contra um provedor falso que pode ser lento, falhar e responder duas vezes** — um stub atrás de um proxy de falhas transforma "e se o provedor levar 3 s?" num teste que você repete. Na BoxOffice: o stub `psp` atrás do Toxiproxy no [lab 9](../../../hands-on/9/index.md).
    - **Acompanhe cada provedor como um dos seus serviços** — latência, taxa de erro e folga do limite de taxa por provedor num dashboard, mais a página de status dele; um alerta sobre o p99 do provedor dispara antes de o checkout falhar.
    - **Restrinja cada credencial de provedor a um serviço** — só o `payment` pode ler a chave de pagamento, e rotacioná-la é uma operação rotineira e ensaiada ([zero trust](../../network-security/zero-trust/index.md)).

!!! warning "Armadilhas comuns"

    - **Sem timeout** nas chamadas ao provedor: o dia ruim do provedor vira a sua indisponibilidade (`cascading-failure`).
    - **Repetir escritas sem chave de idempotência**: cobranças duplicadas, estornos duplicados, e-mails duplicados.
    - **Tratar timeout como falha** e liberar os assentos de um fã que foi cobrado.
    - **Confiar em webhooks não assinados**, ou verificar a assinatura sobre o JSON serializado de novo.
    - **Handlers de webhook lentos** fazendo todo o trabalho na hora: timeouts, retries e duplicatas do provedor.
    - **Assumir a ordem dos webhooks**: um evento `processing` atrasado sobrescrevendo `succeeded`.
    - **Sem reconciliação**: pequenas divergências se acumulam em silêncio até a contabilidade não fechar.
    - **Vazar o modelo do provedor** (strings de status, ids, tipos do SDK) pelo código todo em vez de um único adapter.
    - **Ignorar rate limits e bounces**: o provedor de e-mail suspende a conta no dia da abertura de vendas.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    ADP["um adapter por provedor<br/>portas e adaptadores"] --> RES["timeouts, circuit breaker,<br/>bulkhead → Confiabilidade"]
    IK["idempotency keys<br/>de entrada e de saída"] --> RETRY["retries seguros"]
    TO["um timeout significa UNKNOWN"] --> SM["máquina de estados do pagamento"]
    RETRY --> SM
    SM --> WH["webhooks: assinatura,<br/>dedup por id do evento"]
    SM --> REC["reconciliação com<br/>os registros do provedor"]
    WH --> ASYNC["ack rápido, processamento assíncrono<br/>→ Mensageria"]
    OUT["quedas do provedor"] --> STRAT["falhar rápido, enfileirar, failover,<br/>degradar, estender reservas"]
    STRAT --> RES
    IK -.-> DIST["idempotência<br/>→ Sistemas distribuídos"]
```

**Componentes da paleta:** [`payment`](../../../reference/components/external/index.md#payment) (o provedor por trás do adapter `payment`) · [`email`](../../../reference/components/external/index.md#email) (rate limits, bounces, um provedor secundário) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (a API do mapa do local: degradar sem ela) · [`app`](../../../reference/components/compute/index.md#app) (o serviço adapter) · [`sql`](../../../reference/components/storage/index.md#sql) (idempotency keys sob uma restrição de unicidade, estados do pagamento) · [`queue`](../../../reference/components/messaging/index.md#queue) (entregar depois; processar webhooks de forma assíncrona) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (varredores e jobs de reconciliação) · [`serverless`](../../../reference/components/compute/index.md#serverless) (um receptor de webhooks barato). **Cenários:** `payment-system`, `cascading-failure`, `retry-storm`, `notification-system`. **Continua em:** [Confiabilidade — circuit breaker](../../reliability/patterns/index.md#circuit-breaker), [Distribuídos — idempotência](../../distributed/index.md#idempotency), [Distribuídos — transações](../../distributed/transactions/index.md), [Estudo de caso: sistema de pagamentos](../../case-studies/payment-system/index.md), [Hands-on 9](../../../hands-on/9/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Provedores externos trazem latência, limites, mudanças e **resultados assíncronos** que você não controla; isole cada um atrás de um **adapter** com timeouts, circuit breaker e bulkhead.
    - **Chaves de idempotência** — na entrada, vindas dos clientes, e na saída, para os provedores, derivadas da operação lógica — tornam os retries seguros; implemente-as com chave única, respostas guardadas e tratamento de requisições em andamento e divergentes.
    - Timeout significa **UNKNOWN**, não falha: modele o pagamento como máquina de estados e resolva a incerteza por consulta, webhook ou sweeper.
    - **Webhooks**: verifique a assinatura sobre os bytes brutos com timestamp, deduplique pelo id do evento, confirme rápido, processe de forma assíncrona, aplique transições monotônicas.
    - **Reconcilie** periodicamente com os registros do provedor; webhooks e retries não bastam sozinhos.
    - Planeje cada **indisponibilidade de provedor** com antecedência: falhar rápido, enfileirar, fazer failover, degradar — e proteger o estado do usuário (estender os holds).

---

[^1]: [The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/){target="_blank"}. Grupo de trabalho HTTPAPI da IETF, Internet-Draft.
[^2]: Stripe. [Idempotent requests](https://docs.stripe.com/api/idempotent_requests){target="_blank"}. Referência da API da Stripe.
[^3]: LEACH, B. [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys){target="_blank"}. 2017.
[^4]: [Standard Webhooks specification](https://www.standardwebhooks.com/){target="_blank"}.
[^5]: Stripe. [Receive Stripe events in your webhook endpoint](https://docs.stripe.com/webhooks){target="_blank"} (assinaturas, retries, ordem dos eventos).
[^6]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide, Volume 2*. ByteByteGo, 2022. Capítulo "Payment System" (reconciliação, livro-razão de partidas dobradas, exactly-once com idempotência).
[^7]: PCI Security Standards Council. [PCI DSS](https://www.pcisecuritystandards.org/){target="_blank"} (redução de escopo por tokenização e páginas de pagamento hospedadas).
