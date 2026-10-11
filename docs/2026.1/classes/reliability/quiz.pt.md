Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## SLI / SLO / SLA / Error Budget

**Q1.** Por que a **utilização de CPU** é um Service Level Indicator (SLI) ruim?

- A. É difícil demais medi-la com precisão com as ferramentas modernas
- B. Ela mede o estado da infraestrutura, não a qualidade percebida pelo usuário — um serviço pode estar com 95% de CPU e atender todas as requisições corretamente, ou com 5% de CPU e estar completamente fora do ar
- C. As métricas de CPU são zeradas a cada reinício do container, o que impossibilita acompanhar tendências
- D. Ela não é suportada pelo Prometheus nem pelo Grafana

??? success "Resposta"
    **B — Mede a infraestrutura, não a experiência do usuário.**

    Um bom SLI reflete se o usuário está obtendo valor do serviço. A utilização de CPU se correlaciona mal com a experiência do usuário — um serviço limitado por CPU ainda pode responder corretamente, enquanto um serviço com a CPU ociosa pode estar fora do ar por causa de um deadlock. Use, em vez disso, a taxa de sucesso das requisições, percentis de latência ou a taxa de erros.

---

**Q2.** Para um **SLO de disponibilidade de 99,9%** em 28 dias, aproximadamente quantos minutos de indisponibilidade são permitidos?

- A. ~4,38 minutos
- B. ~43,8 minutos
- C. ~438 minutos
- D. ~8,77 horas

??? success "Resposta"
    **B — ~43,8 minutos.**

    0,1% de 28 dias × 24 h × 60 min = 0,001 × 28 × 1440 ≈ 40,3 minutos. O número comumente citado é ~43,8 minutos porque 28 dias × 24 h × 60 min = 40.320 minutos, e 0,1% disso são 40,32 minutos (a diferença depende da janela exata usada). De qualquer forma, o error budget para três noves é de aproximadamente 40–44 minutos por mês.

---

**Q3.** O que acontece com as prioridades do trabalho de engenharia quando o **error budget se esgota**?

- A. O SLO é automaticamente relaxado para 99,5% pelo restante da janela
- B. A equipe de operações assume todos os deploys até o início da próxima janela
- C. Os deploys não essenciais são congelados e o trabalho de confiabilidade passa a ter prioridade sobre novas funcionalidades até o orçamento ser renovado
- D. A equipe aciona o engenheiro de plantão, que precisa aprovar todos os commits seguintes

??? success "Resposta"
    **C — Deploys não essenciais congelados; trabalho de confiabilidade priorizado.**

    O error budget é a licença da equipe para assumir riscos. Quando ele acaba, novos deploys arriscados transformariam a violação do SLO de "possível" em "garantida". A política de orçamento cria um mecanismo objetivo e baseado em dados para que SRE e PM concordem: "estamos sem orçamento este mês; as funcionalidades esperam".

---

**Q4.** Qual é a distinção principal entre um **SLO** e um **SLA**?

- A. Um SLO se aplica a APIs; um SLA se aplica a bancos de dados
- B. Um SLO é uma meta interna de engenharia (mais estrita); um SLA é um contrato jurídico com os clientes, que traz consequências financeiras se for violado (mais tolerante)
- C. SLOs são medidos em porcentagens; SLAs são medidos em minutos absolutos de indisponibilidade
- D. SLOs expiram após 28 dias; SLAs são permanentes até serem renegociados

??? success "Resposta"
    **B — SLO = meta interna (mais estrita); SLA = contrato jurídico (mais tolerante).**

    A folga entre SLO e SLA é intencional: se o seu SLO é 99,95% e o seu SLA é 99,9%, você pode violar sua meta interna sem disparar penalidades contratuais. Essa margem dá à equipe um aviso antecipado antes que o compromisso com o cliente fique em risco.

---

**Q5.** Uma burn rate de **14,4×** em uma janela de SLO de 28 dias significa o quê, em termos práticos?

- A. O serviço está performando 14,4× melhor do que o SLO exige
- B. 14,4% do error budget foi consumido na última hora
- C. O error budget vai se esgotar em exatamente 14,4 dias
- D. O error budget será totalmente consumido em aproximadamente 48 horas — um alerta crítico que exige resposta imediata

??? success "Resposta"
    **D — Orçamento esgotado em ~48 horas.**

    Burn rate 1 = consumir o orçamento exatamente na taxa que o SLO permite. Burn rate 14,4 = consumi-lo 14,4× mais rápido. Um orçamento de 28 dias a uma burn rate de 14,4× se esgota em 28/14,4 ≈ 1,94 dia ≈ 47 horas. Esse é o limite a partir do qual se justifica acionar o plantão imediatamente — o incidente está avançando rápido demais para ser resolvido no próximo dia útil.

---

**Q6.** Qual é a **diferença entre MTTF e MTTR**, e qual alavanca é mais rápida de melhorar durante um incidente em produção?

- A. MTTF é a frequência das falhas; MTTR é o tempo de reparo — o MTTF é mais rápido de melhorar
- B. MTTF é o tempo médio até a falha (quanto tempo até quebrar); MTTR é o tempo médio de reparo (quanto tempo para consertar) — o MTTR é mais rápido de melhorar durante um incidente em andamento
- C. São equivalentes; melhorar um melhora automaticamente o outro
- D. O MTTF mede falhas de software; o MTTR mede falhas de hardware

??? success "Resposta"
    **B — MTTF = tempo até a falha; MTTR = tempo de reparo; o MTTR é mais rápido de melhorar durante um incidente.**

    Durante um incidente em andamento, você não consegue evitar retroativamente a falha (o MTTF já é 0 — ela aconteceu). O que você controla é o MTTR: detecção mais rápida (alertas), diagnóstico mais rápido (runbooks, rastreamento distribuído) e mitigação mais rápida (feature flags, procedimentos de rollback). No longo prazo, o MTTF melhora com testes melhores e um projeto tolerante a falhas.

---

## Padrões de Resiliência

**Q7.** Para qual estado um circuit breaker vai depois que o seu **tempo de espera** expira enquanto ele está no estado Open?

- A. Closed — ele assume automaticamente que o serviço se recuperou
- B. Failed — ele exige intervenção manual para ser reiniciado
- C. Half-Open — ele libera um número limitado de requisições de teste para verificar se o serviço se recuperou
- D. Degraded — ele deixa passar o tráfego a 50% da taxa normal

??? success "Resposta"
    **C — Half-Open.**

    O estado Open bloqueia todas as requisições. Após um tempo de espera configurado (por exemplo, 30 segundos), o breaker passa para Half-Open e libera um pequeno número de requisições de teste. Se elas tiverem sucesso, o serviço se recuperou e o breaker fecha. Se falharem, o serviço continua fora do ar e o breaker volta para Open.

---

**Q8.** Por que você **nunca deve fazer retry** de um `POST /orders` não idempotente sem proteções adicionais?

- A. `POST` não admite retry no nível do protocolo HTTP
- B. O servidor vai retornar 405 Method Not Allowed na segunda tentativa
- C. Cada retry pode criar um pedido duplicado — retries só são seguros para operações idempotentes ou protegidas por chaves de idempotência
- D. Os circuit breakers bloqueiam automaticamente todos os retries de requisições `POST`

??? success "Resposta"
    **C — Cada retry pode criar um pedido duplicado.**

    `POST /orders` cria um novo recurso a cada chamada. Se a requisição tiver sucesso no servidor, mas a resposta se perder (partição de rede), um retry vai criar um segundo pedido. Retries seguros para operações não idempotentes exigem uma *chave de idempotência* — um ID único gerado pelo cliente, que o servidor usa para detectar e deduplicar requisições repetidas.

---

**Q9.** Que problema a adição de **jitter** ao backoff exponencial resolve?

- A. Ela impede que o atraso do backoff cresça indefinidamente
- B. Ela garante que todos os clientes usem o mesmo intervalo de retry, para ter previsibilidade
- C. Ela quebra a thundering herd — sem jitter, todos os clientes que falharam ao mesmo tempo fazem retry nos mesmos instantes, gerando picos de carga no serviço que está se recuperando
- D. Ela sorteia qual servidor de backend vai tratar a requisição do retry

??? success "Resposta"
    **C — Quebra a thundering herd.**

    Imagine 1.000 clientes falhando todos em t=0 e fazendo retry em t=1s, t=2s, t=4s em perfeita sincronia. Cada onda de retries atinge o serviço em recuperação com um pico enorme, podendo fazê-lo falhar de novo. Adicionar um jitter aleatório espalha os retries por uma janela de tempo, transformando um pico em um fluxo constante e administrável.

---

**Q10.** Quais padrões se combinam para formar uma cadeia de chamadas com **defesa em profundidade**? Escolha a resposta mais completa.

- A. Apenas circuit breaker + timeout — os outros adicionam complexidade desnecessária
- B. Rate limiter → circuit breaker → bulkhead → timeout → retry com backoff
- C. Load balancer → health check → circuit breaker
- D. Retry com backoff → bulkhead → rate limiter → timeout

??? success "Resposta"
    **B — Rate limiter → circuit breaker → bulkhead → timeout → retry com backoff.**

    Cada camada trata um cenário de falha distinto: o rate limiter protege contra picos de tráfego e abusos; o circuit breaker faz falhar rapidamente as chamadas a dependências que se sabe estarem falhando; o bulkhead isola os pools de threads para que uma dependência lenta não deixe as outras sem recursos; o timeout limita o tempo de espera; o retry trata as falhas transitórias. A ordem importa — o rate limiting e a falha rápida acontecem antes de consumir uma thread do bulkhead.

---

## Engenharia do Caos

**Q11 (bônus).** O primeiro Princípio da Engenharia do Caos exige estabelecer um **estado estável** antes de injetar falhas. A que se refere o "estado estável"?

- A. Um congelamento de deploys, em que nenhuma mudança de código é feita durante o experimento
- B. Uma linha de base mensurável do comportamento normal do sistema, expressa em SLIs — taxa de requisições, taxa de erros, latência —, contra a qual o impacto do experimento é avaliado
- C. Um estado em que todos os serviços estão rodando a exatamente 50% da capacidade
- D. A configuração do sistema no último deploy reconhecidamente bom

??? success "Resposta"
    **B — Linha de base mensurável de SLIs.**

    Você não consegue determinar se a injeção de uma falha causou degradação a menos que saiba como é o "normal". A hipótese de estado estável é: *"Mesmo com a condição X injetada, o sistema continuará exibindo [valores específicos de SLI]."* Refutar a hipótese é uma descoberta — o sistema não trata aquela condição conforme projetado.
