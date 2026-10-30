# Lista de leitura { #reading-list }

Os livros, artigos, blogs e cursos por trás deste curso. Você não precisa ler tudo: cada item tem uma linha sobre **por que** vale o seu tempo e a **aula** que ele apoia, para você escolher o que combina com o assunto que está estudando. Comece pelos cinco primeiros. A maior parte do material está em inglês, a língua de trabalho da área.

## Comece aqui: os cinco primeiros { #start-here-the-first-five }

1. **Designing Data-Intensive Applications** (Kleppmann e Riccomini) — os capítulos sobre replicação, particionamento, transações e consistência. A base das aulas 3, 6 e 8.
2. **System Design Interview, vol. 1** (Alex Xu) — leia um capítulo por semana junto com os [estudos de caso](../../classes/case-studies/index.md) para ver o formato da entrevista de ponta a ponta.
3. **"The Tail at Scale"** (Dean e Barroso, 2013) — seis páginas que explicam por que o p99 importa mais que a média. Leia com a [Aula 2 · Percentis](../../classes/estimation/percentiles/index.md).
4. **Site Reliability Engineering**, capítulos sobre SLOs, monitoramento e sobrecarga (gratuito online) — a metade "rodando em produção" do system design.
5. Os artigos da **Amazon Builders' Library** sobre timeouts, retries, backoff e jitter — curtos, práticos e exatamente o que a [Aula 10](../../classes/reliability/patterns/index.md) e o [Hands-on 9](../../hands-on/9/index.md) transformam em código.

## Livros { #books }

| Livro | Autores | Por que ler | Apoia |
|---|---|---|---|
| [Designing Data-Intensive Applications](https://dataintensive.net/), 2ª ed. | Martin Kleppmann, Chris Riccomini | A explicação mais clara de replicação, particionamento, transações, consistência e streams, a partir dos princípios | [3](../../classes/distributed/index.md), [6](../../classes/databases/index.md), [8](../../classes/messaging/index.md) |
| [System Design Interview](https://bytebytego.com/), vol. 1 e vol. 2 | Alex Xu (vol. 2 com Sahn Lam) | Problemas clássicos de entrevista resolvidos passo a passo, com estimativas e diagramas | [1](../../classes/intro/index.md), [15](../../classes/case-studies/index.md) |
| [Site Reliability Engineering](https://sre.google/books/) e The Site Reliability Workbook | Google (Beyer, Jones, Petoff, Murphy, orgs.) | SLOs, orçamentos de erros, alertas, sobrecarga e resposta a incidentes como praticados no Google; gratuitos online | [9](../../classes/reliability/index.md), [10](../../classes/observability/index.md) |
| Release It!, 2ª ed. | Michael T. Nygard | Padrões de estabilidade (timeouts, circuit breakers, bulkheads) e antipadrões, contados por meio de quedas reais | [9](../../classes/reliability/index.md) |
| Building Microservices, 2ª ed. | Sam Newman | Quando dividir um monolito, fronteiras de serviços, estilos de comunicação e os custos dos microsserviços | [5](../../classes/compute/index.md) |
| Fundamentals of Software Architecture | Mark Richards, Neal Ford | Características de arquitetura ("-idades"), estilos e como raciocinar sobre trade-offs | [1](../../classes/intro/index.md), [5](../../classes/compute/index.md) |
| Software Architecture: The Hard Parts | Neal Ford, Mark Richards, Pramod Sadalage, Zhamak Dehghani | Decompor serviços e dados, transações distribuídas e sagas, tudo como análise de trade-offs | [5](../../classes/compute/index.md), [8](../../classes/messaging/index.md) |
| [Understanding Distributed Systems](https://understandingdistributed.systems/) | Roberto Vitillo | Um passeio curto e acessível por comunicação, coordenação, escalabilidade e resiliência | [3](../../classes/distributed/index.md), [4](../../classes/edge/index.md) |
| Database Internals | Alex Petrov | Como os motores de armazenamento (B-trees, LSM-trees) e os bancos distribuídos funcionam por dentro | [6](../../classes/databases/index.md) |
| [Systems Performance](https://www.brendangregg.com/), 2ª ed. | Brendan Gregg | Metodologia de desempenho (método USE), ferramentas de observabilidade e profiling no Linux | [14](../../classes/performance/index.md) |
| Observability Engineering | Charity Majors, Liz Fong-Jones, George Miranda | Por que eventos de alta cardinalidade e traces valem mais que dashboards de médias; alertas baseados em SLO | [10](../../classes/observability/index.md) |
| Kubernetes: Up and Running | Brendan Burns, Joe Beda, Kelsey Hightower, Lachlan Evenson | Os objetos centrais do Kubernetes explicados por quem o construiu | [12](../../classes/cloud-native/index.md) |
| AI Engineering | Chip Huyen | Construir aplicações sobre modelos de fundação: avaliação, RAG, agentes, latência e custo | [13](../../classes/ai-systems/index.md) |
| [Cracking the Coding Interview](https://www.crackingthecodinginterview.com/), 6ª ed. | Gayle Laakmann McDowell | O processo de entrevistas em geral; seu capítulo sobre escalabilidade inspirou os princípios de "como responder" | [Apoio › Entrevista](../../support/interview/index.md) |

## Artigos clássicos { #classic-papers }

Artigos são mais curtos que livros e muitas vezes mais claros: foram escritos para convencer especialistas céticos. Leia primeiro o resumo, a introdução e as figuras.

| Artigo | Autores, veículo, ano | Por que ler | Apoia |
|---|---|---|---|
| Time, Clocks, and the Ordering of Events in a Distributed System | Leslie Lamport, Communications of the ACM, 1978 | Introduz a relação "aconteceu antes" e os relógios lógicos: por que "o que aconteceu primeiro" é difícil | [3 · Tempo e relógios](../../classes/distributed/time-clocks/index.md) |
| Paxos Made Simple | Leslie Lamport, ACM SIGACT News, 2001 | O algoritmo de consenso por trás de décadas de sistemas, em poucas páginas | [3 · Consenso](../../classes/distributed/consensus/index.md) |
| Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services | Seth Gilbert, Nancy Lynch, ACM SIGACT News, 2002 | A prova formal do teorema CAP que Eric Brewer conjecturou na sua palestra no PODC 2000 | [3 · CAP e PACELC](../../classes/distributed/cap-pacelc/index.md) |
| The Google File System | Ghemawat, Gobioff, Leung, SOSP 2003 | Projetar armazenamento para máquinas comuns que falham o tempo todo | [6](../../classes/databases/index.md) |
| MapReduce: Simplified Data Processing on Large Clusters | Jeffrey Dean, Sanjay Ghemawat, OSDI 2004 | O modelo de programação que tornou acessível o processamento em lote em grande escala | [6 · Especializados](../../classes/databases/specialized/index.md) |
| Bigtable: A Distributed Storage System for Structured Data | Chang et al., OSDI 2006 | O modelo de colunas largas por trás do HBase e do modelo de dados do Cassandra | [6 · Modelos](../../classes/databases/models/index.md) |
| The Chubby Lock Service for Loosely-Coupled Distributed Systems | Mike Burrows, OSDI 2006 | Locks de granularidade grossa e eleição de líder como serviço | [5 · Trabalho assíncrono](../../classes/compute/async-work/index.md) |
| Dynamo: Amazon's Highly Available Key-value Store | DeCandia et al., SOSP 2007 ([allthingsdistributed.com](https://www.allthingsdistributed.com/)) | Hashing consistente, quóruns, hinted handoff e relógios vetoriais num único sistema em produção | [3](../../classes/distributed/index.md), [6 · Particionamento](../../classes/databases/partitioning/index.md) |
| ZooKeeper: Wait-free Coordination for Internet-scale Systems | Hunt, Konar, Junqueira, Reed, USENIX ATC 2010 | Um serviço de coordenação do qual muitos sistemas (inclusive o Kafka antigo) dependiam | [3 · Consenso](../../classes/distributed/consensus/index.md) |
| Kafka: a Distributed Messaging System for Log Processing | Jay Kreps, Neha Narkhede, Jun Rao, NetDB 2011 | O design original do broker baseado em log usado ao longo do curso | [8 · Kafka](../../classes/messaging/kafka/index.md) |
| Spanner: Google's Globally-Distributed Database | Corbett et al., OSDI 2012 | Transações com consistência externa no planeta inteiro, usando o TrueTime | [6 · Replicação](../../classes/databases/replication/index.md), [3](../../classes/distributed/index.md) |
| Consistency Tradeoffs in Modern Distributed Database System Design | Daniel Abadi, IEEE Computer, 2012 | Introduz o PACELC: o trade-off entre latência e consistência que existe mesmo sem partições | [3 · CAP e PACELC](../../classes/distributed/cap-pacelc/index.md) |
| The Tail at Scale | Jeffrey Dean, Luiz André Barroso, Communications of the ACM, 2013 | Por que a latência de cauda domina sistemas com fan-out, e técnicas como hedged requests | [2 · Percentis](../../classes/estimation/percentiles/index.md) |
| Scaling Memcache at Facebook | Nishtala et al., NSDI 2013 | Cache em escala enorme: leases contra stampedes, pools regionais, invalidação | [7](../../classes/caching/index.md) |
| TAO: Facebook's Distributed Data Store for the Social Graph | Bronson et al., USENIX ATC 2013 | Um cache de grafo otimizado para leitura na frente do MySQL, atendendo bilhões de leituras por segundo | [7](../../classes/caching/index.md), [15](../../classes/case-studies/index.md) |
| In Search of an Understandable Consensus Algorithm (Raft) | Diego Ongaro, John Ousterhout, USENIX ATC 2014 ([raft.github.io](https://raft.github.io/)) | Consenso projetado para ser entendido: eleição de líder e replicação do log | [3 · Consenso](../../classes/distributed/consensus/index.md) |
| Large-scale Cluster Management at Google with Borg | Verma et al., EuroSys 2015 | O ancestral do Kubernetes: escalonamento, empacotamento e lições aprendidas | [12 · Kubernetes](../../classes/cloud-native/kubernetes/index.md) |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | Vaswani et al., NeurIPS 2017 | A arquitetura transformer por trás dos LLMs de hoje; leia pelo contexto, não pela matemática | [13](../../classes/ai-systems/index.md) |
| [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401) | Lewis et al., NeurIPS 2020 | O artigo que deu nome ao RAG: combinar um recuperador com um gerador | [13 · RAG e memória](../../classes/ai-systems/rag-memory/index.md) |
| [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) | Yao et al., ICLR 2023 | O loop raciocinar-agir-observar que a maioria dos frameworks de agentes implementa | [13 · Agentes](../../classes/ai-systems/agents/index.md) |

## Blogs de engenharia { #engineering-blogs }

Sistemas reais, quedas reais, trade-offs reais. Procure neles o assunto da semana.

| Blog | Por que ler | Apoia |
|---|---|---|
| [The Amazon Builders' Library](https://aws.amazon.com/builders-library/) | Como a Amazon constrói e opera serviços: timeouts e retries, descarte de carga, cache, deploys | [9](../../classes/reliability/index.md), [12](../../classes/cloud-native/index.md) |
| [AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/) | Arquiteturas de referência e padrões na AWS | [12](../../classes/cloud-native/index.md) |
| [Google Cloud Architecture Center](https://cloud.google.com/architecture) | Arquiteturas de referência, inclusive para sistemas de IA e de dados | [12](../../classes/cloud-native/index.md), [13](../../classes/ai-systems/index.md) |
| [Netflix Tech Blog](https://netflixtechblog.com/) | Engenharia do caos, resiliência, entrega de vídeo e microsserviços em grande escala | [9](../../classes/reliability/index.md), [15](../../classes/case-studies/index.md) |
| [Meta Engineering](https://engineering.fb.com/) | Cache, infraestrutura de dados e confiabilidade na escala de bilhões de usuários | [6](../../classes/databases/index.md), [7](../../classes/caching/index.md) |
| [Uber Engineering](https://www.uber.com/blog/engineering/) | Indexação geoespacial, despacho em tempo real e grandes arquiteturas de microsserviços | [15](../../classes/case-studies/index.md) |
| [Discord Engineering](https://discord.com/blog) | Guardar trilhões de mensagens, fan-out em tempo real, migrações de banco contadas em detalhe | [6](../../classes/databases/index.md), [15](../../classes/case-studies/index.md) |
| [The Cloudflare Blog](https://blog.cloudflare.com/) | DNS, CDN, mitigação de DDoS e post-mortems honestos de quedas globais | [4](../../classes/edge/index.md), [10](../../classes/observability/index.md) |
| [Stripe Engineering](https://stripe.com/blog/engineering) | Idempotência, design de APIs e confiabilidade em pagamentos | [5 · Integrações](../../classes/compute/integrations/index.md) |
| [Shopify Engineering](https://shopify.engineering/) | Sobreviver a vendas relâmpago (Black Friday) com um monolito modular | [5](../../classes/compute/index.md), [14](../../classes/performance/index.md) |
| [Slack Engineering](https://slack.engineering/) | Infraestrutura de mensagens em tempo real e relatos de incidentes | [8](../../classes/messaging/index.md), [10](../../classes/observability/index.md) |
| [Blog de Marc Brooker](https://brooker.co.za/blog/) | Ensaios curtos e rigorosos sobre retries, filas, latência de cauda e sistemas distribuídos | [2](../../classes/estimation/index.md), [9](../../classes/reliability/index.md) |
| [Martin Fowler](https://martinfowler.com/) | Padrões de sistemas distribuídos e de arquitetura corporativa, trade-offs de microsserviços | [5](../../classes/compute/index.md), [8](../../classes/messaging/index.md) |
| [Brendan Gregg](https://www.brendangregg.com/) | Metodologia de desempenho, flame graphs e observabilidade no Linux | [14](../../classes/performance/index.md) |
| [Jepsen](https://jepsen.io/) | Análises independentes do que os bancos distribuídos realmente garantem sob falhas | [3 · Consistência](../../classes/distributed/consistency/index.md) |
| [High Scalability](https://highscalability.com/) | Coleção antiga de estudos de caso de arquitetura | [15](../../classes/case-studies/index.md) |
| [ByteByteGo](https://blog.bytebytego.com/) | Explicações visuais, voltadas a entrevistas, de temas de system design | [Apoio › Entrevista](../../support/interview/index.md) |

## Cursos e recursos gratuitos { #courses-and-free-resources }

| Recurso | Por que usar | Apoia |
|---|---|---|
| [MIT 6.5840 Distributed Systems](https://pdos.csail.mit.edu/6.824/) | Aulas, leituras de artigos e laboratórios (Raft, um armazenamento chave-valor particionado) de um dos melhores cursos de sistemas distribuídos | [3](../../classes/distributed/index.md) |
| [The System Design Primer](https://github.com/donnemartin/system-design-primer) | Guia de estudo gratuito e organizado, com tópicos, flashcards e problemas resolvidos | [Apoio › Entrevista](../../support/interview/index.md) |
| [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/) | Seis pilares e perguntas de revisão concretas para fazer a qualquer design | [1](../../classes/intro/index.md), [12](../../classes/cloud-native/index.md) |
| [Azure Architecture Center](https://learn.microsoft.com/azure/architecture/) | Catálogo de padrões de design em nuvem (retry, circuit breaker, CQRS, saga…) com diagramas claros | [8](../../classes/messaging/index.md), [9](../../classes/reliability/index.md) |
| [Recursos de SRE do Google](https://sre.google/) | Os livros de SRE e artigos sobre SLOs e resposta a incidentes | [9](../../classes/reliability/index.md), [10](../../classes/observability/index.md) |
| [CNCF Landscape](https://landscape.cncf.io/) | Mapa do ecossistema cloud-native: onde cada ferramenta se encaixa | [12](../../classes/cloud-native/index.md) |
| [Documentação do OpenTelemetry](https://opentelemetry.io/docs/) | Conceitos e guias por linguagem para métricas, logs e traces | [10 · OpenTelemetry](../../classes/observability/opentelemetry/index.md) |
| [Documentação do Kubernetes](https://kubernetes.io/docs/) | A seção de conceitos é um excelente livro-texto gratuito | [12 · Kubernetes](../../classes/cloud-native/kubernetes/index.md) |
| [Latency numbers every programmer should know](https://gist.github.com/jboner/2841832) | A tabela clássica por trás de toda estimativa | [2 · Números](../../classes/estimation/numbers/index.md), [Referência › Números](../numbers/index.md) |

!!! tip "Como ler um artigo em 30 minutos"
    Leia o título, o resumo e a conclusão; olhe todas as figuras e tabelas; depois leia a introdução e a seção de design. Pule os detalhes da avaliação na primeira passada. Escreva três linhas: o problema, a ideia central e o trade-off que os autores aceitaram. É essa terceira linha que você vai usar numa entrevista.
