
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** No modelo de responsabilidade compartilhada, o que o **cliente** gerencia no IaaS e que o **provedor** gerencia no PaaS?

- A. Hardware físico, energia e refrigeração
- B. Hypervisor e sistema operacional do host
- C. O SO convidado, o ambiente de runtime e o middleware — no IaaS o cliente os instala e atualiza; no PaaS o provedor cuida deles
- D. Contas de usuário e os dados inseridos na aplicação

??? success "Resposta"
    **C — SO convidado, runtime e middleware.**

    O IaaS entrega a você uma máquina virtual com um SO recém-instalado. Você instala o Java, configura o nginx, aplica os patches do SO e gerencia tudo acima do hypervisor. O PaaS abstrai tudo isso — você envia o código, e a plataforma instala e gerencia o runtime.

---

**Q2.** Um time quer fazer o deploy de imagens Docker na nuvem **sem gerenciar o Kubernetes por conta própria**. Qual modelo de serviço se encaixa melhor?

- A. IaaS — eles precisam de uma VM para rodar o daemon do Docker
- B. PaaS — as plataformas detectam imagens Docker automaticamente via buildpacks
- C. CaaS (Container como Serviço) — por exemplo, AWS ECS Fargate ou Google Cloud Run
- D. SaaS — o provedor de nuvem gerencia a aplicação inteira

??? success "Resposta"
    **C — CaaS.**

    O CaaS fica entre o IaaS e o PaaS. O cliente fornece uma imagem Docker; a plataforma cuida do agendamento, da rede, da escalabilidade e da saúde dos nós. AWS Fargate e Google Cloud Run são exemplos clássicos — nenhum cluster para gerenciar, mas controle total sobre o que roda dentro do container.

---

**Q3.** Qual característica **melhor define o FaaS** em comparação com os outros modelos de serviço em nuvem?

- A. O provedor gerencia o SO e o runtime
- B. As aplicações são implantadas como containers Docker
- C. A multi-tenancy isola os dados dos clientes por tenant ID
- D. A unidade de deploy é uma única função, que escala até zero quando ociosa e é cobrada por invocação mais duração da execução

??? success "Resposta"
    **D — Uma função como unidade de deploy, escala até zero, cobrança por invocação + duração.**

    O PaaS também gerencia o SO e o runtime (A), o CaaS faz o deploy de containers (B), e a multi-tenancy é a marca registrada do SaaS (C). Escalar até zero já não é *exclusividade* do FaaS — plataformas de containers serverless, como Google Cloud Run e Azure Container Apps, também escalam até zero —, mas a combinação "fazer o deploy de uma função e pagar por invocação e por milissegundo" é o que define o FaaS. Um PaaS clássico mantém pelo menos uma instância rodando e cobra por ela mesmo quando ociosa. O trade-off é a latência de cold start e um tempo máximo de execução (15 min no AWS Lambda).

---

**Q4.** Quais dos seguintes são exemplos de **SaaS**? Selecione o grupo mais preciso.

- A. AWS EC2, Google Compute Engine, Azure VMs
- B. Heroku, AWS Elastic Beanstalk, Google App Engine
- C. GitHub, Slack, Datadog, Salesforce
- D. AWS ECS Fargate, Google Cloud Run, Azure Container Instances

??? success "Resposta"
    **C — GitHub, Slack, Datadog, Salesforce.**

    O SaaS fornece software totalmente gerenciado — o cliente gerencia apenas usuários, permissões e dados. GitHub (controle de versão), Slack (mensagens), Datadog (monitoramento) e Salesforce (CRM) são todos SaaS. As outras opções são IaaS (A), PaaS (B) e CaaS (D).

---

**Q5.** Uma startup quer lançar rapidamente um backend de API REST, **sem experiência em infraestrutura** no time. Qual modelo minimiza o tempo de lançamento mantendo controle total da aplicação?

- A. IaaS — controle total sobre a pilha inteira
- B. PaaS — o provedor gerencia do hardware até o runtime; o time faz o deploy do código e gerencia apenas a aplicação e os dados
- C. SaaS — a opção mais rápida, sem nenhuma configuração
- D. On-premises — evitar totalmente os custos de nuvem

??? success "Resposta"
    **B — PaaS.**

    O PaaS é o ponto ideal para times que querem entregar rápido sem se tornar engenheiros de infraestrutura. Envie o código, configure as variáveis de ambiente, escale com um controle deslizante. O time mantém controle total sobre a aplicação e os dados, mas nunca mexe em patches do SO, atualizações de runtime ou configuração do balanceador de carga.

---

**Q6.** Em que o **DBaaS** (Banco de Dados como Serviço) difere de bancos de dados autogerenciados em IaaS?

- A. O DBaaS só suporta NoSQL; o IaaS suporta qualquer engine de banco de dados
- B. Bancos DBaaS não podem ser consultados com clientes SQL padrão
- C. O provedor gerencia replicação, backups, failover e patches do SO; o cliente gerencia apenas a modelagem do schema, a otimização de consultas e o controle de acesso
- D. Bancos DBaaS são sempre compartilhados entre tenants, sem isolamento

??? success "Resposta"
    **C — O provedor gerencia replicação, backups, failover e SO; o cliente gerencia schema e acesso.**

    Rodar PostgreSQL no EC2 significa que você o instala, configura a replicação por streaming, agenda backups, aplica patches no SO e responde a falhas de hardware. Com AWS RDS ou Cloud SQL, tudo isso é automatizado — você se conecta com um cliente padrão e se concentra nas consultas e na modelagem do schema.

---

**Q7.** Qual afirmação melhor descreve o **trade-off** entre IaaS e SaaS em termos de controle vs tempo até gerar valor?

- A. O IaaS dá o máximo de controle, mas exige mais tempo para provisionar e gerenciar; o SaaS é imediato, mas o cliente controla apenas usuários e dados
- B. IaaS e SaaS têm sobrecarga operacional parecida — a única diferença é o preço
- C. O SaaS dá mais controle do que o IaaS porque o provedor tem especialistas gerenciando o sistema
- D. O IaaS é sempre mais econômico do que o SaaS para qualquer workload

??? success "Resposta"
    **A — IaaS = máximo controle, máxima sobrecarga; SaaS = imediato, controle mínimo.**

    Esse é o trade-off fundamental da responsabilidade compartilhada. Passar de IaaS para PaaS e depois para SaaS transfere progressivamente a carga operacional para o provedor, ao custo de controle e portabilidade. O modelo certo depende de construir e operar aquilo ser ou não uma competência central do time.

---

**Q8.** No **framework de decisão**, quando o **FaaS** é a escolha errada?

- A. Quando o workload é orientado a eventos
- B. Quando a função roda por menos de 15 minutos
- C. Quando a aplicação exige latência baixa e consistente em toda requisição e roda com tráfego alto e constante
- D. Quando o time quer evitar gerenciar servidores

??? success "Resposta"
    **C — Latência baixa e consistente com tráfego alto e constante.**

    O FaaS sofre com *cold starts* — a plataforma precisa inicializar uma nova instância da função quando não há nenhuma instância aquecida disponível. Para workloads esporádicos ou em rajadas (webhooks, jobs agendados), isso é aceitável. Para uma API de alto tráfego que exige latência P99 abaixo de 100 ms, um deploy em PaaS ou CaaS sempre aquecido é mais adequado. A *provisioned concurrency* do Lambda pode manter instâncias aquecidas, mas aí você paga por capacidade ociosa e perde a principal vantagem de custo do FaaS.

---

**Q9.** Uma empresa roda um pipeline próprio de treinamento de machine learning que precisa de **instâncias com GPU** e de uma **versão específica do kernel Linux**. Qual modelo de nuvem se encaixa melhor?

- A. SaaS — assinar um produto de ML pronto
- B. PaaS — o provedor vai configurar a GPU e o kernel automaticamente
- C. FaaS — funções aceleradas por GPU são ideais para workloads de ML
- D. IaaS — fornece VMs com GPU e controle total do SO, incluindo a escolha do kernel

??? success "Resposta"
    **D — IaaS.**

    Quando o workload exige um kernel específico, drivers customizados ou controle de hardware especializado, só o IaaS dá o nível de acesso necessário. O PaaS abstrai o SO; o SaaS não deixa você trazer kernels customizados; o FaaS não expõe hardware de GPU (na maioria das implementações). Plataformas de ML gerenciadas, como o AWS SageMaker, podem fornecer GPUs, mas escolhem o SO e o kernel por você.

---

**Q10.** Qual modelo melhor descreve o **Google Kubernetes Engine (GKE)** ou o **Amazon EKS**?

- A. IaaS — VMs brutas são fornecidas e o cliente gerencia tudo
- B. PaaS — o cliente só faz o deploy do código, sem precisar de containers
- C. CaaS com Kubernetes — o provedor gerencia o control plane; o cliente gerencia os worker nodes e os workloads
- D. SaaS — o Kubernetes é totalmente gerenciado, sem nenhuma responsabilidade do cliente

??? success "Resposta"
    **C — CaaS com control plane do Kubernetes gerenciado.**

    GKE e EKS gerenciam o control plane do Kubernetes (API server, scheduler, etcd). No modo clássico, o cliente provisiona e gerencia os worker nodes (ou usa managed node groups); modos como o GKE Autopilot e o EKS Auto Mode também passam o gerenciamento dos nós para o provedor. Em todos os modos, o cliente é responsável por fazer o deploy e configurar os workloads, as network policies, o controle de acesso e por disparar as atualizações de versão do cluster. Isso é CaaS — um degrau acima do IaaS, um degrau abaixo de um PaaS completo.

---

**Q11.** Qual das alternativas a seguir **não** é uma das cinco características essenciais da computação em nuvem na definição do NIST (SP 800-145)?

- A. Autoatendimento sob demanda
- B. Elasticidade rápida
- C. Serviço medido
- D. Um SLA garantido de 99,99% de disponibilidade

??? success "Resposta"
    **D — Um SLA de disponibilidade não faz parte da definição.**

    O NIST define computação em nuvem por cinco características: autoatendimento sob demanda, amplo acesso pela rede, agrupamento de recursos, elasticidade rápida e serviço medido. SLAs são termos contratuais que cada provedor oferece por serviço (e variam muito); um serviço pode ser "nuvem" sem um SLA de 99,99%. Por outro lado, um servidor alugado com contrato de três anos e um SLA forte não é nuvem se você não consegue provisioná-lo por conta própria e pagar pelo uso.

---

**Q12.** Uma empresa substitui os servidores do seu próprio datacenter (comprados a cada 5 anos) por instâncias EC2 cobradas por segundo. Como isso muda o **modelo de custo**?

- A. De OpEx para CapEx: a empresa agora é dona das instâncias
- B. De CapEx para OpEx: sem compra antecipada dimensionada para o pico esperado; a empresa paga mensalmente pelo que usa
- C. Nada muda: ambos são despesa de capital
- D. De CapEx para OpEx, o que garante um custo total menor para qualquer workload

??? success "Resposta"
    **B — De CapEx para OpEx.**

    Comprar servidores é despesa de capital: um pagamento alto e antecipado por um ativo dimensionado para o pico que você *espera*. Recursos de nuvem são despesa operacional: você paga pelo que usa e pode parar de pagar quando para de usar. A alternativa D é a pegadinha — o OpEx elimina a aposta inicial, mas não é automaticamente mais barato; um workload rodando em carga máxima 24/7 por anos pode custar mais na nuvem do que em hardware próprio.

---

**Q13.** Um time roda o serviço order da loja no EKS e guarda as notas fiscais num bucket S3. Alguém torna o bucket **público**, e as notas fiscais vazam. Pelo modelo de responsabilidade compartilhada, de quem era essa responsabilidade?

- A. Da AWS — o S3 é um serviço gerenciado, então sua segurança é tarefa do provedor
- B. Da AWS — o provedor deveria bloquear automaticamente todo bucket público
- C. Do cliente — a configuração de acesso aos dados é "segurança *na* nuvem", que sempre fica com o cliente
- D. De ninguém — buckets públicos são uma limitação conhecida do armazenamento de objetos

??? success "Resposta"
    **C — Do cliente.**

    A AWS é responsável pela segurança *da* nuvem: os datacenters, o hardware, o hypervisor e o próprio serviço S3. O cliente é responsável pela segurança *na* nuvem: quem pode ler os dados, políticas de IAM, bucket policies, configurações de criptografia. Serviços gerenciados transferem camadas operacionais para o provedor, mas decidir quem pode acessar seus dados nunca muda de lado.

---

**Q14.** O Postgres da loja roda hoje numa VM EC2 que o time instalou manualmente. Eles o migram para o **Amazon RDS**. Qual afirmação descreve o que mudou?

- A. Nada muda operacionalmente — o RDS é só Postgres numa VM com outro nome
- B. O time agora gerencia o SO, mas não mais o schema
- C. Backups, replicação, failover e patches do SO/banco de dados viram configuração gerenciada pelo provedor; o time continua dono do schema, das consultas, das regras de acesso e dos dados
- D. O time não consegue mais se conectar com um cliente Postgres padrão ou com o driver JDBC

??? success "Resposta"
    **C — O banco de dados saiu do IaaS para o DBaaS.**

    No EC2, o time instala o Postgres, aplica patches no SO, escreve scripts de backup e cuida do failover. Com o RDS, isso tudo vira configurações (retenção de backup, Multi-AZ, janela de manutenção) que a AWS executa. A aplicação continua se conectando com o mesmo formato de URL JDBC e o mesmo driver, e o time continua dono da modelagem do schema, da otimização de consultas e de quem pode se conectar (security groups, usuários do banco de dados).
