Um fã pergunta ao assistente: *"Posso levar minha câmera ao show na Arena Paulista, e o setor C tem acesso sem degraus?"*

A resposta existe — em algum lugar entre 4.000 documentos: regras dos locais (PDFs enviados por cada local, em português, revisados a cada temporada), o guia de acessibilidade, o FAQ, a própria descrição do evento. O modelo nunca os viu: eles são privados, e muitos mudaram depois que seus dados de treinamento foram coletados. Perguntado diretamente, ele vai produzir uma resposta fluente, plausível e possivelmente errada.

Três soluções tentadoras, e por que elas não bastam:

| Abordagem | Ideia | Problema para o BoxOffice |
|---|---|---|
| **Colocar tudo no prompt** | pôr todos os documentos dos locais na janela de contexto | 4.000 documentos não cabem; mesmo os que cabem custam tokens em toda chamada e diluem a atenção[^6] |
| **Fazer fine-tuning do modelo** | treinar mais o modelo com os documentos | lento e caro de atualizar a cada temporada; não memoriza fatos de forma confiável; não consegue citar uma fonte; não consegue apagar as regras de um local |
| **Retrieval-augmented generation (RAG)** | no momento da pergunta, **recuperar** os poucos trechos relevantes e colocar **apenas esses** no prompt | o assunto desta página |
| *(e para dados ao vivo)* **Ferramentas** | consultar o serviço | preços e disponibilidade de assentos não são documentos — veja [Agentes e ferramentas](../agents/index.md) |

O RAG[^1] transforma um problema de conhecimento em um **problema de busca** — e busca é um problema de projeto de sistemas que você já sabe medir.

---

## Os dois pipelines { #the-two-pipelines }

Um sistema de RAG são dois pipelines que se encontram em um índice: um pipeline de **ingestão** (assíncrono, orientado a vazão) e um pipeline de **consulta** (síncrono, orientado a latência).

``` diagram-sim
flowchart LR
    subgraph Ingestion["Ingestão (assíncrona)"]
        src["PDFs dos locais, FAQ,<br/>descrições de eventos"] --> parse["extrair + limpar"]
        parse --> chunk["dividir em chunks + adicionar contexto"]
        chunk --> embed["gerar embeddings (em lote)"]
    end
    embed --> index[("Vector DB +<br/>índice de palavras-chave")]
    subgraph Query["Consulta (online)"]
        q["pergunta do fã"] --> rewrite["reescrever como<br/>consulta autônoma"]
        rewrite --> hybrid["busca híbrida:<br/>vetorial + palavras-chave"]
        hybrid --> rerank["reranquear top 20 → 5"]
        rerank --> prompt["prompt com as fontes"]
        prompt --> llm["resposta do LLM<br/>com citações"]
    end
    index --> hybrid
```

---

## Ingestão { #ingestion }

### Fontes, extração e atualização { #sources-parsing-and-freshness }

A ingestão começa como um pipeline de dados comum: ler os documentos de onde eles estão (object store, CMS, o banco de dados do `catalog`), extrair texto limpo (a extração de PDFs costuma ser a parte mais difícil: tabelas, colunas, cabeçalhos repetidos em toda página) e anexar **metadados** — `doc_id`, `venue_id`, idioma, versão, data de vigência, nível de acesso. São os metadados que permitem filtrar (*só este local*), citar (*regras da Arena Paulista, §4*) e apagar (*as regras de 2026 estão obsoletas*).

O índice precisa acompanhar as fontes. Em vez de gerar de novo todos os embeddings toda noite, propague as **mudanças**: o serviço `catalog` publica um evento quando uma descrição muda (outbox ou change data capture, como em [Mensageria](../../messaging/patterns/index.md)); um worker de embeddings o consome e atualiza apenas os chunks afetados. As **exclusões** também precisam se propagar — uma regra removida que ainda pode ser recuperada é uma resposta errada esperando para acontecer.

### Chunking { #chunking }

Os documentos são divididos em **chunks** (trechos), a unidade de recuperação. O tamanho do chunk é um trade-off entre precisão e contexto: chunks pequenos casam com as perguntas de forma precisa, mas perdem o contexto ao redor; chunks grandes mantêm o contexto, mas diluem o casamento e custam mais tokens no prompt.

| Estratégia | Como | Quando |
|---|---|---|
| Tamanho fixo + sobreposição | ex.: 400 tokens com 15% de sobreposição | linha de base; texto uniforme |
| **Ciente da estrutura** (recursiva) | divide por títulos, depois parágrafos, depois frases, até um tamanho máximo | regras, FAQs, manuais — a maioria dos documentos do BoxOffice |
| Semântica | divide onde o assunto muda (a similaridade de embedding entre frases cai) | texto longo sem estrutura |
| Documento inteiro | um chunk por documento pequeno | entradas de FAQ, descrições de eventos |
| **Pai–filho** | recupera com chunks pequenos, envia ao modelo a seção pai, maior | casamento preciso **e** contexto suficiente |
| **Chunks contextualizados** | antes de gerar o embedding, acrescenta no início o título e a seção do documento, ou uma frase resumindo onde o chunk se encaixa[^2] | chunks ambíguos quando isolados ("Item 4: não permitido.") |

!!! example "Por que o contexto importa"

    O chunk *"Câmeras profissionais com lentes destacáveis não são permitidas."* é inútil sem saber a **qual local** ele pertence. Com o embedding gerado como *"Arena Paulista — Regras para visitantes 2027 — §4 Itens proibidos: Câmeras profissionais com lentes destacáveis não são permitidas."*, ele pode ser recuperado pelo nome do local e citado.

### Embeddings { #embeddings }

Um **modelo de embedding** mapeia um texto em um vetor de algumas centenas a alguns milhares de números, treinado para que textos de significado parecido tenham vetores que apontam em direções parecidas. A similaridade costuma ser medida pela **similaridade de cosseno** (ou pelo produto interno de vetores normalizados):

$$
\cos(\vec{a}, \vec{b}) = \frac{\vec{a} \cdot \vec{b}}{\lVert\vec{a}\rVert \, \lVert\vec{b}\rVert}
$$

Regras práticas:

- **O mesmo modelo para documentos e consultas** — vetores de modelos diferentes vivem em espaços diferentes e não podem ser comparados.
- **Modelo multilíngue** para o BoxOffice: os fãs perguntam em português, inglês e espanhol; alguns documentos dos locais existem só em português.
- **Guarde o nome do modelo com cada vetor** (`embed_model`). Trocar o modelo de embedding significa **gerar de novo os embeddings de todo o corpus** — faça isso como um deploy blue/green: construa o novo índice ao lado, mude as leituras e depois descarte o antigo.
- **Gerar embeddings é barato comparado à geração de texto** (uma única passada pelo modelo, sem decodificação), e o lado da ingestão pode usar APIs em lote; o lado da consulta gera o embedding de uma pergunta curta por requisição (de alguns milissegundos a dezenas de milissegundos).

Quanta memória o índice precisa? Os vetores brutos ocupam $N \times d \times$ bytes por valor; um grafo HNSW acrescenta links para os vizinhos de cada vetor:

```python exec="true" html="1" source="tabbed-right"
# Memory needed by a vector index: raw vectors + HNSW graph links.
# HNSW keeps ~2*m neighbor ids per vector on the base layer (m = 16 here);
# real overhead varies by implementation: treat as an estimate.
M, ID_BYTES = 16, 8


def size_gb(n, dims, bytes_per_value):
    vectors = n * dims * bytes_per_value
    graph = n * 2 * M * ID_BYTES
    return (vectors + graph) / 1e9


head = ["Chunks", "384 dims, float32", "1024 dims, float32", "1024 dims, float16",
        "3072 dims, float32"]
print("<table><thead><tr>" + "".join(f"<th>{h}</th>" for h in head) + "</tr></thead><tbody>")
for n in (100_000, 1_000_000, 10_000_000, 100_000_000):
    cells = [f"{n:,}"] + [f"{size_gb(n, d, b):,.1f} GB"
                          for d, b in ((384, 4), (1024, 4), (1024, 2), (3072, 4))]
    print("<tr>" + "".join(f'<td style="text-align:right">{c}</td>' for c in cells) + "</tr>")
print("</tbody></table>")
```

Os 4.000 documentos do BoxOffice viram ~60.000 chunks: bem menos de 1 GB, cabendo com folga no PostgreSQL que o time já opera. Dez milhões de chunks de 1.024 dimensões (~44 GB) é o ponto em que bancos vetoriais dedicados, quantização (vetores de meia precisão ou binários) e sharding começam a compensar.

---

## Busca vetorial { #vector-search }

Encontrar os vizinhos mais próximos exatos significa comparar a consulta com **todos** os vetores — tudo bem para 60.000 chunks, lento demais para 100 milhões. Índices de **vizinhos mais próximos aproximados (ANN)** trocam um pouco de recall (revocação) por ordens de grandeza de velocidade (veja [Bancos de dados — especializados](../../databases/specialized/index.md)):

| Índice | Ideia | Pontos fortes | Pontos fracos |
|---|---|---|---|
| **HNSW**[^3] | grafo de proximidade em várias camadas; busca gulosa a partir de uma camada grossa, descendo | recall alto, latência baixa, inserções incrementais | consome muita memória; lento para construir |
| **IVF** (inverted file) | agrupa os vetores em clusters; busca só nos clusters mais próximos | menor, rápido para construir | precisa de treinamento; o recall cai para dados longe dos centroides |
| Quantização (PQ, binária) | comprime os vetores | 4–32× menos memória | precisão menor; normalmente reavaliado com os vetores completos |

O botão de ajuste é o **trade-off entre recall e latência**: o `ef_search` do HNSW (candidatos explorados por consulta) e os `probes` do IVF aumentam o recall ao custo de latência. Meça o **recall@k em relação à busca exata** em uma amostra de consultas reais, como você mediria a taxa de acerto de um cache.

**Filtros complicam o ANN.** *"Regras do local X"* é um filtro de metadados aplicado a uma busca aproximada: se o índice devolve os 40 chunks mais próximos e só 2 pertencem ao local X, o resultado tem 2 linhas em vez de 40. Remédios: índices cientes de filtros, particionamento pela chave do filtro, ou varreduras iterativas que continuam buscando até que linhas suficientes passem no filtro (o pgvector suporta isso desde a versão 0.8, com `hnsw.iterative_scan`).

=== "PostgreSQL + pgvector"

    O tipo `vector`, operadores de distância (`<->` L2, `<=>` distância de cosseno, `<#>` produto interno negativo) e índices HNSW/IVFFlat dentro do banco de dados que você já opera: transações, joins com metadados, backups e controle de acesso de graça. O HNSW sobre `vector` suporta até 2.000 dimensões (`halfvec`, até 4.000). Atende bem até milhões de vetores por nó. Usado no [Hands-on 12](../../../hands-on/12/index.md).

=== "Bancos de dados vetoriais dedicados"

    Qdrant, Milvus, Weaviate, Pinecone (gerenciado), entre outros: sharding e replicação embutidos, quantização, busca filtrada e busca híbrida na escala de centenas de milhões de vetores. Mais um sistema para operar e manter consistente com a fonte da verdade.

=== "Motores de busca com vetores"

    OpenSearch, Elasticsearch, Vespa: busca por palavras-chave madura (BM25), agregações e vetores no mesmo motor — uma escolha natural quando você já roda um deles para a [Busca](../../databases/specialized/index.md) do catálogo.

---

## O pipeline de consulta { #the-query-pipeline }

### 1. Reescrever a pergunta { #1-rewrite-the-question }

*"E o setor C?"* não significa nada sozinho. Antes de buscar, uma chamada barata ao modelo (ou o próprio agente) reescreve o turno como uma **consulta autônoma** usando a conversa — *"acesso sem degraus ao setor C na Arena Paulista"* — e extrai filtros (`venue_id`). Alguns sistemas também geram várias variantes da consulta ou uma resposta hipotética para usar na busca.

### 2. Busca híbrida { #hybrid }

Vetores densos capturam significado, mas são fracos com **tokens exatos**: setor "C", números de portão, códigos de evento, nomes de artistas, siglas como *PCD* (*pessoa com deficiência*). A busca por palavras-chave com BM25[^4] é o oposto: exata, mas cega a paráfrases ("sem degraus" vs. "acessível para cadeirantes"). A **busca híbrida** roda as duas e funde os rankings. A fusão padrão é a **Reciprocal Rank Fusion (RRF)**[^5], que precisa só das posições, não de scores comparáveis:

$$
\text{RRF}(d) = \sum_{r \in \text{rankings}} \frac{1}{k + \text{rank}_r(d)}, \qquad k = 60
$$

Um chunk em 1º lugar pelas palavras-chave e em 3º pelos vetores pontua $1/61 + 1/63 ≈ 0.0323$; um em 1º só pelos vetores pontua $1/61 ≈ 0.0164$. A concordância entre os dois recuperadores vence.

### 3. Reranquear { #3-rerank }

O primeiro estágio é rápido, mas grosseiro: cada chunk teve seu embedding gerado **sem ver a pergunta**. Um **reranqueador** (um cross-encoder) lê a pergunta e cada candidato **juntos** e produz um score de relevância[^7] — muito mais preciso, muito mais lento (uma passada do modelo por par). Por isso ele roda só sobre os 20–50 melhores candidatos e mantém os 3–8 melhores. Custo típico: de dezenas a algumas centenas de milissegundos.

### 4. Montar o contexto e citar { #4-assemble-the-context-and-cite }

Coloque os chunks selecionados no prompt com seus IDs e títulos, o melhor primeiro (os modelos aproveitam melhor o começo e o fim de um contexto longo do que o meio[^6]), dentro de um orçamento de tokens. Instrua o modelo a responder **apenas a partir das fontes**, a citá-las como `[doc_id]` e a dizer *"não sei"* quando as fontes não respondem. Depois, **verifique**: todo ID citado precisa ser um dos chunks fornecidos (uma verificação barata e determinística no [Safety Mesh](../safety-evals/index.md)).

### O schema e a consulta no PostgreSQL { #the-schema-and-the-query-in-postgresql }

``` sql title="kb_schema.sql"
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge base: venue rules, FAQ, accessibility guides (one row per chunk)
CREATE TABLE kb_chunk (
    id          bigserial PRIMARY KEY,
    doc_id      text         NOT NULL,     -- source document, for citations and deletes
    venue_id    text,                      -- NULL = applies to every venue
    title       text         NOT NULL,     -- "Arena Paulista — Visitor rules 2027 — §4"
    content     text         NOT NULL,
    embedding   vector(1024) NOT NULL,     -- dimension of the embedding model
    embed_model text         NOT NULL,     -- which model produced the vector
    tsv         tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
    updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX kb_chunk_embedding ON kb_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX kb_chunk_tsv       ON kb_chunk USING gin (tsv);
CREATE INDEX kb_chunk_venue     ON kb_chunk (venue_id);
```

``` sql title="hybrid_search.sql"
-- $1 = query embedding, $2 = query text, $3 = venue id
WITH q AS (  -- the words of the question, joined with OR
    SELECT to_tsquery('portuguese', array_to_string(
               tsvector_to_array(to_tsvector('portuguese', $2)), ' | ')) AS query
),
semantic AS (
    SELECT id, row_number() OVER (ORDER BY dist) AS rank
    FROM (SELECT id, embedding <=> $1 AS dist          -- cosine distance (HNSW index)
          FROM kb_chunk
          WHERE venue_id = $3 OR venue_id IS NULL
          ORDER BY dist
          LIMIT 40) AS nearest
),
keyword AS (
    SELECT id, row_number() OVER (ORDER BY score DESC) AS rank
    FROM (SELECT id, ts_rank_cd(tsv, q.query) AS score -- full-text match (GIN index)
          FROM kb_chunk, q
          WHERE tsv @@ q.query AND (venue_id = $3 OR venue_id IS NULL)
          ORDER BY score DESC
          LIMIT 40) AS matches
)
SELECT c.id, c.doc_id, c.title, c.content,
       coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + k.rank), 0) AS rrf
FROM semantic s
FULL OUTER JOIN keyword k USING (id)
JOIN kb_chunk c USING (id)
ORDER BY rrf DESC
LIMIT 20;  -- candidates for the reranker, which keeps the best 5
```

O `ts_rank_cd` do PostgreSQL não é exatamente BM25, mas, para a fusão, só a **ordem do ranking** importa; motores como o OpenSearch oferecem BM25 nativamente.

!!! example "No código do BoxOffice: pgvector no banco que a BoxOffice já opera (lab 12)"

    O [Hands-on 12 — RAG com pgvector](../../../hands-on/12/rag/index.md) constrói a menor versão deste pipeline. Cada evento é curto o bastante para ser o seu próprio chunk: uma linha por evento, com embedding do `nomic-embed-text` (768 dimensões), num schema `assistant` do mesmo PostgreSQL, com um índice HNSW sobre a distância de cosseno. A consulta é **busca vetorial pura**: top-k por `<=>`. Escolher o pgvector em vez de um banco vetorial dedicado não custa quase nada para operar com algumas centenas de eventos — é mais um schema num banco que o time já protege e já inclui nos backups; o preço é o que esta versão simplificada deixa de fora (sem a metade por palavras-chave, sem reranker), e a avaliação abaixo mostra onde isso dói.

    ``` { .python title="services/assistant/app/db.py (the table and the index)" }
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/db.py:11:21"
    ```

    ``` { .python title="services/assistant/app/rag.py (the search)" }
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/rag.py:65:77"
    ```

### Orçamento de latência de uma recuperação { #latency-budget-of-one-retrieval }

| Estágio | Latência típica |
|---|---|
| Reescrever a consulta (modelo pequeno) | 200–500 ms |
| Gerar o embedding da consulta | 5–50 ms |
| Busca vetorial + por palavras-chave (em paralelo) | 5–30 ms |
| Reranquear 20–40 candidatos | 30–200 ms |
| Tokens extras no prompt (5 chunks × ~400 tokens) | +2.000 tokens de entrada por chamada ao modelo → custo, e TTFT se não houver cache |

A recuperação em si é barata; o que você paga são os **tokens extras que ela acrescenta a cada chamada ao modelo**. Recupere menos chunks, e melhores.

### Medindo a recuperação { #measuring-retrieval }

Avalie as duas metades separadamente (mais em [Segurança, avaliações e observabilidade](../safety-evals/index.md#evaluation)):

- **Recuperação**: para um conjunto de perguntas com chunks relevantes conhecidos, **recall@k** (o chunk certo entrou no top *k*?), precision@k e **MRR** (mean reciprocal rank: quão alto aparece o primeiro chunk relevante).
- **Geração**: **fidelidade/fundamentação** (faithfulness/groundedness: toda afirmação é sustentada pelas fontes recuperadas?) e relevância da resposta; frameworks como o RAGAS[^8] automatizam essas métricas com juízes baseados em modelos.

Se a resposta está errada, essas métricas dizem *onde*: a recuperação não trouxe o documento (corrija o chunking, a busca híbrida, os filtros) ou o modelo o ignorou (corrija o prompt, a ordem, o modelo).

!!! example "No código do BoxOffice: hit@k e MRR num conjunto rotulado (lab 12)"

    O seed do catálogo do lab 1 é gerado por uma fórmula, então o `eval_retrieval.py` sabe quais são os eventos certos para cada pergunta e mede só a recuperação, antes de qualquer modelo entrar. Uma execução de teste no [Hands-on 12 — RAG](../../../hands-on/12/rag/index.md) deu **hit@5 = 1,00 e MRR = 0,94** em 11 perguntas. A única posição imperfeita é "the big festival night at the stadium in São Paulo": o evento certo veio em 3º, atrás de festivais genéricos no mesmo estádio — nomes exatos são onde a busca vetorial pura é mais fraca, e onde a [busca híbrida](#hybrid) ajuda.

    ``` { .python title="scripts/eval_retrieval.py (labels and scores)" }
    --8<-- "docs/2027.1/hands-on/12/code/scripts/eval_retrieval.py:30:43,52:62"
    ```

### Variantes que você vai encontrar { #variants-you-will-meet }

| Variante | Ideia | Use quando |
|---|---|---|
| **Agentic RAG** | a recuperação é uma ferramenta; o agente decide quando e o que buscar, possivelmente várias vezes | perguntas multi-hop ("compare as regras de bolsas dos dois locais") |
| **GraphRAG** | constrói um grafo de conhecimento com entidades e relações; recupera subgrafos ou resumos de comunidades | perguntas sobre relações entre muitos documentos |
| **RAG multimodal** | indexa imagens e tabelas (mapas dos locais, mapas de assentos) com embeddings multimodais | conhecimento que está em imagens |
| **Contexto longo + RAG** | recupera documentos inteiros em vez de chunks, apoiando-se em janelas grandes | poucos documentos, longos e coerentes; quando custo e latência permitem |

---

## Memória { #memory }

O RAG responde *"o que o mundo sabe?"*. A **memória** responde *"o que o assistente sabe sobre esta conversa e este fã?"*. As duas acabam virando tokens no prompt, mas têm tempos de vida, donos e riscos diferentes. Um vocabulário útil vem das arquiteturas cognitivas para agentes de linguagem[^9]:

| Tipo de memória | O que guarda | Exemplo no BoxOffice | Onde fica | Tempo de vida |
|---|---|---|---|---|
| **De trabalho** | a janela de contexto atual | o prompt desta chamada | a chamada ao modelo | uma chamada |
| **De curto prazo (sessão)** | a conversa até aqui, o estado da tarefa, reservas pendentes | "o fã está escolhendo entre C12–C13 e D4–D5" | Redis, com chave pela conversa, com TTL | de minutos a horas |
| **De longo prazo — semântica** | fatos estáveis e preferências do usuário | "prefere assentos no corredor", "cidade: Campinas" | SQL (tabela de perfil), editável pelo fã | até ser alterada ou apagada |
| **De longo prazo — episódica** | interações passadas, recuperáveis por similaridade | "no mês passado a transferência do fã falhou; foi reembolsada" | índice vetorial sobre resumos de conversas passadas | política de retenção |
| **Procedural** | como o assistente se comporta: instruções, regras de uso de ferramentas, exemplos | o system prompt, as regras de reembolso | Git, versionada e avaliada como código | a cada release |

``` diagram-sim
flowchart LR
    orch["Orchestrator"] -->|"1. carregar a sessão"| redis[("Cache<br/>sessão, TTL 2 h")]
    orch -->|"2. carregar o perfil"| sql[("SQL<br/>preferências")]
    orch -->|"3. lembrar episódios"| epi[("Vector DB<br/>conversas passadas")]
    orch -->|"4. recuperar conhecimento"| kb[("Vector DB<br/>base de conhecimento")]
    orch -->|"5. depois do turno: anexar"| redis
    orch -.->|"6. assíncrono: extrair memórias"| worker["worker de memória"]
    worker -.-> sql
    worker -.-> epi
```

### Escrevendo memórias { #writing-memories }

Ler a memória é recuperação; **escrevê-la** é onde estão os riscos:

- Memórias **explícitas** ("lembre que eu uso cadeira de rodas") são confiáveis, mas raras. A extração **implícita** — um worker pede a um modelo que extraia fatos de conversas encerradas — é conveniente e sujeita a erros: uma piada vira um "fato", uma inferência errada persiste para sempre.
- **Envenenamento de memória**: conteúdo injetado em uma conversa (ou em um documento) pode ser salvo como fato e influenciar todas as sessões futuras. Extraia apenas das **mensagens do próprio usuário**, nunca de resultados de ferramentas ou de documentos recuperados, e guarde a origem de cada memória.
- **A memória de curto prazo transborda** o contexto em sessões longas: mantenha os últimos turnos na íntegra e **compacte** os mais antigos em um resumo contínuo.
- **Consistência**: memórias escritas de forma assíncrona não ficam visíveis no turno seguinte — read-your-writes de novo ([Consistência distribuída](../../distributed/consistency/index.md)). Escreva a sessão de forma síncrona; extraia as memórias de longo prazo de forma assíncrona.

### Privacidade é uma restrição de projeto { #privacy-is-a-design-constraint }

A memória transforma o assistente em um repositório de dados pessoais. Pela Lei Geral de Proteção de Dados (LGPD), informações de saúde, como uma deficiência, são **dados pessoais sensíveis** e exigem consentimento específico. As implicações para o projeto são concretas:

- Mostre ao fã o que está memorizado e deixe-o **editar e apagar**.
- **A exclusão precisa chegar a todas as cópias**: a linha do perfil, os vetores episódicos, o cache de sessão, o cache semântico, os logs e traces que capturaram prompts. Projete as chaves `doc_id`/`user_id` para que uma exclusão seja uma consulta por repositório, não um projeto de arqueologia.
- Aplique **retenção** (TTL) por padrão; mantenha as memórias por tenant e por usuário, e filtre a recuperação por eles — nunca busque os episódios de um usuário para outro.

!!! example "BoxOffice: um turno, todas as memórias"

    Para *"dois assentos abaixo de R$ 300 para sábado"*, o orquestrador carrega a sessão (vazia: conversa nova), o perfil (cidade São Paulo, prefere assentos no corredor, precisa de acesso sem degraus — guardado com consentimento), nenhum episódio relevante e nenhum chunk da base de conhecimento (é uma consulta estruturada, tratada por ferramentas). O prompt final menciona *"prefere assentos no corredor; precisa de acesso sem degraus"*, então o modelo pede a `search_seats` assentos no corredor em setores acessíveis. Quando o fã depois pergunta *"posso levar minha câmera?"*, o mesmo orquestrador recupera dois chunks das regras do local e os cita.

!!! tip "Na entrevista"

    Desenhe os **dois pipelines** (ingestão assíncrona, consulta online) e nomeie os estágios: chunking, embedding, indexação; reescrita, **busca híbrida com RRF**, **reranqueamento**, citação. Estime o tamanho do índice ($N \times d \times 4$ bytes) e diga onde ele fica (pgvector até dezenas de milhões de vetores). Diga explicitamente que **dados estruturados ao vivo passam por ferramentas, não por RAG**, que o índice é mantido atualizado com **eventos de mudança** e que a memória tem **tipos com repositórios e tempos de vida diferentes** — além da exclusão, por privacidade.

!!! success "Boas práticas"

    - **Meça a recuperação num conjunto rotulado antes de ajustar o prompt** — hit@k e MRR dizem se a resposta sequer estava no contexto. No BoxOffice: o `eval_retrieval.py` mediu hit@5 = 1,00 e MRR = 0,94 ([lab 12 — RAG](../../../hands-on/12/rag/index.md)).
    - **Registre o modelo de embedding e a dimensão junto com o índice** — trocar o modelo vira então um re-embedding planejado, como uma migração de schema. No BoxOffice: `EMBED_MODEL` e `EMBED_DIM` (768) são configuração, e a tabela declara `vector(768)`.
    - **Faça upsert por um id estável do documento** — a reingestão precisa substituir um documento, não duplicá-lo. No BoxOffice: `ON CONFLICT (id) DO UPDATE` em `event:<id>` no `rag.py`.
    - **Dê ao índice um SLO de atualização e meça o seu atraso** — por exemplo, uma regra de local alterada fica pesquisável em até 5 minutos; acompanhe o atraso da ingestão como o atraso de um consumidor.
    - **Dê às memórias um TTL e um caminho de exclusão por usuário** — o direito ao esquecimento da LGPD precisa chegar ao cache de sessão, ao armazenamento de longo prazo e ao índice vetorial.

!!! warning "Armadilhas comuns"

    - **Busca só vetorial** — não acha códigos de setor, nomes e siglas; acrescente busca por palavras-chave.
    - **Chunks sem contexto** — "Item 4: não permitido" não casa com nada útil; acrescente títulos e seções no início.
    - **Misturar modelos de embedding** em um mesmo índice, ou trocar o modelo sem gerar de novo os embeddings.
    - **Chunks velhos ou zumbis** — atualizações e exclusões na fonte nunca chegam ao índice.
    - **Recuperação sem controle de acesso** — o índice devolve um documento que o usuário não pode ver; filtre por tenant/permissões **na consulta**, não depois da geração.
    - **Chunks demais** — 20 chunks "por via das dúvidas" custam tokens em toda chamada e enterram a resposta no meio.
    - **Salvar saídas de ferramentas ou documentos como memórias do usuário** — a porta de entrada para o envenenamento de memória.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    SRC["venue PDFs, FAQ,<br/>event descriptions"] --> ING["ingestion: parse,<br/>chunk, embed (batch)"]
    CDC["change events<br/>→ Messaging outbox / CDC"] --> ING
    ING --> IDX["vector + keyword index<br/>→ Databases specialized"]
    Q["fan question"] --> HY["rewrite, hybrid search,<br/>RRF, rerank"]
    IDX --> HY
    HY --> P["prompt with citations"]
    MEM["memory types: session,<br/>profile, episodic"] --> P
    MEM --> RYW["read-your-writes<br/>→ Distributed consistency"]
    MEM --> DEL["deletion reaches<br/>every copy (LGPD)"]
    P --> GUARD["retrieved text is untrusted<br/>→ Safety mesh"]
```

**Componentes da paleta:** [`memory`](../../../reference/components/ai/index.md#memory) (a malha inteira) · [`vectordb`](../../../reference/components/storage/index.md#vectordb) (base de conhecimento e memórias episódicas) · [`cache`](../../../reference/components/storage/index.md#cache) (memória de sessão com TTL) · [`sql`](../../../reference/components/storage/index.md#sql) (perfil e preferências; o pgvector também mora aqui) · [`objstore`](../../../reference/components/storage/index.md#objstore) (os documentos de origem) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (eventos de mudança que mantêm o índice atualizado) · [`worker`](../../../reference/components/compute/index.md#worker) (ingestão e extração de memórias fora do caminho da requisição). **Cenários:** `ai-assistant`. **Continua em:** [Bancos de dados — especializados](../../databases/specialized/index.md) (busca vetorial), [Mensageria — padrões](../../messaging/patterns/index.md) (outbox, CDC), [Sistemas distribuídos — consistência](../../distributed/consistency/index.md), [Agentes e ferramentas](../agents/index.md) (dados vivos passam por ferramentas, não por RAG), [Segurança, avaliações e observabilidade](../safety-evals/index.md).

---

[^1]: LEWIS, P. et al. [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401){target="_blank"}. NeurIPS, 2020.
[^2]: ANTHROPIC. [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval){target="_blank"}. 2024.
[^3]: MALKOV, Y.; YASHUNIN, D. [Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs](https://arxiv.org/abs/1603.09320){target="_blank"}. IEEE TPAMI, 2018.
[^4]: ROBERTSON, S.; ZARAGOZA, H. The Probabilistic Relevance Framework: BM25 and Beyond. *Foundations and Trends in Information Retrieval*, 2009.
[^5]: CORMACK, G.; CLARKE, C.; BÜTTCHER, S. Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods. SIGIR, 2009.
[^6]: LIU, N. F. et al. [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172){target="_blank"}. TACL, 2024.
[^7]: NOGUEIRA, R.; CHO, K. [Passage Re-ranking with BERT](https://arxiv.org/abs/1901.04085){target="_blank"}. arXiv, 2019.
[^8]: ES, S. et al. [RAGAS: Automated Evaluation of Retrieval Augmented Generation](https://arxiv.org/abs/2309.15217){target="_blank"}. EACL (demo), 2024.
[^9]: SUMERS, T. et al. [Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427){target="_blank"}. TMLR, 2024.
