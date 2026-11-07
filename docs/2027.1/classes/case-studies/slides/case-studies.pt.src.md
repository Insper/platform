---
marp: true
lang: pt-BR
title: Estudos de Caso
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

# Estudos de Caso

**Doze problemas de entrevista, um punhado de ideias**

<!--
Roteiro: (1) o roteiro de entrevista e o tempo de cada etapa; (2) os doze casos e os padrões que se
repetem; (3) uma ideia de cada caso; (4) a venda relâmpago do BoxOffice a fundo; (5) como estudar
com o playground e a rubrica.
-->

---

## "Projete a Ticketmaster." Vai.

<div class="q">

Dois milhões de fãs, sessenta mil lugares, vendas abrindo às 10:00, 45 minutos no relógio.
O que você faz nos **primeiros cinco minutos**?

</div>

* Pergunte: lugares marcados ou pista? Maior abertura? Duração da reserva? Pagamento próprio?
* Declare metas com números: **zero venda duplicada**, p99 da reserva < 300 ms, aguentar 2 M de chegadas em 2 min.
* Diga o que está **fora do escopo**: revenda, reembolsos, preço dinâmico.
* Só então estime — e só então desenhe.

<!--
Deixe a turma responder primeiro. A maioria começa desenhando caixas. O ponto: os requisitos mudam
o design por completo (um teatro de 300 lugares vs. a Eras Tour).
-->

---

## O roteiro, com relógio

| # | Etapa | Min | Você produz |
|---|---|---:|---|
| 1 | Esclarecer requisitos | 5 | funcionais, não funcionais com números, fora do escopo |
| 2 | Estimar | 5 | consultas por segundo (QPS, *queries per second*), médio/pico, armazenamento, banda, memória → **uma decisão** |
| 3 | API e modelo de dados | 5–7 | poucos endpoints, entidades, armazenamento de cada uma e por quê |
| 4 | Design de alto nível | 10 | um diagrama: caminho de leitura e de escrita |
| 5 | Aprofundamentos | 10–15 | duas ou três partes difíceis, alternativas, uma escolha |
| 6 | Gargalos e trade-offs | 5 | o que quebra primeiro, do que você abriu mão |
| 7 | Fechamento | 2–3 | resumo, próximos passos, como medir |

<p class="small">Toda página de caso usa essa numeração, mais: experimente no playground, perguntas de follow-up, rubrica.</p>

---

## Estude com o playground

<div class="flow">
<div class="box accent">Preveja<small>o que quebra primeiro?</small></div><div class="arrow">→</div>
<div class="box">Rode<small>perfil load / spike</small></div><div class="arrow">→</div>
<div class="box">Observe<small>utilização, p99, erros, backlog, custo</small></div><div class="arrow">→</div>
<div class="box orange">Mude uma coisa<small>réplicas, cache, fila, timeout</small></div><div class="arrow">→</div>
<div class="box green">Explique<small>com os números da seção 2</small></div>
</div>

- Todo caso incorpora seu cenário: `ticketing`, `flash-sale`, `news-feed`, `distributed-cache`, …
- Perfis: `load` (regime), `spike` (10:00), `stress` / `breakpoint` (o joelho), caos (falhas).
- Remova o cache, contorne a fila, derrube um nó: **veja** por que cada componente está ali.

<div class="ok">

Os números do simulador são ilustrativos; as **formas** (joelho, backlog, cascata) são reais.

</div>

<!--
Movido para perto do roteiro, na ordem da página: o ciclo é como todo caso é estudado. Mude uma coisa
por vez, ou você não saberá qual mudança mexeu na métrica.
-->

---

## Números que tomam decisões

Encurtador de URLs: 100 M de links novos/mês, 100 leituras por link.

- Escritas: 100 M / 2,6 M s ≈ **40/s** → um único banco aguentaria.
- Leituras: × 100 ≈ **4 000/s**, pico ~12 mil/s → **projete para as leituras**.
- 6 bi de links em 5 anos × 500 B ≈ **3 TB** → particione por `code`.
- Conjunto quente ≈ 20% das leituras do dia × 500 B ≈ **33 GB** → cabe em RAM → **cache**.
- 7 caracteres base62 = **3,5 trilhões** de códigos → o tamanho não é o problema; a **unicidade** é.

<div class="ok">

Toda estimativa termina com **"então…"**. Um número que não muda nada não valia a conta.

</div>

---

<!-- _class: tight -->

## Os casos (1/2): aquecimento e médios

| Caso | Nível | A ideia central |
|---|---|---|
| Encurtador de URLs | ★ | IDs sem colisão (faixas de contador + base62), cache dos links quentes, 302 para analytics |
| Rate limiter | ★★ | token bucket / janela deslizante, Lua atômico no Redis, fail-open vs. closed |
| Cache distribuído | ★★ | hash consistente + nós virtuais, despejo, replicação, chaves quentes |
| Autocompletar de busca | ★★ | top-k por prefixo pré-computado offline, servido da memória, com debounce |
| Sistema de notificações | ★★ | fila por canal, retentativas + fila de mensagens mortas (DLQ), dedupe, preferências, failover de provedor |

<p class="small">Cenários: <code>url-shortener</code>, <code>rate-limiter</code>, <code>distributed-cache</code>, <code>read-heavy-cache</code> / <code>sharding</code>, <code>search-autocomplete</code>, <code>notification-system</code>.</p>

---

<!-- _class: tight -->

## Os casos (2/2): difíceis

| Caso | Nível | A ideia central |
|---|---|---|
| News feed | ★★★ | fan-out na escrita vs. na leitura; híbrido para celebridades; timeline de IDs |
| Chat | ★★★ | gateways WebSocket com estado, sequência por conversa, dedupe |
| Corridas por aplicativo | ★★★ | últimas posições num índice geográfico; um motorista, uma corrida |
| Streaming de vídeo | ★★★ | os bytes nunca tocam seus servidores; grafo acíclico dirigido (DAG) de transcodificação; taxa de bits adaptativa (ABR) + rede de distribuição de conteúdo (CDN) |
| Sistema de pagamentos | ★★★ | chaves de idempotência, razão de partidas dobradas, conciliação |
| Ingressos (BoxOffice) | ★★★ | sala de espera + Lei de Little; reservas sem venda duplicada |
| Assistente de IA | ★★★ | geração aumentada por recuperação (RAG), gateway de modelo de linguagem de grande porte (LLM), ferramentas com permissões, guardrails, avaliações |

<p class="small">Cenários: <code>news-feed</code>, <code>chat</code>, <code>ride-sharing</code>, <code>video-streaming</code>, <code>payment-system</code>, <code>ticketing</code> / <code>flash-sale</code>, <code>ai-assistant</code>.</p>

---

<!-- _class: tight -->

## Padrões que se repetem

| Padrão | Onde aparece |
|---|---|
| **Cache das leituras quentes** | encurtador, feed, autocompletar, vídeo, catálogo |
| **Trabalho lento fora do caminho crítico** (fila + workers) | cliques, notificações, fan-out, transcodificação, outbox |
| **Retentativas seguras** (idempotência, dedupe, escritas condicionais) | pagamentos, lugares, chat, notificações, pedidos de corrida |
| **Escolher a chave de partição** | conversa, cidade, evento, usuário, anel de chaves |
| **Proteger o que não escala** (admissão, rate limits, bulkheads) | sala de espera, rate limiter, provedor de pagamento, cotas de LLM |
| **Pré-computar vs. computar na leitura** | fan-out do feed, top-k, renditions |
| **Consistência forte só onde importa** | lugares, dinheiro, atribuição de motorista — não feeds nem contadores |

---

## Rate limiter: atômico ou errado

- `GET` → verifica → `SET` ingênuo em 20 gateways: os dois leem 9, os dois permitem → **11 > 10**.
- Solução: um **script Lua** por requisição, atômico no shard dono da chave; relógio do servidor (`TIME`); tempo de vida (TTL) em toda chave.
- A **janela fixa** deixa passar 2× na fronteira; em produção, **token bucket** ou **contador de janela deslizante**.
- Contadores para 1 M de clientes ≈ **200 MB**; um *log* deslizante precisaria de ~30 GB.

<div class="warn">

Limites por cliente não seguram **um milhão de fãs legítimos** às 10:00. Isso exige descarte de carga, limites de concorrência — e uma sala de espera.

</div>

---

## Cache distribuído: memória ou vazão?

<div class="flow">
<div class="box">1,1 TB de dados<small>÷ 64 GB por nó</small></div><div class="arrow">→</div>
<div class="box">17 nós<small>pela memória</small></div>
<div class="arrow">vs.</div>
<div class="box">2 M ops/s<small>÷ 80 mil por nó</small></div><div class="arrow">→</div>
<div class="box orange">25 nós<small>pela vazão</small></div><div class="arrow">→</div>
<div class="box green">50 nós<small>25 primários + 1 réplica cada</small></div>
</div>

- Dimensione pelos **dois** e fique com o maior. `hash % N` move quase toda chave quando N muda; o **hash consistente** move ~1/N.
- Cada ponto de taxa de acerto vale **20 mil req/s no banco**: 95% → 100 mil req/s, 90% → 200 mil req/s.
- Replicação assíncrona pode perder uma escrita **confirmada** no failover: é um cache, não a fonte da verdade.

<p class="small">Cenário: <code>distributed-cache</code> (17 nós saturam antes de a memória acabar).</p>

---

## Autocompletar: a requisição mais barata é a que não sai

<div class="flow">
<div class="box">uma requisição por tecla<small>~14 mil req/s</small></div><div class="arrow">→</div>
<div class="box accent">debounce de 100–150 ms<small>~4,6 mil req/s</small></div><div class="arrow">→</div>
<div class="box">anúncio de turnê ×5<small>~23 mil req/s</small></div><div class="arrow">→</div>
<div class="box green">navegador + CDN respondem metade<small>~12 mil req/s na origem</small></div>
</div>

- Uma **trie com o top-k guardado em cada nó**: digitar `col` percorre três nós e devolve uma lista — sem percorrer a subárvore.
- O índice inteiro (~30 M de nós, ~6 GB) cabe na memória de um servidor → **replique**, não fragmente.
- Construído **offline** a partir dos logs em snapshots imutáveis, carregados com troca atômica; tendências são uma camada pequena por cima.

---

## Notificações: absorver o pico, respeitar o provedor

<div class="flow">
<div class="box red">campanha de pré-venda<small>7,5 M de mensagens</small></div><div class="arrow">→</div>
<div class="box accent">fila por canal<small>transacional ≠ em massa</small></div><div class="arrow">→</div>
<div class="box">workers em ritmo controlado<small>espalhado em 30 min</small></div><div class="arrow">→</div>
<div class="box orange">provedor de e-mail<small>1.000/s → 2,5 M levam ~42 min</small></div>
</div>

- Disparada em um minuto: **125 mil envios/s** e ~8 mil req/s no app de fãs que tocam na notificação; espalhada em 30 min: **~280 req/s**.
- O **limite do provedor** decide a duração, não o número de workers; e-mails transacionais precisam de **capacidade reservada**.
- Chave de idempotência por notificação, retentativas com backoff + jitter, uma fila de mensagens mortas (DLQ, *dead-letter queue*) após a última tentativa.

---

## News feed: quem paga o fan-out?

- **Push** (fan-out na escrita): leituras são uma consulta ao cache; um post custa *seguidores* inserções.
- **Pull** (fan-out na leitura): escritas de graça; cada abertura do feed faz centenas de consultas.
- Seguidores têm cauda pesada: ~0,3% dos autores (≥ 100 mil seguidores) causam **~84%** das escritas de push (simulado).
- **Híbrido**: push para autores comuns, **pull das celebridades** na leitura e mescla.
- Timelines guardam **IDs**, aparadas, para usuários **ativos**; hidrate os posts na leitura; pagine com **cursores**.

<!--
Os 84% vêm da simulação na página do news feed (distribuição sintética de cauda pesada). O ponto é a
forma, não o número exato.
-->

---

## News feed: a fila atrás de uma celebridade

<div class="flow">
<div class="box">230 posts/s × 200<small>46 mil inserções/s</small></div><div class="arrow">+</div>
<div class="box red">um post de uma conta de 50 M<small>50 M de inserções, push</small></div><div class="arrow">→</div>
<div class="box">fila FIFO, 20 workers<small>100 mil inserções/s</small></div><div class="arrow">→</div>
<div class="box red">posts comuns 500 s atrasados<small>o acúmulo zera após 926 s</small></div>
</div>

<div class="matrix" style="--n: 3">
<div></div><div class="head">push</div><div class="head">híbrido (≥ 100 mil puxados)</div><div class="head">pull</div>
<div class="row">post de celebridade</div><div class="box red">50 M de inserções</div><div class="box green">0 inserções</div><div class="box green">0 inserções</div>
<div class="row">inserções/s constantes</div><div class="box orange">46.000</div><div class="box green">7.406</div><div class="box green">0</div>
<div class="row">leituras por abertura do feed</div><div class="box green">1</div><div class="box orange">10 (1 + 9 celebridades)</div><div class="box red">200 → 7 M de leituras/s</div>
</div>

<p class="small">Simulador <b>feed-fanout</b> na página do news feed (seção 6.1): escolha a estratégia, o limiar e os workers.</p>

<!--
Os números vêm do modelo do simulador, que usa as estimativas da página. Com 10 workers o mesmo post
atrasa os posts comuns em 1.000 s e o acúmulo precisa de 12.500 s (3,5 h).
-->

---

## Chat: borda com estado, núcleo sem estado

<div class="flow">
<div class="box muted">celular da Alice</div><div class="arrow">→</div>
<div class="box">balanceador L4<small>TCP de longa duração</small></div><div class="arrow">→</div>
<div class="box accent">gateway gw-031<small>segura o socket</small></div><div class="arrow">→</div>
<div class="box accent">serviço de chat<small>seq 88, grava, ack</small></div><div class="arrow">→</div>
<div class="box">pub/sub<small>canal gw-117</small></div><div class="arrow">→</div>
<div class="box muted">Bob no gw-117</div>
</div>

- 15 M de sockets simultâneos ≈ **300 gateways** que só seguram conexões e roteiam frames.
- **Registro de sessões** (usuário/dispositivo → gateway) + **canal de pub/sub** por gateway.
- Ordem: **número de sequência por conversa** vindo de um único dono — nunca timestamps do celular.
- **Exibição** exatamente uma vez = entrega pelo menos uma vez + dedupe por `clientMsgId`.
- Offline: guarde primeiro, notificação push, `sync` a partir do último `seq` do dispositivo.
- Presença derivada da conexão; publique só **mudanças**, só para inscritos.

---

## Corridas: dois níveis de consistência

<div class="cols">
<div>

**Eventual: posições**

- 1 M de motoristas a cada 4 s = **250 mil escritas/s**.
- Só a **última** importa: ~100 MB num índice geográfico em memória (geohash / H3).
- Busque a célula **e as vizinhas**; amplie o anel.

</div>
<div>

**Forte: atribuição**

- Trave o motorista antes da oferta: `SET … NX PX 15000`.
- Aceite = update condicional `WHERE status = 'MATCHING'`.
- Índice único parcial: **uma corrida ativa por motorista**.

</div>
</div>

<p class="small">Ligação com o BoxOffice: 60 000 fãs saem do estádio de uma vez — uma célula quente previsível.</p>

---

## Vídeo: siga os bytes

- Espectadores puxam ~**34 PB/dia**, ~**9 Tbit/s** no pico (ilustrativo) → a **CDN** serve os bytes.
- Uploads vão **direto para o object storage** (pré-assinados, multipart, retomáveis).
- Transcodificação = **DAG de tarefas idempotentes** numa fila; publique as resoluções baixas primeiro.
- **Bitrate adaptativo**: escada de renditions, segmentos de ~4 s, o player escolhe cada próximo segmento.
- Origin shield + colapso de requisições para vídeos virais; pré-posicione a cabeça, puxe a cauda longa.

<div class="ok">

"Meus servidores cuidam de metadados, orquestração e assinaturas — nunca de bytes de vídeo."

</div>

---

## Pagamentos: exatamente uma vez é design, não recurso

- Redes só dão **pelo menos uma vez**; o *efeito* de exatamente uma vez vem das **chaves de idempotência**.
- Guarde chave + hash da requisição + resposta; devolva a resposta na repetição; envie a chave ao provedor de serviços de pagamento (PSP) também.
- Timeout significa **UNKNOWN**, não falha: pergunte ao provedor, nunca cobre de novo às cegas.
- **Razão de partidas dobradas**: lançamentos só de inserção que somam zero; saldos são derivados.
- **Webhooks** são assinados, atrasados, duplicados → handlers idempotentes.
- A **conciliação** com os arquivos de liquidação do provedor pega todo o resto.

---

## O resultado desconhecido

<div class="flow">
<div class="box">CREATED</div><div class="arrow">chama o PSP →</div>
<div class="box accent">PROCESSING</div><div class="arrow">→</div>
<div class="group"><div class="caption">o provedor responde</div>
<div class="box green">SUCCEEDED<small>ok ou webhook de captura</small></div>
<div class="box red">FAILED<small>recusado</small></div>
<div class="box orange">UNKNOWN<small>timeout / 5xx</small></div>
</div>
<div class="arrow">UNKNOWN →</div>
<div class="box accent">pergunte ao provedor<small>consulta de status ou webhook, depois decida</small></div>
</div>

<div class="warn">

Timeout **não** é falha: a cobrança pode ter acontecido. Cobrar de novo às cegas é como o fã paga duas vezes.

</div>

---

## Caso principal: a venda relâmpago do BoxOffice

| Grandeza | Valor | Então… |
|---|---:|---|
| Requisições sem sala de espera | ~167 mil/s | as linhas quentes dos lugares não aguentam → **controle de admissão** |
| Entradas na sala de espera | ~17 mil/s | página estática na **CDN**, status barato |
| Taxa de admissão (10 mil compradores, 5 min) | ~33 fãs/s | Lei de Little: λ = L / W |
| Pedidos | ~20/s | um primário SQL bem indexado basta |
| Chamadas de pagamento em andamento (2 s) | ~40 | dimensione o bulkhead para 40, não para 2 M |
| Estoque inteiro | ~6 MB | armazenamento não é o problema; **disputa** é |

---

## A venda relâmpago como um funil

<div class="flow">
<div class="box red">2 M de fãs<small>em 120 s</small></div><div class="arrow">→</div>
<div class="box green">CDN<small>página de espera, consultas em cache por 1 s</small></div><div class="arrow">→</div>
<div class="box accent">sala de espera<small>~17 mil entradas/s</small></div><div class="arrow">→ 33/s →</div>
<div class="box">compradores<small>≤ 10 mil ao mesmo tempo</small></div><div class="arrow">→</div>
<div class="box">reservas + pedidos<small>~20 pedidos/s</small></div><div class="arrow">→</div>
<div class="box orange">provedor de pagamento<small>~40 chamadas em andamento</small></div>
</div>

- Cada etapa deixa passar **menos** do que recebe: o pico vira um fluxo medido antes de chegar às linhas quentes dos lugares.
- A taxa de admissão vem da Lei de Little (λ = L / W = 10.000 / 300 s); o bulkhead do provedor, da mesma lei (20/s × 2 s).
- Cenário `ticketing`: os mesmos números no playground; compare as requisições que chegam ao banco de inventário antes e depois.

---

## Reservas de lugar sem venda duplicada

```sql
UPDATE seat
   SET status = 'HELD', hold_id = $1, held_until = now() + interval '10 minutes'
 WHERE event_id = $2 AND seat_id = ANY($3)
   AND (status = 'AVAILABLE' OR (status = 'HELD' AND held_until < now()));
-- rows updated == seats requested, otherwise ROLLBACK → 409
```

- Os perdedores falham rápido (0 linhas) — sem espera por lock, reservas expiradas recuperadas de forma preguiçosa.
- Pedido = **máquina de estados**: HELD → PENDING_PAYMENT → CONFIRMED, transições idempotentes, outbox → Kafka.
- Pista = um contador quente → fragmente-o, ou leve-o ao Redis com uma guarda durável.

---

## Assistente de IA: o LLM é um componente

- **RAG**: dividir → gerar embeddings → banco vetorial; busca híbrida + reranqueamento; respostas com citações.
- **LLM gateway**: rotear modelo pequeno vs. grande, fallbacks, cotas, cache, custo por conversa.
- **Loop de agente** com um **registro de ferramentas** (Model Context Protocol, MCP): consultar um pedido, iniciar um reembolso.
- Autorização **fora do modelo**; efeitos colaterais exigem a **confirmação** do fã.
- **Safety mesh**: injeção de prompt direta e *indireta*, dados pessoais, validação da saída.
- **Avaliações** offline (conjuntos de teste) e online (feedback, taxa de escalonamento); streaming de tokens (tempo até o primeiro token, TTFT).

---

<!-- _class: tight -->

## O que separa os níveis

| Nível | Resposta típica |
|---|---|
| **Júnior** | Caixas e tabelas razoáveis; cita cache; não vê a parte difícil ou a resolve com "mais servidores" |
| **Pleno** | Requisitos e estimativas guiam o design; filas, caches e idempotência nos lugares certos; nomeia a parte difícil |
| **Sênior** | Quantifica; compara alternativas pelo comportamento em falha; projeta para a falha (timeouts, conciliação, failover); declara as escolhas de consistência; sabe quando um único PostgreSQL ainda é a resposta certa |

<p class="small">Cada caso termina com sua própria rubrica — dê sua nota e repita uma semana depois sem olhar.</p>

---

## Armadilhas

<div class="warn">

- Pular para tecnologias antes dos requisitos e dos números.
- Estimativas que nunca viram decisão.
- Só o caminho feliz: nenhum "o que acontece quando X cai?".
- Exagero de engenharia: cinco bancos e três regiões para 100 req/s.
- Um monólogo de 40 minutos — confirme com o entrevistador após cada etapa.

</div>

<!--
Pergunte quais armadilhas os alunos reconhecem nos próprios design docs. A maioria vai citar as duas
primeiras.
-->

---

<!-- _class: tight -->

## O mapa de conceitos

| Padrão | Casos | Aulas | Componentes |
|---|---|---|---|
| Fazer cache das leituras quentes | encurtador, news feed, autocompletar, vídeo | Caching, Borda | `cache` `cdn` |
| Tirar trabalho lento do caminho crítico | notificações, vídeo, news feed, pagamentos | Mensageria, Compute | `queue` `kafka` `worker` |
| Retries seguros, consistência forte onde importa | pagamentos, ingressos, chat, corridas | Distribuídos, Bancos de dados | `sql` `payment` |
| Escolher a chave de partição | chat, corridas, ingressos, cache distribuído | Bancos de dados | `nosql` `stream` `cache` |
| Proteger o que não escala | ingressos, rate limiter, assistente de IA | Borda, Confiabilidade | `waf` `apigw` `queue` `llmgw` |

<p class="small">Cada página de caso termina com um diagrama "Como se conecta": as aulas que ele testa e os componentes da paleta que usa.</p>

---

## Takeaways

1. Use o **roteiro** e seu relógio: esclarecer, estimar, API/dados, design, aprofundamentos, trade-offs, fechamento.
2. Todo número precisa terminar numa **decisão**.
3. Doze problemas, **um punhado de padrões**: cache, assíncrono, idempotência, chave de partição, controle de admissão.
4. Consistência forte **só onde importa**: lugares, dinheiro, atribuições.
5. Projete o **caminho de falha** com o mesmo cuidado que o caminho feliz.
6. Pratique: tente primeiro, compare, rode o cenário, responda os follow-ups, dê sua nota, repita.
