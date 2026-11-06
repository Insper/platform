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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Modelos de Serviço

**Quem opera cada camada da pilha?**

<!--
Objetivos: explicar o que torna um serviço "nuvem" e CapEx vs OpEx; situar IaaS, CaaS, PaaS, FaaS e SaaS na pilha
de responsabilidade, dizendo quem age quando algo quebra; comparar os modelos; escolher um modelo por componente;
dizer o que nunca passa para o provedor.
Roteiro: (1) o que torna um serviço nuvem; (2) a pilha de responsabilidade; (3) subindo a pilha, um modelo de cada vez;
(4) blocos gerenciados; (5) comparando os modelos; (6) como escolher, a loja componente por componente; (7) erros comuns.
-->

---

## A loja precisa rodar em algum lugar de verdade

O gateway, auth, account, product, order e exchange, mais Postgres, Redis e Kafka, rodam bem num notebook com Docker Compose. Quatro tipos de opção:

1. **Comprar** servidores.
2. **Alugar** máquinas virtuais.
3. **Entregar** seu código ou container para uma plataforma que o executa.
4. **Dispensar** o componente e pagar por um produto que já faz o trabalho.

<div class="ok">

**A ideia central:** todo modelo de serviço responde à mesma pergunta — **quem opera cada camada da pilha?** Quanto mais você entrega ao provedor, mais rápido avança e menos controla.

</div>

<!--
Cada opção traça uma linha diferente entre o que seu time opera e o que outra pessoa opera.
É essa linha que um modelo de serviço em nuvem define.
-->

---

## O que torna um serviço "nuvem"?

NIST SP 800-145: **cinco características essenciais** e um serviço precisa ter **todas** elas.

| Característica | Na loja |
|---|---|
| **Autoatendimento sob demanda** | `aws rds create-db-instance` cria o Postgres em minutos |
| **Amplo acesso pela rede** | o gateway é um endpoint HTTPS |
| **Agrupamento de recursos** | o order pode dividir um host físico com o workload de outra empresa, isolado |
| **Elasticidade rápida** | Black Friday: o order vai de 2 para 20 réplicas e depois volta |
| **Serviço medido** | a fatura mostra vCPU-horas, GB armazenados, GB transferidos |

<p class="small">Alugar um servidor num datacenter com contrato de três anos não é nuvem, mesmo que o servidor esteja longe.</p>

---

## CapEx vs OpEx

<div class="cols">
<div>

### CapEx — comprar servidores

- Um pagamento alto e **antecipado**.
- Hardware dimensionado para o pico que você **espera**.

</div>
<div>

### OpEx — a nuvem

- Paga **por mês** o que **usa**.
- Elimina a aposta antecipada…
- …mas **não é automaticamente mais barato**: carga máxima 24/7 durante anos pode custar mais do que hardware próprio.

</div>
</div>

<div class="q">

**Modelo de serviço ≠ modelo de implantação.** Os modelos de implantação dizem *quem compartilha* a infraestrutura: pública, privada, híbrida, comunitária. Esta aula trata do outro eixo: *quanto dela você opera*.

</div>

---

## A pilha de responsabilidade

Toda aplicação em produção precisa das mesmas seis camadas. Leia **de baixo para cima**:

| Camada | O que é | Na loja |
|---|---|---|
| **Dados e acesso** | o que a aplicação guarda e quem pode ler | pedidos, contas, usuários do banco, chaves de API |
| **Aplicação** | seu código | o gateway e os serviços |
| **Middleware** | o que seu código precisa para rodar | JDK, servidor web, Redis |
| **SO** | o sistema operacional de cada máquina | Linux |
| **Virtualização** | hypervisor que divide um host em VMs | KVM, Xen |
| **Hardware** | servidores, discos, rede, energia, refrigeração | o datacenter |

---

## A imagem central

Da esquerda para a direita, o provedor assume mais da pilha: <span class="chip orange">você</span> opera · <span class="chip accent">provedor</span> opera

<div class="matrix" style="--n: 6">
<div class="head"></div>
<div class="head">On-premises</div>
<div class="head">IaaS</div>
<div class="head">CaaS</div>
<div class="head">PaaS</div>
<div class="head">FaaS</div>
<div class="head">SaaS</div>
<div class="row">Dados e acesso</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="row">Aplicação</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="row">Middleware</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">SO</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Virtualização</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Hardware</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
</div>

<!--
Esta é a imagem para lembrar. Peça à turma que a leia coluna por coluna antes do próximo slide.
-->

---

## Três coisas para observar

- **A linha de cima nunca muda.** O provedor pode guardar seus dados, mas só você decide quem os lê: segurança *da* nuvem (provedor) vs segurança *na* nuvem (cliente).
- **CaaS e PaaS diferem em uma camada: o middleware.** No CaaS, o JDK está dentro da imagem que você constrói; no PaaS, a plataforma o fornece.
- **PaaS e FaaS têm as mesmas cores.** O que muda é o tamanho do que você entrega: uma aplicação ou uma única função.

<div class="ok">

**Pizza como serviço.** On-premises: você cozinha em casa · IaaS: você aluga uma cozinha · PaaS: você pede delivery · SaaS: você come num restaurante — e continua decidindo quem senta à sua mesa.

</div>

---

## Quem age quando algo acontece?

Encontre o evento e leia a linha: <span class="chip orange">você</span> opera · <span class="chip accent">provedor</span> opera

<div class="matrix" style="--n: 6">
<div class="head"></div>
<div class="head">On-premises</div>
<div class="head">IaaS</div>
<div class="head">CaaS</div>
<div class="head">PaaS</div>
<div class="head">FaaS</div>
<div class="head">SaaS</div>
<div class="row">Um disco falha</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Uma falha no kernel do Linux</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Uma falha no JDK</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Black Friday: tráfego ×10</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="box accent">provedor</div>
<div class="row">Um bug na aplicação</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box accent">provedor</div>
<div class="row">Uma chave de acesso vaza</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
<div class="box orange">você</div>
</div>

<p class="small">A configuração usual de cada modelo. Em CaaS e PaaS a plataforma escala, mas você ainda define os limites; em Kubernetes gerenciado com node groups clássicos, o SO dos nós ainda é em parte seu.</p>

---

## Confira o que entendeu

<div class="q">

A loja roda num **PaaS** e publicam uma falha no **kernel do Linux**. O que seu time faz?

</div>

* Nada, no que diz respeito ao SO: o provedor aplica o patch (a linha do SO).
* Agora a loja roda em **CaaS** e a falha é no **JDK**…
* …seu time age: o JDK está dentro da sua imagem. Atualize a imagem base, reconstrua e faça o deploy de novo.

---

## Subindo a pilha, um modelo de cada vez

O NIST define três modelos fundamentais: **IaaS**, **PaaS** e **SaaS**. Depois, o mercado acrescentou **CaaS** e **FaaS** entre eles.

Cada modelo tem as mesmas partes, para que você possa compará-los:

- o que **você entrega** e o que **você mantém**;
- o **serviço order** (ou a loja) naquele modelo;
- **escolha quando** / **evite quando**.

<div class="ok">

O que você **implanta** diferencia os modelos: uma VM (IaaS), uma imagem (CaaS), código (PaaS), uma função (FaaS) ou nada (SaaS).

</div>

---

<!-- _class: tight -->

## IaaS: Infraestrutura como Serviço

**Você aluga uma máquina e faz o resto.** Você entrega datacenter, hardware e hypervisor; mantém o SO (patches, hardening), o runtime, o código, os dados, as regras de firewall e os backups.

```bash
aws ec2 run-instances --image-id <ubuntu-ami> --instance-type t3.medium --key-name <key>
ssh ubuntu@<public-ip>
sudo apt update && sudo apt install -y openjdk-21-jre-headless nginx
java -jar order.jar
```

E isso é só o primeiro dia: configurar o nginx, reiniciar o serviço se ele cair, aplicar patches no SO, agendar backups.

- **Escolha quando** você precisa controlar o SO (kernel, drivers, GPUs) ou para o **lift-and-shift** de uma aplicação existente.
- **Evite quando** ninguém quer ficar de plantão por causa de servidores: toda camada acima do hypervisor é sua.

<p class="small">AWS EC2, Google Compute Engine, Azure Virtual Machines, DigitalOcean Droplets.</p>

---

<!-- _class: tight -->

## CaaS: Container como Serviço

**Você entrega uma imagem de container; a plataforma a executa.** O provedor cuida do agendamento, da rede, da escala e da saúde das máquinas; tudo **dentro da imagem** (imagem base, JDK, código) continua sendo seu.

```bash
docker build -t <registry>/order:1.0 .
docker push <registry>/order:1.0
gcloud run deploy order --image <registry>/order:1.0 --region southamerica-east1 --max-instances 10
```

A mesma imagem que você roda com Docker Compose: mudar de provedor é enviá-la para outro lugar.

- O **Kubernetes gerenciado** (EKS, GKE, AKS) também é CaaS: o provedor executa o control plane e você usa a API padrão do Kubernetes. **Seu projeto usa essa opção.**
- **Escolha quando** seus serviços já são containers. **Evite quando** o time prefere não manter patches da imagem base: o PaaS está um degrau acima.

<p class="small">AWS ECS / Fargate, Google Cloud Run, Azure Container Apps.</p>

---

<!-- _class: tight -->

## PaaS: Plataforma como Serviço

**Você entrega o código; a plataforma o constrói e o executa.** Ela fornece SO, JDK, deploy, balanceamento de carga e escala; você mantém o código, a configuração (variáveis de ambiente, regras de escala), os dados e o acesso.

```bash
heroku create store-order
heroku addons:create heroku-postgresql:essential-0
git push heroku main
heroku ps:scale web=2
```

Um **buildpack** encontra o `pom.xml` e constrói o projeto: ninguém instalou um JDK nem um banco de dados.

- **12-factor app**: processos sem estado, configuração em variáveis de ambiente, logs no stdout — a plataforma pode reiniciar ou mover seu processo e **apagar o disco local** dele.
- **Escolha quando** o time quer entregar funcionalidades, não gerenciar servidores. **Evite quando** precisa de um software que a plataforma não oferece ou numa escala grande e constante.

<p class="small">Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.</p>

---

<!-- _class: tight -->

## FaaS: Função como Serviço

**Você entrega uma única função; ela só roda quando algo a chama.** É o PaaS levado ao extremo (**serverless**): instâncias sob demanda, **escala até zero**, pagamento por invocação e por milissegundo.

O serviço order inteiro não se encaixa bem, mas o e-mail enviado depois de cada pedido, sim:

```java
public class OrderCreated implements RequestHandler<Map<String, Object>, String> {
    @Override
    public String handleRequest(Map<String, Object> event, Context context) {
        // send the confirmation e-mail for this order
        return "sent";
    }
}
```

<p class="small">AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers.</p>

---

## FaaS: duas restrições

- **Cold start**: a primeira requisição a uma função sem instância pronta espera o sandbox, o código e o runtime — segundos numa aplicação Spring Boot.
- **Tempo máximo de execução**: 15 minutos no Lambda.
- **Escolha quando** o trabalho é curto, orientado a eventos e esporádico: webhooks, tarefas agendadas, um arquivo depois do upload.
- **Evite quando** toda requisição precisa de baixa latência ou o tráfego é alto e constante: um container sempre ligado é mais barato e mais previsível.

<div class="q">

**Containers serverless borram a fronteira.** O Cloud Run e o Azure Container Apps também escalam até zero e cobram pelo uso, mas executam qualquer imagem. "Serverless" é o *modelo de operação* e não só funções.

</div>

---

## SaaS: Software como Serviço

**Você usa o produto; o provedor opera todo o resto.** Você mantém as contas de usuário e as permissões, os dados que insere e as integrações (APIs, webhooks).

- **A loja em SaaS**: o Shopify já é uma loja. Crie uma conta, cadastre os produtos, configure os pagamentos — no ar no mesmo dia, mas ela só pode fazer o que o produto permite.
- **Multi-tenant**: uma aplicação atende todos os clientes, com os dados de cada um separados — é isso que torna o SaaS barato e imediato.
- **Escolha quando** um produto atende à necessidade e a ferramenta não é seu diferencial: e-mail, CRM, monitoramento, CI/CD.
- **Evite quando** o software *é* o seu diferencial ou você precisa de uma customização que o produto nunca vai oferecer.

<p class="small">Google Workspace, Salesforce, Slack, GitHub, Datadog, Shopify.</p>

---

## Blocos gerenciados: DBaaS

Nem tudo cabe na escada. O **DBaaS** aplica a mesma entrega a **um único componente**: em vez de operar um servidor Postgres, você aluga um.

| Postgres numa VM | Usando um DBaaS |
|---|---|
| Você instala e aplica patches no SO e no banco | O provedor aplica os patches numa janela que você escolhe |
| Você escreve scripts de backup e os testa | Você define o período de retenção |
| Você monta a replicação e o failover | Você liga uma opção (Multi-AZ no RDS) |
| Schema, consultas, acesso | Schema, consultas, acesso: **isso continua com você** |

<p class="small">AWS RDS, Amazon Aurora, Google Cloud SQL, Azure Database, Neon.</p>

---

## A mesma ideia para outros componentes

| Modelo | Sigla | Exemplos |
|---|---|---|
| Armazenamento como Serviço | STaaS | AWS S3, Google Cloud Storage, Backblaze B2 |
| IA / ML como Serviço | AIaaS | AWS Bedrock, Google Vertex AI, Azure AI |
| Monitoramento como Serviço | — | Datadog, New Relic, Grafana Cloud |
| Segurança como Serviço | SECaaS | Cloudflare, AWS Shield, Snyk |
| Comunicação como Serviço | CPaaS | Twilio, SendGrid, AWS SES |

---

<!-- _class: tight -->

## Comparando os modelos

Leia por linhas, observando como cada característica muda da esquerda para a direita:

| | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **Você implanta** | tudo | uma VM | uma imagem | código | uma função | nada |
| **Controle** | máximo | alto | médio | médio | baixo | mínimo |
| **Tempo até entrar no ar** | meses | horas | minutos | minutos | minutos | imediato |
| **Escala** | comprar hardware | manual ou por script | automática (alguns até zero) | automática | automática até zero | automática |
| **Você paga por** | hardware (CapEx) | VM-hora | tempo de container | instâncias ou uso | invocações e duração | usuários ou licenças |
| **Portabilidade** | total | alta | alta (a imagem) | média | baixa (API do fornecedor) | baixa (exportação de dados) |

<!--
Controle e portabilidade caem conforme o tempo até entrar no ar melhora. O FaaS é o ponto fora da curva na
portabilidade: o código é escrito contra a API de um fornecedor.
-->

---

<!-- _class: tight -->

## Quem oferece cada modelo

| Modelo | AWS | Google Cloud | Microsoft | Outros provedores |
|---|---|---|---|---|
| **IaaS** | EC2 | Compute Engine | Azure Virtual Machines | DigitalOcean Droplets, Oracle Cloud Compute, Magalu Cloud |
| **CaaS** | ECS / Fargate, EKS | Cloud Run, GKE | Azure Container Apps, AKS | DigitalOcean Kubernetes, Fly.io |
| **PaaS** | Elastic Beanstalk | App Engine | Azure App Service | Heroku, Railway, Render |
| **FaaS** | Lambda | Cloud Run functions | Azure Functions | Cloudflare Workers, Vercel Functions |
| **SaaS** | Amazon Connect, QuickSight | Google Workspace | Microsoft 365, Dynamics 365 | Salesforce, Slack, GitHub, Shopify, TOTVS |
| **Blocos gerenciados** | RDS, ElastiCache, MSK | Cloud SQL, Memorystore | Azure Database, Azure Cache for Redis | Neon, Upstash, Confluent Cloud |

<div class="ok">

Leia por colunas: **um modelo descreve um serviço, não uma empresa** — a AWS aparece em todas as linhas. As grandes nuvens oferecem quase todos os modelos; provedores menores se especializam em um degrau da pilha.

</div>

<!--
A loja poderia usar um único provedor (na AWS: EKS para os serviços, RDS para o Postgres) ou misturar provedores
(GitHub para o código e o CI): o que decide é o requisito de cada componente, como mostra o próximo slide.
O Cloud Run functions se chamava Cloud Functions.
-->

---

<!-- _class: tight -->

## Como escolher

**Por componente, não por sistema.** Comece pela opção mais gerenciada; pergunte em ordem e pare no primeiro **sim** (cada **não** desce um degrau):

<div class="matrix" style="grid-template-columns: 1.15fr auto 1fr; gap: 6px 10px">
<div class="box accent">1 · Um produto já faz o trabalho?</div><div class="arrow">sim →</div><div class="box green"><span><strong>SaaS</strong> · GitHub Actions, Datadog</span></div>
<div class="box accent">2 · É um banco, cache ou broker padrão?</div><div class="arrow">sim →</div><div class="box green"><span><strong>Serviço gerenciado</strong> · RDS, ElastiCache, MSK</span></div>
<div class="box accent">3 · Curto, orientado a eventos e esporádico?</div><div class="arrow">sim →</div><div class="box green"><span><strong>FaaS</strong> · Lambda, Cloud Functions</span></div>
<div class="box accent">4 · Controle do SO ou hardware especial?</div><div class="arrow">sim →</div><div class="box green"><span><strong>IaaS</strong> · EC2, Compute Engine, Azure VM</span></div>
<div class="box accent">5 · Um container que precisa da API do Kubernetes?</div><div class="arrow">sim →</div><div class="box green"><span><strong>CaaS, Kubernetes gerenciado</strong> · EKS, GKE, AKS</span></div>
<div class="box accent">6 · Um container?</div><div class="arrow">sim →</div><div class="box green"><span><strong>CaaS, containers gerenciados</strong> · Cloud Run, ECS Fargate</span></div>
<div class="box muted">Nenhuma das anteriores</div><div class="arrow">→</div><div class="box green"><span><strong>PaaS</strong> · Heroku, App Engine</span></div>
</div>

---

## A loja na AWS

Passar cada componente pelas perguntas dá um resultado razoável, com a mesma forma do projeto do curso:

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .55; display: flex; align-items: center; justify-content: center">Cliente</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">CaaS · EKS</div>
<div class="box accent">gateway<small>CaaS: EKS</small></div>
<div class="box accent">account<small>CaaS: EKS</small></div>
<div class="box accent">order<small>CaaS: EKS</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">Dados gerenciados</div>
<div class="box green">Postgres<small>DBaaS: RDS</small></div>
<div class="box green">Redis<small>DBaaS: ElastiCache</small></div>
<div class="box green">Kafka<small>gerenciado: Amazon MSK</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">Eventos</div>
<div class="box orange">notificação<small>FaaS: Lambda</small></div>
<div class="arrow">↓</div>
<div class="box">e-mail<small>CPaaS: AWS SES</small></div>
</div>
</div>

<div class="ok">

Sistemas reais **misturam** modelos: CaaS para os serviços, DBaaS para os dados, FaaS para o trabalho esporádico. A linha de dados e acesso continua sua em todas as caixas.

</div>

<!--
Setas: cliente → gateway → account e order; account e order → Postgres; order → Redis e Kafka; o Kafka aciona o Lambda, que envia o e-mail pelo SES.
-->

---

<!-- _class: tight -->

## A loja, componente por componente

| Componente | Por conta própria | Opção gerenciada | O que muda para o time |
|---|---|---|---|
| gateway, account, order | Compose no EC2 (IaaS) | EKS ou ECS Fargate (CaaS) | sem SSH nem patches do SO; manifests no lugar |
| Postgres | Postgres no EC2 | RDS (DBaaS) | backups, replicação e failover viram opções |
| Redis | container na VM | ElastiCache (DBaaS) | sobrevive ao reinício da VM; paga por nó |
| Kafka | brokers em VMs | Amazon MSK | patches e troca de brokers passam para a AWS |
| Notificação do pedido | consumidor sempre rodando | Lambda no tópico do Kafka (FaaS) | paga por mensagem; cold starts num caminho assíncrono |
| CI/CD | Jenkins num container | GitHub Actions (SaaS) | nenhum servidor Jenkins para atualizar |
| Monitoramento | Prometheus e Grafana | Grafana Cloud ou Datadog (SaaS) | nenhum armazenamento de métricas para dimensionar |

<div class="ok">

Sistemas reais **misturam** modelos — a mesma forma do projeto do curso. A linha de dados e acesso nunca some: você continua decidindo quem se conecta ao RDS e quem alcança o gateway.

</div>

---

## Sua vez: o serviço exchange

<div class="q">

Onde você rodaria o **exchange**, que converte moedas chamando uma API externa de cotações?

</div>

* Nenhum produto faz esse trabalho e ele não é um banco de dados.
* Requisições síncronas durante o checkout: o FaaS é possível, mas os cold starts atrapalhariam.
* Não precisa controlar o SO; já é um container; o projeto tem Kubernetes → **CaaS no EKS**.
* Um time pequeno sem cluster poderia escolher o Cloud Run com bons motivos: o que importa é a **justificativa**.

---

## Erros comuns

- **"Gerenciado" como "não é problema meu"**: a maioria dos vazamentos na nuvem vem de configuração do cliente — um bucket S3 público, um banco aberto para `0.0.0.0/0`, uma access key vazada.
- **Ignorar o lock-in**: quanto mais alto o modelo, mais você depende da API de um fornecedor. Prefira containers, Postgres, a API do Kubernetes.
- **O modelo mais alto é sempre mais barato**: serviços gerenciados cobram um adicional por unidade; em escala grande e constante, operar por conta própria pode compensar.
- **Estado numa instância de PaaS ou FaaS**: arquivos locais e sessões em memória somem num reinício ou numa redução de escala.
- **FaaS para uma API de alto tráfego e sensível à latência**: um container sempre ligado é mais barato e mais previsível.

---

## Pontos-chave

- Um modelo de serviço define **quem opera cada camada** da pilha; do IaaS ao SaaS, você entrega cada vez mais dela.
- Mais gerenciado = **mais velocidade, menos operação**, mas **menos controle e portabilidade**.
- O que você implanta diferencia os modelos: uma VM, uma imagem, código, uma função ou nada.
- "Nuvem" = as cinco características do NIST; transforma CapEx em OpEx, o que nem sempre é mais barato.
- Sistemas reais misturam modelos: **escolha por componente**, começando pela opção mais gerenciada.
- Seus dados, regras de acesso e configuração são **sempre** seus.

<p class="small">Na página da aula: experimente os simuladores para mover a linha entre você e o provedor e comparar custos.</p>
