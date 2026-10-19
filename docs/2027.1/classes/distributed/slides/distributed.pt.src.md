---
marp: true
lang: pt-BR
title: Fundamentos de Sistemas Distribuídos
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Fundamentos de Sistemas Distribuídos

**Sem memória compartilhada, sem relógio compartilhado e com uma rede que mente**

<!--
Roteiro: (1) por que distribuir e modelos de falha; (2) a rede não confiável, timeouts e
idempotência; (3) replicação e modelos de consistência; (4) CAP e PACELC; (5) consenso e
quóruns; (6) tempo e relógios.
-->

---

## 10:00:00 — as vendas abrem

<div class="q">

Uma fã no trem toca em **Reservar assento**. O spinner gira por 5 s, depois *"Algo deu errado"*.
Ela toca de novo. **O primeiro toque reservou um assento? Ela vai reservar dois? Ser cobrada duas vezes?**

</div>

- Em uma máquina, a função retornou ou lançou exceção — a pergunta não existiria.
- O BoxOffice roda em dezenas de máquinas ligadas apenas por uma **rede**.
- Um sistema distribuído: nós que cooperam **só por mensagens**, **sem memória e sem relógio compartilhados**.

> "Um sistema distribuído é aquele em que a falha de um computador que você nem sabia que existia pode tornar o seu próprio computador inutilizável." — Leslie Lamport

---

## Por que distribuir — e o que custa

<div class="cols">
<div>

### Motivos

- **Escala** além de uma máquina
- **Tolerância a falhas**: sem ponto único de falha
- **Latência**: ficar perto dos usuários
- **Isolamento**: times, raio de impacto
- **Residência de dados** (LGPD, GDPR)

</div>
<div>

### Custos

- **Falha parcial**
- **Rede não confiável**
- **Sem relógio global**
- **Cópias divergem** (consistência)
- **Coordenação** e operação

</div>
</div>

<p class="small">Em escala, falhar é a regra: 1 − (1 − p)<sup>N</sup>. Com p = 0,1% por máquina por dia, 3.000 máquinas veem uma falha em ~95% dos dias.</p>

---

## Modelos de falha

| Modelo | O nó defeituoso… | Exemplo no BoxOffice |
|---|---|---|
| **Crash-stop** | para para sempre | VM encerrada |
| **Crash-recovery** | para, reinicia a partir do disco | pod do `inventory` morto por OOM |
| **Omissão** | descarta mensagens | o evento `SeatHeld` nunca enviado |
| **Temporização** | responde tarde demais | pausa de GC de 3 s no `payment` |
| **Bizantina** | mente, corrompe | ingresso forjado, bit trocado |
| **Cinza** | parece saudável, falha para os usuários | `/health` 200, toda consulta dá timeout |

<div class="warn">

As falhas que doem não são crashes limpos: são as **lentas**, as **parciais** e as **cinza**.

</div>

---

## As 8 falácias da computação distribuída

1. A rede é confiável
2. A latência é zero — mesmo DC ≈ 0,5 ms de RTT, entre continentes ≈ 150 ms
3. A largura de banda é infinita
4. A rede é segura
5. A topologia não muda
6. Existe um administrador
7. O custo de transporte é zero
8. A rede é homogênea

<p class="small">Deutsch et al., Sun Microsystems (1994; Gosling acrescentou a 8ª em 1997). Cada uma volta em uma aula posterior.</p>

---

## Lento ou morto?

`inventory → payment: autorizar R$ 450` … **silêncio** … timeout após 2 s.

- (a) requisição perdida · (b) `payment` caiu · (c) **resposta perdida** · (d) `payment` **só lento**
- Os quatro casos são idênticos para quem chama.
- Um **timeout** permite *supor* a falha — não saber.
- Em (c) e (d) a cobrança **aconteceu**: um retry cego cobra duas vezes.

<div class="ok">

Timeouts são um trade-off (longo demais: threads se acumulam; curto demais: alarmes falsos e carga extra). Retries precisam ser **seguros** → **idempotência**.

</div>

---

## Semânticas de entrega

| Semântica | Como | Risco |
|---|---|---|
| **No máximo uma vez** | envia, nunca faz retry | mensagens perdidas |
| **Pelo menos uma vez** | retry até a confirmação | duplicatas |
| **Exatamente uma vez** | impossível só com uma rede não confiável | — |

> **Efetivamente uma vez = entrega pelo menos uma vez + processamento idempotente.**

<div class="warn">

"Entrega exatamente uma vez" sem ressalvas é um sinal de alerta em uma entrevista.

</div>

---

## Tornando retries seguros

- **Idempotente**: aplicar duas vezes = aplicar uma. `GET`, `PUT`, `DELETE` sim; `POST`, `x = x + 1` não.
- **Escrita condicional** (compare-and-set): a duplicata não muda nada.

```sql
UPDATE seats SET status = 'HELD', fan_id = 42, hold_key = :key
 WHERE id = 'A-12' AND (status = 'FREE' OR hold_key = :key);
```

- **Chave de idempotência**: o cliente envia um UUID por ação pretendida; o servidor grava chave + resultado **na mesma transação** e repete o resultado guardado diante de uma duplicata.
- Guarde as chaves em armazenamento **compartilhado** — o retry cai em outra réplica.

---

## Modelos de replicação

| | Um líder | Vários líderes | Sem líder |
|---|---|---|---|
| Quem escreve | um líder | um por região | qualquer réplica |
| Conflitos de escrita | nenhum | sim | sim |
| Consistência forte | possível | não entre líderes | só aproximada |
| Exemplos | PostgreSQL, partições do Kafka | montagens multirregião, CouchDB | Cassandra, Dynamo |

<p class="small">Quando dizer OK: <b>assíncrona</b> (rápida, pode perder escritas no failover) · <b>síncrona</b> (o seguidor mais lento decide) · <b>semissíncrona / quórum</b> (o meio-termo usual).</p>

---

## Atraso de replicação na vida real

<div class="q">

A fã paga às 10:00:41 e abre *Meus ingressos* 300 ms depois — servido por uma réplica assíncrona. A lista está **vazia**.

</div>

- Dia tranquilo, atraso médio de 20 ms → quase nunca desatualizado.
- Abertura das vendas, atraso médio de 800 ms → desatualizado para **~69%** das fãs aos 300 ms (modelo exponencial, ilustrativo).
- Sob carga, o bug não é raro — é **esperado**.

<div class="ok">

Corrija com precisão: **read-your-writes**, não consistência forte global.

</div>

---

## O espectro de consistência

| Modelo | Promessa | Disponível numa partição? |
|---|---|---|
| **Linearizável** | comporta-se como cópia única, atualidade em tempo real | não |
| **Causal** | causa antes do efeito, para todos | **sim** |
| **Read-your-writes** | você vê as próprias escritas | sim (por sessão) |
| **Leituras monotônicas** | sua visão nunca volta no tempo | sim (por sessão) |
| **Eventual** | réplicas convergem se as escritas pararem | sim |

- Linearizável para **assentos, dinheiro, unicidade, líderes**.
- Garantias de sessão via leitura no líder após escrita, **tokens de LSN**, réplicas fixas.
- Conflitos eventuais: **LWW** (perde escritas), vetores de versão, **CRDTs**.

---

## CAP: durante uma partição, escolha

<div class="cols">
<div>

### CP — recusar

- o lado minoritário devolve erros
- nenhum assento vendido duas vezes
- etcd, ZooKeeper, Spanner, PostgreSQL síncrono

</div>
<div>

### AP — responder

- todo nó responde, talvez desatualizado
- reconcilia depois
- Cassandra (padrão), DNS, CDN, caches

</div>
</div>

<div class="warn">

**P não é opcional** — "CA" não é escolha para dados replicados. E o C do CAP é **linearizabilidade**, não o C do ACID.

</div>

---

## PACELC: o trade-off que você paga todo dia

> **P**artição → **A** ou **C**; senão (**E**lse) → **L**atência ou **C**onsistência.

| As réplicas que confirmam estão… | RTT extra por escrita consistente |
|---|---|
| no mesmo rack | < 0,5 ms |
| em outra zona, mesma região | ~1–2 ms |
| em outra região, mesmo continente | ~10–40 ms |
| em outro continente | ~150–200 ms |

<p class="small">Por isso: síncrona entre zonas (EC), assíncrona ou particionada por região de origem entre regiões (EL). Ordens de grandeza ilustrativas.</p>

---

## BoxOffice: uma escolha por domínio de dados

| Dado | Escolha | Como |
|---|---|---|
| Assentos, reservas, pagamentos | **CP / linearizável** | um primário por evento, `UPDATE` condicional |
| *Meus ingressos* | **read-your-writes** | dados do próprio usuário no primário |
| Contador de assentos restantes | **leituras monotônicas** | réplica fixa / cache com TTL curto |
| Catálogo, imagens | **AP / eventual** | réplicas, cache, CDN |
| Contadores de interesse | **eventual (CRDT)** | contadores por região mesclados |

<p class="small">Multirregião: cada evento tem uma <b>região de origem</b> (a do local do show) — a consistência forte fica local, e uma partição só afeta reservas entre regiões.</p>

---

## Consenso: concordar sobre um log

- **Máquina de estado replicada**: mesmos comandos, mesma ordem → mesmo estado em todo nó.
- **Segurança** sempre (nunca duas decisões diferentes); **vivacidade** quando a rede se comporta.
- **FLP**: nenhum algoritmo determinístico sempre termina num sistema assíncrono → timeouts.
- **Maiorias se sobrepõem** → sem split brain.

| N | 1 | 2 | 3 | 4 | 5 | 7 |
|---|---|---|---|---|---|---|
| Falhas toleradas | 0 | 0 | **1** | 1 | **2** | 3 |

<p class="small">Use 3 ou 5 nós, espalhados de modo que <b>nenhuma zona tenha a maioria</b>. Dois nós a 99% cada = 98,01%.</p>

---

## Raft em um slide

- **Seguidor → Candidato → Líder**; tempo dividido em **termos**, no máximo um líder por termo.
- Sem heartbeat por um **election timeout** (aleatório) → vira candidato, `term + 1`, pede votos.
- **Um voto por termo**; só vota em um log **pelo menos tão atualizado** (restrição de eleição).
- O líder acrescenta, replica com `AppendEntries`, **confirma depois que uma maioria** gravou em disco.
- Um líder desatualizado vê um termo maior → **volta a ser seguidor**.

<p class="small">Padrões do etcd: heartbeat de 100 ms, election timeout de 1.000 ms → a queda de um líder custa ~1–2 s sem escritas. Usado por etcd, Consul, CockroachDB, Kafka KRaft.</p>

---

## Quóruns sem líder: R + W > N

| N = 3 | W | R | R + W > N? | Comportamento |
|---|---|---|---|---|
| `ONE` / `ONE` | 1 | 1 | não | o mais rápido, pode estar desatualizado |
| `QUORUM` / `QUORUM` | 2 | 2 | **sim** | vê a última escrita confirmada, tolera 1 fora |
| `ALL` / `ONE` | 3 | 1 | sim | um nó fora bloqueia as escritas |

<div class="warn">

A sobreposição é **necessária, não suficiente**: quóruns relaxados, escritas concorrentes e LWW ainda produzem anomalias. Consistência ajustável ≠ consenso.

</div>

---

## Leases precisam de fencing tokens

1. O worker A obtém o lease, **token 33** — então uma pausa de GC de 15 s; o lease expira.
2. O worker B obtém o lease, **token 34**, escreve com 34.
3. A acorda, ainda "tem o lock", escreve com 33 → **o armazenamento rejeita 33 < 34**.

```sql
UPDATE scheduled_jobs SET last_run_at = now(), fencing_token = :token
 WHERE job_id = 'onsale-reminder-42' AND fencing_token <= :token;
```

<div class="ok">

BoxOffice: Patroni + etcd de 3 nós elege o primário PostgreSQL; o primário antigo se rebaixa. Use consenso, **não o construa**.

</div>

---

## Atômico entre serviços? Two-phase commit

1. **Prepare**: cada participante grava suas mudanças + um registro *prepared*, mantém os locks, vota **sim/não**.
2. **Commit**: todos sim → o coordenador registra COMMIT e avisa todos; algum não → ABORT.

<div class="warn">

O coordenador cai depois dos votos → os participantes ficam **em dúvida**, o assento A-12 **fica travado**. As disponibilidades se multiplicam (todos no ar ao mesmo tempo), duas idas e voltas + fsyncs, e o **provedor de pagamentos não pode participar**.

</div>

<p class="small">O 2PC continua vivo <b>dentro</b> de bancos distribuídos com coordenador replicado (Spanner, CockroachDB, transações do Kafka) — não entre microsserviços.</p>

---

## Sagas: compensar em vez de travar

| Passo | Transação local | Compensação |
|---|---|---|
| 1 | pedido `PENDING` | pedido `CANCELLED` |
| 2 | assento → `RESERVED_FOR_PAYMENT` | libera o assento |
| 3 | **autoriza** o cartão (pivô) | cancela / estorna |
| 4 | assento `SOLD`, pedido `CONFIRMED` | — retry até dar certo |

- **Orquestrada** (um cérebro, p. ex. `order` ou Temporal) ou **coreografada** (eventos).
- Sem isolamento → **locks semânticos** com expiração; todo passo **idempotente**.
- Cada passo grava banco + evento atomicamente com um **outbox transacional**.

---

## Sem relógio global

- O quartzo deriva: 20 ppm ≈ **1,7 s/dia**; o NTP mantém os servidores a ~ms — se continuar rodando.
- **Relógio de parede** (`currentTimeMillis`) pode pular → só para timestamps humanos.
- **Relógio monotônico** (`nanoTime`) → durações, timeouts.

<div class="warn">

**Last-write-wins** com um nó 50 ms adiantado: uma liberação em .040 carimbada **.090** vence uma reserva em .060 → a Carla pagou e ficou sem assento. O relógio mais adiantado vence todo conflito.

</div>

---

## Ordenar sem confiar em relógios

| Ferramenta | Dá a você | Usada por |
|---|---|---|
| **Relógio de Lamport** | a → b ⇒ L(a) < L(b) | termos do Raft, fencing |
| **Relógio vetorial** | detecta **concorrência** | Dynamo, Riak |
| **HLC** | causal + perto do tempo real, 64 bits | CockroachDB, YugabyteDB, MongoDB |
| **TrueTime** | incerteza limitada, **commit wait** | Spanner |
| **Autoridade única** | ordem total a partir de um líder | sequence do banco, `UPDATE` condicional |
| **Chave Kafka → partição** | ordem por chave | eventos de um show |
| **Snowflake / UUIDv7** | ids únicos, aproximadamente ordenados por tempo | chaves — **não** "quem chegou primeiro" |

---

## O mapa de conceitos

| Problema de raiz | Técnica | Componentes da paleta |
|---|---|---|
| Falha parcial | replicação, modelos de consistência | `sql` `nosql` `cache` `cdn` |
| Falha parcial | CAP / PACELC, multirregião | `dns` `sql` `nosql` |
| Rede não confiável | timeouts, retries, idempotência | `payment` `thirdparty` `queue` |
| Rede não confiável | sagas, outbox, 2PC | `stream` `kafka` `payment` |
| Sem relógio global | consenso, quóruns, fencing | `kafka` `scheduler` `sql` |
| Sem relógio global | relógios lógicos / híbridos, ids | `kafka` `sql` `scheduler` |

<p class="small">Todo componente do playground herda um desses problemas — pergunte qual antes de colocá-lo num projeto.</p>

---

## Takeaways

1. Distribua só por **escala, tolerância a falhas, latência, isolamento, residência**; falhar vira a regra.
2. **Lento ≈ morto** para quem chama: timeouts + retries **idempotentes** (escritas condicionais, chaves de idempotência).
3. **Entrega** exatamente uma vez é impossível → pelo menos uma vez + processamento idempotente.
4. Escolha um **modelo de consistência por domínio de dados**: linearizável para assentos e dinheiro, read-your-writes para os dados do usuário, eventual para o catálogo.
5. **CAP** nas partições, **PACELC** todo dia; particione por **região de origem**; **sagas + outbox**, não 2PC, entre serviços.
6. **Maiorias** (3 ou 5 nós), **Raft**, `R + W > N`, **fencing tokens** — use o etcd, não o construa.
7. Nunca ordene eventos por timestamps de máquinas diferentes.
