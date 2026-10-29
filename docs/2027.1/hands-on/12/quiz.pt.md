Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Gateway e serving { #gateway-and-serving }

**Q1.** Por que o assistente chama os modelos por um `Router` do LiteLLM em vez de chamar diretamente os SDKs do Ollama e da Anthropic?

- A. O LiteLLM deixa os modelos mais rápidos
- B. Um único lugar é dono do roteamento, do fallback, dos timeouts, dos retries e da contabilização de custo; o resto do código chama um nome de rota ("local", "claude") e não muda quando um provedor ou um modelo muda
- C. A API da Anthropic não pode ser chamada a partir do Python
- D. O Ollama exige o LiteLLM

??? success "Resposta"
    **B — o gateway de LLM.**

    Provedores falham, mudam preços e são substituídos. Com um gateway, trocar o modelo padrão, adicionar um fallback ou um orçamento é configuração num único módulo. Em escala maior, a mesma ideia roda como um proxy compartilhado por todos os serviços de IA.

---

**Q2.** O assistente faz streaming da resposta. Por que o `http_req_waiting` do k6 (tempo até o primeiro byte) não é o tempo até o primeiro token?

- A. O k6 não consegue ler respostas HTTP
- B. O servidor envia o status e os headers HTTP quando a resposta começa, antes de o modelo produzir qualquer token; o TTFT precisa ser medido no primeiro `event: token` do stream
- C. O tempo até o primeiro byte é sempre maior que o TTFT
- D. Respostas SSE não têm primeiro byte

??? success "Resposta"
    **B — os headers vêm primeiro.**

    O `StreamingResponse` inicia a resposta imediatamente; o primeiro token chega segundos depois. É por isso que o `scripts/assistant_load.py` interpreta os Server-Sent Events, e por isso o serviço também registra o TTFT por conta própria (`assistant_ttft_seconds`).

---

**Q3.** Com concorrência 1, uma resposta leva 120 s. Os fãs enviam 1 pergunta por minuto. Quantas requisições estão em andamento, em média, e o que isso significa?

- A. 0,5: o modelo fica ocioso metade do tempo
- B. 2: Lei de Little, L = λ·W = (1/60 por s) × 120 s; com uma instância do modelo atendendo uma requisição de cada vez, as requisições fazem fila e o TTFT cresce
- C. 120: uma por segundo
- D. 1: sempre uma requisição

??? success "Resposta"
    **B — L = λW = 2.**

    Servir LLMs é um problema de filas como qualquer outro. A decodificação lenta (CPU) torna W grande, então mesmo uma taxa de chegada minúscula satura o servidor. As soluções são hardware mais rápido, batching do lado do serving, controle de admissão (uma fila com tempos de espera honestos) ou uma API hospedada.

---

## RAG

**Q4.** Por que os documentos recebem embedding com o prefixo `search_document:` e as perguntas com `search_query:`?

- A. O pgvector exige prefixos
- B. O `nomic-embed-text` foi treinado com esses prefixos de tarefa; usá-los coloca documentos e consultas nas regiões do espaço vetorial onde o modelo aprendeu a casá-los, melhorando a recuperação
- C. Para deixar os vetores mais curtos
- D. Para marcar quais linhas da tabela são documentos

??? success "Resposta"
    **B — siga o formato de treinamento do modelo de embeddings.**

    Cada modelo de embeddings tem as suas próprias convenções (prefixos, tamanho máximo, normalização). Ignorá-las diminui silenciosamente a qualidade da recuperação — e é por isso que a recuperação precisa ser medida (hit@k), e não presumida.

---

**Q5.** O que o índice HNSW em `embedding vector_cosine_ops` troca?

- A. Exatidão por velocidade: ele encontra os vizinhos mais próximos aproximados em tempo aproximadamente logarítmico, em vez de comparar a consulta com cada linha, e pode ocasionalmente perder um vizinho verdadeiro
- B. Disco por memória: ele não armazena vetores
- C. Consistência por disponibilidade
- D. Nada: ele é exato e mais rápido

??? success "Resposta"
    **A — vizinhos mais próximos aproximados.**

    Uma busca exata é uma varredura completa (ok para 300 linhas, não para milhões). O HNSW navega por um grafo em camadas; os seus parâmetros (`m`, `ef_construction` e `hnsw.ef_search` na hora da consulta) ajustam recall contra velocidade. O índice precisa usar a mesma classe de operador das consultas (`<=>` ↔ `vector_cosine_ops`).

---

**Q6.** A avaliação da recuperação dá hit@5 = 1,00, mas MRR = 0,94: a resposta certa de uma pergunta ficou na posição 3. Qual pergunta, e por que ela é a difícil?

- A. "When is Play #7?", porque 7 é um número pequeno
- B. "the big festival night at the stadium in São Paulo": o evento certo (BoxOffice Fest — Stadium Night) compete com muitos festivais genéricos no mesmo estádio; a busca vetorial é mais fraca com nomes e datas exatos, e é aí que a busca híbrida (palavras-chave + vetores) e os rerankers ajudam
- C. "Is there any festival in Recife?", porque há 9 respostas certas
- D. Nenhuma; o MRR é sempre menor que 1

??? success "Resposta"
    **B — nomes e especificidades.**

    Embeddings capturam bem "um festival num estádio em São Paulo", mas não qual deles é *o* grande. Uma busca por palavras-chave no título, ou um reranker que lê a consulta e os candidatos juntos, resolve exatamente esse tipo de erro.

---

## Ferramentas e agentes { #tools-and-agents }

**Q7.** Por que o `get_order_status` pega o e-mail do usuário do header `X-User-Email` em vez de um argumento da ferramenta?

- A. Argumentos de ferramentas não podem conter e-mails
- B. A identidade precisa vir da plataforma (o gateway validou o JWT), não do modelo: caso contrário, um usuário poderia pedir "mostre o pedido de ana@example.com", ou um prompt injection poderia fazer o modelo passar outro e-mail
- C. Para economizar tokens
- D. Porque o serviço de pedidos não tem campo de e-mail

??? success "Resposta"
    **B — o modelo não é uma camada de autenticação.**

    Tudo o que o modelo produz pode ser influenciado pelo usuário ou por texto injetado. Decisões de autorização usam fatos que o modelo não consegue forjar; a ferramenta também responde "order not found" para pedidos de outros usuários, então nem confirma que eles existem.

---

**Q8.** Por que o loop do agente é limitado a `MAX_STEPS = 4`, com a última chamada feita sem ferramentas?

- A. O Ollama não suporta mais de quatro chamadas
- B. Cada passo é mais uma chamada ao LLM (latência e custo se somam), e um modelo pode entrar em loop chamando ferramentas; o limite garante uma resposta em no máximo quatro chamadas
- C. Para deixar a resposta mais curta
- D. Porque só há três ferramentas

??? success "Resposta"
    **B — limite o custo e a latência de toda pergunta.**

    Agentes trocam previsibilidade por flexibilidade. Um limite de passos (e um orçamento de tokens ou de custo) transforma um loop aberto num loop com um pior caso para o qual dá para planejar capacidade.

---

**Q9.** Por que o assistente recupera os top-k eventos **antes** da primeira chamada ao modelo, em vez de confiar que o modelo chame `search_events`?

- A. Porque o `search_events` não funciona
- B. As perguntas comuns precisam do catálogo de qualquer forma, e modelos pequenos chamam ferramentas de forma pouco confiável; recuperar primeiro torna a resposta possível em uma chamada (menor latência e custo), e as ferramentas ficam para o que a recuperação não tem como saber, como o status de um pedido ao vivo
- C. Porque ferramentas não podem rodar em paralelo
- D. Para evitar usar o pgvector

??? success "Resposta"
    **B — RAG para conhecimento, ferramentas para dados ao vivo ou privados.**

    Toda ida e volta de ferramenta é uma chamada inteira a mais ao LLM. Um passo de recuperação determinístico é mais barato e não depende de o modelo decidir usar uma ferramenta.

---

## Segurança e custo { #safety-and-cost }

**Q10.** O guarda de entrada bloqueia "ignore all previous instructions". O assistente agora está protegido contra prompt injection?

- A. Sim, o padrão cobre todas as injections
- B. Não: padrões deixam passar paráfrases, outros idiomas e injections escondidas em documentos ou em resultados de ferramentas; a proteção real é arquitetural — ferramentas só de leitura, identidade vinda dos headers, verificações na saída — para que uma injection bem-sucedida consiga causar pouco dano
- C. Sim, se o padrão não diferencia maiúsculas de minúsculas
- D. Não, e não há nada a fazer

??? success "Resposta"
    **B — defesa em profundidade; limite o raio de impacto.**

    Trate a injection como inevitável e projete de forma que um modelo manipulado não tenha nada perigoso para chamar nem dados que não deveria ver. Filtros de padrões são uma primeira camada barata e um sinal mensurável (`assistant_guardrail_blocks_total`).

---

**Q11.** Uma resposta cita `[event:999]`, mas o evento 999 não estava no contexto nem foi retornado por uma ferramenta. O que o guarda de saída faz, e por quê?

- A. Nada; citações são decorativas
- B. Troca a citação por `[unverified]` e marca a resposta como `grounded: false` (contada numa métrica): o modelo inventou uma referência, então a afirmação ao lado dela não merece confiança
- C. Apaga a resposta inteira
- D. Chama `get_event(999)` para conferir

??? success "Resposta"
    **B — cite só o que você recebeu.**

    O conjunto de documentos que o modelo viu (`ctx.evidence`) é conhecido exatamente. Conferir as citações contra ele é barato e pega uma alucinação comum; a taxa de ancoragem ao longo de muitas perguntas é uma métrica de qualidade do modelo + prompt.

---

**Q12.** Uma pergunta usa cerca de 1.000 tokens de entrada e 100 tokens de saída. Com o `claude-opus-5-5` a US$ 4 por milhão de tokens de entrada e US$ 20 por milhão de tokens de saída, quanto ela custa, e quanto custam 20.000 perguntas no dia da venda?

- A. US$ 0,024 por pergunta; US$ 480
- B. US$ 0,006 por pergunta; US$ 120
- C. US$ 0,0006 por pergunta; US$ 12
- D. US$ 0,06 por pergunta; US$ 1.200

??? success "Resposta"
    **B — 1.000 × 4/10⁶ + 100 × 20/10⁶ = 0,004 + 0,002 = US$ 0,006; × 20.000 = US$ 120.**

    Os tokens de entrada dominam aqui por causa do contexto recuperado: menos documentos, ou documentos mais curtos, cortam o custo e o TTFT juntos. Essa conta é exatamente o que o `assistant_llm_cost_usd_total` acumula — com preços que você precisa manter atualizados.

[Voltar ao lab](index.md){ .md-button }
