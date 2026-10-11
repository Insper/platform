
Clique em **"Resposta"** para revelar a resposta correta e a explicação. Tente responder antes de revelar.

---

## Teorema CAP

**Q1.** O que significa o **P** em CAP e por que ele é inegociável em qualquer sistema distribuído real?

- A. Performance — sistemas lentos são considerados indisponíveis
- B. Persistência — os dados precisam sobreviver a reinicializações dos nós
- C. Tolerância a Partições — o sistema continua operando apesar de partições de rede
- D. Previsibilidade — as respostas precisam chegar dentro de um tempo limitado

??? success "Resposta"
    **C — Tolerância a Partições.**

    Partições de rede — em que mensagens entre nós são perdidas ou atrasadas — acontecem em qualquer sistema distribuído real por causa de falhas de hardware, congestionamento ou distância física. Como as partições não podem ser evitadas, a escolha prática de projeto é entre **C** (recusar requisições durante a partição) e **A** (continuar atendendo, possivelmente com dados desatualizados).

---

**Q2.** Um banco de dados distribuído recusa todas as leituras durante uma partição de rede para evitar retornar dados desatualizados. A qual categoria do CAP ele pertence?

- A. CA — Consistente e disponível
- B. CP — Consistente e tolerante a partições
- C. AP — Disponível e tolerante a partições
- D. Nenhuma — ele viola as três propriedades simultaneamente

??? success "Resposta"
    **B — CP.**

    Ao recusar leituras durante uma partição, o sistema prioriza a **consistência** (nada de dados desatualizados) em vez da disponibilidade. Quando a partição se resolve, o serviço é retomado. ZooKeeper e etcd são exemplos clássicos de CP.

---

**Q3.** Quais dos sistemas a seguir são tipicamente classificados como **AP** (disponível e tolerante a partições)?

- A. Apache ZooKeeper e etcd
- B. PostgreSQL e MongoDB
- C. Apache Cassandra e DNS
- D. Redis e SQLite

??? success "Resposta"
    **C — Apache Cassandra e DNS.**

    Ambos continuam atendendo requisições durante partições, aceitando que as respostas possam estar temporariamente desatualizadas (consistência eventual). ZooKeeper e etcd são CP; PostgreSQL e MongoDB são CP por padrão; o Redis em modo de nó único não é nenhum dos dois (é CA, irrealista para distribuição em produção).

---

**Q4.** O teorema PACELC estende o CAP. Do que trata a parte **ELC** que o CAP ignora?

- A. Mesmo quando uma partição se resolve, o sistema precisa reeleger um líder antes de atender
- B. Mesmo sem partição, o sistema precisa escolher entre Latência e Consistência
- C. Toda conexão perdida exige um Checkpoint antes que a operação normal seja retomada
- D. A consistência eventual é sempre preferível à consistência forte sob baixa carga

??? success "Resposta"
    **B — Mesmo sem partição: trade-off entre latência e consistência.**

    O CAP descreve apenas o comportamento durante uma partição. O PACELC acrescenta que, mesmo em operação normal, os sistemas precisam escolher entre **menor latência** (atender rapidamente, correndo o risco de leituras levemente desatualizadas) e **consistência mais forte** (esperar o acordo da replicação antes de responder). O Cassandra é PA/EL; o MongoDB é PC/EC.

---

**Q5.** Um serviço de pagamentos nunca pode permitir uma cobrança em dobro. Ocorre uma partição de rede entre o nó de pagamento e o nó de replicação. Qual projeto está correto?

- A. Usar um armazenamento AP — a disponibilidade garante que o pagamento sempre seja processado
- B. Usar um armazenamento CA — a garantia de nó único evita problemas de concorrência
- C. Usar um armazenamento CP — recusar a requisição durante a partição em vez de arriscar um estado inconsistente
- D. Usar um armazenamento AP com last-write-wins — os timestamps evitam duplicatas

??? success "Resposta"
    **C — Armazenamento CP.**

    Em transações financeiras, a correção é inegociável. Um armazenamento CP se recusa a processar o pagamento durante a partição (o cliente recebe um erro, e não uma cobrança em dobro). Um armazenamento AP poderia processar o pagamento em dois nós simultaneamente antes de a partição se resolver, criando uma transação duplicada que não pode ser desfeita com segurança.

---

**Q6.** Em qual cenário um **sistema CA** (consistente e disponível) é de fato viável?

- A. Em um cluster de três nós com replicação síncrona
- B. Em um sistema geograficamente distribuído com links dedicados
- C. Apenas em um sistema de uma única máquina ou em uma LAN rigidamente controlada, sem possibilidade de partições
- D. Nunca — CA é teoricamente impossível

??? success "Resposta"
    **C — Máquina única ou LAN rigidamente controlada.**

    CA só funciona quando partições realmente não podem ocorrer — o que só é realista para um único servidor ou para uma rede local sob controle estrito. Em qualquer implantação conectada à internet ou geograficamente distribuída, P é efetivamente obrigatório, e a escolha real fica entre C e A.

---

**Q7.** Nos termos do PACELC, como você classificaria um sistema que favorece **baixa latência** em operação normal e **disponibilidade** durante uma partição?

- A. PC/EC
- B. PA/EC
- C. PC/EL
- D. PA/EL

??? success "Resposta"
    **D — PA/EL.**

    PA = durante uma Partição, favorece a Disponibilidade (Availability). EL = senão (Else, operação normal), favorece a Latência. O Apache Cassandra é o sistema PA/EL canônico — ele sempre responde rapidamente e aceita consistência eventual nos dois cenários.

---

## Algoritmos de consenso

**Q8.** O que o **Teorema da Impossibilidade FLP** prova sobre o consenso distribuído?

- A. O consenso é impossível em qualquer sistema com mais de um nó
- B. Em um sistema puramente assíncrono com um único processo defeituoso que seja, nenhum algoritmo consegue garantir consenso em tempo limitado
- C. A eleição de líder sempre termina em um número fixo de rodadas
- D. Falhas bizantinas tornam o consenso impossível mesmo em redes síncronas

??? success "Resposta"
    **B — Não há garantia de tempo limitado em um sistema assíncrono com ≥1 nó defeituoso.**

    O FLP (Fischer, Lynch, Paterson, 1985) prova esse limite fundamental. Os algoritmos reais respondem a isso assumindo *sincronia parcial* (os atrasos são, em algum momento, limitados) ou sacrificando a vivacidade em condições adversas. É por isso que Raft e Paxos usam timeouts como aproximação para a detecção de falhas.

---

**Q9.** No Raft, que evento dispara uma nova **eleição de líder**?

- A. O líder atual envia uma mensagem `resign` ao cluster
- B. A maioria dos seguidores vota para remover o líder atual
- C. O timeout de eleição de um seguidor expira sem que ele receba um heartbeat do líder atual
- D. O cluster detecta que o log do líder divergiu do log dos seguidores

??? success "Resposta"
    **C — O timeout de eleição de um seguidor expira.**

    Cada seguidor mantém um timeout de eleição aleatório. Se nenhum heartbeat chegar antes de ele expirar, o seguidor assume que o líder caiu e inicia uma nova eleição, incrementando o termo e solicitando votos. Timeouts aleatórios evitam que vários seguidores iniciem eleições ao mesmo tempo.

---

**Q10.** Qual fórmula garante que qualquer quórum de leitura se sobreponha a qualquer quórum de escrita, assegurando que você sempre leia a escrita mais recente?

- A. W > N / 2
- B. R > N / 2
- C. W = R = N
- D. W + R > N

??? success "Resposta"
    **D — W + R > N.**

    Se o quórum de escrita W mais o quórum de leitura R excede o total de réplicas N, pelo menos um nó que confirmou a escrita também participa de qualquer quórum de leitura. Essa sobreposição garante que a escrita mais recente esteja sempre visível em uma leitura por quórum, e é a base de sistemas como o Dynamo e a consistência ajustável do Cassandra.
