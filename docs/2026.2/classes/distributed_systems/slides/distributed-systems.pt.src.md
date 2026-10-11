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
Roteiro: (1) por que distribuir e os três problemas de raiz; (2) falácias, falha parcial, timeouts
e idempotência; (3) relógios lógicos; (4) CAP e PACELC; (5) consenso: FLP, modelos de falha,
maiorias, Raft; (6) quóruns, consistência eventual e CRDTs.
-->

---

## Por que isso é difícil?

<div class="q">

Vários computadores colaboram e o usuário deve ver **um único sistema coerente**.
O que torna coordená-los mais difícil do que rodar tudo em uma máquina só?

</div>

* **Falha parcial** — cada nó pode falhar sozinho enquanto o resto continua rodando.
* **Rede não confiável** — mensagens podem ser atrasadas, perdidas ou duplicadas.
* **Sem relógio compartilhado** — não existe uma noção global de "agora".

<!--
Deixe a turma responder primeiro. Esses três fatos são a raiz de todos os tópicos desta aula.
-->

---

## Nossa loja é um sistema distribuído

Um clique em **Finalizar pedido**:

Navegador → **Gateway** → Auth → **Order** → Product → Redis · Order → **PostgreSQL** · Order → **Kafka**

- Cada seta é uma mensagem pela rede; cada caixa pode falhar sozinha.
- **Heterogênea** (Java, Python, Postgres, Redis, Kafka), **fracamente acoplada** (HTTP, eventos), **cliente-servidor**.

<div class="cols">
<div>

### O que ganhamos

- Escalabilidade horizontal
- Tolerância a falhas (replicação)
- Menor latência (caches, CDNs)

</div>
<div>

### O que pagamos

- Complexidade, estado distribuído
- Falhas de rede a tratar
- Custo operacional: monitoramento, rastreamento

</div>
</div>

---

<!-- _class: tight -->

## As 8 falácias da computação distribuída

Deutsch e colegas da Sun (1994; a 8ª, de Gosling) — **todas falsas**:

<div class="cols">
<div>

1. A rede é confiável
2. A latência é zero
3. A largura de banda é infinita
4. A rede é segura

</div>
<div>

5. A topologia não muda
6. Existe um único administrador
7. O custo de transporte é zero
8. A rede é homogênea

</div>
</div>

<div class="warn">

Raiz comum: tratar a rede como uma **chamada de função local confiável**. Projete **para** a falha — assuma que ela vai acontecer e degrade de forma controlada.

</div>

<!--
Peça um exemplo da loja para cada uma: cinco chamadas de 40 ms em sequência, um pod reagendado com um novo IP...
-->

---

## Lento ou morto?

Order → Product: *reservar 1 unidade do produto 42* … **silêncio**.

- Requisição perdida? Product caiu? Resposta perdida? Product só está lento? **Tudo parece igual.**
- A única ferramenta: um **timeout** — mas ele não diz se a operação foi executada.
- Um retry pode aplicá-la **duas vezes** → operações repetidas precisam ser **idempotentes** (ex.: um id único de requisição).

<div class="ok">

Timeouts, retries com backoff e circuit breakers: veja a aula de **Confiabilidade**.

</div>

---

## Sem relógio global: tempo lógico

Relógios derivam — nunca ordene eventos de máquinas diferentes por `currentTimeMillis()`.

**Relógio de Lamport** — um contador por processo:

1. incremente antes de cada evento;
2. anexe o contador a toda mensagem enviada;
3. no recebimento: `max(local, received) + 1`.

- Garantia: se *a* aconteceu antes de *b*, então L(*a*) < L(*b*) — a recíproca não vale.
- **Relógios vetoriais** (um contador por processo) também detectam eventos **concorrentes**.

<p class="small">O Kafka ordena pelo offset da partição; o Raft, pelo term — autoridades únicas, não relógios de parede.</p>

---

## Teorema CAP

Um sistema que **replica dados** não garante as três ao mesmo tempo (Brewer 2000; Gilbert e Lynch 2002):

- **C — Consistência**: toda leitura retorna a escrita mais recente, ou um erro (linearizabilidade — **não** o C do ACID).
- **A — Disponibilidade**: toda requisição a um nó vivo recebe uma resposta sem erro, talvez não a última escrita.
- **P — Tolerância a partições**: continua funcionando quando a rede divide os nós em grupos.

<div class="warn">

Partições **vão** acontecer. P não é opcional: a escolha real é **C ou A durante uma partição**.

</div>

---

## CP ou AP?

<div class="cols">
<div>

### CP

Durante uma partição, **recusa** em vez de devolver dados desatualizados.

ZooKeeper, etcd, PostgreSQL (replicação síncrona), MongoDB (escritas por maioria).

**Pagamentos, estoque, autenticação.**

</div>
<div>

### AP

Durante uma partição, **todo nó responde** — depois as réplicas **convergem** (consistência eventual).

Cassandra, DynamoDB, CouchDB, DNS.

**Catálogo, carrinho, feeds.**

</div>
</div>

<p class="small">CA só existe em um único nó. CP/AP descrevem uma <strong>configuração</strong>, não um produto — escolha por domínio de dados.</p>

---

## PACELC: e quando não há partição?

**Se Partição** → **A** ou **C** · **Senão** → **L**atência ou **C**onsistência

| Sistema | Partição | Operação normal | Classe |
|---|---|---|---|
| Cassandra, DynamoDB | favorece A | favorece L | PA/EL |
| MongoDB (escritas por maioria) | favorece C | favorece C | PC/EC |
| PostgreSQL (replicação síncrona) | favorece C | favorece C | PC/EC |

<div class="ok">

Na maior parte do tempo **não há partição** — mas latência vs. consistência está **sempre** presente: uma réplica de leitura assíncrona ou um cache Redis pode devolver dados desatualizados.

</div>

---

## Consenso — e por que é difícil

**Consenso**: os nós concordam sobre **um valor** (ou uma ordem de log) apesar de mensagens perdidas e nós que falham — eleição de líder, locks, máquinas de estado replicadas.

- **Safety**: ninguém decide diferente. **Liveness**: todos acabam decidindo.

> **FLP (1985)**: totalmente assíncrono + um nó pode cair → nenhum algoritmo determinístico sempre termina.

- Paxos e Raft **nunca violam a safety**; progridem quando a rede se comporta (sincronia parcial).
- Na prática: **timeouts** — um nó lento parece igual a um que caiu.

---

## Modelos de falha

| Modelo | O que um nó defeituoso faz | Custo da tolerância |
|---|---|---|
| **Crash-stop** | para e nunca se recupera | N nós toleram ⌊(N-1)/2⌋ falhas |
| **Crash-recovery** | para, pode reiniciar com estado persistente | logs duráveis, nós que voltam |
| **Bizantino** | arbitrário — mensagens erradas, malícia | **3f+1** nós para tolerar f falhas |

- Algoritmos de datacenter assumem **crash-stop** ou **crash-recovery**.
- Tolerância a falhas bizantinas: blockchains e sistemas críticos de segurança.

---

## Maiorias: por que 3 ou 5 nós

Duas maiorias quaisquer **se sobrepõem** → duas decisões conflitantes nunca vencem juntas (sem split brain).

| Nós | Maioria | Falhas toleradas |
|---|---|---|
| 3 | 2 | **1** |
| 4 | 3 | 1 |
| 5 | 3 | **2** |

<div class="ok">

Use um número **ímpar**: um 4º nó custa dinheiro e **não** tolera nenhuma falha a mais. Numa partição 3/2 → só o lado com 3 continua escrevendo.

</div>

<!--
Verificação rápida: com 7 nós, quantos podem falhar? (3.)
-->

---

## Raft

Projetado para ser **compreensível** (Ongaro e Ousterhout, 2014).

- **Eleição**: Follower → timeout de eleição *aleatório* → Candidate → **voto da maioria** → Leader. Um **term** maior faz qualquer nó recuar.
- **Replicação**: o cliente escreve `x=5` no líder → `AppendEntries` → **commit após a maioria** confirmar → resposta.
- **Safety**: o log do candidato precisa estar tão atualizado quanto o dos eleitores; entradas confirmadas sobrevivem à falha de qualquer **minoria**.

<p class="small">Raft: etcd (Kubernetes), Consul, CockroachDB, Kafka KRaft. Paxos (Lamport) é o ancestral mais antigo e mais difícil; o ZooKeeper usa ZAB.</p>

<!--
Mostre raft.github.io: pare o líder e assista à eleição.
-->

---

## Quóruns

Para **N** réplicas, uma escrita precisa de **W** confirmações e uma leitura precisa de **R** respostas.

<div class="ok">

**W + R > N** → todo quórum de leitura se sobrepõe a todo quórum de escrita: pelo menos um nó lido tem a última escrita.

</div>

| N = 3 (Cassandra) | W + R | Efeito |
|---|---|---|
| `ONE` / `ONE` | 2 ❌ | o mais rápido, leituras podem vir desatualizadas |
| `QUORUM` / `QUORUM` | 4 ✅ | última escrita; tolera 1 nó fora do ar |
| `ALL` / `ONE` | 4 ✅ | um nó fora do ar bloqueia todas as escritas |

---

## Consistência eventual e CRDTs

Sistemas AP prometem: sem novas atualizações, as réplicas **acabam convergindo** — mas não dizem *quando*.

- **Last-Write-Wins** — o maior timestamp vence; perde escritas concorrentes, confia em relógios que derivam.
- **Relógios vetoriais** — detectam escritas concorrentes para resolução explícita.
- **CRDTs** — um **merge** comutativo e idempotente: ordem e repetição não importam.

```java
void increment() { counts[me]++; }               // G-Counter: own slot only
void merge(GCounter o) {                          // element-wise max
    for (int i = 0; i < counts.length; i++) counts[i] = Math.max(counts[i], o.counts[i]);
}
```

---

## Pontos-chave

1. Distribuído: nós independentes, **só mensagens**, **sem relógio compartilhado** — nossa loja é um.
2. As **8 falácias** são falsas; quem chama não distingue lento de morto: **timeouts** + retries **idempotentes**.
3. Ordene eventos com uma autoridade única ou com **relógios lógicos**, não com relógios de parede.
4. **CAP**: durante uma partição, escolha **C ou A**; o **PACELC** acrescenta latência vs. consistência. Escolha por domínio de dados.
5. **FLP**: o consenso mantém a safety e depende de timeouts para progredir.
6. **Maiorias** se sobrepõem — use 3 ou 5 nós; o **Raft** elege um líder e confirma com a maioria.
7. Quóruns exigem **W + R > N**; sistemas AP convergem com LWW, relógios vetoriais ou **CRDTs**.
