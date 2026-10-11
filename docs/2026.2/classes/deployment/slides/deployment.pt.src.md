---
marp: true
lang: pt-BR
title: Roteiro de deploy na nuvem
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Roteiro de deploy na nuvem

**Escolha a plataforma mais simples que serve ao seu time hoje — e evolua para o próximo nível**

<!--
Objetivos: comparar plataformas pelo que escondem; escolher uma por tamanho de time; estimar um custo mensal a
partir de preços unitários e identificar os custos fixos; planejar uma migração por problema concreto; diagnosticar
armadilhas de rede. Roteiro: (1) dois caminhos; (2) roteiro por tamanho de time; (3) Lightsail, ECS Express Mode,
Railway, Fly.io; (4) Kubernetes leve; (5) modelo de custos; (6) caminho de migração e armadilhas.
-->

---

## Kubernetes para todo mundo?

<div class="q">

Uma startup de 3 pessoas com 3 microsserviços quer "fazer do jeito certo" e ir direto para o **EKS**.
Boa ideia?

</div>

* **Só o control plane** do EKS custa **US$ 0,10/h ≈ US$ 73/mês** — antes de qualquer nó.
* Dois nós `t3.medium` somam **~US$ 61**; com ALB e RDS: **~US$ 180/mês**.
* Operá-lo consome horas de trabalho de plataforma que **não entregam nenhuma funcionalidade** ao usuário.

<!--
O Kubernetes resolve problemas reais em escala. O ponto da aula: a escolha certa depende do tamanho do time,
da quantidade de serviços e da maturidade operacional.
-->

---

## Dois caminhos, não um único eixo

O trade-off é sempre o mesmo: **menos controle, menos carga operacional**.

<div class="cols">
<div>

### Experiência do desenvolvedor

**Railway / Render** → **Fly.io** → **Lightsail**

git push → URL · Dockerfile + regiões · VM simples ou containers.

</div>
<div>

### Nativo da AWS

**ECS Express Mode** → **ECS Fargate** → **EKS** → EC2

imagem → URL HTTPS · task definitions, sem nós · Kubernetes completo · você opera tudo.

</div>
</div>

<div class="ok">

Da esquerda para a direita: **mais controle, mais ops**. Os caminhos atendem a **casos de uso diferentes** — seu contexto escolhe o caminho.

</div>

---

## O panorama

| Plataforma | O que esconde | O que você gerencia | Ideal para |
|---|---|---|---|
| **Railway / Render** | tudo, exceto o código | variáveis de ambiente, domínios | startups, protótipos |
| **Fly.io** | infraestrutura | Dockerfile, regiões | baixa latência global, borda |
| **AWS Lightsail** | hardware, rede | VM: SO, runtime · containers: imagem | 1º deploy, orçamento fixo |
| **ECS Express Mode** | ALB, escala, rede | imagem, variáveis, 2 roles IAM | serviços stateless na AWS |
| **AWS ECS Fargate** | nós EC2 | task definitions, escala, ALB | produção AWS de média escala |
| **AWS EKS** | control plane | node groups, rede, add-ons | times grandes, workloads complexos |
| **K3s auto-hospedado** | nada além da VM | todas as operações do K8s | on-prem, homelab, custo baixo |

<p class="small">O <strong>AWS App Runner</strong> fechou para novos clientes em 30 de abril de 2026; a AWS indica o ECS Express Mode.</p>

---

## Time pequeno: 1–5 devs, < 10 serviços

1. Sem amarra com a AWS, usuários em uma região? → **Railway / Render**: repo → URL no ar em minutos.
2. Sem amarra com a AWS, usuários em vários continentes? → **Fly.io** (máquinas multirregião).
3. Precisa estar na AWS, uma VM / poucos containers bastam? → **Lightsail** (preço fixo).
4. Precisa estar na AWS, quer crescer para o ECS? → **ECS Express Mode** (Fargate + ALB).

<div class="warn">

**EKS nesta escala** (~US$ 180/mês antes de tráfego) custa várias vezes a conta inteira nas outras opções. Não é uma opção — é um passivo.

</div>

<!--
O projeto da disciplina usa EKS mesmo assim: o objetivo dele é aprender Kubernetes, não minimizar custo.
-->

---

## Time médio: 5–20 devs, 10–50 serviços

Sem engenheiro de ops / plataforma dedicado? → **ECS Fargate + ALB + RDS**. Com um → EKS (managed node groups).

| | ECS Fargate | EKS |
|---|---|---|
| Gerenciamento de nós | nenhum (serverless) | você gerencia os node groups |
| Curva de aprendizado | baixa (task definitions) | alta (API completa do K8s) |
| Ecossistema (Helm, CRDs) | limitado | completo |
| Custo fixo sem workload | nenhum (paga por task) | ~US$ 73/mês por cluster |
| Portabilidade | só AWS | portável |
| GitOps (ArgoCD, Flux) | limitado | de primeira classe |

<p class="small">Fargate: sem nós EC2 para atualizar; IAM, Secrets Manager, ECR e Service Connect nativos. <strong>Não</strong> escala para zero sozinho: as tasks são cobradas 24/7.</p>

---

## Time grande: 20+ devs, 50+ serviços

**Agora o EKS é a resposta certa** — o custo operacional se justifica.

| Add-on | Finalidade |
|---|---|
| **Karpenter** / Cluster Autoscaler | autoscaling de nós, tipos de instância certos para pods pendentes |
| **ArgoCD** | GitOps: estado do cluster reconciliado a partir do Git |
| **AWS Load Balancer Controller** | ALB/NLB a partir de recursos Ingress do Kubernetes |
| **External Secrets Operator** | Vault / Secrets Manager → Secrets do Kubernetes |
| **Metrics Server** | habilita o HPA |

<p class="small">Além de <strong>clusters separados por ambiente</strong> (dev, staging, prod). O <strong>EKS Auto Mode</strong> (dez. 2024) deixa a AWS gerenciar também os nós, mediante taxa.</p>

---

## AWS Lightsail Containers

Lembra o Heroku: envie uma imagem, defina variáveis, escolha um tamanho, receba um **endpoint HTTPS** público.

```bash
aws lightsail create-container-service --service-name my-api \
    --power small --scale 1
aws lightsail create-container-service-deployment \
    --service-name my-api \
    --containers '{"my-api":{"image":"my-registry/my-api:latest",...}}' \
    --public-endpoint '{"containerName":"my-api","containerPort":8080}'
```

<div class="warn">

Fora da rede VPC da AWS: um endpoint público por serviço, os demais via `account.service.local`. Alcançar o **RDS** exige **Lightsail VPC peering**.

</div>

---

## Amazon ECS Express Mode

Sucessor do App Runner: imagem + duas roles IAM → serviço Fargate, **ALB com HTTPS**, auto scaling, URL.

```bash
aws ecs create-express-gateway-service \
    --service-name order-service \
    --execution-role-arn arn:aws:iam::123456789012:role/ecsTaskExecutionRole \
    --infrastructure-role-arn arn:aws:iam::123456789012:role/ecsInfrastructureRoleForExpressServices \
    --primary-container '{"image":"<ecr-repo>/order:1.0","containerPort":8080}' \
    --health-check-path "/actuator/health"
```

- **Só imagem**: o CI faz o build e envia ao ECR (Hands-on 4). Sem taxa extra: você paga Fargate + ALB.
- Tudo é ECS comum **na sua conta**: "se formar" para o ECS completo é editar, não migrar.

<div class="warn">

As tasks rodam na **sua VPC**: alcançar o RDS é uma regra de security group (porta 5432) — sem VPC Connector.

</div>

---

## Railway e Fly.io

<div class="cols">
<div>

### Railway

- Detecta a linguagem, faz build e deploy **a cada push**
- HTTPS automático, domínios próprios
- Add-ons de Postgres, Redis, MongoDB
- Logs, métricas e variáveis em um dashboard

- Rede privada: `account.railway.internal`

<p class="small">Sem projeto de VPC, sem Helm/CRDs/GitOps — o lock-in cresce além de 10–15 serviços.</p>

</div>
<div>

### Fly.io

Containers como **Machines** em regiões perto dos usuários; `fly.toml` + `fly deploy`.

```toml
app = "my-order-service"
primary_region = "gru"  # São Paulo
```

`gru`: poucos ms para São Paulo vs 100+ ms até US East.
`fly scale count 3 --region gru,iad,lhr`

<p class="small">O Fly Postgres clássico é você quem opera; o Managed Postgres custa mais. Sem free tier.</p>

</div>
</div>

---

## Kubernetes sem EKS

| | Minikube | K3s | K0s | Kind |
|---|---|---|---|---|
| Caso de uso | dev local | produção on-prem / borda | produção on-prem | testes de CI/CD |
| API completa do K8s | ✓ | ✓ | ✓ | ✓ |
| Nível de produção | ✗ | ✓ | ✓ | ✗ |
| Recursos | médios | muito baixos | muito baixos | baixos |

- **Minikube**: K8s upstream no seu laptop — o ambiente do Hands-on 5.
- **K3s** (Rancher/SUSE): binário < 100 MB, SQLite por padrão; **K0s** (Mirantis): zero dependências no host.
- **Kind**: nós como containers Docker — teste manifestos no CI antes de um cluster real.

<p class="small">Os mesmos manifestos em todos — mas auto-hospedar faz do control plane responsabilidade <strong>sua</strong>.</p>

---

<!-- _class: tight -->

## Quanto custa: a loja em cada plataforma

3 serviços (gateway, account, order) + 1 Postgres pequeno, 24/7. USD/mês **aproximados**, preços `us-east-1`, out. 2026:

| Plataforma | Baixo | Alto |
|---|---|---|
| Railway (Hobby) | 19 | 60 |
| Fly.io | 15 | 61 |
| Lightsail | 24 | 60 |
| K3s em uma VM | 24 | 59 |
| ECS Fargate / Express Mode | 71 | 196 |
| EKS | 180 | 350 |

<p class="small">Um único modelo de custos na página da aula gera a tabela e o gráfico. Sem transferência de dados, logs, impostos ou free tiers; São Paulo é mais caro.</p>

---

## Para onde vai o dinheiro

Em pequena escala, **custos fixos** cobrados por hora dominam — mesmo com tráfego zero:

| Item | ≈ por mês |
|---|---|
| Control plane do EKS | US$ 73 por cluster |
| Application Load Balancer (+ seus IPv4) | US$ 30 |
| NAT gateway (subnets privadas) | US$ 33 + dados |
| Endereço IPv4 público | US$ 3,65 cada |
| Menor RDS (`db.t4g.micro` + 20 GB) | US$ 14 |

<div class="ok">

Três pequenas tasks Fargate custam **~US$ 27**: o processamento costuma ser a *menor* linha. Taxas fixas compensam com 50 serviços, não com 3.

</div>

---

## Caminho de migração

1. **Dia 1** — Railway / Fly.io: lançar rápido.
2. **Mês 3** — ECS Express Mode: precisa de serviços AWS ou compliance.
3. **Ano 1** — ECS Fargate, controle total: sidecars, serviços privados (o mesmo ECS, editado).
4. **Ano 2+** — AWS EKS: vários times, 50+ serviços, GitOps obrigatório.

<div class="ok">

Cada migração é motivada por um **problema concreto**, não por especulação sobre a escala futura.

</div>

> Uma app funcionando no Railway vale mais do que um cluster EKS perfeito sem usuários.

---

## Evite a otimização prematura

<div class="warn">

Migrar Railway → ECS com 20 serviços: **algumas semanas** de trabalho focado.
Operar EKS numa startup de 3 pessoas por um ano: **40+ horas** de ops de plataforma sem nenhuma funcionalidade.

</div>

- Comece simples; migre quando o problema for **real, mensurável** e não houver solução mais barata.
- **Recursos esquecidos**: cluster, NAT ou ALB ligados cobram por hora — crie um alerta de orçamento antes.
- **Rede escondida**: VPC peering no Lightsail; regra de security group faltando parece um timeout.
- **Lock-in**: o App Runner fechou para novos clientes — mantenha a app portável (containers, variáveis, Postgres).

---

## Pontos-chave

1. Kubernetes não é o padrão: escolha por **tamanho do time, quantidade de serviços e maturidade de ops**.
2. Dois caminhos: **experiência do dev** (Railway → Fly.io → Lightsail) e **nativo da AWS** (Express → ECS → EKS).
3. Pequeno: **Railway, Render, Fly.io, Lightsail, ECS Express Mode**. Médio: **ECS Fargate**. Grande: **EKS**.
4. **Custos fixos** (control plane US$ 73, ALB US$ 30, NAT US$ 33) dominam contas pequenas — informe região, data e porte.
5. **K3s, K0s, Kind, Minikube** dão a API do K8s sem o EKS — e entregam a você a operação.
6. Migre por **problema concreto**, não por especulação.
7. Mantenha a app **portável**: produtos gerenciados mudam (App Runner).
