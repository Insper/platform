
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** Qual é a finalidade de um **endereço IP público**?

- A. Identificar um dispositivo somente dentro de uma rede privada
- B. É um endereço único que identifica um dispositivo na internet pública, permitindo que outros servidores roteiem tráfego diretamente para ele
- C. É usado exclusivamente por roteadores para fazer NAT
- D. É reservado para a comunicação de loopback em um único host

??? success "Resposta"
    **B — Endereço único que identifica um dispositivo na internet pública.**

    Todo servidor acessível pela internet precisa ter um endereço IP público, para que pacotes vindos de qualquer lugar do mundo possam ser roteados até ele. Endereços IP privados (por exemplo, `192.168.x.x`) não são roteáveis na internet pública — só o IP público do roteador de borda é visível externamente.

---

**Q2.** Por que o **IPv6** foi desenvolvido para substituir o IPv4?

- A. O IPv4 era vulnerável a ataques de criptografia que o IPv6 resolve
- B. O espaço de endereços de 32 bits do IPv4 (~4,3 bilhões de endereços) se esgotou com o crescimento do número de dispositivos conectados à internet; o IPv6 usa endereços de 128 bits, oferecendo ~3,4 × 10³⁸ endereços
- C. O IPv4 só conseguia rotear pacotes dentro de redes privadas
- D. O IPv6 é mais rápido porque usa cabeçalhos de pacote menores

??? success "Resposta"
    **B — Esgotamento do espaço de endereços do IPv4.**

    A internet cresceu muito além do que se previa nos anos 1970. Com endereços de 32 bits, o IPv4 suporta ~4,3 bilhões de endereços únicos — menos do que o número de dispositivos que hoje se conectam à internet. O espaço de 128 bits do IPv6 oferece uma quantidade praticamente ilimitada de endereços, o suficiente para que cada grão de areia da Terra tenha o seu próprio endereço.

---

**Q3.** O que o **NAT (Network Address Translation)** permite?

- A. Traduzir nomes de domínio em endereços IP, como o DNS
- B. Criptografar o tráfego entre uma rede privada e a internet
- C. Permitir que vários dispositivos com endereços IP privados compartilhem um único endereço IP público ao se comunicar com a internet
- D. Atribuir endereços IP públicos permanentes a cada dispositivo de uma rede

??? success "Resposta"
    **C — Vários dispositivos privados compartilham um IP público.**

    Quando um dispositivo com o IP privado `192.168.1.10` envia um pacote para a internet, o roteador NAT substitui o endereço de origem pelo seu próprio IP público e registra o mapeamento. Quando a resposta chega, o NAT traduz o destino de volta para `192.168.1.10` e o encaminha ao dispositivo correto. É assim que uma rede doméstica inteira navega na internet por meio de um único IP do roteador.

---

**Q4.** Quais das alternativas abaixo são **faixas de endereços IPv4 privados** reservadas pela RFC 1918? Selecione todas as que se aplicam.

- A. `10.0.0.0/8`
- B. `172.16.0.0/12`
- C. `192.168.0.0/16`
- D. `8.8.8.0/24`

??? success "Resposta"
    **A, B e C — `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.**

    Essas três faixas são definidas como privadas pela RFC 1918 — elas não são roteáveis na internet pública e podem ser reutilizadas livremente dentro de qualquer rede privada. `8.8.8.8` é o servidor DNS público do Google — um endereço IP público, não privado.

---

**Q5.** O endereço `127.0.0.1` pertence ao bloco `127.0.0.0/8`. Qual é a sua finalidade?

- A. É o endereço de gateway padrão da maioria dos roteadores domésticos
- B. É o endereço de broadcast usado para enviar pacotes a todos os dispositivos de uma sub-rede
- C. É o endereço de loopback — pacotes enviados para essa faixa ficam no host local e nunca chegam à rede
- D. É um endereço multicast usado para streaming

??? success "Resposta"
    **C — Endereço de loopback; os pacotes ficam no host local.**

    `127.0.0.1` (comumente chamado de `localhost`) devolve os pacotes à própria máquina, sem envolver nenhum hardware de rede. Ele é usado para testar servidores locais (por exemplo, `http://localhost:8080`), para comunicação entre processos e para health checks. Todo o bloco `127.0.0.0/8` é reservado para essa finalidade.

---

**Q6.** No contexto do **Docker**, por que os containers são colocados em redes privadas?

- A. O Docker exige redes privadas por desempenho — IPs públicos acrescentam overhead demais
- B. Containers em uma rede privada podem se comunicar entre si pelo nome do serviço sem expor suas portas ao host ou à internet
- C. Containers Docker não suportam endereços IP públicos de forma alguma
- D. Redes privadas permitem que os containers contornem o firewall do sistema operacional do host

??? success "Resposta"
    **B — Os containers se comunicam internamente sem exposição à internet.**

    O Docker cria uma rede privada virtual para cada projeto do Compose. Os containers dentro dessa rede se alcançam pelo nome do serviço (por exemplo, `db`, `gateway`) usando o DNS interno do Docker. Somente os serviços com um mapeamento `ports:` no `compose.yaml` são alcançáveis de fora da rede do Docker — todos os demais são privados por padrão.

---

**Q7.** O que é a **notação CIDR** (por exemplo, `192.168.0.0/16`) e o que significa o `/16`?

- A. Ela especifica uma faixa de portas; `/16` significa que as portas 1–16 estão abertas
- B. É uma forma compacta de expressar uma faixa de endereços IP; `/16` significa que os primeiros 16 bits são o prefixo de rede, sobrando 16 bits para os endereços de host (65.536 endereços)
- C. Ela define o tamanho máximo de pacote para aquela rede
- D. Ela indica a profundidade da tradução NAT em redes aninhadas

??? success "Resposta"
    **B — Tamanho do prefixo de rede; `/16` = prefixo de 16 bits, 65.536 endereços de host.**

    O CIDR (Classless Inter-Domain Routing) substitui o antigo sistema de classes A/B/C. O número depois da `/` é o tamanho do prefixo — quantos bits iniciais identificam a rede. `192.168.0.0/16` tem 16 bits fixos (que identificam a rede `192.168.x.x`) e 16 bits livres para os hosts: 2¹⁶ = 65.536 endereços possíveis.

---

**Q8.** Um dispositivo tem o endereço IP `169.254.10.5`. O que isso diz sobre a sua configuração de rede?

- A. É um endereço de receptor multicast
- B. É um endereço de documentação, usado apenas em exemplos e RFCs
- C. O dispositivo não conseguiu obter um endereço IP de um servidor DHCP e se atribuiu um endereço link-local da faixa `169.254.0.0/16`
- D. É um endereço de NAT de operadora (carrier-grade) compartilhado entre assinantes de um ISP

??? success "Resposta"
    **C — Falha de DHCP; endereço link-local autoatribuído.**

    Quando um dispositivo não consegue alcançar um servidor DHCP, ele usa o **APIPA (Automatic Private IP Addressing)** para escolher um endereço aleatório de `169.254.0.0/16`. Esses endereços só funcionam para a comunicação dentro do mesmo enlace local — eles não alcançam roteadores, a internet ou outras sub-redes. Ver `169.254.x.x` geralmente significa que o dispositivo está sem conectividade de rede.

---

**Q9.** Qual é a diferença, na prática, entre as faixas privadas `10.0.0.0/8` e `192.168.0.0/16`?

- A. `10.0.0.0/8` é usada apenas em redes corporativas; `192.168.0.0/16` é apenas para redes domésticas
- B. `10.0.0.0/8` oferece ~16,7 milhões de endereços (adequada para grandes redes corporativas ou de nuvem); `192.168.0.0/16` oferece 65.536 endereços (típica de residências/pequenos escritórios)
- C. Elas têm o mesmo tamanho — a notação CIDR é apenas uma convenção de nomes
- D. `10.0.0.0/8` é IPv6; `192.168.0.0/16` é IPv4

??? success "Resposta"
    **B — Tamanhos diferentes para escalas diferentes.**

    `10.0.0.0/8` cobre todos os endereços de `10.0.0.0` a `10.255.255.255` — mais de 16 milhões de endereços. Os provedores de nuvem (VPCs da AWS, VPCs do GCP) normalmente usam essa faixa em suas redes internas. `192.168.0.0/16` cobre de `192.168.0.0` a `192.168.255.255` — 65.536 endereços, típica de roteadores domésticos (`192.168.0.x` ou `192.168.1.x`).

---

**Q10.** Quando um container Docker com o IP privado `172.18.0.3` envia uma requisição a um servidor público na internet, o que acontece na camada de NAT do host Docker?

- A. O pacote é descartado — containers com IPs privados não conseguem acessar a internet
- B. O Docker atribui ao container um IP público temporário enquanto durar a requisição
- C. O NAT do host Docker substitui o IP de origem privado do container pelo IP público do host, encaminha o pacote e, quando a resposta chega, a traduz de volta para `172.18.0.3`
- D. O servidor público vê `172.18.0.3` como origem e responde diretamente ao container

??? success "Resposta"
    **C — O NAT do host traduz IP privado → IP público na saída e desfaz a tradução na entrada.**

    O Docker usa regras de NAT do `iptables` do Linux no host. Quando o container em `172.18.0.3` envia um pacote para fora, o `iptables` substitui o IP de origem pelo IP público do host e registra o mapeamento. Quando a resposta chega ao IP público do host, o `iptables` desfaz a tradução e entrega o pacote a `172.18.0.3`, dentro do container. O servidor público nunca vê o endereço privado.
