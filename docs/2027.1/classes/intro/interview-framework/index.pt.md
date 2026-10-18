
*"Projete um sistema de venda de ingressos como a BoxOffice. Você tem 45 minutos."* O enunciado tem uma frase de propósito. Não existe uma única resposta correta, nem uma bateria de testes escondida, e o entrevistador não vai dizer o que fazer em seguida. O que ele avalia é **como você sai de uma frase vaga e chega a um design defensável**: as perguntas que você faz, os números que estima, a estrutura que impõe e como raciocina sobre trade-offs quando ele contesta[^1].

Sem um método, 45 minutos somem rápido: 20 minutos no esquema do banco e depois o pânico para desenhar o resto. Esta página apresenta um **método de sete passos** com orçamento de tempo, aplica-o de ponta a ponta à BoxOffice e lista o que os entrevistadores procuram em cada passo. O mesmo método é útil fora das entrevistas — ele é o esqueleto de uma boa revisão de design ou de um documento de design.

---

## O que o entrevistador procura

Os entrevistadores normalmente pontuam algumas dimensões, com nomes diferentes em cada empresa, mas conteúdo parecido[^1][^2]:

| Sinal | Como aparece na prática |
|---|---|
| **Navegação do problema** | faz perguntas de esclarecimento; delimita o problema; identifica o que é difícil *neste* problema |
| **Design da solução** | um design de alto nível que funciona, cobre os requisitos e usa componentes adequados |
| **Profundidade técnica** | consegue se aprofundar nas partes críticas: modelo de dados, consistência, escala, tratamento de falhas |
| **Raciocínio sobre trade-offs** | apresenta alternativas, compara-as com números, diz do que abre mão |
| **Comunicação** | pensa em voz alta, conduz a sessão, organiza o quadro, adapta-se ao feedback |

As expectativas crescem com a senioridade. Um guia aproximado:

| Nível | Esperado |
|---|---|
| **Estágio / júnior** | um design de alto nível razoável, com orientação; conhece os principais componentes e o que fazem |
| **Pleno** | conduz o design inteiro; aprofunda-se em uma ou duas áreas; encontra o gargalo principal |
| **Sênior em diante** | conduz *e* prioriza: encontra rápido as partes mais difíceis, aprofunda-se com números, antecipa modos de falha, operação e custo, e discute a evolução |

---

## O método num relance

| # | Passo | Tempo (45 min) | Resultado no quadro |
|---|---|---|---|
| 1 | **Esclarecer os requisitos** | 0–5 min | lista funcional (3–5 itens) + metas não funcionais |
| 2 | **Estimar** | 5–10 min | requisições/s (média e pico), armazenamento, banda — e o que implicam |
| 3 | **API e modelo de dados** | 10–15 min | 4–6 endpoints; entidades principais com suas chaves |
| 4 | **Design de alto nível** | 15–25 min | diagrama de caixas e setas cobrindo todo requisito funcional |
| 5 | **Aprofundamentos** (*deep dives*) | 25–37 min | detalhes das 1–3 partes mais difíceis |
| 6 | **Gargalos e trade-offs** | 37–42 min | o que quebra primeiro, como corrigir, quanto custa cada escolha |
| 7 | **Fechamento** | 42–45 min | resumo, pontos em aberto, como evolui |

Os tempos são um orçamento, não uma lei: se o entrevistador quiser passar 15 minutos num aprofundamento, acompanhe-o. Mas confira o relógio em cada transição — acabar o tempo antes de desenhar um design de alto nível completo é a forma mais comum de ser reprovado.

``` mermaid-sim
sequenceDiagram
    participant C as Candidato
    participant I as Entrevistador
    I->>C: "Projete a BoxOffice"
    C->>I: 1. Perguntas de esclarecimento (usuários, escala, consistência, escopo)
    I-->>C: respostas / "você decide"
    C->>C: 2. Estima em voz alta
    C->>I: 3. Propõe API e modelo de dados
    C->>I: 4. Desenha o design de alto nível
    I-->>C: "Como você evita venda duplicada?"
    C->>I: 5. Aprofundamento (com alternativas)
    I-->>C: "E se o tráfego crescer 10×?"
    C->>I: 6. Gargalos e trade-offs
    C->>I: 7. Fechamento: resumo e próximos passos
```

Repare nas setas que vêm do entrevistador: aprofundamentos e gargalos muitas vezes são **conduzidos** pelas perguntas dele. Trate cada pergunta como uma dica sobre o que ele quer avaliar, não como um ataque.

---

## Passo 1 — Esclarecer os requisitos (≈ 5 min)

**Objetivo**: transformar o enunciado de uma frase num problema com limites. Pergunte e **escreva as respostas no quadro**.

- *Usuários e escala*: quantos usuários, usuários ativos por dia, eventos de pico?
- *Funcionalidades principais*: quais 3–5 devo projetar? O que está fora do escopo?
- *Mistura de leitura/escrita e padrões de acesso*: dominado por leituras ou por escritas? Em picos?
- *Consistência*: o que nunca pode estar errado? O que pode estar desatualizado?
- Expectativas de *latência e disponibilidade*; alguma regulação (pagamentos, dados pessoais)?

!!! example "BoxOffice — passo 1"

    **Funcionais** (no escopo): navegar/buscar eventos; ver o mapa de lugares; reservar lugares (expira em 10 min); pagar via provedor externo; receber o ingresso. *Fora do escopo*: revenda, preço dinâmico, ferramentas do organizador além de criar eventos.

    **Não funcionais**: 20 M de fãs cadastrados, 2 M ativos por dia; grandes aberturas de vendas com **2 M de fãs para 60 mil lugares** no primeiro minuto; **nenhuma venda duplicada, jamais**; o catálogo pode ter ~1 min de atraso; reserva p99 < 300 ms; checkout disponível 99,95%.

    *"Então a parte interessante é a abertura de vendas: um pico enorme de disputa sobre um inventário pequeno e com consistência forte. Vou concentrar o design aí, pode ser?"*

Essa última frase importa: dizer **o que é difícil neste problema** demonstra navegação do problema e avisa o entrevistador onde você vai gastar o tempo de aprofundamento.

## Passo 2 — Estimar (≈ 5 min)

**Objetivo**: obter ordens de grandeza que **mudem decisões**. Arredonde sem dó e diga a conclusão, não só a aritmética. A [aula 2](../../estimation/index.md) ensina o método; numa entrevista, soa assim:

!!! example "BoxOffice — passo 2"

    - *Dia normal*: 2 M de fãs × 20 páginas = 40 M de leituras/dia ≈ 40 M / 10⁵ s ≈ **400 leituras/s**, pico ×3 ≈ **1.200 leituras/s**. Pedidos: 100 mil/dia ≈ **1 escrita/s**. Dominado por leituras: **cache no catálogo**.
    - *Abertura de vendas*: 2 M de fãs em 60 s ≈ **33 mil chegadas/s**, cada uma atualizando algumas vezes ≈ **100 mil+ req/s** na borda. Só há 60 mil lugares ⇒ no máximo 60 mil pedidos bem-sucedidos. *"O inventário não aguenta 100 mil req/s nas mesmas linhas — preciso de uma sala de espera que admita alguns milhares por segundo."*
    - *Armazenamento*: pedidos 100 mil/dia × 1 KB ≈ 100 MB/dia ≈ **40 GB/ano** — cabe num primário PostgreSQL por anos; **não é preciso sharding para os pedidos**. Linhas de lugares por evento ≤ 100 mil × 100 B ≈ 10 MB — minúsculo, mas **quente**.

Duas decisões saíram de quatro linhas de aritmética: um cache para o catálogo e uma sala de espera para o inventário. É para isso que se estima.

## Passo 3 — API e modelo de dados (≈ 5 min)

**Objetivo**: tornar os requisitos funcionais concretos. Liste os principais endpoints (ou mensagens) e as principais entidades com suas chaves. Não escreva todos os campos — só o suficiente para raciocinar sobre padrões de acesso e consistência.

```http
GET  /events?q=&city=&date=           search and browse (cacheable)
GET  /events/{eventId}/seats          seat map with availability
POST /events/{eventId}/holds          { seatIds }        → { holdId, expiresAt }
POST /orders                          { holdId }         → { orderId, paymentUrl }
POST /payments/webhook                provider → BoxOffice: paid | declined
GET  /orders/{orderId}                status and tickets
```

| Entidade | Chave | Campos principais | Armazenamento |
|---|---|---|---|
| `event` | `event_id` | nome, local, data, horário de abertura das vendas | SQL (catálogo), em cache |
| `seat` | (`event_id`, `seat_id`) | setor, fileira, preço, **status** (livre / reservado / vendido), `hold_id`, `version` | SQL (inventário) |
| `hold` | `hold_id` | `fan_id`, `event_id`, lista de lugares, `expires_at` | SQL (inventário) |
| `order` | `order_id` | `fan_id`, `hold_id`, valor, status, **chave de idempotência** | SQL (pedidos) |
| `ticket` | `ticket_id` | `order_id`, lugar, QR code | SQL / Object Store (PDF) |

Mencione o padrão de acesso ao lado de cada entidade: o mapa de lugares é lido por `event_id`; reservas alteram alguns lugares de um evento; pedidos são lidos por `fan_id`. Esses padrões definem os índices e, mais tarde, as chaves de partição.

## Passo 4 — Design de alto nível (≈ 10 min)

**Objetivo**: um diagrama que atenda **todo requisito funcional** de ponta a ponta. Comece simples e acrescente o que as estimativas pedirem. Percorra uma requisição de cada vez enquanto desenha ("o fã abre a página do evento: CDN, gateway, catalog, cache…").

``` mermaid-sim
flowchart LR
    fan([Fã]) --> cdn["CDN<br/>estáticos + imagens"]
    fan --> gw["API Gateway<br/>auth, rate limit"]
    gw --> catalog["catalog"]
    catalog --> cache[("Cache")]
    cache --> catdb[("SQL do catálogo<br/>+ réplicas")]
    gw --> wr["Sala de espera"]
    wr --> inventory["inventory"]
    inventory --> invdb[("SQL do inventário<br/>primário")]
    inventory --> order["order"]
    order --> psp["Provedor de pagamento"]
    psp -->|webhook| order
    order --> stream["Event stream"]
    stream --> notification["notification"]
    stream --> search["search"]
```

!!! tip "Desenhe primeiro o caminho feliz"

    Desenhe os componentes necessários ao fluxo principal, rotule as setas (chamada síncrona, mensagem assíncrona, replicação) e só depois decore (réplicas, caches, monitoramento). Um entrevistador não consegue avaliar um aprofundamento num design que ele ainda não viu por inteiro.

## Passo 5 — Aprofundamentos (≈ 12 min)

**Objetivo**: mostrar profundidade técnica nas **1–3 partes mais difíceis**. Escolha-as você mesmo (as que nomeou no passo 1) ou siga o entrevistador. Para cada uma: enuncie o problema, apresente **duas ou três alternativas**, compare-as, escolha.

!!! example "BoxOffice — aprofundamento 1: nunca vender um lugar duas vezes"

    *Problema*: milhares de fãs tentam reservar os mesmos lugares ao mesmo tempo.

    | Opção | Como | Trade-off |
    |---|---|---|
    | Lock pessimista | `SELECT … FOR UPDATE` nas linhas dos lugares, dentro de uma transação | simples e correto; os locks formam fila sob disputa |
    | **Update condicional** (otimista) | um único `UPDATE … WHERE status = 'FREE'` atômico; conferir o número de linhas | sem locks longos; quem perde apenas tenta outros lugares |
    | Lock distribuído (Redis) | lock por lugar no Redis, depois escrita no SQL | componente extra, e dois sistemas precisam concordar — evite quando o banco consegue fazer sozinho |

    *Escolha*: update condicional no banco do inventário — o banco é a fonte única da verdade, e o verificar-e-gravar é uma única instrução atômica:

    ```sql
    UPDATE seat
       SET status = 'HELD', hold_id = :holdId, version = version + 1
     WHERE event_id = :eventId
       AND seat_id IN (:seatIds)
       AND status = 'FREE';
    -- rows updated = number requested → hold created; otherwise roll back and answer 409
    ```

    Reservas expiradas são liberadas por um job agendado (`status = 'HELD' AND expires_at < now()`), ou de forma preguiçosa, na hora da leitura.

!!! example "BoxOffice — aprofundamento 2: o pico das 10:00"

    A sala de espera admite fãs no ritmo que o inventário aguenta. Se uma reserva leva 5 ms de tempo de banco num evento quente e o banco roda ~8 delas em paralelo de forma produtiva, o inventário conclui cerca de 8 / 0,005 = **1.600 reservas/s** a plena utilização — digamos **~1.000/s** para manter a latência baixa (a aula 2 explica por quê). Com ~2 lugares por fã, 60 mil lugares precisam de ~30 mil fãs bem-sucedidos: cerca de **30 s** de admissões. Os outros ~2 M de fãs esperam na fila, e a sala de espera avisa o quanto antes que os ingressos esgotaram. A página do evento é pré-aquecida no cache e na CDN *antes* das 10:00 para evitar um estouro de cache frio.

!!! example "BoxOffice — aprofundamento 3: pagar exatamente uma vez"

    O fã clica em "pagar" duas vezes, ou a rede perde a resposta e o cliente tenta de novo. Cada `POST /orders` leva uma **chave de idempotência**; o serviço de pedidos a guarda com uma restrição de unicidade e devolve o pedido já existente para uma chave repetida. O webhook do provedor de pagamentos também pode chegar duas vezes — o tratador é idempotente pelo id da transação do provedor.

## Passo 6 — Gargalos e trade-offs (≈ 5 min)

**Objetivo**: criticar o próprio design antes que o entrevistador o faça. Percorra o diagrama e pergunte, para cada componente: *o que quebra primeiro? qual é o ponto único de falha? o que acontece se ele ficar lento?*

| Preocupação | Mitigação | Custo da mitigação |
|---|---|---|
| Evento quente = linhas quentes num único banco | sala de espera; lugares de um evento numa partição (sharding por `event_id` entre eventos) | atraso de fila para os fãs |
| Provedor de pagamento lento ou fora do ar | timeout + circuit breaker; reserva estendida enquanto o pagamento está pendente | complexidade; lugares presos por mais tempo |
| Estouro do cache do catálogo às 10:00 | pré-aquecimento; agrupamento de requisições (*request coalescing*) | mais peças móveis |
| Falha do primário do inventário | standby síncrono + failover automático | latência de escrita; alguns segundos de indisponibilidade |
| Robôs | WAF, rate limit por fã/cartão, CAPTCHA na entrada da fila | atrito para os fãs de verdade |

Depois, nomeie os principais trade-offs **explicitamente**: *"Escolhi consistência forte para os lugares em vez de disponibilidade: se o primário do inventário estiver inacessível, as reservas falham em vez de arriscar uma venda duplicada. O catálogo é o oposto: aceito 60 s de atraso em troca de velocidade."*

## Passo 7 — Fechamento (≈ 3 min)

**Objetivo**: deixar uma imagem final clara. Em três ou quatro frases: o que você projetou, como cumpre os requisitos principais, o que faria a seguir com mais tempo (monitoramento e alertas de SLO, multi-região, o assistente de IA…) e quaisquer perguntas em aberto. Não introduza componentes novos agora.

---

## Como se comunicar

A estrutura acima é necessária, mas não suficiente. Estes hábitos fazem a diferença[^3]:

- **Pense em voz alta.** O silêncio é o pior sinal; diga o que está considerando e por quê, mesmo sem certeza.
- **Primeiro amplo, depois fundo.** Um design simples e completo vale mais que meio design perfeito.
- **Declare as premissas.** "Vou assumir 2 M de fãs por dia; me avise se estiver fora."
- **Use o quadro como memória.** Requisitos num canto, números noutro, diagrama no meio — volte a eles.
- **Acolha a contestação.** "Bom ponto — se o provedor ficar fora uma hora, as reservas expiram; deixa eu rever isso." Mudar de ideia com um motivo é um sinal forte.
- **Conduza.** Anuncie as transições: "Tenho o design de alto nível; queria me aprofundar no problema da venda duplicada e depois no pico."
- **Quantifique os trade-offs.** "Isto acrescenta ~1 ms por requisição, mas reduz a carga no banco em 10×."

!!! tip "Na entrevista"

    Memorize os sete passos e seu orçamento de tempo, e **diga-os em voz alta no começo**: "Vou esclarecer os requisitos, fazer algumas estimativas rápidas, esboçar a API e os dados, desenhar um design de alto nível, depois me aprofundar nas partes mais difíceis e discutir gargalos." O entrevistador sabe na hora que você tem um plano — e você tem uma lista de verificação para quando o nervosismo bater.

### Praticando com o playground

O [playground](../../../../playground/index.md) é um bom parceiro de treino para os passos 4–6. Depois de projetar um problema no papel, remonte seu design de alto nível a partir da paleta, rode o perfil de carga que corresponde às suas estimativas (`spike` para uma abertura de vendas, `soak` para um serviço estável) e procure o primeiro componente saturado. Se não for o que você nomeou no passo 6, descubra por quê. Os [problemas para praticar](../../../support/interview/problems/index.md) e o [guia de entrevista simulada](../../../support/interview/mock/index.md) foram organizados para uso em duplas: um candidato, um entrevistador, depois troquem.

!!! warning "Armadilhas comuns"

    - **Pular direto para o design** sem esclarecer — resolvendo um problema que o entrevistador não pediu.
    - **Estimar por estimar** — números que não levam a nenhuma decisão desperdiçam minutos.
    - **Aprofundar cedo demais** — 20 minutos no esquema, sem tempo para a arquitetura.
    - **Arquitetura de buzzwords** — citar tecnologias sem dizer que problema cada uma resolve.
    - **Uma só opção** — um aprofundamento sem alternativas não mostra raciocínio sobre trade-offs.
    - **Defender cada decisão até o fim** — tratar dicas como ataques.
    - **Ignorar falhas** — um design que só funciona quando todos os componentes estão no ar.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    S1["1. Esclarecer<br/>→ Requisitos"] --> S2["2. Estimar<br/>→ Estimativa"]
    S2 --> S3["3. API e modelo de dados<br/>→ Compute, Bancos de dados"]
    S3 --> S4["4. Design de alto nível<br/>componentes da paleta"]
    S4 --> S5["5. Aprofundamentos"]
    S5 --> S6["6. Gargalos<br/>e trade-offs"]
    S6 --> S7["7. Fechamento"]
    S5 --> D1["sem venda duplicada<br/>update condicional no sql"]
    S5 --> D2["o pico das 10:00<br/>fila da sala de espera"]
    S5 --> D3["pagar exatamente uma vez<br/>idempotency key, webhook"]
    S6 --> PG["ensaie no playground<br/>→ Estudos de caso"]
```

**Componentes da paleta** do design de alto nível da BoxOffice: [`cdn`](../../../reference/components/edge/index.md#cdn) (arquivos estáticos e imagens) · [`apigw`](../../../reference/components/edge/index.md#apigw) (autenticação, rate limit) · [`app`](../../../reference/components/compute/index.md#app) (`catalog`, `inventory`, `order`) · [`cache`](../../../reference/components/storage/index.md#cache) (catálogo) · [`sql`](../../../reference/components/storage/index.md#sql) (primário do inventário, réplicas do catálogo) · [`queue`](../../../reference/components/messaging/index.md#queue) (sala de espera) · [`payment`](../../../reference/components/external/index.md#payment) (provedor e webhook) · [`stream`](../../../reference/components/messaging/index.md#stream) (eventos para `notification` e `search`) · [`waf`](../../../reference/components/edge/index.md#waf) (bots). **Cenários:** `flash-sale`, `payment-system`, `url-shortener` (um primeiro problema de prática). **Continua em:** [Estudos de caso](../../case-studies/index.md), [Ingressos — a venda relâmpago da BoxOffice](../../case-studies/ticketing/index.md), [Bancos de dados — o bug da venda duplicada](../../databases/transactions/index.md#double-booking), [Compute — idempotency keys](../../compute/integrations/index.md#idempotency-keys), [Preparação para entrevista — método](../../../support/interview/framework/index.md).

## Pontos-chave

- A entrevista de system design avalia o **processo**: navegação, design, profundidade, trade-offs e comunicação.
- Use sete passos com orçamento de tempo: **esclarecer → estimar → API e modelo de dados → design de alto nível → aprofundamentos → gargalos e trade-offs → fechamento**.
- O esclarecimento deve terminar com **o que é difícil neste problema** — é para lá que vão seus aprofundamentos.
- Estimativas existem para **mudar decisões** (cache? shard? fila?).
- Aprofundamentos comparam **alternativas** e escolhem; o fechamento resume e aponta os próximos passos.

---

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Chapter 3 (a framework for system design interviews).
[^2]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2. Byte Code LLC, 2022.
[^3]: McDOWELL, G. L. *Cracking the Coding Interview*, 6th ed. CareerCup, 2015. Chapter 9 (system design and scalability).
