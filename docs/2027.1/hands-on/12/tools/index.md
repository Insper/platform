# 3. Tools and the Agent Loop

Retrieval answers "what is in the catalog". It cannot answer "what is the status of **my** order?":
that data is live, private, and lives in another service. **Tool calling** lets the model ask the
service to run a function — and the service decides what the function may do. This step builds a small
**tool registry** in the shape of MCP (Model Context Protocol) and the **agent loop** that runs it,
from the [agents class](../../../classes/ai-systems/agents/index.md).

``` mermaid-sim
sequenceDiagram
    participant F as fan
    participant A as assistant
    participant L as LLM
    participant T as tools (catalog, order)
    F->>A: "what is the status of my order 5b0c...?"
    A->>A: retrieve top-k events (RAG)
    A->>L: system + context + question + tool schemas
    L-->>A: tool_call get_order_status(order_id)
    A->>A: validate the arguments (pydantic)
    A->>T: GET /orders/5b0c... (checks X-User-Email)
    T-->>A: {"status": "CONFIRMED", ...}
    A->>L: tool result (as data)
    L-->>A: "Your order is confirmed."
    A-->>F: answer (streamed)
```

## The registry

``` python title="services/assistant/app/tools.py"
--8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/tools.py"
```

| Principle | In the code |
|---|---|
| **Schema per tool** | each tool's arguments are a pydantic model; `model_json_schema()` is the schema the model sees, and `model_validate` checks what it sends back |
| **Read-only** | no tool creates, changes or cancels anything: a confused or manipulated model can, at worst, read |
| **Identity from the platform, not from the model** | `get_order_status` uses the `X-User-Email` header (set by the gateway of lab 4), never an e-mail the model or the user typed |
| **Same answer for "not yours" and "does not exist"** | a different message would let anyone probe which order ids exist |
| **Errors are data** | invalid arguments or a failing service become a JSON `error` the model can read and react to; the loop never crashes |
| **Every call measured** | `assistant_tool_calls_total{tool, outcome}` |

An MCP server exposes exactly this — a list of tools with names, descriptions and JSON schemas, and a
way to call them — over a standard protocol, so any MCP-capable client can use them. Moving these
three tools into an MCP server would change *where* they run, not their design.

## The agent loop

``` python title="services/assistant/app/agent.py"
--8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/agent.py"
```

Read `run()` top to bottom:

1. **Retrieve first.** The question is searched before the model is called, and the top-k events go in
   as a second system message. Small local models call tools unreliably; with the context already in
   the prompt, the common questions need no tool call at all. Tools are for what retrieval cannot
   know (live order status, one event's full details).
2. **Bounded loop.** At most `MAX_STEPS` (4) model calls; the last one is made **without tools**, so
   the model must answer. An agent without a step limit is a cost and latency incident waiting to
   happen.
3. **Stream every step.** Text deltas go to the client as they arrive (`yield "token", text`);
   `stream_chunk_builder` rebuilds the full message to see whether the model asked for tools.
4. **Tool results go back as `role: tool` messages** — data, never instructions (the system prompt
   says so, and the guardrails of step 4 check the output).
5. **Account for everything**: tokens, cost, time to first token, duration — the inputs of step 5.

## The API

``` python title="services/assistant/app/main.py"
--8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/main.py"
```

## Ask

``` shell
curl -s -X POST localhost:8088/assistant/chat -H 'Content-Type: application/json' \
  -d '{"message":"Is there a festival at Stadium São Paulo? When, and how much are the tickets?"}' | jq
```

A test run with `qwen2.5:1.5b` on the CPU (your text will differ — the model is not deterministic):

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

The facts are right (event 50: 2027-03-04, R$ 300.00) and came from the retrieved context — but the
1.5-billion-parameter model ignored the rule to cite them, so the output guard marks the answer
`grounded: false` (step 4). Try `LOCAL_MODEL_TAG=qwen2.5:3b` (pull it first) or the Claude route and
compare. And note the time: 56 s to the first token on a contended laptop CPU — step 5 measures it
properly.

Now the streaming endpoint, which is what a chat UI uses:

``` shell
curl -N -s -X POST localhost:8088/assistant/chat/stream -H 'Content-Type: application/json' \
  -d '{"message":"Which plays are there in Curitiba?"}'
```

You should see `event: token` lines arrive one by one (`data: {"text": "..."}`) and, at the end, one
`event: done` with the same JSON as above. To exercise `get_order_status`, place an order as in lab 7
and ask about it with the header the gateway would set:

``` shell
curl -s -X POST localhost:8088/assistant/chat -H 'Content-Type: application/json' \
  -H 'X-User-Email: ana@example.com' \
  -d '{"message":"What is the status of my order <order id>?"}' | jq '.answer, .tools'
```

With another e-mail in the header, the tool answers `order not found`.

[Next: Guardrails](../guardrails/index.md){ .md-button .md-button--primary }
