# 4. Sala de Espera { #4-waiting-room }

Às 10:00, 2 milhões de fãs apertam "Comprar" para 60 mil assentos. O Kafka protege `notification` da
rajada, mas a rajada atinge primeiro o caminho **síncrono**: reservas de assentos e pedidos, apoiados
em um inventário fortemente consistente que não escala para 2 milhões de requisições por segundo. A
resposta usual de sites de ingressos e de lançamentos de tênis é uma **sala de espera virtual**: uma
fila *na frente* do sistema que deixa os fãs entrarem no ritmo que o sistema consegue atender, em
ordem de chegada, e diz a todos os outros a sua posição com honestidade.

``` diagram-sim
flowchart LR
    fans["2 M de fãs"] -->|POST join| wr["sala de espera (FIFO no Redis)"]
    wr -->|"posição, ETA"| fans
    adm["admissor (a cada 1 s)"] -->|"ZPOPMIN N"| wr
    adm -->|"ticket admitido, TTL 5 min"| redis[(Redis)]
    fans -->|"POST /orders + X-Admission-Ticket"| order[order]
    order -->|"ticket admitido?"| redis
```

Isso é **nivelamento de carga por fila** (*queue-based load leveling*): as chegadas vêm em rajadas, o
atendimento é constante, e a fila guarda a diferença. A Lei de Little dá a estimativa honesta que o fã
vê:

$$
\text{espera} \approx \frac{\text{posição na fila}}{\text{taxa de admissão}}
\qquad \text{ex.: } \frac{30\,000}{500\ \text{fãs/s}} = 60\ \text{s}
$$

## Projeto { #design }

| Decisão | Escolha aqui | Por quê |
|---|---|---|
| Armazenamento da fila | um **sorted set** do Redis por show, score = sequência de chegada | entrada e posição em O(log n), retirada atômica dos N primeiros (`ZPOPMIN`) |
| Justiça | sequência vinda do `INCR`, não do relógio do cliente | o relógio dos clientes mente; quem decide a ordem é o servidor |
| Admissão | a cada segundo, retirar `admit-per-second` tickets e marcá-los como admitidos com TTL | a taxa é o botão de controle; o TTL libera a capacidade de quem desiste |
| Barreira | `POST /orders` exige um `X-Admission-Ticket` admitido **enquanto a venda está aberta** | sem fiscalização, robôs furam a fila |
| Posição | o cliente consulta `GET /tickets/{id}` periodicamente | simples; em escala, *push* por SSE/WebSocket ou *long polling* |

!!! warning "Onde fica a barreira"

    A barreira precisa cobrir **todos** os passos caros da venda (reservas de assentos no `inventory`
    e pedidos); por isso, em produção, ela vive na borda: um filtro no gateway ([lab 4](../../4/index.md))
    ou um produto de sala de espera de CDN. Este lab a aplica em `order` para ficar pequeno; movê-la
    para o gateway é uma boa extensão.

## Código (no serviço `order`) { #code-in-the-order-service }

=== "WaitingRoom.java"

    ``` java title="services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoom.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoom.java"
    ```

=== "Ticket.java"

    ``` java title="services/order/src/main/java/boxoffice/order/waitingroom/Ticket.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/Ticket.java"
    ```

=== "WaitingRoomProperties.java"

    ``` java title="services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoomProperties.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoomProperties.java"
    ```

=== "WaitingRoomController.java"

    ``` java title="services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoomController.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoomController.java"
    ```

=== "OrderController.java (com barreira)"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderController.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderController.java"
    ```

As propriedades da sala de espera já estão no `services/order/src/main/resources/application.yaml` completo
do [passo 2](../outbox/index.md); confira que o seu tem este bloco (adicione-o se escreveu o arquivo à mão):

``` yaml title="services/order/src/main/resources/application.yaml (additions)"
boxoffice:
  waiting-room:
    admit-per-second: ${ADMIT_PER_SECOND:20}
    admission-ttl: 5m
```

## Experimente { #try-it }

<!-- termynal -->

``` shell
> docker compose up -d --build --wait order
> curl -s -X POST localhost:8084/orders/waiting-room/show-42/open -o /dev/null -w '%{http_code}\n'
204
> curl -s -X POST localhost:8084/orders/waiting-room/show-42/join
{"ticketId":"0c6f3b8e-0f2a-4a8e-9d55-1b7c5b3c9e21","status":"WAITING","position":1,"etaSeconds":1}
> curl -s localhost:8084/orders/waiting-room/show-42/tickets/0c6f3b8e-0f2a-4a8e-9d55-1b7c5b3c9e21
{"ticketId":"0c6f3b8e-0f2a-4a8e-9d55-1b7c5b3c9e21","status":"ADMITTED","expiresInSeconds":298}
> curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
    -d '{"showId":"show-42","holdId":"hold-0100","customerEmail":"caio@example.com","amount":350.00}' \
    -o /dev/null -w '%{http_code}\n'
403
> curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
    -H 'X-Admission-Ticket: 0c6f3b8e-0f2a-4a8e-9d55-1b7c5b3c9e21' \
    -d '{"showId":"show-42","holdId":"hold-0100","customerEmail":"caio@example.com","amount":350.00}' \
    -o /dev/null -w '%{http_code}\n'
201
```

Espie a estrutura de dados enquanto um pico do k6 roda ([passo 5](../measure/index.md)):

``` shell
docker compose exec redis redis-cli ZCARD wr:show-42:queue
docker compose exec redis redis-cli ZRANGE wr:show-42:queue 0 4 WITHSCORES
```

!!! warning "Armadilhas"

    - **O admissor precisa rodar uma vez só.** Com 3 réplicas de `order`, três admissores retiram
      3 × N por segundo. Rode-o em uma única instância (um *worker* dedicado), eleja um líder ou use uma
      trava distribuída (por exemplo, ShedLock) — veja a
      [discussão sobre agendadores](../../../classes/compute/async-work/index.md).
    - **Admitido ≠ comprou.** O TTL devolve vagas abandonadas; um admissor mais esperto admite
      `capacidade − compradores ativos` em vez de um N fixo.
    - **A própria sala de espera precisa escalar.** Entrar e consultar são operações baratas no Redis,
      mas 2 M de fãs consultando a cada segundo são 2 M de requisições por segundo: consulte com menos
      frequência quando a posição está longe, sirva a página de espera pela CDN e mantenha a fila em um
      Redis próprio.
    - **Robôs** entram muitas vezes. Limite as entradas por cliente e exija um desafio (WAF) antes de
      entrar.

[Próximo: Meça](../measure/index.md){ .md-button .md-button--primary }
