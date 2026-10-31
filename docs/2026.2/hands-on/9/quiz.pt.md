Clique em **"Resposta"** para ver a resposta correta e a explicação.

---

## Cluster de banco de dados / Replicação no PostgreSQL

**Q1.** Uma equipe adiciona duas réplicas de leitura ao seu primário PostgreSQL. Qual problema isso **não** resolve?

- A. O primário ser uma cópia única dos dados
- B. `SELECT`s demais para um único servidor
- C. `INSERT`s e `UPDATE`s demais para um único servidor
- D. Ter um servidor pronto para assumir quando o primário falha

??? success "Resposta"
    **C — A replicação não escala as escritas.**

    Cada nó guarda todos os dados, e toda escrita ainda precisa ser aplicada no único primário (e depois reexecutada em cada réplica). As réplicas distribuem as leituras e oferecem disponibilidade e uma segunda cópia; escalar as escritas exige sharding (dividir os dados entre primários independentes).

---

**Q2.** O que o primário envia às suas réplicas na **replicação física por streaming**?

- A. Os comandos SQL que executou, para serem reexecutados em cada réplica
- B. Os registros do WAL (write-ahead log): alterações em páginas de dados, reexecutadas byte a byte
- C. Uma cópia completa do diretório de dados a cada poucos segundos
- D. As alterações de linhas das tabelas listadas em uma publication

??? success "Resposta"
    **B — O WAL.**

    Antes de alterar uma página, o PostgreSQL grava a alteração no WAL; as réplicas recebem e reexecutam esses registros e terminam com páginas idênticas. É por isso que uma réplica física é somente leitura e precisa rodar a mesma versão major. Alterações de linhas por tabela (D) são replicação **lógica**; a cópia completa (C) acontece só uma vez, com o `pg_basebackup`, para criar a réplica.

---

**Q3.** No lab, `pg_wal_replay_pause()` na `pg-replica1` seguido de um `INSERT` no primário fez a `pg-replica1` retornar a contagem de linhas antiga. Em produção, sem pausar nada, como o mesmo efeito aparece?

- A. Um erro `cannot execute INSERT in a read-only transaction`
- B. Um usuário cria um pedido e, logo em seguida, não o vê na lista lida de uma réplica
- C. O primário bloqueia o commit até que todas as réplicas o tenham reexecutado
- D. A réplica rejeita consultas até alcançar o primário

??? success "Resposta"
    **B — Uma leitura desatualizada (violação de read-your-writes).**

    Réplicas assíncronas estão sempre um pouco atrasadas; com carga, consultas longas ou uma rede lenta, o lag cresce. Ler logo depois de escrever pode cair em uma réplica que ainda não reexecutou a escrita. Correções: ler do primário depois de uma escrita, ou `synchronous_commit = remote_apply` para leituras que não podem ser desatualizadas.

---

**Q4.** Com `synchronous_standby_names = 'FIRST 1 ("pg-replica1")'`, a `pg-replica1` para. Um cliente executa um `INSERT`, espera e pressiona Ctrl+C. Qual é o estado da linha?

- A. Ela sofreu rollback: a replicação síncrona torna o commit atômico entre servidores
- B. Ela está confirmada no primário, mas pode não existir em nenhuma réplica
- C. Ela existe apenas na `pg-replica2`
- D. Ela se perdeu no primário e nas réplicas

??? success "Resposta"
    **B — Confirmada localmente; só a espera foi cancelada.**

    O PostgreSQL avisa: *"The transaction has already committed locally, but might not have been replicated to the standby."* A replicação síncrona adia a resposta ao cliente até uma réplica confirmar; ela não é uma transação distribuída. E, com uma única réplica síncrona nomeada, a falha dessa réplica bloqueia todas as escritas.

---

**Q5.** Por que `ANY 1 ("pg-replica1", "pg-replica2")` costuma ser preferido a `FIRST 1 ("pg-replica1")`?

- A. Ele torna cada commit mais rápido do que a replicação assíncrona
- B. Ele espera pelas duas réplicas, então nenhum dado jamais é perdido
- C. Um commit precisa da confirmação de qualquer uma das réplicas, então uma réplica pode falhar sem bloquear as escritas
- D. Ele transforma as duas réplicas em nós que aceitam escritas

??? success "Resposta"
    **C — Quórum: qualquer uma das duas confirma.**

    `FIRST 1` torna a réplica nomeada um ponto único de falha para as escritas. `ANY 1` (quórum) mantém o RPO = 0 tolerando a perda de uma réplica. Ainda assim, é mais lento do que commits assíncronos: cada commit espera uma ida e volta na rede.

---

**Q6.** Depois de `SELECT pg_promote();` na `pg-replica1`, a connection string `host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write` alcança o novo primário sem nenhuma alteração. Por quê?

- A. O Docker Compose renomeia `pg-replica1` para `pg-primary`
- B. O driver tenta os hosts em ordem e fica com o primeiro que aceita escritas; o `pg-primary` está fora do ar e a `pg-replica2` é somente leitura
- C. `pg_promote()` atualiza o DNS da rede Docker
- D. O primário antigo encaminha a conexão para o novo

??? success "Resposta"
    **B — Roteamento por papel no cliente.**

    A libpq (`target_session_attrs`) e o driver JDBC (`targetServerType`) se conectam a cada host e verificam se ele aceita escritas. A configuração lista *candidatos*, não *o* primário. Conexões já abertas com o primário antigo quebram e precisam ser reabertas — os pools de conexões fazem isso automaticamente.

---

**Q7.** No failover não planejado, o `lost-write` respondeu `INSERT 0 1`, mas sumiu depois da promoção. O que aconteceu?

- A. O `pg_rewind` o apagou do novo primário
- B. Ele existia apenas no WAL do primário que foi morto: nenhuma réplica o recebeu antes do crash, então a réplica promovida nunca o teve
- C. A sequence pulou o id dele
- D. A replicação síncrona fez o rollback dele

??? success "Resposta"
    **B — O RPO da replicação assíncrona.**

    O commit retornou assim que o WAL estava no disco do primário. As réplicas estavam fora do ar, o primário foi morto e a réplica promovida iniciou a timeline 2 sem aquele registro. Quando o primário antigo volta ao cluster, o `pg_rewind` descarta as escritas dele posteriores à bifurcação, para que ele fique igual ao novo primário. A replicação síncrona teria evitado a perda — bloqueando o `INSERT`.

---

**Q8.** Por que o failover automático (Patroni, RDS Multi-AZ) depende de um armazenamento de consenso como o etcd, em vez de um script que promove uma réplica quando o primário para de responder?

- A. O etcd replica os dados mais rápido do que a streaming replication
- B. Um primário que só *parece* morto (lento ou isolado) continuaria aceitando escritas enquanto uma réplica é promovida: dois primários, um split brain. O consenso garante que só quem detém a leader key atua como primário
- C. O PostgreSQL não consegue promover uma réplica sem o etcd
- D. O script precisaria de acesso de superusuário

??? success "Resposta"
    **B — Para evitar o split brain.**

    Detectar falhas em um sistema distribuído não é confiável: um timeout não distingue "morto" de "lento" ou "inacessível a partir daqui". Com uma leader key com TTL em um armazenamento Raft, um primário isolado não consegue renovar a chave e rebaixa a si mesmo, e só um nó pode vencer a eleição.
