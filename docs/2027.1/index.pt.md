# Arquitetura de Sistemas — 2027.1 { #system-architecture-20271 }

A maioria dos sistemas que você vai construir ou manter na carreira precisa ser **rápida, disponível, consistente o suficiente, segura e barata — ao mesmo tempo, sob carga, enquanto partes dela falham**. Esta edição da disciplina trata de como projetar esses sistemas, como **provar** com números que um design funciona e como **explicá-lo** — para um time numa revisão de design e para um entrevistador numa entrevista de system design.

!!! abstract "O que muda em 2027.1"

    A disciplina é reorganizada em torno dos **blocos de construção das arquiteturas modernas** — a mesma paleta de componentes que você encontra no [System Design Playground](../playground/index.md): cliente, tráfego e borda, computação, armazenamento, mensageria, observabilidade, rede, IA e agentes e serviços externos.

    - Cada aula ensina um grupo de componentes, com os trade-offs, os números e os modos de falha que importam na prática e nas entrevistas.
    - Cada página de aula embute o **playground**, já carregado com um cenário, para você *ver* o conceito sob carga: mude um parâmetro, rode um teste de carga com aleatoriedade (quedas, picos, chaves quentes, queda de região) e leia o relatório.
    - Os labs práticos constroem um único sistema ao longo do semestre — o **BoxOffice**, uma plataforma de ingressos com uma venda relâmpago às 10:00 — e todo lab termina com uma etapa **"Meça"**.
    - A seção [Apoio](support/interview/index.md) traz o material de entrevista, um caderno de exercícios, uma folha de consulta, um mapa de conceitos e cartas de estudo.

## O exemplo condutor: BoxOffice { #the-running-example-boxoffice }

Um show no estádio abre as vendas às 10:00. Dois milhões de fãs, sessenta mil lugares. O catálogo é dominado por leituras, o estoque de lugares nunca pode vender o mesmo lugar duas vezes, os pagamentos passam por um provedor externo que às vezes fica lento, as confirmações saem por e-mail, bots tentam comprar tudo e um assistente de IA responde "encontre dois lugares abaixo de R$ 300 para sábado e reserve". Quase todo tema da disciplina aparece neste único sistema.

``` diagram
flowchart LR
    U["fãs<br/>(web, mobile)"] --> DNS["DNS"] --> CDN["CDN"] --> WAF["WAF"] --> GW["API gateway"]
    GW --> AUTH["auth"]
    GW --> CAT["catalog"] --> CACHE[("cache")]
    CACHE --> SQL[("SQL")]
    GW --> Q["sala de espera<br/>(fila)"] --> INV["inventory<br/>(reservas de lugar)"] --> SQL
    INV --> ORD["order"] --> PAY["payment"] --> EXT["provedor de pagamento"]
    ORD --> K["stream de eventos"] --> NOTIF["notification"] --> MAIL["e-mail"]
    K --> AN["analytics / DWH"]
    GW --> AI["assistente<br/>(gateway de LLM, ferramentas, RAG)"]
```

## A história da disciplina { #story }

As aulas não são uma lista de temas: são os capítulos de uma única história. O BoxOffice começa como **um serviço e um banco de dados**, e cada capítulo começa com o problema que o anterior deixou, expresso com um número. Um componente só entra no design quando um número o exige, e cada um traz um novo problema. Aperte play para seguir a cadeia:

``` diagram-sim
flowchart TD
    C1["1. O que o BoxOffice precisa fazer, e quão bem?"] -->|"2 M de fãs, 60 mil lugares, p99 < 300 ms:<br/>um banco de dados basta?"| C2["2. Estime antes de construir"]
    C2 -->|"33.000 holds/s contra ~1.100:<br/>precisamos de mais de uma máquina"| C3["3. Mais máquinas, uma rede que mente"]
    C3 -->|"as réplicas existem: quem recebe<br/>as 2 M de requisições às 10:00?"| C4["4. Tráfego, borda e identidade"]
    C4 -->|"a borda espalha a carga entre réplicas:<br/>o que uma réplica precisa ser?"| C5["5. Computação e serviços"]
    C5 -->|"serviços stateless empurram todo<br/>o estado para o banco"| C6["6. Bancos de dados"]
    C6 -->|"as páginas de evento são lidas 100× mais<br/>do que mudam"| C7["7. Cache"]
    C7 -->|"o checkout ainda espera<br/>pelo provedor de e-mail"| C8["8. Mensageria"]
    C8 -->|"a assincronia esconde falhas:<br/>para onde foi aquele pedido?"| C9["9. Observabilidade"]
    C9 -->|"agora enxergamos: o provedor responde<br/>em 4 s e arrasta o checkout junto"| C10["10. Confiabilidade"]
    C10 -->|"um notebook com Compose não se cura,<br/>não escala nem faz deploy com segurança"| C11["11. Plataformas cloud-native"]
    C11 -->|"muitos serviços numa plataforma:<br/>quem pode falar com quem? o que entregamos?"| C12["12. Redes e segurança"]
    C12 -->|"os fãs perguntam em linguagem natural:<br/>'dois lugares abaixo de R$ 300, sábado'"| C13["13. Sistemas de IA"]
    C13 -->|"mais mudanças, mais rápido:<br/>quem revisa, testa, faz o release?"| C14["14. Entrega assistida por IA"]
    C14 -->|"o design inteiro aguenta<br/>a próxima abertura de vendas? prove"| C15["15. Engenharia de desempenho"]
    C15 -->|"os mesmos blocos, outros sistemas"| C16["16. Estudos de caso"]
```

Cada linha da tabela é um capítulo: o **problema** que o abre, a **aula** que o responde, o **lab** em que você constrói a resposta no BoxOffice (e o arquivo para ler primeiro) e o **cenário do playground** em que você o vê falhar e se recuperar. O [planejamento](planning.md) põe os capítulos no calendário.

| | O problema (BoxOffice) | Aula | Construído em | Código para ler | Veja |
|:-:|---|---|---|---|---|
| 1 | Ninguém escreveu o que "funcionar" significa: quantos fãs, quão rápido, quão disponível. | [O que é Design de Sistemas](classes/intro/index.md) | [Lab 0](hands-on/0/index.md) | `scripts/check-env.sh` | `monolith`, `flash-sale` |
| 2 | Um único PostgreSQL aguenta a abertura de vendas das 10:00? A demanda é de **~33.000 holds/s**; um banco faz **~1.100** numa utilização sensata. | [Estimativas](classes/estimation/index.md) | [Lab 1](hands-on/1/index.md), [Lab 2](hands-on/2/index.md) | [`load/stress.js`, `scripts/sweep.sh`](hands-on/2/index.md) | `monolith` (ponto de ruptura) |
| 3 | Uma diferença de 30× significa muitas máquinas, e entre máquinas a rede perde, atrasa e duplica mensagens: um "comprar" repetido pode cobrar duas vezes. | [Sistemas Distribuídos](classes/distributed/index.md) | [Lab 2](hands-on/2/index.md) (o joelho, medido) | — | `db-replicas`, `multi-region` |
| 4 | Dois milhões de celulares apertam *atualizar* às 10:00:00. A maior parte dessas requisições nunca deve chegar a um serviço, o resto deve chegar a uma réplica saudável, e todo chamador precisa provar quem é. | [Tráfego e Borda](classes/edge/index.md) | [Lab 3](hands-on/3/index.md), [Lab 4](hands-on/4/index.md) | [`infra/nginx/nginx.conf`](hands-on/3/index.md), [`TokenService.java`](hands-on/4/auth/index.md) | `scale-out`, `cdn-static`, `rate-limiter` |
| 5 | Atrás da borda, réplicas vêm e vão: uma réplica que guarda a sessão ou a reserva em memória a perde. O que um serviço precisa ser para escalar horizontalmente? | [Computação e Serviços](classes/compute/index.md) | [Lab 4](hands-on/4/index.md) | [`SecurityConfig.java`](hands-on/4/gateway/index.md) (gateway) | `microservices`, `serverless-burst` |
| 6 | Serviços stateless empurram toda decisão para o banco, e 2 fãs clicam no mesmo lugar no mesmo milissegundo. | [Bancos de Dados](classes/databases/index.md) | [Lab 6](hands-on/6/index.md) | [`HoldService.java`](hands-on/6/holds/index.md) | `db-replicas`, `sharding`, `db-failover` |
| 7 | As páginas de evento são lidas ~100× mais do que mudam; o banco gasta sua capacidade respondendo à mesma pergunta. | [Cache](classes/caching/index.md) | [Lab 5](hands-on/5/index.md) | [`EventCache.java`](hands-on/5/cache-aside/index.md) | `read-heavy-cache` |
| 8 | O checkout espera pelo e-mail e pelo provedor; quando o servidor de e-mail cai, ninguém consegue comprar. 30× mais fãs do que a capacidade precisam de uma fila justa. | [Mensageria](classes/messaging/index.md) | [Lab 7](hands-on/7/index.md) | [`Outbox.java`](hands-on/7/outbox/index.md), [`WaitingRoom.java`](hands-on/7/waiting-room/index.md) | `async-queue`, `event-fanout` |
| 9 | A assincronia esconde falhas: um pedido some entre o Kafka e o e-mail, e os dashboards ficam verdes enquanto os fãs não conseguem pagar. O que exatamente prometemos (o SLO), e como sabemos que cumprimos? | [Observabilidade](classes/observability/index.md) | [Lab 8](hands-on/8/index.md) | [`slo-catalog.yaml`](hands-on/8/slo/index.md) | `observability-stack` |
| 10 | Agora conseguimos ver: às 10:02 o provedor de pagamento responde em 4 s em vez de 200 ms. Nada está fora do ar, mas toda thread do `order` fica esperando por ele e o checkout morre junto. | [Confiabilidade](classes/reliability/index.md) | [Lab 9](hands-on/9/index.md) | [`PaymentClient.java`](hands-on/9/patterns/index.md) | `cascading-failure`, `retry-storm`, `db-failover` |
| 11 | O Compose numa única máquina não reinicia uma réplica morta em outro nó, não escala às 09:45 nem faz rollback de um release ruim. | [Cloud-Native](classes/cloud-native/index.md) | [Lab 10](hands-on/10/index.md), [Lab 11](hands-on/11/index.md) | [`catalog-hpa.yaml`](hands-on/10/autoscaling/index.md), [`catalog-rollout.yaml`](hands-on/11/canary/index.md) | `k8s-node-failure`, `serverless-burst` |
| 12 | Muitos serviços agora dividem uma plataforma: bots compram os melhores lugares, um token vaza, todo serviço confia em todos os outros e ninguém verifica o que o pipeline entrega. | [Redes e Segurança](classes/network-security/index.md) | [Lab 11](hands-on/11/supply-chain/index.md) (cadeia de suprimentos) | [`.github/dependabot.yml`](hands-on/11/supply-chain/index.md) | `payment-system`, `flash-sale` |
| 13 | Os fãs perguntam "dois lugares abaixo de R$ 300 no sábado?": a resposta vem de uma dependência lenta, cara e não determinística, que lê o catálogo e o mapa de lugares por ferramentas e nunca pode inventar um lugar nem obedecer a um texto escondido numa página. | [Sistemas de IA](classes/ai-systems/index.md) | [Lab 12](hands-on/12/index.md) | [`agent.py`, `tools.py`](hands-on/12/tools/index.md) | `ai-assistant` |
| 14 | Com a IA escrevendo código, as mudanças chegam mais rápido do que as pessoas conseguem revisá-las, testá-las e fazer o release. | [Entrega Assistida por IA](classes/ai-delivery/index.md) | [Lab 13](hands-on/13/index.md) | [`review.py`](hands-on/13/review/index.md) | `ai-assistant` |
| 15 | Cada capítulo acrescentou uma caixa. O design inteiro aguenta a próxima abertura de vendas, e quanto custa? | [Engenharia de Desempenho](classes/performance/index.md) | [Lab 11](hands-on/11/performance-gate/index.md), [Projeto](exercises/project/index.md) | [`load/budget.js`](hands-on/11/performance-gate/index.md) | `flash-sale` |
| 16 | Um sistema diferente amanhã (um feed, um chat, um app de corridas): os mesmos blocos, outros números. | [Estudos de Caso](classes/case-studies/index.md) | [Exercícios](exercises/index.md) | — | um por caso |

!!! tip "Como ler uma aula com a história em mente"

    Toda aula abre com **"A história até aqui"** (onde o BoxOffice está e qual número força esta aula) e termina com **"O que quebra a seguir"** (o limite do que você acabou de aprender, que abre o próximo capítulo). Toda subpágina tem um mapa **"Como se conecta"**, um quadro **"Boas práticas"** (os hábitos que um revisor espera, ao lado das armadilhas a evitar) e, quando um lab implementa a ideia, um quadro **"No código do BoxOffice"** com o arquivo real; todo lab lista as boas práticas que seu código aplica. Quando você souber dizer, para cada componente, *qual número o colocou ali* e *quanto ele custa*, você consegue defender o design — numa revisão ou numa entrevista.

## Mapa da disciplina { #map-of-the-course }

| Parte | Aulas | Labs (BoxOffice) |
|---|---|---|
| **Fundamentos** | [1. O que é Design de Sistemas](classes/intro/index.md) · [2. Estimativas e Matemática de Desempenho](classes/estimation/index.md) · [3. Sistemas Distribuídos](classes/distributed/index.md) | [0. Ambiente](hands-on/0/index.md) · [1. Primeiro serviço](hands-on/1/index.md) · [2. Meça primeiro](hands-on/2/index.md) |
| **Blocos de construção** | [4. Tráfego e Borda](classes/edge/index.md) · [5. Computação e Serviços](classes/compute/index.md) · [6. Bancos de Dados](classes/databases/index.md) · [7. Cache](classes/caching/index.md) · [8. Mensageria](classes/messaging/index.md) | [3. Borda](hands-on/3/index.md) · [4. Gateway e identidade](hands-on/4/index.md) · [5. Cache](hands-on/5/index.md) · [6. Dados em escala](hands-on/6/index.md) · [7. Assíncrono](hands-on/7/index.md) |
| **Operando em escala** | [9. Observabilidade](classes/observability/index.md) · [10. Confiabilidade](classes/reliability/index.md) · [11. Cloud-Native](classes/cloud-native/index.md) · [12. Redes e Segurança](classes/network-security/index.md) | [8. Observabilidade](hands-on/8/index.md) · [9. Resiliência e caos](hands-on/9/index.md) · [10. Kubernetes](hands-on/10/index.md) · [11. Entrega](hands-on/11/index.md) |
| **IA** | [13. Sistemas de IA e Agentes](classes/ai-systems/index.md) · [14. Entrega Assistida por IA](classes/ai-delivery/index.md) | [12. Assistente de IA](hands-on/12/index.md) · [13. IA no CI/CD](hands-on/13/index.md) |
| **Prove** | [15. Engenharia de Desempenho](classes/performance/index.md) · [16. Estudos de Caso](classes/case-studies/index.md) | [Exercícios](exercises/index.md) · [Projeto](exercises/project/index.md) |

O plano semana a semana está na [página de planejamento](planning.md).

## Encontros { #meetings }

| :octicons-location-24: | :fontawesome-regular-calendar: | :fontawesome-regular-clock: |
|-|:-:|:-:|
| Aula | *A definir* | *A definir* |
| Aula | *A definir* | *A definir* |
| Atendimento | *A definir* | *A definir* |

## Professores { #instructors }

<div class="grid cards" markdown>

-   :material-account-tie:{ .lg .middle } **Professor**

    ---

    **Humberto Sandmann**

    [:material-web:](https://hsandmann.github.io/){:target="_blank"}
    [:simple-github:](https://github.com/hsandmann){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/hsandmann/){:target="_blank"}

-   :material-school:{ .lg .middle } **Monitor**

    ---

    *A definir*

</div>

## Nota { #grade }

$$
\text{Final Grade} = \left\{\begin{array}{lll}
    \text{Individual} \geq 5 \bigwedge \text{Team} \geq 5 &
    \implies &
    \displaystyle \frac{ \text{Individual} + \text{Team} } {2}
    \\
    \\
    \text{Otherwise} &
    \implies &
    \min\left(\text{Individual}, \text{Team}\right)
    \end{array}\right.
$$

```python exec="1" html="1"
--8<-- "docs/2027.1/grade.py"
```

1. **Exercícios** (individuais): sete exercícios — estimativas, relatório de teste de carga, cache e banco de dados, orientado a eventos, autoscaling no Kubernetes, design no playground e documento de design — cada um avaliado com um conceito (A–I) e uma rubrica. Pesos e regras estão na [página de exercícios](exercises/index.md).

1. **Quizzes**: três quizzes; o menor é descartado e a nota é a média dos dois melhores:

    $$
    \text{Quizzes} = \frac{\text{Q}_1 + \text{Q}_2 + \text{Q}_3 - \min(\text{Q}_1, \text{Q}_2, \text{Q}_3)}{2}
    $$

1. **Provas**: uma prova intermediária e uma prova final, individuais, cobrindo as aulas e os labs. Parte de cada prova é uma questão curta de system design no formato do [método da entrevista](classes/intro/interview-framework/index.md).

1. **Projeto em equipe**: equipes de **2 ou 3 estudantes** constroem, medem, quebram de propósito e defendem um sistema, em nove marcos (documento de design, caminho principal, escala e cache, assíncrono e resiliência, Kubernetes + CI/CD, campanha de testes de carga, game day de caos, relatório de custos, apresentação). A nota da equipe é a mesma para todos os membros. Detalhes na [página do projeto](exercises/project/index.md).

    !!! warning "Inscrição das equipes"

        :fontawesome-regular-calendar: Prazo: fim da **semana 3** (data na [página de planejamento](planning.md)).

        :material-account-group: Equipes de 2 a 3 membros, um repositório GitHub por equipe, documentação no GitHub Pages.

!!! danger "PROVA ORAL"

    **TODAS AS NOTAS** desta disciplina estão sujeitas a uma prova oral para validação. Se o resultado da prova oral for negativo, aquela nota específica será **ZERADA**.

!!! info "Uso de ferramentas de IA"

    Ferramentas de IA são permitidas e fazem parte da disciplina (as aulas 13 e 14 e o lab 13 tratam de construir com elas). Você é responsável por cada linha e cada número que entrega; as medições precisam vir de execuções que você fez. As regras estão na [página de exercícios](exercises/index.md#use-of-ai-tools).

## Repositórios { #repositories }

Repositório da disciplina (código dos labs e projetos iniciais): [repo-classes/pma271](https://github.com/repo-classes/pma271){:target="_blank"} *(a ser publicado)*.
