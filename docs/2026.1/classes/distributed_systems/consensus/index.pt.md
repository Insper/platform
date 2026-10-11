
**Consenso** é o problema de fazer um grupo de nós distribuídos concordar sobre um único valor — apesar de mensagens atrasadas, perdidas ou fora de ordem, e apesar de alguns nós falharem. É a primitiva fundamental para eleição de líder, locks distribuídos, máquinas de estado replicadas e repositórios de configuração consistentes.

---

## Por que o consenso é difícil: a impossibilidade FLP

O **Teorema da Impossibilidade FLP** (Fischer, Lynch, Paterson, 1985)[^1] prova que, em um sistema distribuído puramente assíncrono com um único nó defeituoso que seja, nenhum algoritmo consegue garantir consenso em tempo limitado.

A implicação é que todo algoritmo de consenso prático faz um trade-off:
- Ou assume *sincronia parcial* (os atrasos das mensagens são, em algum momento, limitados), ou
- Sacrifica a vivacidade (liveness) — pode ficar bloqueado para sempre em condições adversas —, ou
- Sacrifica a segurança (safety) — pode produzir resultados inconsistentes em casos raros.

Sistemas reais lidam com isso usando **timeouts** como aproximação para a detecção de falhas — aceitando que um nó lento é indistinguível de um nó que caiu.

---

## Modelos de falha

Antes de escolher um algoritmo de consenso, você precisa saber quais falhas tolerar:

| Modelo | O que um nó defeituoso faz | Custo de tolerância |
|---|---|---|
| **Crash-stop** | O nó para e nunca se recupera | O mais fácil de tratar — uma maioria de N nós tolera ⌊(N-1)/2⌋ falhas |
| **Crash-recovery** | O nó para, mas pode reiniciar com estado persistente | Exige logs duráveis; os algoritmos precisam lidar com nós que voltam ao grupo |
| **Bizantino** | O nó se comporta de forma arbitrária — mensagens incorretas, equivocação, malícia | O mais difícil — exige 3f+1 nós para tolerar f falhas bizantinas |

A maioria dos algoritmos de datacenter assume crash-stop ou crash-recovery. A tolerância a falhas bizantinas (BFT) é usada em blockchain e em sistemas críticos de segurança.

---

## Paxos

O Paxos[^2], apresentado por Leslie Lamport (1998), foi o primeiro algoritmo de consenso prático para falhas crash-stop em redes assíncronas. Ele opera em duas fases e tolera até ⌊(N-1)/2⌋ falhas com N nós.

``` mermaid
sequenceDiagram
  participant P as Proponente
  participant A1 as Aceitador 1
  participant A2 as Aceitador 2
  participant A3 as Aceitador 3

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

**Fase 1 (Prepare):** o proponente envia um número de votação `n` a um quórum de aceitadores. Cada aceitador promete não aceitar nenhuma proposta com número menor.

**Fase 2 (Accept):** o proponente envia seu valor ao quórum. Os aceitadores aceitam se, nesse meio-tempo, não tiverem prometido uma votação de número maior.

O Paxos é notoriamente difícil de implementar corretamente. Ele não especifica eleição de líder, compactação de log nem mudanças de membros — cada implementação de produção precisa resolver essas questões separadamente.

---

## Raft

O Raft[^3] (Ongaro e Ousterhout, 2014) foi projetado explicitamente para ser compreensível. Ele decompõe o problema do consenso em três subproblemas relativamente independentes:

1. **Eleição de líder** — um nó se torna líder; todas as escritas passam por ele.
2. **Replicação de log** — o líder acrescenta entradas ao seu log e as replica para os seguidores.
3. **Segurança** — uma entrada confirmada (committed) nunca é sobrescrita; os líderes só confirmam depois que um quórum reconhece a entrada.

``` mermaid
stateDiagram-v2
  [*] --> Follower
  Follower --> Candidate : timeout de eleição
  Candidate --> Leader : vence a eleição (maioria dos votos)
  Candidate --> Follower : vê um termo maior
  Leader --> Follower : vê um termo maior
```

Os **termos** funcionam como relógios lógicos: cada termo começa com uma eleição. Um nó que recebe uma mensagem de um termo maior imediatamente volta a ser seguidor (follower).

O Raft é usado no **etcd** (o armazenamento chave-valor que sustenta o Kubernetes), no **CockroachDB** e no **Consul**.

### Replicação de log

``` mermaid
sequenceDiagram
  participant C as Cliente
  participant L as Líder
  participant F1 as Seguidor 1
  participant F2 as Seguidor 2

  C->>L: Escreve x=5
  L->>F1: AppendEntries(x=5)
  L->>F2: AppendEntries(x=5)
  F1-->>L: OK
  F2-->>L: OK
  Note over L: Maioria confirmou — commit
  L-->>C: Sucesso
```

O líder só responde ao cliente depois que a maioria dos nós gravou a entrada de forma durável. Isso garante que a entrada sobreviva à falha de qualquer nó individual.

---

## Sistemas de quórum

Um **quórum** é o número mínimo de nós que precisam participar de uma operação para que ela seja válida. Quóruns são o mecanismo que torna pares de leitura/escrita consistentes sem exigir a participação de todos os nós.

Para um sistema com **N** réplicas:

| Operação | Requisito |
|---|---|
| Quórum de escrita (W) | W nós precisam confirmar a escrita |
| Quórum de leitura (R) | R nós precisam responder à leitura |
| **Condição de consistência** | **W + R > N** |

Quando W + R > N, todo quórum de leitura se sobrepõe a todo quórum de escrita — pelo menos um nó do conjunto de leitura tem a escrita mais recente.

**Exemplo:** N=5, W=3, R=3 → W + R = 6 > 5 ✅

A **consistência ajustável do Cassandra** expõe W e R como parâmetros por requisição (`QUORUM`, `ALL`, `ONE`), permitindo que quem chama escolha o equilíbrio entre consistência e latência.

---

## Consistência eventual e CRDTs

A **consistência eventual** é a garantia oferecida pelos sistemas AP: se nenhuma nova atualização for feita, todas as réplicas acabarão convergindo para o mesmo valor. Ela não especifica *quando*.

Estratégias de convergência:

- **Last-Write-Wins (LWW):** cada escrita carrega um timestamp; vence o maior timestamp. Simples, mas corre o risco de perder escritas concorrentes.
- **Relógios vetoriais:** rastreiam a causalidade entre operações; detectam escritas concorrentes para resolução explícita de conflitos.
- **CRDTs (Conflict-Free Replicated Data Types):** estruturas de dados projetadas matematicamente para que atualizações concorrentes sempre se combinem sem conflito. Exemplos: contadores, conjuntos (somente adição), registradores.

```java
// A G-Counter CRDT: each node increments its own slot
// Total = sum of all slots — always convergent
long[] counters = new long[nodeCount];
counters[myNodeId]++;

long total() {
    return Arrays.stream(counters).sum();
}
```

CRDTs são usados em carrinhos de compras (Dynamo), editores colaborativos (Google Docs) e contadores distribuídos.

---

## Ferramentas práticas

| Ferramenta | Papel | Algoritmo de consenso |
|---|---|---|
| **etcd** | Armazenamento chave-valor, configuração do Kubernetes | Raft |
| **Apache ZooKeeper** | Coordenação, eleição de líder | ZAB (Zookeeper Atomic Broadcast, derivado do Paxos) |
| **Consul** | Descoberta de serviços, locks distribuídos | Raft |
| **Apache Kafka** | Log distribuído, mensageria | KRaft (baseado em Raft, substitui o ZooKeeper) |

---

[^1]: FISCHER, M.; LYNCH, N.; PATERSON, M. [Impossibility of Distributed Consensus with One Faulty Process](https://dl.acm.org/doi/10.1145/3149.214121){target="_blank"}. JACM, 1985.
[^2]: LAMPORT, L. [Paxos Made Simple](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf){target="_blank"}. ACM SIGACT News, 2001.
[^3]: ONGARO, D.; OUSTERHOUT, J. [In Search of an Understandable Consensus Algorithm (Raft)](https://raft.github.io/raft.pdf){target="_blank"}. USENIX ATC, 2014.
[^4]: [Raft Visualization](https://raft.github.io/){target="_blank"} — animação interativa da eleição de líder e da replicação de log.
[^5]: [The Secret Lives of Data: Raft](https://thesecretlivesofdata.com/raft/){target="_blank"} — uma visualização narrativa e envolvente da mecânica e das decisões de projeto do Raft.