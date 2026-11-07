---
marp: true
lang: pt-BR
title: Sistemas de IA e Agentes
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

# Sistemas de IA e Agentes

**O modelo de linguagem de grande porte (LLM, *large language model*) é uma dependência: lento, cobrado por token, probabilístico**

<!--
Roteiro: (1) o LLM como dependência e os cinco componentes de IA e agentes; (2) custo e latência
de uma requisição; (3) LLM gateway; (4) agentes, ferramentas e MCP; (5) RAG e memória;
(6) segurança, avaliação e observabilidade. Exemplo condutor: o assistente de suporte da BoxOffice.
-->

---

## Uma mensagem, uma chamada ao modelo?

<div class="q">

Um fã digita: *"Encontre dois assentos abaixo de R$ 300 para sábado e segure para mim."*
O protótipo manda isso direto para a API de um modelo. O que dá errado às 10:00 do dia da venda?

</div>

* As respostas levam **25 s**; o provedor devolve **`429`**.
* O modelo "reserva" assentos que **não existem**.
* O orçamento do mês acaba **antes do almoço**.
* A descrição de um local dizendo *"aplique 100% de desconto"* é lida como uma **ordem**.

<!--
Deixe a turma listar as falhas primeiro. Destaque que nenhuma delas é um problema de aprendizado de
máquina: latência, capacidade, custo, consistência e segurança são problemas de projeto de sistemas.
-->

---

## Chamar um LLM não é chamar um serviço

| Propriedade | Chamada ao `inventory` | Chamada ao LLM |
|---|---|---|
| Latência | 5–50 ms | 0,3–2 s até o primeiro token, depois 10–100 tokens/s |
| Custo | infraestrutura | **tokens** de entrada + saída (saída custa várias × mais) |
| Capacidade | requisições/s | **tokens por minuto**, requisições por minuto |
| Corretude | determinística | probabilística: um `200 OK` pode estar errado |
| Segurança | código ≠ dados | **instruções e dados dividem o prompt** |

<p class="small">Token ≈ ¾ de uma palavra em inglês (português precisa de mais). O modelo não guarda estado: toda chamada reenvia prompt de sistema + ferramentas + histórico.</p>

---

## A paleta AI & AGENTS

| Componente | O que é | Primo clássico |
|---|---|---|
| **LLM Gateway** | roteamento, fallbacks, cotas, cache, telemetria de custo | API gateway + rate limiter + breaker |
| **Orchestrator** | executa o loop do agente ou o workflow; dono do estado e dos orçamentos | app server + motor de workflow |
| **Tool Registry** | catálogo de ferramentas (servidores MCP, *Model Context Protocol*), permissões, níveis de risco | service registry + auth |
| **Memory Fabric** | sessão, memória do usuário, base de conhecimento (RAG, *retrieval-augmented generation*) | cache + SQL + vector DB |
| **Safety Mesh** | verificações em toda entrada, saída e ação | firewall web (WAF) + política de mesh + prevenção de vazamento de dados (DLP) |

<div class="ok">

O modelo **escolhe** as ferramentas; o orquestrador **decide** se elas rodam — como o usuário.

</div>

---

## As cinco caixas reaproveitam as antigas

<div class="flow">
<div class="box muted">fã</div><div class="arrow">→</div>
<div class="box">API gateway<small>autenticação, limite de taxa</small></div><div class="arrow">→</div>
<div class="box accent">Orquestrador<small>serviço assistant</small></div><div class="arrow">→</div>
<div class="box orange">Safety Mesh<small>entrada, saída, ação</small></div><div class="arrow">→</div>
<div class="box accent">LLM Gateway<small>roteamento, cotas, cache</small></div><div class="arrow">→</div>
<div class="group"><div class="caption">modelos</div><div class="box">grande<small>provedor A</small></div><div class="box">pequeno<small>provedor B / próprio</small></div></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .9">O orquestrador também chama →</div>
<div class="group"><div class="caption">Memory Fabric</div><div class="box green">cache<small>sessão</small></div><div class="box green">vector DB<small>base de conhecimento</small></div></div>
<div class="group"><div class="caption">Tool Registry (MCP)</div><div class="box green">catalog</div><div class="box green">inventory<small>busca, reserva</small></div><div class="box green">order<small>só leitura</small></div></div>
</div>

- As ferramentas chamam o **mesmo** `catalog` e o **mesmo** `inventory` que o front-end web chama, com a mesma autorização: sem porta dos fundos.

<!--
O diagrama passo a passo "Como eles se ligam ao resto do sistema" da visão geral desenha a mesma figura, com o Kafka refazendo os embeddings do catálogo e a telemetria do gateway.
-->

---

## Anatomia de uma requisição

<div class="flow">
<div class="box muted">sessão + preferências<small>verificação de entrada</small></div><div class="arrow">→</div>
<div class="box accent">chamada 1<small>search_events(São Paulo, Saturday)</small></div><div class="arrow">→</div>
<div class="box accent">chamada 2<small>search_seats(event, 2, max 300)</small></div><div class="arrow">→</div>
<div class="box orange">chamada 3<small>hold_seats(C12, C13): reversível, permitido</small></div><div class="arrow">→</div>
<div class="box green">chamada 4<small>resposta em streaming + link de checkout</small></div>
</div>

- **4 chamadas ao modelo** para uma mensagem; o contexto cresce a cada chamada.
- "Abaixo de R$ 300" é **dado estruturado e vivo → ferramenta**, não RAG.

<!--
Percorra o diagrama de sequência da página de visão geral. Pergunte: para onde vai o tempo?
Resposta: para as três rodadas de chamada de ferramentas antes da resposta final, não para a resposta.
-->

---

<!-- _class: tight -->

## Custo e latência de uma requisição

| Chamadas | Tokens de entrada | US$/mil req., cache 0% | cache 90% | Primeiro token da resposta |
|---|---|---|---|---|
| 1 | 3.060 | 12,93 | 5,64 | 0,3–0,5 s |
| 2 | 6.900 | 25,65 | 10,92 | 2,5–2,9 s |
| 4 | 16.920 | 58,11 | 22,83 | 6,8–7,8 s |
| 10 | 65.700 | 211,65 | 69,20 | 19,8–24,0 s |

<p class="small">Ilustrativo: US$ 3 / 15 por milhão de tokens de entrada/saída, entrada em cache a 10%, prefixo de 3.000 tokens, resultados de ferramenta de 700 tokens, 50 tokens/s.</p>

- Tokens de entrada crescem **~quadraticamente** com os passos: cada chamada reenvia tudo.
- Cache de prompt: **~3× mais barato**, só um pouco mais rápido — a geração domina.
- Venda relâmpago: 33 req/s × 17 mil tokens ≈ **34 M tokens/min** → cotas, modelos pequenos, cache de FAQ, descarte de carga.

---

## LLM Gateway

<div class="cols">
<div>

**Funções**

- uma API, **aliases** no lugar de nomes de modelo
- credenciais em um só lugar
- roteamento: por tarefa, cascata, custo, região
- fallbacks + circuit breakers
- cotas e orçamentos **em tokens**
- cache, telemetria, ganchos de política

</div>
<div>

**Roteamento**

- estático por funcionalidade → a maioria dos casos
- por tarefa (classificador) → tráfego misto
- **cascata**: pequeno primeiro, escala se a validação falhar
- conformidade: dados pessoais → regiões aprovadas
- canário de modelos novos atrás do alias; **fixe versões**

</div>
</div>

---

<!-- _class: tight -->

## Fallbacks: nem todo erro merece retry

| Erro | Ação |
|---|---|
| `429` limite de taxa | respeite `Retry-After`; senão, **fallback** para outra implantação |
| `5xx` / sobrecarga | backoff + jitter, depois fallback; conte no **breaker** |
| sem primeiro token no prazo | cancele e faça fallback, ou **hedge** |
| stream interrompido no meio | não dá para repetir em silêncio — o usuário já viu parte |
| `400` contexto longo demais | **não repita**: corte o histórico ou use um modelo de contexto longo |
| recusa / filtro de conteúdo | **não** faça fallback para um modelo com menos proteção |

<div class="warn">

Um modelo de fallback é **outro programa**: rode as avaliações em todos os modelos da cadeia. Retries multiplicam o gasto de tokens: limite-os.

</div>

---

## Cotas e orçamentos de tokens

- Limites do provedor: **requisições por minuto (RPM) e tokens por minuto (TPM)**, concorrência — compartilhados por todas as funcionalidades (vizinho barulhento).
- Limites do gateway: por usuário, por funcionalidade, por requisição (`max_tokens`, máx. de passos), por mês (US$).
- Orçamento acabou → **degradar** (modelo menor, cache de FAQ), **enfileirar** (lote), **descartar** (`429`).
- Prioridades: interativo > lote; fluxos de compra > navegação.

<div class="flow">
<div class="box">conta a entrada<small>3.100 tokens</small></div><div class="arrow">→</div>
<div class="box accent">reserva entrada + max_tokens<small>3.100 + 600 = 3.700</small></div><div class="arrow">→</div>
<div class="box">chama o modelo<small>180 tokens de saída</small></div><div class="arrow">→</div>
<div class="box green">concilia<small>devolve os 420 não usados</small></div>
</div>

<div class="ok">

Venda relâmpago: assistente fica com 70% do TPM, embedding noturno pausado, FAQ → modelo pequeno + cache semântico, 5 requisições/min por fã.

</div>

---

## Cache: três coisas diferentes

| | Resposta exata | **Prompt (prefixo)** | **Semântico** |
|---|---|---|---|
| Chave | hash da requisição inteira | prefixo idêntico do prompt | embedding da pergunta ≥ limiar |
| Reaproveita | a resposta | o cache de chave/valor (KV) do modelo | resposta a uma pergunta *parecida* |
| Economiza | a chamada | custo de entrada + tempo até o primeiro token (TTFT) | a chamada |
| Risco | nenhum | **nenhum** | **acertos falsos** |

<div class="flow">
<div class="box green">prompt de sistema<small>estático</small></div><div class="arrow">→</div>
<div class="box green">definições de ferramentas<small>estáticas</small></div><div class="arrow">→</div>
<div class="box">documentos recuperados<small>por conversa</small></div><div class="arrow">→</div>
<div class="box">histórico<small>cresce</small></div><div class="arrow">→</div>
<div class="box orange">mensagem nova<small>muda a cada chamada: por último</small></div>
</div>

- Cache semântico: escopo nas chaves (evento, idioma, versão da política); só respostas genéricas.

<!--
Reembolso do show de sábado vs de domingo: vetores quase idênticos, respostas diferentes. Timestamp
no topo do prompt de sistema é o destruidor clássico do cache de prompt.
-->

---

<!-- _class: tight -->

## TTFT, TPOT, batching

> latência = TTFT + TPOT × (N_saída − 1)  ·  0,6 s + 20 ms × 249 ≈ **5,6 s** para 250 tokens

- **Prefill** (paralelo, limitado por computação) → **TTFT**: o objetivo de nível de serviço (SLO) interativo, escondido pelo **streaming** (Server-Sent Events, SSE).
- **Decode** (um token por vez, limitado por memória) → tempo por token de saída (**TPOT**): só precisa vencer a velocidade de leitura.
- Batching divide cada leitura dos pesos: vazão da réplica ↑, velocidade por usuário ↓ devagar.
- **Continuous batching** + **PagedAttention** tornaram isso prático.
- KV cache: 2 × camadas × cabeças KV × dim. da cabeça × bytes → **128 KiB/token** (modelo 8B) → 8 mil tokens ≈ 1 GiB → ~64 conversas por GPU de 80 GB.

<p class="small">Hospedar o próprio modelo só compensa com uso alto e estável — a 10% de utilização, o token sai 10× mais caro.</p>

---

## Workflow ou agente? Quem decide o próximo passo

| Nível | Próximo passo decidido por | BoxOffice |
|---|---|---|
| Chamada única | — | resumir avaliações |
| Workflow (cadeia, roteamento, paralelo) | **código** | extrair → buscar → reservar → redigir |
| Orchestrator-workers | modelo divide, código executa | plano de fim de semana de festival |
| Agente | **o modelo, em loop** | suporte aberto com ferramentas |

<div class="ok">

Comece pelo topo; desça só quando o nível mais simples falhar **de forma mensurável** nas suas avaliações.

</div>

---

## O loop do agente (ReAct)

```python
for step in range(MAX_STEPS):
    reply = llm.chat(messages=messages, tools=registry.schemas_for(user))
    messages.append(reply.message)
    if not reply.tool_calls:
        return reply.text                      # final answer
    for call in reply.tool_calls:
        verdict = guard.check_tool_call(call.name, call.arguments, user)
        result = (registry.call(call.name, call.arguments, as_user=user)
                  if verdict == "allow" else {"error": verdict})
        messages.append(tool_result(call.id, result))
return "Escalating to a human agent."
```

- O modelo **pede**; o orquestrador valida, autoriza **como o usuário** e executa.
- Erros voltam como dados; orçamentos: passos, tokens, tempo; detecção de loop.

---

## Experimente: o loop do agente

<div class="flow">
<div class="box green">acha os assentos<small>4 chamadas · 16.920 tokens · US$ 22,83 / mil · 6,8 s</small></div>
<div class="box">sem chamadas em paralelo<small>5 chamadas · US$ 29,44 · 8,9 s</small></div>
<div class="box red">fica preso, MAX_STEPS 8<small>46.320 tokens e um pedido de desculpas</small></div>
<div class="box orange">detecção de loop<small>pego na chamada 3, 11.520 tokens</small></div>
</div>

- A página Agentes e ferramentas embute o loop: cada barra é uma chamada, a altura é o contexto que ela reenvia.
- Controles: `MAX_STEPS`, chamadas de ferramenta em paralelo, detecção de loop, acertos no cache de prompt, última chamada sem ferramentas (lab 12).
- Subir `MAX_STEPS` para 12 não ajuda o modelo preso: o orçamento de 40.000 tokens o para na mesma chamada.

<!--
Os números são os da tabela de custo da visão geral, chamada a chamada. O assistente do lab 12 faz a quarta chamada sem ferramentas, então o limite de passos termina com uma resposta.
-->

---

## Ferramentas são efeitos colaterais

| Nível | Exemplos | Política |
|---|---|---|
| Leitura | `search_seats`, `get_order` | automática |
| Escrita reversível | `hold_seats` (expira em 10 min) | automática dentro de limites |
| Irreversível / financeira | `create_order`, `refund_order` | **confirmação do usuário na interface** |
| Comunicação externa | `send_email` | confirmar, ou não oferecer |

- Escrita repetida → **chave de idempotência** `(conversation, step, call)`; compensação = `release_hold`.
- Passos se acumulam: **0,95¹⁰ ≈ 60%** de sucesso → menos passos, validar cada um, workflows nas partes conhecidas.
- Execução durável: checkpoint do estado após cada passo.

---

## MCP: o protocolo do registro de ferramentas

- **N agentes × M ferramentas → N + M**: cada time publica um servidor MCP.
- O host (assistente) roda um **cliente** por **servidor**; JSON-RPC 2.0.
- Primitivas do servidor: **tools**, resources, prompts. `initialize` → `tools/list` → `tools/call`.
- Transportes: **stdio** (local) e **Streamable HTTP** (remoto, autorização baseada em OAuth).
- A identidade do fã vem do **token da sessão**, nunca de um argumento da ferramenta.
- Registro = catálogo + exposição por papel + nível de risco + escopos + limites + auditoria.

<div class="warn">

Anotações (`readOnlyHint`…) são **alegações**; descrições são **prompts**. Revise, fixe versões e use allowlist para servidores de terceiros.

</div>

---

## Multiagente — e quando não usar agentes

<div class="cols">
<div>

**Padrões**

- supervisor / orchestrator-workers
- roteador / handoff para especialistas
- fan-out paralelo + agregação
- avaliador-otimizador
- custo: mais tokens, latência, rastreio mais difícil

</div>
<div>

**Prefira algo mais simples quando…**

- os passos são conhecidos → **workflow**
- precisa estar exatamente certo → **código**
- orçamento < 1–2 s → uma chamada pequena
- irreversível → código + **confirmação**
- não dá para avaliar → **não automatize ainda**

</div>
</div>

---

## RAG: dois pipelines

<div class="flow" style="align-items: stretch">
<div class="group"><div class="caption">ingestão (assíncrona)</div>
<div class="box">extrair + limpar<small>metadados: local, versão, acesso</small></div>
<div class="box">chunking<small>por estrutura, cabeçalhos de contexto</small></div>
<div class="box">embedding (lote)<small>guardar o nome do modelo</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="flex: .7; display: flex; flex-direction: column; justify-content: center">índice vetorial + palavras-chave<small>atualizado por eventos de mudança; remoções também</small></div>
<div class="arrow" style="align-self: center">←</div>
<div class="group"><div class="caption">consulta (online)</div>
<div class="box">reescrever<small>pergunta autônoma, filtros</small></div>
<div class="box">busca híbrida → reranquear<small>top 20–50 → manter 3–8</small></div>
<div class="box green">prompt com as fontes<small>resposta com citações verificadas</small></div>
</div>
</div>

<p class="small">Tamanho do índice ≈ N × d × 4 bytes + grafo: 60 mil chunks × 1.024 dimensões ≪ 1 GB → pgvector no Postgres que você já opera.</p>

---

<!-- _class: tight -->

## Busca híbrida, RRF e reranqueamento

- Vetores erram **tokens exatos** (setor "C", códigos, nomes); palavras-chave erram **paráfrases**.
- **Reciprocal Rank Fusion**: score(d) = Σ 1 / (60 + posição) — só posições, sem calibrar scores.
- 1º por palavras-chave + 3º por vetores → 1/61 + 1/63 ≈ **0,032** vence 1º só por vetores (0,016).
- **Reranqueador cross-encoder** lê pergunta + chunk juntos: preciso, mais lento (dezenas a centenas de ms).
- Índice de vizinho mais próximo aproximado (ANN), HNSW: ajuste `ef_search` entre recall e latência; **filtros** pedem iterative scans ou partições.

```sql
SELECT id, coalesce(1.0/(60 + s.rank), 0) + coalesce(1.0/(60 + k.rank), 0) AS rrf
FROM semantic s FULL OUTER JOIN keyword k USING (id)
ORDER BY rrf DESC LIMIT 20;   -- then rerank
```

---

## Experimente: o que chega ao prompt

<div class="flow">
<div class="box red">setor C, só vetorial<small>elevadores 0,84 · Estádio Sul 0,83 · a resposta 0,79</small></div><div class="arrow">→</div>
<div class="box green">híbrida (RRF)<small>a resposta primeiro: 0,0323 vs 0,0164 · k = 1 basta</small></div>
</div>
<div class="flow">
<div class="box red">câmera, sem contexto<small>Estádio Sul 0,81 vence o §4 0,74, em todos os modos</small></div><div class="arrow">→</div>
<div class="box green">chunks com contexto<small>título + seção no chunk: §4 primeiro</small></div>
</div>

- A página RAG e memória embute a busca: vetorial, por palavra-chave ou híbrida; top-k; similaridade mínima; chunks com contexto.
- *Piscina*: nenhum chunk responde; um limiar de 0,60 transforma cinco chunks sem relação em "não sei" — só na metade vetorial.

---

## Tipos de memória

| Tipo | Exemplo na BoxOffice | Onde fica | Duração |
|---|---|---|---|
| De trabalho | o prompt desta chamada | a chamada ao modelo | uma chamada |
| Curto prazo (sessão) | escolhendo C12–C13 ou D4–D5 | Redis + tempo de vida (TTL) | horas |
| Longo prazo semântica | "prefere assentos no corredor" | SQL, editável | até ser apagada |
| Longo prazo episódica | "o reembolso do mês passado" | índice vetorial | política de retenção |
| Procedural | prompt de sistema, regras | Git, avaliado | por release |

<div class="warn">

Extraia memórias só das **mensagens do próprio usuário** (envenenamento de memória). A remoção precisa alcançar **todas as cópias**: perfil, vetores, caches, logs, traces (Lei Geral de Proteção de Dados, LGPD).

</div>

---

## Injeção de prompt

- **Direta**: o usuário digita — o dano se limita ao que *aquele usuário* pode fazer.
- **Indireta**: chega por um documento, resultado de ferramenta, página web ou descrição de ferramenta — um **terceiro** ataca o usuário.
- Nenhum filtro resolve: **assuma que o modelo pode estar comprometido**; limite o que ele pode fazer.

<div class="q">

**Trifeta letal**: dados privados + conteúdo não confiável + comunicação externa. Remova uma perna.

</div>

- BoxOffice: ferramentas com escopo do usuário · texto de promotores marcado como dado · sem ferramentas de e-mail/fetch · links só para domínios permitidos.

---

<!-- _class: tight -->

## A Safety Mesh

| Ponto de verificação | Exemplos | Tipo |
|---|---|---|
| 1. Entrada | mascaramento de dados pessoais (PII): CPF, Luhn para cartões; score de injeção | determinística + modelo pequeno |
| 2. Recuperação | filtro de permissão na consulta; marcar texto não confiável | determinística |
| 3. Chamada de ferramenta | schema, autorização como o usuário, nível de risco | determinística |
| 4. Resultado da ferramenta | limite de tamanho, score de injeção | ambas |
| 5. Saída | schema, regras de negócio vs resultados, citações, allowlist de URLs | determinística |
| 6. Ação | **confirmação humana** da ação exata — um evento de interface | — |

<div class="ok">

Prefira verificações determinísticas: rápidas, testáveis e ninguém as convence a mudar de decisão.

</div>

---

<!-- _class: tight -->

## Avaliação: prompts e modelos são deploys

- Pirâmide: verificações determinísticas → **golden set** (avaliado pelo estado, com fixtures) → **LLM como juiz** → humanos → **online**.
- Avalie o **resultado** (a reserva certa existe?) mais do que a trajetória exata.
- Não determinismo: rode k tentativas. p = 0,9 → **pass@4 ≈ 100%**, **pass^4 ≈ 66%** — o fã vive o pass^k.
- Vieses do juiz: **posição**, **verbosidade**, **autopreferência** → rubrica, inverter ordem, outra família, validar com humanos.
- Online: reservas → pedidos, escalonamentos, guardrails acionados, recusas, TTFT p95, **custo por conversa resolvida**.

<div class="flow">
<div class="box">mudança<small>prompt, modelo, ferramenta, k</small></div><div class="arrow">→</div>
<div class="box">verificações determinísticas</div><div class="arrow">→</div>
<div class="box accent">portão do golden set<small>integração contínua (CI)</small></div><div class="arrow">→</div>
<div class="box">amostra do juiz</div><div class="arrow">→</div>
<div class="box orange">canário<small>atrás do alias</small></div><div class="arrow">→</div>
<div class="box green">promove<small>ou rollback</small></div>
</div>

---

## Observabilidade de aplicações com LLM

```text
invoke_agent boxoffice-assistant                        10.1 s
├── chat assistant-default      in 3,060  out 41         1.1 s
├── execute_tool search_events                           0.12 s
├── chat assistant-default      in 3,900  out 96         2.3 s
└── chat assistant-default      in 5,300  out 212        4.9 s
```

- Convenções GenAI do OpenTelemetry (OTel): `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `output_tokens`, `gen_ai.response.finish_reasons`; métricas de TTFT/TPOT.
- Custo no seu próprio namespace; **captura de conteúdo opt-in**, mascarada, retenção curta.
- Alertas: SLO de TTFT, taxa de fallback, **taxa de queima do orçamento**, picos de guardrail.

---

<!-- _class: tight -->

## O mapa de conceitos

| Componente | Pergunta que responde | Ensinado em |
|---|---|---|
| `llmgw` | Qual modelo atende esta chamada, com qual orçamento? | LLM Gateway |
| `orchestrator` | Quem decide o próximo passo e quando ele para? | Agentes e ferramentas |
| `toolreg` | O que o modelo pode pedir para fazer e em nome de quem? | Agentes e ferramentas (MCP) |
| `memory` · `vectordb` | O que precisa voltar para o prompt? | RAG e memória |
| `safety` | Esta entrada, saída ou ação é permitida? | Segurança, avaliações e obs. |
| `tracing` · `metrics` | Está certo, rápido e barato? | Segurança, avaliações e obs. |

<p class="small">Cada um é um componente clássico especializado para tokens, prompts e ferramentas: API gateway, motor de workflow, catálogo de serviços, cache + bancos, malha de políticas. Cenário: <code>ai-assistant</code>.</p>

<!--
A mesma tabela está na página de visão geral, com links para as subpáginas e o catálogo de componentes.
-->

---

## O que quebra a seguir

<div class="q">

Um prompt, a descrição de uma ferramenta, a versão de um modelo, o `k` da recuperação: cada um muda o comportamento sem uma linha de Java e cada um é um deploy que precisa passar pelo portão de avaliação.

</div>

- Enquanto isso, os mesmos modelos escrevem o código do time: os pull requests chegam mais rápido do que as pessoas revisam, testam e liberam.
- A rede de proteção do lab 11 (testes, scans, um canário) foi dimensionada para a velocidade humana.
- Aula 14: IA dentro do pipeline de entrega, sem deixá-la aprovar o próprio trabalho.

---

## Principais ideias

1. Um LLM é uma dependência **lenta, cobrada por token, com limite de taxa e probabilística**, que mistura instruções com dados.
2. Cinco componentes: **gateway, orquestrador, registro de ferramentas, memory fabric, safety mesh** — componentes clássicos especializados.
3. Custo e latência = **chamadas × tokens por chamada**; o contexto cresce a cada passo; faça cache do prefixo.
4. **Workflow primeiro**; agentes com orçamentos, ferramentas idempotentes, autorização no escopo do usuário, MCP.
5. Ferramentas para dados vivos; **RAG** (híbrido + reranqueamento + citações) para documentos; memória por tipo, apagável.
6. Defesa em profundidade + **confirmação humana**; **avaliações no CI** (pass^k, juízes validados); **traces GenAI** com tokens e custo.
