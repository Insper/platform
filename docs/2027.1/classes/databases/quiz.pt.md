Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Modelos e motores de armazenamento

**Q1.** A BoxOffice precisa garantir que um assento nunca seja vendido duas vezes, e os analistas vivem inventando perguntas novas sobre os pedidos. Qual escolha de armazenamento serve melhor aos **pedidos e ao inventário de assentos**?

- A. Um banco wide-column, porque escala as escritas horizontalmente
- B. Um banco de documentos, embutindo cada ingresso dentro do documento do evento
- C. Um banco relacional, porque o invariante abrange várias linhas e precisa de transações e constraints, e as consultas ad hoc precisam de SQL
- D. Um banco chave-valor com TTL em cada assento

??? success "Resposta"
    **C — Um banco relacional.**

    Os fatores decisivos são o **invariante** ("um assento, um ingresso" — garantido com uma transação e uma constraint única) e a **flexibilidade de consulta** (perguntas ad hoc precisam de joins e índices). Bancos wide-column e chave-valor escalam bem, mas são projetados em torno de consultas conhecidas de antemão e oferecem transações limitadas; embutir cada ingresso no documento do evento faz o documento crescer sem limite e coloca todas as compras disputando um único documento.

---

**Q2.** Por que um índice B-tree em uma tabela com **um bilhão de linhas** costuma responder a uma busca pontual com só uma ou duas leituras de disco?

- A. Porque B-trees mantêm a tabela inteira em memória
- B. Porque, com um fan-out de algumas centenas de chaves por página, a árvore tem só cerca de 4 níveis, e os níveis superiores ficam em cache na memória
- C. Porque B-trees aplicam hash à chave para chegar direto à página no disco
- D. Porque o PostgreSQL comprime o índice para caber em uma página

??? success "Resposta"
    **B — Árvore rasa, níveis superiores em cache.**

    Com páginas de 8 KiB e ~16 bytes por chave + ponteiro, cada página aponta para ~500 filhas: 500³ = 125 milhões, 500⁴ = 62,5 bilhões. Um bilhão de linhas cabe em 4 níveis; a raiz e as páginas internas são quentes e ficam no buffer pool, então só a folha (e talvez uma página interna) vem do disco.

---

**Q3.** Um time está escolhendo um motor de armazenamento para os **registros de leitura nas catracas**: milhões de escritas minúsculas, só de inserção, por hora, lidas de volta por `(evento, portão)` e tempo. Qual afirmação está correta?

- A. Uma B-tree é melhor, porque atualizações no lugar evitam compactação
- B. Uma LSM-tree serve bem: as escritas são anexações sequenciais em uma memtable e em SSTables, e os Bloom filters mantêm as leituras pontuais baratas; a compactação é o preço
- C. Nenhuma das duas: dados só de inserção devem ir para o armazenamento de objetos
- D. Uma LSM-tree, porque nunca precisa ler mais de um arquivo por consulta

??? success "Resposta"
    **B — LSM-tree.**

    LSM-trees transformam escritas pequenas e aleatórias em anexações sequenciais e as agrupam em lotes, por isso bancos com muita escrita (Cassandra, ScyllaDB, RocksDB) as usam. As leituras podem consultar vários níveis — os Bloom filters pulam a maioria das SSTables, mas D exagera — e a compactação em segundo plano reescreve os dados (amplificação de escrita) e pode causar picos de I/O.

---

**Q4.** Existe um índice em `seats(event_id, section, status)`. Qual consulta **não** consegue usá-lo de forma eficiente?

- A. `WHERE event_id = 42`
- B. `WHERE event_id = 42 AND section = 'B'`
- C. `WHERE section = 'B' AND status = 'AVAILABLE'`
- D. `WHERE event_id = 42 AND section = 'B' AND status = 'AVAILABLE'`

??? success "Resposta"
    **C.**

    Uma B-tree composta é ordenada pela primeira coluna, depois pela segunda, e assim por diante (a **regra do prefixo mais à esquerda**). Sem `event_id`, as entradas que casam estão espalhadas pelo índice inteiro — como procurar numa lista telefônica ordenada por sobrenome todo mundo que se chama "Ana".

---

## Transações e isolamento

**Q5.** Duas requisições rodam isto no PostgreSQL (read committed) para o assento `A-12`: `SELECT status …` → `AVAILABLE`, depois `UPDATE seats SET status = 'HELD', held_by = :me WHERE event_id = 42 AND seat_id = 'A-12'`. As duas reportam sucesso. Qual é a anomalia, e qual mudança única a corrige?

- A. Leitura suja; trocar para read uncommitted
- B. Leitura fantasma; adicionar um índice em `status`
- C. Lost update (corrida check-then-act); adicionar `AND status = 'AVAILABLE'` ao `UPDATE` e verificar que exatamente 1 linha foi atualizada
- D. Deadlock; repetir as duas transações

??? success "Resposta"
    **C — Lost update; torne a atualização condicional.**

    As duas transações decidiram com base em uma leitura desatualizada; o lock de linha só serializou os dois `UPDATE`s, e o segundo sobrescreveu o primeiro. Com a condição dentro do `UPDATE`, o PostgreSQL reavalia o `WHERE` sobre a versão mais recente da linha depois que a primeira transação faz commit: a segunda atualização casa com 0 linhas e a aplicação avisa a esse fã que o assento foi ocupado.

---

**Q6.** Sob **repeatable read** no PostgreSQL (snapshot isolation), um cliente com 4 ingressos abre duas abas; cada uma conta os ingressos do cliente (4), verifica `4 + 2 ≤ 6` e reserva dois assentos *diferentes*. As duas fazem commit. O que aconteceu, e o que evita isso?

- A. Nada de errado: repeatable read evita todas as anomalias
- B. Write skew; usar isolamento serializable (com retentativas) ou travar uma linha compartilhada, como uma linha de limite por cliente, com `SELECT … FOR UPDATE`
- C. Leitura suja; usar read committed
- D. Lost update; adicionar uma coluna `version` em `seats`

??? success "Resposta"
    **B — Write skew.**

    As duas transações escreveram linhas diferentes, então não houve conflito escrita–escrita para a snapshot isolation detectar, mas juntas elas quebraram o invariante "no máximo 6 ingressos". A serializable snapshot isolation detecta a dependência leitura/escrita e aborta uma delas (SQLSTATE `40001`); como alternativa, **materialize o conflito** para que as duas transações precisem travar a mesma linha.

---

**Q7.** Para o recurso "melhor lugar disponível", centenas de fãs por segundo pedem "quaisquer 2 assentos livres no setor B". Qual consulta evita que eles fiquem em fila uns atrás dos outros?

- A. `SELECT … WHERE status = 'AVAILABLE' LIMIT 2 FOR UPDATE`
- B. `SELECT … WHERE status = 'AVAILABLE' LIMIT 2 FOR UPDATE SKIP LOCKED`
- C. `SELECT … WHERE status = 'AVAILABLE' LIMIT 2` com isolamento serializable
- D. `LOCK TABLE seats IN EXCLUSIVE MODE`

??? success "Resposta"
    **B — `FOR UPDATE SKIP LOCKED`.**

    Um `FOR UPDATE` simples faz todos os fãs esperarem pelas mesmas primeiras linhas livres; o `SKIP LOCKED` entrega a cada transação linhas que ninguém mais está segurando, então elas avançam em paralelo. Serializable causaria abortos e retentativas sob essa disputa, e um lock de tabela serializa tudo.

---

**Q8.** Cada transação de reserva decrementa um único contador `events.seats_left` e segura o lock dessa linha por cerca de **5 ms**. Ignorando todo o resto, qual é a taxa máxima de reservas para o evento inteiro?

- A. Cerca de 20 reservas/s
- B. Cerca de 200 reservas/s
- C. Cerca de 2.000 reservas/s
- D. Ilimitada, porque o PostgreSQL usa MVCC

??? success "Resposta"
    **B — Cerca de 200 reservas/s.**

    Um lock de linha atende uma transação por vez: 1 / 0,005 s = 200 por segundo, independentemente do hardware. O MVCC deixa os leitores avançarem sem bloqueio, mas dois escritores na mesma linha continuam serializados. A correção é tirar a linha quente do caminho quente (contadores por setor ou fragmentados, calculados de forma assíncrona).

---

## Replicação

**Q9.** Depois de adicionar réplicas de leitura assíncronas, os fãs às vezes veem a página *Meus ingressos* vazia logo após pagar. Qual correção oferece consistência **read-your-writes** (ler as próprias escritas)?

- A. Adicionar mais réplicas para reduzir a carga em cada uma
- B. Encaminhar cada usuário sempre para a mesma réplica (réplica fixa)
- C. Por um curto período depois que um usuário escreve, encaminhar as leituras desse usuário para o primário (ou para uma réplica que já reproduziu a posição de log da escrita)
- D. Aumentar o TTL de cache da página

??? success "Resposta"
    **C.**

    O problema é o atraso de replicação: a leitura chegou a uma réplica que ainda não tinha aplicado a escrita. Ler do primário depois de uma escrita — ou esperar até que o LSN reproduzido pela réplica passe o LSN da escrita — garante que o usuário veja a própria escrita. Uma réplica fixa dá **leituras monotônicas** (o tempo não anda para trás), mas ela ainda pode estar atrasada; mais réplicas não reduzem o atraso.

---

**Q10.** O primário do inventory usa replicação **assíncrona** e cai; uma réplica é promovida automaticamente. Qual é o risco específico para a BoxOffice?

- A. Nenhum, porque a reprodução do WAL garante que não há perda de dados
- B. Reservas confirmadas pelo primário antigo, mas ainda não enviadas, se perdem, então o novo primário pode vender esses assentos de novo
- C. A réplica se recusa a ser promovida enquanto o primário antigo está fora
- D. As leituras ficam mais lentas porque o novo primário tem um cache frio, mas os dados estão seguros

??? success "Resposta"
    **B — Escritas confirmadas perdidas.**

    Com replicação assíncrona, "commit feito" significa "no disco do líder". As escritas a caminho das réplicas desaparecem no failover. Para dados em que uma escrita perdida significa venda dupla ou dinheiro perdido, use um **standby síncrono** (ou commit por quorum) e aceite uma ida e volta extra por commit. (D é um efeito real, mas secundário.)

---

**Q11.** Um banco sem líder tem **N = 3** réplicas por chave. Qual configuração garante que uma leitura se sobreponha à última escrita confirmada e, ao mesmo tempo, tolera **uma** réplica fora do ar tanto para leituras quanto para escritas?

- A. W = 1, R = 1
- B. W = 2, R = 2
- C. W = 3, R = 1
- D. W = 1, R = 3

??? success "Resposta"
    **B — W = 2, R = 2.**

    R + W = 4 > N = 3, então os conjuntos de leitura e de escrita sempre compartilham pelo menos uma réplica, e as duas operações ainda funcionam com um nó fora. A não dá sobreposição; C bloqueia as escritas e D bloqueia as leituras quando qualquer nó cai.

---

## Particionamento e armazenamentos especializados

**Q12.** Um cache distribuído com 9 nós usa `node = hash(key) mod N`. Um nó é adicionado. Aproximadamente que fração das chaves passa a ser mapeada para outro nó, e o que o hashing consistente daria?

- A. Cerca de 10% com mod N; cerca de 90% com hashing consistente
- B. Cerca de 90% com mod N; cerca de 10% com hashing consistente
- C. Cerca de 50% com ambos
- D. 0% com ambos, porque os hashes não mudam

??? success "Resposta"
    **B — ~90% vs ~10%.**

    Uma chave só mantém seu nó com `mod N` quando `hash mod 9 = hash mod 10`, o que acontece para cerca de 1 em cada 10 chaves — então ~90% se movem, o que na prática despeja o cache inteiro sobre o banco. Com hashing consistente, o nó novo assume só os seus arcos do anel: cerca de 1/N = 1/10 das chaves.

---

**Q13.** O inventory é particionado por `event_id`. Às 10:00 a partição do show no estádio está em 100% enquanto as outras estão ociosas. Qual mudança resolve a **partição quente** sem transformar cada reserva em uma transação entre partições?

- A. Particionar por `hash(seat_id)`
- B. Adicionar mais nós ao cluster
- C. Particionar por `(event_id, section)`, manter as reservas em grupo dentro de um setor e colocar uma sala de espera na frente para limitar a taxa de reservas
- D. Trocar a replicação da partição para assíncrona

??? success "Resposta"
    **C.**

    Uma chave mais fina espalha o grande evento por ~40 setores, mantendo cada transação de reserva local, e a sala de espera limita a concorrência ao que uma partição consegue atender. Particionar por assento (A) espalha a carga, mas transforma "assentos disponíveis no setor B" em scatter/gather e as reservas em grupo em transações entre shards; mais nós (B) não ajudam quando a carga mira uma única chave.

---

**Q14.** O marketing quer "ingressos vendidos por minuto por cidade nos últimos dois anos" toda manhã. Onde essa consulta deve rodar, e por quê?

- A. No primário do order, com um índice em `created_at`
- B. Em um data warehouse colunar alimentado por CDC/ELT, porque ela varre poucas colunas de muitíssimas linhas e não pode competir com o checkout
- C. No mecanismo de busca, porque ele tem agregações
- D. No banco de dados vetorial, porque ele é rápido

??? success "Resposta"
    **B — No warehouse.**

    É uma consulta OLAP: poucas colunas, bilhões de linhas, segundos de latência aceitáveis. Um armazenamento colunar lê só as colunas necessárias, comprime-as bem e varre em paralelo. Rodá-la no primário OLTP compete com o checkout por CPU, I/O e locks.

---

**Q15.** O assistente de suporte precisa achar o parágrafo da política para "posso ter meu dinheiro de volta se o show mudar de data?", que quase não compartilha palavras com "Reembolso de eventos remarcados". Qual componente e qual técnica servem?

- A. Um índice de busca full-text com BM25 e stemming
- B. Embeddings guardados em um banco de dados vetorial (por exemplo, pgvector com índice HNSW), consultados por similaridade de cosseno
- C. Uma consulta `LIKE '%money back%'` na tabela de políticas
- D. Um banco chave-valor com o texto da pergunta como chave

??? success "Resposta"
    **B — Embeddings + busca aproximada de vizinhos mais próximos.**

    A busca lexical (A, C) casa palavras, e os dois textos compartilham poucas. Os embeddings colocam textos de **significado** parecido perto uns dos outros; um índice ANN como o HNSW encontra os mais próximos rapidamente, ao custo de um recall não perfeito. Na prática, busca híbrida (BM25 + vetores) e um reranker costumam funcionar melhor.
