
Você decidiu dividir a loja em serviços. Onde cortar? Por tabela do banco de dados (`products`, `orders`, `order_items`)? Por camada (um serviço para a UI, outro para a lógica)? Pelo que os times estiverem fazendo neste mês? Cada uma dessas opções produz serviços que precisam mudar juntos e se chamam o tempo todo — um monólito distribuído. Você precisa de uma forma de encontrar os pontos em que o **próprio negócio** tem uma divisão natural. É isso que o Domain-Driven Design oferece.

O [Domain-Driven Design (DDD)](https://en.wikipedia.org/wiki/Domain-driven_design){target="_blank"} é uma abordagem de desenvolvimento de software apresentada por Eric Evans[^1] que coloca o **domínio** — a área específica do negócio que o software apoia — no centro de todas as decisões de projeto. O DDD oferece um vocabulário e um conjunto de padrões que ajudam a traduzir a complexidade do negócio em estrutura de código, e é a principal ferramenta para identificar as fronteiras certas entre microsserviços.

O DDD atua em dois níveis:

| Nível | Pergunta que responde | Ferramentas |
|---|---|---|
| **Design estratégico** | *Onde ficam as fronteiras?* Como o negócio se divide em partes, e como as partes se relacionam? | Subdomínios, linguagem ubíqua, bounded contexts, mapas de contexto, Event Storming |
| **Design tático** | *O que vai dentro de uma fronteira?* Como o modelo é escrito em código? | Entidades, objetos de valor, agregados, repositórios, eventos de domínio, serviços de domínio |

O design estratégico decide os **microsserviços**; o design tático dá forma ao **código dentro de cada um**.

---

## Subdomínios: onde investir

O **domínio** da loja é o varejo online. Ele se divide em **subdomínios**, e nem todos merecem o mesmo esforço[^2]:

| Tipo | Significado | Na loja |
|---|---|---|
| **Core** (principal) | O que diferencia o negócio; vale as melhores pessoas e código sob medida | Pedidos, precificação, a experiência do catálogo |
| **Supporting** (de suporte) | Necessário e específico do negócio, mas não é um diferencial | Notificações, exibição de moedas |
| **Generic** (genérico) | Problemas já resolvidos, iguais para todas as empresas | Autenticação, pagamentos, envio de e-mails |

Subdomínios genéricos são candidatos a **comprar ou reutilizar** (um provedor de identidade como o Keycloak, um provedor de pagamentos). O curso constrói o próprio serviço de autenticação para aprender como ele funciona, mas uma loja real normalmente não faria isso.

---

## Linguagem ubíqua

A prática mais importante do DDD é estabelecer uma **Linguagem Ubíqua** (*Ubiquitous Language*): um vocabulário compartilhado, usado de forma consistente por desenvolvedores e especialistas do domínio em conversas, na documentação e no código.

Sem uma linguagem ubíqua, o mesmo conceito ganha nomes diferentes em camadas diferentes:

- O negócio fala em *Customer*, o banco de dados tem uma tabela `USER`, o código tem uma classe `Person`.
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

O hands-on segue essa ideia: o negócio fala em **contas** (*accounts*), então o serviço é `account-service`, o recurso é `/accounts` e as classes são `AccountIn`, `AccountOut` e `AccountService` ([Hands-on 1](../../../hands-on/1/index.md)).

---

## Bounded Context

Um **Bounded Context** (contexto delimitado) é a fronteira dentro da qual um determinado modelo é definido e aplicável. A mesma palavra pode significar coisas diferentes em contextos diferentes — e tudo bem, desde que cada contexto tenha uma fronteira clara.

``` mermaid-sim
flowchart LR
  subgraph Sales ["Bounded Context: Vendas"]
    c1[Customer\n- name\n- creditLimit\n- salesRegion]
  end
  subgraph Support ["Bounded Context: Suporte"]
    c2[Customer\n- name\n- ticketHistory\n- supportTier]
  end
  subgraph Billing ["Bounded Context: Faturamento"]
    c3[Customer\n- name\n- taxId\n- billingAddress]
  end
```

Cada bounded context tem o seu próprio modelo de `Customer`. Tentar construir uma única classe `Customer` unificada que atenda aos três leva a um objeto inchado que não atende bem a nenhum deles.

!!! example "A palavra “produto” na loja"
    No contexto de **Catálogo**, um produto tem nome, preço atual e unidade, e o preço pode mudar a qualquer dia. No contexto de **Pedidos**, o que importa é o produto *como foi vendido*: o seu id, a quantidade e o total pago. É por isso que, na [Order API](../../../exercises/order/index.md), cada item de pedido guarda o seu próprio `total` e apenas o `id` do produto: se o preço no catálogo mudar amanhã, o pedido de ontem não pode mudar. A mesma palavra, dois modelos, dois serviços.

**Em microsserviços, um bounded context normalmente corresponde a um microsserviço** (ou a um pequeno grupo de serviços muito relacionados). É por isso que o DDD é a principal ferramenta para decompor microsserviços — o bounded context dá a divisão natural.

---

## Mapas de contexto: como os contextos se relacionam { #context-maps-how-contexts-relate }

Bounded contexts não são ilhas; eles trocam dados. Um **mapa de contexto** (*context map*) desenha os contextos e dá nome à relação entre cada par[^3]. Em toda relação, um lado é **upstream** (o seu modelo influencia o outro) e o outro é **downstream** (depende do modelo upstream).

| Padrão | Significado | Use quando |
|---|---|---|
| **Customer / Supplier** | As necessidades do time downstream são levadas em conta nos planos do time upstream | Dois times da mesma empresa que conversam entre si |
| **Open Host Service** + **Published Language** | O upstream expõe uma API bem definida e documentada (por exemplo, REST + JSON descrito em OpenAPI) para qualquer consumidor | Um provedor, muitos consumidores |
| **Conformist** | O downstream simplesmente adota o modelo upstream como está | O modelo upstream é bom o suficiente, ou você não tem influência sobre ele |
| **Anti-Corruption Layer (ACL)** | O downstream escreve uma camada de tradução para que o modelo upstream não vaze para o seu | O upstream é um sistema legado ou de terceiros, com um modelo que você não quer |
| **Shared Kernel** | Dois contextos compartilham uma pequena parte do modelo (e o seu código), alterada apenas em comum acordo | Dois times que cooperam de perto; use com moderação — isso os acopla |

O mapa de contexto da loja:

``` mermaid-sim
flowchart LR
    product["Catálogo (product)"] -->|"Open Host Service: REST + JSON"| order["Pedidos (order)"]
    account["Contas (account)"] -->|"Conformist: AccountOut"| auth["Identidade (auth)"]
    rates["API de cotações de terceiros"] -->|"Anti-Corruption Layer"| exchange["Câmbio (exchange)"]
    exchange -->|"Open Host Service: REST"| order
    order -->|"evento OrderCreated"| notification["Notificação"]
```

- **Catálogo → Pedidos**: o serviço de produtos publica a sua API (um Open Host Service, documentado com [OpenAPI](../../api/swagger/index.md)); o serviço de pedidos a consome.
- **Contas → Identidade**: o serviço de autenticação reutiliza `AccountIn` / `AccountOut` do módulo `account` exatamente como estão — uma relação conformista.
- **Cotações de terceiros → Câmbio**: o serviço de câmbio não pode deixar o formato JSON do provedor se espalhar pelo seu código. Ele o traduz na fronteira:

```python title="exchange-service: anti-corruption layer (illustrative)"
def get_rate(source: str, target: str) -> Rate:
    # the provider's model, e.g. {"base": "USD", "rates": {"BRL": 5.43}, "date": "..."}
    raw = provider.latest(base=source)
    # our model: one Rate value object, in our own vocabulary
    return Rate(source=source, target=target, value=Decimal(str(raw["rates"][target])))
```

Se o provedor mudar o formato, ou for substituído, só esta função muda.

---

## Blocos de construção

Os padrões táticos, ilustrados com o contexto de Pedidos.

### Entidades

Objetos com uma **identidade própria**, que persiste ao longo do tempo e entre diferentes representações. Duas entidades são a mesma se têm a mesma identidade, independentemente de os seus atributos serem diferentes.

```java
public class Order {
    private final OrderId id;  // identity
    private OrderStatus status;
    private List<OrderItem> items;

    // Two Orders with the same id are the same Order,
    // even if their status differs.
}
```

### Objetos de valor

Objetos definidos inteiramente pelos seus **atributos** — eles não têm identidade. Dois objetos de valor (*value objects*) com os mesmos atributos são intercambiáveis.

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

Objetos de valor devem ser **imutáveis**. As operações retornam novas instâncias em vez de alterar o estado. Os `record`s do Java se encaixam naturalmente: os campos são finais e `equals`/`hashCode` comparam os atributos.

### Agregados

Um **Agregado** (*Aggregate*) é um grupo de entidades e objetos de valor tratado como uma única unidade para alterações de dados. Todo agregado tem uma **Raiz do Agregado** (*Aggregate Root*) — o único ponto de entrada para modificações.

``` mermaid-sim
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

- O código externo guarda referências apenas para a **raiz**, nunca para as entidades internas.
- Todas as invariantes são garantidas pela raiz. Exemplo: "um pedido não pode ter mais de 50 itens" é verificado dentro de `Order.addItem()`.
- Agregados são a unidade de persistência — salve e carregue o agregado inteiro de uma vez.
- **Referencie outros agregados apenas pela identidade.** Um `OrderItem` guarda o id do produto, não um objeto `Product`; o pedido guarda o id da conta, não um `Account`. Caso contrário, um agregado poderia alterar outro, e os dois nunca poderiam viver em serviços diferentes.
- **Uma transação altera um agregado.** Se um caso de uso precisa alterar dois agregados, a segunda alteração acontece depois, disparada por um evento de domínio (consistência eventual).

Uma **invariante** é uma regra que precisa ser sempre verdadeira para que o agregado seja válido. A raiz é onde ela é verificada:

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

### Repositórios

Um **Repositório** (*Repository*) oferece uma interface semelhante a uma coleção para buscar e persistir agregados. Os repositórios escondem todos os detalhes do banco de dados do modelo de domínio.

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    List<Order> findByCustomer(CustomerId customerId);
    Order save(Order order);
}
```

O domínio declara a interface; a infraestrutura fornece a implementação (JPA, MongoDB, em memória). No hands-on, `AccountRepository extends CrudRepository<AccountModel, String>` é uma interface desse tipo, e o Spring Data gera a implementação. Existe **um repositório por raiz de agregado** — não existe `OrderItemRepository`, porque os itens só são salvos por meio do seu pedido.

### Eventos de domínio

Um **Evento de Domínio** (*Domain Event*) é o registro de algo que aconteceu no domínio — no passado, imutável. Eventos são o principal mecanismo para desacoplar bounded contexts.

```java
public record OrderPlaced(
    OrderId orderId,
    CustomerId customerId,
    Instant occurredAt
) {}
```

Quando o agregado `Order` é efetivado, ele emite `OrderPlaced`. Outros bounded contexts (Estoque, Faturamento, Notificações) assinam esse evento e reagem de forma independente — sem que o contexto de Pedidos saiba quem está ouvindo. No [Hands-on 9](../../../hands-on/9/index.md), esse é o evento `OrderCreated` que o serviço de pedidos publica no tópico Kafka `order-events` e que o serviço de notificação consome.

### Serviços de domínio

Operações que **não pertencem naturalmente** a nenhuma entidade ou objeto de valor — em geral, envolvem vários agregados ou exigem informações externas.

```java
// Neither Order nor Customer "owns" this logic — it needs both
public class PricingService {
    public Money calculateTotal(Order order, CustomerDiscount discount) { ... }
}
```

---

## Usando DDD para encontrar as fronteiras dos microsserviços

O **Event Storming** (Alberto Brandolini)[^4] é a técnica mais eficaz para descobrir bounded contexts de forma colaborativa. Especialistas do domínio e desenvolvedores se reúnem diante de uma parede de post-its e mapeiam todo o domínio em uma linha do tempo compartilhada.

``` mermaid-sim
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
2. **Adicione os comandos** (azul) — o que disparou cada evento: *Fazer pedido*, *Cobrar cartão*
3. **Agrupe por bounded context** — junte eventos e comandos que pertencem à mesma linguagem ubíqua
4. **Desenhe os mapas de contexto** — identifique como os contextos interagem: shared kernel, relação customer/supplier ou anti-corruption layer (veja [Mapas de contexto](#context-maps-how-contexts-relate))
5. **Um contexto → um serviço** como ponto de partida; junte ou divida com base em restrições operacionais e de time

!!! tip "Bounded context ≠ microsserviço (sempre)"
    Um bounded context é uma fronteira conceitual. Na prática, um time pequeno pode implementar dois bounded contexts relacionados em um único serviço para evitar o custo operacional de um deploy separado. Só divida quando a independência de deploy ou de escala passar a ter valor.

!!! warning "Erros comuns de DDD"
    - **Serviços de entidade**: um serviço por tabela ou substantivo (`OrderItemService`, `AddressService`). Eles não têm comportamento próprio e precisam sempre ser chamados juntos.
    - **Modelo de domínio anêmico**: entidades só com getters e setters, e todas as regras em uma classe de serviço. Nada protege as invariantes; coloque a regra na raiz do agregado.
    - **Um modelo gigante**: uma única classe `Customer`/`Product` compartilhada por todos os serviços por meio de uma biblioteca comum — toda mudança obriga todos os serviços a um novo deploy.
    - **Agregados grandes demais**: um agregado `Account` que contém todos os seus pedidos. Carregar uma conta carrega milhares de pedidos, e dois usuários editando pedidos diferentes entram em conflito. Mantenha os agregados pequenos; ligue-os pelo id.

---

## Pontos-chave

- O **DDD estratégico** encontra as fronteiras (subdomínios, bounded contexts, mapas de contexto); o **DDD tático** dá forma ao código dentro de cada uma.
- Uma **linguagem ubíqua** faz com que negócio, código e API usem as mesmas palavras (`Account`, `/accounts`).
- Um **bounded context** é onde um modelo é válido — o candidato natural a um microsserviço.
- Os **mapas de contexto** dão nome às relações; uma **anti-corruption layer** mantém o modelo de um terceiro fora do seu código.
- Os **agregados** protegem as invariantes por meio da raiz, referenciam outros agregados pelo id e são alterados em uma transação cada.
- Os **eventos de domínio** (no passado) permitem que outros contextos reajam sem que o produtor os conheça.

## Conexões

- Por que as fronteiras importam: [Microsserviços](../index.md). A infraestrutura ao redor delas: [Arquitetura e componentes](../architecture/index.md).
- Mantendo o domínio independente de frameworks dentro de um serviço: [Clean Architecture](../../architectures/clean/index.md) e [Arquitetura Hexagonal](../../architectures/hexagonal/index.md).
- Eventos de domínio em um broker: [Arquitetura orientada a eventos](../../event_driven/index.md), [Hands-on 9 — Kafka](../../../hands-on/9/index.md).
- Modele os seus próprios contextos: [Product API](../../../exercises/product/index.md), [Order API](../../../exercises/order/index.md), [Exchange API](../../../exercises/exchange/index.md).

---

[^1]: EVANS, E. *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley, 2003.
[^2]: VERNON, V. *Implementing Domain-Driven Design*. Addison-Wesley, 2013.
[^3]: [Domain-Driven Design Reference](https://domainlanguage.com/ddd/reference/){target="_blank"} — cartão de referência condensado de Eric Evans.
[^4]: BRANDOLINI, A. [Introducing Event Storming](https://www.eventstorming.com){target="_blank"}. eventstorming.com.
