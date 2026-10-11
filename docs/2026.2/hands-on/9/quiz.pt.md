Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Mensageria com Kafka

**Q1.** O que `enable_auto_commit=False` faz no consumer Kafka?

- A. Desativa o mecanismo interno de retry do Kafka, obrigando a aplicação a tratar os retries manualmente
- B. Impede que o consumer faça o commit do offset até que `consumer.commit()` seja chamado explicitamente — garantindo que o offset só avance depois de um processamento bem-sucedido
- C. Diz ao Kafka para não persistir as mensagens em disco, reduzindo a latência do broker
- D. Desativa o protocolo de consumer group, fazendo o consumer ler cada partição de forma independente

??? success "Resposta"
    **B — O offset só avança depois de um `consumer.commit()` explícito.**

    Com `enable_auto_commit=True` (o padrão), o Kafka faz o commit do offset periodicamente, quer o processamento tenha dado certo ou não. Se o serviço cair entre o auto-commit e o fim do trabalho, a mensagem se perde silenciosamente. Definir `False` e chamar `consumer.commit()` só depois de um processamento bem-sucedido garante a entrega at-least-once: uma queda antes do commit faz a mensagem ser entregue de novo na próxima inicialização.

---

**Q2.** Por que `acks=all` é importante em produção, mesmo acrescentando latência?

- A. Comprime as mensagens antes do envio, reduzindo o uso de banda de rede ao custo de tempo de CPU
- B. Garante que o producer faça retries indefinidamente até que o broker confirme o recebimento
- C. Exige que todas as réplicas sincronizadas confirmem a escrita antes de o broker confirmá-la — evitando perda de dados se o broker líder falhar logo depois de aceitar a mensagem
- D. Só é relevante para consumers e não tem efeito no comportamento do producer

??? success "Resposta"
    **C — Todas as réplicas sincronizadas confirmam antes da confirmação, evitando perda de dados na falha do líder.**

    Com `acks=1` (padrão), o broker confirma a escrita assim que o líder da partição grava a mensagem em seu log local. Se o líder cair antes de replicá-la para os followers, a mensagem se perde. Com `acks=all`, o broker espera que todas as réplicas sincronizadas persistam a escrita antes de responder — a mensagem sobrevive a um failover do líder. Combinado com `enable.idempotence=true`, isso dá ao producer semântica exactly-once.

---

**Q3.** O notification-service processa o mesmo `orderId` duas vezes por causa de uma queda antes do commit. Como o consumer idempotente deve lidar com isso?

- A. Lançar uma exceção e enviar a duplicata para a DLQ
- B. Processar o evento normalmente — o processamento duplicado é inevitável e aceitável
- C. Verificar se uma notificação já foi enviada para esse `orderId` antes de agir; pular o envio se já existir um registro
- D. Aumentar o fator de replicação do consumer group para evitar duplicatas no nível do broker

??? success "Resposta"
    **C — Verificar se já existe um registro do `orderId` e pular se ele já foi processado.**

    Idempotência significa que aplicar a mesma operação várias vezes produz o mesmo resultado que aplicá-la uma vez. O consumer deve manter um armazenamento (banco de dados, set no Redis ou log) dos valores de `orderId` já processados. Antes de enviar um e-mail, ele consulta esse armazenamento: se o `orderId` já estiver lá, o evento é confirmado e ignorado. Esse padrão é essencial sempre que se usa entrega at-least-once — que é o padrão do Kafka.

---

**Q4.** Qual é a finalidade do `group_id` em um consumer Kafka?

- A. Identifica o cluster Kafka ao qual o consumer se conecta
- B. Define o número máximo de consumers que podem ler uma única partição simultaneamente
- C. Agrupa consumers em uma unidade lógica que lê um tópico coletivamente — o Kafka acompanha o offset commitado por grupo, e cada partição é atribuída a exatamente um consumer dentro do grupo
- D. Criptografa a conexão do consumer com o broker usando uma chave compartilhada do grupo

??? success "Resposta"
    **C — Agrupa consumers em uma unidade com controle de offset compartilhado; cada partição vai para um membro.**

    Quando várias instâncias do notification-service estão rodando, todas compartilham `group_id="notification-group"`. O Kafka distribui as partições do tópico entre os membros do grupo, de modo que cada mensagem seja processada por exatamente uma instância — o que permite escalar os consumers horizontalmente. Se o group_id fosse único por instância, cada instância receberia todas as mensagens de forma independente, gerando notificações de e-mail duplicadas.

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

**Q6.** O que a métrica de lag de consumer group do Kafka UI informa?

- A. O número de mensagens que o producer publicou, mas que o broker ainda não persistiu em disco
- B. A diferença entre o offset mais recente do tópico e o último offset commitado de um consumer group — indicando o quanto o consumer está atrasado
- C. O tempo médio, em milissegundos, entre a publicação de uma mensagem e seu recebimento pelo consumer
- D. O número de partições que não têm nenhum consumer ativo atribuído

??? success "Resposta"
    **B — A distância entre o offset mais recente do tópico e o offset commitado do consumer group.**

    Um lag de 0 significa que o consumer está acompanhando em tempo real. Um lag crescente indica que o consumer é mais lento que o producer — as mensagens estão se acumulando. No notification-service, um lag persistente significa confirmações por e-mail atrasadas. As soluções mais comuns são aumentar o número de instâncias do consumer (dentro do número de partições) ou otimizar a lógica de processamento. O Kafka UI mostra o lag por partição, o que facilita identificar um consumo desigual entre as partições.

---

**Q7.** Por que `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092` é a configuração correta para o Docker Compose (usando o nome do serviço, e não `localhost`)?

- A. `localhost` é reservado para a conexão com o Zookeeper; o Kafka precisa de um hostname separado
- B. Os brokers Kafka usam `KAFKA_ADVERTISED_LISTENERS` para dizer aos clientes a qual endereço se conectar depois do bootstrap inicial; dentro do Docker Compose, os outros containers resolvem os nomes de serviço pelo DNS interno do Docker, então `kafka:9092` é alcançável, enquanto `localhost:9092` se referiria à interface de loopback de cada container
- C. A imagem da Confluent Platform não aceita `localhost` como endereço de listener por uma restrição de licença
- D. Usar `localhost` exporia o broker Kafka na máquina host, criando uma vulnerabilidade de segurança

??? success "Resposta"
    **B — O DNS interno do Docker resolve os nomes de serviço; `localhost` dentro de um container se refere ao loopback do próprio container.**

    Quando o container do order-service se conecta a `kafka:9092`, o DNS embutido do Docker resolve `kafka` para o IP interno do container do Kafka. Se `KAFKA_ADVERTISED_LISTENERS` fosse `localhost:9092`, o broker anunciaria um endereço que só leva de volta a ele mesmo — todo cliente que tentasse se conectar chegaria ao próprio loopback em vez de ao broker. Usar o nome do serviço torna o endereço anunciado válido a partir de qualquer container na mesma rede Docker.

---

**Q8.** Que problema o padrão DLQ (Dead Letter Queue) resolve?

- A. Limitar o producer quando ele publica mais rápido do que o broker consegue replicar
- B. Comprimir mensagens grandes que excedem o tamanho máximo de mensagem do broker
- C. Evitar que uma única mensagem impossível de processar ("poison pill") bloqueie o consumer indefinidamente — as mensagens que falham são movidas para um tópico separado para inspeção e reprocessamento posteriores, permitindo que o consumer continue processando o resto do fluxo
- D. Distribuir as partições de forma uniforme entre os membros do consumer group para reduzir o lag

??? success "Resposta"
    **C — Tira do caminho as mensagens impossíveis de processar, para que não bloqueiem o fluxo do consumer.**

    Sem uma DLQ, uma única mensagem malformada ou impossível de processar faria o consumer tentar de novo indefinidamente, bloqueando todas as mensagens seguintes daquela partição. O padrão DLQ captura a exceção, publica a mensagem problemática em `order-events-dlq`, faz o commit do offset original e segue em frente. Os times de operações podem então inspecionar a DLQ, corrigir a causa raiz e reprocessar os eventos depois que o consumer for corrigido — sem perder nenhum dado.
