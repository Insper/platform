/*
 * System Design Playground: component catalog.
 *
 * One entry per palette component (ids fixed by the course, see the
 * reference pages under 2027.1/reference/components/). Each entry gives:
 *   - cat     the palette category,
 *   - role    how the engine routes requests through it
 *             source | split | call | cache | msg | side | frame,
 *   - d       default parameters (numbers are illustrative, chosen to be
 *             explainable in class, not benchmarks of a product),
 *   - params  the parameters the inspector lets you edit,
 *   - desc / numbers   bilingual texts for the inspector and tooltips,
 *   - glyph   the inner markup of a 24×24 stroke icon.
 *
 * Prices are rough on-demand cloud list prices in USD/month, labelled
 * "illustrative" in the UI. Works in the browser (window.SDP.catalog) and
 * in Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.SDP = root.SDP || {};
    root.SDP.catalog = api;
    /* "Learn more" in the inspector: the component catalog of the current course edition,
       relative to the site root. null hides the link (e.g. a site without that edition). */
    root.SDP.catalogBase = "2027.1/reference/components/";
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CATEGORIES = [
    { id: "client", label: { en: "Client", pt: "Cliente" } },
    { id: "edge", label: { en: "Traffic & edge", pt: "Tráfego & borda" } },
    { id: "compute", label: { en: "Compute", pt: "Computação" } },
    { id: "storage", label: { en: "Storage", pt: "Armazenamento" } },
    { id: "messaging", label: { en: "Messaging", pt: "Mensageria" } },
    { id: "observability", label: { en: "Observability", pt: "Observabilidade" } },
    { id: "network", label: { en: "Network", pt: "Rede" } },
    { id: "ai", label: { en: "AI & agents", pt: "IA & agentes" } },
    { id: "external", label: { en: "External", pt: "Externos" } }
  ];

  /* ─── Parameter definitions (shared by all components) ─── */
  function P(type, label, help, extra) {
    var p = { type: type, label: label, help: help };
    for (var k in extra) p[k] = extra[k];
    return p;
  }

  var PARAMS = {
    replicas: P("int", { en: "Replicas", pt: "Réplicas" }, { en: "Identical instances behind the node; capacity scales with them.", pt: "Instâncias idênticas; a capacidade cresce com elas." }, { min: 1, max: 200, step: 1, log: true }),
    capacity: P("num", { en: "Capacity / replica (req/s)", pt: "Capacidade / réplica (req/s)" }, { en: "Requests per second one replica serves at 100% CPU.", pt: "Requisições por segundo que uma réplica atende com CPU a 100%." }, { min: 1, max: 1000000, log: true }),
    latencyMs: P("num", { en: "Service time p50 (ms)", pt: "Tempo de serviço p50 (ms)" }, { en: "Median time of the node's own work, without queueing or downstream calls (lognormal).", pt: "Mediana do trabalho do próprio nó, sem fila nem chamadas a jusante (lognormal)." }, { min: 0.1, max: 30000, log: true }),
    threads: P("int", { en: "Threads / connections per replica", pt: "Threads / conexões por réplica" }, { en: "Concurrent requests one replica can hold (thread pool, DB connections). Little's Law: needed = λ × W.", pt: "Requisições simultâneas que uma réplica segura (pool de threads, conexões). Lei de Little: necessárias = λ × W." }, { min: 1, max: 100000, log: true }),
    queueLimit: P("int", { en: "Queue limit / replica", pt: "Limite da fila / réplica" }, { en: "Requests that may wait for a free worker; beyond it they are rejected (503).", pt: "Requisições que podem esperar um worker livre; acima disso são rejeitadas (503)." }, { min: 0, max: 100000, log: true }),
    parallelCalls: P("bool", { en: "Parallel downstream calls", pt: "Chamadas a jusante em paralelo" }, { en: "Off: calls run one after the other (latencies add). On: latency is the slowest call.", pt: "Desligado: chamadas em sequência (latências somam). Ligado: vale a chamada mais lenta." }),
    autoscale: P("bool", { en: "Autoscaling", pt: "Autoescalonamento" }, { en: "Every 15 s compare CPU utilization with the target and add/remove replicas (like a Kubernetes HPA).", pt: "A cada 15 s compara a utilização de CPU com a meta e adiciona/remove réplicas (como o HPA do Kubernetes)." }),
    minReplicas: P("int", { en: "Autoscale min", pt: "Autoescala mín." }, null, { min: 1, max: 200, log: true }),
    maxReplicas: P("int", { en: "Autoscale max", pt: "Autoescala máx." }, null, { min: 1, max: 500, log: true }),
    targetUtil: P("num", { en: "Autoscale target utilization", pt: "Utilização-alvo da autoescala" }, null, { min: 0.2, max: 0.95, step: 0.05 }),
    warmupS: P("num", { en: "Replica warm-up (s)", pt: "Aquecimento da réplica (s)" }, { en: "Time until a new replica takes traffic (VM ≈ 90 s, container ≈ 20 s).", pt: "Tempo até uma nova réplica receber tráfego (VM ≈ 90 s, contêiner ≈ 20 s)." }, { min: 0, max: 600, step: 5 }),
    multiAZ: P("bool", { en: "Spread over 3 AZs", pt: "Espalhar em 3 AZs" }, { en: "Replicas in three availability zones: an AZ outage takes only a third of them.", pt: "Réplicas em três zonas de disponibilidade: uma queda de AZ derruba só um terço." }),
    leakPerMin: P("num", { en: "Memory leak (% capacity lost / min)", pt: "Vazamento de memória (% capacidade / min)" }, { en: "Slowly reduces capacity; only a soak test finds it. Restarts reset it.", pt: "Reduz a capacidade aos poucos; só o teste de soak encontra. Reinícios zeram." }, { min: 0, max: 10, step: 0.1 }),
    weight: P("num", { en: "Traffic weight", pt: "Peso do tráfego" }, { en: "Share of the target RPS generated by this client (relative to other clients).", pt: "Parcela do RPS-alvo gerada por este cliente (relativa aos outros)." }, { min: 0, max: 100, step: 0.1 }),
    botShare: P("num", { en: "Bot traffic (extra share)", pt: "Tráfego de bots (parcela extra)" }, { en: "Bots on top of real users (0.5 = +50%). A WAF can block them.", pt: "Bots além dos usuários reais (0,5 = +50%). Um WAF pode bloqueá-los." }, { min: 0, max: 10, step: 0.05 }),
    zipfS: P("num", { en: "Key skew (Zipf s)", pt: "Assimetria das chaves (Zipf s)" }, { en: "Popularity of keys: 0 = uniform; ≥ 1 = a few hot keys get most requests.", pt: "Popularidade das chaves: 0 = uniforme; ≥ 1 = poucas chaves quentes recebem a maioria." }, { min: 0, max: 2, step: 0.05 }),
    readRatio: P("num", { en: "Read share (overrides the toolbar)", pt: "Parcela de leituras (sobrepõe a barra)" }, { en: "Share of this client's requests that are reads.", pt: "Parcela das requisições deste cliente que são leituras." }, { min: 0, max: 1, step: 0.01 }),
    timeoutMs: P("num", { en: "Client timeout (ms)", pt: "Timeout do cliente (ms)" }, { en: "The user gives up after this time; the request counts as an error.", pt: "O usuário desiste após esse tempo; a requisição conta como erro." }, { min: 100, max: 120000, log: true }),
    mode: P("enum", { en: "Routing", pt: "Roteamento" }, { en: "weighted: by capacity/edge ratio; failover: everything to the first healthy target.", pt: "weighted: por capacidade/razão da aresta; failover: tudo para o primeiro alvo saudável." }, { options: ["weighted", "failover"] }),
    ttlS: P("num", { en: "DNS TTL (s)", pt: "TTL do DNS (s)" }, { en: "Clients cache the answer this long, so a failover takes detection + TTL.", pt: "Clientes guardam a resposta por esse tempo: o failover leva detecção + TTL." }, { min: 1, max: 3600, log: true }),
    hitRatio: P("num", { en: "Hit ratio (warm)", pt: "Taxa de acerto (aquecido)" }, { en: "Share of reads answered by the cache once warm.", pt: "Parcela das leituras respondidas pelo cache quando aquecido." }, { min: 0, max: 0.999, step: 0.01 }),
    cacheWarmS: P("num", { en: "Cache warm-up (s)", pt: "Aquecimento do cache (s)" }, { en: "After a flush/cold start the hit ratio climbs back to its target in about this time.", pt: "Após um flush/partida a frio a taxa de acerto volta à meta em cerca desse tempo." }, { min: 1, max: 1800, log: true }),
    policy: P("enum", { en: "Write policy", pt: "Política de escrita" }, { en: "cache-aside: writes invalidate (lower hit ratio when writes are frequent); write-through: writes update the cache too (slower writes).", pt: "cache-aside: escritas invalidam (menos acertos com muitas escritas); write-through: escritas atualizam o cache (escrita mais lenta)." }, { options: ["cache-aside", "write-through"] }),
    coalescing: P("bool", { en: "Request coalescing", pt: "Coalescência de requisições" }, { en: "Concurrent misses of the same key wait for one DB query: stops a cache stampede.", pt: "Misses simultâneos da mesma chave esperam uma só consulta: evita o estouro (stampede)." }),
    respKB: P("num", { en: "Response size (KB)", pt: "Tamanho da resposta (KB)" }, { en: "Used for egress cost (USD per GB).", pt: "Usado no custo de saída de dados (USD por GB)." }, { min: 1, max: 100000, log: true }),
    blockRate: P("num", { en: "Bot block rate", pt: "Taxa de bloqueio de bots" }, { en: "Share of bot requests stopped at the edge.", pt: "Parcela de requisições de bots barradas na borda." }, { min: 0, max: 1, step: 0.01 }),
    rateLimit: P("num", { en: "Rate limit (req/s, 0 = off)", pt: "Limite de taxa (req/s, 0 = sem)" }, { en: "Requests above it are rejected at once with 429 (fast failure, protects what is behind).", pt: "Requisições acima dele são rejeitadas na hora com 429 (falha rápida, protege o que está atrás)." }, { min: 0, max: 2000000, log: true }),
    quota: P("num", { en: "Provider quota (req/s)", pt: "Cota do provedor (req/s)" }, { en: "Above the quota the provider answers 429 Too Many Requests.", pt: "Acima da cota o provedor responde 429 Too Many Requests." }, { min: 1, max: 1000000, log: true }),
    readReplicas: P("int", { en: "Read replicas", pt: "Réplicas de leitura" }, { en: "Followers that serve reads; writes still go to the single primary. Replication lag grows with write load.", pt: "Seguidores que atendem leituras; escritas continuam no primário. O atraso de replicação cresce com as escritas." }, { min: 0, max: 15, step: 1 }),
    standby: P("bool", { en: "Multi-AZ standby (failover)", pt: "Standby multi-AZ (failover)" }, { en: "A synchronous standby in another AZ takes over in ~60 s when the primary fails (doubles the price).", pt: "Um standby síncrono em outra AZ assume em ~60 s quando o primário cai (dobra o preço)." }),
    writeCost: P("num", { en: "Write cost (× a read)", pt: "Custo da escrita (× leitura)" }, { en: "A write uses this many reads' worth of capacity (WAL, indexes, locks).", pt: "Uma escrita consome o equivalente a esse número de leituras (WAL, índices, locks)." }, { min: 0.1, max: 50, step: 0.1 }),
    partitions: P("int", { en: "Partitions", pt: "Partições" }, { en: "Max consumer parallelism = min(partitions, consumer replicas).", pt: "Paralelismo máximo de consumo = min(partições, réplicas consumidoras)." }, { min: 1, max: 1000, log: true }),
    maxBacklog: P("num", { en: "Max backlog (messages)", pt: "Backlog máximo (mensagens)" }, { en: "Retention limit; messages beyond it are dropped.", pt: "Limite de retenção; mensagens além dele são descartadas." }, { min: 100, max: 1e10, log: true }),
    concurrencyLimit: P("int", { en: "Concurrency limit", pt: "Limite de concorrência" }, { en: "Max simultaneous executions; above it calls are throttled (429).", pt: "Máximo de execuções simultâneas; acima disso há throttling (429)." }, { min: 1, max: 100000, log: true }),
    provisioned: P("int", { en: "Provisioned (always warm)", pt: "Provisionadas (sempre quentes)" }, { en: "Pre-warmed instances: no cold start for them, but you pay even when idle.", pt: "Instâncias pré-aquecidas: sem cold start, mas pagas mesmo ociosas." }, { min: 0, max: 10000, log: true }),
    coldStartMs: P("num", { en: "Cold start (ms)", pt: "Cold start (ms)" }, { en: "Extra latency of a request that lands on a new instance.", pt: "Latência extra de uma requisição que cai em instância nova." }, { min: 0, max: 20000, log: true }),
    memGB: P("num", { en: "Memory (GB)", pt: "Memória (GB)" }, { en: "Billed per GB-second.", pt: "Cobrada por GB-segundo." }, { min: 0.125, max: 10, step: 0.125 }),
    jobs: P("int", { en: "Jobs per run", pt: "Jobs por execução" }, null, { min: 1, max: 10000000, log: true }),
    everyS: P("num", { en: "Run every (s)", pt: "Executa a cada (s)" }, null, { min: 1, max: 3600, log: true }),
    spreadS: P("num", { en: "Spread jobs over (s)", pt: "Espalha os jobs em (s)" }, { en: "0 = all jobs at the same instant (thundering herd).", pt: "0 = todos no mesmo instante (manada)." }, { min: 0, max: 3600, step: 1 }),
    semanticCacheHit: P("num", { en: "Semantic cache hit ratio", pt: "Acerto do cache semântico" }, { en: "Similar prompts answered from a cache of embeddings: ~20 ms and no tokens.", pt: "Prompts parecidos respondidos de um cache de embeddings: ~20 ms e sem tokens." }, { min: 0, max: 0.9, step: 0.01 }),
    tokensPerReq: P("num", { en: "Tokens per call (in + out)", pt: "Tokens por chamada (entrada + saída)" }, null, { min: 10, max: 200000, log: true }),
    pricePer1k: P("num", { en: "USD per 1k tokens", pt: "USD por 1k tokens" }, null, { min: 0.0001, max: 1, log: true }),
    fallbackModel: P("bool", { en: "Fallback model", pt: "Modelo reserva" }, { en: "When the provider is down or over quota, route to a second model (slower, still answers).", pt: "Se o provedor cair ou estourar a cota, usa um segundo modelo (mais lento, mas responde)." }),
    steps: P("int", { en: "Agent steps (LLM calls / request)", pt: "Passos do agente (chamadas ao LLM / req.)" }, { en: "Each step = one LLM call + one tool call, in sequence. Latency and cost grow linearly.", pt: "Cada passo = uma chamada ao LLM + uma a ferramenta, em sequência. Latência e custo crescem linearmente." }, { min: 1, max: 30, step: 1 }),
    catchRate: P("num", { en: "Attack catch rate", pt: "Taxa de captura de ataques" }, { en: "Share of prompt-injection / unsafe requests the guardrails stop.", pt: "Parcela de prompt injection / pedidos inseguros barrados pelos guardrails." }, { min: 0, max: 1, step: 0.01 }),
    payloadKB: P("num", { en: "Payload (KB)", pt: "Payload (KB)" }, { en: "Data per request through the NAT, billed per GB.", pt: "Dados por requisição pelo NAT, cobrados por GB." }, { min: 0.1, max: 100000, log: true }),
    meshTimeoutMs: P("num", { en: "Default timeout (ms)", pt: "Timeout padrão (ms)" }, { en: "Applied by the sidecars to calls of attached services that set none.", pt: "Aplicado pelos sidecars às chamadas dos serviços anexados que não definem um." }, { min: 10, max: 60000, log: true }),
    meshRetries: P("int", { en: "Default retries", pt: "Retries padrão" }, null, { min: 0, max: 5, step: 1 }),
    price: P("num", { en: "Price / replica (USD/month)", pt: "Preço / réplica (USD/mês)" }, { en: "Illustrative on-demand price.", pt: "Preço ilustrativo sob demanda." }, { min: 0, max: 100000, log: true })
  };

  var EDGE_PARAMS = {
    ratio: P("num", { en: "Call ratio", pt: "Razão de chamadas" }, { en: "Fraction of the caller's requests that make this call (or the weight among the targets of a load balancer).", pt: "Fração das requisições do chamador que fazem esta chamada (ou o peso entre os alvos de um balanceador)." }, { min: 0, max: 1, step: 0.01 }),
    filter: P("enum", { en: "Requests", pt: "Requisições" }, { en: "Only reads, only writes, or all requests take this edge.", pt: "Só leituras, só escritas ou todas seguem esta aresta." }, { options: ["all", "read", "write"] }),
    async: P("bool", { en: "Asynchronous (fire and forget)", pt: "Assíncrona (dispara e esquece)" }, { en: "The caller does not wait. Always on when the target is a broker.", pt: "O chamador não espera. Sempre ligada quando o alvo é um broker." }),
    timeoutMs: P("num", { en: "Timeout (ms, 0 = none)", pt: "Timeout (ms, 0 = nenhum)" }, { en: "Give up after this time: bounds how long a thread waits (fail fast).", pt: "Desiste após esse tempo: limita quanto uma thread espera (falha rápida)." }, { min: 0, max: 60000, log: true }),
    retries: P("int", { en: "Retries", pt: "Retentativas" }, { en: "Extra attempts after a failure. Each one is extra load on the target.", pt: "Tentativas extras após falha. Cada uma é carga extra no alvo." }, { min: 0, max: 5, step: 1 }),
    backoff: P("enum", { en: "Backoff", pt: "Backoff" }, { en: "Wait between attempts: none, exponential (100 ms × 2ⁿ), or exponential with full jitter.", pt: "Espera entre tentativas: nenhuma, exponencial (100 ms × 2ⁿ) ou exponencial com jitter." }, { options: ["none", "exp", "exp+jitter"] }),
    circuitBreaker: P("bool", { en: "Circuit breaker", pt: "Circuit breaker" }, { en: "Opens when > 50% of calls fail over 5 s: calls fail fast for 10 s, then a few probes (half-open).", pt: "Abre quando > 50% das chamadas falham em 5 s: falha rápida por 10 s, depois algumas sondas (meio-aberto)." }),
    fallback: P("bool", { en: "Fallback (degraded answer)", pt: "Fallback (resposta degradada)" }, { en: "When the call fails, answer with stale/default data: counted as degraded success.", pt: "Quando a chamada falha, responde com dado antigo/padrão: conta como sucesso degradado." }),
    idempotencyKey: P("bool", { en: "Idempotency key on retries", pt: "Chave de idempotência nos retries" }, { en: "The provider deduplicates repeated attempts: a retry after a timeout cannot charge twice.", pt: "O provedor deduplica tentativas repetidas: um retry após timeout não cobra duas vezes." }),
    bulkhead: P("num", { en: "Bulkhead (max share of threads)", pt: "Bulkhead (fração máx. de threads)" }, { en: "This call may hold at most this share of the caller's threads; extra calls fail fast (0 = off).", pt: "Esta chamada pode ocupar no máximo essa fração das threads do chamador; o excesso falha rápido (0 = desligado)." }, { min: 0, max: 1, step: 0.05 })
  };

  var EDGE_DEFAULTS = { ratio: 1, filter: "all", async: false, timeoutMs: 0, retries: 0, backoff: "none", circuitBreaker: false, fallback: false, bulkhead: 0, idempotencyKey: false };

  /* Parameters shared by stateless compute nodes. */
  var COMPUTE = ["replicas", "capacity", "latencyMs", "threads", "queueLimit", "parallelCalls", "autoscale", "minReplicas", "maxReplicas", "targetUtil", "warmupS", "multiAZ", "price"];
  var AUTOSCALE_D = { autoscale: false, minReplicas: 1, maxReplicas: 20, targetUtil: 0.6, warmupS: 60, multiAZ: false, parallelCalls: false, leakPerMin: 0 };

  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  function C(id, cat, label, role, d, params, desc, numbers, glyph) {
    return { id: id, cat: cat, label: label, role: role, d: d, params: params, desc: desc, numbers: numbers, glyph: glyph };
  }

  /* d fields used by the engine:
       replicas, capacity (req/s per replica), latencyMs (median), sigma,
       threads, queueLimit, price (USD/month per replica), perMillion (USD per
       million requests), avail (per-replica availability, for the theory),
       mtbf (crash-rate multiplier: >1 fails more often), ext (external). */
  var LIST = [
    /* CLIENT */
    C("client", "client", "Client", "source",
      { weight: 1, botShare: 0, zipfS: 0.8, timeoutMs: 30000, parallelCalls: true, price: 0 },
      ["weight", "readRatio", "botShare", "zipfS", "timeoutMs", "parallelCalls"],
      { en: "Users' browsers or API clients. They generate the load of the selected profile (open model: new users keep arriving even when the system is slow).", pt: "Navegadores ou clientes de API dos usuários. Geram a carga do perfil escolhido (modelo aberto: usuários continuam chegando mesmo com o sistema lento)." },
      { en: "Arrivals: Poisson(λ·Δt) per 0.1 s tick. Read share from the toolbar.", pt: "Chegadas: Poisson(λ·Δt) por tick de 0,1 s. Parcela de leituras na barra." },
      '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    C("mobile", "client", "Mobile", "source",
      { weight: 1, botShare: 0, zipfS: 0.8, timeoutMs: 15000, parallelCalls: true, price: 0 },
      ["weight", "readRatio", "botShare", "zipfS", "timeoutMs", "parallelCalls"],
      { en: "Mobile apps: same as a client, usually with a shorter patience (timeout) and flaky networks.", pt: "Apps móveis: como um cliente, em geral com menos paciência (timeout) e redes instáveis." },
      { en: "Typical mobile RTT 50–150 ms (not added: the simulator measures server-side latency).", pt: "RTT móvel típico 50–150 ms (não somado: o simulador mede a latência do lado servidor)." },
      '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),

    /* TRAFFIC & EDGE */
    C("dns", "edge", "DNS", "split",
      { replicas: 1, capacity: 1e7, latencyMs: 0.5, sigma: 0.3, threads: Infinity, queueLimit: 1e6, price: 1, perMillion: 0.4, avail: 0.99999, mtbf: 0.05, mode: "weighted", ttlS: 60 },
      ["mode", "ttlS", "price"],
      { en: "Turns a name into the address of a region or load balancer. Weighted or failover routing between targets (GeoDNS, health-checked records).", pt: "Traduz um nome no endereço de uma região ou balanceador. Roteamento ponderado ou failover entre alvos (GeoDNS, registros com health check)." },
      { en: "Lookup is cached by clients for the TTL: failover takes detection + TTL.", pt: "A resposta fica em cache pelo TTL: o failover leva detecção + TTL." },
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    C("cdn", "edge", "CDN", "cache",
      { replicas: 1, capacity: 2e6, latencyMs: 15, sigma: 0.4, threads: Infinity, queueLimit: 1e6, price: 0, perMillion: 0.75, avail: 0.9999, mtbf: 0.1, hitRatio: 0.9, cacheWarmS: 60, respKB: 50, perGB: 0.03 },
      ["hitRatio", "cacheWarmS", "respKB"],
      { en: "Edge caches close to users serve static and cacheable content; misses and writes go to the origin.", pt: "Caches de borda perto dos usuários servem conteúdo estático e cacheável; misses e escritas vão à origem." },
      { en: "Edge hit ≈ 10–30 ms; pay per GB of egress (≈ 0.02–0.08 USD/GB by volume).", pt: "Acerto na borda ≈ 10–30 ms; paga-se por GB de saída (≈ 0,02–0,08 USD/GB conforme o volume)." },
      '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/><path d="M9 14h6"/>'),
    C("lb", "edge", "Load Balancer", "split",
      { replicas: 1, capacity: 100000, latencyMs: 0.5, sigma: 0.3, threads: Infinity, queueLimit: 1e5, price: 25, perMillion: 0.02, avail: 0.9999, mtbf: 0.1 },
      ["capacity", "price"],
      { en: "Spreads requests over healthy targets in proportion to their capacity; takes failed targets out after they are detected (30 s, or 3 s with a Health Check).", pt: "Distribui requisições entre alvos saudáveis proporcionalmente à capacidade; retira alvos falhos após detectá-los (30 s, ou 3 s com Health Check)." },
      { en: "Adds < 1 ms. Managed L7 LBs scale to ~100k req/s.", pt: "Acrescenta < 1 ms. LBs L7 gerenciados escalam a ~100 mil req/s." },
      '<circle cx="5" cy="12" r="2"/><path d="M7 12h4M11 12l7-6M11 12h8M11 12l7 6"/>'),
    C("waf", "edge", "WAF", "call",
      { replicas: 1, capacity: 50000, latencyMs: 1, sigma: 0.3, threads: Infinity, queueLimit: 1e5, price: 30, perMillion: 0.6, avail: 0.9999, mtbf: 0.1, blockRate: 0.95 },
      ["blockRate", "capacity", "price"],
      { en: "Web Application Firewall: filters bots, scrapers and attacks (OWASP rules, rate rules) before they cost you compute.", pt: "Web Application Firewall: filtra bots, scrapers e ataques (regras OWASP, de taxa) antes que custem computação." },
      { en: "≈ 1 ms per request; priced per million requests.", pt: "≈ 1 ms por requisição; cobrado por milhão de requisições." },
      '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 9l6 6M15 9l-6 6"/>'),
    C("apigw", "edge", "API Gateway", "call",
      merge({ replicas: 1, capacity: 10000, latencyMs: 2, sigma: 0.3, threads: 2000, queueLimit: 1000, price: 60, perMillion: 1, avail: 0.9995, mtbf: 0.3, rateLimit: 0 }, AUTOSCALE_D),
      ["rateLimit", "replicas", "capacity", "latencyMs", "parallelCalls", "autoscale", "minReplicas", "maxReplicas", "price"],
      { en: "Single entry point for the APIs: authentication, routing, rate limiting. Targets of the same type are load-balanced; different types are all called (e.g. auth then service).", pt: "Porta de entrada das APIs: autenticação, roteamento, limite de taxa. Alvos do mesmo tipo são balanceados; tipos diferentes são todos chamados (ex.: auth e depois o serviço)." },
      { en: "≈ 1–5 ms; rate limit with token bucket answers 429 above the limit.", pt: "≈ 1–5 ms; o rate limit (token bucket) responde 429 acima do limite." },
      '<path d="M4 20V8l8-5 8 5v12"/><path d="M9 20v-6h6v6"/>'),
    C("ingress", "edge", "Ingress", "split",
      merge({ replicas: 2, capacity: 20000, latencyMs: 1, sigma: 0.3, threads: Infinity, queueLimit: 1e4, price: 40, perMillion: 0, avail: 0.999, mtbf: 0.3 }, AUTOSCALE_D),
      ["replicas", "capacity", "price"],
      { en: "Kubernetes Ingress / Gateway API controller: the L7 entry of a cluster, routing to Services (load-balanced over pods).", pt: "Controlador de Ingress / Gateway API do Kubernetes: a entrada L7 do cluster, roteando para Services (balanceados entre pods)." },
      { en: "An Nginx/Envoy pod handles ~10–30k req/s.", pt: "Um pod Nginx/Envoy aguenta ~10–30 mil req/s." },
      '<rect x="10" y="4" width="10" height="16" rx="1"/><path d="M2 12h11M10 8l4 4-4 4"/>'),

    /* COMPUTE */
    C("app", "compute", "App Server", "call",
      merge({ replicas: 1, capacity: 500, latencyMs: 10, sigma: 0.4, threads: 200, queueLimit: 200, price: 120, perMillion: 0, avail: 0.995, mtbf: 1, gc: 0.002 }, AUTOSCALE_D),
      COMPUTE.concat(["leakPerMin"]),
      { en: "A stateless service (e.g. Spring Boot): CPU work plus calls to its dependencies. Scales horizontally behind a load balancer.", pt: "Um serviço sem estado (ex.: Spring Boot): trabalho de CPU mais chamadas às dependências. Escala horizontalmente atrás de um balanceador." },
      { en: "≈ 500 req/s per 4-vCPU replica at 10 ms; 200 threads. Rare GC pauses of 50–300 ms.", pt: "≈ 500 req/s por réplica de 4 vCPU a 10 ms; 200 threads. Pausas raras de GC de 50–300 ms." },
      '<rect x="4" y="3" width="16" height="7" rx="1"/><rect x="4" y="14" width="16" height="7" rx="1"/><path d="M8 6.5h.01M8 17.5h.01"/>'),
    C("worker", "compute", "Worker", "call",
      merge({ replicas: 2, capacity: 100, latencyMs: 50, sigma: 0.6, threads: 20, queueLimit: 100, price: 80, perMillion: 0, avail: 0.995, mtbf: 1, warmupS: 20 }, { autoscale: false, minReplicas: 1, maxReplicas: 50, targetUtil: 0.7, multiAZ: false, parallelCalls: false }),
      COMPUTE,
      { en: "Background consumer: takes jobs from a queue or stream and processes them (resize images, send e-mails, update indexes).", pt: "Consumidor em segundo plano: pega jobs de uma fila ou stream e os processa (redimensionar imagens, enviar e-mails, atualizar índices)." },
      { en: "Throughput = replicas × capacity; add replicas to drain a backlog.", pt: "Vazão = réplicas × capacidade; adicione réplicas para drenar um backlog." },
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
    C("serverless", "compute", "Serverless", "call",
      { replicas: 1, capacity: Infinity, latencyMs: 30, sigma: 0.5, threads: Infinity, queueLimit: 0, price: 0, perMillion: 0.2, gbSecond: 0.0000166667, avail: 0.9995, mtbf: 0.2, concurrencyLimit: 1000, provisioned: 0, coldStartMs: 600, memGB: 0.5, parallelCalls: false },
      ["latencyMs", "concurrencyLimit", "provisioned", "coldStartMs", "memGB", "parallelCalls"],
      { en: "Functions as a Service: one instance per concurrent request, scaled by the platform. Instances needed = λ × W (Little's Law); new ones start cold.", pt: "Function as a Service: uma instância por requisição simultânea, escalada pela plataforma. Instâncias = λ × W (Lei de Little); as novas partem a frio." },
      { en: "Cold start 100 ms–2 s; default concurrency limit ≈ 1000; billed per invocation + GB-second.", pt: "Cold start de 100 ms a 2 s; limite de concorrência padrão ≈ 1000; cobrança por invocação + GB-segundo." },
      '<path d="M6 20l6-10M9 4h3l7 16"/>'),
    C("auth", "compute", "Auth Service", "call",
      merge({ replicas: 1, capacity: 3000, latencyMs: 4, sigma: 0.3, threads: 200, queueLimit: 500, price: 120, perMillion: 0, avail: 0.999, mtbf: 0.6 }, AUTOSCALE_D),
      COMPUTE,
      { en: "Issues and validates tokens (OAuth 2.1 / OIDC, JWT). On the path of every protected request: if it is down, everybody is logged out.", pt: "Emite e valida tokens (OAuth 2.1 / OIDC, JWT). Está no caminho de toda requisição protegida: se cair, todos ficam deslogados." },
      { en: "JWT validation ≈ 1–5 ms; cache the public keys (JWKS).", pt: "Validar JWT ≈ 1–5 ms; guarde as chaves públicas (JWKS) em cache." },
      '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>'),
    C("search", "compute", "Search", "call",
      merge({ replicas: 1, capacity: 800, latencyMs: 25, sigma: 0.5, threads: 100, queueLimit: 200, price: 250, perMillion: 0, avail: 0.999, mtbf: 0.6 }, AUTOSCALE_D),
      COMPUTE,
      { en: "Full-text search engine (inverted index, e.g. Elasticsearch/OpenSearch) fed asynchronously from the source of truth.", pt: "Motor de busca textual (índice invertido, ex.: Elasticsearch/OpenSearch) alimentado de forma assíncrona pela fonte da verdade." },
      { en: "Queries ≈ 10–50 ms; ~1k queries/s per node.", pt: "Consultas ≈ 10–50 ms; ~1 mil consultas/s por nó." },
      '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
    C("scheduler", "compute", "Scheduler", "source",
      { replicas: 1, capacity: Infinity, latencyMs: 1, sigma: 0.2, threads: Infinity, queueLimit: 0, price: 10, perMillion: 0, avail: 0.999, mtbf: 0.3, jobs: 1000, everyS: 60, spreadS: 0, parallelCalls: false },
      ["jobs", "everyS", "spreadS"],
      { en: "Cron-like trigger: starts N jobs every T seconds. All jobs at the same instant = a thundering herd on what is downstream.", pt: "Gatilho estilo cron: dispara N jobs a cada T segundos. Todos no mesmo instante = uma manada sobre o que está a jusante." },
      { en: "Spread the jobs (jitter) or put a queue after it.", pt: "Espalhe os jobs (jitter) ou coloque uma fila depois dele." },
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    C("notifications", "compute", "Notifications", "call",
      merge({ replicas: 1, capacity: 1000, latencyMs: 15, sigma: 0.5, threads: 200, queueLimit: 500, price: 100, perMillion: 0, avail: 0.999, mtbf: 0.8 }, AUTOSCALE_D),
      COMPUTE,
      { en: "Fans out messages to users (push, e-mail, SMS), with templates, preferences, deduplication and provider failover.", pt: "Distribui mensagens aos usuários (push, e-mail, SMS), com templates, preferências, deduplicação e failover de provedores." },
      { en: "Usually behind a queue: the user must not wait for an e-mail provider.", pt: "Em geral atrás de uma fila: o usuário não deve esperar o provedor de e-mail." },
      '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    C("analytics", "compute", "Analytics", "call",
      merge({ replicas: 1, capacity: 2000, latencyMs: 20, sigma: 0.5, threads: 100, queueLimit: 1000, price: 150, perMillion: 0, avail: 0.995, mtbf: 0.8 }, AUTOSCALE_D),
      COMPUTE,
      { en: "Consumes events (clicks, sales) and aggregates them for dashboards; never on the user's critical path.", pt: "Consome eventos (cliques, vendas) e os agrega para painéis; nunca no caminho crítico do usuário." },
      { en: "Feeds a data warehouse in batches or micro-batches.", pt: "Alimenta um data warehouse em lotes ou micro-lotes." },
      '<path d="M4 20h16M7 16v-5M12 16V6M17 16V8"/>'),

    /* STORAGE */
    C("sql", "storage", "SQL Database", "call",
      { replicas: 1, capacity: 3000, latencyMs: 4, sigma: 0.5, threads: 200, queueLimit: 400, price: 450, perMillion: 0, avail: 0.999, mtbf: 0.4, readReplicas: 0, standby: false, writeCost: 3, parallelCalls: false },
      ["capacity", "latencyMs", "threads", "queueLimit", "readReplicas", "standby", "writeCost", "price"],
      { en: "Relational database (e.g. PostgreSQL): transactions, joins, strong consistency on a single primary. Reads can go to replicas; writes cannot.", pt: "Banco relacional (ex.: PostgreSQL): transações, joins, consistência forte em um primário. Leituras podem ir a réplicas; escritas não." },
      { en: "Indexed lookup ≈ 1–5 ms; a primary does a few thousand simple queries/s; connections are scarce (≈ 100–500).", pt: "Busca indexada ≈ 1–5 ms; um primário faz alguns milhares de consultas simples/s; conexões são escassas (≈ 100–500)." },
      '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'),
    C("nosql", "storage", "NoSQL DB", "call",
      { replicas: 4, capacity: 5000, latencyMs: 3, sigma: 0.4, threads: 1000, queueLimit: 2000, price: 180, perMillion: 0, avail: 0.9995, mtbf: 0.4, writeCost: 1.2, partitioned: true, parallelCalls: false },
      ["replicas", "capacity", "latencyMs", "writeCost", "price"],
      { en: "Partitioned key-value / document / wide-column store (e.g. DynamoDB, Cassandra). Scales by adding partitions — as long as keys are spread evenly.", pt: "Banco particionado chave-valor / documento / colunar (ex.: DynamoDB, Cassandra). Escala adicionando partições — desde que as chaves se espalhem." },
      { en: "Single-key ops ≈ 1–10 ms. A hot key saturates its partition while the others idle.", pt: "Operações por chave ≈ 1–10 ms. Uma chave quente satura sua partição enquanto as outras ficam ociosas." },
      '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
    C("cache", "storage", "Cache", "cache",
      { replicas: 1, capacity: 80000, latencyMs: 0.5, sigma: 0.3, threads: 10000, queueLimit: 10000, price: 160, perMillion: 0, avail: 0.999, mtbf: 0.4, hitRatio: 0.9, cacheWarmS: 120, policy: "cache-aside", coalescing: false, partitioned: true },
      ["replicas", "hitRatio", "cacheWarmS", "policy", "coalescing", "capacity", "price"],
      { en: "In-memory key-value store (e.g. Redis/Valkey). Hits return in under a millisecond; misses go to the database behind it.", pt: "Armazenamento chave-valor em memória (ex.: Redis/Valkey). Acertos voltam em menos de 1 ms; misses vão ao banco atrás dele." },
      { en: "≈ 0.2–1 ms; ~100k ops/s per shard. DB load = reads × (1 − hit ratio).", pt: "≈ 0,2–1 ms; ~100 mil ops/s por shard. Carga no banco = leituras × (1 − acerto)." },
      '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    C("objstore", "storage", "Object Store", "call",
      { replicas: 1, capacity: 200000, latencyMs: 30, sigma: 0.6, threads: Infinity, queueLimit: 1e5, price: 230, perMillion: 0.4, avail: 0.9999, mtbf: 0.05, parallelCalls: false },
      ["latencyMs", "price"],
      { en: "Blob storage (e.g. S3, GCS): images, videos, backups. Virtually unlimited and very durable, but tens of ms per request.", pt: "Armazenamento de blobs (ex.: S3, GCS): imagens, vídeos, backups. Praticamente ilimitado e muito durável, mas dezenas de ms por requisição." },
      { en: "First byte ≈ 20–100 ms; 11 nines of durability; ≈ 23 USD per TB-month.", pt: "Primeiro byte ≈ 20–100 ms; 11 noves de durabilidade; ≈ 23 USD por TB-mês." },
      '<path d="M4 6h16l-2 14H6z"/><ellipse cx="12" cy="6" rx="8" ry="2"/>'),
    C("dwh", "storage", "Data Warehouse", "call",
      { replicas: 1, capacity: 20, latencyMs: 2000, sigma: 0.8, threads: 20, queueLimit: 100, price: 2000, perMillion: 0, avail: 0.999, mtbf: 0.2, parallelCalls: false },
      ["replicas", "capacity", "latencyMs", "price"],
      { en: "Columnar analytical database (OLAP, e.g. BigQuery, Snowflake): scans billions of rows in seconds. Never call it from a user request.", pt: "Banco analítico colunar (OLAP, ex.: BigQuery, Snowflake): varre bilhões de linhas em segundos. Nunca o chame numa requisição de usuário." },
      { en: "Queries in seconds; dozens of concurrent queries.", pt: "Consultas em segundos; dezenas de consultas simultâneas." },
      '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-8h10v8M7 17h10"/>'),
    C("vectordb", "storage", "Vector DB", "call",
      { replicas: 1, capacity: 1500, latencyMs: 12, sigma: 0.4, threads: 200, queueLimit: 500, price: 300, perMillion: 0, avail: 0.999, mtbf: 0.5, parallelCalls: false },
      ["replicas", "capacity", "latencyMs", "price"],
      { en: "Stores embeddings and answers nearest-neighbour queries (ANN, HNSW) — the retrieval step of RAG (e.g. pgvector, Qdrant).", pt: "Guarda embeddings e responde consultas de vizinhos mais próximos (ANN, HNSW) — a etapa de busca do RAG (ex.: pgvector, Qdrant)." },
      { en: "Top-k ANN ≈ 5–20 ms over millions of vectors.", pt: "ANN top-k ≈ 5–20 ms sobre milhões de vetores." },
      '<path d="M4 20 20 4M4 20l6-14M4 20l14-6"/><circle cx="20" cy="4" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="18" cy="14" r="1.5"/>'),

    /* MESSAGING */
    C("queue", "messaging", "Message Queue", "msg",
      { replicas: 1, capacity: 30000, latencyMs: 3, sigma: 0.4, threads: Infinity, queueLimit: 0, price: 40, perMillion: 0.4, avail: 0.9995, mtbf: 0.2, maxBacklog: 1e7, fanout: false, partitions: Infinity },
      ["capacity", "maxBacklog", "price"],
      { en: "Point-to-point queue (e.g. SQS, RabbitMQ): each message goes to ONE of the competing consumers. Absorbs bursts; the backlog drains at the consumers' pace.", pt: "Fila ponto a ponto (ex.: SQS, RabbitMQ): cada mensagem vai para UM dos consumidores concorrentes. Absorve picos; o backlog drena no ritmo dos consumidores." },
      { en: "Enqueue ≈ 2–10 ms. Consumer lag = backlog ÷ drain rate.", pt: "Enfileirar ≈ 2–10 ms. Atraso do consumidor = backlog ÷ taxa de drenagem." },
      '<rect x="2" y="8" width="5" height="8" rx="1"/><rect x="9.5" y="8" width="5" height="8" rx="1"/><rect x="17" y="8" width="5" height="8" rx="1"/>'),
    C("pubsub", "messaging", "Pub/Sub", "msg",
      { replicas: 1, capacity: 50000, latencyMs: 5, sigma: 0.4, threads: Infinity, queueLimit: 0, price: 50, perMillion: 0.4, avail: 0.9995, mtbf: 0.2, maxBacklog: 1e7, fanout: true, partitions: Infinity },
      ["capacity", "maxBacklog", "price"],
      { en: "Topic with subscriptions (e.g. SNS, Google Pub/Sub, Redis pub/sub): every subscriber gets its own copy of each message.", pt: "Tópico com assinaturas (ex.: SNS, Google Pub/Sub, Redis pub/sub): cada assinante recebe sua própria cópia de cada mensagem." },
      { en: "Fan-out: one publish → N deliveries.", pt: "Fan-out: uma publicação → N entregas." },
      '<circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>'),
    C("stream", "messaging", "Event Stream", "msg",
      { replicas: 1, capacity: 1000, latencyMs: 20, sigma: 0.4, threads: Infinity, queueLimit: 0, price: 15, perMillion: 0.015, avail: 0.9995, mtbf: 0.2, maxBacklog: 1e9, fanout: true, partitions: 4, partitioned: true },
      ["replicas", "partitions", "capacity", "maxBacklog", "price"],
      { en: "Managed append-only log (e.g. Kinesis, Event Hubs): ordered per shard, replayable, every consumer group reads at its own offset.", pt: "Log append-only gerenciado (ex.: Kinesis, Event Hubs): ordenado por shard, reproduzível, cada grupo lê no seu offset." },
      { en: "≈ 1000 records/s per shard; parallelism = shards.", pt: "≈ 1000 registros/s por shard; paralelismo = shards." },
      '<path d="M2 8c3-3 5 3 8 0s5 3 8 0 4-1 4-1M2 16c3-3 5 3 8 0s5 3 8 0 4-1 4-1"/>'),
    C("kafka", "messaging", "Kafka", "msg",
      { replicas: 3, capacity: 50000, latencyMs: 5, sigma: 0.4, threads: Infinity, queueLimit: 0, price: 300, perMillion: 0, avail: 0.9995, mtbf: 0.2, maxBacklog: 1e10, fanout: true, partitions: 12, partitioned: true },
      ["replicas", "partitions", "capacity", "maxBacklog", "price"],
      { en: "Distributed commit log: topics split into partitions, consumer groups, retention and replay. The backbone of event-driven systems.", pt: "Log de commits distribuído: tópicos divididos em partições, grupos de consumidores, retenção e replay. A espinha dorsal de sistemas orientados a eventos." },
      { en: "A broker ≈ 50k+ msgs/s; consumers in a group ≤ partitions (extra consumers idle).", pt: "Um broker ≈ 50 mil+ msgs/s; consumidores no grupo ≤ partições (os extras ficam ociosos)." },
      '<path d="M3 6h18M3 12h18M3 18h18"/><path d="M8 4v4M14 10v4M18 16v4"/>'),

    /* OBSERVABILITY */
    C("metrics", "observability", "Metrics", "side",
      { price: 150, perNode: 20, avail: 1 }, ["price"],
      { en: "Time series (Prometheus/OpenTelemetry): rate, errors, duration, saturation. Connect it to a service to see its utilization — you can't fix what you don't measure.", pt: "Séries temporais (Prometheus/OpenTelemetry): taxa, erros, duração, saturação. Conecte a um serviço para ver sua utilização — não se conserta o que não se mede." },
      { en: "Cost grows with the number of series (cardinality).", pt: "O custo cresce com o número de séries (cardinalidade)." },
      '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
    C("logs", "observability", "Logs", "side",
      { price: 100, perMillion: 0.5, avail: 1 }, ["price"],
      { en: "Structured logs of every service (e.g. Loki, Elasticsearch). In the playground: the Events tab shows the details of what went wrong.", pt: "Logs estruturados de cada serviço (ex.: Loki, Elasticsearch). No playground: a aba Eventos mostra os detalhes do que deu errado." },
      { en: "Priced per GB ingested (≈ 0.5 USD/GB).", pt: "Cobrado por GB ingerido (≈ 0,5 USD/GB)." },
      '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>'),
    C("tracing", "observability", "Tracing", "side",
      { price: 120, perMillion: 0.2, avail: 1 }, ["price"],
      { en: "Distributed tracing (OpenTelemetry, Tempo/Jaeger): one request's path across services. Enables the Trace tab (critical path of a slow request).", pt: "Tracing distribuído (OpenTelemetry, Tempo/Jaeger): o caminho de uma requisição pelos serviços. Habilita a aba Trace (caminho crítico de uma requisição lenta)." },
      { en: "Sample: keeping 1–10% of traces is common.", pt: "Amostragem: guardar 1–10% dos traces é comum." },
      '<path d="M3 5h10M6 10h12M9 15h8M5 20h6"/>'),
    C("alerting", "observability", "Alerting", "side",
      { price: 20, avail: 1 }, ["price"],
      { en: "Pages the on-call engineer when an SLO burns too fast. Connected to Metrics, it halves the time to repair random failures (MTTR).", pt: "Aciona o plantão quando um SLO queima rápido demais. Conectado a Metrics, reduz pela metade o tempo de reparo de falhas aleatórias (MTTR)." },
      { en: "Availability = MTTF / (MTTF + MTTR): a faster repair is more nines.", pt: "Disponibilidade = MTTF / (MTTF + MTTR): reparo mais rápido = mais noves." },
      '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>'),
    C("healthcheck", "observability", "Health Check", "side",
      { price: 10, avail: 1 }, ["price"],
      { en: "Active probes (liveness/readiness). Connect it to a load balancer, DNS or service: failures are detected in 3 s instead of 30 s.", pt: "Sondas ativas (liveness/readiness). Conecte a um balanceador, DNS ou serviço: falhas detectadas em 3 s em vez de 30 s." },
      { en: "Detection time is part of every outage.", pt: "O tempo de detecção faz parte de toda indisponibilidade." },
      '<path d="M3 12h4l2-5 4 10 2-5h6"/>'),

    /* NETWORK */
    C("vpc", "network", "VPC", "frame",
      { price: 0, region: "region-1" }, [],
      { en: "Virtual private cloud: a private network in one region. Draw it as a frame; nodes inside get its region (used by region outages and cross-region latency, +70 ms).", pt: "Nuvem privada virtual: uma rede privada em uma região. Desenhe como moldura; nós dentro recebem a região (usada em quedas de região e latência entre regiões, +70 ms)." },
      { en: "Cross-region round trip ≈ 50–150 ms.", pt: "Ida e volta entre regiões ≈ 50–150 ms." },
      '<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 2"/><path d="M8 12h8"/>'),
    C("subnet", "network", "Subnet", "frame",
      { price: 0, zone: "a" }, [],
      { en: "A subnet lives in one availability zone (AZ). Nodes inside get its zone: an AZ outage takes them down (unless spread over 3 AZs).", pt: "Uma sub-rede vive em uma zona de disponibilidade (AZ). Nós dentro recebem a zona: uma queda de AZ os derruba (a menos que espalhados em 3 AZs)." },
      { en: "Inter-AZ round trip ≈ 1–2 ms.", pt: "Ida e volta entre AZs ≈ 1–2 ms." },
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/>'),
    C("nat", "network", "NAT Gateway", "call",
      { replicas: 1, capacity: 100000, latencyMs: 0.5, sigma: 0.3, threads: Infinity, queueLimit: 1e4, price: 33, perMillion: 0, avail: 0.9999, mtbf: 0.1, payloadKB: 20, perGB: 0.045 },
      ["capacity", "payloadKB", "price"],
      { en: "Lets services in private subnets call the internet (3rd-party APIs) without being reachable from it. Billed per hour and per GB.", pt: "Permite que serviços em sub-redes privadas chamem a internet (APIs de terceiros) sem serem alcançáveis por ela. Cobrado por hora e por GB." },
      { en: "≈ 0.045 USD per GB processed: chatty calls to the internet add up.", pt: "≈ 0,045 USD por GB processado: chamadas tagarelas à internet somam." },
      '<path d="M4 12h12M12 6l6 6-6 6"/><path d="M20 4v16"/>'),
    C("vpn", "network", "VPN", "call",
      { replicas: 1, capacity: 10000, latencyMs: 10, sigma: 0.3, threads: Infinity, queueLimit: 1e4, price: 36, perMillion: 0, avail: 0.999, mtbf: 0.3 },
      ["capacity", "latencyMs", "price"],
      { en: "Encrypted tunnel to another network (on-premises, partner, another cloud). Adds 5–20 ms and has limited bandwidth.", pt: "Túnel cifrado para outra rede (on-premises, parceiro, outra nuvem). Acrescenta 5–20 ms e tem banda limitada." },
      { en: "≈ 1.25 Gbps per tunnel.", pt: "≈ 1,25 Gbps por túnel." },
      '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    C("mesh", "network", "Service Mesh", "side",
      { price: 100, perNode: 15, avail: 1, meshTimeoutMs: 1000, meshRetries: 2 },
      ["meshTimeoutMs", "meshRetries", "price"],
      { en: "Sidecars/ambient proxies (e.g. Istio, Linkerd) next to the services connected to it: mTLS, timeouts, retries with backoff and circuit breaking by default, telemetry. +1 ms per hop.", pt: "Sidecars/proxies ambient (ex.: Istio, Linkerd) junto aos serviços conectados: mTLS, timeouts, retries com backoff e circuit breaker por padrão, telemetria. +1 ms por salto." },
      { en: "Connect services to it (not in the request path). Mesh + Metrics = every attached service observed.", pt: "Conecte serviços a ele (fora do caminho da requisição). Mesh + Metrics = todos os serviços anexados observados." },
      '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><circle cx="12" cy="12" r="2"/><path d="m7 7 3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/>'),

    /* AI & AGENTS */
    C("llmgw", "ai", "LLM Gateway", "call",
      { replicas: 1, capacity: 5000, latencyMs: 1200, sigma: 0.6, threads: 5000, queueLimit: 1000, price: 60, perMillion: 0, avail: 0.995, mtbf: 3, ext: true, quota: 50, semanticCacheHit: 0, tokensPerReq: 1500, pricePer1k: 0.003, fallbackModel: false, parallelCalls: false },
      ["quota", "semanticCacheHit", "tokensPerReq", "pricePer1k", "fallbackModel", "latencyMs", "price"],
      { en: "One door to the model providers: routing, quotas, fallbacks, semantic cache, cost and latency tracking (e.g. LiteLLM). The model call itself is included.", pt: "Uma porta para os provedores de modelos: roteamento, cotas, fallbacks, cache semântico, custo e latência (ex.: LiteLLM). A chamada ao modelo está incluída." },
      { en: "LLM call ≈ 0.5–5 s; provider quota in requests and tokens per minute; cost per 1k tokens.", pt: "Chamada ao LLM ≈ 0,5–5 s; cota do provedor em requisições e tokens por minuto; custo por 1k tokens." },
      '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 16l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/>'),
    C("orchestrator", "ai", "Orchestrator", "call",
      merge({ replicas: 1, capacity: 300, latencyMs: 15, sigma: 0.4, threads: 1000, queueLimit: 500, price: 150, perMillion: 0, avail: 0.995, mtbf: 1, steps: 4 }, AUTOSCALE_D),
      ["steps", "replicas", "capacity", "threads", "queueLimit", "autoscale", "minReplicas", "maxReplicas", "price"],
      { en: "Runs the agent loop: plan → call the LLM → call a tool → repeat. Each step adds one LLM call (and one tool call) in sequence.", pt: "Executa o laço do agente: planejar → chamar o LLM → chamar uma ferramenta → repetir. Cada passo soma uma chamada ao LLM (e uma a ferramenta) em sequência." },
      { en: "Latency ≈ steps × LLM latency; cost ≈ steps × tokens.", pt: "Latência ≈ passos × latência do LLM; custo ≈ passos × tokens." },
      '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>'),
    C("toolreg", "ai", "Tool Registry", "call",
      merge({ replicas: 1, capacity: 2000, latencyMs: 10, sigma: 0.4, threads: 500, queueLimit: 500, price: 60, perMillion: 0, avail: 0.999, mtbf: 0.6 }, AUTOSCALE_D),
      COMPUTE,
      { en: "Catalog of tools the agent may call (MCP servers): schemas, permissions, and the calls to the real services behind them.", pt: "Catálogo de ferramentas que o agente pode chamar (servidores MCP): esquemas, permissões e chamadas aos serviços reais por trás." },
      { en: "Its edges are the tools (e.g. catalog, order).", pt: "Suas arestas são as ferramentas (ex.: catalog, order)." },
      '<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
    C("memory", "ai", "Memory Fabric", "call",
      merge({ replicas: 1, capacity: 1000, latencyMs: 20, sigma: 0.4, threads: 300, queueLimit: 500, price: 100, perMillion: 0, avail: 0.999, mtbf: 0.6 }, AUTOSCALE_D),
      COMPUTE,
      { en: "Retrieval and memory for the agent: embeds the question, searches a Vector DB, reranks, and keeps conversation memory (RAG).", pt: "Recuperação e memória do agente: gera o embedding da pergunta, busca no Vector DB, reordena e guarda a memória da conversa (RAG)." },
      { en: "Embedding ≈ 10–50 ms + ANN search.", pt: "Embedding ≈ 10–50 ms + busca ANN." },
      '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
    C("safety", "ai", "Safety Mesh", "call",
      merge({ replicas: 1, capacity: 600, latencyMs: 40, sigma: 0.4, threads: 400, queueLimit: 500, price: 200, perMillion: 0, avail: 0.999, mtbf: 0.6, catchRate: 0.98 }, AUTOSCALE_D),
      ["catchRate"].concat(COMPUTE),
      { en: "Guardrails around the model: prompt-injection and PII detection on input, policy and schema validation on output.", pt: "Guardrails em volta do modelo: detecção de prompt injection e de dados pessoais na entrada, validação de política e de esquema na saída." },
      { en: "A classifier ≈ 20–100 ms. Without it, attacks reach the model.", pt: "Um classificador ≈ 20–100 ms. Sem ele, ataques chegam ao modelo." },
      '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),

    /* EXTERNAL */
    C("thirdparty", "external", "3rd Party API", "call",
      { replicas: 1, capacity: Infinity, latencyMs: 150, sigma: 0.9, threads: Infinity, queueLimit: 0, price: 0, perMillion: 10, avail: 0.995, mtbf: 4, ext: true, quota: 1000 },
      ["quota", "latencyMs"],
      { en: "Somebody else's API (maps, recommendations, fraud scoring). You control neither its latency nor its outages — only how you call it.", pt: "A API de outra empresa (mapas, recomendações, antifraude). Você não controla latência nem quedas — só como a chama." },
      { en: "≈ 100–500 ms with a long tail; quotas; outages more often than your own services.", pt: "≈ 100–500 ms com cauda longa; cotas; quedas mais frequentes que as dos seus serviços." },
      '<path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>'),
    C("payment", "external", "Payment", "call",
      { replicas: 1, capacity: Infinity, latencyMs: 400, sigma: 0.7, threads: Infinity, queueLimit: 0, price: 0, perMillion: 0, avail: 0.999, mtbf: 3, ext: true, quota: 500 },
      ["quota", "latencyMs"],
      { en: "External payment provider (e.g. Stripe, Adyen, Pix PSP). Slow, rate limited, and every retry must carry an idempotency key.", pt: "Provedor de pagamentos externo (ex.: Stripe, Adyen, PSP de Pix). Lento, com limite de taxa, e todo retry deve levar uma chave de idempotência." },
      { en: "≈ 300 ms–2 s; fees are a % of the sale (not in the cost).", pt: "≈ 300 ms–2 s; taxas são % da venda (fora do custo)." },
      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'),
    C("email", "external", "Email", "call",
      { replicas: 1, capacity: Infinity, latencyMs: 250, sigma: 0.6, threads: Infinity, queueLimit: 0, price: 0, perMillion: 100, avail: 0.999, mtbf: 3, ext: true, quota: 100 },
      ["quota", "latencyMs"],
      { en: "E-mail / push / SMS provider (e.g. SES, SendGrid, FCM). Sending is slow and quota-limited: put it behind a queue.", pt: "Provedor de e-mail / push / SMS (ex.: SES, SendGrid, FCM). Enviar é lento e com cota: coloque atrás de uma fila." },
      { en: "≈ 0.10 USD per 1000 e-mails; ~100 sends/s quota.", pt: "≈ 0,10 USD por 1000 e-mails; cota de ~100 envios/s." },
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')
  ];

  var BY_ID = {};
  LIST.forEach(function (c) { BY_ID[c.id] = c; });

  /* Effective parameters of a node: catalog defaults overridden by the
     node's own params. */
  function params(node) {
    var c = BY_ID[node.type];
    return merge(c ? c.d : {}, node.params || {});
  }

  function lang() {
    return (typeof document !== "undefined" && (document.documentElement.lang || "").indexOf("pt") === 0) ? "pt" : "en";
  }

  function text(obj, lg) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    return obj[lg || lang()] || obj.en || "";
  }

  return {
    CATEGORIES: CATEGORIES, LIST: LIST, BY_ID: BY_ID, PARAMS: PARAMS,
    EDGE_PARAMS: EDGE_PARAMS, EDGE_DEFAULTS: EDGE_DEFAULTS,
    get: function (id) { return BY_ID[id]; },
    params: params, merge: merge, lang: lang, text: text,
    /* node box size in canvas units (x, y of a node are its centre) */
    NODE_W: 150, NODE_H: 68
  };
});
