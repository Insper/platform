Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Mensageria com Kafka

**Q1.** Quando o listener container do Spring Kafka do `consumer-service` confirma o offset, por padrão?

- A. A cada 5 segundos, tenha o listener terminado ou não — o auto-commit do Kafka
- B. Depois que o método `@KafkaListener` retornou para todos os registros de um poll (`AckMode.BATCH`, com `enable.auto.commit=false`)
- C. Antes de chamar o listener, para que um listener lento nunca segure a partição
- D. Nunca: o próprio listener precisa chamar `commit()`

??? success "Resposta"
    **B — Depois que o listener retornou para todos os registros do poll.**

    O container define `enable.auto.commit=false` (a menos que você o defina) e ele mesmo confirma os offsets quando os registros de um poll foram processados. Uma queda antes desse commit faz os registros voltarem no próximo poll — entrega at-least-once. O auto-commit do próprio Kafka (A) confirmaria por tempo, com o processamento dando certo ou não, e poderia perder uma mensagem; confirmar antes de processar (C) perderia uma mensagem a cada queda.

---

**Q2.** O `KafkaProducerConfig` da referência define só o endereço do broker e os dois serializadores. Por que as escritas dele já estão protegidas contra a falha do líder e contra duplicatas de retries?

- A. Porque o `StringSerializer` acrescenta um checksum que o broker verifica
- B. Porque desde o Kafka 3.0 os padrões do produtor são `acks=all` (todas as réplicas em sincronia confirmam) e `enable.idempotence=true` (um envio repetido não é gravado duas vezes)
- C. Porque o `KafkaTemplate.send` é síncrono e espera todos os consumidores
- D. Não estão: `acks=1` é o padrão, então a configuração precisa definir `acks=all`

??? success "Resposta"
    **B — Os padrões do produtor são `acks=all` e idempotência ligada, desde o Kafka 3.0.**

    Com `acks=all`, o líder só responde depois que todas as réplicas em sincronia têm o registro, então um líder que morre logo depois da escrita não o leva junto. Com idempotência, o broker descarta um lote repetido que já gravou, então um retry depois de um timeout não duplica a mensagem na partição. (No único broker do lab, `acks=all` não muda nada — não há outra réplica.) O `send` é assíncrono (C) e nunca espera consumidores; D era verdade antes do Kafka 3.0.

---

**Q3.** O notification-service é morto depois de enviar o e-mail de um pedido, mas antes de o container confirmar. Como um consumidor idempotente deve tratar a reentrega?

- A. Lançar uma exceção, para que a duplicata vá para o dead-letter topic
- B. Processar o evento normalmente — processar em duplicidade é inevitável e aceitável
- C. Verificar, num armazenamento durável, se esse id de pedido já foi notificado; pular o envio se já foi
- D. Guardar os ids de pedido notificados num `HashSet` em memória e pular os ids encontrados ali

??? success "Resposta"
    **C — Verificar um registro durável do id do pedido e pular se ele já foi processado.**

    Idempotência significa que processar o mesmo evento duas vezes dá o mesmo resultado que uma vez. O consumidor registra os ids de pedido que notificou num armazenamento durável — uma tabela com o id do pedido como chave primária, `INSERT … ON CONFLICT DO NOTHING` — e envia o e-mail só quando o insert acrescentou uma linha. Um conjunto em memória (D) some justamente na queda que causa a reentrega. Isso é essencial sempre que a entrega é at-least-once, o padrão do Kafka.

---

**Q4.** Qual é a finalidade do `groupId` de um `@KafkaListener` (`"store"` na referência, `"notification-group"` na loja)?

- A. Identifica o cluster Kafka ao qual o consumer se conecta
- B. Define o número máximo de consumers que podem ler uma mesma partição ao mesmo tempo
- C. Agrupa consumers em uma unidade lógica que lê um tópico em conjunto — o Kafka controla o offset commitado por grupo e cada partição é atribuída a exatamente um consumer dentro do grupo
- D. Criptografa a conexão do consumer com o broker usando uma chave compartilhada pelo grupo

??? success "Resposta"
    **C — Agrupa consumers em uma unidade com controle de offset compartilhado; cada partição vai para um membro.**

    Quando várias instâncias do notification-service rodam, todas compartilham `groupId = "notification-group"`. O Kafka distribui as partições do tópico entre os membros, de modo que cada mensagem seja processada por exatamente uma instância — escala horizontal de consumers, até o número de partições. Se cada instância tivesse o seu próprio grupo, cada uma receberia todas as mensagens e cada cliente receberia um e-mail por instância.

---

**Q5.** O order-service publica em `order-events`. Dois novos serviços (analytics-service, fraud-service) também precisam desses eventos. Que mudança é necessária no order-service?

- A. Adicionar mais duas chamadas `kafkaTemplate.send()` para enviar os eventos aos tópicos dedicados dos novos serviços
- B. Registrar os novos serviços como assinantes na configuração do order-service
- C. Nenhuma — os outros consumers entram em um consumer group diferente e consomem do mesmo tópico de forma independente
- D. Dividir o tópico `order-events` em três partições, uma por serviço consumidor

??? success "Resposta"
    **C — Nenhuma mudança. Os outros consumers entram em um consumer group diferente e consomem do mesmo tópico de forma independente.**

    Esse é o principal benefício de desacoplamento do Kafka em relação ao REST. Cada consumer group mantém seu próprio ponteiro de offset no tópico. `analytics-group` e `fraud-group` recebem, cada um, todas as mensagens de `order-events` de forma independente, no seu próprio ritmo, sem que o order-service saiba que eles existem. Com REST, o order-service precisaria de uma chamada explícita para cada serviço downstream — cada novo assinante exigiria uma mudança de código no publicador.

---

**Q6.** O que a coluna `LAG` do `kafka-consumer-groups.sh --describe` informa?

- A. O número de mensagens que o producer publicou, mas que o broker ainda não persistiu em disco
- B. A diferença entre o offset final do log de uma partição e o offset confirmado do grupo — o quanto o consumidor está atrasado
- C. O tempo médio, em milissegundos, entre a publicação de uma mensagem e seu recebimento pelo consumer
- D. O número de partições que não têm nenhum consumer ativo atribuído

??? success "Resposta"
    **B — A distância entre o offset final do log da partição e o offset confirmado do grupo.**

    Um atraso de 0 significa que o consumidor está acompanhando. Um atraso crescente significa que o consumidor é mais lento que o produtor — ou está fora do ar, como na seção 5.2, em que três mensagens esperaram com atraso 3 até o consumidor voltar. No notification-service, um atraso persistente significa e-mails de confirmação atrasados. As soluções mais comuns são mais instâncias do consumidor (até o número de partições) ou um processamento mais rápido. A ferramenta mostra o atraso por partição, o que revela um consumo desigual.

---

**Q7.** Por que `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092` é a configuração correta para o Docker Compose (usando o nome do serviço e não `localhost`)?

- A. `localhost` é reservado para o listener do controller KRaft; o tráfego dos clientes precisa de um hostname separado
- B. Os brokers Kafka usam `KAFKA_ADVERTISED_LISTENERS` para dizer aos clientes a qual endereço se conectar depois do bootstrap inicial; dentro do Docker Compose, os outros containers resolvem os nomes de serviço pelo DNS interno do Docker, então `kafka:9092` é alcançável, enquanto `localhost:9092` se referiria à interface de loopback de cada container
- C. A imagem oficial `apache/kafka` não aceita `localhost` como endereço de listener
- D. Usar `localhost` exporia o broker Kafka na máquina host, criando uma vulnerabilidade de segurança

??? success "Resposta"
    **B — O DNS interno do Docker resolve os nomes de serviço; `localhost` dentro de um container se refere ao loopback do próprio container.**

    Quando o container do order-service se conecta a `kafka:9092`, o DNS embutido do Docker resolve `kafka` para o IP interno do container do Kafka. Se `KAFKA_ADVERTISED_LISTENERS` fosse `localhost:9092`, o broker anunciaria um endereço que só leva de volta a ele mesmo — todo cliente que tentasse se conectar chegaria ao próprio loopback em vez de ao broker. Usar o nome do serviço torna o endereço anunciado válido a partir de qualquer container na mesma rede Docker.

---

**Q8.** O notification-service, com o `KafkaConsumerConfig` da seção 6.2 (sem error handler próprio), recebe uma mensagem que não é JSON. O que acontece?

- A. A partição trava para sempre: o consumidor tenta a mesma mensagem até alguém corrigi-la
- B. O `DefaultErrorHandler` do Spring Kafka tenta o registro 10 vezes, registra um `ERROR` e confirma o offset depois dele — o fluxo segue, mas a mensagem se perde
- C. A mensagem vai para `order-events-dlt` automaticamente
- D. A thread do consumidor morre e o container reinicia o serviço

??? success "Resposta"
    **B — 10 tentativas, uma linha de `ERROR` e o offset passa do registro.**

    O `DefaultErrorHandler` padrão usa `FixedBackOff(0, 9)`: dez entregas sem pausa, depois ele registra o registro (`Backoff … exhausted for order-events-0@1`) e confirma o offset dele, então os próximos registros passam. Nada trava — e nada guarda a mensagem. Um dead-letter topic (seção 8.3) muda o último passo: depois das tentativas, um `DeadLetterPublishingRecoverer` publica o registro em `order-events-dlt`, onde ele pode ser inspecionado e reprocessado. Nada vai para o DLT se você não o configurar (C).

---

**Q9.** `store-producer-example` agora tem 3 partições e duas instâncias do consumer-service as dividem. Nove mensagens são enviadas com `curl /producer/…` — o produtor as envia **sem chave**. O que você espera?

- A. Três mensagens por partição, em rodízio, então os dois consumidores trabalham
- B. As nove numa única partição, escolhida pelo particionador sticky do produtor — um consumidor trabalha, o outro pode ficar ocioso
- C. As mensagens são recusadas: um tópico com várias partições exige uma chave
- D. Cada mensagem vai para todas as partições, então os dois consumidores processam as nove

??? success "Resposta"
    **B — Um registro sem chave vai para a partição que o particionador sticky está enchendo.**

    Sem chave, o produtor não calcula hash nenhum: ele enche uma partição antes de passar a outra (KIP-794), o que forma lotes maiores. Um fluxo pequeno de mensagens manuais cai, então, numa única partição — na rodada do lab, a partição 1, offsets 0 a 8. É por isso que os eventos da loja levam o id do pedido como chave: a chave espalha os pedidos pelas partições **e** mantém em ordem os eventos de cada pedido numa delas.
