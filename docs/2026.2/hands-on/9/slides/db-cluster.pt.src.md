---
marp: true
lang: pt-BR
title: Hands-on 9 — Cluster de banco de dados
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 9</div>

# Hands-on 9 — Cluster de banco de dados

**Um primário, duas réplicas, streaming replication — e cada trade-off que dá para provocar em um notebook**

<!--
Roteiro: (1) por que um cluster, e o que ele não resolve; (2) o WAL e a streaming replication;
(3) assíncrona × síncrona, CAP; (4) o projeto compose; (5) experimentos: lag, roteamento, commits síncronos;
(6) failover à mão, escritas perdidas, pg_rewind; (7) por que a automação precisa de consenso.
-->

---

## Um único container `db`

<div class="q">

O gateway roda 3 réplicas atrás do Nginx, o Redis faz cache das leituras. O container `db` para. **O que ainda funciona?**

</div>

- As escritas param, e também toda leitura que não acerta o cache.
- O banco de dados é o **ponto único de falha** que escalar os serviços não removeu.
- Um **cluster** mantém cópias dos dados em vários servidores, para que um possa assumir.

---

## O que um cluster oferece — e o que não oferece

| Objetivo | Oferece | **Não** oferece |
|---|---|---|
| **Disponibilidade** | um servidor com os dados, pronto para ser promovido | zero downtime: o failover leva segundos |
| **Escala de leituras** | `SELECT`s distribuídos entre as réplicas | escala de **escritas**: um primário recebe todas |
| **Durabilidade** | cada commit em outra máquina | proteção contra um `DELETE` errado (também replicado) |

<p class="small">Escalar escritas = <b>sharding</b> (Citus, Vitess). Este hands-on: <b>replicação</b> — cada nó tem todos os dados.</p>

---

## O WAL

- Antes de alterar uma página, o PostgreSQL acrescenta a alteração ao **write-ahead log**.
- Depois de um crash, o servidor reexecuta o WAL para se recuperar.
- A **streaming replication** o reaproveita: o primário envia registros do WAL, cada réplica os **reexecuta**.
- Resultado: cópias idênticas byte a byte — por isso a réplica é **somente leitura** e roda a **mesma versão major**.

<div class="ok">

A replicação física copia **páginas**; a lógica copia **alterações de linhas** por tabela (migrações, integrações).

</div>

---

## Assíncrona ou síncrona?

Quando o primário responde `COMMIT ok`?

| | **Assíncrona** (padrão) | **Síncrona** |
|---|---|---|
| Commit retorna | WAL no disco do primário | uma réplica confirmou o WAL |
| Latência de escrita | baixa | + 1 ida e volta na rede |
| Primário morre | últimos commits podem se **perder** (RPO > 0) | nada confirmado se perde (RPO = 0) |
| Réplica morre | nada muda | commits **bloqueiam** |

<div class="warn">

CAP na prática: a síncrona prefere **consistência**, a assíncrona prefere **disponibilidade**.

</div>

---

## O projeto compose

<div class="cols">
<div>

- 3 × `postgres:17`, um volume cada
- `pg-primary` `:5432`, `pg-replica1` `:5433`, `pg-replica2` `:5434`
- `PRIMARY_HOST` definido → o nó é uma réplica
- `client` (profile `tools`): `psql` dentro da rede

</div>
<div>

```bash
# node-entrypoint.sh, empty data dir
pg_basebackup -h "$PRIMARY_HOST" \
  -U "$REPLICATION_USER" \
  -D "$PGDATA" -X stream -R
# -R → standby.signal
#      + primary_conninfo
```

</div>
</div>

<p class="small"><code>init-primary.sh</code>: role <code>replicator</code>, <code>wal_keep_size</code>, <code>wal_log_hints</code>, regra no <code>pg_hba</code> — copiados para cada réplica.</p>

---

## Verifique

```bash
docker compose up -d --wait
docker compose exec pg-primary psql -U store \
  -c "SELECT application_name, state, sync_state FROM pg_stat_replication;"
```

```
 application_name | state     | sync_state
------------------+-----------+------------
 pg-replica1      | streaming | async
 pg-replica2      | streaming | async
```

- Em uma réplica: `pg_is_in_recovery()` → `t`, `pg_stat_wal_receiver` → streaming a partir do `pg-primary`.

---

## Experimentos 1–3: cópias, somente leitura, lag

- `CREATE TABLE` + `INSERT` no primário → as linhas aparecem nas duas réplicas.
- `INSERT` em uma réplica → `cannot execute INSERT in a read-only transaction`.
- `pg_wal_replay_pause()` na `pg-replica1`, `INSERT` no primário:
  - a `pg-replica1` conta **2**, a `pg-replica2` conta **3**
  - `pg_stat_replication` mostra os bytes de atraso

<div class="warn">

**Read-your-writes**: "eu criei o pedido, mas ele não está na minha lista".

</div>

---

## Experimento 4: roteamento por papel

```bash
host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write
host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=standby load_balance_hosts=random
```

```text
jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
```

- O driver tenta os hosts e fica com o que tem o papel certo.
- A lista nomeia **candidatos**, não *o* primário — ela sobrevive a um failover.

---

## Experimento 5: commits síncronos

- `synchronous_standby_names = 'FIRST 1 ("pg-replica1")'` → `sync_state = sync`
- Pare a `pg-replica1`, `INSERT` → **trava**. Ctrl+C:

```
WARNING:  canceling wait for synchronous replication due to user request
DETAIL:  The transaction has already committed locally, but might not
         have been replicated to the standby.
```

- `ANY 1 ("pg-replica1", "pg-replica2")` → quórum: uma réplica pode falhar.

<div class="q">

A linha está confirmada? *(Sim — só a espera foi cancelada.)*

</div>

---

## Failover à mão

| Passo | Comando |
|---|---|
| primário falha | `docker compose stop pg-primary` |
| promover | `SELECT pg_promote();` na `pg-replica1` → **timeline 2** |
| clientes | mesma connection string, `read-write` → `pg-replica1` |
| outra réplica | `ALTER SYSTEM SET primary_conninfo = 'host=pg-replica1 ...'` + reload |
| primário antigo | `rejoin-as-replica.sh` → `pg_rewind` + `standby.signal` |

<p class="small">Papéis trocados, nomes obsoletos: clusters reais chamam os nós de <code>pg-1</code>, <code>pg-2</code>… e perguntam <code>pg_is_in_recovery()</code>.</p>

---

## A escrita perdida

- Pare as duas réplicas, `INSERT 'lost-write'` → `INSERT 0 1`, e então **mate** o primário.
- Suba as réplicas, promova a `pg-replica1`: o `lost-write` **sumiu**.
- `pg_rewind` no primário antigo: *servers diverged… rewinding* → ele é descartado de vez.

<div class="warn">

Esse é o **RPO** da replicação assíncrona. A síncrona o teria salvado — **bloqueando** o `INSERT`.

</div>

<p class="small">ids 1, 2, <b>34</b>: sequences registram valores em lotes de 32; nunca espere <code>serial</code> sem lacunas.</p>

---

## Por que não um script de failover?

<div class="q">

O primário para de responder ao health check. Ele está morto?

</div>

- Ou lento? Ou isolado do monitor, mas não dos clientes?
- Promover uma réplica nesse caso → **dois primários**: split brain.
- **Patroni**: só quem detém a **leader key** no etcd (Raft, com TTL) roda como primário; um primário isolado se rebaixa.
- Gerenciados: RDS Multi-AZ, Aurora e Cloud SQL fazem o mesmo por você.

---

## Pontos-chave

1. A replicação copia o **WAL**: as réplicas são cópias idênticas, somente leitura.
2. Ela escala as **leituras** e dá **disponibilidade**; as escritas ainda vão para um primário.
3. **Assíncrona**: rápida, mas lê dados desatualizados e perde escritas num crash (RPO > 0).
4. **Síncrona** (`ANY 1`): RPO = 0, pago com latência e escritas bloqueadas.
5. Roteie por papel na **connection string**; ela sobrevive a um failover.
6. Failover = promover, reapontar, redirecionar, rebobinar — e decidir *quando* exige **consenso**.
