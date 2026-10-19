/*
 * System Design Playground: user interface.
 *
 * Turns every <div class="sdp" data-scenario="…" data-mode="full|compact">
 * of the page into a simulator: a blueprint canvas (SVG) with the design,
 * a toolbar (scenario, load profile, target RPS, read %, seed, chaos, run
 * controls), and — in full mode — the component palette, an inspector and
 * the Metrics / Events / Report / Trace panels. The simulation itself is
 * SDP.engine (no DOM); this file only draws it and edits the design.
 *
 * Optional attributes: data-height, data-profile, data-seed, data-chaos.
 * Initialised on Material's document$ (instant navigation) or on
 * DOMContentLoaded; idempotent; several instances per page.
 */
(function () {
  "use strict";
  var SDP = window.SDP || {};
  if (!SDP.engine || !SDP.catalog || !SDP.scenarios || !SDP.rng) return;
  var CAT = SDP.catalog, ENG = SDP.engine, SCN = SDP.scenarios, RNG = SDP.rng;
  var W = CAT.NODE_W, H = CAT.NODE_H, NS = "http://www.w3.org/2000/svg";
  var LANG = CAT.lang();
  var counter = 0, instances = [];
  var FRAME_PREFIX = { vpc: "vpc", subnet: "az", k8s: "k8s" };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ─── Interface strings ─── */
  var STR = {
    en: {
      scenario: "Scenario", profile: "Load profile", target: "Target RPS", read: "Read %", seed: "Seed", newSeed: "New random seed",
      chaos: "Chaos", play: "Run (space)", pause: "Pause (space)", step: "Advance 1 s", reset: "Restart the run", speed: "Speed",
      exportJson: "Export the design (JSON)", importJson: "Import a design (JSON)", share: "Copy a share link", mermaid: "Copy as Mermaid flowchart",
      fullscreen: "Full screen", inject: "Inject an event", god: "God mode: show what is not measured", help: "Keyboard shortcuts (?)",
      openFull: "Open in the playground", fit: "Fit to screen", zoomIn: "Zoom in", zoomOut: "Zoom out", undo: "Undo (Ctrl+Z)", redo: "Redo (Shift+Ctrl+Z)",
      palette: "Components", search: "Search…", add: "Add", metrics: "Metrics", events: "Events", report: "Report", trace: "Trace",
      offered: "Offered", served: "Served", p50: "p50", p99: "p99", errors: "Errors", availability: "Availability", cost: "Cost / month",
      costNote: "illustrative", time: "t", rps: "req/s", latency: "Latency", errRate: "Error rate", noTrace: "Add a Tracing node and connect it to a service to see where a slow request spends its time.",
      traceTitle: "Slowest of the requests sampled at", noLogs: "Add a Logs node (connected to a service) to see the details of each event.",
      noEvents: "No events yet.", runToReport: "Run the profile to the end to get the test report (or press ▶ and wait).",
      partial: "Partial report (run not finished)", goals: "Goals", hints: "Hints", brief: "Scenario", solution: "Show a possible solution",
      confirmSolution: "Replace your design by the solution?", yes: "Yes", cancel: "Cancel", resetScenario: "Reset scenario", restored: "Your saved design was restored.",
      learnMore: "Learn more", delete: "Delete", duplicate: "Duplicate", label: "Label", params: "Parameters", live: "Live",
      edge: "Call", frame: "Frame", name: "Name", region: "Region", zone: "Availability zone", none: "none",
      cycle: "That call would create a cycle: requests must flow one way.", dupEdge: "These nodes are already connected.", self: "A node cannot call itself.",
      frameNoEdge: "VPC, subnet and cluster frames are areas, not services: drop nodes inside them.", connectHint: "Click the target node (Esc to cancel).",
      copied: "Copied to the clipboard.", copyFail: "Could not copy — select and copy manually.", imported: "Design imported.", badFile: "Not a valid playground design.",
      selectTarget: "Target", injectBtn: "Inject", anyTarget: "(random)", allMeasured: "", notMeasured: "not measured (connect Metrics)",
      shortcuts: "Keyboard shortcuts", close: "Close", lambda: "Arriving λ", util: "Utilization ρ", cpu: "CPU", threads: "Threads in use",
      queue: "Queue", wait: "Queue wait", latencyW: "Latency W (mean)", replicas: "Replicas", ready: "ready", pending: "starting", down: "down",
      hit: "Cache hit ratio", backlog: "Backlog", lag: "Consumer lag", repLag: "Replication lag", nodeCost: "Cost / month", instances: "Instances (λ × W)", cold: "Cold starts",
      little: "Little's Law: L = λ × W", edgeRate: "Calls (incl. retries)", retryRate: "Retries", failAttempt: "Failed attempts", cbState: "Circuit breaker",
      cbClosed: "closed", cbOpen: "OPEN", cbHalf: "half-open", meshNote: "defaults from the service mesh", asyncNote: "asynchronous: the caller does not wait",
      weight: "Weight among the targets (× capacity)", profileDesc: "", done: "Run finished", seconds: "s", reportOf: "Test report",
      maxSustained: "Max throughput within SLO", theory: "Theoretical availability (series/parallel)", bottleneck: "Bottleneck", noBottleneck: "No node passed 85% utilization.",
      eventsRun: "Events", pass: "pass", fail: "fail", breaking: "Breaking point", knee: "Knee (p99 doubled)", copyMd: "Copy report (Markdown)",
      window: "steady window", hottest: "Busiest nodes (max ρ)", degraded: "degraded answers", godOn: "God mode on", empty: "Drag components here from the palette, or click +.",
      delSel: "Delete the selection", dupSel: "Duplicate", connect: "Connect: select a node, press C, click the target", panZoom: "Pan: drag the background · Zoom: Ctrl/⌘ + wheel or the buttons",
      runKey: "Run / pause", stepKey: "Advance 1 s", undoKey: "Undo / redo", helpKey: "This help", escKey: "Cancel / deselect", fitKey: "Fit to screen", nodeKey: "Move to a component · select it",
      unsched: "pending", unschedLong: "Pending (no room in the cluster)", podsPending: "PENDING", inCluster: "Runs in cluster", nodesK: "Worker nodes", podsK: "Pods scheduled / capacity",
      pendingK: "Pending pods", nodesReady: "ready", nodesStarting: "starting", nodesFailed: "failed", membersK: "Services (pods)", frameNoParams: "",
      shardsK: "Shards × nodes", shardRho: "Shard utilization ρ", hotShard: "hot", otherShards: "others", replK: "Replication", staleK: "Stale reads",
      lostK: "Lost writes", failoverK: "Failover", promoted: "promoted, one node fewer", noPrimary: "no primary", writeExtra: "Write ack wait", p99w: "p99 (writes)"
    },
    pt: {
      scenario: "Cenário", profile: "Perfil de carga", target: "RPS-alvo", read: "% leituras", seed: "Semente", newSeed: "Nova semente aleatória",
      chaos: "Caos", play: "Executar (espaço)", pause: "Pausar (espaço)", step: "Avançar 1 s", reset: "Recomeçar a execução", speed: "Velocidade",
      exportJson: "Exportar o projeto (JSON)", importJson: "Importar um projeto (JSON)", share: "Copiar link de compartilhamento", mermaid: "Copiar como fluxograma Mermaid",
      fullscreen: "Tela cheia", inject: "Injetar um evento", god: "Modo deus: mostra o que não é medido", help: "Atalhos de teclado (?)",
      openFull: "Abrir no playground", fit: "Enquadrar", zoomIn: "Aproximar", zoomOut: "Afastar", undo: "Desfazer (Ctrl+Z)", redo: "Refazer (Shift+Ctrl+Z)",
      palette: "Componentes", search: "Buscar…", add: "Adicionar", metrics: "Métricas", events: "Eventos", report: "Relatório", trace: "Trace",
      offered: "Oferecido", served: "Atendido", p50: "p50", p99: "p99", errors: "Erros", availability: "Disponibilidade", cost: "Custo / mês",
      costNote: "ilustrativo", time: "t", rps: "req/s", latency: "Latência", errRate: "Taxa de erro", noTrace: "Adicione um nó de Tracing e conecte-o a um serviço para ver onde uma requisição lenta gasta seu tempo.",
      traceTitle: "A mais lenta das requisições amostradas em", noLogs: "Adicione um nó de Logs (ligado a um serviço) para ver os detalhes de cada evento.",
      noEvents: "Nenhum evento ainda.", runToReport: "Execute o perfil até o fim para obter o relatório do teste (ou aperte ▶ e espere).",
      partial: "Relatório parcial (execução não terminou)", goals: "Metas", hints: "Dicas", brief: "Cenário", solution: "Mostrar uma solução possível",
      confirmSolution: "Substituir seu projeto pela solução?", yes: "Sim", cancel: "Cancelar", resetScenario: "Restaurar o cenário", restored: "Seu projeto salvo foi restaurado.",
      learnMore: "Saiba mais", delete: "Excluir", duplicate: "Duplicar", label: "Rótulo", params: "Parâmetros", live: "Ao vivo",
      edge: "Chamada", frame: "Moldura", name: "Nome", region: "Região", zone: "Zona de disponibilidade", none: "nenhum",
      cycle: "Essa chamada criaria um ciclo: as requisições fluem em um sentido.", dupEdge: "Esses nós já estão conectados.", self: "Um nó não pode chamar a si mesmo.",
      frameNoEdge: "Molduras de VPC, sub-rede e cluster são áreas, não serviços: coloque nós dentro delas.", connectHint: "Clique no nó de destino (Esc cancela).",
      copied: "Copiado para a área de transferência.", copyFail: "Não foi possível copiar — selecione e copie manualmente.", imported: "Projeto importado.", badFile: "Não é um projeto válido do playground.",
      selectTarget: "Alvo", injectBtn: "Injetar", anyTarget: "(aleatório)", allMeasured: "", notMeasured: "não medido (conecte Metrics)",
      shortcuts: "Atalhos de teclado", close: "Fechar", lambda: "Chegando λ", util: "Utilização ρ", cpu: "CPU", threads: "Threads em uso",
      queue: "Fila", wait: "Espera na fila", latencyW: "Latência W (média)", replicas: "Réplicas", ready: "prontas", pending: "subindo", down: "fora",
      hit: "Taxa de acerto do cache", backlog: "Backlog", lag: "Atraso do consumidor", repLag: "Atraso de replicação", nodeCost: "Custo / mês", instances: "Instâncias (λ × W)", cold: "Cold starts",
      little: "Lei de Little: L = λ × W", edgeRate: "Chamadas (com retries)", retryRate: "Retries", failAttempt: "Tentativas com falha", cbState: "Circuit breaker",
      cbClosed: "fechado", cbOpen: "ABERTO", cbHalf: "meio-aberto", meshNote: "padrões do service mesh", asyncNote: "assíncrona: o chamador não espera",
      weight: "Peso entre os alvos (× capacidade)", profileDesc: "", done: "Execução concluída", seconds: "s", reportOf: "Relatório do teste",
      maxSustained: "Vazão máxima dentro do SLO", theory: "Disponibilidade teórica (série/paralelo)", bottleneck: "Gargalo", noBottleneck: "Nenhum nó passou de 85% de utilização.",
      eventsRun: "Eventos", pass: "ok", fail: "falhou", breaking: "Ponto de ruptura", knee: "Joelho (p99 dobrou)", copyMd: "Copiar relatório (Markdown)",
      window: "janela estável", hottest: "Nós mais ocupados (ρ máx.)", degraded: "respostas degradadas", godOn: "Modo deus ligado", empty: "Arraste componentes da paleta para cá, ou clique em +.",
      delSel: "Excluir a seleção", dupSel: "Duplicar", connect: "Conectar: selecione um nó, aperte C, clique no destino", panZoom: "Mover: arraste o fundo · Zoom: Ctrl/⌘ + roda ou os botões",
      runKey: "Executar / pausar", stepKey: "Avançar 1 s", undoKey: "Desfazer / refazer", helpKey: "Esta ajuda", escKey: "Cancelar / desmarcar", fitKey: "Enquadrar", nodeKey: "Ir a um componente · selecioná-lo",
      unsched: "pendentes", unschedLong: "Pendentes (sem espaço no cluster)", podsPending: "PENDENTE", inCluster: "Roda no cluster", nodesK: "Nós de trabalho", podsK: "Pods alocados / capacidade",
      pendingK: "Pods pendentes", nodesReady: "prontos", nodesStarting: "subindo", nodesFailed: "com falha", membersK: "Serviços (pods)", frameNoParams: "",
      shardsK: "Shards × nós", shardRho: "Utilização dos shards ρ", hotShard: "quente", otherShards: "demais", replK: "Replicação", staleK: "Leituras desatualizadas",
      lostK: "Escritas perdidas", failoverK: "Failover", promoted: "promovido, um nó a menos", noPrimary: "sem primário", writeExtra: "Espera do ack da escrita", p99w: "p99 (escritas)"
    }
  };
  function t(k) { return (STR[LANG] && STR[LANG][k]) || STR.en[k] || k; }
  /* the name a node is shown with: its label, or its type when it has none
     (a label equal to the type counts as none) */
  function hasLabel(n, c) { return !!n.label && n.label !== c.label; }
  function nameOf(n, c) { return hasLabel(n, c) ? n.label : c.label; }
  function tx(o) { return CAT.text(o, LANG); }

  var PROFILE_LABEL = {
    smoke: { en: "smoke — a few req/s, 30 s", pt: "smoke — poucas req/s, 30 s" },
    load: { en: "load — ramp, hold the target, ramp down", pt: "load — rampa, mantém o alvo, desce" },
    stress: { en: "stress — +20% of target every 20 s, up to 3×", pt: "stress — +20% do alvo a cada 20 s, até 3×" },
    spike: { en: "spike — target, then × N for 30 s", pt: "spike — alvo, depois × N por 30 s" },
    soak: { en: "soak — target for 15 min", pt: "soak — alvo por 15 min" },
    breakpoint: { en: "breakpoint — ramp until it breaks", pt: "breakpoint — rampa até quebrar" },
    chaos: { en: "chaos — load + random failures", pt: "chaos — carga + falhas aleatórias" }
  };
  var CHAOS_LABEL = { off: { en: "off", pt: "desligado" }, low: { en: "low", pt: "baixo" }, medium: { en: "medium", pt: "médio" }, high: { en: "high", pt: "alto" } };
  var EVENT_LABEL = {
    crash: { en: "Replica crash", pt: "Queda de réplica" }, slow: { en: "Latency degradation", pt: "Degradação de latência" },
    viral: { en: "Viral traffic spike", pt: "Pico de tráfego viral" }, hotkey: { en: "Hot key (celebrity)", pt: "Chave quente (celebridade)" },
    flush: { en: "Cache flush (cold cache)", pt: "Cache esvaziado (frio)" }, az: { en: "AZ outage", pt: "Queda de AZ" },
    region: { en: "Region outage", pt: "Queda de região" }, partition: { en: "Network partition", pt: "Partição de rede" },
    extOutage: { en: "3rd-party outage / throttling", pt: "Queda / limitação de terceiro" }, badDeploy: { en: "Bad deploy (30% errors)", pt: "Deploy ruim (30% de erros)" },
    noisy: { en: "Noisy neighbour (−30% capacity)", pt: "Vizinho barulhento (−30% de capacidade)" }, gcStorm: { en: "GC pause storm", pt: "Tempestade de pausas de GC" },
    nodeFail: { en: "Node failure (Kubernetes)", pt: "Falha de nó (Kubernetes)" }, primaryFail: { en: "Primary failure (DB Cluster)", pt: "Falha do primário (DB Cluster)" },
    scale: { en: "Autoscaling", pt: "Autoescala" }, cluster: { en: "Kubernetes cluster", pt: "Cluster Kubernetes" }
  };
  var CLUSTER_PHASE = {
    pending: { en: "pods Pending: no room", pt: "pods Pending: sem espaço" }, up: { en: "cluster autoscaler adds nodes", pt: "cluster autoscaler adiciona nós" },
    ready: { en: "node ready", pt: "nó pronto" }, down: { en: "idle node removed", pt: "nó ocioso removido" }, repaired: { en: "failed node replaced", pt: "nó com falha substituído" },
    evict: { en: "pods evicted (no room)", pt: "pods despejados (sem espaço)" }
  };
  var GOAL_LABEL = {
    p50: ["p50", "ms"], p95: ["p95", "ms"], p99: ["p99", "ms"], p999: ["p99.9", "ms"],
    errorRate: [{ en: "error rate", pt: "taxa de erro" }, "%"], availability: [{ en: "availability", pt: "disponibilidade" }, "%"],
    throughput: [{ en: "throughput", pt: "vazão" }, "req/s"], costPerMonth: [{ en: "cost", pt: "custo" }, "USD/mês|USD/month"],
    consumerLag: [{ en: "consumer lag", pt: "atraso do consumidor" }, "s"], replicationLag: [{ en: "replication lag", pt: "atraso de replicação" }, "s"],
    unsafeRate: [{ en: "unsafe answers", pt: "respostas inseguras" }, "%"], duplicates: [{ en: "duplicate charges", pt: "cobranças duplicadas" }, ""],
    breakingPoint: [{ en: "breaking point", pt: "ponto de ruptura" }, "req/s"], observed: [{ en: "services measured", pt: "serviços medidos" }, "%"],
    degraded: [{ en: "degraded answers", pt: "respostas degradadas" }, "%"],
    p99Write: [{ en: "p99 (writes)", pt: "p99 (escritas)" }, "ms"], lostWrites: [{ en: "lost writes", pt: "escritas perdidas" }, ""],
    staleReads: [{ en: "stale reads", pt: "leituras desatualizadas" }, "%"]
  };
  var BOTTLENECK = {
    cpu: { en: "{n} reached ρ = {rho} at t = {t} s: about {lam} req/s for its capacity. Add replicas (horizontal scaling), put a cache in front, or reduce the work per request.", pt: "{n} chegou a ρ = {rho} em t = {t} s: cerca de {lam} req/s para sua capacidade. Adicione réplicas (escala horizontal), coloque um cache na frente ou reduza o trabalho por requisição." },
    threads: { en: "{n} ran out of threads at t = {t} s with the CPU at {cpu}: each request holds a thread for {hold} ms (waiting mostly for {slow}). Little's Law: L = λ × W ≈ {lam} × {holdS} s ≈ {L}, more than {threads} threads. Add timeouts / a circuit breaker / a bulkhead, or make the call asynchronous.", pt: "{n} ficou sem threads em t = {t} s com a CPU a {cpu}: cada requisição segura uma thread por {hold} ms (esperando sobretudo {slow}). Lei de Little: L = λ × W ≈ {lam} × {holdS} s ≈ {L}, mais que {threads} threads. Adicione timeouts / circuit breaker / bulkhead, ou torne a chamada assíncrona." },
    connections: { en: "{n} ran out of connections at t = {t} s: L = λ × W ≈ {L} > {threads}. Use a connection pooler, shorter queries, a cache, or read replicas.", pt: "{n} ficou sem conexões em t = {t} s: L = λ × W ≈ {L} > {threads}. Use um pooler de conexões, consultas mais curtas, cache ou réplicas de leitura." },
    writes: { en: "The primary of {n} is saturated by writes (t = {t} s). Read replicas do not help with writes: batch or queue them, or partition the data (sharding).", pt: "O primário de {n} está saturado por escritas (t = {t} s). Réplicas de leitura não ajudam nas escritas: agrupe ou enfileire, ou particione os dados (sharding)." },
    hotkey: { en: "One partition of {n} saturates while the others idle (hot key, t = {t} s). More partitions barely help: cache the hot key or split it.", pt: "Uma partição de {n} satura enquanto as outras ficam ociosas (chave quente, t = {t} s). Mais partições quase não ajudam: faça cache da chave quente ou divida-a." },
    quota: { en: "{n} hit the provider quota at t = {t} s (429 Too Many Requests). Make fewer calls (cache, batching), pace them with a queue, or get a higher quota.", pt: "{n} atingiu a cota do provedor em t = {t} s (429 Too Many Requests). Faça menos chamadas (cache, lotes), dose-as com uma fila ou obtenha uma cota maior." },
    ratelimit: { en: "The gateway {n} is rejecting the excess (429) since t = {t} s — by design: it protects the backend.", pt: "O gateway {n} rejeita o excesso (429) desde t = {t} s — de propósito: protege o backend." },
    pending: { en: "{n} saturated at t = {t} s and needed more pods than the cluster {cl} could schedule ({pending} Pending): the HPA asked for them, but nodes × pods per node was full, so they do not serve. Add nodes, turn on the cluster autoscaler (a new node takes ~90 s), leave headroom, or reduce the pods needed (cache, lighter requests).", pt: "{n} saturou em t = {t} s e precisou de mais pods do que o cluster {cl} conseguia alocar ({pending} Pending): o HPA os pediu, mas nós × pods por nó estava cheio, então eles não atendem. Adicione nós, ligue o cluster autoscaler (um nó novo leva ~90 s), deixe folga ou reduza os pods necessários (cache, requisições mais leves)." },
    concurrency: { en: "{n} reached its concurrency limit at t = {t} s: instances = λ × W (plus cold starts). Raise the limit or keep warm (provisioned) instances.", pt: "{n} atingiu o limite de concorrência em t = {t} s: instâncias = λ × W (mais cold starts). Aumente o limite ou mantenha instâncias quentes (provisionadas)." }
  };

  /* ─── Icons (24×24 stroke) ─── */
  var ICON = {
    play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
    step: '<path d="M5 4v16l10-8z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>', upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    mermaid: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 6h4a4 4 0 0 1 4 4M8 18h4a4 4 0 0 0 4-4"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
    fit: '<path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    open: '<path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  function icon(name, size) {
    size = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>";
  }
  function glyph(type, size) {
    var c = CAT.get(type);
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (c ? c.glyph : "") + "</svg>";
  }

  /* ─── Small helpers ─── */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) continue;
      if (k === "class") e.className = attrs[k]; else if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    return e;
  }
  function esc(s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function dec(x, d) { return LANG === "pt" ? x.toFixed(d).replace(".", ",") : x.toFixed(d); }
  function fmtNum(x) {
    if (x === undefined || x === null || isNaN(x)) return "—";
    if (!isFinite(x)) return "∞";
    var a = Math.abs(x);
    if (a >= 1e9) return dec(x / 1e9, 1) + "G";
    if (a >= 1e6) return dec(x / 1e6, a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e4) return dec(x / 1e3, 0) + "k";
    if (a >= 1e3) return dec(x / 1e3, 1) + "k";
    if (a >= 10) return dec(x, 0);
    if (a >= 1) return dec(x, 1);
    if (a === 0) return "0";
    return dec(x, 2);
  }
  function fmtMs(x) {
    if (x === undefined || x === null || isNaN(x)) return "—";
    if (!isFinite(x)) return "∞";
    if (x >= 10000) return dec(x / 1000, 0) + " s";
    if (x >= 1000) return dec(x / 1000, 1) + " s";
    return (x >= 10 ? dec(x, 0) : dec(x, 1)) + " ms";
  }
  function fmtPct(x, d) { return x === null || isNaN(x) ? "—" : dec(x * 100, d === undefined ? (x < 0.01 && x > 0 ? 2 : 1) : d) + "%"; }
  function fmtUsd(x) { return isNaN(x) ? "—" : "$" + fmtNum(x); }
  function fmtS(x) { return isNaN(x) ? "—" : (x >= 100 ? dec(x, 0) : dec(x, 1)) + " s"; }
  function fill(tpl, o) { return tpl.replace(/\{(\w+)\}/g, function (_, k) { return o[k] !== undefined ? o[k] : "?"; }); }
  function b64e(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64d(str) { str = str.replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "="; return decodeURIComponent(escape(atob(str))); }
  function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) { return null; } return null; }
  /* Site root path, e.g. "/platform/" or "/platform/pt/". Material exposes it as window.__md_scope
     (a URL computed from the page's "base"); outside the site (harness) fall back to the path
     before "playground/" or an edition folder. */
  function sitePrefix() {
    try { if (window.__md_scope) return new URL(window.__md_scope, location.href).pathname; } catch (e) { /* fall back */ }
    var p = location.pathname, m = p.match(/^(.*?\/)(?:playground\/|\d{4}\.\d\/)/);
    return m ? m[1] : null;
  }
  /* Where "Learn more" points: the component catalog of the current edition, relative to the site
     root (set in catalog.js; data-catalog on the container overrides it; empty = no link). */
  function catalogBase(root) {
    var b = root && root.getAttribute("data-catalog");
    if (b === null || b === undefined) b = (window.SDP || {}).catalogBase;
    return b ? b.replace(/\/?$/, "/") : null;
  }
  function copyText(text, done) {
    function fallback() {
      var ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove(); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }
  function isTyping(target) {
    if (!target) return false;
    var tag = (target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }
  /* log scale for sliders: v ∈ [0, 1000] ↔ x ∈ [min, max] */
  function toLog(x, min, max) { min = Math.max(min, 1e-6); return Math.round(1000 * Math.log(Math.max(x, min) / min) / Math.log(max / min)); }
  function fromLog(v, min, max) { min = Math.max(min, 1e-6); return min * Math.pow(max / min, v / 1000); }
  /* Collapsible block (Material turns <details> into admonitions, so not that). */
  function collapsible(cls, title, open) {
    var box = el("div", { class: "sdp-coll " + (cls || "") + (open ? " is-open" : "") });
    var head = el("button", { type: "button", class: "sdp-coll-head", "aria-expanded": open ? "true" : "false", text: title });
    var body = el("div", { class: "sdp-coll-body" });
    if (!open) body.hidden = true;
    head.addEventListener("click", function () { setOpen(body.hidden); });
    function setOpen(o) { body.hidden = !o; head.setAttribute("aria-expanded", o ? "true" : "false"); box.classList.toggle("is-open", o); }
    box.appendChild(head); box.appendChild(body);
    return { root: box, body: body, open: setOpen };
  }
  /* Settings that come from outside (share link, imported file) are checked one by one:
     unknown keys and out-of-range values are dropped, so the toolbar and the engine always agree. */
  function cleanSettings(src, into) {
    if (!src || typeof src !== "object") return into;
    function n(x) { x = +x; return typeof x === "number" && isFinite(x) ? x : null; }
    if (typeof src.profile === "string" && Object.prototype.hasOwnProperty.call(ENG.PROFILES, src.profile)) into.profile = src.profile;
    if (typeof src.chaos === "string" && Object.prototype.hasOwnProperty.call(ENG.CHAOS, src.chaos)) into.chaos = src.chaos;
    if (n(src.targetRps) !== null) into.targetRps = clamp(n(src.targetRps), 1, 2e6);
    if (n(src.readRatio) !== null) into.readRatio = clamp(n(src.readRatio), 0, 1);
    if (n(src.seed) !== null) into.seed = clamp(Math.floor(n(src.seed)), 1, 4294967295);
    if (n(src.spikeFactor) !== null) into.spikeFactor = clamp(n(src.spikeFactor), 1, 100);
    return into;
  }
  function niceRound(x) { if (x >= 100) return Math.round(x); if (x >= 10) return Math.round(x * 10) / 10; return Math.round(x * 100) / 100; }

  /* ═══════════════════════ Playground instance ═══════════════════════ */

  function Playground(root) {
    this.root = root;
    this.uid = "sdp" + (++counter);
    var ds = root.dataset;
    this.mode = ds.mode === "compact" ? "compact" : "full";
    this.full = this.mode === "full";
    this.height = parseInt(ds.height, 10) || (this.full ? 640 : 460);
    this.scenario = SCN.get(ds.scenario || "blank") || SCN.get("blank");
    this.attrs = { profile: ds.profile, seed: ds.seed, chaos: ds.chaos };
    this.view = { x: 0, y: 0, k: 1 };
    this.sel = null;
    this.undoStack = []; this.redoStack = [];
    this.running = false; this.speed = 5; this.acc = 0; this.last = 0; this.visible = true;
    this.phase = 0; this.connectFrom = null;
    this.tab = "metrics";
    this.lastUi = 0; this.lastChart = 0; this.logLen = -1;
    this.loadScenario(this.scenario, true);
    this.build();
    this.newSim();
    this.renderGraph();
    this.fit();
    this.renderSide();
    this.updateLive(true);
    var self = this;
    this.raf = requestAnimationFrame(function (ts) { self.loop(ts); });
  }

  var P = Playground.prototype;

  /* ─── Scenario, design and settings ─── */
  P.loadScenario = function (sc, first) {
    this.scenario = sc;
    var s = sc.settings || {};
    this.settings = {
      profile: (first && this.attrs.profile && Object.prototype.hasOwnProperty.call(ENG.PROFILES, this.attrs.profile)) ? this.attrs.profile : s.profile || "load",
      targetRps: s.targetRps || 100, readRatio: s.readRatio !== undefined ? s.readRatio : 0.9,
      seed: first && this.attrs.seed ? Math.max(1, parseInt(this.attrs.seed, 10) || 42) : s.seed || 42,
      chaos: (first && this.attrs.chaos && Object.prototype.hasOwnProperty.call(ENG.CHAOS, this.attrs.chaos)) ? this.attrs.chaos : s.chaos || "off",
      spikeFactor: s.spikeFactor || 5
    };
    this.god = sc.godMode !== false;
    this.restored = false;
    var design = null;
    /* a share link (#sdp=…) restores into the first full instance; each link only once, so that
       instant navigation back to the page does not overwrite later edits */
    if (first && this.full && location.hash.indexOf("#sdp=") === 0 && Playground.hashUsed !== location.hash) {
      Playground.hashUsed = location.hash;
      try {
        var data = JSON.parse(b64d(location.hash.slice(5)));
        if (data && typeof data === "object") {
          if (typeof data.s === "string" && SCN.get(data.s)) { this.scenario = sc = SCN.get(data.s); this.god = sc.godMode !== false; }
          if (data.d && typeof data.d === "object" && Array.isArray(data.d.nodes)) design = data.d;
          cleanSettings(data.st, this.settings);
        }
      } catch (e) { design = null; }
    }
    if (!design && this.full) {
      var saved = store("sdp:v1:" + sc.id);
      if (saved) { try { design = JSON.parse(saved); this.restored = !!(design && Array.isArray(design.nodes)); if (!this.restored) design = null; } catch (e) { design = null; } }
    }
    this.design = ENG.normalizeDesign(design || SCN.clone(sc.design));
    this.undoStack = []; this.redoStack = [];
    this.sel = null;
  };

  P.newSim = function () {
    this.sim = ENG.create(this.design, this.settings, { scenario: this.scenario });
    this.running = false;
    this.acc = 0;
    this.logLen = -1;
    this.reportShown = false;
    this.updatePlayButton();
  };

  /* Every design change goes through here: undo stack, autosave, live sim.
     keepSide: do not rebuild the inspector (a parameter slider being dragged must stay in the DOM). */
  P.commit = function (before, keepSel, keepSide) {
    if (before) { this.undoStack.push(before); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; }
    this.design = ENG.normalizeDesign(this.design);
    if (this.full) store("sdp:v1:" + this.scenario.id, JSON.stringify(this.design));
    this.sim.setDesign(this.design);
    if (!keepSel && this.sel && !this.findSel(this.sel)) this.sel = null;
    this.renderGraph();
    if (keepSide) this.updateInspectorLive(); else this.renderSide();
    this.updateLive(true);
  };
  /* One undo step per parameter gesture: consecutive changes of the same parameter within 1.5 s
     (a slider drag, arrow keys) share the snapshot taken before the first one. */
  P.editSnapshot = function (key) {
    var now = Date.now(), same = this.lastEdit && this.lastEdit.k === key && now - this.lastEdit.t < 1500;
    this.lastEdit = { k: key, t: now };
    return same ? null : this.snapshot();
  };
  P.snapshot = function () { return JSON.stringify(this.design); };
  P.undo = function () {
    if (!this.undoStack.length) return;
    this.lastEdit = null;
    this.redoStack.push(this.snapshot());
    this.design = JSON.parse(this.undoStack.pop());
    this.commit(null);
  };
  P.redo = function () {
    if (!this.redoStack.length) return;
    this.lastEdit = null;
    this.undoStack.push(this.snapshot());
    this.design = JSON.parse(this.redoStack.pop());
    this.commit(null);
  };
  P.node = function (id) { for (var i = 0; i < this.design.nodes.length; i++) if (this.design.nodes[i].id === id) return this.design.nodes[i]; return null; };
  P.edge = function (id) { for (var i = 0; i < this.design.edges.length; i++) if (this.design.edges[i].id === id) return this.design.edges[i]; return null; };
  P.frame = function (id) { for (var i = 0; i < this.design.frames.length; i++) if (this.design.frames[i].id === id) return this.design.frames[i]; return null; };
  P.findSel = function (s) { return s.kind === "node" ? this.node(s.id) : s.kind === "edge" ? this.edge(s.id) : this.frame(s.id); };
  P.newId = function (prefix) {
    var used = {}, i = 1;
    this.design.nodes.concat(this.design.frames, this.design.edges).forEach(function (x) { used[x.id] = 1; });
    while (used[prefix + i]) i++;
    return prefix + i;
  };

  /* ─── Build the DOM ─── */
  P.build = function () {
    var root = this.root, self = this;
    root.innerHTML = "";
    root.classList.add("sdp", "sdp--" + this.mode);
    root.setAttribute("data-sdp-ready", "1");
    root.setAttribute("tabindex", "0");
    root.setAttribute("role", "application");
    root.setAttribute("aria-label", "System Design Playground: " + tx(this.scenario.title));
    root.style.setProperty("--sdp-h", this.height + "px");

    this.toolbar = el("div", { class: "sdp-toolbar", role: "toolbar" });
    root.appendChild(this.toolbar);
    this.buildToolbar();

    var body = el("div", { class: "sdp-body" });
    root.appendChild(body);
    if (this.full) { this.palette = el("div", { class: "sdp-palette" }); body.appendChild(this.palette); this.buildPalette(); }
    this.stage = el("div", { class: "sdp-stage" });
    body.appendChild(this.stage);
    this.buildStage();
    this.inspector = el("div", { class: "sdp-inspector", "aria-live": "polite" });
    if (this.full) body.appendChild(this.inspector); else this.stage.appendChild(this.inspector);

    this.bottom = el("div", { class: "sdp-bottom" });
    root.appendChild(this.bottom);
    this.buildBottom();

    root.addEventListener("keydown", function (ev) { self.onKey(ev); });
    this.io = new IntersectionObserver(function (entries) { entries.forEach(function (en) { self.visible = en.isIntersecting; }); });
    this.io.observe(root);
    /* The stage gets its final size only after the page layout settles (fonts, the full-width
       page rule, a tab or admonition that opens later): refit while the user has not moved the view. */
    if (window.ResizeObserver) {
      this.stageW = 0; this.stageH = 0;
      this.ro = new ResizeObserver(function () {
        var r = self.stage.getBoundingClientRect();
        if (!r.width || !r.height || (Math.abs(r.width - self.stageW) < 1 && Math.abs(r.height - self.stageH) < 1)) return;
        self.stageW = r.width; self.stageH = r.height;
        if (!self.userView) self.fit();
        self.drawCharts();
      });
      this.ro.observe(this.stage);
    }
  };

  P.buildToolbar = function () {
    var tb = this.toolbar, self = this, s = this.settings;
    tb.innerHTML = "";
    function btn(name, title, fn, cls) {
      var b = el("button", { type: "button", class: "sdp-btn " + (cls || ""), title: title, "aria-label": title }, icon(name));
      b.addEventListener("click", fn);
      return b;
    }
    function group(cls) { var g = el("div", { class: "sdp-group " + (cls || "") }); tb.appendChild(g); return g; }
    function labelled(text, ctl) { var l = el("label", { class: "sdp-field" }); l.appendChild(el("span", { text: text })); l.appendChild(ctl); return l; }

    if (this.full) {
      var g0 = group("sdp-g-scn");
      var sel = el("select", { class: "sdp-scn", "aria-label": t("scenario") });
      SCN.LIST.forEach(function (sc) { var o = el("option", { value: sc.id, text: tx(sc.title) }); if (sc.id === self.scenario.id) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", function () { self.switchScenario(sel.value); });
      g0.appendChild(labelled(t("scenario"), sel));
    }

    var g1 = group("sdp-g-run");
    this.playBtn = btn("play", t("play"), function () { self.toggleRun(); }, "sdp-play");
    g1.appendChild(this.playBtn);
    g1.appendChild(btn("step", t("step"), function () { self.stepOnce(); }));
    g1.appendChild(btn("reset", t("reset"), function () { self.newSim(); self.updateLive(true); self.renderSide(); }));
    var sp = el("select", { class: "sdp-speed", "aria-label": t("speed"), title: t("speed") });
    [1, 5, 20, 100].forEach(function (v) { var o = el("option", { value: v, text: v + "×" }); if (v === self.speed) o.selected = true; sp.appendChild(o); });
    sp.addEventListener("change", function () { self.speed = +sp.value; });
    g1.appendChild(sp);
    this.clock = el("span", { class: "sdp-clock", "aria-live": "off" });
    g1.appendChild(this.clock);

    var g2 = group("sdp-g-load");
    var prof = el("select", { "aria-label": t("profile") });
    Object.keys(ENG.PROFILES).forEach(function (k) { var o = el("option", { value: k, text: k, title: tx(PROFILE_LABEL[k]) }); if (k === s.profile) o.selected = true; prof.appendChild(o); });
    prof.title = tx(PROFILE_LABEL[s.profile]);
    prof.addEventListener("change", function () { s.profile = prof.value; prof.title = tx(PROFILE_LABEL[s.profile]); self.newSim(); self.updateLive(true); self.renderSide(); });
    g2.appendChild(labelled(t("profile"), prof));

    var rpsWrap = el("span", { class: "sdp-rps" });
    var rpsR = el("input", { type: "range", min: 0, max: 1000, step: 1, "aria-label": t("target") });
    var rpsN = el("input", { type: "number", min: 1, max: 2000000, step: "any", "aria-label": t("target") });
    rpsR.value = toLog(s.targetRps, 1, 2e6); rpsN.value = s.targetRps;
    rpsR.addEventListener("input", function () { var v = niceRound(fromLog(+rpsR.value, 1, 2e6)); rpsN.value = v; self.setLive({ targetRps: v }); });
    rpsN.addEventListener("change", function () { var v = clamp(+rpsN.value || 1, 1, 2e6); rpsN.value = v; rpsR.value = toLog(v, 1, 2e6); self.setLive({ targetRps: v }); });
    rpsWrap.appendChild(rpsR); rpsWrap.appendChild(rpsN);
    g2.appendChild(labelled(t("target"), rpsWrap));
    var rd = el("input", { type: "number", min: 0, max: 100, step: 1, class: "sdp-num-s", "aria-label": t("read") });
    rd.value = Math.round(s.readRatio * 100);
    rd.addEventListener("change", function () { var v = clamp(+rd.value, 0, 100); rd.value = v; self.setLive({ readRatio: v / 100 }); });
    g2.appendChild(labelled(t("read"), rd));

    var g3 = group("sdp-g-rand");
    var seed = el("input", { type: "number", min: 1, step: 1, class: "sdp-num-m", "aria-label": t("seed") });
    seed.value = s.seed;
    seed.addEventListener("change", function () { s.seed = Math.max(1, parseInt(seed.value, 10) || 1); seed.value = s.seed; self.newSim(); self.updateLive(true); self.renderSide(); });
    g3.appendChild(labelled(t("seed"), seed));
    g3.appendChild(btn("dice", t("newSeed"), function () { s.seed = RNG.newSeed(); seed.value = s.seed; self.newSim(); self.updateLive(true); self.renderSide(); }));
    var ch = el("select", { "aria-label": t("chaos") });
    Object.keys(ENG.CHAOS).forEach(function (k) { var o = el("option", { value: k, text: tx(CHAOS_LABEL[k]) }); if (k === s.chaos) o.selected = true; ch.appendChild(o); });
    ch.addEventListener("change", function () { self.setLive({ chaos: ch.value }); });
    g3.appendChild(labelled(t("chaos"), ch));
    g3.appendChild(btn("zap", t("inject"), function (ev) { self.toggleInject(ev.currentTarget); }));

    var g4 = group("sdp-g-tools");
    if (this.full) {
      g4.appendChild(btn("undo", t("undo"), function () { self.undo(); }));
      g4.appendChild(btn("redo", t("redo"), function () { self.redo(); }));
      g4.appendChild(btn("download", t("exportJson"), function () { self.exportJson(); }));
      var file = el("input", { type: "file", accept: ".json,application/json", class: "sdp-file", tabindex: "-1", "aria-hidden": "true" });
      file.addEventListener("change", function () { if (file.files[0]) self.importJson(file.files[0]); file.value = ""; });
      g4.appendChild(file);
      g4.appendChild(btn("upload", t("importJson"), function () { file.click(); }));
      g4.appendChild(btn("link", t("share"), function () { self.share(); }));
      g4.appendChild(btn("mermaid", t("mermaid"), function () { self.copyMermaid(); }));
    }
    this.godBtn = btn("eye", t("god"), function () { self.god = !self.god; self.godBtn.setAttribute("aria-pressed", self.god); self.updateLive(true); self.renderSide(); });
    this.godBtn.setAttribute("aria-pressed", this.god);
    g4.appendChild(this.godBtn);
    if (this.full) {
      g4.appendChild(btn("full", t("fullscreen"), function () { self.toggleFullscreen(); }));
      g4.appendChild(btn("help", t("help"), function () { self.toggleHelp(); }));
    } else {
      var a = el("a", { class: "sdp-btn sdp-open", title: t("openFull"), "aria-label": t("openFull"), target: "_blank", rel: "noopener" }, icon("open"));
      var setHref = function () { a.href = self.fullUrl(); };
      a.addEventListener("click", setHref); a.addEventListener("pointerdown", setHref); a.addEventListener("focus", setHref);
      a.href = this.fullUrlBase();
      g4.appendChild(a);
    }
    this.tb = { rpsR: rpsR, rpsN: rpsN, rd: rd, seed: seed, ch: ch, prof: prof };
  };

  P.buildPalette = function () {
    var pal = this.palette, self = this;
    pal.innerHTML = "";
    pal.appendChild(el("div", { class: "sdp-pal-title", text: t("palette") }));
    var search = el("input", { type: "search", class: "sdp-pal-search", placeholder: t("search"), "aria-label": t("search") });
    pal.appendChild(search);
    var list = el("div", { class: "sdp-pal-list" });
    pal.appendChild(list);
    CAT.CATEGORIES.forEach(function (cat) {
      var coll = collapsible("sdp-pal-cat sdp-cat-" + cat.id, tx(cat.label), true), det = coll.body;
      coll.root.sdpOpen = coll.open;
      CAT.LIST.filter(function (c) { return c.cat === cat.id; }).forEach(function (c) {
        var item = el("div", { class: "sdp-pal-item sdp-cat-" + cat.id, draggable: "true", "data-type": c.id, title: tx(c.desc) });
        item.innerHTML = '<span class="sdp-pal-glyph">' + glyph(c.id, 16) + '</span><span class="sdp-pal-label">' + esc(c.label) + "</span>";
        var add = el("button", { type: "button", class: "sdp-pal-add", title: t("add") + " " + c.label, "aria-label": t("add") + " " + c.label }, icon("plus", 14));
        add.addEventListener("click", function () { self.addAtCenter(c.id); });
        item.appendChild(add);
        item.addEventListener("dblclick", function () { self.addAtCenter(c.id); });
        item.addEventListener("dragstart", function (ev) { ev.dataTransfer.setData("text/sdp-type", c.id); ev.dataTransfer.setData("text/plain", c.id); ev.dataTransfer.effectAllowed = "copy"; });
        det.appendChild(item);
      });
      list.appendChild(coll.root);
    });
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      list.querySelectorAll(".sdp-pal-item").forEach(function (it) {
        var c = CAT.get(it.getAttribute("data-type"));
        var hit = !q || c.label.toLowerCase().indexOf(q) >= 0 || c.id.indexOf(q) >= 0 || tx(c.desc).toLowerCase().indexOf(q) >= 0;
        it.style.display = hit ? "" : "none";
      });
      list.querySelectorAll(".sdp-pal-cat").forEach(function (d) { if (q) d.sdpOpen(true); });
    });
  };

  P.buildStage = function () {
    var st = this.stage, self = this, u = this.uid;
    var s = svg("svg", { class: "sdp-svg", role: "group", "aria-label": tx(this.scenario.title) });
    s.innerHTML =
      "<defs>" +
      '<pattern id="' + u + '-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" class="sdp-grid-minor" fill="none"/></pattern>' +
      '<pattern id="' + u + '-grid5" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#' + u + '-grid)"/><path d="M100 0H0V100" class="sdp-grid-major" fill="none"/></pattern>' +
      '<pattern id="' + u + '-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" class="sdp-hatch"/></pattern>' +
      '<marker id="' + u + '-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="sdp-arrow"/></marker>' +
      '<marker id="' + u + '-arrow-err" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="sdp-arrow-err"/></marker>' +
      '<marker id="' + u + '-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="sdp-arrow-sel"/></marker>' +
      "</defs>";
    this.bg = svg("rect", { class: "sdp-bg", x: 0, y: 0, width: "100%", height: "100%", fill: "url(#" + u + "-grid5)" });
    s.appendChild(this.bg);
    this.vp = svg("g", { class: "sdp-vp" });
    this.gFrames = svg("g", { class: "sdp-frames" });
    this.gEdges = svg("g", { class: "sdp-edges" });
    this.gDots = svg("g", { class: "sdp-dots" });
    this.gNodes = svg("g", { class: "sdp-nodes" });
    this.temp = svg("path", { class: "sdp-temp", d: "" });
    [this.gFrames, this.gEdges, this.gDots, this.gNodes, this.temp].forEach(function (g) { self.vp.appendChild(g); });
    s.appendChild(this.vp);
    this.svg = s;
    st.appendChild(s);

    var zoom = el("div", { class: "sdp-zoom" });
    [["plus", t("zoomIn"), function () { self.zoomBy(1.2); }], ["minus", t("zoomOut"), function () { self.zoomBy(1 / 1.2); }], ["fit", t("fit"), function () { self.fit(); }]].forEach(function (z) {
      var b = el("button", { type: "button", class: "sdp-btn", title: z[1], "aria-label": z[1] }, icon(z[0], 14));
      b.addEventListener("click", z[2]);
      zoom.appendChild(b);
    });
    st.appendChild(zoom);
    this.empty = el("div", { class: "sdp-empty", text: t("empty") });
    st.appendChild(this.empty);
    this.toast = el("div", { class: "sdp-toast", role: "status" });
    st.appendChild(this.toast);
    this.tip = el("div", { class: "sdp-tip" });
    st.appendChild(this.tip);
    this.goalBar = el("div", { class: "sdp-goalbar" });
    if (!this.full) st.appendChild(this.goalBar);

    s.addEventListener("pointerdown", function (ev) { self.onPointerDown(ev); });
    s.addEventListener("pointermove", function (ev) { self.onPointerMove(ev); });
    s.addEventListener("pointerup", function (ev) { self.onPointerUp(ev); });
    s.addEventListener("pointercancel", function () {   // e.g. the browser took over a touch to scroll the page
      var d = self.drag;
      self.drag = null;
      self.temp.setAttribute("d", "");
      if (d && d.moved && (d.kind === "node" || d.kind === "frame" || d.kind === "resize")) self.commit(d.before, true);
    });
    s.addEventListener("wheel", function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;    // plain wheel scrolls the page
      ev.preventDefault();
      self.zoomBy(Math.exp(-ev.deltaY * 0.0015), ev);
    }, { passive: false });
    s.addEventListener("dblclick", function (ev) { if (ev.target === self.bg) self.fit(); });
    s.addEventListener("pointerover", function (ev) { self.onHover(ev); });
    s.addEventListener("pointerout", function () { self.tip.style.display = "none"; });
    if (this.full) {
      st.addEventListener("dragover", function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; });
      st.addEventListener("drop", function (ev) {
        ev.preventDefault();
        var type = ev.dataTransfer.getData("text/sdp-type") || ev.dataTransfer.getData("text/plain");
        if (!CAT.get(type)) return;
        var p = self.toWorld(ev);
        self.addComponent(type, p.x, p.y);
      });
    }
  };

  P.buildBottom = function () {
    var b = this.bottom, self = this;
    b.innerHTML = "";
    this.tiles = el("div", { class: "sdp-tiles" });
    var defs = [["offered", t("offered")], ["served", t("served")], ["p50", t("p50")], ["p99", t("p99")], ["errors", t("errors")], ["availability", t("availability")], ["cost", t("cost")]];
    this.tileEls = {};
    defs.forEach(function (d) {
      var tl = el("div", { class: "sdp-tile sdp-tile-" + d[0] });
      tl.innerHTML = '<span class="sdp-tile-k">' + esc(d[1]) + (d[0] === "cost" ? ' <small>(' + esc(t("costNote")) + ")</small>" : "") + '</span><span class="sdp-tile-v">—</span>';
      self.tiles.appendChild(tl);
      self.tileEls[d[0]] = tl.querySelector(".sdp-tile-v");
    });
    if (!this.full) {
      b.appendChild(this.tiles);
      this.charts = [this.makeChart("rps", t("rps"))];
      var cw = el("div", { class: "sdp-charts sdp-charts-1" });
      cw.appendChild(this.charts[0].wrap);
      b.appendChild(cw);
      return;
    }
    var tabs = el("div", { class: "sdp-tabs", role: "tablist" });
    this.panels = {};
    this.tabBtns = {};
    ["metrics", "events", "report", "trace"].forEach(function (k) {
      var tb = el("button", { type: "button", role: "tab", class: "sdp-tab", "aria-selected": k === self.tab ? "true" : "false", id: self.uid + "-tab-" + k, "aria-controls": self.uid + "-panel-" + k, text: t(k) });
      tb.addEventListener("click", function () { self.showTab(k); });
      tabs.appendChild(tb);
      self.tabBtns[k] = tb;
      var p = el("div", { class: "sdp-panel sdp-panel-" + k, role: "tabpanel", id: self.uid + "-panel-" + k, "aria-labelledby": self.uid + "-tab-" + k });
      if (k !== self.tab) p.hidden = true;
      self.panels[k] = p;
    });
    b.appendChild(tabs);
    for (var k in this.panels) b.appendChild(this.panels[k]);
    this.panels.metrics.appendChild(this.tiles);
    this.charts = [this.makeChart("rps", t("rps")), this.makeChart("lat", t("latency")), this.makeChart("err", t("errRate"))];
    var cw2 = el("div", { class: "sdp-charts" });
    this.charts.forEach(function (c) { cw2.appendChild(c.wrap); });
    this.panels.metrics.appendChild(cw2);
  };

  P.showTab = function (k) {
    this.tab = k;
    for (var x in this.panels) { this.panels[x].hidden = x !== k; this.tabBtns[x].setAttribute("aria-selected", x === k ? "true" : "false"); }
    if (k === "report") this.renderReport();
    if (k === "trace") this.renderTrace();
    if (k === "events") { this.logLen = -1; this.renderEvents(); }
    if (k === "metrics") this.drawCharts();
  };

  /* ─── Canvas geometry ─── */
  P.toWorld = function (ev) {
    var r = this.svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left - this.view.x) / this.view.k, y: (ev.clientY - r.top - this.view.y) / this.view.k };
  };
  P.applyView = function () {
    var v = this.view;
    this.vp.setAttribute("transform", "translate(" + v.x + "," + v.y + ") scale(" + v.k + ")");
    var gp = this.svg.querySelector("#" + this.uid + "-grid5");
    if (gp) gp.setAttribute("patternTransform", "translate(" + v.x + "," + v.y + ") scale(" + v.k + ")");
  };
  P.zoomBy = function (f, ev) {
    var r = this.svg.getBoundingClientRect(), v = this.view;
    var cx = ev ? ev.clientX - r.left : r.width / 2, cy = ev ? ev.clientY - r.top : r.height / 2;
    var k = clamp(v.k * f, 0.25, 2.5);
    this.userView = true;
    v.x = cx - (cx - v.x) * k / v.k; v.y = cy - (cy - v.y) * k / v.k; v.k = k;
    this.applyView();
  };
  P.fit = function () {
    var d = this.design, r = this.svg.getBoundingClientRect();
    this.userView = false;
    var w = r.width || 800, h = r.height || this.height;
    if (!d.nodes.length && !d.frames.length) { this.view = { x: w / 2 - 300, y: h / 2 - 200, k: 1 }; this.applyView(); return; }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    d.nodes.forEach(function (n) { x0 = Math.min(x0, n.x - W / 2); y0 = Math.min(y0, n.y - H / 2); x1 = Math.max(x1, n.x + W / 2 + 10); y1 = Math.max(y1, n.y + H / 2); });
    d.frames.forEach(function (f) { x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); });
    var pad = 30, k = clamp(Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0)), 0.3, 1.25);
    this.view = { k: k, x: (w - (x1 - x0) * k) / 2 - x0 * k, y: (h - (y1 - y0) * k) / 2 - y0 * k };
    this.applyView();
  };

  function edgePath(a, b) {
    var x1 = a.x + W / 2, y1 = a.y, x2 = b.x - W / 2 - 3, y2 = b.y;
    if (x2 < x1 + 20) {   // target to the left: leave from the bottom, enter from the top
      if (Math.abs(b.y - a.y) > H) {
        var down = b.y > a.y;
        x1 = a.x; y1 = a.y + (down ? H / 2 : -H / 2); x2 = b.x; y2 = b.y + (down ? -H / 2 - 3 : H / 2 + 3);
        var dy = Math.max(40, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
        return { p: [x1, y1, x1, y1 + dy, x2, y2 - dy, x2, y2] };
      }
    }
    var dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return { p: [x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2] };
  }
  function bez(p, s) {
    var u = 1 - s;
    return [u * u * u * p[0] + 3 * u * u * s * p[2] + 3 * u * s * s * p[4] + s * s * s * p[6], u * u * u * p[1] + 3 * u * u * s * p[3] + 3 * u * s * s * p[5] + s * s * s * p[7]];
  }
  function pathD(p) { return "M" + p[0] + " " + p[1] + "C" + p[2] + " " + p[3] + " " + p[4] + " " + p[5] + " " + p[6] + " " + p[7]; }

  /* ─── Render the design (structure) ─── */
  P.renderGraph = function () {
    var self = this, d = this.design, u = this.uid;
    // The graph is rebuilt from scratch: if keyboard focus was on (or inside) the canvas — e.g. on the
    // block just clicked — it would fall back to <body> and Delete/Backspace, D, C… would no longer reach
    // this instance. Remember it and give it back after the rebuild (see restoreFocus below).
    var act = document.activeElement, hadFocus = !!(act && this.svg && this.svg.contains(act));
    var focusId = hadFocus && act.getAttribute ? act.getAttribute("data-node") : null;
    this.gFrames.innerHTML = ""; this.gEdges.innerHTML = ""; this.gDots.innerHTML = ""; this.gNodes.innerHTML = "";
    this.nodeEls = {}; this.edgeEls = {};
    this.empty.style.display = d.nodes.length || d.frames.length ? "none" : "";

    this.frameEls = {};
    d.frames.forEach(function (f) {
      var g = svg("g", { class: "sdp-frame sdp-frame-" + f.type + (f.type === "k8s" ? " sdp-cat-containers" : "") + (self.isSel("frame", f.id) ? " is-sel" : ""), "data-frame": f.id });
      g.appendChild(svg("rect", { class: "sdp-frame-box", x: f.x, y: f.y, width: f.w, height: f.h, rx: 10 }));
      g.appendChild(svg("rect", { class: "sdp-frame-bar", x: f.x, y: f.y, width: f.w, height: 22, rx: 10 }));
      var tl = svg("text", { class: "sdp-frame-label", x: f.x + 10, y: f.y + 15 });
      if (f.type === "k8s") tl.textContent = "Kubernetes" + (f.name ? " · " + f.name : "");
      else tl.textContent = (f.type === "vpc" ? "VPC · " + (f.region || f.name) : "subnet · AZ " + (f.zone || f.name)) + (f.name && f.name !== f.region && f.name !== f.zone ? " — " + f.name : "");
      g.appendChild(tl);
      if (f.type === "k8s") {
        /* live line (nodes, pods, Pending), right-aligned in the title bar */
        var info = svg("text", { class: "sdp-frame-info", x: f.x + f.w - 10, y: f.y + 15, "text-anchor": "end" });
        g.appendChild(info);
        self.frameEls[f.id] = { info: info, w: f.w };
      }
      if (self.full) g.appendChild(svg("path", { class: "sdp-frame-resize", d: "M" + (f.x + f.w - 14) + " " + (f.y + f.h - 3) + "L" + (f.x + f.w - 3) + " " + (f.y + f.h - 14) + "M" + (f.x + f.w - 8) + " " + (f.y + f.h - 3) + "L" + (f.x + f.w - 3) + " " + (f.y + f.h - 8), "data-resize": f.id }));
      self.gFrames.appendChild(g);
    });

    var byId = {};
    d.nodes.forEach(function (n) { byId[n.id] = n; });
    d.edges.forEach(function (e) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b) return;
      var geo = edgePath(a, b), side = CAT.get(a.type).role === "side" || CAT.get(b.type).role === "side";
      var async = CAT.get(b.type).role === "msg" || (e.params && e.params.async);
      var g = svg("g", { class: "sdp-edge" + (side ? " is-side" : "") + (async ? " is-async" : "") + (self.isSel("edge", e.id) ? " is-sel" : ""), "data-edge": e.id });
      var hit = svg("path", { class: "sdp-edge-hit", d: pathD(geo.p) });
      var line = svg("path", { class: "sdp-edge-line", d: pathD(geo.p), "marker-end": "url(#" + u + (self.isSel("edge", e.id) ? "-arrow-sel" : "-arrow") + ")" });
      var err = svg("path", { class: "sdp-edge-err", d: pathD(geo.p) });
      var mid = bez(geo.p, 0.5);
      var lbl = svg("text", { class: "sdp-edge-label", x: mid[0], y: mid[1] - 6, "text-anchor": "middle" });
      g.appendChild(hit); g.appendChild(line); g.appendChild(err); g.appendChild(lbl);
      self.gEdges.appendChild(g);
      var dots = [];
      if (!side && !reduceMotion) for (var i = 0; i < 8; i++) { var c = svg("circle", { class: "sdp-dot", r: 2.6, cx: -9999, cy: -9999 }); self.gDots.appendChild(c); dots.push(c); }
      self.edgeEls[e.id] = { g: g, line: line, err: err, lbl: lbl, p: geo.p, dots: dots, side: side };
    });

    d.nodes.forEach(function (n) {
      var c = CAT.get(n.type);
      var g = svg("g", { class: "sdp-node sdp-cat-" + c.cat + (self.isSel("node", n.id) ? " is-sel" : "") + (self.connectFrom === n.id ? " is-connect" : ""), "data-node": n.id, transform: "translate(" + (n.x - W / 2) + "," + (n.y - H / 2) + ")", tabindex: "0", role: "button", "aria-label": (hasLabel(n, c) ? n.label + " (" + c.label + ")" : c.label) });
      g.appendChild(svg("rect", { class: "sdp-node-box", width: W, height: H, rx: 8 }));
      g.appendChild(svg("rect", { class: "sdp-node-stripe", width: 4, height: H - 12, x: 3, y: 6, rx: 2 }));
      var gl = svg("g", { class: "sdp-node-glyph", transform: "translate(12,9)" });
      gl.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + c.glyph + "</svg>";
      g.appendChild(gl);
      // three fixed lines: the name given in the design, the component type (never replaced by
      // live numbers; omitted when it equals the name) and the live metrics
      var label = svg("text", { class: "sdp-node-label", x: 38, y: 20 });
      var name = String(nameOf(n, c));
      label.textContent = name.length > 17 ? name.slice(0, 16) + "…" : name;
      g.appendChild(label);
      var type = svg("text", { class: "sdp-node-type", x: 38, y: 34 });
      type.textContent = hasLabel(n, c) ? c.label : "";
      g.appendChild(type);
      /* Pods of a Kubernetes cluster that could not be scheduled */
      var pend = svg("text", { class: "sdp-node-pending", x: W - 8, y: 34, "text-anchor": "end" });
      g.appendChild(pend);
      var sub = svg("text", { class: "sdp-node-sub", x: 12, y: 50 });
      g.appendChild(sub);
      var badge = svg("text", { class: "sdp-node-badge", x: W - 8, y: 15, "text-anchor": "end" });
      g.appendChild(badge);
      var barBg = svg("rect", { class: "sdp-bar-bg", x: 12, y: H - 9, width: W - 24, height: 4, rx: 2 });
      var bar = svg("rect", { class: "sdp-bar", x: 12, y: H - 9, width: 0, height: 4, rx: 2 });
      g.appendChild(barBg); g.appendChild(bar);
      var hatch = svg("rect", { class: "sdp-node-down", width: W, height: H, rx: 8, fill: "url(#" + u + "-hatch)" });
      g.appendChild(hatch);
      if (self.full && c.role !== "frame") g.appendChild(svg("circle", { class: "sdp-handle", cx: W, cy: H / 2, r: 6, "data-handle": n.id }));
      var title = svg("title");
      title.textContent = (hasLabel(n, c) ? n.label + " — " : "") + c.label + ": " + tx(c.desc);
      g.appendChild(title);
      self.gNodes.appendChild(g);
      self.nodeEls[n.id] = { g: g, sub: sub, badge: badge, bar: bar, barBg: barBg, pend: pend, def: c, n: n };
    });
    this.applyView();
    if (hadFocus) this.restoreFocus(focusId);
  };

  P.focusNode = function (id) { var ne = this.nodeEls && this.nodeEls[id]; if (ne && ne.g.focus) ne.g.focus(); };
  P.restoreFocus = function (id) {
    var ne = id && this.nodeEls && this.nodeEls[id];
    try {
      if (ne && ne.g.focus) ne.g.focus({ preventScroll: true });
      else this.root.focus({ preventScroll: true });
    } catch (e) { /* old browsers: focus without options */ if (ne && ne.g.focus) ne.g.focus(); else this.root.focus(); }
  };
  P.isSel = function (kind, id) { return !!this.sel && this.sel.kind === kind && this.sel.id === id; };

  /* ─── Per-frame live update of the canvas ─── */
  P.updateLive = function (force) {
    var sim = this.sim, self = this;
    var running = this.running && this.visible;
    for (var id in this.nodeEls) {
      var ne = this.nodeEls[id], v = sim.nodeView(id), def = ne.def;
      if (!v) continue;
      var observed = this.god || v.observed || def.role === "source";
      var st = def.role === "side" || def.role === "source" ? "na" : v.status;
      if (!observed && st !== "down") st = "unk";
      var cls = "sdp-node sdp-cat-" + def.cat + " sdp-st-" + st + (this.isSel("node", id) ? " is-sel" : "") + (this.connectFrom === id ? " is-connect" : "");
      if (ne.g.getAttribute("class") !== cls) ne.g.setAttribute("class", cls);
      var rho = isFinite(v.rho) ? v.rho : 1;
      var text = "", badge = "";
      if (def.role === "source") text = sim.t > 0 ? fmtNum(v.lam) + " " + t("rps") : "";
      else if (def.role === "side") text = v.attached ? "↔ " + v.attached : "";
      else if (def.role === "msg") text = observed ? (v.backlog > 1 ? "backlog " + fmtNum(v.backlog) + " · " + fmtS(v.lag) : fmtNum(v.lam) + " " + t("rps")) : "ρ ? · " + fmtNum(v.lam) + " " + t("rps");
      else if (sim.t > 0 || force) text = observed ? "ρ " + dec(Math.min(rho, 9.99), 2) + " · " + fmtNum(v.proc) + " " + t("rps") : "ρ ? · " + t("rps") + " ?";
      if (st === "down") text = v.ready === 0 && v.unsched > 0 ? t("podsPending") : t("down").toUpperCase();
      var nn = ne.n;
      var pt = v.unsched > 0 ? v.unsched + " " + t("unsched") : "";
      if (ne.pend.textContent !== pt) ne.pend.textContent = pt;
      if (ne.sub.textContent !== text) ne.sub.textContent = text;
      if (def.role !== "source" && def.role !== "side" && def.role !== "msg") {
        if (nn.type === "sql") { var rr = (nn.params && nn.params.readReplicas) || 0; badge = rr ? "1+" + rr : ""; }
        else if (nn.type === "dbcluster") { var pp = CAT.params(nn); badge = (pp.shards > 1 ? pp.shards + "×" : "") + "1+" + pp.replicasPerShard; }
        else if (nn.type === "serverless") badge = v.instances ? "×" + Math.round(v.instances) : "λ";
        else if (v.ready > 1 || v.pending) badge = "×" + v.ready + (v.pending ? "+" + v.pending : "");
      } else if (nn.type === "kafka" || nn.type === "stream") badge = "P" + ((nn.params && nn.params.partitions) || def.d.partitions);
      if (ne.badge.textContent !== badge) ne.badge.textContent = badge;
      var bw = observed && def.role !== "side" && def.role !== "source" ? (W - 24) * clamp(rho, 0, 1) : 0;
      ne.bar.setAttribute("width", bw.toFixed(1));
    }
    for (var fid in this.frameEls) {
      var fe = this.frameEls[fid], cv = sim.clusterView(fid);
      if (!cv) continue;
      var ftxt = (LANG === "pt" ? "nós " : "nodes ") + cv.nodes + (cv.starting ? " (+" + cv.starting + ")" : "") + (cv.failed ? " · ✕" + cv.failed : "") +
        " · pods " + cv.scheduled + "/" + cv.capacity + (cv.pending ? " · " + cv.pending + " " + t("unsched") : "");
      if (fe.w < 300) ftxt = cv.scheduled + "/" + cv.capacity + (cv.pending ? " ·" + cv.pending + "⏳" : "");
      if (fe.info.textContent !== ftxt) fe.info.textContent = ftxt;
      var fcls = "sdp-frame-info" + (cv.pending ? " is-pending" : "");
      if (fe.info.getAttribute("class") !== fcls) fe.info.setAttribute("class", fcls);
    }
    var dt = this.frameDt || 0;
    if (running) this.phase += dt * 0.6;
    for (var eid in this.edgeEls) {
      var ee = this.edgeEls[eid];
      if (ee.side) continue;
      var ev = sim.edgeView(eid);
      if (!ev) continue;
      var errShare = ev.rate > 0 ? ev.errRate / ev.rate : 0;
      var ecls = "sdp-edge" + (ev.async ? " is-async" : "") + (this.isSel("edge", eid) ? " is-sel" : "") + (errShare > 0.05 || ev.part ? " is-err" : "") + (ev.cb === "open" ? " is-open" : "") + (ev.rate > 0 ? " is-live" : "");
      if (ee.g.getAttribute("class") !== ecls) {
        ee.g.setAttribute("class", ecls);
        ee.line.setAttribute("marker-end", "url(#" + this.uid + (this.isSel("edge", eid) ? "-arrow-sel" : errShare > 0.05 ? "-arrow-err" : "-arrow") + ")");
      }
      ee.err.style.opacity = clamp(errShare * 1.5, 0, 1).toFixed(2);
      var lbl = ev.part ? "✕ " + (LANG === "pt" ? "partição" : "partition") : ev.cb === "open" ? "CB " + t("cbOpen") : ev.lag > 1 ? fmtS(ev.lag) : "";
      if (this.isSel("edge", eid) || this.hoverEdge === eid) lbl = fmtNum(ev.rate) + " " + t("rps") + (ev.retryRate > 0.5 ? " (" + fmtNum(ev.retryRate) + " retry)" : "") + (lbl ? " · " + lbl : "");
      if (ee.lbl.textContent !== lbl) ee.lbl.textContent = lbl;
      /* dots: density ∝ log(flow) */
      var nd = ev.rate > 0 ? clamp(Math.round(Math.log10(ev.rate + 1) * 2), 1, ee.dots.length) : 0;
      for (var i = 0; i < ee.dots.length; i++) {
        var dot = ee.dots[i];
        if (i >= nd || !(sim.t > 0)) { if (dot.getAttribute("cx") !== "-9999") { dot.setAttribute("cx", -9999); dot.setAttribute("cy", -9999); } continue; }
        var sp = ((this.phase + i / nd) % 1 + 1) % 1, pt = bez(ee.p, sp);
        dot.setAttribute("cx", pt[0].toFixed(1)); dot.setAttribute("cy", pt[1].toFixed(1));
        var bad = i < Math.round(nd * errShare);
        var dc = bad ? "sdp-dot is-bad" : "sdp-dot";
        if (dot.getAttribute("class") !== dc) dot.setAttribute("class", dc);
      }
    }
    this.clock.textContent = "t = " + Math.floor(sim.t) + " / " + Math.round(sim.duration) + " s" + (sim.done ? " ✓" : "");
  };

  /* ─── Metrics tiles, charts ─── */
  P.updateTiles = function () {
    var sim = this.sim, now = sim.now || { offered: 0, served: 0, errRate: 0, cost: 0 }, w = sim.windowPercentiles(), st = sim.stats();
    var S = sim.series, i = S.t.length - 1;
    var off = i >= 0 ? S.offered[i] : now.offered, srv = i >= 0 ? S.served[i] : now.served, er = i >= 0 ? S.errRate[i] : now.errRate;
    var te = this.tileEls;
    te.offered.textContent = fmtNum(off) + " " + t("rps");
    te.served.textContent = fmtNum(srv) + " " + t("rps");
    te.p50.textContent = fmtMs(w.p50);
    te.p99.textContent = fmtMs(w.p99);
    te.errors.textContent = fmtPct(er);
    te.errors.parentNode.classList.toggle("is-bad", er > 0.01);
    te.availability.textContent = sim.t > 0 ? dec(st.availability, st.availability > 99.9 ? 3 : 2) + "%" : "—";
    te.cost.textContent = fmtUsd(now.cost || 0);
  };

  P.makeChart = function (kind, title) {
    var wrap = el("div", { class: "sdp-chart" });
    var cap = el("div", { class: "sdp-chart-cap" });
    var legend = kind === "rps" ? '<i class="sdp-sw sdp-sw-a"></i>' + esc(t("offered")) + ' <i class="sdp-sw sdp-sw-b"></i>' + esc(t("served")) :
      kind === "lat" ? '<i class="sdp-sw sdp-sw-a"></i>p50 <i class="sdp-sw sdp-sw-b"></i>p99' : '<i class="sdp-sw sdp-sw-c"></i>' + esc(t("errRate"));
    cap.innerHTML = "<b>" + esc(title) + "</b> " + legend;
    var c = el("canvas", { role: "img", "aria-label": title });
    wrap.appendChild(cap); wrap.appendChild(c);
    return { kind: kind, wrap: wrap, canvas: c };
  };

  P.colors = function () {
    var cs = getComputedStyle(this.root);
    function v(n, d) { var x = cs.getPropertyValue(n).trim(); return x || d; }
    return { fg: v("--sdp-fg", "#333"), light: v("--sdp-fg-light", "#888"), grid: v("--sdp-line", "#ddd"), a: v("--sdp-c-a", "#3b82f6"), b: v("--sdp-c-b", "#16a34a"), c: v("--sdp-c-err", "#dc2626"), ev: v("--sdp-c-ev", "#a855f7") };
  };

  P.drawCharts = function () {
    if (!this.charts) return;
    if (this.full && this.tab !== "metrics") return;
    var sim = this.sim, S = sim.series, col = this.colors(), self = this;
    var dur = Math.max(10, sim.duration), events = sim.log.filter(function (l) { return l.phase === "start" && l.type !== "scale"; });
    this.charts.forEach(function (ch) {
      var cv = ch.canvas, dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300, h = cv.clientHeight || 110;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      var g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      var L = 38, R = 6, T = 6, B = 16, pw = w - L - R, ph = h - T - B;
      var series, ymax = 0, log = false, fmt = fmtNum;
      if (ch.kind === "rps") series = [[S.offered, col.a], [S.served, col.b]];
      else if (ch.kind === "lat") { series = [[S.p50, col.a], [S.p99, col.b]]; log = true; fmt = fmtMs; }
      else { series = [[S.errRate.map(function (x) { return x * 100; }), col.c]]; fmt = function (x) { return dec(x, 0) + "%"; }; }
      series.forEach(function (s) { s[0].forEach(function (y) { if (isFinite(y)) ymax = Math.max(ymax, y); }); });
      if (ch.kind === "err") ymax = Math.max(ymax, 5);
      if (!(ymax > 0)) ymax = 1;
      var ymin = log ? 1 : 0;
      if (log) ymax = Math.max(ymax * 1.2, 100);
      else ymax *= 1.1;
      function Y(y) { if (log) { y = Math.max(y, ymin); return T + ph - ph * Math.log(y / ymin) / Math.log(ymax / ymin); } return T + ph - ph * y / ymax; }
      function X(x) { return L + pw * x / dur; }
      g.font = "10px " + getComputedStyle(self.root).fontFamily;
      g.strokeStyle = col.grid; g.fillStyle = col.light; g.lineWidth = 1;
      var ticks = log ? [1, 10, 100, 1000, 10000].filter(function (y) { return y <= ymax; }) : [0, ymax / 2 / 1.1, ymax / 1.1];
      ticks.forEach(function (y) {
        var yy = Math.round(Y(y)) + 0.5;
        g.beginPath(); g.moveTo(L, yy); g.lineTo(w - R, yy); g.stroke();
        g.textAlign = "right"; g.fillText(fmt(y), L - 4, yy + 3);
      });
      g.textAlign = "center";
      for (var s = 0; s <= dur; s += dur > 400 ? 120 : dur > 100 ? 60 : 10) g.fillText(s + "s", X(s), h - 3);
      /* steady window of the goals */
      g.fillStyle = col.grid; g.globalAlpha = 0.25;
      g.fillRect(X(sim.window[0]), T, X(sim.window[1]) - X(sim.window[0]), ph);
      g.globalAlpha = 1;
      /* event markers */
      g.strokeStyle = col.ev; g.setLineDash([3, 3]);
      events.forEach(function (e) { var x = Math.round(X(e.t)) + 0.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); });
      g.setLineDash([]);
      series.forEach(function (sr) {
        g.strokeStyle = sr[1]; g.lineWidth = 1.6; g.beginPath();
        var started = false;
        sr[0].forEach(function (y, i) {
          if (!isFinite(y)) { started = false; return; }
          var x = X(S.t[i]), yy = Y(Math.min(y, ymax));
          if (!started) { g.moveTo(x, yy); started = true; } else g.lineTo(x, yy);
        });
        g.stroke();
      });
    });
  };

  /* ─── Inspector (right panel / overlay) ─── */
  P.renderSide = function () {
    var ins = this.inspector;
    ins.innerHTML = "";
    this.liveBox = null;
    if (!this.sel) {
      if (this.full) this.renderBrief(ins);
      else { ins.classList.remove("is-open"); this.renderGoalBar(); }
      return;
    }
    ins.classList.add("is-open");
    if (!this.full) {
      var close = el("button", { type: "button", class: "sdp-btn sdp-ins-close", title: t("close"), "aria-label": t("close") }, icon("x", 14));
      var self = this;
      close.addEventListener("click", function () { self.select(null); });
      ins.appendChild(close);
    }
    if (this.sel.kind === "node") this.renderNodeInspector(ins);
    else if (this.sel.kind === "edge") this.renderEdgeInspector(ins);
    else this.renderFrameInspector(ins);
  };

  P.goalText = function (g) {
    var gl = GOAL_LABEL[g.metric] || [g.metric, ""], unit = gl[1].indexOf("|") >= 0 ? gl[1].split("|")[LANG === "pt" ? 0 : 1] : gl[1];
    var v = g.value;
    return tx(gl[0]) + " " + g.op.replace("<=", "≤").replace(">=", "≥") + " " + (g.metric === "costPerMonth" ? fmtUsd(v) : fmtNum(v)) + (unit && g.metric !== "costPerMonth" ? " " + unit : "");
  };
  P.goalValue = function (metric, v) {
    if (v === undefined || v === null || isNaN(v)) return "—";
    if (metric === "costPerMonth") return fmtUsd(v);
    if (/^p\d/.test(metric)) return fmtMs(v);
    var gl = GOAL_LABEL[metric], unit = gl ? gl[1] : "";
    if (unit === "%") return dec(v, v < 1 ? 2 : 1) + "%";
    if (unit === "s") return fmtS(v);
    return fmtNum(v) + (unit && unit.indexOf("|") < 0 ? " " + unit : "");
  };

  P.renderBrief = function (ins) {
    var sc = this.scenario, self = this;
    ins.appendChild(el("h3", { class: "sdp-ins-title", text: tx(sc.title) }));
    ins.appendChild(el("p", { class: "sdp-brief", text: tx(sc.brief) }));
    if (this.restored) ins.appendChild(el("p", { class: "sdp-note", text: t("restored") }));
    var s = this.settings;
    ins.appendChild(el("p", { class: "sdp-meta", text: s.profile + " · " + fmtNum(s.targetRps) + " " + t("rps") + " · " + Math.round(s.readRatio * 100) + "% " + (LANG === "pt" ? "leituras" : "reads") + " · seed " + s.seed + " · " + t("chaos").toLowerCase() + " " + tx(CHAOS_LABEL[s.chaos]) }));
    if (sc.goals.length) {
      ins.appendChild(el("h4", { text: t("goals") }));
      var ul = el("div", { class: "sdp-goals" });
      this.goalEls = sc.goals.map(function (g) {
        var row = el("div", { class: "sdp-goal" });
        row.innerHTML = '<span class="sdp-goal-dot" aria-hidden="true"></span><span class="sdp-goal-t">' + esc(self.goalText(g)) + '</span><span class="sdp-goal-v"></span>';
        ul.appendChild(row);
        return row;
      });
      ins.appendChild(ul);
      this.updateGoals();
    }
    if (sc.hints.length) {
      var hc = collapsible("sdp-hints", t("hints") + " (" + sc.hints.length + ")", false);
      var ol = el("ol");
      sc.hints.forEach(function (h) { ol.appendChild(el("li", { text: tx(h) })); });
      hc.body.appendChild(ol);
      ins.appendChild(hc.root);
    }
    var actions = el("div", { class: "sdp-actions" });
    if (sc.solution) {
      var sol = el("button", { type: "button", class: "sdp-btn-text", text: t("solution") });
      sol.addEventListener("click", function () {
        actions.innerHTML = "";
        actions.appendChild(el("span", { class: "sdp-confirm", text: t("confirmSolution") }));
        var yes = el("button", { type: "button", class: "sdp-btn-text is-primary", text: t("yes") });
        var no = el("button", { type: "button", class: "sdp-btn-text", text: t("cancel") });
        yes.addEventListener("click", function () { var before = self.snapshot(); self.design = SCN.clone(sc.solution); self.restored = false; self.commit(before); self.fit(); self.newSim(); self.renderSide(); });
        no.addEventListener("click", function () { self.renderSide(); });
        actions.appendChild(yes); actions.appendChild(no);
        yes.focus();
      });
      actions.appendChild(sol);
    }
    var rs = el("button", { type: "button", class: "sdp-btn-text", text: t("resetScenario") });
    rs.addEventListener("click", function () { store("sdp:v1:" + sc.id, null); self.switchScenario(sc.id, true); });
    actions.appendChild(rs);
    ins.appendChild(actions);
    ins.appendChild(el("p", { class: "sdp-meta sdp-kbd-hint", text: t("connect") + ". " + t("panZoom") + "." }));
  };

  P.updateGoals = function () {
    if (!this.scenario.goals.length) return;
    var res = this.sim.goals(), started = this.sim.t >= this.sim.window[0] + 5, self = this;
    if (this.goalEls) res.forEach(function (r, i) {
      var row = self.goalEls[i];
      if (!row) return;
      row.className = "sdp-goal " + (!started ? "is-wait" : r.pass ? "is-pass" : "is-fail");
      row.querySelector(".sdp-goal-v").textContent = started ? self.goalValue(r.goal.metric, r.value) : "";
    });
    if (!this.full) this.renderGoalBar(res, started);
  };

  P.renderGoalBar = function (res, started) {
    var gb = this.goalBar, self = this;
    if (!gb) return;
    res = res || this.sim.goals();
    gb.innerHTML = "";
    if (!this.scenario.goals.length) { gb.style.display = "none"; return; }
    gb.style.display = "";
    res.forEach(function (r) {
      var chip = el("span", { class: "sdp-chip " + (!started ? "is-wait" : r.pass ? "is-pass" : "is-fail"), title: self.goalText(r.goal) });
      chip.textContent = self.goalText(r.goal) + (started ? " · " + self.goalValue(r.goal.metric, r.value) : "");
      gb.appendChild(chip);
    });
  };

  function paramRow(def, value, onChange, opts) {
    opts = opts || {};
    var row = el("div", { class: "sdp-param" });
    var lab = el("label", { class: "sdp-param-label" });
    lab.appendChild(el("span", { text: tx(def.label) }));
    if (opts.note) lab.appendChild(el("small", { text: " · " + opts.note }));
    row.appendChild(lab);
    if (def.help) lab.title = tx(def.help);
    var ctl;
    if (def.type === "bool") {
      ctl = el("input", { type: "checkbox", "aria-label": tx(def.label) });
      ctl.checked = !!value;
      if (opts.disabled) ctl.disabled = true;
      ctl.addEventListener("change", function () { onChange(ctl.checked); });
      lab.insertBefore(ctl, lab.firstChild);
      row.classList.add("is-bool");
    } else if (def.type === "enum") {
      ctl = el("select", { "aria-label": tx(def.label) });
      def.options.forEach(function (o) { var op = el("option", { value: o, text: o }); if (o === value) op.selected = true; ctl.appendChild(op); });
      ctl.addEventListener("change", function () { onChange(ctl.value); });
      row.appendChild(ctl);
    } else {
      var wrap = el("div", { class: "sdp-param-num" });
      var min = def.min !== undefined ? def.min : 0, max = def.max !== undefined ? def.max : 1000;
      var useLog = def.log && min >= 0;
      var lmin = useLog ? Math.max(min, def.type === "int" ? 1 : min || 0.01) : min;
      var r = el("input", { type: "range", "aria-label": tx(def.label) });
      if (useLog) { r.min = 0; r.max = 1000; r.step = 1; r.value = toLog(Math.max(value, lmin), lmin, max); }
      else { r.min = min; r.max = max; r.step = def.step || (def.type === "int" ? 1 : "any"); r.value = value; }
      var n = el("input", { type: "number", min: min, max: max, step: def.type === "int" ? 1 : "any", "aria-label": tx(def.label) });
      n.value = isFinite(value) ? value : "";
      r.addEventListener("input", function () {
        var v = useLog ? fromLog(+r.value, lmin, max) : +r.value;
        v = def.type === "int" ? Math.round(v) : niceRound(v);
        if (useLog && +r.value === 0 && min === 0) v = 0;
        n.value = v; onChange(v);
      });
      n.addEventListener("change", function () {
        var v = clamp(+n.value, min, max);
        if (def.type === "int") v = Math.round(v);
        n.value = v; r.value = useLog ? toLog(Math.max(v, lmin), lmin, max) : v; onChange(v);
      });
      wrap.appendChild(r); wrap.appendChild(n);
      row.appendChild(wrap);
    }
    if (def.help) row.appendChild(el("p", { class: "sdp-param-help", text: tx(def.help) }));
    return row;
  }

  P.renderNodeInspector = function (ins) {
    var n = this.node(this.sel.id), c = CAT.get(n.type), self = this;
    var head = el("div", { class: "sdp-ins-head sdp-cat-" + c.cat });
    head.innerHTML = '<span class="sdp-ins-glyph">' + glyph(n.type, 22) + '</span><span><b>' + esc(c.label) + '</b><br><small>' + esc(tx(CAT.CATEGORIES.filter(function (k) { return k.id === c.cat; })[0].label)) + "</small></span>";
    ins.appendChild(head);
    ins.appendChild(el("p", { class: "sdp-desc", text: tx(c.desc) }));
    ins.appendChild(el("p", { class: "sdp-numbers", text: tx(c.numbers) }));
    var pre = sitePrefix(), cb = catalogBase(this.root);
    if (pre !== null && cb) ins.appendChild(el("a", { class: "sdp-learn", href: pre + cb + c.cat + "/#" + c.id, text: t("learnMore") + " →" }));
    if (this.full) {
      var lab = el("div", { class: "sdp-param" });
      var l = el("label", { class: "sdp-param-label" }); l.appendChild(el("span", { text: t("label") }));
      var inp = el("input", { type: "text", class: "sdp-text", value: hasLabel(n, c) ? n.label : "", placeholder: c.label, "aria-label": t("label") });
      var before = null;
      inp.addEventListener("focus", function () { before = self.snapshot(); });
      inp.addEventListener("change", function () {
        var v = inp.value.trim().slice(0, 40);
        if (v === c.label) { v = ""; inp.value = ""; }   // the type itself is no label
        var cur = self.node(n.id);                         // commit() normalizes the design into new objects
        if (!cur) return;
        cur.label = v;
        self.commit(before, true, true); before = self.snapshot();
      });
      lab.appendChild(l); lab.appendChild(inp);
      ins.appendChild(lab);
    }
    this.liveBox = el("div", { class: "sdp-live" });
    ins.appendChild(this.liveBox);
    this.updateInspectorLive();
    if (c.params.length) {
      ins.appendChild(el("h4", { text: t("params") }));
      var eff = CAT.params(n);
      c.params.forEach(function (pid) {
        var def = CAT.PARAMS[pid];
        if (!def) return;
        var v = eff[pid];
        if (pid === "readRatio" && (n.params || {}).readRatio === undefined) v = self.settings.readRatio;
        if (/^(minReplicas|maxReplicas|targetUtil|warmupS)$/.test(pid) && !eff.autoscale) return;
        ins.appendChild(paramRow(def, v, function (val) { self.setNodeParam(n.id, pid, val); }));
      });
    }
    if (this.full) {
      var act = el("div", { class: "sdp-actions" });
      var dup = el("button", { type: "button", class: "sdp-btn-text", text: t("duplicate") + " (D)" });
      dup.addEventListener("click", function () { self.duplicate(); });
      var del = el("button", { type: "button", class: "sdp-btn-text is-danger", text: t("delete") + " (Del)" });
      del.addEventListener("click", function () { self.deleteSel(); });
      act.appendChild(dup); act.appendChild(del);
      ins.appendChild(act);
    }
  };

  P.updateInspectorLive = function () {
    if (!this.liveBox || !this.sel) return;
    var sim = this.sim, rows = [];
    if (this.sel.kind === "node") {
      var n = this.node(this.sel.id), c = CAT.get(n.type), v = sim.nodeView(n.id);
      if (!v) return;
      var obs = this.god || v.observed;
      var q = function (x) { return obs ? x : "?"; };
      if (c.role === "side") { rows.push([LANG === "pt" ? "Conectado a" : "Attached to", v.attached + (LANG === "pt" ? " nós" : " nodes")]); rows.push([t("nodeCost"), fmtUsd(v.cost)]); }
      else if (c.role === "source") { rows.push([t("lambda"), fmtNum(v.lam) + " " + t("rps")]); rows.push([t("latencyW"), fmtMs(v.W)]); rows.push([t("errors"), fmtPct(v.err)]); }
      else {
        rows.push([t("lambda"), fmtNum(v.lam) + " " + t("rps")]);
        rows.push([t("util"), q(isFinite(v.rho) ? dec(v.rho, 2) : "∞") + (obs && v.rhoThr > v.rhoCpu && isFinite(v.rhoCpu) ? " (" + t("cpu") + " " + dec(v.rhoCpu, 2) + ")" : "")]);
        if (isFinite(v.threads) && c.role !== "msg") rows.push([t("threads"), q(fmtNum(v.inflight) + " / " + fmtNum(v.threads))]);
        if (v.instances !== undefined) rows.push([t("instances"), fmtNum(v.instances) + (v.coldShare > 0.001 ? " · " + t("cold") + " " + fmtPct(v.coldShare) : "")]);
        if (c.role !== "msg") {
          rows.push([t("queue"), q(fmtNum(v.q))]);
          rows.push([t("wait"), q(fmtMs(v.waitMs))]);
          rows.push([t("latencyW"), fmtMs(v.W)]);
        }
        rows.push([t("errors"), fmtPct(v.err)]);
        if (c.role !== "msg" && n.type !== "serverless" && !c.d.ext && n.type !== "dbcluster") rows.push([t("replicas"), v.ready + " " + t("ready") + (v.pending ? " · " + v.pending + " " + t("pending") : "") + (v.down ? " · " + v.down + " " + t("down") : "")]);
        if (v.cluster) {
          var cl = sim.clusterById[v.cluster];
          rows.push([t("inCluster"), cl ? cl.label : v.cluster]);
          if (v.unsched) rows.push([t("unschedLong"), String(v.unsched)]);
        }
        if (n.type === "dbcluster") {
          var pp = CAT.params(n);
          rows.push([t("shardsK"), pp.shards + " × " + (1 + pp.replicasPerShard)]);
          rows.push([t("shardRho"), q(v.rhoHot === undefined ? "—" : (pp.shards > 1 ? t("hotShard") + " " + dec(Math.min(v.rhoHot, 9.99), 2) + " · " + t("otherShards") + " " + dec(Math.min(v.rhoOther || 0, 9.99), 2) : dec(Math.min(v.rhoHot, 9.99), 2)))]);
          rows.push([t("replK"), (pp.replicasPerShard ? pp.replication : "—") + (v.replMs ? " · " + t("writeExtra") + " " + fmtMs(v.replMs) : "")]);
          if (v.stale > 0) rows.push([t("staleK"), fmtPct(v.stale)]);
          if (v.lostWrites > 0) rows.push([t("lostK"), fmtNum(v.lostWrites)]);
          (v.dbFails || []).forEach(function (f) {
            rows.push([t("failoverK") + " · shard " + (f.shard + 1), sim.t < f.promoteAt ? t("noPrimary") + " (" + fmtS(f.promoteAt - sim.t) + ")" : t("promoted") + " (" + fmtS(f.backAt - sim.t) + ")"]);
          });
        }
        if (v.hit !== undefined && c.role === "cache") rows.push([t("hit"), fmtPct(v.hit)]);
        if (c.role === "msg") { rows.push([t("backlog"), fmtNum(v.backlog)]); rows.push([t("lag"), fmtS(v.lag)]); }
        if (v.repLag) rows.push([t("repLag"), fmtS(v.repLag)]);
        rows.push([t("nodeCost"), fmtUsd(v.cost)]);
        if (obs && isFinite(v.threads) && v.lam > 0 && c.role !== "msg" && n.type !== "serverless") {
          var hold = sim.byId[n.id].hold || 0;
          rows.push([t("little"), fmtNum(v.proc) + " × " + dec(hold / 1000, 3) + " s ≈ " + fmtNum(v.inflight)]);
        }
      }
    } else if (this.sel.kind === "frame") {
      var cv = sim.clusterView(this.sel.id);
      if (!cv) { this.liveBox.innerHTML = ""; return; }
      rows.push([t("nodesK"), cv.nodes + " " + t("nodesReady") + (cv.starting ? " · " + cv.starting + " " + t("nodesStarting") : "") + (cv.failed ? " · " + cv.failed + " " + t("nodesFailed") : "")]);
      rows.push([t("podsK"), cv.scheduled + " / " + cv.capacity + (cv.startingPods ? " (" + cv.startingPods + " " + t("pending") + ")" : "")]);
      rows.push([t("pendingK"), String(cv.pending)]);
      rows.push([t("membersK"), String(cv.members)]);
      rows.push([t("nodeCost"), fmtUsd(cv.cost)]);
    } else if (this.sel.kind === "edge") {
      var e = sim.edgeView(this.sel.id);
      if (!e) { this.liveBox.innerHTML = '<p class="sdp-meta">' + esc(LANG === "pt" ? "Conexão lateral (observabilidade / mesh): fora do caminho das requisições." : "Side connection (observability / mesh): not in the request path.") + "</p>"; return; }
      rows.push([t("edgeRate"), fmtNum(e.rate) + " " + t("rps")]);
      if (e.retryRate > 0.01) rows.push([t("retryRate"), fmtNum(e.retryRate) + " " + t("rps")]);
      rows.push([t("failAttempt"), fmtPct(e.pFail)]);
      if (!e.async) rows.push([t("latencyW"), fmtMs(e.T)]);
      if (e.cb !== "closed" || (this.edge(this.sel.id).params || {}).circuitBreaker) rows.push([t("cbState"), e.cb === "open" ? t("cbOpen") : e.cb === "half" ? t("cbHalf") : t("cbClosed")]);
      if (e.lag) rows.push([t("lag"), fmtS(e.lag)]);
      if (e.hop >= 70) rows.push(["cross-region", "+70 ms"]);
    }
    var html = rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    this.liveBox.innerHTML = "<h4>" + esc(t("live")) + "</h4><dl>" + html + "</dl>";
  };

  P.renderEdgeInspector = function (ins) {
    var e = this.edge(this.sel.id), self = this, a = this.node(e.from), b = this.node(e.to);
    var ca = CAT.get(a.type), cb = CAT.get(b.type);
    ins.appendChild(el("h3", { class: "sdp-ins-title", text: t("edge") + ": " + nameOf(a, ca) + " → " + nameOf(b, cb) }));
    this.liveBox = el("div", { class: "sdp-live" });
    ins.appendChild(this.liveBox);
    this.updateInspectorLive();
    if (ca.role === "side" || cb.role === "side") {
      if (this.full) { var del0 = el("button", { type: "button", class: "sdp-btn-text is-danger", text: t("delete") }); del0.addEventListener("click", function () { self.deleteSel(); }); ins.appendChild(del0); }
      return;
    }
    var simE = null;
    this.sim.flowEdges.forEach(function (x) { if (x.id === e.id) simE = x; });
    var eff = simE ? simE.p : CAT.merge(CAT.EDGE_DEFAULTS, e.params || {});
    var isMsg = cb.role === "msg", split = ca.role === "split", mesh = simE && simE.from.mesh;
    if (isMsg) ins.appendChild(el("p", { class: "sdp-meta", text: t("asyncNote") }));
    ins.appendChild(el("h4", { text: t("params") }));
    Object.keys(CAT.EDGE_PARAMS).forEach(function (pid) {
      var def = CAT.EDGE_PARAMS[pid];
      if (pid === "idempotencyKey" && !CAT.get(b.type).d.ext) return;
      if ((isMsg || eff.async) && /^(timeoutMs|retries|backoff|circuitBreaker|fallback|bulkhead)$/.test(pid)) return;
      if (ca.role === "msg" && pid !== "ratio" && pid !== "filter") return;
      var note = null;
      if (pid === "ratio" && split) note = t("weight");
      if (mesh && /^(timeoutMs|retries|backoff|circuitBreaker)$/.test(pid) && (e.params || {})[pid] === undefined) note = t("meshNote");
      ins.appendChild(paramRow(def, eff[pid], function (val) { self.setEdgeParam(e.id, pid, val); }, { note: note, disabled: pid === "async" && isMsg }));
    });
    if (this.full) {
      var del = el("button", { type: "button", class: "sdp-btn-text is-danger", text: t("delete") + " (Del)" });
      del.addEventListener("click", function () { self.deleteSel(); });
      ins.appendChild(del);
    }
  };

  P.renderFrameInspector = function (ins) {
    var f = this.frame(this.sel.id), c = CAT.get(f.type), self = this;
    var head = el("div", { class: "sdp-ins-head sdp-cat-" + c.cat });
    head.innerHTML = '<span class="sdp-ins-glyph">' + glyph(f.type, 22) + "</span><span><b>" + esc(c.label) + "</b></span>";
    ins.appendChild(head);
    ins.appendChild(el("p", { class: "sdp-desc", text: tx(c.desc) }));
    if (c.numbers) ins.appendChild(el("p", { class: "sdp-numbers", text: tx(c.numbers) }));
    var pre = sitePrefix(), cb = catalogBase(this.root);
    if (pre !== null && cb) ins.appendChild(el("a", { class: "sdp-learn", href: pre + cb + c.cat + "/#" + c.id, text: t("learnMore") + " →" }));
    function textRow(label, key) {
      var row = el("div", { class: "sdp-param" }), l = el("label", { class: "sdp-param-label" });
      l.appendChild(el("span", { text: label }));
      var inp = el("input", { type: "text", class: "sdp-text", value: f[key] || "" });
      inp.addEventListener("change", function () {
        var cur = self.frame(f.id), before = self.snapshot();
        if (!cur) return;
        cur[key] = inp.value.trim().slice(0, 30);
        self.commit(before, true, true);
      });
      row.appendChild(l); row.appendChild(inp);
      return row;
    }
    if (f.type === "k8s") {
      if (this.full) ins.appendChild(textRow(t("name"), "name"));
      this.liveBox = el("div", { class: "sdp-live" });
      ins.appendChild(this.liveBox);
      this.updateInspectorLive();
      ins.appendChild(el("h4", { text: t("params") }));
      var eff = CAT.merge(c.d, f.params || {});
      c.params.forEach(function (pid) {
        var def = CAT.PARAMS[pid];
        if (!def || (pid === "maxNodes" && !eff.clusterAutoscaler)) return;
        ins.appendChild(paramRow(def, eff[pid], function (val) { self.setFrameParam(f.id, pid, val); }));
      });
    }
    if (this.full) {
      if (f.type !== "k8s") {
        ins.appendChild(textRow(f.type === "vpc" ? t("region") : t("zone"), f.type === "vpc" ? "region" : "zone"));
        ins.appendChild(textRow(t("name"), "name"));
      }
      var del = el("button", { type: "button", class: "sdp-btn-text is-danger", text: t("delete") + " (Del)" });
      del.addEventListener("click", function () { self.deleteSel(); });
      ins.appendChild(del);
    }
  };

  /* ─── Events, report, trace panels ─── */
  P.eventText = function (l) {
    var sim = this.sim, lab = EVENT_LABEL[l.type] ? tx(EVENT_LABEL[l.type]) : l.type, info = l.info || {};
    var details = sim.hasLogs || info.scripted;
    var tgt = "";
    if (l.target && details) {
      if (sim.byId[l.target] || (sim.clusterById && sim.clusterById[l.target])) tgt = sim.nodeName(l.target);
      else if (info.from) tgt = sim.nodeName(info.from) + " → " + sim.nodeName(info.to);
      else tgt = String(l.target).replace(/^default\//, "");
    }
    if (l.type === "scale") {
      if (!details) return lab;
      return lab + ": " + tgt + (info.to !== undefined ? " " + info.from + " → " + info.to : info.replicas ? " (" + info.replicas + " " + t("ready") + ")" : "");
    }
    if (l.type === "cluster") {
      var ph = CLUSTER_PHASE[l.phase] ? tx(CLUSTER_PHASE[l.phase]) : l.phase;
      var det = info.pods ? info.pods + " pods" : info.to !== undefined ? info.from + " → " + info.to + (LANG === "pt" ? " nós" : " nodes") : info.nodes !== undefined ? info.nodes + (LANG === "pt" ? " nós" : " nodes") : "";
      return lab + ": " + ph + (tgt ? " — " + tgt : "") + (details && det ? " (" + det + ")" : "");
    }
    if (l.phase === "end") return "▼ " + lab + (tgt ? " — " + tgt : "") + (LANG === "pt" ? " (fim)" : " (over)");
    var extra = [];
    if (details) {
      if (info.factor) extra.push("×" + dec(info.factor, 1));
      if (info.mode) extra.push(info.mode);
      if (info.shard) extra.push("shard " + info.shard);
      if (info.lost !== undefined) extra.push(l.type === "primaryFail" ? fmtNum(info.lost) + " " + tx(GOAL_LABEL.lostWrites[0]) : info.lost + " pods");
      if (info.durationS) extra.push(info.durationS + " s");
    }
    var label = info.label ? tx(info.label) + " — " : "";
    return "▲ " + label + lab + (tgt ? " — " + tgt : "") + (extra.length ? " (" + extra.join(", ") + ")" : "");
  };

  P.renderEvents = function () {
    if (!this.full || this.tab !== "events") return;
    var sim = this.sim, p = this.panels.events, self = this;
    if (sim.log.length === this.logLen) return;
    this.logLen = sim.log.length;
    p.innerHTML = "";
    if (!sim.hasLogs) p.appendChild(el("p", { class: "sdp-note", text: t("noLogs") }));
    if (!sim.log.length) { p.appendChild(el("p", { class: "sdp-meta", text: t("noEvents") })); return; }
    var list = el("ol", { class: "sdp-log" });
    sim.log.slice().reverse().forEach(function (l) {
      var sev = l.type === "scale" || l.type === "cluster" ? "info" : l.phase === "end" ? "ok" : (l.type === "viral" || l.type === "hotkey" || l.type === "flush") ? "warn" : "bad";
      var li = el("li", { class: "sdp-log-" + sev });
      li.innerHTML = '<span class="sdp-log-t">' + esc(dec(l.t, 1)) + " s</span> " + esc(self.eventText(l));
      list.appendChild(li);
    });
    p.appendChild(list);
  };

  P.reportData = function () { return this.sim.report(); };

  P.renderReport = function () {
    if (!this.full) return;
    var p = this.panels.report, sim = this.sim, self = this;
    p.innerHTML = "";
    if (!(sim.t > 0)) { p.appendChild(el("p", { class: "sdp-meta", text: t("runToReport") })); return; }
    var r = this.reportData(), st = r.stats;
    var head = el("div", { class: "sdp-rep-head" });
    head.innerHTML = "<b>" + esc(t("reportOf")) + "</b> · " + esc(r.profile) + " · " + fmtNum(r.targetRps) + " " + esc(t("rps")) + " · seed " + esc(r.seed) + " · " + esc(t("chaos").toLowerCase()) + " " + esc(tx(CHAOS_LABEL[r.chaos])) + " · " + esc(r.duration) + " s" +
      (r.complete ? "" : ' · <span class="sdp-warn">' + esc(t("partial")) + "</span>") + ' · <span class="sdp-meta">' + esc(t("window")) + " " + esc(r.window[0]) + "–" + esc(r.window[1]) + " s</span>";
    p.appendChild(head);
    var copy = el("button", { type: "button", class: "sdp-btn-text", text: t("copyMd") });
    copy.addEventListener("click", function () { copyText(self.reportMarkdown(r), function (ok) { self.say(ok ? t("copied") : t("copyFail")); }); });
    head.appendChild(copy);

    var grid = el("div", { class: "sdp-rep-grid" });
    [["p50", fmtMs(st.p50)], ["p95", fmtMs(st.p95)], ["p99", fmtMs(st.p99)], ["p99.9", fmtMs(st.p999)],
      [t("errRate"), dec(st.errorRate, 2) + "%"], [t("availability"), dec(st.availability, 3) + "%"],
      [LANG === "pt" ? "Vazão média" : "Mean throughput", fmtNum(st.throughput) + " " + t("rps")], [t("maxSustained") + " (p99 ≤ " + fmtMs(r.sloMs) + ")", fmtNum(r.maxSustained) + " " + t("rps")],
      [t("cost") + " (" + t("costNote") + ")", fmtUsd(st.costPerMonth)], [t("theory"), r.theory ? dec(r.theory * 100, 3) + "%" : "—"]
    ].concat(sim.hasDb ? [[t("p99w"), fmtMs(st.p99Write)], [t("lostK"), fmtNum(st.lostWrites)], [t("staleK"), dec(st.staleReads, 2) + "%"]] : [])
      .concat(st.consumerLag > 0 ? [[t("lag") + " (max)", fmtS(st.consumerLag)]] : [])
      .concat(st.degraded > 0.01 ? [[t("degraded"), dec(st.degraded, 2) + "%"]] : [])
      .concat(r.breakpoint ? [[t("breaking"), fmtNum(r.breakpoint.rps) + " " + t("rps") + " @ " + r.breakpoint.t + " s"]] : [])
      .concat(r.knee ? [[t("knee"), fmtNum(r.knee.rps) + " " + t("rps") + " @ " + r.knee.t + " s"]] : [])
      .forEach(function (x) { var c = el("div", { class: "sdp-tile" }); c.innerHTML = '<span class="sdp-tile-k">' + esc(x[0]) + '</span><span class="sdp-tile-v">' + esc(x[1]) + "</span>"; grid.appendChild(c); });
    p.appendChild(grid);

    if (r.goals.length) {
      p.appendChild(el("h4", { text: t("goals") }));
      var gl = el("div", { class: "sdp-goals" });
      var anyFail = false;
      r.goals.forEach(function (g) {
        anyFail = anyFail || !g.pass;
        var row = el("div", { class: "sdp-goal " + (g.pass ? "is-pass" : "is-fail") });
        row.innerHTML = '<span class="sdp-goal-dot" aria-hidden="true"></span><span class="sdp-goal-t">' + esc(self.goalText(g.goal)) + '</span><span class="sdp-goal-v">' + esc(self.goalValue(g.goal.metric, g.value)) + " · " + esc(g.pass ? t("pass") : t("fail")) + "</span>";
        gl.appendChild(row);
      });
      p.appendChild(gl);
      if (anyFail && this.scenario.hints.length) {
        var ol = el("ol", { class: "sdp-hint-list" });
        this.scenario.hints.forEach(function (h) { ol.appendChild(el("li", { text: tx(h) })); });
        var hc2 = collapsible("sdp-hints", t("hints"), true);
        hc2.body.appendChild(ol);
        p.appendChild(hc2.root);
      }
    }
    p.appendChild(el("h4", { text: t("bottleneck") }));
    p.appendChild(el("p", { class: "sdp-bottleneck", text: this.bottleneckText(r.bottleneck) }));
    if (r.hottest.length) p.appendChild(el("p", { class: "sdp-meta", text: t("hottest") + ": " + r.hottest.map(function (h) { return h.label + " " + dec(Math.min(h.maxRho, 9.99), 2); }).join(" · ") }));
    if (r.events.length) {
      p.appendChild(el("h4", { text: t("eventsRun") }));
      var ul = el("ul", { class: "sdp-log" });
      r.events.forEach(function (l) { ul.appendChild(el("li", { text: dec(l.t, 1) + " s · " + self.eventText(l) })); });
      p.appendChild(ul);
    }
  };

  P.bottleneckText = function (b) {
    if (!b) return t("noBottleneck");
    var tpl = BOTTLENECK[b.reason] || BOTTLENECK.cpu;
    var L = b.lam * (b.hold || 0) / 1000;
    return fill(tx(tpl), {
      n: b.label, rho: dec(Math.min(b.rho, 9.99), 2), t: dec(b.t, 1), lam: fmtNum(b.lam), cpu: fmtPct(Math.min(b.rhoCpu, 1), 0),
      hold: fmtNum(b.hold), holdS: dec((b.hold || 0) / 1000, 3), L: fmtNum(L), threads: fmtNum(b.threads), slow: b.slowest || "—",
      pending: fmtNum(b.pending || 0), cl: b.cluster || ""
    });
  };

  P.reportMarkdown = function (r) {
    var self = this, st = r.stats, lines = [];
    lines.push("## " + t("reportOf") + ": " + tx(this.scenario.title));
    lines.push("");
    lines.push("- profile `" + r.profile + "`, target " + r.targetRps + " req/s, read " + Math.round(this.settings.readRatio * 100) + "%, seed " + r.seed + ", chaos " + r.chaos + ", " + r.duration + " s (window " + r.window.join("–") + " s)");
    lines.push("- p50 " + fmtMs(st.p50) + " · p95 " + fmtMs(st.p95) + " · p99 " + fmtMs(st.p99) + " · p99.9 " + fmtMs(st.p999));
    lines.push("- error rate " + dec(st.errorRate, 2) + "% · availability " + dec(st.availability, 3) + "% · throughput " + fmtNum(st.throughput) + " req/s · cost " + fmtUsd(st.costPerMonth) + "/month (illustrative)");
    if (r.breakpoint) lines.push("- breaking point " + fmtNum(r.breakpoint.rps) + " req/s");
    lines.push("- " + t("bottleneck") + ": " + this.bottleneckText(r.bottleneck));
    if (r.goals.length) {
      lines.push("");
      lines.push("| " + t("goals") + " | value | |");
      lines.push("|---|---|---|");
      r.goals.forEach(function (g) { lines.push("| " + self.goalText(g.goal) + " | " + self.goalValue(g.goal.metric, g.value) + " | " + (g.pass ? "✅" : "❌") + " |"); });
    }
    lines.push("");
    lines.push("```mermaid");
    lines.push(ENG.toMermaid(this.design));
    lines.push("```");
    return lines.join("\n");
  };

  P.renderTrace = function () {
    if (!this.full) return;
    var p = this.panels.trace, sim = this.sim;
    p.innerHTML = "";
    if (!sim.hasTracing) { p.appendChild(el("p", { class: "sdp-note", text: t("noTrace") })); return; }
    var tr = sim.slowTrace;
    if (!tr || !tr.spans.length) { p.appendChild(el("p", { class: "sdp-meta", text: t("runToReport") })); return; }
    p.appendChild(el("p", { class: "sdp-meta", text: t("traceTitle") + " t = " + dec(tr.t, 0) + " s: " + fmtMs(tr.ms) + (tr.ok ? (tr.deg ? " · " + t("degraded") : " · OK") : " · ERROR") + " (" + (tr.cls ? "write" : "read") + ")" }));
    var total = Math.max(tr.ms, 0.001), wrap = el("div", { class: "sdp-wf" });
    tr.spans.slice(0, 60).forEach(function (s) {
      if (s.type === "client" || s.type === "mobile") return;
      var row = el("div", { class: "sdp-wf-row" + (s.ok ? "" : " is-err") });
      var name = el("span", { class: "sdp-wf-name", text: " ".repeat(Math.max(0, s.depth - 1) * 2) + s.label, title: s.label });
      var track = el("span", { class: "sdp-wf-track" });
      var left = 100 * s.at / total, width = Math.max(0.4, 100 * s.ms / total), wait = 100 * (s.wait || 0) / total;
      var bar = el("span", { class: "sdp-wf-bar sdp-cat-" + (CAT.get(s.type) ? CAT.get(s.type).cat : "compute") });
      bar.style.left = left + "%"; bar.style.width = Math.min(width, 100 - left) + "%";
      if (wait > 0.2) { var w = el("span", { class: "sdp-wf-wait" }); w.style.width = (100 * wait / Math.max(width, 0.001)) + "%"; bar.appendChild(w); }
      track.appendChild(bar);
      row.appendChild(name); row.appendChild(track);
      row.appendChild(el("span", { class: "sdp-wf-ms", text: fmtMs(s.ms) + (s.why ? " " + s.why : "") }));
      wrap.appendChild(row);
    });
    p.appendChild(wrap);
  };

  /* ─── Simulation control ─── */
  P.toggleRun = function () {
    if (this.sim.done) this.newSim();
    this.running = !this.running;
    this.last = 0;
    this.updatePlayButton();
  };
  P.updatePlayButton = function () {
    if (!this.playBtn) return;
    this.playBtn.innerHTML = icon(this.running ? "pause" : "play");
    this.playBtn.title = this.running ? t("pause") : t("play");
    this.playBtn.setAttribute("aria-label", this.playBtn.title);
    this.playBtn.classList.toggle("is-on", this.running);
  };
  P.stepOnce = function () {
    if (this.sim.done) this.newSim();
    this.sim.step(10);
    this.afterTicks(true);
  };
  P.setLive = function (s) {
    for (var k in s) this.settings[k] = s[k];
    this.sim.setSettings(s);
    if (this.full && !this.sel) this.renderSide();
  };
  P.afterTicks = function (force) {
    var now = performance.now();
    this.updateLive(force);
    if (force || now - this.lastUi > 200) {
      this.lastUi = now;
      this.updateTiles();
      this.updateInspectorLive();
      this.updateGoals();
      this.renderEvents();
    }
    if (force || now - this.lastChart > 500) {
      this.lastChart = now;
      this.drawCharts();
      if (this.full && this.tab === "trace") this.renderTrace();
    }
    if (this.sim.done && !this.reportShown) {
      this.reportShown = true;
      this.running = false;
      this.updatePlayButton();
      this.updateGoals();
      this.say(t("done"));
      if (this.full) this.showTab("report");
    }
  };

  P.loop = function (ts) {
    var self = this;
    if (!document.contains(this.root)) { this.destroy(); return; }
    this.raf = requestAnimationFrame(function (x) { self.loop(x); });
    var dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    this.frameDt = dt;
    if (!this.visible) return;   // off screen (background tabs get no animation frames at all)
    if (this.running && !this.sim.done) {
      this.acc += dt * this.speed / ENG.DT;
      var n = Math.floor(this.acc), t0 = performance.now();
      this.acc -= n;
      for (var i = 0; i < n && !this.sim.done; i++) {
        this.sim.step(1);
        if (performance.now() - t0 > 14) { this.acc = 0; break; }   // keep the page responsive
      }
      this.afterTicks(false);
    } else if (this.running) this.afterTicks(false);
  };

  P.destroy = function () {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.toastT);
    if (this.io) this.io.disconnect();
    if (this.ro) this.ro.disconnect();
    this.dead = true;
  };

  /* ─── Editing ─── */
  P.addAtCenter = function (type) {
    var r = this.svg.getBoundingClientRect();
    var p = { x: (r.width / 2 - this.view.x) / this.view.k, y: (r.height / 2 - this.view.y) / this.view.k };
    var jitter = (this.design.nodes.length % 5) * 14;
    this.addComponent(type, p.x + jitter, p.y + jitter);
  };
  P.addComponent = function (type, x, y) {
    var c = CAT.get(type), before = this.snapshot();
    x = Math.round(x / 10) * 10; y = Math.round(y / 10) * 10;
    if (c.role === "frame") {
      var big = type !== "subnet";
      var f = { id: this.newId(FRAME_PREFIX[type] || type), type: type, x: x - 180, y: y - 110, w: type === "k8s" ? 480 : big ? 420 : 300, h: type === "k8s" ? 280 : big ? 240 : 180, name: "" };
      if (type === "vpc") f.region = "region-" + (this.design.frames.filter(function (q) { return q.type === "vpc"; }).length + 1);
      else if (type === "subnet") f.zone = "abc"[this.design.frames.filter(function (q) { return q.type === "subnet"; }).length % 3];
      else f.params = {};
      this.design.frames.push(f);
      this.sel = { kind: "frame", id: f.id };
    } else {
      var n = { id: this.newId(type), type: type, x: x, y: y, label: "", params: {} };
      this.design.nodes.push(n);
      this.sel = { kind: "node", id: n.id };
    }
    this.commit(before);
  };
  P.setNodeParam = function (id, key, val) {
    var n = this.node(id), before = this.editSnapshot("n:" + id + ":" + key);
    n.params = n.params || {};
    n.params[key] = val;
    this.commit(before, true, key !== "autoscale");   // autoscale shows/hides its own parameters
  };
  P.setFrameParam = function (id, key, val) {
    var f = this.frame(id), before = this.editSnapshot("f:" + id + ":" + key);
    f.params = f.params || {};
    f.params[key] = val;
    this.commit(before, true, key !== "clusterAutoscaler");   // it shows/hides "max nodes"
  };
  P.setEdgeParam = function (id, key, val) {
    var e = this.edge(id), before = this.editSnapshot("e:" + id + ":" + key);
    e.params = e.params || {};
    e.params[key] = val;
    this.commit(before, true, key !== "async");       // async hides timeout/retries/…
  };
  P.connect = function (from, to) {
    var a = this.node(from), b = this.node(to);
    if (!a || !b) return;
    if (from === to) { this.say(t("self")); return; }
    if (this.design.edges.some(function (e) { return (e.from === from && e.to === to) || (e.from === to && e.to === from); })) { this.say(t("dupEdge")); return; }
    if (ENG.wouldCycle(this.design, from, to)) { this.say(t("cycle")); return; }
    var before = this.snapshot();
    var id = from + "-" + to;
    while (this.edge(id)) id += "_";
    this.design.edges.push({ id: id, from: from, to: to, params: {} });
    this.sel = { kind: "edge", id: id };
    this.commit(before);
  };
  P.deleteSel = function () {
    if (!this.sel || !this.full) return;
    var s = this.sel, before = this.snapshot(), d = this.design;
    if (s.kind === "node") { d.nodes = d.nodes.filter(function (n) { return n.id !== s.id; }); d.edges = d.edges.filter(function (e) { return e.from !== s.id && e.to !== s.id; }); }
    else if (s.kind === "edge") d.edges = d.edges.filter(function (e) { return e.id !== s.id; });
    else d.frames = d.frames.filter(function (f) { return f.id !== s.id; });
    this.sel = null;
    this.commit(before);
  };
  P.duplicate = function () {
    if (!this.sel || !this.full) return;
    var before = this.snapshot();
    if (this.sel.kind === "node") {
      var n = this.node(this.sel.id), copy = JSON.parse(JSON.stringify(n));
      copy.id = this.newId(n.type); copy.x += 30; copy.y += 70;
      this.design.nodes.push(copy);
      this.sel = { kind: "node", id: copy.id };
    } else if (this.sel.kind === "frame") {
      var f = this.frame(this.sel.id), fc = JSON.parse(JSON.stringify(f));
      fc.id = this.newId(FRAME_PREFIX[f.type] || f.type); fc.y += f.h + 30;
      this.design.frames.push(fc);
      this.sel = { kind: "frame", id: fc.id };
    } else return;
    this.commit(before);
  };
  P.select = function (s) {
    this.sel = s;
    this.renderGraph();
    this.renderSide();
    this.updateLive(true);
  };

  /* ─── Pointer interaction: select, drag nodes/frames, connect, pan ─── */
  P.onPointerDown = function (ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    // A click on the canvas can trigger a redraw (e.g. the Label field commits on blur) that removes the
    // element the browser was about to focus; afterwards, keep keyboard focus inside this instance so
    // Delete/Backspace, D and C act on the selection.
    var me = this;
    setTimeout(function () {
      if (me.dead) return;
      var a = document.activeElement;
      if (!a || !me.root.contains(a)) me.restoreFocus(me.sel && me.sel.kind === "node" ? me.sel.id : null);
    }, 0);
    var tgt = ev.target, p = this.toWorld(ev);
    var handle = tgt.getAttribute && tgt.getAttribute("data-handle");
    var nodeG = tgt.closest ? tgt.closest(".sdp-node") : null;
    var edgeG = tgt.closest ? tgt.closest(".sdp-edge") : null;
    var frameG = tgt.closest ? tgt.closest(".sdp-frame") : null;
    var resize = tgt.getAttribute && tgt.getAttribute("data-resize");
    this.drag = null;
    if (handle && this.full) {
      this.drag = { kind: "connect", from: handle };
      this.svg.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      return;
    }
    if (nodeG) {
      var id = nodeG.getAttribute("data-node");
      if (this.connectFrom && this.connectFrom !== id) { var from = this.connectFrom; this.connectFrom = null; this.connect(from, id); return; }
      var n = this.node(id);
      this.drag = { kind: "node", id: id, sx: p.x, sy: p.y, ox: n.x, oy: n.y, moved: false, before: this.snapshot() };
      this.svg.setPointerCapture(ev.pointerId);
      return;
    }
    if (edgeG) { this.connectFrom = null; this.select({ kind: "edge", id: edgeG.getAttribute("data-edge") }); return; }
    if (resize && this.full) {
      var fr = this.frame(resize);
      this.drag = { kind: "resize", id: resize, sx: p.x, sy: p.y, ow: fr.w, oh: fr.h, before: this.snapshot() };
      this.svg.setPointerCapture(ev.pointerId);
      return;
    }
    if (frameG && tgt.classList.contains("sdp-frame-bar") || (frameG && tgt.classList.contains("sdp-frame-label"))) {
      var fid = frameG.getAttribute("data-frame"), f = this.frame(fid), inside = [];
      this.design.nodes.forEach(function (nn) { if (nn.x >= f.x && nn.x <= f.x + f.w && nn.y >= f.y && nn.y <= f.y + f.h) inside.push([nn, nn.x, nn.y]); });
      this.drag = { kind: "frame", id: fid, sx: p.x, sy: p.y, ox: f.x, oy: f.y, inside: inside, moved: false, before: this.snapshot() };
      this.svg.setPointerCapture(ev.pointerId);
      return;
    }
    /* background (or a frame body): pan */
    this.drag = { kind: "pan", cx: ev.clientX, cy: ev.clientY, vx: this.view.x, vy: this.view.y, moved: false, frame: frameG ? frameG.getAttribute("data-frame") : null };
    this.svg.setPointerCapture(ev.pointerId);
  };

  P.onPointerMove = function (ev) {
    var d = this.drag;
    if (!d) return;
    var p = this.toWorld(ev);
    if (d.kind === "pan") {
      var dx = ev.clientX - d.cx, dy = ev.clientY - d.cy;
      if (Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; this.userView = true; }
      this.view.x = d.vx + dx; this.view.y = d.vy + dy;
      this.applyView();
    } else if (d.kind === "node") {
      if (!this.full) return;
      var nx = Math.round((d.ox + p.x - d.sx) / 10) * 10, ny = Math.round((d.oy + p.y - d.sy) / 10) * 10;
      if (Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) > 4) d.moved = true;
      if (!d.moved) return;
      var n = this.node(d.id);
      n.x = nx; n.y = ny;
      this.renderGraph();
    } else if (d.kind === "frame") {
      var fx = Math.round((p.x - d.sx) / 10) * 10, fy = Math.round((p.y - d.sy) / 10) * 10;
      if (fx || fy) d.moved = true;
      var f = this.frame(d.id);
      f.x = d.ox + fx; f.y = d.oy + fy;
      d.inside.forEach(function (q) { q[0].x = q[1] + fx; q[0].y = q[2] + fy; });
      this.renderGraph();
    } else if (d.kind === "resize") {
      var fr = this.frame(d.id);
      fr.w = Math.max(120, Math.round((d.ow + p.x - d.sx) / 10) * 10); fr.h = Math.max(80, Math.round((d.oh + p.y - d.sy) / 10) * 10);
      this.renderGraph();
    } else if (d.kind === "connect") {
      var a = this.node(d.from);
      this.temp.setAttribute("d", pathD(edgePath(a, { x: p.x + W / 2 + 3, y: p.y }).p));
    }
  };

  P.onPointerUp = function (ev) {
    var d = this.drag;
    this.drag = null;
    if (!d) return;
    try { this.svg.releasePointerCapture(ev.pointerId); } catch (e) { /* not captured */ }
    if (d.kind === "connect") {
      this.temp.setAttribute("d", "");
      var under = document.elementFromPoint(ev.clientX, ev.clientY), g = under && under.closest ? under.closest(".sdp-node") : null;
      if (g && this.stage.contains(g)) this.connect(d.from, g.getAttribute("data-node"));
      return;
    }
    if (d.kind === "node") {
      if (d.moved) { this.commit(d.before, true); this.select({ kind: "node", id: d.id }); }
      else this.select({ kind: "node", id: d.id });
      return;
    }
    if (d.kind === "frame" || d.kind === "resize") {
      this.sel = { kind: "frame", id: d.id };
      if (d.moved !== false) this.commit(d.before, true); else { this.renderGraph(); this.renderSide(); }
      return;
    }
    if (d.kind === "pan" && !d.moved) {
      this.connectFrom = null;
      this.select(d.frame ? { kind: "frame", id: d.frame } : null);
    }
  };

  P.onHover = function (ev) {
    var g = ev.target.closest ? ev.target.closest(".sdp-edge") : null;
    this.hoverEdge = g ? g.getAttribute("data-edge") : null;
    if (!this.running) this.updateLive(true);
  };

  /* ─── Keyboard ─── */
  P.onKey = function (ev) {
    if (isTyping(ev.target)) return;
    var k = ev.key, mod = ev.ctrlKey || ev.metaKey;
    var ctl = ev.target && ev.target.closest ? ev.target.closest("button, a[href], [role='tab']") : null;
    if (ctl && (k === " " || k === "Enter")) return;   // let the focused control do its own action
    if (k === "Enter" && ev.target && ev.target.getAttribute && ev.target.getAttribute("data-node")) { this.select({ kind: "node", id: ev.target.getAttribute("data-node") }); this.focusNode(ev.target.getAttribute("data-node")); ev.preventDefault(); return; }
    if (mod && (k === "z" || k === "Z")) { if (!this.full) return; ev.preventDefault(); if (ev.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && (k === "y" || k === "Y")) { if (!this.full) return; ev.preventDefault(); this.redo(); return; }
    if (mod || ev.altKey) return;
    if (k === " ") { ev.preventDefault(); this.toggleRun(); return; }
    if (k === "Escape") { this.connectFrom = null; this.hideHelp(); this.select(null); return; }
    if (k === "?") { ev.preventDefault(); this.toggleHelp(); return; }
    if (k === "f" || k === "F") { this.fit(); return; }
    if (k === "+" || k === "=") { this.zoomBy(1.2); return; }
    if (k === "-") { this.zoomBy(1 / 1.2); return; }
    if (k === "s" || k === "S") { this.stepOnce(); return; }
    if (!this.full) return;
    if ((k === "Delete" || k === "Backspace") && this.sel) { ev.preventDefault(); this.deleteSel(); return; }
    if ((k === "d" || k === "D") && this.sel) { ev.preventDefault(); this.duplicate(); return; }
    if ((k === "c" || k === "C") && this.sel && this.sel.kind === "node") { this.connectFrom = this.sel.id; this.say(t("connectHint")); this.updateLive(true); }
  };

  P.toggleHelp = function () {
    if (this.helpEl) { this.hideHelp(); return; }
    var h = el("div", { class: "sdp-help", role: "dialog", "aria-label": t("shortcuts") }), self = this;
    var rows = [["Space", t("runKey")], ["S", t("stepKey")], ["C", t("connect")], ["D", t("dupSel")], ["Del / ⌫", t("delSel")], ["Ctrl/⌘ Z · Shift Ctrl/⌘ Z", t("undoKey")], ["F", t("fitKey")], ["+ / -", t("zoomIn") + " / " + t("zoomOut")], ["Tab · Enter", t("nodeKey")], ["Esc", t("escKey")], ["?", t("helpKey")]];
    h.innerHTML = "<h4>" + esc(t("shortcuts")) + "</h4><dl>" + rows.map(function (r) { return "<dt><kbd>" + esc(r[0]) + "</kbd></dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + '</dl><p class="sdp-meta">' + esc(t("panZoom")) + "</p>";
    var c = el("button", { type: "button", class: "sdp-btn-text", text: t("close") });
    c.addEventListener("click", function () { self.hideHelp(); });
    h.appendChild(c);
    this.stage.appendChild(h);
    this.helpEl = h;
    c.focus();
  };
  P.hideHelp = function () { if (this.helpEl) { this.helpEl.remove(); this.helpEl = null; this.root.focus(); } };

  P.say = function (msg) {
    var to = this.toast;
    to.textContent = msg;
    to.classList.add("is-on");
    clearTimeout(this.toastT);
    this.toastT = setTimeout(function () { to.classList.remove("is-on"); }, 2600);
  };

  /* ─── Inject an event ─── */
  P.toggleInject = function (anchor) {
    var self = this;
    if (this.injectEl) { this.injectEl.remove(); this.injectEl = null; return; }
    var box = el("div", { class: "sdp-inject", role: "dialog", "aria-label": t("inject") });
    var type = el("select", { "aria-label": t("inject") });
    ENG.EVENT_ORDER.forEach(function (k) { type.appendChild(el("option", { value: k, text: tx(EVENT_LABEL[k]) })); });
    var target = el("select", { "aria-label": t("selectTarget") });
    function fillTargets() {
      target.innerHTML = "";
      var k = type.value, sim = self.sim, opts = [];
      if (k === "viral" || k === "hotkey") opts = [];
      else if (k === "partition") opts = sim.flowEdges.filter(function (e) { return e.from.role !== "source"; }).map(function (e) { return [e.id, e.from.label + " → " + e.to.label]; });
      else if (k === "az") opts = Object.keys(sim.zones).map(function (z) { return [z, z]; });
      else if (k === "region") opts = Object.keys(sim.regions).map(function (z) { return [z, z]; });
      else if (k === "nodeFail") opts = sim.clusters.map(function (c) { return [c.id, "Kubernetes · " + c.label]; });
      else {
        var spec = ENG.EVENTS[k];
        opts = sim.nodes.filter(function (n) { return spec.scope === "node" ? spec.ok(n) : (n.def.cat === "compute" || n.def.cat === "ai" || n.type === "apigw"); }).map(function (n) { return [n.id, n.label]; });
      }
      target.appendChild(el("option", { value: "", text: t("anyTarget") }));
      opts.forEach(function (o) { target.appendChild(el("option", { value: o[0], text: o[1] })); });
      target.disabled = !opts.length;
    }
    type.addEventListener("change", fillTargets);
    fillTargets();
    var go = el("button", { type: "button", class: "sdp-btn-text is-primary", text: "⚡ " + t("injectBtn") });
    go.addEventListener("click", function () {
      var k = type.value, tg = target.value || null;
      if (!tg && k !== "viral" && k !== "hotkey" && k !== "az" && k !== "region" && k !== "partition" && k !== "badDeploy" && k !== "nodeFail") {
        var choices = Array.prototype.slice.call(target.options).filter(function (o) { return o.value; });
        if (!choices.length) { self.say("—"); return; }
        tg = choices[Math.floor(self.sim.R.manual.random() * choices.length)].value;
      }
      var a = self.sim.inject(k, tg);
      self.logLen = -1;
      self.say(a ? "⚡ " + tx(EVENT_LABEL[k]) : "—");
      self.afterTicks(true);
    });
    box.appendChild(type); box.appendChild(target); box.appendChild(go);
    this.toolbar.appendChild(box);
    this.injectEl = box;
    void anchor;
    type.focus();
  };

  /* ─── Scenario switching, import/export, share ─── */
  P.switchScenario = function (id, reset) {
    var sc = SCN.get(id);
    if (!sc) return;
    if (reset) store("sdp:v1:" + id, null);
    this.loadScenario(sc, false);
    this.buildToolbar();
    this.newSim();
    this.renderGraph();
    this.fit();
    this.renderSide();
    this.updateLive(true);
    this.updateTiles();
    this.drawCharts();
    if (this.full) this.showTab("metrics");
  };

  P.exportJson = function () {
    var data = { scenario: this.scenario.id, settings: this.settings, design: this.design };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "sdp-" + this.scenario.id + ".json" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };
  P.importJson = function (file) {
    var self = this, rd = new FileReader();
    rd.onload = function () {
      try {
        var data = JSON.parse(rd.result), design = data && (data.design || data);
        if (!design || typeof design !== "object" || !Array.isArray(design.nodes)) throw new Error("no nodes");
        var clean = ENG.normalizeDesign(design);
        if (typeof data.scenario === "string" && SCN.get(data.scenario) && data.scenario !== self.scenario.id) self.switchScenario(data.scenario);
        var before = self.snapshot();
        self.design = clean;
        cleanSettings(data.settings, self.settings);
        self.buildToolbar();
        self.commit(before);
        self.newSim();
        self.fit();
        self.say(t("imported"));
      } catch (e) { self.say(t("badFile")); }
    };
    if (file.size > 5e6) { self.say(t("badFile")); return; }
    rd.readAsText(file);
  };
  P.encoded = function () { return b64e(JSON.stringify({ s: this.scenario.id, d: this.design, st: this.settings })); };
  P.share = function () {
    var self = this, url = location.href.split("#")[0] + "#sdp=" + this.encoded();
    try { history.replaceState(null, "", url); } catch (e) { /* file:// */ }
    copyText(url, function (ok) { self.say(ok ? t("copied") : t("copyFail")); });
  };
  P.fullUrlBase = function () { var pre = sitePrefix(); return pre !== null ? pre + "playground/" : "#"; };
  P.fullUrl = function () {
    var base = this.fullUrlBase();
    return (base === "#" ? "" : base) + "#sdp=" + this.encoded();
  };
  P.copyMermaid = function () {
    var self = this;
    copyText(ENG.toMermaid(this.design), function (ok) { self.say(ok ? t("copied") : t("copyFail")); });
  };
  P.toggleFullscreen = function () {
    var r = this.root, self = this;
    if (document.fullscreenElement === r) document.exitFullscreen();
    else if (r.requestFullscreen) r.requestFullscreen().catch(function () { r.classList.toggle("is-max"); self.fit(); });
    else r.classList.toggle("is-max");
    setTimeout(function () { self.fit(); self.drawCharts(); }, 200);
  };

  /* ═══ Initialisation (idempotent; Material instant navigation) ═══ */
  function init() {
    LANG = CAT.lang();
    instances = instances.filter(function (p) {
      var alive = !p.dead && document.contains(p.root);
      if (!alive) p.destroy();
      return alive;
    });
    var nodes = document.querySelectorAll(".sdp:not([data-sdp-ready])");
    Array.prototype.forEach.call(nodes, function (root) {
      try { instances.push(new Playground(root)); }
      catch (e) { root.setAttribute("data-sdp-ready", "error"); if (window.console) console.error("System Design Playground:", e); }
    });
  }
  /* Theme changes: redraw charts (canvas colours come from CSS variables). */
  if (window.MutationObserver) new MutationObserver(function () { instances.forEach(function (p) { p.drawCharts(); }); })
    .observe(document.body || document.documentElement, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
  window.addEventListener("resize", function () { instances.forEach(function (p) { p.drawCharts(); }); });
  document.addEventListener("fullscreenchange", function () { instances.forEach(function (p) { setTimeout(function () { p.fit(); p.drawCharts(); }, 100); }); });

  SDP.ui = { init: init, instances: function () { return instances; }, Playground: Playground };
  if (window.document$ && typeof window.document$.subscribe === "function") window.document$.subscribe(init);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
