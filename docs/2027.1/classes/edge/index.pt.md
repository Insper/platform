São 09:59:58 de uma terça-feira. O BoxOffice anunciou que os ingressos de um show em estádio começam a ser vendidos às 10:00: **60 mil lugares, cerca de 2 milhões de fãs** com a página aberta, muitos deles apertando "atualizar" a cada segundo. Às 10:00:00, todos os celulares enviam uma requisição ao mesmo tempo. A maioria dessas requisições nunca deveria chegar ao serviço `inventory`, que guarda os assentos — e as que chegam precisam alcançar uma réplica saudável, em uma ordem justa, vindas de fãs reais e não de bots de cambistas.

Tudo o que acontece entre o celular do fã e o primeiro serviço do BoxOffice é a **borda** (edge): resolução de nomes, entrega de conteúdo, filtragem de tráfego, load balancing e o API gateway. Esta aula trata desse caminho. Ele decide quão rápido chega o primeiro byte, quanta carga os serviços centrais recebem e se uma venda relâmpago é um sucesso ou uma queda de 10 minutos no jornal da noite.

Neste curso, **a borda** é o conjunto de componentes que recebem, filtram, roteiam e distribuem o tráfego *antes* que ele chegue aos serviços da aplicação. No simulador do curso eles formam a categoria **TRAFFIC & EDGE** da paleta: `dns`, `cdn`, `waf`, `lb`, `apigw` e `ingress`[^1].

!!! quote "A história até aqui"

    Capítulo 4 da [história do curso](../../index.md#story). O BoxOffice tem números ([aula 2](../estimation/index.md)) e sabe que a rede entre suas máquinas mente ([aula 3](../distributed/index.md)). Agora 2 milhões de celulares enviam uma requisição no mesmo segundo — cerca de 100.000 requisições/s na borda — enquanto uma réplica de `catalog` só mantém sua meta de latência até algumas centenas. **Esta aula** responde: quais requisições podem terminar antes de chegar a qualquer serviço, e como o restante chega a uma réplica saudável — de um chamador identificado, de forma justa e a uma taxa que o núcleo aguenta?

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula você deve ser capaz de:

    - **Rastrear** uma requisição de um cliente até um serviço passando por DNS, CDN, WAF, load balancer, API gateway e ingress, e **explicar** o que cada salto decide.
    - **Configurar** registros DNS e TTLs, e o cache da CDN (`Cache-Control`, cache keys, invalidação) para uma página de muita leitura, e **calcular** a carga na origem para um dado hit ratio.
    - **Comparar** load balancing L4 e L7 e **escolher** um algoritmo de balanceamento (round robin, least connections, power of two choices, consistent hashing) para uma carga de trabalho.
    - **Projetar** uma política de rate limiting com token bucket ou sliding window, e **posicioná-la** na camada certa.
    - **Contrastar** HTTP/1.1, HTTP/2, HTTP/3 (QUIC), WebSockets, SSE e gRPC, e **selecionar** um deles para uma dada interação.
    - **Defender** uma arquitetura de borda contra bots e ataques DDoS com regras de WAF, rate limits, desafios e uma sala de espera.

## Roteiro { #roadmap }

1. **Esta visão geral** — a jornada da requisição pela borda, reverse proxies, terminação TLS, um orçamento de latência e segurança na borda (WAF, bots, DDoS).
2. [DNS & CDN](dns-cdn/index.md) — resolução de nomes, TTLs, GeoDNS e anycast; redes de entrega de conteúdo, cache keys, invalidação e edge compute.
3. [Load Balancing](load-balancing/index.md) — L4 vs L7, algoritmos, consistent hashing, service discovery, health checks e Kubernetes Ingress / Gateway API.
4. [API Gateway & Rate Limiting](api-gateway/index.md) — o que um gateway centraliza, o padrão BFF e os algoritmos de rate limiting.
5. [Identidade: OAuth 2.1, OIDC & JWT](identity/index.md) — quem é o chamador: tokens emitidos por `auth` e validados uma vez, no gateway.
6. [Protocolos](protocols/index.md) — HTTP/1.1, HTTP/2, HTTP/3 e QUIC, TLS 1.3, WebSockets, SSE e gRPC.
7. [Quiz](quiz.md) — teste o seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/edge.html" title="Slides: traffic and edge" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/edge.html){:target="_blank"}

---

## A jornada da requisição { #the-request-journey }

Um fã abre `https://boxoffice.com/events/stadium-show` e toca em **"Escolher assentos"**. Antes de qualquer código Java rodar, a requisição atravessa vários componentes, cada um com uma tarefa precisa. Aperte play e acompanhe:

``` diagram-sim
sequenceDiagram
    participant F as Celular do fã
    participant D as DNS
    participant C as Borda da CDN
    participant W as WAF
    participant L as Load balancer
    participant G as API gateway
    participant I as Ingress
    participant S as serviço inventory
    F->>D: boxoffice.com? (A/AAAA)
    D-->>F: 203.0.113.10 (borda mais próxima, TTL 60 s)
    F->>C: GET /events/stadium-show (TLS)
    C-->>F: HTML, JS, imagens do cache da borda
    F->>C: GET /api/events/42/seats
    C->>W: cache miss: encaminha à origem
    W->>L: requisição passou pelas regras (não é bot)
    L->>G: escolhe uma réplica saudável do gateway
    G->>I: token válido, dentro do rate limit
    I->>S: roteia /api/events/** para inventory
    S-->>F: mapa de assentos (JSON)
```

Leia o diagrama como uma série de **decisões**, tomadas o mais cedo (e da forma mais barata) possível:

1. O **DNS** decide *para onde* o cliente vai: qual endereço IP, qual região, qual localidade de borda.
2. A **CDN** (Content Delivery Network) decide se a requisição precisa ir adiante: se a resposta está em cache na borda, a jornada termina aqui, a poucos milissegundos do fã.
3. O **WAF** (Web Application Firewall) decide se a requisição é *permitida*: tráfego malformado, malicioso ou abusivo é descartado aqui.
4. O **load balancer** decide *qual réplica* atende a requisição, e só a envia para réplicas saudáveis.
5. O **API gateway** decide se o *chamador* é permitido e está dentro da sua cota: autenticação, rate limits, roteamento para o serviço certo.
6. O **ingress** (dentro do Kubernetes) decide qual *Service* do cluster recebe a requisição, por host e path.

Cada salto remove trabalho do seguinte. Em uma venda relâmpago bem projetada, a grande maioria das requisições termina na CDN (assets estáticos, a página do evento, até um mapa de assentos em cache por um segundo), muitos bots terminam no WAF, e só um fluxo controlado e justo chega ao `inventory`.

| Id na paleta | Componente | Tarefa | Camada | Produtos típicos |
|---|---|---|---|---|
| `dns` | DNS | nome → IP; roteamento geográfico e baseado em saúde | protocolo de aplicação sobre UDP/TCP 53 | Route 53, Cloud DNS, Azure DNS, Cloudflare DNS |
| `cdn` | CDN | cachear conteúdo perto dos usuários; absorver carga e ataques | L7 (HTTP) | CloudFront, Cloud CDN, Azure Front Door, Cloudflare, Akamai, Fastly |
| `waf` | WAF | filtrar requisições HTTP maliciosas ou abusivas | L7 | AWS WAF, Cloud Armor, Azure WAF, Cloudflare WAF, ModSecurity / Coraza |
| `lb` | Load Balancer | distribuir conexões ou requisições entre réplicas saudáveis | L4 (TCP/UDP) ou L7 (HTTP) | ALB/NLB, Cloud Load Balancing, Azure Load Balancer, Nginx, HAProxy, Envoy |
| `apigw` | API Gateway | ponto único de entrada das APIs: autenticação, rate limits, roteamento | L7 | API Gateway, Apigee, Azure API Management, Kong, Spring Cloud Gateway |
| `ingress` | Ingress | roteamento HTTP para dentro de um cluster Kubernetes | L7 | implementações da Gateway API (Envoy Gateway, Istio, Cilium), Traefik, ingress controllers de nuvem |

!!! info "Camadas, em resumo"
    "L4" e "L7" se referem ao modelo OSI: a **camada 4** é a camada de transporte (TCP, UDP — conexões, portas), a **camada 7** é a camada de aplicação (HTTP — métodos, paths, cabeçalhos, cookies). Um componente que trabalha em L4 enxerga *conexões*; um que trabalha em L7 enxerga *requisições*. A diferença importa para o load balancing e é detalhada em [Load Balancing](load-balancing/index.md).

Implantações reais juntam algumas dessas caixas. Cloudflare ou CloudFront combinam DNS, CDN, WAF e proteção contra DDoS em um único produto; um AWS Application Load Balancer pode terminar TLS e rotear por path, fazendo parte do trabalho do gateway; no Kubernetes, o ingress controller muitas vezes *é* o load balancer L7. Em uma entrevista, desenhe primeiro as **responsabilidades** como caixas separadas; depois diga quais delas um único produto cobre.

---

## Reverse proxies { #reverse-proxies }

Quase toda caixa da borda é um **reverse proxy**: um servidor que recebe requisições em nome de outros servidores, as encaminha e devolve a resposta como se fosse sua. O cliente só conhece o endereço do proxy; os backends ficam escondidos em uma rede privada.

``` diagram-sim
flowchart LR
    c1([Fã 1]) --> rp["Reverse proxy<br/>boxoffice.com:443"]
    c2([Fã 2]) --> rp
    c3([Bot]) -.->|bloqueado| rp
    rp --> a1[réplica 1 do gateway]
    rp --> a2[réplica 2 do gateway]
    rp --> a3[réplica 3 do gateway]
```

Como toda requisição passa por ele, um reverse proxy é o lugar natural para colocar preocupações **transversais** uma única vez, em vez de em cada serviço:

| Preocupação | O que o proxy faz |
|---|---|
| Terminação TLS | decifra o HTTPS uma vez, para que cada serviço não precise gerenciar certificados |
| Load balancing | distribui requisições entre réplicas, pula as não saudáveis |
| Cache | serve respostas repetidas sem tocar no backend |
| Compressão | respostas em gzip / Brotli para redes móveis lentas |
| Segurança | esconde a topologia interna, filtra requisições, aplica limites |
| Observabilidade | um único lugar para registrar toda requisição e medir latência e erros |

O oposto, um **forward proxy**, fica na frente dos *clientes* (um proxy corporativo, por exemplo). Na borda, só nos interessam os reverse proxies.

### Onde o TLS termina { #tls-termination }

O TLS (Transport Layer Security) criptografa o tráfego entre dois pontos. Na borda, há três escolhas comuns de onde a conexão criptografada *termina*:

| Opção | Como funciona | Prós | Contras |
|---|---|---|---|
| **Terminar na borda** | CDN / LB decifra; HTTP puro dentro da rede privada | simples; o proxy pode ler cabeçalhos e cachear | o tráfego dentro da rede fica legível para quem conseguir entrar |
| **Recriptografar** (TLS bridging) | a borda decifra, inspeciona e abre uma nova conexão TLS até o backend | inspeção *e* criptografia em trânsito | dois handshakes, certificados nos backends |
| **Pass-through** | o LB L4 repassa bytes criptografados; o serviço termina o TLS | criptografia de ponta a ponta | sem roteamento L7, cache nem WAF no LB |

Arquiteturas modernas seguem uma postura **zero trust**: terminar o TLS público na borda e criptografar de novo dentro do cluster — frequentemente de forma automática, com TLS mútuo (mTLS) de um service mesh (veja [Rede & Segurança](../network-security/index.md)).

??? question "Pense antes: uma CDN consegue cachear uma página se o TLS vai até o serviço?"
    Não. Para cachear uma resposta, a CDN precisa lê-la, e para lê-la precisa ter o certificado e decifrar o tráfego. Com TLS pass-through, a CDN só vê bytes criptografados e não consegue nem cacheá-los nem filtrá-los. É por isso que CDNs e WAFs terminam o TLS: você confia ao seu provedor de borda o seu certificado (ou um certificado emitido para ele) em troca de cache e filtragem.

---

## Um orçamento de latência para a borda { #latency-budget }

Cada salto adiciona tempo. Suponha que o BoxOffice queira que a API do mapa de assentos responda em **menos de 200 ms no p99** para fãs no Brasil. Para onde vai o tempo? Os valores abaixo são **suposições ilustrativas** para um usuário em São Paulo e uma região em São Paulo; o método importa mais que os números.

| Etapa | Fria (primeira visita) | Quente (conexão reaproveitada) |
|---|---|---|
| Consulta DNS (miss / hit no cache do resolver) | 30 ms | 0 ms (em cache) |
| Handshake TCP + TLS 1.3 até a borda (2 RTT × 10 ms) | 20 ms | 0 ms (conexão reaproveitada) |
| Borda da CDN → WAF → LB (mesma região metropolitana) | 5 ms | 5 ms |
| API gateway: checagem do JWT + consulta de rate limit no Redis | 5 ms | 5 ms |
| Ingress → `inventory` → PostgreSQL | 40 ms | 40 ms |
| Transferência da resposta (60 KB de JSON em rede móvel) | 30 ms | 30 ms |
| **Total** | **≈ 130 ms** | **≈ 80 ms** |

Três lições saem desse tipo de tabela:

- **Estabelecer conexões é caro e evitável.** Cache de DNS, keep-alive e retomada de sessão TLS removem cerca de um terço do custo frio. O HTTP/3 remove ainda mais ([Protocolos](protocols/index.md)).
- **A distância domina.** Se a origem estivesse na Virgínia em vez de São Paulo, cada round trip custaria cerca de 120 ms em vez de 10 ms, e uma requisição fria pagaria vários deles. É por isso que existem CDNs e localidades de borda.
- **A requisição mais barata é a que nunca chega à origem.** Um cache hit na borda responde no tempo de um RTT até o ponto de presença mais próximo.

---

## Segurança na borda: WAF, bots e DDoS { #edge-security }

No dia da venda, o BoxOffice não recebe só fãs. Recebe **bots de cambistas** que tentam pegar os melhores assentos no primeiro segundo, scripts de **credential stuffing** que testam senhas vazadas contra `/login` e, possivelmente, um ataque **DDoS** (Distributed Denial of Service) de alguém que quer que a venda fracasse. A borda é o primeiro e mais barato lugar para deter todos eles, porque vê todo o tráfego antes que ele custe qualquer coisa ao núcleo.

### Web Application Firewall (WAF) { #waf }

Um **WAF** inspeciona requisições HTTP (L7) e bloqueia as que casam com regras. As regras vêm em três famílias:

- **Conjuntos de regras gerenciadas** que detectam ataques comuns — SQL injection, cross-site scripting (XSS), path traversal, endpoints vulneráveis conhecidos. A referência é o **OWASP Core Rule Set** (CRS), usado pelo ModSecurity e pelo Coraza e espelhado pelos WAFs de nuvem[^2].
- **Regras de reputação**: bloquear ou desafiar endereços IP de botnets conhecidas, proxies de anonimização ou faixas de data center que fãs reais não usam.
- **Regras customizadas** para a sua aplicação: "no máximo 5 `POST /login` por IP por minuto", "só permitir `PUT /holds` com um token válido da sala de espera", "bloquear requisições sem `User-Agent`".

As regras de WAF começam em modo **count** (só registro), são ajustadas contra tráfego real para remover falsos positivos e só então passam para **block**. Um WAF que bloqueia fãs reais durante a venda é pior que nenhum WAF.

### Mitigação de bots { #bots }

Nem todo bot é ruim (crawlers de buscadores, monitores de uptime), e os ruins se parecem cada vez mais com humanos. A mitigação combina vários sinais, dos mais baratos primeiro:

| Técnica | Como funciona | Detém | Custo / risco |
|---|---|---|---|
| Rate limiting por IP / por conta | limita requisições por janela de tempo ([API Gateway](api-gateway/index.md)) | scripts ingênuos | botnets espalhadas por milhares de IPs |
| Reputação de IP e regras por ASN | bloqueia IPs maliciosos conhecidos e provedores de hospedagem | fazendas de bots baratas | proxies residenciais passam |
| Fingerprinting | fingerprint TLS (p. ex. JA3/JA4), ordem dos cabeçalhos, sinais do dispositivo coletados por JavaScript | navegadores headless, clientes scriptados | preocupações de privacidade; corrida armamentista |
| Desafios | proof-of-work invisível em JavaScript ou CAPTCHA quando a pontuação é suspeita | a maior parte do tráfego automatizado | atrito para usuários reais |
| Análise comportamental | padrões de mouse/toque, velocidade de navegação, velocidade de compra | bots avançados | exige dados e modelos |
| **Sala de espera virtual** | admite usuários na venda a uma taxa controlada, em ordem aleatória ou de chegada | a vantagem do "primeiro segundo" dos bots | usuários esperam; precisa ser justa e transparente |
| Regras de negócio | máx. 6 ingressos por conta, telefone verificado, checagem de identidade | cambismo em escala | decisão de produto, não só técnica |

A **sala de espera** merece menção especial no BoxOffice: quando 2 milhões de fãs chegam para 60 mil assentos, deixar todos entrarem no mapa de assentos de uma vez garante uma queda *e* premia quem for mais rápido — geralmente um bot. Uma sala de espera na borda entrega a cada visitante um token assinado com uma posição e admite, digamos, 1.000 usuários por segundo no fluxo de compra — a taxa que o `inventory` sustenta na [aula de estimativas](../estimation/index.md). O núcleo vê uma carga estável e dimensionada; o resto dos fãs vê uma barra de progresso servida pela CDN. Você vai modelá-la com uma fila na [aula de mensageria](../messaging/index.md) e no [estudo de caso de ingressos](../case-studies/ticketing/index.md).

### DDoS { #ddos }

Um ataque de **negação de serviço** tenta esgotar um recurso — banda, conexões, CPU — para que usuários legítimos não possam ser atendidos. "Distribuído" significa que ele vem de muitas origens ao mesmo tempo (uma botnet), então bloquear um único IP não adianta[^3].

| Tipo de ataque | Camada | Exemplo | Defesa |
|---|---|---|---|
| **Volumétrico** | L3/L4 | floods UDP, amplificação DNS/NTP chegando a centenas de Gbit/s | absorver com capacidade: o **anycast** espalha a inundação por centenas de localidades de borda; centros de **scrubbing** upstream a filtram |
| **De protocolo** | L4 | SYN floods que enchem as tabelas de conexão | SYN cookies, filtragem L4 sem estado na borda |
| **De aplicação** | L7 | muitas requisições `GET /search?q=…` de aparência válida e caras para o backend | regras de WAF, rate limits, desafios, cache, autoscaling com limites |

A ideia-chave é a **assimetria**: você não consegue superar um atacante em capacidade com seus próprios servidores, mas um grande provedor de CDN/DDoS tem mais capacidade de borda que qualquer ataque isolado. Com **anycast**, o mesmo endereço IP é anunciado a partir de todas as localidades de borda, então o tráfego de cada bot vai para a localidade mais próxima e a inundação se divide entre todas elas ([DNS & CDN](dns-cdn/index.md#anycast)). Ataques volumétricos são, portanto, um problema para o qual você **compra** uma solução (AWS Shield, Cloud Armor, Azure DDoS Protection, Cloudflare)[^4]; ataques L7 são um problema para o qual você também precisa **projetar** — endpoints caros precisam ser cacheáveis, ter rate limit ou ser protegidos por um desafio.

!!! example "BoxOffice: 10:00, a venda abre"
    A configuração de borda para a venda do estádio, camada por camada:

    - **DNS**: `boxoffice.com` aponta para os endereços anycast da CDN; TTL de 60 s para que o time possa redirecionar o tráfego rapidamente se uma região falhar.
    - **CDN**: a página do evento, o JavaScript e as imagens ficam em cache com TTLs longos e nomes de arquivo com fingerprint; o JSON de disponibilidade de assentos recebe **micro-caching de 1 segundo** — 2 milhões de fãs fazendo polling a cada 5 s viram, no máximo, uma requisição à origem por segundo por localidade de borda.
    - **WAF**: regras gerenciadas da OWASP ligadas; uma regra customizada só permite `POST /api/holds` com um token válido da sala de espera; `POST /login` limitado por IP e por conta.
    - **Bots**: desafio JavaScript para fingerprints suspeitos; ASNs de data center desafiados antes de entrar na fila.
    - **Sala de espera**: admite um número fixo de usuários por minuto, dimensionado pela capacidade de `inventory` e `payment` medida nos testes de carga.
    - **API gateway**: validação do JWT e um token bucket de 10 requisições/s por usuário com rajadas de 20, e um limite de 6 assentos por reserva.

    O resultado: os serviços centrais veem milhares de requisições por segundo em vez de milhões, e as veem na ordem que a sala de espera decidiu — não na ordem que o bot mais rápido decidiu.

**Experimente.** Carregue o cenário de venda relâmpago e aperte **Run**. O desenho, como está, não tem CDN, gateway nem sala de espera — só `users → lb → app → inventory-db`, com os compradores também chamando o `payment provider` (cota de 500 req/s). Quando a venda abre (t = 60 s), o tráfego salta 20×: o `app` satura e os erros e o p99 explodem; aumente as réplicas dele e o gargalo só se desloca para o `inventory-db` e o provedor de pagamento. Depois abra no playground completo (↗) e siga as dicas — uma CDN na frente, um cache para as leituras do catálogo e um API gateway que envia os compradores para uma fila de sala de espera drenada por workers `order` — ou aperte **Mostrar uma solução possível**. Compare a latência p99, a taxa de erros e as req/s atendidas, e leia o consumer lag: é quanto tempo um comprador espera na fila.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

[:material-open-in-new: Abrir o playground completo](../../../playground/index.md)

## O mapa de conceitos da borda { #concept-map }

Cada componente da borda responde a uma pergunta e entrega a requisição ao seguinte. O mapa liga cada **componente da paleta** (verde) aos **conceitos** em que ele se apoia (azul) e à subpágina ou aula que os ensina:

``` diagram
flowchart LR
    client["client · mobile"]:::comp --> dns["dns"]:::comp
    dns --> cdn["cdn"]:::comp
    cdn --> waf["waf"]:::comp
    waf --> lb["lb"]:::comp
    lb --> apigw["apigw"]:::comp
    apigw --> ingress["ingress"]:::comp
    ingress --> app["serviços da app"]:::comp
    dns -.- c1["TTL, GeoDNS, anycast,<br/>failover de DNS"]:::tech
    cdn -.- c2["cache keys, Cache-Control,<br/>hit ratio, micro-caching"]:::tech
    waf -.- c3["regras OWASP, bots,<br/>sala de espera, DDoS"]:::tech
    lb -.- c4["L4/L7, algoritmos,<br/>consistent hashing, health checks"]:::tech
    apigw -.- c5["offload de autenticação, rate limiting,<br/>BFF"]:::tech
    ingress -.- c6["Ingress, Gateway API,<br/>service discovery"]:::tech
    c1 -.- d1["consistência eventual<br/>(aula 3)"]
    c2 -.- d2["padrões de cache<br/>(aula 7)"]
    c4 -.- d3["serviços stateless,<br/>autoscaling (aula 5)"]
    c5 -.- d4["identidade, JWT<br/>(Identidade, esta aula)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`dns`](../../reference/components/edge/index.md#dns) | *Para onde* o cliente vai? | TTL, GeoDNS, roteamento por latência, anycast, failover | [DNS & CDN](dns-cdn/index.md#dns) | `multi-region`, `cdn-static` |
| [`cdn`](../../reference/components/edge/index.md#cdn) | A requisição precisa ir adiante? | pull/push, cache key, `Cache-Control`, invalidação, edge compute | [DNS & CDN](dns-cdn/index.md#cdn) | `cdn-static`, `video-streaming` |
| [`waf`](../../reference/components/edge/index.md#waf) | A requisição é *permitida*? | regras gerenciadas, pontuação de bots, desafios, sala de espera, DDoS | [esta visão geral](#edge-security) | `flash-sale` |
| [`lb`](../../reference/components/edge/index.md#lb) | *Qual réplica* a atende? | L4/L7, algoritmos, consistent hashing, health checks, draining | [Load Balancing](load-balancing/index.md) | `scale-out` |
| [`apigw`](../../reference/components/edge/index.md#apigw) | O *chamador* é permitido, dentro da cota? | validação de JWT, rate limiting, roteamento, BFF, agregação | [API Gateway](api-gateway/index.md) | `rate-limiter` |
| [`ingress`](../../reference/components/edge/index.md#ingress) | Qual *Service* do cluster? | Ingress, Gateway API, service discovery | [Load Balancing — Kubernetes](load-balancing/index.md#kubernetes) | `scale-out` |
| *(todos eles)* | *Como* os bytes viajam? | HTTP/1.1, 2, 3/QUIC, TLS 1.3, WebSockets, SSE, gRPC | [Protocolos](protocols/index.md) | `chat`, `video-streaming` |

!!! tip "Na entrevista"
    Quando desenhar o design de alto nível, coloque a borda em **uma linha**: "cliente → DNS → CDN → load balancer → API gateway → serviços". Depois gaste palavras só onde o problema pede: um sistema de muita leitura (feed de notícias, catálogo) merece uma frase sobre **cache na CDN e hit ratio**; uma API pública merece **rate limiting**; uma venda relâmpago ou um problema de ingressos merece **WAF, bots e uma sala de espera**. Sempre diga *o que cada salto remove* do núcleo — é esse o sinal que os entrevistadores procuram.

!!! success "Boas práticas"

    - **Exponha uma porta pública e nada mais** — réplicas sem portas publicadas, endpoints internos inacessíveis a partir da internet. No BoxOffice: nenhum `ports:` nas réplicas de `catalog` e `location / { return 404; }` no [lab 3](../../hands-on/3/index.md).
    - **Carimbe um id de requisição no primeiro salto e devolva-o ao cliente** — assim o suporte encontra a requisição de um fã em todos os logs. No BoxOffice: `X-Request-Id $request_id` no `nginx.conf` do lab 3.
    - **Mantenha a configuração da borda no repositório e valide-a antes de cada reload** — `nginx -t` na CI; um erro de digitação na borda é uma queda total.
    - **Faça testes de carga através da borda, não ao redor dela** — a borda adiciona um salto e tem limites próprios. No BoxOffice: o lab 3 roda cada varredura com `BASE_URL=http://localhost` ([Hands-on 3](../../hands-on/3/index.md#measure-it)).
    - **Prepare o dia da venda como um runbook** — pré-escale a borda (peça ao provedor para pré-aquecer os load balancers gerenciados), rode as novas regras de WAF em modo count na semana anterior e saiba quem liga a sala de espera.

!!! warning "Armadilhas"
    - **Tratar a borda como uma caixa só.** "Colocamos um load balancer na frente" não responde "como vocês sobrevivem a 2 milhões de usuários às 10:00?". Diga o que é cacheado, o que é filtrado e o que é limitado.
    - **Esquecer que todo componente da borda pode falhar.** Um load balancer, um gateway ou um WAF em instância única é um ponto único de falha. Serviços de borda gerenciados são replicados para você; os auto-hospedados precisam rodar em pares ou clusters.
    - **Bloquear usuários reais.** Regras agressivas de WAF e de bots ligadas sem um período em "modo count" produzem falsos positivos exatamente quando o tráfego é mais valioso.
    - **Fazer lógica de negócio na borda.** Edge functions e gateways são para preocupações transversais. Regras de preço ou alocação de assentos em um plugin do gateway viram uma segunda aplicação, sem testes e sem versionamento.

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - A **borda** é tudo o que fica entre o cliente e o primeiro serviço: `dns`, `cdn`, `waf`, `lb`, `apigw`, `ingress`. Cada salto toma uma decisão e deve remover trabalho do seguinte.
    - A maioria dos componentes da borda são **reverse proxies**, o lugar natural para terminação TLS, load balancing, cache, segurança e observabilidade.
    - A latência na borda é dominada por **round trips e distância**; cache, reaproveitamento de conexões e protocolos modernos atacam exatamente isso.
    - Regras de **WAF** filtram requisições maliciosas, a **mitigação de bots** combina taxas, fingerprints, desafios e uma **sala de espera**, e a defesa contra **DDoS** depende de capacidade anycast para ataques volumétricos e de design (cache, limites) para ataques L7.
    - Em uma entrevista, desenhe a borda rapidamente e só aprofunde onde o problema exige — e diga o que cada componente **remove** do núcleo.

## O que quebra em seguida { #what-breaks-next }

A borda decide qual réplica atende cada requisição, e o gateway confere o token do chamador uma vez para todos os serviços — mas ambos assumem algo que não conseguem garantir: que **qualquer** réplica pode atender **qualquer** requisição. Uma réplica que guarda a sessão do fã ou uma reserva de assento na própria memória a perde quando morre, ou quando a próxima requisição cai em outra réplica. O lab 3 mostra o outro limite: três réplicas de `catalog` atrás do Nginx multiplicam as requisições baratas, mas não a carga mista, em que o PostgreSQL é o gargalo (em uma execução de teste, `db` a ~670% de CPU e cada réplica a ~20%). O que uma réplica precisa ser (stateless), como os serviços são recortados e o gateway que o lab 4 constrói com `auth` atrás desta borda estão na [aula 5 — Compute & Services](../compute/index.md).

## Relacionados { #related }

- [Hands-on 3 — Edge](../../hands-on/3/index.md): reverse proxy e load balancer Nginx sobre 3 réplicas, health checks e rate limiting, medidos com k6.
- [Hands-on 4 — Gateway & identidade](../../hands-on/4/index.md): Spring Cloud Gateway com validação de JWT.
- [Exercício — Design no playground](../../exercises/playground-design/index.md): resolva desafios do playground com metas de SLO e custo.
- Estudos de caso: [Rate limiter](../case-studies/rate-limiter/index.md) e [Ingressos (venda relâmpago do BoxOffice)](../case-studies/ticketing/index.md).
- [System Design Playground](../../../playground/index.md) e o [catálogo de componentes — Traffic & Edge](../../reference/components/edge/index.md).
- [Preparação para entrevistas](../../support/interview/index.md).
- Aula anterior: [Sistemas Distribuídos](../distributed/index.md). Próxima aula: [Compute & Services](../compute/index.md). A borda volta em [Caching](../caching/index.md), [Confiabilidade](../reliability/index.md) e [Rede & Segurança](../network-security/index.md).

---

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 1 "Scale from zero to millions of users". Byte Code LLC, 2020.
[^2]: OWASP. [OWASP Core Rule Set](https://coreruleset.org/){target="_blank"}.
[^3]: CLOUDFLARE. [What is a DDoS attack?](https://www.cloudflare.com/learning/ddos/what-is-a-ddos-attack/){target="_blank"} — Cloudflare Learning Center.
[^4]: AWS. [AWS Best Practices for DDoS Resiliency](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/welcome.html){target="_blank"}. AWS Whitepaper.
