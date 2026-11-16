!!! abstract "Neste lab"

    - Troque o provedor de pagamento falso do lab 9 por um **real, em sandbox**: o modo de teste da Stripe, em que nenhum dinheiro se move.
    - Mantenha o contrato que o `order` enxerga: o `payment` continua respondendo `AUTHORIZED` ou `DECLINED`, atrás de uma interface `Psp` com duas implementações — a falsa (ainda o padrão) e a Stripe.
    - Receba os **webhooks** da Stripe, confira a **assinatura** deles, processe cada evento **uma vez** e deixe um webhook registrar a cobrança cuja resposta se perdeu.
    - **Reconcilie** os seus pagamentos com o provedor, a fonte da verdade.
    - Veja como o mesmo design recebe o **Pix** com o Mercado Pago.

O lab 9 ensinou o `payment` a sobreviver a um provedor lento ou fora do ar — contra um WireMock que responde o que roteirizamos. Um provedor de serviços de pagamento (PSP, *payment service provider*) de verdade acrescenta o que um falso não tem: uma conta e chaves, valores em centavos, cartões recusados que são respostas e não falhas, e um segundo canal — o provedor chama *você* de volta, depois, talvez duas vezes, para dizer o que realmente aconteceu. Este lab liga o BoxOffice ao sandbox da Stripe e trata tudo isso, sem gastar um centavo.

!!! quote "A história até aqui"

    Capítulo 10 da [história da disciplina](../../index.md#story), o seu segundo lab, que amarra três fios. A [aula 3](../../classes/distributed/index.md) avisou que, entre máquinas, uma mensagem pode se perder ou se duplicar: **um "comprar" repetido pode cobrar duas vezes**. O [lab 9](../9/index.md) respondeu com uma chave de idempotência por pedido (`order-<orderId>`) contra um provedor falso e mostrou a outra face de um timeout: quando o cliente do lab 9 desiste depois de **1 s e 3 tentativas**, a cobrança pode ter acontecido mesmo assim — num dia de provedor lento, o [simulador abaixo](#the-unknown-checkouts) deixa **133 de 1.000 checkouts em UNKNOWN**. A [aula 12](../../classes/network-security/index.md) acrescenta que todo endpoint que a internet alcança precisa provar quem está chamando. **Este lab** liga o `payment` ao sandbox de um provedor real, transforma o UNKNOWN numa resposta conhecida com webhooks assinados e uma reconciliação e mede isso: cada checkout cobrado exatamente uma vez e zero divergências com o provedor.

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 3–4 horas |
| **Você precisa de** | as ferramentas do lab 0; uma **conta Stripe** gratuita (um e-mail basta para o sandbox); `jq` e `openssl` (os dois vêm com o macOS e a maioria das distribuições Linux) |
| **Diretório** | todo comando roda a partir da raiz do seu repositório `boxoffice/` |
| **Custos** | **zero**: o sandbox (modo de teste) não move dinheiro e o serviço se recusa a subir com uma chave de produção |

``` { .bash .copy }
docker compose version        # v2.x
jq --version                  # jq-1.6+
openssl version               # any
```

**Estado inicial** — o fim do lab 13 (o lab 9 é a base deste: `payment`, `order`, Toxiproxy e o provedor falso `psp`):

``` { .tree title="boxoffice/ at the start of lab 14" }
boxoffice/
    compose.yaml                     # psp (WireMock), toxiproxy, payment, order…
    services/payment/                # lab 9: PaymentController, PaymentService, PspClient, V1__create_payments.sql
    services/order/                  # lab 9: PaymentClient, Idempotency-Key "order-<orderId>"
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou um lab? Baixe [boxoffice-after-lab-13.zip](../13/boxoffice-after-lab-13.zip), descompacte e entre em `boxoffice`. Este lab **acrescenta** `Psp.java`, `StripePsp.java`, `StripeSignature.java`, `StripeWebhookController.java`, `Reconciliation.java`, `V2__stripe_events.sql`, um teste de unidade e `scripts/send-webhook.sh` e **substitui** o `compose.yaml` e, em `services/payment/`, `pom.xml`, `application.yaml`, `ChargeRequest.java`, `PaymentService.java` e `PspClient.java`. Todos estão completos nesta página e em [`boxoffice-after-lab-14.zip`](boxoffice-after-lab-14.zip).

## Slides { #slides }

<div class="slides-embed">
  <iframe src="slides/payments.html" title="Slides: pagamentos em sandbox" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/payments.html){:target="_blank"}

## O que você vai construir { #what-you-will-build }

``` diagram-sim
flowchart LR
    order["order<br/>chave order-&lt;id&gt;"]:::comp -->|"POST /payments<br/>(via Toxiproxy)"| payment["payment<br/>Psp: fake | stripe"]:::comp
    payment -->|"POST /v1/payment_intents<br/>Idempotency-Key, confirm=true"| stripe["sandbox da Stripe"]:::tech
    stripe -->|"payment_intent.succeeded<br/>(depois, talvez duas vezes)"| cli["stripe-cli<br/>listen --forward-to"]:::tech
    cli -->|"POST /webhooks/stripe<br/>Stripe-Signature"| payment
    payment -->|"GET /payments/reconcile<br/>consulta cada PaymentIntent"| stripe
```

| Passo | O que muda | Você deve ver |
|---|---|---|
| 1. Um sandbox | uma conta Stripe, uma chave de teste no `.env` | `GET /v1/balance` responde com `"livemode": false` |
| 2. O adaptador | `Psp` + `StripePsp`, o falso ainda é o padrão | o `payment` compila; 5 testes passam |
| 3. Cobrar | `PSP_PROVIDER=stripe` | `AUTHORIZED` com uma referência `pi_…`; a mesma chave, o mesmo pagamento; um cartão recusado é `DECLINED` |
| 4. Webhooks | assinatura, um evento uma vez, `stripe-cli` | `webhook evt_… → AUTHORIZED`; uma repetição é `duplicate`; uma falsificação é `400` |
| 5. A resposta perdida | uma cobrança que o `payment` nunca gravou | o webhook a grava; pagar de novo confirma o pedido sem segunda cobrança |
| 6. Reconciliar | o nosso contra o da Stripe | `{"checked": N, "mismatches": []}` — depois uma divergência, encontrada |

## 1. Um sandbox da Stripe { #1-a-stripe-sandbox }

1. Crie uma conta em [dashboard.stripe.com/register](https://dashboard.stripe.com/register){target="_blank"}. Você não precisa ativar pagamentos: um sandbox (o ambiente de teste da Stripe) fica disponível na hora.
2. No Dashboard, abra **Developers → API keys** do seu sandbox e copie a **secret key**: ela começa com `sk_test_`.
3. Coloque-a no `.env`, na raiz do repositório — o Compose o lê e o `.gitignore` do lab 0 o mantém fora do Git:

``` { .bash .copy title=".env" }
PSP_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
```

``` { .bash .copy }
git check-ignore .env                  # prints ".env": it will never be committed
curl -s https://api.stripe.com/v1/balance -u "$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-):" | jq '{object, livemode}'
```

Você deve ver `{"object": "balance", "livemode": false}`. `livemode: false` é o sandbox: nada que você fizer aqui cobra um cartão de verdade.

!!! danger "Uma secret key é uma senha para o seu dinheiro"

    Nunca a cole em código, num commit, num print de tela ou num chat. Se ela vazar, troque-a no Dashboard (**Developers → API keys → Roll key**). O `StripePsp` recusa qualquer chave que não comece com `sk_test_`: nesta disciplina, uma chave de produção é um bug.

## 2. O adaptador: uma interface, dois provedores { #2-the-adapter-one-interface-two-providers }

O `order` não pode saber qual provedor está atrás do `payment` — esse é o ponto do adaptador do [lab 9](../9/payment/index.md). A nova interface `Psp` tem duas implementações, escolhidas por `boxoffice.psp.provider`: o `PspClient` do lab 9 (ainda o padrão, para que os experimentos de caos e o CI continuem funcionando sem chaves) e o `StripePsp`.

=== "Psp.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/Psp.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/Psp.java"
    ```

=== "StripePsp.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/StripePsp.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/StripePsp.java"
    ```

=== "PspClient.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/PspClient.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/PspClient.java"
    ```

=== "ChargeRequest.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/ChargeRequest.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/ChargeRequest.java"
    ```

=== "application.yaml"

    ``` { .yaml .copy linenums="1" title="services/payment/src/main/resources/application.yaml" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/resources/application.yaml"
    ```

=== "pom.xml"

    ``` { .xml .copy linenums="1" title="services/payment/pom.xml" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/pom.xml"
    ```

O que o `StripePsp` faz, e por quê:

- **Um PaymentIntent por pedido, confirmado no servidor.** `confirm=true` cobra na hora com o meio de pagamento de teste (`pm_card_visa` por padrão — num checkout real, o Stripe.js no navegador transforma o cartão num id desses, de modo que números de cartão nunca tocam o BoxOffice). `allow_redirects=never`: não há navegador para mandar a uma página do banco.
- **Valores em centavos.** R$ 350,00 é `amount=35000`; `movePointRight(2).longValueExact()` falha alto diante de uma fração de centavo em vez de arredondar dinheiro.
- **A mesma `Idempotency-Key` da tabela do próprio `payment`** (`order-<orderId>`, vinda do `order`). A Stripe guarda o resultado do primeiro pedido com uma chave e o repete para todo retry com a mesma chave; um retry depois de uma queda entre "a Stripe cobrou" e "nós gravamos" não consegue cobrar duas vezes.
- **Um cartão recusado é uma resposta.** A Stripe devolve HTTP 402 com `type: card_error` e o PaymentIntent; o `payment` registra `DECLINED`. Todo o resto (401, 5xx, um timeout) é uma exceção: o retry, o breaker e o fallback do lab 9 no `order` tratam dela.
- **Metadados** `order_id` e `idempotency_key` viajam com o PaymentIntent: o webhook do passo 4 os usa para encontrar — ou criar — o pagamento.

O `PaymentService` agora pergunta à interface `Psp` em vez do `PspClient`; o código completo dele está no passo 4. Reconstrua o `payment` e rode os testes dele:

``` { .bash .copy }
docker compose build payment                                   # the Dockerfile runs mvn package -DskipTests
docker run --rm -v "$PWD/services/payment":/src -w /src maven:3.9-eclipse-temurin-21 mvn -B -q test
```

Você deve ver `Tests run: 5, Failures: 0` para o `StripeSignatureTest` (passo 4).

## 3. Cobre no sandbox { #3-charge-in-the-sandbox }

O `compose.yaml` passa as novas variáveis ao `payment` (e acrescenta o `stripe-cli`, usado no passo 4):

``` { .yaml .copy linenums="1" title="compose.yaml" }
--8<-- "docs/2027.1/hands-on/14/code/compose.yaml"
```

Suba o `payment` com o provedor Stripe (o `.env` define `PSP_PROVIDER=stripe`) e cobre direto nele, como no lab 9:

``` { .bash .copy }
docker compose up -d --build --wait payment
curl -s -w '\n%{http_code}\n' -X POST localhost:8085/payments -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: sandbox-1' -d '{"orderId":"5b0c2f9e-7d0a-4f43-9a55-1c1c2c8f8e10","amount":350.00}'
```

Você deve ver `201` e `"status":"AUTHORIZED","providerRef":"pi_…"`. No Dashboard (**Payments**), um pagamento de R$ 350,00 mostra os metadados `order_id` e `idempotency_key`. Depois:

- **O mesmo pedido de novo**: `200`, o mesmo `id` e o mesmo `providerRef` — e ainda um único pagamento no Dashboard.
- **Um cartão recusado**, com uma chave nova: acrescente `"paymentMethod":"pm_card_visa_chargeDeclined"` ao corpo e use `Idempotency-Key: sandbox-2`. Você deve ver `201` com `"status":"DECLINED"`; `pm_card_visa_chargeDeclinedInsufficientFunds` também recusa, por outro motivo (os dois são meios de pagamento de teste da Stripe).
- **De ponta a ponta**, pelo `order` e pelo Toxiproxy, como no lab 9:

``` { .bash .copy }
ID=$(curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-9","holdId":"hold-sandbox-1","customerEmail":"bia@example.com","amount":350.00}' | jq -r .id)
curl -s -X POST localhost:8084/orders/$ID/pay | jq '{id, status}'
```

Você deve ver `"status":"CONFIRMED"`. Se o primeiro `pay` responder `503`, a Stripe demorou mais que o read timeout de 1 s do `order`: o `payment` terminou mesmo assim e gravou a cobrança, então chamar `pay` de novo confirma o pedido com o mesmo PaymentIntent — a resposta perdida do passo 5, por acidente.

## 4. Webhooks: o provedor conta depois { #4-webhooks-the-provider-tells-you-later }

Uma resposta síncrona pode se perder; a Stripe também **chama você de volta** com um evento a cada mudança de um PaymentIntent. No sandbox, os eventos são reenviados três vezes em poucas horas se o seu endpoint não responder `2xx`; o mesmo evento pode chegar **mais de uma vez** e os eventos podem chegar **fora de ordem**. Por isso o endpoint precisa: provar que a chamada vem da Stripe, processar cada evento uma vez e responder rápido.

=== "StripeWebhookController.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/StripeWebhookController.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/StripeWebhookController.java"
    ```

=== "StripeSignature.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/StripeSignature.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/StripeSignature.java"
    ```

=== "PaymentService.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/PaymentService.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/PaymentService.java"
    ```

=== "V2__stripe_events.sql"

    ``` { .sql .copy linenums="1" title="services/payment/src/main/resources/db/migration/V2__stripe_events.sql" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/resources/db/migration/V2__stripe_events.sql"
    ```

=== "StripeSignatureTest.java"

    ``` { .java .copy linenums="1" title="services/payment/src/test/java/boxoffice/payment/StripeSignatureTest.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/test/java/boxoffice/payment/StripeSignatureTest.java"
    ```

- **A assinatura.** `Stripe-Signature: t=<unix time>,v1=<hex>`, em que `v1` é o HMAC-SHA256 (um código de autenticação de mensagem baseado em hash, HMAC, *hash-based message authentication code*: um hash SHA-256 com a chave secreta do endpoint) de `<t>.<corpo bruto>`. O controller lê o corpo como `String` — interpretar primeiro e serializar de novo mudaria os bytes —, compara em tempo constante e recusa um timestamp com mais de 5 minutos, para que uma requisição capturada não possa ser repetida depois.
- **Uma vez por evento.** A tabela `stripe_events` tem o id do evento como chave primária; `INSERT … ON CONFLICT DO NOTHING` devolve 0 para uma repetição, que é confirmada e pulada.
- **O webhook cura.** Se nenhum pagamento tem aquele PaymentIntent — a cobrança passou, mas a resposta nunca chegou ao banco —, os metadados o recriam, com a mesma chave de idempotência. O próximo `pay` daquele pedido o encontra.

**Encaminhe os eventos do sandbox ao `payment`.** A interface de linha de comando (CLI, *command-line interface*) da Stripe abre uma conexão com a Stripe e encaminha os eventos a uma URL local — sem endereço público. Pegue o segredo de assinatura dela (ele não muda entre execuções), coloque-o no `.env`, reinicie o `payment` e suba o encaminhador:

``` { .bash .copy }
docker compose run --rm --no-deps stripe-cli listen --print-secret     # prints whsec_…
echo "STRIPE_WEBHOOK_SECRET=whsec_..." >> .env                         # paste the value it printed
docker compose up -d --wait payment
docker compose --profile stripe up -d stripe-cli
docker compose logs stripe-cli | grep -i ready
```

Você deve ver `Ready! … Your webhook signing secret is whsec_…` (o mesmo valor). Pague outro pedido (passo 3) e acompanhe os logs:

``` { .bash .copy }
docker compose logs -f payment | grep webhook
```

Você deve ver `webhook evt_… payment_intent.succeeded pi_… → AUTHORIZED`, um instante depois de o `pay` responder: o evento confirma o que a resposta síncrona disse.

**Uma repetição e uma falsificação.** O `scripts/send-webhook.sh` assina um evento do jeito que a Stripe assina, com o segredo do `.env`:

``` { .bash .copy linenums="1" title="scripts/send-webhook.sh" }
--8<-- "docs/2027.1/hands-on/14/code/scripts/send-webhook.sh"
```

``` { .bash .copy }
cat > /tmp/evt.json <<EOF
{"id":"evt_sandbox_1","type":"payment_intent.succeeded","data":{"object":{"id":"pi_sandbox_1","status":"succeeded","amount":35000,"metadata":{"order_id":"5b0c2f9e-7d0a-4f43-9a55-1c1c2c8f8e11","idempotency_key":"sandbox-replay"}}}}
EOF
bash scripts/send-webhook.sh /tmp/evt.json                 # applied 200
bash scripts/send-webhook.sh /tmp/evt.json                 # duplicate 200
bash scripts/send-webhook.sh /tmp/evt.json whsec_wrong     # bad signature 400
```

A primeira chamada grava um pagamento que o `payment` nunca cobrou — exatamente o que o passo 5 precisa de um evento real. A segunda é pulada, a terceira recusada (e registrada como `webhook rejected`).

## 5. A resposta perdida: cobrado, mas ninguém sabe { #the-unknown-checkouts }

O pior caso do lab 9: a Stripe cobrou e o `payment` caiu antes de gravar — ou o `order` estourou o timeout em todas as tentativas. Para o fã, o checkout é UNKNOWN; para o provedor, o dinheiro se moveu. Reproduza: crie um pedido e mande à Stripe exatamente o pedido que o `payment` manda, **à mão**, como se o `payment` tivesse morrido logo depois:

``` { .bash .copy }
ID=$(curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-9","holdId":"hold-sandbox-2","customerEmail":"bia@example.com","amount":350.00}' | jq -r .id)
KEY=$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)
curl -s https://api.stripe.com/v1/payment_intents -u "$KEY:" -H "Idempotency-Key: order-$ID" \
  -d amount=35000 -d currency=brl -d payment_method=pm_card_visa -d confirm=true \
  -d "automatic_payment_methods[enabled]=true" -d "automatic_payment_methods[allow_redirects]=never" \
  -d "metadata[order_id]=$ID" -d "metadata[idempotency_key]=order-$ID" | jq '{id, status}'
```

Você deve ver `"status": "succeeded"`: o fã foi cobrado e o BoxOffice não tem registro. Depois:

1. `docker compose logs payment | grep webhook | tail -1` — o evento chegou e o `payment` **criou** o pagamento a partir dos metadados.
2. `curl -s -X POST localhost:8084/orders/$ID/pay | jq '{id, status}'` — o fã (ou um retry) paga de novo: `CONFIRMED`. O `payment` achou o pagamento pela chave `order-<id>` e não chamou a Stripe; se tivesse chamado, a Stripe repetiria o mesmo PaymentIntent para aquela chave.
3. No Dashboard, procure o id do pedido nos metadados: **um** pagamento.

O simulador mostra o tamanho do problema com o cliente do lab 9 e um provedor lento:

<div class="csim" data-sim="idempotent-retry" data-key="order" data-provider="slow"></div>

!!! tip "Experimente"

    Com o cliente do lab 9 (read timeout de 1 s, 3 tentativas) contra um provedor lento, 40,2% das chamadas estouram o timeout. Uma chave por pedido (a `order-<orderId>` do lab 9) mantém 1.000 cobranças para 1.000 fãs — 0 duplicadas —, mas 133 checkouts terminam UNKNOWN, cada um cobrado uma vez: é isso que o webhook e a reconciliação deste lab resolvem. Troque a chave para "nenhuma": 392 fãs pagam duas vezes ou mais.

<div class="sdp" data-scenario="boxoffice-payment" data-mode="compact" data-height="460"></div>

## 6. Reconcilie: o provedor é a fonte da verdade { #6-reconcile-the-provider-is-the-source-of-truth }

Webhooks podem se perder (um endpoint fora do ar por mais de algumas horas, um bug que respondeu `200` e não fez nada). Uma **reconciliação** periódica compara cada pagamento recente com o PaymentIntent do provedor:

``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/Reconciliation.java" }
--8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/Reconciliation.java"
```

``` { .bash .copy }
curl -s 'localhost:8085/payments/reconcile?window=PT2H' | jq
```

Você deve ver `checked` contando os seus pagamentos Stripe das últimas duas horas (as referências falsas `ch_…` do lab 9 são puladas) e **uma** divergência: `{"providerRef": "pi_sandbox_1", "ours": "AUTHORIZED", "stripe": "missing"}` — o evento que você mesmo assinou no passo 4 registrou um pagamento que a Stripe nunca fez. É o pior tipo de divergência (um ingresso vendido por nada) e o motivo de a reconciliação existir. Remova-o, depois quebre um de verdade, de propósito, e encontre-o:

``` { .bash .copy }
docker compose exec db psql -U boxoffice -d boxoffice -c "DELETE FROM payment.payments WHERE provider_ref = 'pi_sandbox_1'"
curl -s 'localhost:8085/payments/reconcile?window=PT2H' | jq '.mismatches'        # []
docker compose exec db psql -U boxoffice -d boxoffice -c \
  "UPDATE payment.payments SET status = 'DECLINED' WHERE id = (SELECT id FROM payment.payments WHERE status = 'AUTHORIZED' AND provider_ref LIKE 'pi_%' LIMIT 1)"
curl -s 'localhost:8085/payments/reconcile?window=PT2H' | jq '.mismatches'
```

Você deve ver uma divergência: `"ours": "DECLINED", "stripe": "succeeded"` — um fã que pagou e cujo pedido o BoxOffice teria cancelado. Em produção, esse relatório roda num agendamento e cada divergência vira um alerta ou uma correção automática (confirmar o pedido ou estornar).

!!! info "Custos e limites do sandbox"

    O sandbox tem limites de taxa menores que o modo de produção e guarda os dados de teste até você apagá-los (**Developers → … → Delete all test data**). O `GET /payments/reconcile` faz uma chamada à Stripe por pagamento: tudo bem para um lab; para volumes reais, um job com paginação (`GET /v1/payment_intents?created[gte]=…`).

## 7. Pix com o Mercado Pago { #7-pix-with-mercado-pago }

A interface `Psp` é a junta para qualquer provedor. O Mercado Pago é a escolha comum no Brasil para o **Pix** e o Pix muda uma coisa no fluxo: a resposta a "cobrar" **não** é "pago" — é um QR code. O fã paga depois, no app do banco, e só o **webhook** diz que o dinheiro chegou. O que é uma rede de segurança com os cartões da Stripe vira o caminho principal.

| | Stripe (este lab) | Mercado Pago, Pix |
|---|---|---|
| Sandbox | chaves de modo de teste `sk_test_…` | credenciais de teste (access token de teste) do painel de desenvolvedor |
| Criar | `POST /v1/payment_intents`, `confirm=true` | `POST /v1/orders` (Orders API), o meio de pagamento Pix em `transactions.payments` |
| Idempotência | header `Idempotency-Key` | header `X-Idempotency-Key` (obrigatório) |
| Primeira resposta | `succeeded` ou uma recusa 402 | pendente, com um QR code (`qr_code`, `qr_code_base64`) para mostrar ao fã |
| Confirmação | webhook `payment_intent.succeeded`, `Stripe-Signature` | notificação com um header `x-signature` (`ts=…,v1=…`), verificada com o segredo da **Configuração de Webhooks** (o kit de desenvolvimento oficial, SDK, *software development kit*, implementa a checagem HMAC) |
| Resultados de teste | meios de pagamento de teste (`pm_card_visa…`) | cartões de teste cujo nome do titular escolhe o resultado (`APRO` aprovado, `OTHE` erro, `CONT` pendente, `FUND` saldo insuficiente), Cadastro de Pessoa Física (CPF) `12345678909` |

Um `MercadoPagoPsp` devolveria `Charge(id, false)` com um estado novo — "pendente" — que o `order` precisa mostrar como "aguardando pagamento" e o webhook levaria o pagamento a `AUTHORIZED`. Confira a [documentação de desenvolvedores do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs){target="_blank"} atual antes de escrevê-lo: os nomes dos campos da Orders API diferem dos da Payments API, mais antiga.

!!! success "Boas práticas neste lab"

    - **Mantenha o provedor atrás de uma interface** — `Psp` com `PspClient` e `StripePsp`; o `order` nunca sabe qual deles cobrou ([Compute — integrações externas](../../classes/compute/integrations/index.md)).
    - **Uma chave de idempotência por pedido, de ponta a ponta** — `order-<orderId>` do `order`, a coluna única de `payments` e a `Idempotency-Key` da Stripe são o mesmo valor, então nenhum retry, em lugar nenhum, cobra duas vezes ([Sistemas Distribuídos](../../classes/distributed/index.md)).
    - **Trate uma recusa como resposta, não como falha** — o `StripePsp` mapeia o 402 para `DECLINED`; só as falhas reais chegam ao retry e ao breaker do lab 9 ([Padrões de confiabilidade](../../classes/reliability/patterns/index.md)).
    - **Verifique todo webhook, processe cada evento uma vez** — `StripeSignature` (HMAC, tempo constante, tolerância de 5 minutos) e a tabela `stripe_events` ([Rede e Segurança](../../classes/network-security/index.md)).
    - **Reconcilie com a fonte da verdade** — a `Reconciliation` encontra o que os webhooks perderam; dinheiro precisa de uma segunda conferência, não de confiança ([Observabilidade](../../classes/observability/index.md)).
    - **Segredos vindos do ambiente, só chaves de teste** — `.env` ignorado pelo Git, `sk_test_` exigido na subida.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| o `payment` sai: `STRIPE_SECRET_KEY must be a test key (sk_test_…)` | `PSP_PROVIDER=stripe` com uma chave vazia ou de produção | coloque a chave `sk_test_…` no `.env` ou remova `PSP_PROVIDER` para voltar ao falso |
| `500` e `Stripe answered 401: Invalid API Key provided` nos logs | a chave foi copiada errada ou trocada | copie-a de novo em **Developers → API keys** |
| `Stripe answered 400` falando da moeda | o país da sua conta não aceita cobranças em BRL | acrescente `STRIPE_CURRENCY=usd` ao `.env` e reinicie o `payment` |
| `Stripe answered 400` sobre idempotência | a mesma `Idempotency-Key` enviada com outros parâmetros (outro valor ou cartão) | use uma chave nova para um pedido novo; uma chave significa "este pedido exato" |
| os webhooks respondem `400 bad signature` | o `STRIPE_WEBHOOK_SECRET` difere do que `listen --print-secret` imprime ou o `payment` não foi reiniciado depois de editar o `.env` | corrija o `.env` e rode `docker compose up -d --wait payment` |
| nenhuma linha `webhook` nos logs | o `stripe-cli` não está rodando (ele tem um profile) | `docker compose --profile stripe up -d stripe-cli`; confira `docker compose logs stripe-cli` |
| o primeiro `pay` responde `503` | a Stripe respondeu depois do read timeout de 1 s do `order` | chame `pay` de novo: a cobrança foi gravada e a mesma chave a devolve |

## Limpeza { #clean-up }

``` { .bash .copy }
docker compose --profile stripe stop stripe-cli
sed -i.bak '/^PSP_PROVIDER=/d' .env && rm .env.bak       # back to lab 9's fake provider
docker compose up -d --wait payment
```

Mantenha a chave no `.env` (ela fica fora do Git) ou apague-a; no Dashboard, você pode apagar todos os dados de teste.

## Entrega { #deliverable }

- [ ] O `payment` cobra no sandbox: um `AUTHORIZED`, o mesmo pagamento para uma chave repetida, um `DECLINED` (cole as três respostas em `results/lab14.md`).
- [ ] O `StripeSignatureTest` passa (5 testes); um webhook falsificado recebe `400`, um repetido é `duplicate`.
- [ ] A resposta perdida do passo 5: o webhook criou o pagamento e o `pay` confirmou o pedido — um pagamento no Dashboard.
- [ ] `GET /payments/reconcile`: o pagamento `missing` do passo 4, nenhuma divergência depois de removê-lo e a que você criou (cole os três).
- [ ] Em `results/lab14.md`, três frases: o que um `MercadoPagoPsp` para Pix muda no `order`.
- [ ] [Quiz](quiz.md) respondido.

## Estado final { #end-state }

``` { .tree title="boxoffice/ after lab 14 (changes only)" }
boxoffice/
    .env                                   # not in Git: PSP_PROVIDER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
    compose.yaml                           # payment's Stripe variables, stripe-cli (profile stripe)
    scripts/send-webhook.sh
    services/payment/
        pom.xml                            # + spring-boot-starter-test
        src/main/java/boxoffice/payment/
            Psp.java  PspClient.java  StripePsp.java  StripeSignature.java
            StripeWebhookController.java  Reconciliation.java
            ChargeRequest.java  PaymentService.java
        src/main/resources/application.yaml
        src/main/resources/db/migration/V2__stripe_events.sql
        src/test/java/boxoffice/payment/StripeSignatureTest.java
```

## O que quebra em seguida { #what-breaks-next }

Todo checkout agora é cobrado uma vez e toda cobrança é conhecida — mas saber não é consertar. A divergência da reconciliação é um fã que pagou por um pedido que o BoxOffice cancelou: isso pede um **estorno** (`POST /v1/refunds`) ou uma confirmação tardia, decididos por um job, não à mão. Cartões que pedem 3-D Secure precisam do navegador do fã (Stripe.js), o que significa um front end e um estado `requires_action` que o servidor sozinho não termina. O Pix torna "pendente" o caso normal, então o `order` precisa aprender um terceiro estado. E dinheiro de verdade significa chaves de produção, uma empresa verificada e as regras de dados de cartão do Padrão de Segurança de Dados da Indústria de Cartões de Pagamento (PCI DSS, *Payment Card Industry Data Security Standard*) — mantidas pequenas justamente porque números de cartão nunca tocam o BoxOffice. Se tudo isso ainda se sustenta às 10:00, com 2 milhões de fãs, é a pergunta da [aula 15 — Engenharia de Desempenho](../../classes/performance/index.md) e do seu [projeto](../../exercises/project/index.md).
