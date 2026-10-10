/*
 * Interview Material (2026.2) — accordion, quiz and checklist.
 * Loaded on every page via extra_javascript; it only acts when a `.iv`
 * container is present. Re-initializes on Material's instant navigation.
 */
(function () {
  var quizData = [
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

  var checkData = [
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

  var STORAGE_KEY = "iv-2026.2-checklist";
  var currentQ = 0;
  var answered = {};
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
  function renderQuiz() {
    if (!$("iv-qtext")) return;
    var q = quizData[currentQ];
    var ans = answered[currentQ];
    $("iv-qnum").textContent = "Questão " + (currentQ + 1) + " de " + quizData.length;
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
        (ok ? "✓ Correto! " : "✗ Não exatamente. ") + q.fb + "</div>";
    } else {
      fb.innerHTML = "";
    }

    var keys = Object.keys(answered);
    var correct = keys.filter(function (k) { return answered[k] === quizData[k].correct; }).length;
    $("iv-qscore").textContent = keys.length > 0 ? correct + "/" + keys.length + " corretas" : "";
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
    if (progress) progress.textContent = done + " de " + total + " itens";
  }

  function init() {
    if (!document.querySelector(".iv")) return;
    currentQ = 0;
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
      if (answered[currentQ] === undefined) {
        answered[currentQ] = parseInt(opt.getAttribute("data-iv-answer"), 10);
        renderQuiz();
      }
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
      currentQ = 0; answered = {}; renderQuiz();
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
