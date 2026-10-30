Às 10:00:03 do dia da abertura das vendas, Alice e Bob clicam no assento `A-12` do show no estádio. Os dois veem "Assento reservado — você tem 10 minutos para pagar". Os dois pagam. No portão, um deles é barrado. O código que fez isso estava em produção havia um ano, tinha 100% de cobertura de testes e passou por todas as revisões de código — porque o bug só existe quando **duas requisições se intercalam** no banco de dados, o que nunca acontece num teste unitário.

Esta página explica por quê, usando o vocabulário que todo engenheiro de banco de dados compartilha: transações, níveis de isolamento e anomalias. Depois corrige o bug de quatro maneiras diferentes e monta o fluxo de reserva de assentos que a BoxOffice realmente usa.

---

## ACID, na prática { #acid-concretely }

Uma **transação** agrupa várias leituras e escritas numa única unidade lógica. As garantias clássicas são resumidas como **ACID**[^1]:

| Letra | Garantia | O que significa para a reserva de um assento | O que *não* significa |
|---|---|---|---|
| **A**tomicidade | todas as escritas da transação acontecem, ou nenhuma | o assento é marcado como `HELD` *e* a linha da reserva é criada, ou nenhum dos dois | nada sobre concorrência |
| **C**onsistência | o banco passa de um estado válido para outro | as constraints (`CHECK`, `UNIQUE`, chaves estrangeiras) valem após cada commit | são basicamente as *suas* invariantes, garantidas por A, I e D mais as constraints |
| **I**solamento | transações concorrentes não interferem umas nas outras *conforme definido pelo nível de isolamento* | a transação de Bob não vê o trabalho pela metade de Alice | **não** significa "como se rodassem uma de cada vez" — a não ser que o nível seja serializable |
| **D**urabilidade | depois do commit, os dados sobrevivem a um crash | depois de "Assento reservado", uma queda de energia não desfaz a reserva | sobreviver à perda de um disco ou de uma região — isso exige replicação ([Replicação](../replication/index.md)) |

A armadilha está no **I**: por padrão, a maioria dos bancos *não* executa as transações como se fossem uma de cada vez. PostgreSQL, Oracle e SQL Server usam **read committed** por padrão; o MySQL InnoDB usa **repeatable read**. Ambos permitem anomalias — inclusive a que vendeu o assento `A-12` duas vezes.

---

## O bug da venda dupla { #double-booking }

Este é o caminho do código, escrito como o SQL que cada requisição envia (a aplicação verifica o resultado do `SELECT` antes de emitir o `UPDATE`):

```sql title="Hold a seat — naive version (check, then act)"
BEGIN;  -- PostgreSQL default: READ COMMITTED

SELECT status FROM seats
WHERE event_id = 42 AND seat_id = 'A-12';
-- application: if status != 'AVAILABLE' then ROLLBACK and show "seat taken"

UPDATE seats
SET status = 'HELD', held_by = :customer_id,
    hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12';

COMMIT;
```

Agora intercale duas requisições:

``` diagram-sim
sequenceDiagram
    participant A as Alice (T1)
    participant DB as PostgreSQL
    participant B as Bob (T2)
    A->>DB: SELECT status … A-12
    DB-->>A: AVAILABLE
    B->>DB: SELECT status … A-12
    DB-->>B: AVAILABLE
    A->>DB: UPDATE … SET HELD, held_by = Alice
    Note over DB: T1 trava a linha A-12
    B->>DB: UPDATE … SET HELD, held_by = Bob
    Note over DB: T2 espera o lock de linha de T1
    A->>DB: COMMIT
    DB-->>A: ok — "assento reservado"
    Note over DB: lock liberado: o UPDATE de T2 executa<br/>e sobrescreve a reserva de Alice
    B->>DB: COMMIT
    DB-->>B: ok — "assento reservado"
```

As duas requisições leram `AVAILABLE` *antes* que qualquer uma escrevesse; as duas concluíram "livre"; o segundo `UPDATE` sobrescreveu o primeiro. Esta é a **condição de corrida check-then-act**, e a anomalia se chama **lost update** (atualização perdida): a escrita de Alice foi perdida silenciosamente. O lock de linha não ajudou, porque só serializou os dois `UPDATE`s — a decisão já tinha sido tomada com base em leituras desatualizadas.

Se a tabela `tickets` tiver `PRIMARY KEY (event_id, seat_id)` (veja [Modelos de Dados](../models/index.md#relational)), o segundo insert do *ingresso* falha na confirmação do pagamento — depois que o dinheiro já foi cobrado. A constraint livrou o estádio de duas pessoas no mesmo assento, mas transformou o bug num estorno e num cliente irritado. Constraints são a última linha de defesa, não o design.

??? question "Pense antes: colocar o código numa transação com um nível de isolamento mais rígido resolveria?"

    No PostgreSQL, sim: em **repeatable read**, o `UPDATE` de T2 falha com `could not serialize access due to concurrent update`, porque a linha mudou depois do snapshot de T2; a aplicação tenta de novo, lê `HELD` e avisa Bob que o assento já foi tomado. Em **serializable** acontece o mesmo. No MySQL InnoDB, **repeatable read não detecta o problema**: o `UPDATE` lê a versão confirmada mais recente da linha e a sobrescreve. Os níveis de isolamento têm os mesmos nomes entre bancos, mas não o mesmo comportamento — teste o seu, ou use uma das correções abaixo, que funcionam em qualquer lugar.

---

## Níveis de isolamento e suas anomalias { #isolation-levels-and-their-anomalies }

Uma **anomalia** é um resultado que jamais aconteceria se as transações rodassem uma de cada vez (**serialmente**). Cada nível de isolamento mais fraco permite algumas delas em troca de mais concorrência[^2].

| Anomalia | O que acontece | Exemplo na BoxOffice |
|---|---|---|
| **Leitura suja** (*dirty read*) | T2 lê dados que T1 escreveu mas ainda não confirmou | o mapa de assentos mostra `A-12` vendido; o cartão de Alice é recusado e T1 faz rollback — o assento nunca foi vendido |
| **Leitura não repetível** (*non-repeatable read*, *read skew*) | T lê os mesmos dados duas vezes e obtém valores diferentes, porque outra transação fez commit no meio | um relatório conta 59.990 assentos vendidos, depois soma os pedidos pagos e obtém 60.002 ingressos — os dois números não batem |
| **Lost update** | duas transações leem, modificam e escrevem a mesma linha; uma das escritas se perde | a venda dupla acima |
| **Leitura fantasma** (*phantom*) | o *conjunto* de linhas que satisfazem uma consulta muda porque outra transação inseriu ou atualizou linhas | "quantos ingressos o cliente 7 tem reservados?" devolve 2, enquanto outra transação acrescenta mais 2 |
| **Write skew** | duas transações leem os mesmos dados e depois escrevem linhas *diferentes* com base neles; cada uma está certa sozinha, juntas quebram uma invariante | o limite de ingressos abaixo |

Os níveis, como implementados pelo **PostgreSQL** (outros bancos diferem — consulte a documentação[^3]):

| Nível | Leitura suja | Leitura não repetível | Fantasma | Lost update | Write skew |
|---|---|---|---|---|---|
| Read uncommitted (no PostgreSQL, se comporta como read committed) | não | possível | possível | possível | possível |
| **Read committed** (padrão) | não | possível | possível | possível | possível |
| **Repeatable read** (snapshot isolation) | não | não | não | detectado → erro, nova tentativa | **possível** |
| **Serializable** (serializable snapshot isolation) | não | não | não | não | não — aborta com o erro `40001`, nova tentativa |

### Como os snapshots funcionam: MVCC { #how-snapshots-work-mvcc }

PostgreSQL, MySQL InnoDB, Oracle e a maioria dos motores modernos usam **controle de concorrência multiversão** (*multi-version concurrency control*, MVCC): um update grava uma *nova versão* da linha em vez de sobrescrevê-la, marcada com a transação que a criou. Cada transação lê de um **snapshot** — as versões confirmadas antes de ela começar (repeatable read) ou antes de cada comando começar (read committed).

| Versão da linha `A-12` | Criada por | Visível para |
|---|---|---|
| `status = AVAILABLE` | T100 (carga do evento) | transações cujo snapshot é anterior ao commit de T205 |
| `status = HELD, held_by = Alice` | T205 (Alice) | transações que começam depois do commit de T205 |

A vantagem: **leitores nunca bloqueiam escritores, e escritores nunca bloqueiam leitores**. O custo: versões antigas se acumulam e precisam ser limpas (`VACUUM` no PostgreSQL), e dois escritores na *mesma linha* continuam serializados por um lock de linha.

### Write skew: o limite de ingressos { #write-skew-the-ticket-limit }

A BoxOffice permite no máximo 6 ingressos por cliente por evento. Alice já tem 4 reservados e abre duas abas do navegador, cada uma tentando reservar mais 2 assentos:

| Momento | Aba 1 (T1) | Aba 2 (T2) |
|---|---|---|
| 1 | `SELECT count(*) … WHERE held_by = 7` → **4** | |
| 2 | | `SELECT count(*) … WHERE held_by = 7` → **4** |
| 3 | 4 + 2 ≤ 6 → `UPDATE seats … 'B-1', 'B-2'` | |
| 4 | | 4 + 2 ≤ 6 → `UPDATE seats … 'C-7', 'C-8'` |
| 5 | `COMMIT` | `COMMIT` |
| | **Alice agora tem 8 ingressos** | |

Nenhuma linha foi escrita pelas duas transações, então não há conflito de lock de linha e a snapshot isolation não vê nada de errado. Isso é **write skew**, e ele é causado por um fantasma: o `count(*)` de cada transação teria mudado se ela tivesse visto as escritas da outra. Duas correções:

- Isolamento **serializable**: a serializable snapshot isolation (SSI) do PostgreSQL[^4] acompanha as dependências de leitura/escrita e aborta uma das transações com `ERROR: could not serialize access due to read/write dependencies among transactions` (SQLSTATE `40001`). A aplicação precisa **tentar de novo**.
- **Materializar o conflito**: fazer as duas transações travarem primeiro a *mesma* linha, por exemplo uma linha por cliente por evento:

```sql title="Turn write skew into a plain row-lock conflict"
BEGIN;
SELECT tickets_held FROM customer_event_limits
WHERE customer_id = 7 AND event_id = 42
FOR UPDATE;                         -- the second tab waits here
-- application: if tickets_held + 2 > 6 then ROLLBACK
UPDATE seats SET status = 'HELD', held_by = 7,
                 hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id IN ('B-1', 'B-2') AND status = 'AVAILABLE';
UPDATE customer_event_limits SET tickets_held = tickets_held + 2
WHERE customer_id = 7 AND event_id = 42;
COMMIT;
```

---

## Quatro maneiras de corrigir a venda dupla { #four-ways-to-fix-the-double-booking }

As quatro funcionam em qualquer banco relacional de mercado em read committed, e é por isso que são preferidas a "basta subir o nível de isolamento".

### 1. Update condicional atômico (compare-and-set) { #1-atomic-conditional-update-compare-and-set }

Coloque a verificação *dentro* da escrita, para que verificar e agir sejam um único comando atômico:

```sql title="Fix 1 — conditional UPDATE"
UPDATE seats
SET status = 'HELD', held_by = :customer_id,
    hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12'
  AND status = 'AVAILABLE';
-- 1 row updated → the hold is yours; 0 rows → someone else got it
```

Quando o `UPDATE` de Bob espera o lock de Alice e então executa, o PostgreSQL **reavalia a cláusula `WHERE` contra a nova versão da linha**: `status` agora é `HELD`, então 0 linhas são atualizadas. Uma ida e volta ao banco, nenhum lock explícito, nenhum laço de novas tentativas. Este é o padrão da BoxOffice.

### 2. Lock pessimista: `SELECT … FOR UPDATE` { #2-pessimistic-locking-select-for-update }

Trave a linha ao lê-la, para que ninguém possa alterá-la até o seu commit:

```sql title="Fix 2 — lock on read"
BEGIN;
SELECT status FROM seats
WHERE event_id = 42 AND seat_id = 'A-12'
FOR UPDATE;                 -- Bob blocks here until Alice commits
-- application: if status != 'AVAILABLE' then ROLLBACK
UPDATE seats SET status = 'HELD', held_by = :customer_id,
                 hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12';
COMMIT;
```

Use quando a decisão precisa de lógica da aplicação entre a leitura e a escrita (regras de preço, o limite de ingressos). Sob carga, as variantes fazem diferença:

- `FOR UPDATE NOWAIT` falha imediatamente em vez de esperar — bom para "assento já tomado, escolha outro".
- `FOR UPDATE SKIP LOCKED` pula as linhas travadas por outras transações — perfeito para o **"melhor lugar disponível"**: entrega a cada fã assentos livres diferentes, sem que eles façam fila nas mesmas linhas.

```sql title="Best available: two free seats in section B, without waiting on other fans"
SELECT seat_id FROM seats
WHERE event_id = 42 AND section = 'B' AND status = 'AVAILABLE'
ORDER BY seat_id
LIMIT 2
FOR UPDATE SKIP LOCKED;
```

Quando uma transação trava **várias** linhas (um grupo de 4 assentos), trave-as sempre **na mesma ordem** (por exemplo, `ORDER BY seat_id`). Caso contrário, T1 trava A-1 e espera A-2 enquanto T2 trava A-2 e espera A-1 — um **deadlock**; o banco mata uma delas.

### 3. Lock otimista com coluna de versão { #3-optimistic-locking-with-a-version-column }

Não trave nada; detecte conflitos no momento da escrita com um contador `version`:

```sql title="Fix 3 — optimistic concurrency control"
SELECT status, version FROM seats
WHERE event_id = 42 AND seat_id = 'A-12';     -- AVAILABLE, version 7

UPDATE seats
SET status = 'HELD', held_by = :customer_id, version = version + 1,
    hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12' AND version = 7;
-- 0 rows → somebody changed the seat since you read it: reload and retry
```

O JPA/Hibernate faz isso automaticamente com um campo `@Version` e lança `OptimisticLockException`. Brilha quando os conflitos são **raros** (editar a descrição de um evento) e não segura nenhum lock durante o tempo em que o usuário pensa. É uma escolha ruim para uma flash sale, em que milhares de fãs colidem nas mesmas poucas linhas e a maioria das tentativas falha e é refeita.

### 4. Deixe uma constraint decidir { #4-let-a-constraint-decide }

Transforme a invariante numa **constraint de unicidade** e deixe o banco rejeitar o perdedor. Com uma tabela separada de reservas, uma reserva expirada pode até ser tomada atomicamente:

```sql title="Fix 4 — unique key + upsert that only steals expired holds"
CREATE TABLE seat_holds (
    event_id   BIGINT NOT NULL,
    seat_id    TEXT   NOT NULL,
    customer_id BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (event_id, seat_id)
);

INSERT INTO seat_holds (event_id, seat_id, customer_id, expires_at)
VALUES (42, 'A-12', :customer_id, now() + interval '10 minutes')
ON CONFLICT (event_id, seat_id) DO UPDATE
    SET customer_id = EXCLUDED.customer_id, expires_at = EXCLUDED.expires_at
    WHERE seat_holds.expires_at < now();   -- only if the old hold expired
-- 1 row → hold acquired; 0 rows → a live hold exists
```

### Comparando as correções { #comparing-the-fixes }

| Abordagem | Como os conflitos são resolvidos | Sob muita contenção | Idas e voltas | Melhor para |
|---|---|---|---|---|
| `UPDATE` condicional | o `WHERE` é reavaliado; o perdedor atualiza 0 linhas | bom: lock curto, sem novas tentativas | 1 | check-and-set de uma linha (reserva de assento) |
| `SELECT … FOR UPDATE` | os perdedores esperam o lock | as esperas se acumulam; use `NOWAIT` / `SKIP LOCKED` | 2+ | lógica entre leitura e escrita; decisões sobre várias linhas |
| Otimista (`version`) | o perdedor detecta a mudança e tenta de novo | muitas tentativas falhas e repetidas | 2 + novas tentativas | conflitos raros, usuário pensando por muito tempo |
| Constraint de unicidade / upsert | o perdedor recebe uma violação de constraint ou 0 linhas | bom | 1 | invariantes do tipo "no máximo um"; última linha de defesa |
| Serializable + nova tentativa | o banco aborta uma das transações | os abortos crescem com a contenção | n + novas tentativas | invariantes complexas sobre muitas linhas |

!!! example "No código do BoxOffice: três estratégias atrás de uma chave (lab 6)"

    O [Hands-on 6 — Holds](../../../hands-on/6/holds/index.md) coloca três delas atrás de uma configuração, `INVENTORY_LOCKING`, e roda o mesmo teste de venda relâmpago contra cada uma (100 assentos, milhares de tentativas). `naive` é o [bug acima](#double-booking), verificar-e-agir; `pessimistic` é a correção 2, travando os assentos em `ORDER BY id` para que duas reservas sobrepostas não entrem em deadlock; `optimistic` é a correção 3, um compare-and-set de versão por assento. Numa execução num notebook ocupado, a auditoria encontrou **9 assentos vendidos em dobro** com `naive` e **0** com as outras duas, e `optimistic` teve o menor p99 de reserva (1,03 s contra 1,77 s do `pessimistic`). Isso não contradiz a tabela: quando o assento já foi, o conflito *é* a resposta (`409`, "ocupado"), então ninguém tenta de novo e ninguém espera por um lock. O lock otimista só degrada quando os perdedores tentam de novo as mesmas linhas.

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldService.java (three strategies)" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldService.java:76:84,87:95,98:113"
    ```

---

## Reservas de assento, de ponta a ponta { #seat-holds }

Uma reserva é um **lease** (arrendamento): uma reivindicação temporária, que expira. O ciclo de vida do assento:

``` diagram-sim
stateDiagram-v2
    [*] --> AVAILABLE
    AVAILABLE --> HELD: reserva (UPDATE condicional)
    HELD --> SOLD: pagamento confirmado
    HELD --> AVAILABLE: reserva expirada ou cancelada
    SOLD --> AVAILABLE: estorno (raro, auditado)
    SOLD --> [*]
```

Duas decisões de design o tornam robusto:

1. **Expiração preguiçosa (*lazy*).** A consulta de reserva trata uma reserva expirada como disponível, então um assento nunca fica preso porque um job de limpeza atrasou:

    ```java title="InventoryRepository.java (Spring Data JPA)"
    @Modifying
    @Query("""
        UPDATE Seat s
           SET s.status = 'HELD', s.heldBy = :customerId, s.holdExpiresAt = :expiresAt
         WHERE s.eventId = :eventId AND s.seatId = :seatId
           AND (s.status = 'AVAILABLE'
                OR (s.status = 'HELD' AND s.holdExpiresAt < CURRENT_TIMESTAMP))
        """)
    int tryHold(@Param("eventId") long eventId, @Param("seatId") String seatId,
                @Param("customerId") long customerId, @Param("expiresAt") Instant expiresAt);
    ```

    O serviço lança `SeatTakenException` quando `tryHold` devolve 0. Um job em segundo plano ainda devolve as reservas expiradas para `AVAILABLE` (usando o índice parcial em `hold_expires_at`), para que o mapa de assentos continue correto.

2. **Confirme condicionalmente, também.** A confirmação do pagamento executa `UPDATE seats SET status = 'SOLD' WHERE … AND status = 'HELD' AND held_by = :customer_id AND hold_expires_at > now()`. Se a reserva expirou enquanto o fã pagava, 0 linhas são atualizadas e o pagamento é estornado ou o fã recebe a oferta de outro assento. Nunca suponha que o estado que você viu minutos atrás continua valendo.

---

## Contenção: por que linhas quentes limitam a vazão { #contention }

Um lock de linha se comporta como um servidor que atende uma transação de cada vez. Se cada transação o segura por *t* segundos, essa linha admite no máximo **1 / t** transações por segundo, não importa o tamanho da máquina (Lei de Little, de [Filas](../../estimation/queueing/index.md)). O gráfico compara três designs sob premissas ilustrativas (carga distribuída igualmente entre as linhas disputadas; o próprio banco chega ao teto em 10.000 transações por segundo):

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

# A row lock is a server with capacity 1: if each transaction holds it for
# `hold` seconds, that row admits at most 1 / hold transactions per second.
# Assumptions (illustrative): load spread evenly over the contended rows,
# and the database tops out at 10,000 transactions/s overall.
hold_ms = np.linspace(1, 50, 200)
cap = 10_000
designs = [
    ("1 row: events.seats_left counter", 1, "#E45756"),
    ("40 rows: one counter per section", 40, "#F58518"),
    ("60,000 rows: one row per seat", 60_000, "#4C78A8"),
]

fig, ax = plt.subplots(figsize=(9, 4.2))
fig.patch.set_alpha(0)
for label, rows, color in designs:
    x = np.minimum(rows / (hold_ms / 1000), cap)
    ax.plot(hold_ms, x, color=color, lw=2.5, label=label)
ax.axhline(cap, color="#888", ls=":", lw=1.5)
ax.text(50, cap * 1.15, "database limit (assumed)", color="#888", ha="right", fontsize=9)
ax.set_yscale("log")
ax.set_ylim(10, 30_000)
ax.set_xlabel("time each transaction holds the row lock (ms)")
ax.set_ylabel("max purchases per second")
ax.set_title("A hot row caps throughput at 1 / lock time")
ax.grid(True, which="both", alpha=0.25)
ax.set_facecolor("none")
for item in [ax.title, ax.xaxis.label, ax.yaxis.label] + ax.get_xticklabels() + ax.get_yticklabels():
    item.set_color("#888")
for s in ax.spines.values():
    s.set_color("#888")
ax.tick_params(colors="#888", which="both")
leg = ax.legend(frameon=False, fontsize=9, loc="lower left")
for t in leg.get_texts():
    t.set_color("#888")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

As lições:

- **Nunca mantenha um contador global no caminho quente.** Decrementar `events.seats_left` em cada reserva serializa toda a abertura das vendas numa única linha: a 5 ms por transação, 200 reservas por segundo, para 2 milhões de fãs. Calcule "assentos restantes" de forma assíncrona (ou com contadores por setor) e mostre o valor a partir de um cache.
- **Mantenha as transações curtas.** Uma transação que chama o provedor de pagamento (de centenas de milissegundos a segundos) enquanto segura o lock de um assento multiplica o tempo de lock por 100. Reserve o assento, **faça commit**, chame o provedor *fora* de qualquer transação e depois confirme numa nova transação curta.
- **Linhas de granularidade fina espalham a contenção.** Uma linha por assento significa que os fãs só colidem quando querem o *mesmo* assento.

**Experimente.** O cenário `flash-sale` começa **sem** sala de espera: o `app` escreve direto no `inventory-db`. Execute-o e aumente as réplicas do `app` até ele deixar de ser o gargalo: quando a venda abre (t = 60 s) o `inventory-db` satura nas escritas (uma escrita custa a capacidade de 3 leituras) e o p99 explode. Depois abra no playground completo (↗) e aperte **Mostrar uma solução possível**: uma fila de sala de espera drenada por workers `order` mantém as escritas que chegam ao `inventory-db` — as transações de reserva concorrentes — abaixo do que o banco consegue atender. (O simulador modela capacidade, não locks: a contenção de linhas acima é a parte que você raciocina à mão.)

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

---

## Transações entre serviços { #across-services }

A reserva vive no banco do `inventory`, o pedido no banco do `order` e o pagamento num provedor externo. Nenhuma transação ACID única abrange todos eles.

- O **commit em duas fases** (*two-phase commit*, 2PC) coordena vários bancos: um coordenador pede a cada participante que se *prepare* (prometa fazer commit) e depois manda todos fazerem *commit*. É atômico, mas um participante que se preparou precisa esperar — segurando locks — até o coordenador responder; se o coordenador cair no momento errado, eles ficam bloqueados. É usado dentro de alguns bancos e com transações XA, raramente entre microsserviços e nunca com um provedor de pagamento externo.
- **Sagas** dividem a transação de negócio em transações locais, cada uma com uma **compensação** (liberar a reserva, estornar o pagamento), coordenadas por eventos ou por um orquestrador. Combinadas com o **outbox transacional** (gravar o evento na mesma transação local que a mudança de estado), elas dão atomicidade *eventualmente*. Veja [Padrões de mensageria](../../messaging/patterns/index.md).
- As chamadas ao provedor de pagamento levam uma **chave de idempotência**, para que uma nova tentativa nunca cobre duas vezes. Veja [Integrações](../../compute/integrations/index.md).

!!! example "BoxOffice: o checkout, transação por transação"

    1. `inventory`: `UPDATE` condicional → assento `HELD` por 10 minutos. **Commit.** (~2 ms de lock)
    2. `order`: insere o pedido como `PENDING` + um evento de outbox `OrderCreated`. **Commit.**
    3. `payment`: chama o provedor com chave de idempotência = id do pedido. Nenhuma transação de banco aberta.
    4. Em `PaymentSucceeded`: o `inventory` executa a confirmação condicional (`HELD` por este cliente e não expirado → `SOLD`) e insere o ingresso (chave única). **Commit.**
    5. Em caso de falha ou timeout: as compensações liberam a reserva e cancelam o pedido.

    Cada passo é curto, idempotente e seguro para repetir, e nenhum lock fica preso enquanto se espera pela rede.

!!! tip "Na entrevista"

    - Quando um design tem um **recurso escasso** (assentos, estoque, nomes de usuário, códigos de cupom), diga as palavras "condição de corrida check-then-act" e mostre a correção: "um `UPDATE … WHERE status = 'AVAILABLE'` condicional, e eu verifico o número de linhas afetadas", mais "uma constraint de unicidade como última linha de defesa".
    - Saiba o nível de isolamento padrão do banco que você citar (PostgreSQL: read committed; MySQL InnoDB: repeatable read) e uma anomalia que ele permite.
    - Para "melhor lugar disponível" ou filas de jobs em SQL, mencione `FOR UPDATE SKIP LOCKED`.
    - Para fluxos entre serviços, diga **saga + outbox + chaves de idempotência**, não transações distribuídas.
    - Mencione a contenção: "uma única linha de contador limitaria a abertura das vendas a 1 / tempo-de-lock — eu evito isso".

!!! success "Boas práticas"

    - **Defina `lock_timeout` e `statement_timeout`** — uma reserva deve esperar por um lock no máximo um ou dois segundos e falhar com um erro claro, em vez de se acumular atrás de uma transação lenta; defina-os por papel (*role*) ou com `SET LOCAL` por transação.
    - **Responda a uma corrida perdida com `409`, não `500`** — o perdedor de um conflito é um resultado normal, sobre o qual o cliente pode agir (escolher outros assentos). Na BoxOffice: o `requireAvailable` e o `UPDATE` otimista lançam `CONFLICT` ([lab 6](../../../hands-on/6/holds/index.md)).
    - **Limite o tamanho de toda transação** — um número máximo de linhas por transação limita o tempo de lock. Na BoxOffice: no máximo 6 assentos por reserva (`max-seats-per-hold`), no máximo 500 reservas por varredura (`LIMIT 500`).
    - **Audite a invariante continuamente** — uma consulta que conta as violações (assentos em duas reservas vivas), rodada depois de todo teste de carga e periodicamente em produção. Na BoxOffice: `GET /inventory/audit/double-bookings` (lab 6).
    - **Alerte sobre transações velhas** — qualquer transação aberta há mais de uns 30 s (`now() - xact_start` no `pg_stat_activity`) segura locks e impede o vacuum de limpar versões antigas das linhas.

!!! warning "Armadilhas comuns"

    - **Verificar na aplicação, agir no banco** — a venda dupla. Leve a verificação para a cláusula `WHERE` ou para uma constraint.
    - **Transações longas**: uma transação aberta durante uma chamada HTTP, o tempo em que o usuário pensa ou um relatório grande segura locks e versões MVCC antigas durante toda a sua duração.
    - **Tentar de novo sem idempotência**: as estratégias serializable e otimista exigem novas tentativas; o código repetido precisa ser seguro para rodar duas vezes.
    - **Subir o nível de isolamento como solução mágica**: o comportamento muda de banco para banco, os abortos aumentam sob carga e continua sendo preciso um laço de novas tentativas.
    - **Ordem de lock inconsistente** ao travar várias linhas: deadlocks justamente sob a carga que você está testando.
    - **Colocar a decisão em cache**: o *mapa* de assentos pode vir de um cache; a *reserva* precisa sempre ir ao banco (veja [Cache](../../caching/index.md)).

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    ACID["ACID"] --> ISO["níveis de isolamento<br/>snapshots MVCC"]
    ISO --> ANOM["anomalias: atualização perdida,<br/>write skew"]
    ANOM --> BUG["o bug da venda duplicada<br/>corrida verificar-depois-agir"]
    BUG --> FIX["UPDATE condicional, FOR UPDATE,<br/>coluna de versão, restrição de unicidade"]
    FIX --> HOLD["reservas como leases<br/>expiração preguiçosa + job de limpeza"]
    FIX --> CONT["linhas quentes limitam a vazão<br/>a 1 / tempo de lock"]
    CONT --> WR["sala de espera<br/>→ Mensageria"]
    BUG -.-> DIST["modelos de consistência<br/>→ Distribuídos"]
    ACID --> XS["entre serviços: saga, outbox,<br/>idempotency keys"]
```

**Componentes da paleta:** [`sql`](../../../reference/components/storage/index.md#sql) (o banco do `inventory` decide: updates condicionais, locks de linha, restrições) · [`app`](../../../reference/components/compute/index.md#app) (o `inventory` responde `409` aos perdedores; as transações ficam curtas) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sala de espera limita a contenção nas linhas quentes) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (o job que devolve as reservas expiradas) · [`stream`](../../../reference/components/messaging/index.md#stream) (eventos de outbox entre `order`, `inventory` e `payment`) · [`payment`](../../../reference/components/external/index.md#payment) (chamado com uma idempotency key, nunca dentro de uma transação). **Cenários:** `flash-sale`, `payment-system`. **Continua em:** [Replicação](../replication/index.md), [Distribuídos — transações](../../distributed/transactions/index.md), [Mensageria — padrões](../../messaging/patterns/index.md), [Compute — schedulers](../../compute/async-work/index.md#schedulers), [Estudo de caso: ingressos](../../case-studies/ticketing/index.md), [Hands-on 6](../../../hands-on/6/index.md).

---

[^1]: GRAY, J.; REUTER, A. *Transaction Processing: Concepts and Techniques*. Morgan Kaufmann, 1992.
[^2]: BERENSON, H. et al. A Critique of ANSI SQL Isolation Levels. *ACM SIGMOD*, 1995. Veja também KLEPPMANN, M. [Hermitage: testing transaction isolation levels](https://github.com/ept/hermitage){target="_blank"}.
[^3]: PostgreSQL Global Development Group. [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html){target="_blank"}. Documentação do PostgreSQL.
[^4]: PORTS, D. R. K.; GRITTNER, K. Serializable Snapshot Isolation in PostgreSQL. *Proceedings of the VLDB Endowment*, 5(12), 2012.
