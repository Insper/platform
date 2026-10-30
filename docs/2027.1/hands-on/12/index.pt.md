# 12. Assistente de IA { #12-ai-assistant }

!!! info "Objetivo"

    Adicionar o **assistente** de suporte do BoxOffice: um serviço Python 3.12 + FastAPI, gerenciado com
    **uv**, que responde às perguntas dos fãs com um LLM por trás de um pequeno **gateway de LLM**
    (LiteLLM: rotas, fallback, timeouts, custos); ancora as respostas no catálogo com **RAG** sobre
    **pgvector**; consulta dados ao vivo por um **registro de ferramentas** no formato do MCP, dentro de
    um **loop de agente** limitado; protege o modelo e os usuários com **guardrails**; exporta **tokens,
    custo e tempo até o primeiro token** para o Grafana do lab 8; e passa por teste de carga onde dói —
    no primeiro token.

No dia da venda, o suporte recebe milhares das mesmas perguntas: *quando é o show? quanto custa? cadê o
meu pedido?* Um assistente consegue respondê-las em segundos, às 3 da manhã, em português e em inglês —
se não inventar shows, não vazar dados e não custar mais que os ingressos. Este lab constrói um com a
arquitetura da [aula de sistemas de IA](../../classes/ai-systems/index.md), rodando **inteiramente na
sua máquina** com um modelo aberto local (Ollama) e, opcionalmente, no Claude para comparação.
Na [história da disciplina](../../index.md#story), este lab constrói o capítulo 13: ele implementa as
decisões do [gateway de LLM](../../classes/ai-systems/llm-gateway/index.md) (rotas e um fallback),
do [loop do agente](../../classes/ai-systems/agents/index.md#loop) e das suas [ferramentas só de leitura](../../classes/ai-systems/agents/index.md#side-effects),
da [recuperação com pgvector](../../classes/ai-systems/rag-memory/index.md#embeddings) e da
[malha de segurança](../../classes/ai-systems/safety-evals/index.md#guardrail-code).

## Slides

<div class="slides-embed">
  <iframe src="slides/assistant.html" title="Slides: assistente de IA" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/assistant.html){:target="_blank"}

## Antes de começar { #before-you-start }

| | |
|---|---|
| Tempo | cerca de 6 horas, incluindo o download dos modelos e a inferência local lenta |
| Ferramentas | Docker com Compose v2; **uv** (`uv --version`, do [lab 0](../0/index.md)); `curl`, `jq`. O Python é gerenciado pelo uv: nada de `pip`, nada de ambientes virtuais manuais |
| Recursos do Docker | pelo menos 4 CPUs e **8 GB** livres para este lab (≈ 1,5 GB de modelos); no macOS, planeje rodar o Ollama nativamente (passo 1) |
| Disco | ≈ 3 GB para as imagens e os modelos |
| Contas e custos | **nenhuma obrigatória**: tudo roda localmente e de graça. Opcional: uma chave de API da Anthropic para a rota do Claude (pago por uso, ≈ US$ 0,006 por pergunta com `claude-opus-5-5`) |

Todo comando roda na **raiz do seu repositório `boxoffice`**, no estado em que o lab 11 o deixou:

``` text title="Start state (end of lab 11)"
boxoffice/
├── docker-compose.yaml     # the Compose stack of labs 1-9 (catalog behind gateway, order, ...)
├── .github/  k8s/          # labs 10-11
├── infra/  load/  scripts/
└── services/               # auth, catalog, gateway, inventory, notification, order, payment
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 11? Baixe [boxoffice-after-lab-11.zip](../11/boxoffice-after-lab-11.zip),
    descompacte, `cd boxoffice`, `sh scripts/get-otel-agent.sh` e continue daqui. Este lab só precisa
    da stack do Compose (`gateway`, `catalog`, `order`, `db`, `otel-lgtm`), não do cluster.

Todo arquivo deste lab aparece completo nestas páginas e é publicado em
`https://insper.github.io/platform/2027.1/hands-on/12/code/<caminho>`.

## Arquitetura { #architecture }

``` diagram-sim
flowchart LR
    fan[fã / interface de chat] -->|"POST /assistant/chat/stream"| api[assistant: FastAPI]
    api --> gin{guarda de entrada}
    gin --> orch[loop do agente]
    orch -->|"search_query: ..."| emb[modelo de embeddings]
    emb --> vdb[("pgvector: assistant.documents")]
    vdb -->|top-k eventos| orch
    orch -->|router do LiteLLM| gw[gateway de LLM]
    gw -->|local| ollama["Ollama: qwen2.5:1.5b"]
    gw -.->|"opcional, fallback para o local"| claude[API do Claude]
    orch -->|chamadas de ferramenta| reg[registro de ferramentas]
    reg -->|GET /catalog/events| cat[gateway -> catalog]
    reg -->|"GET /orders/id + X-User-Email"| ord[order]
    orch --> gout{guarda de saída}
    gout -->|tokens SSE + done| fan
    api -.->|métricas OTLP| lgtm[otel-lgtm]
```

!!! example "Componentes do BoxOffice envolvidos"

    | Componente da paleta | Neste lab |
    |---|---|
    | [LLM Gateway](../../reference/components/ai/index.md#llmgw) | `Router` do LiteLLM: rotas, fallback, timeouts, contabilização de custo |
    | [Orchestrator](../../reference/components/ai/index.md#orchestrator) | o loop de agente limitado de `agent.py` |
    | [Tool Registry](../../reference/components/ai/index.md#toolreg) | três ferramentas só de leitura com JSON schemas (no estilo do MCP) |
    | [Memory Fabric](../../reference/components/ai/index.md#memory) | RAG: embeddings dos eventos do catálogo no pgvector |
    | [Vector DB](../../reference/components/storage/index.md#vectordb) | PostgreSQL 17 + pgvector, índice HNSW |
    | [Safety Mesh](../../reference/components/ai/index.md#safety) | guardrails de entrada e de saída, mascaramento de PII |

## O que você vai medir { #what-you-will-measure }

| Pergunta | Métrica | Ferramenta |
|---|---|---|
| Quanto tempo até o fã ver a primeira palavra? | TTFT p50/p95 sob concorrência | `scripts/assistant_load.py` |
| Com que rapidez os tokens são produzidos? | tokens/s, requisições/min | o mesmo |
| A recuperação encontra os eventos certos? | hit@5, MRR | `scripts/eval_retrieval.py` |
| As respostas são ancoradas? | fração de `grounded: true` | a API, a métrica do guarda |
| Quanto custa uma resposta? | tokens e US$ por requisição | a API, `assistant_llm_cost_usd_total` |

## Pré-requisitos { #prerequisites }

- Labs [1](../1/index.md) (catalog), [7](../7/index.md) (order) e [8](../8/index.md) (Grafana) concluídos.
- Leia a [aula de sistemas de IA](../../classes/ai-systems/index.md):
  [gateway de LLM](../../classes/ai-systems/llm-gateway/index.md),
  [agentes](../../classes/ai-systems/agents/index.md),
  [RAG e memória](../../classes/ai-systems/rag-memory/index.md),
  [segurança e avaliações](../../classes/ai-systems/safety-evals/index.md).

## Passos { #steps }

1. [O serviço e o gateway de LLM](service/index.md) — Ollama, pgvector, o projeto uv, as rotas e o fallback do LiteLLM, a rota opcional do Claude.
2. [RAG com pgvector](rag/index.md) — embeddings, o índice HNSW, a ingestão do catálogo, a avaliação da recuperação.
3. [Ferramentas e o loop do agente](tools/index.md) — o registro de ferramentas, o loop limitado, streaming, a API.
4. [Guardrails e métricas](guardrails/index.md) — injection e PII na entrada, ancoragem na saída; tokens, custo e TTFT no Grafana.
5. [Meça](measure/index.md) — TTFT sob carga, qualidade da recuperação e das respostas, escolha do modelo.

## Experimente no playground { #try-it-in-the-playground }

**Experimente:** rode o cenário `ai-assistant` com o perfil `load`. Aumente os `steps` do orquestrador
de 1 para 4 e veja a latência e o custo por requisição se multiplicarem — cada step é mais uma chamada
ao LLM. Depois ative o cache semântico do gateway de LLM e veja que fração do tráfego nunca chega ao
modelo.

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520"></div>

O simulador completo está no [playground](../../../playground/index.md).

## Meça { #measure-it }

O passo [Meça](measure/index.md) tem os scripts e a tabela de resultados para guardar em
`results/lab12.md`.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa provável | Correção |
|---|---|---|
| as respostas levam minutos | o modelo roda numa CPU (sempre o caso no Docker no macOS) | rode o Ollama nativamente e defina `OLLAMA_URL=http://host.docker.internal:11434`; feche outras stacks; faça perguntas mais curtas |
| `litellm.APIConnectionError … Connection refused` nos logs | o Ollama não está rodando ou `OLLAMA_URL` está errada | `docker compose ps ollama` / `ollama list`; confira a variável no `docker-compose.yaml` |
| `model "qwen2.5:1.5b" not found` | o modelo não foi baixado | `docker compose up ollama-init` (ou `ollama pull qwen2.5:1.5b` nativamente) |
| a inicialização falha com `type "vector" does not exist` | o `db` ainda roda a imagem `postgres:17` simples | `docker compose up -d db` depois de atualizar o arquivo compose; `docker compose exec db psql -U boxoffice -c "\dx"` lista `vector` |
| `/assistant/ingest` retorna `Internal Server Error` ou `{"ingested":0}` | o gateway não está rodando (`Name or service not known` em `docker compose logs assistant`), ou o catálogo atrás dele caiu | `docker compose up -d --wait gateway`; `docker compose ps gateway catalog-1`; `docker compose exec assistant python -c "import urllib.request;print(urllib.request.urlopen('http://gateway:8080/catalog/events/1').status)"` |
| `uv sync --frozen` falha no build | o `uv.lock` não corresponde ao `pyproject.toml` | rode `uv lock` em `services/assistant` (na sua máquina) e refaça o build |
| nenhuma métrica `assistant_*` no Grafana | `OTEL_EXPORTER_OTLP_ENDPOINT` não definida, ou nenhuma pergunta respondida ainda | confira as variáveis do `assistant`; as métricas são exportadas a cada 10 s |
| `Bind for 0.0.0.0:11434 failed: port is already allocated` | o Ollama já roda nativamente na sua máquina, e o `docker compose up -d` também subiu o contêiner `ollama` | mantenha o nativo: `docker compose stop ollama ollama-init`, e suba os serviços pelo nome (`docker compose up -d assistant`) com `OLLAMA_URL` exportada |
| `litellm.Timeout … Timeout passed=120.0` nos logs; `errors` no teste de carga | o modelo roda numa CPU e as requisições ficam na fila diante dele por mais que os 120 s do gateway | diminua a concorrência (`--concurrency 1 2 --requests 2`), ou rode o Ollama nativamente; o `timeout=120` está em `app/llm.py` |
| `422 blocked` para uma pergunta normal | um falso positivo dos padrões de injection | reformule, e anote: falsos positivos fazem parte da qualidade medida do guardrail |

!!! success "Boas práticas neste lab"

    - **Rotas em vez de nomes de modelo, com um fallback** — o `app/llm.py` pede `local` ou `claude`, e `claude` cai para `local`; por quê: [LLM Gateway](../../classes/ai-systems/llm-gateway/index.md).
    - **Um loop limitado que sempre termina com uma resposta** — o `app/agent.py` para em `MAX_STEPS` = 4 e faz a última chamada sem ferramentas; por quê: [o loop do agente](../../classes/ai-systems/agents/index.md#loop).
    - **Ferramentas só de leitura, identidade vinda da plataforma** — o `app/tools.py` pega o fã do `X-User-Email` e nunca escreve; por quê: [ferramentas são efeitos colaterais](../../classes/ai-systems/agents/index.md#side-effects).
    - **Recuperação medida por si só** — o `scripts/eval_retrieval.py` calcula hit@k e MRR antes que qualquer modelo responda; por quê: [RAG e memória](../../classes/ai-systems/rag-memory/index.md#hybrid).
    - **Mascare antes do modelo, confira as citações depois dele, meça o TTFT em segundos** — `app/guardrails.py` e `app/metrics.py`; por quê: [Segurança, avaliações e observabilidade](../../classes/ai-systems/safety-evals/index.md#guardrail-code).

## Limpeza { #clean-up }

``` shell
docker compose stop assistant ollama        # free the CPU/RAM of the model
docker compose down -v                      # or remove everything (including the downloaded models)
```

O `docker compose down -v` também apaga o volume `ollama-models`: a próxima execução baixa os modelos de
novo. Mantenha-o se for continuar para o lab 13, que pode usar o mesmo modelo local. Com o Ollama nativo,
`ollama stop qwen2.5:1.5b` libera a memória do modelo na hora (ele também sai da memória após 5 minutos
ocioso), e `ollama rm qwen2.5:1.5b nomic-embed-text` apaga os modelos quando você não precisar mais deles.

## Estado final { #end-state }

``` text title="End state (what this lab added or changed)"
boxoffice/
├── .gitignore              # + __pycache__/, .venv/
├── docker-compose.yaml     # db/db-replica -> pgvector image; + ollama, ollama-init, assistant
├── scripts/
│   ├── assistant_load.py   # TTFT load test (uv inline script)
│   └── eval_retrieval.py   # hit@k / MRR (uv inline script)
├── results/lab12.md
└── services/assistant/     # new: pyproject.toml, uv.lock, .python-version, Dockerfile, .dockerignore,
    └── app/                # __init__, config, llm, db, rag, tools, agent, guardrails, metrics, main
```

Faça o commit e a tag: `git add -A && git commit -m "lab 12: AI assistant" && git tag lab12`.

## Checklist

- [ ] `ollama`, `ollama-init` e `assistant` rodam no `docker-compose.yaml` (ou o Ollama nativamente, com `OLLAMA_URL`); o `db` usa a imagem do pgvector
- [ ] `services/assistant` é um projeto uv com `pyproject.toml` e `uv.lock` commitados; a imagem é construída com `uv sync --frozen`
- [ ] o `/assistant/ingest` carregou pelo menos 300 eventos; o `scripts/eval_retrieval.py` reporta hit@5 e MRR
- [ ] `/assistant/chat` e `/assistant/chat/stream` respondem com citações conferidas pelo guarda de saída; uma tentativa de injection retorna `422`
- [ ] `get_order_status` só responde para o usuário em `X-User-Email`
- [ ] métricas `assistant_*` (tokens, custo, TTFT) visíveis no Grafana
- [ ] tabela de resultados preenchida em `results/lab12.md`, incluindo onde o modelo rodou
- [ ] autoverificação: `docker compose up -d --build assistant` a partir de um clone limpo, e então `curl localhost:8088/assistant/health` retorna `"status":"UP"`; push com a tag `lab12`

## Relacionados { #related }

- Teoria: [Sistemas de IA e agentes](../../classes/ai-systems/index.md) ·
  [Gateway de LLM](../../classes/ai-systems/llm-gateway/index.md) ·
  [Agentes e ferramentas](../../classes/ai-systems/agents/index.md) ·
  [RAG e memória](../../classes/ai-systems/rag-memory/index.md) ·
  [Segurança e avaliações](../../classes/ai-systems/safety-evals/index.md)
- Estudo de caso: [Assistente de IA](../../classes/case-studies/ai-assistant/index.md)
- Próximo lab: [13. IA no CI/CD](../13/index.md) usa modelos de linguagem dentro do pipeline de entrega do lab 11.

[Começar: O serviço e o gateway de LLM](service/index.md){ .md-button .md-button--primary }
