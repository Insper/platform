
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

**Q4.** Qual das alternativas abaixo **não** é uma faixa de endereços IPv4 privados reservada pela RFC 1918?

- A. `10.0.0.0/8`
- B. `172.16.0.0/12`
- C. `192.168.0.0/16`
- D. `8.8.8.0/24`

??? success "Resposta"
    **D — `8.8.8.0/24` é pública.**

    A RFC 1918 define exatamente três faixas privadas — `10.0.0.0/8`, `172.16.0.0/12` e `192.168.0.0/16` —, que não são roteáveis na internet pública e podem ser reutilizadas livremente dentro de qualquer rede privada. `8.8.8.8` é o resolvedor DNS público do Google: um endereço público.

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

    No Linux, o Docker monta regras de NAT (iptables) no host. Quando o container em `172.18.0.3` envia um pacote para fora, o host substitui o IP de origem pelo seu próprio endereço (masquerading) e registra o mapeamento. Quando a resposta chega, o host desfaz a tradução e entrega o pacote a `172.18.0.3`. O servidor público nunca vê o endereço privado — é a mesma tabela de tradução de um roteador doméstico.

---

**Q11.** Um notebook em `192.168.1.10` abriu uma conexão com um servidor web, e o roteador NAT escreveu a linha `192.168.1.10:52241 ⇄ 203.0.113.7:40001`. Um host da internet que o notebook nunca contatou envia agora um pacote para `203.0.113.7:22`. O que acontece?

- A. O roteador o encaminha ao notebook, o único dispositivo com uma conexão aberta
- B. O roteador o descarta: nenhuma linha tem a porta pública 22, então ele não tem como saber qual host privado deveria recebê-lo
- C. O roteador o transmite para todos os dispositivos da rede privada
- D. O roteador responde ele mesmo, em nome do notebook

??? success "Resposta"
    **B — Descartado: nenhuma linha corresponde.**

    Um NAT só sabe para onde entregar pacotes de entrada que correspondam a uma linha criada por uma conexão de saída (ou a uma regra fixa de redirecionamento de porta). A porta 22 não tem nenhuma das duas, então o pacote é descartado. Muitos roteadores são ainda mais rígidos: mesmo um pacote para a porta 40001 é descartado se não vier da ponta remota para a qual a linha foi criada. É por isso que hosts atrás de um NAT conseguem iniciar conexões, mas não recebê-las.

---

**Q12.** Num `compose.yaml`, o serviço `gateway` tem `ports: - "8080:8080"` e o serviço `db` não tem `ports:`. Qual afirmação está correta?

- A. Os dois são alcançáveis de fora do host, porque estão na mesma rede
- B. O `gateway` é alcançável de fora do host na porta 8080 (o host a encaminha, como uma regra de redirecionamento); o `db` só é alcançável pelos outros contêineres da rede, como `db:5432`
- C. O `db` é inalcançável até para o `gateway`, porque não publica nenhuma porta
- D. O `gateway` precisa chamar `localhost:5432` para chegar ao banco

??? success "Resposta"
    **B — Porta publicada para o `gateway`, só rede interna para o `db`.**

    O `ports:` faz o host encaminhar a sua porta 8080 para o contêiner — NAT de destino, a mesma ideia de uma regra de redirecionamento num roteador doméstico. Sem ele, um serviço continua alcançável na rede do Compose, pelo nome, via o DNS embutido do Docker. Dentro de um contêiner, `localhost` é o próprio contêiner, então `localhost:5432` não chegaria ao banco.

---

**Q13.** A linha de NAT de uma conexão ociosa foi apagada após o seu timeout. Qual é a consequência, e o que as conexões de longa duração fazem a respeito?

- A. Nada muda: o próximo pacote do servidor recria a linha
- B. O próximo pacote do servidor é descartado, porque o roteador não sabe mais a qual host privado ele pertence; conexões longas e ociosas mandam keep-alives para que a linha nunca expire
- C. O roteador atribui à conexão um IP público permanente
- D. O endereço IP do host privado muda

??? success "Resposta"
    **B — Pacotes atrasados são descartados; keep-alives mantêm a linha viva.**

    As linhas só existem enquanto o tráfego as renova. As normas fixam timeouts ociosos mínimos (2 minutos para UDP, 2 horas e 4 minutos para TCP estabelecido), mas muitos equipamentos usam valores menores. Um pool de conexões de banco ou um WebSocket que fica em silêncio por mais tempo que isso quebra sem aviso, e por isso eles enviam pacotes de keep-alive periódicos.

---

**Q14.** Num enlace que perde 10% dos pacotes, um emissor transfere 20 segmentos com TCP e com UDP. O segmento 4 se perde. Por que a aplicação do receptor TCP recebe os segmentos 5 a 20 mais tarde que a do receptor UDP, mesmo que eles tenham chegado a tempo?

- A. O TCP envia segmentos mais devagar que o UDP
- B. O TCP entrega os bytes em ordem: os segmentos 5 a 20 esperam no buffer de recepção até o segmento 4 ser retransmitido, depois que o timer acaba (bloqueio de cabeça de fila)
- C. O UDP comprime os segmentos
- D. O TCP descarta os segmentos 5 a 20 e pede todos de novo

??? success "Resposta"
    **B — A entrega em ordem causa o bloqueio de cabeça de fila.**

    O TCP garante que a aplicação lê os bytes em ordem. Os segmentos depois de uma perda ficam no buffer de recepção até o que falta chegar, o que leva pelo menos um timeout de retransmissão. O UDP entrega cada datagrama à aplicação assim que ele chega e nunca preenche a lacuna. O QUIC (HTTP/3) reduz o problema retransmitindo por stream.

---

**Q15.** Por que o DNS normalmente roda sobre UDP, e não TCP?

- A. O UDP é criptografado e o TCP não
- B. Uma consulta DNS é uma pergunta pequena e uma resposta pequena; o handshake do TCP acrescentaria uma ida e volta inteira antes de a pergunta ser enviada, e, se uma resposta se perde, o cliente simplesmente pergunta de novo
- C. O TCP não consegue transportar texto
- D. A porta 53 não é permitida para TCP

??? success "Resposta"
    **B — Uma troca pequena, sem precisar de handshake.**

    O three-way handshake custa uma ida e volta antes de qualquer dado trafegar. Para uma única requisição e resposta pequenas, isso dobraria a latência, enquanto repetir uma consulta perdida é fácil. O DNS ainda recorre ao TCP (também na porta 53) para respostas grandes demais para um datagrama UDP.

---

**Q16.** Uma equipe planeja mover `api.example.com` para um novo endereço IP. O TTL do registro é 86.400 s (um dia). O que ela deve esperar, e qual é a prática usual?

- A. Todos os clientes passam para o endereço novo em segundos
- B. Os resolvedores que guardaram a resposta antiga continuam a servi-la até a sua cópia expirar — por até um dia —, então a equipe baixa o TTL (para, digamos, 60 s) pelo menos um dia antes da mudança e o sobe de novo depois
- C. Os servidores autoritativos empurram o endereço novo para todos os resolvedores
- D. Os clientes recebem um erro até o TTL expirar

??? success "Resposta"
    **B — Respostas desatualizadas por até um TTL; baixe o TTL com antecedência.**

    Cada resolvedor guarda um registro pelo seu TTL e não fica sabendo de mudanças. Um TTL longo significa poucas consultas aos servidores autoritativos, mas mudanças lentas; um curto espalha mudanças depressa ao custo de mais consultas. Baixar o TTL um TTL (antigo) inteiro antes de uma migração garante que, na hora da troca, nenhum cache guarde o registro por muito tempo.
