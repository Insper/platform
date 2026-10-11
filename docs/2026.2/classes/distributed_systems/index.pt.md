
Imagine a loja que você vai construir neste curso rodando como uma única aplicação Spring Boot, com um único banco PostgreSQL, em uma única máquina. É simples de entender — até o tráfego crescer além do que essa máquina aguenta, ou a máquina cair e levar a loja inteira junto. No momento em que você divide o trabalho entre várias máquinas (um gateway, um serviço de contas, um serviço de pedidos, um banco de dados, um cache, um broker de mensagens), você construiu um **sistema distribuído**, e surge uma nova classe de problemas.

Sistemas distribuídos representam um paradigma de computação em que vários computadores independentes colaboram para atingir um objetivo comum, aparecendo para o usuário final como um único sistema coerente[^3]. Diferentemente dos sistemas centralizados, em que todo o processamento ocorre em uma máquina, os sistemas distribuídos se estendem por redes e usam nós interconectados (um **nó** é qualquer computador ou processo independente que participa do sistema) para cuidar do armazenamento de dados, da computação e da comunicação.

Essa arquitetura sustenta as plataformas de nuvem modernas (AWS, Google Cloud, Azure), as aplicações de larga escala (redes sociais, e-commerce) e as simulações científicas. O desafio fundamental é que os nós operam de forma independente, se comunicam apenas trocando mensagens e não têm um relógio compartilhado — o que torna a coordenação um problema de engenharia nada trivial.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** o que torna um sistema distribuído e por que falhas parciais, redes não confiáveis e a ausência de um relógio global o tornam difícil.
    - **Identificar** as 8 falácias da computação distribuída em um projeto concreto, como uma chamada entre dois microsserviços.
    - **Explicar** como relógios lógicos (Lamport) ordenam eventos sem um relógio físico compartilhado.
    - **Escolher** entre consistência e disponibilidade para um dado domínio de dados usando CAP e PACELC.
    - **Descrever** como o Raft elege um líder e replica um log com quóruns de maioria, e dimensionar um cluster para um dado número de falhas.
    - **Comparar** consistência forte (quóruns, consenso) com consistência eventual (LWW, relógios vetoriais, CRDTs).

## Roteiro

1. **Esta visão geral** — o que é um sistema distribuído, por que os construímos, quanto eles custam e os três problemas de raiz (falha parcial, rede não confiável, ausência de relógio global).
2. [Teorema CAP](cap/index.md) — a escolha entre consistência e disponibilidade durante uma partição de rede, e sua extensão PACELC.
3. [Consenso e algoritmos](consensus/index.md) — como os nós concordam sobre um valor apesar de falhas: FLP, modelos de falha, Paxos, Raft, quóruns e CRDTs.
4. [Quiz](quiz.md) — verifique o que você entendeu.

## Slides

<div class="slides-embed">
  <iframe src="slides/distributed-systems.pt.html" title="Slides: sistemas distribuídos" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/distributed-systems.pt.html){:target="_blank"}

---

## Nossa loja é um sistema distribuído

Um único clique em **"Finalizar pedido"** na loja já atravessa a rede várias vezes. Acompanhe a requisição:

``` mermaid-sim
flowchart LR
    user([Navegador]) -->|POST /orders| gw[Gateway]
    gw -->|valida o token| auth[Serviço de autenticação]
    gw -->|encaminha| order[Serviço de pedidos]
    order -->|verifica o estoque| product[Serviço de produtos]
    product -->|preço em cache| redis[(Redis)]
    order -->|INSERT do pedido| pg[(PostgreSQL)]
    order -->|OrderCreated| kafka[[Kafka]]
```

Cada seta é uma mensagem pela rede, e cada caixa é um processo que pode falhar sozinho. Se o serviço de produtos estiver lento, o serviço de pedidos espera; se o Kafka estiver fora do ar, o pedido pode ser gravado, mas o evento nunca é publicado. Nada nesse desenho compartilha memória ou relógio — os serviços cooperam apenas trocando mensagens. Essa é exatamente a definição de sistema distribuído, e é por isso que o restante desta aula importa para o [projeto](../../exercises/project/index.md).

---

## Classificação

Sistemas distribuídos podem ser classificados segundo vários eixos:

| Dimensão | Opção A | Opção B |
|---|---|---|
| **Uniformidade de hardware/software** | Homogêneo — todos os nós rodam a mesma pilha | Heterogêneo — hardware e sistemas operacionais diversos |
| **Acoplamento** | Fortemente acoplado — alta interdependência, memória compartilhada | Fracamente acoplado — comunicação por mensagens, ciclo de vida independente |
| **Topologia** | Cliente-servidor — hierárquica, os servidores detêm os recursos | Peer-to-peer — igualitária, todos os nós compartilham recursos |

Aplicações web seguem o modelo cliente-servidor (navegadores fazem requisições a servidores). Sistemas de compartilhamento de arquivos como o BitTorrent seguem o modelo peer-to-peer. A maioria das arquiteturas de microsserviços ocupa o meio-termo fracamente acoplado: nossa loja é **heterogênea** (serviços em Java, um serviço de notificação em Python, PostgreSQL, Redis, Kafka), **fracamente acoplada** (os serviços conversam por HTTP e Kafka) e **cliente-servidor** (o navegador chama o gateway, e o gateway chama os serviços).

---

## Vantagens

| Benefício | Como |
|---|---|
| **Escalabilidade horizontal** | Adicionar nós em vez de turbinar uma única máquina. O Cassandra escala até petabytes adicionando nós de forma transparente. |
| **Tolerância a falhas** | A replicação entre nós mantém o sistema funcionando apesar de falhas individuais. O Google Spanner usa replicação síncrona entre datacenters. |
| **Compartilhamento de recursos** | A capacidade ociosa de muitas máquinas é agregada. O Folding@home junta ciclos de CPU para workloads científicos. |
| **Paralelismo** | As tarefas são divididas e processadas de forma concorrente. O MapReduce (Hadoop) é o exemplo clássico em análise de big data. |
| **Redução de latência** | Nós posicionados perto dos usuários reduzem o tempo de ida e volta. CDNs como a Akamai servem conteúdo a partir do ponto de borda mais próximo. |

Na loja, a escalabilidade horizontal é o que o [Hands-on 7](../../hands-on/7/index.md) faz com o Nginx na frente de várias réplicas de um serviço, e a redução de latência é o que o cache Redis do [Hands-on 8](../../hands-on/8/index.md) oferece.

---

## Desvantagens

| Desafio | Causa de raiz |
|---|---|
| **Complexidade** | Coordenação, sincronização e estado distribuído são difíceis de entender e de implementar corretamente. |
| **Sobrecarga de rede** | Mensagens podem ser atrasadas, perdidas ou duplicadas. Todo modo de falha precisa ser tratado explicitamente. |
| **Consistência vs. disponibilidade** | Durante uma partição de rede, um armazenamento de dados replicado não consegue ser ao mesmo tempo consistente e disponível — veja o [Teorema CAP](cap/index.md). |
| **Superfície de ataque maior** | Mais nós significam mais pontos de entrada. Falhas bizantinas (nós maliciosos) exigem protocolos dedicados. |
| **Custo operacional** | Depurar, monitorar e fazer o deploy de sistemas distribuídos exige ferramentas especializadas (Prometheus, Kubernetes, rastreamento distribuído). |

### As 8 falácias da computação distribuída

L. Peter Deutsch e colegas da Sun Microsystems[^2] listaram as suposições que os desenvolvedores costumam fazer ao construir sistemas distribuídos — todas erradas (a lista tinha sete itens em 1994; James Gosling acrescentou a oitava, *a rede é homogênea*, em 1997):

| Falácia | Realidade | Na loja |
|---|---|---|
| A rede é confiável | Pacotes são descartados, enlaces falham, cabos são cortados | A chamada do serviço de pedidos ao de produtos falha no meio |
| A latência é zero | Idas e voltas pela rede somam milissegundos; entre regiões, centenas | Cinco chamadas sequenciais de 40 ms cada resultam em um checkout de 200 ms |
| A largura de banda é infinita | Transferir payloads grandes satura os enlaces | Devolver o catálogo inteiro em uma única resposta |
| A rede é segura | O tráfego precisa ser criptografado e autenticado em cada salto | Os serviços confiam em qualquer chamador dentro do cluster |
| A topologia não muda | Nós sobem e caem; IPs mudam; serviços são reagendados | Um pod do Kubernetes é reagendado com um novo IP |
| Existe um único administrador | Várias equipes, várias contas de nuvem, várias políticas | Outra equipe muda uma regra de firewall |
| O custo de transporte é zero | Serialização, compressão e tarifas de saída de dados são reais | Parsing de JSON e tráfego entre zonas na fatura da nuvem |
| A rede é homogênea | Sistemas diferentes falam protocolos e codificações diferentes | Serviços em Java, um serviço em Python, o protocolo binário do Kafka |

!!! warning "Projete para a falha, não contra ela"
    Essas falácias têm uma raiz comum: tratar a rede como uma chamada de função local confiável. A postura correta é assumir que a falha vai acontecer e projetar cada interação para degradar de forma controlada.

---

## Os três problemas de raiz { #the-three-root-problems }

Quase toda dificuldade deste curso remonta a três fatos.

### 1. Falha parcial

Em uma única máquina, um programa funciona ou cai como um todo. Em um sistema distribuído, **parte** do sistema pode falhar enquanto o restante continua rodando: o serviço de produtos está fora do ar, mas o gateway e o serviço de pedidos estão bem. Cada componente precisa decidir o que fazer quando uma de suas dependências para de responder.

### 2. Uma rede não confiável: lento ou morto?

Quando o serviço de pedidos envia uma requisição e não recebe resposta, ele **não tem como saber** o que aconteceu. Considere as possibilidades:

``` mermaid-sim
sequenceDiagram
    participant O as Serviço de pedidos
    participant P as Serviço de produtos
    O->>P: reservar 1 unidade do produto 42
    Note over O,P: requisição perdida? P caiu? resposta perdida? P só está lento?
    O-->>O: timeout após 2 s
    O->>P: retry: reservar 1 unidade do produto 42
    P-->>O: OK (mas a primeira também foi aplicada?)
```

Do ponto de vista de quem chama, uma requisição perdida, um servidor que caiu, uma resposta perdida e um servidor muito lento parecem iguais: **silêncio**. A única ferramenta prática é um **timeout** — depois de um prazo, assume-se a falha. Mas um timeout não diz se a operação foi executada, então um retry pode aplicá-la **duas vezes**. Por isso, operações que podem ser repetidas precisam ser **idempotentes** (aplicá-las duas vezes tem o mesmo efeito que aplicá-las uma vez — por exemplo, enviando um id único de requisição que o servidor usa para descartar duplicatas). Timeouts, retries com backoff e circuit breakers são abordados em [Padrões de resiliência](../reliability/patterns/index.md).

### 3. Ausência de relógio global { #3-no-global-clock }

Cada máquina tem seu próprio relógio de quartzo, e os relógios **derivam**: dois servidores sincronizados com NTP (Network Time Protocol) ainda podem discordar em milissegundos, e muito mais depois de uma configuração errada ou de uma pausa da VM. Assim, você não consegue ordenar de forma confiável dois eventos em máquinas diferentes comparando seus horários de relógio — um pedido criado "às 10:00:00.120" em um nó pode, na verdade, ter acontecido *depois* de um cancelamento registrado "às 10:00:00.150" em outro.

---

## Tempo e ordenação: relógios lógicos { #time-and-ordering-logical-clocks }

Leslie Lamport[^1] observou que, na maioria dos casos, não precisamos do horário *real* dos eventos — precisamos da sua **ordem**, e especificamente da relação *aconteceu-antes* (*happened-before*, →):

- se *a* e *b* acontecem no mesmo processo e *a* vem primeiro, então *a* → *b*;
- se *a* é o envio de uma mensagem e *b* o seu recebimento, então *a* → *b*;
- se *a* → *b* e *b* → *c*, então *a* → *c*.

Dois eventos em que nenhum aconteceu antes do outro são **concorrentes**: nenhum deles pode ter influenciado o outro.

Um **relógio de Lamport** é um contador mantido por cada processo, atualizado com três regras:

1. Antes de cada evento local, incremente o contador.
2. Ao enviar uma mensagem, anexe o valor atual do contador.
3. Ao receber uma mensagem com valor *t*, ajuste o contador para `max(local, t) + 1`.

``` mermaid-sim
sequenceDiagram
    participant A as Serviço de pedidos
    participant B as Consumidor Kafka
    participant C as Notificação
    Note over A: cria o pedido (L=1)
    A->>B: OrderCreated (L=2)
    Note over B: recebe: max(0,2)+1 = 3
    Note over C: evento local (L=1)
    B->>C: SendEmail (L=4)
    Note over C: recebe: max(1,4)+1 = 5
```

A garantia é: **se *a* → *b*, então L(*a*) < L(*b*)**. A recíproca *não* é verdadeira — um timestamp de Lamport menor não prova que um evento causou o outro. Os **relógios vetoriais** resolvem isso mantendo um contador *por processo*; comparar dois vetores diz se um evento aconteceu antes do outro ou se eles são concorrentes. Eles são usados para detectar escritas conflitantes em bancos de dados replicados (veja [Consistência eventual](consensus/index.md#eventual-consistency-and-crdts)).

!!! example "Onde você vai encontrar ordenação no curso"
    O Kafka não usa o horário de relógio para ordenar mensagens: ele atribui a cada mensagem um **offset** monotonicamente crescente dentro de uma partição, de modo que todos os consumidores veem a mesma ordem naquela partição ([Hands-on 9](../../hands-on/9/index.md)). O Raft usa um contador lógico chamado **term** (mandato) para distinguir líderes antigos de novos ([Consenso](consensus/index.md#raft)).

!!! warning "Não ordene eventos de máquinas diferentes por `System.currentTimeMillis()`"
    Comparar timestamps gerados por servidores diferentes é uma fonte clássica de bugs, por exemplo na resolução de conflitos "last write wins" (a última escrita vence): um nó com o relógio adiantado vence silenciosamente todos os conflitos. Use uma única autoridade para a ordenação (uma sequence do banco de dados, o offset de uma partição do Kafka) ou relógios lógicos.

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :material-scale-balance:{ .lg .middle } **Teorema CAP**

    ---

    O trade-off central dos armazenamentos de dados distribuídos: consistência (Consistency), disponibilidade (Availability) e tolerância a partições (Partition Tolerance) não podem ser garantidas simultaneamente. Entenda as classes de sistemas CP, AP e CA — e a extensão PACELC.

    [:octicons-arrow-right-24: Teorema CAP](cap/index.md)

-   :material-handshake:{ .lg .middle } **Consenso e algoritmos**

    ---

    Como nós distribuídos chegam a um acordo apesar de falhas. Aborda Paxos, Raft, sistemas de quórum, modelos de falha (crash-stop, bizantina), o resultado de impossibilidade FLP e a consistência eventual.

    [:octicons-arrow-right-24: Consenso e algoritmos](consensus/index.md)

</div>

---

## Conexões

- [Microsserviços](../microservices/index.md) — dividir a loja em serviços é o que a transforma em um sistema distribuído.
- [Arquitetura orientada a eventos](../event_driven/index.md) e [Hands-on 9](../../hands-on/9/index.md) — mensageria assíncrona com Kafka, ordenada pelos offsets das partições.
- [Confiabilidade](../reliability/index.md) — timeouts, retries, circuit breakers: projetar para a falha parcial.
- [Hands-on 7](../../hands-on/7/index.md) e [Hands-on 8](../../hands-on/8/index.md) — escalabilidade horizontal atrás de um balanceador de carga, e um cache Redis.
- [Hands-on 10](../../hands-on/10/index.md) — rastreamento distribuído, para ver uma requisição atravessando muitos serviços.

## Pontos-chave

- Um sistema distribuído é um conjunto de nós independentes que cooperam **apenas trocando mensagens** e **não têm relógio compartilhado**; nossa loja vira um assim que tem mais de um serviço.
- Distribuímos para ganhar escalabilidade, tolerância a falhas e latência — e pagamos em complexidade, falhas de rede e custo operacional.
- As 8 falácias são todas falsas: projete toda chamada remota **para a falha**.
- Quem chama não consegue distinguir um nó lento de um nó morto: use **timeouts** e torne **idempotentes** as operações repetidas.
- Relógios físicos derivam; ordene eventos com uma única autoridade ou com **relógios lógicos** (Lamport, relógios vetoriais).

---

[^1]: LAMPORT, L. [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.azurewebsites.net/pubs/time-clocks.pdf){target="_blank"}. CACM, 1978.
[^2]: DEUTSCH, P. [Fallacies of Distributed Computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing){target="_blank"}, 1994.
[^3]: VAN STEEN, M.; TANENBAUM, A. S. [Distributed Systems](https://www.distributed-systems.net/){target="_blank"}, 4th ed., 2023.
