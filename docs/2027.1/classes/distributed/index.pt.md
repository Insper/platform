São 10:00:00 e o show no estádio abre as vendas. Dois milhões de fãs apertam **"Reservar assento"** no app do BoxOffice praticamente no mesmo segundo, e 60.000 assentos precisam ser divididos entre eles — cada assento vendido **exatamente uma vez**. Uma fã, dentro do trem, aperta o botão, o spinner gira por cinco segundos e o app mostra *"Algo deu errado, tente novamente"*. Ela aperta de novo. A primeira requisição reservou um assento? Ela está prestes a reservar dois? Vai ser cobrada duas vezes?

Em uma única máquina essa pergunta não existiria: a função retornou ou lançou uma exceção. O BoxOffice, porém, roda em dezenas de máquinas — gateways, várias réplicas do serviço `inventory`, um PostgreSQL replicado, Redis, um cluster Kafka — e a única coisa que as conecta é uma rede capaz de perder, atrasar e duplicar mensagens. Isso faz do BoxOffice um **sistema distribuído**, e esta aula trata do que isso muda.

Um sistema distribuído é um conjunto de computadores independentes (**nós**) que cooperam **apenas trocando mensagens** por uma rede, **sem memória compartilhada e sem relógio compartilhado**, e que aparecem para seus usuários como um único sistema coerente[^1]. A definição meio em tom de brincadeira de Leslie Lamport é a mais útil para um engenheiro: *"um sistema distribuído é aquele em que a falha de um computador que você nem sabia que existia pode tornar o seu próprio computador inutilizável"*[^2].

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Justificar** quando distribuir um sistema (escala, tolerância a falhas, latência, isolamento) e **listar** o que isso custa.
    - **Classificar** falhas com os modelos de falha clássicos (crash, omissão, temporização, bizantina, falha cinza) e **reconhecer** as 8 falácias da computação distribuída em um projeto.
    - **Explicar** por que quem chama não consegue distinguir um nó lento de um nó morto, e **projetar** operações reexecutadas para serem **idempotentes** (chaves de idempotência, escritas condicionais).
    - **Comparar** modelos de replicação e modelos de consistência (linearizável → causal → read-your-writes → eventual) e **escolher** um por domínio de dados.
    - **Aplicar** CAP e PACELC para justificar um trade-off entre consistência, disponibilidade e latência.
    - **Dimensionar** um cluster de consenso (Raft, quóruns `R + W > N`) e **explicar** eleição de líder, split brain e fencing.
    - **Escolher** entre two-phase commit e uma saga (com compensações, reservas e um outbox) para uma operação que abrange vários serviços.
    - **Ordenar** eventos entre máquinas sem confiar em relógios de parede (relógios de Lamport, vetoriais e híbridos, TrueTime).

## Roteiro

1. **Esta visão geral** — por que distribuir, o que isso custa, modelos de falha, a rede não confiável (8 falácias), timeouts, semânticas de entrega e **idempotência**.
2. [Replicação e Consistência](consistency/index.md) — replicação com um líder, com vários líderes e sem líder; o espectro de consistência, de linearizável a eventual; garantias de sessão como read-your-writes.
3. [CAP e PACELC](cap-pacelc/index.md) — a escolha entre consistência e disponibilidade durante uma partição, a escolha entre latência e consistência no resto do tempo, e projetos multirregião.
4. [Consenso e Quóruns](consensus/index.md) — maiorias, Raft (eleição e replicação do log), `R + W > N`, leases e fencing tokens, e as ferramentas que fazem isso por você.
5. [Transações Distribuídas](transactions/index.md) — atomicidade entre serviços: two-phase commit e por que ele bloqueia, sagas com compensações, reservas try–confirm–cancel e o outbox transacional.
6. [Tempo e Relógios](time-clocks/index.md) — NTP e deriva de relógio, relógios de Lamport e vetoriais, relógios lógicos híbridos, TrueTime e como ordenar eventos na prática.
7. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/distributed.html" title="Slides: sistemas distribuídos" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/distributed.html){:target="_blank"}

---

## Por que distribuir? { #why-distribute }

Ninguém distribui um sistema por diversão: um único processo com um único banco de dados é mais fácil de escrever, testar, depurar e entender. Só pagamos o preço da distribuição quando uma máquina não consegue mais atender a um **requisito não funcional**:

| Motivo | O que uma máquina não consegue fazer | No BoxOffice |
|---|---|---|
| **Escalabilidade** | Atender mais requisições, guardar mais dados ou executar mais computação do que sua CPU, memória, disco ou placa de rede permitem | 2 M de fãs no primeiro minuto de uma abertura de vendas; um servidor não consegue nem aceitar tantas conexões TLS |
| **Tolerância a falhas / disponibilidade** | Sobreviver à própria falha — um disco, uma fonte, um kernel panic, um deploy que deu errado | Se a única máquina do `inventory` morre às 10:00:05, a venda para |
| **Latência** | Estar perto de todos os usuários; a luz na fibra leva ~100 ms para atravessar meio planeta (~20.000 km), só de ida | Fãs em Lisboa e em São Paulo esperam um mapa de assentos rápido |
| **Isolamento e organização** | Permitir que times façam deploy de forma independente, ou conter uma falha em uma parte do produto | Um bug em `search` não deve parar o `payment` |
| **Residência de dados** | Manter dados pessoais em uma jurisdição (por exemplo, LGPD no Brasil, GDPR na Europa) | Os dados dos fãs europeus ficam em uma região da UE |

Escalar verticalmente — uma máquina maior — é a primeira resposta e, por um tempo, muitas vezes a certa. Ela para de funcionar por três motivos: existe uma maior máquina que se pode comprar; no topo, o preço cresce mais rápido que a capacidade; e, por maior que seja, ela continua sendo **uma** máquina — um ponto único de falha (SPOF, *single point of failure*).

??? question "Pense antes: se uma máquina é mais simples, por que não rodar o BoxOffice no maior servidor que o dinheiro pode comprar?"

    Provavelmente ele aguentaria o dia **médio**. Mas (1) o pico da abertura das vendas às 10:00 está ordens de grandeza acima da média, e a máquina ficaria ociosa (e paga) no resto do tempo; (2) qualquer falha — hardware, sistema operacional, um deploy ruim — derruba a empresa **inteira**, o que viola qualquer meta razoável de disponibilidade; (3) fãs longe dessa máquina pagam o tempo de ida e volta em toda requisição. Você ainda usa escala vertical para componentes difíceis de dividir (um banco de dados primário), mas acrescenta réplicas e espalha o trabalho sem estado por muitas máquinas.

### Em escala, falhar é a regra

O segundo argumento esconde um paradoxo: distribuir para tolerar falhas significa usar **mais** máquinas, e mais máquinas significam **mais falhas**. Se cada máquina falha em um dado dia com uma pequena probabilidade $p$, de forma independente, a probabilidade de que **pelo menos uma** de $N$ máquinas falhe nesse dia é $1 - (1-p)^N$:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

nodes = np.logspace(0, 4, 200)          # 1 to 10,000 machines
fig, ax = plt.subplots(figsize=(8, 3.6))
for p, color in [(0.0001, "#1e9e5a"), (0.001, "#2f6fed"), (0.01, "#e5484d")]:
    ax.plot(nodes, 1 - (1 - p) ** nodes, color=color, lw=2,
            label=f"each machine fails with p = {p:g} per day")
ax.set_xscale("log")
ax.set_xlabel("number of machines")
ax.set_ylabel("P(at least one failure today)")
ax.set_ylim(0, 1.02)
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="upper left")
for n in (3, 30, 300, 3000):
    ax.axvline(n, color="#888", lw=0.6, ls=":")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Com uma chance (ilustrativa) de 0,1% de falha por máquina por dia, três máquinas veem uma falha em cerca de 0,3% dos dias, mas uma frota de 3.000 máquinas vê **pelo menos uma falha em cerca de 95% dos dias**. Os primeiros relatos do Google descrevem exatamente essa experiência: na escala de uma frota, falhas de hardware são rotina diária, não exceção[^3]. A conclusão molda o resto do curso: **um sistema distribuído precisa tratar a falha como um evento normal e continuar funcionando apesar dela** — não dá para esperar evitá-la.

### O que a distribuição custa

| Custo | Por quê | Onde volta no curso |
|---|---|---|
| **Falha parcial** | Alguns nós funcionam enquanto outros não; cada chamada pode falhar sozinha | [Modelos de falha](#failure-models), [Confiabilidade](../reliability/index.md) |
| **Rede não confiável** | Mensagens são perdidas, atrasadas, duplicadas, reordenadas | [A rede não é confiável](#network), [Idempotência](#idempotency) |
| **Sem relógio global** | Cada nó tem seu relógio, e eles discordam | [Tempo e Relógios](time-clocks/index.md) |
| **Consistência** | Cópias do mesmo dado podem divergir | [Replicação e Consistência](consistency/index.md), [CAP](cap-pacelc/index.md) |
| **Coordenação** | Concordar sobre qualquer coisa (um líder, um lock, uma ordem, um commit) exige mensagens e maiorias | [Consenso](consensus/index.md), [Transações Distribuídas](transactions/index.md) |
| **Operação** | Mais processos para implantar, observar e depurar | [Observabilidade](../observability/index.md), [Cloud-native](../cloud-native/index.md) |

---

## O BoxOffice é um sistema distribuído

Acompanhe um clique em **"Reservar assento A-12"** pelo BoxOffice. Cada seta é uma mensagem pela rede; cada caixa é um processo que pode falhar, pausar ou ficar lento por conta própria:

``` mermaid-sim
flowchart LR
    fan([Celular do fã]) -->|"POST /holds"| gw[gateway]
    gw -->|"valida o token"| auth[auth]
    gw -->|"encaminha"| inv[inventory]
    inv -->|"UPDATE seat ... (transação)"| pg[("PostgreSQL primário")]
    pg -->|"replica o WAL"| rep[("PostgreSQL réplica")]
    inv -->|"cacheia o mapa de assentos"| redis[("Redis")]
    inv -->|"evento SeatHeld"| kafka[["Kafka (3 brokers)"]]
    kafka -->|"consome"| notif[notification]
```

Nada nessa figura compartilha memória ou relógio. Se o Redis está lento, o `inventory` espera; se a réplica está atrasada, uma leitura nela está desatualizada; se o Kafka está inacessível, a reserva pode ter sido confirmada no PostgreSQL, mas o evento `SeatHeld` nunca publicado. Cada um desses casos é uma **falha parcial**, e o resto desta página trata de nomeá-las com precisão.

---

## Modelos de falha { #failure-models }

Um **modelo de falha** diz o que um componente defeituoso pode fazer. Ele importa porque todo algoritmo só é correto *sob* algum modelo: um protocolo que tolera crashes pode ser enganado por um nó que mente.

| Modelo | O que o nó (ou enlace) defeituoso faz | Exemplo no BoxOffice | Defesa típica |
|---|---|---|---|
| **Crash-stop** | Para e nunca mais volta | Uma VM é encerrada | Réplicas + failover |
| **Crash-recovery** | Para e depois reinicia com o que tinha em disco | Um pod do `inventory` é morto por falta de memória (OOM) e reiniciado | Logs duráveis; reprocessamento idempotente |
| **Omissão** | Descarta silenciosamente algumas mensagens que deveria enviar ou receber | Um buffer de socket cheio descarta o evento `SeatHeld` | Confirmações (acks), retries, timeouts |
| **Temporização (desempenho)** | Responde, mas tarde demais | Uma pausa de 3 segundos de garbage collection no `payment` | Timeouts, hedging, circuit breakers |
| **Bizantina** | Comporta-se de forma arbitrária: corrompe, mente, diz coisas diferentes a nós diferentes | Um bit trocado corrompe uma mensagem; um cliente comprometido forja ingressos | Checksums, assinaturas, validação; protocolos BFT (3f + 1 nós) |
| **Falha cinza** | Parece saudável para o health check, mas falha para os usuários | `/health` responde 200 enquanto toda consulta real dá timeout | Health checks que exercitam o caminho real; sinais do lado do cliente |

Mais duas ideias completam o vocabulário:

- **Falha parcial**: em uma máquina, um programa normalmente funciona ou cai por inteiro. Em um sistema distribuído, parte dele falha enquanto o resto continua rodando, e *ninguém tem uma visão completa* de qual parte. As falhas cinza, estudadas pela Microsoft no Azure, são o pior caso — o monitoramento do próprio sistema discorda dos usuários[^4].
- **Hipóteses de tempo**: em um modelo *síncrono*, mensagens e processamento têm limites superiores conhecidos; em um modelo *assíncrono*, não há limite algum. Redes reais são **parcialmente síncronas**: comportam-se bem na maior parte do tempo, com atrasos ocasionais sem limite (um switch congestionado, uma pausa de GC, a migração de uma VM). Algoritmos práticos (o Raft, por exemplo) são projetados para serem **seguros** sob assincronia e para **progredir** apenas quando a rede se comporta.

!!! info "A falha mais comum não é um crash"
    Crashes são fáceis: o processo sumiu, as conexões são recusadas, o orquestrador o reinicia. As falhas que doem em produção são respostas **lentas**, falhas **parciais** e falhas **cinza** — o nó está lá, atendendo algumas requisições, segurando suas threads.

---

## A rede não é confiável { #network }

### As 8 falácias da computação distribuída

Nos anos 1990, L. Peter Deutsch e colegas da Sun Microsystems listaram as suposições que iniciantes em sistemas distribuídos fazem — todas falsas[^5]:

| Falácia | Realidade | No BoxOffice |
|---|---|---|
| 1. A rede é confiável | Pacotes são descartados, enlaces caem, switches reiniciam | A conexão `inventory → PostgreSQL` é resetada no meio de uma transação |
| 2. A latência é zero | Mesmo data center ≈ 0,5 ms de ida e volta; entre continentes ≈ 150 ms[^6] | Seis chamadas sequenciais de 30 ms cada fazem um checkout de 180 ms |
| 3. A largura de banda é infinita | Enlaces saturam, principalmente nos picos | Devolver o mapa completo de 60.000 assentos em JSON para 2 M de fãs |
| 4. A rede é segura | O tráfego pode ser lido, alterado ou forjado | Serviços confiam em qualquer chamador dentro do cluster |
| 5. A topologia não muda | Nós entram e saem; IPs mudam | Um pod do Kubernetes é reagendado com um novo IP durante a abertura das vendas |
| 6. Existe um administrador | Muitos times, contas, provedores e políticas | O provedor de pagamentos muda uma configuração de TLS do lado dele |
| 7. O custo de transporte é zero | Serialização custa CPU; tráfego de saída na nuvem custa dinheiro | Tráfego entre zonas na fatura do mês |
| 8. A rede é homogênea | Protocolos, versões e codificações diferentes | Serviços Java, um `assistant` em Python, o protocolo binário do Kafka |

Cada uma delas aparece em aulas posteriores: a falácia 1 em [Confiabilidade](../reliability/index.md), a 2 em [Estimativas](../estimation/index.md), a 3 em [Tráfego e Borda](../edge/index.md), a 4 em [Rede e Segurança](../network-security/index.md), a 5 em [Cloud-native](../cloud-native/index.md).

### Lento ou morto? { #slow-or-dead }

Quando o `inventory` envia uma requisição ao `payment` e nenhuma resposta chega, ele **não tem como saber** qual destes casos aconteceu:

``` mermaid-sim
sequenceDiagram
    participant I as inventory
    participant P as payment
    I->>P: autorizar R$ 450 (requisição 1)
    Note over I,P: (a) requisição perdida  (b) payment caiu<br/>(c) resposta perdida  (d) payment só está lento
    I-->>I: sem resposta após 2 s: timeout
    I->>P: autorizar R$ 450 (retry)
    P-->>I: OK
    Note over I,P: nos casos (c) e (d) o fã foi cobrado duas vezes
```

Do lado de quem chama, uma requisição perdida, um servidor que caiu, uma resposta perdida e um servidor muito lento parecem a mesma coisa: **silêncio**. A única ferramenta prática é um **timeout** — depois de um prazo, *supor* que houve falha. Mas um timeout não diz se a operação foi executada, e daí decorrem duas coisas:

1. **Escolher o timeout é um trade-off.** Longo demais e as threads de quem chama se acumulam esperando (a falha em cascata de [Confiabilidade](../reliability/index.md)); curto demais e você declara mortos nós saudáveis mas lentos, faz retry e adiciona carga justamente quando o sistema está sofrendo. Um ponto de partida comum é um pouco acima da latência p99,9 do serviço chamado, dentro do orçamento de latência de quem chama. Sistemas como Cassandra e Akka vão além e usam detectores de falha *adaptativos* (o detector φ accrual), que aprendem a distribuição normal dos atrasos dos heartbeats[^7].
2. **Retries precisam ser seguros.** Se o retry pode aplicar a operação uma segunda vez, isso precisa ser inofensivo — a operação precisa ser **idempotente**.

---

## Semânticas de entrega e idempotência { #idempotency }

### No máximo uma vez, pelo menos uma vez, exatamente uma vez

Sempre que uma mensagem atravessa uma rede não confiável, o remetente escolhe uma **semântica de entrega**:

| Semântica | Como | Risco | Use para |
|---|---|---|---|
| **No máximo uma vez** (*at most once*) | Envia uma vez, nunca faz retry | Mensagens perdidas | Amostras de métricas, sinais de "fã está digitando…" |
| **Pelo menos uma vez** (*at least once*) | Faz retry até receber confirmação | Duplicatas | Quase tudo: pedidos, eventos, e-mails |
| **Exatamente uma vez** (*exactly once*) | Não é alcançável só pela rede | — | Obtida como **pelo menos uma vez + processamento idempotente** ("efetivamente uma vez") |

"Entrega exatamente uma vez" por uma rede não confiável é impossível em geral — o remetente nunca pode ter certeza de que o destinatário não processou uma mensagem cuja confirmação se perdeu. O que sistemas como o Kafka chamam de *exactly-once* é **processamento** exatamente uma vez: duplicatas podem chegar, mas seu **efeito** é aplicado uma vez, por deduplicação ou transações[^8]. A aula de [Mensageria](../messaging/index.md) aprofunda o tema.

### Operações idempotentes

Uma operação é **idempotente** se aplicá-la várias vezes tem o mesmo efeito que aplicá-la uma vez: $f(f(x)) = f(x)$.

| Operação | Idempotente? | Por quê |
|---|---|---|
| `GET /events/42` | Sim | Leituras não mudam nada |
| `PUT /holds/A-12 {fan: 42}` | Sim | Define o estado como um valor; repetir define o mesmo valor |
| `DELETE /holds/A-12` | Sim | A reserva some na primeira chamada; a segunda pode devolver `404`, mas o **estado** é o mesmo |
| `POST /orders` | **Não** | Cada chamada cria um novo pedido |
| `UPDATE seats SET sold = sold + 1` | **Não** | Cada chamada incrementa de novo |
| `UPDATE seats SET status = 'HELD', fan = 42 WHERE id = 'A-12' AND status = 'FREE'` | Sim | Uma **escrita condicional**: a segunda chamada não encontra nenhuma linha |

Duas técnicas tornam seguras para retry as operações não idempotentes:

1. **Reescrever como uma transição de estado com condição** (*compare-and-set*): "marque o assento como HELD **se** ele estiver FREE", "grave a versão 8 **se** a versão atual for 7". Uma duplicata não satisfaz a condição e não muda nada.
2. **Chaves de idempotência**: o cliente gera uma chave única por operação *pretendida* e a envia em todas as tentativas; o servidor guarda a chave junto com o resultado e, diante de uma duplicata, devolve o resultado guardado em vez de executar de novo. A API pública do Stripe popularizou o cabeçalho `Idempotency-Key`[^9], e há um rascunho do IETF padronizando-o.

``` mermaid-sim
sequenceDiagram
    participant F as App do fã
    participant O as order
    participant DB as PostgreSQL
    F->>O: POST /orders, Idempotency-Key: 7f3a…
    O->>DB: INSERT da chave 7f3a… (única) + pedido 981
    DB-->>O: confirmado (commit)
    O--xF: 201 Created (resposta perdida no trem)
    F->>O: retry: POST /orders, Idempotency-Key: 7f3a…
    O->>DB: INSERT da chave 7f3a…
    DB-->>O: violação de unicidade: a chave já existe
    O->>DB: SELECT da resposta guardada para 7f3a…
    O-->>F: 201 Created, pedido 981 (o mesmo pedido, sem duplicata)
```

A chave e a mudança de negócio precisam ser gravadas **na mesma transação**; caso contrário, um crash entre as duas escritas reabre a janela para duplicatas:

```sql title="idempotency.sql"
CREATE TABLE idempotency_keys (
    key           UUID PRIMARY KEY,
    request_hash  TEXT        NOT NULL,   -- reject the same key with a different body
    response      JSONB,                  -- what we answered the first time
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

BEGIN;
INSERT INTO idempotency_keys (key, request_hash)
VALUES ('7f3a…', 'sha256:…')
ON CONFLICT (key) DO NOTHING;            -- 0 rows inserted → duplicate: return stored response
INSERT INTO orders (id, fan_id, total) VALUES (981, 42, 450.00);
UPDATE idempotency_keys SET response = '{"orderId": 981}' WHERE key = '7f3a…';
COMMIT;
```

!!! example "BoxOffice: reservando um assento com segurança"
    O app gera um UUID quando o fã toca em **Reservar assento** e o reutiliza em todo retry desse toque. O `inventory` executa `UPDATE seats SET status = 'HELD', fan_id = :fan, hold_key = :key WHERE id = :seat AND (status = 'FREE' OR hold_key = :key)`. A primeira tentativa reserva o assento; um retry com a mesma chave encontra a linha de novo e não muda nada; a requisição de um fã **diferente** não encontra nenhuma linha e recebe `409 Conflict`. O adaptador `payment` repassa a mesma chave ao provedor externo, então uma cobrança refeita não é cobrada duas vezes ([Integrações](../compute/integrations/index.md)).

??? question "Pense antes: o retry do fã chega a uma réplica de `order` diferente da primeira tentativa. A chave de idempotência ainda funciona?"

    Só se o estado de deduplicação for **compartilhado** — gravado no banco de dados (como acima) ou em um armazenamento compartilhado como o Redis, e não na memória de uma réplica. Um conjunto em memória de "chaves já vistas" por réplica quebra assim que o load balancer manda o retry para outra réplica, o que é o caso normal. As chaves também precisam de um período de retenção (o Stripe as guarda por 24 horas) longo o bastante para cobrir todos os retries que o cliente pode fazer.

---

## Juntando tudo: o mapa de conceitos { #concept-map }

Os três problemas de raiz — **falha parcial**, uma **rede não confiável** e **nenhum relógio global** — explicam quase todas as decisões de projeto do resto do curso. O mapa abaixo liga cada problema às técnicas desta aula (azul), à subpágina que as ensina e aos **componentes da paleta** em que você as encontrará no playground (verde):

``` mermaid
flowchart LR
    PF["Falha parcial"]:::problem --> REP["Replicação<br/>(manter cópias)"]
    NET["Rede não confiável"]:::problem --> IDEM["Timeouts, retries,<br/>idempotência"]
    CLK["Sem relógio global"]:::problem --> ORD["Ordenação:<br/>relógios lógicos / híbridos"]
    REP --> CM["Modelos de consistência<br/>linearizável … eventual"]
    CM --> CAP["CAP / PACELC<br/>C vs A, L vs C"]
    CAP --> CONS["Consenso, quóruns,<br/>fencing"]
    IDEM --> TX["Sagas, outbox,<br/>2PC"]
    CONS --> TX
    ORD --> CONS
    REP -.-> sql["sql · nosql"]:::comp
    CM -.-> cache["cache · cdn"]:::comp
    CONS -.-> kafka["kafka · scheduler"]:::comp
    IDEM -.-> pay["payment · queue"]:::comp
    TX -.-> stream["stream · kafka"]:::comp
    CAP -.-> dns["dns (multirregião)"]:::comp
    classDef problem fill:#e5484d22,stroke:#e5484d
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
    class REP,IDEM,ORD,CM,CAP,CONS,TX tech
```

| Técnica | Ensinada em | Componentes da paleta em que aparece | Outras aulas que se apoiam nela |
|---|---|---|---|
| Timeouts, retries, chaves de idempotência | [esta visão geral](#idempotency) | [`payment`](../../reference/components/external/index.md#payment), [`thirdparty`](../../reference/components/external/index.md#thirdparty), [`queue`](../../reference/components/messaging/index.md#queue) | [Confiabilidade](../reliability/index.md), [Compute — integrações](../compute/integrations/index.md) |
| Replicação, modelos de consistência | [Replicação e Consistência](consistency/index.md) | [`sql`](../../reference/components/storage/index.md#sql), [`nosql`](../../reference/components/storage/index.md#nosql), [`cache`](../../reference/components/storage/index.md#cache), [`cdn`](../../reference/components/edge/index.md#cdn) | [Bancos de dados — replicação](../databases/replication/index.md), [Caching](../caching/index.md) |
| CAP, PACELC, multirregião | [CAP e PACELC](cap-pacelc/index.md) | [`dns`](../../reference/components/edge/index.md#dns), [`sql`](../../reference/components/storage/index.md#sql), [`nosql`](../../reference/components/storage/index.md#nosql) | [Confiabilidade](../reliability/index.md), [Tráfego e Borda](../edge/index.md) |
| Consenso, quóruns, leases, fencing | [Consenso e Quóruns](consensus/index.md) | [`kafka`](../../reference/components/messaging/index.md#kafka), [`scheduler`](../../reference/components/compute/index.md#scheduler), [`sql`](../../reference/components/storage/index.md#sql) (failover) | [Cloud-native — Kubernetes](../cloud-native/kubernetes/index.md) (etcd), [Bancos de dados — particionamento](../databases/partitioning/index.md) |
| 2PC, sagas, outbox, reservas | [Transações Distribuídas](transactions/index.md) | [`stream`](../../reference/components/messaging/index.md#stream), [`kafka`](../../reference/components/messaging/index.md#kafka), [`payment`](../../reference/components/external/index.md#payment) | [Mensageria — padrões](../messaging/patterns/index.md), [Estudo de caso: sistema de pagamentos](../case-studies/payment-system/index.md) |
| Relógios, ordenação, ids únicos | [Tempo e Relógios](time-clocks/index.md) | [`kafka`](../../reference/components/messaging/index.md#kafka), [`sql`](../../reference/components/storage/index.md#sql), [`scheduler`](../../reference/components/compute/index.md#scheduler) | [Mensageria — Kafka](../messaging/kafka/index.md), [Estudo de caso: encurtador de URL](../case-studies/url-shortener/index.md) |

!!! tip "Na entrevista"
    Raramente perguntarão "o que é um sistema distribuído?". Vão perguntar "o cliente tomou timeout — o que acontece?" ou "como evitar cobrar duas vezes?". Respostas fortes: (1) nomeie a ambiguidade (*"um timeout não me diz se a cobrança aconteceu"*); (2) torne a operação **idempotente** com uma chave de idempotência gravada atomicamente com o resultado; (3) faça retry com backoff e jitter em uma única camada; (4) explicite a semântica de entrega (*"entrega pelo menos uma vez, processamento efetivamente uma vez"*). Falar em "entrega exatamente uma vez" sem ressalvas é um sinal de alerta para o entrevistador.

!!! warning "Armadilhas"
    - **Tratar uma chamada remota como uma chamada de função local** — sem timeout, sem política de retry, sem pensar em falha parcial.
    - **Fazer retry de operações não idempotentes** (`POST`, incrementos) sem chave: duplicatas, cobranças em dobro, assentos vendidos duas vezes.
    - **Deduplicar em memória** em uma réplica: o retry vai para outra réplica.
    - **Health checks que mentem**: `/health` responde `200` porque o processo está vivo, enquanto toda requisição falha (falha cinza).
    - **Supor que as falhas são independentes**: réplicas no mesmo rack, na mesma zona ou com a mesma configuração errada falham juntas.

## Pontos-chave

- Distribua por **escala, tolerância a falhas, latência, isolamento ou residência de dados** — e só então: você paga com falhas parciais, uma rede não confiável e nenhum relógio global.
- Em escala, **falhar é o caso normal**: $1-(1-p)^N$ se aproxima de 1 rapidamente.
- Conheça os **modelos de falha**; os perigosos na prática são as falhas **lentas**, **parciais** e **cinza**, não crashes limpos.
- Quem chama não consegue distinguir **lento de morto**: use timeouts e aceite que uma operação que deu timeout pode ter acontecido.
- **Entrega** exatamente uma vez é impossível; construa **entrega pelo menos uma vez + processamento idempotente** com escritas condicionais ou chaves de idempotência gravadas atomicamente.

## Relacionados

- **Playground:** [System Design Playground](../../../playground/index.md) — todo componente deste curso pode falhar; ligue o caos (`data-chaos`) em qualquer cenário.
- **Hands-on:** [Hands-on 7 — Assíncrono](../../hands-on/7/index.md) (consumidor idempotente, outbox), [Hands-on 9 — Resiliência e caos](../../hands-on/9/index.md) (timeouts, retries, injeção de falhas com Toxiproxy).
- **Exercícios:** [Event-driven](../../exercises/event-driven/index.md) (consumidor idempotente), [Design doc](../../exercises/design-doc/index.md).
- **Estudos de caso:** [Ingressos (abertura de vendas do BoxOffice)](../case-studies/ticketing/index.md), [Sistema de pagamentos](../case-studies/payment-system/index.md), [Cache distribuído](../case-studies/distributed-cache/index.md).
- **Aulas:** [Estimativas](../estimation/index.md) (números de latência), [Bancos de dados — replicação](../databases/replication/index.md), [Mensageria — semânticas](../messaging/semantics/index.md), [Confiabilidade](../reliability/index.md).
- **Preparação para entrevistas:** [Entrevista](../../support/interview/index.md).

---

[^1]: VAN STEEN, M.; TANENBAUM, A. S. [Distributed Systems](https://www.distributed-systems.net/){target="_blank"}, 4ª ed., 2023.
[^2]: LAMPORT, L. [Mensagem de e-mail, 28 de maio de 1987](https://lamport.azurewebsites.net/pubs/distributed-system.txt){target="_blank"}.
[^3]: DEAN, J. [Designs, Lessons and Advice from Building Large Distributed Systems](https://www.cs.cornell.edu/projects/ladis2009/talks/dean-keynote-ladis2009.pdf){target="_blank"}. Palestra de abertura do LADIS, 2009.
[^4]: HUANG, P. et al. [Gray Failure: The Achilles' Heel of Cloud-Scale Systems](https://www.microsoft.com/en-us/research/publication/gray-failure-achilles-heel-cloud-scale-systems/){target="_blank"}. HotOS, 2017.
[^5]: [Fallacies of distributed computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing){target="_blank"} — Wikipedia (Deutsch, 1994; Gosling acrescentou a oitava em 1997).
[^6]: [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832){target="_blank"} — a partir de Jeff Dean e Peter Norvig.
[^7]: HAYASHIBARA, N. et al. [The φ Accrual Failure Detector](https://doi.org/10.1109/RELDIS.2004.1353004){target="_blank"}. IEEE SRDS, 2004.
[^8]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly. Capítulos sobre replicação, transações e processamento de streams.
[^9]: STRIPE. [Idempotent requests](https://docs.stripe.com/api/idempotent_requests){target="_blank"}. Referência da API do Stripe.
