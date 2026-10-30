
> *"Projete o sistema de pagamentos de uma plataforma de ingressos. Os fãs pagam com cartão ou Pix por meio de um provedor de pagamento externo; os produtores recebem depois do show. Ninguém pode ser cobrado duas vezes, e cada centavo precisa ser contabilizado."*

Pagamentos são onde "eventualmente consistente" deixa de ser uma resposta aceitável. Um fã cobrado duas vezes liga para o banco; um produtor pago duas vezes é dinheiro que você nunca mais vai ver; um ingresso emitido sem pagamento é um presente. Mesmo assim, o sistema conversa com um **provedor externo** por uma rede não confiável, o que significa timeouts com **resultado desconhecido**, webhooks duplicados e dinheiro que chega dias depois num arquivo de liquidação. A entrevista testa se você consegue transformar um mundo pelo-menos-uma-vez num **efeito de exatamente uma vez**, e se você sabe como dinheiro é registrado: um **livro-razão de partidas dobradas**, não uma coluna `balance`.

Este é o serviço `payment` do BoxOffice — o adaptador por trás do fluxo de pedidos do [caso de ingressos](../ticketing/index.md). Aquela página modela o pedido como uma máquina de estados (`HELD → PENDING_PAYMENT → CONFIRMED`) e usa webhooks e conciliação; esta página desce um nível e mostra o que acontece **dentro** do `payment`: idempotência, o livro-razão, a integração com o provedor e a conciliação diária.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star::material-star: difícil |
| **Conceitos-chave** | chaves de idempotência, efeito de exatamente uma vez sobre entrega pelo-menos-uma-vez, máquina de estados do pagamento com um estado `UNKNOWN`, livro-razão de partidas dobradas, integração com PSP (página hospedada, tokenização, 3-D Secure, webhooks assinados), conciliação com arquivos de liquidação, outbox transacional, retentativas com backoff e DLQ |
| **Componentes da paleta** | [`apigw`](../../../reference/components/edge/index.md#apigw), [`app`](../../../reference/components/compute/index.md#app), [`sql`](../../../reference/components/storage/index.md#sql), [`kafka`](../../../reference/components/messaging/index.md#kafka), [`queue`](../../../reference/components/messaging/index.md#queue), [`worker`](../../../reference/components/compute/index.md#worker), [`scheduler`](../../../reference/components/compute/index.md#scheduler), [`payment`](../../../reference/components/external/index.md#payment), [`dwh`](../../../reference/components/storage/index.md#dwh) |
| **Cenário do playground** | `payment-system` |

!!! abstract "O que este caso treina"

    - **Explicar** por que a "entrega exatamente uma vez" não existe e **construir** um *efeito* de exatamente uma vez a partir de retentativas mais idempotência.
    - **Projetar** um armazenamento de chaves de idempotência que lida com duplicatas concorrentes, repetições e payloads alterados.
    - **Registrar** movimentações de dinheiro num livro-razão de partidas dobradas e **verificar** que toda transação fecha.
    - **Integrar** com um provedor de serviços de pagamento (PSP) ficando fora da maior parte do escopo do PCI DSS, e **tratar** timeouts de resultado desconhecido.
    - **Projetar** a conciliação entre o livro-razão e os relatórios de liquidação do provedor.

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

Pagamentos têm mais requisitos escondidos do que qualquer outro caso. Pergunte ([roteiro de entrevista](../../intro/interview-framework/index.md)).

### Requisitos funcionais { #functional-requirements }

1. **Recebimento** (*pay-in*): cobrar o fã por um pedido (cartão, Pix, carteira) via um PSP externo; suportar desafios de 3-D Secure.
2. **Reembolsos**: totais ou parciais, por exemplo quando um show é cancelado.
3. **Livro-razão**: registrar toda movimentação de dinheiro (cobrança, taxa do PSP, taxa da plataforma, valor devido ao produtor, reembolso, repasse).
4. **Repasses** (*payouts*): pagar aos produtores sua parte depois do evento (em lote, fora do caminho da requisição).
5. **Conciliação**: todo dia, casar o relatório de liquidação do provedor com o livro-razão e apontar diferenças.
6. Avisar o serviço de pedidos sobre os resultados (confirmar, falhar) para os ingressos serem emitidos.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta |
|---|---|
| **Corretude** | **Nunca cobrar duas vezes** por um pedido; nunca emitir ingresso sem pagamento capturado; o livro-razão sempre fecha |
| **Durabilidade** | Um pagamento ou lançamento registrado nunca se perde (RPO = 0) |
| **Auditabilidade** | Histórico imutável: correções são novos lançamentos, nunca atualizações |
| **Disponibilidade** | 99,95% para o checkout; quando o PSP cai, falhar rápido e com clareza |
| **Latência** | p99 da API de checkout < 1 s, sem contar o provedor e o desafio de 3-D Secure |
| **Segurança / conformidade** | Números de cartão nunca tocam nossos servidores (escopo do PCI DSS minimizado); segredos num cofre; webhooks autenticados |
| **Escala** | ~300 mil pagamentos/dia, picos de ~300 pagamentos/s durante várias aberturas de vendas simultâneas |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Processar cartões por conta própria (não somos adquirente), modelos antifraude (cite um gancho de verificação de fraude), câmbio entre moedas, notas fiscais e impostos, disputas de chargeback em detalhe.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Processamos cartões nós mesmos ou usamos um PSP (Stripe, Adyen, Mercado Pago, Pagar.me…)? | Um PSP com página hospedada ou tokenização mantém os dados brutos do cartão fora dos nossos sistemas. |
    | Autorizar e capturar juntos, ou autorizar agora e capturar depois? | A captura em duas etapas permite liberar o dinheiro se a reserva do lugar falhar. |
    | Quais meios de pagamento? Pix / boleto são assíncronos | Meios assíncronos tornam os webhooks a única forma de saber o resultado. |
    | Quem recebe, e quando? Há taxa da plataforma? | Define as contas do livro-razão (devido ao produtor, receita da plataforma) e os repasses. |
    | Um PSP ou vários (failover, roteamento por custo)? | Vários PSPs multiplicam o trabalho de integração e de conciliação. |
    | Qual a política de reembolso? Reembolsos parciais? | Reembolsos também são transações no livro-razão; parciais precisam de valores por item. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

```python exec="1" source="tabbed-right"
# BoxOffice payments: assumptions (illustrative)
orders_day     = 300_000      # paid orders per day
peak_tps       = 300          # payments/s when several on-sales open at 10:00
avg_order      = 230.0        # currency units per order (tickets + fees)
psp_s          = 2.0          # provider latency for one payment call
entries_per    = 4            # ledger lines per captured payment
entry_b        = 200          # one ledger line, bytes
idem_b         = 1_000        # one idempotency record (key, hash, response)
webhooks_per   = 2            # e.g. authorized + captured
dup_rate       = 0.001        # share of payments that would be duplicated without idempotency

avg_tps        = orders_day / 86_400
inflight_peak  = peak_tps * psp_s                 # Little's Law: L = λ·W
ledger_lines   = orders_day * entries_per
ledger_gb_year = ledger_lines * entry_b * 365 / 1e9
idem_mb_day    = orders_day * idem_b / 1e6
webhooks_day   = orders_day * webhooks_per
gmv_day_m      = orders_day * avg_order / 1e6     # millions per day
dup_charges    = orders_day * dup_rate

rows = [
    ("avg_tps", avg_tps, "payments/s"), ("inflight_peak", inflight_peak, "calls"),
    ("ledger_lines", ledger_lines, "lines/day"), ("ledger_gb_year", ledger_gb_year, "GB/year"),
    ("idem_mb_day", idem_mb_day, "MB/day"), ("webhooks_day", webhooks_day, "events/day"),
    ("gmv_day_m", gmv_day_m, "M/day"), ("dup_charges", dup_charges, "charges/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- Em média, só **~3,5 pagamentos/s**; o pico de **300/s** é definido pelas aberturas de vendas. Com um provedor de 2 s, há **~600 chamadas em andamento** no pico (Lei de Little). ⇒ dimensione o pool de conexões e o bulkhead do adaptador para isso, e lembre que o provedor tem o **seu próprio rate limit**.
- O livro-razão cresce **1,2 M de linhas/dia, ~88 GB/ano**: um único **PostgreSQL** bem indexado com um standby guarda anos disso. Pagamentos são um problema de **corretude**, não de escala.
- Os registros de idempotência ocupam **~300 MB/dia**; guarde-os por 24 h–7 dias e cabem em qualquer lugar.
- Mesmo uma taxa de 0,1% de duplicatas significaria **~300 cobranças duplicadas por dia** — 300 fãs irritados e chargebacks. Esse é o número que justifica idempotência em todo lugar.
- **~69 M de unidades monetárias/dia** passam pelo sistema: diferenças de conciliação de uma fração de por cento ainda são dinheiro de verdade.

---

## 3. API

```http
POST /v1/payments                                   → 201 {paymentId, status, nextAction?}
     Idempotency-Key: order-7f3c…                    (one key per order attempt)
     {"orderId": "7f3c…", "amount": 23000, "currency": "BRL",
      "method": "card", "paymentToken": "tok_1Q…", "returnUrl": "https://…"}
     status: REQUIRES_ACTION (3-D Secure) | PROCESSING | SUCCEEDED | FAILED

GET  /v1/payments/{paymentId}                       → 200 {status, amount, refundedAmount, events[]}
POST /v1/payments/{paymentId}/refunds               → 201 {refundId, status}
     Idempotency-Key: refund-…
     {"amount": 10000, "reason": "event_cancelled"}

POST /v1/webhooks/psp                               ← provider → us, HMAC-signed
     PSP-Signature: t=1767261600,v1=5257a8…
     {"id": "evt_9a…", "type": "payment.captured", "data": {"pspPaymentId": "pi_3N…", …}}
```

- Os dados do cartão do fã vão **do navegador direto para o PSP** (campos hospedados ou um redirecionamento); recebemos só um **token** (`paymentToken`). É isso que mantém nossos servidores fora da maior parte do escopo do PCI DSS.
- `nextAction` diz ao cliente para executar o desafio de **3-D Secure** com o banco emissor; o resultado chega depois como webhook.
- Toda chamada que altera estado leva uma **`Idempotency-Key`**; os webhooks trazem um **id de evento** que deduplicamos.

---

## 4. Modelo de dados { #4-data-model }

```sql
CREATE TABLE payment (
    payment_id      UUID PRIMARY KEY,
    order_id        UUID        NOT NULL UNIQUE,      -- one payment per order attempt
    amount_cents    BIGINT      NOT NULL,
    currency        CHAR(3)     NOT NULL,
    status          TEXT        NOT NULL,             -- CREATED | REQUIRES_ACTION | PROCESSING
                                                      -- | UNKNOWN | SUCCEEDED | FAILED | REFUNDED
    psp             TEXT        NOT NULL,
    psp_payment_id  TEXT        UNIQUE,
    version         INT         NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_key (
    key             TEXT PRIMARY KEY,
    request_hash    TEXT        NOT NULL,             -- SHA-256 of method + path + body
    status          TEXT        NOT NULL,             -- IN_PROGRESS | DONE
    response_code   INT,
    response_body   JSONB,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entry (                           -- append-only: no UPDATE, no DELETE
    entry_id        BIGSERIAL PRIMARY KEY,
    txn_id          UUID        NOT NULL,             -- groups the lines of one transaction
    account         TEXT        NOT NULL,             -- 'psp_receivable', 'promoter_payable:88', …
    amount_cents    BIGINT      NOT NULL,             -- debit > 0, credit < 0
    currency        CHAR(3)     NOT NULL,
    payment_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE processed_webhook (event_id TEXT PRIMARY KEY, received_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE outbox (id BIGSERIAL PRIMARY KEY, topic TEXT, payload JSONB, created_at TIMESTAMPTZ DEFAULT now());
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Pagamentos, chaves de idempotência, livro-razão, webhooks processados | SQL (`sql`), um único banco | Transações ACID envolvendo estado do pagamento, linhas do livro-razão e outbox; restrições de unicidade são a última defesa contra duplicatas |
| Eventos de resultado (`PaymentSucceeded`, `PaymentFailed`) | Kafka (`kafka`) via outbox | Os serviços de pedidos e de notificação reagem de forma assíncrona, nunca consultando o banco de pagamentos |
| Retentativas ao PSP, reembolsos, repasses | Fila (`queue`) + workers (`worker`) | Backoff, rate limits em direção ao provedor, fila de mensagens mortas para revisão manual |
| Arquivos de liquidação, histórico do livro-razão | Data warehouse (`dwh`) | Consultas de conciliação e relatórios financeiros, fora do banco transacional |

---

## 5. Design de alto nível { #5-high-level-design }

``` diagram-sim
flowchart LR
    fan([Navegador do fã]) -->|"dados do cartão"| psp[["PSP<br/>campos hospedados, 3-D Secure"]]
    fan --> gw["API gateway"]
    gw --> ord["order"]
    ord --> pay["serviço payment"]
    pay --> db[("PostgreSQL<br/>pagamento, idempotência,<br/>livro-razão, outbox")]
    pay -->|"cobrança(token, chave)"| psp
    psp -. "webhook assinado" .-> wh["handler de webhooks"]
    wh --> db
    db -. relay do outbox .-> k[["Kafka<br/>eventos de pagamento"]]
    k --> ord
    k --> notif["notification"]
    q[["Fila de retentativas + DLQ"]] --> wk["workers<br/>retentativas, reembolsos, repasses"]
    pay --> q
    wk --> psp
    sched["scheduler<br/>conciliação"] --> rec["job de conciliação"]
    psp -. "arquivo de liquidação (diário)" .-> rec
    rec --> dwh[("Data warehouse")]
    rec --> db
```

Um pagamento com cartão e 3-D Secure, de ponta a ponta:

``` diagram-sim
sequenceDiagram
    autonumber
    participant F as Fã
    participant O as order
    participant P as payment
    participant D as PostgreSQL
    participant S as PSP
    F->>S: dados do cartão (campos hospedados) → token
    F->>O: POST /orders/{id}/pay {token}
    O->>P: POST /payments (Idempotency-Key = tentativa do pedido)
    P->>D: insere chave IN_PROGRESS + pagamento CREATED
    P->>S: cria pagamento (chave de idempotência = paymentId)
    S-->>P: requires_action (3-D Secure)
    P->>D: status REQUIRES_ACTION, chave DONE + resposta guardada
    P-->>F: nextAction: desafio 3-D Secure
    F->>S: conclui o desafio com o banco
    S-->>P: webhook payment.captured (assinado)
    P->>D: uma transação: status SUCCEEDED + 4 linhas no livro-razão + outbox
    D-)O: PaymentSucceeded (via Kafka)
    O-->>F: pedido CONFIRMED, ingressos emitidos
```

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

### 6.1 Efeito de exatamente uma vez: chaves de idempotência { #61-exactly-once-effect-idempotency-keys }

Não existe **entrega** exatamente uma vez numa rede: uma requisição cuja resposta se perdeu pode ou não ter sido executada. O que dá para construir é um **efeito** de exatamente uma vez: o cliente repete até obter uma resposta (pelo menos uma vez), e o servidor torna a operação **idempotente** — executá-la duas vezes tem o mesmo efeito que uma ([semântica de entrega](../../messaging/semantics/index.md)).

O algoritmo no servidor para `POST /v1/payments` com `Idempotency-Key: K`:

``` diagram-sim
flowchart TD
    r["Requisição com chave K"] --> ins{"INSERT chave K<br/>IN_PROGRESS<br/>(única)"}
    ins -->|"inserida"| run["Executa: cria pagamento,<br/>chama o PSP"]
    run --> save["Guarda a resposta,<br/>status DONE"]
    save --> ok["Devolve a resposta"]
    ins -->|"conflito"| chk{"Mesmo request_hash?"}
    chk -->|"não"| e422["422: chave reutilizada<br/>com outro corpo"]
    chk -->|"sim, DONE"| replay["Repete a resposta guardada"]
    chk -->|"sim, IN_PROGRESS"| e409["409: ainda processando,<br/>tente depois"]
```

| Situação | O que o servidor faz | Por quê |
|---|---|---|
| Primeira requisição com K | Insere `IN_PROGRESS` (a restrição de unicidade decide a corrida), executa, guarda a resposta | A inserção única é o lock: duas duplicatas concorrentes não conseguem executar as duas |
| Repetição de uma requisição concluída | Devolve a resposta **guardada** (mesmo status e corpo) | O cliente não distingue a repetição do original — essa é a ideia |
| Repetição enquanto a primeira ainda roda | `409 Conflict` (ou espera um pouco) | Nunca executar o efeito colateral duas vezes em paralelo |
| Mesma K, corpo diferente | `422` | Um bug do cliente; executar seria silenciosamente errado |
| Queda no meio (`IN_PROGRESS` para sempre) | `locked_until` expira; um caminho de recuperação consulta o PSP antes de repetir | A chamada ao PSP pode ter acontecido — nunca suponha que não |

A **mesma ideia vale para fora**: nossa chamada ao PSP leva a **nossa** chave de idempotência (o `paymentId`), então se o adaptador der timeout e repetir, o provedor devolve o pagamento existente em vez de cobrar de novo. APIs no estilo Stripe aceitam um cabeçalho `Idempotency-Key`; com provedores que não aceitam, use uma referência única do lojista e **consulte-a antes** de criar uma nova cobrança.

```text
# key choice matters
Idempotency-Key: order-7f3c-attempt-1   ✔ one key per (order, attempt): a retry of the same attempt is a no-op,
                                           a new card after a decline is a new attempt
Idempotency-Key: <random per HTTP call> ✘ every retry looks new → double charge
Idempotency-Key: user-42                ✘ blocks every future purchase of that user
```

!!! example "No código do BoxOffice: o adaptador de pagamento (lab 9)"

    O [Hands-on 9 — Pagamento, provedor e Toxiproxy](../../../hands-on/9/payment/index.md) constrói uma versão menor deste algoritmo. A mesma chave percorre `order → payment → PSP`: o `order` envia `Idempotency-Key: order-<id>`, o `payment` a procura, chama o PSP **fora** de qualquer transação do banco (nunca segure uma conexão esperando) e grava o resultado sob uma chave `UNIQUE`. O que fica de fora é a linha `IN_PROGRESS`: duas duplicatas concorrentes podem chegar ambas ao PSP, e só a idempotência do próprio provedor, com a mesma chave, impede a segunda cobrança — a tabela acima fecha essa brecha. No lab, a mesma requisição enviada duas vezes devolve `201` e depois `200` com o mesmo `id` e o mesmo `providerRef`. O [outbox do lab 7](../../../hands-on/7/outbox/index.md) é o padrão da seção 6.4.

    ``` { .java title="services/payment/src/main/java/boxoffice/payment/PaymentService.java (charge once per key)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/PaymentService.java:22:38"
    ```

### 6.2 O resultado desconhecido { #62-the-unknown-outcome }

O adaptador chama o PSP e recebe um **timeout**. O cartão foi cobrado? Você não sabe — e esta é a frase mais importante da entrevista.

``` diagram-sim
stateDiagram-v2
    [*] --> CREATED
    CREATED --> PROCESSING: chama o PSP
    PROCESSING --> REQUIRES_ACTION: 3-D Secure
    REQUIRES_ACTION --> PROCESSING: desafio concluído
    PROCESSING --> SUCCEEDED: PSP ok / webhook de captura
    PROCESSING --> FAILED: recusado
    PROCESSING --> UNKNOWN: timeout / 5xx
    UNKNOWN --> SUCCEEDED: consulta ou webhook diz capturado
    UNKNOWN --> FAILED: consulta diz não encontrado / falhou
    SUCCEEDED --> REFUNDED: reembolso
    SUCCEEDED --> [*]
    FAILED --> [*]
```

- Nunca mapeie um timeout para `FAILED`: se a cobrança passou, o fã paga por nada; se você repetir com uma chave **nova**, ele paga duas vezes.
- Mantenha o pagamento em **`UNKNOWN`** e resolva: repita **com a mesma chave de idempotência** (seguro), consulte o PSP pela sua referência, ou espere o webhook. Um job do scheduler varre pagamentos presos em `UNKNOWN` há mais de alguns minutos.
- Enquanto isso, o pedido fica em `PENDING_PAYMENT` e a reserva do lugar é **estendida** (veja a [máquina de estados do caso de ingressos](../ticketing/index.md)); o fã vê "confirmando seu pagamento…".
- Os timeouts da chamada ao PSP são **longos o suficiente** para o p99 normal do provedor (segundos), envoltos num circuit breaker e num bulkhead para que um provedor lento não esgote o serviço de pagamentos ([padrões de confiabilidade](../../reliability/patterns/index.md)).

### 6.3 O livro-razão de partidas dobradas { #63-the-double-entry-ledger }

Uma coluna `balance` que você atualiza com `UPDATE` perde o histórico, não consegue se explicar a um auditor e quebra em silêncio sob atualizações concorrentes. A contabilidade resolveu isso há séculos: **partidas dobradas**. Toda transação é um conjunto de linhas, cada uma movendo dinheiro para dentro (débito) ou para fora (crédito) de uma conta, e **as linhas de toda transação somam zero**. Os saldos são **derivados** somando as linhas; nada é atualizado ou apagado — um erro é corrigido por uma nova transação de estorno.

Um fã compra um ingresso de 200,00 mais uma taxa de serviço de 30,00; o PSP fica com uma taxa de 2,5%; o produtor recebe depois do show:

```python exec="1" source="tabbed-right"
# Double-entry ledger for one BoxOffice ticket sale (amounts in cents; debit > 0, credit < 0)
from collections import defaultdict

transactions = {
    "T1 capture": [                       # fan pays 230.00 through the PSP
        ("psp_receivable",   +22_425),    # PSP owes us 230.00 minus its fee
        ("psp_fees",          +575),      # 2.5% of 230.00 is our expense
        ("promoter_payable", -20_000),    # we owe the promoter the ticket price
        ("platform_revenue", -3_000),     # the service fee is ours
    ],
    "T2 settlement": [                    # PSP pays out to our bank two days later
        ("bank",             +22_425),
        ("psp_receivable",   -22_425),
    ],
    "T3 payout": [                        # after the show we pay the promoter
        ("promoter_payable", +20_000),
        ("bank",             -20_000),
    ],
}

balances = defaultdict(int)
print("| transaction | lines | sum |\n|---|---:|---:|")
for name, lines in transactions.items():
    total = sum(amount for _, amount in lines)
    assert total == 0, f"{name} does not balance"
    for account, amount in lines:
        balances[account] += amount
    print(f"| {name} | {len(lines)} | {total} |")

print("\n| account | balance |\n|---|---:|")
for account, cents in sorted(balances.items()):
    print(f"| `{account}` | {cents / 100:,.2f} |")
print(f"\nSum of all balances: {sum(balances.values())}")
```

Leia o resultado: depois das três transações o banco tem **24,25** — exatamente a receita da plataforma (30,00) menos a taxa do PSP (5,75); o valor a receber do PSP e o valor devido ao produtor estão **zerados**, como devem estar depois de liquidados. Se algum desses saldos não for o que o negócio espera, o livro-razão diz **qual transação** o causou.

Regras de engenharia para o livro-razão:

- **Só inserção** no nível do banco (revogue `UPDATE`/`DELETE` do papel da aplicação). Reembolsos e correções são novas transações.
- **Grave todas as linhas de uma transação numa única transação do banco**, junto com a mudança de estado do pagamento e a linha do outbox. Verifique o invariante de soma zero no código e com uma consulta periódica (`SELECT txn_id FROM ledger_entry GROUP BY txn_id HAVING sum(amount_cents) <> 0` não pode devolver nada).
- **Unidades menores inteiras** (centavos) e moeda explícita — nunca ponto flutuante para dinheiro.
- Conta **por contraparte** quando necessário (`promoter_payable:88`), para o job de repasse saber quanto cada produtor tem a receber.

### 6.4 Webhooks, outbox e conciliação { #64-webhooks-outbox-and-reconciliation }

**Webhooks** são como meios assíncronos (Pix, 3-D Secure, transferências) informam resultados. O handler precisa:

1. **Verificar a assinatura** (HMAC sobre timestamp + corpo com um segredo compartilhado) e rejeitar timestamps antigos — senão qualquer um pode fazer POST de "pagamento aprovado".
2. **Deduplicar** pelo id de evento do provedor (`INSERT INTO processed_webhook … ON CONFLICT DO NOTHING`): provedores entregam pelo menos uma vez.
3. Aplicar a mudança como uma **transição condicional** (`… WHERE status IN ('PROCESSING','UNKNOWN')`), para que eventos fora de ordem (um `failed` depois de um `captured`) não façam o estado andar para trás.
4. Responder `2xx` rápido e fazer o trabalho pesado de forma assíncrona; um handler lento faz o provedor repetir, multiplicando a carga.

**Outbox.** O estado do pagamento, as linhas do livro-razão e uma linha no `outbox` são confirmados juntos; um relay publica o outbox no Kafka. O serviço de pedidos nunca fica sabendo de um pagamento que sofreu rollback, e nunca perde um que foi confirmado ([padrões de mensageria](../../messaging/patterns/index.md)).

A **conciliação** é a rede de segurança de tudo isso. Uma vez por dia o PSP publica um **relatório de liquidação** (todo pagamento capturado, reembolso, taxa e repasse). Um job agendado o carrega no warehouse e o casa, linha a linha, com o livro-razão:

| Divergência | Causa provável | Ação |
|---|---|---|
| No relatório do PSP, não no nosso livro-razão | Webhook perdido; pagamento preso em `UNKNOWN` | Criar a transação que falta; confirmar ou reembolsar o pedido |
| No nosso livro-razão, não no relatório do PSP | Sucesso registrado que nunca foi capturado; horário de corte | Rechecar no dia seguinte; depois investigar e estornar |
| Valores diferentes | Taxas mudaram, captura parcial, arredondamento de moeda | Transação de ajuste + alerta ao financeiro |
| Cobrança duplicada no relatório do PSP | Bug de idempotência | Reembolsar imediatamente; postmortem |

Retentativas em direção ao provedor (reembolsos, repasses, consultas de status) rodam a partir de uma **fila com backoff exponencial e jitter**; depois de N tentativas a mensagem vai para uma **fila de mensagens mortas** (DLQ) acompanhada por humanos. Operações com dinheiro nunca são repetidas para sempre às cegas.

!!! tip "Na entrevista"

    Diga as três frases que os entrevistadores esperam: *"Um timeout significa desconhecido, não falha."* — *"As retentativas são seguras porque toda chamada, a nossa e a do PSP, leva uma chave de idempotência."* — *"Dinheiro é registrado como transações balanceadas e só de inserção num livro-razão, e uma conciliação diária com o provedor pega o que escapou."*

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Timeout do PSP | Resultado desconhecido; risco de cobrança dupla ou ingresso não pago | Estado `UNKNOWN`, repetir com a mesma chave, consulta de status, webhook, conciliação | O fã espera "confirmando…" por segundos ou minutos |
| Queda do PSP | Todos os checkouts falham | Circuit breaker, erro claro, pausar admissões (ingressos), segundo PSP opcional | Um segundo PSP dobra a integração e a conciliação |
| Rate limit do PSP no pico de vendas | 429 do provedor | Bulkhead + limite de concorrência no adaptador; enfileirar chamadas não urgentes (reembolsos, repasses) | Reembolsos mais lentos nos picos |
| Webhooks / retentativas duplicados | Lançamentos duplicados no livro-razão | Dedupe por id de evento, transições condicionais, `order_id` / `psp_payment_id` únicos | Tabelas e consultas a mais |
| Duplicatas concorrentes | Duas requisições com a mesma chave rodam em paralelo | Inserção única da chave como lock; `409` para em andamento | Clientes precisam tratar o 409 |
| Falha do primário do banco | Pagamentos não podem ser registrados | Standby síncrono (RPO = 0); falhar fechado — nunca "registrar depois" | Indisponibilidade curta durante o failover |
| Deriva do livro-razão | Saldos não batem com a realidade | Checagens do invariante de soma zero, conciliação diária, só inserção | Processo operacional para divergências |
| Webhook forjado | Eventos falsos de "aprovado" | Assinatura HMAC, tolerância de timestamp, lista de IPs, consultar o PSP antes de confirmar pedidos de alto valor | Pequena latência extra |

Os trade-offs para **dizer em voz alta**: **consistência acima de disponibilidade** (se o banco de pagamentos cair, pare de aceitar pagamentos em vez de registrá-los "depois"), **latência acima de certeza na borda** (responda ao fã com "processando" e resolva de forma assíncrona em vez de segurar a requisição até saber a verdade), e **terceirizar o manuseio de cartões ao PSP** (menos escopo de PCI e de antifraude, em troca de dependência e taxas).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

O cenário `payment-system` modela o serviço de pagamentos, seu banco e um provedor de pagamento externo com retentativas e idempotência.

!!! tip "Experimente"

    1. Rode com o perfil **load** e anote o p99 do caminho de pagamento e o número de chamadas em andamento para o provedor.
    2. Coloque o caos em **medium** para deixar o provedor lento e instável. Sem timeouts/circuit breaker, veja as chamadas em andamento se acumularem (Lei de Little) e o serviço saturar.
    3. Acrescente uma fila + workers na frente do provedor para as chamadas não urgentes (reembolsos, retentativas) e observe o caminho de checkout continuar responsivo.
    4. Aumente as retentativas sem backoff: a taxa de erro do provedor piora? Essa é a [tempestade de retentativas](../../reliability/patterns/index.md) — e em pagamentos, sem chaves de idempotência, cada retentativa poderia ser uma segunda cobrança.

<div class="sdp" data-scenario="payment-system" data-mode="full" data-height="640" data-profile="load"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "Por que não usar uma transação de banco que inclua a chamada ao PSP?"

    Uma transação de banco não consegue incluir uma chamada HTTP para outra empresa: você não desfaz uma cobrança dando rollback no seu `BEGIN`. Transações distribuídas (two-phase commit) não são oferecidas pelos provedores de pagamento. O padrão é uma **transação local para o nosso estado** (pagamento, livro-razão, outbox), uma **chamada idempotente** ao provedor e **compensação** (um reembolso) quando um passo posterior falha — uma saga ([padrões de mensageria](../../messaging/patterns/index.md)).

??? question "O pagamento do fã foi aprovado, mas a reserva do lugar já tinha expirado e o lugar foi revendido. E agora?"

    O handler do webhook encontra o pedido `EXPIRED`. Opções, nesta ordem: se o lugar (ou um equivalente) ainda está disponível, confirme o pedido; senão, **reembolse automaticamente** (uma nova transação no livro-razão estornando a T1 e um pedido de reembolso ao PSP, ambos idempotentes) e avise o fã. A conciliação pega o caso em que até o webhook se perdeu. O ponto de design: pagamento e estoque são sistemas separados, então a janela de inconsistência existe e precisa ter uma resolução definida.

??? question "Por quanto tempo você guarda as chaves de idempotência?"

    O suficiente para cobrir toda retentativa realista: retentativas de clientes acontecem em minutos, as enfileiradas em horas. 24 horas é comum em APIs públicas; para as chamadas internas de pagamento ao PSP, guarde o mapeamento (nosso `paymentId` ↔ `psp_payment_id`) para sempre como parte do registro do pagamento. Chaves vencidas são apagadas por um job agendado; são pequenas.

??? question "Como você paga os produtores?"

    Um **job de repasse** agendado depois do evento calcula o saldo de cada produtor a partir do livro-razão (`promoter_payable:88`), cria uma transação de repasse (débito no valor devido, crédito no banco) e envia o pedido de transferência pelo provedor ou banco com uma chave de idempotência. Os repasses são em lote, com rate limit, e passam pelo mesmo caminho de fila + DLQ; falhas deixam o saldo devido intocado, então nada se perde.

??? question "Precisamos de event sourcing para pagamentos?"

    O livro-razão já **é** um log só de inserção de fatos financeiros, e a tabela de pagamentos registra uma máquina de estados com seu histórico (`events[]`). Event sourcing completo de todo agregado é opcional; o que importa é a imutabilidade das movimentações de dinheiro e a capacidade de explicar cada saldo. Muitos sistemas de pagamento combinam uma tabela relacional de estado com um livro-razão imutável — mais simples de consultar e auditar.

??? question "Como você acrescentaria um segundo provedor de pagamento?"

    Coloque uma **interface de adaptador** na frente dos provedores (criar, consultar, reembolsar, interpretar webhook, interpretar arquivo de liquidação) e um **roteador** que escolhe por meio de pagamento, custo ou saúde. As partes difíceis não são as chamadas de API: cada provedor tem sua semântica de webhooks, formato de liquidação e modelo de taxas, então a conciliação e o livro-razão precisam registrar **qual provedor** tratou cada pagamento. Failover só para pagamentos novos; um pagamento nunca muda de provedor depois de iniciado.

??? question "Como você testa que ninguém nunca é cobrado duas vezes?"

    Testes unitários do algoritmo de idempotência (repetição, duplicatas concorrentes, corpo alterado); testes de integração contra o sandbox do provedor com timeouts injetados depois que a requisição foi aceita; testes de caos com o Toxiproxy descartando respostas entre o `payment` e o stub do PSP ([Hands-on 9](../../../hands-on/9/index.md)); e um **invariante em produção**: uma consulta diária provando que há no máximo um pagamento capturado por pedido e que toda transação do livro-razão soma zero.

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Chama o PSP a partir do serviço de pedidos; guarda uma flag `paid`; talvez repita em caso de erro. Trata timeout como falha; sem livro-razão. |
| **Pleno** | Chave de idempotência na API e para o PSP; webhooks verificados e deduplicados; máquina de estados do pagamento; outbox para avisar o serviço de pedidos; cita a conciliação e o benefício de PCI da tokenização. |
| **Sênior** | Explica por que a entrega exatamente uma vez é impossível e constrói o efeito de exatamente uma vez; projeta o armazenamento de idempotência para corridas, repetições e corpos alterados; o estado `UNKNOWN` e seus caminhos de resolução; um livro-razão de partidas dobradas com invariantes e correções como novas transações; fluxo de conciliação com os tipos de divergência; bulkheads e rate limits em direção ao PSP durante as aberturas de vendas; repasses em lote; compensação (reembolso) como passo de saga; escolha CP explícita para o banco de pagamentos. |

**Relacionados:** [Integrações (webhooks, idempotência)](../../compute/integrations/index.md), [Padrões de mensageria (outbox, saga)](../../messaging/patterns/index.md), [Caso de ingressos](../ticketing/index.md), [Hands-on 7](../../../hands-on/7/index.md) (outbox), [Hands-on 9](../../../hands-on/9/index.md) (resiliência entre `order` e `payment`).

!!! success "Boas práticas"

    - **Nunca mantenha uma transação do banco aberta durante a chamada ao provedor** — o `PaymentService` do lab 9 chama o PSP fora de qualquer transação, para que um provedor lento não esgote o pool de conexões ([lab 9](../../../hands-on/9/payment/index.md)).
    - **Guarde dinheiro em unidades inteiras (centavos) ou `NUMERIC`, nunca em ponto flutuante** — a tabela do lab 9 usa `NUMERIC(10,2)`; um float não representa R$ 0,10 exatamente.
    - **Dê a cada salto um timeout menor que o de quem o chama** — senão quem chama desiste enquanto o chamado ainda trabalha, e a sua retentativa roda ao lado da primeira tentativa. Confira no lab 9: o `order` espera 1 s pelo `payment`, que espera 2 s pelo PSP; com um provedor lento, só a chave de idempotência impede a retentativa de cobrar duas vezes.
    - **Concilie todo dia com o relatório de liquidação do provedor** — toda diferença vira um chamado com dono; o razão só está certo se alguém o confere.
    - **Mantenha os dados de cartão fora dos seus sistemas** — a tokenização pelo provedor deixa o BoxOffice fora da maior parte do escopo do PCI DSS.

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["Payment system"]) --> DIS["Distributed<br/>exactly-once effect, unknown outcome"]:::tech
    CASE --> CMP["Compute<br/>PSP integration, webhooks, reconciliation"]:::tech
    CASE --> DB["Databases<br/>double-entry ledger, transactions"]:::tech
    CASE --> MSG["Messaging<br/>outbox, payment events"]:::tech
    CASE --> REL["Reliability<br/>backoff, retry storms, breakers"]:::tech
    CASE --> SEC["Network & Security<br/>PCI DSS scope, hosted fields"]:::tech
    DIS -.-> k1["sql<br/>(idempotency keys)"]:::comp
    CMP -.-> k2["payment · scheduler · dwh"]:::comp
    MSG -.-> k3["kafka · queue · worker"]:::comp
    SEC -.-> k4["apigw · app"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Distribuídos — idempotência](../../distributed/index.md#idempotency) · [Distribuídos — transações](../../distributed/transactions/index.md) · [Compute — integrações](../../compute/integrations/index.md) · [Bancos de dados — transações](../../databases/transactions/index.md) · [Mensageria — padrões](../../messaging/patterns/index.md) · [Confiabilidade — padrões](../../reliability/patterns/index.md) · [Rede e Segurança](../../network-security/index.md) · [Hands-on 7](../../../hands-on/7/index.md) e [Hands-on 9](../../../hands-on/9/index.md). **Componentes da paleta:** [`apigw`](../../../reference/components/edge/index.md#apigw) · [`app`](../../../reference/components/compute/index.md#app) · [`sql`](../../../reference/components/storage/index.md#sql) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`worker`](../../../reference/components/compute/index.md#worker) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) · [`payment`](../../../reference/components/external/index.md#payment) · [`dwh`](../../../reference/components/storage/index.md#dwh). **Cenários:** `payment-system`, `retry-storm`.

---

## Referências { #references }

- XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2, cap. 11 "Payment System" e cap. 12 "Digital Wallet"[^1].
- Chaves de idempotência como projetadas na Stripe[^2].
- O padrão de segurança de dados PCI e como a tokenização reduz o escopo[^3].
- Padrões de contabilidade para software (contas, lançamentos, transações)[^4].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. — semântica de exatamente uma vez, idempotência e corretude de ponta a ponta[^5].

[^1]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2. Byte Code LLC, 2022.
[^2]: LEACH, B. [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency){target="_blank"}. Stripe Blog, 2017.
[^3]: PCI SECURITY STANDARDS COUNCIL. [PCI DSS v4.0](https://www.pcisecuritystandards.org/){target="_blank"}, 2022.
[^4]: FOWLER, M. *Analysis Patterns: Reusable Object Models*, cap. 6 "Inventory and Accounting". Addison-Wesley, 1996.
[^5]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly.
