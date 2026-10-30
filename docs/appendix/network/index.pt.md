
Toda chamada num sistema de microsserviços atravessa uma rede: o navegador chega ao gateway, o gateway chama um serviço, o serviço consulta o seu banco. Neste curso esses saltos acontecem dentro de redes Docker, clusters Kubernetes e VPCs na nuvem, e quando um deles falha ("connection refused", "timeout", "could not resolve host"), a causa está em uma das camadas descritas aqui. Esta página dá a visão geral: o que é a internet, como os dados são embrulhados em camadas e como um pacote atravessa a internet pública. As três páginas seguintes aprofundam endereços, portas e nomes.

---

## O que é a internet { #internet }

A **internet** é uma rede global de redes — uma teia de computadores, roteadores e data centers interconectados que se comunicam por meio de um conjunto comum de protocolos padronizados. Nenhuma organização é dona da internet; ela é uma colaboração entre provedores de acesso (ISPs), governos, universidades e empresas, que concordam em seguir as mesmas regras para que suas redes possam interoperar.

Os dados trafegam pela internet como **pacotes** — pequenos pedaços de tamanho variável, de no máximo 1.500 bytes numa rede Ethernet ou Wi-Fi típica. Um arquivo ou uma página web é dividido em muitos pacotes, e cada um é roteado de forma independente pela rede e remontado no destino. Esse modelo de *comutação de pacotes* é resiliente: se uma rota estiver congestionada ou interrompida, os pacotes encontram um caminho alternativo.

---

## A pilha TCP/IP { #tcp-ip-stack }

A internet é construída sobre uma arquitetura em camadas. Cada camada resolve um problema específico e depende da camada abaixo dela. O **modelo TCP/IP** tem quatro camadas[^1]:

| Camada | Protocolos | Responsabilidade |
|---|---|---|
| **Aplicação** | HTTP, HTTPS, DNS, SMTP, SSH | Define como as aplicações trocam dados |
| **Transporte** | TCP, UDP | Entrega dados entre processos em dois hosts (portas) |
| **Internet** | IP (IPv4, IPv6), ICMP | Roteia pacotes da origem ao destino através das redes |
| **Enlace** | Ethernet, Wi-Fi, ARP | Move quadros (frames) entre dispositivos da mesma rede local |

Cada camada embrulha os dados da camada de cima com o seu próprio cabeçalho — o **encapsulamento** — e o receptor desembrulha na ordem inversa. Reproduza o diagrama para acompanhar uma requisição descendo a pilha do cliente, atravessando o fio e subindo a pilha do servidor:

``` diagram-sim
flowchart TB
    subgraph client ["Cliente"]
        ca["Aplicação<br/>HTTP GET /"]
        ct["Transporte<br/>segmento TCP: + portas"]
        ci["Internet<br/>pacote IP: + endereços IP"]
        cl["Enlace<br/>quadro Ethernet: + endereços MAC"]
    end
    subgraph server ["Servidor"]
        sl["Enlace<br/>quadro conferido, cabeçalho removido"]
        si["Internet<br/>pacote para o meu IP? sim"]
        st["Transporte<br/>segmento para a porta 443"]
        sa["Aplicação<br/>requisição HTTP atendida"]
    end
    ca -->|"embrulha"| ct
    ct -->|"embrulha"| ci
    ci -->|"embrulha"| cl
    cl -->|"meio físico<br/>(cabo / Wi-Fi / fibra)"| sl
    sl -->|"desembrulha"| si
    si -->|"desembrulha"| st
    st -->|"desembrulha"| sa
```

Quando você abre `https://example.com`, o navegador entrega uma requisição HTTP à camada de Aplicação; o TCP a envolve em um segmento com as **portas** de origem e de destino; o IP envolve isso em um pacote com os **endereços IP** de origem e de destino; e a Ethernet monta o quadro para a rede local. Cada roteador no caminho remove e recoloca o quadro da camada de Enlace, usando a camada de Internet para decidir o próximo salto (hop).

As camadas correspondem ao resto desta seção: os [endereços IP](addressing/index.md) pertencem à camada de Internet, [portas, TCP e UDP](transport/index.md) à camada de Transporte, e o [DNS](dns/index.md) é uma aplicação de que quase todas as outras precisam antes de enviar o primeiro pacote.

---

## Atravessando a internet pública { #public-internet }

Um **endereço IP público** é um endereço globalmente único, atribuído por um Registro Regional de Internet (RIR) e roteável na internet. Qualquer servidor que você queira alcançar a partir da internet pública precisa ter um IP público — ou ser alcançável por meio de um, via NAT ([Endereçamento e NAT](addressing/index.md#nat)).

Os pacotes atravessam a internet saltando entre roteadores. Cada roteador conhece apenas o *próximo salto* em direção ao destino — um mapa parcial guardado em uma **tabela de roteamento**. O **BGP (Border Gateway Protocol)** é o protocolo de roteamento entre domínios que permite aos ISPs trocar esses mapas e, coletivamente, saber como alcançar cada bloco de endereços públicos da internet[^2].

``` diagram-sim
flowchart LR
    client["Cliente<br/>203.0.113.5"]
    r1["Roteador do ISP<br/>Brasil"]
    r2["Roteador<br/>de backbone"]
    r3["Roteador do ISP<br/>EUA"]
    server["Servidor<br/>198.51.100.20"]
    client -->|"salto 1"| r1
    r1 -->|"salto 2"| r2
    r2 -->|"salto 3"| r3
    r3 -->|"salto 4"| server
```

Cada salto acrescenta um pouco de tempo de processamento e de fila, mas em longas distâncias o piso é dado pela física. A luz na fibra óptica viaja a cerca de 200.000 km/s[^3], uns dois terços da velocidade no vácuo. São Paulo e o norte da Virgínia (onde ficam muitas regiões de nuvem) estão a cerca de 7.700 km em linha reta, então uma ida e volta entre eles leva pelo menos uns 77 ms antes de qualquer roteador fazer qualquer coisa — e os cabos reais são mais longos que uma linha reta. Nenhum protocolo e nenhum servidor mais rápido elimina esse atraso; só aproximar o servidor do usuário (uma região próxima, uma CDN).

Você pode ver os saltos por conta própria: o `traceroute` (`tracert` no Windows) envia pacotes que expiram um salto mais adiante a cada vez e imprime uma linha por roteador, com três tempos de ida e volta cada.

```bash
traceroute example.com
```

Os endereços do diagrama pertencem a blocos reservados para documentação (RFC 5737), como os outros exemplos desta seção; um trace real mostra endereços reais.

---

## Para onde ir agora { #next }

<div class="grid cards" markdown>

-   __[Endereçamento e NAT](addressing/index.md)__

    ---

    IPv4 e IPv6, blocos CIDR, faixas públicas e privadas, como o NAT deixa uma rede inteira compartilhar um endereço e como o Docker usa redes privadas.

-   __[Portas, TCP e UDP](transport/index.md)__

    ---

    Como uma porta escolhe um processo num host, o three-way handshake e quanto custa a confiabilidade do TCP comparada ao UDP.

-   __[DNS](dns/index.md)__

    ---

    Como um nome vira um endereço, os tipos de registro, o `dig` e por que o TTL troca atualidade por carga.

-   __[Quiz](quiz.md)__

    ---

    Confira o que você aprendeu na seção.

</div>

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - A internet é uma rede de redes que concordam em protocolos comuns; os dados viajam em pequenos pacotes, cada um roteado por conta própria.
    - O TCP/IP tem quatro camadas (aplicação, transporte, internet, enlace); cada uma embrulha os dados da camada de cima com o seu próprio cabeçalho.
    - Roteadores encaminham um pacote um salto por vez usando tabelas de roteamento; o BGP é como as redes contam umas às outras quais blocos de endereços alcançam.
    - A distância impõe um piso à latência: a luz na fibra precisa de pelo menos uns 77 ms para uma ida e volta São Paulo – Virgínia.

---

[^1]: [RFC 1122 — Requirements for Internet Hosts: Communication Layers](https://datatracker.ietf.org/doc/html/rfc1122){target="_blank"}
[^2]: [RFC 4271 — BGP-4](https://datatracker.ietf.org/doc/html/rfc4271){target="_blank"}
[^3]: [Optical fiber — Wikipedia (em inglês)](https://en.wikipedia.org/wiki/Optical_fiber){target="_blank"}
