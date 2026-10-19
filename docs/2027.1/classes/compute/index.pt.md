São 09:59 do dia em que a turnê de estádios entra à venda na **BoxOffice**. Dois milhões de fãs estão atualizando a página do evento; existem 60 mil lugares. Nos próximos dez minutos a plataforma precisa renderizar o catálogo para milhões de visualizações de página, reservar e vender lugares sem venda duplicada, cobrar cartões por meio de um provedor de pagamentos externo, gerar 60 mil ingressos e e-mails e liberar os lugares cujas reservas expiraram. Às 03:00, a mesma plataforma atende algumas centenas de requisições por segundo.

A borda ([aula 4](../edge/index.md)) decide *para onde* vai cada requisição. Esta aula trata do que acontece quando ela chega: **onde o código roda, como ele é dividido em serviços, como esses serviços conversam, o que roda fora da requisição, como a frota cresce e encolhe sozinha e como depender com segurança de sistemas que você não controla** — o provedor de pagamentos, o provedor de e-mail, qualquer API de terceiros.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** por que servidores de aplicação devem ser stateless e **mover** cada tipo de estado (sessões, arquivos, caches, agendamentos) para o lugar certo.
    - **Estimar** quantas réplicas um serviço precisa para um dado pico, usando a capacidade por instância e uma utilização-alvo.
    - **Comparar** um monólito, um monólito modular e microsserviços, e **justificar** fronteiras de serviço com bounded contexts e a lei de Conway.
    - **Escolher** um estilo de API (REST, gRPC, GraphQL, assíncrono) para uma interação e **evoluir** um contrato sem quebrar seus consumidores.
    - **Projetar** trabalho em segundo plano com filas, workers e schedulers que sejam seguros diante de retries e de múltiplas réplicas.
    - **Decidir** entre containers e serverless, e **configurar** autoscaling (target tracking, HPA, baseado em fila, agendado) para uma carga com picos.
    - **Integrar** um provedor externo com segurança: idempotency keys, webhooks verificados, retries com backoff, reconciliação e um plano para quedas do provedor.

## Roteiro

1. **Esta visão geral** — a paleta de computação, servidores de aplicação stateless, escalabilidade horizontal e quantas réplicas você precisa.
2. [Serviços](services/index.md) — monólito, monólito modular e microsserviços; bounded contexts de DDD; lei de Conway; a arquitetura *dentro* de um serviço; auth, busca, notificações e analytics como serviços.
3. [Estilos de API](api-styles/index.md) — REST, gRPC, GraphQL e APIs assíncronas para o mesmo recurso da BoxOffice; contratos, OpenAPI e versionamento.
4. [Trabalho assíncrono](async-work/index.md) — workers e jobs em segundo plano, design de jobs, schedulers, locks distribuídos e eleição de líder.
5. [Serverless e autoscaling](serverless-autoscaling/index.md) — functions as a service, cold starts e concorrência; políticas de autoscaling, HPA e por que o escalonamento reativo fica atrás de uma venda relâmpago.
6. [Integrações externas](integrations/index.md) — APIs de terceiros, provedores de pagamento e de e-mail: webhooks com assinaturas, idempotency keys, retries, reconciliação e quedas do provedor.
7. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/compute.html" title="Slides: computação e serviços" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/compute.html){:target="_blank"}

---

## A paleta de computação

No [System Design Playground](../../../playground/index.md), a categoria **COMPUTE** agrupa todos os componentes que *executam o seu código*. Cada um é uma resposta diferente à pergunta "onde esta parte da lógica executa, e como ela escala?":

| Componente | O que executa | Exemplo na BoxOffice | Escala com |
|---|---|---|---|
| [App Server](../../reference/components/compute/index.md#app) | Handlers de requisição/resposta atrás de um load balancer | `catalog`, `inventory`, `order` | requisições por segundo, CPU |
| [Worker](../../reference/components/compute/index.md#worker) | Jobs retirados de uma fila, fora de qualquer requisição de usuário | geração do PDF do ingresso, envio de e-mail | profundidade da fila, consumer lag |
| [Serverless](../../reference/components/compute/index.md#serverless) | Funções curtas iniciadas pela plataforma a cada evento | redimensionar a imagem de um artista no upload; receber webhooks | invocações simultâneas |
| [Auth Service](../../reference/components/compute/index.md#auth) | Login, tokens, sessões, identidade | `auth` emite JWTs para fãs e equipe | logins por segundo (picos na abertura das vendas) |
| [Search](../../reference/components/compute/index.md#search) | Consultas full-text e por facetas sobre um índice | "coldplay são paulo" → eventos | consultas por segundo, tamanho do índice |
| [Scheduler](../../reference/components/compute/index.md#scheduler) | Trabalho disparado por tempo (cron, jobs atrasados) | abrir a venda às 10:00; liberar reservas expiradas | número de jobs, precisão |
| [Notifications](../../reference/components/compute/index.md#notifications) | Fan-out para provedores de e-mail, push e SMS | "seus ingressos chegaram" | mensagens por segundo, limites do provedor |
| [Analytics](../../reference/components/compute/index.md#analytics) | Ingestão e agregação de eventos | dashboard de vendas por minuto | eventos por segundo |

O restante desta página trata do mais comum deles — o **app server** — e da propriedade que torna todo o resto possível: ser **stateless**.

---

## App servers stateless { #stateless-app-servers }

Um servidor é **stateless** (sem estado) quando não guarda, entre uma requisição e outra, nada de que outra réplica precisaria: qualquer réplica pode atender qualquer requisição, porque tudo o que precisa sobreviver fica *fora* do processo — em um banco de dados, um cache, um object store ou no próprio cliente. É essa única propriedade que permite ao load balancer mandar cada requisição para qualquer lugar, permite adicionar réplicas em segundos e permite matar uma réplica sem perder nada.

``` mermaid-sim
flowchart LR
    fan([Fã]) --> lb["Load balancer"]
    lb --> a1["catalog #1"]
    lb --> a2["catalog #2"]
    lb --> a3["catalog #3"]
    a1 --> redis[("Redis<br/>sessões, cache")]
    a2 --> redis
    a3 --> redis
    a1 --> pg[("PostgreSQL")]
    a2 --> pg
    a3 --> pg
    a3 --> s3[("Object store<br/>imagens, PDFs")]
```

As réplicas são caixas intercambiáveis; o estado fica nos armazenamentos compartilhados à direita. Cada tipo de estado que tende a "grudar" em um servidor tem uma nova casa padrão:

| Estado que gruda no servidor | Por que quebra a escalabilidade | Onde deveria ficar |
|---|---|---|
| Sessão HTTP em memória (carrinho, login) | A próxima requisição pode cair em outra réplica → "você foi deslogado" | Um token assinado no cliente (JWT) ou um session store (Redis) |
| Arquivos enviados no disco local | Outras réplicas não os enxergam; somem quando o pod morre | Object store (S3, GCS, MinIO) |
| Cache dentro do processo | Cada réplica tem uma cópia diferente e desatualizada | Um cache distribuído (Redis) — ou aceitar TTLs curtos por réplica |
| Jobs agendados dentro da aplicação (`@Scheduled`) | Com 10 réplicas o job roda 10 vezes | Um [scheduler com lock ou líder](async-work/index.md#schedulers) |
| Contadores e rate limits em memória | Cada réplica conta só a sua parte | Redis (`INCR`) ou o API gateway |
| Conexões WebSocket | Uma conexão *é* estado, presa a uma réplica | Mantenha-a, mas publique as mensagens via pub/sub para que qualquer réplica alcance qualquer usuário |

!!! example "BoxOffice: a reserva de lugar"

    Quando um fã escolhe o lugar `C-14`, o serviço `inventory` cria uma **reserva** (*hold*) que expira em 10 minutos. Uma primeira versão tentadora guarda a reserva em um `ConcurrentHashMap` dentro da réplica. Funciona no notebook e falha em produção: o próximo clique vai para outra réplica, que não conhece a reserva; um restart esquece todas as reservas; duas réplicas vendem o mesmo lugar. A reserva precisa morar no armazenamento compartilhado que garante "um lugar, uma reserva" — uma linha no PostgreSQL com uma unique constraint (ou uma chave no Redis gravada com `NX` e uma expiração). A aula 6 ([bancos de dados](../databases/index.md)) mostra a transação que torna isso seguro.

Este é o fator VI do *Twelve-Factor App*: "execute a aplicação como um ou mais processos stateless"[^1]. Isso não significa que o *sistema* não tenha estado — significa que o estado fica concentrado em poucos componentes construídos para guardá-lo, que você então escala com técnicas diferentes (réplicas, partições, caches: aulas 6 e 7).

!!! warning "Sticky sessions são uma muleta"
    Um load balancer pode prender cada usuário a uma réplica (*session affinity*). Isso esconde o problema sem resolvê-lo: a carga fica desigual (uma réplica recebe os usuários mais pesados) e, quando essa réplica morre ou é removida no scale-in, seus usuários perdem o estado. Use afinidade apenas para tráfego orientado a conexão (WebSockets) ou como passo temporário enquanto o estado é movido para fora.

---

## Escalar para cima ou para fora

Há duas formas de dar mais capacidade a um serviço:

| | **Escala vertical** (scale up) | **Escala horizontal** (scale out) |
|---|---|---|
| Como | Uma máquina maior: mais vCPUs, mais memória | Mais máquinas (réplicas) atrás de um load balancer |
| Limite | O maior tipo de instância; o preço cresce mais rápido que o tamanho | Os armazenamentos compartilhados atrás das réplicas |
| Disponibilidade | Uma caixa só: a falha dela é a sua indisponibilidade | As réplicas cobrem umas às outras |
| Downtime para mudar | Normalmente um restart | Nenhum — adiciona e remove réplicas em funcionamento |
| Exige | Nada do código | App servers **stateless** |
| Bom para | Bancos de dados, correções rápidas, sistemas pequenos | App servers, workers, qualquer coisa stateless |

App servers são escalados **para fora** quase por padrão, porque ser stateless torna isso trivial. Bancos de dados normalmente são escalados **para cima** primeiro, depois com réplicas e partições — é por isso que a camada de dados, e não a de aplicação, é onde a maioria dos gargalos acaba aparecendo.

### Quantas réplicas?

A pergunta que todo design precisa responder com um número. Parta da capacidade de uma réplica, medida com um teste de carga ([hands-on 2](../../hands-on/2/index.md)), e da carga de pico da sua estimativa ([aula 2](../estimation/index.md)):

$$
N = \left\lceil \frac{\text{RPS de pico}}{\text{RPS por réplica} \times \text{utilização-alvo}} \right\rceil + \text{folga}
$$

**Por que uma utilização-alvo** (tipicamente 50–70%)? Porque a latência não é linear na carga. À medida que um servidor se aproxima de 100% ocupado, as requisições começam a enfileirar e o tempo de espera explode — o "joelho" da curva ([filas](../estimation/queueing/index.md)). O alvo deixa folga para rajadas e para a perda de uma réplica.

!!! example "Exemplo resolvido — o serviço `catalog` na abertura das vendas"

    Suponha (números ilustrativos): uma réplica do `catalog` tem 10 vCPUs e gasta 20 ms de CPU por requisição, então consegue completar no máximo 10 / 0,020 = **500 requisições/s**. A borda faz cache da maior parte da página estática, e a API recebe **4.000 requisições/s** no pico.

    - Com 100% de utilização você precisaria de 4.000 / 500 = **8** réplicas — sem folga nenhuma, toda rajada enfileira.
    - Com alvo de 65%: 4.000 / (500 × 0,65) ≈ 12,3 → **13** réplicas.
    - Some uma réplica de folga, **N + 1** (ou uma zona inteira, se você roda em três zonas): **14** réplicas.

O gráfico abaixo deixa o joelho visível. Ele modela cada réplica como um servidor de 10 núcleos com 20 ms de trabalho por requisição (uma fila M/M/10) e distribui 4.000 requisições/s igualmente entre N réplicas:

```python exec="1" html="1"
import math
from io import StringIO

import matplotlib.pyplot as plt

LAMBDA = 4000.0   # total requests per second
CORES = 10        # servers (cores) per replica
S = 0.020         # seconds of work per request


def mean_latency_ms(n_replicas):
    lam = LAMBDA / n_replicas          # arrival rate per replica
    a = lam * S                        # offered load in Erlangs
    rho = a / CORES
    if rho >= 1:
        return float("inf"), rho
    # Erlang C: probability that a request has to wait
    top = a**CORES / math.factorial(CORES) / (1 - rho)
    bottom = sum(a**k / math.factorial(k) for k in range(CORES)) + top
    p_wait = top / bottom
    wq = p_wait * S / (CORES * (1 - rho))
    return (wq + S) * 1000, rho


ns = list(range(9, 17))
lat, util = zip(*(mean_latency_ms(n) for n in ns))

fig, ax = plt.subplots(figsize=(8, 3.6))
colors = ["#d62728" if u > 0.8 else "#ff7f0e" if u > 0.7 else "#2ca02c" for u in util]
bars = ax.bar([str(n) for n in ns], lat, color=colors)
for b, u in zip(bars, util):
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.5, f"{u:.0%}",
            ha="center", fontsize=8)
ax.axhline(S * 1000, color="gray", linestyle="--", linewidth=1)
ax.text(len(ns) - 0.6, S * 1000 + 0.8, "pure work: 20 ms", ha="right", fontsize=8, color="gray")
ax.set_xlabel("replicas (label on bar = utilization per replica)")
ax.set_ylabel("mean latency (ms)")
ax.set_title("4,000 req/s on N replicas of 10 cores, 20 ms per request")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Com 8 réplicas a fila cresce sem limite (100% ocupado). Com 9 réplicas (89% ocupadas) a latência média fica em torno de 31 ms — 60% acima dos 20 ms de trabalho real; a partir de cerca de 12 réplicas, adicionar mais quase não muda a média. E a **cauda** (p99) se degrada muito antes e muito mais rápido que a média ([percentis](../estimation/percentiles/index.md)) — mais um motivo para manter a utilização moderada.

??? question "Pense primeiro: por que não rodar logo 100 réplicas?"

    Três motivos. **Custo**: você paga capacidade ociosa o dia inteiro para cobrir dez minutos de pico — a motivação para o [autoscaling](serverless-autoscaling/index.md). **Armazenamentos compartilhados**: 100 réplicas × um pool de 20 conexões com o banco = 2.000 conexões, mais do que um servidor PostgreSQL deveria aceitar (cada conexão é um processo com memória própria); o gargalo simplesmente migra para o banco. **Retornos decrescentes**: quando a fila desaparece, réplicas extras não deixam uma requisição mais rápida — os 20 ms de trabalho continuam lá.

### Experimente no playground

Abra o cenário `scale-out`: um load balancer na frente de N réplicas da aplicação.

1. Rode o perfil **load** com 2 réplicas e anote o p99 e a taxa de erros.
2. Adicione réplicas uma de cada vez e observe o p99 cair até se estabilizar — o ponto em que a fila desaparece.
3. Coloque o caos em **medium** para matar réplicas aleatoriamente: os health checks tiram as réplicas mortas do pool, e as restantes só absorvem a carga se você deixou folga.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520" data-profile="load"></div>

[:material-open-in-new: Abrir o simulador completo](../../../playground/index.md)

---

## O ciclo de vida de uma réplica { #a-replicas-life-cycle }

Escalar para fora significa que réplicas são criadas e destruídas o tempo todo — por deploys, pelo autoscaler, por falhas de nós. Uma réplica que se comporta bem durante seu ciclo de vida é tão importante quanto uma réplica stateless:

``` mermaid-sim
stateDiagram-v2
    [*] --> Starting : agendada em um nó
    Starting --> Ready : startup + readiness probe passam
    Ready --> NotReady : readiness falha (ex.: banco inacessível)
    NotReady --> Ready : readiness volta a passar
    Ready --> Draining : SIGTERM (deploy, scale-in)
    Draining --> [*] : requisições em andamento concluídas
    Ready --> [*] : crash / liveness falha → restart
```

- **Inicie rápido, aqueça antes de receber tráfego.** Um serviço na JVM pode precisar de vários segundos para iniciar; a readiness probe só deve passar quando os pools de conexão estiverem abertos e os caches aquecidos. Inicializações lentas tornam o autoscaling lento ([serverless e autoscaling](serverless-autoscaling/index.md#autoscaling-lag)).
- **Desligue de forma graciosa.** Ao receber `SIGTERM`, pare de aceitar novas requisições, termine as que estão em andamento e só então saia. No Spring Boot, `server.shutdown=graceful` com `spring.lifecycle.timeout-per-shutdown-phase=20s` faz isso.
- **Seja descartável** (Twelve-Factor IX): nada importante deve depender de uma réplica viver muito tempo. Health checks (liveness, readiness, startup) são tratados em [confiabilidade](../reliability/index.md).

---

## Formatos de computação

O mesmo serviço stateless pode rodar sobre substratos muito diferentes. A escolha muda quem gerencia o quê, quão rápido você escala e como você paga:

| Formato | Unidade que você implanta | Velocidade de escala | Você gerencia | Paga por | Uso típico |
|---|---|---|---|---|---|
| **Máquina virtual** | imagem de VM | minutos | SO, runtime, aplicação | horas provisionadas | legado, hardware especial, bancos de dados |
| **Containers no Kubernetes** | imagem de container | segundos (pod) a minutos (nó) | o cluster (ou um gerenciado), a aplicação | nós, mesmo ociosos | o padrão para serviços |
| **Containers serverless** (Cloud Run, Fargate, Container Apps) | imagem de container | segundos, até zero | a aplicação | por requisição ou por vCPU-segundo | APIs com períodos ociosos |
| **Funções (FaaS)** (Lambda, Cloud Functions) | uma função | de menos de um segundo a segundos, até zero | uma função | por invocação e duração | cola entre eventos, webhooks, trabalho em rajadas |

A aula 12 ([cloud-native](../cloud-native/index.md)) cobre containers e Kubernetes em profundidade; esta aula cobre as decisões que dependem da *carga de trabalho*: [serverless e autoscaling](serverless-autoscaling/index.md).

## O mapa de conceitos de compute { #concept-map }

Cada componente de computação responde *onde* um pedaço de lógica roda e *como* ele escala; os componentes externos são a lógica que você chama mas não executa. O mapa liga cada **componente da paleta** (verde) aos **conceitos** em que ele se apoia (azul):

``` mermaid
flowchart LR
    app["app"]:::comp -.- c1["stateless, escala horizontal,<br/>ciclo de vida da réplica"]:::tech
    app -.- c2["REST, gRPC, GraphQL,<br/>APIs assíncronas"]:::tech
    app --> queue["queue"]:::comp
    queue --> worker["worker"]:::comp
    worker -.- c3["jobs idempotentes,<br/>lei de Little, DLQ"]:::tech
    scheduler["scheduler"]:::comp --> queue
    scheduler -.- c4["CronJob, locks,<br/>eleição de líder"]:::tech
    serverless["serverless"]:::comp -.- c5["cold start, concorrência,<br/>atraso do autoscaling"]:::tech
    app --> shared["auth · search ·<br/>notifications · analytics"]:::comp
    shared -.- c6["bounded contexts,<br/>alimentados por eventos, donos dos dados"]:::tech
    app --> ext["payment · email ·<br/>thirdparty"]:::comp
    ext -.- c7["idempotency keys, webhooks,<br/>reconciliação"]:::tech
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`app`](../../reference/components/compute/index.md#app) | Onde roda a lógica de requisição/resposta, e como ela escala? | réplicas stateless, dimensionamento a 50–70%, ciclo de vida, contratos de API | [esta visão geral](#stateless-app-servers), [Estilos de API](api-styles/index.md) | `monolith`, `scale-out` |
| [`worker`](../../reference/components/compute/index.md#worker) | O que roda fora da requisição do usuário? | jobs numa fila, workers = taxa × tempo por job, pelo menos uma vez, DLQ | [Trabalho assíncrono](async-work/index.md) | `async-queue` |
| [`scheduler`](../../reference/components/compute/index.md#scheduler) | O que roda num horário — uma vez, e não uma vez por réplica? | CronJob, lock distribuído, eleição de líder, fencing tokens, expiração preguiçosa | [Trabalho assíncrono — schedulers](async-work/index.md#schedulers) | `notification-system` |
| [`serverless`](../../reference/components/compute/index.md#serverless) | O que deve escalar por requisição, e até zero? | FaaS, cold starts, concorrência = taxa × duração, custo por uso | [Serverless e autoscaling](serverless-autoscaling/index.md) | `serverless-burst` |
| [`auth`](../../reference/components/compute/index.md#auth) | Quem está chamando? | identidades e tokens, comprar antes de construir, validação no gateway | [Serviços](services/index.md) | `flash-sale` (rajadas de login) |
| [`search`](../../reference/components/compute/index.md#search) · [`analytics`](../../reference/components/compute/index.md#analytics) | Como manter visões derivadas fora do caminho da requisição? | dados derivados, alimentados por eventos, reconstruíveis a partir da fonte da verdade | [Serviços](services/index.md) | `search-autocomplete`, `event-fanout` |
| [`notifications`](../../reference/components/compute/index.md#notifications) · [`email`](../../reference/components/external/index.md#email) | Como as mensagens chegam aos fãs apesar dos limites do provedor? | workers guiados por fila, rate limits do provedor, bounces, um provedor secundário | [Serviços](services/index.md), [Integrações — quedas do provedor](integrations/index.md#provider-outages) | `notification-system` |
| [`payment`](../../reference/components/external/index.md#payment) · [`thirdparty`](../../reference/components/external/index.md#thirdparty) | Como depender de sistemas que não controlamos? | adapters, idempotency keys, resultados UNKNOWN, webhooks, reconciliação | [Integrações](integrations/index.md) | `payment-system`, `cascading-failure`, `retry-storm` |
| *(a camada inteira)* | Quantas réplicas, e quando? | HPA, KEDA, escala pela profundidade da fila, escala agendada, atraso do autoscaling | [Serverless e autoscaling — atraso](serverless-autoscaling/index.md#autoscaling-lag) | `scale-out`, `flash-sale` |

!!! tip "Na entrevista"

    Descreva a camada de computação em uma frase e siga para as partes interessantes: *"A camada de API é stateless — sessões são JWTs, arquivos vão para o object store — então ela fica atrás de um load balancer e faz autoscaling por CPU e requisições por segundo; eu a dimensionaria com cerca de 65% de utilização-alvo, o que dá 13–14 réplicas para o nosso pico de 4 mil RPS."* Entrevistadores querem ouvir que você sabe **para onde foi o estado**, e um número. Gaste o tempo restante nas partes com estado (banco de dados, cache, fila), onde estão os trade-offs de verdade.

!!! warning "Armadilhas comuns"

    - **Estado escondido**: um mapa em memória, um arquivo local ou um job `@Scheduled` dentro do processo que silenciosamente assume uma única réplica.
    - **Escalar a camada stateless contra uma parede**: mais réplicas da aplicação multiplicam as conexões com o banco de dados, que é o gargalo real.
    - **Dimensionar pela média**: uma frota dimensionada para as 03:00 ou para a média do dia derrete às 10:00 no dia da venda.
    - **Sem folga para falhas**: usar 100% da capacidade significa que perder uma réplica (ou uma zona) vira indisponibilidade.
    - **Inicialização lenta e pesada**: uma réplica que precisa de 90 s para ficar pronta não ajuda em um pico que dura 5 minutos.

---

## Relacionados

- Hands-on: [hands-on 1 — primeiro serviço](../../hands-on/1/index.md) (a API REST do `catalog` e seu contrato OpenAPI), [hands-on 3 — borda](../../hands-on/3/index.md) (três réplicas atrás do Nginx, medição de scale-out), [hands-on 7 — assíncrono](../../hands-on/7/index.md) (workers, outbox, consumidor idempotente), [hands-on 9 — resiliência](../../hands-on/9/index.md) (`order` → `payment` com timeouts e circuit breaker), [hands-on 10 — Kubernetes](../../hands-on/10/index.md) (HPA sob carga do k6).
- Exercícios: [autoscaling no Kubernetes](../../exercises/kubernetes-autoscaling/index.md), [orientado a eventos](../../exercises/event-driven/index.md).
- Estudos de caso: [ticketing (venda relâmpago da BoxOffice)](../case-studies/ticketing/index.md), [sistema de pagamentos](../case-studies/payment-system/index.md), [sistema de notificações](../case-studies/notification-system/index.md).
- Catálogo de componentes: [compute](../../reference/components/compute/index.md) e [external](../../reference/components/external/index.md).

## Principais conclusões

- A camada de computação é fácil de escalar **porque** é stateless: sessões, arquivos, caches, agendamentos e contadores ficam em armazenamentos construídos para guardar estado.
- App servers escalam **para fora**; dimensione-os como `pico / (capacidade por réplica × utilização-alvo)` mais folga, e mantenha a utilização em torno de 50–70%, porque a latência explode perto de 100%.
- Réplicas são descartáveis: início rápido, readiness antes do tráfego, desligamento gracioso.
- As próximas páginas decidem como dividir o código em serviços, como eles conversam, o que roda em segundo plano, como a frota escala sozinha e como depender de provedores que você não controla.

---

[^1]: WIGGINS, A. [The Twelve-Factor App](https://12factor.net/){target="_blank"}, fatores VI (processos) e IX (descartabilidade). 2011.
