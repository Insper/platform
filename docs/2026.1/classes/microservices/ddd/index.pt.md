
O [Domain-Driven Design (DDD)](https://en.wikipedia.org/wiki/Domain-driven_design){target="_blank"} é uma abordagem de desenvolvimento de software apresentada por Eric Evans[^1] que coloca o **domínio** — a área específica de negócio que o software apoia — no centro de todas as decisões de projeto. O DDD oferece um vocabulário e um conjunto de padrões que ajudam a traduzir a complexidade do negócio em estrutura de código, e é a principal ferramenta para identificar as fronteiras certas entre microsserviços.

---

## Linguagem ubíqua

A prática mais importante do DDD é estabelecer uma **Linguagem Ubíqua** (Ubiquitous Language): um vocabulário compartilhado, usado de forma consistente por desenvolvedores e especialistas do domínio nas conversas, na documentação e no código.

Sem uma linguagem ubíqua, o mesmo conceito recebe nomes diferentes em camadas diferentes:
- O negócio o chama de *Cliente*, o banco de dados tem uma tabela `USER`, o código tem uma classe `Person`.
- Cada tradução é um ponto em que o entendimento pode divergir.

Com a linguagem ubíqua, o código se lê do jeito que o negócio fala:

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

## Contexto delimitado (Bounded Context)

Um **Contexto Delimitado** (Bounded Context) é a fronteira dentro da qual um determinado modelo é definido e aplicável. A mesma palavra pode significar coisas diferentes em contextos diferentes — e tudo bem, desde que cada contexto tenha uma fronteira clara.

``` mermaid
flowchart LR
  subgraph Sales ["Contexto delimitado: Vendas"]
    c1[Customer\n- name\n- creditLimit\n- salesRegion]
  end
  subgraph Support ["Contexto delimitado: Suporte"]
    c2[Customer\n- name\n- ticketHistory\n- supportTier]
  end
  subgraph Billing ["Contexto delimitado: Faturamento"]
    c3[Customer\n- name\n- taxId\n- billingAddress]
  end
```

Cada contexto delimitado tem seu próprio modelo de `Customer`. Tentar construir uma única classe `Customer` unificada que atenda aos três leva a um objeto inchado que não atende bem a nenhum deles.

**Em microsserviços, um contexto delimitado normalmente corresponde a um microsserviço** (ou a um pequeno grupo de serviços intimamente relacionados). É por isso que o DDD é a principal ferramenta para a decomposição em microsserviços — o contexto delimitado indica o ponto natural de corte.

---

## Blocos de construção

### Entidades

Objetos com uma **identidade própria** que persiste ao longo do tempo e entre diferentes representações. Duas entidades são a mesma se tiverem a mesma identidade, ainda que seus atributos sejam diferentes.

```java
public class Order {
    private final OrderId id;  // identity
    private OrderStatus status;
    private List<OrderItem> items;

    // Two Orders with the same id are the same Order,
    // even if their status differs.
}
```

### Objetos de valor (Value Objects)

Objetos definidos inteiramente pelos seus **atributos** — eles não têm identidade. Dois objetos de valor com os mesmos atributos são intercambiáveis.

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

Objetos de valor devem ser **imutáveis**. As operações retornam novas instâncias em vez de alterar o estado.

### Agregados

Um **Agregado** (Aggregate) é um conjunto de entidades e objetos de valor tratado como uma única unidade para alterações de dados. Todo agregado tem uma **Raiz do Agregado** (Aggregate Root) — o único ponto de entrada para modificações.

``` mermaid
flowchart TB
  subgraph Order [Agregado: Order]
    root[Order\n«raiz»]
    item1[OrderItem]
    item2[OrderItem]
    addr[ShippingAddress\n«objeto de valor»]
    root --> item1
    root --> item2
    root --> addr
  end
```

Regras:
- O código externo mantém referências apenas para a **raiz**, nunca para as entidades internas.
- Todas as invariantes são garantidas pela raiz. Exemplo: "um pedido não pode ter mais de 50 itens" é verificado dentro de `Order.addItem()`.
- Os agregados são a unidade de persistência — salve e carregue o agregado inteiro de uma vez.

### Repositórios

Um **Repositório** (Repository) oferece uma interface semelhante a uma coleção para obter e persistir agregados. Os repositórios escondem do modelo de domínio todos os detalhes do banco de dados.

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    List<Order> findByCustomer(CustomerId customerId);
    Order save(Order order);
}
```

O domínio declara a interface; a infraestrutura fornece a implementação (JPA, MongoDB, em memória).

### Eventos de domínio

Um **Evento de Domínio** (Domain Event) é o registro de algo que aconteceu no domínio — no passado, imutável. Os eventos são o principal mecanismo para desacoplar contextos delimitados.

```java
public record OrderPlaced(
    OrderId orderId,
    CustomerId customerId,
    Instant occurredAt
) {}
```

Quando o agregado `Order` é efetivado, ele emite `OrderPlaced`. Outros contextos delimitados (Estoque, Faturamento, Notificações) assinam esse evento e reagem de forma independente — sem que o contexto de Pedidos saiba quem está ouvindo.

### Serviços de domínio

Operações que **não pertencem naturalmente** a nenhuma entidade ou objeto de valor — em geral envolvendo vários agregados ou exigindo informações externas.

```java
// Neither Order nor Customer "owns" this logic — it needs both
public class PricingService {
    public Money calculateTotal(Order order, CustomerDiscount discount) { ... }
}
```

---

## Usando o DDD para encontrar as fronteiras dos microsserviços

O **Event Storming** (Alberto Brandolini)[^4] é a técnica mais eficaz para descobrir contextos delimitados de forma colaborativa. Especialistas do domínio e desenvolvedores se reúnem diante de uma parede de post-its e mapeiam todo o domínio em uma linha do tempo compartilhada.

``` mermaid
flowchart LR
    ev1["🟠 OrderPlaced\n(evento de domínio)"]
    ev2["🟠 PaymentCharged"]
    ev3["🟠 InventoryReserved"]
    ev4["🟠 OrderShipped"]
    cmd1["🔵 Fazer pedido\n(comando)"]
    cmd2["🔵 Cobrar cartão"]
    cmd3["🔵 Reservar itens"]

    cmd1 --> ev1 --> cmd2 & cmd3
    cmd2 --> ev2
    cmd3 --> ev3
    ev2 & ev3 --> ev4
```

O processo:

1. **Identifique os eventos de domínio** (laranja) — coisas que aconteceram, no passado: *OrderPlaced*, *PaymentFailed*, *ItemShipped*
2. **Acrescente os comandos** (azul) — o que disparou cada evento: *Fazer pedido*, *Cobrar cartão*
3. **Agrupe por contexto delimitado** — junte os eventos e comandos que pertencem à mesma linguagem ubíqua
4. **Desenhe mapas de contexto** — identifique como os contextos interagem: kernel compartilhado, relação cliente/fornecedor ou camada anticorrupção
5. **Um contexto → um serviço** como ponto de partida; junte ou divida conforme as restrições operacionais e dos times

!!! tip "Contexto delimitado ≠ microsserviço (sempre)"
    Um contexto delimitado é uma fronteira conceitual. Na prática, um time pequeno pode implementar dois contextos delimitados relacionados em um único serviço para evitar a sobrecarga operacional de um deploy separado. Só divida quando a independência de deploy ou de escala passar a ter valor.

---

[^1]: EVANS, E. *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley, 2003.
[^2]: VERNON, V. *Implementing Domain-Driven Design*. Addison-Wesley, 2013.
[^3]: [Domain-Driven Design Reference](https://domainlanguage.com/ddd/reference/){target="_blank"} — o cartão de referência condensado de Eric Evans.
[^4]: BRANDOLINI, A. [Introducing Event Storming](https://www.eventstorming.com){target="_blank"}. eventstorming.com.
