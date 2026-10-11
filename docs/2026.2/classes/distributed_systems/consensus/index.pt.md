
Quando a loja roda no Kubernetes ([Hands-on 5](../../../hands-on/5/index.md)), todo o estado do cluster — quais pods existem, qual imagem cada Deployment roda, quais Secrets estão definidos — fica no **etcd**. Um cluster de produção roda três ou cinco membros do etcd para que o cluster sobreviva à perda de uma máquina. Mas a replicação traz uma pergunta: se dois comandos `kubectl apply` chegam a dois membros diferentes no mesmo instante, e um dos membros cai em seguida, **qual versão é a verdade**, e como os sobreviventes concordam sobre ela sem um árbitro? Responder a essa pergunta é o problema do consenso.

**Consenso** é o problema de fazer um grupo de nós distribuídos concordar sobre um único valor — apesar de mensagens atrasadas, perdidas ou reordenadas, e apesar da falha de alguns nós. Ele é a primitiva fundamental para eleição de líder, locks distribuídos, máquinas de estado replicadas e repositórios de configuração consistentes.

Uma **máquina de estado replicada** é o uso mais comum: todo nó começa no mesmo estado e aplica os mesmos comandos **na mesma ordem** (um *log*), de modo que todo nó termina no mesmo estado. O consenso é o que faz todos os nós concordarem sobre a próxima entrada do log.

Um algoritmo de consenso correto precisa garantir dois tipos de propriedade:

**Safety** (segurança: "nada de ruim acontece")
: Todos os nós que decidem, decidem o **mesmo** valor, e esse valor foi de fato proposto por alguém.

**Liveness** (vivacidade: "algo de bom acaba acontecendo")
: Todo nó que não falhou **acaba** decidindo.

---

## Por que o consenso é difícil: a impossibilidade FLP

O **Teorema da Impossibilidade FLP** (Fischer, Lynch, Paterson, 1985)[^1] prova que, em um sistema distribuído puramente assíncrono (sem limite superior para o atraso das mensagens ou para o tempo de processamento) em que até mesmo um único nó pode cair, **nenhum algoritmo determinístico consegue garantir que o consenso seja sempre alcançado**. Alguma execução — uma ordenação azarada de atrasos — pode manter o algoritmo indeciso para sempre.

A implicação é que todo algoritmo de consenso prático faz uma concessão:

- Ele assume *sincronia parcial*: a rede pode se comportar mal por um tempo, mas os atrasos acabam ficando limitados — e ele só garante progresso (liveness) durante esses períodos "bons"; ou
- Ele usa **aleatorização**, de modo que termina com probabilidade 1; ou
- Ele enfraquece o problema (por exemplo, aceitando que pode ficar bloqueado para sempre em condições adversas).

Paxos e Raft seguem o primeiro caminho: eles **nunca violam a safety**, mesmo quando a rede está caótica, e progridem sempre que a rede está "bem-comportada o suficiente".

Sistemas reais lidam com isso usando **timeouts** como substituto para a detecção de falhas — aceitando que um nó lento é indistinguível de um nó que caiu (veja [os três problemas de raiz](../index.md#the-three-root-problems)).

---

## Modelos de falha

Antes de escolher um algoritmo de consenso, você precisa saber quais falhas tolerar:

| Modelo | O que um nó defeituoso faz | Custo da tolerância |
|---|---|---|
| **Crash-stop** | O nó para e nunca se recupera | O mais fácil de tratar — uma maioria de N nós tolera ⌊(N-1)/2⌋ falhas |
| **Crash-recovery** | O nó para, mas pode reiniciar com estado persistente | Exige logs duráveis; os algoritmos precisam lidar com nós que voltam ao grupo |
| **Bizantino** | O nó se comporta de forma arbitrária — mensagens incorretas, contraditórias, maliciosas | O mais difícil — exige 3f+1 nós para tolerar f falhas bizantinas |

A maioria dos algoritmos usados em datacenters assume crash-stop ou crash-recovery. A tolerância a falhas bizantinas (BFT) é usada em blockchain e em sistemas críticos de segurança.

---

## Maiorias: por que clusters têm 3 ou 5 nós

Paxos, Raft e ZooKeeper se apoiam na mesma ideia: uma decisão só é válida se uma **maioria** (mais da metade) dos N nós concordar. Duas maiorias quaisquer do mesmo cluster **compartilham pelo menos um nó**, então duas decisões conflitantes nunca conseguem reunir, ambas, uma maioria — esse nó compartilhado teria de votar nas duas.

| Tamanho do cluster N | Maioria (⌊N/2⌋ + 1) | Falhas toleradas (⌊(N-1)/2⌋) |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | **1** |
| 4 | 3 | 1 |
| 5 | 3 | **2** |
| 7 | 4 | 3 |

!!! tip "Use um número ímpar de nós"
    Passar de 3 para 4 nós aumenta o custo e acrescenta mais uma máquina que pode falhar, mas **não tolera nenhuma falha a mais**. É por isso que clusters de etcd, ZooKeeper e Consul têm 3 ou 5 nós. Um cluster de 2 nós é pior do que um único nó: perder qualquer um dos dois o paralisa.

Uma maioria também protege contra o **split brain** — duas partes de um cluster particionado acreditando, ambas, que estão no comando. Com 5 nós divididos em 3/2, só o lado com 3 consegue formar uma maioria:

``` mermaid-sim
flowchart LR
    subgraph maj ["Lado da maioria (3 de 5)"]
        n1[Nó 1 líder] --- n2[Nó 2]
        n2 --- n3[Nó 3]
    end
    subgraph min ["Lado da minoria (2 de 5)"]
        n4[Nó 4] --- n5[Nó 5]
    end
    n3 -.-|partição| n4
    maj -->|"consegue eleger e confirmar"| ok([continua aceitando escritas])
    min -->|"não alcança 3 votos"| ko([rejeita escritas])
```

---

## Paxos

O Paxos[^2], apresentado por Leslie Lamport (publicado em 1998 e explicado de forma mais simples em 2001), é o algoritmo de consenso clássico para falhas por parada em redes assíncronas. Ele opera em duas fases e tolera até ⌊(N-1)/2⌋ falhas com N nós. Os nós desempenham três papéis: os **proposers** (proponentes) sugerem valores, os **acceptors** (aceitadores) votam neles e os **learners** (aprendizes) descobrem o valor decidido.

``` mermaid-sim
sequenceDiagram
  participant P as Proposer
  participant A1 as Acceptor 1
  participant A2 as Acceptor 2
  participant A3 as Acceptor 3

  Note over P,A3: Fase 1 — Prepare
  P->>A1: Prepare(n)
  P->>A2: Prepare(n)
  P->>A3: Prepare(n)
  A1-->>P: Promise(n, -)
  A2-->>P: Promise(n, -)
  A3-->>P: Promise(n, -)

  Note over P,A3: Fase 2 — Accept
  P->>A1: Accept(n, value)
  P->>A2: Accept(n, value)
  P->>A3: Accept(n, value)
  A1-->>P: Accepted
  A2-->>P: Accepted
```

**Fase 1 (Prepare):** o proposer escolhe um número de rodada (ballot) `n` único e o envia aos acceptors. Cada acceptor promete não aceitar nenhuma proposta com número menor e responde com a proposta de maior número que ele **já aceitou**, se houver (o `-` no diagrama significa "nenhuma").

**Fase 2 (Accept):** assim que uma maioria prometeu, o proposer envia `Accept(n, value)`. O valor **não é livre**: se alguma promessa trouxe um valor aceito anteriormente, o proposer precisa propor o valor da proposta de maior número; só se nenhuma trouxe é que ele pode propor o seu próprio. Os acceptors aceitam se, nesse meio-tempo, não tiverem prometido uma rodada maior. O valor é **escolhido** assim que uma maioria o aceita — no diagrama, dois de três acceptors bastam.

A regra "adote o valor aceito anteriormente" é o que torna o Paxos seguro: assim que um valor pode ter sido escolhido, todo proposer posterior é obrigado a propor esse mesmo valor.

O Paxos é notoriamente difícil de implementar corretamente. Ele não especifica eleição de líder, compactação do log nem mudanças de membros — cada implementação de produção precisa resolver essas questões separadamente.

---

## Raft { #raft }

O Raft[^3] (Ongaro e Ousterhout, 2014) foi projetado explicitamente para ser compreensível. Ele decompõe o problema do consenso em três subproblemas relativamente independentes:

1. **Eleição de líder** — um nó se torna líder; todas as escritas passam por ele.
2. **Replicação do log** — o líder acrescenta entradas ao seu log e as replica para os seguidores (followers).
3. **Safety** — uma entrada confirmada (committed) nunca é sobrescrita; os líderes só confirmam depois que um quórum reconhece a entrada.

``` mermaid-sim
stateDiagram-v2
  [*] --> Follower
  Follower --> Candidate : timeout de eleição
  Candidate --> Leader : vence a eleição (voto da maioria)
  Candidate --> Follower : vê um term maior
  Leader --> Follower : vê um term maior
```

Os **terms** (mandatos) funcionam como relógios lógicos (veja [Tempo e ordenação](../index.md#time-and-ordering-logical-clocks)): cada term começa com uma eleição, e há no máximo um líder por term. Um nó que recebe uma mensagem de um term maior volta imediatamente a ser follower.

### Sequência da eleição de líder

``` mermaid-sim
sequenceDiagram
  participant N1 as Nó 1 (Candidate)
  participant N2 as Nó 2 (Follower)
  participant N3 as Nó 3 (Follower)

  Note over N1,N3: Term 1 — o líder está em silêncio, o timeout de eleição dispara no Nó 1
  N1->>N1: incrementa o term para 2, vota em si mesmo
  N1->>N2: RequestVote(term=2, lastLogIndex=5)
  N1->>N3: RequestVote(term=2, lastLogIndex=5)
  N2-->>N1: VoteGranted(term=2)
  N3-->>N1: VoteGranted(term=2)
  Note over N1: maioria (2/3) — torna-se Leader do term 2
  N1->>N2: AppendEntries(term=2, heartbeat)
  N1->>N3: AppendEntries(term=2, heartbeat)
```

Um candidato só vence a eleição se receber votos de uma maioria dos nós **e** se o seu log estiver pelo menos tão atualizado quanto os logs dos eleitores (a *restrição de eleição*). Isso garante que o novo líder já tenha todas as entradas confirmadas. Cada nó vota em no máximo um candidato por term.

Os timeouts de eleição são **aleatórios** (o artigo do Raft sugere 150–300 ms): se todos os followers estourassem o timeout no mesmo instante, todos virariam candidatos, dividiriam os votos e ninguém venceria. Com timeouts aleatórios, normalmente um nó estoura o timeout primeiro e vence antes que os outros comecem.

O Raft é usado no **etcd** (o armazenamento chave-valor que sustenta o Kubernetes), no **CockroachDB** e no **Consul**.

### Replicação do log

``` mermaid-sim
sequenceDiagram
  participant C as Cliente
  participant L as Leader
  participant F1 as Follower 1
  participant F2 as Follower 2

  C->>L: Write x=5
  L->>F1: AppendEntries(x=5)
  L->>F2: AppendEntries(x=5)
  F1-->>L: OK
  F2-->>L: OK
  Note over L: a maioria confirmou — commit
  L-->>C: Success
```

O líder só responde ao cliente depois que uma maioria dos nós (contando ele mesmo) gravou a entrada de forma durável. Como qualquer líder futuro precisa receber votos de uma maioria, e qualquer maioria contém pelo menos um nó que tem a entrada, uma entrada confirmada sobrevive à falha de qualquer **minoria** dos nós.

!!! info "Experimente"
    A [visualização do Raft](https://raft.github.io/){target="_blank"}[^4] permite parar nós e assistir a uma nova eleição, e [The Secret Lives of Data](https://thesecretlivesofdata.com/raft/){target="_blank"}[^5] percorre o Raft passo a passo.

---

## Sistemas de quórum

Um **quórum** é o número mínimo de nós que precisam participar de uma operação para que ela seja válida. Os quóruns são o mecanismo que torna consistentes os pares leitura/escrita sem exigir a participação de todos os nós. A maioria do Raft é um tipo de quórum; bancos de dados sem líder, como Cassandra e DynamoDB, usam diretamente **quóruns de leitura e de escrita**.

Para um sistema com **N** réplicas:

| Operação | Requisito |
|---|---|
| Quórum de escrita (W) | W nós precisam confirmar a escrita |
| Quórum de leitura (R) | R nós precisam responder à leitura |
| **Condição de consistência** | **W + R > N** |

Quando W + R > N, todo quórum de leitura se sobrepõe a todo quórum de escrita — pelo menos um nó do conjunto de leitura tem a escrita mais recente.

**Exemplo:** N=5, W=3, R=3 → W + R = 6 > 5 ✅

**Contraexemplo:** N=3, W=1, R=1 → W + R = 2 ≤ 3 ❌ — uma leitura pode atingir apenas a réplica que perdeu a escrita.

A **consistência ajustável do Cassandra** expõe W e R como parâmetros por requisição (`QUORUM`, `ALL`, `ONE`), permitindo a quem chama escolher entre consistência e latência.

| Configuração (N = 3) | W | R | W + R > N? | Efeito |
|---|---|---|---|---|
| escrita `ONE`, leitura `ONE` | 1 | 1 | ❌ | a mais rápida; leituras podem vir desatualizadas |
| escrita `QUORUM`, leitura `QUORUM` | 2 | 2 | ✅ | as leituras veem a última escrita confirmada; tolera 1 nó fora do ar |
| escrita `ALL`, leitura `ONE` | 3 | 1 | ✅ | leituras rápidas, mas um único nó fora do ar bloqueia todas as escritas |

!!! warning "W + R > N é necessário, mas não suficiente"
    A sobreposição garante que uma leitura *contate* um nó com a escrita mais recente, mas restam casos-limite: duas escritas concorrentes, uma escrita que teve sucesso em menos de W nós e foi reportada como falha, ou quóruns "sloppy" (frouxos), que aceitam escritas em nós substitutos durante falhas. Por isso, bancos de dados baseados em quórum costumam ser descritos como oferecendo consistência *ajustável*, e não linearizabilidade.

---

## Consistência eventual e CRDTs { #eventual-consistency-and-crdts }

A **consistência eventual** é a garantia oferecida pelos sistemas AP: se nenhuma atualização nova for feita, todas as réplicas acabam convergindo para o mesmo valor. Ela não especifica *quando*.

Estratégias de convergência:

- **Last-Write-Wins (LWW, a última escrita vence):** cada escrita carrega um timestamp; o maior timestamp vence. Simples, mas arrisca perder escritas concorrentes — e depende de relógios que derivam (veja [Ausência de relógio global](../index.md#3-no-global-clock)).
- **Relógios vetoriais:** rastreiam a causalidade entre operações; detectam escritas concorrentes para uma resolução explícita de conflitos (veja [relógios lógicos](../index.md#time-and-ordering-logical-clocks)).
- **CRDTs (Conflict-Free Replicated Data Types, tipos de dados replicados livres de conflito):**[^6] estruturas de dados projetadas matematicamente para que atualizações concorrentes sempre se combinem sem conflito. Exemplos: contadores, conjuntos (só de adição), registradores.

O truque por trás de um CRDT é uma função de **merge** (combinação) que é comutativa, associativa e idempotente: as réplicas podem trocar seu estado em qualquer ordem, quantas vezes for, e ainda assim terminam iguais. O mais simples é o contador que só cresce (*G-Counter*), por exemplo o "número de visualizações de um produto" contado em vários nós:

```java
// A G-Counter CRDT: each node increments only its own slot
class GCounter {
    private final long[] counts;   // one slot per node
    private final int me;          // this node's index

    GCounter(int nodes, int me) { this.counts = new long[nodes]; this.me = me; }

    void increment() { counts[me]++; }

    long value() { return Arrays.stream(counts).sum(); }

    // merge = element-wise max: order and repetition do not matter
    void merge(GCounter other) {
        for (int i = 0; i < counts.length; i++)
            counts[i] = Math.max(counts[i], other.counts[i]);
    }
}
```

Se o nó 0 contou 3 visualizações (`[3, 0]`) e o nó 1 contou 2 (`[0, 2]`), ambos combinam para `[3, 2]` e reportam 5 — nenhuma atualização se perde, e nenhuma coordenação foi necessária. Usar um único número compartilhado com "a última escrita vence" teria reportado 3 ou 2.

CRDTs são usados nos tipos de dados do Riak, nos bancos Active-Active do Redis Enterprise e em bibliotecas de edição colaborativa como Automerge e Yjs. O carrinho de compras do Dynamo da Amazon (2007) usava uma ideia parecida: versões divergentes do carrinho, detectadas com relógios vetoriais, eram combinadas por união de conjuntos.

---

## Na prática: use, não construa

| Ferramenta | Papel | Algoritmo de consenso |
|---|---|---|
| **etcd** | Armazenamento chave-valor, configuração do Kubernetes | Raft |
| **Apache ZooKeeper** | Coordenação, eleição de líder | ZAB (Zookeeper Atomic Broadcast, derivado do Paxos) |
| **Consul** | Descoberta de serviços, locks distribuídos | Raft |
| **Apache Kafka** | Log distribuído, mensageria | KRaft (baseado em Raft); o modo ZooKeeper foi removido no Kafka 4.0 (2025) |

O setup do Kafka do [Hands-on 9](../../../hands-on/9/index.md) roda o Kafka 4 em modo KRaft: não há container do ZooKeeper — a coordenação roda dentro do próprio Kafka, em seu próprio quórum Raft.

!!! warning "Armadilhas"
    - **Não implemente Paxos nem Raft por conta própria** em uma aplicação. Delegue a um sistema comprovado: etcd, ZooKeeper, Consul ou o banco de dados (um `SELECT … FOR UPDATE`, uma restrição de unicidade, um advisory lock).
    - **Consenso não é de graça.** Toda escrita espera uma ida e volta até a maioria e passa por um único líder, por isso sistemas de consenso guardam dados pequenos e críticos (configuração, liderança, locks) — não o seu catálogo de produtos.
    - **Um lock não é uma garantia.** Um processo que detém um lock distribuído pode pausar (coleta de lixo, migração de VM) e acordar depois que sua concessão (lease) expirou, enquanto outro processo já detém o lock. Proteja o recurso com um *fencing token* (um número que cresce a cada concessão do lock e é verificado pelo armazenamento).

---

## Conexões

- [Teorema CAP](../cap/index.md) — armazenamentos baseados em consenso (etcd, ZooKeeper) são os sistemas CP clássicos.
- [Hands-on 5](../../../hands-on/5/index.md) — o Kubernetes guarda todo o seu estado no etcd, replicado com Raft.
- [Hands-on 9](../../../hands-on/9/index.md) e [Arquitetura orientada a eventos](../../event_driven/index.md) — o Kafka replica as partições com um líder por partição.

## Pontos-chave

- O consenso faz os nós concordarem sobre um valor (ou uma ordem de log) apesar de falhas; ele está por trás da eleição de líder, dos locks e das máquinas de estado replicadas.
- **FLP**: em um sistema totalmente assíncrono, nenhum algoritmo determinístico sempre termina; os algoritmos reais mantêm a **safety** sempre e dependem de timeouts para a **liveness**.
- **Maiorias** se sobrepõem, o que impede o split brain; N nós toleram ⌊(N-1)/2⌋ falhas por parada, então use 3 ou 5 nós.
- **Raft**: timeouts de eleição aleatórios, um líder por term, commit depois que a maioria confirma; usado pelo etcd, pelo Consul e pelo Kafka (KRaft).
- Quóruns exigem **W + R > N**; sistemas AP convergem com LWW, relógios vetoriais ou **CRDTs** com um merge comutativo e idempotente.

---

[^1]: FISCHER, M.; LYNCH, N.; PATERSON, M. [Impossibility of Distributed Consensus with One Faulty Process](https://dl.acm.org/doi/10.1145/3149.214121){target="_blank"}. JACM, 1985.
[^2]: LAMPORT, L. [Paxos Made Simple](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf){target="_blank"}. ACM SIGACT News, 2001.
[^3]: ONGARO, D.; OUSTERHOUT, J. [In Search of an Understandable Consensus Algorithm (Raft)](https://raft.github.io/raft.pdf){target="_blank"}. USENIX ATC, 2014.
[^4]: [Raft Visualization](https://raft.github.io/){target="_blank"} — animação interativa da eleição de líder e da replicação do log.
[^5]: [The Secret Lives of Data: Raft](https://thesecretlivesofdata.com/raft/){target="_blank"} — uma visualização narrativa envolvente do funcionamento do Raft e de suas decisões de projeto.
[^6]: SHAPIRO, M. et al. [Conflict-free Replicated Data Types](https://inria.hal.science/inria-00609399){target="_blank"}. SSS, 2011.
