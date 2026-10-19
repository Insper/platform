A BoxOffice começou, como a maioria das empresas, como **uma única aplicação Spring Boot**: eventos, assentos, pedidos, pagamentos e e-mails em uma só base de código, um só banco PostgreSQL, um só `.jar` para fazer deploy. No primeiro ano isso era exatamente o certo. Então três coisas aconteceram ao mesmo tempo. Nos dias de abertura de vendas, só o mapa de assentos e o checkout ficavam sobrecarregados, mas a única forma de escalá-los era rodar mais cópias de *tudo*. Um bug no upload de imagens de locais derrubou o checkout junto. E quatro times passaram a dividir a mesma base de código: cada release exigia que todos concordassem com o mesmo dia.

Nada estava errado com o código. O **formato** do sistema já não combinava com a carga nem com a organização. Esta página trata de escolher esse formato: de que tamanho deve ser uma unidade de deploy, onde traçar as fronteiras entre serviços e como organizar o código *dentro* de um serviço para que ele sobreviva a anos de mudanças.

---

## O espectro: do monolito aos microsserviços

"Monolito ou microsserviços" não é uma escolha binária; é um espectro de quantas unidades com deploy independente o sistema tem e de quão fortemente suas fronteiras são impostas.

``` mermaid-sim
flowchart LR
    subgraph mono ["Monolito"]
        direction TB
        m1["uma aplicação<br/>catalog · inventory · order · payment"] --> mdb[("um banco de dados")]
    end
    subgraph modular ["Monolito modular"]
        direction TB
        mm["uma aplicação"] --- c1["módulo catalog"]
        mm --- c2["módulo inventory"]
        mm --- c3["módulo order"]
        c1 --> s1[("schema catalog")]
        c2 --> s2[("schema inventory")]
        c3 --> s3[("schema order")]
    end
    subgraph micro ["Microsserviços"]
        direction TB
        gw["gateway"] --> x1["catalog"]
        gw --> x2["inventory"]
        gw --> x3["order"]
        x1 --> d1[("banco catalog")]
        x2 --> d2[("banco inventory")]
        x3 --> d3[("banco order")]
    end
    mono --> modular --> micro
```

| Dimensão | Monolito | Monolito modular | Microsserviços |
|---|---|---|---|
| **Unidades de deploy** | 1 | 1 | muitas (uma por serviço) |
| **Fronteiras impostas por** | disciplina (muitas vezes nenhuma) | o build: módulos, visibilidade de pacotes, testes ArchUnit | a rede: um serviço só pode chamar a API do outro |
| **Chamadas entre partes** | em processo, nanossegundos | em processo, nanossegundos | rede, ~0,5–5 ms dentro de um datacenter, podem falhar |
| **Transações** | uma transação ACID sobre tudo | um banco, mas cada módulo é dono das suas tabelas | sem transação compartilhada: sagas, consistência eventual |
| **Escala** | a aplicação inteira | a aplicação inteira | cada serviço com seu próprio perfil |
| **Isolamento de falhas** | um vazamento de memória derruba tudo | um vazamento de memória derruba tudo | um serviço falha, os outros se degradam |
| **Autonomia dos times** | baixa acima de ~10 engenheiros | média: módulos separados, release compartilhado | alta: código, dados e cadência de release próprios |
| **Custo operacional** | o menor | baixo | alto: descoberta, tracing, CI/CD por serviço, on-call |

O **monolito modular** merece mais atenção do que costuma receber. Ele entrega o principal benefício dos microsserviços — fronteiras claras, cada módulo dono dos seus dados — sem pagar pela rede. Se um módulo depois precisar de escala independente ou de outro time, ele pode ser extraído ao longo de uma fronteira que já existe. A Shopify, por exemplo, descreveu publicamente sua escolha de modularizar um grande monolito Rails em vez de quebrá-lo em serviços[^7].

!!! tip "Monolito primeiro"
    A maioria dos sistemas de microsserviços bem-sucedidos começou como monolito: raramente você conhece as fronteiras certas no primeiro dia, e mover uma fronteira dentro de uma base de código é uma refatoração, enquanto movê-la entre serviços é uma migração[^2]. Comece com um monolito (modular); divida quando uma das forças abaixo se tornar real.

### Quando dividir compensa

Separe uma parte do sistema em um serviço próprio quando pelo menos uma destas forças for forte — e anote qual, porque ela diz *onde* cortar:

| Força | Exemplo na BoxOffice | Por que um serviço separado ajuda |
|---|---|---|
| **Perfil de escala diferente** | `catalog` é dominado por leituras (milhares de leituras por escrita), `inventory` tem escrita intensa durante a abertura de vendas | Escalar e ajustar cada um separadamente; cachear um agressivamente, proteger o outro |
| **Autonomia dos times** | o time de busca publica duas vezes por dia; o de pagamentos, uma vez por mês, após revisão | Releases independentes, sem "trem de release" |
| **Isolamento de falhas** | o `assistant` de IA pode ficar lento ou fora do ar sem bloquear a venda de ingressos | Uma falha fica dentro de uma fronteira (com timeouts e circuit breakers, veja [confiabilidade](../../reliability/index.md)) |
| **Escopo de segurança / compliance** | só `payment` fala com o provedor de pagamentos e guarda tokens do provedor | Escopo de auditoria menor (PCI DSS), políticas de rede mais restritas |
| **Tecnologia diferente** | `assistant` é Python + FastAPI + pgvector; o núcleo é Java | Cada serviço escolhe seu runtime; o contrato é HTTP ou eventos |

E os custos que você aceita ao dividir:

- **Toda chamada pode falhar ou ser lenta** ([sistemas distribuídos](../../distributed/index.md)): timeouts, retries e circuit breakers passam a ser obrigatórios.
- **Não há transações entre serviços**: "reservar o assento, criar o pedido, cobrar o cartão" vira uma saga com compensações ([mensageria](../../messaging/index.md)).
- **A disponibilidade se multiplica para baixo** em cadeias síncronas: três serviços a 99,9% em série dão ≈ 99,7%.
- **A operação se multiplica**: N pipelines, N dashboards, tracing distribuído para depurar uma única requisição ([observabilidade](../../observability/index.md)).

!!! warning "Sintomas de um monolito distribuído"
    Todos os custos dos microsserviços, nenhum dos benefícios:

    - Os serviços precisam ser **implantados juntos** porque uma mudança em um quebra os outros.
    - Dois serviços **leem e escrevem as mesmas tabelas**.
    - Uma requisição do usuário dispara uma **longa cadeia de chamadas síncronas**; se qualquer elo cai, tudo cai.
    - Uma biblioteca compartilhada de classes de domínio obriga todos os serviços a atualizar ao mesmo tempo.

**Quão pequeno é "micro"?** Não é um número de linhas. Um serviço tem o tamanho certo quando um time consegue ser dono dele de ponta a ponta, ele pode ir para produção sem coordenação com outros e corresponde a uma capacidade de negócio. Serviços pequenos demais ("nanosserviços", por exemplo, um por tabela) gastam mais tempo conversando entre si do que trabalhando.

---

## Encontrando fronteiras com Domain-Driven Design

Você decidiu dividir. Onde cortar? Por tabela do banco (`events`, `seats`, `orders`)? Por camada (um "serviço de UI", um "serviço de lógica")? Cada uma dessas opções produz serviços que precisam mudar juntos. O **Domain-Driven Design** (DDD)[^1] dá uma resposta melhor: corte onde o **próprio negócio** tem uma emenda.

O DDD atua em dois níveis:

| Nível | Pergunta | Ferramentas |
|---|---|---|
| **Design estratégico** | *Onde ficam as fronteiras?* | subdomínios, linguagem ubíqua, bounded contexts, context maps, Event Storming |
| **Design tático** | *O que vai dentro de uma fronteira?* | entidades, value objects, agregados, repositórios, eventos de domínio |

O design estratégico decide os **serviços**; o design tático molda o **código dentro de cada um**.

### Subdomínios: onde investir { #subdomains-where-to-invest }

Nem toda parte do negócio merece o mesmo esforço:

| Tipo | Significado | Na BoxOffice | Estratégia |
|---|---|---|---|
| **Core** | O que torna o negócio diferente | inventário de assentos e holds durante um flash sale, a sala de espera, precificação | construir, com as melhores pessoas |
| **Supporting** (de suporte) | Específico do negócio, mas não um diferencial | catálogo de eventos e locais, notificações, ajuste da busca | construir de forma simples, ou customizar um produto |
| **Generic** (genérico) | Problemas resolvidos, iguais para toda empresa | identidade/login, pagamentos com cartão, entrega de e-mail | **comprar ou reutilizar**: um provedor de identidade, um provedor de pagamentos, um provedor de e-mail |

Essa última linha é a razão de a BoxOffice ter um problema de [integrações externas](../integrations/index.md): ela deliberadamente *não* constrói seu próprio processamento de cartões nem seus servidores de e-mail.

### Linguagem ubíqua e bounded contexts

A **linguagem ubíqua** é o vocabulário compartilhado por desenvolvedores e especialistas do domínio e usado literalmente no código: se a equipe da bilheteria fala *hold*, *on-sale*, *mapa de assentos* e *alocação*, o código diz `Hold`, `OnSale`, `SeatMap` e `Allocation` — não `TempReservation` nem `Lock`.

Mas a mesma palavra muitas vezes significa coisas diferentes em partes diferentes do negócio. Um **bounded context** (contexto delimitado) é a fronteira dentro da qual vale um modelo, e um significado para cada palavra:

``` mermaid-sim
flowchart LR
    subgraph cat ["Contexto Catalog"]
        e1["Event<br/>artista · data · local · descrição · imagens"]
    end
    subgraph inv ["Contexto Inventory"]
        e2["Event<br/>mapa de assentos · setores · holds · capacidade"]
    end
    subgraph ord ["Contexto Order"]
        e3["Event (como vendido)<br/>id do evento · assento · preço pago · taxas"]
    end
    cat -. "mesma palavra,<br/>modelo diferente" .- inv
    inv -. "mesma palavra,<br/>modelo diferente" .- ord
```

Tentar construir uma única classe `Event` que sirva aos três — com imagens, mapa de assentos e preços históricos — produz um objeto inchado que não serve bem a nenhum e acopla três times. Em vez disso, cada contexto é dono do seu próprio modelo, e eles trocam **ids e eventos**. Note em especial o contexto Order: um pedido guarda o **preço pago**, não uma referência ao preço atual, porque se o catálogo mudar um preço amanhã, o pedido de ontem não pode mudar.

**Um bounded context normalmente corresponde a um serviço** (ou a um pequeno grupo de serviços muito relacionados). Essa é a principal heurística para fronteiras de serviços.

### Context maps: como os contextos se relacionam

Os contextos trocam dados, e a relação entre cada par é uma decisão de design. Um **context map** (mapa de contextos) desenha essas relações[^3]:

| Padrão | Significado | Use quando |
|---|---|---|
| **Customer / Supplier** | o time upstream planeja levando em conta as necessidades do time downstream | dois times da mesma empresa |
| **Open Host Service + Published Language** | o upstream publica uma API ou um schema de eventos documentado para qualquer consumidor | um provedor, muitos consumidores |
| **Conformist** | o downstream adota o modelo do upstream como está | o modelo do upstream é bom, ou você não tem influência sobre ele |
| **Anti-Corruption Layer (ACL)** | o downstream traduz o modelo do upstream na fronteira | um modelo de terceiros ou legado que você não quer que vaze para dentro |
| **Shared Kernel** | dois contextos compartilham um pequeno pedaço de modelo e código | raramente; acopla os dois times |

``` mermaid-sim
flowchart LR
    catalog["Catalog"] -->|"Open Host: REST + OpenAPI"| order["Order"]
    catalog -->|"Published Language:<br/>eventos EventPublished"| search["Search"]
    inventory["Inventory"] -->|"Customer / Supplier:<br/>API de hold e confirmação"| order
    order -->|"evento OrderConfirmed"| notification["Notification"]
    psp["Provedor de pagamentos"] -->|"Anti-Corruption Layer"| payment["Payment"]
    payment -->|"evento PaymentSucceeded"| order
    mail["Provedor de e-mail"] -->|"Anti-Corruption Layer"| notification
```

As duas **anti-corruption layers** são as que mais importam na prática: o modelo do provedor de pagamentos (seus "payment intents", seus nomes de status, seus códigos de erro) não pode se espalhar pela BoxOffice. O serviço `payment` o traduz para o modelo `Payment` da própria BoxOffice na fronteira — a página de [integrações](../integrations/index.md) mostra esse adaptador.

### Agregados: a unidade de consistência

Dentro de um contexto, um **agregado** é um conjunto de objetos alterados juntos como uma unidade, com uma **raiz** como único ponto de entrada. A raiz garante os **invariantes** — regras que precisam valer sempre. Duas regras fazem os agregados se encaixarem em microsserviços:

- **Referencie outros agregados apenas pelo id.** Um `Hold` guarda o `seatId` e o `fanId`, nunca um objeto `Fan`. É isso que permite que os dois vivam em serviços diferentes.
- **Uma transação altera um agregado.** Se um caso de uso precisa alterar dois agregados, a segunda alteração acontece depois, disparada por um evento de domínio (consistência eventual).

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

O invariante "um assento pertence a no máximo um hold ativo" abrange *todos* os holds de um evento, então não pode ser verificado dentro de um único objeto `Hold`; quem o garante é o banco de dados (uma restrição de unicidade em `(event_id, seat_id)` para holds ativos) — exatamente o tipo de decisão de que trata a [aula 6](../../databases/index.md).

!!! example "Event Storming em um parágrafo"
    Para encontrar os contextos junto com o negócio, coloque especialistas do domínio e engenheiros diante de uma parede e escreva cada **evento de domínio** em um post-it laranja, no passado: *EventPublished, SaleOpened, FanQueued, SeatsHeld, HoldExpired, PaymentSucceeded, OrderConfirmed, TicketIssued, TicketScanned*. Ordene-os no tempo, acrescente os comandos (azul) e os atores (amarelo) que os causam, e observe onde o vocabulário muda ou onde um grupo de pessoas passa o trabalho para outro. Essas emendas são seus bounded contexts candidatos[^6].

---

## A lei de Conway

> *"Qualquer organização que projeta um sistema produzirá um projeto cuja estrutura é uma cópia da estrutura de comunicação da organização."*
> — Melvin Conway, 1968[^4]

As fronteiras no código tendem a acompanhar as fronteiras entre os times, porque a comunicação *dentro* de um time é barata e a comunicação *entre* times é cara. O gráfico abaixo mostra a evolução da BoxOffice: à medida que os times se formam em torno de capacidades de negócio, a base de código se divide nas mesmas linhas.

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

Duas consequências práticas:

- **Se fronteiras e times discordam, os times vencem.** Um serviço com três times donos vira um gargalo de coordenação; três serviços de um único time tendem a se fundir de novo em um monolito distribuído.
- **A manobra inversa de Conway** (*inverse Conway maneuver*): desenhe os times primeiro — um time *stream-aligned* por capacidade de negócio, mais um time de *plataforma* que oferece deploy, observabilidade e bancos de dados como autosserviço — para que a arquitetura venha atrás[^5].

---

## Sendo dono dos dados

**Banco de dados por serviço** (*database per service*) significa que nenhum serviço lê ou escreve as tabelas de outro. Isso não exige um *servidor* de banco por serviço: um cluster PostgreSQL pode hospedar vários schemas, desde que cada schema tenha exatamente um dono.

``` mermaid-sim
flowchart LR
    order["order"] -->|"POST /holds/{id}/confirm"| inventory["inventory"]
    inventory --> inv[("schema inventory")]
    order --> ord[("schema order")]
    order -.-x|"sem SQL direto"| inv
```

Quando `order` precisa confirmar um hold, ele chama a **API** de `inventory`, nunca a **tabela** `holds`. Isso deixa o time de inventário livre para mudar seu schema, acrescentar um cache ou migrar para outro banco. Duas consequências decorrem disso:

- **Consultas entre serviços** viram chamadas de API — ou uma cópia local, somente leitura, dos dados do outro serviço, mantida atualizada por eventos (CQRS, [mensageria](../../messaging/index.md)). O `search` mantém seu próprio índice de eventos dessa forma.
- **Transações de negócio entre serviços** viram uma sequência de transações locais coordenadas por eventos ou por um orquestrador, com compensações quando um passo falha: o padrão **saga**. "Pagamento falhou → liberar o hold" é uma compensação.

### Conversando entre si

=== "Síncrono (requisição/resposta)"

    Quem chama espera a resposta. Simples, mas com **acoplamento temporal**: se `inventory` está fora do ar, `order` não consegue confirmar.

    ``` mermaid-sim
    sequenceDiagram
        participant F as Fã
        participant O as order
        participant I as inventory
        F->>O: POST /orders
        O->>I: confirmar hold H-7
        I-->>O: confirmado
        O-->>F: 201 Created
    ```

    **Use quando** quem chama precisa da resposta *agora* para responder (confirmar o hold antes de dizer "seus ingressos estão garantidos").

=== "Assíncrono (eventos)"

    O produtor publica um fato e segue em frente; os consumidores reagem no seu próprio tempo. Sem acoplamento temporal — `notification` pode ficar cinco minutos fora do ar e depois se atualizar.

    ``` mermaid-sim
    sequenceDiagram
        participant O as order
        participant K as Kafka
        participant N as notification
        participant A as analytics
        O->>K: OrderConfirmed
        Note over O: responde ao fã imediatamente
        K->>N: OrderConfirmed → enviar ingressos por e-mail
        K->>A: OrderConfirmed → dashboard de vendas
    ```

    **Use quando** o trabalho não muda a resposta ao usuário (e-mail, analytics, indexação da busca).

A aula 8 ([mensageria](../../messaging/index.md)) aprofunda os eventos; a página de [estilos de API](../api-styles/index.md) cobre as opções de requisição/resposta.

---

## Dentro de um serviço: arquitetura interna

Dividir o sistema decide as fronteiras *entre* serviços. Cada serviço ainda precisa de uma estrutura *interna*, e o mesmo princípio vale em escala menor: **proteja as regras de negócio daquilo que muda com mais frequência** — frameworks, bancos de dados, protocolos, provedores.

### SOLID em uma tabela

Os cinco princípios SOLID[^8] são regras no nível de classe que tornam essa proteção possível:

| Princípio | Em uma frase | Violação na BoxOffice |
|---|---|---|
| **S**ingle responsibility (responsabilidade única) | uma classe tem um único motivo para mudar | um `OrderService` que também renderiza o HTML do e-mail e chama o provedor de pagamentos |
| **O**pen/closed (aberto/fechado) | acrescente comportamento adicionando código, não editando código que funciona | um `switch (provider)` que cresce a cada novo provedor de pagamentos |
| **L**iskov substitution (substituição de Liskov) | um subtipo deve funcionar onde quer que o tipo pai funcione | um `FreeTicketPayment` que lança exceção em `refund()` |
| **I**nterface segregation (segregação de interfaces) | clientes não devem depender de métodos que não usam | um único `InventoryRepository` com 40 métodos usado por todas as classes |
| **D**ependency inversion (inversão de dependência) | o código de negócio depende de abstrações que ele mesmo define, não da infraestrutura | um `HoldService` que importa o `EntityManager` do JPA ou o SDK do provedor |

### Em camadas, clean e hexagonal { #layered-clean-and-hexagonal }

A maioria dos serviços Spring Boot começa **em camadas**: controller → service → repository → banco de dados. Isso separa o HTTP da lógica de negócio, mas a camada de negócio ainda *depende* da camada de persistência. A **Clean Architecture** (Robert C. Martin) e a **Arquitetura Hexagonal**, também chamada de *ports and adapters* (Alistair Cockburn), invertem essa única seta: o núcleo define interfaces (**portas**) em termos de negócio, e a infraestrutura (**adaptadores**) as implementa[^9][^10].

``` mermaid-sim
flowchart LR
    rest["Controller REST<br/>(adaptador de entrada)"] --> uc["PayForOrder<br/>caso de uso"]
    kafka["Listener Kafka<br/>(adaptador de entrada)"] --> uc
    uc --> port1["«porta»<br/>PaymentGateway"]
    uc --> port2["«porta»<br/>PaymentRepository"]
    stripe["ProviderAdapter<br/>(cliente HTTP)"] -.->|implementa| port1
    fake["FakeGateway<br/>(testes)"] -.->|implementa| port1
    jpa["JpaPaymentRepository"] -.->|implementa| port2
```

Para o serviço `payment` isso não é acadêmico. A porta é a anti-corruption layer do mapa de contextos:

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

O ganho: os testes dos casos de uso rodam em milissegundos com um `FakeGateway`; acrescentar um segundo provedor para [failover](../integrations/index.md#provider-outages) é um novo adaptador, não uma reescrita; e os nomes de status do provedor param em uma única classe.

| | Em camadas | Clean / Hexagonal |
|---|---|---|
| O código de negócio depende de | o framework de persistência | interfaces que ele mesmo define |
| Testes unitários precisam de | um banco de dados ou mocks do framework | simples fakes em memória |
| Trocar banco / provedor / protocolo | mexe nas classes de negócio | um novo adaptador |
| Custo | o menor número de classes | mais interfaces, mappers e indireção |

!!! warning "Não superarquitete um serviço CRUD"
    Portas, adaptadores e mappers custam classes e indireção. Um serviço que só guarda e devolve registros (a lista de locais, uma tabela de consulta) pode continuar em camadas. A estrutura compensa onde as regras de negócio são ricas (`inventory`), as integrações são externas (`payment`, `notification`) ou o serviço vai viver por anos. Os microsserviços permitem que cada serviço escolha.

---

## Capacidades compartilhadas como serviços

Algumas capacidades são necessárias para muitas partes do sistema e aparecem como componentes próprios na paleta. Costumam ser os primeiros serviços extraídos — e muitas vezes os primeiros *comprados*:

| Capacidade | Paleta | Do que é dono | Construir ou comprar? | Notas de escala |
|---|---|---|---|---|
| **Auth** | [`auth`](../../../reference/components/compute/index.md#auth) | identidades, credenciais, sessões, chaves de assinatura de tokens | em geral comprar/reutilizar: Keycloak, Auth0, Cognito, Entra ID | validação de tokens sem estado no gateway; picos de login na abertura de vendas |
| **Search** | [`search`](../../../reference/components/compute/index.md#search) | um índice invertido, *derivado* do catálogo | construir sobre Elasticsearch/OpenSearch ou uma busca gerenciada | índice atualizado a partir de eventos `EventPublished`; dominado por leituras, cachear as buscas populares |
| **Notifications** | [`notifications`](../../../reference/components/compute/index.md#notifications) | templates, preferências dos usuários, log de entregas | construir o serviço, comprar a entrega (provedores de e-mail/push/SMS) | workers movidos a fila; limitados pelos rate limits dos provedores |
| **Analytics** | [`analytics`](../../../reference/components/compute/index.md#analytics) | um stream de eventos e agregados | construir o pipeline sobre Kafka + um data warehouse | append-only, alto volume de escrita, nunca no caminho da requisição |
| **Scheduler** | [`scheduler`](../../../reference/components/compute/index.md#scheduler) | definições de jobs e sua próxima execução | Kubernetes CronJob, um scheduler da nuvem ou uma biblioteca com locks | veja [trabalho assíncrono](../async-work/index.md#schedulers) |

Dois padrões se repetem: esses serviços são em sua maioria **alimentados por eventos** em vez de chamados de forma síncrona, e seus dados muitas vezes são **derivados** — busca e analytics podem ser reconstruídos a partir da fonte da verdade, o que os torna mais baratos de operar.

### Mapa de serviços da BoxOffice

| Serviço | Capacidade | Dono de | Chamado por | Perfil de escala |
|---|---|---|---|---|
| `gateway` | ponto único de entrada, verificação de autenticação, rate limits | — | clientes | requisições/s |
| `auth` | login, tokens | usuários, credenciais | gateway | rajadas de login na abertura de vendas |
| `catalog` | eventos, locais, artistas | banco do catálogo | gateway, order | dominado por leituras, cache + CDN |
| `inventory` | mapas de assentos, holds | assentos, holds | gateway, order | escrita intensa na abertura de vendas; correção em primeiro lugar |
| `order` | pedidos, saga do checkout | pedidos | gateway | acompanha as vendas |
| `payment` | adaptador para o provedor de pagamentos | pagamentos, ids do provedor | order | acompanha as vendas; limitado pelo provedor |
| `notification` | e-mail e push | templates, log de entregas | eventos | rajadas movidas a fila |
| `search` | busca textual | índice derivado | gateway | dominado por leituras |
| `assistant` | suporte com IA (Python) | conversas, embeddings | gateway | limitado por GPU/LLM, isolado |

!!! tip "Na entrevista"

    Raramente você precisa desenhar vinte microsserviços. Desenhe **os poucos serviços cujas fronteiras importam para o problema** e justifique cada divisão com uma força: *"Eu manteria catalog e inventory separados porque catalog é dominado por leituras e cacheável, enquanto inventory tem escrita intensa e precisa de consistência forte — necessidades diferentes de escala e de consistência."* Se perguntarem "monolito ou microsserviços?", responda com o trade-off, não com um slogan: tamanho do time, necessidade de escala independente e maturidade operacional. Dizer *"Eu começaria com um monolito modular e extrairia o inventory primeiro"* é uma resposta forte e defensável.

!!! warning "Armadilhas comuns"

    - **Dividir por camada técnica** ("serviço de UI", "serviço de banco") em vez de por capacidade de negócio: toda funcionalidade mexe em todos os serviços.
    - **Banco de dados compartilhado** entre serviços: o schema vira um contrato que ninguém consegue mudar.
    - **Serviços de entidade** (`EventService`, `SeatService`, `PriceService`) que são só CRUD sobre uma tabela e precisam chamar uns aos outros em todo caso de uso.
    - **Cadeias síncronas** de cinco serviços para um clique: disponibilidade e latência se multiplicam.
    - **Dividir antes de entender o domínio**: fronteiras traçadas cedo demais são caras de mover.
    - **Ignorar os times**: fronteiras que não batem com a responsabilidade dos times se deterioram (Conway).

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    MONO["monólito"] --> MOD["monólito modular"]
    MOD --> MS["microsserviços<br/>quando uma força é real"]
    DDD["DDD: subdomínios,<br/>bounded contexts"] --> MS
    CONWAY["lei de Conway<br/>times moldam serviços"] --> MS
    AGG["agregados<br/>referência por id"] --> OWN
    MS --> OWN["cada serviço é dono dos seus dados<br/>→ Bancos de dados"]
    MS --> TALK["APIs e eventos<br/>→ Estilos de API, Mensageria"]
    OWN --> SAGA["sem transações entre serviços<br/>→ sagas, outbox"]
    HEX["portas e adaptadores"] --> INT["adapters de provedores<br/>→ Integrações"]
    MS --> SHARED["capacidades compartilhadas:<br/>auth, busca, notificações"]
```

**Componentes da paleta:** [`app`](../../../reference/components/compute/index.md#app) (cada serviço é a sua própria camada stateless) · [`apigw`](../../../reference/components/edge/index.md#apigw) (`gateway`, o ponto único de entrada) · [`auth`](../../../reference/components/compute/index.md#auth) · [`search`](../../../reference/components/compute/index.md#search) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`analytics`](../../../reference/components/compute/index.md#analytics) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (capacidades compartilhadas, muitas vezes compradas) · [`sql`](../../../reference/components/storage/index.md#sql) (um banco por serviço, nunca tabelas compartilhadas) · [`stream`](../../../reference/components/messaging/index.md#stream) (eventos alimentam os serviços derivados). **Cenários:** `monolith`, `event-fanout`. **Continua em:** [Estilos de API](../api-styles/index.md), [Bancos de dados](../../databases/index.md) (um banco por serviço), [Mensageria — padrões](../../messaging/patterns/index.md) (outbox, saga), [Distribuídos — transações](../../distributed/transactions/index.md), [Hands-on 1](../../../hands-on/1/index.md).

## Principais conclusões

- Monolito → monolito modular → microsserviços é um espectro; **comece modular** e divida quando uma força (perfil de escala, autonomia dos times, isolamento de falhas, compliance, tecnologia) for real.
- Encontre fronteiras com **DDD**: os subdomínios dizem o que construir ou comprar, os **bounded contexts** dizem onde um modelo termina; agregados se referenciam **pelo id**.
- **Lei de Conway**: os serviços tomam a forma dos times — projete os dois juntos.
- Cada serviço é **dono dos seus dados**; os outros usam sua API ou seus eventos, nunca suas tabelas.
- Dentro de um serviço, **ports and adapters** mantêm as regras de negócio independentes de frameworks e provedores — essencial para integrações, opcional para CRUD.
- Auth, busca, notificações, analytics e agendamento são capacidades compartilhadas, em geral **alimentadas por eventos** e muitas vezes **compradas**.

---

[^1]: EVANS, E. *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley, 2003.
[^2]: FOWLER, M. [MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html){target="_blank"}. martinfowler.com, 2015. Veja também NEWMAN, S. *Building Microservices*, 2nd ed. O'Reilly, 2021.
[^3]: VERNON, V. *Implementing Domain-Driven Design*. Addison-Wesley, 2013. Capítulo 3 (context maps).
[^4]: CONWAY, M. E. [How Do Committees Invent?](https://www.melconway.com/Home/Committees_Paper.html){target="_blank"} *Datamation*, 14(4), 1968, p. 28–31.
[^5]: SKELTON, M.; PAIS, M. *Team Topologies*. IT Revolution, 2019.
[^6]: BRANDOLINI, A. *Introducing EventStorming*. Leanpub, 2021.
[^7]: WESTERINEN, K. [Deconstructing the Monolith: Designing Software that Maximizes Developer Productivity](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity){target="_blank"}. Shopify Engineering, 2019.
[^8]: MARTIN, R. C. *Agile Software Development: Principles, Patterns, and Practices*. Prentice Hall, 2002.
[^9]: MARTIN, R. C. *Clean Architecture*. Prentice Hall, 2017.
[^10]: COCKBURN, A. [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/){target="_blank"}. 2005.
