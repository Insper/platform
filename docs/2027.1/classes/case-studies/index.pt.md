
São 10:00 e o BoxOffice abre a venda de um show de estádio: dois milhões de fãs, sessenta mil lugares. Ao longo do semestre você construiu todas as peças necessárias para sobreviver àquela manhã — uma CDN e um WAF na borda, serviços sem estado atrás de um balanceador de carga, um cache, um banco que nunca vende um lugar duas vezes, uma fila, uma integração de pagamento, observabilidade, um teste de carga que encontrou o joelho da curva. Esta aula junta as peças **do jeito que um entrevistador pede**: um enunciado de uma frase, uma lousa em branco e 45 minutos.

Os doze estudos de caso abaixo são os problemas clássicos das entrevistas de system design. Não são doze sistemas sem relação: são **as mesmas poucas ideias** — guardar em cache as leituras quentes, tirar o trabalho lento do caminho crítico, escolher uma chave de partição, tornar as retentativas seguras, proteger o único recurso que não escala — combinadas em proporções diferentes. Estudá-los é como o vocabulário da disciplina vira reflexo.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula você deve ser capaz de:

    - **Aplicar** o roteiro de entrevista da aula 1 a um problema inédito em 45 minutos: esclarecer, estimar, API e modelo de dados, design de alto nível, aprofundamentos, gargalos e fechamento.
    - **Estimar** a carga de um sistema a partir de poucas premissas e **derivar** decisões de design dos números.
    - **Compor** componentes da paleta (borda, computação, armazenamento, mensageria, observabilidade, IA) num design e **justificar** cada um.
    - **Analisar** um design em busca de gargalos e modos de falha e **defender** seus trade-offs em voz alta.
    - **Validar** um design sob carga no System Design Playground e **explicar** o que as métricas mostram.
    - **Avaliar** a própria resposta com uma rubrica júnior / pleno / sênior.

## Roteiro

1. **Esta visão geral** — como estudar um caso, como usar o playground, os casos num relance e os padrões que se repetem.
2. [Encurtador de URLs](url-shortener/index.md) — geração de IDs, base62, cache de links quentes, analytics fora do caminho crítico.
3. [Rate limiter](rate-limiter/index.md) — token bucket e janelas deslizantes, contadores atômicos, fail-open vs. fail-closed.
4. [Cache distribuído](distributed-cache/index.md) — hash consistente, despejo, replicação, chaves quentes.
5. [Autocompletar de busca](search-autocomplete/index.md) — trie com top-k, agregação offline, servir da memória.
6. [Sistema de notificações](notification-system/index.md) — canais, filas, retentativas, deduplicação, provedores.
7. [News feed](news-feed/index.md) — fan-out na escrita vs. na leitura, celebridades, cache de timelines, ranqueamento.
8. [Chat](chat/index.md) — WebSockets, roteamento entre gateways, ordem, entrega offline, presença.
9. [Corridas por aplicativo](ride-sharing/index.md) — ingestão de localizações, índices geoespaciais, matching sem atribuição dupla.
10. [Streaming de vídeo](video-streaming/index.md) — uploads, pipeline de transcodificação, bitrate adaptativo, economia da CDN.
11. [Sistema de pagamentos](payment-system/index.md) — idempotência, razão contábil de partidas dobradas, integração com PSP, conciliação.
12. [Ingressos — a venda relâmpago do BoxOffice](ticketing/index.md) — o caso principal: sala de espera, reservas de lugar, checkout.
13. [Assistente de IA](ai-assistant/index.md) — RAG, LLM gateway, agentes com ferramentas, guardrails e avaliações.
14. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/case-studies.html" title="Slides: estudos de caso" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/case-studies.html){:target="_blank"}

---

## Como estudar um caso

Toda página de caso segue o **roteiro de entrevista** da [aula 1](../intro/interview-framework/index.md), seção por seção, para você ensaiar a ordem até ela ficar automática. O tempo abaixo é para uma entrevista de 45 minutos; as páginas dos casos usam a mesma numeração.

| # | Etapa | Minutos | O que você produz | Erro típico |
|---|---|---:|---|---|
| 1 | **Esclarecer os requisitos** | 5 | Lista funcional, metas não funcionais com números, fora do escopo | Projetar antes de saber se são 1 mil ou 1 M de usuários |
| 2 | **Estimar** | 5 | QPS (médio e de pico), armazenamento, banda, memória — e uma frase sobre o que implicam | Calcular números e nunca usá-los |
| 3 | **API e modelo de dados** | 5–7 | Um punhado de endpoints, as entidades principais, o armazenamento de cada uma e por quê | Vinte endpoints, sem idempotência, sem paginação |
| 4 | **Design de alto nível** | 10 | Um diagrama com o caminho de leitura e o de escrita | Caixas sem fluxo de dados; todo componente "porque sistemas grandes têm" |
| 5 | **Aprofundamentos** | 10–15 | Duas ou três partes difíceis resolvidas com alternativas e uma escolha | Aprofundar a parte fácil |
| 6 | **Gargalos, modos de falha, trade-offs** | 5 | O que quebra primeiro, o que acontece quando X morre, do que você abriu mão | "Escala horizontalmente" sem evidência |
| 7 | **Fechamento** | 2–3 | Resumo, o que faria em seguida, como mediria | Acabar o tempo no meio da frase |

As dez seções de cada página de caso correspondem a essas etapas: requisitos (1), estimativas (2), API e modelo de dados (3), design de alto nível (4), aprofundamentos (5), gargalos e trade-offs (6), e depois três apoios ao estudo — **Experimente no playground**, **Perguntas de follow-up** e uma **rubrica de autoavaliação**.

!!! tip "Um método de estudo que funciona"

    1. **Tente primeiro.** Leia só o enunciado (a citação no topo da página). Ligue um cronômetro de 40 minutos e resolva no papel ou na tela do [playground](../../../playground/index.md), em voz alta, como se houvesse um entrevistador.
    2. **Compare seção por seção.** Abra a página e compare seus requisitos, números, API, diagrama e aprofundamentos. Anote o que você deixou passar, não o que acertou.
    3. **Rode o cenário.** Carregue o cenário correspondente no playground, preveja o que vai quebrar, rode e confira sua previsão (próxima seção).
    4. **Responda os follow-ups** antes de abri-los; são as perguntas que decidem entre níveis.
    5. **Dê sua nota** com a rubrica e **repita uma semana depois** sem olhar. Repetição espaçada vence a releitura.
    6. **Pratique em duplas** com o [roteiro de entrevista simulada](../../support/interview/mock/index.md): um faz o papel de entrevistador, usando os follow-ups como sondagens.

## Como usar o playground com um caso

Cada caso incorpora o [System Design Playground](../../../playground/index.md) já carregado com seu cenário. O playground é um simulador, não um benchmark: seus números são ilustrativos, mas as **formas** (onde a fila cresce, quando o p99 se curva, qual componente satura primeiro) são as que você vai ver em sistemas reais e nos laboratórios.

``` mermaid-sim
flowchart LR
    p["Preveja<br/>o que quebra primeiro?"] --> r["Rode<br/>perfil load / spike"]
    r --> o["Observe<br/>utilização, p99,<br/>erros, backlog, custo"]
    o --> c["Mude uma coisa<br/>réplicas, cache, fila,<br/>timeout, partição"]
    c --> e["Explique<br/>com os números<br/>da seção 2"]
    e --> p
```

- **Preveja antes de rodar.** Escreva qual componente você espera que sature e com que carga. Errar é a parte útil.
- **Mude uma coisa de cada vez.** Acrescente um cache *ou* réplicas *ou* uma fila, nunca os três, para saber qual mudança mexeu na métrica.
- **Use os perfis**: `load` para regime permanente, `spike` para o momento das 10:00 do BoxOffice, `stress` e `breakpoint` para achar o joelho, `chaos` (ou o nível de caos) para derrubar ou deixar lentos componentes e ver os modos de falha.
- **Ligue aos números das estimativas.** Se a página diz que o cache precisa absorver 95% das leituras, olhe a taxa de acerto; se a Lei de Little diz que há 40 chamadas em andamento, olhe a concorrência da dependência.
- **Exporte seu design** (JSON) quando gostar dele: é o formato do [exercício do playground](../../exercises/playground-design/index.md).

## Os casos num relance

Ordem sugerida: dos aquecimentos fáceis ao caso principal. A dificuldade é o nível em que o problema costuma ser pedido; todo caso tem uma versão sênior.

| Caso | Dificuldade | Conceitos-chave | Componentes da paleta | Cenário |
|---|---|---|---|---|
| [Encurtador de URLs](url-shortener/index.md) | :material-star: | base62, geração de IDs vs. hash, 301/302, cache-aside, analytics assíncrono | `lb` `app` `cache` `nosql` `kafka` `analytics` | `url-shortener` |
| [Rate limiter](rate-limiter/index.md) | :material-star::material-star: | token bucket, janela deslizante, atomicidade com Lua, 429, fail-open/closed | `apigw` `lb` `waf` `cache` `metrics` | `rate-limiter` |
| [Cache distribuído](distributed-cache/index.md) | :material-star::material-star: | hash consistente, nós virtuais, despejo (LRU/LFU/W-TinyLFU), replicação, chaves quentes | `cache` `app` `nosql` `metrics` | `read-heavy-cache`, `sharding` |
| [Autocompletar de busca](search-autocomplete/index.md) | :material-star::material-star: | trie + top-k, agregação offline, snapshots imutáveis, fragmentação por prefixo, debouncing | `cdn` `search` `cache` `stream` `dwh` `worker` | `search-autocomplete` |
| [Sistema de notificações](notification-system/index.md) | :material-star::material-star: | fila por canal, retentativas + DLQ, deduplicação, preferências, failover de provedor, campanhas agendadas | `scheduler` `queue` `worker` `notifications` `email` `thirdparty` | `notification-system` |
| [News feed](news-feed/index.md) | :material-star::material-star::material-star: | fan-out na escrita vs. na leitura, celebridades, cache de timelines, hidratação, ranqueamento, cursores | `app` `cache` `nosql` `kafka` `worker` `objstore` `cdn` | `news-feed` |
| [Chat](chat/index.md) | :material-star::material-star::material-star: | gateways WebSocket, registro de sessões, pub/sub, sequência por conversa, confirmações, presença | `lb` `app` `pubsub` `nosql` `cache` `notifications` | `chat` |
| [Corridas por aplicativo](ride-sharing/index.md) | :material-star::material-star::material-star: | localizações com muita escrita, geohash/quadtree/H3, matching com locks, máquina de estados da corrida | `mobile` `apigw` `stream` `cache` `sql` `payment` | `ride-sharing` |
| [Streaming de vídeo](video-streaming/index.md) | :material-star::material-star::material-star: | uploads pré-assinados, DAG de transcodificação, ABR (HLS/DASH), CDN + shield, custo de egress | `cdn` `objstore` `queue` `worker` `sql` `analytics` | `video-streaming` |
| [Sistema de pagamentos](payment-system/index.md) | :material-star::material-star::material-star: | chaves de idempotência, razão de partidas dobradas, webhooks do PSP, conciliação, outbox | `apigw` `app` `sql` `kafka` `scheduler` `payment` `dwh` | `payment-system` |
| [Ingressos (BoxOffice)](ticketing/index.md) | :material-star::material-star::material-star: | sala de espera, admissão pela Lei de Little, reservas com TTL, controle de concorrência, máquina de estados do checkout | `cdn` `waf` `apigw` `queue` `sql` `cache` `kafka` `payment` | `flash-sale` |
| [Assistente de IA](ai-assistant/index.md) | :material-star::material-star::material-star: | RAG, LLM gateway, loop de agente com ferramentas (MCP), guardrails, avaliações, custo em tokens | `llmgw` `orchestrator` `toolreg` `memory` `safety` `vectordb` | `ai-assistant` |

Os ids dos componentes são os da paleta do playground; cada um está descrito no [catálogo de componentes](../../reference/components/index.md).

## Padrões que se repetem

Depois de alguns casos você vai notar que os aprofundamentos saem de uma lista curta. Reconhecer o padrão num problema novo é a maior parte do trabalho.

| Padrão | O problema que resolve | Onde aparece |
|---|---|---|
| **Cache das leituras quentes** (cache-aside, CDN, L1 em processo) | Tráfego de leitura intensa com popularidade concentrada | Encurtador, news feed, autocompletar, vídeo, catálogo de ingressos |
| **Tirar o trabalho lento do caminho crítico** (fila/stream + workers) | Picos e efeitos colaterais lentos (analytics, e-mail, transcodificação) | Cliques do encurtador, notificações, fan-out do feed, vídeo, outbox de pagamentos |
| **Tornar retentativas seguras** (chaves de idempotência, dedupe, escritas condicionais) | Redes e clientes repetem; provedores chamam de volta duas vezes | Pagamentos, ingressos, chat, notificações, pedidos de corrida |
| **Escolher a chave de partição** (por usuário, conversa, cidade, evento, código) | Um nó não aguenta os dados nem o tráfego | Chat (conversa), corridas (cidade), ingressos (evento), cache (anel de chaves) |
| **Proteger o que não escala** (controle de admissão, rate limits, bulkheads) | Uma linha quente, um primário, o limite de um provedor | Sala de espera dos ingressos, rate limiter, pagamentos, cotas do assistente de IA |
| **Pré-computar vs. computar na leitura** | Latência das leituras vs. custo das escritas | Fan-out do feed, top-k do autocompletar, renditions de vídeo |
| **Borda com estado, núcleo sem estado** | Conexões de longa duração | Gateways do chat, conexões dos motoristas, transmissões ao vivo |
| **Consistência forte só onde importa** | Corretude vs. disponibilidade e custo | Lugares, pagamentos e atribuição de motorista fortes; feeds, contadores, posições eventuais |

!!! example "BoxOffice em todo lugar"

    Toda página de caso tem uma conexão com o BoxOffice: links curtos no SMS dos ingressos (encurtador), "5 reservas por minuto" (rate limiter), a aba "Seguindo" quando um artista anuncia uma turnê (news feed), grupos de fãs durante um festival (chat), 60 000 fãs saindo do estádio (corridas), trailers nas páginas de evento (vídeo), "portões abrem em 2 h" (notificações), o adaptador de pagamento (pagamentos), busca enquanto digita por artistas (autocompletar), o assistente de suporte (IA) e, claro, a própria venda relâmpago (ingressos).

!!! warning "Armadilhas comuns em entrevistas de design"

    - **Pular para a solução** ("usamos Kafka e Cassandra") antes dos requisitos e dos números.
    - **Números que não mudam nada.** Toda estimativa deveria terminar numa decisão: "então o conjunto quente cabe em memória", "então precisamos de uma fila".
    - **Ignorar o caminho de escrita** ou o caminho de falha — o entrevistador vai perguntar "o que acontece quando X cai?".
    - **Exagerar na engenharia**: microsserviços, multirregião e cinco bancos para um sistema com 100 requisições por segundo. Dizer "um único PostgreSQL basta aqui, e é neste ponto que ele deixa de bastar" é uma resposta sênior.
    - **Monólogo.** Confirme com o entrevistador ao fim de cada etapa; muitas vezes ele direciona você para o aprofundamento que interessa a ele.

---

## O mapa de conceitos dos estudos de caso { #concept-map }

Os doze casos são combinações dos mesmos padrões. O mapa agrupa os casos pelo **padrão** que compartilham (azul), as aulas que o ensinam e os **componentes da paleta** que o implementam (verde); a matriz abaixo diz quais aulas cada caso testa — ● um aprofundamento é construído sobre ela, ○ ela faz parte do design, — não é central. Cada página de caso termina com seu próprio diagrama *Como se conecta*.

``` mermaid
flowchart LR
    g1["URL shortener · news feed<br/>autocomplete · video"] --> p1["cache the hot reads<br/>(Caching, Edge)"]:::tech
    g2["notifications · video<br/>news feed · payments"] --> p2["slow work off the critical path<br/>(Messaging, Compute)"]:::tech
    g3["payments · ticketing<br/>chat · ride sharing"] --> p3["safe retries, strong consistency<br/>where it matters (Distributed, Databases)"]:::tech
    g4["chat · ride sharing<br/>ticketing · distributed cache"] --> p4["choose the partition key<br/>(Databases)"]:::tech
    g5["ticketing · rate limiter<br/>AI assistant"] --> p5["protect what cannot scale<br/>(Edge, Reliability)"]:::tech
    p1 --> k1["cache · cdn"]:::comp
    p2 --> k2["queue · kafka · worker"]:::comp
    p3 --> k3["sql · payment"]:::comp
    p4 --> k4["nosql · stream · cache"]:::comp
    p5 --> k5["waf · apigw · queue · llmgw"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Caso | [Distribuídos](../distributed/index.md) | [Borda](../edge/index.md) | [Compute](../compute/index.md) | [Bancos de dados](../databases/index.md) | [Caching](../caching/index.md) | [Mensageria](../messaging/index.md) | [Confiabilidade](../reliability/index.md) | Também testa |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| [Encurtador de URLs](url-shortener/index.md) | ○ | ○ | ○ | ● | ● | ○ | — | Estimativas (armazenamento em 5 anos) |
| [Rate limiter](rate-limiter/index.md) | — | ● | — | — | ● | — | ● | Desempenho (teste de carga do limitador) |
| [Cache distribuído](distributed-cache/index.md) | ○ | — | — | ● | ● | — | ○ | Estimativas (memória e ops/s) |
| [Autocompletar de busca](search-autocomplete/index.md) | — | ○ | ● | ● | ● | ○ | — | Estimativas (tráfego de teclas digitadas) |
| [Sistema de notificações](notification-system/index.md) | ○ | — | ● | ○ | — | ● | ● | — |
| [News feed](news-feed/index.md) | ○ | ○ | ○ | ● | ● | ● | ○ | — |
| [Chat](chat/index.md) | ● | ● | ○ | ● | ○ | ● | ○ | — |
| [Corridas por aplicativo](ride-sharing/index.md) | ● | ○ | ○ | ● | ● | ● | ○ | — |
| [Streaming de vídeo](video-streaming/index.md) | — | ● | ● | ● | — | ○ | — | Cloud-native (FinOps: custo de egress) |
| [Sistema de pagamentos](payment-system/index.md) | ● | ○ | ● | ● | — | ● | ● | Rede e Segurança (escopo PCI DSS) |
| [Ingressos (BoxOffice)](ticketing/index.md) | ○ | ● | ○ | ● | ○ | ● | ● | Desempenho (admissão pela Lei de Little, teste de pico) |
| [Assistente de IA](ai-assistant/index.md) | — | ○ | — | ○ | ○ | — | ○ | **Sistemas de IA ●** (gateway, agentes, RAG, segurança) |

---

## Relacionados

[Aula 1 — roteiro de entrevista](../intro/interview-framework/index.md) · [Aula 2 — estimativas](../estimation/index.md) · [Preparação para entrevistas](../../support/interview/index.md) e seus [problemas de prática](../../support/interview/problems/index.md) · [Exercício de design doc](../../exercises/design-doc/index.md) · [Projeto em equipe](../../exercises/project/index.md) · [Playground](../../../playground/index.md).

## Referências

As páginas dos casos citam suas próprias fontes; os livros abaixo cobrem a maioria delas[^1][^2][^3].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020; XU, A.; LAM, S., vol. 2, 2022.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2ª ed. O'Reilly.
[^3]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. O'Reilly, 2016.
