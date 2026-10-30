Dez minutos antes da abertura das vendas, o banco do catálogo está a 90% de CPU — quase tudo vindo de `SELECT`s da página do evento. O time adiciona duas **réplicas de leitura** e direciona as leituras para elas. A CPU cai para 30%. Então o canal de suporte se acende: "Eu paguei, o e-mail de confirmação chegou, mas *Meus ingressos* está vazio!" Nada se perdeu. A leitura seguinte do fã simplesmente foi para uma réplica que ainda não tinha recebido a escrita.

A replicação — manter uma cópia dos mesmos dados em várias máquinas — é a ferramenta de escalabilidade e disponibilidade mais usada em bancos de dados, e ela vem exatamente com esse tipo de surpresa. Esta página cobre as três formas de replicar (líder único, multilíder e sem líder), o que o atraso de replicação faz com os usuários e o que acontece quando o líder morre.

---

## Por que replicar { #why-replicate }

| Objetivo | Como a replicação ajuda | Exemplo na BoxOffice |
|---|---|---|
| **Disponibilidade** | se um nó morre, outro tem os dados e assume | o primário do inventário cai às 10:01; um standby é promovido em segundos |
| **Escala de leitura** | as leituras se espalham por várias cópias | as leituras do catálogo vão para 2–5 réplicas |
| **Latência** | uma cópia perto do usuário | uma réplica em outra região para as páginas de eventos |
| **Durabilidade** | a perda de um disco ou de uma máquina não perde dados confirmados | um standby síncrono guarda toda reserva confirmada |

A replicação **não** escala escritas: toda cópia precisa aplicar todas as escritas. Para isso você precisa de [particionamento](../partitioning/index.md).

---

## Replicação com líder único { #single-leader-replication }

Um nó, o **líder** (primário), aceita todas as escritas. Ele registra cada mudança no seu log — o **write-ahead log** (WAL) no PostgreSQL, o binlog no MySQL — e envia o log para os **seguidores** (réplicas, standbys), que o reaplicam na mesma ordem. As leituras podem ir para qualquer nó[^1].

``` diagram-sim
flowchart LR
    app["serviço catalog"] -->|"escritas"| P[("primário")]
    P -->|"fluxo de WAL"| R1[("réplica 1")]
    P -->|"fluxo de WAL"| R2[("réplica 2")]
    app -->|"leituras"| R1
    app -->|"leituras"| R2
    app -->|"leituras que precisam ser atuais"| P
```

Esse é o modelo da streaming replication do PostgreSQL, da replicação do MySQL, do SQL Server Always On, dos replica sets do MongoDB e da maioria dos serviços gerenciados (réplicas de leitura do Amazon RDS, Cloud SQL, Azure Database). É simples de raciocinar porque existe exatamente uma ordem de escritas — a do líder.

### Síncrona, assíncrona, semissíncrona { #synchronous-asynchronous-semi-synchronous }

A decisão-chave é **quando o líder diz ao cliente "confirmado"**:

``` diagram-sim
sequenceDiagram
    participant C as Cliente
    participant P as Primário
    participant S as Standby síncrono
    participant A as Réplica assíncrona
    C->>P: COMMIT da reserva A-12
    P->>P: grava o WAL localmente
    P->>S: envia o WAL
    S-->>P: gravado em disco
    P-->>C: confirmado
    P->>A: envia o WAL (depois)
    Note over A: pode ficar ms … s atrás
```

| Modo | O líder responde "confirmado" depois de… | Durabilidade se o líder for perdido | Latência de escrita | Risco de disponibilidade |
|---|---|---|---|---|
| **Assíncrona** | gravar no próprio disco | as últimas escritas ainda não enviadas são **perdidas** | a menor | nenhum vindo das réplicas |
| **Síncrona** (todas as réplicas) | todas as réplicas confirmarem | nenhuma perda | a maior: a réplica mais lenta decide | qualquer réplica fora do ar bloqueia as escritas |
| **Semissíncrona** / um standby síncrono | uma réplica confirmar, as outras assíncronas | nenhuma perda se esse standby sobreviver | + uma ida e volta na rede | se o standby síncrono morrer, outro precisa assumir o papel |
| **Armazenamento com quorum** (Aurora: 4 de 6 cópias em 3 zonas)[^4] | um quorum de escrita dos nós de armazenamento confirmar | sobrevive à perda de uma zona | + ida e volta até o quorum | tolera nós lentos |

No PostgreSQL, isso são as configurações `synchronous_commit` e `synchronous_standby_names`[^5]; `ANY 1 (s1, s2)` significa "espere qualquer um dos dois standbys" — um quorum que tolera um standby lento. Dentro de uma região, uma ida e volta síncrona custa cerca de um milissegundo; entre continentes custa de dezenas a centenas de milissegundos, e é por isso que réplicas entre regiões são quase sempre assíncronas.

---

## Atraso de replicação e suas anomalias { #lag }

Uma réplica assíncrona fica atrás do líder pelo **atraso de replicação** (*replication lag*): normalmente milissegundos, mas segundos ou minutos quando o líder recebe uma rajada de escritas, uma réplica reaplica uma transação enorme ou a rede está congestionada. O atraso cria três anomalias visíveis para o usuário[^2]:

| Anomalia | O que o usuário vê | Garantia que a evita |
|---|---|---|
| **Ler a própria escrita falha** | paga, abre *Meus ingressos*, não vê nada | consistência **read-your-writes** (ler as próprias escritas, *read-after-write*) |
| **O tempo anda para trás** | atualiza a página: o ingresso aparece; atualiza de novo: sumiu (a segunda leitura caiu numa réplica mais atrasada) | **leituras monotônicas** (*monotonic reads*) |
| **Efeito antes da causa** | vê a resposta "estorno aprovado" antes do pedido de estorno numa conversa | **leituras de prefixo consistente** (*consistent prefix reads*) |

``` diagram-sim
sequenceDiagram
    participant F as Fã
    participant O as serviço order
    participant P as Primário
    participant R as Réplica (atraso de 800 ms)
    F->>O: POST /orders/9001/confirm
    O->>P: UPDATE orders SET status = 'PAID'
    P-->>O: confirmado
    O-->>F: 200 "Pagamento confirmado"
    F->>O: GET /me/tickets
    O->>R: SELECT … WHERE customer_id = 7
    R-->>O: (ainda nenhuma linha)
    O-->>F: "Você não tem ingressos"
```

Qual a chance de isso acontecer? Num modelo ilustrativo — atraso distribuído exponencialmente em torno de uma média, e o próximo clique do fã indo para uma réplica — a resposta depende inteiramente do atraso naquele momento:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

# Illustrative model: replication lag is exponentially distributed with a given
# mean; the user's next read goes to a replica. P(stale) = P(lag > delay).
delay_ms = np.linspace(0, 2000, 400)
cases = [(20, "#54A24B", "mean lag 20 ms (quiet primary)"),
         (200, "#F58518", "mean lag 200 ms (busy primary)"),
         (1000, "#E45756", "mean lag 1 s (on-sale write burst)")]

fig, ax = plt.subplots(figsize=(9, 4.2))
fig.patch.set_alpha(0)
for mean, color, label in cases:
    ax.plot(delay_ms, 100 * np.exp(-delay_ms / mean), color=color, lw=2.5, label=label)
ax.axvline(300, color="#888", ls=":", lw=1.5)
ax.text(320, 50, "user clicks 'My tickets'\n~300 ms after paying", color="#888", fontsize=9, va="top")
ax.set_xlabel("time between the write and the next read (ms)")
ax.set_ylabel("% of reads that miss the user's own write")
ax.set_title("Read-your-writes on an asynchronous replica")
ax.set_ylim(0, 100)
ax.grid(True, alpha=0.25)
ax.set_facecolor("none")
for item in [ax.title, ax.xaxis.label, ax.yaxis.label] + ax.get_xticklabels() + ax.get_yticklabels():
    item.set_color("#888")
for s in ax.spines.values():
    s.set_color("#888")
ax.tick_params(colors="#888")
leg = ax.legend(frameon=False, fontsize=9, loc="upper right")
for t in leg.get_texts():
    t.set_color("#888")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

Num dia tranquilo o bug é invisível; durante a abertura das vendas — justamente quando há mais fãs olhando — a maioria deles esbarra nele. É por isso que bugs de atraso sobrevivem aos testes.

### Corrigindo o read-your-writes { #fixing-read-your-writes }

| Técnica | Como | Trade-off |
|---|---|---|
| **Ler do líder depois de uma escrita** | por N segundos depois que um usuário escreve, direcione as leituras *daquele usuário* para o primário (um timestamp na sessão ou num cookie) | simples; o primário recebe algumas leituras extras |
| **Ler do líder os dados do próprio usuário** | "meus pedidos", "meus ingressos" sempre no primário; catálogo nas réplicas | regra simples; não escala se a maioria das leituras for "minha" |
| **Esperar a réplica alcançar** | a escrita devolve sua posição no log (LSN no PostgreSQL, GTID no MySQL); a próxima leitura só vai para uma réplica depois que ela reaplicou essa posição (`pg_last_wal_replay_lsn()`) | preciso; exige encanamento na camada de acesso a dados |
| **Réplica fixa por usuário** | faça hash do usuário para uma réplica | garante **leituras monotônicas**, não read-your-writes |
| **Réplica síncrona para leituras** | leia de um standby síncrono | sem atraso, mas as escritas pagam a latência |

<div class="csim" data-sim="replication" data-mode="async"></div>

!!! tip "Experimente"
    O simulador começa onde começa o chamado do suporte: o fã segurou A-12 há 300 ms, e o atraso é de 1 s (o `REPLICA_DELAY=1s` do [Hands-on 6](../../../hands-on/6/index.md)). Aperte **ler minhas reservas**: db-2 responde sem A-12, uma leitura desatualizada. Dê play até os pontos chegarem (1 s para db-2, 1,5 s para db-3) e leia de novo: atualizada. Recomece com **ler as próprias escritas** ligado: a leitura vai ao líder e vem atualizada na hora. Depois segure um assento novo em cada modo: *async* confirma em 2 ms, *semi-sync* em 1.003 ms, *sync* em 1.503 ms (espera db-3, o mais lento). Por fim, recomece em *async* e **derrube o líder** com A-12 em trânsito: db-2 é promovido sem ela e a reserva se perde; em *semi-sync* ou *sync* nada se perde (veja a seção de failover abaixo).

Monitore o atraso como métrica de primeira classe — `pg_stat_replication.replay_lag` no PostgreSQL, `ReplicaLag` no Amazon RDS — e crie alertas sobre ele (veja [Observabilidade](../../observability/index.md)). Uma réplica minutos atrás é pior do que nenhuma réplica.

!!! example "No código do BoxOffice: leituras roteadas pelo tipo de transação (lab 6)"

    O [Hands-on 6 — Réplica e pooling](../../../hands-on/6/replicas/index.md) dá ao `inventory` dois pools atrás de um único `DataSource`: uma transação marcada `@Transactional(readOnly = true)` (o mapa de assentos) recebe uma conexão da réplica, todas as outras recebem o primário. É a linha "ler do líder os dados do próprio usuário" da tabela: o `find` lê a reserva do próprio fã com um `@Transactional` comum, no primário, porque o fã acabou de criá-la. O lab então mede o bug que isso evita: lendo o mapa de assentos logo depois de uma reserva, cerca de **6%** dos fãs não viram a própria reserva com a réplica na mesma máquina, e **98%** com `REPLICA_DELAY=1s`.

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java (two pools, one DataSource)" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java:11:38"
    ```

**Experimente.** No cenário `db-replicas`, um primário recebe as escritas e as réplicas atendem as leituras. Adicione réplicas e veja a vazão de leitura subir enquanto a carga do primário fica estável; depois aumente a taxa de escrita e veja o atraso de replicação crescer — e, com ele, a fração de leituras desatualizadas.

<div class="sdp" data-scenario="db-replicas" data-mode="compact" data-height="520"></div>

---

## Pool de conexões { #connection-pooling }

As réplicas multiplicam *para onde* as consultas podem ir; os pools de conexões decidem *quantas* podem rodar ao mesmo tempo. No PostgreSQL, cada conexão é um processo separado do sistema operacional, com memória própria; milhares de conexões ociosas custam RAM e CPU de verdade — e o banco não fica mais rápido além de algumas poucas consultas concorrentes por núcleo de CPU.

Dimensione os pools com a Lei de Little, não no chute: conexões ocupadas = consultas por segundo × tempo de consulta. Com **2.000 consultas/s × 5 ms = 10 conexões** ocupadas em média. Um pool de 20–30 absorve as rajadas; um pool de 500 só acrescenta contenção.

O problema nos microsserviços: 20 pods × um pool de 50 = **1.000 conexões** num único primário. Um pooler de conexões como o **PgBouncer** (ou o RDS Proxy, ou o Cloud SQL Auth Proxy com pooling) fica entre eles, multiplexando milhares de conexões de clientes em poucas dezenas de conexões com o servidor. No modo *transaction pooling*, uma conexão com o servidor é emprestada por transação, então o estado de sessão (`SET`, tabelas temporárias, alguns usos de prepared statements) não pode vazar de uma transação para outra. Você vai medir isso no [Hands-on 6](../../../hands-on/6/index.md).

!!! example "No código do BoxOffice: o PgBouncer na frente do PostgreSQL (lab 6)"

    No [Hands-on 6](../../../hands-on/6/replicas/index.md) o `inventory` se conecta pelo PgBouncer em modo transação, e o PostgreSQL vê no máximo 20 conexões de servidor vindas dele, não importa quantas conexões de cliente cheguem. Numa execução de teste durante a venda relâmpago, o `pg_stat_activity` mostrou cerca de 60 conexões da aplicação (30 das três réplicas do `catalog`, 10 do `auth`, 20 do PgBouncer). Com `max_connections` reduzido a 80 e um pool de 40 no `inventory`, a mesma pilha falha com `too many clients already` quando o `inventory` se conecta direto, e continua funcionando pelo pooler, que transforma "clientes demais" em fila. As migrações continuam indo direto ao primário: o Flyway usa locks de sessão, que o pooling por transação não mantém.

    ``` { .ini title="infra/pgbouncer/pgbouncer.ini (transaction pooling)" }
    --8<-- "docs/2027.1/hands-on/6/code/infra/pgbouncer/pgbouncer.ini:12:17"
    ```

---

## Failover: quando o líder morre { #failover-when-the-leader-dies }

Se um seguidor morre, ele se reconecta e alcança o líder a partir do log. Se o **líder** morre, o sistema precisa fazer **failover**:

``` diagram-sim
sequenceDiagram
    participant M as Gerenciador de failover (ex.: Patroni + etcd)
    participant P as Primário antigo
    participant S as Standby
    participant A as Aplicações
    M->>P: health check
    Note over P: sem resposta por 10 s
    M->>S: promove a primário
    S-->>M: promovido (nova timeline)
    M->>A: atualiza DNS / IP virtual / proxy
    A->>S: escritas retomadas
    Note over P: se voltar, precisa ser isolado (fencing)<br/>e reentrar como seguidor
```

Cada passo esconde um problema difícil:

- A **detecção** usa timeouts. Curto demais: uma pausa de GC ou um soluço de rede dispara um failover desnecessário. Longo demais: minutos sem escritas.
- **Escritas perdidas.** Com replicação assíncrona, as escritas confirmadas pelo líder antigo mas ainda não enviadas desaparecem. Se eram reservas de assentos, o novo primário pode vender os mesmos assentos de novo.
- **Split brain.** Se o líder antigo estava apenas *particionado*, e não morto, dois nós podem aceitar escritas. Os sistemas evitam isso com consenso sobre quem é o líder (o Patroni guarda a chave do líder no etcd; veja [Consenso](../../distributed/consensus/index.md)) e com **fencing**: o líder antigo é isolado (STONITH, "shoot the other node in the head") ou suas escritas são rejeitadas por fencing tokens.
- **Os clientes precisam acompanhar.** Por DNS, IP virtual, proxy ou um driver que conhece a topologia.

Os serviços gerenciados empacotam tudo isso — Amazon RDS Multi-AZ com standby síncrono, Aurora com armazenamento em quorum, alta disponibilidade do Cloud SQL, HA com redundância de zona no Azure — com failovers que costumam levar de dezenas de segundos a alguns minutos; a pergunta de design para você é o que a aplicação faz enquanto isso (novas tentativas com backoff, veja [Confiabilidade](../../reliability/patterns/index.md)).

**Experimente.** O cenário `db-failover` é um checkout de venda relâmpago num cluster com um primário e um seguidor **assíncrono**: 1.500 req/s, metade escritas. Em t = 90 s o primário morre. Execute-o e leia o relatório: com a semente padrão cerca de **1.600 escritas se perdem** (confirmadas pelo primário antigo, nunca enviadas ao seguidor) e a disponibilidade cai para cerca de **90,6%**, porque toda escrita falha durante os 30 s de failover. Selecione `orders-db` e mude *Replicação* para `sync`: as escritas perdidas caem para **0**, mas a disponibilidade não se mexe. Volte para `async` e ponha o *Tempo de failover* em 5 s: a disponibilidade sobe para cerca de **98%**, e as escritas voltam a se perder. Os dois controles respondem a perguntas diferentes: o modo de replicação define quanto você perde (o RPO), a detecção e a promoção definem quanto tempo você fica fora (o RTO). A solução possível (abra no playground completo ↗) combina replicação por quórum com 2 seguidores, 2 shards e failover de 5 s: 0 escritas perdidas, cerca de 99,2% de disponibilidade.

<div class="sdp" data-scenario="db-failover" data-mode="compact" data-height="520"></div>

---

## Replicação multilíder { #multi-leader-replication }

Na replicação **multilíder** (*multi-leader*, multi-primary, ativo-ativo), vários nós aceitam escritas e replicam entre si de forma assíncrona. Motivos típicos: um líder por região, para que as escritas sejam locais; clientes offline-first (um app móvel ou um editor colaborativo é, na prática, um líder); um segundo data center que precisa aceitar escritas durante uma partição.

O preço são os **conflitos de escrita**: dois líderes aceitam escritas diferentes no mesmo registro ao mesmo tempo.

| Estratégia de resolução | Como funciona | Risco |
|---|---|---|
| **Last write wins (LWW)** | mantém a escrita com o maior timestamp | descarta silenciosamente a outra escrita; os relógios derivam (veja [Tempo e Relógios](../../distributed/time-clocks/index.md)) |
| **Merge** | merge específico da aplicação (união de tags, soma de contadores) | só funciona para dados mescláveis |
| **CRDTs** | tipos de dados replicados livres de conflito, que se mesclam automaticamente (contadores, conjuntos, texto) | tipos de dados limitados; mais metadados |
| **Evitar conflitos** | direcionar todas as escritas de um registro para um líder "de origem" | volta ao líder único, por registro |

!!! example "BoxOffice: onde o multilíder cabe — e onde não pode entrar"

    Descrições de eventos editadas pela equipe das casas de show em duas regiões: os conflitos são raros e LWW ou uma regra "o último editor vence, mantendo o histórico" é aceitável.

    Inventário de assentos: um conflito *é* uma venda dupla. Duas regiões aceitando reservas para o mesmo assento é exatamente o bug da página de [transações](../transactions/index.md#double-booking), em escala continental. O inventário continua com **líder único por evento** — se a BoxOffice se expandir para outro continente, o inventário de cada evento vive numa única região "de origem".

---

## Replicação sem líder { #leaderless }

O artigo do **Dynamo** da Amazon (2007)[^3] popularizou um terceiro design, usado por Cassandra, ScyllaDB e Riak: **nenhum líder**. O cliente (ou um nó coordenador) envia cada escrita para todas as **N** réplicas de uma chave e a considera bem-sucedida quando **W** delas confirmam; lê de **R** réplicas e fica com a versão mais nova.

<div class="csim" data-sim="quorum" data-n="3" data-w="2" data-r="2" data-down="C"></div>

!!! tip "Experimente"
    O simulador começa na configuração usual: N = 3, W = 2, R = 2, réplica C fora do ar. Dê play: toda escrita cai em A e B, toda leitura consulta A e B, e nenhuma leitura vem desatualizada. Ponha W = 1 e R = 1: agora cerca de metade das leituras perde a última escrita (o quadro calcula C(U − W, R) / C(U, R): 50% com 2 réplicas vivas, 67% quando C volta). Volte a W = 2, R = 2 e clique em C para religá-la: ela volta com uma versão antiga, e mesmo assim as leituras por quórum continuam atualizadas; ligue o **read repair** e veja C se atualizar. Por fim, derrube também B: com uma réplica viva, escritas e leituras falham, porque o coordenador não consegue juntar 2 respostas.

Se **R + W > N**, todo conjunto de leitura se sobrepõe a todo conjunto de escrita em pelo menos uma réplica, então uma leitura vê a última escrita confirmada (com ressalvas sob escritas concorrentes e falhas — quoruns sozinhos não são linearizáveis). Com N = 3:

| W | R | R + W > N? | Comportamento |
|---|---|---|---|
| 1 | 1 | não | o mais rápido, maior disponibilidade; as leituras podem estar desatualizadas |
| 2 | 2 | sim | a configuração "quorum" usual; tolera 1 nó fora do ar para leituras e escritas |
| 3 | 1 | sim | leituras rápidas; um único nó fora do ar bloqueia as escritas |
| 1 | 3 | sim | escritas rápidas; um único nó fora do ar bloqueia as leituras |

As escritas perdidas são reparadas por **read repair** (uma leitura que vê uma versão antiga grava a nova de volta), **hinted handoff** (um vizinho guarda as escritas de um nó fora do ar e as reaplica depois; com um **sloppy quorum**, esses guardiões temporários até contam para W) e **anti-entropia** (comparação em segundo plano entre réplicas com árvores de Merkle). O Cassandra expõe a escolha por consulta como níveis de consistência `ONE`, `QUORUM`, `LOCAL_QUORUM`, `ALL`.

---

## Comparando os designs { #comparing-the-designs }

| | Líder único | Multilíder | Sem líder |
|---|---|---|---|
| Escritas aceitas por | um nó | vários líderes | quaisquer W de N réplicas |
| Conflitos de escrita | nenhum (uma ordem) | sim — precisam ser resolvidos | sim — versões, LWW ou *siblings* |
| Failover | necessário, delicado | outro líder continua | desnecessário |
| Read-your-writes | por truques de roteamento | por líder | com R + W > N, quase sempre |
| Bom para | a maior parte do OLTP: pedidos, inventário, usuários | escritas multirregião, clientes offline | alta disponibilidade de escrita, séries temporais, carrinhos |
| Exemplos | PostgreSQL, MySQL, RDS, MongoDB | MySQL group replication (multi-primary), CouchDB, editores colaborativos | Cassandra, ScyllaDB, Riak, DynamoDB internamente |

!!! example "BoxOffice: o plano de replicação"

    - **catalog**: primário + 2 réplicas de leitura assíncronas; as páginas de eventos leem das réplicas (um segundo de atraso é aceitável), atrás do cache.
    - **inventory**: primário + um standby **síncrono** em outra zona de disponibilidade — uma reserva perdida é uma venda dupla, então nenhuma escrita confirmada pode se perder no failover. Todas as reservas e confirmações vão para o primário; o *mapa* de assentos pode vir de uma réplica ou do cache.
    - **order**: primário + réplica assíncrona para relatórios; *Meus ingressos* lê do primário por 30 segundos depois de uma compra (timestamp na sessão) e da réplica no resto do tempo.
    - Alerta de atraso: acionar o plantão se alguma réplica ficar mais de 5 s atrás por 2 minutos.

!!! tip "Na entrevista"

    - "Adicionar réplicas de leitura" nunca é a resposta completa: acrescente "**…e eu trato o atraso de replicação**: leituras que precisam refletir as escritas do próprio usuário vão para o primário".
    - Diga qual é a escolha de durabilidade: assíncrona (pode perder as últimas escritas no failover) vs um standby síncrono (nenhuma perda, + uma ida e volta por commit). Amarre isso aos dados: dinheiro e assentos → standby síncrono.
    - Para bancos sem líder, escreva **R + W > N** e diga o que isso garante e o que não garante (não é uma transação).
    - Mencione o tempo de failover e o que os clientes fazem enquanto isso: novas tentativas com backoff, escritas idempotentes.

!!! success "Boas práticas"

    - **Deixe o destino da leitura explícito no código, por transação** — quem lê o código precisa ver quais consultas podem estar desatualizadas. Na BoxOffice: `@Transactional(readOnly = true)` vai para a réplica pelo `DataSourceConfig` ([lab 6](../../../hands-on/6/replicas/index.md), quadro acima).
    - **Dê ao driver todos os hosts e deixe-o encontrar o primário** — com `jdbc:postgresql://db1,db2/boxoffice?targetServerType=primary` a aplicação se reconecta ao novo primário depois de um failover, sem novo deploy.
    - **Rode as migrações direto no primário** — mudanças de schema precisam de uma sessão de verdade, não de uma transação emprestada pelo pool. Na BoxOffice: `DB_MIGRATION_HOST=db` enquanto a aplicação passa pelo PgBouncer (lab 6).
    - **Ensaie o failover periodicamente** — uma troca planejada a cada trimestre mede o seu RTO real e prova que todo cliente segue o novo primário.
    - **Mantenha relatórios longos fora do standby de failover** — uma consulta longa num hot standby conflita com o replay e o atrasa, então o standby com que você conta para o failover fica para trás; dê aos relatórios sua própria réplica.

!!! warning "Armadilhas comuns"

    - **Ler as próprias escritas de uma réplica** — a página *Meus ingressos* vazia.
    - **Usar réplicas para tomar decisões**: verificar a disponibilidade do assento numa réplica e depois escrever no primário reintroduz a corrida check-then-act, com atraso extra.
    - **Réplicas como backup**: um `DELETE` sem `WHERE` é replicado em milissegundos. Backups e recuperação para um ponto no tempo são outra coisa (veja [Recuperação de Desastres](../../reliability/disaster-recovery/index.md)).
    - **Atraso não monitorado**: uma réplica horas atrás continua respondendo consultas — com dados de horas atrás.
    - **Conexões demais** vindas de muitos pods com pools grandes; use um pooler e dimensione os pools com a Lei de Little.
    - **Failover automático sem fencing**: split brain é pior do que indisponibilidade.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    WHY["por que replicar: disponibilidade,<br/>escala de leitura, latência"] --> SL["líder único"]
    SL --> SYNC["síncrona vs assíncrona<br/>durabilidade vs latência do commit"]
    SL --> LAG["atraso de replicação"]
    LAG --> RYW["ler as próprias escritas,<br/>leituras monotônicas"]
    RYW -.-> CM["modelos de consistência<br/>→ Distribuídos"]
    SL --> FO["failover: Patroni + etcd<br/>→ Consenso distribuído"]
    SL --> POOL["pool de conexões<br/>PgBouncer"]
    WHY --> ML["multilíder<br/>conflitos, LWW"]
    WHY --> LL["sem líder<br/>R + W > N"]
    LL --> PART["armazenamentos particionados<br/>→ Particionamento"]
```

**Componentes da paleta:** [`sql`](../../../reference/components/storage/index.md#sql) (um primário com réplicas de leitura; um standby síncrono para assentos e dinheiro) · [`nosql`](../../../reference/components/storage/index.md#nosql) (quóruns sem líder: Cassandra, DynamoDB) · [`app`](../../../reference/components/compute/index.md#app) (roteia leituras e escritas, faz retry com backoff durante um failover) · [`cache`](../../../reference/components/storage/index.md#cache) (fica na frente das réplicas do catálogo) · [`dns`](../../../reference/components/edge/index.md#dns) (um jeito de os clientes seguirem o novo líder). **Cenários:** `db-replicas`, `db-failover`, `multi-region`. **Continua em:** [Particionamento](../partitioning/index.md), [Distribuídos — consistência](../../distributed/consistency/index.md), [Distribuídos — consenso](../../distributed/consensus/index.md), [Confiabilidade — recuperação de desastres](../../reliability/disaster-recovery/index.md#rpo-rto), [Hands-on 6](../../../hands-on/6/index.md) (réplica de leitura, PgBouncer), [Exercício: cache + banco](../../../exercises/cache-db/index.md).

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*. 2. ed. O'Reilly. Capítulo "Replication".
[^2]: TERRY, D. B. et al. Session Guarantees for Weakly Consistent Replicated Data. *Proceedings of the 3rd International Conference on Parallel and Distributed Information Systems (PDIS)*, 1994.
[^3]: DeCANDIA, G. et al. Dynamo: Amazon's Highly Available Key-value Store. *ACM SOSP*, 2007.
[^4]: VERBITSKI, A. et al. Amazon Aurora: Design Considerations for High Throughput Cloud-Native Relational Databases. *ACM SIGMOD*, 2017.
[^5]: PostgreSQL Global Development Group. [High Availability, Load Balancing, and Replication](https://www.postgresql.org/docs/current/high-availability.html){target="_blank"}. Documentação do PostgreSQL.
