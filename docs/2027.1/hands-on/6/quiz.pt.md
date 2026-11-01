Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** Sob o isolamento padrão do PostgreSQL (READ COMMITTED), por que a estratégia **naive** (SELECT, confere em Java, UPDATE) vende assentos em duplicidade?

- A. O READ COMMITTED não usa transações
- B. Duas transações podem ler os assentos como AVAILABLE antes de qualquer uma escrever; o segundo UPDATE então espera o primeiro e o sobrescreve — um lost update
- C. O comando UPDATE não é atômico
- D. O JdbcClient não suporta transações

??? success "Resposta"
    **B — Corrida de check-then-act.**

    Cada comando vê dados confirmados, mas nada liga a decisão tomada no SELECT ao estado no momento do UPDATE. A correção precisa tornar a verificação e a escrita um único passo atômico: um lock, uma verificação de versão ou um UPDATE condicional.

---

**Q2.** O que o `SELECT … FOR UPDATE` faz na estratégia pessimista?

- A. Lê as linhas mais rápido
- B. Trava as linhas selecionadas até a transação terminar; outra transação que tente travá-las espera, depois vê o estado confirmado (HELD) e recebe um 409
- C. Impede qualquer um de ler as linhas
- D. Atualiza as linhas automaticamente

??? success "Resposta"
    **B — Locks de linha, mantidos até o commit.**

    Leituras simples (sem `FOR UPDATE`) não são bloqueadas graças ao MVCC; só esperam outros que travam e escrevem. Essa espera é o custo do pessimismo, visível no p99 das requisições de reserva.

---

**Q3.** Por que travamos os assentos com `ORDER BY id`?

- A. Para devolvê-los ordenados ao cliente
- B. Para evitar deadlocks: se duas reservas travarem assentos sobrepostos em ordens diferentes, cada uma pode esperar a outra para sempre
- C. Porque o PostgreSQL exige um ORDER BY com FOR UPDATE
- D. Para deixar o index scan mais barato

??? success "Resposta"
    **B — Uma ordem global de locks impede ciclos.**

    O fã A trava o 7 e depois o 8; o fã B trava o 8 e depois o 7: um ciclo. O PostgreSQL o detectaria e abortaria uma transação depois do `deadlock_timeout`, mas ordenar a aquisição elimina o ciclo por completo.

---

**Q4.** Quando o lock **otimista** (coluna de versão) é uma escolha melhor que o pessimista?

- A. Quando a contenção é alta, como nas primeiras fileiras de uma venda relâmpago
- B. Quando a contenção é baixa: a maioria das transações toca linhas diferentes, então nunca espera e raramente entra em conflito
- C. Nunca: ele permite vendas duplicadas
- D. Só com isolamento SERIALIZABLE

??? success "Resposta"
    **B — Contenção baixa.**

    O lock otimista é correto (nunca vende em duplicidade), mas sob contenção alta a maioria das tentativas falha e precisa ser repetida ou rejeitada. O lock pessimista serializa o trabalho disputado de forma mais elegante.

---

**Q5.** Qual requisição **não** deveria ser atendida pela réplica de leitura?

- A. O mapa de assentos do setor S07 para um fã navegando
- B. A disponibilidade por setor na página do evento
- C. `GET /inventory/holds/{id}` logo depois de o fã criar aquela reserva
- D. Um relatório noturno dos assentos vendidos

??? success "Resposta"
    **C — Read-your-writes.**

    A replicação é assíncrona; a réplica pode ainda não ter a reserva, e o fã veria um 404 para algo que acabou de criar. Leituras das próprias escritas recentes vão para o primário.

---

**Q6.** Com `REPLICA_DELAY=1s`, a maioria dos fãs não vê o próprio assento como HELD no mapa de assentos. Que garantia de consistência é violada?

- A. A linearizabilidade do primário
- B. Read-your-writes (uma garantia de sessão)
- C. Durabilidade
- D. Atomicidade

??? success "Resposta"
    **B — Read-your-writes.**

    O sistema continua *eventualmente* consistente: depois do atraso, a réplica alcança o primário. Correções: ler do primário depois de uma escrita, roteamento "sticky" por um curto período, ou esperar a réplica chegar à posição da escrita no log.

---

**Q7.** Com o que as réplicas de leitura **não** conseguem ajudar?

- A. O tráfego de mapas de assentos durante a venda
- B. Consultas de relatório que disputariam recursos com a venda
- C. A taxa de reservas (escritas) que o primário precisa processar
- D. A disponibilidade das leituras se o primário estiver ocupado

??? success "Resposta"
    **C — Escritas.**

    Toda escrita vai para o primário e depois é reaplicada em cada réplica. Escalar escritas exige menos trabalho por escrita, lotes, filas na frente (lab 7) ou particionar os dados entre primários (sharding).

---

**Q8.** Por que o Flyway se conecta direto ao `db`, enquanto a aplicação passa pelo PgBouncer?

- A. O PgBouncer não consegue rodar SQL
- B. No pooling por transação, o estado de sessão (como o advisory lock de nível de sessão que o Flyway usa) não sobrevive entre transações, porque cada transação pode receber uma conexão de servidor diferente
- C. O Flyway fica mais lento pelo PgBouncer
- D. O PgBouncer bloqueia DDL

??? success "Resposta"
    **B — O pooling por transação quebra o estado de sessão.**

    `SET`, advisory locks de sessão, `LISTEN/NOTIFY` e tabelas temporárias supõem uma conexão de servidor por sessão. Use pooling por sessão ou uma conexão direta para o código que precisa deles.

---

**Q9.** O que o PgBouncer muda quando o `inventory` escala de 1 para 10 réplicas com 20 conexões cada?

- A. Nada: o PostgreSQL continua recebendo 200 conexões
- B. O PostgreSQL recebe no máximo `default_pool_size` conexões de servidor; as 200 conexões de cliente são multiplexadas, e os clientes excedentes fazem fila no PgBouncer em vez de falhar com "too many clients"
- C. Deixa toda consulta mais rápida
- D. Faz cache dos resultados das consultas

??? success "Resposta"
    **B — Muitas conexões de cliente baratas, poucas de servidor caras.**

    Cada conexão do PostgreSQL é um processo com a sua própria memória; milhares delas degradam o banco. Um pooler as limita, o que importa mais ainda com autoescalonamento (lab 10).

---

**Q10.** Antes do índice, o plano da listagem mostrava `Seq Scan on events` + `Sort`. Depois do `CREATE INDEX … (starts_at, id)`, o que muda?

- A. Nada, o PostgreSQL ignora índices em timestamps
- B. O PostgreSQL consegue percorrer pelo índice os eventos já ordenados por `starts_at` e parar depois de 20 linhas que casam, evitando ler e ordenar 200.000 linhas
- C. A consulta de contagem fica de graça
- D. As escritas ficam mais rápidas

??? success "Resposta"
    **B — O índice fornece tanto o filtro quanto a ordem.**

    `LIMIT` + um índice na ordem certa é uma das otimizações mais eficazes que existem. A contagem ainda visita todas as linhas que casam, e todo insert/update agora também mantém os índices — índices são um custo do lado da escrita.

---

**Q11.** Para o inventário de assentos da venda relâmpago, qual afirmação de design é a mais forte numa entrevista?

- A. "Ponha os assentos no Redis com um TTL; é mais rápido"
- B. "Os assentos precisam de consistência forte: um banco relacional com locks de linha ou updates condicionais e um TTL na reserva; tudo ao redor (catálogo, mapas de assentos, busca) pode ficar em cache e ser eventualmente consistente, e uma sala de espera limita quantos fãs chegam ao inventário ao mesmo tempo"
- C. "Use consistência eventual em tudo e reembolse as vendas duplicadas"
- D. "Faça sharding da tabela de assentos pelo número do assento"

??? success "Resposta"
    **B — Forte onde importa, barato no resto.**

    Ela nomeia o invariante, o mecanismo que o garante, a expiração das reservas, o que pode relaxar e como proteger as linhas quentes da sobrecarga — o núcleo do estudo de caso de venda de ingressos.

---

**Q12.** Com `synchronous_standby_names = 'FIRST 1 ("db-replica")'` e o padrão `synchronous_commit = on`, a réplica é parada. Um fã faz uma reserva, o gateway responde `504` depois de 5 s, e minutos depois a réplica volta. O que aconteceu com a reserva?

- A. Foi desfeita quando o cliente desistiu
- B. Ela foi confirmada no primário e só esperava a réplica; quando a réplica voltou, o commit terminou, então o assento está `HELD` embora o fã tenha visto um erro
- C. Ela se perdeu: a replicação síncrona descarta escritas que o standby nunca recebeu
- D. O primário a recusou na hora com `cannot execute INSERT in a read-only transaction`

??? success "Resposta"
    **B — Confirmada localmente, esperando o standby.**

    A replicação síncrona faz o primário esperar o standby *antes de responder*, não antes de confirmar: até o cancelamento imprime "the transaction has already committed locally". O resultado fica ambíguo para o cliente, então uma nova tentativa precisa reconhecer a tentativa anterior (uma chave de idempotência), e com um único standby síncrono esse standby é um ponto único de falha para as escritas — em produção se usa `ANY 1` sobre dois ou mais.

---

**Q13.** Depois da queda do passo 4, a reserva da Ana tinha respondido `201`, mas `GET /inventory/holds/{id}` na réplica promovida devolveu `404`. Por quê, e que configuração teria evitado?

- A. A promoção apagou a tabela de reservas; `wal_log_hints = on` evita
- B. Com replicação assíncrona, a reserva foi confirmada no antigo primário mas nunca enviada; ela só existia no WAL do primário morto. A replicação síncrona (`synchronous_commit = on` com um standby síncrono) a teria mantido, ao custo de esperar o standby em todo commit
- C. A reserva expirou durante o failover; um `INVENTORY_HOLD_TTL` maior evita
- D. O PgBouncer perdeu a transação; o pooling de sessão evita

??? success "Resposta"
    **B — O RPO da replicação assíncrona.**

    O que foi confirmado mas ainda não enviado se perde quando o primário morre: esse é o recovery point objective. O `on` espera o WAL estar no disco do standby, então um standby promovido o tem; o `remote_apply` espera também que ele seja reaplicado, o que elimina as leituras defasadas. Os dois custam latência e, com um standby só, disponibilidade de escrita.

---

**Q14.** O antigo primário é ligado de novo enquanto a réplica promovida tem o nome `db`. Qual afirmação está correta?

- A. O PostgreSQL detecta o outro primário e se rebaixa
- B. Os dois aceitam escritas e respondem diferente para o mesmo assento: um split brain. Ele precisa ser isolado (parado) e só pode voltar depois que o `pg_rewind` descartar a história divergente, o que exige `wal_log_hints` ou checksums de dados
- C. O DNS do Docker se recusa a dar o mesmo nome a dois contêineres
- D. O antigo primário reaplica automaticamente o WAL do novo primário e o alcança

??? success "Resposta"
    **B — Split brain, depois isolar e rebobinar.**

    Nada em dois servidores PostgreSQL independentes decide quem é o líder, e o alias de rede deixou os dois alcançáveis como `db`. Os gerenciadores de failover resolvem isso com consenso (a chave de líder do Patroni no etcd) e fencing; o `pg_rewind` então copia de volta os blocos que mudaram desde que as timelines se separaram, para que o antigo primário possa seguir o novo em vez de ser clonado do zero.
