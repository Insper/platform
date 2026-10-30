# 5. Meça { #5-measure-it }

Um endpoint de LLM é a dependência mais lenta e mais cara que o BoxOffice tem, e a sua latência tem uma
forma própria: uma espera longa pelo **primeiro token** (o modelo lê o prompt inteiro), depois um fluxo
de tokens a uma velocidade mais ou menos constante. Os usuários julgam a primeira parte — um balão vazio
— com muito mais rigor que a segunda. Este passo mede as duas, e o custo, sob concorrência.

| # | Experimento | O que você registra |
|---|---|---|
| A | latência com concorrência 1, 2, 4 | TTFT p50/p95, total p50/p95, tokens/s, requisições/min |
| B | qualidade da recuperação | hit@5 e MRR (passo 2) |
| C | qualidade das respostas | fração de respostas `grounded` em 10 perguntas |
| D | escolha do modelo (opcional) | A e C de novo com um modelo local maior ou com a rota do Claude, mais US$ por requisição |

## Por que não o k6 desta vez? { #why-not-k6-this-time }

O k6 mede o tempo até o primeiro **byte** (`http_req_waiting`). Um servidor de streaming envia os seus
headers HTTP assim que a resposta começa — muito antes do primeiro token —, então esse número não diz
nada sobre o que o fã vê. O script abaixo fala Server-Sent Events e para o relógio do TTFT no primeiro
`event: token`:

``` python title="scripts/assistant_load.py"
--8<-- "docs/2027.1/hands-on/12/code/scripts/assistant_load.py"
```

## A. Latência sob concorrência { #a-latency-under-concurrency }

``` shell
uv run scripts/assistant_load.py --concurrency 1 2 4 --requests 8
```

Uma execução de teste com `qwen2.5:1.5b` no Docker, **na CPU de um notebook que também rodava outras
stacks** (2 requisições por nível, para ser curta):

``` text
| concurrency | requests | errors | TTFT p50 | TTFT p95 | total p50 | total p95 | tokens/s | req/min | USD/request |
|---|---|---|---|---|---|---|---|---|---|
|           1 |        2 |      0 |     5.05 |    13.17 |    148.02 |    197.87 |       0.8 |    0.35 |   0.000000 |
|           2 |        2 |      0 |     3.37 |   127.23 |    126.89 |    213.07 |       2.8 |    0.56 |   0.000000 |
```

Com o **Ollama nativo num notebook Apple Silicon** (GPU via Metal, com a pilha toda rodando), uma
execução de teste com 8 requisições por nível, depois de uma pergunta de aquecimento (a primeira chamada
carrega o modelo: cerca de 20 s):

``` text
| concurrency | requests | errors | TTFT p50 | TTFT p95 | total p50 | total p95 | tokens/s | req/min | USD/request |
|---|---|---|---|---|---|---|---|---|---|
|           1 |        8 |      0 |     0.19 |     0.32 |      3.52 |      4.53 |      64.0 |   19.27 |   0.000000 |
|           2 |        8 |      0 |     1.42 |     3.74 |      3.24 |      5.11 |      64.1 |   34.40 |   0.000000 |
|           4 |        8 |      0 |     4.64 |    10.62 |      8.30 |     11.15 |      64.0 |   24.65 |   0.000000 |
```

Dezenas de vezes mais rápido, e com outra forma: cada resposta ainda decodifica a cerca de 64 tokens/s,
mas as requisições fazem fila diante do único modelo, então o TTFT cresce com a concorrência e as
requisições por minuto param de crescer depois de 2.

Leia isso como um problema de capacidade, com as fórmulas da
[aula de sistemas de IA](../../../classes/ai-systems/index.md):

- O **TTFT** cresce com o prompt (≈ 760 tokens aqui: system + cinco eventos recuperados + pergunta) e
  com a fila na frente do modelo: com concorrência 2, a segunda requisição esperou pela primeira.
- **tokens/s** é a velocidade de decodificação do hardware. Uma CPU dá alguns tokens por segundo; uma
  GPU de notebook (Ollama nativo no Apple Silicon), dezenas; um modelo de fronteira hospedado, uns cem.
- A **Lei de Little** vale como em todo lugar: requisições em andamento = taxa de chegada × tempo por
  requisição. Com ~2 minutos por resposta, *um* fã por minuto já mantém duas requisições em andamento.
  É por isso que servir LLMs precisa de batching, GPUs e controle de admissão — ou de uma API hospedada.

!!! tip "Se os seus números estão lentos assim"

    Essa é a lição, não um bug — mas dá para melhorar no mesmo notebook: rode o Ollama nativamente
    (macOS), feche outros contêineres, faça perguntas curtas e diminua o `RETRIEVE_K` (menos tokens de
    contexto, prefill mais rápido; confira que o hit@k não cai). Numa CPU, meça `--concurrency 1 2
    --requests 2`, como a execução de teste: com concorrência 4, as requisições fazem fila umas atrás das
    outras além do timeout de 120 s do gateway (`litellm.Timeout` em `docker compose logs assistant`,
    contado em `errors`).

## B. Qualidade da recuperação { #b-retrieval-quality }

Registre o hit@5 e o MRR do [passo 2](../rag/index.md). Depois diminua o `--k` para 1 e veja quais
perguntas falham.

## C. Qualidade das respostas { #c-answer-quality }

Faça as dez perguntas abaixo (as cinco do `assistant_load.py` e cinco suas sobre o BoxOffice) com
`/assistant/chat`, e conte os `grounded: true`:

``` shell
curl -s -X POST localhost:8088/assistant/chat -H 'Content-Type: application/json' \
  -d '{"message":"Which plays are there in Curitiba?"}' | jq '{grounded, citations, answer}'
```

Na execução de teste, o `qwen2.5:1.5b` respondeu com fatos corretos do contexto, mas **sem citações**,
nas duas perguntas testadas, então as duas ficaram `grounded: false` — o guarda fez o seu trabalho, e o
modelo é o elo fraco. Em dez perguntas, outra execução de teste contou 1 de 10 ancoradas com o `qwen2.5:1.5b`
e 5 de 10 com o `qwen2.5:3b`. A taxa de ancoragem é uma propriedade do *modelo + prompt*; meça-a antes de confiar
em qualquer assistente.

## D. Escolha do modelo (opcional) { #d-model-choice-optional }

Repita A e C com um modelo local maior (`docker compose exec ollama ollama pull qwen2.5:3b`, ou
`ollama pull qwen2.5:3b` com o Ollama nativo, depois `LOCAL_MODEL_TAG=qwen2.5:3b docker compose up -d --wait assistant`) ou com a rota do Claude (passo 1, custa
dinheiro: a coluna `USD/request` mostra quanto). Compare TTFT, taxa de ancoragem e custo por resposta.

## Resultados { #results }

Copie para `results/lab12.md` e preencha. Anote onde o Ollama rodou (CPU do contêiner, GPU nativa…).

| Métrica | Modelo local pequeno | Modelo local maior ou Claude |
|---|---|---|
| A · TTFT p50 / p95 com concorrência 1 (s) | | |
| A · TTFT p50 / p95 com concorrência 4 (s) | | |
| A · Total p50 / p95 com concorrência 1 (s) | | |
| A · Tokens/s (decodificação) | | |
| A · Requisições por minuto com concorrência 4 | | |
| B · hit@5 / MRR | | — |
| C · Respostas ancoradas (de 10) | | |
| D · US$ por requisição / por 1.000 requisições | 0 | |

Abaixo da tabela: para a venda relâmpago do BoxOffice (2 milhões de fãs, talvez 1% perguntando ao
assistente), qual configuração você rodaria, quantas requisições em andamento ela precisaria (Lei de
Little), e quanto custaria por hora?

[Voltar à visão geral](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
