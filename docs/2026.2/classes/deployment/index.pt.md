# Roteiro de deploy na nuvem

Kubernetes não é a resposta certa para todo time. Ele resolve problemas reais em escala — mas traz uma complexidade operacional e um custo significativos, capazes de afundar um time pequeno ou uma startup antes mesmo de ela lançar sua primeira funcionalidade. Esta aula mapeia o panorama de deploy e oferece um roteiro de decisão: dado o tamanho do seu time, a quantidade de serviços e a sua maturidade operacional, qual é a escolha de infraestrutura certa *agora*, e como você evolui para o próximo nível?

A aula anterior, [Modelos de serviço](../service_models/index.md), deu o vocabulário (IaaS, PaaS, CaaS, DBaaS). Esta aula o transforma em plataformas concretas, preços e um caminho de migração para a loja: gateway, account, order, Postgres.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Comparar** as principais plataformas de deploy (Railway, Render, Fly.io, Lightsail, ECS Fargate / Express Mode, EKS, K3s) pelo que elas escondem e pelo que você ainda gerencia.
    - **Escolher** uma plataforma para um dado tamanho de time, quantidade de serviços e maturidade operacional, e justificar por que o Kubernetes vale ou ainda não vale a pena.
    - **Estimar** o custo mensal de um pequeno sistema de microsserviços a partir de preços unitários, e apontar os custos fixos (control plane, balanceador de carga, NAT gateway) que dominam em pequena escala.
    - **Planejar** um caminho de migração guiado por problemas concretos, e não por especulação sobre a escala futura.
    - **Diagnosticar** as armadilhas de rede comuns das plataformas simples (rede privada, acesso a um banco de dados gerenciado).

## Slides

<div class="slides-embed">
  <iframe src="slides/deployment.html" title="Slides: roteiro de deploy na nuvem" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/deployment.html){:target="_blank"}

---

## 1. O espectro da infraestrutura gerenciada

Os provedores de nuvem foram, aos poucos, abstraindo as preocupações de infraestrutura. O trade-off é sempre o mesmo: quanto mais a plataforma gerencia, menos controle você tem e menos carga operacional você carrega. O diagrama vai da opção **mais gerenciada**, à esquerda, até a de **mais controle (e mais trabalho)**, à direita:

``` mermaid-sim
flowchart LR
    subgraph dx ["Caminho da experiência do desenvolvedor"]
        railway["Railway / Render<br/>(git push → URL)"] -->|"mais controle, mais ops"| fly["Fly.io<br/>(Dockerfile, regiões)"]
        fly -->|"mais controle, mais ops"| lightsail["Lightsail<br/>(VM simples ou containers)"]
    end
    subgraph aws ["Caminho nativo da AWS"]
        express["ECS Express Mode<br/>(imagem → URL HTTPS)"] -->|"mais controle, mais ops"| ecs["ECS Fargate<br/>(task definitions, sem nós)"]
        ecs -->|"mais controle, mais ops"| eks["EKS<br/>(Kubernetes completo)"]
        eks -->|"mais controle, mais ops"| vm["VMs EC2<br/>(você opera tudo)"]
    end
```

!!! info "Dois caminhos, não um único eixo"
    Não existe um espectro único aqui. O ECS Express Mode não é "mais gerenciado" que o Railway em nenhum sentido mensurável — eles atendem a casos de uso diferentes. O diagrama mostra dois caminhos: o **caminho da experiência do desenvolvedor** (plataformas no estilo PaaS que escondem quase tudo) e o **caminho nativo da AWS** (serviços que vivem na sua conta AWS, ao lado de RDS, IAM e da sua VPC). O contexto do seu time determina qual caminho é relevante.

| Plataforma | Modelo | O que ela esconde | O que você gerencia | Ideal para |
|---|---|---|---|---|
| **Railway / Render** | PaaS | Tudo, exceto o código | Variáveis de ambiente, domínios | Startups, protótipos, projetos pessoais |
| **Fly.io** | PaaS / CaaS | Infraestrutura | Dockerfile, regiões, tamanhos de máquina | Apps globais de baixa latência, deploys na borda |
| **AWS Lightsail** | IaaS (VPS) ou CaaS simples | Hardware, rede | Instância: SO e runtime; containers: imagem e escala | Primeiro deploy na nuvem, projetos de alunos, orçamentos fixos |
| **AWS ECS Express Mode** | CaaS | Balanceador de carga, escalonamento, configuração de rede | Imagem do container, variáveis de ambiente, duas roles IAM | Serviços stateless na AWS, a porta de entrada simples para o ECS |
| **AWS ECS Fargate** | CaaS | Nós EC2 | Task definitions, escalonamento do serviço, ALB | Média escala, nativo da AWS, produção |
| **AWS EKS** | CaaS (Kubernetes gerenciado) | Control plane | Node groups, rede, add-ons | Times grandes, workloads complexos, multi-tenant |
| **K3s auto-hospedado** | IaaS + seu próprio Kubernetes | Nada além da VM | Todas as operações do K8s | On-premises, homelab, custo sensível |

A seção [5](#5-cost-comparison) estima o custo mensal de cada uma para o mesmo workload.

!!! warning "O AWS App Runner está fechado para novos clientes"
    Edições anteriores recomendavam o **AWS App Runner** (imagem de container ou repositório Git → URL HTTPS). Desde **30 de abril de 2026**, o App Runner não aceita novos clientes; os clientes existentes continuam usando-o, mas não há novas funcionalidades previstas. A AWS recomenda o **Amazon ECS Express Mode** como substituto[^2]. Plataformas gerenciadas têm um ciclo de vida — essa é mais uma face do vendor lock-in.

---

## 2. Roteiro de decisão por tamanho de time

=== "Pequeno (1–5 devs)"

    **Menos de 10 serviços? Comece aqui.**

    ``` mermaid-sim
    flowchart TD
        A{"Precisa rodar na AWS?<br/>(créditos, compliance)"}
        A -->|Não| B{"Usuários espalhados por<br/>vários continentes?"}
        B -->|Não| C["Railway / Render<br/>(git push → URL)"]
        B -->|Sim| D["Fly.io<br/>(máquinas multirregião)"]
        A -->|Sim| E{"Uma VM ou poucos<br/>containers bastam?"}
        E -->|Sim| F["Lightsail<br/>(preço mensal fixo)"]
        E -->|Não| G["ECS Express Mode<br/>(Fargate + ALB)"]
    ```

    **Recomendação principal:** Railway ou Render para colocar no ar o mais rápido possível — conecte um repositório do GitHub e você tem uma URL no ar em minutos. Na AWS, Lightsail quando uma conta fixa e previsível é o que mais importa; ECS Express Mode quando você quer uma plataforma de containers gerenciada que possa crescer depois para o ECS completo sem migração.

    !!! danger "EKS nesta escala"
        Só o control plane do EKS custa **US$ 0,10/hora ≈ US$ 73/mês**[^1]. Some um node group mínimo (2 × `t3.medium` ≈ US$ 61/mês), um balanceador de carga e um banco de dados, e você está gastando cerca de **US$ 180/mês** antes de qualquer tráfego — várias vezes a conta inteira nas plataformas mais simples (veja a [seção 5](#5-cost-comparison)). Para um time de produto pequeno, o Kubernetes aqui não é uma opção — é um passivo.

=== "Médio (5–20 devs)"

    **10–50 serviços. Você precisa de infraestrutura de nível de produção, mas provavelmente não de um time completo de engenharia de plataforma.**

    ``` mermaid-sim
    flowchart TD
        A{"Há um engenheiro de ops /<br/>plataforma dedicado?"}
        B["ECS Fargate + ALB + RDS<br/>(containers serverless, sem nós)"]
        C["EKS (managed node groups)<br/>ou ECS com mais controle"]

        A -->|Não| B
        A -->|Sim| C
    ```

    **Por que ECS Fargate para times médios:** não há nós EC2 para aplicar patches, e há integração nativa com AWS IAM, Secrets Manager, ECR e descoberta de serviços (Cloud Map / Service Connect). Você perde o ecossistema Kubernetes, mas evita a taxa fixa do control plane e a operação dos nós, o que torna o dia a dia muito mais simples.

    !!! note "O Fargate não escala para zero sozinho"
        Um serviço ECS mantém seu `desiredCount` de tasks rodando e sendo cobradas 24/7. O auto scaling ajusta essa contagem entre um mínimo e um máximo; chegar a zero exige que você mesmo defina o mínimo (ou um agendamento) como 0, e a próxima requisição fica então sem nenhuma task para atendê-la.

    | | ECS Fargate | EKS |
    |---|---|---|
    | Gerenciamento de nós | Nenhum (serverless) | Você gerencia os node groups (ou paga pelo Auto Mode) |
    | Curva de aprendizado | Baixa (task definitions) | Alta (API completa do K8s) |
    | Ecossistema (Helm, CRDs) | Limitado | Completo |
    | Custo fixo antes de qualquer workload | Nenhum — paga por task | ~US$ 73/mês de control plane por cluster |
    | Portabilidade multicloud | Só AWS | Portável (API padrão do K8s) |
    | GitOps (ArgoCD, Flux) | Limitado | De primeira classe |

=== "Grande (20+ devs)"

    **50+ serviços. O EKS é a resposta certa — agora o custo operacional se justifica.**

    Nesta escala, você precisa de:

    - **Managed node groups** (ou Karpenter para autoscaling com bin-packing)
    - **ArgoCD** para GitOps — estado declarativo do cluster a partir do Git
    - **AWS Load Balancer Controller** — provisiona ALB/NLB a partir de recursos Ingress do Kubernetes
    - **external-secrets-operator** — sincroniza segredos do Vault ou do AWS Secrets Manager em Secrets do Kubernetes
    - **Clusters separados por ambiente** — dev, staging e prod, cada um com seu próprio cluster EKS

    | Add-on | Finalidade |
    |---|---|
    | **Karpenter** | Autoscaling de nós — provisiona exatamente os tipos de instância certos para os pods pendentes |
    | **ArgoCD** | GitOps — estado declarativo do cluster reconciliado a partir do Git |
    | **AWS Load Balancer Controller** | Provisiona ALB/NLB a partir de recursos Ingress do Kubernetes |
    | **External Secrets Operator** | Sincroniza segredos do Vault/Secrets Manager em Secrets do Kubernetes |
    | **Metrics Server** | Habilita o HPA (Horizontal Pod Autoscaler) |
    | **Cluster Autoscaler** | Alternativa ao Karpenter para escalonar nós |

    !!! tip "EKS Auto Mode"
        Desde dezembro de 2024, o **EKS Auto Mode** permite que a AWS gerencie também os worker nodes (provisionamento baseado no Karpenter, patches do SO), junto com add-ons essenciais como balanceamento de carga e armazenamento em bloco, por uma taxa de gerenciamento além do preço do EC2[^1][^9]. Ele reduz o trabalho com nós desta lista, não a necessidade de entender Kubernetes.

!!! info "Então por que o projeto da disciplina usa EKS?"
    O [projeto](../../exercises/project/index.md) faz o deploy da loja no [EKS](../../exercises/project/eks/index.md) com um time de 2–3 pessoas — exatamente o que esta aula desaconselha a uma *startup*. O objetivo é outro: o projeto existe para **aprender** Kubernetes e AWS, não para minimizar custo ou time-to-market. Mantenha o cluster pequeno, apague-o quando não estiver usando e use a atividade de [Custos](../../exercises/project/costs/index.md) para comparar a conta dele com as alternativas da seção 5.

---

## 3. As plataformas em detalhe

### AWS Lightsail Containers

O Lightsail embrulha containers em uma abstração que lembra o Heroku: envie uma imagem, defina variáveis de ambiente, escolha um tamanho de nó (*power*) e uma quantidade de nós (*scale*) e receba um endpoint HTTPS público. Não há VPCs, security groups nem políticas IAM para configurar, e o **preço mensal é fixo** por nó[^4].

```termynal
$ aws lightsail create-container-service --service-name my-api \
    --power small --scale 1
$ aws lightsail create-container-service-deployment \
    --service-name my-api \
    --containers '{"my-api":{"image":"my-registry/my-api:latest","ports":{"8080":"HTTP"}}}' \
    --public-endpoint '{"containerName":"my-api","containerPort":8080}'
```

A imagem precisa vir de um registry **público** (por exemplo, o Docker Hub) ou ser enviada ao registry do próprio serviço com `aws lightsail push-container-image`; o Lightsail passa então a se referir a ela como `:my-api.<label>.<version>`.

!!! warning "Limitações de rede do Lightsail"
    O Lightsail não usa a rede VPC padrão da AWS. Cada container service tem **um** endpoint público e um domínio privado, `<service-name>.service.local`, acessível apenas a partir de outros recursos do Lightsail na mesma Region — assim, o gateway da loja pode ser público enquanto account e order são acessados como `account.service.local:8080`. Alcançar uma instância **RDS** em uma VPC normal exige **Lightsail VPC peering** com a VPC padrão da conta — um passo extra de configuração que muitos tutoriais pulam. Não há security groups, service mesh nem políticas de rede granulares.

---

### Amazon ECS Express Mode (sucessor do App Runner)

O ECS Express Mode (lançado em novembro de 2025[^3]) mantém a simplicidade do App Runner — "entra uma imagem, sai uma URL HTTPS" —, mas tudo o que ele cria é um recurso ECS comum **na sua própria conta**. Com uma única chamada, você fornece uma imagem de container e duas roles IAM; o ECS provisiona um serviço Fargate, um Application Load Balancer com HTTPS, auto scaling, security groups e uma URL padrão[^2]. Não há cobrança extra pelo Express Mode — você paga pelas tasks Fargate, pelo balanceador de carga e pelos demais recursos subjacentes.

```bash
aws ecs create-express-gateway-service \
    --service-name order-service \
    --execution-role-arn arn:aws:iam::123456789012:role/ecsTaskExecutionRole \
    --infrastructure-role-arn arn:aws:iam::123456789012:role/ecsInfrastructureRoleForExpressServices \
    --primary-container '{
        "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/order:1.0",
        "containerPort": 8080,
        "environment": [{"name": "SPRING_PROFILES_ACTIVE", "value": "prod"}]
    }' \
    --health-check-path "/actuator/health" \
    --scaling-target '{"minTaskCount":1,"maxTaskCount":4}'
```

- **Só imagem.** Ao contrário do App Runner, o Express Mode não faz build a partir do código-fonte: seu CI precisa construir a imagem e enviá-la ao ECR — exatamente o que o pipeline Jenkins do [Hands-on 4](../../hands-on/4/index.md) faz.
- **Balanceador de carga compartilhado.** Vários serviços Express (até 25) podem compartilhar um ALB, com roteamento baseado em regras mantendo-os isolados[^3] — útil para a loja, que tem vários serviços pequenos.
- **Sem beco sem saída.** Como o ALB, os target groups e as task definitions ficam visíveis na sua conta, "se formar" para o ECS Fargate completo significa editar esses recursos, não migrar.

!!! warning "Acessando o RDS"
    As tasks rodam em subnets da **sua** VPC, então alcançar uma instância RDS é questão de regras de security group (liberar o security group da task na porta 5432) — sem conector especial. O App Runner, ao contrário, rodava em uma VPC gerenciada pela AWS e precisava de um *VPC Connector* para alcançar recursos privados.

---

### Railway

O Railway oferece a experiência de desenvolvedor mais simples do ecossistema: conecte um repositório do GitHub, e o Railway detecta a linguagem e o framework, faz o build e o deploy automaticamente. A cobrança é por uso (por vCPU e GB de memória efetivamente usados, por segundo), além de uma pequena taxa mensal de plano que conta como crédito de uso[^6].

O que o Railway oferece de fábrica:

- HTTPS automático com domínios personalizados
- Postgres, Redis e MongoDB integrados como serviços add-on
- Deploy a cada push — sem precisar de pipeline de CI/CD no início
- Rede privada entre os serviços do mesmo projeto (`<service>.railway.internal`), de modo que só o gateway precisa de um domínio público
- Dashboard com logs, métricas e gerenciamento de variáveis de ambiente

!!! warning "Trade-offs do Railway em escala"
    O Railway dá muito pouco controle sobre a rede — você não pode projetar VPCs, subnets nem equivalentes a security groups, apenas escolher quais serviços recebem um domínio público. Também não há ecossistema Kubernetes (nada de Helm, CRDs ou ferramentas de GitOps). O vendor lock-in vira um risco real quando você passa de 10–15 serviços e tem requisitos complexos de rede entre serviços.

---

### Fly.io

O Fly.io roda containers como VMs leves (*Machines*) em servidores em regiões ao redor do mundo, perto dos seus usuários. Um arquivo de configuração `fly.toml` define a aplicação; `fly deploy` faz o build e o deploy[^7].

```toml
app = "my-order-service"
primary_region = "gru"  # São Paulo

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true

[env]
  SPRING_PROFILES_ACTIVE = "prod"
```

**Ponto forte:** o Fly.io coloca seus containers em regiões próximas dos seus usuários. Um usuário em São Paulo alcança `gru` em poucos milissegundos, contra mais de 100 ms de ida e volta até uma região US East. Adicionar regiões é um único comando — `fly scale count 3 --region gru,iad,lhr` — e o roteamento Anycast do Fly envia cada usuário para a Machine mais próxima. Apps da mesma organização conversam por uma rede privada (`<app>.internal`).

**Ponto fraco:** serviços com estado são mais complexos do que na AWS. O *Fly Postgres* clássico é uma app que você mesmo opera (backups, failover, upgrades); o mais recente **Managed Postgres** elimina esse trabalho, mas começa em um preço fixo maior que o processamento de uma app pequena[^7]. Não há free tier para novas organizações, apenas um curto período de teste.

---

## 4. Alternativas de Kubernetes para orquestração

Se você quer os recursos do Kubernetes, mas não o custo nem a complexidade do EKS, vale conhecer estas distribuições. Todas expõem a mesma API do Kubernetes, então os manifestos do [Hands-on 5](../../hands-on/5/index.md) rodam sem alterações:

**Minikube** — Roda o Kubernetes upstream em uma VM ou container no seu laptop, com um único nó por padrão e add-ons (ingress, dashboard, metrics-server). É o ambiente do [Hands-on 5](../../hands-on/5/index.md) e do [exercício de MiniKube](../../exercises/minikube/index.md) — feito para aprendizado e desenvolvimento local, não para produção.

**K3s** — Kubernetes leve e certificado pela CNCF (um único binário com menos de 100 MB), criado originalmente pela Rancher, hoje SUSE[^8]. Implementa a mesma API do Kubernetes upstream, usa SQLite em vez de etcd por padrão em um único servidor (etcd embutido para HA) e já vem com o Traefik como ingress. Ideal para deploys on-premises, dispositivos de borda e pequenos clusters de produção em uma ou poucas VMs.

**K0s** — Kubernetes "zero-friction" da Mirantis. Um único binário sem dependências no host além do kernel; ele empacota e gerencia seus próprios componentes de control plane (etcd, ou kine com SQLite/MySQL/Postgres). Escolha comum para produção on-premises quando se prefere uma distribuição mínima e sem customizações.

**Kind (Kubernetes in Docker)** — Roda cada nó do Kubernetes como um container Docker. Criado para testar o próprio Kubernetes, hoje é a escolha padrão para testes de integração em CI e para validar manifestos antes de enviá-los a um cluster real.

| | Minikube | K3s | K0s | Kind |
|---|---|---|---|---|
| Caso de uso | Dev local | Produção on-prem / borda | Produção on-prem | Testes de CI/CD |
| API completa do K8s | ✓ | ✓ | ✓ | ✓ |
| Nível de produção | ✗ | ✓ | ✓ | ✗ |
| Requisitos de recursos | Médios | Muito baixos | Muito baixos | Baixos |

!!! warning "Auto-hospedar transfere o trabalho, não só o custo"
    K3s em uma VM de US$ 24 dá a você a API do Kubernetes por uma fração do preço do EKS (seção 5), mas agora o control plane é **seu**: uma única VM é um ponto único de falha, e upgrades, backups do datastore e certificados passam a ser responsabilidade sua.

---

## 5. Comparação de custos { #5-cost-comparison }

Quanto custa rodar os três microsserviços da loja (gateway, account, order) mais um pequeno banco Postgres em cada plataforma? A tabela e o gráfico abaixo são gerados a partir de **um único modelo de custos**: uma lista de preços unitários e, para cada plataforma, uma configuração *low* (baixa) e outra *high* (alta) montadas a partir desses preços. Mude um preço no código e os dois se atualizam juntos.

!!! info "Premissas — leia antes de citar um número"
    - Preços de tabela on-demand **aproximados** em USD, na região americana mais barata (AWS `us-east-1` N. Virginia, Fly.io `iad`), conferidos em **outubro de 2026**[^1][^4][^5][^6][^7]. Preços mudam; confirme na [AWS Pricing Calculator](https://calculator.aws/){:target="_blank"} e na página de cada provedor.
    - Tudo roda **24/7** (730 horas por mês) com tráfego moderado.
    - **Não incluídos:** transferência de dados de saída, armazenamento de logs e métricas, nomes de domínio, impostos, free tiers e créditos.
    - **São Paulo é mais caro.** Os preços de tabela de `sa-east-1` são bem mais altos que os de `us-east-1` na maioria dos serviços, e o Fly.io também cobra mais em `gru`. Use a sua região real ao fazer a estimativa.

```python exec="1" html="1"
# Single source of truth for the cost numbers of this class (table + chart).
# Approximate on-demand list prices in USD, cheapest US region
# (AWS us-east-1, Fly.io iad), checked in October 2026. Re-check before using.
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

H = 730  # hours in a billing month

P = {
    "fargate_vcpu_h": 0.04048, "fargate_gb_h": 0.004445,      # ECS Fargate, Linux/x86
    "alb_h": 0.0225, "alb_lcu_h": 0.008,                       # Application Load Balancer
    "ipv4_h": 0.005, "nat_h": 0.045,                           # public IPv4, NAT gateway
    "rds_micro_h": 0.016, "rds_small_h": 0.032,                # RDS Postgres db.t4g.micro / small
    "rds_gb": 0.115, "ebs_gb": 0.08,                           # storage, per GB-month
    "eks_cluster_h": 0.10,                                     # EKS control plane
    "t3_medium_h": 0.0416, "t3_large_h": 0.0832,               # EC2 worker nodes
    "ls_vm_4gb": 24, "ls_vm_8gb": 44,                          # Lightsail instances
    "ls_ctr_small": 15, "ls_db": 15,                           # Lightsail container node, database
    "rw_vcpu": 20, "rw_gb": 10, "rw_hobby": 5,                 # Railway usage, Hobby plan
    "fly_512": 3.69, "fly_1gb": 6.70, "fly_vol_gb": 0.15,      # Fly.io shared-cpu-1x, volume
    "fly_mpg": 38, "fly_mpg_gb": 0.28,                         # Fly Managed Postgres (Basic)
}

def task(vcpu, gb):          # one always-on Fargate task
    return (vcpu * P["fargate_vcpu_h"] + gb * P["fargate_gb_h"]) * H

def alb():                   # ALB in 2 AZs: hourly + ~1 LCU + 2 public IPv4
    return (P["alb_h"] + P["alb_lcu_h"] + 2 * P["ipv4_h"]) * H

def rds(size, gb=20):
    return P[f"rds_{size}_h"] * H + gb * P["rds_gb"]

def railway(vcpu, gb):       # usage-based; the $5 Hobby fee counts as usage credit
    return max(P["rw_hobby"], vcpu * P["rw_vcpu"] + gb * P["rw_gb"])

# 3 services (gateway, account, order) + 1 small Postgres, running 24/7.
# "low" = smallest sensible sizing; "high" = more headroom and production extras.
PLATFORMS = [
    ("Railway (Hobby)",
     [("3 services + Postgres, ~0.2 vCPU / 1.5 GB used in total", railway(0.2, 1.5))],
     [("3 services + Postgres, ~1 vCPU / 4 GB used in total", railway(1.0, 4.0))]),
    ("Fly.io",
     [("3 machines shared-1x 512 MB", 3 * P["fly_512"]),
      ("self-run Postgres machine + 1 GB volume", P["fly_512"] + P["fly_vol_gb"])],
     [("3 machines shared-1x 1 GB", 3 * P["fly_1gb"]),
      ("Managed Postgres Basic + 10 GB", P["fly_mpg"] + 10 * P["fly_mpg_gb"])]),
    ("Lightsail",
     [("one 4 GB instance running Docker Compose (Postgres in a container)", P["ls_vm_4gb"])],
     [("3 container services (Small)", 3 * P["ls_ctr_small"]),
      ("managed database", P["ls_db"])]),
    ("K3s on one VM",
     [("Lightsail 4 GB instance, Postgres as a pod", P["ls_vm_4gb"])],
     [("Lightsail 8 GB instance", P["ls_vm_8gb"]), ("managed database", P["ls_db"])]),
    ("ECS Fargate\n(or Express Mode)",
     [("3 tasks 0.25 vCPU / 0.5 GB", 3 * task(0.25, 0.5)), ("ALB", alb()),
      ("RDS db.t4g.micro", rds("micro"))],
     [("3 tasks 1 vCPU / 2 GB", 3 * task(1, 2)), ("ALB", alb()),
      ("RDS db.t4g.small", rds("small")), ("NAT gateway", P["nat_h"] * H)]),
    ("EKS",
     [("control plane", P["eks_cluster_h"] * H), ("2 × t3.medium nodes", 2 * P["t3_medium_h"] * H),
      ("EBS 2 × 20 GB", 40 * P["ebs_gb"]), ("ALB", alb()), ("RDS db.t4g.micro", rds("micro"))],
     [("control plane", P["eks_cluster_h"] * H), ("3 × t3.large nodes", 3 * P["t3_large_h"] * H),
      ("EBS 3 × 30 GB", 90 * P["ebs_gb"]), ("ALB", alb()), ("RDS db.t4g.small", rds("small")),
      ("NAT gateway", P["nat_h"] * H)]),
]

def total(items):
    return round(sum(c for _, c in items))

def detail(items):
    return " + ".join(f"{name} (${cost:.0f})" for name, cost in items)

rows = "".join(
    f"<tr><td><strong>{name.replace(chr(10), ' ')}</strong></td>"
    f"<td>${total(low)}</td><td>${total(high)}</td>"
    f"<td>{detail(low)}</td><td>{detail(high)}</td></tr>"
    for name, low, high in PLATFORMS)
print("<table><thead><tr><th>Platform</th><th>Low</th><th>High</th>"
      "<th>Low estimate assumes</th><th>High estimate assumes</th></tr></thead>"
      f"<tbody>{rows}</tbody></table>")

names = [n for n, _, _ in PLATFORMS]
lows = [total(l) for _, l, _ in PLATFORMS]
highs = [total(h) for _, _, h in PLATFORMS]
eks_cp = round(P["eks_cluster_h"] * H)

x = np.arange(len(names))
width = 0.35
fig, ax = plt.subplots(figsize=(11, 5))
b1 = ax.bar(x - width / 2, lows, width, label="Low estimate", color="#4C9BE8")
b2 = ax.bar(x + width / 2, highs, width, label="High estimate", color="#F28E2B")
ax.axhline(y=eks_cp, color="gray", linestyle="--", linewidth=0.8)
ax.text(1.6, eks_cp + 6, f"EKS control plane alone (${eks_cp})", fontsize=8, color="gray")
for bar in list(b1) + list(b2):
    ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 3,
            f"${bar.get_height():.0f}", ha="center", va="bottom", fontsize=8, color="gray")
ax.set_ylabel("USD per month (approx.)", color="gray")
ax.set_title("Estimated monthly cost: 3 services + Postgres, 24/7 (us-east-1, Oct 2026 list prices)",
             fontweight="bold", color="gray")
ax.set_xticks(x)
ax.set_xticklabels(names, fontsize=9, color="gray")
ax.tick_params(colors="gray")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, labelcolor="gray")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

### Lendo a estimativa: para onde vai o dinheiro

Olhe para as colunas de premissas (*assumes*) em vez dos totais. Nesta escala, a conta é dominada por **custos fixos** que existem mesmo com tráfego zero:

| Item | Aprox. por mês | Por que aparece |
|---|---|---|
| Control plane do EKS | US$ 73 por cluster | US$ 0,10/hora pelo API server, scheduler e etcd gerenciados[^1] |
| Application Load Balancer | ~US$ 30 | Taxa por hora + unidades de capacidade + seus endereços IPv4 públicos |
| NAT gateway | ~US$ 33 + dados | Permite que tasks ou nós em subnets **privadas** alcancem a internet (ECR, APIs externas) |
| Endereço IPv4 público | ~US$ 3,65 cada | A AWS cobra todo endereço IPv4 público desde fevereiro de 2024[^10] |
| Menor instância RDS | ~US$ 14 | `db.t4g.micro` + 20 GB de armazenamento, single-AZ (Multi-AZ dobra o valor) |

O processamento de três pequenos serviços Spring Boot costuma ser a *menor* linha. É por isso que uma plataforma com taxa fixa de control plane perde com três serviços e ganha com cinquenta: o custo fixo é dividido entre mais workloads. É também por isso que "um cluster EKS por ambiente" (dev, staging, prod) triplica a parte fixa da conta.

!!! tip "Proteja sua conta AWS"
    Crie um **AWS Budget** com alerta por e-mail antes de criar um cluster, marque cada recurso com uma tag com o nome do projeto e apague NAT gateways, balanceadores de carga e clusters quando parar de trabalhar — eles são cobrados por hora, usados ou não. A atividade de [Custos](../../exercises/project/costs/index.md) do projeto pede exatamente esta análise.

---

## 6. Exemplo: a loja em cada estágio

Os mesmos quatro componentes, implantados nas três plataformas do caminho de migração abaixo:

| Componente da loja | Dia 1 — Railway | Ano 1 — ECS Fargate | Ano 2+ — EKS |
|---|---|---|---|
| **gateway** | Serviço com domínio público | Serviço ECS atrás do ALB (o Express Mode o cria) | Deployment + Service, exposto por um Ingress (AWS Load Balancer Controller) |
| **account, order** | Serviços na rede privada (`account.railway.internal`) | Serviços ECS descobertos via Service Connect / Cloud Map | Deployments + Services `ClusterIP` (como no [Hands-on 5](../../hands-on/5/index.md)) |
| **Postgres** | Add-on Postgres do Railway | RDS, acessado por regras de security group | RDS, credenciais sincronizadas pelo External Secrets |
| **Deploy** | `git push` para `main` | CI faz o build da imagem → ECR → nova task definition | CI faz o build da imagem → ECR → ArgoCD sincroniza os manifestos a partir do Git |

O código da aplicação não muda entre as três colunas: o estilo 12-factor (configuração em variáveis de ambiente, serviços stateless, estado no Postgres) é o que faz de cada migração um exercício de deploy, e não uma reescrita.

---

## 7. Caminho de migração

!!! tip "A resposta certa muda à medida que você cresce"
    Comece simples e migre de forma deliberada. Cada migração deve ser motivada por um **problema concreto**, não por especulação sobre a escala futura. Uma app funcionando no Railway vale mais do que um cluster EKS perfeitamente arquitetado e sem usuários.

``` mermaid-sim
flowchart TD
    start(["Ideia / Protótipo"])
    r["Railway / Fly.io<br/>(Dia 1 — lançar rápido)"]
    ex["ECS Express Mode<br/>(Mês 3 — nativo da AWS, stateless)"]
    ecs["ECS Fargate, controle total<br/>(Ano 1 — produção)"]
    eks["AWS EKS<br/>(Ano 2+ — escala, time cresce)"]

    start --> r
    r -->|"Precisa de serviços AWS<br/>ou compliance"| ex
    ex -->|"Precisa de sidecars, serviços<br/>privados, controle fino"| ecs
    ecs -->|"Vários times, 50+ serviços,<br/>GitOps obrigatório"| eks

    style r fill:#4CAF50,color:#fff
    style ex fill:#FF9800,color:#fff
    style ecs fill:#FF5722,color:#fff
    style eks fill:#F44336,color:#fff
```

Observe que o passo do Express Mode para o ECS Fargate "completo" nem é uma migração: o Express Mode *é* ECS, então você simplesmente passa a editar as task definitions, as regras do balanceador de carga e a rede que ele criou.

!!! warning "Evite a otimização prematura"
    O custo de migrar do Railway para o ECS com 20 serviços é de algumas semanas de trabalho de engenharia focado. O custo de operar EKS em uma startup de 3 pessoas por um ano é de 40+ horas de trabalho de operação de plataforma que não entregam nenhuma funcionalidade ao usuário. Comece simples. Migre quando o problema for real, mensurável e não houver solução mais barata.

!!! warning "Outras armadilhas comuns"
    - **Recursos esquecidos.** Um cluster EKS de teste, um NAT gateway ou um balanceador de carga ligado durante um feriado é a clássica conta-surpresa de aluno. Configure um alerta de orçamento primeiro.
    - **Passos de rede escondidos.** O Lightsail precisa de VPC peering para alcançar o RDS; no ECS e no EKS, uma regra de security group faltando aparece como um "connection timed out" no serviço.
    - **Citar preços sem premissas.** Um número de custo sem região, data, dimensionamento e horas por mês não pode ser comparado nem conferido.
    - **Apostar em um único produto gerenciado.** O fechamento do App Runner para novos clientes mostra que as plataformas mais simples podem mudar debaixo de você; mantenha a aplicação portável (containers, variáveis de ambiente, Postgres).

---

## Pontos-chave

- Kubernetes não é o padrão: escolha a plataforma por **tamanho do time, quantidade de serviços e maturidade operacional**.
- Há dois caminhos: **experiência do desenvolvedor** (Railway/Render → Fly.io → Lightsail) e **nativo da AWS** (ECS Express Mode → ECS Fargate → EKS → EC2 puro), cada um trocando simplicidade por controle.
- Em pequena escala, **custos fixos** (control plane do EKS ~US$ 73, ALB ~US$ 30, NAT ~US$ 33) dominam a conta; apresente toda estimativa com região, data e dimensionamento.
- Times pequenos: Railway, Render, Fly.io, Lightsail ou ECS Express Mode. Times médios: **ECS Fargate**. Times grandes: **EKS** com Karpenter/Auto Mode, ArgoCD, o Load Balancer Controller e o External Secrets.
- K3s, K0s, Kind e Minikube dão a API do Kubernetes sem o EKS — e entregam a você a operação do control plane.
- Migre por **problema concreto**, mantenha a aplicação portável e nunca suponha que um produto gerenciado vai existir para sempre (App Runner).

## Conexões

- [Modelos de serviço](../service_models/index.md) — o vocabulário IaaS / PaaS / CaaS usado aqui.
- [Containerização](../containerization/index.md) — as imagens que todas as plataformas desta aula implantam.
- [Hands-on 4 — DevOps](../../hands-on/4/index.md) — o pipeline que faz o build e envia as imagens.
- [Hands-on 5 — Orquestração](../../hands-on/5/index.md) e o [exercício de MiniKube](../../exercises/minikube/index.md) — a API do Kubernetes que EKS, K3s e Kind expõem.
- [Confiabilidade](../reliability/index.md) — o que você perde quando a loja inteira roda em uma única VM.
- Projeto: [AWS](../../exercises/project/aws/index.md), [EKS](../../exercises/project/eks/index.md) e [Custos e PaaS](../../exercises/project/costs/index.md).


[^1]: [Amazon EKS pricing](https://aws.amazon.com/eks/pricing/){:target="_blank"} — US$ 0,10 por cluster por hora com suporte padrão de versão do Kubernetes (US$ 0,60 com suporte estendido); o Auto Mode acrescenta uma taxa de gerenciamento por instância.
[^2]: [AWS App Runner availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html){:target="_blank"} — fechamento para novos clientes e guia de migração para o ECS Express Mode.
[^3]: [Announcing Amazon ECS Express Mode](https://aws.amazon.com/about-aws/whats-new/2025/11/announcing-amazon-ecs-express-mode/){:target="_blank"}, AWS What's New, novembro de 2025.
[^4]: [Amazon Lightsail pricing](https://aws.amazon.com/lightsail/pricing/){:target="_blank"} e [Lightsail container services](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-container-services.html){:target="_blank"}.
[^5]: [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/){:target="_blank"}
[^6]: [Railway pricing](https://railway.com/pricing){:target="_blank"}
[^7]: [Fly.io resource pricing](https://fly.io/docs/about/pricing/){:target="_blank"}
[^8]: [K3s documentation](https://docs.k3s.io/){:target="_blank"}
[^9]: [Amazon EKS Auto Mode](https://docs.aws.amazon.com/eks/latest/userguide/automode.html){:target="_blank"}
[^10]: [New — AWS Public IPv4 Address Charge](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/){:target="_blank"}, AWS News Blog, 2023.
