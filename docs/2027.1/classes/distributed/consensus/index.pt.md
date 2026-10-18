Às 10:00:03, três segundos depois de abertas as vendas, a máquina que roda o **primário** PostgreSQL do `inventory` congela. Seu standby síncrono está saudável. Alguém — ou algo — precisa decidir que o primário antigo está morto, promover o standby e fazer todas as réplicas do `inventory` escreverem no novo. Agora imagine que o primário antigo não estava morto, só pausado por oito segundos por um soluço no armazenamento: ele acorda, ainda acredita que é o primário e aceita uma reserva do assento A-12 que o novo primário já tinha dado a outra pessoa. Dois primários ao mesmo tempo é o que se chama de **split brain**, e em um sistema de ingressos isso significa assentos vendidos duas vezes.

Decidir "quem é o primário agora" é uma instância do problema de **consenso**: fazer um grupo de nós **concordar sobre um único valor** — apesar de mensagens perdidas e atrasadas e apesar de alguns nós falharem. O consenso é a base da eleição de líder, dos locks distribuídos, da configuração replicada (o etcd por trás de todo cluster Kubernetes) e de todo banco de dados replicado fortemente consistente.

---

## Consenso e máquinas de estado replicadas

A forma mais útil de consenso é concordar sobre um **log**: uma sequência ordenada de comandos. Se todo nó começa no mesmo estado e aplica os mesmos comandos na mesma ordem, todo nó termina no mesmo estado — uma **máquina de estado replicada**:

``` mermaid
flowchart LR
    C([clientes]) --> L
    subgraph L["líder"]
        LL["log: reserva A-12 · reserva B-3 · libera A-12"] --> LS[("estado")]
    end
    subgraph F1["seguidor 1"]
        F1L["mesmo log"] --> F1S[("mesmo estado")]
    end
    subgraph F2["seguidor 2"]
        F2L["mesmo log"] --> F2S[("mesmo estado")]
    end
    L -->|"replica entradas"| F1
    L -->|"replica entradas"| F2
```

Um algoritmo de consenso correto garante:

**Segurança (*safety*)** — "nada de ruim acontece"
: Todos os nós que decidem, decidem o **mesmo** valor (a mesma entrada do log em cada posição), e esse valor foi proposto por alguém.

**Vivacidade (*liveness*)** — "algo de bom acaba acontecendo"
: Nós que não falharam **eventualmente** decidem.

### Por que é difícil: FLP

O **resultado de impossibilidade FLP** (Fischer, Lynch e Paterson, 1985)[^1] prova que, em um sistema totalmente **assíncrono** — sem limite para o atraso das mensagens —, nenhum algoritmo determinístico consegue garantir consenso se mesmo **um** nó pode cair: alguma sequência azarada de atrasos o mantém indeciso para sempre. A saída, usada pelo Paxos e pelo Raft, é **nunca comprometer a segurança** e garantir progresso só quando a rede se comporta "bem o bastante" (sincronia parcial), usando **timeouts** para suspeitar de falhas. Um timeout pode estar errado (o nó só estava lento), e por isso os algoritmos precisam continuar seguros mesmo quando as suspeitas são falsas.

---

## Maiorias: por que clusters têm 3 ou 5 nós { #majorities }

O truque central é o **quórum de maioria**: uma decisão só é válida se mais da metade dos N nós a aceitar. **Quaisquer duas maiorias do mesmo cluster têm pelo menos um nó em comum** — então duas decisões conflitantes nunca podem ambas reunir uma maioria: o nó em comum teria de votar nas duas, e o protocolo proíbe isso.

| Tamanho do cluster N | Maioria ⌊N/2⌋ + 1 | Falhas toleradas ⌊(N−1)/2⌋ |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | **1** |
| 4 | 3 | 1 |
| 5 | 3 | **2** |
| 7 | 4 | 3 |

!!! tip "Use um número ímpar de nós"
    Passar de 3 para 4 nós adiciona custo e mais uma máquina que pode falhar, mas **não tolera nenhuma falha a mais**. Um cluster de 2 nós é pior do que um nó: perder **qualquer um** dos dois o para. Por isso clusters de etcd, ZooKeeper, Consul e os quóruns de controladores do Kafka têm 3 ou 5 nós — espalhados por 3 zonas de disponibilidade, para que perder uma zona ainda deixe uma maioria.

O que a maioria compra em disponibilidade? Se cada nó está no ar com probabilidade $a$ (de forma independente), o cluster está no ar quando pelo menos uma maioria está:

$$
A_{cluster}(N) = \sum_{k=\lfloor N/2 \rfloor + 1}^{N} \binom{N}{k}\, a^{k} (1-a)^{N-k}
$$

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from math import comb
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

def cluster_up(n, a):
    """P(a majority of n independent nodes is up), each node up with probability a."""
    need = n // 2 + 1
    return sum(comb(n, k) * a**k * (1 - a)**(n - k) for k in range(need, n + 1))

a = np.linspace(0.90, 0.999, 200)
fig, ax = plt.subplots(figsize=(8, 3.8))
for n, color in [(1, "#888888"), (2, "#e5484d"), (3, "#2f6fed"), (5, "#1e9e5a"), (7, "#f59e0b")]:
    nines = -np.log10(1 - np.array([cluster_up(n, x) for x in a]))
    ax.plot(100 * a, nines, color=color, lw=2, label=f"N = {n}")
ax.set_xlabel("availability of each node, %")
ax.set_ylabel("cluster availability, in nines")
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="upper left")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Com nós a 99% cada, um nó dá 2 noves, **dois nós dão menos** (98,01% — os dois precisam estar no ar), três nós dão ≈ 99,97% e cinco ≈ 99,999%. A hipótese de independência é otimista — nós na mesma zona, na mesma versão ou sobrecarregados pelo mesmo tráfego falham juntos —, e por isso os nós são espalhados por domínios de falha.

### Split brain, e por que a maioria o impede

Uma partição divide um cluster de 5 nós em 3/2. Só o lado com 3 nós consegue formar uma maioria, eleger um líder e confirmar escritas; o lado com 2 sabe que é minoria e para de aceitar escritas:

``` mermaid-sim
flowchart LR
    subgraph maj ["Lado majoritário (3 de 5)"]
        n1[nó 1: líder] --- n2[nó 2]
        n2 --- n3[nó 3]
    end
    subgraph min ["Lado minoritário (2 de 5)"]
        n4[nó 4] --- n5[nó 5]
    end
    n3 -.-|partição| n4
    maj -->|"consegue eleger e confirmar"| ok([continua vendendo assentos])
    min -->|"não alcança 3 votos"| ko([rejeita escritas: 503])
```

É exatamente o comportamento CP do [CAP](../cap-pacelc/index.md): o lado minoritário fica indisponível, e assim o sistema permanece consistente.

---

## Raft { #raft }

O Raft (Ongaro e Ousterhout, 2014)[^2] foi projetado para ser **compreensível**, e é o algoritmo de consenso que você tem mais chance de encontrar: etcd (Kubernetes), Consul, CockroachDB, TiKV, YugabyteDB e o controlador KRaft do Kafka o usam. Ele divide o problema em três partes:

1. **Eleição de líder** — exatamente um líder por termo; todas as escritas passam por ele.
2. **Replicação do log** — o líder acrescenta comandos ao seu log e os replica para os seguidores.
3. **Segurança** — uma entrada confirmada por uma maioria (*committed*) nunca é perdida nem sobrescrita.

### Papéis e termos

Cada nó é um **seguidor** (*follower*), um **candidato** (*candidate*) ou o **líder** (*leader*). O tempo é dividido em **termos** (*terms*) numerados 1, 2, 3…, cada um começando com uma eleição; um termo tem **no máximo um líder**. Os termos funcionam como um relógio lógico ([Tempo e Relógios](../time-clocks/index.md#lamport)): qualquer nó que vê uma mensagem com termo maior que o seu atualiza o próprio termo e volta a ser seguidor — é assim que um líder desatualizado, ao acordar depois de uma pausa, descobre que foi substituído.

``` mermaid-sim
stateDiagram-v2
  state "Seguidor" as Follower
  state "Candidato" as Candidate
  state "Líder" as Leader
  [*] --> Follower
  Follower --> Candidate : election timeout (sem heartbeat)
  Candidate --> Leader : votos de uma maioria
  Candidate --> Follower : vê um líder ou um termo maior
  Candidate --> Candidate : votos divididos, novo timeout
  Leader --> Follower : vê um termo maior
```

### Eleição de líder

O líder envia **heartbeats** periódicos (mensagens `AppendEntries` vazias). Um seguidor que não ouve nada durante um **election timeout** supõe que o líder morreu, incrementa o termo, vota em si mesmo e pede votos aos outros:

``` mermaid-sim
sequenceDiagram
  participant N1 as nó 1 (seguidor)
  participant N2 as nó 2 (seguidor)
  participant N3 as nó 3 (líder antigo, congelado)
  Note over N1,N3: termo 4: o nó 3 para de enviar heartbeats
  N1->>N1: election timeout: termo 5, candidato, vota em si mesmo
  N1->>N2: RequestVote(term 5, last log index 812, term 4)
  N1->>N3: RequestVote(term 5, ...)
  N2-->>N1: voto concedido (meu log não é mais novo que o seu)
  Note over N1: 2 de 3 votos: líder do termo 5
  N1->>N2: AppendEntries(term 5, heartbeat)
  N1->>N3: AppendEntries(term 5, heartbeat)
  Note over N3: acorda, vê termo 5 > 4: volta a ser seguidor
```

Três regras a tornam segura:

- **Um voto por nó por termo** — então no máximo um candidato consegue reunir uma maioria em um termo.
- **Restrição de eleição** — um nó só vota em um candidato cujo log esteja **pelo menos tão atualizado** quanto o seu. Como toda entrada confirmada está em uma maioria, e o vencedor precisa de votos de uma maioria, o novo líder certamente tem todas as entradas confirmadas.
- **Election timeouts aleatórios** (o artigo sugere 150–300 ms) — se todos os seguidores dessem timeout juntos, dividiriam os votos para sempre; com timeouts aleatórios, normalmente um dispara primeiro e vence antes de os outros começarem.

Por quanto tempo as escritas ficam indisponíveis quando um líder morre? Aproximadamente **election timeout + uma rodada de votação**. Os padrões do etcd são heartbeat de 100 ms e election timeout de 1.000 ms[^3] (ajustados para cima por causa da latência entre zonas), então a queda de um líder significa cerca de um a dois segundos sem escritas — um número a lembrar quando o timeout de um cliente é menor do que isso.

### Replicação do log { #log-replication }

``` mermaid-sim
sequenceDiagram
  participant C as inventory
  participant L as líder
  participant F1 as seguidor 1
  participant F2 as seguidor 2
  C->>L: reservar A-12 para o fã 42
  L->>L: acrescenta ao log no índice 813 (termo 5)
  L->>F1: AppendEntries(index 813, prev = 812/term 4)
  L->>F2: AppendEntries(index 813, prev = 812/term 4)
  F1-->>L: OK (gravado em disco)
  Note over L: 2 de 3 têm a entrada: confirmada, aplica ao estado
  L-->>C: OK, assento reservado
  F2-->>L: OK (mais tarde)
  L->>F1: o próximo heartbeat leva o commit index 813
```

- O líder só responde ao cliente depois que uma **maioria** (contando ele mesmo) gravou a entrada de forma **durável**: entradas confirmadas sobrevivem à perda de qualquer minoria.
- Cada `AppendEntries` leva o índice e o termo da entrada anterior; um seguidor a rejeita se seu log não coincide ali, e o líder volta atrás até os logs concordarem, então sobrescreve o sufixo divergente e não confirmado do seguidor. Essa **correspondência de logs** (*log matching*) mantém todos os logs idênticos até o commit index.
- Os seguidores aprendem o **commit index** em mensagens posteriores e aplicam as entradas à sua própria máquina de estado.

!!! info "Leituras no Raft também não são de graça"
    Um líder que responde leituras a partir do seu estado local pode ser um líder **desatualizado** que ainda não percebeu um termo mais novo. Leituras linearizáveis precisam confirmar a liderança — com uma rodada de heartbeats para uma maioria (o *ReadIndex* do etcd) ou com um **lease de líder** baseado em tempo, que depende de uma deriva de relógio limitada. Servir leituras a partir de seguidores é mais rápido, mas só eventualmente consistente, a menos que o seguidor primeiro pergunte ao líder o commit index atual.

??? question "Pense antes: um cluster etcd de 5 nós espalhado por 3 zonas (2 + 2 + 1). A zona A, com 2 nós, cai. O cluster ainda aceita escritas? E se fosse 3 + 1 + 1 e caísse a zona com 3 nós?"

    No primeiro caso restam 3 nós — uma maioria de 5 —, então sim: um novo líder é eleito (se necessário) e as escritas continuam. No segundo caso restam só 2 nós, o que **não** é maioria de 5, então o cluster para de aceitar escritas, mesmo com 2 máquinas perfeitamente saudáveis. O posicionamento importa tanto quanto N: com 3 zonas, distribua da forma mais equilibrada possível para que **nenhuma zona sozinha tenha a maioria**.

### Paxos, em um parágrafo

O **Paxos** (Lamport, 1989/1998; "Paxos Made Simple", 2001)[^4] é o algoritmo de consenso original, com as mesmas garantias. Sua forma de decisão única concorda sobre um valor em duas fases (*prepare/promise*, depois *accept/accepted*) entre proponentes e aceitadores com cédulas numeradas; sistemas de produção rodam o **Multi-Paxos** — um líder estável que pula a primeira fase —, que se parece muito com o Raft. O Paxos é comprovado e amplamente usado (Chubby e Spanner, do Google), mas famoso por ser difícil de implementar; a contribuição do Raft não foram garantias novas, e sim uma estrutura que engenheiros conseguem seguir. O ZooKeeper usa um protocolo aparentado, o ZAB (*ZooKeeper Atomic Broadcast*).

---

## Quóruns em armazenamentos sem líder: R + W > N { #quorums }

Bancos sem líder da família Dynamo (Cassandra, ScyllaDB, Riak) usam quóruns **por requisição**, sem líder. Com **N** réplicas de cada chave, uma escrita espera **W** confirmações e uma leitura consulta **R** réplicas e fica com a versão mais nova:

| Parâmetro | Significado |
|---|---|
| **N** | Número de réplicas de cada chave |
| **W** | Réplicas que precisam confirmar uma escrita |
| **R** | Réplicas que precisam responder a uma leitura |
| **Condição de sobreposição** | **R + W > N** — todo conjunto de leitura intercepta todo conjunto de escrita |

Quando **R + W > N**, pelo menos uma réplica em qualquer conjunto de leitura tem a última escrita confirmada. Com **N = 3**:

| Configuração | W | R | R + W > N? | Comportamento |
|---|---|---|---|---|
| escrita `ONE`, leitura `ONE` | 1 | 1 | Não | O mais rápido; leituras podem estar desatualizadas; disponível com 2 nós fora |
| escrita `QUORUM`, leitura `QUORUM` | 2 | 2 | **Sim** | Leituras veem a última escrita confirmada; tolera 1 nó fora |
| escrita `ALL`, leitura `ONE` | 3 | 1 | Sim | Leituras rápidas, mas um nó fora bloqueia toda escrita |
| escrita `ONE`, leitura `ALL` | 1 | 3 | Sim | Escritas rápidas, mas um nó fora bloqueia toda leitura |

Três mecanismos fazem as réplicas sem líder convergirem: **read repair** (uma leitura que vê uma versão antiga grava de volta a mais nova), **hinted handoff** (uma escrita destinada a um nó morto fica com outro e é entregue depois — um *quórum relaxado* (*sloppy quorum*) que quebra a garantia de sobreposição nesse meio-tempo) e **anti-entropia** (comparação das réplicas em segundo plano usando árvores de Merkle)[^5].

!!! warning "R + W > N é necessário, não suficiente"
    A sobreposição garante que uma leitura *contata* uma réplica com a última escrita. Ela não torna o armazenamento linearizável: escritas concorrentes, uma escrita que chegou a menos de W réplicas e foi reportada como falha (mas ficou em algumas), quóruns relaxados e LWW com relógios defasados produzem anomalias. Armazenamentos por quórum oferecem consistência **ajustável**, não consenso. Use um armazenamento baseado em consenso quando precisar de uma única ordem acordada.

---

## Leases, locks e fencing tokens { #fencing }

Um uso comum de consenso é um **lock distribuído** ou **lease**: "só uma réplica do `scheduler` envia o push das 09:55 *as vendas abrem em breve*". Você obtém um lease do etcd/ZooKeeper/Consul com um tempo de vida e o renova enquanto estiver vivo. Mas quem tem o lock pode **pausar** — uma coleta de lixo longa, a migração de uma VM — e continuar trabalhando depois de o lease expirar e outro processo tê-lo obtido[^6]:

``` mermaid-sim
sequenceDiagram
    participant A as worker A
    participant LK as serviço de lock (etcd)
    participant B as worker B
    participant S as armazenamento
    A->>LK: obtém o lease
    LK-->>A: concedido, fencing token 33
    Note over A: pausa de GC de 15 s: o lease expira
    B->>LK: obtém o lease
    LK-->>B: concedido, fencing token 34
    B->>S: escrita (token 34)
    S-->>B: OK, maior token visto = 34
    Note over A: acorda, ainda acha que tem o lock
    A->>S: escrita (token 33)
    S-->>A: rejeitada: 33 < 34
```

A solução é um **fencing token**: um número que aumenta a cada concessão (a revisão do etcd, o `zxid` do ZooKeeper), enviado com toda escrita; o armazenamento rejeita qualquer token menor do que o maior que já viu. A mesma ideia — uma *época* ou *termo* monotonicamente crescente — protege o failover do PostgreSQL da história de abertura: o primário antigo, isolado (suas escritas rejeitadas, ou sua máquina desligada à força — "STONITH", *shoot the other node in the head*), não consegue corromper o novo.

```sql title="fenced-write.sql"
-- The storage enforces the fence: a write carrying an old token changes nothing
UPDATE scheduled_jobs
   SET last_run_at = now(), fencing_token = :token
 WHERE job_id = 'onsale-reminder-42'
   AND fencing_token <= :token;     -- 0 rows updated → a newer token exists: we are a stale holder
```

---

## Na prática: use, não construa

| Ferramenta | Para que você a usa | Consenso |
|---|---|---|
| **etcd** | Estado do Kubernetes, eleição de líder, configuração, locks | Raft |
| **Apache ZooKeeper** | Coordenação de sistemas da era Hadoop/Kafka mais antiga | ZAB |
| **Consul** | Descoberta de serviços, configuração chave-valor, locks | Raft |
| **Kafka (KRaft)** | Metadados do cluster e eleição do controlador; o modo ZooKeeper foi removido no Kafka 4.0 | Baseado em Raft |
| **Patroni** (para PostgreSQL) | Failover automático do primário, com a chave do líder no etcd/Consul/ZooKeeper | Delega ao DCS |
| **Spanner, CockroachDB, YugabyteDB, TiDB** | SQL com consenso por faixa de dados | Paxos (Spanner) / Raft |

!!! example "BoxOffice: quem é o primário?"
    O PostgreSQL do `inventory` roda sob o **Patroni**, com um cluster **etcd** de 3 nós espalhado por 3 zonas de disponibilidade. O primário detém uma **chave de líder** no etcd com TTL de ~30 s (o padrão do Patroni), renovada a cada ~10 s. Se ele para de renovar — crash, congelamento, perda de rede —, a chave expira, o standby síncrono mais saudável a obtém (um compare-and-set atômico no etcd: só um pode vencer), promove a si mesmo, e os clientes seguem o novo líder pelo endpoint do serviço. Um primário antigo que acorda descobre que não detém mais a chave e **se rebaixa** (o Patroni também pode usar um watchdog para reiniciar a máquina). A decisão do assento em si continua sendo um simples `UPDATE … WHERE status = 'FREE'` no único primário — o consenso é usado **apenas** para decidir qual nó é esse.

!!! tip "Na entrevista"
    Use consenso como um **componente**, não como um tema a ser deduzido de novo. Diga: *"a eleição de líder e os metadados do cluster ficam no etcd/ZooKeeper (Raft, 3 ou 5 nós em 3 zonas); o caminho dos dados fica em um único líder por shard."* Saiba os números: N nós toleram ⌊(N−1)/2⌋ falhas; um failover de líder custa cerca de um election timeout (~1 s nos padrões do etcd); toda escrita confirmada paga uma ida e volta até uma maioria. Se mencionar locks, mencione **fencing tokens** — é a pergunta de acompanhamento que separa os candidatos.

!!! warning "Armadilhas"
    - **Implementar Paxos ou Raft por conta própria** para uma aplicação. Use etcd, ZooKeeper, Consul ou as garantias do próprio banco (uma restrição de unicidade, `SELECT … FOR UPDATE`, um advisory lock).
    - **Passar dados em volume pelo consenso.** Toda escrita passa por um líder e espera uma maioria; armazenamentos de consenso guardam dados pequenos e críticos (líderes, configuração, locks) — não o catálogo.
    - **Clusters de tamanho par e posicionamento ruim**: 4 nós toleram o mesmo que 3; uma zona que detém a maioria é um ponto único de falha.
    - **Locks sem fencing**: um processo pausado acabará escrevendo depois de perder o lease.
    - **Timeouts de cliente menores que um failover**: um timeout de 500 ms no cliente contra um armazenamento que precisa de ~1–2 s para eleger um líder transforma todo failover em uma rajada de erros (e retries).

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    MAJ["quóruns de maioria<br/>sem split brain"] --> RAFT["Raft / Paxos<br/>log replicado"]
    RAFT --> ETCD["etcd · ZooKeeper · KRaft"]
    ETCD --> LE["eleição de líder<br/>(failover do banco, scheduler)"]
    ETCD --> LOCK["leases e locks"]
    LOCK --> FT["fencing tokens"]
    RAFT --> NEWSQL["Spanner · CockroachDB<br/>(consenso por faixa)"]
    NEWSQL --> TX2["2PC sobre grupos de consenso<br/>→ Transações Distribuídas"]
    Q["R + W > N<br/>quóruns sem líder"] --> TUNE["consistência ajustável<br/>(Cassandra, Dynamo)"]
    TERMS["termos / épocas"] --> FT
    TERMS -.-> CLK["relógios lógicos<br/>→ Tempo e Relógios"]
```

**Componentes da paleta que dependem de consenso:** [`kafka`](../../../reference/components/messaging/index.md#kafka) (controlador KRaft, líderes de partição) · [`sql`](../../../reference/components/storage/index.md#sql) (failover com Patroni + etcd) · [`nosql`](../../../reference/components/storage/index.md#nosql) (quóruns) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (um líder executa os jobs). **Continua em:** [Transações Distribuídas](../transactions/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md) (etcd), [Compute — trabalho assíncrono](../../compute/async-work/index.md) (eleição de líder do scheduler).

## Pontos-chave

- O **consenso** faz nós concordarem sobre um valor — na prática, um **log** — apesar de falhas; ele sustenta eleição de líder, locks, configuração e bancos de dados fortemente consistentes.
- **FLP**: nenhum algoritmo determinístico sempre termina em um sistema assíncrono; Paxos e Raft são sempre **seguros** e usam timeouts para a **vivacidade**.
- **Maiorias se sobrepõem**: N nós toleram ⌊(N−1)/2⌋ crashes; use 3 ou 5, espalhados de modo que nenhuma zona tenha a maioria; o lado minoritário de uma partição para (sem split brain).
- **Raft**: termos, election timeouts aleatórios, um voto por termo, restrição de eleição, confirmação depois que uma maioria grava.
- **Quóruns sem líder** precisam de **R + W > N** para haver sobreposição, mas dão consistência ajustável, não linearizabilidade.
- Leases precisam de **fencing tokens**; e, acima de tudo: **use** um serviço de coordenação comprovado, não construa um.

---

[^1]: FISCHER, M.; LYNCH, N.; PATERSON, M. [Impossibility of Distributed Consensus with One Faulty Process](https://dl.acm.org/doi/10.1145/3149.214121){target="_blank"}. Journal of the ACM, 1985.
[^2]: ONGARO, D.; OUSTERHOUT, J. [In Search of an Understandable Consensus Algorithm](https://raft.github.io/raft.pdf){target="_blank"}. USENIX ATC, 2014. Visualização interativa: [raft.github.io](https://raft.github.io/){target="_blank"}.
[^3]: ETCD. [Tuning](https://etcd.io/docs/v3.5/tuning/){target="_blank"} — intervalo de heartbeat e election timeout.
[^4]: LAMPORT, L. [Paxos Made Simple](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf){target="_blank"}. ACM SIGACT News, 2001.
[^5]: DECANDIA, G. et al. [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf){target="_blank"}. SOSP, 2007.
[^6]: KLEPPMANN, M. [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html){target="_blank"}, 2016.
