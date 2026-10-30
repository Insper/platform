O mapa de assentos do BoxOffice tem um problema. Durante a venda, os assentos mudam de cor a cada segundo, conforme outros fãs os reservam. A primeira versão do web app pedia `GET /api/events/42/seats` a cada 2 segundos: 2 milhões de fãs × 0,5 requisição por segundo = **1 milhão de requisições por segundo**, a maioria respondendo "nada mudou". Enquanto isso, fãs num trem em São Paulo reclamam que o app "trava" toda vez que o celular troca de antena. Os dois problemas são problemas de **protocolo** — a escolha de como os bytes viajam entre o celular e a borda — e os dois têm boas respostas modernas.

Esta página revisa os protocolos que rodam na borda: as três gerações do HTTP, o handshake TLS que as protege, as opções para atualizações em **tempo real** (polling, long polling, Server-Sent Events, WebSockets) e o gRPC para chamadas entre serviços. O objetivo não é decorar cabeçalhos, mas saber **quanto cada protocolo custa em round trips e conexões**, e para que ele serve.

---

## Round trips são a moeda { #round-trips }

A banda continua crescendo; a velocidade da luz, não. Um **round-trip time** (RTT) é o tempo que um pacote leva para ir até o servidor e voltar: cerca de 1–10 ms dentro de uma cidade, cerca de 30–60 ms atravessando um continente, cerca de 100–200 ms entre continentes. Toda troca de protocolo que espera uma resposta custa pelo menos um RTT, e numa conexão nova há vários deles **antes do primeiro byte de dados**: um para abrir o TCP, um ou dois para o TLS[^7].

É por isso que a história dos protocolos web é, em grande parte, uma história de **remover round trips** e **usar melhor as conexões**.

---

## HTTP/1.1 { #http1 }

O HTTP/1.1 (1997, especificação atual RFC 9112) é um protocolo de texto: o cliente escreve `GET /api/events/42 HTTP/1.1`, cabeçalhos, uma linha em branco; o servidor responde com uma linha de status, cabeçalhos e um corpo[^1].

- **Conexões persistentes (keep-alive)**: uma conexão TCP pode carregar muitas requisições, uma depois da outra, evitando um novo handshake para cada uma.
- **Uma requisição por vez por conexão**: uma segunda requisição precisa esperar até a primeira resposta chegar por completo. Se a primeira resposta é lenta, tudo o que vem atrás espera — **head-of-line (HOL) blocking**. (O pipelining, que deveria resolver isso, nunca foi utilizável na prática.)
- Os navegadores contornam isso abrindo **cerca de 6 conexões paralelas por host**, e os desenvolvedores contornavam *isso* com truques como domain sharding, sprites e bundling.
- Os cabeçalhos são texto puro e se repetem em toda requisição: cookies e user agents podem somar centenas de bytes por requisição.

O HTTP/1.1 ainda está em toda parte — entre um load balancer e seus backends, em clientes simples, no `curl` — e serve perfeitamente para tráfego requisição-resposta de baixa concorrência.

## HTTP/2 { #http2 }

O HTTP/2 (2015, RFC 9113) mantém a mesma semântica — métodos, códigos de status, cabeçalhos — mas muda a forma como eles viajam[^2]:

- **Framing binário**: as mensagens são divididas em frames, cada um marcado com um id de **stream**.
- **Multiplexação**: muitas requisições e respostas viajam **ao mesmo tempo** sobre **uma** conexão TCP, com seus frames intercalados. Uma resposta lenta não bloqueia mais as outras no nível do HTTP.
- **Compressão de cabeçalhos (HPACK)**: cabeçalhos repetidos são enviados como pequenas referências a uma tabela compartilhada pelas duas pontas.
- **Prioridades de stream** e controle de fluxo por stream.

Uma conexão por origem basta, então os truques de domain sharding passam a atrapalhar. Mas um problema permanece, uma camada abaixo: o TCP entrega os bytes **em ordem**. Se um único pacote se perde, o TCP segura *todos* os bytes depois dele — de *todos* os streams — até a retransmissão chegar. Numa rede móvel com perdas, a conexão única do HTTP/2 pode ser mais lenta que as seis do HTTP/1.1. Isso é o **head-of-line blocking do TCP**, e é a razão de ser do HTTP/3.

## HTTP/3 e QUIC { #http3 }

O HTTP/3 (2022, RFC 9114) roda sobre o **QUIC** (RFC 9000), um protocolo de transporte construído sobre **UDP**[^3]. O QUIC traz para o espaço de usuário o que o TCP fazia no kernel, e o redesenha:

- **Streams independentes no transporte**: um pacote perdido só atrasa o stream ao qual pertence; os outros continuam fluindo. Sem head-of-line blocking do TCP.
- **TLS 1.3 embutido**: os handshakes de transporte e criptográfico são combinados, então uma conexão nova precisa de **1 RTT** antes de enviar dados — e uma retomada pode enviar dados já no primeiro pacote (**0-RTT**).
- **Migração de conexão**: uma conexão QUIC é identificada por um **connection ID**, não pelo par (IP, porta). Quando o celular passa do Wi-Fi para o 4G, o IP muda mas a conexão sobrevive — sem novo handshake, sem "travar".
- Sempre criptografado, incluindo a maior parte dos cabeçalhos de transporte, o que também dificulta a interferência de middleboxes.

Os custos: o UDP às vezes é bloqueado ou estrangulado por redes corporativas (os navegadores caem para HTTP/2 automaticamente), o QUIC usa mais CPU que o TCP do kernel, e os load balancers precisam rotear por connection ID para manter as conexões que migram no mesmo servidor. Navegadores, CDNs e as grandes plataformas o adotaram rapidamente; dentro do data center, HTTP/1.1 e HTTP/2 continuam sendo a norma.

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transporte | TCP | TCP | QUIC sobre UDP |
| Formato | texto | frames binários | frames binários |
| Concorrência numa conexão | uma requisição por vez | streams multiplexados | streams multiplexados e independentes |
| Head-of-line blocking | nível HTTP e TCP | só nível TCP | nenhum entre streams |
| Compressão de cabeçalhos | nenhuma | HPACK | QPACK |
| Handshake antes dos dados (conexão nova) | TCP + TLS: 2–3 RTT | TCP + TLS: 2–3 RTT | 1 RTT (0-RTT na retomada) |
| Sobrevive à troca de IP | não | não | sim (migração de conexão) |
| Lugar típico | backends, clientes simples | navegadores, gRPC, interno | navegadores e mobile ↔ CDN/borda |

---

## TLS 1.3: o handshake { #tls }

Toda conexão na borda é criptografada com **TLS**. Antes de qualquer dado HTTP, cliente e servidor precisam combinar chaves, e o cliente precisa verificar o **certificado** do servidor (que ele é mesmo `boxoffice.com`). O TLS 1.2 precisava de **dois** round trips para isso; o **TLS 1.3** (2018, RFC 8446) precisa de **um**, porque o cliente adivinha os parâmetros da troca de chaves e envia sua key share imediatamente[^4].

``` diagram-sim
sequenceDiagram
    participant C as Celular do fã
    participant S as Borda da CDN (boxoffice.com)
    C->>S: TCP SYN
    S-->>C: SYN-ACK
    C->>S: ACK + TLS ClientHello (key share, cifras suportadas, SNI = boxoffice.com)
    S-->>C: ServerHello (key share) + certificado + Finished (criptografado)
    Note over C: verifica o certificado, deriva as chaves
    C->>S: Finished + GET /api/events/42 (criptografado)
    S-->>C: 200 OK (criptografado)
```

Com QUIC, a troca TCP desaparece: o primeiro pacote QUIC já carrega o `ClientHello`, então a requisição sai depois de **um** round trip. Com a **retomada 0-RTT**, um cliente que falou com o servidor recentemente reaproveita uma chave pré-compartilhada e envia a requisição no primeiro voo — com uma ressalva: dados 0-RTT podem ser **reenviados (replay)** por um atacante, então os servidores só aceitam requisições idempotentes (`GET`) em 0-RTT.

O gráfico conta os round trips antes do primeiro byte da resposta numa conexão **nova** (tempo de processamento do servidor ignorado), em três distâncias:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO
plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

# round trips before the first response byte arrives (handshakes + the request itself)
stacks = {
    "TCP + TLS 1.2": 1 + 2 + 1,
    "TCP + TLS 1.3": 1 + 1 + 1,
    "QUIC (HTTP/3)": 1 + 1,
    "QUIC 0-RTT\n(resumed)": 0 + 1,
}
rtts = {"same city\n(RTT 10 ms)": 10, "same continent\n(RTT 50 ms)": 50,
        "intercontinental\n(RTT 150 ms)": 150}
colors = ["#e5484d", "#f59e0b", "#2f6fed", "#1e9e5a"]

fig, ax = plt.subplots(figsize=(9, 4))
x = np.arange(len(rtts))
w = 0.2
for i, ((name, n), c) in enumerate(zip(stacks.items(), colors)):
    vals = [n * r for r in rtts.values()]
    bars = ax.bar(x + (i - 1.5) * w, vals, width=w, color=c, label=f"{name} ({n} RTT)")
    for bx, v in zip(bars, vals):
        ax.text(bx.get_x() + bx.get_width() / 2, v + 6, f"{v}", ha="center", fontsize=8)
ax.set_xticks(x, list(rtts))
ax.set_ylabel("ms until the first response byte")
ax.set_ylim(0, 680)
ax.set_title("Connection setup cost: new connection, server time ignored")
ax.legend(frameon=False, fontsize=8)

plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Duas conclusões. Primeiro, o protocolo importa **mais quando o servidor está longe** — 600 ms contra 150 ms intercontinental —, e é também por isso que as CDNs terminam as conexões perto do usuário: com uma borda na mesma cidade, até o TLS 1.2 custa só 40 ms. Segundo, o melhor handshake é o que você **não repete**: keep-alive e pools de conexão (também entre o gateway e os serviços) fazem o custo de estabelecimento desaparecer para toda requisição depois da primeira.

??? question "Pense antes: o app mobile faz 30 chamadas pequenas à API quando a tela do evento abre. A API está na Virgínia (RTT de 150 ms a partir de São Paulo) e o app abre uma nova conexão HTTP/1.1 com TLS 1.2 para cada chamada, 6 por vez. Quanto tempo isso leva, aproximadamente?"
    Cada chamada numa conexão nova custa 4 RTT ≈ 600 ms; 30 chamadas em lotes de 6 dão 5 lotes ≈ **3 segundos**, antes de qualquer tempo de servidor. Correções, em ordem de impacto: reaproveitar conexões (keep-alive) e **multiplexá-las** com HTTP/2 ou HTTP/3 (as 30 chamadas numa conexão só: 1 handshake + cerca de 1 RTT ≈ 300–450 ms); terminar o TLS numa **borda perto do fã**; e **agregar** as 30 chamadas em uma chamada por tela num BFF ([API gateway](../api-gateway/index.md#bff)).

---

## Tempo real: levando atualizações ao cliente { #real-time }

O HTTP é requisição-resposta: o cliente pergunta, o servidor responde. Para o mapa de assentos, a posição na sala de espera ou um chat, é o *servidor* que sabe quando algo mudou. Há quatro formas de levar essa informação ao cliente.

### Short polling { #polling }

O cliente pergunta a cada *N* segundos: "alguma novidade?". Trivial de implementar e de cachear, mas desperdiçador (a maioria das respostas é "não") e lento para reagir (até *N* segundos de atraso). Polling *com micro-caching na CDN* ([DNS & CDN](../dns-cdn/index.md#micro-caching)) é um design perfeitamente bom para o mapa de assentos quando alguns segundos de atraso são aceitáveis.

### Long polling { #long-polling }

O cliente pergunta, e o servidor **mantém a requisição aberta** até haver novidade (ou um timeout de, digamos, 30 s), e então responde; o cliente pergunta de novo imediatamente. Quase tempo real sobre HTTP comum, mas cada mensagem custa uma requisição completa, e os servidores precisam manter muitas requisições abertas.

### Server-Sent Events (SSE) { #sse }

O cliente abre uma requisição HTTP comum com `Accept: text/event-stream`; o servidor mantém a resposta aberta e **transmite eventos** como linhas de texto, pelo tempo que quiser:

```text title="GET /api/events/42/seats/stream"
event: seat
id: 1842
data: {"seat": "B-12", "status": "held"}

event: seat
id: 1843
data: {"seat": "B-13", "status": "sold"}
```

O SSE é **unidirecional** (servidor → cliente), só texto, e roda sobre HTTP normal — então passa por proxies, CDNs e load balancers, funciona sobre a multiplexação do HTTP/2, e a API `EventSource` do navegador **se reconecta automaticamente**, enviando o último `id` recebido num cabeçalho `Last-Event-ID` para que o servidor possa retomar. É a resposta boa mais simples para "empurrar atualizações para muitos clientes": placares ao vivo, notificações, a posição na sala de espera e o stream token a token de uma resposta de LLM.

!!! example "No código do BoxOffice: o assistente transmite com SSE (lab 12)"

    O assistente do [Hands-on 12 — Tools](../../../hands-on/12/tools/index.md) responde token a token via SSE: o endpoint devolve uma resposta `text/event-stream` com `Cache-Control: no-cache` (nenhum proxy pode fazer buffer ou cache de um stream ao vivo), e cada evento são duas linhas de texto e uma em branco, escritas por um helper de duas linhas em `agent.py`. Nenhuma biblioteca, nenhum upgrade de protocolo — uma resposta HTTP comum que qualquer proxy HTTP consegue repassar, desde que não faça buffer dela. A sala de espera do lab 7 escolheu a opção ainda mais simples: o fã faz **polling** em `GET /orders/waiting-room/{show}/tickets/{id}`.

    ``` { .python title="services/assistant/app/main.py (the stream)" }
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/main.py:72:80"
    ```

### WebSockets { #websockets }

Um **WebSocket** (RFC 6455) começa como uma requisição HTTP/1.1 que pede o **upgrade** da conexão; depois da resposta `101 Switching Protocols`, a conexão TCP vira um canal **full-duplex** de mensagens nos dois sentidos, com overhead por mensagem muito baixo[^5]:

``` diagram-sim
sequenceDiagram
    participant C as Navegador
    participant L as Load balancer (L7)
    participant W as serviço ws
    C->>L: GET /ws (Upgrade: websocket, Sec-WebSocket-Key)
    L->>W: encaminha a requisição de upgrade
    W-->>C: 101 Switching Protocols (Sec-WebSocket-Accept)
    Note over C,W: mesma conexão TCP, agora um canal de mensagens nos dois sentidos
    C->>W: {"type": "join", "room": "event-42"}
    W-->>C: {"type": "seat", "seat": "B-12", "status": "held"}
    C->>W: {"type": "ping"}
    W-->>C: {"type": "pong"}
```

WebSockets são a ferramenta para tráfego **interativo e bidirecional**: chat, jogos multiplayer, edição colaborativa. Eles têm custos operacionais: as conexões são **stateful e de longa duração** (um restart de servidor desconecta milhares de usuários, que se reconectam todos de uma vez), os load balancers precisam suportar o upgrade e timeouts longos de ociosidade, e você precisa de uma espinha dorsal de **pub/sub** para que uma mensagem publicada num servidor chegue aos clientes conectados nos outros (o [estudo de caso de chat](../../case-studies/chat/index.md)).

| | Short polling | Long polling | SSE | WebSockets |
|---|---|---|---|---|
| Direção | cliente puxa | cliente puxa (servidor segura) | servidor → cliente | nos dois sentidos |
| Latência das atualizações | até o intervalo | baixa | baixa | a mais baixa |
| Custo por atualização | uma requisição completa (muitas vezes vazia) | uma requisição completa | poucos bytes | poucos bytes |
| Através de proxies/CDN | fácil, cacheável | fácil | fácil (HTTP comum) | exige suporte a upgrade |
| Reconexão e retomada | n/a | manual | embutida (`Last-Event-ID`) | manual |
| Dados binários | sim | sim | não (texto) | sim |
| Bom para | dashboards, status de baixa frequência | clientes legados | feeds, notificações, progresso, streaming de LLM | chat, jogos, colaboração |

!!! info "WebTransport"
    **WebTransport** é uma API de navegador mais nova, sobre HTTP/3, que oferece múltiplos streams e datagramas não confiáveis — útil para jogos e mídia. Ainda está amadurecendo; para a maioria dos designs em 2026, SSE e WebSockets são as escolhas seguras.

---

## gRPC: chamadas entre serviços { #grpc }

Entre os próprios serviços do BoxOffice, as prioridades são outras: nenhum navegador, os dois lados sob nosso controle, muitas chamadas por ação do usuário e necessidade de contratos estritos. O **gRPC** é um framework de RPC (Remote Procedure Call) do Google que roda sobre **HTTP/2** e codifica as mensagens com **Protocol Buffers** (protobuf), um formato binário compacto gerado a partir de um schema[^6]:

```protobuf title="inventory.proto"
syntax = "proto3";
package boxoffice.inventory.v1;

service Inventory {
  rpc HoldSeats (HoldRequest) returns (Hold);                   // unary
  rpc WatchSeats (WatchRequest) returns (stream SeatEvent);     // server streaming
}

message HoldRequest {
  string event_id = 1;
  repeated string seat_ids = 2;
  string user_id = 3;
  string idempotency_key = 4;
}

message Hold {
  string hold_id = 1;
  int64 expires_at_epoch_ms = 2;
}

message WatchRequest { string event_id = 1; }
message SeatEvent { string seat_id = 1; string status = 2; }
```

A partir desse arquivo, o compilador de protobuf gera código de cliente e de servidor em Java, Python, Go e outras linguagens. O gRPC oferece quatro tipos de chamada — **unary**, **server streaming**, **client streaming** e **bidirectional streaming** — e tem **deadlines** embutidos: quem chama diz "preciso de uma resposta em até 300 ms", e o deadline se propaga pela cadeia de chamadas, de modo que os serviços a jusante param de trabalhar em requisições que ninguém mais está esperando.

| | REST + JSON | gRPC + protobuf | GraphQL |
|---|---|---|---|
| Contrato | OpenAPI (opcional) | `.proto` (obrigatório, gera código) | schema (obrigatório) |
| Payload | JSON em texto, legível por humanos | binário, compacto, rápido de parsear | JSON |
| Transporte | HTTP/1.1, 2 ou 3 | HTTP/2 | normalmente HTTP POST |
| Streaming | via SSE / WebSockets | nativo, nos dois sentidos | subscriptions (WebSockets) |
| Suporte nos navegadores | nativo | exige gRPC-Web ou um proxy | nativo |
| Cache por CDN/HTTP | natural para GET | não | difícil (POST) |
| Ponto ideal | APIs públicas, web e mobile | serviço a serviço interno, baixa latência | clientes que precisam de agregação flexível (BFF) |

A comparação completa de estilos de API, com versionamento e conselhos de design, está em [Compute — estilos de API](../../compute/api-styles/index.md).

---

## Conexões de longa duração e load balancing { #long-lived }

HTTP/2, gRPC, SSE e WebSockets mantêm conexões abertas por muito tempo. Isso tem uma consequência que surpreende muitos times: **a carga é balanceada quando a conexão é aberta, não quando a requisição é enviada** — a menos que um proxy L7 balanceie cada requisição ou stream.

- Depois de um scale-out, as réplicas novas não recebem **nenhum tráfego**: os clientes existentes continuam presos às antigas.
- Depois de um deploy ou de um crash, **todos** os clientes de um servidor se reconectam no mesmo momento — uma **tempestade de reconexões**.
- Um load balancer L4 vê uma conexão gRPC e envia todas as requisições daquele chamador para uma só réplica ([Load Balancing](../load-balancing/index.md#l4-l7)).

Remédios: balanceamento L7 por requisição (Envoy, service mesh) ou balanceamento no lado do cliente para gRPC; uma **idade máxima de conexão** para que os clientes rotacionem periodicamente; backoff de reconexão com **jitter** no cliente; e draining que fecha as conexões gradualmente durante os deploys.

---

## Trade-offs num relance { #trade-offs }

| Necessidade | Prefira | Por quê |
|---|---|---|
| Navegadores e apps mobile → borda | HTTP/2 e HTTP/3 (deixe a CDN negociar) | multiplexação, menos round trips, migração de conexão |
| Borda → backends dentro da região | HTTP/1.1 ou HTTP/2 com pools keep-alive | simples; os RTTs são minúsculos; reaproveitar conexões remove o custo de estabelecimento |
| Servidor → muitos clientes, atualizações unidirecionais | SSE | HTTP comum, reconexão automática, funciona através da borda |
| Interativo, bidirecional, baixa latência | WebSockets | full duplex, mensagens pequenas |
| Atualizações a cada poucos segundos bastam | polling + micro-caching na CDN | stateless, cacheável, o mais barato de operar |
| Serviço a serviço, alto volume, contrato estrito | gRPC | binário, código gerado, streaming, deadlines |
| API pública para terceiros | REST + JSON (OpenAPI) | universal, cacheável, fácil de depurar |

!!! example "BoxOffice: um protocolo por interação"
    - **Fã ↔ CDN**: HTTP/3 com fallback para HTTP/2; TLS 1.3 terminado na borda. A migração de conexão mantém o app funcionando no trem.
    - **Mapa de assentos**: antes das 10:00, polling a cada 10 s com micro-caching; durante a venda, um stream **SSE** por evento (`/api/events/42/seats/stream`) alimentado por um tópico pub/sub de mudanças de assento. Um evento `held` substitui 2 milhões de respostas "nada mudou".
    - **Sala de espera**: um stream SSE com a posição do fã, servido por um serviço dedicado; reconexão com `Last-Event-ID` e jitter.
    - **Order → inventory**: **gRPC** `HoldSeats` com deadline de 300 ms e uma chave de idempotência; load balancing no lado do cliente sobre os pods de `inventory`.
    - **Assistente**: a resposta do LLM é transmitida token a token com **SSE**; um WebSocket só seria necessário para um modo de voz ou de colaboração bidirecional.
    - **Parceiros**: REST + JSON com OpenAPI, paths versionados, rate limit por API key no gateway.

!!! tip "Na entrevista"
    - Quando um problema tem requisitos de **tempo real** (chat, placares ao vivo, rastreamento de corridas, notificações), enuncie as opções e escolha explicitamente: "SSE para atualizações unidirecionais; WebSockets porque o chat é bidirecional; polling custaria N requisições por segundo à toa." Depois mencione a consequência: **conexões stateful precisam de uma camada de pub/sub** entre os servidores e de um plano para tempestades de reconexão.
    - Para chamadas internas, "REST entre os serviços" está bom; diga "gRPC" quando latência, volume ou streaming importarem, e mencione **deadlines**.
    - Se surgir a latência para usuários distantes, conte **round trips**: "TLS 1.3 e HTTP/3 reduzem o handshake a 1 RTT, e uma borda perto do usuário torna esse RTT pequeno."

!!! success "Boas práticas"

    - **Termine HTTP/2 ou HTTP/3 na borda e mantenha HTTP/1.1 com keep-alive em direção aos backends** — os clientes ganham multiplexação, os backends ganham conexões reaproveitadas. No BoxOffice: `proxy_http_version 1.1` e `keepalive` no `nginx.conf` do lab 3.
    - **Desligue buffering e cache em respostas transmitidas em stream** — `Cache-Control: no-cache` e, atrás do Nginx, `X-Accel-Buffering: no`, ou o fã vê a resposta inteira de uma vez. No BoxOffice: o endpoint SSE do assistente ([lab 12](../../../hands-on/12/tools/index.md), quadro acima).
    - **Dê um `id` a todo evento SSE e retome a partir do `Last-Event-ID`** — assim uma reconexão continua de onde parou, em vez de repetir ou perder eventos.
    - **Defina um deadline em toda chamada gRPC e propague-o** — quem é chamado para de trabalhar numa requisição que quem chamou já abandonou.
    - **Automatize a renovação de certificados e alerte bem antes da expiração** — um certificado expirado é uma queda total que nenhuma quantidade de réplicas evita.

!!! warning "Armadilhas"
    - **WebSockets por padrão**: escolher WebSockets para atualizações unidirecionais compra servidores stateful, reconexão customizada e configuração de proxy que o SSE dá de graça.
    - **Timeouts de ociosidade**: load balancers fecham conexões ociosas (muitas vezes após 60 s); streams SSE e WebSocket precisam de heartbeats (comentários ou pings) para continuar abertos.
    - **Tempestades de reconexão** depois de um deploy: milhares de clientes se reconectando de uma vez. Acrescente jitter e faça draining gradual.
    - **Balancear gRPC em L4**: uma réplica recebe todo o tráfego.
    - **0-RTT para requisições não idempotentes**: sujeitas a replay. Só `GET`s em early data.
    - **Supor que o UDP funciona em todo lugar**: mantenha sempre um fallback HTTP/2 para o HTTP/3.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    RTT["round trips"] --> TLS["TLS 1.3, 0-RTT"]
    RTT --> QUIC["HTTP/3 sobre QUIC"]
    RTT --> LAT["orçamento de latência<br/>→ Estimativas"]
    H2["streams do HTTP/2"] --> GRPC["gRPC entre serviços<br/>→ Compute: estilos de API"]
    RT["push em tempo real"] --> SSE["SSE: mapa de assentos, posição na fila"]
    RT --> WS["WebSockets: chat, jogos"]
    WS --> PS["fan-out pub/sub<br/>→ Mensageria"]
    WS --> LL["conexões de longa duração<br/>→ load balancing"]
    TLS --> MTLS["mTLS dentro do cluster<br/>→ service mesh"]
```

**Componentes da paleta:** [`client`](../../../reference/components/client/index.md#client) e [`mobile`](../../../reference/components/client/index.md#mobile) (escolhem o protocolo) · [`cdn`](../../../reference/components/edge/index.md#cdn) e [`lb`](../../../reference/components/edge/index.md#lb) (terminam o TLS, falam HTTP/2 e HTTP/3) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) (fan-out por trás dos WebSockets) · [`mesh`](../../../reference/components/network/index.md#mesh) (mTLS entre serviços). **Cenários:** `chat`, `video-streaming`, `ai-assistant` (tokens em stream). **Continua em:** [Compute — estilos de API](../../compute/api-styles/index.md), [Estudo de caso: chat](../../case-studies/chat/index.md), [Rede & Segurança — service mesh](../../network-security/service-mesh/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - A latência em conexões novas se conta em **round trips**: TCP + TLS 1.2 custa 4 RTT até o primeiro byte, TLS 1.3 custa 3, QUIC 2 e QUIC 0-RTT 1. Reaproveite conexões e termine-as perto do usuário.
    - **HTTP/1.1**: uma requisição por vez por conexão. **HTTP/2**: streams multiplexados sobre uma conexão TCP, mas com head-of-line blocking do TCP. **HTTP/3/QUIC**: streams independentes sobre UDP, TLS 1.3 embutido, migração de conexão.
    - Para atualizações em tempo real: **polling** (simples, cacheável), **long polling**, **SSE** (unidirecional, HTTP comum, reconexão automática), **WebSockets** (bidirecional, stateful).
    - O **gRPC** (HTTP/2 + protobuf) serve para chamadas internas entre serviços: contratos, streaming, deadlines.
    - Conexões de longa duração são balanceadas **no momento da conexão**: atenção ao desequilíbrio depois de um scale-out e às tempestades de reconexão depois de deploys.

---

[^1]: FIELDING, R.; NOTTINGHAM, M.; RESCHKE, J. [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){target="_blank"} e [RFC 9112 — HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112){target="_blank"}. IETF, 2022.
[^2]: THOMSON, M.; BENFIELD, C. [RFC 9113 — HTTP/2](https://www.rfc-editor.org/rfc/rfc9113){target="_blank"}. IETF, 2022.
[^3]: IYENGAR, J.; THOMSON, M. [RFC 9000 — QUIC](https://www.rfc-editor.org/rfc/rfc9000){target="_blank"}, 2021; BISHOP, M. [RFC 9114 — HTTP/3](https://www.rfc-editor.org/rfc/rfc9114){target="_blank"}. IETF, 2022.
[^4]: RESCORLA, E. [RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446){target="_blank"}. IETF, 2018.
[^5]: FETTE, I.; MELNIKOV, A. [RFC 6455 — The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455){target="_blank"}. IETF, 2011. Veja também WHATWG [HTML Living Standard — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html){target="_blank"}.
[^6]: [gRPC — Core concepts, architecture and lifecycle](https://grpc.io/docs/what-is-grpc/core-concepts/){target="_blank"}. grpc.io.
[^7]: GRIGORIK, I. [High Performance Browser Networking](https://hpbn.co/){target="_blank"}. O'Reilly, 2013.
