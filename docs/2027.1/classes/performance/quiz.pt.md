Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Vocabulário e a curva

**Q1.** O `inventory` conclui 2 000 reservas por segundo e cada reserva passa em média 150 ms no serviço. Quantas reservas estão em andamento a cada momento, em média?

- A. 13
- B. 150
- C. 300
- D. 2 150

??? success "Resposta"
    **C — 300.**

    Lei de Little: N = X × R = 2 000/s × 0,15 s = 300. Essa é a concorrência que o caminho precisa acomodar — threads, slots assíncronos ou conexões — e o número de VUs de que um gerador de carga precisa para sustentar essa taxa quando cada iteração dura 150 ms.

---

**Q2.** Um teste breakpoint de `POST /holds` mostra: até 1 100 req/s o p99 fica abaixo do SLO de 300 ms; a 1 200 req/s o p99 é 650 ms; a vazão máxima alcançada é 1 250 req/s; além disso a vazão cai. Qual número o planejamento de capacidade deve usar por deployment?

- A. 1 250 req/s, a vazão máxima
- B. 1 100 req/s, o joelho — a maior taxa que ainda cumpre o SLO
- C. 1 200 req/s, o primeiro ponto acima do joelho
- D. A média de todos os degraus

??? success "Resposta"
    **B — O joelho.**

    A 1 200–1 250 req/s o sistema "funciona", mas quebra o SLO; acima de 1 250 ele está saturado e retrógrado. Planeje com a vazão em que o SLO vale e depois acrescente folga abaixo dela.

---

**Q3.** Segundo a Lei Universal de Escalabilidade, por que a vazão pode **diminuir** quando você adiciona mais requisições concorrentes a partir de certo ponto?

- A. Porque o gerador de carga fica mais lento
- B. Por causa dos custos de coerência (κ): manter o estado compartilhado consistente cresce com N², então, depois de um pico, cada requisição extra custa mais do que contribui — locks, invalidação de cache, retries
- C. Porque a Lei de Little deixa de valer com carga alta
- D. Não pode: a vazão sempre cresce ou fica estável

??? success "Resposta"
    **B — Custos de coerência (e de contenção).**

    A USL acrescenta um termo de contenção σ(N−1) e um termo de coerência κN(N−1) ao denominador. O termo quadrático acaba dominando, produzindo um pico e depois escala retrógrada. É por isso que a sobrecarga torna os sistemas *menos* produtivos e por que o controle de admissão (uma sala de espera) ajuda.

---

## Metodologia

**Q4.** Durante um teste, o `inventory` está com 45 % de CPU, todas as 200 threads do Tomcat ocupadas, o pool Hikari com 10/10 ativas e 180 threads pendentes, e o PostgreSQL a 35 % de CPU com a maioria das sessões em `wait_event = Lock: tuple`. Qual é o gargalo?

- A. CPU do `inventory` — adicione pods
- B. CPU do PostgreSQL — use uma instância maior
- C. Contenção de locks de linha no banco, que faz as transações segurarem as conexões por mais tempo e esgota o pool e as threads
- D. O pool de threads do Tomcat — aumente para 800

??? success "Resposta"
    **C — Contenção de locks.**

    Seguindo o método USE adiante: a CPU não está saturada em lugar nenhum; as threads e o pool estão saturados porque *esperam*; as esperas terminam em locks de linha. Mais pods ou threads acrescentam mais gente esperando; uma instância maior já tem CPU ociosa. Encurte as transações, use `SKIP LOCKED` e controle a admissão.

---

**Q5.** Qual é a principal diferença entre os métodos USE e RED?

- A. USE é para Java, RED é para Python
- B. O USE verifica cada **recurso** (utilização, saturação, erros) por dentro; o RED verifica cada **serviço** (taxa, erros, duração) como os usuários o experimentam — o RED diz qual serviço sofre, o USE diz qual recurso dentro dele é a causa
- C. O RED substitui o USE no Kubernetes
- D. O USE mede latência, o RED mede CPU

??? success "Resposta"
    **B.**

    Eles são complementares. Em um teste de carga, as métricas RED viram os thresholds (por endpoint), e quando um threshold falha, o USE nos recursos — incluindo recursos de software como pools e locks — localiza o gargalo.

---

**Q6.** O banco de staging usado em um teste de carga tem 1 000 assentos para um evento; a produção terá 60 000 assentos para o show no estádio mais todos os outros eventos. Qual resultado é mais provavelmente enganoso?

- A. A taxa de erros de `GET /search`
- B. A latência das consultas de assentos e a taxa de acerto do cache: tabelas pequenas cabem na memória e tornam invisíveis índices ausentes e efeitos de cache frio
- C. O tempo de handshake TLS
- D. O tamanho da imagem do container

??? success "Resposta"
    **B.**

    Volume e distribuição dos dados decidem a profundidade dos índices, a escolha dos planos, se o conjunto de trabalho cabe na memória e a taxa de acerto do cache. Teste com dados sintéticos do tamanho e da forma (assimétrica) da produção.

---

## Testes de carga

**Q7.** Um teste de modelo fechado tem 200 VUs com 1 s de think time. Quando o tempo de resposta do sistema vai de 0,1 s para 2 s, o que acontece com a carga que o teste gera?

- A. Fica em ~182 req/s
- B. Aumenta, porque os VUs fazem retry
- C. Cai de ~182 req/s para ~67 req/s — o teste recua exatamente quando o sistema sofre
- D. Cai para zero

??? success "Resposta"
    **C.**

    X = N / (R + Z): 200 / 1,1 ≈ 182 req/s, e 200 / 3,0 ≈ 67 req/s. Fãs reais chegando pela internet não desaceleram porque o sistema desacelerou; um modelo aberto (taxa de chegada) continua enviando ~182 req/s e revela a fila.

---

**Q8.** Qual executor do k6 implementa um modelo de carga **aberto**?

- A. `constant-vus`
- B. `ramping-vus`
- C. `per-vu-iterations`
- D. `ramping-arrival-rate`

??? success "Resposta"
    **D — `ramping-arrival-rate`** (e `constant-arrival-rate`).

    Executors de taxa de chegada iniciam iterações em um cronograma, independentemente de quanto duram as iterações anteriores. Executors baseados em VUs são fechados: cada VU espera sua iteração terminar antes de começar a próxima.

---

**Q9.** Um teste k6 de taxa de chegada a 1 000 iterações/s reporta `dropped_iterations` = 48 000. O que isso significa?

- A. 48 000 requisições falharam com 5xx
- B. O k6 não tinha VUs suficientes para iniciar as iterações no horário, então o teste não entregou a carga pretendida — degenerou em algo parecido com um teste fechado. Aumente `preAllocatedVUs`/`maxVUs` (VUs ≈ taxa × duração da iteração) ou distribua o gerador
- C. Os thresholds abortaram o teste
- D. O servidor descartou 48 000 conexões TCP

??? success "Resposta"
    **B.**

    Iterações descartadas são carga que nunca foi enviada. Adicione um threshold `dropped_iterations: ['count==0']` para que um teste assim não possa passar, e dimensione os VUs com a Lei de Little.

---

**Q10.** Um servidor congela por 1,5 s quatro vezes em um minuto. Um testador de laço fechado reporta p99 = 1 ms; um testador de modelo aberto que mede a partir do horário pretendido de envio reporta p99 ≈ 1,4 s. Qual afirmação é correta?

- A. O número do laço fechado está certo; o modelo aberto conta em dobro as requisições lentas
- B. O testador de laço fechado sofreu omissão coordenada: parou de enviar durante os congelamentos, então omitiu justamente as requisições que teriam sido lentas; os usuários experimentam o número do modelo aberto
- C. Os dois estão errados porque o teste foi curto demais
- D. A diferença é causada por jitter de rede

??? success "Resposta"
    **B — Omissão coordenada.**

    O testador se coordenou com os travamentos do servidor: uma amostra lenta por congelamento em vez de ~150. Use geradores de modelo aberto (executors de taxa de chegada do k6, wrk2, vegeta, `injectOpen` do Gatling), meça a partir do horário pretendido de início e conte os timeouts com sua duração total.

---

**Q11.** Qual tipo de teste foi projetado para encontrar vazamentos de memória ou de conexões?

- A. Smoke
- B. Spike
- C. Soak
- D. Breakpoint

??? success "Resposta"
    **C — Soak (resistência).**

    Vazamentos e crescimento lento precisam de tempo. Um teste soak mantém uma carga realista por horas e é lido como tendências: heap depois do GC, conexões abertas, latência na hora 8 vs na hora 1.

---

**Q12.** Um assento esgotado faz `POST /holds` retornar `409 Conflict`. Por padrão, o k6 o conta em `http_req_failed`. O que o teste deve fazer?

- A. Ignorar `http_req_failed` completamente
- B. Declarar 409 como status esperado (`http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409))`) para que só as falhas reais contem, e verificar o resultado de negócio separadamente (assentos reservados)
- C. Repetir os 409 até darem certo
- D. Remover o fluxo de reserva do teste

??? success "Resposta"
    **B.**

    Decida explicitamente quais status são comportamento correto. Contar 409 como erro faz um sistema correto reprovar nos thresholds; contar 503 como sucesso esconde um sistema sobrecarregado. Uma métrica de negócio como `seats_held` confirma que trabalho útil aconteceu.

---

## Gargalos e capacidade

**Q13.** O `inventory` tem CPU baixa mas latência alta sob carga. Qual perfil é mais útil?

- A. Um flame graph de CPU (on-CPU)
- B. Um perfil wall-clock (off-CPU), ex.: `asprof -e wall`, que também amostra threads esperando por locks, sockets e pools
- C. Um perfil de alocações
- D. Nenhum perfil: adicione pods

??? success "Resposta"
    **B — Wall-clock.**

    Perfis on-CPU só mostram código em execução; quando o tempo é gasto esperando, eles apontam para o pouco trabalho de CPU que existe (JSON, logs) — a correção errada. Um perfil wall-clock mostra que o tempo é gasto em `HikariPool.getConnection`, em uma leitura de socket dentro de uma consulta com lock, ou em uma chamada HTTP dentro de uma transação.

---

**Q14.** No `EXPLAIN (ANALYZE, BUFFERS)` você vê `Seq Scan on seats … Rows Removed by Filter: 5968520` e `Buffers: shared read=59861` para uma consulta que retorna 8 linhas. Qual é a correção mais provável?

- A. Aumentar o `work_mem`
- B. Um índice que corresponda ao filtro (e à ordenação), ex.: um índice parcial em `(event_id, section, row_label, seat_number) WHERE status = 'AVAILABLE'`, criado com `CONCURRENTLY`
- C. Adicionar uma réplica de leitura
- D. Aumentar o tamanho do pool de conexões

??? success "Resposta"
    **B.**

    A varredura lê 6 milhões de linhas e ~60 000 páginas para retornar 8. Um índice que corresponda ao predicado e à ordem permite ao PostgreSQL ler as 8 primeiras linhas diretamente — no exemplo da página, de 412 ms para menos de 0,1 ms.

---

**Q15.** As reservas têm pico de 4 500/s. O joelho de um pod de `inventory` é 275 reservas/s, você planeja operar a 75 % do joelho, e as réplicas ficam espalhadas por 3 zonas de modo que perder uma zona ainda deixe capacidade suficiente. De quantos pods você precisa?

- A. 17
- B. 22
- C. 33
- D. 45

??? success "Resposta"
    **C — 33.**

    ⌈4 500 / (275 × 0,75)⌉ = ⌈21,8⌉ = 22 pods para a carga. Para sobreviver à perda de uma de três zonas, os dois terços restantes ainda precisam somar 22: ⌈22 × 3/2⌉ = 33. Depois verifique os recursos compartilhados: 33 pods × um pool de 10 = 330 conexões de clientes → PgBouncer.

---

**Q16.** Um time adiciona um teste de orçamento com k6 em todo pull request, mas ele falha ao acaso cerca de uma vez por semana e os desenvolvedores o rodam de novo até passar. Qual é a melhor melhoria?

- A. Remover o teste
- B. Reduzir o ruído (taxa de chegada fixa, aquecimento, mesmo tipo de runner, uma repetição automática), comparar de forma relativa com a linha de base da `main` com uma tolerância, e adicionar orçamentos determinísticos como statements SQL por requisição
- C. Aumentar os thresholds para 10 s
- D. Rodar o teste breakpoint completo em todo pull request

??? success "Resposta"
    **B.**

    Um gate em que ninguém confia é pior que nenhum gate. Mantenha o gate do PR curto e estável, pegue as grandes regressões com uma comparação relativa, use verificações determinísticas (contar consultas pega N+1 com confiabilidade) e rode a campanha completa todas as noites ou antes de eventos no ambiente de desempenho.
