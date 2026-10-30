Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** Por que o lab 2 usa `constant-arrival-rate` em vez de `constant-vus` no teste de carga?

- A. Executores por taxa de chegada usam menos memória
- B. Num modelo aberto a carga não diminui quando o servidor fica lento, então a sobrecarga aparece como latência crescente e `dropped_iterations` em vez de ficar escondida
- C. `constant-vus` não consegue mandar requisições GET
- D. Executores por taxa de chegada deixam o servidor mais rápido

??? success "Resposta"
    **B — Modelo aberto, sem coordinated omission.**

    Com um número fixo de VUs, cada VU espera a sua resposta antes de mandar a próxima requisição; quando o servidor fica lento, o gerador educadamente manda menos, e o teste subestima o estrago. Fãs reais chegam de forma independente, e é isso que os executores por taxa de chegada simulam.

---

**Q2.** A 300 req/s a latência média é de 20 ms. Pela Lei de Little, quantas requisições estão dentro do `catalog`, em média?

- A. 0,6
- B. 6
- C. 15
- D. 6.000

??? success "Resposta"
    **B — 6.**

    `L = λ × W = 300 × 0.020 = 6`. É isso que `tomcat.threads.busy` deveria mostrar em média. Quando o medidor discorda muito do cálculo, algo está fazendo fila fora do que você mediu (o lado do k6, a rede, a borda).

---

**Q3.** O `watch-metrics.sh` mostra `db_active = 10` e `db_pending = 150` enquanto o p99 sobe. Qual é o gargalo?

- A. As threads do Tomcat
- B. A rede entre o k6 e o serviço
- C. O pool de conexões com o banco (ou o banco por trás dele): as requisições estão fazendo fila para conseguir uma conexão
- D. O serializador JSON

??? success "Resposta"
    **C — O pool de conexões está cheio.**

    Dez conexões estão ocupadas e 150 requisições esperam por uma. Acrescentar threads ao Tomcat só acrescenta gente esperando. Ou cada requisição segura uma conexão por menos tempo (consultas mais rápidas, cache), ou se permitem mais conexões — se o banco aguentar.

---

**Q4.** Qual é a definição mais útil da **capacidade** de um serviço?

- A. O maior throughput que o k6 já imprimiu
- B. O número de núcleos de CPU
- C. A maior taxa de chegada em que o objetivo de latência (por exemplo, p99 < 300 ms) e o error budget ainda são cumpridos
- D. O número de VUs que o k6 conseguiu iniciar

??? success "Resposta"
    **C — Throughput sob um SLO.**

    Além do joelho o serviço ainda pode *processar* muitas requisições por segundo, mas os usuários esperam segundos. A capacidade é definida pelas metas de latência e de erros, e você planeja com uma margem abaixo dela.

---

**Q5.** Por que a latência cresce tão bruscamente perto do joelho em vez de linearmente?

- A. A coleta de lixo só roda sob carga alta
- B. Filas: o tempo de espera cresce mais ou menos como `S / (1 − ρ)`, que explode quando a utilização `ρ` se aproxima de 100%
- C. O k6 acrescenta latência de propósito
- D. O PostgreSQL fica lento depois de 300 consultas

??? success "Resposta"
    **B — Teoria das filas.**

    Com 50% de utilização, uma requisição espera em média cerca de um tempo de serviço; com 90%, cerca de nove; com 99%, cerca de noventa e nove. Pequenos aumentos de carga perto da saturação produzem aumentos enormes de latência — a curva em taco de hóquei da varredura.

---

**Q6.** Na varredura, a execução a 500 req/s mostra `dropped_iterations: 410`. O que isso significa?

- A. 410 requisições devolveram erros HTTP
- B. O k6 não conseguiu iniciar 410 iterações a tempo porque todos os seus VUs estavam ocupados esperando respostas lentas: a taxa oferecida não foi atingida
- C. O serviço derrubou 410 conexões TCP
- D. Os thresholds descartaram 410 pontos de dados

??? success "Resposta"
    **B — O gerador bateu em `maxVUs`.**

    Num teste por taxa de chegada, cada requisição em andamento ocupa um VU. Quando as respostas ficam lentas, o k6 precisa de mais VUs (a Lei de Little do lado do cliente); ao chegar a `maxVUs`, ele descarta iterações. É um sinal claro de saturação — e um motivo para aumentar `maxVUs` se você quiser continuar pressionando.

---

**Q7.** Você dobrou `DB_POOL_SIZE` de 10 para 20 e o joelho foi de ~350 para ~550 req/s. Por que não colocar 500?

- A. O HikariCP não permite mais de 100
- B. Cada conexão é um processo do PostgreSQL; além da capacidade do próprio banco, mais conexões só acrescentam contenção, e várias réplicas × pools grandes passam de `max_connections`
- C. Pools maiores deixam o Java mais lento
- D. O Flyway falharia

??? success "Resposta"
    **B — O gargalo passa para o banco.**

    Um pool é uma fila na frente de um recurso compartilhado. Aumentá-lo só ajuda enquanto o recurso tem capacidade sobrando; depois você tem o mesmo throughput com mais contenção (locks, trocas de contexto, memória). No lab 6, o PgBouncer e as réplicas tratam disso do jeito certo.

---

**Q8.** O primeiro ponto da sua varredura (50 req/s) tem um p99 pior que o segundo (100 req/s). O motivo mais provável:

- A. Carga menor é mais difícil de servir
- B. A JVM, o pool e os caches do banco ainda estavam aquecendo durante a primeira execução
- C. O k6 mede taxas baixas incorretamente
- D. O banco estava reindexando

??? success "Resposta"
    **B — Aquecimento.**

    Compilação JIT, carregamento de classes, conexões do pool e páginas frias do banco deixam o primeiro minuto mais lento. Por isso o `sweep.sh` roda antes um aquecimento que não é registrado, e por isso testes de carga sérios descartam o período de rampa.

---

**Q9.** No teste de estresse, depois que a carga cai para 25% do pico, o p95 continua alto por um minuto. O que isso indica?

- A. Nada: a latência sempre fica alta depois de um pico
- B. O trabalho enfileirado durante a sobrecarga ainda está sendo escoado (ou o serviço está num estado degradado), então o sistema não se recupera na hora; sem load shedding, uma sobrecarga longa pode mantê-lo doente
- C. O k6 ainda está mandando a taxa de pico
- D. Os thresholds estavam mal configurados

??? success "Resposta"
    **B — Filas levam tempo para esvaziar.**

    Toda requisição aceita durante a sobrecarga ainda precisa ser atendida. Um serviço saudável se recupera assim que o acúmulo é processado; um que nunca se recupera (retries, timeouts se acumulando, pressão de memória) precisa de mecanismos como load shedding, rate limiting e timeouts — labs 3 e 9.

---

**Q10.** Por que o k6 reporta p95 e p99 por endpoint (`name:detail`, `name:list`) em vez de um número global?

- A. Percentis globais não podem ser calculados
- B. Misturar um endpoint de 5 ms com um de 30 ms produz um percentil que não descreve nenhum dos dois; percentis por endpoint mostram qual se degrada primeiro
- C. Os thresholds exigem isso
- D. Para reduzir o uso de memória

??? success "Resposta"
    **B — Percentis de uma mistura escondem o culpado.**

    Com 80% de requisições rápidas e 20% lentas, o p95 global é basicamente a latência do endpoint lento e a mediana global, a do rápido. Marque as requisições por endpoint (a tag `name`) e defina thresholds por tag: você vê qual caminho quebra e quando.

---

**Q11.** A sua hipótese no playground dizia "o servidor de aplicação satura primeiro", mas as medições mostram o pool do banco saturando primeiro. Qual é a conclusão certa?

- A. O playground está errado e deve ser ignorado
- B. A medição vence: faltava um detalhe ao modelo (o tamanho do pool, o custo da consulta de listagem); atualize o modelo e use-o na próxima decisão
- C. Repita a medição até ela bater com a hipótese
- D. Acrescente mais servidores de aplicação mesmo assim

??? success "Resposta"
    **B — Modelos servem para prever, medições para decidir.**

    Uma simulação só é tão boa quanto os seus parâmetros. Comparar hipótese e medição é como você calibra o seu modelo mental — exatamente a habilidade que um entrevistador sonda ao perguntar "onde este design quebra?".
