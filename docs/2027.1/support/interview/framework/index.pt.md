# O framework da entrevista

Uma entrevista de system design é um problema aberto com um relógio. Sem estrutura, é fácil gastar vinte minutos no esquema do banco e nunca chegar à parte que interessava ao entrevistador. O framework abaixo é uma sequência de sete passos, cada um com um objetivo, um tempo, frases para dizer e um modelo que você pode esboçar no quadro. É o mesmo framework ensinado na [Aula 1 · Framework de entrevista](../../../classes/intro/interview-framework/index.md) e seguido por todos os [estudos de caso](../../../classes/case-studies/ticketing/index.md); aqui ele está escrito como um checklist para ensaiar.

Ao longo da página, o exemplo é a pergunta da [página inicial](../index.md): *"Projete um site de ingressos para um show num estádio. A venda abre sábado às 10:00."* — a venda relâmpago do BoxOffice, com **2 milhões de fãs** para **60.000 assentos**.

!!! note "Os modelos ficam em inglês"
    Os modelos dos blocos de texto estão em inglês de propósito: é a língua em que a maioria das entrevistas de system design acontece, e o vocabulário (QPS, p99, idempotency key) é o mesmo em português. Copie-os assim e preencha em qualquer língua.

``` mermaid
flowchart LR
    A[1. Esclarecer<br/>~5 min] --> B[2. Estimar<br/>~5 min]
    B --> C[3. API e modelo de dados<br/>~5 min]
    C --> D[4. Design de alto nível<br/>~10 min]
    D --> E[5. Aprofundamentos<br/>~12 min]
    E --> F[6. Gargalos e trade-offs<br/>~5 min]
    F --> G[7. Fechamento<br/>~3 min]
    E -.novo requisito ou preocupação.-> A
```

## Tempos

| Passo | Entrevista de 45 minutos | Entrevista de 60 minutos | Resultado no quadro |
|---|---|---|---|
| 1. Esclarecer os requisitos | 5 min | 6–8 min | Lista curta de requisitos funcionais e não funcionais; o que fica fora |
| 2. Estimar | 5 min | 5–7 min | QPS de pico, proporção leitura/escrita, armazenamento, o número decisivo |
| 3. API e modelo de dados | 5 min | 6–8 min | 3–6 endpoints ou eventos; entidades centrais com suas chaves |
| 4. Design de alto nível | 10 min | 12–15 min | Um diagrama, uma leitura e uma escrita percorridas |
| 5. Aprofundamentos | 12 min | 15–18 min | Um ou dois componentes em profundidade |
| 6. Gargalos e trade-offs | 5 min | 5–7 min | O que quebra primeiro, pontos únicos de falha, o que você trocou |
| 7. Fechamento | 3 min | 3–5 min | Resumo em quatro frases e próximos passos |

!!! tip "Quem administra o relógio é você"
    Olhe o relógio a cada transição. Se você está no minuto 20 e ainda no passo 3, diga isso e comprima: *"Vou manter o modelo de dados curto para sobrar tempo para a parte difícil."* Entrevistadores raramente penalizam um atalho deliberado; penalizam nunca chegar ao aprofundamento. Cinco minutos antes do fim, feche, mesmo que o entrevistador ainda esteja perguntando.

---

## 1. Esclarecer os requisitos

**Objetivo.** Transformar um enunciado de uma linha num problema com fronteiras: quem usa, para quê, em que escala, e o que nunca pode dar errado. Tudo o que vem depois deste passo se justifica por algo escrito aqui.

**O que dizer.**

- "Antes de desenhar qualquer coisa, gostaria de definir o escopo. Posso fazer algumas perguntas?"
- "Vou me concentrar nestas três funcionalidades; deixo X e Y de fora, a menos que você queira."
- "Então o requisito mais difícil é… — isso bate com o que você tinha em mente?"

**Perguntas a fazer.**

- Usuários e funcionalidades: quem são os usuários? Quais são as 3–5 ações centrais? O que está explicitamente fora do escopo?
- Escala: quantos usuários (ativos por dia, simultâneos no pico)? Quanto dado? Crescimento nos próximos anos?
- Forma de leitura/escrita: dominado por leituras ou por escritas? Há picos (uma venda, um jogo, um lançamento)?
- Consistência: o que nunca pode estar errado (dinheiro, estoque, permissões)? O que pode ficar alguns segundos desatualizado?
- Latência e disponibilidade: quão rápida precisa ser a ação principal (p99)? Que disponibilidade se espera?
- Restrições: regiões, regulação (dados pessoais), orçamento, sistemas existentes, tamanho do time.

```text
REQUIREMENTS
Functional (in scope):
  1. ...
  2. ...
  3. ...
Out of scope: ...
Non-functional:
  Scale:        DAU = ..., peak concurrent = ..., data = ...
  Latency:      p99 of <main action> < ... ms
  Availability: ... % (which paths?)
  Consistency:  strong for ..., eventual for ...
  Durability:   never lose ...
  Other:        security / privacy / cost / regions
The hard part (one sentence): ...
```

!!! warning "Erros comuns"
    - Desenhar no primeiro minuto e depois descobrir que o sistema é dominado por escritas.
    - Fazer vinte perguntas e nunca se comprometer: depois de 5 minutos, *declare* suposições e siga em frente.
    - Esquecer os requisitos não funcionais — são eles que tornam o design interessante.
    - Não escrever os requisitos: você vai precisar deles no passo 6 para justificar os trade-offs.

!!! example "Venda relâmpago do BoxOffice — passo 1"
    - **Funcionais:** ver a página do evento e o mapa de assentos; segurar um ou mais assentos por alguns minutos; pagar; receber o ingresso por e-mail e no app.
    - **Fora do escopo:** revenda, gestão do estádio, recomendações.
    - **Não funcionais:** 2 M de fãs chegam por volta das 10:00 para 60 mil assentos; o site precisa ficar de pé e ser justo (ordem de chegada, bots bloqueados); **um assento nunca é vendido duas vezes**; segurar um assento deve parecer instantâneo (p99 abaixo de ~500 ms depois da admissão); a página do evento pode ficar alguns segundos desatualizada.
    - **A parte difícil:** um pico enorme de disputa sobre um estoque pequeno e fortemente consistente — não o volume de dados.

---

## 2. Estimar

**Objetivo.** Pôr ordens de grandeza nos requisitos para que cada escolha posterior tenha um número por trás. Você não está fazendo um orçamento; está encontrando **o número, ou os dois números, que decidem o design**.

**O que dizer.**

- "Vou fazer uma estimativa rápida de guardanapo; vou arredondar sem medo."
- "Um dia tem cerca de 10⁵ segundos, então 10 milhões de requisições por dia dão umas 100 por segundo em média."
- "O número que importa aqui é…, porque significa que precisamos de…"

**Perguntas a se fazer.**

- Requisições por segundo, média e **pico** (fator de pico de 2–10× para tráfego normal; muito mais numa venda relâmpago).
- Proporção leitura/escrita; quanto pesa cada escrita (bytes).
- Armazenamento por dia/ano (e com replicação ×3); banda de entrada e de saída.
- Concorrência pela Lei de Little: requisições em andamento = taxa × tempo.
- O limite de qual componente está mais perto desses números? (Veja a [folha de números](../../../reference/numbers/index.md).)

```text
ESTIMATION (round to powers of 10)
Users:      DAU = ...            peak concurrent = ...
Requests:   per user per day = ...
            avg QPS = DAU x req/user / 1e5 = ...
            peak QPS = avg x peak factor (...) = ...
Read:write  = ... : ...          write QPS = ...
Storage:    item size = ... B    items/day = ...
            per year = ... (x3 replicas = ...)
Bandwidth:  peak QPS x response size = ... MB/s
Concurrency (Little): peak QPS x latency = ... in flight
Deciding number(s): ...  =>  implication: ...
```

!!! warning "Erros comuns"
    - Gastar dez minutos com aritmética precisa. Um algarismo significativo basta.
    - Estimar a média e projetar para ela: dimensione sempre para o pico.
    - Números que nunca influenciam uma decisão. Se uma estimativa não muda o design, pule-a.
    - Esquecer de dizer as suposições em voz alta, e assim o entrevistador não pode corrigi-las.

!!! example "Venda relâmpago do BoxOffice — passo 2"
    - **Fãs por assento:** 2.000.000 ÷ 60.000 ≈ **33**. A maioria dos fãs não vai conseguir ingresso: justiça e um "esgotado" claro importam.
    - **Pico de leitura (≈ ilustrativo):** 2 M de fãs atualizando a cada ~10–20 s nos primeiros minutos ⇒ da ordem de **10⁵ requisições por segundo**, quase todas para a mesma página de evento e o mesmo mapa de assentos.
    - **Pico de escrita (≈ ilustrativo):** 60 mil assentos reservados em poucos minutos ⇒ da ordem de **10³ reservas por segundo** — pouco, mas todas disputam as mesmas linhas.
    - **Armazenamento:** 60 mil pedidos × ~1 KB ≈ 60 MB por show — irrelevante.
    - **Números decisivos:** um pico de leitura de 100.000 req/s (⇒ CDN e cache) e ~1.000 escritas disputadas por segundo num único evento (⇒ uma sala de espera e reservas atômicas de assentos).

---

## 3. API e modelo de dados

**Objetivo.** Tornar o design concreto: as principais operações que os clientes chamam (ou os eventos que os serviços trocam) e as entidades com suas chaves e padrões de acesso. Os padrões de acesso escolhem o banco; as operações que mexem com dinheiro ou estoque ganham **chaves de idempotência**.

**O que dizer.**

- "Estas são as quatro chamadas de que o cliente precisa; a que importa é…"
- "Esta chamada altera o estoque, então recebe uma chave de idempotência — um retry não pode segurar um segundo assento."
- "O padrão de acesso principal é 'todos os assentos de um evento por setor', então a chave da tabela começa pelo evento."

**Perguntas a se fazer.**

- Quais chamadas são leituras e quais são escritas? Quais precisam ser síncronas?
- Quais são as chaves e a consulta principal de cada entidade? Qual precisa de transações?
- Paginação (por cursor), versionamento, autenticação em cada chamada.

```text
API (REST; auth = bearer token)
GET  /events/{id}                       -> event page (cacheable)
GET  /events/{id}/seats?section=...     -> seat map (short TTL cache)
POST /holds         {eventId, seatIds}  Idempotency-Key: ...  -> holdId, expiresAt
POST /orders        {holdId, payment}   Idempotency-Key: ...  -> orderId, status
GET  /orders/{id}                       -> status (PENDING/CONFIRMED/FAILED)
Webhook: POST /payments/webhook (signed by the provider)

DATA MODEL
Entity      Key                 Main access pattern          Store / consistency
event       event_id            read by id                   SQL + cache, eventual OK
seat        (event_id, seat_id) by event + section; hold     SQL, strong (transactions)
order       order_id            by id; by user_id            SQL, strong
...
```

!!! warning "Erros comuns"
    - Projetar vinte endpoints. Mostre os 3–6 que carregam os fluxos centrais.
    - Escolher o banco antes de escrever os padrões de acesso.
    - Esquecer a idempotência nas escritas que podem ser repetidas (reservas, pedidos, pagamentos).
    - Paginação por offset em listas grandes que mudam (use cursores).

!!! example "Venda relâmpago do BoxOffice — passo 3"
    As quatro chamadas acima são todo o fluxo de compra. As linhas de `seat` ficam no PostgreSQL com chave primária `(event_id, seat_id)`, um `status` (`free`, `held`, `sold`), `hold_until` e `order_id`. `POST /holds` recebe uma chave de idempotência para que um clique duplo ou um retry do cliente devolva a mesma reserva. `order` guarda a chave de idempotência do pagamento enviada ao provedor. Os dados de eventos e locais são quase só lidos e vão para o cache.

---

## 4. Design de alto nível

**Objetivo.** Um diagrama que atenda a todos os requisitos funcionais de ponta a ponta, com o fluxo de dados rotulado. Mantenha-o simples; você vai melhorá-lo nos aprofundamentos. Percorra **uma leitura e uma escrita** em voz alta.

**O que dizer.**

- "Vou começar simples e depois evoluir: clientes, borda, serviços, armazenamento, trabalho assíncrono."
- "Este é o caminho de uma requisição de reserva…" (siga-a pelas caixas).
- "Esta caixa é um ponto único de falha por enquanto; volto a ela no passo 6."

**Perguntas a se fazer.**

- Quais requisições param na borda (CDN, cache) e quais chegam aos serviços?
- O que é síncrono (o usuário espera) e o que vai para trás de uma fila?
- Onde está a fonte da verdade de cada entidade?

```text
HIGH-LEVEL CHECKLIST
[ ] Clients -> DNS -> CDN (static, cacheable pages)
[ ] Edge: WAF / API gateway (auth, rate limit) -> load balancer
[ ] Stateless services (which ones? what does each own?)
[ ] Source of truth per entity (SQL / NoSQL / object store)
[ ] Caches (what, where, TTL)
[ ] Async: queue / event stream, consumers, what is eventual
[ ] External dependencies (payment, email, 3rd party)
[ ] One read and one write traced through the diagram
```

!!! warning "Erros comuns"
    - Vinte caixas com setas sem rótulo. Cada seta diz o que passa por ela.
    - Citar produtos em vez de papéis ("Kafka" antes de dizer por que você precisa de um log de eventos).
    - Esconder estado em servidores "sem estado" (sessões em memória).
    - Polir uma caixa antes de o fluxo inteiro funcionar.

!!! example "Venda relâmpago do BoxOffice — passo 4"
    Fãs → DNS → **CDN** para a página do evento e os assets → **WAF** (bots) → **API gateway** (autenticação JWT, rate limit por usuário) → load balancer → serviços sem estado: `catalog` (eventos, atrás de um **cache**), `inventory` (assentos, no **PostgreSQL**), `order`, `payment` (adaptador para o provedor externo), `notification` (e-mail, atrás de uma **fila**). O serviço `order` publica `OrderConfirmed` no **Kafka** por meio de um outbox; `notification`, `search` e `analytics` o consomem. *Caminho de leitura:* o mapa de assentos vem de um cache atualizado a cada segundo. *Caminho de escrita:* `POST /holds` vai para `inventory`, que atualiza as linhas dos assentos de forma atômica.

---

## 5. Aprofundamentos

**Objetivo.** Mostrar profundidade onde o problema é difícil. Escolha um ou dois componentes (ou deixe o entrevistador escolher) e entre em algoritmos, organização dos dados, consistência, tratamento de falhas e números. É aqui que acontece a maior parte da avaliação.

**O que dizer.**

- "A parte difícil deste problema é…, então eu gostaria de aprofundar ali. Pode ser?"
- "Há três jeitos de fazer isso: … Eu escolheria o segundo porque…"
- "Deixa eu conferir isso com números: …"

**Perguntas a se fazer.**

- Onde está a disputa, o fan-out, a chave quente ou a fronteira de consistência?
- O que acontece com a carga de pico, com uma dependência lenta, com um retry, com uma queda no meio da operação?
- Como você saberia que funciona (métricas, um teste de carga)?

```text
DEEP-DIVE CHECKLIST (for the chosen component)
[ ] Why this is the hard part (number from step 2)
[ ] 2-3 options, with the trade-off of each
[ ] Chosen option: algorithm / data layout / keys
[ ] Consistency: what is atomic, what is eventual, how conflicts are prevented
[ ] Capacity: load vs capacity, utilization below the knee
[ ] Failure: slow dependency, crash midway, duplicate request, hot key
[ ] Observability: the metric / trace that proves it works
```

!!! warning "Erros comuns"
    - Aprofundar a parte fácil (o frontend, a página de login).
    - Listar opções sem escolher nenhuma.
    - Um aprofundamento sem análise de falhas: "e se este nó morrer?" sempre vem.
    - Ignorar a dica do entrevistador apontando para um componente específico.

!!! example "Venda relâmpago do BoxOffice — passo 5"
    **Aprofundamento 1 — nunca vender um assento duas vezes.** Opções: (a) ler o status na aplicação e depois escrever — uma condição de corrida; (b) `SELECT … FOR UPDATE` numa transação — correto, mas segura locks de linha enquanto a transação está aberta; (c) um único update condicional atômico: `UPDATE seat SET status='held', hold_until=now()+interval '10 min', order_id=? WHERE event_id=? AND seat_id=? AND status='free'` — 1 linha atualizada significa que o fã conseguiu, 0 significa que outro conseguiu. Escolha (c): curto, o lock dura só o comando, e o banco garante o invariante. Um job de expiração libera as reservas cujo `hold_until` passou. Nunca mantenha uma transação aberta enquanto chama o provedor de pagamento.

    **Aprofundamento 2 — sobreviver às 10:00.** Uma **sala de espera virtual**: os fãs que chegam recebem uma posição (sorteada entre os presentes às 10:00, depois por ordem de chegada), e o gateway os admite no ritmo que `inventory` aguenta — digamos 2.000 por minuto —, emitindo um token de admissão assinado e de vida curta exigido por `POST /holds`. A Lei de Little dimensiona: 2.000 admitidos/min com ~5 min no fluxo de compra ⇒ ~10.000 fãs lá dentro ao mesmo tempo. A fila transforma um pico de 10⁵ req/s num fluxo constante que o banco aguenta; o custo é o tempo de espera, mostrado com honestidade pela posição na fila.

---

## 6. Gargalos e trade-offs

**Objetivo.** Dar um passo atrás e estressar o design: o que quebra primeiro com 10× a carga, onde estão os pontos únicos de falha, o que você trocou e como observaria e testaria. É aqui que você mostra julgamento.

**O que dizer.**

- "Com dez vezes a carga, a primeira coisa a quebrar é…, porque…"
- "Escolhi X em vez de Y porque…; o custo é…; eu revisaria se…"
- "Para ter confiança, eu faria um teste de carga com perfil de spike e observaria…"

**Perguntas a se fazer.**

- Qual componente está mais perto do limite (utilização perto do joelho)? Qual é ponto único de falha?
- O que acontece quando cada dependência externa fica lenta ou cai?
- Que consistência você relaxou, e o que o usuário vê por causa disso?
- Quanto custa, aproximadamente? O que você monitoraria (SLIs) e o que geraria alerta?

```text
TRADE-OFF STATEMENT
We chose <X> over <Y>
because <requirement / number from steps 1-2>.
The cost is <latency / consistency / money / complexity>,
which is acceptable because <...>.
We would revisit it if <condition>.

BOTTLENECK SWEEP
First to break at 10x: ...      fix: ...
Single points of failure: ...   fix: ...
Slow/down dependency: ...       containment: timeout / breaker / queue / fallback
Observability: SLIs = ...       alert on: burn rate of ...
How we'd test it: load profile ... / chaos experiment ...
```

!!! warning "Erros comuns"
    - "Escala" sem dizer o quê, até quanto e a que custo.
    - Apresentar um design sem fraquezas — todo design tem algumas; nomeá-las é o sinal.
    - Esquecer a operação: deploys, monitoramento, plantão, custo.
    - Ficar na defensiva quando o entrevistador encontra uma falha. Diga "bom ponto" e adapte.

!!! example "Venda relâmpago do BoxOffice — passo 6"
    - **O primeiro a quebrar:** o provedor de pagamento às 10:00 (cota externa, picos de latência) → timeout, circuit breaker, um estado `PENDING` no pedido com a reserva do assento estendida; a sala de espera admite menos fãs se o provedor ficar lento.
    - **Pontos únicos de falha:** o primário do PostgreSQL → standby síncrono em outra AZ com failover automático; o Redis → replicado, e o mapa de assentos pode recorrer a uma cópia um pouco mais antiga.
    - **Trade-offs:** consistência forte só para assentos e pedidos, eventual para todo o resto; a sala de espera troca a paciência do usuário por um sistema que fica de pé; o mapa pode mostrar como livre um assento que já está reservado (a chamada de reserva é a autoridade).
    - **Prova:** um teste de spike com k6 até o pico esperado e um game day em que o provedor de pagamento fica lento; SLIs: taxa de sucesso e p99 das reservas, disponibilidade do checkout; alertas de burn rate no checkout.

---

## 7. Fechamento

**Objetivo.** Deixar uma imagem clara: um resumo curto, os trade-offs principais e o que você faria com mais tempo. Terminar no horário.

**O que dizer.**

- "Resumindo: …"
- "As duas decisões que eu mais defenderia são… e o principal risco é…"
- "Com mais tempo, eu olharia…"

```text
WRAP-UP (4 sentences + next steps)
1. The problem in one line and the hard part: ...
2. The design in one line (edge -> services -> storage -> async): ...
3. The key decisions and their trade-offs: ...
4. The main risk and how we contain it: ...
Next with more time: multi-region / cost / abuse & security / analytics / evolution
```

!!! warning "Erros comuns"
    - Ficar sem tempo e sem resumo.
    - Introduzir componentes novos nos dois últimos minutos.
    - Repetir o percurso inteiro em vez das decisões.

!!! example "Venda relâmpago do BoxOffice — passo 7"
    "Construímos um fluxo de venda de ingressos para um show num estádio em que 2 milhões de fãs disputam 60.000 assentos às 10:00. A CDN e os caches absorvem o pico de leitura, uma sala de espera transforma a multidão num fluxo constante, e as reservas de assento são updates condicionais atômicos no PostgreSQL, então um assento nunca é vendido duas vezes. O pagamento passa por um adaptador idempotente com timeouts e circuit breaker, e a confirmação segue de forma assíncrona por um outbox e o Kafka até o e-mail e o analytics. O principal risco é o provedor de pagamento no pico; com mais tempo, eu acrescentaria um segundo provedor, uma segunda região para o caminho de leitura e um modelo de pontuação de bots no WAF."

### A arquitetura final

``` mermaid
flowchart LR
    F[Fãs: web e mobile] --> DNS --> CDN[CDN: página do evento, assets]
    CDN --> WAF[WAF + proteção contra bots]
    WAF --> GW[API Gateway: JWT, rate limit, admissão da sala de espera]
    GW --> WR[(Fila da sala de espera)]
    GW --> LB[Load Balancer]
    LB --> CAT[catalog]
    LB --> INV[inventory]
    LB --> ORD[order]
    CAT --> C[(Cache: eventos, mapa de assentos)]
    C --> DB[(PostgreSQL: assentos, pedidos)]
    INV --> DB
    ORD --> DB
    ORD --> PAY[adaptador de payment] --> PSP[Provedor de pagamento]
    PSP -.webhook.-> PAY
    ORD -->|outbox| K[Kafka]
    K --> NOT[notification] --> EM[Provedor de e-mail]
    K --> AN[analytics]
    K --> SR[search]
```

---

## Ensaie no playground

Ler o framework não é o mesmo que executá-lo sob pressão. O playground tem a venda relâmpago do BoxOffice pré-carregada: o design inicial falha às 10:00 de um jeito instrutivo.

!!! question "Experimente"
    Rode o cenário com o perfil de spike padrão e veja qual nó fica vermelho primeiro. Depois aplique os movimentos do passo 5, um de cada vez — coloque o catálogo atrás da CDN e de um cache, acrescente uma fila de sala de espera na frente de `inventory`, proteja a aresta do pagamento com timeout e circuit breaker — e rode de novo após cada mudança. Diga em voz alta, como numa entrevista, qual número cada mudança melhorou (p99, taxa de erros, custo).

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

## Para onde ir agora

- Pratique o framework nos [problemas para praticar](../problems/index.md), do aquecimento ao avançado.
- Execute-o com um colega usando o [protocolo de entrevista simulada](../mock/index.md) e a sua rubrica.
- Revise os números e as frases de cada componente na [referência rápida](../quick-reference/index.md).
- Leia a solução completa no [estudo de caso de ingressos](../../../classes/case-studies/ticketing/index.md) e a página da aula sobre o framework, [Aula 1 · Framework de entrevista](../../../classes/intro/interview-framework/index.md).
