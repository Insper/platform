O assento A-12 está reservado para o Bruno. Às 10:00:00.040 (tempo real) ele desiste e o libera pelo `inventory-1`; vinte milissegundos depois, às 10:00:00.060, a Carla o pega pelo `inventory-2`. As duas atualizações são replicadas para os outros nós, e o armazenamento resolve o conflito com a regra mais comum que existe — **last write wins** (a última escrita vence) por timestamp. Mas o relógio do `inventory-1` está **50 ms adiantado**: a liberação do Bruno recebe o carimbo 10:00:00.090, e a reserva da Carla, 10:00:00.060. A liberação "vence", o assento aparece como FREE, e a Carla — que já foi cobrada — fica sem assento. Nenhuma mensagem se perdeu e nenhum código tinha bug: o sistema simplesmente confiou em dois relógios que discordavam.

Um sistema distribuído **não tem relógio global**. Cada máquina tem o seu, eles se afastam uns dos outros, e o atraso de rede entre elas é variável e desconhecido — então "o que aconteceu primeiro?" não tem resposta de graça. Esta página mostra o que relógios físicos conseguem e não conseguem fazer, e as ferramentas que ordenam eventos sem confiar neles: relógios lógicos, relógios vetoriais, relógios híbridos, TrueTime e simples autoridades únicas.

---

## Dois relógios em toda máquina { #two-clocks }

Todo sistema operacional oferece dois relógios diferentes, e confundi-los é um bug clássico:

| | Relógio de parede (hora do dia) | Relógio monotônico |
|---|---|---|
| **Responde** | "Que data e hora são?" | "Quanto tempo passou?" |
| **Java** | `System.currentTimeMillis()`, `Instant.now()` | `System.nanoTime()` |
| **Linux** | `CLOCK_REALTIME` | `CLOCK_MONOTONIC` |
| **Pode pular?** | **Sim** — o NTP o ajusta de uma vez, um administrador o altera, segundos bissextos | Nunca anda para trás |
| **Comparável entre máquinas?** | Aproximadamente (dentro do erro de sincronização) | **Não** — seu zero é arbitrário em cada máquina |
| **Use para** | Timestamps mostrados a pessoas, datas, *prazos* de expiração guardados em um banco | Timeouts, durações, rate limiting, métricas de latência |

```java title="Durations.java"
// Wrong: if NTP steps the wall clock during the call, the "duration" can be negative or huge
long start = System.currentTimeMillis();
callPaymentProvider();
long elapsedMs = System.currentTimeMillis() - start;

// Right: the monotonic clock only measures elapsed time, and never goes backwards
long t0 = System.nanoTime();
callPaymentProvider();
long elapsedNs = System.nanoTime() - t0;
```

---

## Relógios físicos derivam { #drift }

O relógio de um computador é um oscilador de quartzo, e o quartzo é imperfeito: sua frequência depende da temperatura e do cristal. A deriva é medida em **ppm** (partes por milhão): 20 ppm significam 20 µs ganhos ou perdidos por segundo — cerca de **1,7 segundo por dia**. O Google supõe um limite de 200 ppm para seus servidores[^1]. Abandonados à própria sorte, os relógios de duas máquinas divergem sem limite.

O **NTP** (*Network Time Protocol*) corrige isso perguntando periodicamente a servidores de tempo (organizados em *estratos*, sendo o estrato 0 formado por relógios atômicos ou GPS) e ajustando o relógio local — aos poucos (*slewing*) para pequenas diferenças, com um salto (*stepping*) para grandes. Sua precisão é limitada pelo **atraso da rede**, que ele não consegue medir exatamente: o NTP supõe que a ida e a volta levaram o mesmo tempo, então atrasos assimétricos viram erro de relógio.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

# Illustrative: three servers whose quartz clocks drift at different rates (ppm =
# microseconds per second). NTP polls every 64 s and corrects each clock to the
# reference, with a residual error of up to +/- 1 ms. One server loses NTP at t = 600 s.
rng = np.random.default_rng(42)
t = np.arange(0, 1200, 1.0)                     # seconds
fig, ax = plt.subplots(figsize=(8, 3.8))
for name, ppm, color, ntp_until in [("inventory-1 (+15 ppm)", 15, "#2f6fed", 1200),
                                    ("inventory-2 (-25 ppm)", -25, "#1e9e5a", 1200),
                                    ("inventory-3 (+40 ppm, NTP lost at 600 s)", 40, "#e5484d", 600)]:
    offset = rng.uniform(-1, 1)
    series = []
    for s in t:
        if s % 64 == 0 and s < ntp_until:
            offset = rng.uniform(-1, 1)            # ms of residual error after a sync
        else:
            offset += ppm / 1000                   # ppm * 1 s = ppm microseconds = ppm/1000 ms
        series.append(offset)
    ax.plot(t, series, color=color, lw=1.6, label=name)
ax.axhline(0, color="#888", lw=0.6)
ax.set_xlabel("time, s")
ax.set_ylabel("clock offset from true time, ms")
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="upper left")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Os servidores sincronizados ficam a poucos milissegundos uns dos outros (um dente de serra: derivam, corrigem, derivam); o que perdeu o NTP se afasta silenciosamente — 24 ms depois de dez minutos a 40 ppm, e mais de três segundos depois de um dia. Nada alerta por padrão. Ordens de grandeza típicas (ilustrativas; dependem muito da montagem):

| Sincronização | Precisão típica | Observações |
|---|---|---|
| Nenhuma (quartzo livre) | Segundos por dia | Nunca aceitável para servidores |
| NTP pela internet pública | De milissegundos a dezenas de ms | Rotas assimétricas acrescentam erro |
| NTP dentro de um data center / serviço de tempo da nuvem | Abaixo de um milissegundo a ~1 ms | Por exemplo, Amazon Time Sync Service, NTP interno do Google |
| PTP (*Precision Time Protocol*, IEEE 1588) com timestamps em hardware | Microssegundos | Exige suporte na placa de rede/switch; oferecido em algumas instâncias de nuvem |
| GPS + relógios atômicos por data center (TrueTime do Google) | ε de poucos ms, **com um limite conhecido** | Veja [TrueTime](#truetime) |

!!! info "Segundos bissextos e smearing"
    De tempos em tempos um **segundo bissexto** era acrescentado ao UTC (Tempo Universal Coordenado), e relógios ingênuos repetiam um segundo ou pulavam — derrubando software em 2012. Google, AWS e outros agora fazem **smearing**: desaceleram levemente seus relógios ao longo de ~24 horas para que nenhum segundo se repita. Em 2022 a Conferência Geral de Pesos e Medidas decidiu parar de acrescentar segundos bissextos até 2035[^2]. Lição: até "que horas são" tem casos de borda operacionais.

---

## Por que timestamps não ordenam eventos { #lww }

A história de abertura, passo a passo. Cada nó carimba sua escrita com o próprio relógio de parede; a replicação entrega as duas escritas aos dois nós; o **last-write-wins** (LWW) fica com o maior timestamp:

``` diagram-sim
sequenceDiagram
    participant B as Bruno
    participant I1 as inventory-1 (relógio +50 ms)
    participant I2 as inventory-2 (relógio certo)
    participant C as Carla
    B->>I1: libera A-12 (tempo real .040)
    Note over I1: carimbado .090
    C->>I2: reserva A-12 (tempo real .060)
    Note over I2: carimbado .060
    I1->>I2: replica a liberação @ .090
    I2->>I1: replica a reserva @ .060
    Note over I1,I2: LWW: .090 > .060, a liberação vence<br/>a reserva da Carla é descartada em silêncio
```

Com relógios sincronizados dentro de ε, dois eventos separados por menos de ε **não podem ser ordenados** por seus timestamps — e, em um armazenamento LWW, o nó com o relógio **mais adiantado** vence todo conflito. O Cassandra usa LWW por coluna por padrão, e o mesmo vale para qualquer lógica de merge "vence o `updated_at` maior" que você mesmo escreva. LWW é aceitável quando perder uma de duas escritas concorrentes é inofensivo (uma foto de perfil); é perigoso para assentos e dinheiro.

A saída é parar de perguntar aos relógios *quando* algo aconteceu e perguntar, em vez disso, **o que poderia ter influenciado o quê**.

---

## Relógios de Lamport { #lamport }

O artigo de Leslie Lamport de 1978[^3] — um dos mais citados da computação — observou que o que importa é a relação **aconteceu-antes** (*happened-before*, →):

- se *a* e *b* acontecem no mesmo processo e *a* vem primeiro, então *a* → *b*;
- se *a* é o envio de uma mensagem e *b* o seu recebimento, então *a* → *b*;
- se *a* → *b* e *b* → *c*, então *a* → *c* (transitividade).

Se nem *a* → *b* nem *b* → *a*, os eventos são **concorrentes** (*a* ∥ *b*): nenhum poderia ter influenciado o outro.

Um **relógio de Lamport** é um contador por processo com três regras:

1. Antes de cada evento local, incremente o contador.
2. Ao enviar uma mensagem, anexe o contador.
3. Ao receber uma mensagem com *t*, faça o contador valer `max(local, t) + 1`.

``` diagram-sim
sequenceDiagram
    participant O as order
    participant K as consumidor Kafka (inventory)
    participant N as notification
    Note over O: cria o pedido 981 (L=1)
    O->>K: OrderPaid (L=2)
    Note over K: recebe: max(0, 2) + 1 = 3
    Note over N: evento local não relacionado (L=1)
    K->>N: TicketIssued (L=4)
    Note over N: recebe: max(1, 4) + 1 = 5
```

A garantia tem um só sentido: **se *a* → *b*, então L(*a*) < L(*b*)**. A recíproca não vale — L(*a*) < L(*b*) **não** prova que *a* aconteceu antes de *b*; eles podem ser concorrentes. Desempatar pelo id do nó dá uma **ordem total** consistente com a causalidade, o que basta para muitos algoritmos (o *termo* do Raft é um contador no estilo de Lamport). O que um relógio de Lamport não consegue é **detectar** concorrência.

---

## Relógios vetoriais { #vector-clocks }

Um **relógio vetorial** mantém **um contador por nó**. Cada nó incrementa a própria posição em um evento local, anexa o vetor inteiro às mensagens e, ao receber, pega o máximo elemento a elemento (e então incrementa a própria posição). Comparar dois vetores responde à pergunta que os relógios de Lamport não respondem:

- *V(a)* ≤ *V(b)* elemento a elemento (e diferentes) → *a* → *b*;
- *V(b)* ≤ *V(a)* → *b* → *a*;
- nenhum dos dois → **concorrentes**: um conflito real que precisa de resolução.

Três réplicas do carrinho da Carla (contadores `[SP, LIS, NYC]`):

| Passo | Réplica | Operação | Vetor | Relação |
|---|---|---|---|---|
| 1 | SP | adiciona ingresso do evento 42 | `[1, 0, 0]` | — |
| 2 | LIS | recebe o passo 1, adiciona vaga de estacionamento | `[1, 1, 0]` | passo 1 → passo 2 |
| 3 | NYC | recebe o passo 1, remove o ingresso | `[1, 0, 1]` | passo 1 → passo 3 |
| 4 | comparar | passo 2 vs passo 3 | `[1,1,0]` vs `[1,0,1]` | **concorrentes**: nenhum é ≤ o outro |

O armazenamento guarda as duas versões (*irmãos*, *siblings*) e pede à aplicação que as mescle — exatamente o que o Dynamo, da Amazon, fazia com o carrinho de compras (merge por união, e é por isso que itens apagados às vezes voltavam)[^4]. O Riak expunha o mesmo modelo.

``` diagram-sim
sequenceDiagram
    participant SP as réplica SP
    participant LIS as réplica LIS
    participant NYC as réplica NYC
    Note over SP: adiciona ingresso [1,0,0]
    SP->>LIS: replica [1,0,0]
    SP->>NYC: replica [1,0,0]
    Note over LIS: adiciona estacionamento [1,1,0]
    Note over NYC: remove ingresso [1,0,1]
    LIS->>NYC: replica [1,1,0]
    Note over NYC: [1,1,0] vs [1,0,1]: concorrentes<br/>guarda os dois, mescla na aplicação
```

Os dois relógios lado a lado, em três serviços do BoxOffice:

<div class="csim" data-sim="clocks"></div>

!!! tip "Experimente"
    O cenário abre com dois eventos selecionados: `i2` (inventory libera o assento A-12, L=2, `[0,0,2]`) e `p1` (payment recebe `OrderPlaced`, L=3, `[2,1,0]`). Lamport diz 2 < 3, mas os vetores são incomparáveis — os eventos são **concorrentes**, e nada nos números de Lamport poderia ter mostrado isso. Agora clique em `o1` e depois em `i3`: `[1,0,0]` ≤ `[2,2,3]`, então `o1` → `i3` por meio de duas mensagens, e os números de Lamport concordam (1 < 5), como precisam. Clique num único evento para ver seu passado causal (anéis verdes) e seu futuro (azuis). Por fim, adicione um evento local em order (`o3`, `[3,0,0]`) e compare-o com `i3`: concorrentes. Envie uma mensagem de order para inventory e receba-a: o recebimento tem `o3` no seu passado.

O custo é o tamanho: o vetor cresce com o número de nós (ou clientes) que escrevem. Sistemas práticos usam **vetores de versão** com uma posição por *réplica* (não por cliente) e podam posições antigas.

---

## Relógios lógicos híbridos { #hlc }

Relógios lógicos capturam causalidade, mas não têm nada a ver com o tempo real — você não consegue perguntar "qual era o estado às 10:00:00?". Relógios físicos ficam perto do tempo real, mas não capturam causalidade. Um **relógio lógico híbrido** (HLC, *hybrid logical clock*, Kulkarni et al., 2014)[^5] combina os dois em um único timestamp de tamanho fixo `(l, c)`:

- `l` é o maior tempo físico que o nó já **viu** (o do próprio relógio ou o de qualquer mensagem);
- `c` é um contador lógico que desempata quando `l` não avança.

```python title="hlc.py"
import time

class HLC:
    def __init__(self):
        self.l, self.c = 0, 0                 # (physical part in ms, logical counter)

    def now(self):                             # local event or send
        pt = int(time.time() * 1000)
        if pt > self.l:
            self.l, self.c = pt, 0
        else:
            self.c += 1                        # wall clock did not advance: count
        return (self.l, self.c)

    def update(self, ml, mc):                  # on receiving a message stamped (ml, mc)
        pt = int(time.time() * 1000)
        new_l = max(self.l, ml, pt)
        if new_l == self.l == ml:
            self.c = max(self.c, mc) + 1
        elif new_l == self.l:
            self.c += 1
        elif new_l == ml:
            self.c = mc + 1
        else:
            self.c = 0
        self.l = new_l
        return (self.l, self.c)
```

Timestamps HLC respeitam a causalidade (como os relógios de Lamport), ficam dentro do erro de sincronização em relação ao tempo real (então servem para snapshots do tipo "leia como estava às 10:00:00") e cabem em 64 bits. **CockroachDB**, **YugabyteDB** e **MongoDB** (cluster time) os usam. Eles ainda dependem de um **limite** para a defasagem dos relógios: o CockroachDB, por exemplo, tem um offset máximo configurado (500 ms por padrão), e um nó que detecta estar mais defasado que isso se desliga em vez de arriscar inconsistência[^6].

---

## TrueTime e Spanner { #truetime }

O **Spanner** do Google[^1] seguiu o caminho oposto: em vez de evitar o tempo físico, torná-lo **confiável**. Cada data center tem receptores GPS e relógios atômicos, e a API **TrueTime** não devolve um instante, e sim um **intervalo**: `TT.now() = [earliest, latest]`, com garantia de conter o tempo verdadeiro, com uma incerteza ε que o artigo relata ser tipicamente de 1–7 ms.

Para tornar as transações **externamente consistentes** (se T1 confirma antes de T2 começar, o timestamp de T2 é maior), o Spanner usa a **espera de commit** (*commit wait*): escolhe o timestamp de commit *s* = `TT.now().latest` e então **espera até que `TT.now().earliest > s`** antes de tornar o commit visível — isto é, até que *s* esteja garantidamente no passado em todo lugar.

``` diagram-sim
sequenceDiagram
    participant C as cliente
    participant S as líder do Spanner
    participant TT as TrueTime
    C->>S: commit de T1
    S->>TT: now()
    TT-->>S: [10:00:00.100, 10:00:00.106]
    Note over S: s = .106 (latest), replica via Paxos enquanto isso
    S->>TT: now() até earliest > .106
    TT-->>S: [10:00:00.107, 10:00:00.113]
    S-->>C: confirmado em s = .106
    Note over C,S: qualquer transação posterior recebe s' > .106
```

O custo da correção é, literalmente, **esperar a incerteza passar** (em média ~2ε por commit, sobreposto à replicação do Paxos). Um ε menor significa commits mais rápidos, e por isso o Google investe em relógios. A AWS publicou depois uma API open source parecida, a **ClockBound**, que devolve limites de erro em instâncias EC2.

---

## Ordenação na prática { #in-practice }

A maioria dos sistemas nunca implementa relógios vetoriais nem TrueTime. Eles obtêm ordem de fontes mais simples — e vale saber o que cada uma garante:

| Técnica | O que ordena | Garantia | Uso típico |
|---|---|---|---|
| **Autoridade única** (um primário de banco, `now()` e sequences nele) | Tudo o que passa por ela | Ordem total, um relógio | Reservas de assento, números de pedido, expiração de reservas |
| **Offsets de partição do Kafka** | Mensagens dentro de uma partição | Ordem total por partição (por chave) | Todos os eventos de um show do BoxOffice em uma partição |
| **Lamport / termos do Raft** | Eventos causalmente relacionados | Causal → número menor | Épocas de líder, fencing tokens |
| **Vetores / vetores de versão** | Versões de um item | Detecta concorrência | Armazenamentos sem líder, apps de sincronização/offline |
| **HLC** | Todos os eventos de um cluster | Causal + perto do tempo real | CockroachDB, YugabyteDB, MongoDB |
| **TrueTime** | Todas as transações, globalmente | Consistência externa | Spanner |
| **IDs ordenados por tempo** (Snowflake, UUIDv7, ULID) | IDs por momento de criação, aproximadamente | Ordenáveis, únicos; **não** causais entre máquinas | Chaves primárias, ids de log/evento |

Um **ID Snowflake** (Twitter, 2010) empacota em um inteiro de 64 bits um timestamp de 41 bits em milissegundos, um id de máquina de 10 bits e uma sequência de 12 bits por milissegundo — até 4.096 ids por milissegundo por máquina, únicos sem coordenação e aproximadamente ordenáveis por tempo. O **UUIDv7** (RFC 9562, 2024)[^7] padroniza a mesma ideia em um UUID de 128 bits com um prefixo de 48 bits em milissegundos Unix: índices B-tree ficam compactos porque as chaves novas são acrescentadas no fim, em vez de espalhadas como os UUIDv4 aleatórios.

```java title="Snowflake.java"
// 64-bit id: 41 bits of ms since a custom epoch | 10 bits machine id | 12 bits sequence
final class Snowflake {
    private static final long EPOCH = 1735689600000L;   // 2025-01-01T00:00:00Z
    private final long machineId;                         // 0..1023, assigned per instance
    private long lastMs = -1, seq = 0;

    Snowflake(long machineId) { this.machineId = machineId; }

    synchronized long next() {
        long now = System.currentTimeMillis();
        if (now < lastMs) now = lastMs;                   // clock stepped back: do not go backwards
        if (now == lastMs) {
            seq = (seq + 1) & 0xFFF;                      // 4096 ids per ms
            if (seq == 0) while ((now = System.currentTimeMillis()) <= lastMs) { }  // wait next ms
        } else {
            seq = 0;
        }
        lastMs = now;
        return ((now - EPOCH) << 22) | (machineId << 12) | seq;
    }
}
```

??? question "Pense antes: dois pedidos recebem os ids Snowflake 7,31e17 e 7,29e17 de duas réplicas diferentes de `order`. Dá para concluir qual pedido foi feito primeiro?"

    Só aproximadamente. Os ids embutem o **relógio de parede** de cada máquina, então, com relógios sincronizados a poucos milissegundos, ids gerados com mais do que isso de diferença ficam corretamente ordenados — mas dois pedidos com um milissegundo de diferença em máquinas diferentes podem sair em qualquer ordem. IDs ordenados por tempo são ótimos para a localidade do índice e para listagens "mais novos primeiro, aproximadamente"; **não** são fonte de ordem causal ou total entre máquinas. Se a ordem importa (quem pegou o último assento), deixe uma autoridade única decidir — o `UPDATE` condicional no primário do `inventory`.

!!! example "BoxOffice: de onde vêm o tempo e a ordem"
    - **Quem pegou o assento A-12** — decidido pelo único primário do `inventory` daquele evento (`UPDATE` condicional); nenhum timestamp é comparado.
    - **Expiração da reserva** — `expires_at = now() + interval '10 minutes'` calculado **pelo PostgreSQL no primário**, e o processo de varredura compara com o `now()` do mesmo banco: um relógio só, então a defasagem entre os servidores de aplicação é irrelevante.
    - **Ordem dos eventos** — todo evento sobre um show (`SeatHeld`, `SeatReleased`, `OrderPaid`) é publicado com chave Kafka = `eventId`, então eles caem em **uma partição** e todo consumidor os vê na mesma ordem.
    - **IDs** — pedidos e ingressos usam **UUIDv7**: únicos sem coordenação, bons para o índice, aproximadamente ordenáveis por tempo — nunca usados para decidir *quem chegou primeiro*.
    - **Durações e timeouts** — medidos com o relógio monotônico (`System.nanoTime()`), nunca com diferenças de relógio de parede.
    - **Monitoramento** — um alerta sobre o offset do NTP por nó (por exemplo, > 50 ms), porque uma máquina que perdeu o NTP fica em silêncio caso contrário.

!!! example "No código do BoxOffice: quem decide quando uma reserva expira (lab 6)"

    O [Hands-on 6 — Reservas](../../../hands-on/6/holds/index.md) segue a regra da autoridade única onde ela mais importa: quem ficou com o assento é decidido por um `UPDATE` condicional no primário, e o varredor que libera reservas expiradas compara `expires_at` com o `now()` **do banco**, usando `FOR UPDATE SKIP LOCKED` para que várias réplicas do `inventory` o rodem ao mesmo tempo sem liberar a mesma reserva duas vezes. Olhe com atenção para o `expires_at`, porém: ele é calculado **em Java**, com o relógio da réplica do `inventory`, e conferido contra o relógio do banco — a armadilha abaixo, em miniatura. Num laptop todos os contêineres compartilham um relógio, então nada aparece; em produção a diferença entre uma réplica e o banco (milissegundos com NTP, muito mais sem ele) desloca o fim de cada reserva na mesma medida. Calculá-lo em SQL, `expires_at = now() + :ttl`, como diz o quadro acima, elimina o segundo relógio.

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldService.java (two clocks)" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldService.java:52:53,189:208"
    ```

!!! tip "Na entrevista"
    Quando um projeto compara timestamps de máquinas diferentes ("a última atualização vence", "ordene as mensagens do chat por `created_at`"), diga em voz alta: *"relógios derivam, então timestamps de servidores diferentes não ordenam eventos mais próximos do que a defasagem."* Depois ofereça a solução que se encaixa: uma **autoridade única** (sequence ou escrita condicional em um líder), um **log ordenado por chave** (partição do Kafka por chave), um **contador lógico/de versão** (concorrência otimista com uma coluna `version`) ou um **banco baseado em HLC** se precisar de ordem global. Para "projete um gerador de IDs únicos", Snowflake / UUIDv7 com seus layouts de bits é a resposta esperada (Alex Xu, vol. 1, cap. 7)[^8].

!!! success "Boas práticas"

    - **Guarde e troque timestamps em UTC com offset explícito** — colunas `timestamptz`, ISO 8601 nas APIs; o horário local repete uma hora por ano onde há horário de verão. Na BoxOffice: `created_at TIMESTAMPTZ` na tabela `payments` do lab 9.
    - **Particione os eventos pela entidade cuja ordem importa** — uma chave, uma partição, uma ordem para todo consumidor. Na BoxOffice: o relay do lab 7 publica `order-events` com chave = id do pedido ([Hands-on 7 — Outbox](../../../hands-on/7/outbox/index.md)).
    - **Decida "quem mudou por último" com um contador de versão, não com um timestamp** — `version = version + 1` em toda escrita é imune à diferença entre relógios. Na BoxOffice: `inventory.seats.version` (lab 6).
    - **Rode o chrony com várias fontes de tempo e deixe-o ajustar devagar (slew), sem saltos, em produção** — um relógio ajustado devagar nunca volta para trás debaixo de um processo em execução.
    - **Use ids ordenados no tempo (UUIDv7) em novas chaves primárias** — as inserções ficam no fim do índice B-tree; chaves UUIDv4 aleatórias espalham as escritas por ele.

!!! warning "Armadilhas"
    - **Medir durações com o relógio de parede** — latências negativas ou enormes quando o NTP ajusta o relógio; use o relógio monotônico.
    - **LWW em dados em que as duas escritas importam** — perda silenciosa de dados, com viés a favor do nó com o relógio mais adiantado.
    - **Expiração calculada em uma máquina e verificada em outra** — uma reserva de 10 minutos pode expirar cedo ou tarde na medida da defasagem; calcule e compare no mesmo relógio (o do banco).
    - **Supor que IDs ordenados por tempo são causalmente ordenados** — a ordem de Snowflake/UUIDv7 é tão boa quanto a sincronização dos relógios.
    - **Não monitorar o offset dos relógios** — um nó que perdeu o NTP deriva em silêncio até algo quebrar.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    DRIFT["deriva do relógio<br/>NTP, PTP"] --> LWW["LWW perde escritas"]
    LWW --> VV["vetores de versão, CRDTs<br/>→ Replicação e Consistência"]
    HB["aconteceu-antes"] --> LAM["relógios de Lamport"]
    LAM --> TERMS["termos do Raft, fencing tokens<br/>→ Consenso"]
    HB --> VEC["relógios vetoriais"] --> VV
    DRIFT --> HLC["relógios lógicos híbridos"]
    LAM --> HLC
    DRIFT --> TT["TrueTime<br/>commit wait"]
    HLC --> SNAP["snapshots consistentes<br/>CockroachDB, YugabyteDB"]
    TT --> SNAP
    AUTH["autoridade única<br/>now() do banco, offsets do Kafka"] --> PRAC["ordenação na prática"]
    IDS["Snowflake, UUIDv7"] --> PRAC
```

**Componentes da paleta que fornecem ordem ou tempo:** [`sql`](../../../reference/components/storage/index.md#sql) (sequences, `now()` no primário) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (offsets por partição) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (gatilhos por relógio de parede — cuidado com a defasagem) · [`cache`](../../../reference/components/storage/index.md#cache) (expiração por TTL). **Continua em:** [Mensageria — Kafka](../../messaging/kafka/index.md) (ordenação por chave), [Estudo de caso: encurtador de URL](../../case-studies/url-shortener/index.md) (ids únicos), [Observabilidade](../../observability/index.md) (defasagem de relógio em traces).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - **Não há relógio global**: relógios de quartzo derivam (ppm), o NTP os mantém a milissegundos uns dos outros — não idênticos, e não se ele parar.
    - Use o relógio **monotônico** para durações e timeouts, e o relógio **de parede** só para timestamps voltados a pessoas.
    - **Timestamps de máquinas diferentes não ordenam eventos** mais próximos do que a defasagem; o **LWW** perde escritas.
    - **Relógios de Lamport**: *a* → *b* ⇒ L(*a*) < L(*b*); **relógios vetoriais** também detectam concorrência; o **HLC** dá causalidade perto do tempo real em 64 bits; o **TrueTime** limita a incerteza e espera ela passar.
    - Na prática, obtenha ordem de uma **autoridade única**, de um **log particionado** por entidade ou de uma coluna de **versão** — e use Snowflake/UUIDv7 para ids únicos e ordenáveis, não para decidir quem chegou primeiro.

---

[^1]: CORBETT, J. C. et al. [Spanner: Google's Globally-Distributed Database](https://research.google/pubs/spanner-googles-globally-distributed-database-2/){target="_blank"}. OSDI, 2012.
[^2]: BIPM. [Resolução 4 da 27ª CGPM (2022): On the use and future development of UTC](https://www.bipm.org/en/cgpm-2022/resolution-4){target="_blank"}.
[^3]: LAMPORT, L. [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.azurewebsites.net/pubs/time-clocks.pdf){target="_blank"}. Communications of the ACM, 1978.
[^4]: DECANDIA, G. et al. [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf){target="_blank"}. SOSP, 2007.
[^5]: KULKARNI, S. et al. [Logical Physical Clocks and Consistent Snapshots in Globally Distributed Databases](https://cse.buffalo.edu/tech-reports/2014-04.pdf){target="_blank"}. OPODIS, 2014.
[^6]: COCKROACH LABS. [Living Without Atomic Clocks](https://www.cockroachlabs.com/blog/living-without-atomic-clocks/){target="_blank"}, 2016.
[^7]: IETF. [RFC 9562 — Universally Unique IDentifiers (UUIDs)](https://www.rfc-editor.org/rfc/rfc9562){target="_blank"}, 2024.
[^8]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Capítulo 7, "Design a unique ID generator in distributed systems".
