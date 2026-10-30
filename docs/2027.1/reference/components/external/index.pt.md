# Externos { #external }

Componentes **externos** são serviços que você chama, mas não opera: uma API de terceiros, um provedor de pagamento, um provedor de e-mail. Muitas vezes são a parte mais lenta e menos previsível de uma requisição, têm seus próprios limites de taxa e suas quedas, e você não pode escalá-los nem consertá-los. Projetar em volta deles é sobretudo **contenção**: timeouts para que um provedor lento não segure suas threads, retries seguros porque são idempotentes, filas para que o usuário não espere por eles e conciliação, porque a visão deles sobre o mundo e a sua às vezes vão discordar.

No BoxOffice, `payment` é um adaptador em volta de um provedor de pagamento externo, `notification` envia os ingressos por um provedor de e-mail e `catalog` importa dados de eventos das APIs dos produtores.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [3rd Party API](#thirdparty) | A API de outra empresa: lenta, com limite de taxa, às vezes fora do ar — contenha-a | `thirdparty` |
| [Payment](#payment) | Um provedor de pagamento (cartão, Pix, carteiras): idempotência, webhooks, conciliação | `payment` |
| [Email](#email) | Um provedor de entrega de e-mail: assíncrono, atrás de uma fila, com regras de entregabilidade | `email` |

``` diagram
flowchart LR
    O[serviço order] -->|timeout + circuit breaker + chave de idempotência| PAY[Provedor de pagamento]
    PAY -.webhook: pagamento confirmado.-> WH[endpoint de webhook] --> O
    O -->|evento OrderConfirmed| Q[(Fila)] --> N[workers de notificação] --> EM[Provedor de e-mail]
    C[importador do catálogo] -->|com limite de taxa e cache| TP[API do produtor]
    R[job noturno de conciliação] --> PAY
    R --> DB[(Banco de pedidos)]
```

---

## 3rd Party API { #thirdparty }

**O que é.** Qualquer API operada por outra empresa da qual o seu sistema depende: mapas e geocodificação, verificação de identidade, frete, feeds de eventos de produtores, clima, provedores de LLM. Você recebe um contrato (documentação, um SLA se tiver sorte, limites de taxa, um preço por chamada) e nada mais: sem acesso às métricas deles, sem controle sobre os deploys deles.

**Quando usar.**

- Compre em vez de construir quando a capacidade não é o seu diferencial e o provedor a faz melhor (mapas, score de fraude, cálculo de impostos).
- Quando há efeitos regulatórios ou de rede que você não consegue reproduzir (bandeiras de cartão, verificação de identidade).

**Quando não usar (ou cuidado).**

- Num caminho síncrono voltado ao usuário, cada chamada externa soma sua latência **e** sua disponibilidade: 99,9% × 99,5% (provedor) ≈ 99,4% para a requisição inteira. Prefira chamadas assíncronas, cache ou pré-cálculo.
- Aprisionamento ao fornecedor: envolva o provedor numa interface sua (um adaptador) para poder trocá-lo ou acrescentar um segundo.
- Proteção de dados: o que você envia (dados pessoais) sai do seu controle; confira os contratos e minimize os campos.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência | ≈ 50–500 ms, com cauda longa (segundos) | ≈ ilustrativo; o playground usa mediana de ~150 ms com grande dispersão |
| Disponibilidade publicada | muitas vezes 99,9%–99,99% | A sua disponibilidade efetiva inclui o caminho de rede até ela |
| Limites de taxa | de dezenas a milhares de requisições por segundo por conta | Excedê-los devolve 429 com Retry-After |
| Timeout sugerido | um pouco acima do p99 do provedor | por exemplo, p99 de 800 ms ⇒ timeout ≈ 1 s (≈ ilustrativo) |

**Modos de falha.**

- **Respostas lentas** esgotam suas threads e se propagam para cima (o clássico cenário `cascading-failure`) → timeouts, circuit breaker, bulkhead (um pool separado por provedor).
- **Queda** → fallback (dados em cache, uma funcionalidade degradada, um segundo provedor), enfileirar o trabalho para depois.
- **Limite de taxa (429)** → limitar a taxa do lado do cliente abaixo da cota, backoff respeitando o Retry-After, lotes, cache.
- **Mudanças incompatíveis na API** → fixar versões, testes de contrato, acompanhar avisos de descontinuação.
- **Retry storms** que pioram a queda do provedor e fazem você ser bloqueado → backoff exponencial com jitter, orçamento de retries.

**No playground.** `thirdparty` é um nó externo de **chamada** com grande variância de latência (lognormal, mediana de 150 ms com `sigma` alto), uma cota do provedor `quota` (padrão 1.000 req/s; requisições acima dela falham com 429) e quedas aleatórias mais frequentes que as dos nós internos. Proteja a aresta que o chama com `timeoutMs`, `retries` com `backoff` `exp+jitter`, `circuitBreaker` e um `fallback`. Cenários: [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure), [`retry-storm`](../../../../playground/scenarios/index.md#retry-storm).

**Produtos reais.**

=== "AWS"

    - Não é uma categoria de produto: você *chama* terceiros a partir dos seus serviços. Peças úteis da AWS em volta deles: **Amazon API Gateway** / **AWS AppSync** para fazer proxy e cache, **Amazon EventBridge API destinations** para chamar APIs HTTP externas com limites de taxa e retries.

=== "GCP"

    - **Apigee** — gestão de APIs que faz proxy, cache e limite de taxa de APIs de saída e de entrada.
    - **Application Integration / Integration Connectors** — conectores gerenciados para APIs de SaaS comuns.

=== "Azure"

    - **Azure API Management** — proxy, cache e políticas na frente de APIs externas.
    - **Azure Logic Apps** — workflows com conectores para muitas APIs de SaaS.

=== "Código aberto"

    - **Resilience4j** (Java) — timeouts, retries, circuit breakers e bulkheads em volta das chamadas de cliente (Hands-on 9).
    - **Toxiproxy** — simula dependências lentas e falhando nos testes (Hands-on 9).
    - **WireMock** — simula APIs HTTP de terceiros nos testes.

!!! tip "Na entrevista"
    "Toda chamada a terceiros ganha um timeout logo acima do p99, um circuit breaker e um pool de threads próprio, e fica atrás de uma interface de adaptador; se o usuário não precisa da resposta na hora, eu movo a chamada para uma fila, para que o dia ruim do provedor não vire o nosso."

**Saiba mais:** [Computação › Integrações](../../../classes/compute/integrations/index.md) · [Confiabilidade › Padrões](../../../classes/reliability/patterns/index.md) · [Estimativas › Matemática da disponibilidade](../../../classes/estimation/availability-math/index.md) · [Hands-on 9](../../../hands-on/9/index.md)

---

## Payment { #payment }

**O que é.** Um provedor de serviços de pagamento (PSP) cobra cartões, carteiras e pagamentos instantâneos em seu nome e transfere o dinheiro para a sua conta. Você nunca guarda números de cartão: o provedor entrega ao navegador um formulário hospedado ou tokeniza o cartão, e o seu backend só vê um token. O fluxo usual tem duas metades: uma requisição **síncrona** para criar ou confirmar um pagamento (que pode devolver "pendente") e um **webhook assíncrono** do provedor com o status final (aprovado, recusado, reembolsado, contestado). No Brasil, os pagamentos instantâneos via **Pix** seguem o mesmo formato: você cria uma cobrança (um QR code) e a confirmação chega como notificação.

**Quando usar.**

- Sempre, quando há dinheiro de verdade: processar cartões por conta própria significa escopo PCI DSS, contratos com adquirentes e tratamento de fraude.
- O serviço `payment` do BoxOffice é um **adaptador**: ele esconde o provedor atrás de uma pequena API interna (`authorize`, `capture`, `refund`, tratador de webhook), para que o provedor possa ser trocado ou um segundo possa ser acrescentado.

**Quando não usar (ou cuidado).**

- Nunca trate um timeout como falha: a cobrança pode ter sido feita. Repita só com a **mesma chave de idempotência**, ou consulte o status do pagamento.
- Nunca confie no redirecionamento do navegador ("pagamento OK") como prova: confirme pelo webhook (verificando a assinatura) ou por uma consulta de status no servidor.
- Nunca mantenha uma transação de banco ou um lock de assento aberto enquanto espera o provedor: segure o assento com expiração (`hold_until`), chame o provedor e depois confirme.
- Nunca coloque dados de cartão em logs, eventos ou analytics.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência da autorização | ≈ 0,5–3 s, com cauda longa | ≈ ilustrativo; desafios do 3-D Secure acrescentam o tempo do usuário |
| Atraso do webhook | segundos, às vezes minutos; reenviado pelo provedor por horas ou dias | Webhooks podem chegar atrasados, duplicados ou fora de ordem |
| Tarifas | um percentual mais um valor fixo por transação | Varia por país, meio de pagamento e contrato — confira com o provedor |
| Retenção da chave de idempotência | em geral pelo menos 24 horas do lado do provedor | por exemplo, a Stripe documenta 24 h; confira o seu |
| Reserva do assento durante o pagamento | ≈ 5–15 min | Uma decisão de produto; o BoxOffice usa 10 min |

**Modos de falha.**

- **Cobrança em dobro** — o cliente ou o seu serviço repete após um timeout sem chave de idempotência → uma chave de idempotência por tentativa de pagamento (por exemplo, derivada do id do pedido), guardada com o resultado.
- **Webhook perdido**, ou que chega antes de a linha do pedido existir → guarde os webhooks primeiro e processe de forma idempotente; um job de **conciliação** compara diariamente (ou de hora em hora) os seus pedidos com o relatório do provedor.
- **Queda do provedor às 10:00** → circuit breaker, um estado "pagamento pendente" com a reserva do assento estendida, um segundo provedor para eventos críticos, comunicação clara.
- **Estados inconsistentes** — pago no provedor, mas o pedido foi cancelado localmente (ou o contrário) → uma saga com compensações (reembolsar, liberar o assento) e a conciliação como rede de segurança.
- **Fraude e chargebacks** → as ferramentas antifraude do provedor, limites de velocidade por usuário e por cartão, 3-D Secure.

**No playground.** `payment` é um nó externo de **chamada** com grande variância de latência (mediana de 400 ms), uma cota do provedor `quota` (padrão 500 req/s) e quedas aleatórias; o cenário `payment-system` mostra retries sem idempotência criando cobranças duplicadas, e o cenário `flash-sale` mostra o pagamento virando o gargalo quando a venda abre. Use `timeoutMs`, `retries` com `exp+jitter`, `circuitBreaker` e um `fallback` ("pagamento pendente") na aresta que vem de `order`. Cenários: [`payment-system`](../../../../playground/scenarios/index.md#payment-system), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure).

**Produtos reais.**

=== "AWS"

    - Provedores de nuvem não são processadores de pagamento. Você chama um PSP a partir dos seus serviços; o **AWS Payment Cryptography** existe para empresas que constroem a própria infraestrutura de pagamentos (operações de chaves no estilo HSM), não para lojistas como o BoxOffice.

=== "GCP"

    - O **Google Pay** é uma carteira que funciona por meio do seu PSP, não um processador que você integra sozinho. O Google Cloud não tem serviço de processamento de pagamentos para lojistas.

=== "Azure"

    - O Azure não tem serviço de processamento de pagamentos para lojistas; você integra um PSP a partir dos seus serviços.

=== "Código aberto"

    - O processamento de pagamentos em si nunca é auto-hospedado. Provedores reais: **Stripe**, **Adyen**, **PayPal / Braintree**, **Mercado Pago**, **PagSeguro (PagBank)** e o **Pix** por meio de PSPs e bancos brasileiros.
    - **Hyperswitch** (Juspay) — orquestração de pagamentos de código aberto que roteia entre vários PSPs.
    - Sandboxes e CLIs dos provedores (por exemplo, a **Stripe CLI** para encaminhar webhooks de teste) para desenvolvimento.

!!! tip "Na entrevista"
    "O pagamento passa por um adaptador com uma chave de idempotência por tentativa, timeout e circuit breaker; o status final vem de um webhook assinado processado de forma idempotente, o assento fica reservado com expiração em vez de lock, e um job de conciliação contra o relatório do provedor pega o que escapar."

**Saiba mais:** [Computação › Integrações](../../../classes/compute/integrations/index.md) · [Estudo de caso: sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) · [Mensageria › Padrões](../../../classes/messaging/patterns/index.md) · [Hands-on 9](../../../hands-on/9/index.md)

---

## Email { #email }

**O que é.** Um provedor de entrega de e-mail envia mensagens em seu nome por uma infraestrutura com reputação gerenciada e informa o que aconteceu (entregue, devolvido, marcado como spam) por webhooks ou eventos. Enviar é fácil; a **entregabilidade** é a parte difícil: autenticar o seu domínio (SPF, DKIM, DMARC), manter baixas as taxas de devolução e de reclamação, aquecer endereços de envio novos e respeitar os descadastramentos. E-mails transacionais (ingressos, recibos, redefinição de senha) e de marketing costumam ficar em fluxos separados, para que uma campanha ruim não prejudique a entrega dos ingressos.

**Quando usar.**

- Mensagens transacionais: o BoxOffice envia o ingresso e o recibo depois do `OrderConfirmed`, redefinições de senha, avisos de mudança no evento.
- Sempre de forma assíncrona: o pedido está confirmado quando o commit acontece, não quando o e-mail sai. Uma fila e os workers de `notification` fazem o envio.

**Quando não usar (ou cuidado).**

- Nunca envie e-mail dentro da transação de compra ou na thread da requisição: a latência e as quedas do provedor virariam as do usuário.
- Não opere seus próprios servidores de e-mail para envios em produção, a menos que esse seja o seu negócio: reputação de IP leva muito tempo para ser construída.
- Valem os limites de envio e as taxas por segundo do provedor: uma venda relâmpago que confirma 60.000 pedidos em 15 minutos dá ~67 e-mails por segundo, que precisam caber na cota da conta (peça aumentos com antecedência).
- E-mail não é garantido nem instantâneo; para avisos urgentes, combine canais (push, SMS) e mostre o ingresso no app.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Chamada à API para aceitar uma mensagem | ≈ 50–300 ms | ≈ ilustrativo; a entrega na caixa de entrada leva de segundos a minutos |
| Cota de envio | específica da conta (por dia e por segundo) | Contas novas começam com cota baixa (sandbox) — planeje aumentos antes do lançamento |
| Preço | ≈ USD 0,10 por 1.000 e-mails (preço de tabela do Amazon SES) | ≈ aproximado (2026); outros variam |
| Taxa de devolução saudável | ≈ < 2–5% | Provedores podem pausar contas acima dos seus limites |
| Taxa de reclamação saudável | ≈ < 0,1% | As regras de remetentes em massa do Gmail e do Yahoo pedem ficar abaixo de 0,3% |

**Modos de falha.**

- **Queda ou estrangulamento do provedor** → a fila absorve; os workers repetem com backoff; um segundo provedor para os e-mails transacionais críticos.
- **E-mails duplicados** — entrega at-least-once da fila → consumidor idempotente com chave (id do pedido, modelo).
- **Cair no spam** → SPF/DKIM/DMARC, fluxos separados para transacional e marketing, higiene das listas.
- **Mensagem venenosa** (endereço inválido, erro no modelo) trava a fila → dead-letter queue após N tentativas, alertas.
- **Perda silenciosa** → acompanhar os eventos do provedor (entregue/devolvido) e oferecer "reenviar ingresso" no app.

**No playground.** `email` é um nó externo de **chamada** (mediana de 250 ms) com uma cota do provedor `quota` (padrão 100 envios/s) e quedas ocasionais; coloque-o atrás de nós `queue` e `worker` para que a latência e as falhas dele virem backlog, e não erros para o usuário. Cenários: [`notification-system`](../../../../playground/scenarios/index.md#notification-system), [`async-queue`](../../../../playground/scenarios/index.md#async-queue), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale).

**Produtos reais.**

=== "AWS"

    - **Amazon SES (Simple Email Service)** — e-mail transacional e em massa com eventos de envio (entregas, devoluções, reclamações).

=== "GCP"

    - O Google Cloud não tem serviço próprio de envio de e-mails; parceiros como **SendGrid** (Twilio) ou **Mailgun** são usados a partir do GCP.

=== "Azure"

    - **Azure Communication Services Email** — envio de e-mails gerenciado para aplicações.

=== "Código aberto"

    - **Postfix** — o clássico agente de transferência de e-mails, se você realmente operar o seu.
    - **Mailpit** / **MailHog** — servidores SMTP locais que capturam e-mails para desenvolvimento e testes (sem entrega real).
    - Provedores comerciais comuns: **SendGrid**, **Mailgun**, **Postmark**, **Resend**.

!!! tip "Na entrevista"
    "E-mail nunca fica no caminho da requisição: o OrderConfirmed vai para uma fila, workers de notificação idempotentes enviam pelo provedor dentro do limite de taxa, as falhas são repetidas com backoff e terminam numa DLQ, e o ingresso também fica disponível no app caso o e-mail atrase."

**Saiba mais:** [Computação › Integrações](../../../classes/compute/integrations/index.md) · [Estudo de caso: sistema de notificações](../../../classes/case-studies/notification-system/index.md) · [Mensageria › Semântica](../../../classes/messaging/semantics/index.md) · [Computação › Notifications](../compute/index.md#notifications) · [Hands-on 7](../../../hands-on/7/index.md)
