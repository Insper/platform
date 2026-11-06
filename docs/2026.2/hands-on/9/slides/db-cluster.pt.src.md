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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 9</div>

# Hands-on 9 — Cluster de banco de dados

**Um primário, duas réplicas, streaming replication — e cada trade-off que dá para provocar em um notebook**

<!--
Roteiro: (1) por que um cluster e o que ele não resolve; (2) o WAL e a streaming replication;
(3) assíncrona × síncrona, CAP; (4) arquitetura e failover, à mão × automatizado; (5) Docker Compose:
arquivos, subir, verificar; (6) Replicação: experimentos 1–6; (7) Failover: planejado, escrita perdida,
consenso, conectando a plataforma.
-->

---

## Um único container `db`

<div class="q">

O gateway roda 3 réplicas atrás do Nginx, o Redis faz cache das leituras. O container `db` para. **O que ainda funciona?**

</div>

- As escritas param e também toda leitura que não acerta o cache.
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

## Quando o `COMMIT ok` volta?

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Assíncrona</div>
<div class="box">INSERT</div><div class="arrow">→</div>
<div class="box accent">WAL no disco do primário</div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div><div class="arrow">⋯</div>
<div class="box muted">a réplica recebe o WAL<small>um crash antes disso perde o commit</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Síncrona</div>
<div class="box">INSERT</div><div class="arrow">→</div>
<div class="box accent">WAL no disco do primário</div><div class="arrow">→</div>
<div class="box orange">uma réplica confirma<small>+1 ida e volta; espera se ela cair</small></div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div>
</div>

- Assíncrona: o cliente ouve "ok" **antes** de existir uma cópia → **RPO > 0**.
- Síncrona: o cliente ouve "ok" **depois** de existir uma cópia → **RPO = 0**, pago com latência e commits bloqueados.

<!--
O diagrama de sequência da página "Assíncrona ou síncrona?" mostra os mesmos dois caminhos passo a passo.
-->

---

## Arquitetura

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .55; display: flex; flex-direction: column; justify-content: center">serviço<small>account, order…</small></div>
<div class="arrow" style="align-self: center">escritas + leituras →</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">pg-primary<small>:5432 · leitura e escrita</small></div>
<div class="arrow" style="align-self: center">stream do WAL →</div>
<div class="group">
<div class="caption">hot standbys · leituras</div>
<div class="box green">pg-replica1<small>:5433 · somente leitura</small></div>
<div class="box green">pg-replica2<small>:5434 · somente leitura</small></div>
</div>
</div>

- Os três rodam `postgres:17`; um entrypoint escolhe o papel: vazio + `PRIMARY_HOST` → clona o primário com `pg_basebackup`.
- A **aplicação** decide para onde vai cada consulta: aqui, na **connection string** (`target_session_attrs` / `targetServerType`).

<p class="small">Passos: <b>1</b> Docker Compose → <b>2</b> Replicação (experimentos) → <b>3</b> Failover.</p>

---

## Failover: à mão × automatizado

| Passo | À mão (este hands-on) | Automatizado |
|---|---|---|
| detectar a falha | `docker compose ps` | health checks, heartbeats |
| escolher e promover uma réplica | `SELECT pg_promote();` | eleição de líder |
| reapontar as outras réplicas | `ALTER SYSTEM SET primary_conninfo` | a ferramenta as reconfigura |
| redirecionar os clientes | connection string com vários hosts | IP virtual, DNS, proxy (HAProxy, PgBouncer) |
| trazer o primário antigo de volta | `pg_rewind` | a ferramenta faz o rewind dele |

<div class="warn">

**Split brain**: um primário que só *parece* morto continua aceitando escritas → dois primários. A automação precisa de **consenso**.

</div>

---

<!-- _class: tight -->

## 1 · O projeto compose

`pgcluster/`: `compose.yaml` + `scripts/` (`node-entrypoint.sh`, `init-primary.sh`, `rejoin-as-replica.sh`)

<div class="cols">
<div>

- 3 × `postgres:17`, **um volume cada**, compartilhando âncoras YAML
- `cluster_name`: qual nó respondeu
- `PRIMARY_HOST` definido → o nó é uma réplica
- as réplicas **não têm `depends_on`**: o entrypoint espera
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

<p class="small"><code>init-primary.sh</code>: role <code>replicator</code>, <code>wal_keep_size</code>, <code>wal_log_hints</code>, regra no <code>pg_hba</code> — copiados para cada réplica. Salve os scripts com fim de linha <b>LF</b>.</p>

---

<!-- _class: tight -->

## 1 · Subir e verificar

```bash
docker compose up -d --wait     # returns when all three nodes are healthy
docker compose exec pg-primary psql -U store \
  -c "SELECT application_name, state, sync_state FROM pg_stat_replication;"
```

```
 application_name | state     | sync_state
------------------+-----------+------------
 pg-replica1      | streaming | async
 pg-replica2      | streaming | async
```

- `docker compose logs pg-replica1`: *cloning pg-primary … entering standby mode … started streaming WAL*.
- Em uma réplica: `pg_is_in_recovery()` → `t`, `pg_stat_wal_receiver` → streaming a partir do `pg-primary`.

---

## 1 · Solução de problemas

| Sintoma | Causa e correção |
|---|---|
| `$'\r': command not found` | scripts salvos com CRLF: salve como LF e recrie o cluster |
| réplica em loop com `no pg_hba.conf entry for replication connection` | primário criado antes de o `init-primary.sh` existir: recrie |
| `port is already allocated` na 5432 | o `db` de um hands-on anterior está no ar: pare-o ou mude as portas |
| réplica parada em `waiting for pg-primary...` | o primário não está no ar: `docker compose logs pg-primary` |

```bash
docker compose down -v && docker compose up -d --wait    # start over: one primary, two replicas
```

---

## 2 · Experimentos 1–3: cópias, somente leitura, lag

- `CREATE TABLE` + `INSERT` no primário → as linhas aparecem nas duas réplicas.
- `INSERT` em uma réplica → `cannot execute INSERT in a read-only transaction`.
- `pg_wal_replay_pause()` na `pg-replica1`, `INSERT` no primário:
  - a `pg-replica1` conta **2**, a `pg-replica2` conta **3**
  - `pg_stat_replication` mostra os bytes de atraso

<div class="warn">

**Read-your-writes**: "eu criei o pedido, mas ele não está na minha lista".

</div>

---

## 2 · Experimento 4: roteamento por papel

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

## 2 · Experimento 5: commits síncronos

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

## 2 · Quanto o primário espera

| `synchronous_commit` | O commit retorna quando a réplica síncrona… | Garante |
|---|---|---|
| `remote_write` | recebeu o WAL (em memória) | sobrevive a um crash do primário |
| `on` (padrão) | gravou o WAL em disco | sobrevive a um crash dos dois |
| `remote_apply` | **reexecutou** o WAL | uma leitura naquela réplica vê o commit |

- `ANY 1` → as duas réplicas mostram `sync_state = quorum`; uma pode estar fora.
- De volta à assíncrona antes da página de failover: `ALTER SYSTEM RESET synchronous_standby_names;` + `pg_reload_conf()`.

---

## 2 · Experimento 6: sob carga (opcional)

```bash
docker compose run --rm --entrypoint pgbench client -h pg-primary -i -s 10
docker compose run --rm --entrypoint pgbench client -h pg-primary -c 8 -T 30 -P 5
docker compose run --rm --entrypoint pgbench client -S -n -c 8 -T 15 \
  "host=pg-replica1,pg-replica2 load_balance_hosts=random"
```

- Durante as escritas, acompanhe o `replay_lag` em `pg_stat_replication`: o lag cresce sob carga.
- A rodada somente leitura (`-S`) se espalha pelas réplicas: as **leituras escalam** com elas.
- Repita com `ANY 1`: a queda de `tps` nas escritas é o **preço do RPO = 0**.

---

<!-- _class: tight -->

## 3 · Failover planejado

| Passo | Comando |
|---|---|
| primário falha | `docker compose stop pg-primary` |
| promover | `SELECT pg_promote();` na `pg-replica1` → **timeline 2** |
| clientes | mesma connection string, `read-write` → `pg-replica1` |
| outra réplica | `ALTER SYSTEM SET primary_conninfo = 'host=pg-replica1 ...'` + reload |
| primário antigo | `rejoin-as-replica.sh` → `pg_rewind` + `standby.signal` |

- Antes do rejoin, o `pg-primary` precisa estar **parado**: dois servidores no mesmo diretório de dados o corrompem.
- Depois de uma parada limpa: *no rewind required* — o primário antigo não escreveu nada que falte ao novo.

<p class="small">Papéis trocados, nomes obsoletos: clusters reais chamam os nós de <code>pg-1</code>, <code>pg-2</code>… e perguntam <code>pg_is_in_recovery()</code>.</p>

---

## 3 · Failover não planejado: a escrita perdida

- Pare as duas réplicas, `INSERT 'lost-write'` → `INSERT 0 1` e então **mate** o primário.
- Suba as réplicas, promova a `pg-replica1`: o `lost-write` **sumiu**.
- `pg_rewind` no primário antigo: *servers diverged… rewinding* → ele é descartado de vez.

<div class="warn">

Esse é o **RPO** da replicação assíncrona. A síncrona o teria salvado — **bloqueando** o `INSERT`.

</div>

<p class="small">ids 1, 2, <b>34</b>: sequences registram valores em lotes de 32; nunca espere <code>serial</code> sem lacunas.</p>

---

## A bifurcação: para onde foi o `lost-write`

<div class="flow" style="align-items: stretch">
<div class="box" style="display: flex; flex-direction: column; justify-content: center">keyboard, mouse<small>timeline 1, em todos os nós</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">depois da bifurcação</div>
<div class="box red">lost-write<small>só no pg-primary morto, timeline 1</small></div>
<div class="box green">after-failover · id 34<small>pg-replica1 promovida, timeline 2</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">pg_rewind<small>corta o pg-primary de volta à bifurcação; ele segue a timeline 2</small></div>
</div>

- O cliente ouviu `INSERT 0 1` para o `lost-write`: o pedido existiu e depois sumiu.
- Uma parada planejada não tem o ramo vermelho: *no rewind required*.

<!--
A página desenha a mesma bifurcação num diagrama passo a passo em "Failover não planejado: uma escrita perdida".
-->

---

## 3 · Por que não um script de failover?

<div class="q">

O primário para de responder ao health check. Ele está morto?

</div>

- Ou lento? Ou isolado do monitor, mas não dos clientes?
- Promover uma réplica nesse caso → **dois primários**: split brain.
- **Patroni**: só quem detém a **leader key** no etcd (Raft, com TTL) roda como primário; um primário isolado se rebaixa.
- Gerenciados: RDS Multi-AZ, Aurora e Cloud SQL fazem o mesmo por você.

---

## 3 · Conectando a plataforma

```yaml
  account:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
      SPRING_DATASOURCE_USERNAME: store
      SPRING_DATASOURCE_PASSWORD: devpass
```

- Depois de um failover, o HikariCP descarta as conexões quebradas e o driver encontra o **novo** primário.
- Leituras nas réplicas: um segundo `DataSource` (`preferSecondary`) + `AbstractRoutingDataSource` para `readOnly` — cuidado com as leituras desatualizadas.

<p class="small">Limpeza: <code>docker compose down -v</code> — sem o <code>-v</code>, o cluster volta com os papéis em que terminou.</p>

---

## Sem Docker: o simulador

<div class="flow">
<div class="box accent">Replicação 1–4<small>2 linhas na réplica pausada, 3 na outra, 184 bytes atrás</small></div>
<div class="box orange">Replicação 5 (sync)<small>FIRST 1 trava, ANY 1 retorna</small></div>
<div class="box green">Failover planejado<small>promove, segue, no rewind required</small></div>
<div class="box red">Escrita perdida<small>id 34, lost-write descartado</small></div>
</div>

- As páginas trazem o cluster do lab como simulador: mesmos nós, mesmos comandos, mesmas saídas.
- O play roda uma página passo a passo; os botões funcionam a qualquer momento.
- Modo **livre**: inicie o primário antigo sem `pg_rewind` → dois primários, **split brain**.

<!--
O simulador está na visão geral (abrindo no experimento 5), no topo de Replicação e de Failover e na seção da escrita perdida.
-->

---

## Pontos-chave

1. A replicação copia o **WAL**: as réplicas são cópias idênticas, somente leitura.
2. Ela escala as **leituras** e dá **disponibilidade**; as escritas ainda vão para um primário.
3. **Assíncrona**: rápida, mas lê dados desatualizados e perde escritas num crash (RPO > 0).
4. **Síncrona** (`ANY 1`): RPO = 0, pago com latência e escritas bloqueadas.
5. Roteie por papel na **connection string**; ela sobrevive a um failover.
6. Failover = promover, reapontar, redirecionar, rebobinar — e decidir *quando* exige **consenso**.
