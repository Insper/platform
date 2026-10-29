# Problemas para praticar { #practice-problems }

50 problemas de system design para praticar para entrevistas, do aquecimento a perguntas de nível sênior. Cada um traz o enunciado como um entrevistador o diria, as perguntas que você deve fazer primeiro, os conceitos-chave (com links para a aula em que cada um é ensinado e para o catálogo de componentes), a armadilha a evitar, o estudo de caso correspondente quando existe, um cenário do playground para quebrar seu design sob carga e dicas que você só abre depois de tentar.

## Como usar esta página { #how-to-use }

1. **Escolha um problema** do seu nível. Leia só o enunciado.
2. **Programe 45 minutos no cronômetro** e resolva em voz alta (sozinho, ou com um colega como entrevistador — veja as [entrevistas simuladas](../mock/index.md)), seguindo os sete passos do [framework](../framework/index.md): esclarecer, estimar, API e modelo de dados, design de alto nível, aprofundamentos, gargalos e trade-offs, fechamento.
3. **Desenhe no [playground](../../../../playground/index.md)**, rode o cenário sugerido com um perfil de spike ou de stress e veja qual caixa fica vermelha primeiro. Corrija e rode de novo.
4. **Compare** com o estudo de caso (ou com o mais próximo) e com as dicas. Anote uma coisa que você esqueceu.
5. Volte uma semana depois e resolva de novo, mais rápido.

| Nível | O que significa | Tempo a buscar |
|---|---|---|
| Aquecimento | Uma ideia central e um design pequeno | 30–35 min |
| Médio | Dois ou três componentes que interagem, pelo menos um aprofundamento | 45 min |
| Difícil | Disputa, dinheiro, tempo real ou mídia em escala | 45–60 min |
| Avançado | Internals de sistemas distribuídos e plataformas | 60 min |

!!! example "Comece pelo BoxOffice"
    O exemplo que acompanha o curso, a [venda relâmpago do BoxOffice](#flash-sale-ticketing) (2 milhões de fãs, 60.000 assentos, vendas abrindo às 10:00), toca em quase todos os temas: a borda absorvendo um pico, uma sala de espera, uma reserva de assento fortemente consistente, um provedor de pagamento externo, notificações assíncronas. Vários problemas abaixo são pedaços dele ([catálogo de eventos](#event-catalog), [mapa de assentos](#seat-map), [sala de espera](#waiting-room), [reembolsos](#refunds), [assistente de IA](#ai-assistant)); resolvê-los um a um é um bom jeito de se preparar para o problema completo.

!!! tip "Antes de abrir as dicas"
    A maioria das dicas começa com um número. Se o seu design ainda não tem números, volte ao passo 2 do framework: a [referência rápida](../quick-reference/index.md) e os [números de referência](../../../reference/numbers/index.md) têm tudo o que você precisa para estimar.

## Todos os problemas de relance { #at-a-glance }

| # | Problema | Dificuldade | Tema | Estudo de caso | Cenário |
|---|---|---|---|---|---|
| 1 | [Encurtador de URLs](#url-shortener) | Aquecimento | Muitas leituras e cache | [Encurtador de URLs](../../../classes/case-studies/url-shortener/index.md) | [`url-shortener`](../../../../playground/scenarios/index.md#url-shortener) |
| 2 | [Pastebin](#pastebin) | Aquecimento | Muitas leituras e cache | — | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 3 | [Ranking de um jogo](#leaderboard) | Aquecimento | Muitas leituras e cache | — | [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) |
| 4 | [Catálogo de eventos do BoxOffice](#event-catalog) | Aquecimento | Muitas leituras e cache | [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 5 | [Rate limiter distribuído](#rate-limiter) | Aquecimento | Infraestrutura e plataforma | [Rate limiter](../../../classes/case-studies/rate-limiter/index.md) | [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter) |
| 6 | [Gerador de IDs únicos](#unique-id-generator) | Aquecimento | Infraestrutura e plataforma | — | [`scale-out`](../../../../playground/scenarios/index.md#scale-out) |
| 7 | [Serviço de feature flags](#feature-flags) | Aquecimento | Infraestrutura e plataforma | — | [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) |
| 8 | [Contador de curtidas](#likes-counter) | Aquecimento | Muitas escritas e pipelines de dados | — | [`sharding`](../../../../playground/scenarios/index.md#sharding) |
| 9 | [Sistema de notificações](#notification-system) | Aquecimento | Assíncrono e workflows | [Sistema de notificações](../../../classes/case-studies/notification-system/index.md) | [`notification-system`](../../../../playground/scenarios/index.md#notification-system) |
| 10 | [Serviço de entrega de webhooks](#webhook-delivery) | Aquecimento | Assíncrono e workflows | — | [`async-queue`](../../../../playground/scenarios/index.md#async-queue) |
| 11 | [Feed de notícias](#news-feed) | Médio | Muitas leituras e cache | [Feed de notícias](../../../classes/case-studies/news-feed/index.md) | [`news-feed`](../../../../playground/scenarios/index.md#news-feed) |
| 12 | [Compartilhamento de fotos (estilo Instagram)](#photo-sharing) | Médio | Muitas leituras e cache | — | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 13 | [Autocompletar de busca](#search-autocomplete) | Médio | Muitas leituras e cache | [Autocompletar de busca](../../../classes/case-studies/search-autocomplete/index.md) | [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) |
| 14 | [Cache distribuído](#distributed-cache) | Médio | Muitas leituras e cache | [Cache distribuído](../../../classes/case-studies/distributed-cache/index.md) | [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) |
| 15 | [Mapa de assentos do BoxOffice](#seat-map) | Médio | Muitas leituras e cache | [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) | [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) |
| 16 | [Contador de visualizações de vídeos](#view-counter) | Médio | Muitas escritas e pipelines de dados | — | [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) |
| 17 | [Top-K de eventos em alta](#top-k-trending) | Médio | Muitas escritas e pipelines de dados | — | [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) |
| 18 | [Agregação de cliques em anúncios](#ad-click-aggregation) | Médio | Muitas escritas e pipelines de dados | — | [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) |
| 19 | [Pipeline centralizado de logs](#logging-pipeline) | Médio | Muitas escritas e pipelines de dados | — | [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack) |
| 20 | [Sistema de métricas e monitoramento](#metrics-monitoring) | Médio | Muitas escritas e pipelines de dados | — | [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack) |
| 21 | [Chat (WhatsApp / Slack)](#chat) | Médio | Tempo real e geolocalização | [Chat](../../../classes/case-studies/chat/index.md) | [`chat`](../../../../playground/scenarios/index.md#chat) |
| 22 | [Comentários e reações ao vivo](#live-comments) | Médio | Tempo real e geolocalização | — | [`chat`](../../../../playground/scenarios/index.md#chat) |
| 23 | [Serviço de proximidade (estilo Yelp)](#proximity-service) | Médio | Tempo real e geolocalização | — | [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) |
| 24 | [Agendador de jobs distribuído](#job-scheduler) | Médio | Assíncrono e workflows | — | [`notification-system`](../../../../playground/scenarios/index.md#notification-system) |
| 25 | [Web crawler](#web-crawler) | Médio | Assíncrono e workflows | — | [`async-queue`](../../../../playground/scenarios/index.md#async-queue) |
| 26 | [Reembolsos do BoxOffice após um cancelamento](#refunds) | Médio | Assíncrono e workflows | [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) | [`payment-system`](../../../../playground/scenarios/index.md#payment-system) |
| 27 | [API gateway](#api-gateway) | Médio | Infraestrutura e plataforma | [Rate limiter](../../../classes/case-studies/rate-limiter/index.md) | [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter) |
| 28 | [Rede de distribuição de conteúdo (CDN)](#cdn) | Médio | Infraestrutura e plataforma | — | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 29 | [Venda relâmpago do BoxOffice (ingressos)](#flash-sale-ticketing) | Difícil | Dinheiro e consistência | [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) | [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) |
| 30 | [Sistema de pagamentos](#payment-system) | Difícil | Dinheiro e consistência | [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) | [`payment-system`](../../../../playground/scenarios/index.md#payment-system) |
| 31 | [Sala de espera virtual do BoxOffice](#waiting-room) | Difícil | Dinheiro e consistência | [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) | [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) |
| 32 | [Reserva de hotéis](#hotel-booking) | Difícil | Dinheiro e consistência | — | [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) |
| 33 | [Checkout de e-commerce](#checkout) | Difícil | Dinheiro e consistência | [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) | [`payment-system`](../../../../playground/scenarios/index.md#payment-system) |
| 34 | [Carteira digital](#digital-wallet) | Difícil | Dinheiro e consistência | [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) | [`payment-system`](../../../../playground/scenarios/index.md#payment-system) |
| 35 | [Transporte por aplicativo (Uber / 99)](#ride-sharing) | Difícil | Tempo real e geolocalização | [Transporte por aplicativo](../../../classes/case-studies/ride-sharing/index.md) | [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) |
| 36 | [Entrega de comida](#food-delivery) | Difícil | Tempo real e geolocalização | — | [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) |
| 37 | [Backend de jogo multijogador](#multiplayer-game) | Difícil | Tempo real e geolocalização | — | [`chat`](../../../../playground/scenarios/index.md#chat) |
| 38 | [Streaming de vídeo (YouTube / Netflix)](#video-streaming) | Difícil | Busca e mídia | [Streaming de vídeo](../../../classes/case-studies/video-streaming/index.md) | [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming) |
| 39 | [Sincronização de arquivos (Dropbox / Google Drive)](#file-sync) | Difícil | Busca e mídia | — | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 40 | [Busca de posts (estilo Twitter)](#tweet-search) | Difícil | Busca e mídia | [Autocompletar de busca](../../../classes/case-studies/search-autocomplete/index.md) | [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) |
| 41 | [Assistente de suporte com IA do BoxOffice](#ai-assistant) | Difícil | Sistemas de IA | [Assistente de IA](../../../classes/case-studies/ai-assistant/index.md) | [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) |
| 42 | [Chatbot de documentação com RAG](#rag-chatbot) | Difícil | Sistemas de IA | [Assistente de IA](../../../classes/case-studies/ai-assistant/index.md) | [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) |
| 43 | [Busca semântica de eventos](#semantic-search) | Difícil | Sistemas de IA | [Autocompletar de busca](../../../classes/case-studies/search-autocomplete/index.md) | [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) |
| 44 | [Armazenamento chave-valor distribuído](#key-value-store) | Avançado | Fundamentos distribuídos | — | [`sharding`](../../../../playground/scenarios/index.md#sharding) |
| 45 | [Serviço de lock distribuído](#distributed-lock) | Avançado | Fundamentos distribuídos | — | [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas) |
| 46 | [Edição colaborativa de documentos](#collaborative-editing) | Avançado | Fundamentos distribuídos | — | [`chat`](../../../../playground/scenarios/index.md#chat) |
| 47 | [Motor de casamento de ordens de uma bolsa](#matching-engine) | Avançado | Fundamentos distribuídos | — | [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) |
| 48 | [BoxOffice multi-região](#multi-region-boxoffice) | Avançado | Fundamentos distribuídos | [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) | [`multi-region`](../../../../playground/scenarios/index.md#multi-region) |
| 49 | [Plataforma de agentes com ferramentas](#agent-platform) | Avançado | Sistemas de IA | [Assistente de IA](../../../classes/case-studies/ai-assistant/index.md) | [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) |
| 50 | [Gateway de serviço de modelos](#llm-serving-gateway) | Avançado | Sistemas de IA | [Assistente de IA](../../../classes/case-studies/ai-assistant/index.md) | [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) |

---

## Aquecimento { #warm-up }

Uma ideia central e um design pequeno. Bons primeiros problemas para estágio e recém-formados: tente cumprir os sete passos do framework em 30–35 minutos.

### Muitas leituras e cache { #read-heavy-caching }

#### 1. Encurtador de URLs { #url-shortener }

Projete um serviço como o bit.ly. Usuários enviam uma URL longa e recebem uma curta (`https://bx.to/aZ3k9Q`); quem abre o link curto é redirecionado para o original. Suponha 100 milhões de links novos por mês e uma proporção leitura:escrita de 100:1, ou seja, cerca de 4 bilhões de redirecionamentos por mês, com links que vivem por anos. Os redirecionamentos precisam parecer instantâneos (p99 abaixo de 50 ms na borda).

**Esclareça primeiro.**

- Aliases personalizados? Expiração? Um link pode ser editado ou apagado?
- Precisamos de analytics de cliques, e quão atualizados?
- A mesma URL longa sempre gera o mesmo código curto?

**Conceitos-chave.**

- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [DNS e CDN](../../../classes/edge/dns-cdn/index.md)
- Catálogo: [CDN](../../../reference/components/edge/index.md#cdn) · [Cache](../../../reference/components/storage/index.md#cache) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Kafka](../../../reference/components/messaging/index.md#kafka)

**Cuidado com.** Gerar códigos fazendo hash da URL e truncando gera colisões; um contador ou faixas de chaves pré-geradas as evitam. E redirecionamentos 301 (permanentes) são cacheados pelos navegadores, o que esconde cliques dos seus analytics; 302 não.

**Pratique.** Estudo de caso: [Encurtador de URLs](../../../classes/case-studies/url-shortener/index.md) · Cenário do playground: [`url-shortener`](../../../../playground/scenarios/index.md#url-shortener) (o problema clássico)

??? tip "Dicas"

    - Estime: ~40 escritas/s e ~1.500 leituras/s em média; 7 caracteres em base 62 dão 62⁷ ≈ 3,5 × 10¹² códigos.
    - Geração de chaves: um contador distribuído (ou faixas entregues a cada servidor) codificado em base 62.
    - Guarde `código → URL longa` num armazenamento chave-valor; cacheie os códigos quentes (Zipf: poucos links recebem a maioria dos cliques).
    - Analytics de cliques de forma assíncrona: publique um evento por redirecionamento e agregue fora do caminho da requisição.

#### 2. Pastebin { #pastebin }

Projete um serviço em que usuários colam um bloco de texto (até 1 MB) e recebem um link para compartilhá-lo. Os textos podem ser públicos ou não listados e podem expirar. Suponha 1 milhão de textos novos por dia, 10 leituras por texto em média, e que alguns viralizam (compartilhados em redes sociais) e recebem milhões de leituras.

**Esclareça primeiro.**

- Tamanho máximo e tamanho médio de um texto?
- Por quanto tempo os textos são guardados por padrão? Os expirados precisam sumir imediatamente?
- Destaque de sintaxe no servidor ou no navegador?

**Conceitos-chave.**

- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [DNS e CDN](../../../classes/edge/dns-cdn/index.md)
- Catálogo: [Object Store](../../../reference/components/storage/index.md#objstore) · [SQL Database](../../../reference/components/storage/index.md#sql) · [CDN](../../../reference/components/edge/index.md#cdn) · [Cache](../../../reference/components/storage/index.md#cache)

**Cuidado com.** Colocar blobs de 1 MB no banco relacional o incha, junto com os backups; guarde os metadados no banco e o conteúdo num object store, servido pela CDN.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Encurtador de URLs](../../../classes/case-studies/url-shortener/index.md) · Cenário do playground: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN absorvendo tráfego estático e de mídia)

??? tip "Dicas"

    - Armazenamento: 1 M/dia × ~10 KB em média ≈ 10 GB/dia ≈ 3,6 TB/ano: um object store, não um banco.
    - Reaproveite a geração de chaves do encurtador de URLs para os ids.
    - Textos virais: conteúdo imutável permite TTLs longos na CDN e taxa de acerto altíssima.
    - Expiração: um campo de TTL mais regras de ciclo de vida no object store; verificação preguiçosa na leitura.

#### 3. Ranking de um jogo { #leaderboard }

Projete o ranking de um jogo para celular com 20 milhões de jogadores por mês. Cada partida atualiza a pontuação do jogador; o app mostra o top 100 e a posição do próprio jogador ("você é o #1.234.567"). Pico de 50.000 atualizações de pontuação por segundo à noite. O ranking zera todo mês.

**Esclareça primeiro.**

- Posições em tempo real, ou um atraso de alguns segundos é aceitável?
- Só ranking global, ou também por país e entre amigos?
- Como os empates são desempatados?

**Conceitos-chave.**

- [Estruturas de dados e cluster do Redis](../../../classes/caching/redis/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- Catálogo: [Cache](../../../reference/components/storage/index.md#cache) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Message Queue](../../../reference/components/messaging/index.md#queue)

**Cuidado com.** `SELECT COUNT(*) WHERE score > ?` a cada requisição não escala para 20 milhões de linhas nesse ritmo; um sorted set dá a posição em O(log n).

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Cache distribuído](../../../classes/case-studies/distributed-cache/index.md) · Cenário do playground: [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) (cache-aside na frente do SQL)

??? tip "Dicas"

    - Sorted set do Redis: `ZINCRBY` na atualização, `ZREVRANGE` para o top 100, `ZREVRANK` para a minha posição.
    - 20 M de membros × ~100 bytes ≈ 2 GB: cabe na memória de um nó; replique para disponibilidade.
    - Persista as pontuações num banco também (fonte da verdade); reconstrua o set a partir dele após uma perda.
    - Além de um nó: particione por faixa de pontuação ou mantenha uma posição aproximada para a cauda longa.

#### 4. Catálogo de eventos do BoxOffice { #event-catalog }

Projete o catálogo de eventos do BoxOffice: páginas de shows, jogos e festivais com descrição, local, datas, preços e imagens. 50.000 eventos ativos, 5 milhões de visualizações por dia num dia normal, e até 200 vezes isso na manhã de uma grande abertura de vendas. Os produtores editam os eventos algumas vezes por dia.

**Esclareça primeiro.**

- Quão rápido uma mudança de preço precisa aparecer na página?
- As páginas são personalizadas (usuário logado, recomendações) ou iguais para todos?
- Que partes mudam durante uma abertura de vendas (disponibilidade) e quais não?

**Conceitos-chave.**

- [DNS e CDN](../../../classes/edge/dns-cdn/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [Invalidação de cache e TTL](../../../classes/caching/invalidation/index.md)
- [Replicação e atraso de replicação](../../../classes/databases/replication/index.md)
- Catálogo: [CDN](../../../reference/components/edge/index.md#cdn) · [Cache](../../../reference/components/storage/index.md#cache) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Object Store](../../../reference/components/storage/index.md#objstore)

**Cuidado com.** Misturar dados por usuário (carrinho, "você tem ingressos") na página cacheada destrói a taxa de acerto ou, pior, mostra os dados de um usuário a outro; mantenha a página pública e carregue as partes pessoais à parte.

**Pratique.** Estudo de caso: [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) · Cenário do playground: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN absorvendo tráfego estático e de mídia)

??? tip "Dicas"

    - 5 M de visualizações/dia ≈ 60/s em média; o pico da abertura pode chegar a 10⁴–10⁵/s, quase tudo nas mesmas poucas páginas.
    - Partes estáticas pela CDN com TTL curto (segundos) mais purge na edição; imagens com URLs versionadas.
    - Cache-aside no Redis para a API; réplicas de leitura para o banco.
    - A disponibilidade ("últimos assentos") vem de um endpoint separado e de vida curta, nunca embutida na página.

### Infraestrutura e plataforma { #infrastructure-platform }

#### 5. Rate limiter distribuído { #rate-limiter }

Projete o rate limiter do API gateway do BoxOffice. Cada usuário pode fazer no máximo 10 requisições por segundo à API de compra (rajadas de 20 permitidas), e cada chave de API de parceiro no máximo 1.000 por minuto. O gateway roda com 30 réplicas atrás de um load balancer e atende 200.000 requisições por segundo no pico.

**Esclareça primeiro.**

- Um limite um pouco impreciso (algumas requisições a mais) é aceitável em troca de latência?
- O que acontece quando o armazenamento do limitador fica indisponível: liberar ou bloquear?
- Os limites variam por endpoint, por plano ou por tipo de usuário?

**Conceitos-chave.**

- [API gateway e algoritmos de rate limiting](../../../classes/edge/api-gateway/index.md)
- [Estruturas de dados e cluster do Redis](../../../classes/caching/redis/index.md)
- [Timeouts, retries, circuit breakers e descarte de carga](../../../classes/reliability/patterns/index.md)
- Catálogo: [API Gateway](../../../reference/components/edge/index.md#apigw) · [Cache](../../../reference/components/storage/index.md#cache) · [Load Balancer](../../../reference/components/edge/index.md#lb)

**Cuidado com.** Contar na memória de cada réplica deixa um usuário obter 30 × o limite; o contador precisa ser compartilhado (Redis) ou o limite dividido por réplica. Uma janela fixa permite 2× o limite nas bordas das janelas.

**Pratique.** Estudo de caso: [Rate limiter](../../../classes/case-studies/rate-limiter/index.md) · Cenário do playground: [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter) (rate limiting no gateway)

??? tip "Dicas"

    - Token bucket (taxa 10/s, capacidade 20) por usuário, guardado no Redis e atualizado atomicamente com um script Lua.
    - Responda 429 com `Retry-After`; devolva a cota restante em cabeçalhos.
    - Fail open para a API geral (disponibilidade), fail closed para endpoints sensíveis a abuso.
    - Para cortar idas ao Redis: caches locais de fichas com sincronização periódica, aceitando pequeno excesso.

#### 6. Gerador de IDs únicos { #unique-id-generator }

O BoxOffice precisa de ids únicos de 64 bits para pedidos, ingressos e eventos, gerados por 200 instâncias de serviço em 3 regiões, até 100.000 ids por segundo no total. Os ids devem ser aproximadamente ordenáveis pela data de criação, e gerar um não pode exigir uma chamada de rede a um serviço central a cada requisição.

**Esclareça primeiro.**

- Os ids precisam ser estritamente crescentes, ou uma ordem aproximada por tempo basta?
- É um problema se os ids revelarem a data de criação ou o volume de pedidos?
- Podemos usar 128 bits (UUID) em vez de 64?

**Conceitos-chave.**

- [Tempo e relógios](../../../classes/distributed/time-clocks/index.md)
- [Consenso e quóruns](../../../classes/distributed/consensus/index.md)
- [Modelos de dados, SQL vs NoSQL e índices](../../../classes/databases/models/index.md)
- Catálogo: [App Server](../../../reference/components/compute/index.md#app) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Cuidado com.** Um único banco com auto-incremento é gargalo e ponto único de falha; chaves UUIDv4 aleatórias fragmentam índices B-tree. Relógios podem voltar no tempo: um gerador no estilo Snowflake precisa lidar com isso.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Encurtador de URLs](../../../classes/case-studies/url-shortener/index.md) · Cenário do playground: [`scale-out`](../../../../playground/scenarios/index.md#scale-out) (load balancer e réplicas)

??? tip "Dicas"

    - Layout do Snowflake: 41 bits de milissegundos + 10 bits de id da máquina + 12 bits de sequência ≈ 4.096 ids/ms por máquina.
    - Atribua os ids de máquina na inicialização (de um serviço de coordenação ou da configuração), nunca ao acaso.
    - Se o relógio voltar, espere ou recuse até ele alcançar.
    - Alternativas: UUIDv7 (ordenado por tempo, 128 bits) ou faixas do banco entregues em blocos.

#### 7. Serviço de feature flags { #feature-flags }

Projete um serviço de feature flags para os 40 serviços do BoxOffice: engenheiros ligam ou desligam funcionalidades e as liberam para uma porcentagem de usuários ou para segmentos específicos ("5% dos usuários no Brasil"). Cada requisição pode avaliar várias flags, então a avaliação não pode acrescentar praticamente nenhuma latência, e uma mudança precisa chegar a todos os serviços em até 10 segundos.

**Esclareça primeiro.**

- Quantas flags e regras, mais ou menos? As regras dependem de atributos do usuário?
- O que um serviço deve fazer se não alcançar o serviço de flags na inicialização?
- Precisamos de um log de auditoria de quem mudou o quê?

**Conceitos-chave.**

- [Canary releases e feature flags](../../../classes/cloud-native/delivery/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- Catálogo: [App Server](../../../reference/components/compute/index.md#app) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [Cache](../../../reference/components/storage/index.md#cache)

**Cuidado com.** Chamar o serviço de flags pela rede a cada avaliação o coloca no caminho crítico de toda requisição; avalie localmente a partir de um conjunto de regras em cache. Liberações por porcentagem precisam ser estáveis (hash do id do usuário), não aleatórias por requisição.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Cache distribuído](../../../classes/case-studies/distributed-cache/index.md) · Cenário do playground: [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) (cache-aside na frente do SQL)

??? tip "Dicas"

    - Um SDK em cada serviço mantém todas as regras em memória e avalia as flags localmente em microssegundos.
    - Mudanças guardadas num banco e enviadas por pub/sub ou streaming (SSE), com polling como plano B.
    - Porcentagens estáveis: `hash(flag, user_id) mod 100 < rollout%`.
    - Padrões seguros compilados no código; log de auditoria e um interruptor de emergência para cada flag.

### Muitas escritas e pipelines de dados { #write-heavy-data-pipelines }

#### 8. Contador de curtidas { #likes-counter }

Projete o contador de "tenho interesse" exibido em cada evento do BoxOffice (como um contador de curtidas de rede social). Usuários podem marcar e desmarcar interesse; a página mostra o total. A maioria dos eventos recebe poucos cliques por minuto, mas quando um grande artista anuncia uma turnê, um único evento recebe 20.000 cliques por segundo durante vários minutos.

**Esclareça primeiro.**

- O número exibido precisa ser exato e imediato, ou pode atrasar alguns segundos?
- Um usuário pode contar duas vezes? Precisamos saber quem tem interesse?
- A contagem é usada para algo crítico (ranking, cobrança)?

**Conceitos-chave.**

- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Chaves quentes e cache stampedes](../../../classes/caching/failure-modes/index.md)
- [Semântica de entrega e consumidores idempotentes](../../../classes/messaging/semantics/index.md)
- Catálogo: [Cache](../../../reference/components/storage/index.md#cache) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker)

**Cuidado com.** Uma linha `UPDATE events SET interested = interested + 1` vira uma linha quente: cada clique disputa o mesmo lock. Espalhe as escritas e agregue.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Feed de notícias](../../../classes/case-studies/news-feed/index.md) · Cenário do playground: [`sharding`](../../../../playground/scenarios/index.md#sharding) (partições e chaves quentes)

??? tip "Dicas"

    - Guarde quem tem interesse como linhas (usuário, evento) com chave única: idempotente e auditável.
    - Contadores particionados: N subcontadores por evento quente (sufixo aleatório), somados na leitura ou periodicamente.
    - Ou acumule os cliques numa fila e deixe workers aplicarem incrementos em lote a cada segundo.
    - Mostre um número aproximado e cacheado; a exatidão pode vir depois.

### Assíncrono e workflows { #async-workflows }

#### 9. Sistema de notificações { #notification-system }

Projete o sistema de notificações do BoxOffice: confirmações de pedido por e-mail, notificações push ("os portões abrem em 1 hora") e SMS para mudanças críticas ("show cancelado"). A carga normal é de 50 notificações por segundo; quando um show é cancelado, 60.000 fãs precisam ser avisados em até 10 minutos. Os usuários escolhem os canais e podem recusar marketing.

**Esclareça primeiro.**

- Quais mensagens são transacionais e quais são de marketing?
- At-least-once é aceitável (uma duplicata rara) ou nunca podemos enviar duas vezes?
- Há notificações agendadas (lembretes) além das disparadas por eventos?

**Conceitos-chave.**

- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- [Semântica de entrega e consumidores idempotentes](../../../classes/messaging/semantics/index.md)
- [Webhooks, chaves de idempotência e conciliação](../../../classes/compute/integrations/index.md)
- [Workers, schedulers e eleição de líder](../../../classes/compute/async-work/index.md)
- Catálogo: [Notifications](../../../reference/components/compute/index.md#notifications) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [Scheduler](../../../reference/components/compute/index.md#scheduler) · [Email](../../../reference/components/external/index.md#email)

**Cuidado com.** Chamar o provedor de e-mail de forma síncrona a partir do serviço de pedidos acopla a compra à latência e às quedas do provedor. E todo provedor tem limite de taxa: 60.000 mensagens em 10 minutos dão 100/s, que precisam caber nele.

**Pratique.** Estudo de caso: [Sistema de notificações](../../../classes/case-studies/notification-system/index.md) · Cenário do playground: [`notification-system`](../../../../playground/scenarios/index.md#notification-system) (scheduler, fila e provedores)

??? tip "Dicas"

    - Eventos (OrderConfirmed, ShowCancelled) → serviço de notificações → uma fila por canal → workers por canal.
    - Preferências e modelos consultados antes de enfileirar; limites por usuário para marketing.
    - Chave de idempotência (id do evento + canal) para que os retries não enviem duas vezes; DLQ após N falhas.
    - Filas com prioridade para que um disparo de marketing nunca atrase um aviso de cancelamento.

#### 10. Serviço de entrega de webhooks { #webhook-delivery }

Os parceiros do BoxOffice (produtores, locais) querem ser avisados por callbacks HTTP quando algo acontece: um ingresso vendido, um evento alterado, um reembolso emitido. 2.000 parceiros, 500 eventos por segundo no pico. Alguns endpoints de parceiros ficam lentos ou fora do ar por horas; um parceiro ruim não pode atrasar os outros.

**Esclareça primeiro.**

- Garantia de entrega: at-least-once com retries por quanto tempo?
- A ordem importa por parceiro (por exemplo, "vendido" antes de "reembolsado")?
- Como os parceiros verificam que a chamada realmente vem do BoxOffice?

**Conceitos-chave.**

- [Webhooks, chaves de idempotência e conciliação](../../../classes/compute/integrations/index.md)
- [Semântica de entrega e consumidores idempotentes](../../../classes/messaging/semantics/index.md)
- [Timeouts, retries, circuit breakers e descarte de carga](../../../classes/reliability/patterns/index.md)
- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- Catálogo: [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [3rd Party API](../../../reference/components/external/index.md#thirdparty) · [NAT Gateway](../../../reference/components/network/index.md#nat)

**Cuidado com.** Uma fila e um pool de workers compartilhados significam que um parceiro que leva 30 s para dar timeout bloqueia todo mundo (bloqueio na cabeça da fila). Isole por parceiro e faça backoff.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Sistema de notificações](../../../classes/case-studies/notification-system/index.md) · Cenário do playground: [`async-queue`](../../../../playground/scenarios/index.md#async-queue) (fila e workers absorvendo um pico)

??? tip "Dicas"

    - Persista cada evento e entregue a partir de uma fila particionada por parceiro (mantém a ordem por parceiro).
    - Timeouts curtos, backoff exponencial com jitter por até ~24–72 h, depois DLQ e um painel para os parceiros.
    - Assine os payloads (HMAC com um segredo por parceiro) e inclua um id de evento para que os parceiros possam deduplicar.
    - Limites de concorrência e circuit breakers por parceiro, para que um endpoint morto custe quase nada.

---

## Médio { #medium }

Dois ou três componentes que interagem, um número de escala de verdade e pelo menos um aprofundamento. A entrevista típica de 45 minutos.

### Muitas leituras e cache { #read-heavy-caching_1 }

#### 11. Feed de notícias { #news-feed }

Projete o feed inicial de uma rede social: usuários seguem outros e veem seus posts, do mais novo para o mais antigo. 300 milhões de usuários ativos por dia, cada um abrindo o feed cerca de 10 vezes por dia; 50 milhões de posts novos por dia. A maioria segue algumas centenas de contas, mas algumas celebridades têm 50 milhões de seguidores. Carregar a primeira página deve levar menos de 200 ms.

**Esclareça primeiro.**

- Feed cronológico ou ranqueado?
- Só texto, ou imagens e vídeo?
- Quão atualizado o feed precisa estar depois que alguém publica?

**Conceitos-chave.**

- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- Catálogo: [Cache](../../../reference/components/storage/index.md#cache) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [CDN](../../../reference/components/edge/index.md#cdn)

**Cuidado com.** Fan-out puro na escrita quebra com celebridades (um post = 50 M de escritas em timelines); fan-out puro na leitura faz cada abertura do feed consultar centenas de contas. A resposta é um híbrido.

**Pratique.** Estudo de caso: [Feed de notícias](../../../classes/case-studies/news-feed/index.md) · Cenário do playground: [`news-feed`](../../../../playground/scenarios/index.md#news-feed) (fan-out na escrita vs na leitura)

??? tip "Dicas"

    - Leituras: 300 M × 10 ÷ 10⁵ s ≈ 35.000 carregamentos/s em média; escritas ≈ 600 posts/s.
    - Fan-out na escrita em timelines por usuário (listas de ids de posts no Redis) para contas normais.
    - Posts de celebridades mesclados na hora da leitura; timelines de usuários inativos reconstruídas sob demanda.
    - Paginação por cursor; mídia servida do object storage pela CDN.

#### 12. Compartilhamento de fotos (estilo Instagram) { #photo-sharing }

Projete o envio e a visualização de fotos de um app no estilo Instagram: 500 milhões de usuários por dia, 100 milhões de fotos enviadas por dia (2 MB em média no original), cada foto exibida em 3 tamanhos. A visualização precisa ser rápida no mundo inteiro; os envios podem levar alguns segundos para ficarem visíveis.

**Esclareça primeiro.**

- Guardamos os originais para sempre?
- O feed está no escopo, ou só envio, armazenamento e visualização?
- Contas privadas: quem pode ver a URL de uma foto?

**Conceitos-chave.**

- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [DNS e CDN](../../../classes/edge/dns-cdn/index.md)
- [Workers, schedulers e eleição de líder](../../../classes/compute/async-work/index.md)
- Catálogo: [Object Store](../../../reference/components/storage/index.md#objstore) · [CDN](../../../reference/components/edge/index.md#cdn) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [NoSQL DB](../../../reference/components/storage/index.md#nosql)

**Cuidado com.** Enviar pelos seus servidores de aplicação desperdiça a banda deles; deixe os clientes enviarem direto ao object store com uma URL pré-assinada. O armazenamento domina o custo: estime-o.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Streaming de vídeo](../../../classes/case-studies/video-streaming/index.md) · Cenário do playground: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN absorvendo tráfego estático e de mídia)

??? tip "Dicas"

    - Armazenamento: 100 M × ~3 MB (original + tamanhos) ≈ 300 TB/dia ≈ 100 PB/ano: camadas de armazenamento importam.
    - Envio pré-assinado → evento de objeto criado → workers de redimensionamento → linha de metadados → visível.
    - Sirva pela CDN com URLs imutáveis e versionadas; URLs assinadas para conteúdo privado.
    - Metadados num armazenamento particionado pela chave do usuário; contadores (curtidas) tratados à parte.

#### 13. Autocompletar de busca { #search-autocomplete }

Projete o autocompletar da caixa de busca do BoxOffice: enquanto o fã digita "tay", sugira as 10 melhores completações (artistas, eventos, locais) em até 100 ms. 10 milhões de buscas por dia, cerca de 6 teclas cada, ou seja, uns 60 milhões de pedidos de sugestão por dia; as sugestões devem refletir eventos em alta dentro de uma hora.

**Esclareça primeiro.**

- Sugestões personalizadas ou iguais para todos?
- Tolerância a erros de digitação? Vários idiomas?
- Como se define "melhor": popularidade, recência, vendas?

**Conceitos-chave.**

- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [Partições, consumer groups e retenção do Kafka](../../../classes/messaging/kafka/index.md)
- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- Catálogo: [Search](../../../reference/components/compute/index.md#search) · [Cache](../../../reference/components/storage/index.md#cache) · [CDN](../../../reference/components/edge/index.md#cdn) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker)

**Cuidado com.** Consultar o banco principal com `LIKE 'tay%'` a cada tecla o derrete; pré-calcule as melhores completações por prefixo. E faça debounce no cliente: nem toda tecla precisa de uma requisição.

**Pratique.** Estudo de caso: [Autocompletar de busca](../../../classes/case-studies/search-autocomplete/index.md) · Cenário do playground: [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) (serviço de busca e cache)

??? tip "Dicas"

    - 60 M/dia ≈ 700 req/s em média, alguns milhares no pico; as respostas são minúsculas e muito cacheáveis.
    - Uma trie ou mapa de prefixos com o top 10 por prefixo, reconstruído a partir dos logs de busca e das vendas a cada poucos minutos.
    - Cacheie com força os prefixos curtos (CDN, navegador); são os que mais se repetem.
    - Pipeline: logs de consulta → Kafka → job de agregação → novo índice de prefixos → troca atômica.

#### 14. Cache distribuído { #distributed-cache }

Projete um cache distribuído em memória (como um Redis Cluster ou uma frota de Memcached simplificados) para o BoxOffice: 2 TB de dados, 1 milhão de operações por segundo, latência abaixo de 1 milissegundo dentro do data center. Nós falham e são acrescentados; o cache precisa continuar funcionando com só uma pequena queda na taxa de acerto quando isso acontece.

**Esclareça primeiro.**

- Cache puro (os dados podem se perder) ou também armazenamento primário?
- Tamanho dos valores? Proporção leitura/escrita?
- Os clientes roteiam direto para os nós, ou por um proxy?

**Conceitos-chave.**

- [Balanceamento de carga e hashing consistente](../../../classes/edge/load-balancing/index.md)
- [Estruturas de dados e cluster do Redis](../../../classes/caching/redis/index.md)
- [Chaves quentes e cache stampedes](../../../classes/caching/failure-modes/index.md)
- [Replicação e atraso de replicação](../../../classes/databases/replication/index.md)
- Catálogo: [Cache](../../../reference/components/storage/index.md#cache) · [App Server](../../../reference/components/compute/index.md#app)

**Cuidado com.** `hash(chave) mod N` remapeia quase todas as chaves quando N muda: cache frio geral e stampede no banco. Use hashing consistente (ou slots fixos de hash) e proteja as chaves quentes.

**Pratique.** Estudo de caso: [Cache distribuído](../../../classes/case-studies/distributed-cache/index.md) · Cenário do playground: [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) (cache-aside na frente do SQL)

??? tip "Dicas"

    - 2 TB ÷ 64 GB por nó ≈ 32 nós (mais réplicas); 1 M ops/s ÷ ~100 mil ops/s por nó ≈ 10 nós: quem decide é a memória.
    - Hashing consistente com nós virtuais, ou 16.384 slots de hash como no Redis Cluster.
    - Réplica por shard para failover; expulsão com LRU/LFU; TTL em tudo.
    - Chaves quentes: near cache no cliente, replicação da chave ou coalescência de requisições.

#### 15. Mapa de assentos do BoxOffice { #seat-map }

Durante uma abertura de vendas, os fãs olham o mapa de assentos do estádio (60.000 assentos, coloridos como livre/reservado/vendido) e escolhem assentos. 200.000 fãs estão no fluxo de compra ao mesmo tempo, atualizando o mapa a cada poucos segundos, enquanto cerca de 1.000 assentos por segundo mudam de estado. Projete como o mapa é servido e mantido razoavelmente atualizado.

**Esclareça primeiro.**

- Quão desatualizado o mapa pode estar: 1 s, 5 s?
- Os fãs escolhem o assento exato, ou o melhor disponível num setor?
- Mobile e web? Enviamos atualizações ou deixamos os clientes consultarem?

**Conceitos-chave.**

- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [Modelos de consistência](../../../classes/distributed/consistency/index.md)
- [WebSockets, SSE e gRPC](../../../classes/edge/protocols/index.md)
- [Transações, isolamento e locks](../../../classes/databases/transactions/index.md)
- Catálogo: [Cache](../../../reference/components/storage/index.md#cache) · [CDN](../../../reference/components/edge/index.md#cdn) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub)

**Cuidado com.** Consultar 60.000 linhas de assentos para cada um de 200.000 fãs a cada poucos segundos dá ~10⁹ linhas por segundo. O mapa é um retrato compacto em cache (um bitmap); a reserva em si é verificada no banco, então um mapa desatualizado só pode causar um educado "assento acabou de ser pego".

**Pratique.** Estudo de caso: [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) · Cenário do playground: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) (venda relâmpago com estoque limitado)

??? tip "Dicas"

    - Um bitmap de 60.000 assentos × 2 bits ≈ 15 KB: um objeto cacheável por evento, reconstruído a cada segundo.
    - Sirva-o pelo Redis ou pela CDN com TTL de 1 s; ou envie diferenças por SSE/WebSockets aos clientes.
    - Ofereça "melhor disponível no setor" para reduzir a disputa pelos assentos mais procurados.
    - A verificação oficial é o update condicional na hora da reserva.

### Muitas escritas e pipelines de dados { #write-heavy-data-pipelines_1 }

#### 16. Contador de visualizações de vídeos { #view-counter }

Projete o contador de visualizações de uma plataforma de vídeo: 1 bilhão de visualizações por dia em 500 milhões de vídeos, alguns recebendo 100.000 visualizações por minuto logo após o lançamento. Os criadores veem os números atualizarem em até um minuto; os números não podem ser inflados por bots nem pelo mesmo usuário repetindo os primeiros segundos.

**Esclareça primeiro.**

- O que conta como visualização (assistiu 30 s? qualquer início)?
- O número é usado para pagamentos (precisa ser exato e auditável)?
- Precisamos de recortes por dia/por país?

**Conceitos-chave.**

- [Partições, consumer groups e retenção do Kafka](../../../classes/messaging/kafka/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Semântica de entrega e consumidores idempotentes](../../../classes/messaging/semantics/index.md)
- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- Catálogo: [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Data Warehouse](../../../reference/components/storage/index.md#dwh) · [Cache](../../../reference/components/storage/index.md#cache)

**Cuidado com.** Incrementar uma linha do banco por visualização (≈ 12.000 escritas/s, concentradas nos vídeos quentes) cria linhas quentes; e contar "exatamente uma vez" exige deduplicação por id de evento, não esperança.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Streaming de vídeo](../../../classes/case-studies/video-streaming/index.md) · Cenário do playground: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) (stream de eventos com vários consumidores)

??? tip "Dicas"

    - Eventos de visualização → Kafka (chave: id do vídeo) → agregação em janelas de 1 minuto → armazenamento de contadores.
    - Deduplique por (usuário/sessão, vídeo, faixa de tempo); filtre bots antes de contar.
    - Número exibido = total guardado + janela recente, em cache; números exatos recalculados em lote para pagamentos.
    - Ideia lambda/kappa: caminho de stream rápido e aproximado, caminho em lote lento e exato.

#### 17. Top-K de eventos em alta { #top-k-trending }

O BoxOffice quer uma lista "em alta agora": os 50 eventos mais vistos e mais comprados na última hora, por país, atualizada a cada minuto. A entrada é um stream de 50.000 eventos de visualização e compra por segundo.

**Esclareça primeiro.**

- Contagens exatas ou um top-K aproximado é aceitável?
- Janela deslizante de exatamente uma hora ou faixas por hora?
- Como visualizações e compras são ponderadas?

**Conceitos-chave.**

- [Partições, consumer groups e retenção do Kafka](../../../classes/messaging/kafka/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- Catálogo: [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [Cache](../../../reference/components/storage/index.md#cache) · [Analytics](../../../reference/components/compute/index.md#analytics)

**Cuidado com.** Manter um contador exato para cada (evento, país, minuto) num banco funciona em pequena escala, mas explode em escritas; os mais frequentes podem ser achados com memória limitada (Count-Min Sketch + heap).

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Autocompletar de busca](../../../classes/case-studies/search-autocomplete/index.md) · Cenário do playground: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) (stream de eventos com vários consumidores)

??? tip "Dicas"

    - Particione o stream pelo id do evento; cada consumidor mantém contagens por minuto em memória.
    - A cada minuto, cada partição emite seu top-K local; um agregador calcula o top-K global por país.
    - Hora deslizante = soma das últimas 60 faixas de um minuto.
    - Sirva o resultado de um cache; ele é minúsculo e lido por todos.

#### 18. Agregação de cliques em anúncios { #ad-click-aggregation }

Projete o sistema que conta cliques em anúncios para cobrar os anunciantes: 10 bilhões de cliques por dia, pico de 500.000 por segundo. Os anunciantes veem dashboards por minuto com atraso de poucos minutos, e as faturas no fim do mês precisam ser exatas: nenhum clique contado duas vezes, nenhum perdido.

**Esclareça primeiro.**

- Com quanto atraso os eventos de clique podem chegar (mobile offline)?
- Filtramos cliques fraudulentos antes de cobrar?
- Por quais dimensões os anunciantes filtram?

**Conceitos-chave.**

- [Partições, consumer groups e retenção do Kafka](../../../classes/messaging/kafka/index.md)
- [Semântica de entrega e consumidores idempotentes](../../../classes/messaging/semantics/index.md)
- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [Tempo e relógios](../../../classes/distributed/time-clocks/index.md)
- Catálogo: [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [Data Warehouse](../../../reference/components/storage/index.md#dwh) · [Object Store](../../../reference/components/storage/index.md#objstore) · [Analytics](../../../reference/components/compute/index.md#analytics)

**Cuidado com.** Hora do evento não é hora de processamento: eventos atrasados precisam cair no minuto certo (watermarks). E a cobrança exige dados brutos reprocessáveis: guarde os cliques brutos, nunca só os agregados.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Feed de notícias](../../../classes/case-studies/news-feed/index.md) · Cenário do playground: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) (stream de eventos com vários consumidores)

??? tip "Dicas"

    - Cliques → Kafka (brutos, retidos) → job de stream com janelas por hora do evento → armazenamento OLAP para dashboards.
    - Deduplique pelo id do clique dentro de uma janela; escritas idempotentes dos agregados (upsert pela chave da janela).
    - Cliques brutos arquivados no object storage; um lote noturno recalcula os totais exatos das faturas.
    - Concilie os números do stream e do lote e alerte sobre divergências.

#### 19. Pipeline centralizado de logs { #logging-pipeline }

Projete o logging centralizado do BoxOffice: 300 instâncias de serviço produzindo 2 TB de logs por dia (10× durante uma abertura de vendas), pesquisáveis em até 30 segundos por trace id, id de pedido ou mensagem de erro, guardados 14 dias de forma quente e 1 ano arquivados. O logging nunca pode deixar os serviços lentos nem derrubá-los.

**Esclareça primeiro.**

- Os logs já são estruturados (JSON), ou texto livre?
- Quais campos precisam ser pesquisáveis, e é preciso busca de texto completo?
- Há dados pessoais nos logs que precisam ser mascarados?

**Conceitos-chave.**

- [Métricas, logs e traces](../../../classes/observability/signals/index.md)
- [OpenTelemetry](../../../classes/observability/opentelemetry/index.md)
- [Partições, consumer groups e retenção do Kafka](../../../classes/messaging/kafka/index.md)
- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- Catálogo: [Logs](../../../reference/components/observability/index.md#logs) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Object Store](../../../reference/components/storage/index.md#objstore) · [Worker](../../../reference/components/compute/index.md#worker)

**Cuidado com.** Indexar cada campo de cada linha é o jeito mais caro de fazer isso; e se o pipeline engasgar, os agentes precisam acumular e descartar logs de debug, não bloquear a aplicação.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Sistema de notificações](../../../classes/case-studies/notification-system/index.md) · Cenário do playground: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack) (métricas, logs, traces, alertas)

??? tip "Dicas"

    - As aplicações escrevem no stdout; agentes nos nós (OpenTelemetry Collector, Fluent Bit) enviam ao Kafka como buffer.
    - Indexadores consomem do Kafka; indexe só labels/campos-chave (estilo Loki) ou texto completo (OpenSearch) onde for necessário.
    - Camada quente por 14 dias, depois objetos comprimidos no object storage com regras de ciclo de vida.
    - Amostre os logs de requisições bem-sucedidas, guarde todos os erros; mascare campos sensíveis na origem.

#### 20. Sistema de métricas e monitoramento { #metrics-monitoring }

Projete uma plataforma de métricas (como um Prometheus + Grafana simplificado oferecido como serviço) para 5.000 servidores, cada um expondo 1.000 séries temporais coletadas a cada 15 s. Os dashboards precisam carregar em menos de 2 s para as últimas 24 horas, os alertas precisam ser avaliados a cada 30 s e os dados ficam guardados por 1 ano em resolução reduzida.

**Esclareça primeiro.**

- Pull (coleta) ou push?
- Quantas combinações distintas de labels (cardinalidade)?
- O sistema de monitoramento precisa ser mais disponível que o que ele monitora?

**Conceitos-chave.**

- [Métricas, logs e traces](../../../classes/observability/signals/index.md)
- [Alertas baseados em SLO](../../../classes/observability/alerting/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- Catálogo: [Metrics](../../../reference/components/observability/index.md#metrics) · [Alerting](../../../reference/components/observability/index.md#alerting) · [Object Store](../../../reference/components/storage/index.md#objstore) · [NoSQL DB](../../../reference/components/storage/index.md#nosql)

**Cuidado com.** 5.000 × 1.000 = 5 milhões de séries ativas, ≈ 333.000 amostras por segundo: um banco de propósito geral é o armazenamento errado. E um monitoramento que cai junto com o cluster que observa é inútil durante a queda.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Cache distribuído](../../../classes/case-studies/distributed-cache/index.md) · Cenário do playground: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack) (métricas, logs, traces, alertas)

??? tip "Dicas"

    - Banco de séries temporais com compressão (≈ 1–2 bytes por amostra), particionado pelo hash da série.
    - Dados recentes em memória/SSD; blocos antigos compactados e com resolução reduzida no object storage.
    - Regras de alerta avaliadas perto dos dados; agrupamento e roteamento no estilo do Alertmanager.
    - Limites de cardinalidade por cliente; rode a pilha de monitoramento fora do domínio de falha monitorado.

### Tempo real e geolocalização { #real-time-geo }

#### 21. Chat (WhatsApp / Slack) { #chat }

Projete um serviço de chat com conversas individuais e em grupo (até 500 membros), presença online e confirmações de entrega/leitura. 50 milhões de usuários por dia, 40 mensagens por usuário por dia, e mensagens entregues em até um segundo para usuários online; usuários offline as recebem ao reconectar.

**Esclareça primeiro.**

- O histórico de mensagens fica para sempre e é sincronizado entre dispositivos?
- Criptografia de ponta a ponta?
- Mensagens com mídia estão no escopo?

**Conceitos-chave.**

- [WebSockets, SSE e gRPC](../../../classes/edge/protocols/index.md)
- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Tempo e relógios](../../../classes/distributed/time-clocks/index.md)
- Catálogo: [Load Balancer](../../../reference/components/edge/index.md#lb) · [App Server](../../../reference/components/compute/index.md#app) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Notifications](../../../reference/components/compute/index.md#notifications)

**Cuidado com.** Ordenação global de todas as mensagens é desnecessária e não escala; a ordem por conversa (um número de sequência por id de conversa) é o que os usuários veem. E um servidor de WebSockets precisa saber em que servidor cada destinatário está conectado.

**Pratique.** Estudo de caso: [Chat](../../../classes/case-studies/chat/index.md) · Cenário do playground: [`chat`](../../../../playground/scenarios/index.md#chat) (websockets e pub/sub)

??? tip "Dicas"

    - 2 × 10⁹ mensagens/dia ≈ 23.000/s em média; milhões de conexões WebSocket simultâneas espalhadas pelos servidores de gateway.
    - Registro de conexões (usuário → servidor de gateway) num armazenamento rápido; pub/sub entre os servidores de gateway.
    - Guarde as mensagens particionadas pelo id da conversa (banco de colunas largas), com sequência por conversa.
    - Offline: guardar e encaminhar, mais notificações push; as confirmações são só mais mensagens pequenas.

#### 22. Comentários e reações ao vivo { #live-comments }

Durante a transmissão ao vivo de um festival pelo BoxOffice, 1 milhão de espectadores assistem ao mesmo tempo e postam comentários e reações com emoji. No pico, 20.000 comentários por segundo. Todo espectador deve ver um fluxo animado de comentários recentes e as contagens agregadas das reações, com atraso de no máximo 2 segundos.

**Esclareça primeiro.**

- Todo espectador precisa ver todos os comentários, ou uma amostra basta?
- Moderação antes ou depois da exibição?
- Os comentários ficam guardados depois que a transmissão acaba?

**Conceitos-chave.**

- [WebSockets, SSE e gRPC](../../../classes/edge/protocols/index.md)
- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- [Timeouts, retries, circuit breakers e descarte de carga](../../../classes/reliability/patterns/index.md)
- Catálogo: [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [Load Balancer](../../../reference/components/edge/index.md#lb) · [App Server](../../../reference/components/compute/index.md#app) · [Cache](../../../reference/components/storage/index.md#cache) · [Kafka](../../../reference/components/messaging/index.md#kafka)

**Cuidado com.** Transmitir 20.000 comentários/s para 1 M de espectadores dá 2 × 10¹⁰ mensagens/s; ninguém consegue ler isso. Amostre ou limite o que cada espectador recebe, e agregue as reações em contagens.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Chat](../../../classes/case-studies/chat/index.md) · Cenário do playground: [`chat`](../../../../playground/scenarios/index.md#chat) (websockets e pub/sub)

??? tip "Dicas"

    - Os espectadores mantêm conexões SSE/WebSocket com servidores de borda inscritos no canal da transmissão.
    - Cada servidor de borda recebe um feed reduzido (por exemplo, 20 comentários/s) e o distribui localmente.
    - Reações agregadas por segundo em cada servidor, depois globalmente; transmita só as contagens.
    - Grave todos os comentários no Kafka para moderação, replay e armazenamento, fora do caminho da transmissão.

#### 23. Serviço de proximidade (estilo Yelp) { #proximity-service }

Projete o "o que há perto de mim": dada a localização de um fã, liste bares, restaurantes e estacionamentos num raio de 2 km de um local de evento, ordenados por distância e avaliação. 200 milhões de lugares no mundo, 20.000 buscas por segundo no pico; lugares são acrescentados ou editados alguns milhares de vezes por dia.

**Esclareça primeiro.**

- Raio fixo ou "N mais próximos"? Filtros (aberto agora, categoria)?
- Com que rapidez um lugar novo precisa aparecer nos resultados?
- Global ou alguns países?

**Conceitos-chave.**

- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Replicação e atraso de replicação](../../../classes/databases/replication/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- Catálogo: [Search](../../../reference/components/compute/index.md#search) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Cache](../../../reference/components/storage/index.md#cache) · [App Server](../../../reference/components/compute/index.md#app)

**Cuidado com.** `WHERE lat BETWEEN … AND lng BETWEEN …` com dois índices separados varre faixas enormes; use um índice geoespacial (geohash, quadtree, células S2/H3). Os dados são quase só leitura: réplicas e caches vêm antes de sharding.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Transporte por aplicativo](../../../classes/case-studies/ride-sharing/index.md) · Cenário do playground: [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) (índice geográfico e atualizações de localização)

??? tip "Dicas"

    - 200 M de lugares × ~1 KB ≈ 200 GB: cabe em poucas máquinas; replique para ter vazão de leitura.
    - Índice por prefixo de geohash (ou célula H3): consulte a célula e as vizinhas, depois filtre pela distância exata.
    - Cacheie resultados por (célula, filtros) nas áreas populares em volta dos locais de evento.
    - Edições de lugares vão para o índice de busca de forma assíncrona; minutos de atraso são aceitáveis.

### Assíncrono e workflows { #async-workflows_1 }

#### 24. Agendador de jobs distribuído { #job-scheduler }

Projete um agendador que roda os jobs do BoxOffice: "liberar as reservas de assento não pagas a cada minuto", "enviar lembretes 24 h antes de cada show", relatórios noturnos e conciliação. 1 milhão de jobs agendados por dia, alguns recorrentes (cron) e outros pontuais numa data/hora; cada job precisa rodar uma vez, na hora (com segundos de tolerância), mesmo que máquinas do agendador falhem.

**Esclareça primeiro.**

- O que acontece se um job rodar duas vezes? Os jobs podem ser idempotentes?
- Duração máxima de um job? Retries em caso de falha?
- Os jobs têm prioridades ou dependências?

**Conceitos-chave.**

- [Workers, schedulers e eleição de líder](../../../classes/compute/async-work/index.md)
- [Consenso e quóruns](../../../classes/distributed/consensus/index.md)
- [Semântica de entrega e consumidores idempotentes](../../../classes/messaging/semantics/index.md)
- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- Catálogo: [Scheduler](../../../reference/components/compute/index.md#scheduler) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Cuidado com.** Rodar cron em cada réplica dispara cada job N vezes; uma única máquina de agendamento é ponto único de falha. Você precisa de eleição de líder ou de reivindicação por linha, mais jobs idempotentes, porque "exatamente uma vez" às vezes vira "pelo menos uma vez".

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Sistema de notificações](../../../classes/case-studies/notification-system/index.md) · Cenário do playground: [`notification-system`](../../../../playground/scenarios/index.md#notification-system) (scheduler, fila e provedores)

??? tip "Dicas"

    - Tabela de jobs indexada por `next_run_at`; pollers reivindicam os jobs vencidos com `SELECT … FOR UPDATE SKIP LOCKED` ou um lease.
    - Os jobs reivindicados vão para uma fila; workers executam e registram o resultado; leases expiram se um worker morrer.
    - Jobs recorrentes calculam a próxima execução após cada execução.
    - Particione a tabela de jobs por faixa de tempo ou por id quando um banco não bastar.

#### 25. Web crawler { #web-crawler }

Projete um crawler que busca 1 bilhão de páginas web por mês para construir um índice de busca, revisitando as páginas populares com mais frequência. Ele precisa ser educado (respeitar o robots.txt e nunca martelar um site), evitar páginas duplicadas e escapar de armadilhas (calendários infinitos, ids de sessão nas URLs).

**Esclareça primeiro.**

- Só HTML, ou também imagens e PDFs?
- Quão atualizadas as páginas populares precisam estar?
- Precisamos renderizar JavaScript?

**Conceitos-chave.**

- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- [Workers, schedulers e eleição de líder](../../../classes/compute/async-work/index.md)
- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- Catálogo: [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [Object Store](../../../reference/components/storage/index.md#objstore) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [3rd Party API](../../../reference/components/external/index.md#thirdparty)

**Cuidado com.** Uma fronteira FIFO única deixa um site grande monopolizar os crawlers e quebra a educação; particione a fronteira por host. E sem normalização de URLs e um conjunto de já vistas, o crawler fica em loop para sempre.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Sistema de notificações](../../../classes/case-studies/notification-system/index.md) · Cenário do playground: [`async-queue`](../../../../playground/scenarios/index.md#async-queue) (fila e workers absorvendo um pico)

??? tip "Dicas"

    - 10⁹ páginas/mês ≈ 400 páginas/s; a ~100 KB cada ≈ 100 TB/mês de conteúdo bruto no object storage.
    - Fronteira de URLs: filas de prioridade por importância, depois filas por host com intervalo entre requisições.
    - URLs já vistas num filtro de Bloom ou armazenamento chave-valor; hash do conteúdo (por exemplo, SimHash) para quase duplicatas.
    - Cache de DNS, cache do robots.txt por host, limites de profundidade/tamanho de URL contra armadilhas.

#### 26. Reembolsos do BoxOffice após um cancelamento { #refunds }

Um show num estádio com 60.000 ingressos vendidos é cancelado. O BoxOffice precisa reembolsar cada pedido (cartão ou Pix) pelo provedor de pagamento, liberar os ingressos, avisar os fãs e informar o progresso ao produtor. O provedor aceita no máximo 100 pedidos de reembolso por segundo. Projete o processo de reembolso.

**Esclareça primeiro.**

- Só reembolsos integrais, ou as taxas ficam? Reembolsos parciais em pedidos com vários ingressos?
- Prazo para todos os reembolsos?
- Como tratamos pedidos cujo meio de pagamento não pode mais ser reembolsado?

**Conceitos-chave.**

- [Webhooks, chaves de idempotência e conciliação](../../../classes/compute/integrations/index.md)
- [Outbox, sagas, CQRS e event sourcing](../../../classes/messaging/patterns/index.md)
- [Semântica de entrega e consumidores idempotentes](../../../classes/messaging/semantics/index.md)
- [Timeouts, retries, circuit breakers e descarte de carga](../../../classes/reliability/patterns/index.md)
- Catálogo: [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [Payment](../../../reference/components/external/index.md#payment) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Notifications](../../../reference/components/compute/index.md#notifications)

**Cuidado com.** Um laço que chama o provedor para 60.000 pedidos dentro de uma transação ou requisição vai estourar o tempo no meio e, se reiniciado, reembolsar alguns pedidos duas vezes. Cada reembolso precisa de uma chave de idempotência e do próprio estado acompanhado.

**Pratique.** Estudo de caso: [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) · Cenário do playground: [`payment-system`](../../../../playground/scenarios/index.md#payment-system) (idempotência e um provedor externo)

??? tip "Dicas"

    - Um job de reembolso por pedido numa tabela (estado: pending → requested → confirmed/failed), enfileirado.
    - Workers limitados a ~90/s (abaixo da cota): 60.000 reembolsos ≈ 11 minutos.
    - Chave de idempotência = id do reembolso; confirmação pelo webhook do provedor; retries com backoff; DLQ para tratamento manual.
    - Progresso = contagem por estado; as notificações saem na confirmação, não no pedido.

### Infraestrutura e plataforma { #infrastructure-platform_1 }

#### 27. API gateway { #api-gateway }

Projete o API gateway na frente dos 40 microsserviços do BoxOffice: roteamento por caminho e versão, autenticação (JWT), rate limiting, log das requisições e canary releases. 200.000 requisições por segundo no pico; o gateway pode acrescentar no máximo 5 ms no p99.

**Esclareça primeiro.**

- Quais responsabilidades pertencem ao gateway e quais aos serviços?
- A configuração muda com frequência, por muitos times?
- Um gateway para todos os clientes, ou um por tipo de cliente (BFF)?

**Conceitos-chave.**

- [API gateway e algoritmos de rate limiting](../../../classes/edge/api-gateway/index.md)
- [OAuth 2 / OIDC e JWT](../../../classes/edge/identity/index.md)
- [Balanceamento de carga e hashing consistente](../../../classes/edge/load-balancing/index.md)
- [Canary releases e feature flags](../../../classes/cloud-native/delivery/index.md)
- Catálogo: [API Gateway](../../../reference/components/edge/index.md#apigw) · [Load Balancer](../../../reference/components/edge/index.md#lb) · [Auth Service](../../../reference/components/compute/index.md#auth) · [Cache](../../../reference/components/storage/index.md#cache) · [Logs](../../../reference/components/observability/index.md#logs)

**Cuidado com.** Chamar o serviço de autenticação a cada requisição para validar tokens dobra o tráfego e acrescenta latência; verifique as assinaturas JWT localmente com chaves em cache. E lógica de negócio no gateway o transforma num monolito compartilhado.

**Pratique.** Estudo de caso: [Rate limiter](../../../classes/case-studies/rate-limiter/index.md) · Cenário do playground: [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter) (rate limiting no gateway)

??? tip "Dicas"

    - Réplicas de gateway sem estado atrás de um load balancer L4; escale horizontalmente pela CPU.
    - Tabela de rotas e políticas carregadas em memória, atualizadas por envio de configuração (sem reiniciar).
    - Validação de JWT com chaves de assinatura em cache (JWKS); rate limits no Redis.
    - Rotas com pesos para canaries; logs de acesso e traces emitidos de forma assíncrona.

#### 28. Rede de distribuição de conteúdo (CDN) { #cdn }

Projete uma CDN para as imagens, scripts e páginas de eventos do BoxOffice: 100 pontos de presença no mundo, 10 Tbps de saída no pico, meta de 95% de acerto e purges de uma página de evento alterada que valham no mundo todo em até 10 segundos.

**Esclareça primeiro.**

- Que conteúdo é cacheável e por quanto tempo?
- Precisamos de computação na borda (personalização, testes A/B)?
- Como os usuários chegam ao ponto de presença mais próximo?

**Conceitos-chave.**

- [DNS e CDN](../../../classes/edge/dns-cdn/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [Chaves quentes e cache stampedes](../../../classes/caching/failure-modes/index.md)
- [Invalidação de cache e TTL](../../../classes/caching/invalidation/index.md)
- Catálogo: [DNS](../../../reference/components/edge/index.md#dns) · [CDN](../../../reference/components/edge/index.md#cdn) · [Object Store](../../../reference/components/storage/index.md#objstore) · [Load Balancer](../../../reference/components/edge/index.md#lb)

**Cuidado com.** Se todas as bordas forem à origem ao mesmo tempo (depois de um purge ou para um objeto viral novo), a origem derrete; use uma camada intermediária (origin shield) e coalescência de requisições.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Streaming de vídeo](../../../classes/case-studies/video-streaming/index.md) · Cenário do playground: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN absorvendo tráfego estático e de mídia)

??? tip "Dicas"

    - Roteamento: IPs anycast ou GeoDNS até o ponto de presença saudável mais próximo.
    - Cache em duas camadas: bordas → escudo regional → origem; hashing consistente dos objetos dentro de um site.
    - Desenho da chave de cache (caminho + query normalizada), `Cache-Control` e assets versionados.
    - Purge: distribuição por pub/sub para todas as bordas, mais TTLs curtos para páginas dinâmicas.

---

## Difícil { #hard }

Disputa, dinheiro, tempo real ou mídia em escala: o design ingênuo falha, e é no aprofundamento que a entrevista se decide.

### Dinheiro e consistência { #money-consistency }

#### 29. Venda relâmpago do BoxOffice (ingressos) { #flash-sale-ticketing }

O exemplo que acompanha o curso. Um show num estádio abre as vendas sábado às 10:00: 2 milhões de fãs para 60.000 assentos. Os fãs escolhem assentos, seguram-nos por 10 minutos enquanto pagam por um provedor externo e recebem o ingresso por e-mail. Nenhum assento pode ser vendido duas vezes, o site precisa ficar de pé, o processo deve parecer justo e os bots não podem levar os ingressos.

**Esclareça primeiro.**

- Escolha de assento ou "melhor disponível"? Limite de ingressos por fã?
- Uma sala de espera virtual é aceitável para o negócio?
- Quanto dura a reserva, e o que acontece quando o pagamento falha?

**Conceitos-chave.**

- [Transações, isolamento e locks](../../../classes/databases/transactions/index.md)
- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- [DNS e CDN](../../../classes/edge/dns-cdn/index.md)
- [Webhooks, chaves de idempotência e conciliação](../../../classes/compute/integrations/index.md)
- [Timeouts, retries, circuit breakers e descarte de carga](../../../classes/reliability/patterns/index.md)
- Catálogo: [CDN](../../../reference/components/edge/index.md#cdn) · [WAF](../../../reference/components/edge/index.md#waf) · [API Gateway](../../../reference/components/edge/index.md#apigw) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Payment](../../../reference/components/external/index.md#payment)

**Cuidado com.** Tratar como um problema só de escala ("acrescente servidores") erra o alvo: as partes difíceis são a disputa por 60.000 linhas, uma reserva correta e um provedor de pagamento externo que vira o gargalo às 10:00.

**Pratique.** Estudo de caso: [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) · Cenário do playground: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) (venda relâmpago com estoque limitado)

??? tip "Dicas"

    - A borda absorve as leituras (CDN para as páginas, mapa de assentos em cache); WAF e limites por usuário contra bots.
    - Sala de espera: admita fãs no ritmo que o inventário e o pagamento aguentam, com tokens de admissão assinados.
    - Reserva = um único update condicional atômico com `hold_until`; um job de expiração libera reservas não pagas.
    - Pagamento com chave de idempotência, timeout e circuit breaker; confirmação por webhook; outbox → Kafka → e-mail.

#### 30. Sistema de pagamentos { #payment-system }

Projete o serviço de pagamentos do BoxOffice: ele cobra os fãs por dois provedores de pagamento externos (cartões e Pix), trata reembolsos, registra cada movimento num livro-razão e concilia diariamente com os provedores. 1.000 pagamentos por segundo no pico; nunca cobrar duas vezes, nunca perder um pagamento confirmado.

**Esclareça primeiro.**

- Guardamos dados de cartão (escopo PCI) ou só tokens do provedor?
- A confirmação síncrona é obrigatória, ou um pedido pode ficar "pagamento pendente"?
- Várias moedas?

**Conceitos-chave.**

- [Webhooks, chaves de idempotência e conciliação](../../../classes/compute/integrations/index.md)
- [Transações, isolamento e locks](../../../classes/databases/transactions/index.md)
- [Outbox, sagas, CQRS e event sourcing](../../../classes/messaging/patterns/index.md)
- [Timeouts, retries, circuit breakers e descarte de carga](../../../classes/reliability/patterns/index.md)
- Catálogo: [Payment](../../../reference/components/external/index.md#payment) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [NAT Gateway](../../../reference/components/network/index.md#nat)

**Cuidado com.** Um timeout do provedor não é uma falha: a cobrança pode ter dado certo. Repetir sem chave de idempotência, ou confiar no redirecionamento do navegador em vez de um webhook assinado, cria cobranças em dobro e pagamentos fantasmas.

**Pratique.** Estudo de caso: [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) · Cenário do playground: [`payment-system`](../../../../playground/scenarios/index.md#payment-system) (idempotência e um provedor externo)

??? tip "Dicas"

    - Máquina de estados do pagamento (created → pending → succeeded/failed → refunded) num banco relacional.
    - Chave de idempotência por tentativa, guardada com o resultado; adaptador do provedor com timeout, retries e circuit breaker.
    - Livro-razão de partidas dobradas: linhas só acrescentadas, todo movimento balanceado.
    - Webhooks guardados primeiro e processados de forma idempotente; conciliação diária com os relatórios dos provedores.

#### 31. Sala de espera virtual do BoxOffice { #waiting-room }

Projete só a sala de espera das maiores aberturas de vendas do BoxOffice: até 3 milhões de fãs chegam entre 09:55 e 10:05; o fluxo de compra consegue admitir 2.000 fãs por minuto. Os fãs veem a posição e o tempo estimado, mantêm o lugar se recarregarem a página e não podem furar a fila abrindo várias abas ou usando bots.

**Esclareça primeiro.**

- Fãs que chegam antes das 10:00: ordem aleatória ou por ordem de chegada?
- E se o evento esgotar enquanto as pessoas esperam?
- A sala de espera precisa funcionar mesmo com o resto da plataforma degradado?

**Conceitos-chave.**

- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- [API gateway e algoritmos de rate limiting](../../../classes/edge/api-gateway/index.md)
- [Lei de Little e filas](../../../classes/estimation/queueing/index.md)
- [OAuth 2 / OIDC e JWT](../../../classes/edge/identity/index.md)
- Catálogo: [CDN](../../../reference/components/edge/index.md#cdn) · [WAF](../../../reference/components/edge/index.md#waf) · [API Gateway](../../../reference/components/edge/index.md#apigw) · [Cache](../../../reference/components/storage/index.md#cache) · [Message Queue](../../../reference/components/messaging/index.md#queue)

**Cuidado com.** Se a sala de espera depende do backend que ela protege, ela cai junto. Mantenha-a na borda (CDN, gateway, um armazenamento pequeno e rápido) e faça tokens de admissão verificáveis sem chamar o banco.

**Pratique.** Estudo de caso: [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) · Cenário do playground: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) (venda relâmpago com estoque limitado)

??? tip "Dicas"

    - Lei de Little: 3 M de fãs ÷ 2.000/min ≈ 25 horas de fila — avise o negócio; o esgotamento vem muito antes.
    - Na chegada: um token assinado com um número na fila (aleatório para quem chegou cedo); posição = número − contador de admitidos.
    - Uma página estática da CDN consulta um endpoint minúsculo a cada 20–30 s para saber o contador de admitidos.
    - Admissão = token assinado e de vida curta, verificado pelo gateway; um por conta, com verificação de bots.

#### 32. Reserva de hotéis { #hotel-booking }

Projete um sistema de reservas de hotéis (como o Booking.com) para 1 milhão de hotéis: usuários buscam disponibilidade para intervalos de datas, reservam quartos e pagam. 5.000 buscas por segundo e 200 reservas por segundo no pico. Os hotéis permitem até 10% de overbooking em alguns tipos de quarto; além disso, reserva dupla nunca pode acontecer.

**Esclareça primeiro.**

- Reservamos um quarto específico ou um tipo de quarto?
- Paga-se na reserva ou no hotel? Política de cancelamento?
- Os preços mudam por dia e por demanda?

**Conceitos-chave.**

- [Transações, isolamento e locks](../../../classes/databases/transactions/index.md)
- [Modelos de dados, SQL vs NoSQL e índices](../../../classes/databases/models/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- Catálogo: [Search](../../../reference/components/compute/index.md#search) · [Cache](../../../reference/components/storage/index.md#cache) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Payment](../../../reference/components/external/index.md#payment)

**Cuidado com.** A disponibilidade precisa ser modelada por (hotel, tipo de quarto, data): uma reserva de 3 noites atualiza 3 linhas numa transação. As buscas podem vir de um cache desatualizado; a reserva em si, não.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) · Cenário do playground: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) (venda relâmpago com estoque limitado)

??? tip "Dicas"

    - Tabela `inventory(hotel, room_type, date, total, reserved)`; reserve com `UPDATE … SET reserved = reserved + 1 WHERE reserved < total * 1.1` por data, numa só transação.
    - Chave de idempotência no pedido de reserva (usuários clicam duas vezes).
    - Busca: um índice de disponibilidade desnormalizado, atualizado de forma assíncrona, em cache por cidade/data.
    - Particione pelo id do hotel; o inventário de um hotel fica num shard, então as transações continuam locais.

#### 33. Checkout de e-commerce { #checkout }

Projete o checkout de uma loja online na Black Friday: 5.000 pedidos por segundo no pico, cada um reservando estoque num serviço de inventário, cobrando por um provedor de pagamento, criando o pedido e disparando a entrega. Se o pagamento falhar, o estoque precisa ser liberado; se o estoque acabar, ninguém deve ser cobrado.

**Esclareça primeiro.**

- Inventário, pagamento e pedidos pertencem a serviços e bancos diferentes?
- Reservar estoque ao pôr no carrinho ou no checkout?
- Vender um pouco além do estoque é aceitável para alguns itens?

**Conceitos-chave.**

- [Outbox, sagas, CQRS e event sourcing](../../../classes/messaging/patterns/index.md)
- [Transações, isolamento e locks](../../../classes/databases/transactions/index.md)
- [Semântica de entrega e consumidores idempotentes](../../../classes/messaging/semantics/index.md)
- [Webhooks, chaves de idempotência e conciliação](../../../classes/compute/integrations/index.md)
- Catálogo: [App Server](../../../reference/components/compute/index.md#app) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Payment](../../../reference/components/external/index.md#payment) · [Message Queue](../../../reference/components/messaging/index.md#queue)

**Cuidado com.** Uma transação distribuída (two-phase commit) entre serviços e um provedor externo não está disponível ou não é viável; você precisa de uma saga com compensações, e cada passo precisa ser idempotente, porque as mensagens são entregues pelo menos uma vez.

**Pratique.** Estudo de caso: [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) · Cenário do playground: [`payment-system`](../../../../playground/scenarios/index.md#payment-system) (idempotência e um provedor externo)

??? tip "Dicas"

    - Saga orquestrada: reservar estoque → cobrar → confirmar pedido → enviar; compensações: liberar estoque, reembolsar.
    - Cada serviço grava a mudança de estado e o evento atomicamente (transactional outbox).
    - Reserva de estoque com expiração, para que checkouts abandonados liberem os itens automaticamente.
    - Itens quentes: contadores por item com decrementos condicionais; enfileire os pedidos dos SKUs mais disputados.

#### 34. Carteira digital { #digital-wallet }

O BoxOffice lança uma carteira: os fãs mantêm um saldo (créditos de reembolsos, vales-presente), pagam ingressos com ele e transferem créditos para amigos. 10 milhões de carteiras, 5.000 transações por segundo no pico. Os saldos nunca podem ficar negativos nem divergir, e todo movimento precisa ser auditável por anos.

**Esclareça primeiro.**

- Transferências entre usuários em shards ou regiões diferentes?
- A carteira é regulada (regras de moeda eletrônica, KYC)?
- Read-your-writes para o saldo exibido após um pagamento?

**Conceitos-chave.**

- [Transações, isolamento e locks](../../../classes/databases/transactions/index.md)
- [Outbox, sagas, CQRS e event sourcing](../../../classes/messaging/patterns/index.md)
- [Modelos de consistência](../../../classes/distributed/consistency/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- Catálogo: [SQL Database](../../../reference/components/storage/index.md#sql) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [App Server](../../../reference/components/compute/index.md#app)

**Cuidado com.** Guardar só uma coluna `balance` mutável perde o histórico e torna bugs irrecuperáveis; um livro-razão só de acréscimos, com o saldo como valor derivado (e verificado), é o padrão. Uma transferência entre dois shards não pode ser uma transação local só.

**Pratique.** Estudo de caso: [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) · Cenário do playground: [`payment-system`](../../../../playground/scenarios/index.md#payment-system) (idempotência e um provedor externo)

??? tip "Dicas"

    - Lançamentos de partidas dobradas (débito + crédito) gravados numa transação quando as duas carteiras estão no mesmo shard.
    - Transferências entre shards: uma saga por meio de um registro de transferência (pending → debited → credited) com passos idempotentes.
    - Verificação de saldo com `SELECT … FOR UPDATE` ou update condicional; lock otimista por versão.
    - Visão de event sourcing: o saldo é a soma dos lançamentos; jobs de conciliação periódicos o verificam.

### Tempo real e geolocalização { #real-time-geo_1 }

#### 35. Transporte por aplicativo (Uber / 99) { #ride-sharing }

Projete um serviço de transporte por aplicativo: passageiros pedem uma corrida e são pareados com um motorista próximo em segundos; os dois veem a localização um do outro ao vivo. 1 milhão de motoristas ativos enviando a localização a cada 4 segundos, 100.000 pedidos de corrida por minuto no pico, em centenas de cidades.

**Esclareça primeiro.**

- Objetivo do pareamento: motorista mais próximo, menor tempo estimado, ou otimização global?
- Preço dinâmico está no escopo? Pagamentos?
- Por quanto tempo o histórico de localizações é guardado?

**Conceitos-chave.**

- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Transações, isolamento e locks](../../../classes/databases/transactions/index.md)
- [WebSockets, SSE e gRPC](../../../classes/edge/protocols/index.md)
- Catálogo: [Mobile](../../../reference/components/client/index.md#mobile) · [Load Balancer](../../../reference/components/edge/index.md#lb) · [Cache](../../../reference/components/storage/index.md#cache) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Cuidado com.** Gravar 250.000 atualizações de localização por segundo num banco relacional com índice geográfico é o gargalo; mantenha as localizações atuais em memória (índice geográfico por cidade/célula) e envie o histórico por stream. E um motorista nunca pode ser atribuído a dois passageiros.

**Pratique.** Estudo de caso: [Transporte por aplicativo](../../../classes/case-studies/ride-sharing/index.md) · Cenário do playground: [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) (índice geográfico e atualizações de localização)

??? tip "Dicas"

    - 1 M de motoristas ÷ 4 s = 250.000 atualizações/s: índice geográfico em memória (células geohash/H3), particionado por cidade.
    - Pareamento: consulte as células em volta do passageiro, ordene pelo tempo estimado, ofereça a um motorista por vez com timeout.
    - Atribuição com update condicional ou lock no estado do motorista (available → assigned).
    - Localização ao vivo por WebSockets; histórico para o Kafka → armazenamento para viagens, cobrança e analytics.

#### 36. Entrega de comida { #food-delivery }

Projete uma plataforma de entrega de comida (como o iFood): clientes navegam por restaurantes próximos, fazem pedidos e acompanham o entregador ao vivo. 300.000 restaurantes, 2 milhões de pedidos por dia com pico forte no almoço e no jantar (5× a média), restaurantes aceitando pedidos em tablets e entregadores atribuídos aos pedidos quando ficam prontos.

**Esclareça primeiro.**

- Os cardápios e preços são geridos pelos restaurantes em tempo real?
- Agrupamos vários pedidos por entregador?
- O que precisa funcionar se o tablet do restaurante estiver offline?

**Conceitos-chave.**

- [Outbox, sagas, CQRS e event sourcing](../../../classes/messaging/patterns/index.md)
- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [WebSockets, SSE e gRPC](../../../classes/edge/protocols/index.md)
- [Serverless e autoscaling](../../../classes/compute/serverless-autoscaling/index.md)
- Catálogo: [Mobile](../../../reference/components/client/index.md#mobile) · [Search](../../../reference/components/compute/index.md#search) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Notifications](../../../reference/components/compute/index.md#notifications)

**Cuidado com.** Um pedido é um workflow longo com vários atores (cliente, restaurante, entregador, pagamento); modelá-lo como uma cadeia síncrona de requisições falha no primeiro participante lento. Use uma máquina de estados movida por eventos.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Transporte por aplicativo](../../../classes/case-studies/ride-sharing/index.md) · Cenário do playground: [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) (índice geográfico e atualizações de localização)

??? tip "Dicas"

    - 2 M/dia ≈ 23 pedidos/s em média, ~120/s no pico: a taxa de pedidos é modesta; atualizações de localização e navegação dominam.
    - Máquina de estados do pedido (placed → accepted → ready → picked up → delivered) persistida, com eventos para todas as partes.
    - Busca de restaurantes por célula geográfica, em cache por área e horário de refeição.
    - O despacho de entregadores reaproveita o índice geográfico do transporte por aplicativo; notificações push para restaurantes e entregadores.

#### 37. Backend de jogo multijogador { #multiplayer-game }

Projete o backend de um jogo multijogador online: o matchmaking coloca 10 jogadores de habilidade parecida numa partida em até 30 segundos; as partidas duram 20 minutos com o estado do jogo atualizado 30 vezes por segundo; 2 milhões de jogadores simultâneos no pico, em 4 regiões.

**Esclareça primeiro.**

- Servidor autoritativo ou peer-to-peer?
- Meta de latência por jogador (por exemplo, menos de 80 ms ida e volta)?
- O que é persistido: resultados das partidas, inventário, rankings?

**Conceitos-chave.**

- [WebSockets, SSE e gRPC](../../../classes/edge/protocols/index.md)
- [Serviços sem estado e fronteiras de serviço](../../../classes/compute/services/index.md)
- [Kubernetes e autoscaling](../../../classes/cloud-native/kubernetes/index.md)
- [Multi-região e recuperação de desastres](../../../classes/reliability/disaster-recovery/index.md)
- Catálogo: [Load Balancer](../../../reference/components/edge/index.md#lb) · [App Server](../../../reference/components/compute/index.md#app) · [Cache](../../../reference/components/storage/index.md#cache) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Message Queue](../../../reference/components/messaging/index.md#queue)

**Cuidado com.** Estado de jogo a 30 atualizações/s não passa por um banco nem por uma camada web sem estado; ele vive em memória num servidor de jogo dedicado por partida, perto dos jogadores. Só os resultados são persistidos.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Chat](../../../classes/case-studies/chat/index.md) · Cenário do playground: [`chat`](../../../../playground/scenarios/index.md#chat) (websockets e pub/sub)

??? tip "Dicas"

    - 2 M de jogadores ÷ 10 = 200.000 partidas; ~50 partidas por servidor de jogo ≈ 4.000 servidores, com autoscaling por região.
    - Matchmaking: uma fila por região e faixa de habilidade; amplie a faixa conforme a espera cresce.
    - Um alocador atribui um servidor de jogo (por exemplo, Agones no Kubernetes) e devolve o endereço aos jogadores.
    - UDP para o estado; resultados, rankings e inventário gravados no banco por um serviço normal.

### Busca e mídia { #search-media }

#### 38. Streaming de vídeo (YouTube / Netflix) { #video-streaming }

Projete uma plataforma de vídeo: criadores enviam vídeos (500 MB em média), espectadores assistem em qualquer dispositivo com qualidade adaptativa. 500.000 envios por dia, 100 milhões de visualizações por dia e início de reprodução suave em menos de 2 segundos no mundo inteiro.

**Esclareça primeiro.**

- Transmissão ao vivo ou só sob demanda?
- Quantas resoluções e codecs?
- Precisamos de DRM ou vídeos privados?

**Conceitos-chave.**

- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [DNS e CDN](../../../classes/edge/dns-cdn/index.md)
- [Workers, schedulers e eleição de líder](../../../classes/compute/async-work/index.md)
- [Números para estimativas](../../../classes/estimation/numbers/index.md)
- Catálogo: [Object Store](../../../reference/components/storage/index.md#objstore) · [CDN](../../../reference/components/edge/index.md#cdn) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [NoSQL DB](../../../reference/components/storage/index.md#nosql)

**Cuidado com.** A banda, e não as requisições por segundo, domina: servir vídeo dos próprios servidores é impossível nessa escala; a CDN serve os segmentos. A transcodificação é trabalho em lote lento e paralelizável, nunca dentro da requisição de envio.

**Pratique.** Estudo de caso: [Streaming de vídeo](../../../classes/case-studies/video-streaming/index.md) · Cenário do playground: [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming) (object store, CDN e transcodificação)

??? tip "Dicas"

    - Envio: upload retomável e pré-assinado para o object store; um evento dispara o pipeline.
    - Divida em pedaços, transcodifique em paralelo numa escada de bitrates, empacote em segmentos HLS/DASH.
    - Estimativa de saída: 100 M de visualizações × ~300 MB assistidos ≈ 30 PB/dia: a CDN serve quase tudo.
    - Metadados e contagens de visualização em armazenamentos separados; vídeos populares pré-aquecidos na CDN.

#### 39. Sincronização de arquivos (Dropbox / Google Drive) { #file-sync }

Projete um serviço de armazenamento e sincronização de arquivos: usuários mantêm pastas sincronizadas entre notebook, celular e web; arquivos de até 10 GB; 50 milhões de usuários com 10 GB cada em média. Edições num dispositivo devem aparecer nos outros em segundos, e edições offline precisam ser mescladas ou marcadas como conflito.

**Esclareça primeiro.**

- Compartilhamento e permissões estão no escopo?
- Histórico de versões: quantas versões, por quanto tempo?
- Deduplicação entre usuários é aceitável (privacidade)?

**Conceitos-chave.**

- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [Modelos de consistência](../../../classes/distributed/consistency/index.md)
- [Tempo e relógios](../../../classes/distributed/time-clocks/index.md)
- [Filas vs pub/sub vs logs de eventos](../../../classes/messaging/queues-pubsub/index.md)
- Catálogo: [Object Store](../../../reference/components/storage/index.md#objstore) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [CDN](../../../reference/components/edge/index.md#cdn) · [App Server](../../../reference/components/compute/index.md#app)

**Cuidado com.** Reenviar um arquivo inteiro de 2 GB por uma mudança de uma linha desperdiça banda; divida os arquivos em blocos endereçados pelo conteúdo e envie só os blocos alterados. Os metadados (a árvore de arquivos) precisam de consistência forte; os blocos são imutáveis.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Streaming de vídeo](../../../classes/case-studies/video-streaming/index.md) · Cenário do playground: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN absorvendo tráfego estático e de mídia)

??? tip "Dicas"

    - Armazenamento: 50 M × 10 GB = 500 PB antes da deduplicação: object storage com camadas.
    - Arquivo = lista de hashes de blocos (por exemplo, blocos de 4 MB); envie só os blocos que o servidor não tem.
    - O serviço de metadados (relacional, com um diário por usuário e um cursor) é a fonte da verdade.
    - Os clientes fazem long polling ou se inscrevem para mudanças e então leem o diário a partir do seu cursor; conflitos viram arquivos de "cópia em conflito".

#### 40. Busca de posts (estilo Twitter) { #tweet-search }

Projete a busca de texto completo nos posts de uma rede social: 500 milhões de posts novos por dia precisam ficar pesquisáveis em até 10 segundos após a publicação; 20.000 buscas por segundo; resultados ranqueados por relevância e recência. O arquivo guarda 5 anos de posts.

**Esclareça primeiro.**

- Recência importa mais que relevância (busca em tempo real)?
- Filtros: usuário, idioma, intervalo de datas, mídia?
- Posts apagados precisam sumir dos resultados imediatamente?

**Conceitos-chave.**

- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Partições, consumer groups e retenção do Kafka](../../../classes/messaging/kafka/index.md)
- [Percentis e latência de cauda](../../../classes/estimation/percentiles/index.md)
- Catálogo: [Search](../../../reference/components/compute/index.md#search) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [Cache](../../../reference/components/storage/index.md#cache) · [Object Store](../../../reference/components/storage/index.md#objstore)

**Cuidado com.** Consultar todos os shards de um índice enorme a cada busca faz da latência de cauda do shard mais lento a latência de toda consulta; particione por tempo (índice recente pequeno e quente, arquivo frio) e use réplicas para requisições de cobertura.

**Pratique.** Estudo de caso: [Autocompletar de busca](../../../classes/case-studies/search-autocomplete/index.md) · Cenário do playground: [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) (serviço de busca e cache)

??? tip "Dicas"

    - Ingestão: posts → Kafka → indexadores construindo um índice invertido; ≈ 6.000 posts/s para indexar.
    - Índices particionados por tempo: um índice em memória, em tempo real, para os últimos dias, e índices maiores em disco para períodos antigos.
    - Scatter-gather entre os shards com top-K por shard e uma mescla; a amplificação de cauda do fan-out é o risco de latência.
    - Exclusões como tombstones filtrados na consulta; cacheie as consultas populares por alguns segundos.

### Sistemas de IA { #ai-systems }

#### 41. Assistente de suporte com IA do BoxOffice { #ai-assistant }

Projete o assistente de IA do BoxOffice: os fãs fazem perguntas em linguagem natural ("posso pedir reembolso para sábado?", "troque meus ingressos para domingo"); ele responde a partir das políticas e dos dados dos eventos e pode agir sobre os pedidos do próprio fã. 5.000 conversas por minuto no pico antes de grandes shows; as respostas devem começar a aparecer em até 2 segundos, custar menos de alguns centavos por conversa, e o assistente nunca pode agir sobre o pedido de outra pessoa.

**Esclareça primeiro.**

- Quais ações são permitidas (só leitura, reembolsos, trocas)? Com confirmação?
- Transferência para um atendente humano?
- Quais idiomas, e que dados podem ser enviados a um provedor de modelos?

**Conceitos-chave.**

- [LLM gateway: roteamento, fallbacks, cache](../../../classes/ai-systems/llm-gateway/index.md)
- [Agentes e uso de ferramentas](../../../classes/ai-systems/agents/index.md)
- [RAG e memória](../../../classes/ai-systems/rag-memory/index.md)
- [Guardrails e avaliações](../../../classes/ai-systems/safety-evals/index.md)
- Catálogo: [LLM Gateway](../../../reference/components/ai/index.md#llmgw) · [Orchestrator](../../../reference/components/ai/index.md#orchestrator) · [Tool Registry](../../../reference/components/ai/index.md#toolreg) · [Memory Fabric](../../../reference/components/ai/index.md#memory) · [Safety Mesh](../../../reference/components/ai/index.md#safety) · [Vector DB](../../../reference/components/storage/index.md#vectordb)

**Cuidado com.** Deixar o modelo decidir o que o usuário pode fazer é o erro clássico: a autorização mora nas ferramentas, com a identidade do usuário. E cada passo do agente é uma chamada completa ao modelo: latência e custo se multiplicam pelo número de passos.

**Pratique.** Estudo de caso: [Assistente de IA](../../../classes/case-studies/ai-assistant/index.md) · Cenário do playground: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) (LLM gateway, agente, ferramentas, RAG, segurança)

??? tip "Dicas"

    - Roteador: perguntas tipo FAQ respondidas por RAG (uma chamada ao modelo); só pedidos de ação vão para o loop do agente.
    - RAG sobre políticas e páginas de eventos num banco vetorial, filtrado por evento e idioma, com citações.
    - Ferramentas (`get_my_orders`, `request_refund`) atrás de servidores MCP que impõem a identidade e os limites do fã; confirmação antes de efeitos colaterais.
    - LLM gateway para roteamento, fallbacks, cache semântico e custo por conversa; guardrails na entrada e na saída; traces por passo.

#### 42. Chatbot de documentação com RAG { #rag-chatbot }

Projete um chatbot que responde às perguntas dos funcionários a partir da documentação interna de uma empresa: 2 milhões de documentos (wikis, PDFs, tickets) que mudam diariamente, 10.000 funcionários, 50 perguntas por segundo no pico. As respostas precisam citar as fontes, e um funcionário nunca pode ver conteúdo de documentos que não tem permissão para ler.

**Esclareça primeiro.**

- Quão atualizado o índice precisa estar depois que um documento muda?
- De onde vêm as permissões, e com que frequência mudam?
- Um modelo hospedado é aceitável para esses dados, ou precisa ser auto-hospedado?

**Conceitos-chave.**

- [RAG e memória](../../../classes/ai-systems/rag-memory/index.md)
- [LLM gateway: roteamento, fallbacks, cache](../../../classes/ai-systems/llm-gateway/index.md)
- [Guardrails e avaliações](../../../classes/ai-systems/safety-evals/index.md)
- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- Catálogo: [Memory Fabric](../../../reference/components/ai/index.md#memory) · [Vector DB](../../../reference/components/storage/index.md#vectordb) · [LLM Gateway](../../../reference/components/ai/index.md#llmgw) · [Safety Mesh](../../../reference/components/ai/index.md#safety) · [Worker](../../../reference/components/compute/index.md#worker)

**Cuidado com.** Indexar todos os trechos numa coleção compartilhada e filtrar as permissões depois da recuperação vaza dados (e devolve respostas vazias); aplique o filtro de permissões dentro da consulta vetorial. A qualidade da recuperação precisa ser avaliada separadamente.

**Pratique.** Estudo de caso: [Assistente de IA](../../../classes/case-studies/ai-assistant/index.md) · Cenário do playground: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) (LLM gateway, agente, ferramentas, RAG, segurança)

??? tip "Dicas"

    - Pipeline de ingestão: eventos de mudança → parse → chunking → embedding → upsert com metadados de ACL; recalcule os embeddings na mudança.
    - Recuperação híbrida (palavra-chave + vetor), filtro de permissões, reordenação, os 5 melhores trechos no prompt com citações.
    - Armazenamento: por exemplo, 20 M de trechos × 1.536 dimensões × 4 B ≈ 120 GB de vetores antes do overhead do índice.
    - Conjunto de avaliação com perguntas reais; meça o recall da recuperação e a fidelidade das respostas no CI.

#### 43. Busca semântica de eventos { #semantic-search }

O BoxOffice quer busca por significado: "noite de jazz tranquila em São Paulo no próximo fim de semana" deve encontrar eventos relevantes mesmo quando nenhuma palavra-chave coincide. 50.000 eventos ativos, 2.000 consultas por segundo no pico, resultados em até 200 ms, combinando significado com filtros rígidos (cidade, data, preço, disponibilidade).

**Esclareça primeiro.**

- Que campos descrevem um evento (título, descrição, artista, gênero)?
- Extraímos datas e lugares da consulta, ou dependemos de filtros?
- Ranqueamento personalizado?

**Conceitos-chave.**

- [Motores de busca, object storage, warehouses e vetores](../../../classes/databases/specialized/index.md)
- [RAG e memória](../../../classes/ai-systems/rag-memory/index.md)
- [Padrões de cache e a matemática da taxa de acerto](../../../classes/caching/patterns/index.md)
- [LLM gateway: roteamento, fallbacks, cache](../../../classes/ai-systems/llm-gateway/index.md)
- Catálogo: [Search](../../../reference/components/compute/index.md#search) · [Vector DB](../../../reference/components/storage/index.md#vectordb) · [Cache](../../../reference/components/storage/index.md#cache) · [LLM Gateway](../../../reference/components/ai/index.md#llmgw)

**Cuidado com.** Busca vetorial pura ignora restrições rígidas (devolve feliz uma noite de jazz em outra cidade) e é fraca em nomes exatos; combine-a com busca por palavra-chave e filtros estruturados. Gerar o embedding de cada consulta com um modelo grande hospedado pode estourar o orçamento de latência.

**Pratique.** Estudo de caso: [Autocompletar de busca](../../../classes/case-studies/search-autocomplete/index.md) · Cenário do playground: [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) (serviço de busca e cache)

??? tip "Dicas"

    - 50.000 eventos × 768 dimensões × 4 B ≈ 150 MB: o índice inteiro cabe na memória de cada nó de busca.
    - Híbrido: BM25 + similaridade vetorial com filtros (cidade, intervalo de datas) aplicados na consulta; combine as pontuações.
    - Um modelo de embedding pequeno e rápido para as consultas; cacheie os embeddings das consultas frequentes.
    - Um passo opcional com LLM para extrair filtros estruturados da consulta, com esquema rígido e plano B.

---

## Avançado { #advanced }

Internals de sistemas distribuídos e plataformas: consenso, replicação, ordenação, multi-região, plataformas de IA. Profundidade de nível sênior; ótimo treino depois do curso.

### Fundamentos distribuídos { #distributed-foundations }

#### 44. Armazenamento chave-valor distribuído { #key-value-store }

Projete um armazenamento chave-valor distribuído (como o Dynamo ou o Cassandra): `put(chave, valor)` e `get(chave)`, 100 TB de dados, 1 milhão de operações por segundo, sempre gravável mesmo durante partições de rede, com consistência ajustável por requisição. Nós são acrescentados e falham rotineiramente.

**Esclareça primeiro.**

- Tamanho dos valores? Proporção leitura/escrita?
- Qual consistência deve ser o padrão: eventual ou read-your-writes?
- Replicação entre vários data centers?

**Conceitos-chave.**

- [Particionamento e chaves quentes](../../../classes/databases/partitioning/index.md)
- [Consenso e quóruns](../../../classes/distributed/consensus/index.md)
- [CAP e PACELC](../../../classes/distributed/cap-pacelc/index.md)
- [Tempo e relógios](../../../classes/distributed/time-clocks/index.md)
- [Modelos de dados, SQL vs NoSQL e índices](../../../classes/databases/models/index.md)
- Catálogo: [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Load Balancer](../../../reference/components/edge/index.md#lb)

**Cuidado com.** "Sempre gravável" significa escritas concorrentes na mesma chave dos dois lados de uma partição: você precisa dizer como os conflitos são detectados e resolvidos (last-write-wins perde dados; vetores de versão guardam as versões irmãs).

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Cache distribuído](../../../classes/case-studies/distributed-cache/index.md) · Cenário do playground: [`sharding`](../../../../playground/scenarios/index.md#sharding) (partições e chaves quentes)

??? tip "Dicas"

    - Hashing consistente com nós virtuais; N = 3 réplicas nos próximos nós distintos do anel.
    - Quóruns ajustáveis: W e R por requisição; R + W > N para read-your-writes, W = 1 para disponibilidade.
    - Gossip para associação e detecção de falhas; hinted handoff para falhas temporárias; anti-entropia com árvores de Merkle.
    - Motor de armazenamento LSM-tree em cada nó (bom para muitas escritas).

#### 45. Serviço de lock distribuído { #distributed-lock }

Projete um serviço de locks e eleição de líder (como Chubby, ZooKeeper ou etcd) para os jobs internos do BoxOffice: clientes adquirem locks nomeados com leases, alguns milhares de operações de lock por segundo, e o serviço precisa continuar correto (nunca dois donos) mesmo quando nós caem ou a rede se particiona.

**Esclareça primeiro.**

- O lock é para eficiência (evitar trabalho duplicado) ou para correção (proteger dados)?
- Duração do lease? O que acontece se um dono pausar (GC) além do lease?
- São necessárias leituras fortemente consistentes do estado do lock?

**Conceitos-chave.**

- [Consenso e quóruns](../../../classes/distributed/consensus/index.md)
- [Tempo e relógios](../../../classes/distributed/time-clocks/index.md)
- [Workers, schedulers e eleição de líder](../../../classes/compute/async-work/index.md)
- [CAP e PACELC](../../../classes/distributed/cap-pacelc/index.md)
- Catálogo: [Scheduler](../../../reference/components/compute/index.md#scheduler) · [Worker](../../../reference/components/compute/index.md#worker) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Cuidado com.** Um lock com timeout não basta para a correção: um cliente pausado pelo GC pode acordar depois que o lease expirou e ainda gravar. O recurso protegido precisa verificar um fencing token (um número que cresce a cada concessão).

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Cache distribuído](../../../classes/case-studies/distributed-cache/index.md) · Cenário do playground: [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas) (primário e réplicas de leitura)

??? tip "Dicas"

    - Uma máquina de estados replicada com 3 ou 5 nós usando Raft; escritas precisam de maioria, então é CP.
    - Locks como chaves com leases renovados por heartbeats; os clientes observam as chaves para saber das liberações.
    - Cada concessão devolve um fencing token monotonicamente crescente; o armazenamento rejeita tokens antigos.
    - Mantenha pequeno: só coordenação, nunca um armazenamento de dados geral; os clientes cacheiam e fazem backoff.

#### 46. Edição colaborativa de documentos { #collaborative-editing }

Projete edição colaborativa em tempo real (como o Google Docs): até 100 pessoas editam o mesmo documento ao mesmo tempo, cada tecla aparece para os outros em até 200 ms, edições feitas offline são mescladas quando o usuário reconecta e o histórico completo é guardado. 10 milhões de documentos, 1 milhão abertos simultaneamente.

**Esclareça primeiro.**

- Texto rico ou texto puro? Comentários e sugestões?
- Todos os usuários precisam convergir exatamente para o mesmo documento?
- Por quanto tempo a edição offline é suportada?

**Conceitos-chave.**

- [Modelos de consistência](../../../classes/distributed/consistency/index.md)
- [Tempo e relógios](../../../classes/distributed/time-clocks/index.md)
- [WebSockets, SSE e gRPC](../../../classes/edge/protocols/index.md)
- [Outbox, sagas, CQRS e event sourcing](../../../classes/messaging/patterns/index.md)
- Catálogo: [Load Balancer](../../../reference/components/edge/index.md#lb) · [App Server](../../../reference/components/compute/index.md#app) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Object Store](../../../reference/components/storage/index.md#objstore)

**Cuidado com.** Last-write-wins no documento inteiro perde as edições de todos os outros; travar parágrafos mata a sensação de tempo real. Edições concorrentes exigem operational transformation (OT) ou CRDTs, que garantem a convergência.

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Chat](../../../classes/case-studies/chat/index.md) · Cenário do playground: [`chat`](../../../../playground/scenarios/index.md#chat) (websockets e pub/sub)

??? tip "Dicas"

    - Todos os editores de um documento se conectam (WebSocket) ao mesmo servidor de sessão, escolhido por hashing consistente sobre o id do documento.
    - OT com um sequenciador central por documento, ou CRDTs (que também tornam natural a mescla offline).
    - Persista o log de operações (event sourcing) mais snapshots periódicos; histórico = replay.
    - Presença e cursores como mensagens efêmeras de pub/sub, nunca persistidas.

#### 47. Motor de casamento de ordens de uma bolsa { #matching-engine }

Projete o núcleo de uma bolsa: operadores enviam ordens de compra e venda para 5.000 ativos; o motor as casa por prioridade de preço e tempo e publica negócios e atualizações do livro de ofertas. 1 milhão de ordens por segundo no pico, latência de casamento em microssegundos, justiça estrita (mesma ordem de entrada ⇒ mesmo resultado) e nenhuma ordem perdida após a confirmação.

**Esclareça primeiro.**

- Tipos de ordem (limitada, a mercado, cancelamento)?
- Meta de latência para a confirmação vs para os dados de mercado?
- Objetivo de tempo de recuperação se o motor primário falhar?

**Conceitos-chave.**

- [Outbox, sagas, CQRS e event sourcing](../../../classes/messaging/patterns/index.md)
- [Consenso e quóruns](../../../classes/distributed/consensus/index.md)
- [Partições, consumer groups e retenção do Kafka](../../../classes/messaging/kafka/index.md)
- [Percentis e latência de cauda](../../../classes/estimation/percentiles/index.md)
- Catálogo: [App Server](../../../reference/components/compute/index.md#app) · [Event Stream](../../../reference/components/messaging/index.md#stream) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Cuidado com.** Uma transação de banco por ordem não chega a microssegundos. O design padrão é um motor de thread única, em memória, por ativo, alimentado por um log de entrada sequenciado e durável: o determinismo dá justiça e recuperação (refazer o log).

**Pratique.** Estudo de caso: ainda sem estudo de caso — compare com [Sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) · Cenário do playground: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) (stream de eventos com vários consumidores)

??? tip "Dicas"

    - O gateway valida e verifica o risco das ordens; depois um sequenciador atribui um número de sequência global por ativo.
    - O log de entrada é replicado antes da confirmação; os motores o consomem e mantêm os livros de ofertas em memória.
    - Distribua os ativos entre motores; um ativo quente ganha um motor próprio.
    - Eventos de saída (negócios, atualizações do livro) num stream para dados de mercado, liquidação e armazenamento; um standby quente refaz o mesmo log.

#### 48. BoxOffice multi-região { #multi-region-boxoffice }

O BoxOffice se expande para a Europa e a América do Norte e promete 99,99% de disponibilidade para compras de ingressos, sobrevivendo à perda de uma região inteira da nuvem. Os fãs devem ser atendidos por uma região próxima, mas um assento ainda nunca pode ser vendido duas vezes entre regiões. Projete a arquitetura multi-região.

**Esclareça primeiro.**

- Os eventos têm uma região de origem (o país do local)?
- Metas de RPO e RTO para os pedidos?
- Regras de residência de dados (dados pessoais precisam ficar numa região)?

**Conceitos-chave.**

- [Multi-região e recuperação de desastres](../../../classes/reliability/disaster-recovery/index.md)
- [CAP e PACELC](../../../classes/distributed/cap-pacelc/index.md)
- [Matemática da disponibilidade](../../../classes/estimation/availability-math/index.md)
- [Replicação e atraso de replicação](../../../classes/databases/replication/index.md)
- [DNS e CDN](../../../classes/edge/dns-cdn/index.md)
- Catálogo: [DNS](../../../reference/components/edge/index.md#dns) · [CDN](../../../reference/components/edge/index.md#cdn) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Health Check](../../../reference/components/observability/index.md#healthcheck)

**Cuidado com.** Escritas ativo-ativo nos mesmos assentos em duas regiões exigem consenso entre regiões (acrescenta ~100 ms por escrita) ou um único dono por evento. E 99,99% são ~53 minutos por ano: o failover precisa ser automático e ensaiado.

**Pratique.** Estudo de caso: [Ingressos (venda relâmpago do BoxOffice)](../../../classes/case-studies/ticketing/index.md) · Cenário do playground: [`multi-region`](../../../../playground/scenarios/index.md#multi-region) (failover por DNS entre regiões)

??? tip "Dicas"

    - Região de origem por evento para inventário e pedidos (um único escritor); as outras regiões encaminham as compras para ela.
    - Caminhos de leitura (catálogo, busca, páginas) ativo-ativo em todas as regiões, com replicação assíncrona.
    - Réplica standby de cada região de origem em outro lugar; promova na falha da região (RPO de segundos), failover por DNS/anycast.
    - Ou um banco globalmente consistente (estilo Spanner), aceitando escritas mais lentas; game days para provar o RTO.

### Sistemas de IA { #ai-systems_1 }

#### 49. Plataforma de agentes com ferramentas { #agent-platform }

Projete uma plataforma interna em que os times do BoxOffice constroem agentes de IA (suporte, cadastro de produtores, revisão de fraudes). Os agentes chamam ferramentas expostas por 30 serviços, executam tarefas que levam de segundos a horas e precisam ser observáveis, ter orçamento e ser seguros. 200 agentes, 1 milhão de chamadas de ferramentas por dia.

**Esclareça primeiro.**

- Quem cria os agentes: engenheiros em código, ou configuração por não engenheiros?
- Quais ferramentas têm efeitos colaterais, e quem aprova o uso delas?
- Tarefas longas precisam de etapas de aprovação humana?

**Conceitos-chave.**

- [Agentes e uso de ferramentas](../../../classes/ai-systems/agents/index.md)
- [LLM gateway: roteamento, fallbacks, cache](../../../classes/ai-systems/llm-gateway/index.md)
- [Guardrails e avaliações](../../../classes/ai-systems/safety-evals/index.md)
- [OAuth 2 / OIDC e JWT](../../../classes/edge/identity/index.md)
- [OpenTelemetry](../../../classes/observability/opentelemetry/index.md)
- Catálogo: [Orchestrator](../../../reference/components/ai/index.md#orchestrator) · [Tool Registry](../../../reference/components/ai/index.md#toolreg) · [LLM Gateway](../../../reference/components/ai/index.md#llmgw) · [Safety Mesh](../../../reference/components/ai/index.md#safety) · [Memory Fabric](../../../reference/components/ai/index.md#memory) · [Tracing](../../../reference/components/observability/index.md#tracing)

**Cuidado com.** Agentes rodando por horas dentro de um handler de requisição perdem o progresso em qualquer queda e repetem efeitos colaterais; tarefas longas exigem execução durável (estado com checkpoints) e chamadas de ferramentas idempotentes. As ferramentas devem agir com a identidade do usuário final ou a identidade própria e restrita do agente, nunca uma chave de administrador compartilhada.

**Pratique.** Estudo de caso: [Assistente de IA](../../../classes/case-studies/ai-assistant/index.md) · Cenário do playground: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) (LLM gateway, agente, ferramentas, RAG, segurança)

??? tip "Dicas"

    - Registro de ferramentas (servidores MCP por serviço) com esquemas, donos, escopos e um fluxo de aprovação por ferramenta.
    - Orquestrador durável (motor de workflows) com checkpoint de cada passo; etapas com humano no circuito como esperas.
    - Todas as chamadas a modelos pelo LLM gateway, com orçamento por agente; guardrails antes e depois do modelo e antes de efeitos colaterais.
    - Um trace por execução de agente (chamadas ao modelo, chamadas de ferramentas, tokens, custo); conjuntos de avaliação por agente no CI.

#### 50. Gateway de serviço de modelos { #llm-serving-gateway }

Projete o gateway pelo qual todos os serviços do BoxOffice chamam modelos de linguagem: três provedores hospedados mais modelos abertos auto-hospedados num pool de GPUs. 300 requisições por segundo no pico, prompts curtos e longos misturados; metas: p95 do tempo até o primeiro token abaixo de 1 s, um orçamento mensal de custo por time e nenhuma queda quando um provedor falhar.

**Esclareça primeiro.**

- Quais dados podem sair da empresa (provedores hospedados vs auto-hospedados)?
- Prompts e respostas são registrados? Retenção?
- Streaming é obrigatório para todos os clientes?

**Conceitos-chave.**

- [LLM gateway: roteamento, fallbacks, cache](../../../classes/ai-systems/llm-gateway/index.md)
- [Lei de Little e filas](../../../classes/estimation/queueing/index.md)
- [Timeouts, retries, circuit breakers e descarte de carga](../../../classes/reliability/patterns/index.md)
- [Estimativa de custo (FinOps)](../../../classes/cloud-native/finops/index.md)
- [Planejamento de capacidade](../../../classes/performance/capacity-planning/index.md)
- Catálogo: [LLM Gateway](../../../reference/components/ai/index.md#llmgw) · [API Gateway](../../../reference/components/edge/index.md#apigw) · [Cache](../../../reference/components/storage/index.md#cache) · [Metrics](../../../reference/components/observability/index.md#metrics) · [3rd Party API](../../../reference/components/external/index.md#thirdparty)

**Cuidado com.** A capacidade se mede em tokens, não em requisições: um prompt longo pode custar tanto quanto cem curtos. Rate limits e orçamentos por time precisam contar tokens, e o pool de GPUs auto-hospedado satura pelo número de tokens sendo gerados ao mesmo tempo, não por requisições por segundo.

**Pratique.** Estudo de caso: [Assistente de IA](../../../classes/case-studies/ai-assistant/index.md) · Cenário do playground: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) (LLM gateway, agente, ferramentas, RAG, segurança)

??? tip "Dicas"

    - API compatível com a da OpenAI na frente; política de roteamento por requisição (classe de modelo, sensibilidade dos dados, custo).
    - Cadeia de fallback entre provedores com circuit breakers por provedor e rate limiting ciente de tokens.
    - Caches exatos e semânticos para prompts repetidos; prompt caching onde os provedores oferecem.
    - Orçamentos e métricas de tokens por time; pool de GPUs com autoscaling pelo tamanho da fila e por tokens/s (Lei de Little em tokens).

---

## Para onde ir depois { #next }

- Pratique com um colega usando o [protocolo de entrevista simulada](../mock/index.md) e sua rubrica.
- Revise a [referência rápida](../quick-reference/index.md) na véspera.
- Leia os [estudos de caso](../../../classes/case-studies/index.md) completos: cada um segue o mesmo framework, com estimativas, diagramas, aprofundamentos e as perguntas de acompanhamento que os entrevistadores fazem.
- Consulte qualquer componente no [catálogo de componentes](../../../reference/components/index.md).
