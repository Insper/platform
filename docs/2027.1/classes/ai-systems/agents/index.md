Two engineers are asked to implement *"find me two seats under R$300 for Saturday and hold them"*.

The first writes a **workflow**: extract `date`, `quantity` and `max_price` from the message with one model call that returns JSON; call `search_events` and `search_seats` in code; pick the cheapest adjacent pair; call `hold_seats`; ask the model to phrase the answer. Two model calls, every step testable, latency predictable.

The second writes an **agent**: give the model the tools and the goal, and let it decide what to call, in which order, and when to stop. It handles requests the first design never anticipated (*"…and if there is nothing on Saturday, try Sunday, but not in the upper ring"*), and it fails in ways the first design never could (it holds the wrong event, or loops forever comparing seats).

Both are correct designs — for different requests. This page is about the machinery of the second one, and about knowing when to choose the first.

## Workflows and agents

The difference is **who decides the next step**: your code, or the model[^1].

| Level | Who decides the next step | Example in BoxOffice | Model calls | Predictability |
|---|---|---|---|---|
| Single call | nobody — one step | summarize the reviews of an event | 1 | high |
| **Workflow: chain** | code, fixed sequence | extract → search → hold → phrase answer | fixed (2–4) | high |
| **Workflow: routing** | code, after a classifier | FAQ → small model; booking → booking workflow; complaint → human | 1 + branch | high |
| **Workflow: parallel** | code, fan-out then merge | check 3 venues at once; vote of 3 models on a fraud signal | N in parallel | high |
| **Orchestrator-workers** | a model splits the task; code runs the workers | "plan my festival weekend" → tickets + lodging + transport | variable | medium |
| **Agent** | the model, at every step, in a loop | open-ended support conversation with tools | variable, unbounded without limits | low |

Start at the top of the table and move down **only when the simpler level measurably fails** on your evaluation set. Most production "agents" in 2026 are workflows with one or two agentic steps.

---

## The agent loop { #loop }

An agent is a loop around a model call. In the **ReAct** formulation[^2] the model alternates *reasoning* (what do I know, what do I need), *acting* (requesting a tool call) and *observing* (reading the tool result), until it can answer.

``` diagram-sim
flowchart TD
    start(["user message"]) --> ctx["build context:<br/>system prompt + tools + memory + history"]
    ctx --> call["call the model (via LLM gateway)"]
    call --> decide{"tool calls<br/>in the reply?"}
    decide -- no --> answer(["final answer to the user"])
    decide -- yes --> guard["Safety Mesh:<br/>validate + authorize each call"]
    guard --> run["execute tools (in parallel if independent)"]
    run --> append["append calls + results to history"]
    append --> budget{"steps, tokens, time<br/>within budget?"}
    budget -- yes --> call
    budget -- no --> stop(["stop: partial answer or hand off to a human"])
```

The loop itself is ordinary code. Here is a minimal, provider-agnostic version — the three collaborators are the other palette components:

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

Five details in those 25 lines carry most of the engineering:

1. **The model never executes anything.** It returns a *request* (`tool_calls`); the orchestrator validates, authorizes **as the user** (`as_user=user`) and executes.
2. **Errors go back to the model as data.** A denied or failed call becomes a tool result (`{"error": ...}`), so the model can recover — ask the fan, choose another seat — instead of crashing the loop.
3. **Every loop has budgets**: steps, tokens and (in production) wall-clock time. Without them, a confused model loops until the quota or the invoice stops it.
4. **The tools offered depend on the user** (`schemas_for(user)`): an anonymous visitor does not even see `hold_seats`. A tool the model cannot see is a tool it cannot misuse.
5. **History grows at every step** — the quadratic token growth computed in the [overview](../index.md#numbers).

!!! example "In the BoxOffice code: the bounded loop of the assistant (lab 12)"

    [Hands-on 12 — Tools and the agent loop](../../../hands-on/12/tools/index.md) writes this loop with two decisions the sketch above leaves open. It **retrieves first**: the top-5 catalog events go into the prompt before the first model call, because small local models call tools unreliably and, with the context already there, the common questions need no tool at all. And the **last of the `MAX_STEPS` = 4 calls is made without tools**, so the model must answer: the step budget cannot end in silence. Every step is streamed to the fan, and tool results go back as `role: tool` messages — data, never instructions.

    ``` { .python title="services/assistant/app/agent.py (the loop)" }
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/agent.py:49:82"
    ```

### Stopping and context management

| Stop condition | Why |
|---|---|
| A reply without tool calls | normal end: the model has an answer |
| Step limit (e.g. 8) | bounds cost and latency; a task that needs 30 steps is a workflow in disguise |
| Token or cost budget | protects the quota — see [LLM Gateway](../llm-gateway/index.md) |
| Wall-clock deadline | the user is waiting; return what you have |
| Same tool + same arguments twice | **loop detection**: the model is stuck |
| Risky action pending | pause and ask the human (human-in-the-loop) |

As the history grows, **context engineering** keeps it useful: tools return compact results (5 seat options, not 5,000 seats); older turns are **compacted** into a summary; large documents are referenced by ID and fetched only when needed. A focused context is cheaper, faster, and more accurate than a long one[^3].

---

## Tool calling

Tool calling (also called *function calling*) is the contract between the model and your code:

1. The request declares the tools: **name**, **description** and a **JSON Schema** of the arguments.
2. The model replies either with text or with one or more **tool calls**: `{id, name, arguments}`, where `arguments` should match the schema. Many APIs can enforce the schema with **constrained decoding** (structured outputs), so the JSON is always well-formed.
3. The orchestrator executes the call and sends the result back in a message linked to the call `id`.
4. The model continues with the result in its context.

The model chooses tools **by reading their names and descriptions**, so the tool interface is a prompt and an API at the same time. Good tools are designed for the model, not copied from the internal API:

| Principle | Bad | Good |
|---|---|---|
| Task-level, not table-level | `run_sql(query)`, `get_all_seats(event_id)` | `search_seats(event_id, quantity, max_price_brl)` |
| Few and distinct | 40 tools with overlapping names | ~5–15 tools per agent, clearly separated |
| Typed arguments | `date: string` ("next Sat"?) | `date: string, format: date` plus an `enum` where possible |
| Compact results | full JSON of every seat | top 5 options, only the fields needed to decide |
| Actionable errors | `500 Internal Server Error` | `"event evt_123 is sold out; 2 similar events on Sunday: ..."` |
| Descriptions with intent | "hold seats" | "Hold seats for 10 minutes so the fan can pay. Reversible: an unpaid hold expires." |
| Least privilege | one tool that reads and writes everything | read tools and write tools separate, each with its own permission |

---

## Tools are side effects { #side-effects }

A model call can be retried freely. A tool call **changes the world**. If `hold_seats` times out and the loop retries, did the first hold happen? This is the integration problem of [Compute & services](../../compute/integrations/index.md), and it has the same answers:

- **Idempotency keys.** The orchestrator derives a key from `(conversation, step, call)` and passes it to every write tool; the service returns the same result for the same key.
- **Reversible first.** Prefer actions with a natural undo — a **hold** expires in 10 minutes; an **order** with payment does not.
- **Compensation.** If a later step fails, run the inverse action (`release_hold`), exactly as in a [saga](../../messaging/patterns/index.md).
- **Risk tiers** decide what may run without a human:

| Tier | Examples | Policy |
|---|---|---|
| Read | `search_events`, `search_seats`, `get_order` | automatic |
| Reversible write | `hold_seats`, `add_to_wishlist` | automatic within limits (≤ 6 seats, ≤ 1 active hold) |
| Irreversible / financial | `create_order`, `refund_order`, `charge` | **explicit user confirmation** in the UI, never by text alone |
| External communication | `send_email`, `post_review` | confirmation, or not offered at all |

!!! example "In the BoxOffice code: read-only tools, identity from the gateway (lab 12)"

    The lab's registry takes the safest row of this table: its three tools — `search_events`, `get_event`, `get_order_status` — are **read-only**, so a confused or manipulated model can, at worst, read ([Hands-on 12 — Tools](../../../hands-on/12/tools/index.md)). The price is that the lab's assistant cannot hold seats; `hold_seats`, with an idempotency key and a limit, is the next tool to add, not one the lab builds. `get_order_status` takes the fan's identity from the `X-User-Email` header set by the gateway of [lab 4](../../../hands-on/4/gateway/index.md), never from an argument the model fills in, and answers "order not found" for another fan's order exactly as for a missing one, so nobody can probe which order ids exist.

    ``` { .python title="services/assistant/app/tools.py (context and one tool)" }
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/tools.py:17:21,53:64"
    ```

### Durable execution

A conversation that waits for the fan's confirmation, or a task that runs for minutes, cannot live only in a process's memory: pods restart. Persist the agent state after **every step** — messages, pending tool calls, idempotency keys — in a database, and resume from the last checkpoint. For long multi-step tasks, a **durable workflow engine** (Temporal-style: each step recorded, retried and resumable) gives you this for free; for short chats, a `conversation_state` row plus the session cache in the [Memory Fabric](../rag-memory/index.md) is enough.

---

## Planning

The agent loop plans **one step at a time**. For longer tasks, explicit planning helps:

| Pattern | How it works | Model calls | Strengths | Weaknesses |
|---|---|---|---|---|
| **ReAct** (implicit plan) | decide the next action after each observation | 1 per step | adapts to surprises | can wander; greedy |
| **Plan-and-execute** | a planner writes the full plan; an executor runs steps; re-plan on failure | 1 plan + steps (+ re-plans) | fewer large-model calls (executor may be small); plan is inspectable and approvable | rigid when the world changes mid-plan |
| **Reflection / evaluator-optimizer**[^4] | a critic (another prompt or model) reviews the result; the generator retries with feedback | ×2 or more | catches errors before the user sees them | doubles cost and latency |
| **Parallel steps** | independent actions issued together in one step | fewer rounds | lower latency | only for independent actions |

!!! example "BoxOffice: a plan the fan can see"

    For *"two seats under R$300 for Saturday, not in the upper ring, hold them"*, a plan-and-execute assistant first shows:

    1. Find events on Saturday in São Paulo.
    2. For each event, search pairs of adjacent seats ≤ R$300, excluding the upper ring. *(parallel)*
    3. Choose the cheapest pair; if none, check Sunday.
    4. Hold the pair (reversible, 10 min) and return the checkout link.

    Showing the plan costs one call, but it lets the fan correct a misunderstanding *before* any action, and it gives the evaluation team a trajectory to compare with the expected one.

### Why every step must be checked

If each step is right with probability $p$, independently, an $n$-step task succeeds with probability $p^n$:

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

A step that is right 95% of the time sounds good; a 10-step task built from it succeeds only 60% of the time. The levers are the same as for availability in series ([Estimation](../../estimation/availability-math/index.md)): **fewer steps** (better tools, workflows for the known parts), **validation after each step** (schemas, business rules in code), and **recovery** (errors returned to the model, re-planning) — the agent equivalent of retries and redundancy.

---

## Tool registry and MCP { #mcp }

Without a standard, every agent needs a custom integration with every tool: N agents × M tools. The **Model Context Protocol (MCP)**[^5] does for agents what the Language Server Protocol did for code editors: each tool provider writes **one MCP server**, each agent host embeds **MCP clients**, and any client can use any server — N + M integrations.

``` diagram
flowchart LR
    subgraph Host["Host: assistant service (orchestrator)"]
        c1["MCP client"]
        c2["MCP client"]
        c3["MCP client"]
    end
    c1 -- "Streamable HTTP + OAuth" --> s1["MCP server<br/>catalog team"]
    c2 -- "Streamable HTTP + OAuth" --> s2["MCP server<br/>inventory team"]
    c3 -- "stdio (local process)" --> s3["MCP server<br/>local files / dev tools"]
    s1 --> catalog["catalog service"]
    s2 --> inventory["inventory service"]
```

The essentials of the protocol:

- **Roles.** The *host* is the application (the BoxOffice assistant); it runs one *client* per connection; each *server* exposes capabilities.
- **Server primitives.** **Tools** (actions the model may call), **resources** (data the application can read into context, identified by URIs), and **prompts** (reusable templates offered to the user). Clients may in turn offer servers capabilities such as *sampling* (the server asks the host's model for a completion) and *elicitation* (the server asks the user for input).
- **Messages.** JSON-RPC 2.0. A session starts with `initialize` (version and capability negotiation); then `tools/list` discovers tools and `tools/call` invokes them; servers can notify `tools/list_changed`.
- **Transports.** **stdio** for a server running as a local subprocess; **Streamable HTTP** for remote servers, with OAuth 2.1-based authorization.

The `inventory` team publishes its capabilities as an MCP server. With the official Python SDK, a tool is a typed, documented function — the SDK derives the JSON Schema from the type hints and the description from the docstring:

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

On the wire, this is what the orchestrator's client sees when it discovers the tool (`tools/list` result, abridged) and then calls it:

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

Notice what is **not** an argument: the fan's identity. The MCP server takes the user from the **authenticated session** (the OAuth access token the host obtained on the fan's behalf, as in [Identity](../../edge/identity/index.md)) — never from a field the model fills in, or a prompt injection could hold seats for someone else.

### The registry around MCP

MCP standardizes the *wire*; the **Tool Registry** component is the governance around it:

| Registry concern | What it records / enforces |
|---|---|
| Catalog | which MCP servers exist, owner team, version, endpoint, SLO |
| Exposure | which tools each agent (and each user role) may see |
| Risk tier | read / reversible / irreversible / external — feeds the [Safety Mesh](../safety-evals/index.md) |
| Authentication | OAuth scopes per tool; tokens per user, not a shared super-token |
| Limits and audit | rate limits per tool; an audit log of every call with user, arguments and result |
| Supply chain | pinned versions; reviewed descriptions; allowlist of third-party servers |

!!! warning "Annotations are hints, not security"

    `readOnlyHint` or `destructiveHint` come from the server. A malicious or buggy third-party server can lie, and its tool **descriptions** are text the model reads — a place for injected instructions (*tool poisoning*), which can even change after you approved the server. Treat third-party MCP servers like third-party code: review, pin, sandbox, and enforce permissions in your own registry and services.

For communication **between agents** owned by different teams or companies, separate protocols are emerging (for example *Agent2Agent*, A2A). The distinction to keep: MCP connects an agent to **tools and data**; agent-to-agent protocols connect an agent to **another agent**.

---

## Multi-agent orchestration

When one agent has too many tools, too long a prompt, or tasks that can run in parallel, the work is split across several agents.

| Pattern | Shape | BoxOffice example | Why use it |
|---|---|---|---|
| **Supervisor / orchestrator-workers** | one agent decomposes and delegates; workers return results | "plan my festival weekend": tickets agent, travel agent, lodging agent | separation of tools and prompts; parallelism |
| **Router / handoff** | a triage agent transfers the conversation to a specialist | triage → booking agent, refunds agent, accessibility agent | each specialist has a short prompt and few tools |
| **Parallel fan-out + aggregate** | the same input to several agents; merge or vote | three reviewers check a refund decision | robustness through diversity |
| **Evaluator-optimizer** | a generator and a critic iterate | a draft reply to an angry fan, checked against policy | quality on hard outputs |
| **Hierarchical** | supervisors of supervisors | large back-office automation | very large tasks — rarely needed |

``` diagram-sim
sequenceDiagram
    actor F as Fan
    participant S as Supervisor agent
    participant T as Tickets agent
    participant L as Lodging agent
    F->>S: "festival weekend in Rio, budget R$2,000"
    par in parallel
        S->>T: find 2 passes ≤ R$900
        S->>L: find lodging near the venue ≤ R$1,100
    end
    T-->>S: 2 options (hold not yet placed)
    L-->>S: 3 options
    S-->>F: combined proposal: confirm?
```

Multi-agent systems trade money and latency for modularity. Each agent has its own context (more tokens in total), every hand-off loses information unless the state is passed explicitly, and failures become harder to trace. Pass **explicit, structured artifacts** between agents (a list of candidate seats with IDs), not whole transcripts, and trace the full tree of calls ([Observability](../safety-evals/index.md#observability)).

---

## When NOT to use agents

| If… | …then prefer | BoxOffice |
|---|---|---|
| the steps are known in advance | a **workflow** (code orchestrates, model fills gaps) | the hold-seats flow |
| the decision must be exactly right every time | **deterministic code** | price calculation, seat allocation, refunds rules |
| the latency budget is under ~1–2 s | a single small-model call, or no model | autocomplete in search |
| the action is irreversible | code + **explicit human confirmation** | payment, refund |
| volume is huge and the task is narrow | a classifier, a small fine-tuned model, or rules | fraud signals on every checkout |
| you cannot evaluate the result | **do not automate it yet** | — |
| one agent with good tools works | **do not add agents** | most support conversations |

!!! tip "Try it"

    Run the AI assistant scenario with the **stress** profile. Each request entering the Orchestrator becomes several calls to the LLM Gateway and the Tool Registry: compare the request rate at the orchestrator with the rate at the gateway. That ratio is the number of agent steps, and it is the multiplier of your model capacity and cost.

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520" data-profile="stress"></div>

---

## BoxOffice: the trace of one task

| Step | Model output | Orchestrator action | Context after the step |
|---|---|---|---|
| 1 | `search_events(city="São Paulo", date="2027-03-13")` | read tool → 3 events | ~3,900 tokens |
| 2 | `search_seats(evt_8812, 2, 300)` and `search_seats(evt_8820, 2, 300)` (parallel) | 2 read tools → 4 pairs | ~5,000 tokens |
| 3 | `hold_seats(evt_8812, ["C12","C13"], key)` | Safety Mesh: reversible, 2 seats → allow; hold h_77a | ~5,300 tokens |
| 4 | text: "I held C12–C13 for R$280 each until 10:12. Pay here: …" | stream to the fan; save the turn | — |

Parallel tool calls saved one full round (≈ 2 s). Had the model asked for a 40-seat hold, step 3 would have returned `{"error": "deny: invalid arguments: List should have at most 6 items after validation, not 40"}` (the [guardrail check](../safety-evals/index.md#guardrail-code)) and the model would have explained the limit to the fan.

!!! tip "In the interview"

    Say **"workflow first, agent where needed"** and justify it with the compounding math ($0.95^{10} \approx 60\%$). Draw the loop with its **budgets** (steps, tokens, time) and show where tools are **authorized as the user** and **made idempotent**. Name MCP as the way teams expose tools, and add a registry for permissions, risk tiers and audit. If multi-agent comes up, give one concrete reason (tool separation or parallelism) and its cost (tokens, latency, debuggability).

!!! success "Best practices"

    - **Put in the prompt, before the first call, what you already know** — retrieved documents, the user's city, today's date; each tool round you avoid saves a whole model call (~2 s in the trace of one task above). In BoxOffice: lab 12 retrieves the top-5 events first ([agent loop](../../../hands-on/12/tools/index.md)).
    - **Make the last allowed step tool-less** — the budget then ends with an answer, not with silence; lab 12's fourth call is made without tools.
    - **Return tool errors as short, actionable data** — "event 42 does not exist" lets the model recover; lab 12's `tools.call()` turns invalid arguments and service failures into JSON and never raises.
    - **Validate tool arguments against the schema before running the tool** — lab 12 validates every call with pydantic and counts `invalid_args` in `assistant_tool_calls_total`.
    - **Stop on repetition** — the same tool with the same arguments twice is a loop: end the run and hand off instead of spending the rest of the budget.
    - **Checkpoint the agent state after every step when a human must confirm** — a pod restart during the confirmation must resume the task, not repeat its side effects.

!!! warning "Common pitfalls"

    - **Agents for deterministic flows** — slower, costlier and less reliable than ten lines of code.
    - **No budgets** — a model stuck in a loop is an unbounded cost.
    - **Database-shaped tools** (`run_sql`, `get_everything`) — huge results, injection risk, and the model does the work your service should do.
    - **Retrying write tools without idempotency keys** — double holds, double orders.
    - **The agent's own super-credential** instead of the user's token — the "confused deputy" problem.
    - **Trusting third-party MCP servers blindly** — their descriptions are prompts and their annotations are claims.
    - **Multi-agent by default** — more tokens and more failure points with no measured gain.

---

## How it connects { #how-it-connects }

``` diagram
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

**Palette components:** [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (runs the loop and owns the budgets) · [`toolreg`](../../../reference/components/ai/index.md#toolreg) (MCP servers, permissions, risk tiers) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) (every model call) · [`safety`](../../../reference/components/ai/index.md#safety) (approval of risky actions) · [`auth`](../../../reference/components/compute/index.md#auth) (the user's identity on each tool call) · [`app`](../../../reference/components/compute/index.md#app) (the same `catalog` and `inventory` services the web front end calls). **Scenarios:** `ai-assistant`. **Continues in:** [Messaging — patterns](../../messaging/patterns/index.md) (sagas and compensation), [Network & Security — identity](../../edge/identity/index.md), [Estimation — availability math](../../estimation/availability-math/index.md), [Compute — integrations](../../compute/integrations/index.md) (idempotency keys), [RAG & Memory](../rag-memory/index.md), [Safety, Evals & Observability](../safety-evals/index.md).

---

[^1]: ANTHROPIC. [Building effective agents](https://www.anthropic.com/research/building-effective-agents){target="_blank"}. 2024.
[^2]: YAO, S. et al. [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629){target="_blank"}. ICLR, 2023.
[^3]: HUYEN, C. *AI Engineering: Building Applications with Foundation Models*. O'Reilly, 2025.
[^4]: SHINN, N. et al. [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366){target="_blank"}. NeurIPS, 2023.
[^5]: Model Context Protocol. [Specification](https://modelcontextprotocol.io/specification){target="_blank"} and [Python SDK](https://github.com/modelcontextprotocol/python-sdk){target="_blank"}.
