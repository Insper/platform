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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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
- **Residência de dados** (Lei Geral de Proteção de Dados, LGPD; regulamento europeu GDPR, *General Data Protection Regulation*)

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

## O BoxOffice é um sistema distribuído

<div class="flow">
<div class="box">Celular da fã</div><div class="arrow">POST /holds →</div>
<div class="box">gateway<small>valida o token com o auth</small></div><div class="arrow">→</div>
<div class="box accent">inventory</div><div class="arrow">UPDATE →</div>
<div class="box">PostgreSQL primário</div><div class="arrow">replica →</div>
<div class="box muted" style="flex: 1.5">PostgreSQL réplica<small>pelo log de escrita antecipada (WAL)</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .6; text-align: left">o inventory também →</div>
<div class="box">Redis<small>guarda o mapa de assentos</small></div><div class="arrow">e</div>
<div class="box orange">Kafka, 3 brokers<small>evento SeatHeld</small></div><div class="arrow">consome →</div>
<div class="box">notification</div>
</div>

- Cada seta é uma **mensagem** pela rede; cada caixa pode falhar, pausar ou ficar lenta **por conta própria**.
- Redis lento → o `inventory` espera · réplica atrasada → leitura velha · Kafka inacessível → reserva gravada, `SeatHeld` nunca publicado.

<div class="warn">

Nada compartilha memória nem relógio: cada um desses casos é uma **falha parcial**.

</div>

<!--
A página segue um clique em "Reservar assento A-12" pelo mesmo diagrama, passo a passo.
-->

---

## Modelos de falha

| Modelo | O nó defeituoso… | Exemplo no BoxOffice |
|---|---|---|
| **Crash-stop** | para para sempre | máquina virtual (VM, *virtual machine*) encerrada |
| **Crash-recovery** | para, reinicia a partir do disco | pod do `inventory` morto por falta de memória (OOM, *out of memory*) |
| **Omissão** | descarta mensagens | o evento `SeatHeld` nunca enviado |
| **Temporização** | responde tarde demais | pausa de coleta de lixo (GC, *garbage collection*) de 3 s no `payment` |
| **Bizantina** | mente, corrompe | ingresso forjado, bit trocado |
| **Cinza** | parece saudável, falha para os usuários | `/health` 200, toda consulta dá timeout |

<div class="warn">

As falhas que doem não são crashes limpos: são as **lentas**, as **parciais** e as **cinza**.

</div>

---

## As 8 falácias da computação distribuída

1. A rede é confiável
2. A latência é zero — mesmo data center ≈ 0,5 ms de tempo de ida e volta (RTT, *round-trip time*), entre continentes ≈ 150 ms
3. A largura de banda é infinita
4. A rede é segura
5. A topologia não muda
6. Existe um administrador
7. O custo de transporte é zero
8. A rede é homogênea

<p class="small">Deutsch et al., Sun Microsystems (1994; Gosling acrescentou a 8ª em 1997). Cada uma volta em uma aula posterior.</p>

---

## Lento ou morto?

<div class="flow">
<div class="box accent" style="flex: .8">inventory<small>autorizar R$ 450</small></div><div class="arrow">silêncio →</div>
<div class="box muted">(a) requisição perdida<small>não cobrou</small></div>
<div class="box muted">(b) payment caiu<small>não cobrou</small></div>
<div class="box red">(c) resposta perdida<small>cobrou</small></div>
<div class="box red">(d) só lento<small>cobrou</small></div>
<div class="arrow">→ timeout de 2 s</div>
</div>

- Os quatro casos são idênticos para quem chama: um **timeout** permite *supor* a falha — não saber.
- Em (c) e (d) a cobrança **aconteceu**: um retry cego cobra duas vezes.

<div class="ok">

Timeouts são um trade-off (longo demais: threads se acumulam; curto demais: alarmes falsos e carga extra). Retries precisam ser **seguros** → **idempotência**.

</div>

---

## Lento ou morto? O simulador

<div class="flow">
<div class="box orange">desistir<small>no máximo uma vez · 9 holds sem pedido · 13 ouvem "falhou" por um pedido que existe</small></div>
<div class="box red">tentar de novo, timeout de 2 s<small>pelo menos uma vez · 13 holds com dois pedidos</small></div>
<div class="box red">tentar de novo, timeout de 300 ms<small>26 holds com dois pedidos</small></div>
<div class="box green">tentar + deduplicar por hold<small>0 duplicatas em qualquer timeout</small></div>
</div>

- Na página de visão geral: o gateway transforma 200 holds de assento em pedidos; 5% das requisições e das respostas se perdem; no máximo 3 tentativas.
- Um timeout maior só remove o caso (d): com 5 s, as **respostas perdidas** ainda geram 6 duplicatas.
- Deduplicar é o `ON CONFLICT (hold_id) DO NOTHING` do lab 7; a versão com pagamento (chave de idempotência, lab 9) está na página de integrações.

<!--
p99 = a espera no percentil 99: 2,8 s com timeout de 2 s, 5,8 s com 5 s. O play percorre os fãs cuja primeira tentativa não teve resposta a tempo.
-->

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

- **Chave de idempotência**: o cliente envia um identificador único universal (UUID, *universally unique identifier*) por ação pretendida; o servidor grava chave + resultado **na mesma transação** e repete o resultado guardado diante de uma duplicata.
- Guarde as chaves em armazenamento **compartilhado** — o retry cai em outra réplica.

---

## O mapa de conceitos

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">Falha parcial</div>
<div class="box red">alguns nós falham, ninguém sabe quais</div>
<div class="box accent">replicação · modelos de consistência</div>
<div class="box accent">CAP / PACELC · multirregião</div>
<div class="box accent">consenso · quóruns · fencing</div>
<div class="box green">sql · nosql · cache · cdn · dns</div>
</div>
<div class="group">
<div class="caption">Rede não confiável</div>
<div class="box red">mensagens perdidas, atrasadas, duplicadas</div>
<div class="box accent">timeouts · retries · idempotência</div>
<div class="box accent">sagas · outbox · 2PC</div>
<div class="box green">payment · queue · stream · kafka</div>
</div>
<div class="group">
<div class="caption">Sem relógio global</div>
<div class="box red">relógios derivam e discordam</div>
<div class="box accent">relógios lógicos / híbridos</div>
<div class="box accent">autoridade única · ids ordenados</div>
<div class="box green">kafka · sql · scheduler</div>
</div>
</div>

<p class="small">Vermelho: o problema de raiz · azul: as técnicas desta aula · verde: componentes da paleta onde você o encontra no playground. Todo componente herda um desses problemas — pergunte qual antes de colocá-lo num projeto.</p>

---

## Modelos de replicação

| | Um líder | Vários líderes | Sem líder |
|---|---|---|---|
| Quem escreve | um líder | um por região | qualquer réplica |
| Conflitos de escrita | ✅ nenhum | ⚠️ sim | ⚠️ sim |
| Consistência forte | ✅ possível | ❌ não entre líderes | ⚠️ só aproximada |
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
| **Linearizável** | comporta-se como cópia única, atualidade em tempo real | ❌ não |
| **Causal** | causa antes do efeito, para todos | ✅ **sim** |
| **Read-your-writes** | você vê as próprias escritas | sim (por sessão) |
| **Leituras monotônicas** | sua visão nunca volta no tempo | sim (por sessão) |
| **Eventual** | réplicas convergem se as escritas pararem | sim |

- Linearizável para **assentos, dinheiro, unicidade, líderes**.
- Garantias de sessão via leitura no líder após escrita, **tokens de número de sequência do log (LSN, *log sequence number*)**, réplicas fixas.
- Conflitos eventuais: **last-write-wins (LWW)** perde escritas; vetores de versão; **tipos de dados replicados livres de conflito (CRDTs)**.

---

## CAP: durante uma partição, escolha

<p class="small">Consistência, disponibilidade e tolerância a partições (CAP, *Consistency, Availability, Partition tolerance*): um armazenamento replicado não garante as três.</p>

<div class="flow">
<div class="box">Fã A<small>reserva A-12</small></div><div class="arrow">→</div>
<div class="box accent">nó A · maioria<small>A-12 = HELD</small></div>
<div class="arrow">✗ partição ✗</div>
<div class="box">nó B · minoria<small>A-12 = FREE</small></div><div class="arrow">←</div>
<div class="box">Fã B<small>A-12 está livre?</small></div>
</div>
<div class="flow">
<div class="box red">CP — o nó B recusa: 503, nenhum assento vendido duas vezes<small>etcd, ZooKeeper, Spanner, PostgreSQL síncrono</small></div>
<div class="box orange">AP — o nó B responde "FREE": reconcilia depois<small>Cassandra (padrão), DNS, CDN, caches</small></div>
</div>

<div class="warn">

**P não é opcional** — "CA" não é escolha para dados replicados. E o C do CAP é **linearizabilidade**, não o C do ACID (atomicidade, consistência, isolamento, durabilidade).

</div>

<!--
DNS = sistema de nomes de domínio; CDN = rede de distribuição de conteúdo. O simulador da página reproduz os dois modos com um link São Paulo – Lisboa.
-->

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
| Contador de assentos restantes | **leituras monotônicas** | réplica fixa / cache com tempo de vida (TTL) curto |
| Catálogo, imagens | **AP / eventual** | réplicas, cache, CDN |
| Contadores de interesse | **eventual (CRDT)** | contadores por região mesclados |

<p class="small">Multirregião (ativo–ativo particionado por origem): cada evento tem uma <b>região de origem</b> (a do local do show) — a consistência forte fica local e uma partição só recusa as reservas que precisam atravessá-la.</p>

---

## Consenso: concordar sobre um log

- **Máquina de estado replicada**: mesmos comandos, mesma ordem → mesmo estado em todo nó.
- **Segurança** sempre (nunca duas decisões diferentes); **vivacidade** quando a rede se comporta.
- **FLP** (Fischer, Lynch, Paterson): nenhum algoritmo determinístico sempre termina num sistema assíncrono → timeouts.
- **Maiorias se sobrepõem** → sem split brain.

---

## Split brain e por que a maioria o impede

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">lado da maioria · 3 de 5</div>
<div class="box green">nó 1 · líder</div><div class="box green">nó 2</div><div class="box green">nó 3</div>
</div>
<div class="arrow" style="align-self: center">✗ partição ✗</div>
<div class="group">
<div class="caption">lado da minoria · 2 de 5</div>
<div class="box muted">nó 4</div><div class="box muted">nó 5</div>
</div>
</div>
<div class="flow">
<div class="box green">elege e confirma: continua vendendo assentos</div>
<div class="box red">não chega a 3 votos: rejeita escritas, 503</div>
</div>

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

<p class="small">Padrões do etcd: heartbeat de 100 ms, election timeout de 1.000 ms → a queda de um líder custa ~1–2 s sem escritas. Usado por etcd, Consul, CockroachDB, Kafka KRaft (*Kafka Raft*).</p>

---

## Quóruns sem líder: R + W > N

| N = 3 | W | R | R + W > N? | Comportamento |
|---|---|---|---|---|
| `ONE` / `ONE` | 1 | 1 | ❌ não | o mais rápido, pode estar desatualizado |
| `QUORUM` / `QUORUM` | 2 | 2 | ✅ **sim** | vê a última escrita confirmada, tolera 1 fora |
| `ALL` / `ONE` | 3 | 1 | ✅ sim | um nó fora bloqueia as escritas |

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

## Atômico entre serviços? Two-phase commit (2PC)

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
| 3 | **cobra** o cartão — o pivô, quando dá certo | estorna |
| 4 | assento `SOLD`, pedido `CONFIRMED` | — retry até dar certo |

- **Orquestrada** (um cérebro, p. ex. `order` ou Temporal) ou **coreografada** (eventos).
- Sem isolamento → **locks semânticos** com expiração; todo passo **idempotente**.
- Cada passo grava banco + evento atomicamente com um **outbox transacional**.

---

## Reservas: try, confirm, cancel

<div class="flow">
<div class="box">FREE</div><div class="arrow">try: reserva por 10 min →</div>
<div class="box orange">HELD<small>expira sozinho</small></div><div class="arrow">confirm: pago →</div>
<div class="box green">SOLD</div>
</div>
<div class="flow">
<div class="box orange">HELD</div><div class="arrow">cancel: liberação ou expiração →</div>
<div class="box">FREE</div>
</div>

- O padrão try–confirm–cancel (TCC): cada participante oferece uma operação **provisória** com um timeout.
- Pagamentos com cartão têm o mesmo formato: **autorizar** → **capturar** ou **cancelar** (*void*).
- Todo estado provisório expira → uma queda em qualquer lugar **converge para um estado seguro** em vez de bloquear.

<!--
O BoxOffice já funciona assim: o hold é o try, a venda é o confirm, a expiração ou liberação é o cancel.
-->

---

## Sem relógio global

- O quartzo deriva: 20 partes por milhão (ppm) ≈ **1,7 s/dia**; o protocolo de tempo de rede (NTP, *Network Time Protocol*) mantém os servidores a ~ms — se continuar rodando.
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
| **Relógio lógico híbrido (HLC, *hybrid logical clock*)** | causal + perto do tempo real, 64 bits | CockroachDB, YugabyteDB, MongoDB |
| **TrueTime** | incerteza limitada, **commit wait** | Spanner |
| **Autoridade única** | ordem total a partir de um líder | sequence do banco, `UPDATE` condicional |
| **Chave Kafka → partição** | ordem por chave | eventos de um show |
| **Snowflake / UUIDv7** | ids únicos, aproximadamente ordenados por tempo | chaves — **não** "quem chegou primeiro" |

---

## Takeaways

1. Distribua só por **escala, tolerância a falhas, latência, isolamento, residência**; falhar vira a regra.
2. **Lento ≈ morto** para quem chama: timeouts + retries **idempotentes** (escritas condicionais, chaves de idempotência).
3. **Entrega** exatamente uma vez é impossível → pelo menos uma vez + processamento idempotente.
4. Escolha um **modelo de consistência por domínio de dados**: linearizável para assentos e dinheiro, read-your-writes para os dados do usuário, eventual para o catálogo.
5. **CAP** nas partições, **PACELC** todo dia; particione por **região de origem**; **sagas + outbox**, não 2PC, entre serviços.
6. **Maiorias** (3 ou 5 nós), **Raft**, `R + W > N`, **fencing tokens** — use o etcd, não o construa.
7. Nunca ordene eventos por timestamps de máquinas diferentes.
