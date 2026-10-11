
Seu time construiu a loja: um **gateway**, os serviços **account**, **auth**, **product** e **order**, um banco **Postgres**, um cache **Redis** e o **Kafka**. Tudo roda bem num notebook com Docker Compose. Agora é preciso rodar em algum lugar de verdade. Você poderia comprar servidores, alugar máquinas virtuais, enviar o código para uma plataforma que o executa por você, ou até dispensar alguns componentes e pagar por um produto que já faz o trabalho. Cada opção traça uma linha diferente entre **o que o seu time opera** e **o que outra empresa opera**.

Os modelos de serviço em nuvem definem **quanto da pilha o provedor de nuvem gerencia** e quanto fica com o cliente. Quanto mais o provedor gerencia, menos controle o cliente tem — e mais rápido ele consegue avançar.

Os três modelos fundamentais definidos pelo NIST[^1] são **IaaS**, **PaaS** e **SaaS**. Além deles, surgiram vários modelos especializados — **FaaS**, **CaaS**, **DBaaS** e outros —, cada um recortando uma fatia mais estreita da pilha.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** o que torna um serviço "nuvem" usando a definição do NIST (cinco características essenciais) e a diferença entre CapEx e OpEx.
    - **Mapear** IaaS, PaaS, SaaS, CaaS, FaaS e DBaaS na pilha de responsabilidade compartilhada, dizendo quem instala, atualiza, escala e protege cada camada.
    - **Comparar** os modelos quanto a controle, tempo de lançamento, escalabilidade, modelo de custo e portabilidade.
    - **Escolher** um modelo de serviço para cada componente de um sistema (como a loja) e justificar o trade-off.
    - **Identificar** as responsabilidades que nunca passam para o provedor: seus dados, suas identidades e regras de acesso, e sua configuração.

## Slides

<div class="slides-embed">
  <iframe src="slides/service-models.pt.html" title="Slides: modelos de serviço" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/service-models.pt.html){:target="_blank"}

---

## O que torna um serviço "nuvem"?

Alugar um servidor num datacenter assinando um contrato de três anos não é computação em nuvem, mesmo que o servidor esteja longe. A NIST SP 800-145[^1] define computação em nuvem por **cinco características essenciais**. Um serviço precisa ter todas elas:

| Característica | O que significa | Na loja |
|---|---|---|
| **Autoatendimento sob demanda** | Você provisiona os recursos por conta própria, por um console ou API, sem falar com uma pessoa do provedor | `aws rds create-db-instance` cria o banco Postgres em minutos |
| **Amplo acesso pela rede** | Os recursos são acessíveis pela rede com protocolos padrão | O gateway é um endpoint HTTPS; o `kubectl` conversa com a API do cluster por HTTPS |
| **Agrupamento de recursos** | O provedor atende muitos clientes (**tenants**) a partir de hardware físico compartilhado | Seu serviço order pode rodar no mesmo host físico que o workload de outra empresa, isolado pelo hypervisor |
| **Elasticidade rápida** | A capacidade cresce e diminui rapidamente, muitas vezes de forma automática | Black Friday: escale o serviço order de 2 para 20 réplicas e depois volte |
| **Serviço medido** | O uso é medido e cobrado por unidade (hora, GB, requisição) | A fatura mostra vCPU-horas, GB-mês de armazenamento, GB de transferência de dados |

O NIST também define **modelos de implantação**, que dizem *quem compartilha* a infraestrutura — e não quanto dela você gerencia:

- **Nuvem pública** — compartilhada por qualquer cliente pagante (AWS, Google Cloud, Azure).
- **Nuvem privada** — o mesmo modelo de autoatendimento operado para uma única organização (por exemplo, OpenStack no datacenter da própria empresa).
- **Nuvem híbrida** — uma combinação, por exemplo, os dados de clientes ficam on-premises enquanto a camada web roda numa nuvem pública.
- **Nuvem comunitária** — compartilhada por organizações com requisitos em comum (por exemplo, órgãos de governo).

**CapEx vs OpEx.** Comprar servidores é **despesa de capital (CapEx)**: um pagamento alto adiantado por um ativo que você possui e deprecia ao longo dos anos, dimensionado para o pico que você *espera*. A nuvem transforma a infraestrutura em **despesa operacional (OpEx)**: você paga mensalmente pelo que *usa*. O OpEx elimina a aposta inicial, mas não é automaticamente mais barato — um workload que roda em carga máxima 24/7 por anos pode custar mais na nuvem do que em hardware próprio.

---

## A pilha de responsabilidade compartilhada

Todo modelo de serviço em nuvem pode ser mapeado na mesma pilha de seis camadas:

| Camada | O que é |
|---|---|
| **Hardware** | Servidores físicos, discos, switches de rede, energia e refrigeração do datacenter |
| **Virtualização** | O hypervisor que divide um host físico em máquinas virtuais |
| **SO** | O sistema operacional convidado de cada máquina virtual (Linux, Windows) |
| **Middleware** | Runtime e software de suporte: JDK, servidor web, servidor de aplicação, message broker |
| **Aplicação** | Seu código: o gateway, o serviço account, o serviço order |
| **Dados** | O que a aplicação armazena: usuários, pedidos, produtos |

A linha que separa o que o provedor gerencia (verde) do que o cliente gerencia (laranja) sobe à medida que você avança na hierarquia de modelos:

``` mermaid-sim
graph TD
  subgraph On-Premises
    direction TB
    A1[Hardware] --> A2[Virtualização]
    A2 --> A3[SO]
    A3 --> A4[Middleware]
    A4 --> A5[Aplicação]
    A5 --> A6[Dados]
    style A1 fill:#ff9999,stroke:#333
    style A2 fill:#ff9999,stroke:#333
    style A3 fill:#ff9999,stroke:#333
    style A4 fill:#ff9999,stroke:#333
    style A5 fill:#ff9999,stroke:#333
    style A6 fill:#ff9999,stroke:#333
  end
  subgraph IaaS
    direction TB
    B1[Hardware] --> B2[Virtualização]
    B2 --> B3[SO]
    B3 --> B4[Middleware]
    B4 --> B5[Aplicação]
    B5 --> B6[Dados]
    style B1 fill:#a8e6cf,stroke:#333
    style B2 fill:#a8e6cf,stroke:#333
    style B3 fill:#ffd3b6,stroke:#333
    style B4 fill:#ffd3b6,stroke:#333
    style B5 fill:#ffd3b6,stroke:#333
    style B6 fill:#ffd3b6,stroke:#333
  end
  subgraph PaaS
    direction TB
    C1[Hardware] --> C2[Virtualização]
    C2 --> C3[SO]
    C3 --> C4[Middleware]
    C4 --> C5[Aplicação]
    C5 --> C6[Dados]
    style C1 fill:#a8e6cf,stroke:#333
    style C2 fill:#a8e6cf,stroke:#333
    style C3 fill:#a8e6cf,stroke:#333
    style C4 fill:#a8e6cf,stroke:#333
    style C5 fill:#ffd3b6,stroke:#333
    style C6 fill:#ffd3b6,stroke:#333
  end
  subgraph SaaS
    direction TB
    D1[Hardware] --> D2[Virtualização]
    D2 --> D3[SO]
    D3 --> D4[Middleware]
    D4 --> D5[Aplicação]
    D5 --> D6[Dados]
    style D1 fill:#a8e6cf,stroke:#333
    style D2 fill:#a8e6cf,stroke:#333
    style D3 fill:#a8e6cf,stroke:#333
    style D4 fill:#a8e6cf,stroke:#333
    style D5 fill:#a8e6cf,stroke:#333
    style D6 fill:#a8e6cf,stroke:#333
  end
```

:material-square:{ style="color:#a8e6cf" } Provedor gerencia &nbsp;&nbsp; :material-square:{ style="color:#ffd3b6" } Cliente gerencia &nbsp;&nbsp; :material-square:{ style="color:#ff9999" } Cliente gerencia (on-premises: tudo)

A mesma divisão vale para a **segurança**. A AWS resume isso como *segurança **da** nuvem* (o provedor: datacenters físicos, hypervisor, software dos serviços gerenciados) versus *segurança **na** nuvem* (o cliente: dados, gerenciamento de identidade e acesso, regras de rede, configurações de criptografia, o SO no IaaS)[^2]. A Microsoft apresenta a mesma tabela para o Azure[^3]. Note que, mesmo no SaaS, o quadrado de dados se refere a *operar* o armazenamento: decidir **quem pode ler os dados** é sempre tarefa do cliente.

!!! tip "Uma analogia: pizza como serviço"
    - **On-premises** — fazer pizza em casa: você compra o forno, os ingredientes e cozinha.
    - **IaaS** — alugar uma cozinha: forno e gás são fornecidos; você traz os ingredientes e cozinha.
    - **PaaS** — pedir delivery: alguém cozinha; você providencia a mesa, as bebidas e os convidados.
    - **SaaS** — comer num restaurante: você só escolhe no cardápio (e ainda decide quem senta à sua mesa).

---

## IaaS — Infraestrutura como Serviço

**Você aluga infraestrutura bruta.** O provedor fornece computação, armazenamento e rede virtualizados. Você instala o SO, o runtime, o middleware e tudo o que vem acima.

| Provedor gerencia | Cliente gerencia |
|---|---|
| Datacenter físico, energia, refrigeração | SO: instalação, atualizações, hardening |
| Hypervisor e SO do host | Runtime e middleware |
| Rede física | Código da aplicação e dados |
| — | Regras de firewall, IAM, backups |

**Exemplos:** AWS EC2, Google Compute Engine, Azure Virtual Machines, DigitalOcean Droplets.

**Quando escolher IaaS:**

- Você precisa de controle total no nível do SO (kernel customizado, versão específica de SO)
- **Lift-and-shift** de workloads on-premises existentes — mover uma aplicação para VMs na nuvem *como está*, sem redesenhá-la
- Computação de alto desempenho com hardware especializado (instâncias com GPU)
- Conformidade rigorosa que exige controlar a pilha inteira

!!! example "Fluxo típico de IaaS"
    1. Provisione uma VM (por exemplo, `t3.medium` no EC2: 2 vCPU, 4 GiB)
    2. Acesse por SSH e instale o JDK e o runtime da sua aplicação
    3. Configure o nginx como proxy reverso
    4. Configure jobs no cron para os backups
    5. Aplique as atualizações do SO manualmente ou com automação (Ansible, SSM)

---

## PaaS — Plataforma como Serviço

**Você faz o deploy do código; o provedor o executa.** O provedor gerencia o SO, o runtime, o middleware, a escalabilidade e a rede. Você escreve a aplicação e a configura por variáveis de ambiente.

| Provedor gerencia | Cliente gerencia |
|---|---|
| Do hardware até o runtime | Código da aplicação |
| Atualizações e patches do SO | Configuração (variáveis de ambiente, regras de escala) |
| Balanceamento de carga e auto-scaling | Dados da aplicação |
| Pipelines de build e deploys | — |

**Exemplos:** Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.

**Implicação arquitetural:** o PaaS favorece o padrão **12-factor app**[^4] — processos stateless, configuração por variáveis de ambiente, logs no stdout. A plataforma pode reiniciar ou mover seu processo a qualquer momento, e o sistema de arquivos local é **efêmero** (apagado a cada reinício); por isso, o estado persistente precisa ficar em serviços gerenciados externos (banco de dados, armazenamento de objetos).

**Quando escolher PaaS:**

- Construir uma aplicação nova sem experiência em infraestrutura no time
- Prototipagem rápida e MVPs
- Backends de API e microsserviços que não precisam de controle do SO
- Times que querem entregar funcionalidades, não gerenciar servidores

!!! example "Fluxo típico de PaaS"
    1. `git push heroku main` (ou conecte um repositório do GitHub)
    2. O provedor detecta o runtime (Java, Node, Python) por meio de **buildpacks** — scripts que reconhecem o projeto (por exemplo, um `pom.xml`) e sabem como fazer o build e executá-lo
    3. O provedor faz o build, containeriza e faz o deploy automaticamente
    4. Anexe um add-on de Postgres gerenciado — nenhum servidor de banco de dados para manter

---

## SaaS — Software como Serviço

**Você usa o software; o provedor opera tudo.** O cliente gerencia apenas usuários, permissões e os dados que insere. Não há infraestrutura nem aplicação para operar.

| Provedor gerencia | Cliente gerencia |
|---|---|
| Do hardware até a aplicação | Contas de usuário e permissões |
| Segurança, conformidade, atualizações | Dados inseridos no sistema |
| Multi-tenancy e isolamento | Integrações (via APIs/webhooks) |

**Exemplos:** Google Workspace, Salesforce, Slack, Notion, GitHub, Datadog, PagerDuty.

**Multi-tenancy:** uma única instância da aplicação atende todos os clientes (**tenants**), com os dados isolados por tenant ID. Isso gera economia de escala — e é por isso que o SaaS tem o menor tempo até gerar valor.

**Quando escolher SaaS:**

- Um software pronto já atende a necessidade (CRM, RH, e-mail, monitoramento)
- O time não deveria construir nem operar a ferramenta em si
- A velocidade de adoção importa mais do que a profundidade de customização

---

## Além dos três grandes

Os modelos fundamentais deram origem a variantes especializadas, voltadas para uma parte mais estreita da pilha:

### FaaS — Função como Serviço (Serverless)

O extremo do PaaS. Você faz o deploy de **funções** individuais em vez de aplicações. O provedor gerencia tudo — inclusive escalar até zero quando ocioso — e cobra apenas pelos milissegundos em que a função executa.

| | |
|---|---|
| **Unidade de deploy** | Uma única função |
| **Escalabilidade** | Automática, até zero quando ociosa |
| **Cobrança** | Por invocação + duração (ms) |
| **Restrição** | Cold starts; tempo máximo de execução (15 min no AWS Lambda[^5]) |
| **Exemplos** | AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers |

Um **cold start** é o atraso da primeira requisição que chega a uma função sem nenhuma instância aquecida: a plataforma precisa alocar um sandbox, carregar o código e inicializar o runtime. Para uma aplicação Spring Boot, isso pode levar segundos. Os provedores oferecem mitigações — por exemplo, a *provisioned concurrency* do Lambda mantém instâncias aquecidas —, mas você paga por elas mesmo quando estão ociosas, o que corrói a principal vantagem do FaaS.

**Ideal para:** workloads orientados a eventos, webhooks, jobs agendados, tarefas esporádicas ou em rajadas. Não é adequado para aplicações de longa duração ou que exigem latência baixa de forma consistente.

### CaaS — Container como Serviço

Fica entre IaaS e PaaS. Você fornece **imagens Docker**; o provedor gerencia o runtime de containers, a orquestração, a rede e a escalabilidade. Você mantém controle total sobre o runtime dentro do container.

| | |
|---|---|
| **Unidade de deploy** | Imagem Docker |
| **O que você controla** | Tudo dentro do container |
| **O que o provedor gerencia** | Agendamento, rede, escalabilidade, saúde dos nós |
| **Exemplos** | AWS ECS / Fargate, Google Cloud Run, Azure Container Instances, Azure Container Apps |

**Ideal para:** times de microsserviços que já usam Docker e querem orquestração gerenciada sem operar o Kubernetes por conta própria.

O **Kubernetes gerenciado** (Amazon EKS, Google GKE, Azure AKS) também costuma ser classificado como CaaS: o provedor opera o control plane do Kubernetes (API server, scheduler, etcd), e você faz o deploy de containers pela API padrão do Kubernetes, mantida pela CNCF[^6]. Quanto dos *worker nodes* você gerencia depende do modo — os node groups clássicos deixam com você o dimensionamento e as atualizações dos nós, enquanto modos como o GKE Autopilot e o EKS Auto Mode também passam o gerenciamento dos nós para o provedor.

!!! info "Containers serverless borram a fronteira"
    Algumas ofertas de CaaS — Google Cloud Run, Azure Container Apps — também **escalam até zero** e cobram por tempo de requisição, exatamente como o FaaS, mas executam qualquer imagem de container. "Serverless" descreve o *modelo de operação* (nenhum servidor para gerenciar, pagamento por uso), e não apenas funções.

### DBaaS — Banco de Dados como Serviço

Um banco de dados gerenciado, em que o provedor cuida de provisionamento, backups, replicação, patches e failover. Você se conecta com um cliente padrão e executa consultas.

| | |
|---|---|
| **Você gerencia** | Modelagem do schema, otimização de consultas, controle de acesso |
| **O provedor gerencia** | Replicação, backups, patches do SO, failover |
| **Exemplos** | AWS RDS, Amazon Aurora, Google Cloud SQL, Azure Database, PlanetScale, Neon |

### Outros modelos especializados

| Modelo | Sigla | Exemplos |
|---|---|---|
| Armazenamento como Serviço | STaaS | AWS S3, Google Cloud Storage, Backblaze B2 |
| IA / ML como Serviço | AIaaS | AWS Bedrock, Google Vertex AI, Azure AI |
| Monitoramento como Serviço | — | Datadog, New Relic, Grafana Cloud |
| Segurança como Serviço | SECaaS | Cloudflare, AWS Shield, Snyk |
| Comunicação como Serviço | CPaaS | Twilio, SendGrid, AWS SES |

---

## Exemplo: a loja, componente por componente

Sistemas reais **misturam** modelos de serviço: cada componente vai para onde o seu trade-off é melhor. Esta é uma forma razoável de rodar a loja na AWS — o mesmo formato do projeto da disciplina, que roda os serviços no EKS:

``` mermaid-sim
flowchart LR
  client([Cliente]) --> gw["gateway<br/>CaaS: EKS"]
  gw --> acc["account<br/>CaaS: EKS"]
  gw --> ord["order<br/>CaaS: EKS"]
  acc --> db[("Postgres<br/>DBaaS: RDS")]
  ord --> db
  ord --> cache[("Redis<br/>DBaaS: ElastiCache")]
  ord --> kafka["Kafka<br/>gerenciado: Amazon MSK"]
  kafka --> fn["notification<br/>FaaS: Lambda"]
  fn --> mail["e-mail<br/>CPaaS: AWS SES"]
```

| Componente | Faça você mesmo | Opção gerenciada | O que muda para o time |
|---|---|---|---|
| gateway, account, order | Docker Compose numa VM EC2 (IaaS) | EKS ou ECS Fargate (CaaS) | Acabam o SSH e os patches do SO; em vez disso, você escreve manifests ou task definitions |
| Postgres | Postgres instalado no EC2 (IaaS) | RDS (DBaaS) | Backups, replicação e failover viram opções de configuração |
| Redis | Container Redis na VM | ElastiCache (DBaaS) | O cache sobrevive a um reboot da VM; você paga por nó |
| Kafka | Brokers Kafka em VMs | Amazon MSK | Patches e substituição dos brokers passam para a AWS |
| Notificação de pedido | Um consumer sempre rodando no cluster | Lambda acionada pelo tópico do Kafka (FaaS) | Pague por mensagem; aceite cold starts num caminho assíncrono |
| CI/CD | Jenkins num container ([Hands-on 4](../../hands-on/4/index.md)) | GitHub Actions (SaaS) | Nenhum servidor Jenkins para atualizar |
| Monitoramento | Prometheus + Grafana ([Hands-on 6](../../hands-on/6/index.md)) | Grafana Cloud ou Datadog (SaaS) | Nenhum armazenamento de métricas para dimensionar; preço por host ou por métrica |

Note que mover um componente *para cima* (de IaaS para um modelo gerenciado) nunca elimina a coluna de **dados e acesso**: você continua decidindo quem pode se conectar ao RDS, qual security group alcança o gateway e o que é registrado em log.

---

## Comparação completa

| | On-Premises | IaaS | PaaS | CaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **Controle** | Máximo | Alto | Médio | Médio | Baixo | Mínimo |
| **Responsabilidade do cliente** | Tudo | SO e acima | App e dados | Container e dados | Código e dados | Dados e usuários |
| **Tempo de lançamento** | Lento | Lento | Rápido | Rápido | Muito rápido | Imediato |
| **Escalabilidade** | Manual | Manual / por script | Automática | Automática (alguns até zero) | Automática até zero | Automática |
| **Modelo de custo** | CapEx | Por VM-hora | Por uso | Por container-hora | Por invocação | Por usuário/licença |
| **Portabilidade** | Total | Alta | Média | Alta (imagem) | Baixa (API do fornecedor) | Baixa (só exportação de dados) |

---

## Framework de decisão

``` mermaid-sim
flowchart TD
  start([Do que você precisa?]) --> q1{"Precisa de controle total do SO<br/>ou de lift-and-shift?"}
  q1 -->|Sim| iaas["IaaS<br/>EC2, GCE, Azure VM"]
  q1 -->|Não| q2{Vai fazer deploy de containers?}
  q2 -->|Sim| q3{"Quer gerenciar o<br/>Kubernetes por conta própria?"}
  q3 -->|Sim| k8s["CaaS com Kubernetes<br/>EKS, GKE, AKS"]
  q3 -->|Não| caas["CaaS gerenciado<br/>Cloud Run, ECS Fargate"]
  q2 -->|Não| q4{"Workload orientado a eventos /<br/>esporádico?"}
  q4 -->|Sim| faas["FaaS<br/>Lambda, Cloud Functions"]
  q4 -->|Não| q5{"Vai construir uma<br/>aplicação própria?"}
  q5 -->|Sim| paas["PaaS<br/>Heroku, App Engine"]
  q5 -->|Não| saas["SaaS<br/>Use um produto existente"]
```

Aplique o framework **por componente**, e não uma vez para o sistema inteiro: no exemplo acima, os serviços ficam em CaaS, a notificação de pedido em FaaS e o monitoramento em SaaS.

---

## Trade-offs e armadilhas

!!! warning "Erros comuns"
    - **Entender "gerenciado" como "não é problema meu".** A maioria dos vazamentos de dados na nuvem vem de configuração do lado do cliente — um bucket S3 público, um banco de dados aberto para `0.0.0.0/0`, uma access key vazada —, e não do provedor. Essa camada é sempre sua[^2].
    - **Ignorar o lock-in.** Quanto mais alto o modelo, mais seu código e seus dados dependem da API de um único fornecedor (triggers do Lambda, consultas do DynamoDB, o formato de dados de um SaaS). Prefira interfaces abertas quando elas custam pouco: containers, Postgres, a API do Kubernetes, OpenTelemetry.
    - **Supor que o modelo mais alto é sempre mais barato.** Serviços gerenciados cobram um adicional por unidade. Em pequena escala, isso é muito mais barato do que o tempo de um engenheiro; em escala grande e constante, um time pode economizar operando o componente por conta própria.
    - **Guardar estado numa instância de PaaS ou FaaS.** Arquivos locais e sessões em memória desaparecem num reinício ou numa redução de escala. Mantenha o estado num banco de dados, cache ou armazenamento de objetos.
    - **Usar FaaS para uma API de alto tráfego e sensível à latência.** Cold starts e preço por invocação tornam um container sempre ligado mais barato e mais previsível sob carga constante.

---

## Pontos-chave

- Um serviço é "nuvem" quando tem as cinco características do NIST: autoatendimento sob demanda, amplo acesso pela rede, agrupamento de recursos, elasticidade rápida e serviço medido — e ele transforma CapEx em OpEx.
- Um modelo de serviço define **quem gerencia cada camada** da pilha de seis camadas; IaaS, PaaS e SaaS sobem a linha, passo a passo.
- CaaS (imagens), FaaS (funções, escala até zero, cold starts) e DBaaS (bancos de dados gerenciados) recortam fatias mais estreitas da pilha.
- Mais gerenciado significa **mais velocidade e menos operação**, mas **menos controle e portabilidade**.
- Sistemas reais misturam modelos: escolha **por componente** — os serviços da loja em CaaS, o Postgres em DBaaS, o monitoramento em SaaS.
- Seus dados, identidades, regras de acesso e configuração são **sempre** sua responsabilidade.

## Conexões

- [Containerização](../containerization/index.md) — a imagem Docker que as plataformas de CaaS executam.
- [Microsserviços](../microservices/index.md) — por que a loja é dividida em serviços com deploy independente.
- [Roteiro de deploy na nuvem](../deployment/index.md) — a próxima aula: plataformas concretas (Railway, Fly.io, Lightsail, ECS, EKS) e seus custos.
- [Hands-on 5 — Orquestração](../../hands-on/5/index.md) — Kubernetes localmente com Minikube, a API que o EKS gerencia para você.
- Projeto: [AWS](../../exercises/project/aws/index.md), [EKS](../../exercises/project/eks/index.md) e [Custos e PaaS](../../exercises/project/costs/index.md).

---

:fontawesome-brands-youtube:{ .youtube } [IaaS vs PaaS vs SaaS](https://www.youtube.com/watch?v=SBQoyZXrpcY){:target="_blank"} — visão geral prática dos três modelos fundamentais (em inglês).


[^1]: MELL, P.; GRANCE, T. [The NIST Definition of Cloud Computing](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf){:target="_blank"}. NIST Special Publication 800-145, 2011.
[^2]: [AWS Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/){:target="_blank"}
[^3]: [Azure Shared Responsibility](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility){:target="_blank"}
[^4]: WIGGINS, A. [The Twelve-Factor App](https://12factor.net/){:target="_blank"}, 2011.
[^5]: [AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html){:target="_blank"} — tempo limite da função de até 900 segundos (15 minutos).
[^6]: [Cloud Native Computing Foundation (CNCF)](https://www.cncf.io/){:target="_blank"}
