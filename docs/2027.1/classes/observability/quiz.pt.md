
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Observabilidade e health checks

**Q1.** Durante a abertura de vendas do BoxOffice, todos os pods estão verdes, a CPU está em 45% e a taxa de erros geral é de 0,3%, mas os fãs esperam nove segundos para pagar. Qual afirmação explica melhor por que os dashboards não mostraram o problema?

- A. O backend de métricas estava amostrando de forma agressiva demais
- B. Os dashboards acompanhavam causas em média sobre todas as rotas; o problema era latência de cauda em uma rota, causada por uma dependência externa
- C. Os health checks do Kubernetes não são confiáveis sob carga
- D. Taxas de erro abaixo de 1% não podem ser medidas com o Prometheus

??? success "Resposta"
    **B — Causas, em média sobre tudo, escondem um sintoma de latência de cauda em uma jornada.**

    CPU e status dos pods são causas escolhidas de antemão. A experiência dos fãs era um sintoma de **latência** no `POST /checkout`, concentrado no **p99**, causado pelo provedor de pagamentos. A média sobre todas as rotas dilui a rota de checkout, e a mediana esconde a cauda. Meça o que os usuários sentem — percentis de latência e SLIs por jornada — e use traces para descobrir para onde foi o tempo.

---

**Q2.** A probe de readiness do `order` verifica a conexão com o PostgreSQL. O banco faz um failover de 20 segundos. O que acontece?

- A. Nada: falhas de readiness só afetam pods novos
- B. O Kubernetes reinicia todos os pods do `order`, que é o comportamento de autorrecuperação desejado
- C. Todos os pods do `order` ficam não prontos ao mesmo tempo e são removidos do Service, então até as rotas que não precisam do banco devolvem erros
- D. O load balancer continua enviando tráfego, porque a readiness só é verificada na inicialização

??? success "Resposta"
    **C — Uma falha de readiness correlacionada remove todas as instâncias de uma vez.**

    Uma dependência compartilhada por todas as instâncias faz todas falharem a probe juntas: o Service fica sem endpoints e toda rota falha, inclusive as servidas pelo Redis. (Se a probe de *liveness* verificasse o banco, o Kubernetes também reiniciaria todos os pods — uma tempestade de reinícios.) A liveness nunca deve verificar dependências; a readiness deve verificar só o que outra instância resolveria; a saúde das dependências pertence a métricas, alertas, timeouts e circuit breakers.

---

**Q3.** Qual probe deve falhar se uma JVM está em deadlock e nunca vai se recuperar sozinha?

- A. Startup
- B. Liveness
- C. Readiness
- D. Nenhuma — deadlocks devem ser tratados por um alerta para um humano

??? success "Resposta"
    **B — Liveness.**

    A liveness responde "o processo travou sem conserto?", e sua falha **reinicia** o container. A readiness só remove a instância do load balancer (útil quando ela está temporariamente incapaz de atender, por exemplo sobrecarregada ou drenando). A startup protege aplicações de inicialização lenta pausando as outras probes até a inicialização terminar.

---

## Sinais

**Q4.** Um time adiciona o label `customer_id` (cerca de 1 milhão de valores) ao histograma de latência do checkout, que já tem 204.000 séries. Qual é a consequência mais provável?

- A. As consultas ficam um pouco mais lentas, mas nada mais muda
- B. O número de séries é multiplicado por até um milhão, e o backend de métricas fica sem memória ou a fatura explode
- C. O Prometheus descarta o label automaticamente porque ele tem alta cardinalidade
- D. Nada, porque histogramas guardam só buckets, não labels

??? success "Resposta"
    **B — A cardinalidade se multiplica.**

    Cada combinação distinta de valores de labels é uma série separada; adicionar um label ilimitado multiplica o número de séries pelo número de valores dele. Perguntas por cliente pertencem a **traces e logs**, onde `customer_id` é um atributo consultado sob demanda, e não uma dimensão pré-agregada de métrica.

---

**Q5.** Quatro pods do `order` informam o próprio p99 de latência: 180 ms, 180 ms, 180 ms e 1.260 ms (o pod lento atende 10% do tráfego). Qual é o jeito correto de obter o p99 da frota?

- A. Tirar a média dos quatro valores: 450 ms
- B. Pegar o máximo: 1.260 ms
- C. Somar os buckets do histograma de todos os pods (`sum by (le)`) e calcular o percentil a partir do total
- D. Pegar a mediana dos quatro valores: 180 ms

??? success "Resposta"
    **C — Agregue os buckets primeiro, depois calcule o percentil.**

    Percentis não se compõem: nem a média nem o máximo dos p99 por pod é o p99 da frota. Buckets de histograma são contadores, então podem ser somados entre pods; `histogram_quantile(0.99, sum by (le) (rate(..._bucket[5m])))` estima o percentil verdadeiro. Na simulação da página de Sinais, o p99 real da frota é de cerca de 750 ms, enquanto a média dos p99 é de cerca de 450 ms.

---

**Q6.** Qual associação entre método e alvo está correta?

- A. RED para o pool de conexões do PostgreSQL; USE para o endpoint `POST /checkout`
- B. RED para o endpoint `POST /checkout`; USE para o pool de conexões do PostgreSQL
- C. RED e USE são sinônimos dos quatro golden signals
- D. USE se aplica apenas a CPU e memória

??? success "Resposta"
    **B — RED para serviços orientados a requisições, USE para recursos.**

    RED (taxa, erros, duração) descreve o que quem chama um serviço vivencia. USE (utilização, saturação, erros) descreve um recurso — CPU, discos, mas também pools e filas. Para o pool de conexões, a **saturação** (aquisições pendentes, tempo de espera) costuma ser o primeiro aviso de que a latência do checkout vai subir.

---

**Q7.** Num trace de checkout, o span `payment` leva 8,95 s, dos quais um span filho `pool.acquire` leva 7,9 s e a chamada HTTP ao provedor leva 1,0 s. Qual é a principal conclusão?

- A. O provedor é responsável pelos 9 segundos
- B. A maior parte do tempo é gasta esperando por uma conexão dentro do BoxOffice: o pool está saturado porque cada chamada lenta segura uma conexão por mais tempo
- C. O trace está quebrado, porque spans filhos não podem ser mais longos que a chamada ao provedor
- D. O banco de dados é o gargalo

??? success "Resposta"
    **B — A fila dentro do serviço domina o caminho crítico.**

    O provedor ficou mais lento (1 s), então, pela lei de Little, cada chamada segura uma conexão por mais tempo, o pool de 20 satura e as novas chamadas esperam 7,9 s na fila. A correção é uma espera limitada e um timeout curto na chamada ao provedor (mais um bulkhead), não apenas uma reclamação ao provedor. Sem um span para a espera, o provedor levaria a culpa pelos nove segundos.

---

## OpenTelemetry

**Q8.** Uma requisição passa por `gateway` → `order` → `inventory`. O que acontece com o header W3C `traceparent` a cada salto?

- A. Cada serviço gera um novo trace-id
- B. O trace-id e as flags são mantidos; o parent-id é substituído pelo ID do span atual de quem chama
- C. O header é repassado sem alteração para que o backend identifique o span raiz
- D. Quem é chamado devolve o header na resposta, e quem chamou o mescla

??? success "Resposta"
    **B — Mesmo trace-id, novo parent-id a cada salto.**

    `traceparent: 00-<trace-id>-<parent-id>-<flags>`. Manter o trace-id agrupa todos os spans da requisição; substituir o parent-id permite ao backend reconstruir a árvore. Nenhum serviço precisa conhecer o trace inteiro.

---

**Q9.** O BoxOffice atende 2.000 requisições/s e 1% delas falham. Qual configuração de amostragem guarda **todos** os traces de erro armazenando menos de 10% de todos os traces?

- A. Head sampling de 10% em todos os serviços
- B. Rate limiting de 100 traces por segundo
- C. Head sampling de 100% nos serviços e uma política de tail sampling no Collector: todos os erros, todos os traces lentos e 5% do resto
- D. Head sampling de 1% mais tail sampling de erros no Collector

??? success "Resposta"
    **C — Tail sampling com head sampling completo.**

    O head sampling decide antes de conhecer o resultado, então guarda os erros na mesma proporção de todo o resto (A e D perdem 90% ou 99% dos traces de erro; o tail sampler de D só vê o 1% que sobreviveu à cabeça). O tail sampling decide depois que o trace termina; com 1% de erros, 2% de lentos e 5% do resto, cerca de 7,8% dos traces são armazenados — e 100% dos erros. As métricas devem ser calculadas sobre todo o tráfego antes da amostragem.

---

**Q10.** Um time roda três réplicas de um Collector gateway atrás de um load balancer round-robin, cada uma com o processor de tail sampling. O que dá errado?

- A. Nada; o tail sampling não tem estado
- B. Spans do mesmo trace caem em réplicas diferentes, então cada réplica decide sobre fragmentos do trace
- C. Os Collectors não conseguem receber OTLP sobre gRPC atrás de um load balancer
- D. O tail sampling obriga cada réplica a guardar 100% dos traces

??? success "Resposta"
    **B — O tail sampling precisa do trace inteiro num só lugar.**

    A decisão ("este trace contém um erro?") exige todos os spans do trace. Use uma primeira camada que roteia por trace ID (o exporter `loadbalancing`) para uma segunda camada que faz a amostragem, de modo que todos os spans de um trace cheguem à mesma instância.

---

## Alertas

**Q11.** O SLO do checkout é 99,9% numa janela móvel de 28 dias. A razão de erros observada na última hora é 1,44%. Qual é o burn rate, e quanto do budget essa hora consumiu?

- A. Burn rate 1,44; 1,44% do budget
- B. Burn rate 14,4; cerca de 2% do budget
- C. Burn rate 144; cerca de 20% do budget
- D. Burn rate 14,4; cerca de 14,4% do budget

??? success "Resposta"
    **B — 14,4×, cerca de 2%.**

    Burn rate = 1,44% ÷ 0,1% = 14,4. Budget consumido = burn rate × duração ÷ janela = 14,4 × 1 h ÷ 672 h ≈ 2,1%, cerca de 2%. É o limiar clássico de page por queima rápida: nesse ritmo, o budget inteiro de 28 dias acaba em cerca de 2 dias (28 ÷ 14,4 ≈ 1,9).

---

**Q12.** Por que o alerta de SLO recomendado combina uma janela longa (1 h) com uma janela curta (5 min) no mesmo burn rate?

- A. A janela curta pega queimas lentas que a janela longa perde
- B. A janela longa prova que a queima é significativa; a janela curta prova que ela ainda está acontecendo, então o alerta para logo depois que o problema é corrigido
- C. O Prometheus não consegue avaliar sozinho janelas maiores que uma hora
- D. As duas janelas são combinadas por média para reduzir ruído

??? success "Resposta"
    **B — Significância pela janela longa, reset rápido pela curta.**

    Uma média de 1 hora continua alta por até uma hora depois que uma indisponibilidade curta termina, então um alerta só com a janela longa continua disparando (reset lento). Exigir também a janela de 5 minutos faz o alerta se apagar assim que os erros param. Queimas lentas são pegas por outras regras (6× em 6 h, 1× em 3 dias), não pela janela curta.

---

**Q13.** Qual destes deve acionar o engenheiro de on-call às 3 da manhã?

- A. CPU do primário PostgreSQL acima de 90% enquanto todos os SLIs estão dentro da meta
- B. Um de 30 pods do `catalog` reiniciou e já está saudável
- C. O SLO do checkout queimando a 20×, confirmado pelas janelas de 1 hora e de 5 minutos
- D. O disco de um broker Kafka com previsão de encher em 4 dias

??? success "Resposta"
    **C — Urgente, acionável e visível para o usuário.**

    A e B são causas sem impacto no usuário (dashboard, talvez uma revisão de capacidade). D é acionável, mas não urgente: um ticket para o horário comercial. Um page precisa ser urgente, acionável e sobre algo que os usuários sentem — o SLO queimando rápido.

---

## Resposta a incidentes

**Q14.** Doze minutos depois de um SEV1 começar, o líder de operações tem uma hipótese mas nenhuma prova; a troca para o provedor de pagamentos secundário está documentada e testada. O que o incident commander deve decidir?

- A. Continuar investigando até confirmar a causa raiz, para evitar uma mudança desnecessária
- B. Trocar agora para o provedor secundário para mitigar o impacto; investigar a causa raiz depois
- C. Pedir a cada engenheiro no canal que teste a própria hipótese em produção, em paralelo
- D. Esperar a página de status do provedor antes de agir

??? success "Resposta"
    **B — Mitigar primeiro.**

    Os usuários sentem o tempo até a **mitigação**. Uma mitigação genérica e ensaiada (failover, rollback, flag), que funciona qualquer que seja a causa exata, deve ser aplicada assim que for seguro. Mudanças paralelas e descoordenadas (C) pioram o incidente e tornam a linha do tempo ilegível; o entendimento vem depois, no postmortem.

---

**Q15.** Qual afirmação descreve melhor um postmortem **blameless**?

- A. Ele não registra quem fez o quê, então a linha do tempo é anônima e vaga
- B. Ele assume que as pessoas agiram de forma razoável com o que sabiam e pergunta como o sistema tornou a falha possível, produzindo ações com dono e data
- C. Ele só é escrito quando ninguém cometeu um erro
- D. Ele identifica a causa raiz única com os cinco porquês e encerra o incidente

??? success "Resposta"
    **B — Focado no sistema, honesto e acionável.**

    Blameless não significa vago: a linha do tempo é precisa, incluindo quem fez o quê. A questão é que as pessoas não são punidas por relatos honestos, então a organização aprende como as falhas realmente acontecem. Incidentes complexos têm vários **fatores contribuintes**; uma única cadeia de "cinco porquês" muitas vezes para no único fator que você não consegue corrigir (aqui, o provedor externo).
