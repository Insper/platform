# 1. O Serviço e o Gateway de LLM { #1-the-service-and-the-llm-gateway }

Este passo cria o serviço `assistant` — Python 3.12 + FastAPI, gerenciado com **uv** — e o seu **gateway
de LLM**: o único módulo que sabe quais modelos existem, qual responde por padrão, o que fazer quando um
provedor falha e quanto custa cada resposta. Todos os comandos rodam na **raiz do seu repositório
`boxoffice`**, a menos que um `cd` diga o contrário.

## Infraestrutura: um LLM local e um PostgreSQL com vetores { #infrastructure-a-local-llm-and-a-vector-capable-postgresql }

| Contêiner | Imagem | Porta | Papel |
|---|---|---|---|
| `ollama` | `ollama/ollama:0.40.6` | 11434 | roda os modelos locais: `qwen2.5:1.5b` (chat, com chamada de ferramentas) e `nomic-embed-text` (embeddings, 768 dimensões) |
| `ollama-init` | `ollama/ollama:0.40.6` | — | execução única: baixa os dois modelos (≈ 1,3 GB, uma vez) |
| `db` e `db-replica` | `pgvector/pgvector:0.8.7-pg17-trixie` | 5432 / 5433 | o mesmo PostgreSQL 17, agora com a extensão `vector` disponível |
| `assistant` | `services/assistant` | 8088 | o serviço FastAPI deste lab |

A parte nova do `docker-compose.yaml`:

``` yaml title="docker-compose.yaml (excerpt)"
  ollama:
    image: ollama/ollama:0.40.6
    ports:
      - "11434:11434"
    volumes:
      - ollama-models:/root/.ollama      # models survive restarts (about 1.3 GB)
    healthcheck:                         # ollama-init must wait for the server, not just the container
      test: ["CMD", "ollama", "list"]
      interval: 5s
      timeout: 5s
      retries: 12

  # one-shot: download the chat model and the embedding model, then exit
  ollama-init:
    image: ollama/ollama:0.40.6
    environment:
      OLLAMA_HOST: ollama:11434
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        ollama pull ${LOCAL_MODEL_TAG:-qwen2.5:1.5b} && ollama pull nomic-embed-text
    depends_on:
      ollama:
        condition: service_healthy
    restart: "no"
```

Baixe o arquivo completo (o do lab 9 mais a imagem do pgvector para `db`/`db-replica`, `ollama`,
`ollama-init` e `assistant`):

``` shell
curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/12/code/docker-compose.yaml
```

??? example "docker-compose.yaml — o arquivo completo ao fim deste lab"

    ``` yaml title="docker-compose.yaml"
    --8<-- "docs/2027.1/hands-on/12/code/docker-compose.yaml"
    ```

!!! warning "Onde o modelo deve rodar? (leia antes de baixar)"

    Um modelo de linguagem é muita aritmética; onde ele roda decide a sua latência.

    === "macOS (Apple Silicon)"

        O Docker no macOS **não tem acesso à GPU**: num contêiner o modelo roda na CPU e uma resposta
        curta pode levar um minuto. Rode o Ollama **nativamente** (ele usa a GPU pelo Metal) e aponte o
        assistente para ele:

        ``` shell
        brew install ollama && ollama serve &          # or the app from ollama.com
        ollama pull qwen2.5:1.5b && ollama pull nomic-embed-text
        export OLLAMA_URL=http://host.docker.internal:11434
        ```

        e pule os contêineres `ollama` e `ollama-init` abaixo.

    === "Linux com GPU NVIDIA"

        Instale o NVIDIA Container Toolkit e adicione ao serviço `ollama`:
        `deploy: { resources: { reservations: { devices: [{ driver: nvidia, count: all, capabilities: [gpu] }] } } }`.

    === "Só CPU (Windows/WSL, Linux)"

        Use os contêineres como estão. Funciona, devagar: numa execução de teste num notebook ocupado de
        8 núcleos, o primeiro token levou dezenas de segundos. Prefira perguntas curtas, e compare com a
        rota opcional do Claude desta página.

Suba a infraestrutura (a imagem do `db` muda, então o `db` reinicia uma vez):

<!-- termynal -->

``` shell
> docker compose up -d db db-replica ollama ollama-init
> docker compose wait ollama-init
container "c8d93485…" exited with status code 0
> docker compose exec ollama ollama list
NAME                       ID              SIZE      MODIFIED
nomic-embed-text:latest    0a109f422b47    274 MB    7 seconds ago
qwen2.5:1.5b               65ec06548149    986 MB    29 seconds ago
```

O `docker compose wait` bloqueia até o `ollama-init` (one-shot) baixar os dois modelos (um ou dois
minutos na primeira vez) e imprime o código de saída: 0. (O `docker compose logs -f ollama-init` não
retornaria se o contêiner já tivesse terminado.) Você deve ver os dois modelos na lista (`ollama list` na sua máquina, se o Ollama roda nativamente). Com
o Ollama nativo (macOS), suba só `docker compose up -d db db-replica`: um contêiner `ollama` falharia com
`port is already allocated` na 11434, que o servidor nativo já usa.

## O projeto: uv { #the-project-uv }

O **uv** (da Astral) cria o ambiente virtual, resolve as dependências e grava um arquivo de lock com a
versão e o hash exatos de cada pacote, para que o seu notebook, o CI e o contêiner instalem os mesmos
bytes. O projeto foi criado com estes comandos (você pode rodá-los num `services/assistant/` vazio, ou
baixar os arquivos abaixo):

``` shell
mkdir -p services/assistant && cd services/assistant
uv init --app --name assistant --python 3.12 --no-readme --vcs none .
rm main.py
uv add "fastapi>=0.146" "uvicorn[standard]>=0.54" "litellm>=1.106" "psycopg[binary,pool]>=3.3" \
  "pgvector>=0.5" "numpy>=2.3" "httpx>=0.28" "pydantic>=2.14" "mcp>=1.20" \
  "opentelemetry-sdk>=1.45" "opentelemetry-exporter-otlp-proto-http>=1.45"
cd ../..
```

O `uv add` edita o `pyproject.toml` e grava o `uv.lock` (≈ 3.000 linhas: faça commit dele, nunca o edite
à mão; baixe-o de `https://insper.github.io/platform/2027.1/hands-on/12/code/services/assistant/uv.lock`
se preferir as versões exatas deste roteiro). O uv não escreve o `Dockerfile` nem o `.dockerignore`:
crie-os a partir das abas abaixo. Se você pular o `uv init`, baixe também o `pyproject.toml` do mesmo
endereço e crie o `.python-version` a partir da aba dele (o site não serve arquivos cujo nome começa
com ponto).

=== "pyproject.toml"

    ``` toml title="services/assistant/pyproject.toml"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/pyproject.toml"
    ```

=== ".python-version"

    ``` text title="services/assistant/.python-version"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/.python-version"
    ```

=== "Dockerfile"

    ``` dockerfile title="services/assistant/Dockerfile"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/Dockerfile"
    ```

=== ".dockerignore"

    ``` text title="services/assistant/.dockerignore"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/.dockerignore"
    ```

O `uv sync --frozen` falha se o `uv.lock` não corresponde ao `pyproject.toml` — o build nunca resolve
versões por conta própria. (O `mcp` está na lista porque o LiteLLM o importa quando uma requisição leva
ferramentas.)

Rodar Python localmente (o passo 4 roda) grava pastas `__pycache__/` ao lado do código; acrescente duas
linhas ao `.gitignore` da raiz para que o `git add -A` as deixe de fora, e também qualquer `.venv/`:

``` text title=".gitignore"
--8<-- "docs/2027.1/hands-on/12/code/.gitignore"
```

## A configuração e o gateway { #configuration-and-the-gateway }

=== "app/config.py"

    ``` python title="services/assistant/app/config.py"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/config.py"
    ```

=== "app/llm.py"

    ``` python title="services/assistant/app/llm.py"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/llm.py"
    ```

=== "app/__init__.py"

    ``` python title="services/assistant/app/__init__.py"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/__init__.py"
    ```

O LiteLLM dá a todo provedor a mesma interface no estilo da OpenAI, e o seu `Router` é o gateway da
[aula de gateway de LLM](../../../classes/ai-systems/llm-gateway/index.md):

| Preocupação | Aqui |
|---|---|
| **Roteamento** | duas *rotas*: `local` (Ollama) sempre, `claude` só quando `ANTHROPIC_API_KEY` está definida; `ASSISTANT_ROUTE` ou o campo `route` da requisição escolhe |
| **Fallback** | `claude` → `local` quando o provedor falha (queda, rate limit, sem crédito) |
| **Timeouts e retries** | 120 s por chamada, 1 retry — uma chamada ao LLM é a dependência mais lenta que o BoxOffice tem |
| **Custo** | o `app/metrics.py` (passo 4) multiplica os tokens de cada resposta pelo preço do provedor |

!!! info "Por que um SDK dentro do processo e não o proxy do LiteLLM?"

    O LiteLLM também roda como um **proxy** separado (um servidor HTTP compatível com a OpenAI, com
    chaves, orçamentos e uma interface) compartilhado por muitos serviços. Um serviço só não precisa
    dele: o `Router` dentro do processo tem a mesma lógica de roteamento sem mais um contêiner. Com vários
    serviços de IA, o proxy vira o gateway compartilhado — o mesmo movimento que vai da resiliência por
    serviço (lab 9) para uma service mesh.

## A rota opcional do Claude (custa dinheiro) { #the-optional-claude-route-costs-money }

O lab funciona de ponta a ponta com o modelo local. Para comparar com um modelo de fronteira, crie uma
chave de API em [console.anthropic.com](https://console.anthropic.com) (pago por uso: a cobrança é por
token — o padrão `anthropic/claude-opus-5-5` custa US$ 4 por milhão de tokens de entrada e US$ 20 por
milhão de tokens de saída; uma pergunta deste lab usa cerca de 1.000 tokens de entrada e 100 de saída,
≈ US$ 0,006) e exporte-a **antes** de subir o assistente:

``` shell
export ANTHROPIC_API_KEY=sk-ant-...       # never commit it; docker-compose.yaml reads it from the shell
```

Com a chave, a rota padrão passa a ser `claude`; envie `"route": "local"` numa requisição para comparar.
Sem ela, nada chama a API paga.

## Suba o serviço { #start-it }

Os passos 2 e 3 explicam os demais arquivos de `app/`; baixe todos agora para que o serviço suba:

``` shell
mkdir -p services/assistant/app
for f in __init__ config llm db rag tools guardrails agent metrics main; do
  curl -fsSL -o services/assistant/app/$f.py \
    https://insper.github.io/platform/2027.1/hands-on/12/code/services/assistant/app/$f.py
done
docker compose up -d --wait gateway order otel-lgtm      # what the assistant calls, with their dependencies
docker compose up -d --build --wait assistant
curl -s localhost:8088/assistant/health
```

Você deve ver `{"status":"UP","documents":0,"route":"local"}` (`"route":"claude"` se você exportou uma
chave). `documents` é 0: a base de conhecimento fica vazia até o passo 2. Suba os serviços pelo nome, como
acima: um `docker compose up -d` sem nomes também sobe o contêiner `ollama`, que falha ao lado de um Ollama
nativo.

!!! warning "Rota `claude` sem querer?"

    Então a `ANTHROPIC_API_KEY` já está definida no seu shell (outras ferramentas usam a mesma variável), e
    toda pergunta vai para a API paga. Rode `unset ANTHROPIC_API_KEY` e `docker compose up -d --wait assistant`
    de novo: o health check deve mostrar `"route":"local"`.

[Próximo: RAG com pgvector](../rag/index.md){ .md-button .md-button--primary }
