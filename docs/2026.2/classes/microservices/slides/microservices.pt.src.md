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
Objetivos: comparar monólito, monólito modular e microsserviços e justificar a divisão; explicar a Lei de Conway e os
princípios; escolher entre síncrono e assíncrono e estimar a disponibilidade de uma cadeia síncrona; aplicar DDD para
achar fronteiras; descrever os componentes da plataforma e acompanhar uma requisição pela arquitetura do curso.
Roteiro: (1) por que e quando dividir; (2) os serviços da loja, os dados, a comunicação; (3) Domain-Driven Design;
(4) arquitetura e componentes, uma requisição de ponta a ponta, boas práticas.
-->

---

## Por que dividir?

<div class="q">

A loja é uma aplicação Spring Boot: login, catálogo, pedidos e pagamentos, um banco, um `.jar`. Na Black Friday só o checkout fica sobrecarregado, três times dividem o código e cada release precisa de todos eles. O que está errado?

</div>

* Não é o código — é o **formato** do sistema, que não cabe mais na organização.
* Só dá para escalar **tudo**; um bug no catálogo derruba o login junto.
* **Microsserviços**: serviços pequenos, autônomos e **implantáveis de forma independente**, cada um modelado em torno de um domínio de negócio, colaborando por **APIs** bem definidas.

---

<!-- _class: tight -->

## Monólito vs. microsserviços

| Dimensão | Monólito | Microsserviços |
|---|---|---|
| **Deploy** | uma unidade — simples de entregar | independente por serviço — complexo de coordenar |
| **Escalabilidade** | escala a aplicação inteira | escala só o serviço gargalo |
| **Velocidade de desenvolvimento** | rápida no início | setup mais lento; mais rápida em escala |
| **Complexidade operacional** | baixa | alta — orquestração, rastreamento, descoberta de serviços |
| **Consistência dos dados** | transações ACID | consistência eventual entre serviços |
| **Perfil de time** | time pequeno, no mesmo lugar | vários times, cada um dono de um serviço |

<p class="small"><strong>ACID</strong>: pedidos e estoque mudam numa única operação do banco, tudo ou nada. Entre serviços, cada um grava os próprios dados e o sistema fica consistente um instante depois: <strong>consistência eventual</strong>.</p>

---

## Comece com um monólito

- A maioria dos sistemas de microsserviços bem-sucedidos **começou como monólito**: ache fronteiras de domínio estáveis (DDD) antes de dividir.
- **Monólito modular**: uma única unidade implantável, dividida por dentro em módulos com interfaces explícitas e **sem tabelas compartilhadas** — cada um poderia virar um serviço depois. Muitas vezes é a resposta certa para um time pequeno.

<div class="warn">

**Monólito distribuído** — toda a complexidade, nenhuma independência. Sintomas:

- os serviços precisam ser **implantados juntos** ("trem de release");
- dois serviços **leem e escrevem as mesmas tabelas**;
- uma requisição dispara uma longa **cadeia de chamadas síncronas**;
- uma biblioteca compartilhada de classes de domínio obriga todos a atualizar ao mesmo tempo.

</div>

---

## Lei de Conway

> Qualquer organização que projeta um sistema vai produzir um projeto cuja estrutura é uma cópia da estrutura de comunicação da organização. — Melvin Conway, 1967

- Mês 1: **um time**, um monólito (Orders, Auth, Payments, Inventory).
- Mês 6: formam-se **dois times** → o código se divide em dois.
- Mês 18: **três times autônomos** → três serviços.

<div class="ok">

As fronteiras **convergem**, então projete as duas coisas juntas. A **manobra inversa de Conway** organiza os times primeiro (um por capacidade de negócio) para que a arquitetura venha em seguida.

</div>

---

## Princípios fundamentais

| Princípio | Significado |
|---|---|
| **Responsabilidade única** | exatamente uma capacidade de negócio por serviço |
| **Independência** | desenvolver, implantar e escalar sem coordenação |
| **Isolamento de dados** | cada serviço é dono do seu banco — sem esquema nem tabelas compartilhadas |
| **Governança descentralizada** | os times escolhem a melhor tecnologia para o seu serviço |
| **Isolamento de falhas** | um serviço com falha não se propaga em cascata |
| **Comunicação API-first** | contratos explícitos e versionados |
| **Observabilidade** | monitoramento, rastreamento e logs estruturados são pré-requisitos |

<p class="small"><strong>Quão pequeno é "micro"?</strong> Não é número de linhas: um time é dono dele de ponta a ponta, faz o deploy sozinho e ele corresponde a uma capacidade. "Nanosserviços" (um por tabela) passam mais tempo conversando do que trabalhando.</p>

---

<!-- _class: tight -->

## A loja, decomposta

| Serviço | Capacidade | É dono de | Fala com | Construído em |
|---|---|---|---|---|
| `gateway-service` | ponto de entrada, roteamento, checagem de autenticação | — | todos os serviços | Hands-on 2, 3 |
| `account-service` | contas de usuário | esquema `accounts` | — | Hands-on 1 |
| `auth-service` | cadastro, login, emissão e resolução de JWTs | — (usa account) | account | Hands-on 3 |
| `product-service` | catálogo de produtos | dados de produtos | — | Product API |
| `order-service` | pedidos do usuário atual | dados de pedidos | product, exchange, Kafka | Order API |
| `exchange-service` (Python) | conversão de moedas | — | API de cotações de terceiros | Exchange API |
| `notification-service` (Python) | e-mails de confirmação do pedido | — | Kafka | Hands-on 10 |

<div class="ok">

**Governança descentralizada** na prática: Python e Java lado a lado — o contrato é HTTP/JSON ou um evento do Kafka, então a linguagem não vaza.

</div>

---

## Ser dono dos dados

- **Banco por serviço** = nenhum serviço lê ou escreve as **tabelas** de outro — não é um *servidor* de banco para cada um.
- No hands-on: um Postgres, um **esquema** por serviço (`hibernate.default_schema: accounts`, migrações Flyway próprias).
- O order precisa de um preço → `GET /products/{id}` na **API** de produtos, nunca na **tabela** — o time de produtos fica livre para mudar seu esquema.

Duas consequências:

- **Consultas entre serviços** → chamadas de API ou uma cópia local mantida atualizada por eventos (CQRS).
- **Transações de negócio entre serviços** → sem uma transação ACID compartilhada: uma **saga** de transações locais com ações de compensação.

---

## Comunicação entre serviços

<div class="cols">
<div>

### Síncrona (HTTP / gRPC)

Quem chama **espera**. **Acoplamento temporal**: se o chamado está fora do ar, quem chama não consegue terminar.

**Use quando** o resultado é necessário na hora: resposta do checkout, validação de autenticação.

**Loja**: order → product (o preço, para calcular o total).

</div>
<div>

### Assíncrona (mensageria)

O produtor **publica um evento** e segue; os consumidores o processam no seu tempo, até depois de se recuperar.

**Use quando** a consistência pode esperar: e-mail, analytics, reserva de estoque.

**Loja**: order → `OrderCreated` no Kafka → notification (Hands-on 10).

</div>
</div>

---

## Cadeias síncronas multiplicam a falha

<div class="q">

Uma requisição passa por **três** serviços, cada um disponível **99,9%** do tempo. Qual é a disponibilidade da cadeia?

</div>

* 0,999 × 0,999 × 0,999 ≈ **99,7%**.
* De cerca de **8,8 horas** de indisponibilidade por ano para cerca de **26 horas** — e cada salto soma latência.
* Mantenha cadeias curtas, use **timeouts e circuit breakers**, leve para **eventos** o trabalho que não precisa de resposta imediata.

---

<div class="kicker">Domain-Driven Design</div>

## Onde cortar?

Por tabela (`products`, `orders`, `order_items`)? Por camada? Pelo trabalho do mês? Todas dão serviços que mudam juntos: um **monólito distribuído**. O DDD (Eric Evans, 2003) acha onde o **próprio negócio** tem uma divisão natural.

| Nível | Pergunta | Ferramentas |
|---|---|---|
| **Estratégico** | *onde ficam as fronteiras?* | subdomínios, linguagem ubíqua, bounded contexts, mapas de contexto, Event Storming |
| **Tático** | *o que vai dentro de uma fronteira?* | entidades, objetos de valor, agregados, repositórios, eventos de domínio, serviços de domínio |

<p class="small">O design estratégico decide os <strong>microsserviços</strong>; o design tático molda o <strong>código dentro de cada um</strong>.</p>

---

## Subdomínios e linguagem ubíqua

| Tipo | Significado | Na loja |
|---|---|---|
| **Core** (principal) | o que diferencia o negócio: as melhores pessoas, código sob medida | pedidos, precificação, a experiência do catálogo |
| **Supporting** (de suporte) | específico do negócio, mas não é diferencial | notificações, exibição de moedas |
| **Generic** (genérico) | problemas resolvidos, iguais em toda parte — **compre ou reaproveite** | autenticação, pagamentos, envio de e-mails |

**Linguagem ubíqua**: um vocabulário para especialistas, documentos e código. Nada de *Customer* no negócio, `USER` no banco e `Person` no código: o negócio diz **account**, então `account-service`, `/accounts`, `AccountIn`, `AccountOut`, `AccountService`.

---

## Bounded Context

A fronteira dentro da qual um modelo vale. A **mesma palavra** pode significar coisas diferentes:

| Contexto | `Customer` guarda |
|---|---|
| Vendas | name, creditLimit, salesRegion |
| Suporte | name, ticketHistory, supportTier |
| Cobrança | name, taxId, billingAddress |

<div class="ok">

**"Produto" na loja**: no **Catálogo**, nome, preço atual, unidade — muda qualquer dia. Em **Pedidos**, o produto *como foi vendido*: id, quantidade, total pago (cada item guarda seu próprio `total`). Mesma palavra, dois modelos, dois serviços. Um bounded context costuma corresponder a **um microsserviço**.

</div>

---

<!-- _class: tight -->

## Mapas de contexto: como os contextos se relacionam

Upstream: seu modelo influencia o outro lado. Downstream: depende do modelo upstream.

| Padrão | Significado | Na loja |
|---|---|---|
| **Customer / Supplier** | o upstream planeja pensando no downstream | dois times da mesma empresa |
| **Open Host Service** + **Published Language** | o upstream publica uma API documentada | product → order (REST + JSON, OpenAPI) |
| **Conformist** | o downstream adota o modelo upstream como está | o auth reusa `AccountIn` / `AccountOut` |
| **Anti-Corruption Layer** | o downstream traduz um modelo estranho na fronteira | API de cotações de terceiros → exchange |
| **Shared Kernel** | um pequeno modelo compartilhado, mudado em comum acordo | use com moderação — acopla |

```python
def get_rate(source: str, target: str) -> Rate:
    raw = provider.latest(base=source)
    return Rate(source=source, target=target, value=Decimal(str(raw["rates"][target])))
```

<p class="small">A ACL do serviço exchange: se o provedor mudar o formato, ou for trocado, só esta função muda.</p>

---

## Blocos de construção: entidade, objeto de valor

<div class="cols">
<div>

### Entidade

Uma **identidade** própria que persiste: dois `Order` com o mesmo `OrderId` são o mesmo pedido, mesmo com status diferentes.

### Objeto de valor

Definido pelos **atributos**, sem identidade, **imutável**: as operações devolvem novas instâncias. `record`s do Java se encaixam.

</div>
<div>

```java
public record Money(BigDecimal amount,
                    Currency currency) {
    public Money add(Money other) {
        if (!this.currency.equals(other.currency))
            throw new CurrencyMismatchException();
        return new Money(
            this.amount.add(other.amount),
            this.currency);
    }
}
```

</div>
</div>

---

<!-- _class: tight -->

## Agregados

Um conjunto de entidades e objetos de valor alterado como **uma unidade**, pela sua **raiz**: `Order` → `OrderItem`s, `ShippingAddress`.

```java
public void addItem(ProductId productId, int quantity, Money unitPrice) {
    if (quantity <= 0)
        throw new IllegalArgumentException("quantity must be positive");
    if (items.size() >= MAX_ITEMS)
        throw new IllegalStateException("an order has at most " + MAX_ITEMS + " items");
    OrderItem item = new OrderItem(productId, quantity, unitPrice.multiply(quantity));
    items.add(item);
    total = total.add(item.total());              // invariant: total = sum of items
}
```

- O código externo referencia só a **raiz**; a raiz garante os **invariantes**.
- Salvo e carregado inteiro; **uma transação altera um agregado**.
- Outros agregados **só por id**: o item guarda o id do produto, o pedido o id da conta.

---

## Repositórios, eventos e serviços de domínio

- **Repositório**: acesso como numa coleção, **um por raiz de agregado** (não existe `OrderItemRepository`). O domínio declara o `OrderRepository`; a infraestrutura o implementa — no hands-on, o Spring Data implementa `AccountRepository extends CrudRepository<AccountModel, String>`.
- **Evento de domínio**: no passado, imutável — `record OrderPlaced(OrderId orderId, CustomerId customerId, Instant occurredAt)`. Outros contextos reagem sem que o produtor os conheça: o `OrderCreated` do Hands-on 10 no tópico `order-events`.
- **Serviço de domínio**: lógica que nenhuma entidade possui sozinha — `PricingService.calculateTotal(order, discount)`.

---

## Event Storming

Alberto Brandolini: especialistas e desenvolvedores mapeiam o domínio numa parede de post-its.

1. **Eventos de domínio** (laranja), no passado: *OrderPlaced*, *PaymentFailed*, *ItemShipped*.
2. **Comandos** (azul) que os disparam: *Place Order*, *Charge Card*.
3. **Agrupe por bounded context**, sob a mesma linguagem ubíqua.
4. **Desenhe os mapas de contexto**: como os grupos interagem.
5. **Um contexto → um serviço** para começar; junte ou divida por motivos operacionais e de time.

<div class="ok">

Bounded context ≠ microsserviço, sempre: um time pequeno pode manter dois contextos relacionados num serviço. Divida quando o deploy ou a escala independentes passarem a valer a pena.

</div>

---

## Erros comuns de DDD

- **Serviços de entidade**: um serviço por tabela ou substantivo (`OrderItemService`, `AddressService`) — sem comportamento, sempre chamados juntos.
- **Modelo de domínio anêmico**: só getters e setters, toda regra numa classe de serviço — nada protege os invariantes.
- **Um modelo gigante**: uma única classe `Customer` / `Product` compartilhada por todos os serviços numa biblioteca — cada mudança reimplanta todo mundo.
- **Agregados grandes demais**: um `Account` com todos os seus pedidos — carregar uma conta carrega milhares de pedidos e as edições entram em conflito. Mantenha agregados pequenos; ligue por id.

---

<div class="kicker">Arquitetura e componentes</div>

## Preocupações transversais

Seis serviços e cada um precisa de HTTPS, precisa checar quem é o usuário, precisa ser achado pelos outros enquanto os containers vêm e vão, precisa de configuração e segredos e precisa gerar logs e métricas.

<div class="warn">

Resolvido dentro de cada serviço → seis implementações ligeiramente diferentes (e ligeiramente erradas) da mesma coisa.

</div>

<div class="ok">

Leve essas **preocupações transversais** — presentes em todo serviço, sem pertencer a nenhum domínio de negócio — para uma **infraestrutura compartilhada**, para que cada serviço fique focado no seu domínio.

</div>

---

## Balanceador de carga e API gateway

<div class="cols">
<div>

### Balanceador de carga

Distribui as requisições de **um** serviço entre suas réplicas idênticas; não sabe nada da aplicação.

- **L4 (TCP)**: por IP/porta, vazão bruta.
- **L7 (HTTP)**: por caminho, headers, cookies — canary deployments.

No curso: **Nginx**, `least_conn`, na frente das réplicas do gateway (Hands-on 7).

</div>
<div>

### API gateway

O **ponto de entrada único** e a fronteira de confiança: decide **qual** serviço e aplica as regras da aplicação.

- roteamento (`/orders/**` → order), checagem do JWT, rate limiting, transformação, terminação SSL.

No curso: **Spring Cloud Gateway** (Hands-on 2), `Path=/accounts/**` → `http://account:8080`.

</div>
</div>

<p class="small">Uma <strong>CDN</strong> serve arquivos estáticos (imagens, JS, CSS) a partir do local mais próximo do usuário.</p>

---

## Identidade, descoberta, configuração

- **Provedor de identidade**: OAuth 2.0 (delegação), OIDC (identidade, `id_token`), **JWT** (claims assinadas, validadas sem chamar o provedor). No curso: o **auth-service** emite um JWT num cookie e o resolve para um id de conta para o gateway (Hands-on 3).
- **Descoberta de serviços**: instâncias vêm e vão, então nada de endereços fixos no código. No cliente (quem chama consulta o registro) ou no servidor (o gateway/LB consulta). No curso: o **DNS da plataforma** — o Compose dá `http://account:8080`; no Kubernetes, objetos `Service` (Hands-on 5).
- **Configuração**: no **ambiente** (twelve-factor): `${DATABASE_HOST}` vem do `.env` e do `compose.yaml`, depois de **ConfigMaps** e **Secrets**. Uma imagem para todos os ambientes.

---

<!-- _class: tight -->

## A plataforma do curso

| Componente | Opções comuns | Na nossa plataforma | Hands-on |
|---|---|---|---|
| Balanceador de carga | Nginx, HAProxy, LBs de nuvem | Nginx na frente das réplicas do gateway | 7 |
| API gateway | Spring Cloud Gateway, Kong | Spring Cloud Gateway (`gateway-service`) | 2, 3 |
| Provedor de identidade | Keycloak, Auth0, Cognito | `auth-service` emitindo JWTs | 3 |
| Descoberta de serviços | Eureka, Consul, DNS do Kubernetes | DNS do Compose, depois Services do Kubernetes | 1, 5 |
| Configuração | Spring Cloud Config, Vault, ConfigMaps | `.env` + variáveis de ambiente, depois ConfigMaps e Secrets | 5 |
| Message broker | Kafka, RabbitMQ | Kafka (`OrderCreated` em `order-events`) | 10 |
| Cache | Redis, Memcached | Redis, compartilhado pelas réplicas do gateway | 8 |
| Observabilidade | Prometheus, Grafana, OpenTelemetry, Jaeger | Prometheus + Grafana, OpenTelemetry + Jaeger | 6, 11 |

---

## Nossa arquitetura: decisões principais

Internet (web, mobile, desktop) → **balanceador de carga** → **API gateway** (→ auth) → microsserviços de negócio (account, product, order), cada um com seu banco → exchange → API de terceiros.

- **Todo tráfego externo entra pelo gateway**: os serviços internos não são alcançáveis pela internet.
- **O auth é um serviço separado**: o gateway chama `POST /auth/solve` e repassa a identidade no header `id-account`; os serviços nunca leem o JWT.
- **Cada serviço tem seu próprio banco**: APIs, não tabelas compartilhadas.
- **Serviços podem chamar uns aos outros**: tudo bem para suboperações síncronas; considere eventos para confiabilidade em escala.

---

<!-- _class: tight -->

## Acompanhando uma requisição: `POST /orders`

1. Navegador → **Nginx** (cookie com o JWT) → uma réplica do **gateway**.
2. Gateway → **auth** `POST /auth/solve` (token) → `idAccount`.
3. Gateway → **order** `POST /orders` + header `id-account`.
4. Order → **product** `GET /products/{id}` → produto com preço (a API, nunca a tabela).
5. O order grava no **seu próprio esquema** e publica `OrderCreated` no **Kafka**, sem esperar.
6. O `201 Created` faz o caminho de volta; um trace no **Jaeger** mostra exatamente esses saltos como spans.

<div class="warn">

**Armadilhas**: a porta de um serviço publicada fora do gateway → qualquer um pode **forjar o `id-account`** (o gateway precisa sobrescrevê-lo) · uma única instância do gateway → ponto único de falha · lógica de negócio no gateway · "rede confiável" como única defesa (acrescente TLS mútuo).

</div>

---

## Boas práticas

| Prática | Por que importa |
|---|---|
| **Projete para a falha** | qualquer chamada a outro serviço pode falhar: timeouts, retries com backoff, circuit breakers |
| **Automatize tudo** | CI/CD, IaC e orquestração são pré-requisitos em escala |
| **Seja dono dos seus dados** | um banco compartilhado impede a evolução independente |
| **Assíncrono sempre que possível** | cadeias síncronas amplificam a latência e acoplam a disponibilidade |
| **Observe tudo** | traces, logs estruturados e métricas explicam falhas entre serviços |
| **Versione as suas APIs** | deploys independentes exigem mudanças compatíveis ou versionadas |

---

## Pontos-chave

1. Microsserviços trocam **complexidade operacional** por **deploy, escala e autonomia de times independentes** — só vale quando esses problemas são reais.
2. Comece com um monólito (modular); divida em fronteiras estáveis achadas com DDD ou você terá um **monólito distribuído**.
3. **Lei de Conway**: as fronteiras dos serviços espelham a comunicação dos times — projete as duas juntas.
4. Cada serviço é dono de **uma capacidade e dos seus dados**; os outros usam sua API, nunca suas tabelas.
5. Chamadas síncronas **acoplam a disponibilidade**; eventos desacoplam produtores de consumidores.
6. **DDD**: bounded contexts e mapas de contexto acham as divisões; agregados protegem invariantes e referenciam outros por id.
7. **Preocupações transversais** ficam na infraestrutura compartilhada: o gateway é o ponto de entrada e a fronteira de confiança, resolve o JWT e repassa o `id-account`.
