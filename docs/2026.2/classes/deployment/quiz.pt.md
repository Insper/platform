
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** Uma startup de 3 pessoas com 5 microsserviços precisa entrar no ar esta semana. Qual opção de deploy tem o **menor tempo até estar no ar**?

- A. AWS EKS — nível de produção desde o primeiro dia
- B. Railway ou Fly.io — conecte o GitHub, faça push, pronto
- C. AWS ECS Fargate — nativo de containers, sem nós para gerenciar
- D. AWS Lightsail — a opção mais simples da AWS

??? success "Resposta"
    **B — Railway ou Fly.io.**

    Railway e Fly.io conseguem fazer o deploy de uma aplicação Spring Boot com Docker em minutos, sem nenhuma configuração de infraestrutura. O EKS exige dias de configuração (VPC, node groups, roles IAM, add-ons, ingress controllers); o ECS Fargate ainda exige configurar VPC, task roles IAM, ALB e ECR; o Lightsail é simples, mas ainda precisa de uma imagem enviada a um registry e da criação manual de um container service. Quando o tempo até estar no ar é a restrição, uma PaaS que faz o build direto do repositório vence.

---

**Q2.** Qual é a principal **diferença operacional** entre ECS Fargate e EKS para um time de 10 desenvolvedores?

- A. O ECS Fargate exige gerenciar node groups EC2; o EKS não
- B. O ECS Fargate é serverless — não há nós para gerenciar; o EKS exige gerenciar node groups, add-ons de rede e toda a superfície da API do Kubernetes
- C. O EKS é mais barato com 10 serviços porque o control plane é compartilhado entre os workloads
- D. O ECS Fargate suporta GitOps via ArgoCD nativamente; o EKS não

??? success "Resposta"
    **B — O ECS Fargate é serverless; o EKS exige gerenciar node groups e toda a superfície da API do K8s.**

    Com o ECS Fargate, a AWS provisiona e aplica patches no processamento subjacente — você define uma task (CPU, memória, imagem do container, variáveis de ambiente) e a AWS a executa. Com o EKS, você paga pelo control plane (~US$ 73/mês) e gerencia os node groups por conta própria: tipos de instância, atualizações de AMI, drenagem de nós durante upgrades e todos os add-ons do Kubernetes. Com 10 desenvolvedores, a simplicidade operacional do ECS normalmente supera a perda do ecossistema Kubernetes.

---

**Q3.** Só o control plane do EKS custa cerca de US$ 73/mês. O projeto de 3 serviços de um aluno deveria usar EKS. **Verdadeiro ou falso — e por quê?**

- A. Verdadeiro — o EKS é o padrão da indústria e todo projeto deveria usá-lo para valorizar o currículo
- B. Verdadeiro — o EKS escala para zero, então é econômico para projetos pequenos
- C. Falso — o EKS custa ~US$ 73/mês só pelo control plane, mais ~US$ 61/mês por um node group mínimo (2 × `t3.medium`), somando muito mais do que o custo total de rodar 3 serviços no Railway, no Fly.io ou no Lightsail
- D. Falso — o EKS só está disponível para contas AWS corporativas

??? success "Resposta"
    **C — Falso. Control plane do EKS + node group mínimo superam o custo total das alternativas mais simples.**

    O control plane do EKS custa US$ 0,10/hora × 730 horas ≈ US$ 73/mês antes de um único container rodar. Um node group mínimo (2 × `t3.medium`) acrescenta cerca de US$ 61/mês, e um balanceador de carga e um pequeno banco RDS levam o modelo de custos da aula a aproximadamente US$ 180/mês — contra algo em torno de US$ 15–25/mês para os mesmos três serviços no Fly.io, no Railway ou em uma VM Lightsail (preços de tabela de outubro de 2026, `us-east-1`). (O projeto da disciplina usa EKS mesmo assim, porque seu objetivo é *aprender* Kubernetes.) Além do custo, o EKS exige um conhecimento operacional significativo (roles IAM para service accounts, rede com VPC CNI, configuração de ingress controller) que desvia a atenção dos conceitos de nível de aplicação que a disciplina busca ensinar.

---

**Q4.** O que é o **K3s** e quando você o escolheria em vez do AWS EKS?

- A. O K3s é um dashboard de Kubernetes; escolha-o quando precisar de mais visibilidade sobre clusters EKS
- B. O K3s é uma distribuição leve de Kubernetes (binário < 100 MB) que implementa a mesma API do K8s upstream; escolha-o para deploys on-premises, dispositivos de borda ou ambientes sensíveis a custo em que control planes gerenciados na nuvem não são uma opção
- C. O K3s é um serviço de Kubernetes gerenciado da Rancher, que concorre diretamente com o EKS na infraestrutura da AWS
- D. O K3s é uma versão do Kubernetes que remove o suporte a CRDs para reduzir a complexidade

??? success "Resposta"
    **B — O K3s é uma distribuição de Kubernetes leve e totalmente compatível com a API, para deploys on-prem, na borda ou sensíveis a custo.**

    O K3s roda a API completa do Kubernetes em um binário com menos de 100 MB, substituindo o etcd por SQLite por padrão e removendo as integrações com provedores de nuvem. Você escolheria o K3s em vez do EKS quando precisa de Kubernetes em servidores bare-metal (o data center de uma universidade, o chão de uma fábrica, um cluster de Raspberry Pi), quando a conexão com a internet não é confiável ou quando a taxa de ~US$ 73/mês do control plane do EKS não se justifica. O trade-off é que você é dono de todas as operações — upgrades, backups e configuração de HA — sem suporte gerenciado da AWS.

---

**Q5.** Em 2026, um time de alunos quer a simplicidade do App Runner — "forneça uma imagem de container, receba uma URL HTTPS" — para o serviço order da loja na AWS. O que eles devem usar?

- A. AWS App Runner — ele ainda é o ponto de entrada recomendado para novas contas AWS
- B. Amazon ECS Express Mode — uma única chamada com uma imagem e duas roles IAM cria um serviço Fargate, um ALB com HTTPS, auto scaling e uma URL, tudo como recursos ECS comuns na conta deles
- C. Amazon EKS — é o único serviço da AWS que fornece uma URL HTTPS para um container
- D. AWS Lambda — empacotar o serviço Spring Boot como uma função

??? success "Resposta"
    **B — Amazon ECS Express Mode.**

    A AWS fechou o App Runner para novos clientes em 30 de abril de 2026 (os clientes existentes continuam com ele, sem novas funcionalidades) e recomenda o ECS Express Mode como substituto. O Express Mode não tem cobrança extra — você paga pelas tasks Fargate, pelo balanceador de carga e pelos demais recursos que ele cria — e, como tudo o que ele cria fica visível e editável na sua conta, o time pode depois "se formar" para o ECS Fargate completo sem migrar. Ao contrário do App Runner, ele não faz build a partir do código-fonte: o pipeline de CI precisa antes construir a imagem e enviá-la ao ECR.

---

**Q6.** Um serviço implantado no Fly.io na região de São Paulo (`gru`) atende usuários na Europa. Que recurso do Fly.io pode reduzir a latência para os usuários europeus?

- A. O Fly.io faz cache automático de todas as respostas da API no mundo todo — nenhuma configuração necessária
- B. Você pode implantar o mesmo container em regiões adicionais do Fly.io (por exemplo, `lhr` para Londres, `ams` para Amsterdã) com uma única flag, e o roteamento Anycast do Fly direciona cada usuário para a região mais próxima
- C. O Fly.io usa o CloudFront para servir respostas automaticamente a partir de nós de borda europeus
- D. O Fly.io comprime todas as respostas antes de transmiti-las, reduzindo a latência efetiva

??? success "Resposta"
    **B — Implantar em regiões adicionais; o roteamento Anycast do Fly.io direciona os usuários para a instância mais próxima.**

    O Fly.io atribui a cada aplicação um endereço IP Anycast. Quando um usuário europeu se conecta, sua requisição é roteada via BGP até o nó de borda do Fly mais próximo que roda o seu container — normalmente `lhr` (Londres) ou `ams` (Amsterdã). Adicionar regiões é um único comando, por exemplo `fly scale count 3 --region gru,lhr,ams`. O trade-off: serviços stateless escalam globalmente sem esforço, mas serviços com estado (bancos de dados, sessões) exigem estratégias deliberadas de replicação ou de consistência global — o Fly Postgres clássico é uma app que você mesmo opera, e o mais recente Managed Postgres elimina esse trabalho a um preço fixo maior.

---

**Q7.** A loja está implantada em **Lightsail container services**: o gateway tem o endpoint público e precisa chamar o serviço account e um banco RDS Postgres que vive em uma VPC normal da AWS. Qual afirmação está correta?

- A. Os containers do Lightsail compartilham a VPC padrão da AWS, então as duas chamadas funcionam sem configuração
- B. Todo container service do Lightsail precisa ser público; o gateway chama o account pela URL pública dele, e o RDS é inacessível a partir do Lightsail
- C. O gateway consegue alcançar o account pelo domínio privado dele (`account.service.local`), mas alcançar o RDS em uma VPC exige habilitar o Lightsail VPC peering com a VPC padrão da conta
- D. O Lightsail exige um VPC Connector do App Runner para alcançar tanto o account quanto o RDS

??? success "Resposta"
    **C — Domínio privado entre recursos do Lightsail; VPC peering para o RDS.**

    O Lightsail não usa a rede VPC padrão da AWS. Cada container service recebe um endpoint público e um domínio privado `<service-name>.service.local`, acessível a partir de outros recursos do Lightsail na mesma Region — o suficiente para gateway → account. Recursos fora do Lightsail, como uma instância RDS em uma VPC comum, só ficam acessíveis depois de habilitar o **Lightsail VPC peering** com a VPC padrão da Region, um passo que muitos tutoriais pulam. Também não há security groups nem políticas de rede para ajustar, o que é um dos motivos pelos quais os times acabam superando o Lightsail.

---

**Q8.** Um time está crescendo de 5 para 25 engenheiros e de 8 para 40 microsserviços. Hoje está no Railway. Qual é o **fator mais importante** para decidir entre migrar para ECS Fargate ou para EKS?

- A. A quantidade de microsserviços — o ECS aguenta até 30, o EKS aguenta mais
- B. Se o time tem (ou pretende contratar) um engenheiro de plataforma ou DevOps dedicado, capaz de assumir a operação do Kubernetes — sem um, o ECS Fargate é a resposta certa; com um, o EKS se torna viável
- C. A linguagem de programação — o EKS é obrigatório para serviços Java, o ECS para Node.js
- D. O orçamento mensal — o ECS Fargate é sempre mais barato que o EKS, em qualquer escala

??? success "Resposta"
    **B — A presença de um engenheiro de plataforma dedicado é o fator decisivo.**

    Com 40 microsserviços, tanto o ECS Fargate quanto o EKS são tecnicamente capazes. A questão real é quem é dono da operação. O EKS exige alguém que entenda a rede do Kubernetes (CNI, services, ingress), gerencie os upgrades dos node groups, configure RBAC, instale e mantenha add-ons (Karpenter, ArgoCD, external-secrets-operator) e responda a incidentes do cluster. Sem um engenheiro de plataforma dedicado, essas tarefas caem sobre os desenvolvedores de funcionalidades, atrasando a entrega do produto. O ECS Fargate cobre a maior parte das necessidades de um sistema de microsserviços típico sem taxa de control plane e sem nós para operar — e é a resposta certa para a maioria dos times nessa escala, a menos que GitOps, multi-tenancy ou portabilidade entre nuvens sejam requisitos obrigatórios.

---

**Q9.** O modelo de custos da aula estima cerca de **US$ 71/mês** para os três serviços da loja no ECS Fargate (configuração baixa). Aproximadamente US$ 30 disso são do Application Load Balancer e US$ 14 do RDS. O que isso mostra?

- A. A estimativa está errada — o processamento é sempre a maior linha de uma conta de nuvem
- B. Em pequena escala, os recursos fixos cobrados por hora (balanceador de carga, banco de dados, NAT gateway, control plane do EKS) dominam a conta, e são cobrados mesmo com tráfego zero
- C. Balanceadores de carga são cobrados só por requisição, então os US$ 30 somem quando ninguém usa a loja
- D. Levar os mesmos serviços para o EKS eliminaria o custo do balanceador de carga

??? success "Resposta"
    **B — Custos fixos dominam em pequena escala.**

    Três pequenas tasks Fargate (0,25 vCPU / 0,5 GB) custam cerca de US$ 27/mês; a taxa por hora do ALB, as unidades de capacidade e os endereços IPv4 públicos custam cerca de US$ 30, e a menor instância RDS cerca de US$ 14 — tudo cobrado por hora, cheguem requisições ou não. O EKS *acrescentaria* um control plane de US$ 73 e ainda precisaria de um balanceador de carga. É por isso que plataformas com taxa fixa perdem com três serviços e ganham com cinquenta, e por isso que NAT gateways, balanceadores de carga e clusters esquecidos são a clássica surpresa na conta de um aluno.

---

**Q10.** Um time de 4 pessoas roda 6 serviços no Railway. Os deploys são tranquilos, a conta mensal é previsível e nenhum cliente reclamou de desempenho. Um desenvolvedor propõe migrar para o EKS "porque é o que as grandes empresas usam". Qual é a melhor resposta?

- A. Migrar agora — é mais barato mudar antes de o sistema crescer
- B. Migrar para o EKS, mas manter o Railway como backup
- C. Ficar: não há problema concreto. Manter os serviços portáveis (containers, configuração em variáveis de ambiente, Postgres) e definir os sinais que justificariam a mudança — por exemplo, necessidade de serviços AWS, compliance, rede privada ou muitos times
- D. Ir para VMs EC2 puras para ter o máximo de controle

??? success "Resposta"
    **C — Ficar, e definir os gatilhos de migração.**

    Cada migração deve ser motivada por um problema concreto, não por especulação ou por valorizar o currículo. O EKS acrescentaria uma taxa fixa de control plane, operação de nós e um conhecimento de Kubernetes de que o time ainda não precisa — horas de trabalho de plataforma que não entregam nenhuma funcionalidade. Manter a aplicação 12-factor faz de uma mudança futura um exercício de deploy, e não uma reescrita, então esperar custa pouco.

---

**Q11.** Rodar **K3s em uma única VM de US$ 24/mês** dá à loja a API completa do Kubernetes por uma fração do preço do EKS. Do que você abre mão em comparação com o EKS?

- A. Da API do Kubernetes — o K3s usa seu próprio formato de manifesto
- B. De nada — K3s em uma VM equivale ao EKS
- C. De um control plane gerenciado e altamente disponível: em uma VM, o control plane é um ponto único de falha, e upgrades, backups do datastore e certificados passam a ser responsabilidade sua
- D. Da capacidade de rodar containers Spring Boot

??? success "Resposta"
    **C — Do control plane gerenciado e altamente disponível.**

    O K3s é uma distribuição certificada pela CNCF, então seus Deployments, Services e Ingresses funcionam sem alterações. O que os US$ 0,10/hora do EKS compram é um control plane que a AWS roda em várias Availability Zones, mantém atualizado e com backup. Com K3s em uma VM, perder a VM é perder o cluster e todos os workloads nele; auto-hospedar transfere o trabalho para você, e não apenas tira o custo do caminho.
