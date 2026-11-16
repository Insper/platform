Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Cobrando um provedor real { #charging-a-real-provider }

**Q1.** O `order` repete um pagamento depois de um timeout. Quais chaves garantem que o fã seja cobrado no máximo uma vez?

- A. Uma chave aleatória nova a cada tentativa, para que a Stripe nunca confunda duas tentativas
- B. A mesma chave em toda tentativa de um pedido (`order-<orderId>`): a coluna única do `payment` e a `Idempotency-Key` da Stripe devolvem o primeiro resultado
- C. Nenhuma chave: a Stripe detecta duplicatas pelo valor e pelo cartão
- D. Uma chave por dia, para que todas as compras do fã no dia a compartilhem

??? success "Resposta"
    **B — uma chave por pedido, de ponta a ponta.**

    A chave de idempotência nomeia *o pedido*, não a tentativa. O `payment` a procura na tabela `payments` e a Stripe guarda o primeiro resultado daquela chave e o repete a cada retry. Uma chave nova por tentativa (A) é o mesmo que nenhuma chave: toda tentativa que chegou ao provedor é uma nova cobrança — no simulador, 392 de 1.000 fãs pagam duas vezes num dia lento.

---

**Q2.** A Stripe responde HTTP 402 com `type: card_error` para um cartão recusado. Por que o `StripePsp` transforma isso em `DECLINED` em vez de lançar uma exceção?

- A. Porque exceções são lentas em Java
- B. Porque uma recusa é uma resposta válida sobre o cartão do fã: repeti-la, ou abrir o circuit breaker do `order` por causa dela, seria errado
- C. Porque a Stripe exige
- D. Porque 402 significa que o pedido vai dar certo depois

??? success "Resposta"
    **B — uma recusa é uma resposta, não uma falha.**

    O provedor funcionou e disse "não". O retry, o breaker e o fallback do lab 9 existem para um provedor que não responde (timeouts, 5xx). Contar recusas como falhas repetiria um cartão que vai ser recusado de novo e poderia abrir o breaker num dia com muitas recusas, bloqueando fãs cujos cartões estão bem.

---

**Q3.** Por que o `StripePsp` envia os valores como `movePointRight(2).longValueExact()`?

- A. A API da Stripe recebe valores na menor unidade da moeda (centavos) e o `longValueExact` falha em vez de arredondar em silêncio uma fração de centavo
- B. Para converter reais em dólares
- C. Porque a Stripe não aceita decimais em JSON
- D. Para acrescentar uma taxa de 1%

??? success "Resposta"
    **A — inteiros na menor unidade da moeda, nunca um arredondamento silencioso.**

    R$ 350,00 é `amount=35000`. Um valor como 350,005 não pode ser cobrado; falhar alto é melhor que cobrar um centavo a mais ou a menos do que o pedido diz.

---

## Webhooks e reconciliação { #webhooks-and-reconciliation }

**Q4.** Por que o `StripeWebhookController` lê o corpo da requisição como `String` e confere a `Stripe-Signature` antes de interpretá-lo?

- A. Porque o Spring não consegue interpretar JSON num controller
- B. Porque a assinatura é um HMAC dos bytes brutos exatos (`<t>.<corpo>`); interpretar e serializar de novo poderia mudá-los e um corpo sem assinatura, ou com a assinatura errada, não merece confiança alguma
- C. Porque Strings são mais rápidas que objetos
- D. Porque a Stripe envia XML

??? success "Resposta"
    **B — a assinatura cobre o corpo bruto.**

    Qualquer um que descubra a URL poderia postar "pagamento aprovado". O HMAC com o segredo do endpoint prova que o corpo veio da Stripe, a tolerância de 5 minutos recusa uma requisição capturada e repetida depois e a comparação em tempo constante não revela quanto de uma assinatura chutada estava certo.

---

**Q5.** O mesmo evento `payment_intent.succeeded` chega duas vezes. O que o `payment` faz na segunda vez?

- A. Cobra de novo
- B. Responde 500 para que a Stripe pare de enviá-lo
- C. O `INSERT … ON CONFLICT DO NOTHING` em `stripe_events` devolve 0, então o evento é confirmado com 2xx e pulado
- D. Apaga o pagamento

??? success "Resposta"
    **C — confirmado e pulado.**

    A Stripe entrega pelo menos uma vez: reenvios e duplicatas são normais. Responder um erro (B) faria a Stripe reenviar *mais*. O id do evento é a chave de deduplicação, gravada na mesma transação que aplica o evento.

---

**Q6.** Um webhook diz que um PaymentIntent foi aprovado, mas o `payment` não tem linha para ele. O que aconteceu e o que este lab faz?

- A. A Stripe errou; ignore o evento
- B. A cobrança passou, mas a resposta nunca chegou ao banco (uma queda ou todas as tentativas do `order` estouraram o timeout): o `payment` cria a linha a partir dos metadados do PaymentIntent (`order_id`, `idempotency_key`), então o próximo `pay` daquele pedido a encontra e confirma sem segunda cobrança
- C. O fã pagou duas vezes; estorne na hora
- D. O evento é de outra conta

??? success "Resposta"
    **B — o webhook cura a resposta perdida.**

    É o checkout UNKNOWN do lab 9: cobrado, mas ninguém sabe. Como os metadados levam a mesma chave de idempotência que o `order` usa, a linha curada é exatamente a que um retry procura. O que o webhook ainda não conserta — um pagamento de um pedido já cancelado — é o que a reconciliação relata.

---

**Q7.** Com Pix (Mercado Pago), o que muda no fluxo em relação aos cartões deste lab?

- A. Nada: a primeira resposta é "pago", como com cartões
- B. A primeira resposta é uma cobrança pendente com um QR code; o fã paga depois no app do banco e só o webhook confirma, então o `order` precisa de um estado "aguardando pagamento" e o webhook vira o caminho principal
- C. O Pix não precisa de chave de idempotência
- D. Pagamentos Pix não podem ser reconciliados

??? success "Resposta"
    **B — "pendente" vira o caso normal.**

    Com cartões, o webhook confirma o que a resposta síncrona já disse. Com Pix, a resposta síncrona é só um QR code e o dinheiro chega quando o fã paga. A `X-Idempotency-Key` da Orders API e a checagem do `x-signature` das notificações têm os mesmos papéis que neste lab.
