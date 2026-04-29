
[Domain-Driven Design (DDD)](https://en.wikipedia.org/wiki/Domain-driven_design){target="_blank"} is a software development approach introduced by Eric Evans[^1] that places the **domain** — the specific area of business the software supports — at the centre of all design decisions. DDD provides a vocabulary and a set of patterns that help translate business complexity into code structure, and it is the primary tool for identifying the right boundaries between microservices.

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

---

## Bounded Context

A **Bounded Context** is the boundary within which a particular model is defined and applicable. The same word can mean different things in different contexts — and that is fine, as long as each context has a clear boundary.

``` mermaid
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

**In microservices, a bounded context typically maps to one microservice** (or a small cluster of closely related services). This is why DDD is the primary tool for microservice decomposition — the bounded context gives you the natural seam.

---

## Building blocks

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
}
```

Value objects should be **immutable**. Operations return new instances rather than mutating state.

### Aggregates

An **Aggregate** is a cluster of entities and value objects treated as a single unit for data changes. Every aggregate has one **Aggregate Root** — the only entry point for modifications.

``` mermaid
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

### Repositories

A **Repository** provides a collection-like interface for retrieving and persisting aggregates. Repositories hide all database details from the domain model.

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    List<Order> findByCustomer(CustomerId customerId);
    Order save(Order order);
}
```

The domain declares the interface; the infrastructure provides the implementation (JPA, MongoDB, in-memory).

### Domain Events

A **Domain Event** is a record of something that happened in the domain — past tense, immutable. Events are the primary mechanism for decoupling bounded contexts.

```java
public record OrderPlaced(
    OrderId orderId,
    CustomerId customerId,
    Instant occurredAt
) {}
```

When the `Order` aggregate is placed, it raises `OrderPlaced`. Other bounded contexts (Inventory, Billing, Notifications) subscribe to this event and react independently — without the Order context knowing who is listening.

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

1. **Event storming**: gather domain experts and developers; identify all domain events on a timeline.
2. **Group by bounded context**: cluster events, commands, and aggregates that belong together.
3. **Name each context**: the names should come from the ubiquitous language.
4. **Draw context maps**: identify how contexts interact — shared kernel, customer/supplier, anti-corruption layer.
5. **One context → one service** (as a starting point; merge or split based on operational and team constraints).

---

[^1]: EVANS, E. *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley, 2003.
[^2]: VERNON, V. *Implementing Domain-Driven Design*. Addison-Wesley, 2013.
[^3]: [Domain-Driven Design Reference](https://domainlanguage.com/ddd/reference/){target="_blank"} — Eric Evans's condensed reference card.
