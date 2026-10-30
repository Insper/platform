# Tráfego e borda { #traffic-edge }

A **borda** (*edge*) é tudo o que fica entre o cliente e o código da sua aplicação: ela encontra os seus servidores (DNS), entrega de perto do usuário o que pode ser entregue de perto (CDN), espalha o tráfego por muitas réplicas (load balancer), bloqueia o que nunca deveria chegar até você (WAF) e aplica as regras transversais da sua API — autenticação, limites de taxa, roteamento (API gateway, Ingress). Uma requisição respondida ou rejeitada na borda é a requisição mais barata que você vai servir.

No BoxOffice, é a borda que mantém viva a venda relâmpago das 10:00: a página do evento e as imagens vêm da CDN, os robôs são filtrados pelo WAF, o API gateway limita cada usuário a poucas tentativas de compra por minuto e o load balancer espalha os sobreviventes pelas réplicas de `inventory` e `order`.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [DNS](#dns) | Traduz nomes em endereços IP; pode direcionar usuários por geografia, peso ou saúde | `dns` |
| [CDN](#cdn) | Um cache mundial do seu conteúdo, perto dos usuários | `cdn` |
| [Load Balancer](#lb) | Espalha requisições pelas réplicas saudáveis (L4 ou L7) | `lb` |
| [WAF](#waf) | Filtra tráfego HTTP malicioso: injeção, robôs, padrões abusivos | `waf` |
| [API Gateway](#apigw) | Porta de entrada única da API: autenticação, rate limiting, roteamento, BFF | `apigw` |
| [Ingress](#ingress) | O jeito Kubernetes de rotear tráfego HTTP externo para os serviços | `ingress` |

``` diagram
flowchart LR
    C[Client] -->|1 resolve o nome| DNS
    C -->|2 estáticos e mídia| CDN
    CDN -->|3 chamadas dinâmicas à API| WAF
    WAF --> GW[API Gateway]
    GW --> LB[Load Balancer / Ingress]
    LB --> A1[App Server]
    LB --> A2[App Server]
```

---

## DNS { #dns }

**O que é.** O Domain Name System é a lista telefônica da internet: transforma `api.boxoffice.example` em um endereço IP. A resolução vai do *stub resolver* do cliente até um resolvedor recursivo (o do seu provedor, 8.8.8.8, 1.1.1.1), que consulta a raiz, o domínio de topo (`.example`) e, por fim, os seus servidores de nomes **autoritativos**. As respostas ficam em cache pelo **TTL** (time to live) do registro. Serviços de DNS gerenciado acrescentam *direcionamento de tráfego*: respostas diferentes conforme a localização do usuário (GeoDNS), o peso (canário) ou a saúde (failover).

**Quando usar.**

- Sempre — todo sistema público tem DNS. A pergunta de projeto é qual **política de roteamento** usar.
- **Failover entre regiões**: registros com health check respondem com a região secundária quando a primária cai (cenário `multi-region`).
- **Roteamento por latência/geografia**: mandar usuários brasileiros para `sa-east-1` e europeus para `eu-west-1`.
- **Roteamento ponderado** para migrações e canários no nível mais grosso (10% dos usuários para a nova pilha).

**Quando não usar (ou cuidado).**

- DNS **não** é um load balancer rápido: clientes e resolvedores guardam respostas em cache e alguns ignoram o TTL, então mudanças levam de segundos a muitos minutos para se propagar.
- Não confie no round robin de DNS para saúde: um IP morto pode continuar recebendo tráfego até os caches expirarem. Coloque um load balancer atrás do DNS.
- TTLs muito baixos (poucos segundos) aumentam o volume de consultas e a latência com pouco ganho.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Consulta respondida pelo cache de um resolvedor próximo | ≈ 1–10 ms | A maioria das consultas |
| Consulta recursiva completa (cache miss) | ≈ 20–120 ms | Várias idas e voltas: raiz → TLD → autoritativo |
| TTLs comuns | 60–300 s para registros de failover; horas para registros estáveis | Trade-off: agilidade vs volume de consultas |
| Tempo de failover com DNS com health check | ≈ intervalo do health check × limiar + TTL | ex.: 3 × 10 s + 60 s ≈ 1,5 min (≈ ilustrativo) |
| Anycast | um IP anunciado a partir de muitos locais | Usado por grandes provedores de DNS e CDNs para responder do ponto mais próximo |

**Modos de falha.**

- **Pane do provedor de DNS** — ninguém consegue resolver o seu nome, mesmo com os servidores funcionando → um segundo provedor de DNS, TTLs longos em registros estáveis.
- **Failover lento** — respostas em cache apontam para a região morta → TTL menor nos registros de failover, um load balancer com health checks atrás de cada nome.
- **Configuração errada** — um registro errado ou um domínio expirado derruba o site inteiro → infraestrutura como código, revisão, monitoração da resolução de fora.
- **DDoS nos servidores de nomes** → provedor de DNS anycast com proteção contra DDoS.

**No playground.** `dns` é um nó de **divisão** (*split*): distribui as requisições entre os seus alvos. O modo de roteamento pode ser `failover` (primário/secundário: todo o tráfego vai para o primário enquanto ele estiver saudável) ou `weighted` (divisão proporcional). A detecção de falhas (≈ 30 s, ≈ 3 s com health check) somada às respostas guardadas pelos clientes por `ttlS` (padrão 60 s) faz o failover demorar — observe o pico de erros durante a queda de uma região. Cenários: [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static).

**Produtos reais.**

=== "AWS"

    - **Amazon Route 53** — DNS autoritativo com health checks e políticas de roteamento (failover, latência, geolocalização, ponderado).

=== "GCP"

    - **Cloud DNS** — DNS autoritativo gerenciado com políticas de roteamento (geolocalização, round robin ponderado, failover).

=== "Azure"

    - **Azure DNS** — DNS autoritativo gerenciado.
    - **Azure Traffic Manager** — direcionamento de tráfego baseado em DNS (prioridade, ponderado, desempenho, geográfico).

=== "Código aberto"

    - **CoreDNS** — servidor DNS usado dentro do Kubernetes para descoberta de serviços.
    - **BIND** — o servidor DNS clássico, autoritativo e recursivo.
    - **PowerDNS** — servidor autoritativo e recursor com back ends em banco de dados.

!!! tip "Na entrevista"
    "O DNS leva os usuários à região certa — GeoDNS para latência, failover com health check entre regiões —, mas as respostas ficam em cache, então nunca dependo dele para failover rápido dentro de uma região; esse é o trabalho do load balancer."

**Saiba mais:** [Borda › DNS e CDN](../../../classes/edge/dns-cdn/index.md) · [Confiabilidade › Recuperação de desastres](../../../classes/reliability/disaster-recovery/index.md) · [Rede e segurança › Rede na nuvem](../../../classes/network-security/cloud-network/index.md)

---

## CDN { #cdn }

**O que é.** Uma Content Delivery Network é uma frota de servidores de cache (*edges*, *pontos de presença*) espalhados pelo mundo. O usuário busca `event-hero.jpg` em um edge a poucos milissegundos; só em um **miss** o edge vai até a sua **origem** (object store ou aplicação). CDNs modernas também terminam TLS, absorvem ataques DDoS, executam pequenas funções na borda (*edge compute*) e guardam respostas de API em cache quando instruídas.

**Quando usar.**

- Arquivos estáticos (JavaScript, CSS, fontes) e mídia (imagens, segmentos de vídeo): quase sempre.
- Conteúdo público de leitura intensa, igual para todos: as páginas de evento do BoxOffice durante a venda relâmpago podem ficar alguns segundos em cache — 2 M de fãs lendo a mesma página viram um punhado de requisições na origem.
- Streaming de vídeo: segmentos de títulos populares são servidos quase inteiramente pelos edges (cenário `video-streaming`).
- Como escudo: a CDN absorve picos de tráfego e ataques antes que cheguem à origem.

**Quando não usar (ou cuidado).**

- Respostas personalizadas ou sensíveis (carrinho, histórico de pedidos) não podem ficar em um cache compartilhado: use `Cache-Control: private` ou `no-store`.
- Dados com consistência forte (disponibilidade de assentos no momento da compra) não podem vir de um cache que pode estar segundos atrasado.
- A **chave de cache** importa: query strings, cookies ou cabeçalhos na chave podem explodir o número de variantes e matar a taxa de acerto.
- A invalidação é lenta e às vezes paga: prefira nomes de arquivo versionados (`app.3f9a1c.js`) a purges.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência de um hit no edge para um usuário próximo | ≈ 5–30 ms | vs ≈ 100+ ms até uma origem distante |
| Taxa de acerto para arquivos estáticos | frequentemente > 90% | Menor para conteúdo de cauda longa |
| Carga na origem com taxa de acerto *h* | (1 − *h*) × requisições | 95% de acerto ⇒ a origem vê 1/20 do tráfego |
| Propagação de uma invalidação | segundos a minutos | Depende do provedor |
| Preço de egress | ≈ US$ 0,02–0,09 por GB | ≈ preços de tabela aproximados (2026); cai com o volume |

**Modos de falha.**

- **Cache frio / tempestade de purges** — depois de um deploy ou de um purge total, toda requisição vai para a origem → escalonar purges, URLs versionadas, *origin shield* (um cache intermediário).
- **Estouro de cache (stampede) quando um objeto popular expira** → coalescência de requisições no edge, `stale-while-revalidate`.
- **Cachear dados privados** — um usuário vê a página de outro → `Cache-Control` correto, nunca cachear respostas que definem cookies.
- **Conteúdo velho** — um evento cancelado ainda aparece "à venda" → TTL curto para páginas dinâmicas, purge na mudança.
- **Pane do provedor de CDN** → multi-CDN com direcionamento por DNS para as propriedades mais críticas.

**No playground.** `cdn` é um nó de **cache**: leituras acertam com probabilidade `hitRatio` e voltam do edge com latência curta (mediana ≈ 15 ms); misses e escritas são encaminhados à origem. Eventos como um flush do cache derrubam a taxa de acerto para 0, que se recupera ao longo de `cacheWarmS` (padrão 60 s) — observe a carga na origem saltar. O custo inclui egress por GB (`respKB`, padrão 50 KB por resposta, a ≈ 0,03 USD/GB). Cenários: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static), [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale).

**Produtos reais.**

=== "AWS"

    - **Amazon CloudFront** — CDN global com Lambda@Edge e CloudFront Functions para computação na borda.

=== "GCP"

    - **Cloud CDN** — CDN integrada ao load balancer externo do Google Cloud.
    - **Media CDN** — CDN para entrega de vídeo e mídia em grande escala.

=== "Azure"

    - **Azure Front Door** — CDN global + load balancer de camada 7 com WAF.

=== "Código aberto"

    - **Varnish Cache** — cache HTTP de proxy reverso, programável com VCL.
    - **Nginx** — `proxy_cache` o transforma em um proxy reverso com cache.
    - **Apache Traffic Server** — proxy com cache usado por grandes CDNs.
    - CDNs comerciais frequentemente comparadas: Cloudflare, Akamai, Fastly.

!!! tip "Na entrevista"
    "Tudo o que é igual para todo usuário passa pela CDN: arquivos estáticos com URLs versionadas e TTLs longos, e até a página do evento com alguns segundos de TTL durante a abertura das vendas. Com 95% de acerto a origem vê uma requisição em vinte; tudo o que é pessoal ou exige consistência forte passa direto pela CDN."

**Saiba mais:** [Borda › DNS e CDN](../../../classes/edge/dns-cdn/index.md) · [Caching › Padrões](../../../classes/caching/patterns/index.md) · [Estudo de caso: streaming de vídeo](../../../classes/case-studies/video-streaming/index.md) · [Estudo de caso: venda de ingressos](../../../classes/case-studies/ticketing/index.md)

---

## Load Balancer { #lb }

**O que é.** Um load balancer recebe conexões em um endereço e as espalha por um conjunto de backends **saudáveis**. Um balanceador de **camada 4** (L4) trabalha com conexões TCP/UDP e não olha dentro delas — muito rápido, agnóstico ao protocolo. Um balanceador de **camada 7** (L7) entende HTTP: pode rotear por caminho ou cabeçalho, terminar TLS, repetir requisições e espalhar as requisições individuais de uma conexão longa. Health checks removem do conjunto as réplicas quebradas.

**Quando usar.**

- Assim que houver mais de uma réplica de qualquer coisa: é ele que torna possíveis a **escala horizontal** e os deploys sem downtime.
- Para esconder falhas: uma réplica que caiu é removida depois de alguns health checks falhos.
- L7 quando você precisa de roteamento por caminho (`/api/catalog` → catalog, `/api/orders` → order), terminação TLS, balanceamento de HTTP/2 ou gRPC.
- L4 para TCP puro (bancos de dados, MQTT), vazão extrema ou quando o TLS precisa chegar intacto ao backend.

**Quando não usar (ou cuidado).**

- O próprio load balancer precisa ser redundante (os gerenciados são; uma única VM com Nginx é um ponto único de falha).
- **Sessões fixas** (*sticky sessions*) prendem usuários a réplicas e atrapalham a distribuição uniforme e o failover; prefira app servers sem estado, com os dados de sessão em um cache.
- Round robin ignora a carga: para requisições com custos muito diferentes, use least-connections ou least-outstanding-requests.
- Balanceamento L4 de conexões longas (gRPC, WebSockets) pode deixar réplicas novas ociosas — balanceie por requisição (L7) ou reconecte periodicamente.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência adicionada | L4: ≪ 1 ms; L7: ≈ 1 ms ou menos | Mais a terminação TLS, se feita ali |
| Health check | intervalo de 5–30 s, 2–3 falhas para remover | Tempo de detecção ≈ intervalo × limiar |
| Capacidade de um LB gerenciado | escala a milhões de req/s | Alguns precisam de "pré-aquecimento" para picos enormes e repentinos |
| LB em software em uma VM (Nginx/HAProxy) | dezenas de milhares de req/s por núcleo | ≈ ilustrativo; depende de TLS e do payload |

**Modos de falha.**

- **Rotear para uma réplica morta** até os health checks perceberem → intervalos curtos, health checks passivos (detecção de outliers), retries de requisições idempotentes em outra réplica.
- **Carga desigual** — uma réplica recebe as requisições lentas → least-outstanding-requests, hashing consistente só quando necessário.
- **Health check que mente** — `/health` responde 200 com o banco inacessível (ou responde 500 porque uma dependência não crítica caiu, esvaziando o conjunto) → separar liveness e readiness, verificar só o que a instância precisa para servir.
- **Sem drenagem de conexões** — deploys cortam requisições em andamento → atraso de desregistro, desligamento gracioso.

**No playground.** `lb` é um nó de **divisão** (*split*): as requisições são distribuídas entre os alvos saudáveis, proporcionalmente à capacidade (round robin ponderado pela capacidade). Sem um nó [`healthcheck`](../observability/index.md#healthcheck), uma réplica que caiu é detectada em ≈ 30 s; com ele, em ≈ 3 s — rode um perfil de caos e compare os picos de erro. Cenários: [`scale-out`](../../../../playground/scenarios/index.md#scale-out), [`monolith`](../../../../playground/scenarios/index.md#monolith), [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas).

**Produtos reais.**

=== "AWS"

    - **Application Load Balancer (ALB)** — camada 7, roteamento por caminho/host, HTTP/2, gRPC, WebSockets.
    - **Network Load Balancer (NLB)** — camada 4, vazão muito alta, IPs estáticos.

=== "GCP"

    - **Cloud Load Balancing** — Application Load Balancer externo global (L7, IP anycast) e Network Load Balancers (L4).

=== "Azure"

    - **Azure Load Balancer** — camada 4.
    - **Azure Application Gateway** — camada 7 com WAF opcional.

=== "Código aberto"

    - **HAProxy** — load balancer L4/L7 de alto desempenho.
    - **Nginx** — servidor web e proxy reverso / load balancer L7 (usado no Hands-on 3).
    - **Envoy** — proxy L7 com balanceamento avançado, usado por service meshes.
    - **Traefik** — proxy reverso com descoberta automática de serviços.

!!! tip "Na entrevista"
    "App servers sem estado atrás de um load balancer L7 com health checks: escalo adicionando réplicas, uma réplica que cai sai do conjunto em segundos e o próprio balanceador é um serviço gerenciado e redundante — não uma máquina só."

**Saiba mais:** [Borda › Balanceamento de carga](../../../classes/edge/load-balancing/index.md) · [Computação › Serviços](../../../classes/compute/services/index.md) · [Intro › Jornada de escala](../../../classes/intro/scaling-journey/index.md) · [Hands-on 3](../../../hands-on/3/index.md)

---

## WAF { #waf }

**O que é.** Um Web Application Firewall inspeciona requisições HTTP e bloqueia as que casam com padrões de ataque: SQL injection, cross-site scripting (XSS), path traversal, exploits conhecidos e comportamento abusivo (requisições demais por IP, user agents suspeitos, robôs). Normalmente roda na borda — acoplado à CDN, ao load balancer ou ao API gateway — com **conjuntos de regras gerenciados** mantidos pelo fornecedor mais as suas próprias regras.

**Quando usar.**

- Na frente de todo endpoint HTTP público, especialmente login, busca e checkout.
- Contra robôs e cambistas no BoxOffice: regras de taxa por IP/impressão digital, CAPTCHA ou desafios JavaScript no fluxo de compra, regras geográficas.
- Para um "patch virtual" rápido quando uma vulnerabilidade é divulgada e a correção no código leva dias.
- Como parte da proteção contra DDoS na camada 7 (inundações HTTP).

**Quando não usar (ou cuidado).**

- É uma rede de segurança, não um substituto para código seguro: consultas parametrizadas, codificação da saída e verificações de autorização continuam pertencendo à aplicação.
- **Falsos positivos** bloqueiam clientes reais (o nome de uma banda com apóstrofo parece SQL injection) → comece as regras em modo "contar/registrar" e só depois aplique.
- Limites de taxa por IP punem usuários atrás de NAT de operadora (um estádio inteiro em poucos IPs) → combine com a identidade do usuário/sessão no API gateway.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência adicionada | ≈ < 1 ms a alguns ms | Depende do número e do tipo de regras |
| Avaliação de regras | por requisição, na borda | Requisições bloqueadas nunca chegam à sua origem |
| Modelo de preço | por conjunto de regras + por milhão de requisições inspecionadas | ≈ ilustrativo; consulte o provedor |
| Fatia de tráfego de robôs em sites públicos | muitas vezes grande durante vendas | ≈ ilustrativo; meça o seu próprio tráfego |

**Modos de falha.**

- **Falsos positivos** — compras legítimas bloqueadas → monitoração das requisições bloqueadas, exceções por caminho, implantação gradual das regras.
- **Fail-open vs fail-closed** — se o WAF falhar, você deixa tudo passar ou bloqueia tudo? Decida por endpoint.
- **Contorno** — atacantes acessam a origem diretamente → aceite tráfego na origem só das faixas de IP da CDN/WAF ou por uma conexão privada.
- **Atualização de regra quebra o tráfego** → regras versionadas como código, testadas antes de ativar.

**No playground.** `waf` é um nó de **chamada** (*call*) no caminho da requisição, com latência pequena (≈ 1 ms) e capacidade como qualquer outro nó; barra uma fração `blockRate` (padrão 0,95) do tráfego de robôs dos clientes (`botShare`) e custa dinheiro por requisição. Coloque-o entre o cliente/CDN e o gateway para ver o efeito em latência e custo. Eventos de caos como picos virais e multidões repentinas mostram por que filtrar robôs na borda protege o backend. Cenários: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale), [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter).

**Produtos reais.**

=== "AWS"

    - **AWS WAF** — regras gerenciadas, regras por taxa, Bot Control; acopla-se a CloudFront, ALB e API Gateway.
    - **AWS Shield** — proteção contra DDoS (Standard incluso; Advanced pago).

=== "GCP"

    - **Google Cloud Armor** — WAF e proteção contra DDoS para o Application Load Balancer externo, com regras OWASP pré-configuradas e rate limiting.

=== "Azure"

    - **Azure Web Application Firewall** — no Front Door e no Application Gateway.
    - **Azure DDoS Protection** — mitigação de DDoS no nível de rede.

=== "Código aberto"

    - **ModSecurity** com o **OWASP Core Rule Set (CRS)** — o motor e as regras clássicos de WAF de código aberto.
    - **Coraza** — motor de WAF em Go, compatível com regras do ModSecurity e com o CRS.

!!! tip "Na entrevista"
    "Na borda coloco um WAF com regras OWASP gerenciadas e proteção contra robôs no fluxo de compra; ele barra tentativas de injeção e robôs de cambistas antes que custem uma única consulta ao banco. É uma rede de segurança — a aplicação continua validando e autorizando tudo."

**Saiba mais:** [Borda (visão geral)](../../../classes/edge/index.md) · [Rede e segurança › Zero trust](../../../classes/network-security/zero-trust/index.md) · [Estudo de caso: venda de ingressos](../../../classes/case-studies/ticketing/index.md)

---

## API Gateway { #apigw }

**O que é.** A porta de entrada única da sua API. Os clientes chamam um único host; o gateway **roteia** cada requisição para o serviço certo e aplica as preocupações transversais em um só lugar: autenticação (validação de JWTs), **rate limiting** e cotas, transformação de requisição/resposta, cache, CORS, chaves de API, observabilidade. Um **BFF** (Backend for Frontend) é um gateway feito sob medida para um tipo de cliente, agregando várias chamadas de serviços em uma resposta para uma tela do app.

**Quando usar.**

- Com vários serviços atrás de uma API pública (BoxOffice: `catalog`, `inventory`, `order`, `search`, `assistant`).
- Para proteger o backend: limites por usuário e por endpoint (token bucket, janela deslizante) respondendo `429 Too Many Requests` com `Retry-After`.
- Para centralizar a validação de tokens, sem que cada serviço a reimplemente.
- Para publicar APIs a parceiros (chaves de API, planos de uso, portal do desenvolvedor).

**Quando não usar (ou cuidado).**

- Não coloque lógica de negócio no gateway; ele vira um monólito distribuído que todos os times precisam alterar.
- Ele está no caminho de toda requisição: precisa ser redundante, ter autoescala e ser rápido.
- Rate limiting com muitas réplicas do gateway exige estado compartilhado (Redis) ou limites locais aproximados.
- Para um único serviço, um load balancer pode bastar.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência adicionada | ≈ 1–10 ms | Mais com plugins (introspecção de token, transformações) |
| Verificação de rate limit no Redis | ≈ 0,5–1 ms | Uma ida e volta, atômica com um script Lua |
| Status HTTP para limitação | `429` + `Retry-After` | `503` é para sobrecarga do próprio servidor |
| Limite de compra no BoxOffice | ex.: 5 tentativas/min por usuário | ≈ política ilustrativa |

**Modos de falha.**

- **Gateway sobrecarregado** — vira o gargalo → autoescala, plugins leves, descartar carga cedo.
- **Armazenamento do rate limiter fora do ar** → escolha fail-open (disponibilidade) ou fail-closed (proteção) por rota; caia para limites locais em memória.
- **Timeouts não configurados** — um serviço lento segura conexões do gateway e o gateway morre junto → timeouts por rota, circuit breakers.
- **Retries em todas as camadas** (cliente, gateway, serviço) multiplicam a carga → repita em uma camada só, com backoff e orçamento de retries.

**No playground.** `apigw` é um nó de **chamada** (e de **divisão** quando tem dois ou mais alvos do mesmo tipo). O parâmetro `rateLimit` (padrão 0 = desligado) limita a taxa aceita: o excesso é rejeitado com erros (429) em vez de sobrecarregar o backend. Os parâmetros das arestas de saída (`timeoutMs`, `retries`, `backoff`, `circuitBreaker`) modelam as políticas de resiliência. Cenários: [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter), [`retry-storm`](../../../../playground/scenarios/index.md#retry-storm), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale).

**Produtos reais.**

=== "AWS"

    - **Amazon API Gateway** — APIs REST, HTTP e WebSocket gerenciadas com throttling, planos de uso e autorizadores.

=== "GCP"

    - **Apigee** — plataforma completa de gestão de APIs.
    - **API Gateway** — gateway gerenciado leve para back ends serverless.

=== "Azure"

    - **Azure API Management** — gateway, políticas, portal do desenvolvedor.

=== "Código aberto"

    - **Spring Cloud Gateway** — gateway Java usado no curso (Hands-on 4).
    - **Kong Gateway** — gateway baseado em Nginx/OpenResty com plugins.
    - **Envoy Gateway**, **Apache APISIX**, **Tyk** — outros gateways de código aberto.

!!! tip "Na entrevista"
    "Um API gateway na frente dos serviços valida o JWT uma vez, roteia por caminho e aplica um rate limit de token bucket por usuário, apoiado no Redis, respondendo 429 com Retry-After. A lógica de negócio fica nos serviços; o gateway fica fino, redundante e rápido."

**Saiba mais:** [Borda › API gateway](../../../classes/edge/api-gateway/index.md) · [Estudo de caso: rate limiter](../../../classes/case-studies/rate-limiter/index.md) · [Rede e segurança › Identidade](../../../classes/edge/identity/index.md) · [Hands-on 4](../../../hands-on/4/index.md)

---

## Ingress { #ingress }

**O que é.** No Kubernetes, um **Ingress** é um recurso que declara como o tráfego HTTP(S) externo chega aos Services do cluster (`boxoffice.example/api/catalog` → Service `catalog`). As regras são executadas por um **Ingress controller** (Nginx, Traefik, um load balancer da nuvem). A **Gateway API** (`Gateway`, `HTTPRoute`, …), mais nova, é a sucessora: mais expressiva (casamento por cabeçalho, divisão de tráfego para canários) e com papéis separados entre o time de plataforma e os times de aplicação.

**Quando usar.**

- Sempre que os serviços rodarem em Kubernetes e precisarem ser alcançados de fora por HTTP(S).
- Para roteamento por caminho/host, terminação TLS com certificados renovados automaticamente (cert-manager) e divisão de tráfego para canários (Gateway API).
- Para manter o roteamento **declarativo** e versionado junto com os manifestos da aplicação (GitOps).

**Quando não usar (ou cuidado).**

- O Ingress trata HTTP(S); TCP/UDP puro exige um `Service` do tipo `LoadBalancer` ou rotas TCP/UDP da Gateway API.
- A API Ingress original é limitada; o comportamento avançado mora em anotações específicas de cada controller, que não se transportam entre controllers. Prefira a Gateway API em projetos novos.
- Os pods do controller estão no caminho de toda requisição: rode várias réplicas e dê recursos a eles.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência adicionada | ≈ 1 ms ou menos | Um salto de proxy L7 |
| Réplicas do controller | ≥ 2, espalhadas por zonas | Evita ponto único de falha |
| Recarga de configuração após uma mudança | segundos | Alguns controllers recarregam sem derrubar conexões |
| Renovação de certificado (Let's Encrypt via cert-manager) | automática, certificados válidos por 90 dias | Renovados bem antes de expirar |

**Modos de falha.**

- **Controller sem redundância ou subdimensionado** → várias réplicas, autoescala, pod disruption budgets.
- **Regra errada encobre outra rota** → revisão, testes da tabela de roteamento, precedência mais clara da Gateway API.
- **Certificado expirado** → cert-manager com alertas de expiração.
- **Readiness não configurada** — o tráfego chega a pods que ainda estão iniciando → readiness probes nos backends.

**No playground.** `ingress` é um nó de **divisão** como o load balancer: espalha as requisições entre os alvos saudáveis em proporção à capacidade deles. Use-o para modelar a entrada de um cluster Kubernetes na frente de réplicas de aplicação com `autoscale` ativado. Cenários: [`scale-out`](../../../../playground/scenarios/index.md#scale-out), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Produtos reais.**

=== "AWS"

    - **AWS Load Balancer Controller** — implementa Ingress (com ALB) e Services do tipo LoadBalancer (com NLB) no Amazon EKS.

=== "GCP"

    - **GKE Ingress** e **GKE Gateway controller** — implementam Ingress e a Gateway API com os load balancers do Google Cloud.

=== "Azure"

    - **Application Gateway for Containers** — o load balancer L7 do Azure para AKS, com suporte a Ingress e à Gateway API.
    - **Add-on de application routing do AKS** — ingress gerenciado baseado em Nginx.

=== "Código aberto"

    - **ingress-nginx** — o Ingress controller Nginx da comunidade, muito comum em clusters antigos; o projeto Kubernetes anunciou sua aposentadoria (março de 2026), então clusters novos devem escolher uma implementação da Gateway API.
    - **Traefik**, **HAProxy Ingress**, **Contour**, **Envoy Gateway** — outros controllers; Envoy Gateway e Contour implementam a Gateway API.
    - **cert-manager** — certificados TLS automáticos para Ingress e Gateway.

!!! tip "Na entrevista"
    "No Kubernetes, o tráfego externo entra por um controller de Ingress (ou da Gateway API) que roteia por host e caminho até os Services, termina o TLS com certificados automáticos e pode dividir o tráfego para um canário. Ele roda com várias réplicas porque toda requisição passa por ele."

**Saiba mais:** [Borda › API gateway](../../../classes/edge/api-gateway/index.md) · [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md) · [Cloud-native › Entrega](../../../classes/cloud-native/delivery/index.md) · [Hands-on 10](../../../hands-on/10/index.md)
