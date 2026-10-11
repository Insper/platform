
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** No modelo de responsabilidade compartilhada, o que o **cliente** gerencia no IaaS e que o **provedor** gerencia no PaaS?

- A. O hardware físico, a energia e a refrigeração
- B. O hypervisor e o sistema operacional do host
- C. O SO convidado, o ambiente de runtime e o middleware — no IaaS o cliente os instala e atualiza; no PaaS o provedor cuida deles
- D. As contas de usuário e os dados inseridos na aplicação

??? success "Resposta"
    **C — SO convidado, runtime e middleware.**

    O IaaS entrega a você uma máquina virtual com um SO recém-instalado. Você instala o Java, configura o nginx, aplica as atualizações do SO e gerencia tudo o que fica acima do hypervisor. O PaaS abstrai tudo isso — você envia o código e a plataforma instala e gerencia o runtime.

---

**Q2.** Uma equipe quer implantar imagens Docker na nuvem **sem gerenciar o Kubernetes por conta própria**. Qual modelo de serviço se encaixa melhor?

- A. IaaS — eles precisam de uma VM para rodar o daemon do Docker
- B. PaaS — as plataformas detectam imagens Docker automaticamente por meio de buildpacks
- C. CaaS (Container como Serviço) — por exemplo, AWS ECS Fargate ou Google Cloud Run
- D. SaaS — o provedor de nuvem gerencia a aplicação inteira

??? success "Resposta"
    **C — CaaS.**

    O CaaS fica entre o IaaS e o PaaS. O cliente fornece uma imagem Docker; a plataforma cuida do escalonamento, da rede, da escalabilidade e da saúde dos nós. O AWS Fargate e o Google Cloud Run são exemplos canônicos — nenhum cluster para gerenciar, mas controle total sobre o que roda dentro do container.

---

**Q3.** Qual característica é **exclusiva do FaaS** em comparação com todos os outros modelos de serviço em nuvem?

- A. O provedor gerencia o SO e o runtime
- B. As aplicações são implantadas como containers Docker
- C. O multi-tenancy isola os dados dos clientes por ID do tenant
- D. A plataforma escala até zero quando ociosa e cobra por invocação mais a duração da execução em milissegundos

??? success "Resposta"
    **D — Escala até zero; cobrança por invocação + milissegundos.**

    Nenhum outro modelo escala até zero automaticamente. O PaaS roda continuamente (mesmo ocioso, você paga pela instância mínima). O FaaS só gera custo quando a função realmente executa. O trade-off é a latência de cold start e um tempo máximo de execução (por exemplo, 15 min no AWS Lambda).

---

**Q4.** Quais dos itens a seguir são exemplos de **SaaS**? Escolha o grupo mais preciso.

- A. AWS EC2, Google Compute Engine, Azure VMs
- B. Heroku, AWS Elastic Beanstalk, Google App Engine
- C. GitHub, Slack, Datadog, Salesforce
- D. AWS ECS Fargate, Google Cloud Run, Azure Container Instances

??? success "Resposta"
    **C — GitHub, Slack, Datadog, Salesforce.**

    O SaaS fornece software totalmente gerenciado — o cliente gerencia apenas usuários, permissões e dados. GitHub (controle de versão), Slack (mensagens), Datadog (monitoramento) e Salesforce (CRM) são todos SaaS. As outras opções são IaaS (A), PaaS (B) e CaaS (D).

---

**Q5.** Uma startup quer lançar rapidamente um backend de API REST, **sem expertise em infraestrutura** na equipe. Qual modelo minimiza o time to market mantendo o controle total da aplicação?

- A. IaaS — controle total sobre a pilha inteira
- B. PaaS — o provedor gerencia do hardware até o runtime; a equipe implanta o código e gerencia apenas a aplicação e os dados
- C. SaaS — a opção mais rápida, sem nenhuma configuração
- D. On-premises — evitar totalmente os custos de nuvem

??? success "Resposta"
    **B — PaaS.**

    O PaaS é o ponto ideal para equipes que querem entregar rápido sem se tornar engenheiros de infraestrutura. Envie o código, configure as variáveis de ambiente, escale com um controle deslizante. A equipe mantém o controle total sobre a aplicação e os dados, mas nunca mexe em atualizações do SO, upgrades do runtime ou configuração do balanceador de carga.

---

**Q6.** Em que o **DBaaS** (Banco de Dados como Serviço) difere de bancos de dados autogerenciados em IaaS?

- A. O DBaaS só suporta NoSQL; o IaaS suporta qualquer engine de banco de dados
- B. Bancos DBaaS não podem ser consultados com clientes SQL padrão
- C. O provedor gerencia replicação, backups, failover e atualizações do SO; o cliente gerencia apenas o projeto do schema, o ajuste de consultas e o controle de acesso
- D. Bancos DBaaS são sempre compartilhados entre tenants, sem isolamento

??? success "Resposta"
    **C — O provedor gerencia replicação, backups, failover e SO; o cliente gerencia o schema e o acesso.**

    Rodar o PostgreSQL no EC2 significa que você o instala, configura a replicação por streaming, agenda os backups, atualiza o SO e responde a falhas de hardware. Com o AWS RDS ou o Cloud SQL, tudo isso é automatizado — você se conecta com um cliente padrão e foca nas consultas e no projeto do schema.

---

**Q7.** Qual afirmação descreve melhor o **trade-off** entre IaaS e SaaS em termos de controle vs tempo até gerar valor?

- A. O IaaS dá controle máximo, mas exige mais tempo para provisionar e gerenciar; o SaaS é imediato, mas o cliente controla apenas usuários e dados
- B. IaaS e SaaS têm um custo operacional parecido — a única diferença é o preço
- C. O SaaS dá mais controle do que o IaaS porque o provedor tem especialistas gerenciando o sistema
- D. O IaaS é sempre mais econômico do que o SaaS para qualquer workload

??? success "Resposta"
    **A — IaaS = controle máximo, esforço operacional máximo; SaaS = imediato, controle mínimo.**

    Esse é o trade-off fundamental da responsabilidade compartilhada. Passar de IaaS para PaaS e depois para SaaS transfere progressivamente a carga operacional para o provedor, ao custo de controle e portabilidade. O modelo certo depende de construir e operar aquilo ser ou não uma competência central da equipe.

---

**Q8.** No **guia de decisão**, quando o **FaaS** é a escolha errada?

- A. Quando o workload é orientado a eventos
- B. Quando a função roda por menos de 15 minutos
- C. Quando a aplicação exige latência baixa de forma consistente em todas as requisições e roda com tráfego alto e sustentado
- D. Quando a equipe quer evitar gerenciar servidores

??? success "Resposta"
    **C — Latência baixa e consistente com tráfego alto e sustentado.**

    O FaaS sofre com *cold starts* — a plataforma precisa inicializar uma nova instância da função quando não há nenhuma instância "quente" disponível. Para workloads esporádicos ou em rajadas (webhooks, jobs agendados), isso é aceitável. Para uma API de alto tráfego que exige latência P99 abaixo de 100 ms, um deploy em PaaS ou CaaS sempre aquecido é mais adequado.

---

**Q9.** Uma empresa roda um pipeline próprio de treinamento de machine learning que precisa de **instâncias com GPU** e de uma **versão específica do kernel Linux**. Qual modelo de nuvem se encaixa melhor?

- A. SaaS — usar uma plataforma de ML existente, como o AWS SageMaker
- B. PaaS — o provedor vai configurar a GPU e o kernel automaticamente
- C. FaaS — funções aceleradas por GPU são ideais para workloads de ML
- D. IaaS — fornece VMs com GPU brutas e controle total do SO, incluindo a escolha do kernel

??? success "Resposta"
    **D — IaaS.**

    Quando o workload exige um kernel de SO específico, drivers customizados ou controle de hardware especializado, só o IaaS dá o nível de acesso necessário. O PaaS abstrai o SO; o SaaS não permite trazer kernels customizados; o FaaS não expõe hardware de GPU de forma alguma (na maioria das implementações).

---

**Q10.** Qual modelo descreve melhor o **Google Kubernetes Engine (GKE)** ou o **Amazon EKS**?

- A. IaaS — VMs brutas são fornecidas e o cliente gerencia tudo
- B. PaaS — o cliente apenas implanta o código, sem precisar de containers
- C. CaaS com Kubernetes — o provedor gerencia o control plane; o cliente gerencia os nós de trabalho (worker nodes) e os workloads
- D. SaaS — o Kubernetes é totalmente gerenciado, sem nenhuma responsabilidade do cliente

??? success "Resposta"
    **C — CaaS com control plane do Kubernetes gerenciado.**

    O GKE e o EKS gerenciam o control plane do Kubernetes (API server, scheduler, etcd), mas o cliente provisiona e gerencia os worker nodes (ou usa grupos de nós gerenciados). O cliente é responsável por implantar e configurar os workloads, as políticas de rede e os upgrades do cluster. Isso é CaaS — um degrau acima do IaaS, um degrau abaixo de um PaaS completo.
