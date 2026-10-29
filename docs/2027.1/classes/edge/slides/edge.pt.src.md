---
marp: true
lang: pt-BR
title: Tráfego & Borda
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Tráfego & Borda

**DNS, CDN, WAF, load balancers, API gateways e os protocolos entre eles**

<!--
Roteiro: (1) a jornada da requisição e a segurança na borda; (2) DNS e CDN; (3) load balancing e
consistent hashing; (4) API gateway e rate limiting; (5) protocolos: HTTP/1.1, 2, 3, TLS, SSE,
WebSockets, gRPC.
-->

---

## 10:00 — a venda abre

<div class="q">

**2 milhões de fãs**, **60 mil assentos**, todos apertam "atualizar" às 10:00:00.
Quantas dessas requisições deveriam chegar ao serviço `inventory`?

</div>

* O **mínimo possível** — e só de fãs reais, em ordem justa.
* Tudo entre o celular e o primeiro serviço é **a borda**.
* Cada salto toma uma **decisão** e deve **remover trabalho** do seguinte.

<!--
Deixe a turma chutar. A resposta guia a aula inteira: cachear o que pode ser cacheado, filtrar o
que precisa ser filtrado, limitar o que sobra, e só então balancear entre réplicas saudáveis.
-->

---

## A jornada da requisição

| Id na paleta | Decide | Camada |
|---|---|---|
| `dns` | **para onde** o cliente vai: IP, região, localidade de borda | DNS |
| `cdn` | se a requisição precisa ir **adiante** | L7 |
| `waf` | se a requisição é **permitida** (ataques, bots) | L7 |
| `lb` | **qual réplica** a atende (só as saudáveis) | L4 / L7 |
| `apigw` | se o **chamador** está autenticado e dentro da cota | L7 |
| `ingress` | qual **Service** do cluster a recebe | L7 |

<p class="small">A maioria são <b>reverse proxies</b>: terminação TLS, cache, compressão, segurança e logs num só lugar. Produtos reais juntam caixas (Cloudflare = DNS + CDN + WAF + DDoS).</p>

---

## Segurança na borda: WAF, bots, DDoS

| Ameaça | Defesa |
|---|---|
| SQL injection, XSS, path traversal | regras gerenciadas do **WAF** (OWASP CRS), modo count primeiro |
| Bots de cambistas, credential stuffing | rate limits, fingerprints, desafios, regras de negócio |
| Vantagem do "primeiro segundo" na venda | **sala de espera virtual**: admite N usuários/min |
| Inundação volumétrica (L3/L4) | capacidade **anycast** + scrubbing — você compra |
| Requisições caras de aparência válida (L7) | cache, rate limits, desafios — você projeta |

<div class="ok">

A borda é o **lugar mais barato** para descartar tráfego ruim: ele ainda não custou nada ao núcleo.

</div>

---

## DNS: um banco de dados em cache e delegado

- **Hierarquia**: raiz → `com.` → `boxoffice.com.` (autoritativo) — delegado, lido da direita para a esquerda.
- O celular pergunta a um **resolver recursivo**, que percorre a hierarquia e **cacheia** pelo **TTL**.
- Servidores autoritativos veem ≈ **uma consulta por resolver por TTL**, não uma por fã.
- Registros: `A`/`AAAA` (IP), `CNAME` (alias), `ALIAS` (apex), `NS`, `MX`, `TXT`, `CAA`.
- O **TTL** troca velocidade de propagação por carga de consultas — **reduza-o antes de uma migração**.

<!--
Pergunte: 2 milhões de fãs consultam boxoffice.com às 10:00 — quantas consultas chegam ao DNS do BoxOffice?
Milhares de resolvers × uma vez por TTL.
-->

---

## Roteamento com DNS, e anycast

| Política | A resposta depende de |
|---|---|
| GeoDNS | país do cliente (residência de dados) |
| Por latência | a região com menor latência |
| Ponderada | uma porcentagem (canary via DNS) |
| Failover | um health check |

<div class="warn">

Failover de DNS ≈ **detecção + TTL**: 3 × 10 s + 60 s ≈ 90 s no melhor caso — e alguns clientes ignoram TTLs.

</div>

**Anycast**: o mesmo IP anunciado de muitas localidades → borda mais próxima, failover rápido, absorção de DDoS.

---

## CDN: conteúdo perto do fã

- **PoPs** (pontos de presença) cacheiam conteúdo perto dos usuários: latência, **offload**, proteção.
- **Pull** (busca no primeiro miss) para quase tudo; **push** para arquivos grandes conhecidos (vídeo).
- **Cache key** = host + path + query por padrão: descarte `utm_*`, nunca ignore um cookie que personaliza.
- **Origin shield**: uma camada regional entre PoPs e origem → um miss por objeto, não por PoP.
- **Edge compute**: checar token da sala de espera, redirects, A/B — não lógica presa ao banco.

---

## `Cache-Control`: quem decide é a origem

```http
# fingerprinted bundle
Cache-Control: public, max-age=31536000, immutable
# event page: survive origin hiccups
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600
# seat map during the sale: micro-cache
Cache-Control: public, max-age=0, s-maxage=1
# order and payment pages
Cache-Control: private, no-store
```

<div class="ok">

Prefira **URLs versionadas** (`app.b71e02.js`) a **purges**: purges são lentos e nunca chegam aos navegadores.

</div>

---

## Hit ratio: fale da taxa de miss

<div class="q">

200.000 req/s na borda. O hit ratio vai de **90%** para **99%**. Carga na origem?

</div>

* 90% → **20.000** req/s na origem.
* 99% → **2.000** req/s — dez vezes menos servidores.
* **Micro-caching** (1 s) do mapa de assentos: 400 mil req/s de polling → ≈ **1 req/s por PoP**.

<p class="small">Cada nove a mais de hit ratio divide a carga na origem por dez.</p>

---

## Load balancing: L4 vs L7

| | L4 | L7 |
|---|---|---|
| Unidade | conexão | requisição |
| Enxerga | IPs, portas | método, path, cabeçalhos, cookies |
| TLS | repassa | termina |
| Roteamento por path | não | sim |
| Custo | muito baixo | maior por requisição |

<p class="small">Arranjo comum: L4 (ou anycast) na frente de uma frota de proxies L7 (Envoy, Nginx). Pré-condição de tudo isso: <b>réplicas stateless</b>.</p>

---

<!-- _class: tight -->

## Algoritmos de balanceamento

| Algoritmo | Escolhe | Use quando |
|---|---|---|
| Round robin / ponderado | o próximo do ciclo | requisições uniformes; canaries por peso |
| Least connections | menos em andamento | custos de requisição desiguais |
| **Power of two choices** | o melhor de 2 aleatórios | muitas instâncias de LB, sem efeito manada |
| Least response time (EWMA) | menor latência recente | desviar de servidores degradados |
| IP hash | `hash(ip) mod N` | raramente — NATs, reembaralhamentos |
| **Consistent hashing** | primeiro nó no sentido horário do anel | a chave precisa cair onde estão seus dados |

<div class="ok">

Ao adicionar um nó: `hash mod N` move ≈ **N/(N+1)** das chaves; o anel move ≈ **1/(N+1)**. **Nós virtuais** (100–200 por servidor) equilibram o anel.

</div>

---

## Health checks, draining, afinidade

- Checks **ativos**: o LB sonda `/health/readiness`; **passivos**: ejeta réplicas que devolvem 5xx.
- A readiness verifica a **instância**, não dependências compartilhadas (um soluço do banco ejetaria todas).
- **Draining**: para de aceitar requisições novas, termina as em andamento, depois remove — deploys invisíveis.
- **Sticky sessions** tornam as réplicas stateful: sessões perdidas, carga desigual. Prefira um store compartilhado.
- O LB não pode ser SPOF: LB gerenciado multi-zona, par ativo-passivo com VIP, ou anycast.

---

## Kubernetes: Service, Ingress, Gateway API

| Objeto | Faz |
|---|---|
| `Service` | IP/DNS estável, L4 sobre pods **prontos** |
| `Ingress` | roteamento L7 básico por host/path; extras via annotations não portáveis |
| `GatewayClass` | qual implementação (Envoy, Istio, Cilium, nuvem) |
| `Gateway` | listeners, portas, TLS — do time de plataforma |
| `HTTPRoute` | matches, **pesos**, timeouts — dos times de aplicação |

<p class="small">A Gateway API é a sucessora do Ingress: orientada a papéis e portável, com pesos de canary e rotas gRPC no padrão.</p>

---

## O API gateway

- Ponto único de entrada: **roteamento**, **offload de authN** (JWT), authZ grossa, **rate limits**, cotas.
- Também: transformações, agregação, cache curto, logs/métricas/traces, API keys e planos.
- **BFF** (Backend for Frontend): uma camada fina por tipo de cliente (mobile, web, parceiros).
- Gateway ≠ LB ≠ ingress ≠ **service mesh** (tráfego leste-oeste, mTLS).

<div class="warn">

Mantenha-o **burro**: regras de negócio no gateway viram um segundo monólito escondido — e ele está no caminho de toda requisição.

</div>

---

## Token bucket

<div class="cols">
<div>

- Balde de **capacidade** C (rajada), reabastecido à **taxa** r (sustentada).
- Cada requisição consome um token; vazio → **429**.
- Dois números por chave; reposição calculada sob demanda: `tokens += elapsed × r`.

</div>
<div>

<div class="q">

C = 20, r = 10/s. Um fã ocioso envia 50 requisições de uma vez.

</div>

* **20** aceitas, 30 rejeitadas.
* Depois: no máximo **10/s**.

</div>
</div>

---

<!-- _class: tight -->

## Algoritmos de rate limiting

| Algoritmo | Memória por chave | Rajadas | Nota |
|---|---|---|---|
| **Token bucket** | 2 números | até a capacidade | padrão nos gateways |
| **Leaky bucket** | uma fila | suavizadas | taxa de saída constante; `limit_req` do Nginx |
| **Fixed window** | 1 contador | **2× nas fronteiras** | 100 às 10:00:59 + 100 às 10:01:00 |
| **Sliding window log** | 1 timestamp por requisição | nenhuma | exato, pesado em memória |
| **Sliding window counter** | 2 contadores | ≈ limitadas | `cur + prev × (1 − elapsed/window)` |

<p class="small">Seis réplicas do gateway com contadores locais = 6× o limite → contadores compartilhados no <b>Redis</b>, atualizados de forma atômica (Lua). Decida: fail open ou fail closed? Responda <code>429</code> + <code>Retry-After</code>; limite em camadas: borda (IP), gateway (usuário), serviço (regras de negócio).</p>

---

## Sessões vs tokens

| | Sessão no servidor | Access token JWT |
|---|---|---|
| O cliente guarda | id aleatório | claims assinadas |
| Validação | consulta (Redis) | assinatura, localmente |
| Revogação | imediata | só no `exp` |
| Escala | store compartilhado | stateless |

<div class="q">

Tokens vivem 15 min, validados localmente. Refresh revogado às 14:05, último token emitido às 13:58. Até quando um ladrão consegue chamar a API?

</div>

* **14:13** — a janela de exposição é um tempo de vida do token. Tokens mais curtos, introspecção ou DPoP a reduzem.

---

## OAuth 2.1 em um slide

- **Autorização delegada**: o cliente recebe um token limitado e de vida curta; ele **nunca vê a senha**.
- Papéis: resource owner · client (público / confidencial) · authorization server · resource server.
- **PKCE para todo** client de authorization code; **Implicit e ROPC removidos**.
- Comparação **exata** do redirect URI; nada de tokens em URLs; refresh tokens **rotacionados** ou vinculados ao remetente.
- Grants: **Auth Code + PKCE** (usuários) · **Client Credentials** (jobs) · **Device** (TVs) · **Token Exchange** (delegação).

---

## O app mobile: Authorization Code + PKCE

1. O app cria o `code_verifier`; envia `code_challenge = S256(verifier)` + `state` + `nonce`.
2. O **navegador do sistema** abre `/authorize`; o usuário faz login no `auth` (MFA / passkey).
3. O redirect traz de volta um **code** de uso único; o app confere o `state`.
4. O app envia `code` + `code_verifier` para `/token`; o servidor compara os hashes.
5. Recebe os tokens **access** (15 min) + **refresh** (rotativo) + **ID**.
6. O gateway verifica o JWT **localmente** (JWKS): assinatura, `iss`, `aud`, `exp`, escopo.

<div class="ok">

Um code roubado é inútil sem o verifier. A senha nunca toca o código do BoxOffice.

</div>

---

## OIDC e a validação de um JWT

<div class="cols">
<div>

**O OIDC acrescenta**
- o escopo `openid`
- **ID token** para o *client*
- endpoint UserInfo
- discovery: `/.well-known/openid-configuration`
- web: um **BFF** guarda os tokens, o navegador recebe um cookie `HttpOnly`

</div>
<div>

**Validar (RFC 8725)**
- `alg` em lista permitida, chave pelo `kid`
- `iss` = nosso provedor
- `aud` = **esta** API
- `exp` / `nbf`, pequena tolerância de relógio
- `typ` = `at+jwt`, escopos

</div>
</div>

---

## Modelos de autorização

| Modelo | Decide por | BoxOffice |
|---|---|---|
| **RBAC** | papéis | `organizer` cria eventos |
| **ABAC** | atributos + contexto | reembolso só > 48 h antes do show |
| **ReBAC** | relacionamentos | Bruno vê o ingresso que a Ana compartilhou |

- Escopos limitam o **client**; a posse limita o **usuário** → checagem de BOLA em `order`.
- Política como código: **OPA / Rego**, **Cedar**, OpenFGA.

---

## HTTP/1.1 → HTTP/2 → HTTP/3

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transporte | TCP | TCP | QUIC (UDP) |
| Por conexão | 1 requisição por vez | streams multiplexados | streams independentes |
| Head-of-line blocking | HTTP + TCP | TCP | nenhum entre streams |
| Handshake até o 1º byte (nova) | TLS 1.2: 4 RTT · 1.3: 3 | TLS 1.2: 4 RTT · 1.3: 3 | 2 RTT · 0-RTT: 1 |
| Sobrevive a Wi-Fi → 4G | não | não | **sim** (connection ID) |

<p class="small">Com RTT de 150 ms: 600 ms vs 300 ms antes do primeiro byte. Melhor handshake: o que você não repete (keep-alive, pooling, borda perto do usuário).</p>

---

## Tempo real e serviço a serviço

| Opção | Direção | Bom para |
|---|---|---|
| Polling (+ micro-cache na CDN) | cliente puxa | atualizações a cada poucos segundos; o mais barato |
| Long polling | cliente puxa, servidor segura | clientes legados |
| **SSE** | servidor → cliente, HTTP comum, retomada automática | mapa de assentos, sala de espera, streaming de LLM |
| **WebSockets** | nos dois sentidos, stateful | chat, jogos, colaboração |
| **gRPC** | unary + streaming sobre HTTP/2, deadlines | `order` → `inventory` |

<div class="warn">

Conexões de longa duração são balanceadas **ao conectar**: réplicas novas ficam ociosas; deploys causam **tempestades de reconexão** → balanceamento L7/no cliente, idade máxima de conexão, jitter.

</div>

---

## O mapa de conceitos da borda

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `dns` | *para onde* o cliente vai? | TTL, GeoDNS, anycast, failover |
| `cdn` | precisa ir adiante? | cache key, `Cache-Control`, hit ratio |
| `waf` | a requisição é *permitida*? | regras, bots, sala de espera, DDoS |
| `lb` | *qual réplica*? | L4/L7, P2C, consistent hashing, saúde |
| `apigw` | o *chamador* é permitido, dentro da cota? | JWT, token bucket, BFF |
| `ingress` | qual *Service* do cluster? | Gateway API, service discovery |

<p class="small">Cada salto deve <b>remover trabalho</b> do seguinte. Os protocolos (HTTP/2, HTTP/3, SSE, WebSockets, gRPC) atravessam todos eles.</p>

---

## Pontos-chave

1. A borda — `dns`, `cdn`, `waf`, `lb`, `apigw`, `ingress` — existe para **remover trabalho** do núcleo.
2. O DNS é cacheado pelo TTL; failover de DNS ≈ detecção + TTL; **anycast** para latência e DDoS.
3. Dimensione a origem pela **taxa de miss** da CDN; URLs versionadas; **micro-cache** para dados dinâmicos quentes.
4. L4 balanceia conexões, L7 requisições; **P2C** para carga desigual, **consistent hashing** para afinidade.
5. O gateway centraliza só políticas **transversais**; **token bucket** = rajada + taxa, no Redis.
6. Conte **round trips**: TLS 1.3 e QUIC encurtam handshakes; **SSE** para push unidirecional, WebSockets para bidirecional.
