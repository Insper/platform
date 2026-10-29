Uma **reserva** (*hold*) diz "estes assentos são meus por 10 minutos, enquanto eu pago". O invariante: **um assento pertence a no máximo uma reserva viva**. Tudo neste passo trata de manter esse invariante verdadeiro quando centenas de fãs clicam nos mesmos assentos no mesmo segundo.

## 1. Por que "confere, depois atualiza" não basta { #1-why-check-then-update-is-not-enough }

O código óbvio lê os assentos, confere se estão `AVAILABLE` e então os atualiza. Sob concorrência, duas transações podem se intercalar:

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as Fã A (tx 1)
    participant DB as PostgreSQL
    participant B as Fã B (tx 2)
    A->>DB: SELECT status FROM seats WHERE id IN (7,8)
    DB-->>A: AVAILABLE, AVAILABLE
    B->>DB: SELECT status FROM seats WHERE id IN (7,8)
    DB-->>B: AVAILABLE, AVAILABLE
    A->>DB: UPDATE seats SET status='HELD', hold_id=A ...
    B->>DB: UPDATE seats SET status='HELD', hold_id=B ... (espera os locks de linha de A)
    A->>DB: COMMIT
    DB-->>B: o update prossegue — sobrescreve a reserva de A
    B->>DB: COMMIT
    Note over A,B: os dois fãs receberam 201 para os assentos 7 e 8: VENDA DUPLICADA
```

O isolamento padrão do PostgreSQL, **READ COMMITTED**, não impede esse *lost update*: cada comando vê dados confirmados, mas nada amarra a decisão de B (tomada no `SELECT`) aos dados no momento em que B escreve. Três correções:

| Estratégia | Como | Em conflito | Boa quando |
|---|---|---|---|
| **Pessimista** | `SELECT … FOR UPDATE` trava as linhas até o commit; a segunda transação **espera** e então vê `HELD` | 409 depois de esperar | a contenção é **alta** (a venda relâmpago: todo mundo quer os mesmos 100 assentos) |
| **Otimista** | lê sem locks; `UPDATE … WHERE version = :v`; 0 linhas alteradas → alguém foi mais rápido | 409 na hora, a transação faz rollback | a contenção é **baixa**; sem espera, sem filas de locks |
| **Update condicional** | `UPDATE … WHERE id IN (…) AND status = 'AVAILABLE'` e confere a contagem de linhas | 409 na hora | um único comando consegue expressar a verificação (uma variante da otimista) |
| Isolamento serializável | `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` | o banco aborta uma transação (`40001`), a aplicação tenta de novo | invariantes complexos sobre muitas linhas |

## 2. O serviço `inventory` { #2-the-inventory-service }

Crie `services/inventory` (porta **8083**, schema `inventory`, mesmo padrão de `Dockerfile` com `EXPOSE 8083`). Ele usa o **JdbcClient** com SQL puro em vez de JPA: todo lock e todo `WHERE` ficam visíveis no código, que é o propósito deste lab.

??? example "`services/inventory/Dockerfile` e `.dockerignore` (iguais aos do `catalog`, só muda o `EXPOSE 8083`)"

    ``` { .dockerfile title="services/inventory/Dockerfile" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/Dockerfile"
    ```

    ``` { .text title="services/inventory/.dockerignore" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/.dockerignore"
    ```

``` { .xml title="services/inventory/pom.xml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/pom.xml"
```

``` { .yaml title="services/inventory/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/resources/application.yaml"
```

=== "V1__create_inventory.sql"

    ``` { .sql title="services/inventory/src/main/resources/db/migration/V1__create_inventory.sql" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/resources/db/migration/V1__create_inventory.sql"
    ```

=== "V2__seed_seats.sql"

    ``` { .sql title="services/inventory/src/main/resources/db/migration/V2__seed_seats.sql" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/resources/db/migration/V2__seed_seats.sql"
    ```

`hold_seats` registra quais assentos cada reserva *pediu*. A coluna `seats.hold_id` pode ser sobrescrita por uma estratégia com bug, mas `hold_seats` guarda a evidência: a consulta de auditoria conta os assentos que aparecem em mais de uma reserva viva.

Os records e a classe da aplicação:

=== "InventoryApplication"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/InventoryApplication.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/InventoryApplication.java"
    ```

=== "HoldIn"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldIn.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldIn.java"
    ```

=== "HoldOut"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldOut.java"
    ```

=== "SeatOut"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/SeatOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/SeatOut.java"
    ```

=== "SectionAvailability"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/SectionAvailability.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/SectionAvailability.java"
    ```

## 3. Três estratégias em um serviço { #3-three-strategies-in-one-service }

``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldService.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldService.java"
```

Leia estratégia por estratégia:

- **naive**: `read(…, "")` e depois um `UPDATE` incondicional. O comentário marca a janela da corrida.
- **pessimistic**: `read(…, "ORDER BY id FOR UPDATE")`. A segunda transação bloqueia nos locks de linha; quando a primeira faz commit, o PostgreSQL relê as linhas travadas, a segunda vê `HELD` e o `requireAvailable` lança `409`. **Travar numa ordem fixa** (`ORDER BY id`) importa: o fã A reservando os assentos 7→8 e o fã B reservando 8→7 em ordem oposta entrariam em deadlock.
- **optimistic**: sem locks; o `UPDATE` só tem sucesso se o `version` ainda for o que lemos. Se outra transação alterou o assento nesse meio-tempo, 0 linhas mudam, lançamos uma exceção e o `@Transactional` desfaz tudo (inclusive os assentos já atualizados no laço).
- Toda reserva também confere se **todos** os assentos pertencem ao evento (`400` caso contrário) e limita uma reserva a **6 assentos**.
- `find`, `confirm` e `release` filtram por `user_id`: um fã não consegue ver nem cancelar a reserva de outra pessoa (isso seria um *IDOR*, insecure direct object reference — OWASP API #1).
- `expireHolds` roda a cada 5 s em cada réplica; `FOR UPDATE SKIP LOCKED` deixa várias réplicas dividirem o trabalho sem bloquear umas às outras nem processar uma reserva duas vezes — o mesmo truque usado por filas de jobs construídas sobre o PostgreSQL.

As consultas somente leitura ficam numa classe separada, porque vão para a réplica (passo 2):

``` { .java title="services/inventory/src/main/java/boxoffice/inventory/SeatQueries.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/SeatQueries.java"
```

``` { .java title="services/inventory/src/main/java/boxoffice/inventory/InventoryController.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/InventoryController.java"
```

## 4. Ligue-o ao gateway { #4-wire-it-into-the-gateway }

Adicione a rota e abra os endpoints de leitura (as reservas continuam protegidas pela regra padrão):

``` { .yaml title="services/gateway/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/gateway/src/main/resources/application.yaml"
```

``` { .java title="services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java"
```

O arquivo do Compose com o `inventory`, a réplica e o PgBouncer está no [passo 2](../replicas/index.md#3-compose); suba tudo depois desse passo, ou agora com o arquivo completo.

## 5. Confira à mão { #5-check-it-by-hand }

Com a stack completa do [passo 2](../replicas/index.md#3-compose) rodando, faça login e percorra uma reserva. Todos os comandos na raiz do repositório:

``` { .bash .copy }
curl -s -X POST localhost/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ana","email":"ana@example.com","password":"secret-123"}'
export TOKEN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"secret-123"}' | jq -r .accessToken)
export ADMIN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@boxoffice.dev","password":"boxoffice-admin"}' | jq -r .accessToken)

curl -s localhost/inventory/events/1/availability | jq -c '.[0]'
HOLD=$(curl -s -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[1,2]}')
echo "$HOLD"
export HOLD_ID=$(echo "$HOLD" | jq -r .id)

# the same seat for somebody else, no token, somebody else's hold
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost/inventory/holds -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[2,3]}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost/inventory/holds \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[5]}'
curl -s -o /dev/null -w "%{http_code}\n" localhost/inventory/holds/$HOLD_ID -H "Authorization: Bearer $ADMIN"

# pay (lab 7 will do this through order) and look again
curl -s -X POST localhost/inventory/holds/$HOLD_ID/confirm -H "Authorization: Bearer $TOKEN" | jq -c '{status, seatIds}'
curl -s localhost/inventory/events/1/availability | jq -c '.[0]'
curl -s localhost/inventory/audit/double-bookings -H "Authorization: Bearer $TOKEN"
```

Você deve ver (de uma execução deste lab; ids e horários diferem):

``` { .text }
{"section":"S01","available":2000,"held":0,"sold":0}
{"id":"c869f791-701d-41dd-b82f-d5a6ba48093e","eventId":1,"status":"ACTIVE","expiresAt":"2026-10-18T17:51:50.567788219Z","seatIds":[1,2]}
409
401
404
{"status":"CONFIRMED","seatIds":[1,2]}
{"section":"S01","available":1998,"held":0,"sold":2}
{"doubleBookedSeats":0}
```

`409`: o assento 2 já está reservado. `401`: reservas exigem um token. `404`: a reserva de outro usuário não existe para você. Rode `bash scripts/reset-inventory.sh` em seguida para pôr os assentos de volta à venda.

## 6. O teste da venda relâmpago { #6-the-flash-sale-test }

``` { .javascript title="load/lib.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/load/lib.js"
```

``` { .javascript title="load/flash-sale.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/load/flash-sale.js"
```

``` { .bash title="scripts/reset-inventory.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/scripts/reset-inventory.sh"
```

Rode-o uma vez por estratégia, reiniciando os assentos a cada vez:

``` { .bash .copy }
for mode in naive pessimistic optimistic; do
  INVENTORY_LOCKING=$mode docker compose up -d inventory
  sleep 25                                   # wait until inventory is healthy again
  bash scripts/reset-inventory.sh
  k6 run load/flash-sale.js 2>&1 | tee results/lab6-flash-$mode.txt | grep -E "AUDIT|holds_|name:hold"
done
```

<!-- termynal -->
``` shell
> INVENTORY_LOCKING=naive ... k6 run load/flash-sale.js
INFO AUDIT double-booked seats: 9                          source=console
    holds_conflict.................: 11582  263.28/s
    holds_created..................: 162    3.68/s
      { name:hold }................: avg=312.03ms med=208.6ms  p(95)=808.96ms p(99)=1.88s
> INVENTORY_LOCKING=pessimistic ... k6 run load/flash-sale.js
INFO AUDIT double-booked seats: 0                          source=console
    holds_conflict.................: 16184  402.17/s
    holds_created..................: 141    3.50/s
      { name:hold }................: avg=171.94ms med=78.37ms  p(95)=665.17ms p(99)=1.77s
> INVENTORY_LOCKING=optimistic ... k6 run load/flash-sale.js
INFO AUDIT double-booked seats: 0                          source=console
    holds_conflict.................: 20028  512.57/s
    holds_created..................: 141    3.61/s
      { name:hold }................: avg=93.62ms  med=31.02ms  p(95)=354.94ms p(99)=1.03s
```

Esses números vêm de uma execução num notebook ocupado — os seus vão diferir —, mas o que importa é a forma: **o naive criou mais reservas do que os assentos permitem e a auditoria encontrou 9 assentos vendidos duas vezes**; pessimistic e optimistic sempre terminam com `0`. Com só 100 assentos, a maioria das tentativas é `409` (os assentos acabaram), que o script conta como resposta esperada, não como erro. Compare também a latência das requisições `hold`: as transações pessimistas fazem fila nos locks de linha, as otimistas falham rápido — aqui o optimistic teve o menor p99, porque um fã em conflito descobre "ocupado" sem esperar o lock de ninguém.

??? question "Pense primeiro: se o lock pessimista é correto, por que alguém usaria o lock otimista?"

    Locks custam espera. Quando a contenção é baixa (fãs espalhados por 60.000 assentos, a maioria das reservas toca linhas diferentes), o lock otimista nunca espera e quase nunca entra em conflito, então sai mais barato. Quando a contenção é alta (todo mundo quer as primeiras fileiras), o lock otimista vira uma tempestade de conflitos e retries, enquanto o pessimista serializa as requisições de forma organizada. Meça a sua contenção antes de escolher — e lembre que o design real da venda relâmpago também *reduz* a contenção antes do banco: uma sala de espera (lab 7) admite os fãs numa taxa que o inventário consegue absorver.

!!! tip "Na entrevista"

    Para "projete o Ticketmaster", diga explicitamente: *"o inventário de assentos é o único lugar que precisa de consistência forte; vou usar um banco relacional com lock por linha (ou updates condicionais) para as reservas, com um TTL em cada reserva, e todo o resto — catálogo, busca, mapas de assentos — pode ser eventualmente consistente e ficar em cache."* Depois mencione o problema da linha quente: milhares de fãs nos mesmos 100 assentos se serializam nos locks, então coloque-os numa fila *antes* do banco.

Próximo: [2. Réplica e pool de conexões](../replicas/index.md).
