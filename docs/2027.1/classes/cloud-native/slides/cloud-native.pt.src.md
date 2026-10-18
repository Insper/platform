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
| **Automação de ponta a ponta** | PR aceito → pipeline → produção |

<div class="warn">

A aplicação precisa cooperar: processos **sem estado**, config vinda do **ambiente**, início rápido e **encerramento gracioso**, logs em `stdout` (twelve-factor).

</div>

---

## Modelos de serviço: quem opera o quê

| Camada | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|---|---|---|---|---|
| Dados e regras de acesso | você | você | você | você | **você** |
| Código da aplicação | você | você | você | você | provedor |
| Runtime | você | você (imagem) | provedor | provedor | provedor |
| Escalonamento / escala | você | provedor | provedor | provedor | provedor |
| SO, hardware | você / provedor | compartilhado | provedor | provedor | provedor |

- Escolha **por componente**: serviços em CaaS, PostgreSQL como DBaaS, miniaturas em FaaS, pagamentos como SaaS.
- Por que não tudo em FaaS? **Pools de conexão**, **cold starts no pico**, **custo com carga constante**.

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

A JVM deve dimensionar o heap pelo limite do **container**: `-XX:MaxRAMPercentage=75`.

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

## Imagens e a cadeia de suprimentos

- Uma imagem OCI = **manifest** + **config** + **camadas**, todos endereçados por **digest** SHA-256.
- Tags se movem; **digests não** — faça deploy por digest.
- **Varredura** (Trivy) · **SBOM** (Syft, CycloneDX) · **assinatura** (Cosign) · **proveniência** (SLSA).
- Nunca grave segredos nas camadas: eles ficam no histórico para sempre.

<div class="ok">

Imagens pequenas e em camadas = **escala mais rápida**: cada nó novo precisa baixar a imagem antes de o pod iniciar.

</div>

---

## Kubernetes: o laço de controle

```
loop:
    desired = spec in the API server   # "4 replicas of catalog"
    actual  = observe the cluster      # 2 (a node died)
    act to reduce the difference       # create 2 pods, schedule them
```

- **API server + etcd** guardam o estado; o **scheduler** posiciona pods; **controladores** reconciliam; o **kubelet** executa containers.
- Autorrecuperação, rolling updates e autoscaling são todos o **mesmo laço**.

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
| **HPA** | 4 → 40 réplicas, meta de 60 % da CPU do request |
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

* As threads queimam a cota CFS de 100 ms no começo de cada período e esperam o resto.
* Verifique `container_cpu_cfs_throttled_periods_total`; mantenha o request de CPU, considere não ter limite de CPU.

---

## Autoscaling em três níveis — e seu atraso

- **HPA** (pods): `desired = ⌈current × metric / target⌉` → 4 pods a 90 % com meta de 60 % → **6**.
- **Cluster Autoscaler / Karpenter** (nós): minutos — boot da VM, entrada no cluster, download da imagem.
- **KEDA** (eventos): atraso do Kafka, tamanho da fila, cron; escala a zero.

<div class="warn">

Uma venda relâmpago vai de 5 % a 100 % em segundos; o autoscaling precisa de minutos. **Pré-escale** às 09:45, mantenha nós livres e deixe uma **sala de espera** controlar a admissão.

</div>

---

## O pipeline de entrega

PR → **CI** (build · teste · varredura · SBOM · assinatura · push) → **repo de config** (digest atualizado) → **Argo CD** sincroniza → **canary** 5 % → 25 % → 50 % → **análise** → promove ou reverte.

- **IaC** (Terraform / OpenTofu): VPC, cluster, PostgreSQL, buckets como código revisado; **estado** remoto e com lock; `plan` agendado detecta **deriva**.
- **A CI nunca toca a produção**: ela só escreve no Git.
- **Construa uma vez, promova por digest** de staging para produção.

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

| Métrica | Mede |
|---|---|
| Frequência de deploy | vazão |
| Lead time de mudanças | vazão |
| Taxa de falha de mudanças | estabilidade |
| Tempo para restaurar o serviço | estabilidade |

- Times de alto desempenho são melhores **nas quatro**: mudanças pequenas, frequentes e verificadas automaticamente são mais rápidas **e** mais seguras.
- IA no pipeline (revisão de PR, testes gerados, análise de canary por IA) → aula **Entrega assistida por IA**.

---

## FinOps: informar → otimizar → operar

- **Informar**: tags (`service`, `team`, `env`), custo do Kubernetes por requests (OpenCost), showback.
- **Otimizar**: rightsizing, autoscaling, compromissos para o piso, spot para trabalho interrompível, ARM, menos saída de dados.
- **Operar**: orçamentos, alertas de anomalia, políticas, revisão mensal ao lado da revisão de SLOs.

<div class="warn">

As surpresas vêm de **itens fixos por hora** (control plane, LB, NAT), **transferência de dados** e **observabilidade** — não das CPUs.

</div>

---

<!-- _class: tight -->

## BoxOffice: para onde vai o dinheiro (modelo)

| Item (aprox., us-east-1) | US$/mês |
|---|---|
| Saída da CDN, 20 TB | ≈ 1 700 |
| Nós de trabalho, 6 sempre ligados | ≈ 840 |
| Kafka, 3 brokers | ≈ 610 |
| PostgreSQL Multi-AZ + réplica | ≈ 560 |
| Logs, 1 TB ingerido | ≈ 500 |
| Redis, NAT, LB, control plane, e-mail… | ≈ 790 |
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
2. Escolha o **modelo de serviço por componente**; dados, identidade e config são sempre seus.
3. Imagens pequenas, em camadas e assinadas, implantadas **por digest**; encerramento gracioso no `SIGTERM`.
4. O Kubernetes é um **laço de controle**; acerte probes, requests/limits e PDBs.
5. O autoscaling **atrasa**: pré-escale para picos conhecidos.
6. IaC + CI + **GitOps** + **canary controlado por métricas de SLO** + migrações expand/contract.
7. **FinOps**: tags, modelo e otimização do que domina — em geral dados, saída de dados e itens fixos.
