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
(3) assíncrona × síncrona, CAP; (4) arquitetura e failover, à mão × automatizado, split brain;
(5) Docker Compose: arquivos, papel de cada nó, subir, verificar; (6) Replicação: experimentos 1–6;
(7) Failover: planejado, escrita perdida, consenso, conectando a plataforma; (8) o simulador.
-->

---

## Um único container `db`

<div class="q">

O gateway roda 3 réplicas atrás do Nginx, o Redis faz cache das leituras. O container `db` para. **O que ainda funciona?**

</div>

<div class="flow" style="font-size: 1.25em; align-items: stretch">
<div class="box muted" style="flex: .6; display: flex; flex-direction: column; justify-content: center">clientes</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box" style="flex: .7; display: flex; flex-direction: column; justify-content: center">Nginx</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">gateway × 3</div>
<div class="box green">gateway</div>
<div class="box green">gateway</div>
<div class="box green">gateway</div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box green" style="display: flex; flex-direction: column; justify-content: center">account, order…<small>escalam à vontade</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">dados</div>
<div class="box accent">Redis<small>só o que está em cache</small></div>
<div class="box red">db parado<small>ponto único de falha</small></div>
</div>
</div>

- As escritas param e também toda leitura que não acerta o cache.
- Um **cluster** mantém cópias dos dados em vários servidores, para que um possa assumir.

---

## O que um cluster oferece — e o que não oferece

| Objetivo | ✅ Oferece | ❌ **Não** oferece |
|---|---|---|
| **Disponibilidade** | um servidor com os dados, pronto para ser promovido | zero downtime: o failover leva segundos |
| **Escala de leituras** | `SELECT`s distribuídos entre as réplicas | escala de **escritas**: um primário recebe todas |
| **Durabilidade** | cada commit em outra máquina | proteção contra um `DELETE` errado (também replicado: para isso há backups) |

<div class="flow" style="font-size: 1.1em">
<div class="box accent">Replicação · este hands-on<small>cada nó guarda <b>todos</b> os dados; um primário escreve</small></div>
<div class="arrow">≠</div>
<div class="box orange">Sharding · Citus, Vitess<small>os dados divididos entre primários independentes: escala as escritas</small></div>
</div>

---

## O WAL (*write-ahead log*)

<div class="flow" style="font-size: 1.2em; align-items: stretch">
<div class="box" style="flex: .6; display: flex; flex-direction: column; justify-content: center">INSERT</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">WAL do primário<small>append-only, gravado antes da página</small></div>
<div class="arrow" style="align-self: center">stream →</div>
<div class="group">
<div class="caption">cada réplica reexecuta o WAL</div>
<div class="box green">pg-replica1<small>cópia byte a byte</small></div>
<div class="box green">pg-replica2<small>cópia byte a byte</small></div>
</div>
</div>

- Antes de alterar uma página, o PostgreSQL acrescenta a alteração ao WAL; depois de um crash, reexecuta o WAL para se recuperar.
- A **streaming replication** reaproveita o mesmo log: cópias idênticas, por isso a réplica é **somente leitura** e roda a **mesma versão major**.

<div class="ok">

A replicação **física** copia páginas (alta disponibilidade, réplicas de leitura); a **lógica** copia alterações de linhas por tabela (migrações, upgrades, integrações).

</div>

---

## Assíncrona ou síncrona?

Quando o primário responde `COMMIT ok`?

| | **Assíncrona** (padrão) | **Síncrona** |
|---|---|---|
| Commit retorna | WAL no disco do primário | uma réplica confirmou o WAL |
| Latência de escrita | baixa | + 1 ida e volta na rede |
| Primário morre | últimos commits podem se **perder** | nada confirmado se perde |
| Réplica morre | nada muda | commits **bloqueiam** |

<p class="small"><b>RPO</b> (<i>recovery point objective</i>, objetivo de ponto de recuperação): quanto dado confirmado se pode perder num crash. Assíncrona: RPO &gt; 0; síncrona: RPO = 0.</p>

<div class="warn">

Teorema CAP (consistência, disponibilidade, tolerância a partição) na prática: a síncrona prefere **consistência**, a assíncrona prefere **disponibilidade**.

</div>

---

## Quando o `COMMIT ok` volta?

<div style="font-size: 1.2em">
<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">Assíncrona</div>
<div class="box">INSERT</div><div class="arrow">→</div>
<div class="box accent">WAL no disco do primário</div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div><div class="arrow">⋯</div>
<div class="box red">a réplica recebe o WAL<small>um crash antes disso perde o commit</small></div>
</div>
<div class="flow" style="margin-top: .6em">
<div class="arrow" style="flex: .45; text-align: left">Síncrona</div>
<div class="box">INSERT</div><div class="arrow">→</div>
<div class="box accent">WAL no disco do primário</div><div class="arrow">→</div>
<div class="box orange">uma réplica confirma<small>+1 ida e volta; espera se ela cair</small></div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div>
</div>
</div>

- Assíncrona: o cliente ouve "ok" **antes** de existir uma cópia → <span class="chip red">RPO &gt; 0</span>
- Síncrona: o cliente ouve "ok" **depois** de existir uma cópia → <span class="chip green">RPO = 0</span>, pago com latência e commits bloqueados.

<!--
O diagrama de sequência da página "Assíncrona ou síncrona?" mostra os mesmos dois caminhos passo a passo.
-->

---

## Arquitetura

<div class="flow" style="font-size: 1.2em; align-items: stretch">
<div class="box muted" style="flex: .6; display: flex; flex-direction: column; justify-content: center">serviço<small>account, order…</small></div>
<div style="display: flex; flex-direction: column; justify-content: space-around">
<div class="arrow">escritas + leituras ⇒</div>
<div class="arrow" style="font-weight: 400">leituras (opcional) ⇢ réplicas</div>
</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">pg-primary<small>:5432 · leitura e escrita</small></div>
<div class="arrow" style="align-self: center">stream do WAL →</div>
<div class="group">
<div class="caption">hot standbys · leituras</div>
<div class="box green">pg-replica1<small>:5433 · somente leitura</small></div>
<div class="box green">pg-replica2<small>:5434 · somente leitura</small></div>
</div>
</div>

- Os três rodam `postgres:17`; um entrypoint escolhe o papel de cada nó.
- A **aplicação** decide para onde vai cada consulta: aqui, na **connection string** (`target_session_attrs` / `targetServerType`).

<div class="flow">
<div class="box accent">1 · Docker Compose<small>arquivos, subir, verificar</small></div><div class="arrow">→</div>
<div class="box orange">2 · Replicação<small>experimentos 1–6</small></div><div class="arrow">→</div>
<div class="box red">3 · Failover<small>planejado, escrita perdida, consenso</small></div>
</div>

---

## Failover: à mão × automatizado

| Passo | À mão (este hands-on) | Automatizado |
|---|---|---|
| detectar a falha | `docker compose ps` | health checks, heartbeats |
| escolher e promover uma réplica | `SELECT pg_promote();` | eleição de líder |
| reapontar as outras réplicas | `ALTER SYSTEM SET primary_conninfo` | a ferramenta as reconfigura |
| redirecionar os clientes | connection string com vários hosts | IP virtual, DNS, proxy (HAProxy, PgBouncer) |
| trazer o primário antigo de volta | `pg_rewind` | a ferramenta faz o rewind dele |

<p class="small">O passo difícil é o primeiro: decidir que o primário está <b>mesmo</b> morto.</p>

---

## Split brain: o primário que só *parece* morto

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="group">
<div class="caption">de um lado da partição</div>
<div class="box muted">Cliente A<small>INSERT 'x'</small></div>
<div class="arrow">↓</div>
<div class="box accent">pg-primary<small>vivo, ainda aceita escritas</small></div>
</div>
<div class="box red" style="flex: .45; display: flex; flex-direction: column; justify-content: center">✂ rede<small>cai entre eles</small></div>
<div class="group">
<div class="caption">do outro lado</div>
<div class="box muted">Monitor<small>health check sem resposta → pg_promote()</small></div>
<div class="arrow">↓</div>
<div class="box accent">pg-replica1<small>promovida</small></div>
<div class="arrow">↑</div>
<div class="box muted">Cliente B<small>INSERT 'y'</small></div>
</div>
</div>

<div class="warn">

**Dois primários**: `'x'` só em um, `'y'` só no outro, os dados divergem. Por isso a automação precisa de **consenso**.

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

<p class="small"><code>init-primary.sh</code>: role <code>replicator</code>, <code>wal_keep_size</code>, <code>wal_log_hints</code>, regra no <code>pg_hba</code> — copiados para cada réplica. Salve os scripts com fim de linha <b>LF</b> (não CRLF, o do Windows).</p>

---

## 1 · Como cada nó escolhe o papel

<div style="font-size: 1.15em">
<div class="flow">
<div class="box">o container sobe</div><div class="arrow">→</div>
<div class="box orange">diretório de dados já inicializado?</div><div class="arrow">sim →</div>
<div class="box muted">inicia o PostgreSQL<small>primário ou standby, como era</small></div>
</div>
<div class="flow" style="margin-top: .5em">
<div class="arrow" style="flex: .55; text-align: right">não →</div>
<div class="box orange">PRIMARY_HOST definido?</div><div class="arrow">não →</div>
<div class="box">initdb + init-primary.sh</div><div class="arrow">→</div>
<div class="box accent">novo primário</div>
</div>
<div class="flow" style="margin-top: .5em">
<div class="arrow" style="flex: .55; text-align: right">sim →</div>
<div class="box">espera pelo primário</div><div class="arrow">→</div>
<div class="box">pg_basebackup -X stream -R<small>cópia do primário</small></div><div class="arrow">→</div>
<div class="box green">hot standby<small>somente leitura, recebendo o WAL</small></div>
</div>
</div>

- Um nó que já tem dados volta **no papel em que terminou**: depois de um failover, o `pg-primary` pode ser réplica.
- Por isso `docker compose down -v` (apaga os volumes) é o jeito de recomeçar com os papéis originais.

<!--
O mesmo fluxo está passo a passo na página Docker Compose, em "Como funciona".
-->

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

<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .5; text-align: left">logs pg-replica1</div>
<div class="box muted">waiting for pg-primary</div><div class="arrow">→</div>
<div class="box orange">cloning pg-primary<small>pg_basebackup</small></div><div class="arrow">→</div>
<div class="box">entering standby mode</div><div class="arrow">→</div>
<div class="box green">started streaming WAL</div>
</div>

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

<div class="matrix" style="--n: 3; font-size: 1.2em">
<div></div><div class="head">keyboard</div><div class="head">mouse</div><div class="head">monitor · INSERT no primário</div>
<div class="row">pg-primary</div><div class="box green">✓</div><div class="box green">✓</div><div class="box green">✓</div>
<div class="row">pg-replica1 · replay pausado</div><div class="box green">✓</div><div class="box green">✓</div><div class="box red" style="flex-direction: column">falta<small>184 bytes atrás</small></div>
<div class="row">pg-replica2</div><div class="box green">✓</div><div class="box green">✓</div><div class="box green">✓</div>
</div>

- 1 · `CREATE TABLE` + `INSERT` no primário → as linhas aparecem nas réplicas, vindas pelo WAL.
- 2 · `INSERT` em uma réplica → `cannot execute INSERT in a read-only transaction`.
- 3 · `pg_wal_replay_pause()` na `pg-replica1`: ela conta **2** linhas, a `pg-replica2` conta **3**; `pg_stat_replication` mostra os bytes de atraso.

---

## 2 · Read-your-writes: a leitura desatualizada

<div class="flow" style="font-size: 1.15em">
<div class="box muted">usuário cria um pedido</div><div class="arrow">→</div>
<div class="box accent">INSERT no pg-primary</div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div><div class="arrow">→</div>
<div class="box muted">"lista meus pedidos"</div><div class="arrow">→</div>
<div class="box orange">SELECT na pg-replica1<small>atrasada</small></div><div class="arrow">→</div>
<div class="box red">"cadê meu pedido?"</div>
</div>

- O WAL chega à réplica — tarde demais para aquela leitura.
- O lag cresce com carga pesada, consultas longas na réplica ou uma rede lenta.

<div class="ok">

Correções: ler do **primário** logo depois de uma escrita (para aquele usuário, por alguns segundos) ou `remote_apply` (experimento 5) nas consultas que não podem ver dados desatualizados.

</div>

---

<!-- _class: tight -->

## 2 · Experimento 4: roteamento por papel

<div class="flow" style="font-size: 1.15em">
<div class="box accent">driver<small>target_session_attrs=read-write</small></div><div class="arrow">→</div>
<div class="box">pg-primary<small>aceita escritas?</small></div><div class="arrow">não ou fora →</div>
<div class="box">pg-replica1<small>aceita escritas?</small></div><div class="arrow">não ou fora →</div>
<div class="box">pg-replica2<small>aceita escritas?</small></div><div class="arrow">não →</div>
<div class="box red">erro<small>nenhum com o papel</small></div>
</div>
<div class="flow"><div class="box green">o primeiro que responde "sim" fica com a conexão</div></div>

```bash
host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write
host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=standby load_balance_hosts=random
```

```text
jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
```

- A lista nomeia **candidatos**, não *o* primário — ela sobrevive a um failover.

---

<!-- _class: tight -->

## 2 · Experimento 5: commits síncronos

<div style="font-size: 1.15em">
<div class="flow">
<div class="arrow" style="flex: .7; text-align: left">FIRST 1 ("pg-replica1")</div>
<div class="box">INSERT headset</div><div class="arrow">→</div>
<div class="box muted">pg-replica1 parada<small>a única que vale</small></div><div class="arrow">→</div>
<div class="box red">trava<small>Ctrl+C cancela só a espera</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .7; text-align: left">ANY 1 (r1, r2) · quórum</div>
<div class="box">INSERT webcam</div><div class="arrow">→</div>
<div class="box green">pg-replica2 confirma</div><div class="arrow">→</div>
<div class="box green">COMMIT ok<small>na hora</small></div>
</div>
</div>

```
WARNING:  canceling wait for synchronous replication due to user request
DETAIL:  The transaction has already committed locally, but might not
         have been replicated to the standby.
```

<div class="q">

A linha `headset` está confirmada? *(Sim — no primário; só a espera foi cancelada.)*

</div>

---

<!-- _class: tight -->

## 2 · Quanto o primário espera

<div class="flow" style="font-size: 1.15em">
<div class="box">COMMIT</div><div class="arrow">→</div>
<div class="box orange">recebido em memória<small>remote_write</small></div><div class="arrow">→</div>
<div class="box accent">gravado em disco<small>on (padrão)</small></div><div class="arrow">→</div>
<div class="box green">reexecutado<small>remote_apply</small></div><div class="arrow">→</div>
<div class="box">COMMIT ok</div>
</div>

| `synchronous_commit` | O commit retorna quando a réplica síncrona… | Garante |
|---|---|---|
| `remote_write` | recebeu o WAL (em memória) | sobrevive a um crash do primário |
| `on` (padrão) | gravou o WAL em disco | sobrevive a um crash dos dois |
| `remote_apply` | **reexecutou** o WAL | uma leitura naquela réplica vê o commit |

- `ANY 1` → as duas réplicas mostram `sync_state = quorum`; uma pode estar fora.
- De volta à assíncrona antes da página de failover: `ALTER SYSTEM RESET synchronous_standby_names;` + `pg_reload_conf()`.

---

<!-- _class: tight -->

## 2 · Experimento 6: sob carga (opcional)

```bash
docker compose run --rm --entrypoint pgbench client -h pg-primary -i -s 10
docker compose run --rm --entrypoint pgbench client -h pg-primary -c 8 -T 30 -P 5
docker compose run --rm --entrypoint pgbench client -S -n -c 8 -T 15 \
  "host=pg-replica1,pg-replica2 load_balance_hosts=random"
```

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="box muted" style="flex: .7; display: flex; flex-direction: column; justify-content: center">pgbench -c 8<small>escritas</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">pg-primary<small>recebe todas as escritas</small></div>
<div class="arrow" style="align-self: center">WAL · replay_lag cresce →</div>
<div class="group">
<div class="caption">pgbench -S · leituras</div>
<div class="box green">pg-replica1<small>parte das leituras</small></div>
<div class="box green">pg-replica2<small>parte das leituras</small></div>
</div>
</div>

- As **leituras escalam** com as réplicas; as escritas, não.
- Repita com `ANY 1`: a queda de `tps` (transações por segundo) nas escritas é o **preço do RPO = 0**.

---

<!-- _class: tight -->

## 3 · Failover planejado

<div class="matrix" style="--n: 3; font-size: 1.3em">
<div></div><div class="head">antes</div><div class="head">o primário cai · promover</div><div class="head">depois</div>
<div class="row">pg-primary</div><div class="box accent">primário</div><div class="box red" style="flex-direction: column">fora do ar<small>docker compose stop</small></div><div class="box green" style="flex-direction: column">réplica da pg-replica1<small>rejoin-as-replica.sh: pg_rewind + standby.signal</small></div>
<div class="row">pg-replica1</div><div class="box green">réplica</div><div class="box accent" style="flex-direction: column">primário · timeline 2<small>SELECT pg_promote();</small></div><div class="box accent">primário</div>
<div class="row">pg-replica2</div><div class="box green">segue pg-primary</div><div class="box muted">sem primário para seguir</div><div class="box green" style="flex-direction: column">segue pg-replica1<small>primary_conninfo + reload</small></div>
<div class="row">clientes</div><div class="box muted">read-write → pg-primary</div><div class="box muted">read-write: nenhum</div><div class="box muted">mesma string → pg-replica1</div>
</div>

- Antes do rejoin, o `pg-primary` precisa estar **parado**: dois servidores no mesmo diretório de dados o corrompem.
- Depois de uma parada limpa: *no rewind required* — o primário antigo não escreveu nada que falte ao novo.

<p class="small">Papéis trocados, nomes obsoletos: clusters reais chamam os nós de <code>pg-1</code>, <code>pg-2</code>… e perguntam <code>pg_is_in_recovery()</code>.</p>

---

## 3 · Failover não planejado: a escrita perdida

<div class="flow" style="font-size: 1.1em">
<div class="box muted">1 · para as duas réplicas</div><div class="arrow">→</div>
<div class="box orange">2 · INSERT 'lost-write'<small>INSERT 0 1</small></div><div class="arrow">→</div>
<div class="box red">3 · mata o primário</div><div class="arrow">→</div>
<div class="box green">4 · sobe as réplicas, promove a pg-replica1</div><div class="arrow">→</div>
<div class="box red">5 · lost-write sumiu</div>
</div>

- `pg_rewind` no primário antigo: *servers diverged… rewinding* → o `lost-write` é descartado de vez.

<div class="warn">

Esse é o **RPO** da replicação assíncrona. A síncrona o teria salvado — **bloqueando** o `INSERT`: o cliente nunca ouviria que o pedido existia.

</div>

<p class="small">ids 1, 2, <b>34</b>: sequences registram valores em lotes de 32; nunca espere <code>serial</code> sem lacunas.</p>

---

## A bifurcação: para onde foi o `lost-write`

<div class="flow" style="font-size: 1.2em; align-items: stretch">
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

<!-- _class: tight -->

## 3 · Por que não um script de failover?

<div class="q">

O primário para de responder ao health check. Ele está morto — ou lento? Ou isolado do monitor, mas não dos clientes?

</div>

**Patroni**: só quem detém a **leader key** no etcd (Raft) roda como primário. A chave tem um tempo de vida (TTL, *time to live*):

<div style="font-size: 1.25em">
<div class="flow">
<div class="box accent">pg-1 · primário</div><div class="arrow">renova a chave (TTL 30 s) →</div>
<div class="box">etcd · Raft</div><div class="arrow">→</div>
<div class="box green">"ok, você é o líder"</div>
</div>
<div class="flow">
<div class="box red">a rede pg-1 ↔ etcd cai</div><div class="arrow">→</div>
<div class="box orange">pg-1 não renova<small>rebaixa a si mesmo</small></div><div class="arrow">→</div>
<div class="box muted">a chave expira</div><div class="arrow">→</div>
<div class="box green">pg-2 pega a chave<small>e só então promove</small></div>
</div>
</div>

- Nunca dois primários: o isolado sai **antes** de outro entrar. Gerenciados (RDS Multi-AZ, Aurora, Cloud SQL) fazem o mesmo por você.

---

## 3 · Conectando a plataforma

```yaml
  account:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
      SPRING_DATASOURCE_USERNAME: store
      SPRING_DATASOURCE_PASSWORD: devpass
```

<div class="flow" style="font-size: 1.15em">
<div class="arrow" style="flex: .55; text-align: left">depois do failover</div>
<div class="box">account<small>HikariCP descarta as conexões quebradas</small></div><div class="arrow">→</div>
<div class="box accent">driver JDBC<small>targetServerType=primary</small></div><div class="arrow">→</div>
<div class="box muted">pg-primary<small>fora do ar</small></div><div class="arrow">→</div>
<div class="box green">pg-replica1<small>o novo primário</small></div>
</div>

- Leituras nas réplicas: um segundo `DataSource` (`preferSecondary`) + `AbstractRoutingDataSource` para `readOnly` — cuidado com as leituras desatualizadas.

<p class="small">Limpeza: <code>docker compose down -v</code> — sem o <code>-v</code>, o cluster volta com os papéis em que terminou.</p>

---

## Simulador: replicação e commits síncronos

<div class="q">

O cluster do lab no navegador: mesmos nós, mesmos comandos, mesmas saídas. Começa onde o lab começa: `orders` com keyboard e mouse, as duas réplicas recebendo o WAL.

</div>

<div style="font-size: 1.15em">
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Replicação 1–4</div>
<div class="box accent">pg-primary<small>3 linhas</small></div>
<div class="box orange">pg-replica1 · replay pausado<small>2 linhas, 184 bytes atrás</small></div>
<div class="box green">pg-replica2<small>3 linhas</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Replicação 5</div>
<div class="box red">FIRST 1 · pg-replica1 parada<small>INSERT headset trava: 1 commit travado</small></div>
<div class="box green">ANY 1<small>webcam retorna na hora; as duas viram quorum</small></div>
</div>
</div>

- A réplica recusa o `INSERT`; `read-write` acha o pg-primary e `standby` sorteia uma réplica.
- `synchronous_commit = remote_apply` + replay pausado: o commit espera a réplica **reexecutar**.

<p class="small">Visão geral (abre no experimento 5) e topo de Replicação · simulador <code>pg-cluster</code>.</p>

---

## Simulador: failover e escrita perdida

<div class="flow" style="font-size: 1.15em">
<div class="arrow" style="flex: .5; text-align: left">Failover planejado</div>
<div class="box muted">read-write: ninguém<small>primário parado</small></div><div class="arrow">→</div>
<div class="box accent">pg_promote()<small>timeline 2</small></div><div class="arrow">→</div>
<div class="box green">mesma string → pg-replica1</div><div class="arrow">→</div>
<div class="box green">no rewind required<small>1 primário, 0 perdidas</small></div>
</div>
<div class="flow" style="font-size: 1.15em">
<div class="arrow" style="flex: .5; text-align: left">Escrita perdida</div>
<div class="box orange">INSERT 0 1<small>lost-write</small></div><div class="arrow">→</div>
<div class="box red">o primário morre</div><div class="arrow">→</div>
<div class="box green">ids 1, 2, 34<small>pg-replica1 promovida</small></div><div class="arrow">→</div>
<div class="box red">pg_rewind descarta<small>1 escrita perdida</small></div>
</div>

<div class="flow" style="font-size: 1.15em">
<div class="arrow" style="flex: .5; text-align: left">modo livre</div>
<div class="box red">pg-primary · primário<small>timeline 1, sem pg_rewind</small></div>
<div class="box red">pg-replica1 · primário<small>timeline 2</small></div>
<div class="box green">pg-replica2<small>segue a pg-replica1</small></div>
<div class="arrow">→</div>
<div class="box red">primários no ar: 2</div>
</div>

<p class="small">Contadores do simulador: primários no ar, linhas no primário, commits que travaram, escritas perdidas. Topo de Failover e seção da escrita perdida · simulador <code>pg-cluster</code>.</p>

---

## Pontos-chave

1. A replicação copia o **WAL**: as réplicas são cópias idênticas, somente leitura.
2. Ela escala as **leituras** e dá **disponibilidade**; as escritas ainda vão para um primário.
3. **Assíncrona**: rápida, mas lê dados desatualizados e perde escritas num crash (RPO > 0).
4. **Síncrona** (`ANY 1`): RPO = 0, pago com latência e escritas bloqueadas.
5. Roteie por papel na **connection string**; ela sobrevive a um failover.
6. Failover = promover, reapontar, redirecionar, rebobinar — e decidir *quando* exige **consenso**, ou vira split brain.
