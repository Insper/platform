---
marp: true
lang: pt-BR
title: Hands-on 12 — Assistente de IA
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Hands-on 12 — Assistente de IA

**Gateway, geração aumentada por recuperação (RAG), ferramentas, guardrails — e o custo do primeiro token**

<!--
Roteiro: (1) o problema; (2) arquitetura; (3) uv + Ollama + pgvector; (4) o gateway;
(5) RAG e a sua avaliação; (6) ferramentas e o loop do agente; (7) guardrails; (8) métricas e TTFT.
-->

---

## Milhares das mesmas perguntas

<div class="q">

No dia da venda: *quando é o show? quanto custa? cadê o meu pedido?* Um assistente poderia responder às
3 da manhã — o que ele **não** pode fazer?

</div>

- Inventar shows, datas ou preços.
- Mostrar o pedido de um fã para outro.
- Vazar CPFs e números de cartão para um provedor terceiro.
- Custar mais que os ingressos, ou levar um minuto para começar a responder.

---

## Arquitetura

<div class="flow">
<div class="box muted">fã<small>POST /assistant/chat</small></div><div class="arrow">→</div>
<div class="box orange">guarda de entrada<small>tamanho, injection, dados pessoais (PII)</small></div><div class="arrow">→</div>
<div class="box green">recuperação<small>pgvector, top 5</small></div><div class="arrow">→</div>
<div class="box accent">loop do agente<small>≤ 4 chamadas ao modelo</small></div><div class="arrow">→</div>
<div class="box orange">guarda de saída<small>citações</small></div><div class="arrow">→</div>
<div class="box muted">resposta<small>tokens SSE + done</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: 1.2">o loop chama →</div>
<div class="box accent">gateway de modelo de linguagem (LLM)<small>LiteLLM: qwen2.5:1.5b local, claude opcional</small></div>
<div class="box green">ferramentas só de leitura<small>search_events, get_event, get_order_status</small></div>
<div class="box">métricas<small>OpenTelemetry Protocol (OTLP) → otel-lgtm</small></div>
</div>

- Serviço **FastAPI** `assistant` (porta 8088), gerenciado com **uv** (`pyproject.toml` + `uv.lock`); embeddings pelo `nomic-embed-text` (768 d).

---

## Passo 1 · uv e o runtime

```shell
uv init --app --name assistant --python 3.12 --no-readme --vcs none .
uv add fastapi "uvicorn[standard]" litellm "psycopg[binary,pool]" pgvector numpy httpx pydantic mcp ...
```

```dockerfile
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
RUN uv sync --frozen --no-dev --no-install-project
```

<div class="warn">

O Docker no macOS **não tem GPU**: rode o Ollama nativamente, `OLLAMA_URL=http://host.docker.internal:11434`.

</div>

---

## O gateway

| Preocupação | Aqui |
|---|---|
| roteamento | `local` sempre; `claude` quando `ANTHROPIC_API_KEY` está definida |
| fallback | `claude` → `local` em erros do provedor |
| timeouts, retries | 120 s, 1 retry |
| custo | tokens × tabela de preços → `assistant_llm_cost_usd_total` |

<div class="flow">
<div class="box">rota claude<small>com ANTHROPIC_API_KEY</small></div><div class="arrow">→</div>
<div class="box accent">claude-opus-5-5<small>US$ 4 / 20 por milhão de tokens</small></div><div class="arrow">queda, cota →</div>
<div class="box green">qwen2.5:1.5b local<small>US$ 0, sempre presente</small></div>
</div>

<p class="small">Um serviço: SDK dentro do processo. Muitos serviços de IA: o proxy do LiteLLM como gateway compartilhado.</p>

---

## Passo 2 · RAG com pgvector

```sql
embedding vector(768) NOT NULL
CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);
SELECT id, 1 - (embedding <=> $q) AS score FROM assistant.documents
ORDER BY embedding <=> $q LIMIT 5;
```

- Uma frase por evento: o quê, onde, quando, quanto.
- Prefixos `search_document:` / `search_query:` (o formato de treinamento do modelo).
- **HNSW** (*Hierarchical Navigable Small World*): vizinhos mais próximos aproximados — velocidade por um pouco de recall.

---

## Avalie a recuperação, não a impressão

- O seed é uma fórmula → as respostas certas são **conhecidas**.
- 11 perguntas: hit@5 = **1,00**, posição recíproca média (MRR) = **0,94**.
- O erro: "the big festival night at the stadium" → posição 3.

<div class="ok">

Nomes e datas são onde a busca vetorial é mais fraca: **busca híbrida** + **reranker**.

</div>

---

## Passo 3 · Ferramentas no formato do MCP (Model Context Protocol)

- Nome + descrição + **JSON schema** (pydantic) + handler → o que um servidor MCP expõe.
- **Só leitura**: um modelo manipulado pode, no pior caso, ler.
- **Identidade vinda do `X-User-Email`** (o gateway), nunca do modelo.
- "Não é seu" = "não encontrado": não revele que um pedido existe.
- Erros são **dados** para o modelo; toda chamada é uma métrica.

---

## O loop do agente

<div class="flow">
<div class="box green">recuperar primeiro<small>5 eventos no prompt</small></div><div class="arrow">→</div>
<div class="box accent">chamadas 1 … 3<small>ferramentas oferecidas; resultados voltam como role: tool</small></div><div class="arrow">→</div>
<div class="box orange">chamada 4<small>sem ferramentas: precisa responder</small></div><div class="arrow">→</div>
<div class="box">contabilizar<small>tokens, US$, tempo até o primeiro token (TTFT)</small></div>
</div>

- A maioria das perguntas **não precisa de ferramenta**: o contexto já está lá. Ferramentas são para dados ao vivo e privados.
- **Streaming** de todo passo; o `stream_chunk_builder` reconstrói a mensagem para ver as chamadas de ferramenta.
- O modelo de 1,5 B chamou `get_order_status` em **6 de 9** tentativas: chamadas de ferramenta pouco confiáveis são o motivo de o `run()` recuperar antes.

---

## A primeira resposta: fatos certos, sem citação

<div class="flow">
<div class="box green">recuperado<small>event:50 · 2027-03-04 · R$ 300,00</small></div><div class="arrow">→</div>
<div class="box">o modelo responde<small>data e preço certos, sem [event:50]</small></div><div class="arrow">→</div>
<div class="box orange">guarda de saída<small>sem citação → grounded: false</small></div>
</div>

- O teste: **760** tokens de prompt, **45** de resposta, US$ 0, **56 s** até o primeiro token numa CPU de notebook disputada.
- Um `[event:999]` inventado vira `[unverified]`; só contam citações de documentos que o modelo recebeu.
- Em 10 perguntas: **1** fundamentada com `qwen2.5:1.5b`, **5** com `qwen2.5:3b` — a ancoragem é propriedade de modelo + prompt.

---

## Passo 4 · Guardrails

| Verificação | Pega | Deixa passar |
|---|---|---|
| tamanho | ataques de custo | — |
| padrões de injection | "ignore previous instructions" | paráfrases, documentos injetados |
| mascaramento de PII | CPF, cartões, e-mails → `[CPF]`... | nomes, endereços |
| verificação de citações | citações inventadas ou ausentes | afirmação errada ao lado de citação válida |

<div class="warn">

Padrões são uma primeira camada. A defesa real é a **arquitetura**: ferramentas só de leitura, identidade que o modelo não consegue forjar.

</div>

---

## Sem Ollama: o simulador

<div class="flow">
<div class="box orange">3 · Perguntar<small>sem citação → grounded: false; [event:999] → [unverified]</small></div>
<div class="box green">3 · Meu pedido<small>header da ana: PENDING_PAYMENT; do bob: order not found</small></div>
<div class="box red">4 · Guardrails<small>injection → 422, sem chamar o modelo; CPF → [CPF]</small></div>
<div class="box accent">MAX_STEPS<small>4 chamadas, a última sem ferramentas</small></div>
</div>

- A página de Ferramentas repete as execuções deste lab pelos caminhos do código: as regex das guardas, o `get_order_status`, a verificação de citações.
- Modo **livre**: escolha a pergunta, o header `X-User-Email`, o que o modelo faz e o `MAX_STEPS`.
- Respostas de pedido também voltam `grounded: false`: a verificação só conhece citações do catálogo — um alarme falso que vale conhecer.

<!--
As respostas do modelo são as citadas nas páginas, ou uma alternativa indicada. A visão geral também embute o preset boxoffice-assistant do playground: chamadas ao modelo = perguntas × passos.
-->

---

## Métricas no Grafana

- `assistant_llm_tokens_total{model,type}` · `assistant_llm_cost_usd_total{model}`
- `assistant_ttft_seconds_bucket` · `assistant_duration_seconds_bucket`
- `assistant_tool_calls_total{tool,outcome}` · `assistant_guardrail_blocks_total{kind}`

<p class="small">Buckets de histograma na escala de segundos por uma View do OpenTelemetry (OTel) — os buckets padrão pressupõem milissegundos.</p>

---

<!-- _class: tight -->

## Passo 5 · Meça o primeiro token

| onde | concorrência | TTFT p50 | total p50 | tokens/s | req/min |
|---|---|---|---|---|---|
| Docker, CPU de notebook | 1 | 5,05 s | 148 s | 0,8 | 0,35 |
| Docker, CPU de notebook | 2 | 3,37 s | 127 s | 2,8 | 0,56 |
| Ollama nativo, GPU Apple | 1 | 0,19 s | 3,52 s | 64,0 | 19,27 |
| Ollama nativo, GPU Apple | 2 | 1,42 s | 3,24 s | 64,1 | 34,40 |
| Ollama nativo, GPU Apple | 4 | 4,64 s | 8,30 s | 64,0 | 24,65 |

- Dezenas de vezes mais rápido na GPU — e com o mesmo formato: um modelo, as requisições **fazem fila**, o TTFT cresce com a concorrência, req/min param de crescer depois de 2.

<p class="small">O tempo até o primeiro byte do k6 não é o TTFT: o script lê o stream de Server-Sent Events (SSE) e para no primeiro token.</p>

---

## Lei de Little, de novo

<div class="q">

120 s por resposta, 1 pergunta por minuto. Quantas requisições em andamento?

</div>

* L = λW = (1/60 s) × 120 s = **2** → o segundo fã espera pelo primeiro.
* Soluções: GPU, batching, controle de admissão, prompts menores — ou uma API hospedada.
* Custo de 20.000 perguntas no Claude Opus 5.5: 20.000 × US$ 0,006 = **US$ 120**.

---

## Pontos-chave

1. Um **gateway de LLM** isola o código de modelos, provedores, preços e falhas.
2. **RAG** ancora as respostas nos seus dados — e a recuperação precisa ser **avaliada** (hit@k, MRR).
3. **Ferramentas** para dados ao vivo e privados: só leitura, validadas por schema, identidade vinda da plataforma.
4. Loops de agente **limitados**: todo passo é latência e dinheiro.
5. **Guardrails** na entrada e na saída, mais uma arquitetura que limita o que um modelo manipulado pode fazer.
6. Meça o **TTFT**, os tokens/s e os US$ por resposta — a Lei de Little continua mandando.
