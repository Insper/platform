---
marp: true
lang: pt-BR
title: Sistemas Distribuídos
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Sistemas Distribuídos

**Muitas máquinas independentes que precisam parecer uma só**

<!--
Objetivos: explicar o que torna um sistema distribuído e os três problemas de raiz; identificar as 8 falácias numa
chamada entre dois serviços; ordenar eventos com relógios de Lamport; escolher C ou A com CAP e PACELC; descrever o
Raft e dimensionar um cluster; comparar quóruns e consenso com consistência eventual (LWW, relógios vetoriais, CRDTs).
Roteiro: (1) visão geral: a loja, classificação, ganhos e custos, falácias, os três problemas de raiz, relógios lógicos;
(2) CAP e PACELC; (3) consenso: FLP, modelos de falha, maiorias, Paxos, Raft, quóruns, CRDTs, use em vez de construir.
-->

---

## De uma máquina para muitas

<div class="q">

A loja como **uma** aplicação Spring Boot com **um** PostgreSQL em **uma** máquina é fácil de entender. O que acontece quando o tráfego passa do que ela aguenta ou quando a máquina morre?

</div>

* Divida o trabalho: gateway, account, order, banco de dados, cache, broker de mensagens…
* …e você construiu um **sistema distribuído**: **nós** independentes que cooperam só **trocando mensagens** e **sem relógio compartilhado**; para o usuário, parecem **um sistema coerente**.
* Surge uma nova classe de problemas.

---

## Nossa loja é um sistema distribuído

Um clique em **Fazer pedido** atravessa a rede várias vezes:

Navegador → `POST /orders` → **Gateway** → Auth (valida o token) · Gateway → **Order** → Product → Redis (preço em cache) · Order → **PostgreSQL** (`INSERT`) · Order → **Kafka** (`OrderCreated`)

- Cada seta é uma **mensagem** pela rede; cada caixa é um processo que pode **falhar sozinho**.
- Product lento → order espera. Kafka fora do ar → o pedido pode ser gravado, mas o evento nunca é publicado.
- Nada compartilha memória nem relógio: é exatamente a definição de sistema distribuído.

---

## Classificação

| Dimensão | Opção A | Opção B |
|---|---|---|
| **Uniformidade** | Homogêneo: todos os nós rodam a mesma pilha | **Heterogêneo**: hardware e SO diversos |
| **Acoplamento** | Fortemente acoplado: memória compartilhada | **Fracamente acoplado**: mensagens, ciclo de vida independente |
| **Topologia** | **Cliente-servidor**: os servidores detêm os recursos | Peer-to-peer: todos os nós compartilham recursos (BitTorrent) |

<div class="ok">

A loja é **heterogênea** (serviços em Java, um serviço de notificação em Python, PostgreSQL, Redis, Kafka), **fracamente acoplada** (HTTP e Kafka) e **cliente-servidor** (navegador → gateway → serviços).

</div>

---

## O que ganhamos, o que pagamos

<div class="cols">
<div>

### Vantagens

- **Escalabilidade horizontal**: adicionar nós (Cassandra)
- **Tolerância a falhas**: replicação (Spanner)
- **Compartilhamento de recursos**: capacidade agregada (Folding@home)
- **Paralelismo**: MapReduce (Hadoop)
- **Redução de latência**: nós perto dos usuários (CDNs)

</div>
<div>

### Desvantagens

- **Complexidade**: coordenação, estado distribuído
- **Sobrecarga de rede**: mensagens atrasadas, perdidas, duplicadas
- **Consistência vs. disponibilidade** (CAP)
- **Superfície de ataque maior**: falhas bizantinas
- **Custo operacional**: Prometheus, Kubernetes, rastreamento

</div>
</div>

<p class="small">Na loja: escala horizontal com o Nginx na frente de réplicas (Hands-on 7); menos latência com o cache Redis (Hands-on 8).</p>

---

<!-- _class: tight -->

## As 8 falácias da computação distribuída

Deutsch e colegas na Sun (sete em 1994; Gosling acrescentou a oitava em 1997) — **todas falsas**:

| Falácia | Na loja |
|---|---|
| A rede é confiável | a chamada do serviço de pedidos ao de produtos falha no meio |
| A latência é zero | cinco chamadas sequenciais de 40 ms resultam num checkout de 200 ms |
| A largura de banda é infinita | devolver o catálogo inteiro numa única resposta |
| A rede é segura | os serviços confiam em qualquer chamador dentro do cluster |
| A topologia não muda | um pod do Kubernetes é reagendado com um novo IP |
| Existe um único administrador | outra equipe muda uma regra de firewall |
| O custo de transporte é zero | parsing de JSON e tráfego entre zonas na fatura da nuvem |
| A rede é homogênea | serviços em Java, um serviço em Python, o protocolo binário do Kafka |

<div class="warn">

Raiz comum: tratar a rede como uma **chamada de função local confiável**. Projete **para** a falha: assuma que ela vai acontecer e degrade de forma controlada.

</div>

---

## Os três problemas de raiz

Quase toda dificuldade deste curso vem de três fatos:

1. **Falha parcial** — parte do sistema falha enquanto o resto continua rodando: o product caiu, o gateway e o order estão bem. Cada componente precisa decidir o que fazer quando uma dependência para de responder.
2. **Uma rede não confiável** — quem chama não distingue **lento** de **morto**.
3. **Ausência de relógio global** — os relógios derivam; não dá para ordenar eventos de máquinas diferentes pelos timestamps.

---

## Lento ou morto?

Order → Product: *reservar 1 unidade do produto 42* … **silêncio**.

- A requisição se perdeu? O product caiu? A resposta se perdeu? O product só está lento? **Tudo parece igual.**
- A única ferramenta prática: um **timeout** — passado o prazo, assuma a falha.
- Mas o timeout não diz se a operação foi executada: um retry pode aplicá-la **duas vezes**.
- Por isso operações repetidas precisam ser **idempotentes**: aplicar duas vezes = aplicar uma (por exemplo, um id de requisição único que o servidor deduplica).

<div class="ok">

Timeouts, retries com backoff e circuit breakers: **Padrões de resiliência** (aula de Confiabilidade).

</div>

---

## Ausência de relógio global

- Cada máquina tem seu próprio relógio de quartzo e os relógios **derivam**.
- Dois servidores sincronizados com NTP ainda podem divergir em milissegundos — muito mais depois de uma configuração errada ou de uma pausa da VM.
- Um pedido criado "às 10:00:00.120" num nó pode ter acontecido **depois** de um cancelamento marcado "10:00:00.150" em outro.

<div class="warn">

Não ordene eventos por `System.currentTimeMillis()` entre máquinas: no "last write wins", um nó com o relógio adiantado vence todos os conflitos em silêncio. Use uma **autoridade única** (uma sequence do banco, o offset de uma partição do Kafka) ou **relógios lógicos**.

</div>

---

<!-- _class: tight -->

## Relógios lógicos (Lamport)

Precisamos da **ordem** dos eventos, não do horário real: *aconteceu-antes* (→) — mesmo processo, envio → recebimento de mensagem, transitividade. Nenhum → o outro: **concorrentes**.

<div class="cols">
<div>

**Relógio de Lamport**, um contador por processo:

1. incremente antes de cada evento local;
2. anexe o contador a cada mensagem;
3. ao receber *t*: `max(local, t) + 1`.

</div>
<div>

**Exemplo**

- Order: cria o pedido (1), envia `OrderCreated` (2)
- Consumidor: recebe → `max(0,2)+1 = 3`, envia `SendEmail` (4)
- Notificação: evento local (1), recebe → `max(1,4)+1 = 5`

</div>
</div>

- Garantia: se *a* → *b*, então L(*a*) < L(*b*) — a recíproca **não** vale.
- **Relógios vetoriais** (um contador por processo) distinguem "aconteceu antes" de "concorrente": detecção de conflitos em bancos replicados.

<p class="small">No curso: o Kafka ordena pelo <strong>offset</strong> da partição (Hands-on 10); o Raft distingue líderes antigos de novos pelo <strong>term</strong>.</p>

---

<div class="kicker">Teorema CAP</div>

## Responder ou recusar?

Os dados de produtos estão num PostgreSQL replicado em dois nós, **um em cada data center**. O enlace entre os dois cai; os dois nós continuam vivos.

<div class="q">

Um cliente no site B pede o estoque do produto 42, que acabou de ser atualizado no site A. O que o nó B deve fazer?

</div>

* **Responder com o que tem** (possivelmente desatualizado)…
* …ou **recusar a resposta** até conseguir falar com o A de novo. Não há terceira opção.

---

## O teorema CAP

Um sistema que **replica dados** não consegue garantir as três ao mesmo tempo (Brewer 2000; Gilbert e Lynch 2002):

- **C — Consistência**: toda leitura devolve a escrita mais recente ou um erro (linearizabilidade: como se houvesse uma única cópia).
- **A — Disponibilidade**: toda requisição a um nó que não falhou recebe uma resposta sem erro, talvez sem a escrita mais recente.
- **P — Tolerância a partições**: continua operando quando a rede divide os nós em grupos que não se falam.

<div class="warn">

Partições **vão** acontecer: P não é opcional, a escolha real é **C ou A durante uma partição**. E o C do CAP **não** é o C do ACID (restrições válidas): um PostgreSQL sozinho é consistente no sentido ACID; o CAP só aparece com **réplicas**.

</div>

---

## Uma partição, passo a passo

3 réplicas: o Nó 1 e o Nó 3 ainda se falam, **o Nó 2 está isolado**.

1. O cliente A grava `stock[42] = 0` no Nó 1 → a replicação para o Nó 2 falha → o Nó 1 responde OK.
2. O cliente B lê `stock[42]` no Nó 2:
   - **CP**: `error: cannot reach majority`
   - **AP**: `stock[42] = 5` (desatualizado)
3. A partição se resolve e as réplicas sincronizam.

<div class="ok">

Nenhuma resposta está "errada": o nó CP recusa em vez de mentir; o nó AP responde com o melhor valor que tem. Qual é aceitável depende dos **dados**, não da tecnologia.

</div>

---

## CP ou AP?

| | CP | AP | CA |
|---|---|---|---|
| **Durante uma partição** | rejeita requisições | responde, talvez desatualizado | — |
| **Consistência** | sempre | eventual | sempre |
| **Exemplos** | ZooKeeper, etcd, PostgreSQL (replicação síncrona), MongoDB (maioria) | Cassandra, DynamoDB, CouchDB, DNS | SGBD relacional num único nó |
| **Use quando** | pagamentos, estoque, identidade | carrinhos, feeds, índices de busca | só num nó |

<div class="warn">

CP e AP rotulam uma **configuração**, não um produto: o Cassandra com `QUORUM` se comporta quase como CP; o PostgreSQL lendo de uma réplica **assíncrona** pode devolver dados desatualizados. Pergunte o que acontece com as **suas** requisições durante uma partição.

</div>

---

## PACELC: e quando não há partição?

**Se há Partição** → **A** ou **C** · **Senão** (*Else*) → **L**atência ou **C**onsistência (Abadi, 2010)

Para ser consistente, a escrita espera as réplicas (uma ida e volta); para ser rápida, responde antes que elas confirmem.

| Sistema | Partição | Operação normal | Classe |
|---|---|---|---|
| Cassandra, DynamoDB | favorece A | favorece L | PA/EL |
| MongoDB (escritas por maioria) | favorece C | favorece C | PC/EC |
| PostgreSQL (replicação síncrona) | favorece C | favorece C | PC/EC |

<div class="ok">

**Na loja**: uma **réplica de leitura assíncrona** para o `GET /products` é a escolha EL — mais rápida, mas o atraso de replicação pode devolver um preço antigo. O **cache Redis** (Hands-on 8) faz a mesma escolha até o TTL expirar.

</div>

---

## Escolha por domínio de dados

<div class="cols">
<div>

### AP

- **Catálogo de produtos**: mostrar um item disponível por um instante a mais é aceitável.
- **Carrinho de compras**: réplicas divergentes se reconciliam no checkout.

</div>
<div>

### CP

- **Pagamentos**: uma cobrança em dobro não pode ser reconciliada depois.
- **Autenticação**: um token revogado precisa ficar inválido em todos os nós na hora.

</div>
</div>

<div class="warn">

**Erros comuns**: "escolhemos CA" (com dados em mais de uma máquina, partições acontecem) · tratar o CAP como permanente (a escolha entre C e A só vale *durante* uma partição) · esquecer o cache (um Redis na frente de um banco CP torna essas leituras parecidas com AP).

</div>

---

<div class="kicker">Consenso</div>

## Qual versão é a verdade?

O Kubernetes guarda todo o estado do cluster no **etcd**, com 3 ou 5 membros. Dois `kubectl apply` chegam a dois membros ao mesmo tempo e um membro cai: como os sobreviventes concordam, **sem um árbitro**?

- **Consenso**: nós concordam com **um valor** apesar de mensagens atrasadas, perdidas ou reordenadas e de nós que falham — eleição de líder, locks, armazenamentos de configuração.
- **Máquina de estados replicada**: mesmo estado inicial + mesmos comandos **na mesma ordem** (um log) → mesmo estado final.
- **Safety**: todos os nós que decidem decidem o **mesmo** valor. **Liveness**: todo nó sem falha **acaba** decidindo.

---

## Por que o consenso é difícil: FLP

> **FLP (Fischer, Lynch, Paterson, 1985)**: rede totalmente assíncrona + um único nó que pode cair → **nenhum algoritmo determinístico sempre chega ao consenso**.

Todo algoritmo prático faz uma concessão:

- assume **sincronia parcial** e só garante progresso quando os atrasos ficam limitados; ou
- usa **aleatoriedade** (termina com probabilidade 1); ou
- enfraquece o problema (aceita ficar bloqueado para sempre em condições adversas).

<div class="ok">

Paxos e Raft seguem o primeiro caminho: **nunca violam a safety** e progridem quando a rede se comporta — usando **timeouts**, então um nó lento parece igual a um nó que caiu.

</div>

---

## Modelos de falha

| Modelo | O que um nó com falha faz | Custo para tolerar |
|---|---|---|
| **Crash-stop** | para e nunca se recupera | N nós toleram ⌊(N-1)/2⌋ falhas |
| **Crash-recovery** | para, pode reiniciar com estado persistente | logs duráveis, nós que voltam ao grupo |
| **Bizantino** | arbitrário: mensagens incorretas, contraditórias, maliciosas | **3f+1** nós para tolerar f falhas |

- A maioria dos algoritmos de datacenter assume **crash-stop** ou **crash-recovery**.
- Tolerância a falhas bizantinas: blockchains e sistemas críticos de segurança.

---

## Maiorias: por que 3 ou 5 nós

Uma decisão só vale com **maioria**; duas maiorias quaisquer **compartilham um nó**, então duas decisões conflitantes nunca vencem juntas.

<div class="cols">
<div>

| N | Maioria | Tolera |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | **1** |
| 4 | 3 | 1 |
| 5 | 3 | **2** |
| 7 | 4 | 3 |

</div>
<div>

- Use um número **ímpar**: um 4º nó custa dinheiro e **não** tolera nenhuma falha a mais.
- 2 nós é pior que 1: perder qualquer um deles para tudo.
- **Split brain**: 5 nós divididos em 3/2 → só o lado com 3 elege e faz commit; o lado com 2 rejeita escritas.

</div>
</div>

---

## Paxos

Lamport (1998; "Paxos Made Simple", 2001). Papéis: **proposers**, **acceptors**, **learners**.

1. **Prepare**: o proposer envia o número `n`; cada acceptor promete ignorar números menores e responde com a proposta de maior número que **já aceitou**, se houver.
2. **Accept**: com promessas de uma maioria, envia `Accept(n, value)`. O valor **não é livre**: se uma promessa trouxe um valor aceito, ele precisa propor o de maior número.
3. O valor é **escolhido** quando uma maioria o aceita (2 de 3).

- "Adotar o valor já aceito" é o que torna o Paxos **seguro**.
- Famoso por ser difícil de implementar: o algoritmo não trata eleição de líder, compactação do log nem mudança de membros.

---

## Raft: eleição de líder

Projetado para ser **compreensível** (Ongaro e Ousterhout, 2014): eleição de líder, replicação do log, safety.

- Follower → **timeout de eleição** → Candidate → **voto da maioria** → Leader. Viu um **term** maior → volta a follower.
- **Terms** são relógios lógicos: cada um começa com uma eleição, no máximo **um líder por term**; um voto por nó por term.
- `RequestVote(term=2, lastLogIndex=5)`: o candidato só vence se o seu log estiver **pelo menos tão atualizado** quanto o dos eleitores (restrição de eleição) → o novo líder tem toda entrada confirmada.
- Os timeouts são **aleatórios** (150–300 ms): senão todos viram candidatos ao mesmo tempo e dividem os votos.

<p class="small">Experimente: raft.github.io (pare o líder e veja a eleição) e The Secret Lives of Data.</p>

---

## Raft: replicação do log

1. Cliente: `Write x=5` → Leader.
2. Leader → `AppendEntries(x=5)` → followers.
3. Uma **maioria** (contando o líder) gravou de forma durável → **commit** → `Success` para o cliente.

<div class="ok">

Todo líder futuro precisa dos votos de uma maioria e toda maioria tem a entrada: uma entrada confirmada sobrevive à falha de qualquer **minoria**.

</div>

<p class="small">O Raft roda no etcd (Kubernetes), no CockroachDB e no Consul.</p>

---

## Quóruns

Bancos sem líder (Cassandra, DynamoDB): **N** réplicas, uma escrita precisa de **W** confirmações e uma leitura de **R** respostas. **W + R > N** → todo quórum de leitura cruza todo quórum de escrita.

| Configuração (N = 3) | W | R | W + R > N? | Efeito |
|---|---|---|---|---|
| `ONE` / `ONE` | 1 | 1 | ❌ | o mais rápido; leituras podem vir desatualizadas |
| `QUORUM` / `QUORUM` | 2 | 2 | ✅ | última escrita confirmada; tolera 1 nó fora |
| `ALL` / `ONE` | 3 | 1 | ✅ | leituras rápidas; um nó fora bloqueia toda escrita |

<div class="warn">

**Necessário, não suficiente**: escritas concorrentes, uma escrita em menos de W nós dada como falha, quóruns "sloppy". Bancos de quórum oferecem consistência **ajustável**, não linearizabilidade.

</div>

---

<!-- _class: tight -->

## Consistência eventual e CRDTs

Sistemas AP: sem novas atualizações, as réplicas **acabam convergindo** — sem dizer *quando*.

- **Last-Write-Wins**: o maior timestamp vence; perde escritas concorrentes e confia em relógios que derivam.
- **Relógios vetoriais**: detectam escritas concorrentes para uma resolução explícita.
- **CRDTs**: um **merge** comutativo, associativo e idempotente.

```java
void increment() { counts[me]++; }               // G-Counter: each node, its own slot

void merge(GCounter other) {                      // element-wise max
    for (int i = 0; i < counts.length; i++)
        counts[i] = Math.max(counts[i], other.counts[i]);
}
```

Visualizações de um produto: nó 0 `[3, 0]`, nó 1 `[0, 2]` → os dois fazem merge para `[3, 2]` = **5**. LWW num único número: 3 ou 2.

<p class="small">Tipos de dados do Riak, Redis Active-Active, Automerge e Yjs; o carrinho do Dynamo (2007) unia as versões por união de conjuntos.</p>

---

## Na prática: use, não construa

| Ferramenta | Papel | Algoritmo |
|---|---|---|
| **etcd** | chave-valor, configuração do Kubernetes | Raft |
| **ZooKeeper** | coordenação, eleição de líder | ZAB (derivado do Paxos) |
| **Consul** | descoberta de serviços, locks | Raft |
| **Kafka** | log distribuído | KRaft (Raft); modo ZooKeeper removido no 4.0 |

<div class="warn">

- **Não implemente Paxos nem Raft você mesmo**: etcd, ZooKeeper, Consul ou o banco (`SELECT … FOR UPDATE`, restrição de unicidade).
- **Consenso não é de graça**: uma ida e volta à maioria por um único líder — só dados pequenos e críticos.
- **Um lock não é garantia**: quem o detém pausa e acorda depois que o lease expirou; use um **fencing token**.

</div>

---

## Pontos-chave

1. Distribuído: nós independentes, **só mensagens**, **sem relógio compartilhado** — a loja vira um assim que tem mais de um serviço.
2. Ganhamos escala, tolerância a falhas e latência; pagamos em complexidade, falhas de rede e operação. As **8 falácias** são falsas.
3. Quem chama não distingue lento de morto: **timeouts** + retries **idempotentes**. Ordene eventos com uma autoridade única ou com **relógios lógicos**.
4. **CAP**: durante uma partição, **C ou A** (CA só num nó); o **PACELC** acrescenta latência vs. consistência. Escolha **por domínio de dados**.
5. **FLP**: o consenso sempre mantém a safety e depende de timeouts para a liveness.
6. **Maiorias** se sobrepõem: 3 ou 5 nós. **Raft**: timeouts aleatórios, um líder por term, commit com a maioria.
7. Quóruns exigem **W + R > N**; sistemas AP convergem com LWW, relógios vetoriais ou **CRDTs**.
