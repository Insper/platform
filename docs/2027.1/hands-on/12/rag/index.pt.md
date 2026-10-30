# 2. RAG com pgvector { #2-rag-with-pgvector }

Um modelo de linguagem não sabe nada sobre o catálogo do BoxOffice *desta semana*, e quando não sabe,
inventa com confiança. A **geração aumentada por recuperação** (RAG) resolve o primeiro problema e reduz
o segundo: antes que o modelo responda, o serviço *recupera* os documentos mais relacionados à pergunta
e os coloca no prompt, com instruções para responder só a partir deles e citá-los. A teoria está na
[aula de RAG e memória](../../../classes/ai-systems/rag-memory/index.md).

``` diagram-sim
flowchart LR
    subgraph ingest [ingestão: uma vez, e quando o catálogo muda]
        cat[API do catalog] --> txt[evento -> texto]
        txt --> emb1[modelo de embeddings]
        emb1 --> pg[("assistant.documents (vector 768)")]
    end
    subgraph query [toda pergunta]
        q[pergunta] --> emb2[modelo de embeddings]
        emb2 -->|"ORDER BY embedding <=> q LIMIT k"| pg
        pg --> ctx[top-k documentos]
        ctx --> llm[LLM: resposta + citações]
    end
```

## Embeddings em um parágrafo { #embeddings-in-one-paragraph }

Um **modelo de embeddings** mapeia um texto para um vetor (aqui, 768 números) de modo que textos com
significado parecido recebam vetores apontando em direções parecidas. "Tem algum festival em Recife?" e
"Festival #74 na Arena Recife…" acabam próximos, mesmo com poucas palavras em comum. A **distância do
cosseno** (`<=>` no pgvector) mede o ângulo entre dois vetores: 0 para a mesma direção, até 2 para
direções opostas; `1 - distância` é a similaridade que a busca retorna.

## A tabela e o índice { #the-table-and-the-index }

``` python title="services/assistant/app/db.py"
--8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/db.py"
```

- `vector(768)` é o tipo de coluna do pgvector; a dimensão precisa bater com a do modelo de embeddings.
- **HNSW** (Hierarchical Navigable Small World) é um índice de vizinhos mais próximos *aproximado*: um
  grafo em camadas que encontra os vetores mais próximos em tempo logarítmico, em vez de comparar a
  consulta com cada linha. Ele troca um pouco de recall por muita velocidade; `vector_cosine_ops` o
  constrói para a distância do cosseno que as consultas usam.
- O schema é criado pelo serviço na inicialização (`CREATE … IF NOT EXISTS`), não pelo Flyway: o
  assistente é o único serviço Python e mantém a sua única tabela simples. Cada serviço continua dono do
  seu próprio schema, como no lab 0.

## Ingestão e busca { #ingestion-and-search }

``` python title="services/assistant/app/rag.py"
--8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/rag.py"
```

| Decisão | Por quê |
|---|---|
| um documento por evento, escrito como uma frase | o modelo de embeddings foi treinado com frases, não com JSON; "o quê, onde, quando, quanto" é o que os fãs perguntam |
| prefixos `search_document:` / `search_query:` | o `nomic-embed-text` foi treinado com eles; sem eles, a qualidade da recuperação cai |
| lotes de 32 textos por chamada de embedding | menos idas e voltas; o modelo processa um lote mais rápido que 32 chamadas avulsas |
| `ON CONFLICT … DO UPDATE` | rodar a ingestão de novo atualiza os eventos alterados em vez de duplicá-los |
| `ORDER BY embedding <=> %s LIMIT k` | exatamente a forma que o índice HNSW acelera (um `ORDER BY` pela distância, com um `LIMIT`) |

O seed do catálogo do lab 1 tem 200.000 eventos; gerar o embedding de todos numa CPU de notebook levaria
horas. O lab ingere os primeiros `limit` eventos (300 aqui); sistemas em produção geram embeddings de
forma incremental, conforme os eventos são criados ou alterados (um evento de outbox do lab 7 é o
gatilho natural).

## Ingira e busque { #ingest-and-search }

<!-- termynal -->

``` shell
> curl -s -X POST localhost:8088/assistant/ingest -H 'Content-Type: application/json' -d '{"limit":300}'
{"ingested":300}
> curl -s -X POST localhost:8088/assistant/search -H 'Content-Type: application/json' \
    -d '{"query":"festival at the stadium in São Paulo","k":3}' | jq -r '.[] | "\(.id) \(.score)"'
event:50 0.8523837787745167
event:150 0.8472402642106125
event:250 0.8454701076817256
```

A ingestão levou 3 minutos e meio numa execução de teste num notebook ocupado, com o Ollama na CPU
(≈ 1,4 evento/s); com o Ollama numa GPU, leva segundos. Você deve ver `{"ingested":300}` e três ids
`event:N` com similaridades em torno de 0,8. Olhe as linhas no PostgreSQL:

``` shell
docker compose exec db psql -U boxoffice -d boxoffice \
  -c "SELECT id, left(content, 70) FROM assistant.documents ORDER BY id LIMIT 3;"
```

## Avalie a recuperação { #evaluate-the-retrieval }

"Retornou algo plausível" não é uma medição. Como o seed do catálogo é gerado por uma fórmula, as
respostas certas para um conjunto de perguntas são conhecidas exatamente, e a recuperação pode ser
pontuada:

``` python title="scripts/eval_retrieval.py"
--8<-- "docs/2027.1/hands-on/12/code/scripts/eval_retrieval.py"
```

O cabeçalho `# /// script` são metadados de script inline: o `uv run` os lê e roda o script num ambiente
descartável com `httpx`, sem `pip install` e sem ambiente virtual para gerenciar.

``` shell
uv run scripts/eval_retrieval.py --k 5 --limit 300
```

Uma execução de teste com `nomic-embed-text`:

``` text
| question | relevant | first relevant rank |
|---|---|---|
| When is Play #7? | 1 | 1 |
| When is Festival #42? | 1 | 1 |
| When is Festival #118? | 1 | 1 |
| When is Play #199? | 1 | 1 |
| When is Concert #256? | 1 | 1 |
| Is there any festival in Recife? | 9 | 1 |
| Is there any play in Curitiba? | 6 | 1 |
| Is there any match in Salvador? | 9 | 1 |
| Is there any concert in Manaus? | 6 | 1 |
| Is there any festival in São Paulo? | 10 | 1 |
| the big festival night at the stadium in São Paulo | 1 | 3 |

hit@5 = 1.00   MRR = 0.94   (11 questions)
```

**hit@k** é a fração de perguntas com pelo menos um documento certo entre os k primeiros; o **MRR** (mean
reciprocal rank) também recompensa colocá-lo em primeiro (posição 1 → 1, posição 3 → ⅓). A última
pergunta é a difícil: "the big festival night" é o evento 1, *BoxOffice Fest — Stadium Night*, e os
festivais genéricos no mesmo estádio ficam acima dele. Datas e nomes exatos são onde a busca puramente
vetorial é mais fraca; sistemas reais a combinam com busca por palavras-chave (**busca híbrida**) e um
**reranker**.

??? question "Por que avaliar a recuperação separadamente das respostas?"

    Se o documento certo não está no contexto, nenhum modelo consegue responder corretamente — e a falha
    parece um "modelo ruim". Medir só a recuperação diz qual metade do pipeline consertar, e é barato:
    nenhuma chamada ao LLM, totalmente determinístico.

[Próximo: Ferramentas e o loop do agente](../tools/index.md){ .md-button .md-button--primary }
