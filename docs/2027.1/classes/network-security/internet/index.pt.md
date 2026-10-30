Às 10h00 um fã em São Paulo toca em **Comprar** num celular ligado ao Wi-Fi de casa. Alguns milissegundos depois, um pod com o endereço `10.20.40.17` cobra o cartão num provedor de pagamento que aceita requisições de exatamente um endereço no mundo. Entre os dois há uma dúzia de roteadores, pelo menos três traduções de endereço e quatro tabelas de rotas — e nenhum deles sabe nada sobre o BoxOffice. Esta página explica esse caminho desde o começo: o que é um endereço IP, por que alguns endereços são **públicos** e outros **privados**, como um bloco de endereços é dividido em **sub-redes**, e como o **NAT** permite que milhões de dispositivos privados compartilhem poucos endereços públicos. A [próxima página](../cloud-network/index.md) constrói a rede do BoxOffice na nuvem sobre essas ideias, e o resto da aula a protege.

!!! info "Dois simuladores nesta página"

    O **explorador de endereços** mostra os 32 bits de qualquer endereço IPv4, divide blocos em sub-redes e distingue público de privado. O **caminho do pacote** envia um pacote pela rede do BoxOffice, salto a salto, mostrando cada consulta à tabela de rotas, cada reescrita de endereço e cada decisão de firewall — e deixa você quebrar a rede para ver o que falha.

---

## Camadas: quem decide o quê { #layers }

Uma requisição não é uma coisa só no fio. É uma mensagem HTTP dentro de um segmento TCP, dentro de um pacote IP, dentro de um quadro Wi-Fi ou Ethernet. Cada camada tem o seu endereço e responde a uma pergunta diferente:

| Camada | Unidade | Endereço | Pergunta que responde | Exemplo no BoxOffice |
|---|---|---|---|---|
| Aplicação | requisição HTTP | URL, nome do host | *o que* é pedido | `POST /orders` para `boxoffice.com` |
| Transporte | segmento TCP / datagrama QUIC | **porta** | *qual programa* na máquina | `443` (o load balancer), `8080` (`order`), `5432` (PostgreSQL) |
| Rede | **pacote IP** | **endereço IP** | *qual máquina*, através de muitas redes | `203.0.113.10`, `10.20.40.17` |
| Enlace | quadro Ethernet / Wi-Fi | endereço MAC | *qual dispositivo* neste cabo ou rádio | o celular → o roteador de casa |

``` diagram
flowchart LR
    subgraph F["quadro Wi-Fi (MAC → MAC): reescrito a cada salto"]
        subgraph P["pacote IP: origem 192.168.0.12 → destino 203.0.113.10"]
            subgraph T["segmento TCP: porta 51514 → 443"]
                H["HTTP: POST /orders (dentro do TLS)"]
            end
        end
    end
```

Dois fatos saem da figura e explicam quase toda esta página:

- **Roteadores olham só o cabeçalho IP.** Nunca leem a URL; o IP de destino decide o caminho. O quadro em volta do pacote é descartado e refeito a cada salto.
- **Portas são da camada de transporte**, mas dispositivos de NAT e firewalls também as leem: é assim que um endereço público é compartilhado, e é assim que um security group libera a `5432` e recusa a `22`.

---

## Como um pacote atravessa a Internet { #routing }

A Internet é uma rede de redes: dezenas de milhares de **sistemas autônomos** (AS) — operadoras, universidades, provedores de nuvem, grandes empresas — cada um com os seus roteadores e os seus blocos de endereços. Cada AS **anuncia** os seus blocos aos vizinhos com **BGP** (Border Gateway Protocol)[^1]: "mande para mim os pacotes de `203.0.113.0/24`". Os anúncios se propagam até que cada roteador do núcleo tenha rotas para cerca de um milhão de prefixos IPv4.

Nenhum roteador conhece o caminho inteiro. Cada um faz a mesma coisa com cada pacote:

1. Lê o IP de destino.
2. Encontra na sua tabela a **rota mais específica** que o contém (**maior prefixo**, *longest prefix match*: uma rota para um `/24` vence uma rota para um `/16`, que vence a rota padrão `0.0.0.0/0`).
3. Envia o pacote ao **próximo salto** dessa rota e decrementa o **TTL** do pacote (um contador de saltos que mata pacotes presos em laços).

Aperte play para seguir um pacote do celular do fã até o BoxOffice (os endereços são exemplos de documentação[^2]):

``` diagram-sim
sequenceDiagram
    autonumber
    participant P as Celular 192.168.0.12
    participant R as Roteador de casa (NAT)
    participant C as Operadora (AS do provedor)
    participant X as Trânsito / ponto de troca
    participant E as Borda do provedor de nuvem
    participant G as Internet gateway (VPC)
    participant L as Load balancer 10.20.0.10
    P->>R: destino 203.0.113.10 fora de 192.168.0.0/24 → gateway padrão
    R->>C: NAT: a origem vira 198.51.100.7 (o IP público da casa)
    C->>X: maior prefixo para 203.0.113.10: rota aprendida por BGP
    X->>E: próximo salto: a rede que anunciou 203.0.113.0/24
    E->>G: dentro do provedor: a VPC dona de 203.0.113.10
    G->>L: NAT 1:1: o destino 203.0.113.10 vira 10.20.0.10
    L-->>P: a resposta passa pelas mesmas traduções, ao contrário
```

Rode `traceroute` (Linux, macOS) ou `tracert` (Windows) para qualquer site: cada linha da saída é um roteador desta lista, com o seu tempo de ida e volta. Um caminho típico tem de 10 a 20 saltos; o tempo é dominado pela **distância** (a luz na fibra percorre cerca de 200 km por milissegundo), não pelo número de roteadores — é por isso que a [borda](../../edge/index.md#latency-budget) coloca CDNs perto dos fãs.

!!! info "O núcleo da Internet não tem rota padrão"

    O roteador da sua casa tem uma rota padrão (`0.0.0.0/0 → operadora`). Os grandes roteadores do núcleo não: só guardam os prefixos que alguém anunciou. Um pacote para um endereço que ninguém anuncia — um endereço **privado** como `10.20.40.17` — não encontra rota e é descartado no primeiro roteador do núcleo. É isso, e não um firewall, que impede a Internet de alcançar um pod pelo seu IP privado.

---

## Endereços IP e CIDR { #cidr }

Um endereço IPv4 é um **número de 32 bits**, escrito como quatro octetos decimais: `10.20.40.17` é `00001010.00010100.00101000.00010001`. Todo endereço tem duas partes:

- a **parte de rede** (os primeiros *n* bits) diz *em qual rede* o host está — é o que os roteadores comparam;
- a **parte de host** (os outros 32 − *n* bits) diz *qual host* dentro dessa rede.

A notação **CIDR** (Classless Inter-Domain Routing)[^3] escreve a divisão depois de uma barra: `10.20.0.0/16` é "os 2³²⁻¹⁶ = 65 536 endereços que começam com os mesmos 16 bits de `10.20.0.0`". Cada bit a mais no prefixo **divide o bloco ao meio**: um `/17` é metade de um `/16`, um `/24` tem 256 endereços, um `/32` é um único host. A mesma divisão às vezes é escrita como **máscara**: `/16` é `255.255.0.0`. Numa rede clássica o primeiro endereço do bloco nomeia a rede e o último é o de broadcast, então um `/24` tem 254 hosts utilizáveis; a AWS reserva 5 endereços em cada sub-rede.

<div class="netsim" data-tool="cidr" data-cidr="10.20.40.17/19"></div>

**Experimente:**

1. O explorador começa com `10.20.40.17/19`. Os bits de host não são zero, então o explorador mostra o **bloco** que contém este endereço: `10.20.32.0/19`, a sub-rede privada de aplicação do BoxOffice na AZ a. Arraste o prefixo de `/19` até `/24` e veja o bloco cair pela metade a cada passo.
2. Digite `10.20.0.0/16`, escolha **Dividir em 4 sub-redes** e teste o endereço `10.20.40.17`: em qual dos quatro blocos `/18` ele cai?
3. Clique nos exemplos: `192.168.0.12` (a sua casa), `100.64.7.9` (o NAT da sua operadora de celular), `169.254.169.254` (o serviço de metadados da nuvem), `8.8.8.8` (público). A linha **tipo do endereço** diz quais a Internet consegue rotear.

??? question "Pense antes: numa sub-rede `10.20.32.0/19`, o endereço `10.20.64.5` está dentro?"

    Não. Blocos `/19` têm 2¹³ = 8 192 endereços, então começam a cada 32 valores do terceiro octeto: `10.20.0.0`, `10.20.32.0`, `10.20.64.0`… `10.20.32.0/19` vai de `10.20.32.0` a `10.20.63.255`; `10.20.64.5` está no bloco seguinte (`10.20.64.0/19`, a sub-rede de aplicação da AZ b). Um host da AZ a manda os pacotes para ele ao seu gateway, não diretamente. Confira no explorador.

---

## Endereços públicos e privados { #public-private }

Trinta e dois bits dão 2³² ≈ **4,3 bilhões** de endereços — menos do que os celulares em uso hoje, sem contar servidores, carros e lâmpadas. Os registros distribuíram os últimos blocos IPv4 livres entre 2011 e 2019. A Internet sobreviveu com duas ideias:

- Alguns blocos são **privados** (RFC 1918)[^4]: qualquer rede pode usá-los internamente, quantas vezes quiser, e **ninguém os roteia na Internet**.
- O **NAT** (próxima seção) permite que muitos hosts privados compartilhem um endereço **público**, único no mundo e anunciado por BGP.

| Bloco | Tamanho | Tipo | Roteado na Internet? | Onde você o encontra |
|---|---|---|---|---|
| `10.0.0.0/8` | 16,8 mi | privado | não | a VPC do BoxOffice `10.20.0.0/16`; os pods do kind `10.244.0.0/16` |
| `172.16.0.0/12` | 1 mi | privado | não | as redes do Docker (`172.18.0.0/16` no [lab 3](../../../hands-on/3/index.md)) |
| `192.168.0.0/16` | 65 536 | privado | não | roteadores domésticos (`192.168.0.0/24`) |
| `100.64.0.0/10` | 4,2 mi | compartilhado (CGNAT)[^5] | não | o seu celular no 4G/5G, atrás do NAT da operadora |
| `127.0.0.0/8` | 16,8 mi | loopback | não | `localhost` — a própria máquina |
| `169.254.0.0/16` | 65 536 | link-local | não | `169.254.169.254`: o serviço de metadados da nuvem (credenciais!) |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | 256 cada | documentação[^2] | não (reservados) | os endereços "públicos" dos exemplos desta disciplina |
| todo o resto (unicast) | ≈ 3,7 bilhões | **público** | **sim** | o load balancer e o NAT gateway do BoxOffice |

Os tamanhos são calculados a partir dos prefixos:

```python exec="true"
blocks = [("10.0.0.0/8", 8), ("172.16.0.0/12", 12), ("192.168.0.0/16", 16), ("100.64.0.0/10", 10)]
total = 2 ** 32
print("| Block | Addresses | Share of IPv4 |")
print("|---|---|---|")
for name, prefix in blocks:
    size = 2 ** (32 - prefix)
    print(f"| `{name}` | {size:,} | {size / total:.3%} |".replace(",", " "))
private = sum(2 ** (32 - p) for _, p in blocks[:3])
print(f"| **all RFC 1918** | **{private:,}** | **{private / total:.2%}** |".replace(",", " "))
```

Um endereço **público** é o que torna um host alcançável *a partir* da Internet: alguém anuncia o seu bloco, então os pacotes para ele encontram uma rota. Um endereço **privado** só é alcançável dentro da própria rede e através do que traduz ou roteia para dentro dela. No BoxOffice, só duas coisas têm endereço público — o **load balancer** (para receber os fãs) e o **NAT gateway** (para chamar o provedor de pagamento de um endereço fixo). Todo serviço, pod e banco tem apenas um endereço privado.

!!! warning "Privado é sobre alcance, não sobre confiança"

    Um endereço privado só diz "a Internet não tem rota até mim". Qualquer coisa dentro da rede — um pod comprometido, um peering mal configurado, a VPN de um engenheiro — ainda o alcança. Por isso os [security groups](../cloud-network/index.md#security-groups) continuam restringindo cada porta, e por isso o [Zero Trust](../zero-trust/index.md) autentica cada chamada em vez de confiar na rede.

---

## NAT: muitos hosts privados atrás de um endereço público { #nat }

O **NAT** (Network Address Translation) reescreve endereços no cabeçalho IP quando os pacotes atravessam um dispositivo. A forma mais comum, o **NAT de origem** (também chamado PAT ou *masquerading*), é o que fazem o roteador da sua casa, a sua operadora de celular e o NAT gateway da nuvem: trocam a origem privada de cada pacote que sai pelo seu próprio endereço público e uma porta livre, e anotam o par numa **tabela de tradução**.

``` diagram-sim
sequenceDiagram
    autonumber
    participant P as Celular 192.168.0.12
    participant N as Roteador de casa (NAT) público 198.51.100.7
    participant S as Servidor 203.0.113.10
    participant A as Alguém na Internet
    P->>N: origem 192.168.0.12:51514 → destino 203.0.113.10:443
    Note over N: tabela: 192.168.0.12:51514 ⇄ 198.51.100.7:40001
    N->>S: origem 198.51.100.7:40001 → destino 203.0.113.10:443
    S-->>N: resposta para 198.51.100.7:40001
    Note over N: achou na tabela → volta para 192.168.0.12:51514
    N-->>P: resposta entregue
    A->>N: uma conexão nova para 198.51.100.7:22
    Note over N: nenhuma entrada para a porta 22 → descartado
```

| Dentro (privado) | Fora (público) | Outra ponta |
|---|---|---|
| `192.168.0.12:51514` | `198.51.100.7:40001` | `203.0.113.10:443` |
| `192.168.0.15:49822` | `198.51.100.7:40002` | `203.0.113.10:443` |

Quatro consequências aparecem o tempo todo em design de sistemas:

1. **Conexões só começam de dentro.** Um host de fora pode responder, mas não pode abrir uma conexão nova: não há entrada na tabela que diga ao NAT para onde mandá-la. É por isso que os pods numa sub-rede privada conseguem chamar o provedor de pagamento enquanto ninguém na Internet consegue chamá-los.
2. **O servidor vê o NAT, não o cliente.** Milhares de fãs atrás de um NAT de operadora chegam ao BoxOffice com o **mesmo IP**. Um limite de taxa por IP bloquearia um bairro inteiro às 10h00 — a razão pela qual [a borda limita por chave de API ou por usuário](../../edge/api-gateway/index.md) e trata limites por IP como uma defesa grosseira.
3. **Um NAT dá um endereço de saída estável.** Os pods mudam de nó e os seus IPs mudam, mas tudo o que mandam para a Internet sai com o IP público fixo do NAT — o que o BoxOffice registra na lista de permissões do provedor de pagamento ([redes em nuvem](../cloud-network/index.md#subnets)).
4. **O NAT de destino publica um serviço privado.** A reescrita inversa — "pacotes para a minha `:443` pública vão para este host privado" — é o que fazem um load balancer, um internet gateway da nuvem (NAT 1:1 para IPs públicos) e o `ports: "80:80"` do Docker.

Um NAT também tem **capacidade**: cada conexão para o mesmo destino precisa da sua própria porta pública, e um endereço público tem no máximo 65 535. Um NAT gateway da AWS suporta até 55 000 conexões simultâneas para cada destino único[^6] — um limite real quando centenas de pods chamam a mesma API de pagamento durante uma abertura de vendas.

---

## Sub-redes e o gateway { #subnets }

Um host não roteia pacotes como o núcleo da Internet. A sua configuração de rede tem só três números — **o seu endereço**, **o seu prefixo** e **o seu gateway padrão** (mais um servidor DNS) — e ele toma uma decisão para cada pacote:

``` diagram-sim
flowchart TD
    A["pacote para o destino"] --> B{"o destino está dentro da<br/>minha sub-rede (endereço/prefixo)?"}
    B -->|"sim"| C["descobre o MAC do destino (ARP)<br/>e envia diretamente"]
    B -->|"não"| D["envia ao gateway padrão<br/>(o roteador da sub-rede)"]
    D --> E["o roteador consulta a tabela de rotas:<br/>maior prefixo → próximo salto"]
    E --> F["…até que um roteador o entregue<br/>dentro da sub-rede do destino"]
```

Uma **sub-rede** é, portanto, um bloco de endereços cujos hosts falam diretamente entre si; todo o resto passa por um roteador. Os projetos dividem o espaço de endereços em sub-redes por três razões:

- **Posicionamento**: na nuvem uma sub-rede vive numa zona de disponibilidade, então uma sub-rede por zona permite espalhar réplicas e perder uma zona sem perder um serviço.
- **Política de roteamento**: cada sub-rede tem uma tabela de rotas, e é a tabela que a torna **pública** (uma rota para um internet gateway), **privada** (uma rota para um NAT) ou **isolada** (nenhuma rota para fora).
- **Raio de impacto e regras**: firewalls e flow logs são associados por sub-rede; um erro numa camada não abre as outras.

Uma **tabela de rotas** é uma lista de `bloco de destino → alvo`. Toda tabela numa VPC tem a rota `local` para o próprio bloco da VPC; o resto decide a camada:

| Tabela de rotas | `10.20.0.0/16` | `0.0.0.0/0` | A sub-rede é… |
|---|---|---|---|
| `rt-public` | local | internet gateway | **pública**: recursos com IP público falam com a Internet nos dois sentidos |
| `rt-private` | local | NAT gateway | **privada**: só saída, pelo NAT |
| `rt-data` | local | — | **isolada**: nem entrada nem saída |

Quando um pacote para `10.20.8.10` sai de uma sub-rede privada, as duas rotas "o contêm" (`0.0.0.0/0` contém tudo), e **o maior prefixo vence**: `/16` vence `/0`, então ele fica dentro da VPC.

---

## O caminho do pacote: a VPC do BoxOffice { #packet-walk }

Agora junte as peças. O simulador abaixo é uma versão pequena da rede do BoxOffice (uma zona de disponibilidade): uma sub-rede **pública** com o load balancer e o NAT gateway, uma sub-rede **privada** com os pods `order` e `payment`, e uma sub-rede **isolada** com o PostgreSQL. Cada passo mostra onde o pacote está, a sua origem e o seu destino (os campos que acabaram de mudar ficam destacados), a tabela de rotas ou o security group consultado, e a linha que casou.

<div class="netsim" data-tool="packet" data-scenario="fan-site"></div>

**Experimente:**

1. **Um fã abre o site.** Conte as reescritas de endereço: o roteador de casa troca a *origem* (privado → público), o internet gateway troca o *destino* (público → o endereço privado do load balancer). Depois o load balancer abre uma **segunda** conexão, dentro da VPC, até o `order`.
2. **payment chama o provedor.** O endereço privado do pod, `10.20.40.17`, é reescrito duas vezes na saída (NAT, depois internet gateway); o provedor vê só `203.0.113.20` e o encontra na lista de permissões. Siga a resposta de volta pela tabela do NAT.
3. **Um fã tenta acessar um pod diretamente.** O pacote nunca chega ao BoxOffice: nenhum roteador da Internet tem rota para um endereço privado.
4. **Quebre a rede.** Desmarque *rota 0.0.0.0/0 → NAT* e rode de novo o cenário 2; desmarque *sg-data aceita 5432* e rode *order consulta o PostgreSQL*; desmarque *o load balancer tem IP público* e rode o cenário 1. Cada interruptor é um erro de configuração real que já derrubou sites.
5. **Scanners.** Tente a porta 5432 no IP do NAT e no IP do load balancer: um é descartado pelo NAT (sem tradução), o outro por um security group.

??? question "O que você deveria ter visto? (abra depois de experimentar)"

    - Os pods nunca conhecem nenhum endereço público: as traduções acontecem nas bordas (roteador de casa, internet gateway, NAT gateway), e a resposta é traduzida de volta pelos mesmos dispositivos.
    - A **tabela de rotas** decide se um pacote *pode* sair de uma sub-rede; o **security group** decide se o destino o *aceita*; a **tabela do NAT** decide se um pacote que chega é uma resposta ou um estranho.
    - Um pacote descartado **não gera mensagem de erro**: quem enviou espera o seu timeout. "Connection timed out" geralmente indica uma rota ou um firewall; "connection refused" indica que o host foi alcançado e nada escuta naquela porta.

!!! example "No código do BoxOffice: uma rede privada no seu notebook (lab 3)"

    O [Hands-on 3](../../../hands-on/3/index.md) já tem o formato da rede na nuvem. O Docker Compose cria uma **rede bridge privada** para o projeto (nos logs do lab, `172.18.0.0/16`, um bloco RFC 1918). As três réplicas do `catalog` **não têm `ports:`** — como pods numa sub-rede privada, só são alcançáveis de dentro daquela rede, pelo nome, pelo DNS do Docker. Só o `edge` publica `80:80`: um **NAT de destino** da porta 80 da sua máquina para o container do Nginx, a versão de notebook de um load balancer com IP público.

    ``` { .yaml title="docker-compose.yaml (the private replicas and the published edge)" }
    --8<-- "docs/2027.1/hands-on/3/code/docker-compose.yaml:47:67"
    ```

    O Nginx resolve os nomes das réplicas com o servidor DNS interno do Docker (`127.0.0.11`) e balanceia entre os seus endereços privados. No log de acesso do lab toda requisição chega **de `172.18.0.1`** — o gateway da bridge, não o seu navegador: o servidor vê o NAT, exatamente como o provedor de pagamento vê o NAT gateway do BoxOffice.

    ``` { .nginx title="infra/nginx/nginx.conf (names → private addresses)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:17:24"
    ```

!!! example "No código do BoxOffice: pods, nós e uma porta publicada (lab 10)"

    No [Hands-on 10](../../../hands-on/10/index.md) o cluster kind tem três nós, cada um um container com endereço privado; cada pod recebe o seu próprio endereço privado da rede de pods (o padrão do kind, `10.244.0.0/16`), e os Services recebem endereços virtuais de outro bloco privado. A única entrada a partir da sua máquina é o `extraPortMappings`: a porta 80 do host → a NodePort `30080` do controlador de Ingress — mais uma vez um NAT de destino, no papel do internet gateway na frente do load balancer.

    ``` { .yaml title="k8s/kind.yaml" }
    --8<-- "docs/2027.1/hands-on/10/code/k8s/kind.yaml"
    ```

---

## IPv6 em um parágrafo { #ipv6 }

Endereços IPv6 têm **128 bits** (2¹²⁸ ≈ 3,4 × 10³⁸), escritos em grupos hexadecimais como `2001:db8:20::17`. Há o suficiente para cada dispositivo ter um endereço **roteável globalmente**, então redes IPv6 normalmente **não usam NAT** — o que significa que, com IPv6, um pod *poderia* ser alcançável a partir da Internet, e só as tabelas de rotas e os firewalls (security groups) decidem se ele é. Nuvens e operadoras rodam **dual-stack** (IPv4 e IPv6 lado a lado), e o IPv4 público virou um recurso cobrado: desde fevereiro de 2024 a AWS cobra por todo endereço IPv4 público, em uso ou não[^7]. As ideias de projeto desta página — sub-redes, tabelas de rotas, maior prefixo, firewalls — são as mesmas no IPv6.

---

!!! tip "Na entrevista"

    Raramente vão pedir para você calcular uma máscara, mas vão perguntar "como a Internet chega ao seu serviço, e como o seu serviço chama o mundo de fora?". Responda num fôlego só: "os fãs resolvem o nome para o IP **público** do load balancer; tudo atrás dele tem endereços **privados** em sub-redes privadas; as chamadas ao provedor de pagamento saem por um **NAT gateway por AZ** com um IP fixo que o provedor coloca na lista de permissões; a sub-rede do banco **não tem rota** para a Internet." Depois, se houver tempo, comente que limites de taxa por IP são injustos atrás do NAT das operadoras.

!!! success "Boas práticas"

    - **Dê endereço público só ao que precisa ser alcançado pela Internet** — no BoxOffice, o load balancer e o NAT gateway; serviços, pods e bancos recebem só endereços privados (o [caminho do pacote](#packet-walk) mostra por que nada mais é alcançável).
    - **Escolha blocos privados que nunca vão se sobrepor** — um plano único para toda VPC, escritório e cluster (VPC `10.20.0.0/16`, pods e Services de blocos reservados no mesmo plano), para que peering e VPNs continuem possíveis depois.
    - **Faça a tabela de rotas dizer a camada**: sub-redes públicas roteiam `0.0.0.0/0` para o internet gateway, as privadas para um NAT na mesma zona, as de dados para lugar nenhum — e revise qualquer mudança numa rota padrão como uma mudança de código.
    - **Dimensione sub-redes para o pico com folga**, não para hoje: conte nós, IPs de pods e os 5 endereços reservados (um `/24` tem 251 utilizáveis na AWS; acaba no primeiro grande scale-out).
    - **Nunca confie só no IP do cliente** — atrás do NAT das operadoras milhares de fãs compartilham um endereço; limite por chave de API ou por usuário, e use limites por IP só como escudo grosseiro contra enxurradas.
    - **Acompanhe a capacidade do NAT em destinos quentes** — reutilize conexões (keep-alive, pools de conexões) com o provedor de pagamento em vez de abrir uma por requisição, e alerte em erros de alocação de portas.

!!! warning "Armadilhas comuns"

    - **"Tem IP privado, então está seguro"** — um endereço privado limita quem consegue rotear até ele, não quem tem permissão de entrar; vizinhos comprometidos, peerings e VPNs estão do lado de dentro.
    - **Colocar o IP de um pod ou de um nó na lista de permissões de um parceiro** — esses endereços mudam a cada reagendamento; coloque o IP público fixo do NAT.
    - **Confundir "timeout" com "refused"** — um timeout aponta para uma rota, um security group ou um NAT; uma recusa significa que o host foi alcançado e nada escuta naquela porta.
    - **`10.0.0.0/16` sobreposto em todo lugar** — o padrão de muitos templates, e a razão pela qual duas equipes não conseguem ligar as suas redes.
    - **Expor `169.254.169.254` a requisições não confiáveis** — um *server-side request forgery* que alcança o serviço de metadados pode roubar as credenciais de nuvem da máquina (exija a API de metadados com token).

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    L["camadas: quadro, pacote,<br/>segmento, requisição"] --> IP["endereço IP:<br/>bits de rede + host (CIDR)"]
    IP --> PP["público vs privado<br/>(RFC 1918, CGNAT)"]
    PP --> NAT["NAT: endereço público compartilhado,<br/>IP de saída estável"]
    NAT --> RL["limites por IP são injustos<br/>→ Borda: rate limiting"]
    IP --> SUB["sub-redes + gateway padrão"]
    SUB --> RT["tabelas de rotas:<br/>maior prefixo"]
    RT --> VPC["pública / privada / isolada<br/>→ Redes em nuvem"]
    BGP["BGP: redes anunciam prefixos"] --> RT
    PP --> ZT["privado ≠ confiável<br/>→ Zero Trust"]
    VPC --> SG["security groups<br/>→ Redes em nuvem"]
```

**Componentes da paleta:** [`vpc`](../../../reference/components/network/index.md#vpc) · [`subnet`](../../../reference/components/network/index.md#subnet) · [`nat`](../../../reference/components/network/index.md#nat) · [`lb`](../../../reference/components/edge/index.md#lb) (o único endereço público que recebe tráfego) · [`dns`](../../../reference/components/edge/index.md#dns) (o nome que leva até ele). **Continua em:** [Redes em nuvem](../cloud-network/index.md) (a VPC do BoxOffice, security groups, endpoints), [Borda — a jornada da requisição](../../edge/index.md#the-request-journey) e [rate limiting](../../edge/api-gateway/index.md), [Zero Trust](../zero-trust/index.md), [Hands-on 3](../../../hands-on/3/index.md) e [Hands-on 10](../../../hands-on/10/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Uma requisição viaja como um pacote IP; **roteadores leem só o IP de destino** e o encaminham pelo **maior prefixo**, salto a salto; as redes anunciam os seus blocos com **BGP**.
    - Um endereço IPv4 tem uma **parte de rede e uma parte de host**; `/n` fixa os primeiros *n* bits, o bloco tem 2³²⁻ⁿ endereços, e cada bit a mais o divide ao meio.
    - Blocos **privados** (RFC 1918) são reutilizados em todo lugar e nunca roteados na Internet; endereços **públicos** são únicos e anunciados. Privado significa inalcançável de fora, não confiável.
    - O **NAT** permite que hosts privados compartilhem um endereço público: conexões só começam de dentro, os servidores veem o IP do NAT, e o NAT dá um endereço de saída estável para listas de permissões.
    - Um host envia diretamente dentro da sua **sub-rede** e ao **gateway padrão** no resto; a **tabela de rotas** de uma sub-rede a torna pública, privada ou isolada.

---

[^1]: REKHTER, Y.; LI, T.; HARES, S. [RFC 4271 — A Border Gateway Protocol 4 (BGP-4)](https://datatracker.ietf.org/doc/html/rfc4271){target="_blank"}. IETF, 2006. Para o quadro completo: KUROSE, J.; ROSS, K. *Computer Networking: A Top-Down Approach*, 8. ed. Pearson, 2021, capítulos 4 e 5.
[^2]: ARKKO, J.; COTTON, M.; VEGODA, L. [RFC 5737 — IPv4 Address Blocks Reserved for Documentation](https://datatracker.ietf.org/doc/html/rfc5737){target="_blank"}. IETF, 2010. Os endereços "públicos" desta disciplina vêm desses blocos, então nunca pertencem a um host real.
[^3]: FULLER, V.; LI, T. [RFC 4632 — Classless Inter-domain Routing (CIDR)](https://datatracker.ietf.org/doc/html/rfc4632){target="_blank"}. IETF, 2006.
[^4]: REKHTER, Y. et al. [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){target="_blank"}. IETF, 1996.
[^5]: WEIL, J. et al. [RFC 6598 — IANA-Reserved IPv4 Prefix for Shared Address Space](https://datatracker.ietf.org/doc/html/rfc6598){target="_blank"}. IETF, 2012.
[^6]: AMAZON WEB SERVICES. [NAT gateways — Amazon VPC User Guide](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html){target="_blank"}.
[^7]: AMAZON WEB SERVICES. [New — AWS Public IPv4 Address Charge](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/){target="_blank"}. AWS News Blog, 2023.
