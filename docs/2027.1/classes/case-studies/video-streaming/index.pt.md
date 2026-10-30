
> *"Projete uma plataforma de vídeo como o YouTube: criadores enviam vídeos, a plataforma os processa e milhões de espectadores assistem sem travar, em qualquer dispositivo e qualquer rede."*

Vídeo é o caso em que **banda, e não requisições, é o gargalo**. Um redirecionamento tem 500 bytes; um minuto de vídeo HD tem dezenas de megabytes. Quase toda decisão de design decorre disso: os espectadores nunca tocam seus servidores (uma **CDN** entrega os bytes), os uploads nunca passam pelos seus servidores (vão **direto para o object storage**), e o trabalho pesado de CPU (**transcodificação**) é um pipeline em lote de workers que pode levar minutos. As partes interessantes são o pipeline, o **streaming com bitrate adaptativo** e a **economia** do tráfego de saída (*egress*).

O BoxOffice usa vídeo em toda página de evento — trailers de artistas, tours pelos locais, replays de shows transmitidos ao vivo. Seu volume é pequeno perto do YouTube, mas a arquitetura é a mesma, e no dia em que um artista anuncia uma turnê com um vídeo, é a CDN que mantém a página do evento de pé.

| | |
|---|---|
| **Dificuldade** | :material-star::material-star::material-star: difícil |
| **Conceitos-chave** | uploads pré-assinados e multipart retomáveis, transcodificação como um DAG de workers movidos por fila, renditions e a escada de bitrates, streaming com bitrate adaptativo (HLS/DASH), codificação por título, CDN com origin shield, custo de egress, popularidade de cauda longa, contagem de visualizações assíncrona |
| **Componentes da paleta** | [`client`](../../../reference/components/client/index.md#client), [`cdn`](../../../reference/components/edge/index.md#cdn), [`apigw`](../../../reference/components/edge/index.md#apigw), [`app`](../../../reference/components/compute/index.md#app), [`objstore`](../../../reference/components/storage/index.md#objstore), [`queue`](../../../reference/components/messaging/index.md#queue), [`worker`](../../../reference/components/compute/index.md#worker), [`sql`](../../../reference/components/storage/index.md#sql), [`nosql`](../../../reference/components/storage/index.md#nosql), [`analytics`](../../../reference/components/compute/index.md#analytics) |
| **Cenário do playground** | `video-streaming` |

!!! abstract "O que este caso treina"

    - **Estimar** a banda de saída, o armazenamento e a capacidade de transcodificação, e **explicar** por que a banda domina o custo.
    - **Projetar** um caminho de upload que contorna os servidores de aplicação e sobrevive a redes instáveis.
    - **Construir** um pipeline de transcodificação como um DAG de tarefas idempotentes movidas por fila.
    - **Explicar** o streaming com bitrate adaptativo: renditions, segmentos, manifestos e como o player troca de qualidade.
    - **Projetar** a entrega com uma CDN, um origin shield e uma estratégia para a cauda longa de popularidade.

---

## 1. Esclarecer os requisitos { #1-clarify-the-requirements }

([roteiro de entrevista](../../intro/interview-framework/index.md))

### Requisitos funcionais { #functional-requirements }

1. Criadores **enviam** vídeos (até alguns GB) pela web e pelo celular, e acompanham o progresso do processamento.
2. A plataforma **transcodifica** cada upload em várias resoluções e formatos, com miniaturas.
3. Espectadores **assistem** com reprodução suave que se adapta à conexão; podem avançar e voltar.
4. **Metadados** básicos: título, descrição, dono; **contagem de visualizações**.

### Requisitos não funcionais { #non-functional-requirements }

| Qualidade | Meta |
|---|---|
| **Reprodução** | Começar em < 2 s; travamentos (*rebuffering*) raros (é a métrica que o espectador sente) |
| **Escala** | 50 M de espectadores diários, 30 min/dia cada; 500 mil uploads/dia |
| **Tempo de processamento** | Um vídeo de 10 minutos reproduzível minutos após o upload (resoluções baixas primeiro) |
| **Disponibilidade** | 99,99% para reprodução; uploads podem ser repetidos |
| **Durabilidade** | Originais nunca se perdem (object storage da classe de 11 noves) |
| **Custo** | A banda é a maior conta: projete para taxa de acerto do cache e codificação eficiente |

### Fora do escopo (diga explicitamente) { #out-of-scope-say-it-explicitly }

Recomendações, comentários, monetização/anúncios, transmissão ao vivo (um follow-up), detecção de direitos autorais (cite como etapa assíncrona), detalhes de DRM.

??? question "Perguntas para fazer ao entrevistador"

    | Pergunta | Por que importa |
    |---|---|
    | Só vídeo sob demanda, ou ao vivo também? | Ao vivo tem segundos de orçamento: não há tempo para um pipeline completo de transcodificação. |
    | Tamanho e duração máximos do upload? | Uploads multipart/retomáveis, transcodificação em pedaços. |
    | Quais dispositivos? | Formatos (HLS para Apple, DASH no resto, CMAF para os dois), codecs (H.264 em todo lugar, AV1/HEVC onde houver suporte). |
    | Público global? | Presença da CDN, multi-CDN, armazenamento regional. |
    | Tudo bem se as resoluções altas aparecerem depois das baixas? | Permite publicar rápido e terminar a escada em segundo plano. |
    | Quão precisa precisa ser a contagem de visualizações? | Exata e em tempo real é caro; aproximada e com atraso é barato. |

---

## 2. Estimativas de guardanapo (back-of-the-envelope) { #2-back-of-the-envelope-estimates }

```python exec="1" source="tabbed-right"
# Video streaming: assumptions (illustrative; prices are placeholders, not quotes)
dau          = 50_000_000
watch_min    = 30            # minutes watched per viewer per day
bitrate_mbps = 3.0           # average delivered bitrate
peak_factor  = 3
uploads_day  = 500_000
video_min    = 10            # average upload duration
source_mbps  = 10            # bitrate of the uploaded original
ladder_mbps  = 10.6          # sum of all rendition bitrates (240p..1080p)
renditions   = 6
cdn_hit      = 0.95          # share of bytes served from CDN caches
usd_per_gb   = 0.01          # illustrative blended CDN price

egress_pb_day  = dau * watch_min * 60 * bitrate_mbps / 8 / 1e9
concurrent     = dau * watch_min / 1_440                   # Little's Law: viewers watching now
peak_streams   = concurrent * peak_factor
peak_tbps      = peak_streams * bitrate_mbps / 1e6
origin_tb_day  = egress_pb_day * 1e3 * (1 - cdn_hit)
raw_tb_day     = uploads_day * video_min * 60 * source_mbps / 8 / 1e6
encoded_tb_day = uploads_day * video_min * 60 * ladder_mbps / 8 / 1e6
encode_workers = uploads_day * video_min * renditions / 1_440   # 1 rendition-minute per worker-minute
cdn_usd_day    = egress_pb_day * 1e6 * usd_per_gb

rows = [
    ("egress_pb_day", egress_pb_day, "PB/day"), ("concurrent", concurrent, "streams"),
    ("peak_streams", peak_streams, "streams"), ("peak_tbps", peak_tbps, "Tbit/s"),
    ("origin_tb_day", origin_tb_day, "TB/day"), ("raw_tb_day", raw_tb_day, "TB/day"),
    ("encoded_tb_day", encoded_tb_day, "TB/day"), ("encode_workers", encode_workers, "workers"),
    ("cdn_usd_day", cdn_usd_day, "USD/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

O que os números dizem:

- Os espectadores puxam **~34 PB por dia**, **~9 Tbit/s no pico**. Nenhum data center serve isso a partir de alguns servidores. ⇒ a **CDN** entrega os bytes, perto dos espectadores; nossa origem só deve ver as faltas.
- Mesmo com 95% de acerto na CDN, a origem (object storage) serve **~1,7 PB/dia** ⇒ um **origin shield** (um cache intermediário) entre as bordas da CDN e o armazenamento, para que uma falta em 300 pontos de presença vire uma única busca.
- Os uploads acrescentam **~375 TB/dia de originais** e **~400 TB/dia de renditions codificadas** ⇒ object storage com regras de ciclo de vida (mover renditions antigas e pouco vistas para camadas mais frias; manter originais em armazenamento de arquivo para recodificar depois).
- A transcodificação precisa da ordem de **~20 mil workers de codificação** ocupados o dia todo (com essa velocidade ilustrativa). ⇒ workers elásticos movidos por fila, ideais para capacidade preemptível/spot barata.
- Com um preço ilustrativo de 1 centavo por GB, a entrega custa **centenas de milhares de dólares por dia**: cada ponto percentual de bitrate economizado com codificação melhor, ou de taxa de acerto do cache, é dinheiro de verdade. ⇒ as otimizações "chatas" (escolha de codec, codificação por título) são arquitetura.

---

## 3. API

```http
POST /v1/videos                                   → 201 {videoId, uploadId, partSize, partUrls[]}
     {"title": "Rock in Rio 2027 — official trailer", "sizeBytes": 734003200, "contentType": "video/mp4"}
PUT  <pre-signed partUrl #n>   (bytes of part n, straight to object storage) → 200 ETag
POST /v1/videos/{videoId}/complete  {"parts": [{"n": 1, "etag": "…"}, …]}   → 202 {status: PROCESSING}
GET  /v1/videos/{videoId}                          → 200 {status: PROCESSING|READY|FAILED,
                                                          progress, manifestUrl, thumbnails[]}

GET  https://cdn.example/vod/{videoId}/master.m3u8         (manifest, from the CDN)
GET  https://cdn.example/vod/{videoId}/720p/seg_00042.m4s  (segment, from the CDN)

POST /v1/events/playback   [{"videoId": "…", "type": "start|heartbeat|rebuffer|end", "ts": …}]  → 202
```

- A aplicação **nunca repassa bytes de vídeo**: ela assina URLs. O object store e a CDN fazem o trabalho pesado.
- **Upload multipart**: o arquivo é dividido em partes (ex.: 8–64 MB) enviadas em paralelo e repetidas de forma independente; o `complete` as junta. Uma conexão que cai custa uma parte, não o arquivo inteiro.
- Os **beacons** de reprodução são agrupados e assíncronos: alimentam as contagens de visualização e as métricas de qualidade (tempo de início, travamentos).

---

## 4. Modelo de dados { #4-data-model }

```sql
CREATE TABLE video (
    video_id     UUID PRIMARY KEY,
    owner_id     BIGINT      NOT NULL,
    title        TEXT        NOT NULL,
    status       TEXT        NOT NULL,   -- UPLOADING | PROCESSING | READY | FAILED | BLOCKED
    duration_s   INT,
    source_key   TEXT,                   -- raw/{video_id}/source.mp4
    manifest_key TEXT,                   -- vod/{video_id}/master.m3u8
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcode_task (
    video_id   UUID,
    task       TEXT,                     -- 'split', 'encode:720p:chunk-007', 'package', 'thumbs'
    status     TEXT NOT NULL,            -- PENDING | RUNNING | DONE | FAILED
    attempts   INT  NOT NULL DEFAULT 0,
    output_key TEXT,
    PRIMARY KEY (video_id, task)
);
```

```text
# Object storage layout
raw/{video_id}/source.mp4                    original, kept (archive tier after 30 days)
vod/{video_id}/master.m3u8                   master manifest (lists renditions)
vod/{video_id}/{rendition}/index.m3u8        media playlist per rendition
vod/{video_id}/{rendition}/seg_00001.m4s     ~4 s segments (CMAF fragments)
thumbs/{video_id}/{n}.jpg
```

| Dado | Armazenamento | Por quê |
|---|---|---|
| Originais, segmentos, miniaturas | Object store (`objstore`) | Blobs enormes e imutáveis; baratos, duráveis, servidos via CDN |
| Metadados do vídeo, estado das tarefas | SQL (`sql`) | Pequenos, relacionais, transições de status |
| Contagens de visualização, métricas de reprodução | Stream → contadores NoSQL (`nosql`) e analytics (`analytics`) | Taxa de escrita altíssima, aproximado serve |
| Trabalho de transcodificação | Fila (`queue`) | Distribui as tarefas entre workers elásticos; retentativas |
| Entrega | CDN (`cdn`) com origin shield | Bytes perto dos espectadores; protege a origem |

---

## 5. Design de alto nível { #5-high-level-design }

``` diagram-sim
flowchart LR
    cr([Criador]) --> api["API de vídeo"]
    api --> meta[("Metadados<br/>SQL")]
    cr -. "partes via<br/>URLs pré-assinadas" .-> raw[("Object store<br/>raw/")]
    raw -. upload concluído .-> q[["Fila de transcodificação"]]
    q --> w["Workers de transcodificação<br/>divide · codifica · empacota"]
    w --> vod[("Object store<br/>vod/")]
    w --> meta
    v([Espectador]) --> cdn["Borda da CDN"]
    cdn --> shield["Origin shield"]
    shield --> vod
    v -. beacons de reprodução .-> an["Analytics<br/>visualizações, QoE"]
```

Do upload à primeira reprodução:

``` diagram-sim
sequenceDiagram
    autonumber
    participant C as App do criador
    participant A as API de vídeo
    participant S as Object store
    participant Q as Fila
    participant W as Workers
    participant V as Espectador
    participant E as CDN
    C->>A: POST /videos (tamanho, tipo)
    A-->>C: videoId + URLs pré-assinadas das partes
    C->>S: PUT das partes em paralelo (repete as que falham)
    C->>A: POST /complete
    A->>Q: enfileira split(videoId)
    Q->>W: divide em pedaços, enfileira tarefas de codificação
    W->>S: grava 240p/360p primeiro → status READY
    W->>S: grava 720p/1080p depois, atualiza o manifesto
    V->>E: GET master.m3u8, depois os segmentos
    E->>S: falta → busca uma vez via shield
    E-->>V: segmentos (em cache para todo mundo)
```

---

## 6. Aprofundamentos (deep dives) { #6-deep-dives }

### 6.1 Uploads que contornam a aplicação { #61-uploads-that-bypass-the-application }

- **URLs pré-assinadas**: a API autoriza o upload e devolve URLs que permitem ao cliente fazer `PUT` direto no object store por alguns minutos. Os servidores de aplicação lidam com kilobytes de JSON, nunca com gigabytes de vídeo ([object storage](../../databases/specialized/index.md)).
- **Multipart e retomável**: as partes sobem em paralelo e são repetidas individualmente; o cliente guarda o `uploadId` para retomar depois de o app ser fechado. Uploads incompletos são limpos por uma regra de ciclo de vida.
- **Integridade e segurança**: um checksum por parte; depois do `complete`, uma etapa assíncrona valida o contêiner, procura malware e roda verificações de conteúdo antes de publicar.
- **Upload perto do usuário**: object stores oferecem ingestão acelerada/na borda; para um público global, envie para a região mais próxima e replique.

### 6.2 Transcodificação como um DAG de tarefas { #62-transcoding-as-a-dag-of-tasks }

Codificar um vídeo de 2 horas numa máquina só leva tempo demais. Divida, codifique os pedaços em paralelo e junte de volta:

``` diagram-sim
flowchart LR
    src["source.mp4"] --> split["Divide em<br/>pedaços de ~10 s<br/>(nos keyframes)"]
    split --> e1["codifica 240p…1080p<br/>pedaço 1"]
    split --> e2["codifica 240p…1080p<br/>pedaço 2"]
    split --> e3["codifica 240p…1080p<br/>pedaço N"]
    src --> th["Miniaturas"]
    src --> au["Faixas de áudio"]
    e1 --> pkg["Empacota<br/>HLS / DASH (CMAF)"]
    e2 --> pkg
    e3 --> pkg
    au --> pkg
    pkg --> pub["Publica<br/>manifesto + status"]
    th --> pub
```

- **Movido por fila**: cada nó do DAG é uma mensagem de tarefa; um pequeno orquestrador (ou um motor de workflow) enfileira uma tarefa quando suas entradas estão prontas ([trabalho assíncrono](../../compute/async-work/index.md)).
- **Tarefas idempotentes**: uma tarefa grava numa chave determinística (`vod/{id}/720p/chunk-007`) — rodá-la duas vezes produz o mesmo objeto, então retentativas e entregas duplicadas são inofensivas.
- **Priorize**: codifique as resoluções baixas primeiro e publique assim que existirem; os degraus mais altos e os codecs caros (AV1) vêm depois. Criadores populares ou os trailers oficiais do BoxOffice podem ir para uma fila de alta prioridade.
- **Elástico e barato**: codificar é limitado por CPU/GPU e pode ser reiniciado — rode em instâncias preemptíveis com autoscaling; uma tarefa interrompida é simplesmente repetida.

### 6.3 Streaming com bitrate adaptativo { #63-adaptive-bitrate-streaming }

Cada vídeo é codificado numa **escada** de renditions, cada uma cortada em segmentos curtos (2–6 s). O player baixa um **manifesto** que lista as renditions, mede sua vazão e seu buffer e escolhe a rendition do **próximo** segmento — subindo ou descendo sem parar ([HLS](https://www.rfc-editor.org/rfc/rfc8216){target="_blank"}, MPEG-DASH).

| Rendition | Resolução | Bitrate (H.264, ilustrativo) | Rede típica |
|---|---|---|---|
| 240p | 426×240 | 0,4 Mbit/s | Celular com sinal fraco |
| 360p | 640×360 | 0,8 Mbit/s | 3G / congestionada |
| 480p | 854×480 | 1,4 Mbit/s | Celular médio |
| 720p | 1280×720 | 3,0 Mbit/s | Celular bom / Wi-Fi |
| 1080p | 1920×1080 | 5,0 Mbit/s | Wi-Fi / banda larga |
| 2160p (4K) | 3840×2160 | ~15 Mbit/s (menos com HEVC/AV1) | Banda larga rápida, TVs |

```text
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8
```

- **Comece baixo, suba rápido**: o primeiro segmento vem de um degrau baixo para a reprodução começar em menos de 2 s; o player sobe conforme o buffer enche.
- **Codificação por título**: um desenho animado precisa de bem menos bits do que um show com confete e luzes estroboscópicas para a mesma qualidade visual. Analisar cada vídeo e escolher sua própria escada (a "per-title encode optimization" da Netflix) economiza uma boa parte da banda em conteúdo simples.
- **Codecs**: H.264 toca em todo lugar; HEVC e AV1 entregam a mesma qualidade com bem menos bits, mas custam muito mais CPU para codificar e não são suportados em todo dispositivo. Codifique os codecs caros só para vídeos com visualizações suficientes para pagar o custo.

### 6.4 Entrega: CDN, shield e a cauda longa { #64-delivery-cdn-shield-and-the-long-tail }

- As **bordas da CDN** guardam manifestos e segmentos perto dos espectadores. Os segmentos são **imutáveis** (conteúdo novo = chave nova), então podem ficar em cache por muito tempo sem invalidação ([DNS e CDN](../../edge/dns-cdn/index.md)).
- **Origin shield**: uma camada de cache regional na frente do object store; todas as bordas buscam no shield, que busca na origem no máximo uma vez por objeto — essencial para um vídeo que viraliza minutos após o upload.
- **A popularidade é uma cauda longa**: uma pequena fração dos vídeos recebe a maioria das visualizações. Empurre (**pré-posicione**) a cabeça para as bordas antes da demanda — ex.: o trailer do BoxOffice antes do anúncio de uma turnê — e deixe a cauda longa ser puxada sob demanda, aceitando um primeiro início mais lento.
- **Multi-CDN** e caches dentro dos provedores de internet (como a Netflix faz com o Open Connect) são os próximos passos em escala muito grande, por custo e resiliência.
- As **contagens de visualização** vêm dos beacons de reprodução, por um stream, até contadores agregados, deduplicados por sessão e filtrando bots; contagens exatas em tempo real não são necessárias.

!!! tip "Na entrevista"

    Diga cedo: *"Os bytes nunca passam pelos meus servidores: uploads vão para o object storage com URLs pré-assinadas, e a reprodução vem da CDN. Meus servidores cuidam de metadados, orquestração e assinaturas."* Mostra que você achou o gargalo de verdade.

---

## 7. Gargalos, modos de falha e trade-offs { #7-bottlenecks-failure-modes-and-trade-offs }

| Onde | O que dá errado | Mitigação | Trade-off |
|---|---|---|---|
| Banda de saída | Custo e capacidade explodem | CDN, alta taxa de acerto, codecs eficientes, codificação por título | Custo de CPU de codificação; suporte nos dispositivos |
| Vídeo novo viral | CDN fria: todas as bordas erram juntas | Origin shield, colapso de requisições, pré-posicionamento | O shield é mais uma camada |
| Upload em rede ruim | Uploads grandes falham em 95% | Uploads multipart + retomáveis | Complexidade no cliente |
| Backlog de transcodificação | Pico de uploads; vídeos presos em PROCESSING | Autoscaling pela profundidade da fila, prioridades, publicar degraus baixos primeiro | Custo de workers extras; HD aparece depois |
| Falha / preempção de worker | Tarefa perdida no meio da codificação | Tarefas idempotentes com saídas determinísticas; retentativas com limite; DLQ | Trabalho parcial desperdiçado |
| Entrada envenenada | Arquivo corrompido derruba os codificadores repetidamente | Etapa de validação; DLQ após N tentativas; marcar FAILED e avisar o criador | Alguns uploads rejeitados |
| Travamentos | O player escolhe uma rendition alta demais | ABR com lógica baseada no buffer; segmentos curtos; mais degraus baixos | Mais segmentos/requisições |
| Crescimento do armazenamento | Centenas de TB/dia | Camadas de ciclo de vida; descartar degraus altos pouco vistos e recodificar sob demanda a partir do original | Primeira visualização mais lenta para vídeos antigos |

Os trade-offs para **dizer em voz alta**: **custo de codificação vs. custo de entrega** (gastar CPU uma vez para economizar banda em cada visualização — só vale para vídeos que serão vistos), **tempo para publicar vs. completude** (resoluções baixas primeiro), e **empurrar vs. puxar para a borda** (pré-posicionar a cabeça, puxar a cauda).

---

## 8. Experimente no playground { #8-try-it-in-the-playground }

O cenário `video-streaming` tem o object store, uma CDN na frente dele e uma fila de workers de transcodificação alimentada pelos uploads.

!!! tip "Experimente"

    1. Rode com o perfil **load** e observe a taxa de acerto da CDN e a saída do object store (origem).
    2. Abaixe a taxa de acerto da CDN (ou remova a CDN): quanto tráfego a mais a origem recebe? É por isso que existem o shield e o pré-posicionamento.
    3. Mude para **spike** para simular uma onda de uploads: veja a fila de transcodificação crescer; acrescente workers e descubra quantos mantêm o backlog estável.
    4. Ligue o caos para derrubar workers no meio das tarefas: a fila entrega de novo, e as retentativas terminam os vídeos?

<div class="sdp" data-scenario="video-streaming" data-mode="full" data-height="640" data-profile="load"></div>

[Abrir o playground completo](../../../../playground/index.md){ .md-button }

---

## 9. Perguntas de follow-up que o entrevistador faz { #9-follow-up-questions-an-interviewer-asks }

??? question "O que muda para transmissão ao vivo (ex.: um show do BoxOffice transmitido ao vivo)?"

    O orçamento cai de minutos para segundos. O codificador recebe um sinal ao vivo (RTMP/SRT/WebRTC) e produz a escada **em tempo real** — sem DAG paralelo por pedaços; os segmentos são publicados conforme são produzidos e as playlists são atualizadas continuamente. Low-latency HLS / CMAF em pedaços entregam segmentos parciais para chegar a poucos segundos de latência ponta a ponta. A CDN continua carregando os bytes, e o pico de audiência no início do show é previsível, então pré-aqueça a capacidade. Um replay são só os segmentos gravados transformados em VOD.

??? question "O vídeo de um criador viraliza dez minutos após o upload. O que acontece?"

    Talvez só as resoluções baixas existam ainda; os degraus altos estão sendo codificados — passe o vídeo para a fila de alta prioridade. Na entrega, todas as bordas da CDN erram ao mesmo tempo: o origin shield e o **colapso de requisições** (uma busca para muitas faltas simultâneas do mesmo segmento) protegem o object store. Os manifestos têm TTL curto para as novas renditions aparecerem; os segmentos são imutáveis e ficam muito tempo em cache.

??? question "Como você reduz a conta de entrega?"

    Em ordem de impacto: aumentar a taxa de acerto do cache (shield, pré-posicionamento, TTLs mais longos para segmentos imutáveis); gastar menos bits por visualização (codificação por título, HEVC/AV1 para vídeos populares, limitar a resolução em telas pequenas); negociar ou combinar CDNs; e, em escala muito grande, colocar caches dentro dos provedores de internet. Use **custo por hora assistida** como métrica.

??? question "Como você conta visualizações com precisão?"

    Defina o que é uma visualização (ex.: ≥ 30 s assistidos), envie beacons agrupados, deduplique por sessão/dispositivo no stream, filtre bots e repetições, agregue em contadores de forma assíncrona. Mostre publicamente uma contagem aproximada e um pouco atrasada; guarde a contagem exata e auditada para os pagamentos aos criadores.

??? question "Você guarda o upload original? Por quê?"

    Sim, em armazenamento de arquivo barato. Os codecs melhoram (H.264 → HEVC → AV1) e as escadas mudam; recodificar a partir do original dá qualidade melhor do que transcodificar uma rendition já comprimida. Também permite descartar renditions pouco vistas e recriá-las sob demanda.

??? question "Como você protege conteúdo premium?"

    URLs ou tokens assinados com validade curta nos manifestos (a CDN os valida na borda), e DRM (Widevine, FairPlay, PlayReady) cifrando os segmentos com chaves entregues por um servidor de licenças só a players autorizados. Isso acrescenta uma dependência do servidor de licenças ao início da reprodução, então ele precisa ser altamente disponível.

---

## 10. Rubrica de autoavaliação { #10-self-assessment-rubric }

| Nível | O que a resposta contém |
|---|---|
| **Júnior** | Upload pelo servidor de aplicação até o armazenamento; servir o arquivo pela aplicação ou por uma CDN; uma tabela de vídeos. Um formato só, sem adaptação. |
| **Pleno** | Uploads pré-assinados para object storage; fila + workers de transcodificação gerando várias resoluções; HLS/DASH com CDN; metadados em SQL; contagem de visualizações assíncrona. |
| **Sênior** | Quantifica egress e custo; uploads multipart/retomáveis; pipeline em DAG por pedaços com tarefas idempotentes, prioridades e publicação dos degraus baixos primeiro; mecânica do ABR e codificação por título; trade-offs de codecs; origin shield, colapso de requisições, pré-posicionamento da cabeça vs. puxar a cauda; ciclo de vida do armazenamento; diferenças da transmissão ao vivo. |

**Relacionados:** [DNS e CDN](../../edge/dns-cdn/index.md), [Armazenamento especializado (object stores)](../../databases/specialized/index.md), [Trabalho assíncrono](../../compute/async-work/index.md), [FinOps](../../cloud-native/finops/index.md), [Hands-on 7](../../../hands-on/7/index.md) (filas e workers).

!!! success "Boas práticas"

    - **Envie os uploads direto ao armazenamento de objetos com URLs pré-assinadas** — servidores de aplicação nunca repassam gigabytes, e um upload sobrevive a um deploy.
    - **Torne cada job de transcodificação idempotente por (vídeo, versão)** — um job repetido sobrescreve a mesma saída em vez de produzir uma segunda cópia.
    - **Dê aos segmentos nomes imutáveis e versionados, e cabeçalhos de cache longos** — a CDN pode então guardá-los para sempre, e a taxa de acerto fica perto do máximo.
    - **Acompanhe o custo de egress por GB e a taxa de acerto da CDN** — o egress domina a conta; uma queda de 1 ponto na taxa de acerto pode ser uma parte grande do tráfego da origem.
    - **Codifique a cauda longa em menos versões** — a maioria dos vídeos é pouco assistida; transcodifique-os sob demanda ou em menos qualidades.

---

## Como se conecta { #how-it-connects }

Quais aulas este caso testa? Cada ramo é uma aula cujas ideias o design usa (azul), com os componentes da paleta em que elas aparecem (verde):

``` diagram
flowchart LR
    CASE(["Video streaming"]) --> EST["Estimation<br/>egress bandwidth dominates"]:::tech
    CASE --> DB["Databases<br/>object store, pre-signed uploads"]:::tech
    CASE --> CMP["Compute<br/>transcoding DAG, idempotent workers"]:::tech
    CASE --> MSG["Messaging<br/>transcode queue"]:::tech
    CASE --> EDG["Edge<br/>CDN, origin shield, ABR segments"]:::tech
    CASE --> FIN["Cloud-native<br/>FinOps: cost of egress"]:::tech
    DB -.-> k1["objstore · sql"]:::comp
    CMP -.-> k2["worker"]:::comp
    MSG -.-> k3["queue"]:::comp
    EDG -.-> k4["cdn · analytics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Aulas que ele testa:** [Borda — DNS e CDN](../../edge/dns-cdn/index.md) · [Bancos de dados — especializados](../../databases/specialized/index.md) (armazenamento de objetos) · [Compute — trabalho assíncrono](../../compute/async-work/index.md) · [Mensageria — filas e pub/sub](../../messaging/queues-pubsub/index.md) · [Cloud-native — FinOps](../../cloud-native/finops/index.md) · [Hands-on 7](../../../hands-on/7/index.md). **Componentes da paleta:** [`cdn`](../../../reference/components/edge/index.md#cdn) · [`objstore`](../../../reference/components/storage/index.md#objstore) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`worker`](../../../reference/components/compute/index.md#worker) · [`sql`](../../../reference/components/storage/index.md#sql) · [`analytics`](../../../reference/components/compute/index.md#analytics). **Cenários:** `video-streaming`, `cdn-static`.

---

## Referências { #references }

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 14 "Design YouTube"[^1].
- A especificação do HTTP Live Streaming (HLS)[^2] e o MPEG-DASH[^3].
- A codificação por título da Netflix[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: PANTOS, R.; MAY, W. [RFC 8216 — HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216){target="_blank"}. IETF, 2017.
[^3]: ISO/IEC 23009-1. *Information technology — Dynamic adaptive streaming over HTTP (DASH) — Part 1: Media presentation description and segment formats*.
[^4]: AARON, A. et al. [Per-Title Encode Optimization](https://netflixtechblog.com/per-title-encode-optimization-7e99442b62a2){target="_blank"}. Netflix TechBlog, 2015.
