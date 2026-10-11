
Imagine a loja como uma única aplicação Spring Boot: login, catálogo, pedidos e pagamentos em um só código-fonte, um só banco de dados, um só `.jar` para implantar. Na Black Friday, apenas o checkout fica sobrecarregado, mas a única forma de escalá-lo é rodar mais cópias de *tudo*. Um bug na página do catálogo derruba o login junto. Três times agora compartilham o código, e cada release exige que todos concordem com o mesmo dia. Não há nada de errado com o código — o **formato** do sistema é que não se encaixa mais na organização.

O estilo de microsserviços é uma resposta a esse problema específico: à medida que times e bases de código crescem, um único monólito fica cada vez mais caro de mudar — modificar um módulo exige entender e testar o sistema inteiro, e um deploy exige coordenação com a organização toda.

**Microsserviços** é um estilo arquitetural que estrutura uma aplicação como uma coleção de serviços pequenos e autônomos, cada um modelado em torno de um domínio de negócio específico[^5][^2]. Em vez de construir uma única grande unidade implantável (um *monólito*), o sistema é composto de partes implantáveis de forma independente, que colaboram por meio de APIs bem definidas.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Comparar** um monólito, um monólito modular e microsserviços, e **justificar** quando a divisão compensa o seu custo.
    - **Explicar** a Lei de Conway e os princípios centrais de microsserviços (capacidade única, independência, isolamento de dados).
    - **Escolher** entre comunicação síncrona e assíncrona para uma interação, e **estimar** o custo de disponibilidade de uma cadeia síncrona.
    - **Aplicar** o Domain-Driven Design (bounded contexts, agregados, mapas de contexto) para encontrar as fronteiras dos serviços.
    - **Descrever** os componentes de infraestrutura de uma plataforma de microsserviços e acompanhar uma requisição pela arquitetura do curso.

## Roteiro

1. **Esta página** — por que e quando dividir, Lei de Conway, princípios, posse dos dados, comunicação síncrona vs. assíncrona, os serviços da loja.
2. [Domain-Driven Design](ddd/index.md) — o vocabulário e as técnicas para encontrar boas fronteiras entre serviços.
3. [Arquitetura e componentes](architecture/index.md) — balanceador de carga, gateway, provedor de identidade, descoberta, configuração, broker, observabilidade e a arquitetura de referência do curso.

## Slides

<div class="slides-embed">
  <iframe src="slides/microservices.pt.html" title="Slides: microsserviços" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/microservices.pt.html){:target="_blank"}

---

## Monólito vs. microsserviços

``` mermaid-sim
flowchart LR
    subgraph mono [Monólito]
        direction TB
        ui_m[UI]
        biz_m[Lógica de negócio\nPedidos · Auth · Pagamentos · Estoque]
        data_m[Banco de dados único]
        ui_m --> biz_m --> data_m
    end
    subgraph micro [Microsserviços]
        direction TB
        gw[API Gateway]
        s1[Serviço de\nPedidos]
        s2[Serviço de\nAuth]
        s3[Serviço de\nEstoque]
        db1[(BD Pedidos)]
        db2[(BD Auth)]
        db3[(BD Estoque)]
        gw --> s1 & s2 & s3
        s1 --> db1
        s2 --> db2
        s3 --> db3
    end
```

Nenhum dos dois estilos é universalmente melhor. A escolha certa depende do tamanho do time, da complexidade do domínio e da maturidade operacional:

| Dimensão | Monólito | Microsserviços |
|---|---|---|
| **Deploy** | Uma unidade — simples de entregar | Independente por serviço — complexo de coordenar |
| **Escalabilidade** | Escala a aplicação inteira | Escala apenas o serviço gargalo |
| **Velocidade de desenvolvimento** | Rápida no início | Setup mais lento; mais rápida em escala |
| **Complexidade operacional** | Baixa | Alta — exige orquestração, rastreamento, descoberta de serviços |
| **Consistência dos dados** | Transações ACID | Consistência eventual entre serviços |
| **Perfil de time** | Time pequeno, no mesmo lugar | Vários times, cada um dono de um serviço |

Dois termos da tabela merecem uma definição. Uma **transação ACID** (Atomicidade, Consistência, Isolamento, Durabilidade) permite que o monólito altere pedidos e estoque em uma única operação de banco de dados, que acontece por inteiro ou não acontece. Entre serviços não existe transação compartilhada: cada serviço grava os seus próprios dados, e o sistema fica consistente um instante depois — **consistência eventual** (veja [Teorema CAP](../distributed_systems/cap/index.md)).

!!! tip "Comece com um monólito"
    A maioria dos sistemas de microsserviços bem-sucedidos começou como monólito. Identifique fronteiras de domínio estáveis (usando Domain-Driven Design) antes de dividir. A decomposição prematura cria um *monólito distribuído* — toda a complexidade dos microsserviços, sem nenhum dos benefícios de independência.

**O meio-termo: um monólito modular.** Uma única unidade implantável, mas dividida internamente em módulos com interfaces explícitas e sem tabelas compartilhadas — cada módulo poderia virar um serviço depois. Isso dá ao time prática com fronteiras antes de pagar o preço da rede, e muitas vezes é a resposta certa para um time pequeno.

!!! warning "Sintomas de um monólito distribuído"
    - Os serviços precisam ser **implantados juntos** ("release train"), porque uma mudança em um quebra os outros.
    - Dois serviços **leem e escrevem nas mesmas tabelas**.
    - Uma requisição do usuário dispara uma longa **cadeia de chamadas síncronas**; se qualquer elo cair, tudo cai.
    - Uma biblioteca compartilhada com classes de domínio obriga todos os serviços a atualizar ao mesmo tempo.

### Lei de Conway

> *"Qualquer organização que projeta um sistema produzirá um projeto cuja estrutura é uma cópia da estrutura de comunicação da organização."*
> — Melvin Conway, 1967[^6]

As fronteiras entre serviços e as fronteiras entre times convergem ao longo do tempo. A simulação abaixo mostra como um código inicialmente unificado se fragmenta em serviços que espelham os padrões de comunicação dos times que o construíram:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

rng = np.random.default_rng(7)

fig, axes = plt.subplots(1, 3, figsize=(12, 4))
titles = ["Month 1\n(one team, monolith)", "Month 6\n(two teams form)", "Month 18\n(three autonomous teams)"]

team_configs = [
    {"teams": 1, "modules": ["Orders\nAuth\nPayments\nInventory"], "colors": ["#4C72B0"]},
    {"teams": 2, "modules": ["Orders\nPayments", "Auth\nInventory"], "colors": ["#4C72B0", "#DD8452"]},
    {"teams": 3, "modules": ["Orders\nPayments", "Auth", "Inventory\nCatalogue"], "colors": ["#4C72B0", "#DD8452", "#55A868"]},
]

for ax, cfg, title in zip(axes, team_configs, titles):
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.set_title(title, fontsize=9, fontweight="bold")
    ax.axis("off")

    n = len(cfg["modules"])
    positions = [(5, 7), (2.5, 3.5), (7.5, 3.5), (5, 1)][:n]
    for (x, y), label, color in zip(positions, cfg["modules"], cfg["colors"]):
        ax.add_patch(plt.Rectangle((x - 1.5, y - 1), 3, 2, color=color, alpha=0.75, zorder=2))
        ax.text(x, y, label, ha="center", va="center", fontsize=7.5, color="white", fontweight="bold", zorder=3)

    if n == 1:
        ax.text(5, 1.5, "Shared codebase\n(high coupling)", ha="center", va="center", fontsize=7.5, color="#666")
    else:
        for i in range(n):
            for j in range(i + 1, n):
                x1, y1 = positions[i]
                x2, y2 = positions[j]
                lw = 2.5 if i // 1 != j // 1 else 1
                style = "--" if n == 3 else "-"
                ax.plot([x1, x2], [y1, y2], style, color="#aaa", linewidth=lw, zorder=1)

patches = [mpatches.Patch(color=c, label=f"Team {i+1}") for i, c in enumerate(["#4C72B0","#DD8452","#55A868"])]
fig.legend(handles=patches, loc="lower center", ncol=3, fontsize=8, frameon=False)

plt.suptitle("Conway's Law: org structure shapes service boundaries", fontsize=10, y=1.02)
plt.tight_layout()
from io import StringIO
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

A lei também funciona ao contrário, e é assim que as organizações a usam de propósito: a **manobra inversa de Conway** (*inverse Conway maneuver*) organiza os times primeiro (um time por capacidade de negócio) para que a arquitetura venha em seguida.

---

## Princípios fundamentais

| Princípio | Significado |
|---|---|
| **Responsabilidade única** | Cada serviço implementa exatamente uma capacidade de negócio |
| **Independência** | Os serviços podem ser desenvolvidos, implantados e escalados sem coordenação com os outros |
| **Isolamento de dados** | Cada serviço é dono do próprio banco de dados — sem esquema compartilhado, sem tabelas compartilhadas |
| **Governança descentralizada** | Os times escolhem a tecnologia que melhor se adapta ao seu serviço |
| **Isolamento de falhas** | Um serviço com falha não se propaga em cascata nem derruba o sistema inteiro |
| **Comunicação API-first** | Os serviços interagem por meio de contratos explícitos e versionados |
| **Observabilidade** | Monitoramento abrangente, rastreamento distribuído e logs estruturados são pré-requisitos |

**Quão pequeno é "micro"?** Não é uma quantidade de linhas. Um serviço tem o tamanho certo quando um time consegue ser dono dele de ponta a ponta, ele pode ser implantado sem coordenação com os outros e corresponde a uma capacidade de negócio. Serviços pequenos demais ("nanosserviços", por exemplo, um serviço por tabela) passam mais tempo conversando entre si do que trabalhando.

---

## A loja, decomposta

O curso constrói uma plataforma passo a passo. Cada serviço é dono de uma capacidade e dos seus próprios dados[^4]:

| Serviço | Capacidade | Dono de | Conversa com | Construído em |
|---|---|---|---|---|
| `gateway-service` | Ponto de entrada único, roteamento, verificação de autenticação | — | todos os serviços | [Hands-on 2](../../hands-on/2/index.md), [3](../../hands-on/3/index.md) |
| `account-service` | Contas de usuário | esquema `accounts` | — | [Hands-on 1](../../hands-on/1/index.md) |
| `auth-service` | Cadastro, login, emissão e resolução de JWTs | — (usa account) | account | [Hands-on 3](../../hands-on/3/index.md) |
| `product-service` | Catálogo de produtos | dados de produtos | — | [Product API](../../exercises/product/index.md) |
| `order-service` | Pedidos do usuário atual | dados de pedidos | product, exchange, Kafka | [Order API](../../exercises/order/index.md) |
| `exchange-service` (Python) | Conversão de moedas | — | API de cotações de terceiros | [Exchange API](../../exercises/exchange/index.md) |
| `notification-service` (Python) | E-mails de confirmação de pedido | — | Kafka | [Hands-on 9](../../hands-on/9/index.md) |

Observe a *governança descentralizada* em ação: os serviços de câmbio e de notificação são escritos em Python, os demais em Java — o contrato é HTTP/JSON ou um evento Kafka, então a linguagem não vaza.

### Ser dono dos dados

**Banco de dados por serviço** (*database-per-service*) significa que nenhum serviço lê ou escreve nas tabelas de outro serviço. Isso não exige um *servidor* de banco de dados por serviço. No hands-on, um único container Postgres hospeda vários **esquemas**, e cada serviço é o único que mexe no seu (o serviço de contas define `hibernate.default_schema: accounts` e roda as próprias migrações Flyway):

``` mermaid-sim
flowchart LR
    subgraph pg ["um servidor Postgres"]
        s1[("esquema accounts")]
        s2[("esquema products")]
        s3[("esquema orders")]
    end
    account["account-service"] --> s1
    product["product-service"] --> s2
    order["order-service"] --> s3
    order -->|"GET /products/{id}"| product
    order -.-x|"sem SQL direto"| s2
```

Quando o serviço de pedidos precisa do preço de um produto, ele pergunta à **API** de produtos, nunca à **tabela** de produtos. Isso deixa o time de produtos livre para mudar o seu esquema. Disso decorrem duas consequências:

- **Consultas entre serviços** viram chamadas de API (ou uma cópia local dos dados, mantida atualizada por eventos — veja [CQRS](../event_driven/index.md)).
- **Transações de negócio entre serviços** não podem usar uma única transação ACID. Elas viram uma sequência de transações locais coordenadas por eventos, com ações de compensação quando um passo falha — o padrão **saga**[^4].

---

## Comunicação entre serviços

Os serviços de um sistema de microsserviços se comunicam de duas formas fundamentalmente diferentes, cada uma com trade-offs próprios:

=== "Síncrona (HTTP / gRPC)"

    Quem chama envia uma requisição e **espera** a resposta. É simples de entender, mas cria **acoplamento temporal** — quem chama não consegue concluir a operação se o serviço chamado estiver fora do ar.

    ``` mermaid-sim
    sequenceDiagram
        participant Client as Cliente
        participant Gateway
        participant Order Service as Serviço de Pedidos
        participant Inventory Service as Serviço de Estoque

        Client->>+Gateway: POST /orders
        Gateway->>+Order Service: cria o pedido
        Order Service->>+Inventory Service: reserva os itens
        Inventory Service-->>-Order Service: reservado ✓
        Order Service-->>-Gateway: 201 Created
        Gateway-->>-Client: 201 Created
    ```

    **Use quando:** quem chama precisa do resultado imediatamente (por exemplo, a resposta do checkout, a validação de autenticação).

=== "Assíncrona (mensageria)"

    O produtor **publica um evento** e segue em frente. Os consumidores processam o evento de forma independente, no seu próprio tempo. Isso elimina o acoplamento temporal — os serviços podem estar fora do ar e processar a mensagem quando se recuperarem.

    ``` mermaid-sim
    sequenceDiagram
        participant Order Service as Serviço de Pedidos
        participant Message Broker as Message broker
        participant Inventory Service as Serviço de Estoque
        participant Notification Service as Serviço de Notificação

        Order Service->>Message Broker: evento OrderPlaced
        Note over Order Service: segue imediatamente
        Message Broker->>Inventory Service: OrderPlaced
        Message Broker->>Notification Service: OrderPlaced
        Inventory Service->>Message Broker: InventoryReserved
    ```

    **Use quando:** a consistência estrita não é necessária de imediato (por exemplo, enviar um e-mail, atualizar analytics, reservar estoque).

Na loja, o serviço de pedidos chama o serviço de produtos de forma **síncrona** (ele precisa do preço para calcular o total antes de responder) e publica um evento `OrderCreated` no Kafka de forma **assíncrona**, para que o serviço de notificação envie o e-mail sem deixar o cliente esperando ([Hands-on 9](../../hands-on/9/index.md)).

!!! warning "Cadeias síncronas multiplicam as falhas"
    Se uma requisição precisa passar por três serviços, e cada um fica disponível 99,9% do tempo, a cadeia fica disponível apenas 0,999 × 0,999 × 0,999 ≈ **99,7%** do tempo — de cerca de 8,8 horas de indisponibilidade por ano para cerca de 26 horas. Cada salto síncrono a mais reduz a disponibilidade e adiciona latência. Mantenha as cadeias curtas, use timeouts e circuit breakers ([Padrões de resiliência](../reliability/patterns/index.md)) e mova para eventos o trabalho que não precisa de resposta imediata ([Arquitetura orientada a eventos](../event_driven/index.md)).

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :material-domain:{ .lg .middle } **Domain-Driven Design**

    ---

    O vocabulário e as técnicas para identificar as fronteiras dos serviços: linguagem ubíqua, bounded contexts, entidades, objetos de valor, agregados, eventos de domínio, repositórios e mapas de contexto.

    [:octicons-arrow-right-24: Domain-Driven Design](ddd/index.md)

-   :material-sitemap:{ .lg .middle } **Arquitetura e componentes**

    ---

    Os blocos de construção de um sistema de microsserviços em produção: balanceadores de carga, API gateway, provedor de identidade, descoberta de serviços, serviço de configuração, message broker, observabilidade e a arquitetura de referência do curso[^1].

    [:octicons-arrow-right-24: Arquitetura e componentes](architecture/index.md)

</div>

---

## Pontos-chave

- Microsserviços trocam **complexidade operacional** por **deploy independente, escalabilidade e autonomia dos times** — só vale a pena quando esses são problemas reais.
- Comece com um monólito (modular); divida ao longo de fronteiras de domínio estáveis, encontradas com DDD[^3], ou você terá um **monólito distribuído**.
- **Lei de Conway**: as fronteiras dos serviços espelham a comunicação entre os times — projete os dois juntos.
- Cada serviço é dono de **uma capacidade e dos seus dados**; os outros usam a sua API, nunca as suas tabelas.
- Chamadas síncronas são simples, mas **acoplam a disponibilidade**; eventos desacoplam produtores de consumidores.

## Conexões

- Por que a rede torna isso difícil: [Sistemas distribuídos](../distributed_systems/index.md).
- Os contratos entre serviços: [API](../api/index.md).
- Construa a plataforma: [Hands-on 1 — CRUD](../../hands-on/1/index.md), [Hands-on 2 — Gateway](../../hands-on/2/index.md), [Hands-on 3 — Segurança](../../hands-on/3/index.md).
- Dentro de um serviço: [Arquiteturas de software](../architectures/index.md) (clean e hexagonal).
- Integração assíncrona: [Arquitetura orientada a eventos](../event_driven/index.md) e [Hands-on 9 — Kafka](../../hands-on/9/index.md).

---

[^1]: XU, A. [System Design 101](https://github.com/ByteByteGoHq/system-design-101){target="_blank"}
[^2]: NEWMAN, S. *Building Microservices*, 2nd ed. O'Reilly, 2021.
[^3]: EVANS, E. *Domain-Driven Design*. Addison-Wesley, 2003.
[^4]: RICHARDSON, C. [Microservices Patterns](https://microservices.io){target="_blank"}.
[^5]: LEWIS, J.; FOWLER, M. [Microservices — a definition of this new architectural term](https://martinfowler.com/articles/microservices.html){target="_blank"}. martinfowler.com, 2014.
[^6]: CONWAY, M. E. [How Do Committees Invent?](https://www.melconway.com/Home/Committees_Paper.html){target="_blank"} *Datamation*, 14(4), 1968, p. 28–31.
