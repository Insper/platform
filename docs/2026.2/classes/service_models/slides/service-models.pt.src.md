---
marp: true
lang: pt-BR
title: Modelos de Serviço
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

# Modelos de Serviço

**Quanto da pilha o provedor gerencia — e quanto fica com você?**

<!--
Objetivos: explicar a definição do NIST e CapEx vs OpEx; mapear cada modelo na pilha de responsabilidade;
comparar os modelos; escolher um modelo por componente da loja; dizer o que nunca passa para o provedor.
Roteiro: (1) o que torna um serviço nuvem; (2) a pilha de responsabilidade compartilhada; (3) IaaS, PaaS, SaaS;
(4) FaaS, CaaS, DBaaS e outros; (5) a loja, componente por componente; (6) comparação, framework de decisão, armadilhas.
-->

---

## Quem aplica os patches do SO?

<div class="q">

Você precisa rodar a API da loja na nuvem. Quem instala o JDK, atualiza o SO e escala os servidores —
**você ou o provedor**?

</div>

* Depende do **modelo de serviço** que você contrata.
* Quanto mais o provedor gerencia, **menos controle** você tem…
* …e **mais rápido** você avança.

<!--
Deixe a turma responder primeiro. O trade-off controle × velocidade é o fio condutor da aula inteira.
-->

---

## O que torna um serviço "nuvem"? (NIST SP 800-145)

| Característica | Na loja |
|---|---|
| **Autoatendimento sob demanda** | `aws rds create-db-instance` — sem falar com ninguém |
| **Amplo acesso pela rede** | endpoints HTTPS, `kubectl` pela rede |
| **Agrupamento de recursos** | o serviço order divide hosts com outros tenants |
| **Elasticidade rápida** | Black Friday: 2 → 20 réplicas, e depois volta |
| **Serviço medido** | cobrança por vCPU-hora, GB-mês, requisição |

<p class="small"><strong>CapEx → OpEx</strong>: sem comprar servidores antes, dimensionados para o pico esperado; paga-se por mês pelo uso — flexível, mas não necessariamente mais barato. Modelos de implantação: pública, privada, híbrida, comunitária.</p>

---

## A pilha de responsabilidade compartilhada

Todo modelo se mapeia nas mesmas seis camadas. A linha entre **provedor** e **cliente** vai subindo.

| Camada | On-premises | IaaS | PaaS | SaaS |
|---|---|---|---|---|
| Dados | você | você | você | provedor |
| Aplicação | você | você | você | provedor |
| Middleware | você | você | provedor | provedor |
| SO | você | você | provedor | provedor |
| Virtualização | você | provedor | provedor | provedor |
| Hardware | você | provedor | provedor | provedor |

<p class="small">IaaS, PaaS e SaaS são os três modelos fundamentais definidos pelo NIST. A segurança se divide do mesmo jeito: o provedor protege a nuvem; você protege o que coloca <em>nela</em>.</p>

---

## IaaS — Infraestrutura como Serviço

**Você aluga infraestrutura bruta**: computação, armazenamento e rede virtualizados.

<div class="cols">
<div>

### Você gerencia

- SO: instalação, patches, hardening
- Runtime e middleware
- Código da aplicação e dados
- Regras de firewall, IAM, backups

</div>
<div>

### Escolha para

- Controle total do SO (kernel customizado)
- **Lift-and-shift** de workloads on-premises
- HPC com instâncias com GPU
- Conformidade sobre a pilha inteira

</div>
</div>

<p class="small">AWS EC2, Google Compute Engine, Azure VMs, DigitalOcean Droplets. Lift-and-shift = levar a app para VMs como está. Fluxo típico: provisionar uma <code>t3.medium</code>, SSH, instalar o JDK, configurar o nginx, backups no cron, patches no SO.</p>

---

## PaaS — Plataforma como Serviço

**Você faz o deploy do código; o provedor o executa** — SO, runtime, escala, balanceamento de carga, pipelines de build.

1. `git push heroku main` (ou conecte um repositório do GitHub).
2. **Buildpacks** detectam o runtime (Java, Node, Python).
3. O provedor faz o build, containeriza e faz o deploy.
4. Anexe um add-on de **Postgres gerenciado** — sem servidor de banco para manter.

<div class="ok">

O PaaS favorece o **12-factor app**: processos stateless, config em variáveis de ambiente, logs no stdout. O disco local é **efêmero** — o estado fica em serviços gerenciados externos.

</div>

<p class="small">Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.</p>

---

## SaaS — Software como Serviço

**Você usa o software; o provedor opera tudo.**

- Você gerencia só **usuários, permissões** e os **dados** que insere — além de integrações via APIs/webhooks.
- **Multi-tenancy**: uma instância da aplicação atende todos os clientes, com dados isolados por **tenant ID**.
- Economia de escala → o **menor tempo até gerar valor**.
- Escolha quando um software pronto já atende a necessidade (CRM, RH, e-mail, monitoramento).

<p class="small">Google Workspace, Salesforce, Slack, Notion, GitHub, Datadog, PagerDuty.</p>

---

## FaaS — Função como Serviço (serverless)

O extremo do PaaS: você faz o deploy de **funções**, não de aplicações.

| | |
|---|---|
| **Unidade de deploy** | uma única função |
| **Escala** | automática, **até zero** quando ociosa |
| **Cobrança** | por invocação + duração (ms) |
| **Restrição** | cold starts; tempo máximo de execução (15 min no Lambda) |
| **Exemplos** | AWS Lambda, Cloud Functions, Azure Functions, Cloudflare Workers |

<div class="warn">

**Cold start**: a primeira requisição a uma função ociosa espera um sandbox e o runtime subirem. Ótimo para webhooks, jobs agendados e cargas em rajadas — **não** para APIs longas ou sensíveis à latência.

</div>

---

## CaaS e DBaaS

<div class="cols">
<div>

### CaaS — Container como Serviço

Entre IaaS e PaaS: você entrega uma **imagem Docker**.

- Você controla tudo **dentro** do container.
- Provedor: agendamento, rede, escala, saúde dos nós.
- AWS ECS / Fargate, Google Cloud Run, Azure Container Instances.

</div>
<div>

### DBaaS — Banco de Dados como Serviço

Um banco gerenciado, acessado por um cliente padrão.

- Você: schema, otimização de consultas, controle de acesso.
- Provedor: replicação, backups, patches do SO, failover.
- AWS RDS, Aurora, Cloud SQL, Azure Database, PlanetScale, Neon.

</div>
</div>

<p class="small">Kubernetes gerenciado (EKS, GKE, AKS) também é CaaS. Cloud Run e Azure Container Apps até <strong>escalam até zero</strong>: "serverless" não é só função.</p>

---

## Outras fatias "como Serviço"

| Modelo | Sigla | Exemplos |
|---|---|---|
| Armazenamento como Serviço | STaaS | AWS S3, Google Cloud Storage, Backblaze B2 |
| IA / ML como Serviço | AIaaS | AWS Bedrock, Google Vertex AI, Azure AI |
| Monitoramento como Serviço | — | Datadog, New Relic, Grafana Cloud |
| Segurança como Serviço | SECaaS | Cloudflare, AWS Shield, Snyk |
| Comunicação como Serviço | CPaaS | Twilio, SendGrid, AWS SES |

<div class="ok">

Cada modelo especializado recorta uma **fatia mais estreita da pilha** e a entrega ao provedor.

</div>

---

## A loja, componente por componente

| Componente | Faça você mesmo | Opção gerenciada |
|---|---|---|
| gateway, account, order | Compose numa VM EC2 (IaaS) | EKS / ECS Fargate (CaaS) |
| Postgres | Postgres no EC2 (IaaS) | RDS (DBaaS) |
| Redis · Kafka | containers na VM | ElastiCache · Amazon MSK |
| notificação de pedido | consumer sempre ligado | Lambda no tópico do Kafka (FaaS) |
| CI/CD · monitoramento | Jenkins · Prometheus + Grafana | GitHub Actions · Grafana Cloud (SaaS) |

<div class="ok">

Sistemas reais **misturam** modelos: decida **por componente**. O projeto da disciplina coloca os serviços no EKS.

</div>

---

## Comparação completa

| | On-prem | IaaS | PaaS | CaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **Controle** | máximo | alto | médio | médio | baixo | mínimo |
| **É seu** | tudo | SO e acima | app + dados | container + dados | código + dados | dados + usuários |
| **Lançamento** | lento | lento | rápido | rápido | muito rápido | imediato |
| **Escala** | manual | manual / script | automática | auto (alguns a zero) | até zero | automática |
| **Custo** | CapEx | por VM-hora | por uso | por container-hora | por invocação | por usuário/licença |
| **Portabilidade** | total | alta | média | alta (imagem) | baixa (API do fornecedor) | baixa (export de dados) |

<!--
Leia a tabela linha por linha: controle e portabilidade caem à medida que o tempo de lançamento melhora.
O FaaS é o ponto fora da curva em portabilidade: o código é escrito contra a API de um fornecedor.
-->

---

## Framework de decisão

1. Precisa de **controle total do SO** ou de lift-and-shift? → **IaaS** (EC2, GCE, Azure VM)
2. Vai fazer deploy de **containers**?
   - quer gerenciar o Kubernetes você mesmo → **CaaS com Kubernetes** (EKS, GKE, AKS)
   - caso contrário → **CaaS gerenciado** (Cloud Run, ECS Fargate)
3. Workload **orientado a eventos / esporádico**? → **FaaS** (Lambda, Cloud Functions)
4. Vai construir uma **aplicação própria**? → **PaaS** (Heroku, App Engine)
5. Nenhuma das anteriores → **SaaS**: use um produto existente.

---

## Trade-offs e armadilhas

> Quanto mais o provedor gerencia, menos controle você tem — e mais rápido você avança.

- **Lock-in**: triggers de FaaS e dados de SaaS são os mais difíceis de migrar; prefira interfaces abertas (containers, Postgres, API do K8s).
- **Nem sempre mais barato**: serviços gerenciados cobram um adicional por unidade — vale a pena até a escala ficar grande e constante.
- **Estado em instâncias de PaaS/FaaS** some num reinício ou redução de escala.
- **FaaS para uma API quente e sensível à latência**: cold starts e preço por chamada pesam.

<div class="warn">

"Gerenciado" nunca significa "sem responsabilidade": um bucket S3 público é um vazamento **seu** — a segurança *na* nuvem é sempre sua.

</div>

---

## Pontos-chave

1. Nuvem = as cinco características do NIST; transforma **CapEx em OpEx**.
2. Um modelo de serviço define **quem gerencia cada camada** da pilha de seis camadas.
3. **IaaS** aluga infraestrutura; **PaaS** executa seu código (12-factor); **SaaS** é software que você só configura.
4. **CaaS** entrega imagens, **FaaS** entrega funções (escala a zero, cold starts), **DBaaS** opera o banco.
5. Mais gerenciado = **mais rápido** e **menos controle / portabilidade**.
6. Escolha **por componente**: a loja mistura CaaS, DBaaS, FaaS e SaaS.
7. Dados, identidades e regras de acesso são **sempre seus**.
