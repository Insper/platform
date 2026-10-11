Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## SLI / SLO / SLA / Error Budget

**Q1.** Por que a **utilização de CPU** é um mau Service Level Indicator (SLI)?

- A. É difícil demais de medir com precisão com as ferramentas modernas
- B. Ela mede o estado da infraestrutura, não a qualidade percebida pelo usuário — um serviço pode estar com 95% de CPU e atender todas as requisições corretamente, ou com 5% de CPU e estar completamente fora do ar
- C. As métricas de CPU são zeradas a cada reinício do container, tornando impossível acompanhar tendências
- D. Ela não é suportada pelo Prometheus nem pelo Grafana

??? success "Resposta"
    **B — Mede a infraestrutura, não a experiência do usuário.**

    Um bom SLI reflete se o usuário está obtendo valor do serviço. A utilização de CPU se correlaciona mal com a experiência do usuário — um serviço limitado por CPU ainda pode responder corretamente, enquanto um serviço com a CPU ociosa pode estar fora do ar por causa de um deadlock. Use taxa de sucesso das requisições, percentis de latência ou taxa de erros.

---

**Q2.** Para um **SLO de disponibilidade de 99,9%** em 28 dias, aproximadamente quantos minutos de indisponibilidade são permitidos?

- A. ~4,03 minutos
- B. ~40,3 minutos
- C. ~403 minutos
- D. ~8,77 horas

??? success "Resposta"
    **B — ~40,3 minutos.**

    28 dias × 24 h × 60 min = 40.320 minutos, e 0,1% disso é ≈ 40,3 minutos. O valor de ~43,8 minutos que aparece em muitas tabelas de "noves" é para um mês de calendário médio (365,25 / 12 ≈ 30,44 dias), e 8,77 horas é o orçamento de um ano inteiro. Sempre calcule o orçamento para a janela que o SLO de fato usa.

---

**Q3.** O que acontece com as prioridades do trabalho de engenharia quando o **error budget se esgota**?

- A. O SLO é automaticamente relaxado para 99,5% pelo restante da janela
- B. A equipe de operações assume todos os deploys até o início da próxima janela
- C. Deploys não essenciais são congelados e o trabalho de confiabilidade passa a ter prioridade sobre novas funcionalidades até o orçamento ser restabelecido
- D. A equipe aciona o engenheiro de plantão, que precisa aprovar todos os commits seguintes

??? success "Resposta"
    **C — Deploys não essenciais congelados; trabalho de confiabilidade priorizado.**

    O error budget é a licença da equipe para assumir riscos. Quando ele acaba, novos deploys arriscados levariam a violação do SLO de "possível" para "garantida". A política de orçamento cria um mecanismo objetivo e baseado em dados para SRE e PM chegarem a um acordo: "acabou o orçamento deste mês, as funcionalidades esperam."

---

**Q4.** Qual é a distinção fundamental entre um **SLO** e um **SLA**?

- A. Um SLO se aplica a APIs; um SLA se aplica a bancos de dados
- B. Um SLO é uma meta interna de engenharia (mais estrita); um SLA é um contrato jurídico com os clientes, com consequências financeiras se for violado (mais tolerante)
- C. SLOs são medidos em porcentagens; SLAs são medidos em minutos absolutos de indisponibilidade
- D. SLOs expiram após 28 dias; SLAs são permanentes até serem renegociados

??? success "Resposta"
    **B — SLO = meta interna (mais estrita); SLA = contrato jurídico (mais tolerante).**

    A folga entre SLO e SLA é intencional: se o seu SLO é 99,95% e o seu SLA é 99,9%, você pode violar a meta interna sem disparar penalidades contratuais. Essa margem dá à equipe um aviso antecipado antes que o compromisso com o cliente esteja em risco.

---

**Q5.** Uma burn rate de **14,4×** em uma janela de SLO de 28 dias significa o quê, na prática?

- A. O serviço está se saindo 14,4× melhor do que o SLO exige
- B. 14,4% do error budget foi consumido na última hora
- C. O error budget vai se esgotar em exatamente 14,4 dias
- D. O error budget será totalmente consumido em aproximadamente 48 horas — um alerta crítico que exige resposta imediata

??? success "Resposta"
    **D — Orçamento esgotado em ~48 horas.**

    Burn rate 1 = consumir o orçamento exatamente no ritmo que o SLO permite. Burn rate 14,4 = consumi-lo 14,4× mais rápido. Um orçamento de 28 dias a uma burn rate de 14,4× se esgota em 28/14,4 ≈ 1,94 dia ≈ 47 horas. Esse é o limite a partir do qual se justifica acionar o plantão imediatamente — o incidente avança rápido demais para ser resolvido no próximo dia útil. (Em uma hora, uma burn rate de 14,4× consome cerca de 2% do orçamento, que é como o SRE Workbook deriva esse número.)

---

**Q6.** Qual é a **diferença entre MTTF e MTTR**, e qual alavanca é mais rápida de melhorar durante um incidente em produção?

- A. MTTF é a frequência de falhas; MTTR é o tempo de reparo — o MTTF é mais rápido de melhorar
- B. MTTF é o tempo médio até a falha (quanto tempo até quebrar); MTTR é o tempo médio de reparo (quanto tempo para consertar) — o MTTR é mais rápido de melhorar durante um incidente em andamento
- C. São equivalentes; melhorar um melhora automaticamente o outro
- D. O MTTF mede falhas de software; o MTTR mede falhas de hardware

??? success "Resposta"
    **B — MTTF = tempo até a falha; MTTR = tempo de reparo; o MTTR é mais rápido de melhorar durante um incidente.**

    Durante um incidente em andamento, você não consegue evitar a falha retroativamente (ela já aconteceu). O que você controla é o MTTR: detecção mais rápida (alertas), diagnóstico mais rápido (runbooks, rastreamento distribuído) e mitigação mais rápida (feature flags, procedimentos de rollback). No longo prazo, o MTTF melhora com testes melhores e projeto tolerante a falhas.

---

## Padrões de Resiliência

**Q7.** Em que estado um circuit breaker entra depois que seu **tempo de espera** expira enquanto está no estado Open?

- A. Closed — ele assume automaticamente que o serviço se recuperou
- B. Failed — ele exige intervenção manual para ser restaurado
- C. Half-Open — ele permite um número limitado de requisições de teste para verificar se o serviço se recuperou
- D. Degraded — ele deixa passar o tráfego a 50% da taxa normal

??? success "Resposta"
    **C — Half-Open.**

    O estado Open bloqueia todas as requisições. Após um tempo de espera configurado (por exemplo, 30 segundos), o breaker passa para Half-Open e libera um pequeno número de requisições de teste. Se elas tiverem sucesso, o serviço se recuperou e o breaker fecha. Se falharem, o serviço continua fora do ar e o breaker volta para Open.

---

**Q8.** Por que você **nunca deve fazer retry** de um `POST /orders` não idempotente sem salvaguardas adicionais?

- A. `POST` não pode ser repetido no nível do protocolo HTTP
- B. O servidor retornará 405 Method Not Allowed na segunda tentativa
- C. Cada retry pode criar um pedido duplicado — retries só são seguros para operações idempotentes ou protegidas por chaves de idempotência
- D. Circuit breakers bloqueiam automaticamente todos os retries de requisições `POST`

??? success "Resposta"
    **C — Cada retry pode criar um pedido duplicado.**

    `POST /orders` cria um novo recurso a cada chamada. Se a requisição tiver sucesso no servidor, mas a resposta se perder (partição de rede), um retry criará um segundo pedido. Retries seguros para operações não idempotentes exigem uma *chave de idempotência* — um ID único gerado pelo cliente, que o servidor usa para detectar e deduplicar requisições repetidas.

---

**Q9.** Que problema a adição de **jitter** ao backoff exponencial resolve?

- A. Impede que o atraso do backoff cresça indefinidamente
- B. Garante que todos os clientes usem o mesmo intervalo de retry, para ser previsível
- C. Quebra a manada estrondosa (thundering herd) — sem jitter, todos os clientes que falharam ao mesmo tempo repetem nos mesmos instantes, gerando picos de carga no serviço que está se recuperando
- D. Torna aleatório qual servidor de backend atende a requisição repetida

??? success "Resposta"
    **C — Quebra a manada estrondosa.**

    Imagine 1.000 clientes falhando todos em t=0 e repetindo em t=1s, t=2s, t=4s em perfeita sincronia. Cada onda de retries atinge o serviço em recuperação com um pico enorme, podendo fazê-lo falhar de novo. Adicionar jitter aleatório espalha os retries por uma janela de tempo, convertendo um pico em um fluxo contínuo administrável.

---

**Q10.** Quais padrões se combinam para formar uma cadeia de chamadas com **defesa em profundidade**? Escolha a resposta mais completa.

- A. Só circuit breaker + timeout — os outros adicionam complexidade desnecessária
- B. Rate limiter → circuit breaker → bulkhead → timeout → retry com backoff
- C. Balanceador de carga → health check → circuit breaker
- D. Retry com backoff → bulkhead → rate limiter → timeout

??? success "Resposta"
    **B — Rate limiter → circuit breaker → bulkhead → timeout → retry com backoff.**

    Cada camada trata um cenário de falha distinto: o rate limiter protege contra picos de tráfego e abusos; o circuit breaker falha rápido nas chamadas a dependências que sabidamente estão falhando; o bulkhead isola pools de threads para que uma dependência lenta não deixe as outras sem recursos; o timeout limita o tempo de espera; o retry trata falhas transitórias. Na organização mostrada em aula, o rate limiting e a falha rápida acontecem antes de ocupar uma thread do bulkhead. As bibliotecas podem aninhá-los de outro jeito — o padrão do Resilience4j coloca o Retry como camada mais externa, para que cada tentativa passe pelo breaker —, mas o conjunto de camadas é o mesmo, e C e D deixam de fora camadas essenciais.

---

**Q11.** Duas réplicas do gateway, cada uma disponível 99% do tempo e falhando de forma independente, ficam atrás do Nginx. Qualquer uma das réplicas consegue atender todo o tráfego. Qual é a disponibilidade da camada do gateway (ignorando o Nginx)?

- A. 98,01%
- B. 99%
- C. 99,5%
- D. 99,99%

??? success "Resposta"
    **D — 99,99%.**

    Em paralelo, a camada só fica fora do ar quando *as duas* réplicas estão fora ao mesmo tempo: 0,01 × 0,01 = 0,0001, então a disponibilidade = 1 − 0,0001 = 99,99%. A opção A (0,99²) é a fórmula para componentes em **série**, em que todos precisam funcionar. O resultado só vale se as falhas forem independentes — duas réplicas no mesmo nó ou com a mesma configuração errada falham juntas.

---

**Q12.** A liveness probe do serviço de pedidos chama o banco de dados e falha quando ele está inacessível. O banco fica fora do ar por 15 segundos. O que acontece no Kubernetes?

- A. Nada — o Kubernetes ignora falhas de liveness com menos de um minuto
- B. Os pods são removidos dos endpoints do Service até o banco voltar e então recebem tráfego de novo
- C. Todas as réplicas falham a liveness ao mesmo tempo e são reiniciadas, então uma oscilação curta do banco vira uma indisponibilidade total enquanto todas as JVMs sobem de novo
- D. Só uma réplica é reiniciada, porque o Kubernetes reinicia os pods um de cada vez

??? success "Resposta"
    **C — Todas as réplicas reiniciam juntas.**

    A liveness responde "este processo está travado?"; uma falha dispara um **reinício**. Como todas as réplicas dependem do mesmo banco, todas falham a liveness juntas e são todas reiniciadas, transformando um soluço de 15 segundos em minutos de indisponibilidade. A opção B descreve o que uma falha de **readiness** faz. Mantenha as dependências externas fora da liveness.

---

**Q13.** O gateway, o serviço de pedidos e seu cliente Feign para o serviço de produtos fazem, cada um, até 3 tentativas em chamadas que falham. O serviço de produtos começa a falhar. Quantas chamadas uma única requisição de usuário pode gerar ao serviço de produtos, no pior caso?

- A. 3
- B. 9
- C. 27
- D. 81

??? success "Resposta"
    **C — 27 (3 × 3 × 3).**

    Retries em cada camada se multiplicam: cada uma das 3 tentativas do gateway chega ao serviço de pedidos, que faz 3 tentativas, cada uma das quais o cliente Feign tenta 3 vezes. Essa *amplificação de retries* atinge o serviço em dificuldade com mais força justamente quando ele está mais fraco. Faça retry em uma única camada, limite as tentativas, use backoff com jitter e pare de repetir quando o circuit breaker estiver aberto.

---

**Q14.** Um cliente envia `POST /orders` com o cabeçalho `Idempotency-Key: k-42`. O servidor cria o pedido, mas a resposta se perde e o cliente faz retry com a mesma chave. O que o servidor deve fazer?

- A. Criar um segundo pedido, porque todo `POST` cria um novo recurso
- B. Retornar `409 Conflict` e pedir que o cliente gere uma nova chave
- C. Reconhecer a chave como já processada e retornar o resultado da primeira requisição, sem criar outro pedido
- D. Apagar o primeiro pedido e criar um novo para manter os dados consistentes

??? success "Resposta"
    **C — Retornar o resultado armazenado para a mesma chave.**

    A chave de idempotência identifica uma operação *lógica*. O servidor guarda as chaves que já processou (com seus resultados), de modo que uma chave repetida devolve a resposta original em vez de duplicar o pedido. Isso torna seguro fazer retry de um `POST` não idempotente.

---

## Engenharia do Caos

**Q15 (bônus).** O primeiro Princípio da Engenharia do Caos exige estabelecer um **estado estável** antes de injetar falhas. A que se refere "estado estável"?

- A. Um congelamento de deploys em que nenhuma alteração de código é feita durante o experimento
- B. Uma referência mensurável do comportamento normal do sistema, expressa como SLIs — taxa de requisições, taxa de erros, latência —, contra a qual o impacto do experimento é avaliado
- C. Um estado em que todos os serviços rodam exatamente a 50% da capacidade
- D. A configuração do sistema no último deploy reconhecidamente bom

??? success "Resposta"
    **B — Referência mensurável de SLIs.**

    Você não consegue determinar se a injeção de uma falha causou degradação a menos que saiba como é o "normal". A hipótese de estado estável é: *"Mesmo com a condição X injetada, o sistema continuará exibindo [valores específicos de SLI]."* Refutar a hipótese é uma descoberta — o sistema não trata aquela condição como foi projetado.
