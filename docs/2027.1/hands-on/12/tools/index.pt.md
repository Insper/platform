# 3. Ferramentas e o Loop do Agente { #3-tools-and-the-agent-loop }

A recuperação responde "o que há no catálogo". Ela não consegue responder "qual é o status do **meu**
pedido?": esse dado é ao vivo, privado e mora em outro serviço. A **chamada de ferramentas** (*tool
calling*) deixa o modelo pedir ao serviço que rode uma função — e o serviço decide o que a função pode
fazer. Este passo constrói um pequeno **registro de ferramentas** no formato do MCP (Model Context
Protocol) e o **loop do agente** que o executa, a partir da [aula de agentes](../../../classes/ai-systems/agents/index.md).

``` diagram-sim
sequenceDiagram
    participant F as fã
    participant A as assistant
    participant L as LLM
    participant T as ferramentas (catalog, order)
    F->>A: "qual é o status do meu pedido 5b0c...?"
    A->>A: recupera os top-k eventos (RAG)
    A->>L: system + contexto + pergunta + schemas das ferramentas
    L-->>A: tool_call get_order_status(order_id)
    A->>A: valida os argumentos (pydantic)
    A->>T: GET /orders/5b0c... (confere X-User-Email)
    T-->>A: {"status": "CONFIRMED", ...}
    A->>L: resultado da ferramenta (como dado)
    L-->>A: "Seu pedido está confirmado."
    A-->>F: resposta (em streaming)
```

## O registro { #the-registry }

``` python title="services/assistant/app/tools.py"
--8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/tools.py"
```

| Princípio | No código |
|---|---|
| **Schema por ferramenta** | os argumentos de cada ferramenta são um modelo pydantic; `model_json_schema()` é o schema que o modelo vê, e `model_validate` confere o que ele devolve |
| **Só leitura** | nenhuma ferramenta cria, altera ou cancela nada: um modelo confuso ou manipulado pode, no pior caso, ler |
| **Identidade vinda da plataforma, não do modelo** | `get_order_status` usa o header `X-User-Email` (definido pelo gateway do lab 4), nunca um e-mail que o modelo ou o usuário digitou |
| **A mesma resposta para "não é seu" e "não existe"** | uma mensagem diferente deixaria qualquer um sondar quais ids de pedido existem |
| **Erros são dados** | argumentos inválidos ou um serviço com falha viram um `error` em JSON que o modelo consegue ler e ao qual pode reagir; o loop nunca quebra |
| **Toda chamada medida** | `assistant_tool_calls_total{tool, outcome}` |

Um servidor MCP expõe exatamente isto — uma lista de ferramentas com nomes, descrições e JSON schemas, e
um jeito de chamá-las — por um protocolo padrão, para que qualquer cliente compatível com MCP possa
usá-las. Mover estas três ferramentas para um servidor MCP mudaria *onde* elas rodam, não o seu design.

## O loop do agente { #the-agent-loop }

``` python title="services/assistant/app/agent.py"
--8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/agent.py"
```

Leia o `run()` de cima para baixo:

1. **Recupere primeiro.** A pergunta é buscada antes de o modelo ser chamado, e os top-k eventos entram
   como uma segunda mensagem de sistema. Modelos locais pequenos chamam ferramentas de forma pouco
   confiável; com o contexto já no prompt, as perguntas comuns não precisam de nenhuma chamada de
   ferramenta. Ferramentas são para o que a recuperação não tem como saber (status de pedido ao vivo, os
   detalhes completos de um evento).
2. **Loop limitado.** No máximo `MAX_STEPS` (4) chamadas ao modelo; a última é feita **sem
   ferramentas**, então o modelo precisa responder. Um agente sem limite de passos é um incidente de
   custo e de latência esperando para acontecer.
3. **Faça streaming de todo passo.** Os deltas de texto vão para o cliente à medida que chegam
   (`yield "token", text`); o `stream_chunk_builder` reconstrói a mensagem completa para ver se o modelo
   pediu ferramentas.
4. **Os resultados das ferramentas voltam como mensagens `role: tool`** — dados, nunca instruções (o
   prompt de sistema diz isso, e os guardrails do passo 4 conferem a saída).
5. **Contabilize tudo**: tokens, custo, tempo até o primeiro token, duração — as entradas do passo 5.

## A API { #the-api }

``` python title="services/assistant/app/main.py"
--8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/main.py"
```

## Pergunte { #ask }

``` shell
curl -s -X POST localhost:8088/assistant/chat -H 'Content-Type: application/json' \
  -d '{"message":"Is there a festival at Stadium São Paulo? When, and how much are the tickets?"}' | jq
```

Uma execução de teste com `qwen2.5:1.5b` na CPU (o seu texto vai ser diferente — o modelo não é
determinístico):

``` json
{
  "answer": "Yes, there is a festival at Stadium São Paulo. The first festival of the month is on March 4th, 2027, with tickets priced at R$ 300.00.",
  "grounded": false,
  "citations": [],
  "retrieved": ["event:50", "event:150", "event:250", "event:122", "event:186"],
  "tools": [],
  "model": "qwen2.5:1.5b",
  "usage": {"prompt_tokens": 760, "completion_tokens": 45, "cost_usd": 0.0},
  "ttft_ms": 55735,
  "duration_ms": 116555
}
```

Os fatos estão certos (evento 50: 2027-03-04, R$ 300,00) e vieram do contexto recuperado — mas o modelo
de 1,5 bilhão de parâmetros ignorou a regra de citá-los, então o guarda de saída marca a resposta como
`grounded: false` (passo 4). Experimente `LOCAL_MODEL_TAG=qwen2.5:3b` (baixe-o antes) ou a rota do
Claude e compare. E repare no tempo: 56 s até o primeiro token numa CPU de notebook disputada — o passo
5 mede isso direito.

Agora o endpoint de streaming, que é o que uma interface de chat usa:

``` shell
curl -N -s -X POST localhost:8088/assistant/chat/stream -H 'Content-Type: application/json' \
  -d '{"message":"Which plays are there in Curitiba?"}'
```

Você deve ver linhas `event: token` chegando uma a uma (`data: {"text": "..."}`) e, no fim, um
`event: done` com o mesmo JSON de acima. Para exercitar o `get_order_status`, faça um pedido como no lab
7 e pergunte sobre ele com o header que o gateway definiria:

``` shell
curl -s -X POST localhost:8088/assistant/chat -H 'Content-Type: application/json' \
  -H 'X-User-Email: ana@example.com' \
  -d '{"message":"What is the status of my order <order id>?"}' | jq '.answer, .tools'
```

Com outro e-mail no header, a ferramenta responde `order not found`.

[Próximo: Guardrails](../guardrails/index.md){ .md-button .md-button--primary }
