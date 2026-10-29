Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Síncrono vs assíncrono { #synchronous-vs-asynchronous }

**Q1.** A compra no BoxOffice chama o `order` (99,95%) e depois, de forma síncrona, `notification`, `search` e `analytics` (99,9% cada). O time troca as três chamadas seguintes por um evento publicado no Kafka (99,95%). O que acontece com a disponibilidade da compra?

- A. Continua a mesma: os mesmos serviços estão envolvidos
- B. Vai de cerca de 99,65% para cerca de 99,90%
- C. Vai de cerca de 99,9% para 100%, porque eventos nunca falham
- D. Piora, porque o Kafka é mais um componente na cadeia

??? success "Resposta"
    **B — de cerca de 99,65% para cerca de 99,90%.**

    De forma síncrona, a compra precisa dos quatro: $0.9995 \times 0.999^3 \approx 0.9965$. Com eventos, ela precisa só do `order` e do broker: $0.9995 \times 0.9995 \approx 0.9990$. Os serviços seguintes ainda podem falhar, mas agora a falha deles atrasa um e-mail ou uma atualização de índice em vez de derrubar uma venda. O Kafka é de fato mais um componente (D), mas ele substitui três dependências síncronas.

---

**Q2.** Durante uma flash sale, requisições de compra entram em uma fila a **5.000 por segundo durante 2 minutos**, e os workers processam **3.000 por segundo**. Ignorando o tráfego antes e depois, qual é o backlog no fim do pico, e quanto tempo espera a última requisição?

- A. 240.000 mensagens; cerca de 80 segundos
- B. 600.000 mensagens; cerca de 200 segundos
- C. 240.000 mensagens; cerca de 48 segundos
- D. 120.000 mensagens; cerca de 40 segundos

??? success "Resposta"
    **A — 240.000 mensagens; cerca de 80 segundos.**

    O backlog cresce na diferença das taxas: $(5000 - 3000) \times 120 = 240{,}000$. Pela Lei de Little, o tempo de espera é o backlog dividido pelo throughput que o escoa: $240{,}000 / 3000 = 80$ s. (600.000 é o total que chegou, não o backlog; 48 s seria dividir pela taxa de chegada.)

---

**Q3.** O backlog da fila `ticket-pdf` cresceu sem parar por três dias, tanto nas horas calmas quanto nas movimentadas. O que isso indica?

- A. Nada: filas existem para absorver carga
- B. A taxa média de chegada está acima da capacidade dos consumidores; a fila está escondendo uma falta permanente de capacidade, não absorvendo um pico
- C. O visibility timeout está longo demais
- D. O broker está ficando sem disco e precisa ser trocado pelo Kafka

??? success "Resposta"
    **B — uma falta permanente de capacidade.**

    Uma fila absorve picos: o backlog cresce durante o pico e escoa quando as chegadas caem abaixo da capacidade. Um backlog que cresce mesmo nas horas calmas significa que os consumidores são mais lentos que os produtores *na média*; nenhum tamanho de fila resolve isso. Adicione capacidade (mais workers, ou workers mais rápidos), reduza o trabalho ou descarte parte dele — e alerte sobre a idade da mensagem mais antiga para que isso seja percebido em horas, não em dias.

---

## Filas e pub/sub { #queues-and-pubsub }

**Q4.** Um worker de PDF leva **45 s** para gerar um pacote grande de ingressos, e o **visibility timeout do SQS é de 30 s**. O que acontece?

- A. A mensagem é apagada depois de 30 s e o PDF se perde
- B. O SQS espera automaticamente o worker terminar
- C. A mensagem volta a ficar visível enquanto o primeiro worker ainda a processa, então um segundo worker também a processa — todo job lento roda (pelo menos) duas vezes
- D. O worker recebe uma exceção de timeout e para

??? success "Resposta"
    **C — o job lento é processado duas vezes.**

    O visibility timeout só esconde a mensagem; se nenhum ack chega antes de ele expirar, o broker supõe que o consumidor morreu e reentrega. Defina o timeout acima do p99 do tempo de processamento (ou estenda-o enquanto trabalha, com `ChangeMessageVisibility`), e mantenha o consumidor idempotente de qualquer forma — a reentrega também acontece depois de crashes reais.

---

**Q5.** Por que o BoxOffice coloca uma **sala de espera** (uma fila na borda) na frente do fluxo de compra às 10:00?

- A. Para vender ingressos mais rápido, processando os dois milhões de requisições em paralelo
- B. Para admitir fãs na taxa que o `inventory` aguenta com segurança, dar a todos uma posição honesta e avisar quem chegou tarde que "esgotou" sem tocar no banco de dados
- C. Para fazer cache do mapa de lugares na CDN
- D. Para tornar as compras assíncronas, de modo que os fãs recebam seus lugares por e-mail

??? success "Resposta"
    **B — admissão a uma taxa controlada.**

    Mandar dois milhões de fãs para o caminho de reserva de uma vez não vende mais rápido; satura o banco de dados e faz todo mundo falhar. A sala de espera transforma o pico em um backlog ordenado, admite fãs a uma taxa derivada do throughput medido do `inventory` (com margem) e responde "esgotou" pela borda quando o inventário acaba. A compra em si continua síncrona para o fã admitido (D está errada).

---

**Q6.** O time de dados quer carregar no warehouse todos os eventos de pedido dos **últimos sete dias**, inclusive eventos publicados antes de o carregador existir. Qual forma de mensageria permite isso diretamente?

- A. Uma fila ponto a ponto com consumidores concorrentes
- B. Pub/sub efêmero (Redis Pub/Sub)
- C. Uma assinatura de pub/sub criada hoje
- D. Um log (Kafka ou outro event stream) com 7 dias de retenção: um consumer group novo começa no offset mais antigo

??? success "Resposta"
    **D — um log com retenção.**

    Em uma fila, mensagens consumidas são apagadas; uma assinatura nova só recebe mensagens publicadas depois de sua criação; o pub/sub efêmero não guarda nada. Um log mantém os registros até a retenção expirar, independentemente de quem os leu, então um consumer group novo com `auto.offset.reset=earliest` lê a semana inteira.

---

## Kafka

**Q7.** `order-events` tem **8 partições**. O serviço `notification` roda **12 instâncias** no mesmo consumer group. Quantas instâncias recebem registros?

- A. 12 — o Kafka balanceia os registros entre todas as instâncias
- B. 8 — cada partição é atribuída a um consumidor do grupo; 4 instâncias ficam ociosas
- C. 4 — o Kafka atribui duas partições por instância
- D. 1 — só o líder do grupo lê

??? success "Resposta"
    **B — 8 ativas, 4 ociosas.**

    Dentro de um grupo, cada partição pertence a exatamente um consumidor (é assim que a ordem por partição é preservada). O paralelismo máximo de um grupo é o número de partições. Para usar 12 instâncias você precisa de pelo menos 12 partições — por isso as partições são dimensionadas com folga desde o início.

---

**Q8.** Um desenvolvedor define a chave de `order-events` como **`eventId`** (o show) "para que todas as compras de um show fiquem juntas". Na abertura de vendas do estádio, 60% das compras são para um único show. Qual é a principal consequência?

- A. Nenhuma: o Kafka espalha registros com a mesma chave entre partições
- B. Throughput maior, porque registros relacionados vão no mesmo lote
- C. Uma partição quente recebe cerca de 60% do tráfego; um consumidor faz a maior parte do trabalho e adicionar consumidores não ajuda
- D. Registros do mesmo pedido são lidos fora de ordem

??? success "Resposta"
    **C — uma partição quente.**

    O particionador padrão manda chaves iguais para a mesma partição, então uma chave dominante concentra a carga em uma partição, um broker e um consumidor. Escolha a chave mais fina que ainda preserve a ordem de que o negócio precisa: compras precisam de ordem por pedido, então a chave é `orderId`.

---

**Q9.** Um tópico tem **fator de replicação 3** e **`min.insync.replicas=2`**; os produtores usam **`acks=all`**. Dois dos três brokers que guardam uma partição falham. O que acontece com as escritas nessa partição?

- A. Continuam normalmente no broker que sobrou
- B. São aceitas com `acks=1` automaticamente
- C. São rejeitadas (réplicas sincronizadas insuficientes) até pelo menos mais uma réplica voltar a estar sincronizada — nenhuma escrita confirmada pode existir em uma única máquina
- D. O Kafka elege uma réplica dessincronizada como líder para continuar aceitando escritas

??? success "Resposta"
    **C — rejeitadas até haver duas réplicas sincronizadas.**

    Com um broker fora, restam duas réplicas e as escritas continuam. Com dois fora, só uma réplica está sincronizada, abaixo de `min.insync.replicas=2`, então o broker recusa escritas com `acks=all` (`NotEnoughReplicas`). Esse é o objetivo da configuração: priorizar durabilidade sobre disponibilidade para eventos de negócio. D descreve a eleição de líder "unclean", desabilitada por padrão porque pode perder dados confirmados.

---

**Q10.** O consumidor de `analytics` processa **25 registros por segundo por partição** (ele grava cada registro em uma tabela de staging do warehouse). O pico-alvo é **600 registros por segundo**, e o lado do produtor não é gargalo. Qual é o número mínimo de partições?

- A. 6
- B. 24
- C. 25
- D. 600

??? success "Resposta"
    **B — 24.**

    $N \ge T / c = 600 / 25 = 24$ partições, um consumidor por partição. Na prática você arredondaria para cima pensando no crescimento (por exemplo, 32), porque adicionar partições depois move chaves entre partições. Outra opção é o consumidor gravar em lotes e aumentar $c$.

---

## Semântica de entrega { #delivery-semantics }

**Q11.** O `notification` faz o commit do offset **depois** de enviar o e-mail. O pod é derrubado durante um deploy logo depois de o e-mail ser enviado e antes do commit. O que acontece, e qual é a correção certa?

- A. O e-mail se perde; faça o commit antes de enviar
- B. O registro é reentregue e o e-mail é enviado de novo; torne o consumidor idempotente (deduplicação por id do evento, chave de idempotência para o provedor)
- C. O Kafka detecta a duplicata automaticamente graças ao produtor idempotente
- D. Nada: as transações do Kafka tornam o e-mail exactly-once

??? success "Resposta"
    **B — duplicata; torne o consumidor idempotente.**

    Fazer o commit depois de processar dá entrega at-least-once: depois do crash, o novo dono da partição continua do último offset confirmado e processa o registro de novo. Fazer o commit antes (A) troca duplicatas por perdas. O produtor idempotente (C) só elimina duplicatas entre produtor e broker, e as transações do Kafka (D) não cobrem um efeito colateral fora do Kafka, como um e-mail.

---

**Q12.** Qual implementação de consumidor idempotente está **correta**?

- A. Verificar `processed_events` pelo id do evento; se não existir, processar; numa transação separada, depois, inserir o id
- B. Inserir o id do evento em `processed_events` (chave única) e aplicar a mudança de negócio **na mesma transação do banco**; pular se o insert encontrar conflito; fazer o commit do offset depois
- C. Gerar um UUID novo a cada entrega e guardá-lo
- D. Manter os ids processados na memória do consumidor

??? success "Resposta"
    **B — linha de deduplicação e mudança de negócio em uma transação.**

    Se o serviço cai antes do commit, nem a linha de deduplicação nem a mudança existem, e a reentrega é processada normalmente; depois do commit, a reentrega bate na chave única e é pulada. A deixa uma janela em que um crash duplica ou perde a mudança; C anula a deduplicação (o id precisa pertencer ao evento, criado uma vez pelo produtor); D se perde no restart e não é compartilhado entre instâncias.

---

**Q13.** O BoxOffice adiciona um campo ao `OrderConfirmed`. Qual mudança é **compatível** nas duas direções (compatibilidade full), de modo que produtores e consumidores possam ser implantados em qualquer ordem?

- A. Renomear `total` para `totalCents`
- B. Mudar `total` de um número em reais para um número em centavos
- C. Adicionar `currency` com valor default `"BRL"`
- D. Remover o campo obrigatório `orderId`

??? success "Resposta"
    **C — adicionar um campo opcional com default.**

    Consumidores novos lendo registros antigos recebem o default; consumidores antigos ignoram o campo novo. Renomear (A) e remover um campo obrigatório (D) quebram os leitores; mudar o significado de um campo (B) é pior — não quebra nada visivelmente e calcula valores errados. Mudanças incompatíveis vão para uma nova versão do tópico.

---

## Padrões { #patterns }

**Q14.** O `order` confirma o pedido no PostgreSQL e depois publica `OrderConfirmed` no Kafka. De vez em quando, um pedido confirmado nunca gera um e-mail. Qual é a correção padrão?

- A. Publicar no Kafka primeiro e depois fazer o commit no banco
- B. Tentar a publicação três vezes
- C. Um transactional outbox: inserir o evento em uma tabela `outbox` na mesma transação do pedido e deixar um relay (polling ou CDC) publicá-lo pelo menos uma vez
- D. Usar uma transação distribuída (2PC) entre o PostgreSQL, o Kafka e o provedor de pagamento

??? success "Resposta"
    **C — transactional outbox.**

    O problema é uma escrita dupla: dois sistemas, nenhuma transação compartilhada, e um crash entre as escritas perde o evento. Inverter a ordem (A) cria eventos fantasmas; retries (B) não ajudam se o processo morre; o 2PC (D) não é suportado pelo provedor externo e bloqueia os participantes quando o coordenador falha. O outbox torna o evento parte da transação local; o relay o publica, talvez duas vezes, então os consumidores continuam idempotentes.

---

**Q15.** Na saga de compra, o provedor de pagamento **não responde** à cobrança dentro do timeout. O que o orquestrador deve fazer?

- A. Liberar os lugares e cancelar o pedido imediatamente — sem resposta significa sem cobrança
- B. Cobrar de novo com uma nova chave de idempotência
- C. Consultar o provedor usando a chave de idempotência do pedido (ou esperar o webhook dele) e reconciliar: seguir com a saga se a cobrança foi feita, compensar só se ela não aconteceu
- D. Marcar o pedido como `CONFIRMED`, já que a maioria dos pagamentos é aprovada

??? success "Resposta"
    **C — reconciliar antes de compensar.**

    Um timeout significa "desconhecido", não "falhou": a cobrança pode ter sido feita e só a resposta se perdeu. Compensar às cegas (A) deixa um cliente cobrado sem ingressos; uma nova chave de idempotência (B) arrisca uma cobrança dupla; supor sucesso (D) entrega lugares de graça. Consulte pela chave de idempotência original e então continue (lugares `SOLD`, pedido `CONFIRMED`) ou compense (libere os lugares, cancele o pedido).
