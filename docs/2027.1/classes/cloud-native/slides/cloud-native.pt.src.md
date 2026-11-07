---
marp: true
lang: pt-BR
title: Plataformas cloud-native e entrega
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Plataformas cloud-native e entrega

**Onde o código roda, como chega lá, como escala — e quem paga**

<!--
Roteiro: (1) cloud-native e modelos de serviço; (2) containers; (3) Kubernetes; (4) IaC, CI, GitOps,
estratégias de deploy e análise de canary; (5) FinOps e o modelo de custo do BoxOffice.
-->

---

## O BoxOffice sai do notebook

<div class="q">

Nove serviços rodam bem com `docker compose up`. O que muda na manhã em que um show de estádio abre as vendas?

</div>

* **20× o tráfego por 30 minutos**, depois volta ao normal — e ninguém quer pagar por máquinas ociosas.
* Uma correção no `inventory` às 09:55 precisa ir ao ar **sem indisponibilidade** às 10:00.
* Alguém precisa saber **quanto custa** antes de a fatura chegar.
* Nenhum desses é problema da aplicação: são problemas de **plataforma**.

<!--
Deixe a turma listar os problemas antes de revelar. Cada item corresponde a uma parte da aula:
elasticidade (Kubernetes), entrega segura (GitOps + canary), custo (FinOps).
-->

---

## O que "cloud-native" significa

| Ideia | Exemplo no BoxOffice |
|---|---|
| **Artefatos imutáveis** | `inventory:1.8.3` construída uma vez, promovida sem mudanças |
| **Estado desejado declarativo** | "5 réplicas de `catalog`" — um controlador torna isso verdade |
| **Elasticidade** | `catalog` 4 → 40 réplicas durante a venda |
| **Automação de ponta a ponta** | pull request aceito → pipeline → produção |

<div class="warn">

A aplicação precisa cooperar: processos **sem estado**, config vinda do **ambiente**, início rápido e **encerramento gracioso**, logs em `stdout` (twelve-factor).

</div>

---

<!-- _class: tight -->

## Modelos de serviço: quem opera o quê

<p class="small">Infraestrutura, containers, plataforma, funções, software como serviço (IaaS, CaaS, PaaS, FaaS, SaaS, <i>as a service</i>); bancos gerenciados são DBaaS.</p>

<div class="matrix" style="--n: 6">
<div class="head"></div>
<div class="head">On-premises</div>
<div class="head">IaaS</div>
<div class="head">CaaS</div>
<div class="head">PaaS</div>
<div class="head">FaaS</div>
<div class="head">SaaS</div>
<div class="row">Dados e regras de acesso</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="row">Código da aplicação</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="row">Runtime (JVM, Python)</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Orquestração e escala</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Sistema operacional</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box muted">compart.</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Virtualização, hardware</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
</div>

- Sua parte encolhe uma camada por modelo, exceto do PaaS para o FaaS (mesma coluna: uma aplicação ou uma função).
- Em qualquer modelo, **dados, identidades e regras de acesso continuam seus**: um bucket público é erro do cliente.

<!--
A tabela da página, como matriz. A única célula compartilhada é o SO no CaaS: com node groups clássicos o
time troca os nós pela imagem corrigida do provedor; com Fargate ou GKE Autopilot o provedor faz tudo.
-->

---

## Quem age quando algo acontece?

| Evento | Camada | IaaS | CaaS | PaaS / FaaS |
|---|---|---|---|---|
| Falha no JDK | runtime | você | **você** (JDK na sua imagem) | provedor |
| Falha no kernel | SO | você | **compartilhado** (nós) | provedor |
| Abertura 20× | orquestração e escala | você sobe VMs | plataforma, **dentro dos seus limites** | plataforma, dentro dos seus limites |
| Bucket público | dados e acesso | **você** | **você** | **você** (e no SaaS também) |

<div class="ok">

**Simulador na página**: escolha um modelo e um evento e veja qual camada ele atinge e quem age.

</div>

<!--
O simulador responsibility-stack fica sob a tabela da pilha, na visão geral. A abertura atinge uma camada
real desta tabela (orquestração e escala): no CaaS o HPA adiciona pods, mas maxReplicas e o
pré-escalonamento das 09:45 são do time. No on-premises a capacidade precisou ser comprada meses antes (CapEx, FinOps).
-->

---

<!-- _class: tight -->

## Quem oferece cada modelo

| Modelo | AWS | Google Cloud | Microsoft Azure | Outros provedores |
|---|---|---|---|---|
| **IaaS** | EC2 | Compute Engine | Virtual Machines | DigitalOcean, Oracle Cloud, Magalu Cloud |
| **CaaS** | EKS, ECS on Fargate | GKE, Cloud Run | AKS, Container Apps | DigitalOcean Kubernetes, OVHcloud |
| **PaaS** | Elastic Beanstalk | App Engine | App Service | Heroku, Railway, Render, Fly.io |
| **FaaS** | Lambda | Cloud Run functions | Azure Functions | Cloudflare Workers, Vercel |
| **DBaaS** | RDS, Aurora, ElastiCache, MSK | Cloud SQL, AlloyDB, Memorystore | Azure Database, Managed Redis | Neon, Supabase, Aiven |
| **SaaS** | SES (e-mail) | Workspace | Microsoft 365, Dynamics 365 | Stripe, Mercado Pago, Datadog, TOTVS, RD Station |

<div class="ok">

Leia por colunas: a AWS está em todas as linhas — **um modelo descreve um serviço, não uma empresa**.

</div>

<!--
Na AWS, o BoxOffice é uma coluna só: EKS, RDS e ElastiCache, MSK, S3, Lambda. Nada obriga a uma empresa
por sistema: os pagamentos vão para Stripe ou Mercado Pago, o código e o CI para o GitHub.
-->

---

## BoxOffice, componente por componente

<div class="flow" style="align-items: stretch">
<div class="group"><div class="caption">CaaS · Kubernetes gerenciado</div><div class="box accent">gateway · catalog · inventory · order · search</div></div>
<div class="group"><div class="caption">DBaaS · gerenciados</div><div class="box green">PostgreSQL Multi-AZ</div><div class="box green">Redis · Kafka</div></div>
<div class="group"><div class="caption">FaaS</div><div class="box orange">miniaturas · webhooks</div></div>
<div class="group"><div class="caption">SaaS</div><div class="box muted">pagamentos · e-mail</div></div>
</div>

<div class="q">

Por que não rodar tudo em FaaS?

</div>

* **Pools de conexão**: milhares de funções de vida curta esgotariam o PostgreSQL.
* **Cold starts e limites de concorrência** prejudicam justamente no pico das 10:00.
* **Custo com carga constante**: um serviço ocupado 24/7 sai mais barato em containers sempre ligados (equilíbrio da página de FinOps).

<!--
Multi-AZ: um standby em uma segunda zona de disponibilidade. PDFs de ingressos e imagens vão para o object
store (S3), um serviço de armazenamento nível IaaS.
-->

---

## Engenharia de plataforma: caminhos dourados

<div class="flow">
<div class="box">time de produto<small>order, inventory…</small></div><div class="arrow">usa →</div>
<div class="box accent">portal do desenvolvedor<small>ex.: Backstage</small></div><div class="arrow">→</div>
<div class="group"><div class="box">template de serviço<small>Dockerfile · manifests · pipeline</small></div><div class="box">ambientes self-service</div><div class="box">dashboards e alertas embutidos</div></div>
<div class="arrow">→</div>
<div class="box green">plataforma<small>Kubernetes · Argo CD · módulos Terraform · políticas</small></div>
</div>

- Uma **plataforma interna de desenvolvimento (IDP, *internal developer platform*)**, construída como produto por um time de plataforma para os demais times.
- Um caminho dourado é **opcional, mas atraente**: um serviço novo ganha imagem endurecida, probes, pipeline, canary e dashboards no primeiro dia.

<div class="warn">

Trate a plataforma como um produto com usuários — senão ela vira a fila de chamados de novo.

</div>

---

## Containers são processos

<div class="cols">
<div>

### Namespaces — o que ele vê

- PIDs, rede, montagens, hostname próprios
- `catalog` é o PID 1 no próprio mundo

### cgroups — o que ele pode usar

- limites de CPU, memória, I/O
- acima do limite de memória → `OOMKilled`

</div>
<div>

### vs. máquinas virtuais

- um **kernel compartilhado** — inicia em ms, alta densidade
- isolamento mais fraco → nuvens multi-inquilino acrescentam **micro-VMs** (Firecracker, gVisor)

</div>
</div>

<div class="warn">

A máquina virtual Java (JVM, *Java virtual machine*) deve dimensionar o heap pelo limite do **container**: `-XX:MaxRAMPercentage=75`.

</div>

---

<!-- _class: tight -->

## Uma imagem de produção para o `catalog`

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q dependency:go-offline          # cached until pom.xml changes
COPY src ./src
RUN mvn -q package -DskipTests && java -Djarmode=tools -jar target/catalog.jar \
      extract --layers --launcher --destination target/extracted

FROM gcr.io/distroless/java21-debian12:nonroot
COPY --from=build /src/target/extracted/dependencies/ ./
COPY --from=build /src/target/extracted/application/ ./
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
USER nonroot
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Multi-stage · dependências antes do código · distroless · não root · **forma exec** para o `SIGTERM` chegar ao Java.

---

## Encerramento gracioso, passo a passo

<div class="flow">
<div class="box">pod Terminating<small>removido dos endpoints</small></div><div class="arrow">+</div>
<div class="box orange">preStop: dorme 5 s<small>os proxies se atualizam</small></div><div class="arrow">→</div>
<div class="box accent">SIGTERM</div><div class="arrow">→</div>
<div class="box">para de aceitar, termina o que está em andamento<small>até 20 s</small></div><div class="arrow">→</div>
<div class="box green">exit 0</div>
</div>
<div class="flow"><div class="box muted">ainda rodando após o período de graça de 30 s → SIGKILL</div></div>

- Spring Boot: `server.shutdown: graceful` e `timeout-per-shutdown-phase: 20s` — menos que os 30 s do Kubernetes.
- `ENTRYPOINT` na **forma exec**: o Java é o PID 1 e recebe o `SIGTERM` (na forma shell, o `sh` o engole).

<!--
A remoção dos endpoints e o SIGTERM começam no mesmo instante; sem a pausa do preStop alguns proxies ainda
enviam requisições a um pod que já não as aceita. O lab 10 mede isso: 0 requisições com falha com a pausa.
-->

---

## Imagens e a cadeia de suprimentos

- Uma imagem OCI (*Open Container Initiative*) = **manifest** + **config** + **camadas**, todos endereçados por **digest** SHA-256.
- Tags se movem; **digests não** — faça deploy por digest.
- **Varredura** (Trivy) · **SBOM**, lista de materiais do software (*software bill of materials*: Syft, CycloneDX) · **assinatura** (Cosign) · **proveniência** (SLSA, *supply-chain levels for software artifacts*).
- Nunca grave segredos nas camadas: eles ficam no histórico para sempre.

<div class="ok">

Imagens pequenas e em camadas = **escala mais rápida**: cada nó novo precisa baixar a imagem antes de o pod iniciar.

</div>

---

## Kubernetes: o laço de controle

<div class="flow">
<div class="box accent">estado desejado<small>API server + etcd · "4 réplicas"</small></div><div class="arrow">observa →</div>
<div class="box">o controlador compara<small>real: 2 (um nó morreu)</small></div><div class="arrow">→</div>
<div class="box orange">age<small>cria 2 pods</small></div><div class="arrow">→</div>
<div class="box">o scheduler associa<small>um nó com espaço</small></div><div class="arrow">→</div>
<div class="box green">o kubelet inicia, as probes passam<small>real = desejado</small></div>
</div>
<div class="flow"><div class="arrow" style="flex: 1">↺ para sempre, a cada poucos segundos: nada a fazer enquanto real = desejado</div></div>

- Autorrecuperação, rolling updates e autoscaling são todos o **mesmo laço**.
- A API é declarativa e idempotente: aplicar o mesmo manifest duas vezes não muda nada.

<!--
Pergunte: quem reinicia os pods quando um nó perde energia? Resposta: ninguém — o controlador do
ReplicaSet vê 2 em vez de 4 e cria pods; o scheduler encontra espaço.
-->

---

<!-- _class: tight -->

## Os objetos por trás de um serviço

| Objeto | Papel para o `catalog` |
|---|---|
| **Deployment** | 4 pods idênticos; rolling update com `maxUnavailable: 0` |
| **Service** | nome DNS estável `catalog:8080` na frente de pods que mudam |
| **HTTPRoute** (Gateway API) | `/catalog` da internet → Service; backends com peso para canaries |
| **ConfigMap / Secret** | URL do banco / credenciais como variáveis de ambiente |
| **HPA** (autoescalador horizontal de pods) | 4 → 40 réplicas, meta de 60 % da CPU do request |
| **PodDisruptionBudget** | nunca menos de 3 pods durante upgrades de nós |
| **topologySpreadConstraints** | réplicas espalhadas entre zonas de disponibilidade |

---

## Probes respondem a três perguntas diferentes

| Probe | Pergunta | Em caso de falha |
|---|---|---|
| **Startup** | terminou de iniciar? (aquecimento da JVM) | outras desativadas; reinicia após o limiar |
| **Readiness** | devo receber tráfego **agora**? | removido dos endpoints — sem reinício |
| **Liveness** | travou sem conserto? | container reiniciado |

<div class="warn">

Nunca coloque o **banco** na liveness (tempestade de reinícios) — nem na readiness: uma piscada do banco deixa **todos** os pods não prontos de uma vez.

</div>

---

## Requests, limits, throttling

- **Request** = o que o scheduler reserva; a base da porcentagem do HPA.
- **Limite de memória** excedido → `OOMKilled` (um erro).
- **Limite de CPU** excedido → **throttled** (latência, não erros).

<div class="q">

CPU média de 45 %, p99 instável. Por quê?

</div>

* As threads queimam a cota de 100 ms do escalonador CFS (*completely fair scheduler*) no começo de cada período e esperam o resto.
* Verifique `container_cpu_cfs_throttled_periods_total`; mantenha o request de CPU, considere não ter limite de CPU.

---

## Perdendo um nó

<div class="flow">
<div class="box red">um nó morre<small>2 pods do catalog</small></div><div class="arrow">→</div>
<div class="box red">quem chama ainda envia a eles<small>dezenas de segundos</small></div><div class="arrow">→</div>
<div class="box">NotReady, endpoints atualizados</div><div class="arrow">→</div>
<div class="box">pods despejados<small>tolerations: 5 min por padrão</small></div><div class="arrow">→</div>
<div class="group"><div class="box green">há espaço: reagendados</div><div class="box red">cluster lotado: Pending</div></div>
</div>

- A autorrecuperação precisa de **espaço** (N + 1 nós) e de **atualização rápida dos endpoints**.
- Playground `k8s-node-failure` (3 nós lotados): erros ≈ 27% → 25% com espaço → ≈ 4% com endpoints atualizados rápido.

<!--
O diagrama da página toca os mesmos passos. Os erros restantes vêm dos sobreviventes carregando a carga de
6 pods com 4; 8 réplicas levam os erros a cerca de 1,7%.
-->

---

## Autoscaling em três níveis — e seu atraso

- **HPA** (pods): `desired = ⌈current × metric / target⌉` → 4 pods a 90 % com meta de 60 % → **6**.
- **Cluster Autoscaler / Karpenter** (nós): minutos — boot da VM, entrada no cluster, download da imagem.
- **KEDA**, autoescalador orientado a eventos do Kubernetes (eventos): atraso do Kafka, tamanho da fila, cron; escala a zero.

<div class="warn">

Uma venda relâmpago vai de 5 % a 100 % em segundos; o autoscaling precisa de minutos. **Pré-escale** às 09:45, mantenha nós livres e deixe uma **sala de espera** controlar a admissão.

</div>

---

## O pipeline de entrega

<div class="flow">
<div class="box">pull request</div><div class="arrow">→</div>
<div class="box accent">CI<small>build · teste · varredura · SBOM · assinatura · push</small></div><div class="arrow">→</div>
<div class="box">repo de config<small>digest atualizado</small></div><div class="arrow">→</div>
<div class="box accent">Argo CD<small>sincroniza o cluster com o Git</small></div><div class="arrow">→</div>
<div class="box orange">canary<small>5 → 25 → 50 %</small></div><div class="arrow">→</div>
<div class="group"><div class="box green">saudável: 100 %</div><div class="box red">degradado: rollback</div></div>
</div>

- A **integração contínua (CI, *continuous integration*)** nunca toca a produção: só escreve no Git. **Construa uma vez, promova por digest.**
- **Infraestrutura como código (IaC, *infrastructure as code*)**, Terraform / OpenTofu: nuvem privada virtual (VPC), cluster, PostgreSQL, buckets como código revisado; **estado** remoto e com lock; um `plan` agendado detecta **deriva**.

---

## GitOps: puxe, não empurre

| | Push (`kubectl apply` na CI) | **Pull** (Argo CD, Flux) |
|---|---|---|
| Credenciais | a CI é cluster-admin | só o agente no cluster |
| Deriva | passa despercebida | detectada, revertida (`selfHeal`) |
| Auditoria | logs da CI | `git log` |
| Rollback | rodar um pipeline de novo | `git revert` |

OpenGitOps: declarativo · versionado e imutável · puxado automaticamente · continuamente reconciliado.

---

<!-- _class: tight -->

## Estratégias de deploy

| Estratégia | Indisponibilidade | Capacidade extra | Rollback | Raio de impacto inicial |
|---|---|---|---|---|
| Recreate | sim | nenhuma | lento | 100 % |
| Rolling update | não | pequena | gradual | cresce |
| Blue/green | não | 2× por pouco tempo | troca instantânea | 100 % |
| **Canary** | não | pequena | peso → 0 | 1–5 % |
| Shadow | não | até 2× | n/a | 0 % (efeitos colaterais!) |
| Feature flags | não | nenhuma | desligar a flag | usuários escolhidos |

<div class="warn">

O banco não faz rollback: **expand / contract** para que duas versões rodem lado a lado.

</div>

---

## Expand / contract: o banco não faz rollback

<div class="flow">
<div class="box">v1 usa <code>email</code></div><div class="arrow">→</div>
<div class="box accent">1 expand<small>adiciona <code>buyer_email</code>, anulável</small></div><div class="arrow">→</div>
<div class="box">2 v2 escreve nas duas<small>lê a nova, cai para a antiga</small></div><div class="arrow">→</div>
<div class="box accent">3 backfill</div><div class="arrow">→</div>
<div class="box green">4 contract<small>remove <code>email</code> na release seguinte</small></div>
</div>
<div class="flow"><div class="box red">renomear em uma release → pods da v1 ainda rodando consultam uma coluna que sumiu</div></div>

- Pods antigos e novos convivem em todo rolling update ou canary: cada passo precisa funcionar com os dois.

<!--
Os mesmos passos do diagrama da página de Entrega. Nunca renomeie nem apague uma coluna na release que deixa de usá-la.
-->

---

## Canary julgado por métricas

- Argo Rollouts: `setWeight 5 → 25 → 50`, um **AnalysisTemplate** consulta o Prometheus a cada minuto.
- Aborta quando a **taxa de erros > 0,5 %** ou o **p99 > 300 ms** do canary duas vezes — comparado com a **linha de base estável**, mesmo tráfego, mesmo horário.

| Regressão (base 0,1 %) | Requisições necessárias | Tempo a 5 % de 400 req/s |
|---|---|---|
| → 1,0 % | ≈ 835 | < 1 min |
| → 0,5 % | ≈ 2 300 | ≈ 2 min |
| → 0,2 % | ≈ 18 500 | ≈ 15 min |

<div class="ok">

Etapas de canary duram **minutos**, não segundos: erros raros precisam de amostras.

</div>

---

## DORA: velocidade e estabilidade juntas

<p class="small">DORA (<i>DevOps Research and Assessment</i>): quatro métricas que se movem juntas.</p>

| Métrica | Mede |
|---|---|
| Frequência de deploy | vazão |
| Lead time de mudanças | vazão |
| Taxa de falha de mudanças | estabilidade |
| Tempo para restaurar o serviço | estabilidade |

- Times de alto desempenho são melhores **nas quatro**: mudanças pequenas, frequentes e verificadas automaticamente são mais rápidas **e** mais seguras.
- IA no pipeline (revisão de pull requests, testes gerados, análise de canary por IA) → aula **Entrega assistida por IA**.

---

## De CapEx para OpEx

{{INCLUDE:docs/2027.1/classes/cloud-native/finops/capex-opex.pt.svg}}

<p class="small">A despesa de capital (CapEx, <i>capital expenditure</i>) compra capacidade em degraus meses antes: <b>ociosa</b> depois de cada compra, em <b>falta</b> antes da próxima. A despesa operacional (OpEx, <i>operational expenditure</i>) acompanha a demanda: o BoxOffice roda 6 nós o mês todo e outros 24 só nas 8 horas de aberturas.</p>

<!--
OpEx elimina a aposta adiantada, mas não é automaticamente mais barato: uma carga em uso total 24/7 durante
anos pode custar menos em capacidade própria ou comprometida (os compromissos dos modelos de preço). E uma
conta que segue o uso também segue cada erro, dentro do mês: é para isso que existe FinOps.
-->

---

## FinOps: informar → otimizar → operar

- **Informar**: tags (`service`, `team`, `env`), custo do Kubernetes por requests (OpenCost), showback.
- **Otimizar**: rightsizing, autoscaling, compromissos para o piso, spot para trabalho interrompível, ARM, menos saída de dados.
- **Operar**: orçamentos, alertas de anomalia, políticas, revisão mensal ao lado da revisão dos objetivos de nível de serviço (SLOs, *service level objectives*).

<div class="warn">

As surpresas vêm de **itens fixos por hora** (control plane, load balancer, NAT gateway), **transferência de dados** e **observabilidade** — não das CPUs.

</div>

---

<!-- _class: tight -->

## BoxOffice: para onde vai o dinheiro (modelo)

| Item (aprox., us-east-1) | US$/mês |
|---|---|
| Saída da rede de distribuição de conteúdo (CDN), 20 TB | ≈ 1 700 |
| Nós de trabalho, 6 sempre ligados | ≈ 840 |
| Kafka, 3 brokers | ≈ 610 |
| PostgreSQL Multi-AZ + réplica | ≈ 560 |
| Logs, 1 TB ingerido | ≈ 500 |
| Redis, NAT, load balancer, control plane, e-mail… | ≈ 790 |
| **24 nós extras para 4 vendas × 2 h** | **≈ 37** |

<div class="ok">

O **pico é barato** quando é elástico: os mesmos 24 nós sempre ligados custariam ≈ US$ 3 400/mês.

</div>

---

## Pagar por requisição ou por hora?

- FaaS: sem piso, custo maior por requisição. Containers: piso fixo, custo marginal baixo.
- Com as premissas da página, o equilíbrio fica em ≈ **10 req/s de média**.
- A **média** decide o custo do FaaS; o **pico** decide o tamanho dos containers.
- BoxOffice: miniaturas e webhooks em **FaaS**; o caminho de compra em **containers**.

<div class="q">

Multi-AZ dobra a conta do banco. Desperdício?

</div>

* Não — **compra disponibilidade**. FinOps não é "gastar menos", é "saber o que cada real compra".

---

<!-- _class: tight -->

## O mapa de conceitos de cloud-native

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `app` · `worker` | empacotado para rodar igual em todo lugar? | stateless, imagem OCI, digest, desligamento gracioso |
| `app` · `ingress` · `healthcheck` | quem mantém N réplicas saudáveis? | laço de controle, Service, probes, requests/limits |
| `app` · `worker` · `scheduler` | como a capacidade acompanha a venda? | HPA, autoscaler de nós, KEDA, pré-escala |
| `serverless` | pagar por requisição ou por hora? | cold starts, concorrência, ponto de equilíbrio |
| `sql` · `cache` · `kafka` · `payment` | quem opera cada componente? | IaaS … SaaS, responsabilidade compartilhada |
| `metrics` · `ingress` | como uma mudança chega à produção? | IaC, GitOps, canary julgado por SLOs |
| `cdn` · `nat` · `logs` | para onde vai o dinheiro? | fixo vs variável, egress, unit economics |

<p class="small">Cloud-native não é uma caixa no diagrama: é como <b>cada</b> caixa é empacotada, executada, entregue e paga.</p>

---

## Pontos-chave

1. Cloud-native = artefatos imutáveis, estado declarativo, elasticidade, automação — sobre apps **sem estado e descartáveis**.
2. Escolha o **modelo de serviço por componente** — um modelo é um serviço, não uma empresa; dados, identidade e config são sempre seus.
3. Imagens pequenas, em camadas e assinadas, implantadas **por digest**; encerramento gracioso no `SIGTERM`.
4. O Kubernetes é um **laço de controle**; acerte probes, requests/limits e PodDisruptionBudgets; reserve espaço para um nó perdido.
5. O autoscaling **atrasa**: pré-escale para picos conhecidos.
6. IaC + CI + **GitOps** + **canary controlado por métricas de SLO** + migrações expand/contract.
7. **FinOps**: OpEx acompanha a demanda, mas não é automaticamente mais barato; tags, modelo e otimização do que domina — em geral dados, saída de dados e itens fixos.
