
> *"Projete um serviço de corridas por aplicativo como o Uber ou a 99: um passageiro pede uma corrida, o sistema encontra um motorista próximo e os dois se veem no mapa até a corrida terminar."*

Corridas por aplicativo são o problema clássico **geoespacial, de muita escrita e em tempo real**. Centenas de milhares de celulares informam sua posição a cada poucos segundos; a maioria dessas escritas é inútil segundos depois, e a única consulta que importa — *quais motoristas disponíveis estão perto deste ponto?* — precisa responder em milissegundos. Por cima disso há um problema de consistência pequeno mas rígido: **um motorista, uma corrida**. A entrevista testa se você sabe escolher um índice espacial, manter os dados quentes em memória, particionar o mundo de forma sensata e proteger o único lugar onde a corretude não é negociável.

O BoxOffice encontra os mesmos problemas duas vezes. Sua busca "eventos perto de mim" usa as mesmas ideias de índice geográfico, e todo show de estádio termina com **60 000 fãs saindo de uma vez** — um app de corridas vê uma única célula do mapa passar de um punhado de pedidos para milhares em minutos. Essa célula quente é um dos follow-ups abaixo.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star::material-star: difícil |
| **Conceitos-chave** | ingestão de localizações com muita escrita, armazenamento da última posição, geohash vs. quadtree vs. H3, busca em células vizinhas, matching/despacho com lock por motorista e oferta com timeout, máquina de estados da corrida, particionamento por cidade, preço dinâmico por célula |
| **Componentes da paleta** | [`mobile`](../../../reference/components/client/index.md#mobile), [`apigw`](../../../reference/components/edge/index.md#apigw), [`app`](../../../reference/components/compute/index.md#app), [`stream`](../../../reference/components/messaging/index.md#stream), [`cache`](../../../reference/components/storage/index.md#cache), [`sql`](../../../reference/components/storage/index.md#sql), [`nosql`](../../../reference/components/storage/index.md#nosql), [`notifications`](../../../reference/components/compute/index.md#notifications), [`payment`](../../../reference/components/external/index.md#payment) |
| **Cenário do playground** | `ride-sharing` |

!!! abstract "O que este caso treina"

    - **Estimar** a taxa de atualizações de localização e **mostrar** por que só a última posição pertence ao caminho quente.
    - **Comparar** geohash, quadtree e H3 para consultas de "proximidade", incluindo o problema da borda das células.
    - **Projetar** o matching de modo que um motorista nunca seja designado para duas corridas, com ofertas que expiram.
    - **Modelar** a corrida como uma máquina de estados e **particionar** o sistema pela geografia.
    - **Identificar** pontos quentes (saída de estádio, aeroportos) e modos de falha (celulares ficando offline no meio da corrida, uma região fora do ar).

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

([roteiro de entrevista](../../intro/interview-framework/index.md))

### Requisitos funcionais { #functional-requirements }

1. Motoristas ficam **online/offline** e, enquanto online, enviam sua **localização** a cada poucos segundos.
2. O passageiro vê **motoristas próximos** no mapa, uma **estimativa de chegada (ETA)** e uma **estimativa de preço**.
3. O passageiro **pede** uma corrida; o sistema faz o **matching** com um motorista, que aceita ou recusa em poucos segundos.
4. Durante a corrida, os dois apps mostram a **localização ao vivo**; a corrida termina com **pagamento** e avaliação.
5. **Histórico** de corridas para passageiros, motoristas e suporte.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta |
|---|---|
| **Latência** | Consulta de motoristas próximos com p99 < 100 ms; matching encontrado em poucos segundos |
| **Corretude** | Um motorista nunca recebe duas corridas ao mesmo tempo; um passageiro nunca é cobrado duas vezes |
| **Escala** | ~1 M de motoristas online no pico no mundo, localização a cada 4 s; ~20 M de corridas/dia |
| **Atualidade** | Posições no mapa com no máximo alguns segundos de idade |
| **Disponibilidade** | 99,99% para pedir e fazer o matching; uma cidade precisa continuar funcionando se outra região cair |
| **Durabilidade** | Corridas e pagamentos nunca se perdem; o histórico bruto de localização pode ser amostrado |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Motor de rotas/mapas (chamamos um), cadastro de motoristas e documentos, detecção de fraude, corridas compartilhadas (*pooling*) — cite o pooling como extensão.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Quantos motoristas online, com que frequência informam a posição? | Dimensiona o caminho de escrita: 1 M a cada 4 s são 250 mil escritas/s. |
    | Uma cidade ou o mundo todo? | Particionar por cidade/região mantém cada consulta local. |
    | O motorista aceita, ou a corrida é atribuída? | Ofertas com timeout exigem um lock por motorista. |
    | Quão preciso precisa ser "próximo"? Linha reta ou ETA por ruas? | Índice espacial para os candidatos, motor de rotas para o ranqueamento. |
    | Precisamos guardar cada ponto de GPS? | O caminho quente guarda só o último; o histórico vai para armazenamento barato, talvez amostrado. |
    | Preço dinâmico? Corridas agendadas? Pooling? | Cada um acrescenta um componente; combine o que entra nos 45 minutos. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

```python exec="1" source="tabbed-right"
# Ride sharing: assumptions (illustrative)
drivers_online = 1_000_000     # at peak, worldwide
update_s       = 4             # driver location interval
loc_b          = 100           # driver id, lat, lon, heading, speed, ts
trips_day      = 20_000_000
peak_factor    = 3
trip_min       = 20            # average trip duration
rider_poll_s   = 2             # rider app refreshes driver position during the trip
cities         = 500

loc_writes     = drivers_online / update_s
ingest_mb_s    = loc_writes * loc_b / 1e6
history_tb_day = loc_writes * 86_400 * loc_b / 1e12
latest_mb      = drivers_online * loc_b / 1e6
trip_rps       = trips_day / 86_400
peak_trip_rps  = trip_rps * peak_factor
active_trips   = trip_rps * trip_min * 60             # Little's Law: L = λ·W
trip_push_rps  = active_trips / rider_poll_s
writes_city    = loc_writes / cities                   # average; big cities are 10-50x this

rows = [
    ("loc_writes", loc_writes, "writes/s"), ("ingest_mb_s", ingest_mb_s, "MB/s"),
    ("history_tb_day", history_tb_day, "TB/day"), ("latest_mb", latest_mb, "MB"),
    ("trip_rps", trip_rps, "req/s"), ("peak_trip_rps", peak_trip_rps, "req/s"),
    ("active_trips", active_trips, "trips"), ("trip_push_rps", trip_push_rps, "msgs/s"),
    ("writes_city", writes_city, "writes/s"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- **250 mil escritas de localização/s** — muito além do que um primário relacional deveria absorver como atualizações de linha. Mas a **última** posição de cada motorista ocupa só **~100 MB**: cabe em memória muitas vezes. ⇒ mantenha a última posição num índice geográfico em memória; envie os pontos brutos por um stream para armazenamento barato.
- O histórico bruto soma **~2 TB/dia** se guardado por inteiro ⇒ object storage / data lake, comprimido e possivelmente amostrado, nunca no caminho quente.
- Pedidos de corrida são só **~230/s (~700/s no pico)** — o caminho de matching tem pouco volume, mas precisa ser **correto**.
- A Lei de Little dá **~280 mil corridas em andamento** a qualquer momento, cada uma enviando a posição do motorista ao passageiro: **~140 mil mensagens/s** de fan-out em tempo real (conexões persistentes, como no [caso do chat](../chat/index.md)).
- Dividida por cidade, a taxa de escrita é pequena (**~500 escritas/s em média**, algumas dezenas de milhares nas maiores metrópoles). ⇒ **particione por cidade/região**: toda consulta fica local a um shard.

---

## 3. API

```http
# Driver app (in practice over a persistent connection: WebSocket / gRPC stream / MQTT)
PUT  /v1/drivers/me/status        {"status": "AVAILABLE|OFFLINE"}                 → 204
PUT  /v1/drivers/me/location      {"lat": -23.5475, "lon": -46.6361, "heading": 90,
                                   "speed": 8.3, "ts": 1767261600123}             → 204
POST /v1/offers/{offerId}/accept                                                  → 200 {rideId}
POST /v1/offers/{offerId}/decline                                                 → 204

# Rider app
GET  /v1/drivers/nearby?lat=…&lon=…&radius=2000                                   → 200 [{driverId, lat, lon, etaS}]
POST /v1/rides  {"pickup": {...}, "dropoff": {...}, "product": "economy"}
     Idempotency-Key: 5b1e…                                                       → 202 {rideId, status: MATCHING, fareEstimate}
GET  /v1/rides/{rideId}                                                           → 200 {status, driver, driverLocation, etaS}
POST /v1/rides/{rideId}/cancel                                                    → 200 {cancellationFee}
```

- Atualizações de localização são **disparar e esquecer**: se uma se perde, a próxima chega em 4 s. Sem retentativas, sem confirmação por ponto.
- A criação da corrida é **idempotente** (`Idempotency-Key`): um passageiro que toca duas vezes numa rede lenta não pode receber dois carros.

---

## 4. Modelo de dados { #4-data-model }

```text
# Latest positions, one geo set per city (Redis GEO = sorted set of geohash-encoded scores)
GEOADD drivers:sao-paulo -46.6361 -23.5475 driver:42
GEOSEARCH drivers:sao-paulo FROMLONLAT -46.6361 -23.5475 BYRADIUS 2 km ASC COUNT 20

# Driver state (hash), with TTL refreshed by each update: no update for 30 s → stale
driver:42 → { status: AVAILABLE, city: sao-paulo, lat, lon, ts, rideId: null }
```

```sql
CREATE TABLE ride (
    ride_id        UUID PRIMARY KEY,
    city           TEXT        NOT NULL,
    rider_id       BIGINT      NOT NULL,
    driver_id      BIGINT,
    status         TEXT        NOT NULL,   -- MATCHING | ACCEPTED | ARRIVING | IN_PROGRESS | COMPLETED | CANCELLED
    pickup         POINT       NOT NULL,
    dropoff        POINT       NOT NULL,
    fare_cents     INT,
    surge          NUMERIC(3,2),
    idempotency_key TEXT UNIQUE NOT NULL,
    requested_at   TIMESTAMPTZ NOT NULL,
    completed_at   TIMESTAMPTZ
);

-- At most one active ride per driver: the database enforces it
CREATE UNIQUE INDEX one_active_ride_per_driver ON ride (driver_id)
    WHERE status IN ('ACCEPTED', 'ARRIVING', 'IN_PROGRESS');
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Últimas posições dos motoristas | Índice geográfico em memória (`cache`, ex.: Redis GEO), fragmentado por cidade | 250 mil escritas/s, consultas por raio em submilissegundos, só o último valor importa |
| Stream de localizações | Stream de eventos (`stream`/Kafka), particionado por cidade | Alimenta o índice geográfico, os modelos de ETA, o preço dinâmico e o histórico |
| Histórico de localizações | Object store / data lake (via o stream) | Barato, só inserção, para disputas e analytics |
| Corridas, pagamentos | SQL (`sql`), particionado por cidade | Transações, restrições de unicidade, máquina de estados |
| Perfis de motorista/passageiro | SQL ou NoSQL (`nosql`) | Quase só leitura, em cache |

---

## 5. Design de alto nível { #5-high-level-design }

``` diagram-sim
flowchart LR
    d([App do motorista]) --> gw["Gateway<br/>conexões persistentes"]
    r([App do passageiro]) --> gw
    gw --> loc["Serviço de localização"]
    loc --> st[["Stream de localizações<br/>particionado por cidade"]]
    st --> geo[("Índice geográfico<br/>últimas posições")]
    st --> hist[("Histórico<br/>object store")]
    st --> surge["Preço dinâmico<br/>oferta/demanda por célula"]
    gw --> ride["Serviço de corridas"]
    ride --> match["Matching / despacho"]
    match --> geo
    match --> eta["ETA / rotas"]
    match -. oferta .-> gw
    ride --> db[("Banco de corridas<br/>SQL")]
    ride --> pay[["Provedor de pagamento"]]
    ride --> notif["Notificações"]
```

Um pedido de corrida, do toque à oferta aceita:

``` diagram-sim
sequenceDiagram
    autonumber
    participant R as App do passageiro
    participant S as Serviço de corridas
    participant M as Matching
    participant G as Índice geográfico
    participant L as Lock do motorista
    participant D as App do motorista
    R->>S: POST /rides (Idempotency-Key)
    S-->>R: 202 MATCHING
    S->>M: match(corrida, embarque)
    M->>G: GEOSEARCH 2 km, AVAILABLE, 20 mais próximos
    G-->>M: candidatos
    M->>M: ranqueia por ETA nas ruas
    M->>L: trava o motorista 42 para a corrida (NX, 15 s)
    L-->>M: OK
    M->>D: oferta (expira em 15 s)
    D-->>M: aceita
    M->>S: atribui o motorista 42 (update condicional)
    S-->>R: motorista 42, ETA 4 min
```

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

### 6.1 Ingerindo localizações: guarde só o que importa { #61-ingesting-locations-keep-only-what-matters }

- **A última posição é o produto; o rastro é analytics.** O serviço de localização valida o ponto (velocidade plausível, fora do oceano), grava o último valor no índice geográfico e o acrescenta ao stream. Nada no caminho quente lê o histórico.
- **Agrupe e aglutine.** O gateway pode aglutinar atualizações por motorista (se duas chegam na mesma janela de 100 ms, fica a mais nova) e gravar no índice geográfico em lotes com pipelining.
- **Frequência adaptativa.** Um motorista disponível parado não precisa informar a cada 4 s; um motorista se aproximando do embarque precisa de mais. O app adapta o intervalo à velocidade e ao estado — menos escritas, mais atualidade onde importa.
- **Desatualização.** Cada estado de motorista tem um TTL renovado pelas atualizações; um celular que fica em silêncio por 30 s sai do conjunto de candidatos automaticamente, sem job de limpeza.
- **Particione por cidade.** O tópico do stream, o índice geográfico e o banco de corridas são todos particionados por cidade (ou região), então uma consulta em São Paulo nunca toca os shards de Lisboa ([particionamento](../../databases/partitioning/index.md)).

### 6.2 O índice espacial: geohash, quadtree ou H3 { #62-the-spatial-index-geohash-quadtree-or-h3 }

Uma B-tree em `(lat, lon)` não responde "dentro de 2 km" de forma eficiente: ela ordena por uma dimensão de cada vez. Índices espaciais mapeiam o espaço 2-D em células ([bancos especializados](../../databases/specialized/index.md)).

=== "Geohash"

    Intercala os bits da longitude e da latitude e codifica em base32: pontos próximos compartilham um **prefixo** (`6gyf4…`). Prefixo = célula, então "próximo" vira "mesmo prefixo", o que qualquer armazenamento chave-valor ordenado responde (o Redis GEO usa um geohash de 52 bits como score do sorted set). Grade fixa, simples, mas as células são retângulos cujo tamanho depende da latitude, e dois pontos de lados opostos de uma borda podem ter prefixos totalmente diferentes.

=== "Quadtree"

    Divide recursivamente um quadrado em quatro filhos até cada folha ter no máximo *k* motoristas. **Adapta-se à densidade**: o centro ganha células pequenas, o interior uma célula grande. Normalmente uma estrutura em memória reconstruída ou atualizada por cidade; motoristas em movimento tornam as atualizações frequentes.

=== "H3 (hexágonos)"

    O índice hierárquico de código aberto do Uber divide o globo em **hexágonos** em 16 resoluções. Todo vizinho de um hexágono está à mesma distância do seu centro (quadrados têm vizinhos de aresta e de canto), o que deixa mais limpas as buscas "k anéis ao meu redor", a suavização e os mapas de preço dinâmico. As células são IDs (inteiros de 64 bits) — fáceis de usar como chave em qualquer armazenamento.

| | Geohash | Quadtree | H3 |
|---|---|---|---|
| Forma da célula | Retângulos, grade fixa | Quadrados, adaptativa | Hexágonos, hierarquia fixa |
| Adapta-se à densidade | Não (escolha uma precisão) | **Sim** | Não (escolha uma resolução) |
| Busca de vizinhos | 8 vizinhos + a própria (arestas e cantos a distâncias diferentes) | Percurso na árvore | Anel `k`, distâncias uniformes |
| Armazenamento | Chave string/inteiro em qualquer KV | Árvore em memória | ID de 64 bits em qualquer KV |
| Uso típico | Redis GEO, geo do Elasticsearch, serviços simples | Serviços espaciais em memória | Mapas de preço dinâmico, analytics, despacho em escala |

Qual o tamanho de uma célula de geohash? Depende da precisão (caracteres) e da latitude — calculado aqui para São Paulo:

```python exec="1" source="tabbed-right"
import math

lat = -23.55                       # São Paulo
print("| precision | cell width (km) | cell height (km) |\n|---:|---:|---:|")
for p in range(4, 9):
    bits = 5 * p                   # base32: 5 bits per character
    lon_bits, lat_bits = (bits + 1) // 2, bits // 2
    width = 360 / 2 ** lon_bits * 111.32 * math.cos(math.radians(lat))
    height = 180 / 2 ** lat_bits * 110.57
    print(f"| {p} | {width:.3f} | {height:.3f} |")
```

A precisão 6 (~1,1 × 0,6 km) é um bom balde para "motoristas a uns dois km". **Problema da borda:** um passageiro na beirada de uma célula pode estar a 50 m de um motorista na célula vizinha — sempre busque a célula **mais suas 8 vizinhas** (ou um anel `k` do H3) e depois filtre pela distância real. Se poucos motoristas forem encontrados, **amplie o anel** (precisão 5, ou `k + 1`) até aparecerem candidatos suficientes ou atingir um raio máximo.

### 6.3 Matching sem atribuição dupla { #63-matching-without-double-assignment }

O momento perigoso: os matchers de dois passageiros escolhem o mesmo motorista mais próximo ao mesmo tempo. A regra **um motorista, uma corrida** precisa de uma guarda atômica ([consenso e locks](../../distributed/consensus/index.md)):

1. Os candidatos vêm do índice geográfico (rápido, um pouco desatualizado — tudo bem).
2. Antes de ofertar, **trave o motorista**: `SET lock:driver:42 <rideId> NX PX 15000` — só um matcher ganha; o lock expira se o motorista ignorar a oferta ou o matcher cair.
3. O motorista aceita → o serviço de corridas atribui com um **update condicional** (`UPDATE ride SET driver_id = 42, status = 'ACCEPTED' WHERE ride_id = $1 AND status = 'MATCHING'`), e o índice único parcial garante que o motorista não tem outra corrida ativa — a última linha de defesa durável caso o lock falhe algum dia.
4. O motorista recusa ou a oferta expira → libere o lock e oferte ao próximo candidato.

**Matching guloso vs. em lote.** O guloso (cada pedido pega seu motorista disponível mais próximo) é simples e rápido. O matching em lote junta pedidos por 1–2 segundos e resolve um problema de atribuição sobre todos (minimizando o tempo total até o embarque), o que é globalmente melhor em áreas densas — um trade-off clássico de latência por eficiência.

### 6.4 A corrida como máquina de estados { #64-the-trip-as-a-state-machine }

``` diagram-sim
stateDiagram-v2
    [*] --> MATCHING: passageiro pede
    MATCHING --> ACCEPTED: motorista aceita a oferta
    MATCHING --> CANCELLED: sem motorista / passageiro cancela
    ACCEPTED --> ARRIVING: motorista a caminho
    ARRIVING --> IN_PROGRESS: passageiro embarcou
    ARRIVING --> CANCELLED: passageiro não apareceu (taxa)
    IN_PROGRESS --> COMPLETED: desembarque
    COMPLETED --> [*]: pagamento capturado
    CANCELLED --> [*]
```

- Toda transição é um **update condicional** sobre o estado atual (idempotente sob retentativas) e emite um evento (stream) para notificações, atualizações de ETA, recibos e analytics.
- **Pagamento**: autorize uma estimativa quando a corrida é aceita e capture a tarifa final em `COMPLETED` pelo provedor de pagamento com uma chave de idempotência (veja o [caso do sistema de pagamentos](../payment-system/index.md)).
- **Celulares ficam offline no meio da corrida** (túneis): a corrida continua no servidor; o app do motorista guarda os pontos de GPS e os envia depois, para a tarifa ser calculada pelo trajeto real.

O **preço dinâmico** cabe no mesmo pipeline: um job de stream conta os pedidos abertos (demanda) e os motoristas disponíveis (oferta) por célula H3 por minuto e publica um multiplicador por célula, suavizado no espaço e no tempo para os preços não ficarem piscando.

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Escritas de localização | 250 mil/s sobrecarregam um banco | Último valor em memória, histórico no stream; aglutinar e agrupar; intervalo adaptativo | Posições no mapa com alguns segundos de idade |
| Célula quente (saída de estádio, aeroporto) | Milhares de pedidos e um aglomerado denso numa célula | Células mais finas / divisão da quadtree ali; matching em lote; fila de passageiros com ETA honesto; preço dinâmico para atrair oferta | Alguns passageiros esperam ou pagam mais |
| Atribuição dupla | Dois matchers ofertam o mesmo motorista | Lock por motorista com TTL + update condicional + índice único parcial | Uma ida e volta a mais por oferta |
| Queda do matcher após a oferta | Motorista travado numa corrida que ninguém acompanha | TTL do lock; corrida presa em `MATCHING` refeita por uma varredura | Alguns segundos perdidos |
| Posições desatualizadas | Ofertar a motoristas que ficaram offline | TTL no estado do motorista; descartar candidatos com mais de N s | Menos candidatos |
| Shard de uma cidade fora do ar | Corridas naquela cidade falham | Réplicas por cidade; failover; outras cidades não são afetadas (isolamento) | Custo de replicação entre regiões |
| Fan-out em tempo real | 140 mil envios de posição/s para passageiros | Conexões persistentes, enviar só para corridas ativas, taxa menor quando longe | Mapa menos suave |
| Serviço de ETA lento | Matching bloqueado | Timeout + recorrer à distância em linha reta × fator | Ranqueamento pior por um momento |

Os trade-offs para **dizer em voz alta**: **atualidade vs. custo de escrita** (posições a cada 4 s, não a cada segundo), **consistência eventual para posições, consistência forte para a atribuição** (o índice geográfico pode estar desatualizado; o lock do motorista e a linha da corrida, não), e **matching guloso vs. em lote** (latência vs. eficiência global).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

O cenário `ride-sharing` modela atualizações de localização com muita escrita passando por um stream até um índice geográfico, e um caminho de matching que o lê.

!!! tip "Experimente"

    1. Rode com o perfil **load** e observe a vazão de escrita no stream e no índice geográfico comparada ao caminho bem menor dos pedidos de corrida.
    2. Aumente o número de motoristas (carga) até o índice geográfico saturar; depois acrescente partições/réplicas (fragmentação por cidade) e compare.
    3. Mude para **spike** para imitar o fim de um show no estádio: qual componente vira o gargalo — o matcher ou o armazenamento das corridas?
    4. Ligue o caos para derrubar um nó do índice geográfico: os matchings param em todo lugar ou só na partição afetada?

<div class="sdp" data-scenario="ride-sharing" data-mode="full" data-height="640" data-profile="load"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "Um show do BoxOffice no estádio termina: 60 000 pessoas saem de uma vez. O que acontece com o seu sistema?"

    Uma célula (ou poucas) recebe uma rajada de milhares de pedidos enquanto os motoristas são escassos e vêm de fora. Mitigações: antecipe — a agenda do evento é conhecida, então o preço dinâmico e os incentivos aos motoristas podem começar antes do fim do show; divida a célula quente em células mais finas para o matching; use **matching em lote** para atribuir com eficiência; crie **pontos de embarque** a alguns quarteirões para evitar engarrafamento; e seja honesto com os passageiros (posição na fila e ETA em vez de matchings que falham repetidamente). Do lado da infraestrutura é uma partição quente: garanta folga no shard da cidade, porque o pico é previsível.

??? question "Por que não usar simplesmente PostgreSQL com PostGIS?"

    Para uma cidade com alguns milhares de motoristas, PostGIS com um índice GiST é uma resposta excelente — simples e correta. O problema em escala é a **taxa de atualização**: centenas de milhares de atualizações de linha por segundo, cada uma reescrevendo entradas de índice e gerando WAL, para dados que ficam obsoletos em 4 segundos. Um índice geográfico em memória para as últimas posições mais SQL para as corridas dá a cada armazenamento a carga em que ele é bom.

??? question "Um motorista atravessa de um shard de cidade para outro."

    Os shards devem seguir **regiões operacionais** com margem, para que travessias sejam raras. Quando acontecem, o serviço de localização grava o motorista no novo shard e o remove do antigo (o TTL remove as sobras de qualquer jeito); uma corrida ativa continua pertencendo ao shard onde começou até terminar. Para consultas perto de uma fronteira, busque nos dois shards.

??? question "Como você calcula o ETA?"

    A distância em linha reta é só um filtro. O ETA vem de um motor de rotas sobre o grafo de ruas com trânsito ao vivo (velocidades aprendidas do stream de localização de todos os motoristas), normalmente com atalhos pré-computados (*contraction hierarchies*) para responder em milissegundos. O matching pede ETAs dos 10–20 melhores candidatos, não de todos.

??? question "Por quanto tempo você guarda o histórico de localização e por quê?"

    Os trajetos das corridas são guardados pelo tempo que recibos, disputas e regulações exigirem (cálculo de tarifa, investigações de segurança). Pontos de motoristas ociosos podem ser amostrados ou descartados após o analytics de curto prazo. Guarde-os comprimidos em object storage, particionados por cidade e dia, e trate-os como dados pessoais (controle de acesso, política de retenção).

??? question "Como você acrescentaria corridas compartilhadas (pooling)?"

    O matching fica mais difícil: o candidato é um motorista **já em corrida** cuja rota absorve um desvio dentro de limites para os dois passageiros. O índice geográfico precisa incluir motoristas em corridas compartilhadas com assentos sobrando, e o matcher avalia o custo de inserção na rota. A máquina de estados ganha trechos por passageiro. É um bom lugar para mostrar que você percebe quando um problema muda de classe (de vizinho mais próximo para uma otimização com restrições).

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Tabela de motoristas com lat/lon atualizada a cada envio; "buscar motoristas com distância < 2 km"; tabela de corridas. Ignora a taxa de escrita e a corrida pela atribuição dupla. |
| **Pleno** | Últimas posições num índice geográfico em memória (Redis GEO/geohash), histórico num stream; busca de proximidade com células vizinhas; máquina de estados da corrida; um lock ou update condicional para evitar atribuição dupla; particionamento por cidade. |
| **Sênior** | Quantifica escritas e memória; compara geohash, quadtree e H3 com o problema da borda e a ampliação do anel; locks de oferta com TTL mais uma restrição de unicidade durável; matching guloso vs. em lote; frequência de atualização adaptativa; tratamento da célula quente com preço dinâmico e pontos de embarque; modos de falha (queda do matcher, motoristas desatualizados, shard da cidade fora do ar); integração de pagamento com idempotência. |

**Relacionados:** [Particionamento](../../databases/partitioning/index.md), [Bancos especializados](../../databases/specialized/index.md), [Caso do chat](../chat/index.md) (conexões persistentes), [Caso do sistema de pagamentos](../payment-system/index.md), [Hands-on 6](../../../hands-on/6/index.md) (transações e locks).

!!! success "Boas práticas"

    - **Limite as atualizações de posição pelo estado** — alguns segundos entre pings dirigindo, muito menos quando parado; os pings são a maior parte da carga de escrita.
    - **Atribua um motorista com uma atualização condicional** — `UPDATE ... WHERE status = 'AVAILABLE'` (ou um lease com TTL) faz de "um motorista, uma corrida" um fato do banco, como as reservas de assento do [lab 6](../../../hands-on/6/holds/index.md).
    - **Mantenha as posições ao vivo em memória com TTL, e persista as corridas** — posições são telemetria; a corrida e o seu preço são o registro.
    - **Dê timeout às ofertas e ofereça de novo** — um motorista que não responde em segundos volta para o grupo, e o passageiro recebe o próximo.
    - **Particione o índice geográfico por região** — o horário de pico de uma cidade fica na partição dessa cidade.

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["Ride sharing"]) --> EST["Estimation<br/>location writes, latest position fits in memory"]:::tech
    CASE --> DB["Databases<br/>geohash, quadtree, H3, partition by city"]:::tech
    CASE --> MSG["Messaging<br/>location stream by city"]:::tech
    CASE --> DIS["Distributed<br/>one driver, one ride: atomic guard"]:::tech
    CASE --> CMP["Compute<br/>trip state machine, payment"]:::tech
    CASE --> EDG["Edge<br/>persistent connections"]:::tech
    DB -.-> k1["cache (geo index) · sql"]:::comp
    MSG -.-> k2["stream · objstore"]:::comp
    CMP -.-> k3["payment · notifications"]:::comp
    EDG -.-> k4["mobile · apigw"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Bancos de dados — especializados](../../databases/specialized/index.md) · [Bancos de dados — particionamento](../../databases/partitioning/index.md) · [Mensageria — Kafka](../../messaging/kafka/index.md) · [Distribuídos — consenso](../../distributed/consensus/index.md) · [Compute — integrações](../../compute/integrations/index.md) · [Caching — Redis](../../caching/redis/index.md) (comandos geo) · [Hands-on 6](../../../hands-on/6/index.md). **Componentes da paleta:** [`mobile`](../../../reference/components/client/index.md#mobile) · [`apigw`](../../../reference/components/edge/index.md#apigw) · [`stream`](../../../reference/components/messaging/index.md#stream) · [`cache`](../../../reference/components/storage/index.md#cache) · [`sql`](../../../reference/components/storage/index.md#sql) · [`objstore`](../../../reference/components/storage/index.md#objstore) · [`payment`](../../../reference/components/external/index.md#payment) · [`notifications`](../../../reference/components/compute/index.md#notifications). **Cenários:** `ride-sharing`.

---

## Referências { #references }

- XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2, cap. 1 "Proximity Service" e cap. 2 "Nearby Friends"[^1].
- O índice espacial hierárquico hexagonal do Uber[^2].
- Comandos geoespaciais do Redis (`GEOADD`, `GEOSEARCH`)[^3].
- FINKEL, R.; BENTLEY, J. *Quad Trees: A Data Structure for Retrieval on Composite Keys*[^4].

[^1]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2. Byte Code LLC, 2022.
[^2]: BRODSKY, I. [H3: Uber's Hexagonal Hierarchical Spatial Index](https://www.uber.com/blog/h3/){target="_blank"}. Uber Engineering Blog, 2018. Documentação: [h3geo.org](https://h3geo.org/){target="_blank"}.
[^3]: [Redis geospatial indexes](https://redis.io/docs/latest/develop/data-types/geospatial/){target="_blank"}. Documentação do Redis.
[^4]: FINKEL, R.; BENTLEY, J. Quad Trees: A Data Structure for Retrieval on Composite Keys. *Acta Informatica*, 4(1), 1974.
