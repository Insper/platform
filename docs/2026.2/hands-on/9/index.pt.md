!!! tip "Objetivo principal"

    O objetivo principal deste hands-on é montar um **cluster PostgreSQL** no Docker Compose — um primário e duas réplicas mantidas em sincronia por **streaming replication** — e usá-lo para *ver* os conceitos de um cluster de banco de dados: replicação, escala de leituras, atraso de replicação (lag), commits síncronos, failover e escritas perdidas.

Todos os hands-on até aqui rodaram um único container `db`. Quando ele para, todo serviço que depende dele para também: ele é um **ponto único de falha**. Escalar o gateway para três réplicas (hands-on 7) e adicionar um cache (hands-on 8) tirou carga do banco de dados, mas não removeu esse ponto único. Um **cluster de banco de dados** mantém cópias dos dados em vários servidores, de modo que um deles pode assumir quando outro falha.

## Slides

<div class="slides-embed">
  <iframe src="slides/db-cluster.html" title="Slides: cluster de banco de dados" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/db-cluster.html){:target="_blank"}

## Por que um cluster de banco de dados

| Objetivo | O que o cluster oferece | O que ele **não** oferece |
|---|---|---|
| **Disponibilidade** | outro servidor já tem os dados e pode se tornar o primário | zero downtime: um failover ainda leva segundos |
| **Escala de leituras** | os `SELECT`s se distribuem entre as réplicas | escala de escritas: toda escrita continua indo para **um** primário |
| **Durabilidade** | uma cópia de cada commit em outra máquina | proteção contra um `DELETE` por engano: ele também é replicado (é para isso que servem os backups) |

Escalar as **escritas** exige outra técnica, o **sharding** (dividir os dados entre primários independentes, como fazem o Citus ou o Vitess). Este hands-on trata de **replicação**: cada nó guarda *todos* os dados.

## Como o PostgreSQL replica: o WAL

Antes de alterar uma página de dados, o PostgreSQL grava a alteração no **WAL** (*write-ahead log*), um log em disco que só recebe acréscimos (append-only). Depois de um crash, o servidor reexecuta o WAL para se recuperar. A replicação reaproveita o mesmo log: o primário envia o seu WAL às réplicas, que o reexecutam, byte a byte, e terminam com cópias idênticas.

``` mermaid-sim
sequenceDiagram
    participant App as Serviço
    participant P as Primário
    participant R1 as Réplica 1
    participant R2 as Réplica 2
    App->>P: INSERT INTO orders ...
    P->>P: acrescenta a alteração ao WAL
    P-->>App: COMMIT ok
    P->>R1: envia registros do WAL (stream)
    P->>R2: envia registros do WAL (stream)
    R1->>R1: reexecuta o WAL
    R2->>R2: reexecuta o WAL
    App->>R1: SELECT * FROM orders
    R1-->>App: linhas (até o último registro reexecutado)
```

| | **Replicação física (streaming)** | **Replicação lógica** |
|---|---|---|
| **O que trafega** | bytes do WAL: alterações em páginas de dados | alterações de linhas (`INSERT`/`UPDATE`/`DELETE`) por tabela |
| **Réplica** | uma cópia exata do servidor inteiro, **somente leitura** | um banco de dados independente, que aceita escritas |
| **Granularidade** | tudo (todos os bancos) | tabelas escolhidas (publication / subscription) |
| **Versões** | mesma versão major | podem ser diferentes (usada em upgrades) |
| **Usada para** | alta disponibilidade, réplicas de leitura | migrações, integrações, cópias parciais |

Este hands-on usa **replicação física por streaming**: a base da alta disponibilidade no PostgreSQL e de serviços gerenciados como o Amazon RDS.

## Assíncrona ou síncrona?

A pergunta é *quando* o primário responde `COMMIT ok`:

| | **Assíncrona** (padrão) | **Síncrona** |
|---|---|---|
| **O commit retorna** | assim que o WAL está no disco do primário | só depois que uma réplica confirma que tem o WAL |
| **Latência de escrita** | baixa | + uma ida e volta na rede |
| **Se o primário morre** | os últimos commits podem não ter chegado a nenhuma réplica: **escritas perdidas** (RPO > 0) | nenhuma transação confirmada é perdida (RPO = 0) |
| **Se a réplica morre** | nada muda | os commits **bloqueiam** até uma réplica voltar (ou a configuração mudar) |

Este é o [teorema CAP](../../classes/distributed_systems/cap/index.md) na prática: a replicação síncrona prefere a **consistência** (nenhuma escrita confirmada é perdida) e abre mão da **disponibilidade** das escritas quando a réplica está inacessível; a replicação assíncrona prefere a disponibilidade e aceita que quem lê de uma réplica veja **dados desatualizados** e que um failover perca as últimas escritas.

## Arquitetura

``` mermaid-sim
flowchart LR
    app["serviço\n(account, order...)"]
    subgraph cluster [Cluster PostgreSQL]
        p[("pg-primary\n:5432\nleitura e escrita")]
        r1[("pg-replica1\n:5433\nsomente leitura")]
        r2[("pg-replica2\n:5434\nsomente leitura")]
        p e1@-->|"stream do WAL"| r1
        p e2@-->|"stream do WAL"| r2
    end
    app e0@==>|"escritas + leituras"| p
    app e3@-.->|"leituras"| r1
    app e4@-.->|"leituras"| r2
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
```

- Os três nós rodam a imagem oficial `postgres:17`. Um pequeno entrypoint decide o papel: um nó vazio **com** `PRIMARY_HOST` clona o primário com `pg_basebackup` e sobe como **hot standby** (ele aceita leituras).
- A aplicação decide para onde vai cada consulta. Aqui, o roteamento fica na **connection string**: a libpq e o driver JDBC do PostgreSQL aceitam uma lista de hosts e escolhem o que tem o papel certo (`target_session_attrs` / `targetServerType`).

## Failover

Quando o primário falha, uma réplica precisa ser **promovida** a primário, as outras réplicas precisam segui-la e os clientes precisam encontrá-la. Neste hands-on, você faz cada passo à mão, para ver o que uma ferramenta automática faz por você:

| Passo | À mão (este hands-on) | Automatizado |
|---|---|---|
| detectar a falha | `docker compose ps` | health checks, heartbeats |
| escolher e promover uma réplica | `SELECT pg_promote();` | eleição de líder |
| reapontar as outras réplicas | `ALTER SYSTEM SET primary_conninfo` | a ferramenta as reconfigura |
| redirecionar os clientes | connection string com vários hosts | IP virtual, DNS, proxy (HAProxy, PgBouncer) |
| trazer o primário antigo de volta | `pg_rewind` | a ferramenta faz o rewind dele |

!!! warning "Split brain"

    A falha perigosa não é um primário morto, mas um primário que **parece** morto — isolado pela rede, mas ainda aceitando escritas. Se uma réplica for promovida, o cluster passa a ter **dois primários** e os dados divergem. Por isso, o failover automático precisa de acordo entre vários nós, um algoritmo de [consenso](../../classes/distributed_systems/consensus/index.md): o [Patroni](https://patroni.readthedocs.io){target="_blank"} guarda o lock de líder no etcd (Raft), e os serviços gerenciados (RDS Multi-AZ, Aurora, Cloud SQL) fazem o mesmo internamente.

<div class="grid cards" markdown>

-   :material-file-code:{ .lg .middle } **[Docker Compose](./docker/)**

    ---

    Escreva o `compose.yaml` e os scripts, suba o cluster e verifique que as duas réplicas estão fazendo streaming.

    [Docker Compose](./docker/){ .md-button }

-   :material-database-sync:{ .lg .middle } **[Replicação](./replication/)**

    ---

    Escreva no primário, leia nas réplicas, provoque leituras desatualizadas, roteie por papel e ative os commits síncronos.

    [Replicação](./replication/){ .md-button }

-   :material-swap-horizontal:{ .lg .middle } **[Failover](./failover/)**

    ---

    Pare o primário, promova uma réplica, reaponte o cluster, perca uma escrita de propósito e traga o primário antigo de volta.

    [Failover](./failover/){ .md-button }

</div>
