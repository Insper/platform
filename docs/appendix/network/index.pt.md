
A **internet** é uma rede global de redes — uma teia de computadores, roteadores e data centers interconectados que se comunicam por meio de um conjunto comum de protocolos padronizados. Nenhuma organização é dona da internet; ela é uma colaboração entre provedores de acesso (ISPs), governos, universidades e empresas, que concordam em seguir as mesmas regras para que suas redes possam interoperar.

Os dados trafegam pela internet como **pacotes** — pequenos pedaços de tamanho fixo. Um arquivo ou uma página web é dividido em muitos pacotes, e cada um é roteado de forma independente pela rede e remontado no destino. Esse modelo de *comutação de pacotes* é resiliente: se uma rota estiver congestionada ou interrompida, os pacotes encontram um caminho alternativo.

---

## Pilha de protocolos TCP/IP

A internet é construída sobre uma arquitetura em camadas. Cada camada resolve um problema específico e depende da camada abaixo dela. O **modelo TCP/IP** tem quatro camadas:

| Camada | Protocolos | Responsabilidade |
|---|---|---|
| **Aplicação** | HTTP, HTTPS, DNS, SMTP, SSH | Define como as aplicações trocam dados |
| **Transporte** | TCP, UDP | Entrega dados entre processos em dois hosts (portas) |
| **Internet** | IP (IPv4, IPv6), ICMP | Roteia pacotes da origem ao destino através das redes |
| **Enlace** | Ethernet, Wi-Fi, ARP | Move quadros (frames) entre dispositivos da mesma rede local |

``` mermaid
flowchart TB
    subgraph client [Cliente]
        direction TB
        ca[Aplicação\nHTTP GET /]
        ct[Transporte\nsegmento TCP]
        ci[Internet\npacote IP]
        cl[Enlace\nquadro Ethernet]
        ca --> ct --> ci --> cl
    end
    subgraph server [Servidor]
        direction BT
        sa[Aplicação\nHTTP 200 OK]
        st[Transporte\nsegmento TCP]
        si[Internet\npacote IP]
        sl[Enlace\nquadro Ethernet]
        sl --> si --> st --> sa
    end
    cl -->|"meio físico\n(cabo / Wi-Fi / fibra)"| sl
```

Quando você abre `https://example.com`, o navegador entrega uma requisição HTTP à camada de Aplicação; o TCP a envolve em um segmento com as **portas** de origem e de destino; o IP envolve isso em um pacote com os **endereços IP** de origem e de destino; e a Ethernet monta o quadro para a rede local. Cada roteador no caminho remove e recoloca o quadro da camada de Enlace, usando a camada de Internet para decidir o próximo salto (hop).

---

## Endereços IP

Cada dispositivo em uma rede é identificado por um **endereço IP** — um número que diz aos roteadores para onde entregar os pacotes. Os endereços IP têm duas partes: um **prefixo de rede** (identifica a rede) e um **identificador de host** (identifica o dispositivo específico dentro dessa rede).

### IPv4

O IPv4 usa endereços de **32 bits**, escritos em notação decimal com pontos — quatro octetos separados por pontos:

```
192  . 168  .   1  .  42
 ↑       ↑      ↑      ↑
8 bits  8 bits 8 bits  8 bits   →  total 32 bits
```

A **notação CIDR** (Classless Inter-Domain Routing) acrescenta o tamanho do prefixo para expressar uma faixa: `192.168.1.0/24` significa que os primeiros 24 bits identificam a rede, sobrando 8 bits para os hosts — 256 endereços (de `192.168.1.0` a `192.168.1.255`).

O IPv4 oferece 2³² ≈ **4,3 bilhões** de endereços únicos. Isso parecia enorme em 1981 — não era. O crescimento explosivo da internet, dos smartphones, dos dispositivos IoT e dos servidores em nuvem esgotou o estoque global de IPv4. Os registros regionais distribuíram seus últimos blocos não alocados entre 2011 e 2019[^7].

### IPv6

O IPv6 usa endereços de **128 bits**, escritos em oito grupos de quatro dígitos hexadecimais:

```
2001:0db8:85a3:0000:0000:8a2e:0370:7334
```

Grupos consecutivos de zeros podem ser comprimidos: `2001:db8:85a3::8a2e:370:7334`.

O IPv6 oferece 2¹²⁸ ≈ **3,4 × 10³⁸** endereços — o suficiente para que cada grão de areia da Terra tenha o seu próprio endereço. Mesmo assim, o IPv4 continua dominante, porque a transição exige atualizar cada dispositivo de rede, sistema operacional e aplicação.

| | IPv4 | IPv6 |
|---|---|---|
| **Tamanho do endereço** | 32 bits | 128 bits |
| **Notação** | Decimal com pontos (`192.168.1.1`) | Grupos hexadecimais (`2001:db8::1`) |
| **Espaço de endereços** | ~4,3 bilhões | ~3,4 × 10³⁸ |
| **Exige NAT?** | Sim — o esgotamento de endereços obriga | Não — cada dispositivo pode ter um endereço unicast global |
| **Adoção** | ~70% do tráfego | ~40% e crescendo |

---

## DNS — Domain Name System

Humanos lembram de nomes; computadores roteiam pacotes usando endereços IP. O **DNS** é o banco de dados distribuído que traduz nomes de domínio em endereços IP[^8].

``` mermaid
sequenceDiagram
    participant B as Navegador
    participant R as Resolvedor recursivo\n(ISP / 8.8.8.8)
    participant Rt as Servidor raiz
    participant T as Servidor TLD\n(.com)
    participant A as NS autoritativo\n(example.com)

    B->>R: Qual é o IP de example.com?
    R->>Rt: Quem responde por .com?
    Rt-->>R: Endereço do NS do TLD
    R->>T: Quem responde por example.com?
    T-->>R: Endereço do NS autoritativo
    R->>A: Qual é o IP de example.com?
    A-->>R: 93.184.216.34  (TTL: 3600s)
    R-->>B: 93.184.216.34  (em cache pelo TTL)
```

O resolvedor guarda a resposta em cache pelo tempo do TTL (Time to Live), de modo que a maioria das consultas é resolvida em milissegundos a partir do cache.

### Tipos comuns de registro DNS

| Registro | Finalidade | Exemplo |
|---|---|---|
| **A** | Mapeia um nome para um endereço IPv4 | `example.com → 93.184.216.34` |
| **AAAA** | Mapeia um nome para um endereço IPv6 | `example.com → 2606:2800:220:1::93` |
| **CNAME** | Apelido (alias) que aponta para outro nome | `www.example.com → example.com` |
| **MX** | Servidor de e-mail de um domínio | `example.com → mail.example.com` |
| **TXT** | Texto livre (SPF, DKIM, verificação de propriedade) | `"v=spf1 include:_spf.google.com ~all"` |

---

## Portas

Um endereço IP identifica um **host**; uma **porta** identifica um **processo** específico nesse host. Juntos, `IP:porta` (o chamado *endereço de socket*) identificam de forma única um ponto de comunicação (endpoint) na rede.

As portas são números de 16 bits (0–65535), divididos em três faixas:

| Faixa | Nome | Uso |
|---|---|---|
| 0–1023 | Portas bem conhecidas (well-known) | Reservadas para serviços padrão; exigem root para fazer o bind |
| 1024–49151 | Portas registradas | Registradas na IANA para aplicações comuns |
| 49152–65535 | Portas efêmeras | Atribuídas dinamicamente a clientes para conexões de saída |

### Portas bem conhecidas

| Porta | Protocolo | Serviço |
|---|---|---|
| 22 | TCP | SSH (shell seguro) |
| 25 | TCP | SMTP (envio de e-mail) |
| 53 | TCP/UDP | DNS |
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 3306 | TCP | MySQL |
| 5432 | TCP | PostgreSQL |
| 6379 | TCP | Redis |
| 8080 | TCP | HTTP (servidores de desenvolvimento, HTTP alternativo) |
| 9090 | TCP | Prometheus |
| 3000 | TCP | Grafana / desenvolvimento Node.js |

Quando um navegador se conecta a `https://example.com`, ele se conecta a `93.184.216.34:443`. O sistema operacional atribui uma porta efêmera (por exemplo, `52413`) do lado do cliente, de modo que a conexão completa é `client_ip:52413 ↔ 93.184.216.34:443`.

---

## Protocolos de transporte

A camada de Transporte oferece dois modelos de entrega fundamentalmente diferentes:

=== "TCP — Transmission Control Protocol"

    O TCP estabelece uma **conexão** antes de trocar dados e garante que:

    - Cada byte seja entregue exatamente uma vez, em ordem
    - Pacotes perdidos sejam retransmitidos automaticamente
    - O remetente desacelere se o destinatário estiver sobrecarregado (controle de fluxo)

    O estabelecimento da conexão usa um **three-way handshake** (aperto de mão em três etapas):

    ``` mermaid
    sequenceDiagram
        participant C as Cliente
        participant S as Servidor
        C->>S: SYN (número de sequência = x)
        S-->>C: SYN-ACK (sequência = y, ack = x+1)
        C->>S: ACK (ack = y+1)
        Note over C,S: Conexão estabelecida — começa a transferência de dados
    ```

    **Use quando:** a correção importa mais do que a velocidade — HTTP, HTTPS, conexões com bancos de dados, SSH.

=== "UDP — User Datagram Protocol"

    O UDP envia **datagramas** sem estabelecer conexão, sem garantia de entrega e sem ordenação.

    - Sem handshake — menor latência
    - Sem retransmissão — se um pacote se perde, ele se foi
    - A aplicação precisa cuidar da ordenação e da confiabilidade, se necessário

    **Use quando:** a velocidade importa mais do que a completude — consultas DNS, streaming de vídeo, jogos online, VoIP.

| | TCP | UDP |
|---|---|---|
| **Conexão** | Obrigatória (3-way handshake) | Nenhuma |
| **Garantia de entrega** | Sim — retransmite pacotes perdidos | Não |
| **Ordenação** | Sim — os bytes chegam em sequência | Não |
| **Velocidade** | Mais lento (custo da confiabilidade) | Mais rápido |
| **Casos de uso** | HTTP, HTTPS, SSH, bancos de dados | DNS, vídeo, VoIP, jogos |

---

## Redes públicas

Um **endereço IP público** é um endereço globalmente único, atribuído por um Registro Regional de Internet (RIR) e roteável na internet. Qualquer servidor que você queira acessar a partir da internet pública precisa ter um IP público — ou ser alcançável por meio de um, via NAT.

Os pacotes atravessam a internet saltando entre roteadores. Cada roteador conhece apenas o *próximo salto* em direção ao destino — um mapa parcial guardado em uma **tabela de roteamento**. O **BGP (Border Gateway Protocol)** é o protocolo de roteamento entre domínios que permite aos ISPs trocar esses mapas e, coletivamente, saber como alcançar cada bloco de endereços públicos da internet[^9].

``` mermaid
flowchart LR
    client["Cliente\n203.0.113.5"]
    r1["Roteador do ISP\nBrasil"]
    r2["Roteador\nde backbone"]
    r3["Roteador do ISP\nEUA"]
    server["Servidor\n93.184.216.34\nexample.com"]

    client -->|"salto 1"| r1
    r1 -->|"salto 2"| r2
    r2 -->|"salto 3"| r3
    r3 -->|"salto 4"| server
```

Cada salto leva de 1 a 30 ms, dependendo da distância física e do congestionamento. Uma ida e volta transatlântica normalmente acrescenta de 80 a 120 ms de latência só pela velocidade da luz na fibra.

---

## Redes privadas

Uma **rede privada** é uma rede que não é diretamente alcançável a partir da internet pública. Os dispositivos dentro dela se comunicam livremente entre si, mas hosts externos não conseguem iniciar conexões com endereços privados.

### Faixas privadas da RFC 1918

Três faixas de endereços IPv4 são reservadas permanentemente para uso privado[^2]. Nunca há roteamento na internet pública para elas:

| Faixa (CIDR) | Endereços | Uso típico |
|---|---|---|
| `10.0.0.0/8` | ~16,7 milhões | Grandes redes corporativas, VPCs na nuvem (AWS, GCP) |
| `172.16.0.0/12` | ~1 milhão | Redes de porte médio, bridge padrão do Docker (`172.17.0.0/16`) |
| `192.168.0.0/16` | 65.536 | Roteadores domésticos, redes de pequenos escritórios |

### NAT — Network Address Translation

O NAT permite que uma rede privada inteira compartilhe um único endereço IP público. O dispositivo de NAT (roteador ou firewall) mantém uma **tabela de tradução** que mapeia cada conexão de saída para uma porta pública efêmera.

``` mermaid
sequenceDiagram
    participant D as Dispositivo\n192.168.1.10:52413
    participant N as Roteador NAT\nPúblico: 203.0.113.1
    participant S as Servidor\n93.184.216.34:443

    D->>N: src=192.168.1.10:52413\ndst=93.184.216.34:443
    Note over N: Registra o mapeamento:\n192.168.1.10:52413 ↔ 203.0.113.1:61000
    N->>S: src=203.0.113.1:61000\ndst=93.184.216.34:443
    S-->>N: src=93.184.216.34:443\ndst=203.0.113.1:61000
    Note over N: Consulta a tabela:\n61000 → 192.168.1.10:52413
    N-->>D: src=93.184.216.34:443\ndst=192.168.1.10:52413
```

O servidor nunca vê o endereço privado do dispositivo — ele só vê o IP público do roteador. O roteador controla qual dispositivo interno é dono de cada conexão de saída mapeando a porta efêmera.

### Redes privadas no Docker

O Docker usa o modelo de rede privada para isolar containers. Cada projeto do Compose ganha a sua própria rede virtual — uma sub-rede definida por software, normalmente na faixa `172.x.x.x`.

``` mermaid
flowchart LR
    subgraph host ["Host Docker — 203.0.113.1 público"]
        subgraph net ["Rede Docker 172.20.0.0/16"]
            nginx["nginx\n172.20.0.2:80"]
            gateway["gateway\n172.20.0.3:8080"]
            db["postgres\n172.20.0.4:5432"]
            nginx --> gateway
            gateway --> db
        end
    end
    internet[Internet] -->|"porta 80\npublicada"| nginx
    internet -.-x|"sem acesso direto"| gateway
    internet -.-x|"sem acesso direto"| db
```

Somente o `nginx` tem um mapeamento `ports:` no `compose.yaml` e é alcançável de fora do host. O `gateway` e o `db` ficam dentro da rede privada do Docker — eles se comunicam entre si pelo nome do serviço, mas são invisíveis para a internet.

---

## Endereços especiais

### Loopback

`127.0.0.0/8` — pacotes enviados para essa faixa nunca saem do host. `127.0.0.1` (`localhost`) é o endereço convencional para testar servidores locais. O sistema operacional resolve o tráfego de loopback dentro do kernel, sem nunca tocar no hardware de rede.

### Link-local (APIPA)

`169.254.0.0/16` — atribuído automaticamente quando um dispositivo não consegue alcançar um servidor DHCP. Esses endereços só funcionam para a comunicação direta entre dois dispositivos no mesmo enlace físico. Ver `169.254.x.x` em uma máquina quase sempre significa que o DHCP falhou.

---

## Endereços IPv4 reservados [^4]

### Endereços IPv4 reservados em geral

| Bloco de endereços (CIDR) | Faixa de endereços | Endereços | Escopo | Descrição |
|---|---|---|---|---|
| `0.0.0.0/8` | 0.0.0.0 – 0.255.255.255 | 16.777.216 | Software | Rede atual (local, "esta" rede) |
| `10.0.0.0/8` | 10.0.0.0 – 10.255.255.255 | 16.777.216 | Privado | Faixa privada da RFC 1918 |
| `100.64.0.0/10` | 100.64.0.0 – 100.127.255.255 | 4.194.304 | Compartilhado | NAT de operadora (carrier-grade, interno do ISP) |
| `127.0.0.0/8` | 127.0.0.0 – 127.255.255.255 | 16.777.216 | Host | Loopback — fica no host local |
| `169.254.0.0/16` | 169.254.0.0 – 169.254.255.255 | 65.536 | Sub-rede | Link-local / APIPA (falha de DHCP) |
| `172.16.0.0/12` | 172.16.0.0 – 172.31.255.255 | 1.048.576 | Privado | Faixa privada da RFC 1918 |
| `192.168.0.0/16` | 192.168.0.0 – 192.168.255.255 | 65.536 | Privado | Faixa privada da RFC 1918 |
| `198.18.0.0/15` | 198.18.0.0 – 198.19.255.255 | 131.072 | Privado | Testes de desempenho (benchmark) |
| `198.51.100.0/24` | 198.51.100.0 – 198.51.100.255 | 256 | Documentação | TEST-NET-2 |
| `203.0.113.0/24` | 203.0.113.0 – 203.0.113.255 | 256 | Documentação | TEST-NET-3 |
| `224.0.0.0/4` | 224.0.0.0 – 239.255.255.255 | 268.435.456 | Internet | Multicast |
| `255.255.255.255/32` | 255.255.255.255 | 1 | Sub-rede | Broadcast limitado |

### Faixas IPv4 privadas (RFC 1918) [^2]

| Bloco de endereços (CIDR) | Faixa de endereços | Endereços | Uso típico |
|---|---|---|---|
| `10.0.0.0/8` | 10.0.0.0 – 10.255.255.255 | 16.777.216 | Grandes redes corporativas / VPCs na nuvem |
| `172.16.0.0/12` | 172.16.0.0 – 172.31.255.255 | 1.048.576 | Redes de porte médio / Docker |
| `192.168.0.0/16` | 192.168.0.0 – 192.168.255.255 | 65.536 | Residências / pequenos escritórios |

---

[^1]: [List of reserved IP addresses — Wikipedia](https://en.wikipedia.org/wiki/List_of_reserved_IP_addresses){target="_blank"}
[^2]: [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){target="_blank"}
[^3]: [Private Network — Wikipedia](https://en.wikipedia.org/wiki/Private_network){target="_blank"}
[^4]: [Reserved IP Addresses — Wikipedia](https://en.wikipedia.org/wiki/Reserved_IP_addresses){target="_blank"}
[^5]: [RFC 791 — Internet Protocol](https://datatracker.ietf.org/doc/html/rfc791){target="_blank"}
[^6]: [IPv6 Adoption — Google](https://www.google.com/intl/en/ipv6/){target="_blank"}
[^7]: [IANA IPv4 Address Space Registry](https://www.iana.org/assignments/ipv4-address-space/ipv4-address-space.xhtml){target="_blank"}
[^8]: [RFC 1034 — Domain Names: Concepts and Facilities](https://datatracker.ietf.org/doc/html/rfc1034){target="_blank"}
[^9]: [RFC 4271 — BGP-4](https://datatracker.ietf.org/doc/html/rfc4271){target="_blank"}
