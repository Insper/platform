Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Fundamentos do Kafka

**Q1.** O grupo de consumidores `notification` roda 8 instâncias no tópico `order-events`, de 6 partições. Quantas instâncias recebem mensagens?

- A. 8 — o Kafka distribui as mensagens em *round-robin* entre todos os membros
- B. 6 — cada partição é atribuída a um membro do grupo; 2 instâncias ficam ociosas
- C. 1 — um grupo de consumidores sempre tem um único leitor ativo
- D. 48 — toda instância lê toda partição

??? success "Resposta"
    **B — 6 ativas, 2 ociosas.**

    Dentro de um grupo de consumidores, uma partição é consumida por no máximo um membro de cada vez; é assim que o Kafka mantém a ordem por partição. O número de partições é, portanto, o teto do paralelismo do grupo. As instâncias ociosas não são inúteis: elas assumem partições quando um membro ativo falha.

---

**Q2.** O relay do outbox publica cada evento com chave = `orderId`. O que a chave garante?

- A. Que cada evento seja entregue exatamente uma vez
- B. Que os eventos do mesmo pedido vão para a mesma partição e, portanto, são lidos na ordem em que foram escritos
- C. Que o evento seja criptografado com a chave
- D. Que eventos de pedidos diferentes nunca compartilhem uma partição

??? success "Resposta"
    **B — mesma chave → mesma partição → ordem por chave.**

    O particionador padrão faz o *hash* da chave módulo o número de partições. O Kafka só garante ordem dentro de uma partição, então usar o id do agregado como chave dá ordem *por pedido*, que é o que os consumidores precisam. Chaves diferentes podem compartilhar uma partição (D é falsa), e a chave não tem relação com semântica de entrega nem com criptografia.

---

**Q3.** Um grupo de consumidores lê `order-events`. `kafka-consumer-groups.sh --describe` mostra, para a partição 2, `CURRENT-OFFSET 1200` e `LOG-END-OFFSET 1500`. Qual é o *lag* e o que ele significa?

- A. 2 700; o broker tem 2 700 mensagens em memória
- B. 300; o grupo ainda tem 300 mensagens daquela partição para processar
- C. 1 200; o grupo processou 1 200 mensagens desde que começou
- D. 300; 300 mensagens foram perdidas

??? success "Resposta"
    **B — *lag* = offset do fim do log − offset confirmado = 300 mensagens ainda por processar.**

    O *lag* é a distância entre a mensagem mais nova da partição e a posição confirmada do grupo. É o principal sinal de saúde de um consumidor: *lag* crescente significa que as chegadas superam a capacidade do consumidor. Nada se perde — o Kafka guarda as mensagens pelo período de retenção, tenham sido lidas ou não.

---

## Outbox e idempotência

**Q4.** Por que o serviço `order` não pode simplesmente salvar o pedido e depois chamar `kafkaTemplate.send(...)` no mesmo método?

- A. O Spring não permite chamadas ao Kafka dentro de um método `@Transactional`
- B. O Kafka é mais lento que o PostgreSQL
- C. As duas escritas vão para sistemas diferentes sem transação compartilhada: uma queda entre elas guarda um pedido sem o evento (ou publica um evento de um pedido que foi desfeito)
- D. O Kafka exige que os eventos sejam publicados por um serviço separado

??? success "Resposta"
    **C — o problema da escrita dupla.**

    O PostgreSQL não consegue desfazer uma publicação no Kafka, e o Kafka não consegue desfazer um commit do banco. Seja qual for a ordem das duas escritas, uma queda, um deploy ou um timeout entre elas deixa os sistemas inconsistentes. O transactional outbox grava o evento na mesma transação do pedido; um relay o publica depois, tentando de novo até o Kafka confirmar.

---

**Q5.** O relay envia um lote, o Kafka confirma, e o processo cai antes que o `UPDATE outbox SET published_at = ...` faça commit. O que acontece?

- A. Os eventos se perdem
- B. Os eventos são publicados de novo na próxima execução; os consumidores veem duplicatas e precisam ser idempotentes
- C. O Kafka detecta a duplicata e a descarta, porque `enable.idempotence=true`
- D. O banco desfaz os pedidos também

??? success "Resposta"
    **B — republicados: o outbox é *at-least-once*.**

    As linhas continuam não publicadas, então a próxima execução (ou outra réplica) as envia de novo. A idempotência do produtor (C) só deduplica retentativas *dentro de uma sessão do produtor*; depois de uma queda, o novo produtor tem uma nova identidade. Por isso todo evento carrega um `eventId` e o consumidor deduplica por ele.

---

**Q6.** A consulta do relay termina com `FOR UPDATE SKIP LOCKED`. Que problema o `SKIP LOCKED` resolve?

- A. Pula eventos que falharam ao serializar
- B. Permite que várias réplicas de `order` rodem o relay ao mesmo tempo: cada uma trava um conjunto diferente de linhas em vez de esperar pelas (ou duplicar as) linhas das outras
- C. Evita travar a tabela `orders` durante os INSERTs
- D. Deixa a consulta mais rápida ao pular o índice

??? success "Resposta"
    **B — relays concorrentes pegam lotes disjuntos.**

    `FOR UPDATE` trava as linhas selecionadas até o fim da transação; `SKIP LOCKED` faz outra transação pular as linhas já travadas em vez de ficar bloqueada nelas. Cada réplica pega um lote diferente, então o trabalho é dividido sem publicação dupla. O mesmo idioma implementa filas de tarefas no PostgreSQL.

---

**Q7.** Em `NotificationService.handle`, o INSERT de deduplicação em `processed_events` e o envio do e-mail estão em uma transação, nesta ordem. Qual falha ainda pode produzir um e-mail duplicado?

- A. O consumidor recebe o mesmo evento duas vezes seguidas
- B. Duas instâncias do consumidor recebem o mesmo evento ao mesmo tempo
- C. O e-mail é enviado e depois o commit do banco falha; o evento reentregue é processado de novo
- D. O evento é um JSON malformado

??? success "Resposta"
    **C — o efeito deu certo, mas o registro dele não.**

    A e B estão tratados: a chave primária em `event_id` deixa só uma transação reivindicar o evento, e as entregas seguintes o encontram reivindicado. Mas o e-mail é um efeito colateral externo que o banco não consegue desfazer. Se o commit falhar depois do envio, a reivindicação some e uma retentativa envia de novo. A correção completa é uma chave de idempotência aceita pelo provedor (passe o `eventId`).

---

**Q8.** O `POST /orders` usa `INSERT ... ON CONFLICT (hold_id) DO NOTHING`. Um fã clica duas vezes em "Comprar". O que acontece?

- A. Dois pedidos são criados para os mesmos assentos
- B. A segunda requisição falha com 500 por violar a restrição de unicidade
- C. A segunda requisição encontra a reserva já transformada em pedido, devolve o mesmo pedido com `200 OK` e não grava um segundo evento
- D. A segunda requisição espera até o primeiro e-mail ser enviado

??? success "Resposta"
    **C — o `hold_id` único torna a requisição idempotente.**

    A chave natural da operação (uma reserva → um pedido) vira uma restrição de unicidade. O PostgreSQL serializa os dois INSERTs: o segundo é pulado, o serviço lê a linha existente e a devolve. Nem pedido duplicado, nem evento duplicado — idempotência na API, não só no consumidor.

---

## Erros e a DLT

**Q9.** Uma mensagem na partição 3 faz o listener lançar uma `MailSendException` transitória toda vez, e o *error handler* está configurado com 3 retentativas e *backoff* exponencial (0,5 s, 1 s, 2 s). O que acontece com as outras mensagens?

- A. Todas as partições param até um operador intervir
- B. As mensagens atrás dela **na partição 3** esperam cerca de 3,5 s; as outras partições seguem; depois o registro vai para `order-events-dlt` e a partição 3 continua
- C. O registro é pulado em silêncio depois da primeira falha
- D. O Kafka move o registro para o fim da partição e tenta mais tarde

??? success "Resposta"
    **B — retentativas bloqueantes atrasam só aquela partição, e depois a DLT a desbloqueia.**

    O `DefaultErrorHandler` tenta de novo no lugar, então a ordem é mantida e só a partição afetada espera. Depois das retentativas, o `DeadLetterPublishingRecoverer` publica o registro (com *headers* da exceção) na DLT e o offset é confirmado. O Kafka nunca reordena uma partição (D).

---

**Q10.** Por que `JacksonException` e `IllegalArgumentException` são registradas como **não retentáveis**?

- A. Porque o Spring Kafka não consegue tentar de novo exceções verificadas
- B. Porque indicam falhas permanentes: um payload malformado ou um endereço recusado vai falhar em toda tentativa, então tentar de novo só atrasa a partição
- C. Para deixar o consumidor mais rápido no caminho feliz
- D. Porque a DLT só aceita esses tipos de exceção

??? success "Resposta"
    **B — classifique os erros: transitório → tentar de novo, permanente → mensagem morta já.**

    Tentar de novo uma mensagem envenenada desperdiça o tempo de *backoff* e bloqueia a partição à toa. Classificar exceções é a decisão de projeto central de qualquer consumidor: timeouts e 5xx de dependências são transitórios; erros de validação e de parsing são permanentes.

---

## Sala de espera e capacidade

**Q11.** A sala de espera admite 500 fãs por segundo. Um fã entra e fica na posição 45 000. Que ETA a página deve mostrar, e que lei o justifica?

- A. 9 s — posição × taxa
- B. 90 s — Lei de Little: espera = tamanho da fila / vazão
- C. 45 s — um segundo por mil fãs
- D. Não dá para estimar

??? success "Resposta"
    **B — 45 000 / 500 = 90 s.**

    Lei de Little, L = λ·W, rearranjada como W = L / λ: com taxa de admissão constante, a fila drena a λ, então a espera é a posição dividida pela taxa. O experimento E do k6 confere essa promessa com a espera medida (`wr_eta_error_seconds`).

---

**Q12.** Com `EMAIL_LATENCY=50ms` e `NOTIFY_CONCURRENCY=1`, chegam 100 pedidos por segundo durante 60 s. Aproximadamente qual é o *lag* do consumidor ao fim da rajada, e quanto tempo leva para drenar?

- A. 0 mensagens; o Kafka absorve a rajada
- B. ≈ 4 800 mensagens; ≈ 240 s
- C. ≈ 6 000 mensagens; ≈ 60 s
- D. ≈ 1 200 mensagens; ≈ 12 s

??? success "Resposta"
    **B — capacidade de 20/s, chegadas de 100/s.**

    Uma thread a 50 ms por e-mail atende 20 mensagens/s. O *backlog* cresce a 100 − 20 = 80/s, chegando a ≈ 4 800 depois de 60 s, e drena a 20/s depois da rajada: 4 800 / 20 = 240 s. Com 6 threads (120/s) o *lag* fica perto de zero; uma sétima thread ficaria ociosa, já que o tópico tem 6 partições.

---

**Q13.** O admissor da sala de espera é um método `@Scheduled` em `order`. Você escala `order` para 3 réplicas. O que dá errado, e qual é uma correção?

- A. Nada; o Redis serializa as retiradas
- B. Cada réplica admite N fãs por segundo, então a taxa real de admissão triplica; rode o admissor em uma única instância (*worker*, eleição de líder ou trava distribuída)
- C. Os fãs perdem a posição na fila
- D. A fila se divide em três filas independentes

??? success "Resposta"
    **B — três agendadores, três vezes a taxa.**

    O `ZPOPMIN` é atômico, então nenhum fã é admitido duas vezes, mas cada réplica retira os seus próprios N por segundo. A taxa de admissão é o botão de capacidade de toda a venda, então precisa ser aplicada uma vez só: um *worker* dedicado, um agendador com líder eleito ou uma trava distribuída como o ShedLock.

[Voltar ao lab](index.md){ .md-button }
