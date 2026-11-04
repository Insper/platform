
Seu time construiu a loja: um **gateway**, os serviços **auth**, **account**, **product**, **order** e **exchange**, um banco **Postgres**, um cache **Redis** e o **Kafka**. Tudo roda bem num notebook com Docker Compose. Agora é preciso rodar em algum lugar de verdade e você tem quatro tipos de opção: comprar servidores, alugar máquinas virtuais, entregar seu código ou container para uma plataforma que o executa ou dispensar o componente e pagar por um produto que já faz o trabalho.

Cada opção traça uma linha diferente entre **o que seu time opera** e **o que outra pessoa opera**. É essa linha que um **modelo de serviço em nuvem** define.

!!! abstract "A ideia central desta aula"

    **Todo modelo de serviço responde à mesma pergunta: quem opera cada camada da pilha?** Quanto mais você entrega ao provedor, mais rápido avança e menos controla.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** o que torna um serviço "nuvem" e a diferença entre CapEx e OpEx.
    - **Situar** IaaS, CaaS, PaaS, FaaS e SaaS na pilha de responsabilidade, dizendo quem age quando algo quebra.
    - **Comparar** os modelos quanto a controle, unidade de deploy, escalabilidade, custo e portabilidade.
    - **Escolher** um modelo para cada componente de um sistema e justificar o trade-off.
    - **Identificar** o que nunca passa para o provedor: seus dados, suas regras de acesso e sua configuração.

## Slides

<div class="slides-embed">
  <iframe src="slides/service-models.html" title="Slides: modelos de serviço" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/service-models.html){:target="_blank"}

---

## O que torna um serviço "nuvem"?

Alugar um servidor num datacenter com um contrato de três anos não é computação em nuvem, mesmo que o servidor esteja longe. O NIST[^1] define computação em nuvem por **cinco características essenciais** e um serviço precisa ter todas elas:

<div class="compact-table" markdown>

| Característica | O que significa | Na loja |
|---|---|---|
| **Autoatendimento sob demanda** | Você provisiona recursos sozinho, sem falar com uma pessoa do provedor | `aws rds create-db-instance` cria o banco Postgres em minutos |
| **Amplo acesso pela rede** | Os recursos são acessíveis pela rede com protocolos padrão | O gateway é um endpoint HTTPS |
| **Agrupamento de recursos** | O provedor atende muitos clientes (**tenants**) com hardware compartilhado | Seu serviço order pode dividir um host físico com o workload de outra empresa, isolado dele |
| **Elasticidade rápida** | A capacidade cresce e diminui rapidamente, muitas vezes de forma automática | Black Friday: o order vai de 2 para 20 réplicas e depois volta |
| **Serviço medido** | O uso é medido e cobrado por unidade | A fatura mostra vCPU-horas, GB de armazenamento e GB de transferência de dados |

</div>

**CapEx vs OpEx.** Comprar servidores é **despesa de capital (CapEx)**: um pagamento alto e antecipado por hardware dimensionado para o pico que você *espera*. A nuvem transforma isso em **despesa operacional (OpEx)**: você paga por mês o que *usa*. O OpEx elimina a aposta antecipada, mas não é automaticamente mais barato. Um workload em carga máxima 24/7 durante anos pode custar mais na nuvem do que em hardware próprio.

!!! info "Modelo de serviço não é modelo de implantação"
    O NIST também define **modelos de implantação**, que dizem *quem compartilha* a infraestrutura: **pública** (qualquer cliente pagante), **privada** (uma organização), **híbrida** (uma combinação) e **comunitária** (organizações com requisitos em comum). Esta aula trata do outro eixo: *quanto dela você opera*.

---

## A pilha de responsabilidade

Toda aplicação em produção precisa das mesmas seis camadas. Leia de baixo para cima, como se cada uma estivesse apoiada na de baixo:

<div class="compact-table" markdown>

| Camada | O que é | Na loja |
|---|---|---|
| **Dados e acesso** | O que a aplicação guarda e quem pode ler | Pedidos, contas, usuários do banco, chaves de API |
| **Aplicação** | Seu código | O gateway e os serviços |
| **Middleware** | O software de que seu código precisa para rodar | JDK, servidor web, Redis |
| **SO** | O sistema operacional de cada máquina | Linux |
| **Virtualização** | O hypervisor que divide um host físico em máquinas virtuais | KVM, Xen |
| **Hardware** | Servidores, discos, rede, energia e refrigeração | O datacenter |

</div>

Agora, a imagem central desta aula. Cada coluna é um modelo e, da esquerda para a direita, o provedor assume mais da pilha.

🟧 você opera · 🟦 o provedor opera

<div class="compact-table" markdown>

| Camada | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Dados e acesso** | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 |
| **Aplicação** | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 | 🟦 |
| **Middleware** | 🟧 | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 |
| **SO** | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 |
| **Virtualização** | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 | 🟦 |
| **Hardware** | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 | 🟦 |

</div>

Três coisas para observar:

- **A linha de cima nunca muda.** O provedor pode guardar seus dados, mas só você pode decidir quem os lê. A AWS resume isso como segurança *da* nuvem (o provedor) versus segurança *na* nuvem (o cliente)[^2] e a Microsoft apresenta a mesma tabela para o Azure[^3].
- **CaaS e PaaS diferem em uma camada: o middleware.** No CaaS, o JDK está dentro da imagem que você constrói. No PaaS, a plataforma o fornece.
- **PaaS e FaaS têm as mesmas cores.** O que muda é o tamanho do que você entrega: uma aplicação ou uma única função.

!!! tip "Uma analogia: pizza como serviço"
    - **On-premises:** você faz a pizza em casa, com seu forno e seus ingredientes.
    - **IaaS:** você aluga uma cozinha. O forno e o gás já estão lá; você leva os ingredientes e cozinha.
    - **PaaS:** você pede delivery. Alguém cozinha; você providencia a mesa e as bebidas.
    - **SaaS:** você come num restaurante. Só escolhe no cardápio e continua decidindo quem senta à sua mesa.

### Quem age quando algo acontece?

A pilha fica concreta quando algo dá errado. Encontre o evento e leia a linha para ver quem precisa agir (🟧 você, 🟦 o provedor):

<div class="compact-table" markdown>

| Evento | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Um disco falha | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 | 🟦 |
| Descobrem uma falha no kernel do Linux | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 |
| Descobrem uma falha no JDK | 🟧 | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 |
| Black Friday: o tráfego fica dez vezes maior | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 |
| Um bug na aplicação | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 | 🟦 |
| Uma chave de acesso vaza | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 |

</div>

A tabela considera a configuração usual de cada modelo. Em CaaS e PaaS a plataforma escala, mas você ainda define os limites. Em Kubernetes gerenciado com node groups clássicos, o SO dos nós ainda é em parte tarefa sua.

??? question "Confira o que entendeu: a loja roda num PaaS e publicam uma falha no kernel do Linux. O que seu time faz?"
    Nada, no que diz respeito ao SO: o provedor aplica o patch, como mostra a linha do SO. Agora mude uma coisa: a loja roda em CaaS e a falha é no **JDK**. Aí seu time age, porque o JDK está dentro da sua imagem: você atualiza a imagem base, reconstrói e faz o deploy de novo.

---

## Subindo a pilha, um modelo de cada vez

O NIST define três modelos fundamentais: **IaaS**, **PaaS** e **SaaS**[^1]. Depois, o mercado acrescentou **CaaS** e **FaaS** entre eles. Cada seção abaixo tem as mesmas partes, para que você possa compará-las e cada uma coloca a loja naquele modelo.

### IaaS: Infraestrutura como Serviço

**Você aluga uma máquina e faz o resto.** O provedor fornece computação, armazenamento e rede virtuais. Você instala e mantém tudo do SO para cima.

<div class="compact-table" markdown>

| Você entrega | Você mantém |
|---|---|
| Datacenter, energia, refrigeração, rede física | SO: instalação, patches, hardening |
| Hardware e hypervisor | Runtime, middleware, seu código e seus dados |
| | Regras de firewall, controle de acesso, backups |

</div>

**Exemplos:** AWS EC2, Google Compute Engine, Azure Virtual Machines, DigitalOcean Droplets.

!!! example "O serviço order em IaaS"
    ```bash
    aws ec2 run-instances --image-id <ubuntu-ami> --instance-type t3.medium --key-name <key>
    ssh ubuntu@<public-ip>
    sudo apt update && sudo apt install -y openjdk-21-jre-headless nginx
    java -jar order.jar
    ```
    E isso é só o primeiro dia. Ainda falta configurar o nginx, reiniciar o serviço se ele cair, aplicar patches no SO e agendar backups.

- **Escolha quando** você precisa de controle do SO (um kernel específico, drivers próprios ou hardware especial como GPUs) ou quando vai levar uma aplicação existente para VMs na nuvem sem redesenhá-la (**lift-and-shift**).
- **Evite quando** ninguém no time quer ficar de plantão por causa de servidores: toda camada acima do hypervisor é sua para manter.

### CaaS: Container como Serviço

**Você entrega uma imagem de container; a plataforma a executa.** O provedor gerencia o agendamento, a rede, a escala e a saúde das máquinas. Tudo o que está dentro da imagem continua sendo seu.

<div class="compact-table" markdown>

| Você entrega | Você mantém |
|---|---|
| Máquinas, SO dos hosts, agendamento | A imagem: imagem base, JDK, seu código |
| Rede entre containers, escala | Limites, configuração, dados |

</div>

**Exemplos:** AWS ECS / Fargate, Google Cloud Run, Azure Container Apps.

!!! example "O serviço order em CaaS"
    ```bash
    docker build -t <registry>/order:1.0 .
    docker push <registry>/order:1.0
    gcloud run deploy order --image <registry>/order:1.0 --region southamerica-east1 --max-instances 10
    ```
    É a mesma imagem que você já roda com Docker Compose. É isso que torna o CaaS portável: mudar de provedor significa enviar essa imagem para outro lugar.

O **Kubernetes gerenciado** (Amazon EKS, Google GKE, Azure AKS) também costuma ser classificado como CaaS. O provedor executa o control plane (API server, scheduler, etcd) e você faz o deploy dos containers pela API padrão do Kubernetes, mantida pela CNCF[^4]. Quanto dos worker nodes fica com você depende do modo: node groups clássicos deixam com você o dimensionamento e as atualizações dos nós, enquanto o GKE Autopilot e o EKS Auto Mode também entregam isso ao provedor. Esta é a opção que seu projeto usa.

- **Escolha quando** seus serviços já são containers e você quer o mesmo artefato do notebook até a produção.
- **Evite quando** o time prefere não manter imagens nem patches da imagem base: nesse caso, o PaaS está um degrau acima.

### PaaS: Plataforma como Serviço

**Você entrega o código; a plataforma o constrói e o executa.** O provedor detecta a linguagem, fornece o runtime e cuida do deploy, do balanceamento de carga e da escala. Você escreve a aplicação e a configura com variáveis de ambiente.

<div class="compact-table" markdown>

| Você entrega | Você mantém |
|---|---|
| Tudo até o runtime, incluindo SO e JDK | Código da aplicação |
| Build, deploy, balanceamento de carga, escala | Configuração (variáveis de ambiente, regras de escala) |
| | Dados e acesso |

</div>

**Exemplos:** Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.

!!! example "O serviço order em PaaS"
    ```bash
    heroku create store-order
    heroku addons:create heroku-postgresql:essential-0
    git push heroku main
    heroku ps:scale web=2
    ```
    A plataforma encontra o `pom.xml` e constrói o projeto com um **buildpack**, um script que reconhece o projeto e sabe como construí-lo e executá-lo. Ninguém instalou um JDK nem um banco de dados.

O PaaS favorece o padrão **12-factor app**[^5]: processos sem estado, configuração em variáveis de ambiente e logs no stdout. O motivo é prático: a plataforma pode reiniciar ou mover seu processo a qualquer momento e apagar o disco local dele, então tudo o que precisa sobreviver deve ficar num serviço externo, como um banco de dados.

- **Escolha quando** o time quer entregar funcionalidades em vez de gerenciar servidores: MVPs, backends de API, times sem experiência em infraestrutura.
- **Evite quando** você precisa de um software ou de uma configuração que a plataforma não oferece ou quando o preço por instância fica alto demais numa escala grande e constante.

### FaaS: Função como Serviço

**Você entrega uma única função; ela só roda quando algo a chama.** É o PaaS levado ao extremo, também conhecido como **serverless**. A plataforma cria instâncias sob demanda e reduz a escala até zero quando não há uso e você paga por invocação e por milissegundo.

<div class="compact-table" markdown>

| Você entrega | Você mantém |
|---|---|
| Tudo até o runtime, incluindo a escala | O código da função |
| Criar e remover instâncias conforme as chamadas chegam | Configuração do gatilho, dados e acesso |

</div>

**Exemplos:** AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers.

!!! example "Parte do serviço order em FaaS"
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

Duas restrições vêm com esse modelo. A primeira é o **cold start**: a primeira requisição que chega a uma função sem instância pronta precisa esperar a plataforma criar um sandbox, carregar o código e iniciar o runtime e, numa aplicação Spring Boot, isso pode levar segundos. A segunda é um tempo máximo de execução: 15 minutos no Lambda[^6].

- **Escolha quando** o trabalho é curto, orientado a eventos e esporádico: webhooks, tarefas agendadas, processar um arquivo depois do upload.
- **Evite quando** o serviço precisa de baixa latência em toda requisição ou recebe tráfego alto e constante: um container sempre ligado é mais barato e mais previsível.

!!! info "Containers serverless borram a fronteira"
    O Google Cloud Run e o Azure Container Apps também **escalam até zero** e cobram pelo uso, como o FaaS, mas executam qualquer imagem de container. "Serverless" descreve o *modelo de operação* (nenhum servidor para gerenciar, pagamento pelo uso) e não só funções.

### SaaS: Software como Serviço

**Você usa o produto; o provedor opera todo o resto.** Não há infraestrutura nem aplicação para operar. Você gerencia usuários, permissões e os dados que coloca lá.

<div class="compact-table" markdown>

| Você entrega | Você mantém |
|---|---|
| Tudo, incluindo a aplicação | Contas de usuário e permissões |
| Segurança do serviço, atualizações | Os dados que você insere |
| | Integrações (APIs, webhooks) |

</div>

**Exemplos:** Google Workspace, Salesforce, Slack, GitHub, Datadog, Shopify.

!!! example "A loja em SaaS"
    Não há nada para implantar, porque o Shopify já é uma loja: você cria uma conta, cadastra os produtos e configura os pagamentos. Ela fica no ar no mesmo dia, mas só pode fazer o que o produto permite.

A maior parte dos SaaS é **multi-tenant**: uma aplicação atende todos os clientes (tenants), com os dados de cada um mantidos separados. Dividir a mesma instalação entre tantos clientes é o que torna o SaaS barato e imediato de adotar.

- **Escolha quando** um produto existente já atende à necessidade e a ferramenta não é o que diferencia sua empresa: e-mail, CRM, monitoramento, CI/CD.
- **Evite quando** o software *é* o seu diferencial ou quando você precisa de um nível de customização que o produto nunca vai oferecer.

---

## Blocos gerenciados

Nem tudo cabe na escada acima. O **DBaaS** aplica a mesma entrega a *um único componente*: em vez de operar um servidor Postgres, você aluga um.

<div class="compact-table" markdown>

| Postgres numa VM | Usando um DBaaS |
|---|---|
| Você instala e aplica patches no SO e no banco | O provedor aplica os patches numa janela que você escolhe |
| Você escreve scripts de backup e os testa | Você define o período de retenção |
| Você monta a replicação e o failover | Você liga uma opção (como Multi-AZ no RDS) |
| Schema, consultas, acesso | Schema, consultas, acesso: **isso continua com você** |

</div>

**Exemplos:** AWS RDS, Amazon Aurora, Google Cloud SQL, Azure Database, Neon.

A mesma ideia existe para outros componentes:

<div class="compact-table" markdown>

| Modelo | Sigla | Exemplos |
|---|---|---|
| Armazenamento como Serviço | STaaS | AWS S3, Google Cloud Storage, Backblaze B2 |
| IA / ML como Serviço | AIaaS | AWS Bedrock, Google Vertex AI, Azure AI |
| Monitoramento como Serviço | — | Datadog, New Relic, Grafana Cloud |
| Segurança como Serviço | SECaaS | Cloudflare, AWS Shield, Snyk |
| Comunicação como Serviço | CPaaS | Twilio, SendGrid, AWS SES |

</div>

---

## Comparando os modelos

Leia a tabela por linhas, observando como cada característica muda da esquerda para a direita:

<div class="compact-table" markdown>

| | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **Você implanta** | Tudo | Uma VM | Uma imagem | Código | Uma função | Nada |
| **Controle** | Máximo | Alto | Médio | Médio | Baixo | Mínimo |
| **Tempo até entrar no ar** | Meses | Horas | Minutos | Minutos | Minutos | Imediato |
| **Escala** | Comprar hardware | Manual ou por script | Automática (alguns até zero) | Automática | Automática até zero | Automática |
| **Você paga por** | Hardware (CapEx) | VM-hora | Tempo de container | Instâncias ou uso | Invocações e duração | Usuários ou licenças |
| **Portabilidade** | Total | Alta | Alta (a imagem) | Média | Baixa (API do fornecedor) | Baixa (exportação de dados) |

</div>

---

## Como escolher

**Escolha por componente, não por sistema.** Comece pela opção mais gerenciada e só desça quando um requisito concreto obrigar. Faça estas perguntas em ordem e pare no primeiro **sim**:

<div class="compact-table" markdown>

| # | Pergunta | Se sim |
|---|---|---|
| 1 | Um produto já faz o trabalho? | **SaaS:** GitHub Actions, Datadog |
| 2 | É um banco, cache ou broker padrão? | **Serviço gerenciado:** RDS, ElastiCache, MSK |
| 3 | O trabalho é curto, orientado a eventos e esporádico? | **FaaS:** Lambda, Cloud Functions |
| 4 | Você precisa controlar o SO ou um hardware especial? | **IaaS:** EC2, Compute Engine, Azure VM |
| 5 | É um container e você precisa da API do Kubernetes? | **CaaS, Kubernetes gerenciado:** EKS, GKE, AKS |
| 6 | É um container? | **CaaS, containers gerenciados:** Cloud Run, ECS Fargate |
| | Nenhuma das anteriores | **PaaS:** Heroku, App Engine |

</div>

### Exemplo: a loja, componente por componente

Sistemas reais **misturam** modelos. Passar cada componente da loja pelas perguntas acima dá um resultado razoável na AWS, com a mesma forma do projeto do curso:

``` mermaid-sim
flowchart LR
  client([Cliente]) --> gw["gateway<br/>CaaS: EKS"]
  gw --> acc["account<br/>CaaS: EKS"]
  gw --> ord["order<br/>CaaS: EKS"]
  acc --> db[("Postgres<br/>DBaaS: RDS")]
  ord --> db
  ord --> cache[("Redis<br/>DBaaS: ElastiCache")]
  ord --> kafka["Kafka<br/>gerenciado: Amazon MSK"]
  kafka --> fn["notificação<br/>FaaS: Lambda"]
  fn --> mail["e-mail<br/>CPaaS: AWS SES"]
```

<div class="compact-table" markdown>

| Componente | Por conta própria | Opção gerenciada | O que muda para o time |
|---|---|---|---|
| gateway, account, order | Docker Compose numa VM EC2 (IaaS) | EKS ou ECS Fargate (CaaS) | Sem SSH nem patches do SO; em vez disso, você escreve manifests ou task definitions |
| Postgres | Postgres instalado no EC2 (IaaS) | RDS (DBaaS) | Backups, replicação e failover viram opções de configuração |
| Redis ([Hands-on 8](../../hands-on/8/index.md)) | Container Redis na VM | ElastiCache (DBaaS) | O cache sobrevive ao reinício de uma VM; você paga por nó |
| Kafka ([Hands-on 10](../../hands-on/10/index.md)) | Brokers Kafka em VMs | Amazon MSK | Os patches e a troca de brokers passam para a AWS |
| Notificação do pedido | Um consumidor sempre rodando no cluster | Lambda acionado pelo tópico do Kafka (FaaS) | Paga por mensagem; aceita cold starts num caminho assíncrono |
| CI/CD | Jenkins num container ([Hands-on 4](../../hands-on/4/index.md)) | GitHub Actions (SaaS) | Nenhum servidor Jenkins para atualizar |
| Monitoramento | Prometheus e Grafana ([Hands-on 6](../../hands-on/6/index.md)) | Grafana Cloud ou Datadog (SaaS) | Nenhum armazenamento de métricas para dimensionar; preço por host ou por métrica |

</div>

Passar um componente para um modelo mais gerenciado nunca elimina a linha de dados e acesso: você continua decidindo quem pode se conectar ao RDS, quem alcança o gateway e o que é registrado em log.

??? question "Sua vez: onde você rodaria o serviço exchange, que converte moedas chamando uma API externa de cotações?"
    Siga as perguntas. Nenhum produto faz exatamente esse trabalho e ele não é um banco de dados. Ele responde a requisições síncronas durante o checkout, então o FaaS é possível, mas os cold starts atrapalhariam. Ele não precisa controlar o SO, já é um container e o projeto já tem Kubernetes: **CaaS no EKS**, junto dos outros serviços. Fora do projeto, um time pequeno sem cluster poderia escolher o Cloud Run com bons motivos. Muitas vezes há mais de uma boa resposta: o que importa é a justificativa.

---

## Erros comuns

!!! warning "Erros comuns"
    - **Entender "gerenciado" como "não é problema meu".** A maioria dos vazamentos de dados na nuvem vem de configuração do lado do cliente, como um bucket S3 público, um banco aberto para `0.0.0.0/0` ou uma access key vazada, e não do provedor. Essa camada é sempre sua[^2].
    - **Ignorar o lock-in.** Quanto mais alto o modelo, mais seu código e seus dados dependem da API de um único fornecedor. Prefira interfaces abertas quando elas custam pouco: containers, Postgres e a API do Kubernetes.
    - **Supor que o modelo mais alto é sempre mais barato.** Serviços gerenciados cobram um adicional por unidade. Em pequena escala, isso é muito mais barato do que o tempo de um engenheiro; em escala grande e constante, um time pode economizar operando o componente por conta própria.
    - **Guardar estado numa instância de PaaS ou FaaS.** Arquivos locais e sessões em memória desaparecem num reinício ou numa redução de escala. Mantenha o estado num banco de dados, cache ou armazenamento de objetos.
    - **Usar FaaS para uma API de alto tráfego e sensível à latência.** Cold starts e preço por invocação tornam um container sempre ligado mais barato e mais previsível sob carga constante.

---

## Pontos-chave

- Um modelo de serviço define **quem opera cada camada** da pilha; do IaaS ao SaaS, você entrega cada vez mais dela.
- Mais gerenciado significa **mais velocidade e menos operação**, mas **menos controle e portabilidade**.
- O que você implanta diferencia os modelos: uma VM (IaaS), uma imagem (CaaS), código (PaaS), uma função (FaaS) ou nada (SaaS).
- Um serviço é "nuvem" quando tem as cinco características do NIST e ele transforma CapEx em OpEx, o que nem sempre significa mais barato.
- Sistemas reais misturam modelos: **escolha por componente**, começando pela opção mais gerenciada.
- Seus dados, regras de acesso e configuração são **sempre** sua responsabilidade.

## Conexões

- [Containerização](../containerization/index.md): a imagem Docker que as plataformas de CaaS executam.
- [Microsserviços](../microservices/index.md): por que a loja é dividida em serviços que podem ir cada um para um modelo diferente.
- [Roteiro de deploy na nuvem](../deployment/index.md): a próxima aula, com plataformas concretas (Railway, Fly.io, Lightsail, ECS, EKS) e seus custos.
- [Hands-on 5: Orquestração](../../hands-on/5/index.md): Kubernetes localmente com Minikube, a API que o EKS gerencia para você.
- Projeto: [AWS](../../exercises/project/aws/index.md), [EKS](../../exercises/project/eks/index.md) e [Custos e PaaS](../../exercises/project/costs/index.md).

---

:fontawesome-brands-youtube:{ .youtube } [IaaS vs PaaS vs SaaS](https://www.youtube.com/watch?v=SBQoyZXrpcY){:target="_blank"} — visão geral prática dos três modelos fundamentais (em inglês).


[^1]: MELL, P.; GRANCE, T. [The NIST Definition of Cloud Computing](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf){:target="_blank"}. NIST Special Publication 800-145, 2011.
[^2]: [AWS Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/){:target="_blank"}
[^3]: [Azure Shared Responsibility](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility){:target="_blank"}
[^4]: [Cloud Native Computing Foundation (CNCF)](https://www.cncf.io/){:target="_blank"}
[^5]: WIGGINS, A. [The Twelve-Factor App](https://12factor.net/){:target="_blank"}, 2011.
[^6]: [AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html){:target="_blank"} — tempo limite da função de até 900 segundos (15 minutos).
