
Os modelos de serviço em nuvem definem **quanto da pilha o provedor de nuvem gerencia** em comparação com quanto o cliente gerencia. Quanto mais o provedor gerencia, menos controle o cliente tem — e mais rápido ele consegue avançar.

Os três modelos fundamentais definidos pelo NIST[^1] são **IaaS**, **PaaS** e **SaaS**. Além deles, surgiram vários modelos especializados — **FaaS**, **CaaS**, **DBaaS** e outros —, cada um recortando uma fatia mais estreita da pilha.

---

## A pilha de responsabilidade compartilhada

Todo modelo de serviço em nuvem pode ser mapeado na mesma pilha de seis camadas. A linha divisória entre o que o provedor gerencia (verde) e o que o cliente gerencia (laranja) se desloca à medida que você sobe na hierarquia de modelos:

``` mermaid
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

:material-square:{ style="color:#a8e6cf" } Gerenciado pelo provedor &nbsp;&nbsp; :material-square:{ style="color:#ffd3b6" } Gerenciado pelo cliente &nbsp;&nbsp; :material-square:{ style="color:#ff9999" } Gerenciado pelo cliente (on-premises: tudo)

---

## IaaS — Infraestrutura como Serviço

**Você aluga infraestrutura bruta.** O provedor fornece computação, armazenamento e rede virtualizados. Você instala o sistema operacional, o runtime, o middleware e tudo o que fica acima.

| O provedor gerencia | O cliente gerencia |
|---|---|
| Datacenter físico, energia, refrigeração | SO: instalação, atualizações, hardening |
| Hypervisor e SO do host | Runtime e middleware |
| Rede física | Código da aplicação e dados |
| — | Regras de firewall, IAM, backups |

**Exemplos:** AWS EC2, Google Compute Engine, Azure Virtual Machines, DigitalOcean Droplets.

**Quando escolher IaaS:**
- Você precisa de controle total no nível do SO (kernel customizado, uma versão específica de SO)
- Lift-and-shift de workloads on-premises existentes
- Computação de alto desempenho com hardware especializado (instâncias com GPU)
- Exigências rigorosas de compliance que demandam controlar a pilha inteira

!!! example "Fluxo típico em IaaS"
    1. Provisione uma VM (por exemplo, `t3.medium` no EC2)
    2. Acesse via SSH e instale o JDK e o runtime da sua aplicação
    3. Configure o nginx como proxy reverso
    4. Configure cron jobs para os backups
    5. Aplique as atualizações do SO manualmente ou com automação (Ansible, SSM)

---

## PaaS — Plataforma como Serviço

**Você implanta o código; o provedor o executa.** O provedor gerencia o SO, o runtime, o middleware, a escalabilidade e a rede. Você escreve a aplicação e a configura por meio de variáveis de ambiente.

| O provedor gerencia | O cliente gerencia |
|---|---|
| Do hardware até o runtime | Código da aplicação |
| Atualizações e patches do SO | Configuração (variáveis de ambiente, regras de escala) |
| Balanceamento de carga e auto-scaling | Dados da aplicação |
| Pipelines de build e deploys | — |

**Exemplos:** Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.

**Implicação arquitetural:** o PaaS favorece o padrão **12-factor app** — processos sem estado, configuração via variáveis de ambiente, logs na saída padrão (stdout). O estado persistente precisa ficar em serviços gerenciados externos (banco de dados, armazenamento de objetos).

**Quando escolher PaaS:**
- Construir uma nova aplicação sem expertise em infraestrutura na equipe
- Prototipagem rápida e MVPs
- Backends de API e microsserviços que não precisam de controle do SO
- Equipes que querem entregar funcionalidades, e não gerenciar servidores

!!! example "Fluxo típico em PaaS"
    1. `git push heroku main` (ou conecte um repositório do GitHub)
    2. O provedor detecta o runtime (Java, Node, Python) por meio de buildpacks
    3. O provedor faz o build, containeriza e implanta automaticamente
    4. Anexe um add-on de Postgres gerenciado — nenhum servidor de banco de dados para manter

---

## SaaS — Software como Serviço

**Você usa o software; o provedor executa tudo.** O cliente gerencia apenas os usuários, as permissões e os dados que insere. Não há infraestrutura nem aplicação para operar.

| O provedor gerencia | O cliente gerencia |
|---|---|
| Do hardware até a aplicação | Contas de usuário e permissões |
| Segurança, compliance, atualizações | Dados inseridos no sistema |
| Multi-tenancy e isolamento | Integrações (via APIs/webhooks) |

**Exemplos:** Google Workspace, Salesforce, Slack, Notion, GitHub, Datadog, PagerDuty.

**Multi-tenancy:** uma única instância da aplicação atende todos os clientes, com os dados isolados por ID do tenant (inquilino). Isso permite economias de escala — e é por isso que o SaaS tem o menor tempo até gerar valor.

**Quando escolher SaaS:**
- Um software pronto já atende à necessidade (CRM, RH, e-mail, monitoramento)
- A equipe não deveria estar construindo nem operando a ferramenta em si
- A velocidade de adoção importa mais do que a profundidade de customização

---

## Além dos três grandes

Os modelos fundamentais deram origem a variantes especializadas, voltadas a uma parte mais estreita da pilha:

### FaaS — Função como Serviço (Serverless)

O extremo do PaaS. Você implanta **funções** individuais, e não aplicações. O provedor gerencia tudo — inclusive escalar até zero quando ocioso — e cobra apenas pelos milissegundos em que a função executa.

| | |
|---|---|
| **Unidade de deploy** | Uma única função |
| **Escalabilidade** | Automática, até zero quando ociosa |
| **Cobrança** | Por invocação + duração (ms) |
| **Restrição** | Cold starts; tempo máximo de execução (por exemplo, 15 min no Lambda) |
| **Exemplos** | AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers |

**Ideal para:** workloads orientados a eventos, webhooks, jobs agendados, tarefas esporádicas ou em rajadas. Não é adequado para aplicações de longa duração ou que exigem latência baixa de forma consistente.

### CaaS — Container como Serviço

Entre o IaaS e o PaaS. Você fornece **imagens Docker**; o provedor gerencia o runtime de containers, a orquestração, a rede e a escalabilidade. Você mantém o controle total do runtime dentro do container.

| | |
|---|---|
| **Unidade de deploy** | Imagem Docker |
| **O que você controla** | Tudo dentro do container |
| **O que o provedor gerencia** | Escalonamento, rede, escalabilidade, saúde dos nós |
| **Exemplos** | AWS ECS / Fargate, Google Cloud Run, Azure Container Instances |

**Ideal para:** equipes de microsserviços que já usam Docker e querem orquestração gerenciada sem operar o Kubernetes por conta própria.

### DBaaS — Banco de Dados como Serviço

Um banco de dados gerenciado, em que o provedor cuida do provisionamento, dos backups, da replicação, das atualizações e do failover. Você se conecta com um cliente padrão e executa consultas.

| | |
|---|---|
| **Você gerencia** | Projeto do schema, ajuste de consultas, controle de acesso |
| **O provedor gerencia** | Replicação, backups, atualizações do SO, failover |
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

## Comparação completa

| | On-Premises | IaaS | PaaS | CaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **Controle** | Máximo | Alto | Médio | Médio | Baixo | Mínimo |
| **Responsabilidade do cliente** | Tudo | Do SO para cima | Aplicação e dados | Container e dados | Apenas o código | Apenas os dados |
| **Time to market** | Lento | Lento | Rápido | Rápido | Muito rápido | Imediato |
| **Escalabilidade** | Manual | Manual / por scripts | Automática | Automática | Automática até zero | Automática |
| **Modelo de custo** | CapEx | Por hora de VM | Por uso | Por hora de container | Por invocação | Por usuário/licença |
| **Portabilidade** | Total | Alta | Média | Alta (imagem) | Baixa (API do fornecedor) | Nenhuma |

---

## Guia de decisão

``` mermaid
flowchart TD
  start([Do que você precisa?]) --> q1{Precisa de controle total do SO\nou de lift-and-shift?}
  q1 -->|Sim| iaas[IaaS\nEC2, GCE, Azure VM]
  q1 -->|Não| q2{Vai implantar containers?}
  q2 -->|Sim| q3{Quer gerenciar\no Kubernetes você mesmo?}
  q3 -->|Sim| k8s[CaaS no Kubernetes\nEKS, GKE, AKS]
  q3 -->|Não| caas[CaaS gerenciado\nCloud Run, ECS Fargate]
  q2 -->|Não| q4{Workload orientado a eventos /\nesporádico?}
  q4 -->|Sim| faas[FaaS\nLambda, Cloud Functions]
  q4 -->|Não| q5{Está construindo uma\naplicação própria?}
  q5 -->|Sim| paas[PaaS\nHeroku, App Engine]
  q5 -->|Não| saas[SaaS\nUse um produto existente]
```

---

:fontawesome-brands-youtube:{ .youtube } [IaaS vs PaaS vs SaaS](https://www.youtube.com/watch?v=SBQoyZXrpcY){:target="_blank"} — visão geral prática dos três modelos fundamentais.


[^1]: MELL, P.; GRANCE, T. [The NIST Definition of Cloud Computing](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf){:target="_blank"}. NIST Special Publication 800-145, 2011.
[^2]: [AWS Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/){:target="_blank"}
[^3]: [Azure Shared Responsibility](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility){:target="_blank"}
[^4]: [Cloud Native Computing Foundation (CNCF)](https://www.cncf.io/){:target="_blank"}
