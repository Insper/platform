
Sexta-feira, 10:00. A **BoxOffice**, uma pequena start-up de ingressos, abre a venda do maior show de estádio do ano: **60.000 lugares, 2 milhões de fãs** atualizando a página no mesmo segundo. Às 10:00:04 o site responde em 9 segundos. Às 10:00:20 não responde mais nada. Às 10:03 ele volta — e 312 lugares foram vendidos **duas vezes**. O código não tinha nenhum bug que um teste unitário pudesse pegar: cada função fez exatamente o que foi escrita para fazer. O que falhou foi o **sistema**: quantas máquinas, qual banco de dados, onde os dados ficam, o que espera pelo quê e o que acontece quando 2 milhões de pessoas chegam ao mesmo tempo.

Esta disciplina trata dessa camada — as decisões que ficam *acima* do código e decidem se o código sobrevive ao contato com a realidade. Ao final do semestre você será capaz de projetar a BoxOffice para que as 10:00 de sexta-feira sejam um não-evento, **medir** que funciona e **defender** cada decisão com números, numa revisão de design ou numa entrevista de system design.

!!! quote "A história até aqui"

    Capítulo 1 da [história da disciplina](../../index.md#story). A BoxOffice é, por enquanto, um serviço e um banco de dados — e ninguém escreveu o que "funcionar" significa: quantos fãs, com que rapidez, com que disponibilidade, e o que nunca pode acontecer. **Esta aula** responde: o que a BoxOffice precisa fazer, e quão bem — em números contra os quais um design possa ser conferido?

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** o que é design de sistemas, como ele difere do design de software (no nível do código) e por que é uma disciplina de trade-offs, e não a busca pela arquitetura "certa".
    - **Distinguir** requisitos funcionais de não funcionais e **escrever** metas mensuráveis de atributos de qualidade (escalabilidade, disponibilidade, latência, consistência, durabilidade, custo, segurança, operabilidade) para um sistema.
    - **Traçar** a evolução de um sistema de um servidor até milhões de usuários, **identificando** o sintoma que dispara cada novo componente.
    - **Aplicar** um método com tempo controlado (esclarecer → estimar → API e modelo de dados → design de alto nível → aprofundamentos → gargalos e trade-offs → fechamento) a um problema de design aberto em 45 minutos.
    - **Usar** o System Design Playground para montar uma arquitetura a partir da paleta de componentes, colocá-la sob carga e ler suas métricas.

## Roteiro { #roadmap }

1. **Esta visão geral** — o que é design de sistemas, a paleta de componentes que organiza a disciplina e como usar o playground.
2. [Requisitos](requirements/index.md) — requisitos funcionais e não funcionais; os atributos de qualidade e como torná-los mensuráveis.
3. [A Jornada de Escala](scaling-journey/index.md) — a BoxOffice de 1 usuário a 10 milhões: primeiro o monólito, depois um componente por sintoma.
4. [O Método da Entrevista](interview-framework/index.md) — um método de 7 passos e 45 minutos para problemas de design abertos.
5. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/intro.html" title="Slides: o que é design de sistemas" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/intro.html){:target="_blank"}

---

## O que é design de sistemas? { #what-is-system-design }

**Design de sistemas** (*system design*) é o processo de definir os **componentes** de um sistema, as **interfaces** entre eles e os **dados** que passam por eles e são armazenados por eles, de modo que o sistema satisfaça seus requisitos — tanto *o que* ele deve fazer quanto *quão bem* deve fazê-lo[^1]. Ele responde a perguntas como:

- De quantos servidores precisamos, e o que acontece quando um deles morre?
- Onde fica cada dado, quem pode alterá-lo e com que rapidez cada leitor precisa ver a alteração?
- Que trabalho precisa acontecer *agora*, enquanto o usuário espera, e qual pode acontecer *depois*?
- Quanto isso custa por mês, e o que quebra primeiro se o tráfego dobrar?

Vale a pena colocar o design de sistemas ao lado do trabalho de design que você já conhece:

| Nível | Pergunta típica | Unidade de design | Exemplo da BoxOffice |
|---|---|---|---|
| **Algoritmo** | Como calculo isto de forma eficiente? | função, estrutura de dados | encontrar o melhor bloco de 4 lugares adjacentes disponíveis |
| **Design de software** | Como organizo este código para que seja fácil de mudar? | classes, módulos, pacotes | `OrderService` depende de uma interface `PaymentGateway` |
| **Design de sistemas** | Como estes *processos e máquinas em execução* cooperam sob carga e falha? | serviços, bancos de dados, filas, caches, redes | inventário no PostgreSQL com locks de linha; catálogo servido por um cache e uma CDN |

O salto do design de software para o design de sistemas é um salto de **um processo** para **muitos processos em muitas máquinas, ligados por uma rede não confiável**. Esse salto traz três realidades novas:

1. **Carga** — o sistema precisa continuar funcionando quando muitos usuários chegam ao mesmo tempo. Dez usuários e dez milhões de usuários pedem arquiteturas diferentes, não apenas mais do mesmo.
2. **Falha parcial** — algumas partes falham enquanto outras continuam rodando. Um disco enche, um nó reinicia, uma API de terceiros fica lenta. O sistema precisa cumprir suas promessas mesmo assim.
3. **Trade-offs** — quase toda decisão compra uma qualidade com outra. Um cache compra latência com frescor dos dados; uma réplica compra disponibilidade com consistência; uma fila compra resiliência com imediatismo.

!!! tip "Não existe arquitetura certa — só arquiteturas justificadas"

    A pergunta "qual é o melhor banco de dados?" não tem resposta. "Qual banco de dados serve para um inventário de lugares que nunca pode vender em dobro, com 5.000 escritas por segundo no pico, uma equipe de duas pessoas e um orçamento de R$ 20 mil por mês?" tem algumas boas respostas e muitas ruins. Design de sistemas é a habilidade de transformar o primeiro tipo de pergunta no segundo, e então escolher — dizendo em voz alta do que você abriu mão.

### Por que isso importa para você { #why-it-matters-to-you }

- **No trabalho**, quase toda funcionalidade acaba levantando uma questão de sistema: *Esta consulta vai ser rápida com 50 milhões de linhas? Este e-mail deve ser enviado de forma síncrona? O que acontece se o provedor de pagamentos cair?* Engenheiros que respondem com números tomam decisões melhores e recebem decisões maiores.
- **Em entrevistas**, system design é uma etapa padrão para vagas de engenharia de software na maioria das empresas de tecnologia. Ela é aberta de propósito: o entrevistador observa *como você pensa* — como esclarece, estima, estrutura e lida com trade-offs[^2].
- **Nesta disciplina**, é o fio que liga tudo, do DNS aos agentes de IA: cada tópico é um componente que você acrescenta a um design por um motivo que pode medir.

---

## BoxOffice, o exemplo da disciplina { #boxoffice-the-running-example }

Cada aula, laboratório, quiz e conjunto de slides usa o mesmo sistema fictício, para que cada conceito novo caia sobre um problema que você já conhece. A **BoxOffice** vende ingressos para shows, jogos e festivais. Ela foi escolhida porque tem, de propósito, *todas* as propriedades difíceis que um sistema real pode ter — e elas são intuitivas:

| Propriedade | Onde aparece na BoxOffice | Tópico da disciplina |
|---|---|---|
| **Picos** extremos | a venda relâmpago das 10:00: 2 M de fãs, 60 mil lugares | estimativas, borda, mensageria, desempenho |
| Tráfego **dominado por leituras** | navegar por eventos, locais, mapas de lugares | cache, CDN, réplicas |
| **Consistência forte** | um lugar pode ser vendido exatamente uma vez | bancos de dados, sistemas distribuídos |
| **Dependências externas** | provedor de pagamentos, e-mail, notificações push | computação e integrações, confiabilidade |
| **Busca** | "shows de rock em São Paulo no próximo fim de semana" | bancos de dados (motores de busca) |
| **Abuso** | robôs comprando ingressos para revender | borda (WAF, rate limiting), segurança |
| **Trabalho assíncrono** | ingressos por e-mail, sala de espera, analytics | mensageria |
| **IA** | um assistente de suporte que responde "posso trocar meu lugar?" | sistemas de IA |

Seus serviços — que você vai construir, medir e quebrar nos laboratórios — são `gateway`, `auth`, `catalog` (eventos e locais), `inventory` (lugares e reservas), `order`, `payment` (adaptador para um provedor externo), `notification`, `search` e `assistant` (IA). O código fica no repositório da disciplina, `https://github.com/repo-classes/pma271`.

É para cá que a BoxOffice caminha até o fim do semestre. Aperte play para acompanhar uma compra através dela:

``` diagram-sim
flowchart LR
    fan([Fã]) --> cdn["CDN"]
    fan --> waf["WAF"]
    waf --> gw["API Gateway"]
    gw --> auth["auth"]
    gw --> catalog["catalog"]
    catalog --> cache[("Cache")]
    cache --> catdb[("SQL")]
    gw --> wr["Sala de espera<br/>(fila)"]
    wr --> inventory["inventory"]
    inventory --> invdb[("SQL<br/>lugares e reservas")]
    inventory --> order["order"]
    order --> payment["payment"]
    payment --> psp["Provedor de pagamento<br/>(externo)"]
    order --> kafka["Event stream"]
    kafka --> notification["notification"]
    notification --> email["E-mail / push"]
```

Você **não** precisa entender cada caixa hoje. O objetivo da disciplina é que, na semana 15, você consiga explicar por que cada caixa está ali, que número faria você removê-la e o que acrescentaria em seguida.

---

## A paleta de componentes { #the-component-palette }

Arquiteturas reais são montadas a partir de um conjunto surpreendentemente pequeno de blocos. A disciplina é organizada em torno de uma **paleta de componentes** — a mesma paleta que o simulador da disciplina usa. Cada aula teórica ensina um grupo de componentes: o que cada um faz, quando usá-lo, quando *não* usá-lo, os números que o descrevem e como ele falha.

| Categoria | Componentes | Aula principal |
|---|---|---|
| **Cliente** | Client, Mobile | [1. Introdução](index.md) |
| **Tráfego e borda** | DNS, CDN, Load Balancer, WAF, API Gateway, Ingress | [4. Tráfego e Borda](../edge/index.md) |
| **Computação** | App Server, Worker, Serverless, Auth Service, Search, Scheduler, Notifications, Analytics | [5. Computação e Serviços](../compute/index.md) |
| **Contêineres** | Microservice, Container, Kubernetes Cluster, Service Registry | [11. Cloud-Native](../cloud-native/index.md), [5. Computação e Serviços](../compute/services/index.md) |
| **Armazenamento** | SQL Database, DB Cluster, NoSQL DB, Cache, Object Store, Data Warehouse, Vector DB | [6. Bancos de Dados](../databases/index.md), [7. Cache](../caching/index.md) |
| **Mensageria** | Message Queue, Pub/Sub, Event Stream, Kafka | [8. Mensageria](../messaging/index.md) |
| **Observabilidade** | Metrics, Logs, Tracing, Alerting, Health Check | [9. Observabilidade](../observability/index.md) |
| **Rede** | VPC, Subnet, NAT Gateway, VPN, Service Mesh | [12. Rede e Segurança](../network-security/index.md) |
| **IA e agentes** | LLM Gateway, Orchestrator, Tool Registry, Memory Fabric, Safety Mesh | [13. Sistemas de IA](../ai-systems/index.md) |
| **Externo** | 3rd Party API, Payment, Email | [5. Computação e Serviços](../compute/index.md) |

As demais aulas são **transversais**: não acrescentam caixas, mas dão as ferramentas para raciocinar sobre todas elas.

``` diagram
flowchart TB
    subgraph F["Fundamentos"]
        direction LR
        c1["1. Introdução e<br/>método da entrevista"] --> c2["2. Estimativas e<br/>matemática de desempenho"] --> c3["3. Sistemas<br/>distribuídos"]
    end
    subgraph P["A paleta, um grupo por aula"]
        direction LR
        c4["4. Borda"] --> c5["5. Computação"] --> c6["6. Bancos de dados"] --> c7["7. Cache"] --> c8["8. Mensageria"]
    end
    subgraph O["Rodando em produção"]
        direction LR
        c9["9. Confiabilidade"] --> c10["10. Observabilidade"] --> c11["11. Rede e<br/>segurança"] --> c12["12. Cloud-native"]
    end
    subgraph X["Juntando tudo"]
        direction LR
        c13["13. Sistemas de IA"] --> c14["14. Entrega assistida<br/>por IA"] --> c15["15. Desempenho e<br/>testes de carga"] --> c16["16. Estudos de caso"]
    end
    F --> P --> O --> X
```

Cada componente tem uma entrada no [catálogo de componentes](../../reference/components/index.md) — por exemplo [Load Balancer](../../reference/components/edge/index.md#lb), [Cache](../../reference/components/storage/index.md#cache) ou [Message Queue](../../reference/components/messaging/index.md#queue) — com uma definição de uma linha para entrevistas, números-chave, modos de falha e os produtos reais (AWS, GCP, Azure, open source) que o implementam. Use-o como dicionário durante a leitura.

!!! info "Como o semestre funciona"

    Toda semana tem um encontro de **teoria** (uma aula como esta) e um de **prática** (um laboratório). A teoria apresenta um grupo da paleta e o raciocínio por trás dele; o laboratório leva a mesma ideia para o código real da BoxOffice (Java 21 + Spring Boot, PostgreSQL, Redis, Kafka, Nginx, Kubernetes…) e a **mede** com k6. Os exercícios individuais fazem você praticar estimativas, designs no playground e relatórios de testes de carga; o projeto em equipe leva um sistema de um documento de design até um deploy testado sob carga, observável e com um game day de caos.

---

## O System Design Playground { #the-system-design-playground }

Ler sobre um cache não é o mesmo que ver a latência p99 cair quando a taxa de acerto sobe. A disciplina vem com um simulador, o **[System Design Playground](../../../playground/index.md)**, em que cada componente da paleta é um bloco que você solta numa tela, conecta e coloca sob carga. Ele é um *modelo* — não executa código real —, mas reproduz o comportamento que importa para o design: filas que crescem quando um componente está saturado, latência que explode perto da utilização máxima, falhas que se propagam em cascata quando não há timeouts, custo que cresce a cada réplica.

O fluxo de trabalho é sempre o mesmo:

1. **Montar** — escolha componentes da paleta e conecte-os (cliente → load balancer → app → banco de dados…).
2. **Configurar** — defina capacidades, réplicas, taxas de acerto de cache, timeouts.
3. **Carregar** — escolha um perfil de carga: `smoke` (um fio de tráfego, para verificar que funciona), `load` (o tráfego esperado), `stress` (além dele), `spike` (um salto repentino, como as 10:00 de sexta), `soak` (horas a uma taxa constante), `breakpoint` (rampa até algo quebrar), `chaos` (injeção de falhas).
4. **Ler** — acompanhe throughput, percentis de latência (p50, p99), taxa de erros, utilização por componente e custo mensal.
5. **Mudar uma coisa e rodar de novo.** É o método científico aplicado à arquitetura, e é exatamente o que você fará com sistemas reais nos laboratórios.

Ao longo da disciplina, as páginas incorporam o playground já carregado com um cenário. Aqui está o primeiro: a BoxOffice como um único servidor de aplicação e um único banco SQL.

**Experimente:** comece com o perfil `load` e anote a latência p99 e a utilização da aplicação e do banco. Depois mude para `spike`. Qual componente satura primeiro? O que acontece com a latência *antes* de os erros aparecerem? Anote a taxa de requisições em que as coisas deram errado — você vai calculá-la à mão na [aula 2](../estimation/index.md).

<div class="sdp" data-scenario="monolith" data-mode="full" data-height="560"></div>

??? question "O que você viu? (abra depois de experimentar)"

    À medida que a carga se aproxima da capacidade do componente mais carregado, a latência cresce devagar no início e depois **explode** — muito antes de a taxa de erros subir. As requisições se acumulam na fila diante do componente saturado; cada nova requisição espera por todas as que estão à frente. Esse "joelho" na curva de latência é uma das formas mais importantes da disciplina: a [aula 2](../estimation/queueing/index.md) o explica com teoria de filas, e toda decisão de capacidade que você tomar depois (quantas réplicas? que tamanho de pool de conexões?) é sobre ficar à esquerda dele.

O segundo cenário coloca um load balancer na frente de várias réplicas da aplicação.

**Experimente:** rode o perfil `stress` com 1 réplica, depois 2, depois 4. O throughput dobra a cada vez? Observe o banco de dados: a partir de certo ponto, acrescentar réplicas da aplicação deixa de ajudar. Por quê? Depois derrube uma réplica (ou use o perfil `chaos`) e veja o que os health checks fazem.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520"></div>

!!! example "BoxOffice — o que os dois cenários ensinam"

    A escala horizontal (mais servidores de aplicação) só ajuda **enquanto os servidores de aplicação são o gargalo**. Quando o banco único satura, as réplicas extras apenas fazem fila no banco em vez de na aplicação. O próximo passo não é "mais do mesmo", e sim um *componente diferente*: um cache para as leituras do catálogo, réplicas de leitura ou uma fila na frente do inventário de lugares. Escolher qual, e provar com números, é o assunto de [A Jornada de Escala](scaling-journey/index.md) e do resto da disciplina.

---

## O mapa de conceitos da introdução { #concept-map }

Esta aula passa de leve por toda a paleta: cada **atributo de qualidade** (azul) é comprado com alguns **componentes da paleta** (verde), e a jornada de escala os adiciona um sintoma medido de cada vez. Use o mapa como índice para o resto do curso:

``` diagram
flowchart LR
    client["client · mobile"]:::comp --> req["requisitos:<br/>funcionais + atributos de qualidade"]:::tech
    req --> scal["escalabilidade"]:::tech
    req --> lat["latência"]:::tech
    req --> avail["disponibilidade"]:::tech
    req --> cons["consistência,<br/>durabilidade"]:::tech
    req --> sec["segurança"]:::tech
    req --> ops["operabilidade"]:::tech
    scal --> c1["lb · réplicas de app ·<br/>queue · worker · nosql"]:::comp
    lat --> c2["cache · cdn"]:::comp
    avail --> c3["healthcheck · failover de dns"]:::comp
    cons --> c4["sql · objstore"]:::comp
    sec --> c5["waf · apigw · auth"]:::comp
    ops --> c6["metrics · logs · tracing"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`client`](../../reference/components/client/index.md#client) · [`mobile`](../../reference/components/client/index.md#mobile) | *Quem* usa o sistema, e para quê? | atores, requisitos funcionais, caminho principal, esboço da API | [Requisitos](requirements/index.md) | `monolith` |
| [`app`](../../reference/components/compute/index.md#app) | O que executa a lógica, e como ter mais dele? | uma máquina primeiro, réplicas stateless, escalar verticalmente vs horizontalmente, monolito primeiro | [A Jornada de Escala](scaling-journey/index.md) (estágios 0, 2, 7) | `monolith`, `scale-out` |
| [`lb`](../../reference/components/edge/index.md#lb) · [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | Como um crash ou um deploy deixa de ser uma indisponibilidade? | ponto único de falha, health checks, deploys graduais | [A Jornada de Escala](scaling-journey/index.md) (estágio 2) | `scale-out` |
| [`sql`](../../reference/components/storage/index.md#sql) | Onde mora a verdade, e quão atualizada os leitores precisam vê-la? | banco separado, réplicas de leitura, atraso de replicação, consistência forte para assentos | [A Jornada de Escala](scaling-journey/index.md) (estágios 1, 3), [Requisitos](requirements/index.md) | `db-replicas` |
| [`cache`](../../reference/components/storage/index.md#cache) · [`cdn`](../../reference/components/edge/index.md#cdn) · [`objstore`](../../reference/components/storage/index.md#objstore) | Como parar de calcular e enviar os mesmos bytes de novo? | taxa de acerto, TTL, invalidação, nomes de arquivo versionados | [A Jornada de Escala](scaling-journey/index.md) (estágios 4, 5) | `read-heavy-cache`, `cdn-static` |
| [`queue`](../../reference/components/messaging/index.md#queue) · [`worker`](../../reference/components/compute/index.md#worker) | O que pode acontecer *depois*, e como sobreviver a um pico? | trabalho assíncrono, sala de espera, pelo menos uma vez, consumidores idempotentes | [A Jornada de Escala](scaling-journey/index.md) (estágio 6) | `async-queue`, `flash-sale` |
| [`apigw`](../../reference/components/edge/index.md#apigw) · [`stream`](../../reference/components/messaging/index.md#stream) | Como muitos times e serviços compartilham um produto? | serviços por fronteiras de negócio, ponto único de entrada, eventos | [A Jornada de Escala](scaling-journey/index.md) (estágio 7) | `event-fanout` |
| [`nosql`](../../reference/components/storage/index.md#nosql) · [`search`](../../reference/components/compute/index.md#search) · [`dwh`](../../reference/components/storage/index.md#dwh) | E se um banco for grande demais, quente demais ou errado para a tarefa? | particionamento, partições quentes, índice invertido, analytics fora do banco transacional | [A Jornada de Escala](scaling-journey/index.md) (estágio 8) | `sharding` |
| [`waf`](../../reference/components/edge/index.md#waf) · [`dns`](../../reference/components/edge/index.md#dns) | Como sobreviver a bots, ataques e à queda de uma região? | mitigação de bots, rate limiting, multirregião, failover por DNS | [A Jornada de Escala](scaling-journey/index.md) (estágio 9) | `multi-region`, `flash-sale` |
| *(todos eles)* | Quais componentes, em que ordem, e quanto custam? | atributos de qualidade, trade-offs, o método de 7 passos | [Requisitos](requirements/index.md), [O Método da Entrevista](interview-framework/index.md) | `flash-sale` |

---

## Como estudar design de sistemas { #how-to-study-system-design }

- **Desenhe.** Todo conceito desta disciplina tem uma figura. Se você não consegue desenhá-lo, ainda não o entendeu.
- **Estime antes de projetar.** Um design para 100 requisições por segundo e outro para 100.000 são designs diferentes. A [aula 2](../estimation/index.md) dá os números e as fórmulas.
- **Dê nome ao trade-off.** Para cada componente que você acrescenta, diga o que ele compra e quanto custa: "o cache reduz o p99 do catálogo de 80 ms para 5 ms, ao preço de mostrar um preço com até 60 s de atraso".
- **Quebre coisas de propósito.** No playground e nos laboratórios, encontre o ponto de ruptura e depois corrija-o. Você aprende mais com uma saturação do que com dez diagramas.
- **Pratique em voz alta.** Design de sistemas é uma conversa. Use o [método da entrevista](interview-framework/index.md) com um colega toda semana, a partir de agora.

!!! success "Boas práticas"

    - **Ligue cada componente a um requisito** — cada caixa de um design deve apontar para o número que atende (uma carga, uma meta de latência, uma disponibilidade); uma caixa que não atende número nenhum é custo sem motivo. Na BoxOffice: os [requisitos não funcionais](requirements/index.md) da primeira versão.
    - **Guarde os números do documento de design com a fonte** — uma premissa marcada como premissa, uma medição com data e ambiente — para que um revisor confira qualquer um deles em minutos. Na BoxOffice: todo laboratório termina com um arquivo `results/labN.md` ([Hands-on 2](../../hands-on/2/index.md#measure-it)).
    - **Mude uma coisa por experimento, e meça antes e depois** — duas mudanças de uma vez tornam o resultado impossível de explicar. Na BoxOffice: o lab 2 muda só o tamanho do pool e repete a mesma varredura.
    - **Registre cada decisão com a alternativa rejeitada e o seu preço** — um registro curto (contexto, decisão, consequências) responde "por que Redis?" seis meses depois, quando quem decidiu já saiu.
    - **Para cada caixa, escreva o que acontece quando ela fica lenta ou cai** — uma linha por componente, antes de construí-lo; falha parcial é o caso normal num sistema de muitas máquinas ([aula 3](../distributed/index.md)).

!!! warning "Armadilhas comuns no começo"

    - **Pular para nomes de tecnologia** ("Kafka! Kubernetes! microsserviços!") antes de entender o problema e seus números.
    - **Projetar para a escala do Google** quando o problema tem 1.000 usuários. Excesso de engenharia é tão errado quanto falta dela — e mais caro.
    - **Tratar o diagrama como a resposta.** As caixas são a parte fácil; o raciocínio sobre carga, falha e trade-offs é o design.
    - **Ignorar custo e operabilidade.** Uma arquitetura que a equipe não consegue pagar ou não consegue operar às 3 da manhã não é uma boa arquitetura.

---

## Relacionados { #related }

- Laboratórios: [0. Ambiente](../../hands-on/0/index.md) (ferramentas e o repositório da disciplina) e [1. Primeiro serviço](../../hands-on/1/index.md) (a API `catalog`).
- Exercício: [Design no playground](../../exercises/playground-design/index.md) — resolver desafios do playground com metas de SLO e custo.
- Estudo de caso: [Venda de ingressos — a venda relâmpago da BoxOffice](../case-studies/ticketing/index.md), o design completo do sistema apresentado aqui.
- Entrevista: [Método da entrevista](../../support/interview/framework/index.md) e [problemas para praticar](../../support/interview/problems/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Design de sistemas decide **componentes, interfaces e dados** para que um sistema cumpra requisitos funcionais *e* não funcionais sob **carga** e **falha parcial**.
    - É uma **disciplina de trade-offs**: cada componente compra uma qualidade com outra; bons designs dizem qual.
    - A disciplina é organizada em torno de uma **paleta de componentes** com dez categorias; cada aula teórica ensina um grupo, e o [catálogo](../../reference/components/index.md) é o seu dicionário.
    - A **BoxOffice** — uma plataforma de ingressos com uma venda relâmpago às 10:00 — é o exemplo em toda parte.
    - O **playground** permite montar, carregar e quebrar arquiteturas em minutos; os laboratórios fazem o mesmo com código real e medições reais.

## O que quebra em seguida { #what-breaks-next }

Os requisitos agora têm números — 2 milhões de fãs no primeiro minuto, 60.000 lugares, p99 da reserva < 300 ms, checkout disponível 99,95% do tempo —, mas ninguém os conferiu contra o único PostgreSQL em que a BoxOffice roda. Se ele aguenta a abertura das 10:00 não é questão de opinião, é aritmética: requisições por segundo, o tempo que uma reserva ocupa o banco, quão cheio ele pode rodar antes de a latência explodir. Fazer essa conta, e encontrar ~33.000 tentativas de reserva/s contra ~1.100 que um banco sustenta, é a [aula 2 — Estimativas](../estimation/index.md).

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter 1 (trade-offs in data systems architecture).
[^2]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Chapter 3 (a framework for system design interviews).
