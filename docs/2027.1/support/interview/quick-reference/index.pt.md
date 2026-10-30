# Referência rápida { #quick-reference }

Uma página para revisar antes de uma entrevista: os números, as fórmulas, uma linha e um trade-off para cada componente da paleta, os movimentos padrão para cada formato de problema e as frases que ajudam ou atrapalham. Tudo aqui é explicado nas aulas; siga os links quando uma linha deixar de parecer óbvia. Para as tabelas completas e as fontes, veja a [folha de números](../../../reference/numbers/index.md) e o [catálogo de componentes](../../../reference/components/index.md).

## Números para saber { #numbers-to-know }

### Escada de latências { #latency-ladder }

Valores clássicos popularizados por Jeff Dean e Peter Norvig, arredondados; o hardware moderno é mais rápido em algumas linhas (SSDs NVMe, CPUs mais novas), mas é com as **proporções** que você raciocina[^1].

| Operação | ≈ Tempo | Pense nela como |
|---|---|---|
| Referência ao cache L1 | 0,5–1 ns | de graça |
| Referência à memória principal | 100 ns | 200× o L1 |
| Comprimir 1 KB (codec rápido) | ≈ 3 µs | |
| Enviar 1 KB por uma rede de 1 Gbps | 10 µs | |
| Leitura aleatória de 4 KB no SSD | ≈ 20–150 µs | NVMe na ponta baixa |
| Ler 1 MB sequencial da memória | ≈ 50–250 µs | |
| Ida e volta dentro do mesmo datacenter | ≈ 0,5 ms | 500 µs |
| Ler 1 MB sequencial do SSD | ≈ 1 ms | |
| Seek de disco (HDD) | ≈ 10 ms | evite nos caminhos quentes |
| Ida e volta entre AZs de uma região | ≈ 1–2 ms | ≈ ilustrativo |
| Ida e volta São Paulo ↔ leste dos EUA | ≈ 100–150 ms | ≈ ilustrativo; a luz na fibra ≈ 200 km/ms |
| Ida e volta ao redor do mundo | ≈ 150–300 ms | |

Números típicos no nível de serviço (≈ ilustrativos): GET no Redis ≈ 0,2–1 ms pela rede; consulta SQL indexada ≈ 1–10 ms; requisição a um servidor de aplicação ≈ 10–50 ms; resposta de LLM ≈ 1–10 s (tempo até o primeiro token de 0,2–2 s).

### Conversões de taxa { #rate-conversions }

| Por dia | Por segundo (média) | Lembre |
|---|---|---|
| 1 milhão | ≈ 12 | 1 dia ≈ 86.400 s ≈ 10⁵ s |
| 10 milhões | ≈ 115 | |
| 100 milhões | ≈ 1.150 | |
| 1 bilhão | ≈ 11.500 | |

Pico = média × fator de pico (2–5× para tráfego com ciclo diário; 10–100× ou mais numa venda relâmpago ou num evento viral). Um mês ≈ 2,6 × 10⁶ s; um ano ≈ 3,2 × 10⁷ s.

### Tamanhos { #sizes }

| Coisa | ≈ Tamanho |
|---|---|
| 2¹⁰ / 2²⁰ / 2³⁰ / 2⁴⁰ | ≈ 10³ (KB) / 10⁶ (MB) / 10⁹ (GB) / 10¹² (TB) |
| Caractere ASCII / caractere UTF-8 | 1 B / 1–4 B |
| int64, timestamp | 8 B |
| UUID | 16 B em binário, 36 B como texto |
| Um post curto ou uma linha de pedido com metadados | ≈ 0,3–1 KB |
| Uma foto comprimida | ≈ 100 KB – 2 MB |
| 1 minuto de vídeo 1080p a ~5 Mbps | ≈ 40 MB |
| Um embedding de 1.536 float32 | ≈ 6 KB |

### Disponibilidade (os noves) { #availability-the-nines }

| Disponibilidade | Fora do ar por ano | por mês de 30 dias | por dia |
|---|---|---|---|
| 99% | ≈ 3,65 dias | ≈ 7,2 h | ≈ 14,4 min |
| 99,9% | ≈ 8,76 h | ≈ 43,2 min | ≈ 1,44 min |
| 99,95% | ≈ 4,38 h | ≈ 21,6 min | ≈ 43 s |
| 99,99% | ≈ 52,6 min | ≈ 4,3 min | ≈ 8,6 s |
| 99,999% | ≈ 5,3 min | ≈ 26 s | ≈ 0,86 s |

## Fórmulas

| Fórmula | Use para… | Exemplo |
|---|---|---|
| **Lei de Little** L = λ × W | Dimensionar pools de threads, conexões, filas | 1.000 req/s × 0,2 s = 200 em andamento |
| **Utilização** ρ = λ / μ | Conferir a folga; manter ρ abaixo do joelho (≈ 0,7–0,8) | 700 req/s numa capacidade de 1.000 ⇒ 0,7 |
| **Tempo no sistema M/M/1** W = S / (1 − ρ) | Ver por que a latência explode perto da saturação | S = 10 ms: ρ 0,5 ⇒ 20 ms; ρ 0,9 ⇒ 100 ms |
| **Servidores necessários** = QPS de pico / (QPS por servidor × ρ alvo) | Planejamento de capacidade | 7.000 / (500 × 0,7) ≈ 20 servidores |
| **Disponibilidade em série** A = A₁ × A₂ × … | Cadeia síncrona de dependências | 0,999³ ≈ 99,7% |
| **Disponibilidade em paralelo** A = 1 − (1 − A₁)(1 − A₂)… | Réplicas redundantes | duas a 99% ⇒ 99,99% |
| **Cache: carga no banco** = λ × (1 − h) | O valor da taxa de acerto | 10.000 req/s, h = 0,95 ⇒ 500 req/s |
| **Cache: latência média** ≈ h × t_cache + (1 − h) × t_banco | Latência esperada com cache | 0,95 × 1 + 0,05 × 20 = 1,95 ms |
| **Cauda com fan-out** P(lenta) = 1 − (1 − p)ⁿ | Por que o p99 importa com fan-out | p = 1%, n = 100 ⇒ 63% |
| **Quórum** R + W > N | A leitura vê a última escrita | N = 3, W = 2, R = 2 |
| **Tolerância do consenso** n = 2f + 1 | Nós necessários para sobreviver a f falhas | 5 nós toleram 2 |
| **Amdahl** ganho = 1 / ((1 − p) + p / n) | Limite da paralelização | p = 0,9, n = 10 ⇒ 5,3× |
| **Orçamento de erros** = (1 − SLO) × janela | Quanta falta de confiabilidade você pode gastar | 99,9% em 28 dias ⇒ 40 min |
| **Burn rate** = taxa de erros / (1 − SLO) | Alertar sobre consumo rápido do orçamento | 1,44% de erros num SLO de 99,9% ⇒ 14,4 |

Aulas: [Estimativas › Números](../../../classes/estimation/numbers/index.md) · [Filas](../../../classes/estimation/queueing/index.md) · [Percentis](../../../classes/estimation/percentiles/index.md) · [Matemática da disponibilidade](../../../classes/estimation/availability-math/index.md).

## Componentes em uma linha { #components-in-one-line }

A coluna de trade-off é o que transforma o nome de um componente num argumento.

### Cliente { #client }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `client` | [Client](../../../reference/components/client/index.md#client) | Navegador ou programa que envia requisições | Retries e timeouts do cliente moldam a sua carga; nunca confie na entrada do cliente |
| `mobile` | [Mobile](../../../reference/components/client/index.md#mobile) | App em redes instáveis, offline, lento para atualizar | Versões antigas do app vivem por meses: versione a API, mantenha a compatibilidade |

### Tráfego e borda { #traffic-edge }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `dns` | [DNS](../../../reference/components/edge/index.md#dns) | Nomes para IPs; roteamento geográfico, ponderado e de failover | Respostas em cache: TTL baixo = agilidade, mas mais consultas; nunca é failover rápido |
| `cdn` | [CDN](../../../reference/components/edge/index.md#cdn) | Cacheia conteúdo perto dos usuários | Alívio enorme vs dados desatualizados; só para conteúdo compartilhável e cacheável |
| `lb` | [Load Balancer](../../../reference/components/edge/index.md#lb) | Distribui requisições entre réplicas saudáveis | Recursos de L7 vs velocidade de L4; ele mesmo precisa ser redundante |
| `waf` | [WAF](../../../reference/components/edge/index.md#waf) | Filtra tráfego malicioso e bots | Bloqueia ataques vs falsos positivos com fãs de verdade |
| `apigw` | [API Gateway](../../../reference/components/edge/index.md#apigw) | Autenticação, rate limiting e roteamento na porta de entrada | Política central vs um salto a mais e uma dependência compartilhada |
| `ingress` | [Ingress](../../../reference/components/edge/index.md#ingress) | Encaminha HTTP externo para dentro do Kubernetes | Configuração simples vs menos recursos que um gateway completo (Gateway API) |

### Computação { #compute }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `app` | [App Server](../../../reference/components/compute/index.md#app) | Réplicas sem estado com a lógica de negócio | Escala horizontal exige o estado em outro lugar |
| `worker` | [Worker](../../../reference/components/compute/index.md#worker) | Drena filas em segundo plano | Respostas rápidas vs conclusão eventual e retries a tratar |
| `serverless` | [Serverless](../../../reference/components/compute/index.md#serverless) | Funções escaladas por requisição | Sem servidores, escala até zero vs cold starts, limites, avalanche de conexões no banco |
| `auth` | [Auth Service](../../../reference/components/compute/index.md#auth) | Autentica usuários, emite tokens | Validação de JWT sem estado vs revogação difícil |
| `search` | [Search](../../../reference/components/compute/index.md#search) | Busca textual num índice invertido | Consultas ricas vs uma cópia eventualmente consistente dos dados |
| `scheduler` | [Scheduler](../../../reference/components/compute/index.md#scheduler) | Roda jobs agendados | Precisa rodar uma vez: eleição de líder ou locks, jobs idempotentes |
| `notifications` | [Notifications](../../../reference/components/compute/index.md#notifications) | E-mail/push/SMS por provedores, assíncrono | Confiabilidade com filas e retries vs duplicatas (deduplicar) |
| `analytics` | [Analytics](../../../reference/components/compute/index.md#analytics) | Coleta e agrega eventos | Fora do caminho da requisição; atualidade vs custo |

### Armazenamento { #storage }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `sql` | [SQL Database](../../../reference/components/storage/index.md#sql) | Dados relacionais com transações | Consistência forte e joins vs escala horizontal de escrita mais difícil |
| `nosql` | [NoSQL DB](../../../reference/components/storage/index.md#nosql) | Chave-valor/documentos/colunas largas particionados | Escala e disponibilidade vs flexibilidade de consulta; projete pelos padrões de acesso |
| `cache` | [Cache](../../../reference/components/storage/index.md#cache) | Dados quentes em memória | Latência e alívio do banco vs desatualização, invalidação, stampedes |
| `objstore` | [Object Store](../../../reference/components/storage/index.md#objstore) | Arquivos e mídia baratos e duráveis | Muito durável e barato vs latência maior, sem atualização no lugar |
| `dwh` | [Data Warehouse](../../../reference/components/storage/index.md#dwh) | Análises colunares sobre o histórico | Varreduras e agregações rápidas vs não serve para transações; dados de minutos a horas atrás |
| `vectordb` | [Vector DB](../../../reference/components/storage/index.md#vectordb) | Busca de vizinhos mais próximos em embeddings | Recuperação semântica vs resultados aproximados e memória do índice |

### Mensageria { #messaging }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `queue` | [Message Queue](../../../reference/components/messaging/index.md#queue) | Cada mensagem para um consumidor | Absorve picos vs latência assíncrona e duplicatas at-least-once |
| `pubsub` | [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) | Cada mensagem para todos os assinantes | Fan-out desacoplado vs sem reprocessamento (em geral) e rastreio mais difícil |
| `stream` | [Event Stream](../../../reference/components/messaging/index.md#stream) | Log ordenado, retido e particionado | Reprocessamento e ordem por chave vs planejar partições e lag do consumidor |
| `kafka` | [Kafka](../../../reference/components/messaging/index.md#kafka) | A plataforma de referência de streaming de eventos | Vazão e retenção vs peso operacional; paralelismo ≤ partições |

### Observabilidade { #observability }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `metrics` | [Metrics](../../../reference/components/observability/index.md#metrics) | Séries temporais: RED, USE, SLIs | Agregados baratos vs limites de cardinalidade; sem detalhe por requisição |
| `logs` | [Logs](../../../reference/components/observability/index.md#logs) | Registros estruturados de eventos | Detalhe vs volume e custo; nunca registre segredos |
| `tracing` | [Tracing](../../../reference/components/observability/index.md#tracing) | Uma requisição atravessando serviços | Acha para onde vai o tempo vs a amostragem pode perder casos raros |
| `alerting` | [Alerting](../../../reference/components/observability/index.md#alerting) | Aciona humanos por sintomas | Detecção rápida vs fadiga de alertas; acione pelo consumo do SLO |
| `healthcheck` | [Health Check](../../../reference/components/observability/index.md#healthcheck) | Sondas de liveness/readiness | Remoção rápida de réplicas ruins vs tempestade de restarts se a liveness checar dependências |

### Rede { #network }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `vpc` | [VPC](../../../reference/components/network/index.md#vpc) | Rede privada numa região | Isolamento por padrão; planeje faixas sem sobreposição |
| `subnet` | [Subnet](../../../reference/components/network/index.md#subnet) | Fatia pública ou privada numa AZ | Espalhar por AZs dá disponibilidade vs custo do tráfego entre AZs |
| `nat` | [NAT Gateway](../../../reference/components/network/index.md#nat) | Saída para a internet de serviços privados | Mantém os serviços privados vs custo por GB e limite de portas |
| `vpn` | [VPN](../../../reference/components/network/index.md#vpn) | Túnel criptografado entre redes | Conectividade privada vs latência da internet e banda limitada |
| `mesh` | [Service Mesh](../../../reference/components/network/index.md#mesh) | mTLS, retries, telemetria entre serviços | Política uniforme sem código vs latência por salto e uma plataforma para operar |

### IA e agentes { #ai-agents }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `llmgw` | [LLM Gateway](../../../reference/components/ai/index.md#llmgw) | Uma porta para os provedores de modelos | Fallbacks, orçamentos, cache vs um salto a mais; o cache semântico pode errar |
| `orchestrator` | [Orchestrator](../../../reference/components/ai/index.md#orchestrator) | Roda o loop do agente | Flexibilidade vs latência e custo × número de passos |
| `toolreg` | [Tool Registry](../../../reference/components/ai/index.md#toolreg) | Ferramentas que o modelo pode chamar (MCP) | Reuso e governança vs prompt inchado; autorize dentro das ferramentas |
| `memory` | [Memory Fabric](../../../reference/components/ai/index.md#memory) | Recuperação (RAG) e memória | Respostas ancoradas vs falhas de recuperação e índices desatualizados |
| `safety` | [Safety Mesh](../../../reference/components/ai/index.md#safety) | Guardrails em entradas, saídas e ações | Reduz risco vs latência e falsos positivos; sozinho não é fronteira de segurança |

### Externos { #external }

| Id | Componente | Em uma linha | Trade-off a mencionar |
|---|---|---|---|
| `thirdparty` | [3rd Party API](../../../reference/components/external/index.md#thirdparty) | A API de outra empresa | Comprar vs construir; contenha com timeouts, breakers, filas |
| `payment` | [Payment](../../../reference/components/external/index.md#payment) | Provedor de pagamento | Chaves de idempotência, webhooks e conciliação; timeout ≠ falha |
| `email` | [Email](../../../reference/components/external/index.md#email) | Provedor de entrega de e-mail | Sempre assíncrono atrás de uma fila; regras de entregabilidade e cotas |

## Movimentos padrão { #default-moves }

| Se o problema é… | O movimento padrão | Cuidado com |
|---|---|---|
| Dominado por leituras (catálogo, feed, redirecionamentos) | CDN + cache-aside + réplicas de leitura | Desatualização, invalidação, stampede |
| Dominado por escritas (localizações, cliques, métricas) | Particionar por chave, fila/stream, LSM/NoSQL, lotes | Chaves quentes, ordem, lag do consumidor |
| Com picos (venda relâmpago, lançamento) | Fila / sala de espera + autoscaling + descarte de carga | Autoscaling é lento demais para um degrau: escale antes |
| Trabalho lento dentro da requisição | 202 Accepted + fila + workers | Endpoint de status, retries, DLQ |
| Dinheiro ou estoque | Consistência forte, transações, chaves de idempotência, conciliação | Nunca trate timeout como falha |
| Usuários no mundo todo | CDN, GeoDNS, leituras multi-região | Escritas entre regiões: latência vs consistência |
| Uma celebridade / chave quente | Dividir ou replicar a chave, cacheá-la, pull para celebridades | Fan-out na escrita para milhões de seguidores |
| Tempo real até os clientes | WebSockets/SSE + pub/sub entre servidores | Estado das conexões, tempestades de reconexão |
| Busca / autocompletar | Índice invertido ou trie, alimentado de forma assíncrona, com cache | Atraso do índice, ranqueamento |
| Dependência lenta ou instável | Timeout + retry com backoff e jitter + circuit breaker + bulkhead + fallback | Retry storms, retries não idempotentes |
| Gargalo desconhecido | Medir: RED/USE, traces, teste de carga até o joelho | Otimizar sem dados |
| Funcionalidade com LLM | Gateway + RAG + poucos passos de agente + guardrails + cache semântico | Custo por requisição, prompt injection |

## Consistência e CAP numa tabela { #consistency-and-cap-in-one-table }

| Dado | Escolha | Por quê |
|---|---|---|
| Reserva de assento, saldo, status do pedido | Forte (CP), transações | Um invariante do qual usuários e dinheiro dependem |
| Descrição do evento, preços na página | Eventual, cache de segundos a minutos | A desatualização é inofensiva; leituras dominam |
| Contagem de visualizações, curtidas | Eventual, contadores aproximados | Exatidão não vale a coordenação |
| Carrinho de compras (clássico do Dynamo) | Disponível (AP), mesclar no conflito | Melhor aceitar o item e conciliar depois |
| O próprio perfil do usuário depois de editar | Read-your-writes | Ele precisa ver a própria mudança |
| Mensagens de uma conversa de chat | Ordem por conversa | Ordem global é desnecessária |

CAP: durante uma **partição**, escolha entre consistência e disponibilidade. PACELC: **senão**, escolha entre latência e consistência. A maioria dos sistemas escolhe por dado, não uma vez só. [Aula 3 · CAP e PACELC](../../../classes/distributed/cap-pacelc/index.md)

## SQL ou NoSQL? { #sql-or-nosql }

| Escolha SQL quando… | Escolha NoSQL quando… |
|---|---|
| Você precisa de transações em várias linhas e de restrições | O acesso é por chave e as escritas precisam escalar horizontalmente |
| As consultas são variadas ou ad hoc; joins importam | O esquema varia por item ou as linhas são muito largas |
| Os dados cabem em poucos nós (escala vertical + réplicas vão longe) | O volume de dados ou de escrita passa de um primário |
| Correção vale mais que vazão bruta (pedidos, assentos) | Disponibilidade entre regiões vale mais que consistência forte |
| Você ainda não tem certeza (o padrão mais seguro) | Você conhece bem os padrões de acesso, e eles são poucos |

NewSQL (Spanner, CockroachDB) oferece SQL e transações com escala horizontal, a um custo em latência e dinheiro. [Aula 6 · Modelos de dados](../../../classes/databases/models/index.md)

## Síncrono vs assíncrono, push vs pull { #sync-vs-async-push-vs-pull }

| | Chamada síncrona | Assíncrono (fila / evento) |
|---|---|---|
| O usuário espera | o resultado | uma confirmação de recebimento |
| Acoplamento | quem chama falha quando o chamado falha | o chamado pode estar fora; o trabalho espera |
| Latência | soma da cadeia | resposta rápida, conclusão eventual |
| Use para | leituras, decisões necessárias agora (reservar um assento) | e-mails, relatórios, fan-out, trabalho lento ou em picos |

| | Push (fan-out na escrita) | Pull (fan-out na leitura) |
|---|---|---|
| O trabalho acontece | quando o item é criado | quando o leitor pede |
| Bom para | muitos leitores, poucos escritores por item; leituras rápidas | celebridades com milhões de seguidores; itens raramente lidos |
| Custo | amplificação de escrita | leituras mais lentas e pesadas |
| Resposta usual | híbrido: push para a maioria, pull para celebridades | |

## Frases que pontuam e frases que atrapalham { #phrases-that-score-and-phrases-that-hurt }

| Frases que pontuam | Frases que atrapalham |
|---|---|
| "Antes de desenhar, posso perguntar sobre a escala e o que nunca pode dar errado?" | (Silêncio, depois vinte caixas) |
| "Vou supor 10 M de DAU; dá umas 2.000 req/s em média, 7.000 no pico." | "Precisa aguentar muito tráfego." |
| "Escolhi X em vez de Y porque…; o custo é…; eu revisaria se…" | "X é o melhor." / "Escala." |
| "A parte difícil aqui é…, então eu gostaria de aprofundar ali." | Aprofundar a página de login |
| "O que acontece se esta chamada der timeout? Ela precisa ser idempotente." | "A gente só tenta de novo." |
| "Isto é um ponto único de falha; eu acrescentaria…" | "Não vai falhar." |
| "Eu mediria o p99 e a taxa de erros, e faria teste de carga até o joelho." | "Deve ser rápido o bastante." |
| "Bom ponto — deixa eu rever isso." | Defender uma falha que o entrevistador encontrou |

[^1]: Jeff Dean, "Numbers Everyone Should Know" (palestras, 2009–2010); a tabela mais citada está em <https://gist.github.com/jboner/2841832>. As idas e voltas entre regiões dependem das rotas: meça nos seus provedores.
