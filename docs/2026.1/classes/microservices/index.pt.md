
**Microsserviços** são um estilo arquitetural que estrutura uma aplicação como uma coleção de serviços pequenos e autônomos, cada um modelado em torno de um domínio de negócio específico. Em vez de construir uma única grande unidade implantável (um *monólito*), o sistema é composto por partes implantáveis de forma independente, que colaboram por meio de APIs bem definidas.

O estilo de microsserviços é uma resposta a um problema específico: à medida que os times e as bases de código crescem, um único monólito fica cada vez mais caro de modificar — uma alteração em um módulo exige entender e testar o sistema inteiro, e um deploy exige coordenação com toda a organização.

---

## Monólito vs. microsserviços

``` mermaid
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
        db1[(BD de Pedidos)]
        db2[(BD de Auth)]
        db3[(BD de Estoque)]
        gw --> s1 & s2 & s3
        s1 --> db1
        s2 --> db2
        s3 --> db3
    end
```

Nenhum dos estilos é universalmente melhor. A escolha certa depende do tamanho do time, da complexidade do domínio e da maturidade operacional:

| Dimensão | Monólito | Microsserviços |
|---|---|---|
| **Deploy** | Uma única unidade — simples de entregar | Independente por serviço — complexo de coordenar |
| **Escalonamento** | Escala-se a aplicação inteira | Escala-se apenas o serviço gargalo |
| **Velocidade de desenvolvimento** | Rápida no início | Configuração inicial mais lenta; mais rápida em escala |
| **Complexidade operacional** | Baixa | Alta — exige orquestração, rastreamento, descoberta de serviços |
| **Consistência dos dados** | Transações ACID | Consistência eventual entre serviços |
| **Adequação ao time** | Time pequeno, no mesmo lugar | Vários times, cada um dono de um serviço |

!!! tip "Comece com um monólito"
    A maioria dos sistemas de microsserviços bem-sucedidos começou como um monólito. Identifique fronteiras de domínio estáveis (usando Domain-Driven Design) antes de dividir. Uma decomposição prematura cria um *monólito distribuído* — toda a complexidade dos microsserviços sem nenhum dos benefícios de independência.

---

## Princípios-chave

| Princípio | Significado |
|---|---|
| **Responsabilidade única** | Cada serviço implementa exatamente uma capacidade de negócio |
| **Independência** | Os serviços podem ser desenvolvidos, implantados e escalados sem coordenação com os demais |
| **Isolamento de dados** | Cada serviço é dono do seu próprio banco de dados — nada de esquema compartilhado, nada de tabelas compartilhadas |
| **Governança descentralizada** | Os times escolhem a tecnologia que melhor se adapta ao seu serviço |
| **Isolamento de falhas** | Um serviço com falha não se propaga em cascata derrubando o sistema inteiro |
| **Comunicação API-first** | Os serviços interagem por meio de contratos explícitos e versionados |
| **Observabilidade** | Monitoramento abrangente, rastreamento distribuído e logs estruturados são pré-requisitos |

---

## Comunicação entre serviços

Os serviços de um sistema de microsserviços se comunicam de duas formas fundamentalmente diferentes, cada uma com trade-offs distintos:

=== "Síncrona (HTTP / gRPC)"

    Quem chama envia uma requisição e **espera** por uma resposta. É simples de entender, mas cria **acoplamento temporal** — quem chama não consegue concluir sua operação se o serviço chamado estiver fora do ar.

    ``` mermaid
    sequenceDiagram
        participant Client
        participant Gateway
        participant Order Service
        participant Inventory Service

        Client->>+Gateway: POST /orders
        Gateway->>+Order Service: cria o pedido
        Order Service->>+Inventory Service: reserva os itens
        Inventory Service-->>-Order Service: reservado ✓
        Order Service-->>-Gateway: 201 Created
        Gateway-->>-Client: 201 Created
    ```

    **Use quando:** quem chama precisa do resultado imediatamente (por exemplo, a resposta do checkout, a validação de autenticação).

=== "Assíncrona (mensageria)"

    O produtor **publica um evento** e segue em frente. Os consumidores processam o evento de forma independente, no seu próprio ritmo. Isso elimina o acoplamento temporal — os serviços podem estar fora do ar e processar a mensagem quando se recuperarem.

    ``` mermaid
    sequenceDiagram
        participant Order Service
        participant Message Broker
        participant Inventory Service
        participant Notification Service

        Order Service->>Message Broker: evento OrderPlaced
        Note over Order Service: segue imediatamente
        Message Broker->>Inventory Service: OrderPlaced
        Message Broker->>Notification Service: OrderPlaced
        Inventory Service->>Message Broker: InventoryReserved
    ```

    **Use quando:** a consistência estrita não é necessária imediatamente (por exemplo, enviar um e-mail, atualizar analytics, reservar estoque).

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :material-domain:{ .lg .middle } **Domain-Driven Design**

    ---

    O vocabulário e as técnicas para identificar as fronteiras dos serviços: linguagem ubíqua, contextos delimitados, entidades, objetos de valor, agregados, eventos de domínio e repositórios.

    [:octicons-arrow-right-24: Domain-Driven Design](ddd/index.md)

-   :material-sitemap:{ .lg .middle } **Arquitetura e componentes**

    ---

    Os blocos de construção de um sistema de microsserviços em produção: balanceadores de carga, API gateway, provedor de identidade, descoberta de serviços, serviço de configuração e a arquitetura de referência do curso.

    [:octicons-arrow-right-24: Arquitetura e componentes](architecture/index.md)

</div>

---

[^1]: XU, A. [System Design 101](https://github.com/ByteByteGoHq/system-design-101){target="_blank"}
[^2]: NEWMAN, S. *Building Microservices*, 2nd ed. O'Reilly, 2021.
[^3]: EVANS, E. *Domain-Driven Design*. Addison-Wesley, 2003.
[^4]: RICHARDSON, C. [Microservices Patterns](https://microservices.io){target="_blank"}.
