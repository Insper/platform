/*
 * Retrieval for RAG: vector, keyword or hybrid search (2027.1, class 13 — RAG & Memory):
 *
 *   <div class="csim" data-sim="rag-hybrid" data-question="sector" data-mode="vector"></div>
 *
 * Nine chunks of BoxOffice's knowledge base (two venues) and three fan questions. Each question has an
 * illustrative cosine similarity per chunk (with and without contextual chunks — the document title
 * and section prepended before embedding) and a keyword ranking. The search returns the vector
 * ranking, the keyword ranking, or both fused with Reciprocal Rank Fusion, RRF(d) = Σ 1 / (60 + rank);
 * a minimum similarity drops weak vector hits; the top k chunks go into the prompt, ~400 tokens each.
 * The verdict says what the model can do with that context: cite the right chunk, be misled by another
 * venue's rule that ranks above it, or only say "I don't know".
 */
(function () {
  "use strict";

  var RRF_K = 60, CHUNK_TOKENS = 400;
  /* lab 12 retrieves the top RETRIEVE_K = 5 events by vector search (config.py); registered in lab-values.mjs */
  var LAB = { k: 5 };

  var CHUNKS = {
    A: { title: "Arena Paulista — Accessibility guide", text: "Sector C: step-free route from gate 4; PCD seats in rows 1 and 2.",
      pt: "Setor C: rota sem degraus a partir do portão 4; lugares PCD nas fileiras 1 e 2." },
    B: { title: "Arena Paulista — Accessibility guide", text: "Wheelchair-accessible entrances and lifts at gates 1 and 7.",
      pt: "Entradas acessíveis para cadeira de rodas e elevadores nos portões 1 e 7." },
    D: { title: "Estádio Sul — Accessibility", text: "Ramps give step-free access to every sector.",
      pt: "Rampas dão acesso sem degraus a todos os setores." },
    E: { title: "Arena Paulista — FAQ", text: "Sector C opens at 18:00; food stands are behind sector C.",
      pt: "O setor C abre às 18:00; as lanchonetes ficam atrás do setor C." },
    F: { title: "Arena Paulista — Visitor rules 2027 — §6", text: "Strollers must be folded at the gates.",
      pt: "Carrinhos de bebê devem ser dobrados nos portões." },
    G: { title: "Arena Paulista — Parking", text: "Accessible parking spaces are on level P2.",
      pt: "As vagas acessíveis ficam no piso P2." },
    H: { title: "Arena Paulista — Visitor rules 2027 — §4 Prohibited items", text: "Professional cameras with detachable lenses are not permitted.",
      pt: "Câmeras profissionais com lentes destacáveis não são permitidas." },
    J: { title: "Estádio Sul — Visitor rules", text: "Cameras of any kind are allowed; tripods are not.",
      pt: "Câmeras de qualquer tipo são permitidas; tripés, não." },
    L: { title: "Arena Paulista — Visitor rules 2027 — §5", text: "Bags larger than an A4 sheet are not permitted.",
      pt: "Bolsas maiores que uma folha A4 não são permitidas." }
  };

  /* per question: the right chunk (gold), a misleading one (another venue), similarities without and
     with contextual chunks, and the keyword ranking without and with the titles (illustrative values) */
  var QUESTIONS = {
    sector: {
      en: "Is there step-free access to sector C at Arena Paulista?", pt: "Tem acesso sem degraus ao setor C na Arena Paulista?",
      gold: "A", wrong: "D",
      sim: { plain: { B: 0.84, D: 0.83, A: 0.79, G: 0.71, E: 0.66, F: 0.58, L: 0.52, H: 0.50, J: 0.49 },
             ctx: { B: 0.85, A: 0.82, D: 0.78, G: 0.72, E: 0.68, F: 0.59, L: 0.54, H: 0.52, J: 0.47 } },
      kw: { plain: ["A", "E", "D"], ctx: ["A", "E", "D", "B", "G"] }
    },
    camera: {
      en: "Can I bring my camera to Arena Paulista?", pt: "Posso levar minha câmera à Arena Paulista?",
      gold: "H", wrong: "J",
      sim: { plain: { J: 0.81, H: 0.74, L: 0.58, F: 0.55, E: 0.52, B: 0.50, A: 0.48, G: 0.47, D: 0.45 },
             ctx: { H: 0.86, J: 0.76, L: 0.70, F: 0.66, E: 0.60, B: 0.57, A: 0.55, G: 0.54, D: 0.44 } },
      kw: { plain: ["J", "H"], ctx: ["H", "J", "L", "F", "E", "A", "B", "G"] }
    },
    pool: {
      en: "Is there a swimming pool at Arena Paulista?", pt: "Tem piscina na Arena Paulista?",
      gold: null, wrong: null,
      sim: { plain: { F: 0.52, B: 0.50, G: 0.49, E: 0.47, L: 0.46, A: 0.45, H: 0.44, D: 0.41, J: 0.40 },
             ctx: { G: 0.57, F: 0.56, B: 0.55, E: 0.54, L: 0.53, A: 0.53, H: 0.52, D: 0.40, J: 0.39 } },
      kw: { plain: [], ctx: ["A", "B", "E", "F", "G", "H", "L"] }
    }
  };

  function rrf(ranks) { return ranks.reduce(function (sum, r) { return sum + 1 / (RRF_K + r); }, 0); }

  /*
   * search({question, mode: "vector" | "keyword" | "hybrid", k, min, ctx}) →
   *   {vector: [{id, sim}], keyword: [id], fused: [{id, score, vr, kr}], context: [ids], goldRank, verdict, tokens}
   */
  function search(o) {
    var q = QUESTIONS[o.question], ctx = o.ctx ? "ctx" : "plain", min = o.min || 0;
    var sims = q.sim[ctx];
    var vector = Object.keys(sims).map(function (id) { return { id: id, sim: sims[id] }; })
      .sort(function (a, b) { return b.sim - a.sim; })
      .filter(function (h) { return h.sim >= min; });
    var keyword = q.kw[ctx].slice();
    var fused;
    if (o.mode === "keyword") fused = keyword.map(function (id, i) { return { id: id, score: null, kr: i + 1 }; });
    else if (o.mode === "vector") fused = vector.map(function (h, i) { return { id: h.id, score: h.sim, vr: i + 1 }; });
    else {
      var all = {};
      vector.forEach(function (h, i) { (all[h.id] = all[h.id] || { id: h.id, ranks: [] }).vr = i + 1; all[h.id].ranks.push(i + 1); });
      keyword.forEach(function (id, i) { (all[id] = all[id] || { id: id, ranks: [] }).kr = i + 1; all[id].ranks.push(i + 1); });
      fused = Object.keys(all).map(function (id) { var d = all[id]; return { id: id, score: rrf(d.ranks), vr: d.vr, kr: d.kr }; })
        .sort(function (a, b) { return b.score - a.score || (a.vr || 99) - (b.vr || 99); });
    }
    var context = fused.slice(0, o.k).map(function (d) { return d.id; });
    var goldRank = q.gold ? fused.map(function (d) { return d.id; }).indexOf(q.gold) + 1 : 0;
    var inCtx = q.gold && context.indexOf(q.gold) >= 0;
    var wrongAt = q.wrong ? context.indexOf(q.wrong) : -1;
    var verdict;
    if (!context.length) verdict = q.gold ? "nothing-miss" : "nothing-ok";
    else if (!q.gold) verdict = "unrelated";
    else if (wrongAt >= 0 && (!inCtx || wrongAt < context.indexOf(q.gold))) verdict = "misled";
    else if (inCtx) verdict = "grounded";
    else verdict = "missing";
    return { vector: vector, keyword: keyword, fused: fused, context: context, goldRank: goldRank, verdict: verdict,
      tokens: context.length * CHUNK_TOKENS, mrr: inCtx ? 1 / (context.indexOf(q.gold) + 1) : 0 };
  }

  var API = { LAB: LAB, search: search, rrf: rrf, CHUNKS: CHUNKS, QUESTIONS: QUESTIONS, RRF_K: RRF_K, CHUNK_TOKENS: CHUNK_TOKENS };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

  /* ------------------------------------------------------------------ UI */

  var C = window.CSim, t = C.t, el = C.el, PT = C.PT;
  function n4(x) { return x.toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }
  function n2(x) { return x.toLocaleString(PT ? "pt-BR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function n0(x) { return x.toLocaleString(PT ? "pt-BR" : "en-US"); }

  C.style("rag-hybrid", [
    ".md-typeset .csim-rh-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; }",
    "@media (max-width: 44rem) { .md-typeset .csim-rh-cols { grid-template-columns: 1fr; } }",
    ".md-typeset .csim-rh-list { list-style: none; margin: .2rem 0 0; padding: 0; counter-reset: rh; }",
    ".md-typeset .csim-rh-list li { margin: 0 0 .25rem; padding: .2rem .35rem; border: 1px solid var(--c-line); border-left-width: .2rem; border-radius: .2rem; font-size: .6rem; line-height: 1.3; background: var(--c-bg); }",
    ".md-typeset .csim-rh-list li.in { background: var(--c-tint); border-color: var(--c-ink); }",
    ".md-typeset .csim-rh-list li.gold { border-left-color: var(--c-ok); }",
    ".md-typeset .csim-rh-list li.wrong { border-left-color: var(--c-bad); }",
    ".md-typeset .csim-rh-list li.off { opacity: .45; }",
    ".md-typeset .csim-rh-list li b { font-variant-numeric: tabular-nums; }",
    ".md-typeset .csim-rh-list li small { display: block; color: var(--c-fg2); }",
    ".md-typeset .csim-rh-cut { border-top: .1rem dashed var(--c-ink); margin: .3rem 0; font-size: .55rem; color: var(--c-ink); text-align: right; }",
    ".md-typeset .csim-rh-q { font-weight: 600; margin: .2rem 0; }",
    ".md-typeset .csim-rh-cols .csim-lbl { display: block; white-space: normal; min-height: 1.6rem; }"
  ].join("\n"));

  C.register("rag-hybrid", function (root) {
    var o = C.opts(root, { question: "sector", mode: "vector", k: LAB.k });
    var cfg = { question: QUESTIONS[o.question] ? o.question : "sector", mode: o.mode, k: o.k, min: 0.4, ctx: false };

    var note = el("p", { class: "csim-note" });
    var qline = el("p", { class: "csim-rh-q" });
    var colV = el("div"), colK = el("div"), colF = el("div");
    var tiles = C.stats([
      { key: "rank", label: t("rank of the right chunk", "posição do chunk certo") },
      { key: "chunks", label: t("chunks in the prompt", "chunks no prompt") },
      { key: "tokens", label: t("extra input tokens per call", "tokens de entrada extras por chamada") },
      { key: "verdict", label: t("what the model can do", "o que o modelo consegue fazer") }
    ]);

    var cQ = C.choice({ label: t("Question", "Pergunta"), value: cfg.question, options: [
      { value: "sector", label: t("sector C", "setor C") }, { value: "camera", label: t("camera", "câmera") }, { value: "pool", label: t("pool", "piscina") }
    ], onChange: function (v) { cfg.question = v; draw(); } });
    var cMode = C.choice({ label: t("Search", "Busca"), value: cfg.mode, options: [
      { value: "vector", label: t("vector", "vetorial") }, { value: "keyword", label: t("keyword", "palavra-chave") }, { value: "hybrid", label: t("hybrid (RRF)", "híbrida (RRF)") }
    ], onChange: function (v) { cfg.mode = v; draw(); } });
    var sK = C.slider({ label: "top-k", min: 1, max: 8, value: cfg.k, onInput: function (v) { cfg.k = v; draw(); } });
    var sMin = C.slider({ label: t("min. similarity", "similaridade mín."), min: 0.4, max: 0.9, step: 0.05, value: cfg.min,
      fmt: function (v) { return v <= 0.4 ? t("off", "desligada") : n2(v); }, onInput: function (v) { cfg.min = v; draw(); } });
    var tCtx = C.toggle({ label: t("contextual chunks (title + section)", "chunks com contexto (título + seção)"), checked: cfg.ctx, onChange: function (v) { cfg.ctx = v; draw(); } });

    function say(text, tone) { note.textContent = text; note.className = "csim-note" + (tone ? " csim-" + tone : ""); }

    function item(id, q, inCtx, label, off) {
      var c = CHUNKS[id];
      return el("li", { class: (inCtx ? "in" : "") + (id === q.gold ? " gold" : "") + (id === q.wrong ? " wrong" : "") + (off ? " off" : ""),
        title: id === q.gold ? t("the chunk that answers", "o chunk que responde") : id === q.wrong ? t("another venue's rule", "a regra de outro local") : "" }, [
        el("b", { text: label }), " ",
        cfg.ctx ? el("small", { text: c.title }) : null,
        PT ? c.pt : c.text
      ]);
    }

    function column(node, head, rows, cut) {
      C.clear(node);
      node.appendChild(el("div", { class: "csim-lbl", text: head }));
      var list = el("ol", { class: "csim-rh-list" });
      if (!rows.length) list.appendChild(el("li", { class: "off", text: t("(nothing)", "(nada)") }));
      rows.forEach(function (r, i) {
        if (cut && i === cut) list.appendChild(el("li", { class: "csim-rh-cut", text: "top-k = " + cut }));
        list.appendChild(r);
      });
      node.appendChild(list);
    }

    function draw() {
      var q = QUESTIONS[cfg.question], r = search(cfg);
      qline.textContent = "“" + (PT ? q.pt : q.en) + "”";
      var ctxSet = {};
      r.context.forEach(function (id) { ctxSet[id] = true; });
      var direct = cfg.mode !== "hybrid";
      column(colV, t("Vector ranking (cosine similarity)", "Ranking vetorial (similaridade de cosseno)"),
        r.vector.map(function (h, i) { return item(h.id, q, cfg.mode === "vector" && ctxSet[h.id], (i + 1) + " · " + n2(h.sim), cfg.mode === "keyword"); }),
        cfg.mode === "vector" ? cfg.k : 0);
      column(colK, t("Keyword ranking (BM25-style)", "Ranking por palavra-chave (estilo BM25)"),
        r.keyword.map(function (id, i) { return item(id, q, cfg.mode === "keyword" && ctxSet[id], String(i + 1), cfg.mode === "vector"); }),
        cfg.mode === "keyword" ? cfg.k : 0);
      column(colF, direct ? t("Prompt context (top-k)", "Contexto do prompt (top-k)") : t("Hybrid: RRF = Σ 1 / (60 + rank)", "Híbrida: RRF = Σ 1 / (60 + posição)"),
        (direct ? r.context.map(function (id) { return { id: id }; }) : r.fused).map(function (d, i) {
          var lab = direct ? String(i + 1) : (i + 1) + " · " + n4(d.score) + "  (" + (d.vr ? "v" + d.vr : "") + (d.vr && d.kr ? " + " : "") + (d.kr ? "k" + d.kr : "") + ")";
          return item(d.id, q, ctxSet[d.id], lab, false);
        }), direct ? 0 : cfg.k);

      tiles.set("rank", q.gold ? (r.goldRank ? String(r.goldRank) : t("not found", "não achado")) : "—", !q.gold ? "" : r.goldRank && r.goldRank <= cfg.k ? "ok" : "bad");
      tiles.set("chunks", String(r.context.length), "");
      tiles.set("tokens", "+" + n0(r.tokens), r.tokens > 2000 ? "warn" : "");
      var V = {
        grounded: [t("cite it", "citá-lo"), "ok", "The right chunk is in the prompt" + (r.mrr < 1 ? " (at position " + (r.context.indexOf(q.gold) + 1) + ")" : ", first") + ": the model can answer and cite it. Every other chunk is " + CHUNK_TOKENS + " tokens paid on every call.",
          "O chunk certo está no prompt" + (r.mrr < 1 ? " (na posição " + (r.context.indexOf(q.gold) + 1) + ")" : ", em primeiro") + ": o modelo pode responder e citá-lo. Cada outro chunk são " + CHUNK_TOKENS + " tokens pagos em toda chamada."],
        misled: [t("be misled", "ser enganado"), "bad", "Another venue's rule (" + CHUNKS[q.wrong].title + ") " + (r.goldRank && r.goldRank <= cfg.k ? "ranks above the right chunk" : "is in the prompt and the right chunk is not") + ": a fluent, cited and wrong answer is likely.",
          "A regra de outro local (" + CHUNKS[q.wrong].title + ") " + (r.goldRank && r.goldRank <= cfg.k ? "vem acima do chunk certo" : "está no prompt e o chunk certo não") + ": uma resposta fluente, citada e errada é provável."],
        missing: [t("\"I don't know\"", "\"não sei\""), "warn", "The right chunk is not in the top " + cfg.k + ": at best the model says it does not know, at worst it guesses.",
          "O chunk certo não está entre os " + cfg.k + " primeiros: no melhor caso o modelo diz que não sabe, no pior ele chuta."],
        "nothing-miss": [t("\"I don't know\"", "\"não sei\""), "warn", "Nothing passed the similarity threshold, although the answer exists: the threshold is too strict for this question.",
          "Nada passou do limiar de similaridade, embora a resposta exista: o limiar está rígido demais para esta pergunta."],
        "nothing-ok": [t("\"I don't know\"", "\"não sei\""), "ok", "Nothing passed the similarity threshold: the assistant says it does not know — the right answer, for free.",
          "Nada passou do limiar de similaridade: o assistente diz que não sabe — a resposta certa, de graça."],
        unrelated: [t("must refuse", "deve recusar"), "warn", "No chunk answers this question, yet " + r.context.length + " unrelated chunks fill the prompt: only the instruction \"say you don't know\" stands between the fan and an invented answer.",
          "Nenhum chunk responde a esta pergunta e mesmo assim " + r.context.length + " chunks sem relação enchem o prompt: só a instrução \"diga que não sabe\" separa o fã de uma resposta inventada."]
      }[r.verdict];
      tiles.set("verdict", V[0], V[1]);
      say(PT ? V[3] : V[2], V[1]);
    }

    C.add(root, [
      el("p", { class: "csim-title", text: t("Retrieval: what reaches the prompt decides the answer", "Recuperação: o que chega ao prompt decide a resposta") }),
      el("p", { class: "csim-sub", text: t("Nine chunks of two venues' documents; similarities and keyword ranks are illustrative. Green edge: the chunk that answers; red edge: another venue's rule. Shaded: in the prompt.",
        "Nove chunks de documentos de dois locais; similaridades e posições por palavra-chave são ilustrativas. Borda verde: o chunk que responde; borda vermelha: a regra de outro local. Sombreado: no prompt.") }),
      el("div", { class: "csim-row" }, [cQ, cMode]),
      el("div", { class: "csim-row" }, [sK, sMin, tCtx]),
      qline,
      el("div", { class: "csim-rh-cols" }, [colV, colK, colF]),
      note,
      tiles
    ]);
    draw();
    return {};
  });
})();
