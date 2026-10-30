
Pessoas lembram nomes; computadores roteiam pacotes usando endereços IP. O **DNS** (Domain Name System) é o banco de dados distribuído que traduz um no outro[^1], e quase toda requisição começa com uma consulta DNS. Ele importa neste curso muito além do navegador: os serviços do Docker Compose se encontram pelo nome via DNS, o Kubernetes dá um nome DNS a cada Service, e o failover na nuvem muitas vezes funciona trocando um registro DNS — o que só ajuda tão rápido quanto os caches deixam. Esta página mostra como um nome é resolvido, os tipos de registro que você vai encontrar, como inspecioná-los com o `dig` e o que o TTL troca.

---

## Como um nome é resolvido { #resolution }

Ninguém guarda o banco de dados inteiro. O espaço de nomes é uma árvore — a raiz, depois os domínios de topo (`.com`, `.br`), depois cada domínio — e cada nível **delega** o nível de baixo a outros servidores. A sua máquina não percorre essa árvore sozinha: ela pergunta a um **resolvedor recursivo** (o do seu provedor, o da sua empresa ou um público, como `8.8.8.8` ou `1.1.1.1`), que a percorre por você e guarda em cache o que aprende.

``` diagram-sim
sequenceDiagram
    participant B as Navegador / SO
    participant R as Resolvedor recursivo<br/>(provedor ou 8.8.8.8)
    participant Rt as Servidor raiz
    participant T as Servidor do TLD<br/>(.com)
    participant A as Servidor autoritativo<br/>(example.com)
    Note over B: primeiro o próprio cache: nada para api.example.com
    B->>R: Qual é o IP de api.example.com?
    R->>Rt: Quem cuida de .com?
    Rt-->>R: os servidores de .com (a.gtld-servers.net, …)
    R->>T: Quem cuida de example.com?
    T-->>R: os servidores de example.com (ns1.example.com, …)
    R->>A: Qual é o IP de api.example.com?
    A-->>R: A 203.0.113.10, TTL 300 s
    R-->>B: 203.0.113.10 (em cache por 300 s)
```

- Os **servidores raiz** só sabem quem opera cada domínio de topo. Existem 13 identidades de servidor raiz (`a.root-servers.net` a `m.root-servers.net`), operadas por 12 organizações e replicadas por anycast em mais de 2.000 instâncias pelo mundo[^2].
- Os **servidores de TLD** sabem quem é autoritativo para cada domínio abaixo deles.
- Os **servidores autoritativos** de um domínio guardam os registros de fato, definidos por quem é dono do domínio.

Toda resposta vem com um **TTL** (time to live, em segundos), e cada resolvedor no caminho a guarda em cache por esse tempo — o navegador, o sistema operacional, o resolvedor recursivo. O resolvedor também guarda as indicações (referrals): a próxima consulta sob `.com` pula a raiz, e a próxima para `example.com` vai direto aos seus servidores autoritativos. Por isso uma consulta típica leva poucos milissegundos a partir do cache, e uma fria, de dezenas a centenas. Consultas que falham também vão para o cache (*cache negativo*), então um nome consultado antes de existir pode continuar falhando por um tempo[^3].

As consultas DNS em geral viajam por UDP na porta 53 — uma única pergunta e resposta pequenas, em que o handshake do TCP dobraria o custo — e recorrem ao TCP para respostas grandes ([Portas, TCP e UDP](../transport/index.md)).

---

## Tipos de registro { #records }

A zona de um domínio é uma lista de registros, cada um com nome, tipo, TTL e valor[^4]:

| Registro | Finalidade | Exemplo |
|---|---|---|
| **A** | Mapeia um nome para um endereço IPv4 | `api.example.com → 203.0.113.10` |
| **AAAA** | Mapeia um nome para um endereço IPv6 | `api.example.com → 2001:db8::10` |
| **CNAME** | Apelido que aponta para outro nome | `www.example.com → example.com` |
| **MX** | Servidor de e-mail de um domínio, com prioridade | `example.com → 10 mail.example.com` |
| **TXT** | Texto arbitrário (SPF, DKIM, verificação de posse) | `"v=spf1 include:_spf.google.com ~all"` |
| **NS** | Os servidores autoritativos de uma zona (a delegação) | `example.com → ns1.example.com` |
| **PTR** | Consulta reversa: de um endereço de volta para um nome | `10.113.0.203.in-addr.arpa → api.example.com` |

Um CNAME não pode ficar no ápice da zona (o próprio `example.com`) junto com outros registros; por isso os serviços de DNS das nuvens oferecem registros "alias" para apontar um domínio puro para um load balancer.

---

## Consultando: `dig` { #dig }

O `dig` faz uma pergunta a um servidor DNS e imprime a resposta inteira. Ele vem com o macOS e com a maioria das distribuições Linux (pacote `dnsutils` ou `bind-utils`):

```bash
dig example.com A                # ask the configured resolver for the A records
dig +short example.com           # only the addresses
dig @1.1.1.1 example.com         # ask a specific resolver
dig +trace example.com           # walk root → .com → example.com yourself
```

A saída do primeiro comando tem esta forma (os seus endereços, TTL e resolvedor serão outros — o TTL vai diminuindo enquanto a resposta fica no cache do resolvedor):

```text
; <<>> DiG 9.10.6 <<>> example.com A
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 63389
;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1

;; QUESTION SECTION:
;example.com.			IN	A

;; ANSWER SECTION:
example.com.		170	IN	A	104.20.23.154
example.com.		170	IN	A	172.66.147.243

;; Query time: 15 msec
;; SERVER: 172.20.129.131#53(172.20.129.131)
;; WHEN: Fri Oct 30 08:56:42 -03 2026
;; MSG SIZE  rcvd: 72
```

Leia de cima para baixo: `status: NOERROR` significa que o nome existe (`NXDOMAIN` significaria que não); as flags dizem que é uma resposta (`qr`) e que o servidor fez a recursão por você (`ra`); cada linha da **answer section** é um registro — nome, TTL restante em segundos, classe, tipo, valor. Aqui o nome tem dois registros A, e o cliente pode usar qualquer um. `SERVER` é o resolvedor que respondeu, e `Query time` mostra se a resposta veio do cache (poucos ms) ou não.

---

## O TTL: atualidade versus carga { #ttl }

O TTL é uma promessa do dono do domínio: "esta resposta vale por tantos segundos". Ele também é uma troca com dois lados:

- **Um TTL longo** faz os resolvedores perguntarem de novo raramente: as consultas são rápidas e os servidores autoritativos recebem pouco tráfego. Mas, quando o endereço muda, todo resolvedor que guardou o antigo continua entregando-o até a sua cópia expirar — por até um TTL.
- **Um TTL curto** espalha uma mudança depressa, ao custo de mais consultas aos servidores autoritativos e de mais falhas de cache (consultas mais lentas) para os clientes.

Cada resolvedor expira a sua cópia no seu próprio relógio, então, depois de uma mudança, alguns clientes recebem o endereço novo na hora e outros só quando a cópia do seu resolvedor acaba.

<div class="csim" data-sim="dns" data-ttl="300"></div>

!!! tip "Experimente"
    Com TTL de 300 s, deixe rodar até t = 600 s: das 2.741 consultas dos clientes, 99,7% são respondidas por um cache e só 8 chegam aos servidores autoritativos. Ponha o TTL em 30 s e recomece: até t = 600 s os servidores autoritativos recebem 76 consultas e a taxa de acerto é 97,2%; com 10 s, 204 consultas (92,6%). De volta a 300 s, recomece, pause em t = 120 s e aperte **mudar o IP**: o resolvedor mais movimentado continua servindo o endereço antigo, e a última resposta antiga sai 180 s após a mudança — 814 respostas com o IP antigo no total, nunca mais tarde que um TTL depois da mudança.

Por isso as equipes **baixam o TTL antes de uma migração planejada** (um dia antes, para que o TTL longo antigo tenha expirado em todo lugar), trocam o endereço e o sobem de novo depois. E é por isso que o DNS sozinho faz um failover lento: o TTL é um piso, e alguns clientes guardam em cache por mais tempo do que deveriam — runtimes como a JVM mantêm o seu próprio cache.

---

## DNS dentro do Docker e do Kubernetes { #docker-kubernetes }

O mesmo mecanismo faz a descoberta de serviços dentro das plataformas deste curso:

- **Docker**: contêineres numa rede definida pelo usuário (todo projeto Compose tem uma) usam o servidor DNS embutido do Docker em `127.0.0.11`, que resolve nomes de serviços e contêineres para os seus endereços privados e encaminha todo o resto para os resolvedores do host[^5]. É assim que o `gateway` chega ao banco em `db:5432`. Contêineres na rede `bridge` padrão não têm resolução de nomes.
- **Kubernetes**: todo Service recebe um nome no formato `<service>.<namespace>.svc.cluster.local`, que resolve para o seu cluster IP; um pod no mesmo namespace pode usar só `<service>`, porque o seu `/etc/resolv.conf` lista os domínios de busca do namespace[^6].

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - O DNS é uma árvore delegada: os servidores raiz apontam para os servidores de TLD, que apontam para os servidores autoritativos de cada domínio.
    - Um resolvedor recursivo percorre a árvore por você e guarda em cache cada resposta e indicação pelo seu TTL.
    - Os registros comuns são A/AAAA (endereços), CNAME (apelido), MX (e-mail), TXT (texto), NS (delegação) e PTR (reverso).
    - O `dig` mostra a resposta completa: status, registros, TTL restante e qual resolvedor respondeu.
    - O TTL troca carga por atualidade: um TTL longo significa poucas consultas aos autoritativos, mas respostas desatualizadas por até um TTL depois de uma mudança; baixe-o antes de uma migração.
    - O Docker (DNS embutido em `127.0.0.11`) e o Kubernetes (`<service>.<namespace>.svc.cluster.local`) usam DNS para a descoberta de serviços.

---

[^1]: [RFC 1034 — Domain Names: Concepts and Facilities](https://datatracker.ietf.org/doc/html/rfc1034){target="_blank"}
[^2]: [Root Servers — root-servers.org](https://root-servers.org/){target="_blank"} (número de instâncias em outubro de 2026)
[^3]: [RFC 2308 — Negative Caching of DNS Queries](https://datatracker.ietf.org/doc/html/rfc2308){target="_blank"}
[^4]: [RFC 1035 — Domain Names: Implementation and Specification](https://datatracker.ietf.org/doc/html/rfc1035){target="_blank"}
[^5]: [Networking overview — Docker Docs](https://docs.docker.com/engine/network/){target="_blank"}
[^6]: [DNS for Services and Pods — Kubernetes](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/){target="_blank"}
