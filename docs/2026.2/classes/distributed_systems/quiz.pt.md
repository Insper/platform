
Clique em **"Resposta"** para revelar a resposta correta e a explicação. Tente responder antes de revelar.

---

## Fundamentos

**Q1.** O serviço de pedidos chama o serviço de produtos para reservar uma unidade do estoque e não recebe resposta dentro do seu timeout de 2 segundos. O que ele pode concluir com segurança?

- A. O serviço de produtos caiu e precisa ser reiniciado
- B. A reserva não foi aplicada, então é seguro fazer um retry sem nenhuma precaução
- C. Nada com certeza — a requisição pode ter se perdido, ter sido aplicada com a resposta perdida ou ainda estar em andamento; um retry precisa ser idempotente
- D. A rede está particionada, então o serviço de pedidos precisa mudar para o modo CP

??? success "Resposta"
    **C — Nada com certeza; os retries precisam ser idempotentes.**

    Uma requisição perdida, um servidor que caiu, uma resposta perdida e um servidor muito lento parecem iguais para quem chama: silêncio. O timeout só diz "parei de esperar". Se a reserva de fato foi aplicada e a resposta se perdeu, um retry ingênuo reserva a unidade duas vezes. Tornar a operação idempotente (por exemplo, com um id único de requisição que o servidor usa para descartar duplicatas) torna o retry seguro.

---

**Q2.** Usando **relógios de Lamport**, o processo B tem o contador em 3 e recebe uma mensagem com o carimbo 7. Qual é o contador de B depois do evento de recebimento?

- A. 3
- B. 4
- C. 7
- D. 8

??? success "Resposta"
    **D — 8.**

    No recebimento, a regra é `max(local, received) + 1` = `max(3, 7) + 1` = 8. Isso garante que o evento de recebimento tenha um timestamp maior do que o evento de envio, de modo que a relação "aconteceu-antes" sempre se reflete nos timestamps. Note que a recíproca não vale: um timestamp de Lamport menor não prova causalidade — para isso são necessários relógios vetoriais.

---

## Teorema CAP

**Q3.** O que significa o **P** do CAP, e por que ele é inegociável em qualquer sistema distribuído real?

- A. Performance (desempenho) — sistemas lentos são considerados indisponíveis
- B. Persistence (persistência) — os dados precisam sobreviver a reinícios dos nós
- C. Partition Tolerance (tolerância a partições) — o sistema continua operando apesar de partições de rede
- D. Predictability (previsibilidade) — as respostas precisam chegar dentro de um tempo limitado

??? success "Resposta"
    **C — Partition Tolerance (tolerância a partições).**

    Partições de rede — em que as mensagens entre os nós são perdidas ou atrasadas — acontecem em qualquer sistema distribuído real, por falhas de hardware, congestionamento ou distância física. Como as partições não podem ser evitadas, a escolha prática de projeto é entre **C** (recusar requisições durante a partição) e **A** (continuar atendendo, possivelmente com dados desatualizados).

---

**Q4.** Um banco de dados distribuído recusa todas as leituras durante uma partição de rede para evitar devolver dados desatualizados. A qual categoria do CAP ele pertence?

- A. CA — Consistente e disponível
- B. CP — Consistente e tolerante a partições
- C. AP — Disponível e tolerante a partições
- D. Nenhuma — ele viola as três propriedades ao mesmo tempo

??? success "Resposta"
    **B — CP.**

    Ao recusar leituras durante uma partição, o sistema prioriza a **consistência** (nada de dados desatualizados) em detrimento da disponibilidade. Quando a partição se resolve, o serviço é retomado. ZooKeeper e etcd são exemplos clássicos de CP.

---

**Q5.** Quais dos sistemas a seguir costumam ser classificados como **AP** (disponíveis e tolerantes a partições)?

- A. Apache ZooKeeper e etcd
- B. PostgreSQL e MongoDB
- C. Apache Cassandra e DNS
- D. Redis e SQLite

??? success "Resposta"
    **C — Apache Cassandra e DNS.**

    Ambos continuam atendendo requisições durante partições, aceitando que as respostas possam estar temporariamente desatualizadas (consistência eventual). ZooKeeper e etcd são CP; o PostgreSQL com replicação síncrona e o MongoDB com as escritas por maioria padrão se comportam como CP. Um Redis ou SQLite de um único nó nem sequer é replicado, então o CAP não se aplica de verdade a ele — ele fica no canto "CA" apenas porque não há um segundo nó do qual ficar particionado.

---

**Q6.** O teorema PACELC estende o CAP. Do que trata a parte **ELC**, que o CAP ignora?

- A. Mesmo depois que uma partição se resolve, o sistema precisa reeleger um líder antes de atender
- B. Mesmo sem partição, o sistema precisa escolher entre latência e consistência
- C. Toda conexão perdida exige um checkpoint antes que a operação normal seja retomada
- D. A consistência eventual é sempre preferível à consistência forte sob carga baixa

??? success "Resposta"
    **B — Mesmo sem partição: trade-off entre latência e consistência.**

    O CAP só descreve o comportamento durante uma partição. O PACELC acrescenta que, mesmo na operação normal, os sistemas precisam escolher entre **latência menor** (atender rápido, arriscando leituras levemente desatualizadas) e **consistência mais forte** (esperar o acordo da replicação antes de responder). O Cassandra é PA/EL; o MongoDB com escritas por maioria é PC/EC.

---

**Q7.** Um serviço de pagamentos nunca pode permitir uma cobrança em dobro. Ocorre uma partição de rede entre o nó de pagamentos e o nó de replicação. Qual projeto é o correto?

- A. Usar um armazenamento AP — a disponibilidade garante que o pagamento sempre seja processado
- B. Usar um armazenamento CA — a garantia de nó único evita problemas de concorrência
- C. Usar um armazenamento CP — recusar a requisição durante a partição em vez de arriscar um estado inconsistente
- D. Usar um armazenamento AP com last-write-wins — os timestamps evitam duplicatas

??? success "Resposta"
    **C — Armazenamento CP.**

    Em transações financeiras, a correção é inegociável. Um armazenamento CP se recusa a processar o pagamento durante a partição (o cliente recebe um erro, e não uma cobrança em dobro). Um armazenamento AP poderia processar o pagamento em dois nós simultaneamente antes de a partição se resolver, criando uma transação duplicada que não pode ser desfeita com segurança. O last-write-wins (D) descartaria silenciosamente uma das escritas conflitantes, e depende de relógios que derivam.

---

**Q8.** Em que cenário um **sistema CA** (consistente e disponível) é de fato possível?

- A. Em um cluster de três nós com replicação síncrona
- B. Em um sistema geograficamente distribuído com enlaces dedicados
- C. Apenas em um sistema de uma única máquina ou em uma rede local rigidamente controlada, sem possibilidade de partições
- D. Nunca — CA é teoricamente impossível

??? success "Resposta"
    **C — Uma única máquina ou uma rede local rigidamente controlada.**

    CA só funciona quando partições realmente não podem ocorrer — o que só é realista para um único servidor ou para uma rede local sob controle rigoroso. Em qualquer implantação conectada à internet ou geograficamente distribuída, P é, na prática, obrigatório, e a escolha real fica entre C e A.

---

**Q9.** Em termos de PACELC, como você classificaria um sistema que favorece **baixa latência** durante a operação normal e **disponibilidade** durante uma partição?

- A. PC/EC
- B. PA/EC
- C. PC/EL
- D. PA/EL

??? success "Resposta"
    **D — PA/EL.**

    PA = durante uma partição (Partition), favorece a disponibilidade (Availability). EL = caso contrário (Else, operação normal), favorece a latência (Latency). O Apache Cassandra é o sistema PA/EL canônico — ele sempre responde rápido e aceita a consistência eventual nos dois cenários.

---

## Algoritmos de consenso

**Q10.** O que o **Teorema da Impossibilidade FLP** prova sobre o consenso distribuído?

- A. O consenso é impossível em qualquer sistema com mais de um nó
- B. Em um sistema puramente assíncrono, em que até mesmo um processo pode cair, nenhum algoritmo determinístico consegue garantir que o consenso seja sempre alcançado
- C. A eleição de líder sempre termina em um número fixo de rodadas
- D. Falhas bizantinas tornam o consenso impossível mesmo com redes síncronas

??? success "Resposta"
    **B — Não há garantia de término em um sistema assíncrono com ≥1 nó defeituoso.**

    O FLP (Fischer, Lynch, Paterson, 1985) prova esse limite fundamental: alguma ordenação azarada de atrasos pode manter qualquer algoritmo determinístico indeciso para sempre. Os algoritmos reais respondem a isso assumindo *sincronia parcial* (os atrasos acabam ficando limitados) ou usando aleatorização. Paxos e Raft nunca violam a safety e usam timeouts como substituto da detecção de falhas para progredir.

---

**Q11.** No Raft, que evento dispara uma nova **eleição de líder**?

- A. O líder atual envia uma mensagem `resign` ao cluster
- B. Uma maioria dos followers vota pela remoção do líder atual
- C. O timeout de eleição de um follower expira sem que ele receba um heartbeat do líder atual
- D. O cluster detecta que o log do líder divergiu dos logs dos followers

??? success "Resposta"
    **C — O timeout de eleição de um follower expira.**

    Cada follower mantém um timeout de eleição aleatório. Se nenhum heartbeat chega antes de ele expirar, o follower assume que o líder caiu e inicia uma nova eleição, incrementando o term e pedindo votos. Os timeouts aleatórios evitam que vários followers iniciem eleições ao mesmo tempo.

---

**Q12.** Uma equipe roda o etcd em **4** nós "para ficar mais seguro do que com 3". Quantas falhas de nós o cluster de 4 nós tolera e ainda continua aceitando escritas?

- A. 1 — o mesmo que um cluster de 3 nós
- B. 2 — metade dos nós
- C. 3 — qualquer nó sobrevivente pode atender escritas
- D. 0 — um número par de nós não consegue eleger um líder

??? success "Resposta"
    **A — 1.**

    Uma escrita precisa de uma maioria: ⌊4/2⌋ + 1 = 3 nós. Com 2 nós fora do ar, restam apenas 2, o que não é maioria. Portanto, 4 nós toleram ⌊(4-1)/2⌋ = 1 falha — o mesmo que 3 nós, com uma máquina a mais que pode falhar. É por isso que clusters de consenso usam tamanhos ímpares (3 ou 5). Um cluster par ainda consegue eleger um líder (D é falsa); ele só não ganha nada com isso.

---

**Q13.** Qual fórmula garante que todo quórum de leitura se sobreponha a todo quórum de escrita, assegurando que você sempre leia a escrita mais recente?

- A. W > N / 2
- B. R > N / 2
- C. W = R = N
- D. W + R > N

??? success "Resposta"
    **D — W + R > N.**

    Se o quórum de escrita W somado ao quórum de leitura R ultrapassa o total de réplicas N, pelo menos um nó que confirmou a escrita precisa participar de qualquer quórum de leitura. Essa sobreposição garante que a escrita mais recente esteja sempre visível em uma leitura por quórum, e é a base de sistemas como o Dynamo e da consistência ajustável do Cassandra (por exemplo, leituras e escritas `QUORUM` com N = 3: 2 + 2 > 3).

---

**Q14.** Duas réplicas de um CRDT **G-Counter** contêm `[4, 1, 0]` e `[2, 3, 0]` (uma posição por nó). Qual é o valor do contador depois que elas fazem o merge?

- A. 5 — o maior dos dois totais
- B. 7 — o máximo elemento a elemento, `[4, 3, 0]`, somado
- C. 10 — a soma dos dois totais
- D. Depende de qual réplica fez o merge por último

??? success "Resposta"
    **B — 7.**

    O merge do G-Counter toma o **máximo elemento a elemento** das posições: `[max(4,2), max(1,3), max(0,0)]` = `[4, 3, 0]`, cuja soma é 7. Como cada nó só incrementa a sua própria posição, o máximo de uma posição é o seu valor mais recente; somar os dois totais (C) contaria em dobro, e o merge é comutativo e idempotente, então a ordem dos merges não importa (D é falsa).
