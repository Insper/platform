BoxOffice started, like most companies, as **one Spring Boot application**: events, seats, orders, payments and e-mails in one codebase, one PostgreSQL database, one deployable `.jar`. For the first year that was exactly right. Then three things happened at once. On sale days only the seat map and checkout were overloaded, but the only way to scale them was to run more copies of *everything*. A bug in the venue-image upload took checkout down with it. And four teams now shared one codebase: every release needed all of them to agree on the same day.

Nothing was wrong with the code. The **shape** of the system no longer fitted the load or the organization. This page is about choosing that shape: how big a deployable unit should be, where to draw the boundaries between services, and how to organize the code *inside* one service so that it survives years of change.

---

## The spectrum: monolith to microservices

"Monolith or microservices" is not a binary choice; it is a spectrum of how many independently deployable units the system has, and how strongly their boundaries are enforced.

``` mermaid-sim
flowchart LR
    subgraph mono ["Monolith"]
        direction TB
        m1["one app<br/>catalog · inventory · order · payment"] --> mdb[("one database")]
    end
    subgraph modular ["Modular monolith"]
        direction TB
        mm["one app"] --- c1["module catalog"]
        mm --- c2["module inventory"]
        mm --- c3["module order"]
        c1 --> s1[("schema catalog")]
        c2 --> s2[("schema inventory")]
        c3 --> s3[("schema order")]
    end
    subgraph micro ["Microservices"]
        direction TB
        gw["gateway"] --> x1["catalog"]
        gw --> x2["inventory"]
        gw --> x3["order"]
        x1 --> d1[("catalog DB")]
        x2 --> d2[("inventory DB")]
        x3 --> d3[("order DB")]
    end
    mono --> modular --> micro
```

| Dimension | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| **Deployable units** | 1 | 1 | many (one per service) |
| **Boundaries enforced by** | discipline (often none) | the build: modules, package visibility, ArchUnit tests | the network: a service can only call another's API |
| **Calls between parts** | in-process, nanoseconds | in-process, nanoseconds | network, ~0.5–5 ms in a datacenter, can fail |
| **Transactions** | one ACID transaction across everything | one database, but each module owns its tables | no shared transaction: sagas, eventual consistency |
| **Scaling** | the whole app | the whole app | each service on its own profile |
| **Failure isolation** | a memory leak kills everything | a memory leak kills everything | one service fails, others degrade |
| **Team autonomy** | low beyond ~10 engineers | medium: separate modules, shared release | high: own code, data, release cadence |
| **Operational cost** | lowest | low | high: discovery, tracing, CI/CD per service, on-call |

The **modular monolith** deserves more attention than it gets. It gives you the main benefit of microservices — clear boundaries, each module owning its data — without paying for the network. If a module later needs independent scaling or a different team, it can be extracted along a boundary that already exists. Shopify, for example, publicly described its choice to modularize a large Rails monolith rather than split it into services[^7].

!!! tip "Monolith first"
    Most successful microservice systems began as monoliths: you rarely know the right boundaries on day one, and moving a boundary inside one codebase is a refactoring, while moving it between services is a migration[^2]. Start with a (modular) monolith; split when one of the forces below becomes real.

### When splitting pays off

Split a part of the system into its own service when at least one of these forces is strong — and write down which one, because it tells you *where* to cut:

| Force | BoxOffice example | Why a separate service helps |
|---|---|---|
| **Different scaling profile** | `catalog` is read-heavy (thousands of reads per write), `inventory` is write-hot during on-sale | Scale and tune each on its own; cache one aggressively, protect the other |
| **Team autonomy** | the search team ships twice a day; payments ships monthly after review | Independent releases, no release train |
| **Failure isolation** | the AI `assistant` can be slow or down without blocking ticket sales | A failure stays inside a boundary (with timeouts and breakers, see [reliability](../../reliability/index.md)) |
| **Security / compliance scope** | only `payment` talks to the payment provider and holds provider tokens | Smaller audit scope (PCI DSS), tighter network policies |
| **Different technology** | `assistant` is Python + FastAPI + pgvector; the core is Java | Each service picks its runtime; the contract is HTTP or events |

And the costs you accept when you split:

- **Every call can fail or be slow** ([distributed systems](../../distributed/index.md)): timeouts, retries, circuit breakers become mandatory.
- **No cross-service transactions**: "hold seat, create order, charge card" becomes a saga with compensations ([messaging](../../messaging/index.md)).
- **Availability multiplies down** along synchronous chains: three services at 99.9% in series give ≈ 99.7%.
- **Operations multiply**: N pipelines, N dashboards, distributed tracing to debug one request ([observability](../../observability/index.md)).

!!! warning "Symptoms of a distributed monolith"
    All the costs of microservices, none of the benefits:

    - Services must be **deployed together** because a change in one breaks the others.
    - Two services **read and write the same tables**.
    - One user request triggers a **long chain of synchronous calls**; if any link is down, everything is down.
    - A shared library of domain classes forces every service to upgrade at once.

**How small is "micro"?** Not a number of lines. A service is the right size when one team can own it end to end, it can be deployed without coordinating with others, and it maps to one business capability. Services that are too small ("nanoservices", e.g. one per table) spend more time talking to each other than working.

---

## Finding boundaries with Domain-Driven Design

You have decided to split. Where do you cut? By database table (`events`, `seats`, `orders`)? By layer (a "UI service", a "logic service")? Each produces services that must change together. **Domain-Driven Design** (DDD)[^1] gives a better answer: cut where the **business itself** has a seam.

DDD works at two levels:

| Level | Question | Tools |
|---|---|---|
| **Strategic design** | *Where are the boundaries?* | subdomains, ubiquitous language, bounded contexts, context maps, Event Storming |
| **Tactical design** | *What goes inside one boundary?* | entities, value objects, aggregates, repositories, domain events |

Strategic design decides the **services**; tactical design shapes the **code inside each one**.

### Subdomains: where to invest { #subdomains-where-to-invest }

Not every part of the business deserves the same effort:

| Kind | Meaning | In BoxOffice | Strategy |
|---|---|---|---|
| **Core** | What makes the business different | seat inventory and holds under a flash sale, the waiting room, pricing | build it, with the best people |
| **Supporting** | Specific to the business, not a differentiator | catalog of events and venues, notifications, search tuning | build simply, or customize a product |
| **Generic** | Solved problems, the same for every company | identity/login, card payments, e-mail delivery | **buy or reuse**: an identity provider, a payment provider, an e-mail provider |

That last row is why BoxOffice has an [external integrations](../integrations/index.md) problem at all: it deliberately does *not* build its own card processing or mail servers.

### Ubiquitous language and bounded contexts

The **ubiquitous language** is the vocabulary shared by developers and domain experts and used verbatim in code: if the box-office staff say *hold*, *on-sale*, *seat map* and *allocation*, the code says `Hold`, `OnSale`, `SeatMap` and `Allocation` — not `TempReservation` or `Lock`.

But the same word often means different things in different parts of the business. A **bounded context** is the boundary inside which one model, and one meaning of each word, applies:

``` mermaid-sim
flowchart LR
    subgraph cat ["Catalog context"]
        e1["Event<br/>artist · date · venue · description · images"]
    end
    subgraph inv ["Inventory context"]
        e2["Event<br/>seat map · sections · holds · capacity"]
    end
    subgraph ord ["Order context"]
        e3["Event (as sold)<br/>event id · seat · price paid · fees"]
    end
    cat -. "same word,<br/>different model" .- inv
    inv -. "same word,<br/>different model" .- ord
```

Trying to build one `Event` class that serves all three — with images, a seat map and historical prices — produces a bloated object that serves none well and couples three teams. Instead each context owns its own model, and they exchange **ids and events**. Note the Order context in particular: an order stores the **price paid**, not a reference to the current price, because if the catalog changes a price tomorrow, yesterday's order must not change.

**A bounded context typically maps to one service** (or a small group of closely related ones). That is the main heuristic for service boundaries.

### Context maps: how contexts relate

Contexts exchange data, and the relationship between each pair is a design decision. A **context map** draws them[^3]:

| Pattern | Meaning | Use when |
|---|---|---|
| **Customer / Supplier** | the upstream team plans with the downstream team's needs in mind | two teams in the same company |
| **Open Host Service + Published Language** | the upstream publishes a documented API or event schema for any consumer | one provider, many consumers |
| **Conformist** | the downstream adopts the upstream model as is | the upstream model is fine, or you have no influence |
| **Anti-Corruption Layer (ACL)** | the downstream translates the upstream model at the border | a third-party or legacy model you do not want leaking in |
| **Shared Kernel** | two contexts share a small piece of model and code | rarely; it couples the two teams |

``` mermaid-sim
flowchart LR
    catalog["Catalog"] -->|"Open Host: REST + OpenAPI"| order["Order"]
    catalog -->|"Published Language:<br/>EventPublished events"| search["Search"]
    inventory["Inventory"] -->|"Customer / Supplier:<br/>hold & confirm API"| order
    order -->|"OrderConfirmed event"| notification["Notification"]
    psp["Payment provider"] -->|"Anti-Corruption Layer"| payment["Payment"]
    payment -->|"PaymentSucceeded event"| order
    mail["E-mail provider"] -->|"Anti-Corruption Layer"| notification
```

The two **anti-corruption layers** matter most in practice: the payment provider's model (its "payment intents", its status names, its error codes) must not spread through BoxOffice. The `payment` service translates it into BoxOffice's own `Payment` model at the border — the [integrations](../integrations/index.md) page shows that adapter.

### Aggregates: the unit of consistency

Inside a context, an **aggregate** is a cluster of objects changed together as one unit, with one **root** as the only entry point. The root enforces the **invariants** — rules that must always hold. Two rules make aggregates fit microservices:

- **Reference other aggregates by id only.** A `Hold` keeps the `seatId` and the `fanId`, never a `Fan` object. That is what lets the two live in different services.
- **One transaction changes one aggregate.** If a use case must change two aggregates, the second change happens afterwards, triggered by a domain event (eventual consistency).

```java title="inventory: the Hold aggregate root (illustrative)"
public class Hold {                                   // aggregate root
    private static final Duration TTL = Duration.ofMinutes(10);
    private static final int MAX_SEATS = 6;           // per fan, per event

    private final HoldId id;
    private final EventId eventId;                    // other aggregates: by id only
    private final FanId fanId;
    private final Set<SeatId> seats;
    private final Instant expiresAt;
    private HoldStatus status = HoldStatus.ACTIVE;

    public static Hold place(EventId event, FanId fan, Set<SeatId> seats, Clock clock) {
        if (seats.isEmpty() || seats.size() > MAX_SEATS)
            throw new HoldRejected("between 1 and " + MAX_SEATS + " seats");
        return new Hold(HoldId.random(), event, fan, Set.copyOf(seats),
                        clock.instant().plus(TTL));
    }

    public void confirm(Clock clock) {                // called when the payment succeeds
        if (status != HoldStatus.ACTIVE || clock.instant().isAfter(expiresAt))
            throw new HoldExpired(id);
        status = HoldStatus.CONFIRMED;
    }
}
```

The invariant "a seat belongs to at most one active hold" spans *all* holds of an event, so it cannot be checked inside one `Hold` object; it is enforced by the database (a unique constraint on `(event_id, seat_id)` for active holds) — exactly the kind of decision [class 6](../../databases/index.md) is about.

!!! example "Event Storming in one paragraph"
    To find contexts with the business, put domain experts and engineers in front of a wall and write every **domain event** on an orange sticky note, in the past tense: *EventPublished, SaleOpened, FanQueued, SeatsHeld, HoldExpired, PaymentSucceeded, OrderConfirmed, TicketIssued, TicketScanned*. Order them in time, add the commands (blue) and actors (yellow) that cause them, and look where the vocabulary changes or where one group of people hands over to another. Those seams are your candidate bounded contexts[^6].

---

## Conway's law

> *"Any organization that designs a system will produce a design whose structure is a copy of the organization's communication structure."*
> — Melvin Conway, 1968[^4]

Boundaries in the code drift to match boundaries between teams, because communication *within* a team is cheap and communication *between* teams is expensive. The plot below shows BoxOffice's evolution: as teams form around business capabilities, the codebase splits along the same lines.

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

stages = [
    ("Year 1: one team", [((5, 5), "catalog\ninventory\norder\npayment", 0)]),
    ("Year 2: two teams", [((2.6, 5), "catalog\nsearch", 0), ((7.4, 5), "inventory\norder\npayment", 1)]),
    ("Year 3: four teams", [((2.6, 7.2), "catalog\nsearch", 0), ((7.4, 7.2), "inventory", 1),
                            ((2.6, 2.6), "order\npayment", 2), ((7.4, 2.6), "notification\nassistant", 3)]),
]
palette = ["#4C72B0", "#DD8452", "#55A868", "#C44E52"]

fig, axes = plt.subplots(1, 3, figsize=(12, 4))
for ax, (title, boxes) in zip(axes, stages):
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis("off")
    ax.set_title(title, fontsize=10, fontweight="bold")
    for i, ((x1, y1), _, _) in enumerate(boxes):
        for (x2, y2), _, _ in boxes[i + 1:]:
            ax.plot([x1, x2], [y1, y2], "--", color="#999", linewidth=1.2, zorder=1)
    for (x, y), label, team in boxes:
        w, h = (6, 5) if len(boxes) == 1 else (4, 3.2 if len(boxes) == 2 else 2.6)
        ax.add_patch(plt.Rectangle((x - w / 2, y - h / 2), w, h, color=palette[team], alpha=0.85, zorder=2))
        ax.text(x, y, label, ha="center", va="center", fontsize=8, color="white", fontweight="bold", zorder=3)

handles = [mpatches.Patch(color=c, label=f"team {i + 1}") for i, c in enumerate(palette)]
fig.legend(handles=handles, loc="lower center", ncol=4, fontsize=8, frameon=False)
fig.suptitle("Conway's law: the services end up shaped like the teams (dashed = API between teams)", fontsize=10)
plt.tight_layout(rect=(0, 0.06, 1, 0.95))
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Two practical consequences:

- **If boundaries and teams disagree, the teams win.** A service owned by three teams becomes a coordination bottleneck; three services owned by one team tend to merge back into a distributed monolith.
- **The inverse Conway maneuver**: shape the teams first — one *stream-aligned* team per business capability, plus a *platform* team that provides deployment, observability and databases as self-service — so that the architecture follows[^5].

---

## Owning the data

**Database per service** means no service reads or writes another service's tables. It does not require one database *server* per service: one PostgreSQL cluster can host several schemas, as long as each schema has exactly one owner.

``` mermaid-sim
flowchart LR
    order["order"] -->|"POST /holds/{id}/confirm"| inventory["inventory"]
    inventory --> inv[("inventory schema")]
    order --> ord[("order schema")]
    order -.-x|"no direct SQL"| inv
```

When `order` needs to confirm a hold, it calls the `inventory` **API**, never the `holds` **table**. That keeps the inventory team free to change its schema, add a cache or move to another database. Two consequences follow:

- **Queries across services** become API calls — or a local, read-only copy of the other service's data kept up to date by events (CQRS, [messaging](../../messaging/index.md)). `search` keeps its own index of events this way.
- **Business transactions across services** become a sequence of local transactions coordinated by events or an orchestrator, with compensations when a step fails: the **saga** pattern. "Payment failed → release the hold" is a compensation.

### Talking to each other

=== "Synchronous (request/response)"

    The caller waits for the answer. Simple, but **temporally coupled**: if `inventory` is down, `order` cannot confirm.

    ``` mermaid-sim
    sequenceDiagram
        participant F as Fan
        participant O as order
        participant I as inventory
        F->>O: POST /orders
        O->>I: confirm hold H-7
        I-->>O: confirmed
        O-->>F: 201 Created
    ```

    **Use when** the caller needs the answer *now* to respond (confirm the hold before saying "you have tickets").

=== "Asynchronous (events)"

    The producer publishes a fact and moves on; consumers react in their own time. No temporal coupling — `notification` can be down for five minutes and catch up.

    ``` mermaid-sim
    sequenceDiagram
        participant O as order
        participant K as Kafka
        participant N as notification
        participant A as analytics
        O->>K: OrderConfirmed
        Note over O: answers the fan immediately
        K->>N: OrderConfirmed → e-mail tickets
        K->>A: OrderConfirmed → sales dashboard
    ```

    **Use when** the work does not change the answer to the user (e-mail, analytics, search indexing).

Class 8 ([messaging](../../messaging/index.md)) goes deep on events; the [API styles](../api-styles/index.md) page covers the request/response options.

---

## Inside one service: internal architecture

Splitting the system decides the boundaries *between* services. Each service still needs a structure *inside*, and the same principle applies at a smaller scale: **protect the business rules from things that change more often** — frameworks, databases, protocols, providers.

### SOLID in one table

The five SOLID principles[^8] are class-level rules that make that protection possible:

| Principle | One sentence | Violation in BoxOffice |
|---|---|---|
| **S**ingle responsibility | a class has one reason to change | `OrderService` that also renders the e-mail HTML and calls the payment provider |
| **O**pen/closed | add behavior by adding code, not editing working code | a `switch (provider)` that grows with each new payment provider |
| **L**iskov substitution | a subtype must work wherever its parent does | a `FreeTicketPayment` that throws on `refund()` |
| **I**nterface segregation | clients should not depend on methods they do not use | one `InventoryRepository` with 40 methods used by every class |
| **D**ependency inversion | business code depends on abstractions it owns, not on infrastructure | `HoldService` importing the JPA `EntityManager` or the provider's SDK |

### Layered, clean and hexagonal { #layered-clean-and-hexagonal }

Most Spring Boot services start **layered**: controller → service → repository → database. It separates HTTP from business logic, but the business layer still *depends on* the persistence layer. **Clean Architecture** (Robert C. Martin) and **Hexagonal Architecture**, a.k.a. *ports and adapters* (Alistair Cockburn), invert that one arrow: the core defines interfaces (**ports**) in business terms, and infrastructure (**adapters**) implements them[^9][^10].

``` mermaid-sim
flowchart LR
    rest["REST controller<br/>(driving adapter)"] --> uc["PayForOrder<br/>use case"]
    kafka["Kafka listener<br/>(driving adapter)"] --> uc
    uc --> port1["«port»<br/>PaymentGateway"]
    uc --> port2["«port»<br/>PaymentRepository"]
    stripe["ProviderAdapter<br/>(HTTP client)"] -.->|implements| port1
    fake["FakeGateway<br/>(tests)"] -.->|implements| port1
    jpa["JpaPaymentRepository"] -.->|implements| port2
```

For the `payment` service this is not academic. The port is the anti-corruption layer from the context map:

```java title="payment: a port owned by the core, an adapter per provider"
// core — knows nothing about HTTP, JSON or any provider SDK
public interface PaymentGateway {
    ChargeResult charge(PaymentId id, Money amount, PaymentMethodToken method,
                        IdempotencyKey key);
}

// adapter — the only class that knows the provider's API and vocabulary
@Component
class ProviderPaymentGateway implements PaymentGateway {
    private final ProviderClient client;   // generated or hand-written HTTP client

    @Override
    public ChargeResult charge(PaymentId id, Money amount, PaymentMethodToken method,
                               IdempotencyKey key) {
        var response = client.createPayment(amount.cents(), amount.currency().code(),
                                            method.value(), key.value());
        return switch (response.status()) {            // translate THEIR states to OURS
            case "succeeded"       -> ChargeResult.succeeded(response.id());
            case "requires_action" -> ChargeResult.needsCustomerAction(response.nextActionUrl());
            case "processing"      -> ChargeResult.pending(response.id());
            default                -> ChargeResult.failed(response.failureCode());
        };
    }
}
```

The payoff: use-case tests run in milliseconds with a `FakeGateway`; adding a second provider for [failover](../integrations/index.md#provider-outages) is a new adapter, not a rewrite; and the provider's status names stop at one class.

| | Layered | Clean / Hexagonal |
|---|---|---|
| Business code depends on | the persistence framework | interfaces it owns |
| Unit tests need | a database or framework mocks | plain in-memory fakes |
| Swapping DB / provider / protocol | touches business classes | a new adapter |
| Cost | fewest classes | more interfaces, mappers, indirection |

!!! warning "Do not over-architect a CRUD service"
    Ports, adapters and mappers cost classes and indirection. A service that only stores and returns records (the venue list, a lookup table) can stay layered. The structure pays off where business rules are rich (`inventory`), integrations are external (`payment`, `notification`) or the service will live for years. Microservices let each service choose.

---

## Shared capabilities as services

Some capabilities are needed by many parts of the system and appear as their own components in the palette. They are usually the first services extracted — and often the first ones *bought*:

| Capability | Palette | What it owns | Build or buy? | Scaling notes |
|---|---|---|---|---|
| **Auth** | [`auth`](../../../reference/components/compute/index.md#auth) | identities, credentials, sessions, token signing keys | usually buy/reuse: Keycloak, Auth0, Cognito, Entra ID | stateless token validation at the gateway; login spikes at on-sale |
| **Search** | [`search`](../../../reference/components/compute/index.md#search) | an inverted index, *derived* from the catalog | build on Elasticsearch/OpenSearch or a managed search | index updated from `EventPublished` events; read-heavy, cache popular queries |
| **Notifications** | [`notifications`](../../../reference/components/compute/index.md#notifications) | templates, user preferences, delivery log | build the service, buy the delivery (e-mail/push/SMS providers) | queue-driven workers; throttled by provider rate limits |
| **Analytics** | [`analytics`](../../../reference/components/compute/index.md#analytics) | an event stream and aggregates | build the pipeline on Kafka + a data warehouse | append-only, high write volume, never on the request path |
| **Scheduler** | [`scheduler`](../../../reference/components/compute/index.md#scheduler) | job definitions and their next run | Kubernetes CronJob, a cloud scheduler, or a library with locks | see [async work](../async-work/index.md#schedulers) |

Two patterns repeat: these services are mostly **fed by events** rather than called synchronously, and their data is often **derived** — search and analytics can be rebuilt from the source of truth, which makes them cheaper to operate.

### BoxOffice service map

| Service | Capability | Owns | Called by | Scaling profile |
|---|---|---|---|---|
| `gateway` | single entry point, auth check, rate limits | — | clients | requests/s |
| `auth` | login, tokens | users, credentials | gateway | login bursts at on-sale |
| `catalog` | events, venues, artists | catalog DB | gateway, order | read-heavy, cache + CDN |
| `inventory` | seat maps, holds | seats, holds | gateway, order | write-hot during on-sale; correctness first |
| `order` | orders, checkout saga | orders | gateway | follows sales |
| `payment` | adapter to the payment provider | payments, provider ids | order | follows sales; bounded by the provider |
| `notification` | e-mail and push | templates, delivery log | events | queue-driven bursts |
| `search` | full-text search | derived index | gateway | read-heavy |
| `assistant` | AI support (Python) | conversations, embeddings | gateway | GPU/LLM-bound, isolated |

!!! tip "In the interview"

    You rarely need to draw twenty microservices. Draw the **few services whose boundaries matter for the problem** and justify each split with a force: *"I'd keep catalog and inventory separate because catalog is read-heavy and cacheable while inventory is write-hot and must be strongly consistent — different scaling and consistency needs."* If asked "monolith or microservices?", answer with the trade-off, not a slogan: team size, independent scaling needs, and operational maturity. Saying *"I'd start as a modular monolith and extract inventory first"* is a strong, defensible answer.

!!! warning "Common pitfalls"

    - **Splitting by technical layer** ("UI service", "DB service") instead of by business capability: every feature touches every service.
    - **Shared database** between services: the schema becomes a contract nobody can change.
    - **Entity services** (`EventService`, `SeatService`, `PriceService`) that are just CRUD over one table and must call each other for every use case.
    - **Synchronous chains** of five services for one click: availability and latency multiply.
    - **Splitting before the domain is understood**: boundaries drawn too early are expensive to move.
    - **Ignoring the teams**: boundaries that do not match ownership decay (Conway).

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    MONO["monolith"] --> MOD["modular monolith"]
    MOD --> MS["microservices<br/>when a force is real"]
    DDD["DDD: subdomains,<br/>bounded contexts"] --> MS
    CONWAY["Conway's law<br/>teams shape services"] --> MS
    AGG["aggregates<br/>reference by id"] --> OWN
    MS --> OWN["each service owns its data<br/>→ Databases"]
    MS --> TALK["APIs and events<br/>→ API Styles, Messaging"]
    OWN --> SAGA["no cross-service transactions<br/>→ sagas, outbox"]
    HEX["ports and adapters"] --> INT["provider adapters<br/>→ Integrations"]
    MS --> SHARED["shared capabilities:<br/>auth, search, notifications"]
```

**Palette components:** [`app`](../../../reference/components/compute/index.md#app) (each service is its own stateless tier) · [`apigw`](../../../reference/components/edge/index.md#apigw) (`gateway`, the single entry point) · [`auth`](../../../reference/components/compute/index.md#auth) · [`search`](../../../reference/components/compute/index.md#search) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`analytics`](../../../reference/components/compute/index.md#analytics) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (shared capabilities, often bought) · [`sql`](../../../reference/components/storage/index.md#sql) (one database per service, never shared tables) · [`stream`](../../../reference/components/messaging/index.md#stream) (events feed the derived services). **Scenarios:** `monolith`, `event-fanout`. **Continues in:** [API Styles](../api-styles/index.md), [Databases](../../databases/index.md) (one database per service), [Messaging — patterns](../../messaging/patterns/index.md) (outbox, saga), [Distributed — transactions](../../distributed/transactions/index.md), [Hands-on 1](../../../hands-on/1/index.md).

## Key takeaways

- Monolith → modular monolith → microservices is a spectrum; **start modular** and split when a force (scaling profile, team autonomy, failure isolation, compliance, technology) is real.
- Find boundaries with **DDD**: subdomains tell you what to build or buy, **bounded contexts** tell you where one model ends; aggregates reference each other **by id**.
- **Conway's law**: services take the shape of the teams — design both together.
- Each service **owns its data**; others use its API or its events, never its tables.
- Inside a service, **ports and adapters** keep business rules independent of frameworks and providers — essential for integrations, optional for CRUD.
- Auth, search, notifications, analytics and scheduling are shared capabilities, usually **event-fed** and often **bought**.

---

[^1]: EVANS, E. *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley, 2003.
[^2]: FOWLER, M. [MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html){target="_blank"}. martinfowler.com, 2015. See also NEWMAN, S. *Building Microservices*, 2nd ed. O'Reilly, 2021.
[^3]: VERNON, V. *Implementing Domain-Driven Design*. Addison-Wesley, 2013. Chapter 3 (context maps).
[^4]: CONWAY, M. E. [How Do Committees Invent?](https://www.melconway.com/Home/Committees_Paper.html){target="_blank"} *Datamation*, 14(4), 1968, p. 28–31.
[^5]: SKELTON, M.; PAIS, M. *Team Topologies*. IT Revolution, 2019.
[^6]: BRANDOLINI, A. *Introducing EventStorming*. Leanpub, 2021.
[^7]: WESTERINEN, K. [Deconstructing the Monolith: Designing Software that Maximizes Developer Productivity](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity){target="_blank"}. Shopify Engineering, 2019.
[^8]: MARTIN, R. C. *Agile Software Development: Principles, Patterns, and Practices*. Prentice Hall, 2002.
[^9]: MARTIN, R. C. *Clean Architecture*. Prentice Hall, 2017.
[^10]: COCKBURN, A. [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/){target="_blank"}. 2005.
