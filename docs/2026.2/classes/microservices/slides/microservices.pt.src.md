---
marp: true
lang: pt-BR
title: Microsserviços
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Microsserviços

**Serviços pequenos e autônomos, cada um modelado em torno de um domínio de negócio**

<!--
Roteiro: (1) por que e quando dividir: monólito, monólito modular, Lei de Conway, princípios;
(2) os serviços da loja, posse dos dados, síncrono vs. assíncrono; (3) DDD: design estratégico e tático,
bounded contexts, mapas de contexto, agregados, Event Storming; (4) componentes de infraestrutura e uma requisição de ponta a ponta.
-->

---

## Por que dividir?

<div class="q">

A loja é uma única aplicação Spring Boot. Na Black Friday, só o checkout fica sobrecarregado, três times compartilham o código e cada release precisa de todos eles. O que está errado?

</div>

* Não é o código — é o **formato**: uma mudança exige entender e testar o **sistema inteiro**.
* Só dá para escalar **tudo**, e um bug pode derrubar **tudo**.
* Microsserviços: serviços **implantáveis de forma independente**, uma capacidade de negócio cada, colaborando por meio de **APIs**.

---

<!-- _class: tight -->

## Monólito vs. microsserviços

| Dimensão | Monólito | Microsserviços |
|---|---|---|
| **Deploy** | uma unidade — simples de entregar | independente por serviço — complexo de coordenar |
| **Escalabilidade** | escala a aplicação inteira | escala só o serviço gargalo |
| **Velocidade de dev.** | rápida no início | setup mais lento; mais rápida em escala |
| **Complexidade operacional** | baixa | alta — orquestração, rastreamento, descoberta |
| **Consistência dos dados** | transações ACID | consistência eventual |
| **Perfil de time** | time pequeno, no mesmo lugar | vários times, um serviço cada |

<div class="warn">

**Comece com um monólito (modular).** A decomposição prematura cria um **monólito distribuído**: serviços implantados juntos, tabelas compartilhadas, longas cadeias síncronas.

</div>

---

## Lei de Conway

> Qualquer organização que projeta um sistema produzirá um projeto cuja estrutura é uma cópia da estrutura de comunicação da organização. — Melvin Conway, 1967

- Mês 1: **um time**, um monólito (Pedidos, Auth, Pagamentos, Estoque).
- Mês 6: formam-se **dois times** → o código se divide em dois.
- Mês 18: **três times autônomos** → três serviços.

<div class="ok">

As fronteiras **convergem** — então projete os dois juntos (a *manobra inversa de Conway*: organize os times primeiro).

</div>

---

## Princípios fundamentais

| Princípio | Significado |
|---|---|
| **Responsabilidade única** | uma capacidade de negócio por serviço |
| **Independência** | desenvolver, implantar e escalar sem coordenação |
| **Isolamento de dados** | cada serviço é dono dos seus dados — sem tabelas compartilhadas |
| **Governança descentralizada** | os times escolhem a melhor tecnologia para o seu serviço |
| **Isolamento de falhas** | um serviço com falha não derruba o sistema |
| **Comunicação API-first** | contratos explícitos e versionados |
| **Observabilidade** | monitoramento, rastreamento e logs estruturados são pré-requisitos |

<!--
Quão pequeno é "micro"? Um time é dono dele de ponta a ponta e consegue implantá-lo sozinho. Não é "um serviço por tabela".
-->

---

<!-- _class: tight -->

## A loja, decomposta

| Serviço | Capacidade | Conversa com | Construído em |
|---|---|---|---|
| `gateway-service` | entrada, roteamento, verificação de auth | todos os serviços | Hands-on 2, 3 |
| `account-service` | contas de usuário (esquema `accounts`) | — | Hands-on 1 |
| `auth-service` | cadastro, login, JWT | account | Hands-on 3 |
| `product-service` | catálogo de produtos | — | Product API |
| `order-service` | pedidos do usuário atual | product, exchange, Kafka | Order API |
| `exchange-service` (Python) | conversão de moedas | API de cotações de terceiros | Exchange API |
| `notification-service` (Python) | e-mails de confirmação | Kafka | Hands-on 9 |

<p class="small">Python e Java lado a lado: o contrato é HTTP/JSON ou um evento Kafka, então a linguagem não vaza.</p>

---

## Ser dono dos dados

- **Banco por serviço** = nenhum serviço mexe nas **tabelas** de outro — não necessariamente um servidor para cada.
- Hands-on: um Postgres, um **esquema** por serviço (`hibernate.default_schema: accounts`, migrações Flyway próprias).
- Order precisa de um preço → `GET /products/{id}` na **API**, nunca `SELECT` na tabela de produtos.
- Consultas entre serviços → chamadas de API, ou uma cópia local atualizada por eventos (CQRS).
- Transações entre serviços → sem ACID compartilhado: uma **saga** de transações locais com compensações.

<div class="ok">

O time de produtos pode mudar o seu esquema amanhã sem avisar ninguém.

</div>

---

## Comunicação entre serviços

<div class="cols">
<div>

### Síncrona (HTTP / gRPC)

Quem chama **espera**. **Acoplamento temporal**: se o serviço chamado cair, quem chama não consegue terminar.

Order → Product: o preço é necessário **agora**.

</div>
<div>

### Assíncrona (mensageria)

O produtor **publica** `OrderCreated` e segue; os consumidores o processam **quando puderem**.

Order → Kafka → e-mail de Notification.

</div>
</div>

<div class="warn">

Uma cadeia síncrona de três serviços com 99,9% cada: 0,999³ ≈ **99,7%** — de ~8,8 h para ~26 h de indisponibilidade por ano.

</div>

---

## Domain-Driven Design

Eric Evans (2003): colocar o **domínio** no centro das decisões de projeto.

| Nível | Pergunta | Ferramentas |
|---|---|---|
| **Estratégico** | onde ficam as fronteiras? | subdomínios, bounded contexts, mapas de contexto, Event Storming |
| **Tático** | o que vai dentro de uma fronteira? | entidades, objetos de valor, agregados, repositórios, eventos |

- **Subdomínios**: o *core* (pedidos, preços) ganha código sob medida; o *genérico* (auth, pagamentos) pode ser comprado.
- **Linguagem ubíqua**: o negócio diz *account* → `account-service`, `/accounts`, `AccountOut`.

---

## Bounded Context

A fronteira dentro da qual um modelo é válido. A **mesma palavra** pode significar coisas diferentes:

| Contexto | `Customer` contém |
|---|---|
| Vendas | name, creditLimit, salesRegion |
| Suporte | name, ticketHistory, supportTier |
| Faturamento | name, taxId, billingAddress |

<div class="ok">

"Produto" no **Catálogo**: preço atual. Em **Pedidos**: o preço *pago* (cada item guarda o próprio total). Um contexto → normalmente **um microsserviço**.

</div>

---

<!-- _class: tight -->

## Mapas de contexto

| Padrão | Significado | Na loja |
|---|---|---|
| **Open Host Service** | o upstream publica uma API documentada | product → order (REST + OpenAPI) |
| **Customer / Supplier** | o upstream planeja para o downstream | dois times da mesma empresa |
| **Conformist** | o downstream adota o modelo upstream | auth reutiliza `AccountOut` |
| **Anti-Corruption Layer** | o downstream traduz um modelo externo | exchange ← API de cotações |
| **Shared Kernel** | modelo pequeno compartilhado, mudado em acordo | use com moderação — acopla |

<p class="small">Upstream = o seu modelo influencia o outro lado; downstream = depende dele. Com uma ACL, uma mudança no provedor afeta uma única função.</p>

---

<!-- _class: tight -->

## Blocos de construção

| Bloco | Ideia | Exemplo |
|---|---|---|
| **Entidade** | **identidade** própria, que persiste | `Order` com `OrderId` |
| **Objeto de valor** | definido pelos atributos, **imutável** | `Money(amount, currency)` |
| **Agregado** | grupo alterado como uma unidade, via **raiz** | `Order` → `OrderItem`, `ShippingAddress` |
| **Repositório** | acesso tipo coleção, um por raiz | `OrderRepository.findById(id)` |
| **Evento de domínio** | fato imutável, no passado | `OrderPlaced` / Kafka `OrderCreated` |
| **Serviço de domínio** | lógica que nenhuma entidade possui | `PricingService.calculateTotal(...)` |

<p class="small">Regras do agregado: só a raiz é referenciada; ela garante as invariantes ("no máx. 50 itens" em <code>Order.addItem()</code>); outros agregados <b>só pelo id</b>; uma transação altera um agregado.</p>

---

## Event Storming

Alberto Brandolini: especialistas e desenvolvedores mapeiam o domínio em uma parede de post-its.

1. **Eventos de domínio** (laranja), no passado: *OrderPlaced*, *PaymentFailed*.
2. **Comandos** (azul) que os disparam: *Fazer pedido*, *Cobrar cartão*.
3. **Agrupe por bounded context** — mesma linguagem ubíqua.
4. **Mapas de contexto**: como os grupos se relacionam.
5. **Um contexto → um serviço** para começar; junte ou divida depois.

<div class="warn">

Evite **serviços de entidade** (um por tabela) e **modelos anêmicos** (regras fora da raiz).

</div>

---

<!-- _class: tight -->

## Componentes de infraestrutura

| Componente | Papel | Na nossa plataforma |
|---|---|---|
| **Balanceador de carga** | distribui a carga entre réplicas | Nginx, `least_conn` (HO 7) |
| **API Gateway** | entrada única, fronteira de confiança | Spring Cloud Gateway (HO 2, 3) |
| **Provedor de identidade** | emite e verifica tokens (OAuth 2.0, OIDC, JWT) | `auth-service` (HO 3) |
| **Descoberta de serviços** | encontra instâncias vivas | DNS do Compose `account:8080`, Services |
| **Configuração** | config e segredos vindos do ambiente | `.env`, ConfigMaps, Secrets (HO 5) |
| **Broker · Cache** | eventos assíncronos · memória compartilhada | Kafka (HO 9) · Redis (HO 8) |
| **Observabilidade** | métricas e traces | Prometheus, Grafana, Jaeger (HO 6, 10) |

---

<!-- _class: tight -->

## Acompanhando uma requisição: `POST /orders`

1. Navegador → **Nginx** → uma réplica do **gateway**.
2. Gateway → **auth** `POST /auth/solve` com o cookie JWT → `idAccount`.
3. Gateway → **order** com o header `id-account` (os serviços nunca interpretam JWTs).
4. Order → **product** `GET /products/{id}` para obter o preço.
5. Order salva no **próprio esquema** e publica `OrderCreated` no **Kafka** (sem esperar).
6. `201 Created` faz o caminho de volta; o **Jaeger** mostra cada salto como um span.

<div class="warn">

Um serviço exposto fora do gateway pode receber um **`id-account` forjado**. Exponha só o ponto de entrada; rode **réplicas** do gateway; nada de lógica de negócio no gateway.

</div>

---

## Pontos-chave

1. Microsserviços trocam **complexidade operacional** por **deploy, escala e times independentes**.
2. **Comece com um monólito (modular)**; divida por fronteiras estáveis — ou terá um monólito distribuído.
3. **Lei de Conway**: as fronteiras dos serviços espelham a comunicação entre os times.
4. Cada serviço é dono de **uma capacidade e dos seus dados**: use a API, nunca as tabelas.
5. Chamadas síncronas **multiplicam a indisponibilidade**; eventos desacoplam produtores de consumidores.
6. O **DDD** encontra as divisões: bounded contexts, mapas de contexto, agregados referenciados pelo id.
7. Gateway, identidade, descoberta, configuração, broker e observabilidade cuidam das **preocupações transversais**.
