---
hide:
  - navigation
  - toc
---

# System Design Playground

Desenhe um sistema com os componentes da disciplina, coloque-o sob carga e **veja como ele se comporta**: utilização, filas, percentis de latência, erros, custo — e o que acontece quando algo dá errado. Todo número na tela vem das fórmulas da disciplina (utilização, Lei de Little, filas, percentis, disponibilidade), então dá para prevê-lo antes de apertar ▶ e explicá-lo depois.

<div class="sdp" data-scenario="monolith" data-mode="full" data-height="640"></div>

Escolha um cenário na barra (ou **Tela em branco**), aperte ▶ e leia os painéis abaixo da tela. O [guia de cenários](scenarios/index.md) explica o que cada cenário ensina. Seu projeto fica salvo neste navegador para cada cenário; **Restaurar o cenário** traz o original de volta.

!!! abstract "O que o playground é (e o que não é)"

    É um **modelo didático**: algumas dezenas de linhas de matemática por componente, ajustadas para que o comportamento seja realista e explicável — o joelho da curva de latência, um pool de threads que se esgota, um backlog que drena, um estouro de cache. **Não** é um benchmark: capacidades e preços do catálogo são ilustrativos, escolhidos para facilitar as contas. Use-o para raciocinar sobre *formas* e *ordens de grandeza*, e depois meça o sistema real (laboratórios).

## Primeiros passos

1. Escolha **Cenário → Monólito** (já carregado acima) e aperte ▶. O perfil *breakpoint* aumenta a carga até o sistema quebrar.
2. Ao final abre o **Relatório**: ponto de ruptura, percentis, o **gargalo** com uma explicação, e as metas (✓/✗).
3. Adicione um **Load Balancer** da paleta (clique em **+** ou arraste para a tela), conecte *fans → Load Balancer → boxoffice* (arraste da pequena alça à direita de um nó até outro nó), exclua a aresta antiga e aumente as réplicas da aplicação no inspetor.
4. Aperte ⟲ (recomeçar a execução) e ▶ de novo. Compare.
5. Travou? Abra **Dicas** no painel da direita, ou **Mostrar uma solução possível**.

## Montando um projeto

| Ação | Como |
|---|---|
| Adicionar um componente | Clique em **+** na paleta (ou dê duplo clique no item), ou arraste-o para a tela. A paleta tem 49 componentes em 10 categorias: Cliente, Tráfego & borda, Computação, Contêineres, Armazenamento, Mensageria, Observabilidade, Rede, IA & agentes e Externos |
| Dar um nome | Um componente novo não tem rótulo: seu bloco mostra só o tipo. Digite um rótulo no inspetor (o tipo aparece como placeholder) e o bloco mostra o nome e, abaixo dele, o tipo; apagar o rótulo, ou digitar o próprio tipo, volta a mostrar só o tipo |
| Conectar A → B (A chama B) | Arraste da alça redonda na borda direita de A e solte sobre B; ou selecione A, aperte `C` e clique em B |
| Selecionar | Clique num nó, aresta ou moldura; clique no fundo para ver o enunciado e as metas do cenário |
| Editar | O inspetor (direita) mostra descrição, números-chave, um link **Saiba mais** para o catálogo de componentes, valores ao vivo e os parâmetros (controle deslizante + número) |
| Mover / deslocar / zoom | Arraste um nó; arraste o fundo para deslocar; `Ctrl`/`⌘` + roda (ou pinça) e os botões ± para o zoom; `F` enquadra o projeto |
| Excluir, duplicar, desfazer | `Del`/`⌫`, `D`, `Ctrl`/`⌘`+`Z` e `Shift`+`Ctrl`/`⌘`+`Z` (também na barra) |
| Molduras | Adicione uma moldura **VPC** (região), **Subnet** (zona de disponibilidade) ou **Kubernetes Cluster** e coloque nós dentro (um nó pertence à moldura quando seu centro está dentro dela); arraste a moldura pela barra de título, redimensione pelo canto. Um Kubernetes Cluster roda os serviços de dentro como pods ([veja abaixo](#kubernetes-clusters)) |
| Conexões laterais | **Metrics, Logs, Tracing, Alerting, Health Check, Service Registry** e **Service Mesh** não ficam no caminho das requisições: conecte-os aos serviços que observam (em qualquer direção) |

As arestas têm um sentido só: uma conexão que criaria um ciclo é recusada. Uma aresta para um broker (**Message Queue, Pub/Sub, Event Stream, Kafka**) é assíncrona: quem chama só espera a confirmação do broker. As exportações (Mermaid, relatório, eventos) chamam um componente sem rótulo pelo seu tipo.

## Como o modelo funciona { #how-the-model-works }

O tempo avança em **ticks de 0,1 s** de tempo simulado; o seletor de velocidade roda 1, 5, 20 ou 100 ticks por décimo de segundo real. Cada tick tem duas partes: um **modelo fluido** que move *taxas* (requisições por segundo) pelo grafo, e uma amostra de **requisições sintéticas** (traces) que percorrem o grafo para medir os percentis de latência.

### Chegadas e requisições

Cada cliente gera chegadas a partir do **perfil de carga** × ruído aleatório × eventos de tráfego. O número de chegadas num tick é um sorteio de Poisson com média $\lambda \cdot \Delta t$, então mesmo um alvo constante tem variação realista. Uma requisição é uma **leitura** (parcela definida em *% leituras* na barra, ou por cliente) ou uma **escrita**; escritas costumam custar mais a jusante (uma escrita no SQL consome o equivalente a 3 leituras). Bots (parâmetro *tráfego de bots* do cliente) são carga extra que um WAF ou um rate limiter pode barrar; as metas só contam usuários reais.

### Como um nó encaminha requisições { #how-a-node-routes-requests }

| Papel | Componentes | O que acontece com uma requisição |
|---|---|---|
| split | DNS, Load Balancer, Ingress (API Gateway com 2+ alvos do mesmo tipo, exceto Microservice e Container) | vai para **um** alvo saudável, na proporção capacidade × peso da aresta; o DNS pode ser *failover* |
| call | App Server, Microservice, Container, Worker, Auth, Search, Serverless, SQL Database, DB Cluster, Orchestrator, … | chama **todas** as arestas de saída (conforme a *razão* e o *filtro leitura/escrita* da aresta), uma depois da outra (latências somam) ou em paralelo (vale a mais lenta) |
| cache | Cache, CDN | uma leitura **acerta** com a taxa de acerto atual e volta; misses e escritas vão para os alvos |
| broker | Message Queue (consumidores concorrentes), Pub/Sub, Event Stream, Kafka (uma cópia por consumidor) | o produtor recebe uma confirmação; as mensagens esperam num **backlog** que os consumidores drenam na sua capacidade |
| side | Metrics, Logs, Tracing, Alerting, Health Check, Service Registry, Service Mesh | fora do caminho; mudam o que você consegue ver e quão rápido falhas são detectadas e reparadas |
| source | Client, Mobile, Scheduler | geram a carga (o scheduler: *N* jobs a cada *T* segundos) |
| frame | VPC, Subnet, Kubernetes Cluster | nunca recebe requisições; coloca os nós de dentro numa região, numa zona ou num cluster |

Um **API Gateway** agrupa seus alvos por tipo: 2+ alvos do mesmo tipo (digamos, três App Servers) são balanceados, como por um nó split, e tipos diferentes são todos chamados (digamos, Auth e depois o serviço). **Microservices e Containers são a exceção**: cada um é um serviço diferente, então o gateway trata cada um como **uma rota própria** e não balanceia entre eles. Escolha que requisições seguem cada rota com a *razão* e o *filtro leitura/escrita* da aresta (leituras → catalog, escritas → order). Para escalar um serviço, aumente suas réplicas; não desenhe cópias dele.

### Capacidade, utilização e filas

Para cada nó, a cada tick: a **taxa oferecida** $\lambda$ é a soma do que os chamadores enviam (incluindo retries). A **capacidade** é $\mu = \text{réplicas saudáveis} \times \text{capacidade por réplica}$ (SQL: leituras se espalham pelo primário e pelas réplicas de leitura, escritas só no primário; bancos particionados: limitados pela partição mais ocupada; DB Cluster: limitado pelo shard mais ocupado, [veja abaixo](#db-cluster); Container: escalada pelo limite de CPU, [veja abaixo](#containers)). A **utilização** é

$$\rho = \frac{\lambda}{\mu}$$

Com $\rho < 1$ a espera média na fila segue a aproximação de Sakasegawa da fila M/M/c, em que $S$ é o tempo médio de serviço e $c = \mu \cdot S$ o número de requisições que o nó atende em paralelo:

$$W_q \approx S \cdot \frac{\rho^{\sqrt{2(c+1)}-1}}{c\,(1-\rho)}$$

(Quando o pool de threads é o limite, $S$ é o tempo em que uma requisição segura uma thread e $c$ o número de threads; $\rho$ é a média de 1 s, limitada a 0,98 na fórmula.) Ela é pequena em $\rho = 0{,}5$, perceptível em $0{,}8$ e explode perto de $1$ — o **joelho** da curva de latência. Quando $\lambda > \mu$ o excesso se acumula numa fila limitada (*limite da fila* por réplica); sua espera é $q / \mu$ e o que não cabe é **rejeitado** (503). A barra de utilização de cada nó fica verde abaixo de 0,7, âmbar abaixo de 0,9 e vermelha acima.

### Threads e a Lei de Little

Um serviço síncrono segura uma thread (ou uma conexão de banco) durante todo o tempo que a requisição passa nele — o próprio trabalho **e** a espera pelas dependências. Pela **Lei de Little** o número de threads ocupadas é

$$L = \lambda \cdot W$$

então um nó completa no máximo $\text{threads} \times \text{réplicas} / W$ requisições por segundo. Se uma dependência fica lenta, $W$ cresce, as threads acabam e o nó falha **mesmo com a CPU ociosa** — uma falha em cascata. O inspetor mostra $L$ e o Relatório aponta a causa (*sem threads com a CPU a 20%*). Um **timeout** na aresta limita quanto uma thread espera.

### Latência e percentis

O trabalho próprio de um nó é aleatório: **lognormal** com a mediana do *tempo de serviço* e uma dispersão por tipo (um cache ≈ 0,5 ms, um banco ≈ 4 ms, uma aplicação ≈ 10 ms, um LLM ≈ 1,2 s, uma API de terceiros ≈ 150 ms com cauda longa), mais pausas raras de GC nos servidores de aplicação. A cada tick cerca de 40 requisições sintéticas percorrem o grafo com as esperas de fila atuais, acertos e misses de cache, falhas, timeouts e retries. Suas latências preenchem histogramas em escala logarítmica: os blocos mostram p50/p99 dos últimos 5 s e o Relatório mostra p50, p95, p99 e p99,9 na janela estável. Como nos thresholds do k6 sobre `expected_response:true`, **os percentis de latência contam requisições bem-sucedidas**; as falhas entram na taxa de erro.

### Timeouts, retries, circuit breakers, fallbacks, bulkheads

Os parâmetros das arestas modelam os padrões de resiliência da disciplina. Com probabilidade $p$ de uma tentativa falhar (erro ou timeout) e $r$ retries:

$$\text{carga no alvo} = \lambda \cdot (1 + p + p^2 + \dots + p^r) \qquad P(\text{chamada falha}) = p^{\,r+1}$$

Quando $p$ se aproxima de 1 o alvo recebe até $(r+1)\times$ a carga — uma **tempestade de retries**. O *backoff* espera $100\,\text{ms} \times 2^n$ entre tentativas (*exp+jitter* as espalha aleatoriamente), o que soma latência e suaviza as ondas, mas não reduz o total numa queda longa. Um **circuit breaker** abre quando mais de 50% das chamadas falham em 5 s: as chamadas falham na hora por 10 s, e então algumas chamadas de sonda (meio-aberto) decidem se ele fecha. Um **fallback** transforma uma chamada falha numa resposta degradada (contada como sucesso). Um **bulkhead** limita a fração das threads de quem chama que uma chamada pode ocupar. Uma **chave de idempotência** torna seguros os retries a um provedor de pagamento: sem ela, um retry após timeout conta como possível **cobrança duplicada**.

### Caches, CDNs e chaves quentes { #caches-cdns-and-hot-keys }

Um cache com taxa de acerto $h$ só repassa os misses: leituras no banco $= \text{leituras} \times (1-h)$. Com *cache-aside*, escritas frequentes invalidam entradas e reduzem $h$; *write-through* a mantém mas deixa as escritas mais lentas. Depois de um **flush** a taxa de acerto começa em 0 e volta a subir durante o *aquecimento*; enquanto isso todas as leituras erram ao mesmo tempo — um **stampede**. A *coalescência de requisições* faz misses simultâneos da mesma chave dividirem uma consulta. A popularidade das chaves segue uma lei de Zipf: com $P$ partições, a mais ocupada recebe $p_1 + (1-p_1)/P$ da carga, em que $p_1$ é a parcela da chave mais quente — então uma **chave quente** satura uma partição não importa quantas você adicione.

### Mensageria

Um broker aceita mensagens até sua capacidade e as guarda num backlog. Os consumidores puxam na própria capacidade; com Event Stream e Kafka no máximo $\min(\text{partições}, \text{réplicas consumidoras})$ consumidores trabalham em paralelo. Uma mensagem cujo processamento falha volta ao backlog (at-least-once). **Atraso do consumidor** = backlog ÷ taxa de drenagem bem-sucedida. Acima do *backlog máximo* (retenção) as mensagens são descartadas, e essas publicações contam como erros.

### Autoescala e serverless

Com a *autoescala* ligada, a cada 15 s um nó compara a utilização média de **CPU** com a meta e ajusta para $\lceil \text{réplicas} \times \rho / \text{meta} \rceil$ réplicas (entre mín. e máx.); réplicas novas recebem tráfego após o *aquecimento*. A primeira decisão vem em t = 15 s, e uma redução remove no máximo metade das réplicas por vez. Como o HPA do Kubernetes, ela observa a CPU — um nó sem threads não escala. Uma função **serverless** roda uma instância por requisição simultânea: instâncias $= \lambda \cdot W$. Requisições além das instâncias quentes caem em instâncias novas e pagam o **cold start**; além do *limite de concorrência* sofrem throttling (429). Instâncias *provisionadas* estão sempre quentes (e sempre são cobradas).

### Contêineres { #containers }

Um **Container** é um nó de computação com dois parâmetros a mais. Seu *limite de CPU* $\ell$ é um múltiplo do request de CPU para o qual a capacidade vale: ele escala a capacidade e, abaixo de 1, estrangula o contêiner (throttling pela cota CFS), então o próprio trabalho demora mais:

$$\mu_{\text{réplica}} = \text{capacidade} \times \ell \qquad \text{tempo de serviço mediano} = \frac{\text{tempo de serviço p50}}{\min(1, \ell)}$$

Um limite de 0,5 corta as req/s pela metade **e** dobra o tempo de serviço; um limite acima de 1 acrescenta req/s mas não deixa uma requisição mais rápida. Seu *tempo de partida* (padrão 20 s: download da imagem + início do processo + aquecimento) substitui o aquecimento: é quanto uma réplica nova leva até receber tráfego, tenha sido adicionada pela autoescala ou realocada pelo Kubernetes. Um **Microservice** é um nó de computação com os padrões de um pod de 2 vCPU (400 req/s por réplica a 8 ms, 2 réplicas, 20 s de aquecimento); o que o distingue é como um API Gateway o roteia ([acima](#how-a-node-routes-requests)) e como um cluster o escalona (abaixo).

### Clusters Kubernetes { #kubernetes-clusters }

Uma moldura **Kubernetes Cluster** roda, como **pods**, os serviços cujo centro está dentro dela (um nó pertence ao primeiro cluster que o contém). Serviços gerenciados e provedores externos nunca rodam como pods, mesmo desenhados dentro: DNS, CDN, Load Balancer, WAF, Serverless, Object Store, Data Warehouse, DB Cluster, Message Queue, Pub/Sub, Event Stream, NAT, VPN, LLM Gateway e os componentes Externos. Toda réplica de um membro é um pod, e o cluster tem espaço para

$$C = \text{nós de trabalho prontos} \times \text{pods por nó}$$

pods. Um pod está *pronto* (atendendo), *subindo* ou **Pending** (sem espaço). A cada tick:

- Pods além de $C$ ficam **Pending**: não atendem. O bloco do serviço mostra *N pending*, o inspetor os mostra ao lado das réplicas prontas e subindo, e a barra de título da moldura mostra ao vivo os nós, os pods e os pods Pending. Quando o cluster encolhe, os pods mais novos (primeiro os que estão subindo) são despejados de volta para Pending.
- Pods Pending ocupam as vagas livres, um serviço por vez (round robin). Um pod que ganha uma vaga sobe e recebe tráfego após seu aquecimento (o tempo de partida, num Container) **+ 10 s** até seus endpoints se propagarem — 0 s quando o serviço está registrado num [Service Registry](#service-discovery).
- O HPA (*Autoescala* de um membro) funciona como descrito acima, mas conta os pods que pediu, alocados ou não, e os pods que adiciona primeiro esperam uma vaga livre. **O HPA adiciona pods, nunca nós**: quando os pods não cabem, ficam Pending e o serviço continua saturado. Uma redução descarta primeiro os pods Pending.

Com o **cluster autoscaler** ligado, quando os pods Pending são mais do que cabem nos nós que já estão subindo, ele liga

$$\text{nós novos} = \left\lceil \frac{\text{Pending} - \text{nós subindo} \times \text{pods por nó}}{\text{pods por nó}} \right\rceil$$

(até o *máximo de nós*), cada um pronto após a *partida do nó*. Ele remove um nó após 120 s em que nenhum nó está subindo e todos os pods pedidos (incluindo os Pending) cabem em um nó a menos — demanda $\le (\text{prontos} - 1) \times \text{pods por nó}$ — e nunca fica abaixo de *Nós de trabalho*. O cluster custa $(\text{nós prontos} + \text{nós subindo}) \times \text{preço do nó}$; o preço dos próprios pods não é contado (as cobranças por requisição, sim). Padrões: 3 nós × 10 pods por nó, cluster autoscaler desligado (máx. 10 nós), partida do nó de 90 s, 140 USD/mês por nó.

Uma **falha de nó** (um [evento](#randomness-seeds-chaos-and-events)) mata um nó pronto. Ele tinha $\min\left(\text{pods por nó}, \lceil \text{pods} \div \text{nós} \rceil\right)$ pods, distribuídos entre os serviços na proporção dos seus pods (maior resto). Eles param de atender na hora, mas quem chama continua mandando requisições — que travam, como em qualquer réplica morta, por 10 s ou até o timeout da aresta — até perceber, após $\min(\text{detecção}, 40\,\text{s})$: 30 s atrás de um balanceador, 3 s com Health Check ou Service Registry, 40 s (o timeout *NotReady* do nó) numa chamada direta. Após 40 s o Kubernetes recria os pods perdidos: eles ficam Pending e só sobem onde houver espaço. O nó volta quando o evento termina. Um serviço sem nenhum pod (e sem endpoint antigo) responde na hora com 503 (*no endpoints*).

### Descoberta de serviços { #service-discovery }

Um **Service Registry** (nó lateral) registra os serviços conectados a ele, em qualquer direção. Para um serviço registrado:

- **Réplicas mortas são descartadas em 3 s por todo chamador** — um balanceador, um API gateway ou outro serviço que o chama diretamente. Sem registry, numa chamada direta entre serviços ninguém detecta uma queda: a réplica caída continua recebendo sua parte das chamadas (que travam) até ser reparada, e os pods perdidos com um nó Kubernetes até o timeout *NotReady* de 40 s.
- Pods novos recebem tráfego assim que ficam prontos: sem os 10 s de espera pela propagação dos endpoints.

Ele custa 30 USD/mês + 5 por serviço anexado.

### Bancos replicados (DB Cluster) { #db-cluster }

Um **DB Cluster** tem $S$ *shards*, cada um com um primário que recebe suas escritas e $R$ *seguidores por shard* que as copiam. Padrões: 1 shard, 2 seguidores, replicação `async`, leituras de `followers`, failover de 30 s, ida e volta da replicação de 2 ms, e por nó 3 000 req/s, 4 ms, 200 conexões, custo da escrita 3 e 450 USD/mês. Sua capacidade é

$$\mu_{\text{escritas}} = \frac{S \times \text{capacidade}}{\text{custo da escrita}} \qquad \mu_{\text{leituras}} = S \times (1 + R) \times \text{capacidade}$$

quando as leituras vão aos seguidores ($S \times \text{capacidade}$ quando vão ao primário). As chaves seguem a lei de Zipf da [chave quente](#caches-cdns-and-hot-keys): o shard mais quente recebe $h_1 = p_1 + (1-p_1)/S$ das requisições e cada um dos outros $(1-h_1)/(S-1)$. O shard mais ocupado define a capacidade, então uma chave quente satura um shard não importa quantos você adicione; o inspetor mostra a utilização do shard quente e a dos outros.

Uma escrita é confirmada depois da sua replicação:

| Replicação | Latência extra de uma escrita | Seguidores atrasados | Perdido num failover |
|---|---|---|---|
| `async` | nenhuma | todos os $R$ | as escritas dentro do atraso |
| `sync` | a ida e volta ao seguidor síncrono | $R - 1$ | nada |
| `quorum` | a ida e volta do $\lfloor (R+1)/2 \rfloor$-ésimo seguidor mais rápido | $R - \lfloor (R+1)/2 \rfloor$ | nada |

Cada ida e volta é sorteada de uma lognormal em torno da *ida e volta da replicação*. Uma **degradação de latência** num DB Cluster deixa um seguidor lento — o síncrono: `sync` espera por ele a cada escrita, `quorum` (com $R \ge 2$) responde com os mais rápidos. Os seguidores atrasados ficam atrás por

$$\text{atraso} \approx 0{,}02 + \frac{0{,}5\,\rho_w^3}{1 - \rho_w}\ \text{s}$$

em que $\rho_w$ é a utilização de escrita do primário mais ocupado (o atraso cresce sem limite enquanto $\rho_w \ge 1$). Quando as leituras vão aos seguidores, uma parte delas é **desatualizada** (lê uma chave escrita dentro do atraso):

$$\text{leituras desatualizadas} \approx \frac{\text{seguidores atrasados}}{1 + R} \times \text{parcela de escritas} \times \min\left(1, \frac{\text{atraso}}{1\,\text{s}}\right)$$

Uma **falha do primário** ([evento](#randomness-seeds-chaos-and-events)) atinge um shard. Suas escritas falham durante o *tempo de failover* (o RTO) — suas leituras também, se vão ao primário — e então um seguidor é promovido e o shard roda com um nó a menos por 120 s. Com replicação `async` as escritas ainda não replicadas se perdem: $\text{escritas perdidas} \approx \text{taxa de escrita do shard} \times \text{atraso}$ (o RPO); `sync` e `quorum` não perdem nada. Com $R = 0$ não há failover: o shard fica fora por 120 s. Uma queda de AZ causa uma falha do primário em um shard (o cluster se espalha pelas zonas). O DB Cluster custa $S \times (1 + R) \times \text{preço}$; sua disponibilidade teórica é $1 - (1-a)^{1+R}$ por shard, com os shards em série:

$$A = \left[1 - (1-a)^{1+R}\right]^{S}$$

### Serviços externos e IA

APIs externas (3rd Party, Payment, Email) têm uma **cota** aplicada como token bucket (2 s de rajada): acima dela respondem 429; são mais lentas, têm cauda longa de latência e falham mais que seus próprios serviços. O **LLM Gateway** inclui a chamada ao modelo (≈ 1,2 s), uma cota do provedor, um *cache semântico* (prompts parecidos respondidos em ≈ 20 ms, sem tokens) e um *modelo reserva* opcional. O **Orchestrator** executa o laço do agente: cada requisição faz *passos* chamadas sequenciais às arestas de LLM e de ferramentas, então latência e custo crescem linearmente com os passos. Um caminho que não passa por um **Safety Mesh** deixa tentativas de prompt injection (2% das requisições, ilustrativo) chegarem ao modelo: a métrica *respostas inseguras*.

### Custo e disponibilidade

O bloco de custo é **USD por mês, ilustrativo**, extrapolado das taxas atuais: réplicas × preço + cobranças por requisição e por GB (saída da CDN, NAT, tokens de LLM, invocações de funções) + observabilidade. Dentro de um Kubernetes Cluster paga-se pelos nós de trabalho, não pelos pods; um DB Cluster cobra cada nó de cada shard; um Service Registry custa 30 + 5 por serviço anexado. O Relatório também mostra a **disponibilidade teórica** do projeto, a partir das disponibilidades por réplica, com as regras de série/paralelo da disciplina:

$$A_{\text{série}} = \prod_i A_i \qquad A_{\text{paralelo}} = 1 - \prod_i (1 - A_i)$$

A disponibilidade medida é a parcela de requisições bem-sucedidas em toda a execução.

## Perfis de carga

Os perfis usam o vocabulário do k6 e da aula de performance. O *RPS-alvo* (controle logarítmico, de 1 a 2 000 000) define o nível.

| Perfil | Forma | Duração | Use para |
|---|---|---|---|
| `smoke` | poucas req/s | 30 s | verificar se o projeto funciona |
| `load` | rampa de 20 s, mantém o alvo, desce | 180 s | conferir as metas na carga esperada |
| `stress` | +20% do alvo a cada 20 s, até 3× | 300 s | ver como degrada além do alvo |
| `spike` | o alvo, depois × N por 30 s (em t = 60 s) | 180 s | testar rajadas: filas, autoescala, cold starts |
| `soak` | o alvo por 15 minutos | 900 s | achar problemas lentos (teste o *vazamento de memória* numa aplicação) |
| `breakpoint` | rampa linear até 4× o alvo, para quando erros > 5% ou p99 > 10 × SLO | ≤ 300 s | achar o ponto de ruptura e o joelho |
| `chaos` | rampa de 20 s, depois o alvo, com falhas aleatórias (caos ≥ médio) | 300 s | game day |

As metas são avaliadas na **janela estável** do perfil (sombreada nos gráficos), para que a rampa não conte; a disponibilidade usa a execução inteira.

## Aleatoriedade: sementes, caos e eventos { #randomness-seeds-chaos-and-events }

Toda a aleatoriedade — chegadas, tempos de serviço, acertos de cache, que falhas acontecem e quando — vem de um único **gerador com semente**, dividido em fluxos independentes por finalidade. **Mesma semente + mesmo projeto + mesmo perfil ⇒ a mesma execução**, então você pode mudar uma coisa e atribuir a diferença a ela. Mudar o nível de caos não embaralha as chegadas. 🎲 sorteia uma nova semente; um projeto robusto passa com qualquer semente.

O **caos** (*desligado, baixo, médio, alto* = ×0, ×1, ×3, ×8) define a taxa de eventos aleatórios. Você também pode injetar qualquer evento com o botão ⚡, e os cenários têm **eventos programados** em instantes fixos (ex.: *10:00 — abrem as vendas*). Os eventos aparecem na aba **Eventos** e como marcas tracejadas nos gráficos.

| Evento | Efeito |
|---|---|
| Queda de réplica | uma réplica morre; os chamadores continuam mandando requisições até um balanceador **detectar** (30 s, ou 3 s com Health Check ou quando o serviço está registrado num Service Registry); uma chamada direta só detecta pelo Service Registry (3 s) — sem ele, a réplica morta continua com sua parte das chamadas até ser reparada; ela volta após o tempo de reparo (metade com Alerting) |
| Degradação de latência | um nó ou dependência externa fica 5–20× mais lento por 20–120 s (num DB Cluster: um seguidor, o síncrono, fica mais lento) |
| Pico de tráfego viral | o tráfego dos clientes × 3–10 por 30–90 s |
| Chave quente (celebridade) | a popularidade das chaves se concentra: uma partição / shard de cache / shard de DB Cluster concentra a carga |
| Cache esvaziado | a taxa de acerto cai a 0 e aquece de novo |
| Queda de AZ | os nós daquela zona de disponibilidade caem (um nó espalhado em 3 AZs perde um terço; um banco com standby faz failover em ~60 s; um DB Cluster perde o primário de um shard) |
| Queda de região | todos os nós daquela região caem |
| Partição de rede | uma chamada perde todo o tráfego: quem chama fica preso até o timeout |
| Queda / limitação de terceiro | um serviço externo falha ou sua cota cai para 20% |
| Deploy ruim | um serviço retorna 30% de erros até o rollback |
| Vizinho barulhento | um nó perde 30% da capacidade |
| Tempestade de pausas de GC | pausas longas e frequentes num servidor de aplicação |
| Falha de nó | (Kubernetes Cluster) um nó de trabalho pronto morre com seus pods (≈ ⌈pods ÷ nós⌉, distribuídos entre os serviços); quem chama continua mandando requisições a eles até perceber (min(detecção, 40 s)); os pods perdidos são recriados após 40 s, Pending se não houver espaço; o nó volta quando o evento termina (2–5 min) |
| Falha do primário | (DB Cluster) o primário de um shard morre: suas escritas falham durante o tempo de failover (suas leituras também, se vão ao primário), depois um seguidor é promovido e o shard fica com um nó a menos por 120 s; com replicação `async` as escritas dentro do atraso se perdem; sem seguidores o shard fica fora por 120 s |

*Falha de nó* e *Falha do primário* só se aplicam a um Kubernetes Cluster e a um DB Cluster: projetos sem esses componentes nunca os sorteiam, e sua sequência de eventos aleatórios não muda. Um DB Cluster nunca tem *Queda de réplica*: suas falhas são falhas do primário.

## Metas e o relatório do teste

Cada cenário tem 2–4 metas, conferidas ao vivo no painel da direita (cinza = esperando a janela estável, verde = cumprindo, vermelho = falhando) e no final no **Relatório**. Métricas que você vai encontrar: `p99` (ms), `taxa de erro` (%), `disponibilidade` (%), `vazão` (req/s), `custo` (USD/mês), `atraso do consumidor` (s), `atraso de replicação` (s), `ponto de ruptura` (req/s), `cobranças duplicadas`, `respostas inseguras` (%), `serviços medidos` (%), `escritas perdidas` (escritas perdidas em failovers de um DB Cluster), `leituras desatualizadas` (% das leituras de um DB Cluster), `p99 (escritas)` (ms, só escritas bem-sucedidas).

O Relatório lista perfil, semente e duração; p50/p95/p99/p99,9; taxa de erro e disponibilidade; vazão média e a **vazão máxima dentro do SLO**; custo; disponibilidade teórica; nas execuções *breakpoint*, o ponto de ruptura e o **joelho** (onde o p99 dobra em relação ao início); o **gargalo** — o primeiro nó a passar de 85% de utilização (ou ficar sem threads, conexões ou cota, ou esperar por pods Pending) — com uma explicação nos termos da disciplina; os eventos da execução; e cada meta, com as dicas quando alguma falha. **Copiar relatório (Markdown)** coloca tudo, com um diagrama Mermaid do seu projeto, na área de transferência — pronto para a entrega de um exercício.

## Observabilidade dentro do playground

Os componentes de observabilidade mudam o que você consegue ver, como na vida real:

- **Metrics**: um serviço não ligado ao Metrics mostra a utilização como `?` — *não se conserta o que não se mede*. O botão do olho (*modo deus*) revela tudo; ele vem ligado, exceto no cenário `observability-stack`.
- **Logs**: a aba Eventos mostra *o que* aconteceu e *onde* só quando há um nó de Logs conectado.
- **Tracing**: habilita a aba **Trace**, uma cascata da requisição amostrada mais lenta (espera na fila hachurada).
- **Health Check**: a detecção de falhas por balanceadores e DNS cai de 30 s para 3 s.
- **Alerting** (ligado ao Metrics): reduz pela metade o tempo de reparo de uma réplica que caiu.
- **Service Registry**: todo chamador de um serviço registrado — balanceador ou chamada direta — descarta uma réplica morta em 3 s, e pods novos recebem tráfego sem os 10 s de espera pelos endpoints.
- **Service Mesh**: os serviços ligados a ele ganham +1 ms por chamada e timeouts, retries com backoff e circuit breakers por padrão; com o Metrics ligado ao mesh, todo serviço anexado é medido.

## Atalhos de teclado

Os atalhos funcionam quando o playground tem o foco (clique nele) e você não está digitando num campo; num botão com foco, `Space` e `Enter` acionam o botão. `?` os mostra. No modo compacto os atalhos que mudam a estrutura (`C`, `D`, `Del`, desfazer) ficam desligados.

| Tecla | Ação |
|---|---|
| `Space` | executar / pausar |
| `S` | avançar 1 s |
| `C` | conectar o nó selecionado ao próximo nó clicado |
| `D` | duplicar a seleção |
| `Del` / `⌫` | excluir a seleção |
| `Ctrl`/`⌘` + `Z`, `Shift` + `Ctrl`/`⌘` + `Z` (ou `Ctrl`/`⌘` + `Y`) | desfazer / refazer |
| `F` | enquadrar |
| `+` / `-` | zoom |
| `Tab`, `Enter` | ir a um componente, selecioná-lo |
| `Esc` | cancelar / desmarcar |

## Exportar, importar e compartilhar

- **Exportar** (botão de download) baixa o projeto e as configurações em JSON; **Importar** (botão de upload) carrega um de volta. É esse o formato de entrega dos exercícios.
- **Link de compartilhamento** (botão de corrente) copia uma URL com o projeto codificado após `#sdp=`; abri-la restaura o projeto no playground desta página.
- **Mermaid** (botão de ramificação) copia o projeto como um `flowchart LR`, pronto para colar numa página Markdown ou num documento de design.
- **Tela cheia** dá à tela de desenho a tela inteira.

O JSON de um projeto é pequeno e legível:

```json
{
  "scenario": "monolith",
  "settings": { "profile": "load", "targetRps": 1500, "readRatio": 0.9, "seed": 7, "chaos": "off" },
  "design": {
    "version": 1,
    "nodes": [
      { "id": "client", "type": "client", "x": 80, "y": 200, "label": "fans", "params": {} },
      { "id": "lb", "type": "lb", "x": 280, "y": 200, "label": "", "params": {} },
      { "id": "app", "type": "app", "x": 480, "y": 200, "label": "boxoffice", "params": { "replicas": 6 } },
      { "id": "db", "type": "sql", "x": 700, "y": 200, "label": "boxoffice-db", "params": {} }
    ],
    "edges": [
      { "id": "client-lb", "from": "client", "to": "lb", "params": {} },
      { "id": "lb-app", "from": "lb", "to": "app", "params": {} },
      { "id": "app-db", "from": "app", "to": "db", "params": { "timeoutMs": 300 } }
    ],
    "frames": []
  }
}
```

## Embutindo o playground numa página

Qualquer página do site pode embutir o simulador com um cenário pré-carregado (é assim que as aulas o usam):

```html
<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="480"></div>
```

- `data-scenario`: um dos ids do [guia de cenários](scenarios/index.md) (`blank` para uma tela vazia).
- `data-mode`: `full` (paleta, inspetor e todos os painéis) ou `compact` (tela, controles de execução, métricas e um gráfico; dá para inspecionar nós e mudar seus parâmetros, não a estrutura).
- Opcionais: `data-height` (pixels da tela de desenho), `data-profile`, `data-seed`, `data-chaos`.

Escreva uma instrução curta *Experimente* antes de cada simulador: o que mudar, o que observar.

## Limitações

- É um **modelo fluido com traces amostrados**, não um simulador de pacotes: as filas guardam *taxas*, e os percentis vêm de cerca de 400 requisições amostradas por segundo simulado. Eventos muito raros (p99,99) não são resolvidos.
- As requisições são independentes; não há sessões, transações nem locks (reservas de assentos são discutidas nas aulas, não simuladas).
- Um cluster Kubernetes é uma contagem de vagas (nós × pods por nó): não há encaixe por CPU e memória, regras de afinidade nem pod disruption budgets, e os pods se espalham por igual entre os nós.
- A latência de rede entre usuários e o sistema não é somada (a latência mostrada é do lado servidor), exceto os +70 ms de chamadas entre regiões e +1 ms por salto num service mesh.
- Capacidades e preços são números redondos ilustrativos. Quando o playground e um teste de carga discordarem, confie no teste de carga — e descubra por quê.
