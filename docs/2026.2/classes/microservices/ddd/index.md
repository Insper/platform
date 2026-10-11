
You have decided to split the store into services. Where do you cut? By database table (`products`, `orders`, `order_items`)? By layer (one service for the UI, one for the logic)? By whatever the teams are working on this month? Each of these produces services that must change together and call each other constantly — a distributed monolith. You need a way to find the places where the **business itself** has a seam. That is what Domain-Driven Design gives you.

[Domain-Driven Design (DDD)](https://en.wikipedia.org/wiki/Domain-driven_design){target="_blank"} is a software development approach introduced by Eric Evans[^1] that places the **domain** — the specific area of business the software supports — at the centre of all design decisions. DDD provides a vocabulary and a set of patterns that help translate business complexity into code structure, and it is the primary tool for identifying the right boundaries between microservices.

DDD works at two levels:

| Level | Question it answers | Tools |
|---|---|---|
| **Strategic design** | *Where are the boundaries?* How does the business split into parts, and how do the parts relate? | Subdomains, ubiquitous language, bounded contexts, context maps, Event Storming |
| **Tactical design** | *What goes inside one boundary?* How is the model written in code? | Entities, value objects, aggregates, repositories, domain events, domain services |

Strategic design decides the **microservices**; tactical design shapes the **code inside each one**.

---

## Subdomains: where to invest

The **domain** of the store is online retail. It splits into **subdomains**, and not all of them deserve the same effort[^2]:

| Kind | Meaning | In the store |
|---|---|---|
| **Core** | What makes the business different; worth the best people and custom code | Ordering, pricing, the catalogue experience |
| **Supporting** | Needed and specific to the business, but not a differentiator | Notifications, currency display |
| **Generic** | Solved problems, the same for every company | Authentication, payments, e-mail delivery |

Generic subdomains are candidates to **buy or reuse** (an identity provider such as Keycloak, a payment provider). The course builds its own auth service to learn how it works, but a real store would usually not.

---

## Ubiquitous Language

The single most important DDD practice is establishing a **Ubiquitous Language**: a shared vocabulary used consistently by both developers and domain experts in conversations, documentation, and code.

Without a ubiquitous language, the same concept gets different names in different layers:

- Business calls it a *Customer*, the database has a `USER` table, the code has a `Person` class.
- Each translation is a place where understanding can diverge.

With ubiquitous language, the code reads like the business speaks:

```java
// Without ubiquitous language
public class Person {
    private String userHandle;
    public void changeUserHandle(String newHandle) { ... }
}

// With ubiquitous language (domain uses "Account" and "username")
public class Account {
    private String username;
    public void changeUsername(String newUsername) { ... }
}
```

The hands-on follows this: the business talks about **accounts**, so the service is `account-service`, the resource is `/accounts`, and the classes are `AccountIn`, `AccountOut` and `AccountService` ([Hands-on 1](../../../hands-on/1/index.md)).

---

## Bounded Context

A **Bounded Context** is the boundary within which a particular model is defined and applicable. The same word can mean different things in different contexts — and that is fine, as long as each context has a clear boundary.

``` mermaid-sim
flowchart LR
  subgraph Sales ["Bounded Context: Sales"]
    c1[Customer\n- name\n- creditLimit\n- salesRegion]
  end
  subgraph Support ["Bounded Context: Support"]
    c2[Customer\n- name\n- ticketHistory\n- supportTier]
  end
  subgraph Billing ["Bounded Context: Billing"]
    c3[Customer\n- name\n- taxId\n- billingAddress]
  end
```

Each bounded context has its own model of `Customer`. Trying to build one unified `Customer` class that satisfies all three leads to a bloated object that satisfies none of them well.

!!! example "The word “product” in the store"
    In the **Catalogue** context, a product has a name, a current price and a unit, and its price can change any day. In the **Ordering** context, what matters is the product *as it was sold*: its id, the quantity and the total paid. That is why, in the [Order API](../../../exercises/order/index.md), each order item stores its own `total` and only the product's `id`: if the catalogue price changes tomorrow, yesterday's order must not change. Same word, two models, two services.

**In microservices, a bounded context typically maps to one microservice** (or a small cluster of closely related services). This is why DDD is the primary tool for microservice decomposition — the bounded context gives you the natural seam.

---

## Context maps: how contexts relate

Bounded contexts are not islands; they exchange data. A **context map** draws the contexts and names the relationship between each pair[^3]. In every relationship one side is **upstream** (its model influences the other) and the other is **downstream** (it depends on the upstream model).

| Pattern | Meaning | Use when |
|---|---|---|
| **Customer / Supplier** | The downstream team's needs are taken into account in the upstream team's plans | Two teams in the same company that talk to each other |
| **Open Host Service** + **Published Language** | The upstream exposes a well-defined, documented API (e.g. REST + JSON described in OpenAPI) for any consumer | One provider, many consumers |
| **Conformist** | The downstream simply adopts the upstream model as is | The upstream model is good enough, or you have no influence over it |
| **Anti-Corruption Layer (ACL)** | The downstream writes a translation layer so that the upstream model does not leak into its own | The upstream is a legacy or third-party system with a model you do not want |
| **Shared Kernel** | Two contexts share a small part of the model (and its code), changed only by agreement | Two closely cooperating teams; use sparingly — it couples them |

The store's context map:

``` mermaid-sim
flowchart LR
    product["Catalogue (product)"] -->|"Open Host Service: REST + JSON"| order["Ordering (order)"]
    account["Accounts (account)"] -->|"Conformist: AccountOut"| auth["Identity (auth)"]
    rates["Third-party rates API"] -->|"Anti-Corruption Layer"| exchange["Currency (exchange)"]
    exchange -->|"Open Host Service: REST"| order
    order -->|"event OrderCreated"| notification["Notification"]
```

- **Catalogue → Ordering**: the product service publishes its API (an Open Host Service, documented with [OpenAPI](../../api/swagger/index.md)); the order service consumes it.
- **Accounts → Identity**: the auth service reuses `AccountIn` / `AccountOut` from the `account` module exactly as they are — a conformist relationship.
- **Third-party rates → Currency**: the exchange service must not let the provider's JSON format spread through its code. It translates it at the border:

```python title="exchange-service: anti-corruption layer (illustrative)"
def get_rate(source: str, target: str) -> Rate:
    # the provider's model, e.g. {"base": "USD", "rates": {"BRL": 5.43}, "date": "..."}
    raw = provider.latest(base=source)
    # our model: one Rate value object, in our own vocabulary
    return Rate(source=source, target=target, value=Decimal(str(raw["rates"][target])))
```

If the provider changes its format, or is replaced, only this function changes.

---

## Building blocks

The tactical patterns, illustrated with the Ordering context.

### Entities

Objects with a **distinct identity** that persists over time and across different representations. Two entities are the same if they have the same identity, regardless of whether their attributes differ.

```java
public class Order {
    private final OrderId id;  // identity
    private OrderStatus status;
    private List<OrderItem> items;

    // Two Orders with the same id are the same Order,
    // even if their status differs.
}
```

### Value Objects

Objects defined entirely by their **attributes** — they have no identity. Two value objects with the same attributes are interchangeable.

```java
public record Money(BigDecimal amount, Currency currency) {
    // No id field. Two Money(10.00, BRL) objects are equal and interchangeable.
    public Money add(Money other) {
        if (!this.currency.equals(other.currency))
            throw new CurrencyMismatchException();
        return new Money(this.amount.add(other.amount), this.currency);
    }

    public Money multiply(int quantity) {
        return new Money(this.amount.multiply(BigDecimal.valueOf(quantity)), this.currency);
    }
}
```

Value objects should be **immutable**. Operations return new instances rather than mutating state. Java `record`s are a natural fit: fields are final and `equals`/`hashCode` compare the attributes.

### Aggregates

An **Aggregate** is a cluster of entities and value objects treated as a single unit for data changes. Every aggregate has one **Aggregate Root** — the only entry point for modifications.

``` mermaid-sim
flowchart TB
  subgraph Order [Aggregate: Order]
    root[Order\n«root»]
    item1[OrderItem]
    item2[OrderItem]
    addr[ShippingAddress\n«value object»]
    root --> item1
    root --> item2
    root --> addr
  end
```

Rules:

- External code holds references only to the **root**, never to internal entities.
- All invariants are enforced by the root. Example: "an order cannot have more than 50 items" is checked inside `Order.addItem()`.
- Aggregates are the unit of persistence — save and load the whole aggregate together.
- **Reference other aggregates by identity only.** An `OrderItem` keeps the product's id, not a `Product` object; the order keeps the account id, not an `Account`. Otherwise one aggregate could change another, and the two could never live in different services.
- **One transaction changes one aggregate.** If a use case must change two aggregates, the second change happens afterwards, triggered by a domain event (eventual consistency).

An **invariant** is a rule that must always hold for the aggregate to be valid. The root is where it is checked:

```java
public class Order {                                  // aggregate root
    private static final int MAX_ITEMS = 50;

    private final OrderId id;
    private final AccountId accountId;                // other aggregate: by id only
    private final List<OrderItem> items = new ArrayList<>();
    private Money total = new Money(BigDecimal.ZERO, Currency.getInstance("USD"));

    public void addItem(ProductId productId, int quantity, Money unitPrice) {
        if (quantity <= 0)
            throw new IllegalArgumentException("quantity must be positive");
        if (items.size() >= MAX_ITEMS)
            throw new IllegalStateException("an order has at most " + MAX_ITEMS + " items");
        OrderItem item = new OrderItem(productId, quantity, unitPrice.multiply(quantity));
        items.add(item);
        total = total.add(item.total());              // invariant: total = sum of items
    }

    public List<OrderItem> items() {
        return List.copyOf(items);                    // callers cannot bypass the root
    }
}
```

### Repositories

A **Repository** provides a collection-like interface for retrieving and persisting aggregates. Repositories hide all database details from the domain model.

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    List<Order> findByCustomer(CustomerId customerId);
    Order save(Order order);
}
```

The domain declares the interface; the infrastructure provides the implementation (JPA, MongoDB, in-memory). In the hands-on, `AccountRepository extends CrudRepository<AccountModel, String>` is such an interface, and Spring Data generates the implementation. There is **one repository per aggregate root** — there is no `OrderItemRepository`, because items are only saved through their order.

### Domain Events

A **Domain Event** is a record of something that happened in the domain — past tense, immutable. Events are the primary mechanism for decoupling bounded contexts.

```java
public record OrderPlaced(
    OrderId orderId,
    CustomerId customerId,
    Instant occurredAt
) {}
```

When the `Order` aggregate is placed, it raises `OrderPlaced`. Other bounded contexts (Inventory, Billing, Notifications) subscribe to this event and react independently — without the Order context knowing who is listening. In [Hands-on 9](../../../hands-on/9/index.md) this is the `OrderCreated` event that the order service publishes to the Kafka topic `order-events` and the notification service consumes.

### Domain Services

Operations that **don't naturally belong** to any entity or value object — typically involving multiple aggregates or requiring external information.

```java
// Neither Order nor Customer "owns" this logic — it needs both
public class PricingService {
    public Money calculateTotal(Order order, CustomerDiscount discount) { ... }
}
```

---

## Using DDD to find microservice boundaries

**Event Storming** (Alberto Brandolini)[^4] is the most effective technique for discovering bounded contexts collaboratively. Domain experts and developers gather in front of a wall of sticky notes and map out the entire domain on a shared timeline.

``` mermaid-sim
flowchart LR
    ev1["🟠 OrderPlaced\n(domain event)"]
    ev2["🟠 PaymentCharged"]
    ev3["🟠 InventoryReserved"]
    ev4["🟠 OrderShipped"]
    cmd1["🔵 Place Order\n(command)"]
    cmd2["🔵 Charge Card"]
    cmd3["🔵 Reserve Items"]

    cmd1 --> ev1 --> cmd2 & cmd3
    cmd2 --> ev2
    cmd3 --> ev3
    ev2 & ev3 --> ev4
```

The process:

1. **Identify domain events** (orange) — things that happened, past tense: *OrderPlaced*, *PaymentFailed*, *ItemShipped*
2. **Add commands** (blue) — what triggered each event: *Place Order*, *Charge Card*
3. **Group by bounded context** — cluster events and commands that belong together under the same ubiquitous language
4. **Draw context maps** — identify how contexts interact: shared kernel, customer/supplier relationship, or anti-corruption layer (see [Context maps](#context-maps-how-contexts-relate))
5. **One context → one service** as a starting point; merge or split based on operational and team constraints

!!! tip "Bounded context ≠ microservice (always)"
    A bounded context is a conceptual boundary. In practice, a small team might implement two related bounded contexts in one service to avoid the operational overhead of a separate deployment. Only split when independence of deployment or scale becomes valuable.

!!! warning "Common DDD mistakes"
    - **Entity services**: one service per table or noun (`OrderItemService`, `AddressService`). They have no behaviour of their own and must always be called together.
    - **Anemic domain model**: entities with only getters and setters, and every rule in a service class. Nothing protects the invariants; put the rule in the aggregate root.
    - **One giant model**: a single `Customer`/`Product` class shared by every service through a common library — every change forces every service to redeploy.
    - **Aggregates that are too big**: an `Account` aggregate that contains all its orders. Loading an account loads thousands of orders, and two users editing different orders conflict. Keep aggregates small; link by id.

---

## Key takeaways

- **Strategic DDD** finds the boundaries (subdomains, bounded contexts, context maps); **tactical DDD** shapes the code inside each one.
- A **ubiquitous language** keeps business, code and API using the same words (`Account`, `/accounts`).
- A **bounded context** is where one model is valid — the natural candidate for a microservice.
- **Context maps** name the relationships; an **anti-corruption layer** keeps a third-party model out of your code.
- **Aggregates** protect invariants through their root, reference other aggregates by id, and change in one transaction each.
- **Domain events** (past tense) let other contexts react without the producer knowing them.

## Connections

- Why boundaries matter: [Microservices](../index.md). The infrastructure around them: [Architecture & Components](../architecture/index.md).
- Keeping the domain independent of frameworks inside a service: [Clean Architecture](../../architectures/clean/index.md) and [Hexagonal Architecture](../../architectures/hexagonal/index.md).
- Domain events on a broker: [Event-Driven Architecture](../../event_driven/index.md), [Hands-on 9 — Kafka](../../../hands-on/9/index.md).
- Model your own contexts: [Product API](../../../exercises/product/index.md), [Order API](../../../exercises/order/index.md), [Exchange API](../../../exercises/exchange/index.md).

---

[^1]: EVANS, E. *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley, 2003.
[^2]: VERNON, V. *Implementing Domain-Driven Design*. Addison-Wesley, 2013.
[^3]: [Domain-Driven Design Reference](https://domainlanguage.com/ddd/reference/){target="_blank"} — Eric Evans's condensed reference card.
[^4]: BRANDOLINI, A. [Introducing Event Storming](https://www.eventstorming.com){target="_blank"}. eventstorming.com.
