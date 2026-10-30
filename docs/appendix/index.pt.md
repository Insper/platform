# Apêndice

Material de referência em que todas as edições do curso se apoiam. O apêndice reúne a base que as aulas e os labs dão
por sabida: como uma requisição encontra um servidor, como as chaves a protegem, como uma API é desenhada e versionada,
e as ferramentas que constroem e entregam o código. Leia uma página quando uma aula ou um lab a pressupuser. Cada página
se sustenta sozinha, tem simuladores interativos onde um conceito é mais fácil de ver do que de ler e termina com seus
pontos-chave.

## Uma requisição, de ponta a ponta

Quase todo o apêndice cabe no caminho de uma única requisição, do navegador até um microsserviço, e do código que a
atende. Aperte play e acompanhe:

``` diagram-sim
sequenceDiagram
    participant B as Navegador
    participant D as Resolvedor DNS
    participant N as Roteador / NAT
    participant S as Microsserviço
    B->>D: 1 · api.example.com?
    D-->>B: 203.0.113.10 (em cache pelo TTL)
    B->>N: 2 · handshake TCP com 203.0.113.10:443
    N->>S: repassado a um endereço privado, 10.0.1.5:8080
    S-->>B: 3 · TLS: um certificado assinado com RSA ou Ed25519
    B->>S: 4 · GET /v2/orders (REST) ou POST /graphql
    S-->>B: 200 OK + JSON
```

1. O **DNS** transforma o nome em um endereço IP, guardado em cache por um TTL: [DNS](network/dns/index.md).
2. O **TCP** abre uma conexão com uma porta. Os pacotes atravessam roteadores públicos e chegam a uma rede privada
   por meio do NAT: [portas, TCP e UDP](network/transport/index.md) e [endereçamento e NAT](network/addressing/index.md).
3. O **TLS** prova a identidade do servidor com assinaturas de chave pública e combina uma chave simétrica:
   [RSA e Ed25519](rsa.md).
4. A **API** responde no estilo e na versão que o cliente pediu:
   [REST vs GraphQL](rest-vs-graphql.md) e [versionamento de APIs REST](versioning-rest-apis.md).

O código por trás do serviço foi construído em um [ambiente de desenvolvimento](development-setup.md), versionado com
Git (às vezes entre [submódulos](git-submodules.md)) e entregue por um pipeline do [GitHub Actions](gitactions.md).

## Seções

<div class="grid cards" markdown>

-   :material-lan:{ .lg .middle } **Redes**

    ---

    Como os pacotes viajam e como um nome vira uma conexão. Explore blocos CIDR e uma tabela de NAT, veja o que custa
    um segmento TCP perdido e ajuste o TTL do DNS.

    [:octicons-arrow-right-24: Visão geral](network/index.md) ·
    [Endereçamento e NAT](network/addressing/index.md) ·
    [Portas, TCP e UDP](network/transport/index.md) ·
    [DNS](network/dns/index.md) ·
    [Quiz](network/quiz.md)

-   :material-key-variant:{ .lg .middle } **Segurança**

    ---

    Criptografia de chave pública: monte passo a passo um par de chaves RSA de brinquedo, assine e verifique, veja por
    que o RSA "de livro" é inseguro e quando o Ed25519 é a melhor escolha.

    [:octicons-arrow-right-24: RSA e Ed25519](rsa.md)

-   :material-api:{ .lg .middle } **APIs**

    ---

    Conte as idas e voltas e os bytes que uma tela custa com REST e com GraphQL, e evolua uma API sem quebrar seus
    clientes.

    [:octicons-arrow-right-24: REST vs GraphQL](rest-vs-graphql.md) ·
    [Versionamento de APIs REST](versioning-rest-apis.md)

-   :material-tools:{ .lg .middle } **Ferramentas**

    ---

    Prepare sua máquina, organize repositórios e veja o que decide quanto tempo um pipeline de CI leva e o que roda
    quando um job falha.

    [:octicons-arrow-right-24: Ambiente de desenvolvimento](development-setup.md) ·
    [Oh My Zsh](ohmyzsh.md) ·
    [Submódulos Git](git-submodules.md) ·
    [GitHub Actions](gitactions.md)

</div>

Além do curso: [leituras complementares](others.md), uma lista curta de artigos, RFCs e projetos que vale conhecer.

!!! tip "Como usar os simuladores"

    Todos os simuladores têm os mesmos controles. **Play** roda, **→** avança um passo, **recomeçar** volta ao início
    e **1×** muda a velocidade; com o simulador em foco, a barra de espaço reproduz e as setas avançam. A caixa
    **Experimente** abaixo de cada simulador propõe um experimento curto, com os números que você deve ver.
