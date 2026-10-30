
Todo pacote leva um **endereço IP** de origem e um de destino, e quase todo problema de rede neste curso se resume a uma pergunta: *esse endereço é alcançável de onde o pacote parte?* Um contêiner fala com o `db` em `172.18.0.3`, um pod recebe um endereço `10.x` do cluster, um banco na nuvem fica numa sub-rede privada, e o seu notebook compartilha um endereço público com todo mundo da sua casa. Esta página explica como os endereços são escritos (IPv4, IPv6, CIDR), quais faixas são públicas e quais são privadas, como o NAT permite que uma rede privada alcance a internet e como o Docker se apoia em tudo isso.

---

## Endereços IP { #ip }

Todo dispositivo em uma rede é identificado por um **endereço IP** — um número que diz aos roteadores para onde entregar os pacotes. Endereços IP têm duas partes: um **prefixo de rede** (identifica a rede) e um **identificador de host** (identifica o dispositivo específico dentro dessa rede).

### IPv4 { #ipv4 }

O IPv4 usa endereços de **32 bits** escritos em notação decimal pontuada — quatro octetos separados por pontos[^1]:

```
192  . 168  .   1  .  42
 ↑       ↑      ↑      ↑
8 bits  8 bits 8 bits  8 bits   →  total 32 bits
```

O IPv4 oferece 2³² ≈ **4,3 bilhões** de endereços únicos. Isso parecia enorme em 1981 — não era. O crescimento da internet, dos smartphones, dos dispositivos IoT e dos servidores na nuvem esgotou o estoque: a IANA entregou os seus últimos blocos livres aos cinco Registros Regionais de Internet em fevereiro de 2011, e os registros se esgotaram nos anos seguintes (APNIC em 2011, ARIN em 2015, RIPE NCC em 2019)[^2]. Hoje, endereços IPv4 novos são comprados, alugados ou compartilhados via NAT.

### Blocos CIDR { #cidr }

A **notação CIDR** (Classless Inter-Domain Routing) acrescenta a um endereço o comprimento do prefixo para descrever uma faixa inteira: `192.168.1.0/24` significa que os primeiros 24 bits identificam a rede, sobrando 8 bits para hosts — 2⁸ = 256 endereços (de `192.168.1.0` a `192.168.1.255`). Em geral, um bloco `/p` tem 2³²⁻ᵖ endereços: cada bit acrescentado ao prefixo corta o bloco pela metade.

Dois endereços de uma rede clássica não vão para hosts: o primeiro (a própria rede) e o último (broadcast). As nuvens reservam alguns a mais — uma sub-rede AWS reserva 5. Por isso um `/24` dá 254 hosts utilizáveis numa rede de casa, mas 251 numa sub-rede AWS.

Explore um bloco: digite um endereço, arraste o prefixo, divida o bloco em sub-redes e teste se um endereço cai dentro dele.

<div class="netsim" data-tool="cidr" data-cidr="192.168.1.0/24"></div>

!!! tip "Experimente"
    O explorador começa com `192.168.1.0/24`, uma rede de casa típica: 24 bits de rede e 8 de host dão 256 endereços, dos quais 254 são utilizáveis (`192.168.1.1 – 192.168.1.254`); a linha **tipo do endereço** diz que ele é privado, dentro de `192.168.0.0/16`. Arraste o prefixo até `/16`: o bloco vira `192.168.0.0/16`, com 65.536 endereços. De volta ao `/24`, escolha **Dividir em 4 sub-redes**: você obtém quatro blocos `/26` de 64 endereços (`192.168.1.0/26`, `192.168.1.64/26`, `192.168.1.128/26`, `192.168.1.192/26`); teste `192.168.1.130` e o explorador o coloca em `192.168.1.128/26`. Por fim, digite `172.17.0.0/16`, a rede bridge padrão do Docker: privada, dentro de `172.16.0.0/12`.

### IPv6 { #ipv6 }

O IPv6 usa endereços de **128 bits** escritos em oito grupos de quatro dígitos hexadecimais:

```
2001:0db8:85a3:0000:0000:8a2e:0370:7334
```

Os zeros à esquerda de cada grupo podem ser omitidos, e uma sequência de grupos só de zeros pode ser comprimida em `::` — `2001:db8:85a3::8a2e:370:7334`.

O IPv6 oferece 2¹²⁸ ≈ **3,4 × 10³⁸** endereços — o suficiente para cada grão de areia da Terra ter o seu. Mesmo assim, o IPv4 continua em toda parte, porque a transição exige atualizar todo equipamento de rede, sistema operacional e aplicação, e a maioria das redes roda os dois protocolos lado a lado (*dual stack*).

| | IPv4 | IPv6 |
|---|---|---|
| **Tamanho do endereço** | 32 bits | 128 bits |
| **Notação** | Decimal pontuada (`192.168.1.1`) | Grupos hexadecimais (`2001:db8::1`) |
| **Espaço de endereços** | ~4,3 bilhões | ~3,4 × 10³⁸ |
| **Precisa de NAT?** | Sim — o esgotamento de endereços obriga | Não — cada dispositivo pode ter um endereço unicast global |
| **Adoção** | Universal | Cerca de metade dos usuários do Google chega a ele por IPv6 (em torno de 45–50%, conforme o dia)[^3] |

---

## Endereços públicos e privados { #private }

Um **endereço público** é único em toda a internet e roteado por ela (veja [a visão geral](../index.md#public-internet)). Uma **rede privada** é uma rede que não é diretamente alcançável a partir da internet pública[^4]. Os dispositivos dentro dela se comunicam livremente entre si, mas hosts externos não conseguem iniciar conexões com endereços privados.

### Faixas privadas da RFC 1918 { #rfc1918 }

Três faixas de endereços IPv4 são reservadas permanentemente para uso privado[^5]. Qualquer rede pode reutilizá-las, e a internet pública nunca as roteia:

| Faixa (CIDR) | Endereços | Uso típico |
|---|---|---|
| `10.0.0.0/8` | 16.777.216 | Grandes redes corporativas, VPCs na nuvem (AWS, GCP), redes de pods do Kubernetes |
| `172.16.0.0/12` | 1.048.576 | Redes de porte médio, Docker (bridge padrão `172.17.0.0/16`) |
| `192.168.0.0/16` | 65.536 | Roteadores domésticos, redes de pequenos escritórios |

Como todos reutilizam as mesmas faixas, um endereço privado não significa nada fora da sua própria rede: `192.168.1.10` é uma máquina diferente em cada casa. Para chegar à internet, uma rede privada precisa de NAT.

---

## NAT — Network Address Translation { #nat }

O NAT permite que uma rede privada inteira compartilhe um único endereço IP público. O dispositivo de NAT (um roteador doméstico, um firewall, um NAT gateway na nuvem) troca a origem privada de cada pacote que sai pelo seu próprio endereço público e por uma porta livre, e anota o par numa **tabela de tradução**. Quando a resposta volta para aquela porta pública, a tabela diz para qual host privado entregá-la.

``` diagram-sim
sequenceDiagram
    participant D as Dispositivo<br/>192.168.1.10
    participant N as Roteador NAT<br/>público 203.0.113.7
    participant S as Servidor<br/>198.51.100.20:443
    participant X as Estranho<br/>192.0.2.66
    D->>N: origem 192.168.1.10:52241 → destino 198.51.100.20:443
    Note over N: nova linha: 192.168.1.10:52241 ⇄ 203.0.113.7:40001
    N->>S: origem 203.0.113.7:40001 → destino 198.51.100.20:443
    S-->>N: origem 198.51.100.20:443 → destino 203.0.113.7:40001
    Note over N: linha de :40001 encontrada → volta para 192.168.1.10:52241
    N-->>D: origem 198.51.100.20:443 → destino 192.168.1.10:52241
    X->>N: nova conexão para 203.0.113.7:22
    Note over N: nenhuma linha para :22 → descartado
```

O servidor nunca vê o endereço privado do dispositivo — só o IP público do roteador. Daí vêm várias consequências:

- **Conexões só começam de dentro.** Uma resposta encontra a sua linha na tabela; um pacote que ninguém lá dentro pediu não tem linha, então o roteador não tem como saber qual host privado deveria recebê-lo e o descarta. Muitos roteadores domésticos também conferem a origem: uma linha só aceita pacotes da ponta remota para a qual foi criada.
- **O redirecionamento de portas publica um serviço.** Para aceitar conexões de fora, você cria uma regra fixa — "pacotes para a porta pública 8080 vão para `192.168.1.20:8080`". Essa reescrita inversa é o *NAT de destino*; o `ports:` do Docker faz exatamente isso no host.
- **Linhas expiram.** Um NAT não pode guardar uma linha para sempre, então apaga as que ficam ociosas. As normas fixam mínimos: pelo menos 2 minutos para UDP (5 recomendados)[^6] e pelo menos 2 horas e 4 minutos para uma conexão TCP estabelecida[^7]. Conexões longas e ociosas (um pool de banco, um WebSocket) mandam keep-alives para que a linha sobreviva.
- **Muitos clientes, um endereço.** O servidor vê todos atrás de um NAT como o mesmo IP. Operadoras móveis chegam a rodar *NAT de operadora* (CGNAT) a partir da faixa compartilhada `100.64.0.0/10`[^8], então milhares de celulares podem compartilhar um endereço público — por isso limites de taxa por IP são uma ferramenta grosseira.

Experimente: abra conexões, deixe o servidor responder e veja um estranho falhar ao tentar entrar.

<div class="csim" data-sim="nat" data-timeout="60"></div>

!!! tip "Experimente"
    Aperte **notebook → HTTPS**: o roteador escreve a linha `192.168.1.10:52241` ⇄ `203.0.113.7:40001`. Aperte **servidor responde**: a resposta para a porta 40001 é traduzida de volta para o notebook. Aperte **celular → HTTPS**: uma segunda linha, `192.168.1.11:54584` ⇄ `203.0.113.7:40002` — o mesmo endereço público, diferenciado só pela porta. Agora aperte **estranho → :8080**: sem linha, descartado. **Estranho → porta da linha mais nova** também falha: a linha de 40002 só aceita `198.51.100.20:443`. Ligue o redirecionamento e tente o estranho na 8080 de novo: agora ele chega a `192.168.1.20:8080`. Por fim, aperte play: cada passo é 5 s, e com o timeout ocioso de 60 s as linhas somem após 12 passos; uma resposta do servidor depois disso é descartada.

---

## Redes privadas no Docker { #docker }

O Docker usa o modelo de rede privada para isolar contêineres. Cada projeto Compose ganha a sua própria rede virtual (`<projeto>_default`) — uma sub-rede definida por software, normalmente na faixa `172.x.x.x`. Os contêineres nela se alcançam pelo nome do serviço, por meio do servidor DNS embutido do Docker[^9] ([DNS](../dns/index.md#docker-kubernetes)).

``` diagram
flowchart LR
    subgraph host ["Host Docker — público 203.0.113.1"]
        subgraph net ["Rede Docker 172.20.0.0/16"]
            nginx["nginx<br/>172.20.0.2:80"]
            gateway["gateway<br/>172.20.0.3:8080"]
            db["postgres<br/>172.20.0.4:5432"]
            nginx --> gateway
            gateway --> db
        end
    end
    internet["Internet"] -->|"porta 80<br/>publicada"| nginx
    internet -.-x|"sem acesso direto"| gateway
    internet -.-x|"sem acesso direto"| db
```

```yaml
services:
  nginx:
    image: nginx:1.27
    ports:
      - "80:80"          # host port 80 → container port 80 (published)
  gateway:
    build: ./gateway     # no ports: reachable only inside the network
  db:
    image: postgres:17   # no ports: reachable only inside the network
```

Só o `nginx` tem um mapeamento `ports:` no `compose.yaml` e é alcançável de fora do host. O `gateway` e o `db` estão dentro da rede privada do Docker — eles se comunicam entre si pelo nome do serviço, mas são invisíveis para a internet. As duas direções são NAT no host: uma porta publicada é NAT de destino (`:80` do host → `172.20.0.2:80`), e um contêiner que chama a internet sai por NAT de origem (masquerading), com o endereço do host como origem. No Linux, o Docker monta os dois com regras de iptables[^10].

---

## Endereços especiais e reservados { #special }

### Loopback { #loopback }

`127.0.0.0/8` — pacotes enviados para essa faixa nunca saem do host. `127.0.0.1` (`localhost`) é o endereço convencional para testar servidores locais. O sistema operacional resolve o tráfego de loopback dentro do kernel, sem nunca tocar no hardware de rede. Dentro de um contêiner, `localhost` é o próprio contêiner, não a sua máquina: um serviço no Compose deve chamar `db:5432`, não `localhost:5432`.

### Link-local (APIPA) { #link-local }

`169.254.0.0/16` — atribuído automaticamente quando um dispositivo não consegue alcançar um servidor DHCP. Esses endereços só funcionam para a comunicação direta entre dois dispositivos no mesmo enlace físico. Ver `169.254.x.x` numa máquina quase sempre significa que o DHCP falhou. As nuvens também usam um deles de propósito: `169.254.169.254` é o serviço de metadados da instância, alcançável só de dentro da máquina virtual.

### Endereços IPv4 reservados { #reserved }

Os blocos abaixo têm significados especiais e nunca são atribuídos como endereços públicos comuns[^11]:

| Bloco (CIDR) | Faixa | Endereços | Escopo | Descrição |
|---|---|---|---|---|
| `0.0.0.0/8` | 0.0.0.0 – 0.255.255.255 | 16.777.216 | Software | Rede atual (local, "esta" rede) |
| `10.0.0.0/8` | 10.0.0.0 – 10.255.255.255 | 16.777.216 | Privado | Faixa privada da RFC 1918 |
| `100.64.0.0/10` | 100.64.0.0 – 100.127.255.255 | 4.194.304 | Compartilhado | NAT de operadora (interno ao ISP) |
| `127.0.0.0/8` | 127.0.0.0 – 127.255.255.255 | 16.777.216 | Host | Loopback — fica no host local |
| `169.254.0.0/16` | 169.254.0.0 – 169.254.255.255 | 65.536 | Sub-rede | Link-local / APIPA (falha de DHCP), metadados da nuvem |
| `172.16.0.0/12` | 172.16.0.0 – 172.31.255.255 | 1.048.576 | Privado | Faixa privada da RFC 1918 |
| `192.0.2.0/24` | 192.0.2.0 – 192.0.2.255 | 256 | Documentação | TEST-NET-1 |
| `192.168.0.0/16` | 192.168.0.0 – 192.168.255.255 | 65.536 | Privado | Faixa privada da RFC 1918 |
| `198.18.0.0/15` | 198.18.0.0 – 198.19.255.255 | 131.072 | Privado | Testes de benchmark |
| `198.51.100.0/24` | 198.51.100.0 – 198.51.100.255 | 256 | Documentação | TEST-NET-2 |
| `203.0.113.0/24` | 203.0.113.0 – 203.0.113.255 | 256 | Documentação | TEST-NET-3 |
| `224.0.0.0/4` | 224.0.0.0 – 239.255.255.255 | 268.435.456 | Internet | Multicast |
| `240.0.0.0/4` | 240.0.0.0 – 255.255.255.254 | 268.435.455 | Internet | Reservado para uso futuro (antiga classe E) |
| `255.255.255.255/32` | 255.255.255.255 | 1 | Sub-rede | Broadcast limitado |

Os três blocos de documentação são os que se usam em exemplos, slides e testes — como todo endereço desta página que não é privado.

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Um endereço IPv4 tem 32 bits; um bloco CIDR `/p` fixa os primeiros p bits e contém 2³²⁻ᵖ endereços — cada bit a mais no prefixo o corta pela metade.
    - O IPv4 se esgotou; o IPv6 tem endereços de 128 bits e cerca de metade dos usuários do Google já chega a ele por IPv6, mas a maioria das redes roda os dois.
    - `10.0.0.0/8`, `172.16.0.0/12` e `192.168.0.0/16` são privados (RFC 1918): reutilizáveis em qualquer lugar, nunca roteados na internet.
    - O NAT reescreve ip:porta privado em ip:porta público e guarda o par; respostas são traduzidas de volta, pacotes não solicitados são descartados e linhas ociosas expiram.
    - Publicar um serviço de uma rede privada exige um redirecionamento de porta (NAT de destino) — o `ports:` do Docker —, enquanto todo o resto continua inalcançável de fora.

---

[^1]: [RFC 791 — Internet Protocol](https://datatracker.ietf.org/doc/html/rfc791){target="_blank"}
[^2]: [IPv4 address exhaustion — Wikipedia (em inglês)](https://en.wikipedia.org/wiki/IPv4_address_exhaustion){target="_blank"}; [IANA IPv4 Address Space Registry](https://www.iana.org/assignments/ipv4-address-space/ipv4-address-space.xhtml){target="_blank"}
[^3]: [IPv6 Adoption — Google](https://www.google.com/intl/en/ipv6/statistics.html){target="_blank"} (estatísticas ao vivo; passou de 50% pela primeira vez em 28 de março de 2026, segundo o [Internet Society Pulse](https://pulse.internetsociety.org/blog/18-years-later-ipv6-reaches-majority){target="_blank"})
[^4]: [Private Network — Wikipedia (em inglês)](https://en.wikipedia.org/wiki/Private_network){target="_blank"}
[^5]: [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){target="_blank"}
[^6]: [RFC 4787 — NAT Behavioral Requirements for Unicast UDP](https://datatracker.ietf.org/doc/html/rfc4787){target="_blank"}, REQ-5
[^7]: [RFC 5382 — NAT Behavioral Requirements for TCP](https://datatracker.ietf.org/doc/html/rfc5382){target="_blank"}, REQ-5
[^8]: [RFC 6598 — IANA-Reserved IPv4 Prefix for Shared Address Space](https://datatracker.ietf.org/doc/html/rfc6598){target="_blank"}
[^9]: [Networking overview — Docker Docs](https://docs.docker.com/engine/network/){target="_blank"}
[^10]: [Docker with iptables — Docker Docs](https://docs.docker.com/engine/network/firewall-iptables/){target="_blank"}
[^11]: [List of reserved IP addresses — Wikipedia (em inglês)](https://en.wikipedia.org/wiki/List_of_reserved_IP_addresses){target="_blank"}
