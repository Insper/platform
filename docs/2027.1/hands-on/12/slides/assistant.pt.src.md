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

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Hands-on 12 — Assistente de IA

**Gateway, RAG, ferramentas, guardrails — e o custo do primeiro token**

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

- Serviço **FastAPI** `assistant` (porta 8088), gerenciado com **uv** (`pyproject.toml` + `uv.lock`).
- **Gateway de LLM**: `Router` do LiteLLM — rota `local` (Ollama `qwen2.5:1.5b`), `claude` opcional com fallback.
- **Memória**: embeddings dos eventos do catálogo (`nomic-embed-text`, 768 d) no **pgvector**.
- **Ferramentas**: `search_events`, `get_event`, `get_order_status` — só leitura, JSON schemas.
- **Segurança**: guarda de entrada (tamanho, injection, PII) + guarda de saída (citações).
- **Métricas**: OTLP → otel-lgtm: tokens, US$, TTFT.

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
- **HNSW**: vizinhos mais próximos aproximados — velocidade por um pouco de recall.

---

## Avalie a recuperação, não a impressão

- O seed é uma fórmula → as respostas certas são **conhecidas**.
- 11 perguntas: hit@5 = **1,00**, MRR = **0,94**.
- O erro: "the big festival night at the stadium" → posição 3.

<div class="ok">

Nomes e datas são onde a busca vetorial é mais fraca: **busca híbrida** + **reranker**.

</div>

---

## Passo 3 · Ferramentas, no estilo do MCP

- Nome + descrição + **JSON schema** (pydantic) + handler → o que um servidor MCP expõe.
- **Só leitura**: um modelo manipulado pode, no pior caso, ler.
- **Identidade vinda do `X-User-Email`** (o gateway), nunca do modelo.
- "Não é seu" = "não encontrado": não revele que um pedido existe.
- Erros são **dados** para o modelo; toda chamada é uma métrica.

---

## O loop do agente

1. **Recupere primeiro**: top-k eventos no prompt — a maioria das perguntas não precisa de ferramenta.
2. Até **4** chamadas ao modelo; a última sem ferramentas.
3. **Streaming** de todo passo; reconstrua a mensagem para ver as chamadas de ferramenta.
4. Resultados das ferramentas voltam como `role: tool` — dados, não instruções.
5. Contabilize: tokens, US$, TTFT, duração.

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

## Métricas no Grafana

- `assistant_llm_tokens_total{model,type}` · `assistant_llm_cost_usd_total{model}`
- `assistant_ttft_seconds_bucket` · `assistant_duration_seconds_bucket`
- `assistant_tool_calls_total{tool,outcome}` · `assistant_guardrail_blocks_total{kind}`

<p class="small">Buckets de histograma na escala de segundos por uma View do OTel — os buckets padrão pressupõem milissegundos.</p>

---

<!-- _class: tight -->

## Passo 5 · Meça o primeiro token

| concorrência | TTFT p50 | total p50 | tokens/s | req/min |
|---|---|---|---|---|
| 1 | 5,05 s | 148 s | 0,8 | 0,35 |
| 2 | 3,37 s | 127 s | 2,8 | 0,56 |

<p class="small">qwen2.5:1.5b numa CPU de notebook ocupada, no Docker. O tempo até o primeiro byte do k6 não é o TTFT: o script lê o stream SSE.</p>

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
