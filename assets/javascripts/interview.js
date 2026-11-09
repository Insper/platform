/*
 * Interview Material (2026.2) — accordion, quiz and checklist.
 * Loaded on every page via extra_javascript; it only acts when a `.iv`
 * container is present. Re-initializes on Material's instant navigation.
 * Bilingual: texts come from I18N.pt or I18N.en according to <html lang>;
 * each language keeps its own checklist progress in localStorage.
 *
 * A page may bring its own data (2027.1 and later): put inside the `.iv`
 * container
 *   <script type="application/json" class="iv-quiz-data">
 *     {"key": "2027.1-system-design",
 *      "en": {"quiz": [...], "check": [...]}, "pt": {...}}
 *   </script>
 * Quiz items are {q, opts, correct, fb, topic?}; when items have a `topic`,
 * filter buttons are rendered into #iv-quiz-filter (if present). The
 * checklist is saved under "iv-<key>-checklist-<lang>". Pages without that
 * script (2026.2) keep the built-in data and key below.
 */
(function () {
  var quizPt = [
    {
      q: "Você está projetando um sistema de URL shortener para 100M de usuários. A maioria das operações é de leitura (redirect). Qual a primeira decisão arquitetural mais impactante para performance?",
      opts: [
        "Usar banco de dados relacional com índices otimizados",
        "Implementar caching agressivo (Redis) nas URLs mais populares",
        "Migrar para NoSQL para maior flexibilidade de schema",
        "Escalar verticalmente o servidor web principal"
      ],
      correct: 1,
      fb: "O sistema é read-heavy por natureza. Caching (Redis/Memcached) elimina a maioria das queries ao banco, reduzindo latência de ~50ms (DB) para <1ms (cache). A regra de Pareto se aplica: ~20% das URLs geram ~80% do tráfego — caching é extremamente efetivo aqui."
    },
    {
      q: "Qual a diferença fundamental entre Bandwidth e Throughput em sistemas distribuídos?",
      opts: [
        "São sinônimos — ambos medem a velocidade de transferência de dados",
        "Bandwidth é a capacidade máxima teórica do canal; Throughput é a taxa real obtida",
        "Bandwidth mede a latência de rede; Throughput mede a velocidade de processamento",
        "Bandwidth é para UDP; Throughput é para TCP"
      ],
      correct: 1,
      fb: "Bandwidth é o limite teórico do canal (ex: link de 1 Gbps). Throughput é o que você efetivamente obtém (ex: 700 Mbps devido a overhead de protocolo, congestionamento e retransmissões). Throughput ≤ Bandwidth sempre."
    },
    {
      q: "Numa entrevista de System Design, o entrevistador diz: 'Projete o Instagram'. Qual deve ser o PRIMEIRO passo?",
      opts: [
        "Começar desenhando o diagrama de arquitetura completo com todos os componentes",
        "Fazer perguntas para escopar o problema: quais features, escala esperada, restrições",
        "Decidir imediatamente entre SQL vs. NoSQL para o banco de dados principal",
        "Propor uma arquitetura de microservices logo de início"
      ],
      correct: 1,
      fb: "Sempre escope antes de desenhar. Perguntas essenciais: quais features projetar (upload de fotos, feed, stories, DMs)? Quantos usuários (DAU/MAU)? Read-heavy ou write-heavy? Consistência forte ou eventual é aceitável? Latência máxima? Só então você tem base para propor arquitetura justificada."
    },
    {
      q: "Em qual situação Sharding por hash é SUPERIOR ao Sharding por range?",
      opts: [
        "Quando você precisa de range queries frequentes, como 'todos os pedidos de Janeiro a Março'",
        "Quando o access pattern é lookups por chave (ex: user_id) e distribuição uniforme é crítica para evitar hot spots",
        "Quando novos shards precisam ser adicionados muito frequentemente sem downtime",
        "Quando os dados têm uma ordenação natural importante que deve ser preservada"
      ],
      correct: 1,
      fb: "Hash-based sharding distribui dados uniformemente, evitando hot spots — ideal para lookups por chave. O tradeoff: range queries exigem scan em todos os shards (O(N) shards). Range-based facilita range queries mas pode criar hot spots se a distribuição dos dados for desigual."
    },
    {
      q: "Qual o principal benefício do processamento assíncrono com filas (message queues) em sistemas de alta escala?",
      opts: [
        "Elimina completamente a latência percebida pelo usuário em todas as operações",
        "Desacopla produtores de consumidores, absorve picos de tráfego e permite retry automático em falhas",
        "Garante processamento em tempo real (< 10ms) para todos os eventos do sistema",
        "Substitui completamente a necessidade de um banco de dados principal"
      ],
      correct: 1,
      fb: "Filas desacoplam produtores (que geram trabalho) de consumidores (que processam), permitindo que cada um escale independentemente. Absorvem picos de tráfego (buffer entre velocidades diferentes), garantem retry automático em falhas de workers e possibilitam diferentes SLAs para diferentes tipos de trabalho."
    },
    {
      q: "No framework 'Algorithms that Scale', qual é o propósito do passo 'Make Believe'?",
      opts: [
        "Inventar dados fictícios para testar o algoritmo sem dados reais",
        "Assumir que todos os dados cabem em uma única máquina e resolver o problema lá, obtendo a solução base",
        "Ignorar completamente os requisitos de escala e focar apenas na correção lógica do algoritmo",
        "Criar um protótipo funcional antes de considerar a arquitetura de produção"
      ],
      correct: 1,
      fb: "'Make Believe' significa resolver o problema assumindo que tudo cabe em memória de uma máquina — sem se preocupar com escala. Isso produz a solução base correta que será adaptada nos próximos passos ('Get Real' e 'Solve Problems') para funcionar em escala distribuída."
    },
    {
      q: "O entrevistador pede um SLO de 99,99% de disponibilidade. Quanto downtime isso permite por ano, aproximadamente?",
      opts: [
        "~8,8 horas",
        "~3,65 dias",
        "~52 minutos",
        "~5 minutos"
      ],
      correct: 2,
      fb: "Cada '9' adicional divide o downtime por 10: 99% ≈ 3,65 dias/ano, 99,9% ≈ 8,8 h/ano, 99,99% ≈ 52,6 min/ano, 99,999% ≈ 5,3 min/ano. Em série, as disponibilidades se multiplicam: três serviços a 99,9% resultam em ~99,7% para o fluxo completo."
    },
    {
      q: "Por que usar consistent hashing em vez de hash(key) % N para distribuir chaves entre nós de cache?",
      opts: [
        "Porque é mais rápido de calcular",
        "Porque garante que todas as chaves fiquem no mesmo nó",
        "Porque elimina a necessidade de replicação",
        "Porque, ao adicionar ou remover um nó, apenas ~K/N chaves precisam ser remapeadas"
      ],
      correct: 3,
      fb: "Com hash % N, mudar N remapeia quase todas as chaves — num cache, isso equivale a um cold start geral e um flood de queries no banco. No anel de consistent hashing, só as chaves do intervalo afetado mudam de dono (~K/N). Virtual nodes suavizam a distribuição entre nós heterogêneos."
    },
    {
      q: "Durante uma partição de rede, qual escolha faz mais sentido para o serviço que mantém o SALDO de contas bancárias?",
      opts: [
        "CP — recusar ou atrasar operações até garantir consistência",
        "AP — aceitar escritas em ambos os lados e reconciliar depois",
        "Nenhuma — o CAP theorem não se aplica a bancos de dados relacionais",
        "AP — desde que haja um cache na frente do banco"
      ],
      correct: 0,
      fb: "Saldo é um invariante de negócio: aceitar dois saques concorrentes em lados diferentes da partição pode gerar saldo negativo. Prefira CP (consistência) e aceite indisponibilidade parcial. Já um carrinho de compras (caso clássico do Dynamo) tolera AP: é melhor aceitar o item e reconciliar depois."
    },
    {
      q: "Um cliente faz POST /payments, recebe timeout e repete a requisição. Qual mecanismo evita que o pagamento seja cobrado duas vezes?",
      opts: [
        "Aumentar o timeout do cliente",
        "Usar um circuit breaker no gateway",
        "Enviar uma idempotency key e o servidor deduplicar requisições com a mesma chave",
        "Trocar POST por GET"
      ],
      correct: 2,
      fb: "Timeout não significa falha: o servidor pode ter processado a primeira requisição. Com uma Idempotency-Key (ex.: UUID gerado pelo cliente), o servidor armazena o resultado da primeira execução e devolve o mesmo resultado nas repetições. Retry sem idempotência é uma fonte clássica de cobranças duplicadas."
    }
  ];

  var checkPt = [
    { cat: "Fundamentos de comunicação", items: [
      "Pratico pensar em voz alta ao resolver problemas de design",
      "Sei fazer transições explícitas entre etapas ('agora vou identificar os gargalos...')",
      "Tenho o hábito de perguntar sobre escopo antes de propor qualquer arquitetura",
      "Sei declarar assunções explicitamente em vez de assumir silenciosamente"
    ]},
    { cat: "Estimativas (back-of-envelope)", items: [
      "Sei converter usuários em req/s (ex: 10M DAU × 1 req/dia ÷ 86400s ≈ 116 req/s)",
      "Sei estimar necessidade de storage (ex: 1M usuários × 100KB = 100GB)",
      "Sei estimar bandwidth necessária dado throughput e tamanho médio de request",
      "Conheço ordens de grandeza: latência RAM (<1μs), SSD (~100μs), disco (~10ms), rede (~100ms)",
      "Sei converter um SLO (99,9%, 99,99%) em downtime permitido por mês e por ano"
    ]},
    { cat: "Conceitos técnicos", items: [
      "Sei explicar horizontal vs. vertical scaling com tradeoffs",
      "Sei explicar consistent hashing e por que minimiza remapeamento ao adicionar nós",
      "Consigo descrever as políticas LRU, LFU e TTL e quando usar cada uma",
      "Sei explicar write-through vs. write-back e os tradeoffs de cada estratégia",
      "Entendo a diferença entre bandwidth, throughput e latency com exemplos",
      "Sei descrever o fluxo Map → Shuffle → Reduce no MapReduce",
      "Conheço quando usar SQL vs. NoSQL (Key-Value, Document, Column-family, Graph)",
      "Sei explicar o CAP theorem e dar exemplos de sistemas CP vs AP"
    ]},
    { cat: "Plataforma & operação", items: [
      "Sei explicar o papel de um API Gateway (roteamento, autenticação, rate limiting)",
      "Conheço token bucket e sliding window para rate limiting",
      "Sei combinar timeout, retry com backoff + jitter e circuit breaker",
      "Sei explicar por que retries exigem idempotência",
      "Sei diferenciar logs, métricas e traces e o que cada um responde",
      "Sei definir SLI, SLO, SLA e error budget"
    ]},
    { cat: "Prática de entrevista", items: [
      "Pratiquei pelo menos 5 problemas de system design completos (URL shortener, Instagram, etc.)",
      "Consigo desenhar um sistema com load balancer + app servers + cache + DB + queue",
      "Identifico single points of failure em arquiteturas propostas",
      "Sei propor soluções para os gargalos mais comuns (DB, app server, cache miss)",
      "Tenho respostas preparadas para 'por que você escolheu X e não Y?'"
    ]}
  ];

  var quizEn = [
    {
      q: "You are designing a URL shortener for 100M users. Most operations are reads (redirects). What is the first, most impactful architectural decision for performance?",
      opts: [
        "Use a relational database with optimized indexes",
        "Implement aggressive caching (Redis) for the most popular URLs",
        "Move to NoSQL for greater schema flexibility",
        "Scale the main web server vertically"
      ],
      correct: 1,
      fb: "The system is read-heavy by nature. Caching (Redis/Memcached) removes most database queries, cutting latency from ~50ms (DB) to <1ms (cache). The Pareto rule applies: ~20% of the URLs generate ~80% of the traffic — caching is extremely effective here."
    },
    {
      q: "What is the fundamental difference between Bandwidth and Throughput in distributed systems?",
      opts: [
        "They are synonyms — both measure data transfer speed",
        "Bandwidth is the channel's theoretical maximum capacity; Throughput is the rate actually achieved",
        "Bandwidth measures network latency; Throughput measures processing speed",
        "Bandwidth is for UDP; Throughput is for TCP"
      ],
      correct: 1,
      fb: "Bandwidth is the channel's theoretical limit (e.g. a 1 Gbps link). Throughput is what you actually get (e.g. 700 Mbps due to protocol overhead, congestion and retransmissions). Throughput ≤ Bandwidth, always."
    },
    {
      q: "In a System Design interview, the interviewer says: 'Design Instagram'. What should the FIRST step be?",
      opts: [
        "Start drawing the full architecture diagram with every component",
        "Ask questions to scope the problem: which features, expected scale, constraints",
        "Immediately decide between SQL vs. NoSQL for the main database",
        "Propose a microservices architecture right away"
      ],
      correct: 1,
      fb: "Always scope before drawing. Essential questions: which features to design (photo upload, feed, stories, DMs)? How many users (DAU/MAU)? Read-heavy or write-heavy? Is strong consistency required or is eventual acceptable? Maximum latency? Only then do you have grounds to propose a justified architecture."
    },
    {
      q: "In which situation is hash-based Sharding SUPERIOR to range-based Sharding?",
      opts: [
        "When you need frequent range queries, such as 'all orders from January to March'",
        "When the access pattern is lookups by key (e.g. user_id) and uniform distribution is critical to avoid hot spots",
        "When new shards must be added very frequently without downtime",
        "When the data has an important natural ordering that must be preserved"
      ],
      correct: 1,
      fb: "Hash-based sharding spreads data uniformly, avoiding hot spots — ideal for lookups by key. The tradeoff: range queries require a scan of every shard (O(N) shards). Range-based makes range queries easy but can create hot spots if the data distribution is uneven."
    },
    {
      q: "What is the main benefit of asynchronous processing with message queues in high-scale systems?",
      opts: [
        "It completely eliminates user-perceived latency for every operation",
        "It decouples producers from consumers, absorbs traffic spikes and allows automatic retry on failures",
        "It guarantees real-time processing (< 10ms) for every event in the system",
        "It completely replaces the need for a main database"
      ],
      correct: 1,
      fb: "Queues decouple producers (which generate work) from consumers (which process it), letting each scale independently. They absorb traffic spikes (a buffer between different speeds), guarantee automatic retry when workers fail and allow different SLAs for different kinds of work."
    },
    {
      q: "In the 'Algorithms that Scale' framework, what is the purpose of the 'Make Believe' step?",
      opts: [
        "Make up fake data to test the algorithm without real data",
        "Assume all the data fits in a single machine and solve the problem there, obtaining the baseline solution",
        "Completely ignore the scale requirements and focus only on the algorithm's logical correctness",
        "Build a working prototype before considering the production architecture"
      ],
      correct: 1,
      fb: "'Make Believe' means solving the problem assuming everything fits in one machine's memory — without worrying about scale. This yields the correct baseline solution, which is adapted in the next steps ('Get Real' and 'Solve Problems') to work at distributed scale."
    },
    {
      q: "The interviewer asks for a 99.99% availability SLO. Roughly how much downtime per year does that allow?",
      opts: [
        "~8.8 hours",
        "~3.65 days",
        "~52 minutes",
        "~5 minutes"
      ],
      correct: 2,
      fb: "Each additional '9' divides the downtime by 10: 99% ≈ 3.65 days/year, 99.9% ≈ 8.8 h/year, 99.99% ≈ 52.6 min/year, 99.999% ≈ 5.3 min/year. In series, availabilities multiply: three services at 99.9% give ~99.7% for the whole flow."
    },
    {
      q: "Why use consistent hashing instead of hash(key) % N to distribute keys among cache nodes?",
      opts: [
        "Because it is faster to compute",
        "Because it guarantees that all keys stay on the same node",
        "Because it removes the need for replication",
        "Because, when a node is added or removed, only ~K/N keys need to be remapped"
      ],
      correct: 3,
      fb: "With hash % N, changing N remaps almost every key — in a cache, that amounts to a global cold start and a flood of database queries. On a consistent hashing ring, only the keys in the affected range change owner (~K/N). Virtual nodes smooth the distribution across heterogeneous nodes."
    },
    {
      q: "During a network partition, which choice makes the most sense for the service that holds bank account BALANCES?",
      opts: [
        "CP — refuse or delay operations until consistency is guaranteed",
        "AP — accept writes on both sides and reconcile later",
        "Neither — the CAP theorem does not apply to relational databases",
        "AP — as long as there is a cache in front of the database"
      ],
      correct: 0,
      fb: "The balance is a business invariant: accepting two concurrent withdrawals on different sides of the partition can produce a negative balance. Prefer CP (consistency) and accept partial unavailability. A shopping cart (the classic Dynamo case), on the other hand, tolerates AP: it is better to accept the item and reconcile later."
    },
    {
      q: "A client sends POST /payments, gets a timeout and repeats the request. Which mechanism prevents the payment from being charged twice?",
      opts: [
        "Increase the client timeout",
        "Use a circuit breaker in the gateway",
        "Send an idempotency key and have the server deduplicate requests with the same key",
        "Replace POST with GET"
      ],
      correct: 2,
      fb: "A timeout does not mean failure: the server may have processed the first request. With an Idempotency-Key (e.g. a UUID generated by the client), the server stores the result of the first execution and returns the same result on repeats. Retry without idempotency is a classic source of duplicate charges."
    }
  ];

  var checkEn = [
    { cat: "Communication fundamentals", items: [
      "I practice thinking out loud while solving design problems",
      "I can make explicit transitions between stages ('now I'll identify the bottlenecks...')",
      "I have the habit of asking about scope before proposing any architecture",
      "I state assumptions explicitly instead of assuming silently"
    ]},
    { cat: "Estimates (back-of-envelope)", items: [
      "I can convert users into req/s (e.g. 10M DAU × 1 req/day ÷ 86400s ≈ 116 req/s)",
      "I can estimate storage needs (e.g. 1M users × 100KB = 100GB)",
      "I can estimate the required bandwidth given throughput and average request size",
      "I know the orders of magnitude: RAM latency (<1μs), SSD (~100μs), disk (~10ms), network (~100ms)",
      "I can convert an SLO (99.9%, 99.99%) into allowed downtime per month and per year"
    ]},
    { cat: "Technical concepts", items: [
      "I can explain horizontal vs. vertical scaling with tradeoffs",
      "I can explain consistent hashing and why it minimizes remapping when nodes are added",
      "I can describe the LRU, LFU and TTL policies and when to use each one",
      "I can explain write-through vs. write-back and the tradeoffs of each strategy",
      "I understand the difference between bandwidth, throughput and latency, with examples",
      "I can describe the Map → Shuffle → Reduce flow in MapReduce",
      "I know when to use SQL vs. NoSQL (Key-Value, Document, Column-family, Graph)",
      "I can explain the CAP theorem and give examples of CP vs AP systems"
    ]},
    { cat: "Platform & operations", items: [
      "I can explain the role of an API Gateway (routing, authentication, rate limiting)",
      "I know token bucket and sliding window for rate limiting",
      "I can combine timeout, retry with backoff + jitter and circuit breaker",
      "I can explain why retries require idempotency",
      "I can tell logs, metrics and traces apart and what each one answers",
      "I can define SLI, SLO, SLA and error budget"
    ]},
    { cat: "Interview practice", items: [
      "I have practiced at least 5 complete system design problems (URL shortener, Instagram, etc.)",
      "I can draw a system with load balancer + app servers + cache + DB + queue",
      "I spot single points of failure in proposed architectures",
      "I can propose solutions for the most common bottlenecks (DB, app server, cache miss)",
      "I have answers ready for 'why did you choose X and not Y?'"
    ]}
  ];

  /* Language from <html lang>: "pt…" → Portuguese, anything else → English. */
  var I18N = {
    pt: {
      quiz: quizPt, check: checkPt,
      question: "Questão", of: " de ", correct: " corretas",
      ok: "✓ Correto! ", wrong: "✗ Não exatamente. ", items: " itens", all: "Todos"
    },
    en: {
      quiz: quizEn, check: checkEn,
      question: "Question", of: " of ", correct: " correct",
      ok: "✓ Correct! ", wrong: "✗ Not quite. ", items: " items", all: "All"
    }
  };

  var lang = "en";
  var T = I18N.en;
  var quizAll = T.quiz;     /* every question of the page */
  var quizData = T.quiz;    /* the questions shown (after the topic filter) */
  var checkData = T.check;
  var STORAGE_KEY = "iv-2026.2-checklist-en";
  var currentQ = 0;
  var answered = {};        /* index in quizAll → chosen option */
  var topic = "";           /* "" = all topics */
  var checks = {};

  function $(id) { return document.getElementById(id); }

  function loadChecks() {
    try { checks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (e) { checks = {}; }
  }

  function saveChecks() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(checks)); }
    catch (e) { /* storage unavailable: keep in memory only */ }
  }

  /* ─── QUIZ ─── */
  function indexOf(q) { return quizAll.indexOf(q); }

  function renderFilter() {
    var box = $("iv-quiz-filter");
    if (!box) return;
    var topics = [];
    quizAll.forEach(function (q) {
      if (q.topic && topics.indexOf(q.topic) < 0) topics.push(q.topic);
    });
    if (!topics.length) { box.innerHTML = ""; return; }
    box.innerHTML = [""].concat(topics).map(function (t) {
      return '<button type="button" class="btn-ghost' + (t === topic ? " on" : "") +
        '" data-iv-topic="' + t + '">' + (t || T.all) + "</button>";
    }).join("");
  }

  function renderQuiz() {
    if (!$("iv-qtext")) return;
    renderFilter();
    if (!quizData.length) return;
    var q = quizData[currentQ];
    var ans = answered[indexOf(q)];
    $("iv-qnum").textContent = T.question + " " + (currentQ + 1) + T.of + quizData.length;
    $("iv-qpf").style.width = ((currentQ + 1) / quizData.length * 100) + "%";
    $("iv-qtext").textContent = q.q;

    $("iv-qopts").innerHTML = q.opts.map(function (o, i) {
      var cls = "";
      if (ans !== undefined) {
        if (i === q.correct) cls = " correct";
        else if (ans === i) cls = " wrong";
      }
      return '<button type="button" class="quiz-opt' + cls + '" data-iv-answer="' + i + '"' +
        (ans !== undefined ? " disabled" : "") + ">" +
        String.fromCharCode(65 + i) + ". " + o + "</button>";
    }).join("");

    var fb = $("iv-qfb");
    if (ans !== undefined) {
      var ok = ans === q.correct;
      fb.innerHTML = '<div class="quiz-fb ' + (ok ? "correct" : "wrong") + '">' +
        (ok ? T.ok : T.wrong) + q.fb + "</div>";
    } else {
      fb.innerHTML = "";
    }

    var keys = Object.keys(answered);
    var correct = keys.filter(function (k) { return answered[k] === quizAll[k].correct; }).length;
    $("iv-qscore").textContent = keys.length > 0 ? correct + "/" + keys.length + T.correct : "";
  }

  /* ─── CHECKLIST ─── */
  function renderChecklist() {
    var container = $("iv-checklist");
    if (!container) return;
    var html = "";
    var total = 0, done = 0;
    checkData.forEach(function (cat, ci) {
      html += '<div class="check-cat">' + cat.cat + "</div>";
      cat.items.forEach(function (item, ii) {
        var key = ci + "-" + ii;
        var on = !!checks[key];
        total++; if (on) done++;
        html += '<div class="check-item" role="checkbox" tabindex="0" aria-checked="' + on + '" data-iv-check="' + key + '">' +
          '<div class="check-box' + (on ? " done" : "") + '">' + (on ? "✓" : "") + "</div>" +
          '<div class="check-text' + (on ? " done" : "") + '">' + item + "</div>" +
          "</div>";
      });
    });
    container.innerHTML = html;
    var progress = $("iv-check-progress");
    if (progress) progress.textContent = done + T.of + total + T.items;
  }

  function setLanguage() {
    var htmlLang = (document.documentElement.lang || "").toLowerCase();
    lang = htmlLang.indexOf("pt") === 0 ? "pt" : "en";
    T = I18N[lang];
    quizAll = T.quiz;
    checkData = T.check;
    STORAGE_KEY = "iv-2026.2-checklist-" + lang;

    /* Page-provided data overrides the built-in 2026.2 data. */
    var el = document.querySelector(".iv script.iv-quiz-data");
    if (!el) return;
    try {
      var data = JSON.parse(el.textContent);
      var d = data[lang] || data.en || data.pt || {};
      if (d.quiz) quizAll = d.quiz;
      if (d.check) checkData = d.check;
      if (data.key) STORAGE_KEY = "iv-" + data.key + "-checklist-" + lang;
    } catch (e) { /* malformed data: keep the defaults */ }
  }

  function applyTopic() {
    quizData = topic ? quizAll.filter(function (q) { return q.topic === topic; }) : quizAll;
    currentQ = 0;
  }

  function init() {
    if (!document.querySelector(".iv")) return;
    setLanguage();
    topic = "";
    applyTopic();
    answered = {};
    loadChecks();
    renderQuiz();
    renderChecklist();
  }

  /* One delegated listener survives instant navigation. */
  document.addEventListener("click", function (ev) {
    var root = ev.target.closest(".iv");
    if (!root) return;

    var acc = ev.target.closest(".acc-header");
    if (acc) {
      var item = acc.closest(".acc-item");
      item.classList.toggle("open");
      acc.setAttribute("aria-expanded", item.classList.contains("open"));
      return;
    }

    var opt = ev.target.closest("[data-iv-answer]");
    if (opt) {
      var qi = indexOf(quizData[currentQ]);
      if (answered[qi] === undefined) {
        answered[qi] = parseInt(opt.getAttribute("data-iv-answer"), 10);
        renderQuiz();
      }
      return;
    }

    var tb = ev.target.closest("[data-iv-topic]");
    if (tb) {
      topic = tb.getAttribute("data-iv-topic");
      applyTopic();
      renderQuiz();
      return;
    }

    if (ev.target.closest("[data-iv-prev]")) {
      if (currentQ > 0) { currentQ--; renderQuiz(); }
      return;
    }
    if (ev.target.closest("[data-iv-next]")) {
      if (currentQ < quizData.length - 1) { currentQ++; renderQuiz(); }
      return;
    }
    if (ev.target.closest("[data-iv-quiz-reset]")) {
      topic = ""; applyTopic(); answered = {}; renderQuiz();
      return;
    }

    var chk = ev.target.closest("[data-iv-check]");
    if (chk) {
      var key = chk.getAttribute("data-iv-check");
      checks[key] = !checks[key];
      saveChecks();
      renderChecklist();
      return;
    }

    if (ev.target.closest("[data-iv-check-reset]")) {
      checks = {};
      saveChecks();
      renderChecklist();
    }
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== " " && ev.key !== "Enter") return;
    var chk = ev.target.closest && ev.target.closest(".iv [data-iv-check]");
    if (!chk) return;
    ev.preventDefault();
    chk.click();
  });

  if (typeof window.document$ !== "undefined" && window.document$.subscribe) {
    window.document$.subscribe(init);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
