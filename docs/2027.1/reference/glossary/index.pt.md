# Glossário

O vocabulário de system design, de A a Z: sistemas distribuídos, dados, cache, mensageria, confiabilidade, observabilidade, redes, segurança, plataformas cloud-native e sistemas de IA. Cada entrada traz o termo em inglês (como ele aparece na documentação, nos artigos e nas entrevistas), o equivalente em português usado no Brasil, uma definição de uma ou duas frases e, quando existe, um link para a aula ou para a entrada do [catálogo de componentes](../components/index.md) em que a ideia é ensinada a fundo.

!!! tip "Como usar"
    Use a busca do navegador (Ctrl/Cmd + F) ou a busca do site para ir direto a um termo — procure pelo termo em inglês ou em português. Quando encontrar uma palavra desconhecida numa aula, num artigo ou numa pergunta de entrevista, procure-a aqui e depois siga o link. Tente definir os termos em voz alta, numa frase, antes de ler a definição: é exatamente isso que um entrevistador vai pedir. "(*mesmo termo*)" indica que no Brasil se usa o próprio termo em inglês. A [página de números](../numbers/index.md) traz os valores por trás das fórmulas citadas aqui.

**204 termos.**


## A

- **ACID** (*mesmo termo*) — Atomicidade, Consistência, Isolamento e Durabilidade: as garantias de uma transação de banco — tudo ou nada, invariantes preservados, transações concorrentes isoladas, dados confirmados sobrevivem a quedas. → [Bancos de dados › Transações](../../classes/databases/transactions/index.md)
- **Active-active / active-passive** (*ativo-ativo / ativo-passivo*) — Dois estilos de redundância: no ativo-ativo todos os locais atendem tráfego ao mesmo tempo; no ativo-passivo um reserva assume só quando o principal falha. → [Confiabilidade › Recuperação de desastres](../../classes/reliability/disaster-recovery/index.md)
- **Admission control** (*controle de admissão*) — Limitar quanto trabalho entra num sistema para que o que foi admitido termine bem; uma sala de espera virtual é controle de admissão para pessoas. → [Estudo de caso: ingressos](../../classes/case-studies/ticketing/index.md)
- **Agent (AI)** (*agente (de IA)*) — Um LLM rodando em laço que decide quais ferramentas chamar, observa os resultados e continua até terminar a tarefa. → [Sistemas de IA › Agentes](../../classes/ai-systems/agents/index.md)
- **Alerting** (*alertas*) — Regras sobre sinais que notificam um humano quando os usuários são afetados; bons alertas tratam de sintomas e são acionáveis. → [Catálogo › Alerting](../components/observability/index.md#alerting)
- **Amdahl's Law** (*Lei de Amdahl*) — A aceleração obtida com paralelismo é limitada pela fração serial do trabalho: aceleração = 1 / ((1 − p) + p/n). → [Estimativas](../../classes/estimation/index.md)
- **ANN (approximate nearest neighbor)** (*vizinhos mais próximos aproximados*) — Busca que encontra rapidamente vetores próximos de um vetor de consulta, aceitando perder alguns dos verdadeiros vizinhos mais próximos; HNSW é um índice comum. → [Catálogo › Vector DB](../components/storage/index.md#vectordb)
- **Anycast** (*mesmo termo*) — Anunciar o mesmo endereço IP a partir de vários locais para que a rede leve cada usuário ao mais próximo; usado por provedores de DNS e CDNs. → [Borda › DNS e CDN](../../classes/edge/dns-cdn/index.md)
- **API gateway** (*mesmo termo*) — O ponto de entrada único de uma API: roteamento, autenticação, rate limiting, ajuste de requisições e observabilidade. → [Catálogo › API Gateway](../components/edge/index.md#apigw)
- **At-least-once / at-most-once delivery** (*entrega pelo menos uma vez / no máximo uma vez*) — Garantias de mensageria: pelo menos uma vez nunca perde mensagens, mas pode entregar duplicatas; no máximo uma vez nunca duplica, mas pode perder. → [Mensageria › Semântica de entrega](../../classes/messaging/semantics/index.md)
- **Autoscaling** (*escalonamento automático (autoscaling)*) — Acrescentar ou remover capacidade automaticamente com base numa métrica (CPU, tamanho da fila, requisições por segundo) ou num horário. → [Computação › Serverless e autoscaling](../../classes/compute/serverless-autoscaling/index.md)
- **Availability** (*disponibilidade*) — A fração do tempo (ou das requisições) em que um sistema funciona corretamente, muitas vezes expressa em noves: 99,9% permite cerca de 8,8 horas fora do ar por ano. → [Estimativas › Matemática da disponibilidade](../../classes/estimation/availability-math/index.md)
- **Availability zone (AZ)** (*zona de disponibilidade*) — Um ou mais data centers isolados dentro de uma região da nuvem, com energia e rede independentes; espalhar réplicas por AZs sobrevive à falha de um data center. → [Catálogo › Subnet](../components/network/index.md#subnet)

## B

- **Backoff (exponential)** (*backoff exponencial*) — Esperar cada vez mais entre tentativas sucessivas (1 s, 2 s, 4 s…) para que uma dependência sobrecarregada possa se recuperar. → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **Back-of-the-envelope estimate** (*estimativa de guardanapo*) — Um cálculo rápido de carga, armazenamento, banda ou custo com números arredondados, para obter a ordem de grandeza que guia o design. → [Estimativas › Números](../../classes/estimation/numbers/index.md)
- **Backpressure** (*contrapressão (backpressure)*) — Um sinal de um consumidor lento que faz os produtores desacelerarem ou recusarem trabalho, em vez de deixar as filas crescerem sem limite. → [Mensageria › Semântica de entrega](../../classes/messaging/semantics/index.md)
- **Bandwidth** (*largura de banda*) — A taxa máxima de dados de um link (por exemplo, 1 Gbps = 125 MB/s); a vazão é o que você realmente obtém. → [Estimativas › Números](../../classes/estimation/numbers/index.md)
- **BFF (backend for frontend)** (*mesmo termo*) — Um gateway ou serviço fino feito sob medida para um tipo de cliente (web, mobile), que agrega e ajusta as chamadas ao backend para ele. → [Borda › API gateway](../../classes/edge/api-gateway/index.md)
- **Bloom filter** (*filtro de Bloom*) — Um conjunto probabilístico compacto que responde "com certeza não está" ou "provavelmente está"; usado para evitar leituras em disco e para deduplicar. → [Bancos de dados › Modelos de dados](../../classes/databases/models/index.md)
- **Blue/green deployment** (*implantação blue/green*) — Rodar a versão nova num segundo ambiente completo e mudar todo o tráfego para ele de uma vez, com rollback instantâneo voltando a chave. → [Cloud-native › Entrega](../../classes/cloud-native/delivery/index.md)
- **B-tree** (*árvore B*) — O índice em árvore balanceada usado pela maioria dos bancos relacionais: atualiza páginas no lugar e oferece leituras rápidas por chave e por faixa. → [Bancos de dados › Modelos de dados](../../classes/databases/models/index.md)
- **Bulkhead** (*anteparo (bulkhead)*) — Isolar recursos (pools de threads, conexões, instâncias) por dependência ou cliente para que uma falha não consuma tudo. → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **Burn rate** (*taxa de consumo (burn rate)*) — A velocidade com que o orçamento de erros de um SLO está sendo consumido em relação à taxa sustentável; um burn rate de 14,4 gasta 2% de um orçamento de 28 dias em uma hora. → [Observabilidade › Alertas](../../classes/observability/alerting/index.md)

## C

- **Cache** (*mesmo termo*) — Um armazenamento rápido (em geral em memória) que guarda cópias de dados caros de buscar ou calcular. → [Catálogo › Cache](../components/storage/index.md#cache)
- **Cache-aside** (*mesmo termo*) — A aplicação lê primeiro o cache e, numa falta, lê o banco e preenche o cache; nas escritas, atualiza o banco e apaga a chave. → [Cache › Padrões](../../classes/caching/patterns/index.md)
- **Cache stampede** (*mesmo termo*) — Muitas faltas simultâneas da mesma chave quente atingindo o backend de uma vez, tipicamente quando a chave expira; também chamado de thundering herd. → [Cache › Modos de falha](../../classes/caching/failure-modes/index.md)
- **Canary release** (*liberação canário (canary)*) — Mandar uma pequena fração do tráfego para uma versão nova e comparar suas métricas com as da antiga antes de avançar. → [Cloud-native › Entrega](../../classes/cloud-native/delivery/index.md)
- **Capacity planning** (*planejamento de capacidade*) — Estimar os recursos necessários para atender a carga esperada com folga, e quando acrescentar mais, a partir de medições e previsões de crescimento. → [Desempenho › Planejamento de capacidade](../../classes/performance/capacity-planning/index.md)
- **CAP theorem** (*teorema CAP*) — Durante uma partição de rede, um sistema replicado precisa escolher entre consistência (recusar ou atrasar) e disponibilidade (responder, talvez com dado antigo). → [Sistemas distribuídos › CAP e PACELC](../../classes/distributed/cap-pacelc/index.md)
- **Cardinality (metrics)** (*cardinalidade (de métricas)*) — O número de séries temporais distintas produzidas pelas combinações de labels de uma métrica; labels de alta cardinalidade, como ids de usuário, explodem o custo. → [Catálogo › Metrics](../components/observability/index.md#metrics)
- **CDC (change data capture)** (*captura de dados de mudança*) — Transmitir as mudanças confirmadas num banco (a partir do seu log) para outros sistemas, como Kafka, um cache ou um data warehouse. → [Mensageria › Padrões](../../classes/messaging/patterns/index.md)
- **CDN (content delivery network)** (*rede de distribuição de conteúdo*) — Uma rede global de caches de borda que serve conteúdo a partir de locais próximos dos usuários. → [Catálogo › CDN](../components/edge/index.md#cdn)
- **Chaos engineering** (*engenharia do caos*) — Conduzir experimentos controlados que injetam falhas (latência, quedas, perda de zonas) para achar fraquezas antes que incidentes reais as revelem. → [Confiabilidade › Engenharia do caos](../../classes/reliability/chaos/index.md)
- **Circuit breaker** (*disjuntor (circuit breaker)*) — Um envoltório nas chamadas a uma dependência que para de chamá-la (falha rápido) após erros demais e volta a testá-la depois de uma pausa. → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **Cold start** (*partida a frio (cold start)*) — A latência extra da primeira requisição a uma instância nova (função, contêiner, JVM) enquanto ela inicializa. → [Catálogo › Serverless](../components/compute/index.md#serverless)
- **Consensus** (*consenso*) — Fazer um grupo de nós concordar sobre um valor ou um log ordenado apesar de falhas, desde que a maioria esteja de pé (Raft, Paxos). → [Sistemas distribuídos › Consenso](../../classes/distributed/consensus/index.md)
- **Consistent hashing** (*hashing consistente*) — Posicionar nós e chaves num anel de hash para que acrescentar ou remover um nó mova só cerca de 1/N das chaves. → [Borda › Balanceamento de carga](../../classes/edge/load-balancing/index.md)
- **Consumer group** (*grupo de consumidores (consumer group)*) — Um conjunto de consumidores que compartilham um tópico do Kafka: cada partição é lida por exatamente um membro, então o paralelismo é no máximo o número de partições. → [Catálogo › Kafka](../components/messaging/index.md#kafka)
- **Container** (*contêiner*) — Um processo empacotado com suas dependências numa imagem e isolado pelo sistema operacional (namespaces, cgroups). → [Cloud-native › Contêineres](../../classes/cloud-native/containers/index.md)
- **Coordinated omission** (*omissão coordenada*) — Um erro de teste de carga em que um sistema lento faz o cliente enviar menos requisições, escondendo a latência que usuários reais veriam. → [Desempenho › Testes de carga](../../classes/performance/load-testing/index.md)
- **CQRS** (*mesmo termo*) — Command Query Responsibility Segregation: modelos (e muitas vezes armazenamentos) separados para escritas e para leituras, sincronizados por eventos. → [Mensageria › Padrões](../../classes/messaging/patterns/index.md)
- **Cron** (*mesmo termo*) — Uma expressão de agendamento (e a ferramenta clássica do Unix) para rodar jobs em horários ou intervalos fixos. → [Catálogo › Scheduler](../components/compute/index.md#scheduler)

## D

- **Data warehouse** (*mesmo termo*) — Um banco colunar para análises sobre grande volume histórico (OLAP), alimentado a partir dos sistemas operacionais por ETL/ELT ou CDC. → [Catálogo › Data Warehouse](../components/storage/index.md#dwh)
- **Dead-letter queue (DLQ)** (*fila de mensagens mortas*) — Uma fila onde mensagens que continuam falhando são estacionadas após N tentativas, para não travarem as demais. → [Catálogo › Message Queue](../components/messaging/index.md#queue)
- **Denormalization** (*desnormalização*) — Guardar cópias redundantes de dados para baratear as leituras, ao custo de escritas mais complexas e possível inconsistência. → [Bancos de dados › Modelos de dados](../../classes/databases/models/index.md)
- **Disaster recovery (DR)** (*recuperação de desastres*) — O plano e os mecanismos para restaurar o serviço após uma grande falha (perda de região, corrupção de dados), medidos por RPO e RTO. → [Confiabilidade › Recuperação de desastres](../../classes/reliability/disaster-recovery/index.md)
- **Distributed lock** (*trava distribuída (lock distribuído)*) — Um lock compartilhado por vários processos ou máquinas, em geral com prazo (lease) e um token de fencing para continuar seguro quando quem o detém pausa. → [Computação › Trabalho assíncrono](../../classes/compute/async-work/index.md)
- **DNS (Domain Name System)** (*mesmo termo*) — O diretório da internet que traduz nomes em endereços IP, com respostas em cache controladas por TTLs. → [Catálogo › DNS](../components/edge/index.md#dns)
- **Durability** (*durabilidade*) — A garantia de que dados confirmados não se perdem, em geral gravando em disco e replicando para outras máquinas ou zonas. → [Introdução › Requisitos](../../classes/intro/requirements/index.md)

## E

- **Edge computing** (*computação na borda*) — Rodar código nos pontos da CDN, perto dos usuários, para redirecionamentos, verificação de autenticação, personalização ou testes A/B. → [Borda › DNS e CDN](../../classes/edge/dns-cdn/index.md)
- **Embedding** (*mesmo termo*) — Um vetor de números que representa o significado de um texto, imagem ou item, de modo que coisas parecidas tenham vetores próximos. → [Catálogo › Vector DB](../components/storage/index.md#vectordb)
- **Error budget** (*orçamento de erros*) — A quantidade de falta de confiabilidade que um SLO permite (100% − SLO), gasta com lançamentos e experimentos; quando acaba, o trabalho de confiabilidade vem primeiro. → [Confiabilidade › SLOs](../../classes/reliability/slo/index.md)
- **ETL / ELT** (*mesmo termo*) — Extrair-Transformar-Carregar (transformar antes de carregar) ou Extrair-Carregar-Transformar (carregar os dados brutos e transformar dentro do warehouse). → [Bancos de dados › Armazenamentos especializados](../../classes/databases/specialized/index.md)
- **Event-driven architecture** (*arquitetura orientada a eventos*) — Serviços se comunicam publicando e reagindo a eventos em vez de chamar uns aos outros diretamente, o que os desacopla no tempo. → [Mensageria](../../classes/messaging/index.md)
- **Event sourcing** (*mesmo termo*) — Guardar a sequência de eventos que mudaram uma entidade como fonte da verdade e derivar o estado atual reproduzindo-os. → [Mensageria › Padrões](../../classes/messaging/patterns/index.md)
- **Eventual consistency** (*consistência eventual*) — Se as escritas pararem, todas as réplicas acabam convergindo para o mesmo valor; até lá, leituras podem devolver dados antigos. → [Sistemas distribuídos › Consistência](../../classes/distributed/consistency/index.md)
- **Exactly-once** (*exatamente uma vez*) — Cada mensagem afeta o resultado exatamente uma vez; na prática, obtido com entrega pelo menos uma vez mais processamento idempotente ou transações. → [Mensageria › Semântica de entrega](../../classes/messaging/semantics/index.md)

## F

- **Failover** (*mesmo termo*) — Passar o tráfego ou o papel de líder para um reserva quando o principal falha, de forma automática ou manual. → [Confiabilidade › Recuperação de desastres](../../classes/reliability/disaster-recovery/index.md)
- **Fallback** (*alternativa (fallback)*) — Uma resposta alternativa quando uma dependência falha: dados em cache, um padrão, uma funcionalidade degradada ou um "tente mais tarde". → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **Fan-out (on write / on read)** (*fan-out (na escrita / na leitura)*) — Entregar um item a muitos destinatários: pré-calcular o feed de cada seguidor ao postar (na escrita) ou montá-lo ao ler (na leitura). → [Estudo de caso: feed de notícias](../../classes/case-studies/news-feed/index.md)
- **Feature flag** (*mesmo termo*) — Uma chave em tempo de execução que liga ou desliga trechos de código para alguns usuários sem deploy; desacopla o lançamento da implantação. → [Cloud-native › Entrega](../../classes/cloud-native/delivery/index.md)
- **FinOps** (*mesmo termo*) — A prática de tornar o custo de nuvem visível e de responsabilidade dos times de engenharia, otimizando-o junto com desempenho e confiabilidade. → [Cloud-native › FinOps](../../classes/cloud-native/finops/index.md)
- **Flame graph** (*mesmo termo*) — Uma visualização de stack traces amostrados em que a largura mostra o tempo gasto; o jeito mais rápido de ver para onde vai a CPU. → [Desempenho › Gargalos](../../classes/performance/bottlenecks/index.md)
- **Functional requirement** (*requisito funcional*) — O que o sistema precisa fazer (comprar um ingresso, buscar eventos), em oposição a quão bem precisa fazê-lo. → [Introdução › Requisitos](../../classes/intro/requirements/index.md)

## G

- **Geohash** (*mesmo termo*) — Uma codificação de latitude e longitude numa string em que prefixos em comum indicam áreas próximas; usada para indexar localizações. → [Estudo de caso: transporte por aplicativo](../../classes/case-studies/ride-sharing/index.md)
- **GitOps** (*mesmo termo*) — Declarar o estado desejado da infraestrutura e das aplicações no Git e deixar um agente (por exemplo, o Argo CD) reconciliar o cluster com ele. → [Cloud-native › Entrega](../../classes/cloud-native/delivery/index.md)
- **Golden signals** (*sinais de ouro*) — Os quatro sinais de um serviço segundo o SRE do Google: latência, tráfego, erros e saturação. → [Observabilidade › Sinais](../../classes/observability/signals/index.md)
- **Gossip protocol** (*protocolo de fofoca (gossip)*) — Os nós trocam estado periodicamente com pares aleatórios, para que informações (membros, falhas) se espalhem pelo cluster sem coordenador. → [Sistemas distribuídos](../../classes/distributed/index.md)
- **GraphQL** (*mesmo termo*) — Uma linguagem de consulta de APIs em que o cliente pede exatamente os campos de que precisa, de um esquema tipado, numa só requisição. → [Computação › Estilos de API](../../classes/compute/api-styles/index.md)
- **gRPC** (*mesmo termo*) — Um framework de RPC de alto desempenho sobre HTTP/2, com esquemas em Protocol Buffers e streaming; comum entre serviços. → [Computação › Estilos de API](../../classes/compute/api-styles/index.md)
- **Guardrails (LLM)** (*mesmo termo*) — Verificações em volta de um modelo nas entradas, nas saídas e nas chamadas de ferramentas: prompt injection, dados pessoais, políticas, validação de esquema. → [Catálogo › Safety Mesh](../components/ai/index.md#safety)

## H

- **Head-of-line blocking** (*bloqueio na cabeça da fila*) — Quando um item lento na frente de uma fila ou conexão atrasa tudo o que vem atrás; o HTTP/2 resolveu isso por requisição, o HTTP/3 por pacote. → [Borda › Protocolos](../../classes/edge/protocols/index.md)
- **Health check** (*verificação de saúde (health check)*) — Uma sonda (liveness, readiness, startup) que diz a load balancers e orquestradores se uma instância pode atender ou deve ser reiniciada. → [Catálogo › Health Check](../components/observability/index.md#healthcheck)
- **Hit ratio** (*taxa de acerto*) — A fração das consultas ao cache atendidas pelo próprio cache; o backend recebe requisições × (1 − taxa de acerto). → [Cache › Padrões](../../classes/caching/patterns/index.md)
- **HNSW** (*mesmo termo*) — Hierarchical Navigable Small World: um índice baseado em grafos para busca aproximada de vizinhos mais próximos em vetores. → [Catálogo › Vector DB](../components/storage/index.md#vectordb)
- **Horizontal scaling** (*escala horizontal*) — Acrescentar mais máquinas atrás de um load balancer (scale out), o que exige serviços sem estado e o estado compartilhado em outro lugar. → [Introdução › Jornada de escala](../../classes/intro/scaling-journey/index.md)
- **Hot key / hot partition** (*chave quente / partição quente*) — Uma chave ou partição que recebe uma fatia desproporcional do tráfego (uma celebridade, um evento em venda relâmpago), saturando um nó enquanto os outros ficam ociosos. → [Bancos de dados › Particionamento](../../classes/databases/partitioning/index.md)
- **HPA (Horizontal Pod Autoscaler)** (*mesmo termo*) — O controlador do Kubernetes que muda o número de réplicas de um Deployment para manter uma métrica (por exemplo, CPU em 60%) perto da meta. → [Cloud-native › Kubernetes](../../classes/cloud-native/kubernetes/index.md)
- **HTTP/2 and HTTP/3 (QUIC)** (*mesmo termo*) — O HTTP/2 multiplexa muitas requisições numa conexão TCP; o HTTP/3 roda sobre QUIC (UDP) para evitar o bloqueio na cabeça da fila do TCP e acelerar os handshakes. → [Borda › Protocolos](../../classes/edge/protocols/index.md)

## I

- **IaC (infrastructure as code)** (*infraestrutura como código*) — Definir a infraestrutura em arquivos versionados (Terraform, OpenTofu) aplicados por ferramentas, em vez de cliques manuais. → [Cloud-native › Entrega](../../classes/cloud-native/delivery/index.md)
- **Idempotency** (*idempotência*) — Executar uma operação duas vezes tem o mesmo efeito que uma; torna os retries seguros. → [Sistemas distribuídos](../../classes/distributed/index.md)
- **Idempotency key** (*chave de idempotência*) — Um id único enviado pelo cliente com a requisição; o servidor guarda o primeiro resultado e o devolve nas repetições em vez de agir de novo. → [Computação › Integrações](../../classes/compute/integrations/index.md)
- **Index** (*índice*) — Uma estrutura de dados auxiliar que acelera leituras em algumas colunas ao custo de escritas mais lentas e mais armazenamento. → [Bancos de dados › Modelos de dados](../../classes/databases/models/index.md)
- **Ingress** (*mesmo termo*) — O recurso (e o controlador) do Kubernetes que roteia o tráfego HTTP externo para os serviços; a Gateway API é sua sucessora. → [Catálogo › Ingress](../components/edge/index.md#ingress)
- **Inverted index** (*índice invertido*) — Um mapa de cada termo para os documentos que o contêm; o núcleo dos mecanismos de busca textual. → [Catálogo › Search](../components/compute/index.md#search)
- **Isolation level** (*nível de isolamento*) — Quanto transações concorrentes podem ver umas das outras: read committed, repeatable read / snapshot, serializable. → [Bancos de dados › Transações](../../classes/databases/transactions/index.md)

## J

- **Jitter** (*mesmo termo*) — Aleatoriedade acrescentada aos atrasos de retry ou a temporizadores para que muitos clientes não ajam em sincronia e sobrecarreguem um serviço juntos. → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **JWT (JSON Web Token)** (*mesmo termo*) — Um token assinado com claims (usuário, escopos, expiração) que os serviços podem verificar localmente, sem chamar o emissor. → [Rede e segurança › Identidade](../../classes/network-security/identity/index.md)

## K

- **Kafka** (*mesmo termo*) — Um log de eventos distribuído, particionado e replicado, em que os consumidores leem no seu próprio offset e podem reprocessar o histórico. → [Catálogo › Kafka](../components/messaging/index.md#kafka)
- **Key-value store** (*armazenamento chave-valor*) — Um banco que associa chaves a valores opacos, com get/put muito rápidos por chave e pouco mais que isso (Redis, DynamoDB). → [Catálogo › NoSQL DB](../components/storage/index.md#nosql)
- **Knee (of the latency curve)** (*joelho (da curva de latência)*) — A utilização (muitas vezes por volta de 70–80%) a partir da qual as filas fazem a latência crescer bruscamente. → [Estimativas › Filas](../../classes/estimation/queueing/index.md)
- **Kubernetes** (*mesmo termo*) — Um orquestrador de contêineres que agenda pods em nós, mantém o número desejado rodando e oferece services, sondas e autoscaling. → [Cloud-native › Kubernetes](../../classes/cloud-native/kubernetes/index.md)

## L

- **L4 / L7 load balancing** (*balanceamento L4 / L7*) — O L4 balanceia conexões TCP/UDP por endereço e porta; o L7 entende HTTP e roteia por caminho, cabeçalho ou cookie. → [Catálogo › Load Balancer](../components/edge/index.md#lb)
- **Latency** (*latência*) — O tempo para atender uma requisição, mais bem descrito por percentis (p50, p99) do que pela média. → [Estimativas › Números](../../classes/estimation/numbers/index.md)
- **Leader election** (*eleição de líder*) — Escolher um nó entre vários para coordenar (aceitar escritas, rodar um job), com nova eleição quando ele falha. → [Sistemas distribuídos › Consenso](../../classes/distributed/consensus/index.md)
- **Leader-follower replication** (*replicação líder-seguidor*) — Um líder aceita as escritas e as transmite a seguidores, que atendem leituras e podem assumir em caso de falha. → [Bancos de dados › Replicação](../../classes/databases/replication/index.md)
- **Leaky bucket** (*balde furado (leaky bucket)*) — Um algoritmo de rate limiting que enfileira requisições e as libera a uma taxa constante, suavizando rajadas. → [Borda › API gateway](../../classes/edge/api-gateway/index.md)
- **Linearizability** (*linearizabilidade*) — A consistência mais forte para um único objeto: cada operação parece ter efeito atomicamente num instante, como se houvesse uma só cópia. → [Sistemas distribuídos › Consistência](../../classes/distributed/consistency/index.md)
- **Little's Law** (*Lei de Little*) — L = λ × W: o número médio de itens num sistema é igual à taxa de chegada vezes o tempo médio que cada um passa nele. → [Estimativas › Filas](../../classes/estimation/queueing/index.md)
- **LLM gateway** (*mesmo termo*) — Um proxy na frente dos provedores de modelos para roteamento, fallbacks, cotas, cache e métricas de tokens e custo. → [Catálogo › LLM Gateway](../components/ai/index.md#llmgw)
- **Load balancer** (*balanceador de carga*) — Um componente que distribui as requisições entre réplicas saudáveis usando um algoritmo como round robin ou menos conexões. → [Catálogo › Load Balancer](../components/edge/index.md#lb)
- **Load shedding** (*descarte de carga*) — Recusar deliberadamente algumas requisições (com 429/503) quando sobrecarregado, para que as demais sejam atendidas dentro do prazo. → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **Load test** (*teste de carga*) — Gerar tráfego realista contra um sistema para medir vazão e latência; os tipos incluem smoke, load, stress, spike, soak e breakpoint. → [Desempenho › Testes de carga](../../classes/performance/load-testing/index.md)
- **Logical clock** (*relógio lógico*) — Um relógio baseado em contadores (Lamport, vetorial) que ordena eventos por causalidade em vez do tempo de parede. → [Sistemas distribuídos › Tempo e relógios](../../classes/distributed/time-clocks/index.md)
- **Logs** (*mesmo termo*) — Registros com data e hora de eventos discretos, de preferência estruturados (JSON) e correlacionados pelo trace id. → [Catálogo › Logs](../components/observability/index.md#logs)
- **LRU / LFU** (*mesmo termo*) — Políticas de expulsão de cache: expulsar o item usado menos recentemente, ou o usado com menos frequência. → [Cache › Redis](../../classes/caching/redis/index.md)
- **LSM-tree** (*árvore LSM*) — Log-Structured Merge tree: as escritas vão para a memória e são descarregadas em arquivos ordenados, depois compactados; escritas muito rápidas. → [Bancos de dados › Modelos de dados](../../classes/databases/models/index.md)

## M

- **MCP (Model Context Protocol)** (*mesmo termo*) — Um protocolo aberto pelo qual aplicações expõem ferramentas, recursos e prompts a clientes de LLM de forma padronizada. → [Catálogo › Tool Registry](../components/ai/index.md#toolreg)
- **Message queue** (*fila de mensagens*) — Um buffer onde produtores colocam mensagens e consumidores concorrentes as retiram, cada mensagem processada por um consumidor. → [Catálogo › Message Queue](../components/messaging/index.md#queue)
- **Metrics** (*métricas*) — Séries temporais numéricas agregadas ao longo do tempo (contadores, gauges, histogramas); baratas de guardar, base de dashboards e alertas. → [Catálogo › Metrics](../components/observability/index.md#metrics)
- **Microservices** (*microsserviços*) — Uma arquitetura de serviços pequenos, de responsabilidade de times e implantados de forma independente, que se comunicam pela rede. → [Computação › Serviços](../../classes/compute/services/index.md)
- **Modular monolith** (*monolito modular*) — Uma aplicação implantável única, dividida internamente em módulos bem separados e com fronteiras claras; muitas vezes o melhor ponto de partida. → [Computação › Serviços](../../classes/compute/services/index.md)
- **mTLS (mutual TLS)** (*TLS mútuo*) — TLS em que cliente e servidor apresentam certificados, de modo que cada lado autentica o outro; padrão dentro de service meshes. → [Catálogo › Service Mesh](../components/network/index.md#mesh)
- **MTTR / MTBF** (*tempo médio de reparo / entre falhas*) — Tempo médio de reparo (recuperação) e tempo médio entre falhas; disponibilidade ≈ MTBF / (MTBF + MTTR). → [Confiabilidade](../../classes/reliability/index.md)
- **Multi-leader replication** (*replicação multilíder*) — Vários nós aceitam escritas e replicam entre si, o que exige resolver escritas conflitantes. → [Bancos de dados › Replicação](../../classes/databases/replication/index.md)
- **Multi-region** (*multirregião*) — Rodar um sistema em mais de uma região geográfica, para menor latência a usuários distantes e para sobreviver à queda de uma região. → [Confiabilidade › Recuperação de desastres](../../classes/reliability/disaster-recovery/index.md)

## N

- **N+1 query** (*consulta N+1*) — Código que faz uma consulta para uma lista e depois mais uma por item, transformando uma página em centenas de idas e voltas ao banco. → [Desempenho › Gargalos](../../classes/performance/bottlenecks/index.md)
- **NAT gateway** (*mesmo termo*) — Permite que máquinas em sub-redes privadas abram conexões de saída para a internet sem ficarem acessíveis a partir dela. → [Catálogo › NAT Gateway](../components/network/index.md#nat)
- **Network partition** (*partição de rede*) — Uma falha em que partes de um sistema não conseguem se comunicar entre si, embora cada parte continue rodando. → [Sistemas distribuídos › CAP e PACELC](../../classes/distributed/cap-pacelc/index.md)
- **NewSQL** (*mesmo termo*) — Bancos distribuídos que mantêm SQL e transações enquanto escalam horizontalmente (Spanner, CockroachDB, YugabyteDB). → [Bancos de dados › Modelos de dados](../../classes/databases/models/index.md)
- **Non-functional requirement** (*requisito não funcional*) — Quão bem o sistema precisa funcionar: latência, disponibilidade, consistência, durabilidade, escala, custo, segurança, operabilidade. → [Introdução › Requisitos](../../classes/intro/requirements/index.md)
- **NoSQL** (*mesmo termo*) — Bancos não relacionais (chave-valor, documentos, colunas largas, grafos) que trocam alguns recursos relacionais por escala ou flexibilidade. → [Catálogo › NoSQL DB](../components/storage/index.md#nosql)

## O

- **OAuth 2 / OIDC** (*mesmo termo*) — O OAuth 2 delega autorização com tokens de acesso; o OpenID Connect acrescenta autenticação (quem é o usuário) por cima dele. → [Rede e segurança › Identidade](../../classes/network-security/identity/index.md)
- **Object storage** (*armazenamento de objetos*) — Armazenamento de blobs imutáveis por chave via HTTP (S3 e similares), barato e extremamente durável; a origem para mídia. → [Catálogo › Object Store](../components/storage/index.md#objstore)
- **Observability** (*observabilidade*) — A capacidade de entender o estado interno de um sistema a partir dos sinais que ele emite: métricas, logs, traces e perfis. → [Observabilidade](../../classes/observability/index.md)
- **OLTP / OLAP** (*mesmo termo*) — Processamento de transações online (muitas leituras e escritas pequenas sobre dados atuais) vs processamento analítico online (grandes varreduras e agregações sobre o histórico). → [Bancos de dados › Armazenamentos especializados](../../classes/databases/specialized/index.md)
- **OpenTelemetry** (*mesmo termo*) — O padrão neutro em relação a fornecedores (APIs, SDKs, Collector, protocolo OTLP) para produzir e exportar métricas, logs e traces. → [Observabilidade › OpenTelemetry](../../classes/observability/opentelemetry/index.md)
- **Open vs closed workload model** (*modelo de carga aberto vs fechado*) — Aberto: as requisições chegam a uma taxa independente das respostas (usuários reais); fechado: um número fixo de usuários espera cada resposta antes da próxima. → [Desempenho › Testes de carga](../../classes/performance/load-testing/index.md)
- **Optimistic locking** (*lock otimista*) — Detectar atualizações conflitantes na hora da escrita com uma coluna de versão (UPDATE … WHERE version = ?), em vez de travar antecipadamente. → [Bancos de dados › Transações](../../classes/databases/transactions/index.md)
- **Orchestrator (agent)** (*orquestrador (de agentes)*) — O componente que roda o laço de um agente de IA: chama o modelo, executa as ferramentas que ele escolhe e repete até terminar. → [Catálogo › Orchestrator](../components/ai/index.md#orchestrator)
- **Outbox (transactional)** (*outbox transacional*) — Gravar um evento numa tabela outbox na mesma transação da mudança de negócio e depois repassá-lo ao broker; evita escritas duplas. → [Mensageria › Padrões](../../classes/messaging/patterns/index.md)

## P

- **p50 / p99 (percentiles)** (*percentis*) — A latência abaixo da qual 50% ou 99% das requisições terminam; o p99 descreve a cauda que os usuários sentem. → [Estimativas › Percentis](../../classes/estimation/percentiles/index.md)
- **PACELC** (*mesmo termo*) — Estende o CAP: se houver Partição, escolha Disponibilidade ou Consistência; Senão, escolha Latência ou Consistência. → [Sistemas distribuídos › CAP e PACELC](../../classes/distributed/cap-pacelc/index.md)
- **Partitioning (sharding)** (*particionamento (sharding)*) — Dividir os dados entre nós por uma chave (hash ou faixa) para que cada nó guarde e atenda só uma parte. → [Bancos de dados › Particionamento](../../classes/databases/partitioning/index.md)
- **Partition (Kafka)** (*partição (Kafka)*) — Um fragmento ordenado e append-only de um tópico; a ordem só vale dentro da partição, e ela é a unidade de paralelismo dos consumidores. → [Catálogo › Kafka](../components/messaging/index.md#kafka)
- **Pessimistic locking** (*lock pessimista*) — Travar as linhas antes de alterá-las (SELECT … FOR UPDATE) para que transações concorrentes esperem; seguro sob disputa, mas segura locks. → [Bancos de dados › Transações](../../classes/databases/transactions/index.md)
- **Pod** (*mesmo termo*) — A menor unidade implantável no Kubernetes: um ou mais contêineres compartilhando endereço de rede e volumes. → [Cloud-native › Kubernetes](../../classes/cloud-native/kubernetes/index.md)
- **Prompt injection** (*injeção de prompt*) — Texto não confiável (uma página web, um e-mail, uma avaliação) carregando instruções que um LLM segue contra o comportamento pretendido. → [Catálogo › Safety Mesh](../components/ai/index.md#safety)
- **Pub/Sub** (*publicação/assinatura*) — Publicação/assinatura: cada mensagem publicada num tópico é entregue a todos os assinantes. → [Catálogo › Pub/Sub](../components/messaging/index.md#pubsub)

## Q

- **QPS (queries per second)** (*consultas por segundo*) — Requisições ou consultas por segundo, a unidade básica de carga; QPS médio ≈ requisições por dia ÷ 10^5. → [Estimativas › Números](../../classes/estimation/numbers/index.md)
- **Queueing theory** (*teoria das filas*) — A matemática das filas de espera; explica por que a latência explode quando a utilização se aproxima de 100%. → [Estimativas › Filas](../../classes/estimation/queueing/index.md)
- **Quorum** (*quórum*) — O número mínimo de réplicas que precisam participar de uma leitura ou escrita; com R + W > N, as leituras cruzam a última escrita. → [Sistemas distribuídos › Consenso](../../classes/distributed/consensus/index.md)

## R

- **Raft** (*mesmo termo*) — Um algoritmo de consenso projetado para ser compreensível: um líder replica um log para os seguidores e confirma as entradas quando a maioria as tem. → [Sistemas distribuídos › Consenso](../../classes/distributed/consensus/index.md)
- **RAG (retrieval-augmented generation)** (*geração aumentada por recuperação*) — Recuperar trechos relevantes dos seus dados (em geral por busca vetorial) e colocá-los no prompt para que o modelo responda a partir deles. → [Catálogo › Memory Fabric](../components/ai/index.md#memory)
- **Rate limiting** (*limitação de taxa (rate limiting)*) — Limitar quantas requisições um cliente pode fazer por janela de tempo, respondendo 429 Too Many Requests além disso. → [Estudo de caso: rate limiter](../../classes/case-studies/rate-limiter/index.md)
- **Read replica** (*réplica de leitura*) — Uma cópia seguidora de um banco usada para atender leituras; acrescenta capacidade de leitura, mas pode ficar atrás do líder. → [Bancos de dados › Replicação](../../classes/databases/replication/index.md)
- **Read-your-writes** (*mesmo termo*) — Uma garantia de consistência de que um usuário sempre vê as próprias escritas mais recentes, mesmo que outros possam ver dados antigos. → [Sistemas distribuídos › Consistência](../../classes/distributed/consistency/index.md)
- **Redis** (*mesmo termo*) — Um servidor de estruturas de dados em memória (strings, hashes, listas, sorted sets, streams) usado como cache, rate limiter, fila e mais. → [Cache › Redis](../../classes/caching/redis/index.md)
- **RED method** (*método RED*) — Monitorar cada serviço por Taxa (Rate), Erros e Duração. → [Observabilidade › Sinais](../../classes/observability/signals/index.md)
- **Region** (*região*) — Uma área geográfica de um provedor de nuvem que contém várias zonas de disponibilidade (por exemplo, São Paulo, Virgínia). → [Confiabilidade › Recuperação de desastres](../../classes/reliability/disaster-recovery/index.md)
- **Replication lag** (*atraso de replicação*) — O atraso entre uma escrita no líder e seu aparecimento num seguidor; causa leituras desatualizadas. → [Bancos de dados › Replicação](../../classes/databases/replication/index.md)
- **Resharding** (*reparticionamento*) — Mover dados entre partições quando nós são acrescentados ou as chaves são redistribuídas, de preferência online e aos poucos. → [Bancos de dados › Particionamento](../../classes/databases/partitioning/index.md)
- **REST** (*mesmo termo*) — Um estilo de API baseado em recursos, verbos e códigos de status do HTTP; simples, cacheável e o padrão para APIs públicas. → [Computação › Estilos de API](../../classes/compute/api-styles/index.md)
- **Retry** (*nova tentativa (retry)*) — Repetir uma requisição que falhou na esperança de que a falha tenha sido transitória; seguro só para operações idempotentes, com backoff e um limite. → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **Retry storm** (*tempestade de retries*) — Retries de muitos clientes multiplicando a carga num serviço que já sofre e transformando um soluço numa queda. → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **Reverse proxy** (*proxy reverso*) — Um servidor na frente dos backends que recebe as requisições dos clientes e as encaminha, muitas vezes terminando TLS e fazendo cache (Nginx, Envoy). → [Catálogo › Load Balancer](../components/edge/index.md#lb)
- **RPO / RTO** (*mesmo termo*) — Recovery point objective (quanto dado se pode perder) e recovery time objective (quanto tempo até o serviço voltar). → [Confiabilidade › Recuperação de desastres](../../classes/reliability/disaster-recovery/index.md)

## S

- **Saga** (*mesmo termo*) — Uma transação distribuída dividida em passos locais, cada um com uma ação de compensação que o desfaz se um passo posterior falhar. → [Mensageria › Padrões](../../classes/messaging/patterns/index.md)
- **SBOM (software bill of materials)** (*lista de materiais de software*) — Um inventário de todos os componentes e versões dentro de um artefato de software, usado para acompanhar vulnerabilidades e licenças. → [Rede e segurança › Zero trust](../../classes/network-security/zero-trust/index.md)
- **Scheduler** (*agendador*) — Um componente que dispara jobs em horários ou intervalos dados, garantindo que cada execução aconteça uma vez mesmo com várias réplicas. → [Catálogo › Scheduler](../components/compute/index.md#scheduler)
- **Secrets management** (*gestão de segredos*) — Guardar credenciais e chaves num sistema dedicado e auditado (cofre) e injetá-las em tempo de execução, nunca no código ou nas imagens. → [Rede e segurança › Zero trust](../../classes/network-security/zero-trust/index.md)
- **Semantic cache** (*cache semântico*) — Um cache de respostas de LLM indexado pelo significado da pergunta (similaridade de embeddings) em vez do texto exato. → [Catálogo › LLM Gateway](../components/ai/index.md#llmgw)
- **Serverless (FaaS)** (*mesmo termo*) — Rodar funções sob demanda sem gerenciar servidores, cobradas por invocação e duração, escalando até zero. → [Catálogo › Serverless](../components/compute/index.md#serverless)
- **Service discovery** (*descoberta de serviços*) — Como um serviço encontra os endereços atuais de outro (DNS, um registro, Services do Kubernetes). → [Cloud-native › Kubernetes](../../classes/cloud-native/kubernetes/index.md)
- **Service mesh** (*mesmo termo*) — Uma camada de proxies ao lado de cada serviço que oferece mTLS, retries, timeouts, divisão de tráfego e telemetria sem mudar o código. → [Catálogo › Service Mesh](../components/network/index.md#mesh)
- **Single point of failure (SPOF)** (*ponto único de falha*) — Um componente cuja falha para o sistema inteiro; eliminado com redundância. → [Estimativas › Matemática da disponibilidade](../../classes/estimation/availability-math/index.md)
- **SLI / SLO / SLA** (*mesmo termo*) — Indicador (o que se mede), objetivo (a meta, por exemplo 99,9% em 28 dias) e acordo (um contrato com multas). → [Confiabilidade › SLOs](../../classes/reliability/slo/index.md)
- **Snapshot isolation** (*isolamento por snapshot*) — Cada transação lê de um retrato consistente do banco; evita a maioria das anomalias, mas permite write skew. → [Bancos de dados › Transações](../../classes/databases/transactions/index.md)
- **Soak / spike / stress test** (*testes de soak / spike / stress*) — Testes de carga que mantêm a carga por horas (soak), saltam de repente (spike) ou aumentam até o sistema quebrar (stress). → [Desempenho › Testes de carga](../../classes/performance/load-testing/index.md)
- **SSE (Server-Sent Events)** (*mesmo termo*) — Um fluxo unidirecional de eventos do servidor para o cliente sobre uma resposta HTTP de longa duração; usado para atualizações ao vivo e tokens de LLM. → [Borda › Protocolos](../../classes/edge/protocols/index.md)
- **Stateless service** (*serviço sem estado*) — Um serviço que não guarda estado do cliente entre requisições, de modo que qualquer réplica atende qualquer requisição. → [Catálogo › App Server](../components/compute/index.md#app)
- **Sticky session** (*sessão fixa (sticky session)*) — Encaminhar todas as requisições de um cliente para o mesmo backend; simplifica sessões em memória, mas prejudica o balanceamento e o failover. → [Catálogo › Load Balancer](../components/edge/index.md#lb)
- **Strong consistency** (*consistência forte*) — As leituras sempre refletem a última escrita confirmada (linearizabilidade ou serializabilidade), ao custo de latência ou disponibilidade. → [Sistemas distribuídos › Consistência](../../classes/distributed/consistency/index.md)
- **Subnet** (*sub-rede*) — Uma faixa de endereços dentro de uma VPC numa zona de disponibilidade; pública ou privada conforme sua tabela de rotas. → [Catálogo › Subnet](../components/network/index.md#subnet)

## T

- **Tail latency** (*latência de cauda*) — As requisições mais lentas (p99, p999); amplificada quando uma requisição se espalha por muitos serviços. → [Estimativas › Percentis](../../classes/estimation/percentiles/index.md)
- **Throughput** (*vazão*) — A quantidade de trabalho concluída por unidade de tempo (requisições por segundo, MB por segundo). → [Estimativas › Números](../../classes/estimation/numbers/index.md)
- **Thundering herd** (*manada estrondosa (thundering herd)*) — Muitos clientes ou threads acordando e atingindo o mesmo recurso ao mesmo tempo (após uma expiração, um restart, a liberação de um lock). → [Cache › Modos de falha](../../classes/caching/failure-modes/index.md)
- **Timeout** (*tempo limite (timeout)*) — Um prazo numa chamada, depois do qual quem chama desiste; a primeira defesa contra dependências lentas. → [Confiabilidade › Padrões](../../classes/reliability/patterns/index.md)
- **Token bucket** (*balde de fichas (token bucket)*) — Um algoritmo de rate limiting: fichas recarregam a uma taxa constante até uma capacidade de rajada, e cada requisição gasta uma. → [Borda › API gateway](../../classes/edge/api-gateway/index.md)
- **Token (LLM)** (*mesmo termo*) — A unidade de texto que um modelo de linguagem lê e escreve (cerca de ¾ de uma palavra em inglês); modelos são cobrados e limitados em tokens. → [Sistemas de IA › LLM gateway](../../classes/ai-systems/llm-gateway/index.md)
- **Tool calling** (*chamada de ferramentas*) — Um LLM devolvendo um pedido estruturado para chamar uma função (com argumentos em JSON) que a aplicação executa. → [Catálogo › Tool Registry](../components/ai/index.md#toolreg)
- **Tracing (distributed)** (*rastreamento distribuído*) — Acompanhar uma requisição através dos serviços como uma árvore de spans cronometrados que compartilham um trace id. → [Catálogo › Tracing](../components/observability/index.md#tracing)
- **TTFT (time to first token)** (*tempo até o primeiro token*) — O atraso até um LLM começar a transmitir sua resposta; domina a latência percebida em interfaces de chat. → [Sistemas de IA › LLM gateway](../../classes/ai-systems/llm-gateway/index.md)
- **TTL (time to live)** (*tempo de vida*) — Por quanto tempo um item em cache ou uma resposta de DNS continua válido antes de precisar ser buscado de novo. → [Cache › Invalidação](../../classes/caching/invalidation/index.md)
- **Two-phase commit (2PC)** (*commit em duas fases*) — Um protocolo que confirma uma transação em vários participantes de forma atômica por meio de um coordenador; trava se o coordenador falhar. → [Mensageria › Padrões](../../classes/messaging/patterns/index.md)

## U

- **Universal Scalability Law** (*Lei Universal de Escalabilidade*) — Estende Amdahl com um custo de coerência: a partir de certo ponto, acrescentar nós reduz a vazão. → [Estimativas](../../classes/estimation/index.md)
- **USE method** (*método USE*) — Verificar cada recurso quanto a Utilização, Saturação e Erros para encontrar gargalos. → [Observabilidade › Sinais](../../classes/observability/signals/index.md)
- **Utilization** (*utilização*) — A fração do tempo em que um recurso está ocupado (ρ = taxa de chegada ÷ capacidade); a latência cresce bruscamente quando ela se aproxima de 1. → [Estimativas › Filas](../../classes/estimation/queueing/index.md)

## V

- **Vector clock** (*relógio vetorial*) — Um vetor de contadores, um por nó, que detecta se dois eventos têm ordem causal ou são concorrentes. → [Sistemas distribuídos › Tempo e relógios](../../classes/distributed/time-clocks/index.md)
- **Vector database** (*banco de dados vetorial*) — Um armazenamento otimizado para busca por similaridade em embeddings, com índices ANN e filtros por metadados. → [Catálogo › Vector DB](../components/storage/index.md#vectordb)
- **Vertical scaling** (*escala vertical*) — Passar para uma máquina maior (scale up): simples, mas com teto e ponto único de falha. → [Introdução › Jornada de escala](../../classes/intro/scaling-journey/index.md)
- **Virtual nodes** (*nós virtuais*) — Muitas posições por nó físico num anel de hashing consistente, para distribuir a carga de forma uniforme e rebalancear suavemente. → [Borda › Balanceamento de carga](../../classes/edge/load-balancing/index.md)
- **VPC (virtual private cloud)** (*nuvem privada virtual*) — Uma rede privada isolada numa região da nuvem, onde você define sub-redes, rotas e regras de firewall. → [Catálogo › VPC](../components/network/index.md#vpc)
- **VPN** (*rede privada virtual*) — Um túnel criptografado que une duas redes (ou um notebook e uma rede) pela internet. → [Catálogo › VPN](../components/network/index.md#vpn)

## W

- **WAF (web application firewall)** (*firewall de aplicação web*) — Um filtro de tráfego HTTP que bloqueia ataques (injeção, bots maliciosos, padrões abusivos) antes que cheguem à aplicação. → [Catálogo › WAF](../components/edge/index.md#waf)
- **Waiting room (virtual queue)** (*sala de espera virtual*) — Uma fila na frente de um fluxo de alta demanda que admite usuários no ritmo que o sistema aguenta, transformando um pico num fluxo constante. → [Estudo de caso: ingressos](../../classes/case-studies/ticketing/index.md)
- **Webhook** (*mesmo termo*) — Uma chamada HTTP de retorno: um provedor chama o seu endpoint quando algo acontece (pagamento confirmado); precisa ser verificada e processada de forma idempotente. → [Computação › Integrações](../../classes/compute/integrations/index.md)
- **WebSocket** (*mesmo termo*) — Uma conexão bidirecional e de longa duração entre navegador e servidor, usada em chat, atualizações ao vivo e jogos. → [Borda › Protocolos](../../classes/edge/protocols/index.md)
- **Worker** (*mesmo termo*) — Um processo que retira jobs de uma fila e os executa em segundo plano, escalado conforme o backlog. → [Catálogo › Worker](../components/compute/index.md#worker)
- **Write-ahead log (WAL)** (*log de escrita antecipada*) — Um log em que o banco registra cada mudança antes de aplicá-la, usado para recuperação de quedas e replicação. → [Bancos de dados › Replicação](../../classes/databases/replication/index.md)
- **Write skew** (*mesmo termo*) — Uma anomalia em que duas transações leem dados sobrepostos e fazem escritas disjuntas que, juntas, quebram um invariante; evitada pelo isolamento serializable. → [Bancos de dados › Transações](../../classes/databases/transactions/index.md)
- **Write-through / write-behind** (*mesmo termo*) — Políticas de escrita no cache: gravar no cache e no banco juntos (through), ou primeiro no cache e descarregar depois (behind). → [Cache › Padrões](../../classes/caching/patterns/index.md)

## Z

- **Zero trust** (*confiança zero*) — Um modelo de segurança em que nenhuma posição na rede é confiável: toda requisição é autenticada, autorizada e criptografada. → [Rede e segurança › Zero trust](../../classes/network-security/zero-trust/index.md)
- **Zipf distribution** (*distribuição de Zipf*) — Uma distribuição de popularidade em que poucos itens recebem a maior parte do tráfego; é por isso que caches funcionam e que chaves quentes acontecem. → [Cache › Modos de falha](../../classes/caching/failure-modes/index.md)
