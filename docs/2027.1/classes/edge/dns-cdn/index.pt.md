Às 10:00 abre a venda do show no estádio do BoxOffice e 2 milhões de celulares fazem as mesmas duas perguntas quase ao mesmo tempo: *"onde fica `boxoffice.com`?"* e *"me dê a página do evento"*. Se as duas perguntas viajarem até os servidores do BoxOffice em São Paulo, os servidores se afogam antes de um único assento ser vendido. O **Domain Name System** (DNS) e uma **Content Delivery Network** (CDN) existem para que a maioria dessas perguntas seja respondida perto do fã, por máquinas que o BoxOffice nem opera.

Esta página cobre os dois primeiros saltos da [jornada da requisição](../index.md#the-request-journey): o DNS decide **para onde** um cliente vai; a CDN decide se a requisição precisa ir **mais longe**.

---

## DNS: a lista telefônica da Internet { #dns }

Computadores falam com endereços IP (`203.0.113.10`, `2001:db8::10`); pessoas digitam nomes (`boxoffice.com`). O DNS traduz o nome em endereços. É um dos sistemas distribuídos mais antigos e maiores que existem: um banco de dados **hierárquico, delegado e fortemente cacheado**[^1].

- **Hierárquico**: os nomes são lidos da direita para a esquerda. A raiz (`.`) sabe quem é responsável por `com.`; `com.` sabe quem é responsável por `boxoffice.com.`; `boxoffice.com.` sabe o endereço de `api.boxoffice.com`.
- **Delegado**: cada nível é operado por uma organização diferente. O BoxOffice controla só a própria zona, `boxoffice.com`, por meio dos seus servidores de nomes **autoritativos** (normalmente um serviço gerenciado como Route 53 ou Cloudflare DNS).
- **Cacheado**: toda resposta carrega um **TTL** (time to live, em segundos). Os resolvers guardam a resposta por esse tempo, de modo que a imensa maioria das consultas nunca chega aos servidores autoritativos.

### Resolução, passo a passo { #resolution }

Quando o celular do fã precisa de `api.boxoffice.com`, ele não percorre a hierarquia sozinho. Um pequeno **stub resolver** no sistema operacional pergunta a um **resolver recursivo** (o da operadora de celular, ou um público como `1.1.1.1` ou `8.8.8.8`), que faz o trabalho e guarda os resultados em cache:

``` diagram-sim
sequenceDiagram
    participant P as Celular (stub resolver)
    participant R as Resolver recursivo
    participant Root as Servidor raiz
    participant TLD as Servidor do TLD .com
    participant A as Autoritativo de boxoffice.com
    P->>R: A? api.boxoffice.com
    Note over R: cache miss
    R->>Root: A? api.boxoffice.com
    Root-->>R: pergunte a .com (NS a.gtld-servers.net)
    R->>TLD: A? api.boxoffice.com
    TLD-->>R: pergunte a boxoffice.com (NS ns1.boxoffice-dns.net)
    R->>A: A? api.boxoffice.com
    A-->>R: 203.0.113.10, TTL 60
    Note over R: guarda em cache por 60 s
    R-->>P: 203.0.113.10
    P->>R: A? api.boxoffice.com (outro fã, 5 s depois)
    R-->>P: 203.0.113.10 (do cache)
```

Uma consulta a frio custa várias idas e voltas (dezenas a centenas de milissegundos); uma em cache custa uma única ida e volta até o resolver, ou nada, quando a resposta está no cache do sistema operacional ou do navegador. Na prática, as respostas da raiz e de `.com` também quase sempre estão em cache (os TTLs delas são de um a dois dias), então um miss típico custa só uma viagem do resolver até o servidor autoritativo.

??? question "Pense antes: 2 milhões de fãs consultam `boxoffice.com` às 10:00. Quantas consultas chegam aos servidores autoritativos do BoxOffice?"
    Muito menos de 2 milhões. Os fãs compartilham alguns milhares de resolvers recursivos (das operadoras de celular, dos provedores de internet e os públicos). Cada resolver pergunta ao servidor autoritativo **uma vez por TTL** e atende todos os outros a partir do seu cache. Com um TTL de 60 s e, digamos, 5.000 resolvers ativos, os servidores autoritativos veem algo na ordem de 5.000 consultas por minuto — cerca de 80 por segundo. O cache do DNS é o primeiro e mais eficaz escudo de carga da Internet.

### Tipos de registro { #record-types }

| Tipo | Mapeia | Exemplo | Usado para |
|---|---|---|---|
| **A** | nome → endereço IPv4 | `api.boxoffice.com → 203.0.113.10` | a consulta básica |
| **AAAA** | nome → endereço IPv6 | `api.boxoffice.com → 2001:db8::10` | clientes IPv6 (a maioria das redes móveis) |
| **CNAME** | nome → outro nome (alias) | `www.boxoffice.com → d123.cloudfront.net` | apontar para uma CDN ou um load balancer cujos IPs mudam |
| **ALIAS / ANAME** | nome do apex → outro nome (recurso do provedor) | `boxoffice.com → my-alb.amazonaws.com` | um CNAME não é permitido no apex da zona; os provedores o "achatam" |
| **NS** | zona → seus servidores de nomes | `boxoffice.com → ns1.boxoffice-dns.net` | delegação |
| **MX** | domínio → servidores de e-mail | `boxoffice.com → mail.provider.com` | receber e-mail |
| **TXT** | nome → texto livre | `v=spf1 include:…` | provas de posse do domínio, SPF/DKIM/DMARC para e-mail |
| **SRV** | serviço → host + porta | `_sip._tcp.boxoffice.com` | service discovery (o DNS do Kubernetes usa internamente) |
| **CAA** | domínio → autoridades certificadoras permitidas | `0 issue "letsencrypt.org"` | restringe quem pode emitir certificados TLS para o domínio |

### TTL: atualidade versus carga { #ttl }

O TTL é um trade-off clássico entre **a rapidez com que uma mudança se propaga** e **quanta carga e latência** as consultas custam:

| TTL | A mudança se propaga em | Carga / latência das consultas | Bom para |
|---|---|---|---|
| 5–60 s | cerca de um minuto | muito mais consultas; mais consultas a frio para os usuários | registros de failover, registros que você planeja mudar |
| 5–60 min | cerca de uma hora | baixa | registros comuns |
| 1–2 dias | dias | mínima | registros NS, coisas que nunca mudam |

!!! tip "Baixe o TTL antes de uma migração"
    Se você vai mover `api.boxoffice.com` para um novo load balancer na próxima terça-feira, baixe o TTL dele de 1 hora para 60 segundos **na segunda** (pelo menos um TTL antigo de antecedência). Os resolvers que guardaram o registro antigo com o TTL de 1 hora já o terão expirado na terça, e a troca vai levar cerca de um minuto em vez de uma hora. Suba o TTL de novo depois da migração.

### Roteamento com DNS: GeoDNS, latência, pesos e failover { #dns-routing }

Como é o servidor autoritativo que escolhe a resposta, ele pode dar **respostas diferentes para clientes diferentes**. Serviços de DNS gerenciados oferecem várias políticas de roteamento[^4]:

| Política | A resposta depende de | Uso no BoxOffice |
|---|---|---|
| **Simples** | nada; sempre os mesmos registros | ambientes de desenvolvimento |
| **Geolocalização (GeoDNS)** | o país ou continente do cliente (estimado pelo IP do resolver, ou pela opção EDNS Client Subnet) | mandar fãs da Europa para a região da UE por regras de residência de dados |
| **Por latência** | a região com a menor latência medida a partir da rede do cliente | fãs de São Paulo para `sa-east-1`, fãs de Lisboa para `eu-west-1` |
| **Ponderada** | uma porcentagem configurada | mandar 5% do tráfego para uma nova região ou stack (canário no nível do DNS) |
| **Failover** | o resultado de um **health check** | a região secundária só responde quando a primária não está saudável |

O **failover por DNS** é a forma mais simples de recuperação de desastres multirregião: o provedor de DNS sonda `https://sa.boxoffice.com/health` a cada 10–30 s a partir de vários locais; depois de algumas falhas, ele para de devolver o endereço da primária e devolve o da secundária.

``` diagram-sim
sequenceDiagram
    participant HC as Health checker do DNS
    participant P as Região SP (primária)
    participant S as Região US (secundária)
    participant F as Resolver do fã
    HC->>P: GET /health
    P-->>HC: 200 OK
    F->>HC: A? api.boxoffice.com
    HC-->>F: endereço de SP (TTL 60)
    Note over P: queda da região
    HC->>P: GET /health
    Note over HC: 3 falhas seguidas: marca SP como não saudável
    F->>HC: A? api.boxoffice.com (depois que o TTL expirou)
    HC-->>F: endereço de US (TTL 60)
    F->>S: o tráfego agora vai para a secundária
```

!!! warning "O failover por DNS não é instantâneo"
    O tempo de failover é aproximadamente **detecção + TTL**: com um intervalo de health check de 30 s, 3 falhas para declarar a primária fora e um TTL de 60 s, os clientes migram depois de cerca de 90 s + 60 s = **2,5 minutos** no melhor caso. Na prática demora mais: alguns resolvers e clientes **ignoram TTLs baixos** (resolvers de provedores que impõem um TTL mínimo, aplicações que resolvem um nome uma vez e guardam o endereço em um pool de conexões, dispositivos antigos), e conexões de longa duração continuam falando com a região morta até quebrarem. O failover por DNS é bom para desastres **regionais**; para *servidores* que falham dentro de uma região, use um load balancer com health checks, que reage em segundos ([Balanceamento de carga](../load-balancing/index.md)).

**Experimente.** Abra o cenário multirregião e rode o perfil **load**. Depois provoque a queda da região primária (chaos **high**, ou desative a região no painel). Observe quanto tempo os erros duram até o DNS mandar o tráfego para a secundária, e mude o TTL do DNS para ver como ele estica ou encurta essa janela.

<div class="sdp" data-scenario="multi-region" data-mode="compact" data-height="520" data-profile="load"></div>

[:material-open-in-new: Abrir o playground completo](../../../../playground/index.md)

### Anycast { #anycast }

Com o endereçamento comum (**unicast**), um endereço IP pertence a um lugar. Com **anycast**, o *mesmo* endereço IP é anunciado via BGP (o Border Gateway Protocol, que cola as redes da Internet umas às outras) a partir de vários locais ao mesmo tempo, e cada pacote é entregue pela rede ao local **mais próximo**, em termos de roteamento.

``` diagram
flowchart LR
    f1([Fã em São Paulo]) --> sp["Borda São Paulo<br/>anuncia 198.51.100.1"]
    f2([Fã em Lisboa]) --> li["Borda Lisboa<br/>anuncia 198.51.100.1"]
    f3([Fã em Tóquio]) --> tk["Borda Tóquio<br/>anuncia 198.51.100.1"]
```

O anycast dá três coisas de uma vez, sem nenhum truque de DNS:

- **Baixa latência**: todo cliente chega a um local próximo.
- **Failover automático**: se um local para de anunciar o endereço, o roteamento converge para o próximo mais perto, tipicamente em segundos.
- **Absorção de DDoS**: um ataque de uma botnet global é dividido entre todos os locais em vez de atingir um só (veja [segurança na borda](../index.md#ddos)).

Os servidores DNS raiz, resolvers públicos como `1.1.1.1` e `8.8.8.8`, e toda grande CDN usam anycast. O anycast funciona melhor com trocas curtas e quase sem estado (DNS sobre UDP, requisições HTTP a um cache de borda); uma mudança de rota no meio de uma conexão TCP longa pode quebrá-la, o que os grandes provedores mitigam com um roteamento cuidadoso.

---

## CDN: leve o conteúdo até o fã { #cdn }

Uma **CDN** é uma rede de proxies reversos com cache — **pontos de presença** (PoPs), centenas deles pelo mundo — que guardam cópias do seu conteúdo perto dos usuários[^3]. Um fã em Recife que pede o logo do BoxOffice o recebe de um PoP em Recife ou Fortaleza, não da origem em São Paulo; um fã em Lisboa o recebe de Lisboa, não do outro lado do Atlântico.

Uma CDN faz três trabalhos ao mesmo tempo[^5]:

1. **Latência**: o conteúdo viaja alguns quilômetros em vez de milhares. Uma ida e volta atravessando o Atlântico custa cerca de 100–150 ms; até um PoP na mesma cidade, alguns milissegundos.
2. **Alívio da origem**: cada cache hit é uma requisição que a **origem** (seus servidores) nunca vê. Muitas vezes esse é o principal motivo para uma CDN em um system design.
3. **Proteção**: a capacidade e a rede anycast da CDN absorvem picos de tráfego e ataques antes que cheguem até você.

``` diagram-sim
sequenceDiagram
    participant F1 as Fã 1 (Recife)
    participant E as PoP da CDN em Recife
    participant O as Origem (São Paulo)
    participant F2 as Fã 2 (Recife)
    F1->>E: GET /img/stadium.webp
    Note over E: MISS: não está no cache
    E->>O: GET /img/stadium.webp
    O-->>E: 200, Cache-Control: max-age=86400
    E-->>F1: 200 (guardado por 1 dia)
    F2->>E: GET /img/stadium.webp
    Note over E: HIT
    E-->>F2: 200 do PoP (origem intocada)
```

### Pull versus push { #pull-push }

| Modelo | Como o conteúdo chega aos PoPs | Prós | Contras | Bom para |
|---|---|---|---|---|
| **Pull (origin pull)** | o PoP busca na origem no primeiro miss e depois guarda em cache | zero trabalho de upload; só o conteúdo popular ocupa o cache | a primeira requisição em cada PoP é lenta (um miss) | sites, APIs, quase tudo |
| **Push** | você envia o conteúdo para o armazenamento da CDN com antecedência | sem misses a frio; previsível | você gerencia uploads, versões e remoção | arquivos grandes conhecidos de antemão: vídeo, downloads de software, patches de jogos |

A maioria dos designs usa **pull** na frente de uma origem, e essa origem frequentemente é um **object store** (S3, Cloud Storage, Azure Blob — o componente `objstore`) para arquivos estáticos e mídia.

### A chave de cache { #cache-key }

A CDN guarda cada resposta sob uma **chave de cache** — por padrão, o host mais o caminho da URL mais a query string. Duas requisições com a mesma chave compartilham a cópia em cache. Acertar a chave é a maior parte do trabalho:

- Uma chave **específica demais** fragmenta o cache: `/events/42?utm_source=instagram` e `/events/42?utm_source=email` são a mesma página, mas com a chave padrão são guardadas duas vezes e as duas dão miss. Remova parâmetros de rastreamento da chave, ou ordene os parâmetros da query.
- Uma chave **genérica demais** vaza dados: se a resposta depende de um cookie (`session=…`) ou de um header (`Accept-Language`) que *não* está na chave, um fã pode receber uma página personalizada para outro.
- O header de resposta **`Vary`** diz aos caches quais headers da requisição mudam a resposta (`Vary: Accept-Encoding` é normal; `Vary: Cookie` na prática desativa o cache compartilhado).

### `Cache-Control`: a origem decide { #cache-control }

A origem diz a todo cache — o navegador, a CDN, qualquer proxy no meio — o que ele pode fazer com uma resposta por meio do header `Cache-Control`[^2]:

| Diretiva | Significado |
|---|---|
| `max-age=N` | a resposta está fresca por N segundos (em qualquer cache) |
| `s-maxage=N` | frescor só para caches **compartilhados** (CDN, proxies); sobrepõe `max-age` neles |
| `public` / `private` | pode ser guardada por caches compartilhados / só pelo navegador do usuário |
| `no-cache` | pode ser guardada, mas precisa ser **revalidada** com a origem antes de cada uso |
| `no-store` | não pode ser guardada em lugar nenhum (dados pessoais, páginas de pagamento) |
| `stale-while-revalidate=N` | depois de expirar, sirva a cópia velha por até N s **enquanto** busca uma nova em segundo plano |
| `stale-if-error=N` | se a origem falhar, continue servindo a cópia velha por até N s |
| `immutable` | o conteúdo nunca vai mudar nesta URL; nem revalide |

A revalidação usa **validadores**: a origem envia um `ETag` (um identificador de versão) ou `Last-Modified`; o cache pergunta `If-None-Match: "v42"`, e a origem responde `304 Not Modified` sem corpo quando nada mudou — barato para os dois lados.

```http title="Typical BoxOffice responses"
# fingerprinted JavaScript bundle: cache "forever"
Cache-Control: public, max-age=31536000, immutable

# event page HTML: short in browsers, longer at the CDN, survive origin hiccups
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600

# seat availability JSON during the sale: micro-cache at the CDN for one second
Cache-Control: public, max-age=0, s-maxage=1, stale-while-revalidate=1

# the fan's order and payment pages: never cache
Cache-Control: private, no-store
```

### Invalidação: purgar ou versionar? { #invalidation }

A imagem do pôster do evento mudou. Como os 300 PoPs ficam sabendo? Há duas estratégias:

- **Purge (invalidação)**: chame a API da CDN para remover `/img/stadium.webp` (ou uma tag, ou um prefixo) de todos os PoPs. A próxima requisição dá miss e busca a nova versão. Purges não são instantâneos — eles se propagam em segundos a minutos, dependendo do provedor — e navegadores que já guardaram a versão antiga com `max-age` não serão purgados de jeito nenhum.
- **URLs versionadas (com fingerprint)**: nunca altere um arquivo no lugar. O build produz `app.3f9a1c.js`; um novo build produz `app.b71e02.js` e o HTML referencia o novo nome. Versões antigas e novas coexistem, os caches nunca servem a errada, e os arquivos podem ficar em cache com `immutable` por um ano. Só o pequeno HTML que os referencia precisa de um TTL curto.

Prefira URLs versionadas para todo arquivo estático e reserve os purges para casos excepcionais (um erro em uma página publicada, remoções por ordem judicial). É a versão de borda da piada mais antiga da computação — *só existem duas coisas difíceis em ciência da computação: invalidação de cache e dar nomes às coisas* — e as URLs versionadas resolvem a primeira fazendo a segunda. A invalidação em geral é estudada na [aula de caching](../../caching/index.md).

### Origin shield e cache em camadas { #origin-shield }

Com 300 PoPs, um arquivo novo pode causar **300 misses** — um por PoP — que vão todos para a origem. Um **cache em camadas** (*tiered cache*, ou **origin shield**) acrescenta uma camada intermediária: os PoPs perguntam a um cache regional, e só o cache regional pergunta à origem. A origem vê uma requisição por objeto em vez de uma por PoP, e o request collapsing no shield junta misses simultâneos para o mesmo objeto em uma única busca na origem.

``` diagram
flowchart LR
    p1[PoP Recife] --> sh[Origin shield<br/>São Paulo]
    p2[PoP Porto Alegre] --> sh
    p3[PoP Manaus] --> sh
    sh --> o[(Origem)]
```

### Quanto importa a taxa de acerto? { #hit-ratio }

A fração das requisições que a CDN atende a partir do cache é a **taxa de acerto** (*hit ratio*). A carga na origem é a fração de **miss** vezes o tráfego, então cada "nove" a mais na taxa de acerto divide a carga da origem por dez. Suponha (premissa ilustrativa) que 200.000 requisições por segundo cheguem à borda durante a venda:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO
plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

total = 200_000                      # requests per second at the edge (illustrative)
hit = np.linspace(0.50, 0.999, 400)  # CDN hit ratio
origin = total * (1 - hit)

fig, ax = plt.subplots(figsize=(8, 4))
ax.plot(hit * 100, origin, color="#2f6fed", linewidth=2)
ax.set_yscale("log")
ax.set_xlabel("CDN hit ratio (%)")
ax.set_ylabel("requests/s reaching the origin (log)")
ax.set_title("200 k req/s at the edge: origin load vs hit ratio")
for h, c in [(0.90, "#f59e0b"), (0.99, "#1e9e5a"), (0.999, "#e5484d")]:
    o = total * (1 - h)
    ax.scatter([h * 100], [o], color=c, zorder=3)
    ax.annotate(f"{h:.1%} hit -> {o:,.0f} req/s", (h * 100, o), textcoords="offset points",
                xytext=(-170, -4), color=c)
ax.grid(True, which="both", alpha=0.2)
ax.set_xlim(50, 100)

buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Ir de 90% para 99% de taxa de acerto parece uma melhora pequena ("só nove pontos"), mas corta a carga da origem de **20.000** para **2.000** requisições por segundo — dez vezes menos servidores. Quando discutir uma CDN em uma entrevista, fale da **taxa de miss**, não da taxa de acerto: é o número que dimensiona a origem.

**Experimente.** Carregue o cenário de CDN e rode o perfil **load**. Baixe a taxa de acerto da CDN (ou o TTL) passo a passo e observe a taxa de requisições e a latência p99 nos app servers crescerem; depois suba-a e veja de quão poucas réplicas da aplicação você precisa. Por fim, purgue o cache durante a execução: a onda repentina de misses é um stampede em pequena escala sobre a origem.

<div class="sdp" data-scenario="cdn-static" data-mode="compact" data-height="520" data-profile="load"></div>

[:material-open-in-new: Abrir o playground completo](../../../../playground/index.md)

### Cache de conteúdo dinâmico: micro-caching { #micro-caching }

"Dinâmico" não quer dizer "impossível de cachear". O JSON de disponibilidade de assentos do show no estádio muda o tempo todo, mas ninguém é prejudicado se ele tiver **um segundo de idade**. Se cada PoP o guarda por 1 s (`s-maxage=1`), a origem recebe no máximo uma requisição por segundo **por PoP** (ou por shield, com cache em camadas), não importa quantos fãs estejam fazendo polling. Com 2 milhões de fãs fazendo polling a cada 5 segundos — 400.000 requisições por segundo — e 50 PoPs atendendo o Brasil, a origem vê cerca de **50 requisições por segundo** para esse endpoint. O mapa de assentos fica no máximo um segundo desatualizado; a reserva em si (`POST /api/holds`) nunca é cacheada e é verificada contra o banco de dados, então um mapa desatualizado nunca causa uma venda em dobro.

### Edge compute { #edge-compute }

CDNs modernas também executam **o seu código** nos PoPs: Cloudflare Workers, AWS CloudFront Functions e Lambda@Edge, Fastly Compute, Akamai EdgeWorkers. São funções pequenas (milissegundos de CPU, memória limitada, normalmente JavaScript ou WebAssembly) executadas a cada requisição, antes do cache ou da origem. Bons usos:

- **Validar um token de sala de espera** ou a assinatura de um JWT na borda e rejeitar requisições inválidas antes que atravessem o oceano.
- **Reescrever e redirecionar**: testes A/B, redirecionamentos por idioma, normalizar a chave de cache (removendo os parâmetros `utm_*`).
- **Montar respostas** a partir de fragmentos em cache, ou acrescentar headers de segurança.
- Servir uma **página de sala de espera** inteiramente a partir da borda enquanto a origem é protegida.

Maus usos: qualquer coisa que precise do seu banco de dados a cada requisição (a função está longe dos dados, então cada chamada atravessa a rede de qualquer jeito), computações longas e lógica de negócio que seria mais bem testada e versionada em um serviço.

=== "AWS"

    - **DNS**: Route 53 (roteamento por latência, geolocalização, ponderado e failover; health checks).
    - **CDN**: CloudFront, com CloudFront Functions e Lambda@Edge para edge compute; Origin Shield.
    - **Origem**: S3 para arquivos estáticos e mídia; Application Load Balancer para APIs.
    - **Proteção**: AWS WAF e AWS Shield (o Standard está incluído; o Advanced é pago).

=== "GCP"

    - **DNS**: Cloud DNS (com políticas de roteamento por geolocalização e failover).
    - **CDN**: Cloud CDN, acoplado ao Application Load Balancer externo global; Media CDN para vídeo.
    - **Origem**: buckets do Cloud Storage ou backend services atrás do load balancer.
    - **Proteção**: Cloud Armor (regras de WAF e proteção contra DDoS).

=== "Azure"

    - **DNS**: Azure DNS; Traffic Manager para roteamento baseado em DNS (performance, prioridade, ponderado, geográfico).
    - **CDN**: Azure Front Door (ponto de entrada global L7 com CDN, WAF e roteamento).
    - **Origem**: Blob Storage, App Service, AKS atrás do Application Gateway.
    - **Proteção**: Azure WAF e Azure DDoS Protection.

=== "Open source / outros"

    - **DNS**: BIND, PowerDNS, CoreDNS (o DNS dentro do Kubernetes); gerenciados: Cloudflare DNS, NS1.
    - **CDN**: Cloudflare, Akamai, Fastly, Bunny; cache auto-hospedado com Varnish ou o `proxy_cache` do Nginx.
    - **Edge compute**: Cloudflare Workers, Fastly Compute, Akamai EdgeWorkers.

---

## Trade-offs em resumo { #trade-offs }

| Decisão | Opção A | Opção B | Escolha A quando… |
|---|---|---|---|
| TTL do DNS | curto (30–60 s) | longo (horas) | você precisa de failover rápido ou planeja uma mudança |
| Roteamento | por latência / GeoDNS | anycast | você precisa de controle por região (residência de dados, canários) |
| Failover | failover por DNS | anycast / LB global | alguns minutos de failover são aceitáveis e o custo baixo importa |
| Modelo de CDN | pull | push | o conteúdo é requisitado de forma imprevisível (a maior parte do tráfego web) |
| Atualidade | purge na mudança | URLs versionadas | a URL não pode mudar (a própria página HTML, uma API) |
| Dados dinâmicos | micro-cache (1–5 s) | sem cache | dados um pouco desatualizados são aceitáveis e o endpoint é quente |
| Lógica | função de borda | serviço na origem | a lógica é pequena, sem estado e precisa rodar antes da origem |

!!! example "BoxOffice: DNS e CDN para a venda do estádio"
    - `boxoffice.com` e `www` → **ALIAS/CNAME** para a CDN, que responde a partir de endereços anycast. `api.boxoffice.com` tem registros **por latência** para as regiões de São Paulo e Virgínia, com health checks de **failover** e um TTL de 60 s.
    - Arquivos estáticos (JavaScript, CSS, fontes) têm **fingerprint** e ficam em cache por um ano com `immutable`. Os pôsteres dos eventos vivem no object store e ficam em cache por um dia; a rara mudança usa um novo nome de arquivo.
    - O HTML da página do evento: `s-maxage=300, stale-while-revalidate=60, stale-if-error=3600`. Se a origem cair durante a venda, os fãs ainda veem a página.
    - Disponibilidade de assentos: **micro-cache de 1 s** na CDN, com um origin shield em São Paulo. Reservas, pedidos e pagamentos: `private, no-store`, nunca cacheados, sempre vão à origem.
    - Uma **função de borda** verifica o token da sala de espera em toda requisição `/api/*`; requisições sem um token válido recebem a página da sala de espera a partir da borda.

    Conta de guardanapo: 2 M de fãs × (1 página + 30 arquivos estáticos) na abertura, mais o polling, dão milhões de requisições por minuto; com 99% de taxa de acerto nos arquivos estáticos e micro-caching no mapa de assentos, a origem vê alguns milhares de requisições por segundo, quase todas reservas e pedidos — as requisições que realmente *precisam* da origem.

!!! tip "Na entrevista"
    - Diga **o que** você cacheia na CDN e **por quanto tempo**: "arquivos estáticos e imagens com URLs versionadas e TTLs longos; a página do evento por minutos com `stale-while-revalidate`; o mapa de assentos em micro-cache de 1 s; nada específico do usuário."
    - Quantifique com a **taxa de miss**: "com 99% de taxa de acerto, 200 mil req/s na borda viram 2 mil na origem."
    - Mencione o **DNS** em uma frase — "DNS por latência até a região mais próxima, com failover por health check" — e conheça o limite dele: o failover leva cerca de **detecção + TTL**, minutos, não segundos.
    - Para um sistema global e com muitas leituras (feed de notícias, streaming de vídeo, redirecionamentos de um encurtador de URL), a CDN muitas vezes é *o* componente mais importante do design.

!!! success "Boas práticas"

    - **Defina `Cache-Control` explicitamente em toda resposta da origem** — inclusive `private` ou `no-store` em dados pessoais; nunca deixe o padrão de uma CDN decidir o que é compartilhado.
    - **Baixe o TTL do DNS dias antes de uma migração ou venda planejada, e suba-o depois** — os resolvers mantêm o TTL antigo até ele expirar, então a mudança precisa ser feita um TTL antes.
    - **Monitore a taxa de acerto por caminho e alerte quando ela cair** — de 95% para 80% quadruplica a carga da origem (de 5% para 20% das requisições).
    - **Sirva `stale-if-error` e `stale-while-revalidate`** — a CDN continua respondendo com a última cópia boa quando a origem falha ou está sendo atualizada.
    - **Mantenha as páginas estáticas de fallback na CDN** — "esgotado", a sala de espera, a página de manutenção; elas precisam carregar quando todos os serviços atrás delas estão fora.

!!! warning "Armadilhas"
    - **Cachear respostas personalizadas** em um cache compartilhado porque um cookie ou o header `Authorization` não está na chave de cache: um usuário vê os dados de outro. Marque-as como `private` ou `no-store`.
    - **Purge como estratégia de deploy**: purges são lentos, podem falhar e não chegam aos navegadores. Use nomes de arquivo versionados.
    - **Cache-busting por acidente**: parâmetros de query aleatórios, timestamps nas URLs ou `Vary: Cookie` derrubam a taxa de acerto para zero sem ninguém perceber.
    - **Thundering herd na expiração**: se um objeto quente expira em todos os PoPs ao mesmo tempo, todos dão miss juntos. Origin shield, request collapsing e `stale-while-revalidate` evitam isso.
    - **Confiar no failover por DNS para uma recuperação rápida**: TTLs baixos nem sempre são respeitados; conexões de longa duração não resolvem o nome de novo.
    - **Esquecer que a CDN é uma dependência**: uma queda da CDN derruba o seu site também. Sites muito grandes usam duas CDNs (multi-CDN) com direcionamento por DNS entre elas.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    TTL["TTL do DNS"] --> FO["velocidade do failover<br/>→ multirregião (aula 3)"]
    ANY["anycast"] --> DDOS["absorção de DDoS<br/>→ segurança na borda"]
    GEO["GeoDNS / roteamento por latência"] --> HOME["região de origem por evento<br/>→ CAP e PACELC"]
    HIT["taxa de acerto da CDN"] --> ORIGIN["carga na origem<br/>→ Estimativas"]
    CC["Cache-Control, TTL"] --> STALE["dado desatualizado = consistência eventual<br/>→ Replicação e Consistência"]
    INV["invalidação, URLs versionadas"] --> CACHE["invalidação de cache<br/>→ Caching"]
    EC["edge compute"] --> WR["verificação do token da sala de espera<br/>→ API gateway"]
```

**Componentes da paleta:** [`dns`](../../../reference/components/edge/index.md#dns) · [`cdn`](../../../reference/components/edge/index.md#cdn) · [`objstore`](../../../reference/components/storage/index.md#objstore) (a origem usual da CDN para imagens e vídeo) · [`cache`](../../../reference/components/storage/index.md#cache) (a próxima camada de cache atrás da CDN). **Cenários:** `cdn-static`, `multi-region`, `video-streaming`. **Continua em:** [Caching — padrões](../../caching/patterns/index.md), [Sistemas Distribuídos — CAP e PACELC](../../distributed/cap-pacelc/index.md#multi-region), [Estudo de caso: streaming de vídeo](../../case-studies/video-streaming/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - O DNS é um banco de dados **hierárquico, delegado e cacheado**; o cache dos resolvers recursivos faz com que os servidores autoritativos vejam uma consulta por resolver por TTL.
    - O **TTL** troca propagação de mudanças por carga de consultas; baixe-o *antes* de uma mudança planejada.
    - O DNS pode rotear por **geografia, latência, peso ou saúde**; o failover por DNS leva cerca de **detecção + TTL**, e alguns clientes ignoram TTLs.
    - O **anycast** anuncia o mesmo IP a partir de vários locais: baixa latência, failover rápido e absorção de DDoS.
    - Uma **CDN** corta a latência, alivia a origem e absorve ataques; a maioria das CDNs faz **pull** da origem e guarda em cache por uma **chave de cache** que você precisa projetar.
    - A origem controla o cache com **`Cache-Control`**; prefira **URLs versionadas** a purges; o **micro-caching** torna baratos os endpoints dinâmicos quentes.
    - Cada nove a mais na **taxa de acerto** divide a carga da origem por dez.

---

[^1]: MOCKAPETRIS, P. [RFC 1034 — Domain Names: Concepts and Facilities](https://www.rfc-editor.org/rfc/rfc1034){target="_blank"} e [RFC 1035 — Implementation and Specification](https://www.rfc-editor.org/rfc/rfc1035){target="_blank"}. IETF, 1987.
[^2]: FIELDING, R.; NOTTINGHAM, M.; RESCHKE, J. [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111){target="_blank"}. IETF, 2022. Veja também NOTTINGHAM, M. [RFC 5861 — HTTP Cache-Control Extensions for Stale Content](https://www.rfc-editor.org/rfc/rfc5861){target="_blank"}, 2010.
[^3]: CLOUDFLARE. [What is a CDN?](https://www.cloudflare.com/learning/cdn/what-is-a-cdn/){target="_blank"} e [What is anycast?](https://www.cloudflare.com/learning/cdn/glossary/anycast-network/){target="_blank"} — Cloudflare Learning Center.
[^4]: AWS. [Amazon Route 53 — Choosing a routing policy](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html){target="_blank"}. AWS Documentation.
[^5]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 1 (CDN, DNS). Byte Code LLC, 2020.
