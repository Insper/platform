/* System Architecture (2027.1) support tools: the table shared by the concept
   map (dgm-mapa-arq.js) and the study cards (dgm-cartas-arq.js).

   LESSONS: [code, path under 2027.1/classes/, title]. The code is the class
   number of the course (C1..C16, as in the nav) and, for a subpage, the class
   number plus the subpage's position in the class roadmap (C10.1 = Resilience
   patterns). A class button covers its subpages.

   THEMES: the rows of the concept map and the topic filters of the cards, in
   course order; each theme groups consecutive classes.

   STAGES: the columns of the map and the colour of every card. They follow the
   way a design is built and defended, in an interview or in production:
     r  Requirements & numbers  blue    what must hold and how much: requirements,
                                        estimates, SLOs, capacity, cost
     b  Building blocks         purple  the components and how each one works
     c  Data & consistency      teal    state and correctness: replication,
                                        consistency, transactions, idempotency, ordering
     o  Operate at scale        orange  keeping it up: failure, resilience,
                                        observability, delivery, security, load tests
   The hex values live in support.css (--arq-r, --arq-b, --arq-c, --arq-o),
   light and dark; blue, purple and orange are the workbook's and cheat sheet's
   estimate / design / deep-dive colours. */
(function () {
  const LESSONS = [
    ['C1', 'intro', 'What is System Design'],
    ['C1.1', 'intro/requirements', 'Requirements'],
    ['C1.2', 'intro/scaling-journey', 'The Scaling Journey'],
    ['C1.3', 'intro/interview-framework', 'The Interview Framework'],
    ['C2', 'estimation', 'Estimation & Performance Math'],
    ['C2.1', 'estimation/numbers', 'Numbers Every Engineer Should Know'],
    ['C2.2', 'estimation/queueing', "Queueing, Little's Law and Scalability"],
    ['C2.3', 'estimation/percentiles', 'Percentiles and Tail Latency'],
    ['C2.4', 'estimation/availability-math', 'Availability Math'],
    ['C3', 'distributed', 'Distributed Systems'],
    ['C3.1', 'distributed/consistency', 'Replication & Consistency'],
    ['C3.2', 'distributed/cap-pacelc', 'CAP & PACELC'],
    ['C3.3', 'distributed/consensus', 'Consensus & Quorums'],
    ['C3.4', 'distributed/transactions', 'Distributed Transactions'],
    ['C3.5', 'distributed/time-clocks', 'Time & Clocks'],
    ['C4', 'edge', 'Traffic & Edge'],
    ['C4.1', 'edge/dns-cdn', 'DNS & CDN'],
    ['C4.2', 'edge/load-balancing', 'Load Balancing'],
    ['C4.3', 'edge/api-gateway', 'API Gateway & Rate Limiting'],
    ['C4.4', 'edge/identity', 'Identity: OAuth 2.1, OIDC & JWT'],
    ['C4.5', 'edge/protocols', 'Protocols'],
    ['C5', 'compute', 'Compute & Services'],
    ['C5.1', 'compute/services', 'Services'],
    ['C5.2', 'compute/api-styles', 'API Styles'],
    ['C5.3', 'compute/async-work', 'Async Work'],
    ['C5.4', 'compute/serverless-autoscaling', 'Serverless & Autoscaling'],
    ['C5.5', 'compute/integrations', 'External Integrations'],
    ['C6', 'databases', 'Databases & Data Systems'],
    ['C6.1', 'databases/models', 'Data Models & Storage Engines'],
    ['C6.2', 'databases/transactions', 'Transactions & Isolation'],
    ['C6.3', 'databases/replication', 'Replication'],
    ['C6.4', 'databases/partitioning', 'Partitioning & NewSQL'],
    ['C6.5', 'databases/specialized', 'Specialized Stores'],
    ['C7', 'caching', 'Caching'],
    ['C7.1', 'caching/patterns', 'Caching Patterns'],
    ['C7.2', 'caching/invalidation', 'Invalidation & Eviction'],
    ['C7.3', 'caching/failure-modes', 'Cache Failure Modes'],
    ['C7.4', 'caching/redis', 'Redis'],
    ['C8', 'messaging', 'Messaging & Event-Driven'],
    ['C8.1', 'messaging/queues-pubsub', 'Queues and Pub/Sub'],
    ['C8.2', 'messaging/kafka', 'Kafka and Event Logs'],
    ['C8.3', 'messaging/semantics', 'Delivery Semantics'],
    ['C8.4', 'messaging/patterns', 'Messaging Patterns'],
    ['C9', 'observability', 'Observability'],
    ['C9.1', 'observability/signals', 'Signals'],
    ['C9.2', 'observability/slo', 'SLIs, SLOs and Error Budgets'],
    ['C9.3', 'observability/opentelemetry', 'OpenTelemetry'],
    ['C9.4', 'observability/alerting', 'Alerting'],
    ['C9.5', 'observability/incident-response', 'Incident Response'],
    ['C10', 'reliability', 'Reliability & Resilience'],
    ['C10.1', 'reliability/patterns', 'Resilience Patterns'],
    ['C10.2', 'reliability/disaster-recovery', 'Disaster Recovery'],
    ['C10.3', 'reliability/chaos', 'Chaos Engineering'],
    ['C11', 'cloud-native', 'Cloud-Native Platforms'],
    ['C11.1', 'cloud-native/containers', 'Containers'],
    ['C11.2', 'cloud-native/kubernetes', 'Kubernetes'],
    ['C11.3', 'cloud-native/delivery', 'Delivery'],
    ['C11.4', 'cloud-native/finops', 'FinOps'],
    ['C12', 'network-security', 'Network & Security'],
    ['C12.1', 'network-security/internet', 'How the Internet Works'],
    ['C12.2', 'network-security/cloud-network', 'Cloud Networking'],
    ['C12.3', 'network-security/service-mesh', 'Service Mesh'],
    ['C12.4', 'network-security/zero-trust', 'Zero Trust, Secrets & Supply Chain'],
    ['C13', 'ai-systems', 'AI Systems & Agents'],
    ['C13.1', 'ai-systems/llm-gateway', 'LLM Gateway'],
    ['C13.2', 'ai-systems/agents', 'Agents & Tools'],
    ['C13.3', 'ai-systems/rag-memory', 'RAG & Memory'],
    ['C13.4', 'ai-systems/safety-evals', 'Safety, Evals & Observability'],
    ['C14', 'ai-delivery', 'AI-Assisted Delivery'],
    ['C14.1', 'ai-delivery/code-review', 'AI Code Review'],
    ['C14.2', 'ai-delivery/testing', 'AI in Testing'],
    ['C14.3', 'ai-delivery/agents-in-ci', 'Agents in CI'],
    ['C14.4', 'ai-delivery/release-operate', 'Release & Operate'],
    ['C14.5', 'ai-delivery/security-governance', 'Security & Governance'],
    ['C15', 'performance', 'Performance Engineering'],
    ['C15.1', 'performance/methodology', 'Methodology'],
    ['C15.2', 'performance/load-testing', 'Load Testing'],
    ['C15.3', 'performance/bottlenecks', 'Finding Bottlenecks'],
    ['C15.4', 'performance/capacity-planning', 'Capacity Planning'],
    ['C16', 'case-studies', 'Case Studies'],
    ['C16.1', 'case-studies/url-shortener', 'URL Shortener'],
    ['C16.2', 'case-studies/rate-limiter', 'Rate Limiter'],
    ['C16.3', 'case-studies/distributed-cache', 'Distributed Cache'],
    ['C16.4', 'case-studies/search-autocomplete', 'Search Autocomplete'],
    ['C16.5', 'case-studies/notification-system', 'Notification System'],
    ['C16.6', 'case-studies/news-feed', 'News Feed'],
    ['C16.7', 'case-studies/chat', 'Chat'],
    ['C16.8', 'case-studies/ride-sharing', 'Ride Sharing'],
    ['C16.9', 'case-studies/video-streaming', 'Video Streaming'],
    ['C16.10', 'case-studies/payment-system', 'Payment System'],
    ['C16.11', 'case-studies/ticketing', 'Ticketing: the BoxOffice Flash Sale'],
    ['C16.12', 'case-studies/ai-assistant', 'AI Assistant'],
  ];

  // [key, name, classes]
  const THEMES = [
    ['F', 'Foundations', ['C1', 'C2']],
    ['D', 'Distributed systems', ['C3']],
    ['E', 'Edge & compute', ['C4', 'C5']],
    ['S', 'Storage', ['C6', 'C7']],
    ['M', 'Messaging', ['C8']],
    ['O', 'Operations', ['C9', 'C10', 'C11', 'C12']],
    ['A', 'AI', ['C13', 'C14']],
    ['P', 'Performance & cases', ['C15', 'C16']],
  ];

  // [key, name, icon]
  const STAGES = [
    ['r', 'Requirements & numbers', '◎'],
    ['b', 'Building blocks', '▣'],
    ['c', 'Data & consistency', '⛁'],
    ['o', 'Operate at scale', '⚙'],
  ];

  const parent = c => c.split('.')[0];
  const LESSON = {};
  LESSONS.forEach(([code, path, title], i) => { LESSON[code] = { code, path, title, i }; });
  const THEME_OF = {};
  THEMES.forEach(([k, , classes]) => classes.forEach(c => { THEME_OF[c] = k; }));
  const theme = code => THEME_OF[parent(code)];

  window.ARQ = { LESSONS, LESSON, THEMES, STAGES, parent, theme };
})();
