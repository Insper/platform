# Armazenamento { #storage }

O **armazenamento** é onde vive o estado do sistema — e o estado é o que torna sistemas difíceis. A computação pode ser trocada, reiniciada e multiplicada à vontade; os dados precisam sobreviver a quedas, ser lidos de volta corretamente e permanecer consistentes quando muitas requisições mexem neles ao mesmo tempo. Cada componente de armazenamento da paleta responde a uma pergunta diferente: *onde está a verdade?* (SQL Database), *como sobreviver a um primário morto, e quanto se pode perder?* (DB Cluster), *como guardar volumes enormes com acesso simples?* (NoSQL DB), *como evitar perguntar de novo ao banco?* (Cache), *para onde vão os arquivos grandes?* (Object Store), *como analisar o histórico?* (Data Warehouse), *como encontrar coisas pelo significado?* (Vector DB).

No BoxOffice, o inventário de assentos e os pedidos vivem no PostgreSQL (a verdade, com transações — nada de venda dupla); o catálogo de eventos é lido milhões de vezes e fica atrás de um cache Redis; pôsteres, mapas dos locais e ingressos em PDF vão para um object store; o histórico de vendas flui para um data warehouse que alimenta o painel de "artistas mais vendidos"; e o assistente de suporte encontra a resposta certa do FAQ por meio de um índice vetorial.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [SQL Database](#sql) | Tabelas relacionais, SQL, transações: o sistema de registro padrão | `sql` |
| [DB Cluster](#dbcluster) | Banco replicado, opcionalmente particionado, com failover automático | `dbcluster` |
| [NoSQL DB](#nosql) | Bancos chave-valor, de documentos ou de colunas largas que particionam horizontalmente | `nosql` |
| [Cache](#cache) | Cópia em memória dos dados quentes: leituras abaixo de 1 ms, alivia o banco | `cache` |
| [Object Store](#objstore) | Armazenamento barato e durável de arquivos (blobs) por chave, via HTTP | `objstore` |
| [Data Warehouse](#dwh) | Banco analítico colunar para grandes varreduras e agregações (OLAP) | `dwh` |
| [Vector DB](#vectordb) | Guarda embeddings e encontra os mais próximos (busca por similaridade) | `vectordb` |

``` diagram
flowchart LR
    APP[App Server] -->|leituras quentes| CACHE[Cache]
    APP -->|verdade: assentos, pedidos| SQL[SQL Database]
    APP -->|dados enormes por chave| NOSQL[NoSQL DB]
    APP -->|arquivos: pôsteres, ingressos| OBJ[Object Store]
    SQL -->|CDC / ETL| DWH[Data Warehouse]
    APP -->|busca por similaridade| VEC[Vector DB]
```

---

## SQL Database { #sql }

**O que é.** Um banco de dados relacional guarda os dados em **tabelas** com esquema fixo, relacionadas por chaves, consultadas com SQL e protegidas por **transações ACID** (atomicidade, consistência, isolamento, durabilidade). É o **sistema de registro** padrão: o lugar onde mora a verdade. Índices (em geral B-trees) tornam as buscas rápidas; o planejador de consultas escolhe como executar cada consulta. Para escalar, você acrescenta **réplicas de leitura** (cópias que atendem leituras, alimentadas pelo log do primário), pool de conexões e — bem mais tarde — particionamento (sharding) ou um motor de SQL distribuído.

**Quando usar.**

- Dados com relações e invariantes: assentos, reservas, pedidos e pagamentos do BoxOffice — "um assento é vendido no máximo uma vez" é garantido por uma transação ou por uma restrição de unicidade.
- Quando você precisa de consultas ad hoc, joins, índices secundários e relatórios sobre os dados atuais.
- Como ponto de partida de quase todo sistema: um único PostgreSQL bem indexado vai muito mais longe do que a maioria imagina.
- Cargas dominadas por leitura: acrescente réplicas de leitura (cenário `db-replicas`) e um cache na frente.

**Quando não usar (ou cuidado).**

- Volume de escrita além do que um primário aguenta (milhões de escritas por segundo, como a localização de todos os motoristas): particione, ou use um armazenamento feito para isso (NoSQL, log de eventos).
- Blobs enormes (imagens, vídeos): guarde-os num object store e mantenha só a chave no SQL.
- Réplicas escalam **leituras**, não escritas, e **atrasam**: uma leitura logo depois de uma escrita pode não enxergá-la (problema do read-your-writes).
- Transações longas e linhas quentes (toda requisição atualizando o mesmo contador) serializam o banco.
- Cada conexão custa memória: centenas de réplicas da aplicação × um pool de 20 podem esgotar o servidor → use um pooler (PgBouncer).

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Consulta pontual indexada (chave primária) | ≈ 0,1–1 ms no servidor | Mais uma ida e volta de rede na mesma zona (≈ 0,5 ms) |
| Vazão de um primário | ≈ milhares a dezenas de milhares de consultas simples/s | ≈ ilustrativo; depende do hardware, do mix de consultas, dos índices |
| Máximo de conexões | centenas por servidor (`max_connections` padrão do PostgreSQL = 100) | Use um pooler de conexões |
| Atraso de replicação (assíncrona, mesma região) | ≈ milissegundos; segundos sob carga pesada de escrita | Cresce com o volume de escrita |
| Failover para um standby (serviços gerenciados) | ≈ 30 s a alguns minutos | ≈ aproximado; depende do provedor |
| Volume de dados confortável num só nó | até alguns TB | Além disso, particione ou arquive |

**Modos de falha.**

- **Queda do primário** → standby com failover automático (multi-AZ); os clientes precisam reconectar e repetir de forma idempotente.
- **Esgotamento de conexões** — as réplicas da aplicação escalam e abrem conexões demais → pooler, pools menores, limite no autoscaling.
- **Consulta lenta / índice faltando** — um full scan satura a CPU e todas as consultas ficam lentas → `EXPLAIN`, índices, timeouts de consulta.
- **Disputa por locks / linha quente** — milhares de requisições da venda relâmpago atualizando as mesmas linhas → transações curtas, `SELECT … FOR UPDATE SKIP LOCKED`, uma fila de sala de espera na frente.
- **Atraso de replicação** → usuários não veem as próprias escritas → ler do primário depois de escrever, ou esperar a réplica alcançar a posição.
- **Disco cheio / tabela crescendo sem controle** → monitoramento, políticas de retenção, arquivamento em object storage.

**No playground.** `sql` é um nó de **armazenamento** com capacidades de leitura e escrita separadas. `readReplicas` multiplica a capacidade de leitura por (1 + réplicas), enquanto a de escrita continua a mesma, e o atraso de replicação cresce com a carga de escrita. Parâmetros principais: `capacity` (padrão 3.000 leituras/s; uma escrita custa `writeCost` = 3 leituras), `latencyMs` (mediana 4 ms), `threads` (200 conexões), `queueLimit` (400), `standby` (failover multi-AZ); as arestas que chegam podem ter `timeoutMs`, `retries` e `circuitBreaker`. O percentual de leitura do cliente decide quanto as réplicas ajudam. Cenários: [`monolith`](../../../../playground/scenarios/index.md#monolith), [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas), [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale), [`payment-system`](../../../../playground/scenarios/index.md#payment-system).

**Produtos reais.**

=== "AWS"

    - **Amazon RDS** — PostgreSQL, MySQL, MariaDB, SQL Server e Oracle gerenciados, com standby multi-AZ e réplicas de leitura.
    - **Amazon Aurora** — motor compatível com PostgreSQL/MySQL, com camada de armazenamento distribuída e até 15 réplicas de leitura.

=== "GCP"

    - **Cloud SQL** — PostgreSQL, MySQL e SQL Server gerenciados.
    - **AlloyDB for PostgreSQL** — compatível com PostgreSQL, ajustado para maior vazão e análises.
    - **Spanner** — banco SQL distribuído globalmente, com consistência externa (TrueTime).

=== "Azure"

    - **Azure Database for PostgreSQL (Flexible Server)** e **Azure Database for MySQL** — motores de código aberto gerenciados.
    - **Azure SQL Database** — motor SQL Server gerenciado.

=== "Código aberto"

    - **PostgreSQL** — o padrão do curso: SQL rico, transações robustas, extensões (pgvector, PostGIS).
    - **MySQL** / **MariaDB** — bancos relacionais muito usados.
    - **YugabyteDB** — SQL distribuído, compatível com PostgreSQL.
    - **Vitess** — camada de sharding para MySQL (nascida no YouTube).
    - **PgBouncer** — pooler de conexões leve para PostgreSQL.

!!! tip "Na entrevista"
    "A fonte da verdade de assentos e pedidos é um banco relacional, porque preciso de transações para garantir que não haja venda dupla. Escalo as leituras com réplicas e um cache, mantenho as escritas num primário com standby para failover, e só particiono quando o volume de escrita ou o tamanho dos dados me obrigarem."

**Saiba mais:** [Bancos de dados › Modelos de dados](../../../classes/databases/models/index.md) · [Bancos de dados › Transações](../../../classes/databases/transactions/index.md) · [Bancos de dados › Replicação](../../../classes/databases/replication/index.md) · [Estudo de caso: ingressos](../../../classes/case-studies/ticketing/index.md) · [Hands-on 1](../../../hands-on/1/index.md) · [Hands-on 6](../../../hands-on/6/index.md)

---

## DB Cluster { #dbcluster }

**O que é.** Um banco de dados rodando como um **grupo de nós** em vez de um único servidor: cada **shard** (uma fatia das chaves) tem um **primário** que aceita as escritas e **seguidores** que recebem uma cópia do seu log, e um gerenciador do cluster (ou um protocolo de consenso como Raft ou Paxos) **detecta um primário morto e promove um seguidor** automaticamente. Ele acrescenta o que um único nó [SQL Database](#sql) não oferece: capacidade de leitura nos seguidores, capacidade de escrita com mais shards e sobrevivência à falha de um nó ou de uma zona. Os dois botões que todo projeto precisa escolher são **como uma escrita é confirmada** — *async* (só o primário: rápido, pode perder as últimas escritas no failover), *sync* (o primário mais um seguidor) ou *quorum* (a maioria dos nós do shard) — e **para onde vão as leituras** (só o primário: sempre frescas; seguidores também: mais capacidade, possivelmente desatualizadas).

**Quando usar.**

- Todo sistema de registro que precisa sobreviver à perda de uma máquina ou de uma zona de disponibilidade sem perder dados confirmados: pedidos e pagamentos do BoxOffice.
- Cargas dominadas por leitura que não cabem mais em um nó: leituras nos seguidores (quando uma resposta um pouco desatualizada é aceitável, ex.: o catálogo de eventos).
- Volume de escrita ou tamanho dos dados além de um primário: particione por uma chave com muitos valores distintos e usados de forma equilibrada (`event_id`, `user_id`).
- Quando RPO (dados que você pode perder) e RTO (tempo que você pode ficar fora do ar) são requisitos explícitos: eles decidem o modo de replicação e o mecanismo de failover.

**Quando não usar (ou cuidado).**

- **Replicação assíncrona perde dados no failover**: as escritas ainda dentro do atraso de replicação quando o primário morre desaparecem (RPO > 0). Use sync ou quorum para dinheiro e assentos.
- **Sync e quorum custam latência em toda escrita** (uma ida e volta a um seguidor, muitas vezes em outra AZ); um único seguidor síncrono que fica lento deixa todas as escritas lentas — o quorum tolera um seguidor lento.
- **Seguidores atrasam**: ler deles quebra o read-your-writes → leia suas próprias escritas no primário, ou espere a posição do seguidor.
- **Particionar é difícil de desfazer**: joins e transações entre shards ficam caros, e uma **chave quente** (um evento popular) satura o seu shard enquanto os outros ficam ociosos.
- O failover não é instantâneo: detecção mais promoção mais reconexão dos clientes leva tipicamente dezenas de segundos — o RTO.
- Split brain: dois nós que acreditam ser o primário corrompem os dados → eleição de líder por consenso, fencing.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Ida e volta da replicação até um seguidor em outra AZ | ≈ 1–2 ms | ≈ ilustrativo; somada a toda escrita com sync ou quorum |
| Atraso da replicação assíncrona (mesma região) | ≈ milissegundos; segundos sob carga pesada de escrita | Perdido no failover com async: RPO ≈ o atraso naquele momento |
| Failover automático | ≈ 30 s (Aurora: em geral menos de 30 s); ≈ 60–120 s (instância RDS Multi-AZ) | ≈ aproximado; detecção + promoção + reconexão via DNS/cliente |
| Trava de líder do Patroni (HA do PostgreSQL) | `ttl` 30 s, `loop_wait` 10 s | Padrões documentados: um primário morto é substituído em ≈ 30 s |
| Maioria de um shard | ⌊N/2⌋ + 1 de N nós | 3 nós toleram 1 falha, 5 toleram 2 |
| Armazenamento do Aurora | 6 cópias em 3 AZs; quórum de escrita 4/6, de leitura 3/6 | Sobrevive à perda de uma AZ e de mais uma cópia |
| Disponibilidade teórica de um shard de 3 nós | 1 − (1 − 0,999)³ ≈ 99,9999999% | Ideal: ignora falhas correlacionadas, tempo de failover e bugs |

**Modos de falha.**

- **Falha do primário** — as escritas no seu shard falham até um seguidor ser promovido (RTO); com replicação assíncrona as últimas escritas se perdem (RPO) → sync/quorum para dados críticos, retries idempotentes no cliente.
- **Seguidor síncrono lento** — toda escrita espera por ele → quorum em vez de um único seguidor síncrono, alertas sobre a latência de replicação.
- **Atraso de replicação** → leituras desatualizadas, usuários não veem as próprias escritas → roteamento read-your-writes, balanceamento ciente do atraso, monitorar o atraso.
- **Shard quente** — chaves assimétricas mandam a maior parte das requisições para um shard → chave de shard melhor, dividir chaves quentes, cache na frente.
- **Split brain** — uma partição de rede deixa dois primários → consenso (Raft/Paxos), fencing tokens, escritas só com maioria.
- **Sem seguidores** — uma falha de nó deixa o shard fora do ar até o nó voltar → ao menos um seguidor por shard em outra AZ.

**No playground.** `dbcluster` é um nó de **chamada** que modela um banco replicado e opcionalmente particionado. Parâmetros (padrões entre parênteses): `shards` (1; 1–64), `replicasPerShard` (2 seguidores por shard; 0–5), `replication` (`async`, ou `sync` / `quorum`), `readsFrom` (`followers`, ou `primary`), `failoverS` (30 s para detectar um primário morto e promover um seguidor), `replRttMs` (2 ms de ida e volta da replicação até um seguidor, entre AZs, lognormal), `capacity` (3.000 leituras/s por nó), `latencyMs` (4 ms), `threads` (200 conexões por nó), `writeCost` (3: uma escrita custa 3 leituras de capacidade) e `price` (450 USD/mês por nó, ilustrativo).

- **Capacidade.** Escritas: shards × capacity ÷ writeCost (só os primários escrevem). Leituras: shards × (1 + replicasPerShard) × capacity quando se lê dos seguidores, shards × capacity quando se lê do primário. As chaves se espalham pelos shards com a assimetria Zipf dos clientes: o shard mais quente recebe p₁ + (1 − p₁)/shards das requisições (p₁ = parcela da chave mais quente), então ele satura primeiro; o inspetor mostra a utilização do shard quente e dos demais.
- **Latência de escrita.** `async`: só o primário. `sync`: + uma ida e volta ao seguidor síncrono. `quorum`: + a ida e volta do ⌊(R+1)/2⌋-ésimo seguidor mais rápido (a maioria dos 1 + R nós do shard) — então um seguidor lento prejudica o `sync`, mas não o `quorum`. Um evento de *degradação de latência* num DB Cluster deixa um seguidor (o síncrono) ×5–20 mais lento.
- **Atraso de replicação** dos seguidores que não fazem parte da confirmação (todos com `async`, R − 1 com `sync`, R − ⌊(R+1)/2⌋ com `quorum`) cresce com a utilização de escrita do primário ρw, como nas réplicas de leitura do SQL: atraso ≈ 0,02 s + 0,5 · ρw³ ÷ (1 − ρw) s, sem limite acima de ρw = 1. Leituras desatualizadas ≈ parcela das leituras atendidas por seguidores atrasados × parcela de escritas × min(1, atraso ÷ 1 s) (o playground supõe que um cliente relê o que escreveu cerca de um segundo depois).
- **Falha do primário** (aleatória com caos, injetável com ⚡; uma queda de AZ também dispara uma). O primário de um shard morre: as escritas nesse shard — e as leituras também, com `readsFrom = primary` — falham durante `failoverS` (o **RTO**); depois um seguidor é promovido e o shard roda com um nó a menos até um substituto entrar 120 s depois. Com `async`, as escritas dentro do atraso de replicação naquele momento são **perdidas** (escritas perdidas ≈ taxa de escrita do shard × atraso; o relatório as conta — a lição do **RPO**); com `sync` ou `quorum`, nenhuma escrita se perde, ao preço de uma latência de escrita maior. Com `replicasPerShard = 0` não há failover: o shard fica fora do ar (leituras e escritas) por 120 s até o nó voltar — sem perda de dados, só indisponível.
- **Custo** = shards × (1 + replicasPerShard) × price. **Disponibilidade teórica**: por shard 1 − (1 − a)^(1+R) com a = 0,999 por nó, todos os shards em série.

Cenários: [`db-failover`](../../../../playground/scenarios/index.md#db-failover), [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas), [`sharding`](../../../../playground/scenarios/index.md#sharding).

**Produtos reais.**

=== "AWS"

    - **Amazon Aurora** — compatível com PostgreSQL/MySQL; armazenamento replicado por quórum em 3 AZs, até 15 leitores, failover automático; **Aurora Limitless Database** para sharding.
    - **Amazon RDS Multi-AZ** — um standby síncrono (instância) ou dois standbys legíveis (Multi-AZ DB cluster).
    - **Amazon DynamoDB** e **Amazon DocumentDB** — bancos gerenciados particionados e replicados.

=== "GCP"

    - **Cloud SQL** com alta disponibilidade — um standby síncrono em outra zona.
    - **AlloyDB for PostgreSQL** — primário com HA mais pools de leitura.
    - **Spanner** — SQL particionado (splits), replicado com Paxos, com consistência externa.

=== "Azure"

    - **Azure SQL Database** (Business Critical / redundante entre zonas) e **Azure Database for PostgreSQL** com HA redundante entre zonas.
    - **Azure Cosmos DB** — particionado, multirregião, com consistência ajustável; **Cosmos DB for PostgreSQL** (Citus).

=== "Código aberto"

    - **PostgreSQL** com **Patroni** — replicação por streaming (async, sync ou quórum `ANY k`) e failover automático; **Citus** para sharding.
    - **Vitess** — sharding e failover para MySQL.
    - **CockroachDB**, **YugabyteDB**, **TiDB** — SQL distribuído, Raft por faixa de chaves.
    - **MongoDB** replica sets + sharding (write concern `majority`).

!!! tip "Na entrevista"
    "O banco de pedidos é um cluster: um primário e dois seguidores em zonas diferentes. A replicação assíncrona é mais barata em cada escrita, mas pode perder as últimas escritas no failover; por isso, para pedidos e assentos uso replicação por quórum (ou síncrona), o que significa zero perda de dados e uma ida e volta entre zonas por escrita. O failover leva cerca de 30 segundos — esse é o meu RTO — e só particiono por evento quando um primário não dá conta das escritas."

**Saiba mais:** [Bancos de dados › Replicação](../../../classes/databases/replication/index.md) · [Bancos de dados › Atraso de replicação](../../../classes/databases/replication/index.md#lag) · [Bancos de dados › Particionamento](../../../classes/databases/partitioning/index.md) · [Bancos de dados › Partições quentes](../../../classes/databases/partitioning/index.md#hot-partitions) · [Bancos de dados › Transações](../../../classes/databases/transactions/index.md) · [Distribuídos › Consenso › Maiorias](../../../classes/distributed/consensus/index.md#majorities) · [Distribuídos › CAP e PACELC](../../../classes/distributed/cap-pacelc/index.md#pacelc) · [Confiabilidade › Recuperação de desastres](../../../classes/reliability/disaster-recovery/index.md)

---

## NoSQL DB { #nosql }

**O que é.** "NoSQL" é uma família de bancos que abre mão de alguns recursos relacionais (joins, transações de várias linhas, esquema fixo) em troca de **escala horizontal** e acesso simples e previsível por chave. Os modelos principais são **chave-valor** (get/put por chave), **documentos** (documentos JSON com campos flexíveis), **colunas largas** (linhas com muitas colunas, agrupadas por uma chave de partição) e **grafos**. Os dados são **particionados** por uma chave (em geral com hashing consistente) entre muitos nós e **replicados** — muitas vezes com consistência ajustável (quóruns R + W > N). Muitos usam **LSM-trees**, que tornam as escritas muito rápidas.

**Quando usar.**

- Taxas de escrita muito altas com padrões de acesso simples: localização de motoristas em transporte por aplicativo, mensagens de chat, fluxos de cliques, leituras de IoT.
- Dados acessados naturalmente por uma chave: sessões de usuário, carrinhos, a timeline de um usuário, as mensagens de uma conversa.
- Latência previsível em qualquer escala quando você conhece as consultas de antemão (a tabela é desenhada *para* a consulta).
- Esquemas flexíveis e em evolução (bancos de documentos) — por exemplo, descrições de eventos com campos diferentes para cada tipo de evento.

**Quando não usar (ou cuidado).**

- Consultas ad hoc, joins e relatórios: só dá para consultar de forma eficiente pela chave de partição (e talvez por uma chave de ordenação). Consulta nova = tabela ou índice novo.
- Invariantes que envolvem vários itens (nada de venda dupla entre muitas linhas): transações são limitadas ou inexistentes em muitos desses bancos.
- A **chave de partição** decide tudo: uma chave ruim (por exemplo, `event_id` durante a venda relâmpago) concentra o tráfego numa partição — uma **partição quente** — e a capacidade total do cluster não ajuda.
- Consistência eventual por padrão: uma leitura pode devolver um valor antigo, a menos que você peça um nível mais forte.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência de leitura/escrita de uma chave | ≈ 1–10 ms | Em qualquer tamanho de tabela, se a chave for bem distribuída |
| Vazão | escala quase linearmente com nós/partições | Até uma chave quente concentrar a carga |
| Limite de tamanho de item no DynamoDB | 400 KB | Limite documentado |
| Limite por partição no DynamoDB | ≈ 3.000 unidades de leitura e 1.000 de escrita por segundo | Documentado; daí o problema da partição quente |
| Fator de replicação | 3 é a escolha usual | Quórum: W = 2, R = 2 |

**Modos de falha.**

- **Partição quente / chave quente** — um post de celebridade ou o evento da venda relâmpago recebe a maior parte das requisições → espalhar a chave (sufixo/número de shard), cacheá-la ou dar a ela um caminho dedicado.
- **Queda de um nó** → as réplicas atendem os dados; hinted handoff e anti-entropia reparam depois as escritas que faltaram.
- **Leituras desatualizadas** sob consistência eventual → ler com quórum ou consistência forte quando importar.
- **Conflitos de escrita** em configurações multi-líder ou sem líder → last-write-wins (perde dados) ou merge na aplicação; evite para dinheiro.
- **Tempestades de rebalanceamento** ao adicionar nós → hashing consistente com nós virtuais; adicione capacidade antes do pico.

**No playground.** `nosql` é um nó de **armazenamento** cuja capacidade é `capacity × replicas` — cada réplica é uma partição (padrões 5.000 ops/s × 4). O `zipfS` do cliente (assimetria de popularidade das chaves) concentra uma fração do tráfego numa partição: com uma chave quente, a capacidade efetiva cai para a de uma única partição, ainda que as outras estejam ociosas. O evento de caos "hot key / celebrity" faz a assimetria saltar. Parâmetros: `replicas`, `capacity`, `latencyMs` (3 ms), `writeCost` (1,2). Cenários: [`sharding`](../../../../playground/scenarios/index.md#sharding), [`chat`](../../../../playground/scenarios/index.md#chat), [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing), [`news-feed`](../../../../playground/scenarios/index.md#news-feed), [`url-shortener`](../../../../playground/scenarios/index.md#url-shortener).

**Produtos reais.**

=== "AWS"

    - **Amazon DynamoDB** — banco chave-valor e de documentos serverless, com capacidade sob demanda ou provisionada.
    - **Amazon Keyspaces** — serviço gerenciado de colunas largas compatível com Cassandra.
    - **Amazon DocumentDB** — banco de documentos compatível com MongoDB.

=== "GCP"

    - **Firestore** — banco de documentos serverless.
    - **Bigtable** — armazenamento de colunas largas para cargas muito grandes e de baixa latência (o sistema descrito no artigo do Bigtable).

=== "Azure"

    - **Azure Cosmos DB** — banco multimodelo, distribuído globalmente, com cinco níveis de consistência selecionáveis.

=== "Código aberto"

    - **Apache Cassandra** — armazenamento de colunas largas sem líder, com consistência ajustável (no estilo Dynamo).
    - **MongoDB** (Community Edition, código-fonte disponível) — banco de documentos.
    - **Apache HBase** — colunas largas sobre o HDFS (no estilo Bigtable).
    - **FoundationDB** — armazenamento chave-valor ordenado com transações ACID.

!!! tip "Na entrevista"
    "Para bilhões de mensagens de chat acessadas por conversa, eu usaria um banco de colunas largas particionado por `conversation_id` e ordenado por tempo: as escritas escalam com os nós e a consulta principal cai numa só partição. O preço é não ter joins nem consultas ad hoc, e preciso vigiar as partições quentes."

**Saiba mais:** [Bancos de dados › Modelos de dados](../../../classes/databases/models/index.md) · [Bancos de dados › Particionamento](../../../classes/databases/partitioning/index.md) · [Distribuídos › Consistência](../../../classes/distributed/consistency/index.md) · [Estudo de caso: chat](../../../classes/case-studies/chat/index.md) · [Estudo de caso: encurtador de URLs](../../../classes/case-studies/url-shortener/index.md)

---

## Cache { #cache }

**O que é.** Um cache mantém uma cópia dos dados lidos com frequência **em memória**, perto do código que precisa deles, para que a maioria das leituras pule a fonte mais lenta (banco, outro serviço). O padrão usual é o **cache-aside**: a aplicação procura no cache; num **acerto** (*hit*), devolve; numa **falta** (*miss*), lê o banco e guarda o resultado com um **TTL** (time to live). Outros padrões: read-through, write-through, write-behind, refresh-ahead. Um cache distribuído como o Redis é compartilhado por todas as réplicas da aplicação, sobrevive a reinícios dela e oferece estruturas de dados (hashes, conjuntos ordenados, contadores) que o tornam útil também para sessões, rate limiting e rankings.

**Quando usar.**

- Dados muito lidos que mudam pouco ou podem ficar levemente desatualizados: catálogo de eventos do BoxOffice, detalhes dos locais, preços para navegação.
- Resultados caros: páginas renderizadas, contagens agregadas, respostas de APIs externas.
- Estado efêmero compartilhado: sessões, contadores do rate limiter (token buckets), retratos do mapa de assentos atualizados a cada segundo.
- Para proteger o banco de picos: com 95% de acertos, o banco vê só 1/20 das leituras.

**Quando não usar (ou cuidado).**

- Dados que precisam estar exatamente atuais no momento da decisão — disponibilidade do assento na compra, saldo de conta: a verificação tem de ir à fonte da verdade.
- Dados com muita escrita e pouca releitura: o cache só acrescenta trabalho.
- A **invalidação** é a parte difícil: decida quão desatualizado cada item pode ficar e apague (não atualize) nas escritas.
- Cache não é banco de dados: pode ser esvaziado, ter itens expulsos ou reiniciar vazio. O sistema precisa sobreviver a um **cache frio**.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Leitura da memória principal | ≈ 100 ns | "Latency numbers every programmer should know" |
| GET no Redis pela rede, mesma zona | ≈ 0,2–1 ms | Quase tudo é a ida e volta de rede |
| Vazão de um nó Redis | ≈ 100 mil+ operações simples/s | ≈ ilustrativo; execução de comandos majoritariamente single-thread |
| Carga no banco com taxa de acerto *h* | (1 − *h*) × leituras | De 90% para 99% de acertos = 10× menos leituras no banco |
| Latência média | *h* × t_cache + (1 − *h*) × t_banco | por exemplo, 0,95 × 1 ms + 0,05 × 20 ms ≈ 2 ms |
| TTLs comuns | segundos (dados dinâmicos quentes) a horas (dados de referência) | Acrescente jitter para evitar expirações sincronizadas |

**Modos de falha.**

- **Cache stampede (thundering herd)** — uma chave quente expira e milhares de faltas atingem o banco de uma vez → coalescência de requisições (single flight), lock por chave, renovação antecipada probabilística, `stale-while-revalidate`, TTLs com jitter.
- **Cache frio** depois de um reinício ou de um flush → aquecer antes de receber tráfego, proteger o banco com rate limits, aumentar o tráfego aos poucos.
- **Chave quente** — uma chave (o evento da venda relâmpago) satura um nó do cache → cache local em processo para essa chave, replicar a chave, dividi-la.
- **Dados desatualizados ou inconsistentes** — corridas de escrita deixam um valor antigo → apagar na escrita, chaves versionadas, TTLs curtos.
- **Pressão de memória / expulsão** → dimensionar a memória, escolher a política de expulsão (LRU, LFU), monitorar a taxa de acerto e as expulsões.
- **Cache indisponível** → tratá-lo como opcional: cair para o banco com circuit breaker e descarte de carga.

**No playground.** `cache` é um nó de **cache**: cada leitura acerta com probabilidade `hitRatio` e volta em ≈ 0,5 ms; as faltas seguem para o próximo nó (em geral `sql`). As escritas passam direto para o banco e invalidam; o parâmetro `policy` alterna entre cache-aside e write-through. Os eventos de caos "cache flush / cold cache" derrubam a taxa de acerto para 0, que depois se recupera ao longo de `cacheWarmS` (padrão 120 s) — observe o banco ficar vermelho; `coalescing` evita o estouro. Parâmetros: `hitRatio` (0,9), `policy`, `cacheWarmS`, `coalescing`, `capacity` (80.000 ops/s), `replicas`. Cenários: [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache), [`url-shortener`](../../../../playground/scenarios/index.md#url-shortener), [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete), [`news-feed`](../../../../playground/scenarios/index.md#news-feed), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale).

**Produtos reais.**

=== "AWS"

    - **Amazon ElastiCache** — Valkey, Redis OSS e Memcached gerenciados.
    - **Amazon MemoryDB** — banco em memória durável, compatível com Redis/Valkey.

=== "GCP"

    - **Memorystore** — Valkey, Redis e Memcached gerenciados.

=== "Azure"

    - **Azure Cache for Redis** / **Azure Managed Redis** — Redis gerenciado.

=== "Código aberto"

    - **Redis** — a referência em armazenamento de estruturas de dados em memória (confira a licença da versão que usar).
    - **Valkey** — fork do Redis mantido pela Linux Foundation, licença BSD.
    - **Memcached** — cache chave-valor simples e multi-thread.
    - **Caffeine** (Java) — cache em processo de alto desempenho (expulsão W-TinyLFU).

!!! tip "Na entrevista"
    "Eu colocaria um Redis com cache-aside na frente do catálogo: com 95% de acertos, o banco vê 20× menos leituras e o p99 cai. As entradas têm TTL com jitter, as escritas apagam a chave e as chaves quentes são protegidas contra stampede com coalescência de requisições. A disponibilidade do assento na hora da compra nunca vem do cache."

**Saiba mais:** [Cache › Padrões](../../../classes/caching/patterns/index.md) · [Cache › Invalidação](../../../classes/caching/invalidation/index.md) · [Cache › Modos de falha](../../../classes/caching/failure-modes/index.md) · [Cache › Redis](../../../classes/caching/redis/index.md) · [Estudo de caso: cache distribuído](../../../classes/case-studies/distributed-cache/index.md) · [Hands-on 5](../../../hands-on/5/index.md)

---

## Object Store { #objstore }

**O que é.** Um object store guarda **arquivos (objetos, blobs)** de qualquer tamanho em **buckets** planos, endereçados por uma chave (`posters/2027/coldplay.jpg`) e acessados via HTTP (PUT, GET, DELETE, LIST). Não há diretórios, nem edição no lugar, nem consultas: você grava um objeto inteiro e o lê de volta. Em troca, ganha capacidade praticamente ilimitada, durabilidade altíssima (dados replicados entre dispositivos e zonas), preço baixo por GB e a possibilidade de servir arquivos direto aos clientes — em geral por uma CDN ou com **URLs pré-assinadas**, que concedem acesso temporário.

**Quando usar.**

- Mídia e documentos: pôsteres dos eventos do BoxOffice, mapas dos locais, ingressos em PDF gerados, uploads dos usuários.
- Vídeo: uploads originais e segmentos transcodificados, servidos por uma CDN (cenário `video-streaming`).
- Backups, snapshots de banco, arquivos de logs, arquivos de data lake (Parquet) lidos pelo data warehouse.
- Hospedagem de sites estáticos (o front end SPA) como origem da CDN.

**Quando não usar (ou cuidado).**

- Registros pequenos que mudam com frequência ou precisam de consultas: isso é um banco de dados.
- Acesso aleatório de baixa latência dentro de um arquivo, ou appends: objetos são gravados inteiros.
- Não faça uploads grandes passarem pelos seus servidores de aplicação: deixe os clientes enviarem direto com uma URL pré-assinada.
- Os custos se escondem nas **requisições** (por mil PUT/GET) e na **saída de dados** (*egress*, por GB que sai da nuvem), não só no armazenamento.
- Permissões de bucket: buckets públicos por engano são um vazamento de dados clássico.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Durabilidade projetada (Amazon S3 Standard) | 99,999999999% ("11 noves") por ano | Meta de projeto documentada |
| Tempo até o primeiro byte | ≈ 10–100 ms | Use uma CDN para leituras voltadas ao usuário |
| Taxa de requisições por prefixo no S3 | 3.500 escritas/s e 5.500 leituras/s | Documentado; escale espalhando as chaves por prefixos |
| Tamanho de objeto | de bytes a terabytes | Objetos grandes usam upload multipart |
| Preço de armazenamento | ≈ USD 0,02 por GB-mês (classe padrão) | ≈ aproximado (2026); classes mais frias são mais baratas para guardar e mais caras para ler |

**Modos de falha.**

- **Exposição pública acidental** → bloquear acesso público por padrão, servir pela CDN com controle de acesso à origem, URLs pré-assinadas.
- **Exclusão / sobrescrita acidental** → versionamento, object lock, políticas de ciclo de vida, replicação entre regiões para dados críticos.
- **Throttling de requisições num prefixo** → espalhar as chaves (prefixo com hash), cachear objetos quentes na CDN.
- **Surpresa no custo** — egress ou milhões de requisições minúsculas → CDN na frente, agrupar objetos pequenos, ciclo de vida para classes mais baratas.
- **Queda regional** → replicação entre regiões para os dados que você não pode perder.

**No playground.** `objstore` é um nó de **armazenamento** com alta capacidade e latência mediana maior que a de um banco; em geral fica atrás de uma `cdn` (como origem) ou recebe escritas de nós `worker` (transcodificação). O custo é por GB e por requisição. Parâmetro: `latencyMs` (mediana 30 ms); a capacidade (200.000 req/s) é praticamente ilimitada. Cenários: [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming), [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static).

**Produtos reais.**

=== "AWS"

    - **Amazon S3** — o object store de referência; classes de armazenamento do Standard ao Glacier Deep Archive.

=== "GCP"

    - **Cloud Storage** — armazenamento de objetos com as classes Standard, Nearline, Coldline e Archive.

=== "Azure"

    - **Azure Blob Storage** — armazenamento de objetos com camadas hot, cool, cold e archive.

=== "Código aberto"

    - **MinIO** — object store compatível com S3 (confira a licença e a edição).
    - **Ceph (RADOS Gateway)** — armazenamento distribuído com interface compatível com S3.
    - **SeaweedFS** — armazenamento distribuído de objetos/arquivos para muitos arquivos pequenos.

!!! tip "Na entrevista"
    "Pôsteres e ingressos vão para um object store, nunca para o banco: é barato, praticamente infinito e extremamente durável. Os clientes enviam direto com URLs pré-assinadas e baixam pela CDN, então os servidores de aplicação nunca carregam os bytes; o banco guarda só a chave do objeto e os metadados."

**Saiba mais:** [Bancos de dados › Armazenamentos especializados](../../../classes/databases/specialized/index.md) · [Borda › DNS e CDN](../../../classes/edge/dns-cdn/index.md) · [Estudo de caso: streaming de vídeo](../../../classes/case-studies/video-streaming/index.md)

---

## Data Warehouse { #dwh }

**O que é.** Um data warehouse é um banco **analítico (OLAP)** feito para consultas que varrem e agregam grandes volumes de histórico — "receita por artista por mês em 2026" — e não para muitas transações pequenas (OLTP). Ele guarda os dados **por coluna** (assim uma consulta lê só as colunas de que precisa, bem comprimidas), separa armazenamento de computação e executa as consultas em paralelo em muitas máquinas. Os dados chegam dos bancos operacionais e dos fluxos de eventos por jobs de **ETL/ELT** ou por **captura de mudanças (CDC)**. Um *lakehouse* mantém os dados como arquivos abertos (Parquet + um formato de tabela como o Apache Iceberg) num object store e os consulta com motores de warehouse.

**Quando usar.**

- Análises de negócio e painéis: vendas por evento, conversão da sala de espera, padrões de fraude, análise de coortes.
- Perguntas sobre meses ou anos de dados, cruzando muitas fontes (pedidos, pagamentos, marketing, suporte).
- Alimentar features de machine learning e relatórios sem carregar o banco de produção.
- O serviço `analytics` da paleta normalmente grava aqui (via stream ou jobs em lote).

**Quando não usar (ou cuidado).**

- Servir o produto: as consultas levam segundos, não milissegundos, e a concorrência é limitada — nunca coloque o warehouse no caminho de uma requisição de usuário.
- Atualizações pontuais e transações pequenas: são lentas e caras em motores colunares.
- Atualidade dos dados: ETL em lote deixa os dados com horas de atraso; para quase tempo real, use ingestão por CDC/streaming, a um custo maior.
- Preço por varredura: um `SELECT *` sem filtro numa tabela enorme custa dinheiro de verdade — particione e agrupe as tabelas, selecione só as colunas necessárias.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência de consulta | ≈ segundos a minutos | Painéis interativos miram alguns segundos |
| Vazão de varredura | ≈ GB/s a TB/s num cluster | ≈ ilustrativo; cresce com a computação |
| Compressão colunar | muitas vezes ≈ 5–10× | ≈ ilustrativo; depende dos dados |
| Atualidade | lote: horas; streaming/CDC: segundos a minutos | Trade-off: custo vs atualidade |
| Preço sob demanda (BigQuery) | ≈ USD 6 por TiB varrido | ≈ preço de tabela aproximado (2026); existem opções de preço fixo |

**Modos de falha.**

- **Análises no banco de produção** — um relatório pesado deixa o checkout lento → mover as análises para uma réplica ou, melhor, para o warehouse.
- **Pipelines quebrados ou atrasados** — os painéis mostram em silêncio os dados de ontem → verificações de atualidade, alertas de atraso do pipeline.
- **Deriva de esquema** — uma coluna renomeada na origem quebra o ETL → schema registry / contratos de dados, CDC com evolução de esquema.
- **Custo de consulta descontrolado** → tabelas particionadas, limites de custo por consulta/usuário, agregados materializados.
- **Duplicatas da ingestão at-least-once** → cargas idempotentes (merge por chave), deduplicação.

**No playground.** `dwh` é um nó de **armazenamento** fora do caminho crítico: normalmente recebe um fluxo assíncrono de um nó `stream`/`kafka` ou do `analytics`, então sua latência não afeta o p99 do usuário, mas o backlog e o custo ficam visíveis. Parâmetros: `replicas`, `capacity` (20 consultas/s), `latencyMs` (mediana 2 s). Cenários: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Produtos reais.**

=== "AWS"

    - **Amazon Redshift** — data warehouse colunar (provisionado ou serverless).
    - **Amazon Athena** — SQL serverless sobre arquivos no S3.

=== "GCP"

    - **BigQuery** — data warehouse serverless com separação entre armazenamento e computação.

=== "Azure"

    - **Microsoft Fabric** (Data Warehouse, Lakehouse) e **Azure Synapse Analytics** — plataformas de análise.
    - **Azure Databricks** — plataforma lakehouse baseada em Spark.

=== "Código aberto"

    - **ClickHouse** — banco OLAP colunar muito rápido.
    - **Apache Spark** — processamento distribuído em lote e em streaming.
    - **Trino** — motor de consultas SQL distribuído sobre lakes e bancos.
    - **Apache Iceberg** — formato de tabela aberto para lakehouses.
    - **DuckDB** — banco analítico em processo, ótimo para análises locais.

!!! tip "Na entrevista"
    "Análises nunca rodam no banco de produção. Os eventos de pedido passam pelo Kafka (ou por CDC a partir do outbox) até um warehouse colunar, onde os painéis varrem meses de histórico em segundos. O trade-off é a atualidade — minutos, não milissegundos —, o que é aceitável para relatórios de negócio."

**Saiba mais:** [Bancos de dados › Armazenamentos especializados](../../../classes/databases/specialized/index.md) · [Mensageria › Padrões](../../../classes/messaging/patterns/index.md) · [Computação › Serviços](../../../classes/compute/services/index.md) · [Serviço de analytics](../compute/index.md#analytics)

---

## Vector DB { #vectordb }

**O que é.** Um banco vetorial guarda **embeddings** — vetores de números (em geral de algumas centenas a alguns milhares de dimensões) produzidos por um modelo de modo que textos ou imagens de significado parecido fiquem próximos — e responde a consultas de **vizinhos mais próximos**: "os 5 trechos mais parecidos com esta pergunta". A busca exata compara com todos os vetores, o que é lento demais em escala; por isso os bancos vetoriais usam índices de **vizinhos mais próximos aproximados (ANN)**, como o **HNSW** (um grafo navegável) ou o IVF (agrupamentos), trocando um pouco de revocação (*recall*) por ordens de grandeza de velocidade. A maioria também filtra por metadados (por exemplo, só documentos deste evento) e combina busca vetorial com busca por palavras-chave (*busca híbrida*).

**Quando usar.**

- **RAG** (retrieval-augmented generation): o assistente de suporte do BoxOffice recupera os trechos de FAQ e de políticas mais relevantes e os coloca no prompt do LLM.
- Busca semântica ("shows parecidos com este"), recomendações, deduplicação de conteúdo quase idêntico.
- O **cache semântico** de um LLM gateway: reaproveitar uma resposta quando uma pergunta nova é parecida o bastante com uma anterior.
- Memória de longo prazo de agentes (o componente `memory` da paleta usa isso).

**Quando não usar (ou cuidado).**

- Correspondências exatas, filtros e transações: um índice SQL ou um motor de busca é melhor e mais barato.
- Coleções pequenas (milhares de vetores): uma extensão no banco que você já tem (pgvector) basta — nada de sistema novo para operar.
- ANN é **aproximado**: revocação abaixo de 100% significa que alguns trechos relevantes ficam de fora; avalie a qualidade da recuperação, não só a latência.
- Trocar o modelo de embeddings significa **recalcular tudo**: versione os seus embeddings.
- Memória: índices HNSW são grandes e normalmente ficam em RAM.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Dimensões do embedding | ≈ 384–3.072 | Depende do modelo |
| Tamanho de um vetor | dimensões × 4 bytes (float32) | 1.536 dimensões ≈ 6 KB; 1 M de vetores ≈ 6 GB antes do overhead do índice |
| Latência de consulta ANN | ≈ 1–10 ms para milhões de vetores | ≈ ilustrativo; depende dos parâmetros do índice e do hardware |
| Recall@10 com HNSW ajustado | ≈ 0,9–0,99 | Trade-off com latência e memória |
| Economia com quantização | ≈ 4× (int8) a 32× (binária) menos memória | Com alguma perda de revocação |

**Modos de falha.**

- **Recuperação ruim** — o trecho certo não está no top-k → chunking melhor, busca híbrida, reordenação (*reranking*), conjuntos de avaliação.
- **Índice desatualizado** — os documentos mudaram, os embeddings não → reindexar a cada mudança (CDC/eventos), controlar versões.
- **Modelos diferentes** — consulta e documentos com embeddings de modelos distintos → guardar a versão do modelo com cada vetor.
- **Esgotamento de memória** conforme a coleção cresce → quantização, sharding, índices em disco.
- **Vazamento de dados entre clientes** → filtros de metadados obrigatórios (cliente, permissões) aplicados na consulta, não no prompt.

**No playground.** `vectordb` é um nó de **armazenamento** em geral chamado pelo `memory` (Memory Fabric) ou pelo `orchestrator` no cenário de IA; sua latência se soma a cada passo do agente que recupera contexto. Parâmetros: `replicas`, `capacity` (1.500 consultas/s), `latencyMs` (mediana 12 ms). Cenários: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant), [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete).

**Produtos reais.**

=== "AWS"

    - **Amazon OpenSearch Service** — busca vetorial k-NN mais busca por palavras-chave.
    - **Amazon Aurora PostgreSQL / RDS for PostgreSQL** com a extensão **pgvector**.

=== "GCP"

    - **Vertex AI Vector Search** — serviço gerenciado de ANN.
    - **AlloyDB** / **Cloud SQL for PostgreSQL** com **pgvector**.

=== "Azure"

    - **Azure AI Search** — busca vetorial, por palavras-chave e híbrida.
    - **Azure Cosmos DB** — busca vetorial integrada.

=== "Código aberto"

    - **pgvector** — tipo vetor e índices HNSW/IVFFlat dentro do PostgreSQL (usado no Hands-on 12).
    - **Qdrant**, **Milvus**, **Weaviate** — bancos vetoriais dedicados.
    - **FAISS** — biblioteca para busca eficiente por similaridade (Meta).
    - **Chroma** — armazenamento leve de embeddings para protótipos.

!!! tip "Na entrevista"
    "Para RAG sobre as políticas do BoxOffice, eu dividiria os documentos em trechos, geraria os embeddings e guardaria os vetores no pgvector, junto dos dados que já temos, com índice HNSW e filtro por cliente. Um banco vetorial dedicado só compensa com dezenas de milhões de vetores; de todo modo, meço a revocação da recuperação, não só a latência."

**Saiba mais:** [Bancos de dados › Armazenamentos especializados](../../../classes/databases/specialized/index.md) · [Sistemas de IA › RAG e memória](../../../classes/ai-systems/rag-memory/index.md) · [Estudo de caso: assistente de IA](../../../classes/case-studies/ai-assistant/index.md) · [Memory Fabric](../ai/index.md#memory) · [Hands-on 12](../../../hands-on/12/index.md)
