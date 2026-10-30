Observe um dia de tráfego da BoxOffice. Da meia-noite às 09:45, a API atende algumas centenas de requisições por segundo. Às 10:00, quando a turnê de um show em estádio abre as vendas, o tráfego salta para dezenas de milhares — em segundos. Às 10:30 já voltou ao normal. O mesmo formato se repete algumas vezes por semana, em horários anunciados com antecedência, além das surpresas (um artista posta o link nas redes sociais às 23:00).

Há duas opções ruins: dimensionar a frota para o pico e pagar por máquinas ociosas 99% do tempo, ou dimensioná-la para a média e cair às 10:00. Esta página cobre as duas famílias de ferramentas que evitam ambas — as **plataformas serverless**, que escalam por requisição e cobram por uso, e o **autoscaling**, que aumenta e diminui uma frota de réplicas com base em métricas ou agendas — e a verdade incômoda que elas compartilham: **escalar leva tempo**, e uma flash sale não espera.

---

## Serverless

**Serverless** significa que você faz o deploy do código e a plataforma provisiona, escala e cobra pelas máquinas por baixo, inclusive **escalando até zero** quando não há tráfego. Dois formatos dominam:

- **Functions as a Service (FaaS)** — AWS Lambda, Google Cloud Run functions, Azure Functions: você faz o deploy de uma *função*, e a plataforma a chama uma vez por evento (uma requisição HTTP, uma mensagem de fila, o upload de um arquivo, um agendamento).
- **Containers serverless** — Google Cloud Run, AWS Fargate (com ECS), Azure Container Apps: você faz o deploy de uma *imagem de container* que atende HTTP; a plataforma executa quantas instâncias o tráfego exigir, até zero.

A ideia já foi descrita como "programação em nuvem simplificada"[^1]: nenhum servidor para atualizar, nenhuma capacidade para planejar, pague apenas pelo que executa. As restrições são o preço.

### Como uma função executa { #how-a-function-runs }

``` diagram-sim
sequenceDiagram
    participant E as Fonte de eventos
    participant P as Plataforma
    participant X as Ambiente de execução
    E->>P: invoca (requisição 1)
    P->>X: nenhum ambiente quente → cria sandbox
    Note over X: INIT: baixa o código, inicia o runtime, roda o código de init (cold start)
    X-->>P: pronto
    P->>X: atende a requisição 1
    X-->>E: resposta
    E->>P: invoca (requisição 2)
    P->>X: reutiliza o ambiente quente
    X-->>E: resposta (sem cold start)
    Note over X: ocioso por um tempo → congelado, depois destruído
```

Cada **ambiente de execução** (uma VM leve ou sandbox) atende **uma requisição por vez** no Lambda; uma rajada de 300 requisições simultâneas precisa de 300 ambientes. Os ambientes são reutilizados enquanto o tráfego continua e destruídos depois de algum tempo ociosos[^2]. Tudo decorre desse modelo:

- **Cold start**: a primeira requisição em um ambiente novo paga pela sua criação. Para uma função pequena em Python ou Node.js, isso costuma levar algumas centenas de milissegundos; para uma aplicação Spring Boot em uma JVM comum, pode levar vários segundos (faixas ilustrativas — meça as suas).
- **Concorrência = taxa × duração** (a lei de Little de novo): 2.000 requisições/s × 0,2 s = **400 ambientes concorrentes**. Reduzir a duração pela metade reduz a concorrência pela metade — e a conta também.
- **O estado morre com o ambiente**: qualquer coisa mantida em memória ou no disco local pode sumir entre requisições; é a regra do stateless da [visão geral](../index.md#stateless-app-servers), imposta pela plataforma.

### Cold starts e como reduzi-los { #cold-starts-and-how-to-reduce-them }

| Técnica | O que faz | Custo |
|---|---|---|
| **Init barato** | menos dependências, carregamento sob demanda, pacote menor | tempo de engenharia |
| **Inicializar fora do handler** | clientes de banco e SDKs criados uma vez por ambiente, reutilizados por todas as requisições | nenhum — faça sempre |
| **Provisioned concurrency / instâncias mínimas** | a plataforma mantém N ambientes quentes | você paga por eles mesmo ociosos — desfazendo em parte o "pague pelo uso" |
| **Restauração de snapshot** (Lambda SnapStart) | parte de um snapshot de um runtime já inicializado (Java, Python, .NET) | restrições a estado único no init (sementes aleatórias, conexões) |
| **Compilação nativa** (GraalVM native image, Spring AOT) | um serviço Java sobe em dezenas de milissegundos | builds mais longos; alguns limites de reflexão |
| **Escolher o runtime** | Go, Node.js e Python sobem mais rápido que uma JVM completa | pode não combinar com a stack do time |

Cold starts importam em caminhos **sensíveis à latência e voltados ao usuário**, com tráfego em picos. Não importam para um consumidor de fila que gera PDFs de ingressos, onde um segundo a mais é invisível.

### Limites de concorrência protegem — e estrangulam { #concurrency-limits-protect-and-throttle }

Serverless escala rápido, mas não infinitamente:

- **Limites de conta e de função**: o AWS Lambda tem uma cota padrão de 1.000 execuções concorrentes por Região, compartilhada por todas as funções da conta (pode ser aumentada), e cada função escala no máximo 1.000 ambientes a cada 10 segundos[^2]. Além do limite, as invocações sofrem **throttling** (`429`), e os eventos assíncronos são reprocessados depois.
- **Reserved concurrency** limita uma função para que ela não deixe as outras sem recursos — e limita também a carga que ela pode colocar sobre um serviço downstream.
- **Concorrência por instância**: containers serverless como o Cloud Run deixam uma instância atender várias requisições ao mesmo tempo (80 por padrão)[^3], o que significa muito menos instâncias — e menos cold starts — para serviços limitados por I/O.

!!! warning "O serverless escala; seu banco de dados não"
    1.000 funções concorrentes, cada uma abrindo uma conexão, significam 1.000 conexões em um servidor PostgreSQL que atende confortavelmente algumas centenas. A camada de funções escalou perfeitamente e derrubou o banco. Coloque um **pool de conexões** (RDS Proxy, PgBouncer) ou uma **fila** entre eles, e configure a reserved concurrency de acordo com o que o downstream aguenta.

### Custo: por uso vs sempre ligado { #cost-per-use-vs-always-on }

FaaS cobra por invocação mais **GB-segundos** (memória × duração). Containers cobram pela capacidade provisionada, usada ou não. Qual sai mais barato depende de quão *ocupado* o serviço é. O gráfico usa preços de tabela ilustrativos (AWS Lambda x86 em us-east-1 no momento em que este texto foi escrito: US$ 0,20 por milhão de requisições e US$ 0,0000166667 por GB-segundo; uma réplica de container a um custo assumido de US$ 60/mês, cada uma atendendo até 300 requisições/s, no mínimo duas para disponibilidade) — confira os preços atuais antes de usá-los em uma decisão real.

```python exec="1" html="1"
import math
from io import StringIO

import matplotlib.pyplot as plt

PER_REQUEST = 0.20 / 1e6            # USD per invocation
PER_GB_S = 0.0000166667             # USD per GB-second
MEMORY_GB, DURATION_S = 0.5, 0.1    # 512 MB, 100 ms average
REPLICA_MONTH, REPLICA_RPS = 60.0, 300.0
SECONDS_PER_MONTH = 30 * 24 * 3600

xs = [10 ** (6 + i / 20) for i in range(0, 81)]          # 1 M .. 10 B requests / month
faas = [r * (PER_REQUEST + MEMORY_GB * DURATION_S * PER_GB_S) for r in xs]
containers = []
for r in xs:
    peak_rps = 3 * r / SECONDS_PER_MONTH                  # assume peak = 3 x average
    containers.append(max(2, math.ceil(peak_rps / (REPLICA_RPS * 0.65))) * REPLICA_MONTH)

fig, ax = plt.subplots(figsize=(8, 3.6))
ax.plot(xs, faas, label="functions (pay per use)", color="#1f77b4")
ax.step(xs, containers, where="post", label="containers (min 2 replicas)", color="#ff7f0e")
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("requests per month")
ax.set_ylabel("USD per month (illustrative)")
ax.set_title("Monthly cost: functions vs always-on containers")
ax.legend(fontsize=8)
ax.grid(True, which="major", alpha=0.3)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Com essas premissas, cada invocação custa cerca de US$ 1 por milhão; assim, funções são muito mais baratas abaixo de aproximadamente cem milhões de requisições por mês (algumas dezenas de requisições por segundo, em média), e containers vencem para serviços estáveis e ocupados. Cargas com picos e majoritariamente ociosas favorecem o serverless; cargas estáveis e de alto volume favorecem a capacidade provisionada. O FinOps ([cloud-native](../../cloud-native/index.md)) parte desse cálculo.

### O panorama { #the-landscape }

=== "AWS"

    - **Lambda** (funções; gatilhos a partir de API Gateway, SQS, S3, EventBridge, Kinesis/Kafka).
    - **Fargate** (containers serverless sob ECS ou EKS).
    - **App Runner** (serviços web em container). Na borda: **CloudFront Functions**, **Lambda@Edge**.

=== "Google Cloud"

    - **Cloud Run** (containers serverless, concorrência por instância, escala até zero) e **Cloud Run functions**.
    - Gatilhos via **Eventarc**, **Pub/Sub**, **Cloud Scheduler**, **Cloud Tasks**.

=== "Azure"

    - **Azure Functions** (planos de consumo e premium, com instâncias pré-aquecidas).
    - **Azure Container Apps** (containers serverless, escalonamento baseado em KEDA).

=== "Código aberto / Kubernetes"

    - **Knative** (containers serverless no Kubernetes, escala até zero).
    - **KEDA** (autoscaling orientado a eventos de qualquer Deployment, inclusive até zero).
    - **OpenFaaS**. Runtimes de borda: **Cloudflare Workers** (isolates V8 com inicialização muito rápida).

!!! example "Onde a BoxOffice usa serverless"

    - **Receptor de webhooks** do provedor de pagamento: tráfego em rajadas, pequeno, precisa responder sempre — verifica a assinatura, armazena o evento, enfileira e retorna `200` ([integrações](../integrations/index.md#webhooks)).
    - **Processamento de imagens** quando o time de marketing faz upload de fotos dos artistas: disparado pelo object store, com minutos de ociosidade entre as rajadas.
    - **Não** para o `inventory`: ele mantém conexões quentes com o banco de dados, precisa de um p99 previsível durante a abertura de vendas e roda o dia todo — containers com autoscaling se encaixam melhor.

### Experimente no playground { #try-it-in-the-playground }

Abra o cenário `serverless-burst`: uma função serverless atrás de uma API recebe uma rajada.

1. Rode o perfil **spike** e observe o p99 nos primeiros segundos: a penalidade do cold start.
2. Reduza o **limite de concorrência** da função até aparecerem requisições estranguladas (erros); depois aumente-o e veja o que acontece com o banco de dados por trás.
3. Compare o **custo** ao vivo com a mesma carga em uma camada de containers (troque o nó por um App Server com autoscaling).

<div class="sdp" data-scenario="serverless-burst" data-mode="compact" data-height="520" data-profile="spike"></div>

[:material-open-in-new: Abrir o simulador completo](../../../../playground/index.md)

---

## Autoscaling

O **autoscaling** ajusta a capacidade automaticamente. Ele opera em três níveis, que precisam funcionar juntos:

| Nível | O que muda | Kubernetes | VMs na nuvem |
|---|---|---|---|
| **Horizontal** | número de réplicas | HorizontalPodAutoscaler (HPA), KEDA | Auto Scaling groups, managed instance groups |
| **Vertical** | CPU/memória de cada réplica | VerticalPodAutoscaler (VPA) | tipo de instância (geralmente com reinício) |
| **Infraestrutura** | número de nós em que as réplicas rodam | Cluster Autoscaler, Karpenter | — |

O HPA adiciona pods, mas, se nenhum nó tiver espaço, os pods ficam `Pending` até o cluster autoscaler adicionar um nó — o que demora bem mais. Os dois laços importam para o tempo de resposta.

### Políticas { #policies }

| Política | Como decide | Boa para | Fraqueza |
|---|---|---|---|
| **Target tracking** | mantém uma métrica perto de um alvo ("CPU em 60%") | a maioria dos serviços | reage depois que a carga chega |
| **Step scaling** | adiciona k réplicas quando uma métrica cruza limiares | regras grosseiras e explícitas | ajuste fino; continua reativa |
| **Agendada** | muda mín./máx. em horários definidos | eventos **conhecidos**: abertura de vendas às 10:00, horário comercial | só é tão boa quanto o calendário |
| **Preditiva** | prevê a partir do histórico (p. ex., ciclos diários) e escala antes | padrões diários ou semanais fortes e regulares | inútil para eventos pontuais |
| **Baseada em fila** | réplicas proporcionais ao backlog ou ao lag | workers ([trabalho assíncrono](../async-work/index.md)) | o paralelismo máximo pode ser limitado (partições do Kafka) |

### O HPA do Kubernetes { #the-kubernetes-hpa }

A cada 15 segundos (por padrão), o HPA calcula[^4]:

$$
\text{desiredReplicas} = \left\lceil \text{currentReplicas} \times \frac{\text{currentMetric}}{\text{targetMetric}} \right\rceil
$$

Seis réplicas do `catalog` a 90% de CPU com alvo de 60%: ⌈6 × 90 / 60⌉ = **9 réplicas**. Ele ignora variações dentro de uma tolerância de 10% e usa **janelas de estabilização** para não oscilar (a redução espera 5 minutos por padrão).

```yaml title="catalog-hpa.yaml"
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: catalog
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: catalog
  minReplicas: 4                 # never below N+1 across zones
  maxReplicas: 40                # bounded by what the database can take
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60   # % of the CPU *request* of each pod
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100               # at most double every 15 s
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 20                # remove at most 20% per minute
          periodSeconds: 60
```

A utilização de CPU é medida em relação ao **request** de CPU do pod; portanto, o HPA só funciona se os requests estiverem definidos (e forem realistas). O [Hands-on 10](../../../hands-on/10/index.md) executa uma versão deste HPA do tamanho de um notebook, sob uma carga do k6 (quadro abaixo).

!!! example "No código do BoxOffice: o HPA do `catalog` (lab 10)"

    O [Hands-on 10 — Autoscaling](../../../hands-on/10/autoscaling/index.md) mantém o alvo de 60% e o scale-up que "no máximo dobra a cada 15 s", e muda os números para caber num notebook: de 2 a 8 pods em vez de 4 a 40, uma segunda política de scale-up de `+2 pods` (vale a que acrescentar mais) e uma janela de scale-down de 2 minutos em vez de 5, para que você veja os pods saírem dentro do lab. Os 60% são relativos ao request de `250m` do pod, então o HPA acrescenta pods quando eles passam de 150 milicores em média. O que o lab mostra é o [atraso](#autoscaling-lag): cada pod novo precisa de dezenas de segundos até ficar pronto, e o p95 sobe durante a rampa antes de voltar a cair. O limite superior é o banco: 8 pods × 10 conexões = 80 conexões a um PostgreSQL.

    ``` { .yaml title="k8s/base/catalog-hpa.yaml (lab 10)" }
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog-hpa.yaml"
    ```

### Escolhendo a métrica { #choosing-the-metric }

| Métrica | Use quando | Ressalva |
|---|---|---|
| Utilização de CPU | serviços limitados por CPU (renderização, APIs pesadas em JSON) | serviços limitados por I/O parecem ociosos enquanto estão saturados |
| Requisições por segundo por réplica | você conhece a capacidade de uma réplica pelos testes de carga | exige métricas customizadas (Prometheus adapter) |
| Requisições em andamento / concorrência | serviços limitados por I/O, requisições longas | exige instrumentação |
| Profundidade da fila ou lag do consumidor | workers | o máximo útil de réplicas pode ser limitado (partições) |
| Latência | quase nunca sozinha | ela sobe por muitos motivos, inclusive um downstream lento que mais réplicas tornariam *pior* |

### Escalando workers pela profundidade da fila { #scaling-workers-on-queue-depth }

O **KEDA** (Kubernetes Event-Driven Autoscaling) alimenta o HPA com métricas de fontes de eventos — lag do Kafka, profundidade do SQS, tamanho de fila do RabbitMQ, consultas ao Prometheus, cron — e consegue escalar um Deployment **até zero** quando não há nada a fazer[^5]:

```yaml title="ticket-worker-scaledobject.yaml"
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: ticket-worker
spec:
  scaleTargetRef:
    name: ticket-worker            # the Deployment
  minReplicaCount: 1
  maxReplicaCount: 24              # = partitions of order.confirmed.v1
  cooldownPeriod: 120
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka:9092
        consumerGroup: ticket-worker
        topic: order.confirmed.v1
        lagThreshold: "200"        # target lag per replica
```

Com um lag de 4.800 mensagens e um limiar de 200, o KEDA pede 24 réplicas — o teto, porque um consumer group do Kafka não consegue usar mais consumidores do que o tópico tem partições ([mensageria](../../messaging/index.md)).

---

## O atraso do autoscaling { #autoscaling-lag }

O autoscaling reativo tem um atraso embutido: a carga precisa chegar, ser medida, disparar uma decisão, e a nova capacidade precisa subir e aquecer. Cada passo é pequeno; somados, são minutos:

| Passo | Duração típica (ilustrativa) |
|---|---|
| Métricas coletadas e agregadas | 15–60 s |
| Laço de avaliação do HPA | até 15 s |
| Pod agendado — se algum nó tiver espaço | ~1 s |
| Novo nó provisionado — se não tiver | 30–120 s |
| Imagem baixada (sem cache no nó) | 5–60 s |
| Inicialização da JVM, contexto Spring, pools de conexão, aquecimento de cache | 10–60 s |
| Readiness probe passa, load balancer adiciona o pod | 5–10 s |
| **Total** | **~1 a 4 minutos** |

Uma flash sale vai de 1× a 20× em segundos (aqui, de 1.000 a 20.000 req/s em 20 s). A simulação abaixo compara um autoscaler reativo (alvo de 60%, no máximo dobrando a cada 15 s, novas réplicas prontas após 90 s) com o mesmo autoscaler mais um pré-escalonamento **agendado** às 09:45 para a previsão, 20.000 / (500 × 0,6) ≈ 67 réplicas:

```python exec="1" html="1"
import math
from io import StringIO

import matplotlib.pyplot as plt

REPLICA_RPS = 500.0      # capacity of one replica
TARGET = 0.6             # target utilization
WARMUP = 90              # seconds until a new replica serves traffic
T0, T1 = -900, 900       # from 09:45 to 10:15, in seconds relative to 10:00


def demand(t):
    if t < 0:
        return 1000.0
    return 1000.0 + 19000.0 * min(1.0, t / 20.0)           # 20k req/s within 20 s


def simulate(prescale_to):
    ready, pending = 3, []                                 # pending: (ready_at, count)
    xs, cap = [], []
    for t in range(T0, T1):
        if t == T0 and prescale_to:
            pending.append((t + WARMUP, prescale_to - ready))
        ready += sum(c for at, c in pending if at == t)
        pending = [(at, c) for at, c in pending if at != t]
        if t % 15 == 0:                                    # HPA loop
            total = ready + sum(c for _, c in pending)
            util = demand(t) / (ready * REPLICA_RPS)
            desired = math.ceil(ready * util / TARGET)
            desired = min(desired, 2 * total)              # at most double per period
            if desired > total:
                pending.append((t + WARMUP, desired - total))
        xs.append(t / 60)
        cap.append(ready * REPLICA_RPS / 1000)
    return xs, cap


xs, reactive = simulate(None)
_, scheduled = simulate(67)
need = [demand(t) / 1000 for t in range(T0, T1)]

fig, ax = plt.subplots(figsize=(8, 3.6))
ax.plot(xs, need, color="black", linewidth=1.5, label="demand")
ax.plot(xs, reactive, color="#d62728", label="capacity: reactive only")
ax.plot(xs, scheduled, color="#2ca02c", linestyle="--", label="capacity: pre-scaled at 09:45 to 67")
ax.fill_between(xs, reactive, need, where=[n > r for n, r in zip(need, reactive)],
                color="#d62728", alpha=0.15)
ax.set_xlabel("minutes relative to 10:00 (on-sale)")
ax.set_ylabel("thousand req/s")
ax.set_title("Reactive autoscaling lags a flash sale")
ax.legend(fontsize=8, loc="center left")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

A área vermelha é a demanda acima da capacidade: requisições que ficam na fila, estouram o timeout ou são rejeitadas — nos primeiros minutos da venda, exatamente quando mais importa. O escalonamento reativo acaba alcançando a demanda, mas só **depois** que os fãs já tiveram uma experiência ruim.

### Escalonamento agendado e preditivo { #scheduled-and-predictive-scaling }

Quando você sabe que o pico vai chegar, **não espere pelas métricas**:

- **Escalonamento agendado**: às 09:45, aumente o `minReplicas` (ou o mínimo do Auto Scaling group) para a previsão das 10:00, e reduza de volta às 10:45. Com o KEDA, um gatilho `cron` faz exatamente isso.
- **Pré-aqueça tudo de que as réplicas precisam**: nós (overprovisioning com pods "reserva" de baixa prioridade, que são despejados quando os pods reais precisam do espaço), imagens baixadas, caches preenchidos, pools de conexão com o banco abertos.
- **Escalonamento preditivo** (p. ex., o predictive scaling da AWS) aprende ciclos diários e semanais a partir do histórico e escala antes deles. Ajuda com o pico regular do fim da tarde, não com uma abertura de vendas pontual.

E quando nem isso basta — dois milhões de fãs para 60 mil lugares —, capacidade não é a resposta: uma **sala de espera** admite fãs na taxa que o sistema consegue atender, o **rate limiting** barra os bots, e o **load shedding** rejeita o excesso cedo e a baixo custo ([edge](../../edge/index.md), [confiabilidade](../../reliability/index.md)). O cenário `flash-sale` do [playground](../../../../playground/index.md) combina todos eles.

### Reduzindo com segurança { #scaling-in-safely }

Reduzir a escala também causa incidentes:

- **Flapping**: reduzir assim que a carga cai e logo aumentar de novo; janelas de estabilização e políticas de redução lentas evitam isso.
- **Matar trabalho em andamento**: as réplicas precisam drenar ao receber `SIGTERM` (graceful shutdown, [visão geral](../index.md#a-replicas-life-cycle)); os workers precisam parar de pegar jobs e terminar ou liberar o atual.
- **Escalar até zero** economiza dinheiro, mas traz de volta o cold start para a próxima requisição; mantenha um mínimo nos caminhos voltados ao usuário.

!!! warning "Não faça autoscaling contra uma parede"
    Defina o `maxReplicas` a partir do **orçamento do downstream**, não da esperança. Se o PostgreSQL aceita 500 conexões e cada réplica mantém um pool de 20, mais de 25 réplicas não conseguirão se conectar — e o autoscaler, vendo a latência alta, vai adicionar mais. Use um pool de conexões (PgBouncer), pools menores ou caches para reduzir a carga no banco, e crie um alerta para quando o HPA ficar parado no máximo.

---

## Containers ou serverless? { #containers-or-serverless }

| | Containers + HPA (Kubernetes) | Containers serverless (Cloud Run, Fargate) | Funções (Lambda) |
|---|---|---|---|
| Velocidade para escalar | pods: segundos; nós: minutos | segundos | de frações de segundo a segundos por ambiente |
| Escala até zero | com KEDA/Knative | sim | sim |
| Cold start | a cada pod novo (JVM: segundos) | a cada instância | a cada ambiente, com mais frequência |
| Concorrência por instância | muitas requisições | muitas requisições (configurável) | uma requisição (Lambda) |
| Conexões longas, WebSockets | sim | limitadas | só via um gateway gerenciado |
| Duração máxima da requisição | ilimitada | minutos (limite da plataforma) | 15 min (Lambda) |
| Formato do custo | paga pelos nós provisionados | paga pelo uso (CPU-segundos), instâncias mínimas opcionais | paga por invocação + GB-segundos |
| Esforço operacional | o maior (cluster) | baixo | o menor |
| Melhor para | serviços centrais estáveis e ocupados | APIs com períodos ociosos, times pequenos | cola entre eventos, webhooks, jobs em rajadas |

!!! tip "Na entrevista"

    Quando o problema tiver picos, diga explicitamente que **o autoscaling não é instantâneo**: *"O escalonamento reativo leva de um a alguns minutos — métricas, decisão, nó, imagem, aquecimento da JVM —, então para uma abertura de vendas conhecida eu pré-escalaria por agendamento às 09:45, e para picos inesperados contaria com folga, uma sala de espera e load shedding enquanto o HPA alcança a demanda."* Nomeie a métrica (*"CPU para o catalog, lag do consumidor para os workers de ingressos via KEDA"*), os limites (*"máximo de réplicas limitado pelas conexões do banco"*) e, se propuser serverless, as limitações dele (*"cold starts, cotas de concorrência, conexões com o banco — eu colocaria um RDS Proxy na frente"*).

!!! success "Boas práticas"

    - **Pré-escale para eventos conhecidos** — aumente o `minReplicas` (ou agende a mudança) uns 15 minutos antes das 10:00; o escalonamento reativo é para a carga que você não esperava. Na BoxOffice: a conclusão do [lab 10](../../../hands-on/10/autoscaling/index.md).
    - **Defina os requests de CPU a partir de um teste de carga** — o request é a CPU que um pod usa na sua vazão-alvo; os 60% do HPA são uma fração desse número, então um request chutado é um gatilho chutado. Na BoxOffice: `250m` para o `catalog` (lab 10).
    - **Escale para cima rápido e para baixo devagar** — dobre a cada 15 s na subida, remova poucos pods por minuto depois de uma janela de minutos na descida, para que uma pausa entre duas ondas de fãs não remova a capacidade necessária um minuto depois. Na BoxOffice: `catalog-hpa.yaml` (quadro acima).
    - **Teste a carga do escalonamento, não só do serviço** — uma rampa que registra réplicas desejadas vs prontas mede o atraso que a sua folga precisa cobrir. Na BoxOffice: `load/catalog-hpa.js` e `scripts/watch-hpa.sh` (lab 10).
    - **Limite a concorrência das funções e crie um alarme de orçamento** — a concorrência reservada protege o banco atrás das funções, e um alarme de cobrança pega um laço descontrolado em horas, não no fim do mês.

!!! warning "Armadilhas comuns"

    - **Supor elasticidade instantânea**: os primeiros minutos de um pico são atendidos pelo que já estava rodando.
    - **Pods sem requests de CPU**: o HPA não tem contra o que calcular a utilização.
    - **Escalar pela métrica errada**: CPU para serviços limitados por I/O; latência que sobe por causa de um downstream lento.
    - **`maxReplicas` acima do que o banco aguenta**: o autoscaler transforma lentidão em indisponibilidade.
    - **Serverless na frente de um banco de tamanho fixo** sem pool de conexões nem reserved concurrency.
    - **Inicialização pesada** dentro do handler em vez de uma vez por ambiente.
    - **Custo descontrolado**: uma função que dispara a si mesma (escreve no bucket que a dispara) ou um laço de retry sem limite escala até a cota e cobra de acordo — defina orçamentos e alarmes.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    FAAS["funções por evento"] --> COLD["cold starts,<br/>concorrência provisionada"]
    FAAS --> CONC["concorrência = taxa × duração<br/>cotas, throttling"]
    CONC --> DOWN["o banco não escala junto<br/>→ Bancos de dados"]
    FAAS --> COST["por uso vs sempre ligado<br/>→ FinOps"]
    AS["autoscaling"] --> HPA["HPA, KEDA, VPA, autoscalers de nós<br/>→ Kubernetes"]
    HPA --> MET["métrica: CPU, RPS,<br/>concorrência, atraso da fila"]
    AS --> LAG["minutos de atraso"]
    LAG --> SCHED["escala agendada + pré-aquecimento<br/>para a abertura das 10:00"]
    LAG --> PROT["sala de espera, rate limiting,<br/>descarte de carga → Confiabilidade"]
    HPA --> MAX["maxReplicas a partir do<br/>orçamento do downstream"]
    MAX --> DOWN
```

**Componentes da paleta:** [`serverless`](../../../reference/components/compute/index.md#serverless) (webhooks, redimensionamento de imagens, cola para rajadas) · [`app`](../../../reference/components/compute/index.md#app) (os containers que o HPA escala) · [`worker`](../../../reference/components/compute/index.md#worker) (KEDA pelo atraso da fila) · [`queue`](../../../reference/components/messaging/index.md#queue) (o sinal de atraso) · [`sql`](../../../reference/components/storage/index.md#sql) (o orçamento de conexões que limita `maxReplicas`) · [`apigw`](../../../reference/components/edge/index.md#apigw) (rate limiting enquanto a capacidade alcança a demanda) · [`metrics`](../../../reference/components/observability/index.md#metrics) (o que o autoscaler lê). **Cenários:** `serverless-burst`, `scale-out`, `async-queue`, `flash-sale`. **Continua em:** [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Cloud-native — FinOps](../../cloud-native/finops/index.md), [Confiabilidade — descarte de carga](../../reliability/patterns/index.md#load-shedding), [Estimativa — filas](../../estimation/queueing/index.md), [Exercício: autoscaling no Kubernetes](../../../exercises/kubernetes-autoscaling/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - O **serverless** escala por requisição e cobra por uso; atenção aos **cold starts**, à **concorrência = taxa × duração**, às cotas da conta e ao **downstream** que não escala junto.
    - Ele é mais barato para cargas com picos e majoritariamente ociosas; containers sempre ligados vencem para serviços estáveis e ocupados.
    - O **autoscaling** atua sobre réplicas (HPA, KEDA), tamanho da réplica (VPA) e nós (Cluster Autoscaler, Karpenter); escolha a métrica que reflete a saturação — CPU, RPS, concorrência ou **lag da fila**.
    - O escalonamento reativo atrasa **minutos**; para picos conhecidos, **escale por agendamento** e pré-aqueça; para os desconhecidos, mantenha folga e proteja o sistema com salas de espera, rate limiting e load shedding.
    - Limite o autoscaler pelo que os armazenamentos compartilhados aguentam.

---

[^1]: JONAS, E. et al. [Cloud Programming Simplified: A Berkeley View on Serverless Computing](https://arxiv.org/abs/1902.03383){target="_blank"}. UC Berkeley, 2019.
[^2]: AWS. [Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html){target="_blank"} e [Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html){target="_blank"}. AWS Lambda Developer Guide.
[^3]: Google Cloud. [Maximum concurrent requests per instance](https://cloud.google.com/run/docs/about-concurrency){target="_blank"}. Documentação do Cloud Run.
[^4]: Kubernetes. [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/){target="_blank"}.
[^5]: [KEDA — Kubernetes Event-driven Autoscaling](https://keda.sh/docs/){target="_blank"}.
