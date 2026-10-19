# Guia de cenários

Cada cenário do [System Design Playground](../index.md) é um pequeno laboratório: uma situação realista, um projeto inicial que **falha** nas metas por um motivo, e uma correção possível. Cada seção abaixo diz o que o cenário ensina, o que tentar, o que observar, as metas e perguntas para discutir em aula. Os simuladores embutidos são compactos (controles de execução, métricas e parâmetros); use **Abrir no playground** (↗) para editar a estrutura.

## Como trabalhar um cenário

1. **Preveja antes de rodar.** Estime a utilização (ρ = λ / μ) e o comportamento das filas com os números do enunciado.
2. **Rode o projeto inicial** e leia o Relatório: que meta falha, e qual é o gargalo?
3. **Mude uma coisa por vez** e rode de novo com a mesma semente — as diferenças vêm da sua mudança, não da sorte.
4. **Troque a semente** no final: um bom projeto passa com qualquer semente.
5. **Explique os números** com as fórmulas do [manual](../index.md#how-the-model-works).

!!! tip "Exercício"

    O exercício avaliado *playground-design* pede que você resolva três cenários e entregue o JSON exportado mais uma justificativa curta (o Relatório tem um botão **Copiar relatório (Markdown)**).

## Todos os cenários

| Cenário | Lição |
|---|---|
| [Monólito: encontre o ponto de ruptura](#monolith) | Todo sistema tem um ponto de ruptura, e o primeiro componente a saturar o define |
| [Escalar horizontalmente atrás de um balanceador](#scale-out) | Escala horizontal precisa de folga para falhas (N+1), e o balanceador só desvia de uma réplica morta depois de detectá-la |
| [Catálogo com muitas leituras: adicione um cache](#read-heavy-cache) | Um cache antes do banco reduz sua carga de leitura para leituras × (1 − taxa de acerto); um cache frio manda tudo de volta ao banco de uma vez (stampede) |
| [Tire o conteúdo estático da origem com uma CDN](#cdn-static) | Conteúdo estático e cacheável fica na borda |
| [Réplicas de leitura e atraso de replicação](#db-replicas) | Réplicas de leitura multiplicam a capacidade de leitura, não a de escrita, e servem dados um pouco antigos (atraso de replicação) |
| [Partições e a chave quente](#sharding) | Particionar escala com o número de partições só enquanto as chaves se espalham; uma chave quente concentra a carga numa partição |
| [Uma fila absorve o pico](#async-queue) | Uma fila desacopla o usuário do trabalho lento |
| [Publique um evento, deixe os consumidores reagirem](#event-fanout) | Com um log de eventos cada grupo de consumidores lê no seu ritmo |
| [Falha em cascata: uma dependência lenta](#cascading-failure) | Uma dependência lenta sem timeouts esgota as threads de quem chama (Lei de Little) e derruba requisições que nem a usam |
| [Tempestade de retries: quando retentar piora](#retry-storm) | Retries imediatos multiplicam a carga de um serviço em apuros; quando as respostas passam do timeout, toda tentativa falha e o sistema continua fora mesmo após o gatilho (falha metaestável) |
| [Rate limiting protege o backend](#rate-limiter) | Rejeitar o excesso rapidamente (429) protege o backend e os usuários reais; deixá-lo enfileirar degrada todo mundo |
| [Sobrevivendo à queda de uma região](#multi-region) | Sobreviver à perda de uma região exige uma segunda pilha completa e um jeito de mover os usuários |
| [Pico serverless: cold starts e limites](#serverless-burst) | Funções escalam por requisição |
| [Venda relâmpago: um lançamento com estoque limitado](#flash-sale) | Uma venda relâmpago é projetada para o pico |
| [Encurtador de URLs (sho.rt/xyz)](#url-shortener) | Uma busca por chave com muitas leituras |
| [Feed de notícias: fan-out na escrita vs na leitura](#news-feed) | Fan-out na escrita move trabalho do caminho de leitura (frequente) para o de escrita (raro) |
| [Chat de um evento ao vivo](#chat) | Chat separa guardar mensagens (particionado, muitas escritas) de entregá-las (pub/sub para os servidores conectados) |
| [Carona: um índice geográfico com muitas escritas](#ride-sharing) | Atualizações de posição são um fluxo de muitas escritas |
| [Streaming de vídeo: CDN + object store + transcodificação](#video-streaming) | Vídeo é bytes na borda mais trabalho pesado em segundo plano |
| [Sistema de notificações](#notification-system) | Notificações são assíncronas por natureza |
| [Pagamentos: retries precisam de idempotência](#payment-system) | Um retry após timeout pode repetir uma operação que já aconteceu |
| [Autocompletar da busca](#search-autocomplete) | Autocompletar é um problema de latência |
| [Assistente de suporte com IA (RAG + ferramentas)](#ai-assistant) | Numa aplicação com LLM, latência e custo crescem com o número de chamadas ao modelo |
| [Não se conserta o que não se mede](#observability-stack) | Observabilidade muda o resultado |
| [Microsserviços no Kubernetes: pods vs nós](#microservices) | O HPA adiciona pods, só nós trazem espaço; cada salto síncrono soma à espera do usuário |
| [Kubernetes: perdendo um nó](#k8s-node-failure) | Planeje N+1 também para nós: um nó perdido leva vários pods de uma vez, e eles só voltam se houver espaço |
| [Failover do banco: RTO e RPO](#db-failover) | Um failover custa o tempo sem primário (RTO) e as escritas ainda não replicadas (RPO) |

## Monólito: encontre o ponto de ruptura { #monolith }

Versão 1 da aplicação: um servidor de aplicação e um PostgreSQL. O perfil breakpoint aumenta a carga até os erros passarem de 5% ou o p99 explodir. Onde quebra, e qual componente quebra primeiro? Faça aguentar 2 000 req/s gastando no máximo 2 000 USD/mês.

- **Lição:** Todo sistema tem um ponto de ruptura, e o primeiro componente a saturar o define. Escalar uma camada leva o gargalo para a próxima.
- **Configuração:** `monolith` · perfil `breakpoint` · alvo 600 req/s · 90% leituras · semente 7 · caos `off`
- **Metas:** ponto de ruptura ≥ 2.000 req/s · custo/mês < US$ 2.000
- **Tente:** Aperte ▶ e leia o Relatório: ponto de ruptura e gargalo. Coloque um Load Balancer antes da aplicação e aumente as réplicas; rode de novo.
- **Observe:** O joelho (p99 dobra) vem bem antes da ruptura. Depois de escalar a aplicação, o banco vira o gargalo.
- **Relacionado:** [O que é system design](../../2027.1/classes/intro/index.md) · [Estimativas](../../2027.1/classes/estimation/index.md)

<div class="sdp" data-scenario="monolith" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Por que a latência cresce devagar no começo e explode perto de ρ = 1?
    2. Com 6 réplicas, qual componente quebra primeiro, e em que taxa? Confira com ρ = λ / μ.
    3. O que você faria em seguida se a meta fosse 5 000 req/s?

## Escalar horizontalmente atrás de um balanceador { #scale-out }

O catálogo recebe 1 500 req/s. Duas réplicas não bastam, e em t = 80 s uma réplica cai. O balanceador continua mandando tráfego para ela até perceber (30 s sem health checks). Cumpra as metas com folga para uma falha (N+1).

- **Lição:** Escala horizontal precisa de folga para falhas (N+1), e o balanceador só desvia de uma réplica morta depois de detectá-la.
- **Configuração:** `scale-out` · perfil `load` · alvo 1.500 req/s · 90% leituras · semente 11 · caos `off` · eventos programados: t = 80 s — uma réplica do catálogo cai
- **Metas:** taxa de erro < 1% · p99 < 250 ms · custo/mês < US$ 1.800
- **Tente:** Aumente as réplicas até ρ ≈ 0,6. Depois adicione um Health Check ligado ao Load Balancer.
- **Observe:** Em t = 80 s uma réplica morre: os erros duram ~30 s sem health checks e ~3 s com eles. As sobreviventes absorvem a parte dela.
- **Relacionado:** [Tráfego & borda](../../2027.1/classes/edge/index.md) · [Confiabilidade](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Quantas réplicas são necessárias para que perder uma mantenha ρ abaixo de 0,85?
    2. Por que uma réplica caída continua recebendo requisições por um tempo?
    3. O que o tempo de detecção faz com a disponibilidade (MTTR = detectar + reparar)?

## Catálogo com muitas leituras: adicione um cache { #read-heavy-cache }

Usuários navegam pelo catálogo: 3 000 req/s, 95% leituras. A camada de aplicação aguenta; o banco não. Em t = 100 s o cache (quando houver um) é esvaziado: o banco sobrevive à avalanche de misses?

- **Lição:** Um cache antes do banco reduz sua carga de leitura para leituras × (1 − taxa de acerto); um cache frio manda tudo de volta ao banco de uma vez (stampede).
- **Configuração:** `read-heavy-cache` · perfil `load` · alvo 3.000 req/s · 95% leituras · semente 3 · caos `off` · eventos programados: t = 100 s — cache esvaziado (deploy / reinício)
- **Metas:** p99 < 100 ms · taxa de erro < 0,5% · custo/mês < US$ 3.000
- **Tente:** Insira um Cache entre a aplicação e o banco. Rode; depois ligue a coalescência e compare o que acontece em t = 100 s.
- **Observe:** A utilização do banco cai com a taxa de acerto. No flush, sem coalescência, ele satura por vários segundos.
- **Relacionado:** [Cache](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Com 95% de leituras e 88% de acerto, qual é a carga no banco a 3 000 req/s?
    2. Por que o cache-aside reduz a taxa de acerto quando há muitas escritas?
    3. Cite duas outras formas de sobreviver a um stampede.

## Tire o conteúdo estático da origem com uma CDN { #cdn-static }

As páginas de produtos têm imagens, estilos e scripts: 3 000 req/s, 98% leituras, servidos pela aplicação a partir do object storage. Usuários longe da região esperam, e a aplicação satura. Sirva-os pela borda.

- **Lição:** Conteúdo estático e cacheável fica na borda: a origem só vê misses e escritas, e o usuário recebe a resposta de perto.
- **Configuração:** `cdn-static` · perfil `load` · alvo 3.000 req/s · 98% leituras · semente 5 · caos `off`
- **Metas:** p99 < 150 ms · taxa de erro < 0,5%
- **Tente:** Coloque uma CDN depois do DNS (dns → cdn → lb). Reduza as réplicas e compare latência e custo.
- **Observe:** A aplicação cai de saturada para ~35% com menos réplicas. A saída de dados da CDN vira a maior linha de custo.
- **Relacionado:** [Tráfego & borda](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="cdn-static" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. O que decide a taxa de acerto de uma CDN (TTL, chave de cache, conteúdo)?
    2. Por que a saída de dados (USD/GB) costuma ser a maior linha de um site de mídia?
    3. Como você invalidaria uma imagem que mudou?

## Réplicas de leitura e atraso de replicação { #db-replicas }

4 000 req/s com 10% de escritas sobrecarregam o único primário PostgreSQL. Réplicas de leitura recebem leituras, nunca escritas, e ficam atrás do primário. Mantenha o atraso abaixo de 1 s.

- **Lição:** Réplicas de leitura multiplicam a capacidade de leitura, não a de escrita, e servem dados um pouco antigos (atraso de replicação).
- **Configuração:** `db-replicas` · perfil `load` · alvo 4.000 req/s · 90% leituras · semente 13 · caos `off`
- **Metas:** p99 < 150 ms · taxa de erro < 0,5% · atraso de replicação < 1 s
- **Tente:** Adicione 2 réplicas de leitura ao banco. Depois aumente as escritas na barra para 30% e observe o primário.
- **Observe:** Leituras se espalham por 1 + réplicas; o primário fica com todas as escritas e seu atraso cresce com elas.
- **Relacionado:** [Bancos de dados](../../2027.1/classes/databases/index.md)

<div class="sdp" data-scenario="db-replicas" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Quais leituras toleram atraso, e quais devem ir ao primário (read-your-writes)?
    2. Com que parcela de escritas as réplicas deixam de ajudar?
    3. O que vem depois das réplicas quando as escritas são o limite?

## Partições e a chave quente { #sharding }

Consultas e atualizações de estoque (50% escritas) a 8 000 req/s em um banco chave-valor com 2 partições. Em t = 60 s uma celebridade posta o link de um produto: uma chave recebe uma fatia enorme do tráfego por um minuto. Mais partições resolvem a média — resolvem a chave quente?

- **Lição:** Particionar escala com o número de partições só enquanto as chaves se espalham; uma chave quente concentra a carga numa partição.
- **Configuração:** `sharding` · perfil `load` · alvo 8.000 req/s · 50% leituras · semente 17 · caos `off` · eventos programados: t = 60 s — efeito celebridade: uma chave quente
- **Metas:** taxa de erro < 0,5% · p99 < 100 ms
- **Tente:** Aumente para 8 partições e rode. Depois adicione um Cache antes do NoSQL para as leituras quentes.
- **Observe:** Em t = 60 s começa o efeito celebridade: com 8 partições a mais ocupada ainda satura; o cache absorve as leituras quentes.
- **Relacionado:** [Bancos de dados](../../2027.1/classes/databases/index.md) · [Cache](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="sharding" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Se a chave mais quente recebe 45% do tráfego, qual é a carga da partição dela com P = 8? E com P = 64?
    2. Além do cache, como dividir uma chave quente (salting, réplicas da chave)?
    3. Por que se usa hashing consistente para posicionar as chaves?

## Uma fila absorve o pico { #async-queue }

Cada pedido gera um recibo em PDF (50 ms de trabalho). Hoje o serviço de pedidos espera por ele. O perfil spike multiplica a carga por 5 durante 30 s: os workers não acompanham e pedidos falham. Libere o usuário e faça o trabalho depois.

- **Lição:** Uma fila desacopla o usuário do trabalho lento: o produtor só espera o broker; o backlog absorve o pico e drena depois.
- **Configuração:** `async-queue` · perfil `spike` · alvo 150 req/s · 0% leituras · semente 19 · caos `off`
- **Metas:** taxa de erro < 0,1% · p99 < 100 ms · atraso do consumidor < 60 s
- **Tente:** Troque a chamada app → worker por app → Message Queue → worker. Rode o perfil spike de novo.
- **Observe:** Os erros somem; o backlog cresce durante os 30 s de pico e drena depois. Atraso = backlog ÷ taxa de drenagem.
- **Relacionado:** [Mensageria](../../2027.1/classes/messaging/index.md) · [Computação & serviços](../../2027.1/classes/compute/index.md)

<div class="sdp" data-scenario="async-queue" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Quanto tempo o backlog leva para drenar com 4 workers? Calcule antes de rodar.
    2. O que acontece se o pico nunca acaba (produtores > consumidores para sempre)?
    3. Por que o consumidor deve ser idempotente com entrega at-least-once?

## Publique um evento, deixe os consumidores reagirem { #event-fanout }

Quando um pedido é feito, a aplicação avisa o comprador, atualiza o analytics e reindexa a disponibilidade — hoje com três chamadas síncronas em sequência. Em t = 60 s o analytics fica 20× mais lento e os pedidos ficam lentos junto. Desacople o serviço de pedidos dos consumidores.

- **Lição:** Com um log de eventos cada grupo de consumidores lê no seu ritmo: um consumidor lento fica para trás sem atrasar o produtor nem os outros.
- **Configuração:** `event-fanout` · perfil `load` · alvo 400 req/s · 0% leituras · semente 23 · caos `off` · eventos programados: t = 60 s — analytics 20× mais lento
- **Metas:** p99 < 120 ms · taxa de erro < 0,1% · atraso do consumidor < 60 s
- **Tente:** Publique no Kafka (app → kafka) e deixe notification, analytics e o indexador consumirem (kafka → cada um).
- **Observe:** Quando o analytics fica lento em t = 60 s, só o atraso dele cresce; a latência dos pedidos fica estável.
- **Relacionado:** [Mensageria](../../2027.1/classes/messaging/index.md)

<div class="sdp" data-scenario="event-fanout" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. O que define o paralelismo máximo de um grupo de consumidores?
    2. Que garantias você perde em relação a chamadas síncronas (ordem, read-your-writes)?
    3. Como publicar o evento e gravar o pedido de forma atômica (outbox)?

## Falha em cascata: uma dependência lenta { #cascading-failure }

Metade das páginas do catálogo chama uma API externa de recomendações. Em t = 60 s ela fica 20× mais lenta (3 s). Sem timeouts cada requisição segura uma thread esperando; os pools de threads se esgotam e o catálogo inteiro falha — embora a CPU da aplicação esteja quase ociosa (Lei de Little: threads = λ × W).

- **Lição:** Uma dependência lenta sem timeouts esgota as threads de quem chama (Lei de Little) e derruba requisições que nem a usam.
- **Configuração:** `cascading-failure` · perfil `load` · alvo 800 req/s · 90% leituras · semente 29 · caos `off` · eventos programados: t = 60 s — API de recomendações 20× mais lenta
- **Metas:** taxa de erro < 1% · p99 < 500 ms
- **Tente:** Rode como está e leia o gargalo no Relatório. Depois defina timeout de 300 ms em app → recommendations, e então fallback e circuit breaker.
- **Observe:** Sem timeout a aplicação fica sem threads com a CPU ociosa. Com o timeout só falham as chamadas de recomendação; com o fallback, ninguém.
- **Relacionado:** [Confiabilidade](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. A 800 req/s, metade chamando uma dependência de 3 s, quantas threads ficam ocupadas? (L = λ × W)
    2. Por que só o timeout não zera os erros aqui?
    3. O que um bulkhead mudaria?

## Tempestade de retries: quando retentar piora { #retry-storm }

O serviço de inventário retenta cada consulta falha 3 vezes, na hora, com timeout de 100 ms. Em t = 60 s o banco reinicia (8 s). Quando volta, recebe até 4× a carga normal, a fila enche, as respostas passam do timeout… e ele nunca se recupera, embora o gatilho já tenha passado (uma falha metaestável).

- **Lição:** Retries imediatos multiplicam a carga de um serviço em apuros; quando as respostas passam do timeout, toda tentativa falha e o sistema continua fora mesmo após o gatilho (falha metaestável).
- **Configuração:** `retry-storm` · perfil `load` · alvo 2.000 req/s · 90% leituras · semente 31 · caos `off` · eventos programados: t = 60 s — o banco reinicia
- **Metas:** taxa de erro < 15% · p99 < 300 ms
- **Tente:** Rode e observe a aresta app → db após o reinício de 8 s. Depois ligue o circuit breaker; teste também 1 retry com backoff exponencial + jitter.
- **Observe:** A taxa na aresta salta para ~4× e os erros não se recuperam. Com o breaker o banco esvazia a fila e o sistema volta.
- **Relacionado:** [Confiabilidade](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="retry-storm" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Com p = 0,9 de falha por tentativa e 3 retries, qual é o multiplicador de carga?
    2. Por que um timeout maior ou uma fila menor também quebram o ciclo?
    3. O que é um orçamento de retries (retry budget)?

## Rate limiting protege o backend { #rate-limiter }

1 000 req/s de usuários reais — mais bots raspadores enviando o dobro disso. O catálogo derrete para todos. Rejeite o excesso rapidamente no gateway (429) em vez de deixá-lo enfileirar atrás dos usuários reais.

- **Lição:** Rejeitar o excesso rapidamente (429) protege o backend e os usuários reais; deixá-lo enfileirar degrada todo mundo.
- **Configuração:** `rate-limiter` · perfil `load` · alvo 1.000 req/s · 90% leituras · semente 37 · caos `off`
- **Metas:** taxa de erro < 1% · p99 < 200 ms
- **Tente:** Defina um limite no API Gateway abaixo da capacidade da aplicação (ex.: 1 500 req/s). Ou coloque um WAF na frente.
- **Observe:** Os bots são cortados primeiro (token buckets por cliente), os usuários reais mantêm latência baixa e a aplicação fica abaixo da saturação.
- **Relacionado:** [Tráfego & borda](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="rate-limiter" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Token bucket vs. janela deslizante: qual permite rajadas?
    2. Onde deve ficar o limite num sistema com muitas réplicas de gateway?
    3. Por que um 429 é melhor para o cliente que um timeout?

## Sobrevivendo à queda de uma região { #multi-region }

A aplicação roda em uma região de nuvem. Em t = 60 s a região inteira cai. Construa uma segunda região e deixe o DNS levar os usuários para lá. Tempo de failover = detecção + TTL do DNS: confira os dois.

- **Lição:** Sobreviver à perda de uma região exige uma segunda pilha completa e um jeito de mover os usuários: o failover por DNS leva detecção mais TTL.
- **Configuração:** `multi-region` · perfil `load` · alvo 1.000 req/s · 90% leituras · semente 41 · caos `off` · eventos programados: t = 60 s — região sa-east-1 fora do ar
- **Metas:** disponibilidade ≥ 95% · p99 < 80 ms
- **Tente:** Desenhe uma segunda VPC (outra região) com LB, aplicação e banco; conecte o DNS a ela, ligue um Health Check ao DNS e reduza o TTL.
- **Observe:** Em t = 60 s a primeira região some. Os erros duram cerca de (3 s + TTL) para os usuários roteados para lá.
- **Relacionado:** [Confiabilidade](../../2027.1/classes/reliability/index.md) · [Tráfego & borda](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="multi-region" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Ativo-ativo ou ativo-passivo: qual perde menos requisições aqui?
    2. O que acontece com dados gravados na região perdida (RPO)?
    3. Por que cada aplicação deve chamar o banco da própria região?

## Pico serverless: cold starts e limites { #serverless-burst }

A verificação de cupom de desconto roda como função. O perfil spike salta de 200 para 2 000 req/s. Instâncias novas partem a frio (600 ms) e a conta tem limite de concorrência de 50. Instâncias necessárias = λ × W (Lei de Little).

- **Lição:** Funções escalam por requisição: instâncias = λ × W, cold starts acontecem justo quando o tráfego salta, e o limite de concorrência estrangula o resto.
- **Configuração:** `serverless-burst` · perfil `spike` · alvo 200 req/s · 90% leituras · semente 43 · caos `off`
- **Metas:** taxa de erro < 0,5% · p99 < 300 ms · custo/mês < US$ 5.000
- **Tente:** Aumente o limite de concorrência, rode o spike; depois adicione instâncias provisionadas e compare p99 e custo.
- **Observe:** O throttling (429) some com o limite maior; os cold starts aparecem no p99 no início do pico até existirem instâncias quentes.
- **Relacionado:** [Computação & serviços](../../2027.1/classes/compute/index.md)

<div class="sdp" data-scenario="serverless-burst" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Quantas instâncias 2 000 req/s × 40 ms exigem?
    2. Por que cold starts aumentam o número de instâncias necessárias?
    3. Quando um contêiner com autoescala é mais barato que funções?

## Venda relâmpago: um lançamento com estoque limitado { #flash-sale }

Um produto com estoque limitado entra à venda em t = 60 s: o tráfego salta 20× (~6 000 req/s) por 90 s. 80% das requisições leem a página do produto, 20% tentam comprar. O banco guarda o estoque (nada de vender o que não há!) e o provedor de pagamento aceita 500 req/s. Hoje tudo desaba. Projete para o pico: sirva leituras da borda e de caches, e coloque os compradores numa sala de espera (fila) drenada na velocidade que o inventário e o provedor aguentam.

- **Lição:** Uma venda relâmpago é projetada para o pico: leituras são absorvidas pela borda e por caches, e compradores esperam numa fila drenada no ritmo do inventário e do provedor de pagamento.
- **Configuração:** `flash-sale` · perfil `load` · alvo 300 req/s · 80% leituras · semente 2027 · caos `off` · eventos programados: t = 60 s — abre a venda
- **Metas:** p99 < 300 ms · taxa de erro < 1% · atraso do consumidor < 300 s
- **Tente:** Siga as dicas uma a uma: CDN, cache do catálogo, depois API Gateway mandando escritas para uma fila (sala de espera) consumida por workers de pedidos.
- **Observe:** Com a sala de espera os erros somem e o p99 fica baixo; o atraso do consumidor é quanto o comprador espera na fila.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md) · [Mensageria](../../2027.1/classes/messaging/index.md) · [Cache](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Quantos itens podem ser vendidos por segundo se o pagamento aceita 500 req/s e cada pedido faz uma chamada?
    2. Como evitar vender mais itens do que há em estoque (reservas, SELECT … FOR UPDATE)?
    3. Como mostrar ao usuário sua posição na fila?

## Encurtador de URLs (sho.rt/xyz) { #url-shortener }

Cada e-mail de pedido e post compartilhado leva um link curto. 5 000 redirecionamentos/s, 99% leituras, poucas escritas (novos links). O clássico de entrevista: qual é o caminho de leitura, e que banco serve para chave → URL?

- **Lição:** Uma busca por chave com muitas leituras: cache + banco chave-valor, dimensionados com aritmética simples.
- **Configuração:** `url-shortener` · perfil `load` · alvo 5.000 req/s · 99% leituras · semente 47 · caos `off`
- **Metas:** p99 < 50 ms · taxa de erro < 0,1% · custo/mês < US$ 3.500
- **Tente:** Troque o SQL por Cache → NoSQL e dimensione a aplicação.
- **Observe:** O p99 cai para poucas dezenas de ms; a maioria dos redirecionamentos nem chega ao banco.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md)

<div class="sdp" data-scenario="url-shortener" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Quantos códigos cabem em 7 caracteres base-62?
    2. Como gerar códigos únicos sem coordenação?
    3. Redirecionamento 301 ou 302: qual permite contar cliques?

## Feed de notícias: fan-out na escrita vs na leitura { #news-feed }

O feed mostra posts das contas que o usuário segue. Hoje o feed é montado na leitura: uma consulta pesada (40 ms) que junta centenas de fontes. 2 000 req/s, 95% leituras. Em vez disso, pré-calcule as timelines quando algo é postado.

- **Lição:** Fan-out na escrita move trabalho do caminho de leitura (frequente) para o de escrita (raro): ler o feed vira uma busca por chave.
- **Configuração:** `news-feed` · perfil `load` · alvo 2.000 req/s · 95% leituras · semente 53 · caos `off`
- **Metas:** p99 < 100 ms · taxa de erro < 0,5% · atraso do consumidor < 10 s
- **Tente:** Mande leituras para um cache de timelines sobre um NoSQL, e escritas para o banco de posts mais Kafka → workers de fan-out → timelines.
- **Observe:** Leituras ficam baratas; o atraso do fan-out mostra quanto um post leva para chegar às timelines.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md) · [Mensageria](../../2027.1/classes/messaging/index.md)

<div class="sdp" data-scenario="news-feed" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. O que quebra quando uma conta tem 10 milhões de seguidores?
    2. Como uma abordagem híbrida trata celebridades?
    3. Que consistência um feed realmente precisa?

## Chat de um evento ao vivo { #chat }

Durante um evento ao vivo, usuários conversam na sala: 2 000 req/s, metade são mensagens novas. Cada mensagem é gravada no PostgreSQL e entregue de forma síncrona antes de o remetente ter resposta. As escritas sobrecarregam o banco e o remetente espera cada entrega.

- **Lição:** Chat separa guardar mensagens (particionado, muitas escritas) de entregá-las (pub/sub para os servidores conectados).
- **Configuração:** `chat` · perfil `load` · alvo 2.000 req/s · 50% leituras · semente 59 · caos `off`
- **Metas:** p99 < 80 ms · taxa de erro < 0,1% · atraso do consumidor < 2 s
- **Tente:** Guarde mensagens num NoSQL e publique-as num Pub/Sub consumido pelo serviço de entrega.
- **Observe:** A carga de escrita se espalha pelas partições; quem envia não espera mais a entrega.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md) · [Tráfego & borda](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="chat" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Como uma mensagem chega a um usuário conectado a outro servidor websocket?
    2. Como ordenar as mensagens de uma sala?
    3. O que acontece com mensagens para usuários offline?

## Carona: um índice geográfico com muitas escritas { #ride-sharing }

Motoristas enviam a posição a cada 4 s: 20 000 req/s, 90% escritas, enquanto passageiros buscam motoristas próximos. Um banco relacional não absorve essa taxa de escrita. Guarde só a última posição por motorista num banco particionado e transmita o histórico.

- **Lição:** Atualizações de posição são um fluxo de muitas escritas: guarde só a última posição num banco particionado e mande o histórico de forma assíncrona.
- **Configuração:** `ride-sharing` · perfil `load` · alvo 20.000 req/s · 10% leituras · semente 61 · caos `off`
- **Metas:** p99 < 100 ms · taxa de erro < 0,5% · custo/mês < US$ 6.000
- **Tente:** Troque o SQL por um índice geográfico NoSQL particionado; amostre posições no Kafka para o analytics.
- **Observe:** O primário relacional saturava com as escritas; o banco particionado as absorve com folga.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md) · [Bancos de dados](../../2027.1/classes/databases/index.md)

<div class="sdp" data-scenario="ride-sharing" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Quantas escritas/s geram 1 milhão de motoristas enviando a cada 4 s?
    2. Como achar motoristas num raio de 2 km (geohash, quadtree, H3)?
    3. O que acontece com o índice quando um estádio esvazia?

## Streaming de vídeo: CDN + object store + transcodificação { #video-streaming }

Criadores enviam vídeos; usuários assistem. 2 000 requisições/s de segmentos passam pela aplicação, e cada upload é transcodificado de forma síncrona (20 s por vídeo) enquanto quem enviou espera. Sirva segmentos pela borda e transcodifique em segundo plano.

- **Lição:** Vídeo é bytes na borda mais trabalho pesado em segundo plano: CDN + object store para quem assiste, fila + workers para transcodificar.
- **Configuração:** `video-streaming` · perfil `load` · alvo 2.000 req/s · 99% leituras · semente 67 · caos `off`
- **Metas:** p99 < 150 ms · taxa de erro < 0,5% · atraso do consumidor < 120 s
- **Tente:** Viewers → CDN → Object Store; uploads → API Gateway → app → queue → transcoders.
- **Observe:** A aplicação quase some do caminho de quem assiste; o backlog de transcodificação drena a réplicas × 1/20 s.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md) · [Tráfego & borda](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="video-streaming" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Por que segmentos de vídeo são ideais para cache?
    2. Quantos transcoders 0,5 upload/s de jobs de 20 s exigem (Little)?
    3. Por que gerar várias taxas de bits (streaming adaptativo)?

## Sistema de notificações { #notification-system }

Cada compra manda um e-mail de confirmação (50 req/s), e um agendador manda 6 000 e-mails de resumo a cada 2 minutos — todos no mesmo instante. O provedor de e-mail aceita 200 envios/s. Hoje compradores esperam o provedor e falham sempre que chega a rajada do resumo.

- **Lição:** Notificações são assíncronas por natureza: enfileire, dose na cota do provedor e nunca dispare jobs agendados todos juntos.
- **Configuração:** `notification-system` · perfil `load` · alvo 50 req/s · 0% leituras · semente 71 · caos `off`
- **Metas:** taxa de erro < 0,5% · p99 < 150 ms · atraso do consumidor < 120 s
- **Tente:** Coloque uma fila antes do serviço de notificações e espalhe os jobs do agendador em 60 s.
- **Observe:** Os compradores não sentem mais a rajada do resumo; a cota do provedor define a drenagem.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md) · [Computação & serviços](../../2027.1/classes/compute/index.md)

<div class="sdp" data-scenario="notification-system" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Por que uma rajada agendada é um pico autoinfligido?
    2. Como dar prioridade a e-mails transacionais sobre resumos?
    3. Como evitar mandar o mesmo e-mail duas vezes?

## Pagamentos: retries precisam de idempotência { #payment-system }

Pedidos chamam o provedor de pagamento de forma síncrona com timeout de 1 s e 2 retries imediatos. Em t = 60 s o provedor fica 4× mais lento: chamadas estouram o timeout, e cada retry após um timeout pode cobrar o cartão DE NOVO — o provedor recebeu a primeira tentativa. Torne os pagamentos seguros e mantenha os compradores rápidos.

- **Lição:** Um retry após timeout pode repetir uma operação que já aconteceu: pagamentos precisam de chaves de idempotência, e o comprador não deve esperar o provedor.
- **Configuração:** `payment-system` · perfil `load` · alvo 300 req/s · 50% leituras · semente 73 · caos `off` · eventos programados: t = 60 s — provedor de pagamento 4× mais lento
- **Metas:** cobranças duplicadas < 1 · taxa de erro < 1% · p99 < 1.500 ms
- **Tente:** Ligue a chave de idempotência na aresta do pagamento; depois mova a chamada para trás de uma fila e de um worker de pagamento.
- **Observe:** As cobranças duplicadas zeram com a chave; com a fila, a latência do comprador não depende mais do provedor.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md) · [Computação & serviços](../../2027.1/classes/compute/index.md)

<div class="sdp" data-scenario="payment-system" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Por que um timeout não distingue "falhou" de "deu certo devagar"?
    2. Como o provedor usa a chave de idempotência?
    3. Como webhooks e conciliação fecham o ciclo?

## Autocompletar da busca { #search-autocomplete }

Cada tecla na caixa de busca pede sugestões: 10 000 req/s, todas leituras, e precisam parecer instantâneas (< 50 ms). O cluster de busca não aguenta. A maioria dos prefixos é popular e se repete muito.

- **Lição:** Autocompletar é um problema de latência: prefixos populares se repetem, então um cache de prefixos responde a maioria das teclas.
- **Configuração:** `search-autocomplete` · perfil `load` · alvo 10.000 req/s · 100% leituras · semente 79 · caos `off`
- **Metas:** p99 < 50 ms · taxa de erro < 0,1% · custo/mês < US$ 5.000
- **Tente:** Insira um Cache entre a aplicação e a busca; dimensione a aplicação. Reduza o RPS-alvo para simular o debounce do cliente.
- **Observe:** A carga da busca cai pela taxa de acerto e o p99 cumpre o orçamento de 50 ms.
- **Relacionado:** [Estudos de caso](../../2027.1/classes/case-studies/index.md) · [Cache](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="search-autocomplete" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Quantas requisições o debounce de 100 ms economiza ao digitar "metallica"?
    2. Trie em memória vs. motor de busca: trade-offs?
    3. Com que frequência as sugestões devem ser reconstruídas?

## Assistente de suporte com IA (RAG + ferramentas) { #ai-assistant }

O assistente de suporte responde perguntas sobre produtos e pedidos. Seu laço de agente faz 6 passos (6 chamadas ao LLM + ferramentas) por pergunta, a cota do provedor é de 10 chamadas/s, e nada verifica prompt injection. 2 perguntas/s já estouram a cota, levam segundos e custam uma fortuna.

- **Lição:** Numa aplicação com LLM, latência e custo crescem com o número de chamadas ao modelo: menos passos, cache semântico e roteamento ciente da cota importam mais que capacidade bruta; guardrails ficam no caminho.
- **Configuração:** `ai-assistant` · perfil `load` · alvo 2 req/s · 100% leituras · semente 83 · caos `off`
- **Metas:** taxa de erro < 1% · p99 < 10.000 ms · custo/mês < US$ 60.000 · respostas inseguras < 0,1%
- **Tente:** Reduza os passos do agente, ligue o cache semântico e um modelo reserva, e coloque um Safety Mesh entre o gateway e o assistente.
- **Observe:** Os erros (429) somem abaixo da cota, o custo cai com as chamadas por pergunta e a taxa de respostas inseguras despenca.
- **Relacionado:** [Sistemas de IA](../../2027.1/classes/ai-systems/index.md)

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Custo por pergunta = passos × tokens × preço: calcule para 6 e para 3 passos.
    2. O que um cache semântico arrisca (respostas velhas ou erradas)?
    3. Onde os guardrails devem rodar: entrada, saída ou ambos?

## Não se conserta o que não se mede { #observability-stack }

A utilização fica oculta ("?") até o serviço ser ligado ao Metrics. Em t = 50 s uma réplica do catálogo morre; sem health checks o balanceador só percebe após 30 s, e sem alertas ninguém a repara logo. Monte a pilha de observabilidade: métricas em todo serviço, health checks, alertas, logs e tracing.

- **Lição:** Observabilidade muda o resultado: health checks encurtam a detecção, alertas encurtam o reparo, e métricas tornam a utilização visível.
- **Configuração:** `observability-stack` · perfil `load` · alvo 600 req/s · 90% leituras · semente 89 · caos `off` · eventos programados: t = 50 s — uma réplica do catálogo morre
- **Metas:** disponibilidade ≥ 99% · p99 < 200 ms · serviços medidos ≥ 100%
- **Tente:** Conecte Metrics ao LB, à aplicação e ao banco; adicione Health Check no LB, Alerting no Metrics, além de Logs e Tracing na aplicação.
- **Observe:** Os "?" viram números; a queda em t = 50 s custa segundos em vez de meio minuto; a aba Trace mostra onde uma requisição lenta gasta seu tempo.
- **Relacionado:** [Observabilidade](../../2027.1/classes/observability/index.md)

<div class="sdp" data-scenario="observability-stack" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Disponibilidade = MTTF / (MTTF + MTTR): que parte cada nó melhorou?
    2. Que quatro sinais de ouro você poria no painel?
    3. Por que alertar por taxa de queima do SLO e não por CPU?

## Microsserviços no Kubernetes: pods vs nós { #microservices }

A aplicação foi dividida nos microsserviços catalog, inventory, order e notify, cada um com seu banco, atrás de um API gateway, num cluster Kubernetes de 2 nós × 6 pods. Com 2 000 req/s o HPA do catálogo pede mais pods do que o cluster consegue alocar: eles ficam Pending, e o catálogo afoga. Comprar é uma cadeia síncrona (order → inventory, catalog, notify, seu banco): cada salto soma sua latência à espera do comprador.

- **Lição:** O HPA adiciona pods, mas só nós trazem espaço: pods além de nós × pods por nó ficam Pending e não atendem nada. Numa cadeia de microsserviços síncronos cada salto soma sua latência à espera do usuário, então o trabalho que o usuário não precisa esperar vai para trás de uma fila.
- **Configuração:** `microservices` · perfil `load` · alvo 2.000 req/s · 80% leituras · semente 2031 · caos `off`
- **Metas:** taxa de erro < 1% · p99 < 200 ms · custo/mês < US$ 8.500
- **Tente:** Selecione a moldura do cluster: pods = nós × pods por nó. Adicione nós ou ligue o cluster autoscaler (um nó leva ~90 s, então mantenha alguma folga), aumente o mínimo de réplicas do catálogo e coloque uma fila entre order e notify.
- **Observe:** Como está, erros ≈ 25% e p99 ≈ 3,8 s: o HPA do catálogo quer ~14 pods, mas o cluster de 2 × 6 está cheio (6 catalog + 2 order + 2 inventory + 2 notify), então 9 pods ficam Pending; e o comprador ainda espera o notify (mediana de 120 ms, σ 0,6). A solução possível — 3 nós com o cluster autoscaler (máx. 6; ele adiciona um 4º nó em ~45 s, pronto em ~135 s), réplicas e mínimo do catálogo em 10, e order → fila *confirmations* → notify — passa com erros ≈ 0%, p99 ≈ 60 ms e ≈ 8 000 USD/mês. Leia as linhas de custo: o preço por requisição do API gateway, não os nós, domina a conta.
- **Relacionado:** [Computação & serviços](../../2027.1/classes/compute/index.md) · [Plataformas cloud-native](../../2027.1/classes/cloud-native/index.md)

<div class="sdp" data-scenario="microservices" data-mode="compact" data-height="480"></div>

??? question "Perguntas para discutir"

    1. O catálogo recebe as leituras (80% de 2 000 req/s) mais uma chamada por pedido (400 req/s), a 250 req/s por pod. Quantos pods ele precisa com ρ = 0,6, e eles cabem em 2 nós × 6 pods?
    2. Que chamadas da cadeia de compra precisam terminar antes de o comprador ter resposta, e quais podem virar eventos?
    3. O gateway cobra 1 USD por milhão de requisições: quanto isso dá por mês a 2 000 req/s, e como você o reduziria?

## Kubernetes: perdendo um nó { #k8s-node-failure }

Catalog e pricing rodam 6 pods cada num cluster de 3 nós × 4 pods: completamente cheio. Em t = 60 s um nó morre e leva um terço dos pods. Quem chama continua mandando requisições aos pods mortos até perceber (30 s atrás do balanceador, 40 s na chamada direta catalog → pricing), e os pods perdidos não têm onde ser realocados. Sobreviva à perda de qualquer nó.

- **Lição:** N+1 vale para nós, não só para réplicas: um nó perdido leva vários pods de uma vez, quem chama continua chamando-os até perceber, e o Kubernetes só consegue realocá-los onde houver espaço. Uma chamada direta entre serviços precisa de descoberta de serviços e de timeout para parar de esperar por pods mortos.
- **Configuração:** `k8s-node-failure` · perfil `load` · alvo 1.700 req/s · 90% leituras · semente 2033 · caos `off` · eventos programados: t = 60 s — um nó de trabalho morre
- **Metas:** taxa de erro < 1% · p99 < 150 ms · custo/mês < US$ 2.000
- **Tente:** Deixe espaço no cluster (mais pods por nó ou um nó a mais) e dimensione as réplicas para que as sobreviventes aguentem a carga (ρ após perder um terço abaixo de ~0,85). Coloque timeout com retries em catalog → pricing e conecte um Service Registry a catalog e pricing.
- **Observe:** Como está, o nó leva 2 pods do catalog + 2 do pricing. As chamadas catalog → pricing continuam indo aos pods mortos do pricing por 40 s; cada uma trava 10 s, as threads do catálogo acabam e a falha cascateia (~90% de erros nessa janela); após 40 s os pods perdidos são recriados mas ficam Pending (sem espaço): ≈ 27% de erros e p99 > 4 s na execução. A solução possível — 8 pods por nó (3 × 8 = 24 vagas: após perder um nó, 16 vagas para os 16 pods — N+1 para nós), 8 réplicas cada, um Service Registry conectado a catalog e pricing, e timeout de 300 ms + 2 retries em catalog → pricing — passa com erros ≈ 0,8% e p99 ≈ 43 ms: pods mortos são descartados em 3 s, uma chamada que cai num deles desiste após 300 ms e é retentada num pod vivo, os pods sobreviventes aguentam a carga, e os 6 pods perdidos são todos realocados após 40 s.
- **Relacionado:** [Plataformas cloud-native](../../2027.1/classes/cloud-native/index.md) · [Confiabilidade](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="k8s-node-failure" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Com 3 nós × 4 pods e 12 pods, quantos pods uma falha de nó leva, e onde o Kubernetes pode colocá-los? E com 8 pods por nó e 8 réplicas cada?
    2. Por que a chamada direta catalog → pricing machuca mais que a aresta balanceador → catalog? Use a Lei de Little com uma trava de 10 s.
    3. Por que os pods de um serviço devem se espalhar por nós e zonas diferentes (topology spread constraints)?

## Failover do banco: RTO e RPO { #db-failover }

Checkout da venda relâmpago: 1 500 req/s, metade escritas (pedidos), num DB Cluster com um primário e um seguidor replicado de forma assíncrona. Em t = 90 s o primário morre. Até um seguidor ser promovido (30 s) toda escrita falha, e as escritas ainda dentro do atraso de replicação se perdem de vez: pedidos pagos e esquecidos. Faça o failover não perder nada e doer pouco.

- **Lição:** Um failover tem dois custos: o tempo sem primário (RTO) e as escritas ainda não replicadas (RPO). Replicação síncrona ou por quorum zera o RPO ao preço de uma ida e volta por escrita; um failover rápido e mais shards reduzem o RTO e a parcela de escritas que ele atinge — e toda cópia é paga.
- **Configuração:** `db-failover` · perfil `load` · alvo 1.500 req/s · 50% leituras · semente 2035 · caos `off` · eventos programados: t = 90 s — o primário de orders-db morre
- **Metas:** escritas perdidas < 1 · disponibilidade ≥ 99% · p99 (escritas) < 100 ms
- **Tente:** Troque a replicação para sync ou quorum, reduza o tempo de failover e divida as chaves em shards. Depois injete uma degradação de latência no cluster (ela deixa um seguidor lento) e compare sync e quorum no p99 de escrita.
- **Observe:** Como está, ≈ 1 570 escritas se perdem quando o primário morre, as escritas falham por 30 s (disponibilidade ≈ 90,6%), e após a promoção um único nó carrega leituras e escritas, então o p99 de escrita chega a ≈ 375 ms. A solução possível — 2 shards, 2 seguidores cada, quorum, failover de 5 s — passa com 0 escritas perdidas, disponibilidade ≈ 99,2% e p99 de escrita ≈ 34 ms; mas a conta do banco vai de 900 para 2 700 USD/mês (2 shards × 3 nós × 450).
- **Relacionado:** [Bancos de dados](../../2027.1/classes/databases/index.md) · [Confiabilidade](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="db-failover" data-mode="compact" data-height="420"></div>

??? question "Perguntas para discutir"

    1. Escritas perdidas ≈ taxa de escrita × atraso: estime-as pelo inspetor logo antes de t = 90 s.
    2. Com um seguidor lento, por que o sync sofre e o quorum com 2 seguidores não?
    3. RPO 0 e RTO de 5 s triplicam a conta do banco: para que dados vale a pena (pedidos, sessões, analytics)?
