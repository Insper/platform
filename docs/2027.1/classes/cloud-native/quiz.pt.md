Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Cloud-native e modelos de serviço

**Q1.** Uma versão antiga do `inventory` do BoxOffice guardava as reservas de assentos em um mapa dentro da JVM. Qual propriedade twelve-factor ela violava, e qual era o sintoma visível com três réplicas?

- A. Config — a URL do banco estava fixa no código, então as réplicas usavam bancos diferentes
- B. Processos (sem estado) — uma reserva feita em uma réplica era invisível para as outras e se perdia quando aquele pod era substituído
- C. Logs — as reservas eram gravadas em um arquivo local que enchia o disco
- D. Paridade dev/prod — o mapa se comportava de forma diferente em produção

??? success "Resposta"
    **B — Processos precisam ser sem estado.**

    Estado guardado na memória do processo prende o usuário a uma instância. Atrás de um load balancer, a próxima requisição pode ir para outra réplica, e qualquer reinício, rolling update ou redução de escala destrói o estado. Levar as reservas para o PostgreSQL (com expiração) ou para o Redis (com TTL) torna todas as réplicas equivalentes e descartáveis.

---

**Q2.** Para qual componente do BoxOffice o **SaaS** é o modelo de serviço mais defensável?

- A. O serviço `inventory`
- B. O banco de dados do inventário de assentos
- C. O processamento de pagamentos com cartão
- D. Os nós de trabalho do Kubernetes

??? success "Resposta"
    **C — Pagamentos com cartão.**

    Lidar com dados de cartão traz pesadas obrigações de conformidade (PCI DSS), detecção de fraude e integrações bancárias que não são o negócio central do BoxOffice. Um provedor de pagamento oferece tudo isso como produto, por uma API. O serviço de inventário e seu banco são o núcleo do negócio e ficam sob controle do time (CaaS e DBaaS).

---

**Q3.** Qual responsabilidade fica com o cliente em **todos** os modelos de serviço, inclusive SaaS?

- A. Aplicar patches no sistema operacional
- B. Decidir quem pode acessar os dados, e a configuração do serviço
- C. Substituir discos com defeito
- D. Escalar o runtime

??? success "Resposta"
    **B — Acesso aos dados e configuração.**

    O provedor pode operar tudo, do hardware à aplicação, mas não pode decidir quem na sua organização deve ler quais dados, nem se um bucket deve ser público. A maioria dos vazamentos de dados na nuvem são erros de configuração do lado do cliente.

---

## Containers

**Q4.** Dois containers rodam no mesmo host. O que eles compartilham que duas máquinas virtuais no mesmo host **não** compartilhariam?

- A. A CPU
- B. A memória física
- C. O kernel do sistema operacional
- D. A placa de rede

??? success "Resposta"
    **C — O kernel.**

    Containers são processos isolados (namespaces) com limites de recursos (cgroups) sobre um único kernel compartilhado. VMs inicializam cada uma o próprio kernel sobre um hipervisor. É por isso que containers iniciam em milissegundos e são mais densos, e também por que sua fronteira de isolamento é mais fraca — plataformas multi-inquilino os envolvem em micro-VMs como Firecracker ou gVisor.

---

**Q5.** No Dockerfile do `catalog`, `COPY pom.xml` e `mvn dependency:go-offline` vêm **antes** de `COPY src`. Por quê?

- A. O Maven exige que o POM fique em uma camada separada
- B. Para que uma mudança de código invalide só as camadas posteriores, e o download das dependências seja reaproveitado do cache de build
- C. Para deixar a imagem final menor
- D. Porque imagens distroless não suportam `COPY src`

??? success "Resposta"
    **B — Cache de camadas.**

    Cada instrução produz uma camada, e uma camada só é reconstruída se suas entradas (ou uma camada anterior) mudaram. Dependências mudam raramente; o código muda a cada commit. Ordenar do que muda menos para o que muda mais mantém os passos caros em cache. (O tamanho da imagem é reduzido pelo build *multi-stage*, não por essa ordem.)

---

**Q6.** Um time usa `ENTRYPOINT java -jar app.jar` (forma shell). A cada rolling update algumas requisições falham. Qual a causa mais provável?

- A. A JVM inicia devagar demais
- B. O `/bin/sh` é o PID 1, não repassa o `SIGTERM` ao Java, e o container é morto com `SIGKILL` após o período de tolerância, derrubando as requisições em andamento
- C. A imagem é grande demais para ser baixada a tempo
- D. A readiness probe é rígida demais

??? success "Resposta"
    **B — Os sinais não chegam à JVM.**

    Na forma shell, o shell vira PID 1 e o Java um processo filho que nunca vê o `SIGTERM`, então o encerramento gracioso do Spring Boot nunca roda. A forma exec (`ENTRYPOINT ["java", …]`) torna o Java o PID 1. Combine-a com `server.shutdown: graceful` e um pequeno `sleep` no `preStop`, para que os endpoints sejam atualizados antes de o encerramento começar.

---

## Kubernetes

**Q7.** Um nó que executa dois pods de `catalog` perde energia. Qual mecanismo traz o Deployment de volta às 4 réplicas desejadas?

- A. O kubelet do nó com defeito reinicia os pods quando a energia volta
- B. Controladores comparam o estado desejado e o real; o controlador do ReplicaSet cria novos pods e o scheduler os coloca em nós saudáveis
- C. O HPA detecta a queda de CPU e escala
- D. O Argo CD reaplica os manifests a partir do Git

??? success "Resposta"
    **B — Reconciliação por controladores.**

    O Kubernetes é um conjunto de laços de controle. O controlador de nós marca o nó como não pronto, seus pods acabam sendo despejados, o ReplicaSet vê 2 reais vs 4 desejados, cria dois pods, e o scheduler os associa a nós com capacidade livre. Não é preciso nenhuma pessoa nem sincronização com o Git.

---

**Q8.** A readiness probe do `inventory` verifica se o PostgreSQL está acessível. O PostgreSQL faz failover e fica inacessível por 20 segundos. O que acontece?

- A. Só os pods conectados ao primário antigo são removidos do Service
- B. Todos os pods de `inventory` ficam não prontos ao mesmo tempo, o Service fica sem endpoints e todas as requisições falham — inclusive as que um cache ou um erro gracioso poderiam ter atendido
- C. Os pods são reiniciados, o que acelera a recuperação
- D. Nada, porque readiness probes são ignoradas durante failovers

??? success "Resposta"
    **B — Uma dependência compartilhada deixa todos os pods não prontos juntos.**

    A readiness deve responder "*este pod* consegue atender tráfego?". Uma dependência compartilhada por todos os pods transforma uma piscada de 20 segundos do banco em indisponibilidade total do serviço, sem chance de respostas degradadas. Mantenha a readiness local (aplicação iniciada, aquecida, não sobrecarregada) e trate falhas de dependências no código (timeouts, circuit breakers, fallbacks). Colocar o banco na **liveness** seria pior: reiniciaria todos os pods.

---

**Q9.** O HPA tem como meta 60 % de utilização média de CPU. O `catalog` tem 5 pods a 96 %. Quantas réplicas o HPA vai pedir (ignorando min/max e estabilização)?

- A. 6
- B. 8
- C. 10
- D. 96

??? success "Resposta"
    **B — 8.**

    desejado = ⌈atual × métrica atual / meta⌉ = ⌈5 × 96 / 60⌉ = ⌈8,0⌉ = **8**. Note que a porcentagem é relativa ao **request** de CPU dos pods: sem requests, o autoscaling por utilização de CPU não funciona.

---

**Q10.** Um serviço Java sensível à latência tem um **limit** de CPU de 1 núcleo. O uso médio de CPU é de 45 %, mas a latência p99 é alta e instável. O que você deve olhar primeiro?

- A. O limite de memória, porque Java usa muita memória
- B. O throttling de CPU: muitas threads podem consumir a cota CFS de 100 ms no começo de cada período e depois esperar, adicionando latência mesmo com média baixa
- C. O número de réplicas no PodDisruptionBudget
- D. O tamanho da imagem

??? success "Resposta"
    **B — Throttling do CFS.**

    Um limite de CPU é aplicado por período de escalonamento (100 ms por padrão). Trabalho multithread em rajadas (tratamento de requisições mais GC) pode esgotar a cota cedo e parar pelo resto do período. A média parece normal; a cauda, não. Verifique `container_cpu_cfs_throttled_periods_total`; considere aumentar ou remover o limite de CPU mantendo o request.

---

## Entrega e FinOps

**Q11.** Qual propriedade distingue o **GitOps por pull** (Argo CD) de um job de CI que executa `kubectl apply`?

- A. GitOps só funciona com Helm
- B. Um agente dentro do cluster reconcilia continuamente o cluster com o estado no Git; a CI nunca guarda credenciais do cluster, e a deriva manual é detectada ou revertida
- C. GitOps faz deploy mais rápido porque pula os testes
- D. Com GitOps não é possível fazer rollback

??? success "Resposta"
    **B — Reconciliação contínua por pull.**

    O cluster puxa seu estado desejado do Git, então a trilha de auditoria é o `git log`, o rollback é um `git revert`, a deriva fica visível, e o sistema de CI — alvo frequente de ataques — não tem permissão para mudar a produção.

---

**Q12.** Um canary de `order` recebe 5 % de 400 req/s. A taxa de erros de base é 0,1 %. Por que uma etapa de canary de 30 segundos não basta para promover com segurança?

- A. Porque o Argo Rollouts exige pelo menos 10 minutos por etapa
- B. Porque 30 s a 20 req/s são só ~600 requisições — poucas demais para distinguir uma pequena regressão na taxa de erros (ex.: 0,1 % → 0,2 %) de ruído
- C. Porque a JVM precisa de 30 s para iniciar
- D. Porque canaries sempre devem receber 50 % do tráfego

??? success "Resposta"
    **B — Amostras insuficientes.**

    A 0,1 % você espera menos de um erro em 600 requisições em qualquer das versões; detectar a duplicação de um evento raro exige muitos milhares de requisições (≈ 18 000 para 80 % de poder na estimativa da página — cerca de 15 minutos a 5 %). Regressões grandes aparecem rápido; as pequenas precisam de tempo, mais peso ou pausas mais longas.

---

**Q13.** Uma mudança de esquema renomeia `orders.total` para `orders.amount_cents`. Por que ela **não** deve ir na mesma release do código que usa o novo nome?

- A. O Flyway não consegue renomear colunas
- B. Durante um rolling update ou canary, versões antiga e nova rodam lado a lado; a versão antiga quebraria no momento em que a coluna fosse renomeada. Use expand/contract: adicione a nova coluna, escreva nas duas, faça o backfill, troque as leituras, remova a coluna antiga depois
- C. Renomear colunas trava a tabela por horas no PostgreSQL
- D. Porque a análise do canary não consegue ler o banco

??? success "Resposta"
    **B — Duas versões coexistem; o banco não faz rollback.**

    Qualquer estratégia progressiva (rolling, canary, blue/green com banco compartilhado) exige que mudanças de esquema sejam compatíveis tanto com o código antigo quanto com o novo. Expand/contract distribui uma mudança incompatível por várias releases compatíveis.

---

**Q14.** No modelo de custo do BoxOffice, quatro vendas de 2 horas precisam de 24 nós extras. Por que elas acrescentam tão pouco à fatura mensal, e qual é a lição?

- A. Porque nós de pico são gratuitos na AWS
- B. Porque 24 nós × 8 horas é uma fração minúscula de 24 nós × 730 horas; capacidade elástica custa em proporção ao tempo em que existe, então autoscaling e pré-escala para picos conhecidos vencem o provisionamento permanente para o pico
- C. Porque as vendas rodam em instâncias spot
- D. Porque o banco aguenta o pico sozinho

??? success "Resposta"
    **B — Você paga por capacidade × tempo.**

    24 × US$ 0,192 × 8 h ≈ US$ 37, contra ≈ US$ 3.364 por mês para manter os mesmos nós sempre ligados. O argumento econômico da elasticidade é exatamente essa razão pico/média. O mesmo modelo mostra que serviços de dados, saída da CDN e ingestão de logs — não a computação de pico — dominam a conta.

---

**Q15.** Abaixo de qual nível de tráfego médio uma função paga por requisição costuma ser mais barata que duas tarefas de container sempre ligadas atrás de um load balancer, no modelo da página?

- A. Cerca de 10 requisições por segundo em média
- B. Cerca de 1 000 requisições por segundo
- C. Funções são sempre mais baratas
- D. Containers são sempre mais baratos

??? success "Resposta"
    **A — Cerca de dez requisições por segundo em média (com as premissas da página).**

    Containers têm um piso mensal fixo (tarefas + load balancer) e um custo marginal baixo; funções não têm piso e têm custo maior por requisição. O ponto de cruzamento depende da duração da requisição, da memória e do preço por requisição da porta de entrada, então recalcule para a sua carga — mas a forma do trade-off é geral: tráfego baixo ou com rajadas muito fortes favorece o preço por requisição; carga constante favorece capacidade sempre ligada.
