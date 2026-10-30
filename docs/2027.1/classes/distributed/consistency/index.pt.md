Uma fã paga dois ingressos às 10:00:41. A tela de confirmação diz *"Pedido 981 confirmado"*. Ela toca em **Meus ingressos** — e a lista está vazia. Em pânico, ela compra de novo. Nada se perdeu e não houve bug no sentido usual: o pagamento foi gravado no **primário** do PostgreSQL, enquanto *Meus ingressos* foi servido por uma **réplica de leitura** que ainda não tinha recebido a escrita. O BoxOffice tinha escolhido, sem perceber, um modelo de consistência — e era o modelo errado para aquela tela.

Esta página explica como os dados são copiados entre nós (**replicação**) e o que um leitor pode ver enquanto as cópias discordam (**modelos de consistência**). Os dois são inseparáveis: o projeto da replicação decide quais modelos de consistência são baratos, quais são caros e quais são impossíveis.

---

## Por que replicar? { #why-replicate }

Manter uma cópia do mesmo dado em vários nós atende a três objetivos diferentes, e vale dizer qual deles você quer:

| Objetivo | Como a replicação ajuda | BoxOffice |
|---|---|---|
| **Disponibilidade / durabilidade** | Se um nó morre, outro tem os dados | O banco do `inventory` sobrevive à perda de uma máquina ou de uma zona |
| **Vazão de leitura** | As leituras se espalham por muitas cópias | O catálogo de eventos é lido ~100× mais do que escrito (proporção ilustrativa) |
| **Latência** | Uma cópia perto do usuário responde mais rápido | Uma cópia do catálogo em uma região europeia para fãs em Lisboa |

Os três são fáceis se o dado nunca muda. A dificuldade está inteira em **lidar com mudanças**: cada escrita precisa chegar a todas as cópias e, enquanto viaja, as cópias discordam.

---

## Modelos de replicação { #replication-models }

Há três famílias, que se distinguem por **quem aceita escritas**[^1].

### Com um único líder (primário–réplica) { #single-leader-primaryreplica }

Um nó, o **líder** (primário), aceita todas as escritas e envia um log de mudanças aos **seguidores** (réplicas). As leituras podem ir ao líder ou aos seguidores. É o padrão no PostgreSQL, MySQL, MongoDB, Redis e Kafka (um líder por partição).

``` diagram-sim
flowchart LR
    w([order: escrita]) -->|"INSERT pedido 981"| L[("líder<br/>(primário)")]
    L -->|"stream do WAL"| F1[("seguidor 1")]
    L -->|"stream do WAL"| F2[("seguidor 2")]
    r1([Meus ingressos: leitura]) -->|"SELECT"| F1
    r2([catálogo: leitura]) -->|"SELECT"| F2
```

### Com vários líderes (multi-leader) { #multi-leader }

Vários nós aceitam escritas — tipicamente um líder por data center ou região — e replicam entre si de forma assíncrona. As escritas são rápidas e locais em todo lugar, mas dois líderes podem aceitar escritas **conflitantes** no mesmo registro, que precisam ser resolvidas depois. Usos típicos: implantações multirregião, apps offline-first (cada celular é um "líder"), edição colaborativa.

### Sem líder (leaderless) { #leaderless }

Qualquer réplica aceita leituras e escritas. O cliente (ou um coordenador) envia cada escrita a várias réplicas e cada leitura a várias réplicas, e **quóruns** decidem o que conta como sucesso (`R + W > N`, veja [Consenso e Quóruns](../consensus/index.md#quorums)). É o projeto do artigo Dynamo, da Amazon[^2], do Cassandra e do ScyllaDB.

| | Um líder | Vários líderes | Sem líder |
|---|---|---|---|
| **Quem aceita escritas** | Um líder | Um líder por região/site | Qualquer réplica |
| **Conflitos de escrita** | Nenhum (o líder ordena as escritas) | Sim — precisam ser resolvidos | Sim — precisam ser resolvidos |
| **Latência de escrita** | Ida e volta até o líder (talvez distante) | Local | Ida e volta até W réplicas |
| **Falha do líder** | Precisa de failover (segundos) | Os outros líderes continuam | Não há líder a perder |
| **Consistência forte possível?** | Sim (leitura no líder, replicação síncrona) | Não entre líderes | Só aproximadamente (quóruns) |
| **Sistemas típicos** | PostgreSQL, MySQL, MongoDB, partições do Kafka | Montagens multirregião de MySQL/Postgres, CouchDB, Redis Active-Active | Cassandra, ScyllaDB, Riak, DynamoDB (internamente) |
| **Uso no BoxOffice** | `inventory`, `order`, `payment` | — (evite para assentos!) | Atividade dos fãs, contadores de visualização |

### Síncrona ou assíncrona? { #synchronous-or-asynchronous }

Independentemente de quem lidera, o líder precisa decidir **quando dizer "OK" ao cliente**:

``` diagram-sim
sequenceDiagram
    participant C as order
    participant L as líder
    participant F1 as seguidor 1 (síncrono)
    participant F2 as seguidor 2 (assíncrono)
    C->>L: INSERT pedido 981
    L->>F1: replica
    L->>F2: replica
    F1-->>L: gravado em disco
    L-->>C: OK (após 1 seguidor síncrono)
    Note over F2: ainda aplicando...<br/>uma leitura aqui está desatualizada
    F2-->>L: gravado (mais tarde)
```

| Modo | O cliente recebe OK quando… | Se o líder morre logo após o OK | Latência de escrita | Disponibilidade de escrita |
|---|---|---|---|---|
| **Assíncrono** | o líder gravou localmente | Escritas recentes podem ser **perdidas** | A menor | Alta: seguidores podem estar fora |
| **Síncrono (todos)** | todos os seguidores gravaram | Nada se perde | O seguidor mais lento decide | Baixa: qualquer seguidor fora bloqueia as escritas |
| **Semissíncrono** | o líder + *k* seguidores gravaram | Nada se perde se um seguidor síncrono for promovido | Uma ida e volta a mais | Boa: tolera outros seguidores fora |
| **Quórum (consenso)** | uma maioria gravou | Nada se perde | Mediana da maioria mais rápida | Tolera uma minoria fora |

O PostgreSQL expõe essa escolha em `synchronous_commit` e `synchronous_standby_names` (por exemplo `ANY 1 (replica_a, replica_b)` — semissíncrono com uma de duas). Na prática, "totalmente síncrono" é raro: um seguidor lento travaria toda escrita. Replicação semissíncrona ou por quórum é o meio-termo usual.

### Atraso de replicação { #replication-lag }

Com seguidores assíncronos, a demora entre uma escrita no líder e sua visibilidade em um seguidor é o **atraso de replicação** (*replication lag*). Em um sistema saudável costuma ser de milissegundos; sob carga pesada de escrita, durante uma transação longa ou depois de um soluço na rede, pode chegar a segundos ou minutos. O tempo entre uma escrita e a leitura seguinte decide se essa leitura está desatualizada:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

# Illustrative model: replication lag is exponentially distributed with a given mean.
# A read issued t ms after the write is stale if the replica has not applied it yet.
t = np.linspace(0, 2000, 400)            # ms between the write and the read
fig, ax = plt.subplots(figsize=(8, 3.6))
for mean, color, label in [(20, "#1e9e5a", "quiet day: mean lag 20 ms"),
                           (200, "#2f6fed", "busy: mean lag 200 ms"),
                           (800, "#e5484d", "10:00 on-sale: mean lag 800 ms")]:
    ax.plot(t, 100 * np.exp(-t / mean), color=color, lw=2, label=label)
ax.axvline(300, color="#888", lw=0.8, ls=":")
ax.text(310, 92, "fan opens 'My tickets'\n~300 ms after paying", fontsize=9)
ax.set_xlabel("time between the write (primary) and the read (replica), ms")
ax.set_ylabel("P(read is stale), %")
ax.set_ylim(0, 102)
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="upper right")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Com um atraso (suposto) exponencial, a mesma tela que quase nunca está desatualizada em um dia tranquilo fica desatualizada para cerca de **69%** das fãs que a abrem 300 ms depois de pagar durante a abertura das vendas, quando o atraso médio sobe para 800 ms. O bug da história de abertura não é raro sob carga — é o comportamento *esperado*.

**Experimente.** Carregue o cenário `db-replicas`, rode o perfil `load` e observe a métrica de atraso da réplica. Depois aumente a taxa de escrita (ou mude para `spike`) e veja o atraso — e a fração de leituras desatualizadas — crescer. Por fim, mande as leituras para o primário e compare a CPU e o p99 do primário.

<div class="sdp" data-scenario="db-replicas" data-mode="compact" data-height="520"></div>

[:material-open-in-new: Abrir o playground completo](../../../../playground/index.md)

---

## Modelos de consistência: um contrato { #models }

Um **modelo de consistência** é um contrato entre um armazenamento de dados e quem programa contra ele: *se você seguir estas regras, os resultados das leituras serão previsíveis desta forma*[^3]. Modelos mais fortes são mais fáceis de programar e custam mais coordenação (latência, disponibilidade); modelos mais fracos são mais baratos e empurram a complexidade para a aplicação.

``` diagram
flowchart TD
    LIN["Linearizável<br/>(consistência forte)"] --> SEQ["Sequencial"]
    SEQ --> CAU["Causal"]
    CAU --> RYW["Read-your-writes"]
    CAU --> MR["Leituras monotônicas"]
    CAU --> CP["Prefixo consistente"]
    RYW --> EV["Eventual"]
    MR --> EV
    CP --> EV
```

Uma seta de A para B significa "A garante tudo o que B garante, e mais". Read-your-writes e leituras monotônicas são **garantias de sessão**: valem para a sessão de um cliente, não para todos; o prefixo consistente (consistent prefix) promete que nenhum leitor vê escritas fora da ordem em que aconteceram.

### Linearizabilidade (consistência forte) { #linearizability }

A **linearizabilidade** faz um sistema replicado se comportar **como se houvesse uma única cópia dos dados**, e cada operação tivesse efeito atômico em um instante entre seu início e seu fim[^4]. Uma vez que alguma leitura devolveu um valor novo, toda leitura posterior (de qualquer pessoa, em qualquer réplica) precisa devolver esse valor ou um mais novo.

``` diagram-sim
sequenceDiagram
    participant A as Fã A
    participant N1 as réplica 1
    participant N2 as réplica 2
    participant B as Fã B
    A->>N1: reservar assento A-12
    N1-->>A: OK (reserva confirmada)
    Note over A,B: a escrita terminou
    B->>N2: o assento A-12 está livre?
    N2-->>B: sim, FREE (desatualizado)
    Note over N2,B: viola a linearizabilidade:<br/>B começou depois que a escrita de A terminou
    B->>N2: reservar assento A-12
    Note over N2: reserva em dobro se N2 aceitar
```

A linearizabilidade é o que você precisa quando a correção depende de **uma resposta atualizada**:

- **unicidade e estoque** — um assento, um nome de usuário, a última unidade em estoque;
- **eleição de líder e locks** — só um nó pode acreditar que é o líder;
- **tempo entre canais** — um fã paga e o serviço `notification` (lendo em outro lugar) precisa ver o pedido pago.

Ela é obtida roteando todas as leituras e escritas de uma chave por **um líder**, que por sua vez é eleito por **consenso** (com cuidado com líderes desatualizados), ou por consenso em cada operação. O preço: toda operação paga pelo menos uma ida e volta até o líder ou até uma maioria, e nós que não alcançam o líder/a maioria precisam recusar — a escolha entre C e A do [CAP](../cap-pacelc/index.md).

!!! info "Serializável não é linearizável"
    **Serializabilidade** é uma garantia de *isolamento* para transações sobre muitos objetos (o resultado equivale a alguma ordem serial das transações). **Linearizabilidade** é uma garantia de *atualidade* para objetos individuais (leituras veem a última escrita em tempo real). Um banco pode oferecer uma, as duas ("serializabilidade estrita", como no Spanner) ou nenhuma. Os níveis de isolamento estão em [Bancos de dados — transações](../../databases/transactions/index.md).

### Consistência sequencial { #sequential-consistency }

Todos os nós veem todas as operações na **mesma ordem**, e as operações de cada nó aparecem na ordem do seu programa — mas essa ordem não precisa respeitar o tempo real. Uma leitura pode devolver um valor "antigo" em termos de relógio, desde que todos concordem com a sequência. É sobretudo um conceito de memória de hardware e de teoria; em system design raramente você o escolhe explicitamente.

### Consistência causal { #causal }

Operações **causalmente relacionadas** — uma poderia ter influenciado a outra — são vistas por todos nessa ordem; operações **concorrentes** podem ser vistas em ordens diferentes por nós diferentes.

O exemplo clássico é uma conversa: se Ana pergunta *"A venda das 10:00 atrasou?"* e o organizador responde *"Não, começa no horário"*, ninguém pode ver a resposta sem a pergunta. No BoxOffice: um evento `SeatReleased` causado por um evento `HoldExpired` não pode ser aplicado antes dele.

A consistência causal é interessante porque é o **modelo mais forte que continua disponível durante uma partição de rede**[^5]: os nós podem continuar aceitando leituras e escritas dos dois lados e ainda respeitar a causalidade. Ela é rastreada com relógios lógicos — veja [Tempo e Relógios](../time-clocks/index.md#vector-clocks).

### Garantias de sessão { #session-guarantees }

A maioria dos bugs do tipo "meu dado sumiu" é a violação de uma destas quatro garantias, definidas para a sessão de um único cliente (Terry et al., projeto Bayou)[^6]:

| Garantia | Promessa | Violação no BoxOffice |
|---|---|---|
| **Read-your-writes** (ler as próprias escritas) | Depois que você escreve, suas leituras veem essa escrita | A história de abertura: você pagou, *Meus ingressos* está vazio |
| **Leituras monotônicas** | Você nunca vê o dado voltar no tempo | Assentos restantes mostra 120, depois 340, depois 95, conforme você cai em réplicas diferentes |
| **Escritas monotônicas** | Suas escritas são aplicadas na ordem em que você as fez | "Trocar e-mail" e depois "enviar ingresso" — o ingresso vai para o endereço antigo |
| **Escritas seguem leituras** (causal) | Uma escrita que você faz depois de ler X é ordenada depois de X | Você responde a uma mensagem do suporte que outras réplicas ainda não receberam |

``` diagram-sim
sequenceDiagram
    participant F as App do fã
    participant R1 as réplica 1 (atraso 10 ms)
    participant R2 as réplica 2 (atraso 2 s)
    F->>R1: GET /events/42/availability
    R1-->>F: restam 95 assentos
    F->>R2: atualizar (o load balancer escolhe R2)
    R2-->>F: restam 340 assentos
    Note over F: a contagem voltou no tempo:<br/>leituras monotônicas violadas
```

Como oferecê-las em cima de réplicas assíncronas:

- **Ler do líder depois de uma escrita**: por uma janela curta (por exemplo, 1–5 s) depois que a fã escreve, roteie as leituras *dela* para o primário — ou sempre leia do primário os dados que pertencem ao usuário (*Meus ingressos*).
- **Tokens de versão**: a escrita devolve a posição no log do líder (no PostgreSQL, o LSN do WAL — *Log Sequence Number*); o cliente o envia na próxima leitura, e uma réplica só responde depois de ter aplicado pelo menos aquela posição (senão espera ou encaminha ao líder). Muitos bancos expõem isso como *sessões causais* ou *tokens de read-after-write* (sessões de consistência causal do MongoDB, consistência de sessão do Cosmos DB).
- **Réplica fixa (sticky)**: prenda cada sessão a uma réplica (hash do id da sessão) — dá leituras monotônicas, não read-your-writes.

!!! example "No código do BoxOffice: read-your-writes pelo roteamento (lab 6)"

    O [Hands-on 6 — Réplicas](../../../hands-on/6/replicas/index.md) acrescenta uma réplica por streaming ao banco do `inventory` e usa a primeira técnica acima. Um `DataSource` envolve dois pools; uma transação marcada `@Transactional(readOnly = true)` — o mapa de assentos, a disponibilidade por setor — recebe uma conexão da réplica, todas as outras recebem o primário. O `HoldService.find` *não* é somente leitura de propósito: o fã acabou de criar aquela reserva, então ela é lida do primário. O laboratório mediu por quê: um fã que reserva um assento e recarrega o mapa de assentos na hora, a partir da réplica, não viu a própria reserva em **cerca de 6%** das tentativas com a réplica na mesma máquina, e em **98%** com 1 s de atraso artificial.

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java (the routing)" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java:11:38"
    ```

### Consistência eventual { #eventual }

A **consistência eventual** só promete que, *se as escritas pararem*, todas as réplicas vão **eventualmente convergir** para o mesmo valor. Não diz *quando*, e não diz nada sobre o que você lê enquanto isso. É a garantia do DNS, da maioria dos caches e CDNs, das réplicas assíncronas e dos armazenamentos sem líder em configurações de quórum baixas.

Ela serve perfeitamente para muitos domínios — a descrição do evento, a imagem do cartaz, o contador "312 pessoas estão vendo este evento". A parte difícil é o que acontece quando réplicas aceitaram **escritas concorrentes** no mesmo item e precisam convergir:

| Estratégia | Como | Trade-off |
|---|---|---|
| **Last-write-wins (LWW)** | Fica a escrita com o maior timestamp | Simples; **descarta silenciosamente** escritas concorrentes e depende de relógios que derivam ([Tempo e Relógios](../time-clocks/index.md#lww)) |
| **Vetores de versão / irmãos** | Detecta versões concorrentes, guarda todas, deixa a aplicação mesclar | Nenhuma perda silenciosa; a aplicação precisa escrever a lógica de merge (o carrinho do Dynamo mesclava por união) |
| **CRDTs** | Tipos de dados cujo merge é comutativo, associativo e idempotente | Automático, convergência demonstrável; só para dados que cabem em um CRDT (contadores, conjuntos, registradores, texto) |
| **Evitar conflitos** | Rotear todas as escritas de uma chave para um líder (uma região "de origem") | Nenhum conflito; as escritas dessa chave pagam a latência até a origem |

Um **CRDT** (*Conflict-free Replicated Data Type*, tipo de dado replicado livre de conflitos)[^7] é projetado para que as réplicas possam trocar estado em qualquer ordem, quantas vezes for, e ainda terminar iguais. O mais simples é o contador que só cresce: cada réplica incrementa apenas a sua posição, e o merge pega o máximo elemento a elemento.

```java title="GCounter.java"
// Grow-only counter CRDT: e.g. "fans interested in event 42", counted in 3 regions
class GCounter {
    private final long[] counts;   // one slot per replica
    private final int me;          // this replica's index

    GCounter(int replicas, int me) { this.counts = new long[replicas]; this.me = me; }

    void increment() { counts[me]++; }

    long value() { return java.util.Arrays.stream(counts).sum(); }

    // merge = element-wise max: commutative, associative, idempotent
    void merge(GCounter other) {
        for (int i = 0; i < counts.length; i++)
            counts[i] = Math.max(counts[i], other.counts[i]);
    }
}
```

Se São Paulo contou `[3, 0, 0]` e Lisboa `[0, 2, 0]`, ambas mesclam para `[3, 2, 0]` e informam 5 — nenhum incremento perdido, nenhuma coordenação necessária. Um único número compartilhado com LWW informaria 3 ou 2.

---

## O espectro em um relance { #the-spectrum-at-a-glance }

| Modelo | Garantia | Custo de coordenação | Disponível durante uma partição? | Implementação típica |
|---|---|---|---|---|
| **Linearizável** | Cópia única, atualidade em tempo real | O maior: ida e volta ao líder ou à maioria por operação | Não (o lado minoritário precisa recusar) | Armazenamentos baseados em Raft/Paxos (etcd, Spanner, CockroachDB), um líder com leituras no líder |
| **Sequencial** | Uma ordem global para todos | Alto | Não | Sobretudo teoria / modelos de memória de hardware |
| **Causal** | Causa antes do efeito, para todos | Médio: rastrear dependências | **Sim** | Relógios lógicos/vetoriais, sessões causais |
| **Read-your-writes, leituras monotônicas** | Sanidade por sessão | Baixo: rotear ou esperar por sessão | Sim, se a sessão ficar do seu lado | Leituras no líder após escrita, tokens de LSN, réplicas fixas |
| **Eventual** | Converge se as escritas pararem | O menor | Sim | Replicação assíncrona, caches, DNS, sem líder em `ONE` |

!!! example "BoxOffice: um modelo de consistência por domínio de dados"
    | Dado | Modelo | Por quê | Como |
    |---|---|---|---|
    | Estado dos assentos e reservas | **Linearizável** | Dois fãs nunca podem reservar o mesmo assento | Um único primário PostgreSQL por evento; `UPDATE` condicional/`SELECT … FOR UPDATE` |
    | Pagamentos | **Linearizável** + idempotente | Uma cobrança em dobro é inaceitável | Só no primário; chave de idempotência repassada ao provedor |
    | *Meus ingressos*, *Meus pedidos* | **Read-your-writes** | A fã precisa ver o que acabou de comprar | Ler do primário os dados da própria fã, ou token de LSN |
    | Contador de assentos restantes na página do evento | **Leituras monotônicas** (eventual é tolerável) | Pode atrasar, mas não pode voltar para trás | Réplica fixa ou cache com TTL curto |
    | Catálogo de eventos, imagens, descrições | **Eventual** | Segundos de atraso não prejudicam ninguém | Réplicas, cache, CDN |
    | Contadores de "fãs interessados", analytics | **Eventual** (CRDT) | Aproximado basta, disponibilidade importa | Contadores por região mesclados |

    O princípio de projeto: **forte onde há dinheiro ou unicidade em jogo, fraco em todo o resto** — porque consistência forte é paga em toda requisição.

!!! tip "Na entrevista"
    Quando o entrevistador disser "e o usuário deve ver a atualização imediatamente", traduza para um modelo: *"isso é read-your-writes, não consistência forte global — vou ler os dados do próprio usuário no líder, ou passar a posição no log da escrita como token."* Depois aponte o único lugar que **precisa** de linearizabilidade (estoque, saldos, unicidade) e explique como obtê-la (um líder + failover baseado em consenso, escritas condicionais). Entrevistadores recompensam vocabulário preciso e escolhas por domínio; penalizam "tudo é fortemente consistente" (lento, caro) e "tudo é eventualmente consistente" (reservas em dobro).

!!! success "Boas práticas"

    - **Escreva o modelo de consistência de cada domínio de dados no documento de design** — uma linha por domínio (assentos, pagamentos, *Meus ingressos*, catálogo), com o mecanismo que o garante; os revisores conferem o código contra ela.
    - **Use o primário por padrão e opte por réplicas por transação** — uma leitura só vai para uma réplica quando alguém a marcou como tolerante a defasagem. Na BoxOffice: `@Transactional(readOnly = true)` roteia para a réplica no [lab 6](../../../hands-on/6/replicas/index.md) (quadro acima).
    - **Meça leituras defasadas com um teste de escrever-e-ler** — escreva, leia de volta na hora a partir da réplica, conte as falhas; sob carga o número nunca é zero. Na BoxOffice: `load/read-your-writes.js` do lab 6 (6% sem atraso, 98% com 1 s).
    - **Use uma coluna `version` em edições de ler-modificar-escrever** — um `UPDATE … WHERE version = :v` condicional transforma uma atualização perdida num conflito visível. Na BoxOffice: `inventory.seats.version` (lab 6).
    - **Mostre o frescor onde a defasagem é permitida** — "atualizado há 3 s" num contador servido por uma réplica ou um cache ajusta a expectativa do fã e poupa um chamado no suporte.

!!! warning "Armadilhas"
    - **Separar leitura/escrita por padrão**: mandar *todas* as leituras para réplicas quebra read-your-writes na primeira tela depois de uma escrita.
    - **Caches também são réplicas**: colocar Redis ou uma CDN na frente de um armazenamento linearizável torna essas leituras eventualmente consistentes ([Caching](../../caching/index.md)).
    - **Load balancers quebram garantias de sessão**: duas leituras seguidas podem cair em duas réplicas com atrasos diferentes.
    - **Replicação assíncrona + failover automático = escritas perdidas**: o seguidor promovido pode não ter as últimas escritas confirmadas. Use replicação semissíncrona para dados que você não pode perder.
    - **Confundir "eventual" com "logo"**: consistência eventual não tem limite de tempo; sob carga o atraso pode chegar a minutos. Monitore o atraso de replicação e crie alertas.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    W["escrita no líder"] --> REPL{"replicação<br/>síncrona ou assíncrona?"}
    REPL -->|"síncrona / quórum"| LIN["leituras linearizáveis"]
    LIN --> COST["paga em latência e disponibilidade<br/>→ CAP e PACELC"]
    REPL -->|"assíncrona: atraso"| STALE["leituras desatualizadas"]
    STALE --> SG["garantias de sessão<br/>read-your-writes, leituras monotônicas"]
    W2["escritas em vários líderes"] --> CONF["escritas concorrentes"]
    CONF --> RES["LWW · vetores de versão · CRDTs<br/>→ Tempo e Relógios"]
    LIN --> CONS["líder escolhido por consenso<br/>→ Consenso e Quóruns"]
```

**Componentes da paleta que são réplicas (e, portanto, têm um modelo de consistência):** [`sql`](../../../reference/components/storage/index.md#sql) (primário + réplicas de leitura, cenário `db-replicas`) · [`nosql`](../../../reference/components/storage/index.md#nosql) (sem líder, cenário `sharding`) · [`cache`](../../../reference/components/storage/index.md#cache) (cenário `read-heavy-cache`) · [`cdn`](../../../reference/components/edge/index.md#cdn) (cenário `cdn-static`) · [`stream`](../../../reference/components/messaging/index.md#stream) (partições replicadas). **Apoia-se em:** [modelos de falha](../index.md#failure-models). **Continua em:** [CAP e PACELC](../cap-pacelc/index.md), [Bancos de dados — replicação](../../databases/replication/index.md), [Caching — invalidação](../../caching/invalidation/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - A **replicação** serve a disponibilidade, a vazão de leitura e a latência; toda a dificuldade está em propagar as **escritas**.
    - **Um líder** evita conflitos de escrita; **vários líderes** e **sem líder** aceitam escritas em todo lugar e precisam resolver conflitos (LWW, vetores de versão, CRDTs, ou evitá-los com um líder de origem).
    - Replicação **síncrona vs assíncrona** troca latência e disponibilidade de escrita por durabilidade no failover; semissíncrona ou por quórum é o meio-termo usual.
    - Os **modelos de consistência** vão de **linearizável** (ilusão de cópia única), passando por **causal** e pelas **garantias de sessão** (read-your-writes, leituras monotônicas), até **eventual**.
    - Escolha **por domínio de dados**: linearizável para assentos e dinheiro, read-your-writes para os dados do próprio usuário, eventual para o catálogo e os contadores.

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly. Capítulo "Replication".
[^2]: DECANDIA, G. et al. [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf){target="_blank"}. SOSP, 2007.
[^3]: [Consistency Models](https://jepsen.io/consistency){target="_blank"} — Jepsen (Kyle Kingsbury), um mapa clicável dos modelos e de suas relações.
[^4]: HERLIHY, M.; WING, J. [Linearizability: A Correctness Condition for Concurrent Objects](https://dl.acm.org/doi/10.1145/78969.78972){target="_blank"}. ACM TOPLAS, 1990.
[^5]: MAHAJAN, P.; ALVISI, L.; DAHLIN, M. [Consistency, Availability, and Convergence](https://www.cs.utexas.edu/users/dahlin/papers/cac-tr.pdf){target="_blank"}. UT Austin TR-11-22, 2011.
[^6]: TERRY, D. et al. [Session Guarantees for Weakly Consistent Replicated Data](https://www.cs.utexas.edu/users/dahlin/Classes/GradOS/papers/SessionGuaranteesPDIS.pdf){target="_blank"}. PDIS, 1994.
[^7]: SHAPIRO, M. et al. [Conflict-free Replicated Data Types](https://inria.hal.science/inria-00609399){target="_blank"}. SSS, 2011.
