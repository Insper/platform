Dois engenheiros recebem a tarefa de implementar *"encontre dois assentos abaixo de R$ 300 para sábado e reserve-os"*.

O primeiro escreve um **workflow**: extrai `date`, `quantity` e `max_price` da mensagem com uma chamada ao modelo que devolve JSON; chama `search_events` e `search_seats` no código; escolhe o par de assentos vizinhos mais barato; chama `hold_seats`; pede ao modelo que redija a resposta. Duas chamadas ao modelo, cada passo testável, latência previsível.

O segundo escreve um **agente**: entrega ao modelo as ferramentas e o objetivo, e deixa que ele decida o que chamar, em que ordem e quando parar. Ele atende pedidos que o primeiro projeto nunca previu (*"…e, se não houver nada no sábado, tente domingo, mas não no anel superior"*), e falha de maneiras que o primeiro projeto jamais falharia (reserva o evento errado, ou fica comparando assentos para sempre).

Os dois projetos estão corretos — para pedidos diferentes. Esta página trata da maquinaria do segundo e de como saber quando escolher o primeiro.

## Workflows e agentes

A diferença está em **quem decide o próximo passo**: o seu código ou o modelo[^1].

| Nível | Quem decide o próximo passo | Exemplo no BoxOffice | Chamadas ao modelo | Previsibilidade |
|---|---|---|---|---|
| Chamada única | ninguém — um único passo | resumir as avaliações de um evento | 1 | alta |
| **Workflow: cadeia** | o código, em sequência fixa | extrair → buscar → reservar → redigir a resposta | fixo (2–4) | alta |
| **Workflow: roteamento** | o código, depois de um classificador | FAQ → modelo pequeno; compra → workflow de compra; reclamação → humano | 1 + ramo | alta |
| **Workflow: paralelo** | o código, fan-out e depois junção | consultar 3 locais de uma vez; votação de 3 modelos sobre um sinal de fraude | N em paralelo | alta |
| **Orquestrador-trabalhadores** | um modelo divide a tarefa; o código executa os trabalhadores | "planeje meu fim de semana de festival" → ingressos + hospedagem + transporte | variável | média |
| **Agente** | o modelo, a cada passo, em loop | conversa de atendimento aberta, com ferramentas | variável, ilimitado sem limites | baixa |

Comece pelo topo da tabela e desça **apenas quando o nível mais simples falhar de forma mensurável** no seu conjunto de avaliação. A maioria dos "agentes" em produção em 2026 são workflows com um ou dois passos agênticos.

---

## O loop do agente { #loop }

Um agente é um loop em torno de uma chamada ao modelo. Na formulação **ReAct**[^2], o modelo alterna entre *raciocinar* (o que eu sei, do que eu preciso), *agir* (pedir uma chamada de ferramenta) e *observar* (ler o resultado da ferramenta), até conseguir responder.

``` mermaid-sim
flowchart TD
    start(["mensagem do usuário"]) --> ctx["montar o contexto:<br/>system prompt + ferramentas + memória + histórico"]
    ctx --> call["chamar o modelo (via gateway de LLM)"]
    call --> decide{"chamadas de ferramenta<br/>na resposta?"}
    decide -- não --> answer(["resposta final ao usuário"])
    decide -- sim --> guard["Safety Mesh:<br/>validar + autorizar cada chamada"]
    guard --> run["executar as ferramentas (em paralelo se independentes)"]
    run --> append["anexar chamadas + resultados ao histórico"]
    append --> budget{"passos, tokens, tempo<br/>dentro do orçamento?"}
    budget -- sim --> call
    budget -- não --> stop(["parar: resposta parcial ou passar para um humano"])
```

O loop em si é código comum. Eis uma versão mínima, independente de provedor — os três colaboradores são os outros componentes da paleta:

``` python title="agent_loop.py"
import json

MAX_STEPS, MAX_TOKENS = 8, 40_000


def run_agent(llm, registry, guard, user, question, history):
    """llm: LLM-gateway client; registry: Tool Registry; guard: Safety Mesh.
    All three are this sketch's own interfaces, not a specific SDK."""
    messages = [*history, {"role": "user", "content": question}]
    used = 0
    for step in range(MAX_STEPS):
        reply = llm.chat(alias="assistant-default", system=SYSTEM_PROMPT,
                         messages=messages, tools=registry.schemas_for(user))
        used += reply.input_tokens + reply.output_tokens
        messages.append(reply.message)          # the assistant turn, with its tool calls
        if not reply.tool_calls:                # no action requested: this is the answer
            return reply.text
        for call in reply.tool_calls:           # the model may request several at once
            verdict = guard.check_tool_call(call.name, call.arguments, user)
            if verdict == "allow":
                result = registry.call(call.name, call.arguments, as_user=user)
            else:                               # denied, or needs the user's confirmation
                result = {"error": verdict}
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": json.dumps(result)})
        if used > MAX_TOKENS:
            break
    return "I could not finish this request. A human agent will contact you."
```

Cinco detalhes nessas 25 linhas concentram a maior parte da engenharia:

1. **O modelo nunca executa nada.** Ele devolve um *pedido* (`tool_calls`); o orquestrador valida, autoriza **como o usuário** (`as_user=user`) e executa.
2. **Erros voltam ao modelo como dados.** Uma chamada negada ou que falhou vira um resultado de ferramenta (`{"error": ...}`), para que o modelo possa se recuperar — perguntar ao fã, escolher outro assento — em vez de derrubar o loop.
3. **Todo loop tem orçamentos**: passos, tokens e (em produção) tempo de relógio. Sem eles, um modelo confuso fica em loop até que a cota ou a fatura o interrompa.
4. **As ferramentas oferecidas dependem do usuário** (`schemas_for(user)`): um visitante anônimo nem sequer vê `hold_seats`. Uma ferramenta que o modelo não enxerga é uma ferramenta que ele não pode usar indevidamente.
5. **O histórico cresce a cada passo** — o crescimento quadrático de tokens calculado na [visão geral](../index.md#numbers).

### Parada e gerenciamento de contexto

| Condição de parada | Por quê |
|---|---|
| Uma resposta sem chamadas de ferramenta | fim normal: o modelo tem uma resposta |
| Limite de passos (ex.: 8) | limita custo e latência; uma tarefa que precisa de 30 passos é um workflow disfarçado |
| Orçamento de tokens ou de custo | protege a cota — veja [LLM Gateway](../llm-gateway/index.md) |
| Prazo de tempo de relógio | o usuário está esperando; devolva o que você tem |
| Mesma ferramenta + mesmos argumentos duas vezes | **detecção de loop**: o modelo está travado |
| Ação arriscada pendente | pausar e perguntar ao humano (human-in-the-loop, humano no circuito) |

À medida que o histórico cresce, a **engenharia de contexto** o mantém útil: as ferramentas devolvem resultados compactos (5 opções de assento, não 5.000 assentos); turnos antigos são **compactados** em um resumo; documentos grandes são referenciados por ID e buscados só quando necessário. Um contexto focado é mais barato, mais rápido e mais preciso do que um longo[^3].

---

## Chamada de ferramentas

A chamada de ferramentas (tool calling, também conhecida como *function calling*) é o contrato entre o modelo e o seu código:

1. A requisição declara as ferramentas: **nome**, **descrição** e um **JSON Schema** dos argumentos.
2. O modelo responde com texto ou com uma ou mais **chamadas de ferramenta**: `{id, name, arguments}`, em que `arguments` deve seguir o schema. Muitas APIs conseguem impor o schema com **decodificação restrita** (saídas estruturadas), de modo que o JSON sempre sai bem formado.
3. O orquestrador executa a chamada e envia o resultado de volta em uma mensagem vinculada ao `id` da chamada.
4. O modelo continua com o resultado em seu contexto.

O modelo escolhe as ferramentas **lendo seus nomes e descrições**, então a interface da ferramenta é, ao mesmo tempo, um prompt e uma API. Boas ferramentas são projetadas para o modelo, não copiadas da API interna:

| Princípio | Ruim | Bom |
|---|---|---|
| No nível da tarefa, não da tabela | `run_sql(query)`, `get_all_seats(event_id)` | `search_seats(event_id, quantity, max_price_brl)` |
| Poucas e distintas | 40 ferramentas com nomes que se sobrepõem | ~5–15 ferramentas por agente, bem separadas |
| Argumentos tipados | `date: string` ("next Sat"?) | `date: string, format: date` mais um `enum` sempre que possível |
| Resultados compactos | o JSON completo de todos os assentos | as 5 melhores opções, só com os campos necessários para decidir |
| Erros acionáveis | `500 Internal Server Error` | `"event evt_123 is sold out; 2 similar events on Sunday: ..."` |
| Descrições com intenção | "hold seats" | "Hold seats for 10 minutes so the fan can pay. Reversible: an unpaid hold expires." |
| Menor privilégio | uma ferramenta que lê e escreve tudo | ferramentas de leitura e de escrita separadas, cada uma com sua própria permissão |

---

## Ferramentas são efeitos colaterais { #side-effects }

Uma chamada ao modelo pode ser repetida à vontade. Uma chamada de ferramenta **muda o mundo**. Se `hold_seats` estoura o tempo e o loop tenta de novo, a primeira reserva aconteceu ou não? Esse é o problema de integração de [Computação e serviços](../../compute/integrations/index.md), e as respostas são as mesmas:

- **Chaves de idempotência.** O orquestrador deriva uma chave de `(conversation, step, call)` e a passa para toda ferramenta de escrita; o serviço devolve o mesmo resultado para a mesma chave.
- **Reversível primeiro.** Prefira ações que tenham um "desfazer" natural — uma **reserva temporária (hold)** expira em 10 minutos; um **pedido** com pagamento, não.
- **Compensação.** Se um passo posterior falhar, execute a ação inversa (`release_hold`), exatamente como em uma [saga](../../messaging/patterns/index.md).
- **Níveis de risco** decidem o que pode rodar sem um humano:

| Nível | Exemplos | Política |
|---|---|---|
| Leitura | `search_events`, `search_seats`, `get_order` | automática |
| Escrita reversível | `hold_seats`, `add_to_wishlist` | automática dentro de limites (≤ 6 assentos, ≤ 1 reserva ativa) |
| Irreversível / financeira | `create_order`, `refund_order`, `charge` | **confirmação explícita do usuário** na interface, nunca apenas por texto |
| Comunicação externa | `send_email`, `post_review` | confirmação, ou nem é oferecida |

### Execução durável

Uma conversa que aguarda a confirmação do fã, ou uma tarefa que roda por minutos, não pode viver só na memória de um processo: pods reiniciam. Persista o estado do agente depois de **cada passo** — mensagens, chamadas de ferramenta pendentes, chaves de idempotência — em um banco de dados, e retome a partir do último checkpoint. Para tarefas longas de vários passos, um **motor de workflow durável** (no estilo do Temporal: cada passo registrado, repetido e retomável) entrega isso de graça; para chats curtos, uma linha `conversation_state` mais o cache de sessão do [Memory Fabric](../rag-memory/index.md) bastam.

---

## Planejamento

O loop do agente planeja **um passo de cada vez**. Para tarefas mais longas, o planejamento explícito ajuda:

| Padrão | Como funciona | Chamadas ao modelo | Pontos fortes | Pontos fracos |
|---|---|---|---|---|
| **ReAct** (plano implícito) | decide a próxima ação depois de cada observação | 1 por passo | adapta-se a surpresas | pode se perder; guloso |
| **Plan-and-execute** | um planejador escreve o plano completo; um executor roda os passos; replaneja em caso de falha | 1 plano + passos (+ replanejamentos) | menos chamadas ao modelo grande (o executor pode ser pequeno); o plano pode ser inspecionado e aprovado | rígido quando o mundo muda no meio do plano |
| **Reflexão / avaliador-otimizador**[^4] | um crítico (outro prompt ou modelo) revisa o resultado; o gerador tenta de novo com o feedback | ×2 ou mais | pega erros antes que o usuário os veja | dobra custo e latência |
| **Passos paralelos** | ações independentes emitidas juntas em um único passo | menos rodadas | menor latência | só para ações independentes |

!!! example "BoxOffice: um plano que o fã consegue ver"

    Para *"dois assentos abaixo de R$ 300 para sábado, fora do anel superior, reserve-os"*, um assistente plan-and-execute primeiro mostra:

    1. Encontrar eventos no sábado em São Paulo.
    2. Para cada evento, buscar pares de assentos vizinhos ≤ R$ 300, excluindo o anel superior. *(em paralelo)*
    3. Escolher o par mais barato; se não houver, verificar o domingo.
    4. Reservar o par (reversível, 10 min) e devolver o link de pagamento.

    Mostrar o plano custa uma chamada, mas permite que o fã corrija um mal-entendido *antes* de qualquer ação, e dá ao time de avaliação uma trajetória para comparar com a esperada.

### Por que cada passo precisa ser verificado

Se cada passo está certo com probabilidade $p$, de forma independente, uma tarefa de $n$ passos tem sucesso com probabilidade $p^n$:

```python exec="true" html="1" source="tabbed-right"
# Probability that an n-step task succeeds when each step succeeds with
# probability p, independently: P(task) = p ** n
steps = [1, 3, 5, 10, 20]
head = ["Per-step success"] + [f"{n} step{'s' if n > 1 else ''}" for n in steps]
print("<table><thead><tr>" + "".join(f"<th>{h}</th>" for h in head) + "</tr></thead><tbody>")
for p in (0.99, 0.97, 0.95, 0.90):
    cells = [f"{p:.0%}"] + [f"{p ** n:.0%}" for n in steps]
    print("<tr>" + "".join(f'<td style="text-align:right">{c}</td>' for c in cells) + "</tr>")
print("</tbody></table>")
```

Um passo que acerta 95% das vezes parece bom; uma tarefa de 10 passos construída com ele só tem sucesso em 60% das vezes. As alavancas são as mesmas da disponibilidade em série ([Estimativas](../../estimation/availability-math/index.md)): **menos passos** (ferramentas melhores, workflows para as partes conhecidas), **validação depois de cada passo** (schemas, regras de negócio no código) e **recuperação** (erros devolvidos ao modelo, replanejamento) — o equivalente, no agente, a retries e redundância.

---

## Registro de ferramentas e MCP { #mcp }

Sem um padrão, cada agente precisa de uma integração sob medida com cada ferramenta: N agentes × M ferramentas. O **Model Context Protocol (MCP)**[^5] faz pelos agentes o que o Language Server Protocol fez pelos editores de código: cada provedor de ferramentas escreve **um servidor MCP**, cada host de agente embute **clientes MCP**, e qualquer cliente pode usar qualquer servidor — N + M integrações.

``` mermaid
flowchart LR
    subgraph Host["Host: serviço do assistente (orquestrador)"]
        c1["cliente MCP"]
        c2["cliente MCP"]
        c3["cliente MCP"]
    end
    c1 -- "Streamable HTTP + OAuth" --> s1["servidor MCP<br/>time do catalog"]
    c2 -- "Streamable HTTP + OAuth" --> s2["servidor MCP<br/>time do inventory"]
    c3 -- "stdio (processo local)" --> s3["servidor MCP<br/>arquivos locais / ferramentas de dev"]
    s1 --> catalog["serviço catalog"]
    s2 --> inventory["serviço inventory"]
```

O essencial do protocolo:

- **Papéis.** O *host* é a aplicação (o assistente do BoxOffice); ele roda um *cliente* por conexão; cada *servidor* expõe capacidades.
- **Primitivas do servidor.** **Tools** (ações que o modelo pode chamar), **resources** (dados que a aplicação pode ler para o contexto, identificados por URIs) e **prompts** (templates reutilizáveis oferecidos ao usuário). Os clientes, por sua vez, podem oferecer aos servidores capacidades como *sampling* (o servidor pede ao modelo do host uma completion) e *elicitation* (o servidor pede uma entrada ao usuário).
- **Mensagens.** JSON-RPC 2.0. Uma sessão começa com `initialize` (negociação de versão e de capacidades); depois `tools/list` descobre as ferramentas e `tools/call` as invoca; os servidores podem notificar `tools/list_changed`.
- **Transportes.** **stdio** para um servidor que roda como subprocesso local; **Streamable HTTP** para servidores remotos, com autorização baseada em OAuth 2.1.

O time do `inventory` publica suas capacidades como um servidor MCP. Com o SDK oficial em Python, uma ferramenta é uma função tipada e documentada — o SDK deriva o JSON Schema das anotações de tipo e a descrição da docstring:

``` python title="inventory_mcp.py"
# Official MCP Python SDK (package "mcp"); check its docs for the current API.
from mcp.server.fastmcp import FastMCP

from inventory_client import InventoryClient  # the team's existing HTTP client

mcp = FastMCP("boxoffice-inventory")
inventory = InventoryClient("http://inventory:8080")


@mcp.tool()
def search_seats(event_id: str, quantity: int, max_price_brl: float) -> list[dict]:
    """Find available seats for an event, adjacent when possible, priced at or
    below max_price_brl each. Returns at most 5 options, cheapest first."""
    return inventory.search(event_id, quantity, max_price_brl, limit=5)


@mcp.tool()
def hold_seats(event_id: str, seat_ids: list[str], idempotency_key: str) -> dict:
    """Hold seats for 10 minutes so the fan can pay. Reversible: an unpaid hold
    expires. Calling again with the same idempotency_key returns the same hold."""
    return inventory.hold(event_id, seat_ids, ttl_seconds=600, key=idempotency_key)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
```

Na rede, é isto que o cliente do orquestrador vê quando descobre a ferramenta (resultado de `tools/list`, resumido) e depois a chama:

``` json title="tools/list (result, abridged)"
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "hold_seats",
        "description": "Hold seats for 10 minutes so the fan can pay. Reversible: an unpaid hold expires. Calling again with the same idempotency_key returns the same hold.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "event_id": {"type": "string"},
            "seat_ids": {"type": "array", "items": {"type": "string"}},
            "idempotency_key": {"type": "string"}
          },
          "required": ["event_id", "seat_ids", "idempotency_key"]
        },
        "annotations": {"readOnlyHint": false, "destructiveHint": false, "idempotentHint": true}
      }
    ]
  }
}
```

``` json title="tools/call (request, then result)"
{"jsonrpc": "2.0", "id": 7, "method": "tools/call",
 "params": {"name": "hold_seats",
            "arguments": {"event_id": "evt_8812", "seat_ids": ["C12", "C13"],
                          "idempotency_key": "conv_51f3:step3:call1"}}}

{"jsonrpc": "2.0", "id": 7,
 "result": {"content": [{"type": "text",
                         "text": "{\"hold_id\": \"h_77a\", \"expires_at\": \"2027-03-13T10:12:00Z\", \"total_brl\": 560.00}"}],
            "isError": false}}
```

Repare no que **não** é argumento: a identidade do fã. O servidor MCP obtém o usuário da **sessão autenticada** (o access token OAuth que o host obteve em nome do fã, como em [Identidade](../../network-security/identity/index.md)) — nunca de um campo preenchido pelo modelo, ou uma injeção de prompt poderia reservar assentos para outra pessoa.

### O registro em torno do MCP

O MCP padroniza o *protocolo de rede*; o componente **Tool Registry** é a governança em torno dele:

| Preocupação do registro | O que ele registra / impõe |
|---|---|
| Catálogo | quais servidores MCP existem, time responsável, versão, endpoint, SLO |
| Exposição | quais ferramentas cada agente (e cada papel de usuário) pode ver |
| Nível de risco | leitura / reversível / irreversível / externa — alimenta o [Safety Mesh](../safety-evals/index.md) |
| Autenticação | escopos OAuth por ferramenta; tokens por usuário, não um super-token compartilhado |
| Limites e auditoria | rate limits por ferramenta; um log de auditoria de cada chamada, com usuário, argumentos e resultado |
| Cadeia de suprimentos | versões fixadas; descrições revisadas; allowlist de servidores de terceiros |

!!! warning "Anotações são dicas, não segurança"

    `readOnlyHint` e `destructiveHint` vêm do servidor. Um servidor de terceiros malicioso ou com bugs pode mentir, e as **descrições** das suas ferramentas são texto que o modelo lê — um lugar para instruções injetadas (*tool poisoning*), que podem até mudar depois que você aprovou o servidor. Trate servidores MCP de terceiros como código de terceiros: revise, fixe a versão, isole em sandbox e imponha as permissões no seu próprio registro e nos seus serviços.

Para a comunicação **entre agentes** de times ou empresas diferentes, estão surgindo protocolos próprios (por exemplo, o *Agent2Agent*, A2A). A distinção a guardar: o MCP conecta um agente a **ferramentas e dados**; os protocolos agente-a-agente conectam um agente a **outro agente**.

---

## Orquestração multiagente

Quando um agente tem ferramentas demais, um prompt longo demais ou tarefas que podem rodar em paralelo, o trabalho é dividido entre vários agentes.

| Padrão | Forma | Exemplo no BoxOffice | Por que usar |
|---|---|---|---|
| **Supervisor / orquestrador-trabalhadores** | um agente decompõe e delega; os trabalhadores devolvem resultados | "planeje meu fim de semana de festival": agente de ingressos, agente de viagem, agente de hospedagem | separação de ferramentas e prompts; paralelismo |
| **Roteador / handoff** | um agente de triagem transfere a conversa para um especialista | triagem → agente de compras, agente de reembolsos, agente de acessibilidade | cada especialista tem um prompt curto e poucas ferramentas |
| **Fan-out paralelo + agregação** | a mesma entrada para vários agentes; juntar ou votar | três revisores verificam uma decisão de reembolso | robustez pela diversidade |
| **Avaliador-otimizador** | um gerador e um crítico iteram | um rascunho de resposta a um fã irritado, verificado contra a política | qualidade em saídas difíceis |
| **Hierárquico** | supervisores de supervisores | grande automação de back-office | tarefas muito grandes — raramente necessário |

``` mermaid-sim
sequenceDiagram
    actor F as Fã
    participant S as Agente supervisor
    participant T as Agente de ingressos
    participant L as Agente de hospedagem
    F->>S: "fim de semana de festival no Rio, orçamento R$ 2.000"
    par em paralelo
        S->>T: encontrar 2 passaportes ≤ R$ 900
        S->>L: encontrar hospedagem perto do local ≤ R$ 1.100
    end
    T-->>S: 2 opções (reserva ainda não feita)
    L-->>S: 3 opções
    S-->>F: proposta combinada: confirmar?
```

Sistemas multiagente trocam dinheiro e latência por modularidade. Cada agente tem seu próprio contexto (mais tokens no total), cada handoff perde informação a menos que o estado seja passado explicitamente, e as falhas ficam mais difíceis de rastrear. Passe **artefatos explícitos e estruturados** entre os agentes (uma lista de assentos candidatos com IDs), não transcrições inteiras, e rastreie a árvore completa de chamadas ([Observabilidade](../safety-evals/index.md#observability)).

---

## Quando NÃO usar agentes

| Se… | …então prefira | BoxOffice |
|---|---|---|
| os passos são conhecidos de antemão | um **workflow** (o código orquestra, o modelo preenche lacunas) | o fluxo de reserva de assentos |
| a decisão precisa estar exatamente certa todas as vezes | **código determinístico** | cálculo de preço, alocação de assentos, regras de reembolso |
| o orçamento de latência é menor que ~1–2 s | uma única chamada a um modelo pequeno, ou nenhum modelo | autocompletar na busca |
| a ação é irreversível | código + **confirmação humana explícita** | pagamento, reembolso |
| o volume é enorme e a tarefa é estreita | um classificador, um modelo pequeno com fine-tuning, ou regras | sinais de fraude em todo checkout |
| você não consegue avaliar o resultado | **não automatize ainda** | — |
| um agente com boas ferramentas funciona | **não adicione agentes** | a maioria das conversas de atendimento |

!!! tip "Experimente"

    Rode o cenário do assistente de IA com o perfil **stress**. Cada requisição que entra no Orchestrator vira várias chamadas ao LLM Gateway e ao Tool Registry: compare a taxa de requisições no orquestrador com a taxa no gateway. Essa razão é o número de passos do agente, e é o multiplicador da sua capacidade e do seu custo de modelo.

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520" data-profile="stress"></div>

---

## BoxOffice: o rastro de uma tarefa

| Passo | Saída do modelo | Ação do orquestrador | Contexto depois do passo |
|---|---|---|---|
| 1 | `search_events(city="São Paulo", date="2027-03-13")` | ferramenta de leitura → 3 eventos | ~3.900 tokens |
| 2 | `search_seats(evt_8812, 2, 300)` e `search_seats(evt_8820, 2, 300)` (em paralelo) | 2 ferramentas de leitura → 4 pares | ~5.000 tokens |
| 3 | `hold_seats(evt_8812, ["C12","C13"], key)` | Safety Mesh: reversível, 2 assentos → permitir; reserva h_77a | ~5.300 tokens |
| 4 | texto: "Reservei C12–C13 por R$ 280 cada até 10:12. Pague aqui: …" | stream para o fã; salvar o turno | — |

As chamadas de ferramenta em paralelo economizaram uma rodada inteira (≈ 2 s). Se o modelo tivesse pedido uma reserva de 40 assentos, o passo 3 teria devolvido `{"error": "deny: invalid arguments: List should have at most 6 items after validation, not 40"}` (a [verificação do guardrail](../safety-evals/index.md#guardrail-code)) e o modelo teria explicado o limite ao fã.

!!! tip "Na entrevista"

    Diga **"workflow primeiro, agente onde for preciso"** e justifique com a matemática da composição ($0.95^{10} \approx 60\%$). Desenhe o loop com seus **orçamentos** (passos, tokens, tempo) e mostre onde as ferramentas são **autorizadas como o usuário** e **tornadas idempotentes**. Cite o MCP como a forma de os times exporem ferramentas, e acrescente um registro para permissões, níveis de risco e auditoria. Se o assunto multiagente aparecer, dê um motivo concreto (separação de ferramentas ou paralelismo) e o seu custo (tokens, latência, dificuldade de depuração).

!!! warning "Armadilhas comuns"

    - **Agentes para fluxos determinísticos** — mais lentos, mais caros e menos confiáveis do que dez linhas de código.
    - **Sem orçamentos** — um modelo preso em um loop é um custo sem limite.
    - **Ferramentas com cara de banco de dados** (`run_sql`, `get_everything`) — resultados enormes, risco de injeção, e o modelo faz o trabalho que o seu serviço deveria fazer.
    - **Repetir ferramentas de escrita sem chaves de idempotência** — reservas em dobro, pedidos em dobro.
    - **Uma super-credencial do próprio agente** em vez do token do usuário — o problema do "confused deputy" (delegado confuso).
    - **Confiar cegamente em servidores MCP de terceiros** — suas descrições são prompts e suas anotações são alegações.
    - **Multiagente por padrão** — mais tokens e mais pontos de falha, sem ganho medido.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    WF{"steps known<br/>in advance?"} -->|"yes"| FLOW["workflow<br/>(code decides)"]
    WF -->|"no"| LOOP["agent loop<br/>(model decides)"]
    LOOP --> BUD["budgets: steps,<br/>tokens, time"]
    LOOP --> DUR["durable execution:<br/>state after every step"]
    LOOP --> MATH["0.95^10 ≈ 60 %<br/>→ Estimation availability math"]
    LOOP --> TOOLS["tool calls via MCP<br/>→ tool registry"]
    TOOLS --> AUTH["authorized as the user<br/>→ Network & Security identity"]
    TOOLS --> IDEM["idempotency keys, compensation<br/>→ Messaging sagas"]
    LOOP --> CTX["context<br/>→ RAG & Memory"]
    TOOLS --> HITL["confirmation for risky actions<br/>→ Safety mesh"]
```

**Componentes da paleta:** [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (executa o loop e controla os orçamentos) · [`toolreg`](../../../reference/components/ai/index.md#toolreg) (servidores MCP, permissões, níveis de risco) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) (toda chamada ao modelo) · [`safety`](../../../reference/components/ai/index.md#safety) (aprovação de ações arriscadas) · [`auth`](../../../reference/components/compute/index.md#auth) (a identidade do usuário em cada chamada de ferramenta) · [`app`](../../../reference/components/compute/index.md#app) (os mesmos serviços `catalog` e `inventory` que o front end web chama). **Cenários:** `ai-assistant`. **Continua em:** [Mensageria — padrões](../../messaging/patterns/index.md) (sagas e compensação), [Rede e Segurança — identidade](../../network-security/identity/index.md), [Estimativas — matemática da disponibilidade](../../estimation/availability-math/index.md), [Compute — integrações](../../compute/integrations/index.md) (chaves de idempotência), [RAG e memória](../rag-memory/index.md), [Segurança, avaliações e observabilidade](../safety-evals/index.md).

---

[^1]: ANTHROPIC. [Building effective agents](https://www.anthropic.com/research/building-effective-agents){target="_blank"}. 2024.
[^2]: YAO, S. et al. [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629){target="_blank"}. ICLR, 2023.
[^3]: HUYEN, C. *AI Engineering: Building Applications with Foundation Models*. O'Reilly, 2025.
[^4]: SHINN, N. et al. [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366){target="_blank"}. NeurIPS, 2023.
[^5]: Model Context Protocol. [Especificação](https://modelcontextprotocol.io/specification){target="_blank"} e [Python SDK](https://github.com/modelcontextprotocol/python-sdk){target="_blank"}.
