
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Conceitos fundamentais

**Q1.** Qual das alternativas abaixo descreve melhor a diferença entre um **evento**, um **comando** e uma **mensagem**?

- A. São termos equivalentes para o mesmo conceito em sistemas de mensageria
- B. Um comando é uma instrução que pode ser rejeitada; um evento é um registro imutável de algo que já aconteceu; uma mensagem é um contêiner genérico de dados que pode representar qualquer um dos dois
- C. Um evento é enviado a um único destinatário; um comando é transmitido a todos os consumidores; uma mensagem é armazenada em um banco de dados
- D. Um comando não carrega payload; um evento carrega um payload; uma mensagem carrega apenas metadados

??? success "Resposta"
    **B — Comando = instrução (pode ser rejeitada); evento = fato imutável; mensagem = contêiner genérico.**

    A distinção é semântica, mas importante para o projeto do sistema. Um comando (`PlaceOrder`) expressa uma intenção e pressupõe um único handler, que pode rejeitá-lo. Um evento (`OrderCreated`) é a afirmação de um fato — já aconteceu e não pode ser desfeito. Mensagem é o termo neutro, do nível de transporte, que engloba os dois. Usar o vocabulário certo evita ambiguidade sobre quem é dono da decisão.

---

**Q2.** No Kafka, quando um tópico tem 3 partições e um grupo de consumidores tem 3 consumidores, como as partições são atribuídas?

- A. Os 3 consumidores leem as 3 partições simultaneamente, triplicando a vazão
- B. Cada partição é atribuída a exatamente um consumidor do grupo; cada consumidor é dono de uma partição
- C. O Kafka entrega cada mensagem aleatoriamente a qualquer consumidor disponível, independentemente da partição
- D. Apenas um consumidor fica ativo por vez; os outros dois ficam em espera

??? success "Resposta"
    **B — Cada partição pertence a exatamente um consumidor do grupo.**

    O protocolo de atribuição de partições do Kafka garante que, dentro de um grupo de consumidores, cada partição seja consumida por exatamente um consumidor por vez. Isso assegura processamento ordenado e sem duplicação dentro de uma partição. Com 3 partições e 3 consumidores, a atribuição é 1:1. Se um consumidor sai do grupo, o Kafka dispara um rebalanceamento e reatribui a partição dele a um dos consumidores restantes.

---

**Q3.** Por que os eventos são considerados **imutáveis** em sistemas orientados a eventos?

- A. Porque o Kafka não suporta operações de atualização no nível do protocolo
- B. Porque a imutabilidade permite que os brokers comprimam os eventos de forma mais eficiente
- C. Porque os eventos registram algo que já aconteceu — o fato não pode mudar —, o que os torna seguros para reprocessar, auditar e usar como fonte de verdade confiável
- D. Porque os grupos de consumidores exigem um esquema fixo para interpretar as mensagens

??? success "Resposta"
    **C — Eventos são fatos sobre o passado; fatos não podem ser alterados retroativamente.**

    A imutabilidade é um princípio de projeto, não apenas uma restrição técnica. Se um evento pudesse ser alterado depois de publicado, os consumidores que já o processaram teriam uma visão da história diferente da dos consumidores que o processassem depois — destruindo a consistência. O log append-only é o que torna possíveis o event sourcing, a depuração com "viagem no tempo" e a reconstrução de projeções sem downtime.

---

**Q4.** Em uma arquitetura **CQRS**, qual lado trata as operações de escrita?

- A. O modelo de leitura, porque ele guarda o estado mais recente
- B. O query handler, que lê do event store e materializa uma projeção
- C. O command handler, que valida o comando, acrescenta um evento ao event store e o publica no barramento de eventos
- D. O API gateway, que roteia escritas e leituras para o mesmo serviço subjacente

??? success "Resposta"
    **C — O command handler é dono das escritas: valida, acrescenta o evento, publica.**

    O CQRS separa o caminho de escrita (comandos → command handler → event store / barramento de eventos) do caminho de leitura (consultas → modelo de leitura). O command handler garante as invariantes de negócio e produz eventos como saída. O modelo de leitura é uma projeção derivada e desnormalizada, atualizada de forma assíncrona a partir desses eventos. Essa separação permite otimizar e escalar cada lado de forma independente.

---

**Q5.** Um usuário inicia um login e o seu serviço precisa devolver um token de sessão antes de a resposta HTTP ser enviada. Qual estilo de comunicação é a escolha correta, e por quê?

- A. Evento assíncrono, porque publicar no Kafka é mais rápido do que uma ida e volta HTTP
- B. REST síncrono, porque quem chama precisa do resultado imediatamente para poder prosseguir
- C. Evento assíncrono com callback, para que a interface faça polling em busca do token
- D. Qualquer um dos dois — a escolha só afeta a arquitetura interna, não a latência percebida pelo usuário

??? success "Resposta"
    **B — REST síncrono, porque quem chama fica bloqueado esperando o resultado.**

    A pergunta decisiva para escolher entre síncrono e assíncrono é: *quem chama precisa da resposta antes de continuar?* Na autenticação, a resposta é sim — sem o token não há o que fazer em seguida. Padrões assíncronos introduzem indireção de latência (polling, webhooks, long-polling) que adiciona complexidade sem benefício quando o resultado é necessário imediatamente.

---

**Q6.** Qual é o propósito de uma **Dead Letter Queue (DLQ)**?

- A. Armazenar mensagens processadas com sucesso para que possam ser auditadas depois
- B. Segurar mensagens quando o broker está sob carga alta, liberando-as quando a carga cai
- C. Capturar mensagens que não puderam ser processadas depois de esgotadas as tentativas de retry, evitando que bloqueiem o stream principal e preservando-as para investigação
- D. Compactar o tópico removendo mensagens duplicadas com a mesma chave

??? success "Resposta"
    **C — A DLQ captura mensagens não processáveis sem bloquear o stream principal.**

    Sem uma DLQ, uma mensagem que sempre faz o consumidor lançar uma exceção seria reprocessada para sempre (travando o progresso) ou descartada silenciosamente (perdendo dados). A DLQ é uma válvula de segurança: as mensagens com falha são movidas para lá, o stream continua, e um operador pode inspecionar a mensagem, corrigir a causa raiz e reprocessá-la. O `@RetryableTopic` do Spring Kafka automatiza o agendamento dos retries e o roteamento para a DLQ.

---

**Q7.** O que o **controle de offsets por grupo de consumidores** permite que uma fila simples não permite?

- A. Permite que vários grupos independentes leiam o mesmo tópico, cada um no seu ritmo, sem interferir uns nos outros
- B. Impede que os consumidores leiam a mesma partição mais de uma vez por dia
- C. Criptografa as mensagens para que apenas o grupo com a chave correta consiga decodificá-las
- D. Limita a taxa com que os produtores podem publicar em um tópico

??? success "Resposta"
    **A — Cada grupo é dono do seu próprio offset, então os grupos avançam de forma independente.**

    Em uma fila tradicional, uma vez consumida, a mensagem desaparece. No Kafka, a mensagem permanece no log e cada grupo de consumidores mantém seu próprio ponteiro (offset) por partição. O `notification-group` pode estar no offset 42 enquanto o `analytics-group` ainda está no offset 10 — ambos lendo o mesmo tópico sem interferência. É isso que torna possível, em escala, o fan-out (pub/sub) para vários consumidores independentes.

---

**Q8.** Em **event sourcing**, o que significa "reprocessar os eventos" (replay), e por que isso é útil?

- A. Reenviar eventos com falha aos consumidores que não confirmaram o recebimento
- B. Republicar eventos em um novo tópico para disparar novamente os serviços downstream
- C. Percorrer em ordem todo o histórico de eventos armazenados para reconstruir o estado atual de uma entidade, ou para popular do zero uma nova projeção do modelo de leitura
- D. Sincronizar o event store com um banco relacional reexecutando comandos SQL

??? success "Resposta"
    **C — O replay reconstrói o estado percorrendo em ordem o histórico de eventos.**

    Como o event store é append-only e imutável, o histórico completo está sempre disponível. Reprocessar significa percorrer os eventos a partir do offset 0 (ou de um snapshot) e aplicar cada evento a um agregado em memória até chegar ao estado atual. Isso permite construir projeções inteiramente novas, migrar para um novo esquema ou depurar inspecionando como o sistema estava em qualquer momento do passado.

---

**Q9.** Qual é a principal diferença operacional entre **pub/sub (fan-out)** e **consumidores concorrentes**?

- A. No pub/sub, cada grupo de consumidores recebe uma cópia completa de cada mensagem; nos consumidores concorrentes, vários consumidores de um mesmo grupo dividem as partições, de modo que cada mensagem é processada por exatamente um consumidor
- B. O pub/sub exige um broker dedicado por consumidor; os consumidores concorrentes compartilham um único broker
- C. Consumidores concorrentes só são possíveis com RabbitMQ, não com Kafka
- D. No pub/sub, apenas um consumidor pode estar ativo por vez; nos consumidores concorrentes, todos rodam em paralelo sobre a mesma mensagem

??? success "Resposta"
    **A — Fan-out = cada grupo recebe uma cópia; consumidores concorrentes = um grupo divide o trabalho.**

    A distinção é determinada pela participação nos grupos de consumidores. Coloque `email-service`, `analytics-service` e `audit-service` em grupos separados → cada um recebe todo evento `OrderCreated` (fan-out). Coloque três instâncias de `payment-processor` no mesmo grupo → o Kafka atribui cada partição a uma instância, então cada evento é processado uma vez (consumidores concorrentes). O mesmo tópico Kafka suporta os dois padrões ao mesmo tempo.

---

**Q10.** Dentro de uma única **partição** do Kafka, a ordem das mensagens é garantida. Por que a ordem **não** é garantida entre partições de um mesmo tópico?

- A. Porque o Kafka replica as partições em brokers diferentes, introduzindo atrasos de rede variáveis
- B. Porque cada partição é um log ordenado independente, com sua própria sequência de offsets; uma mensagem na partição 0 no offset 5 e uma mensagem na partição 1 no offset 3 não têm relação temporal definida — o consumidor as recebe conforme a que for obtida primeiro no poll
- C. Porque os grupos de consumidores leem as partições em ordem inversa por padrão, para equilibrar a carga
- D. Porque o Kafka usa timestamps em vez de offsets para ordenar entre partições, e os relógios nunca estão perfeitamente sincronizados

??? success "Resposta"
    **B — Cada partição é um log independente; offsets não são comparáveis entre partições.**

    Uma partição é uma sequência ordenada e append-only. Dentro da partição 0, você sabe que a mensagem no offset 5 veio depois da do offset 4. Mas o offset 5 da partição 0 e o offset 3 da partição 1 foram escritos de forma independente — não há um número de sequência global que os ligue. Se for necessária ordem global estrita, use uma única partição (ao custo do paralelismo) ou inclua um timestamp no nível da aplicação e ordene na leitura.

---

**Q11.** O order service publica `OrderCreated`, `OrderPaid` e `OrderShipped` de cada pedido em um tópico com 6 partições. O consumidor de entregas precisa ver os eventos de um mesmo pedido em sequência. O que o produtor deve fazer?

- A. Publicar sem chave, para que o Kafka distribua a carga de forma equilibrada
- B. Usar o `orderId` como chave da mensagem, para que todos os eventos de um pedido caiam na mesma partição
- C. Usar um único consumidor para o tópico inteiro
- D. Adicionar um timestamp a cada evento; o Kafka ordena as mensagens por timestamp entre partições

??? success "Resposta"
    **B — Usar o `orderId` como chave.**

    O particionador padrão calcula o hash da chave, então a mesma chave sempre vai para a mesma partição, e o Kafka garante a ordem dentro de uma partição. Pedidos diferentes continuam espalhados pelas 6 partições e são processados em paralelo. A opção A perde a ordem; C mantém a ordem apenas abrindo mão do paralelismo (e não resolve a ordem *entre* partições); D é falsa — o Kafka não reordena mensagens por timestamp.

---

**Q12.** O notification service faz o commit do offset no Kafka **depois** de enviar o e-mail. Ele cai logo após o envio, antes do commit. O que acontece no reinício, e o que o código deve fazer a respeito?

- A. A mensagem é perdida; não há nada a fazer
- B. A mensagem é lida de novo (entrega at-least-once); o consumidor precisa ser idempotente, por exemplo, ignorando pedidos que já notificou
- C. O Kafka detecta a queda e apaga a mensagem para que ela não seja processada duas vezes
- D. A mensagem vai automaticamente para a dead letter queue

??? success "Resposta"
    **B — Reentrega; torne o consumidor idempotente.**

    Fazer o commit depois de processar dá entrega **at-least-once**: o consumidor retoma a partir do último offset commitado e vê a mensagem de novo. Fazer o commit *antes* de processar daria at-most-once (mensagem perdida em vez de duplicada). As transações exactly-once do Kafka cobrem apenas processamento Kafka-para-Kafka, não um e-mail, então o projeto realista é at-least-once mais um consumidor idempotente (uma tabela de mensagens processadas, upserts ou restrições de unicidade).

---

**Q13.** O order service salva um pedido no Postgres e depois chama `kafkaTemplate.send(...)`. Que problema o **transactional outbox** resolve aqui?

- A. Torna o Kafka mais rápido agrupando mensagens em lotes no Postgres
- B. Elimina a necessidade de grupos de consumidores
- C. Evita a escrita dupla: o pedido e o evento são gravados na mesma transação local do banco, e um relay publica o evento depois, então uma queda não consegue mais deixar um pedido sem o seu evento (nem um evento sem o seu pedido)
- D. Garante que cada evento seja entregue exatamente uma vez a cada consumidor

??? success "Resposta"
    **C — Transforma duas escritas em dois sistemas em uma única transação local.**

    Sem o outbox, uma queda entre o commit no banco e a publicação perde o evento; um rollback depois da publicação produz um evento de um pedido que não existe. Com o outbox, as duas linhas são commitadas juntas, e um relay (polling ou CDC) publica o evento. O relay pode publicar duas vezes depois de uma queda, então D é falsa — os consumidores ainda precisam ser idempotentes.

---

**Q14.** Em uma saga coreografada, o estoque reserva os itens após `OrderCreated`, mas em seguida o payment service emite `PaymentFailed`. O que deve acontecer?

- A. O banco desfaz a reserva de estoque automaticamente, como em uma transação ACID
- B. O inventory service executa uma **transação de compensação** que libera o estoque, e o pedido é marcado como cancelado
- C. O order service tenta o pagamento de novo indefinidamente, até dar certo
- D. Nada — o estoque permanece reservado até que um operador corrija manualmente

??? success "Resposta"
    **B — Compensar os passos já realizados.**

    Cada passo da saga é uma transação local em um serviço e banco diferentes, então não há rollback global (A). Em vez disso, todo passo que pode ser desfeito tem uma ação de compensação — aqui, `StockReleased` — disparada pelo evento de falha, e o pedido passa para `CANCELLED`. As compensações, assim como os passos, precisam ser idempotentes, porque os eventos podem ser reentregues.
