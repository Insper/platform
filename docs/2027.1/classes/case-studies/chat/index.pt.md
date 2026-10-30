
> *"Projete um aplicativo de chat como o WhatsApp ou o Slack: conversas individuais e em grupo, confirmações de entrega e de leitura, presença online, e tem que funcionar em celulares com rede instável."*

O chat é o problema clássico **com estado e em tempo real**. Todo o resto desta disciplina prefere servidores sem estado atrás de um balanceador de carga; o chat precisa de milhões de **conexões de longa duração**, então os servidores que as seguram têm estado e o sistema precisa saber *em qual* servidor cada usuário está conectado. Por cima disso vêm as perguntas que separam níveis: como **ordenar** mensagens sem um relógio global, como entregar **exatamente uma vez na tela** numa rede que repete envios, e o que acontece com uma mensagem enviada para alguém cujo celular está num túnel?

O BoxOffice também tem chat: cada evento tem um grupo de fãs onde quem tem ingresso conversa antes e durante o show, e os fãs falam com atendentes sobre seus pedidos. Num festival, dezenas de milhares de fãs no mesmo grupo do evento é o follow-up do "canal gigante" desta página.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star::material-star: difícil |
| **Conceitos-chave** | WebSockets e gateways de conexão com estado, registro de sessões, roteamento por pub/sub, números de sequência por conversa, IDs de mensagem do cliente e deduplicação, confirmações de entrega/leitura, armazenar-e-encaminhar e sincronização entre dispositivos, presença com heartbeats, armazenamento wide-column particionado por conversa |
| **Componentes da paleta** | [`lb`](../../../reference/components/edge/index.md#lb), [`app`](../../../reference/components/compute/index.md#app), [`pubsub`](../../../reference/components/messaging/index.md#pubsub), [`nosql`](../../../reference/components/storage/index.md#nosql), [`cache`](../../../reference/components/storage/index.md#cache), [`notifications`](../../../reference/components/compute/index.md#notifications), [`objstore`](../../../reference/components/storage/index.md#objstore) |
| **Cenário do playground** | `chat` |

!!! abstract "O que este caso treina"

    - **Escolher** um transporte em tempo real (WebSocket, SSE, long polling) e **projetar** uma frota de gateways de conexão com estado.
    - **Rotear** uma mensagem até o gateway que segura a conexão do destinatário, com um registro de sessões e pub/sub.
    - **Garantir** a ordem por conversa e a exibição exatamente uma vez em cima de uma entrega pelo-menos-uma-vez.
    - **Projetar** a entrega offline e a sincronização entre dispositivos com cursores por dispositivo, e uma presença que não derrete o sistema.
    - **Modelar** o armazenamento de mensagens para acesso de muita escrita e ordenado no tempo.

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

([roteiro de entrevista](../../intro/interview-framework/index.md))

### Requisitos funcionais { #functional-requirements }

1. Conversas **individuais e em grupo** (grupos de até, digamos, 500 membros).
2. Enviar e receber mensagens de **texto** em tempo real; mídia (imagens, áudio) como anexos.
3. **Confirmações de entrega e de leitura** (✓ enviada, ✓✓ entregue, lida).
4. **Presença online** e "visto por último".
5. **Entrega offline**: mensagens para um usuário offline chegam quando ele reconecta, mais uma **notificação push**.
6. **Vários dispositivos** por usuário (celular + desktop), todos sincronizados; o histórico persiste.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta |
|---|---|
| **Latência** | Mensagem entregue a um destinatário online com p99 < 500 ms de ponta a ponta |
| **Ordem** | Mensagens numa conversa aparecem na mesma ordem para todos os membros |
| **Entrega** | Nenhuma mensagem perdida depois que o servidor confirmou; nenhuma duplicata na tela |
| **Escala** | 50 M de usuários diários, ~15 M de conexões simultâneas no pico |
| **Disponibilidade** | 99,99% para envio; a queda de um gateway reconecta seus usuários em segundos |
| **Durabilidade** | Histórico mantido por anos |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Detalhes do protocolo de criptografia de ponta a ponta (cite que ele muda busca e moderação), chamadas de voz/vídeo, busca de mensagens, bots. Canais de transmissão gigantes ficam para um follow-up.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Tamanho máximo de grupo? | Grupos pequenos → fan-out por membro; canais gigantes → fan-out por gateway, sem confirmações por usuário. |
    | Vários dispositivos por usuário? | Estado de entrega e leitura passa a ser por dispositivo; cursores de sincronização por dispositivo. |
    | Por quanto tempo o histórico é guardado? No servidor, sequer? | Estilo WhatsApp (apagado do servidor após a entrega) vs. estilo Slack (pesquisável para sempre). |
    | Criptografia de ponta a ponta? | O servidor não lê o conteúdo: sem busca no servidor, sem moderação, sem prévia no push. |
    | Presença é exigida em grupos? | O fan-out de presença costuma ser a funcionalidade mais cara. |
    | Usuários no mundo todo? | Regiões, onde uma conversa "mora", latência entre regiões. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

```python exec="1" source="tabbed-right"
# Chat: assumptions (illustrative)
dau             = 50_000_000
msgs_per_user   = 40            # messages sent per user per day
peak_factor     = 3
online_share    = 0.3           # share of DAU connected at peak
conns_per_gw    = 50_000        # WebSocket connections one gateway node holds comfortably
group_share     = 0.3           # share of messages sent to groups
avg_group       = 20            # members per group
msg_b           = 300           # message + metadata, bytes
replication     = 3
heartbeat_s     = 30            # app-level heartbeat interval

msgs_day        = dau * msgs_per_user
msg_qps         = msgs_day / 86_400
peak_msg_qps    = msg_qps * peak_factor
deliveries_qps  = peak_msg_qps * ((1 - group_share) * 1 + group_share * avg_group)
connections     = dau * online_share
gateways        = connections / conns_per_gw
heartbeats_qps  = connections / heartbeat_s
storage_tb_day  = msgs_day * msg_b * replication / 1e12
storage_pb_year = storage_tb_day * 365 / 1e3

rows = [
    ("msgs_day", msgs_day, "msgs"), ("msg_qps", msg_qps, "msgs/s"),
    ("peak_msg_qps", peak_msg_qps, "msgs/s"), ("deliveries_qps", deliveries_qps, "deliveries/s"),
    ("connections", connections, "sockets"), ("gateways", gateways, "nodes"),
    ("heartbeats_qps", heartbeats_qps, "pings/s"), ("storage_tb_day", storage_tb_day, "TB/day"),
    ("storage_pb_year", storage_pb_year, "PB/year"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- **~23 mil mensagens/s em média, ~70 mil no pico**, e o fan-out dos grupos as transforma em **~460 mil entregas/s**. ⇒ a entrega é um problema de roteamento entre muitas máquinas, não um problema de banco de dados.
- **15 M de conexões simultâneas** precisam de **~300 nós de gateway**. ⇒ os gateways são uma frota grande e **com estado**: deploys, quedas e escalonamento desconectam usuários, então a reconexão precisa ser barata e bem-comportada.
- Se cada cliente mandasse um heartbeat de aplicação para um serviço central de presença, seriam **500 mil escritas/s** só para dizer "ainda estou aqui". ⇒ a presença precisa ser derivada da **própria conexão** no gateway, e só as **mudanças** publicadas.
- O histórico cresce **~1,8 TB/dia replicado, ~0,66 PB/ano**. ⇒ um armazenamento horizontalmente escalável e otimizado para escrita (wide-column / LSM), particionado por conversa.

---

## 3. API

O tráfego em tempo real passa por um **WebSocket** por dispositivo; histórico e configuração usam REST comum.

```text
# WebSocket frames (JSON or protobuf), client ⇄ gateway
→ send     {"type":"send", "clientMsgId":"c-7f3a", "conversationId":"g-42", "body":"See you at gate B!"}
← ack      {"type":"ack",  "clientMsgId":"c-7f3a", "msgId":"m-918273", "seq":1043, "ts":1767261600123}
← message  {"type":"msg",  "conversationId":"g-42", "seq":1043, "msgId":"m-918273", "from":"u-7", "body":"…"}
→ receipt  {"type":"receipt", "conversationId":"g-42", "upToSeq":1043, "kind":"delivered|read"}
← presence {"type":"presence", "userId":"u-7", "status":"online|offline", "lastSeen":1767261590000}
→ sync     {"type":"sync", "cursors":{"g-42":1040, "d-7-9":88}}     # after reconnect
```

```http
GET  /v1/conversations?updatedSince=…                   → 200 [conversation summaries, last seq]
GET  /v1/conversations/{id}/messages?beforeSeq=1040&limit=50 → 200 [messages]   (scroll back)
POST /v1/conversations  {"members": ["u-7","u-9"], "name": "Rock in Rio crew"} → 201
POST /v1/media                                           → 201 {mediaId, uploadUrl}
```

- O **`clientMsgId`** é gerado pelo dispositivo de quem envia; um `send` repetido com o mesmo ID é confirmado de novo, mas guardado uma vez só.
- O **`seq`** é atribuído pelo servidor, por conversa, estritamente crescente — a ordem que todos os membros vão exibir.
- As **confirmações** são cumulativas (`upToSeq`): um frame confirma muitas mensagens.

---

## 4. Modelo de dados { #4-data-model }

```sql
-- Messages: partitioned by conversation and time bucket, ordered by seq (wide-column)
CREATE TABLE messages (
    conversation_id TEXT,
    bucket          INT,            -- e.g. days since epoch, or seq / 10 000: bounds partition size
    seq             BIGINT,
    msg_id          TEXT,
    client_msg_id   TEXT,
    sender_id       TEXT,
    body            BLOB,
    created_at      TIMESTAMP,
    PRIMARY KEY ((conversation_id, bucket), seq)
) WITH CLUSTERING ORDER BY (seq DESC);

CREATE TABLE conversation_members (
    conversation_id TEXT, user_id TEXT, joined_at TIMESTAMP, last_read_seq BIGINT,
    PRIMARY KEY ((conversation_id), user_id)
);

CREATE TABLE user_conversations (          -- the "inbox": which conversations, newest first
    user_id TEXT, conversation_id TEXT, last_seq BIGINT, updated_at TIMESTAMP,
    PRIMARY KEY ((user_id), conversation_id)
);
```

```text
# Session registry (Redis): where is each device connected?
session:u-9        → { "phone": "gw-117", "desktop": "gw-031" }    TTL refreshed by the gateway
# Presence (Redis): last seen, only written on state changes
presence:u-9       → { status: "online", lastSeen: 1767261590000 }
# Per-conversation sequence counter (if not owned by a single partition leader)
seq:g-42           → 1043
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Mensagens | NoSQL wide-column (`nosql`), partição `(conversa, bucket)` | Muita escrita, leituras ordenadas no tempo de uma conversa; os buckets limitam o tamanho das partições |
| Membros, inbox | Tabelas NoSQL (ou SQL em escala pequena) | Lidos a cada envio (membros) e ao abrir o app (inbox) |
| Registro de sessões, presença | KV em memória com TTL (`cache`) | Muda o tempo todo; perdê-lo só causa um novo registro |
| Roteamento entre gateways | Pub/sub (`pubsub`): um canal por gateway | Entregar uma mensagem ao nó que segura o socket do destinatário |
| Mídia | Object store (`objstore`) + CDN | Blobs grandes; a mensagem carrega uma referência |
| Alertas offline | Notificações (`notifications`) → APNs / FCM | Acordar dispositivos sem conexão ativa |

---

## 5. Design de alto nível { #5-high-level-design }

``` diagram-sim
flowchart LR
    a([Celular da Alice]) --> lb["Balanceador L4<br/>TCP de longa duração"]
    b([Desktop do Bob]) --> lb
    lb --> gw1["Gateway gw-031<br/>WebSockets"]
    lb --> gw2["Gateway gw-117<br/>WebSockets"]
    gw1 --> cs["Serviço de chat<br/>sequenciador, fan-out"]
    gw2 --> cs
    cs --> db[("Mensagens<br/>wide-column")]
    cs --> reg[("Registro de sessões<br/>+ presença")]
    cs --> ps[["Pub/sub<br/>canal por gateway"]]
    ps --> gw1
    ps --> gw2
    cs --> push["Notificações<br/>APNs / FCM"]
    a -. mídia .-> obj[("Object store + CDN")]
```

A Alice envia uma mensagem ao Bob, que está online em outro gateway:

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as Alice (gw-031)
    participant C as Serviço de chat
    participant D as Banco de mensagens
    participant R as Registro de sessões
    participant P as Pub/sub
    participant B as Bob (gw-117)
    A->>C: send {clientMsgId c-7f3a, conv d-7-9}
    C->>C: seq = next(d-7-9) → 88
    C->>D: insere (d-7-9, 88) se o clientMsgId for novo
    C-->>A: ack {msgId, seq 88}  ✓ enviada
    C->>R: onde está o Bob? → gw-117
    C->>P: publica no canal gw-117
    P->>B: entrega {seq 88}
    B-->>C: confirmação de entrega upToSeq 88
    C-->>A: ✓✓ entregue
```

Se o Bob não tem sessão, o serviço de chat guarda a mensagem (ela já está no banco) e pede ao serviço de notificações um push; o app do Bob busca as mensagens com um `sync` quando reconecta.

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

### 6.1 Segurando milhões de conexões { #61-holding-millions-of-connections }

=== "WebSocket"

    Uma conexão TCP full-duplex por dispositivo, promovida a partir do HTTP ([RFC 6455](https://www.rfc-editor.org/rfc/rfc6455){target="_blank"}). Menor latência e menor overhead por mensagem; exige servidores com estado e balanceamento L4 (ou L7 que entenda WebSocket). O padrão para chat ([protocolos](../../edge/protocols/index.md)).

=== "Server-Sent Events + HTTP POST"

    Servidor → cliente por uma resposta HTTP de longa duração (SSE), cliente → servidor com requisições normais. Mais simples através de proxies, uma direção só; bom para notificações, desajeitado para chat.

=== "Long polling"

    O cliente pergunta "tem novidade?" e o servidor segura a requisição até ter. Funciona em qualquer lugar, mas cada mensagem custa uma nova requisição com cabeçalhos. Um plano B para redes hostis.

Operando a frota de gateways:

- **Gateways só seguram sockets.** Eles autenticam a conexão, registram `usuário/dispositivo → gateway` no registro de sessões, encaminham os frames ao serviço de chat e entregam o que chega no seu canal de pub/sub. Nenhuma lógica de negócio — por isso são simples de escalar e reiniciar.
- **Heartbeats no nível da conexão.** Ping/pong do WebSocket a cada ~30 s detecta conexões mortas (redes móveis caem em silêncio); o gateway renova o TTL das sessões em lote, não uma escrita por ping.
- **Deploys e quedas desconectam usuários.** Drene aos poucos (pare de aceitar, peça aos clientes que reconectem ao longo de minutos) e faça os clientes reconectarem com **backoff exponencial e jitter** — senão 50 000 celulares reconectando no mesmo segundo formam uma **tempestade de reconexão** que derruba o próximo gateway ([padrões de confiabilidade](../../reliability/patterns/index.md)).
- **Apps móveis em segundo plano** não conseguem manter um socket aberto; é para isso que servem as notificações push.

### 6.2 Ordem e exibição exatamente uma vez { #62-ordering-and-exactly-once-display }

Timestamps dos dispositivos não ordenam mensagens: relógios derivam e dois celulares podem discordar em segundos ([tempo e relógios](../../distributed/time-clocks/index.md)). Ordem global é desnecessária e cara. O que os usuários precisam é de **uma ordem por conversa**, a mesma para todos os membros.

- **Um sequenciador por conversa.** Encaminhe todas as escritas de uma conversa para o mesmo dono — uma partição do serviço de chat escolhida por `hash(conversation_id)`, ou uma partição do Kafka com chave pela conversa — que atribui `seq = último + 1`. O dono é o único escritor, então não são necessários locks.
- **Pelo menos uma vez + idempotência = efeito de exatamente uma vez.** O dispositivo repete o `send` até receber um `ack` (a rede pode ter perdido a requisição ou o ack). O servidor deduplica por `(conversation_id, client_msg_id)` e devolve o mesmo `seq` de novo ([semântica de entrega](../../messaging/semantics/index.md)).
- **O dispositivo exibe por `seq`** e deduplica por `msgId`; um buraco (`seq 90` chega antes do `89`) dispara uma espera curta ou um `sync` do intervalo que falta.

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as Celular da Alice
    participant C as Serviço de chat
    A->>C: send c-7f3a "Portão B"
    C->>C: guarda, seq 88
    C--xA: ack perdido (túnel)
    A->>C: repete send c-7f3a "Portão B"
    C->>C: c-7f3a já guardada → seq 88
    C-->>A: ack seq 88 (o mesmo)
    Note over A,C: guardada uma vez, exibida uma vez
```

### 6.3 Entrega offline e sincronização entre dispositivos { #63-offline-delivery-and-multi-device-sync }

- **Guarde primeiro, entregue depois.** Uma mensagem é durável assim que confirmada, esteja o destinatário online ou não; a entrega é uma tentativa de empurrá-la para sockets ativos.
- **Cursor por dispositivo.** Cada dispositivo lembra o último `seq` que tem em cada conversa. Ao reconectar, envia `sync {conversa: últimoSeq}` e recebe tudo o que veio depois — a tabela de inbox diz quais conversas mudaram (`last_seq > cursor`).
- **Notificações push** acordam o dispositivo (APNs no iOS, FCM no Android). Elas levam uma prévia curta ou só "nova mensagem" (sempre a segunda com criptografia de ponta a ponta); o conteúdo é buscado pelo `sync`.
- **O estado de leitura** é por usuário (sincronizado entre dispositivos): ler no desktop limpa o contador no celular por meio de um evento de confirmação.

### 6.4 Presença sem derreter o sistema { #64-presence-without-melting-the-system }

Presença parece barata e não é: toda mudança de status de um usuário interessa a todos os seus contatos.

- Derive a presença da **conexão**: online quando o primeiro dispositivo conecta, offline quando o último desconecta mais um período de tolerância (digamos 30 s, para esconder oscilações da rede).
- Publique **só mudanças**, e só para usuários que estão **online e olhando** (a lista de contatos ou a conversa aberta se inscreve; um app fechado não).
- Em grupos com mais de algumas dezenas de membros, **não faça fan-out de presença** — mostre "visto por último" sob demanda.
- Guarde o `lastSeen` com TTL no cache; tudo bem perdê-lo.

!!! tip "Na entrevista"

    Desenhe cedo o gateway e o registro de sessões e diga a frase-chave: *"Os gateways têm estado, então eu os mantenho burros: seguram sockets e roteiam frames; ordem, armazenamento e fan-out ficam num serviço de chat sem estado, particionado por conversa."*

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Queda / deploy de gateway | 50 mil usuários desconectados de uma vez; tempestade de reconexão | Backoff com jitter nos clientes; drenagem gradual; capacidade sobrando | Usuários veem "conectando…" por segundos |
| Registro de sessões desatualizado | Mensagem roteada para um gateway que o usuário deixou | TTL + novo registro ao conectar; em falha de entrega, cair para push + sync | Pushes extras, raros |
| Conversa quente | Um grupo enorme satura a partição do seu sequenciador | Dividir por bucket; em canais de transmissão, relaxar confirmações por usuário | Garantias mais fracas para grupos enormes |
| Fan-out de grupo | 500 entregas por mensagem | Fan-out por **gateway** (uma publicação por nó que tem membros), não por usuário | Mais lógica nos gateways |
| Acks perdidos / retentativas | Mensagens duplicadas | Dedupe por `clientMsgId` no servidor, por `msgId` no dispositivo | Estado de deduplicação por conversa |
| Chegada fora de ordem | Mensagens exibidas na ordem errada | Exibir pelo `seq` do servidor; detectar buracos dispara sync | Pequeno atraso nos buracos |
| Tempestade de presença | Milhões de atualizações de status | Só mudanças, só para inscritos, sem presença em grupos grandes | Presença menos "ao vivo" |
| Limites do provedor de push | Throttling ou queda de APNs/FCM | Agrupar notificações por conversa; retentar com backoff | Alertas atrasados para usuários offline |

Os trade-offs para **dizer em voz alta**: **ordem por conversa, não global** (barata e suficiente), **pelo menos uma vez + dedupe em vez de "entrega exatamente uma vez"** (a única garantia honesta sobre uma rede), e **gateways com estado mantidos burros** (estado na conexão, lógica em outro lugar).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

O cenário `chat` tem gateways segurando conexões WebSocket, uma camada de pub/sub entre eles e armazenamento para as mensagens.

!!! tip "Experimente"

    1. Rode com o perfil **load** e observe a vazão do pub/sub, a utilização dos gateways e o p99 de entrega.
    2. Aumente a carga até um gateway saturar; acrescente réplicas de gateway e observe o gargalo migrar para o pub/sub ou o banco.
    3. Ligue o caos para derrubar um gateway: veja o pico de reconexões atingir os nós restantes. O que o backoff com jitter mudaria?
    4. Remova o pub/sub e ligue os gateways direto no banco (polling): compare a latência e a carga no banco.

<div class="sdp" data-scenario="chat" data-mode="full" data-height="640" data-profile="load"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "Como você suportaria um canal de evento com 100 000 fãs online durante um festival?"

    Vira **transmissão** (*broadcast*), não chat em grupo. Cada gateway se inscreve uma vez no tópico de pub/sub do canal e entrega localmente aos membros conectados nele, então uma mensagem custa uma publicação por gateway (centenas), não uma por usuário (100 000). Abandone confirmações de entrega/leitura por usuário e a presença, acrescente **modo lento** (rate limit por membro) e moderação, e deixe quem entra atrasado buscar só as últimas N mensagens. Persista as mensagens como sempre; elas são poucas comparadas aos leitores.

??? question "Por que não ordenar as mensagens por timestamp?"

    Os relógios dos dispositivos erram por segundos ou minutos, e os relógios de servidores em máquinas diferentes discordam por milissegundos — o suficiente para reordenar uma troca rápida. Um **número de sequência por conversa** atribuído pelo servidor, emitido por um único dono daquela conversa, dá uma ordem total com a qual todos os membros concordam. Os timestamps ficam só para exibição.

??? question "O que muda com criptografia de ponta a ponta?"

    O servidor roteia e guarda apenas **texto cifrado**. Cada dispositivo tem suas próprias chaves, então uma mensagem para um grupo é cifrada por dispositivo destinatário (ou com um protocolo de chave de grupo), o que aumenta o fan-out. O servidor não consegue mais buscar, moderar conteúdo nem mostrar prévias nas notificações push; a sincronização entre dispositivos exige distribuir chaves entre os dispositivos do usuário. A arquitetura (gateways, sequenciamento, armazenar-e-encaminhar) continua a mesma.

??? question "Um gateway morre. Mensagens podem se perder?"

    Não as confirmadas. Quem envia só vê ✓ depois que o serviço de chat guardou a mensagem, então uma mensagem a caminho de um gateway morto continua no banco. O destinatário reconecta (em outro gateway), envia `sync` com seus cursores e recebe toda mensagem depois do seu último `seq`. A única perda é latência.

??? question "Como implementar 'apagar para todos' e edições?"

    Como **novos eventos** na conversa: `edit {targetSeq, newBody}` e `delete {targetSeq}` recebem seu próprio `seq`, são entregues como mensagens e os clientes os aplicam à mensagem anterior. A linha original é atualizada ou marcada com lápide (*tombstone*) no armazenamento. Ordenar por `seq` faz as edições chegarem depois da mensagem que modificam.

??? question "Como guardar anos de histórico de forma eficiente?"

    Particione por `(conversa, bucket de tempo)` para nenhuma partição crescer sem limite, mantenha os buckets recentes em armazenamento rápido e compacte os antigos; um armazenamento wide-column com motor LSM combina com o padrão de muita escrita e só inserção (o Discord migrou seu armazenamento de mensagens do Cassandra para o ScyllaDB por esse padrão de acesso). A mídia vai para object storage com regras de ciclo de vida.

??? question "Como você levaria isso para várias regiões?"

    Os usuários conectam nos gateways da região mais próxima. Cada conversa tem uma **região de origem** que é dona do seu sequenciador e do armazenamento primário; mensagens de usuários de outras regiões são encaminhadas para lá (acrescentando latência entre regiões só para eles) e replicadas de volta de forma assíncrona para leitura. Mover a região de origem para onde está a maioria dos membros é uma otimização.

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Uma API REST para enviar e consultar mensagens; uma tabela de mensagens; talvez WebSockets sem explicar o roteamento entre servidores. |
| **Pleno** | Gateways WebSocket, um registro de sessões e pub/sub para rotear entre eles; mensagens guardadas por conversa; usuários offline recebem push e sincronizam ao reconectar; confirmações. |
| **Sênior** | Sequenciamento por conversa com um único dono; pelo menos uma vez + dedupe por `clientMsgId` para exibição exatamente uma vez; cursores por dispositivo; presença derivada das conexões e publicada como mudanças só para inscritos; tempestades de reconexão e drenagem de gateways; particionamento do armazenamento com buckets; fan-out de grupo vs. transmissão; trade-offs da criptografia de ponta a ponta; regiões de origem em multirregião. |

**Relacionados:** [Protocolos (WebSockets, SSE)](../../edge/protocols/index.md), [Semântica de mensageria](../../messaging/semantics/index.md), [Particionamento](../../databases/partitioning/index.md), [Caso do sistema de notificações](../notification-system/index.md), [Hands-on 7](../../../hands-on/7/index.md).

!!! success "Boas práticas"

    - **Ordene as mensagens por conversa, com uma sequência atribuída pelo servidor** — uma ordem global não é necessária nem viável; a ordem por conversa é a que os usuários veem.
    - **Deduplique por um id de mensagem gerado no cliente** — um cliente que repete depois de reconectar não pode postar a mesma mensagem duas vezes.
    - **Esvazie os gateways aos poucos num deploy** — peça aos clientes que reconectem ao longo de alguns minutos; fechar todos os sockets de uma vez é uma tempestade de reconexões.
    - **Expire a presença com heartbeats e um TTL** — uma conexão que cai nunca envia "tchau"; sem TTL, os usuários ficam online para sempre.
    - **Escale os gateways por conexões abertas, não por CPU** — conexões são o recurso que acaba primeiro num chat ocioso.

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["Chat"]) --> EDG["Edge<br/>WebSockets, L4 LB, stateful gateways"]:::tech
    CASE --> MSG["Messaging<br/>pub/sub per gateway, at-least-once"]:::tech
    CASE --> DIS["Distributed<br/>per-conversation sequence, no device clocks"]:::tech
    CASE --> DB["Databases<br/>wide-column, partition by conversation"]:::tech
    CASE --> REL["Reliability<br/>reconnect storms: backoff + jitter"]:::tech
    CASE --> CMP["Compute<br/>push for offline devices"]:::tech
    EDG -.-> k1["lb · app"]:::comp
    MSG -.-> k2["pubsub"]:::comp
    DB -.-> k3["nosql · cache<br/>(session registry)"]:::comp
    CMP -.-> k4["notifications"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Borda — protocolos](../../edge/protocols/index.md) · [Borda — balanceamento de carga](../../edge/load-balancing/index.md) · [Mensageria — semântica](../../messaging/semantics/index.md) · [Distribuídos — tempo e relógios](../../distributed/time-clocks/index.md) · [Bancos de dados — particionamento](../../databases/partitioning/index.md) · [Confiabilidade — padrões](../../reliability/patterns/index.md) · [Hands-on 7](../../../hands-on/7/index.md). **Componentes da paleta:** [`lb`](../../../reference/components/edge/index.md#lb) · [`app`](../../../reference/components/compute/index.md#app) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`cache`](../../../reference/components/storage/index.md#cache) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`objstore`](../../../reference/components/storage/index.md#objstore) · [`cdn`](../../../reference/components/edge/index.md#cdn). **Cenários:** `chat`.

---

## Referências { #references }

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 12 "Design a Chat System"[^1].
- O protocolo WebSocket[^2].
- Como o Discord guarda mensagens em escala[^3].
- LAMPORT, L. *Time, Clocks, and the Ordering of Events in a Distributed System*[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: FETTE, I.; MELNIKOV, A. [RFC 6455 — The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455){target="_blank"}. IETF, 2011.
[^3]: INGRAM, B. [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages){target="_blank"}. Discord Blog, 2023.
[^4]: LAMPORT, L. Time, Clocks, and the Ordering of Events in a Distributed System. *Communications of the ACM*, 21(7), 1978.
