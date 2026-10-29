Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Falhas, redes e idempotência { #failures-networks-and-idempotency }

**Q1.** O `inventory` do BoxOffice chama o `payment` e não recebe resposta em 2 s. O que o `inventory` pode concluir?

- A. O serviço de pagamentos caiu e precisa ser reiniciado
- B. A requisição se perdeu, então é seguro fazer retry sem nenhuma precaução
- C. Nada com certeza: a requisição pode ter se perdido, o servidor pode ter caído, a resposta pode ter se perdido ou o servidor pode só estar lento — a cobrança pode ou não ter acontecido
- D. A rede está particionada, então o sistema precisa passar para o modo AP

??? success "Resposta"
    **C — Nada com certeza.**

    Uma requisição perdida, um servidor que caiu, uma resposta perdida e um servidor lento parecem silêncio para quem chama. Um timeout permite *supor* a falha e seguir em frente, mas não diz se a operação foi executada. Por isso um retry precisa ser seguro — a operação precisa ser idempotente (por exemplo, com uma chave de idempotência que o provedor deduplica).

---

**Q2.** Cada máquina de uma frota falha em um dado dia com probabilidade de 0,1%, de forma independente. Aproximadamente qual é a probabilidade de que **pelo menos uma** de 1.000 máquinas falhe hoje?

- A. 0,1%
- B. 1%
- C. Cerca de 63%
- D. 100%

??? success "Resposta"
    **C — Cerca de 63%.**

    P(pelo menos uma falha) = 1 − (1 − 0,001)^1000 ≈ 1 − e^(−1) ≈ 0,63. Com 3.000 máquinas, é cerca de 95%. Em escala, falhas são um evento diário, então o sistema precisa continuar funcionando apesar delas em vez de tentar evitá-las.

---

**Q3.** O endpoint `/health` do serviço `search` devolve `200 OK`, o load balancer o mantém em rotação, mas toda consulta de busca real dá timeout. Que modelo de falha é este?

- A. Crash-stop
- B. Falha bizantina
- C. Falha cinza
- D. Falha de omissão do load balancer

??? success "Resposta"
    **C — Falha cinza.**

    Uma falha cinza é aquela em que o monitoramento do próprio sistema vê o componente como saudável enquanto os usuários sofrem falhas. A correção é um health check que exercite o caminho real da dependência (um readiness check que roda uma consulta barata) mais sinais do lado do cliente, como taxas de erro e detecção passiva de outliers no load balancer.

---

**Q4.** Qual destas operações é **idempotente**?

- A. `POST /orders` criando um novo pedido para o fã 42
- B. `UPDATE seats SET sold = sold + 1 WHERE event_id = 42`
- C. `UPDATE seats SET status = 'HELD', fan_id = 42 WHERE id = 'A-12' AND status = 'FREE'`
- D. Enviar um e-mail "seu ingresso está pronto"

??? success "Resposta"
    **C — A escrita condicional.**

    Executá-la duas vezes deixa o mesmo estado: a segunda execução não encontra nenhuma linha (o assento não está mais `FREE`). O `POST` cria um novo pedido a cada vez, o incremento soma de novo e cada envio de e-mail é um e-mail novo — todos precisam de uma chave de idempotência ou deduplicação para que o retry seja seguro.

---

**Q5.** Um serviço `order` guarda chaves de idempotência em um `HashSet` em memória em cada réplica. Três réplicas rodam atrás de um load balancer. O que dá errado?

- A. Nada; o conjunto é rápido e correto
- B. Um retry pode chegar a uma réplica diferente, que nunca viu a chave, e o pedido é criado duas vezes
- C. As chaves ocupam memória demais
- D. O load balancer rejeita requisições com o cabeçalho `Idempotency-Key`

??? success "Resposta"
    **B — O retry cai em outra réplica.**

    O estado de deduplicação precisa ser compartilhado (uma chave única no banco de dados, gravada na mesma transação que o pedido, ou um armazenamento compartilhado como o Redis). Memória por réplica também perde todas as chaves no reinício. E a chave precisa ser gravada atomicamente com a mudança de negócio — senão um crash entre as duas escritas reabre a janela de duplicatas.

---

## Replicação e consistência { #replication-and-consistency }

**Q6.** Uma fã paga e é redirecionada para *Meus ingressos*, que lê de uma réplica de leitura assíncrona. A lista está vazia. Que garantia foi violada, e qual é a correção mais barata?

- A. Linearizabilidade; fazer todas as leituras e escritas passarem por consenso
- B. Read-your-writes; ler os dados da própria usuária no primário (ou passar a posição da escrita no log e esperar uma réplica que já a aplicou)
- C. Escritas monotônicas; enviar as escritas em ordem
- D. Consistência eventual; a réplica nunca vai receber a escrita

??? success "Resposta"
    **B — Read-your-writes.**

    A fã não precisa que o sistema inteiro seja linearizável — ela precisa ver as *próprias* escritas. Rotear para o primário as leituras dos dados dela (ou fazer isso por alguns segundos depois de uma escrita), ou usar um token de versão como o LSN do WAL do PostgreSQL, oferece read-your-writes a um custo muito menor do que consistência forte global.

---

**Q7.** Atualizando a página do evento, um fã vê "restam 95 assentos", depois "restam 340 assentos", depois "restam 90 assentos", porque cada atualização cai em uma réplica diferente. Que garantia de sessão está faltando?

- A. Read-your-writes
- B. Leituras monotônicas
- C. Escritas monotônicas
- D. Linearizabilidade das escritas

??? success "Resposta"
    **B — Leituras monotônicas.**

    Leituras monotônicas prometem que uma sessão nunca vê o dado voltar no tempo. Prender a sessão a uma réplica (hash do id da sessão), ou registrar a última versão vista e só aceitar réplicas pelo menos tão atualizadas, resolve. O contador ainda pode estar atrasado — o que é aceitável para esta tela —, mas não pode pular para trás.

---

**Q8.** Qual afirmação sobre modos de replicação está correta?

- A. Replicação assíncrona com failover automático nunca perde escritas confirmadas
- B. Replicação totalmente síncrona para todos os seguidores torna as escritas altamente disponíveis
- C. Replicação semissíncrona (o líder + pelo menos um seguidor confirmam) evita perder escritas confirmadas no failover, se um seguidor síncrono for promovido, ao custo de uma ida e volta a mais
- D. Replicação com vários líderes elimina conflitos de escrita

??? success "Resposta"
    **C — Semissíncrona.**

    A replicação assíncrona pode perder as últimas escritas confirmadas quando o líder morre antes de os seguidores as receberem. A replicação totalmente síncrona bloqueia toda escrita se qualquer seguidor estiver fora ou lento. A replicação com vários líderes aceita escritas em vários lugares e, portanto, cria conflitos. A replicação semissíncrona (ou por quórum) é o meio-termo usual para dados que você não pode perder.

---

## CAP e PACELC { #cap-and-pacelc }

**Q9.** O estoque de assentos do BoxOffice está replicado em duas regiões, e o enlace entre elas cai. Um fã na região 2 pede para reservar um assento cujo estado mais recente está na região 1. Uma configuração **CP** vai:

- A. Reservar o assento na região 2 e reconciliar depois
- B. Recusar a requisição (erro ou timeout) até conseguir confirmar o estado mais recente
- C. Devolver o assento como livre e deixar o provedor de pagamentos decidir
- D. Virar CA automaticamente até a partição se resolver

??? success "Resposta"
    **B — Recusar até conseguir confirmar.**

    Durante uma partição, um sistema CP sacrifica a disponibilidade do lado que não alcança o estado mais recente (tipicamente a minoria) em vez de arriscar uma resposta inconsistente — aqui, um assento vendido duas vezes. Um sistema AP responderia e reconciliaria depois. "CA" não é uma opção para dados replicados.

---

**Q10.** Por que a maioria dos projetos replica de forma **síncrona entre zonas de disponibilidade**, mas **assíncrona entre regiões**?

- A. O CAP proíbe replicação síncrona entre regiões
- B. Por causa do ramo *else* do PACELC: uma ida e volta extra entre zonas custa ~1–2 ms, enquanto entre continentes custa ~150 ms em toda escrita
- C. Zonas de disponibilidade nunca se particionam
- D. Regiões usam engines de banco de dados diferentes

??? success "Resposta"
    **B — Latência (a escolha "EL/EC").**

    Mesmo sem partição, consistência custa latência: uma escrita precisa esperar as réplicas que confirmam. Uma ida e volta entre zonas é barata o bastante para pagar em toda escrita; uma entre continentes, não. Entre regiões, os sistemas escolhem latência (replicação assíncrona) ou evitam a questão dando a cada registro uma região de origem.

---

## Consenso e quóruns { #consensus-and-quorums }

**Q11.** Um cluster etcd precisa continuar aceitando escritas se **dois** nós quaisquer falharem ao mesmo tempo. Qual é o tamanho mínimo do cluster?

- A. 3
- B. 4
- C. 5
- D. 6

??? success "Resposta"
    **C — 5.**

    N nós toleram ⌊(N−1)/2⌋ falhas: 3 toleram 1, 4 ainda toleram só 1, 5 toleram 2. Tamanhos pares acrescentam custo sem acrescentar tolerância a falhas. Os 5 nós devem ser espalhados por zonas de modo que nenhuma zona sozinha tenha a maioria.

---

**Q12.** Uma tabela do Cassandra usa N = 3 réplicas. Quais configurações de leitura/escrita garantem que uma leitura se sobreponha à última escrita confirmada?

- A. W = 1, R = 1
- B. W = 1, R = 2
- C. W = 2, R = 2
- D. W = 2, R = 1

??? success "Resposta"
    **C — W = 2, R = 2.**

    A condição de sobreposição é R + W > N: 2 + 2 = 4 > 3. As opções A (2), B (3) e D (3) não são maiores que N. Lembre que a sobreposição é necessária, mas não suficiente, para a linearizabilidade: escritas concorrentes, quóruns relaxados e LWW com relógios defasados ainda causam anomalias.

---

**Q13.** Uma réplica do `scheduler` detém um lease do etcd, pausa por 15 s em uma coleta de lixo e acorda depois que seu lease expirou e outra réplica o obteve. O que impede o antigo detentor de corromper o estado compartilhado?

- A. Um TTL de lease maior
- B. Um fencing token que aumenta a cada concessão e é verificado pelo armazenamento, que rejeita escritas com um token mais antigo
- C. Relógios sincronizados com NTP
- D. Rodar o scheduler com mais memória

??? success "Resposta"
    **B — Um fencing token.**

    Um processo pausado não tem como saber que foi pausado. TTLs maiores só tornam a janela mais rara; relógios não ajudam um processo que não está rodando. O armazenamento precisa rejeitar detentores desatualizados comparando um token monotonicamente crescente (revisão do etcd, zxid do ZooKeeper, um termo do Raft).

---

## Transações distribuídas { #distributed-transactions }

**Q14.** No two-phase commit, o coordenador cai depois que todos os participantes votaram **sim**, mas antes de enviar a decisão. O que acontece com os participantes?

- A. Eles confirmam por conta própria, já que todos votaram sim
- B. Eles abortam por conta própria depois de um timeout
- C. Eles ficam **em dúvida**, segurando seus locks, até o coordenador se recuperar e informar a decisão
- D. Eles elegem um novo coordenador com Raft e continuam

??? success "Resposta"
    **C — Em dúvida, segurando os locks.**

    Um participante que votou sim prometeu confirmar se mandado, e não tem como saber se o coordenador decidiu commit (e outros já confirmaram) ou abort (talvez alguém tenha votado não). Ele precisa esperar — é o problema de bloqueio do 2PC. Sistemas como Spanner e CockroachDB o evitam replicando o estado do coordenador com consenso; a opção D descreve esse projeto, não o 2PC puro.

---

**Q15.** O checkout do BoxOffice abrange `inventory`, `payment` (um provedor externo) e `order`. O cartão é recusado depois que o assento passou para `RESERVED_FOR_PAYMENT`. Em uma saga orquestrada, o que deve acontecer?

- A. Nada: sagas são isoladas, então o assento nunca ficou visível como reservado
- B. O orquestrador executa compensações em ordem inversa: libera o assento e depois cancela o pedido
- C. O orquestrador pede ao provedor de pagamentos que desfaça sua transação preparada
- D. O checkout inteiro é refeito até o cartão ser aceito

??? success "Resposta"
    **B — Compensar em ordem inversa.**

    Uma saga é uma sequência de transações locais; quando um passo falha, os passos já concluídos são desfeitos por transações de compensação. Sagas não são isoladas — outros fãs viram o assento como reservado, e por isso o estado intermediário funciona como um lock semântico com expiração. Um provedor externo não tem "transação preparada" para desfazer (ele não pode participar de um 2PC), e repetir para sempre um cartão recusado não é regra de negócio.

---

## Tempo e relógios { #time-and-clocks }

**Q16.** Dois nós do `inventory` resolvem escritas conflitantes no mesmo assento com last-write-wins usando os próprios relógios de parede. O relógio do nó 1 está 50 ms adiantado. O que acontece com duas escritas conflitantes feitas com 20 ms de diferença, a mais recente no nó 2?

- A. A escrita mais recente sempre vence, porque o NTP corrige os relógios
- B. A escrita mais antiga (no nó 1) pode vencer, porque seu timestamp é maior; a escrita mais recente é perdida em silêncio
- C. As duas escritas são guardadas como irmãs
- D. O banco de dados rejeita as duas escritas

??? success "Resposta"
    **B — A escrita mais antiga pode vencer.**

    Com relógios que discordam mais do que o intervalo entre os eventos, os timestamps os ordenam errado, e o LWW descarta uma escrita em silêncio — sempre com viés a favor do nó com o relógio mais adiantado. Para assentos e dinheiro, deixe uma autoridade única decidir (uma escrita condicional em um primário), ou detecte concorrência com vetores de versão.

---

**Q17.** Valores de relógio de Lamport satisfazem L(a) = 7 e L(b) = 9. O que você pode concluir?

- A. a aconteceu antes de b
- B. b aconteceu antes de a
- C. Ou a aconteceu antes de b, ou a e b são concorrentes — mas b não aconteceu antes de a
- D. a e b são concorrentes

??? success "Resposta"
    **C — Não "b → a", mas a pode ser concorrente com b.**

    Relógios de Lamport garantem que, se a → b, então L(a) < L(b). Pela contrapositiva: se L(a) < L(b), b não aconteceu antes de a. Eles não distinguem "a → b" de "concorrentes". Relógios vetoriais distinguem.
