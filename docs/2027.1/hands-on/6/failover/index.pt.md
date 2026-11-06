Às 10:01, um minuto depois de a venda abrir, o primário morre. A réplica do [passo 2](../replicas/index.md) vinha servindo os mapas de assentos; agora ela é também a única cópia dos dados que continua de pé. Este passo torna esse sobressalente útil: você deixa a replicação **síncrona** e paga por isso, **derruba** o primário com uma reserva em andamento, faz o **failover** à mão, vê um **split brain** acontecer e traz o antigo primário de volta com o **`pg_rewind`**. No fim, a stack fica exatamente como o lab 7 espera.

``` diagram-sim
sequenceDiagram
    autonumber
    participant F as Fã (Ana)
    participant P as db (primário)
    participant R as db-replica
    participant S as serviços
    F->>P: POST /inventory/holds (assentos 20, 21)
    P-->>F: 201 Created (assíncrono: R ainda não tem)
    Note over P: queda
    S->>P: escritas falham (504)
    S->>R: mapas de assentos continuam funcionando
    R->>R: pg_promote(): primário numa nova timeline
    Note over R: o nome "db" passa para R
    S->>R: escritas voltam, nenhuma configuração mudou
    F->>R: GET /inventory/holds/{id}
    R-->>F: 404: a reserva se perdeu
```

Todo comando roda a partir da raiz do seu repositório `boxoffice/`, com a stack do [passo 2](../replicas/index.md#3-compose) rodando.

## 1. Prepare o cluster { #prepare }

Duas mudanças pequenas nos scripts do passo 2. O primário liga o `wal_log_hints`, de que o `pg_rewind` precisa na seção 6:

``` { .bash title="infra/postgres/10-replication.sh" .copy linenums="1" hl_lines="7-8" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/10-replication.sh"
```

A réplica ganha um nome, `cluster_name=db-replica`: é assim que o primário se refere a ela no `pg_stat_replication` e no `synchronous_standby_names`. O `pg_basebackup` também ganha `-c fast`, que faz um clone novo começar na hora, em vez de esperar minutos por um checkpoint (você vai clonar de novo na seção 7):

``` { .bash title="infra/postgres/replica-entrypoint.sh" .copy linenums="1" hl_lines="8 13-15" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/replica-entrypoint.sh"
```

O `10-replication.sh` só roda quando o volume é criado e o seu já existe; então ligue a opção à mão (o `ALTER SYSTEM` grava no `postgresql.auto.conf`, dentro do diretório de dados) e reinicie. O `--force-recreate` faz o contêiner da réplica pegar o script novo:

``` { .bash .copy }
docker compose exec db psql -U boxoffice -c "ALTER SYSTEM SET wal_log_hints = on"
docker compose restart db
docker compose up -d --force-recreate --wait db-replica
docker compose exec db psql -U boxoffice -c "SHOW wal_log_hints" \
  -c "SELECT application_name, state, sync_state FROM pg_stat_replication"
```

Você deve ver:

``` { .text }
 wal_log_hints
---------------
 on

 application_name |   state   | sync_state
------------------+-----------+------------
 db-replica       | streaming | async
```

Entre como Ana (a usuária do [passo 1](../holds/index.md#5-check-it-by-hand); cadastre-a antes se o seu volume for novo) e guarde o token para o passo inteiro:

``` { .bash .copy }
curl -s -X POST localhost/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ana","email":"ana@example.com","password":"secret-123"}' > /dev/null
export TOKEN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"secret-123"}' | jq -r .accessToken)
```

## 2. Replicação síncrona { #synchronous }

Até aqui, o primário responde `COMMIT` assim que o WAL está no disco **dele**: se ele morrer um instante depois, a réplica pode nunca receber aquela transação. O `synchronous_standby_names` faz o primário esperar por um standby antes de responder:

``` { .bash .copy }
docker compose exec -T db psql -U boxoffice <<'SQL'
ALTER SYSTEM SET synchronous_standby_names = 'FIRST 1 ("db-replica")';
SELECT pg_reload_conf();
SELECT pg_sleep(1);          -- the primary re-reads its standbys right after the reload
SELECT application_name, sync_state FROM pg_stat_replication;
SQL
```

O `sync_state` vira `sync` (`potential` quer dizer que foi lido cedo demais: rode o `SELECT` de novo). As aspas duplas não são enfeite: sem elas, o PostgreSQL lê `db-replica` como `db` menos `replica` e rejeita a configuração com `syntax error at or near "-"`.

**Quanto tempo ele espera?** Quem decide é o `synchronous_commit`, por transação:

| `synchronous_commit` | O `COMMIT` volta quando o WAL está… | Uma queda do primário perde | Leituras defasadas na réplica |
|---|---|---|---|
| `local` | no disco do primário | as últimas transações | sim |
| **`on`** (padrão) | no disco do primário **e do standby** | nada | **sim**: estar no disco não é ter sido reaplicado |
| `remote_apply` | **reaplicado** no standby | nada | **não** |

Meça as duas últimas colunas com o teste de read-your-writes do passo 2, com o atraso artificial de 1 segundo:

``` { .bash .copy }
REPLICA_DELAY=1s docker compose up -d --wait db-replica
bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js      # synchronous_commit = on
docker compose exec db psql -U boxoffice -c "ALTER SYSTEM SET synchronous_commit = 'remote_apply'" -c "SELECT pg_reload_conf()"
bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js      # remote_apply
docker compose exec db psql -U boxoffice -c "ALTER SYSTEM RESET synchronous_commit" -c "SELECT pg_reload_conf()"
REPLICA_DELAY=0 docker compose up -d --wait db-replica
```

Em duas execuções deste lab:

| `synchronous_commit` (réplica 1 s atrás) | `stale_reads` | `iteration_duration` (média) |
|---|---:|---:|
| `on` | 93–100% | 45–380 ms |
| `remote_apply` | **0%** | **2 s** |

O `remote_apply` resolve o read-your-writes por completo e cada iteração passa a levar 2 segundos: a reserva espera a réplica reaplicá-la (1 s) e a liberação no fim também (1 s). O atraso deixa de ser um problema de defasagem e vira um problema de **latência** em toda escrita.

!!! warning "Nunca ligue o `remote_apply` para o servidor inteiro"

    Configurado assim, ele vale para toda transação de todo serviço: com a réplica 1 s atrás, cadastrar um fã no `auth` levou **1,1 s** numa execução de teste e todo script do k6 que cria fãs fica lento junto. Se uma operação precisa dele, peça só naquela transação: `SET LOCAL synchronous_commit = remote_apply` dentro da transação da reserva.

**Quando a réplica falha.** Replicação síncrona com um standby só faz desse standby um ponto único de falha para as **escritas**:

``` { .bash .copy }
bash scripts/reset-inventory.sh
docker compose stop db-replica
curl -s -o /dev/null -w "hold: %{http_code} after %{time_total}s\n" --max-time 10 -X POST localhost/inventory/holds \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[10]}'
curl -s -o /dev/null -w "seat map: %{http_code}\n" localhost/inventory/events/1/availability
docker compose exec db psql -U boxoffice -c "UPDATE inventory.seats SET version = version WHERE id = 1"
```

A reserva recebe `504` depois de 5 s (o timeout do gateway), o mapa de assentos também recebe `504` (as leituras dele vão para a réplica) e o `UPDATE` **trava**. Aperte ++ctrl+c++:

``` { .text }
Cancel request sent
WARNING:  canceling wait for synchronous replication due to user request
DETAIL:  The transaction has already committed locally, but might not have been replicated to the standby.
UPDATE 1
```

"Already committed locally": cancelar não desfaz nada. Traga a réplica de volta e olhe o assento 10:

``` { .bash .copy }
docker compose start db-replica
docker compose exec db psql -U boxoffice -c "SELECT id, status FROM inventory.seats WHERE id = 10"
```

O assento 10 está `HELD`. A fã viu um erro e a reserva existe. Por isso, um cliente que tenta de novo precisa reconhecer a própria tentativa anterior (uma chave de idempotência, veja [semântica de entrega](../../../classes/messaging/semantics/index.md)), ou vai receber `409` por um assento que já é dele.

Com dois ou mais standbys, `ANY 1 (a, b)` espera por quem responder primeiro: uma réplica pode falhar sem parar as escritas. É a configuração comum em produção e o que os serviços gerenciados chamam de standby síncrono. Volte para a replicação assíncrona no resto do passo:

``` { .bash .copy }
docker compose exec db psql -U boxoffice -c "ALTER SYSTEM RESET synchronous_standby_names" -c "SELECT pg_reload_conf()"
```

## 3. O primário morre { #crash }

Numa máquina só, a réplica fica apenas milissegundos atrás, pouco demais para perder uma escrita quando você quer. Pare-a por um momento para abrir essa janela: a reserva da Ana chega ao primário e **só** ao primário.

``` { .bash .copy }
bash scripts/reset-inventory.sh
docker compose stop db-replica
export HOLD_ID=$(curl -s -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[20,21]}' | tee /dev/stderr | jq -r .id)
docker compose kill db
docker compose up -d --no-deps db-replica
```

A reserva respondeu `201` com status `ACTIVE`: para a Ana, os assentos 20 e 21 são dela. Depois, `kill` (e não `stop`): sem desligamento limpo, como numa queda de verdade.

!!! warning "`--no-deps` e não `docker compose start db-replica`"

    O `db-replica` depende do `db`, então um `start` simples traz o primário morto de volta também e não sobra nada para o failover. O `up -d --no-deps` sobe só o serviço que você nomeia.

O que ainda funciona? Dê alguns segundos para o `inventory` se reconectar à réplica reiniciada e teste cada caminho da stack (fique neste terminal: as próximas seções reaproveitam `probe`, `$TOKEN` e `$HOLD_ID`):

``` { .bash .copy }
sleep 10
probe() { curl -s -o /dev/null --max-time 10 -w "%{http_code} %{time_total}s  $1\n" "${@:2}"; }
probe "seat map (replica)"  localhost/inventory/events/1/availability
probe "hold (primary)"      -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
                              -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[30]}'
probe "login (auth → db)"   -X POST localhost/auth/login -H 'Content-Type: application/json' \
                              -d '{"email":"ana@example.com","password":"secret-123"}'
probe "event 1 (catalog)"   localhost/catalog/events/1
```

Você deve ver:

``` { .text }
200 0.58s  seat map (replica)
504 5.01s  hold (primary)
504 5.03s  login (auth → db)
504 5.01s  event 1 (catalog)
```

A réplica mantém os mapas de assentos de pé: uma réplica de leitura também é um pouco de **disponibilidade**. Tudo o que escreve e tudo o que lê do primário espera até o gateway desistir. (Um item do catálogo que ainda estiver no Redis responderia `200` até o TTL expirar: o cache do lab 5 é outra camada que esconde uma queda do banco, por um tempo.)

## 4. Faça o failover { #failover }

Um failover são duas decisões: **qual** nó vira o primário e **como os clientes o encontram**. Promova a réplica:

``` { .bash .copy }
docker compose exec db-replica psql -U boxoffice -c "SELECT pg_promote()" -c "SELECT pg_is_in_recovery()"
```

`pg_is_in_recovery` = `f`: o `db-replica` agora aceita escritas, numa nova **timeline** (a história dele se separa da do antigo primário aqui). Mas todo serviço ainda se conecta ao nome `db`: o PgBouncer, o `auth`, os três `catalog`, as migrações do `inventory`. Em vez de reconfigurar todos eles, **mova o nome**. O DNS do Docker responde `db` com o endereço do contêiner que tiver esse alias na rede:

``` { .bash .copy }
docker network disconnect boxoffice_default boxoffice-db-replica-1
docker network connect --alias db --alias db-replica boxoffice_default boxoffice-db-replica-1
docker compose exec pgbouncer getent hosts db db-replica
```

``` { .text }
172.23.0.3        db  db
172.23.0.3        db-replica  db-replica
```

Os dois nomes agora levam ao novo primário. É o que um banco gerenciado faz no failover: o RDS aponta o nome DNS do endpoint para o standby; outras soluções movem um IP virtual ou reconfiguram um proxy. Os clientes só percebem que as conexões caíram. Rode os testes de novo, duas vezes, com 15 segundos de intervalo:

``` { .bash .copy }
sleep 15; probe "hold" -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[40]}'
probe "login" -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"secret-123"}'
probe "event 1" localhost/catalog/events/1
```

Numa execução deste lab, a primeira rodada logo depois da mudança ainda teve `504`; 15 segundos depois, tudo respondeu `200`/`201`. Os pools descartam as conexões quebradas e abrem novas e cada processo resolve `db` de novo (a JVM guarda um nome por 30 s, o PgBouncer por até 15 s). Nenhum arquivo mudou, nenhum serviço reiniciou.

Agora procure a reserva da Ana:

``` { .bash .copy }
curl -s localhost/inventory/holds/$HOLD_ID -H "Authorization: Bearer $TOKEN" | jq -c '{status, title}'
docker compose exec db-replica psql -U boxoffice -c "SELECT id, status FROM inventory.seats WHERE id IN (20, 21)"
```

``` { .text }
{"status":404,"title":"Not Found"}
 id |  status
----+-----------
 20 | AVAILABLE
 21 | AVAILABLE
```

**A reserva sumiu** e os assentos 20 e 21 voltaram à venda: outro fã pode comprá-los, enquanto a Ana tem um `201` dizendo que são dela. A reserva só existia no WAL do primário morto. Esse é o **RPO** (recovery point objective) da replicação assíncrona: o que foi confirmado mas ainda não tinha sido enviado. A seção 2 é o preço de zerá-lo.

!!! info "Um nó, nenhum sobressalente"

    A stack roda, mas sobre um banco só: o `db-replica` agora também é o primário e os mapas de assentos o dividem com as escritas. Até a seção 7, não resta cópia para onde fazer failover.

## 5. Split brain { #split-brain }

E se o antigo primário não estava morto, só inalcançável (uma VM congelada, uma rede cortada) e volta? Suba-o do jeito que está:

``` { .bash .copy }
docker compose start db
sleep 5
docker compose exec pgbouncer getent ahosts db | awk '{print $1}' | sort -u
for s in db db-replica; do
  echo "$s: primary=$(docker compose exec -T $s psql -U boxoffice -qAt -c 'SELECT NOT pg_is_in_recovery()')," \
       "seat 20=$(docker compose exec -T $s psql -U boxoffice -qAt -c 'SELECT status FROM inventory.seats WHERE id = 20')"
done
```

``` { .text }
172.23.0.3
172.23.0.8
db: primary=t, seat 20=HELD
db-replica: primary=t, seat 20=AVAILABLE
```

Dois primários, um nome, duas respostas sobre o assento 20. Cada conexão nova com `db` cai em qualquer um dos dois: o PgBouncer poderia pôr a próxima reserva da Ana num servidor e a auditoria no outro e os dois responderiam satisfeitos. Nada aqui consegue dizer qual está certo. Isso é um **split brain**.

**Isole** (fencing) o antigo primário antes que algo escreva nele:

``` { .bash .copy }
docker compose stop db
```

Em produção, uma pessoa fazendo isso à mão às 10:01 é lenta e arriscada demais. Um gerenciador de failover como o Patroni guarda uma **chave de líder** no etcd, renovada a cada poucos segundos: um primário que não consegue renová-la se rebaixa e um nó só pode se promover se tiver a chave. É o consenso decidindo quem é o líder ([Consenso e quóruns](../../../classes/distributed/consensus/index.md)) e o fencing garantindo que o perdedor pare (no extremo, STONITH: "shoot the other node in the head", derrubar o outro nó à força).

## 6. Traga o antigo primário de volta com o `pg_rewind` { #rejoin }

O diretório de dados do antigo primário tem uma história que o novo primário nunca teve: a reserva perdida da Ana e depois a escrita do assento 20 durante o split brain. Ele não pode simplesmente seguir o novo primário. O `pg_rewind` encontra onde as duas timelines se separaram, copia do novo primário todo bloco que mudou desde então e joga fora o que só o antigo tinha:

``` { .bash title="infra/postgres/rejoin-as-replica.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/rejoin-as-replica.sh"
```

Ele precisa do diretório de dados, mas não de um servidor rodando; por isso roda num contêiner avulso do serviço `db`, com a pasta dos scripts montada:

``` { .bash .copy }
chmod +x infra/postgres/*.sh
docker compose run --rm --no-deps -v ./infra/postgres:/scripts:ro --entrypoint bash db \
  /scripts/rejoin-as-replica.sh db-replica
```

``` { .text }
pg_rewind: connected to server
pg_rewind: servers diverged at WAL location 0/819D798 on timeline 1
pg_rewind: rewinding from last common checkpoint at 0/819B9C0 on timeline 1
pg_rewind: reading source file list
pg_rewind: reading target file list
pg_rewind: reading WAL in target
pg_rewind: need to copy 133 MB (total source directory size is 207 MB)
...
pg_rewind: Done!
rejoin: db will follow db-replica on its next start
```

``` { .bash .copy }
docker compose start db
sleep 5
docker compose exec db psql -U boxoffice -c "SELECT pg_is_in_recovery()" -c "SELECT status FROM inventory.seats WHERE id = 20"
docker compose exec db-replica psql -U boxoffice -c "SELECT application_name, state FROM pg_stat_replication"
```

O `db` agora é uma réplica (`pg_is_in_recovery` = `t`), o assento 20 está `AVAILABLE` nos dois (a escrita do split brain foi descartada) e o `db-replica` o lista como `walreceiver`, `streaming`. Sem o `wal_log_hints`, o `pg_rewind` para com `target server needs to use either data checksums or "wal_log_hints = on"` e o único caminho de volta é uma cópia completa.

!!! warning "Até a seção 7, `db` resolve para dois contêineres"

    O nome `db` é do serviço `db` e você o deu também ao `db-replica`. Uma escrita que cair no `db`, agora um standby somente leitura, falha com `cannot execute INSERT in a read-only transaction`. Trate a próxima seção como uma janela de manutenção e faça-a em seguida.

## 7. Volte ao primário original { #switchback }

Um **switchover** é um failover planejado: nada cai, então nada se perde. Ele devolve o primário ao `db` e deixa a stack exatamente como estava antes deste passo, que é o que o lab 7 espera.

``` { .bash .copy }
docker compose exec db-replica psql -U boxoffice -c "SELECT pg_current_wal_lsn(), replay_lsn FROM pg_stat_replication"
docker compose stop db-replica
docker compose exec db psql -U boxoffice -c "SELECT pg_promote()" -c "SELECT pg_is_in_recovery()"
```

Os dois LSNs são iguais: o `db` reaplicou tudo. Um desligamento limpo também espera até todo standby conectado ter recebido o último registro do WAL, então o `stop` não perde nada. As escritas param entre o `stop` e o `pg_promote()`, por alguns segundos.

O `db-replica` agora é, por sua vez, um antigo primário. Ele poderia voltar com o `pg_rewind`, como na seção 6; para um banco deste tamanho, um clone novo é mais simples. Recriar o contêiner também remove o alias que você acrescentou à mão:

``` { .bash .copy }
docker compose rm -sf db-replica
docker volume rm boxoffice_replica-data
docker compose up -d --wait db-replica
docker compose exec db psql -U boxoffice -c "SELECT application_name, state, sync_state FROM pg_stat_replication"
docker compose exec pgbouncer getent hosts db db-replica
```

``` { .text }
 application_name |   state   | sync_state
------------------+-----------+------------
 db-replica       | streaming | async

172.23.0.8        db  db
172.23.0.3        db-replica  db-replica
```

Um nome, um endereço para cada um e o primário é o `db` de novo (na timeline 3: uma separação por promoção). Uma última verificação da stack inteira:

``` { .bash .copy }
probe "seat map" localhost/inventory/events/1/availability
probe "hold"     -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
                   -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[90]}'
probe "login"    -X POST localhost/auth/login -H 'Content-Type: application/json' \
                   -d '{"email":"ana@example.com","password":"secret-123"}'
probe "event 1"  localhost/catalog/events/1
curl -s localhost/inventory/audit/double-bookings -H "Authorization: Bearer $TOKEN"; echo
bash scripts/reset-inventory.sh
```

Todos os testes respondem `200` ou `201` e a auditoria diz `{"doubleBookedSeats":0}`.

## 8. O que você fez à mão { #in-production }

| Etapa | À mão neste lab | Em produção |
|---|---|---|
| Detectar a falha | você o matou | health checks com timeout (Patroni, RDS): curto demais faz failover numa pausa de GC, longo demais significa minutos sem escritas |
| Escolher o novo primário | a única réplica | o standby mais atualizado, escolhido por consenso (chave de líder no etcd) |
| Promover | `pg_promote()` | o gerenciador de failover |
| Mover os clientes | um alias na rede do Docker | DNS (endpoint do RDS), um IP virtual, um proxy (HAProxy, PgBouncer reconfigurado), ou strings de conexão com vários hosts (`targetServerType=primary`) |
| Isolar o antigo primário | `docker compose stop db` | expiração da chave de líder, STONITH, fencing tokens |
| Trazê-lo de volta | `pg_rewind` + `standby.signal` | o gerenciador de failover roda o `pg_rewind` |
| Decidir o que pode se perder | assíncrona: a última reserva | `synchronous_standby_names = 'ANY 1 (…)'` com dois standbys: RPO 0 sem que uma réplica pare as escritas |

Os serviços gerenciados (RDS Multi-AZ, Cloud SQL HA, Azure zone-redundant HA) fazem tudo isso por você, tipicamente em dezenas de segundos a alguns minutos. O seu design ainda precisa decidir o que a aplicação faz nesse meio-tempo: tentar de novo com backoff, mostrar "tente de novo", segurar a requisição numa fila (lab 7). Veja [Replicação — failover](../../../classes/databases/replication/index.md#failover-when-the-leader-dies) para a teoria.

??? question "Pense primeiro: a Ana recebeu `201`, a reserva se perdeu e os assentos foram vendidos para outra pessoa. De quem é o problema e o que poderia ter evitado?"

    O banco cumpriu a promessa: a replicação assíncrona diz, por definição, que os últimos commits podem se perder. Foi o **design** que decidiu que reservas podem se perder. As opções, da mais barata: aceitar e detectar (no lab 7, confirmar a reserva perdida falha com `404` e a Ana fica sabendo que os assentos foram embora); fazer só as reservas esperarem uma réplica (`ANY 1` sobre duas réplicas, `synchronous_commit = local` como padrão do servidor e `SET LOCAL synchronous_commit = on` na transação da reserva); ou usar um armazenamento que replica antes de confirmar (Aurora, Spanner, CockroachDB), pagando a latência em toda escrita.

!!! tip "Na entrevista"

    Quando desenhar um primário e uma réplica, diga o que acontece quando o primário morre: **RPO** (o que se perde: assíncrona = os últimos commits, síncrona = nada), **RTO** (quanto tempo as escritas ficam fora: detecção + promoção + reconexão dos clientes), **split brain** (quem decide o líder e como o antigo é isolado) e **como os clientes encontram o novo primário** (DNS, VIP, proxy, driver). "Colocamos uma réplica para ter alta disponibilidade" fica incompleto sem esses quatro.

Volte à [visão geral do lab](../index.md#measure-it) para registrar os resultados.
